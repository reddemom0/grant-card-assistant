/**
 * Admin Database Queries
 *
 * Centralized database queries for admin operations
 */

import { query } from './connection.js';

/**
 * Get all users with pagination and filtering
 *
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Results per page
 * @param {string} options.role - Filter by role
 * @param {boolean} options.isActive - Filter by active status
 * @param {string} options.search - Search by name or email
 * @returns {Promise<{users: Array, total: number, page: number, totalPages: number}>}
 */
export async function getUsers({ page = 1, limit = 50, role = null, isActive = null, search = null }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (role) {
    conditions.push(`role = $${paramIndex++}`);
    params.push(role);
  }

  if (isActive !== null) {
    conditions.push(`is_active = $${paramIndex++}`);
    params.push(isActive);
  }

  if (search) {
    conditions.push(`(name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM users ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total);

  // Get users
  params.push(limit, offset);
  const usersResult = await query(
    `SELECT id, google_id, email, name, picture, role, is_active, last_login, created_at, updated_at
     FROM users
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );

  return {
    users: usersResult.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Get user by ID with stats
 *
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User with conversation count
 */
export async function getUserById(userId) {
  const result = await query(
    `SELECT
       u.id, u.google_id, u.email, u.name, u.picture, u.role, u.is_active,
       u.last_login, u.created_at, u.updated_at,
       COUNT(DISTINCT c.id) as conversation_count
     FROM users u
     LEFT JOIN conversations c ON c.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  );

  return result.rows[0] || null;
}

/**
 * Update user role or active status
 *
 * @param {number} userId - User ID
 * @param {Object} updates - Fields to update
 * @param {string} updates.role - New role
 * @param {boolean} updates.is_active - Active status
 * @returns {Promise<Object>} Updated user
 */
export async function updateUser(userId, updates) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (updates.role !== undefined) {
    fields.push(`role = $${paramIndex++}`);
    params.push(updates.role);
  }

  if (updates.is_active !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    params.push(updates.is_active);
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  params.push(userId);
  const result = await query(
    `UPDATE users
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING id, email, name, role, is_active, updated_at`,
    params
  );

  return result.rows[0];
}

/**
 * Search conversations with filters
 *
 * @param {Object} options - Search options
 * @param {number} options.page - Page number
 * @param {number} options.limit - Results per page
 * @param {number} options.userId - Filter by user ID
 * @param {string} options.agentType - Filter by agent type
 * @param {Date} options.startDate - Filter by start date
 * @param {Date} options.endDate - Filter by end date
 * @param {string} options.search - Search in conversation content
 * @returns {Promise<{conversations: Array, total: number}>}
 */
export async function searchConversations({
  page = 1,
  limit = 50,
  userId = null,
  agentType = null,
  startDate = null,
  endDate = null,
  search = null
}) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (userId) {
    conditions.push(`c.user_id = $${paramIndex++}`);
    params.push(userId);
  }

  if (agentType) {
    conditions.push(`c.agent_type = $${paramIndex++}`);
    params.push(agentType);
  }

  if (startDate) {
    conditions.push(`c.created_at >= $${paramIndex++}`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`c.created_at <= $${paramIndex++}`);
    params.push(endDate);
  }

  if (search) {
    conditions.push(`c.title ILIKE $${paramIndex++}`);
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Get total
  const countResult = await query(
    `SELECT COUNT(*) as total FROM conversations c ${whereClause}`,
    params.slice(0, params.length - 2) // Don't include limit/offset
  );
  const total = parseInt(countResult.rows[0].total);

  // Get conversations with user info and stats
  params.push(limit, offset);
  const result = await query(
    `SELECT
       c.id, c.user_id, c.agent_type, c.title, c.created_at, c.updated_at,
       u.email as user_email, u.name as user_name,
       COUNT(m.id) as message_count,
       COALESCE(cs.tokens_used, 0) as tokens_used,
       COALESCE(cs.tool_calls_count, 0) as tool_calls_count,
       COALESCE(cs.error_count, 0) as error_count
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN messages m ON m.conversation_id = c.id
     LEFT JOIN conversation_stats cs ON cs.conversation_id = c.id
     ${whereClause}
     GROUP BY c.id, u.email, u.name, cs.tokens_used, cs.tool_calls_count, cs.error_count
     ORDER BY c.updated_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );

  return {
    conversations: result.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Get full conversation details with messages
 *
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<Object|null>} Conversation with messages
 */
export async function getConversationDetails(conversationId) {
  // Get conversation
  const convResult = await query(
    `SELECT
       c.*,
       u.email as user_email, u.name as user_name,
       cs.tokens_used, cs.tool_calls_count, cs.error_count
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN conversation_stats cs ON cs.conversation_id = c.id
     WHERE c.id = $1`,
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    return null;
  }

  const conversation = convResult.rows[0];

  // Get messages
  const messagesResult = await query(
    `SELECT id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );

  conversation.messages = messagesResult.rows;

  return conversation;
}

/**
 * Delete conversation and all related data
 *
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteConversation(conversationId) {
  const result = await query(
    'DELETE FROM conversations WHERE id = $1 RETURNING id',
    [conversationId]
  );

  return result.rows.length > 0;
}

/**
 * Get recent errors with filtering
 *
 * @param {Object} options - Query options
 * @param {number} options.limit - Number of errors to return
 * @param {string} options.agentType - Filter by agent type
 * @param {string} options.errorType - Filter by error type
 * @param {Date} options.since - Only errors after this date
 * @returns {Promise<Array>} Error logs
 */
export async function getRecentErrors({ limit = 100, agentType = null, errorType = null, since = null }) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (agentType) {
    conditions.push(`agent_type = $${paramIndex++}`);
    params.push(agentType);
  }

  if (errorType) {
    conditions.push(`error_type = $${paramIndex++}`);
    params.push(errorType);
  }

  if (since) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(since);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  params.push(limit);
  const result = await query(
    `SELECT
       e.*,
       u.email as user_email, u.name as user_name
     FROM error_logs e
     LEFT JOIN users u ON u.id = e.user_id
     ${whereClause}
     ORDER BY e.created_at DESC
     LIMIT $${paramIndex}`,
    params
  );

  return result.rows;
}

/**
 * Get admin audit log
 *
 * @param {Object} options - Query options
 * @param {number} options.page - Page number
 * @param {number} options.limit - Results per page
 * @param {number} options.adminUserId - Filter by admin user
 * @param {string} options.action - Filter by action type
 * @returns {Promise<{logs: Array, total: number}>}
 */
export async function getAuditLogs({ page = 1, limit = 100, adminUserId = null, action = null }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (adminUserId) {
    conditions.push(`a.admin_user_id = $${paramIndex++}`);
    params.push(adminUserId);
  }

  if (action) {
    conditions.push(`a.action = $${paramIndex++}`);
    params.push(action);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Get total
  const countResult = await query(
    `SELECT COUNT(*) as total FROM admin_audit_log a ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total);

  // Get logs
  params.push(limit, offset);
  const result = await query(
    `SELECT
       a.*,
       u.email as admin_email, u.name as admin_name
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );

  return {
    logs: result.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Log an error to error_logs table
 *
 * @param {Object} errorData - Error information
 * @param {number} errorData.userId - User ID (optional)
 * @param {string} errorData.conversationId - Conversation ID (optional)
 * @param {string} errorData.agentType - Agent type
 * @param {string} errorData.errorType - Error type
 * @param {string} errorData.errorMessage - Error message
 * @param {string} errorData.stackTrace - Stack trace
 * @param {string} errorData.requestPath - Request path
 * @param {string} errorData.userAgent - User agent
 * @param {string} errorData.ipAddress - IP address
 * @returns {Promise<void>}
 */
export async function logError(errorData) {
  await query(
    `INSERT INTO error_logs
     (user_id, conversation_id, agent_type, error_type, error_message, stack_trace, request_path, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      errorData.userId || null,
      errorData.conversationId || null,
      errorData.agentType || null,
      errorData.errorType || 'unknown',
      errorData.errorMessage,
      errorData.stackTrace || null,
      errorData.requestPath || null,
      errorData.userAgent || null,
      errorData.ipAddress || null
    ]
  );
}
