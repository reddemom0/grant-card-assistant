/**
 * Smoke test — buildFormFields() output verification.
 *
 * Exercises buildFormFields() against the live HubSpot form schema
 * (fetched via the no-auth JSONP endpoint) and asserts:
 *   1. Every field flagged `required:true` on the form is present in the output.
 *   2. The truncated field name (`..._with_gr`) is no longer emitted.
 *   3. The corrected field name (`..._with_gran`) IS emitted.
 *   4. `phone` is present (sentinel "000-000-0000").
 *   5. `what_do_you_spend_it_on_` is present even when planned_activities is null.
 *
 * Read-only — uses LEAD_GEN_TEST_MODE to short-circuit any HubSpot writes.
 *
 * Usage: node scripts/smoke-form-builder.js
 */

import { buildFormFields } from '../src/api/hubspot-form-submission.js';
import axios from 'axios';

process.env.LEAD_GEN_TEST_MODE = 'true';

const FORM_GUID = '1a2b53cb-5a53-43c0-b1d8-5bdb8c8467c0';
const PORTAL_ID = '21088260';

// ============================================================================
// FIXTURES — three sessions covering the failure modes that hit production
// ============================================================================

const FIXTURE_HAPPY_PATH = {
  contact_name: 'Dhwani Oza',
  contact_email: 'dhwani.oza@etoncollege.global',
  company_name: 'Eton College',
  company_website: 'https://etoncollege.ca',
  prospect_data: {
    industry: 'Educational Services',
    revenue: '$500K – $2.5M',
    employee_count: '20 – 49',
    hiring_plans: 'Not hiring right now',
    training_budget: '$10K – $25K',
    expansion_budget: '$25K – $50K',
    planned_activities: 'staff development, expanding into international markets',
    province: 'British Columbia'
  },
  estimated_funding: '$25K-$60K'
};

// The Eton-College-style failure: inactivity-timeout finalization, no agentInput,
// `planned_activities` was empty in the form ("none specified" → null in the DB).
// Note: `company_website` IS populated — the widget always collects it on page 1
// (Eton log confirms "https://etoncollege.ca" was sent). The "no website"
// checkbox edge case where website is null is a separate latent bug worth a
// follow-up ticket — would fail with REQUIRED_FIELD on `website`.
const FIXTURE_INACTIVITY_NO_ACTIVITIES = {
  contact_name: 'Dhwani Oza',
  contact_email: 'dhwani.oza@etoncollege.global',
  company_name: 'Eton College',
  company_website: 'https://etoncollege.ca',
  prospect_data: {
    industry: 'Educational Services',
    revenue: '$500K – $2.5M',
    employee_count: '20 – 49',
    hiring_plans: 'Not hiring right now',
    training_budget: 'None planned',
    expansion_budget: 'None planned',
    planned_activities: null, // ← the failure trigger
    province: 'British Columbia'
  },
  estimated_funding: null
};

// Agent-emitted format: en-dash WITHOUT spaces and ASCII-hyphen variants.
// Real lead-gen agent regenerates these strings from the system prompt and
// frequently strips whitespace or substitutes ASCII hyphens. Maps' source-of-
// truth keys use en-dash WITH spaces. Without normalization, all four range
// lookups silently miss → 4 required fields drop → HubSpot rejects.
const FIXTURE_AGENT_FORMAT_VARIANTS = {
  contact_name: 'Sample Lead',
  contact_email: 'sample@example.com',
  company_name: 'Sample Co',
  company_website: 'https://example.com',
  prospect_data: {
    industry: 'Technology',
    revenue: '$500K–$2.5M',          // en-dash, NO spaces (agent variant)
    employee_count: '5–19',           // en-dash, NO spaces
    hiring_plans: '1-2 people',       // ASCII hyphen, single space
    training_budget: '$10K - $25K',   // ASCII hyphen, spaces
    expansion_budget: '$25K–$50K',    // en-dash, NO spaces
    planned_activities: 'export and hiring',
    province: 'Alberta'
  },
  estimated_funding: '$30K-$60K'
};

// Unmappable input: revenue value that has no key in REVENUE_MAP under any
// normalization. Should fire the [FORM-FIELD-MISSING] warning AND the field
// should be filtered out of the submission (since revenue isn't in
// ALWAYS_INCLUDE).
const FIXTURE_UNMAPPABLE_REVENUE = {
  contact_name: 'Bad Data Lead',
  contact_email: 'bad@example.com',
  company_name: 'Bad Data Co',
  company_website: 'https://example.com',
  prospect_data: {
    industry: 'Technology',
    revenue: '$999B',                 // not a valid REVENUE_MAP key
    employee_count: '5 – 19',
    hiring_plans: 'Not hiring right now',
    training_budget: 'None planned',
    expansion_budget: 'None planned',
    planned_activities: 'whatever',
    province: 'British Columbia'
  },
  estimated_funding: '$30K-$60K'
};

const FIXTURE_NONPROFIT_FOOD_PROCESSING = {
  contact_name: 'Test Charity',
  contact_email: 'test@charity.org',
  company_name: 'Food Processing Charity',
  company_website: 'https://example-charity.org',
  prospect_data: {
    industry: 'Food Processing', // overridden to MANUFACTURING_FOOD_BEVERAGE
    revenue: 'Pre-revenue',
    employee_count: 'Just me',
    hiring_plans: '1 – 2 people',
    training_budget: 'Under $10K',
    expansion_budget: 'None planned',
    planned_activities: '',
    province: 'Ontario'
  },
  estimated_funding: '$15K-$25K'
};

// ============================================================================
// FETCH form schema for required-field truth
// ============================================================================

async function fetchFormRequiredFields() {
  const url = `https://forms.hubspot.com/embed/v3/form/${PORTAL_ID}/${FORM_GUID}?callback=cb&t=${Date.now()}`;
  const res = await axios.get(url, { timeout: 15000, responseType: 'text' });
  const stripped = String(res.data).replace(/^cb\(/, '').replace(/\)$/, '');
  const parsed = JSON.parse(stripped);
  const required = [];
  for (const group of parsed.form.formFieldGroups || []) {
    for (const f of group.fields || []) {
      if (f.required) required.push({ name: f.name, type: f.fieldType });
    }
  }
  return required;
}

// ============================================================================
// ASSERTIONS
// ============================================================================

let passed = 0, failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
    failed++;
  }
}

function names(fields) {
  return new Set(fields.map((f) => f.name));
}

function valueFor(fields, name) {
  const f = fields.find((x) => x.name === name);
  return f ? f.value : undefined;
}

// Capture console.warn output for the duration of `fn`, return [result, warnings[]].
async function captureWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
  try {
    const result = await fn();
    return [result, warnings];
  } finally {
    console.warn = original;
  }
}

// ============================================================================
// MAIN
// ============================================================================

(async function main() {
  console.log('\n📋 Fetching live form required-fields list…');
  const requiredFields = await fetchFormRequiredFields();
  console.log(`   ${requiredFields.length} required fields on the form\n`);

  // ── HAPPY PATH ─────────────────────────────────────────────────────
  console.log('━━━ Fixture 1: Happy path (full session, all fields populated) ━━━');
  {
    const out = buildFormFields(FIXTURE_HAPPY_PATH, null);
    const present = names(out);

    for (const r of requiredFields) {
      assert(
        present.has(r.name),
        `required field present: ${r.name}`
      );
    }

    assert(
      !present.has('would_you_spend_more_on_training_your_staff_if_you_had_a_significant___of_cost_reimbursed_with_gr'),
      'truncated field name (..._with_gr) is NOT emitted'
    );
    assert(
      present.has('would_you_spend_more_on_training_your_staff_if_you_had_a_significant___of_cost_reimbursed_with_gran'),
      'corrected field name (..._with_gran) IS emitted'
    );
    assert(
      valueFor(out, 'phone') === '000-000-0000',
      'phone sentinel value is "000-000-0000"'
    );
    assert(
      valueFor(out, 'what_do_you_spend_it_on_') === 'staff development, expanding into international markets',
      'what_do_you_spend_it_on_ carries planned_activities text when present'
    );
    console.log(`   → ${out.length} fields emitted\n`);
  }

  // ── INACTIVITY-TIMEOUT FAILURE MODE ────────────────────────────────
  console.log('━━━ Fixture 2: Inactivity timeout, no planned_activities (Eton-College-style) ━━━');
  {
    const out = buildFormFields(FIXTURE_INACTIVITY_NO_ACTIVITIES, null);
    const present = names(out);

    for (const r of requiredFields) {
      assert(
        present.has(r.name),
        `required field present: ${r.name}`
      );
    }

    assert(
      valueFor(out, 'what_do_you_spend_it_on_') === '',
      'what_do_you_spend_it_on_ is present with empty string when null/missing'
    );
    assert(
      valueFor(out, 'phone') === '000-000-0000',
      'phone sentinel still present in inactivity-timeout flow'
    );
    console.log(`   → ${out.length} fields emitted\n`);
  }

  // ── NON-PROFIT / FOOD-PROCESSING OVERRIDE ──────────────────────────
  console.log('━━━ Fixture 3: Food Processing industry override + pre-revenue solo founder ━━━');
  {
    const out = buildFormFields(FIXTURE_NONPROFIT_FOOD_PROCESSING, null);
    const present = names(out);

    for (const r of requiredFields) {
      assert(
        present.has(r.name),
        `required field present: ${r.name}`
      );
    }

    assert(
      valueFor(out, 'industry_contact') === 'MANUFACTURING_FOOD_BEVERAGE',
      'Food Processing override → MANUFACTURING_FOOD_BEVERAGE'
    );
    assert(
      valueFor(out, 'has_your_business_existed_for_a_year_') === 'no',
      'pre-revenue + solo → has_your_business_existed_for_a_year_ = "no"'
    );
    console.log(`   → ${out.length} fields emitted\n`);
  }

  // ── AGENT-FORMAT VARIANTS (en-dash without spaces, ASCII hyphen, etc.) ─
  console.log('━━━ Fixture 4: Agent-format range variants (en-dash no-space, ASCII hyphen) ━━━');
  {
    const [out, warnings] = await captureWarnings(() => buildFormFields(FIXTURE_AGENT_FORMAT_VARIANTS, null));
    const present = names(out);

    for (const r of requiredFields) {
      assert(present.has(r.name), `required field present: ${r.name}`);
    }

    // Each range field should resolve through normalization to its mapped value.
    assert(
      valueFor(out, 'annual_revenue_from_the_last_fiscal_year') === '$500K to $2.5 million',
      'revenue "$500K–$2.5M" (en-dash, no spaces) normalizes through REVENUE_MAP'
    );
    assert(
      valueFor(out, 'numemployees') === 5,
      'employee_count "5–19" (en-dash, no spaces) normalizes through EMPLOYEE_COUNT_MAP'
    );
    assert(
      valueFor(out, 'number_of_full_time_positions_') === 2,
      'hiring_plans "1-2 people" (ASCII hyphen) normalizes through HIRING_PLANS_MAP'
    );
    assert(
      valueFor(out, 'estimated_budget_') === 10000,
      'training_budget "$10K - $25K" (ASCII hyphen, spaces) normalizes through BUDGET_RANGE_MAP'
    );
    assert(
      valueFor(out, 'expansion_budget_') === 25000,
      'expansion_budget "$25K–$50K" (en-dash, no spaces) normalizes through BUDGET_RANGE_MAP'
    );
    // No FORM-FIELD-MISSING warnings should fire — every range resolved
    const missingWarnings = warnings.filter((w) => w.includes('[FORM-FIELD-MISSING]'));
    assert(
      missingWarnings.length === 0,
      `no [FORM-FIELD-MISSING] warnings on agent-format variants (got ${missingWarnings.length})`
    );
    if (missingWarnings.length) {
      for (const w of missingWarnings) console.log(`     ⚠ unexpected warning: ${w}`);
    }
    console.log(`   → ${out.length} fields emitted, ${warnings.length} warnings\n`);
  }

  // ── UNMAPPABLE INPUT (warning should fire) ─────────────────────────
  console.log('━━━ Fixture 5: Unmappable revenue value (warning expected) ━━━');
  {
    const [out, warnings] = await captureWarnings(() => buildFormFields(FIXTURE_UNMAPPABLE_REVENUE, null));
    const missingWarnings = warnings.filter((w) => w.includes('[FORM-FIELD-MISSING]'));

    assert(
      missingWarnings.length >= 1,
      'at least one [FORM-FIELD-MISSING] warning fired for unmappable revenue'
    );
    const revenueWarn = missingWarnings.find((w) => w.includes('field=annual_revenue_from_the_last_fiscal_year'));
    assert(
      !!revenueWarn,
      '[FORM-FIELD-MISSING] warning specifically targeted annual_revenue_from_the_last_fiscal_year'
    );
    assert(
      revenueWarn && revenueWarn.includes('"$999B"'),
      'warning includes raw_input="$999B"'
    );
    // Unmapped revenue field should be filtered out (not in ALWAYS_INCLUDE)
    assert(
      !names(out).has('annual_revenue_from_the_last_fiscal_year'),
      'unmappable revenue field is filtered out of the submission'
    );
    // Print captured warnings so the human verifying the run can see them
    console.log('   captured warnings:');
    for (const w of warnings) console.log(`     ${w}`);
    console.log(`   → ${out.length} fields emitted, ${warnings.length} warnings\n`);
  }

  // ── SUMMARY ────────────────────────────────────────────────────────
  console.log('━━━ Summary ━━━');
  console.log(`   passed: ${passed}`);
  console.log(`   failed: ${failed}`);
  if (failed > 0) {
    console.log('\n❌ FAILURES:');
    for (const m of failures) console.log(`   • ${m}`);
    process.exit(1);
  }
  console.log('\n✅ All assertions passed');
})().catch((err) => {
  console.error('\n❌ Smoke test crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
