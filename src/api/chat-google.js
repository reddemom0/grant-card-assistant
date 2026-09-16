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
import { resolveSpaceIntro } from './space-intros.js';

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
    isDm: false
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
  const attachments = [message?.attachment, message?.attachedGifs]
    .flatMap(a => (Array.isArray(a) ? a : a ? [a] : []));

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
      || space?.singleUserBotDm === true
  };
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
 * Said whenever a Chat message carried a file. Chat attachments are not read at
 * all (Stage 1), and answering as though the file had been read is the failure
 * worth avoiding: the user assumes it was.
 */
export const SKIPPED_ATTACHMENT_NOTICE =
  "I can't read files sent in Chat yet, so I answered from your message only. For file review, use the Hub.";

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
 * Prepend the skipped-file notice when the incoming message carried one.
 *
 * Prepended, not appended, and added before splitting — so it lands at the top
 * of the first chunk, where someone who sent a file will actually see it, rather
 * than at the end of a reply that may be several messages long.
 *
 * @param {Object} evt - a normalizeChatEvent() result
 * @param {string} reply
 * @returns {string}
 */
export function withAttachmentNotice(evt, reply) {
  if (!evt?.hasAttachments) return reply;
  return `${SKIPPED_ATTACHMENT_NOTICE}\n\n${reply}`.trim();
}

/**
 * Post a reply, swallowing errors so a post-back failure cannot crash the
 * background task. This is the ONE place where the user may get silence, so it
 * logs loudly.
 */
async function safePost(evt, text) {
  try {
    await postToChat(evt, text);
    console.log('✅ Chat reply delivered');
  } catch (err) {
    console.error('❌ Google Chat post-back FAILED — user received nothing:', err.message);
  }
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
      await safePost(evt, markdownToChat(withAttachmentNotice(evt, confirmation.replyText)));
      return;
    }

    // Anything already pending belongs to an earlier turn — only a NEW proposal
    // gets a confirmation notice appended below.
    const pendingBefore = await currentPendingId(conversationId);

    const result = await runAgent({
      agentType: 'internal-oracle',
      message: messageText,
      conversationId,
      userId: user.id,
      sessionId: crypto.randomUUID(),
      res: null, // headless — same pattern as src/api/hubspot-webhook.js
      // Built from the Google-signed event, never from message text. A shared
      // space may only read itself; a DM may read any space the asker belongs to.
      chatContext: {
        surface: evt.isDm ? 'chat_dm' : 'chat_space',
        spaceName: evt.spaceIsResourceName ? evt.spaceId : null,
        spaceDisplayName: evt.spaceDisplayName,
        senderChatId: evt.senderChatId
      }
    });

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

    await safePost(evt, markdownToChat(withAttachmentNotice(evt, `${text}${notice || ''}`.trim())));
  } catch (err) {
    console.error('❌ Oracle run failed for Chat event:', err);
    await safePost(evt, `Something went wrong while I was working on that: ${err.message}`);
  } finally {
    // COMPLETION MARKER — always runs, including on every early return above.
    console.log(`⏹️  Chat background task END — conversation ${conversationId} (${Date.now() - startedAt}ms)`);
  }
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
    const intro = resolveSpaceIntro({
      displayName: evt.spaceDisplayName,
      isDm: evt.isDm
    });

    console.log(`👋 Added to ${evt.isDm ? 'a DM' : `space "${evt.spaceDisplayName || '(no display name)'}"`} — ${intro ? 'posting intro' : 'no intro (DM)'}`);
    res.status(200).json({});

    if (intro) {
      safePost(evt, markdownToChat(intro)).catch(err => {
        console.error('❌ Unhandled error posting space intro:', err);
      });
    }
    return;
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
  const messageText = evt.text;

  if (!messageText) {
    // Log the message's top-level KEYS ONLY — never values, which carry content.
    // The Chat attachment field name is taken from the API spec and has not been
    // confirmed against a live payload here; the first real file-only message
    // settles it, and until then hasAttachments simply stays false.
    console.log(`↩️  No text. Message keys: [${Object.keys(evt.message || {}).join(', ')}], attachments seen: ${evt.attachmentCount}`);

    // Posted asynchronously, not returned in the response body, for the same
    // reason as the intro above: this deployment parses that body as
    // RenderActions, so a { text } reply is silently dropped.
    const reply = evt.hasAttachments
      ? SKIPPED_ATTACHMENT_NOTICE
      : 'Send me a question and I\'ll take a look.';

    res.status(200).json({});
    safePost(evt, reply).catch(err => {
      console.error('❌ Unhandled error posting no-text reply:', err);
    });
    return;
  }

  let user;
  try {
    user = await resolveUser(senderEmail);
  } catch (err) {
    console.error('❌ Chat identity lookup failed:', err.message);
    return res.status(200).json({ text: 'I could not verify your account just now. Try again shortly.' });
  }

  // Unknown or deactivated — same message either way, so we do not disclose
  // whether an account exists.
  if (!user) {
    console.log(`↩️  Ignoring: sender "${senderEmail || '(no email)'}" is not a known active user`);
    return res.status(200).json({
      text: `I don't recognize ${senderEmail || 'this account'}. Sign in at the Granted AI Hub first, then message me again.`
    });
  }

  // Defensive: a users row can currently only exist if the OAuth login stored
  // tokens, so this should be unreachable. Kept so that a future account
  // created another way degrades into a clear instruction rather than tool
  // failures mid-answer.
  if (!user.google_refresh_token) {
    console.log(`↩️  Ignoring: user ${user.id} has no stored Google tokens`);
    const hubUrl = process.env.PUBLIC_URL || 'https://grant-card-assistant-production.up.railway.app';
    return res.status(200).json({
      text: `Your account isn't fully connected yet. Sign in once at ${hubUrl}/login, then message me again.`
    });
  }

  let conversationId;
  try {
    ({ conversationId } = conversationIdForEvent(evt));
  } catch (err) {
    console.error('❌ Could not derive conversation id:', err.message);
    return res.status(200).json({ text: 'I could not work out which conversation this belongs to.' });
  }

  console.log(`✅ Accepted — user ${user.id} (${user.email}), thread ${evt.threadId || '(none)'}, conversation ${conversationId}`);

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
