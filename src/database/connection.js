/**
 * Database Connection Pool
 *
 * Provides a shared PostgreSQL connection pool for the application.
 * Uses environment variables for configuration.
 */

import pkg from 'pg';
const { Pool } = pkg;

// Singleton connection pool
let pool = null;

/**
 * Get or create database connection pool
 * @returns {Pool} PostgreSQL connection pool
 */
export function getPool() {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!dbUrl) {
      throw new Error(
        'DATABASE_URL or POSTGRES_URL environment variable not set. ' +
        'Please configure database connection.'
      );
    }

    console.log('🔌 Creating database connection pool...');

    pool = new Pool({
      connectionString: dbUrl,
      // SSL configuration for cloud databases (Neon, Railway, etc.)
      ssl: dbUrl.includes('neon.tech') ||
           dbUrl.includes('railway.app') ||
           process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
      // Connection pool settings
      max: 20, // Maximum number of clients in the pool
      min: 2, // Minimum number of clients
      idleTimeoutMillis: 30000, // Close idle clients after 30s
      connectionTimeoutMillis: 5000, // Timeout after 5s if no connection available
      // Statement timeout (30 seconds)
      statement_timeout: 30000
    });

    // Error handler for the pool
    pool.on('error', (err, client) => {
      console.error('Unexpected database pool error:', err);
      // Don't exit the process, let the pool handle recovery
    });

    // Connection handler for monitoring
    pool.on('connect', (client) => {
      console.log('✓ New database connection established');
    });

    // Removal handler
    pool.on('remove', (client) => {
      console.log('✓ Database connection removed from pool');
    });

    console.log('✅ Database connection pool created');
  }

  return pool;
}

/**
 * A short, value-free name for a statement, safe to log: its leading keyword
 * and the first table it names, e.g. "INSERT pending_actions".
 *
 * Exported for testing. Only SQL keywords and identifiers can match, so
 * neither a parameter nor anything a caller interpolated into the text (some
 * build WHERE clauses and intervals that way) can reach the log.
 *
 * @param {string} text - SQL query text
 * @returns {string}
 */
export function queryLabel(text) {
  const sql = String(text ?? '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  const verb = (sql.match(/^[A-Za-z]+/)?.[0] || 'SQL').toUpperCase();
  const table = sql.match(/\b(?:FROM|INTO|UPDATE|TABLE|INDEX)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?("?[A-Za-z_][\w.]*"?)/i)?.[1];
  return table ? `${verb} ${table}` : verb;
}

/**
 * Execute a parameterized query
 *
 * Logs name the statement (queryLabel) and the error code only — never the
 * parameters, the SQL text or the driver's message. Parameters carry message
 * text, emails and OAuth tokens, and a driver message or detail can echo them.
 *
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params = []) {
  const pool = getPool();
  const start = Date.now();

  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries
    if (duration > 1000) {
      console.warn(`⚠️  Slow query detected (${duration}ms): ${queryLabel(text)}`);
    }

    // Log query in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`DB Query (${duration}ms): ${queryLabel(text)}`);
    }

    return res;
  } catch (error) {
    console.error(`Database query error: ${queryLabel(text)} (code: ${error.code || error.name || 'unknown'})`);
    throw error;
  }
}

/**
 * Execute a transaction
 *
 * Logs a label and the error code only, like query(). The error object itself
 * is never logged: a constraint violation's detail reads "Failing row contains
 * (…)" with every column value in it.
 *
 * @param {Function} callback - Async function that receives a client
 * @param {string} [label] - fixed name for the log; never a value
 * @returns {Promise<*>} Result of the callback
 */
export async function transaction(callback, label = 'transaction') {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Transaction error: ${label} (code: ${error.code || error.name || 'unknown'})`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Initialize database schema
 * Creates required tables if they don't exist
 * @returns {Promise<void>}
 */
export async function initializeSchema() {
  try {
    console.log('🔧 Initializing database schema...');

    // Create conversation_summaries table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id SERIAL PRIMARY KEY,
        conversation_id UUID NOT NULL,
        summary TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(conversation_id)
      )
    `);

    // Create index if it doesn't exist
    await query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conversation_id
        ON conversation_summaries(conversation_id)
    `);

    console.log('✅ Database schema initialized (conversation_summaries table ready)');
  } catch (error) {
    // Non-fatal - log warning but don't crash
    console.warn('⚠️  Schema initialization warning:', error.message);
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  try {
    const result = await query('SELECT NOW() as current_time, version() as version');
    console.log('✅ Database connection test successful');
    console.log(`   Time: ${result.rows[0].current_time}`);
    console.log(`   Version: ${result.rows[0].version.substring(0, 50)}...`);

    // Initialize schema after successful connection
    await initializeSchema();

    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error.message);
    return false;
  }
}

/**
 * Close the database pool (for graceful shutdown)
 */
export async function closePool() {
  if (pool) {
    console.log('🔌 Closing database connection pool...');
    await pool.end();
    pool = null;
    console.log('✅ Database pool closed');
  }
}

/**
 * Get pool statistics
 * @returns {Object} Pool statistics
 */
export function getPoolStats() {
  if (!pool) {
    return { connected: false };
  }

  return {
    connected: true,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

export default pool;
