/**
 * Feedback Analysis Engine
 *
 * Analyzes user feedback to extract learned patterns, common errors,
 * and successful approaches. Generates structured insights for agent memory.
 */

import * as feedbackRetrieval from './retrieval.js';

/**
 * Analyze high-quality feedback to extract successful patterns
 * @param {string} agentType - Agent type to analyze
 * @param {number} limit - Maximum number of responses to analyze
 * @returns {Promise<Object>} Analyzed patterns
 */
export async function analyzeSuccessPatterns(agentType, limit = 50) {
  const highQuality = await feedbackRetrieval.getHighQualityFeedback(agentType, limit, 0.75);

  if (highQuality.length === 0) {
    return {
      count: 0,
      patterns: [],
      summary: 'No high-quality feedback available yet.'
    };
  }

  // Extract patterns from high-quality responses
  const patterns = [];
  const themes = new Map();

  for (const item of highQuality) {
    const content = item.message_content || '';
    const note = item.note || '';

    // Extract key themes (simple keyword analysis)
    const keywords = extractKeywords(content);
    keywords.forEach(keyword => {
      themes.set(keyword, (themes.get(keyword) || 0) + 1);
    });

    // Store example with context
    if (note.length > 0) {
      patterns.push({
        qualityScore: item.quality_score,
        approach: summarizeApproach(content),
        userNote: note,
        timestamp: item.created_at
      });
    }
  }

  // Sort themes by frequency
  const topThemes = Array.from(themes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([theme, count]) => ({ theme, count }));

  return {
    count: highQuality.length,
    averageQuality: highQuality.reduce((sum, item) => sum + item.quality_score, 0) / highQuality.length,
    topThemes,
    examples: patterns.slice(0, 10), // Top 10 examples
    summary: `Analyzed ${highQuality.length} high-quality responses with average score ${(highQuality.reduce((sum, item) => sum + item.quality_score, 0) / highQuality.length).toFixed(2)}`
  };
}

/**
 * Analyze negative feedback to identify common errors
 * @param {string} agentType - Agent type to analyze
 * @param {number} limit - Maximum number of responses to analyze
 * @returns {Promise<Object>} Identified error patterns
 */
export async function analyzeErrorPatterns(agentType, limit = 30) {
  const negative = await feedbackRetrieval.getNegativeFeedback(agentType, limit, 0.4);

  if (negative.length === 0) {
    return {
      count: 0,
      errors: [],
      summary: 'No negative feedback to analyze.'
    };
  }

  const errors = [];
  const errorTypes = new Map();

  for (const item of negative) {
    const note = item.note || '';
    const content = item.message_content || '';

    // Categorize error types based on note content
    const errorType = categorizeError(note);
    errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);

    if (note.length > 0) {
      errors.push({
        qualityScore: item.quality_score,
        errorType,
        issue: note,
        context: summarizeApproach(content),
        timestamp: item.created_at
      });
    }
  }

  // Sort error types by frequency
  const commonErrors = Array.from(errorTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return {
    count: negative.length,
    averageQuality: negative.reduce((sum, item) => sum + item.quality_score, 0) / negative.length,
    commonErrors,
    examples: errors.slice(0, 10), // Top 10 error examples
    summary: `Analyzed ${negative.length} negative responses, identified ${commonErrors.length} error types`
  };
}

/**
 * Analyze user corrections to extract specific fixes
 * @param {string} agentType - Agent type to analyze
 * @param {number} limit - Maximum number of corrections to analyze
 * @returns {Promise<Object>} User corrections
 */
export async function analyzeUserCorrections(agentType, limit = 50) {
  const corrections = await feedbackRetrieval.getUserCorrections(agentType, limit);

  if (corrections.length === 0) {
    return {
      count: 0,
      corrections: [],
      summary: 'No user corrections available.'
    };
  }

  const categorized = {
    factual: [],
    procedural: [],
    formatting: [],
    other: []
  };

  for (const item of corrections) {
    const note = item.note || '';
    const content = item.message_content || '';

    const correction = {
      issue: note,
      context: summarizeApproach(content),
      timestamp: item.created_at
    };

    // Categorize correction type
    if (note.match(/incorrect|wrong|inaccurate|actually/i)) {
      categorized.factual.push(correction);
    } else if (note.match(/should|need to|must|process|step/i)) {
      categorized.procedural.push(correction);
    } else if (note.match(/format|structure|layout|style/i)) {
      categorized.formatting.push(correction);
    } else {
      categorized.other.push(correction);
    }
  }

  return {
    count: corrections.length,
    factual: categorized.factual.slice(0, 10),
    procedural: categorized.procedural.slice(0, 10),
    formatting: categorized.formatting.slice(0, 10),
    other: categorized.other.slice(0, 5),
    summary: `Analyzed ${corrections.length} corrections: ${categorized.factual.length} factual, ${categorized.procedural.length} procedural, ${categorized.formatting.length} formatting`
  };
}

/**
 * Generate complete learning report for an agent
 * @param {string} agentType - Agent type to analyze
 * @returns {Promise<Object>} Complete learning report
 */
export async function generateLearningReport(agentType) {
  console.log(`📊 Generating learning report for ${agentType}...`);

  const [stats, successPatterns, errorPatterns, corrections] = await Promise.all([
    feedbackRetrieval.getFeedbackStats(agentType),
    analyzeSuccessPatterns(agentType),
    analyzeErrorPatterns(agentType),
    analyzeUserCorrections(agentType)
  ]);

  return {
    agentType,
    generatedAt: new Date().toISOString(),
    stats,
    successPatterns,
    errorPatterns,
    corrections,
    summary: {
      totalFeedback: stats.totalFeedback || 0,
      positiveRate: stats.positiveRate || 0,
      averageQuality: stats.averageQuality || 0,
      hasLearnings: (successPatterns.count + errorPatterns.count + corrections.count) > 0
    }
  };
}

/**
 * Extract keywords from content (simple implementation)
 * @param {string} content - Text content to analyze
 * @returns {string[]} Extracted keywords
 */
function extractKeywords(content) {
  if (!content) return [];

  // Remove markdown, punctuation, and extract words
  const text = content
    .replace(/[#*`\[\]()]/g, ' ')
    .toLowerCase();

  const words = text.split(/\s+/);

  // Filter for meaningful words (length > 4, not common words)
  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'your', 'their', 'would', 'could', 'should']);

  return words
    .filter(w => w.length > 4 && !stopWords.has(w))
    .slice(0, 50); // Limit to 50 keywords
}

/**
 * Summarize approach from content (simple implementation)
 * @param {string} content - Text content to summarize
 * @returns {string} Summary
 */
function summarizeApproach(content) {
  if (!content) return 'No content';

  // Take first 150 characters as summary
  const summary = content.substring(0, 150).trim();
  return summary + (content.length > 150 ? '...' : '');
}

/**
 * Categorize error type from note
 * @param {string} note - Feedback note
 * @returns {string} Error category
 */
function categorizeError(note) {
  if (!note) return 'unspecified';

  const lower = note.toLowerCase();

  if (lower.match(/incorrect|wrong|inaccurate|error/i)) {
    return 'incorrect-information';
  } else if (lower.match(/missing|forgot|didn't|omitted/i)) {
    return 'missing-content';
  } else if (lower.match(/format|structure|layout/i)) {
    return 'formatting-issue';
  } else if (lower.match(/confusing|unclear|hard to/i)) {
    return 'clarity-issue';
  } else if (lower.match(/too long|too short|verbose|brief/i)) {
    return 'length-issue';
  } else {
    return 'other';
  }
}
