#!/usr/bin/env node
/**
 * Control Centre roll-up, by hand (migration 043).
 *
 *   node scripts/cc-rollup.mjs                    dry run, last 7 days
 *   node scripts/cc-rollup.mjs --days 3           dry run, last 3 days
 *   node scripts/cc-rollup.mjs --backfill         dry run, 2026-08-26 → today
 *   node scripts/cc-rollup.mjs --backfill --write upsert into the Hub DB
 *
 * Dry run is the default (--dry-run is accepted and changes nothing). Only
 * --write touches the Hub DB, and only by upsert. Sources are read through
 * the read-only connections in src/control-centre/db.js.
 *
 * Loads .env. Local DATABASE_URL is the PRODUCTION Hub DB, so --write here
 * writes to production.
 *
 * Prints days and counts only. Docs: docs/control-centre.md
 */

import 'dotenv/config';
import { runRollup, lastNDays, BACKFILL_FROM, vancouverDay } from '../src/control-centre/rollup.js';
import { _resetForTests as closeAppPool } from '../src/control-centre/db.js';
import { _resetGg3OpsForTests as closeOpsPool } from '../src/services/gg3-ops-db.js';

function parseArgs(argv) {
  const args = { days: 7, backfill: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--backfill') args.backfill = true;
    else if (a === '--write') args.write = true;
    else if (a === '--dry-run') args.write = false;
    else if (a === '--days') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error('--days needs a positive whole number');
      args.days = n;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (args.write && argv.includes('--dry-run')) throw new Error('--write and --dry-run together; pick one');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const range = args.backfill ? { from: BACKFILL_FROM, to: vancouverDay(new Date()) } : lastNDays(args.days);
  console.log(`Control Centre roll-up ${range.from} → ${range.to} (${args.write ? 'WRITE to Hub DB' : 'dry run, nothing written'})\n`);

  const summary = await runRollup({ ...range, write: args.write, log: () => {} });

  console.table(summary.days.map((d) => (d.ok
    ? { day: d.day, match_results: d.sourceRows.match_results, ai_review_log: d.sourceRows.ai_review_log,
        view_sessions: d.sourceRows.grant_view_sessions, rating_events: d.sourceRows.rating_events,
        cc_daily_matches: d.rows.cc_daily_matches, cc_daily_views: d.rows.cc_daily_views,
        cc_daily_ratings: d.rows.cc_daily_ratings }
    : { day: d.day, error: d.error })));

  const read = Object.values(summary.sourceRows).reduce((a, b) => a + b, 0);
  console.log(`Source rows read: ${read}`, summary.sourceRows);
  console.log(`Rows ${args.write ? 'upserted' : 'that would be upserted'}:`, summary.rows);
  if (summary.failed) console.log(`FAILED days: ${summary.failed}`);
  return summary.failed ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`cc-rollup: ${err.code ? `code ${err.code}` : err.message}`);
} finally {
  await closeAppPool();
  await closeOpsPool();
}
process.exit(code);
