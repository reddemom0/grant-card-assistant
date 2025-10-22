/**
 * Authentication Middleware
 *
 * Extracts user info from JWT cookie and attaches to request
 */

import jwt from 'jsonwebtoken';

/**
 * Verify JWT token from cookie and attach user to request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
export function authenticateUser(req, res, next) {
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

    // Attach user info to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture
    };

    console.log(`🔐 Authenticated user: ${req.user.email} (ID: ${req.user.id})`);
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
