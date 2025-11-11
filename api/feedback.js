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
      // User is already authenticated by middleware and attached to req.user
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized - Please log in'
        });
      }

      const {
        conversationId,
        messageId,       // UUID of the specific message being rated (optional if messageIndex provided)
        messageIndex,    // Index of message (0-based) - alternative to messageId
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

      if (!messageId && messageIndex === undefined) {
        return res.status(400).json({
          error: 'Either messageId or messageIndex must be provided'
        });
      }

      // Validate rating value
      if (!['positive', 'negative'].includes(rating)) {
        return res.status(400).json({
          error: 'Invalid rating. Must be "positive" or "negative"'
        });
      }

      // User ID is directly available from req.user (middleware already fetched from DB)
      const userId = user.id;

      // If messageIndex provided instead of messageId, look up the message ID
      let actualMessageId = messageId;
      if (!actualMessageId && messageIndex !== undefined) {
        const messages = await db.getConversationMessages(conversationId);
        const message = messages[messageIndex];
        if (!message) {
          return res.status(400).json({
            error: `Message at index ${messageIndex} not found`
          });
        }
        actualMessageId = message.id;
      }

      // Save feedback with implicit signals (now per-message)
      const savedFeedback = await db.saveConversationFeedback(
        conversationId,
        actualMessageId,
        userId,
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
