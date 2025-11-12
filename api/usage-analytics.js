/**
 * Usage Analytics API (Admin Only)
 * GET /api/usage-analytics - Get usage statistics
 */

import { query } from '../src/database/connection.js';

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require admin authentication
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized - Please log in'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden - Admin access required'
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
      MAX(c.updated_at) as last_used,
      AVG(
        EXTRACT(EPOCH FROM (
          (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) -
          (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id)
        )) / 60
      ) as avg_duration_minutes
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY c.agent_type
    ORDER BY conversation_count DESC
  `);

  const agents = result.rows.map(row => ({
    agentType: row.agent_type,
    conversationCount: parseInt(row.conversation_count),
    uniqueUsers: parseInt(row.unique_users),
    messageCount: parseInt(row.message_count),
    avgMessagesPerConversation: row.conversation_count > 0
      ? (parseInt(row.message_count) / parseInt(row.conversation_count)).toFixed(1)
      : 0,
    avgDurationMinutes: parseFloat(row.avg_duration_minutes) || 0,
    firstUsed: row.first_used,
    lastUsed: row.last_used
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
      MAX(c.updated_at) as last_activity,
      SUM(
        EXTRACT(EPOCH FROM (
          (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) -
          (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id)
        )) / 60
      ) as total_duration_minutes
    FROM users u
    JOIN conversations c ON u.id = c.user_id
    LEFT JOIN messages m ON c.id = m.conversation_id
    WHERE c.created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY u.id, u.email, u.name, u.picture
    ORDER BY conversation_count DESC
  `);

  const users = result.rows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    conversationCount: parseInt(row.conversation_count),
    agentsUsed: parseInt(row.agents_used),
    messageCount: parseInt(row.message_count),
    totalDurationMinutes: parseFloat(row.total_duration_minutes) || 0,
    avgDurationMinutes: row.conversation_count > 0
      ? (parseFloat(row.total_duration_minutes) / parseInt(row.conversation_count)).toFixed(1)
      : 0,
    firstActivity: row.first_activity,
    lastActivity: row.last_activity
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
