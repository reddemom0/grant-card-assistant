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
 * @param {number} maxMessages - Maximum number of messages to retrieve (default: 60 = 30 turns)
 * @returns {Promise<Array>} Array of messages in Claude API format
 */
/**
 * Retrieve conversation messages for lead-gen agent from lead_gen_conversations.messages JSONB
 * @param {string} sessionId - lead_gen_conversations.session_id (same as conversationId)
 * @param {number} maxMessages - Maximum number of messages to retrieve
 * @returns {Array} Array of {role, content} objects formatted for Claude API
 */
export async function getLeadGenMessages(sessionId, maxMessages = 60) {
  try {
    const result = await query(
      `SELECT messages FROM lead_gen_conversations WHERE session_id = $1`,
      [sessionId]
    );

    if (!result.rows.length || !result.rows[0].messages) {
      console.log(`✓ No messages found in lead_gen_conversations for session ${sessionId}`);
      return [];
    }

    // messages is a JSONB array: [{role, content, timestamp}, ...]
    const messagesArray = result.rows[0].messages;

    // Take the most recent N messages
    const recentMessages = messagesArray.slice(-maxMessages);

    // Convert to Claude API format: {role, content: [{type: 'text', text: '...'}]}
    // DEFENSIVE: Filter out empty/whitespace-only text content to prevent API errors
    const formattedMessages = recentMessages
      .map(msg => {
        // If content is empty or whitespace-only, skip this message
        if (!msg.content || msg.content.trim().length === 0) {
          console.warn(`⚠️  Skipping message with empty content in session ${sessionId}`);
          return null;
        }

        return {
          role: msg.role,
          content: [{
            type: 'text',
            text: msg.content
          }]
        };
      })
      .filter(msg => msg !== null); // Remove null entries

    console.log(`✓ Retrieved ${formattedMessages.length} messages from lead_gen_conversations for session ${sessionId}`);
    return formattedMessages;

  } catch (error) {
    console.error(`Error retrieving lead-gen messages for session ${sessionId}:`, error);
    return [];
  }
}

function pruneLeadingOrphans(messages) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    const hasToolResult = Array.isArray(msg.content) &&
      msg.content.some(b => b && b.type === 'tool_result');

    if (!hasToolResult) {
      if (i > 0) {
        console.log(`⚠️  Dropping ${i} leading message(s) to avoid orphan tool_result at head of window`);
      }
      return messages.slice(i);
    }
  }

  console.warn('⚠️  No clean user message found in window — returning empty history');
  return [];
}

/**
 * @security SYSTEM-ONLY — does NOT enforce ownership.
 * Do not call from request handlers. Use getConversationMessagesForUser()
 * anywhere a verified session exists. Legitimate callers are system paths with
 * no user context: the agent loop history load (src/claude/client.js), CLI
 * scripts, and unit tests.
 */
export async function getConversationMessages(conversationId, maxMessages = 60) {
  try {
    // Retrieve the most recent N messages
    // Use subquery to get latest messages, then re-order for Claude API (oldest first)
    const result = await query(
      `SELECT role, content, created_at
       FROM (
         SELECT role, content, created_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       ) recent_messages
       ORDER BY created_at ASC`,
      [conversationId, maxMessages]
    );

    // Parse content JSON and format for Claude API
    const messages = result.rows
      .map(row => {
        let content;

        try {
          // Try to parse as JSON
          content = JSON.parse(row.content);

          // Clean content blocks
          if (Array.isArray(content)) {
            content = content
              .map(block => {
                // Remove index field (added by streaming but not accepted by Claude API)
                const { index, ...cleanBlock } = block;

                // Fix server_tool_use blocks: ensure input is an object, not a string
                if (cleanBlock.type === 'server_tool_use' && typeof cleanBlock.input === 'string') {
                  try {
                    cleanBlock.input = JSON.parse(cleanBlock.input);
                  } catch (e) {
                    console.error('Failed to parse server_tool_use input:', e);
                    cleanBlock.input = {};
                  }
                }

                return cleanBlock;
              })
              // Filter out blocks that cause issues when reloaded from database
              // These are not needed for conversation continuity:
              // - thinking/redacted_thinking: Extended thinking blocks
              // - server_tool_use/web_fetch_tool_result/web_search_tool_result: Server-side tool execution (already processed)
              .filter(block =>
                block.type !== 'thinking' &&
                block.type !== 'redacted_thinking' &&
                block.type !== 'server_tool_use' &&
                block.type !== 'web_fetch_tool_result' &&
                block.type !== 'web_search_tool_result'
              );
          }
        } catch (e) {
          // If not valid JSON, treat as plain text
          content = row.content;
        }

        return {
          role: row.role,
          content: content
        };
      })
      // Filter out messages with empty content arrays
      // This can happen when a message contained only thinking blocks
      .filter(msg => {
        if (Array.isArray(msg.content) && msg.content.length === 0) {
          console.log(`⚠️  Skipping message with empty content (likely thinking-only response)`);
          return false;
        }
        return true;
      });

    // Drop leading messages that would orphan a tool_result.
    // The Claude API requires messages[0].role === 'user' AND every tool_result
    // to have its matching tool_use in the immediately preceding message. When
    // the LIMIT slices through a tool_use/tool_result pair, the surviving
    // tool_result at the head has no preceding tool_use and the request 400s.
    // Safe re-entry point: the first user message with no tool_result blocks.
    const prunedMessages = pruneLeadingOrphans(messages);

    const totalMessagesQuery = await query(
      `SELECT COUNT(*) as total FROM messages WHERE conversation_id = $1`,
      [conversationId]
    );
    const totalMessages = parseInt(totalMessagesQuery.rows[0]?.total || 0);

    if (totalMessages > maxMessages) {
      console.log(`✓ Retrieved ${prunedMessages.length} messages (limited from ${totalMessages} total) for conversation ${conversationId}`);
    } else {
      console.log(`✓ Retrieved ${prunedMessages.length} messages for conversation ${conversationId}`);
    }

    return prunedMessages;
  } catch (error) {
    console.error('Error retrieving messages:', error);
    throw error;
  }
}

/**
 * Get conversation metadata
 *
 * @security SYSTEM-ONLY — does NOT enforce ownership.
 * Do not call from request handlers. Use getConversationForUser() anywhere a
 * verified session exists. Legitimate callers are system paths with no user
 * context: createConversation()'s unique-violation retry, deleteConversation()'s
 * ownership lookup (which enforces in JS), CLI scripts, and unit tests.
 *
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
 * Normalize a user id to a positive integer, or throw.
 * users.id is a Postgres SERIAL, but ids arrive from JSON as either number or
 * string. Callers must never be able to bypass a check by passing null.
 * @param {*} userId
 * @param {string} fnName - for the error message
 * @returns {number}
 */
function requireUserId(userId, fnName) {
  if (userId === null || userId === undefined || userId === '') {
    throw new Error(`${fnName} requires a userId from the verified session`);
  }
  const normalized = Number(userId);
  if (!Number.isInteger(normalized)) {
    throw new Error(`${fnName} received a non-integer userId: ${JSON.stringify(userId)}`);
  }
  return normalized;
}

/**
 * Get conversation metadata, scoped to the requesting user.
 *
 * Mirrors the ownership pattern in listConversations() but for a single row.
 * Conversations with a NULL owner are grandfathered in: ~1,084 rows lost their
 * owner to migration 004 (UUID -> INTEGER USING NULL) and to the fail-open auth
 * middleware, and their true owner is not recoverable from the data. Excluding
 * them would strand 574 staff conversations that still hold messages.
 *
 * @param {string} conversationId - UUID of the conversation
 * @param {number|string} userId - id from the VERIFIED session (req.user.id)
 * @returns {Promise<Object|null>} Conversation metadata, or null if it does not
 *   exist or belongs to another user
 */
export async function getConversationForUser(conversationId, userId) {
  const ownerId = requireUserId(userId, 'getConversationForUser');

  try {
    const result = await query(
      `SELECT c.*,
              COUNT(m.id) as message_count,
              MAX(m.created_at) as last_message_at
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.id = $1
         AND (c.user_id = $2 OR c.user_id IS NULL)
       GROUP BY c.id`,
      [conversationId, ownerId]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Conversation not found or not owned by user ${ownerId}: ${conversationId}`);
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('❌ Error retrieving conversation for user:', error);
    throw error;
  }
}

/**
 * Get conversation messages, scoped to the requesting user.
 *
 * Verifies ownership first, then delegates to getConversationMessages() so the
 * content post-processing (JSON parse, block filtering, orphan pruning) has a
 * single implementation.
 *
 * @param {string} conversationId - UUID of the conversation
 * @param {number|string} userId - id from the VERIFIED session (req.user.id)
 * @param {number} maxMessages - maximum messages to retrieve
 * @returns {Promise<Array|null>} Messages, or null if the conversation does not
 *   exist or belongs to another user
 */
export async function getConversationMessagesForUser(conversationId, userId, maxMessages = 60) {
  const ownerId = requireUserId(userId, 'getConversationMessagesForUser');

  const owned = await query(
    `SELECT 1 FROM conversations
     WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
    [conversationId, ownerId]
  );

  if (owned.rows.length === 0) {
    console.log(`❌ Messages denied — conversation ${conversationId} not owned by user ${ownerId}`);
    return null;
  }

  return getConversationMessages(conversationId, maxMessages);
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
  // Throws on null/undefined/non-integer rather than letting a missing id
  // slip through the comparison below.
  const requesterId = requireUserId(userId, 'deleteConversation');

  try {
    // First verify ownership. getConversation() is unscoped by design here —
    // the JS comparison below is the enforcement point.
    const conversation = await getConversation(conversationId);

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Compare as numbers: user_id comes back from pg as an INTEGER while the
    // requester id may arrive as a JSON string. A strict !== between "5" and 5
    // would reject the legitimate owner.
    const ownerId = conversation.user_id === null ? null : Number(conversation.user_id);

    // Deliberate asymmetry with reads: NULL-owner conversations are READABLE
    // (grandfathered) but never deletable, because deletion is irreversible and
    // we are actively preserving those rows until ownership can be restored.
    if (ownerId === null) {
      throw new Error('Unauthorized: Conversation has no recorded owner and cannot be deleted');
    }

    if (ownerId !== requesterId) {
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

// ============================================================================
// TOOL TRACE — post-hoc debugging of agent tool calls
// ============================================================================

/**
 * Get the full chronological tool trace for a conversation.
 *
 * Returns every content block from every message in order: tool_use calls
 * (with parameters), tool_result responses (with full content), text blocks,
 * and thinking blocks. This is the canonical way to inspect what an agent
 * did in a past conversation.
 *
 * Each entry includes the tool_use_id so callers can correlate a tool_use
 * with its corresponding tool_result.
 *
 * @param {string} conversationId - UUID of the conversation
 * @returns {Promise<Array>} Ordered array of typed entries:
 *   { type: 'tool_use', tool_name, tool_use_id, input, timestamp }
 *   { type: 'tool_result', tool_use_id, content, is_error, timestamp }
 *   { type: 'text', content, timestamp }
 *   { type: 'thinking', content, timestamp }
 */
export async function getConversationToolTrace(conversationId) {
  const result = await query(
    `SELECT role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );

  const trace = [];

  for (const row of result.rows) {
    const timestamp = row.created_at;
    const role = row.role;

    let blocks;
    try {
      blocks = JSON.parse(row.content);
    } catch {
      // Plain-text content (legacy or user text)
      if (row.content && row.content.trim()) {
        trace.push({ type: 'text', role, content: row.content, timestamp });
      }
      continue;
    }

    if (!Array.isArray(blocks)) {
      // Single object or primitive — wrap
      blocks = [blocks];
    }

    for (const block of blocks) {
      if (!block || !block.type) continue;

      switch (block.type) {
        case 'tool_use':
          trace.push({
            type: 'tool_use',
            role,
            tool_name: block.name,
            tool_use_id: block.id,
            input: block.input,
            timestamp
          });
          break;

        case 'tool_result':
          trace.push({
            type: 'tool_result',
            role,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error || false,
            timestamp
          });
          break;

        case 'text':
          if (block.text && block.text.trim()) {
            trace.push({ type: 'text', role, content: block.text, timestamp });
          }
          break;

        case 'thinking':
          if (block.thinking && block.thinking.trim()) {
            trace.push({ type: 'thinking', role, content: block.thinking, timestamp });
          }
          break;

        case 'redacted_thinking':
          trace.push({ type: 'thinking', role, content: '[redacted]', timestamp });
          break;

        // Server-side tool blocks (web_search, web_fetch) — also useful for debugging
        case 'server_tool_use':
          trace.push({
            type: 'tool_use',
            role,
            tool_name: block.name,
            tool_use_id: block.id,
            input: block.input,
            timestamp
          });
          break;

        case 'web_search_tool_result':
        case 'web_fetch_tool_result':
          trace.push({
            type: 'tool_result',
            role,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: false,
            timestamp
          });
          break;

        default:
          // Unknown block type — preserve it as-is for forward compatibility
          trace.push({ type: block.type, role, content: block, timestamp });
          break;
      }
    }
  }

  return trace;
}

// ============================================================================
// CONVERSATION COMPACTION FUNCTIONS
// ============================================================================

/**
 * Save a compaction summary for a conversation
 * @param {string} conversationId - UUID of the conversation
 * @param {string} summary - Summary text
 * @param {Object} metadata - Metadata about the compaction (tokens saved, etc.)
 * @returns {Promise<Object>} Saved summary record
 */
export async function saveCompactionSummary(conversationId, summary, metadata = {}) {
  try {
    // First, check if a summary already exists
    const existingResult = await query(
      `SELECT id FROM conversation_summaries WHERE conversation_id = $1`,
      [conversationId]
    );

    let result;
    if (existingResult.rows.length > 0) {
      // Update existing summary
      result = await query(
        `UPDATE conversation_summaries
         SET summary = $2, metadata = $3, updated_at = NOW()
         WHERE conversation_id = $1
         RETURNING *`,
        [conversationId, summary, JSON.stringify(metadata)]
      );
      console.log(`✓ Updated compaction summary for conversation ${conversationId}`);
    } else {
      // Create new summary
      result = await query(
        `INSERT INTO conversation_summaries (conversation_id, summary, metadata)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [conversationId, summary, JSON.stringify(metadata)]
      );
      console.log(`✓ Created compaction summary for conversation ${conversationId}`);
    }

    return result.rows[0];
  } catch (error) {
    // Handle missing table gracefully (42P01 = relation does not exist)
    if (error.code === '42P01') {
      console.warn('⚠️ conversation_summaries table does not exist, skipping save');
      return null;
    }
    console.error('Error saving compaction summary:', error);
    throw error;
  }
}

/**
 * Get the compaction summary for a conversation
 * @param {string} conversationId - UUID of the conversation
 * @returns {Promise<Object|null>} Summary object or null
 */
export async function getCompactionSummary(conversationId) {
  try {
    const result = await query(
      `SELECT summary, metadata, created_at, updated_at
       FROM conversation_summaries
       WHERE conversation_id = $1`,
      [conversationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      content: row.summary,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    // Handle missing table gracefully (42P01 = relation does not exist)
    if (error.code === '42P01') {
      console.warn('⚠️ conversation_summaries table does not exist, returning null');
      return null;
    }
    console.error('Error retrieving compaction summary:', error);
    throw error;
  }
}

/**
 * Delete old messages after compaction
 * Keeps recent messages and deletes the rest
 * @param {string} conversationId - UUID of the conversation
 * @param {number} keepCount - Number of recent messages to keep
 * @returns {Promise<number>} Number of messages deleted
 */
export async function deleteOldMessages(conversationId, keepCount) {
  try {
    // Delete all but the most recent N messages
    const result = await query(
      `DELETE FROM messages
       WHERE conversation_id = $1
       AND id NOT IN (
         SELECT id FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
      [conversationId, keepCount]
    );

    const deletedCount = result.rowCount;
    console.log(`✓ Deleted ${deletedCount} old messages from conversation ${conversationId}`);
    return deletedCount;
  } catch (error) {
    console.error('Error deleting old messages:', error);
    throw error;
  }
}
