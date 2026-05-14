/**
 * Tool Executor
 *
 * Routes and executes tool calls from Claude API.
 * Handles both client-side tools (executed locally) and server tools (executed by Anthropic).
 */

import * as memory from './memory.js';
import * as hubspot from './hubspot.js';
import * as googleDrive from './google-drive.js';
import * as dropbox from './dropbox.js';
import * as googleDocs from './google-docs.js';
import * as googleSheets from './google-sheets.js';
import { createAdvancedDocumentTool } from './google-docs-advanced.js';
import { createAdvancedBudgetTool } from './google-sheets-advanced.js';
import { isServerTool } from './definitions.js';
import * as getgrantedTools from './getgranted-tools.js';
import * as programCards from '../utils/program-cards.js';
import { categorizeProspect } from '../services/grant-categorization.js';
import { runFocusedSearch } from '../services/grant-search-pipeline.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse JSON string parameters that Claude sometimes sends as strings
 * @param {any} value - Value that might be a JSON string
 * @returns {any} Parsed value or original value
 */
function parseJSONParameter(value) {
  // If not a string, return as-is
  if (typeof value !== 'string') {
    return value;
  }

  // If string doesn't look like JSON, return as-is
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return value;
  }

  // Try to parse as JSON
  try {
    return JSON.parse(value);
  } catch (e) {
    // If parsing fails, return original value
    console.warn(`⚠️  Failed to parse JSON parameter: ${value.substring(0, 100)}...`);
    return value;
  }
}

/**
 * Build prospect data from session for categorization
 * @param {string} conversationId - Lead-gen session ID
 * @returns {Promise<Object|null>} Prospect data or null if not available
 */
async function buildProspectDataFromSession(conversationId) {
  try {
    const { query: dbQuery } = await import('../database/connection.js');

    const result = await dbQuery(
      `SELECT prospect_data, company_background FROM lead_gen_conversations WHERE session_id = $1`,
      [conversationId]
    );

    if (result.rows.length === 0) {
      console.log('  ⚠️  No lead-gen session found');
      return null;
    }

    const session = result.rows[0];
    const prospectData = session.prospect_data || {};
    const companyBackground = session.company_background || {};

    // Map form data to categorization input format
    // DIAGNOSTIC: Log raw form values before parsing
    console.log('  📋 Raw form values from prospect_data:');
    console.log(`     hiring_plans: "${prospectData.hiring_plans}"`);
    console.log(`     training_budget: "${prospectData.training_budget}"`);
    console.log(`     expansion_budget: "${prospectData.expansion_budget}"`);
    console.log(`     planned_activities: "${prospectData.planned_activities}"`);

    const hiringParsed = parseHiringPlans(prospectData.hiring_plans);
    const trainingParsed = parseSpendAmount(prospectData.training_budget);
    const expansionParsed = parseSpendAmount(prospectData.expansion_budget);

    console.log('  🔢 Parsed numeric values:');
    console.log(`     num_hires: ${hiringParsed.num_hires}, num_student_hires: ${hiringParsed.num_student_hires}`);
    console.log(`     annual_training_spend: $${trainingParsed}`);
    console.log(`     international_market_spend: $${expansionParsed}`);

    const data = {
      // Industry (prioritize form dropdown selection over Haiku extraction)
      // Form uses exact grant vocabulary like "Tech - Software/Web Development", "Retail"
      industry: prospectData.industry || companyBackground.industry || null,

      // Province (normalize to code: "British Columbia" → "BC")
      province: normalizeProvince(prospectData.province) || 'ON',

      // Revenue tier mapping
      revenue_tier: mapRevenueTier(prospectData.revenue_range),

      // Employee count (parse from range string)
      num_ftes: parseEmployeeCount(prospectData.employee_count),

      // Hiring plans (parsed values)
      ...hiringParsed,

      // Training budget (parsed value)
      annual_training_spend: trainingParsed,

      // Market expansion (parsed value)
      international_market_spend: expansionParsed,

      // R&D spend (not collected in form yet, default to 0)
      rd_spend: 0,

      // Incorporation status (assume yes if they have revenue)
      is_incorporated_1yr: prospectData.revenue_range !== 'Pre-revenue',

      // Nonprofit status (assume no unless explicitly indicated)
      is_nonprofit: false,

      // Funds raised (not collected in form, default to 0)
      funds_raised: 0,

      // Activity text for keyword boost
      planned_activities: prospectData.planned_activities || null
    };

    console.log('  ✅ Built prospect data from session:', JSON.stringify(data, null, 2));
    return data;

  } catch (error) {
    console.error('  ❌ Failed to build prospect data:', error.message);
    return null;
  }
}

/**
 * Province name to code mapping
 */
const PROVINCE_CODES = {
  'ontario': 'ON', 'british columbia': 'BC', 'alberta': 'AB',
  'quebec': 'QC', 'manitoba': 'MB', 'saskatchewan': 'SK',
  'nova scotia': 'NS', 'new brunswick': 'NB',
  'prince edward island': 'PE', 'newfoundland and labrador': 'NL',
  'northwest territories': 'NT', 'yukon': 'YT', 'nunavut': 'NU',
  // Also handle codes passed directly
  'on': 'ON', 'bc': 'BC', 'ab': 'AB', 'qc': 'QC', 'mb': 'MB', 'sk': 'SK',
  'ns': 'NS', 'nb': 'NB', 'pe': 'PE', 'nl': 'NL', 'nt': 'NT', 'yt': 'YT', 'nu': 'NU'
};

/**
 * Normalize province name to code
 */
function normalizeProvince(province) {
  if (!province) return null;
  return PROVINCE_CODES[province.toLowerCase()] || province;
}

/**
 * Generic parser for webform range strings
 * Handles: "5 – 19", "$10K – $25K", "Under $10K", "$5M+", "1 – 2 people"
 */
function parseWebformRange(value) {
  if (!value || typeof value !== 'string') return 0;

  let s = value.replace(/people|employees|hires/gi, '').trim();

  // Helper to parse a single number token like "$10K" or "2.5M" or "500"
  function parseNumberToken(token) {
    token = token.replace(/[$,]/g, '').trim();
    let multiplier = 1;
    if (/mm/i.test(token)) { multiplier = 1000000; token = token.replace(/mm/i, ''); }
    else if (/m/i.test(token)) { multiplier = 1000000; token = token.replace(/m/i, ''); }
    else if (/k/i.test(token)) { multiplier = 1000; token = token.replace(/k/i, ''); }
    const num = parseFloat(token);
    return isNaN(num) ? 0 : num * multiplier;
  }

  // "Under X" or "Less than X" → use half
  if (/under|less than|<\s*/i.test(s)) {
    const num = parseNumberToken(s.replace(/under|less than|<\s*/i, ''));
    return Math.round(num / 2);
  }

  // "X+" or "X or more" or "Over X" → use the number as-is (or slightly higher for "Over")
  if (/\+|or more|plus/i.test(s)) {
    return parseNumberToken(s.replace(/\+|or more|plus/gi, ''));
  }
  if (/over|>\s*/i.test(s)) {
    return parseNumberToken(s.replace(/over|>\s*/i, ''));
  }

  // Range: "X – Y" or "X to Y" or "X - Y" (various dash types)
  const rangeMatch = s.match(/(.+?)(?:\s*[–\-—]\s*|\s+to\s+)(.+)/i);
  if (rangeMatch) {
    const low = parseNumberToken(rangeMatch[1]);
    const high = parseNumberToken(rangeMatch[2]);
    return Math.round((low + high) / 2);
  }

  // Single number
  return parseNumberToken(s);
}

/**
 * Map revenue range string to tier enum
 */
function mapRevenueTier(revenueRange) {
  if (!revenueRange) return 'unknown';

  const s = revenueRange.toLowerCase().replace(/\s+/g, '');

  // Pre-revenue
  if (s.includes('pre-revenue') || s.includes('prerevenue') || s === '0') return 'pre_revenue';

  // Under $500K or $100K to $500K
  if ((s.includes('under') || s.includes('<')) && s.includes('500k')) return 'lt_500k';
  if ((s.includes('under') || s.includes('<')) && s.includes('100k')) return 'lt_500k';
  if (s.includes('100k') && s.includes('500k')) return 'lt_500k';

  // $500K to $2.5MM (or $2M or $2.5M)
  if (s.includes('500k') && (s.includes('2.5') || s.includes('2m') || s.includes('2mm'))) return '500k_2.5mm';

  // $2.5MM to $5MM (or variations)
  if ((s.includes('2.5') || s.includes('2m')) && (s.includes('5m') || s.includes('5mm'))) return '2.5mm_5mm';

  // Over $5MM
  if ((s.includes('over') || s.includes('>') || s.includes('+')) && (s.includes('5m') || s.includes('5mm'))) return '5mm_plus';

  return 'unknown';
}

/**
 * Parse employee count from range string using generic parser
 */
function parseEmployeeCount(employeeCount) {
  if (!employeeCount) return 0;
  return parseWebformRange(employeeCount);
}

/**
 * Parse hiring plans text to extract hire counts
 */
function parseHiringPlans(hiringPlans) {
  const result = {
    num_hires: 0,
    num_student_hires: 0,
    num_recent_grad_hires: 0
  };

  if (!hiringPlans) return result;

  const text = hiringPlans.toLowerCase();

  // Parse the numeric value (could be range like "1 – 2" or single number)
  const numHires = parseWebformRange(hiringPlans);

  if (numHires > 0) {
    if (text.includes('student') || text.includes('co-op') || text.includes('intern')) {
      result.num_student_hires = numHires;
    } else if (text.includes('recent grad') || text.includes('graduate')) {
      result.num_recent_grad_hires = numHires;
    } else {
      result.num_hires = numHires;
    }
  }

  return result;
}

/**
 * Parse spend amount from range string using generic parser
 */
function parseSpendAmount(spendRange) {
  if (!spendRange) return 0;
  if (/none/i.test(spendRange)) return 0;
  return parseWebformRange(spendRange);
}

/**
 * Execute a tool call from Claude
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} input - Tool input parameters
 * @param {string} conversationId - UUID of the conversation
 * @param {number} userId - User ID (for domain-wide delegation)
 * @param {string} agentType - Agent type (for agent-specific tool behavior)
 * @returns {Promise<Object>} Tool execution result
 */
export async function executeToolCall(toolName, input, conversationId, userId = null, agentType = null) {
  console.log(`🔧 Executing tool: ${toolName}`);
  console.log(`   Input:`, JSON.stringify(input, null, 2));

  // Get user email for domain-wide delegation (Google Drive search tool)
  // Note: Google Docs creation now uses userId directly with OAuth
  let userEmail = null;
  if (userId && toolName.includes('search_google')) {
    try {
      const { query } = await import('../database/connection.js');
      const result = await query('SELECT email FROM users WHERE id = $1', [userId]);
      if (result.rows.length > 0) {
        userEmail = result.rows[0].email;
        console.log(`   User email for domain-wide delegation: ${userEmail}`);
      }
    } catch (error) {
      console.warn(`   Could not fetch user email: ${error.message}`);
    }
  }

  // Check if this is a server tool (should not reach here)
  if (isServerTool(toolName)) {
    console.warn(`⚠️  Server tool ${toolName} was sent to client executor - this should not happen`);
    return {
      success: false,
      error: `${toolName} is a server-side tool and cannot be executed on the client`
    };
  }

  try {
    let result;

    // Route to appropriate tool implementation
    switch (toolName) {
      // ============================================================================
      // MEMORY TOOLS
      // ============================================================================

      case 'memory_store':
        result = await memory.storeMemory(conversationId, input.key, input.value);

        // For lead-gen sessions: progressively save business profile data to prospect_data JSONB
        if (agentType === 'lead-gen' && conversationId) {
          // Map memory keys to prospect_data fields
          const prospectDataKeys = [
            'province', 'industry', 'revenue', 'employee_count', 'employees',
            'company_name', 'activities', 'years_in_operation', 'is_incorporated',
            'hiring_plans', 'training_investment', 'market_expansion_plans',
            'rd_activity', 'prior_grant_experience',
            // Strategic qualification fields (Pass 2)
            'timeline', 'budget_committed', 'is_decision_maker', 'growth_plans',
            'existing_consultant',
            // Funding estimate fields
            'estimated_funding', 'available_now_funding', 'programs_matched_count'
          ];

          if (prospectDataKeys.includes(input.key)) {
            try {
              const { query: dbQuery } = await import('../database/connection.js');

              // Normalize employee_count vs employees
              const fieldName = input.key === 'employees' ? 'employee_count' : input.key;

              // JSONB merge: preserve existing fields, add/update this field
              await dbQuery(
                `UPDATE lead_gen_conversations
                 SET prospect_data = prospect_data || $1::jsonb,
                     updated_at = NOW()
                 WHERE session_id = $2`,
                [JSON.stringify({ [fieldName]: input.value }), conversationId]
              );

              console.log(`✓ Prospect data updated: ${fieldName} = ${JSON.stringify(input.value).substring(0, 100)}`);
            } catch (err) {
              console.warn(`⚠️  Failed to update prospect_data for ${input.key}:`, err.message);
            }
          }

          // Stage 1 HubSpot creation removed (Phase 2 / 2026-05-04). All HubSpot
          // writes now happen in the Stage 2 path (`finalizeLeadGenConversation`,
          // called from save_lead_data) using the Forms API. Variant B's prompt
          // calls save_lead_data immediately after delivering the estimate, so
          // there's no meaningful gap between memory_store('estimated_funding')
          // and the consolidated form submission. The 5-minute inactivity-timeout
          // cron is the safety net for sessions that error before save_lead_data.

          // Also store matched_programs in top-level field for finalization
          if (input.key === 'matched_programs' && input.value) {
            try {
              const { query: dbQuery } = await import('../database/connection.js');

              await dbQuery(
                `UPDATE lead_gen_conversations
                 SET matched_programs = $1,
                     updated_at = NOW()
                 WHERE session_id = $2`,
                [JSON.stringify(input.value), conversationId]
              );

              console.log(`✓ Matched programs stored: ${Array.isArray(input.value) ? input.value.length : 0} programs`);
            } catch (err) {
              console.warn(`⚠️  Failed to store matched_programs:`, err.message);
            }
          }
        }

        break;

      case 'memory_recall':
        result = await memory.recallMemory(conversationId, input.key);
        break;

      case 'memory_list':
        result = await memory.listMemories(conversationId);
        break;

      // ============================================================================
      // ANTHROPIC FILE-BASED MEMORY TOOL
      // Cross-conversation persistent memory in /memories/ directory
      // ============================================================================

      case 'memory':
        // Import the memory tool handler
        const { handleMemoryTool } = await import('../../api/memory-tool-handler.js');

        // Extract command from input
        const { command, ...memoryInput } = input;

        if (!command) {
          result = {
            success: false,
            error: 'Memory tool requires a "command" field (view, create, str_replace, insert, delete, rename)'
          };
        } else {
          result = await handleMemoryTool(command, memoryInput);
        }
        break;

      // ============================================================================
      // TOOL SEARCH
      // On-demand tool discovery using semantic search
      // ============================================================================

      case 'tool_search':
        const { handleToolSearch } = await import('./tool-search.js');
        const toolReferences = await handleToolSearch(input.query, input.top_k || 5);
        // Return tool_reference objects for Claude to use
        result = {
          success: true,
          tools_found: toolReferences.length,
          tool_references: toolReferences
        };
        break;

      // ============================================================================
      // HUBSPOT TOOLS
      // ============================================================================

      case 'search_hubspot_contacts':
        // Extract filters into object (all filter params except query and limit)
        const contactFilters = {
          lifecycle_stage: input.lifecycle_stage,
          createdate_after: input.createdate_after,
          createdate_before: input.createdate_before,
          lastmodifieddate_after: input.lastmodifieddate_after,
          lastmodifieddate_before: input.lastmodifieddate_before,
          owner_id: input.owner_id,
          hs_lead_status: input.hs_lead_status,
          custom_filters: parseJSONParameter(input.custom_filters) || [],
          sort_by: input.sort_by,
          sort_order: input.sort_order || 'DESC'
        };
        result = await hubspot.searchHubSpotContacts(input.query, input.limit, contactFilters);
        break;

      case 'get_hubspot_contact':
        result = await hubspot.getHubSpotContact(input.contact_id);
        break;

      case 'get_hubspot_company':
        result = await hubspot.getCompanyById(input.company_id);
        break;

      case 'get_contact_by_email':
        result = await hubspot.getContactByEmail(input.email);
        break;

      case 'search_hubspot_companies':
        // Extract filters into object (all filter params except query, min_revenue, max_revenue)
        const companyFilters = {
          lifecycle_stage: input.lifecycle_stage,
          createdate_after: input.createdate_after,
          createdate_before: input.createdate_before,
          lastmodifieddate_after: input.lastmodifieddate_after,
          lastmodifieddate_before: input.lastmodifieddate_before,
          owner_id: input.owner_id,
          type: input.type,
          custom_filters: parseJSONParameter(input.custom_filters) || [],
          sort_by: input.sort_by,
          sort_order: input.sort_order || 'DESC'
        };
        result = await hubspot.searchHubSpotCompanies(
          input.query,
          input.min_revenue,
          input.max_revenue,
          companyFilters
        );
        break;

      case 'get_company_by_domain':
        result = await hubspot.getCompanyByDomain(input.domain);
        break;

      case 'get_company_by_id':
        result = await hubspot.getCompanyById(input.company_id);
        break;

      case 'create_hubspot_company':
        result = await hubspot.createHubSpotCompany(input);
        break;

      case 'update_hubspot_company':
        result = await hubspot.updateHubSpotCompany(input.company_id, parseJSONParameter(input.properties));
        break;

      case 'create_hubspot_contact':
        result = await hubspot.createHubSpotContact(input);
        break;

      case 'update_hubspot_contact':
        result = await hubspot.updateHubSpotContact(input.contact_id, parseJSONParameter(input.properties));
        break;

      case 'create_hubspot_deal':
        result = await hubspot.createHubSpotDeal({
          properties: parseJSONParameter(input.properties),
          associations: parseJSONParameter(input.associations) || {}
        });
        break;

      case 'update_hubspot_deal':
        result = await hubspot.updateHubSpotDeal(input.deal_id, parseJSONParameter(input.properties));
        break;

      case 'associate_contact_with_company':
        result = await hubspot.associateContactWithCompany(input.contact_id, input.company_id);
        break;

      case 'verify_company_website':
        result = await hubspot.verifyCompanyWebsite(input.domain);
        break;

      case 'find_duplicate_companies':
        result = await hubspot.findDuplicateCompanies(input);
        break;

      case 'find_duplicate_contacts':
        result = await hubspot.findDuplicateContacts(input.email);
        break;

      case 'merge_duplicate_companies':
        result = await hubspot.mergeDuplicateCompanies(input.primary_company_id, input.secondary_company_id);
        break;

      case 'merge_duplicate_contacts':
        result = await hubspot.mergeDuplicateContacts(input.primary_contact_id, input.secondary_contact_id);
        break;

      case 'list_hubspot_owners':
        result = await hubspot.listHubSpotOwners();
        break;

      case 'generate_hubspot_embed_link':
        result = await hubspot.generateHubSpotEmbedLink(
          input.object_type,
          input.record_id,
          input.view
        );
        break;

      case 'search_grant_applications':
        // Pass all input parameters as filters object (enhanced search with comprehensive filtering)
        result = await hubspot.searchGrantApplications(input, agentType);
        break;

      case 'get_grant_application':
        result = await hubspot.getGrantApplication(input.application_id, agentType);
        break;

      case 'get_project_email_history':
        result = await hubspot.getProjectEmailHistory(
          input.deal_id,
          input.limit
        );
        break;

      case 'search_project_emails':
        result = await hubspot.searchProjectEmails(
          input.deal_id,
          input.search_term,
          input.limit
        );
        break;

      case 'get_email_details':
        result = await hubspot.getEmailDetails(input.email_id);
        break;

      case 'get_email_attachments':
        result = await hubspot.getEmailAttachments(input.email_id);
        break;

      case 'get_deal_files':
        result = await hubspot.getDealFiles(input.deal_id);
        break;

      case 'get_contact_files':
        result = await hubspot.getContactFiles(input.contact_id);
        break;

      case 'get_file_by_id':
        result = await hubspot.getFileById(input.file_id_or_url);
        break;

      case 'read_hubspot_file':
        result = await hubspot.readHubSpotFile(input.file_id_or_url);
        break;

      // ============================================================================
      // CONSOLIDATED HUBSPOT TOOLS (Phase 2)
      // ============================================================================

      case 'load_company_context':
        result = await hubspot.loadCompanyContext({
          company_name: input.company_name,
          grant_program: input.grant_program,
          include_emails: input.include_emails !== undefined ? input.include_emails : true,
          email_limit: input.email_limit || 20,
          load_funding_agreement: input.load_funding_agreement || false,
          agent_type: agentType
        });
        break;

      case 'find_and_read_funding_agreement':
        result = await hubspot.findAndReadFundingAgreement({
          deal_id: input.deal_id,
          company_name: input.company_name,
          grant_program: input.grant_program,
          return_content: input.return_content !== undefined ? input.return_content : true,
          max_content_length: input.max_content_length || 50000,
          parse_fields: input.parse_fields !== undefined ? input.parse_fields : true,
          agent_type: agentType
        });
        break;

      case 'get_hubspot_notes':
        result = await hubspot.getHubSpotNotes(
          input.object_type,
          input.record_id,
          input.limit || 20
        );
        break;

      case 'get_program_stats':
        result = await hubspot.getProgramStats(
          input.program_name,
          { include_starter: input.include_starter !== false }
        );
        break;

      case 'get_deal_count':
        result = await hubspot.getDealCount(
          input.program_name,
          {
            date_range_months: input.date_range_months ?? 12,
            include_starter: input.include_starter !== false
          }
        );
        break;

      // ============================================================================
      // GOOGLE DRIVE TOOLS
      // ============================================================================

      case 'search_google_drive':
        result = await googleDrive.searchGoogleDrive(
          input.query,
          input.file_type,
          input.limit,
          userEmail  // For domain-wide delegation
        );
        break;

      case 'read_google_drive_file':
        result = await googleDrive.readGoogleDriveFile(
          input.file_id,
          userEmail  // For domain-wide delegation
        );
        break;

      // ============================================================================
      // DROPBOX TOOLS
      // ============================================================================

      case 'read_dropbox_file':
        result = await dropbox.readDropboxFile(input.file_path);
        break;

      // ============================================================================
      // ORACLE TOOLS
      // ============================================================================

      case 'search_oracle_kb':
        const { searchOracleHybrid } = await import('./oracle-search-rag.js');
        result = await searchOracleHybrid(input.query, {
          department: input.department,
          fileType: input.fileType,
          limit: input.limit
        });
        break;

      case 'get_visualping_alerts':
        const { getVisualPingAlerts } = await import('./visualping-alerts.js');
        result = await getVisualPingAlerts({
          limit: input.limit,
          priority: input.priority,
          change_type: input.change_type,
          days: input.days
        });
        break;

      case 'check_blog_coverage':
        const { checkBlogCoverage } = await import('./blog-coverage.js');
        result = await checkBlogCoverage({
          topic: input.topic,
          slug: input.slug,
          modified_after: input.modified_after,
          category: input.category
        });
        break;

      case 'check_marketing_calendar':
        const { checkMarketingCalendar } = await import('./marketing-calendar.js');
        result = await checkMarketingCalendar(userId, {
          topic: input.topic,
          content_type: input.content_type,
          month: input.month
        });
        break;

      case 'get_recent_granted_ca_post':
        const { getRecentGrantedCaPost } = await import('./blog-coverage.js');
        result = await getRecentGrantedCaPost({
          category: input.category,
          days: input.days,
          limit: input.limit
        });
        break;

      // ============================================================================
      // LEAD-GEN KNOWLEDGE BASE TOOLS
      // ============================================================================

      case 'search_lead_gen_knowledge': {
        const { searchLeadGenKnowledge } = await import('./lead-gen-knowledge.js');
        result = searchLeadGenKnowledge({ query: input.query });
        break;
      }

      case 'search_lead_gen_strategy': {
        const { searchLeadGenStrategy } = await import('./lead-gen-knowledge.js');
        result = searchLeadGenStrategy({ query: input.query });
        break;
      }

      case 'save_lead_data': {
        const { saveLeadData } = await import('./save-lead-data.js');
        // conversationId === session_id in lead_gen_conversations — injected by executeToolCall
        result = await saveLeadData(input, conversationId);

        // Log contact_captured analytics event on success
        if (result.success && conversationId) {
          try {
            const { query: dbQuery } = await import('../database/connection.js');
            await dbQuery(
              `INSERT INTO lead_gen_analytics (conversation_id, event_type, event_data)
               VALUES ($1, $2, $3)`,
              [conversationId, 'contact_captured', JSON.stringify({
                lead_score:     input.lead_score    || null,
                cta_selected:   input.cta_selected  || null,
                programs_count: (input.matched_programs || []).length
              })]
            );
          } catch (e) {
            console.warn('⚠️  Analytics log failed (contact_captured):', e.message);
          }
        }
        break;
      }

      case 'search_getgranted': {
        const { searchGetGranted } = await import('./getgranted-search.js');

        // Infrastructure-enhanced search for lead-gen agent
        let categorization = null;
        let mergedEstimate = null;
        let usedFocusedSearch = false;

        if (agentType === 'lead-gen' && conversationId) {
          console.log('\n🏗️  INFRASTRUCTURE-ENHANCED SEARCH STARTING...');

          try {
            // Step 1: Build prospect data from session
            const prospectData = await buildProspectDataFromSession(conversationId);

            if (prospectData) {
              // Step 2: Categorize prospect (async - includes AI smart filter mapping)
              // Note: categorizeProspect() handles missing industry by defaulting to Group 1
              console.log('  🏷️  Running categorization...');
              categorization = await categorizeProspect(prospectData);

              if (categorization) {
                // Step 3: Run focused search using categorization
                console.log('  🔍 Running focused search...');

                const searchResults = await runFocusedSearch(
                  categorization,
                  async (searchParams) => {
                    return await searchGetGranted({
                      query: searchParams.query,
                      purposes: searchParams.purposes,
                      regions: [searchParams.province],
                      industries: [],
                      active_only: input.active_only,
                      open_intakes_only: input.open_intakes_only,
                      limit: searchParams.limit || 15,
                      fetch_full_details: input.fetch_full_details,
                      bypass_cache: input.bypass_cache
                    });
                  },
                  conversationId,
                  prospectData  // Pass prospect data for eligibility scoring
                );

                // Step 4: Use baseline estimate (merge removed - was pulling estimates down)
                console.log('  ✅ Using baseline estimate (merge disabled)');
                mergedEstimate = {
                  estimate: categorization.baseline_estimate,
                  confidence_level: searchResults.programs_found.length >= 8 ? 'high' : searchResults.programs_found.length >= 3 ? 'medium' : 'low',
                  service_tier: categorization.service_tier,
                  tier_reasoning: categorization.tier_reasoning,
                  consultant_assignment: categorization.consultant_assignment,
                  booking_link: categorization.booking_link,
                  agent_talking_points: [],  // Agent generates these from baseline + programs
                  programs_for_hubspot: searchResults.all_program_names,
                  matched_programs_detail: searchResults.programs_found
                };

                // Step 5: Store in conversation_memory
                const { query: dbQuery } = await import('../database/connection.js');

                await dbQuery(
                  `INSERT INTO conversation_memory (conversation_id, key, value)
                   VALUES ($1, 'categorization', $2)
                   ON CONFLICT (conversation_id, key)
                   DO UPDATE SET value = $2`,
                  [conversationId, JSON.stringify(categorization)]
                );

                await dbQuery(
                  `INSERT INTO conversation_memory (conversation_id, key, value)
                   VALUES ($1, 'merged_estimate', $2)
                   ON CONFLICT (conversation_id, key)
                   DO UPDATE SET value = $2`,
                  [conversationId, JSON.stringify(mergedEstimate)]
                );

                console.log('  ✅ Stored categorization + merged_estimate in conversation_memory');

                // Step 6: Override auto_matched_grants with filtered programs
                const grantNames = mergedEstimate.programs_for_hubspot || [];
                await dbQuery(
                  `INSERT INTO conversation_memory (conversation_id, key, value)
                   VALUES ($1, 'auto_matched_grants', $2)
                   ON CONFLICT (conversation_id, key)
                   DO UPDATE SET value = $2`,
                  [conversationId, JSON.stringify(grantNames)]
                );

                console.log(`  ✅ Auto-captured ${grantNames.length} grant names from focused search`);

                // Step 6.5: Add tier-specific reminder for Starter/GetGranted prospects
                const tier = categorization.service_tier?.toLowerCase();
                if (tier === 'starter' || tier === 'getgranted') {
                  const tierReminder = "CRITICAL REMINDER: This is a Starter/GetGranted prospect. You MUST mention GetGranted 2.0 in your opening message. Include this exact line somewhere in your response: 'We're also launching GetGranted 2.0 — an all-in-one grant platform starting at $55/month. You can join the waitlist at <a href=\"https://getgranted.ca/waitlist/\">getgranted.ca/waitlist</a>.'";

                  await dbQuery(
                    `INSERT INTO conversation_memory (conversation_id, key, value)
                     VALUES ($1, 'tier_specific_reminder', $2)
                     ON CONFLICT (conversation_id, key)
                     DO UPDATE SET value = $2`,
                    [conversationId, JSON.stringify(tierReminder)]
                  );

                  console.log(`  ✅ Added tier-specific reminder for ${tier} prospect`);
                }

                // Step 7: Format result to match expected structure
                result = {
                  success: true,
                  grants: searchResults.programs_found.map(p => ({
                    grant_name: p.grant_name || p.name,
                    grant_amount: p.max_grant_amount || p.grant_amount || 'amount varies',
                    currently_accepting: p.currently_accepting || p.status === 'open' || p.accepting_applications,
                    intake_cycle: p.intake_cycle || null,
                    description: p.description || null,
                    purposes: p.purposes || [],
                    categories: p.categories || []
                  })),
                  count: searchResults.programs_found.length,
                  message: `Found ${searchResults.programs_found.length} programs using infrastructure-enhanced search`
                };

                usedFocusedSearch = true;
                console.log('✅ INFRASTRUCTURE-ENHANCED SEARCH COMPLETE\n');
              }
            } else {
              console.log('  ⚠️  No prospect data available - falling back to standard search');
            }
          } catch (error) {
            console.error('  ❌ Infrastructure-enhanced search failed:', error.message);
            console.log('  ⚠️  Falling back to standard search');
          }
        }

        // Fallback: Standard search (if not lead-gen, or if categorization failed)
        if (!usedFocusedSearch) {
          result = await searchGetGranted({
            query: input.query,
            purposes: parseJSONParameter(input.purposes),
            regions: parseJSONParameter(input.regions),
            industries: parseJSONParameter(input.industries),
            business_type: input.business_type,
            owner_demographics: parseJSONParameter(input.owner_demographics),
            company_size_min: input.company_size_min,
            company_size_max: input.company_size_max,
            active_only: input.active_only,
            open_intakes_only: input.open_intakes_only,
            limit: input.limit,
            fetch_full_details: input.fetch_full_details,
            bypass_cache: input.bypass_cache
          });
        }

        // Log search_performed analytics for lead-gen agent
        if (agentType === 'lead-gen' && conversationId) {
          try {
            const { query: dbQuery } = await import('../database/connection.js');
            await dbQuery(
              `INSERT INTO lead_gen_analytics (conversation_id, event_type, event_data)
               VALUES ($1, $2, $3)`,
              [conversationId, 'search_performed', JSON.stringify({
                query:         input.query || null,
                results_count: result.results?.length || result.grants?.length || 0,
                used_infrastructure: usedFocusedSearch
              })]
            );
          } catch (e) {
            console.warn('⚠️  Analytics log failed (search_performed):', e.message);
          }

          // Auto-capture exact grant names from search results (if not already done by focused search)
          if (!usedFocusedSearch && result.success && result.grants && result.grants.length > 0) {
            try {
              const { query: dbQuery } = await import('../database/connection.js');

              // Extract actual grant names with amounts and status
              const grantNames = result.grants.map(g => {
                const status = g.currently_accepting ? 'active' : (g.intake_cycle ? `cyclical - ${g.intake_cycle}` : 'inactive');
                const amount = g.grant_amount || 'amount varies';
                return `${g.grant_name} (${amount}, ${status})`;
              });

              // Load existing auto_matched_grants (agent searches twice: active + all)
              const existingResult = await dbQuery(
                `SELECT value FROM conversation_memory WHERE conversation_id = $1 AND key = 'auto_matched_grants'`,
                [conversationId]
              );

              let allGrants = [];
              if (existingResult.rows.length > 0) {
                try {
                  allGrants = JSON.parse(existingResult.rows[0].value);
                } catch {
                  allGrants = [];
                }
              }

              // Deduplicate by grant_name (agent searches twice, may get overlaps)
              const existingNames = new Set(allGrants.map(g => g.split(' (')[0]));
              for (const grant of grantNames) {
                const name = grant.split(' (')[0];
                if (!existingNames.has(name)) {
                  allGrants.push(grant);
                  existingNames.add(name);
                }
              }

              // Store/update in conversation_memory
              await dbQuery(
                `INSERT INTO conversation_memory (conversation_id, key, value)
                 VALUES ($1, 'auto_matched_grants', $2)
                 ON CONFLICT (conversation_id, key)
                 DO UPDATE SET value = $2`,
                [conversationId, JSON.stringify(allGrants)]
              );

              console.log(`✅ Auto-captured ${allGrants.length} grant names from search results`);
            } catch (e) {
              console.warn('⚠️  Auto-capture of grant names failed:', e.message);
            }
          }
        }
        break;
      }

      case 'load_skill':
        const { loadSkill } = await import('./load-skill.js');
        result = await loadSkill({
          skill_name: input.skill_name,
          sub_skill: input.sub_skill
        });
        break;

      // ============================================================================
      // GOOGLE DOCS & SHEETS TOOLS
      // ============================================================================

      case 'create_google_drive_folder':
        result = await googleDrive.createGoogleDriveFolder(
          input.folder_name,
          userId  // User ID for OAuth
        );
        break;

      case 'copy_template_file':
        result = await googleDrive.copyTemplateFile(
          input.template_file_id_or_name,
          input.new_file_name,
          input.target_folder_id,
          userId  // User ID for OAuth
        );
        break;

      case 'create_advanced_budget':
        result = await createAdvancedBudgetTool(input, {
          conversationId,
          userId,
          agentType
        });
        break;

      // ============================================================================
      // GOOGLE SHEETS — read/write
      // ============================================================================
      case 'read_sheet_range':
        result = await googleSheets.readSheetRange(userId, input);
        break;
      case 'read_sheet_metadata':
        result = await googleSheets.readSheetMetadata(userId, input);
        break;
      case 'update_sheet_range':
        result = await googleSheets.updateSheetRange(userId, input);
        break;
      case 'append_sheet_row':
        result = await googleSheets.appendSheetRow(userId, input);
        break;

      case 'create_advanced_document':
        result = await createAdvancedDocumentTool(input, {
          conversationId,
          userId,
          agentType
        });
        break;

      case 'create_google_doc':
        result = await googleDocs.createGoogleDoc(
          input.title,
          input.content,
          null,  // folderName - not used when parentFolderId is provided
          userId,
          null,  // logoPath - default branding
          input.parentFolderId || null
        );
        break;

      // ============================================================================
      // CANEXPORT WRITER TOOLS
      // ============================================================================

      case 'check_character_count':
        result = checkCharacterCount(input.section_number, input.section_name, input.text);
        break;

      // ============================================================================
      // GETGRANTED AI TOOLS
      // ============================================================================

      case 'listAvailablePrograms':
        result = programCards.listAvailablePrograms();
        break;

      case 'loadProgramCard':
        result = programCards.loadProgramCard(input.programId);
        break;

      case 'calculateMERCs':
        result = getgrantedTools.calculateMERCs(input);
        break;

      case 'convertSalary':
        result = getgrantedTools.convertSalary(input.amount, input.direction, input.hoursPerWeek);
        break;

      case 'getGrantedLookup':
        result = await getgrantedTools.getGrantedLookup(input.query, input.filters);
        break;

      // ============================================================================
      // GRANOLA (remote MCP server, per-user OAuth)
      // ============================================================================
      case 'granola_query_meetings': {
        const { granolaQueryMeetings } = await import('./granola.js');
        result = await granolaQueryMeetings(input, { conversationId, userId, agentType });
        break;
      }
      case 'granola_list_meetings': {
        const { granolaListMeetings } = await import('./granola.js');
        result = await granolaListMeetings(input, { conversationId, userId, agentType });
        break;
      }
      case 'granola_get_meetings': {
        const { granolaGetMeetings } = await import('./granola.js');
        result = await granolaGetMeetings(input, { conversationId, userId, agentType });
        break;
      }
      case 'granola_get_meeting_transcript': {
        const { granolaGetMeetingTranscript } = await import('./granola.js');
        result = await granolaGetMeetingTranscript(input, { conversationId, userId, agentType });
        break;
      }
      case 'granola_list_meeting_folders': {
        const { granolaListMeetingFolders } = await import('./granola.js');
        result = await granolaListMeetingFolders(input, { conversationId, userId, agentType });
        break;
      }

      // ============================================================================
      // UNKNOWN TOOL
      // ============================================================================

      default:
        console.error(`❌ Unknown tool: ${toolName}`);
        result = {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
    }

    console.log(`✅ Tool ${toolName} completed`);
    console.log(`   Result:`, JSON.stringify(result, null, 2).substring(0, 500) + '...');

    return result;

  } catch (error) {
    console.error(`❌ Tool ${toolName} failed:`, error);

    return {
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
}

/**
 * Execute multiple tool calls in parallel
 * @param {Array} toolCalls - Array of {toolName, input, toolUseId}
 * @param {string} conversationId - UUID of the conversation
 * @returns {Promise<Array>} Array of tool results
 */
export async function executeToolCalls(toolCalls, conversationId) {
  console.log(`🔧 Executing ${toolCalls.length} tool calls in parallel`);

  const results = await Promise.all(
    toolCalls.map(async ({ toolName, input, toolUseId }) => {
      const result = await executeToolCall(toolName, input, conversationId);

      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: JSON.stringify(result)
      };
    })
  );

  console.log(`✅ All ${toolCalls.length} tool calls completed`);

  return results;
}

/**
 * Validate tool input against schema (optional utility)
 * @param {string} toolName - Name of the tool
 * @param {Object} input - Tool input to validate
 * @param {Object} schema - Tool input schema
 * @returns {Object} Validation result {valid: boolean, errors: Array}
 */
export function validateToolInput(toolName, input, schema) {
  const errors = [];

  // Check required properties
  if (schema.required) {
    for (const prop of schema.required) {
      if (!(prop in input)) {
        errors.push(`Missing required property: ${prop}`);
      }
    }
  }

  // Basic type checking
  if (schema.properties) {
    for (const [prop, propSchema] of Object.entries(schema.properties)) {
      if (prop in input) {
        const value = input[prop];
        const expectedType = propSchema.type;

        if (expectedType === 'string' && typeof value !== 'string') {
          errors.push(`Property ${prop} should be a string`);
        } else if (expectedType === 'number' && typeof value !== 'number') {
          errors.push(`Property ${prop} should be a number`);
        } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Property ${prop} should be a boolean`);
        } else if (expectedType === 'object' && typeof value !== 'object') {
          errors.push(`Property ${prop} should be an object`);
        } else if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Property ${prop} should be an array`);
        }

        // Check enum values
        if (propSchema.enum && !propSchema.enum.includes(value)) {
          errors.push(`Property ${prop} must be one of: ${propSchema.enum.join(', ')}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check character count for CanExport application sections.
 * Limits sourced from .claude/skills/canexport-writer/APPLICATION_STRUCTURE.md.
 * Sections 6 and 7 are repeating fields — the limit applies per benefit field
 * (Section 6) or per activity row (Section 7); the caller passes one field/row's
 * text at a time.
 * @param {number} sectionNumber - Section number (1-7)
 * @param {string} sectionName - Name of the section
 * @param {string} text - The drafted text to check
 * @returns {Object} Character count validation result
 */
function checkCharacterCount(sectionNumber, sectionName, text) {
  const CHARACTER_LIMITS = {
    1: { limit: 2000, note: null },                                    // Products/Services
    2: { limit: 4000, note: null },                                    // Project Summary
    3: { limit: 4000, note: null },                                    // Capacity
    4: { limit: 2000, note: null },                                    // IP Strategy
    5: { limit: 1800, note: 'per target market' },                     // Market Potential, Opportunities & Competitive Advantages
    6: { limit: 4000, note: 'per benefit field (7 fields total)' },    // Benefits to Canada
    7: { limit: 1000, note: 'per activity row' }                       // Budget Activity Descriptions
  };

  const entry = CHARACTER_LIMITS[sectionNumber];
  if (!entry) {
    return {
      success: false,
      error: `Invalid section_number ${sectionNumber}. CanExport application has 7 sections (1-7).`
    };
  }

  const { limit, note } = entry;
  const actualCount = text.length;
  const isWithinLimit = actualCount <= limit;
  const difference = actualCount - limit;
  const percentageUsed = Math.round((actualCount / limit) * 100);
  const percentageOver = difference > 0 ? Math.round((difference / limit) * 100) : 0;
  const noteSuffix = note ? ` (${note})` : '';

  let guidance;
  if (isWithinLimit) {
    if (percentageUsed >= 90) {
      guidance = `✓ Within limit${noteSuffix} but tight (${percentageUsed}% used). Good use of space.`;
    } else if (percentageUsed >= 75) {
      guidance = `✓ Within limit${noteSuffix} (${percentageUsed}% used). Room for ${limit - actualCount} more characters if needed.`;
    } else {
      guidance = `✓ Within limit${noteSuffix} (${percentageUsed}% used). Consider adding more detail if relevant - ${limit - actualCount} characters available.`;
    }
  } else {
    guidance = `✗ OVER LIMIT${noteSuffix} by ${difference} characters (${percentageOver}% over). Must cut ${difference} characters. Revision needed.`;
  }

  return {
    success: true,
    section_number: sectionNumber,
    section_name: sectionName,
    character_count: actualCount,
    character_limit: limit,
    within_limit: isWithinLimit,
    difference: difference,
    percentage_used: percentageUsed,
    guidance: guidance
  };
}
