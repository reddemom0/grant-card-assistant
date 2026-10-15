#!/usr/bin/env node
/**
 * Control Centre review sweep, by hand (migration 044).
 *
 *   node scripts/cc-review-sweep.mjs                 dry run: what it would file, and each
 *                                                    item's proposed diagnosis
 *   node scripts/cc-review-sweep.mjs --counts-only   dry run, counts only (no snapshot, no Sonnet)
 *   node scripts/cc-review-sweep.mjs --write         file them, then diagnose 'new' items
 *
 * Dry run is the default (--dry-run is accepted and changes nothing). It reads
 * the Hub DB (cursor, filed refs, 'new' items), the app DB, match-explain and,
 * for chat items, the ops DB, and calls Sonnet once per item — but writes
 * nothing: no Hub row, no api_cost_events row. It prints the Sonnet cost.
 * Only --write touches the Hub DB, and only cc_review_* (plus api_cost_events
 * for the Sonnet calls).
 *
 * Loads .env. Local DATABASE_URL is the PRODUCTION Hub DB, so --write here
 * writes to production. Point DATABASE_URL elsewhere to test.
 *
 * The dry-run preview prints narratives and client notices to this terminal;
 * --write prints counts only. Docs: docs/control-centre.md
 */

import 'dotenv/config';
import { runReviewSweep } from '../src/control-centre/review-queue.js';
import { _resetForTests as closeAppPool } from '../src/control-centre/db.js';
import { closePool as closeHubPool } from '../src/database/connection.js';

function parseArgs(argv) {
  const args = { write: false, preview: true };
  for (const a of argv) {
    if (a === '--write') args.write = true;
    else if (a === '--dry-run') args.write = false;
    else if (a === '--counts-only') args.preview = false;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.write && argv.includes('--dry-run')) throw new Error('--write and --dry-run together; pick one');
  if (args.write) args.preview = false;
  return args;
}

function printPreview({ rows, cost }) {
  console.log(`\nProposed diagnoses (${rows.length}; nothing written):`);
  for (const r of rows) {
    const what = r.kind === 'match' ? `company ${r.company_id} / grant ${r.grant_root_id}` : `chat turn ${r.chat_turn_ref}`;
    console.log(`\n— ${r.id ? `card #${r.id}` : r.label} · ${what}${r.grant ? ` · ${r.grant}` : ''}${r.snapshot_reused ? ' · stored snapshot' : ''}`);
    if (r.skipped) { console.log(`  skipped: ${r.skipped} (stays new, no attempt counted)`); continue; }
    if (r.error) {
      console.log(`  FAILED attempt ${r.attempt}: ${r.error}`);
      console.log(`  would: ${typeof r.would === 'string' ? r.would : `diagnosed → ${r.would.owner}, ${r.would.verdict}: ${r.would.narrative}`}`);
      continue;
    }
    console.log(`  cause: ${r.candidate_cause ?? '—'}   owner: ${r.owner}   verdict: ${r.verdict}`);
    console.log(`  narrative: ${r.narrative}${r.corrected ? '  [shortened on the corrective retry]' : ''}`);
    if (r.client_notice) console.log(`  client notice: ${r.client_notice}`);
    if (r.override) console.log(`  override: ${r.override.changes.join('; ')}`);
  }
  console.log(`\nSonnet cost (not logged): $${cost.toFixed(4)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Control Centre review sweep (${args.write ? 'WRITE to Hub DB' : 'dry run, nothing written'})\n`);

  const s = await runReviewSweep({ write: args.write, preview: args.preview, log: () => {} });

  console.log(`Cursor: ${s.since ?? 'none (first sweep, reading every 👎)'}`);
  console.log(`👎 read from app DB: ${s.downs_read}  (already filed: ${s.already_filed})`);
  if (args.write) {
    console.log(`Filed: ${s.filed} → ${s.new_items} new items, ${s.reopened} reopened`);
    console.log(`Diagnosed: ${s.diagnosed}, still new: ${s.left_new}`);
    if (s.failed) console.log(`FAILED: ${s.failed}`);
  } else {
    console.log(`Would file: ${s.to_file} 👎 → ${s.items} items (${s.new_items} new, ${s.reopened} would reopen)`);
    if (s.preview) printPreview(s.preview);
  }
  return s.failed ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`cc-review-sweep: ${err.code ? `code ${err.code}` : err.message}`);
} finally {
  await closeAppPool();
  await closeHubPool();
}
process.exit(code);
