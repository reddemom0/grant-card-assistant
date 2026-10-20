/**
 * Steph's morning brief — the daily job.
 *
 * Weekdays 08:00 America/Vancouver (the pre-call briefings schedule), gated by
 * STEPH_BRIEF_ENABLED === 'true'. One card in Steph's DM listing the inbox
 * threads she hasn't answered, grouped Clients → Partners → Leads → Team →
 * Government (Docs notifications last), each with a short assessment, an
 * in-thread Gmail DRAFT saved in her mailbox, and a Done button.
 *
 * Flow (runStephBrief):
 *   1. Steph's users row; her Gmail must be connected (gmail_connected_at +
 *      both scopes) — otherwise skip and post nothing.
 *   2. Claim the day (steph_brief_runs, migration 051). Dry runs never claim.
 *   3. Window: since the last completed real run (≤ 4 days), else 24 h (72 h
 *      on a Monday). Threads in the window plus the threads of items still
 *      open from earlier briefs are fetched and checked for her reply.
 *   4. Triage (steph-brief-triage.js), classify (steph-brief-classify.js),
 *      carry over / auto-tick, order.
 *   5. Items Haiku marked "no reply needed" keep their assessment, no draft.
 *      Up to STEPH_BRIEF_MAX_DRAFTS (15) of the rest get context + a draft
 *      (steph-brief-context.js): clients an Oracle run as Steph (Sonnet 5.5,
 *      ≤ 8 tool loops), everyone else fixed context + one Haiku call. Past
 *      the cap, items keep the Haiku assessment.
 *   6. Cost: every model call, the website lookup and web-search fees are
 *      totalled per item (steph_brief_items) and per run (counts.cost,
 *      cost_usd); api_cost_events rows carry metadata.brief_run_id /
 *      is_dry_run. Dry runs also draft up to 3 lead/client items with the
 *      other model, for comparison.
 *   7. Upsert items, render (src/cards/brief-card.js), post, record.
 *
 * DRAFTS ONLY. The only Gmail calls are Stage 1's listThreadsSince, getThread
 * and createDraftReply (src/tools/gmail.js has no send path; the no-send test
 * scans this file too). A dry run creates no drafts at all, writes only
 * is_test rows, leaves the real items untouched and posts to the caller's DM.
 *
 * Logs counts and codes only — never a sender, subject or body.
 */

import { GROUP_ORDER, READ_DAYS, carryOver, coveredSummary, docsAssessment, driveNotificationItems, groupBySender, hasDraft, orderItems, sortThreads } from './steph-brief-triage.js';
import { duePromiseItems, extractPromises, promiseCandidates } from './steph-brief-promises.js';
import { CLEAR_DRAFT_TEXT_SQL, INSERT_CORRECTION_SQL, SWEEP_DRAFT_TEXT_SQL, comparable, loadCorrections, summariseCorrections } from './steph-brief-learn.js';
import { classifyItems } from './steph-brief-classify.js';
import { contextForItem, ledgerTotal, sourcesOf } from './steph-brief-context.js';
import { loadStyleGuide } from './style-guides.js';
import { meetingLinksFor } from './meeting-links.js';

export const SCHEDULE = '0 8 * * 1-5';
const TZ = 'America/Vancouver';
export const DEFAULT_OWNER_EMAIL = 'ssang@granted.ca';
export const DEFAULT_MAX_DRAFTS = 15;
const MAX_THREADS = 400;
const FETCH_CONCURRENCY = 5;
const ORACLE_CONCURRENCY = 3;
const ORACLE_TIMEOUT_MS = 180_000;
export const COMPARE_ITEMS = 3;
const DAY_MS = 24 * 3600 * 1000;

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function maxDrafts(env = process.env) {
  const n = Number(env.STEPH_BRIEF_MAX_DRAFTS);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_DRAFTS;
}

/** The reading window: everything from the last READ_DAYS (14) days. */
export function windowStart(now = new Date()) {
  return new Date(now.getTime() - READ_DAYS * DAY_MS);
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const CLAIM_SQL = `
INSERT INTO steph_brief_runs (owner_email, local_date, is_test, recipient_email, recipient_chat_id)
VALUES ($1, $2, false, $3, $4)
ON CONFLICT (owner_email, local_date) WHERE NOT is_test DO UPDATE
   SET status = 'building', claimed_at = NOW(), error_code = NULL, completed_at = NULL
 WHERE (steph_brief_runs.status = 'failed'   AND steph_brief_runs.claimed_at < NOW() - INTERVAL '30 minutes')
    OR (steph_brief_runs.status = 'building' AND steph_brief_runs.claimed_at < NOW() - INTERVAL '2 hours')
RETURNING id`;

const TEST_RUN_SQL = `
INSERT INTO steph_brief_runs (owner_email, local_date, is_test, recipient_email, recipient_chat_id)
VALUES ($1, $2, true, $3, $4) RETURNING id`;

const PREVIOUS_ITEMS_SQL = `
SELECT * FROM steph_brief_items
 WHERE owner_email = $1 AND is_test = false
   AND (state = 'open' OR state_at > NOW() - INTERVAL '30 days' OR draft_text IS NOT NULL)`;

const UPSERT_ITEM_SQL = `
INSERT INTO steph_brief_items
  (owner_email, is_test, item_key, category, thread_ids, sender, subject, assessment, owner_hint, note, facts_line,
   draft_ids, draft_preview, nudge, first_seen_at, first_inbound_at, last_inbound_at, state, state_at, last_run_id, position,
   no_reply, model, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
   tool_calls, tools_used, web_searches, conversation_id, compare, item_type, badge, draft_text, draft_text_at,
   urgency, finance, due_on, held, sources, draft_message_id, company, sent_to)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, NOW()), $16, $17, 'open', NOW(), $18, $19,
   $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31::jsonb, $32, $33, $34, $35,
   $36, $37, $38, $39, $40, $41, $42, $43)
ON CONFLICT (owner_email, is_test, item_key) DO UPDATE SET
  category = EXCLUDED.category, thread_ids = EXCLUDED.thread_ids, sender = EXCLUDED.sender, subject = EXCLUDED.subject,
  assessment = EXCLUDED.assessment, owner_hint = EXCLUDED.owner_hint, note = EXCLUDED.note, facts_line = EXCLUDED.facts_line,
  draft_ids = EXCLUDED.draft_ids, draft_preview = EXCLUDED.draft_preview, nudge = EXCLUDED.nudge,
  first_inbound_at = EXCLUDED.first_inbound_at, last_inbound_at = EXCLUDED.last_inbound_at,
  state = 'open',
  state_at = CASE WHEN steph_brief_items.state = 'open' THEN steph_brief_items.state_at ELSE NOW() END,
  last_run_id = EXCLUDED.last_run_id, position = EXCLUDED.position,
  no_reply = EXCLUDED.no_reply, model = EXCLUDED.model, cost_usd = EXCLUDED.cost_usd,
  input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
  cache_read_tokens = EXCLUDED.cache_read_tokens, cache_write_tokens = EXCLUDED.cache_write_tokens,
  tool_calls = EXCLUDED.tool_calls, tools_used = EXCLUDED.tools_used, web_searches = EXCLUDED.web_searches,
  conversation_id = EXCLUDED.conversation_id, compare = EXCLUDED.compare,
  item_type = EXCLUDED.item_type, badge = EXCLUDED.badge,
  -- Kept until her reply is compared with it (steph-brief-learn.js), then cleared.
  draft_text = COALESCE(EXCLUDED.draft_text, steph_brief_items.draft_text),
  draft_text_at = COALESCE(EXCLUDED.draft_text_at, steph_brief_items.draft_text_at),
  urgency = EXCLUDED.urgency, finance = EXCLUDED.finance, due_on = EXCLUDED.due_on, held = EXCLUDED.held,
  sources = EXCLUDED.sources, draft_message_id = EXCLUDED.draft_message_id, company = EXCLUDED.company, sent_to = EXCLUDED.sent_to
RETURNING id`;

const AUTO_DONE_SQL = `UPDATE steph_brief_items SET state = 'auto_done', state_at = NOW() WHERE id = ANY($1::uuid[]) AND state = 'open'`;
const RUN_ITEMS_SQL = `UPDATE steph_brief_runs SET item_ids = $2::uuid[], counts = $3::jsonb, window_start = $4 WHERE id = $1`;
const COMPLETE_SQL = `UPDATE steph_brief_runs SET status = 'done', space_name = $2, message_name = $3, cost_usd = $4, error_code = $5, completed_at = NOW() WHERE id = $1`;
const FAIL_SQL = `UPDATE steph_brief_runs SET status = 'failed', error_code = $2, cost_usd = $3, completed_at = NOW() WHERE id = $1`;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

let anthropic = null;
async function defaultCreateMessage(params, opts) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic.messages.create(params, opts);
}

export function defaultDeps() {
  const gmail = () => import('../tools/gmail.js');
  const gather = () => import('./briefing-gather.js');
  return {
    query: async (...a) => (await import('../database/connection.js')).query(...a),
    hasGmailScopes: async (id) => (await gmail()).hasGmailScopes(id),
    listThreadsSince: async (...a) => (await gmail()).listThreadsSince(...a),
    getThread: async (...a) => (await gmail()).getThread(...a),
    createDraftReply: async (...a) => (await gmail()).createDraftReply(...a),
    findDm: async (id) => (await import('../cards/chat-api.js')).findDmSpace(id),
    postCard: async (spaceName, cardsV2, fallbackText) => (await import('../cards/chat-api.js'))
      .postMessageWithThread({ spaceName, cardsV2, fallbackText }),
    renderCard: async (runId, q) => {
      const { loadBriefCard, renderBrief } = await import('../cards/brief-card.js');
      const loaded = await loadBriefCard(runId, q);
      return renderBrief(loaded.run, loaded.items);
    },
    crmFacts: async (lead) => (await import('../cards/lead-lookup.js')).crmFacts(lead),
    lookupLead: async (...a) => (await import('../cards/lead-lookup.js')).lookupLead(...a),
    leadSession: async (email) => (await import('../database/lead-gen-reads.js')).latestLeadGenSession(email),
    decodeCalculator: async (c) => (await gather()).decodeCalculator(c),
    website: async (url, { sessionId = 'steph-brief', onUsage } = {}) =>
      (await import('../api/lead-gen-init.js')).extractCompanyBackgroundFromWebsite(url, sessionId, { onUsage }),
    grantSearch: async (args) => (await import('../tools/grant-data.js')).searchGrantData(args),
    // Fetched once per lead, shared by the location and industry lookups.
    sitePages: (url) => { let read; return () => (read ||= gather().then(g => g.sitePages(url, g.defaultGatherDeps)())); },
    locateCompany: async (args) => (await gather()).locateCompany(args),
    industryFor: async (args) => (await gather()).industryFor(args),
    matchLead: async (lead) => (await import('./match-lead-client.js')).matchLead(lead),
    runAgent: async (opts) => (await import('../claude/client.js')).runAgent(opts),
    createConversation: async (...a) => (await import('../database/messages.js')).createConversation(...a),
    loadStyleGuide,
    meetingLinksFor,
    createMessage: defaultCreateMessage,
    logCost: (args) => import('../utils/cost-logger.js').then(m => m.logAPICost(args)).catch(() => undefined)
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function staffUser(email, query) {
  const r = await query(
    `SELECT id, email, name, chat_user_id, gmail_connected_at FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true LIMIT 1`, [email]);
  return r.rows[0] || null;
}

/** "Oct 31, 2026" / "2026-10-31" → "2026-10-31", else null. */
function isoDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return String(raw);
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** The former-staff colleague an item's mail was addressed to (thread labelled "Former staff"). */
function formerStaffRecipient(item, formerStaff, mailboxEmail) {
  for (const t of item.threads || []) {
    if (!formerStaff.has(t.id)) continue;
    for (const m of [...(t.messages || [])].reverse()) {
      if (m.from_user || m.is_draft) continue;
      const parts = String(`${m.to || ''},${m.cc || ''}`).split(',').map(x => x.trim()).filter(Boolean);
      const hit = parts.find(p => /@granted\.ca>?$/i.test(p) && !p.toLowerCase().includes(String(mailboxEmail).toLowerCase()));
      if (hit) {
        const name = hit.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
        return name || hit.replace(/[<>]/g, '');
      }
    }
  }
  return null;
}

/** The latest unanswered thread of an item — the one its draft replies in. */
function latestThread(item) {
  const last = (t) => Math.max(0, ...(t.messages || []).filter(m => !m.from_user && !m.is_draft).map(m => m.internal_date));
  return [...(item.threads || [])].sort((a, b) => last(b) - last(a))[0] || null;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Who, and can we? Cheap checks only — the manual trigger calls this before
 * answering, so a dry run that can't happen says why at once.
 * @returns {Promise<{ ok: boolean, reason?: string, steph?, recipient? }>}
 */
/**
 * May a dry run read this inbox? Same rule as isGmailConsentEligible in
 * src/api/gmail-auth.js (GMAIL_CONSENT_ALLOWLIST, comma-separated,
 * case-insensitive, unset = nobody) — mirrored, not imported, because that
 * module opens a Redis client when loaded.
 */
export function inboxAllowed(email, env = process.env) {
  const want = String(email || '').trim().toLowerCase();
  if (!want) return false;
  return String(env.GMAIL_CONSENT_ALLOWLIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(want);
}

/**
 * Who, and can we? Two roles:
 *   persona — whose brief this is (Steph): her voice guide and meeting links.
 *   mailbox — whose Gmail is read. Steph's own, except in a dry run given
 *             `inboxEmail` (another consented, allowlisted inbox, e.g. Chris
 *             vetting the brief before Steph connects). Real runs never take one.
 * ownerEmail (the row key) is the mailbox's, so another inbox's is_test rows
 * never mix with Steph's.
 * @returns {Promise<{ ok: boolean, reason?: string, steph?, mailbox?, recipient?, ownerEmail? }>}
 */
export async function preflight({ env = process.env, deps, dryRun = false, dmToEmail = null, inboxEmail = null }) {
  const personaEmail = env.STEPH_BRIEF_OWNER_EMAIL || DEFAULT_OWNER_EMAIL;
  const otherInbox = inboxEmail && inboxEmail.trim().toLowerCase() !== personaEmail.toLowerCase() ? inboxEmail.trim().toLowerCase() : null;
  if (otherInbox && !dryRun) return { ok: false, reason: 'inbox_only_in_dry_run' };
  if (otherInbox && !inboxAllowed(otherInbox, env)) return { ok: false, reason: 'inbox_not_allowlisted' };

  const mailbox = await staffUser(otherInbox || personaEmail, deps.query);
  if (!mailbox) return { ok: false, reason: otherInbox ? 'inbox_not_found' : 'owner_not_found' };
  if (!mailbox.gmail_connected_at) return { ok: false, reason: 'gmail_not_connected' };
  const scopes = await deps.hasGmailScopes(mailbox.id);
  if (!scopes?.ok) return { ok: false, reason: 'gmail_not_connected' };
  if (dryRun && !dmToEmail) return { ok: false, reason: 'dry_run_needs_recipient' };
  const recipient = dryRun ? await staffUser(dmToEmail, deps.query) : mailbox;
  if (!recipient?.chat_user_id) return { ok: false, reason: 'recipient_has_no_chat_id' };
  // In another inbox's dry run the persona needs no users row of its own:
  // only its email is used (voice guide, meeting links).
  const steph = otherInbox ? { email: personaEmail } : mailbox;
  return { ok: true, steph, mailbox, recipient, ownerEmail: mailbox.email, otherInbox: !!otherInbox };
}

/**
 * @param {{ now?: Date, env?: object, deps?: object, dryRun?: boolean, dmToEmail?: string|null }} opts
 * @returns {Promise<object>} summary — counts and codes only
 */
export async function runStephBrief({ now = new Date(), env = process.env, deps: given = defaultDeps(), dryRun = false, dmToEmail = null, inboxEmail = null } = {}) {
  const deps = given;
  const date = localDate(now);
  const pre = await preflight({ env, deps, dryRun, dmToEmail, inboxEmail });
  if (!pre.ok) {
    console.log(`⏭️  Steph brief ${date}: skipped — ${pre.reason}`);
    return { date, status: 'skipped', reason: pre.reason, dryRun };
  }
  const { steph, mailbox, recipient, ownerEmail } = pre;
  const q = deps.query;

  // Claim (real) or a fresh test row (dry run).
  let runId;
  try {
    const r = dryRun
      ? await q(TEST_RUN_SQL, [ownerEmail, date, recipient.email, recipient.chat_user_id])
      : await q(CLAIM_SQL, [ownerEmail, date, recipient.email, recipient.chat_user_id]);
    runId = r.rows[0]?.id;
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('⚠️  Steph brief: steph_brief_runs missing — apply migrations/051_steph_brief.sql');
      return { date, status: 'no_state_table', dryRun };
    }
    throw err;
  }
  if (!runId) return { date, status: 'already_claimed', dryRun };

  // Every cost row of this run carries these (api_cost_events.metadata).
  const costTags = { brief_run_id: runId, is_dry_run: dryRun };
  const runDeps = { ...deps, costTags };
  const cost = { classify: 0, promises: 0, learn: 0, drafting: 0, oracle: 0, website: 0, search_fees: 0, compare: 0 };
  const totalCost = () => Object.values(cost).reduce((a, b) => a + b, 0);
  try {
    // Window: the last READ_DAYS. New mail from the last 48 h is inside it by
    // definition; older unanswered mail is left to the Stage 3 catch-up.
    const since = windowStart(now);
    const previous = (await q(PREVIOUS_ITEMS_SQL, [ownerEmail])).rows;
    // Learned corrections are the persona's (Steph's), whoever's inbox is read.
    runDeps.corrections = await loadCorrections(steph.email, q);

    // Threads: the window, her sent mail (promises), everything still open
    // from earlier briefs, and threads whose draft awaits comparison.
    const listed = await deps.listThreadsSince(mailbox.id, since, { max: MAX_THREADS });
    const formerStaff = new Set(listed.threads.filter(t => (t.labels || []).includes('Former staff')).map(t => t.id));
    const sent = await deps.listThreadsSince(mailbox.id, since, { labels: ['SENT'], max: MAX_THREADS }).catch(() => ({ threads: [] }));
    const ids = [...new Set([
      ...listed.threads.map(t => t.id),
      ...(sent.threads || []).map(t => t.id),
      ...previous.filter(p => p.state === 'open' || p.draft_text).flatMap(p => p.thread_ids || [])
    ])];
    const fetched = new Map();
    await pool(ids, FETCH_CONCURRENCY, async (id) => {
      try { fetched.set(id, await deps.getThread(mailbox.id, id, { userEmail: mailbox.email })); } catch { /* unknown this run */ }
    });

    // Triage.
    const { mail, notifications, covered, agedOut, counts: triageCounts } = sortThreads([...fetched.values()], { since });
    const mailItems = groupBySender(mail, now.getTime());
    const docs = driveNotificationItems(notifications);
    const classified = await classifyItems(mailItems, runDeps);
    cost.classify += classified.costUsd;
    for (const item of classified.items) if (item.safety_note) item.note = item.safety_note;

    // Promises she made that are due: one Haiku extraction over her sent mail.
    // A promise on a thread that's already an item becomes a note on it.
    const extracted = await extractPromises(promiseCandidates([...fetched.values()], { since }), runDeps);
    cost.promises += extracted.costUsd;
    const promiseItems = [];
    for (const p of duePromiseItems(extracted.promises, fetched, { today: date })) {
      const host = classified.items.find(i => (i.thread_ids || []).includes(p.thread_ids[0]));
      if (host) host.note = [host.note, `You promised ${p.promise.what}, due ${p.promise.due_date}.`].filter(Boolean).join(' ');
      else promiseItems.push(p);
    }
    const fresh = [...classified.items, ...promiseItems, ...docs.items.map(d => ({ ...d, assessment: docsAssessment(d) }))];

    // Carry over. An item whose threads couldn't all be fetched is left alone:
    // no auto-tick on missing evidence. One whose mail aged out of the window
    // is neither shown nor auto-ticked (Stage 3 catch-up).
    const aged = new Set(agedOut);
    const agedItem = (p) => (p.thread_ids || []).length > 0 && p.thread_ids.every(id => aged.has(id));
    const known = (p) => (p.thread_ids || []).every(id => fetched.has(id)) && !agedItem(p);
    const { show, autoDone } = carryOver(previous.filter(known), fresh, now.getTime());

    // Learning from edits (real runs only): where she replied after we saved a
    // draft, compare her reply with our draft; one Haiku call for the pairs
    // that changed meaningfully. Done before drafting, so today's drafts
    // already follow what was learned.
    let learned = 0;
    if (!dryRun) {
      const { toCompare, settled } = comparable(previous.filter(p => p.draft_text), fetched);
      const { corrections, costUsd } = await summariseCorrections(toCompare, runDeps);
      cost.learn += costUsd;
      for (const c of corrections) {
        try {
          await q(INSERT_CORRECTION_SQL, [steph.email, false, c.rule, c.example, c.thread_id, c.item.id]);
          learned += 1;
        } catch (err) {
          if (err?.code !== '42P01') console.warn(`⚠️  Steph brief correction not stored — code: ${err?.code || err?.name || 'unknown'}`);
        }
      }
      runDeps.corrections = [...corrections.map(c => c.rule), ...(runDeps.corrections || [])].slice(0, 15);
      const compared = [...toCompare.map(x => x.item.id), ...settled.map(x => x.item.id)];
      if (compared.length) await q(CLEAR_DRAFT_TEXT_SQL, [compared]).catch(() => {});
      await q(SWEEP_DRAFT_TEXT_SQL).catch(() => {});
    }
    const untouched = previous.filter(p => p.state === 'open' && !known(p) && !agedItem(p)).map(p => ({ ...p, previous: p, carried_only: true }));
    const ordered = orderItems([...show, ...untouched].filter(i => GROUP_ORDER.includes(i.category)));

    // Context + drafts for the first N mail items that need it.
    const cap = maxDrafts(env);
    let budget = cap;
    let noDraftCap = 0;
    const work = [];
    for (const item of ordered) {
      if (item.category === 'docs' || item.carried_only) continue;
      // Safety, sensitive, bills, unsure, unconfirmable promises: on the card
      // with their badge, never drafted.
      if (item.draft === 'none') continue;
      // Triage said no reply is needed: on the card with its assessment, no
      // context lookup, no draft, no cost.
      if (item.item_type === 'mail' && item.needs_reply === false) { item.no_reply = true; continue; }
      const prev = item.previous;
      const changed = !prev || item.last_inbound_at > new Date(prev.last_inbound_at || 0).getTime();
      if (!changed && (prev.draft_ids?.length || dryRun)) {
        // Nothing new since the last brief: keep its assessment, draft and cost record.
        Object.assign(item, { assessment: prev.assessment, owner_hint: prev.owner_hint, note: prev.note,
          facts_line: prev.facts_line, draft_ids: prev.draft_ids || [], reused: prev });
        continue;
      }
      if (budget > 0) { budget -= 1; work.push(item); } else { noDraftCap += 1; }
    }
    // Dry runs only: the first COMPARE_ITEMS lead/client items get the other model's draft too.
    let compareLeft = dryRun ? COMPARE_ITEMS : 0;
    for (const item of work) {
      if (compareLeft > 0 && (item.category === 'lead' || item.category === 'client')) { item.compare = true; compareLeft -= 1; }
    }
    let dmSpace = null;
    try { dmSpace = await deps.findDm(mailbox.chat_user_id); } catch { dmSpace = null; }
    let draftsCreated = 0;
    let held = 0;
    await pool(work, ORACLE_CONCURRENCY, async (item) => {
      let ctx;
      try {
        // Timeouts are handled inside: the Oracle run is aborted and awaited,
        // so its spend still lands in ctx.ledger.
        ctx = await contextForItem(item, { steph, runAs: mailbox, dmSpace }, runDeps, { timeoutMs: ORACLE_TIMEOUT_MS, compare: !!item.compare });
      } catch (err) {
        ctx = { ok: false, assessment: item.assessment, note: 'Context lookup failed — no draft today.', draft_body: null, held: false, ledger: null };
        console.warn(`⚠️  Steph brief item failed — code: ${err?.code || err?.name || 'unknown'}`);
      }
      const l = ctx.ledger;
      if (l) {
        cost[item.category === 'client' && item.draft === 'normal' ? 'oracle' : 'drafting'] += l.model_cost;
        cost.website += l.website;
        cost.search_fees += l.search_fees;
        item.costRecord = l;
      }
      if (ctx.compare) { cost.compare += ctx.compare.cost_usd || 0; item.compareRecord = ctx.compare; }
      item.conversation_id = ctx.conversation_id || null;
      item.sources = sourcesOf(l);
      item.held = !!ctx.held;
      if (ctx.held) held += 1;
      item.assessment = ctx.assessment;
      item.owner_hint = ctx.owner_hint || null;
      item.note = ctx.note || null;
      item.facts_line = ctx.facts_line || null;
      item.draft_ids = [];
      if (!ctx.draft_body) return;
      if (dryRun) { item.draft_preview = ctx.draft_body; return; }
      const thread = latestThread(item);
      if (!thread) return;
      if (hasDraft(thread)) {
        // Hers or an earlier one of ours: never a duplicate.
        item.draft_ids = item.previous?.draft_ids?.length ? item.previous.draft_ids : ['existing'];
        item.note = [item.note, 'A draft already exists on this thread — left as is.'].filter(Boolean).join(' ');
        return;
      }
      try {
        const d = await deps.createDraftReply(mailbox.id, thread.id, ctx.draft_body, { userEmail: mailbox.email });
        item.draft_ids = [d.draftId];
        item.draft_message_id = d.messageId || null;
        // Kept until her reply can be compared with it (learning from edits).
        item.draft_text = ctx.draft_body;
        item.draft_text_at = new Date();
        draftsCreated += 1;
      } catch (err) {
        item.note = [item.note, 'Draft could not be saved.'].filter(Boolean).join(' ');
        console.warn(`⚠️  Steph brief draft failed — code: ${err?.code || err?.name || 'unknown'}`);
      }
    });

    // Persist items (is_test rows for a dry run), in card order.
    const itemIds = [];
    const carry = {};
    for (const [position, item] of ordered.entries()) {
      const l = item.costRecord || null;
      const r = item.reused || null;   // reused from the last brief: keep what it cost then
      const row = await q(UPSERT_ITEM_SQL, [
        ownerEmail, dryRun, item.item_key, item.category, item.thread_ids || [],
        item.sender || null, item.subject || null,
        item.assessment ?? null, item.owner_hint ?? null, item.note ?? null, item.facts_line ?? null,
        item.draft_ids ?? [], dryRun ? (item.draft_preview ?? null) : null,
        item.nudge || 0, item.previous?.first_seen_at || now,
        Number.isFinite(item.first_inbound_at) ? new Date(item.first_inbound_at) : (item.first_inbound_at || null),
        Number.isFinite(item.last_inbound_at) ? new Date(item.last_inbound_at) : (item.last_inbound_at || null),
        runId, position,
        !!item.no_reply,
        l?.model ?? r?.model ?? null,
        l ? Number(ledgerTotal(l).toFixed(4)) : (r?.cost_usd ?? null),
        l?.input_tokens ?? r?.input_tokens ?? null, l?.output_tokens ?? r?.output_tokens ?? null,
        l?.cache_read_tokens ?? r?.cache_read_tokens ?? null, l?.cache_write_tokens ?? r?.cache_write_tokens ?? null,
        l?.tool_calls ?? r?.tool_calls ?? null, l?.tools_used ?? r?.tools_used ?? [], l?.web_searches ?? r?.web_searches ?? null,
        item.conversation_id ?? r?.conversation_id ?? null,
        dryRun && item.compareRecord ? JSON.stringify(item.compareRecord) : null,
        item.item_type || 'mail', item.badge ?? null,
        dryRun ? null : (item.draft_text ?? null), dryRun ? null : (item.draft_text_at ?? null),
        Number.isInteger(item.urgency) ? item.urgency : (r?.urgency ?? null),
        !!(item.finance ?? r?.finance),
        isoDate(item.promise?.due_date || item.bill?.due) ?? (r?.due_on ?? null),
        !!(item.held ?? r?.held),
        item.sources ?? r?.sources ?? [],
        item.draft_message_id ?? r?.draft_message_id ?? null,
        item.company ?? r?.company ?? null,
        formerStaffRecipient(item, formerStaff, mailbox.email) ?? (item.previous?.sent_to ?? null)
      ]);
      const id = row.rows[0].id;
      itemIds.push(id);
      if (item.carry) carry[id] = item.carry;
    }
    if (!dryRun && autoDone.length) await q(AUTO_DONE_SQL, [autoDone.map(p => p.id)]);

    const counts = {
      threads: fetched.size, items: ordered.length, automated: triageCounts.automated,
      vendor: classified.skipped.vendor, handled: classified.skipped.handled, notifications_dropped: docs.dropped,
      covered: coveredSummary(covered), aged_out: agedOut.length,
      // Former-staff mail that never became an item (automated, pitches, FYIs, covered…): counted only.
      former_staff_kept_out: [...formerStaff].filter(id => !ordered.some(i => !i.no_reply && (i.thread_ids || []).includes(id))).length,
      promises: ordered.filter(i => i.item_type === 'promise').length, corrections_learned: learned,
      auto_done: autoDone.length, no_draft_cap: noDraftCap, drafts_created: draftsCreated, held, carry,
      no_reply: ordered.filter(i => i.no_reply).length,
      cost: Object.fromEntries([...Object.entries(cost), ['total', totalCost()]].map(([k, v]) => [k, Number(v.toFixed(4))]))
    };
    await q(RUN_ITEMS_SQL, [runId, itemIds, JSON.stringify(counts), since]);

    // Post.
    const cardsV2 = await deps.renderCard(runId, q);
    let space = null;
    try { space = await deps.findDm(recipient.chat_user_id); } catch { space = null; }
    let messageName = null;
    let note = null;
    if (!space) note = 'no_dm_space';
    else {
      try {
        const posted = await deps.postCard(space, cardsV2, `Morning brief: ${ordered.length} to answer`);
        messageName = posted?.messageName || null;
        if (!messageName) note = 'dm_failed';
      } catch { note = 'dm_failed'; }
    }
    const costUsd = totalCost();
    await q(COMPLETE_SQL, [runId, space, messageName, costUsd, note]);
    const summary = { date, status: 'done', dryRun, runId, ...counts, carry: undefined, costUsd, delivery: note || 'sent' };
    console.log(`📬 Steph brief ${date}${dryRun ? ' (dry run)' : ''}: ${ordered.length} item(s), ${draftsCreated} draft(s), ${autoDone.length} auto-done, $${costUsd.toFixed(2)}, ${summary.delivery}`);
    return summary;
  } catch (err) {
    const code = err?.code || err?.name || 'unknown';
    await q(FAIL_SQL, [runId, String(code).slice(0, 60), totalCost()]).catch(() => {});
    console.error(`❌ Steph brief ${date} failed — code: ${code}`);
    return { date, status: 'failed', code, dryRun, runId, costUsd: totalCost() };
  }
}

export function startStephBrief(cron, env = process.env) {
  if (env.STEPH_BRIEF_ENABLED !== 'true') {
    console.log('⏸️  Steph morning brief off (STEPH_BRIEF_ENABLED is not "true")');
    return false;
  }
  const run = async () => {
    try {
      await runStephBrief({ env });
    } catch (err) {
      console.error(`❌ Steph brief run failed — code: ${err?.code || err?.name || 'unknown'}`);
    }
  };
  cron.schedule(SCHEDULE, run, { name: 'steph-brief', timezone: TZ, noOverlap: true });
  console.log('✅ Steph morning brief scheduled (08:00 America/Vancouver, Mon–Fri)');
  return true;
}
