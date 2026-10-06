/**
 * Pulse weekly digest: the week, the counts, the one themes call, the post,
 * the detail tab, once a week.
 *
 * gg3-ops-db.js is the real module (its staff filter is what the queries use);
 * queries, the model, the sheet and Chat are injected fakes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-digest.test.js
 */

import { jest } from '@jest/globals';

process.env.GG3_OPS_DB_READONLY_URL = 'postgresql://oracle_readonly:x@localhost:5432/test';
process.env.GG3_INTERNAL_USER_IDS = 'user_staff1';

jest.unstable_mockModule('../../src/utils/cost-logger.js', () => ({ logAPICost: () => 0 }));

const D = await import('../../src/services/pulse-digest.js');

const ENV = {
  GG3_OPS_DB_READONLY_URL: process.env.GG3_OPS_DB_READONLY_URL,
  PULSE_DIGEST_SUBSCRIBERS: 'chris@granted.ca',
  PULSE_ERRORS_SHEET_ID: 'sheet123',
  PULSE_SHEET_OWNER_EMAIL: 'chris@granted.ca'
};
const MONDAY_RUN = new Date('2026-10-05T15:00:00Z');   // Mon 08:00 in Vancouver
const SECRET = 'Jane Doe at Acme Widgets';                // must never leave the model call

const okQuery = (rows) => async () => ({ configured: true, rows });

describe('the week', () => {
  test('previousWeek is the last full Mon–Sun week, Vancouver calendar', () => {
    expect(D.previousWeek(MONDAY_RUN)).toBe('2026-09-28');
    expect(D.previousWeek(new Date('2026-10-05T07:30:00Z'))).toBe('2026-09-28');  // Mon 00:30 PDT
    expect(D.previousWeek(new Date('2026-10-05T06:30:00Z'))).toBe('2026-09-21');  // still Sun 23:30 PDT
    expect(D.previousWeek(new Date('2026-10-11T20:00:00Z'))).toBe('2026-09-28');  // Sunday
  });

  test('weekBounds start at Vancouver midnight, DST weeks included', () => {
    const w = D.weekBounds('2026-09-28');
    expect(w.start.toISOString()).toBe('2026-09-28T07:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    const hours = (m) => { const b = D.weekBounds(m); return (b.end - b.start) / 3600000; };
    expect(hours('2026-10-26')).toBe(169);   // clocks go back Sun Nov 1
    expect(hours('2026-03-02')).toBe(167);   // clocks go forward Sun Mar 8
    expect(D.weekBounds('2026-12-07').start.toISOString()).toBe('2026-12-07T08:00:00.000Z');
  });

  test('isMonday accepts real Mondays only', () => {
    expect(D.isMonday('2026-09-28')).toBe(true);
    expect(D.isMonday('2026-09-29')).toBe(false);
    expect(D.isMonday('2026-02-30')).toBe(false);
    expect(D.isMonday('28-09-2026')).toBe(false);
  });

  test('tab title uses the Monday', () => {
    expect(D.tabTitle('2026-09-28')).toBe('Digest 2026-09-28');
  });
});

describe('counts', () => {
  test('formatChange shows — when the week before was 0', () => {
    expect(D.formatChange(5, 3)).toBe('5 (+2, +67% vs week before)');
    expect(D.formatChange(2, 4)).toBe('2 (−2, −50% vs week before)');
    expect(D.formatChange(2, 0)).toBe('2 (+2, — vs week before)');
    expect(D.formatChange(0, 0)).toBe('0 (±0, — vs week before)');
  });

  test('grant matches count distinct companies (user when no company), shown only, staff left out', async () => {
    const calls = [];
    const runQuery = async (sql, params) => { calls.push({ sql, params }); return { configured: true, rows: [{ grant_id: 7, companies: 2 }] }; };
    const out = await D.collectGrantMatches(D.weekBounds('2026-09-28'), runQuery);
    expect(out).toEqual([{ grantId: 7, companies: 2 }]);
    expect(calls[0].sql).toMatch(/count\(DISTINCT coalesce\(company_id::text, 'u:' \|\| user_id\)\)/);
    expect(calls[0].sql).toMatch(/WHERE shown AND/);
    expect(calls[0].params[2]).toEqual(['user_staff1']);
  });

  test('usage reads chat_turns users and conversations by updated_at', async () => {
    const sqls = [];
    const runQuery = async (sql) => { sqls.push(sql); return { configured: true, rows: [{ n: 4 }] }; };
    expect(await D.collectUsage(D.weekBounds('2026-09-28'), runQuery)).toEqual({ chatUsers: 4, conversations: 4 });
    expect(sqls[0]).toMatch(/count\(DISTINCT user_id\)[\s\S]*FROM chat_turns/);
    expect(sqls[1]).toMatch(/FROM conversations[\s\S]*updated_at >= \$1/);
  });

  test('not configured → null', async () => {
    const off = async () => ({ configured: false });
    expect(await D.collectUsage(D.weekBounds('2026-09-28'), off)).toBeNull();
    expect(await D.collectExchanges(D.weekBounds('2026-09-28'), off)).toBeNull();
  });

  test('week issues come from Last seen, most-seen first', () => {
    const rows = [
      { name: 'Old', lastSeen: '2026-09-20', count: 9 },
      { name: 'A', lastSeen: '2026-09-28', count: 2, status: 'new' },
      { name: 'B', lastSeen: '2026-10-04', count: 5, status: 'being fixed' },
      { name: 'Next week', lastSeen: '2026-10-05', count: 1 },
      { name: 'Bad date', lastSeen: 'Oct 1', count: 3 }
    ];
    expect(D.weekIssues(rows, '2026-09-28').map(r => r.name)).toEqual(['B', 'A']);
  });
});

const msg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const LONG_REPLY = 'The Canada Summer Jobs program closed for this year and the next intake opens in late November';

describe('exchanges', () => {
  test('each client message is paired with the reply after it, or none', () => {
    const out = D.exchangesOf([msg('user', 'q1'), msg('assistant', 'a1'), msg('user', 'q2'), msg('user', 'q3'), msg('assistant', 'a3')]);
    expect(out).toEqual([{ question: 'q1', reply: 'a1' }, { question: 'q2', reply: null }, { question: 'q3', reply: 'a3' }]);
  });

  test('outcome tallies travel per conversation; unlinked failures are counted', async () => {
    const calls = [];
    const runQuery = async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM conversations/.test(sql)) return { configured: true, rows: [{ id: 11, user_id: 'user_a', messages: [msg('user', 'q1'), msg('assistant', 'a1')] }, { id: 12, user_id: 'user_b', messages: [msg('user', 'q2')] }] };
      if (/GROUP BY conversation_id, outcome/.test(sql)) return { configured: true, rows: [{ conversation_id: 12, outcome: 'error', n: 1 }, { conversation_id: 12, outcome: 'completed', n: 2 }] };
      return { configured: true, rows: [{ n: 3 }] };
    };
    const out = await D.collectExchanges(D.weekBounds('2026-09-28'), runQuery);
    expect(out.total).toBe(2);
    expect(out.unlinkedFailed).toBe(3);
    expect(out.exchanges).toEqual([
      { question: 'q1', reply: 'a1', conversation: 1, userId: 'user_a', tally: '', turnFailed: false, id: 1 },
      { question: 'q2', reply: null, conversation: 2, userId: 'user_b', tally: '2 completed, 1 error', turnFailed: true, id: 2 }
    ]);
    expect(calls[0].sql).toMatch(/SELECT id, user_id, messages/);
    expect(calls[1].params[2]).toEqual([11, 12]);
    expect(calls[2].sql).toMatch(/conversation_id IS NULL/);
    expect(calls[2].params[2]).toEqual(expect.arrayContaining(['error', 'max_rounds', 'no_answer', 'input_guard']));
    expect(calls[2].params[3]).toEqual(['user_staff1']);
  });

  test('the budget keeps the newest exchanges and renumbers them', () => {
    const ex = Array.from({ length: 30 }, (_, i) => ({ question: `q${i}`.padEnd(300, '.'), reply: 'r'.repeat(600), conversation: 1, tally: '' }));
    const kept = D.fitBudget(ex);
    expect(kept.length).toBeLessThan(30);
    expect(kept[kept.length - 1].question.startsWith('q29')).toBe(true);
    expect(kept[0].id).toBe(1);
    const chars = kept.reduce((n, e) => n + e.question.length + e.reply.length + 40, 0);
    expect(chars).toBeLessThanOrEqual(D.EXCHANGE_BUDGET_CHARS);
  });

  test('the model input carries replies, missing replies, tallies and unlinked failures', () => {
    const text = D.exchangesText({ unlinkedFailed: 2, exchanges: [
      { id: 1, question: 'q1', reply: 'a1', conversation: 1, tally: '1 completed' },
      { id: 2, question: 'q2', reply: null, conversation: 2, tally: '1 error' }
    ] });
    expect(text).toContain('Conversation 1 — turns logged this week: 1 completed');
    expect(text).toContain('1. CLIENT: q1\n   REPLY: a1');
    expect(text).toContain('2. CLIENT: q2\n   REPLY: (no reply recorded)');
    expect(text).toContain('Failed turns this week not linked to any conversation: 2');
  });
});

describe('the themes call', () => {
  const exchanges = [
    { id: 1, question: `Hi I'm ${SECRET}, any hiring grants?`, reply: `Sure ${SECRET}, here are three hiring grants`, conversation: 1, tally: '1 completed' },
    { id: 2, question: 'Is Canada Summer Jobs open right now for small businesses in BC?', reply: LONG_REPLY, conversation: 2, tally: '1 completed' },
    { id: 3, question: 'How much is SWPP?', reply: null, conversation: 3, tally: '1 error' }
  ];

  test('no chats → no call', async () => {
    const createMessage = jest.fn();
    expect(await D.summariseExchanges({ exchanges: [], unlinkedFailed: 0 }, createMessage)).toEqual({ status: 'none' });
    expect(createMessage).not.toHaveBeenCalled();
  });

  test('a failed call is reported, not thrown', async () => {
    const createMessage = async () => { throw Object.assign(new Error('x'), { status: 529 }); };
    expect(await D.summariseExchanges({ exchanges, unlinkedFailed: 0 }, createMessage)).toEqual({ status: 'failed', code: '529' });
  });

  test('ONE call, and it carries the replies and outcomes', async () => {
    const createMessage = jest.fn(async () => ({ content: [{ type: 'tool_use', name: 'weekly_themes', input: { themes: [], questions: [], worth_a_look: {} } }] }));
    await D.summariseExchanges({ exchanges, unlinkedFailed: 4 }, createMessage);
    expect(createMessage).toHaveBeenCalledTimes(1);
    const user = createMessage.mock.calls[0][0].messages[0].content;
    expect(user).toContain(LONG_REPLY);
    expect(user).toContain('(no reply recorded)');
    expect(user).toContain('turns logged this week: 1 error');
    expect(user).toContain('not linked to any conversation: 4');
    const system = createMessage.mock.calls[0][0].system;
    expect(system).toMatch(/failed_reply[\s\S]*missed_question[\s\S]*pushed_back[\s\S]*handled_well/);
    expect(system).toMatch(/has each client's profile \(company name, location, industry\)/);
    expect(system).toMatch(/never treat it as a hallucination/);
    expect(system).toMatch(/never include ANY company or person name/);
    expect(system).toMatch(/ONE sentence of at most 25 words/);
  });

  test('cleanThemes keeps valid ids once, puts leftovers in Other, shows only rewrites', () => {
    const raw = {
      themes: [
        { name: 'Hiring', takeaway: 'Wanted hiring money', example_id: 1, question_ids: [1, 99] },
        { name: 'Dup', takeaway: 'x', example_id: 1, question_ids: [1] },
        { name: 'Status', takeaway: 'Is it open', example_id: 2, question_ids: [2] }
      ],
      questions: [{ id: 1, text: 'Hi I\'m [name] at [company], any hiring grants?' }, { id: 2, text: 'Is Canada Summer Jobs open?' }],
      worth_a_look: { exchange_id: 1, category: 'handled_well', why: 'The reply listed three hiring grants and offered a call.' }
    };
    const out = D.cleanThemes(raw, exchanges);
    expect(out.themes.map(t => t.name)).toEqual(['Hiring', 'Status', 'Other']);
    expect(out.themes[0].questions).toEqual(['Hi I\'m [name] at [company], any hiring grants?']);
    expect(out.themes[2].questions).toEqual(['(not rewritten — left out)']);
    expect(out.themes[2].example).toBeNull();
    expect(out.worthALook).toEqual({ label: 'Handled well', question: 'Hi I\'m [name] at [company], any hiring grants?', why: 'The reply listed three hiring grants and offered a call.' });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  test('worth-a-look: unknown exchange, unknown category or a guessing why is dropped', () => {
    const base = { themes: [], questions: [{ id: 3, text: 'How much is SWPP?' }] };
    const pick = (w) => D.cleanThemes({ ...base, worth_a_look: w }, exchanges).worthALook;
    expect(pick({ exchange_id: 3, category: 'failed_reply', why: 'No reply was recorded and the turn errored.' }))
      .toEqual({ label: 'Reply failed', question: 'How much is SWPP?', why: 'No reply was recorded and the turn errored.' });
    expect(pick({ exchange_id: 7, category: 'failed_reply', why: 'x happened.' })).toBeNull();
    expect(pick({ exchange_id: 3, category: 'interesting', why: 'x happened.' })).toBeNull();
    expect(pick({ exchange_id: 3, category: 'failed_reply', why: 'The reply may not have answered.' })).toBeNull();
  });

  test('nothing repeats a reply word for word', () => {
    const raw = {
      themes: [{ name: 'Status', takeaway: `Told them ${LONG_REPLY.slice(4, 70)}`, example_id: 2, question_ids: [2] }],
      questions: [{ id: 2, text: `Is it open? ${LONG_REPLY}` }, { id: 3, text: 'How much is SWPP?' }],
      worth_a_look: { exchange_id: 3, category: 'failed_reply', why: `It said ${LONG_REPLY.slice(0, 80)}` }
    };
    const out = D.cleanThemes(raw, exchanges);
    expect(out.themes[0].takeaway).toBe(D.WITHHELD);
    expect(out.themes[0].questions).toEqual(['(not rewritten — left out)']);
    expect(out.worthALook).toBeNull();
    expect(JSON.stringify(out)).not.toContain('next intake opens in late November');
  });

  test('quotesSource needs 8 consecutive words', () => {
    expect(D.quotesSource('closed for this year and the next intake', [LONG_REPLY])).toBe(true);
    expect(D.quotesSource('closed this year; next intake in November', [LONG_REPLY])).toBe(false);
  });
});

describe('names, labels and takeaway length', () => {
  const profileNames = ['Zentrix Robotics Inc.'];
  const ex = [
    { id: 1, question: 'Which hiring grants fit us?', reply: 'Hi Priya! For Zentrix Robotics in Surrey, these three hiring grants fit.', conversation: 1, tally: '1 completed', turnFailed: false },
    { id: 2, question: 'Is CanExport open?', reply: 'CanExport is open until March.', conversation: 2, tally: '1 completed', turnFailed: false },
    { id: 3, question: 'How much is SWPP?', reply: 'SWPP covers up to 70% of wages.', conversation: 3, tally: '1 completed, 1 error', turnFailed: true }
  ];
  const rewrites = [{ id: 1, text: 'Which hiring grants fit us?' }, { id: 2, text: 'Is CanExport open?' }, { id: 3, text: 'How much is SWPP?' }];
  const clean = (worth, themes = []) => D.cleanThemes({ themes, questions: rewrites, worth_a_look: worth }, ex, { profileNames });

  test('a profile company name from a reply never appears in the why', () => {
    expect(clean({ exchange_id: 1, category: 'handled_well', why: 'The reply tailored three hiring grants to Zentrix and its location.' }).worthALook).toBeNull();
    expect(clean({ exchange_id: 1, category: 'handled_well', why: 'The reply tailored three hiring grants to Zentrix Robotics.' }).worthALook).toBeNull();
    expect(clean({ exchange_id: 1, category: 'handled_well', why: 'The reply greeted Priya and listed three hiring grants.' }).worthALook).toBeNull();
    expect(clean({ exchange_id: 1, category: 'handled_well', why: 'The reply tailored three hiring grants to the client\'s company and location.' }).worthALook)
      .toEqual({ label: 'Handled well', question: 'Which hiring grants fit us?', why: 'The reply tailored three hiring grants to the client\'s company and location.' });
  });

  test('theme names and takeaways naming a client are withheld', () => {
    const out = clean({}, [
      { name: 'Zentrix hiring', takeaway: 'Hiring grants were matched to the client.', example_id: 1, question_ids: [1] },
      { name: 'Status', takeaway: 'Priya asked whether programs are open.', example_id: 2, question_ids: [2, 3] }
    ]);
    expect(out.themes[0].name).toBe(D.WITHHELD_NAME);
    expect(out.themes[0].takeaway).toBe('Hiring grants were matched to the client.');
    expect(out.themes[1].takeaway).toBe(D.WITHHELD_NAME);
    expect(JSON.stringify(out)).not.toMatch(/Zentrix|Priya/);
  });

  test('a rewrite still carrying the profile company name is not shown', () => {
    const out = D.cleanThemes({ themes: [{ name: 'Fit', takeaway: 'Fit questions.', example_id: 1, question_ids: [1] }], questions: [{ id: 1, text: 'Which grants fit Zentrix Robotics?' }], worth_a_look: {} }, ex.slice(0, 1), { profileNames });
    expect(out.themes[0].questions).toEqual(['(not rewritten — left out)']);
  });

  test('the label matches the recorded outcome, not the model\'s wording', () => {
    expect(D.worthLabel('failed_reply', { reply: null })).toBe('Reply failed');
    expect(D.worthLabel('failed_reply', { reply: 'x', turnFailed: true })).toBe('Reply failed');
    expect(D.worthLabel('failed_reply', { reply: 'x', turnFailed: false })).toBe('Missed the question');
    expect(D.worthLabel('missed_question', { reply: 'x', turnFailed: true })).toBe('Missed the question');
    expect(D.worthLabel('pushed_back', { reply: 'x' })).toBe('Client pushed back');
    expect(D.worthLabel('handled_well', { reply: 'x' })).toBe('Handled well');
    expect(D.worthLabel('handled_well', { reply: null })).toBeNull();
    expect(D.worthLabel('interesting', { reply: 'x' })).toBeNull();
    expect(clean({ exchange_id: 2, category: 'failed_reply', why: 'The reply gave a closing month but no intake date.' }).worthALook.label).toBe('Missed the question');
    expect(clean({ exchange_id: 3, category: 'failed_reply', why: 'One turn in this chat errored before the wage figure was given.' }).worthALook.label).toBe('Reply failed');
  });

  test('takeaways are whole sentences: no "…", the second sentence dropped when over the limit', () => {
    const long = 'Clients mostly asked which hiring grants they qualify for and how quickly funds arrive after approval. They also asked about stacking programs together and about deadlines.';
    const runOn = 'Clients asked about hiring grants wage subsidies training programs export funding equipment upgrades and research credits across many provinces and sectors without stopping once';
    const out = clean({}, [
      { name: 'Hiring', takeaway: long, example_id: 1, question_ids: [1] },
      { name: 'Everything', takeaway: runOn, example_id: 2, question_ids: [2, 3] }
    ]);
    expect(out.themes[0].takeaway).toBe('Clients mostly asked which hiring grants they qualify for and how quickly funds arrive after approval.');
    expect(out.themes[1].takeaway).toBe(runOn);
    for (const t of out.themes) expect(t.takeaway.endsWith('…')).toBe(false);
  });

  test('fitSentences keeps whole sentences within the limit', () => {
    expect(D.fitSentences('One two three. Four five six.', 6)).toBe('One two three. Four five six.');
    expect(D.fitSentences('One two three. Four five six.', 5)).toBe('One two three.');
    expect(D.fitSentences('  spaced   out   text  ', 25)).toBe('spaced out text');
  });
});

// ----------------------------------------------------------------------------
// The whole run
// ----------------------------------------------------------------------------

function fakeDeps({ questions = true, claimed = new Set() } = {}) {
  const posted = [];
  const tabs = [];
  const writes = [];
  const msg = (role, text) => ({ role, content: [{ type: 'text', text }] });
  const deps = {
    collectUsage: jest.fn(async (w) => (w.start.toISOString().startsWith('2026-09-28')
      ? { chatUsers: 3, conversations: 4 } : { chatUsers: 0, conversations: 1 })),
    collectExchanges: jest.fn(async () => (questions
      ? { unlinkedFailed: 1, total: 2, exchanges: [
        { id: 1, question: `I'm ${SECRET}, hiring grants?`, reply: `Hi ${SECRET}! Here are three hiring grants for you.`, conversation: 1, userId: 'user_a', tally: '1 completed' },
        { id: 2, question: 'Is CanExport open?', reply: null, conversation: 2, tally: '1 error' }
      ] }
      : { unlinkedFailed: 0, total: 0, exchanges: [] })),
    collectGrantMatches: jest.fn(async (w) => (w.start.toISOString().startsWith('2026-09-28')
      ? [{ grantId: 1027, companies: 4 }, { grantId: 5, companies: 1 }]
      : [{ grantId: 1027, companies: 3 }])),
    createMessage: jest.fn(async () => ({
      content: [{
        type: 'tool_use', name: 'weekly_themes', input: {
          themes: [{ name: 'Hiring', takeaway: 'Hiring money', example_id: 1, question_ids: [1] }, { name: 'Status', takeaway: 'Open or not', example_id: 2, question_ids: [2] }],
          questions: [{ id: 1, text: 'I\'m [name] at [company], hiring grants?' }, { id: 2, text: 'Is CanExport open?' }],
          worth_a_look: { exchange_id: 2, category: 'failed_reply', why: 'The turn errored and no reply was recorded.' }
        }
      }]
    })),
    oracleQuery: jest.fn(async (sql, params) => {
      if (/FROM users/.test(sql)) return { rows: [{ id: 42 }] };
      if (/gg3_grants/.test(sql)) return { rows: [{ id: 1027, grant_name: 'Career Ready SWPP' }] };
      if (/pulse_alert_state/.test(sql)) {
        if (claimed.has(params[0])) return { rows: [] };
        claimed.add(params[0]);
        return { rows: [{ alert_key: params[0] }] };
      }
      throw new Error('unexpected query');
    }),
    fetchProfile: jest.fn(async () => ({ status: 200, companyName: 'Acme Widgets' })),
    getSubscribers: jest.fn(async () => [{ email: 'chris@granted.ca', dmSpace: 'spaces/dm1' }]),
    lookupSubscribers: jest.fn(async (envVar, env) => (String(env[envVar]).endsWith('@granted.ca') ? [{ email: env[envVar], dmSpace: 'spaces/dm9' }] : [])),
    post: jest.fn(async (space, message) => { posted.push({ space, message }); return true; }),
    readSheet: jest.fn(async () => ({ success: true, data: { values: [
      ['Chat times out', '2026-09-01', '2026-10-02', '6', '', 'Jason (app/UI)', 'being fixed', '', 'Oracle-detected'],
      ['Old issue', '2026-08-01', '2026-08-02', '9', '', 'Chris (AI behaviour)', 'done', '', 'Oracle-detected']
    ] } })),
    prepareTab: jest.fn(async (userId, args) => { tabs.push(args.title); return { success: true, data: { sheet_id: 777 } }; }),
    updateSheet: jest.fn(async (userId, args) => { writes.push(args); return { success: true }; })
  };
  return { deps, posted, tabs, writes, claimed };
}

const card = (m) => m.cardsV2[0].card;
const section = (m, header) => card(m).sections.find(s => s.header === header).widgets;
const texts = (widgets) => widgets.map(w => w.textParagraph?.text ?? w.decoratedText?.text);

/** A built digest, as buildDigest returns it. */
function sampleDigest(overrides = {}) {
  return {
    monday: '2026-09-28',
    sunday: '2026-10-04',
    usage: { chatUsers: 3, conversations: 4 },
    priorUsage: { chatUsers: 0, conversations: 1 },
    exchangesTotal: 2,
    exchangesRead: 2,
    themes: {
      status: 'ok',
      themes: [{ name: 'Hiring', takeaway: 'Hiring money.', example: 'Any hiring grants?', questions: ['Any hiring grants?'] }],
      worthALook: { label: 'Reply failed', question: 'Is CanExport open?', why: 'The turn errored and no reply was recorded.' }
    },
    grants: [{ grantId: 1027, name: 'Career Ready SWPP', companies: 4 }],
    errors: { ok: true, issues: [] },
    ...overrides
  };
}

describe('grant change vs the week before', () => {
  test('up, down, unchanged and new this week', () => {
    expect(D.grantChange(4, 3)).toBe('(+1, +33% vs week before)');
    expect(D.grantChange(2, 4)).toBe('(−2, −50% vs week before)');
    expect(D.grantChange(3, 3)).toBe('(no change)');
    expect(D.grantChange(2, 0)).toBe('(new this week)');
    expect(D.grantChange(2, undefined)).toBe('(new this week)');
  });

  test('the week before is matched by grant id; missing means 0', () => {
    expect(D.withPriorWeek([{ grantId: 1, companies: 4 }, { grantId: 2, companies: 1 }], [{ grantId: 1, companies: 3 }, { grantId: 9, companies: 7 }]))
      .toEqual([{ grantId: 1, companies: 4, priorCompanies: 3 }, { grantId: 2, companies: 1, priorCompanies: 0 }]);
  });

  test('card and printout show the change on each top grant', () => {
    const d = sampleDigest({ grants: [
      { grantId: 1, name: 'Up', companies: 4, priorCompanies: 3 },
      { grantId: 2, name: 'Down', companies: 2, priorCompanies: 4 },
      { grantId: 3, name: 'Same', companies: 3, priorCompanies: 3 },
      { grantId: 4, name: 'Fourth', companies: 1, priorCompanies: 0 }
    ] });
    const c = D.digestCard(d, { sheetId: 'sheet123' })[0].card;
    expect(c.sections.find(s => s.header === 'Most-matched grants').widgets.map(w => w.textParagraph.text)).toEqual([
      'Up — matched to 4 companies (+1, +33% vs week before)',
      'Down — matched to 2 companies (−2, −50% vs week before)',
      'Same — matched to 3 companies (no change)'
    ]);
    const text = D.formatDigest(d, { sheetId: 'sheet123' });
    expect(text).toContain('**Most-matched grants**');
    expect(text).toContain('• Down — matched to 2 companies (−2, −50% vs week before)');
    expect(D.digestRows(d).find(r => r[1] === 'Fourth')).toEqual([4, 'Fourth', 1, 0, 'new this week']);
  });
});

describe('the card', () => {
  test('escapes every piece of text', () => {
    const d = sampleDigest({ themes: { status: 'ok', themes: [{ name: '<script>x</script>', takeaway: 'a & b', example: null, questions: ['q'] }], worthALook: null } });
    const json = JSON.stringify(D.digestCard(d, { sheetId: 'sheet123' }));
    expect(json).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(json).not.toContain('<script>');
    expect(json).toContain('a &amp; b');
  });

  test('test sends say so in the title and the notification; the button opens the sheet when no tab id is known', () => {
    const d = sampleDigest();
    const c = D.digestCard(d, { sheetId: 'sheet123', test: true })[0].card;
    expect(c.header.title).toBe('🧪 Test — GetGranted weekly');
    expect(D.digestFallback(d, { test: true })).toBe('🧪 Test — GetGranted weekly — Sep 28 to Oct 4');
    expect(c.sections.at(-1).widgets[0].buttonList.buttons[0].onClick.openLink.url).toBe('https://docs.google.com/spreadsheets/d/sheet123');
  });

  test('the plain-text form stays for the dry-run printout', () => {
    const text = D.formatDigest(sampleDigest(), { sheetId: 'sheet123' });
    for (const h of ['**Usage**', '**What clients asked**', '**Most-matched grants**', '**Errors this week**', '**Worth a look**']) expect(text).toContain(h);
    expect(text).toContain('Reply failed: "Is CanExport open?" — The turn errored and no reply was recorded.');
  });
});

describe('runWeeklyDigest', () => {
  test('sends one card: five sections in order, one widget per item, a button to the tab', async () => {
    const f = fakeDeps();
    const out = await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    expect(out).toEqual({ status: 'sent', sent: 1, tab: 'written' });

    const m = f.posted[0].message;
    expect(m.fallbackText).toBe('GetGranted weekly — Sep 28 to Oct 4');
    expect(card(m).header).toEqual({ title: 'GetGranted weekly', subtitle: 'Sep 28 – Oct 4' });
    expect(card(m).sections.filter(s => s.header).map(s => s.header))
      .toEqual(['Usage', 'What clients asked', 'Most-matched grants', 'Errors this week', 'Worth a look']);

    const usage = section(m, 'Usage');
    expect(usage.map(w => w.decoratedText.topLabel)).toEqual(['Chat users', 'Conversations']);
    expect(usage[0].decoratedText.text).toBe('3 (+3, — vs week before)');
    expect(texts(section(m, 'What clients asked'))).toEqual([
      '<b>Hiring</b> (1)<br>Hiring money<br><i>"I\'m [name] at [company], hiring grants?"</i>',
      '<b>Status</b> (1)<br>Open or not<br><i>"Is CanExport open?"</i>'
    ]);
    expect(texts(section(m, 'Most-matched grants'))).toEqual([
      'Career Ready SWPP — matched to 4 companies (+1, +33% vs week before)',
      'grant #5 — matched to 1 company (new this week)'
    ]);
    expect(JSON.stringify(m)).not.toMatch(/"header":"Grants"/);
    expect(f.deps.collectGrantMatches).toHaveBeenCalledTimes(2);
    const grantRows = f.writes[0].values;
    const head = grantRows.findIndex(r => r[0] === 'MOST-MATCHED GRANTS (distinct companies, shown matches)');
    expect(grantRows[head + 1]).toEqual(['Grant ID', 'Grant', 'Companies', 'Week before', 'Change']);
    expect(grantRows[head + 2]).toEqual([1027, 'Career Ready SWPP', 4, 3, '+1, +33% vs week before']);
    expect(grantRows[head + 3]).toEqual([5, 'grant #5', 1, 0, 'new this week']);
    expect(texts(section(m, 'Errors this week'))).toEqual(['1 issue seen this week', '<b>Chat times out</b> — being fixed — seen 6 times in total']);
    expect(texts(section(m, 'Worth a look'))).toEqual(['<b>Reply failed</b><br>"Is CanExport open?"<br>The turn errored and no reply was recorded.']);
    const button = card(m).sections.at(-1).widgets[0].buttonList.buttons[0];
    expect(button.text).toBe('Open detail sheet');
    expect(button.onClick.openLink.url).toBe('https://docs.google.com/spreadsheets/d/sheet123/edit#gid=777');

    expect(f.tabs).toEqual(['Digest 2026-09-28']);
    expect(f.writes[0].range).toBe("'Digest 2026-09-28'!A1");
    expect(f.writes[0].value_input_option).toBe('RAW');
    expect(f.deps.createMessage).toHaveBeenCalledTimes(1);
    expect(f.deps.fetchProfile).toHaveBeenCalledTimes(1);
    const everything = JSON.stringify(f.posted) + JSON.stringify(f.writes);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toMatch(/Jane|Doe|Acme/);
    expect(JSON.stringify(m)).not.toContain('…');
  });

  test('a quiet week still sends, with no model call', async () => {
    const f = fakeDeps({ questions: false });
    await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    expect(f.deps.createMessage).not.toHaveBeenCalled();
    expect(texts(section(f.posted[0].message, 'What clients asked'))).toEqual(['No client chats this week.']);
  });

  test('once per week: a second run is already_sent and posts nothing', async () => {
    const f = fakeDeps();
    await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    const again = await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    expect(again).toEqual({ status: 'already_sent' });
    expect(f.posted).toHaveLength(1);
    expect(f.claimed.has('weekly_digest:2026-09-28')).toBe(true);
  });

  test('sheet unreadable → card still goes, says so, no tab, button opens the sheet', async () => {
    const f = fakeDeps();
    f.deps.oracleQuery.mockImplementation(async (sql, params) => {
      if (/FROM users/.test(sql)) return { rows: [] };
      if (/gg3_grants/.test(sql)) return { rows: [] };
      return { rows: [{ alert_key: params[0] }] };
    });
    const out = await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    expect(out.status).toBe('sent');
    expect(out.tab).toBe('not_written');
    const m = f.posted[0].message;
    expect(texts(section(m, 'Errors this week'))).toEqual(['Errors sheet unavailable (code: owner_not_found).']);
    expect(card(m).sections.at(-1).widgets[0].buttonList.buttons[0].onClick.openLink.url).toBe('https://docs.google.com/spreadsheets/d/sheet123');
    expect(f.tabs).toEqual([]);
  });

  test('not configured → skipped, nothing scheduled', () => {
    const cron = { schedule: jest.fn() };
    expect(D.startPulseDigest(cron, { ...ENV, PULSE_DIGEST_SUBSCRIBERS: '' })).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(D.missingDigestEnv({ ...ENV, PULSE_DIGEST_SUBSCRIBERS: '' })).toEqual(['PULSE_DIGEST_SUBSCRIBERS']);
  });

  test('scheduled Mondays 08:00 Vancouver', () => {
    const cron = { schedule: jest.fn() };
    expect(D.startPulseDigest(cron, ENV)).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('0 8 * * 1', expect.any(Function), expect.objectContaining({ timezone: 'America/Vancouver', name: 'pulse-digest' }));
  });
});

describe('recording delivered digests', () => {
  const landed = (space) => ({ messageName: `${space}/messages/1`, threadName: `${space}/threads/1` });

  test('the Monday run records each recipient with the week and the lines the card showed', async () => {
    const f = fakeDeps();
    f.deps.post.mockImplementation(async (space) => landed(space));
    f.deps.recordPost = jest.fn(async () => true);
    await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    expect(f.deps.recordPost).toHaveBeenCalledTimes(1);
    const row = f.deps.recordPost.mock.calls[0][0];
    expect(row).toEqual(expect.objectContaining({
      kind: 'digest', isTest: false, recipientEmail: 'chris@granted.ca', spaceName: 'spaces/dm1',
      messageName: 'spaces/dm1/messages/1', threadName: 'spaces/dm1/threads/1'
    }));
    expect(row.periodStart.toISOString()).toBe('2026-09-28T07:00:00.000Z');
    expect(row.periodEnd.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(row.summary).toContain('**Most-matched grants**');
    expect(row.summary).not.toContain(SECRET);
  });

  test('a test send is recorded as a test', async () => {
    const f = fakeDeps();
    f.deps.post.mockImplementation(async (space) => landed(space));
    f.deps.recordPost = jest.fn(async () => true);
    await D.sendDigestTest({ email: 'writers@granted.ca', d: sampleDigest(), sheetId: 'sheet123', deps: f.deps });
    expect(f.deps.recordPost).toHaveBeenCalledWith(expect.objectContaining({ kind: 'digest', isTest: true, spaceName: 'spaces/dm9' }));
  });

  test('the dry-run path (build and print) records nothing', async () => {
    const f = fakeDeps();
    f.deps.recordPost = jest.fn();
    const built = await D.buildDigest({ monday: '2026-09-28', issueRows: [], deps: f.deps });
    D.formatDigest(built, { sheetId: 'sheet123' });
    D.digestRows(built);
    expect(f.deps.recordPost).not.toHaveBeenCalled();
    expect(f.deps.post).not.toHaveBeenCalled();
  });

  test('an undelivered card is not recorded', async () => {
    const f = fakeDeps();
    f.deps.post.mockImplementation(async () => false);
    f.deps.recordPost = jest.fn();
    await D.runWeeklyDigest({ now: MONDAY_RUN, env: ENV, deps: f.deps });
    expect(f.deps.recordPost).not.toHaveBeenCalled();
  });
});

describe('sendDigestTest', () => {
  test('posts the test card once to that one person; no claim, no tab', async () => {
    const f = fakeDeps();
    const out = await D.sendDigestTest({ email: 'writers@granted.ca', d: sampleDigest(), sheetId: 'sheet123', deps: f.deps });
    expect(out).toEqual({ sent: 1 });
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0].space).toBe('spaces/dm9');
    expect(card(f.posted[0].message).header.title).toBe('🧪 Test — GetGranted weekly');
    expect(f.posted[0].message.fallbackText).toBe('🧪 Test — GetGranted weekly — Sep 28 to Oct 4');
    expect(f.deps.lookupSubscribers).toHaveBeenCalledWith('PULSE_DIGEST_TEST_RECIPIENT', { PULSE_DIGEST_TEST_RECIPIENT: 'writers@granted.ca' });
    expect(f.deps.oracleQuery).not.toHaveBeenCalled();
    expect(f.deps.prepareTab).not.toHaveBeenCalled();
    expect(f.deps.updateSheet).not.toHaveBeenCalled();
    expect(f.deps.getSubscribers).not.toHaveBeenCalled();
  });

  test('an address the normal lookup refuses gets nothing', async () => {
    const f = fakeDeps();
    expect(await D.sendDigestTest({ email: 'someone@gmail.com', d: sampleDigest(), deps: f.deps })).toEqual({ sent: 0, code: 'not_reachable' });
    expect(f.posted).toEqual([]);
  });

  test('a failed post is reported', async () => {
    const f = fakeDeps();
    f.deps.post.mockImplementation(async () => false);
    expect(await D.sendDigestTest({ email: 'writers@granted.ca', d: sampleDigest(), deps: f.deps })).toEqual({ sent: 0, code: 'post_failed' });
  });
});
