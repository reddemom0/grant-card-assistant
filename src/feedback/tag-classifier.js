/**
 * Feedback Tag Classification System
 *
 * Research-based hybrid approach optimized for small teams (12 people)
 * - Tier 1: High-confidence keyword matching (40% of cases)
 * - Tier 2: LLM classification via Claude Haiku (50% of cases)
 * - Tier 3: Manual review queue (10% of cases)
 *
 * Key Principles:
 * 1. Precision over recall (better to miss than misclassify)
 * 2. Confidence thresholds prevent metric pollution
 * 3. Transparent (users see applied tags)
 * 4. Correctable (manual override supported)
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ============================================
// TIER 1: KEYWORD-BASED CLASSIFICATION
// ============================================

/**
 * Keyword patterns with confidence scores
 * Based on analysis of common user feedback patterns
 */
const KEYWORD_PATTERNS = {
  // ACCURACY ISSUES (30% weight in quality score)
  'missed-information': {
    keywords: [
      'missed', 'missing', "didn't include", 'forgot', 'left out',
      'incomplete', 'not all', 'only got', "didn't capture"
    ],
    confidence: 0.90,
    category: 'accuracy'
  },
  'hallucination': {
    keywords: [
      'not in the document', "wasn't in", 'made up', 'fabricated',
      'wrong information', "this isn't in", 'incorrect data',
      'where did this come from', "i didn't provide"
    ],
    confidence: 0.95,
    category: 'accuracy'
  },
  'wrong-data': {
    keywords: [
      'wrong', 'incorrect', 'inaccurate', 'mistaken', 'error in',
      'wrong number', 'wrong date', 'wrong name'
    ],
    confidence: 0.85,
    category: 'accuracy'
  },
  'incomplete-extraction': {
    keywords: [
      'incomplete', 'partial', 'more needed', 'add more',
      'expand on', 'not enough detail'
    ],
    confidence: 0.80,
    category: 'accuracy'
  },

  // INSTRUCTION FOLLOWING ISSUES (25% weight)
  'not-what-i-asked': {
    keywords: [
      'not what i asked', "didn't ask for", 'wrong section',
      'asked for X not Y', "that's not what i wanted",
      'wrong part', 'different section'
    ],
    confidence: 0.90,
    category: 'instruction'
  },
  'ignored-request': {
    keywords: [
      'ignored', "didn't do", "didn't follow", 'skipped',
      'overlooked', "didn't address"
    ],
    confidence: 0.85,
    category: 'instruction'
  },
  'did-opposite': {
    keywords: [
      'opposite', 'reversed', 'backwards', 'inverse',
      'wrong direction', 'contrary to'
    ],
    confidence: 0.95,
    category: 'instruction'
  },

  // FORMAT ISSUES (10% weight)
  'wrong-format': {
    keywords: [
      'wrong format', 'formatting', 'format issue', 'layout',
      'structure is wrong', 'format problem'
    ],
    confidence: 0.90,
    category: 'format'
  },
  'missing-sections': {
    keywords: [
      'missing section', 'no section', 'forgot section',
      'section missing', 'missing part'
    ],
    confidence: 0.90,
    category: 'format'
  },
  'too-long': {
    keywords: [
      'too long', 'too wordy', 'too verbose', 'make shorter',
      'too much', 'word limit', 'exceeded limit'
    ],
    confidence: 0.95,
    category: 'format'
  },
  'wrong-structure': {
    keywords: [
      'wrong structure', 'structure', 'organization',
      'order is wrong', 'rearrange', 'restructure'
    ],
    confidence: 0.80,
    category: 'format'
  },

  // WORKFLOW ISSUES (10% weight)
  'already-asked': {
    keywords: [
      'already told you', 'already said', 'already provided',
      'already gave', 'i already', 'told you before',
      're-asking', 'asking again'
    ],
    confidence: 0.95,
    category: 'workflow'
  },
  'repeated-step': {
    keywords: [
      'repeated', 'again', 'duplicate', 'already did',
      'doing twice', 're-doing', 'redundant'
    ],
    confidence: 0.85,
    category: 'workflow'
  },
  'wrong-sequence': {
    keywords: [
      'wrong order', 'sequence', 'out of order',
      'should have done first', 'premature'
    ],
    confidence: 0.85,
    category: 'workflow'
  },
  'skipped-step': {
    keywords: [
      'skipped', 'missed step', "didn't verify", "didn't check",
      'forgot to', 'should have verified'
    ],
    confidence: 0.85,
    category: 'workflow'
  },

  // CONTEXT USAGE ISSUES (5% weight)
  'didnt-use-hubspot': {
    keywords: [
      "didn't use hubspot", "didn't check hubspot", "didn't load",
      'hubspot has', 'already in hubspot', 'check hubspot'
    ],
    confidence: 0.90,
    category: 'context'
  },
  'asked-for-provided-info': {
    keywords: [
      'asked for info i provided', 'i already gave you',
      'in the document i uploaded', 'in the file'
    ],
    confidence: 0.85,
    category: 'context'
  },
  'ignored-uploaded-file': {
    keywords: [
      "didn't read", "didn't use the file", "didn't check",
      'ignored the document', 'file has', 'document shows'
    ],
    confidence: 0.90,
    category: 'context'
  },

  // SUCCESS INDICATORS (positive signals)
  'perfect': {
    keywords: [
      'perfect', 'exactly', 'precisely', 'spot on',
      'nailed it', 'excellent', 'fantastic', 'great job'
    ],
    confidence: 0.95,
    category: 'success'
  },
  'ready-to-submit': {
    keywords: [
      'ready to submit', 'submitting now', "i'll submit",
      'ready to go', 'ready for submission', 'looks good'
    ],
    confidence: 0.95,
    category: 'success'
  },
  'exactly-what-i-needed': {
    keywords: [
      'exactly what i needed', 'just what i wanted',
      'this is exactly', 'precisely what', 'exactly right'
    ],
    confidence: 0.95,
    category: 'success'
  },
  'great-work': {
    keywords: [
      'great work', 'well done', 'amazing', 'awesome',
      'brilliant', 'impressive'
    ],
    confidence: 0.90,
    category: 'success'
  }
};

/**
 * Classify feedback using keyword matching
 * Returns array of tags with confidence scores
 */
function classifyByKeywords(feedbackText) {
  const text = feedbackText.toLowerCase();
  const matches = [];

  for (const [tag, pattern] of Object.entries(KEYWORD_PATTERNS)) {
    for (const keyword of pattern.keywords) {
      if (text.includes(keyword)) {
        matches.push({
          tag,
          category: pattern.category,
          confidence: pattern.confidence,
          method: 'keyword',
          matched_phrase: keyword
        });
        break; // Only count each tag once
      }
    }
  }

  return matches;
}

// ============================================
// TIER 2: LLM-BASED CLASSIFICATION
// ============================================

/**
 * Use Claude Haiku to classify ambiguous feedback
 * Cost: ~$0.0001 per classification
 */
async function classifyByLLM(feedbackText, agentType) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0,
      system: `You are a feedback classification system for AI agent performance.

Your job: Analyze user feedback and identify which specific issues are present.

Available tags:
ACCURACY: missed-information, hallucination, wrong-data, incomplete-extraction
INSTRUCTION: not-what-i-asked, wrong-section, ignored-request, did-opposite
FORMAT: wrong-format, missing-sections, too-long, wrong-structure
WORKFLOW: already-asked, repeated-step, wrong-sequence, skipped-step
CONTEXT: didnt-use-hubspot, asked-for-provided-info, ignored-uploaded-file
SUCCESS: perfect, ready-to-submit, exactly-what-i-needed, great-work

Return ONLY a JSON array of tags with confidence (0-1):
[{"tag": "tag-name", "confidence": 0.85, "reasoning": "brief explanation"}]

Rules:
- Only tag issues explicitly mentioned or strongly implied
- Confidence <0.70 = don't tag
- Maximum 3 tags per feedback
- Be conservative: precision over recall`,
      messages: [{
        role: 'user',
        content: `Agent type: ${agentType}
Feedback: "${feedbackText}"

What tags apply?`
      }]
    });

    const content = response.content[0].text;

    // Parse JSON response
    try {
      const tags = JSON.parse(content);
      return tags.map(t => ({
        tag: t.tag,
        category: getCategoryFromTag(t.tag),
        confidence: t.confidence,
        method: 'llm',
        reasoning: t.reasoning
      }));
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      return [];
    }

  } catch (error) {
    console.error('LLM classification error:', error);
    return [];
  }
}

/**
 * Get category from tag name
 */
function getCategoryFromTag(tag) {
  const categoryMap = {
    'missed-information': 'accuracy',
    'hallucination': 'accuracy',
    'wrong-data': 'accuracy',
    'incomplete-extraction': 'accuracy',
    'not-what-i-asked': 'instruction',
    'wrong-section': 'instruction',
    'ignored-request': 'instruction',
    'did-opposite': 'instruction',
    'wrong-format': 'format',
    'missing-sections': 'format',
    'too-long': 'format',
    'wrong-structure': 'format',
    'already-asked': 'workflow',
    'repeated-step': 'workflow',
    'wrong-sequence': 'workflow',
    'skipped-step': 'workflow',
    'didnt-use-hubspot': 'context',
    'asked-for-provided-info': 'context',
    'ignored-uploaded-file': 'context',
    'perfect': 'success',
    'ready-to-submit': 'success',
    'exactly-what-i-needed': 'success',
    'great-work': 'success'
  };
  return categoryMap[tag] || 'unknown';
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

/**
 * Classify feedback text and return tags with confidence scores
 *
 * @param {string} feedbackText - User's feedback text
 * @param {string} agentType - Type of agent (for context)
 * @param {object} options - Configuration options
 * @returns {Promise<Array>} Array of tag objects with confidence scores
 */
export async function classifyFeedback(feedbackText, agentType, options = {}) {
  const {
    confidenceThreshold = 0.70,
    useLLM = true,
    maxTags = 5
  } = options;

  console.log(`\n🏷️  Classifying feedback for ${agentType}`);
  console.log(`📝 Text: "${feedbackText.substring(0, 100)}..."`);

  // TIER 1: Try keyword matching first
  const keywordTags = classifyByKeywords(feedbackText);
  console.log(`🔑 Keyword matches: ${keywordTags.length}`);

  // Filter by confidence threshold
  const highConfidenceKeywordTags = keywordTags.filter(t => t.confidence >= confidenceThreshold);

  // If we got high-confidence keyword matches, use them
  if (highConfidenceKeywordTags.length > 0) {
    console.log(`✅ Using ${highConfidenceKeywordTags.length} high-confidence keyword tags`);
    return deduplicateTags(highConfidenceKeywordTags).slice(0, maxTags);
  }

  // TIER 2: Use LLM for ambiguous cases
  if (useLLM && feedbackText.trim().length > 10) {
    console.log(`🤖 Using LLM classification (ambiguous feedback)`);
    const llmTags = await classifyByLLM(feedbackText, agentType);
    const highConfidenceLLMTags = llmTags.filter(t => t.confidence >= confidenceThreshold);

    if (highConfidenceLLMTags.length > 0) {
      console.log(`✅ LLM found ${highConfidenceLLMTags.length} tags`);
      return deduplicateTags(highConfidenceLLMTags).slice(0, maxTags);
    }
  }

  // TIER 3: No confident tags found
  console.log(`⚠️  No confident tags found (queue for manual review)`);
  return [];
}

/**
 * Remove duplicate tags (keep highest confidence)
 */
function deduplicateTags(tags) {
  const tagMap = new Map();

  for (const tag of tags) {
    if (!tagMap.has(tag.tag) || tag.confidence > tagMap.get(tag.tag).confidence) {
      tagMap.set(tag.tag, tag);
    }
  }

  return Array.from(tagMap.values());
}

/**
 * Get human-readable explanation of a tag
 */
export function getTagExplanation(tag) {
  const explanations = {
    'missed-information': 'Agent missed or omitted important information',
    'hallucination': 'Agent included information not in source documents',
    'wrong-data': 'Agent provided incorrect data or facts',
    'incomplete-extraction': 'Agent extracted information but not completely',
    'not-what-i-asked': 'Agent delivered something different from request',
    'wrong-section': 'Agent worked on wrong section',
    'ignored-request': 'Agent ignored a specific user request',
    'did-opposite': 'Agent did the opposite of what was asked',
    'wrong-format': 'Output format doesn\'t match requirements',
    'missing-sections': 'Required sections are missing',
    'too-long': 'Output exceeds length limits',
    'wrong-structure': 'Document structure is incorrect',
    'already-asked': 'Agent re-asked for information already provided',
    'repeated-step': 'Agent repeated a step already completed',
    'wrong-sequence': 'Steps performed in wrong order',
    'skipped-step': 'Agent skipped a required verification step',
    'didnt-use-hubspot': 'Agent didn\'t use available HubSpot data',
    'asked-for-provided-info': 'Agent asked for info user already provided',
    'ignored-uploaded-file': 'Agent didn\'t use uploaded documents',
    'perfect': 'User expressed complete satisfaction',
    'ready-to-submit': 'User indicated output is ready to use',
    'exactly-what-i-needed': 'Output matched user needs precisely',
    'great-work': 'User praised the agent\'s work'
  };
  return explanations[tag] || 'Unknown issue';
}

/**
 * Batch classify multiple feedback items
 * Useful for backfilling historical feedback
 */
export async function classifyBatch(feedbackItems, options = {}) {
  const results = [];

  for (const item of feedbackItems) {
    const tags = await classifyFeedback(
      item.feedbackText,
      item.agentType,
      options
    );

    results.push({
      feedbackId: item.id,
      conversationId: item.conversationId,
      tags
    });

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}
