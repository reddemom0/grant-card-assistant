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
