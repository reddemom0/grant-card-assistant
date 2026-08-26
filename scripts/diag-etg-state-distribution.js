#!/usr/bin/env node
/**
 * Diagnostic: ETG - BC deal distribution by raw `state`.
 *
 * Replicates getProgramStats(include_starter:false) — i.e. the 4 MAIN
 * (non-Starter) pipelines — then tallies the raw `state` property so we can
 * see whether the "pending" bucket hides soft losses (Abandoned / Suspended /
 * unmapped) that are silently excluded from the success-rate denominator.
 *
 * Mirrors constants + fetch logic in src/tools/hubspot.js (module-private there).
 */
import 'dotenv/config';
import axios from 'axios';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_API = 'https://api.hubapi.com';
const PROGRAM = process.argv[2] || 'ETG - BC';
const INCLUDE_STARTER = process.argv.includes('--include-starter');

// --- mirror of src/tools/hubspot.js constants ---
const GRANT_PIPELINES = {
  hiring: '2662913', training: '2662912', market_expansion: '10188292',
  misc: '26501516', starter_hiring: '48715861', starter_training: '48715862'
};
const ALL_GRANT_PIPELINE_IDS = Object.values(GRANT_PIPELINES);
const STARTER_PIPELINE_IDS = [GRANT_PIPELINES.starter_hiring, GRANT_PIPELINES.starter_training];
const MAIN_PIPELINE_IDS = ALL_GRANT_PIPELINE_IDS.filter(id => !STARTER_PIPELINE_IDS.includes(id));
const SUCCESS_STATES = ['Won', 'Invoice Sent (Won)', 'Invoice Paid', 'Invoice Cleared', 'Retainer Sent', 'Retainer Paid'];
const FAILURE_STATES = ['Lost'];
const PENDING_STATES = ['Open', 'Abandoned', 'Suspended'];

const pipelineIds = INCLUDE_STARTER ? ALL_GRANT_PIPELINE_IDS : MAIN_PIPELINE_IDS;
const PIPELINE_NAME = Object.fromEntries(Object.entries(GRANT_PIPELINES).map(([k, v]) => [v, k]));

async function fetchAll(client) {
  const all = [];
  let after, page = 0;
  while (page < 50) {
    const body = {
      filterGroups: [{ filters: [
        { propertyName: 'grant_type', operator: 'EQ', value: PROGRAM },
        { propertyName: 'pipeline', operator: 'IN', values: pipelineIds },
      ]}],
      properties: ['dealname', 'state', 'createdate', 'closedate', 'pipeline'],
      limit: 100,
      ...(after ? { after } : {})
    };
    const r = await client.post('/crm/v3/objects/deals/search', body);
    all.push(...(r.data?.results || []));
    after = r.data?.paging?.next?.after;
    page++;
    if (!after) break;
  }
  return all;
}

const client = axios.create({
  baseURL: HUBSPOT_API,
  headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
  timeout: 15000,
});

const deals = await fetchAll(client);

const byState = {};
const byBucket = { won: 0, lost: 0, pending: 0 };
const unmapped = {};         // states not in any of the three sets
const pendingBreakdown = {}; // states that landed in the pending bucket
const byPipeline = {};

for (const d of deals) {
  const s = d.properties.state ?? '(null)';
  byState[s] = (byState[s] || 0) + 1;
  const pn = PIPELINE_NAME[d.properties.pipeline] || d.properties.pipeline;
  byPipeline[pn] = (byPipeline[pn] || 0) + 1;

  if (SUCCESS_STATES.includes(s)) byBucket.won++;
  else if (FAILURE_STATES.includes(s)) byBucket.lost++;
  else {
    byBucket.pending++;
    pendingBreakdown[s] = (pendingBreakdown[s] || 0) + 1;
    if (!PENDING_STATES.includes(s)) unmapped[s] = (unmapped[s] || 0) + 1;
  }
}

const denom = byBucket.won + byBucket.lost;
const rate = denom > 0 ? Math.round((byBucket.won / denom) * 1000) / 1000 : null;

const sortDesc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);

console.log(`\n=== ${PROGRAM} — state distribution (include_starter=${INCLUDE_STARTER}) ===`);
console.log(`Pipelines queried: ${pipelineIds.join(', ')}`);
console.log(`Total deals (sample_size): ${deals.length}\n`);

console.log('Bucket totals (getProgramStats logic):');
console.log(`  won=${byBucket.won}  lost=${byBucket.lost}  pending=${byBucket.pending}`);
console.log(`  success_rate = won/(won+lost) = ${byBucket.won}/${denom} = ${rate === null ? 'n/a' : (rate * 100).toFixed(1) + '%'}\n`);

console.log('Raw `state` distribution:');
for (const [s, n] of sortDesc(byState)) {
  const tag = SUCCESS_STATES.includes(s) ? 'WON'
    : FAILURE_STATES.includes(s) ? 'LOST'
    : PENDING_STATES.includes(s) ? 'pending'
    : 'pending/UNMAPPED';
  console.log(`  ${String(n).padStart(4)}  ${s.padEnd(22)} [${tag}]`);
}

console.log('\nPending bucket breakdown (these are EXCLUDED from the success-rate denominator):');
for (const [s, n] of sortDesc(pendingBreakdown)) console.log(`  ${String(n).padStart(4)}  ${s}`);

if (Object.keys(unmapped).length) {
  console.log('\n⚠️  UNMAPPED states (not in SUCCESS/FAILURE/PENDING sets — silently treated as pending):');
  for (const [s, n] of sortDesc(unmapped)) console.log(`  ${String(n).padStart(4)}  ${s}`);
} else {
  console.log('\n✓ No unmapped states — every deal state is in a known set.');
}

const softLoss = (pendingBreakdown['Abandoned'] || 0) + (pendingBreakdown['Suspended'] || 0)
  + Object.values(unmapped).reduce((a, b) => a + b, 0);
console.log('\n--- Soft-loss check ---');
console.log(`Deals in pending that look like soft losses (Abandoned/Suspended/unmapped): ${softLoss}`);
if (softLoss > 0) {
  const inclDenom = byBucket.won + byBucket.lost + softLoss;
  const inclRate = Math.round((byBucket.won / inclDenom) * 1000) / 1000;
  console.log(`If those counted as not-won, rate would be ${byBucket.won}/${inclDenom} = ${(inclRate * 100).toFixed(1)}% (vs ${(rate * 100).toFixed(1)}% as reported)`);
} else {
  console.log('None — the 100% claim is not hiding Abandoned/Suspended/unmapped deals in this pipeline set.');
}

console.log('\nBy pipeline:');
for (const [p, n] of sortDesc(byPipeline)) console.log(`  ${String(n).padStart(4)}  ${p}`);
console.log('');
