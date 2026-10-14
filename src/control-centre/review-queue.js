/**
 * Control Centre review queue (migration 044)
 *
 * One item per thing that needs a look: a bad match (company + grant root)
 * or a bad chat answer (one chat turn). Flags pile onto the item:
 *
 *   client_thumbs_down  a 👎 from the app DB's grant_recommendation_feedback_events,
 *                       pulled hourly by runReviewSweep (source_ref = rating id)
 *   staff_flag          POST /api/control-centre/review/flag (source_ref = staff:<uuid>)
 *
 * source_ref is UNIQUE, so a re-sweep never double-counts. A new flag on a
 * closed item reopens it to 'new' with flagged_again and clears the old
 * owner and diagnosis.
 *
 * Status: new → diagnosed → in_progress → closed. Only close() reaches
 * 'closed', and a match item can't close without expected_match.
 *
 * Every mutation writes one cc_review_events row in the same transaction.
 *
 * Writes only the Hub DB. The app DB is read through db.js (read-only).
 * Logs carry counts and error codes only — never ids, names or comments.
 *
 * Hourly sweep: only when CC_REVIEW_SWEEP_ENABLED=true. CLI:
 * scripts/cc-review-sweep.mjs. Routes: review-routes.js. Docs: docs/control-centre.md.
 */

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../database/connection.js';
import { appQuery, isAppDbConfigured } from './db.js';
import { TIME_ZONE } from './rollup.js';

export const KINDS = Object.freeze(['match', 'chat']);
export const STATUSES = Object.freeze(['new', 'diagnosed', 'in_progress', 'closed']);
export const OWNERS = Object.freeze(['client', 'research', 'chris', 'jason']);
export const SOURCES = Object.freeze(['client_thumbs_down', 'staff_flag']);
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

  const out = { kind, source, company_id: null, grant_root_id: null, chat_turn_ref: null };
  if (kind === 'match') {
    out.company_id = requiredId(input.company_id, 'company_id');
    out.grant_root_id = requiredId(input.grant_root_id, 'grant_root_id');
    if (input.chat_turn_ref != null) throw bad('chat_turn_ref is only for chat items');
  } else {
    out.chat_turn_ref = optionalText(input.chat_turn_ref, 'chat_turn_ref', MAX_REF);
    if (!out.chat_turn_ref) throw bad('chat_turn_ref is required for chat items');
    if (input.grant_root_id != null) throw bad('grant_root_id is only for match items');
    if (input.company_id != null) out.company_id = requiredId(input.company_id, 'company_id');
  }

  out.source_ref = optionalText(input.source_ref, 'source_ref', MAX_REF);
  if (!out.source_ref) {
    if (source !== 'staff_flag') throw bad('source_ref is required for client flags');
    out.source_ref = `staff:${randomUUID()}`;
  }
  out.actor = optionalText(input.actor, 'actor', MAX_REF);
  out.comment = optionalText(input.comment, 'comment');
  out.source_created_at = input.source_created_at ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// SQL (Hub DB)
// ---------------------------------------------------------------------------

// No conflict target: covers both partial unique keys (match pair, chat turn).
export const INSERT_ITEM_SQL = `
  INSERT INTO cc_review_items (kind, company_id, grant_root_id, chat_turn_ref)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT DO NOTHING
  RETURNING id`;

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
         updated_at = NOW()
   WHERE id = $1
  RETURNING *`;

export const DIAGNOSE_SQL = `
  UPDATE cc_review_items
     SET owner = $2, diagnosis = $3, narrative = $4, client_notice = $5,
         status = 'diagnosed', updated_at = NOW()
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

export const LIST_SQL = `
  SELECT i.*, lc.comment AS latest_comment, lc.created_at AS latest_comment_at
    FROM cc_review_items i
    LEFT JOIN LATERAL (
      SELECT f.comment, f.created_at
        FROM cc_review_flags f
       WHERE f.item_id = i.id AND f.comment IS NOT NULL
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT 1
    ) lc ON TRUE
   WHERE ($1::text IS NULL OR i.status = $1)
     AND ($2::text IS NULL OR i.owner = $2)
     AND ($3::text IS NULL OR i.kind = $3)
   ORDER BY i.updated_at DESC, i.id DESC
   LIMIT $4`;

export const GET_ITEM_SQL = 'SELECT * FROM cc_review_items WHERE id = $1';
export const GET_FLAGS_SQL = 'SELECT * FROM cc_review_flags WHERE item_id = $1 ORDER BY created_at, id';
export const GET_EVENTS_SQL = 'SELECT * FROM cc_review_events WHERE item_id = $1 ORDER BY created_at, id';
export const NEW_ITEM_IDS_SQL = "SELECT id FROM cc_review_items WHERE status = 'new' ORDER BY id";

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
    const ins = await client.query(INSERT_ITEM_SQL, [f.kind, f.company_id, f.grant_root_id, f.chat_turn_ref]);
    const created = ins.rows.length > 0;

    const locked = f.kind === 'match'
      ? await client.query(LOCK_MATCH_SQL, [f.company_id, f.grant_root_id])
      : await client.query(LOCK_CHAT_SQL, [f.chat_turn_ref]);
    let item = locked.rows[0];
    if (created) await logEvent(client, item.id, f.actor, 'created', null, 'new', { source: f.source });

    const flag = await client.query(INSERT_FLAG_SQL,
      [item.id, f.source, f.source_ref, f.source_created_at, f.actor, f.comment]);
    if (flag.rows.length === 0) {
      return { item, duplicate: true, created: false, reopened: false, flag_id: null };
    }
    const flagId = flag.rows[0].id;

    const reopened = item.status === 'closed';
    const from = item.status;
    item = (await client.query(reopened ? REOPEN_SQL : BUMP_SQL, [item.id])).rows[0];
    await logEvent(client, item.id, f.actor, 'flagged', null, null, { source: f.source, flag_id: flagId });
    if (reopened) await logEvent(client, item.id, f.actor, 'reopened', from, 'new', { flag_id: flagId });

    return { item, duplicate: false, created, reopened, flag_id: flagId };
  }, 'cc review addFlag');
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
    return updated;
  }, 'cc review close');
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

/**
 * Work out why an item went wrong and who should fix it.
 *
 * TODO(step 5): fill this in. For a match item, run match-explain's bad-match
 * mode for (company_id, grant_root_id); for a chat item, read the turn. Then
 * have Oracle write the narrative and the client-facing notice, and pick an
 * owner from OWNER_ROUTING (DEFAULT_OWNER when the cause is unclear).
 *
 * @returns {Promise<null | {owner: string, diagnosis: object, narrative: string, client_notice: string}>}
 *          null leaves the item in 'new' for the next sweep.
 */
export async function diagnose(item) {
  return null;
}

/**
 * Diagnose one 'new' item and record the result. diagnose() runs outside the
 * transaction (step 5 will make it slow); the result only lands if the item
 * is still 'new' when it comes back.
 *
 * @returns {Promise<{item: object|null, diagnosed: boolean}>}
 */
export async function runDiagnosis(id, { hubQuery = query, hubTransaction = transaction, diagnoseFn = diagnose, actor = SWEEP_ACTOR } = {}) {
  const itemId = requiredId(id, 'id');
  const { rows } = await hubQuery(GET_ITEM_SQL, [itemId]);
  const item = rows[0];
  if (!item || item.status !== 'new') return { item: item ?? null, diagnosed: false };

  const result = await diagnoseFn(item);
  if (!result) return { item, diagnosed: false };

  const owner = OWNERS.includes(result.owner) ? result.owner : DEFAULT_OWNER;
  return hubTransaction(async (client) => {
    const current = await lockItem(client, itemId);
    if (current.status !== 'new') return { item: current, diagnosed: false };
    const updated = (await client.query(DIAGNOSE_SQL, [itemId, owner,
      result.diagnosis == null ? null : JSON.stringify(result.diagnosis),
      result.narrative ?? null, result.client_notice ?? null])).rows[0];
    await logEvent(client, itemId, actor, 'diagnosed', 'new', 'diagnosed', { owner });
    return { item: updated, diagnosed: true };
  }, 'cc review diagnose');
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

/** @returns {Promise<{item: object, flags: Array, events: Array}>} 404 if unknown. */
export async function getItem(id, { hubQuery = query } = {}) {
  const itemId = requiredId(id, 'id');
  const { rows } = await hubQuery(GET_ITEM_SQL, [itemId]);
  if (!rows[0]) throw new ReviewQueueError(404, 'review item not found');
  const [flags, events] = await Promise.all([
    hubQuery(GET_FLAGS_SQL, [itemId]),
    hubQuery(GET_EVENTS_SQL, [itemId])
  ]);
  return { item: rows[0], flags: flags.rows, events: events.rows };
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
export async function runReviewSweep({ write = false, deps = {}, log = console.log } = {}) {
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

  if (!write) {
    if (pairs.size) {
      const vals = [...pairs.values()];
      const existing = (await hubQuery(EXISTING_MATCH_ITEMS_SQL,
        [vals.map((d) => d.company_id), vals.map((d) => d.grant_root_id)])).rows;
      summary.new_items = pairs.size - existing.length;
      summary.reopened = existing.filter((r) => r.status === 'closed').length;
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
