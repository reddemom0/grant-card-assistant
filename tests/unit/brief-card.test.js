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

describe('renderBrief', () => {
  const items = [
    ITEM({ id: IDS[1], category: 'lead', sender: 'Lee Lead', subject: 'Funding?', facts_line: 'Calculator: revenue $500K–$1M · est. $45,000' }),
    ITEM({ id: IDS[0], nudge: 2, first_inbound_at: new Date(Date.now() - 6 * 864e5), carry: 'from yesterday' }),
    ITEM({ id: IDS[2], category: 'team', state: 'done', sender: 'Tom', subject: 'Invoice' })
  ];
  const cards = K.renderBrief({ id: 5, local_date: '2026-10-20', counts: { automated: 4, vendor: 2, auto_done: 1 } }, items);
  const t = texts(cards);

  test('groups in card order with counts; header names the day', () => {
    expect(t.indexOf('Clients (1)')).toBeLessThan(t.indexOf('Leads (1)'));
    expect(t.indexOf('Leads (1)')).toBeLessThan(t.indexOf('Team (1)'));
    expect(cards[0].card.header.title).toBe('Morning brief · Tue, Oct 20');
    expect(cards[0].card.header.subtitle).toBe('2 to answer · 3 drafts saved');
  });
  test('nudge, carry-over, draft marker and lead facts on open items', () => {
    expect(t).toContain('2nd nudge · 6 days');
    expect(t).toContain('from yesterday');
    expect(t).toContain('draft saved');
    expect(t).toContain('est. $45,000');
  });
  test('Done buttons on open items only; done items struck through', () => {
    const buttons = [];
    JSON.stringify(cards, (k, v) => { if (k === 'button' && v?.text) buttons.push(v); return v; });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].onClick.action.parameters).toEqual(expect.arrayContaining([{ key: 'action', value: 'brief.done' }, { key: 'runId', value: '5' }]));
    expect(t).toContain('✅ <s>');
  });
  test('footer counts skipped and auto-ticked mail', () => {
    expect(t).toContain('1 ticked off — you replied.');
    expect(t).toContain('4 automated · 2 vendor pitches skipped.');
  });
  test('an empty brief says so', () => {
    expect(texts(K.renderBrief({ id: 1, local_date: '2026-10-20' }, []))).toContain('Nothing unanswered');
  });
  test('item cap with "N more"', () => {
    const many = Array.from({ length: K.MAX_ITEMS + 3 }, (_, i) => ITEM({ id: `${i}`, sender: `S${i}` }));
    expect(texts(K.renderBrief({ id: 1, local_date: '2026-10-20' }, many))).toContain('3 more not shown.');
  });
  test('dry run: header says so, drafts shown, none saved', () => {
    const c = K.renderBrief({ id: 2, local_date: '2026-10-20', is_test: true }, [ITEM({ id: IDS[0], draft_ids: [], draft_preview: 'Arie,\n\nHello' })]);
    expect(c[0].card.header.title).toMatch(/^DRY RUN/);
    expect(texts(c)).toContain('Hello');
    expect(texts(c)).toContain('draft (dry run — not saved)');
  });
  test('dry run: per-draft model + cost, the comparison, and the run total at the bottom', () => {
    const c = K.renderBrief({ id: 2, local_date: '2026-10-20', is_test: true, counts: { cost: { classify: 0.0012, drafting: 0.009, oracle: 0.41, website: 0.002, search_fees: 0.02, compare: 0.05, total: 0.4922 } } },
      [ITEM({ id: IDS[0], draft_ids: [], draft_preview: 'Arie,\n\nHello', model: 'claude-sonnet-5-5', cost_usd: 0.41,
        compare: { label: 'Haiku version', model: 'claude-haiku-4-5-20251001', draft: 'Arie,\n\nHi there', cost_usd: 0.004 } })]);
    const t = texts(c);
    expect(t).toContain('Draft · Sonnet · $0.410');
    expect(t).toContain('Haiku version · Haiku · $0.0040');
    expect(t).toContain('Hi there');
    const footer = c[0].card.sections.at(-1).widgets[0].textParagraph.text;
    expect(footer).toContain('Run cost $0.492 — classify $0.0012 · drafts $0.0090 · Oracle $0.410 · web lookups $0.0020 · search fees $0.020 · comparison $0.050');
  });
  test('the real card shows no cost, and marks no-reply items', () => {
    const c = K.renderBrief({ id: 3, local_date: '2026-10-20', counts: { cost: { total: 1 } } }, [ITEM({ id: IDS[0], no_reply: true, draft_ids: [], model: 'x', cost_usd: 0.4 })]);
    expect(texts(c)).not.toContain('Run cost');
    expect(texts(c)).not.toContain('$0.4');
    expect(texts(c)).toContain('no reply needed');
  });
  test('user text is escaped', () => {
    const c = K.renderBrief({ id: 1, local_date: '2026-10-20' }, [ITEM({ id: IDS[0], subject: '<script>x</script>' })]);
    expect(texts(c)).not.toContain('<script>');
  });
});

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
