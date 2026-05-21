/**
 * Helper functions for lead-gen finalization
 *
 * Extracted to keep lead-gen-finalization.js focused on the main flow
 */

import { query } from '../database/connection.js';

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

// Form revenue buckets that fall below the $2.5M Pro floor.
// Prospects in these buckets cap at Granted Starter regardless of estimate.
// Source of truth: REVENUE_RANGES in widget/getgranted-widget.js:179-185
const SUB_2_5M_REVENUE_BUCKETS = ['Pre-revenue', 'Under $500K', '$500K – $2.5M'];

/**
 * Compute best_fit_product (the AI's product recommendation) from session +
 * agent input. Used by the HubSpot form submission and post-submission PATCH.
 *
 * Order of precedence:
 *   1. industry === "Charity/Non-Profit" → "Nonprofit" (overrides everything)
 *   2. service_tier === "not_a_fit" OR $0/null estimate → "Not a Fit"
 *   3. revenue $5M+ → "Granted Pro" (regardless of estimate magnitude)
 *   4. revenue below $2.5M (Pre-revenue, Under $500K, $500K – $2.5M):
 *        estimate ≥ $15K → "Granted Starter"
 *        estimate < $15K → "Get Granted"
 *   5. revenue $2.5M – $5M (tier ladder by 12-month estimate):
 *        ≥ $30K → "Granted Pro"
 *        $15K-$29K → "Granted Starter"
 *        < $15K → "Get Granted"
 *
 * "Waitlist" is intentionally NOT a possible output — AI never writes it.
 *
 * @param {Object} sessionData - Enriched session (from loadEnrichedSessionData)
 * @param {Object} [agentInput] - The full input object passed to save_lead_data
 * @returns {'Granted Pro'|'Granted Starter'|'Get Granted'|'Nonprofit'|'Not a Fit'}
 */
export function computeBestFitProduct(sessionData, agentInput = null) {
  const pd = sessionData?.prospect_data || {};
  const input = agentInput || {};

  // 1. Non-profit override — wins over funding-tier logic
  const industry = pd.industry || input.industry || null;
  if (industry === 'Charity/Non-Profit') return 'Nonprofit';

  // 2. Not a Fit signals
  const serviceTier = pd.service_tier || sessionData?.service_tier || null;
  if (serviceTier === 'not_a_fit') return 'Not a Fit';

  const estimate = sessionData?.estimated_funding || input.estimated_funding || null;
  if (!estimate) return 'Not a Fit';
  if (/\$?0K[\s\-–]+\$?0K/.test(estimate)) return 'Not a Fit';

  const fundingNum = parseFundingEstimate(estimate);
  if (fundingNum === 0) return 'Not a Fit';

  const revenueRange = pd.revenue_range || pd.revenue || input.revenue || null;

  // 3. $5M+ → Pro (regardless of estimate magnitude, as long as not_a_fit gates passed)
  if (revenueRange === '$5M+') return 'Granted Pro';

  // 4. Sub-$2.5M revenue cap — never routes to Pro on estimate alone
  if (SUB_2_5M_REVENUE_BUCKETS.includes(revenueRange)) {
    if (fundingNum !== null && fundingNum >= 15) return 'Granted Starter';
    return 'Get Granted';
  }

  // 5. $2.5M – $5M (or unknown revenue): standard estimate ladder
  if (fundingNum !== null && fundingNum >= 30) return 'Granted Pro';
  if (fundingNum !== null && fundingNum >= 15) return 'Granted Starter';
  return 'Get Granted';
}
