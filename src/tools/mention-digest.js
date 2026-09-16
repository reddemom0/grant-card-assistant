/**
 * "What have I been tagged in?" — a digest of Chat messages aimed at the asker
 *
 * Reads as the asking person, like read_chat_space_history, and reuses that
 * module's scope check and fixed sentences rather than restating them. This tool
 * gathers; it does not judge. Whether something is handled or still open, and
 * what the action point is, is left to the model — which can read the message
 * text, where a rule cannot.
 *
 * The tool discovers the person's spaces itself. Oracle must never ask which
 * spaces to look in, and there is no input here that would let it.
 */

import { google } from 'googleapis';
import { query } from '../database/connection.js';
import { getUserOAuth2Client } from './google-docs.js';
import {
  hasChatScopes, hubSignInUrl, isInsufficientScopeError, threadLink, MESSAGES
} from './chat-history.js';

const DEFAULT_WINDOW_DAYS = 7;
const MAX_MESSAGES = 500;      // total scanned across all spaces
const MAX_SPACES = 30;         // Space carries no lastActiveTime, so this is a flat cap
const API_PAGE_SIZE = 100;

/**
 * The digest is personal, so it is refused anywhere other people can read it.
 */
export const DIGEST_MESSAGES = {
  sharedSpace: 'Ask me that in a direct message — your digest is private.',
  unknownChatUser:
    "Message me once in Google Chat and I'll be able to build this — I need to know which Chat account is yours."
};

/**
 * Timezone for resolving "yesterday" and friends.
 *
 * Nothing in this system stores a per-user timezone and no current date reaches
 * the model, so the model cannot turn "yesterday" into a boundary itself. This
 * is where that resolution lives; America/Vancouver matches the only timezone
 * the codebase already assumes (src/api/lead-gen.js).
 */
const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || 'America/Vancouver';

/**
 * Midnight in `tz` on the day `daysAgo` days back from now, as a real Date.
 *
 * Done by formatting in the target zone and re-parsing with its offset, so it
 * stays correct across DST without pulling in a date library.
 */
function zonedStartOfDay(daysAgo, tz = DEFAULT_TZ) {
  const target = new Date(Date.now() - daysAgo * 86400000);
  const [{ value: y }, , { value: m }, , { value: d }] = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(target);

  // Offset for that zone at that moment, e.g. "-07:00".
  const offsetName = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(target).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const offset = offsetName.replace('GMT', '') || '+00:00';

  return new Date(`${y}-${m}-${d}T00:00:00${offset}`);
}

/**
 * Turn a plain-language period into a window.
 * @returns {{since: Date, until: Date|null, label: string}}
 */
export function resolvePeriod(period, tz = DEFAULT_TZ) {
  switch (String(period || '').toLowerCase()) {
    case 'today':
      return { since: zonedStartOfDay(0, tz), until: null, label: 'today' };
    case 'yesterday':
      return { since: zonedStartOfDay(1, tz), until: zonedStartOfDay(0, tz), label: 'yesterday' };
    case 'this_week':
    case 'this week':
      return { since: zonedStartOfDay(7, tz), until: null, label: 'the last 7 days' };
    default:
      return {
        since: new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000),
        until: null,
        label: `the last ${DEFAULT_WINDOW_DAYS} days`
      };
  }
}

/** Which Chat account belongs to the asker. */
async function resolveChatUserId(userId, chatContext) {
  // In Chat the id is in the request itself — no lookup, works the first time.
  if (chatContext?.senderChatId) {
    // Remember it so the Hub can use it later. Fire-and-forget: a failed write
    // costs a lookup next time, not the answer now.
    query('UPDATE users SET chat_user_id = $1 WHERE id = $2 AND chat_user_id IS DISTINCT FROM $1',
      [chatContext.senderChatId, userId])
      .catch(err => console.warn(`⚠️  Could not store chat_user_id: ${err.message}`));
    return chatContext.senderChatId;
  }

  const result = await query('SELECT chat_user_id FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.chat_user_id || null;
}

const spaceTypeOf = (space) => {
  if (space?.singleUserBotDm === true) return 'oracle_dm';
  const t = space?.spaceType || space?.type;
  if (t === 'DIRECT_MESSAGE' || t === 'DM') return 'dm';
  if (t === 'GROUP_CHAT') return 'group_dm';
  return 'space';
};

/** True when this message @mentions exactly this person (never @all). */
function mentionsUser(message, chatUserId) {
  return (message.annotations || []).some(a =>
    a?.type === 'USER_MENTION' && a?.userMention?.user?.name === chatUserId
  );
}

/**
 * build_mention_digest
 *
 * @param {Object} input - model-supplied: period, since, until
 * @param {Object} ctx - server-supplied: userId, chatContext. NEVER from input.
 */
export async function buildMentionDigest(input = {}, ctx = {}) {
  const { userId, chatContext } = ctx;

  if (!userId || !chatContext?.surface || chatContext.surface === 'none') {
    return { success: false, error: MESSAGES.noContext };
  }

  // Personal by definition: never in a room where others can read it.
  if (chatContext.surface === 'chat_space') {
    return { success: false, error: DIGEST_MESSAGES.sharedSpace };
  }

  const scopeCheck = await hasChatScopes(userId);
  if (!scopeCheck.ok) {
    return { success: false, needs_reconsent: true, error: MESSAGES.needsReconsent(hubSignInUrl()) };
  }

  const chatUserId = await resolveChatUserId(userId, chatContext);
  if (!chatUserId) {
    return { success: false, error: DIGEST_MESSAGES.unknownChatUser };
  }

  const period = resolvePeriod(input.period);
  const since = input.since ? new Date(input.since) : period.since;
  const until = input.until ? new Date(input.until) : period.until;
  const windowLabel = (input.since || input.until) ? 'the window you gave' : period.label;

  const filter = [
    `create_time > "${since.toISOString()}"`,
    ...(until ? [`create_time < "${until.toISOString()}"`] : [])
  ].join(' AND ');

  let chat;
  try {
    chat = google.chat({ version: 'v1', auth: await getUserOAuth2Client(userId) });
  } catch (err) {
    return { success: false, error: MESSAGES.needsReconsent(hubSignInUrl()), detail: err.message };
  }

  try {
    // 1. The person's own spaces. This is why Oracle never has to ask.
    const spaces = [];
    let pageToken;
    let spacesSkipped = 0;

    do {
      const res = await chat.spaces.list({ pageSize: 100, pageToken });
      for (const space of res.data.spaces || []) {
        if (spaceTypeOf(space) === 'oracle_dm') continue;   // not their conversation with me
        if (spaces.length >= MAX_SPACES) { spacesSkipped++; continue; }
        spaces.push(space);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    // 2. One pass per space, collecting what was aimed at this person.
    const items = [];
    let scanned = 0;
    let truncated = false;

    for (const space of spaces) {
      if (truncated) break;

      const kind = spaceTypeOf(space);
      const res = await chat.spaces.messages.list({
        parent: space.name,
        filter,
        pageSize: API_PAGE_SIZE,
        orderBy: 'createTime DESC'
      });

      const messages = res.data.messages || [];
      scanned += messages.length;
      if (scanned >= MAX_MESSAGES) truncated = true;

      for (const m of messages) {
        const fromMe = m.sender?.name === chatUserId;
        if (fromMe) continue;                                    // their own messages are not action points

        // A 1:1 DM is addressed to them by definition; anywhere else, only an
        // explicit @mention of THEM counts. @all cannot match an id, so it is
        // excluded by the same comparison.
        const relevant = kind === 'dm' ? true : mentionsUser(m, chatUserId);
        if (!relevant) continue;

        const threadName = m.thread?.name || `${space.name}/dm`;
        const time = m.createTime;

        // Did they answer in that thread afterwards? Computed from the messages
        // already fetched, so it costs nothing extra — and is therefore only as
        // complete as the window.
        const replied = messages.some(other =>
          other.sender?.name === chatUserId &&
          (other.thread?.name || `${space.name}/dm`) === threadName &&
          new Date(other.createTime) > new Date(time)
        );

        items.push({
          // Sender resolved to a real name below, in one batch for the request.
          _sender: m.sender || null,
          where: kind === 'dm' ? null : (space.displayName || space.name),
          where_type: kind,
          from: m.sender?.displayName || null,
          time,
          text: m.text || '',
          thread_link: threadLink(space.name, m.thread?.name),
          replied
        });
      }
    }

    // A digest is a list of people who are waiting on you, so the name is the
    // load-bearing part. One batched resolution for the whole digest; it never
    // blocks, and an unresolved sender gets an honest label instead of "Unknown".
    const { resolveSenderNames, FALLBACKS } = await import('./directory-names.js');
    const names = await resolveSenderNames(items.map(i => i._sender).filter(Boolean))
      .catch(err => { console.warn(`⚠️  Sender names unresolved: ${err.message}`); return new Map(); });

    for (const item of items) {
      item.from = item.from || names.get(item._sender?.name) || FALLBACKS.external;
      if (item.where_type === 'dm') item.where = `DM with ${item.from}`;
      delete item._sender;
    }

    // 3. Group by thread/conversation, newest group first.
    const groups = new Map();
    for (const item of items) {
      const key = `${item.where}|${item.thread_link || ''}`;
      if (!groups.has(key)) {
        groups.set(key, { where: item.where, where_type: item.where_type, thread_link: item.thread_link, messages: [] });
      }
      groups.get(key).messages.push({
        from: item.from, time: item.time, text: item.text, replied: item.replied
      });
    }

    const threads = [...groups.values()].map(g => ({
      ...g,
      messages: g.messages.sort((a, b) => new Date(a.time) - new Date(b.time)),
      replied: g.messages.some(m => m.replied)
    }));

    return {
      success: true,
      window: { since: since.toISOString(), until: until ? until.toISOString() : null, described_as: windowLabel, timezone: DEFAULT_TZ },
      spaces_scanned: spaces.length,
      thread_count: threads.length,
      message_count: items.length,
      ...(truncated ? {
        truncated: true,
        truncation_note: `Stopped after scanning ${MAX_MESSAGES} messages, so this digest may be incomplete. Say so.`
      } : {}),
      ...(spacesSkipped > 0 ? {
        spaces_skipped: spacesSkipped,
        spaces_skipped_note: `${spacesSkipped} more space(s) were not scanned (limit ${MAX_SPACES}). Say so.`
      } : {}),
      guidance: 'These are messages addressed to this person that they have not obviously handled. `replied: true` means they posted in that thread afterwards — it does not prove the matter is closed. Judge from the text what the action point is, and do not mark anything still open with a ✅.',
      threads
    };
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return { success: false, needs_reconsent: true, error: MESSAGES.needsReconsent(hubSignInUrl()) };
    }
    console.error('❌ build_mention_digest failed:', err.message);
    return { success: false, error: `Could not build the digest: ${err.message}` };
  }
}
