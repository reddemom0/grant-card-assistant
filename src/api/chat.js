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
import { generateAndSaveTitle } from '../utils/conversation-titles.js';
import { filesAPI } from '../anthropic-client.js';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

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
      message: rawMessage,
      conversationId,
      attachments = []
    } = req.body;

    // Get userId from authenticated user (set by middleware), not from request body
    const userId = req.user?.id || null;

    // ============================================================================
    // 1. Validate required fields
    // ============================================================================

    if (!agentType) {
      return res.status(400).json({
        error: 'Missing required field: agentType'
      });
    }

    // Message is required unless there are attachments
    if ((!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) && attachments.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid required field: message (message or attachments required)'
      });
    }

    // If no message but has attachments, use a default message
    const message = (!rawMessage || rawMessage.trim().length === 0)
      ? 'Analyze the attached document(s).'
      : rawMessage;

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
    console.log(`✓ ConversationId provided: ${conversationId ? conversationId : 'null (new conversation)'}`);

    // ============================================================================
    // 2. Get or create conversation
    // ============================================================================

    let convId = conversationId;
    let isNewConversation = false;

    // Get userId from authenticated user (set by middleware)
    // If no user is authenticated, use null (anonymous)
    const effectiveUserId = req.user?.id || null;

    if (!convId) {
      // Create new conversation
      convId = uuidv4();
      isNewConversation = true;

      // Create conversation with placeholder title (will be updated with smart title)
      const placeholderTitle = message.substring(0, 60).trim() + (message.length > 60 ? '...' : '');
      await createConversation(convId, effectiveUserId, agentType, placeholderTitle);

      console.log(`✓ New conversation created: ${convId} (user: ${req.user?.email || 'anonymous'})`);

      // Generate smart title asynchronously (don't await - happens in background)
      generateAndSaveTitle(convId, message, agentType).catch(err => {
        console.error('Failed to generate smart title:', err);
      });
    } else {
      // Check if conversation exists, create if it doesn't
      const conversation = await getConversation(convId);

      if (!conversation) {
        // Conversation ID provided but doesn't exist - create it
        console.log(`📝 Creating new conversation with provided ID: ${convId}`);
        const placeholderTitle = `New ${agentType} Chat`;
        await createConversation(convId, effectiveUserId, agentType, placeholderTitle);

        console.log(`✓ New conversation created: ${convId} (user: ${req.user?.email || 'anonymous'})`);

        // Generate smart title asynchronously
        generateAndSaveTitle(convId, message, agentType).catch(err => {
          console.error('Failed to generate smart title:', err);
        });
      } else {
        // Conversation exists - verify agent type matches
        if (conversation.agent_type !== agentType) {
          console.warn(
            `⚠️  Agent type mismatch: conversation=${conversation.agent_type}, request=${agentType}`
          );
        }

        console.log(`✓ Existing conversation: ${convId}`);
      }
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
      } else if (attachment.type === 'document') {
        // Handle document attachments (TXT, VTT, DOCX, XLSX)
        const mimeType = attachment.mimeType || 'text/plain';

        // XLSX files: Convert to CSV and send as text (much simpler than Files API)
        if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
          try {
            console.log('📊 Converting XLSX to CSV for Claude...');

            // Convert base64 to Buffer
            const fileBuffer = Buffer.from(attachment.data, 'base64');

            // Parse XLSX file
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

            // Convert all sheets to CSV
            let csvContent = '';
            const sheetNames = workbook.SheetNames;

            if (sheetNames.length > 1) {
              // Multiple sheets - include sheet names as headers
              sheetNames.forEach((sheetName, index) => {
                if (index > 0) csvContent += '\n\n';
                csvContent += `=== Sheet: ${sheetName} ===\n`;
                const worksheet = workbook.Sheets[sheetName];
                csvContent += XLSX.utils.sheet_to_csv(worksheet);
              });
            } else {
              // Single sheet - just convert to CSV
              const worksheet = workbook.Sheets[sheetNames[0]];
              csvContent += XLSX.utils.sheet_to_csv(worksheet);
            }

            const filename = attachment.filename || 'spreadsheet.xlsx';

            // Send as plain text - CSV is just text, no need for Files API
            processedAttachments.push({
              type: 'csv_text',
              filename: filename,
              content: csvContent
            });

            console.log(`✓ XLSX converted to CSV (${sheetNames.length} sheet(s), ${csvContent.length} bytes)`);
          } catch (error) {
            console.error('❌ Failed to convert XLSX:', error.message);
            // Skip this attachment if conversion fails
            continue;
          }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          // DOCX files - Extract text with mammoth (Messages API doesn't support DOCX documents)
          try {
            console.log('📄 Extracting text from DOCX with mammoth...');
            const fileBuffer = Buffer.from(attachment.data, 'base64');
            const filename = attachment.filename || `document_${Date.now()}.docx`;

            // Extract text from DOCX
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            const extractedText = result.value;

            // Add as text content block
            processedAttachments.push({
              type: 'docx_text',
              filename: filename,
              content: `[Uploaded document: ${filename}]\n\n${extractedText}`
            });

            console.log(`✓ DOCX text extracted (${extractedText.length} chars from ${filename})`);
          } catch (error) {
            console.error('❌ Failed to extract DOCX text:', error.message);
            continue;
          }
        } else {
          // TXT, VTT, CSV, MD and other text files - Read as plain text
          // Messages API doesn't support these via Files API, send as text content
          try {
            const fileBuffer = Buffer.from(attachment.data, 'base64');
            const filename = attachment.filename || `document_${Date.now()}.txt`;
            const textContent = fileBuffer.toString('utf-8');

            console.log(`📄 Reading text file: ${filename} (${mimeType})`);

            processedAttachments.push({
              type: 'text_file',
              filename: filename,
              content: `[Uploaded file: ${filename}]\n\n${textContent}`
            });

            console.log(`✓ Text file processed (${textContent.length} chars from ${filename})`);
          } catch (error) {
            console.error(`❌ Failed to read text file:`, error.message);
            continue;
          }
        }
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
    const userId = req.user?.id;

    console.log(`\n🔍 Loading conversation: ${id} for user ${userId}`);

    const conversation = await getConversation(id);

    if (!conversation) {
      console.log(`❌ Conversation not found: ${id}`);
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get conversation's user_id (Postgres returns snake_case)
    const conversationUserId = conversation.user_id || conversation.userId;

    console.log(`🔍 Conversation belongs to user: ${conversationUserId} (type: ${typeof conversationUserId})`);
    console.log(`🔍 Current user: ${userId} (type: ${typeof userId})`);

    // Allow any authenticated user to view conversations (for sharing)
    // No authorization check - if you have the link and are logged in, you can view it
    console.log(`✅ Allowing access to conversation ${id} for user ${userId} (sharing enabled)`);


    // Load messages for this conversation
    const { getConversationMessages } = await import('../database/messages.js');
    const messages = await getConversationMessages(id);

    console.log(`✅ Loaded conversation ${id} with ${messages.length} messages`);

    // Return conversation with messages
    res.json({
      ...conversation,
      messages,
      messageCount: messages.length
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * List conversations endpoint handler
 * GET /api/conversations?agentType=xxx
 */
export async function handleListConversations(req, res) {
  try {
    // Get userId from authenticated session
    const userId = req.user?.id;

    console.log(`\n📋 Listing conversations for user: ${userId}`);

    if (!userId) {
      console.log('❌ No userId found in session');
      return res.status(401).json({
        error: 'Unauthorized: Please log in'
      });
    }

    const { agentType } = req.query;
    console.log(`📋 Agent filter: ${agentType || 'all'}`);

    const { listConversations } = await import('../database/messages.js');
    const conversations = await listConversations(userId, agentType);

    console.log(`✅ Found ${conversations.length} conversations for user ${userId}`);

    // Transform snake_case to camelCase for frontend
    const formattedConversations = conversations.map(conv => ({
      id: conv.id,
      title: conv.title || 'New Conversation',
      agentType: conv.agent_type,
      messageCount: parseInt(conv.message_count || 0),
      createdAt: conv.created_at,
      updatedAt: conv.updated_at || conv.last_message_at || conv.created_at,
      lastMessageAt: conv.last_message_at
    }));

    res.json({
      count: formattedConversations.length,
      conversations: formattedConversations
    });
  } catch (error) {
    console.error('❌ List conversations error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: error.message || 'Failed to list conversations' });
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
