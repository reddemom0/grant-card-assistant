/**
 * Check learning memory files in PRODUCTION Railway database
 */

import pg from 'pg';
const { Pool } = pg;

// PRODUCTION DATABASE
const DATABASE_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkProductionLearning() {
  const client = await pool.connect();

  try {
    console.log('📋 Checking PRODUCTION database for learning files...\n');

    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'learning_memory_files'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ learning_memory_files table does NOT exist in PRODUCTION!');
      console.log('   This is likely the problem - learnings can\'t be loaded.');
      return;
    }

    console.log('✅ learning_memory_files table EXISTS in production\n');

    // Count records
    const countResult = await client.query('SELECT COUNT(*) FROM learning_memory_files');
    console.log(`📊 Total learning files in PRODUCTION: ${countResult.rows[0].count}\n`);

    if (countResult.rows[0].count > 0) {
      // Show all files
      const filesResult = await client.query(`
        SELECT agent_type, file_name, LENGTH(content) as content_length, updated_at
        FROM learning_memory_files
        ORDER BY agent_type, file_name
      `);

      console.log('📁 Learning files in PRODUCTION:');
      console.log('─'.repeat(80));
      filesResult.rows.forEach(file => {
        console.log(`   Agent: ${file.agent_type}`);
        console.log(`   File: ${file.file_name}`);
        console.log(`   Size: ${file.content_length} bytes`);
        console.log(`   Updated: ${file.updated_at}`);
        console.log('─'.repeat(80));
      });

      // Show readiness-strategist content
      console.log('\n📚 Readiness Strategist Learned Patterns:');
      const contentResult = await client.query(`
        SELECT content
        FROM learning_memory_files
        WHERE agent_type = 'readiness-strategist'
        AND file_name = 'learned-patterns.md'
      `);

      if (contentResult.rows.length > 0) {
        console.log(contentResult.rows[0].content.substring(0, 500) + '...\n');
      }
    } else {
      console.log('❌ No learning files in PRODUCTION database!');
      console.log('   This explains why learnings aren\'t being applied.');
      console.log('\n💡 Solution: Copy learning files from staging to production.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkProductionLearning();
