/**
 * Admin Authorization Middleware
 *
 * Provides middleware functions for admin-only routes and audit logging
 */

import { query } from '../database/connection.js';

/**
 * Require admin role to access route
 * Must be used after authenticateUser middleware
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
export function requireAdmin(req, res, next) {
  try {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to access admin features'
      });
    }

    // Check if user has admin role
    if (req.user.role !== 'admin') {
      console.warn(`⚠️  Unauthorized admin access attempt by user ${req.user.id} (${req.user.email})`);
      return res.status(403).json({
        error: 'Admin access required',
        message: 'You do not have permission to access this resource'
      });
    }

    // Check if admin account is active
    if (req.user.is_active === false) {
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Your admin account has been deactivated'
      });
    }

    console.log(`🔐 Admin access granted: ${req.user.email} → ${req.method} ${req.path}`);
    next();

  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      error: 'Authorization error',
      message: 'Failed to verify admin access'
    });
  }
}

/**
 * Log admin action to audit trail
 *
 * @param {Object} req - Express request (must have req.user)
 * @param {string} action - Action performed (e.g., 'user_role_changed')
 * @param {string} targetType - Type of entity affected (e.g., 'user', 'conversation')
 * @param {string} targetId - ID of affected entity
 * @param {Object} details - Additional details as JSON object
 * @returns {Promise<void>}
 */
export async function logAdminAction(req, action, targetType, targetId, details = {}) {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    await query(
      `INSERT INTO admin_audit_log
       (admin_user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user.id,
        action,
        targetType,
        targetId,
        JSON.stringify(details),
        ipAddress,
        userAgent
      ]
    );

    console.log(`📝 Audit log: ${req.user.email} → ${action} → ${targetType}:${targetId}`);

  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - audit logging should not break the request
  }
}

/**
 * Middleware factory to automatically log admin actions
 *
 * Usage:
 *   app.delete('/api/admin/conversation/:id',
 *     authenticateUser,
 *     requireAdmin,
 *     auditAction('conversation_deleted', 'conversation', 'params.id'),
 *     deleteConversation
 *   );
 *
 * @param {string} action - Action name
 * @param {string} targetType - Target entity type
 * @param {string} targetIdPath - Path to target ID in req object (e.g., 'params.id', 'body.userId')
 * @param {Function} detailsFn - Optional function to extract details from req
 * @returns {Function} Express middleware
 */
export function auditAction(action, targetType, targetIdPath, detailsFn = null) {
  return async (req, res, next) => {
    // Store audit info in req for later use (after action completes)
    req.auditInfo = {
      action,
      targetType,
      targetIdPath,
      detailsFn
    };

    // Monkey-patch res.json to log after successful response
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Only log if request was successful (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const targetId = targetIdPath.split('.').reduce((obj, key) => obj?.[key], req);
        const details = detailsFn ? detailsFn(req, data) : {};

        logAdminAction(req, action, targetType, targetId?.toString(), details)
          .catch(err => console.error('Audit log error:', err));
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Check if user has admin role (non-blocking check)
 *
 * @param {Object} user - User object from req.user
 * @returns {boolean}
 */
export function isAdmin(user) {
  return user && user.role === 'admin' && user.is_active !== false;
}

/**
 * Get admin user details from database (includes role and active status)
 *
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User object with role
 */
export async function getAdminUser(userId) {
  try {
    const result = await query(
      'SELECT id, email, name, picture, role, is_active, last_login FROM users WHERE id = $1',
      [userId]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching admin user:', error);
    return null;
  }
}
