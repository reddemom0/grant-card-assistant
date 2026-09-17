/**
 * Tracked cards — the shared foundation
 *
 * Drives the real Chat handler, click handling, lifecycle, notifications and
 * digest code with the database, Chat API, Drive, HubSpot, directory and
 * calendar replaced by the in-memory fakes in helpers/tracked-cards-fakes.js.
 * The review card is the card type used here; its own behaviour is covered in
 * review-card.test.js.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tracked-cards.test.js
 */

import { jest } from '@jest/globals';
import { createTrackedCardFakes, cardText, cardButtons, allCardStrings } from './helpers/tracked-cards-fakes.js';

const ENDPOINT = 'https://hub.example/api/chat/google';
const ISSUER = 'addon@example.iam.gserviceaccount.com';
process.env.GOOGLE_CHAT_AUDIENCE = ENDPOINT;
process.env.GOOGLE_CHAT_ISSUER_EMAIL = ISSUER;
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
process.env.PUBLIC_URL = 'https://hub.example';
delete process.env.DEFAULT_TIMEZONE;          // default zone is America/Vancouver
delete process.env.TRACKED_CARDS_DISABLED;

const fakes = createTrackedCardFakes();

// --- modules replaced ------------------------------------------------------
const chatApiCreates = [];
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
    chat: () => ({ spaces: { messages: { create: async (req) => { chatApiCreates.push(req); return { data: {} }; } } } })
  }
}));
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async () => ({ rows: [] }), getPool: () => null, transaction: async () => null
}));
jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: async () => null, getDocsClient: async () => null, getDriveClient: async () => null
}));
jest.unstable_mockModule('../../src/api/confirmation.js', () => ({
  tryHandleConfirmation: async () => null, currentPendingId: async () => null, proposalNotice: async () => null
}));
jest.unstable_mockModule('../../src/claude/client.js', () => fakes.agent.module);
jest.unstable_mockModule('../../src/database/messages.js', () => fakes.messages.module);
jest.unstable_mockModule('../../src/database/tracked-cards-store.js', () => fakes.store);
jest.unstable_mockModule('../../src/cards/chat-api.js', () => fakes.chat.module);
jest.unstable_mockModule('../../src/tools/google-drive.js', () => fakes.drive.module);
jest.unstable_mockModule('../../src/tools/hubspot.js', () => fakes.hubspot.module);
jest.unstable_mockModule('../../src/tools/pending-actions.js', () => fakes.gate.module);
jest.unstable_mockModule('../../src/tools/directory-names.js', () => fakes.directory.module);
jest.unstable_mockModule('../../src/tools/google-calendar.js', () => fakes.calendar.module);

const { handleGoogleChatEvent, normalizeChatEvent } = await import('../../src/api/chat-google.js');
const { handleCardClick, whenCardsIdle } = await import('../../src/cards/actions.js');
const { registerAppCommand } = await import('../../src/cards/registry.js');
const { renderCard } = await import('../../src/cards/update.js');
const render = await import('../../src/cards/render.js');
const lifecycle = await import('../../src/cards/lifecycle.js');
const notify = await import('../../src/cards/notify.js');
const { startTrackedCards } = await import('../../src/cards/jobs.js');

// --- fixtures ----------------------------------------------------------------
// Sentinels: none of these may ever appear in a log line.
const TITLE = 'Sentinel Widgets Ltd — RTRI';
const OWNER_EMAIL = 'sentinel.owner@granted.ca';
const NAMES = {
  'users/100': 'Olivia Sentinel',
  'users/201': 'Steph Sentinel',
  'users/202': 'Natalie Sentinel',
  'users/999': 'Oscar Sentinel'
};
const OWNER = 'users/100';
const STEPH = 'users/201';
const NATALIE = 'users/202';
const OUTSIDER = 'users/999';

const SPACE = 'spaces/AAA';
const CONV = '22222222-2222-4222-8222-222222222222';
const DOC = 'DOC_AAAAAAAAAAAA';
const DAY = 24 * 60 * 60 * 1000;

let threadSeq = 0;

/** A review card as track_review leaves it: stored, participants added, message posted. */
async function seedCard({ openComments = 3, status = 'open' } = {}) {
  const thread = `${SPACE}/threads/T${++threadSeq}`;
  const docs = [{ fileId: DOC, name: 'Application draft', openComments, readable: true }];
  fakes.drive.docs.set(DOC, { name: 'Application draft', openComments });
  const card = await fakes.store.insertCard({
    cardType: 'review', status, spaceName: SPACE, threadName: thread, conversationId: CONV,
    ownerChatId: OWNER, ownerUserId: 1, title: TITLE,
    data: {
      client: 'Sentinel Widgets Ltd', program: 'RTRI', requesterName: NAMES[OWNER],
      surface: 'chat_space', reviewers: [], docIds: [DOC], docs,
      precheck: { source: null, text: null }, missingInfo: [], hubspot: { state: 'none' },
      notice: null
    }
  });
  await fakes.store.addParticipants(card.id, [
    { chatUserId: OWNER, role: 'owner', displayName: NAMES[OWNER] },
    { chatUserId: STEPH, role: 'reviewer', displayName: NAMES[STEPH] },
    { chatUserId: NATALIE, role: 'reviewer', displayName: NAMES[NATALIE] }
  ]);
  const messageName = await fakes.chat.module.postMessage({
    spaceName: SPACE, threadName: thread, cardsV2: await renderCard(card)
  });
  await fakes.store.updateCard(card.id, { messageName });
  fakes.chat.posts.length = 0;   // each test starts with nothing posted
  return fakes.store.getCard(card.id);
}

const clickEvt = (card, action, actor = STEPH, extra = {}) => ({
  actorChatId: actor,
  actorName: NAMES[actor],
  actorEmail: null,
  messageName: card.message_name,
  parameters: { cardId: card.id, action, ...extra }
});

const updatedCard = (response) =>
  response?.hostAppDataAction?.chatDataAction?.updateMessageAction?.message?.cardsV2;

const statuses = async (cardId) => Object.fromEntries(
  (await fakes.store.getParticipants(cardId)).filter(p => p.role === 'reviewer').map(p => [p.chat_user_id, p.status])
);

const logged = () => [console.log, console.warn, console.error]
  .flatMap(fn => fn.mock.calls)
  .map(args => args.map(a => (a instanceof Error ? a.message : String(a))).join(' '))
  .join('\n');

beforeEach(() => {
  fakes.reset();
  chatApiCreates.length = 0;
  fakes.db.users.push({ id: 1, email: OWNER_EMAIL, name: NAMES[OWNER], chat_user_id: OWNER, is_active: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await whenCardsIdle();
  const output = logged();
  jest.restoreAllMocks();
  // No card code may log a title, a person's name or an email — ever.
  expect(output).not.toMatch(/Sentinel/);
  expect(output).not.toMatch(/@granted\.ca/);
});

// ============================================================================
// CHAT ROUTING
// ============================================================================

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

async function send(body) {
  const res = mockRes();
  await handleGoogleChatEvent({ headers: { authorization: 'Bearer token' }, body }, res);
  return res;
}

/** A button press in the add-on wire shape. The pressed message was sent by Oracle. */
const buttonBody = (card, action, actor = STEPH) => ({
  commonEventObject: { hostApp: 'CHAT', parameters: { cardId: card.id, action } },
  chat: {
    user: { name: actor, displayName: NAMES[actor], type: 'HUMAN' },
    buttonClickedPayload: {
      message: { name: card.message_name, sender: { name: 'users/app', type: 'BOT' }, thread: { name: card.thread_name } },
      space: { name: SPACE, type: 'ROOM' }
    }
  }
});

const commandBody = (id) => ({
  chat: {
    user: { name: STEPH, type: 'HUMAN' },
    appCommandPayload: {
      appCommandMetadata: { appCommandId: id, appCommandType: 'SLASH_COMMAND' },
      message: { name: `${SPACE}/messages/x`, text: '/track', sender: { name: STEPH, type: 'HUMAN' } },
      space: { name: SPACE, type: 'ROOM' }
    }
  }
});

describe('Chat routes button presses and app commands', () => {
  test('a press on a card answers with an in-place update and posts nothing', async () => {
    const card = await seedCard();
    const res = await send(buttonBody(card, 'review.reviewing'));

    expect(res.status).toHaveBeenCalledWith(200);
    const cards = updatedCard(res.json.mock.calls[0][0]);
    expect(cards[0].cardId).toBe(`tracked-${card.id}`);
    expect(cardText(cards)).toContain('Reviewing');
    expect(await statuses(card.id)).toEqual({ [STEPH]: 'reviewing', [NATALIE]: 'not_started' });
    expect(chatApiCreates).toHaveLength(0);
    expect(fakes.chat.posts).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(0);
  });

  test('a press for a card that does not exist acks with an empty body', async () => {
    const card = await seedCard();
    const res = await send(buttonBody({ ...card, id: '33333333-3333-4333-8333-333333333333' }, 'review.done'));
    expect(res.json.mock.calls[0][0]).toEqual({});
    expect(logged()).toContain('reason: card_not_found');
  });

  test('a press with no card parameters acks with an empty body', async () => {
    const body = buttonBody(await seedCard(), 'review.done');
    body.commonEventObject.parameters = {};
    const res = await send(body);
    expect(res.json.mock.calls[0][0]).toEqual({});
    expect(fakes.db.clicks).toHaveLength(0);
  });

  test('a dialog event is routed to the dialog handler — which only closes while dialogs are off', async () => {
    const card = await seedCard();
    const body = buttonBody(card, 'track.decision');
    body.chat.buttonClickedPayload.isDialogEvent = true;
    body.chat.buttonClickedPayload.dialogEventType = 'REQUEST_DIALOG';
    const res = await send(body);
    expect(res.json.mock.calls[0][0]).toEqual({ action: { navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }] } });
    expect(fakes.db.clicks).toHaveLength(0);
  });

  test('an unregistered app command is acknowledged and logged by id', async () => {
    const res = await send(commandBody(7));
    expect(res.json.mock.calls[0][0]).toEqual({});
    expect(logged()).toContain('App command not registered — id: 7');
    expect(fakes.agent.calls).toHaveLength(0);
  });

  test('a registered app command answers with its handler’s response', async () => {
    registerAppCommand(8, async (evt) => ({ handled: evt.appCommandId, by: evt.actorChatId }));
    const res = await send(commandBody(8));
    expect(res.json.mock.calls[0][0]).toEqual({ handled: 8, by: STEPH });
  });
});

describe('normalizeChatEvent reads what cards need', () => {
  const message = {
    name: `${SPACE}/messages/M1`,
    text: '@Oracle can @Steph and @Natalie review https://docs.google.com/document/d/DOC_FROM_TEXT_1/edit and this',
    sender: { name: OWNER, displayName: NAMES[OWNER], type: 'HUMAN' },
    thread: { name: `${SPACE}/threads/T` },
    annotations: [
      { type: 'USER_MENTION', userMention: { user: { name: 'users/app', displayName: 'Oracle', type: 'BOT' } } },
      { type: 'USER_MENTION', userMention: { user: { name: STEPH, displayName: 'Steph', type: 'HUMAN' } } },
      { type: 'USER_MENTION', userMention: { user: { name: NATALIE, displayName: 'Natalie', type: 'HUMAN' } } },
      { type: 'USER_MENTION', userMention: { user: { name: STEPH, displayName: 'Steph', type: 'HUMAN' } } },
      { type: 'RICH_LINK', richLinkMetadata: { driveLinkData: { driveDataRef: { driveFileId: 'DOC_FROM_CHIP_1' } } } }
    ],
    attachment: [{ source: 'DRIVE_FILE', driveDataRef: { driveFileId: 'DOC_FROM_ATTACH' } }]
  };

  test('mentions exclude apps and repeats; Drive files come from text, chips and attachments', () => {
    const evt = normalizeChatEvent({ chat: { messagePayload: { message, space: { name: SPACE } } } });
    expect(evt.mentions).toEqual([
      { chatUserId: STEPH, displayName: 'Steph' },
      { chatUserId: NATALIE, displayName: 'Natalie' }
    ]);
    expect(evt.driveFiles.map(f => f.fileId).sort()).toEqual(['DOC_FROM_ATTACH', 'DOC_FROM_CHIP_1', 'DOC_FROM_TEXT_1']);
    expect(evt.messageName).toBe(`${SPACE}/messages/M1`);
    expect(evt.senderDisplayName).toBe(NAMES[OWNER]);
  });

  test('@all is flagged, never listed as a person; dialog events carry their type and form values', () => {
    const withAll = { ...message, annotations: [
      ...message.annotations,
      { type: 'USER_MENTION', userMention: { user: { name: 'users/all', displayName: 'all', type: 'HUMAN' } } }
    ] };
    const evt = normalizeChatEvent({ chat: { messagePayload: { message: withAll, space: { name: SPACE } } } });
    expect(evt.mentionsAll).toBe(true);
    expect(evt.mentions.map(m => m.chatUserId)).not.toContain('users/all');

    const body = buttonBody({ id: 'x', message_name: 'm', thread_name: 't' }, 'track.decision');
    body.chat.buttonClickedPayload.isDialogEvent = true;
    body.chat.buttonClickedPayload.dialogEventType = 'SUBMIT_DIALOG';
    body.commonEventObject.formInputs = { decision: { stringInputs: { value: ['Use B'] } }, empty: {} };
    expect(normalizeChatEvent(body)).toMatchObject({
      isDialogEvent: true, dialogEventType: 'SUBMIT_DIALOG', formInputs: { decision: ['Use B'], empty: [] }
    });
  });

  test('a press carries the presser and the parameters, in map or list form', () => {
    const card = { id: 'x', message_name: 'm', thread_name: 't' };
    const asMap = normalizeChatEvent(buttonBody(card, 'review.done'));
    expect(asMap).toMatchObject({ actorChatId: STEPH, parameters: { cardId: 'x', action: 'review.done' } });

    const body = buttonBody(card, 'review.done');
    body.commonEventObject.parameters = [{ key: 'cardId', value: 'x' }, { key: 'from', value: 'digest' }];
    expect(normalizeChatEvent(body).parameters).toEqual({ cardId: 'x', from: 'digest' });
  });
});

// ============================================================================
// BUTTONS
// ============================================================================

describe('buttons', () => {
  test('a personal button changes only the presser’s own status', async () => {
    const card = await seedCard();
    await handleCardClick(clickEvt(card, 'review.reviewing', STEPH));
    expect(await statuses(card.id)).toEqual({ [STEPH]: 'reviewing', [NATALIE]: 'not_started' });

    await handleCardClick(clickEvt(card, 'review.done', NATALIE));
    expect(await statuses(card.id)).toEqual({ [STEPH]: 'reviewing', [NATALIE]: 'done' });
  });

  test('someone not on the card takes the review by pressing I’m reviewing', async () => {
    const card = await seedCard();
    const response = await handleCardClick(clickEvt(card, 'review.reviewing', OUTSIDER));

    expect(await statuses(card.id)).toEqual({ [STEPH]: 'not_started', [NATALIE]: 'not_started', [OUTSIDER]: 'reviewing' });
    expect(fakes.db.clicks.map(c => [c.actor_chat_id, c.result])).toEqual([[OUTSIDER, 'changed']]);
    const text = cardText(updatedCard(response));
    expect(text).toContain(`${NAMES[OUTSIDER]} · Reviewing`);
    expect(text).toContain(`Last update: ${NAMES[OUTSIDER]} started reviewing`);
    expect(logged()).toContain('result: changed (claimed), response: card');
  });

  test('Mark my review done by someone not on the card adds them and marks them done — the requester too', async () => {
    const card = await seedCard();
    await handleCardClick(clickEvt(card, 'review.done', OUTSIDER));
    await handleCardClick(clickEvt(card, 'review.done', OWNER));
    expect(await statuses(card.id)).toEqual({
      [OWNER]: 'done', [STEPH]: 'not_started', [NATALIE]: 'not_started', [OUTSIDER]: 'done'
    });
    expect((await fakes.store.getCard(card.id)).owner_chat_id).toBe(OWNER);   // still the requester
  });

  test('the listener account cannot take a review, and is told so privately', async () => {
    process.env.CHAT_LISTENER_USER_EMAIL = 'listener.sentinel@granted.ca';
    try {
      const card = await seedCard();
      await fakes.store.upsertPerson({ chatUserId: OUTSIDER, email: 'Listener.Sentinel@granted.ca' });
      await handleCardClick(clickEvt(card, 'review.reviewing', OUTSIDER));
      await whenCardsIdle();

      expect(await statuses(card.id)).toEqual({ [STEPH]: 'not_started', [NATALIE]: 'not_started' });
      expect(fakes.db.clicks.at(-1).result).toBe('listener_account');
      expect(fakes.chat.posts).toEqual([expect.objectContaining({
        spaceName: SPACE, threadName: card.thread_name, privateTo: OUTSIDER, text: 'This account can’t take a review.'
      })]);
    } finally {
      delete process.env.CHAT_LISTENER_USER_EMAIL;
    }
  });

  test('a press that cannot apply is answered privately, never silently', async () => {
    const card = await seedCard();
    const response = await handleCardClick(clickEvt(card, 'card.close', STEPH));
    await whenCardsIdle();

    expect((await fakes.store.getCard(card.id)).status).toBe('open');
    expect(updatedCard(response)[0].cardId).toBe(`tracked-${card.id}`);   // still a valid answer
    expect(fakes.chat.posts).toEqual([expect.objectContaining({
      spaceName: SPACE, threadName: card.thread_name, privateTo: STEPH, text: 'Only the requester can close this card.'
    })]);
    expect(logged()).toContain('Private reply to a press — delivered, private: true');
  });

  test('in a DM the reply is a plain message — the DM is already private', async () => {
    const card = await seedCard();
    await fakes.store.updateCard(card.id, { data: { ...card.data, surface: 'chat_dm' } });
    await fakes.store.closeCard(card.id, 'closed_by_owner');
    await handleCardClick(clickEvt(card, 'review.done', OWNER));
    await whenCardsIdle();
    expect(fakes.chat.posts).toEqual([expect.objectContaining({ privateTo: null, text: 'This card is closed, so nothing changed.' })]);
  });

  test('every press is logged and the card shows the latest', async () => {
    const card = await seedCard();
    const t0 = new Date('2026-09-17T16:00:00Z');
    await handleCardClick(clickEvt(card, 'review.reviewing', STEPH), t0);
    const response = await handleCardClick(clickEvt(card, 'review.reviewing', NATALIE), new Date(t0.getTime() + 60_000));

    expect(fakes.db.clicks).toHaveLength(2);
    // ICU may put a narrow no-break space before AM/PM.
    const text = cardText(updatedCard(response)).replace(/[\u202f\u00a0]/g, ' ');
    expect(text).toContain(`Last update: ${NAMES[NATALIE]} started reviewing · Sep 17, 9:01 AM PDT`);
  });

  test('the answer replaces the pressed card in place; nothing is posted and nobody is pinged', async () => {
    const card = await seedCard();
    fakes.chat.dms.set(OWNER, 'spaces/DM-OWNER');
    fakes.chat.dms.set(STEPH, 'spaces/DM-STEPH');
    fakes.chat.dms.set(NATALIE, 'spaces/DM-NATALIE');

    const response = await handleCardClick(clickEvt(card, 'review.reviewing', STEPH));
    await handleCardClick(clickEvt(card, 'review.done', STEPH));
    await whenCardsIdle();

    expect(Object.keys(response)).toEqual(['hostAppDataAction']);
    expect(updatedCard(response)[0].cardId).toBe(`tracked-${card.id}`);
    expect(fakes.chat.posts).toHaveLength(0);
    // The same card is also patched through the API, in case Chat drops the answer.
    expect(new Set(fakes.chat.patches.map(p => p.messageName))).toEqual(new Set([card.message_name]));
  });

  test('whatever a card type writes, no Markdown leaves in a tracked card', () => {
    const { trackedCard, paragraph, decorated, button } = render;
    const cardsV2 = trackedCard({
      card: { id: 'c1', status: 'open' },
      title: '**Bold** title',
      subtitle: '`code` subtitle',
      sections: [{
        header: '## **Head**',
        widgets: [
          paragraph('**b** and *i* and [link](https://example.com/x)'),
          decorated({ text: '- **item**', top: '*top*', bottom: '**bottom**' })
        ]
      }],
      buttons: [button('**Go**', { cardId: 'c1', action: 'a' })]
    });
    for (const str of allCardStrings(cardsV2)) {
      expect(str).not.toMatch(/\*|`|\]\(|^#|^- /);
    }
    const [{ card }] = cardsV2;
    expect(card.header).toEqual({ title: 'Bold title', subtitle: 'code subtitle' });
    expect(card.sections[0].header).toBe('<b>Head</b>');
    expect(card.sections[0].widgets[0].textParagraph.text).toBe('<b>b</b> and <i>i</i> and link');
    expect(card.sections[0].widgets[1].decoratedText).toMatchObject({ text: '<b>item</b>', topLabel: 'top', bottomLabel: 'bottom' });
    expect(cardButtons(cardsV2)[0].text).toBe('Go');
  });

  test('every button calls back to the Chat endpoint with the card and action', async () => {
    const card = await seedCard();
    const buttons = cardButtons(await renderCard(card));
    expect(buttons.map(b => [b.text, b.disabled])).toEqual([
      ['I’m reviewing', false], ['Mark my review done', false], ['Draft client follow-up', false]
    ]);
    for (const b of buttons) {
      expect(b.fn).toBe(ENDPOINT);
      expect(b.params.cardId).toBe(card.id);
    }
  });

  test('a press is answered before Drive is read; the card is then refreshed and patched', async () => {
    const card = await seedCard({ openComments: 3 });
    fakes.drive.docs.set(DOC, { name: 'Application draft v2', openComments: 5 });
    let release;
    fakes.drive.hold = new Promise(resolve => { release = resolve; });   // Drive is slow

    const response = await handleCardClick(clickEvt(card, 'review.reviewing', STEPH));

    // Answered from what is stored, with the press applied, while Drive is still busy.
    const text = cardText(updatedCard(response));
    expect(text).toContain(`${NAMES[STEPH]} · Reviewing`);
    expect(text).toContain('Application draft · 3 comments');
    expect(fakes.chat.patches).toHaveLength(0);

    release();
    await whenCardsIdle();
    const patched = cardText(fakes.chat.patches.at(-1).cardsV2);
    expect(patched).toContain('Application draft v2 · 5 comments');
    expect(fakes.drive.calls.at(-1)).toEqual({ fileId: DOC, userEmail: OWNER_EMAIL });
  });

  test('a closed card is frozen: no buttons, and a press changes nothing', async () => {
    const card = await seedCard();
    await fakes.store.closeCard(card.id, 'closed_by_owner');

    const response = await handleCardClick(clickEvt(card, 'review.done', STEPH));

    expect(await statuses(card.id)).toEqual({ [STEPH]: 'not_started', [NATALIE]: 'not_started' });
    const cards = updatedCard(response);
    expect(cards[0].card.header.subtitle).toContain('Closed');
    expect(cardButtons(cards)).toEqual([]);
    expect(fakes.db.clicks.at(-1).result).toBe('closed');
    expect(fakes.drive.calls).toHaveLength(0);   // closed cards are not refreshed
  });

  test('only the owner can keep or close a card', async () => {
    const card = await seedCard();
    await handleCardClick(clickEvt(card, 'card.close', STEPH));
    expect((await fakes.store.getCard(card.id)).status).toBe('open');
    expect(fakes.db.clicks.at(-1).result).toBe('not_the_owner');
    await handleCardClick(clickEvt(card, 'card.keep', STEPH, { from: 'digest' }));
    await whenCardsIdle();
    expect(fakes.chat.posts.map(p => p.text)).toEqual(['Only the requester can close this card.']);   // the digest answers the other

    await handleCardClick(clickEvt(card, 'card.close', OWNER));
    const closed = await fakes.store.getCard(card.id);
    expect(closed).toMatchObject({ status: 'closed', closed_reason: 'closed_by_owner' });
  });

  test('mute from the digest mutes only the presser, answers with the digest, and leaves the card alone', async () => {
    const card = await seedCard();
    const response = await handleCardClick(clickEvt(card, 'card.mute', STEPH, { from: 'digest' }));
    await whenCardsIdle();

    const muted = (await fakes.store.getParticipants(card.id)).filter(p => p.muted).map(p => p.chat_user_id);
    expect(muted).toEqual([STEPH]);
    const cards = updatedCard(response);
    expect(cards[0].cardId).toMatch(/^digest-\d{4}-\d{2}-\d{2}$/);
    expect(cardText(cards)).toContain('Muted: ');
    expect(fakes.chat.patches).toHaveLength(0);
    // A mute is private: the shared card never shows it.
    expect(cardText(await renderCard(await fakes.store.getCard(card.id)))).not.toContain('muted');
  });

  test('a press on a digest item updates the digest and patches the card in the background', async () => {
    const card = await seedCard();
    await handleCardClick(clickEvt(card, 'card.close', OWNER, { from: 'digest' }));
    await whenCardsIdle();
    expect(fakes.chat.patches.map(p => p.messageName)).toEqual([card.message_name]);
    expect(cardButtons(fakes.chat.patches[0].cardsV2)).toEqual([]);
  });

  test('a press on a message whose name differs from the stored one is still answered with the card', async () => {
    const card = await seedCard();
    const response = await handleCardClick({ ...clickEvt(card, 'review.reviewing'), messageName: `${SPACE}/messages/other` });
    await whenCardsIdle();
    expect(updatedCard(response)[0].cardId).toBe(`tracked-${card.id}`);
    expect(new Set(fakes.chat.patches.map(p => p.messageName))).toEqual(new Set([card.message_name]));
    expect(logged()).toContain('different message than the stored card');
  });

  test('an unexpected failure mid-press still answers with the card', async () => {
    const card = await seedCard();
    fakes.db.failOn = 'logClick';
    const response = await handleCardClick(clickEvt(card, 'review.reviewing', STEPH));
    expect(updatedCard(response)[0].cardId).toBe(`tracked-${card.id}`);
    expect(logged()).toContain('Tracked card press failed — code: XX000');
  });

  test('an unknown action on a real card is ignored with an empty answer', async () => {
    const card = await seedCard();
    expect(await handleCardClick(clickEvt(card, 'bogus.action'))).toEqual({});
    expect(logged()).toContain('reason: unknown_action');
  });

  test('a failed patch is logged by status code only', async () => {
    const card = await seedCard();
    fakes.chat.failPatch = Object.assign(new Error(`cannot update ${TITLE}`), { response: { status: 403 } });
    await handleCardClick({ ...clickEvt(card, 'review.reviewing'), messageName: `${SPACE}/messages/other` });
    await whenCardsIdle();
    expect(logged()).toContain('Tracked card update failed — code: 403');
  });
});

// ============================================================================
// LIFECYCLE
// ============================================================================

describe('lifecycle', () => {
  test('30 idle days make a card stale; 14 more close and freeze it', async () => {
    const card = await seedCard();
    const start = Date.now();

    await lifecycle.applyLifecycle(new Date(start + 29 * DAY));
    expect((await fakes.store.getCard(card.id)).status).toBe('open');

    await lifecycle.applyLifecycle(new Date(start + 31 * DAY));
    expect((await fakes.store.getCard(card.id)).status).toBe('stale');
    const stalePatch = fakes.chat.patches.at(-1).cardsV2;
    expect(stalePatch[0].card.header.subtitle).toContain('Inactive');
    expect(cardButtons(stalePatch).length).toBeGreaterThan(0);

    await lifecycle.applyLifecycle(new Date(start + (31 + 13) * DAY));
    expect((await fakes.store.getCard(card.id)).status).toBe('stale');

    await lifecycle.applyLifecycle(new Date(start + (31 + 15) * DAY));
    expect(await fakes.store.getCard(card.id)).toMatchObject({ status: 'closed', closed_reason: 'auto_stale' });
    const closedPatch = fakes.chat.patches.at(-1).cardsV2;
    expect(closedPatch[0].card.header.subtitle).toContain('Closed (inactive)');
    expect(cardButtons(closedPatch)).toEqual([]);
    expect(fakes.chat.posts).toHaveLength(0);
  });

  test('Keep in the digest reopens a stale card and restarts its clock', async () => {
    const card = await seedCard();
    const start = Date.now();
    await lifecycle.applyLifecycle(new Date(start + 31 * DAY));

    const keptAt = new Date(start + 32 * DAY);
    await handleCardClick(clickEvt(card, 'card.keep', OWNER, { from: 'digest' }), keptAt);
    expect(await fakes.store.getCard(card.id)).toMatchObject({ status: 'open', stale_since: null, last_activity_at: keptAt });

    await lifecycle.applyLifecycle(new Date(start + 50 * DAY));
    expect((await fakes.store.getCard(card.id)).status).toBe('open');
  });

  test('any real change on a stale card reopens it; a mute does not', async () => {
    const card = await seedCard();
    const start = Date.now();
    await lifecycle.applyLifecycle(new Date(start + 31 * DAY));

    await handleCardClick(clickEvt(card, 'card.mute', NATALIE), new Date(start + 32 * DAY));
    expect((await fakes.store.getCard(card.id)).status).toBe('stale');

    await handleCardClick(clickEvt(card, 'review.reviewing', STEPH), new Date(start + 32 * DAY));
    expect((await fakes.store.getCard(card.id)).status).toBe('open');
  });

  test('the daily pass refreshes live cards and patches only the ones that changed', async () => {
    const changed = await seedCard({ openComments: 3 });
    fakes.drive.docs.set('DOC_BBBBBBBBBBBB', { name: 'Budget', openComments: 1 });
    const same = await seedCard({ openComments: 3 });
    await fakes.store.updateCard(same.id, {
      data: { ...same.data, docIds: ['DOC_BBBBBBBBBBBB'], docs: [{ fileId: 'DOC_BBBBBBBBBBBB', name: 'Budget', openComments: 1, readable: true }] }
    });
    const closed = await seedCard();
    await fakes.store.closeCard(closed.id, 'closed_by_owner');
    fakes.drive.docs.set(DOC, { name: 'Application draft', openComments: 0 });
    const before = (await fakes.store.getCard(changed.id)).last_activity_at;

    const result = await lifecycle.runDailyCardPass(new Date());

    expect(result.refreshed).toEqual({ cards: 2, changed: 1, failed: 0 });
    expect(fakes.chat.patches.map(p => p.messageName)).toEqual([changed.message_name]);
    expect(cardText(fakes.chat.patches[0].cardsV2)).toContain('0 open comments');
    expect((await fakes.store.getCard(changed.id)).last_activity_at).toEqual(before);   // refresh is not activity
    expect(logged()).toMatch(/daily pass — refreshed: 2, changed: 1, failed: 0, now stale: 0, auto-closed: 0/);
  });

  test('an unreadable Doc is shown as such, not as zero comments', async () => {
    const card = await seedCard({ openComments: 3 });
    fakes.drive.docs.set(DOC, { name: 'Application draft', readable: false });
    await lifecycle.refreshLiveCards();
    expect(cardText(fakes.chat.patches.at(-1).cardsV2)).toContain('Application draft · can’t read comments');
    expect((await fakes.store.getCard(card.id)).data.docs[0].openComments).toBe(3);
  });

  test('an offer nobody answered closes after 30 days', async () => {
    const offer = await fakes.store.insertCard({
      cardType: 'review', status: 'offered', spaceName: SPACE, threadName: `${SPACE}/threads/OFFER`,
      conversationId: CONV, ownerChatId: OWNER, ownerUserId: 1, title: TITLE, data: {}
    });
    await fakes.store.updateCard(offer.id, { messageName: `${SPACE}/messages/offer` });

    await lifecycle.applyLifecycle(new Date(Date.now() + 29 * DAY));
    expect((await fakes.store.getCard(offer.id)).status).toBe('offered');

    const result = await lifecycle.applyLifecycle(new Date(Date.now() + 31 * DAY));
    expect(result.offersClosed).toBe(1);
    expect(await fakes.store.getCard(offer.id)).toMatchObject({ status: 'closed', closed_reason: 'offer_expired' });
    const patched = fakes.chat.patches.at(-1).cardsV2;
    expect(cardButtons(patched)).toEqual([]);
    expect(cardText(patched)).toContain('Not tracked.');
    expect(cardText(patched)).not.toContain('reviews done');
  });
});

// ============================================================================
// NOTIFICATIONS AND THE DIGEST
// ============================================================================

describe('immediate notifications', () => {
  test('only the immediate kinds may DM anyone', async () => {
    const card = await seedCard();
    expect(notify.IMMEDIATE_KINDS).toEqual(['assigned', 'due_today', 'confirmation', 'due_summary', 'watched_grant']);
    await expect(notify.notifyImmediate('status_changed', { card, chatUserId: STEPH, text: 'x' }))
      .rejects.toThrow(/not an immediate notification/);
    expect(fakes.chat.posts).toHaveLength(0);
  });

  test('a muted participant is not DMed; someone Oracle has no DM with is skipped', async () => {
    const card = await seedCard();
    fakes.chat.dms.set(STEPH, 'spaces/DM-STEPH');
    await fakes.store.setMuted(card.id, STEPH, true);

    await expect(notify.notifyImmediate('assigned', { card, chatUserId: STEPH, text: TITLE }))
      .resolves.toEqual({ delivered: false, reason: 'muted' });
    await expect(notify.notifyImmediate('assigned', { card, chatUserId: NATALIE, text: TITLE }))
      .resolves.toEqual({ delivered: false, reason: 'no_dm' });
    expect(fakes.chat.posts).toHaveLength(0);
    expect(logged()).toContain('kind: assigned, delivered: false, reason: no_dm');
  });
});

describe('the daily digest', () => {
  // 12:05 UTC is 08:05 in Toronto; 15:05 UTC is 08:05 in Vancouver (September).
  const TORONTO_8AM = new Date('2026-09-18T12:05:00Z');
  const VANCOUVER_8AM = new Date('2026-09-18T15:05:00Z');

  beforeEach(() => {
    fakes.calendar.zones.set(1, 'America/Toronto');   // the owner's Hub calendar
    fakes.chat.dms.set(OWNER, 'spaces/DM-OWNER');
    fakes.chat.dms.set(STEPH, 'spaces/DM-STEPH');
    fakes.chat.dms.set(NATALIE, 'spaces/DM-NATALIE');
  });

  const postsTo = (space) => fakes.chat.posts.filter(p => p.spaceName === space);

  test('each person gets it at 08:00 in their own time zone', async () => {
    await seedCard();

    await notify.sendDueDigests(TORONTO_8AM);
    expect(fakes.chat.posts.map(p => p.spaceName)).toEqual(['spaces/DM-OWNER']);

    await notify.sendDueDigests(VANCOUVER_8AM);   // reviewers have no Hub calendar → default zone
    expect(fakes.chat.posts.map(p => p.spaceName).sort())
      .toEqual(['spaces/DM-NATALIE', 'spaces/DM-OWNER', 'spaces/DM-STEPH']);
    expect(fakes.calendar.calls).toEqual([1]);   // looked up once, then cached
  });

  test('at most one per person per local day', async () => {
    await seedCard();
    await notify.sendDueDigests(TORONTO_8AM);
    const counts = await notify.sendDueDigests(new Date(TORONTO_8AM.getTime() + 30 * 60_000));
    expect(postsTo('spaces/DM-OWNER')).toHaveLength(1);
    expect(counts.alreadySent).toBe(1);

    await notify.sendDueDigests(new Date(TORONTO_8AM.getTime() + DAY));
    expect(postsTo('spaces/DM-OWNER')).toHaveLength(2);
  });

  test('it groups what waits on you, what you asked for, and what went quiet', async () => {
    const waiting = await seedCard();
    const quiet = await seedCard();
    await lifecycle.applyLifecycle(new Date(Date.now() + 31 * DAY));
    await fakes.store.touchActivity(waiting.id);                     // keep the first one open
    await fakes.store.updateCard(waiting.id, { status: 'open', staleSince: null });

    await notify.sendDueDigests(TORONTO_8AM);
    const owner = postsTo('spaces/DM-OWNER')[0].cardsV2;
    const ownerSections = owner[0].card.sections.map(s => s.header);
    expect(ownerSections).toEqual(['Your open requests', 'Gone quiet']);
    expect(cardText(owner)).toContain('0/2 reviews done · 3 open comments');
    expect(cardButtons(owner).map(b => [b.text, b.params.action, b.params.from, b.params.cardId])).toEqual([
      ['Mute', 'card.mute', 'digest', waiting.id],
      ['Keep', 'card.keep', 'digest', quiet.id],
      ['Close', 'card.close', 'digest', quiet.id]
    ]);

    await notify.sendDueDigests(VANCOUVER_8AM);
    const steph = postsTo('spaces/DM-STEPH')[0].cardsV2;
    expect(steph[0].card.sections.map(s => s.header)).toEqual(['Waiting on you']);
    expect(cardText(steph)).toContain('Your status: Not started');
    expect(cardText(steph)).toContain(`https://chat.google.com/room/AAA/`);
  });

  test('muted items are left out, and an empty digest is not sent', async () => {
    const card = await seedCard();
    await fakes.store.setMuted(card.id, STEPH, true);
    await fakes.store.setReviewerStatus(card.id, NATALIE, 'done');

    const counts = await notify.sendDueDigests(VANCOUVER_8AM);
    expect(postsTo('spaces/DM-STEPH')).toHaveLength(0);     // muted
    expect(postsTo('spaces/DM-NATALIE')).toHaveLength(0);   // nothing waiting on her
    expect(counts.empty).toBe(1);
  });

  test('someone Oracle has no DM with is skipped without failing the run', async () => {
    await seedCard();
    fakes.chat.dms.delete(STEPH);
    const counts = await notify.sendDueDigests(VANCOUVER_8AM);
    expect(counts).toMatchObject({ noDm: 1, failed: 0 });
    expect(postsTo('spaces/DM-NATALIE')).toHaveLength(1);
  });

  test('status changes and refreshes post nothing — they wait for the digest', async () => {
    const card = await seedCard();
    await handleCardClick(clickEvt(card, 'review.done', STEPH));
    await lifecycle.runDailyCardPass(new Date());
    expect(fakes.chat.posts).toHaveLength(0);
  });
});

// ============================================================================
// JOBS
// ============================================================================

describe('scheduled jobs', () => {
  const fakeCron = () => {
    const jobs = [];
    return { jobs, schedule: (expr, fn, opts) => jobs.push({ expr, fn, opts }) };
  };

  test('hourly digests and a daily pass, in UTC, never overlapping', () => {
    const cron = fakeCron();
    expect(startTrackedCards(cron)).toBe(true);
    expect(cron.jobs.map(j => [j.expr, j.opts])).toEqual([
      ['5 * * * *', { name: 'tracked-cards-digest', timezone: 'UTC', noOverlap: true }],
      ['0 13 * * *', { name: 'tracked-cards-daily', timezone: 'UTC', noOverlap: true }]
    ]);
  });

  test('TRACKED_CARDS_DISABLED switches both off', () => {
    process.env.TRACKED_CARDS_DISABLED = 'true';
    try {
      const cron = fakeCron();
      expect(startTrackedCards(cron)).toBe(false);
      expect(cron.jobs).toHaveLength(0);
    } finally {
      delete process.env.TRACKED_CARDS_DISABLED;
    }
  });

  test('the scheduled jobs run the real passes', async () => {
    await seedCard();
    const cron = fakeCron();
    startTrackedCards(cron);
    await cron.jobs[0].fn();
    await cron.jobs[1].fn();
    expect(logged()).toMatch(/Tracked card digests — people: 3/);
    expect(logged()).toMatch(/Tracked cards daily pass — refreshed: 1/);
  });
});
