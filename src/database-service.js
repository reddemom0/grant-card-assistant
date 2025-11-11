import pg from 'pg';
import { config } from 'dotenv';

// Load environment variables
config();

const { Pool } = pg;

// Create connection pool (reuses connections efficiently)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ===== USER OPERATIONS =====

/**
 * Create or get a user by google_id (for Railway schema)
 * Returns the user's integer ID for foreign key references
 */
export async function ensureUser(googleId, email = null, name = null) {
  const client = await pool.connect();
  try {
    // Use a default email if not provided (for test users)
    const userEmail = email || `user-${googleId}@test.local`;
    const userName = name || 'Test User';

    const result = await client.query(
      `INSERT INTO users (google_id, email, name, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (google_id) DO UPDATE
       SET last_login = NOW()
       RETURNING *`,
      [googleId, userEmail, userName]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

// ===== CONVERSATION OPERATIONS =====

/**
 * Get a conversation with all its messages
 */
export async function getConversation(conversationId) {
  const client = await pool.connect();
  try {
    // Get conversation metadata
    const convResult = await client.query(
      'SELECT * FROM conversations WHERE id = $1',
      [conversationId]
    );

    if (convResult.rows.length === 0) {
      return null;
    }

    const conversation = convResult.rows[0];

    // Get all messages for this conversation
    const messagesResult = await client.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    // Get file attachments
    const filesResult = await client.query(
      'SELECT * FROM file_attachments WHERE conversation_id = $1 ORDER BY upload_timestamp ASC',
      [conversationId]
    );

    return {
      ...conversation,
      messages: messagesResult.rows,
      files: filesResult.rows,
    };
  } finally {
    client.release();
  }
}

/**
 * Create a new conversation
 */
export async function createConversation(conversationId, userId, agentType, title = null) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO conversations (id, user_id, agent_type, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [conversationId, userId, agentType, title]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save a message to a conversation
 */
export async function saveMessage(conversationId, role, content) {
  const client = await pool.connect();
  try {
    // Insert message
    const result = await client.query(
      `INSERT INTO messages (conversation_id, role, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [conversationId, role, content]
    );

    // Update conversation's updated_at timestamp
    await client.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
      [conversationId]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save file attachment metadata
 */
export async function saveFileAttachment(conversationId, filename, fileType, fileSize) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO file_attachments (conversation_id, filename, file_type, file_size, upload_timestamp)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [conversationId, filename, fileType, fileSize]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get all conversations for a user
 */
export async function getUserConversations(userId, agentType = null, limit = 50) {
  const client = await pool.connect();
  try {
    let query = 'SELECT * FROM conversations WHERE user_id = $1';
    const params = [userId];

    if (agentType) {
      query += ' AND agent_type = $2';
      params.push(agentType);
    }

    query += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Delete a conversation and all its messages/files (cascade)
 */
export async function deleteConversation(conversationId) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    return true;
  } finally {
    client.release();
  }
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(conversationId, title) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [title, conversationId]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// ===== FEEDBACK OPERATIONS =====

/**
 * Save per-message feedback (thumbs up/down rating)
 * @param {string} conversationId - UUID of the conversation
 * @param {string} messageId - UUID of the specific message being rated
 * @param {number} userId - ID of the user providing feedback
 * @param {string} rating - 'positive' or 'negative'
 * @param {string} feedbackText - Optional text explanation
 * @param {object} implicitSignals - { revisionCount, completionTime, messageCount }
 * @returns {object} Saved feedback record
 */
export async function saveConversationFeedback(
  conversationId,
  messageId,
  userId,
  rating,
  feedbackText = null,
  implicitSignals = {}
) {
  const client = await pool.connect();
  try {
    // Calculate quality score
    const qualityScore = calculateQualityScore(rating, implicitSignals);

    const result = await client.query(
      `INSERT INTO conversation_feedback
       (conversation_id, message_id, user_id, rating, feedback_text, revision_count, completion_time_seconds, message_count, quality_score, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (message_id)
       DO UPDATE SET
         rating = EXCLUDED.rating,
         feedback_text = EXCLUDED.feedback_text,
         revision_count = EXCLUDED.revision_count,
         completion_time_seconds = EXCLUDED.completion_time_seconds,
         message_count = EXCLUDED.message_count,
         quality_score = EXCLUDED.quality_score,
         created_at = NOW()
       RETURNING *`,
      [
        conversationId,
        messageId,
        userId,
        rating,
        feedbackText,
        implicitSignals.revisionCount || 0,
        implicitSignals.completionTime || null,
        implicitSignals.messageCount || 0,
        qualityScore
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save a feedback note (ongoing feedback during conversation)
 * @param {string} conversationId
 * @param {number} userId
 * @param {string} noteText
 * @param {number} messageIndex - Which message # when note was written
 * @returns {object} Saved note record
 */
export async function saveFeedbackNote(conversationId, userId, noteText, messageIndex = null) {
  const client = await pool.connect();
  try {
    // Detect sentiment from note text
    const sentiment = detectSentiment(noteText);

    const result = await client.query(
      `INSERT INTO feedback_notes
       (conversation_id, user_id, note_text, message_index, sentiment, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [conversationId, userId, noteText, messageIndex, sentiment]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get all feedback for a conversation
 * @param {string} conversationId
 * @returns {object} { rating, notes }
 */
export async function getConversationFeedback(conversationId) {
  const client = await pool.connect();
  try {
    // Get overall rating
    const ratingResult = await client.query(
      'SELECT * FROM conversation_feedback WHERE conversation_id = $1',
      [conversationId]
    );

    // Get all notes
    const notesResult = await client.query(
      'SELECT * FROM feedback_notes WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    return {
      rating: ratingResult.rows[0] || null,
      notes: notesResult.rows,
    };
  } finally {
    client.release();
  }
}

/**
 * Get feedback notes for a conversation
 * @param {string} conversationId
 * @returns {array} Array of feedback notes
 */
export async function getFeedbackNotes(conversationId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM feedback_notes WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Calculate quality score from rating and implicit signals
 * Score ranges from 0.0 (worst) to 1.0 (best)
 */
function calculateQualityScore(rating, signals = {}) {
  // Base score from rating
  let score = rating === 'positive' ? 0.75 : 0.25;

  // Bonus for zero revisions (first draft accepted)
  if (signals.revisionCount === 0 && rating === 'positive') {
    score += 0.15;
  }

  // Penalty for many revisions
  if (signals.revisionCount > 2) {
    score -= 0.15;
  }

  // Bonus for fast completion (< 10 minutes)
  if (signals.completionTime && signals.completionTime < 600 && rating === 'positive') {
    score += 0.10;
  }

  // Cap between 0 and 1
  return Math.max(0, Math.min(1, score));
}

/**
 * Simple sentiment detection from note text
 * Uses keyword matching for basic classification
 */
function detectSentiment(text) {
  const lowerText = text.toLowerCase();

  const positiveKeywords = [
    'great', 'good', 'excellent', 'perfect', 'helpful', 'useful',
    'love', 'amazing', 'awesome', 'fantastic', 'nice', 'thanks',
    'appreciate', 'well done', 'clear', 'concise'
  ];

  const negativeKeywords = [
    'bad', 'poor', 'confusing', 'unclear', 'wrong', 'incorrect',
    'missing', 'unhelpful', 'frustrating', 'difficult', 'too long',
    'verbose', 'complicated', 'needs work', 'not good', 'disappointing'
  ];

  const positiveCount = positiveKeywords.filter(word => lowerText.includes(word)).length;
  const negativeCount = negativeKeywords.filter(word => lowerText.includes(word)).length;

  if (positiveCount > negativeCount && positiveCount > 0) {
    return 'positive';
  } else if (negativeCount > positiveCount && negativeCount > 0) {
    return 'negative';
  } else if (positiveCount > 0 && negativeCount > 0) {
    return 'mixed';
  } else {
    return 'neutral';
  }
}

// ===== HELPER FUNCTIONS =====

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    return { success: true, timestamp: result.rows[0].now };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Close pool (for graceful shutdown)
 */
export async function closePool() {
  await pool.end();
}

export default {
  ensureUser,
  getConversation,
  createConversation,
  saveMessage,
  saveFileAttachment,
  getUserConversations,
  deleteConversation,
  updateConversationTitle,
  saveConversationFeedback,
  saveFeedbackNote,
  getConversationFeedback,
  getFeedbackNotes,
  testConnection,
  closePool,
};
