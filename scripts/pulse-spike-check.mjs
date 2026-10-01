#!/usr/bin/env node
/**
 * Dry run of the GetGranted Pulse chat spike alert. Sends nothing.
 *
 *   GG3_OPS_DB_READONLY_URL='postgresql://oracle_readonly:…' \
 *   node scripts/pulse-spike-check.mjs [--minutes 10080]
 *
 * Counts failed chat turns in the window exactly as the live check does
 * (src/services/pulse-spike.js) and prints what the alert would say. Never
 * touches Oracle's own DB, the cooldown, or Google Chat. Counts only.
 */

import { countChatFailures, formatSpikeAlert, THRESHOLD, WINDOW_MINUTES } from '../src/services/pulse-spike.js';
import { getGg3OpsPool, isGg3OpsConfigured } from '../src/services/gg3-ops-db.js';

function parseMinutes(argv) {
  const i = argv.indexOf('--minutes');
  if (i === -1) return WINDOW_MINUTES;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error('--minutes must be a positive whole number');
    process.exit(2);
  }
  return n;
}

async function main() {
  const minutes = parseMinutes(process.argv.slice(2));

  if (!isGg3OpsConfigured()) {
    console.log('GG3 ops DB: not configured. Set GG3_OPS_DB_READONLY_URL and re-run.');
    process.exit(1);
  }

  const counts = await countChatFailures(minutes);
  console.log(`Window: last ${minutes} minutes`);
  console.log(`  chat broke (error, max_rounds): ${counts.broke}`);
  console.log(`  empty reply / refusal:          ${counts.emptyOrRefusal}`);
  console.log(`  total failures:                 ${counts.total}`);
  console.log(`  distinct users affected:        ${counts.users}`);

  if (counts.total >= THRESHOLD) {
    console.log(`\nWould alert (${counts.total} ≥ ${THRESHOLD}). Message:\n`);
    console.log(`  ${formatSpikeAlert(counts, minutes)}`);
  } else {
    console.log(`\nWould NOT alert (${counts.total} < ${THRESHOLD}).`);
  }
  if (minutes !== WINDOW_MINUTES) {
    console.log(`\n(The live check uses a ${WINDOW_MINUTES}-minute window; this run used ${minutes}.)`);
  }

  await getGg3OpsPool().end();
}

main().catch(async (err) => {
  console.error(`Dry run aborted (code: ${err?.code ?? err?.name ?? 'unknown'})`);
  try { await getGg3OpsPool()?.end(); } catch { /* ignore */ }
  process.exit(1);
});
