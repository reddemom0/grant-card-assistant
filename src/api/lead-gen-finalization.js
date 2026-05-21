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
import { notifyTeamOfLead } from '../services/lead-notification.js';
import { getBookingLink, NATALIE_INTRO_LINK, substituteBookingLink, BookingLinkRoutingError } from './booking-link-routing.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

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
 * Generate fallback email summary when agent didn't provide one
 * @param {Object} prospectData - Prospect information from session
 * @param {string} estimatedFunding - Funding estimate range
 * @param {string} firstName - Recipient's first name
 * @returns {string} HTML email content
 */
function generateFallbackEmail(prospectData, estimatedFunding, firstName = 'there', mergedEstimate = null, serviceTier = null, bestFitProduct = null) {
  const pd = prospectData || {};
  const companyName = pd.company_name || 'your company';
  const routed = getBookingLink({ best_fit_product: bestFitProduct, industry: pd.industry });
  const activities = pd.activities || pd.activities_discussed || 'your growth plans';

  // Determine tier: use provided serviceTier if available, otherwise derive from funding amount
  let tier;
  if (serviceTier) {
    // Map service_tier values to tier codes
    const tierMap = {
      'pro': 'high',
      'grantedpro': 'high',
      'starter': 'medium',
      'getgranted': 'low'
    };
    tier = tierMap[serviceTier.toLowerCase()] || 'medium';
  } else {
    tier = determineFundingTier(estimatedFunding);
  }

  // Build funding summary
  let fundingSummary = '';
  let pillarBreakdown = '';

  if (mergedEstimate) {
    // Use merged_estimate for accurate pillar-by-pillar breakdown
    const totalLow = Math.round(mergedEstimate.total_low / 1000);
    const totalHigh = Math.round(mergedEstimate.total_high / 1000);
    const funding12Mo = `$${totalLow}K–$${totalHigh}K`;

    fundingSummary = `Based on what you shared, you're looking at an estimated <strong>${funding12Mo}</strong> over the next 12 months across multiple programs.`;

    // Build pillar breakdown
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
  } else {
    // Fallback to generic estimate if merged_estimate not available
    const fundingNow = pd.available_now_funding || null;
    const funding12Mo = estimatedFunding || pd.estimated_funding || '$10-30K';

    if (fundingNow && fundingNow !== funding12Mo) {
      fundingSummary = `Right now, you're looking at an estimated <strong>${fundingNow}</strong> across programs currently accepting applications. Over the next 12 months, as more programs open seasonal intakes, that grows to an estimated <strong>${funding12Mo}</strong>.`;
    } else {
      fundingSummary = `Based on what you shared, you're looking at an estimated <strong>${funding12Mo}</strong> over the next 12 months across multiple programs.`;
    }

    pillarBreakdown = `<p>This includes hiring support, training reimbursements, and market expansion funding — the exact mix depends on timing, your province, and which intakes are open.</p>`;
  }

  // Build tier-specific email content
  let tierContent = '';
  let bookingCTA = '';

  if (tier === 'high') {
    // $30K+ → GrantedPro
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
  } else if (tier === 'medium') {
    // $10-29K → Granted Starter (PRIMARY), GetGranted 2.0 (SECONDARY)
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
    // Under $10K → GetGranted database (PRIMARY), GetGranted 2.0 Lite (SECONDARY)
    tierContent = `
<p>Our GetGranted database is a great starting point — you get access to Canada's largest grant database with smart filtering tailored to your business.</p>

<p><a href="https://granted.ca/getgranted/" style="color: #0066cc; font-weight: bold;">Access the GetGranted database</a></p>

<p>We're also launching an upgraded version (GetGranted 2.0 Lite) with real-time matching and alerts for $55/month. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
    `;
    bookingCTA = routed.link ? `
<p>Have questions or want a second opinion? You can always book a free call with our team:</p>

<p style="text-align: center;">
  <a href="${routed.link}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>
    ` : '';
  }

  return `
<p>Hi ${firstName},</p>

<p>It was great chatting about ${companyName}. We talked about ${activities}, and I pulled together what grant funding could be available for you.</p>

<p>${fundingSummary}</p>

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
 * Send email summary for a lead-gen session
 *
 * This function is INDEPENDENT of finalization - it can be called multiple times
 * and will only send if:
 * 1. cta_selected includes 'email'
 * 2. contact_email exists
 * 3. Email hasn't been sent yet (checks prospect_data.email_sent_at)
 *
 * @param {string} sessionId - Session ID
 * @returns {Object} Email send result
 */
export async function sendLeadGenEmail(sessionId) {
  console.log(`\n📧 sendLeadGenEmail called for session ${sessionId}`);

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

  // Check if email already sent
  if (prospectData.email_sent_at) {
    console.log(`ℹ️  Email already sent at ${prospectData.email_sent_at} — skipping duplicate send`);
    return { success: false, error: 'Email already sent', alreadySent: true, sentAt: prospectData.email_sent_at };
  }

  // Check conditions
  console.log(`📧 Checking email conditions — cta_selected: "${prospectData.cta_selected}", has_contact_email: ${!!session.contact_email}, has_email_body: ${!!prospectData.email_summary_body}`);

  // Send email if EITHER:
  // 1. Explicit request (cta_selected includes 'email'), OR
  // 2. Agent prepared email body (indicates intent to send on timeout/finalization)
  const hasExplicitRequest = prospectData.cta_selected && prospectData.cta_selected.includes('email');
  const hasEmailBody = !!prospectData.email_summary_body;

  if (!hasExplicitRequest && !hasEmailBody) {
    console.log(`ℹ️  Email summary NOT requested and no email body prepared — skipping`);
    return { success: false, error: 'Email not requested' };
  }

  if (hasEmailBody && !hasExplicitRequest) {
    console.log(`📧 Email body prepared by agent but no explicit button click — sending via timeout/finalization path`);
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

  if (!emailBodyHtml) {
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

    // Mark email as sent in database
    await query(
      `UPDATE lead_gen_conversations
       SET prospect_data = prospect_data || $1::jsonb,
           updated_at = NOW()
       WHERE session_id = $2`,
      [JSON.stringify({ email_sent_at: new Date().toISOString() }), sessionId]
    );

    console.log(`✅ Marked email as sent in database (email_sent_at stored in prospect_data)`);

    return {
      success: true,
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
  // 6. PATCH AI-specific Contact properties
  //    submission_source and email_summary_body aren't part of the form's
  //    field schema; best_fit_product is also re-written defensively.
  // -------------------------------------------------------------------------

  if (contactId) {
    const bestFitProduct  = computeBestFitProduct(enrichedSession, agentInput);
    const emailSummaryBody = (agentInput && agentInput.email_summary_body) ||
                             enrichedSession.prospect_data?.email_summary_body ||
                             null;

    // Persist best_fit_product so downstream surfaces (buildNoteBodyComprehensive
    // below, sendLeadGenEmail's regex normalizer via separate DB re-read) can
    // route the booking link without recomputing. In-memory for this function;
    // jsonb merge into prospect_data for sendLeadGenEmail's separate session load.
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

    const patchResult = await patchAIContactProperties(
      contactId,
      { bestFitProduct, emailSummaryBody },
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
  // We still attempt to send here for backwards compatibility with the timeout
  // trigger (inactivity_timeout), but the main email sending path is now through
  // save_lead_data → sendLeadGenEmail().

  const emailResult = await sendLeadGenEmail(sessionId);
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

          // Auto-send funding summary email if conditions are met
          const prospectData = session.prospect_data || {};
          const hasEmail = !!session.contact_email;
          let hasEmailBody = !!prospectData.email_summary_body;

          if (!hasEmail) {
            console.log(`⚠️  No contact_email — skipping auto-send`);
          } else {
            // Generate fallback email if agent didn't provide one
            if (!hasEmailBody) {
              console.log(`⚠️  No email_summary_body from agent — generating fallback for auto-send`);

              try {
                // Load enriched session data (includes conversation_memory)
                console.log(`📊 Loading enriched session data from conversation_memory...`);
                const enrichedSession = await loadEnrichedSessionData(session.session_id);

                // Extract merged estimate and tier data
                let mergedEstimate = null;
                let serviceTier = null;

                if (enrichedSession?.prospect_data?.merged_estimate) {
                  const rawEstimate = typeof enrichedSession.prospect_data.merged_estimate === 'string'
                    ? JSON.parse(enrichedSession.prospect_data.merged_estimate)
                    : enrichedSession.prospect_data.merged_estimate;
                  mergedEstimate = rawEstimate.estimate || null;
                  serviceTier = rawEstimate.service_tier || null;
                  console.log(`✅ Loaded merged_estimate: total $${Math.round(mergedEstimate?.total_low / 1000)}K–$${Math.round(mergedEstimate?.total_high / 1000)}K, tier: ${serviceTier}`);
                }

                // Fallback to categorization if merged_estimate not available
                if (!serviceTier && enrichedSession?.prospect_data?.categorization) {
                  const categorization = typeof enrichedSession.prospect_data.categorization === 'string'
                    ? JSON.parse(enrichedSession.prospect_data.categorization)
                    : enrichedSession.prospect_data.categorization;
                  serviceTier = categorization.service_tier || null;
                  console.log(`✅ Loaded service_tier from categorization: ${serviceTier}`);
                }

                // Extract first name for personalization
                const nameParts = (session.contact_name || 'there').trim().split(/\s+/);
                const firstName = nameParts[0] || 'there';

                // Generate fallback email with enriched data
                const fallbackBody = generateFallbackEmail(
                  prospectData,
                  session.estimated_funding || prospectData.estimated_funding,
                  firstName,
                  mergedEstimate,
                  serviceTier
                );

                if (fallbackBody) {
                  console.log(`✅ Generated fallback email (${fallbackBody.length} chars)`);

                  // Update session with generated email body
                  prospectData.email_summary_body = fallbackBody;
                  await query(
                    `UPDATE lead_gen_conversations
                     SET prospect_data = $1
                     WHERE session_id = $2`,
                    [JSON.stringify(prospectData), session.session_id]
                  );

                  console.log(`✅ Updated session with fallback email body`);
                  hasEmailBody = true;
                } else {
                  console.warn(`⚠️  Fallback email generation returned empty — skipping auto-send`);
                }
              } catch (fallbackErr) {
                console.error(`❌ Fallback email generation failed: ${fallbackErr.message}`);
              }
            }

            // Send email if we have a body (agent-generated or fallback)
            if (hasEmailBody) {
              try {
                console.log(`📧 Auto-sending funding summary email to ${session.contact_email} (inactivity timeout)...`);
                const emailResult = await sendLeadGenEmail(session.session_id);

                if (emailResult.success) {
                  console.log(`📧 Auto-sent funding summary email to ${session.contact_email} (inactivity timeout)`);
                } else if (emailResult.alreadySent) {
                  console.log(`ℹ️  Email already sent at ${emailResult.sentAt} — skipping duplicate`);
                } else {
                  console.warn(`⚠️  Email send failed: ${emailResult.error}`);
                }
              } catch (emailErr) {
                console.error(`⚠️  Error auto-sending email: ${emailErr.message}`);
                // Don't fail finalization if email fails
              }
            } else {
              console.log(`⚠️  No email body available — skipping auto-send`);
            }
          }
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
