/**
 * One-off backfill: 'Not a Fit' → 'Get Granted' in lead_gen_conversations.
 *
 * Context: Strategic shift per Natalie 2026-05-25 retires the public-facing
 * 'Not a Fit' product label. All historical rows are remapped to 'Get Granted'
 * so the dashboard funnel reads consistently going forward. The internal
 * service_tier='not_a_fit' classifier in tier-rules.json / executor.js is
 * preserved unchanged — only the best_fit_product label is swept.
 *
 * Idempotent via the prospect_data->>'best_fit_product' = 'Not a Fit' guard
 * in the UPDATE WHERE clause — re-running is safe.
 *
 * Archive to scripts/archive/ after running successfully.
 */

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { query, getPool } from '../src/database/connection.js';

const dryRun = process.argv.includes('--dry-run');

async function confirmWrite(rowCount) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\nWrite mode — about to update ${rowCount} rows. Type 'yes' to continue, anything else to abort: `
  );
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main() {
  console.log(`\n=== Not-a-Fit → Get Granted backfill — mode: ${dryRun ? 'DRY RUN' : 'WRITE'} ===\n`);

  // Candidate rows: finalized, post-DATA_FLOOR, best_fit_product = 'Not a Fit'
  const candidatesResult = await query(`
    SELECT id, session_id, prospect_data->>'company_name' AS company, finalized_at
    FROM lead_gen_conversations
    WHERE finalized = true
      AND created_at >= '2026-04-01'
      AND prospect_data->>'best_fit_product' = 'Not a Fit'
    ORDER BY finalized_at ASC
  `);

  const candidates = candidatesResult.rows;
  console.log(`Found ${candidates.length} candidate row(s)\n`);

  if (candidates.length === 0) {
    console.log('Nothing to backfill. Exiting.');
    await getPool().end();
    return;
  }

  if (!dryRun) {
    const ok = await confirmWrite(candidates.length);
    if (!ok) {
      console.log('Aborted by user.');
      await getPool().end();
      return;
    }
    console.log('');
  }

  let updated = 0;
  let errored = 0;

  for (const row of candidates) {
    const company = row.company || '<no company>';
    const finalizedDate = row.finalized_at
      ? row.finalized_at.toISOString().slice(0, 10)
      : '<no date>';
    const label = `${row.session_id} ${company} [finalized ${finalizedDate}]`;

    try {
      if (dryRun) {
        console.log(`WOULD UPDATE: ${label} → Get Granted`);
        updated += 1;
        continue;
      }

      // Write mode: JSONB merge with idempotency guard on the WHERE clause
      await query(
        `UPDATE lead_gen_conversations
         SET prospect_data = prospect_data || $1::jsonb
         WHERE id = $2
           AND prospect_data->>'best_fit_product' = 'Not a Fit'`,
        [JSON.stringify({ best_fit_product: 'Get Granted' }), row.id]
      );
      console.log(`UPDATED: ${label} → Get Granted`);
      updated += 1;
    } catch (err) {
      console.log(`ERROR: ${label}: ${err.message}`);
      errored += 1;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total candidates: ${candidates.length}`);
  console.log(`${dryRun ? 'Would update' : 'Updated'}:     ${updated}`);
  console.log(`Errored:          ${errored}`);

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });
