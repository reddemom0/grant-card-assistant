/**
 * control-centre review queue: flag dedupe, source_ref idempotency, reopen on
 * re-flag, close rules, stub diagnosis, status moves, sweep, scheduler gate.
 * Fixtures only — an in-memory Hub that answers the exported SQL constants and
 * enforces the same unique keys as migration 044.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-review-queue.test.js
 */

import { jest } from '@jest/globals';
import {
  OWNER_ROUTING, OWNERS, DEFAULT_OWNER, ReviewQueueError,
  validateFlag, parseId, addFlag, moveStatus, setOwner, close, diagnose, runDiagnosis,
  listItems, getItem, runReviewSweep, startControlCentreReviewSweep,
  INSERT_ITEM_SQL, LOCK_MATCH_SQL, LOCK_CHAT_SQL, LOCK_ITEM_SQL, INSERT_FLAG_SQL, BUMP_SQL,
  REOPEN_SQL, DIAGNOSE_SQL, RECORD_FAILURE_SQL, SET_STATUS_SQL, SET_OWNER_SQL, CLOSE_SQL, INSERT_EVENT_SQL,
  GET_ITEM_SQL, GET_FLAGS_SQL, GET_EVENTS_SQL, NEW_ITEM_IDS_SQL, NEW_ITEMS_SQL, LIST_SQL,
  SWEEP_CURSOR_SQL, KNOWN_REFS_SQL, EXISTING_MATCH_ITEMS_SQL, DOWNS_SQL, SWEEP_OVERLAP_MS,
  previewDiagnoses
} from '../../src/control-centre/review-queue.js';

/** In-memory Hub: partial unique keys on items, UNIQUE source_ref on flags. */
function fakeHub() {
  const items = [];
  const flags = [];
  const events = [];
  let ids = { item: 0, flag: 0, event: 0 };
  const copy = (r) => (r ? { ...r } : r);
  const one = (r) => ({ rows: r ? [copy(r)] : [] });
  const byId = (id) => items.find((i) => i.id === id);
  const update = (id, patch) => { const it = byId(id); Object.assign(it, patch); return one(it); };

  async function q(sql, p = []) {
    switch (sql) {
      case INSERT_ITEM_SQL: {
        const [kind, company_id, grant_root_id, chat_turn_ref] = p;
        const clash = items.find((i) => (kind === 'match'
          ? i.kind === 'match' && i.company_id === company_id && i.grant_root_id === grant_root_id
          : i.kind === 'chat' && i.chat_turn_ref === chat_turn_ref));
        if (clash) return { rows: [] };
        const it = { id: ++ids.item, kind, company_id, grant_root_id, chat_turn_ref, status: 'new', owner: null,
          diagnosis: null, narrative: null, client_notice: null, flagged_again: false, flag_count: 0,
          expected_match: null, close_note: null, closed_by: null, closed_at: null,
          snapshot: null, snapshot_at: null, diagnosis_attempts: 0, last_error: null };
        items.push(it);
        return { rows: [{ id: it.id }] };
      }
      case LOCK_MATCH_SQL:
        return one(items.find((i) => i.kind === 'match' && i.company_id === p[0] && i.grant_root_id === p[1]));
      case LOCK_CHAT_SQL:
        return one(items.find((i) => i.kind === 'chat' && i.chat_turn_ref === p[0]));
      case LOCK_ITEM_SQL:
      case GET_ITEM_SQL:
        return one(byId(p[0]));
      case INSERT_FLAG_SQL: {
        const [item_id, source, source_ref, source_created_at, actor, comment] = p;
        if (flags.some((f) => f.source_ref === source_ref)) return { rows: [] };
        const f = { id: ++ids.flag, item_id, source, source_ref, source_created_at, actor, comment };
        flags.push(f);
        return { rows: [{ id: f.id }] };
      }
      case BUMP_SQL: return update(p[0], { flag_count: byId(p[0]).flag_count + 1 });
      case REOPEN_SQL:
        return update(p[0], { flag_count: byId(p[0]).flag_count + 1, status: 'new', flagged_again: true,
          owner: null, diagnosis: null, narrative: null, client_notice: null,
          expected_match: null, close_note: null, closed_by: null, closed_at: null,
          snapshot: null, snapshot_at: null, diagnosis_attempts: 0, last_error: null });
      case DIAGNOSE_SQL: {
        const it = byId(p[0]);
        return update(p[0], { owner: p[1], diagnosis: p[2], narrative: p[3], client_notice: p[4],
          snapshot: p[5] == null ? it.snapshot : JSON.parse(p[5]), snapshot_at: p[5] == null ? it.snapshot_at : p[6],
          diagnosis_attempts: p[7], last_error: p[8], status: 'diagnosed' });
      }
      case RECORD_FAILURE_SQL: {
        const it = byId(p[0]);
        return update(p[0], { diagnosis_attempts: p[1], last_error: p[2],
          snapshot: p[3] == null ? it.snapshot : JSON.parse(p[3]), snapshot_at: p[3] == null ? it.snapshot_at : p[4] });
      }
      case NEW_ITEMS_SQL: return { rows: items.filter((i) => i.status === 'new').map(copy) };
      case SET_STATUS_SQL: return update(p[0], { status: p[1], closed_by: null, closed_at: null });
      case SET_OWNER_SQL: return update(p[0], { owner: p[1] });
      case CLOSE_SQL:
        return update(p[0], { status: 'closed', expected_match: p[1], close_note: p[2], closed_by: p[3], closed_at: 'now' });
      case INSERT_EVENT_SQL: {
        const [item_id, actor, action, from_status, to_status, detail] = p;
        events.push({ id: ++ids.event, item_id, actor, action, from_status, to_status, detail });
        return { rows: [] };
      }
      case GET_FLAGS_SQL: return { rows: flags.filter((f) => f.item_id === p[0]).map(copy) };
      case GET_EVENTS_SQL: return { rows: events.filter((e) => e.item_id === p[0]).map(copy) };
      case NEW_ITEM_IDS_SQL: return { rows: items.filter((i) => i.status === 'new').map((i) => ({ id: i.id })) };
      case SWEEP_CURSOR_SQL: {
        const ts = flags.filter((f) => f.source === 'client_thumbs_down' && f.source_created_at)
          .map((f) => new Date(f.source_created_at).getTime());
        return { rows: [{ latest: ts.length ? new Date(Math.max(...ts)) : null }] };
      }
      case KNOWN_REFS_SQL: return { rows: flags.filter((f) => p[0].includes(f.source_ref)).map((f) => ({ source_ref: f.source_ref })) };
      case EXISTING_MATCH_ITEMS_SQL:
        return { rows: items.filter((i) => i.kind === 'match'
          && p[0].some((c, k) => c === i.company_id && p[1][k] === i.grant_root_id)).map(copy) };
      default:
        throw new Error(`fake hub: unexpected SQL ${sql.slice(0, 60)}`);
    }
  }

  const deps = { hubQuery: q, hubTransaction: (cb) => cb({ query: q }) };
  return { items, flags, events, q, deps };
}

const matchFlag = (over = {}) => ({
  kind: 'match', company_id: 81, grant_root_id: 1196, source: 'client_thumbs_down',
  source_ref: 'rating-1', actor: 'user_abc', ...over
});

let logSpy, warnSpy, errorSpy;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); });

async function expectStatus(promise, status) {
  await expect(promise).rejects.toBeInstanceOf(ReviewQueueError);
  await promise.catch((e) => expect(e.status).toBe(status));
}

describe('OWNER_ROUTING', () => {
  test('covers every owner and defaults to chris', () => {
    expect(Object.keys(OWNER_ROUTING).sort()).toEqual([...OWNERS].sort());
    expect(DEFAULT_OWNER).toBe('chris');
    expect(OWNER_ROUTING.chris).toMatch(/chat answers/);
    expect(Object.isFrozen(OWNER_ROUTING)).toBe(true);
  });
});

describe('validateFlag', () => {
  test('match needs company_id and grant_root_id, no chat_turn_ref', () => {
    expect(() => validateFlag(matchFlag({ company_id: undefined }))).toThrow(/company_id/);
    expect(() => validateFlag(matchFlag({ grant_root_id: -1 }))).toThrow(/grant_root_id/);
    expect(() => validateFlag(matchFlag({ chat_turn_ref: 't1' }))).toThrow(/chat_turn_ref/);
  });

  test('chat needs chat_turn_ref, no grant_root_id; company_id optional', () => {
    const base = { kind: 'chat', source: 'staff_flag', actor: 'a@granted.ca' };
    expect(() => validateFlag(base)).toThrow(/chat_turn_ref/);
    expect(() => validateFlag({ ...base, chat_turn_ref: 't1', grant_root_id: 3 })).toThrow(/grant_root_id/);
    expect(validateFlag({ ...base, chat_turn_ref: 't1' }).company_id).toBeNull();
  });

  test('bad kind or source is a 400', () => {
    expect(() => validateFlag(matchFlag({ kind: 'grant' }))).toThrow(ReviewQueueError);
    expect(() => validateFlag(matchFlag({ source: 'email' }))).toThrow(/source/);
  });

  test('client flags need a source_ref; staff flags get staff:<uuid>', () => {
    expect(() => validateFlag(matchFlag({ source_ref: undefined }))).toThrow(/source_ref/);
    const f = validateFlag(matchFlag({ source: 'staff_flag', source_ref: undefined }));
    expect(f.source_ref).toMatch(/^staff:[0-9a-f-]{36}$/);
  });

  test('string ids from JSON are accepted', () => {
    expect(validateFlag(matchFlag({ company_id: '81' })).company_id).toBe(81);
    expect(parseId('1.5')).toBeNull();
    expect(parseId('0')).toBeNull();
  });
});

describe('addFlag', () => {
  test('the same pair twice is one item with flag_count 2', async () => {
    const hub = fakeHub();
    const a = await addFlag(matchFlag(), hub.deps);
    const b = await addFlag(matchFlag({ source_ref: 'rating-2' }), hub.deps);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0].flag_count).toBe(2);
    expect(hub.flags).toHaveLength(2);
    expect(hub.events.map((e) => e.action)).toEqual(['created', 'flagged', 'flagged']);
  });

  test('a different grant for the same company is its own item', async () => {
    const hub = fakeHub();
    await addFlag(matchFlag(), hub.deps);
    await addFlag(matchFlag({ grant_root_id: 1516, source_ref: 'rating-2' }), hub.deps);
    expect(hub.items).toHaveLength(2);
  });

  test('a duplicate source_ref is ignored', async () => {
    const hub = fakeHub();
    await addFlag(matchFlag(), hub.deps);
    const eventsBefore = hub.events.length;
    const dup = await addFlag(matchFlag(), hub.deps);
    expect(dup.duplicate).toBe(true);
    expect(hub.items[0].flag_count).toBe(1);
    expect(hub.flags).toHaveLength(1);
    expect(hub.events).toHaveLength(eventsBefore);
  });

  test('a duplicate source_ref does not reopen a closed item', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await close(item.id, { expected_match: 'shouldnt' }, 'a@granted.ca', hub.deps);
    const dup = await addFlag(matchFlag(), hub.deps);
    expect(dup.duplicate).toBe(true);
    expect(hub.items[0].status).toBe('closed');
    expect(hub.items[0].flagged_again).toBe(false);
  });

  test('re-flagging a closed item reopens it with flagged_again and clears owner/diagnosis', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await runDiagnosis(item.id, { ...hub.deps,
      diagnoseFn: async () => ({ owner: 'research', diagnosis: { cause: 'card' }, narrative: 'n', client_notice: 'c' }) });
    await close(item.id, { expected_match: 'shouldnt', close_note: 'fixed card' }, 'a@granted.ca', hub.deps);

    const r = await addFlag(matchFlag({ source_ref: 'rating-2' }), hub.deps);
    expect(r.reopened).toBe(true);
    expect(r.item).toMatchObject({ status: 'new', flagged_again: true, owner: null, diagnosis: null,
      narrative: null, client_notice: null, closed_at: null, flag_count: 2 });
    const reopened = hub.events.find((e) => e.action === 'reopened');
    expect(reopened).toMatchObject({ from_status: 'closed', to_status: 'new' });
  });

  test('chat items key on chat_turn_ref', async () => {
    const hub = fakeHub();
    const f = { kind: 'chat', chat_turn_ref: 'turn-9', source: 'staff_flag', actor: 'a@granted.ca' };
    await addFlag(f, hub.deps);
    await addFlag(f, hub.deps); // a staff flag gets a fresh source_ref each time
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0].flag_count).toBe(2);
  });
});

describe('close', () => {
  test('a match item needs expected_match', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await expectStatus(close(item.id, {}, 'a@granted.ca', hub.deps), 400);
    await expectStatus(close(item.id, { expected_match: 'maybe' }, 'a@granted.ca', hub.deps), 400);
    expect(hub.items[0].status).toBe('new');
    const closed = await close(item.id, { expected_match: 'should' }, 'a@granted.ca', hub.deps);
    expect(closed).toMatchObject({ status: 'closed', expected_match: 'should', closed_by: 'a@granted.ca' });
    expect(hub.events.at(-1)).toMatchObject({ action: 'closed', from_status: 'new', to_status: 'closed' });
  });

  test('a chat item closes without expected_match', async () => {
    const hub = fakeHub();
    const { item } = await addFlag({ kind: 'chat', chat_turn_ref: 't1', source: 'staff_flag', actor: 'a@granted.ca' }, hub.deps);
    const closed = await close(item.id, { close_note: 'fine' }, 'a@granted.ca', hub.deps);
    expect(closed).toMatchObject({ status: 'closed', expected_match: null, close_note: 'fine' });
  });

  test('closing twice is a 409; an unknown id is a 404', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await close(item.id, { expected_match: 'should' }, 'a', hub.deps);
    await expectStatus(close(item.id, { expected_match: 'should' }, 'a', hub.deps), 409);
    await expectStatus(close(999, { expected_match: 'should' }, 'a', hub.deps), 404);
  });
});

// Step 5 diagnosis, driven through the real diagnose() with injected edges.
const NARRATIVE = 'This grant was shown because its topic matched the client goals. Nothing in its eligibility excludes them.';
const toolReply = (input) => ({
  usage: { input_tokens: 2000, output_tokens: 150 },
  content: [{ type: 'tool_use', name: 'record_diagnosis', input }]
});
const explainBody = (cause) => ({
  grant_name: 'Grant G', candidate_cause: { cause, rule: 'r', evidence: ['why'] }, axes: [],
  card: { eligibility_sections: 'Open to all employers.' }
});
function diagCtx({ body = explainBody('RANKED_ON_GENRE'), fail = null, reply } = {}) {
  return {
    env: { ANTHROPIC_API_KEY: 'k', GG3_AI_SERVICE_URL: 'http://svc', GG3_REVIEW_FEED_TOKEN: 't' },
    fetchBadMatch: jest.fn(async () => (fail ? { ok: false, code: fail } : { ok: true, body })),
    createMessage: jest.fn(async () => reply ?? toolReply({ owner: 'chris', verdict: 'ranked_on_genre', narrative: NARRATIVE })),
    logCost: jest.fn(async () => {}),
    opsQuery: null
  };
}

describe('diagnosis', () => {
  test('nothing configured → null; the item stays new and no attempt is counted', async () => {
    expect(await diagnose({ id: 1, kind: 'match', company_id: 1, grant_root_id: 2 }, { env: {}, opsQuery: null })).toBeNull();
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const r = await runDiagnosis(item.id, { ...hub.deps, diagnoseFn: async () => null });
    expect(r.diagnosed).toBe(false);
    expect(hub.items[0]).toMatchObject({ status: 'new', diagnosis_attempts: 0, last_error: null });
    expect(hub.events.some((e) => e.action === 'diagnosed' || e.action === 'diagnosis_failed')).toBe(false);
  });

  test('success stores the snapshot, owner, verdict and narrative, and logs the cost', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const ctx = diagCtx();
    const r = await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: ctx });
    expect(r.diagnosed).toBe(true);
    expect(r.item).toMatchObject({ status: 'diagnosed', owner: 'chris', narrative: NARRATIVE, client_notice: null,
      diagnosis_attempts: 0, last_error: null });
    expect(JSON.parse(r.item.diagnosis)).toMatchObject({ verdict: 'ranked_on_genre', candidate_cause: 'RANKED_ON_GENRE', rule: 'ranked_on_genre' });
    expect(r.item.snapshot).toMatchObject({ source: 'match_explain', response: { grant_name: 'Grant G' } });
    expect(r.item.snapshot_at).toBeTruthy();
    expect(ctx.fetchBadMatch).toHaveBeenCalledWith({ grantId: 1196, companyId: 81 }, expect.anything());
    expect(ctx.logCost).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5-5', source: 'cc-review-diagnosis' }));
    expect(hub.events.at(-1)).toMatchObject({ action: 'diagnosed', detail: JSON.stringify({ owner: 'chris', verdict: 'ranked_on_genre' }) });
  });

  test('a failure stays new, counts the attempt, keeps the snapshot; the retry reuses it', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const bad = diagCtx({ reply: toolReply({ owner: 'chris', verdict: 'ranked_on_genre', narrative: 'too short' }) });
    const r1 = await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: bad });
    expect(r1).toMatchObject({ diagnosed: false, failed: true, error: 'bad_model_output:narrative_length' });
    expect(hub.items[0]).toMatchObject({ status: 'new', diagnosis_attempts: 1, last_error: 'bad_model_output:narrative_length' });
    expect(hub.items[0].snapshot).toMatchObject({ source: 'match_explain' });
    expect(hub.events.at(-1)).toMatchObject({ action: 'diagnosis_failed', from_status: 'new', to_status: 'new' });

    const good = diagCtx();
    const r2 = await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: good });
    expect(r2.diagnosed).toBe(true);
    expect(good.fetchBadMatch).not.toHaveBeenCalled(); // stored snapshot reused
    expect(r2.item).toMatchObject({ diagnosis_attempts: 1, last_error: null });
  });

  test('the third failure diagnoses as could_not_diagnose for chris, in plain words', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const ctx = diagCtx({ fail: 'explain_422_company_not_resolved' });
    await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: ctx });
    await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: ctx });
    expect(hub.items[0]).toMatchObject({ status: 'new', diagnosis_attempts: 2 });
    const r3 = await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: ctx });
    expect(r3).toMatchObject({ diagnosed: true, failed: true });
    expect(r3.item).toMatchObject({ status: 'diagnosed', owner: 'chris', diagnosis_attempts: 3,
      last_error: 'explain_422_company_not_resolved' });
    expect(JSON.parse(r3.item.diagnosis)).toMatchObject({ verdict: 'could_not_diagnose', attempts: 3 });
    expect(r3.item.narrative).toMatch(/couldn't find this company's profile/);
    expect(r3.item.narrative).not.toMatch(/explain_|422/);
    expect(ctx.createMessage).not.toHaveBeenCalled();
  });

  test('a reopen clears the snapshot and attempts, so the next diagnosis takes a fresh one', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: diagCtx() });
    await close(item.id, { expected_match: 'should' }, 'a', hub.deps);
    const r = await addFlag(matchFlag({ source_ref: 'rating-2' }), hub.deps);
    expect(r.item).toMatchObject({ status: 'new', snapshot: null, snapshot_at: null, diagnosis_attempts: 0, last_error: null });
    const fresh = diagCtx({ body: explainBody('LOOKS_CORRECT'),
      reply: toolReply({ owner: 'research', verdict: 'unclear', narrative: NARRATIVE }) });
    const again = await runDiagnosis(item.id, { ...hub.deps, diagnoseCtx: fresh });
    expect(fresh.fetchBadMatch).toHaveBeenCalledTimes(1);
    expect(again.item.snapshot.response.candidate_cause.cause).toBe('LOOKS_CORRECT');
    expect(again.item.owner).toBe('chris');
    expect(JSON.parse(again.item.diagnosis)).toMatchObject({ verdict: 'looks_correct', owner_override: expect.any(Object) });
  });

  test('dry-run preview writes nothing and never logs cost, but reports the cost', async () => {
    const hub = fakeHub();
    await addFlag(matchFlag(), hub.deps);
    const seen = [];
    const spy = async (sql, p) => { seen.push(sql); return hub.q(sql, p); };
    const ctx = diagCtx();
    const out = await previewDiagnoses([{ company_id: 83, grant_root_id: 1097 }], { hubQuery: spy, diagnoseCtx: ctx });
    expect(out.rows.map((r) => r.label)).toEqual(['new', 'would file']);
    expect(out.rows[0]).toMatchObject({ owner: 'chris', verdict: 'ranked_on_genre', narrative: NARRATIVE });
    expect(out.cost).toBeGreaterThan(0);
    expect(ctx.logCost).not.toHaveBeenCalled();
    expect(seen.every((sql) => /^\s*SELECT/i.test(sql))).toBe(true);
    expect(hub.items[0]).toMatchObject({ status: 'new', snapshot: null, diagnosis_attempts: 0 });
    expect(hub.events.filter((e) => e.action !== 'created' && e.action !== 'flagged')).toHaveLength(0);
  });

  test('dry-run preview shows a failure as the attempt it would be', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    hub.items[0].diagnosis_attempts = 2;
    const out = await previewDiagnoses([], { hubQuery: hub.q, diagnoseCtx: diagCtx({ fail: 'explain_timeout' }) });
    expect(out.rows[0]).toMatchObject({ id: item.id, error: 'explain_timeout', attempt: 3,
      would: expect.objectContaining({ verdict: 'could_not_diagnose', owner: 'chris' }) });
    expect(hub.items[0]).toMatchObject({ status: 'new', diagnosis_attempts: 2 });
  });

  test('a result sets owner/diagnosis and moves to diagnosed; an unknown owner falls back to chris', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const r = await runDiagnosis(item.id, { ...hub.deps,
      diagnoseFn: async () => ({ owner: 'nobody', diagnosis: { cause: '?' }, narrative: 'n', client_notice: 'c' }) });
    expect(r.diagnosed).toBe(true);
    expect(r.item).toMatchObject({ status: 'diagnosed', owner: 'chris', narrative: 'n', client_notice: 'c' });
    expect(hub.events.at(-1)).toMatchObject({ action: 'diagnosed', from_status: 'new', to_status: 'diagnosed' });
  });

  test('only new items are diagnosed', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await moveStatus(item.id, 'in_progress', 'a', hub.deps);
    const diagnoseFn = jest.fn(async () => ({ owner: 'client' }));
    expect((await runDiagnosis(item.id, { ...hub.deps, diagnoseFn })).diagnosed).toBe(false);
    expect(diagnoseFn).not.toHaveBeenCalled();
  });
});

describe('moveStatus and setOwner', () => {
  test("can't jump to closed; bad status is a 400; unknown id a 404", async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await expectStatus(moveStatus(item.id, 'closed', 'a', hub.deps), 400);
    await expectStatus(moveStatus(item.id, 'done', 'a', hub.deps), 400);
    await expectStatus(moveStatus(999, 'in_progress', 'a', hub.deps), 404);
    await expectStatus(moveStatus('abc', 'in_progress', 'a', hub.deps), 400);
  });

  test('a move logs from/to; a no-op move logs nothing', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const n = hub.events.length;
    await moveStatus(item.id, 'new', 'a', hub.deps);
    expect(hub.events).toHaveLength(n);
    await moveStatus(item.id, 'in_progress', 'a', hub.deps);
    expect(hub.events.at(-1)).toMatchObject({ action: 'status', from_status: 'new', to_status: 'in_progress', actor: 'a' });
  });

  test('owner override validates and logs', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await expectStatus(setOwner(item.id, 'bob', 'a', hub.deps), 400);
    expect((await setOwner(item.id, 'jason', 'a', hub.deps)).owner).toBe('jason');
    expect(hub.events.at(-1)).toMatchObject({ action: 'owner' });
    expect(JSON.parse(hub.events.at(-1).detail)).toEqual({ from: null, to: 'jason' });
    expect((await setOwner(item.id, null, 'a', hub.deps)).owner).toBeNull();
  });
});

describe('reads', () => {
  test('listItems validates filters and passes nulls for unset ones', async () => {
    const hubQuery = jest.fn(async () => ({ rows: [] }));
    await listItems({ status: 'new' }, { hubQuery });
    expect(hubQuery).toHaveBeenCalledWith(LIST_SQL, ['new', null, null, 500]);
    await expectStatus(listItems({ owner: 'bob' }, { hubQuery }), 400);
    await expectStatus(listItems({ kind: 'x' }, { hubQuery }), 400);
  });

  test('LIST_SQL is most recently updated first with the latest comment', () => {
    expect(LIST_SQL).toMatch(/ORDER BY i\.updated_at DESC, i\.id DESC/);
    expect(LIST_SQL).toMatch(/latest_comment/);
  });

  test('getItem returns flags and events, 404 when unknown', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag({ comment: 'wrong province' }), hub.deps);
    const got = await getItem(item.id, hub.deps);
    expect(got.flags).toHaveLength(1);
    expect(got.events.map((e) => e.action)).toEqual(['created', 'flagged']);
    await expectStatus(getItem(42, hub.deps), 404);
  });
});

describe('runReviewSweep', () => {
  const downs = [
    { id: 'r1', company_id: 81, grant_root_id: 1196, created_at: new Date('2026-10-09T16:25:53Z'), clerk_id: 'user_a' },
    { id: 'r2', company_id: 81, grant_root_id: 1196, created_at: new Date('2026-10-09T16:26:02Z'), clerk_id: 'user_a' },
    { id: 'r3', company_id: 83, grant_root_id: 1097, created_at: new Date('2026-09-15T16:57:37Z'), clerk_id: 'user_b' }
  ];

  test('DOWNS_SQL reads 👎 only, real Clerk users only, after the cursor', () => {
    expect(DOWNS_SQL).toMatch(/e\.rating = 'down'/);
    expect(DOWNS_SQL).toMatch(/clerk_id LIKE 'user\\_%'/);
    expect(DOWNS_SQL).toMatch(/e\.created_at > \$1/);
  });

  test('dry run counts and writes nothing', async () => {
    const hub = fakeHub();
    const appQuery = jest.fn(async () => ({ rows: [...downs, downs[0]] })); // a repeated row is counted once
    const s = await runReviewSweep({ deps: { hubQuery: hub.q, appQuery }, log: () => {} });
    expect(appQuery).toHaveBeenCalledWith(DOWNS_SQL, [null]);
    expect(s).toMatchObject({ downs_read: 3, already_filed: 0, to_file: 3, items: 2, new_items: 2, written: false });
    expect(hub.items).toHaveLength(0);
  });

  test('write files each 👎 once, then a re-run files nothing and reads from cursor − overlap', async () => {
    const hub = fakeHub();
    const appQuery = jest.fn(async () => ({ rows: downs }));
    const flag = (input) => addFlag(input, hub.deps);
    const diag = (id) => runDiagnosis(id, { ...hub.deps, diagnoseFn: async () => null }); // not configured
    const deps = { hubQuery: hub.q, appQuery, addFlag: flag, runDiagnosis: diag };

    const first = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(first).toMatchObject({ filed: 3, new_items: 2, diagnosed: 0, left_new: 2, failed: 0 });
    expect(hub.items.find((i) => i.grant_root_id === 1196).flag_count).toBe(2);
    expect(hub.flags.every((f) => f.source === 'client_thumbs_down' && f.actor.startsWith('user_'))).toBe(true);

    const second = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(second).toMatchObject({ already_filed: 3, to_file: 0, filed: 0 });
    const since = appQuery.mock.calls[1][1][0];
    expect(since.getTime()).toBe(new Date('2026-10-09T16:26:02Z').getTime() - SWEEP_OVERLAP_MS);
  });

  test('dry run counts an existing closed item as a reopen', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag({ source_ref: 'old' }), hub.deps);
    await close(item.id, { expected_match: 'should' }, 'a', hub.deps);
    const appQuery = async () => ({ rows: [downs[0]] });
    const s = await runReviewSweep({ deps: { hubQuery: hub.q, appQuery }, log: () => {} });
    expect(s).toMatchObject({ to_file: 1, items: 1, new_items: 0, reopened: 1 });
  });

  test('dry run with preview hands the would-file and would-reopen pairs to the preview', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag({ source_ref: 'old' }), hub.deps); // 81/1196, closed below
    await close(item.id, { expected_match: 'should' }, 'a', hub.deps);
    const previewDiagnoses = jest.fn(async () => ({ rows: [], cost: 0 }));
    const appQuery = async () => ({ rows: downs });
    const s = await runReviewSweep({ preview: true, deps: { hubQuery: hub.q, appQuery, previewDiagnoses }, log: () => {} });
    expect(previewDiagnoses.mock.calls[0][0]).toEqual([
      { company_id: 81, grant_root_id: 1196, reopen: true },
      { company_id: 83, grant_root_id: 1097, reopen: false }
    ]);
    expect(s.preview).toEqual({ rows: [], cost: 0 });
    expect(hub.items[0].status).toBe('closed');
  });
});

describe('startControlCentreReviewSweep', () => {
  const saved = {};
  beforeEach(() => { for (const k of ['CC_REVIEW_SWEEP_ENABLED', 'APP_DB_READONLY_URL']) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  test('off unless exactly "true"', () => {
    const cron = { schedule: jest.fn() };
    process.env.CC_REVIEW_SWEEP_ENABLED = '1';
    expect(startControlCentreReviewSweep(cron)).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  test('needs the app DB', () => {
    const cron = { schedule: jest.fn() };
    process.env.CC_REVIEW_SWEEP_ENABLED = 'true';
    expect(startControlCentreReviewSweep(cron)).toBe(false);
  });

  test('hourly, no overlap, Vancouver time', () => {
    const cron = { schedule: jest.fn() };
    process.env.CC_REVIEW_SWEEP_ENABLED = 'true';
    process.env.APP_DB_READONLY_URL = 'postgres://read_user:x@localhost:5432/app';
    expect(startControlCentreReviewSweep(cron)).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('17 * * * *', expect.any(Function),
      expect.objectContaining({ name: 'cc-review-sweep', noOverlap: true, timezone: 'America/Vancouver' }));
  });
});
