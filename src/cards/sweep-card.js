/**
 * Filing sweep cards (src/services/filing-sweep.js)
 *
 * One card per destination folder, three kinds:
 * - move: files going to the same folder. One Confirm all / Skip for the
 *   group. Each file underneath is still its own file_move_rename pending
 *   action, so Confirm all runs each one through the unchanged gate
 *   (canConfirm, runPendingAction) and records each one as handlePendingClick
 *   (confirm-card.js) does.
 * - advise: a wage-subsidy paystub whose employer has no client folder.
 *   planFileMove won't create one, so the card names the folder to create and
 *   asks for a reply. Leave it here only.
 * - unsure: no confident suggestion. Reply to tell Oracle, or Leave it here.
 *
 * Presses ("sweep.confirm", "sweep.skip", "sweep.leave", with the card's
 * groupId) land here. Only the person the card was sent to may press. Skip
 * declines the pending actions (logged skipped); Leave it here marks the
 * items left, with no move. Cards posted before grouping carry a suggestionId
 * instead and still work (Skip here, Confirm in handlePendingClick).
 */

import { v5 as uuidv5 } from 'uuid';
import { query } from '../database/connection.js';
import { canConfirm, runPendingAction, declinePendingAction } from '../tools/pending-actions.js';
import { saveMessage } from '../database/messages.js';
import { renderConfirmCard, systemEventText } from './confirm-card.js';
import { postMessage, patchCard } from './chat-api.js';
import { resolvePerson } from './people.js';
import { button, buttonRow, decorated, paragraph, esc, finalizeCards, updateMessageResponse } from './render.js';
import { summaryLine } from '../services/filing-sweep.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['move', 'advise', 'unsure']);
const TITLES = { move: 'Filing suggestion', advise: 'Needs a folder first', unsure: 'Not sure where this goes' };
const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * @param {Object} view - cardView() in filing-sweep.js, or viewFromRows() here
 * @param {{groupId: string, askerName?: string, state?: 'open'|'busy'|'done'|'failed'|'cancelled'|'left', detail?: string}} opts
 */
export function renderSweepCard(view, { groupId, askerName = null, state = 'open', detail = null } = {}) {
  const files = view.files;
  const top = [paragraph(`<b>${esc(summaryLine(view))}</b>`)];
  if (view.forLine) top.push(paragraph(`<i>${esc(view.forLine)}</i>`));
  if (files.length === 1) {
    const f = files[0];
    top.push(decorated({ top: 'File', text: `<a href="${esc(f.link)}">${esc(f.name)}</a>${f.nameAfter ? `<br>→ ${esc(f.nameAfter)}` : ''}` }));
  }
  if (view.kind !== 'unsure' && view.moving && view.foldersToCreate?.length) {
    top.push(decorated({ top: view.kind === 'advise' ? 'Folders to create' : 'Folders to create (new)', text: view.foldersToCreate.map(esc).join(' / ') }));
  }
  if (state === 'open' && view.kind === 'advise') {
    top.push(paragraph(`${esc(view.note || 'That client folder doesn\'t exist yet')}. Create it in Drive, then reply "file ${files.length === 1 ? 'it' : 'them'}" in this thread and I'll move ${files.length === 1 ? 'it' : 'them'}.`));
  }
  if (state === 'open' && view.kind === 'unsure') {
    top.push(paragraph(`Reply in this thread and tell me where ${files.length === 1 ? 'it goes' : 'they go'}.`));
    if (view.note) top.push(paragraph(`<i>Why: ${esc(view.note)}</i>`));
  }

  const sections = [{ widgets: top }];
  if (files.length > 1) {
    sections.push({
      header: `Files (${files.length})`,
      collapsible: true,
      uncollapsibleWidgetsCount: 1,
      widgets: files.map(f => decorated({ text: `<a href="${esc(f.link)}">${esc(f.name)}</a>${f.nameAfter ? `<br>→ ${esc(f.nameAfter)}` : ''}` }))
    });
  }

  const end = [];
  if (state === 'open') {
    if (view.kind === 'move') {
      end.push(paragraph(`<i>Nothing moves until you press Confirm${files.length === 1 ? '' : ' all'}. Only ${esc(askerName || 'the person this was sent to')} can confirm.</i>`));
      end.push(buttonRow([
        button(files.length === 1 ? 'Confirm' : 'Confirm all', { action: 'sweep.confirm', groupId, kind: view.kind }),
        button('Skip', { action: 'sweep.skip', groupId, kind: view.kind })
      ]));
    } else {
      end.push(buttonRow([button('Leave it here', { action: 'sweep.leave', groupId, kind: view.kind })]));
    }
  } else if (state === 'busy') {
    end.push(paragraph(`<i>Moving ${n(files.length, 'file')}…</i>`));
  } else {
    const label = { done: '✅ Done', failed: '⚠️ Not all done', cancelled: 'Skipped', left: 'Left where it is' }[state] || state;
    end.push(paragraph(`<b>${label}</b>${detail ? ` — ${esc(detail)}` : ''}`));
  }
  sections.push({ widgets: end });

  return finalizeCards([{
    cardId: `sweep-${groupId}`,
    card: { header: { title: TITLES[view.kind] || TITLES.move, subtitle: 'Granted Files' }, sections }
  }]);
}

const strip = (p) => String(p || '').replace(/^Granted Files\//, '');
const planOf = (action) => {
  const raw = action?.tool_input;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
};

/** The card's view rebuilt from its log rows (and, for moves, their pending actions), for re-rendering after a press. */
export function viewFromRows(kind, rows, actionsById = new Map()) {
  const plans = rows.map(r => planOf(actionsById.get(r.pending_action_id)));
  const first = plans[0] || {};
  return {
    kind,
    destination: kind === 'move' ? strip(first.path_after || rows[0].suggested_path) : (rows[0].suggested_path || strip(rows[0].path_before)),
    moving: kind === 'move' ? plans.some(p => p.moving) : kind === 'advise',
    foldersToCreate: kind === 'move' ? (first.folders_to_create || []) : [],
    files: rows.map((r, i) => ({
      id: r.file_id,
      name: r.file_name,
      link: plans[i].file_link || `https://drive.google.com/open?id=${r.file_id}`,
      nameAfter: r.suggested_name && r.suggested_name !== r.file_name ? r.suggested_name : null
    })),
    note: null,
    forLine: ''
  };
}

/** What a press does, given the card's rows and who pressed. Pure, for tests. */
export function pressDecision(rows, presserUserId, action) {
  if (!rows?.length) return 'unknown';
  if (presserUserId === null || presserUserId === undefined || Number(presserUserId) !== Number(rows[0].recipient_user_id)) return 'not_allowed';
  const open = action === 'sweep.leave'
    ? rows.some(r => r.status === 'unsure' || r.status === 'advised')
    : rows.some(r => r.status === 'suggested');
  return open ? 'go' : 'settled';
}

/** The settled state of a card, from its rows. */
export function stateOfRows(rows) {
  const count = (s) => rows.filter(r => r.status === s).length;
  if (count('left') === rows.length) return { state: 'left', detail: null };
  if (count('skipped') === rows.length) return { state: 'cancelled', detail: 'the files stay where they are' };
  if (count('confirmed') === rows.length) return { state: 'done', detail: `${n(rows.length, 'file')} filed` };
  const parts = [['confirmed', 'filed'], ['failed', 'not done'], ['skipped', 'skipped'], ['ignored', 'expired'], ['suggested', 'still open']]
    .map(([s, label]) => (count(s) ? `${count(s)} ${label}` : null)).filter(Boolean);
  return { state: 'failed', detail: parts.join(', ') };
}

/** Same as skipDecision before grouping: one suggestion row. */
export function skipDecision(suggestion, presserUserId) {
  if (!suggestion) return 'unknown';
  if (presserUserId === null || presserUserId === undefined || Number(presserUserId) !== Number(suggestion.recipient_user_id)) return 'not_allowed';
  if (suggestion.status !== 'suggested') return 'settled';
  return 'skip';
}

const defaultDeps = () => ({ query, canConfirm, runPendingAction, declinePendingAction, saveMessage });

/**
 * Confirm all: each open file through the unchanged gate, one at a time.
 * Returns [{row, ok, error, run}]. Records each run as handlePendingClick does.
 */
export async function confirmGroup(rows, actionsById, { userId, presserName = null }, deps = defaultDeps()) {
  const results = [];
  for (const row of rows.filter(r => r.status === 'suggested' && r.pending_action_id)) {
    const action = actionsById.get(row.pending_action_id);
    if (!action || action.status !== 'pending') { results.push({ row, ok: false, error: 'no longer waiting' }); continue; }
    const gate = await deps.canConfirm(action, userId);
    if (!gate.allowed) { results.push({ row, ok: false, error: `only ${gate.name} can confirm` }); continue; }
    let run;
    try {
      run = await deps.runPendingAction({ actionId: action.id, userId });
    } catch (err) {
      run = { ok: true, result: { success: false, error: err?.code || err?.message || 'error' } };
    }
    if (!run.ok) { results.push({ row, ok: false, error: 'no longer waiting' }); continue; }
    const failed = run.result?.success === false;
    await deps.saveMessage(action.conversation_id, 'system', systemEventText(run, { presserName })).catch(() => {});
    await deps.query(`UPDATE filing_sweep_suggestions SET status = $2, resolved_at = NOW() WHERE id = $1 AND status = 'suggested'`, [row.id, failed ? 'failed' : 'confirmed']).catch(() => {});
    row.status = failed ? 'failed' : 'confirmed';
    results.push({ row, ok: !failed, error: failed ? run.result.error : null, run });
  }
  return results;
}

/** One line for the card and the thread's conversation. */
export function resultText(results) {
  const ok = results.filter(r => r.ok).length;
  const bad = results.filter(r => !r.ok);
  if (!bad.length) return `${n(ok, 'file')} filed; each can be undone: ask Oracle to undo it`;
  return `${ok} filed, ${bad.length} not done: ${bad.map(r => `${r.row.file_name} (${String(r.error || 'error').replace(/[.\s]+$/, '')})`).join('; ')}`;
}

async function loadGroup(groupId) {
  const rows = (await query('SELECT * FROM filing_sweep_suggestions WHERE group_id = $1 ORDER BY created_at, file_name', [groupId]).catch(() => ({ rows: [] }))).rows;
  const ids = rows.map(r => r.pending_action_id).filter(Boolean);
  const actions = ids.length ? (await query('SELECT * FROM pending_actions WHERE id = ANY($1::uuid[])', [ids])).rows : [];
  return { rows, actionsById: new Map(actions.map(a => [a.id, a])) };
}

export async function handleSweepClick(evt) {
  const params = evt.parameters || {};
  if (!evt.actorChatId) return {};
  if (UUID.test(String(params.groupId || '')) && KINDS.has(params.kind)) return handleGroupClick(evt, params);
  if (params.action === 'sweep.skip' && UUID.test(String(params.suggestionId || ''))) return handleLegacySkip(evt, params);
  return {};
}

async function handleGroupClick(evt, params) {
  const { rows, actionsById } = await loadGroup(params.groupId);
  const person = await resolvePerson(evt.actorChatId, { email: evt.actorEmail, displayName: evt.actorName }).catch(() => null);
  const userId = person?.user_id ?? null;
  const decision = pressDecision(rows, userId, params.action);
  if (decision === 'unknown') return {};
  if (decision === 'not_allowed') {
    await postMessage({
      spaceName: evt.spaceId,
      threadName: evt.threadIsResourceName ? evt.threadId : null,
      text: `Only ${rows[0].recipient_email} can do this.`,
      privateTo: evt.isDm ? null : evt.actorChatId
    }).catch(() => {});
    return {};
  }
  const kind = params.kind;
  const askerName = rows[0].recipient_email;
  const render = (state, detail = null) => renderSweepCard(viewFromRows(kind, rows, actionsById), { groupId: params.groupId, askerName, state, detail });
  const answer = (cardsV2) => {
    if (evt.messageName) patchCard(evt.messageName, cardsV2).catch(() => {});
    console.log(`🗂️  Filing sweep card press — action: ${params.action}, kind: ${kind}, files: ${rows.length}, result: ${decision}`);
    return updateMessageResponse(cardsV2);
  };

  if (decision === 'settled') { const s = stateOfRows(rows); return answer(render(s.state, s.detail)); }

  if (params.action === 'sweep.leave') {
    await query(`UPDATE filing_sweep_suggestions SET status = 'left', resolved_at = NOW() WHERE group_id = $1 AND status IN ('unsure', 'advised')`, [params.groupId]);
    for (const r of rows) if (r.status === 'unsure' || r.status === 'advised') r.status = 'left';
    return answer(render('left'));
  }

  if (params.action === 'sweep.skip') {
    for (const r of rows.filter(x => x.status === 'suggested')) {
      if (r.pending_action_id) await declinePendingAction({ actionId: r.pending_action_id, userId, chatUserId: evt.actorChatId }).catch(() => false);
      await query(`UPDATE filing_sweep_suggestions SET status = 'skipped', resolved_at = NOW() WHERE id = $1 AND status = 'suggested'`, [r.id]);
      r.status = 'skipped';
    }
    const s = stateOfRows(rows);
    return answer(render(s.state, s.detail));
  }

  if (params.action === 'sweep.confirm') {
    // Answer now ("Moving N files…"): the moves can outlast Chat's wait for a reply. Patch when done.
    const presserName = person?.display_name || evt.actorName || person?.email || null;
    confirmGroup(rows, actionsById, { userId, presserName })
      .then(async (results) => {
        const s = stateOfRows(rows);
        const detail = resultText(results);
        if (evt.messageName) await patchCard(evt.messageName, render(s.state, detail)).catch(() => {});
        else await postMessage({ spaceName: evt.spaceId, threadName: evt.threadIsResourceName ? evt.threadId : null, text: detail }).catch(() => {});
        // The thread's own conversation, so a reply there ("undo the paystubs") has the records.
        if (rows[0].thread_name) {
          const conversation = uuidv5(rows[0].thread_name, uuidv5.URL);
          const lines = results.filter(r => r.run).map(r => `- ${systemEventText(r.run, { presserName })}`);
          if (lines.length) await saveMessage(conversation, 'system', [`Confirm all on the filing card for ${summaryLine(viewFromRows(kind, rows, actionsById))}:`, ...lines].join('\n')).catch(() => {});
        }
        console.log(`🗂️  Filing sweep group confirm — files: ${results.length}, filed: ${results.filter(r => r.ok).length}`);
      })
      .catch(err => console.error(`❌ Filing sweep group confirm failed — code: ${err?.code || err?.name || 'unknown'}`));
    return answer(render('busy'));
  }
  return {};
}

async function handleLegacySkip(evt, params) {
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
