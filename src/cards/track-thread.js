/**
 * /track — reading a thread and a space's people
 *
 * Threads are read as a signed-in person, with their own Chat grant — the same
 * rule as recall (src/tools/chat-history.js): the card's requester, else the
 * person who started tracking. Only when that fails, and only in a space whose
 * stored copy is live (listening on, space listed and active), the stored copy
 * is used instead; it has no mentions or sender types, so it is good for
 * activity times and a decision draft, never for a "who has the ball" guess.
 *
 * Space members come from members.list as the app (chat.bot) — no new scope.
 *
 * Logs carry codes and counts only: never names, ids of threads or messages,
 * or message text.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from '../tools/google-docs.js';
import { hasChatScopes, isInsufficientScopeError } from '../tools/chat-history.js';
import { resolveSenderNames } from '../tools/directory-names.js';
import { isListenSpace, listenReady } from '../chat-listen/config.js';
import { getListenSpace, listThreadMessages } from '../database/chat-listen-store.js';
import { listHumanMembers } from './chat-api.js';
import { realPeople } from './people.js';

const MAX_THREAD_MESSAGES = 100;
/** How far back to look when a thread cannot say what a card is about. */
export const RECENT_MESSAGES = 5;

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/** A Chat API message → the shape the /track rules read. */
export function normalizeMessage(m) {
  const mentions = [];
  let mentionsAll = false;
  for (const a of m?.annotations || []) {
    const user = a?.type === 'USER_MENTION' ? a.userMention?.user : null;
    if (!user?.name) continue;
    if (user.name === 'users/all') { mentionsAll = true; continue; }
    if (user.type === 'BOT' || mentions.some(x => x.chatUserId === user.name)) continue;
    mentions.push({ chatUserId: user.name, displayName: user.displayName || null });
  }
  return {
    name: m?.name || null,
    senderChatId: m?.sender?.name || null,
    senderName: m?.sender?.displayName || null,
    senderType: m?.sender?.type || 'HUMAN',
    mentions,
    mentionsAll,
    text: m?.text || m?.argumentText || '',
    at: m?.createTime || null
  };
}

async function userChat(userId) {
  return google.chat({ version: 'v1', auth: await getUserOAuth2Client(userId) });
}

/** Is the stored copy of this space live and allowed to be read? */
export async function storedCopyLive(spaceName) {
  if (!listenReady() || !isListenSpace(spaceName)) return false;
  try {
    const row = await getListenSpace(spaceName);
    return row?.status === 'active';
  } catch {
    return false;
  }
}

async function readAsUser(spaceName, threadName, userId, pageSize) {
  if (!userId) return { ok: false, code: 'no_user' };
  const scopes = await hasChatScopes(userId);
  if (!scopes.ok) return { ok: false, code: 'needs_reconsent' };
  const chat = await userChat(userId);
  const messages = [];
  let pageToken;
  do {
    const res = await chat.spaces.messages.list({
      parent: spaceName,
      filter: `thread.name = ${threadName}`,
      pageSize: Math.min(pageSize, MAX_THREAD_MESSAGES),
      pageToken
    });
    for (const m of res.data?.messages || []) messages.push(normalizeMessage(m));
    pageToken = messages.length < pageSize ? res.data?.nextPageToken : undefined;
  } while (pageToken);
  return { ok: true, via: 'user', messages: messages.slice(0, pageSize) };
}

/**
 * A thread's messages, oldest first, with sender names filled in.
 * @param {Object} p
 * @param {string} p.spaceName
 * @param {string} p.threadName
 * @param {number[]} p.userIds - whose grant to try, in order
 * @param {number} [p.pageSize]
 * @returns {Promise<{ok: true, via: 'user'|'stored', messages: Object[]}|{ok: false, code: string}>}
 */
export async function readThread({ spaceName, threadName, userIds = [], pageSize = MAX_THREAD_MESSAGES }) {
  let code = 'no_user';
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    try {
      const read = await readAsUser(spaceName, threadName, userId, pageSize);
      if (read.ok) {
        await fillNames(read.messages, userId);
        return read;
      }
      code = read.code;
    } catch (err) {
      code = isInsufficientScopeError(err) ? 'needs_reconsent' : `read_failed_${codeOf(err)}`;
    }
  }

  if (await storedCopyLive(spaceName)) {
    try {
      const rows = await listThreadMessages(spaceName, threadName, pageSize);
      return {
        ok: true,
        via: 'stored',
        messages: rows.map(r => ({
          name: r.message_name, senderChatId: r.sender_user_id, senderName: null, senderType: null,
          mentions: [], mentionsAll: false, text: r.text || '', at: r.create_time
        }))
      };
    } catch (err) {
      code = `stored_failed_${codeOf(err)}`;
    }
  }
  console.warn(`⚠️  Track thread read failed — code: ${code}`);
  return { ok: false, code };
}

/**
 * The newest messages in a space or DM, newest first — for the case a thread
 * cannot answer: a DM where every message is its own thread, or a trigger that
 * started the thread it is in. Read as the person who asked, like readThread.
 *
 * @param {Object} p
 * @param {string} p.spaceName
 * @param {number[]} p.userIds - whose grant to try, in order
 * @param {number} [p.limit]
 * @returns {Promise<{ok: true, via: 'user', messages: Object[]}|{ok: false, code: string}>}
 */
export async function readRecent({ spaceName, userIds = [], limit = RECENT_MESSAGES }) {
  const wanted = Math.min(Math.max(1, limit), MAX_THREAD_MESSAGES);
  let code = 'no_user';
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    try {
      if (!(await hasChatScopes(userId)).ok) {
        code = 'needs_reconsent';
        continue;
      }
      const chat = await userChat(userId);
      const res = await chat.spaces.messages.list({
        parent: spaceName,
        pageSize: wanted,
        orderBy: 'createTime desc'
      });
      const messages = (res.data?.messages || []).map(normalizeMessage);
      await fillNames(messages, userId);
      // Newest first, whatever the API returned in.
      messages.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      return { ok: true, via: 'user', messages: messages.slice(0, wanted) };
    } catch (err) {
      code = isInsufficientScopeError(err) ? 'needs_reconsent' : `read_failed_${codeOf(err)}`;
    }
  }
  console.warn(`⚠️  Recent message read failed — code: ${code}`);
  return { ok: false, code };
}

/** The ask: the first message of the thread. */
export async function readAsk({ spaceName, threadName, userIds }) {
  const read = await readThread({ spaceName, threadName, userIds, pageSize: 1 });
  if (!read.ok) return read;
  const ask = read.messages[0];
  return ask ? { ok: true, ask } : { ok: false, code: 'no_messages' };
}

async function fillNames(messages, userId) {
  const senders = messages
    .filter(m => m.senderChatId && !m.senderName)
    .map(m => ({ name: m.senderChatId, type: m.senderType || 'HUMAN' }));
  if (!senders.length) return;
  const names = await resolveSenderNames(senders, { userId }).catch(() => new Map());
  for (const m of messages) if (!m.senderName) m.senderName = names.get(m.senderChatId) || null;
}

/**
 * The people in a space who can hold part of an "everyone" ask: human members
 * minus `exclude` (the requester), the listener account and @all, with names.
 * @returns {Promise<{ok: boolean, people: Array<{chatUserId: string, name: string|null}>, code?: string}>}
 */
export async function listSpaceHumans(spaceName, { exclude = [], lookupAsUserId = null } = {}) {
  let members;
  try {
    members = await listHumanMembers(spaceName);
  } catch (err) {
    console.warn(`⚠️  Track member list failed — code: ${codeOf(err)}`);
    return { ok: false, people: [], code: `members_failed_${codeOf(err)}` };
  }
  const candidates = members.filter(m => !exclude.includes(m.chatUserId));
  const real = await realPeople(candidates, lookupAsUserId);
  const names = await resolveSenderNames(
    real.map(r => ({ name: r.chatUserId, displayName: r.displayName || undefined, type: 'HUMAN' })),
    { userId: lookupAsUserId }
  ).catch(() => new Map());
  console.log(`🗂️  Track member list — members: ${members.length}, people: ${real.length}`);
  return { ok: true, people: real.map(r => ({ chatUserId: r.chatUserId, name: r.displayName || names.get(r.chatUserId) || null })) };
}
