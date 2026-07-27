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
      // Planned activities from form + agent assessment
      planned_activities:     input.planned_activities     || null,
      activity_assessment:    input.activity_assessment    || null,
      // CTA selected (stored in both prospect_data and top-level for finalization)
      cta_selected:           input.cta_selected           || null,
      // Email summary body from agent (for email sending). Included ONLY when
      // provided — the JSONB || merge replaces keys, so writing an explicit
      // null here would wipe a body stored by an earlier save_lead_data call
      // (and with it, upgrade-send eligibility).
      ...(input.email_summary_body ? { email_summary_body: input.email_summary_body } : {})
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
    // Pass the agent's full input through so the form-builder has access to
    // lead_score, prior_grant_experience, prospect_summary, email_summary_body,
    // growth_plans, etc. — fields that don't live in the session row.
    const result = await finalizeLeadGenConversation(conversationId, 'contact_captured', input);

    if (result.success) {
      console.log(`✅ Session finalized via contact_captured`);
    } else if (result.alreadyFinalized) {
      console.log(`ℹ️  Session already finalized — HubSpot records already exist`);
    } else {
      console.warn(`⚠️  Finalization returned non-success:`, result);
    }

    // -------------------------------------------------------------------------
    // 3. Send Email (Independent of finalization — runs even if already finalized)
    // -------------------------------------------------------------------------
    // This is the PRIMARY email sending path. It runs after finalization attempt,
    // regardless of whether finalization succeeded or returned alreadyFinalized.
    // This allows email to be sent when summary button is clicked AFTER estimate delivery.

    const { sendLeadGenEmail } = await import('../api/lead-gen-finalization.js');
    const emailResult = await sendLeadGenEmail(conversationId);

    // Real email outcome, surfaced top-level so the model can be truthful:
    //   'upgraded'     — tailored summary superseded an earlier fallback send
    //   'sent'         — first email delivered
    //   'already_sent' — suppressed by duplicate guard, nothing new delivered
    //   'not_sent'     — not requested, or the send failed
    let emailOutcome;
    if (emailResult.success && emailResult.upgraded) {
      emailOutcome = 'upgraded';
      console.log(`✅ Upgrade email sent via save_lead_data — Message ID: ${emailResult.messageId}`);
    } else if (emailResult.success) {
      emailOutcome = 'sent';
      console.log(`✅ Email sent successfully via save_lead_data — Message ID: ${emailResult.messageId}`);
    } else if (emailResult.alreadySent) {
      emailOutcome = 'already_sent';
      console.log(`ℹ️  Email already sent at ${emailResult.sentAt} — skipping duplicate`);
    } else {
      emailOutcome = 'not_sent';
      console.log(`ℹ️  Email not sent: ${emailResult.error}`);
    }

    const emailStatusLine = {
      upgraded:     'Email summary sent (upgraded — supersedes the earlier automatic email).',
      sent:         'Email summary sent.',
      already_sent: 'Email summary NOT sent — one was already delivered to this prospect earlier. Do not tell the prospect a new email was sent.',
      not_sent:     `Email summary NOT sent (${emailResult.error || 'not requested'}). Do not tell the prospect an email was sent.`
    }[emailOutcome];

    // Return success regardless of email send result (non-blocking)
    return {
      success: true,
      email_outcome: emailOutcome,
      message: (result.success
        ? `Lead data saved and synced to HubSpot. `
        : `Lead data saved. HubSpot: ${result.error || 'already exists'}. `) + emailStatusLine,
      finalization: result,
      email: emailResult
    };
  } catch (err) {
    console.error('❌ Finalization failed:', err.message);
    return {
      success: true,
      message: 'Lead data saved to database, but HubSpot sync failed.',
      error: err.message
    };
  }
}
