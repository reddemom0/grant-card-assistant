/**
 * Backfill and catch-up for the stored Chat copy
 *
 * Backfill: once per enabled space, import the last 12 months. The window start
 * is fixed when the space is enabled, and each page is stored in the same
 * transaction as the token for the next page — so an interrupted backfill
 * resumes where it stopped, and the upsert (keyed on the message name) means a
 * repeated page can never duplicate anything.
 *
 * Catch-up: after a pause or a replaced subscription, re-read from just before
 * the newest stored message. It only recovers messages CREATED in the gap;
 * edits and deletions of older messages during a gap are not recovered.
 */

import * as store from '../database/chat-listen-store.js';
import {
  resolveListener, forgetListener, listMessagesPage, classifyCallError, describeError,
  LISTENER_PROBLEMS, wait
} from './listener.js';
import { CATCH_UP_OVERLAP_MS } from './config.js';

// One backfill or catch-up per space at a time, in this process.
const running = new Map();
const TRANSIENT_RETRIES = 3;

function inBackground(spaceName, label, work) {
  if (running.has(spaceName)) return null;
  const promise = work().catch(err => {
    console.error(`❌ Chat listen ${label} crashed — code: ${describeError(err)}`);
  });
  return promise;
}

/** Start a backfill in the background. Returns its promise, or null if work is running. */
export function startBackfill(spaceName, opts) {
  return inBackground(spaceName, 'backfill', () => runBackfill(spaceName, opts));
}

/** Start a catch-up in the background. Returns its promise, or null if work is running. */
export function startCatchUp(spaceName, opts) {
  return inBackground(spaceName, 'catch-up', () => runCatchUp(spaceName, opts));
}

/** Resolves once no backfill or catch-up is running (tests, graceful shutdown). */
export async function whenIdle() {
  while (running.size > 0) {
    await Promise.allSettled([...running.values()]);
  }
}

/** Mark work as running for its whole duration, synchronously on entry. */
function track(spaceName, work) {
  let finish;
  running.set(spaceName, new Promise(resolve => { finish = resolve; }));
  return work().finally(() => {
    running.delete(spaceName);
    finish();
  });
}

/**
 * Page through messages created after `since`, handing each page to `onPage`.
 * Stops early when `stillActive` says the space was paused or removed.
 */
async function pageThrough(listener, spaceName, { since, pageToken, onPage, onTokenRejected, stillActive }) {
  const totals = { pages: 0, stored: 0, private: 0, skipped: 0 };
  let token = pageToken || null;
  let from = since;
  let tokenRetried = false;
  let transientTries = 0;

  for (;;) {
    if (!(await stillActive())) return { ...totals, stopped: 'space_not_active' };

    let page;
    try {
      page = await listMessagesPage(listener, spaceName, { since: from, pageToken: token });
    } catch (err) {
      const code = classifyCallError(err);
      if (code === 'invalid_argument' && token && onTokenRejected && !tokenRetried) {
        // A saved page token can go stale. Restart from what is already stored.
        tokenRetried = true;
        from = await onTokenRejected();
        token = null;
        continue;
      }
      if (code === 'transient' && transientTries < TRANSIENT_RETRIES) {
        await wait(1000 * 2 ** transientTries++);
        continue;
      }
      return { ...totals, error: code };
    }
    transientTries = 0;

    const rows = [];
    for (const message of page.messages) {
      const result = store.messageToRow(message, spaceName);
      if (result.row) rows.push(result.row);
      else if (result.skip === 'private') totals.private++;
      else totals.skipped++;
    }

    totals.stored += await onPage(rows, page.nextPageToken);
    totals.pages++;
    if (!page.nextPageToken) return totals;
    token = page.nextPageToken;
  }
}

async function listenerFor(listener) {
  return listener?.ok ? listener : resolveListener();
}

/** Record why work stopped. A listener problem pauses the space; the copy is kept. */
async function stopFor(spaceName, code) {
  if (LISTENER_PROBLEMS.has(code)) {
    forgetListener();
    await store.setSpacePaused(spaceName, code);
  } else if (code === 'forbidden' || code === 'not_found') {
    await store.setSpacePaused(spaceName, 'listener_not_member');
  }
}

function summary(t) {
  return `pages: ${t.pages}, stored: ${t.stored}, private skipped: ${t.private}, other skipped: ${t.skipped}`;
}

export function runBackfill(spaceName, { listener } = {}) {
  if (running.has(spaceName)) return Promise.resolve({ outcome: 'already_running' });
  return track(spaceName, async () => {
    const row = await store.getListenSpace(spaceName);
    if (!row || row.status !== 'active' || row.backfill_state === 'done') return { outcome: 'skipped' };

    const who = await listenerFor(listener);
    if (!who.ok) {
      await stopFor(spaceName, who.code);
      return { outcome: 'stopped', code: who.code };
    }

    await store.setBackfill(spaceName, { state: 'running' });

    const totals = await pageThrough(who, spaceName, {
      since: row.backfill_since,
      pageToken: row.backfill_page_token,
      onPage: (rows, next) => store.storeBackfillPage(spaceName, rows, next),
      onTokenRejected: async () => catchUpStart(spaceName, row.backfill_since),
      stillActive: async () => (await store.getListenSpace(spaceName))?.status === 'active'
    });

    if (totals.error || totals.stopped) {
      const code = totals.error || totals.stopped;
      await stopFor(spaceName, code);
      // 'pending' keeps the saved page token; the hourly pass resumes from it.
      await store.setBackfill(spaceName, { state: LISTENER_PROBLEMS.has(code) || totals.stopped ? 'pending' : 'failed' });
      console.warn(`⚠️  Chat listen backfill stopped — ${summary(totals)}, code: ${code}`);
      return { outcome: 'stopped', code, ...totals };
    }

    await store.setBackfill(spaceName, { state: 'done', pageToken: null });
    console.log(`📥 Chat listen backfill done — ${summary(totals)}`);
    return { outcome: 'done', ...totals };
  });
}

async function catchUpStart(spaceName, backfillSince) {
  const latest = await store.latestCreateTime(spaceName);
  const floor = new Date(backfillSince).getTime();
  const newest = latest ? new Date(latest).getTime() : floor;
  return new Date(Math.max(newest, floor) - CATCH_UP_OVERLAP_MS);
}

export function runCatchUp(spaceName, { listener } = {}) {
  if (running.has(spaceName)) return Promise.resolve({ outcome: 'already_running' });
  return track(spaceName, async () => {
    const row = await store.getListenSpace(spaceName);
    if (!row || row.status !== 'active') return { outcome: 'skipped' };

    const who = await listenerFor(listener);
    if (!who.ok) {
      await stopFor(spaceName, who.code);
      return { outcome: 'stopped', code: who.code };
    }

    const totals = await pageThrough(who, spaceName, {
      since: await catchUpStart(spaceName, row.backfill_since),
      pageToken: null,
      onPage: (rows) => store.upsertMessages(rows),
      stillActive: async () => (await store.getListenSpace(spaceName))?.status === 'active'
    });

    if (totals.error || totals.stopped) {
      const code = totals.error || totals.stopped;
      await stopFor(spaceName, code);
      console.warn(`⚠️  Chat listen catch-up stopped — ${summary(totals)}, code: ${code}`);
      return { outcome: 'stopped', code, ...totals };
    }

    console.log(`📥 Chat listen catch-up done — ${summary(totals)}`);
    return { outcome: 'done', ...totals };
  });
}
