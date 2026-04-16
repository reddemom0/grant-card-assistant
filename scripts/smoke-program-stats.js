/**
 * Smoke test: call get_program_stats and get_deal_count against live HubSpot.
 * Run: node scripts/smoke-program-stats.js
 */

import 'dotenv/config';
import { getProgramStats, getDealCount } from '../src/tools/hubspot.js';

const program = process.argv[2] || 'ETG - BC';

console.log(`\n=== SMOKE TEST: ${program} ===\n`);

console.log('--- get_program_stats (include_starter=true) ---');
const stats = await getProgramStats(program);
console.log(JSON.stringify(stats, null, 2));

console.log('\n--- get_program_stats (include_starter=false, Pro-tier only) ---');
const statsProOnly = await getProgramStats(program, { include_starter: false });
console.log(JSON.stringify(statsProOnly, null, 2));

console.log('\n--- get_deal_count (last 12 months) ---');
const count = await getDealCount(program);
console.log(JSON.stringify(count, null, 2));

console.log('\n--- get_deal_count (last 3 months) ---');
const countRecent = await getDealCount(program, { date_range_months: 3 });
console.log(JSON.stringify(countRecent, null, 2));

console.log('\n=== DONE ===\n');
