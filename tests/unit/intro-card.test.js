/**
 * The intro card, /help and /review
 *
 * Being added to a space, a first DM, "@Oracle help" and the two commands all
 * go through the real Chat handler; the card's own button goes through the real
 * click handler. The database and the Chat API are the in-memory fakes in
 * helpers/tracked-cards-fakes.js, and the wording is the real
 * data/chat/space-guides.json — a change to that file should change this test.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/intro-card.test.js
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

const fakes = createTrackedCardFakes();

const CHRIS = 'users/chris';
const NAT = 'users/nat';
const ORACLE = 'users/app';
const NAMES = { [CHRIS]: 'Chris Sentinel', [NAT]: 'Nat Sentinel' };
const EMAILS = { [CHRIS]: 'chris.sentinel@granted.ca', [NAT]: 'nat.sentinel@granted.ca' };
const HUB = [{ id: 3, chat: CHRIS }, { id: 1, chat: NAT }].map(u => ({
  id: u.id, email: EMAILS[u.chat], name: NAMES[u.chat], is_active: true,
  google_refresh_token: 'rt',
  google_granted_scopes: 'https://www.googleapis.com/auth/chat.messages.readonly',
  chat_user_id: u.chat
}));

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
  listenSpaces: () => [...listened].map(name => ({ name, label: 'RTRI Changes' })),
  listenEntry: (name) => (listened.has(name) ? { name, label: 'RTRI Changes' } : null)
}));
const enabled = [];
jest.unstable_mockModule('../../src/chat-listen/subscriptions.js', () => ({
  enableSpace: async (spaceName, opts) => { enabled.push({ spaceName, ...opts }); },
  teardownSpace: async () => {},
  syncSpace: async () => ({ outcome: 'skipped' }),
  withSpaceLock: async (_s, fn) => fn()
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
const { applyLifecycle } = await import('../../src/cards/lifecycle.js');
const notify = await import('../../src/cards/notify.js');
const { introContent, postIntro } = await import('../../src/cards/intro-card.js');
const { HELP_COMMAND_ID, REVIEW_COMMAND_ID } = await import('../../src/cards/commands.js');

const SPACE = 'spaces/TEAM';
const RTRI = 'spaces/RTRI';
const DM = 'spaces/DM-CHRIS';
const THREAD = `${SPACE}/threads/T1`;
let seq = 0;

const annotation = (id) => ({
  type: 'USER_MENTION',
  userMention: { user: { name: id, displayName: NAMES[id] || 'Oracle', type: id === ORACLE ? 'BOT' : 'HUMAN' } }
});

function addedBody({ space = SPACE, displayName = 'Team', type = 'ROOM' } = {}) {
  return { chat: { addedToSpacePayload: { space: { name: space, displayName, type } } } };
}

function messageBody({ text, sender = CHRIS, space = SPACE, thread = THREAD, type = 'ROOM', name = null }) {
  const isDm = type === 'DM';
  return {
    chat: {
      messagePayload: {
        message: {
          name: name || `${space}/messages/in${++seq}`,
          text: isDm ? text : `@Oracle ${text}`,
          argumentText: text,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread || `${space}/threads/dm` },
          annotations: isDm ? [] : [annotation(ORACLE)]
        },
        space: { name: space, displayName: isDm ? null : 'Team', type }
      }
    }
  };
}

function commandBody({ commandId, text, sender = CHRIS, space = SPACE, thread = THREAD, type = 'ROOM' }) {
  return {
    chat: {
      user: { name: sender, displayName: NAMES[sender], type: 'HUMAN' },
      appCommandPayload: {
        appCommandMetadata: { appCommandId: Number(commandId), appCommandType: 'SLASH_COMMAND' },
        message: {
          name: `${space}/messages/cmd${++seq}`, text, argumentText: '',
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread }
        },
        space: { name: space, type, displayName: type === 'ROOM' ? 'Team' : null }
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

/** An added-to-space event, then the background post. */
async function added(opts) {
  const before = fakes.chat.posts.length;
  await post(addedBody(opts));
  for (let i = 0; i < 500 && fakes.chat.posts.length === before; i++) await new Promise(r => setImmediate(r));
  await whenCardsIdle();
}

async function say(opts) {
  const ends = () => logLines().filter(l => l.includes('Chat background task END')).length;
  const before = ends();
  await post(messageBody(opts));
  for (let i = 0; i < 2000 && ends() === before; i++) await new Promise(r => setImmediate(r));
  if (ends() === before) throw new Error('Oracle turn did not finish');
  await whenCardsIdle();
}

async function command(opts) {
  const answer = await post(commandBody(opts));
  for (let i = 0; i < 500; i++) await new Promise(r => setImmediate(r));
  await whenCardsIdle();
  return answer;
}

const cardPosts = () => fakes.chat.posts.filter(p => p.cardsV2);
const privatePosts = () => fakes.chat.posts.filter(p => p.privateTo);
const introCards = () => [...fakes.db.cards.values()].filter(c => c.card_type === 'intro');
const lastCardText = () => cardText(cardPosts().at(-1).cardsV2);
const lastButtons = () => cardButtons(cardPosts().at(-1).cardsV2);

beforeEach(() => {
  fakes.reset();
  textReplies.length = 0;
  listened.clear();
  enabled.length = 0;
  fakes.db.users.push(...HUB.map(u => ({ ...u })));
  for (const [id, email] of Object.entries(EMAILS)) {
    fakes.directory.people.set(id, { email, name: NAMES[id] });
  }
  fakes.chat.members.set(SPACE, [CHRIS, NAT].map(id => ({ chatUserId: id, displayName: null })));
  fakes.agent.impl = async () => ({ success: true, response: { content: [{ type: 'text', text: 'model answer' }] } });

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// POSTED ONCE
// ============================================================================

describe('being added to a space', () => {
  test('the intro card is posted once, as its own message', async () => {
    await added({ displayName: 'Team' });

    expect(cardPosts()).toHaveLength(1);
    expect(cardPosts()[0].spaceName).toBe(SPACE);
    expect(cardPosts()[0].threadName ?? null).toBeNull();
    expect(fakes.db.intros.get(SPACE)).toMatchObject({ kind: 'space', message_name: cardPosts()[0].name });

    const text = lastCardText();
    expect(text).toContain('Hi, I’m Oracle');
    expect(text).toContain('Granted’s assistant — now in Team');
    expect(text).toContain('What I can do in Team');
    expect(text).toContain('Privately (DM me)');
    expect(text).toContain('Good to know');
  });

  test('a second addedToSpace event posts nothing more', async () => {
    await added({ displayName: 'Team' });
    await added({ displayName: 'Team' });

    expect(cardPosts()).toHaveLength(1);
    expect(logged()).toContain('Intro already posted');
  });

  test('the card names the commands, and offers the guide', async () => {
    await added({ displayName: 'Team' });

    const text = lastCardText();
    expect(text).toContain('/track');
    expect(text).toContain('/meet');
    expect(text).toContain('@Oracle watch');
    // One link button (the guide) and one callback button (the examples).
    expect(lastButtons().map(b => b.text)).toEqual(['Show example prompts']);
    const row = cardPosts()[0].cardsV2[0].card.sections.at(-1).widgets[0].buttonList.buttons;
    expect(row[0].text).toBe('Open the Oracle guide');
    expect(row[0].onClick.openLink.url).toMatch(/^https:\/\//);
    expect(row[1].text).toBe('Show example prompts');
  });

  test('a space with its own entry gets its own lines', async () => {
    await added({ space: RTRI, displayName: 'RTRI Changes' });

    const text = lastCardText();
    expect(text).toContain('What I can do in RTRI Changes');
    expect(text).toContain('RTRI');
    expect(introContent({ displayName: 'RTRI Changes' }).specific).toBe(true);
  });

  test('a listened space is told about the copy, and not that Oracle only sees @mentions', async () => {
    listened.add(RTRI);
    await added({ space: RTRI, displayName: 'RTRI Changes' });

    const text = lastCardText();
    expect(text).toContain('12-month copy');
    expect(text).not.toContain('only see messages where I’m @mentioned');
    // Listening starts only because the card was posted.
    expect(enabled).toEqual([{ spaceName: RTRI, announced: true }]);
  });

  test('a space that is not listened keeps the "@mention me" line and starts no copy', async () => {
    await added({ displayName: 'Team' });

    expect(lastCardText()).toContain('@mentioned');
    expect(lastCardText()).not.toContain('12-month copy');
    expect(enabled).toEqual([]);
  });

  test('a DM gets no intro when Oracle is added — that waits for the first message', async () => {
    await added({ space: DM, displayName: null, type: 'DM' });

    expect(cardPosts()).toHaveLength(0);
    expect(fakes.db.intros.size).toBe(0);
  });

  test('a failed post gives the claim back, so a later pass can post it', async () => {
    fakes.chat.failPost = new Error('Chat is down');
    expect(await postIntro({ spaceName: SPACE, displayName: 'Team' })).toBe(false);
    expect(fakes.db.intros.size).toBe(0);

    fakes.chat.failPost = null;
    expect(await postIntro({ spaceName: SPACE, displayName: 'Team' })).toBe(true);
    expect(fakes.db.intros.size).toBe(1);
  });
});

// ============================================================================
// ON DEMAND
// ============================================================================

describe('asking for it', () => {
  test('"@Oracle help" answers privately, with the examples in the card, and never runs the model', async () => {
    await say({ text: 'help' });

    const replies = privatePosts();
    expect(replies).toHaveLength(1);
    expect(replies[0].privateTo).toBe(CHRIS);
    const text = cardText(replies[0].cardsV2);
    expect(text).toContain('Hi, I’m Oracle');
    expect(text).toContain('Try one of these');
    expect(text).toContain('@Oracle track this');
    expect(fakes.agent.calls).toHaveLength(0);
  });

  test('/help does the same, and needs no Hub account', async () => {
    const answer = await command({ commandId: HELP_COMMAND_ID, text: '/help', sender: NAT });
    expect(answer).toEqual({});

    const replies = privatePosts();
    expect(replies).toHaveLength(1);
    expect(replies[0].privateTo).toBe(NAT);
    expect(cardText(replies[0].cardsV2)).toContain('What I can do in Team');
  });

  test('asking for help does not claim the space’s intro', async () => {
    await say({ text: 'help' });
    expect(fakes.db.intros.size).toBe(0);
    expect(introCards()).toHaveLength(0);
  });

  test('"Show example prompts" sends them only to whoever pressed, and changes nothing', async () => {
    await added({ displayName: 'Team' });
    const card = introCards()[0];

    const answer = await handleCardClick({
      actorChatId: NAT, actorName: NAMES[NAT], actorEmail: EMAILS[NAT],
      messageName: card.message_name,
      parameters: { cardId: card.id, action: 'intro.examples' }
    });
    await whenCardsIdle();

    const examples = fakes.chat.posts.filter(p => p.privateTo === NAT && p.text);
    expect(examples).toHaveLength(1);
    expect(examples[0].text).toContain('@Oracle track this');
    expect(answer?.hostAppDataAction?.chatDataAction?.updateMessageAction).toBeTruthy();
    expect(fakes.db.clicks.filter(c => c.result === 'examples_sent')).toHaveLength(1);
  });

  test('the intro card is in nobody’s digest and never goes stale', async () => {
    await added({ displayName: 'Team' });
    const card = introCards()[0];

    expect(await fakes.store.getParticipants(card.id)).toEqual([]);
    expect(await fakes.store.digestCandidates()).toEqual([]);
    const digest = await notify.buildDigest(CHRIS, '2026-09-17', new Date());
    expect(digest.extras).toEqual([]);

    await applyLifecycle(new Date(Date.now() + 200 * 864e5));
    expect((await fakes.store.getCard(card.id)).status).toBe('open');
  });
});

// ============================================================================
// FIRST DM
// ============================================================================

describe('a first direct message', () => {
  test('the DM card first, then the question is answered', async () => {
    await say({ text: 'what do we know about Acme?', space: DM, type: 'DM', thread: `${DM}/threads/d1` });

    expect(cardPosts()).toHaveLength(1);
    expect(cardPosts()[0].spaceName).toBe(DM);
    const text = lastCardText();
    expect(text).toContain('now in this DM');
    expect(text).toContain('digest');
    // The DM card has no "Privately (DM me)" section — you are already there.
    expect(text).not.toContain('Privately (DM me)');
    // And the message itself was still answered by Oracle.
    expect(fakes.agent.calls).toHaveLength(1);
  });

  test('later messages get no second card', async () => {
    await say({ text: 'first', space: DM, type: 'DM', thread: `${DM}/threads/d1` });
    await say({ text: 'second', space: DM, type: 'DM', thread: `${DM}/threads/d1` });

    expect(cardPosts()).toHaveLength(1);
    expect(fakes.agent.calls).toHaveLength(2);
  });
});

// ============================================================================
// /review
// ============================================================================

describe('/review', () => {
  test('creates the thread’s conversation, then posts the "Track this as a review?" card', async () => {
    const answer = await command({ commandId: REVIEW_COMMAND_ID, text: '/review' });
    expect(answer).toEqual({});

    const offer = [...fakes.db.cards.values()].find(c => c.card_type === 'review');
    expect(offer).toMatchObject({ status: 'offered', thread_name: THREAD, owner_chat_id: CHRIS });
    expect(offer.conversation_id).toBeTruthy();
    // The conversation row exists before the card that points at it.
    expect(fakes.messages.conversations.map(c => c.id)).toContain(offer.conversation_id);
    expect(cardText(cardPosts().at(-1).cardsV2)).toContain('Track this as a review?');
    expect(fakes.agent.calls).toHaveLength(0);
  });

  test('outside a thread it says where to use it', async () => {
    await command({ commandId: REVIEW_COMMAND_ID, text: '/review', thread: null });

    expect([...fakes.db.cards.values()]).toHaveLength(0);
    expect(privatePosts().some(p => /reply in the thread/.test(p.text || ''))).toBe(true);
  });
});

// ============================================================================
// LOGS
// ============================================================================

describe('logs carry codes and counts only', () => {
  test('no space names, display names or addresses from card code', async () => {
    listened.add(RTRI);
    await added({ space: RTRI, displayName: 'RTRI Changes' });
    await say({ text: 'help' });

    // The card's own lines. (The Chat adapter's "Added to space …" line names
    // the space, and is older than this card.)
    const cardLines = logLines()
      .filter(l => /Intro card posted|Intro already posted|Intro shown|Handled by the intro card|🗂️/.test(l))
      .join('\n');
    for (const secret of ['RTRI Changes', NAMES[CHRIS], EMAILS[CHRIS], RTRI]) {
      expect(cardLines).not.toContain(secret);
    }
    expect(cardLines).toContain('👋 Intro card posted');
  });
});
