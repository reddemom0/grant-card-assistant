/**
 * save_lead_data Tool
 *
 * Called by the lead-gen agent when a prospect provides their name and email.
 * Performs these operations in sequence:
 *
 *  1. UPDATE lead_gen_conversations with contact info + prospect profile
 *  2. HubSpot: find-or-create Company → find-or-create Contact → associate
 *  3. Populate Company fields (revenue, employees, state, description)
 *     - If Contact was found/created and already had an associated company
 *       (HubSpot auto-creates from email domain), use that company instead
 *  4. Create a HubSpot Note with natural-language summary + structured data
 *     + booking link for the sales team
 *
 * The `conversationId` (= lead_gen_conversations.session_id) is injected by
 * executeToolCall — the agent never needs to know or pass it.
 */

import axios from 'axios';
import axiosRetry from 'axios-retry';
import { query } from '../database/connection.js';
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

  if (!name || !email) {
    return { success: false, error: 'name and email are required' };
  }

  const results = { db: null, company: null, contact: null, note: null };

  // -------------------------------------------------------------------------
  // 1. Update lead_gen_conversations
  // -------------------------------------------------------------------------
  try {
    const prospectData = {
      company_name:          input.company_name           || null,
      province:              input.province               || null,
      revenue:               input.revenue                || null,
      employee_count:        input.employee_count         || null,
      company_description:   input.company_description    || null,
      activities:            input.activities_summary     || null,
      prior_grant_experience: input.prior_grant_experience || null,
      lead_score:            input.lead_score             || null
    };

    await query(
      `UPDATE lead_gen_conversations
          SET contact_name      = $1,
              contact_email     = $2,
              prospect_data     = $3,
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

    results.db = 'updated';
    console.log(`✅ lead_gen_conversations updated for session ${conversationId}`);
  } catch (err) {
    console.error('❌ DB update failed in saveLeadData:', err.message);
    results.db = { error: err.message };
  }

  // -------------------------------------------------------------------------
  // 2. HubSpot sync
  // -------------------------------------------------------------------------
  if (!HUBSPOT_TOKEN) {
    console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set — skipping HubSpot sync');
    return {
      success: true,
      message: 'Lead data saved to database. HubSpot sync skipped (no token).',
      results
    };
  }

  // 2a. Find or create Contact (first, so we can check its associated companies)
  let contactId = null;
  let contactHadExistingCompany = false;

  try {
    const existingContact = await getContactByEmail(email);

    if (existingContact.success && existingContact.contact) {
      contactId = existingContact.contact.id;
      // Check if HubSpot already associated a company (e.g. auto-created from domain)
      const existingAssociated = existingContact.contact.associations?.companies?.results || [];
      contactHadExistingCompany = existingAssociated.length > 0;
      console.log(`✓ Found existing contact: ${email} (ID: ${contactId})`);

      // Update hs_lead_status on existing contact
      if (input.lead_score) {
        const leadStatusMap = { hot: 'NEW', warm: 'OPEN', cool: 'UNQUALIFIED' };
        const hsLeadStatus = leadStatusMap[input.lead_score];
        if (hsLeadStatus) {
          try {
            const { updateHubSpotContact } = await import('./hubspot.js');
            await updateHubSpotContact(contactId, { hs_lead_status: hsLeadStatus });
            console.log(`✅ Updated hs_lead_status → ${hsLeadStatus} for existing contact ${contactId}`);
          } catch (e) {
            console.warn('⚠️  Could not update hs_lead_status on existing contact:', e.message);
          }
        }
      }

      results.contact = { action: 'found', id: contactId };
    } else {
      const nameParts = name.trim().split(/\s+/);
      const firstname = nameParts[0];
      const lastname  = nameParts.slice(1).join(' ') || undefined;

      // Map lead_score → hs_lead_status: hot→NEW, warm→OPEN, cool→UNQUALIFIED
      const leadStatusMap = { hot: 'NEW', warm: 'OPEN', cool: 'UNQUALIFIED' };
      const hsLeadStatus = leadStatusMap[input.lead_score] || 'NEW';

      const created = await createHubSpotContact({
        email,
        firstname,
        lastname,
        state:          input.province || undefined,
        lifecyclestage: 'lead',
        hs_lead_status: hsLeadStatus
      });

      if (created.success) {
        contactId = created.contact.id;
        console.log(`✅ Contact created: ${email} (ID: ${contactId})`);
        results.contact = { action: 'created', id: contactId };
      } else {
        console.warn('⚠️  Contact creation failed:', created.error);
        results.contact = { action: 'failed', error: created.error };
      }
    }
  } catch (err) {
    console.warn('⚠️  Contact step failed:', err.message);
    results.contact = { action: 'error', error: err.message };
  }

  // 2b. Find or create Company, then populate fields
  let companyId = null;
  let multipleCompaniesFlag = null; // Set if this contact ends up with 2+ companies

  try {
    if (contactHadExistingCompany && contactId) {
      // Contact already has an associated company in HubSpot.
      // Fetch the existing company and compare its name to the one the prospect gave us.
      const existingCompanyId = await getContactAssociatedCompanyId(contactId);

      if (existingCompanyId) {
        const existingCompanyName = await getCompanyName(existingCompanyId);
        const inputName    = (input.company_name || '').trim().toLowerCase();
        const existingName = (existingCompanyName || '').trim().toLowerCase();

        const namesMatch = !inputName || inputName === existingName ||
                           existingName.includes(inputName) || inputName.includes(existingName);

        if (namesMatch) {
          // Same company (or no company name provided) — reuse existing
          companyId = existingCompanyId;
          console.log(`✓ Existing company matches input (ID: ${companyId}): "${existingCompanyName}"`);
          results.company = { action: 'found_via_contact', id: companyId };
        } else {
          // Different company — prospect is using the lead-gen agent for a NEW business.
          // Create a separate company record and associate contact with both.
          // Do NOT overwrite the existing company record.
          console.log(`⚠️  Company name mismatch: existing="${existingCompanyName}", input="${input.company_name}". Creating new company.`);

          let newCompanyId = null;
          const byName = await findCompanyByName(input.company_name);
          if (byName) {
            newCompanyId = byName.id;
            console.log(`✓ Found existing company by name: ${input.company_name} (ID: ${newCompanyId})`);
            results.company = { action: 'found_new', id: newCompanyId };
          } else {
            const created = await createHubSpotCompany({
              name:           input.company_name,
              state:          input.province || undefined,
              lifecyclestage: 'lead'
            });
            if (created.success) {
              newCompanyId = created.company.id;
              console.log(`✅ New company created: ${input.company_name} (ID: ${newCompanyId})`);
              results.company = { action: 'created_new', id: newCompanyId };
            } else {
              console.warn('⚠️  New company creation failed:', created.error);
              results.company = { action: 'failed', error: created.error };
            }
          }

          if (newCompanyId) {
            // Associate contact with the new company (keeps existing association too)
            try {
              await associateContactWithCompany(contactId, newCompanyId);
              console.log(`🔗 Contact ${contactId} now also associated with new company ${newCompanyId}`);
            } catch (err) {
              console.warn('⚠️  Multi-company association failed:', err.message);
            }
            companyId = newCompanyId;
            multipleCompaniesFlag = `This contact is associated with multiple companies. New company "${input.company_name}" created separately to preserve existing record "${existingCompanyName}".`;
          }
        }
      }
    }

    if (!companyId && input.company_name) {
      const existing = await findCompanyByName(input.company_name);
      if (existing) {
        companyId = existing.id;
        console.log(`✓ Found existing company by name: ${input.company_name} (ID: ${companyId})`);
        results.company = { action: 'found', id: companyId };
      } else {
        const created = await createHubSpotCompany({
          name:           input.company_name,
          state:          input.province || undefined,
          lifecyclestage: 'lead'
        });
        if (created.success) {
          companyId = created.company.id;
          console.log(`✅ Company created: ${input.company_name} (ID: ${companyId})`);
          results.company = { action: 'created', id: companyId };
        } else {
          console.warn('⚠️  Company creation failed:', created.error);
          results.company = { action: 'failed', error: created.error };
        }
      }
    }

    // Populate company fields (try/catch per field inside)
    if (companyId) {
      await populateCompanyFields(companyId, input);
    }
  } catch (err) {
    console.warn('⚠️  Company step failed:', err.message);
    results.company = { ...(results.company || {}), populateError: err.message };
  }

  // 2c. Associate Contact → Company (if both exist and not already associated via contact)
  if (contactId && companyId && !contactHadExistingCompany) {
    try {
      await associateContactWithCompany(contactId, companyId);
      console.log(`🔗 Contact ${contactId} associated with company ${companyId}`);
    } catch (err) {
      console.warn('⚠️  Association failed:', err.message);
    }
  }

  // 2d. Create Note
  if (contactId) {
    try {
      const noteBody = buildNoteBody(input, multipleCompaniesFlag);
      const noteId   = await createHubSpotNote(noteBody, contactId, companyId);
      results.note   = { action: 'created', id: noteId };
      console.log(`✅ Note created and associated (ID: ${noteId})`);
    } catch (err) {
      console.warn('⚠️  Note creation failed:', err.message);
      results.note = { action: 'failed', error: err.message };
    }
  }

  return {
    success: true,
    message: `Lead data saved. Contact: ${results.contact?.action || 'skipped'}. Company: ${results.company?.action || 'skipped'}. Note: ${results.note?.action || 'skipped'}.`,
    results
  };
}
