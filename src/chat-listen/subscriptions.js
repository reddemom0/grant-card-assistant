/**
 * Keeping each followed space subscribed — or deliberately not
 *
 * syncSpace() is the one routine that brings a space to 'active', and the hourly
 * pass runs it for every followed space. In order it checks:
 *   1. the listener resolves (configured, signed in, scopes, token works);
 *   2. the listener is a member of the space, and it is a named space;
 *   3. members have been told the space is being copied (notice BEFORE reading);
 *   4. a subscription exists and is ACTIVE — renewed when within 48 hours of
 *      expiry, reactivated or replaced when suspended, recreated when gone;
 * then marks the space active and starts the backfill, or a catch-up after a
 * pause or a replaced subscription.
 *
 * Any failure a person must fix PAUSES the space with a code and keeps its copy.
 * Transient failures change nothing; the next pass retries. Only teardownSpace()
 * deletes the copy — when the Oracle app is removed from the space, or the space
 * leaves the allowlist.
 */

import * as store from '../database/chat-listen-store.js';
import {
  listenSpaces, listenEntry, isListenSpace, listenReady, monthsAgo,
  RETENTION_MONTHS, RENEW_WITHIN_MS
} from './config.js';
import {
  resolveListener, forgetListener, isListenerMember, classifyCallError, describeError,
  createSubscription, getSubscription, findSubscription, renewSubscription,
  reactivateSubscription, deleteSubscription, LISTENER_PROBLEMS
} from './listener.js';
import { startBackfill, startCatchUp } from './backfill.js';
import { listeningNotice } from '../api/space-intros.js';

// A suspended subscription with this reason can't be reactivated (Google:
// "You can't reactivate the subscription"). It is replaced instead.
const NOT_REACTIVATABLE = new Set(['USER_AUTHORIZATION_FAILURE']);

// ============================================================================
// ONE THING AT A TIME PER SPACE
// ============================================================================

const locks = new Map();

/** Run fn after any work already queued for this space. */
export function withSpaceLock(spaceName, fn) {
  const previous = locks.get(spaceName) || Promise.resolve();
  const run = previous.then(() => fn());
  const tail = run.catch(() => {});
  locks.set(spaceName, tail);
  tail.then(() => {
    if (locks.get(spaceName) === tail) locks.delete(spaceName);
  });
  return run;
}

// ============================================================================
// SYNC
// ============================================================================

async function pause(spaceName, code) {
  await store.setSpacePaused(spaceName, code);
  return { outcome: 'paused', code };
}

/** Map a failed Google call at a given stage to a pause or a retry. */
async function failed(spaceName, err, stage) {
  const code = classifyCallError(err);
  if (LISTENER_PROBLEMS.has(code)) {
    forgetListener();
    return pause(spaceName, code);
  }
  if (code === 'transient' || code === 'error') {
    return { outcome: 'failed', code: `${stage}_${describeError(err)}` };
  }
  if (stage === 'membership' && (code === 'forbidden' || code === 'not_found')) {
    return pause(spaceName, 'listener_not_member');
  }
  return pause(spaceName, `${stage}_${code}`);
}

async function postNotice(spaceName) {
  // Loaded on use, as chat-google.js loads this module: a static import either
  // way would pull the whole agent loop into the other's dependency graph.
  const { postToSpace } = await import('../api/chat-google.js');
  return postToSpace(spaceName, listeningNotice());
}

async function deleteQuietly(listener, subscriptionName) {
  try {
    await deleteSubscription(listener, subscriptionName);
  } catch (err) {
    const code = classifyCallError(err);
    if (code === 'not_found') return;
    if (LISTENER_PROBLEMS.has(code)) throw err;
    console.warn(`⚠️  Chat listen could not delete a replaced subscription — code: ${code}`);
  }
}

async function saveRenewingIfDue(listener, spaceName, subscription, flags) {
  let current = subscription;
  let renewed = false;
  const expiresAt = Date.parse(subscription.expireTime || '');
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < RENEW_WITHIN_MS) {
    current = (await renewSubscription(listener, subscription.name)) || subscription;
    renewed = true;
  }
  await store.saveSubscription(spaceName, {
    name: current.name,
    expireTime: current.expireTime,
    state: current.state || 'ACTIVE'
  });
  return { ...flags, renewed };
}

/**
 * Make sure the space has an ACTIVE subscription authorized by the listener.
 * @returns {Promise<{created?: boolean, renewed?: boolean, reactivated?: boolean}>}
 */
async function ensureActiveSubscription(listener, row) {
  const spaceName = row.space_name;
  let subscription = null;

  if (row.subscription_name) {
    try {
      subscription = await getSubscription(listener, row.subscription_name);
    } catch (err) {
      if (classifyCallError(err) !== 'not_found') throw err;
    }
  }

  if (subscription?.state === 'SUSPENDED') {
    if (!NOT_REACTIVATABLE.has(subscription.suspensionReason)) {
      try {
        const revived = await reactivateSubscription(listener, subscription.name);
        return await saveRenewingIfDue(listener, spaceName, revived || { ...subscription, state: 'ACTIVE' }, { reactivated: true });
      } catch (err) {
        if (LISTENER_PROBLEMS.has(classifyCallError(err))) throw err;
        // Could not be revived — replace it below.
      }
    }
    await deleteQuietly(listener, subscription.name);
    subscription = null;
  }

  if (subscription?.state === 'ACTIVE') {
    return saveRenewingIfDue(listener, spaceName, subscription, {});
  }

  let created;
  try {
    created = await createSubscription(listener, spaceName);
  } catch (err) {
    if (classifyCallError(err) !== 'already_exists') throw err;
    created = await findSubscription(listener, spaceName);
    if (!created) throw err;
  }

  await store.saveSubscription(spaceName, {
    name: created.name,
    expireTime: created.expireTime,
    state: created.state || 'ACTIVE'
  });
  return { created: true };
}

/**
 * Bring one followed space to 'active', or pause it with the reason. Never
 * deletes stored messages. Callers hold the space lock.
 *
 * @param {string} spaceName
 * @param {Object} [opts]
 * @param {Object} [opts.listener] - a resolved listener to reuse across spaces
 * @returns {Promise<{outcome: 'active'|'enabled'|'resumed'|'paused'|'failed'|'skipped', code?: string}>}
 */
export async function syncSpace(spaceName, { listener } = {}) {
  const row = await store.getListenSpace(spaceName);
  if (!row || row.status === 'removed' || !isListenSpace(spaceName)) return { outcome: 'skipped' };

  const who = listener || await resolveListener();
  if (!who.ok) {
    if (who.code === 'transient') return { outcome: 'failed', code: 'listener_lookup_transient' };
    return pause(spaceName, who.code);
  }

  let member;
  try {
    member = await isListenerMember(who, spaceName, { maxAgeMs: 0 });
  } catch (err) {
    return failed(spaceName, err, 'membership');
  }
  if (!member) return pause(spaceName, 'listener_not_member');

  // Members are told before anything is read.
  if (!row.notice_posted_at) {
    if (!(await postNotice(spaceName))) return pause(spaceName, 'notice_failed');
    await store.markNoticePosted(spaceName);
  }

  let subscription;
  try {
    subscription = await ensureActiveSubscription(who, row);
  } catch (err) {
    return failed(spaceName, err, 'subscription');
  }

  await store.setSpaceActive(spaceName);
  const wasPaused = row.status === 'paused';

  if (row.backfill_state !== 'done') {
    startBackfill(spaceName, { listener: who });
  } else if (wasPaused || subscription.created) {
    startCatchUp(spaceName, { listener: who });
  }

  const outcome = !wasPaused ? 'active' : row.pause_reason === 'not_started' ? 'enabled' : 'resumed';
  return { outcome, ...subscription };
}

/**
 * Start following an allowlisted space (or restart one that was removed), then
 * sync it. Used when the Oracle app is added to a space.
 *
 * @param {string} spaceName
 * @param {Object} [opts]
 * @param {boolean} [opts.announced] - the join intro already told members
 */
export async function enableSpace(spaceName, { announced = false } = {}) {
  const entry = listenEntry(spaceName);
  if (!entry) return { outcome: 'skipped' };
  if (!listenReady()) return { outcome: 'skipped', code: 'listen_not_ready' };

  return withSpaceLock(spaceName, async () => {
    await store.startListenSpace({
      spaceName,
      label: entry.label,
      since: monthsAgo(RETENTION_MONTHS),
      noticePosted: announced
    });
    if (announced) await store.markNoticePosted(spaceName);
    const result = await syncSpace(spaceName);
    console.log(`👂 Chat listen enable — outcome: ${result.outcome}${result.code ? `, code: ${result.code}` : ''}`);
    return result;
  });
}

// ============================================================================
// LIFECYCLE EVENTS
// ============================================================================

/**
 * @param {string} type - e.g. google.workspace.events.subscription.v1.expired
 * @param {Object} subscription - the Subscription resource from the event
 */
export async function handleLifecycle(type, subscription) {
  const kind = String(type).split('.').pop();
  const row = await store.findSpaceBySubscription(subscription?.name);
  if (!row) {
    console.log(`↩️  Chat listen lifecycle ${kind} ignored — reason: untracked_subscription`);
    return { outcome: 'ignored' };
  }
  const spaceName = row.space_name;

  if (kind === 'suspended') {
    // The copy is kept. The hourly pass reactivates or replaces the subscription
    // once the listener can read the space again.
    const code = `suspended_${String(subscription.suspensionReason || 'OTHER').toLowerCase()}`;
    await store.setSubscriptionState(spaceName, 'SUSPENDED');
    await store.setSpacePaused(spaceName, code);
    console.warn(`⏸️  Chat listen subscription suspended — reason: ${code}`);
    return { outcome: 'paused', code };
  }

  // Expired subscriptions are deleted by Google and can only be recreated.
  if (kind === 'expired') await store.clearSubscription(spaceName);
  if (!listenReady()) return { outcome: 'skipped', code: 'listen_not_ready' };

  const result = await withSpaceLock(spaceName, () => syncSpace(spaceName));
  console.log(`🔔 Chat listen lifecycle ${kind} — outcome: ${result.outcome}${result.code ? `, code: ${result.code}` : ''}`);
  return result;
}

// ============================================================================
// REMOVAL
// ============================================================================

async function deleteRemoteSubscription(subscriptionName) {
  const listener = await resolveListener();
  if (!listener.ok) return listener.code;
  try {
    await deleteSubscription(listener, subscriptionName);
    return 'deleted';
  } catch (err) {
    const code = classifyCallError(err);
    return code === 'not_found' ? 'deleted' : code;
  }
}

/**
 * Stop following a space and delete its whole copy.
 *
 * Writes stop first (status 'removed'), so an event already being processed
 * cannot refill the space. If the subscription can't be deleted now, its name is
 * kept so the hourly pass retries; it expires within 7 days regardless.
 *
 * @param {string} spaceName
 * @param {Object} [opts]
 * @param {boolean} [opts.forget] - also drop the row (space left the allowlist)
 */
export function teardownSpace(spaceName, { forget = false } = {}) {
  return withSpaceLock(spaceName, async () => {
    const row = await store.getListenSpace(spaceName);
    if (!row) return { outcome: 'skipped' };

    await store.setSpaceRemoved(spaceName);

    let subscription = 'none';
    if (row.subscription_name) {
      subscription = await deleteRemoteSubscription(row.subscription_name);
      if (subscription === 'deleted') await store.clearSubscription(spaceName);
    }

    const deleted = await store.deleteSpaceData(spaceName);
    const outstanding = subscription !== 'none' && subscription !== 'deleted';
    if (forget && !outstanding) await store.deleteListenSpace(spaceName);

    console.log(`🧹 Chat listen teardown — messages deleted: ${deleted.messages}, tombstones deleted: ${deleted.tombstones}, subscription: ${subscription}`);
    return { outcome: 'removed', subscription, ...deleted };
  });
}

// ============================================================================
// THE HOURLY PASS
// ============================================================================

/**
 * Match the table to the allowlist: add rows for newly listed spaces (they start
 * paused and become active on sync), tear down spaces no longer listed, and
 * retry subscription deletes that failed during an earlier teardown.
 */
export async function reconcile() {
  const rows = await store.listListenSpaces();
  const known = new Set(rows.map(r => r.space_name));
  let added = 0;
  let removed = 0;

  for (const entry of listenSpaces()) {
    if (known.has(entry.name)) continue;
    await store.startListenSpace({ spaceName: entry.name, label: entry.label, since: monthsAgo(RETENTION_MONTHS) });
    added++;
  }

  for (const row of rows) {
    if (!isListenSpace(row.space_name)) {
      await teardownSpace(row.space_name, { forget: true });
      removed++;
    } else if (row.status === 'removed' && row.subscription_name) {
      await teardownSpace(row.space_name);
    }
  }

  if (added || removed) console.log(`🧭 Chat listen allowlist — spaces added: ${added}, spaces removed: ${removed}`);
  return { added, removed };
}

/** Sync every followed space. Logs one line of counts and codes. */
export async function renewalPass() {
  const rows = (await store.listListenSpaces())
    .filter(r => r.status !== 'removed' && isListenSpace(r.space_name));
  const counts = { spaces: rows.length, active: 0, enabled: 0, resumed: 0, paused: 0, failed: 0, renewed: 0, created: 0, reactivated: 0 };
  const codes = new Set();
  if (rows.length === 0) return counts;

  const listener = await resolveListener();

  for (const row of rows) {
    const result = await withSpaceLock(row.space_name, () => syncSpace(row.space_name, { listener }))
      .catch(err => ({ outcome: 'failed', code: describeError(err) }));
    if (result.outcome in counts) counts[result.outcome]++;
    for (const flag of ['renewed', 'created', 'reactivated']) if (result[flag]) counts[flag]++;
    if (result.code) codes.add(result.code);
  }

  console.log(
    `🔁 Chat listen pass — spaces: ${counts.spaces}, active: ${counts.active}, enabled: ${counts.enabled}, resumed: ${counts.resumed}, ` +
    `paused: ${counts.paused}, failed: ${counts.failed}, renewed: ${counts.renewed}, ` +
    `created: ${counts.created}, reactivated: ${counts.reactivated}` +
    (codes.size ? ` — codes: ${[...codes].join(', ')}` : '')
  );
  return counts;
}
