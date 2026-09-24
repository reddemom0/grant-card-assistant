/**
 * Read files attached to Google Chat messages
 *
 * Two routes, one set of parsers (extractFileText in google-drive.js):
 * - The message that reached Oracle: its uploads are downloaded with Oracle's own
 *   Chat identity (the chat.bot service account, which may download attachments on
 *   messages the app receives). Called from src/api/chat-google.js before the agent
 *   runs.
 * - Earlier messages in the same thread: listed and downloaded as the person asking
 *   (their chat.messages.readonly grant, the same one Chat history uses), through
 *   the read_chat_attachments tool. Thread and space come from the verified Chat
 *   event, never from the model, so no other thread can be read.
 *
 * Files attached from Drive are read with the Drive reader as the person asking.
 * Nothing here is stored: callers hand the text to the agent for one turn, and
 * src/claude/client.js saves only a placeholder.
 */

import { google } from 'googleapis';
import { query } from '../database/connection.js';
import { getUserOAuth2Client } from './google-docs.js';
import { extractFileText, fileKind, MAX_DOWNLOAD_BYTES, readGoogleDriveFile } from './google-drive.js';
import { hasChatScopes, hubSignInUrl, MESSAGES } from './chat-history.js';

// Same cap the Drive reader applies to what goes to the model.
const MAX_CONTENT_CHARS = 50000;

// Earlier-thread reads: bound the work a single request can cause.
const MAX_THREAD_MESSAGES = 200;
const MAX_THREAD_FILES = 5;

/**
 * The files attached to one Chat message, in a shape the readers understand.
 * GIFs (attachedGifs) are links, not files, and are left out.
 *
 * @param {Object} message - A Chat message resource
 * @returns {Array<{kind: 'upload'|'drive', name: string, contentType?: string, resourceName?: string, fileId?: string}>}
 */
export function attachmentsOf(message) {
  const raw = [message?.attachment].flatMap(a => (Array.isArray(a) ? a : a ? [a] : []));
  const files = [];
  for (const a of raw) {
    const name = a?.contentName || 'attachment';
    if (a?.source === 'DRIVE_FILE' || a?.driveDataRef?.driveFileId) {
      if (a?.driveDataRef?.driveFileId) files.push({ kind: 'drive', name, fileId: a.driveDataRef.driveFileId });
    } else if (a?.attachmentDataRef?.resourceName) {
      files.push({ kind: 'upload', name, contentType: a.contentType || '', resourceName: a.attachmentDataRef.resourceName });
    } else {
      // An upload the API gave no download reference for: still reported, never guessed at.
      files.push({ kind: 'upload', name, contentType: a?.contentType || '', resourceName: null });
    }
  }
  return files;
}

/**
 * Download one uploaded attachment, stopping as soon as it passes the size limit.
 * The attachment metadata carries no size, so the limit is enforced on the stream.
 *
 * @param {Object} chat - Authenticated Chat API client
 * @param {string} resourceName - attachmentDataRef.resourceName
 * @returns {Promise<{buffer?: Buffer, tooLarge?: boolean}>}
 */
export async function downloadChatAttachment(chat, resourceName) {
  const res = await chat.media.download({ resourceName, alt: 'media' }, { responseType: 'stream' });
  const chunks = [];
  let bytes = 0;
  return new Promise((resolve, reject) => {
    res.data.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD_BYTES) {
        res.data.destroy();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    res.data.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
    res.data.on('error', err => (bytes > MAX_DOWNLOAD_BYTES ? resolve({ tooLarge: true }) : reject(err)));
  });
}

/**
 * Read a list of attachments. Never throws: every file comes back either with its
 * text or with the plain reason it couldn't be read.
 *
 * @param {Array} files - From attachmentsOf()
 * @param {Object} opts
 * @param {Object} opts.chat - Chat client used to download uploads
 * @param {string|null} opts.userEmail - Who is asking; Drive files are read as them
 * @returns {Promise<Array<{name: string, ok: boolean, content?: string, reason?: 'unsupported'|'too_large'|'error'}>>}
 */
export async function readAttachments(files, { chat, userEmail }) {
  const results = [];
  for (const file of files) {
    try {
      if (file.kind === 'drive') {
        const r = await readGoogleDriveFile(file.fileId, userEmail);
        const name = r.file?.name || file.name;
        if (r.tooLarge) results.push({ name, ok: false, reason: 'too_large' });
        else if (r.success) results.push({ name, ok: true, content: r.content, url: r.file?.url });
        else results.push({ name, ok: false, reason: /^Unsupported file type/.test(r.error || '') ? 'unsupported' : 'error' });
        continue;
      }

      if (!fileKind(file.contentType, file.name)) {
        results.push({ name: file.name, ok: false, reason: 'unsupported' });
        continue;
      }
      if (!file.resourceName) {
        results.push({ name: file.name, ok: false, reason: 'error' });
        continue;
      }

      const download = await downloadChatAttachment(chat, file.resourceName);
      if (download.tooLarge) {
        results.push({ name: file.name, ok: false, reason: 'too_large' });
        continue;
      }
      const { content } = await extractFileText({ buffer: download.buffer, mimeType: file.contentType, name: file.name });
      const capped = content.length > MAX_CONTENT_CHARS
        ? `${content.substring(0, MAX_CONTENT_CHARS)}\n\n[Content truncated...]`
        : content;
      console.log(`✓ Chat attachment read: ${file.kind} (${capped.length} chars)`);
      results.push({ name: file.name, ok: true, content: capped });
    } catch (err) {
      // Code only — Google's error text can carry names and addresses.
      console.warn(`⚠️  Chat attachment unreadable: ${err.code || err.response?.status || 'error'}`);
      results.push({ name: file.name, ok: false, reason: 'error' });
    }
  }
  return results;
}

/** The text block the agent receives for one readable attachment. */
export function attachmentBlockText(result) {
  return `[Chat attachment: ${result.name}]\n\n${result.content}`;
}

/** What the conversation history keeps instead of the file's text. */
export function attachmentPlaceholder(name) {
  return `[Chat attachment: ${name} — read, not stored]`;
}

/** The plain line the user sees for a file that couldn't be read. */
export function unreadableLine(result) {
  if (result.reason === 'unsupported') return `I couldn't read ${result.name} — that file type isn't supported. I can read PDF, Word (.docx), Excel (.xlsx), and text files.`;
  if (result.reason === 'too_large') return `${result.name} is over 10 MB, so I didn't read it — send a smaller export, such as just the pages or sheet you need.`;
  return `I couldn't open ${result.name}. Try sending it again, or share it as a Google Drive link.`;
}

/**
 * Tool: read files attached to earlier messages in the current Chat thread.
 *
 * @param {Object} input - { file_name?: string }
 * @param {Object} ctx - { userId, chatContext } from the executor
 */
export async function readThreadAttachments(input = {}, ctx = {}) {
  const { userId, chatContext } = ctx;

  // Thread and space come from the verified Chat event, never from the model.
  const threadName = chatContext?.threadName;
  const spaceName = chatContext?.spaceName;
  if (!userId || !threadName || !spaceName) {
    return { success: false, error: 'I can only read attachments from the Chat thread this conversation is in.' };
  }

  const scopeCheck = await hasChatScopes(userId);
  if (!scopeCheck.ok) {
    return { success: false, needs_reconsent: true, error: MESSAGES.needsReconsent(hubSignInUrl()) };
  }

  let chat;
  try {
    chat = google.chat({ version: 'v1', auth: await getUserOAuth2Client(userId) });
  } catch (err) {
    return { success: false, error: MESSAGES.needsReconsent(hubSignInUrl()) };
  }

  const userRow = await query('SELECT email FROM users WHERE id = $1', [userId]).catch(() => ({ rows: [] }));
  const userEmail = userRow.rows[0]?.email || null;

  try {
    const files = [];
    let pageToken;
    let seen = 0;
    do {
      const res = await chat.spaces.messages.list({
        parent: spaceName,
        filter: `thread.name = "${threadName}"`,
        pageSize: 100,
        orderBy: 'createTime DESC',
        pageToken
      });
      for (const m of res.data.messages || []) {
        seen += 1;
        files.push(...attachmentsOf(m));
      }
      pageToken = seen < MAX_THREAD_MESSAGES ? res.data.nextPageToken : null;
    } while (pageToken);

    const wanted = String(input.file_name || '').trim().toLowerCase();
    const matching = wanted ? files.filter(f => f.name.toLowerCase().includes(wanted)) : files;
    if (matching.length === 0) {
      return {
        success: true,
        files: [],
        note: wanted
          ? `No attachment matching "${input.file_name}" in this thread.`
          : 'No files are attached in this thread.'
      };
    }

    const results = await readAttachments(matching.slice(0, MAX_THREAD_FILES), { chat, userEmail });
    return {
      success: true,
      files: results.map(r => (r.ok
        ? { name: r.name, content: r.content, ...(r.url ? { url: r.url } : {}) }
        : { name: r.name, unreadable: unreadableLine(r) })),
      ...(matching.length > MAX_THREAD_FILES
        ? { note: `This thread has ${matching.length} matching files; read the ${MAX_THREAD_FILES} most recent. Name the file to read another.` }
        : {})
    };
  } catch (err) {
    console.warn(`⚠️  Thread attachments unreadable: ${err.code || err.response?.status || 'error'}`);
    return { success: false, error: 'I couldn\'t read the files in this thread.' };
  }
}
