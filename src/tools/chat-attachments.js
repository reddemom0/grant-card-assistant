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
 * A Chat client and email for the person asking, or the reason there isn't one.
 * Thread reads always run as them, never as Oracle.
 */
async function askerChat(userId) {
  const scopeCheck = await hasChatScopes(userId);
  if (!scopeCheck.ok) {
    return { error: MESSAGES.needsReconsent(hubSignInUrl()), needs_reconsent: true };
  }
  let chat;
  try {
    chat = google.chat({ version: 'v1', auth: await getUserOAuth2Client(userId) });
  } catch {
    return { error: MESSAGES.needsReconsent(hubSignInUrl()), needs_reconsent: true };
  }
  const userRow = await query('SELECT email FROM users WHERE id = $1', [userId]).catch(() => ({ rows: [] }));
  return { chat, userEmail: userRow.rows[0]?.email || null };
}

/** Messages in one thread, newest first, up to MAX_THREAD_MESSAGES. */
async function listThreadMessages(chat, spaceName, threadName) {
  const messages = [];
  let pageToken;
  do {
    const res = await chat.spaces.messages.list({
      parent: spaceName,
      filter: `thread.name = "${threadName}"`,
      pageSize: 100,
      orderBy: 'createTime DESC',
      pageToken
    });
    messages.push(...(res.data.messages || []));
    pageToken = messages.length < MAX_THREAD_MESSAGES ? res.data.nextPageToken : null;
  } while (pageToken);
  return messages.slice(0, MAX_THREAD_MESSAGES);
}

/**
 * The whole current thread, oldest first, as the person asking: who said what and
 * when, plus the files attached anywhere in it. For /learn-this.
 *
 * @param {Object} ctx - { userId, chatContext }
 * @returns {Promise<{success: boolean, messages?: Array, files?: Array, chat?: Object, userEmail?: string, error?: string}>}
 */
export async function readThreadTranscript(ctx = {}) {
  const { userId, chatContext } = ctx;
  const threadName = chatContext?.threadName;
  const spaceName = chatContext?.spaceName;
  if (!userId || !threadName || !spaceName) {
    return { success: false, error: 'Reply with /learn-this inside the thread you want me to learn from.' };
  }

  const asker = await askerChat(userId);
  if (asker.error) return { success: false, error: asker.error };

  try {
    const raw = (await listThreadMessages(asker.chat, spaceName, threadName)).reverse();

    const { resolveSenderNames } = await import('./directory-names.js');
    const names = await resolveSenderNames(raw.map(m => m.sender).filter(Boolean), { userId })
      .catch(() => new Map());

    return {
      success: true,
      chat: asker.chat,
      userEmail: asker.userEmail,
      messages: raw.map(m => ({
        sender: m.sender?.displayName || names.get(m.sender?.name) || 'someone outside Granted',
        time: m.createTime,
        text: m.text || '',
        files: attachmentsOf(m).map(f => f.name)
      })),
      files: raw.flatMap(m => attachmentsOf(m))
    };
  } catch (err) {
    console.warn(`⚠️  Thread transcript unreadable: ${err.code || err.response?.status || 'error'}`);
    return { success: false, error: 'I couldn\'t read this thread.' };
  }
}

/** /learn-this in a DM with the command alone: this far back, at most this many. */
export const DM_LEARN_WINDOW_MS = 10 * 60 * 1000;
export const DM_LEARN_MAX_MESSAGES = 5;

/**
 * The person's own recent messages in a DM, oldest first: sent by them, within
 * the window, not the /learn-this message itself, at most max. Pure.
 *
 * @param {Array} messages - Chat message resources, any order
 * @param {Object} opts - { senderChatId, excludeMessageName, now, windowMs, max }
 * @returns {Array}
 */
export function selectRecentOwnMessages(messages, {
  senderChatId,
  excludeMessageName = null,
  now = Date.now(),
  windowMs = DM_LEARN_WINDOW_MS,
  max = DM_LEARN_MAX_MESSAGES
} = {}) {
  const since = now - windowMs;
  return (messages || [])
    .filter(m => m?.sender?.name && m.sender.name === senderChatId)
    .filter(m => m.name !== excludeMessageName)
    .filter(m => {
      const t = Date.parse(m.createTime);
      return Number.isFinite(t) && t >= since && t <= now;
    })
    .sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime))
    .slice(0, max)
    .reverse();
}

/**
 * /learn-this alone in a DM: the person's own recent messages there (last ten
 * minutes, at most five), as the person asking, with their files.
 *
 * @param {Object} ctx - { userId, chatContext }
 * @returns {Promise<{success: boolean, messages?: Array, files?: Array, chat?: Object, userEmail?: string, error?: string}>}
 */
export async function readRecentDmMessages(ctx = {}) {
  const { userId, chatContext } = ctx;
  if (!userId || !chatContext?.spaceName || !chatContext?.senderChatId) {
    return { success: false, error: 'I couldn\'t read this conversation.' };
  }

  const asker = await askerChat(userId);
  if (asker.error) return { success: false, error: asker.error };

  try {
    const since = new Date(Date.now() - DM_LEARN_WINDOW_MS).toISOString();
    const res = await asker.chat.spaces.messages.list({
      parent: chatContext.spaceName,
      filter: `create_time > "${since}"`,
      pageSize: 50,
      orderBy: 'createTime DESC'
    });
    const picked = selectRecentOwnMessages(res.data.messages || [], {
      senderChatId: chatContext.senderChatId,
      excludeMessageName: chatContext.messageName
    });
    return {
      success: true,
      chat: asker.chat,
      userEmail: asker.userEmail,
      messages: picked.map(m => ({
        sender: chatContext.senderDisplayName || m.sender?.displayName || 'you',
        time: m.createTime,
        text: m.text || '',
        files: attachmentsOf(m).map(f => f.name)
      })),
      files: picked.flatMap(m => attachmentsOf(m))
    };
  } catch (err) {
    console.warn(`⚠️  Recent DM messages unreadable: ${err.code || err.response?.status || 'error'}`);
    return { success: false, error: 'I couldn\'t read your recent messages here.' };
  }
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

  const asker = await askerChat(userId);
  if (asker.error) return { success: false, needs_reconsent: asker.needs_reconsent, error: asker.error };
  const { chat, userEmail } = asker;

  try {
    const files = (await listThreadMessages(chat, spaceName, threadName)).flatMap(m => attachmentsOf(m));

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
