/**
 * Admin Feedback Dashboard API
 * GET /api/admin-feedback - Get feedback statistics and learning data
 */

import * as feedbackRetrieval from '../src/feedback-learning/retrieval.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * Extract user from JWT token
 */
function getUserFromToken(req) {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return null;
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Check if user is admin
 * For now, check if user exists (later can add role check)
 */
function isAdmin(user) {
  // TODO: Add proper admin role check when user roles are implemented
  // For now, just check if authenticated
  return user !== null;
}

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check authentication
  const user = getUserFromToken(req);
  if (!user || !isAdmin(user)) {
    return res.status(401).json({
      error: 'Unauthorized - Admin access required'
    });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const { action, agentType, limit, searchTerm, days } = req.query;

  try {
    switch (action) {
      case 'overview':
        // Get overview of all agents
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

        return res.status(200).json({
          success: true,
          data: overviewData
        });

      case 'stats':
        // Get detailed stats for specific agent
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const stats = await feedbackRetrieval.getFeedbackStats(agentType);
        return res.status(200).json({
          success: true,
          agentType,
          stats
        });

      case 'high-quality':
        // Get high-quality feedback
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const highQuality = await feedbackRetrieval.getHighQualityFeedback(
          agentType,
          parseInt(limit) || 20,
          0.75
        );

        return res.status(200).json({
          success: true,
          agentType,
          count: highQuality.length,
          feedback: highQuality
        });

      case 'negative':
        // Get negative feedback
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const negative = await feedbackRetrieval.getNegativeFeedback(
          agentType,
          parseInt(limit) || 10,
          0.4
        );

        return res.status(200).json({
          success: true,
          agentType,
          count: negative.length,
          feedback: negative
        });

      case 'corrections':
        // Get user corrections
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const corrections = await feedbackRetrieval.getUserCorrections(
          agentType,
          parseInt(limit) || 50
        );

        return res.status(200).json({
          success: true,
          agentType,
          count: corrections.length,
          corrections
        });

      case 'recent':
        // Get recent feedback across all agents
        const recent = await feedbackRetrieval.getRecentFeedback(
          parseInt(limit) || 20
        );

        return res.status(200).json({
          success: true,
          count: recent.length,
          feedback: recent
        });

      case 'trends':
        // Get feedback trends over time
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const trends = await feedbackRetrieval.getFeedbackTrends(
          agentType,
          parseInt(days) || 30
        );

        return res.status(200).json({
          success: true,
          agentType,
          days: parseInt(days) || 30,
          trends
        });

      case 'top-messages':
        // Get top performing messages
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const topMessages = await feedbackRetrieval.getTopPerformingMessages(
          agentType,
          parseInt(limit) || 10
        );

        return res.status(200).json({
          success: true,
          agentType,
          count: topMessages.length,
          messages: topMessages
        });

      case 'search':
        // Search feedback
        if (!agentType || !searchTerm) {
          return res.status(400).json({
            error: 'Missing agentType or searchTerm parameter'
          });
        }

        const searchResults = await feedbackRetrieval.searchFeedback(
          agentType,
          searchTerm,
          parseInt(limit) || 20
        );

        return res.status(200).json({
          success: true,
          agentType,
          searchTerm,
          count: searchResults.length,
          results: searchResults
        });

      default:
        return res.status(400).json({
          error: 'Invalid action parameter',
          availableActions: [
            'overview',
            'stats',
            'high-quality',
            'negative',
            'corrections',
            'recent',
            'trends',
            'top-messages',
            'search'
          ]
        });
    }
  } catch (error) {
    console.error('Error in admin feedback API:', error);
    return res.status(500).json({
      error: 'Failed to retrieve feedback data',
      message: error.message
    });
  }
}
