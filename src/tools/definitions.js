/**
 * Tool Definitions for Direct Claude API
 *
 * Defines all tools available to agents:
 * - Server tools (executed by Anthropic)
 * - Client tools (executed locally)
 */

// ============================================================================
// SERVER TOOLS
// These are executed by Anthropic's servers
// ============================================================================

export const SERVER_TOOLS = [
  {
    type: 'web_search_20250305',
    name: 'web_search'
  },
  {
    type: 'web_fetch_20250910',
    name: 'web_fetch'
  }
];

// ============================================================================
// MEMORY TOOLS
// Store and recall information across the conversation
// ============================================================================

export const MEMORY_TOOLS = [
  {
    name: 'memory_store',
    description: 'Store important information for future reference in this conversation. Use this to remember key details about the client, grant program requirements, deadlines, or any other important context that should be retained across messages.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'A descriptive key for the stored information (e.g., "client_name", "grant_deadline", "company_revenue")'
        },
        value: {
          type: 'string',
          description: 'The information to remember'
        }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'memory_recall',
    description: 'Retrieve previously stored information from this conversation. Use this to recall details that were stored earlier.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The key of the information to retrieve'
        }
      },
      required: ['key']
    }
  },
  {
    name: 'memory_list',
    description: 'List all stored memories for this conversation to see what has been remembered.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  }
];

// ============================================================================
// HUBSPOT TOOLS
// CRM integration for contacts, companies, and grant applications
// ============================================================================

export const HUBSPOT_TOOLS = [
  {
    name: 'search_hubspot_contacts',
    description: 'Search HubSpot CRM for contacts by name, email, or company. Returns contact details including email, phone, company, and custom grant-related properties.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - can be name, email, company name, or other identifying information'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 100)',
          default: 10
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_hubspot_contact',
    description: 'Get complete details for a specific HubSpot contact by ID, including all custom properties and associated companies/deals.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'HubSpot contact ID'
        }
      },
      required: ['contact_id']
    }
  },
  {
    name: 'search_hubspot_companies',
    description: 'Search HubSpot for companies/organizations by name, domain, or industry. Useful for finding grant applicant organizations and their details.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company name, domain, or industry to search for'
        },
        min_revenue: {
          type: 'number',
          description: 'Optional: Filter by minimum annual revenue (in dollars)'
        },
        max_revenue: {
          type: 'number',
          description: 'Optional: Filter by maximum annual revenue (in dollars)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_grant_applications',
    description: 'Search for grant applications (HubSpot deals) by program type, status, company, or other criteria. Returns application details and current status.',
    input_schema: {
      type: 'object',
      properties: {
        grant_program: {
          type: 'string',
          enum: ['ETG', 'BCAFE', 'CanExport', 'Other'],
          description: 'Filter by specific grant program'
        },
        status: {
          type: 'string',
          enum: ['draft', 'in_progress', 'submitted', 'under_review', 'approved', 'rejected'],
          description: 'Filter by application status'
        },
        company_name: {
          type: 'string',
          description: 'Filter by applicant company name'
        }
      }
    }
  },
  {
    name: 'get_grant_application',
    description: 'Get complete details for a specific grant application including all custom properties, associated contacts, and company information.',
    input_schema: {
      type: 'object',
      properties: {
        application_id: {
          type: 'string',
          description: 'HubSpot deal ID for the grant application'
        }
      },
      required: ['application_id']
    }
  }
];

// ============================================================================
// GOOGLE DRIVE TOOLS
// Document search and retrieval from Google Drive
// ============================================================================

export const GOOGLE_DRIVE_TOOLS = [
  {
    name: 'search_google_drive',
    description: 'Search Google Drive for grant program documentation, templates, previous applications, or other relevant files.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - can include file names, content keywords, or grant program names'
        },
        file_type: {
          type: 'string',
          enum: ['document', 'pdf', 'spreadsheet', 'any'],
          description: 'Filter by file type (default: any)',
          default: 'any'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
          default: 10
        }
      },
      required: ['query']
    }
  },
  {
    name: 'read_google_drive_file',
    description: 'Read the contents of a specific Google Drive file by ID. Works with Google Docs, PDFs, and text files.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'Google Drive file ID'
        }
      },
      required: ['file_id']
    }
  }
];

// ============================================================================
// TOOL AGGREGATION
// ============================================================================

/**
 * Get all tools across all categories
 */
export const ALL_TOOLS = [
  ...SERVER_TOOLS,
  ...MEMORY_TOOLS,
  ...HUBSPOT_TOOLS,
  ...GOOGLE_DRIVE_TOOLS
];

/**
 * Get tools for a specific agent type
 * @param {string} agentType - The type of agent
 * @returns {Array} Array of tool definitions for this agent
 */
export function getToolsForAgent(agentType) {
  // All agents get server tools and memory
  const baseTools = [...SERVER_TOOLS, ...MEMORY_TOOLS];

  switch (agentType) {
    case 'grant-card-generator':
      // Grant card generator gets all tools
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS];

    case 'etg-writer':
      // ETG writer gets CRM and documents
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS];

    case 'bcafe-writer':
      // BCAFE writer gets CRM and documents
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS];

    case 'canexport-claims':
      // Claims auditor gets CRM and documents
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS];

    case 'orchestrator':
      // Orchestrator gets everything
      return ALL_TOOLS;

    default:
      // Unknown agent types get base tools only
      console.warn(`Unknown agent type: ${agentType}, using base tools only`);
      return baseTools;
  }
}

/**
 * Check if a tool is a server-side tool (executed by Anthropic)
 * @param {string} toolName - Name of the tool
 * @returns {boolean} True if this is a server tool
 */
export function isServerTool(toolName) {
  return SERVER_TOOLS.some(tool => tool.name === toolName);
}

/**
 * Get tool definition by name
 * @param {string} toolName - Name of the tool
 * @returns {Object|null} Tool definition or null if not found
 */
export function getToolDefinition(toolName) {
  return ALL_TOOLS.find(tool => tool.name === toolName) || null;
}
