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
import { executeToolCall } from '../tools/executor.js';
import { getToolsForAgent } from '../tools/definitions.js';
import { streamToSSE, setupSSE, closeSSE, sendSSE } from './streaming.js';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configuration
const MAX_AGENT_LOOPS = 20; // Safety limit to prevent infinite loops
const MODEL = 'claude-sonnet-4-20250514'; // Latest Sonnet 4.5 model
const MAX_TOKENS = 16000; // Must be > thinking budget
const THINKING_BUDGET = 10000; // Tokens for extended thinking

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
 * @returns {Promise<Object>} Execution result
 */
export async function runAgent({
  agentType,
  message,
  conversationId,
  userId,
  sessionId,
  attachments = [],
  res
}) {
  console.log('\n' + '='.repeat(80));
  console.log(`🤖 Running agent: ${agentType}`);
  console.log(`📝 Conversation: ${conversationId}`);
  console.log(`👤 User: ${userId}`);
  console.log(`🔑 Session: ${sessionId}`);
  console.log('='.repeat(80) + '\n');

  // Setup SSE headers
  setupSSE(res);

  // Send connection confirmation
  sendSSE(res, {
    type: 'connected',
    sessionId,
    conversationId,
    agentType
  });

  try {
    // ============================================================================
    // 1. Load agent prompt
    // ============================================================================

    console.log(`📋 Loading agent prompt for: ${agentType}`);
    let systemPrompt = loadAgentPromptCached(agentType);
    console.log(`✓ Agent prompt loaded (${systemPrompt.length} characters)`);

    // ============================================================================
    // 2. Load conversation memories
    // ============================================================================

    console.log(`🧠 Loading conversation memories...`);
    const memories = await loadConversationMemories(conversationId);
    if (memories) {
      systemPrompt += memories;
      const memoryCount = memories.split('\n').length - 2; // Subtract header lines
      console.log(`✓ Loaded ${memoryCount} memories into context`);
    } else {
      console.log(`✓ No memories found for this conversation`);
    }

    // ============================================================================
    // 3. Load conversation history from database
    // ============================================================================

    console.log(`💬 Loading conversation history...`);
    const { getConversationMessages } = await import('../database/messages.js');
    const history = await getConversationMessages(conversationId);
    console.log(`✓ Loaded ${history.length} previous messages`);

    // ============================================================================
    // 4. Build user message with attachments
    // ============================================================================

    const userContent = [];

    // Add attachments (images/PDFs) - these go first
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
      }
    }

    // Add text message
    userContent.push({
      type: 'text',
      text: message
    });

    // Build messages array
    let messages = [
      ...history,
      { role: 'user', content: userContent }
    ];

    console.log(`✓ Message constructed with ${attachments.length} attachments`);

    // ============================================================================
    // 5. Get tools for this agent
    // ============================================================================

    const tools = getToolsForAgent(agentType);
    console.log(`🔧 Loaded ${tools.length} tools for agent`);

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

      const stream = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,

        // System prompt with caching
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ],

        messages,
        tools,

        // Extended thinking enabled - separates reasoning from response
        thinking: {
          type: 'enabled',
          budget_tokens: THINKING_BUDGET
        },

        // Enable streaming
        stream: true
      }, {
        // Beta headers for web fetch tool, interleaved thinking, and memory tool
        headers: {
          'anthropic-beta': 'web-fetch-2025-09-10,interleaved-thinking-2025-05-14,context-management-2025-06-27'
        }
      });

      // Stream response to frontend and collect full response
      const fullResponse = await streamToSSE(stream, res, sessionId);

      console.log(`✓ Response received - stop_reason: ${fullResponse.stop_reason}`);

      // ============================================================================
      // Handle stop reason
      // ============================================================================

      // CASE 1: Normal completion (end_turn)
      if (fullResponse.stop_reason === 'end_turn') {
        console.log('✅ Agent completed successfully (end_turn)');

        // Filter out thinking blocks from assistant content before saving
        // This prevents empty messages that would cause API errors on next request
        const contentToSave = Array.isArray(fullResponse.content)
          ? fullResponse.content.filter(block => block.type !== 'thinking' && block.type !== 'redacted_thinking')
          : fullResponse.content;

        // Only save if there's actual content (not just thinking blocks)
        if (Array.isArray(contentToSave) && contentToSave.length === 0) {
          console.log('⚠️  Agent response contained only thinking blocks - not saving empty message');
          console.log('   This typically happens when the agent uses memory_store as the final action');

          // Close SSE but don't save empty assistant message
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

        // Clean content blocks: remove index field from all blocks
        const cleanedContent = fullResponse.content
          .map(block => {
            const { index, ...cleanBlock } = block;
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

        // Save what we have
        const { saveMessage } = await import('../database/messages.js');
        await saveMessage(conversationId, 'user', userContent);
        await saveMessage(conversationId, 'assistant', fullResponse.content);

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
        await saveMessage(conversationId, 'user', userContent);
        await saveMessage(conversationId, 'assistant', fullResponse.content);

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
