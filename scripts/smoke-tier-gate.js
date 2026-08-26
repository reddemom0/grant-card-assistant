/**
 * Smoke test for the GrantedPro Fit tier gate.
 *
 * Two surfaces:
 *   1. isProCallEligible()      — the firmographic test (revenue / headcount /
 *      industry). Both rules, both boundaries, dash variants, missing inputs.
 *   2. computeBestFitProduct()  — proves the gate PROMOTES: clearing it yields
 *      'Granted Pro' regardless of estimate size or the old sub-$2.5M cap, and
 *      failing it falls back to the estimate ladder (Starter / Get Granted).
 *
 * Why dash variants matter: historical rows hold employee/revenue values the
 * widget never emitted ("5–19" unspaced, "50-99" hyphenated) because
 * save_lead_data used to overwrite the form bucket with agent free text. Those
 * rows are not being backfilled, so the gate must normalize rather than compare
 * with ===. See lookupRangeMap in src/api/hubspot-form-mappings.js.
 *
 * Run: node scripts/smoke-tier-gate.js
 */

import {
  isProCallEligible,
  computeBestFitProduct,
  PRO_EXCEPTION_INDUSTRIES
} from '../src/api/lead-gen-helpers.js';

let passed = 0;
let failed = 0;
const failures = [];

// ============================================================================
// 1. isProCallEligible
// ============================================================================

const eligibilityCases = [
  // ─── rule (a): revenue ≥ $2.5M – $5M AND employees ≥ 5 – 19 ──────────────
  { name: '(a) $5M+ / 50 – 99 / non-exception industry',
    pd: { revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Retail' }, expect: true },
  { name: '(a) $2.5M – $5M / 5 – 19 / non-exception (both boundaries exactly)',
    pd: { revenue_range: '$2.5M – $5M', employee_count: '5 – 19', industry: 'Accounting' }, expect: true },
  { name: '(a) $5M+ / 500+ ',
    pd: { revenue_range: '$5M+', employee_count: '500+', industry: 'Retail' }, expect: true },
  { name: '(a) fails on headcount: $5M+ / 1 – 4',
    pd: { revenue_range: '$5M+', employee_count: '1 – 4', industry: 'Retail' }, expect: false },
  { name: '(a) fails on headcount: $5M+ / Just me',
    pd: { revenue_range: '$5M+', employee_count: 'Just me', industry: 'Retail' }, expect: false },
  { name: '(a) fails on revenue: $500K – $2.5M / 50 – 99 / non-exception',
    pd: { revenue_range: '$500K – $2.5M', employee_count: '50 – 99', industry: 'Accounting' }, expect: false },

  // ─── rule (b): exception industry, revenue ≥ $500K – $2.5M ───────────────
  { name: '(b) exception industry one revenue bucket lower',
    pd: { revenue_range: '$500K – $2.5M', employee_count: '5 – 19', industry: 'Construction' }, expect: true },
  { name: '(b) exception industry, Manufacturing',
    pd: { revenue_range: '$500K – $2.5M', employee_count: '20 – 49', industry: 'Manufacturing' }, expect: true },
  { name: '(b) NOT an exception industry at the same numbers',
    pd: { revenue_range: '$500K – $2.5M', employee_count: '5 – 19', industry: 'Accounting' }, expect: false },
  { name: '(b) exception industry below the revenue floor (Under $500K)',
    pd: { revenue_range: 'Under $500K', employee_count: '20 – 49', industry: 'Construction' }, expect: false },
  { name: '(b) exception industry with too few staff',
    pd: { revenue_range: '$500K – $2.5M', employee_count: '1 – 4', industry: 'Construction' }, expect: false },
  { name: 'Pre-revenue never qualifies, whatever the headcount',
    pd: { revenue_range: 'Pre-revenue', employee_count: '500+', industry: 'Manufacturing' }, expect: false },

  // ─── dash variants from historical (clobbered) rows ──────────────────────
  { name: 'dash variant: ASCII hyphen "50-99"',
    pd: { revenue_range: '$5M+', employee_count: '50-99', industry: 'Retail' }, expect: true },
  { name: 'dash variant: unspaced en dash "50–99"',
    pd: { revenue_range: '$5M+', employee_count: '50–99', industry: 'Retail' }, expect: true },
  { name: 'dash variant: unspaced revenue "$500K–$2.5M" + "5–19"',
    pd: { revenue_range: '$500K–$2.5M', employee_count: '5–19', industry: 'Forestry' }, expect: true },

  // ─── missing / unusable input → false (absence is not evidence of fitness) ─
  { name: 'missing employee_count',
    pd: { revenue_range: '$5M+', industry: 'Retail' }, expect: false },
  { name: 'missing revenue_range',
    pd: { employee_count: '50 – 99', industry: 'Retail' }, expect: false },
  { name: 'unrecognised free-text employee_count',
    pd: { revenue_range: '$5M+', employee_count: 'about 30', industry: 'Retail' }, expect: false },
  { name: 'empty object', pd: {}, expect: false },
  { name: 'null', pd: null, expect: false },

  // ─── reads the form fields ONLY, never the agent's free text ─────────────
  { name: 'ignores employee_count_stated',
    pd: { revenue_range: '$5M+', employee_count_stated: '50', industry: 'Retail' }, expect: false },
  { name: 'ignores the free-text `revenue` key',
    pd: { revenue: '$8M', employee_count: '50 – 99', industry: 'Retail' }, expect: false }
];

console.log('━━━ isProCallEligible ━━━');
for (const c of eligibilityCases) {
  const got = isProCallEligible(c.pd);
  if (got === c.expect) passed++;
  else { failed++; failures.push(`  ❌ ${c.name}\n     expected=${c.expect} got=${got}`); }
}
console.log(`  ${eligibilityCases.length} cases`);

// ============================================================================
// 2. computeBestFitProduct — the gate promotes
// ============================================================================

const s = (prospect_data, estimated_funding) => ({ prospect_data, estimated_funding });

const productCases = [
  // ─── promotion: the whole point of the amendment ─────────────────────────
  { name: 'PROMOTE: sub-$2.5M exception industry clears the gate → Pro',
    session: s({ revenue_range: '$500K – $2.5M', employee_count: '5 – 19', industry: 'Construction' }, '$18K–$30K'),
    expect: 'Granted Pro' },
  { name: 'PROMOTE: gate beats a small estimate (parseFundingEstimate is unreliable)',
    session: s({ revenue_range: '$2.5M – $5M', employee_count: '20 – 49', industry: 'Construction' }, '$12K–$22K'),
    expect: 'Granted Pro' },
  { name: 'PROMOTE: $2.5M – $5M / 5 – 19 with a mid estimate → Pro (was Starter)',
    session: s({ revenue_range: '$2.5M – $5M', employee_count: '5 – 19', industry: 'Accounting' }, '$20K–$25K'),
    expect: 'Granted Pro' },

  // ─── demotion: revenue alone no longer buys Pro ──────────────────────────
  { name: 'DEMOTE: $5M+ but only 1 – 4 staff → Starter, not Pro',
    session: s({ revenue_range: '$5M+', employee_count: '1 – 4', industry: 'Retail' }, '$40K–$60K'),
    expect: 'Granted Starter' },

  // ─── Get Granted survives below the gate ────────────────────────────────
  { name: 'Get Granted survives: fails gate, estimate under $15K',
    session: s({ revenue_range: 'Under $500K', employee_count: '1 – 4', industry: 'Retail' }, '$8K–$12K'),
    expect: 'Get Granted' },
  { name: 'Starter: fails gate, estimate $15K+',
    session: s({ revenue_range: 'Under $500K', employee_count: '1 – 4', industry: 'Retail' }, '$18K–$25K'),
    expect: 'Granted Starter' },

  // ─── earlier short-circuits still win over the gate ─────────────────────
  { name: 'Nonprofit override beats the gate',
    session: s({ revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Charity/Non-Profit' }, '$50K–$80K'),
    expect: 'Nonprofit' },
  { name: 'not_a_fit beats the gate',
    session: s({ revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Manufacturing', service_tier: 'not_a_fit' }, '$50K–$80K'),
    expect: 'Get Granted' },
  { name: '$0 estimate beats the gate',
    session: s({ revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Manufacturing' }, '$0K–$0K'),
    expect: 'Get Granted' },
  { name: 'missing estimate beats the gate',
    session: s({ revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Manufacturing' }, null),
    expect: 'Get Granted' },

  // ─── the three traced scenarios ─────────────────────────────────────────
  { name: 'TRACE Construction $1.2M / 8 staff → Pro',
    session: s({ revenue_range: '$500K – $2.5M', employee_count: '5 – 19', industry: 'Construction' }, '$20K–$35K'),
    expect: 'Granted Pro' },
  { name: 'TRACE Consulting $1.2M / 8 staff → Starter (not an exception industry)',
    session: s({ revenue_range: '$500K – $2.5M', employee_count: '5 – 19', industry: 'Consulting - Business' }, '$20K–$35K'),
    expect: 'Granted Starter' },
  { name: 'TRACE Manufacturing $6M / 50 staff → Pro',
    session: s({ revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Manufacturing' }, '$60K–$90K'),
    expect: 'Granted Pro' }
];

console.log('\n━━━ computeBestFitProduct (gate promotes) ━━━');
for (const c of productCases) {
  const got = computeBestFitProduct(c.session, null);
  if (got === c.expect) passed++;
  else { failed++; failures.push(`  ❌ ${c.name}\n     expected="${c.expect}" got="${got}"`); }
}
console.log(`  ${productCases.length} cases`);

// ============================================================================
// 3. PRO_EXCEPTION_INDUSTRIES integrity
// ============================================================================

console.log('\n━━━ PRO_EXCEPTION_INDUSTRIES ━━━');
const integrity = [
  ['is an array', Array.isArray(PRO_EXCEPTION_INDUSTRIES)],
  ['has 34 entries', PRO_EXCEPTION_INDUSTRIES.length === 34],
  ['has no duplicates', new Set(PRO_EXCEPTION_INDUSTRIES).size === PRO_EXCEPTION_INDUSTRIES.length],
  ['has no leading/trailing whitespace', PRO_EXCEPTION_INDUSTRIES.every(v => v === v.trim())]
];
for (const [label, ok] of integrity) {
  if (ok) passed++;
  else { failed++; failures.push(`  ❌ PRO_EXCEPTION_INDUSTRIES ${label}`); }
}
console.log(`  ${integrity.length} checks`);

// ============================================================================

console.log(`\nSmoke test: ${passed}/${passed + failed} assertions passed.`);
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
console.log('✅ All assertions passed.');
