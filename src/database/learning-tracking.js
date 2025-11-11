/**
 * Learning Application Tracking
 *
 * Tracks when learned patterns are applied to conversations.
 * This creates an audit trail showing when feedback analysis influenced agent behavior.
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Save record of learning being applied to a conversation
 * @param {string} agentType - Type of agent
 * @param {string} conversationId - UUID of conversation
 * @param {string} userId - UUID of user
 * @param {Array<string>} filesLoaded - List of memory files loaded
 * @param {Date} learningTimestamp - When the learning files were last updated
 * @returns {Promise<Object>} Saved record
 */
export async function saveLearningApplication(
  agentType,
  conversationId,
  userId,
  filesLoaded,
  learningTimestamp
) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO learning_applications (
        agent_type,
        conversation_id,
        user_id,
        files_loaded,
        learning_updated_at,
        applied_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *`,
      [
        agentType,
        conversationId,
        userId,
        filesLoaded, // Will be stored as JSON array
        learningTimestamp
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get learning applications for an agent
 * @param {string} agentType - Type of agent
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} Learning application records
 */
export async function getLearningApplications(agentType, limit = 50) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        la.*,
        c.title as conversation_title,
        u.email as user_email
      FROM learning_applications la
      LEFT JOIN conversations c ON la.conversation_id = c.id
      LEFT JOIN users u ON la.user_id = u.id
      WHERE la.agent_type = $1
      ORDER BY la.applied_at DESC
      LIMIT $2`,
      [agentType, limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get learning application stats for an agent
 * @param {string} agentType - Type of agent
 * @returns {Promise<Object>} Statistics
 */
export async function getLearningApplicationStats(agentType) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        COUNT(*) as total_applications,
        COUNT(DISTINCT conversation_id) as unique_conversations,
        COUNT(DISTINCT user_id) as unique_users,
        MAX(applied_at) as last_applied,
        MIN(applied_at) as first_applied
      FROM learning_applications
      WHERE agent_type = $1`,
      [agentType]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get recent learning applications across all agents
 * @param {number} limit - Maximum number of records
 * @returns {Promise<Array>} Recent applications
 */
export async function getRecentLearningApplications(limit = 20) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        la.*,
        c.title as conversation_title,
        u.email as user_email
      FROM learning_applications la
      LEFT JOIN conversations c ON la.conversation_id = c.id
      LEFT JOIN users u ON la.user_id = u.id
      ORDER BY la.applied_at DESC
      LIMIT $1`,
      [limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Create the learning_applications table if it doesn't exist
 */
export async function ensureLearningApplicationsTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS learning_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_type VARCHAR(100) NOT NULL,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        files_loaded JSONB NOT NULL,
        learning_updated_at TIMESTAMP,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Create index for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_applications_agent_type
      ON learning_applications(agent_type)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_applications_applied_at
      ON learning_applications(applied_at DESC)
    `);

    console.log('✓ Learning applications table ensured');
  } catch (error) {
    console.error('Error ensuring learning_applications table:', error);
    throw error;
  } finally {
    client.release();
  }
}
