/**
 * Feedback Analysis Engine (AI-Powered)
 *
 * Analyzes user feedback using Claude Haiku to extract specific, actionable
 * corrections and patterns. Replaces basic keyword counting with actual AI analysis.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as feedbackRetrieval from './retrieval.js';
import { logAPICost } from '../utils/cost-logger.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Strip thinking tags from message content
 * Message content often contains raw JSON with thinking blocks that should not be analyzed
 *
 * @param {string} messageContent - Raw message content from database
 * @returns {string} Visible text content only
 */
function stripThinkingTags(messageContent) {
  if (!messageContent) return '';

  try {
    // Try to parse as JSON array (Claude API format)
    const parsed = JSON.parse(messageContent);

    if (Array.isArray(parsed)) {
      // Filter out thinking blocks, keep only visible content
      const visibleBlocks = parsed.filter(block =>
        block.type !== 'thinking' &&
        block.type !== 'tool_use'
      );

      // Extract text from remaining blocks
      const textParts = visibleBlocks.map(block => {
        if (block.type === 'text') {
          return block.text || '';
        } else if (block.type === 'tool_result') {
          return block.content || '';
        }
        return '';
      });

      return textParts.join('\n\n').trim();
    }
  } catch (e) {
    // Not JSON, return as-is
    return messageContent;
  }

  return messageContent;
}

/**
 * Analyze high-quality feedback using Claude Haiku to extract success patterns
 *
 * @param {string} agentType - Agent type to analyze
 * @param {number} limit - Maximum number of responses to analyze
 * @returns {Promise<Object>} Analyzed patterns with AI-extracted insights
 */
export async function analyzeSuccessPatterns(agentType, limit = 50) {
  console.log(`🔍 Analyzing success patterns for ${agentType} using AI...`);

  const highQuality = await feedbackRetrieval.getHighQualityFeedback(agentType, limit, 0.75);

  if (highQuality.length === 0) {
    return {
      count: 0,
      averageQuality: 0,
      topThemes: [],
      examples: [],
      summary: 'No high-quality feedback available yet.'
    };
  }

  // Prepare feedback batch for AI analysis
  const feedbackBatch = highQuality.map(item => ({
    messageContent: stripThinkingTags(item.message_content),
    userFeedback: item.note || '',
    qualityScore: item.quality_score,
    timestamp: item.created_at
  }));

  try {
    const analysisPrompt = `You are analyzing positive user feedback for an AI agent (${agentType}) to extract success patterns.

You will receive ${feedbackBatch.length} examples of high-quality responses that users rated positively.

For each example, the user gave positive feedback and the response had a quality score of 0.75+.

Your task:
1. Identify specific patterns that led to success (e.g., "provided detailed eligibility breakdown", "used bullet points for clarity", "referenced specific program rules")
2. Extract actionable themes that the agent should continue doing
3. Find concrete examples where user feedback explains what worked well

Return ONLY valid JSON (no markdown, no explanation):
{
  "themes": [
    {
      "theme": "Clear, specific description (2-3 words)",
      "description": "What the agent did that worked well",
      "count": <number of times this pattern appeared>,
      "actionable": "Specific instruction for agent to continue this behavior"
    }
  ],
  "examples": [
    {
      "pattern": "Brief description of what worked",
      "userFeedback": "What the user said (direct quote if available)",
      "qualityScore": <score>,
      "actionable": "Concrete instruction based on this example"
    }
  ]
}

Feedback data:
${JSON.stringify(feedbackBatch.slice(0, 20), null, 2)}

Focus on SPECIFIC, ACTIONABLE patterns. Avoid generic themes like "helpful" or "good". Extract concrete behaviors.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: analysisPrompt
      }]
    });

    // Log API cost
    if (response.usage) {
      logAPICost({
        usage: response.usage,
        model: 'claude-haiku-4-5-20251001',
        source: 'feedback-learning-success-analysis',
        agentType,
        metadata: {
          feedbackCount: feedbackBatch.length
        }
      });
    }

    // Parse AI response
    const content = response.content[0].text.trim();
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || [null, content];
    const jsonText = jsonMatch[1] || content;
    const analysis = JSON.parse(jsonText);

    // Format for memory-writer
    const topThemes = (analysis.themes || []).slice(0, 10).map(t => ({
      theme: t.theme,
      count: t.count || 1,
      description: t.description,
      actionable: t.actionable
    }));

    const examples = (analysis.examples || []).slice(0, 10).map(ex => ({
      qualityScore: ex.qualityScore || 1.0,
      approach: ex.actionable || ex.pattern,
      userNote: ex.userFeedback
    }));

    const avgQuality = highQuality.reduce((sum, item) => sum + item.quality_score, 0) / highQuality.length;

    return {
      count: highQuality.length,
      averageQuality: avgQuality,
      topThemes,
      examples,
      summary: `AI-analyzed ${highQuality.length} high-quality responses, identified ${topThemes.length} actionable patterns`
    };

  } catch (error) {
    console.error('Error in AI analysis of success patterns:', error);

    // Fallback to basic summary if AI fails
    const avgQuality = highQuality.reduce((sum, item) => sum + item.quality_score, 0) / highQuality.length;

    return {
      count: highQuality.length,
      averageQuality: avgQuality,
      topThemes: [{ theme: 'analysis-failed', count: 1 }],
      examples: [],
      summary: `Analyzed ${highQuality.length} responses (AI analysis failed: ${error.message})`
    };
  }
}

/**
 * Analyze negative feedback using Claude Haiku to identify specific errors
 *
 * @param {string} agentType - Agent type to analyze
 * @param {number} limit - Maximum number of responses to analyze
 * @returns {Promise<Object>} Identified error patterns with AI-extracted corrections
 */
export async function analyzeErrorPatterns(agentType, limit = 30) {
  console.log(`🔍 Analyzing error patterns for ${agentType} using AI...`);

  const negative = await feedbackRetrieval.getNegativeFeedback(agentType, limit, 0.4);

  if (negative.length === 0) {
    return {
      count: 0,
      averageQuality: 0,
      commonErrors: [],
      examples: [],
      summary: 'No negative feedback to analyze.'
    };
  }

  // Prepare feedback batch for AI analysis
  const feedbackBatch = negative.map(item => ({
    messageContent: stripThinkingTags(item.message_content),
    userFeedback: item.note || '',
    qualityScore: item.quality_score,
    timestamp: item.created_at
  }));

  try {
    const analysisPrompt = `You are analyzing negative user feedback for an AI agent (${agentType}) to extract specific errors and corrections.

You will receive ${feedbackBatch.length} examples where users gave negative feedback (thumbs down).

Your task:
1. Identify SPECIFIC errors the agent made (not generic issues like "not helpful")
2. Extract the CORRECT behavior from user corrections
3. Categorize errors by type: factual_error | wrong_format | missed_requirement | wrong_procedure | tone_issue

Return ONLY valid JSON (no markdown, no explanation):
{
  "errorCategories": [
    {
      "type": "factual_error | wrong_format | missed_requirement | wrong_procedure | tone_issue | other",
      "description": "Brief description of error type",
      "count": <number of occurrences>
    }
  ],
  "specificErrors": [
    {
      "errorType": "category from above",
      "whatWentWrong": "What the agent said/did that was incorrect",
      "correctBehavior": "What the agent SHOULD have said/done instead",
      "userFeedback": "Direct quote from user feedback explaining the issue",
      "qualityScore": <score>
    }
  ]
}

Key: Extract SPECIFIC corrections. If user says "this is wrong, actually X is correct", capture both what was wrong AND what X is.

Feedback data:
${JSON.stringify(feedbackBatch.slice(0, 20), null, 2)}

Focus on extracting actionable corrections, not vague complaints.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: analysisPrompt
      }]
    });

    // Log API cost
    if (response.usage) {
      logAPICost({
        usage: response.usage,
        model: 'claude-haiku-4-5-20251001',
        source: 'feedback-learning-error-analysis',
        agentType,
        metadata: {
          feedbackCount: feedbackBatch.length
        }
      });
    }

    // Parse AI response
    const content = response.content[0].text.trim();
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || [null, content];
    const jsonText = jsonMatch[1] || content;
    const analysis = JSON.parse(jsonText);

    // Format for memory-writer
    const commonErrors = (analysis.errorCategories || []).map(cat => ({
      type: cat.type,
      count: cat.count || 1,
      description: cat.description
    }));

    const examples = (analysis.specificErrors || []).slice(0, 10).map(err => ({
      errorType: err.errorType,
      issue: err.userFeedback || err.whatWentWrong,
      context: `❌ WRONG: ${err.whatWentWrong}\n✅ CORRECT: ${err.correctBehavior}`,
      qualityScore: err.qualityScore || 0.25
    }));

    const avgQuality = negative.reduce((sum, item) => sum + item.quality_score, 0) / negative.length;

    return {
      count: negative.length,
      averageQuality: avgQuality,
      commonErrors,
      examples,
      summary: `AI-analyzed ${negative.length} negative responses, identified ${commonErrors.length} error types`
    };

  } catch (error) {
    console.error('Error in AI analysis of error patterns:', error);

    // Fallback to basic summary
    const avgQuality = negative.reduce((sum, item) => sum + item.quality_score, 0) / negative.length;

    return {
      count: negative.length,
      averageQuality: avgQuality,
      commonErrors: [{ type: 'analysis-failed', count: 1 }],
      examples: [],
      summary: `Analyzed ${negative.length} responses (AI analysis failed: ${error.message})`
    };
  }
}

/**
 * Analyze user corrections using Claude Haiku to extract specific fixes
 *
 * @param {string} agentType - Agent type to analyze
 * @param {number} limit - Maximum number of corrections to analyze
 * @returns {Promise<Object>} Structured user corrections
 */
export async function analyzeUserCorrections(agentType, limit = 50) {
  console.log(`🔍 Analyzing user corrections for ${agentType} using AI...`);

  const corrections = await feedbackRetrieval.getUserCorrections(agentType, limit);

  if (corrections.length === 0) {
    return {
      count: 0,
      factual: [],
      procedural: [],
      formatting: [],
      other: [],
      summary: 'No user corrections available.'
    };
  }

  try {
    const correctionsData = corrections.map(c => ({
      correctionText: c.note,
      timestamp: c.created_at
    }));

    const analysisPrompt = `You are analyzing user corrections for an AI agent (${agentType}).

These are messages where users explicitly corrected the agent mid-conversation, using words like "actually", "incorrect", "wrong", "should be".

Your task: Extract SPECIFIC, ACTIONABLE corrections and categorize them.

Return ONLY valid JSON (no markdown):
{
  "factual": [
    {
      "issue": "Brief description of what was wrong",
      "context": "❌ AGENT SAID: [what agent said]\n✅ CORRECT: [what is actually correct]"
    }
  ],
  "procedural": [
    {
      "issue": "Brief description of procedural error",
      "context": "❌ AGENT DID: [wrong process]\n✅ SHOULD DO: [correct process]"
    }
  ],
  "formatting": [
    {
      "issue": "Brief description of format issue",
      "context": "❌ AGENT USED: [wrong format]\n✅ SHOULD USE: [correct format]"
    }
  ]
}

Categories:
- factual: Wrong information, incorrect facts, eligibility rules
- procedural: Wrong process, steps, methodology
- formatting: Wrong structure, layout, number of items

Corrections data:
${JSON.stringify(correctionsData, null, 2)}

Extract SPECIFIC rules. If user says "email newsletters are ineligible, only trade event ads are eligible", capture both parts.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: analysisPrompt
      }]
    });

    // Log API cost
    if (response.usage) {
      logAPICost({
        usage: response.usage,
        model: 'claude-haiku-4-5-20251001',
        source: 'feedback-learning-corrections-analysis',
        agentType,
        metadata: {
          correctionsCount: corrections.length
        }
      });
    }

    // Parse AI response
    const content = response.content[0].text.trim();
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || [null, content];
    const jsonText = jsonMatch[1] || content;
    const analysis = JSON.parse(jsonText);

    return {
      count: corrections.length,
      factual: (analysis.factual || []).slice(0, 10),
      procedural: (analysis.procedural || []).slice(0, 10),
      formatting: (analysis.formatting || []).slice(0, 10),
      other: [],
      summary: `AI-analyzed ${corrections.length} corrections: ${analysis.factual?.length || 0} factual, ${analysis.procedural?.length || 0} procedural, ${analysis.formatting?.length || 0} formatting`
    };

  } catch (error) {
    console.error('Error in AI analysis of user corrections:', error);

    // Fallback to basic categorization
    const categorized = {
      factual: [],
      procedural: [],
      formatting: [],
      other: []
    };

    for (const item of corrections) {
      const note = item.note || '';
      const correction = {
        issue: note.substring(0, 100) + (note.length > 100 ? '...' : ''),
        context: 'AI analysis failed, see raw feedback above'
      };

      // Simple keyword-based fallback
      if (note.match(/incorrect|wrong|inaccurate|actually|not correct/i)) {
        categorized.factual.push(correction);
      } else if (note.match(/should|need to|must|process|step/i)) {
        categorized.procedural.push(correction);
      } else if (note.match(/format|structure|layout|style|bullet/i)) {
        categorized.formatting.push(correction);
      } else {
        categorized.other.push(correction);
      }
    }

    return {
      count: corrections.length,
      ...categorized,
      summary: `Analyzed ${corrections.length} corrections (AI analysis failed, using fallback)`
    };
  }
}

/**
 * Generate complete learning report for an agent
 *
 * @param {string} agentType - Agent type to analyze
 * @returns {Promise<Object>} Complete learning report with AI-extracted patterns
 */
export async function generateLearningReport(agentType) {
  console.log(`📊 Generating AI-powered learning report for ${agentType}...`);

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
