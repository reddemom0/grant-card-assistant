/**
 * Pre-call briefing Docs in the Granted Files shared drive.
 *
 * ACTS AS THE BRIEFING'S OWNER (domain-wide delegation, `drive` scope only —
 * delegation refuses `spreadsheets`, and asking for `documents` too would fail
 * the whole token if it is not granted), never as the bare service account:
 * the same rule as src/tools/drive-actions.js. So the Doc is created by that
 * person, and only where they can write.
 *
 * The Doc is created by uploading HTML that Drive converts to a Google Doc, so
 * no Docs API scope is needed. Folders on the path are matched like the rest
 * of Granted Files (folderKey: case, spacing and punctuation ignored) and the
 * missing ones are created; an ambiguous match is refused rather than guessed.
 *
 * Nothing here logs a folder, a file name or a company — codes only.
 */

import { Readable } from 'node:stream';
import { delegatedDriveClient, resolveGrantedFilesPath, FOLDER_MIME } from '../tools/google-drive.js';

export const DOC_MIME = 'application/vnd.google-apps.document';

export class BriefingDriveError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Find `parts` under the Granted Files root, creating any that are missing. */
export async function ensureGrantedFilesFolder(drive, parts) {
  const walk = await resolveGrantedFilesPath(drive, parts);
  if (walk.ambiguousAt !== undefined) {
    throw new BriefingDriveError('folder_ambiguous', `More than one folder matches part ${walk.ambiguousAt + 1} of the briefing path`);
  }
  let parentId = walk.parentId;
  const created = [];
  if (walk.missingAt !== undefined) {
    for (const name of parts.slice(walk.missingAt)) {
      const { data } = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        supportsAllDrives: true,
        fields: 'id, name'
      });
      created.push(data.id);
      parentId = data.id;
    }
  }
  return { folderId: parentId, createdFolders: created.length };
}

/**
 * Create one briefing Doc as `ownerEmail` in Granted Files at `folderParts`.
 * @returns {Promise<{id: string, url: string, createdFolders: number}>}
 * @throws {BriefingDriveError} code drive_unavailable | drive_write_denied | folder_ambiguous | drive_error
 */
export async function createBriefingDoc({ ownerEmail, folderParts, name, html }, { driveClient = delegatedDriveClient } = {}) {
  let drive;
  try {
    drive = driveClient(ownerEmail, { write: true });
  } catch {
    throw new BriefingDriveError('drive_unavailable', 'Drive access unavailable for the briefing owner');
  }
  try {
    const { folderId, createdFolders } = await ensureGrantedFilesFolder(drive, folderParts);
    const { data } = await drive.files.create({
      requestBody: { name, mimeType: DOC_MIME, parents: [folderId] },
      media: { mimeType: 'text/html', body: Readable.from([html]) },
      supportsAllDrives: true,
      fields: 'id, webViewLink'
    });
    return { id: data.id, url: data.webViewLink || `https://docs.google.com/document/d/${data.id}/edit`, createdFolders };
  } catch (err) {
    if (err instanceof BriefingDriveError) throw err;
    const status = Number(err?.code ?? err?.response?.status);
    const code = status === 403 || status === 404 || /unauthorized_client|invalid_grant/i.test(String(err?.message))
      ? 'drive_write_denied'
      : 'drive_error';
    console.error(`❌ Briefing Doc create failed — code: ${code} (${status || err?.code || 'unknown'})`);
    throw new BriefingDriveError(code, `Briefing Doc could not be created (${status || 'error'})`);
  }
}

// ---------------------------------------------------------------------------
// Markdown → HTML (Drive converts the HTML to Doc formatting)
//
// The briefing writer returns a small markdown subset: #/##/### headings,
// "- " bullets, "1. " numbered items, **bold**, *italic*, [text](url) links and
// paragraphs. Everything else is escaped text. No markdown library is in the
// dependencies, and this subset is all the prompt allows.
// ---------------------------------------------------------------------------

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
}

export function markdownToHtml(md) {
  const out = [];
  let list = null; // 'ul' | 'ol'
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      close();
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return `<html><head><meta charset="utf-8"></head><body>${out.join('\n')}</body></html>`;
}
