/**
 * Control Centre — the daily chat grouping pass (migration 049).
 *
 *   08:30 America/Vancouver   read the previous Vancouver day's GetGranted chats
 *                             (everyone's — internal accounts too, as the
 *                             morning roundup does; the Themes section shows
 *                             clients only), one Haiku pass over every client
 *                             message, store one row per message, then file two
 *                             kinds of chat card from the rows.
 *
 * A separate job and a separate model call from the morning roundup
 * (pulse-roundup.js), whose review call is untouched. It reads the roundup's
 * chat cards (Hub cc_review_items / cc_review_flags) as signals.
 *
 * Per client message the model gives: the question rewritten without names or
 * identifying details (only this is stored, never the client's words), a theme,
 * funding_ask, answer (answered / partly / not_answered), an unmet need (null
 * or a short label) and which of the cards shown on that reply the reply itself
 * said don't fit. Code adds what the data already says: the cards shown
 * (chat_turns.surfaced_grant_ids), the grants the tools returned and the reply
 * named, whether the chat searched (tool calls and their results), whether the
 * turn failed, and the roundup's flags on that turn.
 *
 * Unanswered is decided in code (unansweredReason): no answer (the turn failed,
 * or the reply didn't answer), the client asked for a person, or the client
 * left after a bad reply (their last message, and the reply partly or didn't
 * answer, or the roundup flagged that turn).
 *
 * Cards (review-queue.js addFlag, kind chat, source oracle_detected, one card
 * per chat per issue — chat_turn_ref conv:<conversation>:<issue>):
 *   no_cards_for_funding_ask  a funding ask whose reply showed no grant card
 *                             (only when chat_turns recorded the turn), with
 *                             the search status: did_not_search /
 *                             searched_found_nothing / searched_not_shown
 *   card_for_rejected_grant   a grant card shown for a grant the reply said
 *                             doesn't fit
 *   consulting_question       the client asked for consulting or application
 *                             writing (unmet_need matches CONSULTING_NEED) and
 *                             the reply wasn't a full answer (answer partly /
 *                             not_answered, or an unanswered reason) —
 *                             isConsultingCandidate, the one place to loosen
 * The hourly sweep diagnoses the first two (diagnosis.js): owner chris, the
 * verdict forced from that evidence. A consulting card is diagnosed in code,
 * no model call: owner consulting, for a consultant to answer on the card.
 *
 * Reads the ops and app DBs through db.js (read-only). Writes only the Hub.
 * Off unless CC_CHAT_DAILY_ENABLED=true. Dry run and backfill:
 * scripts/cc-chat-daily.mjs. Docs: docs/control-centre.md (Chat themes tab).
 */

import { query as hubQueryDefault, transaction as hubTransactionDefault } from '../database/connection.js';
import { opsQuery as opsQueryDefault } from './db.js';
import { TIME_ZONE, vancouverDay, addDays } from './rollup.js';
import { identitiesForClerkIds } from './identity.js';
import { chatTurnsAround } from './diagnosis.js';
import { grantLink } from './links.js';
import { CONSULTING_ISSUE } from './card-summary.js';
import { ROUNDUP_MODEL, HUMAN_ASK, DETECTOR_ACTOR } from '../services/pulse-roundup.js';
import { BROKE_OUTCOMES, FAILED_OUTCOMES, EXCLUDED_CATEGORIES } from '../services/pulse-spike.js';
import { wrapToolOutput, UNTRUSTED_DATA_INSTRUCTION } from '../claude/tool-output.js';

export const DAILY_MODEL = ROUNDUP_MODEL;
export const DAILY_ENABLED_ENV = 'CC_CHAT_DAILY_ENABLED';
export const CALL_BUDGET_CHARS = 40000;
const CLIENT_CHARS = 800;
const REPLY_CHARS = 1500;
const QUESTION_CHARS = 300;
const THEME_CHARS = 60;
const NEED_CHARS = 60;
const MODEL_TIMEOUT_MS = 60000;
export const ISSUES = Object.freeze({ NO_CARDS: 'no_cards_for_funding_ask', REJECTED: 'card_for_rejected_grant', CONSULTING: CONSULTING_ISSUE });
/**
 * An unmet-need label that means the client asked for consulting or application
 * writing: the seed label and the ones the model is likely to invent. Loans,
 * SR&ED and "a grant we don't carry" don't match.
 */
export const CONSULTING_NEED = /consult|application[- ]?writ|grant[- ]?writ|proposal[- ]?writ|writing help|writ(e|ing) (my|the|an|our|a) (application|proposal)/i;
const SEARCH_TOOLS = new Set(['search_grants', 'lookup_grant_by_name']);
/** Roundup flags on a turn that mean the reply was bad. */
const BAD_REPLY_FLAGS = new Set(['left_unanswered', 'pushback', 'repeated_question']);
/** Starting unmet-need labels; the model reuses these or the ones already stored. */
export const SEED_NEEDS = Object.freeze(['Loans', 'SR&ED / tax credits', 'Consulting or application writing', 'A grant we don\'t carry']);
/** Starting themes: broad, so a day's questions group instead of each getting its own. */
export const SEED_THEMES = Object.freeze([
  'Finding grants for my business', 'Eligibility', 'Hiring and training', 'Equipment and capital costs', 'Export and new markets',
  'R&D and innovation', 'Start-up funding', 'Loans and financing', 'Application help', 'Program details and deadlines',
  'Company profile and account', 'Watchlist and saved grants'
]);

const arr = (v) => (Array.isArray(v) ? v : []);
const ids = (v) => [...new Set(arr(v).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const codeOf = (err) => err?.status ?? err?.code ?? err?.name ?? 'unknown';

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const inDay = (col) => `${col} >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${col} < ($1::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;

// Ops DB (read-only). Real Clerk users only: the test harnesses are left out.
export const DAY_TURNS_SQL = `
  SELECT conversation_id, turn_index, occurred_at, user_id, outcome, error_category, surfaced_grant_ids, tool_calls
    FROM chat_turns
   WHERE ${inDay('occurred_at')}
     AND conversation_id IS NOT NULL AND turn_index IS NOT NULL
     AND user_id LIKE 'user\\_%'
   ORDER BY occurred_at`;

// Conversations active that day that chat_turns never recorded (its early gaps).
export const DAY_UNRECORDED_SQL = `
  SELECT c.id FROM conversations c
   WHERE ${inDay('c.updated_at')}
     AND c.user_id LIKE 'user\\_%'
     AND NOT EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id)`;

export const CONVERSATIONS_SQL = `
  SELECT id, user_id, messages, created_at, updated_at FROM conversations WHERE id = ANY($1::int[])`;

export const TURN_ROWS_SQL = `
  SELECT conversation_id, turn_index, occurred_at, outcome, error_category, surfaced_grant_ids, tool_calls
    FROM chat_turns WHERE conversation_id = ANY($1::int[]) AND turn_index IS NOT NULL`;

// Hub DB
export const ROUNDUP_FLAGS_SQL = `
  SELECT i.conversation_id, i.chat_turn_ref, f.source_ref
    FROM cc_review_items i
    JOIN cc_review_flags f ON f.item_id = i.id
   WHERE i.kind = 'chat' AND i.conversation_id = ANY($1::int[]) AND f.source = 'oracle_detected'`;

export const GRANT_NAMES_SQL = 'SELECT id, grant_name FROM gg3_grants WHERE id = ANY($1::int[])';

export const KNOWN_LABELS_SQL = `
  SELECT 'theme' AS kind, theme AS label, count(*)::int AS n FROM cc_chat_questions WHERE day >= $1::date GROUP BY theme
  UNION ALL
  SELECT 'need', unmet_need, count(*)::int FROM cc_chat_questions WHERE day >= $1::date AND unmet_need IS NOT NULL GROUP BY unmet_need
  UNION ALL
  SELECT 'theme', name, 0 FROM cc_digest_themes WHERE week_start = (SELECT max(week_start) FROM cc_digest_themes)`;

export const CLAIM_DAY_SQL = `
  INSERT INTO cc_chat_daily_runs (day, status, model) VALUES ($1, 'running', $2)
  ON CONFLICT (day) DO NOTHING RETURNING day`;
export const FINISH_DAY_SQL = `
  UPDATE cc_chat_daily_runs
     SET status = $2, conversations = $3, messages = $4, input_tokens = $5, output_tokens = $6, cost_usd = $7,
         cards_filed = $8, error_code = $9, finished_at = NOW(), updated_at = NOW()
   WHERE day = $1`;
export const DELETE_DAY_SQL = 'DELETE FROM cc_chat_questions WHERE day = $1';
export const UPSERT_QUESTION_SQL = `
  INSERT INTO cc_chat_questions (day, conversation_id, turn_index, clerk_id, company_id, occurred_at, question, theme, funding_ask,
    answer, unanswered_reason, unmet_need, cards_shown, cards_recorded, grants_named, rejected_shown, search_status, search_results, turn_failed)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
  ON CONFLICT (conversation_id, turn_index) DO UPDATE SET
    day = EXCLUDED.day, clerk_id = EXCLUDED.clerk_id, company_id = EXCLUDED.company_id, occurred_at = EXCLUDED.occurred_at,
    question = EXCLUDED.question, theme = EXCLUDED.theme, funding_ask = EXCLUDED.funding_ask, answer = EXCLUDED.answer,
    unanswered_reason = EXCLUDED.unanswered_reason, unmet_need = EXCLUDED.unmet_need, cards_shown = EXCLUDED.cards_shown,
    cards_recorded = EXCLUDED.cards_recorded, grants_named = EXCLUDED.grants_named, rejected_shown = EXCLUDED.rejected_shown,
    search_status = EXCLUDED.search_status, search_results = EXCLUDED.search_results, turn_failed = EXCLUDED.turn_failed`;

// ---------------------------------------------------------------------------
// Pure: one conversation → its turns
// ---------------------------------------------------------------------------

const textOf = (content) => (typeof content === 'string'
  ? content
  : arr(content).filter((b) => b?.type === 'text').map((b) => b.text).join('\n'));

const resultBody = (block) => {
  const t = typeof block?.content === 'string' ? block.content : arr(block?.content).map((c) => c?.text || '').join('');
  try { return JSON.parse(t); } catch { return null; }
};

/**
 * Pure: the messages → one entry per client turn (a user message with string
 * content — the same count as chat_turns.turn_index and splitTurns): the
 * client's text, the reply's text, the grants the tools returned, whether it
 * searched and how many results, and legacy surface_grant_tiles ids.
 */
export function parseTurns(messages) {
  const turns = [];
  const pending = new Map(); // tool_use id → name
  for (const m of arr(messages)) {
    if (m?.role === 'user' && typeof m.content === 'string') {
      turns.push({ turn_index: turns.length, client: m.content, reply: [], returned: new Map(), searched: false, search_results: 0, legacy_cards: [] });
      continue;
    }
    const t = turns.at(-1);
    if (!t) continue;
    if (m?.role === 'assistant') {
      const text = textOf(m.content).trim();
      if (text) t.reply.push(text);
      for (const b of arr(m.content)) {
        if (b?.type !== 'tool_use') continue;
        pending.set(b.id, b.name);
        if (SEARCH_TOOLS.has(b.name)) t.searched = true;
        if (b.name === 'surface_grant_tiles') t.legacy_cards.push(...ids(b.input?.grantIds));
      }
    } else if (m?.role === 'user') {
      for (const b of arr(m.content)) {
        if (b?.type !== 'tool_result') continue;
        const name = pending.get(b.tool_use_id);
        const body = resultBody(b);
        if (!body) continue;
        const note = (g) => {
          const id = Number(g?.id);
          const gname = g?.grant_name ?? g?.name;
          if (Number.isInteger(id) && id > 0 && gname) t.returned.set(id, String(gname));
        };
        for (const g of arr(body.results)) note(g);
        for (const g of arr(body.grants)) note(g);
        for (const g of arr(body.candidates)) note(g);
        if (body.match) note(body.match);
        if (body.found && body.grant_name) note(body);
        if (name === 'search_grants') t.search_results += arr(body.results).length;
        if (name === 'lookup_grant_by_name' && body.found && body.match) t.search_results += 1;
      }
    }
  }
  return turns.map((t) => ({ ...t, reply: t.reply.join('\n\n'), legacy_cards: ids(t.legacy_cards) }));
}

/** Pure: grants returned this turn whose full name appears in the reply. */
export function namedInReply(reply, returned) {
  const text = String(reply ?? '').toLowerCase();
  return [...returned].filter(([, name]) => name.length >= 6 && text.includes(name.toLowerCase())).map(([id]) => id);
}

/** Pure: the search status of a turn from its tool use and the cards shown. */
export function searchStatus({ searched, search_results: n }, cardsShown) {
  if (!searched) return 'did_not_search';
  if (!n) return 'searched_found_nothing';
  return cardsShown.length ? 'searched_shown' : 'searched_not_shown';
}

/** "oracle:<conv>:<issue>:t<n|end>" → {issue, turn} (turn null for "end"). */
export function parseFlagRef(ref) {
  const m = /^oracle:(\d+):([a-z_]+):t(\d+|end)$/.exec(String(ref ?? ''));
  return m ? { conversation_id: Number(m[1]), issue: m[2], turn: m[3] === 'end' ? null : Number(m[3]) } : null;
}

/**
 * Pure: why a message counts as unanswered, or null. First that applies:
 *   no_answer             the turn failed, or the reply didn't answer
 *   asked_for_person      the client asked for a person: the roundup's
 *                         asked_for_human on the turn, or the model said so and
 *                         the client's words match HUMAN_ASK
 *   left_after_bad_reply  it is the client's last message in the chat and the
 *                         reply partly or didn't answer, or the roundup flagged
 *                         the turn left_unanswered / pushback / repeated_question
 */
export function unansweredReason({ failed = false, answer, client = '', flags = [], isLast = false, askedForPerson = false }) {
  if (failed || answer === 'not_answered') return 'no_answer';
  // The model's judgement must be backed by the client's own words (the roundup's cleanReview rule).
  if (flags.includes('asked_for_human') || (askedForPerson && HUMAN_ASK.test(String(client)))) return 'asked_for_person';
  if (isLast && (answer === 'partly' || flags.some((f) => BAD_REPLY_FLAGS.has(f)))) return 'left_after_bad_reply';
  return null;
}

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

const isFailedTurn = (r) => FAILED_OUTCOMES.includes(r?.outcome)
  && !(r?.error_category && EXCLUDED_CATEGORIES.includes(r.error_category));

/**
 * Every client message of a Vancouver day, with what the data says about it.
 * @returns {Promise<{day, messages: Array, conversations: Map}>}
 */
export async function collectDay(day, deps) {
  const [turnRows, unrecorded] = await Promise.all([
    deps.opsQuery(DAY_TURNS_SQL, [day]),
    deps.opsQuery(DAY_UNRECORDED_SQL, [day])
  ]);
  const convIds = [...new Set([...turnRows.rows.map((r) => r.conversation_id), ...unrecorded.rows.map((r) => r.id)])];
  if (!convIds.length) return { day, messages: [], conversations: new Map() };
  const [convs, allTurnRows, flags] = await Promise.all([
    deps.opsQuery(CONVERSATIONS_SQL, [convIds]),
    deps.opsQuery(TURN_ROWS_SQL, [convIds]),
    deps.hubQuery(ROUNDUP_FLAGS_SQL, [convIds]).catch(() => ({ rows: [] }))
  ]);
  const rowOf = new Map(allTurnRows.rows.map((r) => [`${r.conversation_id}|${r.turn_index}`, r]));
  const dayTurns = new Set(turnRows.rows.map((r) => `${r.conversation_id}|${r.turn_index}`));
  const unrecordedIds = new Set(unrecorded.rows.map((r) => r.id));

  const conversations = new Map();
  const messages = [];
  for (const c of convs.rows) {
    const turns = parseTurns(c.messages);
    conversations.set(c.id, { ...c, turns });
    const last = turns.length - 1;
    const flagsAt = new Map();
    for (const f of flags.rows.filter((x) => x.conversation_id === c.id)) {
      const p = parseFlagRef(f.source_ref);
      if (!p) continue;
      const at = p.turn ?? last;
      if (!flagsAt.has(at)) flagsAt.set(at, new Set());
      flagsAt.get(at).add(p.issue);
    }
    for (const t of turns) {
      const key = `${c.id}|${t.turn_index}`;
      if (!dayTurns.has(key) && !unrecordedIds.has(c.id)) continue;
      const row = rowOf.get(key) ?? null;
      const cards = row ? ids(row.surfaced_grant_ids) : t.legacy_cards;
      messages.push({
        conversation_id: c.id, turn_index: t.turn_index, clerk_id: c.user_id,
        occurred_at: row?.occurred_at ?? c.updated_at,
        client: t.client, reply: t.reply,
        cards_shown: cards, cards_recorded: Boolean(row) || t.legacy_cards.length > 0,
        returned: t.returned,
        grants_named: namedInReply(t.reply, t.returned),
        searched: t.searched, search_results: t.search_results,
        search_status: searchStatus(t, cards),
        failed: isFailedTurn(row), broke: BROKE_OUTCOMES.includes(row?.outcome),
        flags: [...(flagsAt.get(t.turn_index) ?? [])],
        isLast: t.turn_index === last
      });
    }
  }
  messages.sort((a, b) => a.conversation_id - b.conversation_id || a.turn_index - b.turn_index);
  return { day, messages, conversations };
}

// ---------------------------------------------------------------------------
// The model pass
// ---------------------------------------------------------------------------

const DAILY_TOOL = {
  name: 'chat_day_review',
  description: 'For each numbered client message: the question rewritten, its theme, and what happened.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            question: { type: 'string', description: 'The client\'s question in one short plain sentence, with no names of people or companies, no emails, phone numbers, websites or other identifying details.' },
            theme: { type: 'string', description: 'A short theme name (2-5 words). Reuse a name from the given list when it fits.' },
            funding_ask: { type: 'boolean', description: 'True when the client asked for funding, grants, loans, tax credits or funding programs (for their business or a project).' },
            answer: { type: 'string', enum: ['answered', 'partly', 'not_answered'], description: 'Whether the reply answered this message.' },
            asked_for_person: { type: 'boolean', description: 'True only when the CLIENT asked to talk to a person, a human, staff, a call, or help@granted.ca in this message.' },
            unmet_need: { type: ['string', 'null'], description: 'Only when the CLIENT\'s message itself asks for something GetGranted does not offer (for example a loan, SR&ED or tax credits, consulting or writing help, a specific program it does not carry): a short label, reusing a given label when it fits. Not when only the reply mentions such things. Otherwise null.' },
            rejected_shown: { type: 'array', items: { type: 'string' }, description: 'Names, exactly as listed under CARDS SHOWN, of the grants the reply itself said do not fit the client (not eligible, wrong region or industry, not a match). Empty when none.' }
          },
          required: ['id', 'question', 'theme', 'funding_ask', 'answer', 'asked_for_person', 'unmet_need', 'rejected_shown']
        }
      }
    },
    required: ['items']
  }
};

export const DAILY_SYSTEM = [
  'You read one day of conversations between clients and GetGranted\'s AI grant assistant, for the team that runs it.',
  'GetGranted helps Canadian businesses find and apply for government grants and funding programs. Each item is one client message, the assistant\'s reply to it, and the grant cards that reply showed.',
  'For every item give: the question rewritten without identifying details; a theme; funding_ask; answer; unmet_need; rejected_shown.',
  '- theme: the broad topic of the question. Use a name from the known themes whenever one fits, even loosely; make a new one (2-5 words, broad, never one grant\'s name) only when none does. A day usually needs well under ten themes.',
  '- answer: "answered" when the reply addressed the question; "partly" when it addressed only part or stayed vague; "not_answered" when it did not address it (including a refusal or a reply about something else). Saying honestly that GetGranted doesn\'t cover something IS an answer.',
  '- unmet_need: only when the CLIENT\'s own message asks for something GetGranted does not offer (for example a loan, SR&ED or tax credits, consulting or someone to write the application, a specific program GetGranted does not carry). Judge the client\'s words, not the reply: a reply that brings up loans or other options does not make the client\'s question an unmet need. A general grant question is never an unmet need. Otherwise null.',
  '- rejected_shown: only cards from that item\'s CARDS SHOWN list that the reply says don\'t fit.',
  UNTRUSTED_DATA_INSTRUCTION
].join('\n');

/** Pure: one message as the model sees it. */
export function itemText(m, id, names) {
  const cards = !m.cards_recorded ? 'not recorded'
    : m.cards_shown.length ? m.cards_shown.map((g) => names.get(g) ?? `grant ${g}`).join('; ') : 'none';
  return `[${id}] CLIENT: ${clip(m.client, CLIENT_CHARS)}\nREPLY: ${clip(m.reply, REPLY_CHARS) || '(no reply text)'}\nCARDS SHOWN: ${cards}`;
}

/** Pure: the messages split into calls under the text budget. */
export function chunk(texts, budget = CALL_BUDGET_CHARS) {
  const out = [];
  let cur = []; let size = 0;
  texts.forEach((t, i) => {
    if (cur.length && size + t.length > budget) { out.push(cur); cur = []; size = 0; }
    cur.push(i); size += t.length + 2;
  });
  if (cur.length) out.push(cur);
  return out;
}

let anthropic = null;
async function defaultCreateMessage(params, opts) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic.messages.create(params, opts);
}

/** One forced-tool Haiku call. Usage is returned; the cost is logged only when logCost is given. */
export async function callDaily(createMessage, user, { logCost = null, maxTokens = 8000 } = {}) {
  const response = await createMessage({
    model: DAILY_MODEL, max_tokens: maxTokens, temperature: 0, system: DAILY_SYSTEM,
    tools: [DAILY_TOOL], tool_choice: { type: 'tool', name: DAILY_TOOL.name },
    messages: [{ role: 'user', content: user }]
  }, { timeout: MODEL_TIMEOUT_MS, maxRetries: 1 });
  if (response?.usage && logCost) logCost({ usage: response.usage, model: DAILY_MODEL, source: 'cc-chat-daily' });
  const input = (response?.content || []).find((b) => b.type === 'tool_use' && b.name === DAILY_TOOL.name)?.input;
  if (!input || !Array.isArray(input.items)) throw Object.assign(new Error('no tool call'), { code: 'no_tool_call' });
  return { items: input.items, usage: response.usage ?? null };
}

/** Pure: the model's item for a message → the stored row (or null when the model skipped it). */
export function rowFor(m, item, { day, companyOf, names }) {
  if (!item) return null;
  const question = clip(item.question, QUESTION_CHARS);
  if (!question) return null;
  const answer = ['answered', 'partly', 'not_answered'].includes(item.answer) ? item.answer : 'answered';
  const byName = new Map(m.cards_shown.map((g) => [String(names.get(g) ?? `grant ${g}`).toLowerCase(), g]));
  const rejected = ids(arr(item.rejected_shown).map((n) => byName.get(String(n).trim().toLowerCase())));
  return {
    day, conversation_id: m.conversation_id, turn_index: m.turn_index, clerk_id: m.clerk_id,
    company_id: companyOf.get(m.clerk_id) ?? null, occurred_at: m.occurred_at,
    question, theme: clip(item.theme, THEME_CHARS) || 'Other',
    funding_ask: item.funding_ask === true, answer,
    unanswered_reason: unansweredReason({ failed: m.failed, answer, client: m.client, flags: m.flags, isLast: m.isLast,
      askedForPerson: item.asked_for_person === true }),
    unmet_need: item.unmet_need ? clip(item.unmet_need, NEED_CHARS) : null,
    cards_shown: m.cards_shown, cards_recorded: m.cards_recorded, grants_named: m.grants_named, rejected_shown: rejected,
    search_status: m.search_status, search_results: m.search_results, turn_failed: m.failed
  };
}

/** Theme and unmet-need names already in use (last 30 days) plus the latest digest's themes. */
async function knownLabels(day, deps) {
  try {
    const r = await deps.hubQuery(KNOWN_LABELS_SQL, [addDays(day, -30)]);
    const themes = [...new Set([...SEED_THEMES, ...r.rows.filter((x) => x.kind === 'theme' && x.label).map((x) => x.label)])];
    const needs = [...new Set([...SEED_NEEDS, ...r.rows.filter((x) => x.kind === 'need' && x.label).map((x) => x.label)])];
    return { themes, needs };
  } catch {
    return { themes: [...SEED_THEMES], needs: [...SEED_NEEDS] };
  }
}

/**
 * Classify one day's messages. Pure apart from deps (model, Hub reads).
 * @returns {Promise<{rows: Array, skipped: number, usage: {input_tokens: number, output_tokens: number}, calls: number}>}
 */
export async function classifyDay(collected, deps, { logCost = null } = {}) {
  const { day, messages } = collected;
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (!messages.length) return { rows: [], skipped: 0, usage, calls: 0 };
  const allCards = ids(messages.flatMap((m) => m.cards_shown));
  const names = allCards.length ? new Map((await deps.hubQuery(GRANT_NAMES_SQL, [allCards])).rows.map((r) => [Number(r.id), r.grant_name])) : new Map();
  const companyOf = await deps.companyFor([...new Set(messages.map((m) => m.clerk_id))]).catch(() => new Map());
  const labels = await knownLabels(day, deps);
  const texts = messages.map((m, i) => itemText(m, i + 1, names));
  const items = new Map();
  let calls = 0;
  for (const part of chunk(texts)) {
    const user = [
      labels.themes.length ? `Known themes: ${labels.themes.join('; ')}` : 'No known themes yet.',
      `Known unmet-need labels: ${labels.needs.join('; ')}`,
      `The messages:\n\n${wrapToolOutput('gg3_conversations', part.map((i) => texts[i]).join('\n\n'))}`,
      `Call ${DAILY_TOOL.name} once, with one item per message id.`
    ].join('\n\n');
    const r = await deps.callDaily(user, { logCost, maxTokens: Math.min(8000, 150 + part.length * 120) });
    calls += 1;
    usage.input_tokens += r.usage?.input_tokens ?? 0;
    usage.output_tokens += r.usage?.output_tokens ?? 0;
    for (const it of r.items) if (Number.isInteger(it?.id)) items.set(it.id, it);
  }
  const rows = [];
  let skipped = 0;
  messages.forEach((m, i) => {
    const row = rowFor(m, items.get(i + 1), { day, companyOf, names });
    if (row) rows.push(row); else skipped += 1;
  });
  return { rows, skipped, usage, calls };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const SEARCH_WORDS = Object.freeze({
  did_not_search: 'The chat didn\'t search for grants before replying.',
  searched_found_nothing: 'The chat searched and found nothing.',
  searched_not_shown: 'The chat searched and found grants but showed none as cards.'
});

/** How the chat did on a consulting question, in words: by the unanswered reason first, else the answer. */
export const CONSULTING_WORDS = Object.freeze({
  no_answer: 'The chat didn\'t answer it.',
  asked_for_person: 'The client asked for a person.',
  left_after_bad_reply: 'The client left after the reply.',
  partly: 'The chat only partly answered it.',
  not_answered: 'The chat didn\'t answer it.'
});

/**
 * Pure: a stored row is a consulting-card candidate when the client asked for
 * consulting or application writing and the reply wasn't a full answer. The
 * daily prompt counts an honest "we don't do that" as answered, so those are
 * left out; drop the second condition to file every consulting ask.
 */
export function isConsultingCandidate(r) {
  return Boolean(r?.unmet_need) && CONSULTING_NEED.test(r.unmet_need)
    && (r.answer !== 'answered' || r.unanswered_reason != null);
}

/**
 * Pure: the rows → card candidates. One card per chat per issue; every
 * qualifying turn is a flag on it (its own source_ref, so re-runs add nothing).
 */
export function cardCandidates(rows, { names = new Map(), env = process.env } = {}) {
  const out = [];
  for (const r of rows) {
    if (r.funding_ask && r.cards_recorded && !r.cards_shown.length && r.search_status !== 'searched_shown') {
      out.push({
        issue: ISSUES.NO_CARDS, conversation_id: r.conversation_id, turn_index: r.turn_index, clerk_id: r.clerk_id,
        company_id: r.company_id, at: r.occurred_at,
        evidence: { rule: ISSUES.NO_CARDS, search_status: r.search_status, search_results: r.search_results, finding: SEARCH_WORDS[r.search_status] },
        take: `Funding ask with no grant cards. ${SEARCH_WORDS[r.search_status]}`
      });
    }
    if (r.rejected_shown.length) {
      const grants = r.rejected_shown.map((g) => ({ grant_id: g, name: names.get(g) ?? `Grant #${g}`, link: grantLink(g, env) }));
      out.push({
        issue: ISSUES.REJECTED, conversation_id: r.conversation_id, turn_index: r.turn_index, clerk_id: r.clerk_id,
        company_id: r.company_id, at: r.occurred_at,
        evidence: { rule: ISSUES.REJECTED, rejected_grants: grants },
        take: `A grant card was shown for ${grants.map((g) => g.name).join(', ')}, which the reply said doesn't fit.`
      });
    }
    if (isConsultingCandidate(r)) {
      const how = CONSULTING_WORDS[r.unanswered_reason] ?? CONSULTING_WORDS[r.answer] ?? 'The chat didn\'t fully answer it.';
      out.push({
        issue: ISSUES.CONSULTING, conversation_id: r.conversation_id, turn_index: r.turn_index, clerk_id: r.clerk_id,
        company_id: r.company_id, at: r.occurred_at,
        evidence: { rule: ISSUES.CONSULTING, unmet_need: r.unmet_need, answer: r.answer, unanswered_reason: r.unanswered_reason ?? null, question: r.question },
        take: `Consulting question (${r.unmet_need}). ${how} A consultant's answer is needed.`
      });
    }
  }
  return out;
}

export const cardRef = (c) => `conv:${c.conversation_id}:${c.issue}`;
export const flagRef = (c) => `oracle:${c.conversation_id}:${c.issue}:t${c.turn_index}`;

/** File each candidate on its chat card. Never throws; failures are counted. */
export async function fileCards(candidates, conversations, { addFlag }) {
  const results = [];
  let failed = 0;
  for (const c of candidates) {
    const around = chatTurnsAround(conversations.get(c.conversation_id)?.messages ?? [], c.turn_index);
    try {
      const r = await addFlag({
        kind: 'chat', chat_turn_ref: cardRef(c), conversation_id: c.conversation_id, company_id: c.company_id ?? undefined,
        source: 'oracle_detected', source_ref: flagRef(c), source_created_at: c.at ?? null,
        actor: DETECTOR_ACTOR, comment: c.take.slice(0, 1000),
        snapshot: around.ok ? { source: 'oracle_detected', conversation_id: c.conversation_id, issue: c.issue,
          rule_evidence: c.evidence, detector_take: c.take, ...around.body } : undefined
      });
      results.push({ candidate: c, ok: true, id: r.item?.id, created: r.created, duplicate: r.duplicate });
    } catch (err) {
      failed += 1;
      results.push({ candidate: c, ok: false });
      console.error(`❌ CC chat daily: filing a chat card failed — code: ${codeOf(err)}`);
    }
  }
  return { results, failed };
}

// ---------------------------------------------------------------------------
// Store and run
// ---------------------------------------------------------------------------

export async function storeDay(day, rows, hubTransaction = hubTransactionDefault) {
  return hubTransaction(async (client) => {
    await client.query(DELETE_DAY_SQL, [day]);
    for (const r of rows) {
      await client.query(UPSERT_QUESTION_SQL, [r.day, r.conversation_id, r.turn_index, r.clerk_id, r.company_id, r.occurred_at,
        r.question, r.theme, r.funding_ask, r.answer, r.unanswered_reason, r.unmet_need, r.cards_shown, r.cards_recorded,
        r.grants_named, r.rejected_shown, r.search_status, r.search_results, r.turn_failed]);
    }
    return rows.length;
  }, 'cc chat daily write');
}

export function defaultDeps() {
  return {
    opsQuery: opsQueryDefault,
    hubQuery: hubQueryDefault,
    hubTransaction: hubTransactionDefault,
    companyFor: async (clerks) => new Map([...(await identitiesForClerkIds(clerks))].map(([k, v]) => [k, v.company_id]).filter(([, v]) => v != null)),
    callDaily: (user, opts) => callDaily(defaultCreateMessage, user, opts),
    addFlag: async (input) => (await import('./review-queue.js')).addFlag(input),
    logCost: async (args) => (await import('../utils/cost-logger.js')).logAPICost(args),
    now: () => new Date()
  };
}

/** The Vancouver day before `now`. */
export const previousDay = (now = new Date()) => addDays(vancouverDay(now), -1);

/**
 * One day: collect, classify, and — when `write` — store the rows and file the
 * cards. Without `write` it writes nothing (no cost row either).
 */
export async function runDay(day, { deps: overrides = {}, write = false } = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const collected = await collectDay(day, deps);
  const classified = await classifyDay(collected, deps, { logCost: write ? deps.logCost : null });
  const allIds = ids(classified.rows.flatMap((r) => r.rejected_shown));
  const names = allIds.length ? new Map((await deps.hubQuery(GRANT_NAMES_SQL, [allIds])).rows.map((r) => [Number(r.id), r.grant_name])) : new Map();
  const candidates = cardCandidates(classified.rows, { names });
  let filed = null;
  if (write) {
    await storeDay(day, classified.rows, deps.hubTransaction);
    filed = await fileCards(candidates, collected.conversations, deps);
  }
  return { day, conversations: collected.conversations.size, messages: collected.messages.length, ...classified, candidates, filed };
}

/** The nightly run: claim yesterday, run it, record the outcome. Never throws. */
export async function runNightly({ deps: overrides = {} } = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const day = previousDay(deps.now());
  try {
    if (!(await deps.hubQuery(CLAIM_DAY_SQL, [day, DAILY_MODEL])).rows.length) return { status: 'already_run', day };
  } catch (err) {
    console.warn(`⚠️  CC chat daily: claim failed (code: ${codeOf(err)}) — not run`);
    return { status: 'no_table', day };
  }
  try {
    const r = await runDay(day, { deps, write: true });
    const { calculateRequestCost } = await import('../config/cost-settings.js');
    const cost = calculateRequestCost(r.usage, DAILY_MODEL);
    const filedCount = r.filed?.results.filter((x) => x.ok && !x.duplicate).length ?? 0;
    await deps.hubQuery(FINISH_DAY_SQL, [day, r.messages ? 'done' : 'empty', r.conversations, r.rows.length,
      r.usage.input_tokens, r.usage.output_tokens, cost, filedCount, null]);
    console.log(`🗂️  CC chat daily ${day}: ${r.rows.length} messages from ${r.conversations} chats, ${filedCount} card flag(s), $${cost.toFixed(4)}`);
    return { status: 'done', day, messages: r.rows.length, filed: filedCount };
  } catch (err) {
    await deps.hubQuery(FINISH_DAY_SQL, [day, 'failed', 0, 0, 0, 0, 0, 0, String(codeOf(err))]).catch(() => {});
    console.error(`❌ CC chat daily ${day} failed — code: ${codeOf(err)}`);
    return { status: 'failed', day, code: String(codeOf(err)) };
  }
}

export function missingDailyEnv(env = process.env) {
  return ['APP_DB_READONLY_URL', 'GG3_OPS_DB_READONLY_URL', 'ANTHROPIC_API_KEY'].filter((k) => !String(env[k] || '').trim());
}

/** 08:30 Vancouver, after the 08:00 morning roundup. Off unless CC_CHAT_DAILY_ENABLED=true. */
export function startChatDaily(cron, env = process.env) {
  if (env[DAILY_ENABLED_ENV] !== 'true') {
    console.log(`⏸️  CC chat daily pass off (${DAILY_ENABLED_ENV} is not true)`);
    return false;
  }
  const missing = missingDailyEnv(env);
  if (missing.length) {
    console.warn(`⚠️  CC chat daily pass NOT scheduled — unset: ${missing.join(', ')}`);
    return false;
  }
  cron.schedule('30 8 * * *', () => runNightly().catch(() => {}), { name: 'cc-chat-daily', timezone: TIME_ZONE, noOverlap: true });
  console.log('⏰ Cron job scheduled: CC chat daily pass at 08:30 America/Vancouver');
  return true;
}

export function _resetForTests() { anthropic = null; }
