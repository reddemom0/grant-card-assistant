/**
 * /track — reading words: intent, typed commands, shape, due dates, holder,
 * and the rule-based "who has the ball" suggestion. Pure functions.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/track-parse.test.js
 */

import {
  trackIntent, typedCommand, detectShape, isFeedbackAsk, pickHolder, parseDueDate, zonedTime
} from '../../src/cards/track-parse.js';
import { suggestBall, draftDecision } from '../../src/cards/track-suggest.js';

const TZ = 'America/Vancouver';
// Thursday 17 September 2026, 09:00 in Vancouver.
const NOW = new Date('2026-09-17T16:00:00Z');
const local = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(d).replace(',', '');

describe('track intent', () => {
  test.each([
    ['track this', 'track'],
    ['Track this please.', 'track'],
    ['please track this thread', 'track'],
    ['can you track this', 'track'],
    ['can you track this and remind Jason', 'maybe'],
    ['keep an eye on this', 'maybe'],
    ['please follow up on this', 'maybe'],
    ['who has the ball on this?', null],
    ['track this?', null],
    ['can you keep an eye on this?', null],
    ['what did we decide about the industry list', null],
    ['', null]
  ])('%j → %j', (text, expected) => {
    expect(trackIntent(text)).toBe(expected);
  });
});

describe('typed commands (the dialogs, without dialogs)', () => {
  test.each([
    ['decision: Use the 2024 NAICS list', { kind: 'decision', text: 'Use the 2024 NAICS list' }],
    ['Decided — go with option B', { kind: 'decision', text: 'go with option B' }],
    ['response: I prefer the Tuesday slot', { kind: 'response', text: 'I prefer the Tuesday slot' }],
    ['my feedback: looks good', { kind: 'response', text: 'looks good' }],
    ['pass to @Steph', { kind: 'pass' }],
    ['pass it to Steph', { kind: 'pass' }],
    ['remove @Jo @Sam', { kind: 'remove' }],
    ['promised @Jo by Friday', { kind: 'promise', text: '@Jo by Friday' }],
    ['decision:', null],
    ['what is the decision?', null],
    ['please pass the salt', null]
  ])('%j', (text, expected) => {
    expect(typedCommand(text)).toEqual(expected);
  });
});

describe('shape and feedback', () => {
  test.each([
    ['everyone switch your meeting links by Sept 1', false, 'everyone'],
    ['Team, please update your signatures', false, 'everyone'],
    ['all of you: fill in the form', false, 'everyone'],
    ['@all please read', false, 'everyone'],
    ['can you send the list?', true, 'everyone'],      // an @all mention annotation
    ['@Jason can you send the industry list?', false, 'one'],
    ['the team lead will decide', false, 'one']
  ])('%j (mentions all: %s) → %s', (text, mentionsAll, expected) => {
    expect(detectShape(text, mentionsAll)).toBe(expected);
  });

  test('feedback wording', () => {
    expect(isFeedbackAsk('everyone, share your thoughts on the new template')).toBe(true);
    expect(isFeedbackAsk('let me know which slot works')).toBe(true);
    expect(isFeedbackAsk('please vote on the logo')).toBe(true);
    expect(isFeedbackAsk('everyone switch your meeting links')).toBe(false);
  });
});

describe('holder', () => {
  const mentions = [
    { chatUserId: 'users/all', displayName: 'all' },
    { chatUserId: 'users/app', displayName: 'Oracle', type: 'BOT' },
    { chatUserId: 'users/listener', displayName: 'Oracle' },
    { chatUserId: 'users/jason', displayName: 'Jason' },
    { chatUserId: 'users/steph', displayName: 'Steph' }
  ];

  test('the first real person mentioned — never @all, apps or the listener', () => {
    expect(pickHolder(mentions, m => m.chatUserId === 'users/listener'))
      .toEqual({ chatUserId: 'users/jason', name: 'Jason' });
  });

  test('nobody left means no holder', () => {
    expect(pickHolder(mentions.slice(0, 3), m => m.chatUserId === 'users/listener')).toBeNull();
    expect(pickHolder([])).toBeNull();
  });
});

describe('due dates', () => {
  test.each([
    ['send the list by Friday', '2026-09-18 23:59', 'by Friday', false],
    ['before EOD Friday', '2026-09-18 17:00', 'before EOD Friday', true],
    ['by tomorrow 3pm', '2026-09-18 15:00', 'by tomorrow 3pm', true],
    ['by noon today', '2026-09-17 12:00', 'by noon today', true],
    ['by end of week', '2026-09-18 17:00', 'by end of week', true],
    ['by EOD', '2026-09-17 17:00', 'by EOD', true],
    ['by Oct 1', '2026-10-01 23:59', 'by Oct 1', false],
    ['by the 3rd of October', '2026-10-03 23:59', 'by the 3rd of October', false],
    ['by 10/3', '2026-10-03 23:59', 'by 10/3', false],
    ['due 2026-12-24', '2026-12-24 23:59', 'due 2026-12-24', false],
    ['by next Friday', '2026-09-25 23:59', 'by next Friday', false],
    ['no later than Monday COB', '2026-09-21 17:00', 'no later than Monday COB', true],
    ['by Friday at 10:30am', '2026-09-18 10:30', 'by Friday at 10:30am', true],
    ['by 2:30', '2026-09-17 14:30', 'by 2:30', true],
    ['due by Sept 30th, 2027', '2027-09-30 23:59', 'due by Sept 30th, 2027', false]
  ])('%j', (text, expected, label, hasTime) => {
    const due = parseDueDate(text, TZ, NOW);
    expect(local(due.at)).toBe(expected);
    expect(due).toMatchObject({ label, hasTime });
  });

  test('a date that has passed means next year — counted from when the ask was written', () => {
    expect(local(parseDueDate('by Sept 1', TZ, NOW).at)).toBe('2027-09-01 23:59');
    expect(local(parseDueDate('by Sept 1', TZ, new Date('2026-08-25T17:00:00Z')).at)).toBe('2026-09-01 23:59');
  });

  test('the time zone is the requester’s', () => {
    const due = parseDueDate('by Friday 9am', 'America/Toronto', NOW);
    expect(due.at.toISOString()).toBe('2026-09-18T13:00:00.000Z');
    expect(zonedTime(2026, 11, 1, 1, 30, TZ).toISOString()).toBe('2026-11-01T08:30:00.000Z');   // DST ends that night
  });

  test.each(['send it before we meet', 'by 13/45', 'by the way, thanks', 'due diligence', 'no date here'])('%j has no due date', (text) => {
    expect(parseDueDate(text, TZ, NOW)).toBeNull();
  });
});

describe('who has the ball — suggested from the thread', () => {
  const msg = (n, sender, text, extra = {}) => ({
    name: `spaces/S/messages/${n}`,
    senderChatId: `users/${sender}`,
    senderName: sender,
    senderType: 'HUMAN',
    text,
    at: new Date(Date.UTC(2026, 8, 17, 10, n)).toISOString(),
    ...extra
  });
  const owner = { chatUserId: 'users/nat', name: 'nat' };
  const ctx = { owner, timeZone: TZ, isExcluded: (id) => id === 'users/listener' };

  test('a person @mentioned by someone else has the ball — with the message it came from', () => {
    const s = suggestBall([
      msg(1, 'nat', '@jason can you send the list?', { mentions: [{ chatUserId: 'users/jason', displayName: 'jason' }] }),
      msg(2, 'jason', '@steph you have the latest version', { mentions: [{ chatUserId: 'users/steph', displayName: 'steph' }] })
    ], ctx);
    expect(s).toEqual({ state: 'person', holder: { chatUserId: 'users/steph', name: 'steph' }, source: 'spaces/S/messages/2' });
  });

  test('a promise gives the ball to the sender, with the promised date', () => {
    const s = suggestBall([msg(3, 'steph', "I'll send it by Friday")], ctx);
    expect(s).toMatchObject({ state: 'person', holder: { chatUserId: 'users/steph' }, promised: true, source: 'spaces/S/messages/3' });
    expect(local(s.due.at)).toBe('2026-09-18 23:59');
  });

  test.each([
    ['sent it to the client this morning', 'client'],
    ['still waiting to hear back from the client', 'client'],
    ['we should jump on a call about this', 'call'],
    ['we decided to use the 2024 list', 'decided']
  ])('%j → %s', (text, state) => {
    expect(suggestBall([msg(4, 'jason', text)], ctx)).toMatchObject({ state, source: 'spaces/S/messages/4' });
  });

  test('waiting on client records who is chasing', () => {
    expect(suggestBall([msg(4, 'jason', 'emailed the client')], ctx).chaser).toEqual({ chatUserId: 'users/jason', name: 'jason' });
  });

  test('when the holder replies with nothing else, the ball goes back to the person who asked', () => {
    const s = suggestBall([msg(5, 'jason', 'here is the list')], { ...ctx, holderChatId: 'users/jason' });
    expect(s).toEqual({ state: 'person', holder: { chatUserId: 'users/nat', name: 'nat' }, replied: true, source: 'spaces/S/messages/5' });
  });

  test('messages from before the ball last moved, apps, Oracle and the listener are ignored', () => {
    const messages = [
      msg(1, 'nat', '@jason please', { mentions: [{ chatUserId: 'users/jason' }] }),
      msg(6, 'app', '@steph from a bot', { senderType: 'BOT', mentions: [{ chatUserId: 'users/steph' }] }),
      msg(7, 'nat', 'cc @Oracle', { mentions: [{ chatUserId: 'users/listener' }, { chatUserId: 'users/all' }] })
    ];
    expect(suggestBall(messages, { ...ctx, since: new Date(Date.UTC(2026, 8, 17, 10, 2)) })).toBeNull();
    expect(suggestBall(messages, ctx)).toMatchObject({ holder: { chatUserId: 'users/jason' }, source: 'spaces/S/messages/1' });
  });

  test('the decision draft is the latest decision wording, else the latest message', () => {
    expect(draftDecision([
      msg(1, 'nat', 'options: A or B'),
      msg(2, 'jason', "**We decided** to go with B"),
      msg(3, 'steph', 'thanks all')
    ])).toBe('**We decided** to go with B');
    expect(draftDecision([msg(1, 'nat', 'options: A or B'), msg(3, 'steph', 'x'.repeat(600))])).toHaveLength(500);
    expect(draftDecision([])).toBe('');
  });
});
