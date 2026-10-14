#!/usr/bin/env node
/**
 * Control Centre review sweep, by hand (migration 044).
 *
 *   node scripts/cc-review-sweep.mjs           dry run: how many 👎s it would file
 *   node scripts/cc-review-sweep.mjs --write   file them, then diagnose 'new' items
 *
 * Dry run is the default (--dry-run is accepted and changes nothing). It
 * reads the Hub DB only for the sweep cursor and the already-filed refs. Only
 * --write touches the Hub DB, and only cc_review_*. The app DB is read
 * through the read-only connection in src/control-centre/db.js.
 *
 * Loads .env. Local DATABASE_URL is the PRODUCTION Hub DB, so --write here
 * writes to production. Point DATABASE_URL elsewhere to test.
 *
 * Prints counts only. Docs: docs/control-centre.md
 */

import 'dotenv/config';
import { runReviewSweep } from '../src/control-centre/review-queue.js';
import { _resetForTests as closeAppPool } from '../src/control-centre/db.js';
import { closePool as closeHubPool } from '../src/database/connection.js';

function parseArgs(argv) {
  const args = { write: false };
  for (const a of argv) {
    if (a === '--write') args.write = true;
    else if (a === '--dry-run') args.write = false;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.write && argv.includes('--dry-run')) throw new Error('--write and --dry-run together; pick one');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Control Centre review sweep (${args.write ? 'WRITE to Hub DB' : 'dry run, nothing written'})\n`);

  const s = await runReviewSweep({ write: args.write, log: () => {} });

  console.log(`Cursor: ${s.since ?? 'none (first sweep, reading every 👎)'}`);
  console.log(`👎 read from app DB: ${s.downs_read}  (already filed: ${s.already_filed})`);
  if (args.write) {
    console.log(`Filed: ${s.filed} → ${s.new_items} new items, ${s.reopened} reopened`);
    console.log(`Diagnosed: ${s.diagnosed}, still new: ${s.left_new}`);
    if (s.failed) console.log(`FAILED: ${s.failed}`);
  } else {
    console.log(`Would file: ${s.to_file} 👎 → ${s.items} items (${s.new_items} new, ${s.reopened} would reopen)`);
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
