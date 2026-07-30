/**
 * Lead-Gen Conversation Finalization
 *
 * Single trigger paths into HubSpot (since Phase 2 / 2026-05-04):
 * - Trigger A: Contact info captured (save_lead_data tool) — primary path
 * - Trigger B: Inactivity timeout (5 min, no messages) + has company_name — safety net
 *
 * Both triggers submit to HubSpot's Forms API (so submissions land in the same
 * "Grant Calculator Oct 2025" reporting bucket as legacy form submissions),
 * then PATCH AI-specific Contact properties, then create a Note. Direct CRM v3
 * Contact + Company creation is NO LONGER used — HubSpot creates those records
 * itself in response to the form submission.
 */

import { query } from '../database/connection.js';
import {
  determineServiceTier,
  loadEnrichedSessionData,
  computeBestFitProduct
} from './lead-gen-helpers.js';
import {
  submitLeadGenForm,
  findContactByEmailWithRetry,
  patchAIContactProperties
} from './hubspot-form-submission.js';
import { sendEmail, wrapInBrandedTemplate } from '../email/sendEmail.js';
import { notifyTeamOfLead, notifyTeamOfUpgrade } from '../services/lead-notification.js';
import { getBookingLink, NATALIE_INTRO_LINK, substituteBookingLink, BookingLinkRoutingError } from './booking-link-routing.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

/**
 * Build the retrying axios client for the HubSpot CRM API. Shared by
 * finalizeLeadGenConversation and the upgrade-send side effects in
 * sendLeadGenEmail so both paths get identical retry behavior.
 */
async function createHubSpotClient() {
  const axios = (await import('axios')).default;
  const axiosRetry = (await import('axios-retry')).default;

  const client = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) =>
      axiosRetry.isNetworkOrIdempotentRequestError(err) ||
      err.response?.status === 429
  });

  return client;
}

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
  // (buildNoteBody is dead — only buildNoteBodyComprehensive is wired up.
  // Constant rename for parse-safety; no routing logic here.)
  lines.push('---');
  lines.push(`Booking link: ${NATALIE_INTRO_LINK}`);

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

  // Planned activities from form + agent assessment
  const plannedActivities = sessionData.planned_activities || pd.planned_activities;
  const activityAssessment = sessionData.activity_assessment || pd.activity_assessment;
  const activityClarification = sessionData.activity_clarification || pd.activity_clarification;

  if (plannedActivities) {
    lines.push('');
    lines.push('📋 Planned Activities (from form):');
    lines.push(plannedActivities);
    if (activityAssessment) {
      lines.push(`Agent Assessment: ${activityAssessment}`);
    }
    if (activityClarification) {
      lines.push(`Clarification Q&A: ${activityClarification}`);
    }
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

  // =========================================================================
  // CATEGORIZATION (from infrastructure-enhanced search)
  // =========================================================================

  // Load categorization data from conversation_memory (if available)
  const categorizationData = pd.categorization
    ? (typeof pd.categorization === 'string' ? JSON.parse(pd.categorization) : pd.categorization)
    : null;

  const mergedEstimateData = pd.merged_estimate
    ? (typeof pd.merged_estimate === 'string' ? JSON.parse(pd.merged_estimate) : pd.merged_estimate)
    : null;

  if (categorizationData || mergedEstimateData) {
    lines.push('🏗️ Infrastructure Analysis:');
    lines.push('');

    if (categorizationData) {
      // Industry Group
      if (categorizationData.industry_group_label) {
        lines.push(`Industry Group: ${categorizationData.industry_group_label} (Group ${categorizationData.industry_group})`);
      }

      // Baseline Estimate
      if (categorizationData.baseline_estimate) {
        const baseline = categorizationData.baseline_estimate;
        const totalLow = Math.round(baseline.total_low / 1000);
        const totalHigh = Math.round(baseline.total_high / 1000);
        lines.push(`Baseline Estimate: $${totalLow}K–$${totalHigh}K (from rate tables)`);
      }

      // Service Tier
      if (categorizationData.service_tier) {
        const tierDisplay = categorizationData.service_tier.toUpperCase().replace('_', ' ');
        const reasoning = categorizationData.tier_reasoning || '';
        lines.push(`Service Tier: ${tierDisplay} (${reasoning})`);
      }

      // Consultant Assignment
      // (Note: booking link is rendered below in the BOOKING LINK block via
      // getBookingLink() — best_fit_product-driven, not tier-driven. This
      // section retains only the consultant name for sales-prep context.)
      if (categorizationData.consultant_assignment) {
        const consultant = categorizationData.consultant_assignment;
        lines.push(`Assigned Consultant: ${consultant.name}`);
      }
    }

    // Confidence Level (from merged estimate)
    if (mergedEstimateData && mergedEstimateData.confidence_level) {
      const confidence = mergedEstimateData.confidence_level.toUpperCase();
      lines.push(`Estimate Confidence: ${confidence}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Programs matched (with actual program names)
  // Priority chain: auto_matched_grants (from search API) → matched_programs (agent-written) → prospect_data fallback
  const autoMatchedGrants = sessionData.auto_matched_grants || pd.auto_matched_grants;
  const matchedProgramsData = autoMatchedGrants || pd.matched_programs || matched_programs;

  if (autoMatchedGrants && autoMatchedGrants.length > 0) {
    console.log(`✅ Using auto-captured grant names (${autoMatchedGrants.length} programs) instead of agent-written matched_programs`);
  }

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
      getgranted: 'GetGranted (under $15K)',
      not_a_fit: 'Not a Fit — Nurture'
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
  // BOOKING LINK (best_fit_product-driven)
  // =========================================================================

  // null link → no booking-link line (Get Granted / Not a Fit).
  // industry-routed → consultant URL (Ruk or Steph for Pro/Waitlist).
  // natalie-intro → Natalie's intro link (Starter / Pro Lite / Nonprofit / Unknown).
  const bestFitProduct = sessionData.best_fit_product
    || (categorizationData && categorizationData.best_fit_product)
    || null;
  const noteRouted = getBookingLink({
    best_fit_product: bestFitProduct,
    industry: pd.industry || (categorizationData && categorizationData.matched_industry)
  });
  if (noteRouted.link) {
    lines.push('---');
    const sourceLabel = noteRouted.source === 'industry-routed' && noteRouted.consultantName
      ? ` (${noteRouted.consultantName})`
      : '';
    lines.push(`📅 Booking Link: ${noteRouted.link}${sourceLabel}`);
  }

  return lines.join('\n');
}

/**
 * Generate fallback email summary when agent didn't provide one.
 *
 * Branches on canonical `prospect_data.best_fit_product` + `service_tier`
 * (Layer 1 intake writes both for every session). Six-row matrix:
 *
 *   best_fit_product   | service_tier | Email           | Estimate | Booking
 *   -------------------|--------------|-----------------|----------|--------
 *   Granted Pro        | any          | Pro pitch       | yes      | yes
 *   Granted Starter    | any          | Starter pitch   | yes      | yes
 *   Get Granted        | not_a_fit    | NOT-YET-READY   | NO       | NO
 *   Get Granted        | else         | Regular Get Gr. | yes      | NO
 *   Nonprofit          | any          | NOT-YET-READY*  | NO       | NO
 *   null / unknown     | —            | NOT-YET-READY   | NO       | NO
 *
 *   * Nonprofit shares NOT-YET-READY copy in v1. Last paragraph mentioning
 *     "incorporation / first revenue / first hire" is mildly off for an
 *     established nonprofit — refine in a follow-up.
 *
 * SAFE DEFAULT: unknown / null tier routes to NOT-YET-READY, never to a paid
 * pitch. The 6th and 5th args (bestFitProduct, serviceTier) are accepted as
 * overrides for callers who want to force a branch, but the function reads
 * canonical values from `prospectData` directly when not overridden — making
 * the historical arg-omission bug irrelevant.
 *
 * @param {Object} prospectData - Prospect information from session (must include
 *                                best_fit_product + service_tier from Layer 1 intake)
 * @param {string} estimatedFunding - Funding estimate range (legacy arg, used as
 *                                    fallback when mergedEstimate not provided)
 * @param {string} firstName - Recipient's first name
 * @param {Object} [mergedEstimate] - Pillar-broken-down estimate object
 * @param {string} [serviceTier] - Override for pd.service_tier
 * @param {string} [bestFitProduct] - Override for pd.best_fit_product
 * @returns {string} HTML email content
 */
export function generateFallbackEmail(prospectData, estimatedFunding, firstName = 'there', mergedEstimate = null, serviceTier = null, bestFitProduct = null) {
  const pd = prospectData || {};
  const companyName = pd.company_name || 'your company';
  const activities = pd.activities || pd.activities_discussed || 'your growth plans';

  // Canonical source of truth: prospect_data (Layer 1 intake writes these for
  // every session). Args treated as overrides; null/missing falls through to pd.
  const effectiveBfp  = bestFitProduct || pd.best_fit_product || null;
  const effectiveTier = serviceTier    || pd.service_tier    || null;

  // ---------------------------------------------------------------------------
  // NOT-YET-READY branch (safe default).
  // Fires for: best_fit_product === 'Get Granted' && service_tier === 'not_a_fit',
  //            best_fit_product === 'Nonprofit',
  //            and any unknown/null tier as safe fallback.
  // No estimate paragraph, no booking content, future-oriented framing.
  // ---------------------------------------------------------------------------
  const isNotYetReady =
    (effectiveBfp === 'Get Granted' && effectiveTier === 'not_a_fit') ||
    effectiveBfp === 'Nonprofit' ||
    !['Granted Pro', 'Granted Starter', 'Get Granted'].includes(effectiveBfp);

  if (isNotYetReady) {
    return `
<p>Hi ${firstName},</p>

<p>Thanks for taking the time to share about ${companyName}. I pulled together what makes sense for where your business is right now.</p>

<p>Based on what you shared, you're at an early stage where the paid grant programs we specialize in (which reward established revenue and operating history) aren't the right fit just yet. I'd rather be straight with you about that than point you at funding that isn't realistic today.</p>

<p>That said — here's what is genuinely useful for you right now:</p>

<p><a href="https://granted.ca/getgranted/" style="color: #0066cc; font-weight: bold;">GetGranted Database</a> is your match. It's our grant database where you can track programs as your business grows. You can start watching what's out there today, even pre-revenue — and as you incorporate, hire, and generate revenue, the grants you're eligible for grow with you.</p>

<p>We're also launching an upgraded platform soon (GetGranted 2.0 Lite) with smart matching and step-by-step guidance. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>

<p>A couple of resources worth bookmarking too:</p>
<ul>
  <li><a href="https://granted.ca/grants-for-small-business-guidebook/" style="color: #0066cc;">Small Business Grants Guidebook</a></li>
  <li><a href="https://granted.ca/government-business-grants-for-canadian-startups/" style="color: #0066cc;">Startup Grants Guide</a></li>
  <li><a href="https://granted.ca/blog/" style="color: #0066cc;">Granted Blog</a></li>
</ul>

<p>When your situation changes — incorporation, first revenue, first hire — come back and we'll put together a full funding picture for you. You'll be in a much stronger position then.</p>

<p>Talk soon,<br>The Granted Team</p>
    `.trim();
  }

  // ---------------------------------------------------------------------------
  // Estimate paragraph: emitted ONLY when a real estimate exists.
  // "Real" = mergedEstimate with total_high > 0, OR a present estimatedFunding
  // string that doesn't parse to all-zero. Drops the legacy '$10-30K' literal
  // default and the '$0K-$0K' rendering — no invented numbers.
  // ---------------------------------------------------------------------------
  const hasMergedEstimate = !!(mergedEstimate && mergedEstimate.total_high > 0);
  const candidateEstimate = estimatedFunding || pd.estimated_funding || null;
  const candidateIsZero = candidateEstimate && /\$?0K?[\s\-–]+\$?0K?/i.test(candidateEstimate);
  const hasRealEstimate = hasMergedEstimate || (!!candidateEstimate && !candidateIsZero);

  let fundingSummary = '';
  let pillarBreakdown = '';

  if (hasMergedEstimate) {
    // Use merged_estimate for accurate pillar-by-pillar breakdown
    const totalLow = Math.round(mergedEstimate.total_low / 1000);
    const totalHigh = Math.round(mergedEstimate.total_high / 1000);
    const funding12Mo = `$${totalLow}K–$${totalHigh}K`;

    fundingSummary = `<p>Based on what you shared, you're looking at an estimated <strong>${funding12Mo}</strong> over the next 12 months across multiple programs.</p>`;

    const pillars = [];
    if (mergedEstimate.hiring?.high > 0) {
      const low = Math.round(mergedEstimate.hiring.low / 1000);
      const high = Math.round(mergedEstimate.hiring.high / 1000);
      pillars.push(`<strong>Hiring:</strong> $${low}K–$${high}K`);
    }
    if (mergedEstimate.training?.high > 0) {
      const low = Math.round(mergedEstimate.training.low / 1000);
      const high = Math.round(mergedEstimate.training.high / 1000);
      pillars.push(`<strong>Training:</strong> $${low}K–$${high}K`);
    }
    if (mergedEstimate.market_expansion?.high > 0) {
      const low = Math.round(mergedEstimate.market_expansion.low / 1000);
      const high = Math.round(mergedEstimate.market_expansion.high / 1000);
      pillars.push(`<strong>Market Expansion:</strong> $${low}K–$${high}K`);
    }
    if (mergedEstimate.rd?.high > 0) {
      const low = Math.round(mergedEstimate.rd.low / 1000);
      const high = Math.round(mergedEstimate.rd.high / 1000);
      pillars.push(`<strong>R&D / Innovation:</strong> $${low}K–$${high}K`);
    }

    if (pillars.length > 0) {
      pillarBreakdown = `<p>Here's the breakdown by activity:</p>

<ul>
  <li>${pillars.join('</li>\n  <li>')}</li>
</ul>`;
    }
  } else if (hasRealEstimate) {
    // Plain-string estimate (legacy path, no pillar breakdown available)
    const fundingNow = pd.available_now_funding || null;
    if (fundingNow && fundingNow !== candidateEstimate) {
      fundingSummary = `<p>Right now, you're looking at an estimated <strong>${fundingNow}</strong> across programs currently accepting applications. Over the next 12 months, as more programs open seasonal intakes, that grows to an estimated <strong>${candidateEstimate}</strong>.</p>`;
    } else {
      fundingSummary = `<p>Based on what you shared, you're looking at an estimated <strong>${candidateEstimate}</strong> over the next 12 months across multiple programs.</p>`;
    }
    pillarBreakdown = `<p>This includes hiring support, training reimbursements, and market expansion funding — the exact mix depends on timing, your province, and which intakes are open.</p>`;
  }
  // else: no estimate paragraph at all. Caller (Regular Get Granted at most)
  // proceeds without it — better than '$0K-$0K' or invented '$10-30K'.

  // ---------------------------------------------------------------------------
  // Tier-specific content + booking CTA.
  // Booking CTA gates BOTH lead-in text AND URL together (closes the orphaned-
  // lead-in bug). For Get Granted (Regular), no CTA emitted at all.
  // ---------------------------------------------------------------------------
  const routed = getBookingLink({ best_fit_product: effectiveBfp, industry: pd.industry });
  let tierContent = '';
  let bookingCTA = '';

  if (effectiveBfp === 'Granted Pro') {
    tierContent = `
<p>With this level of funding potential across multiple programs, a dedicated grant strategist makes sure nothing falls through the cracks — coordinating timing, stacking programs, and managing claims to maximize your return. Our GrantedPro service includes a dedicated Grant Strategist, unlimited applications, complete claims management, and a 93% approval rate.</p>

<p><a href="https://granted.ca/grantedpro/" style="color: #0066cc; font-weight: bold;">Learn more about GrantedPro</a></p>
    `;
    bookingCTA = routed.link ? `
<p>Book a free 15-minute call and we'll map out the exact programs, timing, and application strategy for your business:</p>

<p style="text-align: center;">
  <a href="${routed.link}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book Your Free Consultation</a>
</p>
    ` : '';
  } else if (effectiveBfp === 'Granted Starter') {
    tierContent = `
<p>For your profile, Granted Starter is a great fit — you get expert guidance on your applications without full-service overhead. Our team reviews your applications, provides feedback, and helps you maximize your approval chances.</p>

<p><a href="https://granted.ca/granted-starter/" style="color: #0066cc; font-weight: bold;">Learn more about Granted Starter</a></p>

<p>We're also launching an upgraded platform soon (GetGranted 2.0) with smart matching and step-by-step guidance. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
    `;
    bookingCTA = routed.link ? `
<p>If you'd prefer to talk through your options with someone on our team first, you can book a quick call:</p>

<p style="text-align: center;">
  <a href="${routed.link}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>
    ` : '';
  } else {
    // Regular Get Granted (best_fit_product === 'Get Granted' && service_tier !== 'not_a_fit').
    // Estimate shown above (if present), database + waitlist content, NO booking.
    tierContent = `
<p>Our GetGranted database is a great starting point — you get access to Canada's largest grant database with smart filtering tailored to your business.</p>

<p><a href="https://granted.ca/getgranted/" style="color: #0066cc; font-weight: bold;">Access the GetGranted database</a></p>

<p>We're also launching an upgraded version (GetGranted 2.0 Lite) with real-time matching and alerts. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
    `;
    // No bookingCTA for Regular Get Granted. Both lead-in AND URL absent
    // (closes the Small Point dangling-text bug at the source).
  }

  return `
<p>Hi ${firstName},</p>

<p>It was great chatting about ${companyName}. We talked about ${activities}, and I pulled together what grant funding could be available for you.</p>

${fundingSummary}

${pillarBreakdown}

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
// STANDALONE EMAIL SENDING FUNCTION (Independent of finalization lock)
// ============================================================================

/**
 * Has this session recorded an actual click of the widget's summary button?
 *
 * This is the only signal in the system that reflects an OBSERVED user action.
 * cta_selected, by contrast, is the agent's inference of intent. The row is
 * written by handleLeadGenEvent (src/api/lead-gen-event.js) from the widget's
 * trackEvent('cta_clicked', { cta_type: 'email_summary' }) beacon.
 *
 * Fails CLOSED on a DB error: an unreadable events table must not authorize a
 * send. The inactivity cron remains the backstop, so the cost of a false
 * negative is a delayed email, never a lost one.
 */
async function hasSummaryClick(sessionId) {
  try {
    const result = await query(
      `SELECT 1 FROM lead_gen_events
       WHERE session_id = $1
         AND event_type = 'cta_clicked'
         AND event_data->>'cta_type' = 'email_summary'
       LIMIT 1`,
      [sessionId]
    );
    return result.rowCount > 0;
  } catch (err) {
    console.warn(`⚠️  Could not read lead_gen_events for session ${sessionId} — treating as no click: ${err.message}`);
    return false;
  }
}

/**
 * Send email summary for a lead-gen session
 *
 * This function is INDEPENDENT of finalization - it can be called multiple times.
 *
 * AUTHORIZATION vs CONTENT — these are deliberately separate concerns:
 *
 *   Authorization (may we send at all?) requires ONE of:
 *     1. A recorded summary-button click in lead_gen_events, OR
 *     2. cta_selected === 'email_summary' exactly, OR
 *     3. caller passed { forceGenerate: true } (the inactivity cron)
 *
 *   Content (what do we send?) comes from prospect_data.email_summary_body when
 *   present, else generateFallbackEmail.
 *
 * email_summary_body is NOT authorization. It used to be, which meant the body
 * the prompt mandates on the first save_lead_data call triggered an immediate
 * unrequested send — 68% of sends over a 60-day sample had no click anywhere in
 * the session, some arriving before the prospect clicked. A stored body now
 * simply waits: either the prospect asks for it, or the cron delivers it at
 * inactivity timeout (still the tailored body, not a generic one).
 *
 * Also requires: contact_email exists, and no prior send (see the upgrade
 * exception around prospect_data.email_sent_at).
 *
 * @param {string} sessionId - Session ID
 * @param {Object} [options]
 * @param {boolean} [options.forceGenerate=false] - Cron authorization. Set by
 *   finalizeLeadGenConversation for inactivity_timeout, where no click or CTA
 *   will ever arrive but the lead still needs their summary.
 * @returns {Object} Email send result
 */
export async function sendLeadGenEmail(sessionId, options = {}) {
  const { forceGenerate = false } = options;
  console.log(`\n📧 sendLeadGenEmail called for session ${sessionId}${forceGenerate ? ' (forceGenerate)' : ''}`);

  // Load session data
  const sessionResult = await query(
    `SELECT * FROM lead_gen_conversations WHERE session_id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    return { success: false, error: 'Session not found' };
  }

  const session = sessionResult.rows[0];
  const prospectData = session.prospect_data || {};

  // Check if email already sent — with one exception: when the only prior
  // send was a cron fallback and a tailored agent body now exists, allow
  // exactly one "upgrade" send to supersede it. Sends that predate the
  // email_sent_kind marker are deliberately NOT eligible (no surprise emails
  // to stale leads).
  let isUpgrade = false;
  if (prospectData.email_sent_at) {
    const upgradeEligible =
      prospectData.email_sent_kind === 'fallback' &&
      !prospectData.email_upgraded_at &&
      !!prospectData.email_summary_body;

    if (!upgradeEligible) {
      console.log(`ℹ️  Email already sent at ${prospectData.email_sent_at} — skipping duplicate send`);
      return { success: false, error: 'Email already sent', alreadySent: true, sentAt: prospectData.email_sent_at };
    }

    isUpgrade = true;
    console.log(`📧 Upgrade send: fallback delivered at ${prospectData.email_sent_at}, tailored summary now available — superseding once`);
  }

  // ---------------------------------------------------------------------------
  // AUTHORIZATION — is a send permitted at all?
  //
  // Strict equality on cta_selected, not .includes('email'): the field is free
  // text from the agent and at least two sessions hold malformed blobs where a
  // closing tag and subsequent parameters were swallowed into the value. A
  // substring match would treat that corruption as consent. Anything that is
  // not exactly the known value is not authorization.
  // ---------------------------------------------------------------------------
  const hasEmailBody = !!prospectData.email_summary_body;
  const hasExplicitCta = prospectData.cta_selected === 'email_summary';
  const hasRecordedClick = await hasSummaryClick(sessionId);

  console.log(
    `📧 Checking email authorization — click_recorded: ${hasRecordedClick}, ` +
    `cta_selected: "${prospectData.cta_selected}", has_contact_email: ${!!session.contact_email}, ` +
    `has_email_body: ${hasEmailBody}, forceGenerate: ${forceGenerate}`
  );

  // Precedence is deliberate: an observed click is the truest reason, then the
  // agent's assertion, then the cron. Recorded on the send marker for diagnosis.
  const sendReason = hasRecordedClick ? 'click'
    : hasExplicitCta ? 'cta_selected'
    : forceGenerate ? 'cron'
    : null;

  if (!sendReason) {
    // Expected and correct on the first save_lead_data of a session: the agent
    // has written the body but the prospect has not asked for it. The body is
    // stored, not discarded — the cron will deliver it at inactivity timeout if
    // no click arrives first. has_body is logged because "body present but
    // unauthorized" is the interesting case to grep for.
    console.log(
      `[SEND-LEAD-GEN-EMAIL-UNAUTHORIZED] session=${sessionId} — no recorded click, ` +
      `cta_selected="${prospectData.cta_selected}", forceGenerate=false, has_body=${hasEmailBody}. ` +
      `Not sending now; the inactivity cron will deliver the stored body if the prospect never asks.`
    );
    return { success: false, error: 'Email not authorized', notAuthorized: true, hasBody: hasEmailBody };
  }

  if (sendReason === 'cron' && hasEmailBody) {
    console.log(`📧 Inactivity timeout — delivering the agent's stored tailored body (no click was ever recorded)`);
  }

  if (!session.contact_email) {
    console.warn('⚠️  Cannot send email summary — no contact_email captured');
    return { success: false, error: 'No contact email' };
  }

  // Prepare email
  console.log(`📧 Preparing email for ${session.contact_email}...`);

  // Extract first name
  const nameParts = (session.contact_name || 'there').trim().split(/\s+/);
  const firstName = nameParts[0] || 'there';

  // Get email body or generate fallback
  let emailBodyHtml = prospectData.email_summary_body;
  let emailKind = 'agent';

  if (!emailBodyHtml) {
    emailKind = 'fallback';
    console.log('⚠️  No email_summary_body from agent — generating fallback email');

    // Load enriched session data for accurate estimate
    console.log(`📊 Loading enriched session data from conversation_memory...`);
    const enrichedSession = await loadEnrichedSessionData(sessionId);

    // Extract merged estimate and tier data
    let mergedEstimate = null;
    let serviceTier = null;

    if (enrichedSession?.prospect_data?.merged_estimate) {
      const rawEstimate = typeof enrichedSession.prospect_data.merged_estimate === 'string'
        ? JSON.parse(enrichedSession.prospect_data.merged_estimate)
        : enrichedSession.prospect_data.merged_estimate;
      mergedEstimate = rawEstimate.estimate || null;
      serviceTier = rawEstimate.service_tier || null;
      console.log(`✅ Using merged_estimate for fallback email`);
    }

    // Fallback to categorization if merged_estimate not available
    if (!serviceTier && enrichedSession?.prospect_data?.categorization) {
      const categorization = typeof enrichedSession.prospect_data.categorization === 'string'
        ? JSON.parse(enrichedSession.prospect_data.categorization)
        : enrichedSession.prospect_data.categorization;
      serviceTier = categorization.service_tier || null;
    }

    emailBodyHtml = generateFallbackEmail(
      prospectData,
      session.estimated_funding || prospectData.estimated_funding,
      firstName,
      mergedEstimate,
      serviceTier,
      prospectData.best_fit_product || null
    );
  } else {
    console.log(`📧 Using agent-generated email_summary_body (${emailBodyHtml.length} chars)`);

    // Strip HTML document tags if present
    if (emailBodyHtml.includes('<html') || emailBodyHtml.includes('<!DOCTYPE')) {
      console.warn(`⚠️  email_summary_body contains <html> or <!DOCTYPE> tags — stripping them`);
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

  // Convert markdown to HTML
  const originalLength = emailBodyHtml.length;
  emailBodyHtml = convertMarkdownToHtml(emailBodyHtml);
  if (emailBodyHtml.length !== originalLength) {
    console.log(`  🎨 Converted markdown to HTML in email body`);
  }

  // Upgrade sends open with a fixed acknowledgment of the earlier fallback
  // email. Template text — never model-generated.
  if (isUpgrade) {
    emailBodyHtml = `<p>Following up on my earlier note — now that we've talked through your project in more detail, here's what I found.</p>\n` + emailBodyHtml;
  }

  // Booking link substitution (sentinel-driven + defensive URL rewrite).
  // See substituteBookingLink in booking-link-routing.js for the full contract.
  // Hard-fails (BookingLinkRoutingError) when routing data required by the
  // sentinel is missing — we'd rather not send than ship a literal
  // "{{BOOKING_LINK}}" or a wrong-consultant URL.
  try {
    const beforeLen = emailBodyHtml.length;
    emailBodyHtml = substituteBookingLink(
      emailBodyHtml,
      { best_fit_product: prospectData.best_fit_product || null, industry: prospectData.industry || null },
      { mode: 'email' }
    );
    if (emailBodyHtml.length !== beforeLen) {
      console.log(`✓ Booking link substitution applied (best_fit_product=${prospectData.best_fit_product}, industry=${prospectData.industry})`);
    }
    // Defensive: if any meetings.hubspot.com URL slipped past substitution
    // (e.g. emitted inline rather than wrapped in <p> for a null-tier),
    // surface it without modifying — partial rewrites read worse than the leak.
    if (/https:\/\/meetings\.hubspot\.com\//i.test(emailBodyHtml)) {
      const routed = getBookingLink({
        best_fit_product: prospectData.best_fit_product || null,
        industry: prospectData.industry || null
      });
      if (!routed.link) {
        console.warn(`[BOOKING-LINK-LEAK] Inline meetings.hubspot.com URL survived sentinel substitution for null-link tier. best_fit_product=${prospectData.best_fit_product}, session=${sessionId}`);
      }
    }

    // Two prospect-facing leaks that previously had NO detection at all.
    //
    // 1. A surviving sentinel. substituteBookingLink only strips it via
    //    CTA_PARAGRAPH_RE, which requires a literal <p>...</p> wrapper. A
    //    sentinel emitted bare, or inside <li>/<div>, or as an href, is
    //    returned untouched and ships as "{{BOOKING_LINK}}".
    // 2. A bracket placeholder the model invented instead of the sentinel.
    //    Nothing in the codebase strips or rewrites these; 15 sessions shipped
    //    one, and a delivered copy was confirmed in a recipient's inbox.
    //
    // Log only — do not rewrite. A partial repair here would be guesswork about
    // the surrounding copy; the fix belongs in the prompt. This exists so the
    // next occurrence is greppable instead of silent.
    if (/\{\{BOOKING_LINK\}\}/.test(emailBodyHtml)) {
      console.warn(`[BOOKING-LINK-LEAK] Sentinel survived substitution and will ship verbatim — likely not wrapped in its own <p>. session=${sessionId}, best_fit_product=${prospectData.best_fit_product}`);
    }
    const bracketPlaceholder = emailBodyHtml.match(/\[[^\]\n]{0,80}?(?:booking|inserted by system|system will insert)[^\]\n]{0,80}?\]/i);
    if (bracketPlaceholder) {
      console.warn(`[BOOKING-LINK-LEAK] Bracket placeholder will ship verbatim: ${JSON.stringify(bracketPlaceholder[0])}. session=${sessionId}, best_fit_product=${prospectData.best_fit_product}`);
    }
  } catch (err) {
    if (err instanceof BookingLinkRoutingError) {
      console.error(
        `[BOOKING-LINK-FAILURE] Cannot route booking link for email — refusing to send. session=${sessionId}, contact_email=${session.contact_email}, best_fit_product=${prospectData.best_fit_product}, industry=${prospectData.industry}, reason=${err.context?.reason}, message="${err.message}"`
      );
      return {
        success: false,
        error: `Booking link routing failed: ${err.message}`,
        bookingLinkFailure: true,
        recipient: session.contact_email
      };
    }
    throw err;
  }

  // Wrap in template
  const brandedEmailHtml = wrapInBrandedTemplate(emailBodyHtml);
  console.log(`📧 Email template wrapped (total ${brandedEmailHtml.length} chars)`);

  // Send email
  try {
    console.log(`📧 Calling sendEmail for ${session.contact_email}...`);
    const emailResult = await sendEmail({
      to: session.contact_email,
      toName: session.contact_name || firstName,
      subject: `Your funding estimate for ${prospectData.company_name || 'your company'}`,
      htmlBody: brandedEmailHtml
    });

    console.log(`✅ Email summary sent to ${session.contact_email} — Message ID: ${emailResult.messageId}`);

    // Mark email as sent in database. First sends record when + which kind;
    // upgrade sends keep the original email_sent_at, flip the kind to 'agent',
    // and stamp email_upgraded_at — the hard one-upgrade-per-session cap.
    //
    // email_send_reason records WHY the send was authorized ('click' |
    // 'cta_selected' | 'cron'). Without it the only way to tell an asked-for
    // send from a cron delivery is to cross-reference lead_gen_events by hand.
    const sentMarker = isUpgrade
      ? { email_upgraded_at: new Date().toISOString(), email_sent_kind: 'agent', email_send_reason: sendReason }
      : { email_sent_at: new Date().toISOString(), email_sent_kind: emailKind, email_send_reason: sendReason };

    await query(
      `UPDATE lead_gen_conversations
       SET prospect_data = prospect_data || $1::jsonb,
           updated_at = NOW()
       WHERE session_id = $2`,
      [JSON.stringify(sentMarker), sessionId]
    );

    console.log(`✅ Marked email as sent in database (${isUpgrade ? 'email_upgraded_at' : `email_sent_at, kind=${emailKind}`}, reason=${sendReason} stored in prospect_data)`);

    // Upgrade-only side effects. Both non-blocking — an upgrade email that
    // reached the prospect must never be reported as failed because a
    // notification or CRM write hiccuped.
    if (isUpgrade) {
      try {
        await notifyTeamOfUpgrade({ session, prospectData });
        console.log(`✅ Internal upgrade notification sent`);
      } catch (err) {
        console.warn('⚠️  Upgrade notification failed (non-blocking):', err.message);
      }

      try {
        const hubspotClient = await createHubSpotClient();
        const findResult = await findContactByEmailWithRetry(session.contact_email, hubspotClient);
        if (findResult.success) {
          // best_fit_product is the STORED value from finalization — tiering is
          // never recomputed on this path. marketingOptIn omitted on purpose so
          // the upgrade PATCH can't downgrade an existing opt-in.
          const patchResult = await patchAIContactProperties(
            findResult.contact.id,
            {
              bestFitProduct: prospectData.best_fit_product || null,
              emailSummaryBody: prospectData.email_summary_body
            },
            hubspotClient
          );
          if (patchResult.success) {
            console.log(`✅ Upgrade PATCH: email_summary_body + best_fit_product written to contact ${findResult.contact.id}`);
          } else {
            console.warn(`⚠️  Upgrade PATCH failed (non-blocking): ${patchResult.error}`);
          }
        } else {
          console.warn(`⚠️  Upgrade PATCH skipped — could not resolve contact by email: ${findResult.error}`);
        }
      } catch (err) {
        console.warn('⚠️  Upgrade HubSpot write failed (non-blocking):', err.message);
      }
    }

    return {
      success: true,
      upgraded: isUpgrade,
      recipient: session.contact_email,
      messageId: emailResult.messageId,
      sentAt: new Date().toISOString()
    };
  } catch (err) {
    console.error(`❌ Email send FAILED for ${session.contact_email}:`, err.message);
    console.error(`❌ Full error:`, err);
    return {
      success: false,
      error: err.message,
      recipient: session.contact_email
    };
  }
}

// ============================================================================
// MAIN FINALIZATION FUNCTION
// ============================================================================

// REMOVED Stage 1 entry — `createHubSpotRecordOnEstimate(sessionId)`.
// Phase 2 / 2026-05-04: All HubSpot writes consolidated into the Stage 2 path
// (`finalizeLeadGenConversation`). Stage 1 used to fire from
// `src/tools/executor.js` when the agent called memory_store('estimated_funding'),
// creating a Contact + Company via direct CRM v3 calls. With the Forms API
// rewrite, doing the same submission twice would produce duplicate
// form-submission events in HubSpot reporting (defeating the consolidation
// goal). Variant B's prompt calls save_lead_data immediately after estimate
// delivery, so the early-record signal Stage 1 used to provide is preserved by
// Stage 2 firing within the same agent turn. The 5-minute inactivity-timeout
// cron (server.js) is the safety net for any session that never reaches
// save_lead_data — it calls finalizeLeadGenConversation('inactivity_timeout')
// with whatever data is in `prospect_data` at that point.
//
/**
 * Finalize a lead-gen conversation by submitting to HubSpot Forms API and
 * creating an associated Note. Replaces the older direct-CRM Contact + Company
 * creation path so AI submissions land in the same reporting bucket as legacy
 * "Grant Calculator Oct 2025" form submissions.
 *
 * @param {string} sessionId - Session ID to finalize
 * @param {string} trigger - 'contact_captured' or 'inactivity_timeout'
 * @param {Object} [agentInput] - Optional: full input object the agent passed to
 *   save_lead_data. Carries lead_score, prior_grant_experience, prospect_summary,
 *   email_summary_body, etc. When called from the inactivity-timeout cron, this
 *   is null and we fall back to session-only data.
 * @returns {Object} Finalization result
 */
export async function finalizeLeadGenConversation(sessionId, trigger, agentInput = null) {
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

  const hubspotClient = await createHubSpotClient();

  const results = { form: null, contact: null, company: null, note: null };

  // -------------------------------------------------------------------------
  // 4. Submit to HubSpot Forms API
  //    Replaces direct CRM Contact + Company creation. The form submission
  //    causes HubSpot to create/upsert the Contact (matched by email) and the
  //    associated Company (matched by email domain), AND records a form-
  //    submission event so the lead lands in the "Grant Calculator Oct 2025"
  //    reporting bucket alongside legacy form submissions.
  // -------------------------------------------------------------------------

  // Load enriched session BEFORE the form submit so the field-builder has
  // memory_store data (industry, revenue_range, etc. — they live in
  // prospect_data after lead-gen-init.js stores them).
  let enrichedSession;
  try {
    enrichedSession = await loadEnrichedSessionData(sessionId);
  } catch (err) {
    console.warn(`⚠️  Could not load enriched session, falling back to base session: ${err.message}`);
    enrichedSession = { ...session, prospect_data: prospectData };
  }

  const formResult = await submitLeadGenForm(enrichedSession, agentInput);
  results.form = formResult.success
    ? { action: 'submitted', fieldCount: formResult.fieldCount }
    : { action: 'failed', error: formResult.error };

  // -------------------------------------------------------------------------
  // 5. Find Contact ID (search by email + retry for eventual-consistency window)
  //    Needed for the AI-property PATCH and the Note association.
  // -------------------------------------------------------------------------

  let contactId = null;

  if (session.contact_email) {
    const findResult = await findContactByEmailWithRetry(session.contact_email, hubspotClient);
    if (findResult.success) {
      contactId = findResult.contact.id;
      results.contact = { action: 'found', id: contactId };
      console.log(`✓ Resolved contact ID ${contactId} for ${session.contact_email}`);
    } else {
      results.contact = { action: 'failed', error: findResult.error };
      console.warn(`⚠️  Could not resolve contact ID by email after retries: ${findResult.error}`);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Persist best_fit_product locally (unconditional), then PATCH AI Contact
  //    properties (HubSpot only when contactId resolved).
  //    Local persistence runs regardless of HubSpot state — downstream surfaces
  //    (buildNoteBodyComprehensive below, sendLeadGenEmail's separate DB re-read)
  //    depend on prospect_data.best_fit_product being present; previously these
  //    failed for sessions where HubSpot contact lookup retries exhausted.
  // -------------------------------------------------------------------------

  const bestFitProduct  = computeBestFitProduct(enrichedSession, agentInput);
  const emailSummaryBody = (agentInput && agentInput.email_summary_body) ||
                           enrichedSession.prospect_data?.email_summary_body ||
                           null;

  enrichedSession.best_fit_product = bestFitProduct;
  enrichedSession.prospect_data = enrichedSession.prospect_data || {};
  enrichedSession.prospect_data.best_fit_product = bestFitProduct;
  try {
    await query(
      `UPDATE lead_gen_conversations
       SET prospect_data = prospect_data || $1::jsonb
       WHERE session_id = $2`,
      [JSON.stringify({ best_fit_product: bestFitProduct }), sessionId]
    );
  } catch (err) {
    console.warn(`[BEST-FIT-PRODUCT-PERSIST-FAIL] session=${sessionId} err=${err.message} — continuing; CTA stripping may fall back to Natalie`);
  }

  if (contactId) {
    const patchResult = await patchAIContactProperties(
      contactId,
      {
        bestFitProduct,
        emailSummaryBody,
        marketingOptIn: enrichedSession.prospect_data?.marketing_opt_in || 'false'
      },
      hubspotClient
    );

    if (patchResult.success) {
      results.contact.aiPropertiesPatched = true;
      results.contact.bestFitProduct      = bestFitProduct;
    } else {
      results.contact.aiPropertyPatchError = patchResult.error;
      console.warn(`⚠️  AI-property PATCH failed (non-blocking): ${patchResult.error}`);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Resolve Company ID (for Note association)
  //    HubSpot auto-associates a Company on form submission via the email
  //    domain. We look up the contact's first associated company to attach
  //    the Note to both records, matching the legacy behavior.
  // -------------------------------------------------------------------------

  let companyId = null;

  if (contactId) {
    if (process.env.LEAD_GEN_TEST_MODE === 'true') {
      // Match the test-mode pattern used elsewhere
      companyId = 'TEST_COMPANY_' + Date.now();
      results.company = { action: 'test_mode_stub', id: companyId };
    } else {
      try {
        const assocRes = await hubspotClient.get(`/crm/v3/objects/contacts/${contactId}`, {
          params: { associations: 'companies' }
        });
        const companies = assocRes.data?.associations?.companies?.results || [];
        if (companies.length > 0) {
          companyId = companies[0].id;
          results.company = { action: 'auto_associated', id: companyId };
          console.log(`✓ Found auto-associated company ${companyId} for contact ${contactId}`);
        } else {
          results.company = { action: 'none' };
          console.log(`ℹ️  Contact ${contactId} has no associated company yet — note will attach to contact only`);
        }
      } catch (err) {
        console.warn(`⚠️  Could not fetch contact's associated company: ${err.message}`);
        results.company = { action: 'lookup_failed', error: err.message };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. Update or Create Comprehensive Note
  //    Reuses the enrichedSession already loaded for the form-submit step.
  // -------------------------------------------------------------------------

  if (companyId || contactId) {
    try {
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
  // 6b. Notify internal team
  // -------------------------------------------------------------------------

  if (companyId || contactId) {
    try {
      await notifyTeamOfLead({
        sessionId, trigger, session, prospectData,
        enrichedSession, companyId, contactId, results
      });
    } catch (err) {
      console.warn('⚠️  Internal notification failed (non-blocking):', err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Send Email Summary (Legacy - now handled by standalone function)
  // -------------------------------------------------------------------------
  // NOTE: Email sending is now handled by sendLeadGenEmail() which is called
  // from save_lead_data. This allows email to be sent even if finalization
  // has already happened (e.g., second call to save_lead_data with email CTA).
  //
  // For inactivity_timeout finalization, pass forceGenerate so sendLeadGenEmail
  // generates and sends a fallback body inline (these leads never set
  // cta_selected or email_summary_body themselves, but they DO need an email).
  // This is the consolidated single send path — the cron loop no longer
  // generates its own redundant (and historically broken) fallback body.

  const emailResult = await sendLeadGenEmail(sessionId, {
    forceGenerate: trigger === 'inactivity_timeout'
  });
  if (emailResult.success) {
    results.email = { action: 'sent', recipient: emailResult.recipient, messageId: emailResult.messageId };
  } else if (emailResult.alreadySent) {
    results.email = { action: 'skipped', reason: 'already_sent', sentAt: emailResult.sentAt };
  } else {
    results.email = { action: 'skipped', reason: emailResult.error };
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
         AND message_count >= 1
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
          // Email sending is consolidated inside finalizeLeadGenConversation,
          // which calls sendLeadGenEmail with { forceGenerate: true } for
          // inactivity_timeout. No redundant fallback generation here — the
          // earlier cron-loop block (now removed) was the source of the
          // mis-routed Starter-pitch emails for not_a_fit leads.
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

    results.summariesDelivered = await deliverPendingSummaries(inactivityMinutes, batchSize);

    return results;
  } catch (err) {
    console.error('❌ Failed to query inactive sessions:', err.message);
    throw err;
  }
}

/**
 * Deliver stored summaries for sessions the finalization sweep can no longer reach.
 *
 * WHY THIS EXISTS — the two sweeps cover disjoint sets:
 *
 * finalizeInactiveSessions selects `finalized = FALSE`. But any session where the
 * agent called save_lead_data was finalized at that moment (trigger
 * 'contact_captured'), because finalizeLeadGenConversation claims the row by
 * setting finalized = TRUE. Those sessions are therefore invisible to that sweep
 * forever.
 *
 * That was harmless while a stored email_summary_body authorized its own
 * immediate send. Now that authorization requires a click, a CTA, or the cron,
 * a prospect who never clicks would otherwise have a finished summary sitting in
 * prospect_data that nothing is left to deliver. This sweep is that delivery.
 *
 * Deliberately narrow on three axes:
 *
 *  1. Only sessions that already have a tailored body. Leads with no stored body
 *     are untouched — generating a fallback for them is the existing sweep's job,
 *     and doing it here would start emailing book_call leads who are not
 *     supposed to receive one.
 *  2. Only sessions never sent to.
 *  3. Only RECENT activity (see STALE_SUMMARY_CUTOFF_HOURS). Without this floor
 *     the first run would mail every historically undelivered body at once — 30
 *     sessions dating to February and March when this was written. A prospect
 *     who chatted four months ago must not receive a surprise summary today.
 *     This matches the "no surprise emails to stale leads" rule the upgrade
 *     guard already enforces.
 */
const STALE_SUMMARY_CUTOFF_HOURS = 24;

async function deliverPendingSummaries(inactivityMinutes = 5, batchSize = 50) {
  try {
    // Anything past the cutoff will never be delivered. That is the intended
    // design, but it must not be silent — a rising count here, or a `newest`
    // timestamp that is only just over the cutoff, means summaries were
    // stranded by an outage rather than by age.
    const stale = await query(
      `SELECT count(*)::int AS n, max(last_activity_at) AS newest
       FROM lead_gen_conversations
       WHERE finalized = TRUE
         AND last_activity_at <= NOW() - INTERVAL '${STALE_SUMMARY_CUTOFF_HOURS} hours'
         AND contact_email IS NOT NULL
         AND prospect_data->>'email_summary_body' IS NOT NULL
         AND prospect_data->>'email_sent_at' IS NULL`
    );
    if (stale.rows[0].n > 0) {
      const newest = stale.rows[0].newest;
      console.warn(
        `[PENDING-SUMMARY-STALE] ${stale.rows[0].n} session(s) hold an undelivered summary older than ` +
        `${STALE_SUMMARY_CUTOFF_HOURS}h and will never be sent — newest went quiet at ` +
        `${newest?.toISOString?.() ?? newest}. Expected for genuinely old leads; if that timestamp is ` +
        `close to the cutoff, the cron was likely down and those prospects lost their summary.`
      );
    }

    const pending = await query(
      `SELECT session_id, contact_email, prospect_data
       FROM lead_gen_conversations
       WHERE finalized = TRUE
         AND last_activity_at < NOW() - INTERVAL '${inactivityMinutes} minutes'
         AND last_activity_at > NOW() - INTERVAL '${STALE_SUMMARY_CUTOFF_HOURS} hours'
         AND contact_email IS NOT NULL
         AND prospect_data->>'email_summary_body' IS NOT NULL
         AND prospect_data->>'email_sent_at' IS NULL
       ORDER BY last_activity_at ASC
       LIMIT $1`,
      [batchSize]
    );

    if (pending.rows.length === 0) {
      console.log('✓ No pending summaries awaiting delivery');
      return 0;
    }

    console.log(`📧 ${pending.rows.length} finalized session(s) have an undelivered summary — sending now`);

    let delivered = 0;
    for (const session of pending.rows) {
      try {
        const result = await sendLeadGenEmail(session.session_id, { forceGenerate: true });
        if (result.success) {
          delivered++;
          console.log(`✅ Pending summary delivered to ${session.contact_email} (session ${session.session_id})`);
        } else {
          console.warn(`⚠️  Pending summary not delivered for ${session.session_id} — ${result.error}`);
        }
      } catch (err) {
        console.error(`❌ Error delivering pending summary for ${session.session_id}:`, err.message);
      }
    }

    console.log(`📧 Pending-summary sweep complete: ${delivered}/${pending.rows.length} delivered\n`);
    return delivered;
  } catch (err) {
    // Never let this sweep break the finalization cron — the finalization work
    // above has already succeeded by the time we get here.
    console.error('❌ Pending-summary sweep failed:', err.message);
    return 0;
  }
}
