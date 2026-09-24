/**
 * Render a tracked card from its stored state, and push it to its own message.
 *
 * Patching never notifies anyone — this is how every change after a button
 * press, and every daily refresh, reaches the card.
 */

import * as store from '../database/tracked-cards-store.js';
import { cardTypeOf } from './types.js';
import { patchCard, postMessage } from './chat-api.js';

/** cardsV2 for a card as it stands now. */
export async function renderCard(card) {
  const type = cardTypeOf(card);
  if (!type) return null;
  const [participants, latest] = await Promise.all([
    store.getParticipants(card.id),
    store.latestClick(card.id)
  ]);
  return type.render(card, participants, latest);
}

/**
 * Re-render a card and patch its message. Returns false when there is nothing
 * to patch (no message yet) or the patch failed; failures are logged by code.
 */
export async function rerenderCard(cardId) {
  const card = await store.getCard(cardId);
  if (!card?.message_name) return false;
  const cardsV2 = await renderCard(card);
  if (!cardsV2) return false;
  try {
    await patchCard(card.message_name, cardsV2);
    return true;
  } catch (err) {
    console.warn(`⚠️  Tracked card update failed — code: ${err?.response?.status ?? err?.code ?? 'unknown'}`);
    return false;
  }
}

/**
 * A short reply only the presser sees, in the card's thread — for a press that
 * could not apply. In a DM the thread is already private, so it is a plain
 * reply there. Never throws; the failure is logged by code.
 */
export async function tellPresser(card, actor, text) {
  if (!card?.space_name || !actor?.chatUserId || !text) return false;
  const dm = card.data?.surface === 'chat_dm';
  try {
    await postMessage({
      spaceName: card.space_name,
      // A card filed under a placeholder thread (a DM lesson card) replies unthreaded.
      threadName: card.data?.noThread ? null : card.thread_name,
      text,
      privateTo: dm ? null : actor.chatUserId
    });
    console.log(`🗂️  Private reply to a press — delivered, private: ${!dm}`);
    return true;
  } catch (err) {
    console.warn(`⚠️  Private reply to a press failed — code: ${err?.response?.status ?? err?.code ?? 'unknown'}`);
    return false;
  }
}
