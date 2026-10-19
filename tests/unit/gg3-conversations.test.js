/**
 * gg3_conversations — Oracle reads GetGranted client conversations (Pulse task 4)
 *
 * No network, no database: every dependency is a fake passed in through deps,
 * and every SQL statement sent is recorded so the tests can check what was read.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/gg3-conversations.test.js
 */

import { jest } from '@jest/globals';

const {
  runGg3Conversations, parseClientRef, likeEscape, outcomeWords, grantsIn, reduceExplain,
  windowFor, vancouverMidnight, NAME_NOT_FOUND, SNIPPET_CHARS, CHAT_CARDS_SQL, SEARCH_TURNS_SQL, GRANT_NAMES_SQL
} = await import('../../src/tools/gg3-conversations.js');

const NOW = new Date('2026-10-01T16:00:00Z');
const CLIENT = 'user_2abcdEFGH9xyz';
const OTHER = 'user_2zzzzEFGH9qrs';

const msgs = [
  { role: 'user', content: 'Are there hiring grants for a BC bakery?' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_grants', input: { query: 'hiring' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ grants: [{ id: 1856, grant_name: 'BC Hiring Boost' }, { id: 77, grant_name: 'CanExport SMEs' }] }) }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'surface_grant_tiles', input: { grantIds: [1856] } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] },
  { role: 'assistant', content: 'Yes — BC Hiring Boost fits.' },
  { role: 'user', content: 'That is not what I asked, I wanted wage subsidies' }
];

/** A runQuery fake that answers by SQL shape and records every statement. */
function fakeOps({ resolveRows = [{ user_id: CLIENT, last_active: NOW }], convRows, turnRows = [], searchRows = [], searchTurnRows = [], runRows = [], configured = true } = {}) {
  const sent = [];
  const q = jest.fn(async (sql, params) => {
    sent.push({ sql, params });
    if (!configured) return { configured: false };
    if (sql === SEARCH_TURNS_SQL) return { configured: true, rows: searchTurnRows };
    if (/max\(updated_at\) AS last_active/.test(sql)) return { configured: true, rows: resolveRows };
    if (/FROM chat_turns\s+WHERE conversation_id = ANY/.test(sql)) return { configured: true, rows: turnRows };
    if (/FROM conversations WHERE id = \$1/.test(sql)) {
      return { configured: true, rows: params[0] === 41 ? [{ id: 41, user_id: CLIENT, messages: msgs }] : [] };
    }
    if (/FROM conversations c/.test(sql)) return { configured: true, rows: searchRows };
    if (/FROM conversations/.test(sql)) {
      return { configured: true, rows: convRows ?? [{ id: 41, mode: 'advisor', messages: msgs, created_at: NOW, updated_at: NOW }] };
    }
    if (/company_id IS NOT NULL/.test(sql)) return { configured: true, rows: runRows.length ? [{ result_set_id: 'rs1', company_id: 9, occurred_at: NOW }] : [] };
    if (/SELECT DISTINCT section/.test(sql)) return { configured: true, rows: [{ section: 'Hiring' }, { section: 'Export' }] };
    if (/grant_id = ANY/.test(sql)) return { configured: true, rows: runRows };
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { q, sent };
}

/** Oracle's local GG3 copy (gg3_grants). */
const GRANT_NAMES = { 1742: 'Regional Tariff Response Initiative - British Columbia', 1314: 'Employer Training Grant (ETG)', 1099: 'WorkBC Wage Subsidy Program' };

const CARD_ROWS = [
  { id: 55, kind: 'chat', status: 'diagnosed', owner: 'chris', chat_turn_ref: 'conv:41:pushback', conversation_id: 41,
    narrative: 'The client asked for wage subsidies and got a hiring grant.', flag_count: 1, updated_at: NOW }
];

/** addFlag over one in-memory card per chat_turn_ref. */
function fakeAddFlag() {
  const cards = new Map();
  return jest.fn(async (input) => {
    const created = !cards.has(input.chat_turn_ref);
    if (created) cards.set(input.chat_turn_ref, { id: 200 + cards.size, flag_count: 0, ...input });
    const card = cards.get(input.chat_turn_ref);
    card.flag_count += 1;
    return { item: card, created, reopened: false, duplicate: false };
  });
}

function makeDeps(over = {}) {
  const ops = over.ops || fakeOps();
  return {
    ops,
    deps: {
      userId: 7,
      chatContext: { surface: 'chat_dm', senderDisplayName: 'Chat Name' },
      env: { PUBLIC_URL: 'https://hub.test' },
      now: () => NOW,
      runQuery: ops.q,
      oracleQuery: jest.fn(async (sql, params) => (/FROM users WHERE id/.test(sql)
        ? { rows: [{ name: 'Steph Lee', email: 'steph@granted.ca' }] }
        : sql === CHAT_CARDS_SQL ? { rows: CARD_ROWS }
          : sql === GRANT_NAMES_SQL ? { rows: params[0].filter(id => GRANT_NAMES[id]).map(id => ({ id, grant_name: GRANT_NAMES[id] })) }
            : { rows: [] })),
      fetchProfile: jest.fn(async () => ({ status: 404, companyName: null })),
      explain: jest.fn(async () => ({ ok: false, code: 'not_configured' })),
      findGrant: jest.fn(async () => null),
      writeSheet: jest.fn(async (_u, c) => ({ url: 'https://sheet/x', title: c.title, id: 'x' })),
      addFlag: fakeAddFlag(),
      companyFor: jest.fn(async () => 135),
      ...over.deps
    }
  };
}

const run = (input, deps) => runGg3Conversations(input, { deps });

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('client refs', () => {
  test('parses the roundup ref, a bare suffix and a full Clerk id', () => {
    expect(parseClientRef('a client ·9xyz')).toEqual({ suffix: '9xyz' });
    expect(parseClientRef('·9xyz')).toEqual({ suffix: '9xyz' });
    expect(parseClientRef('EFGH9xyz')).toEqual({ suffix: 'EFGH9xyz' });
    expect(parseClientRef(`client ${CLIENT} please`)).toEqual({ exact: CLIENT });
    expect(parseClientRef('·ab')).toBeNull();
    expect(parseClientRef('')).toBeNull();
  });

  test('escapes LIKE wildcards', () => {
    expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('read', () => {
  test('suffix ref → that client\'s conversations with problems, grants shown and transcript', async () => {
    const { deps, ops } = makeDeps({
      ops: fakeOps({ turnRows: [{ conversation_id: 41, occurred_at: NOW, outcome: 'error', error_category: 'connection_error' }] })
    });
    const r = await run({ mode: 'read', client: '·9xyz' }, deps);
    expect(r.client).toBe('·9xyz');
    expect(r.company).toBeNull();
    expect(r.company_note).toMatch(/404/);
    expect(r.conversations).toHaveLength(1);
    const c = r.conversations[0];
    expect(c.problems).toEqual([{ at: NOW.toISOString(), what: 'chat broke (connection error)' }]);
    expect(c.grants_shown).toEqual(['BC Hiring Boost (1856)']);
    expect(c.client_messages).toBe(2);
    expect(c.transcript.map(t => t.role)).toEqual(['client', 'assistant', 'client']);
    expect(c._messages).toBeUndefined();
    const resolve = ops.sent[0];
    expect(resolve.sql).toContain('right(user_id, $2::int) = $3');
    expect(resolve.params).toEqual([90, 4, '9xyz']);
  });

  test('since 2026-10-02 the cards come from conversations.grant_ids, named from the GG3 copy', async () => {
    const newer = [
      { role: 'user', content: 'Any tariff help?' },
      { role: 'assistant', content: 'The Regional Tariff Response Initiative may fit.' }
    ];
    const { deps } = makeDeps({
      ops: fakeOps({ convRows: [{ id: 289, mode: 'advisor', messages: newer, grant_ids: [1742, 4242], created_at: NOW, updated_at: NOW }] })
    });
    const r = await run({ mode: 'read', client: '·9xyz' }, deps);
    expect(r.conversations[0].grants_shown).toEqual(['Regional Tariff Response Initiative - British Columbia (1742)', 'grant 4242']);
    expect(deps.oracleQuery).toHaveBeenCalledWith(GRANT_NAMES_SQL, [[1742, 4242]]);
  });

  test('the GG3 copy unavailable → names from the conversation, else the id', async () => {
    const { deps } = makeDeps({
      ops: fakeOps({ convRows: [{ id: 41, mode: 'advisor', messages: msgs, grant_ids: [1856, 9], created_at: NOW, updated_at: NOW }] }),
      deps: { oracleQuery: jest.fn(async () => { throw new Error('hub down'); }) }
    });
    const r = await run({ mode: 'read', client: '·9xyz' }, deps);
    expect(r.conversations[0].grants_shown).toEqual(['BC Hiring Boost (1856)', 'grant 9']);
  });

  test('full Clerk id matches exactly', async () => {
    const { deps, ops } = makeDeps();
    await run({ mode: 'read', client: CLIENT }, deps);
    expect(ops.sent[0].sql).toContain('WHERE user_id = $1');
    expect(ops.sent[0].params).toEqual([CLIENT]);
  });

  test('two clients share the suffix → candidates with longer refs, nothing read', async () => {
    const { deps, ops } = makeDeps({ ops: fakeOps({ resolveRows: [{ user_id: CLIENT, last_active: NOW }, { user_id: OTHER, last_active: NOW }] }) });
    const r = await run({ mode: 'read', client: '·EFGH' }, deps);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ambiguous');
    expect(r.candidates.map(c => c.client)).toEqual(['·EFGH9xyz', '·EFGH9qrs']);
    expect(ops.sent).toHaveLength(1);
  });

  test('unknown ref → not found', async () => {
    const { deps } = makeDeps({ ops: fakeOps({ resolveRows: [] }) });
    const r = await run({ mode: 'read', client: '·0000' }, deps);
    expect(r).toMatchObject({ ok: false, reason: 'not_found' });
  });

  test('ops DB not configured → plain message', async () => {
    const { deps } = makeDeps({ ops: fakeOps({ configured: false }) });
    const r = await run({ mode: 'read', client: '·9xyz' }, deps);
    expect(r).toMatchObject({ ok: false, reason: 'not_configured' });
  });
});

describe('company names', () => {
  test('a name found in one client\'s conversations resolves to them', async () => {
    const { deps, ops } = makeDeps({ deps: { fetchProfile: jest.fn(async () => ({ status: 200, companyName: 'Acme Bakery' })) } });
    const r = await run({ mode: 'read', name: 'Acme 100%' }, deps);
    expect(r.client).toBe('·9xyz');
    expect(r.company).toBe('Acme Bakery');
    expect(ops.sent[0].sql).toContain('messages::text ILIKE $2');
    expect(ops.sent[0].params).toEqual([90, '%Acme 100\\%%']);
  });

  test('a name not found → says names can\'t be looked up yet and asks for the ref', async () => {
    const { deps } = makeDeps({ ops: fakeOps({ resolveRows: [] }) });
    const r = await run({ mode: 'read', name: 'Nobody Ltd' }, deps);
    expect(r).toMatchObject({ ok: false, reason: 'name_not_found', message: NAME_NOT_FOUND });
    expect(NAME_NOT_FOUND).toMatch(/can't look clients up by company name yet/);
    expect(NAME_NOT_FOUND).toMatch(/·xxxx ref from the roundup/);
  });
});

describe('search', () => {
  const row = (i, extra = {}) => ({
    id: 100 + i, user_id: `user_2client${String(i).padStart(4, '0')}`, mode: 'advisor', updated_at: NOW, failed: i % 2 === 0,
    client_messages: [`${'Earlier question. '.repeat(5)}Do you have hiring grants for students? (${i})`], grant_ids: [], ...extra
  });

  test('every term must be in client messages; default window is the last 7 days', async () => {
    const { deps, ops } = makeDeps({ ops: fakeOps({ searchRows: [row(1)] }) });
    const r = await run({ mode: 'search', terms: ['hiring', 'students'] }, deps);
    const { sql, params } = ops.sent[0];
    expect(sql.match(/ILIKE \$\d/g)).toHaveLength(2);
    expect(sql).toContain("m->>'role' = 'user'");
    expect(params[0]).toEqual(new Date(NOW.getTime() - 7 * 864e5));
    expect(params[1]).toEqual(NOW);
    expect(params.slice(2, 4)).toEqual(['%hiring%', '%students%']);
    expect(r).toMatchObject({ matches: 1, clients: 1, from: '2026-09-24', to: '2026-10-01' });
    expect(r.results[0]).toMatchObject({ client: '·0001', date: '2026-10-01', failed: 'no' });
    expect(r.results[0].asked).toMatch(/hiring grants for students/);
    expect(r.results[0].asked.length).toBeLessThanOrEqual(SNIPPET_CHARS);
    expect(r.sheet).toBeUndefined();
    expect(deps.writeSheet).not.toHaveBeenCalled();
  });

  test('failed_only adds the chat_turns condition', async () => {
    const { deps, ops } = makeDeps({ ops: fakeOps({ searchRows: [] }) });
    await run({ mode: 'search', terms: ['broke'], days: 1, failed_only: true }, deps);
    expect(ops.sent[0].sql.match(/t\.outcome = ANY/g)).toHaveLength(2);
  });

  test('more than 10 → 10 inline and the full list in a sheet in the asker\'s Drive', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(i + 1));
    const { deps } = makeDeps({ ops: fakeOps({ searchRows: rows }) });
    const r = await run({ mode: 'search', terms: ['hiring'] }, deps);
    expect(r.results).toHaveLength(10);
    expect(r.matches).toBe(14);
    expect(r.sheet).toMatchObject({ url: 'https://sheet/x' });
    const [userId, content] = deps.writeSheet.mock.calls[0];
    expect(userId).toBe(7);
    expect(content.tables[0].rows).toHaveLength(14);
    expect(content.tables[0].columns.map(c => c.label)).toEqual(['Client', 'Active in window', 'Mode', 'Chat failed', 'What they asked', 'Cards on the matching message']);
  });

  test('a sheet failure still returns the inline rows', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));
    const { deps } = makeDeps({ ops: fakeOps({ searchRows: rows }), deps: { writeSheet: jest.fn(async () => { throw new Error('Google Sheets access not granted.'); }) } });
    const r = await run({ mode: 'search', terms: ['hiring'] }, deps);
    expect(r.results).toHaveLength(10);
    expect(r.sheet).toBeNull();
    expect(r.sheet_error).toMatch(/access not granted/);
  });

  test('no terms → asks for one', async () => {
    const { deps, ops } = makeDeps();
    const r = await run({ mode: 'search', terms: [' '] }, deps);
    expect(r.error).toMatch(/at least one/);
    expect(ops.sent).toHaveLength(0);
  });

  test('cards per matching message from chat_turns; the whole conversation\'s from grant_ids', async () => {
    const loan = row(1, {
      id: 289, client_messages: ['Show me equipment funding programs for my company', 'What about loan programs'], grant_ids: [1742]
    });
    const eligible = row(2, { id: 283, client_messages: ['What grants am I most eligible for?'], grant_ids: [1314, 1099] });
    const untracked = row(3, { id: 150, client_messages: ['loan or grant for students?'], grant_ids: [], legacy_grant_ids: [1099] });
    const { deps, ops } = makeDeps({
      ops: fakeOps({
        searchRows: [loan, eligible, untracked],
        searchTurnRows: [
          { conversation_id: 289, turn_index: 0, occurred_at: new Date('2026-10-13T17:54:18Z'), surfaced_grant_ids: [1742] },
          { conversation_id: 289, turn_index: 1, occurred_at: new Date('2026-10-13T17:54:41Z'), surfaced_grant_ids: [] },
          { conversation_id: 283, turn_index: 0, occurred_at: new Date('2026-10-12T00:18:04Z'), surfaced_grant_ids: [1314, 1099] }
        ]
      })
    });
    const r = await run({ mode: 'search', terms: ['loan'] }, deps);
    const by = Object.fromEntries(r.results.map(x => [x.conversation, x]));
    expect(by[289].matching_messages).toEqual([{ client_message: 2, at: '2026-10-13 10:54', cards: 'none' }]);
    expect(by[289].cards_in_conversation).toEqual(['Regional Tariff Response Initiative - British Columbia (1742)']);
    expect(by[150].matching_messages).toEqual([{ client_message: 1, cards: 'not recorded' }]);
    expect(by[150].cards_in_conversation).toEqual(['WorkBC Wage Subsidy Program (1099)']);
    expect(ops.sent.find(x => x.sql === SEARCH_TURNS_SQL).params).toEqual([[289, 283, 150]]);

    const r2 = await run({ mode: 'search', terms: ['eligible'] }, deps);
    const e = r2.results.find(x => x.conversation === 283);
    expect(e.matching_messages).toEqual([{
      client_message: 1, at: '2026-10-11 17:18', cards: ['Employer Training Grant (ETG) (1314)', 'WorkBC Wage Subsidy Program (1099)']
    }]);
    expect(r2.results.every(x => x.cards_on_match === undefined)).toBe(true);
  });

  test('from/to are Vancouver days: a Saturday-evening chat is Saturday, not Sunday UTC', async () => {
    const w = windowFor({ from: '2026-10-10', to: '2026-10-10' }, NOW);
    expect(w.since).toEqual(new Date('2026-10-10T07:00:00Z'));
    expect(w.until).toEqual(new Date('2026-10-11T07:00:00Z'));
    const saturdayEvening = new Date('2026-10-11T03:30:00Z'); // 20:30 Saturday in Vancouver
    expect(saturdayEvening >= w.since && saturdayEvening < w.until).toBe(true);
    const sundayEarly = new Date('2026-10-11T07:30:00Z'); // 00:30 Sunday in Vancouver
    expect(sundayEarly < w.until).toBe(false);
    expect(vancouverMidnight('2026-11-15')).toEqual(new Date('2026-11-15T08:00:00Z')); // PST

    const { deps, ops } = makeDeps({ ops: fakeOps({ searchRows: [row(1, { active_at: saturdayEvening, updated_at: saturdayEvening })] }) });
    const r = await run({ mode: 'search', terms: ['hiring'], from: '2026-10-10', to: '2026-10-10' }, deps);
    expect(ops.sent[0].params.slice(0, 2)).toEqual([w.since, w.until]);
    expect(r).toMatchObject({ from: '2026-10-10', to: '2026-10-10' });
    expect(r.results[0].date).toBe('2026-10-10');
  });

  test('a chat that carries on past the window still matches, dated by its turn in the window', async () => {
    const { deps, ops } = makeDeps({
      ops: fakeOps({
        searchRows: [row(1, { active_at: new Date('2026-10-13T17:54:41Z'), updated_at: new Date('2026-10-16T22:00:00Z') })]
      })
    });
    const r = await run({ mode: 'search', terms: ['hiring'], from: '2026-10-13', to: '2026-10-13' }, deps);
    const { sql } = ops.sent[0];
    expect(sql).toContain('t.occurred_at >= $1 AND t.occurred_at < $2');
    expect(sql).not.toMatch(/updated_at < \$2/);
    expect(sql).toContain('c.created_at < $2');
    expect(sql).toMatch(/ORDER BY coalesce\(s\.active_at, s\.updated_at\) DESC/);
    expect(r.results[0]).toMatchObject({ conversation: 101, date: '2026-10-13' });
  });

  test('windows are capped at 90 days', () => {
    const w = windowFor({ from: '2026-01-01', to: '2026-09-30' }, NOW);
    expect(w.until).toEqual(new Date('2026-10-01T07:00:00Z'));
    expect((w.until - w.since) / 864e5).toBe(90);
  });
});

describe('troubleshoot', () => {
  const runRows = [{ grant_id: 1856, section: 'Hiring', shown: false, position: null, deleted_at_stage: 'eligibility', match_score: 0.41, eligibility: 'ineligible', eligibility_reasons: ['region: BC only'] }];

  test('without match-explain configured: evidence, match context, the chat cards on file; writes nothing', async () => {
    const { deps } = makeDeps({ ops: fakeOps({ runRows }) });
    const r = await run({ mode: 'troubleshoot', client: '·9xyz', complaint: 'matches made no sense', grants: ['BC Hiring Boost'] }, deps);
    expect(r.grants_named).toEqual([{ asked: 'BC Hiring Boost', id: 1856, name: 'BC Hiring Boost' }]);
    expect(r.matching.run).toEqual({ at: NOW.toISOString(), company_id: 9 });
    expect(r.matching.grants[0]).toMatchObject({ grant_id: 1856, in_run: true });
    expect(r.matching.grants[0].places[0]).toMatchObject({ section: 'Hiring', shown: false, dropped_at: 'eligibility', reasons: ['region: BC only'] });
    expect(deps.explain).toHaveBeenCalledWith({ grantId: 1856, companyId: 9, track: 'Hiring' });
    expect(r.match_explanations).toEqual([{ grant_id: 1856, track: 'Hiring', unavailable: 'match explanation unavailable (not_configured)' }]);
    expect(r.chat_cards).toEqual([{ card: 55, conversation: 41, title: 'Client pushed back on an answer', status: 'diagnosed', owner: 'chris',
      flags: 1, narrative: CARD_ROWS[0].narrative, link: 'https://hub.test/control-centre#review/55' }]);
    expect(deps.oracleQuery).toHaveBeenCalledWith(CHAT_CARDS_SQL, [[41]]);
    expect(CHAT_CARDS_SQL.trim()).toMatch(/^SELECT/);
    expect(r.owners).toContain('Research (grant card data)');
    expect(r.company_note).toMatch(/not available/);
    expect(deps.addFlag).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toMatch(/errors_sheet|spreadsheets/);
  });

  test('match-explain answers → only the verdict and reasons reach Oracle', async () => {
    const body = {
      grant_id: 1856, grant_name: 'BC Hiring Boost', company_id: 9, track: 'Hiring',
      llm_calls: [], tagger_run_log_available: true, profile_used: { province: 'BC' },
      current_tags: [{ tag: 'x', notes: 'tagger note' }],
      eligibility: { level: 'ineligible', reasons: ['Region mismatch'] },
      failing_axes: [{ axis: 'region', grant_constraint: 'ON only', profile_value: 'BC', suspicion_level: 'high', suspicion_reason: 'card text says BC eligible' }],
      verdict: { kind: 'BAD_TAG', owner: 'grant data', summary: 'Region tag says ON only but the card covers BC.', next: 'Fix the region tag.' }
    };
    const reduced = reduceExplain(body);
    const text = JSON.stringify(reduced);
    for (const gone of ['llm_calls', 'tagger', 'profile_used', 'current_tags', 'tagger note']) expect(text).not.toContain(gone);
    expect(reduced.verdict).toEqual({ kind: 'BAD_TAG', owner: 'grant data', summary: body.verdict.summary, next: 'Fix the region tag.' });
    expect(reduced.failing).toEqual(['ON only vs profile BC (card text says BC eligible)']);

    const { deps } = makeDeps({ ops: fakeOps({ runRows }), deps: { explain: jest.fn(async () => ({ ok: true, explain: reduced })) } });
    const r = await run({ mode: 'troubleshoot', client: '·9xyz', grants: ['1856'] }, deps);
    expect(r.match_explanations[0]).toMatchObject({ grant_id: 1856, verdict: { kind: 'BAD_TAG' } });
  });

  test('profile lookup failing (throws) degrades to no company', async () => {
    const { deps } = makeDeps({ deps: { fetchProfile: jest.fn(async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); }) } });
    const r = await run({ mode: 'troubleshoot', client: '·9xyz', complaint: 'chat broke' }, deps);
    expect(r.company).toBeNull();
    expect(r.company_note).toMatch(/TimeoutError/);
    expect(r.conversations).toHaveLength(1);
  });

  test('no matching run on record → says so, no explain call', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'troubleshoot', client: '·9xyz', grants: ['1856'] }, deps);
    expect(r.matching.run).toBeNull();
    expect(deps.explain).not.toHaveBeenCalled();
  });
});

describe('log_issue', () => {
  const issue = { mode: 'log_issue', name: 'Wage subsidy question misread', take: 'Answered with a hiring grant; prompt should ask which kind of support.', owner: 'Chris (AI behaviour)' };

  test('files a chat card as a staff flag from the asker, with the turns verbatim, and returns the link', async () => {
    const { deps } = makeDeps();
    const r = await run({ ...issue, conversation_id: 41, client_message: 1 }, deps);
    expect(r).toEqual({ logged: 'new card', card: 200, link: 'https://hub.test/control-centre#review/200', conversation: 41,
      client: '·9xyz', flagged_message: 1, source: 'reported by Steph Lee',
      note: expect.stringMatching(/diagnosed within the hour/) });
    const [input] = deps.addFlag.mock.calls[0];
    expect(input).toMatchObject({ kind: 'chat', chat_turn_ref: 'conv:41:staff_report', conversation_id: 41, company_id: 135,
      source: 'staff_flag', actor: 'steph@granted.ca' });
    expect(input.comment).toBe('Wage subsidy question misread: Answered with a hiring grant; prompt should ask which kind of support. (suggested owner: Chris (AI behaviour); reported by Steph Lee through Oracle)');
    expect(input.snapshot).toMatchObject({ source: 'oracle_staff_report', conversation_id: 41, flagged_turn_index: 0 });
    expect(input.snapshot.turns[0]).toMatchObject({ client: 'Are there hiring grants for a BC bakery?', assistant: 'Yes — BC Hiring Boost fits.', flagged: true });
    expect(deps.companyFor).toHaveBeenCalledWith(CLIENT);
  });

  test('a second report on the same conversation adds to its card; no message number flags the last one', async () => {
    const { deps } = makeDeps();
    await run({ ...issue, conversation_id: 41 }, deps);
    const r = await run({ ...issue, name: 'Same again', conversation_id: 41 }, deps);
    expect(r).toMatchObject({ logged: 'added to existing card', card: 200, flagged_message: 2 });
  });

  test('a client ref instead of a conversation uses their latest conversation', async () => {
    const { deps } = makeDeps();
    const r = await run({ ...issue, client: '·9xyz' }, deps);
    expect(r).toMatchObject({ logged: 'new card', conversation: 41 });
  });

  test('asker comes from the users table, then Chat — never from input', async () => {
    const { deps } = makeDeps({ deps: { oracleQuery: jest.fn(async (sql) => (/FROM users WHERE id/.test(sql) ? { rows: [{ name: '', email: 'x@granted.ca' }] } : { rows: [] })) } });
    const r = await run({ ...issue, conversation_id: 41, asker: 'Someone Else' }, deps);
    expect(r.source).toBe('reported by Chat Name');
    expect(deps.addFlag.mock.calls[0][0].actor).toBe('x@granted.ca');
  });

  test('bad owner, missing take, no conversation, unknown conversation → nothing filed', async () => {
    const { deps } = makeDeps();
    expect((await run({ ...issue, owner: 'Fadi (grant card data)', conversation_id: 41 }, deps)).error).toMatch(/owner must be one of/);
    expect((await run({ mode: 'log_issue', name: 'x', owner: 'Jason (app/UI)', conversation_id: 41 }, deps)).error).toMatch(/needs name/);
    expect((await run(issue, deps)).error).toMatch(/conversation number/);
    expect((await run({ ...issue, conversation_id: 999 }, deps)).error).toMatch(/No GetGranted conversation 999/);
    expect(deps.addFlag).not.toHaveBeenCalled();
  });

  test('the queue failing → nothing logged, said plainly', async () => {
    const { deps } = makeDeps({ deps: { addFlag: jest.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); }) } });
    const r = await run({ ...issue, conversation_id: 41 }, deps);
    expect(r.error).toMatch(/not available \(42P01\); nothing was logged/);
  });
});

describe('never reads review, model-call or tagger data', () => {
  test('no statement from any mode names those tables', async () => {
    const { deps, ops } = makeDeps({
      ops: fakeOps({ searchRows: [], runRows: [{ grant_id: 1856, section: 'Hiring', shown: true, position: 3 }] })
    });
    await run({ mode: 'read', client: '·9xyz' }, deps);
    await run({ mode: 'search', terms: ['hiring'] }, deps);
    await run({ mode: 'troubleshoot', client: '·9xyz', grants: ['1856'] }, deps);
    await run({ mode: 'log_issue', name: 'x', take: 't', owner: 'Jason (app/UI)', conversation_id: 41 }, deps);
    expect(ops.sent.length).toBeGreaterThan(5);
    for (const { sql } of ops.sent) expect(sql).not.toMatch(/ai_review_log|ai_review_cache|llm_calls|tagger/i);
  });
});

describe('helpers', () => {
  test('outcomes in plain words', () => {
    expect(outcomeWords('max_rounds', null)).toBe('chat broke');
    expect(outcomeWords('no_answer', 'refusal')).toBe('empty reply or refusal (refusal)');
    expect(outcomeWords('turn_cap', null)).toBe('hit the message limit');
  });

  test('grants named in tool results and shown as tiles', () => {
    const g = grantsIn(msgs);
    expect(g.names.get(77)).toBe('CanExport SMEs');
    expect(g.shown).toEqual(['BC Hiring Boost (1856)']);
  });

  test('legacy tile calls then the grant_ids column, first seen, no repeats, valid ids only', () => {
    expect(grantsIn(msgs, [1856, 77, 0, 'x', 77]).ids).toEqual([1856, 77]);
    expect(grantsIn([], [1742]).shown).toEqual(['grant 1742']);
  });

  test('unknown mode', async () => {
    const { deps } = makeDeps();
    expect((await run({ mode: 'delete' }, deps)).error).toMatch(/mode must be one of/);
  });
});
