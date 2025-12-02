/**
 * Agent Quality Metrics API
 *
 * Provides agent performance data for the quality matrix dashboard
 */

import { query } from '../src/database/connection.js';

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require authentication
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized - Please log in'
    });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      allowedMethods: ['GET']
    });
  }

  try {
    const { action, agentType, days = 7 } = req.query;
    const daysInt = parseInt(days);

    if (isNaN(daysInt) || daysInt < 1) {
      return res.status(400).json({
        error: 'Invalid days parameter',
        message: 'days must be a positive integer'
      });
    }

    // Action: Get agent details
    if (action === 'agent-details') {
      if (!agentType) {
        return res.status(400).json({
          error: 'Missing agentType parameter'
        });
      }

      const details = await getAgentDetails(agentType, daysInt);
      return res.status(200).json(details);
    }

    // Default action: Get quality matrix
    const matrixData = await getAgentQualityMatrix(daysInt);
    return res.status(200).json(matrixData);

  } catch (error) {
    console.error('❌ Agent quality API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get agent quality matrix data
 */
async function getAgentQualityMatrix(days) {
  console.log(`📊 Fetching agent quality matrix for last ${days} days`);

  // Get all agents
  const agents = [
    'grant-card-generator',
    'etg-writer',
    'bcafe-writer',
    'canexport-claims',
    'readiness-strategist'
  ];

  const agentMetrics = [];

  for (const agentType of agents) {
    try {
      const metrics = await calculateAgentMetrics(agentType, days);
      agentMetrics.push({
        agentType,
        agentName: getAgentDisplayName(agentType),
        ...metrics
      });
    } catch (error) {
      console.error(`Error calculating metrics for ${agentType}:`, error);
      // Push placeholder data if calculation fails
      agentMetrics.push({
        agentType,
        agentName: getAgentDisplayName(agentType),
        conversationCount: 0,
        accuracyScore: null,
        workflowScore: null,
        formatScore: null,
        instructionScore: null,
        contextScore: null,
        avgRevisions: null,
        positiveRate: null,
        qualityScore: null
      });
    }
  }

  return {
    success: true,
    timeFilter: `${days} days`,
    agents: agentMetrics,
    summary: {
      totalConversations: agentMetrics.reduce((sum, a) => sum + a.conversationCount, 0),
      avgQualityScore: calculateAverage(agentMetrics.map(a => a.qualityScore)),
      avgPositiveRate: calculateAverage(agentMetrics.map(a => a.positiveRate))
    }
  };
}

/**
 * Calculate metrics for a specific agent
 */
async function calculateAgentMetrics(agentType, days) {
  // Get conversation count and feedback metrics
  const metricsResult = await query(`
    SELECT
      COUNT(DISTINCT c.id) as conversation_count,
      COUNT(DISTINCT cf.id) as total_feedback,
      COUNT(DISTINCT cf.id) FILTER (WHERE cf.rating = 'positive') as positive_feedback,
      COUNT(DISTINCT cf.id) FILTER (WHERE cf.rating = 'negative') as negative_feedback,
      AVG(cf.revision_count) as avg_revisions,
      AVG(cf.completion_time_seconds) as avg_completion_seconds
    FROM conversations c
    LEFT JOIN conversation_feedback cf ON c.id = cf.conversation_id
    WHERE c.agent_type = $1
    AND c.created_at >= NOW() - INTERVAL '${days} days'
  `, [agentType]);

  const metrics = metricsResult.rows[0];
  const conversationCount = parseInt(metrics.conversation_count) || 0;
  const totalFeedback = parseInt(metrics.total_feedback) || 0;

  // If no conversations, return zeros
  if (conversationCount === 0) {
    return {
      conversationCount: 0,
      accuracyScore: null,
      workflowScore: null,
      formatScore: null,
      instructionScore: null,
      contextScore: null,
      avgRevisions: null,
      positiveRate: null,
      qualityScore: null
    };
  }

  // Calculate positive feedback rate
  const positiveRate = totalFeedback > 0
    ? (parseInt(metrics.positive_feedback) / totalFeedback) * 100
    : null;

  // Get issue counts from feedback tags
  const issuesResult = await query(`
    SELECT
      COUNT(DISTINCT c.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM feedback_tags ft
          JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
          WHERE cf2.conversation_id = c.id
          AND ft.tag IN ('missed-information', 'hallucination', 'wrong-data', 'incomplete-extraction')
        )
      ) as conversations_with_accuracy_issues,
      COUNT(DISTINCT c.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM feedback_tags ft
          JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
          WHERE cf2.conversation_id = c.id
          AND ft.tag IN ('already-asked', 'repeated-step', 'wrong-sequence', 'skipped-step')
        )
      ) as conversations_with_workflow_issues,
      COUNT(DISTINCT c.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM feedback_tags ft
          JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
          WHERE cf2.conversation_id = c.id
          AND ft.tag IN ('wrong-format', 'missing-sections', 'too-long', 'wrong-structure')
        )
      ) as conversations_with_format_issues,
      COUNT(DISTINCT c.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM feedback_tags ft
          JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
          WHERE cf2.conversation_id = c.id
          AND ft.tag IN ('not-what-i-asked', 'wrong-section', 'ignored-request', 'did-opposite')
        )
      ) as conversations_with_instruction_issues,
      COUNT(DISTINCT c.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM feedback_tags ft
          JOIN conversation_feedback cf2 ON ft.feedback_id = cf2.id
          WHERE cf2.conversation_id = c.id
          AND ft.tag IN ('didnt-use-hubspot', 'asked-for-provided-info', 'ignored-uploaded-file')
        )
      ) as conversations_with_context_issues
    FROM conversations c
    WHERE c.agent_type = $1
    AND c.created_at >= NOW() - INTERVAL '${days} days'
  `, [agentType]);

  const issues = issuesResult.rows[0];

  // Calculate scores (% of conversations WITHOUT issues)
  const accuracyScore = 100 - ((parseInt(issues.conversations_with_accuracy_issues) / conversationCount) * 100);
  const workflowScore = 100 - ((parseInt(issues.conversations_with_workflow_issues) / conversationCount) * 100);
  const formatScore = 100 - ((parseInt(issues.conversations_with_format_issues) / conversationCount) * 100);
  const instructionScore = 100 - ((parseInt(issues.conversations_with_instruction_issues) / conversationCount) * 100);
  const contextScore = 100 - ((parseInt(issues.conversations_with_context_issues) / conversationCount) * 100);

  // Calculate weighted quality score
  // Weights: Accuracy (30%), Instruction Following (25%), Positive Rate (20%),
  //          Format (10%), Workflow (10%), Context (5%)
  const qualityScore = (
    (accuracyScore * 0.30) +
    (instructionScore * 0.25) +
    ((positiveRate || 0) * 0.20) +
    (formatScore * 0.10) +
    (workflowScore * 0.10) +
    (contextScore * 0.05)
  );

  return {
    conversationCount,
    accuracyScore: parseFloat(accuracyScore.toFixed(1)),
    workflowScore: parseFloat(workflowScore.toFixed(1)),
    formatScore: parseFloat(formatScore.toFixed(1)),
    instructionScore: parseFloat(instructionScore.toFixed(1)),
    contextScore: parseFloat(contextScore.toFixed(1)),
    avgRevisions: parseFloat(metrics.avg_revisions) || null,
    positiveRate: positiveRate ? parseFloat(positiveRate.toFixed(1)) : null,
    qualityScore: parseFloat(qualityScore.toFixed(1))
  };
}

/**
 * Get detailed information about a specific agent
 */
async function getAgentDetails(agentType, days) {
  console.log(`📊 Fetching details for ${agentType} (last ${days} days)`);

  // Get overall metrics
  const metrics = await calculateAgentMetrics(agentType, days);

  // Get recent feedback with tags
  const feedbackResult = await query(`
    SELECT
      cf.conversation_id,
      cf.rating,
      cf.feedback_text,
      cf.revision_count,
      cf.completion_time_seconds,
      cf.created_at,
      u.name as user_name,
      ARRAY_AGG(DISTINCT ft.tag) FILTER (WHERE ft.tag IS NOT NULL) as tags
    FROM conversation_feedback cf
    JOIN conversations c ON cf.conversation_id = c.id
    JOIN users u ON cf.user_id = u.id
    LEFT JOIN feedback_tags ft ON cf.id = ft.feedback_id
    WHERE c.agent_type = $1
    AND cf.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY cf.id, cf.conversation_id, cf.rating, cf.feedback_text,
             cf.revision_count, cf.completion_time_seconds, cf.created_at, u.name
    ORDER BY cf.created_at DESC
    LIMIT 20
  `, [agentType]);

  // Get issue breakdown
  const issueBreakdownResult = await query(`
    SELECT
      ft.tag,
      COUNT(DISTINCT cf.conversation_id) as occurrence_count
    FROM feedback_tags ft
    JOIN conversation_feedback cf ON ft.feedback_id = cf.id
    JOIN conversations c ON cf.conversation_id = c.id
    WHERE c.agent_type = $1
    AND cf.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY ft.tag
    ORDER BY occurrence_count DESC
  `, [agentType]);

  return {
    success: true,
    agentType,
    agentName: getAgentDisplayName(agentType),
    timeFilter: `${days} days`,
    metrics,
    recentFeedback: feedbackResult.rows,
    issueBreakdown: issueBreakdownResult.rows
  };
}

/**
 * Helper: Get display name for agent
 */
function getAgentDisplayName(agentType) {
  const names = {
    'grant-card-generator': 'Grant Card Generator',
    'etg-writer': 'ETG Business Case Writer',
    'bcafe-writer': 'BCAFE Writer',
    'canexport-claims': 'CanExport Claims Auditor',
    'readiness-strategist': 'Readiness Strategist'
  };
  return names[agentType] || agentType;
}

/**
 * Helper: Calculate average of array (ignoring nulls)
 */
function calculateAverage(arr) {
  const validValues = arr.filter(v => v !== null && !isNaN(v));
  if (validValues.length === 0) return null;
  const sum = validValues.reduce((a, b) => a + b, 0);
  return parseFloat((sum / validValues.length).toFixed(1));
}
