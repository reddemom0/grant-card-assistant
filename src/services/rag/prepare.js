/**
 * Granted Files RAG — one file from Drive metadata to a drive_files row and chunks
 *
 * Order: exclusion → type check → fetch → extract → scanned check → redact each
 * segment → chunk. No database access: the indexer (phase 2) writes the result.
 * Never logs file text or redacted values; status_reason carries a short code.
 */

import { exclusionReason } from './exclude.js';
import { pathMeta } from './path-meta.js';
import { ragKind, extractForIndex } from './extract.js';
import { redact, addCounts } from './redact.js';
import { chunkSegments } from './chunk.js';

/**
 * @param {{id: string, name: string, mimeType: string, path: string[], md5Checksum?: string,
 *   modifiedTime?: string, size?: number|string}} file - path = folder names below the root
 * @param {(file: Object) => Promise<Buffer>} fetchBytes - only called for files that will be extracted
 * @returns {Promise<{row: Object, chunks: Object[]}>}
 */
export async function prepareFile(file, fetchBytes) {
  const meta = pathMeta(file.path);
  const row = {
    file_id: file.id,
    md5: file.md5Checksum || null,
    name: file.name,
    path: file.path.join('/'),
    ...meta,
    mime: file.mimeType,
    modified_time: file.modifiedTime || null,
    status: null,
    status_reason: null,
    truncated: false,
    token_count: null,
    chunk_count: null,
    redaction_counts: { sin: 0, card: 0, bank: 0 }
  };
  const done = (status, reason = null, chunks = []) => ({ row: { ...row, status, status_reason: reason }, chunks });

  const excluded = exclusionReason({ path: file.path, name: file.name });
  if (excluded) return done('excluded', excluded);

  const kind = ragKind(file.mimeType, file.name);
  if (!kind) return done('skipped', `type:${typeLabel(file.mimeType)}`);

  let extracted;
  try {
    const buffer = await fetchBytes({ ...file, kind });
    extracted = await extractForIndex({ kind, buffer });
  } catch (err) {
    if (err.code === 'too_large') return done('skipped', 'too_large');
    return done('failed', `${kind}:${errorCode(err)}`);
  }

  row.truncated = extracted.truncated;
  if (extracted.scanned) return done('scanned', `pages:${extracted.pages}`);
  if (!extracted.segments.length) return done('skipped', 'empty');

  const segments = extracted.segments.map(seg => {
    const body = redact(seg.text);
    addCounts(row.redaction_counts, body.counts);
    if (seg.header === undefined) return { ...seg, text: body.text };
    const head = redact(seg.header);
    addCounts(row.redaction_counts, head.counts);
    return { ...seg, text: body.text, header: head.text };
  });

  const chunks = chunkSegments(segments).map(c => ({ ...c, file_id: file.id, area: meta.area, year: meta.year }));
  row.token_count = extracted.tokens;
  row.chunk_count = chunks.length;
  return done('indexed', null, chunks);
}

function typeLabel(mimeType) {
  const t = String(mimeType || '');
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/') || t.startsWith('audio/')) return 'media';
  if (t === 'application/vnd.google-apps.presentation' || /presentationml|ms-powerpoint/.test(t)) return 'slides';
  if (t === 'application/vnd.google-apps.shortcut') return 'shortcut';
  if (t === 'application/vnd.google-apps.folder') return 'folder';
  return 'other';
}

// A short, value-free code for status_reason: an HTTP status or error code, else the error class.
function errorCode(err) {
  return String(err?.response?.status || err?.code || err?.name || 'error').slice(0, 40);
}
