/**
 * Sentiment Analysis Database Operations
 *
 * Functions for storing and retrieving sentiment analysis results.
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Save sentiment analysis for a feedback item (handles BOTH tables)
 * @param {number} feedbackId - Feedback ID
 * @param {Object} sentiment - Sentiment analysis result
 * @param {string} sourceTable - 'conversation_feedback' or 'feedback_notes'
 * @returns {Promise<void>}
 */
export async function saveFeedbackSentiment(feedbackId, sentiment, sourceTable = 'conversation_feedback') {
  const client = await pool.connect();
  try {
    const sentimentThemes = JSON.stringify({
      confidence: sentiment.confidence,
      emotions: sentiment.emotions,
      themes: sentiment.themes,
      key_phrases: sentiment.key_phrases,
      summary: sentiment.summary
    });

    if (sourceTable === 'feedback_notes') {
      // Save to feedback_notes table
      await client.query(
        `UPDATE feedback_notes
         SET
           sentiment = $1,
           sentiment_score = $2,
           sentiment_themes = $3,
           sentiment_analyzed_at = NOW()
         WHERE id = $4`,
        [sentiment.sentiment, sentiment.sentiment_score, sentimentThemes, feedbackId]
      );
    } else {
      // Save to conversation_feedback table (default)
      await client.query(
        `UPDATE conversation_feedback
         SET
           sentiment = $1,
           sentiment_score = $2,
           sentiment_themes = $3,
           sentiment_analyzed_at = NOW()
         WHERE id = $4`,
        [sentiment.sentiment, sentiment.sentiment_score, sentimentThemes, feedbackId]
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Get feedback items that need sentiment analysis (from BOTH tables)
 * @param {number} limit - Maximum number to return
 * @returns {Promise<Array>} Feedback items pending analysis
 */
export async function getFeedbackPendingAnalysis(limit = 100) {
  const client = await pool.connect();
  try {
    // Query BOTH conversation_feedback AND feedback_notes tables
    const result = await client.query(
      `
      -- Feedback from conversation_feedback table
      SELECT
         'conversation_feedback' as source_table,
         cf.id,
         cf.conversation_id,
         cf.rating,
         cf.feedback_text as text,
         cf.quality_score as "qualityScore",
         c.agent_type as "agentType",
         cf.created_at
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE cf.sentiment IS NULL
       AND cf.feedback_text IS NOT NULL
       AND cf.feedback_text != ''

      UNION ALL

      -- Feedback from feedback_notes table
      SELECT
         'feedback_notes' as source_table,
         fn.id,
         fn.conversation_id,
         NULL as rating,
         fn.note_text as text,
         NULL as "qualityScore",
         c.agent_type as "agentType",
         fn.created_at
       FROM feedback_notes fn
       JOIN conversations c ON fn.conversation_id = c.id
       WHERE fn.sentiment IS NULL
       AND fn.note_text IS NOT NULL
       AND fn.note_text != ''

       ORDER BY created_at DESC
       LIMIT $1
      `,
      [limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get sentiment statistics for an agent
 * @param {string} agentType - Agent type
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} Statistics
 */
export async function getSentimentStats(agentType, days = 30) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as positive,
         COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as negative,
         COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as neutral,
         COUNT(CASE WHEN sentiment = 'mixed' THEN 1 END) as mixed,
         AVG(sentiment_score) as avg_score,
         AVG(quality_score) as avg_quality
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE c.agent_type = $1
       AND cf.sentiment IS NOT NULL
       AND cf.created_at >= NOW() - INTERVAL '${days} days'`,
      [agentType]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get sentiment trends over time
 * @param {string} agentType - Agent type
 * @param {number} days - Number of days
 * @returns {Promise<Array>} Daily sentiment data
 */
export async function getSentimentTrends(agentType, days = 30) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         DATE(cf.created_at) as date,
         COUNT(*) as total,
         COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as positive,
         COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as negative,
         COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as neutral,
         AVG(sentiment_score) as avg_score,
         AVG(quality_score) as avg_quality
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE c.agent_type = $1
       AND cf.sentiment IS NOT NULL
       AND cf.created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(cf.created_at)
       ORDER BY DATE(cf.created_at) DESC`,
      [agentType]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get most common themes from sentiment analysis
 * @param {string} agentType - Agent type
 * @param {number} limit - Number of themes to return
 * @returns {Promise<Array>} Common themes
 */
export async function getCommonThemes(agentType, limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         cf.sentiment_themes,
         cf.sentiment,
         cf.sentiment_score,
         cf.feedback_text,
         cf.created_at
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE c.agent_type = $1
       AND cf.sentiment_themes IS NOT NULL
       ORDER BY cf.created_at DESC
       LIMIT 100`,
      [agentType]
    );

    // Extract and count all themes
    const themeCounts = {};
    const themeDetails = {};

    result.rows.forEach(row => {
      const themes = row.sentiment_themes?.themes || [];
      themes.forEach(theme => {
        if (!themeCounts[theme]) {
          themeCounts[theme] = 0;
          themeDetails[theme] = {
            positive: 0,
            negative: 0,
            neutral: 0,
            totalScore: 0,
            examples: []
          };
        }
        themeCounts[theme]++;
        themeDetails[theme][row.sentiment]++;
        themeDetails[theme].totalScore += row.sentiment_score || 0;

        if (themeDetails[theme].examples.length < 3) {
          themeDetails[theme].examples.push({
            text: row.feedback_text,
            sentiment: row.sentiment,
            score: row.sentiment_score,
            date: row.created_at
          });
        }
      });
    });

    // Convert to array and sort by frequency
    const themes = Object.entries(themeCounts)
      .map(([theme, count]) => ({
        theme,
        count,
        ...themeDetails[theme],
        avgScore: themeDetails[theme].totalScore / count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return themes;
  } finally {
    client.release();
  }
}

/**
 * Get most common emotions from sentiment analysis
 * @param {string} agentType - Agent type
 * @param {number} limit - Number of emotions to return
 * @returns {Promise<Array>} Common emotions
 */
export async function getCommonEmotions(agentType, limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT sentiment_themes, sentiment, created_at
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE c.agent_type = $1
       AND cf.sentiment_themes IS NOT NULL
       ORDER BY cf.created_at DESC
       LIMIT 100`,
      [agentType]
    );

    // Extract and count emotions
    const emotionCounts = {};
    result.rows.forEach(row => {
      const emotions = row.sentiment_themes?.emotions || [];
      emotions.forEach(emotion => {
        if (!emotionCounts[emotion]) {
          emotionCounts[emotion] = { count: 0, sentiment: row.sentiment };
        }
        emotionCounts[emotion].count++;
      });
    });

    // Convert to array and sort
    const emotions = Object.entries(emotionCounts)
      .map(([emotion, data]) => ({ emotion, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return emotions;
  } finally {
    client.release();
  }
}

/**
 * Get all feedback with sentiment data for an agent (from BOTH tables)
 * @param {string} agentType - Agent type
 * @param {number} days - Number of days to look back (default 90)
 * @param {number} limit - Maximum number of items (default 200)
 * @returns {Promise<Array>} Feedback items with sentiment data
 */
export async function getFeedbackWithSentiment(agentType, days = 90, limit = 200) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      -- Feedback from conversation_feedback table
      SELECT
         cf.id,
         cf.conversation_id,
         cf.rating,
         cf.feedback_text as note,
         cf.quality_score,
         cf.sentiment,
         cf.sentiment_score,
         cf.sentiment_themes,
         cf.created_at,
         c.agent_type
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE c.agent_type = $1
       AND cf.created_at >= NOW() - INTERVAL '${days} days'

      UNION ALL

      -- Feedback from feedback_notes table
      SELECT
         fn.id,
         fn.conversation_id,
         NULL as rating,
         fn.note_text as note,
         NULL as quality_score,
         fn.sentiment,
         fn.sentiment_score,
         fn.sentiment_themes,
         fn.created_at,
         c.agent_type
       FROM feedback_notes fn
       JOIN conversations c ON fn.conversation_id = c.id
       WHERE c.agent_type = $1
       AND fn.created_at >= NOW() - INTERVAL '${days} days'

       ORDER BY created_at DESC
       LIMIT $2
      `,
      [agentType, limit]
    );

    // Parse JSON fields and flatten structure
    return result.rows.map(row => ({
      id: row.id,
      conversation_id: row.conversation_id,
      rating: row.rating,
      note: row.note,
      text: row.note,  // Alias for compatibility
      quality_score: parseFloat(row.quality_score) || 0,
      qualityScore: parseFloat(row.quality_score) || 0,  // Alias for compatibility
      sentiment: row.sentiment,
      sentiment_score: parseFloat(row.sentiment_score) || 0,
      themes: row.sentiment_themes?.themes || [],
      emotions: row.sentiment_themes?.emotions || [],
      key_phrases: row.sentiment_themes?.key_phrases || [],
      summary: row.sentiment_themes?.summary || '',
      confidence: row.sentiment_themes?.confidence || 0,
      created_at: row.created_at,
      agentType: row.agent_type
    }));
  } finally {
    client.release();
  }
}
