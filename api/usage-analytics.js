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

        case 'team-adoption':
          return await getTeamAdoptionDashboard(req, res, daysInt);

        case 'productivity-impact':
          return await getProductivityMetrics(req, res, daysInt);

        case 'individual-performance':
          return await getIndividualPerformance(req, res, daysInt);

        case 'user-details':
          const { userId } = req.query;
          if (!userId) {
            return res.status(400).json({ error: 'userId parameter required' });
          }
          return await getUserDetails(req, res, parseInt(userId), daysInt);

        case 'agent-details':
          const { agentType } = req.query;
          if (!agentType) {
            return res.status(400).json({ error: 'agentType parameter required' });
          }
          return await getAgentDetails(req, res, agentType, daysInt);

        default:
          return res.status(400).json({
            error: 'Invalid action parameter',
            availableActions: ['overview', 'agent-stats', 'user-activity', 'trends', 'team-adoption', 'productivity-impact', 'individual-performance', 'user-details', 'agent-details']
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

/**
 * INTERNAL TEAM ANALYTICS (12-person team)
 * Metrics designed for small internal teams, not consumer SaaS
 */

/**
 * Get Team Adoption Dashboard
 * - Who's using which agents?
 * - Weekly active users out of total team
 * - Feature discovery gaps
 */
async function getTeamAdoptionDashboard(req, res, days) {
  // Get all users (full team roster)
  const allUsersResult = await query(`
    SELECT id, email, name, picture, created_at
    FROM users
    ORDER BY name
  `);

  // Get all available agents
  const agentsResult = await query(`
    SELECT DISTINCT agent_type
    FROM conversations
    ORDER BY agent_type
  `);

  const agents = agentsResult.rows.map(r => r.agent_type);

  // Get adoption matrix: user × agent usage with last activity dates
  const adoptionResult = await query(`
    SELECT
      u.id as user_id,
      u.email,
      u.name,
      u.picture,
      c.agent_type,
      COUNT(DISTINCT c.id) as conversation_count,
      MIN(c.created_at) as first_used,
      MAX(c.updated_at) as last_used,
      COUNT(DISTINCT c.id) FILTER (WHERE c.updated_at >= NOW() - INTERVAL '1 day') as used_last_day,
      COUNT(DISTINCT c.id) FILTER (WHERE c.updated_at >= NOW() - INTERVAL '7 days') as used_last_week,
      COUNT(DISTINCT c.id) FILTER (WHERE c.updated_at >= NOW() - INTERVAL '30 days') as used_last_month,
      COUNT(DISTINCT c.id) FILTER (WHERE c.updated_at >= NOW() - INTERVAL '90 days') as used_last_3months
    FROM users u
    LEFT JOIN conversations c ON u.id = c.user_id
    WHERE c.id IS NOT NULL
    GROUP BY u.id, u.email, u.name, u.picture, c.agent_type
    ORDER BY u.name, c.agent_type
  `);

  // Get last activity date for each user (across all agents)
  const lastActivityResult = await query(`
    SELECT
      u.id as user_id,
      MAX(c.updated_at) as last_activity
    FROM users u
    LEFT JOIN conversations c ON u.id = c.user_id
    GROUP BY u.id
  `);

  const lastActivityMap = {};
  lastActivityResult.rows.forEach(row => {
    lastActivityMap[row.user_id] = row.last_activity;
  });

  // Build adoption matrix with time-based filters
  const adoptionMatrix = allUsersResult.rows.map(user => {
    const userAdoption = adoptionResult.rows.filter(r => r.user_id === user.id);

    const agentUsage = {};
    agents.forEach(agent => {
      const usage = userAdoption.find(a => a.agent_type === agent);
      agentUsage[agent] = {
        used: !!usage,
        conversationCount: usage ? parseInt(usage.conversation_count) : 0,
        firstUsed: usage ? usage.first_used : null,
        lastUsed: usage ? usage.last_used : null,
        usedLastDay: usage ? parseInt(usage.used_last_day) > 0 : false,
        usedLastWeek: usage ? parseInt(usage.used_last_week) > 0 : false,
        usedLastMonth: usage ? parseInt(usage.used_last_month) > 0 : false,
        usedLast3Months: usage ? parseInt(usage.used_last_3months) > 0 : false
      };
    });

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      lastActivity: lastActivityMap[user.id] || null,
      agentUsage,
      totalAgentsUsed: Object.values(agentUsage).filter(a => a.used).length,
      totalConversations: Object.values(agentUsage).reduce((sum, a) => sum + a.conversationCount, 0)
    };
  });

  // Weekly active users (last 7 days)
  const weeklyActiveResult = await query(`
    SELECT COUNT(DISTINCT user_id) as active_users
    FROM conversations
    WHERE updated_at >= NOW() - INTERVAL '7 days'
  `);

  // Never-used agents per person
  const trainingGaps = adoptionMatrix.map(user => ({
    userId: user.userId,
    name: user.name,
    email: user.email,
    unusedAgents: agents.filter(agent => !user.agentUsage[agent].used),
    unusedCount: agents.filter(agent => !user.agentUsage[agent].used).length
  })).filter(u => u.unusedCount > 0);

  return res.status(200).json({
    success: true,
    days,
    teamSize: allUsersResult.rows.length,
    weeklyActiveUsers: parseInt(weeklyActiveResult.rows[0].active_users) || 0,
    availableAgents: agents,
    adoptionMatrix,
    trainingGaps,
    summary: {
      fullyAdopted: adoptionMatrix.filter(u => u.totalAgentsUsed === agents.length).length,
      partialAdoption: adoptionMatrix.filter(u => u.totalAgentsUsed > 0 && u.totalAgentsUsed < agents.length).length,
      noUsage: adoptionMatrix.filter(u => u.totalAgentsUsed === 0).length
    }
  });
}

/**
 * Get Productivity & Impact Metrics
 * - Average time per task type
 * - Tasks completed per person per week
 * - Quality trends over time
 */
async function getProductivityMetrics(req, res, days) {
  try {
    // Average session duration per agent type
    const agentProductivityResult = await query(`
      SELECT
        c.agent_type,
        COUNT(DISTINCT c.id) as total_tasks,
        COUNT(DISTINCT c.user_id) as users_count
      FROM conversations c
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY c.agent_type
    `);

    const agentProductivity = await Promise.all(agentProductivityResult.rows.map(async row => {
      const avgDuration = await calculateAvgSessionDuration(row.agent_type, days);

      return {
        agentType: row.agent_type,
        totalConversations: parseInt(row.total_tasks),
        avgDurationMinutes: avgDuration,
        usersCount: parseInt(row.users_count),
        conversationsPerUser: (parseInt(row.total_tasks) / parseInt(row.users_count)).toFixed(1)
      };
    }));

    // Conversations per person per week (last 4 weeks)
    const weeklyConversationsResult = await query(`
      SELECT
        u.id,
        u.name,
        u.email,
        DATE_TRUNC('week', c.created_at) as week_start,
        COUNT(DISTINCT c.id) as conversations_completed
      FROM users u
      JOIN conversations c ON u.id = c.user_id
      WHERE c.created_at >= NOW() - INTERVAL '28 days'
      GROUP BY u.id, u.name, u.email, DATE_TRUNC('week', c.created_at)
      ORDER BY u.name, week_start DESC
    `);

    // Group by user
    const userWeeklyConversations = {};
    weeklyConversationsResult.rows.forEach(row => {
      if (!userWeeklyConversations[row.id]) {
        userWeeklyConversations[row.id] = {
          userId: row.id,
          name: row.name,
          email: row.email,
          weeks: []
        };
      }
      userWeeklyConversations[row.id].weeks.push({
        weekStart: row.week_start,
        conversationsCompleted: parseInt(row.conversations_completed)
      });
    });

    // Calculate averages
    const userProductivity = Object.values(userWeeklyConversations).map(user => ({
      ...user,
      avgConversationsPerWeek: user.weeks.length > 0
        ? (user.weeks.reduce((sum, w) => sum + w.conversationsCompleted, 0) / user.weeks.length).toFixed(1)
        : 0
    }));

    // Quality trends over time (using feedback ratings if available)
    // Use try-catch in case conversation_feedback table doesn't exist or has no data
    let qualityTrends = [];
    try {
      const qualityTrendsResult = await query(`
        SELECT
          DATE(f.created_at) as date,
          COUNT(*) as feedback_count,
          AVG(CASE WHEN f.rating = 'positive' THEN 1 WHEN f.rating = 'negative' THEN 0 END) as positive_rate,
          AVG(f.quality_score) as avg_quality
        FROM conversation_feedback f
        JOIN messages m ON f.message_id = m.id
        JOIN conversations c ON m.conversation_id = c.id
        WHERE f.created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(f.created_at)
        ORDER BY date DESC
        LIMIT 30
      `);

      qualityTrends = qualityTrendsResult.rows.map(row => ({
        date: row.date,
        feedbackCount: parseInt(row.feedback_count),
        positiveRate: row.positive_rate ? (parseFloat(row.positive_rate) * 100).toFixed(1) : null,
        avgQuality: row.avg_quality ? parseFloat(row.avg_quality).toFixed(2) : null
      }));
    } catch (qualityError) {
      console.error('Error loading quality trends (feedback table may be empty):', qualityError.message);
      // Continue without quality trends
    }

    return res.status(200).json({
      success: true,
      days,
      agentProductivity,
      userProductivity,
      qualityTrends
    });
  } catch (error) {
    console.error('Error in getProductivityMetrics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch productivity metrics',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Get Individual Performance Tracking
 * - Top users by agent
 * - Users needing support
 * - Training gaps
 */
async function getIndividualPerformance(req, res, days) {
  try {
    // Top users by agent - simplified without feedback subquery for reliability
    const topUsersByAgentResult = await query(`
      SELECT
        c.agent_type,
        u.id,
        u.name,
        u.email,
        u.picture,
        COUNT(DISTINCT c.id) as conversation_count,
        COUNT(DISTINCT m.id) as message_count
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY c.agent_type, u.id, u.name, u.email, u.picture
      ORDER BY c.agent_type, conversation_count DESC
    `);

    // Group by agent
    const topUsersByAgent = {};
    topUsersByAgentResult.rows.forEach(row => {
      if (!topUsersByAgent[row.agent_type]) {
        topUsersByAgent[row.agent_type] = [];
      }
      topUsersByAgent[row.agent_type].push({
        userId: row.id,
        name: row.name,
        email: row.email,
        picture: row.picture,
        conversationCount: parseInt(row.conversation_count),
        messageCount: parseInt(row.message_count),
        avgQuality: 'N/A'  // Will add back when feedback system is populated
      });
    });

    // Users needing support - simplified to avoid feedback table issues
    // For now, just return empty array until feedback system is populated
    let usersNeedingSupport = [];
    try {
      const usersNeedingSupportResult = await query(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.picture,
          COUNT(DISTINCT c.id) as conversation_count,
          AVG(COALESCE(
            (SELECT AVG(COALESCE(cf.quality_score, 0.7))
             FROM conversation_feedback cf
             JOIN messages msg ON cf.message_id = msg.id
             WHERE msg.conversation_id = c.id),
            0.7
          )) as avg_quality,
          AVG(COALESCE(
            (SELECT AVG(COALESCE(cf.revision_count, 0))
             FROM conversation_feedback cf
             JOIN messages msg ON cf.message_id = msg.id
             WHERE msg.conversation_id = c.id),
            0
          )) as avg_revisions,
          COUNT(DISTINCT cf2.id) FILTER (WHERE cf2.rating = 'negative') as negative_feedback_count
        FROM users u
        JOIN conversations c ON u.id = c.user_id
        LEFT JOIN messages m ON c.id = m.conversation_id
        LEFT JOIN conversation_feedback cf2 ON m.id = cf2.message_id
        WHERE c.created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY u.id, u.name, u.email, u.picture
        HAVING COUNT(DISTINCT c.id) >= 3
      `);

      usersNeedingSupport = usersNeedingSupportResult.rows
        .filter(row => {
          const avgQuality = parseFloat(row.avg_quality);
          const avgRevisions = parseFloat(row.avg_revisions);
          const negativeCount = parseInt(row.negative_feedback_count) || 0;

          // Flag if: low quality (<0.6) OR high revisions (>3) OR multiple negative feedback
          return avgQuality < 0.6 || avgRevisions > 3 || negativeCount >= 2;
        })
        .map(row => ({
          userId: row.id,
          name: row.name,
          email: row.email,
          picture: row.picture,
          conversationCount: parseInt(row.conversation_count),
          avgQuality: parseFloat(row.avg_quality).toFixed(2),
          avgRevisions: parseFloat(row.avg_revisions).toFixed(1),
          negativeFeedbackCount: parseInt(row.negative_feedback_count) || 0,
          issues: []
        }))
        .map(user => {
          // Add specific issues
          if (parseFloat(user.avgQuality) < 0.6) user.issues.push('Low quality outputs');
          if (parseFloat(user.avgRevisions) > 3) user.issues.push('Many revisions needed');
          if (user.negativeFeedbackCount >= 2) user.issues.push('Multiple negative feedback');
          return user;
        });
    } catch (supportError) {
      console.error('Error loading users needing support (feedback may be unavailable):', supportError.message);
      // Continue with empty support list
    }

    // Overall team statistics - simplified
    const teamStatsResult = await query(`
      SELECT
        COUNT(DISTINCT c.user_id) as active_users,
        COUNT(DISTINCT c.id) as total_conversations,
        AVG(m.message_count) as avg_messages_per_conv
      FROM conversations c
      LEFT JOIN (
        SELECT conversation_id, COUNT(*) as message_count
        FROM messages
        GROUP BY conversation_id
      ) m ON c.id = m.conversation_id
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
    `);

    const teamStats = teamStatsResult.rows[0];

    return res.status(200).json({
      success: true,
      days,
      topUsersByAgent,
      usersNeedingSupport,
      teamStats: {
        activeUsers: parseInt(teamStats.active_users) || 0,
        totalConversations: parseInt(teamStats.total_conversations) || 0,
        avgMessagesPerConv: teamStats.avg_messages_per_conv ? parseFloat(teamStats.avg_messages_per_conv).toFixed(1) : '0',
        teamAvgQuality: 'N/A'  // Will add back when feedback system is populated
      }
    });
  } catch (error) {
    console.error('Error in getIndividualPerformance:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch individual performance',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Get detailed breakdown for a specific user
 */
async function getUserDetails(req, res, userId, days) {
  try {
    // Get user's basic stats
    const userStatsResult = await query(`
      SELECT
        u.name,
        u.email,
        u.picture,
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(DISTINCT c.agent_type) as agents_used,
        MAX(c.updated_at) as last_activity
      FROM users u
      LEFT JOIN conversations c ON u.id = c.user_id
      WHERE u.id = $1
        AND (c.created_at >= NOW() - INTERVAL '${days} days' OR c.id IS NULL)
      GROUP BY u.id, u.name, u.email, u.picture
    `, [userId]);

    if (userStatsResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userStats = userStatsResult.rows[0];

    // Calculate total time spent
    const totalTime = await calculateUserTotalSessionDuration(userId, days);

    // Get breakdown by agent
    const agentBreakdownResult = await query(`
      SELECT
        c.agent_type,
        COUNT(DISTINCT c.id) as conversations
      FROM conversations c
      WHERE c.user_id = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY c.agent_type
      ORDER BY conversations DESC
    `, [userId]);

    const agentBreakdown = await Promise.all(agentBreakdownResult.rows.map(async row => {
      const avgDuration = await calculateAvgSessionDuration(row.agent_type, days);
      return {
        agentType: row.agent_type,
        conversations: parseInt(row.conversations),
        avgDuration: avgDuration
      };
    }));

    // Get recent conversations
    const recentConversationsResult = await query(`
      SELECT
        c.id,
        c.agent_type,
        c.created_at,
        COUNT(DISTINCT m.id) as message_count
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.user_id = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY c.id, c.agent_type, c.created_at
      ORDER BY c.created_at DESC
      LIMIT 10
    `, [userId]);

    const recentConversations = recentConversationsResult.rows.map(row => ({
      id: row.id,
      agentType: row.agent_type,
      createdAt: row.created_at,
      messageCount: parseInt(row.message_count),
      duration: 0 // We could calculate this if needed
    }));

    return res.status(200).json({
      success: true,
      userName: userStats.name,
      totalConversations: parseInt(userStats.total_conversations),
      agentsUsed: parseInt(userStats.agents_used),
      totalMinutes: totalTime,
      lastActivity: userStats.last_activity,
      agentBreakdown,
      recentConversations
    });
  } catch (error) {
    console.error('Error in getUserDetails:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user details',
      message: error.message
    });
  }
}

/**
 * Get detailed breakdown for a specific agent
 */
async function getAgentDetails(req, res, agentType, days) {
  try {
    // Get agent's basic stats
    const agentStatsResult = await query(`
      SELECT
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(DISTINCT c.user_id) as unique_users,
        AVG(m.message_count) as avg_messages
      FROM conversations c
      LEFT JOIN (
        SELECT conversation_id, COUNT(*) as message_count
        FROM messages
        GROUP BY conversation_id
      ) m ON c.id = m.conversation_id
      WHERE c.agent_type = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
    `, [agentType]);

    const agentStats = agentStatsResult.rows[0];

    // Calculate average duration
    const avgDuration = await calculateAvgSessionDuration(agentType, days);

    // Get top users
    const topUsersResult = await query(`
      SELECT
        u.id,
        u.name,
        u.picture,
        COUNT(DISTINCT c.id) as conversations
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      WHERE c.agent_type = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY u.id, u.name, u.picture
      ORDER BY conversations DESC
      LIMIT 5
    `, [agentType]);

    const topUsers = await Promise.all(topUsersResult.rows.map(async row => {
      const userTime = await calculateUserTotalSessionDuration(row.id, days);
      return {
        id: row.id,
        name: row.name,
        picture: row.picture,
        conversations: parseInt(row.conversations),
        totalTime: userTime
      };
    }));

    // Get daily usage trend
    const dailyUsageResult = await query(`
      SELECT
        DATE(c.created_at) as date,
        COUNT(DISTINCT c.id) as conversations
      FROM conversations c
      WHERE c.agent_type = $1
        AND c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(c.created_at)
      ORDER BY date DESC
      LIMIT 14
    `, [agentType]);

    const dailyUsage = dailyUsageResult.rows.map(row => ({
      date: row.date,
      conversations: parseInt(row.conversations)
    }));

    return res.status(200).json({
      success: true,
      agentType,
      totalConversations: parseInt(agentStats.total_conversations) || 0,
      uniqueUsers: parseInt(agentStats.unique_users) || 0,
      avgDuration: avgDuration,
      avgMessages: agentStats.avg_messages ? parseFloat(agentStats.avg_messages).toFixed(1) : '0',
      topUsers,
      dailyUsage
    });
  } catch (error) {
    console.error('Error in getAgentDetails:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch agent details',
      message: error.message
    });
  }
}
