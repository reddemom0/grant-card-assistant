#!/usr/bin/env node
/**
 * The Control Centre's daily chat grouping pass, by hand: a dry run, or a
 * backfill. Implementation: src/control-centre/chat-daily.js.
 *
 *   node scripts/cc-chat-daily.mjs [--days 7]
 *       DRY RUN (the default) over the last N Vancouver days, ending yesterday.
 *       For each day: Haiku reads every client message (the same call the
 *       nightly run makes). Prints the themes, the unanswered groups, the unmet
 *       needs, every chat card it would file (and whether that detection is
 *       already on file — a read-only Hub check) and the priced cost.
 *       Writes nothing anywhere: no cc_chat_* row, no card, no api_cost_events
 *       row. The Hub session is forced read-only.
 *
 *   node scripts/cc-chat-daily.mjs --since 2026-09-20 [--save rows.json]
 *       the same dry run from that day; --save keeps the classified rows (they
 *       hold rewritten questions only) so a later --write needn't call Haiku again.
 *
 *   node scripts/cc-chat-daily.mjs --load rows.json --write [--allow-production]
 *   node scripts/cc-chat-daily.mjs --days 30 --write [--allow-production]
 *       BACKFILL: stores each day's rows (replacing that day) and files the two
 *       card types, exactly as the nightly run does (same dedupe keys, so a
 *       re-run adds nothing on file). Writes go to the Hub that DATABASE_URL
 *       points at; the local .env is PRODUCTION, so a non-local DATABASE_URL is
 *       refused unless --allow-production is given. The hourly sweep diagnoses
 *       the new cards. No cc_chat_daily_runs claim is made.
 *
 * Reads the ops DB (oracle_readonly) and the app DB (read_user) read-only.
 */

import 'dotenv/config';
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const write = flag('--write');
if (!write) process.env.PGOPTIONS = '-c default_transaction_read_only=on';

const daily = await import('../src/control-centre/chat-daily.js');
const themes = await import('../src/control-centre/chat-themes.js');
const { vancouverDay, addDays, dayRange } = await import('../src/control-centre/rollup.js');
const { calculateRequestCost } = await import('../src/config/cost-settings.js');
const { query } = await import('../src/database/connection.js');

const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
if (write && !local && !flag('--allow-production')) {
  console.error('Refusing to --write: DATABASE_URL is not a local database (the local .env is production). Add --allow-production to mean it.');
  process.exit(1);
}

const yesterday = addDays(vancouverDay(new Date()), -1);
const since = value('--since');
const days = since ? dayRange(since, yesterday) : dayRange(addDays(yesterday, -(Number(value('--days') || 7) - 1)), yesterday);
const loadPath = value('--load');
const savePath = value('--save');

const allRows = [];
const allCandidates = [];
const usage = { input_tokens: 0, output_tokens: 0 };
let conversations = 0;
const deps = daily.defaultDeps();
const loaded = loadPath ? JSON.parse(fs.readFileSync(loadPath, 'utf8')) : null;

console.log(`${write ? 'WRITE' : 'DRY RUN'} — ${days[0]} to ${days.at(-1)} (${days.length} days), Hub: ${local ? 'local' : 'PRODUCTION'}`);
for (const day of days) {
  let r;
  let filed = null;
  if (loaded) {
    const rows = loaded.rows.filter((x) => x.day === day);
    const collected = await daily.collectDay(day, deps);
    r = { day, rows, skipped: 0, candidates: daily.cardCandidates(rows), conversations: collected.conversations.size, usage: { input_tokens: 0, output_tokens: 0 } };
    if (write) {
      await daily.storeDay(day, rows, deps.hubTransaction);
      filed = await daily.fileCards(r.candidates, collected.conversations, deps);
    }
  } else {
    // write: the nightly run's own path (stores, files, logs the cost); dry run: nothing written.
    r = await daily.runDay(day, { deps, write });
    filed = r.filed;
  }
  conversations += r.conversations;
  usage.input_tokens += r.usage.input_tokens;
  usage.output_tokens += r.usage.output_tokens;
  allRows.push(...r.rows);
  allCandidates.push(...r.candidates);
  console.log(`  ${day}: ${r.conversations} chats, ${r.rows.length} messages${r.skipped ? ` (${r.skipped} skipped by the model)` : ''}, ${r.candidates.length} card flag(s)`
    + `${filed ? ` — stored, ${filed.results.filter((x) => x.ok && !x.duplicate).length} flag(s) filed${filed.failed ? `, ${filed.failed} failed` : ''}` : ''}`);
}
if (savePath) fs.writeFileSync(savePath, JSON.stringify({ days, rows: allRows }, null, 1));

// Who's who: company names and internal accounts.
const { companyNamesForIds, internalClerkIds } = await import('../src/control-centre/identity.js');
const { isInternalCompany } = await import('../src/control-centre/internal-accounts.js');
const internal = await internalClerkIds().catch(() => new Set());
const names = await companyNamesForIds([...new Set(allRows.map((r) => r.company_id).filter(Boolean))]).catch(() => new Map());
const who = (r) => `${r.company_id != null ? names.get(r.company_id) ?? `company #${r.company_id}` : 'a client with no company'}${isInternalCompany(r.company_id) || (r.company_id == null && internal.has(r.clerk_id)) ? ' [Internal]' : ''}`;
const isClient = themes.variants(internal).clients;

const first = days[0]; const last = days.at(-1);
console.log(`\nTHEMES (clients only) — ${allRows.filter(isClient).length} client messages, ${allRows.length} in all`);
for (const t of themes.buildThemes(allRows.filter(isClient), { current: { from: first, to: last }, previous: { from: '0000-01-01', to: '0000-01-01' }, trendWeeks: [] })) {
  console.log(`  ${String(t.current).padStart(3)}  ${t.theme}  — e.g. "${t.examples[0]?.question}" (#${t.examples[0]?.conversation_id})`);
}
console.log('\nUNANSWERED QUESTIONS (everyone; internal tagged)');
for (const g of themes.buildUnanswered(allRows)) {
  console.log(`  ${String(g.count).padStart(3)}  ${g.theme}  (left after a bad reply: ${g.left_after})`);
  for (const c of g.chats) for (const q of c.questions) console.log(`         #${c.conversation_id} ${who(c)} — ${themes.UNANSWERED_WORDS[q.reason]}: "${q.question}"`);
}
console.log('\nUNMET NEEDS');
for (const g of themes.buildUnmet(allRows)) {
  console.log(`  ${String(g.count).padStart(3)}  ${g.need}  — e.g. ${g.examples.map((e) => `"${e.question}" (#${e.conversation_id})`).join('; ')}`);
}

console.log('\nCHAT CARDS IT WOULD FILE (one card per chat per issue; each line is a flag)');
const refs = allCandidates.map(daily.flagRef);
const onFile = refs.length
  ? new Set((await query('SELECT source_ref FROM cc_review_flags WHERE source_ref = ANY($1::text[])', [refs]).catch(() => ({ rows: [] }))).rows.map((r) => r.source_ref))
  : new Set();
const companyOf = new Map(allRows.map((r) => [`${r.conversation_id}`, r]));
for (const issue of Object.values(daily.ISSUES)) {
  const list = allCandidates.filter((c) => c.issue === issue);
  const chats = new Set(list.map((c) => c.conversation_id));
  console.log(`  ${issue}: ${list.length} flag(s) on ${chats.size} card(s)`);
  for (const c of list) {
    const detail = c.evidence.search_status ?? c.evidence.rejected_grants.map((g) => `${g.name} (#${g.grant_id})`).join(', ');
    console.log(`    #${c.conversation_id} message ${c.turn_index + 1} — ${who(companyOf.get(`${c.conversation_id}`) ?? c)} — ${detail}${onFile.has(daily.flagRef(c)) ? ' — already on file' : ''}`);
  }
}

const cost = calculateRequestCost(usage, daily.DAILY_MODEL);
console.log(`\nCOST: ${usage.input_tokens.toLocaleString()} input + ${usage.output_tokens.toLocaleString()} output tokens = $${cost.toFixed(4)} for ${days.length} days (${conversations} chats)`
  + `${days.length ? ` — about $${(cost / days.length).toFixed(4)} a day` : ''}${loaded ? ' (rows loaded from file: no model call)' : ' (priced here, not logged)'}`);
process.exit(0);
