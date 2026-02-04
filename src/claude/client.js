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
    // 2.6. Get query-specific configuration (NEW: Performance Optimization)
    // ============================================================================

    const queryConfig = forceModel
      ? getQueryConfigForModel(forceModel, modelConfig)
      : getQueryConfig(message, agentType);
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
      getCompactionSummary,
      saveCompactionSummary,
      deleteOldMessages
    } = await import('../database/messages.js');

    // Get max turns for this agent (cost optimization)
    const maxTurns = getMaxTurnsForAgent(agentType);
    const maxMessages = maxTurns * 2; // Each turn = user + assistant message

    let history = await getConversationMessages(conversationId, maxMessages);
    console.log(`✓ Loaded ${history.length} previous messages (max: ${maxMessages})`);

    // ============================================================================
    // 3.5. AUTO-COMPACTION: Check if conversation needs summarization
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
      } else if (attachment.type === 'document') {
        // Other documents (DOCX, TXT, VTT) use file_id from Files API
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
      const fullResponse = await streamToSSE(stream, res, sessionId);

      console.log(`✓ Response received - stop_reason: ${fullResponse.stop_reason}`);

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
        const { saveMessage } = await import('../database/messages.js');
        await saveMessage(conversationId, 'user', userContent);
        await saveMessage(conversationId, 'assistant', contentToSave);

        console.log('✓ Messages saved to database');

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
        // NOTE: Thinking blocks MUST be kept in both conversation history AND database
        // (Claude API requirement when extended thinking is enabled - context needed across turns)
        const cleanedContent = fullResponse.content
          .filter(block => {
            // Remove empty text blocks that would cause API errors
            if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
              return false;
            }
            return true;
          })
          .map(block => {
            const { index, ...cleanBlock} = block;
            return cleanBlock;
          });

        // Add assistant response to messages
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
        const { saveMessage } = await import('../database/messages.js');
        const contentToSave = fullResponse.content.filter(block => {
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });
        await saveMessage(conversationId, 'user', userContent);
        await saveMessage(conversationId, 'assistant', contentToSave);

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

        const { saveMessage } = await import('../database/messages.js');
        const contentToSave = fullResponse.content.filter(block => {
          if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
            return false;
          }
          return true;
        });
        await saveMessage(conversationId, 'user', userContent);
        await saveMessage(conversationId, 'assistant', contentToSave);

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
