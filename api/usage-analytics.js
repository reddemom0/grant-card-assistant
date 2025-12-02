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

  // Get DAU/WAU/MAU
  const activeUsersStats = await getActiveUsersStats();

  // Get retention metrics
  const retentionStats = await getRetentionStats();

  // Get engagement score
  const engagementStats = await getEngagementStats(days);

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
    },
    activeUsers: activeUsersStats,
    retention: retentionStats,
    engagement: engagementStats
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

/**
 * Get DAU/WAU/MAU (Daily/Weekly/Monthly Active Users)
 */
async function getActiveUsersStats() {
  const result = await query(`
    SELECT
      COUNT(DISTINCT CASE
        WHEN c.updated_at >= NOW() - INTERVAL '1 day'
        THEN c.user_id
      END) as dau,
      COUNT(DISTINCT CASE
        WHEN c.updated_at >= NOW() - INTERVAL '7 days'
        THEN c.user_id
      END) as wau,
      COUNT(DISTINCT CASE
        WHEN c.updated_at >= NOW() - INTERVAL '30 days'
        THEN c.user_id
      END) as mau
    FROM conversations c
  `);

  const stats = result.rows[0];
  const dau = parseInt(stats.dau) || 0;
  const wau = parseInt(stats.wau) || 0;
  const mau = parseInt(stats.mau) || 0;

  return {
    dau,
    wau,
    mau,
    // Stickiness ratio: DAU/MAU (higher is better, indicates daily engagement)
    stickiness: mau > 0 ? ((dau / mau) * 100).toFixed(1) : 0
  };
}

/**
 * Get retention metrics (7-day and 30-day retention rates)
 */
async function getRetentionStats() {
  // 7-day retention: % of users who return within 7 days of first conversation
  const retention7Day = await query(`
    WITH first_activity AS (
      SELECT
        user_id,
        MIN(created_at) as first_conversation_date
      FROM conversations
      WHERE created_at >= NOW() - INTERVAL '37 days'  -- Look back further to track retention
      GROUP BY user_id
    ),
    cohort_users AS (
      SELECT
        user_id,
        first_conversation_date
      FROM first_activity
      WHERE first_conversation_date >= NOW() - INTERVAL '30 days'
        AND first_conversation_date < NOW() - INTERVAL '7 days'  -- Only users who had chance to return
    ),
    returned_users AS (
      SELECT DISTINCT
        cu.user_id
      FROM cohort_users cu
      JOIN conversations c ON cu.user_id = c.user_id
      WHERE c.created_at > cu.first_conversation_date
        AND c.created_at <= cu.first_conversation_date + INTERVAL '7 days'
    )
    SELECT
      COUNT(DISTINCT cu.user_id) as cohort_size,
      COUNT(DISTINCT ru.user_id) as returned_count
    FROM cohort_users cu
    LEFT JOIN returned_users ru ON cu.user_id = ru.user_id
  `);

  // 30-day retention: % of users who return within 30 days
  const retention30Day = await query(`
    WITH first_activity AS (
      SELECT
        user_id,
        MIN(created_at) as first_conversation_date
      FROM conversations
      WHERE created_at >= NOW() - INTERVAL '60 days'
      GROUP BY user_id
    ),
    cohort_users AS (
      SELECT
        user_id,
        first_conversation_date
      FROM first_activity
      WHERE first_conversation_date >= NOW() - INTERVAL '60 days'
        AND first_conversation_date < NOW() - INTERVAL '30 days'
    ),
    returned_users AS (
      SELECT DISTINCT
        cu.user_id
      FROM cohort_users cu
      JOIN conversations c ON cu.user_id = c.user_id
      WHERE c.created_at > cu.first_conversation_date
        AND c.created_at <= cu.first_conversation_date + INTERVAL '30 days'
    )
    SELECT
      COUNT(DISTINCT cu.user_id) as cohort_size,
      COUNT(DISTINCT ru.user_id) as returned_count
    FROM cohort_users cu
    LEFT JOIN returned_users ru ON cu.user_id = ru.user_id
  `);

  const day7Stats = retention7Day.rows[0];
  const day30Stats = retention30Day.rows[0];

  const cohortSize7 = parseInt(day7Stats.cohort_size) || 0;
  const returnedCount7 = parseInt(day7Stats.returned_count) || 0;
  const cohortSize30 = parseInt(day30Stats.cohort_size) || 0;
  const returnedCount30 = parseInt(day30Stats.returned_count) || 0;

  return {
    day7: {
      cohortSize: cohortSize7,
      returnedUsers: returnedCount7,
      retentionRate: cohortSize7 > 0 ? ((returnedCount7 / cohortSize7) * 100).toFixed(1) : 0
    },
    day30: {
      cohortSize: cohortSize30,
      returnedUsers: returnedCount30,
      retentionRate: cohortSize30 > 0 ? ((returnedCount30 / cohortSize30) * 100).toFixed(1) : 0
    }
  };
}

/**
 * Calculate engagement score (0-100) based on frequency, recency, and depth
 */
async function getEngagementStats(days) {
  const result = await query(`
    WITH user_engagement AS (
      SELECT
        c.user_id,
        COUNT(DISTINCT c.id) as conversation_count,
        COUNT(DISTINCT DATE(c.created_at)) as active_days,
        MAX(c.updated_at) as last_activity,
        COUNT(DISTINCT m.id) as message_count,
        EXTRACT(EPOCH FROM (NOW() - MAX(c.updated_at))) / 86400 as days_since_last_activity
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY c.user_id
    ),
    scored_users AS (
      SELECT
        user_id,
        conversation_count,
        active_days,
        message_count,
        days_since_last_activity,
        -- Frequency score (0-40): Based on conversations and active days
        LEAST(40, (conversation_count * 5) + (active_days * 3)) as frequency_score,
        -- Recency score (0-30): Based on days since last activity
        CASE
          WHEN days_since_last_activity <= 1 THEN 30
          WHEN days_since_last_activity <= 3 THEN 25
          WHEN days_since_last_activity <= 7 THEN 20
          WHEN days_since_last_activity <= 14 THEN 15
          WHEN days_since_last_activity <= 30 THEN 10
          ELSE 5
        END as recency_score,
        -- Depth score (0-30): Based on message count
        LEAST(30, message_count / 5) as depth_score
      FROM user_engagement
    )
    SELECT
      COUNT(*) as total_users,
      AVG(frequency_score + recency_score + depth_score) as avg_engagement_score,
      COUNT(CASE WHEN (frequency_score + recency_score + depth_score) >= 70 THEN 1 END) as highly_engaged_users,
      COUNT(CASE WHEN (frequency_score + recency_score + depth_score) BETWEEN 40 AND 69 THEN 1 END) as moderately_engaged_users,
      COUNT(CASE WHEN (frequency_score + recency_score + depth_score) < 40 THEN 1 END) as low_engaged_users
    FROM scored_users
  `);

  const stats = result.rows[0];

  return {
    averageScore: parseFloat(stats.avg_engagement_score) || 0,
    totalUsers: parseInt(stats.total_users) || 0,
    breakdown: {
      highlyEngaged: parseInt(stats.highly_engaged_users) || 0,  // Score >= 70
      moderatelyEngaged: parseInt(stats.moderately_engaged_users) || 0,  // Score 40-69
      lowEngaged: parseInt(stats.low_engaged_users) || 0  // Score < 40
    }
  };
}
