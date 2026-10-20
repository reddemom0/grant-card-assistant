/**
 * Gated Drive move / rename, and its undo (tools file_move_rename and
 * file_move_rename_undo).
 *
 * Every limit lives here, in code — the prompt and the filing skill only decide
 * when to propose. Two phases:
 *
 *   plan    — read-only, as the asker. Runs before the call is saved for
 *             confirmation (PREPARE_GATED in executor.js), so the confirm card
 *             shows exactly what will happen, and a refusal saves nothing.
 *   execute — after the asker presses Confirm. Plans again, refuses if anything
 *             changed or a folder not shown as (new) would be created, then
 *             creates the (new) folders, moves/renames in one update, reads
 *             the file back, and logs.
 *
 * What this module can do to Drive: create folders inside Granted Files, and
 * change one file's parents and name. Nothing else — no sharing, copying,
 * deleting or trashing. It acts only as the asker (domain-wide delegation),
 * never as the bare service account, and never retries as anyone else. The
 * undo acts as the original asker, whoever confirms it.
 *
 * Logged to drive_actions (migration 042) and to the "Drive migration log"
 * sheet (Log tab, Run = "Oracle"). A failed sheet append never fails the action.
 */

import crypto from 'node:crypto';
import { google } from 'googleapis';
import { query } from '../database/connection.js';
import {
  delegatedDriveClient, resolveGrantedFilesPath, extractFileId, folderKey,
  GRANTED_FILES_DRIVE_ID, GRANTED_ARCHIVE_DRIVE_ID, FOLDER_MIME, DRIVE_UNAVAILABLE
} from './google-drive.js';
import { matchSensitive, isExcludedOwner } from './drive-sensitive.js';

/** "Drive migration log" (owned by writers@). The Log tab's columns match the migration's. */
export const DRIVE_LOG_SHEET_ID = '1Ns2BlSifPMHZixGtWePL7GByU29CUVHoBVcxYJqImGw';

const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const ALLOWED_ROOTS = ['Clients', 'Programs', 'Departments'];
const NEVER_UNDER = { departments: ['mindfulness'] };
const DRIVE_LABELS = { [GRANTED_FILES_DRIVE_ID]: 'Granted Files', [GRANTED_ARCHIVE_DRIVE_ID]: 'Granted Archive' };
const MAX_PATH_DEPTH = 30;
const MAX_NAME = 200;
const GRANTED_ASKER = /^[^@\s]+@granted\.ca$/i;

const refuse = (reason) => ({ ok: false, reason });
const sameSet = (a = [], b = []) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** The folder names above a file, root first, and the place it lives. */
async function pathOf(drive, file) {
  const names = [];
  let parentId = file.parents?.[0];
  for (let depth = 0; parentId && depth < MAX_PATH_DEPTH; depth++) {
    if (file.driveId && parentId === file.driveId) break;          // shared drive root
    const p = await drive.files.get({ fileId: parentId, fields: 'id, name, parents', supportsAllDrives: true });
    if (!p.data.parents?.length) break;                             // My Drive root
    names.unshift(p.data.name);
    parentId = p.data.parents[0];
  }
  const place = file.driveId ? (DRIVE_LABELS[file.driveId] || 'another shared drive') : 'My Drive';
  return { names, text: [place, ...names].join('/') };
}

/** Keep an uploaded file's extension when the new name leaves it off. */
function withExtension(newName, oldName, mimeType) {
  if (String(mimeType || '').startsWith('application/vnd.google-apps.')) return newName;
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(oldName || '')?.[0];
  if (!ext || newName.toLowerCase().endsWith(ext.toLowerCase())) return newName;
  return `${newName}${ext}`;
}

/**
 * Check every limit and describe the move. Read-only, as the asker.
 *
 * @param {{file: string, destination_path?: string, new_name?: string}} input
 * @param {{askerEmail: string|null, askerUserId?: number|null}} ctx
 * @returns {Promise<{ok: true, plan: Object} | {ok: false, reason: string}>}
 */
export async function planFileMove(input = {}, ctx = {}) {
  try {
    return await checkFileMove(input, ctx);
  } catch (err) {
    // A Drive read failed part-way (path walk, folder lookup): refuse, as the asker, no retry.
    return refuse(`I couldn't read Drive as you (${err?.code ?? err?.response?.status ?? 'error'}). Nothing was moved.`);
  }
}

async function checkFileMove(input, { askerEmail, askerUserId = null } = {}) {
  if (!GRANTED_ASKER.test(String(askerEmail || ''))) {
    return refuse(`${DRIVE_UNAVAILABLE}: I couldn't confirm who is asking, so nothing was moved.`);
  }
  if (isExcludedOwner(askerEmail)) return refuse("I don't move files for the finance accounts. Ask Chris or Nat.");

  const fileId = extractFileId(String(input.file || '').trim());
  const destinationPath = String(input.destination_path || '').trim();
  const requestedName = String(input.new_name || '').trim();
  if (!fileId) return refuse('Which file? Give me its link or ID.');
  if (!destinationPath && !requestedName) return refuse('Tell me where to move it, what to rename it to, or both.');

  let drive;
  try {
    drive = delegatedDriveClient(askerEmail);
  } catch {
    return refuse(DRIVE_UNAVAILABLE);
  }

  let file;
  try {
    ({ data: file } = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, driveId, parents, ownedByMe, owners(emailAddress), webViewLink',
      supportsAllDrives: true
    }));
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    return refuse(`I couldn't open that file as you (${status ?? 'error'}). I only act with your own access.`);
  }

  // ---- source ---------------------------------------------------------------
  if (file.mimeType === FOLDER_MIME) return refuse("That's a folder. I only move single files.");
  if (file.mimeType === SHORTCUT_MIME) return refuse("That's a shortcut. Move the original file instead.");

  const ownerEmails = (file.owners || []).map(o => o.emailAddress).filter(Boolean);
  if (ownerEmails.some(isExcludedOwner)) return refuse("That file belongs to a finance account. I don't move those; ask Chris or Nat.");

  let sourceDrive;
  if (file.driveId) {
    if (!DRIVE_LABELS[file.driveId]) return refuse('That file is in a shared drive other than Granted Files or Granted Archive. I only move files from those two, or from your own My Drive.');
    sourceDrive = DRIVE_LABELS[file.driveId];
  } else {
    if (!ownerEmails.every(e => GRANTED_ASKER.test(e))) return refuse("That file is owned outside granted.ca. I don't move it.");
    if (!file.ownedByMe) return refuse("That file is in someone else's My Drive. I only move files you own, or files already in Granted Files or Granted Archive.");
    sourceDrive = 'My Drive';
  }

  const sourcePath = await pathOf(drive, file);

  // ---- name -----------------------------------------------------------------
  let nameAfter = file.name;
  if (requestedName) {
    if (requestedName.includes('/')) return refuse('A file name can\'t contain "/".');
    nameAfter = withExtension(requestedName, file.name, file.mimeType);
    if (nameAfter.length > MAX_NAME) return refuse(`That name is too long (over ${MAX_NAME} characters).`);
  }

  // ---- sensitive guard (strict) --------------------------------------------
  const sensitive = [
    ['the file name', file.name],
    ['the new name', nameAfter],
    ...sourcePath.names.map(n => [`the folder "${n}"`, n])
  ].map(([where, text]) => ({ where, term: matchSensitive(text) })).find(x => x.term);
  if (sensitive) {
    return refuse(`This looks like Granted's own ${sensitive.term} material (${sensitive.where}). I don't move or rename those. Ask Chris or Nat.`);
  }

  // ---- destination ----------------------------------------------------------
  let existingParentId = null;
  let destNames = null;
  let foldersToCreate = [];
  if (destinationPath) {
    let parts = destinationPath.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length && folderKey(parts[0]) === folderKey('Granted Files')) parts = parts.slice(1);
    const root = ALLOWED_ROOTS.find(r => folderKey(r) === folderKey(parts[0]));
    if (!root) return refuse('I only move files into Granted Files, under Clients/, Programs/ or Departments/.');
    if (parts.length < 2) return refuse(`Pick a folder inside ${root}/, not ${root}/ itself.`);
    if ((NEVER_UNDER[folderKey(root)] || []).includes(folderKey(parts[1]))) return refuse(`${root}/${parts[1]} is a legacy folder. Nothing is filed there.`);

    const walk = await resolveGrantedFilesPath(drive, parts);
    if (walk.ambiguousAt !== undefined) return refuse(`More than one folder matches "${parts[walk.ambiguousAt]}" (${walk.candidates.join(', ')}). Which one?`);
    if (walk.missingAt !== undefined) {
      if (walk.missingAt < 2) {
        return refuse(`"${parts[walk.missingAt]}" doesn't exist in ${walk.names.join('/') || 'Granted Files'}. I only create folders below an existing client, program or department folder; create that one by hand first.`);
      }
      foldersToCreate = parts.slice(walk.missingAt);
    }
    existingParentId = walk.parentId;
    destNames = [...walk.names, ...foldersToCreate];
  }

  const moving = Boolean(destinationPath) && (foldersToCreate.length > 0 || !(file.parents || []).includes(existingParentId));
  const renaming = nameAfter !== file.name;
  if (!moving && !renaming) return refuse('It is already there with that name. Nothing to do.');

  const warnings = moving && sourceDrive !== 'Granted Files' ? await moveWarnings(drive, file.id) : [];

  return {
    ok: true,
    plan: {
      file_id: file.id,
      file_link: file.webViewLink || `https://drive.google.com/open?id=${file.id}`,
      mime_type: file.mimeType,
      source_drive: sourceDrive,
      owner_label: file.driveId ? 'shared drive' : (ownerEmails[0] || ''),
      name_before: file.name,
      name_after: nameAfter,
      moving,
      parents_before: file.parents || [],
      path_before: sourcePath.text,
      existing_parent_id: moving ? existingParentId : null,
      path_after: moving ? ['Granted Files', ...destNames].join('/') : sourcePath.text,
      folders_to_create: moving ? foldersToCreate : [],
      request: { file: file.id, destination_path: destinationPath || null, new_name: requestedName || null },
      asker_email: askerEmail,
      asker_user_id: askerUserId,
      warnings
    }
  };
}

/**
 * Confirm-card warnings for a move into Granted Files from another drive.
 * Reads only, as the asker; a read that fails just means no warning.
 * - Undo moves the file back out of the shared drive, which may need a Manager
 *   (canManageMembers is a Manager-only capability).
 * - "Anyone with the link" access may not survive the move (it can come from a
 *   My Drive folder); whether it is inherited isn't worked out.
 */
async function moveWarnings(drive, fileId) {
  const warnings = [];
  try {
    const { data } = await drive.drives.get({ driveId: GRANTED_FILES_DRIVE_ID, fields: 'capabilities(canManageMembers)' });
    if (data?.capabilities?.canManageMembers === false) warnings.push('Undo may need a Granted Files Manager.');
  } catch { /* no warning */ }
  try {
    // files.get, not the permissions API: this module never touches sharing.
    const { data } = await drive.files.get({ fileId, supportsAllDrives: true, fields: 'permissions(type)' });
    if ((data?.permissions || []).some(p => p.type === 'anyone')) warnings.push('Link sharing may be lost after the move.');
  } catch { /* no warning */ }
  return warnings;
}

/**
 * Run a confirmed move. `plan` is the stored input from planFileMove.
 * @returns {Promise<Object>} tool result
 */
export async function executeFileMove(plan, { askerEmail, confirmedBy = null, pendingActionId = null, conversationId = null } = {}) {
  if (!plan?.file_id || !plan.request) return { success: false, error: 'This proposal is incomplete. Ask again.' };
  if (String(askerEmail || '').toLowerCase() !== String(plan.asker_email || '').toLowerCase()) {
    return { success: false, error: 'Only the person who asked can run this move.' };
  }

  const fresh = await planFileMove(plan.request, { askerEmail, askerUserId: plan.asker_user_id });
  if (!fresh.ok) return { success: false, error: fresh.reason };
  const now = fresh.plan;
  const unlisted = now.folders_to_create.filter(n => !plan.folders_to_create.some(c => folderKey(c) === folderKey(n)));
  if (unlisted.length) return { success: false, error: `New folders would be needed that weren't on the card (${unlisted.join(', ')}). Ask again.` };
  if (!sameSet(now.parents_before, plan.parents_before) || now.name_before !== plan.name_before || now.path_after !== plan.path_after || now.name_after !== plan.name_after) {
    return { success: false, error: 'The file or the folders changed since you confirmed. Nothing was moved; ask again.' };
  }

  let drive;
  try {
    drive = delegatedDriveClient(askerEmail, { write: true });
  } catch {
    return { success: false, error: DRIVE_UNAVAILABLE };
  }

  const created = [];
  let parentsAfter = now.parents_before;
  try {
    let parentId = now.existing_parent_id;
    for (const name of now.folders_to_create) {
      const { data } = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        supportsAllDrives: true,
        fields: 'id, name'
      });
      created.push({ name: data.name, id: data.id });
      parentId = data.id;
    }

    const params = { fileId: now.file_id, supportsAllDrives: true, fields: 'id, name, parents', requestBody: {} };
    if (now.name_after !== now.name_before) params.requestBody.name = now.name_after;
    if (now.moving) {
      params.addParents = parentId;
      params.removeParents = now.parents_before.join(',');
    }
    await drive.files.update(params);

    const { data: after } = await drive.files.get({ fileId: now.file_id, fields: 'id, name, parents', supportsAllDrives: true });
    parentsAfter = after.parents || [];
    if (after.name !== now.name_after || (now.moving && !parentsAfter.includes(parentId))) {
      throw new Error('the file did not end up where expected');
    }
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    const error = `Drive refused the change (${status ?? err.message}). Nothing else was changed${created.length ? `; these folders were created: ${created.map(c => c.name).join(', ')}` : ''}.`;
    await logAction({ action: 'move_rename', plan: now, parentsAfter, created, result: 'failed', error, confirmedBy, pendingActionId, conversationId });
    return { success: false, error };
  }

  const row = await logAction({ action: 'move_rename', plan: now, parentsAfter, created, result: 'done', confirmedBy, pendingActionId, conversationId });
  return {
    success: true,
    summary: describe(now),
    file_link: now.file_link,
    home: now.path_after,
    name: now.name_after,
    folders_created: created.map(c => c.name),
    undo_token: row?.undo_token || null,
    action_id: row?.id || null,
    note: row?.undo_token ? 'Tell the asker it can be undone, and keep the undo token for file_move_rename_undo.' : 'Done, but the log row could not be written, so there is no undo token.'
  };
}

// ============================================================================
// UNDO
// ============================================================================

async function findUndoable(undoToken) {
  if (!/^[0-9a-f-]{36}$/i.test(String(undoToken || ''))) return null;
  const r = await query(
    `SELECT * FROM drive_actions
      WHERE undo_token = $1 AND action = 'move_rename' AND result = 'done' AND undone_at IS NULL`,
    [undoToken]
  );
  return r.rows[0] || null;
}

/**
 * Check an undo. Runs as the ORIGINAL asker (the row's asker_email): they had
 * the rights to the source. Destination limits don't apply — an undo may put a
 * file back in a My Drive.
 */
export async function planUndo(input = {}) {
  const row = await findUndoable(input.undo_token);
  if (!row) return refuse("I can't find a move with that undo token that hasn't already been undone.");

  let drive;
  try {
    drive = delegatedDriveClient(row.asker_email);
  } catch {
    return refuse(DRIVE_UNAVAILABLE);
  }
  let file;
  try {
    ({ data: file } = await drive.files.get({ fileId: row.file_id, fields: 'id, name, parents', supportsAllDrives: true }));
  } catch (err) {
    return refuse(`I couldn't open the file as ${row.asker_email} (${err?.code ?? err?.response?.status ?? 'error'}).`);
  }
  if (file.name !== row.name_after || !sameSet(file.parents || [], row.parents_after || [])) {
    return refuse('The file has been moved or renamed since. Undo it by hand.');
  }
  return {
    ok: true,
    plan: {
      undo_token: row.undo_token,
      undoes_action_id: row.id,
      file_id: row.file_id,
      file_link: `https://drive.google.com/open?id=${row.file_id}`,
      name_before: row.name_after,
      name_after: row.name_before,
      moving: !sameSet(row.parents_before || [], row.parents_after || []),
      parents_before: row.parents_after || [],
      parents_restore: row.parents_before || [],
      path_before: row.path_after,
      path_after: row.path_before,
      folders_to_create: [],
      owner_label: row.owner_label || '',
      asker_email: row.asker_email,
      asker_user_id: row.asker_user_id
    }
  };
}

export async function executeUndo(plan, { confirmedBy = null, pendingActionId = null, conversationId = null } = {}) {
  const fresh = await planUndo({ undo_token: plan?.undo_token });
  if (!fresh.ok) return { success: false, error: fresh.reason };
  const now = fresh.plan;

  let drive;
  try {
    drive = delegatedDriveClient(now.asker_email, { write: true });
  } catch {
    return { success: false, error: DRIVE_UNAVAILABLE };
  }

  let parentsAfter = now.parents_before;
  try {
    const params = { fileId: now.file_id, supportsAllDrives: true, fields: 'id, name, parents', requestBody: {} };
    if (now.name_after !== now.name_before) params.requestBody.name = now.name_after;
    if (now.moving) {
      params.addParents = now.parents_restore.join(',');
      params.removeParents = now.parents_before.join(',');
    }
    await drive.files.update(params);
    const { data: after } = await drive.files.get({ fileId: now.file_id, fields: 'id, name, parents', supportsAllDrives: true });
    parentsAfter = after.parents || [];
    if (after.name !== now.name_after || (now.moving && !sameSet(parentsAfter, now.parents_restore))) {
      throw new Error('the file did not end up where it was');
    }
  } catch (err) {
    const error = `Drive refused the undo (${err?.code ?? err?.response?.status ?? err.message}). The file is where the move left it.`;
    await logAction({ action: 'undo', plan: now, parentsAfter, created: [], result: 'failed', error, confirmedBy, pendingActionId, conversationId });
    return { success: false, error };
  }

  const row = await logAction({ action: 'undo', plan: now, parentsAfter, created: [], result: 'done', confirmedBy, pendingActionId, conversationId });
  await query('UPDATE drive_actions SET undone_at = NOW() WHERE id = $1', [now.undoes_action_id]).catch(err =>
    console.warn(`⚠️  drive_actions undone_at not set — code: ${err?.code ?? 'unknown'}`));
  return { success: true, summary: describeUndo(now), file_link: now.file_link, home: now.path_after, name: now.name_after, action_id: row?.id || null };
}

// ============================================================================
// SUMMARIES (shown on the confirm card and in the gate's text)
// ============================================================================

export function describe(plan) {
  const bits = [];
  if (plan.moving) bits.push(`Move "${plan.name_before}" from ${plan.path_before} to ${plan.path_after}`);
  if (plan.name_after !== plan.name_before) bits.push(`${plan.moving ? 'and rename it' : `Rename "${plan.name_before}"`} to "${plan.name_after}"`);
  const folders = plan.folders_to_create?.length ? ` Folders to create (new): ${plan.folders_to_create.join(' / ')}.` : '';
  return `${bits.join(' ')}.${folders}`;
}

export function describeUndo(plan) {
  return `Undo the earlier change: put "${plan.name_before}" back as "${plan.name_after}" in ${plan.path_after}.`;
}

// ============================================================================
// LOG — drive_actions + the "Drive migration log" sheet
// ============================================================================

async function logAction({ action, plan, parentsAfter, created, result, error = null, confirmedBy, pendingActionId, conversationId }) {
  let row = null;
  try {
    const r = await query(
      `INSERT INTO drive_actions
         (action, asker_user_id, asker_email, confirmed_by, pending_action_id, conversation_id,
          file_id, name_before, name_after, parents_before, parents_after, path_before, path_after,
          owner_label, folders_created, result, error, undo_token, undoes_action_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [action, plan.asker_user_id ?? null, plan.asker_email, confirmedBy, pendingActionId, conversationId,
        plan.file_id, plan.name_before, plan.name_after, plan.parents_before, parentsAfter, plan.path_before, plan.path_after,
        plan.owner_label || null, JSON.stringify(created), result, error,
        action === 'move_rename' && result === 'done' ? crypto.randomUUID() : null,
        plan.undoes_action_id ?? null]
    );
    row = r.rows[0];
  } catch (err) {
    console.error(`❌ drive_actions row not written — action: ${action}, result: ${result}, code: ${err?.code ?? 'unknown'}`);
  }

  if (result === 'done') {
    const sheet = await appendLogRows(sheetRows({ action, plan, created, rowId: row?.id }));
    if (row) {
      await query('UPDATE drive_actions SET sheet_logged = $2, sheet_error = $3 WHERE id = $1',
        [row.id, sheet.ok, sheet.ok ? null : sheet.error]).catch(() => {});
    }
  }
  console.log(`🗂️  Drive action — ${action}, result: ${result}, folders created: ${created.length}`);
  return row;
}

export function vancouverTime(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Columns: Date-time (Vancouver) | Run | Action | File name | File ID | File link |
// Owner | From (path) | To (path) | Sharing detail | Done by | Ledger file
export function sheetRows({ action, plan, created, rowId, when = null }) {
  when = when || vancouverTime();
  const ledger = rowId ? `drive_actions ${rowId}` : 'drive_actions (row not written)';
  const link = id => `https://drive.google.com/open?id=${id}`;
  const rows = created.map(f => [when, 'Oracle', 'folder created', f.name, f.id, link(f.id), 'shared drive', '', plan.path_after, '', plan.asker_email, ledger]);
  const renamed = plan.name_after !== plan.name_before;
  const label = action === 'undo' ? 'move back' : plan.moving && renamed ? 'move + rename' : plan.moving ? 'move' : 'rename';
  const name = renamed ? `${plan.name_before} → ${plan.name_after}` : plan.name_after;
  rows.push([when, 'Oracle', label, name, plan.file_id, link(plan.file_id), plan.owner_label || '', plan.path_before, plan.path_after, '', plan.asker_email, ledger]);
  return rows;
}

/**
 * Append to the Log tab as the service account itself (the sheet is shared
 * with it). Never throws.
 */
export async function appendLogRows(rows) {
  try {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '');
    const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    await google.sheets({ version: 'v4', auth }).spreadsheets.values.append({
      spreadsheetId: DRIVE_LOG_SHEET_ID,
      range: 'Log!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows }
    });
    return { ok: true };
  } catch (err) {
    const error = `sheet append failed (${err?.code ?? err?.response?.status ?? err?.name ?? 'error'})`;
    console.warn(`⚠️  Drive migration log: ${error} — the action stands; drive_actions has the record`);
    return { ok: false, error };
  }
}
