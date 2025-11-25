/**
 * View learning memory file content
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = 'postgresql://postgres:tRutpbSXaKwzTsZxMBmMeOKSGdscsWIY@shinkansen.proxy.rlwy.net:19092/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function viewLearningContent() {
  const client = await pool.connect();

  try {
    // Get readiness-strategist learned-patterns.md
    const result = await client.query(`
      SELECT content
      FROM learning_memory_files
      WHERE agent_type = 'readiness-strategist'
      AND file_name = 'learned-patterns.md'
    `);

    if (result.rows.length > 0) {
      console.log('📚 READINESS STRATEGIST - Learned Patterns:\n');
      console.log('='.repeat(80));
      console.log(result.rows[0].content);
      console.log('='.repeat(80));
    } else {
      console.log('No learned patterns found for readiness-strategist');
    }

    console.log('\n\n');

    // Get readiness-strategist common-errors.md
    const errorsResult = await client.query(`
      SELECT content
      FROM learning_memory_files
      WHERE agent_type = 'readiness-strategist'
      AND file_name = 'common-errors.md'
    `);

    if (errorsResult.rows.length > 0) {
      console.log('🚨 READINESS STRATEGIST - Common Errors:\n');
      console.log('='.repeat(80));
      console.log(errorsResult.rows[0].content);
      console.log('='.repeat(80));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

viewLearningContent();
