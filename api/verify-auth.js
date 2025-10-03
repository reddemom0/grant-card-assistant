/**
 * Verify Authentication Endpoint
 *
 * Verifies JWT token from cookie and returns user data
 * Used by frontend to check auth status on page load
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async (req, res) => {
  // Set CORS headers for credential-based requests
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Extract JWT from cookie
    const cookies = req.headers.cookie || '';
    const tokenMatch = cookies.match(/granted_session=([^;]+)/);

    if (!tokenMatch) {
      return res.status(200).json({
        authenticated: false,
        user: null
      });
    }

    const token = tokenMatch[1];

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);

    // Return user data
    return res.status(200).json({
      authenticated: true,
      user: {
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture
      }
    });

  } catch (error) {
    console.error('Auth verification error:', error.message);

    // Invalid or expired token
    return res.status(200).json({
      authenticated: false,
      user: null
    });
  }
};
