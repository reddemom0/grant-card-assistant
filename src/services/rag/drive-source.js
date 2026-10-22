/**
 * Granted Files RAG — read-only fetch of one file's bytes for indexing
 *
 * Read calls only: files.export for native Google files, files.get alt=media for
 * uploads. Google Docs export as plain text; Google Sheets export as xlsx so every
 * tab comes through (CSV export gives only the first). The caller passes a
 * read-only delegated client (delegatedDriveClient in src/tools/google-drive.js).
 */

import { INDEX_MAX_DOWNLOAD_BYTES } from './extract.js';

const XLSX_EXPORT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Thrown for a file that is too large to index; prepare marks it skipped, not failed. */
export class TooLargeError extends Error {
  constructor(bytes) {
    super(`file larger than ${INDEX_MAX_DOWNLOAD_BYTES} bytes`);
    this.code = 'too_large';
    this.bytes = bytes;
  }
}

/**
 * @param {Object} drive - authenticated, read-only Drive client
 * @param {{id: string, kind: string, size?: number|string}} file - kind from ragKind
 * @param {{onCall?: (method: string) => void}} [opts] - counts API calls (dry run)
 * @returns {Promise<Buffer>}
 */
export async function fetchForIndex(drive, { id, kind, size }, { onCall = () => {} } = {}) {
  if (kind === 'gdoc') {
    onCall('files.export');
    const { data } = await drive.files.export({ fileId: id, mimeType: 'text/plain' }, { responseType: 'arraybuffer' });
    return Buffer.from(data);
  }
  if (kind === 'gsheet') {
    onCall('files.export');
    const { data } = await drive.files.export({ fileId: id, mimeType: XLSX_EXPORT }, { responseType: 'arraybuffer' });
    return Buffer.from(data);
  }
  if (Number(size) > INDEX_MAX_DOWNLOAD_BYTES) throw new TooLargeError(Number(size));
  onCall('files.get(alt=media)');
  const { data } = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from(data);
}
