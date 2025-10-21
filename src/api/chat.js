/**
 * Chat API Endpoint Handler
 *
 * Handles POST /api/chat requests for agent conversations.
 * Validates input, creates/manages conversations, and runs agents.
 */

import { v4 as uuidv4 } from 'uuid';
import { runAgent } from '../claude/client.js';
import { createConversation, getConversation } from '../database/messages.js';
import { isValidAgentType, getAvailableAgents } from '../agents/load-agents.js';

/**
 * Main chat endpoint handler
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export async function handleChatRequest(req, res) {
  console.log('\n' + '█'.repeat(80));
  console.log('📬 Incoming chat request');
  console.log('█'.repeat(80));

  try {
    const {
      agentType,
      message,
      conversationId,
      userId,
      attachments = []
    } = req.body;

    // ============================================================================
    // 1. Validate required fields
    // ============================================================================

    if (!agentType) {
      return res.status(400).json({
        error: 'Missing required field: agentType'
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid required field: message'
      });
    }

    // Validate agent type exists
    if (!isValidAgentType(agentType)) {
      return res.status(400).json({
        error: `Invalid agent type: ${agentType}`,
        available: getAvailableAgents()
      });
    }

    console.log(`✓ Agent type: ${agentType}`);
    console.log(`✓ Message length: ${message.length} characters`);
    console.log(`✓ Attachments: ${attachments.length}`);

    // ============================================================================
    // 2. Get or create conversation
    // ============================================================================

    let convId = conversationId;
    let isNewConversation = false;

    if (!convId) {
      // Create new conversation
      convId = uuidv4();
      isNewConversation = true;

      // Use userId or null for anonymous users
      // userId must be a valid UUID if provided
      const effectiveUserId = userId && userId !== 'anonymous' ? userId : null;

      // Generate title from first message
      const title = message.substring(0, 100);

      await createConversation(convId, effectiveUserId, agentType, title);

      console.log(`✓ New conversation created: ${convId} (user: ${effectiveUserId || 'anonymous'})`);
    } else {
      // Verify existing conversation
      const conversation = await getConversation(convId);

      if (!conversation) {
        return res.status(404).json({
          error: `Conversation not found: ${convId}`
        });
      }

      // Optionally verify agent type matches
      if (conversation.agent_type !== agentType) {
        console.warn(
          `⚠️  Agent type mismatch: conversation=${conversation.agent_type}, request=${agentType}`
        );
      }

      console.log(`✓ Existing conversation: ${convId}`);
    }

    // ============================================================================
    // 3. Process attachments
    // ============================================================================

    const processedAttachments = [];

    for (const attachment of attachments) {
      if (!attachment.type || !attachment.data) {
        console.warn('⚠️  Invalid attachment format, skipping');
        continue;
      }

      // Validate attachment types
      if (attachment.type === 'image') {
        if (!attachment.mimeType) {
          console.warn('⚠️  Image attachment missing mimeType, skipping');
          continue;
        }

        processedAttachments.push({
          type: 'image',
          mimeType: attachment.mimeType,
          data: attachment.data // Should be base64
        });

        console.log(`✓ Image attachment: ${attachment.mimeType}`);
      } else if (attachment.type === 'pdf') {
        processedAttachments.push({
          type: 'pdf',
          mimeType: 'application/pdf',
          data: attachment.data // Should be base64
        });

        console.log(`✓ PDF attachment`);
      } else {
        console.warn(`⚠️  Unknown attachment type: ${attachment.type}, skipping`);
      }
    }

    // ============================================================================
    // 4. Generate session ID for this request
    // ============================================================================

    const sessionId = uuidv4();

    console.log(`✓ Session ID: ${sessionId}`);

    // ============================================================================
    // 5. Set up SSE headers (done in runAgent, but prepare here)
    // ============================================================================

    // Note: SSE headers will be set by the streaming handler in runAgent

    // ============================================================================
    // 6. Run agent
    // ============================================================================

    console.log('🚀 Starting agent execution...');
    console.log('─'.repeat(80));

    await runAgent({
      agentType,
      message,
      conversationId: convId,
      userId: userId || null,
      sessionId,
      attachments: processedAttachments,
      res
    });

    // Note: runAgent handles the response streaming and closing

  } catch (error) {
    console.error('\n' + '█'.repeat(80));
    console.error('❌ Chat request error:');
    console.error(error);
    console.error('█'.repeat(80) + '\n');

    // If headers not sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    } else {
      // Headers already sent (SSE started), send error event
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message
      })}\n\n`);
      res.end();
    }
  }
}

/**
 * Get conversation endpoint handler
 * GET /api/conversations/:id
 */
export async function handleGetConversation(req, res) {
  try {
    const { id } = req.params;

    const conversation = await getConversation(id);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * List conversations endpoint handler
 * GET /api/conversations?userId=xxx&agentType=xxx
 */
export async function handleListConversations(req, res) {
  try {
    const { userId, agentType } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'Missing required query parameter: userId'
      });
    }

    const { listConversations } = await import('../database/messages.js');
    const conversations = await listConversations(userId, agentType);

    res.json({
      count: conversations.length,
      conversations
    });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Delete conversation endpoint handler
 * DELETE /api/conversations/:id
 */
export async function handleDeleteConversation(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'Missing required field: userId'
      });
    }

    const { deleteConversation } = await import('../database/messages.js');
    await deleteConversation(id, userId);

    res.json({
      success: true,
      message: 'Conversation deleted'
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: error.message });
  }
}
