#!/usr/bin/env node
/**
 * Dry run of the GetGranted Pulse morning roundup — Oracle's chat-issue
 * detector. Files nothing, sends nothing.
 *
 *   node scripts/pulse-roundup-check.mjs [--hours 168]
 *       the live window: failed chat turns and conversations active in it,
 *       everyone's (internal accounts too), each conversation read by Haiku.
 *       Prints each chat card it would file (ref, issue, flagged message) and
 *       the DM it would send, internal-account cards marked Internal.
 *
 *   node scripts/pulse-roundup-check.mjs --conversation 123 [--diagnose]
 *       one conversation, whoever it belongs to: the detector's review, the
 *       full card it would file (snapshot included — this prints client text,
 *       so only run it in your own terminal), and with --diagnose the Sonnet
 *       diagnosis the hourly sweep would give it (cost printed, not logged).
 *
 *   node scripts/pulse-roundup-check.mjs --since 2026-10-01 [--show-conversation 290] [--write]
 *       ONE-TIME BACKFILL. The daily detector over every conversation active
 *       since that date (Vancouver midnight) and every failed chat turn since
 *       then — internal accounts included, as the daily run does, and counted
 *       apart (client vs internal); no 50-conversation cap. A card from an
 *       internal account is filed like any other and carries the Internal tag
 *       through its company (hidden by default in the Control Centre). Needs
 *       the internal-accounts list (Control Centre, app DB) or it stops.
 *       Same review call (byte-identical) and the same separate flagged-message
 *       call (buildRoundup), and cards filed exactly as the daily run files them
 *       (fileCards), so the dedupe keys are the same and re-running adds nothing
 *       already on file. Dry run by default: prints counts, every card it would
 *       file, which detections are already on file (read-only Hub check), the
 *       full card for --show-conversation, and the cost. --write files the
 *       cards — into the Hub DATABASE_URL points at (the local .env is
 *       production) — and logs the Haiku cost as the daily run does. No DM,
 *       no pulse_alert_state claim; the hourly sweep diagnoses the new cards.
 *
 * Loads .env. Reads the ops DB (oracle_readonly) and, for company ids, the app
 * DB (read_user). Apart from --since … --write it never writes the Hub DB — not
 * even an api_cost_events row: model costs are priced here and printed, never
 * logged — never touches pulse_alert_state, never posts to Chat. Calls Haiku once
 * per conversation (twice when it flags one), Sonnet once with --diagnose.
 * Implementation: src/services/pulse-roundup.js.
 */

import 'dotenv/config';
import {
  buildRoundup, formatRoundup, dmCards, cardCandidates, snapshotFor, reviewConversation, fileCards,
  collectErrors, collectConversations, fetchCompanyName, WINDOW_HOURS, DETECTOR_ACTOR, ROUNDUP_MODEL
} from '../src/services/pulse-roundup.js';
import { gg3OpsQuery, isGg3OpsConfigured, _resetGg3OpsForTests as closeOps } from '../src/services/gg3-ops-db.js';
import { _resetForTests as closeApp } from '../src/control-centre/db.js';
import { calculateRequestCost } from '../src/config/cost-settings.js';

let dryCost = 0;

function parseArgs(argv) {
  const out = { hours: WINDOW_HOURS, conversation: null, diagnose: false, since: null, write: false, show: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hours') out.hours = Number(argv[++i]);
    else if (a === '--conversation') out.conversation = Number(argv[++i]);
    else if (a === '--diagnose') out.diagnose = true;
    else if (a === '--since') out.since = argv[++i];
    else if (a === '--write') out.write = true;
    else if (a === '--show-conversation') out.show = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.hours) || out.hours < 1) throw new Error('--hours must be a positive whole number');
  if (out.conversation !== null && !(Number.isInteger(out.conversation) && out.conversation > 0)) throw new Error('--conversation needs a conversation id');
  if (out.since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(out.since)) throw new Error('--since must be a date, YYYY-MM-DD');
  if (out.write && !out.since) throw new Error('--write is only for the --since backfill');
  if (out.since && out.conversation) throw new Error('--since and --conversation are separate modes');
  return out;
}

/** The instant Vancouver's day `ymd` starts (midnight is never inside a DST change). */
function vancouverMidnight(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 8);
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hourCycle: 'h23' }).format(new Date(guess)));
  return new Date(guess - hour * 3600000);
}

async function companyFor(userIds) {
  const { identitiesForClerkIds } = await import('../src/control-centre/identity.js');
  try {
    const ids = await identitiesForClerkIds(userIds);
    return new Map([...ids].map(([k, v]) => [k, v.company_id]).filter(([, v]) => v != null));
  } catch {
    return new Map();
  }
}

async function oneConversation(id, { createMessage, diagnose }) {
  const r = await gg3OpsQuery('SELECT id, user_id, messages, updated_at FROM conversations WHERE id = $1', [id]);
  const row = r.rows?.[0];
  if (!row) { console.log(`No conversation ${id} in the ops DB.`); return; }
  const conv = { id: row.id, userId: row.user_id, messages: row.messages, updatedAt: row.updated_at };
  const review = await reviewConversation(conv, createMessage);
  console.log(`Conversation ${id} — last active ${new Date(row.updated_at).toISOString()}`);
  if (!review.ok) { console.log(`Review failed (code ${review.code}).`); return; }
  console.log(`Detector: flags ${JSON.stringify(review.flags)}, owner "${review.owner}", flagged client message ${review.turnIndex == null ? '—' : review.turnIndex + 1}`);
  console.log(`  take: ${review.take || '—'}`);
  const [candidate] = cardCandidates([], [{ ...review, userId: conv.userId, conversationId: conv.id, messages: conv.messages, updatedAt: conv.updatedAt }]);
  if (!candidate) { console.log('\nWould file NO card — the detector found nothing wrong.'); return; }

  const companies = await companyFor([conv.userId]);
  const { companyNamesForIds } = await import('../src/control-centre/identity.js');
  const companyId = companies.get(conv.userId) ?? null;
  const companyName = companyId ? (await companyNamesForIds([companyId]).catch(() => new Map())).get(companyId) ?? null : null;
  const snapshot = snapshotFor(candidate, conv.messages);
  const card = {
    kind: 'chat', chat_turn_ref: candidate.ref, conversation_id: conv.id, company_id: companyId,
    flag: { source: 'oracle_detected', source_ref: candidate.sourceRef, actor: DETECTOR_ACTOR, comment: `${candidate.name}: ${candidate.fullTake ?? candidate.take}` },
    snapshot
  };
  console.log(`\nWould file chat card ${candidate.ref} for ${companyName ?? 'no company'}${companyId ? ` (${companyId})` : ''}:`);
  console.log(JSON.stringify(card, null, 2));

  if (diagnose) {
    const { diagnoseItem } = await import('../src/control-centre/diagnosis.js');
    const d = await diagnoseItem({ id: null, kind: 'chat', chat_turn_ref: candidate.ref, company_id: companyId,
      snapshot, snapshot_at: new Date().toISOString(), status: 'new', diagnosis_attempts: 0 },
    { comments: [card.flag.comment], logCost: null });
    console.log('\nDiagnosis the hourly sweep would record (nothing written):');
    if (!d) console.log('  skipped — not configured');
    else if (!d.ok) console.log(`  FAILED: ${d.error}`);
    else {
      console.log(`  owner: ${d.owner}   verdict: ${d.verdict}`);
      console.log(`  narrative: ${d.narrative}`);
      for (const [k, v] of Object.entries(d.diagnosis.chat ?? {})) console.log(`  ${k}: ${v}`);
      if (d.diagnosis.owner_override) console.log(`  override: ${d.diagnosis.owner_override.changes.join('; ')}`);
    }
    console.log(`  Sonnet cost (not logged): $${(d?.cost ?? 0).toFixed(4)}`);
  }
}

async function window(hours, createMessage) {
  const { internalClerkIds } = await import('../src/control-centre/identity.js');
  const built = await buildRoundup({
    hours,
    deps: {
      collectErrors: (h) => collectErrors(h),
      collectConversations: (h) => collectConversations(h),
      createMessage,
      fetchProfile: (id) => fetchCompanyName(id),
      internalIds: () => internalClerkIds()
    }
  });
  const lookup = built.clientLookup;
  console.log(`Window: last ${hours} hours (everyone, internal accounts included)`);
  console.log(`  failed chat turns:              ${built.errors}`);
  console.log(`  conversations reviewed:         ${built.conversations}${built.conversations === 50 ? ' (capped at 50)' : ''}`);
  console.log(`  went badly:                     ${built.flagged}`);
  console.log(`  reviews that failed:            ${built.failedReviews}`);
  console.log(`  client lookup:                  ${lookup.named} named, ${lookup.ref} as "a client ·…" — HTTP/status: ${JSON.stringify(lookup.statuses)}`);

  if (!built.candidates.length) {
    console.log('\nWould NOT file or send — nothing went wrong for a client in the window.');
    return;
  }
  console.log(`\nWould file ${built.candidates.length} detection(s):`);
  for (const c of built.candidates) {
    console.log(`  ${c.ref}  ← ${c.sourceRef}  (${c.name}; flagged message ${c.turnIndex == null ? '—' : c.turnIndex + 1})`);
  }
  // As if every detection were new and unfiled: no Hub read in a dry run.
  const cards = dmCards(built.candidates.map(c => ({ candidate: c, ok: false })), built.labels, built.internalIds);
  console.log('\nWould send (card links appear once filed):\n');
  console.log(formatRoundup(cards, { hours }).split('\n').map(l => `  ${l}`).join('\n'));
  if (hours !== WINDOW_HOURS) console.log(`\n(The live roundup looks back ${WINDOW_HOURS} hours; this run used ${hours}.)`);
}

/**
 * The one-time backfill: the daily detector over everything since a date. The
 * window is whole hours back from now (rounded up), the same filters the daily
 * collectors apply; the conversation cap is lifted.
 */
async function backfill(args, createMessage) {
  // Internal accounts are reviewed like everyone else, but the backfill reports
  // them apart and their cards must carry the Internal tag: without the
  // internal-accounts list (Control Centre, app DB) it stops, dry run or not.
  const { internalClerkIds } = await import('../src/control-centre/identity.js');
  const { isInternalCompany } = await import('../src/control-centre/internal-accounts.js');
  let internal;
  try {
    internal = await internalClerkIds();
  } catch (err) {
    throw Object.assign(new Error(`internal-accounts list unavailable (app DB code ${err?.code ?? err?.name ?? 'unknown'}): client and internal chats can't be told apart. Check APP_DB_READONLY_URL and re-run.`), { code: 'no_internal_accounts' });
  }
  const since = vancouverMidnight(args.since);
  const hours = Math.ceil((Date.now() - since.getTime()) / 3600000);
  const t0 = Date.now();
  let reviewed = [];
  let failedTurns = [];
  const built = await buildRoundup({
    hours,
    deps: {
      collectErrors: async (h) => (failedTurns = await collectErrors(h)),
      collectConversations: async (h) => (reviewed = await collectConversations(h, gg3OpsQuery, 100000)),
      createMessage,
      fetchProfile: (id) => fetchCompanyName(id),
      internalIds: async () => internal
    }
  });
  if (!built) throw Object.assign(new Error('ops DB not configured'), { code: 'ops_not_configured' });
  const cands = built.candidates;
  const byIssue = cands.reduce((o, c) => ({ ...o, [c.issue]: (o[c.issue] ?? 0) + 1 }), {});
  const cardsByRef = new Map();
  for (const c of cands) cardsByRef.set(c.ref, [...(cardsByRef.get(c.ref) ?? []), c]);

  // Read-only: which detections are already on file (same source_ref = nothing filed).
  const { query, closePool } = await import('../src/database/connection.js');
  const { KNOWN_REFS_SQL } = await import('../src/control-centre/review-queue.js');
  let known = new Set();
  let knownError = null;
  try {
    known = new Set((await query(KNOWN_REFS_SQL, [cands.map((c) => c.sourceRef)])).rows.map((r) => r.source_ref));
  } catch (err) {
    knownError = err?.code ?? err?.name ?? 'unknown';
  }
  const fresh = cands.filter((c) => !known.has(c.sourceRef));

  const companies = await companyFor([...new Set(cands.map((c) => c.userId))]);
  const { companyNamesForIds } = await import('../src/control-centre/identity.js');
  const names = await companyNamesForIds([...companies.values()]).catch(() => new Map());
  const who = (userId) => { const id = companies.get(userId); return id ? `${names.get(id) ?? `company #${id}`} (${id})` : `a client ·${String(userId).slice(-4)}`; };
  // The tag the Control Centre shows: the card's company is an internal
  // account. With no company on file, the internal Clerk-id list decides.
  const isInternal = (userId) => { const id = companies.get(userId); return id ? isInternalCompany(id) : internal.has(userId); };
  const split = (list, userOf) => {
    const n = list.filter((x) => internal.has(userOf(x))).length;
    return `${list.length} — ${list.length - n} client, ${n} internal`;
  };
  const internalCards = [...cardsByRef.values()].filter((list) => isInternal(list[0].userId)).length;

  console.log(`Backfill since ${args.since} (Vancouver) = ${since.toISOString()}, ${hours} hours back — everyone, internal accounts included `
    + `(${internal.size} internal Clerk ids from the Control Centre's internal-accounts list), no conversation cap`);
  console.log(`  conversations reviewed:         ${split(reviewed, (c) => c.userId)}`);
  console.log(`  reviews that failed:            ${built.failedReviews}`);
  console.log(`  went badly:                     ${built.flagged}`);
  console.log(`  failed chat turns:              ${split(failedTurns, (e) => e.userId)}`);
  console.log(`  issues found (detections):      ${split(cands, (c) => c.userId)}  ${JSON.stringify(byIssue)}`);
  console.log(`  chat cards they make:           ${cardsByRef.size} — ${cardsByRef.size - internalCards} client, ${internalCards} tagged Internal (one per issue per conversation)`);
  console.log(`  already on file:                ${knownError ? `couldn't check (code ${knownError})` : `${cands.length - fresh.length} — ${fresh.length} would be filed`}`);
  console.log(`  run time:                       ${Math.round((Date.now() - t0) / 1000)}s`);

  console.log('\nCards:');
  for (const [ref, list] of cardsByRef) {
    const c = list[0];
    const state = list.every((x) => known.has(x.sourceRef)) ? 'on file' : list.some((x) => known.has(x.sourceRef)) ? 'partly on file' : 'new';
    const tag = isInternal(c.userId) ? ' [Internal]' : '';
    console.log(`  ${ref.padEnd(34)} ${(who(c.userId) + tag).padEnd(45)} ${c.name}${list.length > 1 ? ` ×${list.length}` : ''} — ${state}`);
  }

  if (args.show) {
    const c = cands.find((x) => x.conversationId === args.show);
    console.log(`\nConversation ${args.show}:`);
    if (!c) console.log('  the detector found nothing wrong in it (or it is not in the window) — no card.');
    else {
      const companyId = companies.get(c.userId) ?? null;
      const card = {
        kind: 'chat', chat_turn_ref: c.ref, conversation_id: c.conversationId, company_id: companyId, company: companyId ? names.get(companyId) ?? null : null,
        internal: isInternal(c.userId),
        flag: { source: 'oracle_detected', source_ref: c.sourceRef, actor: DETECTOR_ACTOR, comment: `${c.name}: ${c.fullTake ?? c.take}`,
          already_on_file: known.has(c.sourceRef) },
        snapshot: snapshotFor(c, c.messages)
      };
      console.log(JSON.stringify(card, null, 2));
    }
  }

  if (args.write) {
    const { addFlag } = await import('../src/control-centre/review-queue.js');
    const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return 'unknown'; } })();
    console.log(`\nFiling into the Hub at ${host} …`);
    const { identitiesForClerkIds } = await import('../src/control-centre/identity.js');
    const filed = await fileCards(cands, {
      addFlag,
      companyFor: async (ids) => new Map([...(await identitiesForClerkIds(ids))].map(([k, v]) => [k, v.company_id]).filter(([, v]) => v != null)),
      readMessages: async (conversationId) => (await gg3OpsQuery('SELECT messages FROM conversations WHERE id = $1', [conversationId])).rows?.[0]?.messages ?? null
    });
    const r = filed.results;
    console.log(`  filed ${r.filter((x) => x.ok && !x.duplicate).length} detections — ${r.filter((x) => x.created).length} new cards, `
      + `${r.filter((x) => x.reopened).length} reopened, ${r.filter((x) => x.duplicate).length} already on file, ${filed.failed} failed`);
  }

  // Cost: this run's Haiku calls, and what the rest would take.
  const perConv = built.conversations ? dryCost / built.conversations : 0;
  console.log(`\nCost`);
  console.log(`  Haiku (${ROUNDUP_MODEL}), this run: $${dryCost.toFixed(4)}${args.write ? ' (logged to api_cost_events)' : ' (priced, not logged)'} — about $${perConv.toFixed(4)} per conversation`);
  if (!args.write) {
    console.log(`  --write would make the same calls again: about $${dryCost.toFixed(2)} more`);
    console.log(`  the hourly sweep would then diagnose ${new Set(fresh.map((c) => c.ref)).size} new card(s) with Sonnet at about $0.03 each: about $${(new Set(fresh.map((c) => c.ref)).size * 0.03).toFixed(2)}`);
  }
  await closePool();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!isGg3OpsConfigured()) throw Object.assign(new Error('GG3_OPS_DB_READONLY_URL is not set'), { code: 'ops_not_configured' });
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set'), { code: 'no_api_key' });
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // The roundup's callTool logs cost when a response carries usage; a dry run
  // prices it here and hands back the response without it. A --write backfill
  // keeps usage, so its cost is logged exactly as the daily run's is.
  const createMessage = async (params, opts) => {
    const res = await anthropic.messages.create(params, opts);
    if (res?.usage) dryCost += calculateRequestCost(res.usage, params.model);
    return args.write ? res : { ...res, usage: undefined };
  };
  if (args.since) { await backfill(args, createMessage); return; }
  if (args.conversation) await oneConversation(args.conversation, { createMessage, diagnose: args.diagnose });
  else await window(args.hours, createMessage);
  console.log(`\nHaiku cost (not logged): $${dryCost.toFixed(4)}`);
}

let code = 0;
try {
  await main();
} catch (err) {
  console.error(`Stopped (code: ${err?.code ?? err?.status ?? err?.name ?? 'unknown'})${err?.code === 'no_internal_accounts' ? ` — ${err.message}` : ''}`);
  code = 1;
} finally {
  await closeOps();
  await closeApp();
}
process.exit(code);
