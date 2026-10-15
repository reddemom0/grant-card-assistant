/**
 * control_centre (Oracle's read-only Control Centre tool): each mode, links on
 * every card, names first, read-only SQL, registration.
 *
 * Every dependency is a fake passed in through deps; nothing touches a DB.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-tools.test.js
 */

import { jest } from '@jest/globals';

const T = await import('../../src/tools/control-centre-tools.js');
const { getToolsForAgent } = await import('../../src/tools/definitions.js');
const { ORACLE_DEFERRED_TOOLS } = await import('../../src/claude/client.js');

const ENV = { PUBLIC_URL: 'https://hub.test' };

const row = (over = {}) => ({
  id: 7, kind: 'match', status: 'diagnosed', owner: 'research', company_id: 81, grant_root_id: 1196, chat_turn_ref: null,
  pattern_category: null, conversation_id: null, narrative: 'The card names fishing only.', client_notice: null, flag_count: 2,
  flagged_again: false, grant_name: 'Fisheries Fund', age_days: '5.04', idle_days: '4.2', ...over
});
const PATTERN = row({ id: 12, kind: 'grant_pattern', company_id: null, pattern_category: 'wrong_industry', owner: 'research', flag_count: 7,
  narrative: 'Seven companies were cut because the grant is for fishing only.' });
const CHAT = row({ id: 9, kind: 'chat', grant_root_id: null, grant_name: null, company_id: 135, chat_turn_ref: 'conv:42:pushback',
  conversation_id: 42, owner: 'chris', status: 'new', narrative: null, idle_days: '0.5' });

function makeDeps(over = {}) {
  const sent = [];
  const hubQuery = jest.fn(async (sql, params) => {
    sent.push(sql);
    switch (sql) {
      case T.COUNTS_SQL: return { rows: [
        { status: 'new', owner: 'unassigned', kind: 'chat', n: 1 },
        { status: 'diagnosed', owner: 'research', kind: 'match', n: 1 },
        { status: 'diagnosed', owner: 'research', kind: 'grant_pattern', n: 2 },
        { status: 'in_progress', owner: 'chris', kind: 'match', n: 1 },
        { status: 'closed', owner: 'research', kind: 'match', n: 4 }
      ] };
      case T.STUCK_SQL: return { rows: [row(), PATTERN] };
      case T.OLDEST_OPEN_SQL: return { rows: [PATTERN] };
      case T.LIST_SQL: return { rows: [PATTERN, row()] };
      case T.CARD_SQL: return { rows: params[0] === 12 ? [{ ...PATTERN, diagnosis: { verdict: 'card_missing_restriction', pattern: { companies: 7 } },
        snapshot: { category: 'wrong_industry', companies: 7, internal_companies: 1, grant: { industries: ['Fishing'], regions: ['BC'], eligibility_tags: [] },
          cuts: [{ date: '2026-10-09', company_name: 'Maximizer', company_internal: true, section: 'Hire', reason: 'Fishing only.' }] },
        snapshot_at: '2026-10-15T10:00:00Z' }]
        : params[0] === 9 ? [{ ...CHAT, diagnosis: null, snapshot: { flagged_turn_index: 1, issue: 'pushback',
          turns: [{ turn_index: 0, client: 'hi', assistant: 'hello' }, { turn_index: 1, client: 'deadline?', assistant: 'closed', flagged: true }] },
        diagnosis_attempts: 0, last_error: null }] : [] };
      case T.GRANT_NAMES_SQL: return { rows: [{ id: 1196, grant_name: 'Fisheries Fund' }] };
      case T.GRANT_SEARCH_SQL: return { rows: [{ id: 1196, name: 'Fisheries Fund' }] };
      default: throw new Error(`unexpected SQL ${sql.slice(0, 50)}`);
    }
  });
  const deps = {
    env: ENV,
    hubQuery,
    withCompanyNames: jest.fn(async (rows) => rows.map((r) => ({ ...r, company_name: { 81: 'Maximizer', 135: 'NYA Ventures' }[r.company_id] ?? null,
      company_internal: r.company_id === 81 }))),
    isInternalCompany: (id) => id === 81,
    getItem: jest.fn(async (id) => ({
      item: {}, flags: [{ source: 'ai_review_cut', source_created_at: '2026-10-09T10:00:00Z', actor: 'user_a', comment: 'Fishing only.' }],
      events: [{ created_at: '2026-10-15T10:00:00Z', action: 'diagnosed', actor: 'system:review-sweep', from_status: 'new', to_status: 'diagnosed', detail: '{"owner":"research"}' }],
      links: id === 12 ? [{ id: 7, kind: 'match', status: 'diagnosed', company_id: 81, grant_root_id: 1196, relation: 'same_grant' }] : []
    })),
    getOverview: jest.fn(async () => ({
      current: { from: '2026-10-09', to: '2026-10-15' }, previous: { from: '2026-10-02', to: '2026-10-08' }, today_partial: true,
      metrics: { matches_shown: { current: 211, previous: 180, internal: { current: 40, previous: 30 } } }, need_action: 5,
      rankings: { clients: { most_matched: Array.from({ length: 10 }, (_, i) => ({ grant_id: i })), popular: [], movers: { risers: [], drops: [] },
        chat: { chats: { current: 15 } }, open_sources: [] }, all: {} },
      sources: { last_rolled_day: '2026-10-14', live_days: ['2026-10-15'], stale_rollup: false }
    })),
    latestDigest: jest.fn(async () => ({ week_start: '2026-10-05', week_end: '2026-10-11', source: 'digest',
      themes: [{ name: 'Hiring', count: 6, takeaway: 'Hiring money.', internal_count: 1 }],
      recent_questions: [{ text: 'Any hiring grants?', theme: 'Hiring', company_name: 'Maximizer', company_internal: true }] })),
    search: jest.fn(async () => ({ companies: [{ id: 135, name: 'NYA Ventures' }], grants: [] })),
    identitiesForClerkIds: jest.fn(async (ids) => new Map(ids.filter((id) => id !== 'user_nolink').map((id) => [id, { company_id: id === 'user_a' ? 81 : 135 }]))),
    companyNamesForIds: jest.fn(async () => new Map([[81, 'Maximizer'], [135, 'NYA Ventures']])),
    ...over
  };
  return { deps, sent };
}

const run = (input, deps) => T.runControlCentre(input, { deps });

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });

describe('queue_summary', () => {
  test('open counts by status, owner, kind; stuck and oldest, each linked and named', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'queue_summary' }, deps);
    expect(r).toMatchObject({
      control_centre: 'https://hub.test/control-centre',
      open_cards: 5, closed_cards: 4,
      open_by_status: { new: 1, diagnosed: 3, in_progress: 1 },
      open_by_owner: { unassigned: 1, research: 3, chris: 1 },
      open_by_kind: { chat: 1, match: 2, grant_pattern: 2 },
      open_by_owner_and_status: { research: { diagnosed: 3 } }
    });
    expect(r.stuck.map((c) => [c.card, c.link])).toEqual([[7, 'https://hub.test/control-centre#review/7'], [12, 'https://hub.test/control-centre#review/12']]);
    expect(r.stuck[0]).toMatchObject({ title: 'Fisheries Fund matched to Maximizer', company: 'Maximizer', internal_account: true,
      grant: 'Fisheries Fund', days_since_activity: 4.2, age_days: 5 });
    expect(r.stuck_definition).toBe('open with no change or comment for 3+ days');
    expect(r.stuck[1]).toMatchObject({ title: 'Fisheries Fund — cut for several companies (wrong industry)', review_reason: 'wrong industry' });
    expect(r.oldest_open.map((c) => c.card)).toEqual([12]);
  });
});

describe('list_cards', () => {
  test('filters pass through; owner research + stuck_only is "what\'s stuck with Research"', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'list_cards', owner: 'research', stuck_only: true }, deps);
    expect(deps.hubQuery).toHaveBeenCalledWith(T.LIST_SQL, [null, 'research', null, null, null, T.STUCK_DAYS, T.LIST_MAX]);
    expect(r.count).toBe(2);
    expect(r.filters).toEqual({ owner: 'research', stuck: 'open with no change or comment for 3+ days' });
    expect(r.cards.every((c) => c.link.startsWith('https://hub.test/control-centre#review/'))).toBe(true);
  });

  test('a grant name resolves through the Hub grant copy; a company name through the Overview search', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'list_cards', grant: 'fisheries', company: 'NYA' }, deps);
    expect(deps.hubQuery).toHaveBeenCalledWith(T.GRANT_SEARCH_SQL, ['%fisheries%']);
    expect(deps.search).toHaveBeenCalledWith('NYA');
    const listCall = deps.hubQuery.mock.calls.find(([sql]) => sql === T.LIST_SQL);
    expect(listCall[1].slice(3, 5)).toEqual([[135], [1196]]);
    expect(r.filters).toMatchObject({ grant_matches: [{ id: 1196, name: 'Fisheries Fund' }], company_matches: [{ id: 135, name: 'NYA Ventures' }] });
  });

  test('a grant id is used as is; no match says so without listing', async () => {
    const { deps } = makeDeps({ search: jest.fn(async () => ({ companies: [], grants: [] })) });
    await run({ mode: 'list_cards', grant: '1196' }, deps);
    expect(deps.hubQuery.mock.calls.find(([sql]) => sql === T.LIST_SQL)[1][4]).toEqual([1196]);
    const none = await run({ mode: 'list_cards', company: 'Nobody Inc' }, deps);
    expect(none).toMatchObject({ cards: [], note: 'No company matches "Nobody Inc".' });
  });

  test('bad filters are refused', async () => {
    const { deps } = makeDeps();
    expect((await run({ mode: 'list_cards', owner: 'bob' }, deps)).error).toMatch(/owner must be one of/);
    expect((await run({ mode: 'list_cards', kind: 'grant' }, deps)).error).toMatch(/kind must be one of/);
  });
});

describe('card', () => {
  test('a grant pattern: diagnosis, review reasons with companies, flags, history, linked match cards — all linked', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'card', card_id: 12 }, deps);
    expect(r).toMatchObject({ card: 12, link: 'https://hub.test/control-centre#review/12', kind: 'grant_pattern', owner: 'research',
      diagnosis: { verdict: 'card_missing_restriction', pattern: { companies: 7 } } });
    expect(r.evidence).toMatchObject({ review_reason: 'wrong industry', companies: 7, internal_accounts: 1,
      reviews: [{ company: 'Maximizer', internal_account: true, reason: 'Fishing only.' }] });
    expect(r.history[0]).toMatchObject({ action: 'diagnosed', by: 'the hourly review sweep', detail: { owner: 'research' } });
    expect(r.flag_list).toBeUndefined(); // the cuts are the evidence
    expect(r.flags).toBe(7);
    expect(r.linked_cards).toEqual([{ card: 7, link: 'https://hub.test/control-centre#review/7', title: 'Fisheries Fund matched to Maximizer', kind: 'match', status: 'diagnosed' }]);
    expect(deps.getItem).toHaveBeenCalledWith(12, { hubQuery: deps.hubQuery });
  });

  test('a chat card shows the turns with the flagged message; not diagnosed yet says so', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'card', card_id: 9 }, deps);
    expect(r).toMatchObject({ title: 'Client pushed back on an answer (NYA Ventures)', company: 'NYA Ventures', diagnosis: { pending: 'not diagnosed yet' } });
    expect(r.flag_list).toEqual([{ source: 'ai_review_cut', at: '2026-10-09T10:00:00Z', by: 'Maximizer (internal account)', comment: 'Fishing only.' }]);
    expect(JSON.stringify(r)).not.toMatch(/user_a/);
    expect(r.evidence).toEqual({ flagged_message: 2, issue: 'pushback', turns: [
      { message: 1, client: 'hi', assistant: 'hello' }, { message: 2, client: 'deadline?', assistant: 'closed', flagged: true }] });
  });

  test('unknown or missing id', async () => {
    const { deps } = makeDeps();
    expect((await run({ mode: 'card', card_id: 404 }, deps)).error).toBe('No Control Centre card #404.');
    expect((await run({ mode: 'card' }, deps)).error).toMatch(/needs card_id/);
  });
});

describe('overview and chat_themes', () => {
  test('overview: metrics with internal share, lists cut to 5, chat, data freshness', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'overview', range: 'month' }, deps);
    expect(deps.getOverview).toHaveBeenCalledWith('month');
    expect(r).toMatchObject({ range: 'month', cards_needing_action: 5, metrics: { matches_shown: { current: 211, internal: { current: 40 } } },
      chat: { chats: { current: 15 } }, data: { last_rolled_day: '2026-10-14', live_days: 1, stale: false },
      control_centre: 'https://hub.test/control-centre' });
    expect(r.most_matched).toHaveLength(5);
    expect((await run({ mode: 'overview', range: 'decade' }, deps)).error).toMatch(/range must be one of/);
  });

  test('chat_themes: the stored week, questions named and tagged', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'chat_themes' }, deps);
    expect(r).toMatchObject({ week: { from: '2026-10-05', to: '2026-10-11' },
      themes: [{ name: 'Hiring', count: 6 }],
      recent_questions: [{ question: 'Any hiring grants?', theme: 'Hiring', company: 'Maximizer', internal_account: true }] });
    const empty = makeDeps({ latestDigest: async () => null });
    expect((await run({ mode: 'chat_themes' }, empty.deps)).message).toMatch(/No weekly chat themes/);
  });
});

describe('stuck is the board\'s rule', () => {
  test('same SQL as the board: last activity = later of updated_at and the newest comment, 3+ days, not closed', async () => {
    const Q = await import('../../src/control-centre/review-queue.js');
    expect(T.STUCK_DAYS).toBe(Q.STUCK_DAYS);
    const rule = Q.stuckWhen('$1::int');
    expect(rule).toBe("(i.status <> 'closed' AND GREATEST(i.updated_at, cm.at) < now() - make_interval(days => $1::int))");
    expect(T.STUCK_SQL).toContain(rule);
    expect(T.LIST_SQL).toContain(Q.stuckWhen('$6::int'));
    for (const sql of [T.STUCK_SQL, T.LIST_SQL, T.OLDEST_OPEN_SQL, T.CARD_SQL]) {
      expect(sql).toContain(Q.LAST_ACTIVITY_JOIN);
      expect(sql).toMatch(/e\.action = 'comment'/);
      expect(sql).toContain('EXTRACT(EPOCH FROM (now() - GREATEST(i.updated_at, cm.at))) / 86400 AS idle_days');
    }
    // The board uses the same pieces.
    expect(Q.LIST_SQL).toContain(Q.LAST_ACTIVITY_JOIN);
    expect(Q.LIST_SQL).toContain(`${Q.stuckWhen(3)} AS stuck`);
    // Longest idle first, by last activity — not updated_at alone.
    expect(T.STUCK_SQL).toMatch(/ORDER BY GREATEST\(i\.updated_at, cm\.at\), i\.id/);
    expect(T.STUCK_SQL).not.toMatch(/WHERE i\.status <> 'closed' AND i\.updated_at </);
  });
});

describe('safety', () => {
  test('every statement is a SELECT; no write helper is ever reached', () => {
    for (const sql of T.ALL_SQL) expect(sql.trim()).toMatch(/^SELECT/);
    const src = Object.values(T).filter((v) => typeof v === 'string').join('\n');
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  test('a bad mode is refused; failures come back as plain errors, codes only in logs', async () => {
    const { deps } = makeDeps();
    expect((await run({ mode: 'close' }, deps)).error).toMatch(/mode must be one of/);
    const broken = makeDeps({ hubQuery: jest.fn(async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); }) });
    expect((await run({ mode: 'queue_summary' }, broken.deps)).error).toMatch(/migration has not been applied/);
    const off = makeDeps({ getOverview: jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'not_configured' }); }) });
    expect((await run({ mode: 'overview' }, off.deps)).error).toMatch(/not configured/);
    expect(console.error.mock.calls.flat().join(' ')).not.toMatch(/relation does not exist/);
  });
});

describe('registration', () => {
  test('Oracle has it, deferred; the orchestrator and other agents do not', () => {
    expect(getToolsForAgent('internal-oracle').some((t) => t.name === 'control_centre')).toBe(true);
    expect(ORACLE_DEFERRED_TOOLS).toContain('control_centre');
    for (const agent of ['orchestrator', 'etg-writer', 'canexport-writer', 'lead-gen', 'getgranted-ai']) {
      expect(getToolsForAgent(agent).some((t) => t.name === 'control_centre')).toBe(false);
    }
  });

  test('the schema offers only read modes', () => {
    const tool = getToolsForAgent('internal-oracle').find((t) => t.name === 'control_centre');
    expect(tool.input_schema.properties.mode.enum).toEqual(T.CONTROL_CENTRE_MODES);
    expect(tool.description).toMatch(/can't move, reassign or close a card/);
  });
});

describe('grants_list and grant (the Grants tab, shared code)', () => {
  const r = (id, over = {}) => ({ grant_id: id, title: `Grant ${id}`, clients_matched: 0, opens: 0, saves: 0, cuts: 0, ignored: 0,
    displayed_clients: 0, bounced: 0, removed: 0, open_cards: 0, last_matched: null, ...over });
  const lists = {
    most_ignored: { clients: [r(1301, { clients_matched: 6, displayed_clients: 6, ignored: 6, last_matched: '2026-10-14' })],
      all: [r(1301, { clients_matched: 7, displayed_clients: 7, ignored: 7, last_matched: '2026-10-14' })] },
    all: { clients: [r(1196, { title: 'Agricultural Clean Technology' }), r(1301)], all: [r(1196, { title: 'Agricultural Clean Technology' }), r(1301)] }
  };
  const grantDeps = (over = {}) => makeDeps({
    grantList: jest.fn(async (range, view) => ({ range, view, current: { from: '2026-10-09', to: '2026-10-15' }, live_grants: 212, ...lists[view] ?? lists.all })),
    grantPage: jest.fn(async (id) => {
      if (id === 999) throw Object.assign(new Error('x'), { status: 404 });
      return {
        current: { from: '2026-10-09', to: '2026-10-15' },
        grant: { root_id: id, title: 'Agricultural Clean Technology', grantor: 'Government of Canada' },
        totals: { clients: r(id, { clients_matched: 5, cuts: 6 }), all: r(id, { clients_matched: 7, cuts: 8 }) },
        tracks: [{ label: 'Build Something New', companies: [{ company_id: 81, company_name: 'Maximizer', internal: true, last_day: '2026-10-14',
          best_position: 3, eligibility: 'Likely', ai_review: { action: 'cut', words: 'AI review cut it: wrong region', reason: 'Ontario only.' } }] }],
        tags: { industries: ['Agriculture'], regions: ['Canada'], card: [{ section: 'Eligibility', text: 'Farmers.' }] },
        trend: { clients: [{ day: '2026-10-14', opens: 1, saves: 0, bounces: 1, removals: 0, ignored: 2 }, { day: '2026-10-15', opens: 0, saves: 0, bounces: 0, removals: 0, ignored: 0 }] },
        edits: [{ at: '2026-09-29T18:12:27.000Z', what: 'Started a new draft', before: 'version 3681', after: 'version 3682', who: { user_id: 3, email: null } }],
        cards: [{ id: 7, title: 'Agricultural Clean Technology — cut for several companies (wrong region)', status: 'new', owner: null, company_internal: false }]
      };
    }),
    ...over
  }).deps;

  test('grants_list: the view, client-only counts with what internal accounts add, each grant linked', async () => {
    const d = grantDeps();
    const out = await run({ mode: 'grants_list', view: 'most_ignored' }, d);
    expect(d.grantList).toHaveBeenCalledWith('week', 'most_ignored');
    expect(out).toMatchObject({ view: 'most_ignored', in_view: 1, live_grants: 212, control_centre: 'https://hub.test/control-centre#grants' });
    expect(out.grants[0]).toMatchObject({ grant: 'Grant 1301', link: 'https://hub.test/control-centre#grants/1301', shown_never_opened: 6,
      last_matched: '2026-10-14', internal_accounts_add: { clients_matched: 1, shown_never_opened: 1 } });
    expect(out.definitions).toMatch(/3 seconds/);
  });

  test('grants_list: bad view or range is refused; limit caps the rows', async () => {
    expect((await run({ mode: 'grants_list', view: 'popular' }, grantDeps())).error).toMatch(/view must be one of/);
    expect((await run({ mode: 'grants_list', range: 'fortnight' }, grantDeps())).error).toMatch(/range must be one of/);
    const out = await run({ mode: 'grants_list', limit: 1 }, grantDeps());
    expect(out.grants).toHaveLength(1);
    expect(out.more).toBe(1);
    expect(out.grants[0].last_matched).toBe('Never');
  });

  test('grant: by id or name; tracks named first with the internal tag, edits without names, cards linked', async () => {
    const d = grantDeps();
    const out = await run({ mode: 'grant', grant: '1196' }, d);
    expect(d.grantPage).toHaveBeenCalledWith(1196, 'week');
    expect(out.control_centre).toBe('https://hub.test/control-centre#grants/1196');
    expect(out.companies_matched_by_goal_track[0].companies[0]).toMatchObject({ company: 'Maximizer', internal_account: true, ai_review_reason: 'Ontario only.' });
    expect(out.engagement_clients).toMatchObject({ opens: 1, bounces: 1, shown_never_opened: 2 });
    expect(out.engagement_clients.by_day).toHaveLength(1);
    expect(out.recent_edits[0].by).toBe('app user #3');
    expect(out.review_cards[0].link).toBe('https://hub.test/control-centre#review/7');
    expect((await run({ mode: 'grant', grant: 'agricultural' }, d)).grant.grant_id).toBe(1196);
    expect((await run({ mode: 'grant', grant: 'r' }, d)).candidates).toHaveLength(2);
    expect((await run({ mode: 'grant', grant: '999' }, d)).error).toMatch(/not live/);
  });
});
