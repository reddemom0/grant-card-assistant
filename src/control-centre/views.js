/**
 * Control Centre — Department views (the landing page). Reads only.
 *
 *   departmentViews(range)   three panel sets, Research, Consulting/Sales and
 *                            Marketing: plain data panels (tables, bars, a
 *                            series, tiles) built from what the other tabs
 *                            already read; every row links to the company,
 *                            grant, card, chat or industry it names
 *
 * Nothing here is a new source. It composes the tabs' own functions — each
 * keeps its own 5-minute cache — plus a few small reads: the daily chat
 * review's rows (cc_chat_questions), goals created (app), first actions of the
 * range's sign-ups (app), and the deadline and consulting cards (Hub). A panel
 * whose source fails comes back as {error} and the rest still render.
 *
 * Payload (both variants, internal accounts left out / in):
 *   panel = { key, title, kind: 'table'|'bars'|'series'|'tiles', wide?, note?,
 *             see_all?: {label, hash, range?}, error? | clients: V, all: V }
 *   table  V = { columns: [{key, label, kind}], rows: [{cells, href?, flag?}] }
 *            cell kinds: text, num, money, date, delta, days, link ({text, hash}), badge
 *   bars   V = { unit, rows: [{label, value, previous?, href?}] }
 *   series V = { label, total, previous_total, delta, current: [{day, value}], previous: [...] }
 *   tiles  V = { tiles: [{label, n, words?, href?}] }
 * An empty variant is rows: [] / tiles: []; the page shows "Nothing this period".
 *
 * Ranges follow the picker (Month by default on this tab). Two things are
 * today's catalogue whatever the range: status mismatches (deadline text that
 * is a past date on a live grant) and upcoming deadlines (the next
 * DUE_SOON_DAYS days). Docs: docs/control-centre.md, Department views.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault } from './db.js';
import { vancouverDay, addDays, TIME_ZONE } from './rollup.js';
import { windowsFor, openSources, rangeError, trimCache } from './overview.js';
import { liveGrants as liveGrantsDefault } from './live-sources.js';
import { companyNamesForIds, withCompanyNames, internalClerkIds as internalClerkIdsDefault } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { cardTitle } from './card-summary.js';
import { profileMains } from './industry-vocabulary.js';
import { coverage as coverageDefault, changes as changesDefault, deadlineFlags as deadlineFlagsDefault, DUE_SOON_DAYS } from './coverage.js';
import { loadGrantWindow as loadGrantWindowDefault, buildGrantList } from './grants.js';
import { listItems as listItemsDefault, STUCK_DAYS, LAST_ACTIVITY, LAST_ACTIVITY_JOIN, stuckWhen } from './review-queue.js';
import { chatOverview as chatOverviewDefault } from './chat-themes.js';
import { companyList as companyListDefault } from './companies.js';
import { CONSULTING_NEED } from './chat-daily.js';

export const MAX_ROWS = 10;
export const BARS_MAX = 14;
/** A fast starter set a goal track and opened a card within this many days of signing up. */
export const FAST_DAYS = 7;
/** "Big-money" = app grants.value at or above this (CAD). */
export const BIG_GRANT_VALUE = 100000;
export const CACHE_MS = 5 * 60 * 1000;
export const DEPARTMENTS = Object.freeze(['research', 'consulting', 'marketing']);

/** A rewritten question that asks how to do something. */
export const HOWTO = /^(how|where|can i|could i|is there a way|what do i|what should i|do i need to)\b/i;
// The consulting label rule is the daily chat review's (chat-daily.js
// CONSULTING_NEED, imported above), so the panel and the card rule can't drift.
export { CONSULTING_NEED };
/** An unmet-need label for a program GetGranted doesn't carry (seed: "A grant we don't carry"). */
export const NOT_CARRIED = /grant|program|carry/i;
const OTHER_NEEDS = /loan|sr&ed|tax credit/i;

export class ViewsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ViewsError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// SQL (all reads)
// ---------------------------------------------------------------------------

// Hub: the daily chat review's rows in the window (migration 049).
export const CHAT_ROWS_SQL = `
  SELECT day::text AS day, conversation_id, turn_index, clerk_id, company_id, question, theme, funding_ask,
         answer, unanswered_reason, unmet_need, cards_shown, grants_named
    FROM cc_chat_questions
   WHERE day BETWEEN $1::date AND $2::date
   ORDER BY day DESC, conversation_id DESC, turn_index`;

// Hub: the deadline cards (kind grant_deadline, one per grant root).
export const DEADLINE_CARDS_SQL = `
  SELECT id, grant_root_id, status FROM cc_review_items WHERE kind = 'grant_deadline'`;

// Hub: open consulting cards with the frozen turns, so the panel can quote the
// client's question; stuck as the board defines it (review-queue.js).
export const CONSULTING_CARDS_SQL = `
  SELECT i.id, i.company_id, i.status, i.owner, i.created_at, i.updated_at, i.chat_turn_ref, i.conversation_id,
         i.snapshot->'turns' AS turns, i.snapshot->'flagged_turn_index' AS flagged_turn_index,
         ${LAST_ACTIVITY} AS last_activity_at,
         ${stuckWhen(STUCK_DAYS)} AS stuck,
         floor(EXTRACT(EPOCH FROM (now() - ${LAST_ACTIVITY})) / 86400)::int AS idle_days
    FROM cc_review_items i${LAST_ACTIVITY_JOIN}
   WHERE i.kind = 'chat' AND i.owner = 'consulting' AND i.status <> 'closed'
   ORDER BY i.updated_at DESC, i.id DESC`;

// [from 00:00, to+1 00:00) Vancouver — the Overview's window rule. App
// timestamps without a zone are UTC (the chat-themes.js convention).
const utc = (col) => `(${col} AT TIME ZONE 'UTC')`;
const betweenUtc = (col) =>
  `${utc(col)} >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${utc(col)} < ($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;
const between = (col) =>
  `${col} >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;

// App (read-only): goals created in the window (previous window included, for the "before" bars).
export const GOALS_SQL = `
  SELECT g.company_id, g.name,
         to_char(${utc('g.created_at')} AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD') AS day
    FROM goals g
   WHERE g.deleted_at IS NULL AND ${betweenUtc('g.created_at')}
   ORDER BY g.created_at`;

// App (read-only): for the companies that signed up in the window (the
// Overview's sign-up rule), their first goal and first grant card open.
export const FIRST_ACTIONS_SQL = `
  SELECT c.id AS company_id,
         (SELECT min(${utc('g.created_at')}) FROM goals g WHERE g.company_id = c.id AND g.deleted_at IS NULL) AS first_goal,
         (SELECT min(v.started_at) FROM grant_view_sessions v WHERE v.company_id = c.id) AS first_open
    FROM companies c
   WHERE c.deleted_at IS NULL
     AND ${between('c.created_at')}
     AND EXISTS (
       SELECT 1 FROM company_users cu
         JOIN users_clerk uc ON uc.user_id = cu.user_id AND uc.deleted_at IS NULL
        WHERE cu.company_id = c.id AND cu.deleted_at IS NULL
          AND uc.clerk_id LIKE 'user\\_%')`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-03' → 'Oct 3, 2026'. */
export const dayWords = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ''));
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const num = (v) => Number(v) || 0;
const dash = (v) => (v == null || v === '' ? '—' : String(v));
const dayOf = (ts) => (ts == null ? null : vancouverDay(ts instanceof Date ? ts : new Date(ts)));

const grantHash = (id) => `#grants/${id}`;
const companyHash = (id) => `#companies/${id}`;
const industryHash = (name) => `#coverage/industry/${encodeURIComponent(name)}`;
const cardHash = (id) => `#review/${Number(id)}`;
const chatHash = (id) => `#chat/${id}`;

const col = (key, label, kind = 'text') => ({ key, label, kind });
const link = (text, hash) => ({ text, hash });
const table = (columns, rows, max = MAX_ROWS) => ({ columns, rows: rows.slice(0, max) });
const bars = (unit, rows, max = BARS_MAX) => ({ unit, rows: rows.slice(0, max) });
const same = (v) => ({ clients: v, all: v });
/** Both variants from one builder: `keep(companyId)` leaves internal accounts out of `clients`. */
const bothVariants = (build, isInternal) => ({
  clients: build((id) => !isInternal(id), 'clients'),
  all: build(() => true, 'all')
});
/** A chat-review row's variant rule: `all` keeps everyone; `clients` drops internal accounts by company, else by Clerk id. */
const keepRow = (keep, internalClerks = new Set(), name = 'clients') => (r) =>
  (name === 'all' ? true : r.company_id != null ? keep(r.company_id) : !internalClerks.has(r.clerk_id));

const STATUS_WORDS = { new: 'New', diagnosed: 'Diagnosed', in_progress: 'In progress', closed: 'Closed' };
const KIND_WORDS = { match: 'Match', chat: 'Chat', grant_pattern: 'Grant pattern', empty_track: 'Empty track', grant_deadline: 'Deadline' };
const ANSWER_WORDS = { answered: 'Answered', partly: 'Partly answered', not_answered: 'Not answered' };
const REASON_WORDS = { no_answer: 'no answer', asked_for_person: 'asked for a person', left_after_bad_reply: 'left after a bad reply' };

const companyMap = (list) => new Map((list?.companies ?? []).map((c) => [c.id, c]));
const titlesOf = (win) => new Map((win?.grants ?? []).map((g) => [g.root_id, g.title]));
const titleOf = (titles, id) => titles.get(id) ?? `Grant #${id}`;

/** "Name · size · revenue · plan" as a link cell; a company the list doesn't know by its name or id. */
export function companyCell(c, id = null, names = new Map()) {
  if (c) return link(`${c.name} · ${dash(c.size)} · ${dash(c.revenue)} · ${dash(c.plan)}`, companyHash(c.id));
  if (id == null) return { text: 'Company not recorded', hash: null };
  return link(names.get(id) ?? `Company #${id}`, companyHash(id));
}
const plainCompany = (id, names) => (id == null ? { text: 'Not recorded', hash: null } : link(names.get(id) ?? `Company #${id}`, companyHash(id)));

/** The flagged turn of a chat card's frozen turns (the one marked, else by index, else the last). */
export function flaggedTurnOf(turns, flaggedIndex = null) {
  const list = Array.isArray(turns) ? turns : [];
  return list.find((t) => t?.flagged) ?? (flaggedIndex == null ? null : list.find((t) => t?.turn_index === Number(flaggedIndex))) ?? list.at(-1) ?? null;
}

/** Pure: per grant, clients matched and opens in the current vs the previous window, for one variant. */
export function grantTrends(win, keep) {
  const C = new Set(win.days);
  const P = new Set(win.previous_days ?? []);
  const titles = titlesOf(win);
  const by = new Map();
  const at = (id) => { if (!by.has(id)) by.set(id, { grant_id: id, title: titleOf(titles, id), cur: new Set(), prev: new Set(), opens_now: 0, opens_before: 0 }); return by.get(id); };
  for (const r of win.matches ?? []) {
    if (!(num(r.times_shown) > 0) || !keep(r.company_id)) continue;
    if (C.has(r.day)) at(r.grant_id).cur.add(r.company_id);
    else if (P.has(r.day)) at(r.grant_id).prev.add(r.company_id);
  }
  for (const r of win.views ?? []) {
    if (!keep(r.company_id)) continue;
    if (C.has(r.day)) at(r.grant_root_id).opens_now += num(r.sessions);
    else if (P.has(r.day)) at(r.grant_root_id).opens_before += num(r.sessions);
  }
  return [...by.values()].map((g) => ({ grant_id: g.grant_id, title: g.title, before: g.prev.size, now: g.cur.size,
    change: g.cur.size - g.prev.size, opens_before: g.opens_before, opens_now: g.opens_now }));
}

const TREND_COLUMNS = [col('grant', 'Grant', 'link'), col('before', 'Before', 'num'), col('now', 'Now', 'num'), col('change', 'Change', 'delta'),
  col('opens_before', 'Opens before', 'num'), col('opens_now', 'Opens now', 'num')];
const trendRow = (g, flag) => ({ cells: { grant: link(g.title, grantHash(g.grant_id)), before: g.before, now: g.now, change: g.change,
  opens_before: g.opens_before, opens_now: g.opens_now }, href: grantHash(g.grant_id), flag });

/** Pure: the trends table — top five up, top five down. */
export function trendingGrantsPanel(win, isInternal = isInternalCompany) {
  return bothVariants((keep) => {
    const rows = grantTrends(win, keep);
    const up = rows.filter((g) => g.change > 0).sort((a, b) => b.change - a.change || b.now - a.now || a.title.localeCompare(b.title)).slice(0, 5);
    const down = rows.filter((g) => g.change < 0).sort((a, b) => a.change - b.change || b.before - a.before || a.title.localeCompare(b.title)).slice(0, 5);
    return table(TREND_COLUMNS, [...up.map((g) => trendRow(g, 'up')), ...down.map((g) => trendRow(g, 'down'))]);
  }, isInternal);
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export function chatThemesPanel(chat) {
  const rows = (chat.themes ?? []).filter((t) => t.current > 0).map((t) => ({
    cells: { theme: link(t.theme, '#chat'), questions: t.current, change: t.delta ?? t.current - (t.previous ?? 0), example: t.examples?.[0]?.question ?? '' },
    href: '#chat'
  }));
  const v = table([col('theme', 'Theme', 'link'), col('questions', 'Questions', 'num'), col('change', 'Change', 'delta'), col('example', 'Example question')], rows);
  return { ...same(v), ...(chat.store?.ok === false ? { note: "The nightly chat review isn't set up on this server, so there are no themes." } : {}) };
}

const chatRowColumns = (first) => [first, col('question', 'Question', 'link'), col('theme', 'Theme'), col('day', 'Day', 'date')];

export function howtoPanel(rows, names, internalClerks, isInternal = isInternalCompany) {
  return bothVariants((keep, name) => {
    const hits = rows.filter((r) => r.unanswered_reason && HOWTO.test(String(r.question ?? '').trim())).filter(keepRow(keep, internalClerks, name));
    return table([col('question', 'Question', 'link'), col('theme', 'Theme'), col('company', 'Company', 'link'), col('day', 'Day', 'date')],
      hits.map((r) => ({ cells: { question: link(clip(r.question), chatHash(r.conversation_id)), theme: r.theme ?? '', company: plainCompany(r.company_id, names), day: r.day },
        href: chatHash(r.conversation_id) })));
  }, isInternal);
}

const grantRow = (g, cells) => ({ cells: { grant: link(g.title, grantHash(g.grant_id)), ...cells }, href: grantHash(g.grant_id) });

export function mostMatchedPanel(win, isInternal = isInternalCompany) {
  const lists = buildGrantList(win, { view: 'all', isInternal });
  return bothVariants((keep, name) => table(
    [col('grant', 'Grant', 'link'), col('clients_matched', 'Clients matched', 'num'), col('opens', 'Opens', 'num'), col('saves', 'Saves', 'num')],
    lists[name].filter((g) => g.clients_matched > 0).map((g) => grantRow(g, { clients_matched: g.clients_matched, opens: g.opens, saves: g.saves }))
  ), isInternal);
}

export function mostOpenedPanel(win, isInternal = isInternalCompany) {
  const lists = buildGrantList(win, { view: 'all', isInternal });
  return bothVariants((keep, name) => table(
    [col('grant', 'Grant', 'link'), col('opens', 'Opens', 'num'), col('clients_matched', 'Clients matched', 'num'), col('bounced', 'Bounced', 'num')],
    lists[name].filter((g) => g.opens > 0).sort((a, b) => b.opens - a.opens || b.clients_matched - a.clients_matched || String(a.title).localeCompare(String(b.title)))
      .map((g) => grantRow(g, { opens: g.opens, clients_matched: g.clients_matched, bounced: g.bounced }))
  ), isInternal);
}

/** Pure: went live in the range, or due within DUE_SOON_DAYS, ranked by clients matched. */
export function timelyPanel(changed, flags, win, isInternal = isInternalCompany) {
  const lists = buildGrantList(win, { view: 'all', isInternal });
  const why = new Map();
  for (const g of changed.added ?? []) why.set(g.grant_id, { title: g.title, words: [`Went live ${dayWords(dayOf(g.at))}`] });
  for (const g of flags.due_soon ?? []) {
    const w = why.get(g.grant_id) ?? { title: g.title, words: [] };
    w.words.push(`Due ${dayWords(g.deadline)} (${plural(g.days, 'day')} left)`);
    why.set(g.grant_id, w);
  }
  return bothVariants((keep, name) => {
    const metrics = new Map(lists[name].map((g) => [g.grant_id, g]));
    const rows = [...why].map(([grant_id, w]) => ({ grant_id, title: w.title ?? metrics.get(grant_id)?.title ?? `Grant #${grant_id}`, why: w.words.join(' · '),
      clients_matched: metrics.get(grant_id)?.clients_matched ?? 0, opens: metrics.get(grant_id)?.opens ?? 0 }))
      .sort((a, b) => b.clients_matched - a.clients_matched || b.opens - a.opens || a.title.localeCompare(b.title));
    return table([col('grant', 'Grant', 'link'), col('why', 'Why now'), col('clients_matched', 'Clients matched', 'num'), col('opens', 'Opens', 'num')],
      rows.map((g) => grantRow(g, { why: g.why, clients_matched: g.clients_matched, opens: g.opens })));
  }, isInternal);
}

/** Pure: goals created per goal type, now vs the previous window. */
export function goalDemandPanel(goals, C, P, isInternal = isInternalCompany) {
  const inC = new Set(C); const inP = new Set(P);
  return bothVariants((keep) => {
    const by = new Map();
    for (const g of goals) {
      if (!keep(g.company_id)) continue;
      if (!by.has(g.name)) by.set(g.name, { label: g.name, value: 0, previous: 0 });
      if (inC.has(g.day)) by.get(g.name).value += 1;
      else if (inP.has(g.day)) by.get(g.name).previous += 1;
    }
    return bars('goal tracks set', [...by.values()].filter((r) => r.value || r.previous)
      .sort((a, b) => b.value - a.value || b.previous - a.previous || a.label.localeCompare(b.label)));
  }, isInternal);
}

const demandColumns = (first) => [first, col('clients', 'Clients', 'num'), col('grant_matches', 'Grant matches', 'num'), col('avg_matches', 'Avg per client', 'num')];

export function demandIndustryPanel(cov) {
  const build = (v) => table(demandColumns(col('industry', 'Industry', 'link')),
    [...v.industries, ...(v.not_mapped ? [v.not_mapped] : [])].filter((r) => r.clients > 0 || r.grant_matches > 0)
      .sort((a, b) => b.clients - a.clients || b.grant_matches - a.grant_matches || a.industry.localeCompare(b.industry))
      .map((r) => ({ cells: { industry: link(r.industry, industryHash(r.industry)), clients: r.clients, grant_matches: r.grant_matches ?? 0, avg_matches: r.avg_matches ?? null },
        href: industryHash(r.industry) })), BARS_MAX);
  return { clients: build(cov.clients_variant), all: build(cov.all_variant) };
}

export function demandProvincePanel(cov) {
  const build = (v) => table(demandColumns(col('province', 'Province')),
    (v.breakdowns?.province ?? []).filter((r) => r.clients > 0 || num(r.grant_matches) > 0)
      .sort((a, b) => b.clients - a.clients || num(b.grant_matches) - num(a.grant_matches) || a.province.localeCompare(b.province))
      .map((r) => ({ cells: { province: r.province, clients: r.clients, grant_matches: r.grant_matches ?? null, avg_matches: r.avg_matches ?? null }, href: '#coverage' })), BARS_MAX);
  return { clients: build(cov.clients_variant), all: build(cov.all_variant) };
}

/** Pure: grant card opens by where they were opened from, now vs before. */
export function foundViaPanel(win, C, P, isInternal = isInternalCompany) {
  return bothVariants((keep) => bars('card opens', openSources((win.views ?? []).filter((r) => keep(r.company_id)), C, P)
    .map((s) => ({ label: s.label, value: s.current, previous: s.previous }))), isInternal);
}

export function totalsPanel(win, goals, C, isInternal = isInternalCompany) {
  const inC = new Set(C);
  const titles = titlesOf(win);
  return bothVariants((keep) => {
    const shown = (win.matches ?? []).filter((r) => inC.has(r.day) && num(r.times_shown) > 0 && keep(r.company_id));
    const byGrant = new Map();
    for (const r of shown) { if (!byGrant.has(r.grant_id)) byGrant.set(r.grant_id, new Set()); byGrant.get(r.grant_id).add(r.company_id); }
    const top = [...byGrant].map(([id, s]) => ({ id, n: s.size })).sort((a, b) => b.n - a.n || a.id - b.id)[0] ?? null;
    const opens = (win.views ?? []).filter((r) => inC.has(r.day) && keep(r.company_id)).reduce((s, r) => s + num(r.sessions), 0);
    const goalCounts = new Map();
    for (const g of goals ?? []) if (inC.has(g.day) && keep(g.company_id)) goalCounts.set(g.name, (goalCounts.get(g.name) ?? 0) + 1);
    const topGoal = [...goalCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
    return { tiles: [
      { label: 'Businesses matched', n: new Set(shown.map((r) => r.company_id).filter((id) => id != null)).size },
      { label: 'Grants matched', n: byGrant.size },
      { label: 'Cards opened', n: opens },
      { label: 'Top goal type', n: topGoal ? topGoal[0] : '—', ...(topGoal ? { words: `${plural(topGoal[1], 'goal track')} set` } : {}) },
      { label: 'Top grant', n: top ? titleOf(titles, top.id) : '—', ...(top ? { words: `${plural(top.n, 'client')} matched`, href: grantHash(top.id) } : {}) }
    ] };
  }, isInternal);
}

/** Pure: sign-ups per day, now vs before. */
export function signupsPanel(win, C, P, isInternal = isInternalCompany) {
  return bothVariants((keep) => {
    const rows = (win.signups ?? []).filter((r) => keep(r.company_id));
    const perDay = (days) => {
      const m = new Map(days.map((d) => [d, new Set()]));
      for (const r of rows) m.get(r.day)?.add(r.company_id);
      return days.map((day) => ({ day, value: m.get(day).size }));
    };
    const distinct = (days) => { const set = new Set(days); return new Set(rows.filter((r) => set.has(r.day)).map((r) => r.company_id)).size; };
    const total = distinct(C); const previous_total = distinct(P);
    return { label: 'Sign-ups', total, previous_total, delta: total - previous_total, current: perDay(C), previous: perDay(P) };
  }, isInternal);
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

const keepCard = (keep) => (i) => i.company_id == null || keep(i.company_id);
const openOwnedBy = (items, owner) => items.filter((i) => i.owner === owner && i.status !== 'closed');
const byStuck = (a, b) => Number(Boolean(b.stuck)) - Number(Boolean(a.stuck)) || num(b.idle_days) - num(a.idle_days) || Number(b.id) - Number(a.id);

export function flaggedCardsPanel(items, isInternal = isInternalCompany) {
  return bothVariants((keep) => table(
    [col('card', 'Card', 'link'), col('type', 'Type', 'badge'), col('status', 'Status', 'badge'), col('idle', 'Idle days', 'num'), col('company', 'Company', 'link')],
    openOwnedBy(items, 'research').filter(keepCard(keep)).sort(byStuck).map((i) => ({
      cells: { card: link(cardTitle(i), cardHash(i.id)), type: KIND_WORDS[i.kind] ?? i.kind, status: STATUS_WORDS[i.status] ?? i.status, idle: num(i.idle_days),
        company: i.company_id == null ? { text: '—', hash: null } : link(i.company_name ?? `Company #${i.company_id}`, companyHash(i.company_id)) },
      href: cardHash(i.id), ...(i.stuck ? { flag: 'stuck' } : {})
    }))
  ), isInternal);
}

/** Pure: live grants whose deadline text is a past date, with their Research card. Today's catalogue. */
export function statusMismatchesPanel(flags, cards) {
  const cardOf = new Map(cards.map((c) => [Number(c.grant_root_id), c]));
  const rows = [...(flags.passed ?? [])].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)) || a.grant_id - b.grant_id).map((g) => {
    const c = cardOf.get(Number(g.grant_id));
    return { cells: { grant: link(g.title, grantHash(g.grant_id)), deadline_text: g.deadline_text ?? '', deadline: g.deadline, over: Math.max(0, -num(g.days)),
      card: c ? link(`#${Number(c.id)} · ${STATUS_WORDS[c.status] ?? c.status}`, cardHash(c.id)) : { text: 'Filed on the next sweep', hash: null } }, href: grantHash(g.grant_id) };
  });
  return same(table([col('grant', 'Grant', 'link'), col('deadline_text', 'Deadline text'), col('deadline', 'Reads as', 'date'), col('over', 'Days past', 'num'), col('card', 'Card', 'link')], rows, 25));
}

/** Pure: live grants with a blank or unreadable deadline (not filed as cards). */
export function deadlineUnreadablePanel(flags) {
  const rows = [...(flags.blank ?? []).map((g) => ({ g, kind: 'Blank' })), ...(flags.unreadable ?? []).map((g) => ({ g, kind: 'Unreadable' }))]
    .map(({ g, kind }) => ({ cells: { grant: link(g.title, grantHash(g.grant_id)), kind, deadline_text: g.deadline_text ?? '' }, href: grantHash(g.grant_id) }));
  const v = table([col('grant', 'Grant', 'link'), col('kind', 'Problem', 'badge'), col('deadline_text', 'Deadline text')], rows);
  const rolling = Array.isArray(flags.rolling) ? flags.rolling.length : num(flags.rolling);
  return { ...same(v), note: `${plural((flags.blank ?? []).length, 'live grant')} with a blank deadline and ${(flags.unreadable ?? []).length} unreadable; ${rolling} rolling ("Open Until Filled" and the like) are fine. Not filed as cards.` };
}

export function upcomingDeadlinesPanel(flags, win, isInternal = isInternalCompany) {
  const lists = buildGrantList(win, { view: 'all', isInternal });
  return bothVariants((keep, name) => {
    const metrics = new Map(lists[name].map((g) => [g.grant_id, g]));
    return table([col('grant', 'Grant', 'link'), col('due', 'Due', 'date'), col('days_left', 'Days left', 'num'), col('clients_matched', 'Clients matched', 'num'), col('opens', 'Opens', 'num')],
      [...(flags.due_soon ?? [])].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)) || a.grant_id - b.grant_id).map((g) => ({
        cells: { grant: link(g.title, grantHash(g.grant_id)), due: g.deadline, days_left: num(g.days),
          clients_matched: metrics.get(g.grant_id)?.clients_matched ?? 0, opens: metrics.get(g.grant_id)?.opens ?? 0 }, href: grantHash(g.grant_id) })));
  }, isInternal);
}

export function askedNotCarriedPanel(rows, names, internalClerks, isInternal = isInternalCompany) {
  return bothVariants((keep, name) => {
    const hits = rows.filter((r) => r.unmet_need && NOT_CARRIED.test(r.unmet_need) && !CONSULTING_NEED.test(r.unmet_need) && !OTHER_NEEDS.test(r.unmet_need))
      .filter(keepRow(keep, internalClerks, name));
    return table([col('question', 'Question', 'link'), col('company', 'Company', 'link'), col('day', 'Day', 'date')],
      hits.map((r) => ({ cells: { question: link(clip(r.question), chatHash(r.conversation_id)), company: plainCompany(r.company_id, names), day: r.day }, href: chatHash(r.conversation_id) })));
  }, isInternal);
}

export function industryCoveragePanel(cov) {
  const build = (v) => table(
    [col('industry', 'Industry', 'link'), col('clients', 'Clients', 'num'), col('restricted', 'Industry grants', 'num'), col('open_to_all', 'Open to every industry', 'num'),
      col('avg_matches', 'Avg matches', 'num'), col('thin', '', 'badge')],
    [...v.industries, ...(v.not_mapped ? [v.not_mapped] : [])]
      .sort((a, b) => b.clients - a.clients || num(b.restricted) - num(a.restricted) || a.industry.localeCompare(b.industry))
      .map((r) => ({ cells: { industry: link(r.industry, industryHash(r.industry)), clients: r.clients, restricted: r.restricted ?? null, open_to_all: r.open_to_all ?? 0,
        avg_matches: r.avg_matches ?? null, thin: r.thin ? 'Thin' : '' }, href: industryHash(r.industry) })), BARS_MAX);
  return { clients: build(cov.clients_variant), all: build(cov.all_variant) };
}

export function goalCoveragePanel(cov) {
  const build = (v) => table(
    [col('track', 'Goal track'), col('clients', 'Clients', 'num'), col('grants_shown', 'Grants shown on track', 'num'), col('empty', 'Empty', 'num'), col('few', 'Few', 'num')],
    [...(v.breakdowns?.goal_tracks ?? [])].sort((a, b) => (b.empty_tracks + b.few_tracks) - (a.empty_tracks + a.few_tracks) || b.clients - a.clients || a.label.localeCompare(b.label))
      .map((t) => ({ cells: { track: t.label, clients: t.clients, grants_shown: t.grants_shown_on_track, empty: t.empty_tracks, few: t.few_tracks }, href: '#coverage' })), 12);
  return { clients: build(cov.clients_variant), all: build(cov.all_variant) };
}

/** Pure: grant matches per clients' profile main industry, now vs before, for one variant. */
export function industryTrends(win, cov, keep) {
  const C = new Set(win.days); const P = new Set(win.previous_days ?? []);
  const mainsOf = new Map();
  const mains = (id) => {
    if (!mainsOf.has(id)) mainsOf.set(id, new Set((cov.clients?.[id]?.industries ?? []).flatMap((v) => profileMains(v))));
    return mainsOf.get(id);
  };
  const cur = new Set(); const prev = new Set();
  for (const r of win.matches ?? []) {
    if (r.company_id == null || !(num(r.times_shown) > 0) || !keep(r.company_id)) continue;
    const k = `${r.company_id}:${r.grant_id}`;
    if (C.has(r.day)) cur.add(k); else if (P.has(r.day)) prev.add(k);
  }
  const by = new Map();
  const bump = (set, field) => { for (const k of set) for (const m of mains(Number(k.split(':')[0]))) { if (!by.has(m)) by.set(m, { industry: m, before: 0, now: 0 }); by.get(m)[field] += 1; } };
  bump(cur, 'now'); bump(prev, 'before');
  return [...by.values()].map((r) => ({ ...r, change: r.now - r.before })).filter((r) => r.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.now - a.now || a.industry.localeCompare(b.industry));
}

export function trendingIndustriesPanel(win, cov, isInternal = isInternalCompany) {
  return bothVariants((keep) => table([col('industry', 'Industry', 'link'), col('before', 'Before', 'num'), col('now', 'Now', 'num'), col('change', 'Change', 'delta')],
    industryTrends(win, cov, keep).map((r) => ({ cells: { industry: link(r.industry, industryHash(r.industry)), before: r.before, now: r.now, change: r.change },
      href: industryHash(r.industry), flag: r.change > 0 ? 'up' : 'down' }))), isInternal);
}

export function ignoredPanel(win, isInternal = isInternalCompany) {
  const lists = buildGrantList(win, { view: 'most_ignored', isInternal });
  return bothVariants((keep, name) => table(
    [col('grant', 'Grant', 'link'), col('displayed_clients', 'Clients shown it', 'num'), col('ignored', 'Never opened it', 'num'), col('opens', 'Opens', 'num')],
    [...lists[name]].sort((a, b) => b.displayed_clients - a.displayed_clients || b.ignored - a.ignored || String(a.title).localeCompare(String(b.title)))
      .map((g) => grantRow(g, { displayed_clients: g.displayed_clients, ignored: g.ignored, opens: g.opens }))
  ), isInternal);
}

/** Pure: grants that went live or were republished in the range, with matches and opens since. */
export function recentLaunchesPanel(changed, win, isInternal = isInternalCompany) {
  const events = new Map();
  const add = (list, event) => { for (const g of list ?? []) { const day = dayOf(g.at); const cur = events.get(g.grant_id); if (!cur || (day ?? '') > (cur.day ?? '')) events.set(g.grant_id, { grant_id: g.grant_id, title: g.title, event, day }); } };
  add(changed.added, 'Went live');
  add(changed.republished, 'Republished');
  return bothVariants((keep) => {
    const rows = [...events.values()].map((e) => {
      const since = (r) => e.day == null || r.day >= e.day;
      const clients = new Set((win.matches ?? []).filter((r) => r.grant_id === e.grant_id && num(r.times_shown) > 0 && keep(r.company_id) && since(r)).map((r) => r.company_id));
      const opens = (win.views ?? []).filter((r) => r.grant_root_id === e.grant_id && keep(r.company_id) && since(r)).reduce((s, r) => s + num(r.sessions), 0);
      return { ...e, clients_since: clients.size, opens_since: opens };
    }).sort((a, b) => String(b.day ?? '').localeCompare(String(a.day ?? '')) || a.title.localeCompare(b.title));
    return table([col('grant', 'Grant', 'link'), col('event', 'Event', 'badge'), col('when', 'When', 'date'), col('clients_since', 'Clients matched since', 'num'), col('opens_since', 'Opens since', 'num')],
      rows.map((e) => ({ cells: { grant: link(e.title, grantHash(e.grant_id)), event: e.event, when: e.day, clients_since: e.clients_since, opens_since: e.opens_since }, href: grantHash(e.grant_id) })));
  }, isInternal);
}

// ---------------------------------------------------------------------------
// Consulting / Sales
// ---------------------------------------------------------------------------

export function consultingCardsPanel(cards, list, isInternal = isInternalCompany) {
  const companies = companyMap(list);
  return bothVariants((keep) => table(
    [col('company', 'Company', 'link'), col('question', 'Question', 'link'), col('status', 'Status', 'badge'), col('idle', 'Idle days', 'num')],
    cards.filter(keepCard(keep)).sort(byStuck).map((i) => {
      const turn = flaggedTurnOf(i.turns, i.flagged_turn_index);
      const names = new Map(i.company_name ? [[i.company_id, i.company_name]] : []);
      return { cells: { company: companyCell(companies.get(i.company_id), i.company_id, names), question: link(clip(turn?.client) || cardTitle(i), cardHash(i.id)),
        status: STATUS_WORDS[i.status] ?? i.status, idle: num(i.idle_days) }, href: cardHash(i.id), ...(i.stuck ? { flag: 'stuck' } : {}) };
    })
  ), isInternal);
}

export function helpWeSellPanel(rows, list, names, internalClerks, isInternal = isInternalCompany) {
  const companies = companyMap(list);
  return bothVariants((keep, name) => table(
    [col('company', 'Company', 'link'), col('question', 'Question', 'link'), col('answer', 'Chat reply', 'badge'), col('day', 'Day', 'date')],
    rows.filter((r) => r.unmet_need && CONSULTING_NEED.test(r.unmet_need)).filter(keepRow(keep, internalClerks, name)).map((r) => ({
      cells: { company: companyCell(companies.get(r.company_id), r.company_id, names), question: link(clip(r.question), chatHash(r.conversation_id)),
        answer: [ANSWER_WORDS[r.answer] ?? '', r.unanswered_reason ? REASON_WORDS[r.unanswered_reason] : null].filter(Boolean).join(' · '), day: r.day },
      href: chatHash(r.conversation_id) }))
  ), isInternal);
}

/** Pure: companies that asked the chat about, or opened the card of, a grant worth BIG_GRANT_VALUE or more. */
export function bigMoneyPanel(rows, win, grants, list, names, internalClerks, C, isInternal = isInternalCompany) {
  const big = new Map(grants.filter((g) => num(g.value) >= BIG_GRANT_VALUE).map((g) => [g.root_id, { title: g.title, value: num(g.value) }]));
  const inC = new Set(C);
  const companies = companyMap(list);
  const ids = (v) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return bothVariants((keep, name) => {
    const seen = new Map();
    const note = (company_id, grant_id, how, day, hash) => {
      const k = `${company_id}:${grant_id}:${how}`;
      if (!seen.has(k) || seen.get(k).day < day) seen.set(k, { company_id, grant_id, how, day, hash });
    };
    for (const r of rows.filter(keepRow(keep, internalClerks, name))) {
      if (r.company_id == null) continue;
      for (const id of new Set([...ids(r.cards_shown), ...ids(r.grants_named)])) if (big.has(id)) note(r.company_id, id, 'Asked in chat', r.day, chatHash(r.conversation_id));
    }
    for (const r of win.views ?? []) {
      if (!inC.has(r.day) || r.company_id == null || !keep(r.company_id) || !big.has(r.grant_root_id) || !(num(r.sessions) > 0)) continue;
      note(r.company_id, r.grant_root_id, 'Opened the card', r.day, grantHash(r.grant_root_id));
    }
    return table([col('company', 'Company', 'link'), col('grant', 'Grant', 'link'), col('value', 'Value', 'money'), col('how', 'How', 'badge'), col('day', 'Day', 'date')],
      [...seen.values()].sort((a, b) => b.day.localeCompare(a.day) || b.company_id - a.company_id).map((e) => ({
        cells: { company: companyCell(companies.get(e.company_id), e.company_id, names), grant: link(big.get(e.grant_id).title, grantHash(e.grant_id)),
          value: big.get(e.grant_id).value, how: e.how, day: e.day }, href: e.hash })));
  }, isInternal);
}

export function mostEngagedPanel(list, goals, C, isInternal = isInternalCompany) {
  const inC = new Set(C);
  const goalCount = new Map();
  for (const g of goals ?? []) if (inC.has(g.day)) goalCount.set(g.company_id, (goalCount.get(g.company_id) ?? 0) + 1);
  return bothVariants((keep) => table(
    [col('company', 'Company', 'link'), col('goals', 'Goal tracks set', 'num'), col('cards_opened', 'Cards opened', 'num'), col('chats', 'Chats', 'num'), col('last_active', 'Last active')],
    (list.companies ?? []).filter((c) => keep(c.id)).map((c) => ({ c, goals: goalCount.get(c.id) ?? 0, score: (goalCount.get(c.id) ?? 0) + num(c.cards_opened) + num(c.chats) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || String(b.c.last_active ?? '').localeCompare(String(a.c.last_active ?? '')) || a.c.name.localeCompare(b.c.name))
      .map(({ c, goals: n }) => ({ cells: { company: companyCell(c), goals: n, cards_opened: num(c.cards_opened), chats: num(c.chats),
        last_active: c.last_active ? dayWords(c.last_active) : 'No activity yet' }, href: companyHash(c.id) }))
  ), isInternal);
}

/** Pure: signed up in the range, and set a goal track and opened a card within FAST_DAYS of signing up. */
export function fastStartersPanel(list, firstActions, C, isInternal = isInternalCompany) {
  const inC = new Set(C);
  const first = new Map(firstActions.map((r) => [Number(r.company_id), { goal: dayOf(r.first_goal), open: dayOf(r.first_open) }]));
  return bothVariants((keep) => table(
    [col('company', 'Company', 'link'), col('signed_up', 'Signed up', 'date'), col('first_goal', 'First goal track', 'date'), col('first_open', 'First card open', 'date'), col('plan', 'Plan')],
    (list.companies ?? []).filter((c) => keep(c.id) && c.signed_up && inC.has(c.signed_up)).map((c) => ({ c, f: first.get(c.id) }))
      .filter(({ c, f }) => f?.goal && f?.open && f.goal <= addDays(c.signed_up, FAST_DAYS) && f.open <= addDays(c.signed_up, FAST_DAYS))
      .sort((a, b) => b.c.signed_up.localeCompare(a.c.signed_up) || a.c.name.localeCompare(b.c.name))
      .map(({ c, f }) => ({ cells: { company: companyCell(c), signed_up: c.signed_up, first_goal: f.goal, first_open: f.open, plan: dash(c.plan) }, href: companyHash(c.id) }))
  ), isInternal);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return {
    hubQuery: hubQueryDefault, appQuery: appQueryDefault, storeQuery: hubQueryDefault, now: () => new Date(),
    liveGrants: liveGrantsDefault, coverage: coverageDefault, changes: changesDefault, loadGrantWindow: loadGrantWindowDefault,
    chatOverview: chatOverviewDefault, listItems: listItemsDefault, companyList: companyListDefault, deadlineFlags: deadlineFlagsDefault,
    internalClerkIds: () => internalClerkIdsDefault(), isInternal: isInternalCompany
  };
}

/** A panel's error in words the page can show: not configured, a missing table, or anything else. */
export function errorCode(err) {
  if (err?.code === 'not_configured' || err?.name === 'NotConfiguredError') return 'not_configured';
  if (err?.code === '42P01') return 'migration_missing';
  return 'error';
}

const seeAll = (label, hash, range) => ({ label, hash, ...(range ? { range } : {}) });
export const META = Object.freeze({
  chat_themes: { title: 'Chat themes', kind: 'table', note: 'Clients only, with an example question each.', see_all: seeAll('Chat themes', '#chat') },
  howto_unanswered: { title: 'Unanswered how-to questions', kind: 'table', note: 'Unanswered questions (no answer, asked for a person, left after a bad reply) whose wording asks how to do something.', see_all: seeAll('Chat themes, unanswered', '#chat?sort=left_after') },
  most_matched: { title: 'Most matched grants', kind: 'table', see_all: seeAll('Grants', '#grants') },
  most_opened: { title: 'Most opened grants', kind: 'table', see_all: seeAll('Grants, most opened', '#grants?sort=opens&dir=desc') },
  trending_grants: { title: 'Trending grants', kind: 'table', note: 'Clients matched now vs the previous period of the same length: the five biggest rises and the five biggest drops.', see_all: seeAll('Grants', '#grants') },
  timely: { title: 'Timely grants', kind: 'table', note: `Went live in the range, or due within ${DUE_SOON_DAYS} days of today.`, see_all: seeAll('Coverage & changes', '#coverage') },
  goal_demand: { title: 'Demand by goal type', kind: 'bars', note: 'Goal tracks set in the range; the faint bar is the previous period.' },
  demand_industry: { title: 'Demand by industry', kind: 'table', note: "Clients by profile industry (today) and the grant matches they were shown in the range.", see_all: seeAll('Coverage', '#coverage') },
  demand_province: { title: 'Demand by province', kind: 'table', see_all: seeAll('Coverage', '#coverage') },
  found_via: { title: 'How clients find grants', kind: 'bars', note: 'Grant card opens by where the card was opened from; the faint bar is the previous period.' },
  totals: { title: 'Totals for the range', kind: 'tiles', wide: true },
  signups: { title: 'Sign-ups', kind: 'series' },
  flagged_cards: { title: 'Flagged cards', kind: 'table', note: `Open review cards owned by Research. Stuck = no activity for ${STUCK_DAYS}+ days.`, see_all: seeAll('Review queue, Research', '#review?owner=research') },
  status_mismatches: { title: 'Status mismatches', kind: 'table', wide: true, note: "Live grants whose deadline text is a date before today — today's catalogue, not the range. Each is filed as a Research card by the hourly sweep.", see_all: seeAll('Coverage & changes', '#coverage') },
  deadline_unreadable: { title: 'No readable deadline', kind: 'table', see_all: seeAll('Coverage & changes', '#coverage') },
  upcoming_deadlines: { title: 'Upcoming deadlines', kind: 'table', note: `Due within ${DUE_SOON_DAYS} days of today; matches and opens follow the range.`, see_all: seeAll('Coverage & changes', '#coverage') },
  asked_not_carried: { title: "Grants asked for that GetGranted doesn't carry", kind: 'table', note: "From the daily chat review's unmet needs. Only the rewritten question is stored, so the program's name appears inside it.", see_all: seeAll('Chat themes', '#chat') },
  industry_coverage: { title: 'Industry coverage', kind: 'table', wide: true, note: "Clients by profile industry against industry-restricted grants, today's catalogue. Thin = 2+ clients ran matching and averaged under 3 grant matches.", see_all: seeAll('Coverage', '#coverage') },
  goal_coverage: { title: 'Goal coverage', kind: 'table', note: "Each client's latest matching run in the range: tracks that showed 0 (empty) or under 3 (few) grants.", see_all: seeAll('Coverage', '#coverage') },
  trending_industries: { title: 'Trending industries', kind: 'table', note: "Grant matches by clients' profile industry, now vs the previous period." },
  ignored: { title: 'Ignored cards', kind: 'table', note: 'Grants shown on goal tracks to 3+ clients, ranked by how many clients saw them and never opened them.', see_all: seeAll('Grants, most ignored', '#grants?view=most_ignored') },
  recent_launches: { title: 'Recent launches', kind: 'table', note: 'Published as active or republished in the range, with clients matched and opens since that day.', see_all: seeAll('Coverage & changes', '#coverage') },
  consulting_cards: { title: 'Consulting questions', kind: 'table', wide: true, note: 'Open review cards owned by Consulting. Company · size · revenue · plan.', see_all: seeAll('Review queue, Consulting', '#review?owner=consulting') },
  help_we_sell: { title: 'Clients asking for help we sell', kind: 'table', wide: true, note: 'Chat messages the daily review labelled as an unmet need for consulting or application writing.', see_all: seeAll('Chat themes', '#chat') },
  big_money: { title: 'Interest in big-money grants', kind: 'table', wide: true, note: `Grants valued at $${BIG_GRANT_VALUE.toLocaleString('en-CA')} or more (the app's grants.value), asked about in chat or opened as a card in the range.`, see_all: seeAll('Grants', '#grants') },
  most_engaged: { title: 'Most engaged clients', kind: 'table', wide: true, note: 'Goal tracks set, cards opened and chats in the range.', see_all: seeAll('Companies', '#companies') },
  fast_starters: { title: 'Fast starters', kind: 'table', wide: true, note: `Signed up in the range and set a goal track and opened a grant card within ${FAST_DAYS} days.`, see_all: seeAll('Companies', '#companies') }
});

const cache = new Map();

/** The three departments for a range (cached CACHE_MS per range). */
export async function departmentViews(range = 'month', overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const rangeProblem = rangeError(range, now);
  if (rangeProblem) throw new ViewsError(400, rangeProblem);
  const hit = cache.get(range);
  if (hit && now.getTime() - hit.at < CACHE_MS && !overrides.noCache) return hit.value;

  const w = windowsFor(range, now);
  const today = vancouverDay(now);
  const { from, to } = w.current;
  const C = w.current.days;
  const P = w.previous.days;
  const settle = (p) => Promise.resolve().then(p).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  // The four window readers each read the app DB's small read-only pool hard
  // (APP_POOL_MAX connections, 5 s to get one). Run together on a cold cache
  // they time out waiting for a connection, so they go one after another; the
  // other app reads form a second chain beside them. Hub reads run freely.
  const sequential = async (tasks) => {
    const out = [];
    for (const t of tasks) out.push(await settle(t));
    return out;
  };
  const named = (rows) => withCompanyNames(rows, { query: deps.appQuery }).catch(() => rows);
  const [[cov, win, list, chat], [grants, changed, goals, firstActions], [items, chatRows, deadlineCards, consultingCards]] = await Promise.all([
    sequential([
      () => deps.coverage(range),
      () => deps.loadGrantWindow(range),
      () => deps.companyList(range),
      () => deps.chatOverview(range)
    ]),
    sequential([
      () => deps.liveGrants({ query: deps.appQuery }),
      () => deps.changes(range),
      () => deps.appQuery(GOALS_SQL, [w.previous.from, to]).then((r) => r.rows),
      () => deps.appQuery(FIRST_ACTIONS_SQL, [from, to]).then((r) => r.rows)
    ]),
    Promise.all([
      settle(() => deps.listItems().then(named)),
      settle(async () => {
        const rows = (await deps.storeQuery(CHAT_ROWS_SQL, [from, to])).rows;
        const [names, internalClerks] = await Promise.all([
          companyNamesForIds(rows.map((r) => r.company_id), { query: deps.appQuery }).catch(() => new Map()),
          deps.internalClerkIds().catch(() => new Set())
        ]);
        return { rows, names, internalClerks };
      }),
      settle(() => deps.hubQuery(DEADLINE_CARDS_SQL).then((r) => r.rows)),
      settle(() => deps.hubQuery(CONSULTING_CARDS_SQL).then((r) => named(r.rows)))
    ])
  ]);
  const flags = grants.ok ? await settle(() => deps.deadlineFlags(grants.value, today)) : grants;

  const panel = (key, sources, build) => {
    const failed = sources.find((s) => !s.ok);
    const base = { key, ...META[key] };
    if (failed) {
      console.error(`Control Centre views ${key} failed (code: ${failed.error?.code || failed.error?.name || 'unknown'})`);
      return { ...base, error: errorCode(failed.error) };
    }
    try {
      return { ...base, ...build(...sources.map((s) => s.value)) };
    } catch (error) {
      console.error(`Control Centre views ${key} failed (code: ${error?.code || error?.name || 'unknown'})`);
      return { ...base, error: 'error' };
    }
  };
  const isInternal = deps.isInternal;

  const value = {
    range,
    current: { from, to },
    previous: { from: w.previous.from, to: w.previous.to },
    today,
    departments: {
      research: [
        panel('flagged_cards', [items], (it) => flaggedCardsPanel(it, isInternal)),
        panel('status_mismatches', [flags, deadlineCards], (f, cards) => statusMismatchesPanel(f, cards)),
        panel('deadline_unreadable', [flags], (f) => deadlineUnreadablePanel(f)),
        panel('upcoming_deadlines', [flags, win], (f, w2) => upcomingDeadlinesPanel(f, w2, isInternal)),
        panel('asked_not_carried', [chatRows], (c) => askedNotCarriedPanel(c.rows, c.names, c.internalClerks, isInternal)),
        panel('industry_coverage', [cov], (c) => industryCoveragePanel(c)),
        panel('goal_coverage', [cov], (c) => goalCoveragePanel(c)),
        panel('trending_grants', [win], (w2) => trendingGrantsPanel(w2, isInternal)),
        panel('trending_industries', [win, cov], (w2, c) => trendingIndustriesPanel(w2, c, isInternal)),
        panel('ignored', [win], (w2) => ignoredPanel(w2, isInternal)),
        panel('recent_launches', [changed, win], (ch, w2) => recentLaunchesPanel(ch, w2, isInternal))
      ],
      consulting: [
        panel('consulting_cards', [consultingCards, list], (cards, l) => consultingCardsPanel(cards, l, isInternal)),
        panel('help_we_sell', [chatRows, list], (c, l) => helpWeSellPanel(c.rows, l, c.names, c.internalClerks, isInternal)),
        panel('big_money', [chatRows, win, grants, list], (c, w2, g, l) => bigMoneyPanel(c.rows, w2, g, l, c.names, c.internalClerks, C, isInternal)),
        panel('most_engaged', [list, goals], (l, g) => mostEngagedPanel(l, g, C, isInternal)),
        panel('fast_starters', [list, firstActions], (l, f) => fastStartersPanel(l, f, C, isInternal))
      ],
      marketing: [
        panel('chat_themes', [chat], (c) => chatThemesPanel(c)),
        panel('howto_unanswered', [chatRows], (c) => howtoPanel(c.rows, c.names, c.internalClerks, isInternal)),
        panel('most_matched', [win], (w2) => mostMatchedPanel(w2, isInternal)),
        panel('most_opened', [win], (w2) => mostOpenedPanel(w2, isInternal)),
        panel('trending_grants', [win], (w2) => trendingGrantsPanel(w2, isInternal)),
        panel('timely', [changed, flags, win], (ch, f, w2) => timelyPanel(ch, f, w2, isInternal)),
        panel('goal_demand', [goals], (g) => goalDemandPanel(g, C, P, isInternal)),
        panel('demand_industry', [cov], (c) => demandIndustryPanel(c)),
        panel('demand_province', [cov], (c) => demandProvincePanel(c)),
        panel('found_via', [win], (w2) => foundViaPanel(w2, C, P, isInternal)),
        panel('totals', [win, goals], (w2, g) => totalsPanel(w2, g, C, isInternal)),
        panel('signups', [win], (w2) => signupsPanel(w2, C, P, isInternal))
      ]
    },
    generated_at: new Date(now).toISOString()
  };
  // A failed panel isn't kept: the next load tries its source again.
  const failed = Object.values(value.departments).flat().some((p) => p.error);
  if (!overrides.noCache && !failed) { cache.set(range, { at: now.getTime(), value }); trimCache(cache); }
  return value;
}

export function _clearCacheForTests() { cache.clear(); }
