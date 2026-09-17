/**
 * Button presses on tracked cards (and on digest items)
 *
 * Runs inside Chat's 30-second window and answers with the add-on
 * updateMessageAction, so the card changes in place — no new message, no ping.
 * Anything slower (drafting, HubSpot) runs afterwards and patches the card.
 *
 * Rules:
 * - Personal buttons change only the presser's own status; a press by someone
 *   who has no status on the card changes nothing (it is still logged).
 * - Shared buttons act on the card for everyone.
 * - Every press is logged (who, what, when, and whether it changed anything);
 *   the card shows the latest press that changed something.
 * - Real systems win: each press refreshes the card from its sources first,
 *   within a time budget.
 * - A closed card is frozen: the press is logged and nothing changes.
 */

import * as store from '../database/tracked-cards-store.js';
import { cardTypeOf } from './types.js';
import { FOUNDATION_ACTIONS } from './registry.js';
import { renderCard, rerenderCard } from './update.js';
import { updateMessageResponse } from './render.js';
import { resolvePerson, timeZoneFor, localClock } from './people.js';
import { buildDigest, renderDigest } from './notify.js';

const REFRESH_BUDGET_MS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMED_OUT = Symbol('timed out');

// Work started after a press. Tracked so tests (and a graceful shutdown) can wait.
const inFlight = new Set();

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

function inBackground(label, cardId, work) {
  const p = Promise.resolve()
    .then(work)
    .then(() => rerenderCard(cardId))
    .catch(err => console.warn(`⚠️  Tracked card ${label} failed — code: ${codeOf(err)}`))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
  return p;
}

/** Resolves once no post-click work is running. */
export async function whenCardsIdle() {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

function withinBudget(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {Object} evt - normalizeChatEvent() result for a buttonClicked event
 * @param {Date} [now]
 * @returns {Promise<Object>} synchronous response body ({} when there is nothing to show)
 */
export async function handleCardClick(evt, now = new Date()) {
  const params = evt.parameters || {};
  const { cardId, action } = params;
  if (!cardId || !UUID.test(cardId) || !action || !evt.actorChatId) {
    console.log('↩️  Tracked card click ignored — reason: missing_parameters');
    return {};
  }

  const card = await store.getCard(cardId);
  const type = card && cardTypeOf(card);
  const spec = type && (FOUNDATION_ACTIONS[action] || type.actions[action]);
  if (!card || !type || !spec) {
    console.log(`↩️  Tracked card click ignored — reason: ${!card ? 'card_not_found' : 'unknown_action'}`);
    return {};
  }

  const actor = { chatUserId: evt.actorChatId, name: evt.actorName || null, email: evt.actorEmail || null };
  resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name }).catch(() => {});

  let outcome;
  if (card.status === 'closed') {
    outcome = { changed: false, ignored: 'closed' };
  } else if (action === 'card.mute') {
    const muted = await store.setMuted(card.id, actor.chatUserId, true);
    outcome = muted
      ? { changed: true, notice: `Muted: ${card.title}` }
      : { changed: false, ignored: 'not_a_participant' };
  } else if (action === 'card.keep' || action === 'card.close') {
    if (actor.chatUserId !== card.owner_chat_id) {
      outcome = { changed: false, ignored: 'not_the_owner' };
    } else if (action === 'card.close') {
      await store.closeCard(card.id, 'closed_by_owner', now);
      outcome = { changed: true, notice: `Closed: ${card.title}` };
    } else {
      outcome = { changed: true, activity: true, notice: `Kept open: ${card.title}` };
    }
  } else {
    outcome = await type.handleAction({ card, actor, action, now });
  }

  const result = outcome.ignored || (outcome.changed ? 'changed' : 'unchanged');
  await store.logClick(card.id, actor, action, now, result);

  // Work on the card counts as activity (and reopens a stale card). Muting does not.
  if (outcome.changed && action !== 'card.mute' && action !== 'card.close') {
    await store.touchActivity(card.id, now);
  }

  // Real systems win: refresh from sources before answering, within budget.
  let current = await store.getCard(card.id);
  if (['open', 'stale'].includes(current.status) && type.refresh) {
    const refreshing = type.refresh(current);
    const result = await withinBudget(refreshing, REFRESH_BUDGET_MS);
    if (result === TIMED_OUT) inBackground('refresh', card.id, () => refreshing);
  }

  if (outcome.background) inBackground('follow-up', card.id, outcome.background);

  console.log(`🗂️  Tracked card click — type: ${card.card_type}, action: ${action}, result: ${result}`);

  // A press on a digest item: the pressed message is the digest.
  if (params.from === 'digest') {
    if (action !== 'card.mute') inBackground('card update', card.id, () => {});
    const person = await resolvePerson(actor.chatUserId);
    const { date } = localClock(now, await timeZoneFor(person, now));
    const digest = await buildDigest(actor.chatUserId, date);
    return updateMessageResponse(await renderDigest(actor.chatUserId, digest, date, outcome.notice || null));
  }

  // A press on some other message of ours: bring the card itself up to date instead.
  if (evt.messageName && current.message_name && evt.messageName !== current.message_name) {
    inBackground('card update', card.id, () => {});
    return {};
  }

  current = await store.getCard(card.id);
  return updateMessageResponse(await renderCard(current));
}
