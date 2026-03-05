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
  determineServiceTier,
  loadEnrichedSessionData
} from './lead-gen-helpers.js';
import {
  createHubSpotCompany,
  createHubSpotContact,
  updateHubSpotCompany,
  updateHubSpotContact,
  associateContactWithCompany,
  getContactByEmail
} from '../tools/hubspot.js';
import { sendEmail, wrapInBrandedTemplate } from '../email/sendEmail.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BOOKING_LINK = 'https://meetings.hubspot.com/natalie392/15min-intro-to-granted';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert markdown formatting to HTML (safety net)
 * Handles bold, links, and basic formatting that the model might output
 */
function convertMarkdownToHtml(text) {
  if (!text) return text;

  return text
    // Bold: **text** → <strong>text</strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Links: [text](url) → <a href="url">text</a>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

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
 * Update existing HubSpot Note with new content
 * @param {string} noteId - HubSpot note ID to update
 * @param {string} noteBody - New note body content
 * @param {Object} hubspotClient - Axios instance with HubSpot auth
 * @returns {string} Note ID
 */
async function updateHubSpotNote(noteId, noteBody, hubspotClient) {
  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would update HubSpot note:');
    console.log(JSON.stringify({
      endpoint: `/crm/v3/objects/notes/${noteId}`,
      method: 'PATCH',
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: noteBody
      }
    }, null, 2));
    console.log('');
    return noteId;
  }

  // 🔍 DEBUG: Log the PATCH request details
  const endpoint = `/crm/v3/objects/notes/${noteId}`;
  const payload = {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: noteBody
    }
  };

  console.log(`\n🔍 DEBUG: HubSpot note PATCH request`);
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Note ID: ${noteId}`);
  console.log(`  Property name: hs_note_body`);
  console.log(`  Note body length: ${noteBody.length} chars`);
  console.log(`  Note body preview (first 200 chars): ${noteBody.substring(0, 200)}...`);

  try {
    const response = await hubspotClient.patch(endpoint, payload);

    // 🔍 DEBUG: Log the full response
    console.log(`\n🔍 DEBUG: HubSpot note PATCH response`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Response data:`, JSON.stringify(response.data, null, 2));

    console.log(`✏️ HubSpot note updated: ${noteId}`);
    return noteId;
  } catch (err) {
    console.error(`\n❌ HubSpot note PATCH failed:`);
    console.error(`  Error message: ${err.message}`);
    console.error(`  Response status: ${err.response?.status}`);
    console.error(`  Response data:`, JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

/**
 * Build HubSpot note body for finalized conversation
 * @deprecated Use buildNoteBodyComprehensive instead
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
  if (estimated_funding || sessionData.available_now_funding) {
    if (sessionData.available_now_funding && sessionData.available_now_funding !== estimated_funding) {
      // Show two-tier funding (NOW vs 12 MONTHS)
      lines.push(`Funding available NOW: ${sessionData.available_now_funding}`);
      lines.push(`Estimated funding potential (12 months): ${estimated_funding || 'TBD'}`);
    } else {
      // Show single funding estimate
      lines.push(`Estimated funding potential: ${estimated_funding}`);
    }

    if (sessionData.programs_matched_count) {
      lines.push(`Programs matched: ${sessionData.programs_matched_count} programs`);
    }

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
 * Build comprehensive HubSpot note body with ALL data sources
 *
 * This function assembles a complete prospect profile from multiple data sources:
 * 1. Pre-chat form (page 1 + page 2)
 * 2. Haiku company extraction (company_background)
 * 3. Phase 1 estimate delivery (memory_store)
 * 4. Phase 2 conversation enrichment (memory_store)
 * 5. Agent analysis (lead_score, prospect_summary, service tier)
 *
 * @param {Object} sessionData - Session record with all data
 * @param {string} trigger - 'estimate_delivered' | 'contact_captured' | 'inactivity_timeout'
 * @param {string} serviceTier - 'pro' | 'starter' | 'getgranted' | null
 * @returns {string} Plain text note body
 */
function buildNoteBodyComprehensive(sessionData, trigger, serviceTier = null) {
  const {
    prospect_data,
    company_background,
    matched_programs,
    estimated_funding,
    available_now_funding,
    programs_matched_count,
    cta_selected,
    message_count,
    contact_name,
    contact_email,
    company_website
  } = sessionData;

  const pd = prospect_data || {};
  const bg = company_background ? (typeof company_background === 'string' ? JSON.parse(company_background) : company_background) : {};

  const lines = ['=== Grant Advisor Chat — Lead Summary ===', ''];

  // =========================================================================
  // TRIGGER-SPECIFIC HEADER
  // =========================================================================

  if (trigger === 'inactivity_timeout') {
    lines.push(`⚠️ No contact info captured — visitor abandoned chat after ${message_count} exchanges`);
    lines.push('This record was auto-created to preserve conversation data.');
    lines.push('');
  } else if (trigger === 'estimate_delivered') {
    lines.push('📊 INITIAL ESTIMATE — Captured after Phase 1 (estimate delivery)');
    lines.push('Additional qualification data may be captured in Phase 2.');
    lines.push('');
  }

  // =========================================================================
  // PROSPECT SUMMARY (if agent provided one)
  // =========================================================================

  // Check both top-level and prospect_data
  const prospectSummary = sessionData.prospect_summary || pd.prospect_summary;
  if (prospectSummary) {
    lines.push(prospectSummary);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // =========================================================================
  // CONTACT & COMPANY INFO
  // =========================================================================

  if (contact_name || contact_email) {
    const contactLine = contact_name && contact_email
      ? `Contact: ${contact_name} <${contact_email}>`
      : contact_name
        ? `Contact: ${contact_name}`
        : `Email: ${contact_email}`;
    lines.push(contactLine);
  }

  if (pd.company_name) {
    const companyLine = company_website
      ? `Company: ${pd.company_name} (${company_website})`
      : `Company: ${pd.company_name}`;
    lines.push(companyLine);
  }

  // Province (always from form)
  if (pd.province) {
    lines.push(`Province: ${pd.province}`);
  }

  // Industry (Haiku extraction preferred, form fallback)
  const industry = bg.industry || pd.industry;
  if (industry) {
    const source = bg.industry ? 'extracted from website' : 'form-provided';
    lines.push(`Industry: ${industry} (${source})`);
  }

  // Location (from Haiku extraction)
  if (bg.location) {
    lines.push(`Location: ${bg.location}`);
  }

  // Revenue & Employees (from form)
  if (pd.revenue_range || pd.revenue) {
    lines.push(`Revenue: ${pd.revenue_range || pd.revenue}`);
  }
  if (pd.employee_count) {
    lines.push(`Employees: ${pd.employee_count}`);
  }

  // Company description (Haiku extraction preferred, agent fallback)
  const companyDesc = bg.description || pd.company_description;
  if (companyDesc) {
    const source = bg.description ? 'extracted from website' : 'agent-collected';
    lines.push(`About: ${companyDesc} (${source})`);
  }

  // Products/Services (from Haiku extraction)
  if (bg.products_services) {
    lines.push(`Products/Services: ${bg.products_services}`);
  }

  // Team size estimate (from Haiku extraction)
  if (bg.estimated_team_size) {
    lines.push(`Estimated Team Size: ${bg.estimated_team_size} (from website)`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // =========================================================================
  // ACTIVITIES & PLANS (from form + conversation)
  // =========================================================================

  lines.push('Activities & Plans:');
  lines.push('');

  if (pd.hiring_plans) {
    lines.push(`Hiring: ${pd.hiring_plans}`);
  }

  if (pd.training_budget) {
    lines.push(`Training Budget: ${pd.training_budget}`);
  }

  if (pd.expansion_budget) {
    lines.push(`Market Expansion Budget: ${pd.expansion_budget}`);
  }

  // Activities discussed during conversation (from agent analysis)
  if (pd.activities_discussed || pd.activities) {
    const activities = pd.activities_discussed || pd.activities;
    lines.push(`Activities Discussed: ${activities}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // =========================================================================
  // FUNDING ESTIMATE
  // =========================================================================

  if (estimated_funding || available_now_funding) {
    lines.push('💰 Funding Estimate:');
    lines.push('');

    if (available_now_funding && available_now_funding !== estimated_funding) {
      // Two-tier funding (NOW vs 12 MONTHS)
      lines.push(`Available NOW: ${available_now_funding}`);
      lines.push(`12-Month Potential: ${estimated_funding || 'TBD'}`);
    } else {
      // Single funding estimate
      lines.push(`Estimated Potential: ${estimated_funding}`);
    }

    if (programs_matched_count) {
      lines.push(`Programs Matched: ${programs_matched_count} programs`);
    }

    lines.push('');
  }

  // Programs matched (with actual program names)
  // Check prospect_data first (may have better data from memory_store), then top-level
  const matchedProgramsData = pd.matched_programs || matched_programs;
  if (matchedProgramsData && matchedProgramsData.length > 0) {
    lines.push('Programs Matched:');

    // If it's an array, format one per line
    if (Array.isArray(matchedProgramsData)) {
      matchedProgramsData.forEach(program => {
        lines.push(`  • ${program}`);
      });
    } else {
      // If it's a string (shouldn't be, but handle it)
      lines.push(matchedProgramsData);
    }

    lines.push('');
  }

  // Service tier recommendation
  // Check if agent stored a recommended tier (overrides computed value)
  const agentRecommendedTier = sessionData.service_tier_recommended || pd.service_tier_recommended;
  const finalServiceTier = agentRecommendedTier || serviceTier;

  if (agentRecommendedTier && serviceTier && agentRecommendedTier !== serviceTier) {
    console.log(`✅ Using agent-recommended tier: ${agentRecommendedTier} (computed was: ${serviceTier})`);
  }

  if (finalServiceTier) {
    const tierLabels = {
      pro: 'GrantedPro ($30K+)',
      starter: 'Granted Starter ($15K-$29,999)',
      getgranted: 'GetGranted (under $15K)'
    };
    lines.push(`Service Tier Recommended: ${tierLabels[finalServiceTier] || finalServiceTier}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // =========================================================================
  // QUALIFICATION SIGNALS
  // =========================================================================

  lines.push('🎯 Qualification Signals:');
  lines.push('');

  // Timeline (check top-level first, then prospect_data)
  const timeline = sessionData.timeline || pd.timeline || 'Not discussed';
  lines.push(`Timeline: ${timeline}`);

  // Budget (check both locations, handle boolean values)
  const budgetCommitted = sessionData.budget_committed !== undefined ? sessionData.budget_committed : pd.budget_committed;
  const budgetValue = budgetCommitted !== undefined
    ? (budgetCommitted === true ? 'Allocated' : budgetCommitted === false ? 'Exploring' : budgetCommitted)
    : 'Not discussed';
  lines.push(`Budget: ${budgetValue}`);

  // Decision maker (check both locations, handle boolean values)
  const isDecisionMaker = sessionData.is_decision_maker !== undefined ? sessionData.is_decision_maker : pd.is_decision_maker;
  const dmValue = isDecisionMaker !== undefined
    ? (isDecisionMaker === true ? 'Yes' : isDecisionMaker === false ? 'No' : isDecisionMaker)
    : 'Not discussed';
  lines.push(`Decision Maker: ${dmValue}`);

  // Grant experience (check both locations)
  const priorGrantExperience = sessionData.prior_grant_experience || pd.prior_grant_experience || 'Not discussed';
  lines.push(`Grant Experience: ${priorGrantExperience}`);

  // Existing consultant (check both locations)
  const existingConsultant = sessionData.existing_consultant || pd.existing_consultant || 'Not discussed';
  lines.push(`Existing Consultant: ${existingConsultant}`);

  // Growth plans (check both locations)
  const growthPlans = sessionData.growth_plans || pd.growth_plans || 'Not discussed';
  lines.push(`Growth Plans: ${growthPlans}`);

  lines.push('');

  // Lead score & status (check both locations)
  const leadScore = sessionData.lead_score || pd.lead_score;
  if (leadScore) {
    const scoreLabels = {
      hot: 'HOT (ready to close)',
      warm: 'WARM (promising)',
      cool: 'COOL (early stage)'
    };
    const scoreLabel = scoreLabels[leadScore] || leadScore;
    lines.push(`Lead Score: ${scoreLabel}`);
  }

  const hsLeadStatus = sessionData.hs_lead_status || pd.hs_lead_status;
  if (hsLeadStatus) {
    lines.push(`Lead Status: ${hsLeadStatus}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // =========================================================================
  // CONVERSATION METADATA
  // =========================================================================

  if (cta_selected) {
    const ctaLabels = {
      book_call: 'Book a strategy call',
      email_summary: 'Email summary requested',
      resources: 'Resources requested',
      none: 'No CTA taken'
    };
    lines.push(`CTA Selected: ${ctaLabels[cta_selected] || cta_selected}`);
  }

  lines.push(`Conversation Length: ${message_count} messages`);
  lines.push('');

  // =========================================================================
  // BOOKING LINK (tier-based)
  // =========================================================================

  // Only include booking link for Starter ($15K+) and Pro ($30K+) tiers
  // Exclude for GetGranted (under $15K)
  // Use finalServiceTier (agent-recommended if available, otherwise computed)
  const bookingTier = agentRecommendedTier || serviceTier;
  if (bookingTier && bookingTier !== 'getgranted') {
    lines.push('---');
    lines.push(`📅 Booking Link: https://meetings.hubspot.com/natalie392/15min-intro-to-granted`);
  }

  return lines.join('\n');
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
  const companyName = pd.company_name || 'your company';
  const activities = pd.activities || pd.activities_discussed || 'your growth plans';
  const tier = determineFundingTier(estimatedFunding);

  // Parse funding estimate for "now" vs "12 months" if available
  const fundingNow = pd.available_now_funding || null;
  const funding12Mo = estimatedFunding || pd.estimated_funding || '$10-30K';

  // Build funding summary
  let fundingSummary = '';
  if (fundingNow && fundingNow !== funding12Mo) {
    fundingSummary = `Right now, you're looking at an estimated <strong>${fundingNow}</strong> across programs currently accepting applications. Over the next 12 months, as more programs open seasonal intakes, that grows to an estimated <strong>${funding12Mo}</strong>.`;
  } else {
    fundingSummary = `Based on what you shared, you're looking at an estimated <strong>${funding12Mo}</strong> over the next 12 months across multiple programs.`;
  }

  // Build tier-specific email content
  let tierContent = '';
  let bookingCTA = '';

  if (tier === 'high') {
    // $30K+ → GrantedPro
    tierContent = `
<p>With this level of funding potential across multiple programs, having a dedicated grant team handle the applications, timing, and claims makes a real difference. Our GrantedPro service includes a dedicated Grant Strategist, unlimited applications, complete claims management, and a 93% approval rate.</p>

<p><a href="https://granted.ca/grantedpro/" style="color: #0066cc; font-weight: bold;">Learn more about GrantedPro</a></p>
    `;
    bookingCTA = `
<p>Book a free 15-minute call and we'll map out the exact programs, timing, and application strategy for your business:</p>

<p style="text-align: center;">
  <a href="${BOOKING_LINK}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book Your Free Consultation</a>
</p>
    `;
  } else if (tier === 'medium') {
    // $10-29K → Granted Starter (PRIMARY), GetGranted 2.0 (SECONDARY)
    tierContent = `
<p>For your situation, Granted Starter is a great fit — you get expert guidance on your applications without full-service overhead. Our team reviews your applications, provides feedback, and helps you maximize your approval chances.</p>

<p><a href="https://granted.ca/granted-starter/" style="color: #0066cc; font-weight: bold;">Learn more about Granted Starter</a></p>

<p>We're also launching an upgraded platform soon (GetGranted 2.0) with smart matching and step-by-step guidance. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
    `;
    bookingCTA = `
<p>If you'd prefer to talk through your options with someone on our team first, you can book a quick call:</p>

<p style="text-align: center;">
  <a href="${BOOKING_LINK}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>
    `;
  } else {
    // Under $10K → GetGranted database (PRIMARY), GetGranted 2.0 Lite (SECONDARY)
    tierContent = `
<p>Our GetGranted database is a great starting point — you get access to Canada's largest grant database with smart filtering tailored to your business.</p>

<p><a href="https://granted.ca/getgranted/" style="color: #0066cc; font-weight: bold;">Access the GetGranted database</a></p>

<p>We're also launching an upgraded version (GetGranted 2.0 Lite) with real-time matching and alerts for $55/month. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
    `;
    bookingCTA = `
<p>Have questions or want a second opinion? You can always book a free call with our team:</p>

<p style="text-align: center;">
  <a href="${BOOKING_LINK}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>
    `;
  }

  return `
<p>Hi ${firstName},</p>

<p>It was great chatting about ${companyName}. We talked about ${activities}, and I pulled together what grant funding could be available for you.</p>

<p>${fundingSummary}</p>

<p>This includes hiring support, training reimbursements, and market expansion funding — the exact mix depends on timing, your province, and which intakes are open.</p>

${tierContent}

${bookingCTA}

<p>Talk soon,<br>The Granted Team</p>
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
 * STAGE 1: Create HubSpot record when estimate is delivered
 *
 * Called when agent stores estimated_funding in memory_store.
 * Creates Company + Note with all available data at that point.
 *
 * @param {string} sessionId - Session ID
 * @returns {Object} Creation result { success, companyId, contactId, alreadyExists }
 */
export async function createHubSpotRecordOnEstimate(sessionId) {
  console.log(`\n📊 STAGE 1: Creating HubSpot record on estimate delivery for ${sessionId}`);

  // -------------------------------------------------------------------------
  // 1. Load session data
  // -------------------------------------------------------------------------

  const sessionResult = await query(
    `SELECT *, prospect_data->>'hubspot_company_id' as hubspot_company_id
     FROM lead_gen_conversations
     WHERE session_id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    return { success: false, error: 'Session not found' };
  }

  const session = sessionResult.rows[0];
  const prospectData = session.prospect_data || {};

  // Check if HubSpot record already exists
  if (prospectData.hubspot_company_id) {
    console.log(`ℹ️  HubSpot record already exists (Company ID: ${prospectData.hubspot_company_id})`);
    return { success: false, alreadyExists: true, companyId: prospectData.hubspot_company_id };
  }

  // Require company_name for creation
  if (!prospectData.company_name && !session.company_name) {
    console.log(`⚠️  No company_name available — skipping HubSpot creation`);
    return { success: false, error: 'No company_name captured' };
  }

  const companyName = prospectData.company_name || session.company_name;

  // -------------------------------------------------------------------------
  // 2. Check HubSpot token
  // -------------------------------------------------------------------------

  if (!HUBSPOT_TOKEN) {
    console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set — skipping HubSpot creation');
    return { success: false, error: 'No HubSpot token' };
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

  let companyId = null;
  let contactId = null;

  // -------------------------------------------------------------------------
  // 4. Find or create Company
  // -------------------------------------------------------------------------

  try {
    const existing = await findCompanyByName(companyName, hubspotClient);

    if (existing) {
      companyId = existing.id;
      console.log(`✓ Found existing company: ${companyName} (ID: ${companyId})`);

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
    } else {
      // Create new company
      const companyData = {
        name: companyName,
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
        console.log(`✅ Company created: ${companyName} (ID: ${companyId})`);
      } else {
        console.warn('⚠️  Company creation failed:', created.error);
        return { success: false, error: created.error };
      }
    }
  } catch (err) {
    console.warn('⚠️  Company step failed:', err.message);
    return { success: false, error: err.message };
  }

  // -------------------------------------------------------------------------
  // 5. Create Contact (if email available)
  // -------------------------------------------------------------------------

  if (session.contact_email) {
    try {
      const existingContact = await getContactByEmail(session.contact_email);

      if (existingContact.success && existingContact.contact) {
        contactId = existingContact.contact.id;
        console.log(`✓ Found existing contact: ${session.contact_email} (ID: ${contactId})`);

        // Update hs_lead_status if we have a lead score
        if (prospectData.lead_score) {
          const leadStatusMap = { hot: 'NEW', warm: 'OPEN', cool: 'UNQUALIFIED' };
          const hsLeadStatus = leadStatusMap[prospectData.lead_score];
          if (hsLeadStatus) {
            await updateHubSpotContact(contactId, { hs_lead_status: hsLeadStatus });
            console.log(`✅ Updated hs_lead_status → ${hsLeadStatus}`);
          }
        }
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
        } else {
          console.warn('⚠️  Contact creation failed:', created.error);
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
    }
  }

  // -------------------------------------------------------------------------
  // 6. Load enriched data and create comprehensive Note
  // -------------------------------------------------------------------------

  let noteId = null;

  if (companyId || contactId) {
    try {
      // Load enriched session data (session + memory_store + company_background)
      const enrichedSession = await loadEnrichedSessionData(sessionId);

      // 🔍 DEBUG: Log Stage 1 data
      console.log('\n🔍 DEBUG (STAGE 1): EnrichedSession keys:', Object.keys(enrichedSession).join(', '));
      const pd1 = enrichedSession.prospect_data || {};
      console.log('🔍 DEBUG (STAGE 1): prospect_data keys:', Object.keys(pd1).join(', '));
      console.log('🔍 DEBUG (STAGE 1): matched_programs (top-level):', JSON.stringify(enrichedSession.matched_programs)?.substring(0, 100));
      console.log('🔍 DEBUG (STAGE 1): timeline (prospect_data):', pd1.timeline);
      console.log('🔍 DEBUG (STAGE 1): prospect_summary (prospect_data):', pd1.prospect_summary);

      // Determine service tier from funding estimate
      const serviceTier = determineServiceTier(enrichedSession.estimated_funding);

      // Build comprehensive note with ALL data sources
      const noteBody = buildNoteBodyComprehensive(enrichedSession, 'estimate_delivered', serviceTier);

      // 🔍 DEBUG: Log Stage 1 note body preview
      console.log('\n🔍 DEBUG (STAGE 1): Note body (first 500 chars):');
      console.log(noteBody.substring(0, 500));
      console.log('...\n');

      // Create HubSpot note
      noteId = await createHubSpotNote(noteBody, contactId, companyId, hubspotClient);
      console.log(`✅ Stage 1 note created (ID: ${noteId})`);
    } catch (err) {
      console.warn('⚠️  Note creation failed:', err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Store HubSpot IDs in database
  // -------------------------------------------------------------------------

  try {
    await query(
      `UPDATE lead_gen_conversations
       SET prospect_data = prospect_data || $1::jsonb,
           updated_at = NOW()
       WHERE session_id = $2`,
      [JSON.stringify({
        hubspot_company_id: companyId,
        hubspot_contact_id: contactId,
        hubspot_note_id: noteId,
        hubspot_created_at: new Date().toISOString()
      }), sessionId]
    );

    console.log(`✅ Stored HubSpot IDs in database (Company: ${companyId}, Contact: ${contactId}, Note: ${noteId})`);
  } catch (err) {
    console.warn(`⚠️  Failed to store HubSpot IDs:`, err.message);
  }

  return {
    success: true,
    companyId,
    contactId,
    noteId,
    message: 'HubSpot record created on estimate delivery'
  };
}

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
  // 4. Check if HubSpot record was already created (Stage 1)
  // -------------------------------------------------------------------------

  let companyId = prospectData.hubspot_company_id || null;
  let contactId = prospectData.hubspot_contact_id || null;

  if (companyId) {
    console.log(`✓ STAGE 2: HubSpot record already exists (Company ID: ${companyId}) — will update note only`);
    results.company = { action: 'already_exists', id: companyId };

    // Verify company still exists in HubSpot
    try {
      const existing = await findCompanyByName(prospectData.company_name, hubspotClient);
      if (existing && existing.id === companyId) {
        console.log(`✓ Confirmed company ${companyId} exists in HubSpot`);

        // Update company with any new information from save_lead_data
        const updates = {};
        const rev = parseRevenue(prospectData.revenue);
        if (rev !== null) updates.annualrevenue = rev;

        const emp = parseEmployeeCount(prospectData.employee_count);
        if (emp !== null) updates.numberofemployees = emp;

        if (prospectData.province) updates.state = prospectData.province;
        if (prospectData.company_description) updates.description = prospectData.company_description;

        if (Object.keys(updates).length > 0) {
          await updateHubSpotCompany(companyId, updates);
          console.log(`✅ Updated company ${companyId} with new information`);
        }
      } else {
        console.warn(`⚠️  Company ${companyId} not found in HubSpot — will create new record`);
        companyId = null; // Force re-creation
      }
    } catch (err) {
      console.warn(`⚠️  Error verifying company:`, err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Find or create Company (if not already created in Stage 1)
  // -------------------------------------------------------------------------

  if (!companyId) {
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
  }

  // -------------------------------------------------------------------------
  // 6. Create or update Contact (if email available)
  // -------------------------------------------------------------------------

  if (session.contact_email && !contactId) {
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
  // 6. Update or Create Comprehensive Note
  // -------------------------------------------------------------------------

  if (companyId || contactId) {
    try {
      // Load enriched session data (session + memory_store + company_background)
      const enrichedSession = await loadEnrichedSessionData(sessionId);

      // 🔍 DEBUG: Log enriched session structure
      console.log('\n🔍 DEBUG: EnrichedSession keys:', Object.keys(enrichedSession).join(', '));
      console.log('🔍 DEBUG: prospect_data keys:', Object.keys(enrichedSession.prospect_data || {}).join(', '));

      // 🔍 DEBUG: Log qualification signals
      const pd = enrichedSession.prospect_data || {};
      console.log('\n🔍 DEBUG: Qualification signals in enrichedSession:');
      console.log(`  matched_programs (top-level): ${JSON.stringify(enrichedSession.matched_programs)?.substring(0, 100)}`);
      console.log(`  matched_programs (prospect_data): ${JSON.stringify(pd.matched_programs)?.substring(0, 100)}`);
      console.log(`  timeline (top-level): ${enrichedSession.timeline}`);
      console.log(`  timeline (prospect_data): ${pd.timeline}`);
      console.log(`  budget_committed (top-level): ${enrichedSession.budget_committed}`);
      console.log(`  budget_committed (prospect_data): ${pd.budget_committed}`);
      console.log(`  is_decision_maker (top-level): ${enrichedSession.is_decision_maker}`);
      console.log(`  is_decision_maker (prospect_data): ${pd.is_decision_maker}`);
      console.log(`  prior_grant_experience (top-level): ${enrichedSession.prior_grant_experience}`);
      console.log(`  prior_grant_experience (prospect_data): ${pd.prior_grant_experience}`);
      console.log(`  existing_consultant (top-level): ${enrichedSession.existing_consultant}`);
      console.log(`  existing_consultant (prospect_data): ${pd.existing_consultant}`);
      console.log(`  growth_plans (top-level): ${enrichedSession.growth_plans}`);
      console.log(`  growth_plans (prospect_data): ${pd.growth_plans}`);
      console.log(`  prospect_summary (top-level): ${enrichedSession.prospect_summary}`);
      console.log(`  prospect_summary (prospect_data): ${pd.prospect_summary}`);

      // Determine service tier from funding estimate
      const serviceTier = determineServiceTier(
        enrichedSession.estimated_funding || enrichedSession.prospect_data?.estimated_funding
      );

      // Build comprehensive note with ALL data sources
      const noteBody = buildNoteBodyComprehensive(enrichedSession, trigger, serviceTier);

      // 🔍 DEBUG: Log note body preview
      console.log('\n🔍 DEBUG: Note body (first 500 chars):');
      console.log(noteBody.substring(0, 500));
      console.log('...\n');

      // Check if Stage 1 note already exists
      const existingNoteId = prospectData.hubspot_note_id;

      if (existingNoteId) {
        // UPDATE existing note (Stage 1 → Stage 2 enrichment)
        try {
          await updateHubSpotNote(existingNoteId, noteBody, hubspotClient);
          results.note = { action: 'updated', id: existingNoteId };
          console.log(`✅ Stage 2: Updated existing note (ID: ${existingNoteId}) with enriched data`);
        } catch (updateErr) {
          // Fallback: If update fails (note was deleted?), create new note
          console.warn(`⚠️  Note update failed (${updateErr.message}), creating new note as fallback`);
          const newNoteId = await createHubSpotNote(noteBody, contactId, companyId, hubspotClient);
          results.note = { action: 'created_fallback', id: newNoteId };
          console.log(`✅ Stage 2: Created new note as fallback (ID: ${newNoteId})`);
        }
      } else {
        // CREATE new note (Stage 1 didn't happen, or note creation failed)
        const newNoteId = await createHubSpotNote(noteBody, contactId, companyId, hubspotClient);
        results.note = { action: 'created', id: newNoteId };
        console.log(`✅ Stage 2: Created comprehensive note (ID: ${newNoteId})`);
      }
    } catch (err) {
      console.warn('⚠️  Note creation/update failed:', err.message);
      results.note = { action: 'failed', error: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // 7. Send Email Summary via Nodemailer (if requested)
  // -------------------------------------------------------------------------

  console.log(`📧 Checking email CTA — cta_selected: "${prospectData.cta_selected}", has_contact_email: ${!!session.contact_email}`);

  if (prospectData.cta_selected && prospectData.cta_selected.includes('email')) {
    console.log('📧 Email summary requested — preparing to send via Nodemailer...');

    if (!session.contact_email) {
      console.warn('⚠️  Cannot send email summary — no contact_email captured');
      results.email = { action: 'skipped', reason: 'no_contact_email' };
    } else {
      console.log(`📧 Preparing email for ${session.contact_email}...`);

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
      } else {
        console.log(`📧 Using agent-generated email_summary_body (${emailBodyHtml.length} chars)`);

        // Debug: Check if agent included full HTML document tags (which would break template)
        if (emailBodyHtml.includes('<html') || emailBodyHtml.includes('<!DOCTYPE')) {
          console.warn(`⚠️  email_summary_body contains <html> or <!DOCTYPE> tags — stripping them`);
          console.warn(`⚠️  First 200 chars: ${emailBodyHtml.substring(0, 200)}`);

          // Strip outer HTML document structure, keep only body content
          emailBodyHtml = emailBodyHtml
            .replace(/<!DOCTYPE[^>]*>/gi, '')
            .replace(/<html[^>]*>/gi, '')
            .replace(/<\/html>/gi, '')
            .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
            .replace(/<body[^>]*>/gi, '')
            .replace(/<\/body>/gi, '')
            .trim();

          console.log(`✅ Stripped outer tags — new length: ${emailBodyHtml.length} chars`);
        }
      }

      // Convert markdown to HTML (safety net for email formatting)
      const originalLength = emailBodyHtml.length;
      emailBodyHtml = convertMarkdownToHtml(emailBodyHtml);
      if (emailBodyHtml.length !== originalLength) {
        console.log(`  🎨 Converted markdown to HTML in email body (safety net)`);
      }

      // Validate and fix booking link if agent hallucinated wrong URL
      const wrongBookingLinkRegex = /https:\/\/meetings\.hubspot\.com\/[^\s"'<>]+/g;
      const matches = emailBodyHtml.match(wrongBookingLinkRegex);
      if (matches && matches.some(link => link !== BOOKING_LINK)) {
        console.log(`⚠️  Found incorrect booking link in email, replacing with correct one: ${BOOKING_LINK}`);
        emailBodyHtml = emailBodyHtml.replace(wrongBookingLinkRegex, BOOKING_LINK);
      }

      // Wrap in branded HTML template
      const brandedEmailHtml = wrapInBrandedTemplate(emailBodyHtml);
      console.log(`📧 Email template wrapped (total ${brandedEmailHtml.length} chars)`);
      console.log(`📧 First 300 chars of wrapped email: ${brandedEmailHtml.substring(0, 300)}...`);

      // Send via Nodemailer (blocking with full error capture)
      // Changed from setImmediate to blocking call to capture errors
      try {
        console.log(`📧 Calling sendEmail for ${session.contact_email}...`);
        const emailResult = await sendEmail({
          to: session.contact_email,
          toName: session.contact_name || firstName,
          subject: `Your funding estimate for ${prospectData.company_name || 'your company'}`,
          htmlBody: brandedEmailHtml
        });
        console.log(`✅ Email summary sent to ${session.contact_email} for session ${sessionId} — Message ID: ${emailResult.messageId}`);
        results.email = { action: 'sent', recipient: session.contact_email, messageId: emailResult.messageId };
      } catch (err) {
        // Don't fail finalization if email send fails, but log the full error
        console.error(`❌ Email send FAILED for ${session.contact_email}:`, err.message);
        console.error(`❌ Error code: ${err.code}, command: ${err.command}, response: ${err.response}`);
        console.error(`❌ Full error object:`, JSON.stringify(err, null, 2));
        results.email = { action: 'failed', recipient: session.contact_email, error: err.message };
      }
    }
  } else {
    console.log(`ℹ️  Email summary NOT requested — skipping email send`);
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
         AND message_count >= 3
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
