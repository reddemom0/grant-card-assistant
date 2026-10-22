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
  CHAT_TURN_SQL, CHAT_TURN_ROWS_SQL, CONVERSATION_MESSAGES_SQL, DIAGNOSIS_MODEL,
  CHAT_FIELDS, chatTurnsAround, parseConversationRef, evidenceForPattern,
  isConsultingItem, flaggedTurn, consultingNarrative, diagnoseDeadline
} from '../../src/control-centre/diagnosis.js';
import {
  patternSnapshot, grantEvidence, groupCuts, qualifies, CUTS_SQL, CUTS_BY_ID_SQL, GRANT_ROW_SQL, PATTERN_FLAG_REFS_SQL
} from '../../src/control-centre/grant-patterns.js';
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

// ---------------------------------------------------------------------------
// Grant patterns and the richer chat diagnosis (migration 047)
// ---------------------------------------------------------------------------

const pattern = { id: 5, kind: 'grant_pattern', grant_root_id: 1196, pattern_category: 'wrong_industry', snapshot: null };
const CHAT_ANSWER = {
  client_asked: 'Whether CanExport covers trade-show travel.',
  assistant_replied: 'It said CanExport closed for the year.',
  what_was_wrong: 'CanExport is open; the deadline quoted was last year\'s.',
  good_answer: 'CanExport is open and covers trade-show travel up to 50%.',
  suggested_fix: 'Have the assistant check the grant\'s status before quoting a deadline.'
};

describe('empty_track routing', () => {
  const empty = { id: 9, kind: 'empty_track', company_id: 135, goal_track: 'Improve Sustainability' };

  test('profile gap → client with a notice; no grants for the goal → research; otherwise chris', () => {
    const route = routeFor(empty, {});
    expect(route).toMatchObject({ rule: 'empty_track', allowed: ['client', 'research', 'chris'], default: 'chris' });
    expect(applyRoute({ owner: 'chris', verdict: 'profile_incomplete', narrative: NARRATIVE, client_notice: 'Tell the client to: add their revenue.' }, route))
      .toMatchObject({ ok: true, owner: 'client', client_notice: 'Tell the client to: add their revenue.' });
    expect(applyRoute({ owner: 'chris', verdict: 'profile_incomplete', narrative: NARRATIVE }, route)).toEqual({ ok: false, code: 'bad_model_output:client_notice' });
    expect(applyRoute({ owner: 'chris', verdict: 'no_grants_for_goal', narrative: NARRATIVE }, route)).toMatchObject({ owner: 'research' });
    expect(applyRoute({ owner: 'research', verdict: 'unclear', narrative: NARRATIVE }, route)).toMatchObject({ owner: 'chris' });
  });

  test('its evidence is the snapshot filed with it; without one it fails plainly, with no read', async () => {
    const r = await takeSnapshot({ ...empty, snapshot: null }, { opsQuery: async () => { throw new Error('no read'); } });
    expect(r).toEqual({ ok: false, code: 'empty_track_no_evidence' });
    expect(plainError('empty_track_no_evidence')).toMatch(/without its evidence/);
    const prompt = buildUserPrompt(empty, { goal: 'Improve Sustainability', considered: 190 }, routeFor(empty, {}));
    expect(prompt).toMatch(/goal track that showed the client nothing/);
    expect(prompt).toMatch(/"considered": 190/);
  });
});

describe('grant_pattern routing', () => {
  test('a tag/eligibility pattern: tag missed → chris, card lacks it → research, unclear → chris', () => {
    const route = routeFor(pattern, { grant: { name: 'G' } });
    expect(route).toMatchObject({ rule: 'pattern_tag', allowed: ['chris', 'research'], default: 'chris' });
    expect(applyRoute({ owner: 'research', verdict: 'tag_missed_restriction', narrative: NARRATIVE }, route)).toMatchObject({ owner: 'chris' });
    expect(applyRoute({ owner: 'chris', verdict: 'card_missing_restriction', narrative: NARRATIVE }, route)).toMatchObject({ owner: 'research' });
    expect(applyRoute({ owner: 'research', verdict: 'unclear', narrative: NARRATIVE }, route)).toMatchObject({ owner: 'chris' });
    expect(applyRoute({ owner: 'chris', verdict: 'profile_incomplete', narrative: NARRATIVE }, route))
      .toMatchObject({ verdict: 'tag_missed_restriction', owner: 'chris' });
  });

  test('a wrong_region pattern is research whatever the verdict', () => {
    const route = routeFor({ ...pattern, pattern_category: 'wrong_region' }, { grant: { name: 'G' } });
    expect(route).toMatchObject({ rule: 'pattern_region', allowed: ['research'] });
    expect(applyRoute({ owner: 'chris', verdict: 'tag_missed_restriction', narrative: NARRATIVE }, route))
      .toMatchObject({ owner: 'research', verdict: 'region_list_wrong' });
  });

  test('a grant missing from the grant data is a bad record for research', () => {
    expect(routeFor(pattern, { grant: null })).toMatchObject({ rule: 'bad_record', forcedVerdict: 'bad_record' });
  });
});

describe('grant_pattern snapshot', () => {
  const cutRows = [
    { id: '11', occurred_at: new Date('2026-10-09T10:00:00Z'), grant_id: 1196, category: 'wrong_industry', track: 'Hire', reason: 'Fishing only.', suspected_cause: 'industry_tag', clerk_id: 'user_a' },
    { id: '12', occurred_at: new Date('2026-10-10T10:00:00Z'), grant_id: 1196, category: 'wrong_industry', track: 'Hire', reason: 'Fishing only, again.', suspected_cause: 'industry_tag', clerk_id: 'user_staff' }
  ];
  const grantRow = { id: 1196, grant_name: 'Fisheries Fund', status: 'Open', industries: ['Fishing'], regions: ['BC'],
    eligibility_criteria: { extraction_notes: 'none' }, field_content: { eligibility: '<p>Commercial <b>fishing</b> only.</p>' } };

  test('grant tags and card text from gg3_grants, cuts with companies named and internal tagged; reads only', async () => {
    const hubQuery = jest.fn(async (sql) => {
      if (sql === PATTERN_FLAG_REFS_SQL) return { rows: [{ source_ref: 'ai_review:12' }, { source_ref: 'ai_review:11' }] };
      if (sql === GRANT_ROW_SQL) return { rows: [grantRow] };
      throw new Error('unexpected');
    });
    const opsQuery = jest.fn(async (sql) => (sql === CUTS_BY_ID_SQL ? { rows: cutRows } : { rows: [] }));
    const appQuery = jest.fn(async (sql) => (/users_clerk/.test(sql)
      ? { rows: [{ clerk_id: 'user_a', user_id: 1, company_id: 120, is_primary: true }, { clerk_id: 'user_staff', user_id: 2, company_id: 81, is_primary: true }] }
      : { rows: [{ id: 120, name: 'Acme' }, { id: 81, name: 'Maximizer' }] }));
    const r = await patternSnapshot(pattern, { hubQuery, opsQuery, appQuery });
    expect(r.ok).toBe(true);
    expect(opsQuery).toHaveBeenCalledWith(CUTS_BY_ID_SQL, [['12', '11']]);
    expect(r.body).toMatchObject({ category: 'wrong_industry', companies: 2, internal_companies: 1,
      grant: { name: 'Fisheries Fund', industries: ['Fishing'], regions: ['BC'], card: [{ section: 'Eligibility', text: 'Commercial fishing only.' }] } });
    expect(r.body.grant.links).toBeUndefined();
    expect(r.body.cuts).toEqual([
      expect.objectContaining({ date: '2026-10-09', company_name: 'Acme', company_internal: false, reason: 'Fishing only.' }),
      expect.objectContaining({ date: '2026-10-10', company_name: 'Maximizer', company_internal: true })
    ]);
    for (const q of [hubQuery, opsQuery, appQuery]) expect(q.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('the dry run passes cut ids directly; no cuts is a failure code', async () => {
    const hubQuery = jest.fn(async () => ({ rows: [] }));
    const r = await patternSnapshot(pattern, { hubQuery, opsQuery: async () => ({ rows: [] }), appQuery: async () => ({ rows: [] }), cutIds: ['99'] });
    expect(r).toEqual({ ok: false, code: 'pattern_no_cuts' });
    expect(hubQuery).not.toHaveBeenCalledWith(PATTERN_FLAG_REFS_SQL, expect.anything());
    expect(plainError('pattern_no_cuts')).toMatch(/automatic reviews/);
  });

  test('evidence for the model names companies, never Clerk ids', () => {
    const ev = evidenceForPattern({ category: 'wrong_industry', companies: 3, internal_companies: 1,
      grant: grantEvidence(grantRow, { grantTags: (row) => ({ name: row.grant_name, industries: row.industries, links: {} }), cardSections: () => [{ label: 'Eligibility', text: 'Fishing only.' }] }),
      cuts: [{ date: '2026-10-09', company_name: 'Acme', company_internal: false, reason: 'r', clerk_id: 'user_a' }] });
    expect(ev.card_text).toBe('Eligibility:\nFishing only.');
    expect(JSON.stringify(ev)).not.toMatch(/user_a/);
    expect(ev.automatic_reviews[0]).toMatchObject({ company: 'Acme', internal_account: false });
    expect(ev.of_which_internal_accounts).toBe(1);
  });

  test('groupCuts counts distinct companies only; qualifies at 3 or with an existing card', () => {
    const g = groupCuts([
      { id: '1', grant_id: 7, category: 'c', company_id: 1 }, { id: '2', grant_id: 7, category: 'c', company_id: 1 },
      { id: '3', grant_id: 7, category: 'c', company_id: null }, { id: '4', grant_id: 7, category: 'c', company_id: 2 }
    ]).get('7|c');
    expect(g.companies).toEqual([1, 2]);
    expect(g.cuts).toHaveLength(4);
    expect(qualifies(g, null)).toBe(false);
    expect(qualifies(g, { id: 1 })).toBe(true);
    expect(qualifies({ ...g, companies: [1, 2, 3] }, null)).toBe(true);
  });

  test('CUTS_SQL reads cuts only, real Clerk users only, in the window', () => {
    expect(CUTS_SQL).toMatch(/a\.action = 'cut'/);
    expect(CUTS_SQL).toMatch(/LIKE 'user\\_%'/);
    expect(CUTS_SQL).toMatch(/make_interval\(days => \$1::int\)/);
    expect(CUTS_SQL.trim()).toMatch(/^SELECT/);
  });

  test('diagnoseItem end to end for a pattern: snapshot, research owner, pattern details recorded', async () => {
    const createMessage = jest.fn(async () => ({ usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: 'tool_use', name: 'record_diagnosis', input: { owner: 'research', verdict: 'card_missing_restriction', narrative: NARRATIVE } }] }));
    const r = await diagnoseItem(pattern, { env: { ANTHROPIC_API_KEY: 'k' }, createMessage, logCost: null, opsQuery: async () => ({ rows: [] }),
      patternSnapshot: async () => ({ ok: true, body: { category: 'wrong_industry', companies: 4, internal_companies: 1, grant: { name: 'G', card: [] }, cuts: [] } }) });
    expect(r).toMatchObject({ ok: true, owner: 'research', verdict: 'card_missing_restriction', snapshotTaken: true,
      snapshot: { source: 'ai_review_pattern', companies: 4 },
      diagnosis: { rule: 'pattern_tag', pattern: { category: 'wrong_industry', companies: 4, internal_companies: 1 } } });
    const prompt = createMessage.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/grant pattern/);
    expect(prompt).toMatch(/No comment on the flag/);
  });
});

describe('chat diagnosis fields', () => {
  test('the chat rule requires every field; they are returned as chat', () => {
    const route = routeFor(chat, {});
    expect(applyRoute({ owner: 'chris', verdict: 'chat_answer_problem', narrative: NARRATIVE }, route))
      .toEqual({ ok: false, code: 'bad_model_output:client_asked' });
    expect(applyRoute({ owner: 'chris', verdict: 'chat_answer_problem', narrative: NARRATIVE, ...CHAT_ANSWER, good_answer: ' ' }, route))
      .toEqual({ ok: false, code: 'bad_model_output:good_answer' });
    const ok = applyRoute({ owner: 'chris', verdict: 'chat_wrong_grant_facts', narrative: NARRATIVE, ...CHAT_ANSWER }, route);
    expect(ok).toMatchObject({ ok: true, owner: 'research', chat: CHAT_ANSWER });
    expect(Object.keys(ok.chat)).toEqual([...CHAT_FIELDS]);
  });

  test('match items ignore the chat fields', () => {
    expect(applyRoute({ owner: 'chris', verdict: 'ranked_on_genre', narrative: NARRATIVE }, routeFor(match, snap('RANKED_ON_GENRE'))))
      .toMatchObject({ ok: true, chat: null });
  });

  test('the tool lists the chat fields', () => {
    for (const f of CHAT_FIELDS) expect(DIAGNOSIS_TOOL.input_schema.properties[f]).toBeDefined();
  });

  test('diagnosis.chat is stored; a stored (Oracle) snapshot is used as is', async () => {
    const createMessage = jest.fn(async () => ({ usage: null,
      content: [{ type: 'tool_use', name: 'record_diagnosis', input: { owner: 'chris', verdict: 'chat_answer_problem', narrative: NARRATIVE, ...CHAT_ANSWER } }] }));
    const stored = { source: 'oracle_detected', flagged_turn_index: 1, issue: 'pushback',
      turns: [{ turn_index: 1, client: 'x'.repeat(5000), assistant: 'y', flagged: true }] };
    const r = await diagnoseItem({ ...chat, chat_turn_ref: 'conv:7:pushback', snapshot: stored, snapshot_at: 't' },
      { env: { ANTHROPIC_API_KEY: 'k' }, createMessage, logCost: null, opsQuery: async () => { throw new Error('no read'); } });
    expect(r).toMatchObject({ ok: true, snapshotTaken: false, diagnosis: { chat: CHAT_ANSWER } });
    const prompt = createMessage.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/issue_found_by_review/);
    expect(prompt).not.toMatch(/x{4100}/); // clipped for the model; the stored snapshot keeps it all
  });
});

describe('conversation-level chat snapshots', () => {
  const messages = [
    { role: 'user', content: 'q0' }, { role: 'assistant', content: 'a0' },
    { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'q3' }, { role: 'assistant', content: 'a3' },
    { role: 'user', content: `q4 ${'z'.repeat(5000)}` }, { role: 'assistant', content: 'a4' }
  ];

  test('chatTurnsAround: the flagged turn and up to 3 before it, verbatim (no clipping)', () => {
    const r = chatTurnsAround(messages, 4);
    expect(r.body.turns.map((t) => t.turn_index)).toEqual([1, 2, 3, 4]);
    expect(r.body.turns.at(-1)).toMatchObject({ flagged: true, assistant: 'a4' });
    expect(r.body.turns.at(-1).client).toHaveLength(5003);
    expect(chatTurnsAround(messages, 1).body.turns.map((t) => t.turn_index)).toEqual([0, 1]);
    expect(chatTurnsAround(messages).body.flagged_turn_index).toBe(4);
    expect(chatTurnsAround(messages, 9)).toEqual({ ok: false, code: 'chat_turn_not_in_conversation' });
  });

  test('a conv:<id>:<issue> ref reads the conversation, last client turn flagged', async () => {
    expect(parseConversationRef('conv:42:pushback')).toEqual({ conversationId: 42, issue: 'pushback' });
    expect(parseConversationRef('turn-abc')).toBeNull();
    const opsQuery = jest.fn(async (sql) => (sql === CONVERSATION_MESSAGES_SQL ? { rows: [{ messages }] } : { rows: [] }));
    const r = await readChatSnapshot('conv:42:pushback', { opsQuery });
    expect(r).toMatchObject({ ok: true, body: { conversation_id: 42, issue: 'pushback', flagged_turn_index: 4 } });
    expect(opsQuery).toHaveBeenCalledWith(CONVERSATION_MESSAGES_SQL, [42]);
    expect(opsQuery).not.toHaveBeenCalledWith(CHAT_TURN_SQL, expect.anything());
  });
});

describe('code-only cards (migration 057): consulting questions and deadline cards', () => {
  const stored = {
    source: 'oracle_detected', conversation_id: 290, issue: 'consulting_question',
    rule_evidence: { rule: 'consulting_question', unmet_need: 'Consulting or application writing', answer: 'partly', unanswered_reason: 'left_after_bad_reply',
      question: 'Can the consulting team manage the application end to end?' },
    flagged_turn_index: 3,
    turns: [
      { turn_index: 2, client: 'Hi', assistant: 'Hello', tools_used: [], flagged: false },
      { turn_index: 3, client: 'What does it entail to have your consulting team manage the application end to end?',
        assistant: 'GetGranted helps you find grants.', tools_used: [], flagged: true }
    ]
  };
  const consulting = { id: 9, kind: 'chat', chat_turn_ref: 'conv:290:consulting_question', conversation_id: 290, company_id: 135, snapshot: stored, snapshot_at: 't' };
  const deadline = { id: 10, kind: 'grant_deadline', grant_root_id: 1822, snapshot_at: 't',
    snapshot: { source: 'catalogue_check', checked_on: '2026-10-22', grant: { id: 1822, title: 'Old Fund', deadline_text: '15/04/2021', deadline: '2021-04-15', days_over: 2016, status: 'active' } } };

  test('a consulting card is known by its ref, not its snapshot', () => {
    expect(isConsultingItem(consulting)).toBe(true);
    expect(isConsultingItem({ ...consulting, snapshot: null })).toBe(true);
    expect(isConsultingItem({ ...consulting, chat_turn_ref: 'conv:290:pushback' })).toBe(false);
    expect(isConsultingItem({ kind: 'match' })).toBe(false);
  });

  test('routeFor: consulting → consulting only, forced verdict; grant_deadline → research only; both code-only', () => {
    expect(routeFor(consulting, null)).toMatchObject({ rule: 'consulting_question', allowed: ['consulting'], forcedVerdict: 'consulting_question', codeOnly: true });
    expect(routeFor(deadline, null)).toMatchObject({ rule: 'deadline_passed', allowed: ['research'], forcedVerdict: 'deadline_passed', codeOnly: true });
    expect(VERDICTS).toEqual(expect.arrayContaining(['consulting_question', 'deadline_passed']));
    expect(DIAGNOSIS_TOOL.input_schema.properties.owner.enum).toContain('consulting');
  });

  test('flaggedTurn: the flagged turn, else by index, else the last; null without turns', () => {
    expect(flaggedTurn(stored).turn_index).toBe(3);
    expect(flaggedTurn({ flagged_turn_index: 2, turns: stored.turns.map((t) => ({ ...t, flagged: false })) }).turn_index).toBe(2);
    expect(flaggedTurn({ turns: stored.turns.map((t) => ({ ...t, flagged: false })) }).turn_index).toBe(3);
    expect(flaggedTurn({ turns: [] })).toBeNull();
    expect(flaggedTurn(null)).toBeNull();
  });

  test('diagnoseItem on a consulting card: no model, no API key, cost 0, owner consulting, the flagged turn as the chat fields', async () => {
    const createMessage = jest.fn();
    const r = await diagnoseItem(consulting, { env: {}, createMessage, opsQuery: async () => { throw new Error('must not read'); } });
    expect(createMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, owner: 'consulting', verdict: 'consulting_question', cost: 0, snapshotTaken: false, client_notice: null,
      diagnosis: { verdict: 'consulting_question', rule: 'consulting_question', model: null,
        chat: { client_asked: expect.stringContaining('consulting team'), assistant_replied: 'GetGranted helps you find grants.',
          unmet_need: 'Consulting or application writing', answer: 'partly', unanswered_reason: 'left_after_bad_reply' } } });
    expect(r.narrative).toBe(consultingNarrative(stored.rule_evidence));
    expect(r.narrative).toMatch(/only partly answered it \(the client left after a weak reply\)/);
  });

  test('a consulting card with no snapshot and no ops DB is left alone (null), as any card', async () => {
    expect(await diagnoseItem({ ...consulting, snapshot: null }, { env: {}, opsQuery: null })).toBeNull();
  });

  test('a deadline card: research, deadline_passed, the narrative from the filed evidence; no evidence is a plain failure', () => {
    const r = diagnoseDeadline(deadline);
    expect(r).toMatchObject({ ok: true, owner: 'research', verdict: 'deadline_passed', cost: 0, snapshotTaken: false,
      diagnosis: { rule: 'deadline_passed', model: null, evidence: { deadline: '2021-04-15', days_over: 2016, checked_on: '2026-10-22' } } });
    expect(r.narrative).toMatch(/"15\/04\/2021" \(2021-04-15\), 2016 days ago, but the grant is still active/);
    expect(diagnoseDeadline({ ...deadline, snapshot: null })).toMatchObject({ ok: false, error: 'deadline_no_evidence' });
    expect(plainError('deadline_no_evidence')).toMatch(/without its evidence/);
  });

  test('diagnoseItem on a deadline card needs no API key either', async () => {
    const r = await diagnoseItem(deadline, { env: {}, opsQuery: null });
    expect(r).toMatchObject({ ok: true, owner: 'research', verdict: 'deadline_passed' });
  });
});
