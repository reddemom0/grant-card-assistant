/**
 * Control Centre review queue (migration 044)
 *
 * One item per thing that needs a look: a bad match (company + grant root),
 * a bad chat answer (one chat turn, or one issue in one conversation), or a
 * grant pattern (the AI review cut one grant for one reason across companies,
 * migration 047). Flags pile onto the item:
 *
 *   client_thumbs_down  a 👎 from the app DB's grant_recommendation_feedback_events,
 *                       pulled hourly by runReviewSweep (source_ref = rating id)
 *   staff_flag          POST /api/control-centre/review/flag (source_ref = staff:<uuid>),
 *                       or Oracle's gg3_conversations log_issue
 *   ai_review_cut       an AI Final Review cut, filed hourly by grant-patterns.js
 *                       (source_ref = ai_review:<id>)
 *   oracle_detected     Oracle's morning chat review, pulse-roundup.js
 *                       (source_ref = oracle:<conversation>:<issue>:<date>)
 *
 * source_ref is UNIQUE, so a re-sweep never double-counts. A new flag on a
 * closed item reopens it to 'new' with flagged_again and clears the old
 * owner and diagnosis — except a grant_pattern card, which reopens only on a
 * cut that happened after it was closed; an older cut arriving late is kept
 * as evidence and leaves it closed.
 *
 * Status: new → diagnosed → in_progress → closed. Only close() reaches
 * 'closed', and a match item can't close without expected_match. Closing a
 * grant_pattern card logs a 'recheck' event on every match card linked to it
 * (cc_review_links) and changes nothing else on them.
 *
 * Every mutation writes one cc_review_events row in the same transaction.
 *
 * Writes only the Hub DB. The app DB is read through db.js (read-only).
 * Logs carry counts and error codes only — never ids, names or comments.
 *
 * Diagnosis (step 5, migration 045): diagnose() freezes the evidence, routes
 * to an owner and has Sonnet write the narrative (diagnosis.js); runDiagnosis
 * records it. A failure leaves the item 'new' and counts an attempt; the third
 * failure diagnoses it as could_not_diagnose for chris.
 *
 * Hourly sweep: only when CC_REVIEW_SWEEP_ENABLED=true. CLI:
 * scripts/cc-review-sweep.mjs. Routes: review-routes.js. Docs: docs/control-centre.md.
 */

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../database/connection.js';
import { appQuery, isAppDbConfigured } from './db.js';
import { TIME_ZONE } from './rollup.js';
import { diagnoseItem, couldNotDiagnose, MAX_DIAGNOSIS_ATTEMPTS } from './diagnosis.js';
import { runPatternSweep } from './grant-patterns.js';

export const KINDS = Object.freeze(['match', 'chat', 'grant_pattern']);
export const STATUSES = Object.freeze(['new', 'diagnosed', 'in_progress', 'closed']);
export const OWNERS = Object.freeze(['client', 'research', 'chris', 'jason']);
export const SOURCES = Object.freeze(['client_thumbs_down', 'staff_flag', 'ai_review_cut', 'oracle_detected']);
export const EXPECTED = Object.freeze(['should', 'shouldnt']);

/** Who fixes what. chris is also the default when the cause is unclear. */
export const OWNER_ROUTING = Object.freeze({
  client: 'company profile',
  research: 'grant data / card copy',
  chris: 'tagger, engine, chat answers; default when the cause is unclear',
  jason: 'app bugs'
});
export const DEFAULT_OWNER = 'chris';

export const MAX_TEXT = 4000;
export const MAX_REF = 200;
/** The sweep re-reads this far behind its cursor; source_ref dedupes the overlap. */
export const SWEEP_OVERLAP_MS = 60 * 60 * 1000;
export const SWEEP_ACTOR = 'system:review-sweep';

export class ReviewQueueError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ReviewQueueError';
    this.status = status;
  }
}

const bad = (message) => new ReviewQueueError(400, message);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/** A positive integer id from a number or a digits-only string, else null. */
export function parseId(v) {
  if (typeof v === 'number') return isPositiveInt(v) ? v : null;
  if (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function optionalText(v, field, max = MAX_TEXT) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw bad(`${field} must be a string`);
  if (v.length > max) throw bad(`${field} is longer than ${max} characters`);
  return v;
}

function requiredId(v, field) {
  const id = parseId(v);
  if (id === null) throw bad(`${field} must be a positive integer`);
  return id;
}

/** Throws 400 on bad input; returns the normalised flag. */
export function validateFlag(input = {}) {
  const { kind, source } = input;
  if (!KINDS.includes(kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
  if (!SOURCES.includes(source)) throw bad(`source must be one of ${SOURCES.join(', ')}`);

  const out = { kind, source, company_id: null, grant_root_id: null, chat_turn_ref: null,
    pattern_category: null, conversation_id: null };
  if (input.pattern_category != null && kind !== 'grant_pattern') throw bad('pattern_category is only for grant_pattern items');
  if (kind === 'match') {
    out.company_id = requiredId(input.company_id, 'company_id');
    out.grant_root_id = requiredId(input.grant_root_id, 'grant_root_id');
    if (input.chat_turn_ref != null) throw bad('chat_turn_ref is only for chat items');
  } else if (kind === 'grant_pattern') {
    out.grant_root_id = requiredId(input.grant_root_id, 'grant_root_id');
    out.pattern_category = optionalText(input.pattern_category, 'pattern_category', MAX_REF);
    if (!out.pattern_category) throw bad('pattern_category is required for grant_pattern items');
    if (input.company_id != null) throw bad('company_id is not used on grant_pattern items');
    if (input.chat_turn_ref != null) throw bad('chat_turn_ref is only for chat items');
  } else {
    out.chat_turn_ref = optionalText(input.chat_turn_ref, 'chat_turn_ref', MAX_REF);
    if (!out.chat_turn_ref) throw bad('chat_turn_ref is required for chat items');
    if (input.grant_root_id != null) throw bad('grant_root_id is only for match items');
    if (input.company_id != null) out.company_id = requiredId(input.company_id, 'company_id');
    if (input.conversation_id != null) out.conversation_id = requiredId(input.conversation_id, 'conversation_id');
  }

  out.source_ref = optionalText(input.source_ref, 'source_ref', MAX_REF);
  if (!out.source_ref) {
    if (source !== 'staff_flag') throw bad('source_ref is required for client flags');
    out.source_ref = `staff:${randomUUID()}`;
  }
  out.actor = optionalText(input.actor, 'actor', MAX_REF);
  out.comment = optionalText(input.comment, 'comment');
  out.source_created_at = input.source_created_at ?? null;
  // Evidence the filer already has (a chat card's turns). Stored only when the
  // item has none; never accepted from the HTTP route.
  if (input.snapshot != null && (typeof input.snapshot !== 'object' || Array.isArray(input.snapshot))) {
    throw bad('snapshot must be an object');
  }
  out.snapshot = input.snapshot ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// SQL (Hub DB)
// ---------------------------------------------------------------------------

// No conflict target: covers all three partial unique keys (match pair, chat
// turn, grant pattern).
export const INSERT_ITEM_SQL = `
  INSERT INTO cc_review_items (kind, company_id, grant_root_id, chat_turn_ref, pattern_category, conversation_id)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT DO NOTHING
  RETURNING id`;

export const LOCK_PATTERN_SQL = `
  SELECT * FROM cc_review_items
   WHERE kind = 'grant_pattern' AND grant_root_id = $1 AND pattern_category = $2
   FOR UPDATE`;

// Evidence handed in by the filer, kept only when the item has none.
export const SET_SNAPSHOT_SQL = `
  UPDATE cc_review_items SET snapshot = $2::jsonb, snapshot_at = NOW()
   WHERE id = $1 AND snapshot IS NULL
  RETURNING *`;

export const LINKED_ITEMS_SQL = `
  SELECT i.id, i.kind, i.status, i.company_id, i.grant_root_id, i.pattern_category, l.relation
    FROM cc_review_links l
    JOIN cc_review_items i ON i.id = CASE WHEN l.item_id = $1 THEN l.linked_item_id ELSE l.item_id END
   WHERE l.item_id = $1 OR l.linked_item_id = $1
   ORDER BY i.id`;

export const LOCK_MATCH_SQL = `
  SELECT * FROM cc_review_items
   WHERE kind = 'match' AND company_id = $1 AND grant_root_id = $2
   FOR UPDATE`;

export const LOCK_CHAT_SQL = `
  SELECT * FROM cc_review_items
   WHERE kind = 'chat' AND chat_turn_ref = $1
   FOR UPDATE`;

export const LOCK_ITEM_SQL = 'SELECT * FROM cc_review_items WHERE id = $1 FOR UPDATE';

export const INSERT_FLAG_SQL = `
  INSERT INTO cc_review_flags (item_id, source, source_ref, source_created_at, actor, comment)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (source_ref) DO NOTHING
  RETURNING id`;

export const BUMP_SQL = `
  UPDATE cc_review_items SET flag_count = flag_count + 1, updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

// A closed item that gets a new flag starts over; the close is kept in the
// events log.
export const REOPEN_SQL = `
  UPDATE cc_review_items
     SET flag_count = flag_count + 1, status = 'new', flagged_again = TRUE,
         owner = NULL, diagnosis = NULL, narrative = NULL, client_notice = NULL,
         expected_match = NULL, close_note = NULL, closed_by = NULL, closed_at = NULL,
         snapshot = NULL, snapshot_at = NULL, diagnosis_attempts = 0, last_error = NULL,
         updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

// $6/$7: a snapshot taken on this attempt (NULL keeps the stored one).
export const DIAGNOSE_SQL = `
  UPDATE cc_review_items
     SET owner = $2, diagnosis = $3, narrative = $4, client_notice = $5,
         snapshot = CASE WHEN $6::jsonb IS NULL THEN snapshot ELSE $6::jsonb END,
         snapshot_at = CASE WHEN $6::jsonb IS NULL THEN snapshot_at ELSE $7::timestamptz END,
         diagnosis_attempts = $8, last_error = $9,
         status = 'diagnosed', updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

// A failed attempt. Status stays 'new' and updated_at is left alone, so an
// hourly retry doesn't float the item to the top of the list.
export const RECORD_FAILURE_SQL = `
  UPDATE cc_review_items
     SET diagnosis_attempts = $2, last_error = $3,
         snapshot = CASE WHEN $4::jsonb IS NULL THEN snapshot ELSE $4::jsonb END,
         snapshot_at = CASE WHEN $4::jsonb IS NULL THEN snapshot_at ELSE $5::timestamptz END
   WHERE id = $1
  RETURNING *`;

// moveStatus never targets 'closed', so a move always clears the close.
export const SET_STATUS_SQL = `
  UPDATE cc_review_items
     SET status = $2, closed_by = NULL, closed_at = NULL, updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

export const SET_OWNER_SQL = `
  UPDATE cc_review_items SET owner = $2, updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

export const CLOSE_SQL = `
  UPDATE cc_review_items
     SET status = 'closed', expected_match = $2, close_note = $3, closed_by = $4,
         closed_at = NOW(), updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

export const INSERT_EVENT_SQL = `
  INSERT INTO cc_review_events (item_id, actor, action, from_status, to_status, detail)
  VALUES ($1, $2, $3, $4, $5, $6)`;

/** Open and no activity for this many days: the board marks the card stuck. */
export const STUCK_DAYS = 3;

// "Last activity" — shared by the board (LIST_SQL) and Oracle's control_centre
// tool so both call the same cards stuck. A card's activity is the later of
// updated_at and its newest staff comment; comments don't move updated_at.
// Use LAST_ACTIVITY_JOIN after `FROM cc_review_items i`.
export const LAST_ACTIVITY_JOIN = `
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS at
        FROM cc_review_events e
       WHERE e.item_id = i.id AND e.action = 'comment'
    ) cm ON TRUE`;
export const LAST_ACTIVITY = 'GREATEST(i.updated_at, cm.at)';
/** SQL condition: open and no activity for `days` (an SQL expression) days. */
export const stuckWhen = (days) => `(i.status <> 'closed' AND ${LAST_ACTIVITY} < now() - make_interval(days => ${days}))`;

// Summaries only — never the snapshot or the full diagnosis (GET /:id has
// those). last_activity_at is the later of updated_at and the newest staff
// comment, so a comment resets the stuck timer without moving updated_at
// (which orders the list and floats re-flagged cards up).
export const LIST_SQL = `
  SELECT i.id, i.kind, i.status, i.owner, i.company_id, i.grant_root_id, i.pattern_category,
         i.chat_turn_ref, i.conversation_id, i.flag_count, i.flagged_again, i.expected_match,
         i.created_at, i.updated_at, i.closed_at,
         i.diagnosis->>'verdict' AS verdict,
         left(i.narrative, 240) AS narrative,
         g.grant_name,
         lc.comment AS latest_comment, lc.created_at AS latest_comment_at,
         ${LAST_ACTIVITY} AS last_activity_at,
         ${stuckWhen(STUCK_DAYS)} AS stuck,
         floor(EXTRACT(EPOCH FROM (now() - ${LAST_ACTIVITY})) / 86400)::int AS idle_days
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
    LEFT JOIN LATERAL (
      SELECT f.comment, f.created_at
        FROM cc_review_flags f
       WHERE f.item_id = i.id AND f.comment IS NOT NULL
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT 1
    ) lc ON TRUE${LAST_ACTIVITY_JOIN}
   WHERE ($1::text IS NULL OR i.status = $1)
     AND ($2::text IS NULL OR i.owner = $2)
     AND ($3::text IS NULL OR i.kind = $3)
   ORDER BY i.updated_at DESC, i.id DESC
   LIMIT $4`;

export const COMMENT_MAX = 4000;
export const LINK_NAMES_SQL = 'SELECT id, grant_name FROM gg3_grants WHERE id = ANY($1::int[])';
export const ITEM_CONVERSATION_SQL = 'SELECT kind, conversation_id, chat_turn_ref FROM cc_review_items WHERE id = $1';

export const GET_ITEM_SQL = 'SELECT * FROM cc_review_items WHERE id = $1';
export const GET_FLAGS_SQL = 'SELECT * FROM cc_review_flags WHERE item_id = $1 ORDER BY created_at, id';
export const GET_EVENTS_SQL = 'SELECT * FROM cc_review_events WHERE item_id = $1 ORDER BY created_at, id';
export const NEW_ITEM_IDS_SQL = "SELECT id FROM cc_review_items WHERE status = 'new' ORDER BY id";
export const NEW_ITEMS_SQL = "SELECT * FROM cc_review_items WHERE status = 'new' ORDER BY id";

export const STAFF_NAMES_SQL = 'SELECT lower(email) AS email, name FROM users WHERE lower(email) = ANY($1::text[])';

// Sweep
export const SWEEP_CURSOR_SQL = `
  SELECT max(source_created_at) AS latest
    FROM cc_review_flags
   WHERE source = 'client_thumbs_down'`;

export const KNOWN_REFS_SQL = 'SELECT source_ref FROM cc_review_flags WHERE source_ref = ANY($1::text[])';

export const EXISTING_MATCH_ITEMS_SQL = `
  SELECT company_id, grant_root_id, status
    FROM cc_review_items
   WHERE kind = 'match'
     AND (company_id, grant_root_id) IN (SELECT * FROM unnest($1::int[], $2::int[]))`;

// App DB, read-only. A 👎 is rating = 'down' (CHECK allows only up/down).
// grant_root_id is a root, never a version. Real Clerk users only — the same
// user_… rule the roll-up applies to ops rows — resolved through users_clerk,
// since the rating row holds the app's integer user_id.
export const DOWNS_SQL = `
  SELECT e.id::text AS id, e.company_id, e.grant_root_id, e.created_at, uc.clerk_id
    FROM grant_recommendation_feedback_events e
    JOIN users_clerk uc ON uc.user_id = e.user_id AND uc.deleted_at IS NULL
   WHERE e.rating = 'down'
     AND uc.clerk_id LIKE 'user\\_%'
     AND ($1::timestamptz IS NULL OR e.created_at > $1)
   ORDER BY e.created_at, e.id`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function logEvent(client, itemId, actor, action, from, to, detail = null) {
  return client.query(INSERT_EVENT_SQL, [itemId, actor ?? null, action, from ?? null, to ?? null,
    detail === null ? null : JSON.stringify(detail)]);
}

async function lockItem(client, id) {
  const { rows } = await client.query(LOCK_ITEM_SQL, [id]);
  if (!rows[0]) throw new ReviewQueueError(404, 'review item not found');
  return rows[0];
}

/**
 * File a flag. Creates the item if it's the first flag for that match pair
 * or chat turn. A duplicate source_ref changes nothing. A new flag on a
 * closed item reopens it.
 *
 * @returns {Promise<{item: object, duplicate: boolean, created: boolean, reopened: boolean, flag_id: number|null}>}
 */
export async function addFlag(input, { hubTransaction = transaction } = {}) {
  const f = validateFlag(input);

  return hubTransaction(async (client) => {
    const ins = await client.query(INSERT_ITEM_SQL,
      [f.kind, f.company_id, f.grant_root_id, f.chat_turn_ref, f.pattern_category, f.conversation_id]);
    const created = ins.rows.length > 0;

    const locked = f.kind === 'match'
      ? await client.query(LOCK_MATCH_SQL, [f.company_id, f.grant_root_id])
      : f.kind === 'grant_pattern'
        ? await client.query(LOCK_PATTERN_SQL, [f.grant_root_id, f.pattern_category])
        : await client.query(LOCK_CHAT_SQL, [f.chat_turn_ref]);
    let item = locked.rows[0];
    if (created) await logEvent(client, item.id, f.actor, 'created', null, 'new', { source: f.source });

    const flag = await client.query(INSERT_FLAG_SQL,
      [item.id, f.source, f.source_ref, f.source_created_at, f.actor, f.comment]);
    if (flag.rows.length === 0) {
      return { item, duplicate: true, created: false, reopened: false, flag_id: null };
    }
    const flagId = flag.rows[0].id;

    const late = item.status === 'closed' && !reopensClosed(item, f);
    const reopened = item.status === 'closed' && !late;
    const from = item.status;
    item = (await client.query(reopened ? REOPEN_SQL : BUMP_SQL, [item.id])).rows[0];
    await logEvent(client, item.id, f.actor, 'flagged', null, null,
      { source: f.source, flag_id: flagId, ...(late ? { late_evidence: true } : {}) });
    if (reopened) await logEvent(client, item.id, f.actor, 'reopened', from, 'new', { flag_id: flagId });
    if (f.snapshot && !item.snapshot) {
      item = (await client.query(SET_SNAPSHOT_SQL, [item.id, JSON.stringify(f.snapshot)])).rows[0] ?? item;
    }

    return { item, duplicate: false, created, reopened, flag_id: flagId, ...(late ? { late: true } : {}) };
  }, 'cc review addFlag');
}

/**
 * Whether a new flag reopens a closed item. Always, except a grant_pattern
 * card: only a cut that happened after the card was closed reopens it. An
 * older cut that arrives late (or one with no time) is kept as evidence.
 */
export function reopensClosed(item, flag) {
  if (item.kind !== 'grant_pattern') return true;
  if (!flag.source_created_at || !item.closed_at) return false;
  return new Date(flag.source_created_at).getTime() > new Date(item.closed_at).getTime();
}

/**
 * Move an item to another open status. 'closed' is refused — use close(),
 * which records expected_match. Moving a closed item reopens it by hand.
 */
export async function moveStatus(id, to, actor, { hubTransaction = transaction } = {}) {
  const itemId = requiredId(id, 'id');
  if (to === 'closed') throw bad('use close to close an item');
  if (!STATUSES.includes(to)) throw bad(`status must be one of ${STATUSES.filter((s) => s !== 'closed').join(', ')}`);

  return hubTransaction(async (client) => {
    const item = await lockItem(client, itemId);
    if (item.status === to) return item;
    const updated = (await client.query(SET_STATUS_SQL, [itemId, to])).rows[0];
    await logEvent(client, itemId, actor, 'status', item.status, to);
    return updated;
  }, 'cc review moveStatus');
}

/** Manual owner override. null clears it. */
export async function setOwner(id, owner, actor, { hubTransaction = transaction } = {}) {
  const itemId = requiredId(id, 'id');
  if (owner !== null && !OWNERS.includes(owner)) throw bad(`owner must be one of ${OWNERS.join(', ')}, or null`);

  return hubTransaction(async (client) => {
    const item = await lockItem(client, itemId);
    if (item.owner === owner) return item;
    const updated = (await client.query(SET_OWNER_SQL, [itemId, owner])).rows[0];
    await logEvent(client, itemId, actor, 'owner', item.status, item.status, { from: item.owner, to: owner });
    return updated;
  }, 'cc review setOwner');
}

/**
 * A staff comment: one 'comment' event with the author and the text. Status,
 * owner and updated_at are untouched; the board's stuck timer counts it as
 * activity (LIST_SQL last_activity_at).
 */
export async function addComment(id, text, actor, { hubTransaction = transaction } = {}) {
  const itemId = requiredId(id, 'id');
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw bad('text is required');
  if (body.length > COMMENT_MAX) throw bad(`text is longer than ${COMMENT_MAX} characters`);
  if (!actor) throw bad('a signed-in author is required');
  return hubTransaction(async (client) => {
    const item = await lockItem(client, itemId);
    await logEvent(client, itemId, actor, 'comment', item.status, item.status, { text: body });
    return { item_id: itemId, actor, text: body, status: item.status };
  }, 'cc review addComment');
}

/**
 * Close an item. expected_match ('should' | 'shouldnt') is required for a
 * match item and optional for a chat item.
 */
export async function close(id, { expected_match, close_note } = {}, actor, { hubTransaction = transaction } = {}) {
  const itemId = requiredId(id, 'id');
  if (expected_match != null && !EXPECTED.includes(expected_match)) {
    throw bad(`expected_match must be one of ${EXPECTED.join(', ')}`);
  }
  const note = optionalText(close_note, 'close_note');

  return hubTransaction(async (client) => {
    const item = await lockItem(client, itemId);
    if (item.status === 'closed') throw new ReviewQueueError(409, 'item is already closed');
    if (item.kind === 'match' && expected_match == null) {
      throw bad('expected_match is required to close a match item');
    }
    const updated = (await client.query(CLOSE_SQL, [itemId, expected_match ?? null, note, actor ?? null])).rows[0];
    await logEvent(client, itemId, actor, 'closed', item.status, 'closed',
      { expected_match: expected_match ?? null, close_note: note });
    if (item.kind === 'grant_pattern') {
      // Each linked match card gets a nudge; none is moved or closed.
      const linked = (await client.query(LINKED_ITEMS_SQL, [itemId])).rows;
      for (const l of linked) {
        await logEvent(client, l.id, actor, 'recheck', l.status, l.status,
          { pattern_id: itemId, message: `re-check — pattern #${itemId} was fixed` });
      }
    }
    return updated;
  }, 'cc review close');
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

/**
 * Work out why an item went wrong and who should fix it: snapshot, owner
 * routing and Sonnet narrative (diagnosis.js). Never writes.
 *
 * @returns {Promise<null | {ok: true, owner, verdict, diagnosis, narrative, client_notice, snapshot, snapshotAt, snapshotTaken, cost}
 *                         | {ok: false, error, snapshot?, snapshotAt?, snapshotTaken, cost}>}
 *          null when something is not configured: the item stays 'new', no attempt counted.
 */
export async function diagnose(item, ctx = {}) {
  return diagnoseItem(item, ctx);
}

/** Older diagnoseFn results ({owner, diagnosis, narrative, client_notice}) count as a success. */
function asOutcome(result) {
  return 'ok' in result ? result : { ok: true, ...result };
}

const flagComments = async (hubQuery, itemId) =>
  (await hubQuery(GET_FLAGS_SQL, [itemId])).rows.map((f) => f.comment).filter(Boolean).slice(-5);

/**
 * Diagnose one 'new' item and record the result. diagnose() runs outside the
 * transaction (it is slow); the result only lands if the item is still 'new'
 * when it comes back.
 *
 *   success          → 'diagnosed'; owner, diagnosis, narrative, client_notice set;
 *                      snapshot stored if this attempt took it
 *   failure, < 3rd   → stays 'new'; diagnosis_attempts + 1, last_error set;
 *                      snapshot stored if taken, so retries reuse it
 *   failure, 3rd     → 'diagnosed', owner chris, verdict could_not_diagnose
 *   null             → nothing changes (not configured)
 *
 * @returns {Promise<{item: object|null, diagnosed: boolean, failed?: boolean, error?: string}>}
 */
export async function runDiagnosis(id, { hubQuery = query, hubTransaction = transaction, diagnoseFn = diagnose, actor = SWEEP_ACTOR, diagnoseCtx = {} } = {}) {
  const itemId = requiredId(id, 'id');
  const { rows } = await hubQuery(GET_ITEM_SQL, [itemId]);
  const item = rows[0];
  if (!item || item.status !== 'new') return { item: item ?? null, diagnosed: false };

  const result = await diagnoseFn(item, { comments: await flagComments(hubQuery, itemId), ...diagnoseCtx });
  if (!result) return { item, diagnosed: false };
  const outcome = asOutcome(result);
  const snapshot = outcome.snapshotTaken && outcome.snapshot ? JSON.stringify(outcome.snapshot) : null;
  const snapshotAt = snapshot ? outcome.snapshotAt ?? new Date().toISOString() : null;

  return hubTransaction(async (client) => {
    const current = await lockItem(client, itemId);
    if (current.status !== 'new') return { item: current, diagnosed: false };

    if (outcome.ok) {
      const owner = OWNERS.includes(outcome.owner) ? outcome.owner : DEFAULT_OWNER;
      const updated = (await client.query(DIAGNOSE_SQL, [itemId, owner,
        outcome.diagnosis == null ? null : JSON.stringify(outcome.diagnosis),
        outcome.narrative ?? null, outcome.client_notice ?? null,
        snapshot, snapshotAt, current.diagnosis_attempts ?? 0, null])).rows[0];
      await logEvent(client, itemId, actor, 'diagnosed', 'new', 'diagnosed',
        { owner, verdict: outcome.verdict ?? outcome.diagnosis?.verdict ?? null });
      return { item: updated, diagnosed: true };
    }

    const attempts = (current.diagnosis_attempts ?? 0) + 1;
    const error = String(outcome.error ?? 'unknown').slice(0, MAX_REF);
    if (attempts >= MAX_DIAGNOSIS_ATTEMPTS) {
      const give = couldNotDiagnose(error, attempts);
      const updated = (await client.query(DIAGNOSE_SQL, [itemId, give.owner, JSON.stringify(give.diagnosis),
        give.narrative, null, snapshot, snapshotAt, attempts, error])).rows[0];
      await logEvent(client, itemId, actor, 'diagnosed', 'new', 'diagnosed',
        { owner: give.owner, verdict: give.verdict, attempts, error });
      return { item: updated, diagnosed: true, failed: true, error };
    }
    const updated = (await client.query(RECORD_FAILURE_SQL, [itemId, attempts, error, snapshot, snapshotAt])).rows[0];
    await logEvent(client, itemId, actor, 'diagnosis_failed', 'new', 'new', { attempt: attempts, error });
    return { item: updated, diagnosed: false, failed: true, error };
  }, 'cc review diagnose');
}

/**
 * Dry-run diagnosis: what each item WOULD get, without writing anything — no
 * Hub write and no api_cost_events row (cost is computed, not logged). Covers
 * every 'new' item plus the pairs the sweep would file (no item yet) or reopen.
 *
 * @param {Array<{company_id: number, grant_root_id: number, reopen?: boolean}>} [wouldFile]
 * @returns {Promise<{rows: Array, cost: number}>}
 */
export async function previewDiagnoses(wouldFile = [], { hubQuery = query, diagnoseFn = diagnose, diagnoseCtx = {} } = {}) {
  const items = (await hubQuery(NEW_ITEMS_SQL)).rows;
  const targets = [
    ...items.map((item) => ({ label: 'new', item })),
    ...wouldFile.map((p) => ({
      label: p.reopen ? 'would reopen' : 'would file',
      item: p.kind === 'grant_pattern'
        ? { id: null, kind: 'grant_pattern', company_id: null, grant_root_id: p.grant_root_id, pattern_category: p.pattern_category,
          status: 'new', snapshot: null, snapshot_at: null, diagnosis_attempts: 0 }
        : { id: null, kind: 'match', company_id: p.company_id, grant_root_id: p.grant_root_id,
          status: 'new', snapshot: null, snapshot_at: null, diagnosis_attempts: 0 },
      cutIds: p.cut_ids ?? null
    }))
  ];

  const rows = [];
  let cost = 0;
  for (const { label, item, cutIds = null } of targets) {
    const comments = item.id && item.kind !== 'grant_pattern' ? await flagComments(hubQuery, item.id) : [];
    let r;
    try {
      r = await diagnoseFn(item, { comments, ...diagnoseCtx, ...(cutIds ? { cutIds } : {}), logCost: null });
    } catch (err) {
      r = { ok: false, error: `threw_${err?.code ?? err?.name ?? 'error'}`, snapshotTaken: false, cost: 0 };
    }
    cost += r?.cost ?? 0;
    const base = { label, id: item.id, kind: item.kind, company_id: item.company_id,
      grant_root_id: item.grant_root_id ?? null, chat_turn_ref: item.chat_turn_ref ?? null,
      pattern_category: item.pattern_category ?? null, snapshot_reused: Boolean(item.snapshot) };
    if (!r) { rows.push({ ...base, skipped: 'not_configured' }); continue; }
    const outcome = asOutcome(r);
    if (outcome.ok) {
      rows.push({ ...base, owner: outcome.owner, verdict: outcome.verdict ?? outcome.diagnosis?.verdict ?? null,
        candidate_cause: outcome.diagnosis?.candidate_cause ?? null, narrative: outcome.narrative,
        client_notice: outcome.client_notice ?? null, override: outcome.diagnosis?.owner_override ?? null,
        corrected: Boolean(outcome.diagnosis?.narrative_corrected),
        grant: outcome.snapshot?.response?.grant_name ?? outcome.snapshot?.grant?.name ?? null,
        ...(item.kind === 'grant_pattern' ? { companies: (outcome.snapshot?.cuts ?? []).map((c) => ({
          company_id: c.company_id, company_name: c.company_name, internal: c.company_internal, reason: c.reason })) } : {}),
        ...(outcome.diagnosis?.chat ? { chat: outcome.diagnosis.chat } : {}),
        cost: r.cost ?? 0 });
    } else {
      const attempt = (item.diagnosis_attempts ?? 0) + 1;
      rows.push({ ...base, error: outcome.error, attempt,
        would: attempt >= MAX_DIAGNOSIS_ATTEMPTS ? couldNotDiagnose(outcome.error, attempt) : 'stay new, retry next sweep',
        cost: r.cost ?? 0 });
    }
  }
  return { rows, cost };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const LIST_LIMIT = 500;

/** Most recently updated first, with flag_count and the latest flag comment. */
export async function listItems({ status, owner, kind } = {}, { hubQuery = query } = {}) {
  if (status != null && !STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join(', ')}`);
  if (owner != null && !OWNERS.includes(owner)) throw bad(`owner must be one of ${OWNERS.join(', ')}`);
  if (kind != null && !KINDS.includes(kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
  const { rows } = await hubQuery(LIST_SQL, [status ?? null, owner ?? null, kind ?? null, LIST_LIMIT]);
  return rows;
}

/** @returns {Promise<{item: object, flags: Array, events: Array, links: Array}>} 404 if unknown. */
export async function getItem(id, { hubQuery = query } = {}) {
  const itemId = requiredId(id, 'id');
  const { rows } = await hubQuery(GET_ITEM_SQL, [itemId]);
  if (!rows[0]) throw new ReviewQueueError(404, 'review item not found');
  const [flags, events, links] = await Promise.all([
    hubQuery(GET_FLAGS_SQL, [itemId]),
    hubQuery(GET_EVENTS_SQL, [itemId]),
    hubQuery(LINKED_ITEMS_SQL, [itemId])
  ]);
  return { item: rows[0], flags: flags.rows, events: events.rows, links: links.rows };
}

/** Staff email → name from the Hub users table. Keys are lower-cased emails. */
export async function staffNames(emails, { hubQuery = query } = {}) {
  const list = [...new Set((emails || []).filter((e) => typeof e === 'string' && e.includes('@')).map((e) => e.toLowerCase()))];
  if (!list.length) return new Map();
  const { rows } = await hubQuery(STAFF_NAMES_SQL, [list]);
  return new Map(rows.map((r) => [r.email, r.name]));
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/**
 * Pull client 👎s newer than the latest one already filed (less a 1 h
 * overlap), file each as a flag, then diagnose every 'new' item.
 *
 * Dry run unless write is true: it reads the Hub only for the cursor and the
 * already-filed refs, and reports what it would file.
 */
export async function runReviewSweep({ write = false, preview = false, deps = {}, log = console.log } = {}) {
  const hubQuery = deps.hubQuery ?? query;
  const app = deps.appQuery ?? appQuery;
  const flag = deps.addFlag ?? addFlag;
  const diagnoseOne = deps.runDiagnosis ?? runDiagnosis;

  const latest = (await hubQuery(SWEEP_CURSOR_SQL)).rows[0]?.latest ?? null;
  const since = latest ? new Date(new Date(latest).getTime() - SWEEP_OVERLAP_MS) : null;

  const byId = new Map();
  for (const r of (await app(DOWNS_SQL, [since])).rows) if (!byId.has(r.id)) byId.set(r.id, r);
  const downs = [...byId.values()];

  const known = downs.length
    ? new Set((await hubQuery(KNOWN_REFS_SQL, [downs.map((d) => d.id)])).rows.map((r) => r.source_ref))
    : new Set();
  const fresh = downs.filter((d) => !known.has(d.id));

  const pairKey = (c, g) => `${c}:${g}`;
  const pairs = new Map();
  for (const d of fresh) pairs.set(pairKey(d.company_id, d.grant_root_id), d);

  const summary = {
    since: since ? since.toISOString() : null,
    downs_read: downs.length, already_filed: known.size, to_file: fresh.length,
    items: pairs.size, new_items: 0, reopened: 0,
    filed: 0, failed: 0, diagnosed: 0, left_new: 0, written: write
  };

  // Grant patterns from the AI review's cuts (grant-patterns.js). Its own
  // failure (e.g. ops DB not configured) never stops the 👎 path.
  const patternSweep = deps.runPatternSweep ?? runPatternSweep;
  try {
    summary.patterns = await patternSweep({ write, deps: { hubQuery, addFlag: flag, ...(deps.patternDeps ?? {}) }, log });
  } catch (err) {
    summary.patterns = { error: String(err?.code ?? err?.name ?? 'unknown') };
    console.error(`❌ CC pattern sweep failed — code: ${summary.patterns.error}`);
  }

  if (!write) {
    let existing = [];
    if (pairs.size) {
      const vals = [...pairs.values()];
      existing = (await hubQuery(EXISTING_MATCH_ITEMS_SQL,
        [vals.map((d) => d.company_id), vals.map((d) => d.grant_root_id)])).rows;
      summary.new_items = pairs.size - existing.length;
      summary.reopened = existing.filter((r) => r.status === 'closed').length;
    }
    if (preview) {
      // Existing 'new' items are previewed from the Hub; here only pairs with no
      // item yet, or whose closed item this sweep would reopen.
      const status = new Map(existing.map((r) => [pairKey(r.company_id, r.grant_root_id), r.status]));
      const wouldFile = [...pairs.values()]
        .filter((d) => [undefined, 'closed'].includes(status.get(pairKey(d.company_id, d.grant_root_id))))
        .map((d) => ({ company_id: d.company_id, grant_root_id: d.grant_root_id,
          reopen: status.get(pairKey(d.company_id, d.grant_root_id)) === 'closed' }));
      // Pattern cards this run would create or reopen, previewed from their cuts.
      for (const p of summary.patterns?.qualifying ?? []) {
        if (p.action === 'file' || p.action === 'reopen') {
          wouldFile.push({ kind: 'grant_pattern', grant_root_id: p.grant_id, pattern_category: p.category,
            cut_ids: p.group.cuts.map((c) => c.id), reopen: p.action === 'reopen' });
        }
      }
      summary.preview = await (deps.previewDiagnoses ?? previewDiagnoses)(wouldFile, { hubQuery });
    }
    log(`CC review sweep (dry run): ${summary.to_file} 👎 to file → ${summary.items} items `
      + `(${summary.new_items} new, ${summary.reopened} reopened); ${summary.already_filed} already filed`);
    return summary;
  }

  for (const d of fresh) {
    try {
      const r = await flag({ kind: 'match', company_id: d.company_id, grant_root_id: d.grant_root_id,
        source: 'client_thumbs_down', source_ref: d.id, source_created_at: d.created_at, actor: d.clerk_id });
      if (r.duplicate) continue;
      summary.filed += 1;
      if (r.created) summary.new_items += 1;
      if (r.reopened) summary.reopened += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`❌ CC review sweep: a flag failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  }

  for (const { id } of (await hubQuery(NEW_ITEM_IDS_SQL)).rows) {
    try {
      const r = await diagnoseOne(id);
      if (r.diagnosed) summary.diagnosed += 1; else summary.left_new += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`❌ CC review sweep: a diagnosis failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  }

  log(`CC review sweep: filed ${summary.filed} 👎 (${summary.new_items} new items, ${summary.reopened} reopened), `
    + `diagnosed ${summary.diagnosed}, ${summary.left_new} still new, ${summary.failed} failed`);
  return summary;
}

/** @param {Object} cron - node-cron */
export function startControlCentreReviewSweep(cron) {
  if (process.env.CC_REVIEW_SWEEP_ENABLED !== 'true') {
    console.log('⏸️  Control Centre review sweep off (set CC_REVIEW_SWEEP_ENABLED=true to enable)');
    return false;
  }
  if (!isAppDbConfigured()) {
    console.warn('⚠️  Control Centre review sweep NOT scheduled — APP_DB_READONLY_URL not set.');
    return false;
  }
  const run = async () => {
    try {
      await runReviewSweep({ write: true });
    } catch (err) {
      console.error(`❌ CC review sweep run failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  };
  cron.schedule('17 * * * *', run, { name: 'cc-review-sweep', timezone: TIME_ZONE, noOverlap: true });
  console.log('⏰ Cron job scheduled: Control Centre review sweep hourly at :17');
  return true;
}
