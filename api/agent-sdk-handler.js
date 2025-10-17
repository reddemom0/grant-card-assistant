import { query } from '@anthropic-ai/claude-agent-sdk';
import * as db from '../src/database-service.js';
import { loadAgentDefinitions } from '../src/load-agents.js';
import { config } from 'dotenv';

config();

// Load all agent definitions from .claude/agents/*.md files
const agentDefinitions = loadAgentDefinitions();
console.log('✅ Loaded agent definitions:', Object.keys(agentDefinitions));

/**
 * Agent SDK API Handler for Railway
 * Handles requests to specialized agents using Agent SDK
 */
export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      agentType,           // 'grant-card-generator', 'etg-writer', etc.
      conversationId,
      userId,
      message,
      files                // Optional uploaded files
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

    // Get or create conversation in database
    let conversation = await db.getConversation(conversationId);

    if (!conversation) {
      // Create new conversation
      conversation = await db.createConversation(
        conversationId,
        userId,
        agentType,
        message.substring(0, 50) + '...' // Use first 50 chars as title
      );
      console.log(`✅ Created new conversation: ${conversationId}`);
    }

    // Save user message to database
    await db.saveMessage(conversationId, 'user', message);

    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let assistantResponse = '';
    let sessionId = null;
    let totalCost = 0;
    let usage = null;

    try {
      // Use Agent SDK query with the specific agent loaded programmatically
      const result = query({
        prompt: message,
        options: {
          settingSources: ['project'],  // Load .claude/CLAUDE.md
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code'         // Use Claude Code system prompt
          },
          // CRITICAL: Define agents programmatically (not auto-loaded from filesystem)
          agents: {
            [agentType]: agentDefinitions[agentType]
          },
          maxTurns: 10,
          model: 'claude-3-5-sonnet-20241022',
          cwd: process.cwd(),
          // TODO: Add MCP servers for Google Drive
          // mcpServers: {
          //   'google-drive': { ... }
          // }
        }
      });

      // Stream responses to client
      for await (const msg of result) {
        if (msg.type === 'assistant') {
          // Assistant message - extract text
          const content = msg.message.content;
          if (content && content[0] && content[0].type === 'text') {
            const text = content[0].text;
            assistantResponse += text;

            // Stream to client
            res.write(`data: ${JSON.stringify({
              type: 'content',
              text: text
            })}\n\n`);
          }
        } else if (msg.type === 'result') {
          // Final result message
          sessionId = msg.session_id;
          totalCost = msg.total_cost_usd;
          usage = msg.usage;

          console.log(`✅ Session complete: ${sessionId}`);
          console.log(`📊 Cost: $${totalCost.toFixed(4)}`);
          console.log(`📈 Tokens - Input: ${usage.input_tokens}, Output: ${usage.output_tokens}`);
        } else if (msg.type === 'system' && msg.subtype === 'init') {
          // System initialization message
          console.log(`🚀 Agent initialized with tools:`, msg.tools);
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

      // Send completion event
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        sessionId,
        cost: totalCost,
        usage
      })}\n\n`);

      res.end();

    } catch (error) {
      console.error('❌ Agent SDK error:', error);

      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message
      })}\n\n`);

      res.end();
    }

  } catch (error) {
    console.error('❌ Handler error:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
}
