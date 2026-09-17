/**
 * The daily pass over tracked cards
 *
 * 1. Refresh every open or stale card from its real sources; patch the card
 *    only when something changed. Closed cards are frozen and skipped.
 * 2. Open cards with no human activity for 30 days become stale — the owner's
 *    digest asks Close / Keep.
 * 3. Stale cards with no answer for 14 more days close themselves and freeze.
 * 4. Questions nobody answered ("track this?", "which Docs?") close after 30
 *    idle days, so an old question never captures a new request.
 * 5. Completed cards close 7 days after completion at the latest (a card type
 *    may close one sooner — a review closes once its HubSpot note is settled).
 * 6. Closed cards of every type are deleted 12 months after closing, like the
 *    stored Chat copy.
 *
 * Refreshing does not count as activity; only people do.
 */

import * as store from '../database/tracked-cards-store.js';
import { cardTypeOf } from './types.js';
import { rerenderCard } from './update.js';

export const STALE_AFTER_DAYS = 30;
export const CLOSE_AFTER_STALE_DAYS = 14;
export const CLOSE_AFTER_COMPLETED_DAYS = 7;
export const DELETE_CLOSED_AFTER_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

async function refreshCards(cards, reason = 'daily') {
  const counts = { cards: 0, changed: 0, failed: 0 };
  for (const card of cards) {
    counts.cards++;
    try {
      const type = cardTypeOf(card);
      const result = type?.refresh ? await type.refresh(card, { reason }) : { changed: false };
      if (result.changed) {
        counts.changed++;
        await rerenderCard(card.id);
      }
    } catch (err) {
      counts.failed++;
      console.warn(`⚠️  Tracked card refresh failed — code: ${codeOf(err)}`);
    }
  }
  return counts;
}

export async function refreshLiveCards() {
  return refreshCards(await store.listCardsByStatus(['open', 'stale']));
}

/**
 * Bring a thread's cards up to date straight away — after "@Oracle yes" there
 * ran a proposal a card is waiting on, so the card need not wait for a press or
 * the daily pass.
 */
export async function refreshCardsForConversation(conversationId) {
  if (!conversationId) return { cards: 0, changed: 0, failed: 0 };
  return refreshCards(await store.liveCardsForConversation(conversationId), 'confirmation');
}

/**
 * Someone wrote in a card's thread (an @Oracle message): that is activity, and
 * a stale card becomes open again. Never throws.
 */
export async function touchCardsInThread(threadName, at = new Date()) {
  if (!threadName) return 0;
  let reopened = 0;
  try {
    for (const card of await store.liveCardsInThread(threadName)) {
      if (!card?.id || !card.card_type) continue;
      await store.touchActivity(card.id, at);
      if (card.status === 'stale') {
        reopened++;
        await rerenderCard(card.id);
      }
    }
  } catch (err) {
    console.warn(`⚠️  Tracked card thread activity failed — code: ${codeOf(err)}`);
  }
  return reopened;
}

export async function applyLifecycle(now = new Date()) {
  const staled = await store.markStaleBefore(new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS), now);
  for (const card of staled) await rerenderCard(card.id);

  const closed = await store.closeStaleBefore(new Date(now.getTime() - CLOSE_AFTER_STALE_DAYS * DAY_MS), now);
  for (const card of closed) await rerenderCard(card.id);

  const offers = await store.closeOffersBefore(new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS), now);
  for (const card of offers) await rerenderCard(card.id);

  const completed = await store.closeCompletedBefore(new Date(now.getTime() - CLOSE_AFTER_COMPLETED_DAYS * DAY_MS), now);
  for (const card of completed) await rerenderCard(card.id);

  const deleted = await store.purgeClosedBefore(new Date(now.getTime() - DELETE_CLOSED_AFTER_DAYS * DAY_MS));

  return { staled: staled.length, closed: closed.length, offersClosed: offers.length, completedClosed: completed.length, deleted };
}

export async function runDailyCardPass(now = new Date()) {
  const refreshed = await refreshLiveCards();
  const lifecycle = await applyLifecycle(now);
  console.log(
    `🗂️  Tracked cards daily pass — refreshed: ${refreshed.cards}, changed: ${refreshed.changed}, ` +
    `failed: ${refreshed.failed}, now stale: ${lifecycle.staled}, auto-closed: ${lifecycle.closed}, ` +
    `offers closed: ${lifecycle.offersClosed}, completed closed: ${lifecycle.completedClosed}, deleted: ${lifecycle.deleted}`
  );
  return { refreshed, lifecycle };
}
