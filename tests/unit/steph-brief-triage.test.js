/**
 * Steph morning brief — triage (src/services/steph-brief-triage.js): automated
 * and government detection, grouping by sender, nudges, Drive notification
 * filtering, ordering and carry-over / auto-tick. Pure; no fakes needed.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/steph-brief-triage.test.js
 */

const T = await import('../../src/services/steph-brief-triage.js');

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-10-20T15:00:00Z'); // Tue 08:00 Vancouver
const ME = 'ssang@granted.ca';

let seq = 0;
const msg = (o) => ({
  id: `m${++seq}`, from: 'Arie Client <arie@client.ca>', reply_to: '', subject: 'Contract renewal', body: 'Hi Steph',
  internal_date: NOW - DAY, labels: ['INBOX'], is_draft: false, from_user: false, list_unsubscribe: '', precedence: '', ...o
});
const mine = (o) => msg({ from: `Steph Sang <${ME}>`, labels: ['SENT'], from_user: true, ...o });
const thread = (id, messages) => ({ id, subject: messages[0]?.subject || '', messages });

describe('senders', () => {
  test('automated: List-Unsubscribe, Precedence, no-reply', () => {
    expect(T.isAutomated(msg({ list_unsubscribe: '<mailto:u@x>' }))).toBe(true);
    expect(T.isAutomated(msg({ precedence: 'bulk' }))).toBe(true);
    expect(T.isAutomated(msg({ from: 'no-reply@zoom.us' }))).toBe(true);
    expect(T.isAutomated(msg({ from: 'Notifications <notifications@hubspot.com>' }))).toBe(true);
    expect(T.isAutomated(msg({}))).toBe(false);
  });
  test('government domains', () => {
    for (const d of ['canada.ca', 'ised-isde.gc.ca', 'gov.bc.ca', 'mail.gov.on.ca', 'economie.gouv.qc.ca', 'bdc.ca', 'alberta.ca']) {
      expect(T.isGovDomain(d)).toBe(true);
    }
    for (const d of ['granted.ca', 'client.ca', 'gmail.com', 'notgov.ca']) expect(T.isGovDomain(d)).toBe(false);
  });
  test('first name from a display name; none from a bare address', () => {
    expect(T.firstName('Arie Client <arie@client.ca>')).toBe('Arie');
    expect(T.firstName('"Neil O\'Brien" <n@x.ca>')).toBe('Neil');
    expect(T.firstName('ricky@cedar.ca')).toBe('');
  });
});

describe('sortThreads', () => {
  test('replied, automated and Drive notifications are split out', () => {
    const t1 = thread('t1', [msg({})]);
    const t2 = thread('t2', [msg({ internal_date: NOW - 2 * DAY }), mine({ internal_date: NOW - DAY })]);
    const t3 = thread('t3', [msg({ from: 'news@list.com', list_unsubscribe: '<x>' })]);
    const t4 = thread('t4', [msg({ from: 'Ana (Google Docs) <comments-noreply@docs.google.com>', subject: 'Plan' })]);
    const t5 = thread('t5', [mine({})]);
    const r = T.sortThreads([t1, t2, t3, t4, t5]);
    expect(r.mail.map(e => e.thread.id)).toEqual(['t1']);
    expect(r.notifications.map(t => t.id)).toEqual(['t4']);
    expect(r.counts).toEqual({ automated: 1, replied: 1 });
  });
  test('a draft on the thread is not a reply, and is detected', () => {
    const t = thread('t', [msg({}), mine({ labels: ['DRAFT'], is_draft: true, internal_date: NOW })]);
    expect(T.sortThreads([t]).mail).toHaveLength(1);
    expect(T.hasDraft(t)).toBe(true);
    expect(T.hasDraft(thread('u', [msg({})]))).toBe(false);
  });
});

describe('grouping by sender', () => {
  test('two unanswered threads from one sender become one item', () => {
    const a = thread('a', [msg({ subject: 'Old question', internal_date: NOW - 3 * DAY })]);
    const b = thread('b', [msg({ subject: 'New question', internal_date: NOW - DAY })]);
    const c = thread('c', [msg({ from: 'Neil <neil@other.ca>', subject: 'Hiring' })]);
    const items = T.groupBySender(T.sortThreads([a, b, c]).mail, NOW);
    expect(items).toHaveLength(2);
    const arie = items.find(i => i.item_key === 'arie@client.ca');
    expect(arie.thread_ids.sort()).toEqual(['a', 'b']);
    expect(arie.subject).toBe('New question');
    expect(arie.first_inbound_at).toBe(NOW - 3 * DAY);
    expect(arie.sender).toBe('Arie Client');
  });
  test('Reply-To wins over From for the sender key', () => {
    const t = thread('t', [msg({ from: 'Form <forms@site.com>', reply_to: 'Lead <lead@biz.ca>' })]);
    expect(T.groupBySender(T.sortThreads([t]).mail, NOW)[0].item_key).toBe('lead@biz.ca');
  });
});

describe('nudges', () => {
  test('a 2nd inbound on an unreplied thread is a nudge, labelled with days', () => {
    const t = thread('t', [msg({ internal_date: NOW - 6 * DAY }), msg({ internal_date: NOW - DAY })]);
    const n = T.nudgeInfo(t, NOW);
    expect(n).toMatchObject({ level: 2, days: 6 });
    expect(T.nudgeLabel(n.level, n.days)).toBe('2nd nudge · 6 days');
  });
  test('follow-up phrasing alone makes a nudge', () => {
    const t = thread('t', [msg({ body: 'Just checking in on the contract I sent.', internal_date: NOW - 2 * DAY })]);
    expect(T.nudgeInfo(t, NOW)).toMatchObject({ level: 2, days: 2, phrase: true });
  });
  test('inbound before her last reply does not count', () => {
    const t = thread('t', [msg({ internal_date: NOW - 5 * DAY }), mine({ internal_date: NOW - 4 * DAY }), msg({ internal_date: NOW - DAY })]);
    expect(T.nudgeInfo(t, NOW).level).toBe(1);
    expect(T.nudgeLabel(1, 1)).toBeNull();
  });
  test('3rd nudge, 1 day', () => {
    expect(T.nudgeLabel(3, 1)).toBe('3rd nudge · 1 day');
  });
});

describe('Drive notifications', () => {
  const note = (o) => msg({ from: 'Ana Lee (Google Docs) <comments-noreply@docs.google.com>', ...o });
  const URL1 = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit';

  test('mention, assigned comment and a share that asks something are kept, grouped per document', () => {
    const threads = [
      thread('n1', [note({ subject: 'Cedarline application', body: `Ana Lee mentioned you in a comment\n${URL1}` })]),
      thread('n2', [note({ subject: 'Cedarline application', body: `Ana Lee assigned you an action item\n${URL1}` })]),
      thread('n3', [note({ from: 'Bo <drive-shares-dm-noreply@google.com>', subject: 'Document shared with you: "Budget v2"',
        body: 'Bo shared a document with you\nCan you check the totals before Friday?\nhttps://docs.google.com/spreadsheets/d/9ZyXwVuTsRqPoNmLkJiHgFeDcBa98765/edit' })])
    ];
    const r = T.driveNotificationItems(threads);
    expect(r.dropped).toBe(0);
    expect(r.items).toHaveLength(2);
    const doc = r.items.find(i => i.item_key === 'doc:1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(doc.kinds.sort()).toEqual(['assigned', 'mention']);
    expect(doc.thread_ids.sort()).toEqual(['n1', 'n2']);
    expect(r.items.find(i => i.subject === 'Budget v2').kinds).toEqual(['share_with_ask']);
  });
  test('everything else is dropped: plain shares, edits, resolved comments', () => {
    const threads = [
      thread('x1', [note({ from: 'Bo <drive-shares-dm-noreply@google.com>', subject: 'Document shared with you: "Notes"', body: 'Bo shared a document with you\nOpen' })]),
      thread('x2', [note({ subject: 'Plan', body: 'Ana Lee replied to a comment\nResolved' })]),
      thread('x3', [note({ subject: 'Plan', body: 'Ana Lee edited the document' })])
    ];
    expect(T.driveNotificationItems(threads)).toEqual({ items: [], dropped: 3 });
  });
  test('assessment says who did what', () => {
    expect(T.docsAssessment({ sender: 'Ana Lee', kinds: ['mention', 'assigned'] })).toBe('Ana Lee mentioned you and assigned you a comment.');
  });
});

describe('ordering', () => {
  const item = (o) => ({ item_key: Math.random().toString(36), category: 'client', nudge: 0, first_inbound_at: NOW - DAY, last_inbound_at: NOW - DAY, ...o });

  test('Clients → Partners → Leads → Team → Government → Docs', () => {
    const order = T.orderItems([
      item({ category: 'government' }), item({ category: 'docs' }), item({ category: 'lead' }),
      item({ category: 'team' }), item({ category: 'partner' }), item({ category: 'client' })
    ]).map(i => i.category);
    expect(order).toEqual(['client', 'partner', 'lead', 'team', 'government', 'docs']);
  });
  test('nudges first within their group', () => {
    const order = T.orderItems([
      item({ item_key: 'plain', first_inbound_at: NOW - 9 * DAY }),
      item({ item_key: 'nudged', nudge: 2, first_inbound_at: NOW - DAY })
    ]).map(i => i.item_key);
    expect(order).toEqual(['nudged', 'plain']);
  });
  test('leads: most mature first, then newest', () => {
    const order = T.orderItems([
      item({ category: 'lead', item_key: 'unknown', lead_maturity: 0 }),
      item({ category: 'lead', item_key: 'deal', lead_maturity: 3 }),
      item({ category: 'lead', item_key: 'contact-old', lead_maturity: 2, last_inbound_at: NOW - 3 * DAY }),
      item({ category: 'lead', item_key: 'contact-new', lead_maturity: 2, last_inbound_at: NOW - DAY })
    ]).map(i => i.item_key);
    expect(order).toEqual(['deal', 'contact-new', 'contact-old', 'unknown']);
  });
  test('team: finance first, then urgency', () => {
    const order = T.orderItems([
      item({ category: 'team', item_key: 'urgent', urgency: 3 }),
      item({ category: 'team', item_key: 'finance', finance: true, urgency: 0 }),
      item({ category: 'team', item_key: 'calm', urgency: 0 })
    ]).map(i => i.item_key);
    expect(order).toEqual(['finance', 'urgent', 'calm']);
  });
});

describe('carry-over and auto-tick', () => {
  const stored = (o) => ({ id: o.item_key, category: 'client', state: 'open', state_at: new Date(NOW - 2 * DAY), first_seen_at: new Date(NOW - DAY), thread_ids: ['t'], ...o });
  const freshItem = (o) => ({ category: 'client', last_inbound_at: NOW - 2 * DAY, ...o });

  test('still unanswered: carried over and labelled', () => {
    const r = T.carryOver([stored({ item_key: 'a' }), stored({ item_key: 'b', first_seen_at: new Date(NOW - 3 * DAY) })],
      [freshItem({ item_key: 'a' }), freshItem({ item_key: 'b' })], NOW);
    expect(r.show.map(i => [i.item_key, i.carry])).toEqual([['a', 'from yesterday'], ['b', '3 days']]);
    expect(r.autoDone).toEqual([]);
  });
  test('she replied (no unanswered mail left): auto-done', () => {
    const r = T.carryOver([stored({ item_key: 'a' })], [], NOW);
    expect(r.autoDone.map(p => p.item_key)).toEqual(['a']);
    expect(r.show).toEqual([]);
  });
  test('done stays off the card without new inbound…', () => {
    const r = T.carryOver([stored({ item_key: 'a', state: 'done', state_at: new Date(NOW - DAY) })],
      [freshItem({ item_key: 'a', last_inbound_at: NOW - 2 * DAY })], NOW);
    expect(r.show).toEqual([]);
    expect(r.keptDone).toHaveLength(1);
  });
  test('…and returns when a new inbound arrives after Done', () => {
    const r = T.carryOver([stored({ item_key: 'a', state: 'done', state_at: new Date(NOW - 2 * DAY) })],
      [freshItem({ item_key: 'a', last_inbound_at: NOW - DAY })], NOW);
    expect(r.show).toHaveLength(1);
    expect(r.show[0].reopened).toBe(true);
    expect(r.reopened).toHaveLength(1);
  });
  test('auto-done items return the same way', () => {
    const r = T.carryOver([stored({ item_key: 'a', state: 'auto_done', state_at: new Date(NOW - 2 * DAY) })],
      [freshItem({ item_key: 'a', last_inbound_at: NOW - DAY })], NOW);
    expect(r.show[0].reopened).toBe(true);
  });
  test('new items have no carry label', () => {
    expect(T.carryOver([], [freshItem({ item_key: 'n' })], NOW).show[0].carry).toBeNull();
  });
  test('open Docs items are never auto-done — they carry until Done', () => {
    const r = T.carryOver([stored({ item_key: 'doc:1', category: 'docs' })], [], NOW);
    expect(r.autoDone).toEqual([]);
    expect(r.show.map(i => i.item_key)).toEqual(['doc:1']);
  });
});

// ── Inbox-manager behaviours (pure) ─────────────────────────────────────────
describe('window and covered', () => {
  test('sortThreads: within 14 days in, older aged out, colleague-covered set aside', () => {
    const since = NOW - 14 * DAY;
    const inWin = thread('in', [msg({ internal_date: NOW - 10 * DAY })]);
    const old = thread('old', [msg({ internal_date: NOW - 16 * DAY })]);
    const cov = thread('cov', [msg({ from: 'Pat <pat@partner.org>', internal_date: NOW - 2 * DAY }), msg({ from: 'Ruk <rukshaar@granted.ca>', internal_date: NOW - DAY })]);
    const r = T.sortThreads([inWin, old, cov], { since });
    expect(r.mail.map(e => e.thread.id)).toEqual(['in']);
    expect(r.agedOut).toEqual(['old']);
    expect(r.covered).toEqual([{ thread_id: 'cov', by: 'Ruk' }]);
  });
  test('coveredBy: only a colleague reply after the latest external inbound counts', () => {
    expect(T.coveredBy(thread('a', [msg({ from: 'Pat <pat@p.org>', internal_date: 1 }), msg({ from: 'Ruk <rukshaar@granted.ca>', internal_date: 2 })]))).toBe('Ruk');
    expect(T.coveredBy(thread('b', [msg({ from: 'Ruk <rukshaar@granted.ca>', internal_date: 1 }), msg({ from: 'Pat <pat@p.org>', internal_date: 2 })]))).toBeNull();
    expect(T.coveredBy(thread('c', [msg({ from: 'Tom <tom@granted.ca>', internal_date: 1 }), msg({ from: 'Ruk <rukshaar@granted.ca>', internal_date: 2 })]))).toBeNull();
    expect(T.coveredBy(thread('d', [msg({ from: 'Pat <pat@p.org>', internal_date: 1 }), mine({ internal_date: 2, labels: ['DRAFT'], is_draft: true })]))).toBeNull();
  });
  test('coveredSummary counts threads per colleague', () => {
    expect(T.coveredSummary([{ by: 'Ruk' }, { by: 'Tom' }, { by: 'Ruk' }])).toEqual([{ by: 'Ruk', threads: 2 }, { by: 'Tom', threads: 1 }]);
  });
});

describe('bills, safety, lookalikes', () => {
  const bill = msg({ from: 'Billing <billing@saasco.com>', list_unsubscribe: '<x>', subject: 'Invoice #1042',
    body: 'Amount due: $1,250.00. Due date: Oct 31, 2026. Pay online via the payment link.' });
  test('a bill: amount + due + how to pay; a receipt is not one', () => {
    expect(T.isBill(bill)).toBe(true);
    expect(T.isBill(msg({ subject: 'Receipt', body: 'Thank you for your payment of $40.00.' }))).toBe(false);
    expect(T.isBill(msg({ body: 'Our fee is $500.' }))).toBe(false);
    expect(T.billSummary(bill)).toEqual({ amount: '$1,250.00', due: 'Oct 31, 2026' });
  });
  test('a bill with List-Unsubscribe is not filed as automated', () => {
    const r = T.sortThreads([thread('b', [bill])], {});
    expect(r.mail).toHaveLength(1);
    expect(r.counts.automated).toBe(0);
  });
  test.each([
    ['Please note our new bank account details for future payments.', 'bank_change'],
    ['Updated remit-to address attached', 'bank_change'],
    ['Please transfer the funds today', 'urgent_payment'],
    ['wire $5,000 now', 'urgent_payment'],
    ['Can you send me the verification code?', 'credential'],
    ['What is the login for the portal?', 'credential'],
    ['We will send the report now.', null],
    ['What is the code of conduct link?', null],
    ['Thanks for the update', null]
  ])('safetyFlag(%j) → %s', (body, want) => {
    expect(T.safetyFlag(msg({ body }))).toBe(want);
  });
  test.each([
    ['acme.co', 'acme.com', {}, true],
    ['grantedd.ca', 'granted.ca', { maxDistance: 1 }, true],
    ['granted-ca.com', 'granted.ca', { maxDistance: 1 }, true],
    ['rnicrosoft.com', 'microsoft.com', {}, true],
    ['grants.ca', 'granted.ca', { maxDistance: 1 }, false],
    ['acme.com', 'acme.com', {}, false],
    ['mail.acme.com', 'acme.com', {}, false],
    ['client.ca', 'granted.ca', { maxDistance: 1 }, false]
  ])('lookalikeOf(%s, %s) → %s', (sender, known, opts, want) => {
    expect(T.lookalikeOf(sender, known, opts)).toBe(want);
  });
});

describe('decideItemType', () => {
  test('precedence: safety > sensitive > bill > unhappy > unsure > mail', () => {
    expect(T.decideItemType({ category: 'client', safety: 'bank_change', sensitivity: 'legal', is_bill: true })).toMatchObject({ item_type: 'safety', badge: 'Verify by phone first', draft: 'none' });
    expect(T.decideItemType({ category: 'client', lookalike: { known: 'acme.com' } }).item_type).toBe('safety');
    expect(T.decideItemType({ category: 'client', sensitivity: 'refund', is_bill: true })).toMatchObject({ item_type: 'sensitive', badge: 'Sensitive · write this yourself', draft: 'none' });
    expect(T.decideItemType({ category: 'team', is_bill: true, bill: { amount: '$90', due: 'Nov 3' } })).toMatchObject({ item_type: 'bill', badge: 'Bill · $90 due Nov 3', draft: 'none' });
    expect(T.decideItemType({ category: 'client', sensitivity: 'unhappy' })).toMatchObject({ item_type: 'unhappy', draft: 'ack' });
    expect(T.decideItemType({ category: 'other' })).toMatchObject({ item_type: 'unsure', badge: "Wasn't sure if this needs you", draft: 'none' });
    expect(T.decideItemType({ category: 'partner' })).toMatchObject({ item_type: 'mail', badge: null, draft: 'normal' });
  });
  test('promise and unsure groups have card labels and an order', () => {
    expect(T.GROUP_ORDER[0]).toBe('promise');
    expect(T.GROUP_ORDER.indexOf('other')).toBeLessThan(T.GROUP_ORDER.indexOf('docs'));
    expect(T.GROUP_LABELS.promise).toBe('Your promises');
    expect(T.GROUP_LABELS.other).toBe('Not sure if this needs you');
  });
  test('ownText drops quoted history', () => {
    expect(T.ownText('Arie,\n\nI will send it Wednesday.\n\nOn Mon, Oct 19, 2026 at 9:00 AM Arie <a@x.ca> wrote:\n> old')).toBe('Arie,\n\nI will send it Wednesday.');
    expect(T.ownText('Hi\n> quoted\nmore\n-----Original Message-----\nFrom: x')).toBe('Hi\nmore');
  });
});
