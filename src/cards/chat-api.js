/**
 * Chat API calls for tracked cards, as the Oracle Chat app (chat.bot)
 *
 * Cards are created with app authentication — the only way a card can carry
 * buttons — and later changes patch that same message, which Chat allows only
 * for messages the app created. Nothing here re-posts a card.
 *
 * Kept apart from src/api/chat-google.js on purpose: that module pulls in the
 * whole agent loop, and chat-google loads the card code in turn.
 */

import { google } from 'googleapis';

function chatClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/chat.bot']
  });
  return google.chat({ version: 'v1', auth });
}

/**
 * Post a new message: a card, text, or both. A thread name makes it a reply in
 * that thread; without one it starts a new top-level message.
 * @returns {Promise<string>} the created message's resource name
 */
export async function postMessage({ spaceName, threadName = null, text = null, cardsV2 = null }) {
  const requestBody = {};
  if (text) {
    requestBody.text = text;
    requestBody.markupSyntax = 'MARKUP_SYNTAX_MARKDOWN';
  }
  if (cardsV2) requestBody.cardsV2 = cardsV2;
  if (threadName) requestBody.thread = { name: threadName };

  const res = await chatClient().spaces.messages.create({
    parent: spaceName,
    ...(threadName ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : {}),
    requestBody
  });
  return res.data?.name || null;
}

/** Replace the cards on a message Oracle posted. Never notifies anyone. */
export async function patchCard(messageName, cardsV2) {
  await chatClient().spaces.messages.patch({
    name: messageName,
    updateMask: 'cardsV2',
    requestBody: { cardsV2 }
  });
}

/**
 * The DM space between Oracle and a person, or null when none exists yet — the
 * app cannot create one itself; the person has to message Oracle first.
 */
export async function findDmSpace(chatUserId) {
  try {
    const res = await chatClient().spaces.findDirectMessage({ name: chatUserId });
    return res.data?.name || null;
  } catch (err) {
    const status = Number(err?.response?.status ?? err?.code);
    if (status === 404) return null;
    throw err;
  }
}
