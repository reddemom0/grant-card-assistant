/**
 * Analytics Service
 *
 * Provides dashboard statistics, usage trends, and cost estimates
 */

import { query } from '../database/connection.js';

/**
 * Get dashboard overview statistics
 *
 * @returns {Promise<Object>} Dashboard stats
 */
export async function getDashboardStats() {
  // Run all queries in parallel for performance
  const [
    totalUsersResult,
    activeUsersResult,
    totalConversationsResult,
    todayConversationsResult,
    recentErrorsResult,
    agentUsageResult,
    totalTokensResult
  ] = await Promise.all([
    // Total users
    query('SELECT COUNT(*) as count FROM users'),

    // Active users (active in last 7 days)
    query(`SELECT COUNT(*) as count FROM users WHERE updated_at >= NOW() - INTERVAL '7 days'`),

    // Total conversations
    query('SELECT COUNT(*) as count FROM conversations'),

    // Conversations today
    query(`SELECT COUNT(*) as count FROM conversations WHERE created_at >= CURRENT_DATE`),

    // Errors in last 24 hours
    query(`SELECT COUNT(*) as count FROM error_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`),

    // Agent usage breakdown
    query(`
      SELECT
        agent_type,
        COUNT(*) as conversation_count,
        COUNT(DISTINCT user_id) as unique_users
      FROM conversations
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY agent_type
      ORDER BY conversation_count DESC
    `),

    // Total tokens used (last 30 days)
    query(`
      SELECT COALESCE(SUM(tokens_used), 0) as total_tokens
      FROM conversation_stats cs
      JOIN conversations c ON c.id = cs.conversation_id
      WHERE c.created_at >= NOW() - INTERVAL '30 days'
    `)
  ]);

  return {
    users: {
      total: parseInt(totalUsersResult.rows[0].count),
      active: parseInt(activeUsersResult.rows[0].count)
    },
    conversations: {
      total: parseInt(totalConversationsResult.rows[0].count),
      today: parseInt(todayConversationsResult.rows[0].count)
    },
    errors: {
      last24h: parseInt(recentErrorsResult.rows[0].count)
    },
    agentUsage: agentUsageResult.rows,
    tokens: {
      last30Days: parseInt(totalTokensResult.rows[0].total_tokens)
    }
  };
}

/**
 * Get usage trends over time
 *
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Array>} Daily usage data
 */
export async function getUsageTrends(days = 7) {
  const result = await query(
    `SELECT
       DATE(created_at) as date,
       COUNT(*) as conversation_count,
       COUNT(DISTINCT user_id) as unique_users,
       COUNT(DISTINCT agent_type) as unique_agents
     FROM conversations
     WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
     GROUP BY DATE(created_at)
     ORDER BY date ASC`
  );

  return result.rows;
}

/**
 * Get cost estimates based on token usage
 *
 * Pricing (as of 2025):
 * - Claude 3.5 Sonnet: $3 per 1M input tokens, $15 per 1M output tokens
 * - Estimate: ~60% input, ~40% output
 *
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Object>} Cost breakdown
 */
export async function getCostEstimates(days = 30) {
  const result = await query(
    `SELECT
       c.agent_type,
       COUNT(*) as conversation_count,
       COALESCE(SUM(cs.tokens_used), 0) as total_tokens,
       COALESCE(AVG(cs.tokens_used), 0) as avg_tokens_per_conversation
     FROM conversations c
     LEFT JOIN conversation_stats cs ON cs.conversation_id = c.id
     WHERE c.created_at >= NOW() - INTERVAL '${days} days'
     GROUP BY c.agent_type
     ORDER BY total_tokens DESC`
  );

  // Calculate estimated costs (rough estimate)
  // Assume 60% input ($3/1M) and 40% output ($15/1M) = $9/1M average
  const costPerMillionTokens = 9;

  const agentCosts = result.rows.map(row => ({
    agentType: row.agent_type,
    conversationCount: parseInt(row.conversation_count),
    totalTokens: parseInt(row.total_tokens),
    avgTokensPerConversation: Math.round(parseFloat(row.avg_tokens_per_conversation)),
    estimatedCost: (parseInt(row.total_tokens) / 1000000) * costPerMillionTokens
  }));

  const totalTokens = agentCosts.reduce((sum, agent) => sum + agent.totalTokens, 0);
  const totalCost = agentCosts.reduce((sum, agent) => sum + agent.estimatedCost, 0);

  return {
    period: `${days} days`,
    totalTokens,
    totalCost: Math.round(totalCost * 100) / 100, // Round to 2 decimals
    avgDailyCost: Math.round((totalCost / days) * 100) / 100,
    projectedMonthlyCost: Math.round((totalCost / days) * 30 * 100) / 100,
    byAgent: agentCosts
  };
}

/**
 * Get error trends and breakdown
 *
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Object>} Error statistics
 */
export async function getErrorStats(days = 7) {
  const [errorTrendsResult, errorTypeBreakdownResult, agentErrorsResult] = await Promise.all([
    // Daily error trends
    query(
      `SELECT
         DATE(created_at) as date,
         COUNT(*) as error_count
       FROM error_logs
       WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    ),

    // Error type breakdown
    query(
      `SELECT
         error_type,
         COUNT(*) as count
       FROM error_logs
       WHERE created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY error_type
       ORDER BY count DESC
       LIMIT 10`
    ),

    // Errors by agent
    query(
      `SELECT
         agent_type,
         COUNT(*) as error_count
       FROM error_logs
       WHERE created_at >= NOW() - INTERVAL '${days} days'
         AND agent_type IS NOT NULL
       GROUP BY agent_type
       ORDER BY error_count DESC`
    )
  ]);

  return {
    trends: errorTrendsResult.rows,
    byType: errorTypeBreakdownResult.rows,
    byAgent: agentErrorsResult.rows
  };
}

/**
 * Get user activity heatmap data
 *
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Array>} Activity by hour and day
 */
export async function getUserActivityHeatmap(days = 7) {
  const result = await query(
    `SELECT
       EXTRACT(DOW FROM created_at) as day_of_week,
       EXTRACT(HOUR FROM created_at) as hour,
       COUNT(*) as activity_count
     FROM conversations
     WHERE created_at >= NOW() - INTERVAL '${days} days'
     GROUP BY day_of_week, hour
     ORDER BY day_of_week, hour`
  );

  return result.rows.map(row => ({
    dayOfWeek: parseInt(row.day_of_week), // 0 = Sunday, 6 = Saturday
    hour: parseInt(row.hour),
    count: parseInt(row.activity_count)
  }));
}

/**
 * Get top users by activity
 *
 * @param {number} limit - Number of users to return
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Array>} Top users
 */
export async function getTopUsers(limit = 10, days = 30) {
  const result = await query(
    `SELECT
       u.id,
       u.email,
       u.name,
       COUNT(c.id) as conversation_count,
       COALESCE(SUM(cs.tokens_used), 0) as total_tokens
     FROM users u
     JOIN conversations c ON c.user_id = u.id
     LEFT JOIN conversation_stats cs ON cs.conversation_id = c.id
     WHERE c.created_at >= NOW() - INTERVAL '${days} days'
     GROUP BY u.id, u.email, u.name
     ORDER BY conversation_count DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    userId: row.id,
    email: row.email,
    name: row.name,
    conversationCount: parseInt(row.conversation_count),
    totalTokens: parseInt(row.total_tokens)
  }));
}

/**
 * Get database size and growth statistics
 *
 * @returns {Promise<Object>} Database statistics
 */
export async function getDatabaseStats() {
  const [sizeResult, rowCountsResult] = await Promise.all([
    // Database size
    query(`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) as database_size,
        pg_database_size(current_database()) as database_size_bytes
    `),

    // Row counts for main tables
    query(`
      SELECT
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM conversations) as conversations,
        (SELECT COUNT(*) FROM messages) as messages,
        (SELECT COUNT(*) FROM conversation_stats) as conversation_stats,
        (SELECT COUNT(*) FROM error_logs) as error_logs,
        (SELECT COUNT(*) FROM admin_audit_log) as admin_audit_log
    `)
  ]);

  return {
    size: sizeResult.rows[0].database_size,
    sizeBytes: parseInt(sizeResult.rows[0].database_size_bytes),
    tables: {
      users: parseInt(rowCountsResult.rows[0].users),
      conversations: parseInt(rowCountsResult.rows[0].conversations),
      messages: parseInt(rowCountsResult.rows[0].messages),
      conversationStats: parseInt(rowCountsResult.rows[0].conversation_stats),
      errorLogs: parseInt(rowCountsResult.rows[0].error_logs),
      adminAuditLog: parseInt(rowCountsResult.rows[0].admin_audit_log)
    }
  };
}

/**
 * Get system health status
 *
 * @returns {Promise<Object>} System health
 */
export async function getSystemHealth() {
  try {
    // Test database connection
    const dbResult = await query('SELECT NOW() as time');
    const dbHealthy = dbResult.rows.length > 0;

    // Check for recent errors
    const recentErrorsResult = await query(
      `SELECT COUNT(*) as count FROM error_logs WHERE created_at >= NOW() - INTERVAL '1 hour'`
    );
    const recentErrors = parseInt(recentErrorsResult.rows[0].count);

    // Get pool stats
    const { getPoolStats } = await import('../database/connection.js');
    const poolStats = getPoolStats();

    return {
      status: dbHealthy && recentErrors < 10 ? 'healthy' : 'degraded',
      database: {
        connected: dbHealthy,
        poolStats
      },
      errors: {
        lastHour: recentErrors
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}
