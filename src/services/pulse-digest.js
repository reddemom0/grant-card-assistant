/**
 * GetGranted Pulse: weekly digest
 *
 *   Monday 08:00 America/Vancouver   look back at last week (Mon 00:00 – Sun
 *                                    24:00, Vancouver calendar, DST-safe) and
 *                                    DM each digest subscriber one Chat card
 *                                    (cardsV2, as the Chat app): Usage, What
 *                                    clients asked, Most-matched grants, Errors this week,
 *                                    Worth a look, and a button to the
 *                                    Control Centre. Always sends, even in a
 *                                    quiet week.
 *
 * Sources:
 *   usage      gg3 ops DB: distinct chat_turns.user_id, and conversations
 *              whose updated_at falls in the week — each against the week
 *              before. updated_at is the conversation's last activity, so a
 *              chat continued after the week moves out of it on a re-run.
 *   asked      the same conversations as exchanges — each client message with
 *              the assistant's reply — plus each conversation's chat_turns
 *              outcome tally, read by ONE Haiku call into 3–5 themes and one
 *              exchange worth a look. Newest first within ~18k characters.
 *              Messages carry no timestamps, so a chat that began earlier
 *              brings its earlier exchanges with it.
 *   grants     match_results: distinct companies (the user when company_id is
 *              null) per grant, shown rows only — never row counts, since every
 *              re-run repeats them. Names from Oracle's own gg3_grants copy,
 *              joined here in code (different databases).
 *   errors     the Control Centre review queue (Hub DB, cc_review_items,
 *              migration 047): chat and grant-pattern cards flagged in the
 *              week, most flags first, each with its card link.
 *
 * Internal accounts: the Control Centre's list (internal-accounts.js, read as
 * Clerk ids by identity.js internalClerkIds; GG3_INTERNAL_USER_IDS is retired).
 * Usage and grant counts include everyone, each with an "N internal" note. The
 * themes, and the questions stored for the Control Centre, are client
 * conversations only: internal ones never reach the theme call's input. When
 * the list can't be read, the themes are skipped ("internal_accounts_unavailable")
 * rather than run on a mix.
 *
 * Client and assistant text goes to the model only, inside the untrusted-data
 * envelope. What leaves this module is the model's anonymised rewrite of each
 * client question and its own words, checked here not to repeat either side
 * of a chat — never the original text, which is not stored, logged, posted or
 * written.
 *
 * The themes and the rewritten questions — with who asked each — are stored
 * for the Control Centre (cc_digest_themes / cc_digest_questions, migration 046, via
 * src/control-centre/digest-themes.js) from the same model call; never a second.
 * Client questions only, as above. The DM goes once per
 * week: the key weekly_digest:<monday> in pulse_alert_state (migration 040)
 * is claimed before anything is written or sent.
 *
 * Needs GG3_OPS_DB_READONLY_URL and PULSE_DIGEST_SUBSCRIBERS; with either
 * unset it is never scheduled. Dry run: scripts/pulse-digest-check.mjs.
 */

import { gg3OpsQuery, isGg3OpsConfigured } from './gg3-ops-db.js';
import { INTERNAL_COMPANY_IDS } from '../control-centre/internal-accounts.js';
import { transcriptOf, callTool, fetchCompanyName, localDate } from './pulse-roundup.js';
import { cardTitle } from '../control-centre/card-summary.js';
import { cardLink, controlCentreUrl } from '../control-centre/links.js';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from '../claude/tool-output.js';
import { esc, paragraph, decorated, finalizeCards } from '../cards/render.js';
import { recordPulsePost, pulsePostRecorder } from './pulse-posts.js';

export const DIGEST_SUBSCRIBERS_ENV = 'PULSE_DIGEST_SUBSCRIBERS';
export const TOP_GRANTS = 3;
export const TOP_ERRORS = 3;
const TZ = 'America/Vancouver';
const QUESTION_CHARS = 300;
const TEXT_CHARS = 200;
const THEME_NAME_CHARS = 60;
const MODEL_TIMEOUT_MS = 60000;

const codeOf = (err) => err?.status ?? err?.code ?? err?.name ?? 'unknown';
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ============================================================================
// THE WEEK
// ============================================================================

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar arithmetic on YYYY-MM-DD (no time zone involved). */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A real calendar date that is a Monday. */
export function isMonday(ymd) {
  return YMD.test(String(ymd)) && addDays(ymd, 0) === ymd && new Date(`${ymd}T00:00:00Z`).getUTCDay() === 1;
}

/** Monday (YYYY-MM-DD) of the last full Mon–Sun week before `now`, Vancouver calendar. */
export function previousWeek(now = new Date()) {
  const today = localDate(now);
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -sinceMonday - 7);
}

/**
 * The instant Vancouver's day `ymd` starts. Midnight is never inside a DST
 * change (those happen at 02:00), so one correction from the PST guess is exact.
 */
export function vancouverMidnight(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const pstGuess = Date.UTC(y, m - 1, d, 8);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(pstGuess)));
  return new Date(pstGuess - hour * 3600000);
}

/** [start, end) of the week starting on Monday `monday`. 167 or 169 hours in a DST week. */
export function weekBounds(monday) {
  return { start: vancouverMidnight(monday), end: vancouverMidnight(addDays(monday, 7)) };
}


// ============================================================================
// 1. USAGE
// ============================================================================

/**
 * Everyone's chat users and conversations in the week. With `internalIds` (a
 * Set of internal accounts' Clerk ids) also how many of them were internal;
 * `internal` is null without it.
 * @returns {Promise<null|{chatUsers: number, conversations: number, internal: null|{chatUsers: number, conversations: number}}>} null when the ops DB isn't configured
 */
export async function collectUsage({ start, end }, runQuery = gg3OpsQuery, internalIds = null) {
  const ids = [...(internalIds || [])];
  const users = await runQuery(
    `SELECT count(DISTINCT user_id)::int AS n,
            count(DISTINCT user_id) FILTER (WHERE user_id = ANY($3::text[]))::int AS internal
       FROM chat_turns
      WHERE occurred_at >= $1 AND occurred_at < $2`,
    [start, end, ids]
  );
  if (!users.configured) return null;
  const convs = await runQuery(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE user_id = ANY($3::text[]))::int AS internal
       FROM conversations
      WHERE updated_at >= $1 AND updated_at < $2`,
    [start, end, ids]
  );
  if (!convs.configured) return null;
  return {
    chatUsers: users.rows[0]?.n ?? 0,
    conversations: convs.rows[0]?.n ?? 0,
    internal: internalIds
      ? { chatUsers: users.rows[0]?.internal ?? 0, conversations: convs.rows[0]?.internal ?? 0 }
      : null
  };
}

/** ", 5 internal" after a count; '' when none or not known. */
export function internalNote(n) {
  return n ? `, ${n} internal` : '';
}

/** "5 (+2, +67%)"; the % is "—" when the week before was 0. */
export function formatChange(current, prior) {
  const diff = current - prior;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const pct = prior === 0 ? '—' : `${sign}${Math.round(Math.abs(diff) / prior * 100)}%`;
  return `${current} (${sign}${Math.abs(diff)}, ${pct} vs week before)`;
}

// ============================================================================
// 2. WHAT CLIENTS ASKED — and what the assistant actually did
// ============================================================================

export const EXCHANGE_BUDGET_CHARS = 18000;   // ≈4.5k tokens; with system + tool, under ≈6k
const REPLY_CHARS = 600;
const EXCHANGE_OVERHEAD_CHARS = 40;
export const NO_REPLY = 'no reply recorded';
const UNLINKED_FAILED = ['error', 'max_rounds', 'no_answer', 'input_guard'];
const OUTCOME_WORDS = {
  completed: 'completed',
  error: 'error',
  max_rounds: 'hit the step limit',
  no_answer: 'empty reply',
  input_guard: 'blocked by input guard'
};

/** Each client message with the assistant reply right after it — or null when none follows. */
export function exchangesOf(messages) {
  const items = transcriptOf(messages);
  const out = [];
  items.forEach((it, i) => {
    if (it.role !== 'client') return;
    const next = items[i + 1];
    out.push({ question: clip(it.text, QUESTION_CHARS), reply: next?.role === 'assistant' ? clip(next.text, REPLY_CHARS) : null });
  });
  return out;
}

/** {completed: 3, error: 1} → "3 completed, 1 error"; '' when nothing was logged. */
export function tallyText(counts = {}) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, n]) => `${n} ${OUTCOME_WORDS[outcome] || outcome}`)
    .join(', ');
}

/** The newest exchanges that fit the budget — oldest dropped first — numbered 1..n in time order. */
export function fitBudget(exchanges, budget = EXCHANGE_BUDGET_CHARS) {
  const kept = [];
  let used = 0;
  for (let i = exchanges.length - 1; i >= 0; i--) {
    const e = exchanges[i];
    const size = e.question.length + (e.reply ?? NO_REPLY).length + EXCHANGE_OVERHEAD_CHARS;
    if (used + size > budget) break;
    used += size;
    kept.unshift(e);
  }
  return kept.map((e, i) => ({ ...e, id: i + 1 }));
}

/**
 * Exchanges from CLIENT conversations active in the week, oldest conversation
 * first, each conversation with its week's chat_turns outcome tally. Internal
 * accounts' conversations (`internalIds`, a Set of Clerk ids) are counted in
 * `internal` and left out of everything else — their text never reaches the
 * model. Outcomes can't be tied to one question (turn_index doesn't follow
 * message positions and many turns carry no conversation_id), so they travel
 * per conversation, plus one count of client failed turns linked to no
 * conversation. Text stays in memory for the model only.
 * @returns {Promise<null|{exchanges: Object[], total: number, unlinkedFailed: number, internal: {conversations: number, exchanges: number}}>}
 */
export async function collectExchanges({ start, end }, runQuery = gg3OpsQuery, internalIds = new Set()) {
  const isInternal = (userId) => userId != null && internalIds.has(userId);
  const found = await runQuery(
    `SELECT id, user_id, messages
       FROM conversations
      WHERE updated_at >= $1 AND updated_at < $2
      ORDER BY updated_at`,
    [start, end]
  );
  if (!found.configured) return null;
  const internalRows = found.rows.filter(r => isInternal(r.user_id));
  const res = { rows: found.rows.filter(r => !isInternal(r.user_id)) };

  const tallies = new Map();
  const ids = res.rows.map(r => r.id);
  if (ids.length) {
    const t = await runQuery(
      `SELECT conversation_id, outcome, count(*)::int AS n
         FROM chat_turns
        WHERE conversation_id = ANY($3::int[])
          AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY conversation_id, outcome`,
      [start, end, ids]
    );
    for (const r of t.rows || []) {
      const c = tallies.get(r.conversation_id) || {};
      c[r.outcome] = r.n;
      tallies.set(r.conversation_id, c);
    }
  }

  const unlinked = await runQuery(
    `SELECT count(*)::int AS n
       FROM chat_turns
      WHERE conversation_id IS NULL
        AND outcome = ANY($3::text[])
        AND occurred_at >= $1 AND occurred_at < $2
        AND (user_id IS NULL OR NOT (user_id = ANY($4::text[])))`,
    [start, end, UNLINKED_FAILED, [...internalIds]]
  );

  const all = res.rows.flatMap((r, i) => {
    const counts = tallies.get(r.id) || {};
    const turnFailed = UNLINKED_FAILED.some(o => counts[o] > 0);
    return exchangesOf(r.messages).map(e => ({
      ...e, conversation: i + 1, userId: r.user_id ?? null, tally: tallyText(counts), turnFailed
    }));
  });
  return {
    exchanges: fitBudget(all),
    total: all.length,
    unlinkedFailed: unlinked.rows?.[0]?.n ?? 0,
    internal: {
      conversations: internalRows.length,
      exchanges: internalRows.reduce((n, r) => n + exchangesOf(r.messages).length, 0)
    }
  };
}

/** The model's input: exchanges grouped by conversation, each with its outcome tally. */
export function exchangesText({ exchanges, unlinkedFailed = 0 }) {
  const lines = [];
  let conv = null;
  for (const e of exchanges) {
    if (e.conversation !== conv) {
      conv = e.conversation;
      lines.push('', `Conversation ${conv} — turns logged this week: ${e.tally || 'none'}`);
    }
    lines.push(`${e.id}. CLIENT: ${e.question}`, `   REPLY: ${e.reply ?? `(${NO_REPLY})`}`);
  }
  lines.push('', `Failed turns this week not linked to any conversation: ${unlinkedFailed}`);
  return lines.join('\n').trim();
}

export const WORTH_CATEGORIES = {
  failed_reply: 'Reply failed',
  missed_question: 'Missed the question',
  pushed_back: 'Client pushed back',
  handled_well: 'Handled well'
};

const THEMES_TOOL = {
  name: 'weekly_themes',
  description: 'The week\'s client questions grouped into themes, each question rewritten without identifying details, and one exchange worth the team\'s attention.',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short theme name, at most 6 words. No names.' },
            takeaway: { type: 'string', description: 'ONE sentence, at most 25 words, in your own words: what clients wanted and anything notable. No names.' },
            example_id: { type: 'integer', description: 'The id of the exchange whose question best shows this theme.' },
            question_ids: { type: 'array', items: { type: 'integer' }, description: 'Every exchange id in this theme.' }
          },
          required: ['name', 'takeaway', 'example_id', 'question_ids']
        }
      },
      questions: {
        type: 'array',
        description: 'Every CLIENT message, rewritten. Never the reply.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            text: { type: 'string', description: 'The client\'s question with every personal name, company name, email, phone number, website, address and other identifying detail replaced by [name], [company] or [detail]. Keep the meaning; keep grant and program names.' }
          },
          required: ['id', 'text']
        }
      },
      worth_a_look: {
        type: 'object',
        properties: {
          exchange_id: { type: 'integer' },
          category: { type: 'string', enum: Object.keys(WORTH_CATEGORIES) },
          why: { type: 'string', description: 'One sentence, at most 30 words, in your own words, on what the reply actually did. No quotes, no company or person names, no guesses.' }
        },
        required: ['exchange_id', 'category', 'why']
      }
    },
    required: ['themes', 'questions', 'worth_a_look']
  }
};

const THEMES_SYSTEM = [
  'You summarise one week of exchanges between clients and GetGranted\'s AI grant assistant, for the team that runs it.',
  'Each exchange is a CLIENT question and the REPLY the assistant gave, or "(no reply recorded)". Each conversation is headed by the outcomes of its logged turns this week.',
  'The assistant has each client\'s profile (company name, location, industry). A reply that names the client\'s own company or uses their location or industry is expected and correct — never treat it as a hallucination or a problem.',
  'Themes: group the client questions into 3–5 themes (fewer only when there are fewer questions). Every exchange id belongs to exactly one theme. Themes are about what clients asked.',
  'Rewrite EVERY client question with all personal names, company names, emails, phone numbers, websites, addresses and other identifying details replaced by [name], [company] or [detail]. Grant and program names are not identifying — keep them. Never rewrite or include a reply.',
  'Worth a look: pick exactly ONE exchange, in this priority order:',
  '  1. failed_reply — the reply errored, timed out, was empty or refused: "(no reply recorded)", or a conversation whose turns include an error, the step limit, an empty reply or a block by the input guard.',
  '  2. missed_question — the reply missed or dodged the question.',
  '     pushed_back — the client pushed back on the reply.',
  '  3. handled_well — a strong demand signal (ready to apply, asking for help or a call, a clear fit) that the assistant handled well.',
  'Take the highest priority that any exchange meets. failed_reply needs a recorded failure: no reply, or a failed turn in that conversation. The why is one sentence describing what the reply actually did — e.g. "The reply listed three hiring grants but never answered whether the client qualifies." State only what the exchange shows; never guess (no "may", "might", "could", "likely").',
  'Each takeaway is ONE sentence of at most 25 words.',
  'Theme names, takeaways and the why are your own words: never copy the client\'s or the assistant\'s wording, and never include ANY company or person name — not the client\'s, not anyone\'s. Say "the client" or "their company".',
  UNTRUSTED_DATA_INSTRUCTION
].join('\n');

const words = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

/** True when `text` repeats any run of n consecutive words from one of `sources`. */
export function quotesSource(text, sources, n = 8) {
  const w = words(text);
  if (w.length < n) return false;
  const grams = new Set();
  for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(' '));
  for (const s of sources) {
    const sw = words(s);
    for (let i = 0; i + n <= sw.length; i++) if (grams.has(sw.slice(i, i + n).join(' '))) return true;
  }
  return false;
}

const SPECULATIVE = /\b(may|might|could|possibly|perhaps|likely)\b/i;
export const WITHHELD = '(withheld — quoted a chat)';
export const WITHHELD_NAME = '(withheld — named a client)';
export const TAKEAWAY_WORDS = 25;
export const WHY_WORDS = 30;

/**
 * Cut to whole sentences within maxWords — never mid-word or mid-sentence, no
 * "…". A first sentence already over the limit is kept whole: the model was
 * asked for one sentence, and half of one reads worse than a long one.
 */
export function fitSentences(text, maxWords) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const sentences = t.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(x => x.trim()).filter(Boolean) || [];
  const count = (x) => x.split(' ').filter(Boolean).length;
  if (count(t) <= maxWords || sentences.length <= 1) return t;
  let out = sentences[0];
  for (const next of sentences.slice(1)) {
    if (count(`${out} ${next}`) > maxWords) break;
    out = `${out} ${next}`;
  }
  return out;
}

/** A theme name in at most 6 whole words. */
const fitName = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, THEME_NAME_CHARS);

// Words never treated as names even when capitalised mid-sentence.
const NOT_NAMES = new Set(['i', "i'm", "i've", "i'd", "i'll", 'ok', 'okay', 'please', 'thanks', 'thank', 'yes', 'no', 'hi', 'hello', 'hey', 'dear']);
// Generic words in company names that alone identify nobody.
const GENERIC = new Set(['inc', 'ltd', 'llc', 'corp', 'corporation', 'company', 'co', 'the', 'and', 'group', 'services', 'solutions', 'consulting', 'canada', 'canadian', 'limited', 'enterprises', 'holdings', 'technologies', 'international']);

/**
 * Names that must not appear in the digest's own words: profile company names
 * (and their distinctive words), the capitalised words the model's rewrite took
 * out of each question, and the name a reply greets the client by.
 */
export function namesToWithhold(exchanges, rewritten, profileNames = []) {
  const names = new Set();
  const add = (n) => {
    const v = String(n || '').trim().toLowerCase();
    if (v.length >= 3 && !NOT_NAMES.has(v) && !GENERIC.has(v)) names.add(v);
  };
  for (const n of profileNames) {
    add(n);
    for (const w of words(n)) add(w);
  }
  exchanges.forEach((e, i) => {
    const rewrite = rewritten.get(i + 1);
    if (rewrite) {
      const kept = new Set(words(rewrite));
      for (const sentence of e.question.split(/(?<=[.!?])\s+/)) {
        const tokens = sentence.match(/[\p{L}\p{N}'-]+/gu) || [];
        tokens.slice(1).forEach(tok => { if (/^\p{Lu}/u.test(tok) && !kept.has(tok.toLowerCase())) add(tok); });
      }
    }
    for (const m of String(e.reply || '').matchAll(/\b(?:hi|hello|hey|dear|thanks|thank you),?\s+(\p{Lu}[\p{L}'-]+)/giu)) add(m[1]);
  });
  return [...names];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when text contains any of the names as a whole word or phrase. */
export function containsName(text, names) {
  const t = String(text || '');
  return names.some(n => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}($|[^\\p{L}\\p{N}])`, 'iu').test(t));
}

/**
 * The worth-a-look label from what was recorded, not from the model's wording:
 * "Reply failed" only with a recorded failure (no reply, or a failed turn in
 * that conversation). A claimed failure the record doesn't show is a reply
 * that missed; a missing reply under any other category is contradictory.
 */
export function worthLabel(category, exchange) {
  if (!WORTH_CATEGORIES[category]) return null;
  if (exchange.reply === null) return category === 'failed_reply' ? WORTH_CATEGORIES.failed_reply : null;
  if (category === 'failed_reply') return exchange.turnFailed ? WORTH_CATEGORIES.failed_reply : WORTH_CATEGORIES.missed_question;
  return WORTH_CATEGORIES[category];
}

/**
 * Keep only what the exchanges support: ids that exist, each in one theme,
 * leftovers in "Other"; question text only from the rewrite, never the
 * original; nothing that repeats a reply (or, beyond the rewrites, a question)
 * word for word; a worth-a-look reason that states rather than guesses.
 * @param {Object} raw - the tool input
 * @param {Array<{question: string, reply: string|null}>} exchanges - in id order (id = index + 1)
 */
export function cleanThemes(raw, exchanges, { profileNames = [] } = {}) {
  const count = exchanges.length;
  const replies = exchanges.map(e => e.reply).filter(Boolean);
  const chats = [...exchanges.map(e => e.question), ...replies];
  const valid = (id) => Number.isInteger(id) && id >= 1 && id <= count;
  const quoted = (s) => quotesSource(s, chats);

  const rewritten = new Map();
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    if (valid(q?.id) && String(q?.text || '').trim() && !rewritten.has(q.id) && !quotesSource(q.text, replies)) {
      rewritten.set(q.id, clip(q.text, TEXT_CHARS));
    }
  }
  const names = namesToWithhold(exchanges, rewritten, profileNames);
  // A rewrite still carrying a profile company name (or a distinctive word of it) isn't anonymised.
  const profileTerms = namesToWithhold([], new Map(), profileNames);
  for (const [id, text] of rewritten) if (containsName(text, profileTerms)) rewritten.delete(id);
  const own = (s) => (quoted(s) ? WITHHELD : containsName(s, names) ? WITHHELD_NAME : s);
  const textOf = (id) => rewritten.get(id) ?? '(not rewritten — left out)';

  const used = new Set();
  const themes = [];
  for (const t of Array.isArray(raw?.themes) ? raw.themes : []) {
    if (themes.length >= 5) break;
    const ids = [...new Set(Array.isArray(t?.question_ids) ? t.question_ids : [])].filter(id => valid(id) && !used.has(id));
    if (!ids.length || !String(t?.name || '').trim()) continue;
    ids.forEach(id => used.add(id));
    const exampleId = ids.includes(t.example_id) && rewritten.has(t.example_id) ? t.example_id : ids.find(id => rewritten.has(id));
    themes.push({
      name: own(fitName(t.name)),
      takeaway: own(fitSentences(t.takeaway, TAKEAWAY_WORDS)),
      example: exampleId ? textOf(exampleId) : null,
      questions: ids.map(textOf),
      // For the Control Centre's stored copy: each REWRITTEN question with its
      // exchange id (which says who asked). Unrewritten ones are never stored.
      items: ids.filter(id => rewritten.has(id)).map(id => ({ id, text: rewritten.get(id) }))
    });
  }
  const left = Array.from({ length: count }, (_, i) => i + 1).filter(id => !used.has(id));
  if (left.length) {
    themes.push({
      name: 'Other', takeaway: 'Questions not placed in a theme.', example: rewritten.has(left[0]) ? textOf(left[0]) : null,
      questions: left.map(textOf),
      items: left.filter(id => rewritten.has(id)).map(id => ({ id, text: rewritten.get(id) }))
    });
  }

  const w = raw?.worth_a_look;
  const why = fitSentences(w?.why, WHY_WORDS);
  const label = valid(w?.exchange_id) ? worthLabel(w?.category, exchanges[w.exchange_id - 1]) : null;
  const worthALook = label && rewritten.has(w.exchange_id)
    && why && !SPECULATIVE.test(why) && !quoted(why) && !containsName(why, names)
    ? { label, question: textOf(w.exchange_id), why }
    : null;
  return { themes, worthALook };
}

/**
 * The digest's one model call. No exchanges → no call.
 * @param {{exchanges: Object[], unlinkedFailed: number}} asked
 * @returns {Promise<{status: 'none'}|{status: 'ok', themes, worthALook}|{status: 'failed', code: string}>}
 */
export async function summariseExchanges(asked, createMessage, { profileNames = [] } = {}) {
  if (!asked.exchanges.length) return { status: 'none' };
  try {
    const raw = await callTool(createMessage, {
      system: THEMES_SYSTEM,
      user: `This week's exchanges (id. CLIENT / REPLY):\n\n${wrapToolOutput('gg3_conversations', exchangesText(asked))}\n\nCall ${THEMES_TOOL.name} once.`,
      tool: THEMES_TOOL,
      maxTokens: 8000,
      source: 'pulse-digest-themes',
      timeoutMs: MODEL_TIMEOUT_MS
    });
    return { status: 'ok', ...cleanThemes(raw, asked.exchanges, { profileNames }) };
  } catch (err) {
    return { status: 'failed', code: String(codeOf(err)) };
  }
}

// ============================================================================
// 3. GRANTS
// ============================================================================

/**
 * Distinct companies (the user when company_id is null) per grant, shown
 * matches only, most first — everyone's, with how many were internal accounts
 * (an internal company, or with no company an internal Clerk id).
 */
export async function collectGrantMatches({ start, end }, runQuery = gg3OpsQuery, internalIds = null) {
  const res = await runQuery(
    `SELECT grant_id, count(DISTINCT coalesce(company_id::text, 'u:' || user_id))::int AS companies,
            count(DISTINCT coalesce(company_id::text, 'u:' || user_id))
              FILTER (WHERE company_id = ANY($3::int[]) OR (company_id IS NULL AND user_id = ANY($4::text[])))::int AS internal
       FROM match_results
      WHERE shown AND occurred_at >= $1 AND occurred_at < $2
      GROUP BY grant_id
      ORDER BY companies DESC, grant_id`,
    [start, end, INTERNAL_COMPANY_IDS, [...(internalIds || [])]]
  );
  if (!res.configured) return null;
  return res.rows.map(r => ({ grantId: r.grant_id, companies: r.companies, internalCompanies: r.internal ?? 0 }));
}

/**
 * Companies that ran matching in the week — any match row, shown or not —
 * counted the same way (the user when company_id is null). The denominator
 * behind a grant's count: fewer active companies explains most drops. Used by
 * the pulse_stats tool (src/tools/pulse-stats.js); the digest doesn't show it.
 * @returns {Promise<null|number>} null when the ops DB isn't configured
 */
export async function collectMatchingCompanies({ start, end }, runQuery = gg3OpsQuery) {
  const res = await runQuery(
    `SELECT count(DISTINCT coalesce(company_id::text, 'u:' || user_id))::int AS companies
       FROM match_results
      WHERE occurred_at >= $1 AND occurred_at < $2`,
    [start, end]
  );
  if (!res.configured) return null;
  return res.rows[0]?.companies ?? 0;
}

/**
 * A grant's change against the week before, same rules as this week's count:
 * "(+1, +33% vs week before)", "(new this week)" when it had none, "(no change)".
 */
export function grantChange(companies, prior) {
  if (!prior) return '(new this week)';
  if (companies === prior) return '(no change)';
  const diff = companies - prior;
  const sign = diff > 0 ? '+' : '−';
  return `(${sign}${Math.abs(diff)}, ${sign}${Math.round(Math.abs(diff) / prior * 100)}% vs week before)`;
}

/** Each grant with the week before's count beside it (0 when it wasn't matched then). */
export function withPriorWeek(matches, priorMatches) {
  const prior = new Map(priorMatches.map(m => [m.grantId, m.companies]));
  return matches.map(m => ({ ...m, priorCompanies: prior.get(m.grantId) ?? 0 }));
}

/** Names from Oracle's gg3_grants copy; "grant #id" when missing or the lookup fails. */
export async function nameGrants(matches, oracleQuery) {
  const names = new Map();
  if (matches.length) {
    try {
      const r = await oracleQuery('SELECT id, grant_name FROM gg3_grants WHERE id = ANY($1::int[])', [matches.map(m => m.grantId)]);
      for (const row of r.rows) if (String(row.grant_name || '').trim()) names.set(row.id, row.grant_name.trim());
    } catch (err) {
      console.warn(`⚠️  Pulse digest: grant names unavailable — code: ${codeOf(err)}`);
    }
  }
  return matches.map(m => ({ ...m, name: names.get(m.grantId) || `grant #${m.grantId}` }));
}

// ============================================================================
// 4. ERRORS
// ============================================================================

// Hub DB, read-only. A flag counts in the week by when its source happened
// (the AI review's cut, the chat turn), else when it was filed.
export const WEEK_CARDS_SQL = `
  SELECT i.id, i.kind, i.status, i.owner, i.grant_root_id, i.pattern_category, i.chat_turn_ref,
         i.company_id, g.grant_name, count(f.id)::int AS week_flags, i.flag_count
    FROM cc_review_items i
    JOIN cc_review_flags f ON f.item_id = i.id
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.kind IN ('chat', 'grant_pattern')
     AND COALESCE(f.source_created_at, f.created_at) >= $1
     AND COALESCE(f.source_created_at, f.created_at) < $2
   GROUP BY i.id, g.grant_name
   ORDER BY count(f.id) DESC, i.id DESC`;

/**
 * The week's chat and grant-pattern cards from the review queue.
 * @returns {Promise<Array<{id, kind, title, status, owner, weekFlags, totalFlags}>>}
 */
export async function collectQueueIssues(week, runQuery) {
  const r = await runQuery(WEEK_CARDS_SQL, [week.start, week.end]);
  return r.rows.map(row => ({
    id: Number(row.id), kind: row.kind, title: cardTitle(row), status: row.status, owner: row.owner ?? null,
    weekFlags: row.week_flags, totalFlags: row.flag_count
  }));
}

// ============================================================================
// 5. BUILD, POST, TAB
// ============================================================================

/** Company names on file for the week's clients — used only to keep names out of the digest's own words. */
export async function profileCompanyNames(exchanges, fetchProfile) {
  if (!fetchProfile) return [];
  const ids = [...new Set(exchanges.map(e => e.userId).filter(Boolean))];
  const out = [];
  for (const id of ids) {
    const r = await fetchProfile(id).catch(() => null);
    if (r?.companyName) out.push(r.companyName);
  }
  return out;
}

/**
 * Everything the post needs. Writes and sends nothing — the dry run is
 * exactly this. errors is {ok: false, code} when the queue couldn't be read.
 * @param {{monday: string, deps: Object}} args
 */
export async function buildDigest({ monday, deps }) {
  const week = weekBounds(monday);
  const prior = weekBounds(addDays(monday, -7));
  const internalIds = await internalIdsOrNull(deps);
  const usage = await deps.collectUsage(week, internalIds);
  const priorUsage = await deps.collectUsage(prior, internalIds);
  // Without the internal list, client and internal questions can't be told
  // apart: no exchanges are read and the themes say why.
  const asked = internalIds
    ? await deps.collectExchanges(week, internalIds)
    : { exchanges: [], total: 0, unlinkedFailed: 0, internal: null, unavailable: true };
  const matches = await deps.collectGrantMatches(week, internalIds);
  const priorMatches = await deps.collectGrantMatches(prior, internalIds);
  if (!usage || !priorUsage || !asked || !matches || !priorMatches) return null;

  const profileNames = await profileCompanyNames(asked.exchanges, deps.fetchProfile);
  const themes = asked.unavailable
    ? { status: 'failed', code: 'internal_accounts_unavailable' }
    : await summariseExchanges(asked, deps.createMessage, { profileNames });
  return {
    monday,
    sunday: addDays(monday, 6),
    usage,
    priorUsage,
    exchangesTotal: asked.total,
    exchangesRead: asked.exchanges.length,
    // Internal accounts' conversations and questions this week — counted, never read.
    internalAsked: asked.internal ?? null,
    // Who asked each exchange (Clerk id), index = exchange id − 1. Kept for the
    // Control Centre's stored copy; never posted.
    askedBy: asked.exchanges.map(e => e.userId ?? null),
    themes,
    grants: await nameGrants(withPriorWeek(matches, priorMatches), deps.oracleQuery),
    errors: await queueErrors(week, deps)
  };
}

/** The internal accounts' Clerk ids, or null when they can't be read. */
async function internalIdsOrNull(deps) {
  if (!deps.internalIds) return null;
  try {
    return await deps.internalIds();
  } catch (err) {
    console.warn(`⚠️  Pulse digest: internal accounts unavailable — code: ${codeOf(err)}`);
    return null;
  }
}

async function queueErrors(week, deps) {
  try {
    return { ok: true, issues: await deps.collectQueueIssues(week) };
  } catch (err) {
    console.warn(`⚠️  Pulse digest: review queue unavailable — code: ${codeOf(err)}`);
    return { ok: false, code: String(codeOf(err)) };
  }
}

const shortDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const TITLE = 'GetGranted weekly';
const TEST_PREFIX = '🧪 Test — ';

/** What a notification shows for the card. */
export function digestFallback(d, { test = false } = {}) {
  return `${test ? TEST_PREFIX : ''}${TITLE} — ${shortDate(d.monday)} to ${shortDate(d.sunday)}`;
}

/**
 * The DM as one Chat card (cardsV2): a section per part of the digest, one
 * widget per item, a button to the Control Centre. Every piece of text is
 * escaped; the markup is ours.
 */
export function digestCard(d, { test = false, env = process.env } = {}) {
  const line = (html) => paragraph(html);
  const sections = [];

  sections.push({
    header: 'Usage',
    widgets: [
      decorated({ top: 'Chat users', text: esc(formatChange(d.usage.chatUsers, d.priorUsage.chatUsers) + internalNote(d.usage.internal?.chatUsers)) }),
      decorated({ top: 'Conversations', text: esc(formatChange(d.usage.conversations, d.priorUsage.conversations) + internalNote(d.usage.internal?.conversations)) })
    ]
  });

  const asked = [];
  if (d.themes.status === 'none') asked.push(line('No client chats this week.'));
  else if (d.themes.status === 'failed') asked.push(line(esc(`Themes unavailable this week (code: ${d.themes.code}).`)));
  else {
    for (const t of d.themes.themes) {
      const parts = [`<b>${esc(t.name)}</b> (${t.questions.length})`, esc(t.takeaway)];
      if (t.example) parts.push(`<i>"${esc(t.example)}"</i>`);
      asked.push(line(parts.join('<br>')));
    }
    if (d.exchangesTotal > d.exchangesRead) asked.push(line(esc(`Latest ${d.exchangesRead} of ${d.exchangesTotal} exchanges read.`)));
  }
  if (internalAskedText(d)) asked.push(line(esc(internalAskedText(d))));
  sections.push({ header: 'What clients asked', widgets: asked });

  const grants = d.grants.length
    ? d.grants.slice(0, TOP_GRANTS).map(g => line(`${esc(g.name)} — matched to ${matchedText(g)}`))
    : [line('No grant matches this week.')];
  sections.push({ header: 'Most-matched grants', widgets: grants });

  const errors = [];
  if (!d.errors.ok) errors.push(line(esc(`Review queue unavailable (code: ${d.errors.code}).`)));
  else if (!d.errors.issues.length) errors.push(line('No chat or grant-pattern cards flagged this week.'));
  else {
    errors.push(line(`${plural(d.errors.issues.length, 'card')} flagged this week`));
    for (const i of d.errors.issues.slice(0, TOP_ERRORS)) {
      errors.push(line(`<a href="${esc(cardLink(i.id, env))}"><b>${esc(i.title)}</b></a> — ${esc(issueState(i))} — flagged ${plural(i.weekFlags, 'time')} this week`));
    }
  }
  sections.push({ header: 'Errors this week', widgets: errors });

  const w = d.themes.status === 'ok' ? d.themes.worthALook : null;
  sections.push({
    header: 'Worth a look',
    widgets: [line(w ? [`<b>${esc(w.label)}</b>`, `"${esc(w.question)}"`, esc(w.why)].join('<br>') : 'Nothing picked out this week.')]
  });

  sections.push({ widgets: [{ buttonList: { buttons: [{ text: 'Open Control Centre', onClick: { openLink: { url: controlCentreUrl(env) } } }] } }] });

  return finalizeCards([{
    cardId: `pulse-digest-${d.monday}`,
    card: {
      header: { title: `${test ? TEST_PREFIX : ''}${TITLE}`, subtitle: `${shortDate(d.monday)} – ${shortDate(d.sunday)}` },
      sections
    }
  }]);
}

/** "4 companies (2 internal) (+1, +33% vs week before)" */
function matchedText(g) {
  const internal = g.internalCompanies ? ` (${g.internalCompanies} internal)` : '';
  return `${plural(g.companies, 'company', 'companies')}${internal} ${grantChange(g.companies, g.priorCompanies)}`;
}

/** "Internal accounts' 12 questions (3 conversations) left out." — '' when none. */
function internalAskedText(d) {
  const i = d.internalAsked;
  if (!i?.exchanges) return '';
  return `Internal accounts' ${plural(i.exchanges, 'question')} (${plural(i.conversations, 'conversation')}) left out.`;
}

const STATUS_WORDS = { new: 'new', diagnosed: 'diagnosed', in_progress: 'in progress', closed: 'closed' };
const OWNER_WORDS = { client: 'client', research: 'Research', chris: 'Chris', jason: 'Jason', consulting: 'Consulting' };

/** "in progress · Research" — a card's state in words. */
export function issueState(i) {
  return [STATUS_WORDS[i.status] ?? i.status, i.owner ? OWNER_WORDS[i.owner] ?? i.owner : 'no owner yet'].join(' · ');
}

/** The digest as plain text — the dry run's printout and the stored summary. The DM is digestCard. */
export function formatDigest(d, { env = process.env } = {}) {
  const lines = [`📊 GetGranted weekly — ${shortDate(d.monday)} to ${shortDate(d.sunday)}`, ''];

  lines.push('**Usage**');
  lines.push(`• Chat users: ${formatChange(d.usage.chatUsers, d.priorUsage.chatUsers)}${internalNote(d.usage.internal?.chatUsers)}`);
  lines.push(`• Conversations: ${formatChange(d.usage.conversations, d.priorUsage.conversations)}${internalNote(d.usage.internal?.conversations)}`, '');

  lines.push('**What clients asked**');
  if (d.themes.status === 'none') lines.push('No client chats this week.');
  else if (d.themes.status === 'failed') lines.push(`Themes unavailable this week (code: ${d.themes.code}).`);
  else {
    for (const t of d.themes.themes) {
      lines.push(`• ${t.name} (${t.questions.length}) — ${t.takeaway}${t.example ? ` e.g. "${t.example}"` : ''}`);
    }
    if (d.exchangesTotal > d.exchangesRead) lines.push(`(Latest ${d.exchangesRead} of ${d.exchangesTotal} exchanges read.)`);
  }
  if (internalAskedText(d)) lines.push(`(${internalAskedText(d)})`);
  lines.push('');

  lines.push('**Most-matched grants**');
  if (!d.grants.length) lines.push('No grant matches this week.');
  for (const g of d.grants.slice(0, TOP_GRANTS)) lines.push(`• ${g.name} — matched to ${matchedText(g)}`);
  lines.push('');

  lines.push('**Errors this week**');
  if (!d.errors.ok) lines.push(`Review queue unavailable (code: ${d.errors.code}).`);
  else if (!d.errors.issues.length) lines.push('No chat or grant-pattern cards flagged this week.');
  else {
    lines.push(`${plural(d.errors.issues.length, 'card')} flagged this week:`);
    for (const i of d.errors.issues.slice(0, TOP_ERRORS)) {
      lines.push(`• ${i.title} — ${issueState(i)} — flagged ${plural(i.weekFlags, 'time')} this week — ${cardLink(i.id, env)}`);
    }
  }
  lines.push('');

  lines.push('**Worth a look**');
  const w = d.themes.status === 'ok' ? d.themes.worthALook : null;
  lines.push(w ? `${w.label}: "${w.question}" — ${w.why}` : 'Nothing picked out this week.');
  lines.push('');

  lines.push(`Control Centre: ${controlCentreUrl(env)}`);
  return lines.join('\n');
}

// ============================================================================
// THE RUN
// ============================================================================

const REQUIRED_ENV = ['GG3_OPS_DB_READONLY_URL', DIGEST_SUBSCRIBERS_ENV];

/** The env vars the digest needs that are unset. */
export function missingDigestEnv(env = process.env) {
  return REQUIRED_ENV.filter(k => !String(env[k] || '').trim());
}

let anthropic = null;
async function defaultCreateMessage(params, opts) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic.messages.create(params, opts);
}

/** Real dependencies. Exported for the dry-run script, which uses only the read ones. */
export async function defaultDeps() {
  const [{ query }, { getPulseSubscribers }, { postMessageWithThread }, { internalClerkIds }] = await Promise.all([
    import('../database/connection.js'),
    import('./pulse-subscribers.js'),
    import('../cards/chat-api.js'),
    import('../control-centre/identity.js')
  ]);
  /** One card DM as the Chat app; where it landed, or false. */
  const postCard = async (spaceName, { cardsV2, fallbackText }) => {
    try {
      const posted = await postMessageWithThread({ spaceName, cardsV2, fallbackText });
      return posted.messageName ? posted : false;
    } catch (err) {
      console.error(`❌ Pulse digest: card not delivered — code: ${err?.code ?? err?.status ?? err?.name ?? 'unknown'}`);
      return false;
    }
  };
  return {
    internalIds: () => internalClerkIds(),
    collectUsage: (w, ids) => collectUsage(w, gg3OpsQuery, ids),
    collectExchanges: (w, ids) => collectExchanges(w, gg3OpsQuery, ids),
    fetchProfile: (id) => fetchCompanyName(id),
    collectGrantMatches: (w, ids) => collectGrantMatches(w, gg3OpsQuery, ids),
    collectQueueIssues: (w) => collectQueueIssues(w, query),
    createMessage: defaultCreateMessage,
    oracleQuery: query,
    getSubscribers: () => getPulseSubscribers(DIGEST_SUBSCRIBERS_ENV),
    lookupSubscribers: getPulseSubscribers,
    post: postCard,
    recordPost: recordPulsePost,
    saveThemes: async (built) => (await import('../control-centre/digest-themes.js')).saveDigestThemes(built)
  };
}

/**
 * DM each subscriber the card; the one delivery path for the Monday run and a
 * test send. `record` (optional) is told where each delivered card landed —
 * pulse_posts, so replies in its thread get the digest as context.
 * @param {{cardsV2: Object[], fallbackText: string}} message
 * @returns {Promise<number>} sent
 */
export async function deliverDigest(message, subscribers, post, record = null) {
  let sent = 0;
  for (const s of subscribers) {
    const result = await post(s.dmSpace, message);
    if (!result) continue;
    sent += 1;
    if (record) await record(s, result);
  }
  return sent;
}

/** The recorder for one digest send: its week and the lines the card showed. Null without a recordPost dep. */
function digestRecorder(d, deps, { env = process.env, isTest = false } = {}) {
  if (!deps.recordPost) return null;
  const { start, end } = weekBounds(d.monday);
  return pulsePostRecorder({ kind: 'digest', isTest, periodStart: start, periodEnd: end, summary: formatDigest(d, { env }) }, deps.recordPost);
}

const TEST_ENV = 'PULSE_DIGEST_TEST_RECIPIENT';

/**
 * Send the digest card to one person as a test, through the normal subscriber
 * lookup (@granted.ca only, must have a DM with Oracle) and delivery. The title
 * says it's a test. Never claims the week and never stores themes.
 * @returns {Promise<{sent: number, code?: 'not_reachable'|'post_failed'}>}
 */
export async function sendDigestTest({ email, d, env = process.env, deps }) {
  const subscribers = await deps.lookupSubscribers(TEST_ENV, { [TEST_ENV]: String(email || '') });
  if (!subscribers.length) return { sent: 0, code: 'not_reachable' };
  const message = { cardsV2: digestCard(d, { test: true, env }), fallbackText: digestFallback(d, { test: true }) };
  const sent = await deliverDigest(message, subscribers.slice(0, 1), deps.post, digestRecorder(d, deps, { env, isTest: true }));
  return sent ? { sent } : { sent: 0, code: 'post_failed' };
}

/** Claim this week's digest. @returns {Promise<boolean>} false when already claimed */
export async function claimWeek(monday, now, runQuery) {
  const r = await runQuery(
    `INSERT INTO pulse_alert_state (alert_key, last_sent_at) VALUES ($1, $2)
     ON CONFLICT (alert_key) DO NOTHING
     RETURNING alert_key`,
    [`weekly_digest:${monday}`, now]
  );
  return r.rows.length > 0;
}

/**
 * One Monday run. Never throws for "not configured" or "already sent".
 * @returns {Promise<{status: 'skipped'|'already_sent'|'no_state_table'|'sent'|'undelivered', missing?: string[], sent?: number}>}
 */
export async function runWeeklyDigest({ now = new Date(), env = process.env, deps = null } = {}) {
  const missing = missingDigestEnv(env);
  if (missing.length || !isGg3OpsConfigured()) return { status: 'skipped', missing };
  const d = deps || await defaultDeps();
  const monday = previousWeek(now);

  const built = await buildDigest({ monday, deps: d });
  if (!built) return { status: 'skipped', missing: [] };
  if (built.themes.status === 'failed') console.warn(`⚠️  Pulse digest: themes call failed — code: ${built.themes.code}`);

  try {
    if (!(await claimWeek(monday, now, d.oracleQuery))) return { status: 'already_sent' };
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('⚠️  Pulse digest: pulse_alert_state missing (apply migration 040) — not sending.');
      return { status: 'no_state_table' };
    }
    throw err;
  }

  // The Control Centre's stored copy of the themes (migration 046), from the
  // call already made — never a second one. A failure here never stops the DM.
  if (built.themes.status === 'ok' && d.saveThemes) {
    try {
      await d.saveThemes(built);
    } catch (err) {
      console.warn(`⚠️  Pulse digest: themes not stored for the Control Centre — code: ${codeOf(err)}`);
    }
  }

  const message = { cardsV2: digestCard(built, { env }), fallbackText: digestFallback(built) };
  const sent = await deliverDigest(message, await d.getSubscribers(), d.post, digestRecorder(built, d, { env }));
  if (sent === 0) {
    console.warn('⚠️  Pulse digest: no subscriber could be reached — not retried this week.');
    return { status: 'undelivered', sent };
  }
  console.log(`📊 Pulse digest ${monday}: sent to ${sent} subscriber(s) — ${built.usage.chatUsers} chat users, ${built.exchangesRead} exchanges, ${built.grants.length} grants matched, ${built.errors.ok ? built.errors.issues.length : 'no'} cards`);
  return { status: 'sent', sent };
}

/** @param {Object} cron - node-cron */
export function startPulseDigest(cron, env = process.env) {
  const missing = missingDigestEnv(env);
  if (missing.length || !isGg3OpsConfigured()) {
    console.warn(`⚠️  Pulse weekly digest NOT configured — unset: ${missing.join(', ') || 'GG3_OPS_DB_READONLY_URL'}.`);
    return false;
  }
  const run = async () => {
    try {
      await runWeeklyDigest();
    } catch (err) {
      console.error(`❌ Pulse digest failed — code: ${codeOf(err)}`);
    }
  };
  cron.schedule('0 8 * * 1', run, { name: 'pulse-digest', timezone: TZ, noOverlap: true });
  console.log('⏰ Cron job scheduled: Pulse weekly digest Mondays at 08:00 America/Vancouver');
  return true;
}
