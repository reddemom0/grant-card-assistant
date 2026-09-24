/**
 * Scheduled work for tracked cards
 *
 *   hourly :05 UTC   digests — each person gets theirs when it is 08:xx in their
 *                    calendar time zone, at most once per local day; then
 *                    due-date messages (track card), each sent once; then
 *                    unconfirmed /learn-this lessons older than 24 hours are
 *                    deleted and their cards updated in place (nothing posted)
 *   daily 13:00 UTC  refresh open cards from real sources, then stale/auto-close
 *                    (before the Pacific-time digests)
 *
 * Switch off with TRACKED_CARDS_DISABLED=true. Assumes one instance, like the
 * other cron jobs in server.js. Needs migration 030.
 */

import { sendDueDigests, sendDueReminders } from './notify.js';
import { runDailyCardPass } from './lifecycle.js';
import { expireLessonCards } from './lesson-card.js';

function guarded(label, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`❌ Tracked cards ${label} failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  };
}

/** @param {Object} cron - node-cron */
export function startTrackedCards(cron) {
  if (process.env.TRACKED_CARDS_DISABLED === 'true') {
    console.log('⏸️  Tracked cards jobs DISABLED (TRACKED_CARDS_DISABLED=true)');
    return false;
  }
  cron.schedule('5 * * * *', guarded('digest', async () => {
    await sendDueDigests();
    await sendDueReminders();
    await expireLessonCards();
  }), {
    name: 'tracked-cards-digest', timezone: 'UTC', noOverlap: true
  });
  cron.schedule('0 13 * * *', guarded('daily pass', () => runDailyCardPass()), {
    name: 'tracked-cards-daily', timezone: 'UTC', noOverlap: true
  });
  console.log('⏰ Cron jobs scheduled: tracked-card digests hourly (:05 UTC), refresh + lifecycle daily (13:00 UTC)');
  return true;
}
