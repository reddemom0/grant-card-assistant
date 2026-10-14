/**
 * Confirmation interception — shared by Google Chat and the web hub
 *
 * A confirmation is recognised by CODE, before the model is involved. If the
 * whole user message is a confirmation word and a live proposal exists, the
 * saved action runs and the model is never called: it cannot decide that "yes"
 * meant something else, and it cannot rebuild the action differently from the
 * one the user read.
 *
 * Anything else returns null and the caller proceeds to the agent as normal.
 */

import { getPendingAction, runPendingAction, savePendingAction, summarizeAction } from '../tools/pending-actions.js';
import { query } from '../database/connection.js';

/**
 * The complete set. Deliberately short and unambiguous — every entry means
 * "do the thing I was just shown" and nothing else.
 */
const CONFIRM_WORDS = new Set([
  'yes', 'y', 'confirm', 'confirmed', 'go ahead', 'do it', 'approve', 'approved'
]);

/**
 * True when the ENTIRE message is a confirmation word.
 *
 * Whole-message only, on purpose: "yes, but change the amount first" is not a
 * confirmation, and neither is a sentence that merely contains "yes". Trailing
 * punctuation and surrounding whitespace are ignored; internal spacing is
 * collapsed so "go  ahead" still matches.
 */
export function isConfirmWord(text) {
  if (typeof text !== 'string') return false;
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!…]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return CONFIRM_WORDS.has(normalized);
}

/**
 * Handle a message if it is a confirmation.
 *
 * @param {Object} params
 * @param {string} params.conversationId
 * @param {number} params.userId - whoever sent THIS message; anyone in the
 *   conversation may confirm, and they are recorded as confirmed_by
 * @param {string} params.text
 * @param {string} [params.agentType]
 * @returns {Promise<{replyText: string}|null>} null = not a confirmation, carry on
 */
export async function tryHandleConfirmation({ conversationId, userId, text, agentType = 'internal-oracle' }) {
  if (!isConfirmWord(text)) return null;

  let pending;
  try {
    pending = await getPendingAction(conversationId);
  } catch (err) {
    // Most likely cause: migration 025 has not been run. Say so plainly rather
    // than handing the message to the model, which would have no idea either.
    console.error('❌ Could not read pending actions:', err.message);
    return { replyText: "I couldn't check whether anything is waiting for confirmation. Nothing was run." };
  }

  if (!pending.action) {
    return {
      replyText: pending.expired
        ? "That proposal expired — ask me again and I'll re-propose it."
        : 'Nothing is waiting for confirmation.'
    };
  }

  const run = await runPendingAction({ actionId: pending.action.id, userId, agentType });

  // Asker-only tools (a Drive move): someone else said "yes". Nothing ran and
  // the proposal stays open for the person who may confirm it.
  if (!run.ok && run.reason === 'not_allowed') {
    return { replyText: `Only ${run.name} can confirm this.` };
  }

  if (!run.ok) {
    return { replyText: "That proposal is no longer available — ask me again and I'll re-propose it." };
  }

  if (run.result?.success === false) {
    return { replyText: `I tried: ${run.summary}\n\nIt failed: ${run.result.error || 'unknown error'}` };
  }

  // A Drive move returns an undo token; it goes into the saved reply so a later
  // "undo that" can find it.
  const undo = run.result?.undo_token ? `\n\nTo undo it, ask me to undo that move (undo token ${run.result.undo_token}).` : '';
  return { replyText: `Done: ${run.summary}${undo}` };
}

/**
 * Id of the proposal currently awaiting confirmation, if any.
 * Callers capture this BEFORE running the agent so they can tell a proposal made
 * during this turn from one that was already sitting there.
 */
export async function currentPendingId(conversationId) {
  try {
    const { action } = await getPendingAction(conversationId);
    return action?.id || null;
  } catch {
    return null;
  }
}

/**
 * The confirmation notice to append to a reply, when this turn produced a new
 * proposal. Returns null when nothing new is pending.
 *
 * The text comes from the stored summary — written by code from the saved input
 * — so the user approves the action itself rather than the model's description
 * of it.
 */
export async function proposalNotice(conversationId, previousActionId) {
  let action;
  try {
    ({ action } = await getPendingAction(conversationId));
  } catch {
    return null;
  }
  if (!action || action.id === previousActionId) return null;
  return `\n\n**Confirm before I run this:**\n${action.summary}\n\nReply "yes" and I'll do exactly that.`;
}

// ============================================================================
// "UNDO THAT" — caught by code
// ============================================================================

/**
 * True when the ENTIRE message asks to undo the last change, e.g. "undo that",
 * "please undo the move", "put it back". Anything longer goes to the model.
 */
export function isUndoRequest(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim().toLowerCase().replace(/[.!?…]+$/u, '').replace(/\s+/g, ' ').trim()
    .replace(/^(please|can you|could you|pls)\s+/, '').replace(/\s+please$/, '');
  return /^(undo( (that|it|this|the (last )?move|that move|the last change|that change))?|put it back|revert (that|it|the move))$/.test(t);
}

/**
 * Handle "undo that" without the model. Finds the newest move in this
 * conversation that can still be undone (drive_actions), checks it with
 * planUndo, and saves an undo proposal — the same proposal the model's
 * file_move_rename_undo call would save. The caller posts the confirm card.
 *
 * @returns {Promise<null|{replyText: string, action?: Object}>} null = not an undo request
 */
export async function tryHandleUndoRequest({ conversationId, userId, text }) {
  if (!isUndoRequest(text)) return null;

  let row;
  try {
    const r = await query(
      `SELECT id, undo_token, name_after, path_after FROM drive_actions
        WHERE conversation_id = $1 AND action = 'move_rename' AND result = 'done' AND undone_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    );
    row = r.rows[0];
  } catch (err) {
    console.error(`❌ Undo lookup failed — code: ${err?.code ?? 'unknown'}`);
    return { replyText: "I couldn't check the record of moves just now. Nothing was changed." };
  }
  if (!row) {
    return { replyText: "I can't find a move in this conversation that can still be undone. Nothing was changed." };
  }

  const { planUndo } = await import('../tools/drive-actions.js');
  const checked = await planUndo({ undo_token: row.undo_token });
  if (!checked.ok) return { replyText: `${checked.reason} Nothing was changed.` };

  const summary = summarizeAction('file_move_rename_undo', checked.plan);
  const action = await savePendingAction({
    conversationId, toolName: 'file_move_rename_undo', input: checked.plan, userId, summary
  });
  console.log(`🗂️  Undo request caught by code — drive_actions ${row.id}, proposal ${action.id}`);
  return { replyText: 'Here is the undo. Press Confirm to run it.', action };
}
