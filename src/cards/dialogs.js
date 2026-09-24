/**
 * Card dialogs — Pass to…, Someone promised…, Record decision, Submit
 * response, Remove people… on the /track card.
 *
 * Add-on Chat app dialogs are a Developer Preview feature, and one Google
 * reference says the button setting that opens them strips the card, so they
 * are used only while TRACK_DIALOGS_ENABLED=true. The same actions always work
 * typed in the thread (track-card.js).
 *
 * A dialog request is answered with the dialog; a submit is applied through the
 * same press path as a button (logged, "Last update", patched through the Chat
 * API) and answered by closing the dialog with a short notification — whether a
 * close can also carry a message update is not documented.
 */

import * as store from '../database/tracked-cards-store.js';
import { cardTypeOf } from './types.js';
import { finishPress } from './actions.js';
import { finalizeCards, dialogsEnabled } from './render.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_BUDGET_MS = 20_000;

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

/** Close the dialog, optionally with a short plain-text notification. */
export function closeDialog(text = null) {
  return {
    action: {
      navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }],
      ...(text ? { notification: { text } } : {})
    }
  };
}

/** Open a dialog: a bare card, cleaned like every other card. */
export function openDialog(card) {
  const [wrapped] = finalizeCards([{ cardId: 'dialog', card }]);
  return { action: { navigations: [{ pushCard: wrapped.card }] } };
}

/**
 * @param {Object} evt - normalizeChatEvent() result with isDialogEvent / dialogEventType / formInputs
 * @returns {Promise<Object>} synchronous response body
 */
export async function handleCardDialog(evt, now = new Date()) {
  const params = evt.parameters || {};
  const { cardId, action } = params;
  const card = cardId && UUID.test(cardId) ? await store.getCard(cardId) : null;
  const type = card && cardTypeOf(card);
  if (!dialogsEnabled(type)) return closeDialog();
  // Any card type may own dialogs: it marks the action `dialog: true` and
  // exports dialogFor / submitDialog.
  if (!card || !type?.dialogFor || !type.actions?.[action]?.dialog || !evt.actorChatId) {
    console.log('↩️  Card dialog ignored — reason: not_a_card_dialog');
    return closeDialog();
  }
  const actor = { chatUserId: evt.actorChatId, name: evt.actorName || null, email: evt.actorEmail || null };
  const live = ['open', 'stale'].includes(card.status);

  if (evt.dialogEventType === 'REQUEST_DIALOG') {
    if (!live) return closeDialog('This card is closed.');
    let timer;
    try {
      const dialog = await Promise.race([
        type.dialogFor(card, action, actor, params),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), OPEN_BUDGET_MS); })
      ]);
      return dialog ? openDialog(dialog) : closeDialog('Couldn’t open that — try again.');
    } catch (err) {
      console.warn(`⚠️  Card dialog failed to open — code: ${codeOf(err)}`);
      return closeDialog('Couldn’t open that — try again.');
    } finally {
      clearTimeout(timer);
    }
  }

  if (evt.dialogEventType === 'SUBMIT_DIALOG') {
    const outcome = live
      ? await type.submitDialog(card, action, actor, evt.formInputs || {}, now, params)
      : { changed: false, ignored: 'closed', reply: 'This card is closed, so nothing changed.' };
    // The notification carries the answer; no separate private reply.
    await finishPress(card, type, actor, action, { ...outcome, reply: null }, now);
    console.log(`🗂️  Card dialog submitted — action: ${action}, result: ${outcome.ignored || (outcome.changed ? 'changed' : 'unchanged')}`);
    const saved = type.actions[action]?.saved || 'Saved';
    return closeDialog(outcome.changed ? saved : (outcome.reply || 'Nothing changed.'));
  }

  return closeDialog();
}
