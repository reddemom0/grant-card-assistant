/**
 * Filing sweep cards (src/services/filing-sweep.js)
 *
 * A sweep card is the ordinary file_move_rename confirm card
 * (src/cards/confirm-card.js) with Skip in place of Cancel. Confirm goes
 * through handlePendingClick unchanged. Skip ("sweep.skip") lands here: only
 * the person the suggestion was sent to may skip it; the pending action is
 * declined and the suggestion is logged as skipped, so the file is never
 * suggested again.
 */

import { query } from '../database/connection.js';
import { declinePendingAction } from '../tools/pending-actions.js';
import { renderConfirmCard } from './confirm-card.js';
import { postMessage, patchCard } from './chat-api.js';
import { resolvePerson } from './people.js';
import { updateMessageResponse } from './render.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function skipButton(suggestionId) {
  return { text: 'Skip', params: { action: 'sweep.skip', suggestionId } };
}

/** The card for one suggestion: Confirm runs the move, Skip leaves the file where it is. */
export function renderSweepCard(action, suggestionId, { askerName = null } = {}) {
  return renderConfirmCard(action, { askerName, secondary: skipButton(suggestionId) });
}

/** What a press on Skip does to a suggestion, given who pressed it. Pure, for tests. */
export function skipDecision(suggestion, presserUserId) {
  if (!suggestion) return 'unknown';
  if (presserUserId === null || presserUserId === undefined || Number(presserUserId) !== Number(suggestion.recipient_user_id)) return 'not_allowed';
  if (suggestion.status !== 'suggested') return 'settled';
  return 'skip';
}

export async function handleSweepClick(evt) {
  const params = evt.parameters || {};
  if (params.action !== 'sweep.skip' || !UUID.test(String(params.suggestionId || '')) || !evt.actorChatId) return {};
  const r = await query('SELECT * FROM filing_sweep_suggestions WHERE id = $1', [params.suggestionId]).catch(() => ({ rows: [] }));
  const suggestion = r.rows[0];
  const person = await resolvePerson(evt.actorChatId, { email: evt.actorEmail, displayName: evt.actorName }).catch(() => null);
  const decision = skipDecision(suggestion, person?.user_id ?? null);
  if (decision === 'unknown') return {};
  if (decision === 'not_allowed') {
    await postMessage({
      spaceName: evt.spaceId,
      threadName: evt.threadIsResourceName ? evt.threadId : null,
      text: `Only ${suggestion.recipient_email} can skip this.`,
      privateTo: evt.isDm ? null : evt.actorChatId
    }).catch(() => {});
    return {};
  }

  const action = suggestion.pending_action_id
    ? (await query('SELECT * FROM pending_actions WHERE id = $1', [suggestion.pending_action_id])).rows[0]
    : null;
  if (decision === 'skip') {
    if (action) await declinePendingAction({ actionId: action.id, userId: person.user_id, chatUserId: evt.actorChatId });
    await query(`UPDATE filing_sweep_suggestions SET status = 'skipped', resolved_at = NOW() WHERE id = $1 AND status = 'suggested'`, [suggestion.id]);
  }
  if (!action) return {};
  const state = decision === 'skip' ? 'cancelled' : ({ confirmed: 'done', failed: 'failed' }[suggestion.status] || 'cancelled');
  const detail = decision === 'skip' || suggestion.status === 'skipped' ? 'skipped; the file stays where it is' : null;
  const cardsV2 = renderConfirmCard(action, { state, detail, askerName: suggestion.recipient_email });
  if (evt.messageName) patchCard(evt.messageName, cardsV2).catch(() => {});
  console.log(`🗂️  Filing sweep card press — action: skip, result: ${decision}`);
  return updateMessageResponse(cardsV2);
}
