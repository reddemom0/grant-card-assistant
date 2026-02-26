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
const ZAPIER_EMAIL_WEBHOOK_URL = process.env.ZAPIER_EMAIL_WEBHOOK_URL;

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
  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would create HubSpot note:');
    console.log(JSON.stringify({
      endpoint: '/crm/v3/objects/notes',
      method: 'POST',
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: noteBody
      },
      associations: {
        contactId: contactId || null,
        companyId: companyId || null
      }
    }, null, 2));
    console.log('');
    const testNoteId = 'TEST_NOTE_' + Date.now();
    return testNoteId;
  }

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
    lines.push(Array.isArray(matched_programs) ? matched_programs.join(', ') : matched_programs);
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

/**
 * Wrap email summary body in branded HTML template
 * @param {string} emailBodyHtml - Personalized email content (HTML) from agent
 * @param {string} firstName - Recipient's first name
 * @returns {string} Fully branded HTML email
 */
function wrapEmailInBrandedTemplate(emailBodyHtml, firstName = 'there') {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f5f7fa;
    }
    .email-container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .email-header {
      background-color: #0066cc;
      padding: 30px 40px;
      text-align: center;
    }
    .email-header img {
      max-width: 200px;
      height: auto;
    }
    .email-body {
      padding: 40px;
      color: #333333;
      line-height: 1.6;
    }
    .email-body p {
      margin: 0 0 16px 0;
    }
    .email-body a {
      color: #0066cc;
      text-decoration: none;
    }
    .email-body a:hover {
      text-decoration: underline;
    }
    .cta-button {
      display: inline-block;
      padding: 14px 28px;
      margin: 20px 0;
      background-color: #0066cc;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: bold;
      text-align: center;
    }
    .cta-button:hover {
      background-color: #0052a3;
      text-decoration: none !important;
    }
    .trust-signals {
      margin: 30px 0;
      padding: 20px;
      background-color: #f5f7fa;
      border-radius: 6px;
      text-align: center;
      font-size: 14px;
      color: #666666;
    }
    .email-footer {
      background-color: #f5f7fa;
      padding: 30px 40px;
      text-align: center;
      font-size: 13px;
      color: #666666;
      border-top: 1px solid #e0e0e0;
    }
    .email-footer a {
      color: #0066cc;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <img src="https://granted.ca/wp-content/uploads/2024/02/granted-logo-blue-300x129.png" alt="Granted Consulting" />
    </div>
    <div class="email-body">
      ${emailBodyHtml}
    </div>
    <div class="email-footer">
      <div class="trust-signals">
        🔒 Confidential &nbsp;|&nbsp; ✓ No obligation &nbsp;|&nbsp; 🇨🇦 Canadian SMEs only
      </div>
      <p>
        <strong>Granted Consulting Inc.</strong><br>
        Vancouver, BC, Canada<br>
        <a href="mailto:writers@granted.ca">writers@granted.ca</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #999999;">
        You received this email because you used the Grant Advisor chat on granted.ca.<br>
        Questions? Reply to this email or <a href="${BOOKING_LINK}">book a call</a>.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate fallback email summary when agent didn't provide one
 * @param {Object} prospectData - Prospect information from session
 * @param {string} estimatedFunding - Funding estimate range
 * @param {string} firstName - Recipient's first name
 * @returns {string} HTML email content
 */
function generateFallbackEmail(prospectData, estimatedFunding, firstName = 'there') {
  const pd = prospectData || {};
  const activities = pd.activities || pd.activities_discussed || 'business growth activities';
  const tier = determineFundingTier(estimatedFunding);
  const resourceLink = getResourceLink(tier);

  return `
<p>Hi ${firstName},</p>

<p>Thanks for chatting with me about <strong>${pd.company_name || 'your company'}</strong>'s funding opportunities!</p>

<p>Based on what you shared about ${activities}, here's what I found:</p>

<p><strong>Estimated funding potential: ${estimatedFunding || '$10-30K over 12 months'}</strong></p>

<p>This includes programs available now plus seasonal intakes opening throughout the year. The exact mix depends on timing, your province, and which intakes are open.</p>

<p>Next step: Our consultants can map out a 12-month funding plan tailored to your business — what to apply for, when, and how to maximize your chances.</p>

<p style="text-align: center;">
  <a href="${BOOKING_LINK}" class="cta-button">📅 Book Your Free Consultation</a>
</p>

<p>Looking forward to helping you access this funding!</p>

<p>Talk soon,<br>The Granted Team</p>

<p style="margin-top: 30px; font-size: 14px; color: #666;">
  <strong>Resources for you:</strong><br>
  <a href="${resourceLink}">Learn more about how Granted works</a>
</p>
  `.trim();
}

/**
 * Determine funding tier from estimate string
 */
function determineFundingTier(estimateStr) {
  if (!estimateStr) return 'medium';

  // Extract numbers (e.g., "$30K-$50K" → [30, 50])
  const matches = String(estimateStr).match(/\$?([\d,]+)([KMB]?)/gi);
  if (!matches) return 'medium';

  const amounts = matches.map(m => {
    const clean = m.replace(/[$,]/g, '');
    const multipliers = { K: 1000, M: 1000000, B: 1000000000 };
    const match = clean.match(/([\d.]+)([KMB]?)/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    return num * (multipliers[suffix] || 1);
  });

  const maxAmount = Math.max(...amounts);

  if (maxAmount >= 30000) return 'high';
  if (maxAmount >= 10000) return 'medium';
  return 'low';
}

/**
 * Get resource link based on funding tier
 */
function getResourceLink(tier) {
  const links = {
    high: 'https://granted.ca/full-service',
    medium: 'https://granted.ca/granted-starter',
    low: 'https://granted.ca/getgranted'
  };
  return links[tier] || links.medium;
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
  // 1. Load session data AND atomically claim it for finalization
  // -------------------------------------------------------------------------
  // Use UPDATE...RETURNING to atomically check and set finalized flag
  // This prevents race conditions where two processes try to finalize simultaneously

  const sessionResult = await query(
    `UPDATE lead_gen_conversations
     SET finalized = TRUE,
         finalized_at = NOW(),
         finalization_trigger = $2
     WHERE session_id = $1
       AND finalized = FALSE
     RETURNING *`,
    [sessionId, trigger]
  );

  if (sessionResult.rows.length === 0) {
    // Either session doesn't exist, or it's already finalized
    const checkResult = await query(
      `SELECT finalized, finalized_at FROM lead_gen_conversations WHERE session_id = $1`,
      [sessionId]
    );

    if (checkResult.rows.length === 0) {
      return { success: false, error: 'Session not found' };
    } else {
      console.log(`⚠️  Session ${sessionId} already finalized at ${checkResult.rows[0].finalized_at}`);
      return { success: false, error: 'Already finalized', alreadyFinalized: true };
    }
  }

  const session = sessionResult.rows[0];
  console.log(`🔒 Claimed session ${sessionId} for finalization (${trigger})`);

  const prospectData = session.prospect_data || {};

  // Merge form data as fallbacks (form data doesn't override agent-collected data)
  if (!prospectData.company_name && session.company_name) {
    prospectData.company_name = session.company_name;
  }
  if (!prospectData.contact_name && session.contact_name) {
    prospectData.contact_name = session.contact_name;
  }
  if (!prospectData.contact_email && session.contact_email) {
    prospectData.contact_email = session.contact_email;
  }
  if (!prospectData.company_website && session.company_website) {
    prospectData.company_website = session.company_website;
  }

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
        country: 'Canada',
        website: session.company_website || prospectData.company_website || null
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
  // 7. Send Email Summary via Zapier (if requested)
  // -------------------------------------------------------------------------

  if (prospectData.cta_selected && prospectData.cta_selected.includes('email')) {
    console.log('📧 Email summary requested — preparing to send via Zapier...');

    if (!session.contact_email) {
      console.warn('⚠️  Cannot send email summary — no contact_email captured');
    } else if (!ZAPIER_EMAIL_WEBHOOK_URL) {
      console.warn('⚠️  ZAPIER_EMAIL_WEBHOOK_URL not configured — skipping email send');
    } else {
      // Extract first name from contact_name
      const nameParts = (session.contact_name || 'there').trim().split(/\s+/);
      const firstName = nameParts[0] || 'there';

      // Get email summary body from agent or generate fallback
      let emailBodyHtml = prospectData.email_summary_body;

      if (!emailBodyHtml) {
        console.log('⚠️  No email_summary_body from agent — generating fallback email');
        emailBodyHtml = generateFallbackEmail(
          prospectData,
          session.estimated_funding || prospectData.estimated_funding,
          firstName
        );
      }

      // Wrap in branded HTML template
      const brandedEmailHtml = wrapEmailInBrandedTemplate(emailBodyHtml, firstName);

      // Prepare webhook payload
      const emailPayload = {
        to_email: session.contact_email,
        to_name: session.contact_name || firstName,
        company_name: prospectData.company_name || 'your company',
        subject: `Your funding estimate for ${prospectData.company_name || 'your company'}`,
        email_body: brandedEmailHtml
      };

      // Send to Zapier (fire and forget — don't block finalization)
      try {
        const webhookResponse = await hubspotClient.post(
          ZAPIER_EMAIL_WEBHOOK_URL,
          emailPayload,
          {
            baseURL: '', // Override baseURL to use full webhook URL
            timeout: 5000 // 5-second timeout
          }
        );
        console.log(`✅ Email summary sent to Zapier for ${session.contact_email}`);
        results.email = { action: 'sent', recipient: session.contact_email };
      } catch (err) {
        // Don't fail finalization if email webhook fails
        console.warn('⚠️  Zapier email webhook failed:', err.message);
        results.email = { action: 'failed', error: err.message };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. Log analytics event
  // -------------------------------------------------------------------------
  // Note: Session was already marked as finalized atomically at the start

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
