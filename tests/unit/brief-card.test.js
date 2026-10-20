/**
 * Steph's brief card (src/cards/brief-card.js): rendering, the Done button
 * (recipient only, updates state, answers with the rebuilt card), the
 * pressAnswer branch, and the manual-trigger endpoint's gate
 * (src/api/steph-brief-run.js).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/brief-card.test.js
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';

process.env.GOOGLE_CHAT_AUDIENCE = 'https://hub.example/api/chat/google';

const K = await import('../../src/cards/brief-card.js');
const { stephBriefRunEndpoint } = await import('../../src/api/steph-brief-run.js');

const ITEM = (o) => ({ id: o.id, category: 'client', sender: 'Arie Client', subject: 'Contract renewal', assessment: 'Renewal unsigned.',
  state: 'open', draft_ids: ['d1'], nudge: 0, first_inbound_at: new Date(), owner_hint: null, note: null, facts_line: null, ...o });
const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

function db(items, run = {}) {
  const r = { id: 5, local_date: '2026-10-20', is_test: false, recipient_chat_id: 'users/steph', item_ids: items.map(i => i.id), counts: { automated: 4 }, ...run };
  const byId = new Map(items.map(i => [i.id, { ...i }]));
  const query = jest.fn(async (sql, p) => {
    if (/FROM steph_brief_runs WHERE id/.test(sql)) return { rows: p[0] === r.id ? [r] : [] };
    if (/FROM steph_brief_items WHERE id = ANY/.test(sql)) return { rows: p[0].map(id => byId.get(id)).filter(Boolean) };
    if (/SET state = 'done'/.test(sql)) { const it = byId.get(p[0]); if (it?.state === 'open') it.state = 'done'; return { rows: [] }; }
    throw new Error(`unhandled ${sql}`);
  });
  return { query, byId };
}

const press = (o = {}) => ({ parameters: { action: 'brief.done', runId: '5', itemId: IDS[0] }, actorChatId: 'users/steph', messageName: 'spaces/x/messages/1', ...o });
const texts = (cards) => JSON.stringify(cards);

// ── Rendering ───────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-20T15:00:00Z');
const DAY = 864e5;
const RUN = (o = {}) => ({ id: 5, local_date: new Date(2026, 9, 20), is_test: false, owner_email: 'ssang@granted.ca', counts: {}, ...o });
const render = (items, run = RUN(), opts = {}) => K.renderBrief(run, items, { now: NOW, ...opts });
const card = (cards) => cards[0].card;
const headers = (cards) => card(cards).sections.map(sec => sec.header).filter(Boolean);
const decos = (cards) => card(cards).sections.flatMap(sec => sec.widgets).filter(w => w.decoratedText).map(w => w.decoratedText);
const buttonsOf = (cards) => card(cards).sections.flatMap(sec => sec.widgets).filter(w => w.buttonList).map(w => w.buttonList.buttons);
const footerLines = (cards) => card(cards).sections.at(-1).widgets.map(w => w.textParagraph?.text || '');
let n = 0;
const ID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const it = (o) => ITEM({ id: ID(), state: 'open', draft_ids: [], nudge: 0, first_inbound_at: new Date(NOW - DAY), thread_ids: [`t${n}`], item_type: 'mail', sources: [], ...o });

describe('header and explainer', () => {
  test('the brief\'s local date — from a pg Date or a string — never "Invalid Date"', () => {
    expect(K.briefDate(new Date(2026, 9, 20))).toBe('Tue Oct 20');
    expect(K.briefDate('2026-10-20')).toBe('Tue Oct 20');
    expect(K.briefDate('2026-10-20T00:00:00.000Z')).toBe('Tue Oct 20');
    expect(JSON.stringify(render([it({})]))).not.toContain('Invalid Date');
  });
  test('"Good morning, Steph" · date · N need you · M drafted; dry run marked', () => {
    const items = [it({ draft_ids: ['d'], draft_message_id: 'm1' }), it({}), it({ state: 'done' }), it({ no_reply: true })];
    expect(card(render(items)).header).toEqual({ title: 'Good morning, Steph', subtitle: 'Tue Oct 20 · 2 emails need you · 1 reply drafted' });
    expect(card(render([it({ draft_preview: 'x' })], RUN({ is_test: true }))).header.title).toBe('DRY RUN — Good morning, Steph');
  });
  test('the explainer, word for word, first', () => {
    const first = card(render([it({})])).sections[0].widgets[0].textParagraph.text;
    expect(first).toContain('Each item is an email waiting on you. I read the thread, checked HubSpot, Drive, Granola and Chat, and saved a reply in your Gmail drafts. Open it, edit, send. Replying ticks it off here automatically. Press Done if you handled it another way.');
  });
});

describe('Start here', () => {
  const startText = (cards) => card(cards).sections.find(sec => /Start here/.test(sec.header || ''))?.widgets[0].textParagraph.text || '';
  test('"Verify by phone first" always first, even against an overdue promise and a 3rd follow-up', () => {
    const items = [
      it({ category: 'promise', item_type: 'promise', sender: 'Ricky', badge: 'You promised to send the budget · due Mon, Oct 19 (1 day ago)', due_on: '2026-10-19' }),
      it({ category: 'client', sender: 'Nudger', nudge: 3, first_inbound_at: new Date(NOW - 9 * DAY) }),
      it({ category: 'other', item_type: 'safety', sender: 'Accounts', badge: 'Verify by phone first' })
    ];
    const text = startText(render(items));
    expect(text.indexOf('Accounts')).toBeLessThan(text.indexOf('Ricky'));
    expect(text).toContain('Verify it by phone before anything moves');
    expect(text).toContain("Then <b>Ricky</b> — you said you'd send the budget by Mon, Oct 19; it's 1 day late.");
    expect(text).not.toContain('Nudger');                                // at most 2
  });
  test('then the soonest deadline, then money, then follow-ups; nothing urgent → no Start here', () => {
    const R = await_import_rank();
    const ranked = R.rankItems([
      it({ sender: 'Follow', nudge: 2 }),
      it({ sender: 'Money', finance: true }),
      it({ category: 'team', item_type: 'bill', sender: 'BillLate', badge: 'Bill · $90 due Oct 31', due_on: '2026-10-31' }),
      it({ category: 'promise', item_type: 'promise', sender: 'PromiseSoon', badge: 'You promised to call · due today', due_on: '2026-10-20' }),
      it({ sender: 'Today', urgency: 3 })
    ], { today: '2026-10-20', now: NOW }).map(r => r.item.sender);
    expect(ranked).toEqual(['PromiseSoon', 'Today', 'BillLate', 'Money', 'Follow']);
    expect(startText(render([it({}), it({})]))).toBe('');
  });
  test('reasons say what happens if it waits', () => {
    const R = await_import_rank();
    const reason = (o) => R.urgencyOf(it(o), { today: '2026-10-20', now: NOW }).reason;
    expect(reason({ item_type: 'bill', badge: 'Bill · $1,250.00 due Oct 31, 2026', due_on: '2026-10-31' })).toBe('$1,250.00 is due Sat, Oct 31; late after that');
    expect(reason({ item_type: 'unhappy' })).toBe('an unhappy client; a call today stops it escalating');
    expect(reason({ nudge: 2, first_inbound_at: new Date(NOW - 6 * DAY) })).toBe('2nd follow-up in 6 days; another day risks losing them');
    expect(reason({ urgency: 3 })).toBe('they need an answer today');
  });
});

describe('groups and layout', () => {
  test('order and "Label · n" headers', () => {
    const cats = ['other', 'docs', 'government', 'team', 'lead', 'partner', 'client', 'promise'];
    const h = headers(render(cats.map(c => it({ category: c, item_type: c === 'promise' ? 'promise' : 'mail' }))));
    expect(h.filter(x => !/Start here/.test(x))).toEqual(['Your promises · 1', 'Clients · 1', 'Partners · 1', 'Leads · 1', 'Team · 1', 'Government programs · 1', 'Docs that need you · 1', 'Not sure if this needs you · 1']);
  });
  test('Clients, Leads, promises in full detail: who, what\'s going on, draft says, checked; others one line', () => {
    const cards = render([
      it({ category: 'client', sender: 'Arie Vos', company: 'Vos Logistics', subject: 'Renewal', assessment: 'Renewal unsigned; e-contract expired Friday.',
        draft_ids: ['d'], draft_message_id: 'm1', draft_text: "Arie,\n\nThe renewal came back unsigned. If you're good to go, I'll retrigger it.", sources: ['HubSpot', 'Drive'] }),
      it({ category: 'partner', sender: 'Pat', subject: 'Webinar', assessment: 'Wants a co-host for Nov 12.' })
    ]);
    const [full, one] = decos(cards);
    expect(full.text).toContain('<b>Arie Vos, Vos Logistics</b> — Renewal');
    expect(full.text).toContain("<b>What's going on:</b> Renewal unsigned; e-contract expired Friday.");
    expect(full.text).toContain('<b>Draft says:</b> The renewal came back unsigned.');
    expect(full.text).toContain('Checked HubSpot, Drive');
    expect(one.text).toBe('<b>Pat</b> — Wants a co-host for Nov 12. <font color="#5f6368">· No draft</font>');
    expect(one.text).not.toContain("What's going on");
  });
  test('"Before you send" for holding replies; "No draft — why" for safety, sensitive, bill, unsure, promise', () => {
    const held = decos(render([it({ category: 'client', held: true, draft_ids: ['d'], draft_message_id: 'm', note: 'Unclear: whether the decision letter arrived — ask Ruk.' })]))[0];
    expect(held.topLabel).toContain('Holding reply · check first');
    expect(held.text).toContain('<b>Before you send:</b> whether the decision letter arrived — ask Ruk.');
    const why = (o) => decos(render([it({ category: 'client', ...o })]))[0].text;
    expect(why({ item_type: 'safety', badge: 'Verify by phone first' })).toContain('<b>No draft</b> — verify the request by phone first');
    expect(why({ item_type: 'sensitive', badge: 'Sensitive · write this yourself' })).toContain('<b>No draft</b> — write this one yourself');
    expect(why({ category: 'promise', item_type: 'promise', badge: 'You promised to x · due today' })).toContain("<b>No draft</b> — the facts to keep this promise aren't in the thread");
    expect(why({})).toContain("<b>No draft</b> — past today's draft limit");
  });
  test('every badge', () => {
    const top = (o) => decos(render([it(o)], RUN(), {}))[0].topLabel;
    expect(top({ nudge: 2, first_inbound_at: new Date(NOW - 6 * DAY) })).toBe('2nd follow-up · 6 days');
    expect(top({ carry: 'from yesterday' })).toBe('From yesterday');
    expect(top({ carry: '3 days' })).toBe('Waiting 3 days');
    expect(top({ sent_to: 'Patty Lim' })).toBe('Sent to Patty Lim');
    expect(top({ item_type: 'unhappy', badge: 'Unhappy client · call recommended', draft_ids: ['d'] })).toBe('Unhappy client · call recommended');
    expect(top({ item_type: 'sensitive', badge: 'Sensitive · write this yourself' })).toBe('Sensitive · write this yourself');
    expect(top({ category: 'partner', item_type: 'safety', badge: 'Verify by phone first' })).toBe('Verify by phone first');
    expect(top({ category: 'promise', item_type: 'promise', badge: 'You promised to send the budget · due today' })).toBe('You promised to send the budget · due today');
    expect(top({ held: true, draft_ids: ['d'] })).toBe('Holding reply · check first');
    expect(top({})).toBeUndefined();
  });
  test('Open draft with a saved draft, Open email without, Open doc for Drive items; Done everywhere open', () => {
    const b = buttonsOf(render([
      it({ category: 'client', draft_ids: ['d'], draft_message_id: '18f2a9c0' , thread_ids: ['th1'] }),
      it({ category: 'partner', thread_ids: ['th2'] }),
      it({ category: 'docs', item_key: 'doc:1AbCdEfGhIjKlMnOpQrStUvWxYz012345', thread_ids: ['th3'] })
    ]));
    expect(b[0].map(x => x.text)).toEqual(['Open draft', 'Done']);
    expect(b[0][0].onClick.openLink.url).toBe('https://mail.google.com/mail/u/ssang%40granted.ca/#drafts?compose=18f2a9c0');
    expect(b[1].map(x => x.text)).toEqual(['Open email', 'Done']);
    expect(b[1][0].onClick.openLink.url).toBe('https://mail.google.com/mail/u/ssang%40granted.ca/#all/th2');
    expect(b[2].map(x => x.text)).toEqual(['Open doc', 'Done']);
    expect(b[2][0].onClick.openLink.url).toBe('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    const doneParams = b[0][1].onClick.action.parameters;
    expect(doneParams).toEqual(expect.arrayContaining([{ key: 'action', value: 'brief.done' }, { key: 'runId', value: '5' }]));
  });
  test('one-line safety items keep "Verify by phone first" and the lookalike note; owner suggestion on no-draft lines', () => {
    const [safety, bill] = decos(render([
      it({ category: 'partner', item_type: 'safety', badge: 'Verify by phone first', note: "Sender domain acme.co looks like acme.com but isn't." }),
      it({ category: 'team', item_type: 'bill', badge: 'Bill · $90 due Oct 31', owner_hint: 'Tom (finance)' })
    ]));
    expect(safety.topLabel).toBe('Verify by phone first');
    expect(safety.text).toContain("⚠️ Sender domain acme.co looks like acme.com but isn't.");
    expect(bill.text).toContain('No draft; suggest Tom (finance)');
  });
  test('done items are struck through, without buttons', () => {
    const cards = render([it({ state: 'done' }), it({})]);
    expect(JSON.stringify(cards)).toContain('✅ <s>');
    expect(buttonsOf(cards)).toHaveLength(1);
  });
});

describe('length cap', () => {
  test('more than 10: the 10 most urgent in layout, then "+N more" rows with an open link and Done', () => {
    const items = Array.from({ length: 14 }, (_, i) => it({ category: 'partner', sender: `S${i}`, subject: `Subj ${i}`, nudge: i < 3 ? 2 : 0 }));
    items.push(it({ category: 'other', item_type: 'safety', badge: 'Verify by phone first', sender: 'Fraud' }));
    const cards = render(items);
    const sections = card(cards).sections;
    const more = sections.find(sec => /^\+\d+ more$/.test(sec.header || ''));
    expect(more.header).toBe('+5 more');
    expect(more.widgets).toHaveLength(5);
    expect(more.widgets[0].decoratedText.text).toMatch(/<b>S\d+<\/b> — Subj \d+ · <a href="https:\/\/mail\.google\.com\/mail\/u\/ssang%40granted\.ca\/#all\/t\d+">Open email<\/a>/);
    expect(more.widgets[0].decoratedText.button.text).toBe('Done');
    const shown = sections.filter(sec => sec !== more).flatMap(sec => sec.widgets).filter(w => w.decoratedText).map(w => w.decoratedText.text);
    expect(shown.some(t => t.includes('Fraud'))).toBe(true);                 // the urgent ones stay in layout
    expect(shown.filter(t => /<b>S[012]<\/b>/.test(t))).toHaveLength(3);    // follow-ups outrank the rest
    const widgets = sections.reduce((a, sec) => a + sec.widgets.length, 0);
    expect(widgets).toBeLessThan(100);
  });
  test('an empty brief says so', () => {
    expect(JSON.stringify(render([]))).toContain('Nothing waiting on you in the last 14 days.');
  });
});

describe('footer', () => {
  test('covered and kept-out counts, never itemised; FYIs counted, not listed', () => {
    const cards = render([it({ sender: 'Visible' }), it({ sender: 'Fyi Person', no_reply: true }), it({ sender: 'Fyi Two', no_reply: true })],
      RUN({ counts: { covered: [{ by: 'Ruk Ali', threads: 2 }, { by: 'Tom', threads: 1 }], automated: 9, handled: 3, notifications_dropped: 2, vendor: 4, former_staff_kept_out: 5, auto_done: 1 } }));
    const lines = footerLines(cards).join('\n');
    expect(lines).toContain('Covered by colleagues: Ruk Ali (2), Tom (1).');
    expect(lines).toContain('Kept out of your way: 14 notifications, 4 sales pitches, 2 FYIs (no reply needed), 5 emails to former staff.');
    expect(JSON.stringify(cards)).not.toContain('Fyi Person');
  });
  test('zero parts are dropped; no covered line when none', () => {
    const lines = footerLines(render([it({})], RUN({ counts: { vendor: 1 } }))).join('\n');
    expect(lines).toBe('<font color="#5f6368">Kept out of your way: 1 sales pitch.</font>');
    expect(K.keptOutLine({}, 0)).toBeNull();
    expect(K.coveredLine({ covered: [] })).toBeNull();
  });
  test('no money on real runs; the cost line stays on dry runs', () => {
    const counts = { cost: { classify: 0.0012, drafting: 0.009, oracle: 0.41, website: 0.002, search_fees: 0.02, compare: 0.05, total: 0.4922 } };
    expect(JSON.stringify(render([it({ draft_ids: ['d'], cost_usd: 0.4, model: 'claude-sonnet-5-5' })], RUN({ counts })))).not.toMatch(/\$0\.4|Run cost/);
    const dry = render([it({ draft_preview: 'Arie,\n\nHello', model: 'claude-sonnet-5-5', cost_usd: 0.41,
      compare: { label: 'Haiku version', model: 'claude-haiku-4-5-20251001', draft: 'Arie,\n\nHi there', cost_usd: 0.004 } })], RUN({ is_test: true, counts }));
    const t = JSON.stringify(dry);
    expect(t).toContain('Run cost $0.492 — classify $0.0012 · drafts $0.0090 · Oracle $0.410 · web lookups $0.0020 · search fees $0.020 · comparison $0.050');
    expect(t).toContain('Draft · Sonnet · $0.410');
    expect(t).toContain('Haiku version · Haiku · $0.0040');
  });
  test('user text is escaped', () => {
    expect(JSON.stringify(render([it({ subject: '<script>x</script>' })]))).not.toContain('<script>');
  });
});

// rank helpers, loaded once (top-level await is fine in ESM tests)
const RANK = await import('../../src/services/steph-brief-rank.js');
function await_import_rank() { return RANK; }

describe('handleBriefClick', () => {
  test('the recipient presses Done: state updated, card rebuilt and returned, message patched', async () => {
    const { query, byId } = db([ITEM({ id: IDS[0] }), ITEM({ id: IDS[1], sender: 'Other' })]);
    const patchCard = jest.fn(async () => {});
    const r = await K.handleBriefClick(press(), { query, patchCard });
    expect(byId.get(IDS[0]).state).toBe('done');
    const cards = r.hostAppDataAction.chatDataAction.updateMessageAction.message.cardsV2;
    expect(texts(cards)).toContain('✅ <s>');
    expect(patchCard).toHaveBeenCalledWith('spaces/x/messages/1', cards);
  });
  test('anyone else pressing is ignored', async () => {
    const { query, byId } = db([ITEM({ id: IDS[0] })]);
    expect(await K.handleBriefClick(press({ actorChatId: 'users/someone' }), { query, patchCard: jest.fn() })).toEqual({});
    expect(byId.get(IDS[0]).state).toBe('open');
  });
  test('bad parameters, unknown run, or an item not on that card → ignored', async () => {
    const { query } = db([ITEM({ id: IDS[0] })]);
    const opts = { query, patchCard: jest.fn() };
    expect(await K.handleBriefClick(press({ parameters: { action: 'brief.done', runId: '5', itemId: 'nope' } }), opts)).toEqual({});
    expect(await K.handleBriefClick(press({ parameters: { action: 'brief.done', runId: '9', itemId: IDS[0] } }), opts)).toEqual({});
    expect(await K.handleBriefClick(press({ parameters: { action: 'brief.done', runId: '5', itemId: IDS[2] } }), opts)).toEqual({});
  });
  test('pressAnswer routes brief.* here, before the tracked-card path', () => {
    const src = readFileSync(new URL('../../src/cards/actions.js', import.meta.url), 'utf8');
    const branch = src.indexOf("params.action.startsWith('brief.')");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(src.indexOf('const { cardId, action } = params;'));
  });
});

describe('manual trigger endpoint', () => {
  const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const okDeps = { query: jest.fn(async (sql, p) => ({ rows: [{ id: 7, email: p[0], chat_user_id: 'users/x', gmail_connected_at: new Date() }] })), hasGmailScopes: async () => ({ ok: true }) };

  test('wrong or missing secret → 401, nothing runs', async () => {
    process.env.MIGRATION_SECRET = 's3cret';
    const run = jest.fn(async () => ({}));
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 'nope' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(r.statusCode).toBe(401);
    const r2 = res();
    await stephBriefRunEndpoint({ query: {}, user: { email: 'writers@granted.ca' } }, r2, { deps: okDeps, run });
    expect(r2.statusCode).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  test('dry run by default, to the caller', async () => {
    const run = jest.fn(async () => ({}));
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(r.statusCode).toBe(202);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, dmToEmail: 'writers@granted.ca' }));
  });
  test('no inbox: the default is unchanged (Steph\'s inbox)', async () => {
    const run = jest.fn(async () => ({}));
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(r.statusCode).toBe(202);
    expect(r.body.inbox).toBe('ssang@granted.ca');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ inboxEmail: null }));
  });
  test('inbox on a real run → 400, nothing runs', async () => {
    process.env.GMAIL_CONSENT_ALLOWLIST = 'ssang@granted.ca,writers@granted.ca';
    const run = jest.fn();
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret', dry_run: '0', inbox: 'writers@granted.ca' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('inbox_only_in_dry_run');
    expect(run).not.toHaveBeenCalled();
  });
  test('inbox not on GMAIL_CONSENT_ALLOWLIST (or not an address) → 400, nothing runs', async () => {
    process.env.GMAIL_CONSENT_ALLOWLIST = 'ssang@granted.ca,writers@granted.ca';
    const run = jest.fn();
    for (const inbox of ['someone@granted.ca', 'not-an-email', '', ['writers@granted.ca', 'x@y.ca']]) {
      const r = res();
      await stephBriefRunEndpoint({ query: { secret: 's3cret', inbox }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
      expect(r.statusCode).toBe(400);
      expect(r.body.error).toBe('inbox_not_allowlisted');
    }
    delete process.env.GMAIL_CONSENT_ALLOWLIST;
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret', inbox: 'writers@granted.ca' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(r.statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  test('an allowlisted inbox in a dry run → 202, run reads that inbox, card to the caller', async () => {
    process.env.GMAIL_CONSENT_ALLOWLIST = 'ssang@granted.ca,writers@granted.ca';
    const run = jest.fn(async () => ({}));
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret', inbox: ' Writers@Granted.ca ' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(r.statusCode).toBe(202);
    expect(r.body).toMatchObject({ started: true, dryRun: true, inbox: 'writers@granted.ca', postsTo: 'your DM' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, inboxEmail: 'writers@granted.ca', dmToEmail: 'writers@granted.ca' }));
    delete process.env.GMAIL_CONSENT_ALLOWLIST;
  });
  test('dry_run=0 is a real run; a failed preflight answers 409 with its reason', async () => {
    const run = jest.fn(async () => ({}));
    const r = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret', dry_run: '0' }, user: { email: 'writers@granted.ca' } }, r, { deps: okDeps, run });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, dmToEmail: null }));
    const notConnected = { ...okDeps, query: jest.fn(async (sql, p) => ({ rows: [{ id: 7, email: p[0], chat_user_id: 'users/x', gmail_connected_at: null }] })) };
    const r2 = res();
    await stephBriefRunEndpoint({ query: { secret: 's3cret' }, user: { email: 'writers@granted.ca' } }, r2, { deps: notConnected, run: jest.fn() });
    expect(r2.statusCode).toBe(409);
    expect(r2.body.reason).toBe('gmail_not_connected');
  });
});
