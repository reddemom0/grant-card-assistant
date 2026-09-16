/**
 * Helper functions for lead-gen finalization
 *
 * Extracted to keep lead-gen-finalization.js focused on the main flow
 */

import { query } from '../database/connection.js';
import { lookupRangeMap } from './hubspot-form-mappings.js';

/**
 * Determine service tier from funding estimate
 *
 * @param {string} estimatedFunding - Funding range like "$25K-$60K"
 * @returns {string} 'pro' | 'starter' | 'getgranted' | null
 */
export function determineServiceTier(estimatedFunding) {
  if (!estimatedFunding) return null;

  // Extract numeric values from funding estimate
  // Handles formats like "$25K-$60K", "$30K+", "under $15K", etc.
  const numberMatch = estimatedFunding.match(/\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*K?/i);
  if (!numberMatch) return null;

  const firstNumber = parseInt(numberMatch[1].replace(/,/g, ''), 10);

  // Thresholds
  if (firstNumber >= 30) return 'pro';           // $30K+ → GrantedPro
  if (firstNumber >= 15) return 'starter';       // $15K-$29,999 → Granted Starter
  return 'getgranted';                            // Under $15K → GetGranted
}

/**
 * Load enriched session data for comprehensive note building
 *
 * Merges data from:
 * 1. Session record (form data, company_background)
 * 2. conversation_memory table (memory_store data)
 * 3. Top-level columns (matched_programs, estimated_funding)
 *
 * @param {string} sessionId - Session ID
 * @returns {Object} Enriched session object ready for buildNoteBody
 */
export async function loadEnrichedSessionData(sessionId) {
  // Load session record with all columns
  const sessionResult = await query(
    `SELECT * FROM lead_gen_conversations WHERE session_id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const session = sessionResult.rows[0];

  // Load all memory_store data
  const memoryResult = await query(
    `SELECT key, value FROM conversation_memory WHERE conversation_id = $1`,
    [sessionId]
  );

  // Start with base session data
  const enrichedSession = { ...session };

  // Merge memory_store data
  memoryResult.rows.forEach(row => {
    const { key, value } = row;

    // Top-level fields that buildNoteBody expects
    if (key === 'matched_programs') {
      try {
        enrichedSession.matched_programs = JSON.parse(value);
      } catch {
        enrichedSession.matched_programs = value;
      }
    } else if (key === 'auto_matched_grants') {
      // Auto-captured grant names from search tool (most reliable - direct from API)
      try {
        enrichedSession.auto_matched_grants = JSON.parse(value);
      } catch {
        enrichedSession.auto_matched_grants = value;
      }
    } else if (key === 'estimated_funding') {
      enrichedSession.estimated_funding = value;
    } else if (key === 'available_now_funding') {
      enrichedSession.available_now_funding = value;
    } else if (key === 'programs_matched_count') {
      enrichedSession.programs_matched_count = value;
    } else {
      // All other memory_store fields go into prospect_data
      enrichedSession.prospect_data = enrichedSession.prospect_data || {};
      enrichedSession.prospect_data[key] = value;
    }
  });

  console.log(`✓ Loaded enriched session data: ${memoryResult.rows.length} memory_store items`);

  return enrichedSession;
}

/**
 * Parse estimated_funding to extract numeric value for tier determination
 *
 * @param {string} fundingStr - Funding string like "$25K-$60K"
 * @returns {number|null} First numeric value in thousands, or null if can't parse
 */
export function parseFundingEstimate(fundingStr) {
  if (!fundingStr) return null;

  // Extract first number from formats like "$25K-$60K", "$30K+", "under $15K"
  const match = fundingStr.match(/\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*K?/i);
  if (!match) return null;

  return parseInt(match[1].replace(/,/g, ''), 10);
}

// ============================================================================
// GRANTEDPRO FIT
//
// The firmographic test that defines the Pro category. computeBestFitProduct
// calls this first: clearing it IS being Pro, and Pro is the only product that
// carries a booking link. One decision, not two.
//
// Reads revenue band, headcount and industry — never the funding estimate. A
// $1.2M Construction firm with 8 staff is Pro-shaped; a $5M company with 3
// staff is not, whatever its estimate says.
// ============================================================================

/**
 * Industries that qualify for a call at a lower revenue floor.
 *
 * Exact-match against the widget's submitted value. Validated byte-identical
 * against the 81-value INDUSTRIES list in widget/getgranted-widget.js:58-177 —
 * 34 of 34 matched, no typos, no duplicates. The widget submits via a hidden
 * input populated only by clicking a dropdown option, so free text cannot
 * reach this comparison from the browser path.
 *
 * Grouped by the policy category each value serves; order is not significant.
 */
export const PRO_EXCEPTION_INDUSTRIES = [
  // Agri-Food / Food Processing
  'Agriculture - Crop',
  'Agriculture - Dairy',
  'Agriculture - Livestock',
  'Agriculture - Tree Fruit',
  'Agriculture - Vineyard/Wine',
  'Food Processing',
  'Food/Beverage (Manufacturing)',
  // Construction
  'Construction',
  'Construction Supplier',
  // Manufacturing
  'Manufacturing',
  'Apparel/Textiles (Manufacturing)',
  'Consumer Goods (Manufacturing)',
  'Electronic (Manufacturing)',
  'Industrial (Manufacturing)',
  'Metal (Manufacturing)',
  'Paper/Print (Manufacturing)',
  'Plastics (Manufacturing)',
  'Wood Products (Manufacturing)',
  // Technology
  'Technology',
  'Tech - AI',
  'Tech - Hardware',
  'Tech - Software/Web Development',
  'Computer/Network Security',
  // Environmental / Clean Tech
  'Environmental - Green Technologies',
  'Environmental - Waste Management',
  // Natural Resources
  'Forestry',
  'Mining/Quarrying',
  'Oil & Gas Extraction',
  'Fishery',
  // Advanced manufacturing / applied science
  'Aviation & Aerospace',
  'Ship Building & Repair/Maritime Operations',
  'Healthcare - Manufacturing',
  'Healthcare - Technology',
  'Biotechnology'
];

const PRO_EXCEPTION_INDUSTRY_SET = new Set(PRO_EXCEPTION_INDUSTRIES);

// Ordinal rank for the widget's employee buckets. Comparison is by rank, not by
// string equality, because historical rows hold dash variants the widget never
// emitted ("5–19" unspaced, "50-99" hyphenated) — the agent used to overwrite
// this field. lookupRangeMap normalizes dashes and whitespace on both sides.
// Source of truth: EMPLOYEE_RANGES in widget/getgranted-widget.js:187-195
const EMPLOYEE_BUCKET_RANK = {
  'Just me':   1,
  '1 – 4':     2,
  '5 – 19':    3,
  '20 – 49':   4,
  '50 – 99':   5,
  '100 – 499': 6,
  '500+':      7
};
const MIN_EMPLOYEE_RANK = EMPLOYEE_BUCKET_RANK['5 – 19'];

// Revenue buckets, ranked the same way and for the same reason.
const REVENUE_BUCKET_RANK = {
  'Pre-revenue':    1,
  'Under $500K':    2,
  '$500K – $2.5M':  3,
  '$2.5M – $5M':    4,
  '$5M+':           5
};
const MAIN_RULE_MIN_REVENUE_RANK      = REVENUE_BUCKET_RANK['$2.5M – $5M'];
const EXCEPTION_RULE_MIN_REVENUE_RANK = REVENUE_BUCKET_RANK['$500K – $2.5M'];

/**
 * May this prospect be offered a discovery call?
 *
 * Reads ONLY the widget form's fields. Never `revenue` or
 * `employee_count_stated` — those are agent free text and cannot be ranked.
 *
 * Eligible if EITHER:
 *   (a) revenue ≥ $2.5M – $5M          AND employees ≥ 5 – 19
 *   (b) industry ∈ PRO_EXCEPTION_INDUSTRIES
 *       AND revenue ≥ $500K – $2.5M    AND employees ≥ 5 – 19
 *
 * Thresholds sit on form-bucket edges, which rounds the stated policy down
 * (policy said $3M / $2M / 10 staff; buckets give $2.5M / $500K / 5 staff).
 * Deliberate — a missed conversation costs more than an extra one.
 *
 * Returns false when inputs are missing or unrecognised: no data is not
 * evidence of fitness.
 *
 * @param {Object} prospectData - prospect_data JSONB (or an equivalent shape)
 * @returns {boolean}
 */
export function isProCallEligible(prospectData) {
  const pd = prospectData || {};

  const employeeRank = lookupRangeMap(EMPLOYEE_BUCKET_RANK, pd.employee_count);
  if (employeeRank === undefined || employeeRank < MIN_EMPLOYEE_RANK) return false;

  const revenueRank = lookupRangeMap(REVENUE_BUCKET_RANK, pd.revenue_range);
  if (revenueRank === undefined) return false;

  // (a) main rule — revenue alone carries it
  if (revenueRank >= MAIN_RULE_MIN_REVENUE_RANK) return true;

  // (b) exception industries qualify one bucket lower
  if (PRO_EXCEPTION_INDUSTRY_SET.has(pd.industry) &&
      revenueRank >= EXCEPTION_RULE_MIN_REVENUE_RANK) {
    return true;
  }

  return false;
}

/**
 * Compute best_fit_product (the AI's product recommendation) from session +
 * agent input. Used by the HubSpot form submission and post-submission PATCH.
 *
 * Order of precedence:
 *   1. industry === "Charity/Non-Profit" → "Nonprofit" (overrides everything)
 *   2. service_tier === "not_a_fit" OR $0/null estimate → "Get Granted"
 *   3. isProCallEligible → "Granted Pro"  ("GrantedPro Fit": clearing the
 *        revenue/headcount/industry thresholds IS the Pro category)
 *   4. otherwise, by 12-month estimate:
 *        ≥ $15K → "Granted Starter"
 *        < $15K → "Get Granted"
 *
 * Product and call eligibility are ONE decision. They used to be two: the
 * estimate ladder picked the product while a separate flag decided the call,
 * which let a lead be recommended a self-serve product and offered a call at
 * the same time. "Granted Pro" is now exactly the set of leads that may be
 * offered a call — getBookingLink needs no other input.
 *
 * The old sub-$2.5M cap is gone deliberately. It existed to stop a large
 * estimate alone from buying a Pro pitch; the firmographic gate does that job
 * better, and the cap was what blocked a genuinely Pro-shaped smaller company
 * (a $1.2M Construction firm with 8 staff) from ever reaching a consultant.
 *
 * Estimate size does NOT constrain the promotion. parseFundingEstimate reads
 * only the first number in the string, so "$1.5M–$3M+" parses as 1 — too
 * fragile to gate a sales conversation on. Firmographics are not.
 *
 * "Waitlist" is intentionally NOT a possible output — AI never writes it, and
 * it is absent from the form-level HubSpot enum for best_fit_product.
 *
 * @param {Object} sessionData - Enriched session (from loadEnrichedSessionData)
 * @param {Object} [agentInput] - The full input object passed to save_lead_data
 * @returns {'Granted Pro'|'Granted Starter'|'Get Granted'|'Nonprofit'}
 */
export function computeBestFitProduct(sessionData, agentInput = null) {
  const pd = sessionData?.prospect_data || {};
  const input = agentInput || {};

  // 1. Non-profit override — wins over funding-tier logic
  const industry = pd.industry || input.industry || null;
  if (industry === 'Charity/Non-Profit') return 'Nonprofit';

  // 2. Not-yet-ready signals
  const serviceTier = pd.service_tier || sessionData?.service_tier || null;
  if (serviceTier === 'not_a_fit') return 'Get Granted';

  const estimate = sessionData?.estimated_funding || input.estimated_funding || null;
  if (!estimate) return 'Get Granted';
  if (/\$?0K[\s\-–]+\$?0K/.test(estimate)) return 'Get Granted';

  const fundingNum = parseFundingEstimate(estimate);
  if (fundingNum === 0) return 'Get Granted';

  // 3. GrantedPro Fit — firmographics decide, and they outrank the estimate.
  // Reads the form's own revenue/headcount/industry, not the agent's free text.
  if (isProCallEligible(pd)) return 'Granted Pro';

  // 4. Below the gate, the estimate decides paid vs free. Pro is unreachable
  // here by design — a lead that should be Pro cleared the gate above.
  if (fundingNum !== null && fundingNum >= 15) return 'Granted Starter';
  return 'Get Granted';
}
