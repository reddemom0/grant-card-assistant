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
  LOCK_PATTERN_SQL, LOCK_EMPTY_TRACK_SQL, SET_SNAPSHOT_SQL, LINKED_ITEMS_SQL, reopensClosed, addComment, COMMENT_MAX, STUCK_DAYS,
  previewDiagnoses,
  LOCK_DEADLINE_SQL, SET_ANSWER_SQL, setAnswer, sendToChris, approveForAi, APPROVED_NOTE, ANSWER_MAX, isConsultingCard, KINDS, SOURCES
} from '../../src/control-centre/review-queue.js';
import { LINK_PATTERNS_SQL, PATTERN_ITEMS_SQL } from '../../src/control-centre/grant-patterns.js';
import { INSERT_KNOWLEDGE_SQL } from '../../src/control-centre/knowledge.js';

/** In-memory Hub: partial unique keys on items, UNIQUE source_ref on flags, unique link pairs. */
function fakeHub() {
  const items = [];
  const flags = [];
  const events = [];
  const links = [];
  const knowledge = [];
  const clock = { closeAt: null };
  let ids = { item: 0, flag: 0, event: 0, link: 0, knowledge: 0 };
  const copy = (r) => (r ? { ...r } : r);
  const one = (r) => ({ rows: r ? [copy(r)] : [] });
  const byId = (id) => items.find((i) => i.id === id);
  const update = (id, patch) => { const it = byId(id); Object.assign(it, patch); return one(it); };

  async function q(sql, p = []) {
    switch (sql) {
      case INSERT_ITEM_SQL: {
        const [kind, company_id, grant_root_id, chat_turn_ref, pattern_category = null, conversation_id = null, goal_track = null] = p;
        const clash = items.find((i) => (kind === 'match'
          ? i.kind === 'match' && i.company_id === company_id && i.grant_root_id === grant_root_id
          : kind === 'grant_pattern'
            ? i.kind === 'grant_pattern' && i.grant_root_id === grant_root_id && i.pattern_category === pattern_category
            : kind === 'empty_track'
              ? i.kind === 'empty_track' && i.company_id === company_id && i.goal_track === goal_track
              : kind === 'grant_deadline'
                ? i.kind === 'grant_deadline' && i.grant_root_id === grant_root_id
                : i.kind === 'chat' && i.chat_turn_ref === chat_turn_ref));
        if (clash) return { rows: [] };
        const it = { id: ++ids.item, kind, company_id, grant_root_id, chat_turn_ref, pattern_category, conversation_id, goal_track,
          status: 'new', owner: null,
          diagnosis: null, narrative: null, client_notice: null, flagged_again: false, flag_count: 0,
          expected_match: null, close_note: null, closed_by: null, closed_at: null,
          snapshot: null, snapshot_at: null, diagnosis_attempts: 0, last_error: null,
          staff_answer: null, staff_answer_by: null, staff_answer_at: null };
        items.push(it);
        return { rows: [{ id: it.id }] };
      }
      case LOCK_MATCH_SQL:
        return one(items.find((i) => i.kind === 'match' && i.company_id === p[0] && i.grant_root_id === p[1]));
      case LOCK_CHAT_SQL:
        return one(items.find((i) => i.kind === 'chat' && i.chat_turn_ref === p[0]));
      case LOCK_EMPTY_TRACK_SQL:
        return one(items.find((i) => i.kind === 'empty_track' && i.company_id === p[0] && i.goal_track === p[1]));
      case LOCK_PATTERN_SQL:
        return one(items.find((i) => i.kind === 'grant_pattern' && i.grant_root_id === p[0] && i.pattern_category === p[1]));
      case LOCK_DEADLINE_SQL:
        return one(items.find((i) => i.kind === 'grant_deadline' && i.grant_root_id === p[0]));
      case SET_ANSWER_SQL:
        return update(p[0], { staff_answer: p[1], staff_answer_by: p[2], staff_answer_at: 'now' });
      case INSERT_KNOWLEDGE_SQL: {
        const [item_id, conversation_id, company_id, question, question_rewritten, ai_reply, answer, approved_by] = p;
        const k = { id: ++ids.knowledge, item_id, conversation_id, company_id, question, question_rewritten, ai_reply, answer, approved_by, status: 'pending' };
        knowledge.push(k);
        return one(k);
      }
      case SET_SNAPSHOT_SQL: {
        const it = byId(p[0]);
        if (it.snapshot) return { rows: [] };
        return update(p[0], { snapshot: JSON.parse(p[1]), snapshot_at: 'now' });
      }
      case PATTERN_ITEMS_SQL:
        return { rows: items.filter((i) => i.kind === 'grant_pattern').map(({ id, grant_root_id, pattern_category, status, closed_at }) =>
          ({ id, grant_root_id, pattern_category, status, closed_at })) };
      case LINK_PATTERNS_SQL: {
        let n = 0;
        for (const pat of items.filter((i) => i.kind === 'grant_pattern')) {
          for (const m of items.filter((i) => i.kind === 'match' && i.grant_root_id === pat.grant_root_id)) {
            if (links.some((l) => l.item_id === pat.id && l.linked_item_id === m.id)) continue;
            links.push({ id: ++ids.link, item_id: pat.id, linked_item_id: m.id, relation: 'same_grant' });
            n += 1;
          }
        }
        return { rows: [], rowCount: n };
      }
      case LINKED_ITEMS_SQL:
        return { rows: links.filter((l) => l.item_id === p[0] || l.linked_item_id === p[0])
          .map((l) => byId(l.item_id === p[0] ? l.linked_item_id : l.item_id))
          .map((i) => ({ id: i.id, kind: i.kind, status: i.status, company_id: i.company_id, grant_root_id: i.grant_root_id,
            pattern_category: i.pattern_category, relation: 'same_grant' })) };
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
          snapshot: null, snapshot_at: null, diagnosis_attempts: 0, last_error: null,
          staff_answer: null, staff_answer_by: null, staff_answer_at: null });
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
        return update(p[0], { status: 'closed', expected_match: p[1], close_note: p[2], closed_by: p[3],
          closed_at: clock.closeAt ?? new Date().toISOString() });
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
  return { items, flags, events, links, knowledge, clock, q, deps };
}

/** A consulting-question chat card as the daily chat review files it (migration 057). */
const consultingFlag = (over = {}) => ({
  kind: 'chat', chat_turn_ref: 'conv:290:consulting_question', conversation_id: 290, company_id: 135,
  source: 'oracle_detected', source_ref: 'oracle:290:consulting_question:t3', actor: 'system:oracle-chat-review',
  comment: 'Consulting question the chat only partly answered.',
  snapshot: {
    source: 'oracle_detected', conversation_id: 290, issue: 'consulting_question',
    rule_evidence: { rule: 'consulting_question', unmet_need: 'Consulting or application writing', answer: 'partly', unanswered_reason: null,
      question: 'Can the consulting team manage the application end to end?' },
    flagged_turn_index: 3,
    turns: [
      { turn_index: 2, client: 'Hi there', assistant: 'Hello! How can I help?', tools_used: [], flagged: false },
      { turn_index: 3, client: 'What does it entail to have your consulting team manage the application end to end?',
        assistant: 'GetGranted helps you find grants; for hands-on help, contact help@granted.ca.', tools_used: [], flagged: true }
    ]
  },
  ...over
});

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

  test('LIST_SQL returns summaries only: verdict, grant name, stuck — never the snapshot or full diagnosis', () => {
    expect(LIST_SQL).not.toMatch(/i\.\*/);
    expect(LIST_SQL).not.toMatch(/\bsnapshot\b/);
    expect(LIST_SQL).not.toMatch(/i\.diagnosis[,\s]/);
    expect(LIST_SQL).toMatch(/i\.diagnosis->>'verdict' AS verdict/);
    expect(LIST_SQL).toMatch(/left\(i\.narrative, 240\) AS narrative/);
    expect(LIST_SQL).toMatch(/LEFT JOIN gg3_grants g ON g\.id = i\.grant_root_id/);
    expect(LIST_SQL.trim()).toMatch(/^SELECT/);
  });

  test('stuck counts comments as activity: the later of updated_at and the newest comment, open cards only', () => {
    expect(STUCK_DAYS).toBe(3);
    expect(LIST_SQL).toMatch(/e\.action = 'comment'/);
    expect(LIST_SQL).toMatch(/GREATEST\(i\.updated_at, cm\.at\) AS last_activity_at/);
    expect(LIST_SQL).toMatch(/\(i\.status <> 'closed' AND GREATEST\(i\.updated_at, cm\.at\) < now\(\) - make_interval\(days => 3\)\) AS stuck/);
    // Ordering is untouched by comments.
    expect(LIST_SQL).not.toMatch(/ORDER BY[^\n]*last_activity/);
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

// The 👎 tests leave the pattern path out; it has its own tests below.
const noPatterns = async () => ({ qualifying: [] });
const noDeadlines = async () => ({ passed: 0, rows: [], filed: 0 });
/** An event's detail, stored as JSON text. */
const det = (e) => (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail);

describe('addComment', () => {
  test('logs one comment event with the author and text; status, owner and updated_at untouched', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    const before = { ...hub.items[0] };
    const c = await addComment(item.id, '  Checked the card — region list is wrong.  ', 'steph@granted.ca', hub.deps);
    expect(c).toEqual({ item_id: item.id, actor: 'steph@granted.ca', text: 'Checked the card — region list is wrong.', status: 'new' });
    expect(hub.events.at(-1)).toMatchObject({ action: 'comment', actor: 'steph@granted.ca', from_status: 'new', to_status: 'new' });
    expect(JSON.parse(hub.events.at(-1).detail)).toEqual({ text: 'Checked the card — region list is wrong.' });
    expect(hub.items[0]).toEqual(before);
  });

  test('a closed card can be commented on and stays closed', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await close(item.id, { expected_match: 'should' }, 'a@granted.ca', hub.deps);
    await addComment(item.id, 'Confirmed with the client.', 'b@granted.ca', hub.deps);
    expect(hub.items[0].status).toBe('closed');
  });

  test('empty, too long, no author or unknown card are refused', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag(), hub.deps);
    await expectStatus(addComment(item.id, '   ', 'a@granted.ca', hub.deps), 400);
    await expectStatus(addComment(item.id, 'x'.repeat(COMMENT_MAX + 1), 'a@granted.ca', hub.deps), 400);
    await expectStatus(addComment(item.id, 'ok', null, hub.deps), 400);
    await expectStatus(addComment(999, 'ok', 'a@granted.ca', hub.deps), 404);
    await expectStatus(addComment('abc', 'ok', 'a@granted.ca', hub.deps), 400);
    expect(hub.events.filter((e) => e.action === 'comment')).toHaveLength(0);
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
    const s = await runReviewSweep({ deps: { hubQuery: hub.q, appQuery, runPatternSweep: noPatterns, runDeadlineSweep: noDeadlines }, log: () => {} });
    expect(appQuery).toHaveBeenCalledWith(DOWNS_SQL, [null]);
    expect(s).toMatchObject({ downs_read: 3, already_filed: 0, to_file: 3, items: 2, new_items: 2, written: false });
    expect(hub.items).toHaveLength(0);
  });

  test('write files each 👎 once, then a re-run files nothing and reads from cursor − overlap', async () => {
    const hub = fakeHub();
    const appQuery = jest.fn(async () => ({ rows: downs }));
    const flag = (input) => addFlag(input, hub.deps);
    const diag = (id) => runDiagnosis(id, { ...hub.deps, diagnoseFn: async () => null }); // not configured
    const deps = { hubQuery: hub.q, appQuery, addFlag: flag, runDiagnosis: diag, runPatternSweep: noPatterns, runDeadlineSweep: noDeadlines };

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
    const s = await runReviewSweep({ deps: { hubQuery: hub.q, appQuery, runPatternSweep: noPatterns, runDeadlineSweep: noDeadlines }, log: () => {} });
    expect(s).toMatchObject({ to_file: 1, items: 1, new_items: 0, reopened: 1 });
  });

  test('dry run with preview hands the would-file and would-reopen pairs to the preview', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(matchFlag({ source_ref: 'old' }), hub.deps); // 81/1196, closed below
    await close(item.id, { expected_match: 'should' }, 'a', hub.deps);
    const previewDiagnoses = jest.fn(async () => ({ rows: [], cost: 0 }));
    const appQuery = async () => ({ rows: downs });
    const s = await runReviewSweep({ preview: true, deps: { hubQuery: hub.q, appQuery, previewDiagnoses, runPatternSweep: noPatterns, runDeadlineSweep: noDeadlines }, log: () => {} });
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

// ---------------------------------------------------------------------------
// Grant-pattern cards (migration 047, grant-patterns.js)
// ---------------------------------------------------------------------------

const patternFlag = (over = {}) => ({
  kind: 'grant_pattern', grant_root_id: 1196, pattern_category: 'wrong_industry', source: 'ai_review_cut',
  source_ref: 'ai_review:1', source_created_at: '2026-10-10T10:00:00Z', actor: 'user_a', comment: 'not their industry', ...over
});

describe('empty_track items', () => {
  const emptyFlag = (over = {}) => ({ kind: 'empty_track', company_id: 135, goal_track: 'Improve Sustainability', source: 'staff_flag',
    actor: 'x@granted.ca', snapshot: { goal: 'Improve Sustainability', considered: 190 }, ...over });

  test('validateFlag: company and goal track required; no grant or chat ref; goal_track only on this kind', () => {
    expect(() => validateFlag(emptyFlag({ goal_track: undefined }))).toThrow(/goal_track/);
    expect(() => validateFlag(emptyFlag({ company_id: undefined }))).toThrow(/company_id/);
    expect(() => validateFlag(emptyFlag({ grant_root_id: 1 }))).toThrow(/grant_root_id/);
    expect(() => validateFlag(matchFlag({ goal_track: 'x' }))).toThrow(/goal_track/);
    expect(validateFlag(emptyFlag())).toMatchObject({ kind: 'empty_track', company_id: 135, goal_track: 'Improve Sustainability' });
  });

  test('one card per (company, goal track); the evidence is stored with the first flag', async () => {
    const hub = fakeHub();
    const a = await addFlag(emptyFlag(), hub.deps);
    await addFlag(emptyFlag({ snapshot: { goal: 'changed' } }), hub.deps);
    await addFlag(emptyFlag({ goal_track: 'Grants for Startups' }), hub.deps);
    expect(hub.items.map((i) => [i.kind, i.company_id, i.goal_track, i.flag_count])).toEqual([
      ['empty_track', 135, 'Improve Sustainability', 2], ['empty_track', 135, 'Grants for Startups', 1]]);
    expect(a.item.snapshot).toEqual({ goal: 'Improve Sustainability', considered: 190 });
    expect(hub.items[0].snapshot).toEqual({ goal: 'Improve Sustainability', considered: 190 });
  });
});

describe('grant_pattern items', () => {
  test('validateFlag: grant root and category required; no company or chat ref', () => {
    expect(() => validateFlag(patternFlag({ pattern_category: undefined }))).toThrow(/pattern_category/);
    expect(() => validateFlag(patternFlag({ grant_root_id: undefined }))).toThrow(/grant_root_id/);
    expect(() => validateFlag(patternFlag({ company_id: 81 }))).toThrow(/company_id/);
    expect(() => validateFlag(patternFlag({ chat_turn_ref: 't' }))).toThrow(/chat_turn_ref/);
    expect(() => validateFlag(matchFlag({ pattern_category: 'x' }))).toThrow(/pattern_category/);
    expect(validateFlag(patternFlag())).toMatchObject({ kind: 'grant_pattern', grant_root_id: 1196, pattern_category: 'wrong_industry', company_id: null });
  });

  test('one card per (grant, category); cuts pile on as flags', async () => {
    const hub = fakeHub();
    await addFlag(patternFlag(), hub.deps);
    await addFlag(patternFlag({ source_ref: 'ai_review:2', actor: 'user_b' }), hub.deps);
    await addFlag(patternFlag({ source_ref: 'ai_review:3', pattern_category: 'wrong_region' }), hub.deps);
    expect(hub.items.map((i) => [i.kind, i.grant_root_id, i.pattern_category, i.flag_count]))
      .toEqual([['grant_pattern', 1196, 'wrong_industry', 2], ['grant_pattern', 1196, 'wrong_region', 1]]);
  });

  test('closed: a cut that happened AFTER the close reopens it', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(patternFlag(), hub.deps);
    hub.clock.closeAt = '2026-10-12T00:00:00.000Z';
    await close(item.id, { close_note: 'card fixed' }, 'a@granted.ca', hub.deps);
    const r = await addFlag(patternFlag({ source_ref: 'ai_review:9', source_created_at: '2026-10-13T09:00:00Z' }), hub.deps);
    expect(r).toMatchObject({ reopened: true, item: { status: 'new', flagged_again: true, closed_at: null } });
    expect(hub.events.at(-1)).toMatchObject({ action: 'reopened', from_status: 'closed', to_status: 'new' });
  });

  test('closed: an OLDER cut arriving late is added as evidence and does not reopen it', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(patternFlag(), hub.deps);
    hub.clock.closeAt = '2026-10-12T00:00:00.000Z';
    await close(item.id, { close_note: 'card fixed' }, 'a@granted.ca', hub.deps);
    // Happened before the close, filed after it.
    const r = await addFlag(patternFlag({ source_ref: 'ai_review:5', source_created_at: '2026-10-11T23:59:00Z' }), hub.deps);
    expect(r).toMatchObject({ reopened: false, late: true, duplicate: false });
    expect(hub.items[0]).toMatchObject({ status: 'closed', flagged_again: false, flag_count: 2,
      closed_at: '2026-10-12T00:00:00.000Z', close_note: 'card fixed' });
    expect(hub.flags.map((f) => f.source_ref)).toEqual(['ai_review:1', 'ai_review:5']);
    expect(hub.events.some((e) => e.action === 'reopened')).toBe(false);
    expect(JSON.parse(hub.events.at(-1).detail)).toMatchObject({ source: 'ai_review_cut', late_evidence: true });
  });

  test('reopensClosed: always for match/chat; for a pattern only after closed_at', () => {
    const closedAt = '2026-10-12T00:00:00Z';
    expect(reopensClosed({ kind: 'match', closed_at: closedAt }, { source_created_at: '2026-01-01' })).toBe(true);
    expect(reopensClosed({ kind: 'chat', closed_at: closedAt }, {})).toBe(true);
    const pat = { kind: 'grant_pattern', closed_at: closedAt };
    expect(reopensClosed(pat, { source_created_at: '2026-10-12T00:00:01Z' })).toBe(true);
    expect(reopensClosed(pat, { source_created_at: closedAt })).toBe(false);
    expect(reopensClosed(pat, { source_created_at: null })).toBe(false);
  });

  test('closing a pattern card logs a recheck on each linked match card and changes nothing else on them', async () => {
    const hub = fakeHub();
    const m1 = (await addFlag(matchFlag(), hub.deps)).item;
    const m2 = (await addFlag(matchFlag({ company_id: 83, source_ref: 'rating-2' }), hub.deps)).item;
    await addFlag(matchFlag({ grant_root_id: 1516, source_ref: 'rating-3' }), hub.deps); // other grant
    const pat = (await addFlag(patternFlag(), hub.deps)).item;
    await hub.q(LINK_PATTERNS_SQL);
    expect(hub.links.map((l) => [l.item_id, l.linked_item_id])).toEqual([[pat.id, m1.id], [pat.id, m2.id]]);
    await hub.q(LINK_PATTERNS_SQL); // idempotent
    expect(hub.links).toHaveLength(2);

    const before = hub.items.filter((i) => i.kind === 'match').map((i) => ({ ...i }));
    const closed = await close(pat.id, { close_note: 'tag fixed' }, 'a@granted.ca', hub.deps);
    expect(closed.status).toBe('closed');
    const rechecks = hub.events.filter((e) => e.action === 'recheck');
    expect(rechecks.map((e) => e.item_id)).toEqual([m1.id, m2.id]);
    expect(JSON.parse(rechecks[0].detail)).toEqual({ pattern_id: pat.id, message: `re-check — pattern #${pat.id} was fixed` });
    expect(rechecks[0]).toMatchObject({ from_status: 'new', to_status: 'new', actor: 'a@granted.ca' });
    expect(hub.items.filter((i) => i.kind === 'match')).toEqual(before);

    const got = await getItem(m1.id, hub.deps);
    expect(got.links).toEqual([expect.objectContaining({ id: pat.id, kind: 'grant_pattern', pattern_category: 'wrong_industry' })]);
  });

  test('a snapshot handed in is stored when the item has none, and never overwrites one', async () => {
    const hub = fakeHub();
    const chat = { kind: 'chat', chat_turn_ref: 'conv:7:pushback', conversation_id: 7, source: 'oracle_detected',
      source_ref: 'oracle:7:pushback:2026-10-14', snapshot: { turns: [1] } };
    const a = await addFlag(chat, hub.deps);
    expect(a.item).toMatchObject({ conversation_id: 7, snapshot: { turns: [1] } });
    await addFlag({ ...chat, source_ref: 'oracle:7:pushback:2026-10-15', snapshot: { turns: [2] } }, hub.deps);
    expect(hub.items[0].snapshot).toEqual({ turns: [1] });
    expect(() => validateFlag({ ...chat, snapshot: 'x' })).toThrow(/snapshot/);
  });
});

describe('runReviewSweep → grant patterns', () => {
  // Grant 1196 wrong_industry: 3 companies (one internal), plus an unlinked user.
  // Grant 991 wrong_industry: 2 companies — under the threshold.
  const cuts = [
    { id: '11', occurred_at: '2026-10-09T10:00:00Z', grant_id: 1196, category: 'wrong_industry', track: 'Hire', reason: 'r1', clerk_id: 'user_a' },
    { id: '12', occurred_at: '2026-10-10T10:00:00Z', grant_id: 1196, category: 'wrong_industry', track: 'Hire', reason: 'r2', clerk_id: 'user_b' },
    { id: '13', occurred_at: '2026-10-11T10:00:00Z', grant_id: 1196, category: 'wrong_industry', track: 'Hire', reason: 'r3', clerk_id: 'user_staff' },
    { id: '14', occurred_at: '2026-10-11T11:00:00Z', grant_id: 1196, category: 'wrong_industry', track: 'Hire', reason: 'r4', clerk_id: 'user_nolink' },
    { id: '15', occurred_at: '2026-10-11T12:00:00Z', grant_id: 1196, category: 'wrong_industry', track: 'Grow', reason: 'r5', clerk_id: 'user_a' },
    { id: '21', occurred_at: '2026-10-11T10:00:00Z', grant_id: 991, category: 'wrong_industry', track: 'Hire', reason: 'x', clerk_id: 'user_a' },
    { id: '22', occurred_at: '2026-10-11T10:00:00Z', grant_id: 991, category: 'wrong_industry', track: 'Hire', reason: 'y', clerk_id: 'user_b' }
  ];
  const identities = async (ids) => new Map(ids.filter((id) => id !== 'user_nolink').map((id) => [id,
    { user_id: 1, company_id: { user_a: 120, user_b: 135, user_staff: 81 }[id], company_ids: [] }]));

  function setup(rows = cuts) {
    const hub = fakeHub();
    const opsQuery = jest.fn(async () => ({ rows }));
    const deps = {
      hubQuery: hub.q, appQuery: async () => ({ rows: [] }),
      addFlag: (input) => addFlag(input, hub.deps),
      runDiagnosis: async () => ({ diagnosed: false }),
      patternDeps: { opsQuery, identities }
    };
    return { hub, opsQuery, deps };
  }

  test('files one card at 3+ distinct companies; every cut in the group is a flag; under 3 files nothing', async () => {
    const { hub, deps } = setup();
    const s = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(s.patterns).toMatchObject({ cuts_read: 7, groups: 2, filed: 5, new_items: 1, failed: 0 });
    const cards = hub.items.filter((i) => i.kind === 'grant_pattern');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ grant_root_id: 1196, pattern_category: 'wrong_industry', flag_count: 5, company_id: null });
    expect(hub.flags.map((f) => f.source_ref)).toEqual(['ai_review:11', 'ai_review:12', 'ai_review:13', 'ai_review:14', 'ai_review:15']);
    expect(hub.flags.every((f) => f.source === 'ai_review_cut')).toBe(true);
    expect(hub.flags[0]).toMatchObject({ actor: 'user_a', comment: 'r1', source_created_at: '2026-10-09T10:00:00Z' });
  });

  test('an unlinked Clerk user is evidence but does not count toward the 3', async () => {
    const two = cuts.filter((c) => c.clerk_id !== 'user_staff');
    const { hub, deps } = setup(two);
    await runReviewSweep({ write: true, deps, log: () => {} });
    expect(hub.items.filter((i) => i.kind === 'grant_pattern')).toHaveLength(0);
  });

  test('a re-run files nothing new; an existing card keeps collecting below the threshold', async () => {
    const { hub, deps } = setup();
    await runReviewSweep({ write: true, deps, log: () => {} });
    const again = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(again.patterns).toMatchObject({ filed: 0, new_items: 0 });
    const later = [{ id: '16', occurred_at: '2026-10-14T10:00:00Z', grant_id: 1196, category: 'wrong_industry', reason: 'r6', clerk_id: 'user_a' }];
    deps.patternDeps.opsQuery = async () => ({ rows: later });
    const third = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(third.patterns).toMatchObject({ filed: 1, new_items: 0 });
    expect(hub.items.find((i) => i.kind === 'grant_pattern').flag_count).toBe(6);
  });

  test('links the pattern card to the match cards for the same grant, existing and later', async () => {
    const { hub, deps } = setup();
    await addFlag(matchFlag(), hub.deps); // 81 / 1196
    const s = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(s.patterns.linked).toBe(1);
    await addFlag(matchFlag({ company_id: 83, source_ref: 'rating-9' }), hub.deps);
    const s2 = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(s2.patterns.linked).toBe(1);
    expect(hub.links).toHaveLength(2);
  });

  test('a late older cut on a closed card stays evidence through the sweep; a newer one reopens it', async () => {
    const { hub, deps } = setup();
    await runReviewSweep({ write: true, deps, log: () => {} });
    const card = hub.items.find((i) => i.kind === 'grant_pattern');
    hub.clock.closeAt = '2026-10-12T00:00:00.000Z';
    await close(card.id, { close_note: 'fixed' }, 'a', hub.deps);

    deps.patternDeps.opsQuery = async () => ({ rows: [...cuts,
      { id: '17', occurred_at: '2026-10-11T20:00:00Z', grant_id: 1196, category: 'wrong_industry', reason: 'late', clerk_id: 'user_b' }] });
    const dry = await runReviewSweep({ deps, log: () => {} });
    expect(dry.patterns.qualifying.find((q) => q.grant_id === 1196).action).toBe('add late evidence (stays closed)');
    const late = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(late.patterns).toMatchObject({ filed: 1, late: 1, reopened: 0 });
    expect(hub.items.find((i) => i.id === card.id).status).toBe('closed');

    deps.patternDeps.opsQuery = async () => ({ rows: [
      { id: '18', occurred_at: '2026-10-13T08:00:00Z', grant_id: 1196, category: 'wrong_industry', reason: 'new', clerk_id: 'user_b' }] });
    const fresh = await runReviewSweep({ write: true, deps, log: () => {} });
    expect(fresh.patterns).toMatchObject({ filed: 1, reopened: 1 });
    expect(hub.items.find((i) => i.id === card.id)).toMatchObject({ status: 'new', flagged_again: true });
  });

  test('dry run writes nothing and reports the action per group', async () => {
    const { hub, deps } = setup();
    const s = await runReviewSweep({ deps, log: () => {} });
    expect(s.patterns.qualifying.map((q) => [q.grant_id, q.category, q.companies.length, q.action]))
      .toEqual([[1196, 'wrong_industry', 3, 'file']]);
    expect(hub.items).toHaveLength(0);
    expect(hub.flags).toHaveLength(0);
  });

  test('before migration 047: the dry run still lists what it would file; a write fails', async () => {
    const { hub, deps } = setup();
    const missing = async (sql, p) => {
      if (sql === PATTERN_ITEMS_SQL) throw Object.assign(new Error('column "pattern_category" does not exist'), { code: '42703' });
      return hub.q(sql, p);
    };
    const dry = await runReviewSweep({ deps: { ...deps, hubQuery: missing }, log: () => {} });
    expect(dry.patterns).toMatchObject({ note: expect.stringMatching(/047 not applied/) });
    expect(dry.patterns.qualifying.map((q) => q.action)).toEqual(['file']);
    const wet = await runReviewSweep({ write: true, deps: { ...deps, hubQuery: missing }, log: () => {} });
    expect(wet.patterns).toEqual({ error: '42703' });
    expect(hub.items).toHaveLength(0);
  });

  test('a pattern failure never stops the 👎 path', async () => {
    const hub = fakeHub();
    const s = await runReviewSweep({ deps: { hubQuery: hub.q, appQuery: async () => ({ rows: [] }),
      runPatternSweep: async () => { throw Object.assign(new Error('x'), { code: 'not_configured' }); } }, log: () => {} });
    expect(s).toMatchObject({ downs_read: 0, patterns: { error: 'not_configured' } });
  });
});

describe('grant_deadline items (migration 057)', () => {
  const deadlineFlag = (over = {}) => ({
    kind: 'grant_deadline', grant_root_id: 1822, source: 'catalogue_check', source_ref: 'deadline:1822:2021-04-15',
    actor: 'system:deadline-check', comment: 'Deadline "15/04/2021" (2021-04-15) is 2016 days past; the grant is still active',
    snapshot: { source: 'catalogue_check', checked_on: '2026-10-22', grant: { id: 1822, title: 'Old Fund', deadline_text: '15/04/2021', deadline: '2021-04-15', days_over: 2016, status: 'active' } },
    ...over
  });

  test('the kind and the flag source are registered; a deadline flag needs a grant and nothing else', () => {
    expect(KINDS).toContain('grant_deadline');
    expect(SOURCES).toContain('catalogue_check');
    expect(validateFlag(deadlineFlag())).toMatchObject({ kind: 'grant_deadline', grant_root_id: 1822, company_id: null, chat_turn_ref: null });
    expect(() => validateFlag(deadlineFlag({ grant_root_id: undefined }))).toThrow(/grant_root_id/);
    expect(() => validateFlag(deadlineFlag({ company_id: 5 }))).toThrow(/company_id/);
    expect(() => validateFlag(deadlineFlag({ chat_turn_ref: 'x' }))).toThrow(/chat_turn_ref/);
  });

  test('one card per grant: the same date is a duplicate, a new past date is a second flag on the same card', async () => {
    const hub = fakeHub();
    const a = await addFlag(deadlineFlag(), hub.deps);
    expect(a.created).toBe(true);
    expect(hub.items[0]).toMatchObject({ kind: 'grant_deadline', grant_root_id: 1822, company_id: null, snapshot: { grant: { id: 1822 } } });
    expect((await addFlag(deadlineFlag(), hub.deps)).duplicate).toBe(true);
    const b = await addFlag(deadlineFlag({ source_ref: 'deadline:1822:2026-09-30' }), hub.deps);
    expect(b.created).toBe(false);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0].flag_count).toBe(2);
  });

  test('a closed deadline card reopens on a flag with a newer date, and takes that flag\'s evidence', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(deadlineFlag(), hub.deps);
    await close(item.id, { close_note: 'closed the grant' }, 'a@granted.ca', hub.deps);
    const r = await addFlag(deadlineFlag({ source_ref: 'deadline:1822:2026-09-30',
      snapshot: { source: 'catalogue_check', checked_on: '2026-11-01', grant: { id: 1822, deadline: '2026-09-30', days_over: 32 } } }), hub.deps);
    expect(r.reopened).toBe(true);
    expect(hub.items[0]).toMatchObject({ status: 'new', flagged_again: true, snapshot: { grant: { deadline: '2026-09-30' } } });
  });
});

describe('consulting cards: answer, send to Chris, approve for AI (migration 057)', () => {
  const STAFF = 'consultant@granted.ca';

  test('isConsultingCard reads the ref: kind chat with the consulting issue', () => {
    expect(isConsultingCard({ kind: 'chat', chat_turn_ref: 'conv:290:consulting_question' })).toBe(true);
    expect(isConsultingCard({ kind: 'chat', chat_turn_ref: 'conv:290:pushback' })).toBe(false);
    expect(isConsultingCard({ kind: 'match', chat_turn_ref: null })).toBe(false);
  });

  test('setAnswer saves the answer with its author and logs it; only on an open consulting card', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(consultingFlag(), hub.deps);
    const updated = await setAnswer(item.id, '  We offer end-to-end application management; a consultant will reach out.  ', STAFF, hub.deps);
    expect(updated).toMatchObject({ staff_answer: 'We offer end-to-end application management; a consultant will reach out.', staff_answer_by: STAFF });
    expect(hub.events.at(-1)).toMatchObject({ action: 'answered', actor: STAFF });
    expect(det(hub.events.at(-1))).toEqual({ text: 'We offer end-to-end application management; a consultant will reach out.' });
    expect(hub.items[0].status).toBe('new');

    await expectStatus(setAnswer(item.id, '', STAFF, hub.deps), 400);
    await expectStatus(setAnswer(item.id, 'x'.repeat(ANSWER_MAX + 1), STAFF, hub.deps), 400);
    await expectStatus(setAnswer(item.id, 'ok', null, hub.deps), 400);
    await expectStatus(setAnswer(999, 'ok', STAFF, hub.deps), 404);
    const { item: match } = await addFlag(matchFlag(), hub.deps);
    await expectStatus(setAnswer(match.id, 'ok', STAFF, hub.deps), 400);
    await close(item.id, {}, STAFF, hub.deps);
    await expectStatus(setAnswer(item.id, 'late', STAFF, hub.deps), 409);
  });

  test('sendToChris saves the answer, hands the card to chris and moves it off new; a second send changes nothing else', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(consultingFlag(), hub.deps);
    const sent = await sendToChris(item.id, 'Draft answer', STAFF, hub.deps);
    expect(sent).toMatchObject({ owner: 'chris', status: 'in_progress', staff_answer: 'Draft answer', staff_answer_by: STAFF });
    expect(hub.events.slice(-3).map((e) => e.action)).toEqual(['answered', 'owner', 'status']);
    expect(det(hub.events.at(-2))).toEqual({ from: null, to: 'chris' });
    expect(hub.events.at(-1)).toMatchObject({ from_status: 'new', to_status: 'in_progress' });
    const n = hub.events.length;
    await sendToChris(item.id, 'Draft answer v2', STAFF, hub.deps);
    expect(hub.events.slice(n).map((e) => e.action)).toEqual(['answered']);
    expect(hub.items[0].staff_answer).toBe('Draft answer v2');
  });

  test('approveForAi: only once the card is with chris and answered; queues the pair and closes the card', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(consultingFlag(), hub.deps);
    await expectStatus(approveForAi(item.id, 'chris@granted.ca', {}, hub.deps), 409);           // not with chris yet
    await setOwner(item.id, 'chris', 'chris@granted.ca', hub.deps);
    await expectStatus(approveForAi(item.id, 'chris@granted.ca', {}, hub.deps), 400);           // no answer yet
    await sendToChris(item.id, 'Yes — Granted manages applications end to end; book a call.', STAFF, hub.deps);

    const r = await approveForAi(item.id, 'chris@granted.ca', {}, hub.deps);
    expect(r.item).toMatchObject({ status: 'closed', close_note: APPROVED_NOTE, closed_by: 'chris@granted.ca', expected_match: null });
    expect(r.knowledge).toMatchObject({
      item_id: item.id, conversation_id: 290, company_id: 135,
      question: 'What does it entail to have your consulting team manage the application end to end?',
      question_rewritten: 'Can the consulting team manage the application end to end?',
      ai_reply: 'GetGranted helps you find grants; for hands-on help, contact help@granted.ca.',
      answer: 'Yes — Granted manages applications end to end; book a call.', approved_by: 'chris@granted.ca', status: 'pending'
    });
    expect(hub.knowledge).toHaveLength(1);
    expect(hub.events.slice(-2).map((e) => [e.action, e.from_status, e.to_status])).toEqual([
      ['approved_for_ai', 'in_progress', 'closed'], ['closed', 'in_progress', 'closed']]);
    expect(det(hub.events.at(-2))).toEqual({ knowledge_id: 1 });
    expect(det(hub.events.at(-1))).toEqual({ expected_match: null, close_note: APPROVED_NOTE });
    await expectStatus(approveForAi(item.id, 'chris@granted.ca', {}, hub.deps), 409);           // already closed
  });

  test('approveForAi with an answer in the call saves it first; a bad one is a 400 and nothing is queued', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(consultingFlag(), hub.deps);
    await sendToChris(item.id, 'Draft', STAFF, hub.deps);
    await expectStatus(approveForAi(item.id, 'chris@granted.ca', { answer: 'x'.repeat(ANSWER_MAX + 1) }, hub.deps), 400);
    expect(hub.knowledge).toHaveLength(0);
    const r = await approveForAi(item.id, 'chris@granted.ca', { answer: 'Final wording' }, hub.deps);
    expect(r.knowledge.answer).toBe('Final wording');
    expect(det(hub.events.filter((e) => e.action === 'answered').at(-1))).toEqual({ text: 'Final wording' });
  });

  test('a reopen clears the consultant\'s answer (the answered event keeps the text)', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(consultingFlag(), hub.deps);
    await sendToChris(item.id, 'Draft', STAFF, hub.deps);
    await approveForAi(item.id, 'chris@granted.ca', {}, hub.deps);
    const r = await addFlag(consultingFlag({ source_ref: 'oracle:290:consulting_question:t5' }), hub.deps);
    expect(r.reopened).toBe(true);
    expect(hub.items[0]).toMatchObject({ status: 'new', owner: null, staff_answer: null, staff_answer_by: null });
    expect(hub.events.some((e) => e.action === 'answered' && det(e).text === 'Draft')).toBe(true);
  });

  test('runDiagnosis keeps a code-made consulting owner (not the chris default)', async () => {
    const hub = fakeHub();
    const { item } = await addFlag(consultingFlag(), hub.deps);
    const r = await runDiagnosis(item.id, { ...hub.deps, diagnoseFn: async () => ({
      ok: true, owner: 'consulting', verdict: 'consulting_question', narrative: 'A consultant should answer.', client_notice: null,
      diagnosis: { verdict: 'consulting_question', rule: 'consulting_question', model: null }, snapshotTaken: false, cost: 0 }) });
    expect(r.diagnosed).toBe(true);
    expect(hub.items[0]).toMatchObject({ status: 'diagnosed', owner: 'consulting', snapshot: { issue: 'consulting_question' } });
    expect(hub.events.at(-1)).toMatchObject({ action: 'diagnosed' });
    expect(det(hub.events.at(-1))).toEqual({ owner: 'consulting', verdict: 'consulting_question' });
  });
});

describe('runReviewSweep: deadline cards', () => {
  const downs = [{ id: 'r1', company_id: 81, grant_root_id: 1196, created_at: new Date('2026-10-09T16:25:53Z'), clerk_id: 'user_a' }];

  test('the deadline sweep runs after the pattern sweep with the sweep\'s own addFlag, and its result is reported', async () => {
    const hub = fakeHub();
    const appQuery = jest.fn(async () => ({ rows: downs }));
    const flag = (input) => addFlag(input, hub.deps);
    const runDeadlineSweep = jest.fn(async ({ write, deps }) => {
      expect(write).toBe(true);
      expect(deps.appQuery).toBe(appQuery);
      expect(deps.addFlag).toBe(flag);
      return { passed: 2, rows: [], filed: 2, new_items: 2 };
    });
    const s = await runReviewSweep({ write: true, deps: { hubQuery: hub.q, appQuery, addFlag: flag, runDiagnosis: async () => ({ diagnosed: false }),
      runPatternSweep: noPatterns, runDeadlineSweep }, log: () => {} });
    expect(runDeadlineSweep).toHaveBeenCalledTimes(1);
    expect(s.deadlines).toEqual({ passed: 2, rows: [], filed: 2, new_items: 2 });
    expect(s.filed).toBe(1);
  });

  test('a failing deadline sweep is reported and never stops the 👎 path', async () => {
    const hub = fakeHub();
    const appQuery = jest.fn(async () => ({ rows: downs }));
    const s = await runReviewSweep({ write: true, deps: { hubQuery: hub.q, appQuery, addFlag: (i) => addFlag(i, hub.deps),
      runDiagnosis: async () => ({ diagnosed: false }), runPatternSweep: noPatterns,
      runDeadlineSweep: async () => { throw Object.assign(new Error('app down'), { code: 'ECONNRESET' }); } }, log: () => {} });
    expect(s.deadlines).toEqual({ error: 'ECONNRESET' });
    expect(s.filed).toBe(1);
    expect(hub.items).toHaveLength(1);
  });

  test('the dry-run preview includes the deadline cards it would file, with their evidence', async () => {
    const hub = fakeHub();
    const previewDiagnoses = jest.fn(async () => ({ rows: [], cost: 0 }));
    const snapshot = { source: 'catalogue_check', grant: { id: 1822, deadline: '2021-04-15', days_over: 2016 } };
    await runReviewSweep({ preview: true, deps: { hubQuery: hub.q, appQuery: async () => ({ rows: [] }), previewDiagnoses,
      runPatternSweep: noPatterns, runDeadlineSweep: async () => ({ passed: 1, rows: [{ grant_id: 1822, flag: { snapshot } }] }) }, log: () => {} });
    expect(previewDiagnoses).toHaveBeenCalledWith([{ kind: 'grant_deadline', grant_root_id: 1822, snapshot }], expect.anything());
  });
});
