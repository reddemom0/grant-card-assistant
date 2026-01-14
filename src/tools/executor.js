/**
 * Tool Executor
 *
 * Routes and executes tool calls from Claude API.
 * Handles both client-side tools (executed locally) and server tools (executed by Anthropic).
 */

import * as memory from './memory.js';
import * as hubspot from './hubspot.js';
import * as googleDrive from './google-drive.js';
import * as googleDocs from './google-docs.js';
import * as googleSheets from './google-sheets.js';
import { createAdvancedDocumentTool } from './google-docs-advanced.js';
import { createAdvancedBudgetTool } from './google-sheets-advanced.js';
import { isServerTool } from './definitions.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      // HUBSPOT TOOLS
      // ============================================================================

      case 'search_hubspot_contacts':
        result = await hubspot.searchHubSpotContacts(input.query, input.limit);
        break;

      case 'get_hubspot_contact':
        result = await hubspot.getHubSpotContact(input.contact_id);
        break;

      case 'search_hubspot_companies':
        result = await hubspot.searchHubSpotCompanies(
          input.query,
          input.min_revenue,
          input.max_revenue
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
      // ORACLE TOOLS
      // ============================================================================

      case 'search_oracle_kb':
        const { searchOracleKnowledgeBase } = await import('./oracle-search.js');
        result = await searchOracleKnowledgeBase(input.query, {
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

      case 'search_getgranted':
        const { searchGetGranted } = await import('./getgranted-search.js');
        result = await searchGetGranted({
          purposes: input.purposes,
          regions: input.regions,
          industries: input.industries,
          business_type: input.business_type,
          owner_demographics: input.owner_demographics,
          company_size_min: input.company_size_min,
          company_size_max: input.company_size_max,
          active_only: input.active_only,
          open_intakes_only: input.open_intakes_only,
          limit: input.limit,
          fetch_full_details: input.fetch_full_details
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
 * Check character count for CanExport application sections
 * @param {number} sectionNumber - Section number (1-8)
 * @param {string} sectionName - Name of the section
 * @param {string} text - The drafted text to check
 * @returns {Object} Character count validation result
 */
function checkCharacterCount(sectionNumber, sectionName, text) {
  // CanExport application section character limits
  const CHARACTER_LIMITS = {
    1: 2000,  // Products/Services
    2: 4000,  // Project Summary
    3: 3000,  // Capacity
    4: 3000,  // IP Strategy
    5: 3000,  // Market Potential
    6: 3000,  // Differentiation
    7: 2000,  // Benefits to Canada
    8: null   // Budget Activities (per-line limits, handled separately)
  };

  const limit = CHARACTER_LIMITS[sectionNumber];
  const actualCount = text.length;

  // Calculate metrics
  const isWithinLimit = limit ? actualCount <= limit : true;
  const difference = limit ? actualCount - limit : 0;
  const percentageUsed = limit ? Math.round((actualCount / limit) * 100) : 0;
  const percentageOver = difference > 0 ? Math.round((difference / limit) * 100) : 0;

  // Generate guidance message
  let guidance = '';
  if (limit) {
    if (isWithinLimit) {
      if (percentageUsed >= 90) {
        guidance = `✓ Within limit but tight (${percentageUsed}% used). Good use of space.`;
      } else if (percentageUsed >= 75) {
        guidance = `✓ Within limit (${percentageUsed}% used). Room for ${limit - actualCount} more characters if needed.`;
      } else {
        guidance = `✓ Within limit (${percentageUsed}% used). Consider adding more detail if relevant - ${limit - actualCount} characters available.`;
      }
    } else {
      // Over limit - provide specific cut guidance
      guidance = `✗ OVER LIMIT by ${difference} characters (${percentageOver}% over). Must cut ${difference} characters. Revision needed.`;
    }
  } else {
    guidance = 'Section 8 uses per-activity character limits (see budget template). Check each activity individually.';
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
