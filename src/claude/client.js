/**
 * Claude API Client with Agent Loop
 *
 * Main orchestrator for agent execution:
 * - Loads agent prompts
 * - Manages conversation history
 * - Executes tool calls
 * - Streams responses to frontend
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadAgentPromptCached } from '../agents/load-agents.js';
import { loadConversationMemories } from '../tools/memory.js';
import { loadLearningMemory } from '../tools/learning-memory.js';
import { getLeadGenFormContext } from '../utils/lead-gen-context.js';
import { executeToolCall } from '../tools/executor.js';
import { getToolsForAgent } from '../tools/definitions.js';
import { streamToSSE, setupSSE, closeSSE, sendSSE } from './streaming.js';
import { getQueryConfig, getQueryConfigForModel, logConfigDecision } from './query-classifier.js';
import {
  getMaxTurnsForAgent,
  calculateRequestCost,
  shouldWarnAboutCost,
  COST_SETTINGS
} from '../config/cost-settings.js';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Strip tool narration patterns from text (safety net)
 * Removes lines like "Let me search...", "Let me store...", etc.
 */
function stripToolNarration(text) {
  if (!text) return text;

  const narrationPatterns = [
    /^Let me search[^\n]*\.?\n?/gm,
    /^Let me look[^\n]*\.?\n?/gm,
    /^Let me store[^\n]*\.?\n?/gm,
    /^Let me broaden[^\n]*\.?\n?/gm,
    /^Let me check[^\n]*\.?\n?/gm,
    /^Let me find[^\n]*\.?\n?/gm,
    /^Let me save[^\n]*\.?\n?/gm,
    /^Searching[^\n]*\.?\n?/gm,
    /^Storing[^\n]*\.?\n?/gm,
    /^Looking up[^\n]*\.?\n?/gm,
    /^I'll search[^\n]*\.?\n?/gm,
    /^I'll look[^\n]*\.?\n?/gm,
    /^I'll check[^\n]*\.?\n?/gm,
  ];

  let cleaned = text;
  for (const pattern of narrationPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up resulting multiple line breaks
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Convert markdown formatting to HTML (safety net)
 * Handles bold, links, and basic formatting that the model might output
 */
function convertMarkdownToHtml(text) {
  if (!text) return text;

  return text
    // Bold: **text** → <strong>text</strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Links: [text](url) → <a href="url">text</a>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// DEPRECATED: These are now set dynamically based on query complexity
// Kept for backwards compatibility
const FALLBACK_MAX_AGENT_LOOPS = 20;
const FALLBACK_MODEL = 'claude-sonnet-4-5-20250929'; // Use latest Sonnet 4.5
const FALLBACK_MAX_TOKENS = 16000;
const FALLBACK_THINKING_BUDGET = 10000;

/**
 * Main agent execution function
 * @param {Object} params - Execution parameters
 * @param {string} params.agentType - Type of agent to run
 * @param {string} params.message - User message
 * @param {string} params.conversationId - Conversation UUID
 * @param {string} params.userId - User UUID
 * @param {string} params.sessionId - Session UUID for this request
 * @param {Array} params.attachments - File attachments (images/PDFs)
 * @param {Object} params.res - Express response object for SSE streaming
 * @param {string} params.forceModel - Optional model to force (bypasses query classifier)
 * @param {Object} params.modelConfig - Optional model configuration overrides (maxIterations, etc)
 * @returns {Promise<Object>} Execution result
 */
export async function runAgent({
  agentType,
  message,
  conversationId,
  userId,
  sessionId,
  attachments = [],
  res,
  forceModel = null,
  modelConfig = {}
}) {
  console.log('\n' + '='.repeat(80));
  console.log(`🤖 Running agent: ${agentType}`);
  console.log(`📝 Conversation: ${conversationId}`);
  console.log(`👤 User: ${userId}`);
  console.log(`🔑 Session: ${sessionId}`);
  console.log('='.repeat(80) + '\n');

  // Setup SSE headers (only if res exists - webhook enrichment has no client)
  if (res) {
    setupSSE(res);

    // Send connection confirmation
    sendSSE(res, {
      type: 'connected',
      sessionId,
      conversationId,
      agentType
    });
  }

  try {
    // ============================================================================
    // 1. Load agent prompt (BASE PROMPT - CACHEABLE)
    // ============================================================================

    console.log(`📋 Loading agent prompt for: ${agentType}`);
    const baseAgentPrompt = loadAgentPromptCached(agentType);
    console.log(`✓ Agent prompt loaded (${baseAgentPrompt.length} characters)`);

    // ============================================================================
    // 2. Load conversation memories (CONVERSATION-SPECIFIC - NOT CACHEABLE)
    // ============================================================================

    console.log(`🧠 Loading conversation memories...`);
    const memories = await loadConversationMemories(conversationId);
    if (memories) {
      const memoryCount = memories.split('\n').length - 2; // Subtract header lines
      console.log(`✓ Loaded ${memoryCount} memories into context`);
    } else {
      console.log(`✓ No memories found for this conversation`);
    }

    // ============================================================================
    // 2.5. Load learning memory from feedback (USER-SPECIFIC - NOT CACHEABLE)
    // ============================================================================

    console.log(`📚 Loading learned patterns from user feedback...`);
    const learningMemory = await loadLearningMemory(agentType, conversationId, userId);
    if (learningMemory) {
      console.log(`✓ Injected learned patterns from feedback into system prompt`);
    } else {
      console.log(`✓ No learned patterns available yet (feedback learning will run as feedback is collected)`);
    }

    // ============================================================================
    // 2.6. Load lead-gen form context (LEAD-GEN ONLY - NOT CACHEABLE)
    // ============================================================================

    let leadGenFormContext = null;
    if (agentType === 'lead-gen') {
      console.log(`📝 Loading lead-gen form context...`);
      leadGenFormContext = await getLeadGenFormContext(conversationId);
      if (leadGenFormContext) {
        console.log(`✓ Injected lead form data and company background into system prompt`);
      } else {
        console.log(`✓ No form context available (may be first message before form submission)`);
      }
    }

    // ============================================================================
    // 2.7. Get query-specific configuration (NEW: Performance Optimization)
    // ============================================================================

    // For lead-gen: load raw memories for stateful routing (estimate detection)
    let conversationMemoriesObject = null;
    if (agentType === 'lead-gen') {
      const { listMemories } = await import('../tools/memory.js');
      const memoriesResult = await listMemories(conversationId);
      if (memoriesResult.success && memoriesResult.memories.length > 0) {
        // Convert array of {key, value} to object {key: value}
        conversationMemoriesObject = {};
        memoriesResult.memories.forEach(mem => {
          conversationMemoriesObject[mem.key] = mem.value;
        });
      }
    }

    const queryConfig = forceModel
      ? getQueryConfigForModel(forceModel, modelConfig)
      : getQueryConfig(message, agentType, conversationMemoriesObject);
    logConfigDecision(queryConfig, message);

    // Extract configuration values
    const MODEL = queryConfig.model;
    const MAX_TOKENS = queryConfig.maxTokens;
    const THINKING_CONFIG = queryConfig.thinking;
    const TEMPERATURE = queryConfig.temperature;
    const MAX_AGENT_LOOPS = queryConfig.maxIterations;

    // ============================================================================
    // 3. Load conversation history from database
    // ============================================================================

    console.log(`💬 Loading conversation history...`);
    const {
      getConversationMessages,
      getLeadGenMessages,
      getCompactionSummary,
      saveCompactionSummary,
      deleteOldMessages
    } = await import('../database/messages.js');

    // Get max turns for this agent (cost optimization)
    const maxTurns = getMaxTurnsForAgent(agentType);
    const maxMessages = maxTurns * 2; // Each turn = user + assistant message

    // Use specialized retrieval for lead-gen (reads from lead_gen_conversations.messages JSONB)
    let history;
    if (agentType === 'lead-gen') {
      history = await getLeadGenMessages(conversationId, maxMessages);
    } else {
      history = await getConversationMessages(conversationId, maxMessages);
    }
    console.log(`✓ Retrieved ${history.length} messages for conversation ${conversationId}`);

    // ============================================================================
    // 3.5. Strip thinking blocks from historical assistant messages
    // ============================================================================
    // CRITICAL FIX: Anthropic API throws 400 error if thinking blocks are modified
    // in multi-turn conversations. We must remove all thinking/redacted_thinking blocks
    // from historical assistant messages before sending them back to the API.
    // Reference: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking

    history = history.map(msg => {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.filter(block =>
            block.type !== 'thinking' && block.type !== 'redacted_thinking'
          )
        };
      }
      return msg;
    });

    console.log(`✓ Loaded ${history.length} previous messages (max: ${maxMessages})`);

    // ============================================================================
    // 3.6. AUTO-COMPACTION: Check if conversation needs summarization
    // ============================================================================

    // Load existing summary if any
    const existingSummary = await getCompactionSummary(conversationId);

    // Check if compaction is needed
    const { shouldCompact, compactConversation, formatSummary } = await import('../utils/conversation-compaction.js');
    const { needsCompaction, estimatedTokens } = shouldCompact(history, existingSummary);

    let conversationSummary = existingSummary;

    if (needsCompaction) {
      console.log(`🗜️  Conversation exceeds threshold (${estimatedTokens.toLocaleString()} tokens) - triggering auto-compaction`);

      // Compact the conversation
      const compactionResult = await compactConversation(history, agentType);

      if (compactionResult.summarizedCount > 0) {
        // Save the summary to database
        await saveCompactionSummary(
          conversationId,
          compactionResult.summary,
          compactionResult.metadata
        );

        // Delete old messages from database (keep only recent ones)
        await deleteOldMessages(conversationId, compactionResult.keptMessages.length);

        // Update conversation history to use only kept messages
        history = compactionResult.keptMessages;
        conversationSummary = {
          content: compactionResult.summary,
          metadata: compactionResult.metadata
        };

        console.log(`✓ Compaction complete: ${compactionResult.summarizedCount} messages summarized, ${history.length} kept`);
      }
    }

    // Add summary to system blocks if it exists (will be prepended to memories)
    let summaryForSystem = null;
    if (conversationSummary) {
      summaryForSystem = formatSummary(conversationSummary.content);
      console.log(`✓ Including conversation summary (${Math.ceil(conversationSummary.content.length / 4).toLocaleString()} tokens estimated)`);
    }

    // ============================================================================
    // 4. Build user message with attachments
    // ============================================================================

    const userContent = [];

    // Add attachments (images/PDFs/documents) - these go first
    for (const attachment of attachments) {
      if (attachment.type === 'image') {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.data
          }
        });
        console.log(`📷 Added image attachment: ${attachment.mimeType}`);
      } else if (attachment.type === 'pdf') {
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: attachment.data
          }
        });
        console.log(`📄 Added PDF attachment`);
      } else if (attachment.type === 'csv_text') {
        // CSV from XLSX conversion - send as plain text (simple and fast)
        userContent.push({
          type: 'text',
          text: `[File: ${attachment.filename}]\n\n${attachment.content}`
        });
        console.log(`📊 Added CSV text from ${attachment.filename} (${attachment.content.length} chars)`);
      } else if (attachment.type === 'docx_text') {
        // DOCX text extraction - send as plain text (Messages API doesn't support DOCX)
        userContent.push({
          type: 'text',
          text: attachment.content
        });
        console.log(`📝 Added DOCX text from ${attachment.filename} (${attachment.content.length} chars)`);
      } else if (attachment.type === 'text_file') {
        // Plain text file content - send as text block
        userContent.push({
          type: 'text',
          text: attachment.content
        });
        console.log(`📝 Added text file ${attachment.filename} (${attachment.content.length} chars)`);
      } else if (attachment.type === 'document') {
        // PDF documents use file_id from Files API
        // (Only PDFs are supported as document type in Messages API)
        const docBlock = {
          type: 'document',
          source: {
            type: 'file',
            file_id: attachment.fileId
          }
        };

        // Add title if filename is available
        if (attachment.filename) {
          docBlock.title = attachment.filename;
        }

        userContent.push(docBlock);
        console.log(`📝 Added document attachment via Files API: ${attachment.fileId} (${attachment.filename || attachment.mimeType})`);
      }
    }

    // Add text message
    userContent.push({
      type: 'text',
      text: message
    });

    // ============================================================================
    // Build messages array
    // ============================================================================

    // IMPORTANT: Do NOT add cache_control to historical messages
    // Anthropic's API only allows cache_control on:
    // 1. System prompt blocks (already applied above)
    // 2. Static tool arrays (enabled via curated tool sets)
    // 3. Current user message content blocks (not historical ones)
    //
    // Caching is achieved through:
    // - Cached system prompt (largest component)
    // - Static tools array (reused across calls)
    // - NOT through historical message caching

    let messages = [
      ...history,
      { role: 'user', content: userContent }
    ];

    console.log(`✓ Message constructed with ${attachments.length} attachments`);

    // ============================================================================
    // 5. Get tools for this agent
    // ============================================================================

    const tools = getToolsForAgent(agentType);
    console.log(`🔧 Loaded ${tools.length} tools for agent`)

    // ============================================================================
    // 6. Agent execution loop
    // ============================================================================

    let loopCount = 0;
    let accumulatedText = ''; // Track text across ALL iterations (fixes greeting loss bug)

    while (loopCount < MAX_AGENT_LOOPS) {
      loopCount++;
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🔄 Agent loop iteration ${loopCount}/${MAX_AGENT_LOOPS}`);
      console.log('─'.repeat(80));

      // Send loop status to frontend
      sendSSE(res, {
        type: 'loop_iteration',
        iteration: loopCount,
        sessionId
      });

      // Call Claude API with streaming
      console.log(`📡 Calling Claude API...`);

      // ============================================================================
      // Build system blocks (CACHE FIX: Separate cacheable from non-cacheable)
      // ============================================================================
      // Only the base agent prompt is cached (shared across all conversations)
      // Summary, memories, and learning are conversation/user-specific (NOT cached)
      // This prevents creating a new cache for every conversation

      const systemBlocks = [
        {
          type: 'text',
          text: baseAgentPrompt,
          cache_control: { type: 'ephemeral' }  // ✅ CACHED (reused across conversations)
        }
      ];

      // Add conversation summary (if present) - NOT CACHED
      // Summary contains condensed history of old messages
      if (summaryForSystem) {
        systemBlocks.push({
          type: 'text',
          text: summaryForSystem  // ❌ NOT CACHED (conversation-specific)
        });
      }

      // Add conversation memories (if present) - NOT CACHED
      if (memories) {
        systemBlocks.push({
          type: 'text',
          text: memories  // ❌ NOT CACHED (conversation-specific)
        });
      }

      // Add learning memory (if present) - NOT CACHED
      if (learningMemory) {
        systemBlocks.push({
          type: 'text',
          text: learningMemory  // ❌ NOT CACHED (user-specific)
        });
      }

      // Add lead-gen form context (if present) - NOT CACHED
      if (leadGenFormContext) {
        systemBlocks.push({
          type: 'text',
          text: leadGenFormContext  // ❌ NOT CACHED (conversation-specific)
        });
        console.log(`🔍 DEBUG: Lead-gen context injected into system prompt:\n${leadGenFormContext}`);
      }

      // DEBUG: Log full system prompt structure for lead-gen conversations
      if (agentType === 'lead-gen' && leadGenFormContext) {
        console.log(`🔍 DEBUG: Full system prompt blocks (${systemBlocks.length} blocks):`);
        systemBlocks.forEach((block, i) => {
          if (block.type === 'text') {
            const preview = block.text.substring(0, 200).replace(/\n/g, ' ');
            console.log(`  Block ${i}: ${preview}${block.text.length > 200 ? '...' : ''}`);
          }
        });
      }

      const apiParams = {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,

        // System prompt blocks (with proper cache separation)
        system: systemBlocks,

        messages,
        tools: tools,

        // Enable streaming
        stream: true
      };

      // Only add thinking if configured (undefined = disabled for simple queries)
      if (THINKING_CONFIG) {
        apiParams.thinking = THINKING_CONFIG;
      }

      const stream = await anthropic.messages.create(apiParams, {
        // Beta headers for web fetch tool, interleaved thinking, memory tool, and files API
        headers: {
          'anthropic-beta': 'web-fetch-2025-09-10,interleaved-thinking-2025-05-14,context-management-2025-06-27,files-api-2025-04-14'
        }
      });

      // Stream response to frontend and collect full response
      const fullResponse = await streamToSSE(stream, res, sessionId, agentType);

      console.log(`✓ Response received - stop_reason: ${fullResponse.stop_reason}`);

      // CRITICAL FIX: For lead-gen, only accumulate text from FINAL iteration (end_turn)
      // This prevents tool narration like "Let me search..." from bleeding into responses
      // For other agents, preserve old behavior (accumulate from all iterations)
      const iterationText = fullResponse.content
        .filter(block => block.type === 'text' && block.text && block.text.trim())
        .map(block => block.text)
        .join('\n');

      if (iterationText) {
        if (agentType === 'lead-gen') {
          // Lead-gen: ONLY save text from final iteration (prevents tool narration)
          if (fullResponse.stop_reason === 'end_turn') {
            accumulatedText = iterationText; // Replace, don't append (only final text matters)

            // Apply regex safety net to strip any remaining narration patterns
            const cleaned = stripToolNarration(accumulatedText);
            if (cleaned !== accumulatedText) {
              console.log(`  🧹 Stripped ${accumulatedText.length - cleaned.length} chars of narration (safety net)`);
              accumulatedText = cleaned;
            }

            // Convert markdown to HTML (safety net for formatting)
            const htmlConverted = convertMarkdownToHtml(accumulatedText);
            if (htmlConverted !== accumulatedText) {
              console.log(`  🎨 Converted markdown to HTML (safety net)`);
              accumulatedText = htmlConverted;
            }

            console.log(`  📝 Final iteration text: ${accumulatedText.length} chars (lead-gen mode: discarding tool narration)`);
          } else {
            console.log(`  🔇 Skipping tool narration text: ${iterationText.length} chars (stop_reason: ${fullResponse.stop_reason})`);
          }
        } else {
          // Other agents: preserve old behavior (accumulate from all iterations)
          if (accumulatedText) {
            accumulatedText += '\n' + iterationText;
          } else {
            accumulatedText = iterationText;
          }
          console.log(`  📝 Accumulated ${iterationText.length} chars of text (total: ${accumulatedText.length})`);
        }
      }

      // ============================================================================
      // Cost monitoring and logging
      // ============================================================================

      if (fullResponse.usage) {
        const usage = fullResponse.usage;
        const cost = calculateRequestCost(usage, MODEL);

        // Log token usage for monitoring
        console.log(`📊 Token usage: {`,
          `input: ${usage.input_tokens || 0},`,
          `output: ${usage.output_tokens || 0},`,
          `cache_creation: ${usage.cache_creation_input_tokens || 0},`,
          `cache_read: ${usage.cache_read_input_tokens || 0}`,
        `}`);

        console.log(`💰 Request cost: $${cost.toFixed(4)}`);

        // Warn if cost is unusually high
        if (shouldWarnAboutCost(cost)) {
          console.warn(`⚠️  HIGH COST ALERT: Request cost ($${cost.toFixed(2)}) exceeds threshold ($${COST_SETTINGS.monitoring.warnThreshold})`);
          console.warn(`   Agent: ${agentType}, Model: ${MODEL}, Conversation: ${conversationId}`);
        }

        // Calculate cache hit rate for this request
        const totalInput = (usage.input_tokens || 0) +
                          (usage.cache_creation_input_tokens || 0) +
                          (usage.cache_read_input_tokens || 0);
        if (totalInput > 0 && usage.cache_read_input_tokens) {
          const cacheHitRate = (usage.cache_read_input_tokens / totalInput) * 100;
          console.log(`📈 Cache hit rate: ${cacheHitRate.toFixed(1)}%`);
        }
      }

      // ============================================================================
      // Handle stop reason
      // ============================================================================

      // CASE 1: Normal completion (end_turn)
      if (fullResponse.stop_reason === 'end_turn') {
        console.log('✅ Agent completed successfully (end_turn)');

        // Save content (including thinking blocks, but filter out empty text blocks)
        // Extended thinking requires thinking blocks to be present in conversation history
        // for proper context in subsequent turns
        const contentToSave = fullResponse.content.filter(block => {
          // Remove empty text blocks that would cause API errors when loaded
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });

        // Save final messages to database
        if (agentType === 'lead-gen') {
          // Lead-gen: save to lead_gen_conversations.messages JSONB array
          // CRITICAL: Use accumulated text from ALL iterations, not just final iteration
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          let assistantText = accumulatedText || ''; // Use accumulated text across all iterations

          if (!assistantText || assistantText.trim() === '') {
            console.warn('⚠️  Empty assistant response detected - injecting fallback message');

            // Get contact name from form data for personalization
            const { query } = await import('../database/connection.js');
            const formResult = await query(
              'SELECT contact_name FROM lead_gen_conversations WHERE session_id = $1',
              [conversationId]
            );
            const contactName = formResult.rows[0]?.contact_name || 'there';

            // Inject fallback message
            assistantText = `Hey ${contactName} — thanks for filling that out! I'm pulling together your funding estimate now. Give me just a moment and I'll have your personalized breakdown ready.`;

            // Stream fallback to frontend
            const { sendSSEMessage } = await import('../utils/sse.js');
            sendSSEMessage(res, 'text_delta', { text: assistantText });
            sendSSEMessage(res, 'message_complete', {});
          }

          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, assistantText);
          console.log(`✓ Messages saved to database (${assistantText.length} chars from ${loopCount} iterations)`);
        } else {
          // Standard agents: save to messages table
          const { saveMessage } = await import('../database/messages.js');
          await saveMessage(conversationId, 'user', userContent);
          await saveMessage(conversationId, 'assistant', contentToSave);
          console.log('✓ Messages saved to database');
        }

        // Send completion event
        closeSSE(res);

        console.log('\n' + '='.repeat(80));
        console.log('🎉 Agent execution completed successfully');
        console.log('='.repeat(80) + '\n');

        return {
          success: true,
          response: fullResponse,
          iterations: loopCount
        };
      }

      // CASE 2: Tool use required
      if (fullResponse.stop_reason === 'tool_use') {
        console.log('🔧 Agent requested tool use');

        // Clean content blocks: remove index field and filter out empty text blocks
        // CRITICAL: Also remove thinking/redacted_thinking blocks to prevent 400 errors
        // when messages are sent back to API in multi-turn tool use loops
        const cleanedContent = fullResponse.content
          .filter(block => {
            // Remove empty text blocks that would cause API errors
            if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
              return false;
            }
            // Remove thinking blocks (they cannot be modified/resent to API)
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              return false;
            }
            return true;
          })
          .map(block => {
            const { index, ...cleanBlock} = block;
            return cleanBlock;
          });

        // Add assistant response to messages (WITHOUT thinking blocks)
        messages.push({
          role: 'assistant',
          content: cleanedContent
        });

        // Extract and execute tool calls
        const toolResults = [];
        for (const block of fullResponse.content) {
          if (block.type === 'tool_use') {
            console.log(`\n  🛠️  Tool: ${block.name}`);
            console.log(`  📥 Input:`, JSON.stringify(block.input, null, 2));

            // Notify frontend of tool use
            sendSSE(res, {
              type: 'tool_use',
              toolId: block.id,
              toolName: block.name,
              input: block.input,
              sessionId
            });

            // Execute tool
            const result = await executeToolCall(
              block.name,
              block.input,
              conversationId,
              userId,  // Pass userId for domain-wide delegation
              agentType  // Pass agentType for agent-specific tool behavior
            );

            console.log(`  📤 Result:`, JSON.stringify(result, null, 2).substring(0, 200) + '...');

            // Notify frontend of tool result
            sendSSE(res, {
              type: 'tool_result',
              toolId: block.id,
              toolName: block.name,
              result,
              sessionId
            });

            // Standard tool result
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            });
          }
        }

        console.log(`✓ Executed ${toolResults.length} tool calls`);

        // Add tool results to messages
        messages.push({
          role: 'user',
          content: toolResults
        });

        // Continue to next loop iteration
        continue;
      }

      // CASE 3: Max tokens reached
      if (fullResponse.stop_reason === 'max_tokens') {
        console.warn('⚠️  Agent hit max_tokens limit');

        sendSSE(res, {
          type: 'warning',
          message: 'Response truncated due to length limit',
          sessionId
        });

        // Save what we have (including thinking blocks, but filter out empty text blocks)
        const contentToSave = fullResponse.content.filter(block => {
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });

        if (agentType === 'lead-gen') {
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          let assistantText = accumulatedText || ''; // Use accumulated text

          if (!assistantText || assistantText.trim() === '') {
            console.warn('⚠️  Empty assistant response detected (max_tokens) - injecting fallback message');

            // Get contact name from form data for personalization
            const { query } = await import('../database/connection.js');
            const formResult = await query(
              'SELECT contact_name FROM lead_gen_conversations WHERE session_id = $1',
              [conversationId]
            );
            const contactName = formResult.rows[0]?.contact_name || 'there';

            // Inject fallback message
            assistantText = `Hey ${contactName} — thanks for filling that out! I'm pulling together your funding estimate now. Give me just a moment and I'll have your personalized breakdown ready.`;

            // Stream fallback to frontend
            const { sendSSEMessage } = await import('../utils/sse.js');
            sendSSEMessage(res, 'text_delta', { text: assistantText });
            sendSSEMessage(res, 'message_complete', {});
          }

          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, assistantText);
        } else {
          const { saveMessage } = await import('../database/messages.js');
          await saveMessage(conversationId, 'user', userContent);
          await saveMessage(conversationId, 'assistant', contentToSave);
        }

        closeSSE(res);

        return {
          success: true,
          response: fullResponse,
          warning: 'max_tokens_reached',
          iterations: loopCount
        };
      }

      // CASE 4: Stop sequence encountered
      if (fullResponse.stop_reason === 'stop_sequence') {
        console.log('✓ Agent hit stop sequence');

        const contentToSave = fullResponse.content.filter(block => {
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });

        if (agentType === 'lead-gen') {
          const userText = typeof message === 'string' ? message : JSON.stringify(message);
          let assistantText = accumulatedText || ''; // Use accumulated text

          if (!assistantText || assistantText.trim() === '') {
            console.warn('⚠️  Empty assistant response detected (stop_sequence) - injecting fallback message');

            // Get contact name from form data for personalization
            const { query } = await import('../database/connection.js');
            const formResult = await query(
              'SELECT contact_name FROM lead_gen_conversations WHERE session_id = $1',
              [conversationId]
            );
            const contactName = formResult.rows[0]?.contact_name || 'there';

            // Inject fallback message
            assistantText = `Hey ${contactName} — thanks for filling that out! I'm pulling together your funding estimate now. Give me just a moment and I'll have your personalized breakdown ready.`;

            // Stream fallback to frontend
            const { sendSSEMessage } = await import('../utils/sse.js');
            sendSSEMessage(res, 'text_delta', { text: assistantText });
            sendSSEMessage(res, 'message_complete', {});
          }

          const { appendLeadGenMessages } = await import('../api/lead-gen.js');
          await appendLeadGenMessages(conversationId, userText, assistantText);
        } else {
          const { saveMessage } = await import('../database/messages.js');
          await saveMessage(conversationId, 'user', userContent);
          await saveMessage(conversationId, 'assistant', contentToSave);
        }

        closeSSE(res);

        return {
          success: true,
          response: fullResponse,
          iterations: loopCount
        };
      }

      // CASE 5: Unexpected stop reason
      console.error(`❌ Unexpected stop_reason: ${fullResponse.stop_reason}`);
      break;
    }

    // ============================================================================
    // Max loops exceeded
    // ============================================================================

    if (loopCount >= MAX_AGENT_LOOPS) {
      console.error(`❌ Agent exceeded maximum loop limit (${MAX_AGENT_LOOPS})`);

      sendSSE(res, {
        type: 'error',
        error: `Agent exceeded maximum processing loops (${MAX_AGENT_LOOPS})`,
        sessionId
      });

      closeSSE(res);

      return {
        success: false,
        error: 'Max loops exceeded',
        iterations: loopCount
      };
    }

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Agent execution error:');
    console.error(error);
    console.error('='.repeat(80) + '\n');

    sendSSE(res, {
      type: 'error',
      error: error.message,
      sessionId
    });

    closeSSE(res);

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Estimate token count (rough approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters for English
  return Math.ceil(text.length / 4);
}
