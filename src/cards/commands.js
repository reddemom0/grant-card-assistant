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
 */

import { registerAppCommand } from './registry.js';
import { createTrack } from './track-card.js';
import { resolvePerson } from './people.js';
import { postMessage } from './chat-api.js';
import { runInBackground } from './actions.js';

export const TRACK_COMMAND_ID = String(process.env.CHAT_TRACK_COMMAND_ID || '1');

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

async function runTrackCommand(evt, { resolveUser, signInReply }) {
  const spaceName = evt.spaceIsResourceName ? evt.spaceId : null;
  const threadName = evt.threadIsResourceName ? evt.threadId : null;
  const surface = evt.isDm ? 'chat_dm' : 'chat_space';
  const actor = {
    chatUserId: evt.actorChatId || evt.senderChatId || null,
    name: evt.actorName || evt.senderDisplayName || null,
    email: evt.senderEmail || null
  };
  if (!actor.chatUserId || !spaceName) {
    console.log('↩️  /track ignored — reason: no_person_or_space');
    return;
  }

  let user = null;
  try {
    if (actor.email && resolveUser) user = await resolveUser(actor.email);
    if (!user && resolveUser) {
      const person = await resolvePerson(actor.chatUserId, { displayName: actor.name });
      if (person?.email) user = await resolveUser(person.email);
    }
  } catch (err) {
    console.warn(`⚠️  /track user lookup failed — code: ${codeOf(err)}`);
  }

  if (!user?.google_refresh_token) {
    console.log('↩️  /track not run — reason: not_signed_in');
    try {
      await postMessage({
        spaceName, threadName,
        text: signInReply ? signInReply() : 'Sign in to the Hub once, then try /track again.',
        privateTo: surface === 'chat_dm' ? null : actor.chatUserId
      });
    } catch (err) {
      console.warn(`⚠️  /track reply failed — code: ${codeOf(err)}`);
    }
    return;
  }

  const askText = String(evt.text || '').replace(/^\s*\/track\b/i, '').trim();
  await createTrack({
    trigger: 'command', actor, userId: user.id, spaceName, threadName, surface,
    commandMessageName: evt.messageName, askText
  });
}

registerAppCommand(TRACK_COMMAND_ID, handleTrackCommand);
