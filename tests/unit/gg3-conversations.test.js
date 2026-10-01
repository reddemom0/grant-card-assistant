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
  windowFor, NAME_NOT_FOUND, SNIPPET_CHARS
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
function fakeOps({ resolveRows = [{ user_id: CLIENT, last_active: NOW }], convRows, turnRows = [], searchRows = [], runRows = [], configured = true } = {}) {
  const sent = [];
  const q = jest.fn(async (sql, params) => {
    sent.push({ sql, params });
    if (!configured) return { configured: false };
    if (/max\(updated_at\) AS last_active/.test(sql)) return { configured: true, rows: resolveRows };
    if (/FROM chat_turns\s+WHERE conversation_id = ANY/.test(sql)) return { configured: true, rows: turnRows };
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

const SHEET_ROWS = [
  ['Chat times out on long answers', '2026-09-20', '2026-09-30', '3', 'Acme', 'Jason (app/UI)', 'being fixed', 'Jason on it', 'Oracle-detected']
];

function makeDeps(over = {}) {
  const ops = over.ops || fakeOps();
  return {
    ops,
    deps: {
      userId: 7,
      chatContext: { surface: 'chat_dm', senderDisplayName: 'Chat Name' },
      env: { PULSE_ERRORS_SHEET_ID: 'sheet123', PULSE_SHEET_OWNER_EMAIL: 'owner@granted.ca' },
      now: () => NOW,
      runQuery: ops.q,
      oracleQuery: jest.fn(async (sql) => (/FROM users WHERE id/.test(sql)
        ? { rows: [{ name: 'Steph Lee', email: 'steph@granted.ca' }] }
        : { rows: [{ id: 3 }] })),
      fetchProfile: jest.fn(async () => ({ status: 404, companyName: null })),
      explain: jest.fn(async () => ({ ok: false, code: 'not_configured' })),
      findGrant: jest.fn(async () => null),
      writeSheet: jest.fn(async (_u, c) => ({ url: 'https://sheet/x', title: c.title, id: 'x' })),
      readSheet: jest.fn(async () => ({ success: true, data: { values: SHEET_ROWS } })),
      updateSheet: jest.fn(async () => ({ success: true })),
      appendSheet: jest.fn(async () => ({ success: true })),
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
    client_text: `${'Earlier question. '.repeat(5)}Do you have hiring grants for students? (${i})`, ...extra
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
    expect(ops.sent[0].sql.match(/FROM chat_turns t/g)).toHaveLength(2);
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
    expect(content.tables[0].columns.map(c => c.label)).toEqual(['Client', 'Last active', 'Mode', 'Chat failed', 'What they asked']);
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

  test('windows are capped at 90 days', () => {
    const w = windowFor({ from: '2026-01-01', to: '2026-09-30' }, NOW);
    expect(w.until).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect((w.until - w.since) / 864e5).toBe(90);
  });
});

describe('troubleshoot', () => {
  const runRows = [{ grant_id: 1856, section: 'Hiring', shown: false, position: null, deleted_at_stage: 'eligibility', match_score: 0.41, eligibility: 'ineligible', eligibility_reasons: ['region: BC only'] }];

  test('without match-explain configured: evidence, match context, sheet issues; writes nothing', async () => {
    const { deps } = makeDeps({ ops: fakeOps({ runRows }) });
    const r = await run({ mode: 'troubleshoot', client: '·9xyz', complaint: 'matches made no sense', grants: ['BC Hiring Boost'] }, deps);
    expect(r.grants_named).toEqual([{ asked: 'BC Hiring Boost', id: 1856, name: 'BC Hiring Boost' }]);
    expect(r.matching.run).toEqual({ at: NOW.toISOString(), company_id: 9 });
    expect(r.matching.grants[0]).toMatchObject({ grant_id: 1856, in_run: true });
    expect(r.matching.grants[0].places[0]).toMatchObject({ section: 'Hiring', shown: false, dropped_at: 'eligibility', reasons: ['region: BC only'] });
    expect(deps.explain).toHaveBeenCalledWith({ grantId: 1856, companyId: 9, track: 'Hiring' });
    expect(r.match_explanations).toEqual([{ grant_id: 1856, track: 'Hiring', unavailable: 'match explanation unavailable (not_configured)' }]);
    expect(r.errors_sheet.issues[0]).toMatchObject({ row: 2, name: 'Chat times out on long answers', status: 'being fixed' });
    expect(r.owners).toContain('Research (grant card data)');
    expect(r.company_note).toMatch(/not available/);
    expect(deps.updateSheet).not.toHaveBeenCalled();
    expect(deps.appendSheet).not.toHaveBeenCalled();
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
  test('new issue → appended with Source "reported by <asker>" and the take in Notes', async () => {
    const { deps } = makeDeps({ deps: { fetchProfile: jest.fn(async () => ({ status: 200, companyName: 'Acme Bakery' })) } });
    const r = await run({ mode: 'log_issue', name: 'Hiring grant hidden by region tag', take: 'Region tag excludes BC; fix the tag.', owner: 'Research (grant card data)', client: '·9xyz', existing_row: null }, deps);
    expect(r).toMatchObject({ logged: 'added', source: 'reported by Steph Lee' });
    const [, args] = deps.appendSheet.mock.calls[0];
    expect(args.values[0]).toEqual(['Hiring grant hidden by region tag', '2026-10-01', '2026-10-01', 1, 'Acme Bakery', 'Research (grant card data)', 'new', 'Region tag excludes BC; fix the tag.', 'reported by Steph Lee']);
    expect(deps.updateSheet).not.toHaveBeenCalled();
  });

  test('existing issue → C–E only; status, notes and source untouched', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'log_issue', name: 'Chat timing out', take: 'Same timeout.', owner: 'Jason (app/UI)', client: '·9xyz', existing_row: 2 }, deps);
    expect(r).toMatchObject({ logged: 'updated', row: 2 });
    const [, args] = deps.updateSheet.mock.calls[0];
    expect(args.range).toBe('C2:E2');
    expect(args.values).toEqual([['2026-10-01', 4, 'Acme, a client ·9xyz']]);
    expect(deps.appendSheet).not.toHaveBeenCalled();
  });

  test('a row number that wasn\'t read falls back to a name match', async () => {
    const { deps } = makeDeps();
    const r = await run({ mode: 'log_issue', name: 'chat times out on long answers', take: 't', owner: 'Jason (app/UI)', existing_row: 99 }, deps);
    expect(r).toMatchObject({ logged: 'updated', row: 2 });
  });

  test('asker comes from the users table, then Chat — never from input', async () => {
    const { deps } = makeDeps({ deps: { oracleQuery: jest.fn(async (sql) => (/FROM users WHERE id/.test(sql) ? { rows: [{ name: '', email: 'x@granted.ca' }] } : { rows: [{ id: 3 }] })) } });
    const r = await run({ mode: 'log_issue', name: 'New thing', take: 't', owner: 'Chris (AI behaviour)', asker: 'Someone Else' }, deps);
    expect(r.source).toBe('reported by Chat Name');
  });

  test('bad owner or missing take → nothing written', async () => {
    const { deps } = makeDeps();
    expect((await run({ mode: 'log_issue', name: 'x', take: 't', owner: 'Fadi (grant card data)' }, deps)).error).toMatch(/owner must be one of/);
    expect((await run({ mode: 'log_issue', name: 'x', owner: 'Jason (app/UI)' }, deps)).error).toMatch(/needs name/);
    expect(deps.appendSheet).not.toHaveBeenCalled();
    expect(deps.updateSheet).not.toHaveBeenCalled();
  });

  test('sheet not configured → nothing logged', async () => {
    const { deps } = makeDeps({ deps: { env: {} } });
    const r = await run({ mode: 'log_issue', name: 'x', take: 't', owner: 'Jason (app/UI)' }, deps);
    expect(r.error).toMatch(/not available \(not_configured\)/);
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
    await run({ mode: 'log_issue', name: 'x', take: 't', owner: 'Jason (app/UI)', client: '·9xyz' }, deps);
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

  test('unknown mode', async () => {
    const { deps } = makeDeps();
    expect((await run({ mode: 'delete' }, deps)).error).toMatch(/mode must be one of/);
  });
});
