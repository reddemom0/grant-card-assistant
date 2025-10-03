/**
 * Conversations API Endpoint
 *
 * CRUD operations for user conversations
 * - GET: List user's conversations (filtered by agent_type if provided)
 * - POST: Create new conversation
 * - PUT: Update conversation title
 * - DELETE: Delete conversation
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
        return await handleGetConversations(req, res, userId);
      case 'POST':
        return await handleCreateConversation(req, res, userId);
      case 'PUT':
        return await handleUpdateConversation(req, res, userId);
      case 'DELETE':
        return await handleDeleteConversation(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Conversations API error:', error);

    if (error.message === 'Not authenticated') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/conversations?agent_type=grant-cards
 * List user's conversations
 */
async function handleGetConversations(req, res, userId) {
  const { agent_type } = req.query;

  let query = `
    SELECT id, agent_type, title, created_at, updated_at
    FROM conversations
    WHERE user_id = $1
  `;
  const params = [userId];

  // Filter by agent type if provided
  if (agent_type) {
    query += ` AND agent_type = $2`;
    params.push(agent_type);
  }

  query += ` ORDER BY updated_at DESC`;

  const result = await pool.query(query, params);

  return res.status(200).json({
    conversations: result.rows
  });
}

/**
 * POST /api/conversations
 * Create new conversation
 */
async function handleCreateConversation(req, res, userId) {
  const { agent_type, title } = req.body;

  if (!agent_type) {
    return res.status(400).json({ error: 'agent_type is required' });
  }

  const result = await pool.query(
    `INSERT INTO conversations (user_id, agent_type, title)
     VALUES ($1, $2, $3)
     RETURNING id, agent_type, title, created_at, updated_at`,
    [userId, agent_type, title || 'New Conversation']
  );

  return res.status(201).json({
    conversation: result.rows[0]
  });
}

/**
 * PUT /api/conversations
 * Update conversation title
 */
async function handleUpdateConversation(req, res, userId) {
  const { conversation_id, title } = req.body;

  if (!conversation_id || !title) {
    return res.status(400).json({ error: 'conversation_id and title are required' });
  }

  // Verify ownership
  const checkResult = await pool.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [conversation_id, userId]
  );

  if (checkResult.rows.length === 0) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Update title
  const result = await pool.query(
    `UPDATE conversations
     SET title = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3
     RETURNING id, agent_type, title, created_at, updated_at`,
    [title, conversation_id, userId]
  );

  return res.status(200).json({
    conversation: result.rows[0]
  });
}

/**
 * DELETE /api/conversations?conversation_id=xxx
 * Delete conversation
 */
async function handleDeleteConversation(req, res, userId) {
  const { conversation_id } = req.query;

  if (!conversation_id) {
    return res.status(400).json({ error: 'conversation_id is required' });
  }

  // Verify ownership before deleting
  const result = await pool.query(
    'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
    [conversation_id, userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  return res.status(200).json({
    deleted: true,
    conversation_id: result.rows[0].id
  });
}
