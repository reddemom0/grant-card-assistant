/**
 * GetGranted Pulse: morning roundup
 *
 *   08:00 America/Vancouver   look back 24 hours at GetGranted chat; if
 *                             anything went wrong for a client, DM each
 *                             roundup subscriber a short grouped summary and
 *                             keep the errors sheet (pulse-errors-sheet.js)
 *                             up to date. Nothing happened → nothing is sent.
 *
 * Two sources, both in the gg3-ai-service ops DB (gg3-ops-db.js), both with
 * GetGranted staff left out (excludeInternalUsers, GG3_INTERNAL_USER_IDS):
 *   errors       chat_turns that failed, by the spike alert's own rules
 *                (BROKE_OUTCOMES → "chat broke", no_answer → "empty reply or
 *                refusal", EXCLUDED_CATEGORIES left out)
 *   went badly   conversations active in the window (updated_at), at most 50,
 *                each read by Haiku against a fixed rubric: asked again,
 *                pushed back, asked for a person, or left after a reply that
 *                didn't answer. Leaving on its own is not a flag.
 * Then one Haiku call groups both into issues and matches them to sheet rows.
 *
 * Clients are named by company through ai-api-backend's
 * GET /api/v1/ai/profile/{clerkId} (the service token gg3-refresh uses);
 * when that can't answer, "a client ·<last 4 of the id>".
 *
 * What leaves this module is Oracle's own words: issue names, one-line takes,
 * owners and client labels. Client message text goes to the model only, inside
 * the untrusted-data envelope, and is never stored, logged, posted or written.
 *
 * Once a day: the key morning_roundup:<date> in pulse_alert_state (migration
 * 040) is claimed before anything is written or sent, and kept even if a send
 * fails — the sheet's counts are already added, so a re-run would double them.
 *
 * Needs GG3_OPS_DB_READONLY_URL, PULSE_ROUNDUP_SUBSCRIBERS,
 * PULSE_ERRORS_SHEET_ID and PULSE_SHEET_OWNER_EMAIL; with any unset it is
 * never scheduled. Dry run: scripts/pulse-roundup-check.mjs.
 */

import { gg3OpsQuery, isGg3OpsConfigured, excludeInternalUsers } from './gg3-ops-db.js';
import { BROKE_OUTCOMES, FAILED_OUTCOMES, EXCLUDED_CATEGORIES } from './pulse-spike.js';
import {
  SHEET_ENV, OWNER_ENV, sheetUrl, localDate, resolveSheetOwner, readIssueRows, writeIssues
} from './pulse-errors-sheet.js';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from '../claude/tool-output.js';
import { pulsePostRecorder } from './pulse-posts.js';

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
const NAME_CHARS = 60;

export const FLAGS = ['repeated_question', 'pushback', 'asked_for_human', 'left_unanswered'];
export const OWNERS = ['Chris (AI behaviour)', 'Research (grant card data)', 'Jason (app/UI)', 'Client follow-up'];
const FLAG_WORDS = {
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
 * Failed chat turns in the window, staff left out.
 * @returns {Promise<null|Array<{kind: 'error', label: string, category: string|null, userId: string, conversationId: number|null, at: Date}>>}
 *   null when the ops DB isn't configured
 */
export async function collectErrors(hours = WINDOW_HOURS, runQuery = gg3OpsQuery) {
  const ex = excludeInternalUsers('user_id', 4);
  const res = await runQuery(
    `SELECT turn_id, occurred_at, conversation_id, user_id, outcome, error_category
       FROM chat_turns
      WHERE occurred_at > now() - make_interval(hours => $1::int)
        AND outcome = ANY($2::text[])
        AND (error_category IS NULL OR NOT (error_category = ANY($3::text[])))
        AND ${ex.clause}
      ORDER BY occurred_at`,
    [hours, FAILED_OUTCOMES, EXCLUDED_CATEGORIES, ...ex.params]
  );
  if (!res.configured) return null;
  return res.rows.map(r => ({
    kind: 'error',
    label: BROKE_OUTCOMES.includes(r.outcome) ? 'chat broke' : 'empty reply or refusal',
    category: r.error_category || null,
    userId: r.user_id,
    conversationId: r.conversation_id ?? null,
    at: r.occurred_at
  }));
}

// ============================================================================
// 2. WENT BADLY
// ============================================================================

/** Conversations with activity in the window, newest first, staff left out. */
export async function collectConversations(hours = WINDOW_HOURS, runQuery = gg3OpsQuery, limit = MAX_CONVERSATIONS) {
  const ex = excludeInternalUsers('user_id', 3);
  const res = await runQuery(
    `SELECT id, user_id, messages, updated_at
       FROM conversations
      WHERE updated_at > now() - make_interval(hours => $1::int)
        AND ${ex.clause}
      ORDER BY updated_at DESC
      LIMIT $2::int`,
    [hours, limit, ...ex.params]
  );
  if (!res.configured) return null;
  return res.rows.map(r => ({ id: r.id, userId: r.user_id, messages: r.messages, updatedAt: r.updated_at }));
}

/**
 * The words people read: text blocks only (tool calls and results dropped),
 * the last 30 items, at most 8,000 characters.
 * @returns {Array<{role: 'client'|'assistant', text: string}>}
 */
export function transcriptOf(messages) {
  const items = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const role = m?.role === 'user' ? 'client' : m?.role === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const text = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content : []).filter(b => b?.type === 'text').map(b => b.text).join('\n');
    if (String(text).trim()) items.push({ role, text: String(text).trim() });
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
    owner: OWNERS.includes(raw?.owner) ? raw.owner : OWNERS[0]
  };
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
 * @returns {Promise<{ok: true, flags: string[], take: string, owner: string}|{ok: false, code: string}>}
 */
export async function reviewConversation(conv, createMessage) {
  const transcript = transcriptOf(conv.messages);
  if (!transcript.some(t => t.role === 'client')) return { ok: true, flags: [], take: '', owner: OWNERS[0] };
  const text = transcript.map(t => `${t.role === 'client' ? 'CLIENT' : 'ASSISTANT'}: ${t.text}`).join('\n\n');
  try {
    const raw = await callTool(createMessage, {
      system: REVIEW_SYSTEM,
      user: `The conversation:\n\n${wrapToolOutput('gg3_conversation', text)}\n\nCall ${REVIEW_TOOL.name} once.`,
      tool: REVIEW_TOOL,
      maxTokens: 300,
      source: 'pulse-roundup-review'
    });
    return { ok: true, ...cleanReview(raw, transcript) };
  } catch (err) {
    return { ok: false, code: String(codeOf(err)) };
  }
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
// 4. GROUPING
// ============================================================================

/**
 * Items the grouping step sees: one per kind of error (label + category), one
 * per conversation that went badly. No message text.
 */
export function buildItems(errors, reviews) {
  const items = [];
  const byKind = new Map();
  for (const e of errors) {
    const key = `${e.label}|${e.category || ''}`;
    let item = byKind.get(key);
    if (!item) {
      item = { id: `e${byKind.size + 1}`, kind: 'error', what: e.category ? `${e.label} (${e.category})` : e.label, count: 0, userIds: new Set(), take: null, owner: OWNERS[0] };
      byKind.set(key, item);
      items.push(item);
    }
    item.count += 1;
    item.userIds.add(e.userId);
  }
  reviews.forEach((r, i) => {
    if (!r.flags?.length) return;
    items.push({
      id: `c${i + 1}`, kind: 'conversation', what: r.flags.map(f => FLAG_WORDS[f]).join(', '),
      flags: r.flags, count: 1, userIds: new Set([r.userId]), take: r.take, owner: r.owner
    });
  });
  return items;
}

const GROUP_TOOL = {
  name: 'issues',
  description: 'Today\'s items grouped into issues.',
  input_schema: {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short issue name, at most 8 words, e.g. "Chat times out on long answers".' },
            item_ids: { type: 'array', items: { type: 'string' } },
            take: { type: 'string', description: 'One plain-English line: what is going wrong.' },
            owner: { type: 'string', enum: OWNERS },
            existing_row: { type: ['integer', 'null'], description: 'The row number of the existing issue this is, or null when new.' }
          },
          required: ['name', 'item_ids', 'take', 'owner']
        }
      }
    },
    required: ['issues']
  }
};

function issueFrom(items, { name, take, owner, existingRow = null }) {
  const userIds = new Set();
  for (const it of items) for (const u of it.userIds) userIds.add(u);
  return {
    name: clip(name, NAME_CHARS),
    count: items.reduce((n, it) => n + it.count, 0),
    userIds: [...userIds],
    take: clip(take, TAKE_CHARS),
    owner: OWNERS.includes(owner) ? owner : items[0]?.owner || OWNERS[0],
    existingRow
  };
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Without the model: one issue per kind of error, one per kind of flag. */
export function fallbackIssues(items, existingRows = []) {
  const groups = new Map();
  for (const it of items) {
    const key = it.kind === 'error' ? it.what : `went badly: ${it.flags.map(f => FLAG_WORDS[f]).join(' + ')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.entries()].map(([key, group]) => {
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    const row = existingRows.find(r => sameName(r.name, name));
    const take = group.find(it => it.take)?.take || `${plural(group.reduce((n, it) => n + it.count, 0), 'time')} in the last day`;
    return issueFrom(group, { name, take, owner: group[0].owner, existingRow: row?.row ?? null });
  });
}

/**
 * One Haiku call: same underlying problem → one issue, matched to a sheet row
 * when it is one already there. Counts and clients are counted here, never
 * taken from the model.
 *
 * @returns {Promise<{issues: Object[], grouped: 'model'|'rules', code?: string}>}
 */
export async function groupIssues(items, existingRows, createMessage) {
  if (!items.length) return { issues: [], grouped: 'rules' };
  const lines = items.map(it => JSON.stringify({
    id: it.id, kind: it.kind, what: it.what, count: it.count, clients: it.userIds.size,
    ...(it.take ? { take: it.take } : {}), owner: it.owner
  }));
  const rows = existingRows.map(r => `${r.row}: ${r.name}${r.status ? ` (${r.status})` : ''}`);
  let raw;
  try {
    raw = await callTool(createMessage, {
      system: [
        'You group today\'s GetGranted chat problems into issues for the team\'s errors sheet.',
        'Items with the same underlying problem are one issue. Every item belongs to exactly one issue.',
        'When an issue is one already in the sheet, give its row number as existing_row; otherwise null.',
        'Names and takes are your own words: short, plain, no client names.'
      ].join('\n'),
      user: [
        `Today's items:\n${lines.join('\n')}`,
        rows.length ? `Issues already in the sheet (row: name):\n${rows.join('\n')}` : 'The sheet has no issues yet.',
        `Call ${GROUP_TOOL.name} once.`
      ].join('\n\n'),
      tool: GROUP_TOOL,
      maxTokens: 1500,
      source: 'pulse-roundup-group'
    });
  } catch (err) {
    return { issues: fallbackIssues(items, existingRows), grouped: 'rules', code: String(codeOf(err)) };
  }

  const byId = new Map(items.map(it => [it.id, it]));
  const used = new Set();
  const validRows = new Set(existingRows.map(r => r.row));
  const issues = [];
  for (const g of Array.isArray(raw.issues) ? raw.issues : []) {
    const members = [...new Set(Array.isArray(g?.item_ids) ? g.item_ids.map(String) : [])]
      .filter(id => byId.has(id) && !used.has(id));
    if (!members.length || !String(g?.name || '').trim()) continue;
    members.forEach(id => used.add(id));
    issues.push(issueFrom(members.map(id => byId.get(id)), {
      name: g.name,
      take: g.take || byId.get(members[0]).take || '',
      owner: g.owner,
      existingRow: validRows.has(g.existing_row) ? g.existing_row : null
    }));
  }
  // Anything the model left out is still reported.
  const left = items.filter(it => !used.has(it.id));
  if (left.length) issues.push(...fallbackIssues(left, existingRows));
  return { issues, grouped: 'model' };
}

// ============================================================================
// 6. THE DM
// ============================================================================

/** Issues sorted by count; each with `clients` (labels) and seenBefore / beingFixed. */
export function formatRoundup(issues, { sheetId, hours = WINDOW_HOURS } = {}) {
  const sorted = [...issues].sort((a, b) => b.count - a.count);
  const clients = new Set(sorted.flatMap(i => i.userIds));
  const span = hours === 24 ? '24h' : `${hours}h`;
  const lines = [`☀️ GetGranted chat — last ${span}: ${plural(sorted.length, 'issue')} across ${plural(clients.size, 'client')}.`];
  for (const i of sorted.slice(0, MAX_LINES)) {
    const who = i.clients.length > 3 ? `${i.clients.slice(0, 3).join(', ')} +${i.clients.length - 3} more` : i.clients.join(', ');
    const tag = i.beingFixed ? ' — known, being fixed' : i.seenBefore ? ' — seen before' : '';
    lines.push(`• ${i.name} — ${who} — ${i.take} — ${i.owner}${tag}`);
  }
  if (sorted.length > MAX_LINES) lines.push(`…and ${sorted.length - MAX_LINES} more.`);
  lines.push(`Full list: ${sheetId ? sheetUrl(sheetId) : '(errors sheet)'}. Ask me about any of these for the conversation.`);
  return lines.join('\n');
}

// ============================================================================
// THE RUN
// ============================================================================

const REQUIRED_ENV = ['GG3_OPS_DB_READONLY_URL', SUBSCRIBERS_ENV, SHEET_ENV, OWNER_ENV];

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

async function defaultDeps(env) {
  const [{ query }, { getPulseSubscribers }, { postToSpaceWithThread }, sheets, { recordPulsePost }] = await Promise.all([
    import('../database/connection.js'),
    import('./pulse-subscribers.js'),
    import('../api/chat-google.js'),
    import('../tools/google-sheets.js'),
    import('./pulse-posts.js')
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
    readSheet: sheets.readSheetRange,
    updateSheet: sheets.updateSheetRange,
    appendSheet: sheets.appendSheetRow
  };
}

/**
 * Steps 1–4: what happened, as issues with client labels. Writes and sends
 * nothing — the dry run is exactly this.
 */
export async function buildRoundup({ hours = WINDOW_HOURS, existingRows = [], deps, collected = null }) {
  const { errors, conversations } = collected || {
    errors: await deps.collectErrors(hours),
    conversations: await deps.collectConversations(hours)
  };
  if (!errors || !conversations) return null;

  const reviews = await mapLimited(conversations, REVIEW_CONCURRENCY, async (c) => ({
    ...(await reviewConversation(c, deps.createMessage)), userId: c.userId
  }));
  const failedReviews = reviews.filter(r => !r.ok).length;
  const items = buildItems(errors, reviews.filter(r => r.ok));
  const grouping = await groupIssues(items, existingRows, deps.createMessage);
  const { labels, stats } = await clientLabels(grouping.issues.flatMap(i => i.userIds), deps.fetchProfile);
  const issues = grouping.issues.map(i => ({ ...i, clients: i.userIds.map(u => labels.get(u) || clientRef(u)) }));
  return {
    errors: errors.length,
    conversations: conversations.length,
    flagged: reviews.filter(r => r.ok && r.flags.length).length,
    failedReviews,
    grouped: grouping.grouped,
    groupCode: grouping.code || null,
    clientLookup: stats,
    issues
  };
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
 * @returns {Promise<{status: 'skipped'|'nothing'|'already_sent'|'no_state_table'|'sent'|'undelivered', missing?: string[], issues?: number, sent?: number}>}
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

  // The sheet is read before grouping so today's issues can match its rows.
  // Without it the DM still goes out, just without "seen before".
  const sheetId = env[SHEET_ENV].trim();
  let owner = await resolveSheetOwner(env, d.oracleQuery).catch(err => ({ ok: false, code: String(codeOf(err)) }));
  let rows = [];
  if (owner.ok) {
    const read = await readIssueRows({ sheetId, userId: owner.userId, read: d.readSheet });
    if (read.ok) rows = read.rows;
    else owner = { ok: false, code: read.code };
  }
  if (!owner.ok) console.warn(`⚠️  Pulse roundup: errors sheet unavailable — code: ${owner.code}`);

  const built = await buildRoundup({ hours, existingRows: rows, deps: d, collected: { errors, conversations } });
  if (built.failedReviews) console.warn(`⚠️  Pulse roundup: ${built.failedReviews} conversation review(s) failed`);
  if (built.groupCode) console.warn(`⚠️  Pulse roundup: grouping fell back to rules — code: ${built.groupCode}`);
  if (!built.issues.length) {
    console.log(`📣 Pulse roundup: nothing to report — ${built.errors} errors, ${built.conversations} conversations, none went badly`);
    return { status: 'nothing' };
  }

  let issues = built.issues.map(i => ({ ...i, seenBefore: false, beingFixed: false }));
  if (owner.ok) {
    const written = await writeIssues({
      issues, rows, sheetId, userId: owner.userId, today, update: d.updateSheet, append: d.appendSheet
    });
    issues = written.issues;
    console.log(`📋 Pulse roundup sheet: ${written.updated} updated, ${written.appended} added${written.failed ? `, ${written.failed} write(s) failed` : ''}`);
  }

  const text = formatRoundup(issues, { sheetId, hours });
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
    // The claim stays: the sheet's counts are already added.
    console.warn(`⚠️  Pulse roundup: ${issues.length} issue(s) but no subscriber could be reached — not retried today.`);
    return { status: 'undelivered', issues: issues.length, sent };
  }
  console.log(`📣 Pulse roundup: sent to ${sent} subscriber(s) — ${issues.length} issue(s), lookup ${built.clientLookup.named} named / ${built.clientLookup.ref} ref`);
  return { status: 'sent', issues: issues.length, sent };
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
