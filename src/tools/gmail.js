/**
 * Gmail reader — reads a user's mail AS THAT USER (their own OAuth grant via
 * getUserOAuth2Client), and can create a DRAFT reply in an existing thread.
 *
 * HARD RULE: THIS MODULE HAS NO SEND PATH. The only Gmail methods it can reach
 * are the five in GMAIL_METHODS, through a frozen facade; the raw client never
 * leaves this file. gmail.compose — the narrowest scope that allows drafts —
 * would also let a caller send, so the rule is enforced here and by
 * tests/unit/gmail.test.js (a source scan that fails on any send / modify /
 * trash / delete / label-write / settings call), not by Google.
 *
 * Opt-in only: a user must have completed /api/auth/gmail (src/api/gmail-auth.js),
 * which stamps users.gmail_connected_at. Every entry point checks
 * hasGmailScopes first and throws GmailNotConnectedError otherwise.
 *
 * Not an agent tool in Stage 1: no schema in definitions.js, no executor
 * dispatch. The Steph morning brief (Stage 2) is the intended caller.
 *
 * Logs ids and counts only — never a subject, an address or a body.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';

export const GMAIL_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose'
]);

/** The labels the morning brief reads by default. INBOX is the system label id. */
export const DEFAULT_LABELS = Object.freeze(['INBOX', 'Former staff', 'Notifications']);

/** Every Gmail method this module can reach. Nothing else exists on the facade. */
export const GMAIL_METHODS = Object.freeze(['listLabels', 'listThreads', 'getThread', 'createDraft', 'getProfile']);

const MAX_THREADS = 200;
const BODY_CLIP = 20_000;

export class GmailNotConnectedError extends Error {
  constructor(missing, connectUrl) {
    super('Gmail is not connected for this user');
    this.name = 'GmailNotConnectedError';
    this.missing = missing;
    this.connectUrl = connectUrl;
  }
}

export function gmailConnectUrl() {
  const base = process.env.PUBLIC_URL || 'https://grant-card-assistant-production.up.railway.app';
  return `${base}/api/auth/gmail`;
}

// ============================================================================
// SCOPES
// ============================================================================

async function defaultQuery(...args) {
  const { query } = await import('../database/connection.js');
  return query(...args);
}

/**
 * Has this user opted in to Gmail, and does their grant still carry both scopes?
 * Modelled on hasChatScopes (chat-history.js). Both halves must agree: the
 * column records the deliberate opt-in, the scopes prove it wasn't revoked.
 *
 * @returns {Promise<{ok: boolean, missing: string[], connectUrl: string}>}
 */
export async function hasGmailScopes(userId, { query = defaultQuery } = {}) {
  const result = await query(
    'SELECT google_granted_scopes, gmail_connected_at FROM users WHERE id = $1',
    [userId]
  );
  const connectUrl = gmailConnectUrl();
  if (result.rows.length === 0) return { ok: false, missing: [...GMAIL_SCOPES], connectUrl };
  const { google_granted_scopes: granted, gmail_connected_at: connectedAt } = result.rows[0];
  const held = new Set(String(granted || '').split(/\s+/).filter(Boolean));
  const missing = GMAIL_SCOPES.filter(s => !held.has(s));
  return { ok: !!connectedAt && missing.length === 0, missing, connectUrl };
}

// ============================================================================
// CLIENT — the facade is the only way in
// ============================================================================

/**
 * Wrap a googleapis Gmail client so only GMAIL_METHODS can be called. Frozen,
 * and built from named calls rather than a generic proxy, so the source scan
 * sees every Gmail method this module uses.
 */
export function gmailFacade(client) {
  return Object.freeze({
    listLabels: () => client.users.labels.list({ userId: 'me' }),
    listThreads: (params) => client.users.threads.list({ userId: 'me', ...params }),
    getThread: (id) => client.users.threads.get({ userId: 'me', id, format: 'full' }),
    createDraft: (requestBody) => client.users.drafts.create({ userId: 'me', requestBody }),
    getProfile: () => client.users.getProfile({ userId: 'me' })
  });
}

async function connectedFacade(userId, deps = {}) {
  const check = await hasGmailScopes(userId, deps);
  if (!check.ok) throw new GmailNotConnectedError(check.missing, check.connectUrl);
  if (deps.gmail) return deps.gmail;
  const auth = await getUserOAuth2Client(userId);
  return gmailFacade(google.gmail({ version: 'v1', auth }));
}

// ============================================================================
// PARSING (pure)
// ============================================================================

function header(headers, name) {
  const h = (headers || []).find(x => String(x.name).toLowerCase() === name.toLowerCase());
  return h ? String(h.value) : '';
}

/** "Name <a@b.c>" or "a@b.c" → "a@b.c", lowercased. */
export function addressOf(value) {
  const s = String(value || '');
  const angle = s.match(/<([^>]+)>/);
  return (angle ? angle[1] : s).trim().toLowerCase();
}

function decodeBase64Url(data) {
  if (!data) return '';
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Walk a message payload: plain-text body (HTML stripped as fallback) + attachment names. */
export function extractParts(payload) {
  const plain = [];
  const html = [];
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    if (part.filename) {
      attachments.push(part.filename);
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      plain.push(decodeBase64Url(part.body.data));
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html.push(decodeBase64Url(part.body.data));
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  const text = plain.length ? plain.join('\n') : stripHtml(html.join('\n'));
  return { body: text.slice(0, BODY_CLIP), attachments };
}

/** One Gmail message → the shape the brief reads. */
export function parseMessage(msg, userEmail) {
  const headers = msg.payload?.headers || [];
  const from = header(headers, 'From');
  const labels = msg.labelIds || [];
  const { body, attachments } = extractParts(msg.payload);
  return {
    id: msg.id,
    from,
    to: header(headers, 'To'),
    cc: header(headers, 'Cc'),
    reply_to: header(headers, 'Reply-To'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date'),
    message_id: header(headers, 'Message-ID') || header(headers, 'Message-Id'),
    references: header(headers, 'References'),
    internal_date: Number(msg.internalDate) || 0,
    labels,
    is_draft: labels.includes('DRAFT'),
    from_user: labels.includes('SENT') || (!!userEmail && addressOf(from) === String(userEmail).toLowerCase()),
    body,
    attachments
  };
}

/**
 * Has the user replied after the latest inbound message? Pure.
 * Drafts are neither inbound nor replies. No inbound message → replied: null.
 *
 * @param {{messages: Array}} thread - from getThread
 * @returns {{replied: boolean|null, latestInboundAt: number|null, latestReplyAt: number|null, latestInboundId: string|null}}
 */
export function replyState(thread) {
  const real = (thread?.messages || []).filter(m => !m.is_draft);
  const inbound = real.filter(m => !m.from_user);
  const outbound = real.filter(m => m.from_user);
  const latest = (list) => list.reduce((a, m) => (!a || m.internal_date > a.internal_date ? m : a), null);
  const lastIn = latest(inbound);
  const lastOut = latest(outbound);
  if (!lastIn) {
    return { replied: null, latestInboundAt: null, latestReplyAt: lastOut?.internal_date ?? null, latestInboundId: null };
  }
  const replied = !!lastOut && lastOut.internal_date > lastIn.internal_date;
  return {
    replied,
    latestInboundAt: lastIn.internal_date,
    latestReplyAt: lastOut?.internal_date ?? null,
    latestInboundId: lastIn.id
  };
}

// ============================================================================
// READ
// ============================================================================

function sinceEpochSeconds(since) {
  const ms = since instanceof Date ? since.getTime() : typeof since === 'number' ? since : Date.parse(since);
  if (!Number.isFinite(ms)) throw new Error('listThreadsSince: since must be a Date, epoch ms or ISO string');
  return Math.floor(ms / 1000);
}

/**
 * Threads with activity since `since`, across the given labels (read-only).
 * labelIds is an AND in the API, so each label is listed separately and the
 * results merged by thread id. A label name that doesn't exist in this mailbox
 * is reported in missingLabels rather than failing the call.
 *
 * @returns {Promise<{threads: Array<{id, snippet, history_id, labels: string[]}>, missingLabels: string[], truncated: boolean}>}
 */
export async function listThreadsSince(userId, since, { labels = DEFAULT_LABELS, max = MAX_THREADS } = {}, deps = {}) {
  const gmail = await connectedFacade(userId, deps);
  const after = sinceEpochSeconds(since);

  const { data: labelData } = await gmail.listLabels();
  const all = labelData.labels || [];
  const resolved = [];
  const missingLabels = [];
  for (const name of labels) {
    const hit = all.find(l => l.id === name) || all.find(l => String(l.name).toLowerCase() === String(name).toLowerCase());
    if (hit) resolved.push({ name, id: hit.id });
    else missingLabels.push(name);
  }

  const byId = new Map();
  let truncated = false;
  for (const label of resolved) {
    let pageToken;
    do {
      const { data } = await gmail.listThreads({ labelIds: [label.id], q: `after:${after}`, maxResults: 100, pageToken });
      for (const t of data.threads || []) {
        const row = byId.get(t.id) || { id: t.id, snippet: t.snippet || '', history_id: t.historyId || null, labels: [] };
        if (!row.labels.includes(label.name)) row.labels.push(label.name);
        byId.set(t.id, row);
      }
      pageToken = data.nextPageToken;
      if (byId.size >= max) { truncated = !!pageToken || resolved.indexOf(label) < resolved.length - 1; break; }
    } while (pageToken);
    if (byId.size >= max) break;
  }

  const threads = [...byId.values()].slice(0, max);
  console.log(`[gmail] listThreadsSince user ${userId}: ${threads.length} thread(s), ${missingLabels.length} missing label(s)`);
  return { threads, missingLabels, truncated };
}

/**
 * One thread: headers + plain-text bodies; attachments by filename only (their
 * data is never fetched).
 */
export async function getThread(userId, threadId, deps = {}) {
  const gmail = await connectedFacade(userId, deps);
  const userEmail = deps.userEmail || (await gmail.getProfile()).data.emailAddress;
  const { data } = await gmail.getThread(threadId);
  const messages = (data.messages || []).map(m => parseMessage(m, userEmail));
  return { id: data.id, subject: messages[0]?.subject || '', messages };
}

// ============================================================================
// DRAFT (never send)
// ============================================================================

/** Header values must be one line: CR/LF would let text inject headers. */
function oneLine(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeaderWord(value) {
  const v = oneLine(value);
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/**
 * The RFC 2822 reply to `inbound`, base64url-encoded for drafts.create. Pure.
 * @param {object} inbound - a parsed message (parseMessage)
 * @param {string} bodyText - plain text
 */
export function buildReplyRaw(inbound, bodyText) {
  const subject = oneLine(inbound.subject);
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const to = oneLine(inbound.reply_to || inbound.from);
  const messageId = oneLine(inbound.message_id);
  const references = oneLine([inbound.references, messageId].filter(Boolean).join(' '));
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(replySubject)}`,
    ...(messageId ? [`In-Reply-To: ${messageId}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(bodyText).replace(/\r?\n/g, '\r\n')
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a DRAFT reply to the latest inbound message of an existing thread.
 * The user reviews and sends it themselves in Gmail; this never sends.
 *
 * @returns {Promise<{draftId: string, messageId: string|null, threadId: string}>}
 */
export async function createDraftReply(userId, threadId, bodyText, deps = {}) {
  if (typeof bodyText !== 'string' || !bodyText.trim()) throw new Error('createDraftReply: bodyText is required');
  const gmail = await connectedFacade(userId, deps);
  const thread = await getThread(userId, threadId, { ...deps, gmail });
  const { latestInboundId } = replyState(thread);
  const inbound = thread.messages.find(m => m.id === latestInboundId);
  if (!inbound) throw new Error('createDraftReply: thread has no inbound message to reply to');

  const { data } = await gmail.createDraft({ message: { raw: buildReplyRaw(inbound, bodyText), threadId } });
  console.log(`[gmail] draft created for user ${userId} in thread ${threadId}`);
  return { draftId: data.id, messageId: data.message?.id || null, threadId };
}
