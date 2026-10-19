/**
 * Control Centre — Chat themes tab. Reads only, apart from the transcript
 * view log (cc_transcript_views, the Companies tab's rule: every opening of a
 * chat is logged).
 *
 *   chatOverview(range)        sections 1–6 for a range: themes (clients only),
 *                              unanswered questions, unmet needs (both from the
 *                              daily pass's rows, migration 049), grants
 *                              discussed, chat health and chat outcomes (live
 *                              from the ops and app DBs) — client-only and with
 *                              internal accounts
 *   chatSearch(params)         any word across client and assistant text, with
 *                              company, date, cards-shown and internal filters
 *   chatTranscript(id, viewer) one conversation, verbatim, each reply with the
 *                              grant cards it showed (logged)
 *
 * Definitions (docs/control-centre.md, Chat themes tab):
 *   unanswered      chat-daily.js unansweredReason: no answer, asked for a
 *                   person, or left after a bad reply
 *   unmet need      something the client asked for that GetGranted doesn't offer
 *   grant mention   a grant the turn's tools returned and the reply named; a
 *                   card is chat_turns.surfaced_grant_ids
 *   outcome         within 24 hours (OUTCOME_HOURS) after the chat's last
 *                   message, from its first message on: a grant card opened, a
 *                   watchlist save, a goal created — by the chat's company
 *
 * App and ops reads go through db.js (read-only). The daily rows are read with
 * `storeQuery` (the Hub by default). Before 049 is applied the three
 * daily-pass sections say so and the rest still load.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault, opsQuery as opsQueryDefault } from './db.js';
import { TIME_ZONE, vancouverDay, addDays } from './rollup.js';
import { windowsFor, RANGE_DAYS, OverviewError } from './overview.js';
import { identitiesForClerkIds, companyNamesForIds, internalClerkIds as internalClerkIdsDefault } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { cardLink, grantLink } from './links.js';
import { cardTitle } from './card-summary.js';
import { COMPANY_CLERKS_SQL, INSERT_VIEW_SQL, VIEWS_SQL } from './companies.js';
import { splitTurns } from './diagnosis.js';
import { parseTurns, namedInReply, ISSUES } from './chat-daily.js';
import { FAILED_OUTCOMES, EXCLUDED_CATEGORIES } from '../services/pulse-spike.js';

export const OUTCOME_HOURS = 24;
export const CACHE_MS = 5 * 60 * 1000;
export const TREND_WEEKS = 8;
export const EXAMPLES = 3;
export const SEARCH_LIMIT = 50;
const SNIPPET_CHARS = 160;
export const UNANSWERED_WORDS = Object.freeze({
  no_answer: 'not answered',
  asked_for_person: 'asked for a person',
  left_after_bad_reply: 'left after a bad reply'
});

export class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const between = (col, a = '$1', b = '$2') =>
  `${col} >= (${a}::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${col} < (${b}::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;

// Store (Hub): the daily pass's rows.
export const QUESTIONS_SQL = `
  SELECT day::text AS day, conversation_id, turn_index, clerk_id, company_id, occurred_at, question, theme, funding_ask,
         answer, unanswered_reason, unmet_need, cards_shown, grants_named, rejected_shown, search_status
    FROM cc_chat_questions
   WHERE day BETWEEN $1::date AND $2::date`;
// The latest day stored: a nightly run, or a day the backfill script wrote (which makes no run row).
export const LAST_RUN_SQL = `
  SELECT greatest((SELECT max(day) FROM cc_chat_daily_runs WHERE status IN ('done', 'empty')),
                  (SELECT max(day) FROM cc_chat_questions))::text AS day`;

// Ops (read-only): every chat with a client message in the window — a turn
// recorded in it, or, for a chat chat_turns never recorded, its last activity.
export const WINDOW_CHATS_SQL = `
  SELECT c.id, c.user_id, c.created_at, c.updated_at, c.messages
    FROM conversations c
   WHERE c.user_id LIKE 'user\\_%' AND c.updated_at >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND (EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id AND ${between('t.occurred_at')})
          OR (NOT EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id) AND ${between('c.updated_at')}))`;
export const WINDOW_TURNS_SQL = `
  SELECT conversation_id, turn_index, occurred_at, outcome, error_category, surfaced_grant_ids
    FROM chat_turns
   WHERE conversation_id = ANY($1::int[]) AND turn_index IS NOT NULL`;

// App (read-only): what the chat's company did afterwards. Naive app
// timestamps are UTC, read as such.
export const OPENS_AFTER_SQL = `
  SELECT company_id, started_at AS at, presentation_context->>'source' AS source
    FROM grant_view_sessions
   WHERE company_id = ANY($1::int[]) AND started_at >= $2 AND started_at < $3`;
export const SAVES_AFTER_SQL = `
  SELECT w.company_id, wg.created_at AT TIME ZONE 'UTC' AS at
    FROM watchlist_grants wg JOIN watchlists w ON w.id = wg.watchlist_id
   WHERE w.company_id = ANY($1::int[]) AND wg.created_at AT TIME ZONE 'UTC' >= $2 AND wg.created_at AT TIME ZONE 'UTC' < $3`;
export const GOALS_AFTER_SQL = `
  SELECT company_id, created_at AT TIME ZONE 'UTC' AS at
    FROM goals
   WHERE company_id = ANY($1::int[]) AND created_at AT TIME ZONE 'UTC' >= $2 AND created_at AT TIME ZONE 'UTC' < $3`;

// Hub: the two daily-pass card types.
export const RULE_CARDS_SQL = `
  SELECT i.id, i.kind, i.status, i.owner, i.company_id, i.chat_turn_ref, i.conversation_id, i.flag_count, i.created_at,
         i.diagnosis->>'verdict' AS verdict
    FROM cc_review_items i
   WHERE i.kind = 'chat' AND (i.chat_turn_ref LIKE 'conv:%:${ISSUES.NO_CARDS}' OR i.chat_turn_ref LIKE 'conv:%:${ISSUES.REJECTED}')
     AND EXISTS (SELECT 1 FROM cc_review_flags f WHERE f.item_id = i.id AND ${between('coalesce(f.source_created_at, f.created_at)')})
   ORDER BY i.created_at DESC`;

export const GRANT_NAMES_SQL = 'SELECT id, grant_name FROM gg3_grants WHERE id = ANY($1::int[])';
export const COMPANY_BY_NAME_SQL = `
  SELECT id, name FROM companies WHERE deleted_at IS NULL AND name ILIKE $1 ORDER BY id LIMIT 20`;
export const CONVERSATION_SQL = 'SELECT id, user_id, messages, created_at, updated_at FROM conversations WHERE id = $1';
export const CONVERSATION_TURNS_SQL = `
  SELECT turn_index, occurred_at, outcome, surfaced_grant_ids FROM chat_turns
   WHERE conversation_id = $1 AND turn_index IS NOT NULL ORDER BY turn_index, occurred_at`;
export const CONVERSATION_QUESTIONS_SQL = `
  SELECT turn_index, question, theme, funding_ask, answer, unanswered_reason, unmet_need
    FROM cc_chat_questions WHERE conversation_id = $1`;

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const arr = (v) => (Array.isArray(v) ? v : []);
const ids = (v) => [...new Set(arr(v).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The Monday (Vancouver calendar) of a YYYY-MM-DD day. */
export function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** Variant filters: `clients` drops internal accounts (by company, else by Clerk id); `all` keeps everyone. */
export const variants = (internalIds = new Set()) => ({
  clients: (r) => !(isInternalCompany(r.company_id) || (r.company_id == null && internalIds.has(r.clerk_id))),
  all: () => true
});

/**
 * Pure: daily rows → themes, client-only. Counts in the window vs the
 * previous one, a weekly trend (TREND_WEEKS Mondays up to the window's end),
 * example questions with their chats.
 */
export function buildThemes(rows, { current, previous, trendWeeks }) {
  const byTheme = new Map();
  const at = (t) => { if (!byTheme.has(t)) byTheme.set(t, { theme: t, current: 0, previous: 0, weeks: new Map(trendWeeks.map((w) => [w, 0])), examples: [] }); return byTheme.get(t); };
  for (const r of rows) {
    const t = at(r.theme);
    if (r.day >= current.from && r.day <= current.to) {
      t.current += 1;
      if (t.examples.length < EXAMPLES) t.examples.push({ question: r.question, conversation_id: r.conversation_id, day: r.day });
    } else if (r.day >= previous.from && r.day <= previous.to) t.previous += 1;
    const w = mondayOf(r.day);
    if (t.weeks.has(w)) t.weeks.set(w, t.weeks.get(w) + 1);
  }
  return [...byTheme.values()].filter((t) => t.current || t.previous)
    .map((t) => ({ ...t, delta: t.current - t.previous, weeks: [...t.weeks].map(([week, n]) => ({ week, n })) }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous || a.theme.localeCompare(b.theme));
}

/** Pure: unanswered rows → groups by theme, each with its chats and grants. */
export function buildUnanswered(rows) {
  const groups = new Map();
  for (const r of rows.filter((x) => x.unanswered_reason)) {
    if (!groups.has(r.theme)) groups.set(r.theme, { theme: r.theme, count: 0, left_after: 0, by_reason: {}, chats: new Map(), grants: new Set() });
    const g = groups.get(r.theme);
    g.count += 1;
    if (r.unanswered_reason === 'left_after_bad_reply') g.left_after += 1;
    g.by_reason[r.unanswered_reason] = (g.by_reason[r.unanswered_reason] ?? 0) + 1;
    if (!g.chats.has(r.conversation_id)) {
      g.chats.set(r.conversation_id, { conversation_id: r.conversation_id, company_id: r.company_id, clerk_id: r.clerk_id, day: r.day, questions: [] });
    }
    g.chats.get(r.conversation_id).questions.push({ turn_index: r.turn_index, question: r.question, reason: r.unanswered_reason });
    for (const id of [...ids(r.cards_shown), ...ids(r.grants_named)]) g.grants.add(id);
  }
  return [...groups.values()].map((g) => ({ ...g, chats: [...g.chats.values()], grants: [...g.grants] }))
    .sort((a, b) => b.count - a.count || b.left_after - a.left_after || a.theme.localeCompare(b.theme));
}

/** Pure: rows with an unmet need → groups by label. */
export function buildUnmet(rows) {
  const groups = new Map();
  for (const r of rows.filter((x) => x.unmet_need)) {
    if (!groups.has(r.unmet_need)) groups.set(r.unmet_need, { need: r.unmet_need, count: 0, chats: new Set(), examples: [] });
    const g = groups.get(r.unmet_need);
    g.count += 1;
    g.chats.add(r.conversation_id);
    if (g.examples.length < EXAMPLES) g.examples.push({ question: r.question, conversation_id: r.conversation_id, day: r.day });
  }
  return [...groups.values()].map((g) => ({ ...g, chats: g.chats.size })).sort((a, b) => b.count - a.count || a.need.localeCompare(b.need));
}

const isFailed = (t) => FAILED_OUTCOMES.includes(t?.outcome) && !(t?.error_category && EXCLUDED_CATEGORIES.includes(t.error_category));

/**
 * Pure: the window's chats (each with its parsed turns, turn rows and which
 * turns fall in the window) → grants discussed and chat health numbers.
 */
export function buildGrantsAndHealth(chats) {
  const grants = new Map();
  const at = (id) => { if (!grants.has(id)) grants.set(id, { grant_id: id, carded: 0, mentioned_only: 0, chats: new Set() }); return grants.get(id); };
  let messages = 0; let cards = 0; let failed = 0; let recordedChats = 0;
  for (const c of chats) {
    let recorded = false;
    for (const t of c.turns) {
      if (!c.inWindow(t)) continue;
      messages += 1;
      const row = c.rowOf.get(t.turn_index);
      if (row) recorded = true;
      if (isFailed(row)) failed += 1;
      const shown = row ? ids(row.surfaced_grant_ids) : t.legacy_cards;
      cards += shown.length;
      for (const id of shown) { const g = at(id); g.carded += 1; g.chats.add(c.id); }
      for (const id of namedInReply(t.reply, t.returned)) {
        if (shown.includes(id)) continue;
        const g = at(id); g.mentioned_only += 1; g.chats.add(c.id);
      }
    }
    if (recorded) recordedChats += 1;
  }
  return {
    grants: [...grants.values()].map((g) => ({ ...g, chats: g.chats.size }))
      .sort((a, b) => (b.carded + b.mentioned_only) - (a.carded + a.mentioned_only) || b.carded - a.carded || a.grant_id - b.grant_id),
    health: { chats: chats.length, client_messages: messages, grant_cards: cards,
      cards_per_chat: chats.length ? Math.round((cards / chats.length) * 10) / 10 : null, failed_turns: failed, chats_with_turn_records: recordedChats }
  };
}

/**
 * Pure: chats with their company and [start, end] → which were followed, within
 * OUTCOME_HOURS of the chat's last message (and not before it began), by a
 * grant card opened, a watchlist save or a goal created by that company.
 */
export function buildOutcomes(chats, { opens = [], saves = [], goals = [] }, hours = OUTCOME_HOURS) {
  const ms = hours * 3600 * 1000;
  const byCompany = (rows) => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.company_id)) m.set(r.company_id, []); m.get(r.company_id).push({ ...r, t: new Date(r.at).getTime() }); }
    return m;
  };
  const o = byCompany(opens); const s = byCompany(saves); const g = byCompany(goals);
  const within = (list, c) => (list.get(c.company_id) ?? []).filter((e) => e.t >= c.startMs && e.t <= c.endMs + ms);
  const linked = chats.filter((c) => c.company_id != null);
  const out = { chats: chats.length, linked_chats: linked.length, card_opened: 0, card_opened_from_chat: 0, watchlist_save: 0, goal_created: 0, any: 0 };
  for (const c of linked) {
    const opened = within(o, c);
    const flags = { opened: opened.length > 0, fromChat: opened.some((e) => e.source === 'advisor'), saved: within(s, c).length > 0, goal: within(g, c).length > 0 };
    if (flags.opened) out.card_opened += 1;
    if (flags.fromChat) out.card_opened_from_chat += 1;
    if (flags.saved) out.watchlist_save += 1;
    if (flags.goal) out.goal_created += 1;
    if (flags.opened || flags.saved || flags.goal) out.any += 1;
  }
  return { ...out, share: { card_opened: pct(out.card_opened, out.linked_chats), card_opened_from_chat: pct(out.card_opened_from_chat, out.linked_chats),
    watchlist_save: pct(out.watchlist_save, out.linked_chats), goal_created: pct(out.goal_created, out.linked_chats), any: pct(out.any, out.linked_chats) } };
}

/**
 * Pure: does a conversation's text contain the word — client messages (string
 * content) and assistant text blocks only, never tool calls or tool output.
 * @returns {{client: string|null, assistant: string|null}} the first snippet on each side
 */
export function searchHits(messages, word) {
  const w = String(word ?? '').trim().toLowerCase();
  const out = { client: null, assistant: null };
  if (!w) return out;
  const snippet = (text) => {
    const i = text.toLowerCase().indexOf(w);
    const start = Math.max(0, i - 50);
    return clip(`${start > 0 ? '…' : ''}${text.slice(start)}`, SNIPPET_CHARS);
  };
  for (const m of arr(messages)) {
    if (m?.role === 'user' && typeof m.content === 'string') {
      if (!out.client && m.content.toLowerCase().includes(w)) out.client = snippet(m.content);
    } else if (m?.role === 'assistant') {
      const texts = typeof m.content === 'string' ? [m.content] : arr(m.content).filter((b) => b?.type === 'text').map((b) => String(b.text ?? ''));
      for (const t of texts) if (!out.assistant && t.toLowerCase().includes(w)) out.assistant = snippet(t);
    }
  }
  return out;
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return { hubQuery: hubQueryDefault, appQuery: appQueryDefault, opsQuery: opsQueryDefault, storeQuery: hubQueryDefault,
    internalClerkIds: () => internalClerkIdsDefault(), now: () => new Date() };
}

const cache = new Map();

const parseRange = (range) => {
  if (!RANGE_DAYS[range]) throw new ChatError(400, `range must be one of ${Object.keys(RANGE_DAYS).join(', ')}`);
  return range;
};

async function grantNames(list, deps) {
  const want = ids(list);
  if (!want.length) return {};
  return Object.fromEntries((await deps.hubQuery(GRANT_NAMES_SQL, [want])).rows.map((r) => [Number(r.id), r.grant_name]));
}

/** The window's chats, parsed, with their company. */
async function windowChats(from, to, deps) {
  const convs = (await deps.opsQuery(WINDOW_CHATS_SQL, [from, to])).rows;
  const turnRows = convs.length ? (await deps.opsQuery(WINDOW_TURNS_SQL, [convs.map((c) => c.id)])).rows : [];
  const identities = await identitiesForClerkIds([...new Set(convs.map((c) => c.user_id))], { query: deps.appQuery }).catch(() => new Map());
  const startMs = new Date(`${from}T00:00:00Z`).getTime();
  return convs.map((c) => {
    const rows = turnRows.filter((r) => r.conversation_id === c.id);
    const rowOf = new Map(rows.map((r) => [r.turn_index, r]));
    const day = (t) => vancouverDay(t);
    const inWindow = (t) => {
      const r = rowOf.get(t.turn_index);
      if (r) { const d = day(r.occurred_at); return d >= from && d <= to; }
      return !rows.length; // a chat chat_turns never recorded: all its turns
    };
    const times = rows.map((r) => new Date(r.occurred_at).getTime());
    return {
      id: c.id, clerk_id: c.user_id, company_id: identities.get(c.user_id)?.company_id ?? null,
      startMs: Math.min(new Date(c.created_at).getTime(), ...times), endMs: Math.max(new Date(c.updated_at).getTime(), ...times, startMs),
      turns: parseTurns(c.messages), rowOf, inWindow
    };
  });
}

/** Sections 1–6 for a range, both variants (the page picks by its toggle; Themes is always client-only). */
export async function chatOverview(range = 'month', overrides = {}) {
  parseRange(range);
  const deps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const hit = cache.get(range);
  if (hit && now.getTime() - hit.at < CACHE_MS && !overrides.noCache) return hit.value;

  const w = windowsFor(range, now);
  const { from, to } = w.current;
  const trendStart = addDays(mondayOf(to), -7 * (TREND_WEEKS - 1));
  const trendWeeks = Array.from({ length: TREND_WEEKS }, (_, i) => addDays(trendStart, 7 * i));
  const internalIds = await deps.internalClerkIds().catch(() => new Set());
  const keep = variants(internalIds);

  let rows = [];
  let store = { ok: true, last_run_day: null };
  try {
    const earliest = [w.previous.from, trendStart].sort()[0];
    rows = (await deps.storeQuery(QUESTIONS_SQL, [earliest, to])).rows;
    store.last_run_day = (await deps.storeQuery(LAST_RUN_SQL)).rows[0]?.day ?? null;
  } catch (err) {
    if (err?.code !== '42P01') throw err;
    store = { ok: false, missing: 'migration_049' };
  }
  const inCurrent = rows.filter((r) => r.day >= from && r.day <= to);

  const chats = await windowChats(from, to, deps);
  const [opens, saves, goals, ruleCards] = await (async () => {
    const companies = ids(chats.map((c) => c.company_id));
    if (!companies.length) return [[], [], [], (await deps.hubQuery(RULE_CARDS_SQL, [from, to])).rows];
    const lo = new Date(Math.min(...chats.map((c) => c.startMs)));
    const hi = new Date(Math.max(...chats.map((c) => c.endMs)) + OUTCOME_HOURS * 3600 * 1000);
    return Promise.all([
      deps.appQuery(OPENS_AFTER_SQL, [companies, lo, hi]).then((r) => r.rows),
      deps.appQuery(SAVES_AFTER_SQL, [companies, lo, hi]).then((r) => r.rows),
      deps.appQuery(GOALS_AFTER_SQL, [companies, lo, hi]).then((r) => r.rows),
      deps.hubQuery(RULE_CARDS_SQL, [from, to]).then((r) => r.rows)
    ]);
  })();

  const out = {};
  for (const [name, k] of Object.entries(keep)) {
    const vChats = chats.filter((c) => k(c));
    const gh = buildGrantsAndHealth(vChats);
    const vCards = ruleCards.filter((c) => k({ company_id: c.company_id, clerk_id: null }));
    out[name] = {
      unanswered: buildUnanswered(inCurrent.filter(k)),
      unmet_needs: buildUnmet(inCurrent.filter(k)),
      grants_discussed: gh.grants,
      health: { ...gh.health,
        no_cards_for_funding_ask: vCards.filter((c) => c.chat_turn_ref.endsWith(ISSUES.NO_CARDS)).length,
        card_for_rejected_grant: vCards.filter((c) => c.chat_turn_ref.endsWith(ISSUES.REJECTED)).length },
      rule_cards: vCards,
      outcomes: buildOutcomes(vChats, { opens, saves, goals })
    };
  }

  const companyIds = ids([...rows.map((r) => r.company_id), ...chats.map((c) => c.company_id), ...ruleCards.map((c) => c.company_id)]);
  const names = await companyNamesForIds(companyIds, { query: deps.appQuery }).catch(() => new Map());
  const grantIds = [...rows.flatMap((r) => [...ids(r.cards_shown), ...ids(r.grants_named)]), ...out.all.grants_discussed.map((g) => g.grant_id)];
  const gNames = await grantNames(grantIds, deps);
  const shapeCard = (c) => {
    const company_name = c.company_id != null ? names.get(c.company_id) ?? null : null;
    return { id: Number(c.id), status: c.status, owner: c.owner ?? null, verdict: c.verdict ?? null, conversation_id: c.conversation_id,
      issue: c.chat_turn_ref.split(':').pop(), title: cardTitle({ ...c, company_name }), company_id: c.company_id ?? null, company_name,
      internal: isInternalCompany(c.company_id), flag_count: c.flag_count, link: cardLink(c.id) };
  };
  for (const v of Object.values(out)) v.rule_cards = v.rule_cards.map(shapeCard);

  const value = {
    range, current: w.current ? { from, to } : null, previous: { from: w.previous.from, to: w.previous.to },
    definitions: { outcome_hours: OUTCOME_HOURS, trend_weeks: TREND_WEEKS, unanswered: UNANSWERED_WORDS },
    store,
    // Themes: clients only, whatever the toggle.
    themes: store.ok ? buildThemes(rows.filter(keep.clients), { current: { from, to }, previous: w.previous, trendWeeks }) : [],
    trend_weeks: trendWeeks,
    clients_variant: out.clients,
    all_variant: out.all,
    companies: Object.fromEntries(companyIds.map((id) => [id, { name: names.get(id) ?? null, internal: isInternalCompany(id) }])),
    grants: gNames,
    generated_at: new Date(now).toISOString()
  };
  if (!overrides.noCache) cache.set(range, { at: now.getTime(), value });
  return value;
}

/** Company filter → its Clerk ids: an id, or part of a name. */
async function clerksForCompany(company, deps) {
  const text = String(company ?? '').trim();
  if (!text) return null;
  const companyIds = /^\d{1,9}$/.test(text) ? [Number(text)]
    : (await deps.appQuery(COMPANY_BY_NAME_SQL, [`%${likeEscape(text)}%`])).rows.map((r) => r.id);
  if (!companyIds.length) return [];
  return (await deps.appQuery(COMPANY_CLERKS_SQL, [companyIds])).rows.map((r) => r.clerk_id);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Any word across client and assistant text. Filters: company (id or part of
 * a name), from/to (Vancouver days; a chat counts when a message falls in
 * them — default the last 30 days), cards (any | shown | none), include
 * internal accounts (default no). At most SEARCH_LIMIT chats, newest first.
 */
export async function chatSearch(params = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const q = String(params.q ?? '').trim();
  if (q.length < 2) throw new ChatError(400, 'Search for a word of at least 2 letters.');
  const today = vancouverDay(deps.now());
  const to = DAY.test(params.to ?? '') ? params.to : today;
  const from = DAY.test(params.from ?? '') ? params.from : addDays(to, -29);
  if (from > to) throw new ChatError(400, 'from must be on or before to');
  if (addDays(from, 366) < to) throw new ChatError(400, 'search at most a year at a time');
  const cards = ['shown', 'none'].includes(params.cards) ? params.cards : 'any';
  const includeInternal = params.internal === true || params.internal === 'true' || params.internal === '1';

  const clerks = await clerksForCompany(params.company, deps);
  if (clerks && !clerks.length) return { q, from, to, cards, include_internal: includeInternal, results: [], note: 'No company matches that name or id.' };
  const internalIds = includeInternal ? new Set() : await deps.internalClerkIds().catch(() => new Set());

  const like = `%${likeEscape(q)}%`;
  const p = [from, to, like];
  const text = `(m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string' AND m->>'content' ILIKE $3)
         OR (m->>'role' = 'assistant' AND ((jsonb_typeof(m->'content') = 'string' AND m->>'content' ILIKE $3)
             OR (jsonb_typeof(m->'content') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(m->'content') b
                  WHERE b->>'type' = 'text' AND b->>'text' ILIKE $3))))`;
  let extra = '';
  if (clerks) { p.push(clerks); extra += ` AND c.user_id = ANY($${p.length}::text[])`; }
  if (!includeInternal && internalIds.size) { p.push([...internalIds]); extra += ` AND NOT (c.user_id = ANY($${p.length}::text[]))`; }
  const shownExpr = `(EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id AND jsonb_array_length(coalesce(t.surfaced_grant_ids, '[]'::jsonb)) > 0)
      OR jsonb_array_length(coalesce(c.grant_ids, '[]'::jsonb)) > 0)`;
  if (cards === 'shown') extra += ` AND ${shownExpr}`;
  if (cards === 'none') extra += ` AND NOT ${shownExpr}`;
  p.push(SEARCH_LIMIT);
  const res = await deps.opsQuery(`
    SELECT c.id, c.user_id, c.updated_at, c.messages, ${shownExpr} AS cards_shown
      FROM conversations c
     WHERE c.user_id LIKE 'user\\_%' AND c.updated_at >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
       AND (EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id AND ${between('t.occurred_at')})
            OR (NOT EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id) AND ${between('c.updated_at')}))
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.messages) m WHERE ${text})
       ${extra}
     ORDER BY c.updated_at DESC
     LIMIT $${p.length}::int`, p);

  const identities = await identitiesForClerkIds([...new Set(res.rows.map((r) => r.user_id))], { query: deps.appQuery }).catch(() => new Map());
  const companyIds = ids([...identities.values()].map((v) => v.company_id));
  const names = await companyNamesForIds(companyIds, { query: deps.appQuery }).catch(() => new Map());
  return {
    q, from, to, cards, include_internal: includeInternal,
    results: res.rows.map((r) => {
      const companyId = identities.get(r.user_id)?.company_id ?? null;
      const hits = searchHits(r.messages, q);
      return {
        conversation_id: r.id, company_id: companyId, company_name: companyId != null ? names.get(companyId) ?? null : null,
        internal: isInternalCompany(companyId) || internalIds.has(r.user_id), last_active: iso(r.updated_at),
        cards_shown: Boolean(r.cards_shown), client_snippet: hits.client, assistant_snippet: hits.assistant
      };
    }),
    ...(res.rows.length === SEARCH_LIMIT ? { note: `Stopped at ${SEARCH_LIMIT} chats; narrow the dates or add a company.` } : {})
  };
}

/** One conversation, verbatim, each reply with its grant cards. Logs the opening. */
export async function chatTranscript(idInput, viewer, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const id = Number.parseInt(idInput, 10);
  if (!(Number.isInteger(id) && id > 0 && String(id) === String(idInput).trim())) throw new ChatError(400, 'conversation must be a positive integer');
  if (!viewer) throw new ChatError(400, 'a signed-in viewer is required');
  const conv = (await deps.opsQuery(CONVERSATION_SQL, [id])).rows[0];
  if (!conv || !String(conv.user_id ?? '').startsWith('user_')) throw new ChatError(404, 'no such client conversation');
  const [turnRows, identities] = await Promise.all([
    deps.opsQuery(CONVERSATION_TURNS_SQL, [id]).then((r) => r.rows),
    identitiesForClerkIds([conv.user_id], { query: deps.appQuery }).catch(() => new Map())
  ]);
  let analysis = new Map();
  try {
    analysis = new Map((await deps.storeQuery(CONVERSATION_QUESTIONS_SQL, [id])).rows.map((r) => [r.turn_index, r]));
  } catch (err) { if (err?.code !== '42P01') throw err; }
  const companyId = identities.get(conv.user_id)?.company_id ?? null;
  const rowOf = new Map(turnRows.map((r) => [r.turn_index, r]));
  const parsed = parseTurns(conv.messages);
  const turns = splitTurns(conv.messages, { clipChars: Infinity }).map((t) => {
    const row = rowOf.get(t.turn_index);
    const cards = row ? ids(row.surfaced_grant_ids) : (parsed[t.turn_index]?.legacy_cards ?? []);
    const a = analysis.get(t.turn_index);
    return { ...t, at: iso(row?.occurred_at), outcome: row?.outcome ?? null, cards, cards_recorded: Boolean(row) || cards.length > 0,
      ...(a ? { analysis: { theme: a.theme, question: a.question, funding_ask: a.funding_ask, answer: a.answer,
        unanswered: a.unanswered_reason ? UNANSWERED_WORDS[a.unanswered_reason] : null, unmet_need: a.unmet_need } } : {}) };
  });
  const gNames = await grantNames(turns.flatMap((t) => t.cards), deps);
  await deps.hubQuery(INSERT_VIEW_SQL, [id, companyId, viewer]);
  const views = (await deps.hubQuery(VIEWS_SQL, [[id]])).rows.map((r) => ({ viewer: r.viewer, last_viewed_at: iso(r.last_viewed_at), views: r.views }));
  const names = companyId != null ? await companyNamesForIds([companyId], { query: deps.appQuery }).catch(() => new Map()) : new Map();
  return {
    conversation_id: id, company_id: companyId, company_name: companyId != null ? names.get(companyId) ?? null : null,
    internal: isInternalCompany(companyId), started: iso(conv.created_at), last_active: iso(conv.updated_at),
    turns: turns.map((t) => ({ ...t, card_names: t.cards.map((g) => ({ grant_id: g, name: gNames[g] ?? `Grant #${g}`, link: grantLink(g) })) })),
    viewed_by: views
  };
}

export function _clearCacheForTests() { cache.clear(); }

export { OverviewError };
