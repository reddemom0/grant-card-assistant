/**
 * AI-Powered Sentiment Analysis
 *
 * Uses Claude to analyze emotional tone and themes in user feedback.
 * Provides deeper insights than simple quality scores alone.
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Analyze sentiment of feedback text using Claude
 * @param {Object} feedback - Feedback object with text and metadata
 * @param {string} feedback.text - The feedback text to analyze
 * @param {number} feedback.qualityScore - Quality score (0.0 - 1.0)
 * @param {string} feedback.rating - User rating (positive/negative)
 * @param {string} feedback.agentType - Which agent was rated
 * @returns {Promise<Object>} Sentiment analysis results
 */
export async function analyzeFeedbackSentiment(feedback) {
  const { text, qualityScore, rating, agentType } = feedback;

  // If no text provided, use quality score as fallback
  if (!text || text.trim().length === 0) {
    return inferSentimentFromScore(qualityScore, rating);
  }

  try {
    const prompt = `Analyze the sentiment of this user feedback for an AI agent.

**Agent Type**: ${agentType}
**Quality Score**: ${qualityScore}/1.0
**User Rating**: ${rating}
**Feedback Text**:
"${text}"

Please analyze and return ONLY a JSON object (no markdown, no explanation) with:
{
  "sentiment": "positive|negative|neutral|mixed",
  "sentiment_score": <number from -1.0 (very negative) to 1.0 (very positive)>,
  "confidence": <number 0.0 to 1.0>,
  "emotions": ["emotion1", "emotion2", ...],
  "themes": ["theme1", "theme2", ...],
  "key_phrases": ["phrase1", "phrase2", ...],
  "summary": "one sentence summary of the feedback"
}

Guidelines:
- sentiment: Overall emotional tone
- sentiment_score: Numerical representation of sentiment
- confidence: How confident you are in this analysis
- emotions: Specific emotions detected (frustrated, delighted, confused, satisfied, etc.)
- themes: Main topics or aspects mentioned (accuracy, clarity, length, helpfulness, etc.)
- key_phrases: Important phrases that capture the feedback essence
- summary: Brief summary of what the user is saying`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extract JSON from response
    const content = response.content[0].text.trim();

    // Remove markdown code blocks if present
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                     content.match(/```\n?([\s\S]*?)\n?```/) ||
                     [null, content];

    const jsonText = jsonMatch[1] || content;
    const analysis = JSON.parse(jsonText);

    // Validate and normalize
    return {
      sentiment: normalizeSentiment(analysis.sentiment),
      sentiment_score: clampScore(analysis.sentiment_score),
      confidence: clampScore(analysis.confidence || 0.8),
      themes: Array.isArray(analysis.themes) ? analysis.themes : [],
      emotions: Array.isArray(analysis.emotions) ? analysis.emotions : [],
      key_phrases: Array.isArray(analysis.key_phrases) ? analysis.key_phrases : [],
      summary: analysis.summary || text.substring(0, 100),
      analyzed_at: new Date()
    };

  } catch (error) {
    console.error('Sentiment analysis error:', error);
    // Fallback to score-based analysis
    return inferSentimentFromScore(qualityScore, rating);
  }
}

/**
 * Analyze sentiment for multiple feedback items in batch
 * @param {Array<Object>} feedbackItems - Array of feedback objects
 * @returns {Promise<Array<Object>>} Array of sentiment results
 */
export async function analyzeBatchSentiment(feedbackItems) {
  const results = [];

  // Process in smaller batches to avoid rate limits
  const BATCH_SIZE = 5;

  for (let i = 0; i < feedbackItems.length; i += BATCH_SIZE) {
    const batch = feedbackItems.slice(i, i + BATCH_SIZE);

    console.log(`📊 Analyzing sentiment batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(feedbackItems.length/BATCH_SIZE)}...`);

    const batchResults = await Promise.all(
      batch.map(item => analyzeFeedbackSentiment(item))
    );

    results.push(...batchResults);

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < feedbackItems.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

/**
 * Infer sentiment from quality score when no text available
 * @param {number} qualityScore - Quality score 0.0 - 1.0
 * @param {string} rating - User rating
 * @returns {Object} Basic sentiment analysis
 */
function inferSentimentFromScore(qualityScore, rating) {
  let sentiment, sentiment_score;

  if (qualityScore >= 0.75) {
    sentiment = 'positive';
    sentiment_score = 0.5 + (qualityScore - 0.75) * 2; // 0.5 to 1.0
  } else if (qualityScore >= 0.5) {
    sentiment = 'neutral';
    sentiment_score = (qualityScore - 0.5) * 2 - 0.5; // -0.5 to 0.5
  } else if (qualityScore >= 0.25) {
    sentiment = 'negative';
    sentiment_score = (qualityScore - 0.25) * 2 - 1; // -1.0 to -0.5
  } else {
    sentiment = 'negative';
    sentiment_score = qualityScore * 4 - 1; // -1.0 to -0.75
  }

  // Adjust based on explicit rating
  if (rating === 'positive' && sentiment === 'negative') {
    sentiment = 'mixed';
  } else if (rating === 'negative' && sentiment === 'positive') {
    sentiment = 'mixed';
  }

  return {
    sentiment,
    sentiment_score: clampScore(sentiment_score),
    confidence: 0.5, // Lower confidence for inferred sentiment
    themes: [],
    emotions: [],
    key_phrases: [],
    summary: `Inferred from ${rating} rating with ${qualityScore.toFixed(2)} quality score`,
    analyzed_at: new Date()
  };
}

/**
 * Normalize sentiment to valid values
 */
function normalizeSentiment(sentiment) {
  const normalized = sentiment?.toLowerCase();
  if (['positive', 'negative', 'neutral', 'mixed'].includes(normalized)) {
    return normalized;
  }
  return 'neutral';
}

/**
 * Clamp score to valid range
 */
function clampScore(score) {
  const num = parseFloat(score);
  if (isNaN(num)) return 0;
  return Math.max(-1, Math.min(1, num));
}

/**
 * Generate actionable insights from feedback for an agent
 * @param {Array<Object>} feedbackItems - Array of feedback with sentiment data
 * @param {string} agentType - Type of agent being analyzed
 * @returns {Promise<Object>} Insights summary with recommendations
 */
export async function generateFeedbackInsights(feedbackItems, agentType) {
  if (!feedbackItems || feedbackItems.length === 0) {
    return {
      summary: 'No feedback data available yet.',
      patterns: [],
      strengths: [],
      improvements: [],
      actionItems: [],
      analyzed_at: new Date()
    };
  }

  try {
    // Prepare feedback data for analysis
    const feedbackSummary = feedbackItems.map((item, idx) => {
      return `
Feedback #${idx + 1}:
- Rating: ${item.rating || 'N/A'}
- Quality Score: ${item.quality_score || item.qualityScore || 'N/A'}
- Sentiment: ${item.sentiment || 'N/A'} (Score: ${item.sentiment_score || 'N/A'})
- Emotions: ${item.emotions?.join(', ') || 'N/A'}
- Themes: ${item.themes?.join(', ') || 'N/A'}
- User Note: ${item.note || item.text || 'No note provided'}
- Summary: ${item.summary || 'N/A'}
`;
    }).join('\n---\n');

    const prompt = `You are analyzing user feedback for the **${agentType}** AI agent to identify patterns and generate actionable improvement recommendations.

**Feedback Data** (${feedbackItems.length} items):
${feedbackSummary}

Please analyze this feedback and provide a comprehensive insights report. Return ONLY a JSON object (no markdown, no code blocks) with this structure:

{
  "summary": "2-3 sentence executive summary of overall feedback sentiment and key findings",
  "patterns": [
    "Pattern 1: Description of recurring theme or issue",
    "Pattern 2: Another pattern observed",
    "..."
  ],
  "strengths": [
    "Strength 1: What users consistently praise",
    "Strength 2: Another positive aspect",
    "..."
  ],
  "improvements": [
    "Improvement 1: Specific issue users mention that needs addressing",
    "Improvement 2: Another area for improvement",
    "..."
  ],
  "actionItems": [
    {
      "priority": "high|medium|low",
      "title": "Brief action title",
      "description": "What should be done and why",
      "impact": "Expected benefit if implemented"
    }
  ]
}

Guidelines:
- Be specific and actionable
- Focus on recurring themes (not isolated feedback)
- Prioritize improvements that affect user experience most
- Include 3-5 patterns, strengths, and improvements
- Include 3-5 action items sorted by priority
- Use clear, concise language
- Base insights ONLY on the data provided`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extract JSON from response
    const content = response.content[0].text.trim();

    // Remove markdown code blocks if present
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                     content.match(/```\n?([\s\S]*?)\n?```/) ||
                     [null, content];

    const jsonText = jsonMatch[1] || content;
    const insights = JSON.parse(jsonText);

    return {
      ...insights,
      analyzed_at: new Date(),
      feedbackCount: feedbackItems.length,
      agentType
    };

  } catch (error) {
    console.error('Insights generation error:', error);
    throw new Error(`Failed to generate insights: ${error.message}`);
  }
}

/**
 * Get sentiment statistics for a set of analyses
 * @param {Array<Object>} analyses - Array of sentiment analysis results
 * @returns {Object} Statistics
 */
export function calculateSentimentStats(analyses) {
  if (!analyses || analyses.length === 0) {
    return {
      total: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      mixed: 0,
      averageScore: 0,
      averageConfidence: 0
    };
  }

  const stats = {
    total: analyses.length,
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
    totalScore: 0,
    totalConfidence: 0
  };

  analyses.forEach(analysis => {
    stats[analysis.sentiment]++;
    stats.totalScore += analysis.sentiment_score;
    stats.totalConfidence += analysis.confidence || 0;
  });

  stats.averageScore = stats.totalScore / stats.total;
  stats.averageConfidence = stats.totalConfidence / stats.total;

  // Add percentages
  stats.positivePercent = (stats.positive / stats.total) * 100;
  stats.negativePercent = (stats.negative / stats.total) * 100;
  stats.neutralPercent = (stats.neutral / stats.total) * 100;
  stats.mixedPercent = (stats.mixed / stats.total) * 100;

  return stats;
}
