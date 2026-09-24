/**
 * Button presses on tracked cards (and on digest items)
 *
 * The press is answered at once — database work only — with the add-on
 * updateMessageAction, so the card changes in place while the presser watches:
 * no new message, no ping. Everything slow happens after the answer: reading
 * the real systems (Doc comments, the confirmation gate), drafting, HubSpot.
 * The card is then patched through the Chat API, so it ends up right even if
 * Chat dropped the synchronous update.
 *
 * Rules:
 * - Personal buttons change only the presser's own status. Someone not on the
 *   card who presses one takes the review.
 * - Shared buttons act on the card for everyone.
 * - A press that cannot apply gets a short private reply saying why.
 * - Every press is logged (who, what, when, and whether it changed anything);
 *   the card shows the latest press that changed something.
 * - Real systems win: each press refreshes the card from its sources, after
 *   answering.
 * - A closed card is frozen: the press is logged and nothing changes.
 */

import * as store from '../database/tracked-cards-store.js';
import { cardTypeOf } from './types.js';
import { FOUNDATION_ACTIONS } from './registry.js';
import { renderCard, rerenderCard, tellPresser } from './update.js';
import { updateMessageResponse } from './render.js';
import { resolvePerson, timeZoneFor, localClock } from './people.js';
import { buildDigest, renderDigest } from './notify.js';

// Chat allows 30 s. A press that is still not answered by this point (a stuck
// database) is acknowledged with an empty body, which Chat accepts, and the
// card is patched when the work finishes.
const ANSWER_BUDGET_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMED_OUT = Symbol('timed out');

// Work started after a press. Tracked so tests (and a graceful shutdown) can wait.
const inFlight = new Set();

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/** Run work after the answer; whenCardsIdle() waits for it. */
export function runInBackground(label, work) {
  return inBackground(label, work);
}

function inBackground(label, work) {
  const p = Promise.resolve()
    .then(work)
    .catch(err => console.warn(`⚠️  Tracked card ${label} failed — code: ${codeOf(err)}`))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
  return p;
}

/** Resolves once no post-press work is running. */
export async function whenCardsIdle() {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/**
 * After the answer: refresh from real systems, run the slow part of the action,
 * then patch the card message if anything may have changed.
 */
function afterPress(cardId, type, { background = null, patch = false } = {}) {
  return inBackground('update', async () => {
    let changed = patch;
    const card = await store.getCard(cardId);
    if (card && ['open', 'stale'].includes(card.status) && type.refresh) {
      try {
        changed = (await type.refresh(card, { reason: 'press' })).changed || changed;
      } catch (err) {
        console.warn(`⚠️  Tracked card refresh failed — code: ${codeOf(err)}`);
      }
    }
    if (background) {
      try {
        await background();
      } finally {
        changed = true;
      }
    }
    if (changed) await rerenderCard(cardId);
  });
}

// Foundation presses that cannot apply, and what the presser is told.
const FOUNDATION_REPLIES = {
  closed: 'This card is closed, so nothing changed.',
  not_a_participant: 'You’re not on this card, so there’s nothing to mute.',
  'card.close': 'Only the requester can close this card.',
  'card.keep': 'Only the requester can keep this card open.'
};

/**
 * Everything after an action was applied, for every way in (a button, a dialog,
 * a typed "@Oracle …" command, the listened-space hook): log it, count it as
 * activity, answer privately if it could not apply, then refresh, run the slow
 * part and patch the card — all after the caller has answered.
 * @returns {Promise<string>} the logged result
 */
export async function finishPress(card, type, actor, action, outcome, now = new Date(), { fromDigest = false } = {}) {
  const result = outcome.ignored || (outcome.changed ? 'changed' : 'unchanged');
  await store.logClick(card.id, actor, action, now, result);

  // Work on the card counts as activity (and reopens a stale card). Muting does not.
  if (outcome.changed && action !== 'card.mute' && action !== 'card.close') {
    await store.touchActivity(card.id, now);
  }

  // Any change is also patched through the API — the card's own message when
  // the press was on the digest, and a safety net when Chat drops the
  // synchronous update. A mute changes nothing others see.
  if (outcome.reply && !fromDigest) inBackground('reply', () => tellPresser(card, actor, outcome.reply));
  afterPress(card.id, type, {
    background: outcome.background || null,
    patch: outcome.changed && action !== 'card.mute'
  });
  return result;
}

/**
 * @param {Object} evt - normalizeChatEvent() result for a buttonClicked event
 * @param {Date} [now]
 * @returns {Promise<Object>} synchronous response body ({} when there is nothing to show)
 */
export async function handleCardClick(evt, now = new Date()) {
  const startedAt = Date.now();
  let timer;
  const answer = pressAnswer(evt, now, startedAt);
  const result = await Promise.race([
    answer,
    new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ANSWER_BUDGET_MS); })
  ]).finally(() => clearTimeout(timer));

  if (result === TIMED_OUT) {
    console.warn(`⚠️  Tracked card press not answered in ${ANSWER_BUDGET_MS}ms — acknowledged, card will be patched`);
    inBackground('late press', () => answer);
    return {};
  }
  return result;
}

async function pressAnswer(evt, now, startedAt) {
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
  const fromDigest = params.from === 'digest';
  resolvePerson(actor.chatUserId, { email: actor.email, displayName: actor.name }).catch(() => {});

  try {
    let outcome;
    if (card.status === 'closed') {
      outcome = { changed: false, ignored: 'closed', reply: FOUNDATION_REPLIES.closed };
    } else if (action === 'card.mute') {
      const muted = await store.setMuted(card.id, actor.chatUserId, true);
      outcome = muted
        ? { changed: true, notice: `Muted: ${card.title}` }
        : { changed: false, ignored: 'not_a_participant', reply: FOUNDATION_REPLIES.not_a_participant };
    } else if (action === 'card.keep' || action === 'card.close') {
      if (actor.chatUserId !== card.owner_chat_id) {
        outcome = { changed: false, ignored: 'not_the_owner', reply: FOUNDATION_REPLIES[action] };
      } else if (action === 'card.close') {
        await store.closeCard(card.id, 'closed_by_owner', now);
        outcome = { changed: true, notice: `Closed: ${card.title}` };
      } else {
        outcome = { changed: true, notice: `Kept open: ${card.title}` };
      }
    } else {
      outcome = await type.handleAction({ card, actor, action, now, params });
    }

    const result = await finishPress(card, type, actor, action, outcome, now, { fromDigest });

    let response;
    let kind;
    if (fromDigest) {
      // The pressed message is the digest: answer with the digest.
      const person = await store.getPerson(actor.chatUserId);
      const { date } = localClock(now, await timeZoneFor(person, now));
      const digest = await buildDigest(actor.chatUserId, date, now);
      response = updateMessageResponse(
        await renderDigest(actor.chatUserId, digest, date, outcome.notice || outcome.reply || null)
      );
      kind = 'digest';
    } else {
      // Every other press is on the card itself: answer with the card.
      const current = await store.getCard(card.id);
      if (evt.messageName && current.message_name && evt.messageName !== current.message_name) {
        console.log('🗂️  Tracked card press on a different message than the stored card — answering with the card');
        inBackground('card update', () => rerenderCard(card.id));
      }
      response = updateMessageResponse(await renderCard(current));
      kind = 'card';
    }

    console.log(`🗂️  Tracked card click — type: ${card.card_type}, action: ${action}, result: ${result}${outcome.claimed ? ' (claimed)' : ''}, response: ${kind}, ms: ${Date.now() - startedAt}`);
    return response;
  } catch (err) {
    // Still answer with the card as it stands: an empty body tells the presser nothing.
    console.error(`❌ Tracked card press failed — code: ${codeOf(err)}`);
    try {
      return updateMessageResponse(await renderCard(await store.getCard(card.id)));
    } catch {
      return {};
    }
  }
}
