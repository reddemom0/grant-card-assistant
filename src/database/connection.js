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
 * Execute a parameterized query
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
      console.warn(
        `⚠️  Slow query detected (${duration}ms):\n` +
        `   ${text.substring(0, 100)}...\n` +
        `   Params: ${JSON.stringify(params)}`
      );
    }

    // Log query in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`DB Query (${duration}ms): ${text.substring(0, 60)}...`);
    }

    return res;
  } catch (error) {
    console.error('Database query error:', {
      message: error.message,
      query: text.substring(0, 100),
      params: params
    });
    throw error;
  }
}

/**
 * Execute a transaction
 * @param {Function} callback - Async function that receives a client
 * @returns {Promise<*>} Result of the callback
 */
export async function transaction(callback) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', error);
    throw error;
  } finally {
    client.release();
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
