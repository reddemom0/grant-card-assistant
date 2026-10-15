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
      grant: 'Fisheries Fund', days_since_change: 4.2, age_days: 5 });
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
    expect(r.filters).toEqual({ owner: 'research', stuck: 'open and unchanged for 3+ days' });
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
