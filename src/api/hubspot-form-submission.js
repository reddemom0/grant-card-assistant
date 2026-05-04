/**
 * HubSpot Forms API — submission + post-submission Contact PATCH
 *
 * Replaces the direct CRM v3 Contact + Company create/update path with a
 * Forms-API submission, so AI-driven lead-gen submissions land in the same
 * reporting bucket as legacy "Grant Calculator Oct 2025" form submissions.
 *
 * The Forms Submissions endpoint at api.hsforms.com is UNAUTHENTICATED — no
 * Bearer token. The post-submission PATCH (writing AI-specific Contact
 * properties not in the form's field schema) reuses the existing
 * HUBSPOT_ACCESS_TOKEN Bearer auth.
 *
 * Architecture decisions captured in:
 *   /Users/Chris/.claude/plans/phase-2-implementation-pure-liskov.md
 *   /tmp/save-lead-data-discovery.md
 *   /tmp/industry-enum-diff.md
 */

import {
  REVENUE_MAP,
  EMPLOYEE_COUNT_MAP,
  HIRING_PLANS_MAP,
  BUDGET_RANGE_MAP,
  WIDGET_TO_HUBSPOT_INDUSTRY,
  inferExpansionDestination
} from './hubspot-form-mappings.js';
import { computeBestFitProduct } from './lead-gen-helpers.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const HUBSPOT_PORTAL_ID = '21088260';
const HUBSPOT_LEAD_GEN_FORM_GUID = '1a2b53cb-5a53-43c0-b1d8-5bdb8c8467c0';
const HUBSPOT_FORM_SUBMIT_URL =
  `https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL_ID}/${HUBSPOT_LEAD_GEN_FORM_GUID}`;

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const SUBMISSION_SOURCE_VALUE = 'AI Grant Calculator Chat';

// ============================================================================
// HELPERS — name split, yes/no inference, value coercions
// ============================================================================

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  const firstname = parts[0] || '';
  const lastname  = parts.slice(1).join(' ');
  return { firstname, lastname };
}

function priorGrantExperienceToYesNo(text) {
  if (!text) return 'No';
  const lower = String(text).toLowerCase();
  if (/first time|never applied|never|no(?:\s|$)/.test(lower)) return 'No';
  return 'Yes';
}

function isForProfit(industryLabel) {
  // Phase 1.5 rule: default for-profit ("no" non-profit) UNLESS industry is the
  // Charity/Non-Profit bucket. Note the form expects lowercase yes/no.
  return industryLabel === 'Charity/Non-Profit' ? 'yes' : 'no';
}

function hasBusinessExistedForAYear(revenueRange, employeeCount) {
  // Proxy: if pre-revenue AND solo, treat as <1 year; otherwise treat as ≥1 year.
  if (revenueRange === 'Pre-revenue' && employeeCount === 'Just me') return 'no';
  return 'yes';
}

function commaProvincesToSemicolon(province) {
  if (!province) return '';
  return String(province)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(';');
}

function mapIndustry(label) {
  if (!label) return 'OTHER';
  return WIDGET_TO_HUBSPOT_INDUSTRY[label] || 'OTHER';
}

// ============================================================================
// FIELD BUILDER
//
// Given enriched session data and (optionally) the full save_lead_data tool
// input, produce the `fields` array for the Forms API submission. Fields with
// null/undefined values are omitted entirely so HubSpot doesn't blank optional
// values out (vs. sending an empty string, which actively clears the field).
// ============================================================================

export function buildFormFields(sessionData, agentInput) {
  const pd = sessionData.prospect_data || {};
  const input = agentInput || {};

  // Contact info — widget always provides these on the pre-chat form
  const fullName = sessionData.contact_name || input.name || '';
  const { firstname, lastname } = splitName(fullName);
  const email = sessionData.contact_email || input.email || '';
  const company = sessionData.company_name || pd.company_name || input.company_name || '';
  const website = sessionData.company_website || pd.company_website || null;

  // Widget enums (always in prospect_data when widget submitted them)
  const industry       = pd.industry       || input.industry       || null;
  const revenueRange   = pd.revenue_range  || pd.revenue           || input.revenue   || null;
  const employeeCount  = pd.employee_count || input.employee_count || null;
  const hiringPlans    = pd.hiring_plans   || null;
  const trainingBudget = pd.training_budget   || null;
  const expansionBudg  = pd.expansion_budget  || null;
  const plannedActiv   = pd.planned_activities || null;
  const province       = pd.province         || input.province     || null;

  // Agent inputs (only present when called via save_lead_data, not inactivity timeout)
  const priorGrantExp = input.prior_grant_experience || pd.prior_grant_experience || null;
  const growthPlans   = input.growth_plans   || pd.growth_plans   || null;

  // Routing decision (also written via PATCH as backstop, but submitted with form
  // so a single submission carries the final value)
  const bestFitProduct = computeBestFitProduct(sessionData, input);

  // Build fields — omit any field whose value is null/undefined to avoid
  // overwriting existing Contact data with blanks
  const raw = [
    { name: 'firstname',                                                                         value: firstname || null },
    { name: 'lastname',                                                                          value: lastname  || null },
    { name: 'email',                                                                             value: email     || null },
    { name: 'company',                                                                           value: company   || null },
    { name: 'website',                                                                           value: website }, // null when "no website" checked → omitted
    { name: 'industry_contact',                                                                  value: industry ? mapIndustry(industry) : null },
    { name: 'how_did_you_hear_about_us_',                                                        value: 'Other' }, // submission_source covers attribution more precisely
    { name: 'have_you_applied_for_grants_before_',                                               value: priorGrantExperienceToYesNo(priorGrantExp) },
    { name: 'is_your_organization_for_profit_or_non_profit_',                                    value: isForProfit(industry) },
    { name: 'has_your_business_existed_for_a_year_',                                             value: hasBusinessExistedForAYear(revenueRange, employeeCount) },
    { name: 'annual_revenue_from_the_last_fiscal_year',                                          value: revenueRange ? (REVENUE_MAP[revenueRange] || null) : null },
    { name: 'where_is_your_organizations_headquartered_',                                        value: commaProvincesToSemicolon(province) || null },
    { name: 'numemployees',                                                                      value: employeeCount in EMPLOYEE_COUNT_MAP ? EMPLOYEE_COUNT_MAP[employeeCount] : null },
    { name: 'number_of_full_time_positions_',                                                    value: hiringPlans in HIRING_PLANS_MAP ? HIRING_PLANS_MAP[hiringPlans] : null },
    { name: 'estimated_budget_',                                                                 value: trainingBudget in BUDGET_RANGE_MAP ? BUDGET_RANGE_MAP[trainingBudget] : 0 },
    // Long internal name from form schema — the prospect's intent to spend more given reimbursement.
    // Premise of the conversation answers this. Static "Yes" per Phase 1.5 §field 19.
    { name: 'would_you_spend_more_on_training_your_staff_if_you_had_a_significant___of_cost_reimbursed_with_gr', value: 'Yes' },
    { name: 'where_will_you_be_expanding_',                                                      value: inferExpansionDestination(growthPlans, plannedActiv) },
    { name: 'expansion_budget_',                                                                 value: expansionBudg in BUDGET_RANGE_MAP ? BUDGET_RANGE_MAP[expansionBudg] : 0 },
    { name: 'research_and_development_budget',                                                   value: 0 }, // not collected by widget; default 0 per Phase 1.5 §field 22
    { name: 'what_do_you_spend_it_on_',                                                          value: plannedActiv || input.activities_summary || pd.activities || null },
    { name: 'best_fit_product',                                                                  value: bestFitProduct }
  ];

  // objectTypeId 0-1 = Contact (all fields land on Contact via form mapping)
  return raw
    .filter((f) => f.value !== null && f.value !== undefined && f.value !== '')
    .map((f) => ({ objectTypeId: '0-1', name: f.name, value: f.value }));
}

// ============================================================================
// FORM SUBMISSION
// ============================================================================

export async function submitLeadGenForm(sessionData, agentInput, axiosLib = null) {
  const fields = buildFormFields(sessionData, agentInput);

  const payload = {
    submittedAt: Date.now(),
    fields,
    context: {
      pageUri: sessionData.referrer_url || 'https://granted.ca/get-started/',
      pageName: 'AI Grant Calculator Chat'
    },
    legalConsentOptions: {
      consent: {
        consentToProcess: true,
        text: 'Submitted via AI Grant Calculator chat.'
      }
    }
  };

  // TEST MODE: skip the live POST and log the would-be payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would submit HubSpot form:');
    console.log(JSON.stringify({ url: HUBSPOT_FORM_SUBMIT_URL, method: 'POST', body: payload }, null, 2));
    console.log('');
    return { success: true, testMode: true, payload };
  }

  const axios = axiosLib || (await import('axios')).default;

  try {
    console.log(`📨 Submitting HubSpot form (${fields.length} fields) for ${sessionData.contact_email}`);

    const response = await axios.post(HUBSPOT_FORM_SUBMIT_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    // Forms API returns 200 with a JSON body. If `redirectUri` is omitted from
    // the payload (we omit it), the response body sometimes includes the
    // contact's vid under `inlineMessage` or related fields. We don't rely on
    // that — `findContactByEmailWithRetry` covers all cases. But we log the
    // response in case future implementers want to optimize the happy path.
    console.log(`✅ HubSpot form submitted (status: ${response.status})`);
    if (response.data && typeof response.data === 'object') {
      console.log(`   Response keys: ${Object.keys(response.data).join(', ')}`);
    }

    return { success: true, response: response.data, fieldCount: fields.length };
  } catch (err) {
    const errPayload = err.response?.data || err.message;
    console.error('❌ HubSpot form submission failed:', errPayload);
    return {
      success: false,
      error: err.response?.data?.message || err.message,
      details: err.response?.data
    };
  }
}

// ============================================================================
// CONTACT-BY-EMAIL SEARCH WITH RETRY
//
// HubSpot's Forms API can have a brief eventual-consistency window before a
// newly created Contact is searchable. Retry up to N times with linear backoff
// before giving up.
// ============================================================================

export async function findContactByEmailWithRetry(email, hubspotClient, attempts = 3, delayMs = 1000) {
  if (!email) {
    return { success: false, error: 'email is required' };
  }

  // TEST MODE: return a fake contact ID without hitting HubSpot
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    const id = 'TEST_CONTACT_' + Date.now();
    console.log(`🧪 TEST MODE — Would find contact by email (${email}); returning ${id}`);
    return { success: true, contact: { id, email }, testMode: true };
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await hubspotClient.post('/crm/v3/objects/contacts/search', {
        filterGroups: [
          {
            filters: [{ propertyName: 'email', operator: 'EQ', value: email }]
          }
        ],
        properties: ['email'],
        limit: 1
      });

      const results = res.data?.results || [];
      if (results.length > 0) {
        return { success: true, contact: results[0] };
      }

      console.log(`ℹ️  Contact not yet searchable (attempt ${attempt}/${attempts}) for ${email}`);
    } catch (err) {
      console.warn(`⚠️  Contact search failed (attempt ${attempt}/${attempts}):`, err.response?.data?.message || err.message);
    }

    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { success: false, error: `Contact not found by email after ${attempts} attempts` };
}

// ============================================================================
// AI-SPECIFIC CONTACT PATCH
//
// Writes the three Contact properties that aren't part of the form's field
// schema (or in the case of best_fit_product, also defensively re-written here
// as a backstop). Uses the existing HUBSPOT_ACCESS_TOKEN Bearer auth on the
// CRM v3 endpoint.
// ============================================================================

export async function patchAIContactProperties(contactId, { bestFitProduct, emailSummaryBody }, hubspotClient) {
  const properties = {
    submission_source: SUBMISSION_SOURCE_VALUE
  };

  if (bestFitProduct)   properties.best_fit_product   = bestFitProduct;
  if (emailSummaryBody) properties.email_summary_body = emailSummaryBody;

  // TEST MODE: log and return success
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log(`\n🧪 TEST MODE — Would PATCH contact ${contactId} with AI properties:`);
    console.log(JSON.stringify({ endpoint: `/crm/v3/objects/contacts/${contactId}`, method: 'PATCH', properties }, null, 2));
    console.log('');
    return { success: true, testMode: true };
  }

  if (!HUBSPOT_TOKEN) {
    return { success: false, error: 'HubSpot access token not configured' };
  }

  try {
    const res = await hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, { properties });
    console.log(`✅ Patched AI properties on contact ${contactId} (best_fit_product=${bestFitProduct}, email_summary=${emailSummaryBody ? `${emailSummaryBody.length}ch` : 'none'})`);
    return { success: true, contact: { id: contactId, ...res.data?.properties } };
  } catch (err) {
    console.warn('⚠️  AI-property PATCH failed:', err.response?.data?.message || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ============================================================================
// CONSTANT EXPORTS — useful for diagnostics & tests
// ============================================================================

export const FORM_CONSTANTS = {
  HUBSPOT_PORTAL_ID,
  HUBSPOT_LEAD_GEN_FORM_GUID,
  HUBSPOT_FORM_SUBMIT_URL,
  SUBMISSION_SOURCE_VALUE
};
