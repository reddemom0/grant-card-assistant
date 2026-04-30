/**
 * LLM Grader for Quality Evaluation
 *
 * Uses Claude API (LLM-as-judge) to evaluate agent output quality
 * across dimensions like tone, clarity, strategic value, and compliance
 * with style guidelines.
 */

const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Default grading model (fast and cost-effective for evaluation)
const DEFAULT_GRADING_MODEL = 'claude-sonnet-4.5-20250929';

/**
 * Grade agent output using LLM-as-judge
 *
 * @param {Object} params - Grading parameters
 * @param {string} params.task - Description of what the agent was asked to do
 * @param {string} params.output - Agent's output to evaluate
 * @param {Object} params.rubric - Grading rubric
 * @param {Array<string>} params.rubric.criteria - Evaluation criteria
 * @param {string} params.rubric.scale - Grading scale (e.g., "1-5 where 5 is excellent")
 * @param {string} params.context - Optional context (original input, knowledge base, etc.)
 * @param {string} params.model - Claude model to use for grading
 * @returns {Promise<Object>} Grading result with scores and feedback
 */
async function gradeWithLLM(params) {
  const {
    task,
    output,
    rubric,
    context = null,
    model = DEFAULT_GRADING_MODEL
  } = params;

  // Build grading prompt
  const gradingPrompt = buildGradingPrompt(task, output, rubric, context);

  try {
    // Call Claude API for grading
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      temperature: 0, // Deterministic grading
      messages: [
        {
          role: 'user',
          content: gradingPrompt
        }
      ]
    });

    const gradingContent = response.content[0].text;

    // Parse grading response
    const parsed = parseGradingResponse(gradingContent, rubric.criteria);

    return {
      overallScore: parsed.overallScore,
      scores: parsed.scores,
      feedback: parsed.feedback,
      rawGrading: gradingContent,
      model
    };

  } catch (error) {
    throw new Error(`LLM grading failed: ${error.message}`);
  }
}

/**
 * Build grading prompt for LLM judge
 *
 * @param {string} task - Task description
 * @param {string} output - Output to grade
 * @param {Object} rubric - Grading rubric
 * @param {string} context - Optional context
 * @returns {string} Complete grading prompt
 */
function buildGradingPrompt(task, output, rubric, context) {
  let prompt = `You are an expert evaluator assessing the quality of AI-generated content.

# TASK
The AI was asked to: ${task}

`;

  if (context) {
    prompt += `# CONTEXT
${context}

`;
  }

  prompt += `# OUTPUT TO EVALUATE
${output}

# GRADING RUBRIC
Scale: ${rubric.scale}

Evaluate the output on these criteria:
${rubric.criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join('\n')}

# INSTRUCTIONS
1. For each criterion, provide:
   - A numerical score based on the scale
   - Brief justification (1-2 sentences)

2. Calculate an overall score (average of all criteria scores)

3. Provide overall feedback on strengths and areas for improvement

# RESPONSE FORMAT
Use this exact format:

## Criterion Scores

**Criterion 1: [Name]**
Score: [X]
Justification: [Your reasoning]

**Criterion 2: [Name]**
Score: [X]
Justification: [Your reasoning]

[Continue for all criteria]

## Overall Score
[Average score]

## Overall Feedback
[2-3 sentences summarizing assessment]
`;

  return prompt;
}

/**
 * Parse grading response to extract scores and feedback
 *
 * @param {string} gradingContent - Raw grading response
 * @param {Array<string>} criteria - List of criteria names
 * @returns {Object} Parsed scores and feedback
 */
function parseGradingResponse(gradingContent, criteria) {
  const scores = {};
  let overallScore = null;
  let feedback = '';

  // Extract individual criterion scores
  const scorePattern = /Score:\s*(\d+(?:\.\d+)?)/gi;
  const matches = [...gradingContent.matchAll(scorePattern)];

  if (matches.length >= criteria.length) {
    criteria.forEach((criterion, index) => {
      if (matches[index]) {
        const score = parseFloat(matches[index][1]);
        // Normalize criterion name for object key
        const key = criterion
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
        scores[key] = score;
      }
    });
  }

  // Extract overall score
  const overallMatch = gradingContent.match(/##\s*Overall\s*Score\s*[\r\n]+\s*(\d+(?:\.\d+)?)/i);
  if (overallMatch) {
    overallScore = parseFloat(overallMatch[1]);
  } else if (Object.keys(scores).length > 0) {
    // Calculate from individual scores if not explicitly stated
    const scoreValues = Object.values(scores);
    overallScore = scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length;
  }

  // Extract overall feedback
  const feedbackMatch = gradingContent.match(/##\s*Overall\s*Feedback\s*[\r\n]+\s*(.+?)(?:\n\n|$)/is);
  if (feedbackMatch) {
    feedback = feedbackMatch[1].trim();
  }

  return {
    scores,
    overallScore,
    feedback
  };
}

/**
 * Grade multiple outputs and calculate aggregate statistics
 *
 * @param {Array<Object>} gradingTasks - Array of grading task objects
 * @returns {Promise<Object>} Aggregate grading results
 */
async function gradeMultiple(gradingTasks) {
  const results = [];

  for (const task of gradingTasks) {
    const result = await gradeWithLLM(task);
    results.push(result);
  }

  // Calculate aggregate statistics
  const allScores = results.map(r => r.overallScore).filter(s => s !== null);
  const avgScore = allScores.length > 0
    ? allScores.reduce((sum, score) => sum + score, 0) / allScores.length
    : null;

  const minScore = allScores.length > 0 ? Math.min(...allScores) : null;
  const maxScore = allScores.length > 0 ? Math.max(...allScores) : null;

  return {
    results,
    aggregate: {
      averageScore: avgScore,
      minScore,
      maxScore,
      totalGraded: results.length
    }
  };
}

/**
 * Create standard rubric for grant writing quality
 *
 * @returns {Object} Grant writing rubric
 */
function createGrantWritingRubric() {
  return {
    criteria: [
      'Clarity and coherence of writing',
      'Professional tone appropriate for grant context',
      'Strategic value and actionability of recommendations',
      'Completeness of information provided',
      'Adherence to specified format and style guidelines'
    ],
    scale: '1-5 where 1=Poor, 2=Below Average, 3=Acceptable, 4=Good, 5=Excellent'
  };
}

/**
 * Create standard rubric for compliance analysis quality
 *
 * @returns {Object} Compliance analysis rubric
 */
function createComplianceRubric() {
  return {
    criteria: [
      'Accuracy of compliance assessment',
      'Thoroughness of analysis (all relevant rules considered)',
      'Clarity of verdict and reasoning',
      'Actionability of recommendations',
      'Appropriate use of supporting evidence'
    ],
    scale: '1-5 where 1=Poor, 2=Below Average, 3=Acceptable, 4=Good, 5=Excellent'
  };
}

/**
 * Create standard rubric for strategic insight quality
 *
 * @returns {Object} Strategic insight rubric
 */
function createInsightRubric() {
  return {
    criteria: [
      'Depth of strategic insight (not generic advice)',
      'Relevance to specific grant opportunity',
      'Competitive intelligence value',
      'Clarity and conciseness',
      'Actionability for client decision-making'
    ],
    scale: '1-5 where 1=Poor, 2=Below Average, 3=Acceptable, 4=Good, 5=Excellent'
  };
}

/**
 * Validate grading result meets quality threshold
 *
 * @param {Object} gradingResult - Result from gradeWithLLM
 * @param {number} threshold - Minimum acceptable score (default: 4.0)
 * @returns {Object} Validation result
 */
function validateGradingThreshold(gradingResult, threshold = 4.0) {
  const meetsThreshold = gradingResult.overallScore >= threshold;

  return {
    passed: meetsThreshold,
    score: gradingResult.overallScore,
    threshold,
    gap: threshold - gradingResult.overallScore,
    feedback: gradingResult.feedback
  };
}

module.exports = {
  // Core grading function
  gradeWithLLM,

  // Batch grading
  gradeMultiple,

  // Standard rubrics
  createGrantWritingRubric,
  createComplianceRubric,
  createInsightRubric,

  // Validation
  validateGradingThreshold,

  // Internal utilities (exported for testing)
  buildGradingPrompt,
  parseGradingResponse,

  // Constants
  DEFAULT_GRADING_MODEL
};
