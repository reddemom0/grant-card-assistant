/**
 * One-off backfill: prospect_data.best_fit_product
 *
 * Backfills finalized lead_gen_conversations rows that lost their
 * best_fit_product to the if (contactId) data-loss bug (fixed in 72b9ebf0).
 * Reuses the live computeBestFitProduct function so backfilled values match
 * what new sessions get post-fix.
 *
 * Usage:
 *   node scripts/backfill-best-fit-product.js --dry-run
 *   node scripts/backfill-best-fit-product.js              (writes; confirms first)
 *
 * Idempotent — re-running is safe; rows with the key already set are
 * filtered out by both the candidate query and the UPDATE's WHERE clause.
 *
 * Delete (or move to scripts/archive/) after running and verifying results.
 */

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { query, getPool } from '../src/database/connection.js';
import { computeBestFitProduct } from '../src/api/lead-gen-helpers.js';

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
  console.log(`\n=== best_fit_product backfill — mode: ${dryRun ? 'DRY RUN' : 'WRITE'} ===\n`);

  // Candidate rows: finalized, post-DATA_FLOOR, missing the key
  const candidatesResult = await query(`
    SELECT id, session_id, prospect_data, estimated_funding, finalized_at, created_at, contact_email
    FROM lead_gen_conversations
    WHERE finalized = true
      AND created_at >= '2026-04-01'
      AND NOT (prospect_data ? 'best_fit_product')
    ORDER BY finalized_at ASC NULLS LAST
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

  let wrote = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of candidates) {
    const company = row.prospect_data?.company_name || '<no company>';
    const label = `${row.session_id} ${company}`;

    try {
      // Reconstruct sessionData matching what computeBestFitProduct expects.
      // It reads sessionData.prospect_data.{industry, service_tier, revenue_range, revenue}
      // and sessionData.estimated_funding. agentInput is optional; backfill uses the
      // persisted state only.
      const sessionData = {
        prospect_data: row.prospect_data,
        estimated_funding: row.estimated_funding,
      };

      const tier = computeBestFitProduct(sessionData, null);

      // Defensive — function's contract guarantees a string, but check anyway
      if (!tier || typeof tier !== 'string' || tier.trim() === '') {
        console.log(`WOULD SKIP (no recommendation): ${label}`);
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`WOULD WRITE: ${label} → ${tier}`);
        wrote += 1;
        continue;
      }

      // Write mode: JSONB merge, idempotent guard on the WHERE clause
      await query(
        `UPDATE lead_gen_conversations
         SET prospect_data = prospect_data || $1::jsonb
         WHERE session_id = $2
           AND NOT (prospect_data ? 'best_fit_product')`,
        [JSON.stringify({ best_fit_product: tier }), row.session_id]
      );
      console.log(`WROTE: ${label} → ${tier}`);
      wrote += 1;
    } catch (err) {
      console.log(`ERROR: ${label}: ${err.message}`);
      errored += 1;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total candidates: ${candidates.length}`);
  console.log(`${dryRun ? 'Would write' : 'Wrote'}:      ${wrote}`);
  console.log(`Skipped:          ${skipped}`);
  console.log(`Errored:          ${errored}`);

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });
