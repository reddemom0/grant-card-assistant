/**
 * Lead-Gen Conversation Finalization
 *
 * Two-trigger HubSpot sync:
 * - Trigger A: Contact info captured in Phase 5 (save_lead_data tool)
 * - Trigger B: Inactivity timeout (5 min, no messages) + has company_name
 *
 * Both triggers create Company + optional Contact + Note in HubSpot.
 * If Company already exists (from Trigger B), Trigger A updates instead of creating.
 */

import { query } from '../database/connection.js';
import {
  createHubSpotCompany,
  createHubSpotContact,
  updateHubSpotCompany,
  updateHubSpotContact,
  associateContactWithCompany,
  getContactByEmail
} from '../tools/hubspot.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BOOKING_LINK = 'https://meetings.hubspot.com/natalie392/15min-intro-to-granted';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse revenue string to number
 * "$800K" → 800000, "$1.5M" → 1500000, "$500K-$1M" → 500000 (lower bound)
 */
function parseRevenue(revenueStr) {
  if (!revenueStr) return null;

  let s = String(revenueStr).replace(/[$,\s]/g, '').toUpperCase();

  // Handle ranges — take lower bound
  const rangeParts = s.split(/[-–]/);
  s = rangeParts[0].trim();

  const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  for (const [suffix, mult] of Object.entries(multipliers)) {
    if (s.endsWith(suffix)) {
      const num = parseFloat(s.slice(0, -1));
      return isNaN(num) ? null : Math.round(num * mult);
    }
  }

  const num = parseFloat(s);
  return isNaN(num) ? null : Math.round(num);
}

/**
 * Parse employee count from string
 * "15-20 employees" → 15, "about 30" → 30
 */
function parseEmployeeCount(str) {
  if (!str) return null;
  const match = String(str).match(/[\d,]+/);
  if (!match) return null;
  const num = parseInt(match[0].replace(/,/g, ''), 10);
  return isNaN(num) ? null : num;
}

/**
 * Search for existing HubSpot company by name
 */
async function findCompanyByName(name, hubspotClient) {
  try {
    const response = await hubspotClient.post('/crm/v3/objects/companies/search', {
      filterGroups: [{
        filters: [{
          propertyName: 'name',
          operator: 'EQ',
          value: name
        }]
      }],
      properties: ['name', 'id'],
      limit: 1
    });
    const results = response.data.results || [];
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    console.warn('⚠️  HubSpot company search failed:', err.response?.data?.message || err.message);
    return null;
  }
}

/**
 * Create HubSpot Note and associate with contact + company
 */
async function createHubSpotNote(noteBody, contactId, companyId, hubspotClient) {
  const noteRes = await hubspotClient.post('/crm/v3/objects/notes', {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: noteBody
    }
  });

  const noteId = noteRes.data.id;
  console.log(`📝 HubSpot note created: ${noteId}`);

  if (contactId) {
    await hubspotClient.put(
      `/crm/v4/objects/notes/${noteId}/associations/default/contacts/${contactId}`,
      []
    );
  }

  if (companyId) {
    await hubspotClient.put(
      `/crm/v4/objects/notes/${noteId}/associations/default/companies/${companyId}`,
      []
    );
  }

  return noteId;
}

/**
 * Build HubSpot note body for finalized conversation
 */
function buildNoteBody(sessionData, trigger) {
  const { prospect_data, matched_programs, estimated_funding, cta_selected, message_count, contact_name, contact_email } = sessionData;
  const pd = prospect_data || {};

  const lines = ['=== Grant Advisor Chat — Lead Summary ===', ''];

  // Trigger-specific header
  if (trigger === 'inactivity_timeout') {
    lines.push(`⚠️ No contact info captured — visitor abandoned chat after ${message_count} exchanges`);
    lines.push('This record was auto-created to preserve conversation data.');
    lines.push('');
  }

  // Natural language summary (if captured)
  if (pd.prospect_summary) {
    lines.push(pd.prospect_summary);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Contact info (if available)
  if (contact_name) lines.push(`Name: ${contact_name}`);
  if (contact_email) lines.push(`Email: ${contact_email}`);

  // Company info
  if (pd.company_name) lines.push(`Company: ${pd.company_name}`);
  if (pd.province) lines.push(`Province: ${pd.province}`);
  if (pd.revenue) lines.push(`Revenue: ${pd.revenue}`);
  if (pd.employee_count) lines.push(`Employees: ${pd.employee_count}`);
  if (pd.company_description) lines.push(`About: ${pd.company_description}`);
  if (pd.prior_grant_experience) lines.push(`Prior grant experience: ${pd.prior_grant_experience}`);

  // Lead score
  if (pd.lead_score) {
    const scoreLabels = { hot: 'Hot (ready to close)', warm: 'Warm (promising)', cool: 'Cool (early stage)' };
    lines.push(`Lead score: ${scoreLabels[pd.lead_score] || pd.lead_score}`);
  }

  // Individual scoring signals (if captured)
  const signals = [];
  if (pd.timeline) signals.push(`Timeline: ${pd.timeline}`);
  if (pd.budget_committed !== undefined) signals.push(`Budget committed: ${pd.budget_committed}`);
  if (pd.is_decision_maker !== undefined) signals.push(`Decision maker: ${pd.is_decision_maker}`);
  if (pd.growth_plans) signals.push(`Growth plans: ${pd.growth_plans}`);
  if (pd.existing_consultant) signals.push(`Existing consultant: ${pd.existing_consultant}`);

  if (signals.length > 0) {
    lines.push('');
    lines.push('Qualification signals:');
    signals.forEach(s => lines.push(`  - ${s}`));
  }

  lines.push('');

  // Activities discussed
  if (pd.activities) {
    lines.push('Activities discussed:');
    lines.push(pd.activities);
    lines.push('');
  }

  // Programs matched
  if (matched_programs && matched_programs.length > 0) {
    lines.push('Programs matched:');
    lines.push(matched_programs.join(', '));
    lines.push('');
  }

  // Funding estimate
  if (estimated_funding) {
    lines.push(`Estimated funding potential: ${estimated_funding}`);
    lines.push('');
  }

  // CTA taken (if Phase 5 reached)
  if (cta_selected) {
    const ctaLabels = {
      book_call: 'Book a strategy call',
      email_summary: 'Email summary requested',
      resources: 'Resources requested',
      none: 'No CTA taken'
    };
    lines.push(`CTA selected: ${ctaLabels[cta_selected] || cta_selected}`);
    lines.push('');
  }

  // Message count
  lines.push(`Conversation length: ${message_count} messages`);
  lines.push('');

  // Booking link
  lines.push('---');
  lines.push(`Booking link: ${BOOKING_LINK}`);

  return lines.join('\n');
}

// ============================================================================
// MAIN FINALIZATION FUNCTION
// ============================================================================

/**
 * Finalize a lead-gen conversation by creating HubSpot records
 *
 * @param {string} sessionId - Session ID to finalize
 * @param {string} trigger - 'contact_captured' or 'inactivity_timeout'
 * @returns {Object} Finalization result
 */
export async function finalizeLeadGenConversation(sessionId, trigger) {
  console.log(`🎯 Finalizing lead-gen session ${sessionId} (trigger: ${trigger})`);

  // -------------------------------------------------------------------------
  // 1. Load session data
  // -------------------------------------------------------------------------

  const sessionResult = await query(
    `SELECT * FROM lead_gen_conversations WHERE session_id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    return { success: false, error: 'Session not found' };
  }

  const session = sessionResult.rows[0];

  // Skip if already finalized
  if (session.finalized) {
    console.log(`⚠️  Session ${sessionId} already finalized at ${session.finalized_at}`);
    return { success: false, error: 'Already finalized', alreadyFinalized: true };
  }

  const prospectData = session.prospect_data || {};

  // Require company_name for finalization
  if (!prospectData.company_name) {
    console.log(`⚠️  Session ${sessionId} has no company_name — skipping finalization`);
    return { success: false, error: 'No company_name captured' };
  }

  // -------------------------------------------------------------------------
  // 2. Check if HubSpot token is available
  // -------------------------------------------------------------------------

  if (!HUBSPOT_TOKEN) {
    console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set — skipping HubSpot sync');

    // Mark as finalized in database even without HubSpot sync
    await query(
      `UPDATE lead_gen_conversations
       SET finalized = TRUE,
           finalized_at = NOW(),
           finalization_trigger = $1
       WHERE session_id = $2`,
      [trigger, sessionId]
    );

    return {
      success: true,
      message: 'Session finalized (no HubSpot token)',
      trigger
    };
  }

  // -------------------------------------------------------------------------
  // 3. Create HubSpot client
  // -------------------------------------------------------------------------

  const axios = (await import('axios')).default;
  const axiosRetry = (await import('axios-retry')).default;

  const hubspotClient = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  axiosRetry(hubspotClient, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) =>
      axiosRetry.isNetworkOrIdempotentRequestError(err) ||
      err.response?.status === 429
  });

  const results = { company: null, contact: null, note: null };

  // -------------------------------------------------------------------------
  // 4. Find or create Company
  // -------------------------------------------------------------------------

  let companyId = null;

  try {
    // Check if company already exists
    const existing = await findCompanyByName(prospectData.company_name, hubspotClient);

    if (existing) {
      companyId = existing.id;
      console.log(`✓ Found existing company: ${prospectData.company_name} (ID: ${companyId})`);

      // Update company fields
      const updates = {};
      const rev = parseRevenue(prospectData.revenue);
      if (rev !== null) updates.annualrevenue = rev;

      const emp = parseEmployeeCount(prospectData.employee_count);
      if (emp !== null) updates.numberofemployees = emp;

      if (prospectData.province) updates.state = prospectData.province;
      if (prospectData.company_description) updates.description = prospectData.company_description;
      updates.country = 'Canada';

      if (Object.keys(updates).length > 0) {
        await updateHubSpotCompany(companyId, updates);
        console.log(`✅ Updated company ${companyId}:`, Object.keys(updates).join(', '));
      }

      results.company = { action: 'updated', id: companyId };
    } else {
      // Create new company
      const companyData = {
        name: prospectData.company_name,
        lifecyclestage: 'lead',
        country: 'Canada'
      };

      if (prospectData.province) companyData.state = prospectData.province;

      const rev = parseRevenue(prospectData.revenue);
      if (rev !== null) companyData.annualrevenue = rev;

      const emp = parseEmployeeCount(prospectData.employee_count);
      if (emp !== null) companyData.numberofemployees = emp;

      if (prospectData.company_description) companyData.description = prospectData.company_description;

      const created = await createHubSpotCompany(companyData);

      if (created.success) {
        companyId = created.company.id;
        console.log(`✅ Company created: ${prospectData.company_name} (ID: ${companyId})`);
        results.company = { action: 'created', id: companyId };
      } else {
        console.warn('⚠️  Company creation failed:', created.error);
        results.company = { action: 'failed', error: created.error };
      }
    }
  } catch (err) {
    console.warn('⚠️  Company step failed:', err.message);
    results.company = { action: 'error', error: err.message };
  }

  // -------------------------------------------------------------------------
  // 5. Create Contact (if email available)
  // -------------------------------------------------------------------------

  let contactId = null;

  if (session.contact_email) {
    try {
      const existingContact = await getContactByEmail(session.contact_email);

      if (existingContact.success && existingContact.contact) {
        contactId = existingContact.contact.id;
        console.log(`✓ Found existing contact: ${session.contact_email} (ID: ${contactId})`);

        // Update hs_lead_status
        if (prospectData.lead_score) {
          const leadStatusMap = { hot: 'NEW', warm: 'OPEN', cool: 'UNQUALIFIED' };
          const hsLeadStatus = leadStatusMap[prospectData.lead_score];
          if (hsLeadStatus) {
            await updateHubSpotContact(contactId, { hs_lead_status: hsLeadStatus });
            console.log(`✅ Updated hs_lead_status → ${hsLeadStatus} for contact ${contactId}`);
          }
        }

        results.contact = { action: 'found', id: contactId };
      } else {
        // Create new contact
        const nameParts = (session.contact_name || '').trim().split(/\s+/);
        const firstname = nameParts[0] || 'Unknown';
        const lastname = nameParts.slice(1).join(' ') || undefined;

        const leadStatusMap = { hot: 'NEW', warm: 'OPEN', cool: 'UNQUALIFIED' };
        const hsLeadStatus = leadStatusMap[prospectData.lead_score] || 'NEW';

        const created = await createHubSpotContact({
          email: session.contact_email,
          firstname,
          lastname,
          state: prospectData.province || undefined,
          lifecyclestage: 'lead',
          hs_lead_status: hsLeadStatus
        });

        if (created.success) {
          contactId = created.contact.id;
          console.log(`✅ Contact created: ${session.contact_email} (ID: ${contactId})`);
          results.contact = { action: 'created', id: contactId };
        } else {
          console.warn('⚠️  Contact creation failed:', created.error);
          results.contact = { action: 'failed', error: created.error };
        }
      }

      // Associate contact with company
      if (contactId && companyId) {
        try {
          await associateContactWithCompany(contactId, companyId);
          console.log(`🔗 Contact ${contactId} associated with company ${companyId}`);
        } catch (err) {
          console.warn('⚠️  Association failed:', err.message);
        }
      }
    } catch (err) {
      console.warn('⚠️  Contact step failed:', err.message);
      results.contact = { action: 'error', error: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // 6. Create Note
  // -------------------------------------------------------------------------

  if (companyId || contactId) {
    try {
      const noteBody = buildNoteBody(session, trigger);
      const noteId = await createHubSpotNote(noteBody, contactId, companyId, hubspotClient);
      results.note = { action: 'created', id: noteId };
      console.log(`✅ Note created and associated (ID: ${noteId})`);
    } catch (err) {
      console.warn('⚠️  Note creation failed:', err.message);
      results.note = { action: 'failed', error: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // 7. Mark session as finalized
  // -------------------------------------------------------------------------

  await query(
    `UPDATE lead_gen_conversations
     SET finalized = TRUE,
         finalized_at = NOW(),
         finalization_trigger = $1
     WHERE session_id = $2`,
    [trigger, sessionId]
  );

  console.log(`✅ Session ${sessionId} finalized via ${trigger}`);

  // -------------------------------------------------------------------------
  // 8. Log analytics event
  // -------------------------------------------------------------------------

  await query(
    `INSERT INTO lead_gen_analytics (conversation_id, event_type, event_data)
     VALUES ($1, $2, $3)`,
    [
      sessionId,
      'conversation_finalized',
      JSON.stringify({
        trigger,
        has_contact: !!contactId,
        has_company: !!companyId,
        lead_score: prospectData.lead_score,
        message_count: session.message_count
      })
    ]
  ).catch(err => console.warn('⚠️  Analytics log failed:', err.message));

  return {
    success: true,
    message: `Session finalized via ${trigger}`,
    trigger,
    results
  };
}

// ============================================================================
// BACKGROUND JOB: Find and finalize inactive sessions
// ============================================================================

/**
 * Find and finalize inactive sessions (inactivity timeout trigger)
 *
 * Criteria:
 * - last_activity_at > 5 minutes ago
 * - finalized = false
 * - prospect_data contains company_name
 *
 * @param {number} inactivityMinutes - Minutes of inactivity before finalization (default: 5)
 * @param {number} batchSize - Max sessions to process per run (default: 50)
 * @returns {Object} Processing results
 */
export async function finalizeInactiveSessions(inactivityMinutes = 5, batchSize = 50) {
  console.log(`\n🔍 Searching for inactive sessions (>${inactivityMinutes} min, not finalized)...`);

  try {
    const result = await query(
      `SELECT session_id, contact_email, prospect_data, last_activity_at, message_count
       FROM lead_gen_conversations
       WHERE finalized = FALSE
         AND last_activity_at < NOW() - INTERVAL '${inactivityMinutes} minutes'
         AND prospect_data->>'company_name' IS NOT NULL
       ORDER BY last_activity_at ASC
       LIMIT $1`,
      [batchSize]
    );

    const sessions = result.rows;

    if (sessions.length === 0) {
      console.log('✓ No inactive sessions found');
      return { processed: 0, finalized: 0, errors: 0 };
    }

    console.log(`Found ${sessions.length} inactive session(s) to finalize`);

    const results = { processed: 0, finalized: 0, errors: 0 };

    for (const session of sessions) {
      results.processed++;

      try {
        const result = await finalizeLeadGenConversation(session.session_id, 'inactivity_timeout');

        if (result.success) {
          results.finalized++;
          console.log(`✅ [${results.processed}/${sessions.length}] Finalized: ${session.prospect_data?.company_name || session.session_id}`);
        } else if (result.alreadyFinalized) {
          // Skip — was finalized by another process
          console.log(`⚠️  [${results.processed}/${sessions.length}] Already finalized: ${session.session_id}`);
        } else {
          results.errors++;
          console.warn(`❌ [${results.processed}/${sessions.length}] Failed: ${session.session_id} — ${result.error}`);
        }
      } catch (err) {
        results.errors++;
        console.error(`❌ [${results.processed}/${sessions.length}] Error finalizing ${session.session_id}:`, err.message);
      }
    }

    console.log(`\n✅ Finalization complete: ${results.finalized} finalized, ${results.errors} errors, ${results.processed} total\n`);

    return results;
  } catch (err) {
    console.error('❌ Failed to query inactive sessions:', err.message);
    throw err;
  }
}
