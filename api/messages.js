/**
 * Messages API Endpoint
 *
 * Manage messages in conversations
 * - GET: Retrieve messages for a conversation
 * - POST: Add new message to conversation
 */

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Verify JWT and extract user ID
 */
function verifyAuth(req) {
  const cookies = req.headers.cookie || '';
  const tokenMatch = cookies.match(/granted_session=([^;]+)/);

  if (!tokenMatch) {
    throw new Error('Not authenticated');
  }

  const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
  return decoded.id;
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verify authentication
    const userId = verifyAuth(req);

    // Route based on HTTP method
    switch (req.method) {
      case 'GET':
        return await handleGetMessages(req, res, userId);
      case 'POST':
        return await handleAddMessage(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Messages API error:', error);

    if (error.message === 'Not authenticated') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/messages?conversation_id=xxx
 * Retrieve messages for a conversation
 */
async function handleGetMessages(req, res, userId) {
  const { conversation_id } = req.query;

  if (!conversation_id) {
    return res.status(400).json({ error: 'conversation_id is required' });
  }

  // Verify user owns this conversation
  const conversationCheck = await pool.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [conversation_id, userId]
  );

  if (conversationCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Get messages
  const result = await pool.query(
    `SELECT id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversation_id]
  );

  return res.status(200).json({
    messages: result.rows
  });
}

/**
 * POST /api/messages
 * Add new message to conversation
 */
async function handleAddMessage(req, res, userId) {
  const { conversation_id, role, content } = req.body;

  if (!conversation_id || !role || !content) {
    return res.status(400).json({
      error: 'conversation_id, role, and content are required'
    });
  }

  // Validate role
  if (!['user', 'assistant', 'system'].includes(role)) {
    return res.status(400).json({
      error: 'role must be user, assistant, or system'
    });
  }

  // Verify user owns this conversation
  const conversationCheck = await pool.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [conversation_id, userId]
  );

  if (conversationCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Insert message
  const result = await pool.query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING id, role, content, created_at`,
    [conversation_id, role, content]
  );

  // Note: The trigger will automatically update conversations.updated_at

  return res.status(201).json({
    message: result.rows[0]
  });
}
