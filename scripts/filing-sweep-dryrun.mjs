#!/usr/bin/env node
/**
 * Filing sweep dry run — what it would send, per person, for recent files.
 *
 * READ-ONLY. Lists files created in Granted Files in the last N days (default 7)
 * as the reader (drive.readonly), runs the same rule checks, Haiku suggestions
 * and planFileMove checks as the weekday job (src/services/filing-sweep.js), and
 * prints each person's cards, "not sure" lines and the rest. Sends nothing,
 * logs nothing, saves no pending action. The database is read (users) and never
 * written: every query that isn't a SELECT is refused.
 *
 * The real job reads the Drive change feed instead, which also catches files
 * moved in; a dry run can't look back with it, so moved-in files aren't shown.
 *
 * Usage: node --network-family-autoselection-attempt-timeout=5000 scripts/filing-sweep-dryrun.mjs [--days 7] [--pilot a@granted.ca,b@granted.ca]
 * Costs a few cents of Haiku (one call per file that fails a check).
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DAYS = Number(opt('--days', 7));

// Local .env holds the service account key as multi-line JSON, which dotenv reads as "{".
// Rebuild it before src/ loads (google-drive.js reads it once). Never printed.
function loadServiceAccountKey() {
  const lines = fs.readFileSync(path.join(REPO, '.env'), 'utf8').split('\n');
  const start = lines.findIndex(l => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  if (start === -1) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in .env');
  const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, '');
  // One line ('{…}' quoted or not), or JSON spread over several lines until the closing brace.
  const buf = [lines[start].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length)];
  for (let i = start + 1; !unquote(buf[buf.length - 1]).endsWith('}') && i < lines.length; i++) buf.push(lines[i]);
  const raw = unquote(buf.join('\n'));
  // Never let a parse error echo the value: Node's SyntaxError prints the input, which is a private key.
  try { JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY in .env is not valid JSON (value not shown)'); }
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = raw;
}

loadServiceAccountKey();
const S = await import('../src/services/filing-sweep.js');
const { query: dbQuery } = await import('../src/database/connection.js');

const env = { ...process.env, ...(opt('--pilot') ? { FILING_SWEEP_PILOT_EMAILS: opt('--pilot') } : {}) };
const readOnlyQuery = (sql, params) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`dry run refuses a write: ${sql.trim().slice(0, 40)}`);
  return dbQuery(sql, params);
};
// No database from here (e.g. the Postgres public proxy is off): people are taken from the
// editor's address alone. Only the users lookup is needed, and nothing is sent anyway.
let offline = false;
try { await dbQuery('SELECT 1'); } catch (err) {
  offline = true;
  console.log(`(database unreachable — ${err.code || err.message}; recipients are taken from the editor's address, no users-table lookup)\n`);
}
const offlineQuery = async (sql, params = []) => {
  if (/FROM users/i.test(sql) && /@granted\.ca$/i.test(String(params[0] || ''))) {
    const email = String(params[0]).toLowerCase();
    return { rows: [{ id: null, email, name: email, chat_user_id: null }] };
  }
  return { rows: [] };
};
const deps = { ...S.defaultDeps(), query: offline ? offlineQuery : readOnlyQuery, logCost: () => undefined };

const reader = String(env.FILING_SWEEP_READER_EMAIL || S.fallbackEmail(env));
const drive = await deps.readDrive(reader);
const since = new Date(Date.now() - DAYS * 864e5).toISOString();
const files = await S.createdSince(drive, since);
console.log(`Filing sweep DRY RUN — files created in Granted Files since ${since.slice(0, 10)} (${DAYS} days), read as ${reader}: ${files.length}\n`);

const items = await S.evaluate(files, { drive, deps, env, meta: { dry_run: true } });
const pilot = S.pilotEmails(env);
const { groups, held } = S.groupByRecipient(items, { pilot });
const counts = S.countsOf(items);
const cost = items.reduce((s, i) => s + (i.costUsd || 0), 0);

for (const [email, g] of groups) {
  console.log(`=== ${email} — ${g.cards.length} card(s), ${g.listed.length} listed, ${g.unsure.length} not sure`);
  for (const c of g.cards) {
    console.log(`  CARD  ${c.file.name}`);
    console.log(`        now:  ${c.plan.path_before}`);
    console.log(`        to:   ${c.plan.path_after}${c.plan.folders_to_create?.length ? `  (new folders: ${c.plan.folders_to_create.join('/')})` : ''}`);
    if (c.plan.name_after !== c.plan.name_before) console.log(`        name: ${c.plan.name_after}`);
    console.log(`        why:  ${c.failures.join(', ')} — ${c.suggestion?.reason || ''}`);
  }
  for (const l of g.listed) console.log(`  LIST  ${l.file.name} → ${l.plan.path_after}`);
  for (const u of g.unsure) console.log(`  UNSURE ${u.file.name} (${u.failures.join(', ')}) — ${u.note || ''}`);
  console.log('');
}
if (held.length) {
  console.log(`=== Held by the pilot list (would_suggest): ${held.length}`);
  for (const h of held) console.log(`  ${h.recipient.email}: ${h.file.name} → ${h.plan.path_after}`);
  console.log('');
}
const ok = items.filter(i => i.status === 'ok');
const excluded = items.filter(i => i.status === 'excluded');
console.log(`OK (no card): ${ok.length}${ok.length ? ` — e.g. ${ok.slice(0, 5).map(i => i.file.name).join('; ')}` : ''}`);
console.log(`Excluded: ${excluded.length}${excluded.length ? ` — ${Object.entries(excluded.reduce((m, i) => ((m[i.note] = (m[i.note] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`);
console.log(`\nCounts: ${JSON.stringify(counts)} · Haiku cost ≈ $${cost.toFixed(4)} · nothing sent, nothing logged`);
process.exit(0);
