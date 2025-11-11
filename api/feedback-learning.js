/**
 * Feedback Learning API
 *
 * Endpoint to trigger feedback analysis and memory file generation.
 * Accessible to authenticated users (can be restricted to admin later).
 */

import {
  runFeedbackLearning,
  runFeedbackLearningForAllAgents,
  getLearningStatus
} from '../src/feedback-learning/orchestrator.js';

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

  // GET: Get learning status
  if (req.method === 'GET') {
    const { agentType } = req.query;

    try {
      if (agentType) {
        // Get status for specific agent
        const status = await getLearningStatus(agentType);
        return res.json({
          success: true,
          ...status
        });
      } else {
        // Get status for all agents
        return res.json({
          success: true,
          message: 'Use ?agentType=<type> to get status for a specific agent',
          availableAgents: [
            'etg-writer',
            'grant-cards',
            'bcafe-writer',
            'canexport-claims',
            'readiness-strategist'
          ]
        });
      }
    } catch (error) {
      console.error('Error getting learning status:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST: Trigger learning process
  if (req.method === 'POST') {
    const { agentType, all } = req.body;

    try {
      if (all) {
        // Run for all agents
        console.log('🧠 API: Running feedback learning for ALL agents');
        const result = await runFeedbackLearningForAllAgents();
        return res.json(result);
      } else if (agentType) {
        // Run for specific agent
        console.log(`🧠 API: Running feedback learning for ${agentType}`);
        const result = await runFeedbackLearning(agentType);
        return res.json(result);
      } else {
        return res.status(400).json({
          error: 'Missing required parameter',
          message: 'Provide either "agentType" or "all: true"',
          examples: {
            single: { agentType: 'etg-writer' },
            all: { all: true }
          }
        });
      }
    } catch (error) {
      console.error('Error running feedback learning:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Method not allowed
  return res.status(405).json({
    error: 'Method not allowed',
    allowedMethods: ['GET', 'POST']
  });
}
