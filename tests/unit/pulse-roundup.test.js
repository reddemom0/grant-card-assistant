/**
 * Pulse morning roundup: what counts, what flags, grouping, the DM, once a day.
 *
 * gg3-ops-db.js is the real module (its staff filter is what is being tested);
 * queries, the model, the profile route, the sheet and Chat are injected fakes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-roundup.test.js
 */

import { jest } from '@jest/globals';

process.env.GG3_OPS_DB_READONLY_URL = 'postgresql://oracle_readonly:x@localhost:5432/test';
process.env.GG3_INTERNAL_USER_IDS = 'user_staff1,user_staff2';

jest.unstable_mockModule('../../src/utils/cost-logger.js', () => ({ logAPICost: () => 0 }));

const R = await import('../../src/services/pulse-roundup.js');
const {
  collectErrors, collectConversations, reviewConversation, cleanReview, transcriptOf, buildItems,
  groupIssues, fallbackIssues, clientLabels, clientRef, formatRoundup, runMorningRoundup, startPulseRoundup,
  missingRoundupEnv, OWNERS, _resetPulseRoundupForTests
} = R;

const ENV = {
  GG3_OPS_DB_READONLY_URL: process.env.GG3_OPS_DB_READONLY_URL,
  PULSE_ROUNDUP_SUBSCRIBERS: 'chris@granted.ca',
  PULSE_ERRORS_SHEET_ID: 'sheet123',
  PULSE_SHEET_OWNER_EMAIL: 'chris@granted.ca'
};
const NOW = new Date('2026-10-01T15:00:00Z');   // 08:00 in Vancouver

const msg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const conv = (id, userId, messages) => ({ id, userId, messages, updatedAt: NOW });

/** A fake messages.create: answers each tool by name. */
function fakeModel(answers) {
  const calls = [];
  const createMessage = jest.fn(async (params) => {
    calls.push(params);
    const name = params.tool_choice.name;
    const a = typeof answers[name] === 'function' ? answers[name](params) : answers[name];
    if (a instanceof Error) throw a;
    return { content: [{ type: 'tool_use', name, id: 't', input: a }], usage: { input_tokens: 1, output_tokens: 1 } };
  });
  return { createMessage, calls };
}

function makeDeps({ errors = [], conversations = [], answers = {}, claimRows = [{ alert_key: 'k' }], sheetValues = [], profile = null, postResult = true } = {}) {
  const model = fakeModel({
    conversation_review: { flags: [], take: '', owner: OWNERS[0] },
    issues: (p) => ({ issues: [] }),
    ...answers
  });
  return {
    model,
    collectErrors: jest.fn(async () => errors),
    collectConversations: jest.fn(async () => conversations),
    createMessage: model.createMessage,
    fetchProfile: jest.fn(profile || (async (id) => ({ status: 200, companyName: `Co ${id.slice(-2)}` }))),
    oracleQuery: jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO pulse_alert_state')) return { rows: claimRows };
      if (sql.includes('FROM users')) return { rows: [{ id: 3 }] };
      return { rows: [] };
    }),
    getSubscribers: jest.fn(async () => [{ email: 'chris@granted.ca', dmSpace: 'spaces/DM1' }]),
    post: jest.fn(async () => postResult),
    readSheet: jest.fn(async () => ({ success: true, data: { values: sheetValues } })),
    updateSheet: jest.fn(async () => ({ success: true })),
    appendSheet: jest.fn(async () => ({ success: true }))
  };
}

let spies;
beforeEach(() => {
  _resetPulseRoundupForTests();
  spies = ['log', 'warn', 'error'].map(k => jest.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => spies.forEach(s => s.mockRestore()));

// ----------------------------------------------------------------------------

describe('what is read', () => {
  test('errors: the spike alert\'s rules, staff left out, labelled', async () => {
    const q = jest.fn(async () => ({ configured: true, rows: [
      { turn_id: 't1', occurred_at: NOW, conversation_id: 4, user_id: 'user_aaaa1111', outcome: 'max_rounds', error_category: null },
      { turn_id: 't2', occurred_at: NOW, conversation_id: 5, user_id: 'user_bbbb2222', outcome: 'no_answer', error_category: 'refusal' }
    ] }));
    const errors = await collectErrors(24, q);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('FROM chat_turns');
    expect(sql).toContain('NOT (user_id = ANY($4::text[]))');
    expect(params).toEqual([24, ['error', 'max_rounds', 'no_answer'], expect.arrayContaining(['missing_message']), ['user_staff1', 'user_staff2']]);
    expect(errors.map(e => [e.label, e.category])).toEqual([['chat broke', null], ['empty reply or refusal', 'refusal']]);
  });

  test('conversations: active in the window by updated_at, staff left out, at most 50', async () => {
    const q = jest.fn(async () => ({ configured: true, rows: [] }));
    await collectConversations(24, q);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('updated_at > now() - make_interval(hours => $1::int)');
    expect(sql).toContain('NOT (user_id = ANY($3::text[]))');
    expect(params).toEqual([24, 50, ['user_staff1', 'user_staff2']]);
  });

  test('the transcript keeps words only: tool calls and results are dropped', () => {
    const t = transcriptOf([
      msg('user', 'Which grants fit us?'),
      { role: 'assistant', content: [{ type: 'tool_use', name: 'search', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', content: 'raw rows' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Here are three.' }] }
    ]);
    expect(t).toEqual([{ role: 'client', text: 'Which grants fit us?' }, { role: 'assistant', text: 'Here are three.' }]);
  });
});

describe('went badly', () => {
  test('help@granted.ca in the assistant\'s text does not flag "asked for a person"', async () => {
    const { createMessage } = fakeModel({ conversation_review: { flags: ['asked_for_human'], take: 'Pointed to support', owner: 'Client follow-up' } });
    const r = await reviewConversation(conv(1, 'user_x', [
      msg('user', 'What is the CDAP deadline?'),
      msg('assistant', 'It is March 31. For anything else, email help@granted.ca.'),
      msg('user', 'thanks')
    ]), createMessage);
    expect(r).toMatchObject({ ok: true, flags: [] });
  });

  test('a client asking for a person does flag it', async () => {
    const { createMessage, calls } = fakeModel({ conversation_review: { flags: ['asked_for_human'], take: 'Wanted a person', owner: 'Client follow-up' } });
    const r = await reviewConversation(conv(1, 'user_x', [
      msg('user', 'This is not helping, can I talk to a real person?'),
      msg('assistant', 'You can reach the team at help@granted.ca.')
    ]), createMessage);
    expect(r.flags).toEqual(['asked_for_human']);
    // The conversation goes to the model inside the untrusted envelope.
    expect(calls[0].messages[0].content).toContain('<tool_output tool="gg3_conversation" trust="untrusted">');
    expect(calls[0].system).toContain('Leaving on its own is NOT a flag');
  });

  test('leaving on its own does not flag; "left unanswered" needs the assistant to have had the last word', () => {
    const clientLast = [{ role: 'assistant', text: 'a' }, { role: 'client', text: 'ok bye' }];
    expect(cleanReview({ flags: ['left_unanswered'], take: 'x', owner: OWNERS[0] }, clientLast).flags).toEqual([]);
    const assistantLast = [{ role: 'client', text: 'q' }, { role: 'assistant', text: 'a' }];
    expect(cleanReview({ flags: ['left_unanswered'], take: 'x', owner: OWNERS[0] }, assistantLast).flags).toEqual(['left_unanswered']);
    // A chat the model found fine is no item at all.
    expect(buildItems([], [{ ok: true, flags: [], take: '', owner: OWNERS[0], userId: 'u1' }])).toEqual([]);
  });

  test('unknown flags and owners are dropped; a failed review is reported, not thrown', async () => {
    expect(cleanReview({ flags: ['made_up', 'pushback'], take: 'x', owner: 'Steph' }, [{ role: 'client', text: 'wrong' }]))
      .toEqual({ flags: ['pushback'], take: 'x', owner: OWNERS[0] });
    const { createMessage } = fakeModel({ conversation_review: Object.assign(new Error('x'), { status: 529 }) });
    expect(await reviewConversation(conv(1, 'u', [msg('user', 'hi')]), createMessage)).toEqual({ ok: false, code: '529' });
  });
});

describe('grouping', () => {
  const errors = [
    { kind: 'error', label: 'chat broke', category: 'connection_error', userId: 'user_aaaa1111' },
    { kind: 'error', label: 'chat broke', category: 'connection_error', userId: 'user_bbbb2222' }
  ];
  const reviews = [{ ok: true, flags: ['pushback'], take: 'Gave the wrong deadline', owner: 'Research (grant card data)', userId: 'user_cccc3333' }];

  test('the model names the issues; counts and clients are counted in code; unknown ids dropped; leftovers kept', async () => {
    const items = buildItems(errors, reviews);
    expect(items.map(i => [i.id, i.count])).toEqual([['e1', 2], ['c1', 1]]);
    const { createMessage } = fakeModel({ issues: { issues: [
      { name: 'Chat drops the connection', item_ids: ['e1', 'zz9'], take: 'Connection errors mid-answer', owner: 'Chris (AI behaviour)', existing_row: 2 },
      { name: 'Duplicate', item_ids: ['e1'], take: 'x', owner: 'Jason (app/UI)', existing_row: 77 }
    ] } });
    const { issues, grouped } = await groupIssues(items, [{ row: 2, name: 'Chat times out', status: 'being fixed' }], createMessage);
    expect(grouped).toBe('model');
    expect(issues[0]).toMatchObject({ name: 'Chat drops the connection', count: 2, existingRow: 2 });
    expect(issues[0].userIds.sort()).toEqual(['user_aaaa1111', 'user_bbbb2222']);
    // e1 was already used; c1 was left out by the model and still reported.
    expect(issues).toHaveLength(2);
    expect(issues[1]).toMatchObject({ name: 'Went badly: pushed back', count: 1, take: 'Gave the wrong deadline', existingRow: null });
  });

  test('when the grouping call fails, the rules group by kind and match rows by name', async () => {
    const items = buildItems(errors, reviews);
    const { createMessage } = fakeModel({ issues: new Error('timeout') });
    const { issues, grouped } = await groupIssues(items, [{ row: 5, name: 'Chat broke (connection_error)' }], createMessage);
    expect(grouped).toBe('rules');
    expect(issues.map(i => [i.name, i.count, i.existingRow])).toEqual([
      ['Chat broke (connection_error)', 2, 5],
      ['Went badly: pushed back', 1, null]
    ]);
    expect(fallbackIssues([], [])).toEqual([]);
  });
});

describe('client names', () => {
  test('company name from the profile route; anything else is "a client" plus the last 4 of the id', async () => {
    const fetchProfile = async (id) => (id === 'user_aaaa1111' ? { status: 200, companyName: 'Acme Ltd' } : { status: 404, companyName: null });
    const { labels, stats } = await clientLabels(['user_aaaa1111', 'user_bbbb2222', 'user_aaaa1111'], fetchProfile);
    expect(labels.get('user_aaaa1111')).toBe('Acme Ltd');
    expect(labels.get('user_bbbb2222')).toBe('a client ·2222');
    expect(stats).toEqual({ named: 1, ref: 1, statuses: { 200: 1, 404: 1 } });
    expect(clientRef('')).toBe('a client ·????');
  });
});

describe('the DM', () => {
  const issue = (name, count, extra = {}) => ({ name, count, userIds: [`u${name}`], clients: [`Co ${name}`], take: `take ${name}`, owner: OWNERS[0], seenBefore: false, beingFixed: false, ...extra });

  test('header, one line per issue (most first, at most 5), tags, and the sheet link', () => {
    const text = formatRoundup([
      issue('A', 1), issue('B', 9, { seenBefore: true }), issue('C', 3, { seenBefore: true, beingFixed: true }),
      issue('D', 2), issue('E', 2), issue('F', 1)
    ], { sheetId: 'sheet123' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('☀️ GetGranted chat — last 24h: 6 issues across 6 clients.');
    expect(lines[1]).toBe('• B — Co B — take B — Chris (AI behaviour) — seen before');
    expect(lines[2]).toBe('• C — Co C — take C — Chris (AI behaviour) — known, being fixed');
    expect(lines.filter(l => l.startsWith('• '))).toHaveLength(5);
    expect(lines.at(-2)).toBe('…and 1 more.');
    expect(lines.at(-1)).toBe('Full list: https://docs.google.com/spreadsheets/d/sheet123. Ask me about any of these for the conversation.');
  });

  test('singulars, and more than three clients are summarised', () => {
    const text = formatRoundup([{ ...issue('A', 1), userIds: ['a', 'b', 'c', 'd'], clients: ['W', 'X', 'Y', 'Z'] }], { sheetId: 's' });
    expect(text).toContain('1 issue across 4 clients');
    expect(text).toContain('• A — W, X, Y +1 more —');
  });
});

describe('the morning run', () => {
  const badChat = conv(9, 'user_dddd4444', [msg('user', 'that is wrong'), msg('assistant', 'Sorry.')]);
  const answers = {
    conversation_review: { flags: ['pushback'], take: 'Client said the answer was wrong', owner: 'Chris (AI behaviour)' },
    issues: { issues: [{ name: 'Wrong answers on deadlines', item_ids: ['c1'], take: 'Deadline answers were wrong', owner: 'Research (grant card data)', existing_row: 2 }] }
  };
  const SHEET_ROWS = [['Wrong answers on deadlines', '2026-09-20', '2026-09-28', '4', 'Acme', 'Research (grant card data)', 'being fixed', 'Research checking', 'reported by Steph']];

  test('nothing happened: no claim, no sheet, no DM', async () => {
    const d = makeDeps();
    expect(await runMorningRoundup({ now: NOW, env: ENV, deps: d })).toEqual({ status: 'nothing' });
    expect(d.oracleQuery).not.toHaveBeenCalled();
    expect(d.post).not.toHaveBeenCalled();
    expect(d.createMessage).not.toHaveBeenCalled();
  });

  test('conversations that all went fine: nothing is sent or written', async () => {
    const d = makeDeps({ conversations: [conv(1, 'u1', [msg('user', 'hi'), msg('assistant', 'hello')])] });
    expect(await runMorningRoundup({ now: NOW, env: ENV, deps: d })).toEqual({ status: 'nothing' });
    expect(d.post).not.toHaveBeenCalled();
    expect(d.updateSheet).not.toHaveBeenCalled();
    expect(d.appendSheet).not.toHaveBeenCalled();
  });

  test('each delivered DM is recorded as a roundup post covering the 24 hours', async () => {
    const d = makeDeps({ conversations: [badChat], answers, sheetValues: SHEET_ROWS, postResult: { messageName: 'spaces/DM1/messages/R1', threadName: 'spaces/DM1/threads/R1' } });
    d.recordPost = jest.fn(async () => true);
    await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    const [space, text] = d.post.mock.calls[0];
    expect(d.recordPost).toHaveBeenCalledWith({
      kind: 'roundup', isTest: false, recipientEmail: 'chris@granted.ca', spaceName: space,
      messageName: 'spaces/DM1/messages/R1', threadName: 'spaces/DM1/threads/R1',
      periodStart: new Date(NOW.getTime() - 24 * 3600000), periodEnd: NOW, summary: text
    });
  });

  test('nothing to report → nothing sent, nothing recorded', async () => {
    const d = makeDeps({ conversations: [] });
    d.recordPost = jest.fn();
    await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(d.recordPost).not.toHaveBeenCalled();
  });

  test('a bad chat: claims the day, updates the matched row (C–E only), DMs with "known, being fixed"', async () => {
    const d = makeDeps({ conversations: [badChat], answers, sheetValues: SHEET_ROWS });
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res).toEqual({ status: 'sent', issues: 1, sent: 1 });

    const claim = d.oracleQuery.mock.calls.find(([sql]) => sql.includes('pulse_alert_state'));
    expect(claim[1][0]).toBe('morning_roundup:2026-10-01');
    expect(d.updateSheet).toHaveBeenCalledWith(3, { spreadsheet_id: 'sheet123', range: 'C2:E2', values: [['2026-10-01', 5, 'Acme, Co 44']] });
    expect(d.appendSheet).not.toHaveBeenCalled();

    const [space, text] = d.post.mock.calls[0];
    expect(space).toBe('spaces/DM1');
    expect(text).toContain('☀️ GetGranted chat — last 24h: 1 issue across 1 client.');
    expect(text).toContain('• Wrong answers on deadlines — Co 44 — Deadline answers were wrong — Research (grant card data) — known, being fixed');
    // Oracle's words only: the client's own text is never in the DM.
    expect(text).not.toContain('that is wrong');
  });

  test('one send per day: an already-claimed date sends and writes nothing', async () => {
    const d = makeDeps({ conversations: [badChat], answers, claimRows: [] });
    expect(await runMorningRoundup({ now: NOW, env: ENV, deps: d })).toEqual({ status: 'already_sent' });
    expect(d.post).not.toHaveBeenCalled();
    expect(d.updateSheet).not.toHaveBeenCalled();
    expect(d.createMessage).not.toHaveBeenCalled();
  });

  test('without the sheet the DM still goes out; nobody reachable keeps the claim', async () => {
    const d = makeDeps({ conversations: [badChat], answers, postResult: false });
    d.readSheet.mockResolvedValue({ success: false });
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res.status).toBe('undelivered');
    expect(d.updateSheet).not.toHaveBeenCalled();
    expect(d.oracleQuery.mock.calls.some(([sql]) => /DELETE|UPDATE pulse_alert_state/.test(sql))).toBe(false);
  });

  test.each(['GG3_OPS_DB_READONLY_URL', 'PULSE_ROUNDUP_SUBSCRIBERS', 'PULSE_ERRORS_SHEET_ID', 'PULSE_SHEET_OWNER_EMAIL'])(
    'missing %s: skipped, nothing read, never scheduled',
    async (key) => {
      const env = { ...ENV, [key]: '' };
      const d = makeDeps({ conversations: [badChat], answers });
      expect(await runMorningRoundup({ now: NOW, env, deps: d })).toEqual({ status: 'skipped', missing: [key] });
      expect(d.collectErrors).not.toHaveBeenCalled();
      const cron = { schedule: jest.fn() };
      expect(startPulseRoundup(cron, env)).toBe(false);
      expect(cron.schedule).not.toHaveBeenCalled();
    }
  );

  test('scheduled at 08:00 Vancouver when configured', () => {
    expect(missingRoundupEnv(ENV)).toEqual([]);
    const cron = { schedule: jest.fn() };
    expect(startPulseRoundup(cron, ENV)).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function), { name: 'pulse-roundup', timezone: 'America/Vancouver', noOverlap: true });
  });
});
