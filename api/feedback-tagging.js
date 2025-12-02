/**
 * Feedback Tagging Admin API
 *
 * Endpoints for managing the automatic tagging system:
 * - Backfill historical feedback
 * - View untagged queue
 * - Manually add/remove tags
 */

import { backfillTags, getUntaggedQueue, manuallyAddTag, removeTag } from '../src/feedback/auto-tagger.js';

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

  // POST /api/feedback-tagging?action=backfill
  if (req.method === 'POST' && req.query.action === 'backfill') {
    try {
      const { limit = 100, daysBack = 30, agentType = null } = req.body;

      console.log(`🔄 Starting backfill: ${limit} items, ${daysBack} days, agent: ${agentType || 'all'}`);

      const result = await backfillTags({
        limit: parseInt(limit),
        daysBack: parseInt(daysBack),
        agentType
      });

      return res.status(200).json(result);

    } catch (error) {
      console.error('Backfill error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /api/feedback-tagging?action=queue
  if (req.method === 'GET' && req.query.action === 'queue') {
    try {
      const { limit = 50 } = req.query;

      const result = await getUntaggedQueue(parseInt(limit));

      return res.status(200).json(result);

    } catch (error) {
      console.error('Queue retrieval error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /api/feedback-tagging?action=add-tag
  if (req.method === 'POST' && req.query.action === 'add-tag') {
    try {
      const { feedbackId, noteId, tag } = req.body;

      if (!tag) {
        return res.status(400).json({
          error: 'Missing required field: tag'
        });
      }

      if (!feedbackId && !noteId) {
        return res.status(400).json({
          error: 'Must provide either feedbackId or noteId'
        });
      }

      const result = await manuallyAddTag(feedbackId || null, noteId || null, tag);

      return res.status(200).json(result);

    } catch (error) {
      console.error('Add tag error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /api/feedback-tagging?action=remove-tag
  if (req.method === 'POST' && req.query.action === 'remove-tag') {
    try {
      const { feedbackId, noteId, tag } = req.body;

      if (!tag) {
        return res.status(400).json({
          error: 'Missing required field: tag'
        });
      }

      if (!feedbackId && !noteId) {
        return res.status(400).json({
          error: 'Must provide either feedbackId or noteId'
        });
      }

      const result = await removeTag(feedbackId || null, noteId || null, tag);

      return res.status(200).json(result);

    } catch (error) {
      console.error('Remove tag error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Default: Show available actions
  return res.status(200).json({
    success: true,
    message: 'Feedback Tagging Admin API',
    availableActions: {
      backfill: {
        method: 'POST',
        url: '/api/feedback-tagging?action=backfill',
        body: {
          limit: '100 (max items to process)',
          daysBack: '30 (how many days back)',
          agentType: 'null (or specific agent type)'
        }
      },
      queue: {
        method: 'GET',
        url: '/api/feedback-tagging?action=queue&limit=50',
        description: 'Get untagged feedback for manual review'
      },
      addTag: {
        method: 'POST',
        url: '/api/feedback-tagging?action=add-tag',
        body: {
          feedbackId: 'or noteId',
          tag: 'tag-name'
        }
      },
      removeTag: {
        method: 'POST',
        url: '/api/feedback-tagging?action=remove-tag',
        body: {
          feedbackId: 'or noteId',
          tag: 'tag-name'
        }
      }
    }
  });
}
