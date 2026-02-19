/**
 * Background job: Finalize inactive lead-gen sessions
 *
 * Runs periodically to detect sessions that have been inactive for >5 minutes
 * and have at least a company_name captured. Creates HubSpot Company + Note
 * to preserve the conversation data even when prospects abandon the chat.
 *
 * Usage:
 *   node scripts/finalize-inactive-lead-gen.js [--inactivity-minutes=5] [--batch-size=50] [--dry-run]
 *
 * Railway cron (recommended):
 *   railway run --service grant-card-assistant node scripts/finalize-inactive-lead-gen.js
 *   Schedule: Every 10 minutes
 */

import 'dotenv/config';
import { finalizeInactiveSessions } from '../src/api/lead-gen-finalization.js';

// Parse command line args
const args = process.argv.slice(2);
const options = {};

args.forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    options[key] = value || true;
  }
});

const inactivityMinutes = parseInt(options['inactivity-minutes'] || '5', 10);
const batchSize = parseInt(options['batch-size'] || '50', 10);
const dryRun = options['dry-run'] === true;

async function main() {
  console.log('='.repeat(80));
  console.log('🔄 Lead-Gen Inactive Session Finalization');
  console.log('='.repeat(80));
  console.log(`Configuration:`);
  console.log(`  Inactivity threshold: ${inactivityMinutes} minutes`);
  console.log(`  Batch size: ${batchSize}`);
  console.log(`  Dry run: ${dryRun ? 'YES (no changes will be made)' : 'NO'}`);
  console.log('='.repeat(80));

  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No finalization will occur\n');
    // TODO: Implement dry-run query to show what would be finalized
    console.log('Dry run not yet implemented. Remove --dry-run to run for real.');
    process.exit(0);
  }

  try {
    const result = await finalizeInactiveSessions(inactivityMinutes, batchSize);

    console.log('\n' + '='.repeat(80));
    console.log('📊 Finalization Summary');
    console.log('='.repeat(80));
    console.log(`  Sessions processed: ${result.processed}`);
    console.log(`  Successfully finalized: ${result.finalized}`);
    console.log(`  Errors: ${result.errors}`);
    console.log('='.repeat(80));

    if (result.errors > 0) {
      console.warn('\n⚠️  Some sessions failed to finalize. Check logs above for details.\n');
      process.exit(1);
    } else {
      console.log('\n✅ All sessions processed successfully\n');
      process.exit(0);
    }
  } catch (err) {
    console.error('\n❌ Fatal error during finalization:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
