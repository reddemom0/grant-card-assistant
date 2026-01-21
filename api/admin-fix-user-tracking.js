/**
 * Admin API endpoint to check and fix user tracking issues
 * GET /api/admin-fix-user-tracking?email=marketing@granted.ca
 */

import { query } from '../src/database/connection.js';

export default async function handler(req, res) {
  // Require authentication
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { email, action } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'email parameter required' });
    }

    console.log(`🔧 Admin fix-user-tracking: ${email}, action: ${action || 'check'}`);

    // Check if user exists
    const userResult = await query(
      'SELECT id, email, name, created_at, is_active FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        message: `${email} does not exist in the users table. They need to log in via Google OAuth to create their account.`
      });
    }

    const user = userResult.rows[0];
    const originalActiveStatus = user.is_active;

    // Count conversations
    const convCount = await query(
      'SELECT COUNT(*) as count FROM conversations WHERE user_id = $1',
      [user.id]
    );

    // Get recent usage (last 30 days)
    const recentUsage = await query(`
      SELECT
        agent_type,
        COUNT(*) as count,
        MAX(created_at) as last_used
      FROM conversations
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY agent_type
      ORDER BY count DESC
    `, [user.id]);

    const result = {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        is_active: user.is_active,
        was_inactive: !user.is_active
      },
      stats: {
        total_conversations: parseInt(convCount.rows[0].count),
        recent_usage: recentUsage.rows
      }
    };

    // If action=fix and user is inactive, activate them
    if (action === 'fix' && !user.is_active) {
      await query(
        'UPDATE users SET is_active = true WHERE id = $1',
        [user.id]
      );

      result.fixed = true;
      result.message = `✅ User ${email} has been activated and will now appear in analytics`;
      result.user.is_active = true;

      console.log(`✅ Activated user: ${email} (ID: ${user.id})`);
    } else if (!user.is_active) {
      result.fixed = false;
      result.message = `⚠️ User ${email} is INACTIVE and won't appear in analytics. Add ?action=fix to activate them.`;
    } else {
      result.fixed = false;
      result.message = `✅ User ${email} is already active and should appear in analytics`;
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Admin fix-user-tracking error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check/fix user tracking',
      message: error.message
    });
  }
}
