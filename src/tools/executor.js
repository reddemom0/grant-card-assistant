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
        result = await hubspot.searchGrantApplications(
          input.grant_program,
          input.status,
          input.company_name,
          agentType
        );
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
      // GOOGLE DOCS & SHEETS TOOLS
      // ============================================================================

      case 'create_google_drive_folder':
        result = await googleDrive.createGoogleDriveFolder(
          input.folder_name,
          userId  // User ID for OAuth
        );
        break;

      case 'create_google_sheet':
        result = await googleSheets.createGoogleSheet(
          input.title,
          userId,  // User ID for OAuth
          input.parent_folder_id,  // Parent folder ID (optional)
          input.grant_program  // Grant program for custom categories (optional)
        );
        break;

      case 'create_advanced_document':
        result = await createAdvancedDocumentTool(input, {
          conversationId,
          userId,
          agentType
        });
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
