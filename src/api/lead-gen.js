/**
 * Lead Generation Chatbot API
 *
 * Public-facing endpoint — NO authenticateUser middleware.
 * Handles POST /api/lead-gen/chat
 *
 * Rate limits (enforced via lead_gen_conversations table):
 *   - Max 10 new sessions per IP per hour
 *   - Max 20 messages per session
 *   - Max 500 characters per user message
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/connection.js';
import { runAgent } from '../claude/client.js';
import { createConversation } from '../database/messages.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_SESSIONS_PER_IP_PER_HOUR = 50;
const MAX_MESSAGES_PER_SESSION = 20;
const MAX_MESSAGE_LENGTH = 500;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract the real client IP, respecting Railway / proxy headers.
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Count new sessions created by this IP in the last hour.
 */
async function countRecentSessionsForIp(ipAddress) {
  const result = await query(
    `SELECT COUNT(DISTINCT session_id) AS cnt
     FROM lead_gen_conversations
     WHERE ip_address = $1
       AND created_at >= NOW() - INTERVAL '1 hour'`,
    [ipAddress]
  );
  return parseInt(result.rows[0]?.cnt || 0, 10);
}

/**
 * Create a new lead-gen session row and a matching conversations row
 * (required by runAgent for message history storage).
 *
 * Returns the session_id UUID that serves as:
 *   - the client-facing token
 *   - the conversationId for runAgent
 *   - conversations.id in the messages table
 */
async function createLeadGenSession(ipAddress) {
  const sessionId = uuidv4();

  // Create entry in the internal conversations table so runAgent can
  // load/save message history via the standard messages infrastructure.
  await createConversation(sessionId, null, 'lead-gen', 'Lead Gen Chat');

  // Create the lead-gen-specific metadata row.
  await query(
    `INSERT INTO lead_gen_conversations
       (session_id, ip_address)
     VALUES ($1, $2)`,
    [sessionId, ipAddress]
  );

  // Fire-and-forget: log conversation_started analytics event
  query(
    `INSERT INTO lead_gen_analytics (conversation_id, event_type)
     VALUES ($1, $2)`,
    [sessionId, 'conversation_started']
  ).catch(err => console.warn('⚠️  Analytics log failed (conversation_started):', err.message));

  console.log(`✓ Lead-gen session created: ${sessionId} (IP: ${ipAddress})`);
  return sessionId;
}

/**
 * Look up an existing lead-gen session by session_id.
 * Returns null if not found.
 */
async function getLeadGenSession(sessionId) {
  const result = await query(
    `SELECT * FROM lead_gen_conversations WHERE session_id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

/**
 * Increment message_count and touch updated_at for a session.
 */
async function incrementMessageCount(sessionId) {
  await query(
    `UPDATE lead_gen_conversations
     SET message_count = message_count + 1,
         updated_at    = NOW()
     WHERE session_id = $1`,
    [sessionId]
  );
}

// ============================================================================
// ANALYTICS ENDPOINT HANDLER
// ============================================================================

/**
 * GET /api/lead-gen/analytics
 *
 * Returns funnel summary stats for the lead-gen chatbot.
 * Requires valid JWT (authenticated team members only — added in server.js routing).
 */
export async function handleLeadGenAnalytics(req, res) {
  try {
    // Total conversations started
    const convRow = await query(
      `SELECT COUNT(*) AS total FROM lead_gen_conversations`
    );
    const totalConversations = parseInt(convRow.rows[0]?.total || 0, 10);

    // Searches performed + average results per search
    const searchRow = await query(
      `SELECT
         COUNT(*) AS total_searches,
         AVG((event_data->>'results_count')::numeric) AS avg_results
       FROM lead_gen_analytics
       WHERE event_type = 'search_performed'`
    );
    const totalSearches    = parseInt(searchRow.rows[0]?.total_searches || 0, 10);
    const avgResultsPerSearch = parseFloat(searchRow.rows[0]?.avg_results || 0).toFixed(1);

    // Contacts captured
    const capturedRow = await query(
      `SELECT COUNT(*) AS total FROM lead_gen_analytics WHERE event_type = 'contact_captured'`
    );
    const totalContactsCaptured = parseInt(capturedRow.rows[0]?.total || 0, 10);

    // Lead score breakdown (from contact_captured events)
    const scoreRow = await query(
      `SELECT
         event_data->>'lead_score' AS score,
         COUNT(*) AS cnt
       FROM lead_gen_analytics
       WHERE event_type = 'contact_captured'
         AND event_data->>'lead_score' IS NOT NULL
       GROUP BY score`
    );
    const leadScoreBreakdown = {};
    for (const row of scoreRow.rows) {
      leadScoreBreakdown[row.score] = parseInt(row.cnt, 10);
    }

    // CTA breakdown (from contact_captured events)
    const ctaRow = await query(
      `SELECT
         event_data->>'cta_selected' AS cta,
         COUNT(*) AS cnt
       FROM lead_gen_analytics
       WHERE event_type = 'contact_captured'
         AND event_data->>'cta_selected' IS NOT NULL
       GROUP BY cta`
    );
    const ctaBreakdown = {};
    for (const row of ctaRow.rows) {
      ctaBreakdown[row.cta] = parseInt(row.cnt, 10);
    }

    // Conversion rate: contacts captured / conversations started
    const conversionRate = totalConversations > 0
      ? ((totalContactsCaptured / totalConversations) * 100).toFixed(1) + '%'
      : '0%';

    // Last 7 days daily volume
    const dailyRow = await query(
      `SELECT
         DATE(created_at AT TIME ZONE 'America/Vancouver') AS day,
         COUNT(*) AS conversations
       FROM lead_gen_conversations
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY day
       ORDER BY day ASC`
    );

    return res.json({
      success: true,
      funnel: {
        total_conversations:     totalConversations,
        total_searches:          totalSearches,
        avg_results_per_search:  parseFloat(avgResultsPerSearch),
        total_contacts_captured: totalContactsCaptured,
        conversion_rate:         conversionRate
      },
      lead_score_breakdown: leadScoreBreakdown,
      cta_breakdown:        ctaBreakdown,
      daily_conversations_last_7d: dailyRow.rows
    });
  } catch (err) {
    console.error('❌ Analytics query failed:', err.message);
    return res.status(500).json({ error: 'Analytics query failed.' });
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * POST /api/lead-gen/chat
 *
 * Request body:
 *   { session_id?: string, message: string }
 *
 * Response: SSE stream (same as /api/chat)
 *   - First SSE event always includes { type: 'connected', session_id }
 */
export async function handleLeadGenChat(req, res) {
  console.log('\n' + '▓'.repeat(80));
  console.log('🌐 Lead-gen chat request');
  console.log('▓'.repeat(80));

  try {
    const { session_id: incomingSessionId, message: rawMessage } = req.body;
    const ipAddress = getClientIp(req);

    console.log(`  IP: ${ipAddress}`);
    console.log(`  Session provided: ${incomingSessionId || '(none — new session)'}`);

    // -------------------------------------------------------------------------
    // 1. Validate message
    // -------------------------------------------------------------------------

    if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return res.status(400).json({
        error: 'Please include a message in your request.'
      });
    }

    const message = rawMessage.trim();

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Your message is too long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`
      });
    }

    // -------------------------------------------------------------------------
    // 2. Session handling + rate limiting
    // -------------------------------------------------------------------------

    let sessionId;

    if (!incomingSessionId) {
      // --- New session ---

      // Rate limit: max 10 new sessions per IP per hour
      const recentCount = await countRecentSessionsForIp(ipAddress);
      if (recentCount >= MAX_SESSIONS_PER_IP_PER_HOUR) {
        console.warn(`⚠️  Rate limit hit for IP ${ipAddress}: ${recentCount} sessions in last hour`);
        return res.status(429).json({
          error: "You've started several chats recently. Please wait a bit before starting a new one, or continue your existing conversation."
        });
      }

      sessionId = await createLeadGenSession(ipAddress);

    } else {
      // --- Existing session ---

      const session = await getLeadGenSession(incomingSessionId);

      if (!session) {
        return res.status(404).json({
          error: "We couldn't find that conversation. Please refresh and start a new one."
        });
      }

      // Rate limit: max 20 messages per session
      if (session.message_count >= MAX_MESSAGES_PER_SESSION) {
        return res.status(429).json({
          error: "You've reached the message limit for this conversation. To continue, please book a call with our team — they'll be happy to dig deeper with you."
        });
      }

      sessionId = session.session_id;
      console.log(`✓ Resuming session: ${sessionId} (${session.message_count} messages so far)`);
    }

    // -------------------------------------------------------------------------
    // 3. Increment message count (optimistic — before agent runs)
    // -------------------------------------------------------------------------

    await incrementMessageCount(sessionId);

    // -------------------------------------------------------------------------
    // 4. Run the lead-gen agent (SSE streaming)
    //    session_id == conversationId in the conversations/messages tables
    // -------------------------------------------------------------------------

    console.log(`🚀 Running lead-gen agent for session: ${sessionId}`);
    console.log('─'.repeat(80));

    // NOTE: The system prompt (.claude/agents/lead-gen.md) is created in Step 3.
    // Until then, runAgent will fall back to base tools with no system prompt.
    await runAgent({
      agentType: 'lead-gen',
      message,
      conversationId: sessionId,   // maps to conversations.id
      userId: null,                 // public endpoint — no authenticated user
      sessionId: uuidv4(),         // per-request session ID for SSE connection tracking
      attachments: [],
      res
    });

    // runAgent handles SSE streaming and closes the connection.

  } catch (error) {
    console.error('\n' + '▓'.repeat(80));
    console.error('❌ Lead-gen chat error:', error);
    console.error('▓'.repeat(80) + '\n');

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Something went wrong on our end. Please try again in a moment.'
      });
    } else {
      // SSE stream already started — send error event then close
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'An unexpected error occurred.' })}\n\n`);
      res.end();
    }
  }
}
