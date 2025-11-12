/**
 * Feedback Metrics API (Non-Admin)
 * Accessible to all authenticated users
 * GET /api/feedback-metrics - Public feedback learning endpoints
 */

import * as feedbackRetrieval from '../src/feedback-learning/retrieval.js';
import { getLearningApplications, getLearningApplicationStats } from '../src/database/learning-tracking.js';

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  // User is already authenticated by middleware (req.user)
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized - Please log in'
    });
  }

  const { action, agentType, limit, searchTerm, days, q } = req.query;

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
        if (!agentType || !q) {
          return res.status(400).json({
            error: 'Missing agentType or q parameter'
          });
        }

        const searchResults = await feedbackRetrieval.searchFeedback(
          agentType,
          q,
          parseInt(limit) || 20
        );

        return res.status(200).json({
          success: true,
          agentType,
          searchTerm: q,
          count: searchResults.length,
          results: searchResults
        });

      case 'learning-history':
        // Get learning application history
        if (!agentType) {
          return res.status(400).json({
            error: 'Missing agentType parameter'
          });
        }

        const applications = await getLearningApplications(
          agentType,
          parseInt(limit) || 50
        );

        const appStats = await getLearningApplicationStats(agentType);

        // Parse files_loaded from JSON string to array and get learning content
        const { getLearningMemoryFiles } = await import('../src/database/learning-memory-storage.js');
        const learningFiles = await getLearningMemoryFiles(agentType);

        // Create a map of file content for quick lookup
        const fileContentMap = {};
        learningFiles.forEach(file => {
          fileContentMap[file.file_name] = file.content;
        });

        const parsedApplications = applications.map(app => ({
          ...app,
          files_loaded: typeof app.files_loaded === 'string'
            ? JSON.parse(app.files_loaded)
            : app.files_loaded,
          learning_content: fileContentMap // Include all learning content
        }));

        return res.status(200).json({
          success: true,
          agentType,
          count: parsedApplications.length,
          applications: parsedApplications,
          stats: {
            totalApplications: parseInt(appStats.total_applications),
            uniqueConversations: parseInt(appStats.unique_conversations),
            uniqueUsers: parseInt(appStats.unique_users),
            lastApplied: appStats.last_applied,
            firstApplied: appStats.first_applied
          }
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
            'search',
            'learning-history'
          ]
        });
    }
  } catch (error) {
    console.error('Error in feedback metrics API:', error);
    return res.status(500).json({
      error: 'Failed to retrieve feedback data',
      message: error.message
    });
  }
}
