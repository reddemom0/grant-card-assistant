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

import { GROUP_ORDER, carryOver, docsAssessment, driveNotificationItems, groupBySender, hasDraft, orderItems, sortThreads } from './steph-brief-triage.js';
import { classifyItems } from './steph-brief-classify.js';
import { contextForItem, ledgerTotal } from './steph-brief-context.js';
import { loadStyleGuide } from './style-guides.js';
import { meetingLinksFor } from './meeting-links.js';

export const SCHEDULE = '0 8 * * 1-5';
const TZ = 'America/Vancouver';
export const DEFAULT_OWNER_EMAIL = 'ssang@granted.ca';
export const DEFAULT_MAX_DRAFTS = 15;
const MAX_LOOKBACK_DAYS = 4;
const MAX_THREADS = 150;
const FETCH_CONCURRENCY = 5;
const ORACLE_CONCURRENCY = 3;
const ORACLE_TIMEOUT_MS = 180_000;
export const COMPARE_ITEMS = 3;
const DAY_MS = 24 * 3600 * 1000;

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function vancouverWeekday(now) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now);
}

export function maxDrafts(env = process.env) {
  const n = Number(env.STEPH_BRIEF_MAX_DRAFTS);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_DRAFTS;
}

/** Since the last completed real run (capped at 4 days), else 24 h, or 72 h on a Monday. */
export function windowStart(lastRunAt, now = new Date()) {
  const floor = now.getTime() - MAX_LOOKBACK_DAYS * DAY_MS;
  if (lastRunAt) return new Date(Math.max(new Date(lastRunAt).getTime(), floor));
  const back = vancouverWeekday(now) === 'Mon' ? 3 : 1;
  return new Date(now.getTime() - back * DAY_MS);
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

const LAST_RUN_SQL = `
SELECT claimed_at FROM steph_brief_runs
 WHERE owner_email = $1 AND NOT is_test AND status = 'done'
 ORDER BY claimed_at DESC LIMIT 1`;

const PREVIOUS_ITEMS_SQL = `
SELECT * FROM steph_brief_items
 WHERE owner_email = $1 AND is_test = false
   AND (state = 'open' OR state_at > NOW() - INTERVAL '30 days')`;

const UPSERT_ITEM_SQL = `
INSERT INTO steph_brief_items
  (owner_email, is_test, item_key, category, thread_ids, sender, subject, assessment, owner_hint, note, facts_line,
   draft_ids, draft_preview, nudge, first_seen_at, first_inbound_at, last_inbound_at, state, state_at, last_run_id, position,
   no_reply, model, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
   tool_calls, tools_used, web_searches, conversation_id, compare)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, NOW()), $16, $17, 'open', NOW(), $18, $19,
   $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31::jsonb)
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
  conversation_id = EXCLUDED.conversation_id, compare = EXCLUDED.compare
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
export async function preflight({ env = process.env, deps, dryRun = false, dmToEmail = null }) {
  const ownerEmail = env.STEPH_BRIEF_OWNER_EMAIL || DEFAULT_OWNER_EMAIL;
  const steph = await staffUser(ownerEmail, deps.query);
  if (!steph) return { ok: false, reason: 'owner_not_found' };
  if (!steph.gmail_connected_at) return { ok: false, reason: 'gmail_not_connected' };
  const scopes = await deps.hasGmailScopes(steph.id);
  if (!scopes?.ok) return { ok: false, reason: 'gmail_not_connected' };
  if (dryRun && !dmToEmail) return { ok: false, reason: 'dry_run_needs_recipient' };
  const recipient = dryRun ? await staffUser(dmToEmail, deps.query) : steph;
  if (!recipient?.chat_user_id) return { ok: false, reason: 'recipient_has_no_chat_id' };
  return { ok: true, steph, recipient, ownerEmail };
}

/**
 * @param {{ now?: Date, env?: object, deps?: object, dryRun?: boolean, dmToEmail?: string|null }} opts
 * @returns {Promise<object>} summary — counts and codes only
 */
export async function runStephBrief({ now = new Date(), env = process.env, deps: given = defaultDeps(), dryRun = false, dmToEmail = null } = {}) {
  const deps = given;
  const date = localDate(now);
  const pre = await preflight({ env, deps, dryRun, dmToEmail });
  if (!pre.ok) {
    console.log(`⏭️  Steph brief ${date}: skipped — ${pre.reason}`);
    return { date, status: 'skipped', reason: pre.reason, dryRun };
  }
  const { steph, recipient, ownerEmail } = pre;
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
  const cost = { classify: 0, drafting: 0, oracle: 0, website: 0, search_fees: 0, compare: 0 };
  const totalCost = () => Object.values(cost).reduce((a, b) => a + b, 0);
  try {
    const last = (await q(LAST_RUN_SQL, [ownerEmail])).rows[0]?.claimed_at || null;
    const since = windowStart(last, now);
    const previous = (await q(PREVIOUS_ITEMS_SQL, [ownerEmail])).rows;

    // Threads: the window, plus everything still open from earlier briefs.
    const listed = await deps.listThreadsSince(steph.id, since, { max: MAX_THREADS });
    const ids = [...new Set([...listed.threads.map(t => t.id), ...previous.filter(p => p.state === 'open').flatMap(p => p.thread_ids || [])])];
    const fetched = new Map();
    await pool(ids, FETCH_CONCURRENCY, async (id) => {
      try { fetched.set(id, await deps.getThread(steph.id, id, { userEmail: steph.email })); } catch { /* unknown this run */ }
    });

    // Triage.
    const { mail, notifications, counts: triageCounts } = sortThreads([...fetched.values()]);
    const mailItems = groupBySender(mail, now.getTime());
    const docs = driveNotificationItems(notifications);
    const classified = await classifyItems(mailItems, runDeps);
    cost.classify += classified.costUsd;
    const fresh = [...classified.items, ...docs.items.map(d => ({ ...d, assessment: docsAssessment(d) }))];

    // Carry over. An item whose threads couldn't all be fetched is left alone:
    // no auto-tick on missing evidence.
    const known = (p) => (p.thread_ids || []).every(id => fetched.has(id));
    const { show, autoDone } = carryOver(previous.filter(known), fresh, now.getTime());
    const untouched = previous.filter(p => p.state === 'open' && !known(p)).map(p => ({ ...p, previous: p, carried_only: true }));
    const ordered = orderItems([...show, ...untouched].filter(i => GROUP_ORDER.includes(i.category)));

    // Context + drafts for the first N mail items that need it.
    const cap = maxDrafts(env);
    let budget = cap;
    let noDraftCap = 0;
    const work = [];
    for (const item of ordered) {
      if (item.category === 'docs' || item.carried_only) continue;
      // Triage said no reply is needed: on the card with its assessment, no
      // context lookup, no draft, no cost.
      if (item.needs_reply === false) { item.no_reply = true; continue; }
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
    try { dmSpace = await deps.findDm(steph.chat_user_id); } catch { dmSpace = null; }
    let draftsCreated = 0;
    let held = 0;
    await pool(work, ORACLE_CONCURRENCY, async (item) => {
      let ctx;
      try {
        // Timeouts are handled inside: the Oracle run is aborted and awaited,
        // so its spend still lands in ctx.ledger.
        ctx = await contextForItem(item, { steph, dmSpace }, runDeps, { timeoutMs: ORACLE_TIMEOUT_MS, compare: !!item.compare });
      } catch (err) {
        ctx = { ok: false, assessment: item.assessment, note: 'Context lookup failed — no draft today.', draft_body: null, held: false, ledger: null };
        console.warn(`⚠️  Steph brief item failed — code: ${err?.code || err?.name || 'unknown'}`);
      }
      const l = ctx.ledger;
      if (l) {
        cost[item.category === 'client' ? 'oracle' : 'drafting'] += l.model_cost;
        cost.website += l.website;
        cost.search_fees += l.search_fees;
        item.costRecord = l;
      }
      if (ctx.compare) { cost.compare += ctx.compare.cost_usd || 0; item.compareRecord = ctx.compare; }
      item.conversation_id = ctx.conversation_id || null;
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
        const d = await deps.createDraftReply(steph.id, thread.id, ctx.draft_body, { userEmail: steph.email });
        item.draft_ids = [d.draftId];
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
        dryRun && item.compareRecord ? JSON.stringify(item.compareRecord) : null
      ]);
      const id = row.rows[0].id;
      itemIds.push(id);
      if (item.carry) carry[id] = item.carry;
    }
    if (!dryRun && autoDone.length) await q(AUTO_DONE_SQL, [autoDone.map(p => p.id)]);

    const counts = {
      threads: fetched.size, items: ordered.length, automated: triageCounts.automated,
      vendor: classified.skipped.vendor, other: classified.skipped.other, notifications_dropped: docs.dropped,
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
