/**
 * Google Chat adapter for Oracle
 *
 * A thin transport. Chat event in -> resolve identity -> run the SAME agent
 * loop the Hub uses -> post the reply back into the space. Oracle's prompt,
 * tools and behaviour are untouched; nothing here is Chat-specific except
 * verification, identity resolution and text formatting.
 *
 * Precedent: src/api/hubspot-webhook.js drives internal-oracle headlessly with
 * `res: null`. Every SSE emitter in the agent loop is null-guarded, so the loop
 * runs identically without an HTTP response object.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * - No streaming or progressive message edits (decided against for Phase 1).
 * - No change to POST /api/chat or to the agent loop itself.
 */

import { google } from 'googleapis';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';
import { runAgent } from '../claude/client.js';
import { createConversation, saveMessage } from '../database/messages.js';
import { query } from '../database/connection.js';
import { tryHandleConfirmation, currentPendingId, proposalNotice } from './confirmation.js';
import { hubSignInUrl } from '../tools/chat-history.js';
import { attachmentsOf, readAttachments, attachmentBlockText, unreadableLine } from '../tools/chat-attachments.js';
import { isListenSpace } from '../chat-listen/config.js';
import { takeCardReply, findAppCommand } from '../cards/registry.js';

// Which service account signs inbound requests depends on how the Chat app is
// built, and the two Google docs disagree:
//
//   - A CLASSIC Chat app is signed by chat@system.gserviceaccount.com, which is
//     what developers.google.com/workspace/chat/verify-requests-from-chat
//     documents as universal.
//   - A Chat app built as a GOOGLE WORKSPACE ADD-ON is signed by that add-on
//     DEPLOYMENT's own service account — see
//     developers.google.com/workspace/add-ons/guides/alternate-runtimes, which
//     verifies `payload.email === SERVICE_ACCOUNT_EMAIL`.
//
// This app is a Workspace add-on, so the issuer is deployment-specific and
// cannot be a constant. Find it in the Cloud console under Google Workspace
// Marketplace SDK -> HTTP Deployments -> Authorization Resource.
//
// The AUDIENCE check is unchanged and still the endpoint URL: when this was
// misconfigured the failure was an email-claim mismatch, not a verifyIdToken
// throw, which proves the signature and audience were already validating.
const CHAT_ISSUER_EMAIL = () => process.env.GOOGLE_CHAT_ISSUER_EMAIL;

// Chat's API caps a message at 32,000 bytes, but the Chat UI truncates display
// around 4,096 characters. Split well under the display limit so nothing is
// hidden from the reader.
const MAX_CHUNK_CHARS = 3500;

// Reused across requests; holds Google's cached signing certs.
const oauthClient = new google.auth.OAuth2();

/**
 * Verify the request genuinely came from Google Chat.
 *
 * We use the "HTTP endpoint URL" audience mode, so the bearer is an OIDC ID
 * token whose `aud` is our exact endpoint URL. That binds the token to this
 * endpoint — a token minted for a different Chat app in the same Cloud project
 * cannot be replayed here.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ok: boolean, reason: string|null}>} reason never contains the token
 */
async function verifyChatRequest(req) {
  const audience = process.env.GOOGLE_CHAT_AUDIENCE;
  const expectedIssuer = CHAT_ISSUER_EMAIL();

  // Fail closed when unconfigured, rather than defaulting to allow. Both values
  // are required: without the issuer we would have to accept any Google-signed
  // token carrying our audience, which is a weaker check, not an equivalent one.
  if (typeof audience !== 'string' || audience.length === 0) {
    return { ok: false, reason: 'GOOGLE_CHAT_AUDIENCE not configured' };
  }
  if (typeof expectedIssuer !== 'string' || expectedIssuer.length === 0) {
    return { ok: false, reason: 'GOOGLE_CHAT_ISSUER_EMAIL not configured' };
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return { ok: false, reason: 'missing bearer token' };
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    return { ok: false, reason: 'empty bearer token' };
  }

  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();

    // Exact match, still requiring a verified email — only the expected value
    // moved from a hardcoded constant to configuration.
    if (payload?.email_verified !== true || payload?.email !== expectedIssuer) {
      // Log the received issuer so a future misconfiguration is diagnosable
      // without another deploy. Safe: reaching this line means the token was
      // Google-signed AND carried our audience, so an attacker cannot get an
      // arbitrary value logged here. A service account email is an identifier,
      // not a secret, and no part of the token is logged.
      console.error(`❌ Chat token issuer mismatch — expected ${expectedIssuer}, got ${payload?.email || '(none)'} (email_verified: ${payload?.email_verified})`);
      return { ok: false, reason: 'token not issued by the expected service account' };
    }
    return { ok: true, reason: null };
  } catch (err) {
    // Signature, audience, and expiry failures all land here.
    return { ok: false, reason: `token verification failed: ${err.message}` };
  }
}

/**
 * Resolve the Chat sender to a Hub user. Exported for testing.
 * @param {string} email
 * @returns {Promise<Object|null>} users row, or null when unknown/inactive
 */
export async function resolveUser(email) {
  if (!email) return null;
  const r = await query(
    `SELECT id, email, name, is_active, google_refresh_token
     FROM users
     WHERE LOWER(email) = LOWER($1) AND is_active = true`,
    [email.trim()]
  );
  return r.rows[0] || null;
}

/**
 * Normalize a Chat event into one shape, whichever wire format arrived.
 * Exported for testing.
 *
 * TWO PAYLOAD SHAPES EXIST and they are not compatible:
 *
 *   Classic Chat app:
 *     { type: 'MESSAGE', message: {...}, space: {...} }
 *
 *   Google Workspace add-on (what this app is deployed as):
 *     { chat: { messagePayload: { message: {...}, space: {...} } } }
 *
 * The add-on shape has NO top-level `type` — the interaction is identified by
 * which container is present (messagePayload, addedToSpacePayload,
 * buttonClickedPayload...). Reading the classic shape against an add-on payload
 * silently yields undefined everywhere, which is exactly how this broke the
 * first time. Both are handled so a config change cannot break it again.
 *
 * Field preference: `thread.name` and `space.name` are Chat API resource names
 * (`spaces/X/threads/Y`) and are what the API needs to post a reply.
 * `threadKey`/`displayName` are weaker identifiers documented for the add-on
 * shape, used only as a fallback.
 *
 * @param {Object} body - raw req.body
 * @returns {Object} normalized descriptor; `eventType` is null when unrecognized
 */
export function normalizeChatEvent(body) {
  const base = {
    shape: 'unrecognized',
    eventType: null,
    container: null,
    message: null,
    space: null,
    senderEmail: null,
    senderType: null,
    senderChatId: null,
    text: '',
    hasAttachments: false,
    attachmentCount: 0,
    threadId: null,
    threadIsResourceName: false,
    spaceId: null,
    spaceIsResourceName: false,
    spaceDisplayName: null,
    isDm: false,
    messageName: null,
    senderDisplayName: null,
    actorChatId: null,
    actorEmail: null,
    actorName: null,
    parameters: {},
    appCommandId: null,
    mentions: [],
    mentionsAll: false,
    appMentions: 0,
    driveFiles: [],
    files: [],
    isDialogEvent: false,
    dialogEventType: null,
    formInputs: {}
  };

  if (!body || typeof body !== 'object') return base;

  let shape = null;
  let payload = null;
  let eventType = null;
  let container = null;

  if (body.chat && typeof body.chat === 'object') {
    shape = 'workspace-addon';
    // Find the *Payload container; its name identifies the interaction.
    container = Object.keys(body.chat).find(k => k.endsWith('Payload')) || null;
    if (container) {
      payload = body.chat[container];
      eventType = container === 'messagePayload'
        ? 'MESSAGE'
        : container.replace(/Payload$/, '');
    }
  } else if (typeof body.type === 'string') {
    shape = 'classic';
    eventType = body.type;
    payload = body;
    container = 'type';
  }

  if (!payload) {
    return { ...base, shape: shape || 'unrecognized', container, eventType };
  }

  const message = payload.message || null;
  const space = payload.space || null;

  // PRESENCE ONLY — nothing here reads, downloads or inspects a file. It exists
  // so the reply can admit the file was ignored instead of answering as if it
  // had been read. Both wire shapes carry the same `message` object, so one
  // check covers the add-on and classic forms. Tolerates a single object as
  // well as a list, since the shape is not verified against a live payload here.
  //
  // A file added from Drive is left out. Chat sends it as an attachment with
  // source DRIVE_FILE and a driveDataRef, but it points at a Drive file Oracle
  // can read with its Drive tools — counting it made the notice claim a file
  // was ignored while Oracle was reading that same file.
  const pointsToDrive = (a) => a?.source === 'DRIVE_FILE' || Boolean(a?.driveDataRef?.driveFileId);
  const attachments = [message?.attachment, message?.attachedGifs]
    .flatMap(a => (Array.isArray(a) ? a : a ? [a] : []))
    .filter(a => !pointsToDrive(a));

  // Prefer resource names; fall back to the add-on's weaker identifiers.
  const threadId = message?.thread?.name || message?.thread?.threadKey || null;
  const spaceId = space?.name || space?.displayName || null;

  return {
    shape,
    eventType,
    container,
    message,
    space,
    senderEmail: message?.sender?.email || null,
    senderType: message?.sender?.type || null,
    // The sender's canonical Chat id (users/NNN). A Chat @mention annotation
    // carries this and never an email, so it is the only way to recognise a
    // mention of this person. Learned here and remembered, because the Hub has
    // no Chat event to learn it from.
    senderChatId: message?.sender?.name || null,
    // argumentText has the app's @mention stripped; in a space `text` still
    // contains the app name.
    text: (message?.argumentText || message?.text || '').trim(),
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
    threadId,
    threadIsResourceName: Boolean(message?.thread?.name),
    spaceId,
    spaceIsResourceName: Boolean(space?.name),
    spaceDisplayName: space?.displayName || null,
    // Chat has spelled this three ways over the years; accept all of them rather
    // than guess which one this deployment sends.
    isDm: space?.type === 'DM'
      || space?.spaceType === 'DIRECT_MESSAGE'
      || space?.singleUserBotDm === true,
    messageName: message?.name || null,
    senderDisplayName: message?.sender?.displayName || null,
    // Who pressed a button (or otherwise interacted). On a button press the
    // message's sender is Oracle itself, so this is the only place the person is.
    actorChatId: body.chat?.user?.name || null,
    actorEmail: body.chat?.user?.email || null,
    actorName: body.chat?.user?.displayName || null,
    parameters: readParameters(body.commonEventObject?.parameters),
    appCommandId: payload.appCommandMetadata?.appCommandId ?? null,
    mentions: readMentions(message),
    // @all is not a person: it never becomes a reviewer or a holder.
    mentionsAll: (message?.annotations || []).some(a => a?.userMention?.user?.name === 'users/all'),
    // How many times an app was @mentioned. readMentions drops these, because
    // an app is never a reviewer or an invitee — but a card still needs to tell
    // "they addressed me" from "they named me as a participant". In a space
    // every "@Oracle …" carries one; a second is Oracle named as a person, and
    // in a DM, where no mention is needed to be heard, even the first is.
    appMentions: (message?.annotations || [])
      .filter(a => a?.type === 'USER_MENTION' && a.userMention?.user?.type === 'BOT').length,
    driveFiles: readDriveFiles(message),
    // Every file on the message, uploads and Drive attachments alike, for the
    // attachment reader (src/tools/chat-attachments.js). Names and references only.
    files: attachmentsOf(message),
    // Card dialogs (add-on Developer Preview; used only when TRACK_DIALOGS_ENABLED).
    isDialogEvent: payload.isDialogEvent === true,
    dialogEventType: payload.dialogEventType || null,
    formInputs: readFormInputs(body.commonEventObject?.formInputs)
  };
}

/** Add-on action parameters arrive as a map; tolerate a key/value list too. */
function readParameters(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.filter(p => p?.key).map(p => [p.key, String(p.value ?? '')]));
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? '')]));
}

/** Dialog form values: {name: [values]}. Values are never logged. */
function readFormInputs(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw).map(([name, input]) => [
    name,
    (input?.stringInputs?.value || []).map(v => String(v ?? ''))
  ]));
}

/** People @mentioned in a message, excluding apps (Oracle itself) and @all. */
function readMentions(message) {
  const seen = new Set();
  const out = [];
  for (const a of message?.annotations || []) {
    const user = a?.type === 'USER_MENTION' ? a.userMention?.user : null;
    if (!user?.name || user.type === 'BOT' || user.name === 'users/all' || seen.has(user.name)) continue;
    seen.add(user.name);
    out.push({ chatUserId: user.name, displayName: user.displayName || null });
  }
  return out;
}

const DRIVE_URL = /https:\/\/(?:docs\.google\.com\/(?:document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/|drive\.google\.com\/(?:file\/d\/|open\?id=))([A-Za-z0-9_-]{10,})/g;

/**
 * Google Drive files a message points at: files attached from Drive, rich link
 * chips, and plain Docs/Sheets/Slides/Drive URLs in the text. Ids only — no
 * file is read here.
 */
function readDriveFiles(message) {
  const ids = new Set();
  const attachments = [message?.attachment].flatMap(a => (Array.isArray(a) ? a : a ? [a] : []));
  for (const a of attachments) {
    if (a?.driveDataRef?.driveFileId) ids.add(a.driveDataRef.driveFileId);
  }
  for (const ann of message?.annotations || []) {
    const id = ann?.richLinkMetadata?.driveLinkData?.driveDataRef?.driveFileId;
    if (id) ids.add(id);
  }
  for (const m of String(message?.text || '').matchAll(DRIVE_URL)) ids.add(m[1]);
  return [...ids].slice(0, 20).map(fileId => ({ fileId }));
}

/**
 * Canonical event name, so one branch catches both wire spellings.
 *
 * The add-on shape derives its type from the payload container and yields
 * camelCase ('addedToSpace'); the classic shape sends SCREAMING_SNAKE
 * ('ADDED_TO_SPACE'). Comparing canonical forms means no branch is written
 * against one spelling and silently dead for the other — which is exactly how
 * the existing MESSAGE-only handling hid these events.
 *
 * @param {string} eventType
 * @returns {string} e.g. 'addedtospace'
 */
export function canonicalEventType(eventType) {
  return String(eventType || '').replace(/_/g, '').toLowerCase();
}

/**
 * Map a Chat thread to a stable Oracle conversation UUID. Exported for testing.
 *
 * Deterministic (uuid v5) rather than stored in a mapping table: the same
 * thread always yields the same UUID, and createConversation is idempotent, so
 * no extra table and no migration are needed.
 *
 * Falls back to the space when a thread is absent, which makes a DM one
 * continuous conversation.
 *
 * @param {Object} evt - a normalizeChatEvent() result
 * @returns {{conversationId: string, key: string}}
 */
export function conversationIdForEvent(evt) {
  const key = evt?.threadId || evt?.spaceId;
  if (!key) throw new Error('Chat event carries neither a thread nor a space identifier');
  return { conversationId: uuidv5(key, uuidv5.URL), key };
}

/**
 * Normalize markdown headings for Google Chat.
 *
 * Messages are posted with markupSyntax: MARKUP_SYNTAX_MARKDOWN, so Chat
 * parses **bold**, *italic*, ~~strike~~, `code`, ``` blocks, bullets,
 * numbered lists, block quotes and [text](url) itself. Headings are the one
 * markdown element it does not implement, so they are rewritten to bold here.
 *
 * Note the bold marker is '**', not '*'. Under native markdown a single
 * asterisk is ITALIC — the legacy Chat syntax this function used to emit
 * would silently change every heading's weight.
 *
 * @param {string} md
 * @returns {string}
 */
export function markdownToChat(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }
    // Never rewrite inside a fenced code block — a shell snippet's '# comment'
    // is a comment, not a heading.
    if (inCodeFence) {
      out.push(line);
      continue;
    }

    // '### Heading' -> '**Heading**' (Chat markdown has no heading syntax)
    out.push(line.replace(/^\s*#{1,6}\s+(.*?)\s*$/, (_m, t) => `**${t}**`));
  }

  return out.join('\n').trim();
}

/**
 * The message Oracle runs on when someone sends files with no text. It says what
 * happened rather than inventing a question for them.
 */
export const FILE_ONLY_MESSAGE =
  '[Files sent without a message. Say briefly what each attached file is, then ask what they would like done with it.]';

/**
 * Said when a message is accepted but Oracle does not run on it. Plain language,
 * nothing internal. An unknown sender and a known one with no stored Google
 * tokens get the same sentence, in spaces and DMs alike, so the reply never says
 * whether an account exists.
 */
export const NOT_RUN_REPLIES = {
  signIn: (signInUrl) =>
    `I don't recognize your account yet. Sign in once at ${signInUrl}, then message me again.`,
  tryAgain: 'Something went wrong on my end. Please try again in a minute.'
};

const FENCE_LINE = /^\s*```/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
const FENCE_CLOSE = '```';

/**
 * Where to cut a chunk that has grown too long, preferring readable seams.
 *
 * Returns an index into `lines` to break BEFORE, or -1 to break at the current
 * line. A blank line is the best seam (paragraph boundary); failing that, the
 * start of a list item, so a bulleted list never splits mid-item.
 */
function preferredBreakIndex(lines) {
  for (let i = lines.length - 1; i > 0; i--) {
    if (lines[i].trim() === '') return i;
  }
  for (let i = lines.length - 1; i > 0; i--) {
    if (LIST_ITEM.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Split text into chunks Chat will display in full.
 *
 * Line-based and fence-aware. The old paragraph splitter had no idea what a code
 * fence was, so a fenced block spanning the limit posted as two messages with one
 * ``` in each: the first rendered as an unterminated block, the second as literal
 * backticks. Here, a chunk that has to end inside a fence closes it, and the next
 * chunk reopens it with the SAME opening line — so ```js stays ```js — and every
 * chunk is independently balanced.
 *
 * Seam preference: blank line, then between list items, then any line end. Only a
 * single line longer than the limit is cut mid-line.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string[]}
 */
export function splitForChat(text, limit = MAX_CHUNK_CHARS) {
  if (!text) return [];
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = [];
  let openFence = null;   // the exact opening line while inside a fence

  const lengthOf = (arr) => arr.reduce((n, l) => n + l.length + 1, 0);

  // Close an open fence, emit, and reopen it at the head of the next chunk.
  const emit = (upto) => {
    const take = upto === -1 ? current.length : upto;
    const body = current.slice(0, take);
    if (!body.length) return false;

    const rest = current.slice(upto === -1 ? take : (current[take]?.trim() === '' ? take + 1 : take));
    chunks.push(openFence ? [...body, FENCE_CLOSE].join('\n') : body.join('\n'));
    current = openFence ? [openFence, ...rest] : rest;
    return true;
  };

  for (const rawLine of text.split('\n')) {
    // Reserve room for the fence we may have to close at the end of this chunk.
    const reserve = openFence ? FENCE_CLOSE.length + 1 : 0;
    const room = Math.max(1, limit - reserve);

    // A single line longer than a whole chunk is the one case we cut mid-line.
    const pieces = rawLine.length > room
      ? rawLine.match(new RegExp(`.{1,${room}}`, 'g')) || [rawLine]
      : [rawLine];

    for (const piece of pieces) {
      const cost = piece.length + (current.length ? 1 : 0);
      if (current.length && lengthOf(current) + cost + reserve > limit) {
        // Prefer a readable seam, but never hunt for one inside a code block —
        // there the fence close/reopen is the seam.
        if (!emit(openFence ? -1 : preferredBreakIndex(current))) emit(-1);
      }
      current.push(piece);
    }

    if (FENCE_LINE.test(rawLine)) {
      openFence = openFence ? null : rawLine;
    }
  }

  if (current.length) {
    // Never emit a trailing chunk that is only a reopened fence.
    const tail = current.join('\n');
    if (tail.trim() !== (openFence || '').trim()) chunks.push(tail);
  }

  return chunks;
}

/**
 * Build an authenticated Chat API client.
 *
 * Uses GOOGLE_SERVICE_ACCOUNT_KEY with the chat.bot scope. That service account
 * must also be the one the Chat app is configured with, or posts are rejected.
 */
function createChatClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/chat.bot']
  });
  return google.chat({ version: 'v1', auth });
}

/**
 * Post one or more messages back into the originating thread.
 * @param {Object} event - the original Chat event
 * @param {string} text - already converted to Chat formatting
 */
async function postToChat(evt, text) {
  const chat = createChatClient();

  // The API needs a resource name (`spaces/XXX`). If only a displayName came
  // through, the create call will fail — say so up front so the cause is
  // obvious in the log rather than buried in a Google API error.
  if (!evt.spaceIsResourceName) {
    console.warn(`⚠️  Posting with a non-resource-name space identifier ("${evt.spaceId}") — the Chat API expects "spaces/XXX" and will likely reject this.`);
  }

  const chunks = splitForChat(text);
  console.log(`📤 Posting ${chunks.length} message(s) to ${evt.spaceId}`);

  for (const chunk of chunks) {
    await chat.spaces.messages.create(buildMessageRequest(evt, chunk));
  }
}

/**
 * Build one spaces.messages.create request.
 *
 * REPLYING vs STARTING A THREAD. messageReplyOption only makes sense with a
 * thread to reply into: sent without one, Chat rejects the whole call with
 * "The request does not specify which message to reply to" — which is exactly
 * what happened to the first space intro, since an addedToSpace event carries no
 * message and therefore no thread. So both fields travel together or neither
 * does, and a post with no thread is simply a new top-level message.
 *
 * Exported for tests: the failure is a server-side rejection, invisible until it
 * happens in a real space.
 *
 * @param {Object} evt - a normalizeChatEvent() result
 * @param {string} chunk - one already-split, already-converted message
 * @returns {Object} args for chat.spaces.messages.create
 */
export function buildMessageRequest(evt, chunk) {
  // Only a real resource name is valid as a thread; threadKey is not.
  const inThread = Boolean(evt?.threadIsResourceName && evt?.threadId);

  return {
    parent: evt?.spaceId,
    // Keep the reply in the originating thread; start a new one if that thread
    // has gone away. Omitted entirely when there is no thread.
    ...(inThread ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : {}),
    requestBody: {
      text: chunk,
      // Parse the body as standard Markdown rather than Chat's legacy syntax
      // (GA 2026-08-07). Without this, '**bold**' renders as literal
      // asterisks — the failure is silent, so if formatting ever looks wrong
      // in Chat, check this field first.
      markupSyntax: 'MARKUP_SYNTAX_MARKDOWN',
      ...(inThread ? { thread: { name: evt.threadId } } : {})
    }
  };
}

/**
 * Prepend the lines about files that couldn't be read.
 *
 * Prepended, not appended, and added before splitting — so they land at the top
 * of the first chunk, where someone who sent a file will actually see them,
 * rather than at the end of a reply that may be several messages long.
 *
 * @param {string[]} notes - one plain line per unreadable file
 * @param {string} reply
 * @returns {string}
 */
export function withAttachmentNotes(notes, reply) {
  if (!notes?.length) return reply;
  return `${notes.join('\n')}\n\n${reply}`.trim();
}

/**
 * Post a reply, swallowing errors so a post-back failure cannot crash the
 * background task. This is the ONE place where the user may get silence, so it
 * logs loudly.
 *
 * @returns {Promise<boolean>} whether the post went through
 */
async function safePost(evt, text) {
  try {
    await postToChat(evt, text);
    console.log('✅ Chat reply delivered');
    return true;
  } catch (err) {
    console.error('❌ Google Chat post-back FAILED — user received nothing:', err.message);
    return false;
  }
}

/**
 * Post a new top-level message into a space as the Oracle app, outside any
 * Chat event. Used for the one-time notice that a space is being copied
 * (src/chat-listen/subscriptions.js).
 *
 * @param {string} spaceName - resource name, spaces/XXX
 * @param {string} text - markdown
 * @returns {Promise<boolean>} whether the post went through
 */
export function postToSpace(spaceName, text) {
  return safePost(
    { spaceId: spaceName, spaceIsResourceName: true, threadId: null, threadIsResourceName: false },
    markdownToChat(text)
  );
}

/**
 * Ack with an empty body, then post a fixed reply in the background.
 *
 * The reply cannot go in the response body: this deployment parses that body as
 * RenderActions (see src/api/addon-probe.js), so a { text } body renders nothing
 * and the user gets silence.
 *
 * @param {import('express').Response} res
 * @param {Object} evt - a normalizeChatEvent() result
 * @param {string} reason - a fixed code for the log; never an email or message text
 * @param {string} reply
 */
function ackThenPost(res, evt, reason, reply) {
  res.status(200).json({});
  safePost(evt, reply).catch(err => {
    console.error(`❌ Unhandled error posting ${reason} reply:`, err);
  });
}

/**
 * Run Oracle and post the result. Runs after the HTTP ack, so it must never
 * throw into the void: every path ends in a message to the user.
 */
async function runOracleAndReply(evt, user, conversationId, messageText) {
  const startedAt = Date.now();
  // START MARKER. An ack with no matching "finished"/"failed" line means the
  // process died mid-run — otherwise silence here is impossible.
  console.log(`▶️  Chat background task START — user ${user.id}, conversation ${conversationId}`);

  try {
    await createConversation(
      conversationId,
      user.id,
      'internal-oracle',
      `Chat: ${messageText.slice(0, 60)}`
    );

    // SOMEONE'S FIRST DM: the intro card, then their question is answered as
    // usual. Claimed in space_intros, so it happens once per person.
    if (evt.isDm && evt.spaceIsResourceName) {
      try {
        const { dmIntroDone, postIntro } = await import('../cards/intro-card.js');
        if (!(await dmIntroDone(evt.spaceId))) {
          await postIntro({ spaceName: evt.spaceId, displayName: evt.senderDisplayName, isDm: true });
        }
      } catch (err) {
        console.warn(`⚠️  DM intro failed — code: ${err?.code || err?.name || 'unknown'}`);
      }
    }

    // "@Oracle help" — the space's own intro card, privately, with examples.
    if (/^\s*(?:help|what can you do\??)\s*$/i.test(messageText)) {
      const { replyWithIntro } = await import('../cards/intro-card.js');
      await replyWithIntro({
        spaceName: evt.spaceIsResourceName ? evt.spaceId : null,
        threadName: evt.threadIsResourceName ? evt.threadId : null,
        displayName: evt.isDm ? evt.senderDisplayName : evt.spaceDisplayName,
        isDm: evt.isDm,
        listening: !evt.isDm && evt.spaceIsResourceName && isListenSpace(evt.spaceId),
        chatUserId: evt.senderChatId
      });
      await saveMessage(conversationId, 'user', messageText);
      console.log('👋 Handled by the intro card — kind: help');
      return;
    }

    // CONFIRMATION FIRST. A bare "yes" runs the action the user was shown and
    // never reaches the model. Anyone in the thread may confirm; whoever sent
    // this message is recorded as the confirmer.
    const confirmation = await tryHandleConfirmation({
      conversationId,
      userId: user.id,
      text: messageText
    });
    if (confirmation) {
      await saveMessage(conversationId, 'user', messageText);
      await saveMessage(conversationId, 'assistant', confirmation.replyText);
      await safePost(evt, markdownToChat(confirmation.replyText));
      // A tracked card in this thread may have been waiting on that proposal
      // (a review's HubSpot note): update it now rather than at the next refresh.
      try {
        const { refreshCardsForConversation } = await import('../cards/lifecycle.js');
        await refreshCardsForConversation(conversationId);
      } catch (err) {
        console.warn(`⚠️  Tracked card refresh after confirmation failed — code: ${err?.code || err?.name || 'unknown'}`);
      }
      return;
    }

    // Someone wrote in a tracked card's thread: that is activity (a stale card
    // opens again). Background, never blocks the reply.
    if (evt.threadIsResourceName) {
      import('../cards/lifecycle.js')
        .then(({ touchCardsInThread }) => touchCardsInThread(evt.threadId))
        .catch(() => {});
    }

    // THE /TRACK CARD, WITHOUT THE MODEL. Plain wording checks first — no
    // database work for ordinary messages. "track this" makes a card, "keep an
    // eye on this" asks first, and "@Oracle decision: …" / "pass to @Name" /
    // "response: …" / "remove @Name" / "promised @Name by …" change the thread's
    // track card. A typed command in a thread without a track card falls
    // through to the model.
    const { trackIntent, typedCommand } = await import('../cards/track-parse.js');
    const trackWords = trackIntent(messageText) || (typedCommand(messageText) ? 'typed' : null);
    if (trackWords) {
      const { handleTrackMessage } = await import('../cards/track-card.js');
      if (await handleTrackMessage({ evt, user, conversationId, messageText, intent: trackWords })) {
        await saveMessage(conversationId, 'user', messageText);
        takeCardReply(conversationId);
        console.log(`🗂️  Handled by the track card — kind: ${trackWords}`);
        return;
      }
    }

    // THE LEAD TRIAGE CARD, WITHOUT THE MODEL. Same shape as the track check
    // above: a message carrying contact details and a lead's wording gets a
    // triage card, an unclear one is asked about first, and "assign @Name" /
    // "called: …" / "outcome: …" update an existing lead card in the thread.
    const { leadIntent, typedLeadCommand } = await import('../cards/lead-parse.js');
    const leadWords = leadIntent(messageText) || (typedLeadCommand(messageText) ? 'typed' : null);
    if (leadWords) {
      const { handleLeadMessage } = await import('../cards/lead-card.js');
      if (await handleLeadMessage({ evt, user, conversationId, messageText, intent: leadWords })) {
        await saveMessage(conversationId, 'user', messageText);
        takeCardReply(conversationId);
        console.log(`🧲 Handled by the lead card — kind: ${leadWords}`);
        return;
      }
    }

    // THE /MEET CARD, WITHOUT THE MODEL. "find 45 min with @Nat this week",
    // "set up a call with @Nat". A question about a past meeting is not one of
    // these, and neither is anything without a thread to reply in.
    const { meetIntent } = await import('../cards/meet-slots.js');
    if (evt.threadIsResourceName && meetIntent(messageText)) {
      const { handleMeetMessage } = await import('../cards/meet-card.js');
      if (await handleMeetMessage({ evt, user, conversationId, messageText })) {
        await saveMessage(conversationId, 'user', messageText);
        takeCardReply(conversationId);
        console.log('📅 Handled by the meet card — kind: mention');
        return;
      }
    }

    // THE /WATCH CARD, WITHOUT THE MODEL. Only ever "@Oracle watch" (or /watch):
    // Oracle never decides on its own that a program is worth watching.
    const { watchIntent } = await import('../cards/watch-match.js');
    if (watchIntent(messageText)) {
      const { handleWatchMessage } = await import('../cards/watch-card.js');
      if (await handleWatchMessage({ evt, user, conversationId, messageText })) {
        await saveMessage(conversationId, 'user', messageText);
        takeCardReply(conversationId);
        console.log('👁️  Handled by the watch card — kind: mention');
        return;
      }
    }

    // "@Oracle edit lesson 2: …" — the typed fallback for a lesson card's Edit
    // button. Only when a lesson card is live here; otherwise an ordinary message.
    const { editLessonIntent, liveLessonCard, handleTypedEdit } = await import('../cards/lesson-card.js');
    const lessonEdit = editLessonIntent(messageText);
    if (lessonEdit && evt.spaceIsResourceName) {
      const card = await liveLessonCard({
        surface: evt.isDm ? 'chat_dm' : 'chat_space',
        spaceName: evt.spaceId,
        threadName: evt.threadIsResourceName ? evt.threadId : null
      });
      if (card) {
        await saveMessage(conversationId, 'user', messageText);
        const actor = { chatUserId: evt.senderChatId, name: evt.senderDisplayName || null, email: evt.senderEmail || null };
        const outcome = await handleTypedEdit({ card, actor, number: lessonEdit.number, text: lessonEdit.text });
        if (outcome.reply) {
          const { tellPresser } = await import('../cards/update.js');
          await tellPresser(card, actor, outcome.reply);
        }
        console.log('🧠 Handled by the lesson card — kind: typed edit');
        return;
      }
    }

    // /LEARN-THIS. The team teaches Oracle from this thread: one restricted run
    // that checks the lessons and puts them on a card for the teacher to confirm.
    const { learnIntent } = await import('../tools/team-lessons.js');
    if (learnIntent(messageText)) {
      await runLearnThis(evt, user, conversationId, messageText);
      return;
    }

    // Anything already pending belongs to an earlier turn — only a NEW proposal
    // gets a confirmation notice appended below.
    const pendingBefore = await currentPendingId(conversationId);

    // FILES ON THIS MESSAGE. Uploads are downloaded with Oracle's own Chat
    // identity; Drive attachments are read as the sender. The text goes to the
    // model for this turn only — client.js saves a placeholder in its place.
    let attachments = [];
    let attachmentNotes = [];
    if (evt.files.length) {
      const results = await readAttachments(evt.files, { chat: createChatClient(), userEmail: user.email });
      attachments = results.filter(r => r.ok).map(r => ({
        type: 'text_file',
        filename: r.name,
        content: attachmentBlockText(r),
        ephemeral: true
      }));
      attachmentNotes = results.filter(r => !r.ok).map(unreadableLine);
      console.log(`📎 Chat attachments — read: ${attachments.length}, unreadable: ${attachmentNotes.length}`);

      // Files only, and none of them readable: there is nothing to run on.
      if (!evt.text && attachments.length === 0) {
        await saveMessage(conversationId, 'user', messageText);
        await safePost(evt, markdownToChat(attachmentNotes.join('\n')));
        return;
      }
    }

    const result = await runAgent({
      agentType: 'internal-oracle',
      message: messageText,
      conversationId,
      userId: user.id,
      sessionId: crypto.randomUUID(),
      attachments,
      res: null, // headless — same pattern as src/api/hubspot-webhook.js
      // Built from the Google-signed event, never from message text. A shared
      // space may only read itself; a DM may read any space the asker belongs to.
      chatContext: {
        surface: evt.isDm ? 'chat_dm' : 'chat_space',
        spaceName: evt.spaceIsResourceName ? evt.spaceId : null,
        spaceDisplayName: evt.spaceDisplayName,
        senderChatId: evt.senderChatId,
        // For tracked cards (track_review): who was @mentioned, which Drive
        // files the message points at, and where to reply. All from the event.
        senderDisplayName: evt.senderDisplayName,
        messageName: evt.messageName,
        threadName: evt.threadIsResourceName ? evt.threadId : null,
        mentions: evt.mentions,
        driveFiles: evt.driveFiles,
        attachmentNames: evt.files.map(f => f.name),
        messageText: messageText
      }
    });

    // A tool posted a card as this turn's answer; the card is the reply.
    if (takeCardReply(conversationId)) {
      console.log('🗂️  Reply was a tracked card — no text posted');
      return;
    }

    if (!result?.success) {
      console.error(`❌ Agent returned failure: ${result?.error || 'unknown error'}`);
      await safePost(evt, `Something went wrong: ${result?.error || 'unknown error'}`);
      return;
    }

    // accumulatedText is computed inside the loop but never returned
    // (client.js), so extract the text blocks here.
    const text = (result.response?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // A proposal saved during this turn is described to the user by code, from
    // the stored action — not by the model, which only knows it was refused.
    const notice = await proposalNotice(conversationId, pendingBefore);

    if (!text && !notice) {
      console.warn('⚠️  Agent produced no text blocks');
      await safePost(evt, "I finished, but didn't produce a text reply. Try rephrasing?");
      return;
    }

    await safePost(evt, markdownToChat(withAttachmentNotes(attachmentNotes, `${text}${notice || ''}`.trim())));
  } catch (err) {
    console.error('❌ Oracle run failed for Chat event:', err);
    await safePost(evt, `Something went wrong while I was working on that: ${err.message}`);
  } finally {
    // COMPLETION MARKER — always runs, including on every early return above.
    console.log(`⏹️  Chat background task END — conversation ${conversationId} (${Date.now() - startedAt}ms)`);
  }
}

/**
 * "@Oracle /learn-this": post the lesson card ("Checking…"), gather what to learn
 * from, run Oracle once in learn mode — read-only tools plus save_team_lesson,
 * which saves lessons as pending on the card — then update the card in place
 * with the lessons to confirm, or with Oracle's short result when none are
 * waiting. The card is the only reply (src/cards/lesson-card.js).
 *
 * - In a space: the whole thread, read as the person asking (text and files).
 * - In a DM: the text after the command and this message's files; if the command
 *   is alone, the person's own messages from the last ten minutes (at most five).
 *
 * The source text and file text reach the model for this run only; like Chat
 * attachments, the saved history keeps placeholders.
 */
async function runLearnThis(evt, user, conversationId, messageText) {
  const { buildLearnMessage, textWithoutCommand, LEARN_MODE_TOOLS } = await import('../tools/team-lessons.js');
  const { readThreadTranscript, readRecentDmMessages } = await import('../tools/chat-attachments.js');
  const { startLessonCard, finishLessonCard } = await import('../cards/lesson-card.js');

  const learnContext = {
    surface: evt.isDm ? 'chat_dm' : 'chat_space',
    spaceName: evt.spaceIsResourceName ? evt.spaceId : null,
    spaceDisplayName: evt.spaceDisplayName,
    threadName: evt.threadIsResourceName ? evt.threadId : null,
    senderChatId: evt.senderChatId,
    senderDisplayName: evt.senderDisplayName,
    messageName: evt.messageName,
    messageText,
    learnMode: true
  };

  // The card first, so the teacher sees "Checking…" straight away. Without a
  // card nothing could be confirmed, so nothing is saved.
  const card = learnContext.spaceName
    ? await startLessonCard({
      spaceName: learnContext.spaceName,
      threadName: learnContext.threadName,
      surface: learnContext.surface,
      conversationId,
      ownerChatId: evt.senderChatId,
      ownerUserId: user.id
    })
    : null;
  if (!card) {
    await saveMessage(conversationId, 'user', messageText);
    await safePost(evt, markdownToChat("I couldn't open the lesson card, so nothing was saved — try /learn-this again."));
    return;
  }
  learnContext.lessonCardId = card.id;

  const fail = async (reply) => {
    await saveMessage(conversationId, 'user', messageText);
    await finishLessonCard(card.id, reply);
  };

  let messages;
  let results;
  if (evt.isDm) {
    const inline = textWithoutCommand(messageText);
    if (inline || evt.files.length) {
      // The lesson is in this message. Its files are read with Oracle's own
      // identity, like any file sent to it; no other messages are read.
      messages = [{
        sender: evt.senderDisplayName || 'you',
        time: new Date().toISOString(),
        text: inline,
        files: evt.files.map(f => f.name)
      }];
      results = evt.files.length
        ? await readAttachments(evt.files, { chat: createChatClient(), userEmail: user.email })
        : [];
    } else {
      const recent = await readRecentDmMessages({ userId: user.id, chatContext: learnContext });
      if (!recent.success) return fail(recent.error);
      if (recent.messages.length === 0) {
        return fail('Send what you want me to learn after /learn-this, or send it first and then /learn-this within 10 minutes.');
      }
      messages = recent.messages;
      results = await readAttachments(recent.files.slice(-5), { chat: recent.chat, userEmail: recent.userEmail });
    }
  } else {
    const thread = await readThreadTranscript({ userId: user.id, chatContext: learnContext });
    if (!thread.success) return fail(thread.error);
    messages = thread.messages;
    // The most recent files in the thread, read as the person asking.
    results = await readAttachments(thread.files.slice(-5), { chat: thread.chat, userEmail: thread.userEmail });
  }

  const unreadable = results.filter(r => !r.ok).map(unreadableLine);
  const attachments = [
    {
      type: 'text_file',
      filename: evt.isDm ? 'your messages' : 'thread transcript',
      content: [
        buildLearnMessage(messages, messageText, { dm: evt.isDm }),
        unreadable.length ? `\nFiles I couldn't read:\n${unreadable.join('\n')}` : ''
      ].join(''),
      ephemeral: true
    },
    ...results.filter(r => r.ok).map(r => ({
      type: 'text_file',
      filename: r.name,
      content: attachmentBlockText(r),
      ephemeral: true
    }))
  ];
  console.log(`🧠 /learn-this (${evt.isDm ? 'dm' : 'space'}) — ${messages.length} messages, ${attachments.length - 1} files read`);

  const result = await runAgent({
    agentType: 'internal-oracle',
    message: messageText,
    conversationId,
    userId: user.id,
    sessionId: crypto.randomUUID(),
    attachments,
    allowedTools: LEARN_MODE_TOOLS,
    res: null,
    chatContext: learnContext
  });

  const text = (result?.response?.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  const waiting = await finishLessonCard(card.id, text || `I couldn't find a lesson in ${evt.isDm ? 'your message' : 'this thread'}.`);
  console.log(`🧠 /learn-this card — ${waiting} lessons waiting for the teacher`);
}

/**
 * POST /api/chat/google
 */
export async function handleGoogleChatEvent(req, res) {
  // ==========================================================================
  // VERIFICATION — first action, before any side effect. A rejected request
  // creates no conversation row and makes no Anthropic call.
  // ==========================================================================
  const auth = await verifyChatRequest(req);
  if (!auth.ok) {
    console.error(`❌ Google Chat request rejected: ${auth.reason}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const evt = normalizeChatEvent(req.body);

  // SHAPE LOG — the single most useful line when this endpoint misbehaves.
  // A payload-shape change is what silently broke this before.
  console.log(`📥 Chat event — shape: ${evt.shape}, container: ${evt.container || 'none'}, type: ${evt.eventType || 'unknown'}`);

  if (evt.shape === 'unrecognized' || !evt.eventType) {
    // Top-level KEYS only — never the body, which carries message content.
    console.warn(`⚠️  Unrecognized Chat payload — ignoring. Top-level keys: [${Object.keys(req.body || {}).join(', ')}]`);
    return res.status(200).json({});
  }

  const kind = canonicalEventType(evt.eventType);

  // ==========================================================================
  // ADDED TO A SPACE — say hello, so the space knows Oracle is here and how to
  // reach it. Ack first and post in the background, exactly like the MESSAGE
  // path: the synchronous response body is parsed as RenderActions on this
  // deployment (see src/api/addon-probe.js), so a { text } body would render
  // nothing.
  // ==========================================================================
  if (kind === 'addedtospace') {
    // A space on the listen allowlist gets an intro card that says its messages
    // are copied, and — once that card is posted — the copy starts. A DM gets
    // its own card on the person's first message instead, not on being added.
    const listening = !evt.isDm && evt.spaceIsResourceName && isListenSpace(evt.spaceId);
    const willPost = !evt.isDm && evt.spaceIsResourceName;

    console.log(`👋 Added to ${evt.isDm ? 'a DM' : `space "${evt.spaceDisplayName || '(no display name)'}"`} — ${willPost ? 'posting the intro card' : 'no intro (DM)'}`);
    res.status(200).json({});

    (async () => {
      let introPosted = false;
      if (willPost) {
        // Posted once per space, claimed in space_intros before posting, so a
        // second addedToSpace event cannot post a second intro.
        const { postIntro } = await import('../cards/intro-card.js');
        introPosted = await postIntro({
          spaceName: evt.spaceId, displayName: evt.spaceDisplayName, listening
        });
      }
      if (listening) {
        const { enableSpace } = await import('../chat-listen/subscriptions.js');
        await enableSpace(evt.spaceId, { announced: introPosted });
      }
    })().catch(err => {
      console.error(`❌ Unhandled error after addedToSpace — code: ${err?.code || err?.name || 'unknown'}`);
    });
    return;
  }

  // ==========================================================================
  // REMOVED FROM A SPACE — stop keeping a copy of it and delete what is stored.
  // A no-op for spaces that were never copied. Runs even when listening is
  // switched off: deleting the copy is the point.
  // ==========================================================================
  if (kind === 'removedfromspace') {
    console.log(`👋 Removed from ${evt.isDm ? 'a DM' : 'a space'}`);
    res.status(200).json({});

    if (!evt.isDm && evt.spaceIsResourceName) {
      import('../chat-listen/subscriptions.js')
        .then(({ teardownSpace }) => teardownSpace(evt.spaceId))
        .catch(err => {
          console.error(`❌ Chat listen teardown failed — code: ${err?.code || err?.name || 'unknown'}`);
        });
    }
    return;
  }

  // ==========================================================================
  // BUTTON PRESS ON A TRACKED CARD — answered inside Chat's 30-second window with
  // an update to the pressed message. Handled before the BOT check below: the
  // pressed message was sent by Oracle, and the presser is in chat.user.
  // ==========================================================================
  if (kind === 'buttonclicked') {
    try {
      if (evt.isDialogEvent || evt.dialogEventType) {
        const { handleCardDialog } = await import('../cards/dialogs.js');
        return res.status(200).json(await handleCardDialog(evt) || {});
      }
      const { handleCardClick } = await import('../cards/actions.js');
      return res.status(200).json(await handleCardClick(evt) || {});
    } catch (err) {
      console.error(`❌ Tracked card click failed — code: ${err?.code || err?.name || 'unknown'}`);
      return res.status(200).json({});
    }
  }

  // ==========================================================================
  // APP COMMAND (slash command) — routed through the registry. Commands
  // register when src/cards/commands.js loads (/track). An unknown command is
  // acknowledged and logged. The handler gets the user lookup from here, so
  // card code never imports this module.
  // ==========================================================================
  if (kind === 'appcommand') {
    let handler = null;
    try {
      await import('../cards/commands.js');
      handler = findAppCommand(evt.appCommandId);
    } catch (err) {
      console.error(`❌ App commands failed to load — code: ${err?.code || err?.name || 'unknown'}`);
    }
    if (!handler) {
      console.log(`↩️  App command not registered — id: ${evt.appCommandId ?? 'none'}`);
      return res.status(200).json({});
    }
    try {
      return res.status(200).json(await handler(evt, {
        resolveUser,
        signInReply: () => NOT_RUN_REPLIES.signIn(hubSignInUrl())
      }) || {});
    } catch (err) {
      console.error(`❌ App command failed — code: ${err?.code || err?.name || 'unknown'}`);
      return res.status(200).json({});
    }
  }

  // Only respond to messages from humans. Ignoring BOT senders prevents loops.
  if (kind !== 'message') {
    // Names only, never values: the payload carries message content. Logging the
    // shape is how the remaining event types stop being guesswork.
    console.log(`↩️  Ignoring event type "${evt.eventType}" (canonical: ${kind}). Payload keys: [${Object.keys(req.body?.chat || req.body || {}).join(', ')}]`);
    return res.status(200).json({});
  }
  if (evt.senderType === 'BOT') {
    console.log('↩️  Ignoring: sender is a BOT (loop prevention)');
    return res.status(200).json({});
  }

  const senderEmail = evt.senderEmail;
  // Files with no text still get an answer: Oracle says what they are and asks.
  const messageText = evt.text || (evt.files.length ? FILE_ONLY_MESSAGE : '');

  if (!messageText) {
    // Log the message's top-level KEYS ONLY — never values, which carry content.
    // A message with files never reaches here (it runs on FILE_ONLY_MESSAGE), so
    // this line is where an unexpected attachment field name would show up.
    console.log(`↩️  No text. Message keys: [${Object.keys(evt.message || {}).join(', ')}], attachments seen: ${evt.attachmentCount}`);

    // Posted asynchronously, not returned in the response body, for the same
    // reason as the intro above: this deployment parses that body as
    // RenderActions, so a { text } reply is silently dropped.
    const reply = 'Send me a question and I\'ll take a look.';

    res.status(200).json({});
    safePost(evt, reply).catch(err => {
      console.error('❌ Unhandled error posting no-text reply:', err);
    });
    return;
  }

  // The four replies below are posted asynchronously via ackThenPost. Their log
  // lines carry a reason code only — never the sender's email or message text.
  let user;
  try {
    user = await resolveUser(senderEmail);
  } catch (err) {
    // The driver's error code, not its message, which is not guaranteed free of
    // the query parameter (the sender's email).
    console.error(`❌ Not running Oracle — reason: identity_lookup_failed (${err.code || err.name})`);
    ackThenPost(res, evt, 'identity_lookup_failed', NOT_RUN_REPLIES.tryAgain);
    return;
  }

  // Unknown or deactivated — same message either way, so we do not disclose
  // whether an account exists.
  if (!user) {
    console.log('↩️  Not running Oracle — reason: unknown_sender');
    ackThenPost(res, evt, 'unknown_sender', NOT_RUN_REPLIES.signIn(hubSignInUrl()));
    return;
  }

  // Defensive: a users row can currently only exist if the OAuth login stored
  // tokens, so this should be unreachable. Kept so that a future account
  // created another way degrades into a clear instruction rather than tool
  // failures mid-answer.
  if (!user.google_refresh_token) {
    console.log(`↩️  Not running Oracle — reason: missing_google_tokens (user ${user.id})`);
    ackThenPost(res, evt, 'missing_google_tokens', NOT_RUN_REPLIES.signIn(hubSignInUrl()));
    return;
  }

  let conversationId;
  try {
    ({ conversationId } = conversationIdForEvent(evt));
  } catch {
    // This only throws when the event has neither a thread nor a space — which
    // also leaves the post without a parent, so Google rejects it and safePost
    // logs the failure. The empty ack is what this path still guarantees.
    console.error('❌ Not running Oracle — reason: no_conversation_id');
    ackThenPost(res, evt, 'no_conversation_id', NOT_RUN_REPLIES.tryAgain);
    return;
  }

  console.log(`✅ Accepted — user ${user.id} (${user.email}), thread ${evt.threadId || '(none)'}, conversation ${conversationId}`);

  // Remember this person's Chat id and Hub account — tracked cards need both to
  // DM them and to find their calendar time zone. Never blocks the reply.
  import('../cards/people.js')
    .then(({ rememberSender }) => rememberSender({
      chatUserId: evt.senderChatId, userId: user.id, email: user.email, displayName: evt.senderDisplayName
    }))
    .catch(err => console.warn(`⚠️  Could not remember Chat sender — code: ${err?.code || err?.name || 'unknown'}`));

  // ==========================================================================
  // ACK NOW, WORK LATER. Chat times out long before Oracle finishes, so return
  // an empty 200 (which posts nothing) and continue in the background.
  // ==========================================================================
  res.status(200).json({});

  runOracleAndReply(evt, user, conversationId, messageText).catch(err => {
    console.error('❌ Unhandled error in background Chat task:', err);
  });
}

export default { handleGoogleChatEvent };
