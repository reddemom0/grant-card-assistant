#!/usr/bin/env node
/**
 * Smoke test for src/api/booking-link-routing.js#getBookingLink.
 *
 * Pure-function test — no DB, no HubSpot, no network. Verifies the routing matrix
 * for all 8 best_fit_product values plus industry-routed pairings (Ruk + Steph)
 * and defensive fallbacks.
 *
 * Run: node scripts/smoke-booking-link.js
 */

import { getBookingLink, NATALIE_INTRO_LINK } from '../src/api/booking-link-routing.js';

const RUK_LINK = 'https://meetings.hubspot.com/rukshaar-ali';
const STEPH_LINK = 'https://meetings.hubspot.com/ssang1';

const cases = [
  // ─── industry-routed (Pro/Waitlist) ──────────────────────────────────────
  {
    name: 'Granted Pro + Ruk industry (Manufacturing)',
    input: { best_fit_product: 'Granted Pro', industry: 'Manufacturing' },
    expect: { link: RUK_LINK, source: 'industry-routed', consultantName: 'Rukshaar Ali' }
  },
  {
    name: 'Granted Pro + Steph industry (Accounting)',
    input: { best_fit_product: 'Granted Pro', industry: 'Accounting' },
    expect: { link: STEPH_LINK, source: 'industry-routed', consultantName: 'Stephanie Sang' }
  },
  {
    name: 'Waitlist + Ruk industry (Restaurants/Cafes)',
    input: { best_fit_product: 'Waitlist', industry: 'Restaurants/Cafes' },
    expect: { link: RUK_LINK, source: 'industry-routed', consultantName: 'Rukshaar Ali' }
  },
  {
    name: 'Waitlist + Steph industry (Tech - AI)',
    input: { best_fit_product: 'Waitlist', industry: 'Tech - AI' },
    expect: { link: STEPH_LINK, source: 'industry-routed', consultantName: 'Stephanie Sang' }
  },
  {
    name: 'Granted Pro + unmapped industry → Steph (JSON default_consultant)',
    input: { best_fit_product: 'Granted Pro', industry: 'NotInTheJSONAtAll' },
    expect: { link: STEPH_LINK, source: 'industry-routed', consultantName: 'Stephanie Sang' }
  },
  {
    name: 'Granted Pro + missing industry → Natalie fallback',
    input: { best_fit_product: 'Granted Pro', industry: null },
    expect: { link: NATALIE_INTRO_LINK, source: 'natalie-intro', consultantName: null }
  },

  // ─── natalie-intro tier ──────────────────────────────────────────────────
  {
    name: 'Granted Starter → Natalie',
    input: { best_fit_product: 'Granted Starter', industry: 'Accounting' },
    expect: { link: NATALIE_INTRO_LINK, source: 'natalie-intro', consultantName: null }
  },
  {
    name: 'Granted Pro Lite → Natalie',
    input: { best_fit_product: 'Granted Pro Lite', industry: 'Manufacturing' },
    expect: { link: NATALIE_INTRO_LINK, source: 'natalie-intro', consultantName: null }
  },
  {
    name: 'Nonprofit → Natalie',
    input: { best_fit_product: 'Nonprofit', industry: 'Charity/Non-Profit' },
    expect: { link: NATALIE_INTRO_LINK, source: 'natalie-intro', consultantName: null }
  },
  {
    name: 'Unknown → Natalie',
    input: { best_fit_product: 'Unknown', industry: 'Other' },
    expect: { link: NATALIE_INTRO_LINK, source: 'natalie-intro', consultantName: null }
  },

  // ─── no-link tier ────────────────────────────────────────────────────────
  {
    name: 'Get Granted → no link',
    input: { best_fit_product: 'Get Granted', industry: 'Accounting' },
    expect: { link: null, source: 'no-link', consultantName: null }
  },
  {
    name: 'Not a Fit → no link',
    input: { best_fit_product: 'Not a Fit', industry: 'Manufacturing' },
    expect: { link: null, source: 'no-link', consultantName: null }
  },

  // ─── defensive ───────────────────────────────────────────────────────────
  {
    name: 'Empty input → Natalie (defensive default)',
    input: {},
    expect: { link: NATALIE_INTRO_LINK, source: 'natalie-intro', consultantName: null }
  }
];

let passed = 0;
let failed = 0;
const failures = [];

for (const c of cases) {
  const got = getBookingLink(c.input);
  for (const field of ['link', 'source', 'consultantName']) {
    if (got[field] === c.expect[field]) {
      passed++;
    } else {
      failed++;
      failures.push(
        `  ❌ ${c.name}\n     field=${field} expected=${JSON.stringify(c.expect[field])} got=${JSON.stringify(got[field])}`
      );
    }
  }
}

const total = passed + failed;
console.log(`\nSmoke test: ${passed}/${total} assertions passed (${cases.length} cases × 3 fields).`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('✅ All assertions passed.');
