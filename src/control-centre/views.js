/**
 * Control Centre — Department views (the landing page). Reads only.
 *
 *   departmentViews(range)   three short snapshots, Research, Consulting/Sales
 *                            and Marketing, each a few items built from what the
 *                            other tabs already read; every item links through
 *                            to the tab (and filter) that holds the detail
 *
 * Nothing here is a new source. It composes the tabs' own functions — each
 * keeps its own 5-minute cache — and reads one more Hub table directly
 * (cc_chat_questions, grouped by company). An item whose source fails comes
 * back as {error} and the rest still render.
 *
 * Every item: { key, label (the question it answers), note?, error? | clients, all }
 * where clients / all are the two variants (internal accounts left out / in) and
 * each is { headline: {n, words}, counts: [{n, words}], sub?, line?, groups:
 * [{title, rows: [{title, meta, detail?, hash}], see_all: {label, hash, range?}}] }. A see_all
 * with a range opens the tab on that range (the item's own fixed window).
 * An item shows at most MAX_ROWS rows across its groups.
 *
 * Fixed windows, whatever the range: deadlines (next HYGIENE_DAYS days), quiet
 * clients (shown matches in the last 30 days, no client action for
 * QUIET_DAYS), new grants and "what changed" (the last 7 days).
 * Docs: docs/control-centre.md, Department views.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault } from './db.js';
import { vancouverDay, addDays } from './rollup.js';
import { windowsFor, OPEN_SOURCES, openSourceKey, rangeError, trimCache } from './overview.js';
import { liveGrants as liveGrantsDefault } from './live-sources.js';
import { companyNamesForIds, withCompanyNames, internalClerkIds as internalClerkIdsDefault } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { cardTitle } from './card-summary.js';
import { tokenMains } from './industry-vocabulary.js';
import { coverage as coverageDefault, changes as changesDefault, deadlineHygiene, clientIndustries, HYGIENE_DAYS } from './coverage.js';
import { loadGrantWindow as loadGrantWindowDefault, buildGrantList } from './grants.js';
import { listItems as listItemsDefault, STUCK_DAYS } from './review-queue.js';
import { chatOverview as chatOverviewDefault } from './chat-themes.js';
import { companyList as companyListDefault } from './companies.js';

export const MAX_ROWS = 5;
export const QUIET_DAYS = 14;
export const CACHE_MS = 5 * 60 * 1000;
export const DEPARTMENTS = Object.freeze(['research', 'consulting', 'marketing']);

export class ViewsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ViewsError';
    this.status = status;
  }
}

// Hub: the daily chat review's questions that went unanswered or named an
// unmet need, for grouping by company (migration 049).
export const CHAT_SIGNALS_SQL = `
  SELECT day::text AS day, conversation_id, clerk_id, company_id, question, theme, unanswered_reason, unmet_need
    FROM cc_chat_questions
   WHERE day BETWEEN $1::date AND $2::date
     AND (unanswered_reason IS NOT NULL OR unmet_need IS NOT NULL)
   ORDER BY day DESC, conversation_id DESC, turn_index`;

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
const grantHash = (id) => `#grants/${id}`;
const companyHash = (id) => `#companies/${id}`;
const industryHash = (name) => `#coverage/industry/${encodeURIComponent(name)}`;

/**
 * Pure: at most `max` rows across the groups, handed out in turn (one each,
 * then again) so every group with rows shows at least one.
 */
export function capRows(groups, max = MAX_ROWS) {
  const take = groups.map(() => 0);
  let left = max;
  let moved = true;
  while (left > 0 && moved) {
    moved = false;
    groups.forEach((g, i) => {
      if (left > 0 && take[i] < g.rows.length) { take[i] += 1; left -= 1; moved = true; }
    });
  }
  return groups.map((g, i) => ({ ...g, rows: g.rows.slice(0, take[i]) }));
}

const body = ({ headline, counts = [], sub = null, line = null, groups = [] }) =>
  ({ headline, counts, sub, line, groups: capRows(groups) });

/** Both variants from one builder: `keep(companyId)` leaves internal accounts out of `clients`. */
const bothVariants = (build, isInternal) => ({
  clients: build((id) => !isInternal(id), 'clients'),
  all: build(() => true, 'all')
});

/** Pure: per grant, where its cards were opened from (sessions), for one variant. */
export function sourcesByGrant(views, keep) {
  const out = new Map();
  for (const r of views) {
    if (r.company_id != null && !keep(r.company_id)) continue;
    const n = Number(r.sessions) || 0;
    if (!n) continue;
    if (!out.has(r.grant_root_id)) out.set(r.grant_root_id, new Map());
    const m = out.get(r.grant_root_id);
    const k = openSourceKey(r.source);
    m.set(k, (m.get(k) ?? 0) + n);
  }
  return out;
}

const SOURCE_LABEL = new Map(OPEN_SOURCES.map((s) => [s.key, s.key === 'other' ? 'direct links' : s.label]));
/** "found through Goal tracks (3), Chat (1)", or null when no opens. */
export function foundWords(bySource) {
  if (!bySource || !bySource.size) return null;
  const parts = [...bySource].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${SOURCE_LABEL.get(k) ?? k} (${n})`);
  return `found through ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export function deadlineItem(grants, today) {
  const h = deadlineHygiene(grants, today);
  const missing = [...h.blank, ...h.unreadable];
  const b = body({
    headline: { n: h.passed.length, words: 'live grants past their deadline' },
    counts: [
      { n: h.due_within.length, words: `due in the next ${h.days} days` },
      { n: missing.length, words: 'with a blank or unreadable deadline' }
    ],
    sub: `${plural(h.rolling, 'grant')} with a rolling deadline ("Open Until Filled" and the like) aren't counted as a problem.`,
    groups: [
      { title: 'Past deadline', rows: h.passed.map((g) => ({ title: g.title, meta: `Deadline was ${dayWords(g.deadline)}`, hash: grantHash(g.grant_id) })),
        see_all: { label: 'Coverage & changes', hash: '#coverage' } },
      { title: `Due in the next ${h.days} days`, rows: h.due_within.map((g) => ({ title: g.title, meta: `Due ${dayWords(g.deadline)}`, hash: grantHash(g.grant_id) })),
        see_all: { label: 'Coverage & changes', hash: '#coverage' } },
      { title: 'Blank or unreadable', rows: missing.map((g) => ({ title: g.title, meta: g.deadline_text ? `Says "${clip(g.deadline_text, 60)}"` : 'Blank', hash: grantHash(g.grant_id) })),
        see_all: { label: 'Grants', hash: '#grants' } }
    ]
  });
  return { clients: b, all: b };
}

const KIND_WORDS = { match: 'Match', chat: 'Chat', grant_pattern: 'Grant pattern', empty_track: 'Empty track' };
const STATUS_WORDS = { new: 'new', diagnosed: 'diagnosed', in_progress: 'in progress', closed: 'closed' };
const cardRow = (i, meta) => ({ title: cardTitle(i), meta, hash: `#review/${Number(i.id)}` });
const openResearch = (items) => items.filter((i) => i.owner === 'research' && i.status !== 'closed');
const keepCard = (keep) => (i) => i.company_id == null || keep(i.company_id);

export function cardsLookWrongItem(items, grantList, isInternal = isInternalCompany) {
  return bothVariants((keep, name) => {
    const cards = openResearch(items).filter(keepCard(keep));
    const ignored = grantList[name];
    return body({
      headline: { n: cards.length, words: 'open review cards owned by Research' },
      counts: [{ n: ignored.length, words: 'grants shown to 3+ clients, ranked by how many never opened them' }],
      groups: [
        { title: 'Open Research cards', rows: cards.map((i) => cardRow(i, `${KIND_WORDS[i.kind] ?? i.kind} · ${STATUS_WORDS[i.status] ?? i.status}`)),
          see_all: { label: 'Review queue, Research', hash: '#review?owner=research' } },
        { title: 'Shown but never opened', rows: ignored.map((g) => ({ title: g.title, meta: `${g.ignored} of ${g.displayed_clients} clients never opened it`, hash: grantHash(g.grant_id) })),
          see_all: { label: 'Grants, most ignored', hash: '#grants?view=most_ignored' } }
      ]
    });
  }, isInternal);
}

export function coverageGapsItem(cov, notMatching) {
  const build = (variant, name) => {
    const thin = variant.industries.flatMap((r) => [r, ...r.specifics]).filter((r) => r.thin)
      .sort((a, b) => (a.avg_matches ?? 0) - (b.avg_matches ?? 0) || b.clients - a.clients);
    const none = notMatching[name];
    return body({
      headline: { n: thin.length, words: 'thin industries (clients who ran matching average under 3 grant matches)' },
      counts: [{ n: none.length, words: 'live grants matched to no one in the range' }],
      groups: [
        { title: 'Thin industries', rows: thin.map((r) => ({ title: r.industry, meta: `${plural(r.ran_matching, 'client')} ran matching · ${r.avg_matches} grant matches on average`, hash: industryHash(r.industry) })),
          see_all: { label: 'Coverage', hash: '#coverage' } },
        { title: 'Matching no one', rows: none.map((g) => ({ title: g.title, meta: g.last_matched ? `Last matched ${dayWords(g.last_matched)}` : 'Never matched', hash: grantHash(g.grant_id) })),
          see_all: { label: 'Grants, not matching', hash: '#grants?view=not_matching' } }
      ]
    });
  };
  return { clients: build(cov.clients_variant, 'clients'), all: build(cov.all_variant, 'all') };
}

export function stuckItem(items, isInternal = isInternalCompany) {
  return bothVariants((keep) => {
    const stuck = openResearch(items).filter((i) => i.stuck).filter(keepCard(keep))
      .sort((a, b) => (b.idle_days ?? 0) - (a.idle_days ?? 0));
    return body({
      headline: { n: stuck.length, words: `Research cards with no activity for ${STUCK_DAYS}+ days` },
      groups: [{ title: 'Stuck', rows: stuck.map((i) => cardRow(i, `No activity for ${plural(i.idle_days ?? STUCK_DAYS, 'day')} · ${STATUS_WORDS[i.status] ?? i.status}`)),
        see_all: { label: 'Review queue, Research', hash: '#review?owner=research' } }]
    });
  }, isInternal);
}

// ---------------------------------------------------------------------------
// Consulting / Sales
// ---------------------------------------------------------------------------

export function quietClientsItem(list, isInternal = isInternalCompany) {
  const today = list.current.to;
  const cutoff = addDays(today, -QUIET_DAYS);
  return bothVariants((keep) => {
    const shown = list.companies.filter((c) => keep(c.id) && c.grant_matches > 0);
    const quiet = shown.filter((c) => c.last_active <= cutoff).sort((a, b) => a.last_active.localeCompare(b.last_active));
    const unopened = shown.filter((c) => c.cards_opened === 0).sort((a, b) => b.grant_matches - a.grant_matches);
    return body({
      headline: { n: quiet.length, words: `clients with grant matches and no client activity for ${QUIET_DAYS}+ days` },
      counts: [{ n: unopened.length, words: 'shown grant matches in the last 30 days and opened none' }],
      groups: [
        { title: `Quiet ${QUIET_DAYS}+ days`, rows: quiet.map((c) => ({ title: c.name, meta: `Last active ${dayWords(c.last_active)} · ${plural(c.grant_matches, 'grant match', 'grant matches')}`, hash: companyHash(c.id) })),
          see_all: { label: 'Companies, least recently active', hash: '#companies?sort=last_active&dir=asc', range: 'month' } },
        { title: 'Shown matches, opened none', rows: unopened.map((c) => ({ title: c.name, meta: `${plural(c.grant_matches, 'grant match', 'grant matches')}, none opened`, hash: companyHash(c.id) })),
          see_all: { label: 'Companies', hash: '#companies?sort=cards_opened&dir=asc', range: 'month' } }
      ]
    });
  }, isInternal);
}

/** Pure: unanswered / unmet rows → per company, most signals first. */
export function signalsByCompany(rows, names) {
  const by = new Map();
  for (const r of rows) {
    const key = r.company_id ?? 'none';
    if (!by.has(key)) by.set(key, { company_id: r.company_id ?? null, unanswered: 0, unmet: 0, example: null, needs: new Set() });
    const c = by.get(key);
    if (r.unanswered_reason) c.unanswered += 1;
    if (r.unmet_need) { c.unmet += 1; c.needs.add(r.unmet_need); }
    if (!c.example) c.example = r.question;
  }
  return [...by.values()]
    .map((c) => ({ ...c, needs: [...c.needs], name: c.company_id == null ? 'Company not recorded' : names.get(c.company_id) ?? `Company #${c.company_id}` }))
    .sort((a, b) => (b.unanswered + b.unmet) - (a.unanswered + a.unmet) || b.unmet - a.unmet || String(a.name).localeCompare(String(b.name)));
}

export function paidWorkItem(rows, names, internalClerks, isInternal = isInternalCompany) {
  return bothVariants((keep, name) => {
    const vRows = name === 'all' ? rows
      : rows.filter((r) => (r.company_id != null ? keep(r.company_id) : !internalClerks.has(r.clerk_id)));
    const companies = signalsByCompany(vRows, names);
    const known = companies.filter((c) => c.company_id != null).length;
    return body({
      headline: { n: known, words: 'companies with unanswered questions or unmet needs in chat' },
      counts: [
        { n: vRows.filter((r) => r.unanswered_reason).length, words: 'questions left unanswered' },
        { n: vRows.filter((r) => r.unmet_need).length, words: 'unmet needs' }
      ],
      groups: [{ title: 'By company', rows: companies.map((c) => ({
        title: c.name,
        meta: [c.unanswered && plural(c.unanswered, 'unanswered question'), c.unmet && `${plural(c.unmet, 'unmet need')} (${c.needs.slice(0, 2).join(', ')})`].filter(Boolean).join(' · '),
        detail: c.example ? `“${clip(c.example)}”` : null,
        hash: c.company_id != null ? companyHash(c.company_id) : '#chat'
      })), see_all: { label: 'Chat themes', hash: '#chat' } }]
    });
  }, isInternal);
}

/** Pure: how many of the variant's clients a grant could reach, by its industry tag. */
export function clientsForGrant(grant, clients) {
  if (!grant || !grant.level) return null;
  if (grant.level === 'agnostic') return { n: clients.length, open_to_all: true };
  const mains = new Set((grant.tokens ?? []).flatMap(tokenMains));
  const n = clients.filter((c) => [...clientIndustries(c.industries).mains].some((m) => mains.has(m))).length;
  return { n, open_to_all: false };
}

export function newGrantsItem(changed, cov) {
  const clientsOf = (keep) => Object.entries(cov.clients).filter(([id]) => keep(Number(id))).map(([, c]) => c);
  const build = (clients) => {
    const rows = changed.added.map((g) => ({ g, reach: clientsForGrant(cov.grants[g.grant_id], clients) }))
      .sort((a, b) => (b.reach?.n ?? -1) - (a.reach?.n ?? -1) || String(a.g.title).localeCompare(String(b.g.title)))
      .map(({ g, reach }) => ({
        title: g.title,
        meta: `Went live ${dayWords(g.at)} · ${!reach ? 'industry not tagged yet'
          : reach.open_to_all ? `open to every industry, all ${plural(reach.n, 'client')}` : `${plural(reach.n, 'client')} in its industries`}`,
        hash: grantHash(g.grant_id)
      }));
    return body({
      headline: { n: changed.added.length, words: 'grants went live in the last 7 days' },
      groups: [{ title: 'Went live', rows, see_all: { label: 'Coverage & changes', hash: '#coverage' } }]
    });
  };
  return { clients: build(clientsOf((id) => !cov.clients[id]?.internal)), all: build(clientsOf(() => true)) };
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export function askedItem(chat) {
  const build = (v) => body({
    headline: { n: v.unanswered.reduce((s, g) => s + g.count, 0), words: 'client questions left unanswered' },
    counts: [{ n: v.unmet_needs.reduce((s, g) => s + g.count, 0), words: 'unmet needs' }],
    sub: chat.store.ok ? null : "The nightly chat review isn't set up, so there are no themes yet.",
    groups: [{ title: 'Top themes (clients only)', rows: chat.themes.filter((t) => t.current > 0).map((t) => ({
      title: t.theme, meta: plural(t.current, 'question'),
      detail: t.examples[0] ? `“${clip(t.examples[0].question)}”` : null, hash: '#chat'
    })), see_all: { label: 'Chat themes', hash: '#chat' } }]
  });
  return { clients: build(chat.clients_variant), all: build(chat.all_variant) };
}

export function engagementItem(win, chat, isInternal = isInternalCompany) {
  const lists = buildGrantList(win, { view: 'all', isInternal });
  const ignoredLists = buildGrantList(win, { view: 'most_ignored', isInternal });
  const titles = new Map(win.grants.map((g) => [g.root_id, g.title]));
  return bothVariants((keep, name) => {
    const found = sourcesByGrant(win.views, keep);
    const why = (id) => foundWords(found.get(id));
    const opened = lists[name].filter((g) => g.opens > 0).sort((a, b) => b.opens - a.opens || String(a.title).localeCompare(String(b.title)));
    const discussed = chat[`${name}_variant`].grants_discussed;
    return body({
      headline: { n: opened.reduce((s, g) => s + g.opens, 0), words: 'grant cards opened' },
      counts: [{ n: ignoredLists[name].length, words: 'grants shown to 3+ clients, ranked by how many never opened them' }],
      groups: [
        { title: 'Most opened', rows: opened.map((g) => ({ title: g.title, meta: [plural(g.opens, 'open'), why(g.grant_id)].filter(Boolean).join(' · '), hash: grantHash(g.grant_id) })),
          see_all: { label: 'Grants, most opened', hash: '#grants?sort=opens&dir=desc' } },
        { title: 'Most discussed in chat', rows: discussed.map((g) => ({
          title: chat.grants[g.grant_id] ?? titles.get(g.grant_id) ?? `Grant #${g.grant_id}`,
          meta: [plural(g.chats, 'chat'), why(g.grant_id) ?? 'not opened as a card'].join(' · '), hash: grantHash(g.grant_id) })),
          see_all: { label: 'Chat themes', hash: '#chat' } },
        { title: 'Shown, never opened', rows: ignoredLists[name].map((g) => ({ title: g.title, meta: `Shown on goal tracks to ${plural(g.displayed_clients, 'client')}, ${g.ignored} never opened it`, hash: grantHash(g.grant_id) })),
          see_all: { label: 'Grants, most ignored', hash: '#grants?view=most_ignored' } }
      ]
    });
  }, isInternal);
}

/** Restricted-grant thresholds for "don't line up". Open-to-every-industry grants are the same on every row, so they're left out. */
export const MANY_GRANTS = 3;
export const FEW_CLIENTS = 1;
export const MANY_CLIENTS = 2;
export const FEW_GRANTS_FOR = 1;

export function mismatchItem(cov) {
  const build = (variant) => {
    const flat = variant.industries.flatMap((r) => [r, ...r.specifics]).filter((r) => r.restricted != null && !r.general);
    const grantsHeavy = flat.filter((r) => r.restricted >= MANY_GRANTS && r.clients <= FEW_CLIENTS)
      .sort((a, b) => b.restricted - a.restricted || a.industry.localeCompare(b.industry));
    const clientsHeavy = flat.filter((r) => r.clients >= MANY_CLIENTS && r.restricted <= FEW_GRANTS_FOR)
      .sort((a, b) => b.clients - a.clients || a.industry.localeCompare(b.industry));
    const row = (r) => ({ title: r.industry, meta: `${plural(r.restricted, 'industry grant')} · ${plural(r.clients, 'client')}`, hash: industryHash(r.industry) });
    return body({
      headline: { n: grantsHeavy.length + clientsHeavy.length, words: "industries where grants and clients don't line up" },
      counts: [
        { n: grantsHeavy.length, words: `with ${MANY_GRANTS}+ industry grants and at most ${plural(FEW_CLIENTS, 'client')}` },
        { n: clientsHeavy.length, words: `with ${MANY_CLIENTS}+ clients and at most ${plural(FEW_GRANTS_FOR, 'industry grant')}` }
      ],
      groups: [
        { title: 'Many grants, few clients', rows: grantsHeavy.map(row), see_all: { label: 'Coverage', hash: '#coverage' } },
        { title: 'Many clients, few grants', rows: clientsHeavy.map(row), see_all: { label: 'Coverage', hash: '#coverage' } }
      ]
    });
  };
  return { clients: build(cov.clients_variant), all: build(cov.all_variant) };
}

export function changedLine(changed) {
  const n = (k) => changed[k].length;
  const line = `This week: ${n('added')} went live, ${n('closed')} closed, ${n('removed')} removed, ${plural(n('edited'), 'grant')} edited.`;
  const b = { headline: { n: n('added') + n('closed') + n('removed') + n('edited'), words: 'catalogue changes this week' },
    counts: [], sub: null, line, groups: [{ title: 'Changes', rows: [], see_all: { label: 'Coverage & changes', hash: '#coverage' } }] };
  return { clients: b, all: b };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return {
    hubQuery: hubQueryDefault, appQuery: appQueryDefault, storeQuery: hubQueryDefault, now: () => new Date(),
    liveGrants: liveGrantsDefault, coverage: coverageDefault, changes: changesDefault, loadGrantWindow: loadGrantWindowDefault,
    chatOverview: chatOverviewDefault, listItems: listItemsDefault, companyList: companyListDefault,
    internalClerkIds: () => internalClerkIdsDefault(), isInternal: isInternalCompany
  };
}

/** An item's error in words the page can show: not configured, a missing table, or anything else. */
export function errorCode(err) {
  if (err?.code === 'not_configured' || err?.name === 'NotConfiguredError') return 'not_configured';
  if (err?.code === '42P01') return 'migration_missing';
  return 'error';
}

const LABELS = {
  deadlines: 'Which live grants have a deadline that is past, coming up, or missing?',
  cards_wrong: 'Which grant cards look wrong to clients or to us?',
  coverage_gaps: 'Where is the catalogue thin, and which grants reach no one?',
  stuck: 'Which Research review cards have stalled?',
  quiet_clients: 'Which clients have grant matches but have gone quiet?',
  paid_work: 'Which companies asked chat things it couldn\'t answer — a sign of paid work?',
  new_grants: 'Which new grants could reach our clients?',
  asked: 'What do clients ask that chat doesn\'t answer?',
  engagement: 'Which grants do clients open, discuss, or ignore — and how did they find them?',
  mismatch: 'Where do grants and clients not line up by industry?',
  changed: 'What changed in the catalogue this week?'
};
const NOTES = {
  quiet_clients: `Saves aren't counted yet. Matches are the last 30 days; quiet means no card open, rating or chat for ${QUIET_DAYS}+ days. Our own match runs don't count as activity.`,
  engagement: "Saves aren't counted yet.",
  new_grants: 'Went live = published as active in the last 7 days; a reopened grant counts too. Clients are counted by their profile industries against the grant\'s industry tag.',
  deadlines: `Today's live catalogue, not the range. Due = the next ${HYGIENE_DAYS} days.`
};

const cache = new Map();

/** The three departments for a range (cached CACHE_MS per range). */
export async function departmentViews(range = 'week', overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const rangeProblem = rangeError(range, now);
  if (rangeProblem) throw new ViewsError(400, rangeProblem);
  const hit = cache.get(range);
  if (hit && now.getTime() - hit.at < CACHE_MS && !overrides.noCache) return hit.value;

  const w = windowsFor(range, now);
  const today = vancouverDay(now);
  const { from, to } = w.current;
  const settle = (p) => Promise.resolve().then(p).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  // The four window readers each read the app DB's small read-only pool hard
  // (APP_POOL_MAX connections, 5 s to get one). Run together on a cold cache
  // they time out waiting for a connection, so they go one after another;
  // each has its own cache, so a warm load is quick either way.
  const sequential = async (tasks) => {
    const out = [];
    for (const t of tasks) out.push(await settle(t));
    return out;
  };
  const [[cov, win, list, chat], [grants, changed, items, signals]] = await Promise.all([
    sequential([
      () => deps.coverage(range),
      () => deps.loadGrantWindow(range),
      () => deps.companyList('month'),
      () => deps.chatOverview(range)
    ]),
    Promise.all([
      settle(() => deps.liveGrants({ query: deps.appQuery })),
      settle(() => deps.changes('week')),
      settle(() => deps.listItems({ owner: 'research' }).then((rows) => withCompanyNames(rows, { query: deps.appQuery }).catch(() => rows))),
      settle(async () => {
        const rows = (await deps.storeQuery(CHAT_SIGNALS_SQL, [from, to])).rows;
        const [names, internalClerks] = await Promise.all([
          companyNamesForIds(rows.map((r) => r.company_id), { query: deps.appQuery }).catch(() => new Map()),
          deps.internalClerkIds().catch(() => new Set())
        ]);
        return { rows, names, internalClerks };
      })
    ])
  ]);

  const item = (key, sources, build) => {
    const failed = sources.find((s) => !s.ok);
    const base = { key, label: LABELS[key], ...(NOTES[key] ? { note: NOTES[key] } : {}) };
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
  const lists = (view) => (w2) => buildGrantList(w2, { view, isInternal: deps.isInternal });

  const value = {
    range,
    current: { from, to },
    today,
    departments: {
      research: [
        item('deadlines', [grants], (g) => deadlineItem(g, today)),
        item('cards_wrong', [items, win], (it, w2) => cardsLookWrongItem(it, lists('most_ignored')(w2), deps.isInternal)),
        item('coverage_gaps', [cov, win], (c, w2) => coverageGapsItem(c, lists('not_matching')(w2))),
        item('stuck', [items], (it) => stuckItem(it, deps.isInternal))
      ],
      consulting: [
        item('quiet_clients', [list], (l) => quietClientsItem(l, deps.isInternal)),
        item('paid_work', [signals], (s) => paidWorkItem(s.rows, s.names, s.internalClerks, deps.isInternal)),
        item('new_grants', [changed, cov], (ch, c) => newGrantsItem(ch, c))
      ],
      marketing: [
        item('asked', [chat], (c) => askedItem(c)),
        item('engagement', [win, chat], (w2, c) => engagementItem(w2, c, deps.isInternal)),
        item('mismatch', [cov], (c) => mismatchItem(c)),
        item('changed', [changed], (ch) => changedLine(ch))
      ]
    },
    generated_at: new Date(now).toISOString()
  };
  // A failed item isn't kept: the next load tries its source again.
  const failed = Object.values(value.departments).flat().some((i) => i.error);
  if (!overrides.noCache && !failed) { cache.set(range, { at: now.getTime(), value }); trimCache(cache); }
  return value;
}

export function _clearCacheForTests() { cache.clear(); }
