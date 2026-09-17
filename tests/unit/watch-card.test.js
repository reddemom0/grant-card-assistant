/**
 * The /watch card
 *
 * "@Oracle watch" goes through the real Chat handler; presses through the real
 * click handler; reminders through the real hourly job; new posts through the
 * real stored-copy hook. The grants table, HubSpot, the Chat API and the
 * database are the in-memory fakes in helpers/tracked-cards-fakes.js. The model
 * must never run for any of this.
 *
 * Two rules are checked everywhere: the space gets exactly one small card and
 * nothing else, and nothing Oracle says names GetGranted.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/watch-card.test.js
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
const HUB = [{ id: 1, chat: NAT }, { id: 3, chat: CHRIS }].map(u => ({
  id: u.id, email: EMAILS[u.chat], name: NAMES[u.chat], is_active: true,
  google_refresh_token: 'rt', google_granted_scopes: ALL_SCOPES, chat_user_id: u.chat
}));

const DAY = 24 * 60 * 60 * 1000;
const PROGRAM = 'Rural Transportation Research Initiative (RTRI)';
const KEY = 'rural-transportation-research-initiative-rtri';

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
const { onStoredMessages } = await import('../../src/cards/watch-card.js');

const SPACE = 'spaces/TEAM';
const THREAD = `${SPACE}/threads/T1`;
const OTHER_THREAD = `${SPACE}/threads/T2`;
let seq = 0;

const annotation = (id) => ({
  type: 'USER_MENTION',
  userMention: { user: { name: id, displayName: NAMES[id] || 'all', type: id === ORACLE ? 'BOT' : 'HUMAN' } }
});

/** A post in a thread, as the Chat API returns it. */
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

function messageBody({ text, sender = CHRIS, thread = THREAD, name = `${SPACE}/messages/in${++seq}` }) {
  return {
    chat: {
      messagePayload: {
        message: {
          name,
          text: `@Oracle ${text}`,
          argumentText: text,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread },
          annotations: [annotation(ORACLE)]
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

const watchCards = () => [...fakes.db.cards.values()].filter(c => c.card_type === 'watch');
const liveWatch = async () => {
  const live = watchCards().filter(c => c.status !== 'closed');
  expect(live).toHaveLength(1);
  return fakes.store.getCard(live[0].id);
};
const textOf = async (card) => cardText(await renderCard(card));
const buttonsOf = async (card) => cardButtons(await renderCard(card)).map(b => b.text);
const spacePosts = () => fakes.chat.posts.filter(p => p.spaceName === SPACE);
const privateReplies = () => fakes.chat.posts.filter(p => p.privateTo).map(p => [p.privateTo, p.text]);
const dmsTo = (space) => fakes.chat.posts.filter(p => p.spaceName === space).map(p => p.text);
const watchersOf = async (cardId) => (await fakes.store.getParticipants(cardId)).map(p => p.chat_user_id);
/** Everything Oracle said anywhere, plus every card's text. */
const everythingSaid = async () => {
  const cards = [];
  for (const card of watchCards()) cards.push(cardText(await renderCard(card)));
  return [...fakes.chat.posts.map(p => p.text || ''), ...cards, ...textReplies].join('\n');
};

/** The post being watched, and the "@Oracle watch" reply to it. */
async function watchThePost({ text = null, sender = CHRIS, thread = THREAD, ask = 'watch' } = {}) {
  fakes.userChat.threads.set(thread, [
    chatMessage({ id: `post${++seq}`, text: text ?? `${PROGRAM}: the intake opens October 1 and closes November 15, 2026. https://granted.ca/rtri`, thread })
  ]);
  await say({ text: ask, sender, thread });
  return liveWatch();
}

const atLocal9 = (days = 0, base = Date.now()) =>
  new Date(`${new Date(base + days * DAY).toISOString().slice(0, 10)}T16:05:00Z`);

beforeEach(() => {
  fakes.reset();
  textReplies.length = 0;
  listened.clear();
  fakes.db.users.push(...HUB.map(u => ({ ...u })));
  for (const [id, email] of Object.entries(EMAILS)) {
    fakes.directory.people.set(id, { email, name: NAMES[id] });
  }
  fakes.chat.members.set(SPACE, [NAT, CHRIS, STEPH, LISTENER].map(id => ({ chatUserId: id, displayName: null })));
  fakes.chat.dms.set(CHRIS, 'spaces/DM-CHRIS');
  fakes.chat.dms.set(NAT, 'spaces/DM-NAT');
  fakes.chat.dms.set(STEPH, 'spaces/DM-STEPH');
  fakes.grants.grants = [
    { grant_name: PROGRAM, url: 'https://granted.ca/rtri', deadline: '2026-11-15', grant_amount: '$50,000', program_provider: 'Transport Canada', industries: ['Transportation'], currently_accepting: true },
    { grant_name: 'Rural Transit Modernisation Fund', url: 'https://granted.ca/rtmf', deadline: '2026-12-01', program_provider: 'BC', industries: ['Transportation'], currently_accepting: true }
  ];
  fakes.agent.impl = async () => ({ success: true, response: { content: [{ type: 'text', text: 'model answer' }] } });

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// STARTING A WATCH
// ============================================================================

describe('starting a watch', () => {
  test('one small card in the space, and nothing else', async () => {
    const card = await watchThePost();

    expect(card.card_type).toBe('watch');
    expect(card.thread_name).toBe(`${SPACE}/threads/watch-${KEY}`);
    expect(card.data.program).toMatchObject({ name: PROGRAM, matched: true });
    expect(fakes.agent.calls).toHaveLength(0);

    // Exactly one message in the space, and it is the card, not a reply in the thread.
    const posts = spacePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].cardsV2).toBeTruthy();
    expect(posts[0].threadName ?? null).toBeNull();

    const text = await textOf(card);
    expect(text).toContain(PROGRAM);
    expect(text).toContain('Closes Nov 15, 2026');
    expect(text).toContain('Opens Oct 1, 2026');
    expect(text).toContain('1 person watching');
    expect(await buttonsOf(card)).toEqual(['Watch this', 'Not this one?', 'Stop watching']);
  });

  test('whoever started it gets everything in a DM, once', async () => {
    fakes.hubspot.deals = [{ name: 'Acme — RTRI', companyName: 'Acme Foods', grant_program: PROGRAM }];
    await watchThePost();

    const dms = dmsTo('spaces/DM-CHRIS');
    expect(dms).toHaveLength(1);
    expect(dms[0]).toContain(`You’re watching ${PROGRAM}`);
    expect(dms[0]).toContain('Closes Nov 15, 2026');
    expect(dms[0]).toContain('Acme Foods');
    expect(dms[0]).toContain('not on what they');   // the industry caveat
    expect(dms[0]).toContain('At most one message a day');
  });

  test('watching is keyed to the program, not the post: a second post joins the same card', async () => {
    const first = await watchThePost();
    // A different thread, a different post, the same program.
    const second = await watchThePost({ sender: NAT, thread: OTHER_THREAD, text: `Any news on RTRI? ${PROGRAM}` });

    expect(second.id).toBe(first.id);
    expect(watchCards()).toHaveLength(1);
    expect(await watchersOf(first.id)).toEqual(expect.arrayContaining([CHRIS, NAT]));
    // Still one card in the space.
    expect(spacePosts().filter(p => p.cardsV2)).toHaveLength(1);
    expect(await textOf(await liveWatch())).toContain('2 people watching');
  });

  test('pressing "Watch this" joins, with the same DM, and only once', async () => {
    const card = await watchThePost();
    await press(card, 'watch.join', NAT);
    await whenCardsIdle();

    expect(await watchersOf(card.id)).toEqual(expect.arrayContaining([CHRIS, NAT]));
    expect(dmsTo('spaces/DM-NAT')).toHaveLength(1);

    await press(await liveWatch(), 'watch.join', NAT);
    await whenCardsIdle();
    expect(dmsTo('spaces/DM-NAT')).toHaveLength(1);
    expect(privateReplies().some(([to, t]) => to === NAT && /already watching/.test(t))).toBe(true);
  });

  test('a post nothing can be made of is quoted back, not guessed at', async () => {
    fakes.userChat.threads.set(THREAD, [chatMessage({ id: 'vague', text: 'that changed again, worth a look' })]);
    await say({ text: 'watch' });

    expect(watchCards()).toHaveLength(0);
    const asked = privateReplies().find(([to]) => to === CHRIS)?.[1] || '';
    expect(asked).toContain('Which program did you mean?');
    expect(asked).toContain('“that changed again, worth a look”');
  });

  test('a program we do not have on file is still watched, from the post’s own words', async () => {
    fakes.grants.grants = [];
    const card = await watchThePost();

    expect(card.data.program.matched).toBe(false);
    expect(await textOf(card)).toContain('Taken from the post');
  });

  test('the model is never asked to decide what to watch', async () => {
    fakes.userChat.threads.set(THREAD, [chatMessage({ id: 'news', text: `${PROGRAM} changed its deadline` })]);
    await say({ text: 'what changed about RTRI?' });

    expect(watchCards()).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(1);
  });
});

// ============================================================================
// IN A DM, AND ANSWERING FAST
// ============================================================================

describe('in a DM', () => {
  const DM = 'spaces/DM-CHRIS';
  /** In a DM, Chat gives each message its own thread. */
  const dmBody = (text, { thread = `${DM}/threads/d9`, name = `${DM}/messages/t${++seq}` } = {}) => ({
    chat: {
      messagePayload: {
        message: {
          name, text, argumentText: text,
          sender: { name: CHRIS, displayName: NAMES[CHRIS], email: EMAILS[CHRIS], type: 'HUMAN' },
          thread: { name: thread },
          annotations: []
        },
        space: { name: DM, type: 'DM' }
      }
    }
  });

  async function sayInDm(text, opts = {}) {
    const ends = () => logLines().filter(l => l.includes('Chat background task END')).length;
    const before = ends();
    await post(dmBody(text, opts));
    for (let i = 0; i < 2000 && ends() === before; i++) await new Promise(r => setImmediate(r));
    await whenCardsIdle();
  }

  test('"watch" on its own takes the program from the message before it', async () => {
    // Two messages, each its own thread, as a DM really is.
    fakes.userChat.threads.set(`${DM}/threads/d1`, [{
      name: `${DM}/messages/m-post`,
      sender: { name: CHRIS, displayName: NAMES[CHRIS], type: 'HUMAN' },
      text: `${PROGRAM} closes November 15, 2026. https://granted.ca/rtri`,
      annotations: [],
      createTime: new Date(Date.now() - 60_000).toISOString(),
      thread: { name: `${DM}/threads/d1` }
    }]);

    await sayInDm('watch');

    const card = await liveWatch();
    expect(card.space_name).toBe(DM);
    expect(card.data.program.name).toBe(PROGRAM);
    expect(card.data.program.matched).toBe(true);
    // The card is posted in the DM (alongside Oracle's own first-DM intro),
    // and the joining DM still goes out.
    const watchPosts = fakes.chat.posts
      .filter(p => p.spaceName === DM && p.cardsV2?.[0]?.cardId?.startsWith('tracked-'));
    expect(watchPosts).toHaveLength(1);
    expect(dmsTo('spaces/DM-CHRIS').some(t => /You’re watching/.test(t))).toBe(true);
    expect(logged()).toContain('👁️  Watch subject taken from recent');
  });

  test('recent chatter that names no program is quoted back, not guessed at', async () => {
    fakes.userChat.threads.set(`${DM}/threads/d1`, [{
      name: `${DM}/messages/m-chat`,
      sender: { name: CHRIS, displayName: NAMES[CHRIS], type: 'HUMAN' },
      text: 'thanks!',
      annotations: [],
      createTime: new Date(Date.now() - 60_000).toISOString(),
      thread: { name: `${DM}/threads/d1` }
    }]);

    await sayInDm('watch');

    expect(watchCards()).toHaveLength(0);
    const asked = fakes.chat.posts.map(p => p.text || '').find(t => /Which program did you mean/.test(t));
    expect(asked).toContain('“thanks!”');
  });

  test('an empty conversation: Oracle says it cannot tell', async () => {
    await sayInDm('watch');

    expect(watchCards()).toHaveLength(0);
    expect(fakes.chat.posts.some(p => /couldn’t tell which program/.test(p.text || ''))).toBe(true);
  });

  test('two programs in the last few messages: the nearest is quoted and confirmed', async () => {
    const at = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString();
    fakes.userChat.threads.set(`${DM}/threads/d1`, [{
      name: `${DM}/messages/m-old`,
      sender: { name: CHRIS, displayName: NAMES[CHRIS], type: 'HUMAN' },
      text: 'Canada Summer Jobs opens in January',
      annotations: [], createTime: at(300), thread: { name: `${DM}/threads/d1` }
    }]);
    fakes.userChat.threads.set(`${DM}/threads/d2`, [{
      name: `${DM}/messages/m-new`,
      sender: { name: CHRIS, displayName: NAMES[CHRIS], type: 'HUMAN' },
      text: `${PROGRAM} closes November 15, 2026`,
      annotations: [], createTime: at(60), thread: { name: `${DM}/threads/d2` }
    }]);

    await sayInDm('watch');

    expect(watchCards()).toHaveLength(0);
    const asked = fakes.chat.posts.map(p => p.text || '').find(t => /Which program did you mean/.test(t));
    expect(asked).toBeTruthy();
    expect(asked).toContain(PROGRAM);           // the nearest one, quoted
  });

  test('naming the program in the message needs no looking back at all', async () => {
    await sayInDm(`watch ${PROGRAM}`);

    const card = await liveWatch();
    expect(card.data.program.name).toBe(PROGRAM);
    // No looking back: nothing read the conversation's recent messages.
    expect(fakes.userChat.calls.filter(c => c.orderBy)).toHaveLength(0);
  });
});

describe('answering before the lookup', () => {
  test('the program lookup and the joining DM happen after the turn is answered', async () => {
    fakes.userChat.threads.set(THREAD, [chatMessage({
      id: 'post-slow',
      text: `${PROGRAM}: closes November 15, 2026. https://granted.ca/rtri`
    })]);
    // Hold the grants table open: the turn must finish anyway.
    let release;
    fakes.grants.hold = new Promise(resolve => { release = resolve; });

    // Deliberately not say(), which waits for the card work to go idle.
    const ends = () => logLines().filter(l => l.includes('Chat background task END')).length;
    const before = ends();
    await post(messageBody({ text: 'watch' }));
    for (let i = 0; i < 2000 && ends() === before; i++) await new Promise(r => setImmediate(r));

    expect(ends()).toBe(before + 1);            // the turn is answered…
    expect(watchCards()).toHaveLength(0);       // …before anything is posted

    release();
    await whenCardsIdle();

    const card = await liveWatch();
    expect(card.data.program.name).toBe(PROGRAM);
    expect(fakes.chat.posts.filter(p => p.cardsV2)).toHaveLength(1);
  });

  test('"Watch this" answers the press, then sends the DM', async () => {
    const card = await watchThePost();
    let release;
    fakes.hubspot.hold = new Promise(resolve => { release = resolve; });

    const answer = await press(card, 'watch.join', NAT);
    expect(answer?.hostAppDataAction?.chatDataAction?.updateMessageAction).toBeTruthy();
    expect(dmsTo('spaces/DM-NAT')).toHaveLength(0);   // not yet: the press came first

    release();
    await whenCardsIdle();
    expect(dmsTo('spaces/DM-NAT').filter(t => /You’re watching/.test(t))).toHaveLength(1);
  });
});

// ============================================================================
// THE WRONG PROGRAM
// ============================================================================

describe('"Not this one?"', () => {
  test('offers the next best matches and moves the watch, keeping one card in the space', async () => {
    const card = await watchThePost();
    const message = card.message_name;

    await press(card, 'watch.not_this', CHRIS);
    await whenCardsIdle();
    const picking = await liveWatch();
    expect(await textOf(picking)).toContain('Rural Transit Modernisation Fund');
    expect(await buttonsOf(picking)).toEqual(expect.arrayContaining(['Keep this one']));

    await press(picking, 'watch.pick1', CHRIS);
    await whenCardsIdle();

    const after = await liveWatch();
    expect(after.data.program.name).toBe('Rural Transit Modernisation Fund');
    expect(after.thread_name).toBe(`${SPACE}/threads/watch-rural-transit-modernisation-fund`);
    // The watchers came across, and the card is still the same message.
    expect(await watchersOf(after.id)).toEqual(expect.arrayContaining([CHRIS]));
    expect(after.message_name).toBe(message);
    expect(spacePosts().filter(p => p.cardsV2)).toHaveLength(1);
  });

  test('with nothing else to offer, the presser is told privately and the card is unchanged', async () => {
    fakes.grants.grants = fakes.grants.grants.slice(0, 1);
    const card = await watchThePost();
    expect(card.data.candidates).toEqual([]);

    await press(card, 'watch.not_this', CHRIS);
    await whenCardsIdle();

    expect((await liveWatch()).data.picking).toBe(false);
    expect(privateReplies().some(([to, t]) => to === CHRIS && /watch &lt;program name&gt;|watch <program name>/.test(t))).toBe(true);
  });
});

// ============================================================================
// REMINDERS
// ============================================================================

describe('reminders', () => {
  /** A watch whose deadline is `days` away, with Nat watching too. */
  async function watchWithDeadline(days) {
    const card = await watchThePost();
    await press(card, 'watch.join', NAT);
    await whenCardsIdle();
    await fakes.store.patchCardData(card.id, {
      program: { ...card.data.program, opensAt: null, deadline: new Date(Date.now() + days * DAY).toISOString() }
    });
    return fakes.store.getCard(card.id);
  }

  test('14 days out, then 2 days out, one DM each to every watcher', async () => {
    const card = await watchWithDeadline(10);
    const before = dmsTo('spaces/DM-CHRIS').length;

    const counts = await notify.sendDueReminders(atLocal9(0));
    expect(counts.watchNotices).toBe(2);                     // Chris and Nat
    expect(dmsTo('spaces/DM-CHRIS').length).toBe(before + 1);
    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('closes in 10 days');

    // Same day again: nothing.
    await notify.sendDueReminders(atLocal9(0));
    expect(dmsTo('spaces/DM-CHRIS').length).toBe(before + 1);

    // The 2-day mark is its own reminder.
    await fakes.store.patchCardData(card.id, {
      program: { ...card.data.program, deadline: new Date(Date.now() + 2 * DAY).toISOString() }
    });
    await notify.sendDueReminders(atLocal9(1));
    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('closes in 1 day');
  });

  test('the day before it opens', async () => {
    const card = await watchThePost();
    await fakes.store.patchCardData(card.id, {
      program: { ...card.data.program, deadline: null, opensAt: new Date(Date.now() + DAY).toISOString() }
    });

    await notify.sendDueReminders(atLocal9(0));
    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('opens tomorrow');
  });

  test('several things due on one day arrive as one message', async () => {
    const card = await watchWithDeadline(10);
    listened.add(SPACE);
    await onStoredMessages(SPACE, [chatMessage({ id: 'news1', text: `${PROGRAM} guidance was updated` })]);

    await notify.sendDueReminders(atLocal9(0));
    const dm = dmsTo('spaces/DM-CHRIS').at(-1);
    expect(dm).toContain('closes in 10 days');
    expect(dm).toContain('Someone posted about');
    // One message, not two.
    expect(dmsTo('spaces/DM-CHRIS').filter(t => /what's new/.test(t))).toHaveLength(1);
  });

  test('one DM a day per watcher: a later post waits for tomorrow', async () => {
    const card = await watchWithDeadline(10);
    listened.add(SPACE);
    await notify.sendDueReminders(atLocal9(0));
    const afterFirst = dmsTo('spaces/DM-CHRIS').length;

    // Something else happens the same day.
    await onStoredMessages(SPACE, [chatMessage({ id: 'later', text: `${PROGRAM} guidance was updated again` })]);
    await notify.sendDueReminders(atLocal9(0));
    expect(dmsTo('spaces/DM-CHRIS')).toHaveLength(afterFirst);
    expect((await fakes.store.getCard(card.id)).data.pending).toHaveLength(1);

    // Tomorrow it goes.
    await notify.sendDueReminders(atLocal9(1));
    expect(dmsTo('spaces/DM-CHRIS').length).toBe(afterFirst + 1);
    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('Someone posted about');
  });

  test('nothing before 08:00 in the watcher’s own morning', async () => {
    await watchWithDeadline(10);
    const beforeDawn = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:00Z`);   // 01:00 PDT
    expect((await notify.sendDueReminders(beforeDawn)).watchNotices).toBe(0);
  });

  test('a muted watcher hears nothing', async () => {
    const card = await watchWithDeadline(10);
    await fakes.store.setMuted(card.id, NAT, true);

    await notify.sendDueReminders(atLocal9(0));
    expect(dmsTo('spaces/DM-NAT').filter(t => /closes in/.test(t))).toHaveLength(0);
    expect(dmsTo('spaces/DM-CHRIS').filter(t => /closes in/.test(t))).toHaveLength(1);
  });

  test('reminders are DMs only: the space still has just the card', async () => {
    await watchWithDeadline(10);
    await notify.sendDueReminders(atLocal9(0));

    expect(spacePosts().filter(p => !p.privateTo)).toHaveLength(1);
    expect(fakes.chat.patches.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// ENDING AND REOPENING
// ============================================================================

describe('ending a watch', () => {
  test('the day after the deadline: one last DM, then it ends', async () => {
    const card = await watchThePost();
    await fakes.store.patchCardData(card.id, {
      program: { ...card.data.program, opensAt: null, deadline: new Date(Date.now() - DAY).toISOString() }
    });

    const counts = await notify.sendDueReminders(atLocal9(0));
    expect(counts.watchClosed).toBe(1);
    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('deadline has passed');
    expect((await fakes.store.getCard(card.id)).status).toBe('closed');
  });

  test('a post saying it closed ends it too', async () => {
    const card = await watchThePost();
    listened.add(SPACE);

    await onStoredMessages(SPACE, [chatMessage({ id: 'closed', text: `${PROGRAM} is now closed for the year` })]);
    await notify.sendDueReminders(atLocal9(0));

    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('has closed');
    expect((await fakes.store.getCard(card.id)).data.endedBy).toBe('closed_post');
  });

  test('the last watcher leaving ends it', async () => {
    const card = await watchThePost();
    await press(card, 'watch.stop', CHRIS);
    await whenCardsIdle();

    expect((await fakes.store.getCard(card.id)).status).toBe('closed');
  });

  test('one of several watchers leaving does not', async () => {
    const card = await watchThePost();
    await press(card, 'watch.join', NAT);
    await whenCardsIdle();
    await press(await liveWatch(), 'watch.stop', NAT);
    await whenCardsIdle();

    const after = await liveWatch();
    expect(after.status).toBe('open');
    expect(await watchersOf(after.id)).toEqual([CHRIS]);
  });

  test('with no dates, Oracle asks after six months and closes if nobody answers', async () => {
    const card = await watchThePost({ text: `${PROGRAM} is worth keeping an eye on. https://granted.ca/rtri` });
    await fakes.store.patchCardData(card.id, { program: { ...card.data.program, deadline: null, opensAt: null } });
    // Backdate the card itself.
    const row = fakes.db.cards.get(card.id);
    row.created_at = new Date(Date.now() - 200 * DAY);

    await notify.sendDueReminders(atLocal9(0));
    expect(dmsTo('spaces/DM-CHRIS').at(-1)).toContain('still watching it?');
    const asked = await liveWatch();
    expect(await textOf(asked)).toContain('Still watching this?');
    expect(await buttonsOf(asked)).toEqual(['Yes, keep watching', 'Stop watching']);

    // Answering keeps it.
    await press(asked, 'watch.keep', CHRIS);
    await whenCardsIdle();
    expect((await liveWatch()).data.check).toBeNull();
  });

  test('a watch never goes stale on its own', async () => {
    const card = await watchThePost();
    await applyLifecycle(new Date(Date.now() + 60 * DAY));

    expect((await fakes.store.getCard(card.id)).status).toBe('open');
  });

  test('the program coming back tells everyone who watched it before', async () => {
    const card = await watchThePost();
    await press(card, 'watch.join', NAT);
    await whenCardsIdle();
    await press(await liveWatch(), 'watch.end', CHRIS);
    await whenCardsIdle();
    expect((await fakes.store.getCard(card.id)).status).toBe('closed');

    // Nat starts it again, from a different post.
    fakes.chat.posts.length = 0;
    await watchThePost({ sender: NAT, thread: OTHER_THREAD });

    // Whoever watched it before hears that it is back; the person restarting it
    // gets the full joining message.
    expect(dmsTo('spaces/DM-CHRIS').some(t => /is back/.test(t))).toBe(true);
    expect(dmsTo('spaces/DM-NAT').some(t => /You’re watching/.test(t))).toBe(true);
  });
});

// ============================================================================
// WHAT IS NEVER SAID, AND WHAT IS NEVER LOGGED
// ============================================================================

describe('what Oracle never says', () => {
  test('nothing names GetGranted, GG3 or the grants table', async () => {
    fakes.hubspot.deals = [{ name: 'Acme — RTRI', companyName: 'Acme Foods' }];
    fakes.hubspot.companies = [{ name: 'Rural Haulage Ltd', industry: 'Transportation' }];
    const card = await watchThePost();
    await press(card, 'watch.join', NAT);
    await whenCardsIdle();
    await notify.sendDueReminders(atLocal9(0));

    const said = await everythingSaid();
    for (const forbidden of ['GetGranted', 'getgranted', 'GG3', 'grants table', 'our database']) {
      expect(said).not.toContain(forbidden);
    }
    expect(said).toContain(PROGRAM);
  });

  test('possible clients are capped at five', async () => {
    fakes.hubspot.deals = Array.from({ length: 4 }, (_, i) => ({ name: `Deal ${i}`, companyName: `Applied Co ${i}` }));
    fakes.hubspot.companies = Array.from({ length: 6 }, (_, i) => ({ name: `Industry Co ${i}`, industry: 'Transportation' }));
    await watchThePost();

    const dm = dmsTo('spaces/DM-CHRIS')[0];
    const listed = dm.split('\n').filter(line => line.startsWith('- '));
    expect(listed).toHaveLength(5);
  });

  test('logs carry codes and counts only', async () => {
    fakes.hubspot.deals = [{ name: 'Acme — RTRI', companyName: 'Acme Sentinel Foods' }];
    const card = await watchThePost();
    await press(card, 'watch.join', NAT);
    await whenCardsIdle();
    await notify.sendDueReminders(atLocal9(0));

    // The card's own lines: 👁️ is this card, 🗂️/🔔 the foundation's. (The Chat
    // adapter logs the signed-in user's address on every event; that line is
    // older than this card and is not card code.)
    const cardLines = logLines().filter(l => /👁️|🗂️|🔔|⏰/.test(l)).join('\n');
    for (const secret of ['Acme Sentinel Foods', NAMES[CHRIS], EMAILS[CHRIS], 'granted.ca/rtri', PROGRAM]) {
      expect(cardLines).not.toContain(secret);
    }
    expect(cardLines).toContain('👁️  Watch card posted');
  });
});
