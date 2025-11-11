/**
 * Learning Memory Storage (Database)
 *
 * Stores agent learning memory files in PostgreSQL instead of filesystem.
 * This ensures persistence across deployments in containerized environments.
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
 * Save or update learning memory file for an agent
 * @param {string} agentType - Type of agent
 * @param {string} fileName - Name of memory file (e.g., 'learned-patterns.md')
 * @param {string} content - File content
 * @returns {Promise<Object>} Saved record
 */
export async function saveLearningMemoryFile(agentType, fileName, content) {
  const client = await pool.connect();
  try {
    // Use UPSERT (ON CONFLICT) to replace existing file
    const result = await client.query(
      `INSERT INTO learning_memory_files (
        agent_type,
        file_name,
        content,
        updated_at
      ) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (agent_type, file_name)
      DO UPDATE SET
        content = EXCLUDED.content,
        updated_at = NOW()
      RETURNING *`,
      [agentType, fileName, content]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get all learning memory files for an agent
 * @param {string} agentType - Type of agent
 * @returns {Promise<Array>} Array of memory files
 */
export async function getLearningMemoryFiles(agentType) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM learning_memory_files
       WHERE agent_type = $1
       ORDER BY file_name`,
      [agentType]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get a specific learning memory file
 * @param {string} agentType - Type of agent
 * @param {string} fileName - Name of file
 * @returns {Promise<Object|null>} Memory file or null
 */
export async function getLearningMemoryFile(agentType, fileName) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM learning_memory_files
       WHERE agent_type = $1 AND file_name = $2`,
      [agentType, fileName]
    );

    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Delete all learning memory for an agent
 * @param {string} agentType - Type of agent
 * @returns {Promise<number>} Number of files deleted
 */
export async function deleteLearningMemory(agentType) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM learning_memory_files
       WHERE agent_type = $1`,
      [agentType]
    );

    return result.rowCount;
  } finally {
    client.release();
  }
}

/**
 * Get learning memory stats for an agent
 * @param {string} agentType - Type of agent
 * @returns {Promise<Object|null>} Stats or null
 */
export async function getLearningMemoryStats(agentType) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        COUNT(*) as file_count,
        MAX(updated_at) as last_updated,
        array_agg(file_name) as file_names
       FROM learning_memory_files
       WHERE agent_type = $1`,
      [agentType]
    );

    const row = result.rows[0];
    if (parseInt(row.file_count) === 0) {
      return null;
    }

    return {
      fileCount: parseInt(row.file_count),
      lastUpdated: row.last_updated,
      fileNames: row.file_names
    };
  } finally {
    client.release();
  }
}

/**
 * Create the learning_memory_files table if it doesn't exist
 */
export async function ensureLearningMemoryFilesTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS learning_memory_files (
        id SERIAL PRIMARY KEY,
        agent_type VARCHAR(100) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(agent_type, file_name)
      )
    `);

    // Create index for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_memory_files_agent_type
      ON learning_memory_files(agent_type)
    `);

    console.log('✓ Learning memory files table ensured');
  } catch (error) {
    console.error('Error ensuring learning_memory_files table:', error);
    throw error;
  } finally {
    client.release();
  }
}
