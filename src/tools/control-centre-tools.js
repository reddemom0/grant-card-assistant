/**
 * control_centre — Oracle's read-only window on the Control Centre
 *
 * One tool, five modes:
 *   queue_summary  the review queue at a glance: open cards by status, owner and
 *                  kind; the cards stuck longest (no change for STUCK_DAYS+) and
 *                  the oldest open ones
 *   list_cards     cards filtered by status, owner, kind, company, grant, or
 *                  stuck only; at most LIST_MAX, most recently changed first
 *                  (stuck: longest idle first)
 *   card           one card in full: narrative, diagnosis, the evidence it was
 *                  diagnosed from (the chat turns for a chat card, the review
 *                  reasons for a grant pattern), flags, history, linked cards
 *   overview       the Overview numbers for a range (day, week, month, year):
 *                  the usage tiles vs the window before, top grants, chat
 *   chat_themes    the latest week's client question themes from the digest
 *
 * Every card in every answer carries its link (/control-centre#review/<id>);
 * every answer carries the Control Centre link.
 *
 * Reads only: SELECTs on the Hub (cc_review_*, gg3_grants) and the Control
 * Centre's existing read helpers (getItem, getOverview, latestDigest, search),
 * which read the app and ops DBs through db.js's read-only pools. Oracle can't
 * move, reassign or close a card. Company names first, ids second, internal
 * accounts tagged.
 *
 * Card text (narratives, chat turns, review reasons) goes back as the tool
 * result, which the executor wraps as untrusted. Logs carry the mode and an
 * error code only.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { cardLink, controlCentreUrl } from '../control-centre/links.js';
import { cardTitle, categoryWords } from '../control-centre/card-summary.js';

export const CONTROL_CENTRE_MODES = ['queue_summary', 'list_cards', 'card', 'overview', 'chat_themes'];
export const STUCK_DAYS = 3;
export const LIST_MAX = 20;
export const SUMMARY_ROWS = 8;
const NARRATIVE_CHARS = 400;
const TURN_CHARS = 1500;
const FLAG_ROWS = 25;
const EVENT_ROWS = 30;

const STATUSES = ['new', 'diagnosed', 'in_progress', 'closed'];
const OWNERS = ['client', 'research', 'chris', 'jason'];
const KINDS = ['match', 'chat', 'grant_pattern'];

const codeOf = (err) => err?.status ?? err?.code ?? err?.name ?? 'unknown';
const clip = (s, n) => {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const days = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

// ---------------------------------------------------------------------------
// SQL (Hub DB, read-only)
// ---------------------------------------------------------------------------

const CARD_COLUMNS = `
  i.id, i.kind, i.status, i.owner, i.company_id, i.grant_root_id, i.chat_turn_ref, i.pattern_category,
  i.conversation_id, i.narrative, i.client_notice, i.flag_count, i.flagged_again, i.created_at, i.updated_at,
  i.closed_at, g.grant_name,
  EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400 AS age_days,
  EXTRACT(EPOCH FROM (now() - i.updated_at)) / 86400 AS idle_days`;

export const COUNTS_SQL = `
  SELECT status, coalesce(owner, 'unassigned') AS owner, kind, count(*)::int AS n
    FROM cc_review_items
   GROUP BY 1, 2, 3`;

export const STUCK_SQL = `
  SELECT ${CARD_COLUMNS}
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.status <> 'closed' AND i.updated_at < now() - make_interval(days => $1::int)
   ORDER BY i.updated_at, i.id
   LIMIT $2`;

export const OLDEST_OPEN_SQL = `
  SELECT ${CARD_COLUMNS}
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.status <> 'closed'
   ORDER BY i.created_at, i.id
   LIMIT $1`;

// $1 status, $2 owner ('unassigned' = none), $3 kind, $4 company ids, $5 grant ids, $6 stuck days (null = any), $7 limit
export const LIST_SQL = `
  SELECT ${CARD_COLUMNS}
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE ($1::text IS NULL OR i.status = $1)
     AND ($2::text IS NULL OR ($2 = 'unassigned' AND i.owner IS NULL) OR i.owner = $2)
     AND ($3::text IS NULL OR i.kind = $3)
     AND ($4::int[] IS NULL OR i.company_id = ANY($4::int[]))
     AND ($5::int[] IS NULL OR i.grant_root_id = ANY($5::int[]))
     AND ($6::int IS NULL OR (i.status <> 'closed' AND i.updated_at < now() - make_interval(days => $6::int)))
   ORDER BY CASE WHEN $6::int IS NULL THEN NULL ELSE i.updated_at END ASC NULLS LAST, i.updated_at DESC, i.id DESC
   LIMIT $7`;

export const CARD_SQL = `
  SELECT ${CARD_COLUMNS}, i.diagnosis, i.snapshot, i.snapshot_at, i.close_note, i.closed_by, i.expected_match,
         i.diagnosis_attempts, i.last_error
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.id = $1`;

export const GRANT_NAMES_SQL = 'SELECT id, grant_name FROM gg3_grants WHERE id = ANY($1::int[])';
export const GRANT_SEARCH_SQL = "SELECT id, grant_name AS name FROM gg3_grants WHERE grant_name ILIKE $1 ESCAPE '\\' ORDER BY grant_name LIMIT 10";

export const ALL_SQL = [COUNTS_SQL, STUCK_SQL, OLDEST_OPEN_SQL, LIST_SQL, CARD_SQL, GRANT_NAMES_SQL, GRANT_SEARCH_SQL];

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/** Company names on rows (names first, internal tagged); a names failure leaves them null. */
async function named(rows, deps) {
  try {
    return await deps.withCompanyNames(rows);
  } catch {
    return rows.map((r) => ({ ...r, company_name: null, company_internal: deps.isInternalCompany(r.company_id) }));
  }
}

/** One card in a list. */
export function cardRow(r, env) {
  return {
    card: Number(r.id),
    link: cardLink(r.id, env),
    title: cardTitle(r),
    kind: r.kind,
    status: r.status,
    owner: r.owner ?? 'unassigned',
    ...(r.company_id != null ? { company: r.company_name ?? `company #${r.company_id}`, company_id: r.company_id,
      ...(r.company_internal ? { internal_account: true } : {}) } : {}),
    ...(r.grant_root_id != null ? { grant: r.grant_name ?? `grant #${r.grant_root_id}`, grant_id: r.grant_root_id } : {}),
    ...(r.pattern_category ? { review_reason: categoryWords(r.pattern_category) } : {}),
    flags: r.flag_count,
    ...(r.flagged_again ? { flagged_again: true } : {}),
    age_days: days(r.age_days),
    days_since_change: days(r.idle_days),
    narrative: clip(r.narrative, NARRATIVE_CHARS)
  };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function modeQueueSummary(input, deps) {
  const [counts, stuck, oldest] = await Promise.all([
    deps.hubQuery(COUNTS_SQL),
    deps.hubQuery(STUCK_SQL, [STUCK_DAYS, SUMMARY_ROWS]),
    deps.hubQuery(OLDEST_OPEN_SQL, [5])
  ]);
  const open = counts.rows.filter((r) => r.status !== 'closed');
  const tally = (rows, key) => rows.reduce((o, r) => ({ ...o, [r[key]]: (o[r[key]] ?? 0) + r.n }), {});
  const named_ = await named([...stuck.rows, ...oldest.rows], deps);
  const shaped = named_.map((r) => cardRow(r, deps.env));
  return {
    control_centre: controlCentreUrl(deps.env),
    open_cards: open.reduce((n, r) => n + r.n, 0),
    closed_cards: counts.rows.filter((r) => r.status === 'closed').reduce((n, r) => n + r.n, 0),
    open_by_status: tally(open, 'status'),
    open_by_owner: tally(open, 'owner'),
    open_by_kind: tally(open, 'kind'),
    open_by_owner_and_status: open.reduce((o, r) => {
      o[r.owner] = { ...(o[r.owner] ?? {}), [r.status]: ((o[r.owner] ?? {})[r.status] ?? 0) + r.n };
      return o;
    }, {}),
    stuck_definition: `open and unchanged for ${STUCK_DAYS}+ days`,
    stuck: shaped.slice(0, stuck.rows.length),
    oldest_open: shaped.slice(stuck.rows.length)
  };
}

const intList = (v) => (Array.isArray(v) ? v : [v]).map((x) => Number.parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0);

/**
 * Company or grant filter: ids as given, or a name — companies through the
 * Overview search (app DB), grants in the Hub's gg3_grants copy (root ids,
 * which is what cards key on).
 */
async function resolveFilter(value, type, deps) {
  if (value == null || value === '') return { ids: null };
  const ids = intList(value);
  if (ids.length) return { ids };
  let found;
  if (type === 'company') {
    found = (await deps.search(String(value))).companies ?? [];
  } else {
    const like = `%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    found = (await deps.hubQuery(GRANT_SEARCH_SQL, [like])).rows;
  }
  return { ids: found.map((x) => x.id), matched: found.slice(0, 8).map((x) => ({ id: x.id, name: x.name ?? null })) };
}

async function modeListCards(input, deps) {
  for (const [field, allowed] of [['status', STATUSES], ['owner', [...OWNERS, 'unassigned']], ['kind', KINDS]]) {
    if (input[field] != null && !allowed.includes(input[field])) return { error: `${field} must be one of: ${allowed.join(', ')}.` };
  }
  const company = await resolveFilter(input.company, 'company', deps);
  const grant = await resolveFilter(input.grant, 'grant', deps);
  if ((company.ids && !company.ids.length) || (grant.ids && !grant.ids.length)) {
    return { control_centre: controlCentreUrl(deps.env), cards: [], note: `No ${company.ids && !company.ids.length ? 'company' : 'grant'} matches "${company.ids && !company.ids.length ? input.company : input.grant}".` };
  }
  const stuck = input.stuck_only ? STUCK_DAYS : null;
  const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || LIST_MAX, 1), LIST_MAX);
  const { rows } = await deps.hubQuery(LIST_SQL, [input.status ?? null, input.owner ?? null, input.kind ?? null,
    company.ids, grant.ids, stuck, limit]);
  return {
    control_centre: controlCentreUrl(deps.env),
    filters: {
      ...(input.status ? { status: input.status } : {}), ...(input.owner ? { owner: input.owner } : {}),
      ...(input.kind ? { kind: input.kind } : {}), ...(company.matched ? { company_matches: company.matched } : {}),
      ...(company.ids && !company.matched ? { company_ids: company.ids } : {}),
      ...(grant.matched ? { grant_matches: grant.matched } : {}), ...(grant.ids && !grant.matched ? { grant_ids: grant.ids } : {}),
      ...(stuck ? { stuck: `open and unchanged for ${STUCK_DAYS}+ days` } : {})
    },
    count: rows.length,
    ...(rows.length === limit ? { note: `Showing ${limit}; narrow the filters for the rest.` } : {}),
    cards: (await named(rows, deps)).map((r) => cardRow(r, deps.env))
  };
}

/** What the card was diagnosed from, in a form Oracle can quote from. */
export function evidenceOf(item) {
  const s = item.snapshot;
  if (!s) return null;
  if (item.kind === 'chat') {
    return {
      flagged_message: s.flagged_turn_index != null ? s.flagged_turn_index + 1 : null,
      ...(s.issue ? { issue: s.issue } : {}),
      turns: (s.turns ?? []).map((t) => ({
        message: t.turn_index + 1, client: clip(t.client, TURN_CHARS), assistant: clip(t.assistant, TURN_CHARS),
        ...(t.flagged ? { flagged: true } : {})
      }))
    };
  }
  if (item.kind === 'grant_pattern') {
    return {
      review_reason: categoryWords(s.category),
      companies: s.companies, internal_accounts: s.internal_companies,
      grant_tags: s.grant ? {
        industries: s.grant.industries, regions: s.grant.regions, recorded_eligibility: s.grant.eligibility_tags
      } : null,
      reviews: (s.cuts ?? []).map((c) => ({
        date: c.date, company: c.company_name ?? 'no company linked', ...(c.company_internal ? { internal_account: true } : {}),
        section: c.section, reason: clip(c.reason, 400)
      }))
    };
  }
  const r = s.response ?? {};
  return {
    grant: r.grant_name ?? null,
    likely_cause: r.candidate_cause?.cause ?? null,
    evidence: r.candidate_cause?.evidence ?? null,
    passes_eligibility_now: r.passes_eligibility_now ?? null
  };
}

async function modeCard(input, deps) {
  const id = Number.parseInt(input.card_id, 10);
  if (!(Number.isInteger(id) && id > 0)) return { error: 'card needs card_id (the number after #review/ in a card link).' };
  const { rows } = await deps.hubQuery(CARD_SQL, [id]);
  if (!rows[0]) return { error: `No Control Centre card #${id}.` };
  const [item] = await named(rows, deps);
  const full = await deps.getItem(id, { hubQuery: deps.hubQuery });
  const linked = full.links ?? [];
  const names = linked.length
    ? new Map((await deps.hubQuery(GRANT_NAMES_SQL, [[...new Set(linked.map((l) => l.grant_root_id).filter(Boolean))]])).rows.map((r) => [r.id, r.grant_name]))
    : new Map();
  const linkedNamed = await named(linked.map((l) => ({ ...l, grant_name: names.get(l.grant_root_id) ?? null })), deps);

  const d = item.diagnosis && typeof item.diagnosis === 'object' ? item.diagnosis : null;
  const label = await actorLabels([...full.flags.map((f) => f.actor), ...full.events.map((e) => e.actor), item.closed_by], deps);
  return {
    control_centre: controlCentreUrl(deps.env),
    ...cardRow(item, deps.env),
    narrative: item.narrative ?? null,
    ...(item.client_notice ? { client_notice: item.client_notice } : {}),
    diagnosis: d ? {
      verdict: d.verdict ?? null,
      ...(d.chat ? { chat: d.chat } : {}),
      ...(d.pattern ? { pattern: d.pattern } : {}),
      ...(d.owner_override ? { owner_changed_by_rules: d.owner_override.changes } : {}),
      diagnosed_from_evidence_taken: item.snapshot_at ?? d.snapshot_at ?? null
    } : (item.status === 'new' ? { pending: item.last_error ? `not diagnosed yet (${item.diagnosis_attempts} failed attempt(s))` : 'not diagnosed yet' } : null),
    evidence: evidenceOf(item),
    ...(item.status === 'closed' ? { closed: { at: item.closed_at, by: label(item.closed_by), note: item.close_note, expected_match: item.expected_match } } : {}),
    // A pattern card's flags are its AI-review cuts, already in evidence.reviews.
    ...(item.kind === 'grant_pattern' ? {} : {
      flag_list: full.flags.slice(-FLAG_ROWS).map((f) => ({
        source: f.source, at: f.source_created_at ?? f.created_at, by: label(f.actor), comment: clip(f.comment, 400)
      })),
      ...(full.flags.length > FLAG_ROWS ? { flags_note: `Latest ${FLAG_ROWS} of ${full.flags.length} flags.` } : {})
    }),
    history: full.events.slice(-EVENT_ROWS).map((e) => ({
      at: e.created_at, action: e.action, by: label(e.actor), ...(e.from_status ? { from: e.from_status } : {}),
      ...(e.to_status ? { to: e.to_status } : {}), ...(e.detail ? { detail: typeof e.detail === 'string' ? safeJson(e.detail) : e.detail } : {})
    })),
    ...(full.events.length > EVENT_ROWS ? { history_note: `Latest ${EVENT_ROWS} of ${full.events.length} changes.` } : {}),
    linked_cards: linkedNamed.map((l) => ({ card: Number(l.id), link: cardLink(l.id, deps.env), title: cardTitle(l), kind: l.kind, status: l.status }))
  };
}

/**
 * Who flagged or changed a card, in words: a client's Clerk id → their company
 * (internal tagged), a system job → what it is, a staff email kept. Never a
 * raw Clerk id; a names failure says "a client".
 */
async function actorLabels(actors, deps) {
  const clerk = [...new Set(actors.filter((a) => typeof a === 'string' && a.startsWith('user_')))];
  const labels = new Map();
  try {
    const ids = await deps.identitiesForClerkIds(clerk);
    const names = await deps.companyNamesForIds([...ids.values()].map((v) => v.company_id));
    for (const c of clerk) {
      const id = ids.get(c)?.company_id ?? null;
      labels.set(c, id == null ? 'a client (no company linked)'
        : `${names.get(id) ?? `company #${id}`}${deps.isInternalCompany(id) ? ' (internal account)' : ''}`);
    }
  } catch { /* fall back below */ }
  const SYSTEM = { 'system:review-sweep': 'the hourly review sweep', 'system:oracle-chat-review': "Oracle's morning chat review" };
  return (a) => (a == null ? null : labels.get(a) ?? SYSTEM[a] ?? (String(a).startsWith('user_') ? 'a client' : a));
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

const RANGES = ['day', 'week', 'month', 'year'];
const top = (list, n = 5) => (Array.isArray(list) ? list.slice(0, n) : list);

async function modeOverview(input, deps) {
  const range = input.range ?? 'week';
  if (!RANGES.includes(range)) return { error: `range must be one of: ${RANGES.join(', ')}.` };
  const o = await deps.getOverview(range);
  const r = o.rankings?.clients ?? {};
  return {
    control_centre: controlCentreUrl(deps.env),
    range,
    current: o.current, previous: o.previous, today_partial: o.today_partial,
    note: 'metrics: current vs previous window; "internal" is how much of it came from Granted\'s own internal accounts. Lists below leave internal accounts out.',
    metrics: o.metrics,
    cards_needing_action: o.need_action,
    most_matched: top(r.most_matched),
    most_opened: top(r.popular),
    risers: top(r.movers?.risers),
    drops: top(r.movers?.drops),
    ...(r.chat ? { chat: r.chat } : {}),
    ...(r.open_sources ? { how_clients_found_grants: r.open_sources } : {}),
    data: { last_rolled_day: o.sources?.last_rolled_day ?? null, live_days: o.sources?.live_days?.length ?? 0, stale: o.sources?.stale_rollup ?? false }
  };
}

async function modeChatThemes(input, deps) {
  const d = await deps.latestDigest();
  if (!d) return { control_centre: controlCentreUrl(deps.env), message: 'No weekly chat themes stored yet.' };
  return {
    control_centre: controlCentreUrl(deps.env),
    week: { from: d.week_start, to: d.week_end },
    source: d.source,
    themes: d.themes,
    recent_questions: (d.recent_questions ?? []).map((q) => ({
      question: q.text, theme: q.theme, company: q.company_name ?? null,
      ...(q.company_internal ? { internal_account: true } : {})
    })),
    note: 'Questions are the digest\'s anonymised rewrites, not the clients\' own words.'
  };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function defaultDeps() {
  const [{ getItem }, { getOverview, search }, { latestDigest }, { withCompanyNames, identitiesForClerkIds, companyNamesForIds }, { isInternalCompany }] = await Promise.all([
    import('../control-centre/review-queue.js'),
    import('../control-centre/overview.js'),
    import('../control-centre/digest-themes.js'),
    import('../control-centre/identity.js'),
    import('../control-centre/internal-accounts.js')
  ]);
  return { env: process.env, hubQuery: hubQueryDefault, getItem, getOverview, search, latestDigest, withCompanyNames,
    identitiesForClerkIds, companyNamesForIds, isInternalCompany };
}

const MODES = { queue_summary: modeQueueSummary, list_cards: modeListCards, card: modeCard, overview: modeOverview, chat_themes: modeChatThemes };

/**
 * @param {Object} input - tool input
 * @param {{deps?: Object}} [ctx]
 */
export async function runControlCentre(input = {}, { deps = null } = {}) {
  const run = MODES[input.mode];
  if (!run) return { error: `mode must be one of: ${CONTROL_CENTRE_MODES.join(', ')}.` };
  const d = deps || await defaultDeps();
  try {
    return await run(input, d);
  } catch (err) {
    const code = codeOf(err);
    console.error(`❌ control_centre ${input.mode} failed — code: ${code}`);
    if (code === 'not_configured') return { error: 'The Control Centre data is not available here (a database is not configured).' };
    if (code === '42P01') return { error: 'The Control Centre tables are missing here (a migration has not been applied).' };
    return { error: `The Control Centre lookup failed (${code}). Try again, or narrow it.` };
  }
}
