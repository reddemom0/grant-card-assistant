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

import { getPendingAction, runPendingAction } from '../tools/pending-actions.js';

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

  if (!run.ok) {
    return { replyText: "That proposal is no longer available — ask me again and I'll re-propose it." };
  }

  if (run.result?.success === false) {
    return { replyText: `I tried: ${run.summary}\n\nIt failed: ${run.result.error || 'unknown error'}` };
  }

  return { replyText: `Done: ${run.summary}` };
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
