/**
 * The listener — the one Workspace user whose own Chat access keeps the copy
 *
 * Oracle cannot use Chat app authentication (its Marketplace listing is Public,
 * so admin approval of chat.app.* would need Google's public review). Instead a
 * dedicated user, named server-side by CHAT_LISTENER_USER_EMAIL, signs into the
 * Hub once; its stored grant (chat.messages.readonly, chat.spaces.readonly)
 * authorizes the Workspace Events subscriptions, the message fetches and the
 * backfill. No other user's token is ever used here, and nothing in a request
 * can choose the user.
 *
 * Google requires every later call on a subscription to use the OAuth client
 * that created it, so everything goes through getUserOAuth2Client
 * (GOOGLE_CLIENT_ID). The Workspace Events API has no client in the installed
 * googleapis (128), so it is called over REST with that same OAuth client.
 */

import { google } from 'googleapis';
import { query } from '../database/connection.js';
import { getUserOAuth2Client } from '../tools/google-docs.js';
import { hasChatScopes, isInsufficientScopeError } from '../tools/chat-history.js';
import { MESSAGE_EVENT_TYPES } from './config.js';

const LISTENER_DOMAIN = 'granted.ca';
const EVENTS_API = 'https://workspaceevents.googleapis.com/v1';
const LISTENER_CACHE_MS = 5 * 60 * 1000;

/** Problems only a person can fix. Listening pauses until the next pass finds them fixed. */
export const LISTENER_PROBLEMS = new Set([
  'listener_not_configured',
  'listener_not_found',
  'listener_no_token',
  'listener_scope_missing',
  'listener_token_revoked'
]);

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'EPIPE']);

let sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** Tests replace the wait between operation polls and retries. */
export function setSleepForTests(fn) {
  sleep = fn;
}
export function wait(ms) {
  return sleep(ms);
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * One fixed code for a failed Google call. Never includes the response body.
 * @returns {string} listener_token_revoked | listener_scope_missing | forbidden |
 *   not_found | already_exists | invalid_argument | transient | error
 */
export function classifyCallError(err) {
  const status = Number(err?.response?.status ?? err?.status) || (typeof err?.code === 'number' ? err.code : null);
  const data = err?.response?.data;
  const oauthError = typeof data?.error === 'string' ? data.error : null;
  const detail = `${err?.message ?? ''} ${typeof data?.error === 'object' ? JSON.stringify(data.error) : ''}`;

  if (oauthError === 'invalid_grant' || /invalid_grant/.test(detail)) return 'listener_token_revoked';
  if (isInsufficientScopeError(err) || /ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(detail)) return 'listener_scope_missing';
  if (status === 401) return 'listener_token_revoked';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'already_exists';
  if (status === 400) return 'invalid_argument';
  if (status === 429 || (status >= 500 && status < 600)) return 'transient';
  if (NETWORK_CODES.has(err?.code)) return 'transient';
  return 'error';
}

/** A log-safe code for any error: the Google classification, or a database code. */
export function describeError(err) {
  const kind = classifyCallError(err);
  if (kind !== 'error') return kind;
  const code = typeof err?.code === 'string' && /^[A-Z0-9_]{2,24}$/.test(err.code) ? err.code : null;
  return code || err?.name || 'error';
}

// Long-running operations report failure as a google.rpc.Status (gRPC codes).
const GRPC_TO_HTTP = { 3: 400, 4: 504, 5: 404, 6: 409, 7: 403, 8: 429, 9: 400, 10: 409, 13: 500, 14: 503, 16: 401 };

function operationFailure(status) {
  const err = new Error('Workspace Events operation failed');
  err.response = { status: GRPC_TO_HTTP[status?.code] || 500 };
  return err;
}

// ============================================================================
// WHO IS LISTENING
// ============================================================================

let cached = null;

/** Drop the cached listener, e.g. after a call says its token stopped working. */
export function forgetListener() {
  cached = null;
  memberCache.clear();
}

/**
 * Resolve the listener from CHAT_LISTENER_USER_EMAIL. Never throws.
 *
 * @returns {Promise<{ok: true, userId: number, client: Object, chat: Object}
 *                  | {ok: false, code: string}>} code is a LISTENER_PROBLEMS
 *                  member, or 'transient' when the lookup itself failed
 */
export async function resolveListener() {
  const email = String(process.env.CHAT_LISTENER_USER_EMAIL || '').trim().toLowerCase();
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[1] !== LISTENER_DOMAIN) {
    return { ok: false, code: 'listener_not_configured' };
  }

  if (cached && cached.email === email && Date.now() - cached.at < LISTENER_CACHE_MS) return cached.listener;

  let userId;
  try {
    const r = await query('SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = true', [email]);
    userId = r.rows[0]?.id;
  } catch {
    return { ok: false, code: 'transient' };
  }
  if (!userId) return { ok: false, code: 'listener_not_found' };

  let client;
  try {
    client = await getUserOAuth2Client(userId);
  } catch {
    // Thrown when the user row has no refresh token.
    return { ok: false, code: 'listener_no_token' };
  }

  try {
    const scopes = await hasChatScopes(userId);
    if (!scopes.ok) return { ok: false, code: 'listener_scope_missing' };
  } catch {
    return { ok: false, code: 'transient' };
  }

  // Refreshes only if the stored access token has expired; a revoked grant fails here.
  try {
    await client.getAccessToken();
  } catch (err) {
    const code = classifyCallError(err);
    return { ok: false, code: code === 'listener_token_revoked' ? code : 'transient' };
  }

  const listener = { ok: true, userId, client, chat: google.chat({ version: 'v1', auth: client }) };
  cached = { email, at: Date.now(), listener };
  return listener;
}

// ============================================================================
// CHAT
// ============================================================================

const memberCache = new Map();

/**
 * Named spaces the listener is a member of. spaces.list returns only spaces the
 * caller belongs to, and the filter drops DMs and group chats, so one call
 * answers both "is it a member?" and "is it a real space?".
 */
async function listMemberSpaceNames(listener) {
  const names = new Set();
  let pageToken;
  do {
    const res = await listener.chat.spaces.list({ pageSize: 1000, pageToken, filter: 'spaceType = "SPACE"' });
    for (const space of res.data.spaces || []) {
      if (space.spaceType === 'SPACE') names.add(space.name);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return names;
}

/**
 * @param {Object} listener - from resolveListener
 * @param {string} spaceName
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeMs] - reuse a membership list this recent (0 = always ask)
 */
export async function isListenerMember(listener, spaceName, { maxAgeMs = 0 } = {}) {
  const hit = memberCache.get(listener.userId);
  if (hit && maxAgeMs > 0 && Date.now() - hit.at <= maxAgeMs) return hit.names.has(spaceName);

  const names = await listMemberSpaceNames(listener);
  memberCache.set(listener.userId, { at: Date.now(), names });
  return names.has(spaceName);
}

export async function getMessage(listener, name) {
  const res = await listener.chat.spaces.messages.get({ name });
  return res.data;
}

/**
 * One page of a space's messages created after `since`, oldest first (the API
 * default). Paging calls must repeat the same filter, which is why the backfill
 * keeps its window start fixed.
 */
export async function listMessagesPage(listener, spaceName, { since, pageToken }) {
  const res = await listener.chat.spaces.messages.list({
    parent: spaceName,
    pageSize: 1000,
    pageToken: pageToken || undefined,
    filter: `createTime > "${new Date(since).toISOString()}"`
  });
  return { messages: res.data.messages || [], nextPageToken: res.data.nextPageToken || null };
}

// ============================================================================
// WORKSPACE EVENTS (REST)
// ============================================================================

async function events(listener, { method = 'GET', path, params, data }) {
  const res = await listener.client.request({ url: `${EVENTS_API}/${path}`, method, params, data });
  return res.data;
}

async function finish(listener, operation) {
  let op = operation || {};
  for (let attempt = 0; !op.done && attempt < 8; attempt++) {
    if (!op.name) break;
    await sleep(Math.min(500 * 2 ** attempt, 5000));
    op = await events(listener, { path: op.name });
  }
  if (!op.done) {
    const err = new Error('Workspace Events operation did not finish');
    err.response = { status: 504 };
    throw err;
  }
  if (op.error) throw operationFailure(op.error);
  return op.response || null;
}

/** Subscribe to a space's message events. Names only — no message content. */
export async function createSubscription(listener, spaceName) {
  const op = await events(listener, {
    method: 'POST',
    path: 'subscriptions',
    data: {
      targetResource: `//chat.googleapis.com/${spaceName}`,
      eventTypes: MESSAGE_EVENT_TYPES,
      notificationEndpoint: { pubsubTopic: process.env.CHAT_EVENTS_PUBSUB_TOPIC },
      // Without resource data a subscription lasts up to 7 days (4 hours with).
      // Each message is fetched instead, which always returns its current state.
      payloadOptions: { includeResource: false }
    }
  });
  return finish(listener, op);
}

export async function getSubscription(listener, subscriptionName) {
  return events(listener, { path: subscriptionName });
}

/** The listener's existing subscription for a space, if any. */
export async function findSubscription(listener, spaceName) {
  const data = await events(listener, {
    path: 'subscriptions',
    params: {
      filter: `event_types:"${MESSAGE_EVENT_TYPES[0]}" AND target_resource="//chat.googleapis.com/${spaceName}"`
    }
  });
  return (data?.subscriptions || [])[0] || null;
}

/** Extend to the maximum lifetime (ttl 0). */
export async function renewSubscription(listener, subscriptionName) {
  const op = await events(listener, {
    method: 'PATCH',
    path: subscriptionName,
    params: { updateMask: 'ttl' },
    data: { ttl: '0s' }
  });
  return finish(listener, op);
}

export async function reactivateSubscription(listener, subscriptionName) {
  const op = await events(listener, { method: 'POST', path: `${subscriptionName}:reactivate`, data: {} });
  return finish(listener, op);
}

export async function deleteSubscription(listener, subscriptionName) {
  const op = await events(listener, { method: 'DELETE', path: subscriptionName });
  await finish(listener, op);
}
