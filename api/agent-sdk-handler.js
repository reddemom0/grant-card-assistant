import { query } from '@anthropic-ai/claude-agent-sdk';
import * as db from '../src/database-service.js';
import { loadAgentDefinitions } from '../src/load-agents.js';
import { config } from 'dotenv';
import { agentSDKConfig, getAgentConfig, calculateCost, getCacheStats } from '../config/agent-sdk-config.js';
import { filesAPI } from '../src/anthropic-client.js';

config();

// Load all agent definitions from .claude/agents/*.md files
const agentDefinitions = loadAgentDefinitions();
console.log('✅ Loaded agent definitions:', Object.keys(agentDefinitions));

/**
 * Format conversation history for Agent SDK
 * Converts database messages to Claude API format with proper roles
 * @param {array} messages - Messages from database
 * @param {number} limit - Maximum number of messages to include
 * @returns {string} Formatted conversation history
 */
function formatConversationHistory(messages, limit = 10) {
  if (!messages || messages.length === 0) {
    return '';
  }

  // Take last N messages (excluding the current user message which will be added separately)
  const recentMessages = messages.slice(-limit);

  let history = '\n\n## Previous Conversation\n\n';
  for (const msg of recentMessages) {
    if (msg.role === 'user') {
      history += `**User**: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      history += `**Assistant**: ${msg.content}\n\n`;
    }
  }

  return history;
}

/**
 * Process uploaded files for vision capabilities
 * Converts files to Claude API format with base64 encoding
 * @param {array} files - Array of file objects with {data, mimeType, filename}
 * @returns {array} Formatted image content blocks
 */
function processFiles(files) {
  if (!files || files.length === 0) {
    return [];
  }

  const imageBlocks = [];
  const visionConfig = agentSDKConfig.vision;

  for (const file of files) {
    // Check if file is an image
    if (visionConfig.supportedFormats.includes(file.mimeType)) {
      // Validate file size
      if (file.data.length > visionConfig.maxImageSize) {
        console.warn(`⚠️ Image ${file.filename} exceeds max size, skipping`);
        continue;
      }

      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.mimeType,
          data: file.data,
        },
      });
    }
  }

  return imageBlocks;
}

/**
 * Process file IDs from Files API
 * NOTE: Agent SDK does not yet support Files API document/image blocks.
 * This function prepares file information for conversation context and future use.
 * For now, vision support uses base64 encoding via processFiles().
 * @param {array} fileIds - Array of Anthropic file IDs
 * @returns {Promise<array>} File metadata for context
 */
async function processFileIds(fileIds) {
  if (!fileIds || fileIds.length === 0) {
    return [];
  }

  const fileMetadata = [];

  for (const fileId of fileIds) {
    try {
      const metadata = await filesAPI.getMetadata(fileId);
      fileMetadata.push({
        file_id: metadata.id,
        filename: metadata.filename,
        size_bytes: metadata.size_bytes,
        created_at: metadata.created_at,
      });
      console.log(`📄 Retrieved file metadata: ${metadata.filename} (${metadata.id})`);
    } catch (error) {
      console.warn(`⚠️ Failed to get metadata for file ${fileId}:`, error.message);
    }
  }

  return fileMetadata;
}

/**
 * Retry logic for API calls with exponential backoff
 * @param {function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Initial delay in ms
 * @returns {Promise} Result of function call
 */
async function retryWithBackoff(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      // Check if error is retryable
      const isRetryable =
        error.status === 429 || // Rate limit
        error.status === 500 || // Server error
        error.status === 502 || // Bad gateway
        error.status === 503 || // Service unavailable
        error.status === 504;   // Gateway timeout

      if (!isRetryable) throw error;

      const waitTime = delay * Math.pow(2, i);
      console.log(`⏳ Retry attempt ${i + 1}/${maxRetries} after ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Enhanced Agent SDK API Handler for Railway
 * Handles requests to specialized agents with full SDK feature support
 */
export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const {
      agentType,           // 'grant-card-generator', 'etg-writer', etc.
      conversationId,
      userId,
      message,
      files,               // Optional uploaded files for vision (base64)
      fileIds,             // Optional Anthropic file IDs (from Files API)
      options = {}         // Optional request-specific options
    } = req.body;

    // Validate required fields
    if (!agentType || !conversationId || !userId || !message) {
      return res.status(400).json({
        error: 'Missing required fields: agentType, conversationId, userId, message'
      });
    }

    // Validate agent type exists
    if (!agentDefinitions[agentType]) {
      return res.status(400).json({
        error: `Unknown agent type: ${agentType}. Available: ${Object.keys(agentDefinitions).join(', ')}`
      });
    }

    console.log(`🤖 Loading agent: ${agentType}`);
    console.log(`📝 Conversation: ${conversationId}`);

    // Ensure user exists in database (creates if doesn't exist)
    // userId is treated as google_id, returns user object with integer id
    const user = await db.ensureUser(userId);
    const dbUserId = user.id; // Get the integer ID for database foreign keys

    // Get or create conversation in database
    let conversation = await db.getConversation(conversationId);

    if (!conversation) {
      // Create new conversation with integer user_id
      conversation = await db.createConversation(
        conversationId,
        dbUserId,
        agentType,
        message.substring(0, 50) + '...' // Use first 50 chars as title
      );
      console.log(`✅ Created new conversation: ${conversationId}`);
    }

    // Get conversation history for context
    const conversationHistory = conversation.messages || [];
    const historyText = formatConversationHistory(
      conversationHistory,
      agentSDKConfig.conversationHistoryLimit
    );

    // Process any uploaded files for vision
    const imageBlocks = processFiles(files);
    if (imageBlocks.length > 0) {
      console.log(`🖼️ Processing ${imageBlocks.length} image(s)`);
    }

    // Process file IDs from Files API (metadata only for now)
    const fileMetadata = await processFileIds(fileIds);
    if (fileMetadata.length > 0) {
      console.log(`📁 Processing ${fileMetadata.length} file reference(s)`);
      // Note: Files API content blocks not yet supported by Agent SDK
      // File metadata stored in conversation context for future use

      // Store file metadata in conversation context
      try {
        const existingFiles = conversation.file_context?.files || [];
        const updatedFiles = [...existingFiles, ...fileMetadata];
        await db.updateConversationFileContext(conversationId, {
          files: updatedFiles,
          last_updated: new Date().toISOString()
        });
      } catch (error) {
        console.warn('⚠️ Failed to store file metadata:', error.message);
      }
    }

    // Build enhanced prompt with conversation history
    const enhancedPrompt = historyText ? `${message}${historyText}` : message;

    // Save user message to database
    await db.saveMessage(conversationId, 'user', message);

    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let assistantResponse = '';
    let thinkingContent = '';
    let sessionId = null;
    let totalCost = 0;
    let usage = null;

    // Get agent-specific configuration
    const agentConfig = getAgentConfig(agentType);

    // Debug: Log MCP configuration
    console.log('🔍 MCP Servers config:', JSON.stringify(agentConfig.mcpServers, null, 2));

    try {
      // Use Agent SDK query with enhanced configuration
      const result = await retryWithBackoff(async () => {
        return query({
          prompt: enhancedPrompt,
          options: {
            // System prompt configuration
            settingSources: agentConfig.settingSources,
            systemPrompt: agentConfig.systemPrompt,

            // Agent definition
            agents: {
              [agentType]: agentDefinitions[agentType]
            },

            // Model configuration
            model: options.model || agentConfig.model,
            fallbackModel: agentConfig.fallbackModel,

            // Extended thinking
            maxThinkingTokens: options.maxThinkingTokens || agentConfig.maxThinkingTokens,

            // Conversation limits
            maxTurns: options.maxTurns || agentConfig.maxTurns,

            // Tool permissions
            allowedTools: agentConfig.allowedTools,

            // MCP servers
            mcpServers: agentConfig.mcpServers,

            // Working directory
            cwd: process.cwd(),

            // Streaming configuration
            includePartialMessages: agentConfig.includePartialMessages,

            // Permission mode
            permissionMode: agentConfig.permissionMode,

            // Auto-approve MCP tools (bypass interactive permission prompts)
            canUseTool: async (toolName, input, options) => {
              console.log(`🔐 [canUseTool] Permission check for: ${toolName}`);

              // Auto-approve all MCP Google Drive tools
              if (toolName.startsWith('mcp__google-drive__')) {
                console.log(`✅ [canUseTool] Auto-approving MCP tool: ${toolName}`);
                return {
                  behavior: 'allow',
                  updatedPermissions: options.suggestions || []
                };
              }

              // Auto-approve built-in tools
              console.log(`✅ [canUseTool] Auto-approving built-in tool: ${toolName}`);
              return {
                behavior: 'allow',
                updatedPermissions: options.suggestions || []
              };
            },

            // Beta headers for advanced features
            betas: agentConfig.betaHeaders,
          }
        });
      }, agentSDKConfig.errorHandling.maxRetries, agentSDKConfig.errorHandling.retryDelay);

      // Stream responses to client
      for await (const msg of result) {
        if (msg.type === 'assistant') {
          // Assistant message - extract text and thinking
          const content = msg.message.content;

          for (const block of content) {
            if (block.type === 'text') {
              const text = block.text;
              assistantResponse += text;

              // Stream to client
              res.write(`data: ${JSON.stringify({
                type: 'content',
                text: text
              })}\n\n`);
            } else if (block.type === 'thinking') {
              // Extended thinking content
              thinkingContent += block.thinking;

              if (agentConfig.includeThinking) {
                res.write(`data: ${JSON.stringify({
                  type: 'thinking',
                  text: block.thinking
                })}\n\n`);
              }
            }
          }
        } else if (msg.type === 'result') {
          // Final result message with usage stats
          sessionId = msg.session_id;
          totalCost = msg.total_cost_usd;
          usage = msg.usage;

          // Calculate detailed cost breakdown
          const calculatedCost = calculateCost(usage);
          const cacheStats = getCacheStats(usage);

          console.log(`✅ Session complete: ${sessionId}`);
          console.log(`💰 Cost: $${totalCost.toFixed(4)} (calculated: $${calculatedCost.toFixed(4)})`);
          console.log(`📊 Tokens - Input: ${usage.input_tokens}, Output: ${usage.output_tokens}`);
          console.log(`🗄️ Cache - Read: ${cacheStats.cacheReadTokens}, Write: ${cacheStats.cacheWriteTokens}`);
          console.log(`⚡ Cache Efficiency: ${cacheStats.cacheEfficiency.toFixed(1)}%`);

          if (thinkingContent) {
            console.log(`🧠 Thinking tokens used: ${thinkingContent.length} chars`);
          }

          // Dump MCP server log for debugging
          try {
            const fs = await import('fs');
            const mcpLogPath = '/tmp/mcp-server-debug.log';
            if (fs.existsSync(mcpLogPath)) {
              const mcpLog = fs.readFileSync(mcpLogPath, 'utf-8');
              console.log('📋 === MCP SERVER LOG ===');
              console.log(mcpLog);
              console.log('📋 === END MCP LOG ===');
            } else {
              console.log('⚠️ MCP log file not found at /tmp/mcp-server-debug.log');
            }
          } catch (err) {
            console.log(`⚠️ Error reading MCP log: ${err.message}`);
          }
        } else if (msg.type === 'system' && msg.subtype === 'init') {
          // System initialization message
          console.log(`🚀 Agent initialized`);
          console.log(`🛠️ Tools: ${msg.tools.join(', ')}`);
          console.log(`📦 Model: ${msg.model}`);
        } else if (msg.type === 'stream_event') {
          // Partial message events (tool use, etc.)
          if (msg.event.type === 'content_block_start' && msg.event.content_block?.type === 'tool_use') {
            const toolName = msg.event.content_block.name;
            console.log(`🔧 Using tool: ${toolName}`);

            res.write(`data: ${JSON.stringify({
              type: 'tool_use',
              tool: toolName
            })}\n\n`);
          }
        }
      }

      // Save assistant response to database
      await db.saveMessage(conversationId, 'assistant', assistantResponse);

      // Update conversation title if it's still the default
      if (conversation.title && conversation.title.endsWith('...')) {
        // Generate better title from first exchange
        const newTitle = assistantResponse.substring(0, 50).trim() + '...';
        await db.updateConversationTitle(conversationId, newTitle);
      }

      const duration = Date.now() - startTime;

      // Send completion event with comprehensive stats
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        sessionId,
        cost: totalCost,
        usage,
        cacheStats: getCacheStats(usage),
        duration,
        messageCount: conversationHistory.length + 2, // +2 for current exchange
      })}\n\n`);

      res.end();

    } catch (error) {
      console.error('❌ Agent SDK error:', error);

      // Send detailed error information
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message,
        code: error.status || 'UNKNOWN',
        retryable: [429, 500, 502, 503, 504].includes(error.status)
      })}\n\n`);

      res.end();
    }

  } catch (error) {
    console.error('❌ Handler error:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}
