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
    // Get rating statistics
    const ratingStats = await client.query(
      `SELECT
        COUNT(*) as total_ratings,
        COUNT(CASE WHEN rating = 'positive' THEN 1 END) as positive_count,
        COUNT(CASE WHEN rating = 'negative' THEN 1 END) as negative_count,
        AVG(quality_score) as avg_quality_score,
        AVG(revision_count) as avg_revision_count,
        AVG(completion_time_seconds) as avg_completion_time,
        AVG(message_count) as avg_message_count
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

    // Get notes statistics
    const notesStats = await client.query(
      `SELECT
        COUNT(*) as total_notes,
        COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as positive_notes,
        COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as negative_notes,
        COUNT(CASE WHEN sentiment = 'mixed' THEN 1 END) as mixed_notes,
        COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as neutral_notes
      FROM feedback_notes fn
      JOIN conversations c ON fn.conversation_id = c.id
      WHERE c.agent_type = $1`,
      [agentType]
    );

    const stats = ratingStats.rows[0];
    const messages = messageStats.rows[0];
    const notes = notesStats.rows[0];

    return {
      totalRatings: parseInt(stats.total_ratings) || 0,
      positiveCount: parseInt(stats.positive_count) || 0,
      negativeCount: parseInt(stats.negative_count) || 0,
      avgQualityScore: parseFloat(stats.avg_quality_score) || 0,
      avgRevisionCount: parseFloat(stats.avg_revision_count) || 0,
      avgCompletionTime: parseFloat(stats.avg_completion_time) || 0,
      avgMessageCount: parseFloat(stats.avg_message_count) || 0,
      totalMessages: parseInt(messages.total_messages) || 0,
      feedbackRate: stats.total_ratings > 0
        ? (parseInt(stats.total_ratings) / parseInt(messages.total_messages) * 100).toFixed(1)
        : 0,
      positiveRate: stats.total_ratings > 0
        ? (parseInt(stats.positive_count) / parseInt(stats.total_ratings) * 100).toFixed(1)
        : 0,
      totalNotes: parseInt(notes.total_notes) || 0,
      positiveNotes: parseInt(notes.positive_notes) || 0,
      negativeNotes: parseInt(notes.negative_notes) || 0,
      mixedNotes: parseInt(notes.mixed_notes) || 0,
      neutralNotes: parseInt(notes.neutral_notes) || 0,
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
