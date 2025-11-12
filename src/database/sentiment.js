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
 * Save sentiment analysis for a feedback item
 * @param {number} feedbackId - Feedback ID
 * @param {Object} sentiment - Sentiment analysis result
 * @returns {Promise<void>}
 */
export async function saveFeedbackSentiment(feedbackId, sentiment) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE conversation_feedback
       SET
         sentiment = $1,
         sentiment_score = $2,
         sentiment_themes = $3,
         sentiment_analyzed_at = NOW()
       WHERE id = $4`,
      [
        sentiment.sentiment,
        sentiment.sentiment_score,
        JSON.stringify({
          confidence: sentiment.confidence,
          emotions: sentiment.emotions,
          themes: sentiment.themes,
          key_phrases: sentiment.key_phrases,
          summary: sentiment.summary
        }),
        feedbackId
      ]
    );
  } finally {
    client.release();
  }
}

/**
 * Get feedback items that need sentiment analysis
 * @param {number} limit - Maximum number to return
 * @returns {Promise<Array>} Feedback items pending analysis
 */
export async function getFeedbackPendingAnalysis(limit = 100) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         cf.id,
         cf.conversation_id,
         cf.rating,
         cf.feedback_text as text,
         cf.quality_score as "qualityScore",
         c.agent_type as "agentType"
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE cf.sentiment IS NULL
       AND cf.feedback_text IS NOT NULL
       AND cf.feedback_text != ''
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
