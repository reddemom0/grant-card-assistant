/**
 * Check feedback data in PRODUCTION database
 */

import pg from 'pg';
const { Pool } = pg;

// PRODUCTION DATABASE
const DATABASE_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkProductionFeedback() {
  const client = await pool.connect();

  try {
    console.log('📋 Checking PRODUCTION database for feedback data...\n');

    // Check conversation_feedback table
    const feedbackCount = await client.query('SELECT COUNT(*) FROM conversation_feedback');
    console.log(`📊 conversation_feedback: ${feedbackCount.rows[0].count} records`);

    // Check feedback_notes table
    const notesCount = await client.query('SELECT COUNT(*) FROM feedback_notes');
    console.log(`📊 feedback_notes: ${notesCount.rows[0].count} records\n`);

    const totalFeedback = parseInt(feedbackCount.rows[0].count) + parseInt(notesCount.rows[0].count);

    if (totalFeedback === 0) {
      console.log('❌ No feedback data in production!');
      console.log('   Learning files cannot be generated without feedback.');
      console.log('\n💡 To test the learning system in production:');
      console.log('   1. Use the production app to have conversations');
      console.log('   2. Provide feedback (thumbs up/down) on responses');
      console.log('   3. Trigger learning analysis via /api/feedback-learning');
      return;
    }

    console.log(`✅ Found ${totalFeedback} total feedback records in production\n`);

    // Show recent feedback by agent
    const feedbackByAgent = await client.query(`
      SELECT
        c.agent_type,
        COUNT(*) as feedback_count,
        COUNT(CASE WHEN cf.rating = 'positive' THEN 1 END) as positive_count,
        COUNT(CASE WHEN cf.rating = 'negative' THEN 1 END) as negative_count
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      GROUP BY c.agent_type
      ORDER BY feedback_count DESC
    `);

    if (feedbackByAgent.rows.length > 0) {
      console.log('📈 Feedback by agent:');
      console.log('─'.repeat(80));
      feedbackByAgent.rows.forEach(row => {
        console.log(`   ${row.agent_type}: ${row.feedback_count} total (${row.positive_count} positive, ${row.negative_count} negative)`);
      });
      console.log('─'.repeat(80));
    }

    // Show recent feedback
    console.log('\n📝 Recent feedback (last 5):');
    const recentFeedback = await client.query(`
      SELECT
        c.agent_type,
        cf.rating,
        cf.feedback_text,
        cf.created_at
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      ORDER BY cf.created_at DESC
      LIMIT 5
    `);

    recentFeedback.rows.forEach((fb, i) => {
      console.log(`\n${i + 1}. ${fb.agent_type} - ${fb.rating.toUpperCase()}`);
      console.log(`   "${fb.feedback_text || 'No text'}"`);
      console.log(`   ${fb.created_at}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkProductionFeedback();
