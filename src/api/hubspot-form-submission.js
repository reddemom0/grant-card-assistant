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
  inferExpansionDestination,
  lookupRangeMap,
  normalizeRangeKey
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

// Sent as `website` when the form demands one and the lead has none (the
// widget's "I don't have a website yet") and no company email domain.
const NO_WEBSITE_VALUE = 'N/A';
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

  // Phone — collected on the widget pre-chat form (required), lives in
  // prospect_data.phone. Falls back to the sentinel below only for pre-deploy
  // sessions created before phone capture shipped (no prospect_data.phone).
  const phone = pd.phone || sessionData.phone || null;
  if (!phone) {
    console.warn(`[PHONE-MISSING] No phone in prospect_data for ${sessionData.contact_email || email || 'unknown'} — falling back to sentinel (likely a pre-deploy session).`);
  }

  // Widget enums (always in prospect_data when widget submitted them)
  const industry       = pd.industry       || input.industry       || null;
  const revenueRange   = pd.revenue_range  || pd.revenue           || input.revenue   || null;
  const employeeCount  = pd.employee_count || input.employee_count || null;
  const hiringPlans    = pd.hiring_plans   || null;
  const trainingBudget = pd.training_budget   || null;
  const expansionBudg  = pd.expansion_budget  || null;
  const plannedActiv   = pd.planned_activities || null;
  const province       = pd.province         || input.province     || null;
  const referralSource = pd.referral_source  || null;

  // Agent inputs (only present when called via save_lead_data, not inactivity timeout)
  const priorGrantExp = input.prior_grant_experience || pd.prior_grant_experience || null;
  const growthPlans   = input.growth_plans   || pd.growth_plans   || null;

  // Routing decision (also written via PATCH as backstop, but submitted with form
  // so a single submission carries the final value). The locked value —
  // finalizeLeadGenConversation locks it before calling here; computing is
  // only a fallback for a caller that didn't.
  const bestFitProduct = pd.best_fit_product || computeBestFitProduct(sessionData, input);

  // Fields that must appear in the submission even when their resolved value
  // is empty — HubSpot rejects the form with a REQUIRED_FIELD error if these
  // are absent. Filtering them out via the standard null/empty filter (which
  // protects optional fields from blanking-out existing Contact data) breaks
  // submissions for sessions that don't carry the value (e.g. inactivity-
  // timeout finalization with no `planned_activities` collected).
  const ALWAYS_INCLUDE = new Set(['what_do_you_spend_it_on_', 'phone']);

  // Build fields — omit any field whose value is null/undefined to avoid
  // overwriting existing Contact data with blanks (except ALWAYS_INCLUDE)
  const raw = [
    { name: 'firstname',                                                                         value: firstname || null },
    { name: 'lastname',                                                                          value: lastname  || null },
    { name: 'email',                                                                             value: email     || null },
    { name: 'company',                                                                           value: company   || null },
    { name: 'website',                                                                           value: website }, // null when "no website" checked → omitted; submitLeadGenForm repairs a rejection
    { name: 'industry_contact',                                                                  value: industry ? mapIndustry(industry) : null },
    { name: 'how_did_you_hear_about_us_',                                                        value: 'Other' }, // submission_source covers attribution more precisely
    { name: 'who_referred_you_',                                                                 value: referralSource || null },
    { name: 'have_you_applied_for_grants_before_',                                               value: priorGrantExperienceToYesNo(priorGrantExp) },
    { name: 'is_your_organization_for_profit_or_non_profit_',                                    value: isForProfit(industry) },
    { name: 'has_your_business_existed_for_a_year_',                                             value: hasBusinessExistedForAYear(revenueRange, employeeCount) },
    { name: 'annual_revenue_from_the_last_fiscal_year',                                          value: lookupRangeMap(REVENUE_MAP, revenueRange) ?? null },
    { name: 'where_is_your_organizations_headquartered_',                                        value: commaProvincesToSemicolon(province) || null },
    { name: 'numemployees',                                                                      value: lookupRangeMap(EMPLOYEE_COUNT_MAP, employeeCount) ?? null },
    { name: 'number_of_full_time_positions_',                                                    value: lookupRangeMap(HIRING_PLANS_MAP, hiringPlans) ?? null },
    { name: 'estimated_budget_',                                                                 value: lookupRangeMap(BUDGET_RANGE_MAP, trainingBudget) ?? 0 },
    // Long internal name from form schema — the prospect's intent to spend more given reimbursement.
    // Premise of the conversation answers this. Static "Yes" per Phase 1.5 §field 19.
    // Field name is awkwardly truncated by HubSpot at exactly 100 chars including the `_with_gran`
    // suffix; do not "fix" the spelling — HubSpot owns this property name.
    { name: 'would_you_spend_more_on_training_your_staff_if_you_had_a_significant___of_cost_reimbursed_with_gran', value: 'Yes' },
    { name: 'where_will_you_be_expanding_',                                                      value: inferExpansionDestination(growthPlans, plannedActiv) },
    { name: 'expansion_budget_',                                                                 value: lookupRangeMap(BUDGET_RANGE_MAP, expansionBudg) ?? 0 },
    { name: 'research_and_development_budget',                                                   value: 0 }, // not collected by widget; default 0 per Phase 1.5 §field 22
    { name: 'what_do_you_spend_it_on_',                                                          value: plannedActiv || input.activities_summary || pd.activities || '' },
    // `phone` is REQUIRED by the HubSpot form. The widget now collects it on the pre-chat form
    // (prospect_data.phone). The '000-000-0000' sentinel survives only as a fallback for
    // pre-deploy sessions with no captured phone — kept so the required-field constraint is
    // always satisfied. The [PHONE-MISSING] warn above tracks when the fallback fires.
    { name: 'phone',                                                                             value: phone || '000-000-0000' },
    { name: 'best_fit_product',                                                                  value: bestFitProduct }
  ];

  // ─── Defensive guard ──────────────────────────────────────────────────────
  // Surface any required-at-form field that resolved to empty before HubSpot
  // does. The submission still proceeds (so HubSpot can tell us what it
  // accepts), but any silent map miss or upstream null is loud in Railway
  // logs with both the raw input and the normalized lookup key for diagnosis.
  const REQUIRED_AT_FORM_RAW_INPUTS = {
    firstname: firstname,
    lastname: lastname,
    email: email,
    company: company,
    website: website,
    industry_contact: industry,
    annual_revenue_from_the_last_fiscal_year: revenueRange,
    where_is_your_organizations_headquartered_: province,
    numemployees: employeeCount,
    number_of_full_time_positions_: hiringPlans,
    estimated_budget_: trainingBudget,
    expansion_budget_: expansionBudg
  };
  for (const f of raw) {
    if (REQUIRED_AT_FORM_RAW_INPUTS.hasOwnProperty(f.name) &&
        (f.value === null || f.value === undefined || f.value === '')) {
      const rawIn = REQUIRED_AT_FORM_RAW_INPUTS[f.name];
      console.warn(`[FORM-FIELD-MISSING] field=${f.name} raw_input=${JSON.stringify(rawIn)} normalized=${JSON.stringify(rawIn != null ? normalizeRangeKey(rawIn) : null)}`);
    }
  }

  // objectTypeId 0-1 = Contact (all fields land on Contact via form mapping).
  // Standard filter drops null/undefined/empty for optional fields, but
  // ALWAYS_INCLUDE bypasses that so HubSpot-required fields are always present
  // (with their empty value coerced to '' so the submission is well-formed).
  return raw
    .filter((f) => ALWAYS_INCLUDE.has(f.name) || (f.value !== null && f.value !== undefined && f.value !== ''))
    .map((f) => ({
      objectTypeId: '0-1',
      name: f.name,
      value: (f.value === null || f.value === undefined) ? '' : f.value
    }));
}

// ============================================================================
// FORM SUBMISSION
// ============================================================================

export async function submitLeadGenForm(sessionData, agentInput, axiosLib = null, deps = {}) {
  const fields = buildFormFields(sessionData, agentInput);

  // Server-derived client IP (from getClientIp at init time, stored in
  // prospect_data.ipAddress). Included in the Forms context so HubSpot's form
  // analytics get the end-user IP rather than the Railway egress IP. The
  // 'unknown' getClientIp fallback is treated as absent and omitted — sending a
  // non-IP would degrade analytics. Pre-deploy sessions have no ipAddress and
  // simply omit it (same as current state — no regression).
  const pd = sessionData.prospect_data || {};
  const ipAddress = (pd.ipAddress && pd.ipAddress !== 'unknown') ? pd.ipAddress : null;

  const payload = {
    submittedAt: Date.now(),
    fields,
    context: {
      pageUri: sessionData.referrer_url || 'https://granted.ca/get-started/',
      pageName: 'AI Grant Calculator Chat',
      ...(ipAddress ? { ipAddress } : {})
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
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  // 1. Submit, retrying transient failures (no response, 5xx, 429).
  let attempt = await postFormWithRetry(axios, payload, sessionData.contact_email, sleep);
  if (attempt.success) return { ...attempt, fieldCount: fields.length };

  const errors = parseFormErrors(attempt.details);
  console.error(`[HUBSPOT-FORM-REJECTED] email=${sessionData.contact_email} status=${attempt.status ?? 'none'} errors=${JSON.stringify(errors)} message="${attempt.error}"`);

  // 2. One repaired retry for a missing or invalid website: the company's
  //    email domain, unless it's a free-mail domain. A lead with no website
  //    and no usable domain gets "N/A" — the form requires the field. A
  //    website the lead entered is never replaced with "N/A". The repaired
  //    value lives only in this retry; the returned `fields` (which the CRM
  //    upsert fallback reads) never carry it.
  if (errors.some((e) => e.field === 'website')) {
    const hadNoWebsite = !fields.some((f) => f.name === 'website');
    const fromEmail = websiteFromEmail(sessionData.contact_email || agentInput?.email);
    const website = fromEmail || (hadNoWebsite ? NO_WEBSITE_VALUE : null);
    if (website) {
      const repairedFields = [
        ...fields.filter((f) => f.name !== 'website'),
        { objectTypeId: '0-1', name: 'website', value: website }
      ];
      console.log(`🔧 Retrying HubSpot form with website=${website} (${fromEmail ? 'from the email domain' : 'no website, free-mail or unreadable email domain'})`);
      attempt = await postFormWithRetry(axios, { ...payload, fields: repairedFields }, sessionData.contact_email, sleep);
      if (attempt.success) {
        return { ...attempt, fieldCount: repairedFields.length, repaired: { website } };
      }
      console.error(`[HUBSPOT-FORM-REJECTED] email=${sessionData.contact_email} repaired retry also rejected: ${JSON.stringify(parseFormErrors(attempt.details))}`);
    } else {
      console.error(`[HUBSPOT-FORM-REJECTED] email=${sessionData.contact_email} website rejected but the email domain is free-mail or unreadable — no repair`);
    }
  }

  return {
    success: false,
    rejected: true,
    status: attempt.status ?? null,
    error: attempt.error,
    errors: parseFormErrors(attempt.details),
    details: attempt.details,
    fields
  };
}

/** Transient = no HTTP response, 5xx or 429. Those are retried; a 4xx
 *  rejection isn't, since the same payload would be rejected again. */
const FORM_RETRY_DELAYS_MS = [1000, 3000];

async function postFormWithRetry(axios, payload, email, sleep) {
  for (let i = 0; ; i++) {
    try {
      console.log(`📨 Submitting HubSpot form (${payload.fields.length} fields) for ${email}${i > 0 ? ` — retry ${i}` : ''}`);
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
      return { success: true, response: response.data };
    } catch (err) {
      const status = err.response?.status;
      const transient = !err.response || status >= 500 || status === 429;
      const errPayload = err.response?.data || err.message;
      console.error('❌ HubSpot form submission failed:', errPayload);
      if (transient && i < FORM_RETRY_DELAYS_MS.length) {
        await sleep(FORM_RETRY_DELAYS_MS[i]);
        continue;
      }
      return {
        success: false,
        status,
        error: err.response?.data?.message || err.message,
        details: err.response?.data
      };
    }
  }
}

/**
 * Forms API v3 rejection body → [{ type, field, message }]. The field name is
 * read from the message ("…fields.website…" or "'website'"), else null.
 */
export function parseFormErrors(details) {
  const list = Array.isArray(details?.errors) ? details.errors : [];
  return list.map((e) => {
    const msg = String(e?.message || '');
    const m = msg.match(/fields\.([a-z0-9_]+)/i) || msg.match(/'([a-z0-9_]+)'/i) || msg.match(/"([a-z0-9_]+)"/i);
    return { type: e?.errorType || null, field: m ? m[1] : null, message: msg };
  });
}

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.ca', 'outlook.com', 'live.com', 'live.ca',
  'msn.com', 'yahoo.com', 'yahoo.ca', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'shaw.ca', 'telus.net', 'rogers.com', 'sympatico.ca', 'bell.net', 'gmx.com', 'videotron.ca'
]);

/** "jane@acme.ca" → "https://acme.ca"; null for free-mail or unreadable. */
export function websiteFromEmail(email) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1];
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || FREE_MAIL_DOMAINS.has(domain)) return null;
  return `https://${domain}`;
}

// ============================================================================
// CRM UPSERT FALLBACK
//
// When the form is rejected even after a repaired retry, the lead would never
// reach HubSpot. Upsert the Contact directly by email instead, so the PATCH,
// Note and email steps still have a record. The form-submission event (and its
// reporting bucket) is lost for that lead; finalization records that on
// prospect_data.hubspot_sync.
// ============================================================================

const CORE_UPSERT_PROPERTIES = new Set(['firstname', 'lastname', 'email', 'company', 'phone', 'website', 'best_fit_product']);

export async function upsertLeadGenContact(formFields, hubspotClient) {
  const all = {};
  for (const f of formFields || []) {
    if (f.value !== '' && f.value != null) all[f.name] = f.value;
  }
  if (!all.email) return { success: false, error: 'email is required' };
  all.submission_source = SUBMISSION_SOURCE_VALUE;

  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log(`\n🧪 TEST MODE — Would upsert contact by email (${all.email}):`);
    console.log(JSON.stringify({ endpoint: '/crm/v3/objects/contacts/batch/upsert', properties: all }, null, 2));
    return { success: true, testMode: true, properties: 'all' };
  }

  const upsert = (properties) => hubspotClient.post('/crm/v3/objects/contacts/batch/upsert', {
    inputs: [{ idProperty: 'email', id: all.email, properties }]
  });

  try {
    await upsert(all);
    console.log(`✅ Contact upserted directly (form fallback) for ${all.email}`);
    return { success: true, properties: 'all' };
  } catch (err) {
    // A form value the CRM won't take as a property (e.g. an enum label):
    // retry with the core identity fields only.
    console.warn(`⚠️  Contact upsert with all fields failed (${err.response?.data?.message || err.message}) — retrying with core fields`);
    const core = Object.fromEntries(Object.entries(all).filter(([k]) => CORE_UPSERT_PROPERTIES.has(k) || k === 'submission_source'));
    try {
      await upsert(core);
      console.log(`✅ Contact upserted directly with core fields (form fallback) for ${all.email}`);
      return { success: true, properties: 'core' };
    } catch (err2) {
      return { success: false, error: err2.response?.data?.message || err2.message };
    }
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

export async function patchAIContactProperties(contactId, { bestFitProduct, emailSummaryBody, marketingOptIn, grantCalcMin, grantCalcMax }, hubspotClient) {
  const properties = {
    submission_source: SUBMISSION_SOURCE_VALUE
  };

  if (bestFitProduct)   properties.best_fit_product   = bestFitProduct;
  if (emailSummaryBody) properties.email_summary_body = emailSummaryBody;
  if (marketingOptIn !== undefined) properties.marketing_opt_in = marketingOptIn;
  // gg3 matcher only: the stored estimate's total range, whole dollars
  // (both are HubSpot number properties).
  if (grantCalcMin != null) properties.grant_calc_min = Math.round(grantCalcMin);
  if (grantCalcMax != null) properties.grant_calc_max = Math.round(grantCalcMax);

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
