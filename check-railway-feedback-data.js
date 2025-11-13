import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkCurrentData() {
  const client = await pool.connect();
  try {
    // Check if there's any existing feedback data
    const cfCount = await client.query('SELECT COUNT(*) FROM conversation_feedback');
    const fnCount = await client.query('SELECT COUNT(*) FROM feedback_notes');

    console.log('📊 Current Data in Railway Database:');
    console.log(`   - conversation_feedback: ${cfCount.rows[0].count} rows`);
    console.log(`   - feedback_notes: ${fnCount.rows[0].count} rows`);

    if (cfCount.rows[0].count > 0) {
      const recent = await client.query(`
        SELECT id, rating, feedback_text, sentiment, created_at
        FROM conversation_feedback
        ORDER BY created_at DESC
        LIMIT 3
      `);

      console.log('\n📝 Recent feedback:');
      recent.rows.forEach(row => {
        console.log(`   - ID ${row.id}: ${row.rating} | Sentiment: ${row.sentiment || 'pending'} | ${row.created_at}`);
      });
    }

    if (fnCount.rows[0].count > 0) {
      const recentNotes = await client.query(`
        SELECT id, note_text, sentiment, created_at
        FROM feedback_notes
        ORDER BY created_at DESC
        LIMIT 3
      `);

      console.log('\n📝 Recent notes:');
      recentNotes.rows.forEach(row => {
        const preview = row.note_text.substring(0, 50);
        console.log(`   - ID ${row.id}: "${preview}..." | Sentiment: ${row.sentiment || 'pending'}`);
      });
    }

    console.log('\n✅ Database is ready to collect feedback!');
    console.log('\n📋 Next steps:');
    console.log('   1. Users interact with agents on Railway staging');
    console.log('   2. Give thumbs up/down feedback or add notes');
    console.log('   3. Data will populate in these tables automatically');
    console.log('   4. Sentiment analysis can then run on the feedback');
    console.log('   5. View results at /metrics and /usage pages');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkCurrentData();
