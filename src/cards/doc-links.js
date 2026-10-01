/**
 * Google Drive files a Chat message points at — for cards that show an
 * "Open doc" link. Three sources, the same ones readDriveFiles in
 * src/api/chat-google.js reads: files attached from Drive, rich-link chips,
 * and Docs/Sheets/Slides/Drive URLs in the text. The pattern below is a copy
 * of DRIVE_URL there; keep the two in step.
 *
 * Pure functions, no I/O. Names come along only when Chat already gives one
 * (an attachment's contentName); anything else is read later, as the asker.
 */

const DRIVE_URL = /https:\/\/(?:docs\.google\.com\/(?:document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/|drive\.google\.com\/(?:file\/d\/|open\?id=))([A-Za-z0-9_-]{10,})/g;

export const MAX_DOC_LINKS = 5;

/**
 * @param {Object} message - a Chat API message (text, attachment, annotations)
 * @returns {Array<{fileId: string, name: string|null, url: string|null}>}
 */
export function driveFilesOf(message) {
  const found = new Map();
  const add = (fileId, { name = null, url = null } = {}) => {
    if (!fileId) return;
    const prior = found.get(fileId);
    found.set(fileId, { fileId, name: prior?.name || name || null, url: prior?.url || url || null });
  };

  const attachments = [message?.attachment].flatMap(a => (Array.isArray(a) ? a : a ? [a] : []));
  for (const a of attachments) {
    if (a?.driveDataRef?.driveFileId) add(a.driveDataRef.driveFileId, { name: a.contentName || null });
  }
  for (const ann of message?.annotations || []) {
    const rich = ann?.richLinkMetadata;
    const id = rich?.driveLinkData?.driveDataRef?.driveFileId;
    if (id) add(id, { url: rich.uri || null });
  }
  for (const m of String(message?.text || '').matchAll(DRIVE_URL)) add(m[1], { url: m[0] });

  return [...found.values()].slice(0, MAX_DOC_LINKS);
}

/** Where to open a file: the link as written, else Drive's own address for it. */
export function openUrl(file) {
  return file?.url || (file?.fileId ? `https://drive.google.com/open?id=${encodeURIComponent(file.fileId)}` : null);
}
