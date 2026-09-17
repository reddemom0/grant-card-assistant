/**
 * POST /api/chat/events — Pub/Sub push for the stored Chat copy
 *
 * Google Workspace Events → Pub/Sub topic (CHAT_EVENTS_PUBSUB_TOPIC) → push
 * here. Every request must carry a Google-signed OIDC token minted for the push
 * subscription's service account (PUBSUB_PUSH_SERVICE_ACCOUNT) with our
 * audience (PUBSUB_PUSH_AUDIENCE). Anything else gets 401 before a byte of the
 * body is read.
 *
 * Events carry message NAMES only; each message is fetched with the listener's
 * access (src/chat-listen/listener.js), which always returns its current state.
 *
 * Status codes are Pub/Sub acknowledgements:
 *   204  handled (or deliberately ignored) — do not redeliver
 *   503  held: the space is paused or listening is switched off — redeliver
 *        later (Pub/Sub keeps trying for up to 7 days)
 *   500  transient failure — redeliver
 * Every write is idempotent, so redelivery is always safe.
 *
 * Logs carry event types, counts and codes only — never message text, names,
 * emails or resource ids.
 */

import { google } from 'googleapis';
import * as store from '../database/chat-listen-store.js';
import { isListenSpace, listenReady } from '../chat-listen/config.js';
import {
  resolveListener, forgetListener, getMessage, isListenerMember, classifyCallError,
  describeError, LISTENER_PROBLEMS
} from '../chat-listen/listener.js';
import { handleLifecycle } from '../chat-listen/subscriptions.js';

const MESSAGE_PREFIX = 'google.workspace.chat.message.v1.';
const LIFECYCLE_PREFIX = 'google.workspace.events.subscription.v1.';
const PUSH_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
// A 404 on a fetch is only trusted as "deleted" if the listener can still see
// the space; that membership answer is reused for this long.
const MEMBERSHIP_REUSE_MS = 60 * 1000;

// Reused across requests; holds Google's cached signing certs.
const oauthClient = new google.auth.OAuth2();

/**
 * Verify the push came from our Pub/Sub subscription. Exported for testing.
 * @returns {Promise<{ok: boolean, reason: string|null}>} reason is a fixed code
 */
export async function verifyPushRequest(req) {
  const audience = process.env.PUBSUB_PUSH_AUDIENCE;
  const expected = process.env.PUBSUB_PUSH_SERVICE_ACCOUNT;
  if (!audience) return { ok: false, reason: 'audience_not_configured' };
  if (!expected) return { ok: false, reason: 'service_account_not_configured' };

  const header = req.headers?.authorization || '';
  if (!header.startsWith('Bearer ')) return { ok: false, reason: 'missing_bearer' };
  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) return { ok: false, reason: 'empty_bearer' };

  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    // Signature, audience and expiry failures all land here.
    return { ok: false, reason: 'token_invalid' };
  }

  if (!PUSH_ISSUERS.has(payload?.iss)) return { ok: false, reason: 'wrong_issuer' };
  if (payload?.email_verified !== true) return { ok: false, reason: 'email_not_verified' };
  if (payload?.email !== expected) return { ok: false, reason: 'wrong_service_account' };
  return { ok: true, reason: null };
}

/**
 * Read a Pub/Sub push body (wrapped form). Exported for testing.
 * @returns {{type: string, subject: string|null, data: Object|null}|null} null when malformed
 */
export function parsePushBody(body) {
  const message = body?.message;
  const attributes = message?.attributes;
  const type = attributes?.['ce-type'];
  if (typeof type !== 'string' || !type) return null;

  let data = null;
  if (typeof message.data === 'string' && message.data) {
    try {
      data = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
  return { type, subject: attributes['ce-subject'] || null, data };
}

function messageAction(type) {
  if (!type.startsWith(MESSAGE_PREFIX)) return null;
  const verb = type.slice(MESSAGE_PREFIX.length);
  const base = verb.replace(/^batch/, '').toLowerCase();
  if (base === 'created' || base === 'updated') return { upsert: true, verb };
  if (base === 'deleted') return { upsert: false, verb };
  return null;
}

/** Single events carry {message}; batch events carry {messages: [{message}]}. */
function messageNames(data) {
  const items = Array.isArray(data?.messages) ? data.messages : [data];
  return items
    .map(item => item?.message?.name ?? item?.name)
    .filter(name => typeof name === 'string');
}

function spaceFromSubject(subject) {
  return /^\/\/chat\.googleapis\.com\/(spaces\/[A-Za-z0-9_-]+)$/.exec(subject || '')?.[1] || null;
}

function subscriptionFromSubject(subject) {
  return /^\/\/workspaceevents\.googleapis\.com\/(subscriptions\/[^/]+)$/.exec(subject || '')?.[1] || null;
}

/** Pause for problems a person must fix and hold the event; retry anything else. */
async function holdOrRetry(spaceName, code) {
  if (LISTENER_PROBLEMS.has(code) || code === 'forbidden') {
    if (LISTENER_PROBLEMS.has(code)) forgetListener();
    const reason = code === 'forbidden' ? 'listener_not_member' : code;
    await store.setSpacePaused(spaceName, reason);
    console.warn(`⏸️  Chat listen event held — space paused, reason: ${reason}`);
    return 503;
  }
  console.warn(`⚠️  Chat listen event will be retried — code: ${code}`);
  return 500;
}

async function routeEvent({ type, subject, data }) {
  if (type.startsWith(LIFECYCLE_PREFIX)) {
    const subscription = data?.subscription ?? data ?? {};
    await handleLifecycle(type, { ...subscription, name: subscription.name || subscriptionFromSubject(subject) });
    return 204;
  }

  const action = messageAction(type);
  if (!action) {
    console.log(`↩️  Chat listen event ignored — reason: unhandled_type (${type})`);
    return 204;
  }

  const spaceName = spaceFromSubject(subject);
  const row = spaceName && isListenSpace(spaceName) ? await store.getListenSpace(spaceName) : null;
  if (!row || row.status === 'removed') {
    console.log(`↩️  Chat listen event ignored — reason: space_not_listened (${action.verb})`);
    return 204;
  }
  if (row.status !== 'active') {
    console.warn(`⏸️  Chat listen event held — reason: space_paused (${action.verb})`);
    return 503;
  }

  const names = messageNames(data);
  const inSpace = names.filter(name => name.startsWith(`${spaceName}/messages/`));
  const counts = { stored: 0, unchanged: 0, deleted: 0, private: 0, skipped: names.length - inSpace.length };
  const summary = () =>
    `📨 Chat listen event — ${action.verb}: messages ${names.length}, stored ${counts.stored}, ` +
    `unchanged ${counts.unchanged}, deleted ${counts.deleted}, private ${counts.private}, skipped ${counts.skipped}`;

  if (!action.upsert) {
    counts.deleted = await store.tombstoneMessages(spaceName, inSpace);
    console.log(summary());
    return 204;
  }

  const listener = await resolveListener();
  if (!listener.ok) {
    if (listener.code === 'transient') return holdOrRetry(spaceName, 'transient');
    return holdOrRetry(spaceName, listener.code);
  }

  const rows = [];
  const gone = [];
  const created = [];   // new messages, for tracked cards in their threads
  const isCreated = action.verb.replace(/^batch/, '').toLowerCase() === 'created';
  for (const name of inSpace) {
    let message;
    try {
      message = await getMessage(listener, name);
    } catch (err) {
      const code = classifyCallError(err);
      if (code !== 'not_found') return holdOrRetry(spaceName, code);

      // Deleted — or the listener can no longer see the space. Only the first
      // may tombstone; the second must never wipe the stored copy.
      let member;
      try {
        member = await isListenerMember(listener, spaceName, { maxAgeMs: MEMBERSHIP_REUSE_MS });
      } catch (memberErr) {
        return holdOrRetry(spaceName, classifyCallError(memberErr));
      }
      if (!member) return holdOrRetry(spaceName, 'forbidden');
      gone.push(name);
      continue;
    }

    const result = store.messageToRow(message, spaceName);
    if (result.row) rows.push(result.row);
    if (result.row && isCreated) created.push(message);
    else if (result.skip === 'private') counts.private++;
    else counts.skipped++;
  }

  counts.stored = await store.upsertMessages(rows);
  counts.unchanged = rows.length - counts.stored;
  if (gone.length) counts.deleted = await store.tombstoneMessages(spaceName, gone);
  console.log(summary());

  // New messages may move the ball on a tracked card in their thread (a
  // labelled best guess). Only *created* events — an edit, including Oracle
  // patching its own card, is never activity. Background: it can never change
  // this response, so Pub/Sub never redelivers because of it.
  if (created.length) {
    import('../cards/track-card.js')
      .then(({ onThreadMessages }) => onThreadMessages(spaceName, created))
      .catch(err => console.warn(`⚠️  Tracked card thread hook failed — code: ${err?.code || err?.name || 'unknown'}`));

    // A new post about a watched program becomes a line in tomorrow's DM (never
    // an immediate ping), and a post saying the program closed ends the watch.
    // Not limited to the card's own thread: a watch follows the program.
    import('../cards/watch-card.js')
      .then(({ onStoredMessages }) => onStoredMessages(spaceName, created))
      .catch(err => console.warn(`⚠️  Watch card post hook failed — code: ${err?.code || err?.name || 'unknown'}`));
  }
  return 204;
}

/**
 * POST /api/chat/events
 */
export async function handleChatEventsPush(req, res) {
  const auth = await verifyPushRequest(req);
  if (!auth.ok) {
    console.warn(`🚫 Chat events push rejected — reason: ${auth.reason}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = parsePushBody(req.body);
  if (!event) {
    // Redelivering a body we can't read would never help.
    console.warn('⚠️  Chat events push acknowledged — reason: malformed_body');
    return res.status(204).end();
  }

  if (!listenReady()) {
    console.warn('⏸️  Chat events push held — reason: listen_not_ready');
    return res.status(503).end();
  }

  try {
    const status = await routeEvent(event);
    return res.status(status).end();
  } catch (err) {
    console.error(`❌ Chat events push failed — code: ${describeError(err)}`);
    return res.status(500).end();
  }
}

export default { handleChatEventsPush };
