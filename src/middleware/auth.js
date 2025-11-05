/**
 * Authentication Middleware
 *
 * Extracts user info from JWT cookie and attaches to request
 */

import jwt from 'jsonwebtoken';
import { query } from '../database/connection.js';

/**
 * Verify JWT token from cookie and attach user to request
 * Loads user role and status from database
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
export async function authenticateUser(req, res, next) {
  try {
    // Get token from cookie
    const token = req.headers.cookie
      ?.split('; ')
      .find(c => c.startsWith('granted_session='))
      ?.split('=')[1];

    if (!token) {
      // No token - user is anonymous
      req.user = null;
      return next();
    }

    // Verify and decode token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user details including role and active status
    const result = await query(
      'SELECT id, email, name, picture, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      console.warn(`⚠️  User ID ${decoded.userId} from JWT not found in database`);
      req.user = null;
      return next();
    }

    const user = result.rows[0];

    // Attach user info to request with role
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role || 'user',
      is_active: user.is_active !== false
    };

    console.log(`🔐 Authenticated user: ${req.user.email} (ID: ${req.user.id}, Role: ${req.user.role})`);
    next();

  } catch (error) {
    // Invalid/expired token - treat as anonymous
    console.warn('⚠️  JWT verification failed:', error.message);
    req.user = null;
    next();
  }
}

/**
 * Optional middleware - require authentication
 * Use this for endpoints that need auth
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
  }
  next();
}
