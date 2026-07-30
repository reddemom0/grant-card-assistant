#!/usr/bin/env node
/**
 * Smoke test for src/api/booking-link-routing.js.
 *
 * Pure-function test — no DB, no HubSpot, no network. Verifies:
 *   1. getBookingLink routing matrix (existing) — 8 best_fit_product values
 *      plus industry-routed pairings (Ruk + Steph) and defensive fallbacks.
 *   2. substituteBookingLink sentinel substitution (new) — sentinel replace,
 *      null-link CTA strip (email vs chat modes), URL-rewrite backward-compat,
 *      and hard-fail (BookingLinkRoutingError) on missing routing data.
 *
 * Run: node scripts/smoke-booking-link.js
 */

import {
  getBookingLink,
  NATALIE_INTRO_LINK,
  substituteBookingLink,
  BookingLinkRoutingError
} from '../src/api/booking-link-routing.js';

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
    // Starter is self-serve by product policy — no call, ever. It previously
    // routed to Natalie; that was the policy violation this asserts against.
    name: 'Granted Starter → no link (self-serve tier)',
    input: { best_fit_product: 'Granted Starter', industry: 'Accounting' },
    expect: { link: null, source: 'no-link', consultantName: null }
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

console.log('━━━ getBookingLink routing matrix ━━━');
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
console.log(`  ${cases.length} cases × 3 fields = ${cases.length * 3} assertions`);

// ─────────────────────────────────────────────────────────────────────────────
// substituteBookingLink — sentinel substitution + null-tier strip + hard-fail
// ─────────────────────────────────────────────────────────────────────────────

const subCases = [
  // ─── sentinel substitution (industry-routed) ─────────────────────────────
  {
    name: 'Pro + Construction → sentinel replaced with Ruk URL (email)',
    text: '<p>Book a 30-minute discovery call: {{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Granted Pro', industry: 'Construction' },
    opts: { mode: 'email' },
    expect: `<p>Book a 30-minute discovery call: ${RUK_LINK}</p>`
  },
  {
    name: 'Pro + Tech - AI → sentinel replaced with Steph URL (email)',
    text: '<p>Book here: {{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Granted Pro', industry: 'Tech - AI' },
    opts: { mode: 'email' },
    expect: `<p>Book here: ${STEPH_LINK}</p>`
  },
  {
    name: 'Waitlist + Healthcare → sentinel replaced with Steph URL (email)',
    text: '<p>{{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Waitlist', industry: 'Healthcare' },
    opts: { mode: 'email' },
    expect: `<p>${STEPH_LINK}</p>`
  },
  {
    name: 'Pro + Construction → sentinel replaced (chat mode)',
    text: 'Book a 30-minute call: {{BOOKING_LINK}}',
    routing: { best_fit_product: 'Granted Pro', industry: 'Construction' },
    opts: { mode: 'chat' },
    expect: `Book a 30-minute call: ${RUK_LINK}`
  },
  {
    name: 'Pro + sentinel inside <a href> — substituted into href',
    text: '<p><a href="{{BOOKING_LINK}}">Book a discovery call</a></p>',
    routing: { best_fit_product: 'Granted Pro', industry: 'Construction' },
    opts: { mode: 'email' },
    expect: `<p><a href="${RUK_LINK}">Book a discovery call</a></p>`
  },

  // ─── sentinel substitution (natalie-intro tier) ──────────────────────────
  {
    // Enforcement, not just prompt guidance: if the model slips and emits a
    // sentinel for Starter anyway, the paragraph is stripped rather than
    // rendered into a bookable link.
    name: 'Starter + sentinel <p> stripped (self-serve tier, email mode)',
    text: '<p>{{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Granted Starter', industry: 'Accounting' },
    opts: { mode: 'email' },
    expect: ''
  },
  {
    name: 'Granted Pro Lite + sentinel → Natalie URL (still call-eligible)',
    text: '<p>{{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Granted Pro Lite', industry: 'Accounting' },
    opts: { mode: 'email' },
    expect: `<p>${NATALIE_INTRO_LINK}</p>`
  },

  // ─── null tier sentinel strip (Get Granted / Not a Fit) ──────────────────
  {
    name: 'Get Granted + sentinel <p> stripped (email mode)',
    text: '<p>Hi there,</p><p>Want to talk? {{BOOKING_LINK}}</p><p>Sign off.</p>',
    routing: { best_fit_product: 'Get Granted', industry: 'Accounting' },
    opts: { mode: 'email' },
    expect: '<p>Hi there,</p><p>Sign off.</p>'
  },
  {
    name: 'Not a Fit + sentinel <p> stripped (email mode)',
    text: '<p>Hi.</p><p>Book: {{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Not a Fit', industry: 'Manufacturing' },
    opts: { mode: 'email' },
    expect: '<p>Hi.</p>'
  },
  {
    name: 'Get Granted + sentinel stripped inline (chat mode)',
    text: 'Hit the summary button for next steps. {{BOOKING_LINK}}',
    routing: { best_fit_product: 'Get Granted', industry: 'Accounting' },
    opts: { mode: 'chat' },
    expect: 'Hit the summary button for next steps. '
  },
  {
    name: 'Get Granted + legacy hardcoded URL also stripped (email, no sentinel)',
    text: '<p>Greeting.</p><p>Book a call: https://meetings.hubspot.com/natalie392/15min-intro-to-granted</p><p>End.</p>',
    routing: { best_fit_product: 'Get Granted', industry: 'Accounting' },
    opts: { mode: 'email' },
    expect: '<p>Greeting.</p><p>End.</p>'
  },

  // ─── URL-rewrite backward compat (sentinel absent, hardcoded URL present) ─
  {
    name: 'Pro + Construction + hardcoded Natalie URL → rewritten to Ruk',
    text: '<p><a href="https://meetings.hubspot.com/natalie392/15min-intro-to-granted">Book</a></p>',
    routing: { best_fit_product: 'Granted Pro', industry: 'Construction' },
    opts: { mode: 'email' },
    expect: `<p><a href="${RUK_LINK}">Book</a></p>`
  },

  // ─── no-op pass-through ──────────────────────────────────────────────────
  {
    name: 'No sentinel, no URL → text unchanged (email)',
    text: '<p>Hi, here is your estimate. Talk soon.</p>',
    routing: { best_fit_product: 'Granted Pro', industry: 'Construction' },
    opts: { mode: 'email' },
    expect: '<p>Hi, here is your estimate. Talk soon.</p>'
  },
  {
    name: 'No sentinel, no URL → text unchanged (chat)',
    text: 'Hi, here is your estimate.',
    routing: { best_fit_product: 'Granted Pro', industry: 'Construction' },
    opts: { mode: 'chat' },
    expect: 'Hi, here is your estimate.'
  }
];

console.log('\n━━━ substituteBookingLink (success paths) ━━━');
for (const c of subCases) {
  const got = substituteBookingLink(c.text, c.routing, c.opts);
  if (got === c.expect) {
    passed++;
  } else {
    failed++;
    failures.push(
      `  ❌ ${c.name}\n     expected: ${JSON.stringify(c.expect)}\n     got:      ${JSON.stringify(got)}`
    );
  }
}
console.log(`  ${subCases.length} cases`);

// ─── hard-fail cases (BookingLinkRoutingError) ───────────────────────────────
const errCases = [
  {
    name: 'Pro + missing industry + sentinel → throws',
    text: '<p>{{BOOKING_LINK}}</p>',
    routing: { best_fit_product: 'Granted Pro', industry: null },
    opts: { mode: 'email' },
    expectReason: 'missing_industry'
  },
  {
    name: 'Waitlist + missing industry + sentinel → throws',
    text: '{{BOOKING_LINK}}',
    routing: { best_fit_product: 'Waitlist', industry: null },
    opts: { mode: 'chat' },
    expectReason: 'missing_industry'
  },
  {
    name: 'Missing best_fit_product + sentinel → throws',
    text: '<p>{{BOOKING_LINK}}</p>',
    routing: { best_fit_product: null, industry: 'Construction' },
    opts: { mode: 'email' },
    expectReason: 'missing_best_fit_product'
  }
];

console.log('\n━━━ substituteBookingLink (hard-fail) ━━━');
for (const c of errCases) {
  let caught = null;
  try {
    substituteBookingLink(c.text, c.routing, c.opts);
  } catch (e) {
    caught = e;
  }
  if (caught instanceof BookingLinkRoutingError && caught.context?.reason === c.expectReason) {
    passed++;
  } else {
    failed++;
    failures.push(
      `  ❌ ${c.name}\n     expected: BookingLinkRoutingError(reason=${c.expectReason})\n     got:      ${caught ? `${caught.name}(reason=${caught.context?.reason})` : 'no throw'}`
    );
  }
}
console.log(`  ${errCases.length} cases`);

// Sanity: Pro + missing industry but NO sentinel → no throw (only sentinel triggers strict resolution)
{
  const ok = substituteBookingLink('<p>just text</p>', { best_fit_product: 'Granted Pro', industry: null }, { mode: 'email' });
  if (ok === '<p>just text</p>') {
    passed++;
  } else {
    failed++;
    failures.push(`  ❌ Pro + no industry + no sentinel should pass-through unchanged\n     got: ${JSON.stringify(ok)}`);
  }
}

const total = passed + failed;
console.log(`\nSmoke test: ${passed}/${total} assertions passed.`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('✅ All assertions passed.');
