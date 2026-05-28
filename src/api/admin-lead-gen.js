/**
 * Admin API for Lead-Gen Dashboard
 *
 * Endpoints for reviewing and analyzing lead-gen conversations.
 * Requires authentication (JWT token).
 */

import { query, transaction } from '../database/connection.js';

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

    // Order and limit.
    //
    // SORT_WHITELIST values are SQL expression fragments interpolated into
    // `ORDER BY ${sortColumn}` below. Safety: lookup is by static key only
    // (`SORT_WHITELIST[sort_by]`); user input never reaches the SQL string.
    // Unknown sort_by values fall back to 'created_at'.
    //
    // The three bucketed-string columns (revenue_range, employee_count,
    // best_fit_product) need rank CASE expressions instead of plain column
    // references — alphabetical sort on '$5M+' / 'Pre-revenue' / 'Get Granted'
    // gives wrong order. Unknown bucket variants sort to rank 99 (end), never
    // silently mis-ordered.
    //
    // employee_count normalization: production data has 12 distinct strings
    // with dash/spacing variants ('1 – 4', '1-4', '1–4', '5–19', '5 – 19', etc.).
    // Two-pass regex: replace en/em-dash with hyphen, then strip whitespace,
    // then bucket. Collapses 12 raw strings to 7 normalized buckets.
    const SORT_WHITELIST = {
      created_at: 'created_at',
      estimated_funding: 'estimated_funding',
      message_count: 'message_count',
      company_name: "prospect_data->>'company_name'",
      industry: "prospect_data->>'industry'",
      province: "prospect_data->>'province'",
      revenue_range: `CASE prospect_data->>'revenue_range'
        WHEN 'Pre-revenue'    THEN 1
        WHEN 'Under $500K'    THEN 2
        WHEN '$500K – $2.5M'  THEN 3
        WHEN '$2.5M – $5M'    THEN 4
        WHEN '$5M+'           THEN 5
        ELSE 99
      END`,
      employee_count: `CASE regexp_replace(
             regexp_replace(lower(prospect_data->>'employee_count'), '[–—]', '-', 'g'),
             '\\s', '', 'g'
           )
        WHEN 'justme'                   THEN 1
        WHEN 'solo(planningtohire1-2)'  THEN 1
        WHEN '1(startingnextweek)'      THEN 2
        WHEN '1-4'                      THEN 3
        WHEN '5-19'                     THEN 4
        WHEN '20-49'                    THEN 5
        WHEN '50-99'                    THEN 6
        WHEN '100-499'                  THEN 7
        ELSE 99
      END`,
      best_fit_product: `CASE prospect_data->>'best_fit_product'
        WHEN 'Granted Pro'      THEN 1
        WHEN 'Granted Starter'  THEN 2
        WHEN 'Get Granted'      THEN 3
        WHEN 'Nonprofit'        THEN 4
        ELSE 99
      END`,
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
             -- DISTINCT session_id: widget emits estimate_delivered per assistant message containing a dollar-amount regex match (widget L1936-1939), so raw COUNT(*) overcounts
             COUNT(DISTINCT session_id) AS count
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
    // Counts ALL conversation rows in range. Missing best_fit_product buckets as
    // "Not Recommended" to surface persistence gaps (vs hiding them). Filtered by
    // created_at so unfinalized sessions are still counted; minor edge case: a
    // session created May 19 but finalized May 22 will count in May 1-21 funnel
    // but not in same-range estimates query.
    //
    // Inner subquery wrap is required because Postgres rejects alias references
    // in GROUP BY / ORDER BY expressions when the alias is defined by a complex
    // expression like COALESCE/NULLIF. The subquery promotes `tier` to a real
    // column on the outer FROM, where it can be referenced freely.
    let tierInnerWhere = `WHERE created_at >= '${DATA_FLOOR}'`;
    const tierParams = [];
    if (start_date) {
      tierParams.push(start_date);
      tierInnerWhere += ` AND created_at >= $${tierParams.length}::date`;
    }
    if (end_date) {
      tierParams.push(end_date);
      tierInnerWhere += ` AND created_at < $${tierParams.length}::date + INTERVAL '1 day'`;
    }
    const tierQuery = `
      SELECT tier, COUNT(*) AS count
      FROM (
        SELECT COALESCE(NULLIF(prospect_data->>'best_fit_product', ''), 'Not Recommended') AS tier
        FROM lead_gen_conversations
        ${tierInnerWhere}
      ) AS tiered_conversations
      GROUP BY tier
      ORDER BY
        CASE WHEN tier = 'Not Recommended' THEN 1 ELSE 0 END,
        count DESC
    `;

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

/**
 * DELETE /api/admin/lead-gen-conversations/:sessionId
 *
 * Hard-delete a lead-gen conversation. Atomic across three tables:
 *   1. lead_gen_events            — no FK to lead_gen_conversations, manual
 *   2. lead_gen_conversations     — cascades lead_gen_analytics
 *   3. conversations              — cascades messages + conversation_memory
 *
 * Wrapped in a transaction via the connection.js `transaction()` helper.
 * Any error in any of the three DELETEs rolls back the entire operation —
 * no partial state where (e.g.) events are cleaned but the conversation row
 * remains.
 *
 * Auth: authenticateUser middleware attaches req.user. We explicitly reject
 * if it's absent — stricter than the GET handlers because this is destructive.
 *
 * 404 on a non-existent session_id (rowCount=0 on the lead_gen_conversations
 * DELETE) so a stale double-click returns useful info instead of "deleted
 * nothing, 200 OK".
 *
 * Does NOT touch HubSpot. Local DB delete only. If the Contact in HubSpot
 * needs to go too, that's a separate operator step.
 */
export async function handleDeleteLeadGenConversation(req, res) {
  // Explicit auth gate — stricter than the GETs (destructive action).
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  const { sessionId } = req.params;

  // UUID sanity check. Not security (the parameterized DELETE is what
  // prevents injection); just a friendly reject for malformed paths so
  // we don't open a transaction for a URL that obviously won't match.
  if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid session_id format (must be a UUID)'
    });
  }

  try {
    const result = await transaction(async (client) => {
      // 1. lead_gen_events — no FK, must be explicit. A session may have
      //    zero events (e.g. agent never delivered an estimate), so 0 rows
      //    is not a "session doesn't exist" signal.
      const eventsResult = await client.query(
        'DELETE FROM lead_gen_events WHERE session_id = $1',
        [sessionId]
      );

      // 2. lead_gen_conversations — this is the row that represents the
      //    session. If rowCount=0, the session never existed (or was
      //    already deleted by a concurrent request). Throw a tagged error
      //    so the outer catch can return 404 instead of 500.
      const lgcResult = await client.query(
        'DELETE FROM lead_gen_conversations WHERE session_id = $1',
        [sessionId]
      );
      if (lgcResult.rowCount === 0) {
        const err = new Error('Session not found');
        err.code = 'SESSION_NOT_FOUND';
        throw err;
      }

      // 3. conversations (internal) — same UUID as session_id. Cascades
      //    messages + conversation_memory via existing FKs. rowCount=0 is
      //    acceptable here (some lead-gen flows may not have created an
      //    internal conversations row in edge cases).
      const convResult = await client.query(
        'DELETE FROM conversations WHERE id = $1',
        [sessionId]
      );

      return {
        events_deleted: eventsResult.rowCount,
        conversations_row_deleted: lgcResult.rowCount,
        internal_conversations_deleted: convResult.rowCount
      };
    });

    // Audit log — captured in Railway stdout.
    console.log(
      `🗑️  [DELETE LEAD-GEN] session=${sessionId} ` +
      `events=${result.events_deleted} ` +
      `internal_conv=${result.internal_conversations_deleted} ` +
      `by=${req.user.email || 'unknown'}`
    );

    return res.json({
      success: true,
      deleted_session: sessionId,
      events_deleted: result.events_deleted,
      conversations_deleted: result.conversations_row_deleted,
      internal_conversations_deleted: result.internal_conversations_deleted
    });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    console.error(`❌ Error deleting lead-gen conversation ${sessionId}:`, err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to delete conversation'
    });
  }
}
