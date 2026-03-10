/**
 * Check learning memory files in Railway database
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkLearningFiles() {
  const client = await pool.connect();

  try {
    // Check if table exists
    console.log('📋 Checking if learning_memory_files table exists...\n');
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'learning_memory_files'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ learning_memory_files table does NOT exist!');
      console.log('   The table needs to be created.');
      return;
    }

    console.log('✅ learning_memory_files table EXISTS\n');

    // Count records
    const countResult = await client.query('SELECT COUNT(*) FROM learning_memory_files');
    console.log(`📊 Total learning files: ${countResult.rows[0].count}\n`);

    if (countResult.rows[0].count > 0) {
      // Show all files
      const filesResult = await client.query(`
        SELECT agent_type, file_name, LENGTH(content) as content_length, updated_at
        FROM learning_memory_files
        ORDER BY agent_type, file_name
      `);

      console.log('📁 Stored learning files:');
      console.log('─'.repeat(80));
      filesResult.rows.forEach(file => {
        console.log(`   Agent: ${file.agent_type}`);
        console.log(`   File: ${file.file_name}`);
        console.log(`   Size: ${file.content_length} bytes`);
        console.log(`   Updated: ${file.updated_at}`);
        console.log('─'.repeat(80));
      });
    } else {
      console.log('ℹ️  No learning files stored yet.');
      console.log('   Files are created by the feedback learning analysis process.');
      console.log('   To generate learning files:');
      console.log('   1. Users must provide feedback on agent responses');
      console.log('   2. Run the feedback learning analysis via /api/feedback-learning');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkLearningFiles();
