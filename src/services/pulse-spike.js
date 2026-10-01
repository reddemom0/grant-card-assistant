/**
 * GetGranted Pulse: chat spike alert
 *
 *   every 5 min (UTC)   count GetGranted chat turns that failed for the client
 *                       in the last 15 minutes; at 2 or more, DM each
 *                       subscriber once, then stay quiet for 60 minutes
 *
 * "Failed" (chat_turns in the gg3-ai-service ops DB, read via gg3-ops-db.js):
 *   chat broke          outcome 'error' or 'max_rounds' — includes timeouts
 *                       and connection errors (error_category connection_error,
 *                       overloaded_error, http_NNN, …)
 *   empty / refusal     outcome 'no_answer' (error_category 'empty'/'refusal')
 * Rejected requests that never reached the model are left out: error_category
 * missing_message, bad_conversation_id, missing_grant_id (every bad_request
 * path in gg3-ai-service's chat.ts sets one of these) and conversation_not_found.
 * Internal users are counted — a failure is a failure.
 *
 * The alert carries counts and types only: no client names, ids or message text.
 *
 * Cooldown lives in Oracle's own DB (pulse_alert_state, migration 040) so a
 * redeploy doesn't reset it. It is claimed atomically BEFORE sending; if no
 * subscriber could be reached the claim is put back. Without the table the
 * check logs once and skips — it never alerts without a cooldown.
 *
 * Needs GG3_OPS_DB_READONLY_URL and PULSE_SPIKE_SUBSCRIBERS; with either unset
 * it is never scheduled. Dry run: scripts/pulse-spike-check.mjs.
 */

import { gg3OpsQuery, isGg3OpsConfigured } from './gg3-ops-db.js';

export const ALERT_KEY = 'chat_spike';
export const SUBSCRIBERS_ENV = 'PULSE_SPIKE_SUBSCRIBERS';
export const WINDOW_MINUTES = 15;
export const THRESHOLD = 2;
export const COOLDOWN_MINUTES = 60;
export const BROKE_OUTCOMES = ['error', 'max_rounds'];
export const FAILED_OUTCOMES = ['error', 'max_rounds', 'no_answer'];
export const EXCLUDED_CATEGORIES = [
  'missing_message',
  'bad_conversation_id',
  'missing_grant_id',
  'conversation_not_found'
];

const COUNT_SQL = `
  SELECT count(*) FILTER (WHERE outcome = ANY($2::text[]))::int AS broke,
         count(*) FILTER (WHERE outcome = 'no_answer')::int     AS empty_or_refusal,
         count(DISTINCT user_id)::int                           AS users
    FROM chat_turns
   WHERE occurred_at > now() - make_interval(mins => $1::int)
     AND outcome = ANY($3::text[])
     AND (error_category IS NULL OR NOT (error_category = ANY($4::text[])))`;

/**
 * Failed chat turns in the last `minutes`. Counts only.
 * @returns {Promise<null | {broke: number, emptyOrRefusal: number, total: number, users: number}>}
 *   null when the ops DB isn't configured
 */
export async function countChatFailures(minutes = WINDOW_MINUTES, runQuery = gg3OpsQuery) {
  const res = await runQuery(COUNT_SQL, [minutes, BROKE_OUTCOMES, FAILED_OUTCOMES, EXCLUDED_CATEGORIES]);
  if (!res.configured) return null;
  const row = res.rows[0] || {};
  const broke = Number(row.broke) || 0;
  const emptyOrRefusal = Number(row.empty_or_refusal) || 0;
  return { broke, emptyOrRefusal, total: broke + emptyOrRefusal, users: Number(row.users) || 0 };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The alert text. Counts and types only. */
export function formatSpikeAlert(counts, minutes = WINDOW_MINUTES) {
  const parts = [];
  if (counts.broke) parts.push(`${counts.broke} chat broke`);
  if (counts.emptyOrRefusal) parts.push(`${counts.emptyOrRefusal} empty reply/refusal`);
  const span = minutes % 1440 === 0 && minutes > 1440 ? plural(minutes / 1440, 'day')
    : minutes % 60 === 0 && minutes > 60 ? plural(minutes / 60, 'hour')
    : plural(minutes, 'minute');
  return `⚠️ GetGranted chat: ${plural(counts.total, 'failure')} in the last ${span} — ` +
    `${parts.join(', ')} — across ${plural(counts.users, 'client')}. Ask me about it for details.`;
}

// ── Cooldown (Oracle's DB, pulse_alert_state) ──────────────────────────────

let warnedNoStateTable = false;

/**
 * Take the cooldown if the last send is older than COOLDOWN_MINUTES.
 * @returns {Promise<{claimed: boolean, previous: Date|null}>}
 */
export async function claimCooldown(now, runQuery) {
  const r = await runQuery(
    `WITH prev AS (SELECT last_sent_at FROM pulse_alert_state WHERE alert_key = $1)
     INSERT INTO pulse_alert_state (alert_key, last_sent_at) VALUES ($1, $2)
     ON CONFLICT (alert_key) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
       WHERE pulse_alert_state.last_sent_at <= EXCLUDED.last_sent_at - make_interval(mins => $3::int)
     RETURNING (SELECT last_sent_at FROM prev) AS previous`,
    [ALERT_KEY, now, COOLDOWN_MINUTES]
  );
  if (r.rows.length === 0) return { claimed: false, previous: null };
  return { claimed: true, previous: r.rows[0].previous ?? null };
}

/** Undo a claim nobody received. Only if the row still holds our claim. */
export async function releaseCooldown(now, previous, runQuery) {
  if (previous) {
    await runQuery(
      'UPDATE pulse_alert_state SET last_sent_at = $3 WHERE alert_key = $1 AND last_sent_at = $2',
      [ALERT_KEY, now, previous]
    );
  } else {
    await runQuery(
      'DELETE FROM pulse_alert_state WHERE alert_key = $1 AND last_sent_at = $2',
      [ALERT_KEY, now]
    );
  }
}

// ── The check ──────────────────────────────────────────────────────────────

async function defaultDeps() {
  const [{ query }, { getPulseSubscribers }, { postToSpace }] = await Promise.all([
    import('../database/connection.js'),
    import('./pulse-subscribers.js'),
    import('../api/chat-google.js')
  ]);
  return {
    countFailures: () => countChatFailures(WINDOW_MINUTES),
    oracleQuery: query,
    getSubscribers: () => getPulseSubscribers(SUBSCRIBERS_ENV),
    post: postToSpace
  };
}

export function isPulseSpikeConfigured(env = process.env) {
  return isGg3OpsConfigured() && Boolean(env[SUBSCRIBERS_ENV]?.trim());
}

/**
 * One check. Never throws for "not configured" or "in cooldown".
 * @returns {Promise<{status: 'skipped'|'below_threshold'|'cooldown'|'no_state_table'|'sent'|'undelivered', total?: number, sent?: number}>}
 */
export async function runSpikeCheck({ now = new Date(), env = process.env, deps = null } = {}) {
  if (!isPulseSpikeConfigured(env)) return { status: 'skipped' };
  const d = deps || await defaultDeps();

  const counts = await d.countFailures();
  if (!counts) return { status: 'skipped' };
  if (counts.total < THRESHOLD) return { status: 'below_threshold', total: counts.total };

  let claim;
  try {
    claim = await claimCooldown(now, d.oracleQuery);
  } catch (err) {
    if (err?.code === '42P01') {
      if (!warnedNoStateTable) {
        warnedNoStateTable = true;
        console.warn('⚠️  Pulse spike: pulse_alert_state missing (apply migration 040) — not alerting.');
      }
      return { status: 'no_state_table', total: counts.total };
    }
    throw err;
  }
  if (!claim.claimed) return { status: 'cooldown', total: counts.total };

  const text = formatSpikeAlert(counts);
  const subscribers = await d.getSubscribers();
  let sent = 0;
  for (const s of subscribers) {
    if (await d.post(s.dmSpace, text)) sent += 1;
  }

  if (sent === 0) {
    await releaseCooldown(now, claim.previous, d.oracleQuery);
    console.warn(`⚠️  Pulse spike: ${counts.total} failures but no subscriber could be reached — will retry next run.`);
    return { status: 'undelivered', total: counts.total, sent };
  }
  console.log(`📣 Pulse spike: alerted ${sent} subscriber(s) — ${counts.total} chat failures in ${WINDOW_MINUTES} min`);
  return { status: 'sent', total: counts.total, sent };
}

/** @param {Object} cron - node-cron */
export function startPulseSpike(cron, env = process.env) {
  if (!isGg3OpsConfigured()) {
    console.warn('⚠️  Pulse spike alert NOT configured — GG3_OPS_DB_READONLY_URL not set.');
    return false;
  }
  if (!env[SUBSCRIBERS_ENV]?.trim()) {
    console.warn(`⚠️  Pulse spike alert NOT configured — ${SUBSCRIBERS_ENV} is empty.`);
    return false;
  }
  const run = async () => {
    try {
      await runSpikeCheck();
    } catch (err) {
      console.error(`❌ Pulse spike check failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  };
  cron.schedule('*/5 * * * *', run, { name: 'pulse-spike', timezone: 'UTC', noOverlap: true });
  console.log('⏰ Cron job scheduled: Pulse chat spike check every 5 minutes');
  return true;
}

/** Test-only. */
export function _resetPulseSpikeForTests() {
  warnedNoStateTable = false;
}
