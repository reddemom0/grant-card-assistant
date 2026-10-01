/**
 * GetGranted client conversations for Oracle (Pulse task 4)
 *
 * One read-only tool, four modes:
 *   read          one client's recent conversations: transcript, outcomes, grants shown
 *   search        conversations across clients whose client messages contain every term
 *   troubleshoot  read + company name + match context + match-explain + the errors
 *                 sheet's current issues. Gathers evidence only; Oracle decides.
 *   log_issue     the one write: add or update a row in the errors sheet, as
 *                 PULSE_SHEET_OWNER_EMAIL, Source "reported by <asker>". Status and
 *                 Notes on an existing row are never touched.
 *
 * Reads go through gg3OpsQuery (oracle_readonly; six tables). This module never
 * names ai_review_log, ai_review_cache, llm_calls or tagger data: match-explain
 * runs inside gg3-ai-service and its tagger / llm fields are dropped here.
 *
 * Clients are known by Clerk id. The team sees them as "·xxxx" (the last four
 * characters, as in the roundup); company names come from ai-api-backend's
 * profile route when it answers.
 *
 * Client text leaves this module only as the tool result (wrapped as untrusted
 * by the executor) or, for search, in the asker's own results sheet. Logs carry
 * the mode and an error code, never params or text.
 *
 *   GG3_AI_SERVICE_URL, GG3_REVIEW_FEED_TOKEN   match-explain (optional)
 */

import { gg3OpsQuery } from '../services/gg3-ops-db.js';
import { BROKE_OUTCOMES, FAILED_OUTCOMES } from '../services/pulse-spike.js';
import { transcriptOf, fetchCompanyName, clientRef, OWNERS } from '../services/pulse-roundup.js';
import {
  SHEET_ENV, sheetUrl, localDate, resolveSheetOwner, readIssueRows, writeIssues
} from '../services/pulse-errors-sheet.js';

export const GG3_CONVERSATION_MODES = ['read', 'search', 'troubleshoot', 'log_issue'];
export const RESOLVE_DAYS = 90;
export const MAX_DAYS = 90;
export const SEARCH_LIMIT = 200;
export const INLINE_ROWS = 10;
export const TRANSCRIPT_CHARS = 4000;
export const SNIPPET_CHARS = 120;
const MAX_TERMS = 5;
const MAX_GRANTS = 3;
const MAX_EXPLAIN_CALLS = 3;
const EXPLAIN_TIMEOUT_MS = 10000;

export const NAME_NOT_FOUND =
  "I can't look clients up by company name yet. Give me the ·xxxx ref from the roundup or the errors sheet and I'll pull it up.";

const OUTCOME_WORDS = {
  turn_cap: 'hit the message limit',
  input_guard: 'message blocked by the input check',
  spend_cap: 'hit the spending cap'
};

const codeOf = (err) => err?.status ?? err?.code ?? err?.name ?? 'unknown';
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const clampInt = (v, def, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
};
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const words = (s) => String(s || '').replace(/_/g, ' ');

/** "·abcd" — the roundup's short ref; `long` gives eight characters for look-alikes. */
export const shortRef = (userId, long = false) => `·${String(userId || '').slice(long ? -8 : -4)}`;

/** Escape for ILIKE (backslash is Postgres's default escape). */
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Plain words for one failed turn. */
export function outcomeWords(outcome, category) {
  const base = BROKE_OUTCOMES.includes(outcome) ? 'chat broke'
    : outcome === 'no_answer' ? 'empty reply or refusal'
      : OUTCOME_WORDS[outcome] || words(outcome);
  return category ? `${base} (${words(category)})` : base;
}

// ============================================================================
// CLIENT RESOLUTION
// ============================================================================

/**
 * "·abcd", "a client ·abcd", "abcd…", or a full Clerk id.
 * @returns {{exact: string}|{suffix: string}|null}
 */
export function parseClientRef(ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const full = raw.match(/\buser_[A-Za-z0-9]+\b/);
  if (full) return { exact: full[0] };
  const suffix = raw.replace(/^a client\s*/i, '').replace(/^[·.\s]+/, '').trim();
  return /^[A-Za-z0-9]{4,}$/.test(suffix) ? { suffix } : null;
}

const candidatesFrom = (rows) => rows.map(r => ({ client: shortRef(r.user_id, true), last_active: isoDay(r.last_active) }));

/**
 * @returns {Promise<{ok: true, userId: string}|{ok: false, reason: string, message: string, candidates?: Array}>}
 */
export async function resolveClient({ client, name }, runQuery) {
  if (client) {
    const p = parseClientRef(client);
    if (!p) return { ok: false, reason: 'bad_ref', message: 'That client ref is not one I recognise. Use the ·xxxx ref from the roundup or the errors sheet.' };
    const res = p.exact
      ? await runQuery(
        `SELECT user_id, max(updated_at) AS last_active FROM conversations
          WHERE user_id = $1 GROUP BY user_id`, [p.exact])
      : await runQuery(
        `SELECT user_id, max(updated_at) AS last_active FROM conversations
          WHERE updated_at > now() - make_interval(days => $1::int)
            AND right(user_id, $2::int) = $3
          GROUP BY user_id ORDER BY last_active DESC LIMIT 6`,
        [RESOLVE_DAYS, p.suffix.length, p.suffix]);
    if (!res.configured) return notConfigured();
    if (res.rows.length === 1) return { ok: true, userId: res.rows[0].user_id };
    if (!res.rows.length) return { ok: false, reason: 'not_found', message: `No GetGranted conversations for client ${p.exact ? shortRef(p.exact) : `·${p.suffix}`} in the last ${RESOLVE_DAYS} days.` };
    return { ok: false, reason: 'ambiguous', message: 'More than one client has that ref. Ask which one.', candidates: candidatesFrom(res.rows) };
  }
  if (name) {
    const res = await runQuery(
      `SELECT user_id, max(updated_at) AS last_active FROM conversations
        WHERE updated_at > now() - make_interval(days => $1::int)
          AND messages::text ILIKE $2
        GROUP BY user_id ORDER BY last_active DESC LIMIT 5`,
      [RESOLVE_DAYS, `%${likeEscape(String(name).trim())}%`]);
    if (!res.configured) return notConfigured();
    if (res.rows.length === 1) return { ok: true, userId: res.rows[0].user_id };
    if (!res.rows.length) return { ok: false, reason: 'name_not_found', message: NAME_NOT_FOUND };
    return { ok: false, reason: 'ambiguous', message: 'Several clients mention that name. Ask which one.', candidates: candidatesFrom(res.rows) };
  }
  return { ok: false, reason: 'no_client', message: 'Say which client: the ·xxxx ref from the roundup, or a company name.' };
}

function notConfigured() {
  return { ok: false, reason: 'not_configured', message: 'GetGranted conversation data is not connected here (the ops database is not configured).' };
}

// ============================================================================
// READ
// ============================================================================

/** Grant names the conversation's tools returned, and the ids shown as tiles. */
export function grantsIn(messages) {
  const names = new Map();
  const shown = [];
  const note = (g) => {
    const id = Number(g?.id);
    const name = g?.grant_name ?? g?.name;
    if (Number.isInteger(id) && name) names.set(id, String(name));
  };
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(m?.content)) continue;
    for (const b of m.content) {
      if (b?.type === 'tool_use' && b.name === 'surface_grant_tiles') {
        for (const id of Array.isArray(b.input?.grantIds) ? b.input.grantIds : []) shown.push(Number(id));
      }
      if (b?.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content
          : (Array.isArray(b.content) ? b.content.map(c => c?.text || '').join('') : '');
        let body;
        try { body = JSON.parse(text); } catch { continue; }
        for (const g of Array.isArray(body?.grants) ? body.grants : []) note(g);
        for (const g of Array.isArray(body?.candidates) ? body.candidates : []) note(g);
        if (body?.match) note(body.match);
      }
    }
  }
  const ids = [...new Set(shown.filter(Number.isInteger))];
  return {
    names,
    shown: ids.map(id => (names.has(id) ? `${names.get(id)} (${id})` : `grant ${id}`))
  };
}

function capTranscript(transcript) {
  let kept = transcript;
  while (kept.length > 1 && kept.reduce((n, t) => n + t.text.length, 0) > TRANSCRIPT_CHARS) kept = kept.slice(1);
  return {
    transcript: kept.map(t => ({ ...t, text: t.text.slice(0, TRANSCRIPT_CHARS) })),
    earlier_items_left_out: transcript.length - kept.length
  };
}

/** Failed turns per conversation, in plain words. */
async function outcomesFor(convIds, runQuery) {
  const out = new Map();
  if (!convIds.length) return out;
  const res = await runQuery(
    `SELECT conversation_id, occurred_at, outcome, error_category
       FROM chat_turns
      WHERE conversation_id = ANY($1::int[])
        AND outcome <> 'completed'
      ORDER BY occurred_at`,
    [convIds]);
  for (const r of res.rows || []) {
    const list = out.get(r.conversation_id) || [];
    list.push({ at: iso(r.occurred_at), what: outcomeWords(r.outcome, r.error_category) });
    out.set(r.conversation_id, list);
  }
  return out;
}

/** The client's recent conversations, newest first. */
export async function readConversations(userId, { days = 30, limit = 3 } = {}, runQuery) {
  const res = await runQuery(
    `SELECT id, mode, messages, created_at, updated_at
       FROM conversations
      WHERE user_id = $1
        AND updated_at > now() - make_interval(days => $2::int)
      ORDER BY updated_at DESC
      LIMIT $3::int`,
    [userId, days, limit]);
  const rows = res.rows || [];
  const outcomes = await outcomesFor(rows.map(r => r.id), runQuery);
  return rows.map(r => {
    const messages = Array.isArray(r.messages) ? r.messages : [];
    const failures = outcomes.get(r.id) || [];
    return {
      conversation: r.id,
      started: iso(r.created_at),
      last_active: iso(r.updated_at),
      mode: r.mode || null,
      client_messages: messages.filter(m => m?.role === 'user' && typeof m.content === 'string').length,
      problems: failures.length ? failures : 'none recorded',
      grants_shown: grantsIn(messages).shown,
      ...capTranscript(transcriptOf(messages)),
      _messages: messages
    };
  });
}

const publicConv = ({ _messages, ...rest }) => rest;

async function companyFor(userId, deps) {
  try {
    const r = await deps.fetchProfile(userId);
    return { company: r.companyName || null, ...(r.companyName ? {} : { company_note: `company name not available (${r.status})` }) };
  } catch (err) {
    return { company: null, company_note: `company name not available (${codeOf(err)})` };
  }
}

async function modeRead(input, deps) {
  const who = await resolveClient(input, deps.runQuery);
  if (!who.ok) return who;
  const days = clampInt(input.days, 30, MAX_DAYS);
  const conversations = await readConversations(who.userId, { days, limit: clampInt(input.limit, 3, 5) }, deps.runQuery);
  return {
    client: shortRef(who.userId),
    ...(await companyFor(who.userId, deps)),
    days,
    conversations: conversations.map(publicConv),
    ...(conversations.length ? {} : { message: `No conversations from this client in the last ${days} days.` })
  };
}

// ============================================================================
// SEARCH
// ============================================================================

/** Date window: from/to (YYYY-MM-DD, to inclusive) or the last `days`. At most MAX_DAYS. */
export function windowFor({ from, to, days }, now = new Date()) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const end = day.test(String(to || '')) ? new Date(`${to}T00:00:00Z`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  const until = end || now;
  let since = day.test(String(from || '')) ? new Date(`${from}T00:00:00Z`) : new Date(until.getTime() - clampInt(days, 7, MAX_DAYS) * 864e5);
  if (until - since > MAX_DAYS * 864e5) since = new Date(until.getTime() - MAX_DAYS * 864e5);
  return { since, until };
}

export function snippetFor(text, terms) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const at = Math.max(0, Math.min(...terms.map(x => {
    const i = lower.indexOf(String(x).toLowerCase());
    return i < 0 ? Infinity : i;
  }).concat(t.length)));
  const start = Math.max(0, at - 40);
  return clip(`${start > 0 ? '…' : ''}${t.slice(start)}`, SNIPPET_CHARS);
}

async function modeSearch(input, deps) {
  const terms = [...new Set((Array.isArray(input.terms) ? input.terms : [input.terms])
    .map(s => String(s ?? '').trim()).filter(Boolean))].slice(0, MAX_TERMS);
  if (!terms.length) return { error: 'Give at least one word or phrase to search for.' };
  const { since, until } = windowFor(input, deps.now());

  const params = [since, until];
  const termClauses = terms.map(term => {
    params.push(`%${likeEscape(term)}%`);
    return `EXISTS (SELECT 1 FROM jsonb_array_elements(c.messages) m
                     WHERE m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string'
                       AND m->>'content' ILIKE $${params.length})`;
  });
  params.push(FAILED_OUTCOMES);
  const failedExpr = `EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation_id = c.id AND t.outcome = ANY($${params.length}::text[]))`;
  params.push(SEARCH_LIMIT);

  const res = await deps.runQuery(
    `SELECT c.id, c.user_id, c.mode, c.updated_at, ${failedExpr} AS failed,
            left((SELECT string_agg(m->>'content', E'\\n') FROM jsonb_array_elements(c.messages) m
                   WHERE m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string'), 20000) AS client_text
       FROM conversations c
      WHERE c.updated_at >= $1 AND c.updated_at < $2
        AND ${termClauses.join('\n        AND ')}
        ${input.failed_only ? `AND ${failedExpr}` : ''}
      ORDER BY c.updated_at DESC
      LIMIT $${params.length}::int`,
    params);
  if (!res.configured) return notConfigured();

  const rows = res.rows.map(r => ({
    client: shortRef(r.user_id),
    conversation: r.id,
    date: isoDay(r.updated_at),
    mode: r.mode || '',
    failed: r.failed ? 'yes' : 'no',
    asked: snippetFor(r.client_text, terms)
  }));
  const clients = new Set(res.rows.map(r => r.user_id)).size;
  const out = {
    terms,
    from: isoDay(since),
    to: isoDay(new Date(until.getTime() - 1)),
    ...(input.failed_only ? { failed_only: true } : {}),
    matches: rows.length,
    clients,
    ...(rows.length === SEARCH_LIMIT ? { note: `Stopped at ${SEARCH_LIMIT} conversations; narrow the dates or add a term.` } : {}),
    results: rows.slice(0, INLINE_ROWS)
  };
  if (rows.length > INLINE_ROWS) {
    try {
      out.sheet = await deps.writeSheet(deps.userId, {
        title: `Oracle – GetGranted conversations – ${clip(terms.join(', '), 40)} – ${localDate(deps.now())}`,
        about: [
          ['Searched for', terms.join(' AND ')],
          ['Dates', `${out.from} to ${out.to}`],
          ['Failed chats only', input.failed_only ? 'yes' : 'no'],
          ['Conversations', String(rows.length)],
          ['Clients', String(clients)],
          ['Note', `"What they asked" is the client's own words, cut to ${SNIPPET_CHARS} characters.`]
        ],
        tables: [{
          title: 'Conversations',
          columns: [
            { key: 'client', label: 'Client' }, { key: 'date', label: 'Last active' },
            { key: 'mode', label: 'Mode' }, { key: 'failed', label: 'Chat failed' },
            { key: 'asked', label: 'What they asked' }
          ],
          rows
        }]
      });
    } catch (err) {
      out.sheet = null;
      out.sheet_error = err?.message || 'The results sheet could not be created.';
    }
  }
  return out;
}

// ============================================================================
// TROUBLESHOOT
// ============================================================================

/** Grant ids from ids, the local GG3 copy, or the conversation's own tool results. */
export async function resolveGrants(grants, convNames, findGrant) {
  const out = [];
  for (const g of (Array.isArray(grants) ? grants : [grants]).map(s => String(s ?? '').trim()).filter(Boolean).slice(0, MAX_GRANTS)) {
    const asked = g;
    const idMatch = g.match(/^(?:.*\/grants\/)?(\d+)$/);
    if (idMatch) { out.push({ asked, id: Number(idMatch[1]), name: convNames.get(Number(idMatch[1])) || null }); continue; }
    let found = null;
    try { found = await findGrant(g); } catch { found = null; }
    if (!found) {
      const lower = g.toLowerCase();
      for (const [id, name] of convNames) if (name.toLowerCase().includes(lower)) { found = { id, name }; break; }
    }
    out.push(found ? { asked, id: found.id, name: found.name } : { asked, id: null, name: null });
  }
  return out;
}

async function defaultFindGrant(name) {
  const { searchGrantData, GG3_VISIBLE_STATUSES } = await import('./grant-data.js');
  const r = await searchGrantData({ query: name, status: GG3_VISIBLE_STATUSES, limit: 3 });
  const top = (r?.results || []).find(x => x.named_match) || (r?.results?.length === 1 ? r.results[0] : null);
  return top ? { id: Number(top.id), name: top.name } : null;
}

/** The client's latest matching run, and each named grant's place in it. */
export async function matchContext(userId, grantIds, runQuery) {
  const latest = await runQuery(
    `SELECT result_set_id, company_id, occurred_at
       FROM match_results
      WHERE user_id = $1 AND company_id IS NOT NULL
      ORDER BY occurred_at DESC
      LIMIT 1`,
    [userId]);
  const run = latest.rows?.[0];
  if (!run) return { run: null, note: 'No matching run on record for this client in the ops data.' };
  const sections = await runQuery(
    `SELECT DISTINCT section FROM match_results WHERE result_set_id = $1`, [run.result_set_id]);
  const rows = grantIds.length
    ? (await runQuery(
      `SELECT grant_id, section, shown, position, deleted_at_stage, match_score, eligibility, eligibility_reasons
         FROM match_results
        WHERE result_set_id = $1 AND grant_id = ANY($2::int[])`,
      [run.result_set_id, grantIds])).rows || []
    : [];
  return {
    run: { at: iso(run.occurred_at), company_id: run.company_id },
    sections: (sections.rows || []).map(r => r.section).filter(Boolean),
    grants: grantIds.map(id => {
      const hits = rows.filter(r => Number(r.grant_id) === id);
      if (!hits.length) return { grant_id: id, in_run: false };
      return {
        grant_id: id,
        in_run: true,
        places: hits.map(h => ({
          section: h.section,
          shown: Boolean(h.shown),
          position: h.position ?? null,
          dropped_at: h.deleted_at_stage || null,
          score: h.match_score ?? null,
          eligibility: typeof h.eligibility === 'string' ? h.eligibility : h.eligibility?.level ?? null,
          reasons: (Array.isArray(h.eligibility_reasons) ? h.eligibility_reasons : []).slice(0, 5).map(x => clip(typeof x === 'string' ? x : JSON.stringify(x), 160))
        }))
      };
    })
  };
}

/** What Oracle sees of match-explain: the verdict and the failing reasons, nothing about tags' runs or model calls. */
export function reduceExplain(body) {
  const v = body?.verdict || {};
  return {
    grant: body?.grant_name || null,
    track: body?.track || null,
    verdict: { kind: v.kind || null, owner: v.owner || null, summary: clip(v.summary, 300), ...(v.next ? { next: clip(v.next, 200) } : {}) },
    eligibility: body?.eligibility ? {
      level: body.eligibility.level ?? null,
      reasons: (Array.isArray(body.eligibility.reasons) ? body.eligibility.reasons : []).slice(0, 5).map(r => clip(typeof r === 'string' ? r : JSON.stringify(r), 160))
    } : null,
    failing: (Array.isArray(body?.failing_axes) ? body.failing_axes : []).slice(0, 5).map(a =>
      clip(`${a.grant_constraint ?? '?'} vs profile ${a.profile_value ?? '?'}${a.suspicion_reason ? ` (${a.suspicion_reason})` : ''}`, 200))
  };
}

export async function fetchMatchExplain({ grantId, companyId, track }, env = process.env) {
  const base = String(env.GG3_AI_SERVICE_URL || '').replace(/\/+$/, '');
  const token = env.GG3_REVIEW_FEED_TOKEN;
  if (!base || !token) return { ok: false, code: 'not_configured' };
  const qs = new URLSearchParams({ grant_id: String(grantId), company_id: String(companyId), track: String(track) });
  try {
    const res = await fetch(`${base}/api/v1/ai/internal/match-explain?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, code: body?.error || res.status };
    return { ok: true, explain: reduceExplain(body) };
  } catch (err) {
    return { ok: false, code: String(codeOf(err)) };
  }
}

async function sheetIssues(deps) {
  const sheetId = String(deps.env[SHEET_ENV] || '').trim();
  if (!sheetId) return { ok: false, code: 'not_configured' };
  const owner = await resolveSheetOwner(deps.env, deps.oracleQuery).catch(err => ({ ok: false, code: String(codeOf(err)) }));
  if (!owner.ok) return { ok: false, code: owner.code };
  const read = await readIssueRows({ sheetId, userId: owner.userId, read: deps.readSheet });
  if (!read.ok) return { ok: false, code: read.code };
  return { ok: true, sheetId, userId: owner.userId, rows: read.rows };
}

async function modeTroubleshoot(input, deps) {
  const who = await resolveClient(input, deps.runQuery);
  if (!who.ok) return who;
  const days = clampInt(input.days, 14, MAX_DAYS);
  const conversations = await readConversations(who.userId, { days, limit: 3 }, deps.runQuery);
  const convNames = new Map();
  for (const c of conversations) for (const [id, name] of grantsIn(c._messages).names) convNames.set(id, name);

  const grants = await resolveGrants(input.grants, convNames, deps.findGrant);
  const known = grants.filter(g => g.id);
  const match = await matchContext(who.userId, known.map(g => g.id), deps.runQuery);

  const explanations = [];
  if (known.length && match.run) {
    let calls = 0;
    for (const g of known) {
      const place = match.grants?.find(x => x.grant_id === g.id);
      const tracks = [...new Set((place?.places || []).map(p => p.section).filter(Boolean))];
      for (const track of (tracks.length ? tracks : match.sections).slice(0, 2)) {
        if (calls >= MAX_EXPLAIN_CALLS) break;
        calls += 1;
        const r = await deps.explain({ grantId: g.id, companyId: match.run.company_id, track });
        explanations.push(r.ok
          ? { grant_id: g.id, ...r.explain }
          : { grant_id: g.id, track, unavailable: `match explanation unavailable (${r.code})` });
        if (r.code === 'not_configured') break;
      }
    }
  }

  const sheet = await sheetIssues(deps);
  return {
    client: shortRef(who.userId),
    complaint: clip(input.complaint, 300) || null,
    ...(await companyFor(who.userId, deps)),
    days,
    conversations: conversations.map(publicConv),
    grants_named: grants,
    matching: match,
    match_explanations: explanations,
    errors_sheet: sheet.ok
      ? { issues: sheet.rows.map(r => ({ row: r.row, name: r.name, status: r.status, owner: r.owner, count: r.count })) }
      : { unavailable: `errors sheet unavailable (${sheet.code})` },
    owners: OWNERS,
    next: 'Give the likely cause, owner and a suggested fix, then log it with mode "log_issue" (existing_row when it is one of the sheet issues above).'
  };
}

// ============================================================================
// LOG ISSUE
// ============================================================================

/** The asker, from the server's own records — never from model input. */
export async function askerName(userId, chatContext, oracleQuery) {
  if (userId) {
    try {
      const r = await oracleQuery('SELECT name, email FROM users WHERE id = $1', [userId]);
      const u = r.rows?.[0];
      if (u?.name?.trim()) return u.name.trim();
      if (chatContext?.senderDisplayName) return chatContext.senderDisplayName;
      if (u?.email) return String(u.email).split('@')[0];
    } catch { /* fall through */ }
  }
  return chatContext?.senderDisplayName || 'the team';
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

async function modeLogIssue(input, deps) {
  const name = clip(input.name, 60);
  const take = clip(input.take, 300);
  if (!name || !take) return { error: 'log_issue needs name (a short issue name) and take (the likely cause and suggested fix).' };
  if (!OWNERS.includes(input.owner)) return { error: `owner must be one of: ${OWNERS.join(', ')}.` };

  const sheet = await sheetIssues(deps);
  if (!sheet.ok) return { error: `The errors sheet is not available (${sheet.code}); nothing was logged.` };

  let label = null;
  if (input.client) {
    const who = await resolveClient({ client: input.client }, deps.runQuery);
    if (who.ok) label = (await deps.fetchProfile(who.userId).catch(() => ({}))).companyName || clientRef(who.userId);
    else if (parseClientRef(input.client)?.suffix) label = `a client ·${parseClientRef(input.client).suffix.slice(-4)}`;
  }

  const byRow = sheet.rows.find(r => r.row === Number(input.existing_row));
  const row = byRow || sheet.rows.find(r => sameName(r.name, name)) || null;
  const asker = await askerName(deps.userId, deps.chatContext, deps.oracleQuery);
  const written = await writeIssues({
    issues: [{ name, count: 1, clients: label ? [label] : [], owner: input.owner, existingRow: row?.row ?? null, source: `reported by ${asker}`, notes: take }],
    rows: sheet.rows,
    sheetId: sheet.sheetId,
    userId: sheet.userId,
    today: localDate(deps.now()),
    update: deps.updateSheet,
    append: deps.appendSheet
  });
  if (written.failed) return { error: 'The errors sheet write failed; nothing was logged.' };
  return row
    ? { logged: 'updated', row: row.row, issue: row.name, note: 'Added to the existing issue: last seen, count and clients only. Its status and notes are unchanged.', sheet: sheetUrl(sheet.sheetId) }
    : { logged: 'added', issue: name, source: `reported by ${asker}`, sheet: sheetUrl(sheet.sheetId) };
}

// ============================================================================
// ENTRY
// ============================================================================

async function defaultDeps({ userId, chatContext }) {
  const [{ query }, sheets, { writeResultSheet }] = await Promise.all([
    import('../database/connection.js'),
    import('./google-sheets.js'),
    import('./grant-data-sheet.js')
  ]);
  return {
    userId,
    chatContext,
    env: process.env,
    now: () => new Date(),
    runQuery: gg3OpsQuery,
    oracleQuery: query,
    fetchProfile: (id) => fetchCompanyName(id),
    explain: (args) => fetchMatchExplain(args),
    findGrant: defaultFindGrant,
    writeSheet: writeResultSheet,
    readSheet: sheets.readSheetRange,
    updateSheet: sheets.updateSheetRange,
    appendSheet: sheets.appendSheetRow
  };
}

const MODES = { read: modeRead, search: modeSearch, troubleshoot: modeTroubleshoot, log_issue: modeLogIssue };

/**
 * @param {Object} input - tool input
 * @param {{userId?: number, chatContext?: Object, deps?: Object}} ctx
 */
export async function runGg3Conversations(input = {}, { userId = null, chatContext = null, deps = null } = {}) {
  const run = MODES[input.mode];
  if (!run) return { error: `mode must be one of: ${GG3_CONVERSATION_MODES.join(', ')}.` };
  const d = deps || await defaultDeps({ userId, chatContext });
  try {
    return await run(input, d);
  } catch (err) {
    console.error(`❌ gg3_conversations ${input.mode} failed — code: ${codeOf(err)}`);
    return { error: `The GetGranted conversation lookup failed (${codeOf(err)}). Try again, or narrow the dates.` };
  }
}
