/**
 * Migration: Add Sentiment Analysis Columns to Feedback Table
 *
 * Adds columns for AI-powered sentiment analysis:
 * - sentiment: Overall sentiment category
 * - sentiment_score: Numerical score from -1.0 (very negative) to 1.0 (very positive)
 * - sentiment_themes: Extracted themes, emotions, and topics from feedback
 * - sentiment_analyzed_at: When sentiment analysis was performed
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function addSentimentColumns() {
  const client = await pool.connect();

  try {
    console.log('🔧 Adding sentiment analysis columns to feedback table...');

    // Add sentiment columns
    await client.query(`
      ALTER TABLE conversation_feedback
      ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20),
      ADD COLUMN IF NOT EXISTS sentiment_score DECIMAL(3,2),
      ADD COLUMN IF NOT EXISTS sentiment_themes JSONB,
      ADD COLUMN IF NOT EXISTS sentiment_analyzed_at TIMESTAMP
    `);

    console.log('✅ Sentiment columns added successfully');

    // Create index for faster sentiment queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment
      ON conversation_feedback(sentiment)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_feedback_sentiment_score
      ON conversation_feedback(sentiment_score)
    `);

    console.log('✅ Sentiment indexes created');

    // Show current state
    const result = await client.query(`
      SELECT
        COUNT(*) as total_feedback,
        COUNT(sentiment) as analyzed_feedback,
        COUNT(*) - COUNT(sentiment) as pending_analysis
      FROM conversation_feedback
    `);

    const stats = result.rows[0];
    console.log('\n📊 Current State:');
    console.log(`   Total Feedback: ${stats.total_feedback}`);
    console.log(`   Analyzed: ${stats.analyzed_feedback}`);
    console.log(`   Pending Analysis: ${stats.pending_analysis}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addSentimentColumns().catch(console.error);
