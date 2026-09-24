/**
 * Chat app commands, registered when this module loads. The Chat adapter
 * imports it (dynamically) before looking a command up, so ordinary messages
 * never load card code.
 *
 * /track — set up in the Google Cloud console: Google Chat API → Configuration
 * → Commands → Add a command: Slash command "/track", ID CHAT_TRACK_COMMAND_ID
 * (default 1), description "Track who has the ball on this thread", "Open a
 * dialog" unchecked. Typed as a reply in a thread, it tracks the thread's
 * first message.
 *
 * /watch — the same console screen: slash command "/watch", ID
 * CHAT_WATCH_COMMAND_ID (default 3), description "Watch a funding program for
 * changes", "Open a dialog" unchecked. Typed as a reply to a post about a
 * program, it posts one watch card for that program in the space.
 *
 * /help — the same console screen: slash command "/help", ID
 * CHAT_HELP_COMMAND_ID (default 4), description "What Oracle can do here",
 * "Open a dialog" unchecked. Answers privately with this space's intro card.
 *
 * /review — the same console screen: slash command "/review", ID
 * CHAT_REVIEW_COMMAND_ID (default 5), description "Track this thread as a
 * document review", "Open a dialog" unchecked. Posts the "Track this as a
 * review?" card in the thread.
 *
 * /meet — the same console screen: slash command "/meet", ID
 * CHAT_MEET_COMMAND_ID (default 2), description "Find a time for a call on this
 * thread", "Open a dialog" unchecked. Typed as a reply in a thread with the
 * people @mentioned, it finds the three earliest times everyone is free.
 *
 * /learn-this — the same console screen: slash command "/learn-this", ID
 * CHAT_LEARN_COMMAND_ID (default 6), description "Teach Oracle from this
 * thread", "Open a dialog" unchecked. Runs the same /learn-this as the typed
 * "@Oracle /learn-this" (which still works as a fallback): the lesson card in
 * the command's thread, private to the person in a space. Text after the
 * command is the lesson in a DM.
 */

import { registerAppCommand } from './registry.js';
import { createTrack } from './track-card.js';
import { createMeet } from './meet-card.js';
import { startWatch } from './watch-card.js';
import { resolvePerson } from './people.js';
import { postMessage } from './chat-api.js';
import { runInBackground } from './actions.js';

export const TRACK_COMMAND_ID = String(process.env.CHAT_TRACK_COMMAND_ID || '1');
export const MEET_COMMAND_ID = String(process.env.CHAT_MEET_COMMAND_ID || '2');
export const WATCH_COMMAND_ID = String(process.env.CHAT_WATCH_COMMAND_ID || '3');
export const HELP_COMMAND_ID = String(process.env.CHAT_HELP_COMMAND_ID || '4');
export const REVIEW_COMMAND_ID = String(process.env.CHAT_REVIEW_COMMAND_ID || '5');
export const LEARN_COMMAND_ID = String(process.env.CHAT_LEARN_COMMAND_ID || '6');

/** Google Doc ids in a message, for a review request found above the command. */
function docLinks(text) {
  const ids = [...String(text || '').matchAll(/docs\.google\.com\/document\/d\/([\w-]{10,})/g)].map(m => m[1]);
  // The shape the review card reads (mergeDocIds): { fileId }.
  return [...new Set(ids)].map(fileId => ({ fileId }));
}

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/**
 * Answered at once with an empty body (Chat accepts it); the card is posted
 * through the Chat API afterwards — that is also how its message name is known.
 * @param {Object} evt - normalizeChatEvent() result
 * @param {Object} deps - from the Chat adapter, so card code never imports it
 * @param {(email: string) => Promise<Object|null>} deps.resolveUser
 * @param {() => string} deps.signInReply
 */
export async function handleTrackCommand(evt, deps = {}) {
  runInBackground('track command', () => runTrackCommand(evt, deps));
  return {};
}

export async function handleMeetCommand(evt, deps = {}) {
  runInBackground('meet command', () => runMeetCommand(evt, deps));
  return {};
}

export async function handleWatchCommand(evt, deps = {}) {
  runInBackground('watch command', () => runWatchCommand(evt, deps));
  return {};
}

/** /help needs no Hub account: it only describes what Oracle can do. */
export async function handleHelpCommand(evt) {
  runInBackground('help command', async () => {
    const { replyWithIntro } = await import('./intro-card.js');
    const { isListenSpace } = await import('../chat-listen/config.js');
    const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
    if (!spaceName) return;
    await replyWithIntro({
      spaceName,
      threadName: evt.threadIsResourceName ? evt.threadId : null,
      displayName: evt.isDm ? (evt.actorName || evt.senderDisplayName) : evt.spaceDisplayName,
      isDm: evt.isDm,
      listening: !evt.isDm && isListenSpace(spaceName),
      chatUserId: evt.actorChatId || evt.senderChatId || null
    });
  });
  return {};
}

export async function handleReviewCommand(evt, deps = {}) {
  runInBackground('review command', () => runReviewCommand(evt, deps));
  return {};
}

/**
 * /learn-this as a registered command. The learn run itself lives in the Chat
 * adapter and is passed in (deps.runLearnThis), so card code never imports it.
 */
export async function handleLearnCommand(evt, deps = {}) {
  runInBackground('learn command', async () => {
    const who = await commandActor(evt, deps, '/learn-this');
    if (!who.ok) return;
    if (!deps.runLearnThis) {
      console.warn('⚠️  /learn-this command not run — reason: no_learn_runner');
      return;
    }
    await deps.runLearnThis(evt, who.user);
  });
  return {};
}

/**
 * Who typed the command, and their Hub account — every card command needs both,
 * because cards read Google as the person, never as Oracle.
 * @returns {Promise<{ok: boolean, actor?: Object, user?: Object, spaceName?: string, threadName?: string, surface?: string}>}
 */
async function commandActor(evt, { resolveUser, signInReply }, command) {
  const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
  const threadName = evt.threadIsResourceName ? evt.threadId : null;
  const surface = evt.isDm ? 'chat_dm' : 'chat_space';
  const actor = {
    chatUserId: evt.actorChatId || evt.senderChatId || null,
    name: evt.actorName || evt.senderDisplayName || null,
    email: evt.senderEmail || null
  };
  if (!actor.chatUserId || !spaceName) {
    console.log(`↩️  ${command} ignored — reason: no_person_or_space`);
    return { ok: false };
  }

  let user = null;
  try {
    if (actor.email && resolveUser) user = await resolveUser(actor.email);
    if (!user && resolveUser) {
      const person = await resolvePerson(actor.chatUserId, { displayName: actor.name });
      if (person?.email) user = await resolveUser(person.email);
    }
  } catch (err) {
    console.warn(`⚠️  ${command} user lookup failed — code: ${codeOf(err)}`);
  }

  if (!user?.google_refresh_token) {
    console.log(`↩️  ${command} not run — reason: not_signed_in`);
    try {
      await postMessage({
        spaceName, threadName,
        text: signInReply ? signInReply() : `Sign in to the Hub once, then try ${command} again.`,
        privateTo: surface === 'chat_dm' ? null : actor.chatUserId
      });
    } catch (err) {
      console.warn(`⚠️  ${command} reply failed — code: ${codeOf(err)}`);
    }
    return { ok: false };
  }
  return { ok: true, actor, user, spaceName, threadName, surface };
}

async function runTrackCommand(evt, deps) {
  const found = await commandActor(evt, deps, '/track');
  if (!found.ok) return;
  const askText = String(evt.text || '').replace(/^\s*\/track\b/i, '').trim();
  await createTrack({
    trigger: 'command',
    actor: found.actor, userId: found.user.id,
    spaceName: found.spaceName, threadName: found.threadName, surface: found.surface,
    commandMessageName: evt.messageName, askText
  });
}

async function runMeetCommand(evt, deps) {
  const found = await commandActor(evt, deps, '/meet');
  if (!found.ok) return;
  await createMeet({
    trigger: 'command',
    actor: found.actor, userId: found.user.id,
    spaceName: found.spaceName, threadName: found.threadName, surface: found.surface,
    messageText: String(evt.text || '').replace(/^\s*\/meet\b/i, '').trim(),
    messageName: evt.messageName,
    // The people to invite are the ones @mentioned in the command itself.
    invitees: (evt.mentions || []).map(m => ({ chatUserId: m.chatUserId, name: m.displayName || m.name || null }))
  });
}

async function runWatchCommand(evt, deps) {
  const found = await commandActor(evt, deps, '/watch');
  if (!found.ok) return;
  // The post being watched — the one above the command, or the last thing said
  // in a DM — is read inside startWatch's background step, as the person who
  // typed the command.
  await startWatch({
    trigger: 'command',
    actor: found.actor, userId: found.user.id,
    spaceName: found.spaceName, threadName: found.threadName, surface: found.surface,
    messageText: String(evt.text || '').replace(/^\s*\/watch\b/i, '').trim(),
    messageName: evt.messageName
  });
}

/**
 * /review posts the existing "Track this as a review?" card. The thread's
 * conversation row is created first: the card carries that id (a foreign key),
 * and it is what "@Oracle yes" later confirms against.
 */
async function runReviewCommand(evt, deps) {
  const found = await commandActor(evt, deps, '/review');
  if (!found.ok) return;
  if (!found.threadName) {
    await postMessage({
      spaceName: found.spaceName,
      text: 'Use /review as a reply in the thread with the documents to review.',
      privateTo: found.surface === 'chat_dm' ? null : found.actor.chatUserId
    });
    return;
  }

  // In a DM every message is its own thread, so /review has nothing above it:
  // the request — and its Doc links — are in what was said just before.
  let subject = null;
  try {
    const { findSubject, confirmSubject } = await import('./subject.js');
    const looksRight = (text) => /docs\.google\.com|\breview\b/i.test(String(text));
    const seen = await findSubject({
      spaceName: found.spaceName,
      threadName: found.threadName,
      userIds: [found.user.id],
      triggerMessageName: evt.messageName,
      looksRight,
      maxAgeMs: found.surface === 'chat_dm' ? Infinity : 30 * 60 * 1000
    });
    if (seen.ok && seen.text && seen.from === 'recent') {
      if (!seen.sure) {
        await postMessage({
          spaceName: found.spaceName,
          threadName: found.threadName,
          text: confirmSubject('review request', seen.text),
          privateTo: found.surface === 'chat_dm' ? null : found.actor.chatUserId
        });
        console.log('🗂️  /review — result: subject_unclear');
        return;
      }
      subject = seen;
    }
  } catch (err) {
    console.warn(`⚠️  /review subject read failed — code: ${codeOf(err)}`);
  }

  try {
    const [{ conversationIdForEvent }, { createConversation }, { trackReview }] = await Promise.all([
      import('../api/chat-google.js'),
      import('../database/messages.js'),
      import('./review-card.js')
    ]);
    const { conversationId } = conversationIdForEvent(evt);
    await createConversation(conversationId, found.user.id, 'internal-oracle', 'Chat: /review');

    const outcome = await trackReview({}, {
      userId: found.user.id,
      conversationId,
      chatContext: {
        surface: found.surface,
        spaceName: found.spaceName,
        spaceDisplayName: evt.spaceDisplayName || null,
        senderChatId: found.actor.chatUserId,
        senderDisplayName: found.actor.name,
        // The request's own message, when it was found above the command, so the
        // review card attaches to it and its Doc links are the ones reviewed.
        messageName: subject?.message?.name || evt.messageName,
        threadName: found.threadName,
        mentions: (subject?.message?.mentions?.length ? subject.message.mentions : evt.mentions) || [],
        driveFiles: docLinks(subject?.text),
        // Deliberately empty: /review never counts as "they clearly asked", so
        // the card is always the question with a button, never a guess.
        messageText: ''
      }
    });
    console.log(`🗂️  /review — result: ${outcome?.asked ? 'asked' : (outcome?.already_tracked ? 'already_tracked' : 'other')}`);
  } catch (err) {
    console.warn(`⚠️  /review failed — code: ${codeOf(err)}`);
    await postMessage({
      spaceName: found.spaceName,
      threadName: found.threadName,
      text: 'I couldn’t set that up — try again in a moment.',
      privateTo: found.surface === 'chat_dm' ? null : found.actor.chatUserId
    });
  }
}

registerAppCommand(TRACK_COMMAND_ID, handleTrackCommand);
registerAppCommand(MEET_COMMAND_ID, handleMeetCommand);
registerAppCommand(WATCH_COMMAND_ID, handleWatchCommand);
registerAppCommand(HELP_COMMAND_ID, handleHelpCommand);
registerAppCommand(REVIEW_COMMAND_ID, handleReviewCommand);
registerAppCommand(LEARN_COMMAND_ID, handleLearnCommand);
