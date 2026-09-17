/**
 * Render a tracked card from its stored state, and push it to its own message.
 *
 * Patching never notifies anyone — this is how every change after a button
 * press, and every daily refresh, reaches the card.
 */

import * as store from '../database/tracked-cards-store.js';
import { cardTypeOf } from './types.js';
import { patchCard } from './chat-api.js';

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
