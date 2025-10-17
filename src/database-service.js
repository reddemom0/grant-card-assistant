import pg from 'pg';
import { config } from 'dotenv';

// Load environment variables
config();

const { Pool } = pg;

// Create connection pool (reuses connections efficiently)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ===== USER OPERATIONS =====

/**
 * Create or get a user by google_id (for Railway schema)
 * Returns the user's integer ID for foreign key references
 */
export async function ensureUser(googleId, email = null, name = null) {
  const client = await pool.connect();
  try {
    // Use a default email if not provided (for test users)
    const userEmail = email || `user-${googleId}@test.local`;
    const userName = name || 'Test User';

    const result = await client.query(
      `INSERT INTO users (google_id, email, name, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (google_id) DO UPDATE
       SET last_login = NOW()
       RETURNING *`,
      [googleId, userEmail, userName]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

// ===== CONVERSATION OPERATIONS =====

/**
 * Get a conversation with all its messages
 */
export async function getConversation(conversationId) {
  const client = await pool.connect();
  try {
    // Get conversation metadata
    const convResult = await client.query(
      'SELECT * FROM conversations WHERE id = $1',
      [conversationId]
    );

    if (convResult.rows.length === 0) {
      return null;
    }

    const conversation = convResult.rows[0];

    // Get all messages for this conversation
    const messagesResult = await client.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    // Get file attachments
    const filesResult = await client.query(
      'SELECT * FROM file_attachments WHERE conversation_id = $1 ORDER BY upload_timestamp ASC',
      [conversationId]
    );

    return {
      ...conversation,
      messages: messagesResult.rows,
      files: filesResult.rows,
    };
  } finally {
    client.release();
  }
}

/**
 * Create a new conversation
 */
export async function createConversation(conversationId, userId, agentType, title = null) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO conversations (id, user_id, agent_type, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [conversationId, userId, agentType, title]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save a message to a conversation
 */
export async function saveMessage(conversationId, role, content) {
  const client = await pool.connect();
  try {
    // Insert message
    const result = await client.query(
      `INSERT INTO messages (conversation_id, role, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [conversationId, role, content]
    );

    // Update conversation's updated_at timestamp
    await client.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
      [conversationId]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save file attachment metadata
 */
export async function saveFileAttachment(conversationId, filename, fileType, fileSize) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO file_attachments (conversation_id, filename, file_type, file_size, upload_timestamp)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [conversationId, filename, fileType, fileSize]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get all conversations for a user
 */
export async function getUserConversations(userId, agentType = null, limit = 50) {
  const client = await pool.connect();
  try {
    let query = 'SELECT * FROM conversations WHERE user_id = $1';
    const params = [userId];

    if (agentType) {
      query += ' AND agent_type = $2';
      params.push(agentType);
    }

    query += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Delete a conversation and all its messages/files (cascade)
 */
export async function deleteConversation(conversationId) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    return true;
  } finally {
    client.release();
  }
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(conversationId, title) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [title, conversationId]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// ===== HELPER FUNCTIONS =====

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    return { success: true, timestamp: result.rows[0].now };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Close pool (for graceful shutdown)
 */
export async function closePool() {
  await pool.end();
}

export default {
  ensureUser,
  getConversation,
  createConversation,
  saveMessage,
  saveFileAttachment,
  getUserConversations,
  deleteConversation,
  updateConversationTitle,
  testConnection,
  closePool,
};
