/**
 * GetGranted Pulse: morning roundup — Oracle's chat-issue detector
 *
 *   08:00 America/Vancouver   look back 24 hours at GetGranted chat; if
 *                             anything went wrong for a client, file a chat
 *                             card in the Control Centre review queue for each
 *                             issue and DM each roundup subscriber the list,
 *                             each with its card link. Nothing happened →
 *                             nothing is filed or sent.
 *
 * Two sources, both in the gg3-ai-service ops DB (gg3-ops-db.js), everyone
 * included — internal accounts too. A card from an internal account carries the
 * Internal tag like any other card (its company is an internal account), so the
 * Control Centre hides it by default behind "Include internal accounts", and
 * the DM marks it Internal. Internal accounts are the Control Centre's list
 * (internal-accounts.js → identity.js internalClerkIds); GG3_INTERNAL_USER_IDS
 * is retired:
 *   errors       chat_turns that failed, by the spike alert's own rules
 *                (BROKE_OUTCOMES → "chat broke", no_answer → "empty reply or
 *                refusal", EXCLUDED_CATEGORIES left out)
 *   went badly   conversations active in the window (updated_at), at most 50,
 *                each read by Haiku against a fixed rubric: asked again,
 *                pushed back, asked for a person, or left after a reply that
 *                didn't answer. Leaving on its own is not a flag. For a
 *                flagged conversation only, a second small call names the
 *                client message whose reply went wrong (locateFlagged).
 *
 * Cards (src/control-centre/review-queue.js addFlag, source oracle_detected,
 * migration 047): one chat card per issue per conversation —
 * chat_turn_ref conv:<conversation id>:<issue>, so the same issue in the same
 * conversation is one card. The issue is the review's main flag
 * (ISSUE_PRIORITY), or chat_broke / empty_reply for a failed turn. Each
 * detection is a flag keyed on the flagged turn (oracle:<conv>:<issue>:t<n>,
 * or oracle:turn:<turn id>), so re-reviewing a conversation the next day adds
 * nothing for a turn already filed. The card's snapshot is the flagged client
 * message, the 3 turns before it and the assistant's reply, verbatim, frozen
 * at filing. The hourly review sweep then diagnoses it (diagnosis.js).
 *
 * Clients are named by company through ai-api-backend's
 * GET /api/v1/ai/profile/{clerkId} (the service token gg3-refresh uses);
 * when that can't answer, "a client ·<last 4 of the id>". The card's
 * company_id comes from the app DB (control-centre identity.js) when set.
 *
 * The DM carries Oracle's own words only: issue names, one-line takes, owners,
 * client labels and card links. Client message text goes to the model inside
 * the untrusted-data envelope and into the card's snapshot in the Hub DB (the
 * evidence staff review); it is never logged or posted.
 *
 * Once a day: the key morning_roundup:<date> in pulse_alert_state (migration
 * 040) is claimed before anything is filed or sent, and kept even if a send
 * fails.
 *
 * Needs GG3_OPS_DB_READONLY_URL and PULSE_ROUNDUP_SUBSCRIBERS; with either
 * unset it is never scheduled. Dry run: scripts/pulse-roundup-check.mjs.
 */

import { gg3OpsQuery, isGg3OpsConfigured } from './gg3-ops-db.js';
import { BROKE_OUTCOMES, FAILED_OUTCOMES, EXCLUDED_CATEGORIES } from './pulse-spike.js';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from '../claude/tool-output.js';
import { pulsePostRecorder } from './pulse-posts.js';
import { chatTurnsAround, CONVERSATION_MESSAGES_SQL } from '../control-centre/diagnosis.js';
import { cardLink, controlCentreUrl } from '../control-centre/links.js';

export const SUBSCRIBERS_ENV = 'PULSE_ROUNDUP_SUBSCRIBERS';
export const ROUNDUP_MODEL = 'claude-haiku-4-5-20251001';
export const WINDOW_HOURS = 24;
export const MAX_CONVERSATIONS = 50;
export const MAX_LINES = 5;
const MODEL_TIMEOUT_MS = 15000;
const PROFILE_TIMEOUT_MS = 5000;
const REVIEW_CONCURRENCY = 4;
const MAX_TRANSCRIPT_ITEMS = 30;
const MAX_TRANSCRIPT_CHARS = 8000;
const TAKE_CHARS = 160;
const FULL_TAKE_CHARS = 800;
const NAME_CHARS = 60;

export const FLAGS = ['repeated_question', 'pushback', 'asked_for_human', 'left_unanswered'];
export const OWNERS = ['Chris (AI behaviour)', 'Research (grant card data)', 'Jason (app/UI)', 'Client follow-up'];
/** A conversation with several flags is one card, keyed on the first of these it has. */
export const ISSUE_PRIORITY = ['asked_for_human', 'pushback', 'repeated_question', 'left_unanswered'];
export const DETECTOR_ACTOR = 'system:oracle-chat-review';
const TZ = 'America/Vancouver';

/** YYYY-MM-DD in Vancouver. */
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const FLAG_WORDS = {
  repeated_question: 'asked again',
  pushback: 'pushed back',
  asked_for_human: 'asked for a person',
  left_unanswered: 'left unanswered'
};

/** A client asking for a person. Checked on client messages only — the assistant itself mentions help@granted.ca. */
export const HUMAN_ASK = /help@granted\.ca|\b(human|real person|a person|someone|staff|support|call me|talk to|speak to|contact (you|someone))\b/i;

const codeOf = (err) => err?.status ?? err?.code ?? err?.name ?? 'unknown';
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ============================================================================
// 1. ERRORS
// ============================================================================

/**
 * Failed chat turns in the window, everyone's (internal accounts included).
 * @returns {Promise<null|Array<{kind: 'error', issue: 'chat_broke'|'empty_reply', label: string, category: string|null, userId: string,
 *                               conversationId: number|null, turnId: string, turnIndex: number|null, at: Date}>>}
 *   null when the ops DB isn't configured
 */
export async function collectErrors(hours = WINDOW_HOURS, runQuery = gg3OpsQuery) {
  const res = await runQuery(
    `SELECT turn_id, occurred_at, conversation_id, turn_index, user_id, outcome, error_category
       FROM chat_turns
      WHERE occurred_at > now() - make_interval(hours => $1::int)
        AND outcome = ANY($2::text[])
        AND (error_category IS NULL OR NOT (error_category = ANY($3::text[])))
      ORDER BY occurred_at`,
    [hours, FAILED_OUTCOMES, EXCLUDED_CATEGORIES]
  );
  if (!res.configured) return null;
  return res.rows.map(r => {
    const broke = BROKE_OUTCOMES.includes(r.outcome);
    return {
      kind: 'error',
      issue: broke ? 'chat_broke' : 'empty_reply',
      label: broke ? 'chat broke' : 'empty reply or refusal',
      category: r.error_category || null,
      userId: r.user_id,
      conversationId: r.conversation_id ?? null,
      turnId: r.turn_id,
      turnIndex: r.turn_index ?? null,
      at: r.occurred_at
    };
  });
}

// ============================================================================
// 2. WENT BADLY
// ============================================================================

/** Conversations with activity in the window, newest first, everyone's (internal accounts included). */
export async function collectConversations(hours = WINDOW_HOURS, runQuery = gg3OpsQuery, limit = MAX_CONVERSATIONS) {
  const res = await runQuery(
    `SELECT id, user_id, messages, updated_at
       FROM conversations
      WHERE updated_at > now() - make_interval(hours => $1::int)
      ORDER BY updated_at DESC
      LIMIT $2::int`,
    [hours, limit]
  );
  if (!res.configured) return null;
  return res.rows.map(r => ({ id: r.id, userId: r.user_id, messages: r.messages, updatedAt: r.updated_at }));
}

/**
 * The words people read: text blocks only (tool calls and results dropped),
 * the last 30 items, at most 8,000 characters. A client message that starts a
 * turn (string content — the same count diagnosis.js splitTurns and the ops
 * DB's turn_index use) carries its 0-based `turn`.
 * @returns {Array<{role: 'client'|'assistant', text: string, turn?: number}>}
 */
export function transcriptOf(messages) {
  const items = [];
  let turn = -1;
  for (const m of Array.isArray(messages) ? messages : []) {
    const role = m?.role === 'user' ? 'client' : m?.role === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const startsTurn = role === 'client' && typeof m.content === 'string';
    if (startsTurn) turn += 1;
    const text = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content : []).filter(b => b?.type === 'text').map(b => b.text).join('\n');
    if (String(text).trim()) items.push({ role, text: String(text).trim(), ...(startsTurn ? { turn } : {}) });
  }
  let kept = items.slice(-MAX_TRANSCRIPT_ITEMS);
  while (kept.length > 1 && kept.reduce((n, i) => n + i.text.length, 0) > MAX_TRANSCRIPT_CHARS) kept = kept.slice(1);
  return kept.map(i => ({ ...i, text: i.text.slice(0, MAX_TRANSCRIPT_CHARS) }));
}

const REVIEW_TOOL = {
  name: 'conversation_review',
  description: 'Whether this GetGranted chat went badly for the client, and why.',
  input_schema: {
    type: 'object',
    properties: {
      flags: { type: 'array', items: { type: 'string', enum: FLAGS }, description: 'Only the flags that clearly apply. Empty when the chat was fine.' },
      take: { type: 'string', description: 'One plain-English line on what went wrong, in your own words. No quotes, names or personal details.' },
      owner: { type: 'string', enum: OWNERS }
    },
    required: ['flags', 'take', 'owner']
  }
};

const REVIEW_SYSTEM = [
  'You review one conversation between a client and GetGranted\'s AI grant assistant, for the team that runs it.',
  'Flag ONLY these, and only when they clearly happened:',
  '- repeated_question: the client asked essentially the same thing again because the reply didn\'t answer it.',
  '- pushback: the client said the reply was wrong or not what they asked ("wrong", "not what I asked", "that\'s not right").',
  '- asked_for_human: the CLIENT asked for a person, a human, a call, or help@granted.ca. The assistant mentioning help@granted.ca is NOT this flag.',
  '- left_unanswered: the conversation ends on an assistant reply that did not answer the client\'s question, and the client said nothing after it.',
  'Leaving on its own is NOT a flag: a client who got an answer and left is fine. A normal, helpful chat has no flags.',
  'Owner: "Chris (AI behaviour)" for how the assistant answered; "Research (grant card data)" when a grant\'s facts were wrong or missing; "Jason (app/UI)" for the app itself; "Client follow-up" when the client needs a person to reach out.',
  UNTRUSTED_DATA_INSTRUCTION
].join('\n');

/**
 * Keep only flags the transcript supports: a person asked for in a CLIENT
 * message; "left unanswered" only when the assistant had the last word.
 */
export function cleanReview(raw, transcript) {
  const clientText = transcript.filter(t => t.role === 'client').map(t => t.text).join('\n');
  const last = transcript[transcript.length - 1];
  const flags = [...new Set((Array.isArray(raw?.flags) ? raw.flags : []).filter(f => FLAGS.includes(f)))]
    .filter(f => f !== 'asked_for_human' || HUMAN_ASK.test(clientText))
    .filter(f => f !== 'left_unanswered' || last?.role === 'assistant');
  return {
    flags,
    take: clip(raw?.take, TAKE_CHARS),
    // The card keeps Oracle's whole take; the DM line uses the short one.
    fullTake: clip(raw?.take, FULL_TAKE_CHARS),
    owner: OWNERS.includes(raw?.owner) ? raw.owner : OWNERS[0]
  };
}

// Which client message went wrong — a second, small call, made only for a
// conversation the review flagged. Kept out of the review call on purpose:
// adding message numbers or a message field to it changed what Haiku flags
// (2026-10-15, conversation 290: the Oct 14 left_unanswered flag disappeared).
const LOCATE_TOOL = {
  name: 'flagged_message',
  description: 'The client message whose reply went wrong.',
  input_schema: {
    type: 'object',
    properties: {
      client_message: { type: 'integer', description: 'The number in "(message N)" of that client message.' }
    },
    required: ['client_message']
  }
};

const LOCATE_SYSTEM = [
  'You are given one conversation between a client and GetGranted\'s AI grant assistant, with the client\'s messages numbered, and a problem the team found in it.',
  'Give the number of the client message whose reply went wrong: for a question left unanswered, the question that was not answered; for pushback or a repeated question, the earlier message the bad reply answered; for a request for a person, the message that asked.',
  UNTRUSTED_DATA_INSTRUCTION
].join('\n');

/** The transcript with each turn-starting client message numbered (1-based turn). */
export const numberedTranscript = (transcript) => transcript
  .map(t => `${t.role === 'client' ? `CLIENT${Number.isInteger(t.turn) ? ` (message ${t.turn + 1})` : ''}` : 'ASSISTANT'}: ${t.text}`)
  .join('\n\n');

/**
 * The 0-based turn of the flagged client message: the one the locate call
 * names, when it is a shown turn; otherwise the last client turn shown. A
 * failed locate call falls back the same way and never fails the review.
 */
export async function locateFlagged(transcript, review, createMessage) {
  const turns = transcript.filter(t => t.role === 'client' && Number.isInteger(t.turn)).map(t => t.turn);
  const fallback = turns.at(-1) ?? null;
  if (!turns.length) return { turnIndex: null, located: 'none' };
  try {
    const raw = await callTool(createMessage, {
      system: LOCATE_SYSTEM,
      user: [
        `The problem: ${review.flags.map(f => FLAG_WORDS[f]).join(', ')} — ${review.take}`,
        `The conversation:\n\n${wrapToolOutput('gg3_conversation', numberedTranscript(transcript))}`,
        `Call ${LOCATE_TOOL.name} once.`
      ].join('\n\n'),
      tool: LOCATE_TOOL,
      maxTokens: 50,
      source: 'pulse-roundup-locate'
    });
    const named = Number.isInteger(raw?.client_message) ? raw.client_message - 1 : null;
    return turns.includes(named) ? { turnIndex: named, located: 'model' } : { turnIndex: fallback, located: 'fallback' };
  } catch (err) {
    return { turnIndex: fallback, located: 'fallback', code: String(codeOf(err)) };
  }
}

/** One forced-tool Haiku call. Returns the tool input, or throws. Also used by pulse-digest.js. */
export async function callTool(createMessage, { system, user, tool, maxTokens, source, timeoutMs = MODEL_TIMEOUT_MS }) {
  const response = await createMessage({
    model: ROUNDUP_MODEL,
    max_tokens: maxTokens,
    temperature: 0,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: user }]
  }, { timeout: timeoutMs, maxRetries: 0 });
  if (response?.usage) {
    const { logAPICost } = await import('../utils/cost-logger.js');
    logAPICost({ usage: response.usage, model: ROUNDUP_MODEL, source });
  }
  const input = (response?.content || []).find(b => b.type === 'tool_use' && b.name === tool.name)?.input;
  if (!input || typeof input !== 'object') throw Object.assign(new Error('no tool call'), { code: 'no_tool_call' });
  return input;
}

/**
 * The review call, then — only when it flagged something — the locate call.
 * @returns {Promise<{ok: true, flags: string[], take: string, owner: string, turnIndex: number|null, located?: string}|{ok: false, code: string}>}
 */
export async function reviewConversation(conv, createMessage) {
  const transcript = transcriptOf(conv.messages);
  if (!transcript.some(t => t.role === 'client')) return { ok: true, flags: [], take: '', owner: OWNERS[0], turnIndex: null };
  const text = transcript.map(t => `${t.role === 'client' ? 'CLIENT' : 'ASSISTANT'}: ${t.text}`).join('\n\n');
  let review;
  try {
    const raw = await callTool(createMessage, {
      system: REVIEW_SYSTEM,
      user: `The conversation:\n\n${wrapToolOutput('gg3_conversation', text)}\n\nCall ${REVIEW_TOOL.name} once.`,
      tool: REVIEW_TOOL,
      maxTokens: 300,
      source: 'pulse-roundup-review'
    });
    review = cleanReview(raw, transcript);
  } catch (err) {
    return { ok: false, code: String(codeOf(err)) };
  }
  if (!review.flags.length) return { ok: true, ...review, turnIndex: null };
  const { turnIndex, located } = await locateFlagged(transcript, review, createMessage);
  return { ok: true, ...review, turnIndex, located };
}

async function mapLimited(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }));
  return out;
}

// ============================================================================
// 3. CLIENT NAMES
// ============================================================================

export const clientRef = (userId) => `a client ·${String(userId || '').slice(-4) || '????'}`;

/**
 * ai-api-backend's profile route, by Clerk id. Only the company name is kept.
 * @returns {Promise<{status: number|string, companyName: string|null}>}
 */
export async function fetchCompanyName(userId, env = process.env) {
  const base = String(env.AI_API_BACKEND_URL || '').replace(/\/+$/, '');
  const token = env.AI_API_BACKEND_TOKEN;
  if (!base || !token) return { status: 'not_configured', companyName: null };
  try {
    const res = await fetch(`${base}/api/v1/ai/profile/${encodeURIComponent(userId)}`, {
      headers: { 'X-AI-Service-Token': token, accept: 'application/json' },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS)
    });
    if (!res.ok) return { status: res.status, companyName: null };
    const body = await res.json().catch(() => null);
    const name = body?.company_name ?? body?.data?.company_name ?? null;
    return { status: res.status, companyName: name ? clip(name, NAME_CHARS) : null };
  } catch (err) {
    return { status: String(codeOf(err)), companyName: null };
  }
}

/**
 * @returns {Promise<{labels: Map<string, string>, stats: {named: number, ref: number, statuses: Object}}>}
 */
export async function clientLabels(userIds, fetchProfile) {
  const labels = new Map();
  const stats = { named: 0, ref: 0, statuses: {} };
  await mapLimited([...new Set(userIds.filter(Boolean))], REVIEW_CONCURRENCY, async (id) => {
    const r = await fetchProfile(id).catch(err => ({ status: String(codeOf(err)), companyName: null }));
    stats.statuses[r.status] = (stats.statuses[r.status] || 0) + 1;
    if (r.companyName) { stats.named += 1; labels.set(id, r.companyName); } else { stats.ref += 1; labels.set(id, clientRef(id)); }
  });
  return { labels, stats };
}


// ============================================================================
// 4. CARDS
// ============================================================================

/**
 * One card candidate per issue per conversation. Reviews: the main flag
 * (ISSUE_PRIORITY) names the issue. Failed turns: one per turn, grouped onto
 * the conversation's chat_broke / empty_reply card by their shared ref; a
 * failed turn with no conversation keys on the turn id.
 *
 * @returns {Array<{ref: string, sourceRef: string, issue: string, kind: 'conversation'|'error', name: string, take: string,
 *                  owner: string, userId: string, conversationId: number|null, turnIndex: number|null, flags: string[],
 *                  at: Date|null, messages?: Array}>}
 */
export function cardCandidates(errors, reviews) {
  const out = [];
  for (const r of reviews) {
    if (!r.flags?.length || r.conversationId == null) continue;
    const issue = ISSUE_PRIORITY.find(f => r.flags.includes(f)) ?? r.flags[0];
    const words = r.flags.map(f => FLAG_WORDS[f]).join(', ');
    out.push({
      ref: `conv:${r.conversationId}:${issue}`,
      sourceRef: `oracle:${r.conversationId}:${issue}:t${r.turnIndex ?? 'end'}`,
      issue, kind: 'conversation',
      name: words.charAt(0).toUpperCase() + words.slice(1),
      take: r.take, fullTake: r.fullTake ?? r.take, owner: r.owner, userId: r.userId, conversationId: r.conversationId,
      turnIndex: r.turnIndex ?? null, flags: r.flags, at: r.updatedAt ?? null, messages: r.messages
    });
  }
  for (const e of errors) {
    out.push({
      ref: e.conversationId != null ? `conv:${e.conversationId}:${e.issue}` : e.turnId,
      sourceRef: `oracle:turn:${e.turnId}`,
      issue: e.issue, kind: 'error',
      name: e.category ? `${e.label.charAt(0).toUpperCase()}${e.label.slice(1)} (${e.category})` : `${e.label.charAt(0).toUpperCase()}${e.label.slice(1)}`,
      take: e.issue === 'chat_broke' ? 'The chat failed before it finished answering.' : 'The assistant gave an empty reply or refused.',
      owner: OWNERS[0], userId: e.userId, conversationId: e.conversationId, turnIndex: e.turnIndex, flags: [], at: e.at
    });
  }
  return out;
}

/** The evidence frozen on the card: the flagged turn, the 3 before it, verbatim. */
export function snapshotFor(candidate, messages) {
  if (!Array.isArray(messages)) return null;
  const around = chatTurnsAround(messages, candidate.turnIndex);
  if (!around.ok) return null;
  return {
    source: 'oracle_detected',
    conversation_id: candidate.conversationId,
    issue: candidate.issue,
    flags: candidate.flags,
    detector_take: candidate.fullTake ?? candidate.take,
    ...around.body
  };
}

/**
 * File each candidate as a flag on its chat card. Never throws: a failed
 * filing is counted and the run goes on.
 *
 * @returns {Promise<{results: Array<{candidate, ok: boolean, id?: number, created?: boolean, reopened?: boolean, duplicate?: boolean}>, failed: number}>}
 */
export async function fileCards(candidates, { addFlag, readMessages, companyFor }) {
  const companies = await companyFor([...new Set(candidates.map(c => c.userId).filter(Boolean))]).catch(() => new Map());
  const messageCache = new Map();
  const messagesOf = async (c) => {
    if (c.messages) return c.messages;
    if (c.conversationId == null) return null;
    if (!messageCache.has(c.conversationId)) {
      messageCache.set(c.conversationId, await readMessages(c.conversationId).catch(() => null));
    }
    return messageCache.get(c.conversationId);
  };

  const results = [];
  let failed = 0;
  for (const c of candidates) {
    try {
      const r = await addFlag({
        kind: 'chat', chat_turn_ref: c.ref, conversation_id: c.conversationId ?? undefined,
        company_id: companies.get(c.userId) ?? undefined,
        source: 'oracle_detected', source_ref: c.sourceRef, source_created_at: c.at ?? null,
        actor: DETECTOR_ACTOR, comment: `${c.name}: ${c.fullTake ?? c.take}`.slice(0, 1000),
        snapshot: snapshotFor(c, await messagesOf(c)) ?? undefined
      });
      results.push({ candidate: c, ok: true, id: r.item?.id, created: r.created, reopened: r.reopened, duplicate: r.duplicate });
    } catch (err) {
      failed += 1;
      results.push({ candidate: c, ok: false });
      console.error(`❌ Pulse roundup: filing a chat card failed — code: ${codeOf(err)}`);
    }
  }
  return { results, failed };
}

// ============================================================================
// 5. THE DM
// ============================================================================

/**
 * One line per card filed or added to this run (a detection already on file
 * is left out), most detections first, at most MAX_LINES, each with its link.
 *
 * @param {Array<{id: number|null, name: string, client: string, take: string, owner: string, count: number,
 *                created: boolean, reopened: boolean, userIds: string[]}>} cards
 */
export function formatRoundup(cards, { hours = WINDOW_HOURS, env = process.env } = {}) {
  // Client cards first; internal-account cards after them, marked Internal.
  const sorted = [...cards].sort((a, b) => Number(Boolean(a.internal)) - Number(Boolean(b.internal)) || b.count - a.count);
  const clients = new Set(sorted.flatMap(c => c.userIds));
  const internal = sorted.filter(c => c.internal).length;
  const span = hours === 24 ? '24h' : `${hours}h`;
  const lines = [`☀️ GetGranted chat — last ${span}: ${plural(sorted.length, 'issue')} across ${plural(clients.size, 'client')}`
    + `${internal ? ` (${internal} from internal accounts)` : ''}.`];
  for (const c of sorted.slice(0, MAX_LINES)) {
    const tag = c.reopened ? ' — reopened' : c.created ? '' : ' — seen before';
    const times = c.count > 1 ? ` (${c.count}×)` : '';
    const who = c.internal ? `${c.client} (Internal)` : c.client;
    lines.push(`• ${c.name}${times} — ${who} — ${c.take} — ${c.owner}${tag} — ${c.id ? cardLink(c.id, env) : '(card not filed)'}`);
  }
  if (sorted.length > MAX_LINES) lines.push(`…and ${sorted.length - MAX_LINES} more.`);
  lines.push(`All chat cards: ${controlCentreUrl(env)}. Ask me about any of these for the conversation.`);
  return lines.join('\n');
}

/**
 * Filing results → one DM line per card, newly flagged this run. A card is
 * internal when every client on it is an internal account (`internalIds`, a
 * Set of Clerk ids; null when the list couldn't be read — nothing is marked).
 */
export function dmCards(results, labels, internalIds = null) {
  const byCard = new Map();
  for (const r of results) {
    if (r.duplicate) continue;
    const key = r.ok ? `id:${r.id}` : `ref:${r.candidate.ref}`;
    let card = byCard.get(key);
    if (!card) {
      card = { id: r.ok ? r.id : null, name: r.candidate.name, take: r.candidate.take, owner: r.candidate.owner,
        count: 0, created: false, reopened: false, userIds: [] };
      byCard.set(key, card);
    }
    card.count += 1;
    card.created ||= Boolean(r.created);
    card.reopened ||= Boolean(r.reopened);
    if (!card.userIds.includes(r.candidate.userId)) card.userIds.push(r.candidate.userId);
  }
  return [...byCard.values()].map(c => ({
    ...c,
    client: c.userIds.map(u => labels.get(u) || clientRef(u)).join(', '),
    internal: Boolean(internalIds && c.userIds.length && c.userIds.every(u => internalIds.has(u)))
  }));
}

// ============================================================================
// THE RUN
// ============================================================================

const REQUIRED_ENV = ['GG3_OPS_DB_READONLY_URL', SUBSCRIBERS_ENV];

/** The env vars the roundup needs that are unset. */
export function missingRoundupEnv(env = process.env) {
  return REQUIRED_ENV.filter(k => !String(env[k] || '').trim());
}

let anthropic = null;
async function defaultCreateMessage(params, opts) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic.messages.create(params, opts);
}

/** Clerk id → app company id, through the Control Centre's read-only app DB. Empty when not configured. */
async function defaultCompanyFor(userIds) {
  const { identitiesForClerkIds } = await import('../control-centre/identity.js');
  try {
    const ids = await identitiesForClerkIds(userIds);
    return new Map([...ids].map(([k, v]) => [k, v.company_id]).filter(([, v]) => v != null));
  } catch {
    return new Map();
  }
}

async function defaultDeps(env) {
  const [{ query }, { getPulseSubscribers }, { postToSpaceWithThread }, { recordPulsePost }, { addFlag }, { internalClerkIds }] = await Promise.all([
    import('../database/connection.js'),
    import('./pulse-subscribers.js'),
    import('../api/chat-google.js'),
    import('./pulse-posts.js'),
    import('../control-centre/review-queue.js'),
    import('../control-centre/identity.js')
  ]);
  return {
    collectErrors: (hours) => collectErrors(hours),
    collectConversations: (hours) => collectConversations(hours),
    createMessage: defaultCreateMessage,
    fetchProfile: (id) => fetchCompanyName(id, env),
    oracleQuery: query,
    getSubscribers: () => getPulseSubscribers(SUBSCRIBERS_ENV),
    post: postToSpaceWithThread,
    recordPost: recordPulsePost,
    addFlag,
    companyFor: defaultCompanyFor,
    internalIds: () => internalClerkIds(),
    readMessages: async (conversationId) => {
      const r = await gg3OpsQuery(CONVERSATION_MESSAGES_SQL, [conversationId]);
      return r.rows?.[0]?.messages ?? null;
    }
  };
}

/**
 * Steps 1–3: what happened, as card candidates with client labels. Files and
 * sends nothing — the dry run is exactly this.
 */
export async function buildRoundup({ hours = WINDOW_HOURS, deps, collected = null }) {
  const { errors, conversations } = collected || {
    errors: await deps.collectErrors(hours),
    conversations: await deps.collectConversations(hours)
  };
  if (!errors || !conversations) return null;

  const reviews = await mapLimited(conversations, REVIEW_CONCURRENCY, async (c) => ({
    ...(await reviewConversation(c, deps.createMessage)),
    userId: c.userId, conversationId: c.id, messages: c.messages, updatedAt: c.updatedAt
  }));
  const failedReviews = reviews.filter(r => !r.ok).length;
  const candidates = cardCandidates(errors, reviews.filter(r => r.ok));
  const { labels, stats } = await clientLabels(candidates.map(c => c.userId), deps.fetchProfile);
  return {
    internalIds: await internalIdsOrNull(deps),
    errors: errors.length,
    conversations: conversations.length,
    flagged: reviews.filter(r => r.ok && r.flags.length).length,
    failedReviews,
    clientLookup: stats,
    labels,
    candidates
  };
}

/**
 * The internal accounts' Clerk ids (the Control Centre list), or null when they
 * can't be read — the DM then marks nothing Internal; the cards still carry the
 * tag through their company.
 */
async function internalIdsOrNull(deps) {
  if (!deps.internalIds) return null;
  try {
    return await deps.internalIds();
  } catch (err) {
    console.warn(`⚠️  Pulse roundup: internal accounts unavailable (code: ${err?.code || err?.name || 'unknown'}) — DM lines unmarked`);
    return null;
  }
}

let warnedNoStateTable = false;

/** Claim today's roundup. @returns {Promise<boolean>} false when already claimed */
export async function claimDay(date, now, runQuery) {
  const r = await runQuery(
    `INSERT INTO pulse_alert_state (alert_key, last_sent_at) VALUES ($1, $2)
     ON CONFLICT (alert_key) DO NOTHING
     RETURNING alert_key`,
    [`morning_roundup:${date}`, now]
  );
  return r.rows.length > 0;
}

/**
 * One morning run. Never throws for "not configured", "nothing happened" or
 * "already sent today".
 * @returns {Promise<{status: 'skipped'|'nothing'|'already_sent'|'no_state_table'|'sent'|'undelivered', missing?: string[], issues?: number, sent?: number, filed?: number}>}
 */
export async function runMorningRoundup({ now = new Date(), env = process.env, deps = null, hours = WINDOW_HOURS } = {}) {
  const missing = missingRoundupEnv(env);
  if (missing.length || !isGg3OpsConfigured()) return { status: 'skipped', missing };
  const d = deps || await defaultDeps(env);

  const errors = await d.collectErrors(hours);
  const conversations = await d.collectConversations(hours);
  if (!errors || !conversations) return { status: 'skipped', missing: [] };
  if (!errors.length && !conversations.length) return { status: 'nothing' };

  const today = localDate(now);
  try {
    if (!(await claimDay(today, now, d.oracleQuery))) return { status: 'already_sent' };
  } catch (err) {
    if (err?.code === '42P01') {
      if (!warnedNoStateTable) {
        warnedNoStateTable = true;
        console.warn('⚠️  Pulse roundup: pulse_alert_state missing (apply migration 040) — not sending.');
      }
      return { status: 'no_state_table' };
    }
    throw err;
  }

  const built = await buildRoundup({ hours, deps: d, collected: { errors, conversations } });
  if (built.failedReviews) console.warn(`⚠️  Pulse roundup: ${built.failedReviews} conversation review(s) failed`);
  if (!built.candidates.length) {
    console.log(`📣 Pulse roundup: nothing to report — ${built.errors} errors, ${built.conversations} conversations, none went badly`);
    return { status: 'nothing' };
  }

  const filed = await fileCards(built.candidates, d);
  const cards = dmCards(filed.results, built.labels, built.internalIds);
  const newlyFiled = filed.results.filter(r => r.ok && !r.duplicate).length;
  console.log(`📋 Pulse roundup cards: ${newlyFiled} detection(s) filed on ${cards.length} card(s)`
    + `${filed.failed ? `, ${filed.failed} failed` : ''}`);
  if (!cards.length) {
    console.log('📣 Pulse roundup: every detection was already on file — nothing sent');
    return { status: 'nothing', filed: 0 };
  }

  const text = formatRoundup(cards, { hours, env });
  const subscribers = await d.getSubscribers();
  // Each delivered DM is recorded (pulse_posts), so a reply in its thread gets this roundup as context.
  const record = d.recordPost
    ? pulsePostRecorder({ kind: 'roundup', periodStart: new Date(now.getTime() - hours * 3600000), periodEnd: now, summary: text }, d.recordPost)
    : null;
  let sent = 0;
  for (const s of subscribers) {
    const result = await d.post(s.dmSpace, text);
    if (!result) continue;
    sent += 1;
    if (record) await record(s, result);
  }
  if (sent === 0) {
    // The claim stays: the cards are already filed.
    console.warn(`⚠️  Pulse roundup: ${cards.length} issue(s) but no subscriber could be reached — not retried today.`);
    return { status: 'undelivered', issues: cards.length, sent, filed: newlyFiled };
  }
  console.log(`📣 Pulse roundup: sent to ${sent} subscriber(s) — ${cards.length} issue(s), lookup ${built.clientLookup.named} named / ${built.clientLookup.ref} ref`);
  return { status: 'sent', issues: cards.length, sent, filed: newlyFiled };
}

/** @param {Object} cron - node-cron */
export function startPulseRoundup(cron, env = process.env) {
  const missing = missingRoundupEnv(env);
  if (missing.length || !isGg3OpsConfigured()) {
    console.warn(`⚠️  Pulse morning roundup NOT configured — unset: ${missing.join(', ') || 'GG3_OPS_DB_READONLY_URL'}.`);
    return false;
  }
  const run = async () => {
    try {
      await runMorningRoundup();
    } catch (err) {
      console.error(`❌ Pulse roundup failed — code: ${codeOf(err)}`);
    }
  };
  cron.schedule('0 8 * * *', run, { name: 'pulse-roundup', timezone: 'America/Vancouver', noOverlap: true });
  console.log('⏰ Cron job scheduled: Pulse morning roundup at 08:00 America/Vancouver');
  return true;
}

/** Test-only. */
export function _resetPulseRoundupForTests() {
  warnedNoStateTable = false;
  anthropic = null;
}
