/**
 * The /track card — "who has the ball"
 *
 * Messages and /track commands go through the real Chat handler; presses
 * through the real click handler; dialogs through the real dialog router; the
 * digest, due-date messages, lifecycle and the listened-space hook are real.
 * The database, the Chat API (as the app and as a person), the directory and
 * calendar are the in-memory fakes in helpers/tracked-cards-fakes.js. The model
 * must never run for any of this.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/track-card.test.js
 */

import { jest } from '@jest/globals';
import { createTrackedCardFakes, cardText, cardButtons, allCardStrings } from './helpers/tracked-cards-fakes.js';

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
delete process.env.CHAT_TRACK_COMMAND_ID;

const fakes = createTrackedCardFakes();

// --- people ---------------------------------------------------------------------
// Sentinels: none of these, and none of the ask's words, may appear in a log.
const NAT = 'users/nat';
const JASON = 'users/jason';
const STEPH = 'users/steph';
const CHRIS = 'users/chris';
const LISTENER = 'users/listener';
const NAMES = {
  [NAT]: 'Nat Sentinel', [JASON]: 'Jason Sentinel', [STEPH]: 'Steph Sentinel',
  [CHRIS]: 'Chris Sentinel', [LISTENER]: 'Oracle'
};
const EMAILS = {
  [NAT]: 'nat.sentinel@granted.ca', [JASON]: 'jason.sentinel@granted.ca',
  [STEPH]: 'steph.sentinel@granted.ca', [CHRIS]: 'chris.sentinel@granted.ca', [LISTENER]: LISTENER_EMAIL
};
const ALL_SCOPES = 'https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.spaces.readonly';
// Hub users: Nat 1, Jason 2, Chris 3. Steph has no Hub account.
const HUB = [
  { id: 1, chat: NAT }, { id: 2, chat: JASON }, { id: 3, chat: CHRIS }
].map(u => ({
  id: u.id, email: EMAILS[u.chat], name: NAMES[u.chat], is_active: true,
  google_refresh_token: 'rt', google_granted_scopes: ALL_SCOPES, chat_user_id: u.chat
}));

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
const listened = new Set();
jest.unstable_mockModule('../../src/chat-listen/config.js', () => ({
  isListenSpace: (s) => listened.has(s),
  listenReady: () => listened.size > 0,
  listenDisabled: () => false,
  listenSpaces: () => [],
  listenEntry: () => null
}));
jest.unstable_mockModule('../../src/database/chat-listen-store.js', () => fakes.listen.module);
jest.unstable_mockModule('../../src/claude/client.js', () => fakes.agent.module);
jest.unstable_mockModule('../../src/database/messages.js', () => fakes.messages.module);
jest.unstable_mockModule('../../src/database/tracked-cards-store.js', () => fakes.store);
jest.unstable_mockModule('../../src/cards/chat-api.js', () => fakes.chat.module);
jest.unstable_mockModule('../../src/tools/google-drive.js', () => fakes.drive.module);
jest.unstable_mockModule('../../src/tools/hubspot.js', () => fakes.hubspot.module);
jest.unstable_mockModule('../../src/tools/pending-actions.js', () => fakes.gate.module);
jest.unstable_mockModule('../../src/tools/directory-names.js', () => fakes.directory.module);
jest.unstable_mockModule('../../src/tools/google-calendar.js', () => fakes.calendar.module);

const { handleGoogleChatEvent } = await import('../../src/api/chat-google.js');
const { handleCardClick, whenCardsIdle } = await import('../../src/cards/actions.js');
const { handleCardDialog } = await import('../../src/cards/dialogs.js');
const { renderCard } = await import('../../src/cards/update.js');
const { applyLifecycle } = await import('../../src/cards/lifecycle.js');
const notify = await import('../../src/cards/notify.js');
const { onThreadMessages } = await import('../../src/cards/track-card.js');
const { readChatSpaceHistory } = await import('../../src/tools/chat-history.js');

// --- the thread ----------------------------------------------------------------
const SPACE = 'spaces/TEAM';
const THREAD = `${SPACE}/threads/T1`;
const ASK_AT = '2026-09-17T16:00:00Z';
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

const annotation = (id) => ({
  type: 'USER_MENTION',
  userMention: { user: { name: id, displayName: NAMES[id] || 'all', type: id === 'users/app' ? 'BOT' : 'HUMAN' } }
});

/** A Chat API message in a thread. */
function chatMessage({ id, sender = NAT, text, mentions = [], at = ASK_AT, thread = THREAD, type = 'HUMAN' }) {
  return {
    name: `${SPACE}/messages/${id}`,
    sender: { name: sender, displayName: NAMES[sender], type },
    text,
    annotations: mentions.map(annotation),
    createTime: new Date(at).toISOString(),
    thread: { name: thread }
  };
}

const ASK_TEXT = '@Jason Sentinel can you send the industry list by Oct 1, 2030?';
function setThread(messages, thread = THREAD) {
  fakes.userChat.threads.set(thread, messages);
}
const oneBallAsk = (extra = {}) => chatMessage({ id: 'ask', text: ASK_TEXT, mentions: [JASON], ...extra });

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

function commandBody({ sender = CHRIS, thread = THREAD, name = `${SPACE}/messages/cmd${++seq}`, text = '/track' }) {
  return {
    chat: {
      user: { name: sender, displayName: NAMES[sender], type: 'HUMAN' },
      appCommandPayload: {
        appCommandMetadata: { appCommandId: 1, appCommandType: 'SLASH_COMMAND' },
        message: {
          name, text, argumentText: text,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread }
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

/** An @Oracle message: wait for the background turn to end, then for card work. */
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
  actorChatId: actor, actorName: NAMES[actor], actorEmail: null,
  messageName: card.message_name, parameters: { cardId: card.id, action, ...extra }
}, now);

const dialog = (card, action, actor, type, formInputs = {}) => handleCardDialog({
  actorChatId: actor, actorName: NAMES[actor], isDialogEvent: true, dialogEventType: type,
  parameters: { cardId: card.id, action }, formInputs
});

const updated = (r) => r?.hostAppDataAction?.chatDataAction?.updateMessageAction?.message?.cardsV2;
const liveCard = async () => {
  const cards = [...fakes.db.cards.values()].filter(c => c.card_type === 'track');
  expect(cards).toHaveLength(1);
  return fakes.store.getCard(cards[0].id);
};
const cardPosts = () => fakes.chat.posts.filter(p => p.cardsV2);
const privateReplies = () => fakes.chat.posts.filter(p => p.privateTo).map(p => [p.privateTo, p.text]);
const dmsTo = (space) => fakes.chat.posts.filter(p => p.spaceName === space).map(p => p.text);
const lastPatch = () => fakes.chat.patches.at(-1).cardsV2;
const buttonTexts = (cardsV2) => cardButtons(cardsV2).map(b => b.text);
const members = async (cardId) => Object.fromEntries((await fakes.store.getParticipants(cardId))
  .filter(p => p.role === 'member').map(p => [p.chat_user_id, p.status]));
const at8 = (days, base = Date.now()) => new Date(`${new Date(base + days * DAY).toISOString().slice(0, 10)}T08:05:00Z`);
const startOfTodayUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();

beforeEach(() => {
  fakes.reset();
  textReplies.length = 0;
  listened.clear();
  delete process.env.TRACK_DIALOGS_ENABLED;
  fakes.db.users.push(...HUB.map(u => ({ ...u })));
  for (const [id, email] of Object.entries(EMAILS)) {
    fakes.directory.people.set(id, { email, name: NAMES[id] });
  }
  fakes.chat.members.set(SPACE, [NAT, JASON, STEPH, LISTENER, CHRIS].map(id => ({ chatUserId: id, displayName: null })));
  fakes.chat.dms.set(JASON, 'spaces/DM-JASON');
  fakes.chat.dms.set(NAT, 'spaces/DM-NAT');
  setThread([oneBallAsk()]);
  fakes.agent.impl = async () => ({ success: true, response: { content: [{ type: 'text', text: 'model answer' }] } });

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await whenCardsIdle();
  // The Chat handler's own "Accepted — user N (email)" line predates cards.
  const output = logLines().filter(l => !l.startsWith('✅ Accepted')).join('\n');
  jest.restoreAllMocks();
  expect(output).not.toMatch(/Sentinel/);
  expect(output).not.toMatch(/@granted\.ca/);
  expect(output).not.toMatch(/industry|meeting links|NAICS|template/i);
  expect(output).not.toMatch(/threads\/T1|messages\/ask/);
});

// ============================================================================
// STARTING
// ============================================================================

describe('starting to track', () => {
  test('/track in a thread tracks its first message: one card, answered with {} and no model', async () => {
    const answer = await command();

    expect(answer).toEqual({});
    const card = await liveCard();
    expect(card).toMatchObject({
      status: 'open', owner_chat_id: NAT, owner_user_id: 1, source_message_name: `${SPACE}/messages/ask`,
      title: ASK_TEXT, conversation_id: null
    });
    expect(card.data).toMatchObject({
      shape: 'one', feedback: false, requesterName: NAMES[NAT],
      ball: { state: 'person', holder: { chatUserId: JASON, name: NAMES[JASON] }, source: `${SPACE}/messages/ask`, guess: false },
      due: { label: 'by Oct 1, 2030', hasTime: false }
    });
    expect(new Date(card.due_at).toISOString()).toBe('2030-10-02T06:59:00.000Z');   // 23:59 in Vancouver

    expect(cardPosts()).toHaveLength(1);
    const post = cardPosts()[0];
    expect(post).toMatchObject({ spaceName: SPACE, threadName: THREAD, name: card.message_name });
    const { header, sections } = post.cardsV2[0].card;
    expect(header).toEqual({ title: ASK_TEXT, subtitle: `Track · asked by ${NAMES[NAT]} · One ball` });
    const status = sections[0].widgets[0].textParagraph.text;
    expect(status).toMatch(new RegExp(`^With <b>${NAMES[JASON]}</b> · since \\w{3} \\d+<br>Due Tue, Oct 1<br>`));
    expect(status).toContain('<a href="https://chat.google.com/room/TEAM/T1/ask">based on this message</a>');
    expect(buttonTexts(post.cardsV2)).toEqual([
      'I’ll take it', 'Pass to…', 'Waiting on client', 'Call needed', 'Someone promised…',
      'Record decision', 'Resolved', 'Refresh', 'Switch to everyone'
    ]);
    for (const b of cardButtons(post.cardsV2)) expect(b.fn).toBe(ENDPOINT);

    // The thread was read as the person who typed /track; the holder was told once.
    expect(fakes.userChat.calls[0]).toMatchObject({ userId: 3, parent: SPACE, filter: `thread.name = ${THREAD}`, pageSize: 1 });
    expect(dmsTo('spaces/DM-JASON')).toEqual([`${NAMES[NAT]} passed you the ball on “${ASK_TEXT}”. https://chat.google.com/room/TEAM/T1`]);
    expect(dmsTo('spaces/DM-NAT')).toEqual([]);
    expect(fakes.agent.calls).toEqual([]);
    expect(logged()).toContain('Track card posted — trigger: command, shape: one, holder: yes, people: 0, due: yes');
  });

  test('/track typed as a new message has nothing above it to track: a private how-to', async () => {
    const name = `${SPACE}/messages/cmd-top`;
    setThread([chatMessage({ id: 'cmd-top', sender: CHRIS, text: '/track' })], `${SPACE}/threads/TOP`);
    await command({ thread: `${SPACE}/threads/TOP`, name });
    expect(fakes.db.cards.size).toBe(0);
    expect(privateReplies()).toEqual([[CHRIS, 'Use /track (or "@Oracle track this") as a reply in the thread you want tracked.']]);
  });

  test('…unless words follow /track: then they are the ask', async () => {
    const name = `${SPACE}/messages/cmd-top`;
    setThread([chatMessage({ id: 'cmd-top', sender: CHRIS, text: '/track Steph to update the deck by Oct 1, 2030', mentions: [STEPH] })], `${SPACE}/threads/TOP`);
    await command({ thread: `${SPACE}/threads/TOP`, name, text: '/track Steph to update the deck by Oct 1, 2030' });
    const card = await liveCard();
    expect(card).toMatchObject({ title: 'Steph to update the deck by Oct 1, 2030', owner_chat_id: CHRIS });
    expect(card.data.ball.holder.chatUserId).toBe(STEPH);
  });

  test('someone not signed in to the Hub is told privately, and nothing is read', async () => {
    await command({ sender: STEPH });
    expect(fakes.db.cards.size).toBe(0);
    expect(fakes.userChat.calls).toEqual([]);
    expect(privateReplies()).toEqual([[STEPH, expect.stringContaining('https://hub.example/login')]]);
  });

  test('a thread is tracked once; asking again gets a private note', async () => {
    await command();
    await command({ sender: JASON });
    expect(fakes.db.cards.size).toBe(1);
    expect(cardPosts()).toHaveLength(1);
    expect(privateReplies()).toEqual([[JASON, 'This thread is already tracked — its card is in the thread.']]);
  });

  test('"@Oracle track this" makes the card without the model; the card is the whole reply', async () => {
    await say({ text: 'track this' });
    const card = await liveCard();
    expect(card.data.ball.holder.chatUserId).toBe(JASON);
    expect(textReplies).toEqual([]);
    expect(fakes.agent.calls).toEqual([]);
    expect(logged()).toContain('Handled by the track card — kind: track');
    expect(logged()).toContain('Track card posted — trigger: mention');
  });

  test('"keep an eye on this" asks first; Track this turns the question into the card', async () => {
    await say({ text: 'keep an eye on this' });
    const offer = [...fakes.db.cards.values()][0];
    expect(offer).toMatchObject({ status: 'offered', card_type: 'track' });
    expect(cardPosts()[0].cardsV2[0].card.header.title).toBe('Want me to track this?');
    expect(buttonTexts(cardPosts()[0].cardsV2)).toEqual(['Track this']);
    expect(fakes.agent.calls).toEqual([]);

    const response = await press(offer, 'track.start', STEPH);
    expect(cardText(updated(response))).toContain('Last update: Setting up tracking…');
    expect(cardButtons(updated(response))).toEqual([expect.objectContaining({ text: 'Setting up…', disabled: true })]);
    await whenCardsIdle();

    const card = await liveCard();
    expect(card).toMatchObject({ id: offer.id, status: 'open', message_name: offer.message_name, owner_chat_id: NAT });
    expect(cardPosts()).toHaveLength(1);                           // the same message became the card
    expect(cardText(lastPatch())).toContain(`With <b>${NAMES[JASON]}</b>`);
    // Steph has no Hub account: the thread was read as the person who asked Oracle.
    expect(fakes.userChat.calls.at(-1).userId).toBe(3);
  });

  test('plain questions stay plain answers', async () => {
    await say({ text: 'who has the ball on the industry list?' });
    expect(fakes.db.cards.size).toBe(0);
    expect(fakes.agent.calls).toHaveLength(1);
    expect(textReplies).toEqual(['model answer']);
  });

  test('a typed command in a thread without a track card goes to the model', async () => {
    await say({ text: 'decision: we will think about it' });
    expect(fakes.db.cards.size).toBe(0);
    expect(fakes.agent.calls).toHaveLength(1);
  });
});

// ============================================================================
// WHO HOLDS IT
// ============================================================================

describe('the holder and the shape', () => {
  test('the holder is the first real person — never Oracle, the listener account or @all', async () => {
    setThread([oneBallAsk({ mentions: [LISTENER, JASON] })]);
    await command();
    expect((await liveCard()).data.ball.holder.chatUserId).toBe(JASON);
  });

  test('nobody named: Unassigned, and I’ll take it gives the ball to the presser — only once, and never to the listener', async () => {
    setThread([chatMessage({ id: 'ask', text: 'can someone send the industry list?' })]);
    await command();
    let card = await liveCard();
    expect(cardText(await renderCard(card))).toContain('Unassigned — press <b>I’ll take it</b>');
    expect(dmsTo('spaces/DM-JASON')).toEqual([]);

    const took = await press(card, 'track.take', STEPH);
    expect(cardText(updated(took))).toContain(`With <b>${NAMES[STEPH]}</b>`);
    expect(await members(card.id)).toEqual({ [STEPH]: null });

    await press(card, 'track.take', STEPH);
    await fakes.store.upsertPerson({ chatUserId: LISTENER, email: LISTENER_EMAIL });
    await press(card, 'track.take', LISTENER);
    await whenCardsIdle();
    card = await liveCard();
    expect(card.data.ball.holder.chatUserId).toBe(STEPH);
    expect(privateReplies()).toEqual([[STEPH, 'It’s already with you.'], [LISTENER, 'This account can’t take the ball.']]);
  });

  test('@all / "everyone": a checklist of the space minus the requester, Oracle and the listener', async () => {
    setThread([chatMessage({ id: 'ask', text: '@all everyone switch your meeting links by Oct 1, 2030', mentions: ['users/all'] })]);
    await command();
    const card = await liveCard();
    expect(card.data).toMatchObject({ shape: 'everyone', feedback: false, checklist: { built: true, code: null } });
    expect(card.data.ball.state).toBe('unassigned');
    expect(await members(card.id)).toEqual({ [JASON]: 'pending', [STEPH]: 'pending', [CHRIS]: 'pending' });
    // The requester holds no part of their own ask.
    expect((await fakes.store.getParticipants(card.id)).find(p => p.chat_user_id === NAT))
      .toMatchObject({ role: 'owner', status: null });
    expect(dmsTo('spaces/DM-JASON')).toEqual([]);                  // everyone sees it in their digest

    const cardsV2 = cardPosts()[0].cardsV2;
    expect(cardsV2[0].card.header.subtitle).toBe(`Track · asked by ${NAMES[NAT]} · Everyone`);
    const text = cardText(cardsV2);
    expect(text).toContain('<b>0 of 3 done</b><br>Due Tue, Oct 1<br>Still to do: ');
    expect(text).toContain('People in this space only through a Google Group aren’t listed.');
    expect(text).toMatch(/Still to do: [^<]*$/m);
    expect(/Still to do: ([^<\n]*)/.exec(text)[1]).not.toContain(NAMES[NAT]);   // the requester has no part
    expect(buttonTexts(cardsV2)).toEqual(['I’ve done it', 'I need help', 'Remove people…', 'Refresh', 'Switch to one ball']);
  });

  test('Switch keeps the card; the everyone list is built once, after answering', async () => {
    await command();
    const card = await liveCard();
    const switched = await press(card, 'track.switch', NAT);
    expect(cardText(updated(switched))).toContain('Last update: Building the list…');
    await whenCardsIdle();
    expect(await members(card.id)).toEqual({ [JASON]: 'pending', [STEPH]: 'pending', [CHRIS]: 'pending' });
    expect(fakes.chat.memberCalls).toEqual([SPACE]);

    await press(card, 'track.switch', NAT);
    await press(card, 'track.switch', NAT);
    await whenCardsIdle();
    expect(fakes.chat.memberCalls).toEqual([SPACE]);
    expect((await liveCard()).id).toBe(card.id);
    expect(cardPosts()).toHaveLength(1);
  });

  test('personal buttons mark only the presser; someone not listed is added; help is visible', async () => {
    setThread([chatMessage({ id: 'ask', text: 'team, please update your signatures', mentions: [] })]);
    fakes.chat.members.set(SPACE, [NAT, JASON, STEPH].map(id => ({ chatUserId: id })));
    await command();
    const card = await liveCard();

    await press(card, 'track.done', JASON);
    const help = await press(card, 'track.help', CHRIS);
    expect(await members(card.id)).toEqual({ [JASON]: 'done', [STEPH]: 'pending', [CHRIS]: 'needs_help' });
    const text = cardText(updated(help));
    expect(text).toContain('<b>1 of 3 done</b>');
    expect(text).toContain(`Needs help: ${NAMES[CHRIS]}`);
    expect(fakes.db.clicks.map(c => c.result)).toEqual(['changed', 'changed']);
  });

  test('each shape refuses the other shape’s buttons, privately', async () => {
    await command();
    const card = await liveCard();
    await press(card, 'track.done', JASON);
    await whenCardsIdle();
    expect(privateReplies()).toEqual([[JASON, 'This card tracks one person — use I’ll take it or Pass to… instead.']]);
  });
});

// ============================================================================
// MOVING THE BALL
// ============================================================================

describe('moving the ball', () => {
  test('Pass to…: without dialogs the button says what to type; the typed command moves the ball and tells only the new holder', async () => {
    await command();
    let card = await liveCard();
    fakes.chat.dms.set(STEPH, 'spaces/DM-STEPH');
    fakes.chat.posts.length = 0;

    await press(card, 'track.pass', JASON);
    await whenCardsIdle();
    expect(privateReplies()).toEqual([[JASON, 'To pass it on, reply in this thread: @Oracle pass to @Name']]);
    expect(fakes.db.clicks.at(-1).result).toBe('typed_command_needed');

    await say({ text: 'pass to @Steph', sender: JASON, mentions: [STEPH], name: `${SPACE}/messages/pass1` });
    card = await liveCard();
    expect(card.data.ball).toMatchObject({ state: 'person', holder: { chatUserId: STEPH }, by: { chatUserId: JASON }, source: `${SPACE}/messages/pass1` });
    expect(dmsTo('spaces/DM-STEPH')).toEqual([`${NAMES[JASON]} passed you the ball on “${ASK_TEXT}”. https://chat.google.com/room/TEAM/T1`]);
    expect(dmsTo('spaces/DM-JASON')).toEqual([]);
    expect(dmsTo('spaces/DM-NAT')).toEqual([]);
    const text = cardText(lastPatch());
    expect(text).toContain(`Last update: ${NAMES[JASON]} passed the ball on`);
    expect(text).toContain('href="https://chat.google.com/room/TEAM/T1/pass1"');
    expect(textReplies).toEqual([]);
    expect(fakes.agent.calls).toEqual([]);
  });

  test('status changes ping nobody', async () => {
    await command();
    const card = await liveCard();
    fakes.chat.posts.length = 0;
    await press(card, 'track.client', JASON);
    await press(card, 'track.call', NAT);
    await whenCardsIdle();
    expect(fakes.chat.posts).toEqual([]);
  });

  test('Waiting on client counts days and nudges the chaser once, after 5 days', async () => {
    fakes.calendar.zones.set(2, 'UTC');
    await command();
    const card = await liveCard();
    const t0 = startOfTodayUtc();
    const response = await press(card, 'track.client', JASON, { now: new Date(t0) });
    expect(cardText(updated(response))).toContain(`Waiting on client · 0 days (${NAMES[JASON]} chasing)`);
    expect(buttonTexts(updated(response))).toContain('Waiting on client');
    expect(cardButtons(updated(response)).find(b => b.text === 'Waiting on client').disabled).toBe(true);

    await notify.sendDueDigests(at8(4, t0));
    expect(dmsTo('spaces/DM-JASON').filter(Boolean)).toHaveLength(1);         // only the assigned DM; nothing to say yet
    await notify.sendDueDigests(at8(6, t0));
    const digests = () => fakes.chat.posts.filter(p => p.spaceName === 'spaces/DM-JASON' && p.cardsV2);
    expect(digests()).toHaveLength(1);
    const d1 = digests()[0].cardsV2[0].card;
    expect(d1.sections.map(s => s.header)).toEqual(['Needs a nudge']);
    expect(cardText(digests()[0].cardsV2)).toContain('Waiting on the client for 6 days — you’re chasing');

    await notify.sendDueDigests(at8(7, t0));
    expect(digests()).toHaveLength(1);                                         // once per waiting period
  });

  test('no movement for 3 days nudges the holder once; “with you” stays daily', async () => {
    fakes.calendar.zones.set(2, 'UTC');
    setThread([chatMessage({ id: 'ask', text: 'can someone send the industry list by Oct 1, 2030?' })]);
    await command();
    const t0 = startOfTodayUtc();
    await press(await liveCard(), 'track.take', JASON, { now: new Date(t0) });
    const digests = () => fakes.chat.posts.filter(p => p.spaceName === 'spaces/DM-JASON' && p.cardsV2).map(p => p.cardsV2);

    await notify.sendDueDigests(at8(1, t0));
    expect(digests()[0][0].card.sections.map(s => s.header)).toEqual(['Waiting on you']);
    expect(cardText(digests()[0])).toContain('With you since');

    await notify.sendDueDigests(at8(4, t0));
    expect(digests()[1][0].card.sections.map(s => s.header)).toEqual(['Waiting on you', 'Needs a nudge']);
    expect(cardText(digests()[1])).toContain('No movement for 4 days');

    await notify.sendDueDigests(at8(5, t0));
    expect(digests()[2][0].card.sections.map(s => s.header)).toEqual(['Waiting on you']);
  });

  test('Call needed offers Schedule call, and pressing it posts a meet card in the same thread', async () => {
    await command();
    const card = await liveCard();
    const response = await press(card, 'track.call', NAT);
    expect(cardText(updated(response))).toContain(`Call needed · with ${NAMES[JASON]}`);
    expect(buttonTexts(updated(response))).toContain('Schedule call');

    await press(card, 'track.schedule', NAT);
    await whenCardsIdle();

    // Its own message, linked back to this card; the track card is unchanged.
    const meet = [...fakes.db.cards.values()].find(c => c.card_type === 'meet');
    expect(meet).toBeTruthy();
    expect(meet.thread_name).toBe(THREAD);
    expect(meet.data.trackCardId).toBe(card.id);
    expect(privateReplies()).toEqual([]);

    // A second press does not post a second card.
    await press(card, 'track.schedule', NAT);
    await whenCardsIdle();
    expect([...fakes.db.cards.values()].filter(c => c.card_type === 'meet')).toHaveLength(1);
    expect(privateReplies()).toEqual([[NAT, 'There’s already a meeting card in this thread.']]);
  });

  test('Someone promised… (typed): holder and date', async () => {
    await command();
    await say({ text: 'promised @Steph by Oct 5, 2030', sender: NAT, mentions: [STEPH] });
    const card = await liveCard();
    expect(card.data.ball).toMatchObject({ state: 'person', holder: { chatUserId: STEPH }, promised: true });
    expect(card.data.due).toMatchObject({ label: 'by Oct 5, 2030' });
    expect(new Date(card.due_at).toISOString()).toBe('2030-10-06T06:59:00.000Z');
    expect(cardText(lastPatch())).toContain(' · promised');
  });

  test('Resolved freezes the card', async () => {
    await command();
    const card = await liveCard();
    const response = await press(card, 'track.resolve', NAT);
    expect(await fakes.store.getCard(card.id)).toMatchObject({ status: 'closed', closed_reason: 'resolved' });
    const cardsV2 = updated(response);
    expect(cardsV2[0].card.header.subtitle).toBe(`Track · asked by ${NAMES[NAT]} · One ball · Resolved · Closed`);
    expect(cardButtons(cardsV2)).toEqual([]);
    expect(cardText(cardsV2)).toContain(`<b>Resolved</b> — ${NAMES[NAT]}`);
  });
});

// ============================================================================
// REFRESH, SUGGESTIONS, BEST GUESSES
// ============================================================================

describe('refresh and best guesses', () => {
  const later = (id, sender, text, mentions = [], minutes = 60) =>
    chatMessage({ id, sender, text, mentions, at: new Date(Date.now() + minutes * 60_000) });

  test('Refresh suggests, with a link, and changes nothing until Confirm', async () => {
    await command();
    const card = await liveCard();
    setThread([oneBallAsk(), later('m2', JASON, '@Steph you have the latest version', [STEPH])]);

    const response = await press(card, 'track.refresh', CHRIS);
    expect(cardText(updated(response))).toContain('Last update: Reading the thread…');
    expect(cardButtons(updated(response)).find(b => b.text === 'Reading…')).toMatchObject({ disabled: true });
    await whenCardsIdle();

    let now = await liveCard();
    expect(now.data.ball.holder.chatUserId).toBe(JASON);                       // unchanged
    expect(now.data.suggestion).toMatchObject({ state: 'person', holder: { chatUserId: STEPH }, source: `${SPACE}/messages/m2` });
    const text = cardText(lastPatch());
    expect(text).toContain(`<b>Suggestion:</b> with ${NAMES[STEPH]} — <a href="https://chat.google.com/room/TEAM/T1/m2">based on this message</a>`);
    expect(buttonTexts(lastPatch()).slice(0, 2)).toEqual(['Confirm', 'Dismiss']);
    expect(fakes.userChat.calls.at(-1)).toMatchObject({ userId: 1, pageSize: 100 });   // the requester's own grant

    await press(now, 'track.confirm', NAT);
    now = await liveCard();
    expect(now.data.ball).toMatchObject({ holder: { chatUserId: STEPH }, source: `${SPACE}/messages/m2`, guess: false });
    expect(now.data.suggestion).toBeNull();
  });

  test('Dismiss clears a suggestion; nothing new says so', async () => {
    await command();
    const card = await liveCard();
    setThread([oneBallAsk(), later('m2', JASON, 'sent it to the client this morning')]);
    await press(card, 'track.refresh', CHRIS);
    await whenCardsIdle();
    expect((await liveCard()).data.suggestion).toMatchObject({ state: 'client', chaser: { chatUserId: JASON } });
    await press(card, 'track.dismiss', NAT);
    expect((await liveCard()).data).toMatchObject({ suggestion: null, ball: { state: 'person' } });

    setThread([oneBallAsk()]);
    await press(card, 'track.refresh', CHRIS);
    await whenCardsIdle();
    expect(cardText(lastPatch())).toContain('— no change spotted in the thread');
  });

  test('in a listened space Refresh applies a labelled best guess, and Not right undoes it', async () => {
    listened.add(SPACE);
    fakes.listen.spaces.set(SPACE, { space_name: SPACE, status: 'active' });
    await command();
    const card = await liveCard();
    setThread([oneBallAsk(), later('m2', JASON, '@Steph over to you', [STEPH])]);

    await press(card, 'track.refresh', CHRIS);
    await whenCardsIdle();
    let now = await liveCard();
    expect(now.data.ball).toMatchObject({ holder: { chatUserId: STEPH }, guess: true, source: `${SPACE}/messages/m2` });
    const text = cardText(lastPatch());
    expect(text).toContain('<i>Best guess</i> — <a href="https://chat.google.com/room/TEAM/T1/m2">best guess from this message</a>');
    expect(buttonTexts(lastPatch())[0]).toBe('Not right');

    await press(now, 'track.not_right', NAT);
    now = await liveCard();
    expect(now.data.ball).toMatchObject({ holder: { chatUserId: JASON }, guess: false });
  });

  test('outside a listened space, new stored messages change nothing', async () => {
    await command();
    const before = (await liveCard()).data.ball;
    expect(await onThreadMessages(SPACE, [later('m3', STEPH, "I'll send it by Oct 5, 2030")])).toEqual({ guessed: 0 });
    expect((await liveCard()).data.ball).toEqual(before);
  });

  test('in a listened space a new message moves the ball as a best guess — never from an app or an edit', async () => {
    listened.add(SPACE);
    fakes.listen.spaces.set(SPACE, { space_name: SPACE, status: 'active' });
    await command();
    const card = await liveCard();

    // Oracle's own messages (its card patches arrive as updates, and its replies are from an app) never count.
    const fromApp = later('bot', 'users/app', '@Steph please', [STEPH], 5);
    fromApp.sender.type = 'BOT';
    const noThread = { ...later('x', STEPH, '@Steph no thread', [STEPH], 5), thread: undefined };
    const before = await liveCard();
    expect(await onThreadMessages(SPACE, [fromApp, noThread])).toEqual({ guessed: 0 });
    const after = await liveCard();
    expect(after.data.ball.holder.chatUserId).toBe(JASON);
    // An app's message — Oracle's own card patch arrives as one — is not activity either.
    expect(after.last_activity_at).toEqual(before.last_activity_at);

    expect(await onThreadMessages(SPACE, [later('m4', STEPH, "I'll send it by Oct 5, 2030")])).toEqual({ guessed: 1 });
    await whenCardsIdle();
    const now = await liveCard();
    expect(now.data.ball).toMatchObject({ state: 'person', holder: { chatUserId: STEPH }, promised: true, guess: true, source: `${SPACE}/messages/m4` });
    expect(new Date(now.due_at).toISOString()).toBe('2030-10-06T06:59:00.000Z');
    expect(cardText(lastPatch())).toContain('Last update: Steph Sentinel updated from the thread (best guess)'.replace('Steph Sentinel', NAMES[STEPH]));
    expect(fakes.db.clicks.at(-1)).toMatchObject({ action: 'track.auto', result: 'changed' });
    expect(logged()).toContain('Track best guess — applied: 1');
    expect(card.id).toBe(now.id);
  });

  test('thread activity reopens a stale card', async () => {
    await command();
    const card = await liveCard();
    await applyLifecycle(new Date(Date.now() + 31 * DAY));
    expect((await liveCard()).status).toBe('stale');
    await say({ text: 'what is left on this?', sender: NAT });
    expect((await liveCard()).status).toBe('open');
    expect(fakes.chat.patches.some(p => p.messageName === card.message_name)).toBe(true);
  });
});

// ============================================================================
// DECISIONS
// ============================================================================

describe('recording the decision', () => {
  test('with dialogs on: a pre-filled dialog, and saving freezes the card as Decided', async () => {
    process.env.TRACK_DIALOGS_ENABLED = 'true';
    await command();
    const card = await liveCard();
    const decisionButton = cardButtons(cardPosts()[0].cardsV2).find(b => b.text === 'Record decision');
    expect(decisionButton).toBeDefined();
    const raw = JSON.stringify(cardPosts()[0].cardsV2);
    expect(raw).toContain('"interaction":"OPEN_DIALOG"');

    setThread([oneBallAsk(), chatMessage({ id: 'm5', sender: JASON, text: 'We decided to use the **2024 NAICS** list', at: new Date(Date.now() + 3600_000) })]);
    const opened = await dialog(card, 'track.decision', NAT, 'REQUEST_DIALOG');
    const pushed = opened.action.navigations[0].pushCard;
    expect(pushed.header.title).toBe('Record decision');
    const input = pushed.sections[0].widgets[0].textInput;
    expect(input).toMatchObject({ name: 'decision', type: 'MULTIPLE_LINE', value: 'We decided to use the 2024 NAICS list', validation: { characterLimit: 1000 } });
    const submit = pushed.sections[0].widgets[1].buttonList.buttons[0];
    expect(submit.onClick.action.parameters).toEqual([
      { key: 'cardId', value: card.id }, { key: 'action', value: 'track.decision' }, { key: 'step', value: 'submit' }
    ]);

    const saved = await dialog(card, 'track.decision', NAT, 'SUBMIT_DIALOG', { decision: ['Use the 2024 NAICS list'] });
    expect(saved).toEqual({ action: { navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }], notification: { text: 'Decision recorded' } } });
    await whenCardsIdle();

    const done = await fakes.store.getCard(card.id);
    expect(done).toMatchObject({ status: 'closed', closed_reason: 'decided' });
    expect(done.data.decision).toMatchObject({ text: 'Use the 2024 NAICS list', by: { chatUserId: NAT } });
    const patched = lastPatch();
    expect(patched[0].card.header.subtitle).toContain('Decided · Closed');
    expect(cardText(patched)).toContain(`<b>Decided:</b> Use the 2024 NAICS list — ${NAMES[NAT]}`);
    expect(cardText(patched)).toContain(`Last update: ${NAMES[NAT]} recorded the decision`);
    expect(cardButtons(patched)).toEqual([]);
  });

  test('typed "decision:" does the same without dialogs — and recall finds it, only for someone who can read the space', async () => {
    await command();
    await say({ text: 'decision: Use the 2024 NAICS list', sender: NAT });
    expect(await liveCardOrClosed()).toMatchObject({ status: 'closed', closed_reason: 'decided' });
    expect(fakes.agent.calls).toEqual([]);

    const ctx = { userId: 2, chatContext: { surface: 'chat_space', spaceName: SPACE, spaceDisplayName: 'Team' } };
    const found = await readChatSpaceHistory({ query: 'NAICS' }, ctx);
    expect(found.success).toBe(true);
    expect(found.recorded_decisions).toEqual([{
      decision: 'Use the 2024 NAICS list',
      decided_by: NAMES[NAT],
      decided_at: expect.any(String),
      about: ASK_TEXT,
      thread_link: 'https://chat.google.com/room/TEAM/T1'
    }]);

    fakes.userChat.failWith = Object.assign(new Error('forbidden'), { code: 403, response: { status: 403 } });
    const refused = await readChatSpaceHistory({ query: 'NAICS' }, ctx);
    expect(refused.success).toBe(false);
    expect(refused.recorded_decisions).toBeUndefined();
  });

  test('with dialogs off, dialog events only close', async () => {
    await command();
    const card = await liveCard();
    expect(await dialog(card, 'track.decision', NAT, 'SUBMIT_DIALOG', { decision: ['x'] }))
      .toEqual({ action: { navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }] } });
    expect((await liveCard()).status).toBe('open');
    expect(JSON.stringify(cardPosts()[0].cardsV2)).not.toContain('OPEN_DIALOG');
  });

  test('Pass to… dialog lists this space’s people and the submit moves the ball', async () => {
    process.env.TRACK_DIALOGS_ENABLED = 'true';
    await command();
    const card = await liveCard();
    const opened = await dialog(card, 'track.pass', JASON, 'REQUEST_DIALOG');
    const picker = opened.action.navigations[0].pushCard.sections[0].widgets[0].selectionInput;
    expect(picker).toMatchObject({ name: 'person', type: 'DROPDOWN' });
    expect(picker.items.map(i => i.value)).toEqual([NAT, JASON, STEPH, CHRIS]);   // never the listener

    const saved = await dialog(card, 'track.pass', JASON, 'SUBMIT_DIALOG', { person: [STEPH] });
    expect(saved.action.notification).toEqual({ text: 'Passed on' });
    expect((await liveCard()).data.ball.holder.chatUserId).toBe(STEPH);
  });

  async function liveCardOrClosed() {
    return fakes.store.getCard([...fakes.db.cards.values()][0].id);
  }
});

// ============================================================================
// EVERYONE: RESPONSES, REMOVALS, DUE DATES
// ============================================================================

describe('everyone asks and due dates', () => {
  const feedbackAsk = () => setThread([chatMessage({
    id: 'ask', text: 'everyone, share your thoughts on the new template by Oct 1, 2030', mentions: []
  })]);

  test('feedback asks collect responses; the requester gets one private summary the morning after', async () => {
    feedbackAsk();
    fakes.chat.members.set(SPACE, [NAT, JASON, STEPH].map(id => ({ chatUserId: id })));
    await command();
    const card = await liveCard();
    expect(card.data.feedback).toBe(true);
    expect(buttonTexts(cardPosts()[0].cardsV2)[0]).toBe('Submit response');

    await say({ text: 'response: I prefer **option A**', sender: JASON });
    let now = await liveCard();
    expect(now.data.responses[JASON]).toMatchObject({ text: 'I prefer **option A**', name: NAMES[JASON] });
    expect(await members(card.id)).toEqual({ [JASON]: 'done', [STEPH]: 'pending' });
    expect(cardText(lastPatch())).toContain('1 response so far');
    expect(cardText(lastPatch())).not.toContain('option A');                     // responses stay off the shared card

    fakes.chat.posts.length = 0;
    await notify.sendDueReminders(new Date('2030-10-02T03:00:00Z'));   // Oct 1, 8pm in Vancouver: not yet
    await notify.sendDueReminders(new Date('2030-10-02T14:00:00Z'));   // Oct 2, 7am: not yet
    expect(fakes.chat.posts).toEqual([]);

    await notify.sendDueReminders(new Date('2030-10-02T15:10:00Z'));   // Oct 2, 8:10am
    await notify.sendDueReminders(new Date('2030-10-02T16:10:00Z'));   // and again: nothing more
    expect(fakes.chat.posts.map(p => p.spaceName)).toEqual(['spaces/DM-NAT']);
    expect(fakes.chat.posts[0].text).toBe([
      `Due-date summary for “everyone, share your thoughts on the new template by Oct 1, 2030”: 1 of 2 done.`,
      `Still to do: ${NAMES[STEPH]}.`,
      'Responses:',
      `- ${NAMES[JASON]}: I prefer option A`,
      'https://chat.google.com/room/TEAM/T1'
    ].join('\n'));
    now = await liveCard();
    expect(now.due_summary_sent_at).toBeInstanceOf(Date);
  });

  test('a stated due time sends the summary right after it passes', async () => {
    setThread([chatMessage({ id: 'ask', text: 'everyone please sign the form before 3pm Oct 1, 2030' })]);
    fakes.chat.members.set(SPACE, [NAT, JASON].map(id => ({ chatUserId: id })));
    await command();
    fakes.chat.posts.length = 0;
    await notify.sendDueReminders(new Date('2030-10-01T21:59:00Z'));   // 2:59pm
    expect(fakes.chat.posts).toEqual([]);
    await notify.sendDueReminders(new Date('2030-10-01T22:05:00Z'));   // 3:05pm
    expect(fakes.chat.posts.map(p => [p.spaceName, p.text.split('\n')[1]])).toEqual([['spaces/DM-NAT', `Still to do: ${NAMES[JASON]}.`]]);
  });

  test('the one-ball holder gets one due-today message, from 08:00 their time', async () => {
    fakes.calendar.zones.set(2, 'UTC');
    setThread([oneBallAsk({ text: '@Jason Sentinel can you send the industry list by 3pm Oct 1, 2030?' })]);
    await command();
    const assigned = dmsTo('spaces/DM-JASON').length;
    await notify.sendDueReminders(new Date('2030-10-01T07:30:00Z'));
    expect(dmsTo('spaces/DM-JASON')).toHaveLength(assigned);
    // Two runs at once (the hourly job overlapping itself) still send one.
    await Promise.all([
      notify.sendDueReminders(new Date('2030-10-01T08:10:00Z')),
      notify.sendDueReminders(new Date('2030-10-01T08:10:00Z'))
    ]);
    await notify.sendDueReminders(new Date('2030-10-01T09:10:00Z'));
    expect(dmsTo('spaces/DM-JASON').slice(assigned)).toEqual([
      expect.stringMatching(/^Due today: “@Jason Sentinel can you send the industry list by 3pm Oct 1, 2030\?” \(Tue, Oct 1, 3:00\s?PM PDT\)\. https:\/\/chat\.google\.com\/room\/TEAM\/T1$/)
    ]);
  });

  test('only the requester can take people off the list; others are told privately', async () => {
    setThread([chatMessage({ id: 'ask', text: 'everyone switch your meeting links by Oct 1, 2030' })]);
    await command();
    const card = await liveCard();

    await say({ text: 'remove @Steph', sender: JASON, mentions: [STEPH] });
    expect(await members(card.id)).toHaveProperty([STEPH]);
    expect(privateReplies().at(-1)).toEqual([JASON, 'Only the person who asked can take people off the list.']);

    await say({ text: 'remove @Steph', sender: NAT, mentions: [STEPH] });
    expect(await members(card.id)).toEqual({ [JASON]: 'pending', [CHRIS]: 'pending' });
    expect(cardText(lastPatch())).toContain('<b>0 of 2 done</b>');
  });
});

// ============================================================================
// RETENTION AND TEXT
// ============================================================================

describe('retention and text', () => {
  test('closed cards are deleted 12 months after closing', async () => {
    await command();
    const card = await liveCard();
    await press(card, 'track.resolve', NAT);
    await applyLifecycle(new Date(Date.now() + 364 * DAY));
    expect(await fakes.store.getCard(card.id)).not.toBeNull();
    await applyLifecycle(new Date(Date.now() + 366 * DAY));
    expect(await fakes.store.getCard(card.id)).toBeNull();
    expect(fakes.db.participants.filter(p => p.card_id === card.id)).toEqual([]);
  });

  test('no Markdown leaves on the card', async () => {
    setThread([oneBallAsk({ text: '**Jason** can you send the `industry` list by [Oct 1, 2030](https://x.y)?' })]);
    await command();
    for (const str of allCardStrings(cardPosts()[0].cardsV2)) expect(str).not.toMatch(/\*\*|`|\]\(/);
    expect(cardPosts()[0].cardsV2[0].card.header.title).toBe('Jason can you send the industry list by Oct 1, 2030?');
  });
});
