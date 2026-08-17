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
import { createConversation } from '../database/messages.js';
import { query } from '../database/connection.js';

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
    text: '',
    threadId: null,
    threadIsResourceName: false,
    spaceId: null,
    spaceIsResourceName: false
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
    // argumentText has the app's @mention stripped; in a space `text` still
    // contains the app name.
    text: (message?.argumentText || message?.text || '').trim(),
    threadId,
    threadIsResourceName: Boolean(message?.thread?.name),
    spaceId,
    spaceIsResourceName: Boolean(space?.name)
  };
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
 * Split text into chunks Chat will display in full, preferring paragraph
 * boundaries so nothing is cut mid-sentence.
 * @param {string} text
 * @param {number} limit
 * @returns {string[]}
 */
export function splitForChat(text, limit = MAX_CHUNK_CHARS) {
  if (!text) return [];
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = '';

  for (const para of text.split('\n\n')) {
    // A single paragraph longer than the limit has to be hard-split.
    if (para.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < para.length; i += limit) {
        chunks.push(para.slice(i, i + limit));
      }
      continue;
    }
    if ((current ? current.length + 2 : 0) + para.length > limit) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
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
    await chat.spaces.messages.create({
      parent: evt.spaceId,
      // Keep the reply in the originating thread; start a new one if that
      // thread has gone away.
      messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
      requestBody: {
        text: chunk,
        // Parse the body as standard Markdown rather than Chat's legacy syntax
        // (GA 2026-08-07). Without this, '**bold**' renders as literal
        // asterisks — the failure is silent, so if formatting ever looks wrong
        // in Chat, check this field first.
        markupSyntax: 'MARKUP_SYNTAX_MARKDOWN',
        // Only a real resource name is valid here; threadKey is not.
        ...(evt.threadIsResourceName ? { thread: { name: evt.threadId } } : {})
      }
    });
  }
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

    const result = await runAgent({
      agentType: 'internal-oracle',
      message: messageText,
      conversationId,
      userId: user.id,
      sessionId: crypto.randomUUID(),
      res: null // headless — same pattern as src/api/hubspot-webhook.js
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

    if (!text) {
      console.warn('⚠️  Agent produced no text blocks');
      await safePost(evt, "I finished, but didn't produce a text reply. Try rephrasing?");
      return;
    }

    await safePost(evt, markdownToChat(text));
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

  // Only respond to messages from humans. Ignoring BOT senders prevents loops.
  if (evt.eventType !== 'MESSAGE') {
    console.log(`↩️  Ignoring: event type is "${evt.eventType}", not MESSAGE`);
    return res.status(200).json({});
  }
  if (evt.senderType === 'BOT') {
    console.log('↩️  Ignoring: sender is a BOT (loop prevention)');
    return res.status(200).json({});
  }

  const senderEmail = evt.senderEmail;
  const messageText = evt.text;

  if (!messageText) {
    console.log('↩️  Ignoring: message carried no text');
    return res.status(200).json({ text: 'Send me a question and I\'ll take a look.' });
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
