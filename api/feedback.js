/**
 * Feedback API Endpoint
 * POST /api/feedback - Save conversation feedback (thumbs up/down)
 * GET /api/feedback/:conversationId - Get feedback for a conversation
 */

import * as db from '../src/database-service.js';
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

export default async function handler(req, res) {
  // Handle OPTIONS for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - Retrieve feedback for a conversation
  if (req.method === 'GET') {
    try {
      const { conversationId } = req.query;

      if (!conversationId) {
        return res.status(400).json({
          error: 'Missing conversationId parameter'
        });
      }

      const feedback = await db.getConversationFeedback(conversationId);

      return res.status(200).json({
        success: true,
        feedback
      });
    } catch (error) {
      console.error('Error retrieving feedback:', error);
      return res.status(500).json({
        error: 'Failed to retrieve feedback',
        message: error.message
      });
    }
  }

  // POST - Save conversation feedback
  if (req.method === 'POST') {
    try {
      // Get user from JWT
      const user = getUserFromToken(req);
      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized - Please log in'
        });
      }

      const {
        conversationId,
        rating,          // 'positive' | 'negative'
        feedbackText,    // Optional text explanation
        revisionCount,   // How many times user asked for changes
        completionTime,  // How long conversation took (seconds)
        messageCount     // Total messages in conversation
      } = req.body;

      // Validate required fields
      if (!conversationId || !rating) {
        return res.status(400).json({
          error: 'Missing required fields: conversationId, rating'
        });
      }

      // Validate rating value
      if (!['positive', 'negative'].includes(rating)) {
        return res.status(400).json({
          error: 'Invalid rating. Must be "positive" or "negative"'
        });
      }

      // Get user's database ID
      const dbUser = await db.ensureUser(user.google_id, user.email, user.name);

      // Save feedback with implicit signals
      const savedFeedback = await db.saveConversationFeedback(
        conversationId,
        dbUser.id,
        rating,
        feedbackText,
        {
          revisionCount: revisionCount || 0,
          completionTime: completionTime || null,
          messageCount: messageCount || 0
        }
      );

      console.log(`✅ Feedback saved: ${conversationId} - ${rating} (quality: ${savedFeedback.quality_score})`);

      return res.status(200).json({
        success: true,
        feedback: savedFeedback
      });

    } catch (error) {
      console.error('Error saving feedback:', error);
      return res.status(500).json({
        error: 'Failed to save feedback',
        message: error.message
      });
    }
  }

  // Method not allowed
  return res.status(405).json({
    error: 'Method not allowed'
  });
}
