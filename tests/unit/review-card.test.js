/**
 * The review card — first tracked card
 *
 * Messages go through the real Chat handler; a fake model calls track_review the
 * way the executor does (input from the model, context from the verified event).
 * Buttons go through the real click handler. The database, Chat API, Drive,
 * HubSpot and the confirmation gate are the in-memory fakes in
 * helpers/tracked-cards-fakes.js — the gate fake runs a stored note through
 * the fake HubSpot, so "nothing is written until someone confirms" is checked
 * against the only write path there is.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/review-card.test.js
 */

import { jest } from '@jest/globals';
import { createTrackedCardFakes, cardText, cardButtons, allCardStrings } from './helpers/tracked-cards-fakes.js';

const ENDPOINT = 'https://hub.example/api/chat/google';
const ISSUER = 'addon@example.iam.gserviceaccount.com';
process.env.GOOGLE_CHAT_AUDIENCE = ENDPOINT;
process.env.GOOGLE_CHAT_ISSUER_EMAIL = ISSUER;
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
process.env.PUBLIC_URL = 'https://hub.example';
delete process.env.DEFAULT_TIMEZONE;
const LISTENER_EMAIL = 'oracle-listener@granted.ca';
process.env.CHAT_LISTENER_USER_EMAIL = LISTENER_EMAIL;

const fakes = createTrackedCardFakes();

// --- modules replaced ------------------------------------------------------
const textReplies = [];   // text Oracle posted through the Chat handler (not cards)
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
    chat: () => ({
      spaces: { messages: { create: async (req) => { textReplies.push(req.requestBody.text); return { data: {} }; } } }
    })
  }
}));
// Only the Chat handler's sender lookup reaches the database directly.
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (sql, params = []) => {
    if (!/FROM users/.test(sql)) return { rows: [] };
    const user = fakes.db.users.find(u => u.is_active && u.email.toLowerCase() === String(params[0]).toLowerCase());
    return { rows: user ? [user] : [] };
  },
  getPool: () => null,
  transaction: async () => null
}));
jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: async () => null, getDocsClient: async () => null, getDriveClient: async () => null
}));
// "yes" handling: off unless a test turns it on (then it runs the fake gate).
let confirmationImpl = null;
jest.unstable_mockModule('../../src/api/confirmation.js', () => ({
  tryHandleConfirmation: async (args) => (confirmationImpl ? confirmationImpl(args) : null),
  currentPendingId: async () => null,
  proposalNotice: async () => null
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

const { handleGoogleChatEvent } = await import('../../src/api/chat-google.js');
const { handleCardClick, whenCardsIdle } = await import('../../src/cards/actions.js');
const { takeCardReply } = await import('../../src/cards/registry.js');
const { renderCard } = await import('../../src/cards/update.js');
const { refreshLiveCards, applyLifecycle } = await import('../../src/cards/lifecycle.js');
const { sendDueDigests } = await import('../../src/cards/notify.js');
const { trackReview, REVIEW_INTENT, programSource } = await import('../../src/cards/review-card.js');

// --- people and places -------------------------------------------------------
// Sentinels: none of these may ever appear in a log line from card code.
const OWNER = 'users/100';
const STEPH = 'users/201';
const NATALIE = 'users/202';
const LISTENER = 'users/300';      // the Chat-copy listener: a Workspace user, not a teammate
const LOOKALIKE = 'users/301';     // shown as "Oracle", email unknown
const PRIYA = 'users/302';         // a real person whose email is unknown
const NAMES = {
  [OWNER]: 'Olivia Sentinel', [STEPH]: 'Steph Sentinel', [NATALIE]: 'Natalie Sentinel',
  [LISTENER]: 'Oracle', [LOOKALIKE]: 'Oracle', [PRIYA]: 'Priya Sentinel'
};
const EMAILS = { [OWNER]: 'olivia.sentinel@granted.ca', [STEPH]: 'steph.sentinel@granted.ca', [NATALIE]: 'natalie.sentinel@granted.ca' };

const SPACE = 'spaces/AAA';
const THREAD = `${SPACE}/threads/T1`;
const DIRECT_CONV = '44444444-4444-4444-8444-444444444444';
const DAY = 24 * 60 * 60 * 1000;
const DOC1 = 'DOC1_AAAAAAAAAA';
const DOC2 = 'DOC2_BBBBBBBBBB';
const docUrl = (id) => `https://docs.google.com/document/d/${id}/edit`;

const TITLE = 'Acme Sentinel Ltd · RTRI';
const ISSUES = ['Sentinel check: tariff exposure is not quantified', 'Budget omits the 2026 hiring costs'];
const RTRI_INPUT = {
  client_name: 'Acme Sentinel Ltd',
  program: 'RTRI',
  precheck_issues: ISSUES,
  missing_info: ['2025 financial statements', 'Proof of tariff impact']
};
const DRAFT = 'Subject: Sentinel follow-up\n\nHi, we still need your 2025 financial statements.';

let toolInput;          // what the fake model passes to track_review this turn
let toolResults;        // what track_review returned
let msgSeq = 0;

// --- helpers -------------------------------------------------------------------
const logLines = () => [console.log, console.warn, console.error]
  .flatMap(fn => fn.mock.calls)
  .map(args => args.map(a => (a instanceof Error ? a.message : String(a))).join(' '));
const logged = () => logLines().join('\n');

const oracle = { type: 'USER_MENTION', userMention: { user: { name: 'users/app', displayName: 'Oracle', type: 'BOT' } } };
const mention = (id) => ({ type: 'USER_MENTION', userMention: { user: { name: id, displayName: NAMES[id], type: 'HUMAN' } } });

function messageBody({ text, sender = OWNER, mentions = [], thread = THREAD }) {
  return {
    chat: {
      messagePayload: {
        message: {
          name: `${SPACE}/messages/in${++msgSeq}`,
          text: `@Oracle ${text}`,
          argumentText: text,
          sender: { name: sender, displayName: NAMES[sender], email: EMAILS[sender], type: 'HUMAN' },
          thread: { name: thread },
          annotations: [oracle, ...mentions.map(mention)]
        },
        space: { name: SPACE, displayName: 'Grants team', type: 'ROOM' }
      }
    }
  };
}

/** Send a message and wait until Oracle's background turn and any card work finish. */
async function say(opts) {
  const ends = () => logLines().filter(l => l.includes('Chat background task END')).length;
  const before = ends();
  const res = { status: () => res, json: () => res };
  await handleGoogleChatEvent({ headers: { authorization: 'Bearer token' }, body: messageBody(opts) }, res);
  for (let i = 0; i < 1000 && ends() === before; i++) await new Promise(r => setImmediate(r));
  if (ends() === before) throw new Error('Oracle turn did not finish');
  await whenCardsIdle();
  return toolResults.at(-1);
}

const reviewRequest = (extra = {}) => ({
  text: `can you review the Acme RTRI app? ${docUrl(DOC1)} ${docUrl(DOC2)}`,
  mentions: [STEPH, NATALIE],
  ...extra
});

/** track_review called directly, with the context the executor would pass. */
const track = (input = RTRI_INPUT, cc = {}) => trackReview(input, {
  userId: 1,
  conversationId: DIRECT_CONV,
  chatContext: {
    surface: 'chat_space', spaceName: SPACE, threadName: THREAD, messageName: `${SPACE}/messages/direct`,
    senderChatId: OWNER, senderDisplayName: NAMES[OWNER],
    mentions: [STEPH, NATALIE].map(id => ({ chatUserId: id, displayName: NAMES[id] })),
    driveFiles: [{ fileId: DOC1 }, { fileId: DOC2 }],
    messageText: 'please review these',
    ...cc
  }
});

const press = (card, action, actor, extra = {}) => handleCardClick({
  actorChatId: actor, actorName: NAMES[actor], actorEmail: null,
  messageName: card.message_name, parameters: { cardId: card.id, action, ...extra }
});

const updated = (response) => response?.hostAppDataAction?.chatDataAction?.updateMessageAction?.message?.cardsV2;
const onlyCard = async () => {
  const cards = [...fakes.db.cards.values()];
  expect(cards).toHaveLength(1);
  return fakes.store.getCard(cards[0].id);
};
const cardPosts = () => fakes.chat.posts.filter(p => p.cardsV2);
const dmsTo = (space) => fakes.chat.posts.filter(p => p.spaceName === space);
const lastPatch = () => fakes.chat.patches.at(-1).cardsV2;
const buttonsOf = (cardsV2) => cardButtons(cardsV2).map(b => [b.text, b.disabled]);
const privateReplies = () => fakes.chat.posts.filter(p => p.privateTo).map(p => [p.privateTo, p.text]);
const reviewersOf = async (cardId) => (await fakes.store.getParticipants(cardId))
  .filter(p => p.role === 'reviewer').map(p => p.chat_user_id).sort();

beforeEach(() => {
  fakes.reset();
  textReplies.length = 0;
  confirmationImpl = null;
  toolInput = RTRI_INPUT;
  toolResults = [];

  // The requester and Steph have Hub accounts; Natalie does not.
  fakes.db.users.push(
    { id: 1, email: EMAILS[OWNER], name: NAMES[OWNER], chat_user_id: null, is_active: true, google_refresh_token: 'rt' },
    { id: 2, email: EMAILS[STEPH], name: NAMES[STEPH], chat_user_id: STEPH, is_active: true, google_refresh_token: 'rt' }
  );
  fakes.drive.docs.set(DOC1, { name: 'Acme RTRI application', openComments: 4 });
  fakes.drive.docs.set(DOC2, { name: 'Acme budget', openComments: 1 });
  fakes.chat.dms.set(OWNER, 'spaces/DM-OWNER');
  fakes.chat.dms.set(STEPH, 'spaces/DM-STEPH');
  fakes.directory.people.set(LISTENER, { email: LISTENER_EMAIL, name: 'Oracle' });
  fakes.hubspot.deals.push({ id: '555', name: 'Acme Sentinel Ltd - RTRI', companyName: 'Acme Sentinel Ltd', program: 'RTRI' });

  // The fake model: on a Chat turn it calls track_review and replies only when
  // the tool asks it to; without a Chat context it is drafting a follow-up.
  fakes.agent.impl = async (args) => {
    if (!args.chatContext) {
      return { success: true, response: { content: [{ type: 'text', text: DRAFT }] } };
    }
    const r = await trackReview(toolInput, {
      userId: args.userId, conversationId: args.conversationId, chatContext: args.chatContext
    });
    toolResults.push(r);
    const reply = r.card_posted || r.asked ? ''
      : r.needs_docs ? 'Which Docs should be reviewed?'
        : r.needs_reviewers ? 'Who should review this?'
          : 'This thread already has a review card.';
    return { success: true, response: { content: reply ? [{ type: 'text', text: reply }] : [] } };
  };

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await whenCardsIdle();
  takeCardReply(DIRECT_CONV);
  // The Chat handler's own "Accepted — user N (email)" line predates tracked
  // cards and is flagged separately; everything else must be free of titles,
  // names, pre-check text and emails.
  const output = logLines().filter(l => !l.startsWith('✅ Accepted')).join('\n');
  jest.restoreAllMocks();
  expect(output).not.toMatch(/Sentinel/);
  expect(output).not.toMatch(/@granted\.ca/);
});

// ============================================================================
// THE REQUEST
// ============================================================================

describe('an @mention asking for a review', () => {
  test('posts one review card in the thread, and the card is the whole reply', async () => {
    const result = await say(reviewRequest());

    expect(result).toMatchObject({ success: true, card_posted: true });
    expect(textReplies).toEqual([]);                       // no text alongside the card
    expect(logged()).toContain('Reply was a tracked card — no text posted');

    expect(cardPosts()).toHaveLength(1);
    const post = cardPosts()[0];
    expect(post).toMatchObject({ spaceName: SPACE, threadName: THREAD });

    const card = await onlyCard();
    expect(card).toMatchObject({
      status: 'open', message_name: post.name, owner_chat_id: OWNER, owner_user_id: 1,
      conversation_id: fakes.agent.calls[0].conversationId, title: TITLE
    });

    // Compact: header, status, one line per reviewer and Doc, collapsed extras.
    const { header, sections } = post.cardsV2[0].card;
    expect(header).toEqual({ title: 'Acme Sentinel Ltd · RTRI', subtitle: `Review · requested by ${NAMES[OWNER]}` });
    expect(sections.map(sec => sec.header ?? null))
      .toEqual([null, 'Reviewers', 'Documents', 'Pre-check · RTRI program facts · 2 issues', 'Missing client info', null]);
    const texts = (sec) => sec.widgets.map(w => w.textParagraph?.text);
    expect(texts(sections[0])).toEqual(['0 of 2 reviews done · 5 open comments']);
    expect(texts(sections[1])).toEqual([`${NAMES[NATALIE]} · Not started<br>${NAMES[STEPH]} · Not started`]);
    expect(texts(sections[2])).toEqual(['Acme RTRI application · 4 comments<br>Acme budget · 1 comment']);
    expect(sections[3]).toMatchObject({ collapsible: true, uncollapsibleWidgetsCount: 1 });
    expect(texts(sections[3])).toEqual(ISSUES.map(i => `• ${i}`));
    expect(sections[4]).toMatchObject({ collapsible: true, uncollapsibleWidgetsCount: 1 });
    expect(texts(sections[4])).toEqual(['2 items still needed', '• 2025 financial statements<br>• Proof of tariff impact']);
    expect(cardText(post.cardsV2)).not.toContain('docs.google.com');   // Doc names only, never links
    expect(buttonsOf(post.cardsV2)).toEqual([
      ['I’m reviewing', false], ['Mark my review done', false], ['Draft client follow-up', false]
    ]);

    // Comments were read as the requester; the requester's Chat id was learned.
    expect(fakes.drive.calls.map(c => c.userEmail)).toEqual([EMAILS[OWNER], EMAILS[OWNER]]);
    expect(fakes.db.users[0].chat_user_id).toBe(OWNER);
  });

  test('each reviewer is told once by DM — and only reviewers Oracle can DM', async () => {
    await say(reviewRequest());
    const card = await onlyCard();

    expect(dmsTo('spaces/DM-STEPH').map(p => p.text)).toEqual([
      `${NAMES[OWNER]} asked you to review ${TITLE}. https://chat.google.com/room/AAA/T1`
    ]);
    expect(dmsTo('spaces/DM-OWNER')).toEqual([]);
    const notified = (await fakes.store.getParticipants(card.id))
      .filter(p => p.assigned_notified_at).map(p => p.chat_user_id);
    expect(notified).toEqual([STEPH]);                     // Natalie has no DM with Oracle
    expect(logged()).toContain('kind: assigned, delivered: false, reason: no_dm');
  });

  test('asking again in the same thread does not make a second card', async () => {
    await say(reviewRequest());
    const result = await say(reviewRequest());

    expect(result).toMatchObject({ already_tracked: true });
    expect(cardPosts()).toHaveLength(1);
    expect(fakes.db.cards.size).toBe(1);
    expect(textReplies).toEqual(['This thread already has a review card.']);
  });

  test('two requests racing in one thread still make one card', async () => {
    const results = await Promise.all([track(), track()]);
    expect(results.filter(r => r.card_posted)).toHaveLength(1);
    expect(results.filter(r => r.already_tracked)).toHaveLength(1);
    expect(cardPosts()).toHaveLength(1);
    expect(fakes.db.cards.size).toBe(1);
  });

  test('reviewers, Docs, space and thread come from the event, never from the model', async () => {
    await track({
      ...RTRI_INPUT,
      reviewers: ['users/666'], doc_ids: ['EVILDOC_000000'],
      space_name: 'spaces/EVIL', thread_name: 'spaces/EVIL/threads/X', owner: 'users/666'
    }, { mentions: [{ chatUserId: STEPH, displayName: NAMES[STEPH] }], driveFiles: [{ fileId: DOC1 }] });

    const card = await onlyCard();
    expect(card).toMatchObject({ space_name: SPACE, thread_name: THREAD, owner_chat_id: OWNER });
    expect((await fakes.store.getParticipants(card.id)).map(p => p.chat_user_id)).toEqual([OWNER, STEPH]);
    expect(card.data.docIds).toEqual([DOC1]);
    expect(fakes.drive.calls.map(c => c.fileId)).toEqual([DOC1]);
  });

  test('the requester is never their own reviewer', async () => {
    await track(RTRI_INPUT, {
      mentions: [OWNER, STEPH].map(id => ({ chatUserId: id, displayName: NAMES[id] }))
    });
    const reviewers = (await fakes.store.getParticipants((await onlyCard()).id))
      .filter(p => p.role === 'reviewer').map(p => p.chat_user_id);
    expect(reviewers).toEqual([STEPH]);
  });

  test('a program with no source on file skips the pre-check and says so', async () => {
    await track({ ...RTRI_INPUT, program: 'CanExport SMEs' });
    const text = cardText(cardPosts()[0].cardsV2);
    expect(cardPosts()[0].cardsV2[0].card.header.title).toBe('Acme Sentinel Ltd · CanExport SMEs');
    expect(text).toContain('No program source on file — pre-check skipped.');
    expect(text).not.toContain(ISSUES[0]);
    expect(programSource('Regional Tariff Response Initiative')).toBe('rtri-tariff');
    expect(programSource('CanExport SMEs')).toBeNull();
  });

  test('a Doc Oracle cannot read is shown as unreadable, not as zero comments', async () => {
    await track(RTRI_INPUT, { driveFiles: [{ fileId: DOC1 }, { fileId: 'DOC_NOT_SHARED_1' }] });
    const text = cardText(cardPosts()[0].cardsV2);
    expect(text).toContain('Untitled document · can’t read comments');
    expect(logged()).toContain('unreadable docs: 1');
  });

  test('the listener account, Oracle and other apps are never reviewers', async () => {
    const result = await say(reviewRequest({ mentions: [LISTENER, LOOKALIKE, PRIYA, STEPH] }));
    expect(result).toMatchObject({ card_posted: true });
    expect(await reviewersOf((await onlyCard()).id)).toEqual([STEPH, PRIYA].sort());
    const text = cardText(cardPosts()[0].cardsV2);
    expect(text).toContain('0 of 2 reviews done');
    expect(text).not.toContain('Oracle ·');
  });

  test('with only the listener mentioned, Oracle asks "Who should review this?" and makes no card', async () => {
    const first = await say(reviewRequest({ mentions: [LISTENER] }));
    expect(first).toMatchObject({ needs_reviewers: true });
    expect(first.message).toContain('Ask exactly: "Who should review this?"');
    expect(textReplies).toEqual(['Who should review this?']);
    expect(cardPosts()).toEqual([]);
    expect((await onlyCard()).status).toBe('awaiting_docs');

    const second = await say({ text: 'Steph', mentions: [STEPH] });
    expect(second).toMatchObject({ card_posted: true });
    expect(await reviewersOf((await onlyCard()).id)).toEqual([STEPH]);
  });

  test('Markdown never reaches card text', async () => {
    fakes.drive.docs.set(DOC1, { name: '**Acme** `application` draft', openComments: 4 });
    await track({
      client_name: '**Acme** Sentinel Ltd',
      program: '`RTRI`',
      precheck_issues: [
        '**Budget:** omits *hiring* costs — see [PROGRAM_FACTS](https://example.com/facts)',
        '## Tariff exposure not quantified',
        '- Employee count missing'
      ],
      missing_info: ['**2025** financial statements', '`T4` slips', '* proof of tariff impact']
    }, { mentions: [{ chatUserId: STEPH, displayName: '**Steph** Sentinel' }] });

    const cardsV2 = cardPosts()[0].cardsV2;
    for (const str of allCardStrings(cardsV2)) {
      expect(str).not.toMatch(/\*\*|`|\]\(/);
      for (const line of str.split(/<br>|\n/)) expect(line).not.toMatch(/^\s*(#{1,6}\s|[-*+]\s)/);
    }
    const text = cardText(cardsV2);
    expect(cardsV2[0].card.header.title).toBe('Acme Sentinel Ltd · RTRI');
    expect(text).toContain('• Budget: omits hiring costs — see PROGRAM_FACTS');
    expect(text).toContain('• Tariff exposure not quantified');
    expect(text).toContain('Steph Sentinel · Not started');
    expect(text).toContain('Acme application draft · 4 comments');
    expect(text).toContain('• 2025 financial statements<br>• T4 slips<br>• proof of tariff impact');
  });

  test('Markdown the card writes itself becomes card HTML, and older prose pre-checks are cleaned too', async () => {
    await track();
    const card = await onlyCard();
    await fakes.store.updateCard(card.id, {
      data: { ...card.data, precheck: { source: 'rtri-tariff', text: '**Eligibility:** ✅ fine\n- **Budget** is *short*\n✅ Employer size OK' } }
    });
    const cardsV2 = await renderCard(await onlyCard());
    const pre = cardsV2[0].card.sections.find(sec => sec.header?.startsWith('Pre-check'));
    expect(pre.widgets.map(w => w.textParagraph.text)).toEqual(['• Eligibility: fine', '• Budget is short']);
    expect(allCardStrings(cardsV2).join(' ')).not.toMatch(/[✅*]/u);
  });

  test('the pre-check keeps at most three short issues and never a check mark', async () => {
    await track({
      ...RTRI_INPUT,
      precheck_issues: [
        '✅ Employee count fits the limit',
        '✔️ Located in BC',
        'Tariff exposure not quantified ✅',
        'x'.repeat(150),
        'Budget omits hiring costs',
        'A fourth real issue'
      ]
    });
    const pre = cardPosts()[0].cardsV2[0].card.sections.find(sec => sec.header?.startsWith('Pre-check'));
    const bullets = pre.widgets.map(w => w.textParagraph.text);
    expect(pre.header).toBe('Pre-check · RTRI program facts · 3 issues');
    expect(pre).toMatchObject({ collapsible: true, uncollapsibleWidgetsCount: 1 });
    expect(bullets).toEqual(['• Tariff exposure not quantified', `• ${'x'.repeat(99)}…`, '• Budget omits hiring costs']);
    for (const b of bullets) expect(b.length - 2).toBeLessThanOrEqual(100);
    expect(allCardStrings(cardPosts()[0].cardsV2).join(' ')).not.toMatch(/[✅✔☑]/u);
    expect((await onlyCard()).data.precheck.issues).toHaveLength(3);
  });

  test('outside a Chat thread the tool refuses and stores nothing', async () => {
    const result = await trackReview(RTRI_INPUT, { userId: 1, conversationId: DIRECT_CONV, chatContext: { surface: 'none' } });
    expect(result.success).toBe(false);
    expect(fakes.db.cards.size).toBe(0);
    expect(fakes.chat.posts).toEqual([]);
  });

  test.each([
    ['can you two review the app?', true],
    ['please proofread these', true],
    ['could you look these over', true],
    ['I need a second pair of eyes on this', true],
    ['need sign-off before we submit', true],
    ['what does section 3 say?', false],
    ['summarize these docs', false],
    ['preview this for me', false]
  ])('"%s" is an explicit review request: %s', (text, expected) => {
    expect(REVIEW_INTENT.test(text)).toBe(expected);
  });
});

// ============================================================================
// UNCLEAR REQUESTS
// ============================================================================

describe('when it is not clear a review is wanted', () => {
  const unclear = { text: `thoughts? ${docUrl(DOC1)} ${docUrl(DOC2)}`, mentions: [STEPH, NATALIE] };

  test('Oracle asks with a button instead of guessing; Track turns the offer into the review card', async () => {
    const asked = await say(unclear);
    expect(asked).toMatchObject({ asked: true });
    expect(textReplies).toEqual([]);

    const offer = await onlyCard();
    expect(offer.status).toBe('offered');
    expect(await fakes.store.getParticipants(offer.id)).toEqual([]);
    const offerPost = cardPosts()[0];
    expect(offerPost.cardsV2[0].card.header.title).toBe('Track this as a review?');
    expect(cardButtons(offerPost.cardsV2).map(b => [b.text, b.params.action])).toEqual([['Track as review', 'review.track']]);

    // Steph presses Track: the offer shows "Setting up…" at once …
    const response = await press(offer, 'review.track', STEPH);
    expect(cardText(updated(response))).toContain(`Last update: Setting up the review… · ${NAMES[STEPH]}`);
    expect(buttonsOf(updated(response))).toEqual([['Setting up…', true]]);
    await whenCardsIdle();

    // … Oracle runs in the thread with the offer confirmed, and the SAME message
    // becomes the review card.
    const setup = fakes.agent.calls.at(-1);
    expect(setup).toMatchObject({ conversationId: offer.conversation_id, userId: 2 });
    expect(setup.chatContext).toMatchObject({ trackConfirmedOfferId: offer.id, threadName: THREAD, senderChatId: STEPH });

    const card = await onlyCard();
    expect(card).toMatchObject({ id: offer.id, status: 'open', message_name: offerPost.name, owner_chat_id: OWNER });
    expect(cardPosts()).toHaveLength(1);                   // no second card was posted
    const patched = lastPatch();
    expect(cardText(patched)).toContain('0 of 2 reviews done');
    expect(cardText(patched)).toContain(`Last update: ${NAMES[STEPH]} asked to track this as a review`);
    const reviewers = (await fakes.store.getParticipants(card.id)).filter(p => p.role === 'reviewer').map(p => p.chat_user_id);
    expect(reviewers.sort()).toEqual([STEPH, NATALIE]);
    expect(textReplies).toEqual([]);
  });

  test('Track pressed by someone without a Hub account says so and changes nothing', async () => {
    await say(unclear);
    const offer = await onlyCard();

    await press(offer, 'review.track', NATALIE);
    await whenCardsIdle();

    expect((await onlyCard()).status).toBe('offered');
    expect(fakes.agent.calls).toHaveLength(1);              // only the original turn
    expect(privateReplies()).toEqual([[NATALIE, 'Only someone signed in to the Hub can start tracking.']]);
    const patched = lastPatch();
    expect(cardText(patched)).not.toContain('Setting up');
    expect(buttonsOf(patched)).toEqual([['Track as review', false]]);
  });

  test('a second unclear mention does not post a second question', async () => {
    await say(unclear);
    const again = await say(unclear);
    expect(again).toMatchObject({ asked: true });
    expect(cardPosts()).toHaveLength(1);
    expect(textReplies).toEqual([]);
  });
});

// ============================================================================
// MISSING PIECES
// ============================================================================

describe('when something is missing', () => {
  test('no Doc links: Oracle asks which Docs, and the next message with links completes the card', async () => {
    const first = await say({ text: 'can you review the Acme RTRI app?', mentions: [STEPH, NATALIE] });
    expect(first).toMatchObject({ needs_docs: true });
    expect(textReplies).toEqual(['Which Docs should be reviewed?']);
    expect(cardPosts()).toEqual([]);
    expect((await onlyCard()).status).toBe('awaiting_docs');

    const second = await say({ text: `here they are ${docUrl(DOC1)} ${docUrl(DOC2)}` });
    expect(second).toMatchObject({ card_posted: true });

    const card = await onlyCard();
    expect(card.status).toBe('open');
    const reviewers = (await fakes.store.getParticipants(card.id)).filter(p => p.role === 'reviewer').map(p => p.chat_user_id);
    expect(reviewers.sort()).toEqual([STEPH, NATALIE]);    // kept from the first message
    expect(cardPosts()).toHaveLength(1);
    expect(textReplies).toEqual(['Which Docs should be reviewed?']);
  });

  test('a later message can add a reviewer without dropping the first ones', async () => {
    await say({ text: 'can you review the Acme RTRI app?', mentions: [STEPH] });
    await say({ text: `docs: ${docUrl(DOC1)} — and Natalie too`, mentions: [NATALIE] });
    const reviewers = (await fakes.store.getParticipants((await onlyCard()).id))
      .filter(p => p.role === 'reviewer').map(p => p.chat_user_id);
    expect(reviewers.sort()).toEqual([STEPH, NATALIE]);
  });

  test('no reviewers: Oracle asks who, and the next mention completes the card', async () => {
    const first = await say({ text: `please review ${docUrl(DOC1)}` });
    expect(first).toMatchObject({ needs_reviewers: true });
    expect(textReplies).toEqual(['Who should review this?']);

    const second = await say({ text: 'Steph please', mentions: [STEPH] });
    expect(second).toMatchObject({ card_posted: true });
    expect((await onlyCard()).data.docIds).toEqual([DOC1]);
  });
});

// ============================================================================
// COMPLETION AND THE HUBSPOT NOTE
// ============================================================================

describe('when every reviewer is done', () => {
  async function bothDone() {
    await track();
    const card = await onlyCard();
    await press(card, 'review.done', STEPH);
    const response = await press(card, 'review.done', NATALIE);
    await whenCardsIdle();
    return { card: await onlyCard(), response };
  }

  test('the card shows completion and proposes — never writes — a HubSpot note', async () => {
    const { card, response } = await bothDone();

    expect(cardText(updated(response))).toContain('<b>Review complete</b> · 2 of 2 reviews done · 5 open comments');
    expect(fakes.gate.saved).toHaveLength(1);
    const saved = fakes.gate.saved[0];
    expect(saved).toMatchObject({
      tool_name: 'create_hubspot_note',
      conversation_id: DIRECT_CONV,
      proposed_by: 1
    });
    expect(saved.tool_input).toEqual({
      deal_id: '555',
      deal_name: 'Acme Sentinel Ltd - RTRI',
      body: `Review complete (tracked by Oracle in Google Chat): ${TITLE}.\n` +
        `Reviewers: ${NAMES[NATALIE]}, ${NAMES[STEPH]}.\n` +
        'Open comments at completion: 5 across 2 documents.'
    });
    expect(fakes.hubspot.notes).toEqual([]);               // nothing written
    expect(card.data.hubspot).toMatchObject({ state: 'proposed', pendingActionId: saved.id });

    const patched = lastPatch();
    expect(cardText(patched)).toContain('HubSpot: outcome note ready for “Acme Sentinel Ltd - RTRI” — add it below, or reply “@Oracle yes”.');
    // Review buttons no longer apply: disabled, with the state in their labels.
    expect(buttonsOf(patched)).toEqual([
      ['I’m reviewing', true], ['All 2 done ✓', true], ['Draft client follow-up', false],
      ['Add note to HubSpot', false], ['Don’t add note', false]
    ]);
    expect(card).toMatchObject({ status: 'open', completion_shown_on: null });
    expect(card.completed_at).toBeInstanceOf(Date);

    // The requester is told — it is their confirmation to give. Reviewers are not.
    expect(dmsTo('spaces/DM-OWNER').map(p => p.text)).toEqual([
      `All reviews are done for ${TITLE}. A HubSpot note is ready to add to "Acme Sentinel Ltd - RTRI" — confirm it on the card. https://chat.google.com/room/AAA/T1`
    ]);
    expect(dmsTo('spaces/DM-STEPH').map(p => p.text)).toEqual([expect.stringContaining('asked you to review')]);
  });

  test('Add note to HubSpot runs exactly the stored note, once, as the presser — and closes the card', async () => {
    const { card } = await bothDone();
    const saved = fakes.gate.saved[0];

    const response = await press(card, 'review.hubspot', STEPH);
    expect(cardText(updated(response))).toContain(`Last update: Adding note to HubSpot… · ${NAMES[STEPH]}`);
    expect(buttonsOf(updated(response)).slice(3)).toEqual([['Adding note…', true]]);
    await whenCardsIdle();

    expect(fakes.gate.runs).toEqual([{ actionId: saved.id, userId: 2 }]);
    expect(fakes.hubspot.notes).toEqual([{ deal_id: '555', body: saved.tool_input.body }]);
    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'note_added' });
    const patched = lastPatch();
    expect(cardText(patched)).toContain('HubSpot: outcome note added to “Acme Sentinel Ltd - RTRI”.');
    expect(cardText(patched)).not.toContain('Adding note');
    expect(patched[0].card.header.subtitle).toContain('Closed');
    expect(cardButtons(patched)).toEqual([]);

    const again = await press(await onlyCard(), 'review.hubspot', STEPH);
    await whenCardsIdle();
    expect(fakes.hubspot.notes).toHaveLength(1);
    expect(fakes.db.clicks.at(-1).result).toBe('closed');
    expect(cardText(updated(again))).toContain('outcome note added');
    expect(privateReplies()).toEqual([[STEPH, 'This card is closed, so nothing changed.']]);
  });

  test('"@Oracle yes" in the thread adds the note and closes the card straight away', async () => {
    confirmationImpl = async ({ conversationId, userId, text }) => {
      if (text !== 'yes') return null;
      const run = await fakes.gate.confirmInThread(conversationId, userId);
      return { replyText: run.ok ? 'Done: the note.' : 'Nothing is waiting for confirmation.' };
    };
    await say(reviewRequest());
    const card = await onlyCard();
    await press(card, 'review.done', STEPH);
    await press(await onlyCard(), 'review.done', NATALIE);
    await whenCardsIdle();
    expect(fakes.gate.saved[0].conversation_id).toBe(card.conversation_id);   // the thread's own slot

    await say({ text: 'yes' });

    expect(textReplies).toEqual(['Done: the note.']);
    expect(fakes.hubspot.notes).toHaveLength(1);
    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'note_added' });
    const patched = lastPatch();
    expect(cardText(patched)).toContain('outcome note added');
    expect(cardButtons(patched)).toEqual([]);
  });

  test('a note confirmed elsewhere also closes the card at the next refresh', async () => {
    await bothDone();
    await fakes.gate.confirmInThread(DIRECT_CONV, 1);
    await refreshLiveCards();
    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'note_added' });
    expect(cardText(lastPatch())).toContain('outcome note added');
  });

  test('the requester can decline the note: the card closes and a later "yes" runs nothing', async () => {
    const { card } = await bothDone();

    await press(card, 'review.hubspot_decline', STEPH);            // not the requester
    await whenCardsIdle();
    expect(fakes.db.clicks.at(-1).result).toBe('not_the_owner');
    expect((await onlyCard()).status).toBe('open');
    expect(privateReplies()).toEqual([[STEPH, 'Only the requester can decline the note.']]);

    const response = await press(await onlyCard(), 'review.hubspot_decline', OWNER);
    await whenCardsIdle();

    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'note_declined' });
    expect(fakes.db.actions.get(fakes.gate.saved[0].id).status).toBe('declined');
    const cards = updated(response);
    expect(cardText(cards)).toContain('HubSpot: note for “Acme Sentinel Ltd - RTRI” declined — nothing recorded.');
    expect(cardText(cards)).toContain(`Last update: ${NAMES[OWNER]} declined the HubSpot note`);
    expect(cardButtons(cards)).toEqual([]);

    await expect(fakes.gate.confirmInThread(DIRECT_CONV, 1)).resolves.toMatchObject({ ok: false });
    expect(fakes.hubspot.notes).toEqual([]);
  });

  test('7 days after completion the card closes, even if nobody answered', async () => {
    const { card } = await bothDone();
    const completed = new Date(card.completed_at).getTime();

    await applyLifecycle(new Date(completed + 7 * DAY - 60_000));
    expect((await onlyCard()).status).toBe('open');

    const result = await applyLifecycle(new Date(completed + 7 * DAY + 60_000));
    expect(result.completedClosed).toBe(1);
    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'completed' });
    expect(cardButtons(lastPatch())).toEqual([]);
    expect(fakes.hubspot.notes).toEqual([]);
  });

  test('with no deal to note, it still closes 7 days after completion', async () => {
    fakes.hubspot.deals.length = 0;
    const { card } = await bothDone();
    await applyLifecycle(new Date(new Date(card.completed_at).getTime() + 8 * DAY));
    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'completed' });
  });

  test('the completed review appears in one digest of the requester’s, then drops out', async () => {
    fakes.calendar.zones.set(1, 'UTC');                        // the requester's calendar
    const { card } = await bothDone();
    const other = await track({ ...RTRI_INPUT, title: 'Second request' }, { threadName: `${SPACE}/threads/T2` });
    expect(other).toMatchObject({ card_posted: true });
    const otherCard = [...fakes.db.cards.values()].find(c => c.id !== card.id);
    const eightAm = (days) => new Date(`${new Date(Date.now() + days * DAY).toISOString().slice(0, 10)}T08:05:00Z`);
    const ownerDigests = () => dmsTo('spaces/DM-OWNER').filter(p => p.cardsV2).map(p => p.cardsV2);

    // Day 1: both requests; the completed one says so.
    await sendDueDigests(eightAm(1));
    expect(ownerDigests()).toHaveLength(1);
    const first = cardText(ownerDigests()[0]);
    expect(first).toContain('Review complete · 5 open comments · HubSpot note waiting for you');
    expect(first).toContain('0/2 reviews done · 5 open comments');
    expect((await fakes.store.getCard(card.id)).completion_shown_on).toBe(eightAm(1).toISOString().slice(0, 10));

    // A press on that digest the same day re-renders it with both items still there.
    const muted = await handleCardClick({
      actorChatId: OWNER, actorName: NAMES[OWNER], actorEmail: null, messageName: 'spaces/DM-OWNER/messages/digest',
      parameters: { cardId: otherCard.id, action: 'card.mute', from: 'digest' }
    }, new Date(eightAm(1).getTime() + 5 * 60_000));
    expect(cardText(updated(muted))).toContain('Review complete');

    // Day 2: the completed review is gone (the other one is muted) — nothing to send.
    const counts = await sendDueDigests(eightAm(2));
    expect(ownerDigests()).toHaveLength(1);
    expect(counts.empty).toBeGreaterThanOrEqual(1);
    expect((await fakes.store.getCard(card.id)).status).toBe('open');   // it closes on its own terms
  });

  test('an expired proposal is stored again and run by the same press', async () => {
    const { card } = await bothDone();
    fakes.gate.expire(fakes.gate.saved[0].id);

    await refreshLiveCards();
    expect(cardText(lastPatch())).toContain('was not confirmed in time');

    await press(card, 'review.hubspot', STEPH);
    await whenCardsIdle();
    expect(fakes.gate.saved).toHaveLength(2);
    expect(fakes.gate.saved[1].tool_input).toEqual(fakes.gate.saved[0].tool_input);
    expect(fakes.gate.saved[1].proposed_by).toBe(2);
    expect(fakes.hubspot.notes).toHaveLength(1);
    expect((await onlyCard()).data.hubspot).toMatchObject({ state: 'added', pendingActionId: fakes.gate.saved[1].id });
  });

  test('someone without a Hub account cannot confirm; someone with one then can', async () => {
    const { card } = await bothDone();

    await press(card, 'review.hubspot', NATALIE);
    await whenCardsIdle();
    expect(fakes.gate.runs).toEqual([]);
    expect(fakes.hubspot.notes).toEqual([]);
    expect(privateReplies()).toEqual([[NATALIE, 'Only someone signed in to the Hub can add the HubSpot note.']]);
    expect(buttonsOf(lastPatch()).slice(3)).toEqual([['Add note to HubSpot', false], ['Don’t add note', false]]);   // still offered
    expect(await onlyCard()).toMatchObject({ status: 'open', data: expect.objectContaining({ busy: null }) });
    expect((await onlyCard()).data.hubspot.state).toBe('proposed');

    await press(await onlyCard(), 'review.hubspot', STEPH);
    await whenCardsIdle();
    expect(fakes.hubspot.notes).toHaveLength(1);
  });

  test('a failed write shows as failed and can be tried again', async () => {
    const { card } = await bothDone();
    fakes.hubspot.failNote = true;
    await press(card, 'review.hubspot', STEPH);
    await whenCardsIdle();
    expect(cardText(lastPatch())).toContain('HubSpot: the note for “Acme Sentinel Ltd - RTRI” could not be added — try again.');
    expect(cardButtons(lastPatch()).map(b => b.text)).toContain('Add note to HubSpot');

    expect((await onlyCard()).status).toBe('open');

    fakes.hubspot.failNote = false;
    await press(await onlyCard(), 'review.hubspot', STEPH);
    await whenCardsIdle();
    expect(fakes.hubspot.notes).toHaveLength(1);
    expect(await onlyCard()).toMatchObject({ status: 'closed', closed_reason: 'note_added' });
    expect((await onlyCard()).data.hubspot.state).toBe('added');
  });

  test('no single matching deal: nothing is proposed, and the card says why', async () => {
    fakes.hubspot.deals.length = 0;
    await bothDone();
    expect(fakes.gate.saved).toEqual([]);
    expect(cardText(lastPatch())).toContain('HubSpot: no matching deal — outcome not recorded.');
  });

  test('several matching deals: nothing is proposed', async () => {
    fakes.hubspot.deals.push({ id: '556', name: 'Acme Sentinel Ltd - RTRI (2)', companyName: 'Acme Sentinel Ltd', program: 'RTRI' });
    await bothDone();
    expect(fakes.gate.saved).toEqual([]);
    expect(cardText(lastPatch())).toContain('HubSpot: 2 possible deals — outcome not recorded.');
  });

  test('another program’s deal for the same client is not a match', async () => {
    fakes.hubspot.deals.push({ id: '777', name: 'Acme Sentinel Ltd - CanExport', companyName: 'Acme Sentinel Ltd', program: 'CanExport SMEs' });
    await bothDone();
    expect(fakes.gate.saved.map(s => s.tool_input.deal_id)).toEqual(['555']);
  });

  test('with one reviewer, the buttons name them and switch off once the review is done', async () => {
    await track(RTRI_INPUT, { mentions: [{ chatUserId: STEPH, displayName: NAMES[STEPH] }] });
    const card = await onlyCard();

    const reviewing = await press(card, 'review.reviewing', STEPH);
    expect(buttonsOf(updated(reviewing)).slice(0, 2)).toEqual([['Reviewing · Steph', false], ['Mark my review done', false]]);

    const done = await press(card, 'review.done', STEPH);
    expect(buttonsOf(updated(done)).slice(0, 2)).toEqual([['I’m reviewing', true], ['Done ✓ · Steph', true]]);
  });

  test('with several reviewers, the labels count and stay pressable until everyone is done', async () => {
    await track();
    const card = await onlyCard();
    await press(card, 'review.reviewing', STEPH);
    const both = await press(card, 'review.reviewing', NATALIE);
    expect(buttonsOf(updated(both)).slice(0, 2)).toEqual([['Reviewing · 2', false], ['Mark my review done', false]]);
    const one = await press(card, 'review.done', STEPH);
    expect(buttonsOf(updated(one)).slice(0, 2)).toEqual([['Reviewing · Natalie', false], ['Done ✓ · Steph', false]]);
  });

  test('completion is proposed once, even if a reviewer re-opens and re-closes', async () => {
    const { card } = await bothDone();
    await press(card, 'review.reviewing', STEPH);
    await press(await onlyCard(), 'review.done', STEPH);
    await whenCardsIdle();
    expect(fakes.gate.saved).toHaveLength(1);
    expect(dmsTo('spaces/DM-OWNER')).toHaveLength(1);
  });
});

// ============================================================================
// DRAFT CLIENT FOLLOW-UP
// ============================================================================

describe('Draft client follow-up', () => {
  test('drafts in its own conversation and DMs it to the presser; nothing is sent or written', async () => {
    await track();
    const card = await onlyCard();

    const response = await press(card, 'review.draft', STEPH);
    expect(cardText(updated(response))).toContain(`Last update: Drafting follow-up… · ${NAMES[STEPH]}`);
    expect(buttonsOf(updated(response))[2]).toEqual(['Drafting…', true]);
    await whenCardsIdle();

    const call = fakes.agent.calls.at(-1);
    expect(call.userId).toBe(2);
    expect(call.chatContext).toBeUndefined();
    expect(call.conversationId).not.toBe(card.conversation_id);
    expect(fakes.messages.conversations.map(c => c.id)).toEqual([call.conversationId]);
    expect(call.message).toContain('- 2025 financial statements\n- Proof of tariff impact');
    expect(call.message).toContain('do not use any tools');

    expect(dmsTo('spaces/DM-STEPH').at(-1).text).toBe(`Draft client follow-up for ${TITLE} — not sent:\n\n${DRAFT}`);
    expect(fakes.chat.posts.filter(p => p.spaceName === SPACE && p.text)).toEqual([]);
    const done = cardText(lastPatch());
    expect(done).toContain(`Last update: ${NAMES[STEPH]} asked for a client follow-up draft — sent to ${NAMES[STEPH]} by DM`);
    expect(done).not.toContain('Drafting');
    expect(buttonsOf(lastPatch())[2]).toEqual(['Draft client follow-up', false]);
    expect(fakes.gate.saved).toEqual([]);
    expect(fakes.hubspot.notes).toEqual([]);
  });

  test('with no DM, the draft goes to the thread, never elsewhere', async () => {
    fakes.chat.dms.delete(STEPH);   // before the card: "no DM" is remembered for a day
    await track();
    await press(await onlyCard(), 'review.draft', STEPH);
    await whenCardsIdle();

    expect(fakes.agent.calls.at(-1).userId).toBe(2);
    const threadPosts = fakes.chat.posts.filter(p => p.text?.startsWith('Draft client follow-up'));
    expect(threadPosts.map(p => [p.spaceName, p.threadName])).toEqual([[SPACE, THREAD]]);
    expect(cardText(lastPatch())).toContain('— posted in this thread (no DM with Oracle yet)');
  });

  test('someone without a Hub account cannot draft — the run never borrows the requester’s account', async () => {
    await track();
    await press(await onlyCard(), 'review.draft', NATALIE);
    await whenCardsIdle();

    expect(fakes.agent.calls).toEqual([]);
    expect(fakes.messages.conversations).toEqual([]);
    expect(fakes.chat.posts.filter(p => p.text?.startsWith('Draft client follow-up'))).toEqual([]);
    expect(privateReplies()).toEqual([[NATALIE, 'Only someone signed in to the Hub can draft a follow-up.']]);
    expect(cardText(lastPatch())).not.toContain('Drafting');
    expect(buttonsOf(lastPatch())[2]).toEqual(['Draft client follow-up', false]);
    expect(logged()).toContain('reason: no_hub_user');
  });

  test('the press is answered at once; the card updates when the slow draft finishes', async () => {
    await track();
    let release;
    const slow = new Promise(resolve => { release = resolve; });
    fakes.agent.impl = async () => {
      await slow;                                          // drafting takes a while
      return { success: true, response: { content: [{ type: 'text', text: DRAFT }] } };
    };
    const t0 = Date.now();
    const response = await press(await onlyCard(), 'review.draft', STEPH);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(cardText(updated(response))).toContain('Last update: Drafting follow-up…');
    expect(dmsTo('spaces/DM-STEPH').filter(p => p.text?.startsWith('Draft'))).toEqual([]);

    // Still drafting: a second press does not start another, and says so privately.
    await press(await onlyCard(), 'review.draft', STEPH);
    await new Promise(r => setImmediate(r));
    expect(privateReplies()).toEqual([[STEPH, 'A follow-up draft is already being written.']]);

    release();
    await whenCardsIdle();
    expect(fakes.agent.calls.filter(c => !c.chatContext)).toHaveLength(1);
    expect(cardText(lastPatch())).toContain('— sent to Steph Sentinel by DM');
  });

  test('a failed draft says so on the card', async () => {
    await track();
    fakes.agent.impl = async () => ({ success: false, error: 'boom' });
    await press(await onlyCard(), 'review.draft', STEPH);
    await whenCardsIdle();
    expect(cardText(lastPatch())).toContain('— couldn’t draft it — try again');
    expect(logged()).toContain('Review follow-up draft failed — code: no_draft');
  });
});

// ============================================================================
// CLOSED
// ============================================================================

describe('a closed review card', () => {
  test('keeps its content, loses its buttons, and ignores presses and refreshes', async () => {
    await track();
    const card = await onlyCard();
    await press(card, 'review.done', STEPH);
    await fakes.store.closeCard(card.id, 'closed_by_owner');
    fakes.drive.docs.set(DOC1, { name: 'Acme RTRI application', openComments: 0 });

    const response = await press(await onlyCard(), 'review.reviewing', STEPH);
    const text = cardText(updated(response));
    expect(text).toContain(`${NAMES[STEPH]} · Done`);
    expect(text).toContain('Acme RTRI application · 4 comments');   // frozen, not refreshed
    expect(cardButtons(updated(response))).toEqual([]);

    const drivesBefore = fakes.drive.calls.length;
    await refreshLiveCards();
    expect(fakes.drive.calls).toHaveLength(drivesBefore);
    expect(cardText(await renderCard(await onlyCard()))).toContain(`Last update: ${NAMES[STEPH]} marked their review done`);
  });
});
