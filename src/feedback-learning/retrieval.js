/**
 * Feedback Retrieval Service
 * Queries feedback database to extract learning data
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Get high-quality feedback for an agent type
 * Returns messages that received positive feedback with high quality scores
 *
 * @param {string} agentType - e.g., 'etg-writer', 'grant-cards'
 * @param {number} limit - Number of feedback items to retrieve
 * @param {number} minQualityScore - Minimum quality score (0-1)
 * @returns {Promise<Array>} Feedback items with message content
 */
export async function getHighQualityFeedback(agentType, limit = 20, minQualityScore = 0.75) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        cf.id,
        cf.conversation_id,
        cf.message_id,
        cf.rating,
        cf.feedback_text as note,
        cf.quality_score,
        cf.revision_count,
        cf.completion_time_seconds,
        cf.message_count,
        cf.created_at,
        m.content as message_content,
        m.role as message_role,
        c.agent_type,
        c.title as conversation_title,
        STRING_AGG(fn.note_text, ' | ') as sidebar_notes
      FROM conversation_feedback cf
      JOIN messages m ON cf.message_id = m.id
      JOIN conversations c ON cf.conversation_id = c.id
      LEFT JOIN feedback_notes fn ON cf.conversation_id = fn.conversation_id
      WHERE c.agent_type = $1
        AND cf.quality_score >= $2
        AND cf.rating = 'positive'
        AND m.role = 'assistant'
      GROUP BY cf.id, cf.conversation_id, cf.message_id, cf.rating, cf.feedback_text,
               cf.quality_score, cf.revision_count, cf.completion_time_seconds,
               cf.message_count, cf.created_at, m.content, m.role, c.agent_type, c.title
      ORDER BY cf.quality_score DESC, cf.created_at DESC
      LIMIT $3`,
      [agentType, minQualityScore, limit]
    );

    // Combine feedback_text and sidebar_notes into a single note field
    return result.rows.map(row => ({
      ...row,
      note: [row.note, row.sidebar_notes].filter(Boolean).join(' | ')
    }));
  } finally {
    client.release();
  }
}

/**
 * Get negative feedback patterns for an agent
 * Returns messages that received poor ratings
 *
 * @param {string} agentType
 * @param {number} limit
 * @param {number} maxQualityScore - Maximum quality score (0-1)
 * @returns {Promise<Array>} Negative feedback items
 */
export async function getNegativeFeedback(agentType, limit = 10, maxQualityScore = 0.4) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        cf.id,
        cf.conversation_id,
        cf.message_id,
        cf.rating,
        cf.feedback_text as note,
        cf.quality_score,
        cf.revision_count,
        cf.completion_time_seconds,
        cf.message_count,
        cf.created_at,
        m.content as message_content,
        m.role as message_role,
        c.agent_type,
        c.title as conversation_title,
        STRING_AGG(fn.note_text, ' | ') as sidebar_notes
      FROM conversation_feedback cf
      JOIN messages m ON cf.message_id = m.id
      JOIN conversations c ON cf.conversation_id = c.id
      LEFT JOIN feedback_notes fn ON cf.conversation_id = fn.conversation_id
      WHERE c.agent_type = $1
        AND cf.quality_score <= $2
        AND cf.rating = 'negative'
        AND m.role = 'assistant'
      GROUP BY cf.id, cf.conversation_id, cf.message_id, cf.rating, cf.feedback_text,
               cf.quality_score, cf.revision_count, cf.completion_time_seconds,
               cf.message_count, cf.created_at, m.content, m.role, c.agent_type, c.title
      ORDER BY cf.created_at DESC
      LIMIT $3`,
      [agentType, maxQualityScore, limit]
    );

    // Combine feedback_text and sidebar_notes into a single note field
    return result.rows.map(row => ({
      ...row,
      note: [row.note, row.sidebar_notes].filter(Boolean).join(' | ')
    }));
  } finally {
    client.release();
  }
}

/**
 * Get user correction notes
 * Returns feedback notes that indicate user corrections
 *
 * @param {string} agentType
 * @param {number} limit
 * @returns {Promise<Array>} Feedback notes with negative/mixed sentiment
 */
export async function getUserCorrections(agentType, limit = 50) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        fn.id,
        fn.conversation_id,
        fn.note_text as note,
        fn.message_index,
        fn.sentiment,
        fn.created_at,
        c.agent_type,
        c.title as conversation_title
      FROM feedback_notes fn
      JOIN conversations c ON fn.conversation_id = c.id
      WHERE c.agent_type = $1
        AND fn.sentiment IN ('negative', 'mixed')
      ORDER BY fn.created_at DESC
      LIMIT $2`,
      [agentType, limit]
    );

    // Filter for correction keywords
    const corrections = result.rows.filter(item => {
      const text = item.note.toLowerCase();
      const correctionKeywords = [
        'actually', 'incorrect', 'wrong', 'should be', 'not right',
        'mistake', 'error', 'fix', 'correction', 'clarification',
        'that\'s not', 'no,', 'false', 'inaccurate'
      ];
      return correctionKeywords.some(keyword => text.includes(keyword));
    });

    return corrections;
  } finally {
    client.release();
  }
}

/**
 * Get feedback summary statistics for an agent
 *
 * @param {string} agentType
 * @returns {Promise<Object>} Statistics object
 */
export async function getFeedbackStats(agentType) {
  const client = await pool.connect();
  try {
    // Get comprehensive feedback statistics combining explicit ratings + implicit sentiment
    const feedbackStats = await client.query(
      `SELECT
        -- Explicit ratings (thumbs up/down)
        COUNT(*) as total_feedback,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as explicit_ratings,
        COUNT(CASE WHEN rating = 'positive' THEN 1 END) as explicit_positive,
        COUNT(CASE WHEN rating = 'negative' THEN 1 END) as explicit_negative,

        -- High-confidence implicit ratings from sentiment analysis
        COUNT(CASE
          WHEN rating IS NULL
          AND sentiment IS NOT NULL
          AND (sentiment_themes->>'confidence')::float > 0.7
          AND sentiment_score > 0.3
          THEN 1
        END) as implicit_positive,
        COUNT(CASE
          WHEN rating IS NULL
          AND sentiment IS NOT NULL
          AND (sentiment_themes->>'confidence')::float > 0.7
          AND sentiment_score < -0.3
          THEN 1
        END) as implicit_negative,

        -- Sentiment distribution (all notes with sentiment)
        COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as sentiment_positive,
        COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as sentiment_negative,
        COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as sentiment_neutral,
        COUNT(CASE WHEN sentiment = 'mixed' THEN 1 END) as sentiment_mixed,

        -- Quality metrics
        AVG(quality_score) as avg_quality_score,
        AVG(revision_count) as avg_revision_count,
        AVG(completion_time_seconds) as avg_completion_time,
        AVG(message_count) as avg_message_count,

        -- Confidence metrics
        AVG(CASE WHEN sentiment IS NOT NULL
          THEN (sentiment_themes->>'confidence')::float
        END) as avg_sentiment_confidence,

        -- Count of feedback with notes
        COUNT(CASE WHEN feedback_text IS NOT NULL AND feedback_text != '' THEN 1 END) as total_notes

      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      WHERE c.agent_type = $1`,
      [agentType]
    );

    // Get total messages for this agent
    const messageStats = await client.query(
      `SELECT COUNT(*) as total_messages
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.agent_type = $1
        AND m.role = 'assistant'`,
      [agentType]
    );

    const stats = feedbackStats.rows[0];
    const messages = messageStats.rows[0];

    // Calculate combined metrics
    const explicitRatings = parseInt(stats.explicit_ratings) || 0;
    const explicitPositive = parseInt(stats.explicit_positive) || 0;
    const explicitNegative = parseInt(stats.explicit_negative) || 0;
    const implicitPositive = parseInt(stats.implicit_positive) || 0;
    const implicitNegative = parseInt(stats.implicit_negative) || 0;

    // Total feedback that counts toward satisfaction (explicit + high-confidence implicit)
    const totalRatings = explicitRatings + implicitPositive + implicitNegative;

    // Weighted satisfaction calculation
    // Explicit ratings: 1.0x weight, Implicit ratings: 0.8x weight
    const weightedPositive = (explicitPositive * 1.0) + (implicitPositive * 0.8);
    const weightedNegative = (explicitNegative * 1.0) + (implicitNegative * 0.8);
    const totalWeighted = weightedPositive + weightedNegative;

    const weightedSatisfaction = totalWeighted > 0
      ? (weightedPositive / totalWeighted * 100).toFixed(1)
      : 0;

    // Simple unweighted satisfaction for comparison
    const totalPositive = explicitPositive + implicitPositive;
    const unweightedSatisfaction = totalRatings > 0
      ? (totalPositive / totalRatings * 100).toFixed(1)
      : 0;

    return {
      // Combined metrics (what we show primarily)
      totalFeedback: parseInt(stats.total_feedback) || 0,
      totalRatings: totalRatings,
      positiveCount: totalPositive,
      negativeCount: explicitNegative + implicitNegative,
      satisfactionRate: weightedSatisfaction,

      // Explicit ratings breakdown
      explicitRatings: explicitRatings,
      explicitPositive: explicitPositive,
      explicitNegative: explicitNegative,
      explicitRate: explicitRatings > 0
        ? (explicitPositive / explicitRatings * 100).toFixed(1)
        : 0,

      // Implicit ratings breakdown (from sentiment)
      implicitPositive: implicitPositive,
      implicitNegative: implicitNegative,
      implicitRate: (implicitPositive + implicitNegative) > 0
        ? (implicitPositive / (implicitPositive + implicitNegative) * 100).toFixed(1)
        : 0,

      // Sentiment distribution (all notes)
      sentimentPositive: parseInt(stats.sentiment_positive) || 0,
      sentimentNegative: parseInt(stats.sentiment_negative) || 0,
      sentimentNeutral: parseInt(stats.sentiment_neutral) || 0,
      sentimentMixed: parseInt(stats.sentiment_mixed) || 0,

      // Confidence & quality metrics
      avgConfidence: parseFloat(stats.avg_sentiment_confidence) || 0,
      avgQualityScore: parseFloat(stats.avg_quality_score) || 0,
      avgRevisionCount: parseFloat(stats.avg_revision_count) || 0,
      avgCompletionTime: parseFloat(stats.avg_completion_time) || 0,
      avgMessageCount: parseFloat(stats.avg_message_count) || 0,

      // Other metrics
      totalMessages: parseInt(messages.total_messages) || 0,
      totalNotes: parseInt(stats.total_notes) || 0,
      feedbackRate: stats.total_feedback > 0
        ? (parseInt(stats.total_feedback) / parseInt(messages.total_messages) * 100).toFixed(1)
        : 0,

      // Legacy compatibility (kept for backward compat)
      positiveRate: unweightedSatisfaction, // Alias for satisfaction
    };
  } finally {
    client.release();
  }
}

/**
 * Get all agent types that have feedback data
 *
 * @returns {Promise<Array>} Array of agent type strings
 */
export async function getAgentTypesWithFeedback() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT c.agent_type, COUNT(*) as feedback_count
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      GROUP BY c.agent_type
      ORDER BY feedback_count DESC`
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get recent feedback activity across all agents
 *
 * @param {number} limit
 * @returns {Promise<Array>} Recent feedback items
 */
export async function getRecentFeedback(limit = 20) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        cf.id,
        cf.rating,
        cf.quality_score,
        cf.created_at,
        c.agent_type,
        c.title as conversation_title,
        m.content as message_content
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      JOIN messages m ON cf.message_id = m.id
      ORDER BY cf.created_at DESC
      LIMIT $1`,
      [limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get feedback trends over time for an agent
 * Returns daily aggregated statistics for the last N days
 *
 * @param {string} agentType
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Daily trend data
 */
export async function getFeedbackTrends(agentType, days = 30) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        DATE(cf.created_at) as date,
        COUNT(*) as total_ratings,
        COUNT(CASE WHEN cf.rating = 'positive' THEN 1 END) as positive_count,
        COUNT(CASE WHEN cf.rating = 'negative' THEN 1 END) as negative_count,
        AVG(cf.quality_score) as avg_quality_score
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      WHERE c.agent_type = $1
        AND cf.created_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(cf.created_at)
      ORDER BY date DESC`,
      [agentType]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get top performing messages (highest quality scores)
 *
 * @param {string} agentType
 * @param {number} limit
 * @returns {Promise<Array>} Top messages
 */
export async function getTopPerformingMessages(agentType, limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        cf.quality_score,
        cf.rating,
        cf.revision_count,
        cf.completion_time_seconds,
        m.content as message_content,
        c.title as conversation_title,
        cf.created_at
      FROM conversation_feedback cf
      JOIN messages m ON cf.message_id = m.id
      JOIN conversations c ON cf.conversation_id = c.id
      WHERE c.agent_type = $1
        AND m.role = 'assistant'
      ORDER BY cf.quality_score DESC
      LIMIT $2`,
      [agentType, limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Search feedback by content
 *
 * @param {string} agentType
 * @param {string} searchTerm
 * @param {number} limit
 * @returns {Promise<Array>} Matching feedback items
 */
export async function searchFeedback(agentType, searchTerm, limit = 20) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        cf.id,
        cf.rating,
        cf.quality_score,
        cf.feedback_text,
        cf.created_at,
        m.content as message_content,
        c.title as conversation_title
      FROM conversation_feedback cf
      JOIN messages m ON cf.message_id = m.id
      JOIN conversations c ON cf.conversation_id = c.id
      WHERE c.agent_type = $1
        AND (
          m.content ILIKE $2
          OR cf.feedback_text ILIKE $2
          OR c.title ILIKE $2
        )
      ORDER BY cf.created_at DESC
      LIMIT $3`,
      [agentType, `%${searchTerm}%`, limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Close pool (for graceful shutdown)
 */
export async function closePool() {
  await pool.end();
}

export default {
  getHighQualityFeedback,
  getNegativeFeedback,
  getUserCorrections,
  getFeedbackStats,
  getAgentTypesWithFeedback,
  getRecentFeedback,
  getFeedbackTrends,
  getTopPerformingMessages,
  searchFeedback,
  closePool,
};
