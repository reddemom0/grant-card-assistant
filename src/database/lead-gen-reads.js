/**
 * Read-only lookups into the lead-gen chat's own tables, for the lead triage
 * card (src/cards/lead-card.js).
 *
 * The public calculator is a HubSpot form: its answers land on the contact, but
 * the dollar estimate it produced is never written to HubSpot. The estimate,
 * the tier and the matched programs only exist here, in
 * lead_gen_conversations (migration 011), keyed by the email the person gave.
 *
 * Nothing in this file writes, and nothing logs an email address.
 */

import { query } from './connection.js';

/**
 * The most recent lead-gen session for an email address.
 * @returns {Promise<{sessionId: string, at: Date, tier: string|null, estimate: string|null,
 *   prospect: Object, programs: Array, contactName: string|null, companyName: string|null}|null>}
 */
export async function latestLeadGenSession(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return null;
  try {
    const r = await query(
      `SELECT session_id, created_at, last_activity_at, prospect_data, matched_programs,
              estimated_funding, contact_name, contact_email, company_name
       FROM lead_gen_conversations
       WHERE LOWER(contact_email) = $1
       ORDER BY COALESCE(last_activity_at, created_at) DESC
       LIMIT 1`,
      [address]
    );
    const row = r.rows[0];
    if (!row) return null;
    const prospect = row.prospect_data || {};
    return {
      sessionId: row.session_id,
      at: row.last_activity_at || row.created_at,
      tier: prospect.service_tier || prospect.tier || null,
      estimate: row.estimated_funding || null,
      prospect,
      programs: Array.isArray(row.matched_programs) ? row.matched_programs : [],
      contactName: row.contact_name || prospect.contact_name || null,
      companyName: row.company_name || prospect.company_name || null
    };
  } catch (err) {
    // The table exists in every deployment that runs the widget; a failure here
    // must not stop a triage card.
    console.warn(`⚠️  Lead-gen session lookup failed — code: ${err?.code || err?.name || 'unknown'}`);
    return null;
  }
}
