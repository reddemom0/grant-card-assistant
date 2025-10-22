/**
 * Message Operations
 *
 * Database operations for conversation messages:
 * - Save messages
 * - Retrieve conversation history
 * - Manage conversation metadata
 */

import { query } from './connection.js';

/**
 * Save a message to the database
 * @param {string} conversationId - UUID of the conversation
 * @param {string} role - Message role ('user' or 'assistant')
 * @param {*} content - Message content (will be JSON stringified)
 * @returns {Promise<Object>} Saved message record
 */
export async function saveMessage(conversationId, role, content) {
  try {
    // Stringify content if it's not already a string
    const contentStr = typeof content === 'string'
      ? content
      : JSON.stringify(content);

    const result = await query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, role, content, created_at`,
      [conversationId, role, contentStr]
    );

    console.log(`✓ Message saved: ${role} message for conversation ${conversationId}`);

    return result.rows[0];
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Get all messages for a conversation
 * @param {string} conversationId - UUID of the conversation
 * @returns {Promise<Array>} Array of messages in Claude API format
 */
export async function getConversationMessages(conversationId) {
  try {
    const result = await query(
      `SELECT role, content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );

    // Parse content JSON and format for Claude API
    const messages = result.rows.map(row => {
      let content;

      try {
        // Try to parse as JSON
        content = JSON.parse(row.content);

        // Filter out thinking blocks (they require a signature field we don't have)
        if (Array.isArray(content)) {
          content = content.filter(block => block.type !== 'thinking');
        }
      } catch (e) {
        // If not valid JSON, treat as plain text
        content = row.content;
      }

      return {
        role: row.role,
        content: content
      };
    });

    console.log(`✓ Retrieved ${messages.length} messages for conversation ${conversationId}`);

    return messages;
  } catch (error) {
    console.error('Error retrieving messages:', error);
    throw error;
  }
}

/**
 * Get conversation metadata
 * @param {string} conversationId - UUID of the conversation
 * @returns {Promise<Object|null>} Conversation metadata or null
 */
export async function getConversation(conversationId) {
  try {
    console.log(`🔍 Looking up conversation: ${conversationId}`);
    const result = await query(
      `SELECT c.*,
              COUNT(m.id) as message_count,
              MAX(m.created_at) as last_message_at
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [conversationId]
    );

    console.log(`🔍 Query result: found ${result.rows.length} rows`);

    if (result.rows.length === 0) {
      console.log(`❌ Conversation not found: ${conversationId}`);
      return null;
    }

    console.log(`✓ Found conversation: ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error retrieving conversation:', error);
    throw error;
  }
}

/**
 * Create a new conversation
 * @param {string} conversationId - UUID of the conversation (optional, will generate if not provided)
 * @param {string} userId - UUID of the user
 * @param {string} agentType - Type of agent
 * @param {string} title - Conversation title (optional)
 * @returns {Promise<Object>} Created conversation record
 */
export async function createConversation(conversationId, userId, agentType, title = null) {
  try {
    console.log(`🔍 Creating conversation: id=${conversationId}, userId=${userId}, agentType=${agentType}, title=${title}`);
    console.log(`🔍 userId type: ${typeof userId}, value: ${JSON.stringify(userId)}`);

    const result = await query(
      `INSERT INTO conversations (id, user_id, agent_type, title)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [conversationId, userId, agentType, title]
    );

    console.log(`✓ Conversation created: ${conversationId} (${agentType})`);

    return result.rows[0];
  } catch (error) {
    // Check if conversation already exists
    if (error.code === '23505') { // unique_violation
      console.log(`✓ Conversation already exists: ${conversationId}`);
      const existing = await getConversation(conversationId);
      return existing;
    }

    console.error('❌ Error creating conversation:', error);
    console.error('   conversationId:', conversationId);
    console.error('   userId:', userId, typeof userId);
    console.error('   agentType:', agentType);
    console.error('   title:', title);
    throw error;
  }
}

/**
 * List conversations for a user
 * @param {string} userId - UUID of the user
 * @param {string|null} agentType - Optional filter by agent type
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Array of conversations
 */
export async function listConversations(userId, agentType = null, limit = 50) {
  try {
    let queryText = `
      SELECT c.*,
             COUNT(m.id) as message_count,
             MAX(m.created_at) as last_message_at
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = $1
    `;
    const params = [userId];

    if (agentType) {
      params.push(agentType);
      queryText += ` AND c.agent_type = $${params.length}`;
    }

    queryText += `
      GROUP BY c.id
      ORDER BY MAX(m.created_at) DESC NULLS LAST, c.created_at DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await query(queryText, params);

    console.log(`✓ Retrieved ${result.rows.length} conversations for user ${userId}`);

    return result.rows;
  } catch (error) {
    console.error('Error listing conversations:', error);
    throw error;
  }
}

/**
 * Delete a conversation and all its messages
 * @param {string} conversationId - UUID of the conversation
 * @param {string} userId - UUID of the user (for authorization)
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteConversation(conversationId, userId) {
  try {
    // First verify ownership
    const conversation = await getConversation(conversationId);

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (conversation.user_id !== userId) {
      throw new Error('Unauthorized: User does not own this conversation');
    }

    // Delete conversation (messages will cascade delete)
    await query(
      'DELETE FROM conversations WHERE id = $1',
      [conversationId]
    );

    console.log(`✓ Conversation deleted: ${conversationId}`);

    return true;
  } catch (error) {
    console.error('Error deleting conversation:', error);
    throw error;
  }
}

/**
 * Update conversation title
 * @param {string} conversationId - UUID of the conversation
 * @param {string} title - New title
 * @returns {Promise<Object>} Updated conversation
 */
export async function updateConversationTitle(conversationId, title) {
  try {
    const result = await query(
      `UPDATE conversations
       SET title = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [title, conversationId]
    );

    if (result.rows.length === 0) {
      throw new Error('Conversation not found');
    }

    console.log(`✓ Conversation title updated: ${conversationId}`);

    return result.rows[0];
  } catch (error) {
    console.error('Error updating conversation title:', error);
    throw error;
  }
}

/**
 * Get message count for a conversation
 * @param {string} conversationId - UUID of the conversation
 * @returns {Promise<number>} Number of messages
 */
export async function getMessageCount(conversationId) {
  try {
    const result = await query(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1',
      [conversationId]
    );

    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Error getting message count:', error);
    throw error;
  }
}
