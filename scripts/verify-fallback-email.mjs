/**
 * Verification harness for generateFallbackEmail (Layer 2).
 *
 * Exercises the 6 test cases against constructed prospectData shapes.
 * Hard assertion on case 1: NOT-YET-READY output must NOT contain
 * "book a quick call" or "meetings.hubspot.com".
 *
 * Run: node scripts/verify-fallback-email.mjs
 *
 * Exit code 0 = all pass, 1 = any failure.
 * Temporary verification script — delete after Layer 2 ships.
 */

import { generateFallbackEmail } from '../src/api/lead-gen-finalization.js';

let failures = 0;
const results = [];

function check(name, body, assertions) {
  const failed = [];
  for (const [label, ok] of assertions) {
    if (!ok) failed.push(label);
  }
  if (failed.length === 0) {
    results.push(`✅ ${name}`);
  } else {
    failures++;
    results.push(`❌ ${name}\n   FAILED: ${failed.join('\n   FAILED: ')}\n   --- body preview (first 600 chars):\n${body.substring(0, 600)}\n   ---`);
  }
}

// ---------------------------------------------------------------------------
// CASE 1 — Small Point shape (THE PRIMARY BUG)
// best_fit_product='Get Granted', service_tier='not_a_fit'
// Expected: NOT-YET-READY copy. No estimate, no booking. HARD ASSERTION on
// "book a quick call" and "meetings.hubspot.com" both absent.
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { best_fit_product: 'Get Granted', service_tier: 'not_a_fit', company_name: 'Small Point Consulting', industry: 'Consumer Services' },
    null,            // estimatedFunding
    'Aaron',
    null,            // mergedEstimate
    null, null       // (legacy override args, intentionally unused — function reads pd)
  );
  check('Case 1 — Small Point (Get Granted + not_a_fit) → NOT-YET-READY', body, [
    ['contains "Thanks for taking the time to share"', body.includes('Thanks for taking the time to share')],
    ['contains GetGranted Database link', body.includes('granted.ca/getgranted/')],
    ['contains "When your situation changes"', body.includes('When your situation changes')],
    ['contains companyName "Small Point Consulting"', body.includes('Small Point Consulting')],
    ['contains firstName "Aaron"', body.includes('Aaron')],
    ['HARD: does NOT contain "book a quick call"', !body.includes('book a quick call')],
    ['HARD: does NOT contain "meetings.hubspot.com"', !body.includes('meetings.hubspot.com')],
    ['HARD: does NOT contain "Granted Starter is a great fit"', !body.includes('Granted Starter is a great fit')],
    ['HARD: does NOT contain "$0K"', !body.includes('$0K')],
    ['HARD: does NOT contain "$10-30K"', !body.includes('$10-30K')],
  ]);
}

// ---------------------------------------------------------------------------
// CASE 2 — Legitimate Get Granted fit
// best_fit_product='Get Granted', service_tier='starter', real estimate
// Expected: Regular Get Granted (database + waitlist). Estimate SHOWN. NO booking.
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { best_fit_product: 'Get Granted', service_tier: 'starter', company_name: 'Tiny Roastery', industry: 'Restaurants/Cafes' },
    '$10K-$12K',
    'Jamie',
    { hiring: { low: 8000, high: 12000 }, training: { low: 0, high: 0 }, market_expansion: { low: 0, high: 0 }, rd: { low: 0, high: 0 }, total_low: 8000, total_high: 12000 },
    null, null
  );
  check('Case 2 — Legit Get Granted (starter tier, est present) → Regular GG', body, [
    ['contains "$8K–$12K" estimate paragraph', body.includes('$8K–$12K')],
    ['contains "GetGranted database"', body.includes('GetGranted database')],
    ['contains "Access the GetGranted database"', body.includes('Access the GetGranted database')],
    ['contains GetGranted 2.0 Lite waitlist', body.includes('GetGranted 2.0 Lite')],
    ['HARD: does NOT contain "book a quick call"', !body.includes('book a quick call')],
    ['HARD: does NOT contain "meetings.hubspot.com"', !body.includes('meetings.hubspot.com')],
    ['HARD: does NOT contain "Granted Starter is a great fit"', !body.includes('Granted Starter is a great fit')],
    ['HARD: does NOT contain NOT-YET-READY signature', !body.includes('Thanks for taking the time to share')],
  ]);
}

// ---------------------------------------------------------------------------
// CASE 3 — Pro-qualified lead (PROVES the fix doesn't over-apply safe shape)
// best_fit_product='Granted Pro', real estimate
// Expected: Pro pitch, estimate, booking link present.
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { best_fit_product: 'Granted Pro', service_tier: 'pro', company_name: 'BigCo Manufacturing', industry: 'Manufacturing' },
    '$50K-$80K',
    'Devon',
    { hiring: { low: 30000, high: 50000 }, training: { low: 10000, high: 15000 }, market_expansion: { low: 10000, high: 15000 }, rd: { low: 0, high: 0 }, total_low: 50000, total_high: 80000 },
    null, null
  );
  check('Case 3 — Pro-qualified → Pro pitch + estimate + booking', body, [
    ['contains "$50K–$80K" estimate', body.includes('$50K–$80K')],
    ['contains "GrantedPro service"', body.includes('GrantedPro service')],
    ['contains "Learn more about GrantedPro"', body.includes('Learn more about GrantedPro')],
    ['contains booking link (meetings.hubspot.com)', body.includes('meetings.hubspot.com')],
    ['contains "Book Your Free Consultation"', body.includes('Book Your Free Consultation')],
    ['HARD: does NOT contain NOT-YET-READY signature', !body.includes('Thanks for taking the time to share')],
  ]);
}

// ---------------------------------------------------------------------------
// CASE 4 — Starter-qualified lead
// best_fit_product='Granted Starter', real estimate
// Expected: Starter pitch, estimate, booking link present.
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { best_fit_product: 'Granted Starter', service_tier: 'starter', company_name: 'MidCo Trading', industry: 'Retail' },
    '$20K-$40K',
    'Sam',
    { hiring: { low: 12000, high: 25000 }, training: { low: 5000, high: 10000 }, market_expansion: { low: 3000, high: 5000 }, rd: { low: 0, high: 0 }, total_low: 20000, total_high: 40000 },
    null, null
  );
  check('Case 4 — Starter-qualified → Starter pitch + estimate + booking', body, [
    ['contains "$20K–$40K" estimate', body.includes('$20K–$40K')],
    ['contains "Granted Starter is a great fit"', body.includes('Granted Starter is a great fit')],
    ['contains "Learn more about Granted Starter"', body.includes('Learn more about Granted Starter')],
    ['contains booking link (meetings.hubspot.com)', body.includes('meetings.hubspot.com')],
    ['contains "Book a Call"', body.includes('Book a Call')],
    ['HARD: does NOT contain NOT-YET-READY signature', !body.includes('Thanks for taking the time to share')],
  ]);
}

// ---------------------------------------------------------------------------
// CASE 5 — Nonprofit
// best_fit_product='Nonprofit'
// Expected: NOT-YET-READY shape (no estimate, no booking) for v1.
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { best_fit_product: 'Nonprofit', service_tier: 'not_a_fit', company_name: 'Helping Hands Foundation', industry: 'Charity/Non-Profit' },
    null,
    'Pat',
    null,
    null, null
  );
  check('Case 5 — Nonprofit → NOT-YET-READY shape', body, [
    ['contains NOT-YET-READY signature', body.includes('Thanks for taking the time to share')],
    ['contains GetGranted Database link', body.includes('granted.ca/getgranted/')],
    ['HARD: does NOT contain "book a quick call"', !body.includes('book a quick call')],
    ['HARD: does NOT contain "meetings.hubspot.com"', !body.includes('meetings.hubspot.com')],
    ['HARD: does NOT contain "Granted Starter is a great fit"', !body.includes('Granted Starter is a great fit')],
  ]);
}

// ---------------------------------------------------------------------------
// CASE 6 — Null/unknown best_fit_product (SAFE DEFAULT proof)
// Expected: NOT-YET-READY, NOT Starter. This is the load-bearing invariant.
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { company_name: 'Unknown Co' },   // no best_fit_product, no service_tier
    null,
    'there',
    null,
    null, null
  );
  check('Case 6 — Null/unknown tier → NOT-YET-READY (safe default)', body, [
    ['contains NOT-YET-READY signature', body.includes('Thanks for taking the time to share')],
    ['HARD: does NOT contain "Granted Starter is a great fit"', !body.includes('Granted Starter is a great fit')],
    ['HARD: does NOT contain "meetings.hubspot.com"', !body.includes('meetings.hubspot.com')],
    ['HARD: does NOT contain "book a quick call"', !body.includes('book a quick call')],
  ]);
}

// ---------------------------------------------------------------------------
// CASE 7 — Edge: Starter with all-zero mergedEstimate (defensive)
// Expected: Starter pitch fires (best_fit_product wins), but NO estimate paragraph
// (real-estimate gate suppresses $0K-$0K). Booking still emitted (Starter tier).
// ---------------------------------------------------------------------------
{
  const body = generateFallbackEmail(
    { best_fit_product: 'Granted Starter', service_tier: 'starter', company_name: 'Edge Case Inc', industry: 'Retail' },
    null,
    'Riley',
    { hiring: { low: 0, high: 0 }, training: { low: 0, high: 0 }, market_expansion: { low: 0, high: 0 }, rd: { low: 0, high: 0 }, total_low: 0, total_high: 0 },
    null, null
  );
  check('Case 7 — Starter + zero estimate (edge) → Starter pitch, NO estimate paragraph', body, [
    ['contains "Granted Starter is a great fit"', body.includes('Granted Starter is a great fit')],
    ['HARD: does NOT contain "$0K"', !body.includes('$0K')],
    ['HARD: does NOT contain "$10-30K"', !body.includes('$10-30K')],
    ['HARD: does NOT contain "estimated <strong>$"', !body.includes('estimated <strong>$')],
  ]);
}

// ---------------------------------------------------------------------------
// REGRESSION CHECK — verify the Small Point inbox-confirmed broken text
// is impossible to produce now. The literal "book a quick call" leadership
// text appears ONLY in the Starter branch's bookingCTA block. Confirm no test
// case produces it unless the Starter branch is intentionally selected.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
console.log('\n========== FALLBACK EMAIL VERIFICATION ==========\n');
results.forEach(r => console.log(r));
console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
