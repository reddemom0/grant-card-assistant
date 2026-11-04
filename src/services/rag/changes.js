/**
 * Granted Files RAG — the Drive change feed for the nightly updater
 *
 * Same approach as the filing sweep (changes.list over the Granted Files drive
 * with a stored page token), with its own code and its own token so the two
 * never consume each other's position. Unlike the sweep, it asks for
 * md5Checksum and modifiedTime, reports removed and trashed items, and expands
 * changed folders, because a folder move or rename is one change in the feed
 * while every file below it gets a new path.
 *
 * Every Drive request goes through `call(method, fn)`, which the caller wraps in
 * withDriveRetry and the shared limiter (drive-retry.js). Read-only.
 */

import { GRANTED_FILES_DRIVE_ID, FOLDER_MIME } from '../../tools/google-drive.js';

const FILE_FIELDS = 'id,name,mimeType,md5Checksum,modifiedTime,size,parents,trashed,driveId';
const direct = (_method, fn) => fn();

/** The feed position as of now. */
export async function startToken(drive, call = direct) {
  const { data } = await call('changes.getStartPageToken', () =>
    drive.changes.getStartPageToken({ driveId: GRANTED_FILES_DRIVE_ID, supportsAllDrives: true }));
  return data.startPageToken;
}

/**
 * Everything that changed since `token`. The last change per item wins.
 * Removed, trashed, or now outside the drive → `gone` (with the item's metadata
 * when Drive still returns it, e.g. a trashed folder).
 * @param {{since?: string, call?: Function}} [opts] - since: keep only changes at or after this ISO time
 * @returns {Promise<{live: Map<string, Object>, gone: Map<string, Object|null>, token: string, changes: number}>}
 */
export async function readChanges(drive, token, { since = null, call = direct } = {}) {
  const live = new Map();
  const gone = new Map();
  const sinceMs = since ? Date.parse(since) : null;
  let pageToken = token;
  let next = null;
  let changes = 0;
  while (pageToken) {
    const { data } = await call('changes.list', () => drive.changes.list({
      driveId: GRANTED_FILES_DRIVE_ID, pageToken, includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 1000,
      fields: `nextPageToken, newStartPageToken, changes(changeType, fileId, removed, time, file(${FILE_FIELDS}))`
    }));
    for (const c of data.changes || []) {
      if (c.changeType === 'drive' || !c.fileId) continue;  // the shared drive's own settings, not an item
      if (sinceMs !== null && Date.parse(c.time) < sinceMs) continue;
      changes++;
      live.delete(c.fileId);
      gone.delete(c.fileId);
      if (c.removed || !c.file || c.file.trashed || c.file.driveId !== GRANTED_FILES_DRIVE_ID) gone.set(c.fileId, c.file || null);
      else live.set(c.fileId, c.file);
    }
    next = data.newStartPageToken || next;
    pageToken = data.nextPageToken || null;
  }
  return { live, gone, token: next || token, changes };
}

/**
 * Folder path (names below the drive root) for an item, walking parents[0]
 * upward with files.get. Cached per folder for the run; at most 30 levels.
 */
export function pathResolver(drive, call = direct) {
  const cache = new Map();
  const folderPath = async (id, depth = 0) => {
    if (!id || id === GRANTED_FILES_DRIVE_ID || depth > 30) return [];
    if (cache.has(id)) return cache.get(id);
    const { data } = await call('files.get', () => drive.files.get({ fileId: id, fields: 'id,name,parents', supportsAllDrives: true }));
    const path = [...await folderPath(data.parents?.[0], depth + 1), data.name];
    cache.set(id, path);
    return path;
  };
  return {
    /** Path of the folder holding `item` (item.parents[0]). */
    parentPath: (item) => folderPath(item.parents?.[0]),
    /** Path of a folder itself, its own name last. */
    folderPath
  };
}

/**
 * Every file below a folder, breadth first, with fresh metadata and its path.
 * @param {string[]} basePath - the folder's own path (its name last)
 */
export async function filesUnder(drive, folderId, basePath, call = direct) {
  const out = [];
  const queue = [[folderId, basePath]];
  while (queue.length) {
    const [id, path] = queue.shift();
    let pageToken;
    do {
      const { data } = await call('files.list', () => drive.files.list({
        corpora: 'drive', driveId: GRANTED_FILES_DRIVE_ID, includeItemsFromAllDrives: true, supportsAllDrives: true,
        q: `'${id}' in parents and trashed = false`, fields: `nextPageToken, files(${FILE_FIELDS})`, pageSize: 1000, pageToken
      }));
      for (const item of data.files || []) {
        if (item.mimeType === FOLDER_MIME) queue.push([item.id, [...path, item.name]]);
        else out.push({ ...item, path });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
  return out;
}

/**
 * Old path of a gone folder, or null. A trashed folder is still returned by
 * files.get with its parents; a permanently deleted one is not (404).
 */
export async function goneFolderPath(drive, id, meta, resolver, call = direct) {
  let item = meta;
  if (!item?.parents) {
    try {
      ({ data: item } = await call('files.get', () => drive.files.get({ fileId: id, fields: 'id,name,mimeType,parents', supportsAllDrives: true })));
    } catch (err) {
      if ([403, 404].includes(err?.statusCode || err?.response?.status || err?.code)) return null;
      throw err;
    }
  }
  if (item?.mimeType !== FOLDER_MIME) return null;
  return [...await resolver.parentPath(item), item.name];
}
