/**
 * The lead triage card
 *
 * Lead messages go through the real Chat handler; presses through the real
 * click handler; dialogs through the real dialog router; the digest and the
 * due-date DMs are real. HubSpot, our lead-gen sessions, the grants table, the
 * database and the Chat API are the in-memory fakes in
 * helpers/tracked-cards-fakes.js. The model must never run for any of this.
 *
 * The lead's own details are sentinels: if any of them reaches a log line, the
 * "logs carry codes and counts only" test fails.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/lead-card.test.js
 */

import { jest } from '@jest/globals';
import { createTrackedCardFakes, cardText, cardButtons } from './helpers/tracked-cards-fakes.js';

const ENDPOINT = 'https://hub.example/api/chat/google';
const ISSUER = 'addon@example.iam.gserviceaccount.com';
const LISTENER_EMAIL = 'oracle-listener@granted.ca';
Object.assign(process.env, {
  GOOGLE_CHAT_AUDIENCE: ENDPOINT,
  GOOGLE_CHAT_ISSUER_EMAIL: ISSUER,
  GOOGLE_SERVICE_ACCOUNT_KEY: '{}',
  PUBLIC_URL: 'https://hub.example',
  CHAT_LISTENER_USER_EMAIL: LISTENER_EMAIL
});
delete process.env.DEFAULT_TIMEZONE;
delete process.env.TRACK_DIALOGS_ENABLED;

const fakes = createTrackedCardFakes();

// --- the team -------------------------------------------------------------------
const NAT = 'users/nat';
const CHRIS = 'users/chris';
const STEPH = 'users/steph';
const LISTENER = 'users/listener';
const NAMES = { [NAT]: 'Nat Sentinel', [CHRIS]: 'Chris Sentinel', [STEPH]: 'Steph Sentinel', [LISTENER]: 'Oracle' };
const EMAILS = {
  [NAT]: 'nat.sentinel@granted.ca', [CHRIS]: 'chris.sentinel@granted.ca',
  [STEPH]: 'steph.sentinel@granted.ca', [LISTENER]: LISTENER_EMAIL
};
const ALL_SCOPES = 'https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.spaces.readonly';
const HUB = [{ id: 1, chat: NAT }, { id: 3, chat: CHRIS }].map(u => ({
  id: u.id, email: EMAILS[u.chat], name: NAMES[u.chat], is_active: true,
  google_refresh_token: 'rt', google_granted_scopes: ALL_SCOPES, chat_user_id: u.chat
}));

// --- the lead (every value a log sentinel) --------------------------------------
const LEAD = {
  name: 'Sarah Leadsentinel',
  company: 'Leadsentinel Foods',
  email: 'sarah@leadsentinel-foods.test',
  phone: '604-555-0199'
};
const LEAD_TEXT = `${LEAD.name} called in from ${LEAD.company} — ${LEAD.phone}, ${LEAD.email}, wants to know about training grants`;

// --- modules replaced -----------------------------------------------------------
const textReplies = [];
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        async verifyIdToken() {
          return { getPayload: () => ({ email_verified: true, email: ISSUER }) };
        }
      },
      GoogleAuth: class {}
    },
    chat: (opts) => (opts?.auth?.userId
      ? fakes.userChat.client(opts.auth.userId)
      : { spaces: { messages: { create: async (req) => { textReplies.push(req.requestBody.text); return { data: {} }; } } } })
  }
}));
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (sql, params = []) => {
    if (/FROM users\s+WHERE LOWER\(email\)/.test(sql)) {
      return { rows: HUB.filter(u => u.email.toLowerCase() === String(params[0]).toLowerCase()) };
    }
    if (/SELECT google_granted_scopes FROM users WHERE id/.test(sql)) {
      return { rows: HUB.filter(u => u.id === params[0]) };
    }
    return { rows: [] };
  },
  getPool: () => null,
  transaction: async () => null
}));
jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: async (userId) => ({ userId }),
  getDocsClient: async () => null,
  getDriveClient: async () => null
}));
jest.unstable_mockModule('../../src/api/confirmation.js', () => ({
  tryHandleConfirmation: async () => null, currentPendingId: async () => null, proposalNotice: async () => null
}));
jest.unstable_mockModule('../../src/chat-listen/config.js', () => ({
  isListenSpace: () => false, listenReady: () => false, listenDisabled: () => false,
  listenSpaces: () => [], listenEntry: () => null
}));
jest.unstable_mockModule('../../src/database/chat-listen-store.js', () => fakes.listen.module);
jest.unstable_mockModule('../../src/claude/client.js', () => fakes.agent.module);
jest.unstable_mockModule('../../src/database/messages.js', () => fakes.messages.module);
jest.unstable_mockModule('../../src/database/tracked-cards-store.js', () => fakes.store);
jest.unstable_mockModule('../../src/cards/chat-api.js', () => fakes.chat.module);
jest.unstable_mockModule('../../src/tools/google-drive.js', () => fakes.drive.module);
jest.unstable_mockModule('../../src/tools/hubspot.js', () => fakes.hubspot.module);
jest.unstable_mockModule('../../src/tools/getgranted-search.js', () => fakes.grants.module);
jest.unstable_mockModule('../../src/database/lead-gen-reads.js', () => fakes.leadGen.module);
jest.unstable_mockModule('../../src/tools/pending-actions.js', () => fakes.gate.module);
jest.unstable_mockModule('../../src/tools/directory-names.js', () => fakes.directory.module);
jest.unstable_mockModule('../../src/tools/google-calendar.js', () => fakes.calendar.module);

const { handleGoogleChatEvent } = await import('../../src/api/chat-google.js');
const { handleCardClick, whenCardsIdle } = await import('../../src/cards/actions.js');
const { handleCardDialog } = await import('../../src/cards/dialogs.js');
const { renderCard } = await import('../../src/cards/update.js');
const notify = await import('../../src/cards/notify.js');

// --- the thread -----------------------------------------------------------------
const SPACE = 'spaces/TEAM';
const THREAD = `${SPACE}/threads/T1`;
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

const annotation = (id) => ({
  type: 'USER_MENTION',
  userMention: { user: { name: id, displayName: NAMES[id] || 'all', type: id === 'users/app' ? 'BOT' : 'HUMAN' } }
});

function messageBody({ text, sender = CHRIS, mentions = [], thread = THREAD, name = `${SPACE}/messages/in${++seq}` }) {
  return {
    chat: {
      messagePayload: {
        message: {
          name,
          text: `@Oracle ${text}`,
          argumentText: text,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread },
          annotations: [annotation('users/app'), ...mentions.map(annotation)]
        },
        space: { name: SPACE, displayName: 'Team', type: 'ROOM' }
      }
    }
  };
}

const logLines = () => [console.log, console.warn, console.error]
  .flatMap(fn => fn.mock.calls)
  .map(args => args.map(a => (a instanceof Error ? a.message : String(a))).join(' '));
const logged = () => logLines().join('\n');

async function post(body) {
  let answer;
  const res = { status: () => res, json: (b) => { answer = b; return res; } };
  await handleGoogleChatEvent({ headers: { authorization: 'Bearer token' }, body }, res);
  return answer;
}

/** An @Oracle message: wait for the background turn to end, then for card work. */
async function say(opts) {
  const ends = () => logLines().filter(l => l.includes('Chat background task END')).length;
  const before = ends();
  await post(messageBody(opts));
  for (let i = 0; i < 2000 && ends() === before; i++) await new Promise(r => setImmediate(r));
  if (ends() === before) throw new Error('Oracle turn did not finish');
  await whenCardsIdle();
}

const press = (card, action, actor, { now, ...extra } = {}) => handleCardClick({
  actorChatId: actor, actorName: NAMES[actor], actorEmail: EMAILS[actor],
  messageName: card.message_name, parameters: { cardId: card.id, action, ...extra }
}, now);

const dialog = (card, action, actor, type, formInputs = {}) => handleCardDialog({
  actorChatId: actor, actorName: NAMES[actor], isDialogEvent: true, dialogEventType: type,
  parameters: { cardId: card.id, action }, formInputs
});

const leadCards = () => [...fakes.db.cards.values()].filter(c => c.card_type === 'lead');
const liveCard = async () => {
  const cards = leadCards();
  expect(cards).toHaveLength(1);
  return fakes.store.getCard(cards[0].id);
};
const cardPosts = () => fakes.chat.posts.filter(p => p.cardsV2);
const privateReplies = () => fakes.chat.posts.filter(p => p.privateTo).map(p => [p.privateTo, p.text]);
const dmsTo = (space) => fakes.chat.posts.filter(p => p.spaceName === space).map(p => p.text);
const buttonTexts = (cardsV2) => cardButtons(cardsV2).map(b => b.text);
const textOf = async (card) => cardText(await renderCard(card));
// 09:05 in the team's own time zone (Vancouver, the default here), which is
// after the 08:00 floor the reminders wait for.
const atLocal9 = (days, base = Date.now()) => new Date(`${new Date(base + days * DAY).toISOString().slice(0, 10)}T16:05:00Z`);

/** The card as it stands, after a lead message in the thread. */
async function triage(text = LEAD_TEXT, opts = {}) {
  await say({ text, ...opts });
  return liveCard();
}

beforeEach(() => {
  fakes.reset();
  textReplies.length = 0;
  delete process.env.TRACK_DIALOGS_ENABLED;
  fakes.db.users.push(...HUB.map(u => ({ ...u })));
  for (const [id, email] of Object.entries(EMAILS)) {
    fakes.directory.people.set(id, { email, name: NAMES[id] });
  }
  fakes.chat.members.set(SPACE, [NAT, CHRIS, STEPH, LISTENER].map(id => ({ chatUserId: id, displayName: null })));
  fakes.chat.dms.set(NAT, 'spaces/DM-NAT');
  fakes.chat.dms.set(CHRIS, 'spaces/DM-CHRIS');
  fakes.agent.impl = async () => ({ success: true, response: { content: [{ type: 'text', text: 'model answer' }] } });

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// THE TRIGGER
// ============================================================================

describe('the trigger', () => {
  test('a lead message becomes a card, and the model never runs', async () => {
    const card = await triage();

    expect(card.card_type).toBe('lead');
    expect(card.status).toBe('open');
    expect(card.title).toBe(`Lead: ${LEAD.company}`);
    expect(card.data.lead).toMatchObject({ email: LEAD.email, phone: LEAD.phone, company: LEAD.company });
    expect(fakes.agent.calls).toHaveLength(0);
    expect(textReplies).toHaveLength(0);
    expect(cardPosts()).toHaveLength(1);
  });

  test('the card stores the thread’s conversation, which the gate needs', async () => {
    const card = await triage();
    expect(card.conversation_id).toBeTruthy();
  });

  test('an unclear message asks first, with a button', async () => {
    await say({ text: `Can you look at ${LEAD.email} some time` });
    const card = await liveCard();

    expect(card.status).toBe('offered');
    expect(cardText(await renderCard(card))).toContain('Want me to triage this lead?');
    expect(buttonTexts(await renderCard(card))).toEqual(['Triage this lead']);
    expect(fakes.agent.calls).toHaveLength(0);
  });

  test('pressing the offer’s button builds the real card', async () => {
    await say({ text: `Can you look at ${LEAD.email} some time` });
    const offer = await liveCard();
    await press(offer, 'lead.start', CHRIS);
    await whenCardsIdle();

    const card = await liveCard();
    expect(card.status).toBe('open');
    expect(card.data.lead.email).toBe(LEAD.email);
  });

  test('a question is answered by the model, with no card', async () => {
    await say({ text: `What do we know about ${LEAD.company}?` });
    expect(leadCards()).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(1);
  });

  test('a cue with no contact details is left to the model, with no card', async () => {
    await say({ text: 'Someone called in about grants' });
    expect(leadCards()).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(1);
  });

  test('a second lead message in the same thread does not make a second card', async () => {
    await triage();
    await say({ text: `${LEAD.name} called back on ${LEAD.phone}` });

    expect(leadCards()).toHaveLength(1);
    expect(privateReplies().some(([, text]) => /already has a card/.test(text))).toBe(true);
  });
});

// ============================================================================
// WHAT WE KNOW, LIKELY FIT, PROGRAMS, OWNER
// ============================================================================

describe('what the card shows', () => {
  test('no HubSpot record: the card says so and sends the calculator', async () => {
    const card = await triage();
    const text = await textOf(card);

    expect(text).toContain('No HubSpot record found');
    expect(text).toContain('Tier unknown');
    expect(text).toContain('send the calculator');
  });

  test('a past client, its open deals and an earlier "not a fit"', async () => {
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: { id: '501', email: LEAD.email, name: LEAD.name, ownerId: null, calculator: {} },
      company: { id: '900', name: LEAD.company, industry: 'Food and beverage', province: 'BC' },
      deals: [
        { id: 'd1', name: 'Leadsentinel — ETG', open: true, won: false, program: 'ETG', closeDate: null },
        { id: 'd2', name: 'Leadsentinel — CanExport', open: false, won: true, program: 'CanExport', closeDate: '2025-03-01' },
        { id: 'd3', name: 'Leadsentinel — RTRI', open: false, won: false, program: 'RTRI', closeDate: '2024-11-01', lostReason: 'Fee was too expensive' }
      ]
    };
    const card = await triage();
    const text = await textOf(card);

    expect(text).toContain('Past client');
    expect(text).toContain('Open deals');
    expect(text).toContain('Earlier "not a fit"');
    expect(text).toContain('Mentioned price or fees before');
  });

  test('an existing HubSpot owner beats the sector hint', async () => {
    fakes.hubspot.owners = [{ id: '77', fullName: 'Dana Owner', email: 'dana@granted.ca' }];
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: { id: '501', email: LEAD.email, name: LEAD.name, ownerId: '77', calculator: {} },
      company: null,
      deals: []
    };
    const card = await triage();
    const text = await textOf(card);

    expect(card.data.ownerHint.source).toBe('hubspot');
    expect(text).toContain('Dana Owner');
    expect(text).toContain('owns this contact in HubSpot');
  });

  test('with no HubSpot owner, the message’s own words name who covers it — a hint, never an assignment', async () => {
    const card = await triage(`${LEAD.name} called in — ${LEAD.phone}, they run a metalworks shop`);

    expect(card.data.ownerHint).toMatchObject({
      source: 'text',
      industry: 'Metal (Manufacturing)',
      consultant: 'rukshaar',
      name: 'Rukshaar Ali'
    });
    expect(card.data.assignee).toBeNull();
    // The name links to the booking link the lead-gen emails already use.
    expect(await textOf(card)).toContain(
      'Suggested: <a href="https://meetings.hubspot.com/rukshaar-ali">Rukshaar Ali</a> (Metal (Manufacturing) — covers this)'
    );
  });

  test('a known HubSpot industry is taken straight from the booking-link file', async () => {
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: { id: '501', email: LEAD.email, name: LEAD.name, ownerId: null, calculator: { industry: 'Tech - AI' } },
      company: null,
      deals: []
    };
    const card = await triage();

    expect(card.data.ownerHint).toMatchObject({
      source: 'routing',
      industry: 'Tech - AI',
      consultant: 'stephanie',
      name: 'Stephanie Sang'
    });
    expect(await textOf(card)).toContain('>Stephanie Sang</a> (Tech - AI — covers this industry)');
  });

  test('every industry in the booking-link file resolves to the same person as the booking link', async () => {
    const { readFileSync } = await import('fs');
    const { sectorHint } = await import('../../src/cards/lead-lookup.js');
    const routing = JSON.parse(readFileSync('data/rates/consultant-routing.json', 'utf8'));

    // The invariant this card is built on: nothing about who covers what is
    // written down twice, so the name on a card cannot disagree with the link.
    let checked = 0;
    for (const [key, person] of Object.entries(routing.consultants)) {
      for (const industry of person.industries) {
        expect(sectorHint({ industry })).toMatchObject({
          source: 'routing', consultant: key, name: person.name, bookingLink: person.booking_link
        });
        checked++;
      }
    }
    expect(checked).toBe(85);
  });

  test('the words in a message follow that file too — whichever way it is edited', async () => {
    const { readFileSync } = await import('fs');
    const { sectorHint } = await import('../../src/cards/lead-lookup.js');
    const routing = JSON.parse(readFileSync('data/rates/consultant-routing.json', 'utf8'));
    const ownerOf = (industry) => Object.entries(routing.consultants)
      .find(([, person]) => person.industries.includes(industry))?.[0] ?? null;

    // Deliberately no expected names here: whoever owns the industry a phrase
    // resolves to is who the card must name, so reassigning anyone in that file
    // moves the card with it and this test keeps passing.
    for (const text of [
      'a construction contractor',
      'a metalworks shop',
      'an AI software firm',
      'environmental remediation work',
      'green technologies for buildings',
      'a brewery in Kelowna',
      'an accounting practice'
    ]) {
      const hint = sectorHint({ text });
      expect(hint.source).toBe('text');
      expect(hint.industry).toBeTruthy();
      expect(hint.consultant).toBe(ownerOf(hint.industry));
      expect(hint.name).toBe(routing.consultants[hint.consultant].name);
      expect(hint.bookingLink).toBe(routing.consultants[hint.consultant].booking_link);
    }
  });

  test('a word two people share decides nothing, and nothing is invented', async () => {
    const { sectorHint } = await import('../../src/cards/lead-lookup.js');
    // "healthcare" is Healthcare - Dental (Stephanie) and
    // Healthcare - Manufacturing (Rukshaar), so it cannot choose between them.
    expect(sectorHint({ text: 'a healthcare company' })).toMatchObject({ matched: false, source: 'none' });

    const card = await triage(`Someone called in — ${LEAD.phone}, ${LEAD.email}`);
    expect(card.data.ownerHint).toMatchObject({ matched: false, source: 'none', name: null });
    expect(await textOf(card)).toContain('No suggestion — assign whoever should call');
  });

  test('the lead-gen session’s tier and estimate are used when there is one', async () => {
    fakes.leadGen.sessions.set(LEAD.email, {
      sessionId: 's1', at: '2026-09-16T10:00:00Z', tier: 'starter', estimate: '$18,000',
      prospect: { annual_revenue: '$500K to $2.5 million', employee_count: '5 – 19' },
      programs: [{ grant_name: 'Sentinel Training Grant' }], contactName: LEAD.name, companyName: LEAD.company
    });
    const card = await triage();
    const text = await textOf(card);

    expect(card.data.fit).toMatchObject({ tier: 'starter', source: 'lead_gen' });
    expect(text).toContain('Starter');
    expect(text).toContain('$18,000');
    expect(text).toContain('from their calculator session');
    expect(text).toContain('Sentinel Training Grant');
  });

  test('with no session, the contact’s calculator answers go through the funnel', async () => {
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: {
        id: '501', email: LEAD.email, name: LEAD.name, ownerId: null,
        calculator: { revenue: '$5 million to $10 million', employees: 40, industry: 'Manufacturing' }
      },
      company: null,
      deals: []
    };
    const card = await triage();

    expect(card.data.fit).toMatchObject({ tier: 'pro', source: 'hubspot' });
    expect(await textOf(card)).toContain('from their calculator answers in HubSpot');
  });

  test('a hard stop in the message beats every other source', async () => {
    fakes.leadGen.sessions.set(LEAD.email, {
      sessionId: 's1', at: '2026-09-16T10:00:00Z', tier: 'pro', estimate: '$40,000', prospect: {}, programs: []
    });
    const card = await triage(`${LEAD.name} called in — ${LEAD.phone}, ${LEAD.email}. She's a sole proprietor.`);

    expect(card.data.fit).toMatchObject({ tier: 'not_a_fit', source: 'message' });
    const text = await textOf(card);
    expect(text).toContain('Likely not a fit');
    expect(text).toContain('sole proprietor');
    expect(text).toContain('suggest Get Granted');
  });

  test('up to three programs, searched on industry words and never on the company name', async () => {
    fakes.grants.grants = [
      { grant_name: 'Sentinel One', grant_amount: '$10,000', deadline: '2026-11-01', url: 'https://x.test/1' },
      { grant_name: 'Sentinel Two', grant_amount: '$20,000', deadline: null, url: null },
      { grant_name: 'Sentinel Three' },
      { grant_name: 'Sentinel Four' }
    ];
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: { id: '501', email: LEAD.email, name: LEAD.name, ownerId: null, calculator: { industry: 'Food and beverage' } },
      company: null,
      deals: []
    };
    const card = await triage();

    expect(card.data.programs).toHaveLength(3);
    const searched = JSON.stringify(fakes.grants.searches);
    expect(searched).toContain('Food and beverage');
    expect(searched).not.toContain(LEAD.company);
    expect(searched).not.toContain(LEAD.email);
    expect(searched).not.toContain(LEAD.phone);
  });

  test('a HubSpot read that fails leaves a card with what we have', async () => {
    fakes.hubspot.snapshot = { failed: ['company', 'deals'] };
    const card = await triage();

    expect(card.status).toBe('open');
    expect(await textOf(card)).toContain('Couldn’t read company and deals from HubSpot');
  });
});

// ============================================================================
// THE BUTTONS
// ============================================================================

describe('the buttons', () => {
  test('the states each show their own buttons, labelled for where the lead is', async () => {
    const card = await triage();
    expect(buttonTexts(await renderCard(card))).toEqual([
      'I’ll call back', 'Called', 'Assign…', 'Send calculator link', 'Draft reply'
    ]);

    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();
    const owed = await liveCard();
    expect(owed.data.ball).toMatchObject({ state: 'callback', holder: { chatUserId: NAT } });
    expect(buttonTexts(await renderCard(owed))[0]).toBe('Nat Sentinel is calling back');

    await press(owed, 'lead.called', NAT);
    await whenCardsIdle();
    const called = await liveCard();
    expect(buttonTexts(await renderCard(called))).toEqual([
      'Booked discovery', 'Sent calculator', 'Not a fit', 'No answer', 'Assign…'
    ]);

    await press(called, 'lead.booked', NAT);
    await whenCardsIdle();
    const done = await liveCard();
    expect(done.data.outcome).toMatchObject({ key: 'booked', label: 'Booked discovery' });
    expect(buttonTexts(await renderCard(done))).toEqual([
      'I’ll call back', 'Record another call', 'Assign…', 'Draft reply', 'Record in HubSpot', 'Close lead'
    ]);
  });

  test('a press updates the card in place: no new message and no ping', async () => {
    const card = await triage();
    const postsBefore = fakes.chat.posts.length;

    const answer = await press(card, 'lead.callback', NAT);
    await whenCardsIdle();

    expect(answer?.hostAppDataAction?.chatDataAction?.updateMessageAction).toBeTruthy();
    expect(fakes.chat.posts).toHaveLength(postsBefore);
    expect(fakes.chat.patches.length).toBeGreaterThan(0);
  });

  test('every press is logged and the card shows the last one', async () => {
    const card = await triage();
    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();

    const clicks = fakes.db.clicks.filter(c => c.card_id === card.id);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ action: 'lead.callback', result: 'changed' });
    expect(await textOf(await liveCard())).toContain('Nat Sentinel said they’ll call back');
  });

  test('a press that cannot apply gets a private reply and changes nothing', async () => {
    const card = await triage();
    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();
    await press(await liveCard(), 'lead.callback', NAT);
    await whenCardsIdle();

    expect(privateReplies().some(([to, text]) => to === NAT && /already down to call them back/.test(text))).toBe(true);
    expect(fakes.db.clicks.filter(c => c.result === 'already_yours')).toHaveLength(1);
  });

  test('"Send calculator link" answers the presser only — nothing goes to the lead', async () => {
    const card = await triage();
    await press(card, 'lead.calc_link', CHRIS);
    await whenCardsIdle();

    const replies = privateReplies().filter(([to]) => to === CHRIS);
    expect(replies.some(([, text]) => text.includes('granted.ca/get-started'))).toBe(true);
    // No email, no HubSpot write, no message to anyone else.
    expect(fakes.hubspot.outcomes).toHaveLength(0);
    expect(fakes.chat.posts.filter(p => !p.privateTo && p.text)).toHaveLength(0);
  });

  test('"Draft reply" DMs the presser and writes nothing anywhere', async () => {
    fakes.agent.impl = async () => ({ success: true, response: { content: [{ type: 'text', text: 'Subject: Grants\n\nHi Sarah…' }] } });
    const card = await triage();
    await press(card, 'lead.draft', CHRIS);
    await whenCardsIdle();

    expect(dmsTo('spaces/DM-CHRIS').some(t => /Subject: Grants/.test(t))).toBe(true);
    expect(fakes.messages.conversations.at(-1)).toMatchObject({ agentType: 'internal-oracle', title: 'Draft reply to a lead' });
    expect(fakes.hubspot.outcomes).toHaveLength(0);
    expect(fakes.gate.saved).toHaveLength(0);
  });

  test('assigning DMs the assignee once and names them on the card', async () => {
    const card = await triage();
    await dialogPress(card, 'lead.assign', CHRIS, { person: [NAT] });

    const assigned = await liveCard();
    expect(assigned.data.assignee).toMatchObject({ chatUserId: NAT });
    expect(assigned.data.ball.state).toBe('assigned');
    expect(dmsTo('spaces/DM-NAT').filter(t => /assigned you a lead/.test(t))).toHaveLength(1);
    expect(await textOf(assigned)).toContain('Assigned to');
  });
});

/** A dialog round trip: open it, then submit it (dialogs on for this call only). */
async function dialogPress(card, action, actor, formInputs) {
  process.env.TRACK_DIALOGS_ENABLED = 'true';
  try {
    const opened = await dialog(card, action, actor, 'REQUEST_DIALOG');
    expect(opened.action.navigations[0].pushCard).toBeTruthy();
    const form = Object.fromEntries(Object.entries(formInputs).map(([k, v]) => [k, v]));
    const closed = await dialog(card, action, actor, 'SUBMIT_DIALOG',
      Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v])));
    await whenCardsIdle();
    return closed;
  } finally {
    delete process.env.TRACK_DIALOGS_ENABLED;
  }
}

// ============================================================================
// TYPED COMMANDS
// ============================================================================

describe('typed commands', () => {
  test('"called: no answer" records the call and the outcome in one go', async () => {
    const card = await triage();
    await say({ text: 'called: no answer, left a voicemail' });

    const after = await liveCard();
    expect(after.data.calls.at(-1).note).toBe('no answer, left a voicemail');
    expect(after.data.outcome).toMatchObject({ key: 'no_answer' });
    expect(fakes.agent.calls).toHaveLength(0);
  });

  test('"assign @Name" assigns the person who was @mentioned', async () => {
    const card = await triage();
    await say({ text: 'assign @Nat Sentinel', mentions: [NAT] });

    expect((await liveCard()).data.assignee).toMatchObject({ chatUserId: NAT });
  });

  test('"outcome: booked discovery" records the outcome', async () => {
    await triage();
    await say({ text: 'outcome: booked discovery' });

    expect((await liveCard()).data.outcome).toMatchObject({ key: 'booked' });
  });

  test('a typed command with no lead card in the thread falls through to the model', async () => {
    await say({ text: 'called: no answer' });
    expect(leadCards()).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(1);
  });
});

// ============================================================================
// THE WRITE
// ============================================================================

describe('the HubSpot write', () => {
  const withContact = () => {
    fakes.hubspot.owners = [{ id: '77', fullName: 'Nat Sentinel', email: EMAILS[NAT] }];
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: { id: '501', email: LEAD.email, name: LEAD.name, ownerId: null, calculator: {} },
      company: null,
      deals: []
    };
  };

  test('nothing is written until the outcome button, and then only through the gate', async () => {
    withContact();
    const card = await triage();

    // Recording the outcome on the card writes nothing.
    await press(card, 'lead.called', CHRIS);
    await whenCardsIdle();
    await press(await liveCard(), 'lead.booked', CHRIS);
    await whenCardsIdle();
    expect(fakes.gate.saved).toHaveLength(0);
    expect(fakes.hubspot.outcomes).toHaveLength(0);

    // "Record in HubSpot" is the confirmation of exactly what the card shows.
    await press(await liveCard(), 'lead.record', CHRIS);
    await whenCardsIdle();

    expect(fakes.gate.saved).toHaveLength(1);
    expect(fakes.gate.saved[0]).toMatchObject({ tool_name: 'record_lead_outcome', status: 'pending' });
    expect(fakes.hubspot.outcomes).toHaveLength(1);
    expect(fakes.hubspot.outcomes[0]).toMatchObject({ contact_id: '501' });
    expect(fakes.hubspot.outcomes[0].note).toContain('Booked discovery');
    expect((await liveCard()).data.hubspot).toMatchObject({ state: 'added' });
    expect(await textOf(await liveCard())).toContain('Written to HubSpot');
  });

  test('an existing contact keeps its own fields — only the owner and note are added', async () => {
    withContact();
    await triage();
    await say({ text: 'assign @Nat Sentinel', mentions: [NAT] });
    await say({ text: 'outcome: booked discovery' });
    await press(await liveCard(), 'lead.record', CHRIS);
    await whenCardsIdle();

    const written = fakes.hubspot.outcomes[0];
    expect(written.properties).toEqual({});
    expect(written.owner_id).toBe('77');
  });

  test('no contact and no email address: the card says so and writes nothing', async () => {
    const card = await triage(`${LEAD.name} called in on ${LEAD.phone} about training grants`);
    await press(card, 'lead.called', CHRIS);
    await whenCardsIdle();
    await press(await liveCard(), 'lead.no_answer', CHRIS);
    await whenCardsIdle();
    await press(await liveCard(), 'lead.record', CHRIS);
    await whenCardsIdle();

    expect(fakes.gate.saved).toHaveLength(0);
    expect(fakes.hubspot.outcomes).toHaveLength(0);
    expect((await liveCard()).data.hubspot.state).toBe('blocked');
    expect(privateReplies().some(([, t]) => /add the contact in HubSpot first/.test(t))).toBe(true);
  });

  test('a press before an outcome is recorded is refused', async () => {
    withContact();
    const card = await triage();
    await press(card, 'lead.record', CHRIS);
    await whenCardsIdle();

    expect(fakes.gate.saved).toHaveLength(0);
    expect(privateReplies().some(([, t]) => /Record what came of the call first/.test(t))).toBe(true);
  });

  test('a failed write says so and nothing is marked as added', async () => {
    withContact();
    fakes.hubspot.failOutcome = true;
    await triage();
    await say({ text: 'outcome: not a fit' });
    await press(await liveCard(), 'lead.record', CHRIS);
    await whenCardsIdle();

    expect((await liveCard()).data.hubspot.state).toBe('failed');
    expect(privateReplies().some(([, t]) => /didn’t accept that write/.test(t))).toBe(true);
  });
});

// ============================================================================
// DIGEST AND CALLBACK REMINDERS
// ============================================================================

describe('the digest and the callback reminder', () => {
  test('a callback owed is due that day and reminds its holder once, from 08:00', async () => {
    const card = await triage();
    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();

    const owed = await liveCard();
    expect(owed.due_at).toBeTruthy();

    const first = await notify.sendDueReminders(atLocal9(0));
    expect(first.reminders).toBe(1);
    expect(dmsTo('spaces/DM-NAT').filter(t => /Callback today/.test(t))).toHaveLength(1);

    // A second run the same day sends nothing.
    await notify.sendDueReminders(atLocal9(0));
    expect(dmsTo('spaces/DM-NAT').filter(t => /Callback today/.test(t))).toHaveLength(1);
  });

  test('the digest lists a callback you owe and a lead assigned to you', async () => {
    const card = await triage();
    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();

    const digest = await notify.buildDigest(NAT, '2026-09-17', new Date());
    expect(digest.extras.map(i => i.text).join(' ')).toContain('You said you’d call back');
  });

  test('a muted card stays out of the digest', async () => {
    const card = await triage();
    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();
    await fakes.store.setMuted(card.id, NAT, true);

    const digest = await notify.buildDigest(NAT, '2026-09-17', new Date());
    expect(digest.extras).toHaveLength(0);
  });
});

// ============================================================================
// THE LOG RULE
// ============================================================================

describe('logs carry codes and counts only', () => {
  test('no name, email address, phone number or company name anywhere in the logs', async () => {
    fakes.hubspot.owners = [{ id: '77', fullName: 'Nat Sentinel', email: EMAILS[NAT] }];
    fakes.hubspot.snapshot = {
      foundBy: 'email',
      contact: { id: '501', email: LEAD.email, name: LEAD.name, ownerId: '77', calculator: { industry: 'Food and beverage' } },
      company: { id: '900', name: LEAD.company, industry: 'Food and beverage', province: 'BC' },
      deals: [{ id: 'd1', name: 'Leadsentinel — ETG', open: true, won: false, program: 'ETG' }]
    };
    fakes.leadGen.sessions.set(LEAD.email, {
      sessionId: 's1', at: '2026-09-16T10:00:00Z', tier: 'starter', estimate: '$18,000', prospect: {}, programs: []
    });

    const card = await triage();
    await press(card, 'lead.callback', NAT);
    await whenCardsIdle();
    await say({ text: 'called: spoke to her, booked discovery' });
    await press(await liveCard(), 'lead.record', CHRIS);
    await whenCardsIdle();
    await notify.sendDueReminders(atLocal9(0));

    const lines = logged();
    for (const secret of [LEAD.name, LEAD.email, LEAD.phone, LEAD.company, 'Leadsentinel', 'spoke to her']) {
      expect(lines).not.toContain(secret);
    }
    // The digits on their own must not leak either.
    expect(lines).not.toContain('6045550199');
    // And the card's own lines are still there.
    expect(lines).toContain('🧲 Lead card posted');
  });
});
