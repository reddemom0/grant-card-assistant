/**
 * Memory Tool Implementation
 *
 * Provides persistent memory storage for conversations using PostgreSQL.
 * Agents can store and recall key-value pairs that persist across messages.
 */

import pkg from 'pg';
const { Pool } = pkg;

// Create a shared database connection pool
// This will be initialized when first used
let pool = null;

/**
 * Get or create database connection pool
 */
function getPool() {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!dbUrl) {
      throw new Error('DATABASE_URL or POSTGRES_URL environment variable not set');
    }

    pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('neon.tech') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }

  return pool;
}

/**
 * Execute a database query
 */
async function query(text, params) {
  const pool = getPool();
  const start = Date.now();

  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`Slow query detected (${duration}ms):`, text);
    }

    return res;
  } catch (error) {
    console.error('Database query error:', error.message);
    throw error;
  }
}

/**
 * Store a memory in the database for this conversation
 * @param {string} conversationId - UUID of the conversation
 * @param {string} key - Key to store the value under
 * @param {string} value - Value to store
 * @returns {Object} Result with success status and message
 */
export async function storeMemory(conversationId, key, value) {
  try {
    await query(
      `INSERT INTO conversation_memory (conversation_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (conversation_id, key)
       DO UPDATE SET value = $3, updated_at = NOW()`,
      [conversationId, key, value]
    );

    console.log(`✓ Memory stored: ${key} for conversation ${conversationId}`);

    return {
      success: true,
      message: `Successfully stored: ${key}`,
      key,
      value
    };
  } catch (error) {
    console.error('Error storing memory:', error);
    return {
      success: false,
      error: error.message,
      key
    };
  }
}

/**
 * Recall a specific memory from the database
 * @param {string} conversationId - UUID of the conversation
 * @param {string} key - Key to retrieve
 * @returns {Object} Result with found status and value
 */
export async function recallMemory(conversationId, key) {
  try {
    const result = await query(
      'SELECT value, created_at FROM conversation_memory WHERE conversation_id = $1 AND key = $2',
      [conversationId, key]
    );

    if (result.rows.length === 0) {
      console.log(`✗ Memory not found: ${key} for conversation ${conversationId}`);
      return {
        found: false,
        message: `No memory found for key: ${key}`,
        key
      };
    }

    console.log(`✓ Memory recalled: ${key} for conversation ${conversationId}`);

    return {
      found: true,
      key,
      value: result.rows[0].value,
      stored_at: result.rows[0].created_at
    };
  } catch (error) {
    console.error('Error recalling memory:', error);
    return {
      found: false,
      error: error.message,
      key
    };
  }
}

/**
 * List all memories for a conversation
 * @param {string} conversationId - UUID of the conversation
 * @returns {Object} Result with count and array of memories
 */
export async function listMemories(conversationId) {
  try {
    const result = await query(
      'SELECT key, value, created_at FROM conversation_memory WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId]
    );

    console.log(`✓ Listed ${result.rows.length} memories for conversation ${conversationId}`);

    return {
      success: true,
      count: result.rows.length,
      memories: result.rows.map(row => ({
        key: row.key,
        value: row.value,
        stored_at: row.created_at
      }))
    };
  } catch (error) {
    console.error('Error listing memories:', error);
    return {
      success: false,
      count: 0,
      memories: [],
      error: error.message
    };
  }
}

/**
 * Load all memories for a conversation and format as system prompt addition
 * This is used to inject memories into the agent's context
 * @param {string} conversationId - UUID of the conversation
 * @returns {string} Formatted memory context to append to system prompt
 */
export async function loadConversationMemories(conversationId) {
  try {
    const result = await query(
      'SELECT key, value FROM conversation_memory WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    if (result.rows.length === 0) {
      return '';
    }

    const memoryList = result.rows
      .map(row => `  • ${row.key}: ${row.value}`)
      .join('\n');

    console.log(`✓ Loaded ${result.rows.length} memories into context for conversation ${conversationId}`);

    return `\n\n## Previously Stored Information\n${memoryList}\n`;
  } catch (error) {
    console.error('Error loading conversation memories:', error);
    return '';
  }
}

/**
 * Clear all memories for a conversation (optional utility function)
 * @param {string} conversationId - UUID of the conversation
 * @returns {Object} Result with success status
 */
export async function clearMemories(conversationId) {
  try {
    const result = await query(
      'DELETE FROM conversation_memory WHERE conversation_id = $1',
      [conversationId]
    );

    console.log(`✓ Cleared ${result.rowCount} memories for conversation ${conversationId}`);

    return {
      success: true,
      deleted_count: result.rowCount
    };
  } catch (error) {
    console.error('Error clearing memories:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
