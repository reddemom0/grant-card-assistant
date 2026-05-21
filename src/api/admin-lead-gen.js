/**
 * Admin API for Lead-Gen Dashboard
 *
 * Endpoints for reviewing and analyzing lead-gen conversations.
 * Requires authentication (JWT token).
 */

import { query } from '../database/connection.js';

// Exclude test data created before this date from all queries
const DATA_FLOOR = '2026-04-01';

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
 *   - industry: filter by industry (optional, ILIKE match)
 *   - finalized: filter by finalized status (true/false/all) (optional)
 *   - min_messages: filter by minimum message count (optional)
 *   - score: filter by lead score (hot/warm/cool) (optional)
 *   - has_email: filter by contact capture status (true/false) (optional)
 *   - sort_by: column to sort by (default: created_at)
 *   - sort_dir: sort direction asc/desc (default: desc)
 *   - limit: max results (default: 100)
 */
export async function handleListLeadGenConversations(req, res) {
  try {
    const {
      days,
      start_date,
      end_date,
      province,
      industry,
      finalized,
      min_messages,
      score,
      has_email,
      sort_by = 'created_at',
      sort_dir = 'desc',
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
      WHERE created_at >= '${DATA_FLOOR}'
    `;

    const params = [];

    // Date filter - days takes precedence
    if (days) {
      params.push(parseInt(days, 10));
      queryText += ` AND created_at >= NOW() - MAKE_INTERVAL(days => $${params.length})`;
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

    // Industry filter
    if (industry && industry !== 'all') {
      params.push(`%${industry}%`);
      queryText += ` AND prospect_data->>'industry' ILIKE $${params.length}`;
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
    const SORT_WHITELIST = {
      created_at: 'created_at',
      estimated_funding: 'estimated_funding',
      message_count: 'message_count',
      company_name: "prospect_data->>'company_name'",
      industry: "prospect_data->>'industry'",
      province: "prospect_data->>'province'",
    };
    const sortColumn = SORT_WHITELIST[sort_by] || 'created_at';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';
    queryText += ` ORDER BY ${sortColumn} ${sortDirection} NULLS LAST LIMIT $${params.length + 1}`;
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
 * Returns two datasets for the dashboard cards:
 *   - estimates_by_source: counts of estimate_delivered events grouped by widget_mode
 *   - tier_funnel: counts of finalized conversations grouped by best_fit_product
 *
 * Query params (both optional, mirror handleListLeadGenConversations):
 *   - start_date (YYYY-MM-DD): inclusive lower bound
 *   - end_date (YYYY-MM-DD): inclusive upper bound (SQL applies < end_date + 1 day)
 *
 * estimates_by_source filters on lead_gen_events.created_at.
 * tier_funnel filters on lead_gen_conversations.finalized_at (the bucket should
 * reflect when the recommendation was made, not when the session started).
 */
export async function handleLeadGenStats(req, res) {
  try {
    const { start_date, end_date } = req.query;

    // estimates_by_source
    let estimatesQuery = `
      SELECT event_data->>'widget_mode' AS source,
             COUNT(*) AS count
      FROM lead_gen_events
      WHERE event_type = 'estimate_delivered'
        AND created_at >= '${DATA_FLOOR}'
    `;
    const estimatesParams = [];
    if (start_date) {
      estimatesParams.push(start_date);
      estimatesQuery += ` AND created_at >= $${estimatesParams.length}::date`;
    }
    if (end_date) {
      estimatesParams.push(end_date);
      estimatesQuery += ` AND created_at < $${estimatesParams.length}::date + INTERVAL '1 day'`;
    }
    estimatesQuery += ` GROUP BY source ORDER BY count DESC`;

    // tier_funnel
    let tierQuery = `
      SELECT prospect_data->>'best_fit_product' AS tier,
             COUNT(*) AS count
      FROM lead_gen_conversations
      WHERE finalized = true
        AND prospect_data ? 'best_fit_product'
        AND prospect_data->>'best_fit_product' IS NOT NULL
        AND created_at >= '${DATA_FLOOR}'
    `;
    const tierParams = [];
    if (start_date) {
      tierParams.push(start_date);
      tierQuery += ` AND finalized_at >= $${tierParams.length}::date`;
    }
    if (end_date) {
      tierParams.push(end_date);
      tierQuery += ` AND finalized_at < $${tierParams.length}::date + INTERVAL '1 day'`;
    }
    tierQuery += ` GROUP BY tier ORDER BY count DESC`;

    const [estimatesResult, tierResult] = await Promise.all([
      query(estimatesQuery, estimatesParams),
      query(tierQuery, tierParams),
    ]);

    return res.json({
      success: true,
      stats: {
        estimates_by_source: estimatesResult.rows.map(r => ({
          source: r.source,
          count: parseInt(r.count, 10),
        })),
        tier_funnel: tierResult.rows.map(r => ({
          tier: r.tier,
          count: parseInt(r.count, 10),
        })),
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
