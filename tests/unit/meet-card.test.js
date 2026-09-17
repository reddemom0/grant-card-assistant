/**
 * The /meet card
 *
 * The command and the "@Oracle find 45 min with …" message go through the real
 * Chat handler; presses through the real click handler; the follow-up DM through
 * the real hourly job. Calendars (free/busy, insert, patch), Granola, the Chat
 * API and the database are the in-memory fakes in helpers/tracked-cards-fakes.js.
 * The model must never run for any of this.
 *
 * The clock is fixed: Thursday 17 September 2026, 08:00 in Vancouver, which is
 * the team's default zone here.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/meet-card.test.js
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
const ORACLE = 'users/app';
const NAMES = { [NAT]: 'Nat Sentinel', [CHRIS]: 'Chris Sentinel', [STEPH]: 'Steph Sentinel', [LISTENER]: 'Oracle' };
const EMAILS = {
  [NAT]: 'nat.sentinel@granted.ca', [CHRIS]: 'chris.sentinel@granted.ca',
  [STEPH]: 'steph.sentinel@granted.ca', [LISTENER]: LISTENER_EMAIL
};
const ALL_SCOPES = 'https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.spaces.readonly';
// Nat 1, Chris 3 have Hub accounts; Steph does not.
const HUB = [{ id: 1, chat: NAT }, { id: 3, chat: CHRIS }].map(u => ({
  id: u.id, email: EMAILS[u.chat], name: NAMES[u.chat], is_active: true,
  google_refresh_token: 'rt', google_granted_scopes: ALL_SCOPES, chat_user_id: u.chat
}));

const TZ = 'America/Vancouver';
const NOW = new Date('2026-09-17T15:00:00Z');   // Thu 08:00 PDT
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
jest.unstable_mockModule('../../src/tools/granola.js', () => fakes.granola.module);

const { handleGoogleChatEvent } = await import('../../src/api/chat-google.js');
const { handleCardClick, whenCardsIdle } = await import('../../src/cards/actions.js');
const { renderCard } = await import('../../src/cards/update.js');
const { applyLifecycle } = await import('../../src/cards/lifecycle.js');
const notify = await import('../../src/cards/notify.js');
const { MEET_COMMAND_ID } = await import('../../src/cards/commands.js');

// --- the thread -----------------------------------------------------------------
const SPACE = 'spaces/TEAM';
const THREAD = `${SPACE}/threads/T1`;
let seq = 0;

const annotation = (id) => ({
  type: 'USER_MENTION',
  userMention: { user: { name: id, displayName: NAMES[id] || 'all', type: id === ORACLE ? 'BOT' : 'HUMAN' } }
});

function chatMessage({ id, sender = NAT, text, at = '2026-09-17T14:00:00Z', thread = THREAD, type = 'HUMAN' }) {
  return {
    name: `${SPACE}/messages/${id}`,
    sender: { name: sender, displayName: NAMES[sender], type },
    text,
    annotations: [],
    createTime: new Date(at).toISOString(),
    thread: { name: thread }
  };
}

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
          annotations: [annotation(ORACLE), ...mentions.map(annotation)]
        },
        space: { name: SPACE, displayName: 'Team', type: 'ROOM' }
      }
    }
  };
}

function commandBody({ sender = CHRIS, thread = THREAD, mentions = [], text = '/meet', name = `${SPACE}/messages/cmd${++seq}` }) {
  return {
    chat: {
      user: { name: sender, displayName: NAMES[sender], type: 'HUMAN' },
      appCommandPayload: {
        appCommandMetadata: { appCommandId: Number(MEET_COMMAND_ID), appCommandType: 'SLASH_COMMAND' },
        message: {
          name, text, argumentText: text.replace(/^\/meet\s*/, ''),
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread },
          annotations: mentions.map(annotation)
        },
        space: { name: SPACE, type: 'ROOM' }
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

async function say(opts) {
  const ends = () => logLines().filter(l => l.includes('Chat background task END')).length;
  const before = ends();
  await post(messageBody(opts));
  for (let i = 0; i < 2000 && ends() === before; i++) await new Promise(r => setImmediate(r));
  if (ends() === before) throw new Error('Oracle turn did not finish');
  await whenCardsIdle();
}

async function command(opts = {}) {
  const answer = await post(commandBody(opts));
  await whenCardsIdle();
  return answer;
}

const press = (card, action, actor, { now, ...extra } = {}) => handleCardClick({
  actorChatId: actor, actorName: NAMES[actor], actorEmail: EMAILS[actor],
  messageName: card.message_name, parameters: { cardId: card.id, action, ...extra }
}, now);

const meetCards = () => [...fakes.db.cards.values()].filter(c => c.card_type === 'meet');
const liveCard = async () => {
  const cards = meetCards();
  expect(cards).toHaveLength(1);
  return fakes.store.getCard(cards[0].id);
};
const textOf = async (card) => cardText(await renderCard(card));
const buttonTexts = (cardsV2) => cardButtons(cardsV2).map(b => b.text);
const buttonsOf = async (card) => buttonTexts(await renderCard(card));
const privateReplies = () => fakes.chat.posts.filter(p => p.privateTo).map(p => [p.privateTo, p.text]);
const dmsTo = (space) => fakes.chat.posts.filter(p => p.spaceName === space).map(p => p.text);
const cardPosts = () => fakes.chat.posts.filter(p => p.cardsV2);

/** A meet card asked for by Chris, with Nat invited. */
async function meetWith({ text = 'find 30 min with @Nat this week', mentions = [NAT] } = {}) {
  await say({ text, mentions });
  return liveCard();
}

beforeEach(() => {
  fakes.reset();
  textReplies.length = 0;
  fakes.db.users.push(...HUB.map(u => ({ ...u })));
  for (const [id, email] of Object.entries(EMAILS)) {
    fakes.directory.people.set(id, { email, name: NAMES[id] });
  }
  fakes.chat.members.set(SPACE, [NAT, CHRIS, STEPH, LISTENER].map(id => ({ chatUserId: id, displayName: null })));
  fakes.chat.dms.set(CHRIS, 'spaces/DM-CHRIS');
  fakes.chat.dms.set(NAT, 'spaces/DM-NAT');
  // Both Hub people keep their calendars in the team's zone.
  fakes.calendar.zones.set(1, TZ);
  fakes.calendar.zones.set(3, TZ);
  fakes.userChat.threads.set(THREAD, [
    chatMessage({ id: 'ask', sender: NAT, text: 'Can we go through the RTRI budget before we send it?' }),
    chatMessage({ id: 'doc', sender: CHRIS, text: 'Draft is here https://docs.google.com/document/d/DOC1/edit — what should we cut?' })
  ]);
  fakes.agent.impl = async () => ({ success: true, response: { content: [{ type: 'text', text: 'model answer' }] } });

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// FINDING TIMES
// ============================================================================

describe('finding times', () => {
  test('an ask becomes a card with three times, and the model never runs', async () => {
    const card = await meetWith();

    expect(card.card_type).toBe('meet');
    expect(card.data.durationMinutes).toBe(30);
    expect(card.data.window.words).toBe('this week');
    expect(card.data.invitees.map(p => p.chatUserId)).toEqual([NAT]);
    expect(card.data.slots).toHaveLength(3);
    expect(fakes.agent.calls).toHaveLength(0);
    expect(cardPosts()).toHaveLength(1);

    const text = await textOf(card);
    expect(text).toContain('With Nat Sentinel · 30 minutes');
    expect(text).toContain('Times everyone is free');
  });

  test('the free/busy read is done as the asker, for everyone on the call', async () => {
    await meetWith();
    const call = fakes.calendar.freeBusyCalls.at(-1);

    expect(call.userId).toBe(3);                       // Chris asked
    expect(call.emails).toEqual(expect.arrayContaining([EMAILS[CHRIS], EMAILS[NAT]]));
  });

  test('/meet as a command does the same', async () => {
    const answer = await command({ text: '/meet 45 min with @Nat', mentions: [NAT] });
    expect(answer).toEqual({});

    const card = await liveCard();
    expect(card.data.durationMinutes).toBe(45);
    expect(card.data.invitees.map(p => p.chatUserId)).toEqual([NAT]);
  });

  test('busy time is never offered, and the times are shown in the asker’s zone', async () => {
    fakes.calendar.busy.set(EMAILS[NAT], [{ start: '2026-09-17T17:00:00Z', end: '2026-09-17T23:00:00Z' }]);
    const card = await meetWith();

    for (const slot of card.data.slots) {
      expect(Date.parse(slot.end) <= Date.parse('2026-09-17T17:00:00Z')
        || Date.parse(slot.start) >= Date.parse('2026-09-17T23:00:00Z')).toBe(true);
    }
    expect(await textOf(card)).toContain('PDT');
  });

  test('Oracle, the listener account and apps are never invited', async () => {
    const card = await meetWith({ text: 'set up a call with @Nat', mentions: [NAT, LISTENER, ORACLE] });
    expect(card.data.invitees.map(p => p.chatUserId)).toEqual([NAT]);
  });

  test('nobody @mentioned: Oracle asks who, and makes no card', async () => {
    await say({ text: 'set up a call about the RTRI budget' });

    expect(meetCards()).toHaveLength(0);
    expect(privateReplies().some(([to, t]) => to === CHRIS && /Who should be on the call/.test(t))).toBe(true);
  });

  test('a calendar that could not be read is named, not treated as free', async () => {
    fakes.calendar.unseen = [EMAILS[NAT]];
    const card = await meetWith();

    expect(card.data.unseen).toEqual([EMAILS[NAT]]);
    expect(await textOf(card)).toContain('Couldn’t see one calendar');
  });

  test('someone with no Hub account is assumed to be in the default zone, and the card says so', async () => {
    const card = await meetWith({ text: 'find 30 min with @Steph this week', mentions: [STEPH] });

    expect(card.data.noTimeZone).toHaveLength(1);
    expect(await textOf(card)).toContain('No calendar time zone for 1 person');
  });

  test('nothing fits: the card says so and offers next week and ignoring hours', async () => {
    fakes.calendar.busy.set(EMAILS[NAT], [{ start: '2026-09-17T00:00:00Z', end: '2026-09-26T00:00:00Z' }]);
    const card = await meetWith();

    expect(card.data.slots).toEqual([]);
    expect(await textOf(card)).toContain('No time in that window works for everyone');
    expect(await buttonsOf(card)).toEqual(['Try next week', 'Ignore working hours', 'Check again']);
  });

  test('"Ignore working hours" looks again outside 9–5', async () => {
    // Free only at 19:00 local, which working hours rule out.
    fakes.calendar.busy.set(EMAILS[NAT], [
      { start: '2026-09-17T00:00:00Z', end: '2026-09-18T02:00:00Z' },
      { start: '2026-09-18T03:00:00Z', end: '2026-09-26T00:00:00Z' }
    ]);
    const card = await meetWith();
    expect(card.data.slots).toEqual([]);

    await press(card, 'meet.ignore_hours', CHRIS);
    await whenCardsIdle();

    const after = await liveCard();
    expect(after.data.ignoreHours).toBe(true);
    expect(after.data.slots.length).toBeGreaterThan(0);
    expect(await textOf(after)).toContain('Working hours ignored on this card');
  });

  test('"Try next week" moves the window on', async () => {
    const card = await meetWith();
    const firstSlot = card.data.slots[0].start;

    await press(card, 'meet.next_week', CHRIS);
    await whenCardsIdle();

    const after = await liveCard();
    expect(Date.parse(after.data.slots[0].start)).toBeGreaterThan(Date.parse(firstSlot));
    expect(after.data.window.words).toBe('the following week');
  });

  test('a free/busy failure leaves the card up and says why', async () => {
    fakes.calendar.failFreeBusy = 'Your Google sign-in needs refreshing — sign in to the Hub again.';
    const card = await meetWith();

    expect(card.data.slots).toEqual([]);
    expect(await textOf(card)).toContain('sign in to the Hub again');
  });

  test('a second ask in the same thread points at the card that is already there', async () => {
    await meetWith();
    await say({ text: 'set up a call with @Nat', mentions: [NAT] });

    expect(meetCards()).toHaveLength(1);
    expect(privateReplies().some(([, t]) => /already has a meeting card/.test(t))).toBe(true);
  });
});

// ============================================================================
// BOOKING
// ============================================================================

describe('booking', () => {
  test('the requester books at once: one event, invites sent, Meet link on the card', async () => {
    const card = await meetWith();
    const slot = card.data.slots[0];

    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();

    expect(fakes.calendar.events).toHaveLength(1);
    const event = fakes.calendar.events[0];
    expect(event).toMatchObject({ userId: 3, start: slot.start, end: slot.end, sendUpdates: 'all' });
    expect(event.attendees.map(a => a.email)).toEqual([EMAILS[NAT]]);
    expect(event.meet_link).toBeTruthy();

    const after = await liveCard();
    expect(after.data.event).toMatchObject({ id: event.id, byUserId: 3, invited: 1 });
    const text = await textOf(after);
    expect(text).toContain('Booked');
    expect(text).toContain('Invites sent to 1 person');
    expect(text).toContain('Meet link');
  });

  test('the event description carries the ask, the thread link and the Doc found in it', async () => {
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();

    const { description } = fakes.calendar.events[0];
    expect(description).toContain('The ask: Can we go through the RTRI budget');
    expect(description).toContain('https://docs.google.com/document/d/DOC1/edit');
    expect(description).toContain('Open question');
    expect(description).toContain('https://chat.google.com/room/TEAM');
  });

  test('an invitee cannot book in the first two hours, and can afterwards', async () => {
    const card = await meetWith();

    await press(card, 'meet.book1', NAT);
    await whenCardsIdle();
    expect(fakes.calendar.events).toHaveLength(0);
    expect(privateReplies().some(([to, t]) => to === NAT && /they book first/.test(t))).toBe(true);

    await press(card, 'meet.book1', NAT, { now: new Date(Date.now() + 3 * HOUR) });
    await whenCardsIdle();
    expect(fakes.calendar.events).toHaveLength(1);
    // Still created on the requester's calendar, whoever pressed.
    expect(fakes.calendar.events[0].userId).toBe(3);
  });

  test('somebody not on the call cannot book it', async () => {
    const card = await meetWith();
    await press(card, 'meet.book1', STEPH, { now: new Date(Date.now() + 3 * HOUR) });
    await whenCardsIdle();

    expect(fakes.calendar.events).toHaveLength(0);
    expect(privateReplies().some(([to, t]) => to === STEPH && /Only the people on this call/.test(t))).toBe(true);
  });

  test('a booking that fails says nothing was created', async () => {
    fakes.calendar.failInsert = true;
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();

    const after = await liveCard();
    expect(after.data.event).toBeNull();
    expect(await textOf(after)).toContain('couldn’t book it — nothing was created');
  });

  test('a press updates the card in place: no new message, no ping', async () => {
    const card = await meetWith();
    const posts = fakes.chat.posts.length;

    const answer = await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();

    expect(answer?.hostAppDataAction?.chatDataAction?.updateMessageAction).toBeTruthy();
    expect(fakes.chat.posts).toHaveLength(posts);
    expect(fakes.chat.patches.length).toBeGreaterThan(0);
  });

  test('personal marks: these work for me / none work', async () => {
    const card = await meetWith();
    await press(card, 'meet.works', NAT);
    await whenCardsIdle();
    expect(await textOf(await liveCard())).toContain('These work for: Nat Sentinel');

    await press(await liveCard(), 'meet.none', CHRIS);
    await whenCardsIdle();
    expect(await textOf(await liveCard())).toContain('None work for: Chris Sentinel');
  });

  test('someone not on the call has nothing to answer', async () => {
    const card = await meetWith();
    await press(card, 'meet.works', STEPH);
    await whenCardsIdle();

    expect((await liveCard()).data.votes).toEqual({});
    expect(privateReplies().some(([to, t]) => to === STEPH && /not on this call/.test(t))).toBe(true);
  });
});

// ============================================================================
// RESCHEDULING
// ============================================================================

describe('rescheduling', () => {
  test('a reschedule patches the same event, keeps its Meet link, and moves it as its creator', async () => {
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();
    const eventId = fakes.calendar.events[0].id;
    const meetLink = fakes.calendar.events[0].meet_link;

    // Nat presses Reschedule, which looks again…
    await press(await liveCard(), 'meet.reschedule', NAT);
    await whenCardsIdle();
    const looking = await liveCard();
    expect(looking.data.slots.length).toBeGreaterThan(0);
    expect(await buttonsOf(looking)).toEqual(expect.arrayContaining([
      expect.stringContaining('Move to'), 'Keep the booked time'
    ]));
    // The booking is still on the card while the new times are being weighed.
    expect(await textOf(looking)).toContain('Booked');

    // …and booking a new time moves the original event.
    await press(looking, 'meet.book2', NAT, { now: new Date(Date.now() + 3 * HOUR) });
    await whenCardsIdle();

    expect(fakes.calendar.events).toHaveLength(1);
    const event = fakes.calendar.events[0];
    expect(event.id).toBe(eventId);
    expect(event.meet_link).toBe(meetLink);
    expect(event.patches).toHaveLength(1);
    // Patched as the person who created it, not as the presser.
    expect(event.patches[0]).toMatchObject({ userId: 3, send_updates: 'all' });
    expect(event.start).toBe(looking.data.slots[1].start);

    const after = await liveCard();
    expect(after.data.event).toMatchObject({ id: eventId, start: looking.data.slots[1].start });
    expect(await textOf(after)).toContain('Moved by Nat Sentinel');
  });

  test('a patch that fails leaves the booking alone', async () => {
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();
    const booked = await liveCard();
    const was = booked.data.event.start;

    fakes.calendar.failPatch = true;
    await press(booked, 'meet.reschedule', CHRIS);
    await whenCardsIdle();
    await press(await liveCard(), 'meet.book1', CHRIS);
    await whenCardsIdle();

    const after = await liveCard();
    expect(after.data.event.start).toBe(was);
    expect(await textOf(after)).toContain('couldn’t move the meeting — nothing changed');
  });
});

// ============================================================================
// AFTER THE CALL
// ============================================================================

describe('after the call', () => {
  /** A booked meeting that came from a /track card, ending `endsAgo` ms ago. */
  async function bookedFromTrack({ endsAgo = HOUR } = {}) {
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();
    const booked = await liveCard();
    const end = new Date(Date.now() - endsAgo);
    await fakes.store.patchCardData(booked.id, {
      trackCardId: 'track-1',
      event: { ...booked.data.event, start: new Date(end.getTime() - 30 * 60 * 1000).toISOString(), end: end.toISOString() }
    });
    await fakes.store.setDue(booked.id, end);
    return fakes.store.getCard(booked.id);
  }

  test('one DM to whoever asked, once the meeting is over, with the Granola note', async () => {
    fakes.granola.meetings = [{
      title: 'RTRI budget call',
      start_time: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      summary: 'Agreed to cut the travel line and resubmit on Friday.'
    }];
    const card = await bookedFromTrack();

    const counts = await notify.sendDueReminders(new Date());
    expect(counts.followups).toBe(1);

    const dms = dmsTo('spaces/DM-CHRIS').filter(t => /what was decided/.test(t));
    expect(dms).toHaveLength(1);
    expect(dms[0]).toContain('Agreed to cut the travel line');
    expect(dms[0]).toContain('@Oracle decision:');

    // Never twice.
    await notify.sendDueReminders(new Date());
    expect(dmsTo('spaces/DM-CHRIS').filter(t => /what was decided/.test(t))).toHaveLength(1);
    expect((await fakes.store.getCard(card.id)).data.followup).toMatchObject({ note: true });
  });

  test('no Granola note is a normal outcome — the DM still goes, and says so', async () => {
    fakes.granola.fail = true;
    await bookedFromTrack();

    await notify.sendDueReminders(new Date());
    const dm = dmsTo('spaces/DM-CHRIS').find(t => /what was decided/.test(t));
    expect(dm).toContain('couldn’t find a meeting note');
  });

  test('a meeting that did not come from a tracked ask gets no DM', async () => {
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();
    const booked = await liveCard();
    const end = new Date(Date.now() - HOUR);
    await fakes.store.patchCardData(booked.id, { event: { ...booked.data.event, end: end.toISOString() } });
    await fakes.store.setDue(booked.id, end);

    const counts = await notify.sendDueReminders(new Date());
    expect(counts.followups).toBe(0);
    expect(dmsTo('spaces/DM-CHRIS')).toHaveLength(0);
  });

  test('nothing is sent while the meeting has only just ended', async () => {
    await bookedFromTrack({ endsAgo: 5 * 60 * 1000 });
    expect((await notify.sendDueReminders(new Date())).followups).toBe(0);
  });

  test('"Record the decision" says what to type', async () => {
    const card = await bookedFromTrack();
    await press(card, 'meet.decision', CHRIS);
    await whenCardsIdle();

    expect(privateReplies().some(([to, t]) => to === CHRIS && /@Oracle decision:/.test(t))).toBe(true);
  });

  test('a card nobody booked closes itself once its window is well past', async () => {
    const card = await meetWith();
    await fakes.store.patchCardData(card.id, {
      window: { ...card.data.window, to: new Date(Date.now() - 20 * DAY).toISOString() }
    });

    const counts = await notify.sendDueReminders(new Date());
    expect(counts.meetClosed).toBe(1);
    expect((await fakes.store.getCard(card.id)).status).toBe('closed');
  });

  test('a booked meeting weeks out never goes stale', async () => {
    const card = await meetWith();
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();

    // 40 days of silence would stale-and-close any ordinary card.
    const later = new Date(Date.now() + 40 * DAY);
    await applyLifecycle(later);

    expect((await fakes.store.getCard(card.id)).status).toBe('open');
  });
});

// ============================================================================
// LOGS
// ============================================================================

describe('logs carry codes and counts only', () => {
  test('no topic, name, address or time in any log line', async () => {
    const card = await meetWith({ text: 'find 30 min with @Nat about the Leadsentinel Foods budget', mentions: [NAT] });
    await press(card, 'meet.book1', CHRIS);
    await whenCardsIdle();
    await notify.sendDueReminders(new Date());

    const lines = logged();
    for (const secret of ['Leadsentinel Foods', NAMES[NAT], EMAILS[NAT], 'docs.google.com', 'meet.google.com']) {
      expect(lines).not.toContain(secret);
    }
    expect(lines).toContain('📅 Meet card posted');
    expect(lines).toContain('📅 Meet booking — result: booked');
  });
});
