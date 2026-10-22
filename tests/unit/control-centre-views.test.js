/**
 * control-centre Department views v2: each panel builder's shaping (columns,
 * rows, both variants, empty → rows: []), the composition (a failing source
 * fails only its panels, reads only, cached per range), and the route.
 * Fixtures and injected deps only — no DB, no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-views.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const V = await import('../../src/control-centre/views.js');
const { createViewsRouter } = await import('../../src/control-centre/views-routes.js');

beforeEach(() => { V._clearCacheForTests(); jest.spyOn(console, 'error').mockImplementation(() => {}); });

const internal = (id) => id === 81;
const C = ['2026-10-20', '2026-10-21'];
const P = ['2026-10-18', '2026-10-19'];
const cellsOf = (v) => v.rows.map((r) => r.cells);
const firstText = (v) => v.rows.map((r) => Object.values(r.cells)[0].text ?? Object.values(r.cells)[0]);

// The Grants tab's window: two live grants, matches and opens over the
// current and previous windows, one internal account (81).
const shown = (day, company_id, grant_id, times_shown = 1) => ({ day, company_id, grant_id, times_computed: 1, times_shown });
const win = () => ({
  days: C, previous_days: P,
  grants: [{ root_id: 12, title: 'CanExport SMEs', value: '250000' }, { root_id: 13, title: 'Voucher', value: 5000 }],
  matches: [
    shown('2026-10-21', 83, 12), shown('2026-10-20', 84, 12), shown('2026-10-19', 83, 13), shown('2026-10-21', 81, 13),
    shown('2026-10-21', 85, 13, 0), shown('2026-10-21', 86, 12)
  ],
  views: [
    { day: '2026-10-21', company_id: 83, grant_root_id: 12, source: 'suggested', sessions: 3 },
    { day: '2026-10-21', company_id: 83, grant_root_id: 12, source: 'advisor', sessions: 1 },
    { day: '2026-10-19', company_id: 84, grant_root_id: 12, source: 'browse', sessions: 2 },
    { day: '2026-10-21', company_id: 81, grant_root_id: 13, source: 'browse', sessions: 2 }
  ],
  signups: [{ day: '2026-10-21', company_id: 90 }, { day: '2026-10-21', company_id: 91 }, { day: '2026-10-19', company_id: 92 }, { day: '2026-10-20', company_id: 81 }],
  sessions: [], adds: [], removals: [], openedPairs: new Set(['83|12']), lastShown: [], openCards: new Map()
});
const goals = () => [
  { company_id: 83, name: 'Hire and Train People', day: '2026-10-21' },
  { company_id: 84, name: 'Hire and Train People', day: '2026-10-19' },
  { company_id: 81, name: 'Build Something New', day: '2026-10-21' },
  { company_id: 85, name: 'Domestic Growth', day: '2026-10-20' }
];
const flags = () => ({
  passed: [
    { grant_id: 1, title: 'Old', grantor: null, deadline: '2026-10-01', deadline_text: '2026-10-01', days: -20 },
    { grant_id: 2, title: 'Older', grantor: null, deadline: '2021-04-15', deadline_text: '15/04/2021', days: -2000 }
  ],
  due_soon: [{ grant_id: 12, title: 'CanExport SMEs', grantor: null, deadline: '2026-11-02', deadline_text: 'November 2, 2026', days: 12 }],
  blank: [{ grant_id: 3, title: 'Blank', grantor: null, deadline: null, deadline_text: '' }],
  unreadable: [{ grant_id: 5, title: 'Odd', grantor: null, deadline: null, deadline_text: 'Spring intake' }],
  rolling: 150, no_date: 152
});
const variant = () => ({
  industries: [
    { industry: 'Agriculture', level: 'main', clients: 3, grant_matches: 5, avg_matches: 2.5, restricted: 4, open_to_all: 9, thin: false, specifics: [] },
    { industry: 'Energy', level: 'main', clients: 0, grant_matches: 0, avg_matches: null, restricted: 2, open_to_all: 9, thin: false, specifics: [] }
  ],
  not_mapped: { industry: 'Not mapped', level: 'main', clients: 1, grant_matches: 0, avg_matches: null, restricted: null, open_to_all: 9, thin: false, specifics: [] },
  breakdowns: {
    province: [{ province: 'British Columbia', clients: 2, ran_matching: 2, avg_matches: 2, grant_matches: 4 }, { province: 'Yukon', clients: 0, ran_matching: 0, avg_matches: null, grant_matches: 0 }],
    goal_tracks: [
      { section: 'Hire or Train People', label: 'Hire or Train People', clients: 3, grants_shown_on_track: 5, empty_tracks: 1, few_tracks: 0 },
      { section: 'funding_matches', label: 'All goals', clients: 3, grants_shown_on_track: 12, empty_tracks: 0, few_tracks: 0 },
      { section: 'Domestic Growth', label: 'Domestic Growth', clients: 2, grants_shown_on_track: 1, empty_tracks: 1, few_tracks: 1 }
    ]
  }
});
const cov = () => ({
  clients_variant: variant(), all_variant: variant(),
  clients: { 83: { industries: ['Agriculture'] }, 84: { industries: ['Agriculture'] }, 86: { industries: ['Agriculture'] }, 81: { industries: ['Agriculture'] } },
  grants: {}
});
const list = () => ({ current: { from: C[0], to: C[1] }, companies: [
  { id: 83, name: 'NYA Ventures', size: '5-10 employees', revenue: '$500k-$1M CAD', plan: 'starter', plan_status: 'active', signed_up: '2026-09-14', last_active: '2026-10-21', grant_matches: 1, cards_opened: 4, chats: 1 },
  { id: 84, name: 'Quiet', size: null, revenue: null, plan: null, signed_up: '2026-09-01', last_active: null, grant_matches: 1, cards_opened: 0, chats: 0 },
  { id: 87, name: 'Browser', size: 'Just me', revenue: null, plan: 'lite', signed_up: '2026-09-01', last_active: null, grant_matches: 0, cards_opened: 1, chats: 0 },
  { id: 90, name: 'New Co', size: null, revenue: null, plan: 'starter', signed_up: '2026-10-20', last_active: '2026-10-22', grant_matches: 0, cards_opened: 0, chats: 0 },
  { id: 91, name: 'Newer Co', size: null, revenue: null, plan: null, signed_up: '2026-10-21', last_active: null, grant_matches: 0, cards_opened: 0, chats: 0 },
  { id: 92, name: 'Earlier Co', size: null, revenue: null, plan: null, signed_up: '2026-10-19', last_active: null, grant_matches: 0, cards_opened: 0, chats: 0 },
  { id: 81, name: 'Maximizer', size: null, revenue: null, plan: null, signed_up: '2026-10-20', last_active: '2026-10-21', grant_matches: 5, cards_opened: 2, chats: 0 }
] });
const chatRows = () => [
  { company_id: 83, clerk_id: 'user_a', conversation_id: 290, turn_index: 1, day: '2026-10-21', question: 'How do I build a watchlist?', theme: 'Watchlist and saved grants', answer: 'not_answered', unanswered_reason: 'no_answer', unmet_need: null, cards_shown: [12], grants_named: [13] },
  { company_id: 83, clerk_id: 'user_a', conversation_id: 290, turn_index: 2, day: '2026-10-21', question: 'Can you write my CanExport application?', theme: 'Application help', answer: 'partly', unanswered_reason: 'left_after_bad_reply', unmet_need: 'Consulting or application writing', cards_shown: [], grants_named: [] },
  { company_id: 83, clerk_id: 'user_a', conversation_id: 290, turn_index: 3, day: '2026-10-21', question: 'Is the BC Launch Online grant available?', theme: 'Finding grants for my business', answer: 'answered', unanswered_reason: null, unmet_need: "A grant we don't carry", cards_shown: [], grants_named: [] },
  { company_id: null, clerk_id: 'user_staff', conversation_id: 291, turn_index: 0, day: '2026-10-20', question: 'Where do I upload documents?', theme: 'Company profile and account', answer: 'answered', unanswered_reason: 'asked_for_person', unmet_need: 'Grant writing help', cards_shown: [], grants_named: [] },
  { company_id: 84, clerk_id: 'user_b', conversation_id: 292, turn_index: 0, day: '2026-10-19', question: 'What loans are there?', theme: 'Loans and financing', answer: 'answered', unanswered_reason: null, unmet_need: 'Loans', cards_shown: [], grants_named: [] },
  { company_id: 81, clerk_id: 'user_m', conversation_id: 300, turn_index: 0, day: '2026-10-21', question: 'How do I apply?', theme: 'Application help', answer: 'answered', unanswered_reason: null, unmet_need: null, cards_shown: [12], grants_named: [] },
  { company_id: null, clerk_id: 'user_z', conversation_id: 301, turn_index: 0, day: '2026-10-20', question: 'Program X?', theme: 'Other', answer: 'answered', unanswered_reason: null, unmet_need: 'A program we do not carry', cards_shown: [], grants_named: [] }
];
const names = () => new Map([[83, 'NYA Ventures'], [84, 'Quiet']]);
const internalClerks = () => new Set(['user_staff']);

describe('Marketing', () => {
  test('chat themes: themes with questions in the range, change and an example; a note when the review is not set up', () => {
    const chat = { store: { ok: true }, themes: [
      { theme: 'Hiring', current: 4, previous: 1, delta: 3, examples: [{ question: 'Wage subsidies for a junior dev?' }] },
      { theme: 'Old', current: 0, previous: 2, delta: -2, examples: [] }
    ] };
    const p = V.chatThemesPanel(chat);
    expect(p.clients).toBe(p.all);
    expect(p.clients.columns.map((c) => c.kind)).toEqual(['link', 'num', 'delta', 'text']);
    expect(cellsOf(p.clients)).toEqual([{ theme: { text: 'Hiring', hash: '#chat' }, questions: 4, change: 3, example: 'Wage subsidies for a junior dev?' }]);
    expect(p.note).toBeUndefined();
    expect(V.chatThemesPanel({ store: { ok: false }, themes: [] }).note).toMatch(/isn't set up/);
    expect(V.chatThemesPanel({ store: { ok: true }, themes: [] }).clients.rows).toEqual([]);
  });

  test('how-to questions: unanswered rows whose wording asks how; internal left out by company or Clerk id', () => {
    const p = V.howtoPanel(chatRows(), names(), internalClerks(), internal);
    expect(cellsOf(p.clients)).toEqual([{ question: { text: 'How do I build a watchlist?', hash: '#chat/290' }, theme: 'Watchlist and saved grants',
      company: { text: 'NYA Ventures', hash: '#companies/83' }, day: '2026-10-21' }]);
    expect(p.clients.rows[0].href).toBe('#chat/290');
    expect(firstText(p.all)).toEqual(['How do I build a watchlist?', 'Where do I upload documents?']);
    expect(p.all.rows[1].cells.company).toEqual({ text: 'Not recorded', hash: null });
  });

  test('most matched and most opened: from the Grants tab rows, both variants', () => {
    const m = V.mostMatchedPanel(win(), internal);
    expect(cellsOf(m.clients)).toEqual([{ grant: { text: 'CanExport SMEs', hash: '#grants/12' }, clients_matched: 3, opens: 4, saves: 0 }]);
    expect(firstText(m.all)).toEqual(['CanExport SMEs', 'Voucher']);
    expect(m.all.rows[1].cells).toMatchObject({ clients_matched: 1, opens: 2 });
    const o = V.mostOpenedPanel(win(), internal);
    expect(cellsOf(o.clients)).toEqual([{ grant: { text: 'CanExport SMEs', hash: '#grants/12' }, opens: 4, clients_matched: 3, bounced: 0 }]);
    expect(firstText(o.all)).toEqual(['CanExport SMEs', 'Voucher']);
  });

  test('trending grants: clients matched now vs before, five up then five down, flagged', () => {
    const rows = V.grantTrends(win(), (id) => !internal(id));
    expect(rows).toEqual(expect.arrayContaining([
      { grant_id: 12, title: 'CanExport SMEs', before: 0, now: 3, change: 3, opens_before: 2, opens_now: 4 },
      { grant_id: 13, title: 'Voucher', before: 1, now: 0, change: -1, opens_before: 0, opens_now: 0 }
    ]));
    const p = V.trendingGrantsPanel(win(), internal);
    expect(p.clients.rows.map((r) => [r.cells.grant.text, r.cells.change, r.flag])).toEqual([['CanExport SMEs', 3, 'up'], ['Voucher', -1, 'down']]);
    // With the internal account in, Voucher is 1 → 1: no change, so it drops out.
    expect(p.all.rows.map((r) => r.cells.grant.text)).toEqual(['CanExport SMEs']);
  });

  test('timely: went live in the range or due within 30 days, ranked by clients matched', () => {
    const changed = { added: [{ grant_id: 13, title: 'Voucher', at: '2026-10-20T17:00:00Z' }] };
    const p = V.timelyPanel(changed, flags(), win(), internal);
    expect(cellsOf(p.clients)).toEqual([
      { grant: { text: 'CanExport SMEs', hash: '#grants/12' }, why: 'Due Nov 2, 2026 (12 days left)', clients_matched: 3, opens: 4 },
      { grant: { text: 'Voucher', hash: '#grants/13' }, why: 'Went live Oct 20, 2026', clients_matched: 0, opens: 0 }
    ]);
    expect(p.all.rows[1].cells).toMatchObject({ clients_matched: 1, opens: 2 });
    expect(V.timelyPanel({ added: [] }, { due_soon: [] }, win(), internal).clients.rows).toEqual([]);
  });

  test('demand by goal type: goals created now vs before, as bars', () => {
    const p = V.goalDemandPanel(goals(), C, P, internal);
    expect(p.clients).toEqual({ unit: 'goal tracks set', rows: [{ label: 'Hire and Train People', value: 1, previous: 1 }, { label: 'Domestic Growth', value: 1, previous: 0 }] });
    expect(p.all.rows.map((r) => r.label)).toEqual(['Hire and Train People', 'Build Something New', 'Domestic Growth']);
    expect(V.goalDemandPanel([], C, P, internal).clients.rows).toEqual([]);
  });

  test('demand by industry and province: clients and grant matches, rows with neither left out', () => {
    const i = V.demandIndustryPanel(cov());
    expect(cellsOf(i.clients)).toEqual([
      { industry: { text: 'Agriculture', hash: '#coverage/industry/Agriculture' }, clients: 3, grant_matches: 5, avg_matches: 2.5 },
      { industry: { text: 'Not mapped', hash: '#coverage/industry/Not%20mapped' }, clients: 1, grant_matches: 0, avg_matches: null }
    ]);
    const pr = V.demandProvincePanel(cov());
    expect(cellsOf(pr.clients)).toEqual([{ province: 'British Columbia', clients: 2, grant_matches: 4, avg_matches: 2 }]);
    expect(pr.clients.rows[0].href).toBe('#coverage');
  });

  test('how clients find grants: opens by source now vs before, every source listed', () => {
    const p = V.foundViaPanel(win(), C, P, internal);
    expect(p.clients).toEqual({ unit: 'card opens', rows: [
      { label: 'Goal tracks', value: 3, previous: 0 }, { label: 'Browse', value: 0, previous: 2 }, { label: 'Chat', value: 1, previous: 0 },
      { label: 'Watchlist', value: 0, previous: 0 }, { label: 'Other (direct links)', value: 0, previous: 0 }
    ] });
    expect(p.all.rows[1]).toEqual({ label: 'Browse', value: 2, previous: 2 });
  });

  test('totals: businesses and grants matched, cards opened, top goal type and top grant', () => {
    const p = V.totalsPanel(win(), goals(), C, internal);
    expect(p.clients.tiles).toEqual([
      { label: 'Businesses matched', n: 3 }, { label: 'Grants matched', n: 1 }, { label: 'Cards opened', n: 4 },
      { label: 'Top goal type', n: 'Domestic Growth', words: '1 goal track set' },
      { label: 'Top grant', n: 'CanExport SMEs', words: '3 clients matched', href: '#grants/12' }
    ]);
    expect(p.all.tiles.slice(0, 3).map((t) => t.n)).toEqual([4, 2, 6]);
    expect(V.totalsPanel({ ...win(), matches: [], views: [] }, [], C, internal).clients.tiles.map((t) => t.n)).toEqual([0, 0, 0, '—', '—']);
  });

  test('sign-ups: a per-day series now vs before, internal accounts left out of clients', () => {
    const p = V.signupsPanel(win(), C, P, internal);
    expect(p.clients).toEqual({ label: 'Sign-ups', total: 2, previous_total: 1, delta: 1,
      current: [{ day: '2026-10-20', value: 0 }, { day: '2026-10-21', value: 2 }], previous: [{ day: '2026-10-18', value: 0 }, { day: '2026-10-19', value: 1 }] });
    expect(p.all).toMatchObject({ total: 3, delta: 2 });
  });
});

describe('Research', () => {
  const items = [
    { id: '1', kind: 'grant_pattern', owner: 'research', status: 'diagnosed', grant_name: 'Green Corps', pattern_category: 'wrong_industry', stuck: true, idle_days: 6, company_id: null },
    { id: '2', kind: 'match', owner: 'research', status: 'new', grant_name: 'Voucher', company_id: 81, company_name: 'Maximizer', stuck: true, idle_days: 4 },
    { id: '3', kind: 'match', owner: 'research', status: 'closed', grant_name: 'Closed one', company_id: 83, stuck: false },
    { id: '4', kind: 'chat', owner: 'chris', status: 'new', company_id: 83, stuck: true, idle_days: 9 },
    { id: '5', kind: 'grant_deadline', owner: 'research', status: 'diagnosed', grant_name: 'Old grant', grant_root_id: 7, company_id: null, stuck: false, idle_days: 1 }
  ];

  test('flagged cards: open Research cards, stuck first; internal left out of clients', () => {
    const p = V.flaggedCardsPanel(items, internal);
    expect(p.clients.rows.map((r) => [r.cells.card.text, r.cells.type, r.cells.status, r.cells.idle, r.flag ?? null])).toEqual([
      ['Green Corps — cut for several companies (wrong industry)', 'Grant pattern', 'Diagnosed', 6, 'stuck'],
      ['Old grant — deadline passed, still live', 'Deadline', 'Diagnosed', 1, null]
    ]);
    expect(p.clients.rows[0]).toMatchObject({ href: '#review/1' });
    expect(p.all.rows.map((r) => r.cells.card.hash)).toEqual(['#review/1', '#review/2', '#review/5']);
    expect(p.all.rows[1].cells.company).toEqual({ text: 'Maximizer', hash: '#companies/81' });
  });

  test('status mismatches: past-dated live grants, oldest first, with their card or a "next sweep" note', () => {
    const p = V.statusMismatchesPanel(flags(), [{ id: '44', grant_root_id: 1, status: 'diagnosed' }]);
    expect(p.clients).toBe(p.all);
    expect(cellsOf(p.clients)).toEqual([
      { grant: { text: 'Older', hash: '#grants/2' }, deadline_text: '15/04/2021', deadline: '2021-04-15', over: 2000, card: { text: 'Filed on the next sweep', hash: null } },
      { grant: { text: 'Old', hash: '#grants/1' }, deadline_text: '2026-10-01', deadline: '2026-10-01', over: 20, card: { text: '#44 · Diagnosed', hash: '#review/44' } }
    ]);
    expect(V.statusMismatchesPanel({ passed: [] }, []).clients.rows).toEqual([]);
  });

  test('no readable deadline: blank and unreadable grants, rolling counted in the note', () => {
    const p = V.deadlineUnreadablePanel(flags());
    expect(cellsOf(p.clients)).toEqual([
      { grant: { text: 'Blank', hash: '#grants/3' }, kind: 'Blank', deadline_text: '' },
      { grant: { text: 'Odd', hash: '#grants/5' }, kind: 'Unreadable', deadline_text: 'Spring intake' }
    ]);
    expect(p.note).toBe('1 live grant with a blank deadline and 1 unreadable; 150 rolling ("Open Until Filled" and the like) are fine. Not filed as cards.');
  });

  test('upcoming deadlines: soonest first, with the range\'s matches and opens', () => {
    const p = V.upcomingDeadlinesPanel(flags(), win(), internal);
    expect(cellsOf(p.clients)).toEqual([{ grant: { text: 'CanExport SMEs', hash: '#grants/12' }, due: '2026-11-02', days_left: 12, clients_matched: 3, opens: 4 }]);
  });

  test('asked for, not carried: unmet needs for a program we don\'t carry, not loans or consulting', () => {
    const p = V.askedNotCarriedPanel(chatRows(), names(), internalClerks(), internal);
    expect(cellsOf(p.clients)).toEqual([
      { question: { text: 'Is the BC Launch Online grant available?', hash: '#chat/290' }, company: { text: 'NYA Ventures', hash: '#companies/83' }, day: '2026-10-21' },
      { question: { text: 'Program X?', hash: '#chat/301' }, company: { text: 'Not recorded', hash: null }, day: '2026-10-20' }
    ]);
    expect(p.all.rows.length).toBe(2);
  });

  test('industry coverage and goal coverage tables', () => {
    const i = V.industryCoveragePanel(cov());
    expect(i.clients.rows.map((r) => [r.cells.industry.text, r.cells.clients, r.cells.restricted, r.cells.thin])).toEqual([['Agriculture', 3, 4, ''], ['Not mapped', 1, null, ''], ['Energy', 0, 2, '']]);
    const g = V.goalCoveragePanel(cov());
    expect(g.clients.rows.map((r) => r.cells.track)).toEqual(['Domestic Growth', 'Hire or Train People', 'All goals']);
    expect(g.clients.rows[0].cells).toEqual({ track: 'Domestic Growth', clients: 2, grants_shown: 1, empty: 1, few: 1 });
  });

  test('trending industries: matched pairs by profile main industry, now vs before', () => {
    expect(V.industryTrends(win(), cov(), (id) => !internal(id))).toEqual([{ industry: 'Agriculture', before: 1, now: 3, change: 2 }]);
    const p = V.trendingIndustriesPanel(win(), cov(), internal);
    expect(p.clients.rows[0]).toEqual({ cells: { industry: { text: 'Agriculture', hash: '#coverage/industry/Agriculture' }, before: 1, now: 3, change: 2 }, href: '#coverage/industry/Agriculture', flag: 'up' });
    expect(p.all.rows[0].cells).toMatchObject({ now: 4, change: 3 });
  });

  test('ignored cards: shown to 3+ clients, ranked by how many saw them, then never opened', () => {
    const p = V.ignoredPanel(win(), internal);
    expect(cellsOf(p.clients)).toEqual([{ grant: { text: 'CanExport SMEs', hash: '#grants/12' }, displayed_clients: 3, ignored: 2, opens: 4 }]);
  });

  test('recent launches: went live or republished in the range, with matches and opens since that day', () => {
    const changed = { added: [{ grant_id: 13, title: 'Voucher', at: '2026-10-20T17:00:00Z' }], republished: [{ grant_id: 12, title: 'CanExport SMEs', at: '2026-10-21T15:00:00Z' }] };
    const p = V.recentLaunchesPanel(changed, win(), internal);
    expect(cellsOf(p.clients)).toEqual([
      { grant: { text: 'CanExport SMEs', hash: '#grants/12' }, event: 'Republished', when: '2026-10-21', clients_since: 2, opens_since: 4 },
      { grant: { text: 'Voucher', hash: '#grants/13' }, event: 'Went live', when: '2026-10-20', clients_since: 0, opens_since: 0 }
    ]);
    expect(p.all.rows[1].cells).toMatchObject({ clients_since: 1, opens_since: 2 });
    expect(V.recentLaunchesPanel({ added: [] }, win(), internal).clients.rows).toEqual([]);
  });
});

describe('Consulting/Sales', () => {
  const cards = [
    { id: '10', company_id: 83, company_name: 'NYA Ventures', status: 'diagnosed', owner: 'consulting', chat_turn_ref: 'conv:290:consulting_question', conversation_id: 290, stuck: true, idle_days: 3,
      flagged_turn_index: 1, turns: [{ turn_index: 0, client: 'Hi', assistant: 'Hello' }, { turn_index: 1, client: 'What does it entail to have your consulting team manage the application end to end?', assistant: '…', flagged: true }] },
    { id: '11', company_id: 81, company_name: 'Maximizer', status: 'in_progress', owner: 'consulting', chat_turn_ref: 'conv:300:consulting_question', conversation_id: 300, stuck: false, idle_days: 0,
      flagged_turn_index: 0, turns: [{ turn_index: 0, client: 'Internal question', assistant: 'a' }] }
  ];

  test('flaggedTurnOf: the marked turn, else by index, else the last', () => {
    expect(V.flaggedTurnOf(cards[0].turns, 0).client).toMatch(/^What does it entail/);
    expect(V.flaggedTurnOf([{ turn_index: 0, client: 'a' }, { turn_index: 1, client: 'b' }], 0).client).toBe('a');
    expect(V.flaggedTurnOf([{ turn_index: 0, client: 'a' }, { turn_index: 1, client: 'b' }], null).client).toBe('b');
    expect(V.flaggedTurnOf(null)).toBeNull();
  });

  test('consulting questions: open Consulting cards with the client\'s question and the company line', () => {
    const p = V.consultingCardsPanel(cards, list(), internal);
    expect(p.clients.rows).toEqual([{ cells: {
      company: { text: 'NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', hash: '#companies/83' },
      question: { text: 'What does it entail to have your consulting team manage the application end to end?', hash: '#review/10' },
      status: 'Diagnosed', idle: 3 }, href: '#review/10', flag: 'stuck' }]);
    expect(p.all.rows.map((r) => r.cells.company.text)).toEqual(['NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', 'Maximizer · — · — · —']);
  });

  test('help we sell: consulting or application-writing unmet needs, by company', () => {
    const p = V.helpWeSellPanel(chatRows(), list(), names(), internalClerks(), internal);
    expect(cellsOf(p.clients)).toEqual([{ company: { text: 'NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', hash: '#companies/83' },
      question: { text: 'Can you write my CanExport application?', hash: '#chat/290' }, answer: 'Partly answered · left after a bad reply', day: '2026-10-21' }]);
    expect(p.all.rows.map((r) => r.cells.company.text)).toEqual(['NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', 'Company not recorded']);
    expect(p.all.rows[1].cells.answer).toBe('Answered · asked for a person');
  });

  test('big money: grants worth $100k+ asked about in chat or opened as a card', () => {
    const p = V.bigMoneyPanel(chatRows(), win(), win().grants, list(), names(), internalClerks(), C, internal);
    expect(p.clients.rows.map((r) => [r.cells.company.text, r.cells.grant.text, r.cells.value, r.cells.how, r.cells.day, r.href])).toEqual([
      ['NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', 'CanExport SMEs', 250000, 'Asked in chat', '2026-10-21', '#chat/290'],
      ['NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', 'CanExport SMEs', 250000, 'Opened the card', '2026-10-21', '#grants/12']
    ]);
    expect(p.all.rows.length).toBe(3);
    expect(V.bigMoneyPanel([], { ...win(), views: [] }, win().grants, list(), names(), internalClerks(), C, internal).clients.rows).toEqual([]);
  });

  test('most engaged: goal tracks set, cards opened and chats, scored; no activity reads so', () => {
    const p = V.mostEngagedPanel(list(), goals(), C, internal);
    expect(cellsOf(p.clients)).toEqual([
      { company: { text: 'NYA Ventures · 5-10 employees · $500k-$1M CAD · starter', hash: '#companies/83' }, goals: 1, cards_opened: 4, chats: 1, last_active: 'Oct 21, 2026' },
      { company: { text: 'Browser · Just me · — · lite', hash: '#companies/87' }, goals: 0, cards_opened: 1, chats: 0, last_active: 'No activity yet' }
    ]);
    expect(p.all.rows.map((r) => r.cells.company.hash)).toEqual(['#companies/83', '#companies/81', '#companies/87']);
  });

  test('fast starters: signed up in the range, a goal track and a card open within 7 days', () => {
    const first = [
      { company_id: 90, first_goal: new Date('2026-10-21T18:00:00Z'), first_open: new Date('2026-10-22T18:00:00Z') },
      { company_id: 91, first_goal: new Date('2026-10-21T18:00:00Z'), first_open: null },
      { company_id: 81, first_goal: new Date('2026-10-20T18:00:00Z'), first_open: new Date('2026-10-20T19:00:00Z') }
    ];
    const p = V.fastStartersPanel(list(), first, C, internal);
    expect(cellsOf(p.clients)).toEqual([{ company: { text: 'New Co · — · — · starter', hash: '#companies/90' }, signed_up: '2026-10-20', first_goal: '2026-10-21', first_open: '2026-10-22', plan: 'starter' }]);
    expect(p.all.rows.map((r) => r.cells.company.hash)).toEqual(['#companies/81', '#companies/90']);
    expect(V.fastStartersPanel(list(), [], C, internal).clients.rows).toEqual([]);
  });
});

describe('departmentViews', () => {
  const emptyWin = () => ({ days: C, previous_days: P, grants: [], matches: [], views: [], signups: [], sessions: [], adds: [], removals: [], openedPairs: new Set(), lastShown: [], openCards: new Map() });
  const flagsOf = (grants, today) => ({ passed: grants.filter((g) => g.deadline < today).map((g) => ({ grant_id: g.root_id, title: g.title, deadline: g.deadline, deadline_text: g.deadline, days: -1 })),
    due_soon: [], blank: [], unreadable: [], rolling: 0, no_date: 0 });
  const deps = () => ({
    now: () => new Date('2026-10-21T18:00:00Z'),
    appQuery: jest.fn(async () => ({ rows: [] })),
    hubQuery: jest.fn(async () => ({ rows: [] })),
    storeQuery: jest.fn(async () => ({ rows: [] })),
    liveGrants: jest.fn(async () => [{ root_id: 1, title: 'Old', deadline: '2026-01-01', value: 1 }]),
    deadlineFlags: flagsOf,
    coverage: jest.fn(async () => { const e = new Error('nc'); e.code = 'not_configured'; throw e; }),
    changes: jest.fn(async () => ({ added: [], closed: [], removed: [], edited: [], republished: [] })),
    loadGrantWindow: jest.fn(async () => emptyWin()),
    chatOverview: jest.fn(async () => { const e = new Error('missing'); e.code = '42P01'; throw e; }),
    listItems: jest.fn(async () => []),
    companyList: jest.fn(async () => ({ current: { from: '2026-10-15', to: '2026-10-21' }, companies: [] })),
    internalClerkIds: async () => new Set(),
    isInternal: internal
  });
  const keysOf = (out) => Object.fromEntries(Object.entries(out.departments).map(([d, ps]) => [d, ps.map((p) => p.key)]));

  test('three departments of panels; a failing source fails only its panels; reads only; a failed load is not cached', async () => {
    const d = deps();
    const out = await V.departmentViews('week', d);
    expect(keysOf(out)).toEqual({
      research: ['flagged_cards', 'status_mismatches', 'deadline_unreadable', 'upcoming_deadlines', 'asked_not_carried', 'industry_coverage', 'goal_coverage', 'trending_grants', 'trending_industries', 'ignored', 'recent_launches'],
      consulting: ['consulting_cards', 'help_we_sell', 'big_money', 'most_engaged', 'fast_starters'],
      marketing: ['chat_themes', 'howto_unanswered', 'most_matched', 'most_opened', 'trending_grants', 'timely', 'goal_demand', 'demand_industry', 'demand_province', 'found_via', 'totals', 'signups']
    });
    const byKey = Object.fromEntries(Object.values(out.departments).flat().map((p) => [p.key, p]));
    for (const k of ['industry_coverage', 'goal_coverage', 'trending_industries', 'demand_industry', 'demand_province']) expect(byKey[k].error).toBe('not_configured');
    expect(byKey.chat_themes.error).toBe('migration_missing');
    expect(byKey.status_mismatches.clients.rows.map((r) => r.cells.grant.text)).toEqual(['Old']);
    expect(byKey.flagged_cards.clients.rows).toEqual([]);
    expect(byKey.totals.clients.tiles[0]).toEqual({ label: 'Businesses matched', n: 0 });
    expect(byKey.signups.clients.current.length).toBe(7);
    for (const p of Object.values(byKey)) { expect(typeof p.title).toBe('string'); expect(['table', 'bars', 'series', 'tiles']).toContain(p.kind); }
    expect(out).toMatchObject({ range: 'week', current: { from: '2026-10-15', to: '2026-10-21' }, previous: { from: '2026-10-08', to: '2026-10-14' }, today: '2026-10-21' });
    expect(d.storeQuery).toHaveBeenCalledWith(V.CHAT_ROWS_SQL, ['2026-10-15', '2026-10-21']);
    expect(d.appQuery).toHaveBeenCalledWith(V.GOALS_SQL, ['2026-10-08', '2026-10-21']);
    expect(d.appQuery).toHaveBeenCalledWith(V.FIRST_ACTIONS_SQL, ['2026-10-15', '2026-10-21']);
    expect(d.hubQuery).toHaveBeenCalledWith(V.DEADLINE_CARDS_SQL);
    expect(d.hubQuery).toHaveBeenCalledWith(V.CONSULTING_CARDS_SQL);
    expect(d.changes).toHaveBeenCalledWith('week');
    expect(d.companyList).toHaveBeenCalledWith('week');
    expect(d.listItems).toHaveBeenCalledWith();
    for (const q of [d.appQuery, d.storeQuery, d.hubQuery]) expect(q.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
    await V.departmentViews('week', d);
    expect(d.liveGrants).toHaveBeenCalledTimes(2);
    await expect(V.departmentViews('decade', d)).rejects.toMatchObject({ status: 400 });
  });

  test('the window readers run one after another; a clean load is cached per range', async () => {
    const d = deps();
    const order = [];
    const slow = (name, value) => jest.fn(async () => { order.push(`${name}:start`); await new Promise((r) => setTimeout(r, 5)); order.push(`${name}:end`); return value; });
    const v = { industries: [], not_mapped: null, breakdowns: { province: [], goal_tracks: [] } };
    d.coverage = slow('coverage', { clients_variant: v, all_variant: v, grants: {}, clients: {} });
    d.loadGrantWindow = slow('window', emptyWin());
    d.companyList = slow('companies', { current: { from: '2026-10-15', to: '2026-10-21' }, companies: [] });
    d.chatOverview = slow('chat', { store: { ok: true }, themes: [] });
    const out = await V.departmentViews('week', d);
    expect(Object.values(out.departments).flat().filter((p) => p.error)).toEqual([]);
    expect(order).toEqual(['coverage:start', 'coverage:end', 'window:start', 'window:end', 'companies:start', 'companies:end', 'chat:start', 'chat:end']);
    await V.departmentViews('week', d);
    expect(d.coverage).toHaveBeenCalledTimes(1);
  });

  test('a custom range is its own window; a bad one is a 400', async () => {
    const d = deps();
    const out = await V.departmentViews('2026-09-01..2026-10-15', d);
    expect(out).toMatchObject({ range: '2026-09-01..2026-10-15', current: { from: '2026-09-01', to: '2026-10-15' } });
    expect(d.coverage).toHaveBeenCalledWith('2026-09-01..2026-10-15');
    expect(d.storeQuery).toHaveBeenCalledWith(V.CHAT_ROWS_SQL, ['2026-09-01', '2026-10-15']);
    await expect(V.departmentViews('2026-10-15..2026-09-01', d)).rejects.toMatchObject({ status: 400 });
    await expect(V.departmentViews('2026-10-01..2026-10-30', d)).rejects.toMatchObject({ status: 400 }); // ends after today
  });

  test('no write SQL in the module; every panel has neutral metadata', () => {
    const sql = Object.values(V).filter((v) => typeof v === 'string' && /\bSELECT\b/i.test(v));
    expect(sql.length).toBeGreaterThan(0);
    for (const s of sql) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
    for (const [key, m] of Object.entries(V.META)) {
      expect(m.title).not.toMatch(/\?/);
      expect(['table', 'bars', 'series', 'tiles']).toContain(m.kind);
      if (m.see_all) expect(m.see_all.hash).toMatch(/^#/);
      expect(key).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('routes', () => {
  const call = async (router, path) => {
    const app = express();
    app.use('/v', router);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/v${path}`);
      return { status: res.status, body: await res.json() };
    } finally { server.close(); }
  };

  test('passes the range through, Month by default; 400 bad range; 503 not configured; 500 otherwise', async () => {
    const departmentViews = jest.fn(async (range) => ({ range }));
    expect(await call(createViewsRouter({ departmentViews }), '/?range=week')).toEqual({ status: 200, body: { range: 'week' } });
    expect(departmentViews).toHaveBeenCalledWith('week');
    await call(createViewsRouter({ departmentViews }), '/');
    expect(departmentViews).toHaveBeenLastCalledWith('month');
    expect((await call(createViewsRouter(), '/?range=decade')).status).toBe(400);
    const nc = Object.assign(new Error('x'), { code: 'not_configured' });
    expect(await call(createViewsRouter({ departmentViews: async () => { throw nc; } }), '/')).toEqual({ status: 503, body: { error: 'not_configured' } });
    expect((await call(createViewsRouter({ departmentViews: async () => { throw new Error('boom'); } }), '/')).status).toBe(500);
  });
});
