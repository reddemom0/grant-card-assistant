/**
 * Admin API for Lead-Gen Dashboard
 *
 * Endpoints for reviewing and analyzing lead-gen conversations.
 * Requires authentication (JWT token).
 */

import { query } from '../database/connection.js';

/**
 * GET /api/admin/lead-gen-conversations
 *
 * List all lead-gen conversations with optional filters.
 * Returns sessions sorted by created_at DESC.
 *
 * Query params:
 *   - days: filter to last N days (optional)
 *   - start_date: filter from date (YYYY-MM-DD) (optional)
 *   - end_date: filter to date (YYYY-MM-DD) (optional)
 *   - province: filter by province (optional)
 *   - finalized: filter by finalized status (true/false/all) (optional)
 *   - min_messages: filter by minimum message count (optional)
 *   - score: filter by lead score (hot/warm/cool) (optional)
 *   - has_email: filter by contact capture status (true/false) (optional)
 *   - limit: max results (default: 100)
 */
export async function handleListLeadGenConversations(req, res) {
  try {
    const {
      days,
      start_date,
      end_date,
      province,
      finalized,
      min_messages,
      score,
      has_email,
      limit = '100'
    } = req.query;

    let queryText = `
      SELECT
        session_id,
        contact_name,
        contact_email,
        prospect_data,
        matched_programs,
        estimated_funding,
        cta_selected,
        created_at,
        updated_at,
        message_count,
        finalized,
        finalized_at,
        finalization_trigger,
        messages
      FROM lead_gen_conversations
      WHERE 1=1
    `;

    const params = [];

    // Date filter - days takes precedence
    if (days) {
      params.push(days);
      queryText += ` AND created_at >= NOW() - INTERVAL '${days} days'`;
    } else {
      // Date range filter
      if (start_date) {
        params.push(start_date);
        queryText += ` AND created_at >= $${params.length}::date`;
      }
      if (end_date) {
        params.push(end_date);
        queryText += ` AND created_at < $${params.length}::date + INTERVAL '1 day'`;
      }
    }

    // Province filter
    if (province && province !== 'all') {
      params.push(`%${province}%`);
      queryText += ` AND prospect_data->>'province' ILIKE $${params.length}`;
    }

    // Finalized filter
    if (finalized === 'true') {
      queryText += ` AND finalized = true`;
    } else if (finalized === 'false') {
      queryText += ` AND finalized = false`;
    }
    // 'all' or undefined = no filter

    // Minimum message count filter
    if (min_messages) {
      params.push(parseInt(min_messages, 10));
      queryText += ` AND message_count >= $${params.length}`;
    }

    // Lead score filter
    if (score) {
      params.push(score);
      queryText += ` AND prospect_data->>'lead_score' = $${params.length}`;
    }

    // Email capture filter
    if (has_email === 'true') {
      queryText += ` AND contact_email IS NOT NULL`;
    } else if (has_email === 'false') {
      queryText += ` AND contact_email IS NULL`;
    }

    // Order and limit
    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));

    const result = await query(queryText, params);

    return res.json({
      success: true,
      conversations: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ Error listing lead-gen conversations:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to load conversations'
    });
  }
}

/**
 * GET /api/admin/lead-gen-stats
 *
 * Get summary statistics for lead-gen dashboard.
 * Returns: total sessions today, total this week, average messages, conversion rate
 */
export async function handleLeadGenStats(req, res) {
  try {
    // Total sessions today
    const todayResult = await query(`
      SELECT COUNT(*) as count
      FROM lead_gen_conversations
      WHERE created_at >= CURRENT_DATE
    `);

    // Total sessions this week (last 7 days)
    const weekResult = await query(`
      SELECT COUNT(*) as count
      FROM lead_gen_conversations
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    // Average messages per session
    const avgMessagesResult = await query(`
      SELECT ROUND(AVG(message_count), 1) as avg_messages
      FROM lead_gen_conversations
      WHERE message_count > 0
    `);

    // Conversion rate (sessions with CTA / total sessions)
    const conversionResult = await query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN cta_selected IS NOT NULL AND cta_selected != 'none' THEN 1 END) as with_cta
      FROM lead_gen_conversations
    `);

    const totalSessions = parseInt(conversionResult.rows[0].total_sessions, 10);
    const withCta = parseInt(conversionResult.rows[0].with_cta, 10);
    const conversionRate = totalSessions > 0
      ? Math.round((withCta / totalSessions) * 100)
      : 0;

    return res.json({
      success: true,
      stats: {
        total_today: parseInt(todayResult.rows[0].count, 10),
        total_week: parseInt(weekResult.rows[0].count, 10),
        avg_messages: parseFloat(avgMessagesResult.rows[0].avg_messages) || 0,
        conversion_rate: conversionRate,
        total_sessions: totalSessions,
        with_cta: withCta
      }
    });
  } catch (err) {
    console.error('❌ Error getting lead-gen stats:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to load stats'
    });
  }
}

/**
 * GET /api/admin/lead-gen-messages/:sessionId
 *
 * Get full conversation transcript for a specific session.
 * Returns messages array from lead_gen_conversations.messages JSONB.
 */
export async function handleGetLeadGenMessages(req, res) {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
      });
    }

    const result = await query(
      `SELECT messages FROM lead_gen_conversations WHERE session_id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    const messages = result.rows[0].messages || [];

    return res.json({
      success: true,
      messages,
      count: messages.length
    });
  } catch (err) {
    console.error('❌ Error retrieving messages:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to load messages'
    });
  }
}
