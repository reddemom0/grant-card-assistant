/**
 * Pulse morning roundup (Oracle's chat-issue detector): what counts, what
 * flags, the chat cards it files (one per issue per conversation, snapshot
 * verbatim), the DM with card links, once a day.
 *
 * gg3-ops-db.js is the real module; queries, the model, the profile route, the review queue and Chat are
 * injected fakes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-roundup.test.js
 */

import { jest } from '@jest/globals';

process.env.GG3_OPS_DB_READONLY_URL = 'postgresql://oracle_readonly:x@localhost:5432/test';

jest.unstable_mockModule('../../src/utils/cost-logger.js', () => ({ logAPICost: () => 0 }));

const R = await import('../../src/services/pulse-roundup.js');
const {
  collectErrors, collectConversations, reviewConversation, cleanReview, transcriptOf, cardCandidates, snapshotFor,
  fileCards, dmCards, clientLabels, clientRef, formatRoundup, runMorningRoundup, startPulseRoundup,
  missingRoundupEnv, OWNERS, DETECTOR_ACTOR, locateFlagged, numberedTranscript, _resetPulseRoundupForTests
} = R;

const ENV = {
  GG3_OPS_DB_READONLY_URL: process.env.GG3_OPS_DB_READONLY_URL,
  PULSE_ROUNDUP_SUBSCRIBERS: 'chris@granted.ca',
  PUBLIC_URL: 'https://hub.test'
};
const NOW = new Date('2026-10-01T15:00:00Z');   // 08:00 in Vancouver

const msg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const say = (text) => ({ role: 'user', content: text }); // a client message that starts a turn
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

/** addFlag over an in-memory queue: one card per chat_turn_ref, source_ref deduped. */
function fakeQueue() {
  const cards = [];
  const flags = [];
  const addFlag = jest.fn(async (input) => {
    let card = cards.find(c => c.chat_turn_ref === input.chat_turn_ref);
    const created = !card;
    if (!card) { card = { id: 100 + cards.length, ...input, flag_count: 0, snapshot: null }; cards.push(card); }
    if (flags.some(f => f.source_ref === input.source_ref)) return { item: card, duplicate: true, created: false, reopened: false };
    flags.push(input);
    card.flag_count += 1;
    if (!card.snapshot && input.snapshot) card.snapshot = input.snapshot;
    return { item: card, duplicate: false, created, reopened: false };
  });
  return { cards, flags, addFlag };
}

function makeDeps({ errors = [], conversations = [], answers = {}, claimRows = [{ alert_key: 'k' }], profile = null, postResult = true } = {}) {
  const model = fakeModel({
    conversation_review: { flags: [], take: '', owner: OWNERS[0] },
    ...answers
  });
  const queue = fakeQueue();
  return {
    queue,
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
    addFlag: queue.addFlag,
    companyFor: jest.fn(async (ids) => new Map(ids.map(id => [id, 135]))),
    readMessages: jest.fn(async () => [say('why did it break?'), msg('assistant', '')])
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
  test('errors: the spike alert\'s rules, everyone\'s (internal accounts too), labelled', async () => {
    const q = jest.fn(async () => ({ configured: true, rows: [
      { turn_id: 't1', occurred_at: NOW, conversation_id: 4, user_id: 'user_aaaa1111', outcome: 'max_rounds', error_category: null },
      { turn_id: 't2', occurred_at: NOW, conversation_id: 5, user_id: 'user_bbbb2222', outcome: 'no_answer', error_category: 'refusal' }
    ] }));
    const errors = await collectErrors(24, q);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('FROM chat_turns');
    expect(sql).not.toContain('user_id = ANY');
    expect(params).toEqual([24, ['error', 'max_rounds', 'no_answer'], expect.arrayContaining(['missing_message'])]);
    expect(errors.map(e => [e.label, e.category, e.issue, e.turnId])).toEqual([
      ['chat broke', null, 'chat_broke', 't1'], ['empty reply or refusal', 'refusal', 'empty_reply', 't2']]);
    expect(sql).toContain('turn_index');
  });

  test('conversations: active in the window by updated_at, everyone\'s (internal accounts too), at most 50', async () => {
    const q = jest.fn(async () => ({ configured: true, rows: [] }));
    await collectConversations(24, q);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('updated_at > now() - make_interval(hours => $1::int)');
    expect(sql).not.toContain('user_id = ANY');
    expect(params).toEqual([24, 50]);
  });

  test('the transcript keeps words only: tool calls and results are dropped', () => {
    const t = transcriptOf([
      say('Which grants fit us?'),
      { role: 'assistant', content: [{ type: 'tool_use', name: 'search', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', content: 'raw rows' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Here are three.' }] },
      say('And for hiring?')
    ]);
    // Client messages that start a turn carry the same 0-based turn the ops DB and the diagnosis count.
    expect(t).toEqual([
      { role: 'client', text: 'Which grants fit us?', turn: 0 },
      { role: 'assistant', text: 'Here are three.' },
      { role: 'client', text: 'And for hiring?', turn: 1 }
    ]);
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
    // A chat the model found fine is no card at all.
    expect(cardCandidates([], [{ ok: true, flags: [], take: '', owner: OWNERS[0], userId: 'u1', conversationId: 1 }])).toEqual([]);
  });

  test('unknown flags and owners are dropped; a failed review is reported, not thrown', async () => {
    expect(cleanReview({ flags: ['made_up', 'pushback'], take: 'x', owner: 'Steph' }, [{ role: 'client', text: 'wrong' }]))
      .toEqual({ flags: ['pushback'], take: 'x', fullTake: 'x', owner: OWNERS[0] });
    const long = 'word '.repeat(60).trim();
    const c = cleanReview({ flags: ['pushback'], take: long, owner: OWNERS[0] }, [{ role: 'client', text: 'wrong' }]);
    expect(c.take.length).toBeLessThanOrEqual(160);
    expect(c.fullTake).toBe(long);
    const { createMessage } = fakeModel({ conversation_review: Object.assign(new Error('x'), { status: 529 }) });
    expect(await reviewConversation(conv(1, 'u', [msg('user', 'hi')]), createMessage)).toEqual({ ok: false, code: '529' });
  });
});

describe('the flagged message', () => {
  const t = [{ role: 'client', text: 'a', turn: 0 }, { role: 'assistant', text: 'b' }, { role: 'client', text: 'c', turn: 1 },
    { role: 'assistant', text: 'd' }, { role: 'client', text: 'e', turn: 2 }, { role: 'assistant', text: 'f' }];
  const review = { flags: ['pushback'], take: 'Wrong deadline', owner: OWNERS[0] };

  test('the locate call names it by its shown number; anything else falls back to the last client turn', async () => {
    const at = async (answer) => (await locateFlagged(t, review, fakeModel({ flagged_message: answer }).createMessage));
    expect(await at({ client_message: 2 })).toEqual({ turnIndex: 1, located: 'model' });
    expect(await at({ client_message: 9 })).toEqual({ turnIndex: 2, located: 'fallback' });
    expect(await at(Object.assign(new Error('x'), { status: 529 }))).toEqual({ turnIndex: 2, located: 'fallback', code: '529' });
    expect(numberedTranscript(t)).toContain('CLIENT (message 3): e');
  });

  test('the review call is unchanged (no numbers, no message field); the locate call runs only when flagged', async () => {
    const { createMessage, calls } = fakeModel({
      conversation_review: { flags: ['pushback'], take: 't', owner: OWNERS[0] },
      flagged_message: { client_message: 1 }
    });
    const r = await reviewConversation(conv(1, 'u', [say('first'), msg('assistant', 'wrong'), say('that is wrong')]), createMessage);
    expect(r).toMatchObject({ ok: true, flags: ['pushback'], turnIndex: 0, located: 'model' });
    expect(calls.map((c) => c.tool_choice.name)).toEqual(['conversation_review', 'flagged_message']);
    expect(calls[0].messages[0].content).toContain('CLIENT: that is wrong');
    expect(calls[0].messages[0].content).not.toContain('(message');
    expect(Object.keys(calls[0].tools[0].input_schema.properties)).toEqual(['flags', 'take', 'owner']);
    expect(calls[1].messages[0].content).toContain('CLIENT (message 2): that is wrong');
    expect(calls[1].messages[0].content).toContain('The problem: pushed back — t');

    const fine = fakeModel({ conversation_review: { flags: [], take: '', owner: OWNERS[0] } });
    const ok = await reviewConversation(conv(2, 'u', [say('hi'), msg('assistant', 'hello')]), fine.createMessage);
    expect(ok).toMatchObject({ flags: [], turnIndex: null });
    expect(fine.calls).toHaveLength(1);
  });
});

describe('card candidates', () => {
  const reviews = [
    { ok: true, flags: ['repeated_question', 'pushback'], take: 'Gave the wrong deadline', owner: 'Research (grant card data)',
      userId: 'user_cccc3333', conversationId: 7, turnIndex: 2, messages: [], updatedAt: NOW },
    { ok: true, flags: [], take: '', owner: OWNERS[0], userId: 'user_x', conversationId: 8, turnIndex: null }
  ];
  const errors = [
    { issue: 'chat_broke', label: 'chat broke', category: 'connection_error', userId: 'user_aaaa1111', conversationId: 4, turnId: 'ta', turnIndex: 1, at: NOW },
    { issue: 'chat_broke', label: 'chat broke', category: 'connection_error', userId: 'user_aaaa1111', conversationId: 4, turnId: 'tb', turnIndex: 3, at: NOW },
    { issue: 'empty_reply', label: 'empty reply or refusal', category: null, userId: 'user_b', conversationId: null, turnId: 'tc', turnIndex: null, at: NOW }
  ];

  test('one card per issue per conversation; the main flag names the issue; a fine chat is nothing', () => {
    const c = cardCandidates(errors, reviews);
    expect(c.map(x => [x.ref, x.sourceRef, x.name])).toEqual([
      ['conv:7:pushback', 'oracle:7:pushback:t2', 'Asked again, pushed back'],
      ['conv:4:chat_broke', 'oracle:turn:ta', 'Chat broke (connection_error)'],
      ['conv:4:chat_broke', 'oracle:turn:tb', 'Chat broke (connection_error)'],
      ['tc', 'oracle:turn:tc', 'Empty reply or refusal']
    ]);
  });

  test('the snapshot is the flagged turn and the 3 before it, verbatim', () => {
    const long = 'x'.repeat(6000);
    const messages = [say('q0'), msg('assistant', 'a0'), say('q1'), msg('assistant', 'a1'), say('q2'), msg('assistant', 'a2'),
      say('q3'), msg('assistant', 'a3'), say(long), msg('assistant', 'bad answer'), say('that is wrong'), msg('assistant', 'sorry')];
    const snap = snapshotFor({ conversationId: 7, issue: 'pushback', flags: ['pushback'], take: 't', turnIndex: 4 }, messages);
    expect(snap).toMatchObject({ source: 'oracle_detected', conversation_id: 7, issue: 'pushback', flagged_turn_index: 4 });
    expect(snap.turns.map(x => x.turn_index)).toEqual([1, 2, 3, 4]);
    expect(snap.turns.at(-1)).toMatchObject({ client: long, assistant: 'bad answer', flagged: true });
    expect(snapshotFor({ turnIndex: 1 }, null)).toBeNull();
  });

  test('filing: the same issue in the same conversation is one card; a re-detected turn adds nothing', async () => {
    const q = fakeQueue();
    const deps = { addFlag: q.addFlag, companyFor: async () => new Map([['user_aaaa1111', 120]]), readMessages: jest.fn(async () => [say('hi'), msg('assistant', '')]) };
    const c = cardCandidates(errors, reviews);
    const first = await fileCards(c, deps);
    expect(first.failed).toBe(0);
    expect(q.cards.map(x => [x.chat_turn_ref, x.flag_count])).toEqual([['conv:7:pushback', 1], ['conv:4:chat_broke', 2], ['tc', 1]]);
    expect(deps.readMessages).toHaveBeenCalledTimes(1); // conversation 4, read once; the review had its messages
    expect(q.flags[1]).toMatchObject({ kind: 'chat', source: 'oracle_detected', actor: DETECTOR_ACTOR, company_id: 120, conversation_id: 4,
      comment: 'Chat broke (connection_error): The chat failed before it finished answering.' });
    expect(q.cards[2].snapshot).toBeNull(); // no conversation: diagnosis reads the turn itself
    const again = await fileCards(c, deps);
    expect(again.results.every(r => r.duplicate)).toBe(true);
    expect(dmCards(again.results, new Map())).toEqual([]);
  });

  test('a failed filing is counted, not thrown', async () => {
    const r = await fileCards(cardCandidates(errors.slice(0, 1), []), {
      addFlag: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); }, companyFor: async () => new Map(), readMessages: async () => null });
    expect(r.failed).toBe(1);
    expect(dmCards(r.results, new Map())[0]).toMatchObject({ id: null, count: 1 });
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
  const card = (name, count, extra = {}) => ({ id: count * 10, name, count, userIds: [`u${name}`], client: `Co ${name}`, take: `take ${name}`,
    owner: OWNERS[0], created: true, reopened: false, ...extra });

  test('header, one line per card (most first, at most 5), tags, and each card link', () => {
    const text = formatRoundup([
      card('A', 1), card('B', 9, { created: false }), card('C', 3, { created: false, reopened: true }),
      card('D', 2), card('E', 2), card('F', 1, { id: null })
    ], { env: { PUBLIC_URL: 'https://hub.test/' } });
    const lines = text.split('\n');
    expect(lines[0]).toBe('☀️ GetGranted chat — last 24h: 6 issues across 6 clients.');
    expect(lines[1]).toBe('• B (9×) — Co B — take B — Chris (AI behaviour) — seen before — https://hub.test/control-centre#review/90');
    expect(lines[2]).toBe('• C (3×) — Co C — take C — Chris (AI behaviour) — reopened — https://hub.test/control-centre#review/30');
    expect(lines.filter(l => l.startsWith('• '))).toHaveLength(5);
    expect(lines.at(-2)).toBe('…and 1 more.');
    expect(lines.at(-1)).toBe('All chat cards: https://hub.test/control-centre. Ask me about any of these for the conversation.');
    expect(text).not.toMatch(/docs\.google\.com/);
  });

  test('internal-account cards: after the client ones, marked (Internal), counted in the header', () => {
    const text = formatRoundup([card('A', 1, { internal: true }), card('B', 1), card('C', 5, { internal: true })], { env: { PUBLIC_URL: 'https://hub.test' } });
    const lines = text.split('\n');
    expect(lines[0]).toBe('☀️ GetGranted chat — last 24h: 3 issues across 3 clients (2 from internal accounts).');
    expect(lines.slice(1, 4).map(l => l.split(' — ')[1])).toEqual(['Co B', 'Co C (Internal)', 'Co A (Internal)']);
  });

  test('dmCards: internal only when every client on the card is internal; no list → nothing marked', () => {
    const r = (ref, userId, id) => ({ ok: true, id, created: true, candidate: { ref, name: 'Pushed back', take: 't', owner: OWNERS[0], userId } });
    const results = [r('conv:1:pushback', 'user_staff1', 1), r('conv:2:pushback', 'user_client', 2), r('conv:2:pushback', 'user_staff1', 2)];
    const cards = dmCards(results, new Map(), new Set(['user_staff1']));
    expect(cards.map(c => [c.id, c.internal])).toEqual([[1, true], [2, false]]);
    expect(dmCards(results, new Map()).every(c => c.internal === false)).toBe(true);
  });

  test('singulars, and the production Hub when PUBLIC_URL is unset', () => {
    const text = formatRoundup([card('A', 1)], { env: {} });
    expect(text).toContain('1 issue across 1 client');
    expect(text).toContain('https://grant-card-assistant-production.up.railway.app/control-centre#review/10');
  });
});

describe('the morning run', () => {
  const badChat = conv(9, 'user_dddd4444', [say('what is the CDAP deadline?'), msg('assistant', 'It closed in 2024.'), say('that is wrong')]);
  const answers = {
    conversation_review: { flags: ['pushback'], take: 'Client said the deadline was wrong', owner: 'Research (grant card data)' },
    flagged_message: { client_message: 1 }
  };

  test('nothing happened: no claim, no card, no DM', async () => {
    const d = makeDeps();
    expect(await runMorningRoundup({ now: NOW, env: ENV, deps: d })).toEqual({ status: 'nothing' });
    expect(d.oracleQuery).not.toHaveBeenCalled();
    expect(d.post).not.toHaveBeenCalled();
    expect(d.createMessage).not.toHaveBeenCalled();
    expect(d.addFlag).not.toHaveBeenCalled();
  });

  test('conversations that all went fine: nothing is filed or sent', async () => {
    const d = makeDeps({ conversations: [conv(1, 'u1', [say('hi'), msg('assistant', 'hello')])] });
    expect(await runMorningRoundup({ now: NOW, env: ENV, deps: d })).toEqual({ status: 'nothing' });
    expect(d.post).not.toHaveBeenCalled();
    expect(d.addFlag).not.toHaveBeenCalled();
  });

  test('each delivered DM is recorded as a roundup post covering the 24 hours', async () => {
    const d = makeDeps({ conversations: [badChat], answers, postResult: { messageName: 'spaces/DM1/messages/R1', threadName: 'spaces/DM1/threads/R1' } });
    d.recordPost = jest.fn(async () => true);
    await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    const [space, text] = d.post.mock.calls[0];
    expect(d.recordPost).toHaveBeenCalledWith({
      kind: 'roundup', isTest: false, recipientEmail: 'chris@granted.ca', spaceName: space,
      messageName: 'spaces/DM1/messages/R1', threadName: 'spaces/DM1/threads/R1',
      periodStart: new Date(NOW.getTime() - 24 * 3600000), periodEnd: NOW, summary: text
    });
  });

  test('a bad chat: claims the day, files a chat card with the verbatim turns, DMs its link', async () => {
    const d = makeDeps({ conversations: [badChat], answers });
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res).toEqual({ status: 'sent', issues: 1, sent: 1, filed: 1 });

    const claim = d.oracleQuery.mock.calls.find(([sql]) => sql.includes('pulse_alert_state'));
    expect(claim[1][0]).toBe('morning_roundup:2026-10-01');

    expect(d.queue.cards).toHaveLength(1);
    const card = d.queue.cards[0];
    expect(card).toMatchObject({ kind: 'chat', chat_turn_ref: 'conv:9:pushback', conversation_id: 9, company_id: 135,
      source: 'oracle_detected', source_ref: 'oracle:9:pushback:t0', actor: DETECTOR_ACTOR });
    expect(card.snapshot).toMatchObject({ source: 'oracle_detected', flagged_turn_index: 0, issue: 'pushback',
      turns: [{ turn_index: 0, client: 'what is the CDAP deadline?', assistant: 'It closed in 2024.', flagged: true }] });

    const [space, text] = d.post.mock.calls[0];
    expect(space).toBe('spaces/DM1');
    expect(text).toContain('☀️ GetGranted chat — last 24h: 1 issue across 1 client.');
    expect(text).toContain('• Pushed back — Co 44 — Client said the deadline was wrong — Research (grant card data) — https://hub.test/control-centre#review/100');
    // Oracle's words only: the client's own text is never in the DM.
    expect(text).not.toContain('that is wrong');
    // The review, then the locate call for the flagged conversation; no grouping call.
    expect(d.model.calls.map(c => c.tool_choice.name)).toEqual(['conversation_review', 'flagged_message']);
  });

  test('an internal account\'s chat is reviewed by the same call, filed with its company, and marked Internal in the DM', async () => {
    const staffChat = conv(11, 'user_staff1', [say('what is the CDAP deadline?'), msg('assistant', 'It closed in 2024.'), say('that is wrong')]);
    const d = makeDeps({ conversations: [badChat, staffChat], answers });
    d.internalIds = jest.fn(async () => new Set(['user_staff1']));
    d.companyFor = jest.fn(async (ids) => new Map(ids.map(id => [id, id === 'user_staff1' ? 81 : 135])));
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res).toMatchObject({ status: 'sent', issues: 2, filed: 2 });
    // Both conversations went through the identical review call (same system, tool, model).
    const reviews = d.model.calls.filter(c => c.tool_choice.name === 'conversation_review');
    expect(reviews).toHaveLength(2);
    const strip = ({ messages, ...rest }) => rest;
    expect(strip(reviews[0])).toEqual(strip(reviews[1]));
    // The card carries the internal company (the board tags it Internal through company_internal).
    expect(d.queue.cards.map(c => [c.chat_turn_ref, c.company_id])).toEqual([['conv:9:pushback', 135], ['conv:11:pushback', 81]]);
    const text = d.post.mock.calls[0][1];
    expect(text).toContain('2 issues across 2 clients (1 from internal accounts).');
    expect(text).toContain('• Pushed back — Co f1 (Internal) — ');
  });

  test('internal list unavailable: still reviews and files everything, DM lines unmarked', async () => {
    const d = makeDeps({ conversations: [badChat], answers });
    d.internalIds = jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); });
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res).toMatchObject({ status: 'sent', filed: 1 });
    expect(d.post.mock.calls[0][1]).not.toContain('Internal');
  });

  test('a detection already on file is not re-sent', async () => {
    const d = makeDeps({ conversations: [badChat], answers });
    await d.addFlag({ kind: 'chat', chat_turn_ref: 'conv:9:pushback', source: 'oracle_detected', source_ref: 'oracle:9:pushback:t0' });
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res).toEqual({ status: 'nothing', filed: 0 });
    expect(d.post).not.toHaveBeenCalled();
  });

  test('one send per day: an already-claimed date files and sends nothing', async () => {
    const d = makeDeps({ conversations: [badChat], answers, claimRows: [] });
    expect(await runMorningRoundup({ now: NOW, env: ENV, deps: d })).toEqual({ status: 'already_sent' });
    expect(d.post).not.toHaveBeenCalled();
    expect(d.addFlag).not.toHaveBeenCalled();
    expect(d.createMessage).not.toHaveBeenCalled();
  });

  test('nobody reachable keeps the claim (the cards are filed)', async () => {
    const d = makeDeps({ conversations: [badChat], answers, postResult: false });
    const res = await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(res).toMatchObject({ status: 'undelivered', filed: 1 });
    expect(d.oracleQuery.mock.calls.some(([sql]) => /DELETE|UPDATE pulse_alert_state/.test(sql))).toBe(false);
  });

  test('failed chat turns file onto the conversation\'s chat_broke card', async () => {
    const errors = [{ kind: 'error', issue: 'chat_broke', label: 'chat broke', category: null, userId: 'user_e', conversationId: 4, turnId: 'tx', turnIndex: 0, at: NOW }];
    const d = makeDeps({ errors });
    await runMorningRoundup({ now: NOW, env: ENV, deps: d });
    expect(d.queue.cards[0]).toMatchObject({ chat_turn_ref: 'conv:4:chat_broke', source_ref: 'oracle:turn:tx' });
    expect(d.queue.cards[0].snapshot.turns[0]).toMatchObject({ client: 'why did it break?', flagged: true });
    expect(d.readMessages).toHaveBeenCalledWith(4);
  });

  test.each(['GG3_OPS_DB_READONLY_URL', 'PULSE_ROUNDUP_SUBSCRIBERS'])(
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

  test('the sheet settings are no longer needed', () => {
    expect(missingRoundupEnv({ GG3_OPS_DB_READONLY_URL: 'x', PULSE_ROUNDUP_SUBSCRIBERS: 'y' })).toEqual([]);
  });

  test('scheduled at 08:00 Vancouver when configured', () => {
    expect(missingRoundupEnv(ENV)).toEqual([]);
    const cron = { schedule: jest.fn() };
    expect(startPulseRoundup(cron, ENV)).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function), { name: 'pulse-roundup', timezone: 'America/Vancouver', noOverlap: true });
  });
});
