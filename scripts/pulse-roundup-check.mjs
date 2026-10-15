#!/usr/bin/env node
/**
 * Dry run of the GetGranted Pulse morning roundup — Oracle's chat-issue
 * detector. Files nothing, sends nothing.
 *
 *   node scripts/pulse-roundup-check.mjs [--hours 168]
 *       the live window: failed chat turns and conversations active in it,
 *       staff left out, each conversation read by Haiku. Prints each chat card
 *       it would file (ref, issue, flagged message) and the DM it would send.
 *
 *   node scripts/pulse-roundup-check.mjs --conversation 123 [--diagnose]
 *       one conversation, whoever it belongs to: the detector's review, the
 *       full card it would file (snapshot included — this prints client text,
 *       so only run it in your own terminal), and with --diagnose the Sonnet
 *       diagnosis the hourly sweep would give it (cost printed, not logged).
 *
 * Loads .env. Reads the ops DB (oracle_readonly) and, for company ids, the app
 * DB (read_user). Never writes the Hub DB — not even an api_cost_events row:
 * model costs are priced here and printed, never logged — never touches
 * pulse_alert_state, never posts to Chat. Calls Haiku once per conversation,
 * Sonnet once with --diagnose. Implementation: src/services/pulse-roundup.js.
 */

import 'dotenv/config';
import {
  buildRoundup, formatRoundup, dmCards, cardCandidates, snapshotFor, reviewConversation,
  collectErrors, collectConversations, fetchCompanyName, WINDOW_HOURS, DETECTOR_ACTOR
} from '../src/services/pulse-roundup.js';
import { gg3OpsQuery, isGg3OpsConfigured, _resetGg3OpsForTests as closeOps } from '../src/services/gg3-ops-db.js';
import { _resetForTests as closeApp } from '../src/control-centre/db.js';
import { calculateRequestCost } from '../src/config/cost-settings.js';

let dryCost = 0;

function parseArgs(argv) {
  const out = { hours: WINDOW_HOURS, conversation: null, diagnose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hours') out.hours = Number(argv[++i]);
    else if (a === '--conversation') out.conversation = Number(argv[++i]);
    else if (a === '--diagnose') out.diagnose = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.hours) || out.hours < 1) throw new Error('--hours must be a positive whole number');
  if (out.conversation !== null && !(Number.isInteger(out.conversation) && out.conversation > 0)) throw new Error('--conversation needs a conversation id');
  return out;
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
  const built = await buildRoundup({
    hours,
    deps: {
      collectErrors: (h) => collectErrors(h),
      collectConversations: (h) => collectConversations(h),
      createMessage,
      fetchProfile: (id) => fetchCompanyName(id)
    }
  });
  const lookup = built.clientLookup;
  console.log(`Window: last ${hours} hours (staff excluded)`);
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
  const cards = dmCards(built.candidates.map(c => ({ candidate: c, ok: false })), built.labels);
  console.log('\nWould send (card links appear once filed):\n');
  console.log(formatRoundup(cards, { hours }).split('\n').map(l => `  ${l}`).join('\n'));
  if (hours !== WINDOW_HOURS) console.log(`\n(The live roundup looks back ${WINDOW_HOURS} hours; this run used ${hours}.)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!isGg3OpsConfigured()) throw Object.assign(new Error('GG3_OPS_DB_READONLY_URL is not set'), { code: 'ops_not_configured' });
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set'), { code: 'no_api_key' });
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // The roundup's callTool logs cost when a response carries usage; a dry run
  // prices it here and hands back the response without it.
  const createMessage = async (params, opts) => {
    const res = await anthropic.messages.create(params, opts);
    if (res?.usage) dryCost += calculateRequestCost(res.usage, params.model);
    return { ...res, usage: undefined };
  };
  if (args.conversation) await oneConversation(args.conversation, { createMessage, diagnose: args.diagnose });
  else await window(args.hours, createMessage);
  console.log(`\nHaiku cost (not logged): $${dryCost.toFixed(4)}`);
}

let code = 0;
try {
  await main();
} catch (err) {
  console.error(`Dry run aborted (code: ${err?.code ?? err?.status ?? err?.name ?? 'unknown'})`);
  code = 1;
} finally {
  await closeOps();
  await closeApp();
}
process.exit(code);
