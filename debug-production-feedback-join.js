/**
 * Debug why feedback learning can't find agent types
 */

import pg from 'pg';
const { Pool } = pg;

// PRODUCTION DATABASE
const DATABASE_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function debugJoin() {
  const client = await pool.connect();

  try {
    console.log('🔍 Debugging feedback → conversations join\n');

    // 1. Check conversations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'conversations'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ conversations table does NOT exist!');
      console.log('   This is the problem - feedback can\'t be joined to conversations.\n');
      return;
    }

    console.log('✅ conversations table exists\n');

    // 2. Count conversations
    const convCount = await client.query('SELECT COUNT(*) FROM conversations');
    console.log(`📊 conversations: ${convCount.rows[0].count} records\n`);

    // 3. Check if conversation_ids in feedback match conversations
    const orphanedFeedback = await client.query(`
      SELECT COUNT(*) as orphaned_count
      FROM conversation_feedback cf
      LEFT JOIN conversations c ON cf.conversation_id = c.id
      WHERE c.id IS NULL
    `);

    console.log(`🔗 Orphaned feedback (no matching conversation): ${orphanedFeedback.rows[0].orphaned_count}\n`);

    // 4. Try the actual join from getAgentTypesWithFeedback
    const joinResult = await client.query(`
      SELECT DISTINCT c.agent_type, COUNT(*) as feedback_count
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      GROUP BY c.agent_type
      ORDER BY feedback_count DESC
    `);

    if (joinResult.rows.length === 0) {
      console.log('❌ JOIN returned 0 rows!');
      console.log('   All feedback records are orphaned - no matching conversations.\n');

      // Show sample feedback IDs
      const sample = await client.query(`
        SELECT conversation_id, created_at
        FROM conversation_feedback
        ORDER BY created_at DESC
        LIMIT 5
      `);

      console.log('📝 Sample feedback conversation_ids:');
      sample.rows.forEach(row => {
        console.log(`   ${row.conversation_id} (${row.created_at})`);
      });

      console.log('\n📝 Sample actual conversation ids:');
      const actualConvs = await client.query(`
        SELECT id, agent_type, created_at
        FROM conversations
        ORDER BY created_at DESC
        LIMIT 5
      `);

      actualConvs.rows.forEach(row => {
        console.log(`   ${row.id} - ${row.agent_type} (${row.created_at})`);
      });

    } else {
      console.log('✅ JOIN successful:');
      joinResult.rows.forEach(row => {
        console.log(`   ${row.agent_type}: ${row.feedback_count} feedback records`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

debugJoin();
