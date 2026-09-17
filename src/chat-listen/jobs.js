/**
 * Scheduled work for the stored Chat copy
 *
 *   hourly  :17 UTC  allowlist reconcile + sync every followed space (renewal,
 *                    resume after a pause, interrupted backfills)
 *   daily 09:30 UTC  retention — messages older than 12 months, tombstones
 *                    older than 30 days
 *
 * The hourly pass runs only when listening is switched on and configured, so a
 * local run with a different allowlist can never tear down a real space's copy.
 * Retention always runs: it only deletes what is past its date.
 *
 * Assumes ONE instance, like the lead-gen cron in server.js. A second replica
 * would repeat the pass — harmless, since every step is idempotent, but noisy.
 */

import { listenReady, listenDisabled, listenEnvProblems, monthsAgo, daysAgo, RETENTION_MONTHS, TOMBSTONE_DAYS } from './config.js';
import { reconcile, renewalPass } from './subscriptions.js';
import { pruneExpired } from '../database/chat-listen-store.js';
import { describeError } from './listener.js';

export async function runListenPass() {
  if (!listenReady()) return { skipped: true };
  const allowlist = await reconcile();
  const pass = await renewalPass();
  return { allowlist, pass };
}

export async function runRetention(now = new Date()) {
  const deleted = await pruneExpired({
    messagesBefore: monthsAgo(RETENTION_MONTHS, now),
    tombstonesBefore: daysAgo(TOMBSTONE_DAYS, now)
  });
  console.log(`🗑️  Chat listen retention — messages deleted: ${deleted.messages}, tombstones deleted: ${deleted.tombstones}`);
  return deleted;
}

function guarded(label, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`❌ Chat listen ${label} failed — code: ${describeError(err)}`);
    }
  };
}

/**
 * Register the jobs and run one pass now (picks up allowlist changes and any
 * backfill a restart interrupted).
 * @param {Object} cron - node-cron
 * @returns {Promise<void>} the startup pass; callers need not wait for it
 */
export function startChatListen(cron) {
  if (listenDisabled()) {
    console.log('⏸️  Chat listen DISABLED (CHAT_LISTEN_DISABLED=true) — no spaces followed; retention still runs');
  } else {
    const missing = listenEnvProblems();
    if (missing.length > 0) {
      console.warn(`⚠️  Chat listen NOT configured — no spaces followed. Missing: ${missing.join(', ')}. Retention still runs.`);
    }
  }

  const pass = guarded('pass', runListenPass);
  cron.schedule('17 * * * *', pass, { name: 'chat-listen-pass', timezone: 'UTC', noOverlap: true });
  cron.schedule('30 9 * * *', guarded('retention', () => runRetention()), {
    name: 'chat-listen-retention',
    timezone: 'UTC',
    noOverlap: true
  });
  console.log('⏰ Cron jobs scheduled: Chat listen pass hourly (:17 UTC), retention daily (09:30 UTC)');

  return pass();
}
