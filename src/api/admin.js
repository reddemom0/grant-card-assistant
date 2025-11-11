/**
 * Admin API Routes
 *
 * All routes require authentication and admin role
 */

import express from 'express';
import { requireAdmin, logAdminAction } from '../middleware/admin.js';
import * as adminQueries from '../database/admin-queries.js';
import * as analytics from '../services/analytics.js';
import * as feedbackRetrieval from '../feedback-learning/retrieval.js';

const router = express.Router();

// All admin routes require admin role (authentication happens in server.js)
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Get dashboard overview statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await analytics.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Failed to get admin stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard statistics'
    });
  }
});

/**
 * GET /api/admin/users
 * List all users with pagination and filtering
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 50)
 * - role: Filter by role
 * - isActive: Filter by active status (true/false)
 * - search: Search by name or email
 */
router.get('/users', async (req, res) => {
  try {
    const { page, limit, role, isActive, search } = req.query;

    const result = await adminQueries.getUsers({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      role: role || null,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : null,
      search: search || null
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Failed to get users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve users'
    });
  }
});

/**
 * GET /api/admin/users/:id
 * Get detailed user information
 */
router.get('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await adminQueries.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Failed to get user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user details'
    });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update user role or active status
 *
 * Body:
 * - role: New role (admin, user, client, guest)
 * - is_active: Active status (true/false)
 */
router.put('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role, is_active } = req.body;

    // Validate role
    if (role && !['admin', 'user', 'client', 'guest'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be: admin, user, client, or guest'
      });
    }

    // Get current user state for audit log
    const beforeUser = await adminQueries.getUserById(userId);
    if (!beforeUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update user
    const updates = {};
    if (role !== undefined) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;

    const updatedUser = await adminQueries.updateUser(userId, updates);

    // Log action
    const details = {
      before: { role: beforeUser.role, is_active: beforeUser.is_active },
      after: { role: updatedUser.role, is_active: updatedUser.is_active }
    };
    await logAdminAction(req, 'user_updated', 'user', userId.toString(), details);

    res.json({
      success: true,
      data: updatedUser,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Failed to update user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

/**
 * GET /api/admin/conversations
 * Search conversations with filters
 *
 * Query params:
 * - page, limit: Pagination
 * - userId: Filter by user ID
 * - agentType: Filter by agent type
 * - startDate, endDate: Date range filter
 * - search: Search in titles
 */
router.get('/conversations', async (req, res) => {
  try {
    const { page, limit, userId, agentType, startDate, endDate, search } = req.query;

    const result = await adminQueries.searchConversations({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      userId: userId ? parseInt(userId) : null,
      agentType: agentType || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      search: search || null
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Failed to search conversations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search conversations'
    });
  }
});

/**
 * GET /api/admin/conversations/:id
 * Get full conversation details with messages
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const conversation = await adminQueries.getConversationDetails(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    // Log access
    await logAdminAction(req, 'conversation_viewed', 'conversation', conversationId);

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Failed to get conversation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversation'
    });
  }
});

/**
 * DELETE /api/admin/conversations/:id
 * Delete a conversation and all related data
 */
router.delete('/conversations/:id', async (req, res) => {
  try {
    const conversationId = req.params.id;

    const deleted = await adminQueries.deleteConversation(conversationId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    // Log deletion
    await logAdminAction(req, 'conversation_deleted', 'conversation', conversationId);

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete conversation'
    });
  }
});

/**
 * GET /api/admin/errors
 * Get recent errors with filtering
 *
 * Query params:
 * - limit: Number of errors to return (default: 100)
 * - agentType: Filter by agent type
 * - errorType: Filter by error type
 * - since: ISO date string for earliest error
 */
router.get('/errors', async (req, res) => {
  try {
    const { limit, agentType, errorType, since } = req.query;

    const errors = await adminQueries.getRecentErrors({
      limit: parseInt(limit) || 100,
      agentType: agentType || null,
      errorType: errorType || null,
      since: since ? new Date(since) : null
    });

    res.json({ success: true, data: errors });
  } catch (error) {
    console.error('Failed to get errors:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve error logs'
    });
  }
});

/**
 * GET /api/admin/audit-log
 * Get admin activity audit log
 *
 * Query params:
 * - page, limit: Pagination
 * - adminUserId: Filter by admin user
 * - action: Filter by action type
 */
router.get('/audit-log', async (req, res) => {
  try {
    const { page, limit, adminUserId, action } = req.query;

    const result = await adminQueries.getAuditLogs({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 100,
      adminUserId: adminUserId ? parseInt(adminUserId) : null,
      action: action || null
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Failed to get audit log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit log'
    });
  }
});

/**
 * GET /api/admin/analytics/usage-trends
 * Get usage trends over time
 *
 * Query params:
 * - days: Number of days to analyze (default: 7)
 */
router.get('/analytics/usage-trends', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const trends = await analytics.getUsageTrends(days);
    res.json({ success: true, data: trends });
  } catch (error) {
    console.error('Failed to get usage trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve usage trends'
    });
  }
});

/**
 * GET /api/admin/analytics/costs
 * Get cost estimates and breakdown
 *
 * Query params:
 * - days: Number of days to analyze (default: 30)
 */
router.get('/analytics/costs', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const costs = await analytics.getCostEstimates(days);
    res.json({ success: true, data: costs });
  } catch (error) {
    console.error('Failed to get cost estimates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cost estimates'
    });
  }
});

/**
 * GET /api/admin/analytics/error-stats
 * Get error trends and breakdown
 *
 * Query params:
 * - days: Number of days to analyze (default: 7)
 */
router.get('/analytics/error-stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = await analytics.getErrorStats(days);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Failed to get error stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve error statistics'
    });
  }
});

/**
 * GET /api/admin/analytics/activity-heatmap
 * Get user activity heatmap data
 *
 * Query params:
 * - days: Number of days to analyze (default: 7)
 */
router.get('/analytics/activity-heatmap', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const heatmap = await analytics.getUserActivityHeatmap(days);
    res.json({ success: true, data: heatmap });
  } catch (error) {
    console.error('Failed to get activity heatmap:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve activity heatmap'
    });
  }
});

/**
 * GET /api/admin/analytics/top-users
 * Get top users by activity
 *
 * Query params:
 * - limit: Number of users to return (default: 10)
 * - days: Number of days to analyze (default: 30)
 */
router.get('/analytics/top-users', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const days = parseInt(req.query.days) || 30;
    const topUsers = await analytics.getTopUsers(limit, days);
    res.json({ success: true, data: topUsers });
  } catch (error) {
    console.error('Failed to get top users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve top users'
    });
  }
});

/**
 * GET /api/admin/system/health
 * Get system health status
 */
router.get('/system/health', async (req, res) => {
  try {
    const health = await analytics.getSystemHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    console.error('Failed to get system health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve system health'
    });
  }
});

/**
 * GET /api/admin/system/database
 * Get database statistics
 */
router.get('/system/database', async (req, res) => {
  try {
    const dbStats = await analytics.getDatabaseStats();
    res.json({ success: true, data: dbStats });
  } catch (error) {
    console.error('Failed to get database stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve database statistics'
    });
  }
});

// ============================================================================
// FEEDBACK LEARNING SYSTEM
// ============================================================================

/**
 * GET /api/admin/feedback-learning/overview
 * Get overview of feedback for all agents
 */
router.get('/feedback-learning/overview', async (req, res) => {
  try {
    const agentsList = await feedbackRetrieval.getAgentTypesWithFeedback();
    const overviewData = await Promise.all(
      agentsList.map(async (agent) => {
        const stats = await feedbackRetrieval.getFeedbackStats(agent.agent_type);
        return {
          agentType: agent.agent_type,
          feedbackCount: parseInt(agent.feedback_count),
          ...stats
        };
      })
    );

    res.json({ success: true, data: overviewData });
  } catch (error) {
    console.error('Failed to get feedback overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feedback overview'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/stats/:agentType
 * Get detailed stats for specific agent
 */
router.get('/feedback-learning/stats/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const stats = await feedbackRetrieval.getFeedbackStats(agentType);

    res.json({
      success: true,
      agentType,
      stats
    });
  } catch (error) {
    console.error('Failed to get agent stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve agent statistics'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/high-quality/:agentType
 * Get high-quality feedback for learning
 */
router.get('/feedback-learning/high-quality/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const { limit } = req.query;

    const highQuality = await feedbackRetrieval.getHighQualityFeedback(
      agentType,
      parseInt(limit) || 20,
      0.75
    );

    res.json({
      success: true,
      agentType,
      count: highQuality.length,
      feedback: highQuality
    });
  } catch (error) {
    console.error('Failed to get high-quality feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve high-quality feedback'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/negative/:agentType
 * Get negative feedback patterns to avoid
 */
router.get('/feedback-learning/negative/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const { limit } = req.query;

    const negative = await feedbackRetrieval.getNegativeFeedback(
      agentType,
      parseInt(limit) || 10,
      0.4
    );

    res.json({
      success: true,
      agentType,
      count: negative.length,
      feedback: negative
    });
  } catch (error) {
    console.error('Failed to get negative feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve negative feedback'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/corrections/:agentType
 * Get user corrections for learning
 */
router.get('/feedback-learning/corrections/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const { limit } = req.query;

    const corrections = await feedbackRetrieval.getUserCorrections(
      agentType,
      parseInt(limit) || 50
    );

    res.json({
      success: true,
      agentType,
      count: corrections.length,
      corrections
    });
  } catch (error) {
    console.error('Failed to get corrections:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user corrections'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/recent
 * Get recent feedback across all agents
 */
router.get('/feedback-learning/recent', async (req, res) => {
  try {
    const { limit } = req.query;
    const recent = await feedbackRetrieval.getRecentFeedback(
      parseInt(limit) || 20
    );

    res.json({
      success: true,
      count: recent.length,
      feedback: recent
    });
  } catch (error) {
    console.error('Failed to get recent feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent feedback'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/trends/:agentType
 * Get feedback trends over time
 */
router.get('/feedback-learning/trends/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const { days } = req.query;

    const trends = await feedbackRetrieval.getFeedbackTrends(
      agentType,
      parseInt(days) || 30
    );

    res.json({
      success: true,
      agentType,
      days: parseInt(days) || 30,
      trends
    });
  } catch (error) {
    console.error('Failed to get trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feedback trends'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/top-messages/:agentType
 * Get top performing messages
 */
router.get('/feedback-learning/top-messages/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const { limit } = req.query;

    const topMessages = await feedbackRetrieval.getTopPerformingMessages(
      agentType,
      parseInt(limit) || 10
    );

    res.json({
      success: true,
      agentType,
      count: topMessages.length,
      messages: topMessages
    });
  } catch (error) {
    console.error('Failed to get top messages:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve top messages'
    });
  }
});

/**
 * GET /api/admin/feedback-learning/search/:agentType
 * Search feedback by content
 */
router.get('/feedback-learning/search/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const { q, limit } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Missing search query parameter "q"'
      });
    }

    const searchResults = await feedbackRetrieval.searchFeedback(
      agentType,
      q,
      parseInt(limit) || 20
    );

    res.json({
      success: true,
      agentType,
      searchTerm: q,
      count: searchResults.length,
      results: searchResults
    });
  } catch (error) {
    console.error('Failed to search feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search feedback'
    });
  }
});

export default router;
