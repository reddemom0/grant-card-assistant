/**
 * control-centre diagnosis (step 5): owner routing per candidate_cause, the
 * owner/verdict override, Sonnet output validation, client notices, the
 * match-explain fetch, chat snapshots, and the plain-words three-strike text.
 * Fixtures only — no network, no DB, no model.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-diagnosis.test.js
 */

import { jest } from '@jest/globals';
import {
  routeFor, applyRoute, fetchBadMatch, splitTurns, readChatSnapshot, takeSnapshot, diagnoseItem,
  sentenceCount, wordCount, regionBlamed,
  buildUserPrompt, evidenceForMatch, plainError, couldNotDiagnose, DIAGNOSIS_TOOL, VERDICTS,
  CHAT_TURN_SQL, CHAT_TURN_ROWS_SQL, CONVERSATION_MESSAGES_SQL, DIAGNOSIS_MODEL
} from '../../src/control-centre/diagnosis.js';
import { OWNERS } from '../../src/control-centre/review-queue.js';

const NARRATIVE = 'The grant was shown because its topic matched the client goals. Its card names no restriction that excludes them.';
const match = { id: 1, kind: 'match', company_id: 81, grant_root_id: 1196, snapshot: null };
const chat = { id: 2, kind: 'chat', chat_turn_ref: 'turn-abc', snapshot: null };
const snap = (cause, extra = {}) => ({ source: 'match_explain', response: { candidate_cause: cause ? { cause } : null, ...extra } });

let warnSpy;
beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warnSpy.mockRestore());

describe('routing table', () => {
  test.each([
    ['PROFILE_GAP', 'profile_gap', ['client'], 'client'],
    ['RANKED_ON_GENRE', 'ranked_on_genre', ['chris'], 'chris'],
    ['LOOKS_CORRECT', 'looks_correct', ['chris'], 'chris'],
    ['NO_CONSTRAINT_TAG', 'no_constraint_tag', ['chris', 'research'], 'chris'],
    [null, 'unclear', ['chris'], 'chris'],
    ['SOMETHING_NEW', 'unclear', ['chris'], 'chris']
  ])('%s → rule %s, allowed %j, default %s', (cause, rule, allowed, def) => {
    expect(routeFor(match, snap(cause))).toMatchObject({ rule, allowed, default: def });
  });

  test('NO_CONSTRAINT_TAG with the region check most suspect goes to research only', () => {
    const lenient = (axis) => ({ lenient_axes: [{ axis, risk_tier: 1 }, { axis: 'industry', risk_tier: 6 }] });
    expect(regionBlamed(lenient('province'))).toBe(true);
    expect(regionBlamed(lenient('industry'))).toBe(false);
    expect(routeFor(match, snap('NO_CONSTRAINT_TAG', lenient('province'))))
      .toMatchObject({ rule: 'no_constraint_region', allowed: ['research'], default: 'research' });
    // province present but not the most suspect → the ordinary tag rule
    const later = { lenient_axes: [{ axis: 'industry', risk_tier: 1 }, { axis: 'province', risk_tier: 7 }] };
    expect(routeFor(match, snap('NO_CONSTRAINT_TAG', later))).toMatchObject({ rule: 'no_constraint_tag' });
  });

  test('region-blamed: tag_missed_restriction or chris is overridden to research', () => {
    const route = routeFor(match, snap('NO_CONSTRAINT_TAG', { lenient_axes: [{ axis: 'province', risk_tier: 1 }] }));
    const r = applyRoute({ owner: 'chris', verdict: 'tag_missed_restriction', narrative: NARRATIVE }, route);
    expect(r).toMatchObject({ ok: true, owner: 'research', verdict: 'region_list_wrong' });
    expect(r.override.changes).toEqual(['verdict tag_missed_restriction → region_list_wrong', 'owner chris → research']);
    expect(applyRoute({ owner: 'research', verdict: 'region_list_wrong', narrative: NARRATIVE }, route))
      .toMatchObject({ ok: true, owner: 'research', override: null });
  });

  test('a missing grant (BAD_RECORD) goes to research whatever the cause', () => {
    expect(routeFor(match, snap(null, { verdict: { kind: 'BAD_RECORD' } }))).toMatchObject({ rule: 'bad_record', allowed: ['research'] });
  });

  test('chat items go to chris by default, research only for wrong grant facts', () => {
    const r = routeFor(chat, { source: 'ops_chat' });
    expect(r).toMatchObject({ rule: 'chat', allowed: ['chris', 'research'], default: 'chris' });
    expect(r.ownerByVerdict).toEqual({ chat_wrong_grant_facts: 'research', chat_answer_problem: 'chris', unclear: 'chris' });
  });

  test('the tool enum lists exactly the queue owners and the verdicts', () => {
    expect(DIAGNOSIS_TOOL.input_schema.properties.owner.enum).toEqual([...OWNERS]);
    expect(DIAGNOSIS_TOOL.input_schema.properties.verdict.enum).toEqual([...VERDICTS]);
    expect(VERDICTS).not.toContain('could_not_diagnose');
  });
});

describe('applyRoute', () => {
  const out = (o) => ({ owner: 'chris', verdict: 'ranked_on_genre', narrative: NARRATIVE, ...o });

  test('an allowed answer passes untouched', () => {
    expect(applyRoute(out(), routeFor(match, snap('RANKED_ON_GENRE')))).toMatchObject({ ok: true, owner: 'chris', verdict: 'ranked_on_genre', override: null });
  });

  test('a disallowed owner is overridden to the rule owner and noted', () => {
    const r = applyRoute(out({ owner: 'research' }), routeFor(match, snap('RANKED_ON_GENRE')));
    expect(r).toMatchObject({ ok: true, owner: 'chris' });
    expect(r.override).toMatchObject({ proposed: { owner: 'research' }, applied: { owner: 'chris' }, rule: 'ranked_on_genre' });
  });

  test('LOOKS_CORRECT forces verdict looks_correct', () => {
    const r = applyRoute(out({ verdict: 'unclear' }), routeFor(match, snap('LOOKS_CORRECT')));
    expect(r).toMatchObject({ ok: true, owner: 'chris', verdict: 'looks_correct' });
    expect(r.override.changes).toContain('verdict unclear → looks_correct');
  });

  test('NO_CONSTRAINT_TAG: the verdict decides chris (tag missed it) vs research (card does not say it)', () => {
    const route = routeFor(match, snap('NO_CONSTRAINT_TAG'));
    expect(applyRoute(out({ owner: 'chris', verdict: 'tag_missed_restriction' }), route)).toMatchObject({ owner: 'chris', override: null });
    expect(applyRoute(out({ owner: 'research', verdict: 'card_missing_restriction' }), route)).toMatchObject({ owner: 'research', override: null });
    const crossed = applyRoute(out({ owner: 'chris', verdict: 'card_missing_restriction' }), route);
    expect(crossed).toMatchObject({ owner: 'research' });
    expect(crossed.override.changes).toContain('owner chris → research');
    const offList = applyRoute(out({ owner: 'client', verdict: 'profile_incomplete' }), route);
    expect(offList).toMatchObject({ owner: 'chris', verdict: 'tag_missed_restriction' });
  });

  test('PROFILE_GAP → client, and a client notice is required', () => {
    const route = routeFor(match, snap('PROFILE_GAP'));
    expect(applyRoute(out({ owner: 'client', verdict: 'profile_incomplete' }), route)).toEqual({ ok: false, code: 'bad_model_output:client_notice' });
    const r = applyRoute(out({ owner: 'chris', verdict: 'profile_incomplete',
      client_notice: 'Tell the client to: add their number of employees.' }), route);
    expect(r).toMatchObject({ ok: true, owner: 'client', client_notice: 'Tell the client to: add their number of employees.' });
    expect(applyRoute(out({ owner: 'client', verdict: 'profile_incomplete', client_notice: 'Please update the profile.' }), route).ok).toBe(false);
  });

  test('a client notice is dropped when the owner is not client', () => {
    const r = applyRoute(out({ client_notice: 'Tell the client to: nothing.' }), routeFor(match, snap('RANKED_ON_GENRE')));
    expect(r.client_notice).toBeNull();
  });

  test('bad JSON shapes fail with a code', () => {
    const route = routeFor(match, snap('RANKED_ON_GENRE'));
    expect(applyRoute(null, route)).toEqual({ ok: false, code: 'bad_model_output:no_tool_call' });
    expect(applyRoute(out({ narrative: 'Short.' }), route).code).toBe('bad_model_output:narrative_length');
    expect(applyRoute(out({ verdict: 'whatever' }), route).code).toBe('bad_model_output:verdict');
  });

  test('narratives must be 2–3 sentences and at most 70 words', () => {
    const route = routeFor(match, snap('RANKED_ON_GENRE'));
    const s = 'The grant was shown because its topic matched the goals.';
    expect(applyRoute(out({ narrative: s }), route).code).toBe('bad_model_output:narrative_sentences');
    expect(applyRoute(out({ narrative: `${s} ${s}` }), route).ok).toBe(true);
    expect(applyRoute(out({ narrative: `${s} ${s} ${s}` }), route).ok).toBe(true);
    expect(applyRoute(out({ narrative: `${s} ${s} ${s} ${s}` }), route).code).toBe('bad_model_output:narrative_too_long');
    const wordy = `${'very '.repeat(40)}long first sentence here. ${'and '.repeat(30)}a second one.`;
    expect(wordCount(wordy)).toBeGreaterThan(70);
    expect(applyRoute(out({ narrative: wordy }), route).code).toBe('bad_model_output:narrative_too_long');
  });

  test('abbreviations do not end sentences', () => {
    expect(sentenceCount('It is open to any B.C. business. It pays up to $2.5M, e.g. for wages.')).toBe(2);
    expect(sentenceCount('Acme Inc. applied in the U.S. last year. It was refused.')).toBe(2);
  });
});

describe('fetchBadMatch', () => {
  const env = { GG3_AI_SERVICE_URL: 'http://svc/', GG3_REVIEW_FEED_TOKEN: 'tok' };
  const res = (status, body) => ({ ok: status === 200, status, json: async () => body });

  test('asks for mode=bad_match without a track, with the bearer', async () => {
    const fetchImpl = jest.fn(async () => res(200, { mode: 'bad_match' }));
    expect(await fetchBadMatch({ grantId: 1196, companyId: 81 }, { env, fetchImpl })).toEqual({ ok: true, body: { mode: 'bad_match' } });
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://svc/api/v1/ai/internal/match-explain?mode=bad_match&grant_id=1196&company_id=81');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  test('error codes carry the status and the service error', async () => {
    expect(await fetchBadMatch({ grantId: 1, companyId: 2 }, { env: {}, fetchImpl: jest.fn() })).toEqual({ ok: false, code: 'not_configured' });
    expect((await fetchBadMatch({ grantId: 1, companyId: 2 }, { env, fetchImpl: async () => res(422, { error: 'company_not_resolved' }) })).code)
      .toBe('explain_422_company_not_resolved');
    expect((await fetchBadMatch({ grantId: 1, companyId: 2 }, { env, fetchImpl: async () => res(500, null) })).code).toBe('explain_500');
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    expect((await fetchBadMatch({ grantId: 1, companyId: 2 }, { env, fetchImpl: async () => { throw timeout; } })).code).toBe('explain_timeout');
  });
});

describe('chat snapshots', () => {
  const messages = [];
  for (let i = 0; i < 6; i++) {
    messages.push({ role: 'user', content: `question ${i}` });
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `thinking ${i}` }, { type: 'tool_use', name: 'search_grants', input: {} }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', content: 'rows' }] }); // not a turn
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] });
  }

  test('splitTurns counts only string user messages as turns', () => {
    const turns = splitTurns(messages);
    expect(turns).toHaveLength(6);
    expect(turns[2]).toEqual({ turn_index: 2, client: 'question 2', assistant: 'thinking 2\n\nanswer 2', tools_used: ['search_grants'] });
  });

  test('the flagged turn and the 3 before it, read-only SELECTs', async () => {
    const opsQuery = jest.fn(async (sql) => {
      if (sql === CHAT_TURN_SQL) return { rows: [{ turn_id: 'turn-abc', conversation_id: 9, turn_index: 4, outcome: 'completed', mode: 'advisor' }] };
      if (sql === CONVERSATION_MESSAGES_SQL) return { rows: [{ messages }] };
      if (sql === CHAT_TURN_ROWS_SQL) return { rows: [{ turn_index: 4, outcome: 'completed', surfaced_grant_ids: [1196] }] };
      throw new Error('unexpected');
    });
    const r = await readChatSnapshot('turn-abc', { opsQuery });
    expect(r.ok).toBe(true);
    expect(r.body.turns.map((t) => t.turn_index)).toEqual([1, 2, 3, 4]);
    expect(r.body.turns.at(-1)).toMatchObject({ flagged: true, client: 'question 4', surfaced_grant_ids: [1196] });
    expect(opsQuery).toHaveBeenCalledWith(CHAT_TURN_ROWS_SQL, [9, 1, 4]);
    expect(opsQuery.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('an unknown ref is a failure code; no ops DB is not_configured', async () => {
    expect(await readChatSnapshot('nope', { opsQuery: async () => ({ rows: [] }) })).toEqual({ ok: false, code: 'chat_turn_not_found' });
    expect(await takeSnapshot(chat, { opsQuery: null })).toMatchObject({ ok: false, notConfigured: true });
  });
});

describe('takeSnapshot', () => {
  test('a stored snapshot is reused without fetching', async () => {
    const fetchBadMatch = jest.fn();
    const r = await takeSnapshot({ ...match, snapshot: { source: 'match_explain', response: {} }, snapshot_at: 'then' }, { fetchBadMatch });
    expect(r).toMatchObject({ ok: true, taken: false, snapshotAt: 'then' });
    expect(fetchBadMatch).not.toHaveBeenCalled();
  });
});

describe('diagnoseItem', () => {
  const base = (over = {}) => ({
    env: { ANTHROPIC_API_KEY: 'k' },
    fetchBadMatch: async () => ({ ok: true, body: { grant_name: 'G', candidate_cause: { cause: 'PROFILE_GAP', rule: 'profile_gap_profile_side', evidence: ['size gap'] } } }),
    createMessage: jest.fn(async () => ({
      usage: { input_tokens: 3000, output_tokens: 200 },
      content: [{ type: 'tool_use', name: 'record_diagnosis',
        input: { owner: 'client', verdict: 'profile_incomplete', narrative: NARRATIVE, client_notice: 'Tell the client to: add their headcount.' } }]
    })),
    logCost: null,
    opsQuery: null,
    ...over
  });

  test('PROFILE_GAP end to end: client owner, notice, diagnosis fields, cost, Sonnet 5.5', async () => {
    const ctx = base();
    const r = await diagnoseItem(match, ctx);
    expect(r).toMatchObject({ ok: true, owner: 'client', verdict: 'profile_incomplete',
      client_notice: 'Tell the client to: add their headcount.', snapshotTaken: true });
    expect(r.diagnosis).toMatchObject({ candidate_cause: 'PROFILE_GAP', candidate_rule: 'profile_gap_profile_side',
      evidence: ['size gap'], verdict: 'profile_incomplete', model: DIAGNOSIS_MODEL });
    expect(r.cost).toBeGreaterThan(0);
    const params = ctx.createMessage.mock.calls[0][0];
    // Sonnet 5.5 rejects a forced tool_choice; the prompt requires the call instead.
    expect(params).toMatchObject({ model: 'claude-sonnet-5-5', tool_choice: { type: 'auto' }, tools: [expect.objectContaining({ name: 'record_diagnosis' })] });
    expect(params.system).toMatch(/calling the record_diagnosis tool/);
  });

  test('a model error keeps the snapshot for the retry', async () => {
    const r = await diagnoseItem(match, base({ createMessage: async () => { throw Object.assign(new Error('x'), { status: 529 }); } }));
    expect(r).toMatchObject({ ok: false, error: 'model_529', snapshotTaken: true });
    expect(r.snapshot.response.grant_name).toBe('G');
  });

  describe('corrective retry for an over-long narrative', () => {
    const LONG = 'One thing happened here today. Then another thing happened. A third thing followed it. And a fourth one came last.';
    const reply = (id, narrative) => ({
      usage: { input_tokens: 3000, output_tokens: 200 },
      content: [{ type: 'tool_use', id, name: 'record_diagnosis', input: { owner: 'chris', verdict: 'ranked_on_genre', narrative } }]
    });
    const genre = { fetchBadMatch: async () => ({ ok: true, body: { candidate_cause: { cause: 'RANKED_ON_GENRE' } } }) };

    test('retries once in the same attempt with a tool_result and accepts the shorter one', async () => {
      const createMessage = jest.fn()
        .mockResolvedValueOnce(reply('tu_1', LONG))
        .mockResolvedValueOnce(reply('tu_2', NARRATIVE));
      const r = await diagnoseItem(match, base({ ...genre, createMessage }));
      expect(r).toMatchObject({ ok: true, narrative: NARRATIVE, diagnosis: { narrative_corrected: true } });
      expect(createMessage).toHaveBeenCalledTimes(2);
      const msgs = createMessage.mock.calls[1][0].messages;
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(msgs[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
      expect(msgs[2].content[0].content).toMatch(/4 sentences/);
      expect(r.cost).toBeCloseTo(2 * (3000 * 2 + 200 * 10) / 1e6, 6);
    });

    test('a second over-long reply fails the attempt (no third call)', async () => {
      const createMessage = jest.fn(async () => reply('tu_x', LONG));
      const r = await diagnoseItem(match, base({ ...genre, createMessage }));
      expect(r).toMatchObject({ ok: false, error: 'bad_model_output:narrative_too_long', snapshotTaken: true });
      expect(createMessage).toHaveBeenCalledTimes(2);
    });

    test('other bad output is not retried in-attempt', async () => {
      const createMessage = jest.fn(async () => reply('tu_y', 'Too short.'));
      const r = await diagnoseItem(match, base({ ...genre, createMessage }));
      expect(r.error).toBe('bad_model_output:narrative_length');
      expect(createMessage).toHaveBeenCalledTimes(1);
    });
  });

  test('no API key → null (not an attempt)', async () => {
    expect(await diagnoseItem(match, { env: {}, opsQuery: null })).toBeNull();
  });
});

describe('prompt', () => {
  test('evidence is data inside <evidence>, with the allowed owners and the rule', () => {
    const body = { grant_name: 'G', candidate_cause: { cause: 'NO_CONSTRAINT_TAG' }, card: { eligibility_sections: 'Agri-food only.' },
      review_log: [{ occurred_at: '2026-10-12T00:00:00Z', track: 'T', action: 'cut', category: 'wrong_industry', suspected_cause: 'industry_tag', reason: 'agri only' }] };
    const route = routeFor(match, { response: body });
    const p = buildUserPrompt(match, { response: body }, route, ['staff says wrong']);
    expect(p).toMatch(/Allowed owners: chris, research/);
    expect(p).toMatch(/<evidence>[\s\S]*Agri-food only\.[\s\S]*<\/evidence>/);
    expect(p).toMatch(/staff says wrong/);
    expect(evidenceForMatch(body).automatic_reviews[0]).toMatchObject({ date: '2026-10-12', reason: 'agri only' });
  });
});

describe('three strikes', () => {
  test('plain words, no codes', () => {
    expect(plainError('explain_422_company_not_resolved')).toMatch(/couldn't find this company's profile/);
    expect(plainError('bad_model_output:verdict')).toMatch(/wasn't usable/);
    expect(plainError('weird')).toBe('something unexpected went wrong');
    expect(couldNotDiagnose('explain_timeout', 3)).toMatchObject({
      owner: 'chris', verdict: 'could_not_diagnose', client_notice: null,
      diagnosis: { verdict: 'could_not_diagnose', last_error: 'explain_timeout', attempts: 3 }
    });
  });
});
