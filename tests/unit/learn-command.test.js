/**
 * /learn-this as a registered slash command (ID 6), with the typed form as fallback
 *
 * Through the real Chat adapter: the command event is answered at once, then
 * runs the same learn run as "@Oracle /learn-this" — the lesson card in the
 * command's thread (private in a space), the thread read as the person, one
 * restricted Oracle run. In a DM the text after the command is the lesson. A
 * person who isn't signed in gets the private sign-in reply; an unknown command
 * ID is ignored; the typed form still works.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/learn-command.test.js
 */

import { jest } from '@jest/globals';
import { createTrackedCardFakes, cardText } from './helpers/tracked-cards-fakes.js';

const ENDPOINT = 'https://hub.example/api/chat/google';
const ISSUER = 'addon@example.iam.gserviceaccount.com';
Object.assign(process.env, {
  GOOGLE_CHAT_AUDIENCE: ENDPOINT,
  GOOGLE_CHAT_ISSUER_EMAIL: ISSUER,
  GOOGLE_SERVICE_ACCOUNT_KEY: '{}',
  PUBLIC_URL: 'https://hub.example'
});
delete process.env.CHAT_LEARN_COMMAND_ID;

const fakes = createTrackedCardFakes();

const KELLY = 'users/kelly';
const STRANGER = 'users/stranger';
const NAMES = { [KELLY]: 'Kelly Sentinel', [STRANGER]: 'Stranger Sentinel' };
const EMAILS = { [KELLY]: 'kelly.sentinel@granted.ca', [STRANGER]: 'stranger@example.com' };
const HUB = [{
  id: 3, email: EMAILS[KELLY], name: NAMES[KELLY], is_active: true, google_refresh_token: 'rt',
  google_granted_scopes: 'https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.spaces.readonly',
  chat_user_id: KELLY
}];

// team_lessons, in memory: what the learn run saves (as the tool would) and
// what the lesson card reads back.
const lessonRows = [];
const lessonsFake = {
  LESSON_STATUSES: ['verified', 'unverified', 'conflict'],
  PENDING_TTL_MS: 24 * 3600 * 1000,
  MAX_PENDING_PER_CARD: 10,
  async pendingForCard(cardId) { return lessonRows.filter(r => r.card_id === cardId && r.state === 'pending'); },
  async lessonsForCard(cardId) { return lessonRows.filter(r => r.card_id === cardId); },
  async countPendingForCard(cardId) { return lessonRows.filter(r => r.card_id === cardId && r.state === 'pending').length; },
  async saveLesson(row) { const id = lessonRows.length + 1; lessonRows.push({ id, state: 'pending', ...row }); return { id }; },
  async confirmLesson() { return null; },
  async discardLesson() { return false; },
  async expirePending() { return { expired: [], cardIds: [] }; },
  async recordKnown() {},
  async recordOverflow() {},
  async activeLessons() { return []; },
  formatLessons: () => '',
  statusLabel: () => ''
};

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        async verifyIdToken() { return { getPayload: () => ({ email_verified: true, email: ISSUER }) }; }
      },
      GoogleAuth: class {}
    },
    chat: (opts) => (opts?.auth?.userId
      ? fakes.userChat.client(opts.auth.userId)
      : { spaces: { messages: { create: async () => ({ data: {} }) } } })
  }
}));
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (sql, params = []) => {
    if (/FROM users\s+WHERE LOWER\(email\)/.test(sql)) {
      return { rows: HUB.filter(u => u.email.toLowerCase() === String(params[0]).toLowerCase()) };
    }
    if (/SELECT google_granted_scopes FROM users WHERE id/.test(sql)) return { rows: HUB.filter(u => u.id === params[0]) };
    if (/SELECT email FROM users WHERE id/.test(sql)) return { rows: HUB.filter(u => u.id === params[0]) };
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
  isListenSpace: () => false, listenReady: () => false, listenDisabled: () => false, listenSpaces: () => [], listenEntry: () => null
}));
jest.unstable_mockModule('../../src/chat-listen/subscriptions.js', () => ({
  enableSpace: async () => {}, teardownSpace: async () => {}, syncSpace: async () => ({ outcome: 'skipped' }), withSpaceLock: async (_s, fn) => fn()
}));
jest.unstable_mockModule('../../src/database/chat-listen-store.js', () => fakes.listen.module);
jest.unstable_mockModule('../../src/claude/client.js', () => fakes.agent.module);
jest.unstable_mockModule('../../src/database/messages.js', () => fakes.messages.module);
jest.unstable_mockModule('../../src/database/tracked-cards-store.js', () => fakes.store);
jest.unstable_mockModule('../../src/cards/chat-api.js', () => fakes.chat.module);
jest.unstable_mockModule('../../src/tools/google-drive.js', () => fakes.drive.module);
jest.unstable_mockModule('../../src/tools/pending-actions.js', () => fakes.gate.module);
jest.unstable_mockModule('../../src/tools/directory-names.js', () => fakes.directory.module);
jest.unstable_mockModule('../../src/tools/google-calendar.js', () => fakes.calendar.module);
jest.unstable_mockModule('../../src/tools/granola.js', () => fakes.granola.module);
jest.unstable_mockModule('../../src/database/team-lessons-store.js', () => lessonsFake);

const { handleGoogleChatEvent } = await import('../../src/api/chat-google.js');
const { whenCardsIdle } = await import('../../src/cards/actions.js');
const { LEARN_COMMAND_ID } = await import('../../src/cards/commands.js');

const SPACE = 'spaces/RTRI';
const THREAD = `${SPACE}/threads/T1`;
const DM = 'spaces/DM-KELLY';
const DM_THREAD = `${DM}/threads/D1`;
let seq = 0;

function commandBody({ commandId = LEARN_COMMAND_ID, argumentText = '', sender = KELLY, space = SPACE, thread = THREAD, type = 'ROOM' }) {
  return {
    chat: {
      user: { name: sender, displayName: NAMES[sender], type: 'HUMAN' },
      appCommandPayload: {
        appCommandMetadata: { appCommandId: Number(commandId), appCommandType: 'SLASH_COMMAND' },
        message: {
          name: `${space}/messages/cmd${++seq}`,
          text: `/learn-this ${argumentText}`.trim(),
          argumentText,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread },
          createTime: new Date().toISOString()
        },
        space: { name: space, type, displayName: type === 'ROOM' ? 'RTRI' : null }
      }
    }
  };
}

function messageBody({ text, sender = KELLY, space = SPACE, thread = THREAD }) {
  return {
    chat: {
      user: { name: sender, displayName: NAMES[sender], type: 'HUMAN' },
      messagePayload: {
        message: {
          name: `${space}/messages/in${++seq}`,
          text: `@Oracle ${text}`,
          argumentText: text,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread },
          annotations: [{ type: 'USER_MENTION', userMention: { user: { name: 'users/app', displayName: 'Oracle', type: 'BOT' } } }]
        },
        space: { name: space, type: 'ROOM', displayName: 'RTRI' }
      }
    }
  };
}

async function post(body) {
  let answer;
  const res = { status: () => res, json: (b) => { answer = b; return res; } };
  await handleGoogleChatEvent({ headers: { authorization: 'Bearer token' }, body }, res);
  return answer;
}

async function settle() {
  for (let i = 0; i < 2000; i++) await new Promise(r => setImmediate(r));
  await whenCardsIdle();
}

const lessonCardPosts = () => fakes.chat.posts.filter(p => p.cardsV2 && /Lessons to confirm/.test(cardText(p.cardsV2)));

beforeEach(() => {
  fakes.reset();
  lessonRows.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  fakes.userChat.threads.set(THREAD, [
    { name: `${SPACE}/messages/k1`, sender: { name: KELLY, displayName: NAMES[KELLY] }, createTime: new Date(Date.now() - 60000).toISOString(), text: 'PacifiCan said they acknowledge complete applications within 10 business days.', thread: { name: THREAD } }
  ]);
  // What the learn run does when it finds a new lesson: save it pending on the card.
  fakes.agent.impl = async (args) => {
    if (args.chatContext?.learnMode) {
      await lessonsFake.saveLesson({ card_id: args.chatContext.lessonCardId, lesson: 'Acknowledged within 10 business days.', topic: 'acknowledgement', status: 'unverified' });
    }
    return { success: true, response: { content: [{ type: 'text', text: 'Found one lesson.' }] } };
  };
});

afterEach(() => jest.restoreAllMocks());

describe('the registered command', () => {
  test('ID 6 is /learn-this', () => {
    expect(LEARN_COMMAND_ID).toBe('6');
  });

  test('in a space: answered at once, then a private "Checking…" card in the command\'s thread, the thread read, one restricted run, and the lesson on the card', async () => {
    const answer = await post(commandBody({}));
    expect(answer).toEqual({});
    await settle();

    const [first] = lessonCardPosts();
    expect(first).toMatchObject({ spaceName: SPACE, threadName: THREAD, privateTo: KELLY });
    expect(cardText(first.cardsV2)).toMatch(/Checking what to learn/);

    const run = fakes.agent.calls.at(-1);
    expect(run.chatContext).toMatchObject({ learnMode: true, spaceName: SPACE, threadName: THREAD });
    expect(run.chatContext.lessonCardId).toBeTruthy();
    expect(run.allowedTools).toContain('save_team_lesson');
    expect(run.allowedTools).not.toContain('create_google_doc');
    const transcript = run.attachments.find(a => a.filename === 'thread transcript');
    expect(transcript.content).toMatch(/Kelly Sentinel .*acknowledge complete applications within 10 business days/);
    expect(transcript.ephemeral).toBe(true);

    // The same card, updated in place: the lesson waiting for confirmation.
    const patched = fakes.chat.patches.at(-1);
    expect(patched.messageName).toBe(first.name);
    expect(cardText(patched.cardsV2)).toMatch(/Acknowledged within 10 business days/);
    expect(lessonCardPosts()).toHaveLength(1);
  });

  test('in a DM: the text after the command is the lesson, and the card is a normal reply in the thread', async () => {
    await post(commandBody({ space: DM, thread: DM_THREAD, type: 'DM', argumentText: 'PacifiCan pays claims within 30 days' }));
    await settle();
    const [card] = lessonCardPosts();
    expect(card).toMatchObject({ spaceName: DM, threadName: DM_THREAD, privateTo: null });
    const run = fakes.agent.calls.at(-1);
    const source = run.attachments.find(a => a.filename === 'your messages');
    expect(source.content).toMatch(/direct message/);
    // The lesson line is the text after the command, with the command itself taken out.
    expect(source.content).toMatch(/- Kelly Sentinel \([^)]*\): PacifiCan pays claims within 30 days$/m);
    expect(source.content).not.toMatch(/: \/learn-this/);
  });

  test('someone who isn\'t signed in gets the private sign-in reply; nothing runs', async () => {
    await post(commandBody({ sender: STRANGER }));
    await settle();
    expect(fakes.agent.calls).toHaveLength(0);
    expect(lessonCardPosts()).toHaveLength(0);
    const reply = fakes.chat.posts.at(-1);
    expect(reply).toMatchObject({ spaceName: SPACE, privateTo: STRANGER });
    expect(reply.text).toMatch(/hub\.example\/login/);
  });

  test('an unregistered command ID is ignored', async () => {
    const answer = await post(commandBody({ commandId: 99 }));
    await settle();
    expect(answer).toEqual({});
    expect(fakes.agent.calls).toHaveLength(0);
    expect(fakes.chat.posts).toHaveLength(0);
  });
});

describe('the typed form still works as a fallback', () => {
  test('"… /learn-this" in a message runs the same learn run and card', async () => {
    await post(messageBody({ text: 'PacifiCan said 10 business days. /learn-this' }));
    await settle();
    const [card] = lessonCardPosts();
    expect(card).toMatchObject({ spaceName: SPACE, threadName: THREAD, privateTo: KELLY });
    expect(fakes.agent.calls.at(-1).chatContext).toMatchObject({ learnMode: true });
  });
});
