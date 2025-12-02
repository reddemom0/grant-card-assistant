/**
 * Usage Analytics API
 * GET /api/usage-analytics - Get usage statistics
 */

import { query } from '../src/database/connection.js';

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require authentication (available to all authenticated users)
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized - Please log in'
    });
  }

  try {
    if (req.method === 'GET') {
      const { action, days } = req.query;
      const daysInt = parseInt(days) || 30;

      switch (action) {
        case 'overview':
          return await getUsageOverview(req, res, daysInt);

        case 'agent-stats':
          return await getAgentStats(req, res, daysInt);

        case 'user-activity':
          return await getUserActivity(req, res, daysInt);

        case 'trends':
          return await getUsageTrends(req, res, daysInt);

        default:
          return res.status(400).json({
            error: 'Invalid action parameter',
            availableActions: ['overview', 'agent-stats', 'user-activity', 'trends']
          });
      }
    }

    return res.status(405).json({
      error: 'Method not allowed. Use GET'
    });

  } catch (error) {
    console.error('Usage analytics API error:', error);
    return res.status(500).json({
      error: 'Failed to fetch usage analytics',
      message: error.message
    });
  }
}

/**
 * Get high-level usage overview
 */
async function getUsageOverview(req, res, days) {
  const result = await query(`
    SELECT
      COUNT(DISTINCT c.id) as total_conversations,
      COUNT(DISTINCT c.user_id) as unique_users,
      COUNT(DISTINCT c.agent_type) as active_agents,
      COUNT(DISTINCT DATE(c.created_at)) as active_days,
      COUNT(DISTINCT m.id) as total_messages
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.created_at >= NOW() - INTERVAL '${days} days'
  `);

  const stats = result.rows[0];

  return res.status(200).json({
    success: true,
    days,
    overview: {
      totalConversations: parseInt(stats.total_conversations) || 0,
      uniqueUsers: parseInt(stats.unique_users) || 0,
      activeAgents: parseInt(stats.active_agents) || 0,
      activeDays: parseInt(stats.active_days) || 0,
      totalMessages: parseInt(stats.total_messages) || 0,
      avgMessagesPerConversation: stats.total_conversations > 0
        ? (parseInt(stats.total_messages) / parseInt(stats.total_conversations)).toFixed(1)
        : 0
    }
  });
}

/**
 * Get detailed statistics per agent
 */
async function getAgentStats(req, res, days) {
  const result = await query(`
    SELECT
      c.agent_type,
      COUNT(DISTINCT c.id) as conversation_count,
      COUNT(DISTINCT c.user_id) as unique_users,
      COUNT(DISTINCT m.id) as message_count,
      MIN(c.created_at) as first_used,
      MAX(c.updated_at) as last_used
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY c.agent_type
    ORDER BY conversation_count DESC
  `);

  // Calculate session-based active time for each agent
  const agents = await Promise.all(result.rows.map(async row => {
    const avgDuration = await calculateAvgSessionDuration(row.agent_type, days);

    return {
      agentType: row.agent_type,
      conversationCount: parseInt(row.conversation_count),
      uniqueUsers: parseInt(row.unique_users),
      messageCount: parseInt(row.message_count),
      avgMessagesPerConversation: row.conversation_count > 0
        ? (parseInt(row.message_count) / parseInt(row.conversation_count)).toFixed(1)
        : 0,
      avgDurationMinutes: avgDuration,
      firstUsed: row.first_used,
      lastUsed: row.last_used
    };
  }));

  return res.status(200).json({
    success: true,
    days,
    agents
  });
}

/**
 * Get user activity breakdown
 */
async function getUserActivity(req, res, days) {
  const result = await query(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.picture,
      COUNT(DISTINCT c.id) as conversation_count,
      COUNT(DISTINCT c.agent_type) as agents_used,
      COUNT(DISTINCT m.id) as message_count,
      MIN(c.created_at) as first_activity,
      MAX(c.updated_at) as last_activity
    FROM users u
    JOIN conversations c ON u.id = c.user_id
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY u.id, u.email, u.name, u.picture
    ORDER BY conversation_count DESC
  `);

  // Calculate session-based active time for each user
  const users = await Promise.all(result.rows.map(async row => {
    const totalDuration = await calculateUserTotalSessionDuration(row.id, days);
    const avgDuration = row.conversation_count > 0
      ? (totalDuration / parseInt(row.conversation_count)).toFixed(1)
      : 0;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      picture: row.picture,
      conversationCount: parseInt(row.conversation_count),
      agentsUsed: parseInt(row.agents_used),
      messageCount: parseInt(row.message_count),
      totalDurationMinutes: totalDuration,
      avgDurationMinutes: parseFloat(avgDuration),
      firstActivity: row.first_activity,
      lastActivity: row.last_activity
    };
  }));

  return res.status(200).json({
    success: true,
    days,
    users
  });
}

/**
 * Get usage trends over time
 */
async function getUsageTrends(req, res, days) {
  const result = await query(`
    SELECT
      DATE(c.created_at) as date,
      COUNT(DISTINCT c.id) as conversations,
      COUNT(DISTINCT c.user_id) as unique_users,
      COUNT(DISTINCT m.id) as messages
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(c.created_at)
    ORDER BY date DESC
  `);

  const trends = result.rows.map(row => ({
    date: row.date,
    conversations: parseInt(row.conversations),
    uniqueUsers: parseInt(row.unique_users),
    messages: parseInt(row.messages)
  }));

  return res.status(200).json({
    success: true,
    days,
    trends
  });
}

/**
 * Calculate average session-based duration for an agent type
 * Uses 30-minute idle timeout to define sessions
 */
async function calculateAvgSessionDuration(agentType, days) {
  const result = await query(`
    WITH message_gaps AS (
      SELECT
        c.id as conversation_id,
        m.created_at as message_time,
        LAG(m.created_at) OVER (PARTITION BY c.id ORDER BY m.created_at) as prev_message_time,
        EXTRACT(EPOCH FROM (
          m.created_at - LAG(m.created_at) OVER (PARTITION BY c.id ORDER BY m.created_at)
        )) / 60 as gap_minutes
      FROM conversations c
      JOIN messages m ON c.id = m.conversation_id
      WHERE c.agent_type = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
      ORDER BY c.id, m.created_at
    ),
    session_times AS (
      SELECT
        conversation_id,
        -- Cap each gap at 30 minutes (idle timeout)
        -- Ignore first message (no gap)
        SUM(
          CASE
            WHEN gap_minutes IS NULL THEN 0
            WHEN gap_minutes > 30 THEN 0  -- New session after 30min idle
            WHEN gap_minutes > 4 * 60 THEN 0  -- Safety cap at 4 hours
            ELSE gap_minutes
          END
        ) as active_minutes
      FROM message_gaps
      GROUP BY conversation_id
    )
    SELECT
      AVG(active_minutes) as avg_active_minutes,
      COUNT(*) as conversation_count
    FROM session_times
    WHERE active_minutes > 0
  `, [agentType]);

  return parseFloat(result.rows[0]?.avg_active_minutes) || 0;
}

/**
 * Calculate total session-based duration for a user
 * Uses 30-minute idle timeout to define sessions
 */
async function calculateUserTotalSessionDuration(userId, days) {
  const result = await query(`
    WITH message_gaps AS (
      SELECT
        c.id as conversation_id,
        m.created_at as message_time,
        LAG(m.created_at) OVER (PARTITION BY c.id ORDER BY m.created_at) as prev_message_time,
        EXTRACT(EPOCH FROM (
          m.created_at - LAG(m.created_at) OVER (PARTITION BY c.id ORDER BY m.created_at)
        )) / 60 as gap_minutes
      FROM conversations c
      JOIN messages m ON c.id = m.conversation_id
      WHERE c.user_id = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
      ORDER BY c.id, m.created_at
    ),
    session_times AS (
      SELECT
        conversation_id,
        SUM(
          CASE
            WHEN gap_minutes IS NULL THEN 0
            WHEN gap_minutes > 30 THEN 0  -- New session after 30min idle
            WHEN gap_minutes > 4 * 60 THEN 0  -- Safety cap at 4 hours
            ELSE gap_minutes
          END
        ) as active_minutes
      FROM message_gaps
      GROUP BY conversation_id
    )
    SELECT
      SUM(active_minutes) as total_active_minutes
    FROM session_times
  `, [userId]);

  return parseFloat(result.rows[0]?.total_active_minutes) || 0;
}
