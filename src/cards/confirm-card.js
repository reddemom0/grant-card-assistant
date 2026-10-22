/**
 * Confirm card for asker-only gated actions (a Drive move/rename and its undo).
 *
 * Other gated tools are confirmed by a typed "yes" from anyone in the thread.
 * These two get a card instead, posted in place of the text notice
 * (runOracleAndReply in src/api/chat-google.js), showing the checked plan:
 * the file, from → to, old → new name, and any folders to be created (new).
 *
 * Who may press Confirm or Cancel is decided by canConfirm
 * (src/tools/pending-actions.js), which runPendingAction and
 * declinePendingAction also enforce. Anyone else gets a private
 * "Only <name> can confirm this." and the card stays as it is.
 *
 * Not a tracked card: the buttons carry the pending action's id, not a cardId,
 * and pressAnswer (src/cards/actions.js) hands `pending.*` presses here first.
 */

import { query } from '../database/connection.js';
import { ASKER_ONLY_TOOLS, canConfirm, runPendingAction, declinePendingAction } from '../tools/pending-actions.js';
import { saveMessage } from '../database/messages.js';
import { postMessage, patchCard } from './chat-api.js';
import { resolvePerson } from './people.js';
import { button, buttonRow, decorated, paragraph, esc, finalizeCards, updateMessageResponse } from './render.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const usesConfirmCard = (toolName) => ASKER_ONLY_TOOLS.has(toolName);

function planOf(action) {
  const raw = action?.tool_input;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/** Reply text after a typed "yes" (the user's "yes" is in the conversation just before it). */
export function doneText(run) {
  if (run.result?.success === false) return `I tried: ${run.summary}\n\nIt failed: ${run.result.error || 'unknown error'}`;
  const undo = run.result?.undo_token ? `\n\nTo undo it, ask me to undo that move (undo token ${run.result.undo_token}).` : '';
  return `Done: ${run.summary}${undo}`;
}

const SYSTEM_MARK = "[System event — recorded by Granted's systems, not typed by anyone]";

function vancouverNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} Vancouver time`;
}

/**
 * The note saved (role 'system') after a press on Confirm. The press happens on
 * the card, outside the conversation, so the model would otherwise see a
 * "Done" with nothing before it. This records it as an outside event, with the
 * drive_actions id and undo token, so a later "undo that" has evidence.
 */
export function systemEventText(run, { presserName = null, at = new Date() } = {}) {
  const who = presserName || 'The person who asked';
  if (run.result?.success === false) {
    return `${SYSTEM_MARK} ${who} pressed Confirm on the card at ${vancouverNow(at)}. It failed: ${String(run.result.error || 'unknown error').replace(/[.\s]+$/, '')}. Nothing changed.`;
  }
  const record = run.result?.action_id ? ` drive_actions record ${run.result.action_id}.` : '';
  const undo = run.result?.undo_token ? ` Undo token ${run.result.undo_token}.` : '';
  return `${SYSTEM_MARK} ${who} pressed Confirm on the card at ${vancouverNow(at)}. It ran: ${run.result?.summary || run.summary}${record}${undo}`;
}

/**
 * @param {Object} action - pending_actions row
 * @param {{state?: 'open'|'done'|'failed'|'cancelled', detail?: string, askerName?: string,
 *   secondary?: {text: string, params: Object}}} opts - secondary replaces Cancel (the filing sweep's Skip)
 */
export function renderConfirmCard(action, { state = 'open', detail = null, askerName = null, secondary = null } = {}) {
  const plan = planOf(action);
  const undo = action.tool_name === 'file_move_rename_undo';
  const widgets = [
    decorated({ top: 'File', text: `<a href="${esc(plan.file_link)}">${esc(plan.name_before)}</a>` })
  ];
  if (plan.moving) widgets.push(decorated({ top: 'From → To', text: `${esc(plan.path_before)}<br>→ ${esc(plan.path_after)}` }));
  if (plan.name_after !== plan.name_before) widgets.push(decorated({ top: 'Name', text: `${esc(plan.name_before)}<br>→ ${esc(plan.name_after)}` }));
  if (plan.folders_to_create?.length) {
    widgets.push(decorated({ top: 'Folders to create (new)', text: plan.folders_to_create.map(esc).join(' / ') }));
  }

  for (const warning of plan.warnings || []) widgets.push(paragraph(`⚠️ ${esc(warning)}`));

  if (state === 'open') {
    widgets.push(paragraph(`<i>Press Confirm to run it. Only ${esc(askerName || 'the person who asked')} can confirm.</i>`));
    widgets.push(buttonRow([
      button('Confirm', { action: 'pending.confirm', actionId: action.id }),
      secondary ? button(secondary.text, secondary.params) : button('Cancel', { action: 'pending.cancel', actionId: action.id })
    ]));
  } else {
    const label = { done: '✅ Done', failed: '⚠️ Not done', cancelled: 'Cancelled' }[state] || state;
    widgets.push(paragraph(`<b>${label}</b>${detail ? ` — ${esc(detail)}` : ''}`));
  }

  return finalizeCards([{
    cardId: `confirm-${action.id}`,
    card: {
      header: { title: undo ? 'Undo a Drive move?' : 'Move / rename this file?', subtitle: 'Granted Files' },
      sections: [{ widgets }]
    }
  }]);
}

async function nameOfProposer(action) {
  const r = await query('SELECT name, email FROM users WHERE id = $1', [action.proposed_by]).catch(() => ({ rows: [] }));
  return r.rows[0]?.name || r.rows[0]?.email || null;
}

/** Post the card in the thread the proposal was made in. Returns false when it couldn't. */
export async function postConfirmCard({ spaceName, threadName = null, action }) {
  try {
    await postMessage({
      spaceName,
      threadName,
      cardsV2: renderConfirmCard(action, { askerName: await nameOfProposer(action) }),
      fallbackText: action.summary
    });
    return true;
  } catch (err) {
    console.warn(`⚠️  Confirm card not posted — code: ${err?.response?.status ?? err?.code ?? 'unknown'}`);
    return false;
  }
}

function stateOf(action) {
  if (action.status === 'pending') return 'open';
  if (action.status === 'declined') return 'cancelled';
  if (action.status === 'failed') return 'failed';
  if (action.status === 'confirmed') return 'done';
  return action.status;   // expired | superseded
}

/**
 * A press on Confirm or Cancel. Answers with the updated card (or nothing,
 * with a private reply, when the presser may not confirm).
 */
export async function handlePendingClick(evt) {
  const params = evt.parameters || {};
  if (!UUID.test(String(params.actionId || '')) || !evt.actorChatId) return {};
  const r = await query('SELECT * FROM pending_actions WHERE id = $1', [params.actionId]);
  const action = r.rows[0];
  if (!action || !usesConfirmCard(action.tool_name)) return {};

  const person = await resolvePerson(evt.actorChatId, { email: evt.actorEmail, displayName: evt.actorName }).catch(() => null);
  const userId = person?.user_id ?? null;
  const gate = await canConfirm(action, userId);
  if (!gate.allowed) {
    await postMessage({
      spaceName: evt.spaceId,
      threadName: evt.threadIsResourceName ? evt.threadId : null,
      text: `Only ${gate.name} can confirm this.`,
      privateTo: evt.isDm ? null : evt.actorChatId
    }).catch(() => {});
    console.log(`🗂️  Confirm card press refused — tool: ${action.tool_name}, reason: not_allowed`);
    return {};
  }

  const askerName = await nameOfProposer(action);
  let cardsV2;
  if (action.status !== 'pending') {
    cardsV2 = renderConfirmCard(action, { state: stateOf(action), askerName, detail: action.status === 'expired' ? 'this proposal expired; ask again' : null });
  } else if (params.action === 'pending.cancel') {
    const ok = await declinePendingAction({ actionId: action.id, userId, chatUserId: evt.actorChatId });
    cardsV2 = renderConfirmCard(action, { state: ok ? 'cancelled' : 'failed', detail: ok ? null : 'no longer waiting', askerName });
  } else if (params.action === 'pending.confirm') {
    const run = await runPendingAction({ actionId: action.id, userId });
    if (!run.ok) {
      cardsV2 = renderConfirmCard(action, { state: 'failed', detail: 'no longer waiting; ask again', askerName });
    } else {
      const failed = run.result?.success === false;
      cardsV2 = renderConfirmCard(action, {
        state: failed ? 'failed' : 'done',
        detail: failed ? run.result.error : (run.result?.undo_token ? 'can be undone: ask Oracle to undo it' : null),
        askerName
      });
      // The model never saw this run: record it as a system event (not as
      // Oracle's own words) with the drive_actions id and undo token, so a
      // later "undo that" has evidence it can trust.
      const presserName = person?.display_name || evt.actorName || person?.email || null;
      await saveMessage(action.conversation_id, 'system', systemEventText(run, { presserName })).catch(() => {});
      // A filing-sweep card: record the outcome in its log (no row, or no table yet → nothing to do).
      await query(`UPDATE filing_sweep_suggestions SET status = $2, resolved_at = NOW() WHERE pending_action_id = $1 AND status = 'suggested'`,
        [action.id, failed ? 'failed' : 'confirmed']).catch(() => {});
    }
  } else {
    return {};
  }

  // The synchronous answer can be dropped when the run is slow; patch too.
  if (evt.messageName) patchCard(evt.messageName, cardsV2).catch(() => {});
  console.log(`🗂️  Confirm card press — tool: ${action.tool_name}, action: ${params.action}`);
  return updateMessageResponse(cardsV2);
}
