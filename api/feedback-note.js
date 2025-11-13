/**
 * Feedback Notes API Endpoint
 * POST /api/feedback-note - Save a feedback note during conversation
 * GET /api/feedback-note/:conversationId - Get all notes for a conversation
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

  // GET - Retrieve notes for a conversation
  if (req.method === 'GET') {
    try {
      const { conversationId } = req.query;

      if (!conversationId) {
        return res.status(400).json({
          error: 'Missing conversationId parameter'
        });
      }

      const notes = await db.getFeedbackNotes(conversationId);

      return res.status(200).json({
        success: true,
        notes
      });
    } catch (error) {
      console.error('Error retrieving feedback notes:', error);
      return res.status(500).json({
        error: 'Failed to retrieve feedback notes',
        message: error.message
      });
    }
  }

  // POST - Save a feedback note
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
        noteText,
        messageIndex  // Optional: which message # when note was written
      } = req.body;

      // Validate required fields
      if (!conversationId || !noteText) {
        return res.status(400).json({
          error: 'Missing required fields: conversationId, noteText'
        });
      }

      // Validate note text length
      if (noteText.trim().length === 0) {
        return res.status(400).json({
          error: 'Note text cannot be empty'
        });
      }

      if (noteText.length > 1000) {
        return res.status(400).json({
          error: 'Note text too long (max 1000 characters)'
        });
      }

      // User ID is directly available from req.user (middleware already fetched from DB)
      const userId = user.id;

      // Save note
      const savedNote = await db.saveFeedbackNote(
        conversationId,
        userId,
        noteText.trim(),
        messageIndex || null
      );

      console.log(`📝 Feedback note saved: ${conversationId} - ${savedNote.sentiment} sentiment`);

      // Auto-trigger learning generation if threshold reached (runs in background)
      try {
        const conversation = await db.getConversation(conversationId);
        if (conversation?.agent_type) {
          const { autoTriggerLearningGeneration } = await import('../src/feedback-learning/auto-trigger.js');
          // Don't await - run in background
          autoTriggerLearningGeneration(conversation.agent_type).catch(err => {
            console.error('Background learning trigger failed:', err);
          });
        }
      } catch (error) {
        // Don't fail the note submission if auto-trigger fails
        console.error('Error triggering auto-learning:', error);
      }

      return res.status(200).json({
        success: true,
        note: savedNote
      });

    } catch (error) {
      console.error('Error saving feedback note:', error);
      return res.status(500).json({
        error: 'Failed to save feedback note',
        message: error.message
      });
    }
  }

  // Method not allowed
  return res.status(405).json({
    error: 'Method not allowed'
  });
}
