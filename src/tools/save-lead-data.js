/**
 * save_lead_data Tool
 *
 * Called by the lead-gen agent when a prospect provides their name and email.
 *
 * Two-trigger finalization system:
 * - Trigger A (this tool): Contact info captured in Phase 5
 * - Trigger B: Inactivity timeout (5 min) — handled by background job
 *
 * This tool:
 *  1. Updates lead_gen_conversations with contact info + prospect profile
 *  2. Calls finalizeLeadGenConversation() to create HubSpot records
 *
 * The `conversationId` (= lead_gen_conversations.session_id) is injected by
 * executeToolCall — the agent never needs to know or pass it.
 */

import { query } from '../database/connection.js';
import { finalizeLeadGenConversation } from '../api/lead-gen-finalization.js';
import {
  createHubSpotCompany,
  createHubSpotContact,
  updateHubSpotCompany,
  associateContactWithCompany,
  getContactByEmail
} from './hubspot.js';

const HUBSPOT_API   = 'https://api.hubapi.com';
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BOOKING_LINK  = 'https://meetings.hubspot.com/natalie392/15min-intro-to-granted';

// ============================================================================
// HubSpot axios client (local — createHubSpotClient not exported from hubspot.js)
// ============================================================================

function makeHubSpotClient() {
  const client = axios.create({
    baseURL: HUBSPOT_API,
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
// Revenue string → number parser
// "$800K" → 800000, "$1.5M" → 1500000, "$2M" → 2000000, "500000" → 500000
// ============================================================================

function parseRevenue(revenueStr) {
  if (!revenueStr) return null;

  // Strip currency symbols, commas, spaces
  let s = String(revenueStr).replace(/[$,\s]/g, '').toUpperCase();

  // Handle ranges like "$500K-$1M" or "$1M–$2M" — take the lower bound
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

// ============================================================================
// Employee count parser — extract first number from a string
// "15-20 employees" → 15, "about 30" → 30
// ============================================================================

function parseEmployeeCount(str) {
  if (!str) return null;
  const match = String(str).match(/[\d,]+/);
  if (!match) return null;
  const num = parseInt(match[0].replace(/,/g, ''), 10);
  return isNaN(num) ? null : num;
}

// ============================================================================
// HubSpot: find company by name (search API)
// ============================================================================

async function findCompanyByName(name) {
  const client = makeHubSpotClient();
  try {
    const response = await client.post('/crm/v3/objects/companies/search', {
      filterGroups: [{
        filters: [{
          propertyName: 'name',
          operator: 'EQ',
          value: name
        }]
      }],
      properties: ['name', 'state', 'lifecyclestage'],
      limit: 1
    });
    const results = response.data.results || [];
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    console.warn('⚠️  HubSpot company search failed:', err.response?.data?.message || err.message);
    return null;
  }
}

// ============================================================================
// HubSpot: populate company fields individually (try/catch per field)
// Skips industry — free text causes enum validation errors
// ============================================================================

async function populateCompanyFields(companyId, input) {
  if (!companyId) return;

  const updates = {};
  const skipped = [];

  // annualrevenue — parse string to number
  try {
    const rev = parseRevenue(input.revenue);
    if (rev !== null) updates.annualrevenue = rev;
  } catch (e) { skipped.push(`annualrevenue: ${e.message}`); }

  // numberofemployees — parse from string
  try {
    const emp = parseEmployeeCount(input.employee_count);
    if (emp !== null) updates.numberofemployees = emp;
  } catch (e) { skipped.push(`numberofemployees: ${e.message}`); }

  // state — province code
  try {
    if (input.province) updates.state = input.province;
  } catch (e) { skipped.push(`state: ${e.message}`); }

  // description — from conversation context
  try {
    if (input.company_description) updates.description = input.company_description;
  } catch (e) { skipped.push(`description: ${e.message}`); }

  // country — always Canada for these leads
  try {
    updates.country = 'Canada';
  } catch (e) { skipped.push(`country: ${e.message}`); }

  if (Object.keys(updates).length === 0) {
    console.log(`ℹ️  No company fields to populate for company ${companyId}`);
    return;
  }

  try {
    const res = await updateHubSpotCompany(companyId, updates);
    if (res.success) {
      console.log(`✅ Company ${companyId} fields updated:`, Object.keys(updates).join(', '));
    } else {
      console.warn(`⚠️  Company update partial failure: ${res.error}`);
    }
  } catch (err) {
    console.warn(`⚠️  Company field population failed for ${companyId}:`, err.message);
  }

  if (skipped.length > 0) {
    console.warn('⚠️  Skipped company fields:', skipped.join('; '));
  }
}

// ============================================================================
// HubSpot: get the first associated company ID for a contact
// Used to discover auto-created companies from email domain matching
// ============================================================================

async function getContactAssociatedCompanyId(contactId) {
  const client = makeHubSpotClient();
  try {
    const res = await client.get(`/crm/v3/objects/contacts/${contactId}`, {
      params: { associations: 'companies' }
    });
    const associated = res.data.associations?.companies?.results || [];
    return associated.length > 0 ? associated[0].id : null;
  } catch (err) {
    console.warn('⚠️  Could not fetch contact associations:', err.message);
    return null;
  }
}

// ============================================================================
// HubSpot: fetch a company's name by ID
// Used for duplicate company detection — compare existing vs. new company name
// ============================================================================

async function getCompanyName(companyId) {
  const client = makeHubSpotClient();
  try {
    const res = await client.get(`/crm/v3/objects/companies/${companyId}`, {
      params: { properties: 'name' }
    });
    return res.data.properties?.name || null;
  } catch (err) {
    console.warn('⚠️  Could not fetch company name:', err.message);
    return null;
  }
}

// ============================================================================
// HubSpot: create a Note and associate it with contact + optional company
// ============================================================================

async function createHubSpotNote(noteBody, contactId, companyId = null) {
  const client = makeHubSpotClient();

  const noteRes = await client.post('/crm/v3/objects/notes', {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: noteBody
    }
  });

  const noteId = noteRes.data.id;
  console.log(`📝 HubSpot note created: ${noteId}`);

  await client.put(
    `/crm/v4/objects/notes/${noteId}/associations/default/contacts/${contactId}`,
    []
  );

  if (companyId) {
    await client.put(
      `/crm/v4/objects/notes/${noteId}/associations/default/companies/${companyId}`,
      []
    );
  }

  return noteId;
}

// ============================================================================
// Build the note body
// ============================================================================

function buildNoteBody(input, multipleCompaniesFlag = null) {
  const lines = ['=== Grant Advisor Chat — Lead Summary ===', ''];

  // Multi-company warning — shown first so sales team sees it immediately
  if (multipleCompaniesFlag) {
    lines.push(`⚠️ ${multipleCompaniesFlag}`);
    lines.push('');
  }

  // Natural language summary — agent-provided
  if (input.prospect_summary) {
    lines.push(input.prospect_summary);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Structured contact info
  lines.push(`Name: ${input.name}`);
  lines.push(`Email: ${input.email}`);
  if (input.company_name)        lines.push(`Company: ${input.company_name}`);
  if (input.province)            lines.push(`Province: ${input.province}`);
  if (input.revenue)             lines.push(`Revenue: ${input.revenue}`);
  if (input.employee_count)      lines.push(`Employees: ${input.employee_count}`);
  if (input.company_description) lines.push(`About: ${input.company_description}`);
  if (input.prior_grant_experience) lines.push(`Prior grant experience: ${input.prior_grant_experience}`);
  if (input.lead_score) {
    const scoreLabels = { hot: 'Hot (ready to close)', warm: 'Warm (promising)', cool: 'Cool (early stage)' };
    lines.push(`Lead score: ${scoreLabels[input.lead_score] || input.lead_score}`);
  }
  lines.push('');

  // Activities discussed
  if (input.activities_summary) {
    lines.push('Activities discussed:');
    lines.push(input.activities_summary);
    lines.push('');
  }

  // Programs matched
  if (input.matched_programs && input.matched_programs.length > 0) {
    lines.push('Programs matched:');
    lines.push(input.matched_programs.join(', '));
    lines.push('');
  }

  // Funding estimate
  if (input.estimated_funding) {
    lines.push(`Estimated funding potential: ${input.estimated_funding}`);
    lines.push('');
  }

  // CTA taken
  if (input.cta_selected) {
    const ctaLabels = {
      book_call:     'Book a strategy call',
      getgranted:    'Sign up for GetGranted',
      email_summary: 'Email summary requested',
      none:          'No CTA taken'
    };
    lines.push(`CTA selected: ${ctaLabels[input.cta_selected] || input.cta_selected}`);
    lines.push('');
  }

  // Booking link — always included for sales team
  lines.push('---');
  lines.push(`Booking link: ${BOOKING_LINK}`);

  return lines.join('\n');
}

// ============================================================================
// Main export
// ============================================================================

/**
 * @param {Object} input
 * @param {string} input.name                - Prospect's full name (required)
 * @param {string} input.email               - Prospect's email (required)
 * @param {string} [input.company_name]      - Business name
 * @param {string} [input.province]          - Province / territory code
 * @param {string} [input.revenue]           - Approximate revenue range (string)
 * @param {string} [input.employee_count]    - Number of employees (string)
 * @param {string} [input.company_description] - Brief company description
 * @param {string} [input.activities_summary] - Hiring, training, expansion plans
 * @param {string} [input.prospect_summary]  - 2-3 sentence natural language summary
 * @param {string[]} [input.matched_programs] - Program names discussed
 * @param {string} [input.estimated_funding] - Funding estimate e.g. "$15K–$40K"
 * @param {string} [input.cta_selected]      - 'book_call'|'getgranted'|'email_summary'|'none'
 * @param {string} input.lead_score          - 'hot'|'warm'|'cool' (required)
 * @param {string} conversationId            - Injected by executeToolCall (= session_id)
 */
export async function saveLeadData(input, conversationId) {
  const { name, email } = input;

  // 🔍 DEBUG: Log payload size and email_summary_body presence
  const payloadStr = JSON.stringify(input);
  console.log(`\n🔍 DEBUG: save_lead_data payload size: ${payloadStr.length} chars`);
  console.log(`🔍 DEBUG: email_summary_body present: ${!!input.email_summary_body}`);
  if (input.email_summary_body) {
    console.log(`🔍 DEBUG: email_summary_body size: ${input.email_summary_body.length} chars`);
  }
  console.log(`🔍 DEBUG: Input keys: ${Object.keys(input).join(', ')}\n`);

  if (!name || !email) {
    return { success: false, error: 'name and email are required' };
  }

  // -------------------------------------------------------------------------
  // 0. Auto-pull matched_programs and funding fields from memory_store
  //    (Infrastructure-level override to ensure actual program names are used)
  // -------------------------------------------------------------------------

  try {
    // Check for auto_matched_grants first (most reliable — directly from search results)
    const autoGrantsResult = await query(
      `SELECT value FROM conversation_memory WHERE conversation_id = $1 AND key = 'auto_matched_grants'`,
      [conversationId]
    );

    if (autoGrantsResult.rows.length > 0) {
      try {
        const autoGrants = JSON.parse(autoGrantsResult.rows[0].value);
        if (autoGrants.length > 0) {
          console.log(`✅ matched_programs overridden from auto_matched_grants (${autoGrants.length} programs from search results)`);
          console.log(`   Agent sent: ${JSON.stringify(input.matched_programs)?.substring(0, 200)}...`);
          console.log(`   Using auto-captured: ${autoGrants.slice(0, 3).join(', ')}...`);
          input.matched_programs = autoGrants;
        }
      } catch (e) {
        console.log(`⚠️  Failed to parse auto_matched_grants, falling back to memory_store override`);
        // Fall through to existing memory_store override
      }
    }

    // Load other memory_store fields (matched_programs fallback, funding fields)
    const memoryFields = await query(
      `SELECT key, value FROM conversation_memory
       WHERE conversation_id = $1
         AND key IN ('matched_programs', 'programs_matched_count', 'estimated_funding', 'available_now_funding')`,
      [conversationId]
    );

    memoryFields.rows.forEach(row => {
      const { key, value } = row;

      if (key === 'matched_programs' && value && !input.matched_programs) {
        // Only use matched_programs from memory_store if auto_matched_grants wasn't found
        const agentValue = input.matched_programs;
        console.log(`✅ matched_programs overridden from memory_store (fallback)`);
        console.log(`   Agent sent: ${JSON.stringify(agentValue)?.substring(0, 150)}...`);
        console.log(`   Using stored: ${value.substring(0, 150)}...`);

        // Parse stored value (could be JSON array or comma-separated string)
        try {
          input.matched_programs = JSON.parse(value);
        } catch {
          // If not JSON, split comma-separated string
          input.matched_programs = value.split(',').map(s => s.trim());
        }
      } else if (key === 'programs_matched_count' && value) {
        if (input.programs_matched_count && input.programs_matched_count !== value) {
          console.log(`✅ programs_matched_count overridden from memory_store (agent: ${input.programs_matched_count}, stored: ${value})`);
        }
        input.programs_matched_count = value;
      } else if (key === 'estimated_funding' && value) {
        if (input.estimated_funding && input.estimated_funding !== value) {
          console.log(`✅ estimated_funding overridden from memory_store (agent: ${input.estimated_funding}, stored: ${value})`);
        }
        input.estimated_funding = value;
      } else if (key === 'available_now_funding' && value) {
        if (input.available_now_funding && input.available_now_funding !== value) {
          console.log(`✅ available_now_funding overridden from memory_store (agent: ${input.available_now_funding}, stored: ${value})`);
        }
        input.available_now_funding = value;
      }
    });
  } catch (err) {
    console.warn(`⚠️  Failed to load memory_store overrides (will use agent values):`, err.message);
  }

  // -------------------------------------------------------------------------
  // 1. Update lead_gen_conversations with contact info and all captured data
  // -------------------------------------------------------------------------
  try {
    const prospectData = {
      company_name:           input.company_name           || null,
      province:               input.province               || null,
      revenue:                input.revenue                || null,
      employee_count:         input.employee_count         || null,
      company_description:    input.company_description    || null,
      activities:             input.activities_summary     || null,
      prior_grant_experience: input.prior_grant_experience || null,
      lead_score:             input.lead_score             || null,
      prospect_summary:       input.prospect_summary       || null,
      // Individual scoring signals
      timeline:               input.timeline               || null,
      budget_committed:       input.budget_committed       || null,
      is_decision_maker:      input.is_decision_maker      || null,
      growth_plans:           input.growth_plans           || null,
      existing_consultant:    input.existing_consultant    || null,
      // Email summary body from agent (for email sending)
      email_summary_body:     input.email_summary_body     || null,
      // CTA selected (stored in both prospect_data and top-level for finalization)
      cta_selected:           input.cta_selected           || null
    };

    await query(
      `UPDATE lead_gen_conversations
          SET contact_name      = $1,
              contact_email     = $2,
              prospect_data     = prospect_data || $3::jsonb,
              matched_programs  = $4,
              estimated_funding = $5,
              cta_selected      = $6,
              updated_at        = NOW()
        WHERE session_id = $7`,
      [
        name,
        email,
        JSON.stringify(prospectData),
        JSON.stringify(input.matched_programs || []),
        input.estimated_funding || null,
        input.cta_selected      || null,
        conversationId
      ]
    );

    console.log(`✅ lead_gen_conversations updated for session ${conversationId} — cta_selected: "${input.cta_selected}", has_email_body: ${!!input.email_summary_body}`);
  } catch (err) {
    console.error('❌ DB update failed in saveLeadData:', err.message);
    return { success: false, error: err.message };
  }

  // -------------------------------------------------------------------------
  // 2. Finalize conversation (Trigger A: contact_captured)
  // -------------------------------------------------------------------------

  try {
    const result = await finalizeLeadGenConversation(conversationId, 'contact_captured');

    if (result.success) {
      console.log(`✅ Session finalized via contact_captured`);
      return {
        success: true,
        message: `Lead data saved and synced to HubSpot.`,
        ...result
      };
    } else {
      console.warn(`⚠️  Finalization returned non-success:`, result);
      return {
        success: true,
        message: `Lead data saved to database. HubSpot sync: ${result.error || 'unknown issue'}`,
        ...result
      };
    }
  } catch (err) {
    console.error('❌ Finalization failed:', err.message);
    return {
      success: true,
      message: 'Lead data saved to database, but HubSpot sync failed.',
      error: err.message
    };
  }
}
