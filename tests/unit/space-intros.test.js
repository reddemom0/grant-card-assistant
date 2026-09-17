/**
 * Space intros and non-message event handling
 *
 * Two things are easy to get wrong here and invisible when you do: matching only
 * the SCREAMING_SNAKE event name (so the add-on's camelCase never fires), and
 * introducing Oracle into a DM where it is noise.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/space-intros.test.js
 */

import { resolveSpaceIntro, knownSpaceNames, listeningNotice } from '../../src/api/space-intros.js';
import { normalizeChatEvent, canonicalEventType, buildMessageRequest } from '../../src/api/chat-google.js';

const CLOSING = 'I only see messages where I\'m @mentioned. Before I change anything in HubSpot, calendars or Docs, I\'ll show you the details — anyone in the thread can reply "yes" to confirm.';

describe('resolving an intro', () => {
  test('a known space gets its own intro plus the shared closing', () => {
    const intro = resolveSpaceIntro({ displayName: 'RTRI Changes' });

    expect(intro).toContain("I've been added to RTRI Changes");
    expect(intro).toContain('What changed in RTRI eligibility?');
    expect(intro.endsWith(CLOSING)).toBe(true);
  });

  test('matching is case-insensitive and ignores surrounding space', () => {
    const canonical = resolveSpaceIntro({ displayName: 'Grant Change Detection' });
    for (const variant of ['grant change detection', 'GRANT CHANGE DETECTION', '  Grant Change Detection  ']) {
      expect(resolveSpaceIntro({ displayName: variant })).toBe(canonical);
    }
  });

  test('an unknown space gets the generic intro with its name filled in', () => {
    const intro = resolveSpaceIntro({ displayName: 'Ops Standup' });

    expect(intro).toContain("I've been added to Ops Standup");
    expect(intro).not.toContain('{space}');
    expect(intro.endsWith(CLOSING)).toBe(true);
  });

  test('a nameless space still produces readable text', () => {
    const intro = resolveSpaceIntro({ displayName: '' });
    expect(intro).not.toContain('{space}');
    expect(intro).toContain('this space');
  });

  test('a DM gets no intro at all', () => {
    expect(resolveSpaceIntro({ displayName: 'Chris Reddemom', isDm: true })).toBeNull();
    expect(resolveSpaceIntro({ isDm: true })).toBeNull();
  });

  test('General Chat, Announcements and the combined name share one intro', () => {
    const a = resolveSpaceIntro({ displayName: 'General Chat' });
    const b = resolveSpaceIntro({ displayName: 'Announcements' });
    const c = resolveSpaceIntro({ displayName: 'General Chat and Announcements' });

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toContain("I'm Oracle, Granted's internal assistant");
  });

  test('every configured intro ends with the closing exactly once', () => {
    for (const name of knownSpaceNames()) {
      const intro = resolveSpaceIntro({ displayName: name });
      expect(intro.endsWith(CLOSING)).toBe(true);
      expect(intro.split(CLOSING).length - 1).toBe(1);
    }
  });

  test('the eight documented spaces are all configured', () => {
    const names = knownSpaceNames();
    for (const expected of [
      'rtri changes', 'grant change detection', 'marketing', 'strategy team',
      'ai hub', 'ai discussions', 'general chat and announcements'
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe('spaces Oracle keeps a copy of', () => {
  // A listened space must not be told "I only see messages where I'm @mentioned".
  const NOTICE = "Heads up: Oracle now keeps a 12-month copy of this space's messages so it can answer questions about past discussions here. It still only replies when you @mention it.";

  test('the one-time notice is exactly the approved wording', () => {
    expect(listeningNotice()).toBe(NOTICE);
  });

  test('a listened space gets the notice in place of the usual first sentence', () => {
    const intro = resolveSpaceIntro({ displayName: 'RTRI Changes', listening: true });

    expect(intro).toContain("I've been added to RTRI Changes");
    expect(intro).toContain(NOTICE);
    expect(intro).not.toContain("I only see messages where I'm @mentioned");
    // The confirmation promise is kept.
    expect(intro).toContain('anyone in the thread can reply "yes" to confirm.');
    expect(intro.endsWith(CLOSING)).toBe(false);
  });

  test('listening is off by default, so every other space is unchanged', () => {
    expect(resolveSpaceIntro({ displayName: 'RTRI Changes' }).endsWith(CLOSING)).toBe(true);
    expect(resolveSpaceIntro({ displayName: 'RTRI Changes', listening: false }).endsWith(CLOSING)).toBe(true);
  });

  test('a DM still gets no intro, listening or not', () => {
    expect(resolveSpaceIntro({ displayName: 'x', isDm: true, listening: true })).toBeNull();
  });
});

describe('event names', () => {
  test('camelCase and SCREAMING_SNAKE canonicalize to the same thing', () => {
    expect(canonicalEventType('addedToSpace')).toBe('addedtospace');
    expect(canonicalEventType('ADDED_TO_SPACE')).toBe('addedtospace');
    expect(canonicalEventType('messagePayload'.replace('Payload', ''))).toBe('message');
    expect(canonicalEventType('MESSAGE')).toBe('message');
  });

  test('the add-on camelCase name alone is enough — no uppercase form required', () => {
    // The add-on shape never sends ADDED_TO_SPACE, so a branch written against
    // the uppercase name only would be dead code in production.
    const evt = normalizeChatEvent({
      chat: {
        addedToSpacePayload: {
          space: { name: 'spaces/AAA', displayName: 'RTRI Changes', type: 'ROOM' }
        }
      }
    });

    expect(evt.eventType).toBe('addedToSpace');
    expect(canonicalEventType(evt.eventType)).toBe('addedtospace');
    expect(evt.spaceDisplayName).toBe('RTRI Changes');
    expect(evt.isDm).toBe(false);
    expect(resolveSpaceIntro({ displayName: evt.spaceDisplayName, isDm: evt.isDm }))
      .toContain('RTRI Changes');
  });

  test('the classic uppercase shape lands on the same canonical name', () => {
    const evt = normalizeChatEvent({
      type: 'ADDED_TO_SPACE',
      space: { name: 'spaces/BBB', displayName: 'Marketing', type: 'ROOM' }
    });

    expect(canonicalEventType(evt.eventType)).toBe('addedtospace');
    expect(evt.spaceDisplayName).toBe('Marketing');
  });
});

describe('posting with and without a thread', () => {
  // Regression: the first space intro failed in production with "The request
  // does not specify which message to reply to". messageReplyOption was sent
  // unconditionally, but an addedToSpace event carries no message and therefore
  // no thread, so Chat rejected the whole call.
  const addedToSpace = normalizeChatEvent({
    chat: { addedToSpacePayload: { space: { name: 'spaces/AAQAxp5UlNE', displayName: 'RTRI Changes', type: 'ROOM' } } }
  });

  const messageInThread = normalizeChatEvent({
    chat: {
      messagePayload: {
        message: {
          text: 'hi',
          sender: { email: 'a@granted.ca', type: 'HUMAN' },
          thread: { name: 'spaces/AAQAxp5UlNE/threads/TTT' }
        },
        space: { name: 'spaces/AAQAxp5UlNE', displayName: 'RTRI Changes' }
      }
    }
  });

  test('no thread: reply fields are omitted entirely', () => {
    const req = buildMessageRequest(addedToSpace, 'Hello');

    expect(req.parent).toBe('spaces/AAQAxp5UlNE');
    expect('messageReplyOption' in req).toBe(false);
    expect('thread' in req.requestBody).toBe(false);
    expect(req.requestBody.text).toBe('Hello');
    expect(req.requestBody.markupSyntax).toBe('MARKUP_SYNTAX_MARKDOWN');
  });

  test('with a thread: unchanged from before the fix', () => {
    const req = buildMessageRequest(messageInThread, 'Hello');

    expect(req.parent).toBe('spaces/AAQAxp5UlNE');
    expect(req.messageReplyOption).toBe('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    expect(req.requestBody.thread).toEqual({ name: 'spaces/AAQAxp5UlNE/threads/TTT' });
    expect(req.requestBody.markupSyntax).toBe('MARKUP_SYNTAX_MARKDOWN');
  });

  test('a threadKey is not a resource name, so it does not become a reply', () => {
    // normalizeChatEvent accepts thread.threadKey as an identifier but flags it
    // as not a resource name; sending it as `thread.name` would be rejected.
    const withThreadKey = normalizeChatEvent({
      chat: {
        messagePayload: {
          message: { text: 'hi', sender: { email: 'a@granted.ca' }, thread: { threadKey: 'abc' } },
          space: { name: 'spaces/AAQAxp5UlNE' }
        }
      }
    });

    expect(withThreadKey.threadIsResourceName).toBe(false);
    const req = buildMessageRequest(withThreadKey, 'Hello');
    expect('messageReplyOption' in req).toBe(false);
    expect('thread' in req.requestBody).toBe(false);
  });

  test('a file-only DM posts as a normal threaded reply', () => {
    // Same posting path as any other reply — the fix covers it either way.
    const fileOnlyDm = normalizeChatEvent({
      chat: {
        messagePayload: {
          message: {
            sender: { email: 'a@granted.ca', type: 'HUMAN' },
            thread: { name: 'spaces/DDD/threads/TTT' },
            attachment: [{ contentName: 'budget.pdf', source: 'UPLOADED_CONTENT' }]
          },
          space: { name: 'spaces/DDD', type: 'DM' }
        }
      }
    });

    expect(fileOnlyDm.hasAttachments).toBe(true);
    const req = buildMessageRequest(fileOnlyDm, 'notice');
    expect(req.messageReplyOption).toBe('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    expect(req.requestBody.thread).toEqual({ name: 'spaces/DDD/threads/TTT' });
  });

  test('a Drive file shared on its own is not treated as an ignored upload', () => {
    const driveOnlyDm = normalizeChatEvent({
      chat: {
        messagePayload: {
          message: {
            sender: { email: 'a@granted.ca', type: 'HUMAN' },
            thread: { name: 'spaces/DDD/threads/TTT' },
            attachment: [{ contentName: 'Plan', source: 'DRIVE_FILE', driveDataRef: { driveFileId: 'abc123' } }]
          },
          space: { name: 'spaces/DDD', type: 'DM' }
        }
      }
    });

    expect(driveOnlyDm.hasAttachments).toBe(false);
    expect(driveOnlyDm.isDm).toBe(true);
  });

  test('a DM with no thread still posts, as a new message', () => {
    const dmNoThread = normalizeChatEvent({
      chat: {
        messagePayload: {
          message: { sender: { email: 'a@granted.ca' }, attachment: [{ contentName: 'x.pdf', source: 'UPLOADED_CONTENT' }] },
          space: { name: 'spaces/DDD', type: 'DM' }
        }
      }
    });

    const req = buildMessageRequest(dmNoThread, 'notice');
    expect(req.parent).toBe('spaces/DDD');
    expect('messageReplyOption' in req).toBe(false);
    expect('thread' in req.requestBody).toBe(false);
  });
});

describe('DM detection tolerates every spelling Chat uses', () => {
  const added = (space) => normalizeChatEvent({ chat: { addedToSpacePayload: { space } } });

  test.each([
    ['type: DM', { name: 'spaces/D', type: 'DM' }],
    ['spaceType: DIRECT_MESSAGE', { name: 'spaces/D', spaceType: 'DIRECT_MESSAGE' }],
    ['singleUserBotDm', { name: 'spaces/D', singleUserBotDm: true }]
  ])('%s is a DM', (_label, space) => {
    const evt = added(space);
    expect(evt.isDm).toBe(true);
    expect(resolveSpaceIntro({ displayName: evt.spaceDisplayName, isDm: evt.isDm })).toBeNull();
  });

  test('a named room is not a DM', () => {
    expect(added({ name: 'spaces/R', displayName: 'AI Hub', type: 'ROOM' }).isDm).toBe(false);
  });
});
