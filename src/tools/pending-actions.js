/**
 * Stored-action confirmation gate
 *
 * High-risk tool calls are not executed when the model asks for them. They are
 * saved here, described to the user in code-written plain language, and run only
 * when a human replies with a confirmation word (see src/api/confirmation.js).
 *
 * The model cannot bypass this. It controls the tool input and nothing else:
 * the only way a gated tool reaches its implementation is runPendingAction(),
 * which passes an internal argument that executeToolCall verifies against a
 * pending database row.
 */

import { query } from '../database/connection.js';

/** How long a proposal stays confirmable. */
const TTL_HOURS = 24;

/**
 * Tools that must be confirmed before they run.
 *
 * Each value is a predicate over (input, context) returning true when this
 * particular call needs confirmation. Predicates may be async — update_calendar_event
 * has to fetch the event, because an event that ALREADY has attendees is just as
 * risky to change and the input alone cannot show that.
 *
 * Creating new private files (a new Doc, a new Sheet) is deliberately absent:
 * nothing is overwritten and nobody else is affected.
 */
export const GATED_TOOLS = {
  // Writes to shared CRM records the whole company reads.
  create_hubspot_deal: () => true,
  update_hubspot_deal: () => true,
  // Proposed by tracked cards (review outcome); no agent has it as a tool.
  create_hubspot_note: () => true,

  // Irreversible: the secondary record is deleted.
  merge_duplicate_companies: () => true,
  merge_duplicate_contacts: () => true,

  // Destroys existing document content. How much depends on the document's
  // structure, not on anything visible in the input.
  replace_google_doc_section: () => true,

  // Inviting people emails them. A solo event affects nobody.
  create_calendar_event: (input) =>
    Array.isArray(input?.attendees) && input.attendees.length > 0,

  // Attendees in the input OR already on the event.
  update_calendar_event: async (input, context) => {
    if (Array.isArray(input?.attendees) && input.attendees.length > 0) return true;
    return hasExistingAttendees(input?.event_id, context?.userId);
  }
};

/**
 * Does this calendar event already have other people on it?
 *
 * Fails CLOSED: if the event cannot be read, treat it as needing confirmation.
 * A read failure must not become a silent ungated write.
 */
async function hasExistingAttendees(eventId, userId) {
  if (!eventId || !userId) return true;
  try {
    const { getCalendarClient } = await import('./google-calendar.js');
    const cal = await getCalendarClient(userId);
    const resp = await cal.events.get({ calendarId: 'primary', eventId });
    return (resp.data.attendees || []).filter(a => !a.self).length > 0;
  } catch (err) {
    console.warn(`⚠️  Could not read event ${eventId} to check attendees (${err.message}) — gating to be safe`);
    return true;
  }
}

// ============================================================================
// THE ONE EXEMPTION
// ----------------------------------------------------------------------------
// The HubSpot webhook runs Oracle headlessly: there is no human in the loop, so
// a gated deal write would sit unconfirmed until it expired. These two tools run
// immediately for the dedicated system account, and only for it.
//
// Identity comes from the userId argument, which reaches the executor from
// resolveWebhookUser() (src/api/hubspot-webhook.js) on the webhook path and from
// the verified session elsewhere. It is never read from the message or the tool
// input, so nothing the model writes can claim it.
//
// Merges are deliberately NOT here. Deleting a record is not something to do
// unattended, however trusted the caller.
// ============================================================================
const AUTO_APPROVED_TOOLS = new Set(['create_hubspot_deal', 'update_hubspot_deal']);
const AUTO_APPROVAL_REASON = 'webhook system account';

/**
 * Is this the configured webhook system account?
 *
 * Fails CLOSED: any doubt — variable unset, lookup failure, account misconfigured
 * — means "no", and the call goes back to needing a human.
 */
export async function isWebhookSystemAccount(userId) {
  if (!userId) return false;
  try {
    const { resolveWebhookUser } = await import('../api/hubspot-webhook.js');
    const webhookUser = await resolveWebhookUser();
    return webhookUser?.ok === true && webhookUser.id === userId;
  } catch (err) {
    console.warn(`⚠️  Could not resolve the webhook system account (${err.message}) — treating as a normal user`);
    return false;
  }
}

/**
 * Whether this exact call qualifies for the exemption.
 * @param {string} toolName
 * @param {number} userId - server-side identity, never model-supplied
 */
export async function isAutoApproved(toolName, userId) {
  if (!AUTO_APPROVED_TOOLS.has(toolName)) return false;
  return isWebhookSystemAccount(userId);
}

/**
 * Log an exempt call. Written BEFORE the tool runs, so a crash mid-call still
 * leaves a trace of what was attempted; recordResult() fills in the outcome.
 *
 * Status is 'auto_approved', never 'pending', so this row can never be picked up
 * by a later "yes" and re-run.
 */
export async function recordAutoApproval({ conversationId, toolName, input, userId, summary }) {
  const result = await query(
    `INSERT INTO pending_actions
       (conversation_id, tool_name, tool_input, summary, proposed_by,
        status, expires_at, confirmed_by, confirmed_at, auto_approved_reason)
     VALUES ($1, $2, $3, $4, $5, 'auto_approved', NOW(), $5, NOW(), $6)
     RETURNING *`,
    [conversationId, toolName, JSON.stringify(input), summary, userId ?? null, AUTO_APPROVAL_REASON]
  );
  console.log(`⚡ ${toolName} auto-approved (${AUTO_APPROVAL_REASON}) — action ${result.rows[0].id}`);
  return result.rows[0];
}

/**
 * Attach the outcome to an already-logged action.
 */
export async function recordResult(actionId, result) {
  if (!actionId) return;
  await query(
    `UPDATE pending_actions SET result = $2 WHERE id = $1`,
    [actionId, JSON.stringify(result ?? {})]
  );
}

/**
 * Whether a call needs confirmation. Async because one predicate is.
 */
export async function requiresConfirmation(toolName, input, context = {}) {
  const predicate = GATED_TOOLS[toolName];
  if (!predicate) return false;
  return Boolean(await predicate(input, context));
}

// ============================================================================
// SUMMARIES — what the user reads
// ----------------------------------------------------------------------------
// Written from the saved input, never by the model, and deliberately free of
// tool names and API jargon: the reader should recognise the real-world effect.
// ============================================================================

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (key === 'amount' && !Number.isNaN(Number(value))) {
    return `$${Number(value).toLocaleString('en-CA')}`;
  }
  return String(value);
}

function describeProperties(properties = {}) {
  const entries = Object.entries(properties);
  if (entries.length === 0) return 'no fields';
  return entries.map(([k, v]) => `${k} → ${formatValue(k, v)}`).join(', ');
}

function formatWhen(start, end) {
  try {
    const s = new Date(start);
    const date = s.toLocaleString('en-CA', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit'
    });
    if (!end) return date;
    const e = new Date(end);
    return `${date}–${e.toLocaleString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return `${start}${end ? ` – ${end}` : ''}`;
  }
}

/**
 * Plain-language description of exactly what will run.
 * @returns {string}
 */
export function summarizeAction(toolName, input = {}) {
  switch (toolName) {
    case 'create_hubspot_deal': {
      const p = input.properties || {};
      const bits = [`Create HubSpot deal "${p.dealname || '(unnamed)'}"`];
      if (p.pipeline) bits.push(`pipeline ${p.pipeline}`);
      if (p.dealstage) bits.push(`stage ${p.dealstage}`);
      if (p.amount) bits.push(`amount ${formatValue('amount', p.amount)}`);
      const assoc = input.associations || {};
      const links = [assoc.company_id && `company ${assoc.company_id}`, assoc.contact_id && `contact ${assoc.contact_id}`]
        .filter(Boolean);
      return `${bits.join(', ')}${links.length ? `, linked to ${links.join(' and ')}` : ''}.`;
    }

    case 'update_hubspot_deal':
      return `Update HubSpot deal ${input.deal_id}: ${describeProperties(input.properties)}.`;

    case 'create_hubspot_note': {
      const body = String(input.body || '').replace(/\s+/g, ' ').trim();
      const shown = body.length > 200 ? `${body.slice(0, 199)}…` : body;
      return `Add a note to HubSpot deal ${input.deal_name ? `"${input.deal_name}" ` : ''}(${input.deal_id}): "${shown}".`;
    }

    case 'merge_duplicate_companies':
      return `Merge HubSpot company ${input.secondary_company_id} into ${input.primary_company_id}. ` +
        `The merged record is deleted and this cannot be undone.`;

    case 'merge_duplicate_contacts':
      return `Merge HubSpot contact ${input.secondary_contact_id} into ${input.primary_contact_id}. ` +
        `The merged record is deleted and this cannot be undone.`;

    case 'replace_google_doc_section':
      return `Replace everything under the "${input.heading_text}" heading in document ${input.document_id}. ` +
        `The content currently there is deleted.`;

    case 'create_calendar_event': {
      const who = (input.attendees || []).join(', ');
      return `Create the calendar event "${input.title}" on ${formatWhen(input.start, input.end)}` +
        `${who ? ` and invite ${who}` : ''}${input.add_meet_link ? ', with a Meet link' : ''}. ` +
        `${who ? 'Everyone invited gets an email.' : ''}`.trim();
    }

    case 'update_calendar_event': {
      const changes = [
        input.title && `title → "${input.title}"`,
        input.start && `starts ${formatWhen(input.start, input.end)}`,
        input.location && `location → ${input.location}`,
        input.status === 'cancelled' && 'CANCEL the event',
        Array.isArray(input.attendees) && input.attendees.length > 0 && `invite ${input.attendees.join(', ')}`
      ].filter(Boolean);
      return `Change calendar event ${input.event_id}: ${changes.length ? changes.join(', ') : 'no visible changes'}. ` +
        `Everyone on the event is notified.`;
    }

    default:
      // Unreachable for registered tools, but a new gated tool without a
      // summary must still say something true rather than throw.
      return `Run ${toolName.replace(/_/g, ' ')} with the values already proposed.`;
  }
}

// ============================================================================
// STORAGE
// ============================================================================

/**
 * Save a proposal, superseding any earlier pending one in the same conversation.
 * @returns {Promise<Object>} the stored row
 */
export async function savePendingAction({ conversationId, toolName, input, userId, summary }) {
  await query(
    `UPDATE pending_actions SET status = 'superseded'
      WHERE conversation_id = $1 AND status = 'pending'`,
    [conversationId]
  );

  const result = await query(
    `INSERT INTO pending_actions
       (conversation_id, tool_name, tool_input, summary, proposed_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${TTL_HOURS} hours')
     RETURNING *`,
    [conversationId, toolName, JSON.stringify(input), summary, userId ?? null]
  );
  return result.rows[0];
}

/**
 * The one pending, unexpired action for a conversation.
 *
 * Expiry is applied on read rather than by a sweeper: a row past expires_at is
 * marked 'expired' here and reported as absent.
 *
 * @returns {Promise<{action: Object|null, expired: boolean}>}
 */
export async function getPendingAction(conversationId) {
  const result = await query(
    `SELECT * FROM pending_actions
      WHERE conversation_id = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  const action = result.rows[0];
  if (!action) return { action: null, expired: false };

  if (new Date(action.expires_at) <= new Date()) {
    await query(`UPDATE pending_actions SET status = 'expired' WHERE id = $1`, [action.id]);
    return { action: null, expired: true };
  }
  return { action, expired: false };
}

/**
 * Run a saved action. The ONLY path that executes a gated tool.
 *
 * Re-reads the row under its id, so a caller cannot run something that was
 * superseded or already confirmed while the request was in flight.
 *
 * @returns {Promise<{ok: boolean, summary?: string, result?: Object, reason?: string}>}
 */
export async function runPendingAction({ actionId, userId, agentType = 'internal-oracle' }) {
  const claimed = await query(
    `UPDATE pending_actions
        SET status = 'confirmed', confirmed_by = $2, confirmed_at = NOW()
      WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
      RETURNING *`,
    [actionId, userId ?? null]
  );
  const action = claimed.rows[0];
  if (!action) return { ok: false, reason: 'not_pending' };

  const { executeToolCall } = await import('./executor.js');
  const result = await executeToolCall(
    action.tool_name,
    action.tool_input,
    action.conversation_id,
    userId,
    agentType,
    { pendingActionId: action.id }   // internal-only; the model can never set this
  );

  await query(
    `UPDATE pending_actions SET result = $2, status = $3 WHERE id = $1`,
    [action.id, JSON.stringify(result ?? {}), result?.success === false ? 'failed' : 'confirmed']
  );

  return { ok: true, summary: action.summary, result, toolName: action.tool_name };
}

/**
 * Decline a saved action: it can never run afterwards, and a later "yes" finds
 * nothing waiting. Used by a tracked card's "Don't add note" button.
 *
 * Status becomes 'declined' (alongside pending | confirmed | superseded |
 * expired | failed); who declined is kept in `result`.
 *
 * @returns {Promise<boolean>} false when the action was no longer pending
 */
export async function declinePendingAction({ actionId, userId = null, chatUserId = null }) {
  const declined = await query(
    `UPDATE pending_actions SET status = 'declined', result = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [actionId, JSON.stringify({ declined: true, declined_by: userId ?? null, declined_by_chat_user: chatUserId ?? null })]
  );
  return declined.rows.length > 0;
}

/**
 * Is this id a live pending row? Used by the executor to validate the internal
 * bypass argument, so "gated tool ran" always implies "a row authorised it".
 */
export async function isAuthorisedExecution(actionId) {
  if (!actionId) return false;
  const result = await query(
    `SELECT 1 FROM pending_actions
      WHERE id = $1 AND status IN ('pending', 'confirmed') AND expires_at > NOW()`,
    [actionId]
  );
  return result.rows.length > 0;
}
