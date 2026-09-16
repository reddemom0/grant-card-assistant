/**
 * Read a Google Chat space's recent history — as the person asking
 *
 * Oracle's own identity (the chat.bot service account) is never used here. Every
 * read goes through the asker's OAuth token, so recall is bounded by what that
 * person can already see in Chat. The privacy rules below are enforced in this
 * file, not asked of the model.
 */

import { google } from 'googleapis';
import { query } from '../database/connection.js';
import { getUserOAuth2Client } from './google-docs.js';

const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly'
];

/** Defaults and limits, enforced here rather than trusted to the model. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_MESSAGES = 500;
const API_PAGE_SIZE = 200;          // the API allows 1000; smaller pages fail sooner
const MIN_FILTERED_RESULTS = 20;    // below this, hand back the whole window instead

/** The fixed sentences. Each answers one situation and says nothing more. */
export const MESSAGES = {
  needsReconsent: (hubUrl) =>
    `I need one more permission to read Chat history. Sign in again at the Hub: ${hubUrl} — it takes a few seconds.`,
  otherSpace:
    "Ask me that in a direct message — I don't share one space's content in another.",
  notAMember:
    'I can only read spaces you\'re a member of.',
  noSpace:
    'Tell me which space to look in — I need its name.',
  noContext:
    'I can only read Chat history for a signed-in person in Chat or the Hub.'
};

export function hubSignInUrl() {
  const base = process.env.PUBLIC_URL || 'https://grant-card-assistant-production.up.railway.app';
  return `${base}/login`;
}

// ============================================================================
// SCOPES
// ============================================================================

/**
 * Does this user's Google grant include Chat read access?
 *
 * Stored scopes answer instantly. NULL means "not known yet" — a user who last
 * signed in before the column existed — and is resolved once against Google's
 * tokeninfo endpoint, then written back. Treating NULL as "no" would tell the
 * whole team to sign in again on day one.
 *
 * @returns {Promise<{ok: boolean, missing: string[]}>}
 */
export async function hasChatScopes(userId) {
  const result = await query('SELECT google_granted_scopes FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) return { ok: false, missing: CHAT_SCOPES };

  let granted = result.rows[0].google_granted_scopes;

  if (!granted) {
    granted = await lookupAndBackfillScopes(userId);
    if (granted === null) return { ok: false, missing: CHAT_SCOPES };
  }

  const held = new Set(String(granted).split(/\s+/).filter(Boolean));
  const missing = CHAT_SCOPES.filter(s => !held.has(s));
  return { ok: missing.length === 0, missing };
}

/**
 * Ask Google what this token actually carries, and remember the answer.
 * Returns null when it cannot be determined.
 */
async function lookupAndBackfillScopes(userId) {
  try {
    const auth = await getUserOAuth2Client(userId);
    const { token } = await auth.getAccessToken();
    if (!token) return null;

    const info = await auth.getTokenInfo(token);
    const scopes = (info.scopes || []).join(' ');

    await query('UPDATE users SET google_granted_scopes = $1 WHERE id = $2', [scopes, userId])
      .catch(err => console.warn(`⚠️  Could not backfill granted scopes: ${err.message}`));

    return scopes;
  } catch (err) {
    console.warn(`⚠️  Could not read token info for user ${userId}: ${err.message}`);
    return null;
  }
}

/** Reuses the shape google-sheets.js and google-calendar.js already match on. */
export function isInsufficientScopeError(err) {
  const code = err?.code;
  const msg = String(err?.message ?? '');
  if (code === 403 || code === '403') {
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) return true;
  }
  return /ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg);
}

export function isPermissionError(err) {
  const code = err?.code ?? err?.response?.status;
  return code === 403 || code === '403' || code === 404 || code === '404';
}

// ============================================================================
// LOOSE TOPIC MATCHING
// ============================================================================

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'about', 'what', 'was', 'were', 'did', 'we', 'i', 'is', 'are', 'that', 'this',
  'it', 'be', 'been', 'our', 'their', 'from', 'by', 'at', 'as', 'any', 'all',
  // How people phrase a recall question — never the topic of one.
  'say', 'said', 'saying', 'tell', 'told', 'discuss', 'discussed', 'discussion',
  'talk', 'talked', 'mention', 'mentioned', 'decide', 'decided', 'decision',
  'happen', 'happened', 'anyone', 'someone', 'message', 'messages', 'space',
  'chat', 'thread', 'last', 'recent', 'recently'
]);

/**
 * Reduce a word to a stem crude enough to match its relatives.
 *
 * Deliberately blunt: "eligibility" and "eligible" must both match "eligib", and
 * "changed"/"changes"/"changing" must all match "chang". Precision is not the
 * goal — a near-miss that returns a few extra messages costs the reader nothing,
 * while a miss that returns none costs them the answer.
 */
export function stemWord(word) {
  let w = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length <= 4) return w;

  // Longest first, so "eligibility" loses "ibility" rather than "ity". The
  // -ible/-able pair matters more than it looks: without it "eligible" stems to
  // itself and would NOT match the word "eligibility", since matching is
  // substring-based. Both must land on "elig".
  for (const suffix of ['ibility', 'ability', 'ization', 'isation', 'ements', 'ement',
    'ations', 'ation', 'ible', 'able', 'ingly', 'ings', 'ing', 'edly', 'ies', 'ied',
    'ily', 'ely', 'ers', 'er', 'ed', 'es', 'ly', 's']) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, w.length - suffix.length);
      break;
    }
  }
  return w;
}

/** Query → the stems worth matching on. */
export function queryStems(queryText) {
  return [...new Set(
    String(queryText || '')
      .split(/\s+/)
      .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
      .map(stemWord)
      .filter(Boolean)
  )];
}

/** True when any stem appears anywhere in the text — partial words included. */
export function matchesQuery(text, stems) {
  if (stems.length === 0) return true;
  const haystack = String(text || '').toLowerCase();
  return stems.some(stem => haystack.includes(stem));
}

// ============================================================================
// THE TOOL
// ============================================================================

/**
 * Resolve the space to read, applying the surface rules.
 *
 * @returns {Promise<{spaceName?: string, spaceLabel?: string, refusal?: string}>}
 */
async function resolveTargetSpace(chat, requested, chatContext) {
  const { surface, spaceName: currentSpace, spaceDisplayName } = chatContext;

  // In a shared space Oracle reads that space and nothing else. Content from one
  // space must not surface in another, so this is a refusal, not a filter.
  if (surface === 'chat_space') {
    if (!requested) return { spaceName: currentSpace, spaceLabel: spaceDisplayName || currentSpace };

    const wantsCurrent = requested === currentSpace
      || (spaceDisplayName && requested.trim().toLowerCase() === spaceDisplayName.trim().toLowerCase());

    return wantsCurrent
      ? { spaceName: currentSpace, spaceLabel: spaceDisplayName || currentSpace }
      : { refusal: MESSAGES.otherSpace };
  }

  // A DM or the Hub: any space the asker belongs to. Which one must be named.
  if (!requested) return { refusal: MESSAGES.noSpace };
  if (/^spaces\//.test(requested)) return { spaceName: requested, spaceLabel: requested };

  // spaces.list returns only spaces this user is in, so a miss here IS a
  // membership answer — which is why it says nothing more specific.
  const wanted = requested.trim().toLowerCase();
  let pageToken;
  do {
    const res = await chat.spaces.list({ pageSize: 100, pageToken });
    for (const space of res.data.spaces || []) {
      if ((space.displayName || '').trim().toLowerCase() === wanted) {
        return { spaceName: space.name, spaceLabel: space.displayName };
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return { refusal: MESSAGES.notAMember };
}

/**
 * read_chat_space_history
 *
 * @param {Object} input - model-supplied: space, query, since, until
 * @param {Object} ctx - server-supplied: userId, chatContext. NEVER from input.
 */
export async function readChatSpaceHistory(input = {}, ctx = {}) {
  const { userId, chatContext } = ctx;

  // Surface and space id come from the verified request, never from the model.
  // Anything the model put in input under those names is ignored by construction:
  // it is not read here.
  if (!userId || !chatContext?.surface || chatContext.surface === 'none') {
    return { success: false, error: MESSAGES.noContext };
  }

  const scopeCheck = await hasChatScopes(userId);
  if (!scopeCheck.ok) {
    return { success: false, needs_reconsent: true, error: MESSAGES.needsReconsent(hubSignInUrl()) };
  }

  let chat;
  try {
    chat = google.chat({ version: 'v1', auth: await getUserOAuth2Client(userId) });
  } catch (err) {
    return { success: false, error: MESSAGES.needsReconsent(hubSignInUrl()), detail: err.message };
  }

  try {
    const target = await resolveTargetSpace(chat, input.space, chatContext);
    if (target.refusal) return { success: false, error: target.refusal };

    const since = input.since ? new Date(input.since) : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000);
    const until = input.until ? new Date(input.until) : null;
    const usedDefaultWindow = !input.since && !input.until;

    const filter = [
      `create_time > "${since.toISOString()}"`,
      ...(until ? [`create_time < "${until.toISOString()}"`] : [])
    ].join(' AND ');

    // Collect the window first, then filter locally: the Chat API can filter by
    // time and thread but NOT by text, so a topic search has to happen here.
    const collected = [];
    let pageToken;
    let capped = false;

    do {
      const res = await chat.spaces.messages.list({
        parent: target.spaceName,
        filter,
        pageSize: API_PAGE_SIZE,
        orderBy: 'createTime DESC',
        pageToken
      });

      for (const m of res.data.messages || []) {
        if (collected.length >= MAX_MESSAGES) { capped = true; break; }
        collected.push({
          // Resolved to a real name after the loop, in one batch.
          _sender: m.sender || null,
          sender: m.sender?.displayName || null,
          time: m.createTime,
          text: m.text || '',
          thread_link: threadLink(target.spaceName, m.thread?.name)
        });
      }

      pageToken = capped ? null : res.data.nextPageToken;
    } while (pageToken);

    // Names, in one batch for the whole window: "Unknown asked about the budget"
    // is not an answer. Never blocks — an unresolved sender gets an honest label.
    const { resolveSenderNames } = await import('./directory-names.js');
    const names = await resolveSenderNames(collected.map(c => c._sender).filter(Boolean))
      .catch(err => { console.warn(`⚠️  Sender names unresolved: ${err.message}`); return new Map(); });

    for (const c of collected) {
      c.sender = c.sender || names.get(c._sender?.name) || 'someone outside Granted';
      delete c._sender;
    }

    // Loose filtering: stems, partial words, any-term match. If it leaves too
    // little to judge from, hand back the whole window and say it is unfiltered
    // rather than pretending the topic was absent — a thin filtered result is
    // usually the matcher's failure, not the space's.
    const stems = queryStems(input.query);
    let messages = collected;
    let filtered = false;
    let filterNote = null;

    if (stems.length > 0) {
      const matched = collected.filter(m => matchesQuery(m.text, stems));
      if (matched.length >= MIN_FILTERED_RESULTS) {
        messages = matched;
        filtered = true;
      } else {
        filterNote = `Filtering for "${input.query}" left only ${matched.length} message(s), so this is the whole ${usedDefaultWindow ? `${DEFAULT_WINDOW_DAYS}-day ` : ''}window unfiltered — judge relevance yourself.`;
      }
    }

    return {
      success: true,
      space: target.spaceLabel,
      window: {
        since: since.toISOString(),
        until: until ? until.toISOString() : null,
        defaulted: usedDefaultWindow ? `${DEFAULT_WINDOW_DAYS} days` : null
      },
      count: messages.length,
      filtered,
      ...(filterNote ? { filter_note: filterNote } : {}),
      ...(capped ? {
        truncated: true,
        truncation_note: `Only the ${MAX_MESSAGES} most recent messages in this window were read. Tell the user there may be older messages you did not see.`
      } : {}),
      messages
    };
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return { success: false, needs_reconsent: true, error: MESSAGES.needsReconsent(hubSignInUrl()) };
    }
    if (isPermissionError(err)) {
      // Deliberately says nothing about whether the space exists.
      return { success: false, error: MESSAGES.notAMember };
    }
    console.error('❌ read_chat_space_history failed:', err.message);
    return { success: false, error: `Could not read Chat history: ${err.message}` };
  }
}

/**
 * Best-effort permalink. The Chat API exposes no permalink field, so this is
 * built from ids and may not resolve for every space type.
 */
export function threadLink(spaceName, threadName) {
  const space = String(spaceName || '').split('/')[1];
  const thread = String(threadName || '').split('/')[3];
  if (!space) return null;
  return thread
    ? `https://chat.google.com/room/${space}/${thread}`
    : `https://chat.google.com/room/${space}`;
}
