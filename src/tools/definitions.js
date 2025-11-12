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
// ANTHROPIC FILE-BASED MEMORY TOOL (Client-Side Execution)
// Cross-conversation persistent memory in .memories/ directory
// ============================================================================

export const ANTHROPIC_MEMORY_TOOL = {
  type: 'memory_20250818',
  name: 'memory'
};

// ============================================================================
// DATABASE MEMORY TOOLS (Legacy - per-conversation key-value)
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
    description: 'Search for grant applications (HubSpot deals) by program type, status, company, or other criteria. Returns agent-specific application details - fields returned vary by agent type (CanExport agents see claim tracking fields, ETG agents see training fields, etc.). Always includes: approvedFunding (the ACTUAL approved funding amount), project details, team assignments, timeline, and workflow status. The results DO NOT include the misleading "amount" field - only the accurate approvedFunding field.',
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
    description: 'Get complete details for a specific grant application. Fields returned are agent-specific: CanExport agents receive claim tracking fields (claim_1-4, claimed_so_far), ETG agents receive training fields (tuition_fee, training_hours, candidate_info, third_party_payer), and BCAFE agents receive agriculture export fields. All agents receive core fields: contacts, company info, team assignments, financial information (approvedFunding from client_reimbursement field), and timeline. The misleading "amount" field is NOT included in the response.',
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
  },
  {
    name: 'get_project_email_history',
    description: 'Retrieve email communication history for a grant project/deal. Returns all emails associated with the project, including subject lines, timestamps, sender/recipient info, and a summary of email activity (total emails, inbound/outbound counts, most recent email). Useful for understanding project communication patterns, finding specific correspondence, and providing context on client interactions.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'HubSpot deal ID for the grant project'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of emails to retrieve (default: 20, optimized for rich context with 1M window)',
          default: 20
        }
      },
      required: ['deal_id']
    }
  },
  {
    name: 'search_project_emails',
    description: 'Search email communication for a grant project using keywords. Find specific emails containing terms like "funding agreement", "claim", "approval", "invoice", etc. Returns matching emails with full text content. Extremely useful for locating important project documentation mentioned in emails.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'HubSpot deal ID for the grant project'
        },
        search_term: {
          type: 'string',
          description: 'Keywords to search for in email subject lines and body text (e.g., "funding agreement", "claim", "approval")'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching emails to return (default: 10)',
          default: 10
        }
      },
      required: ['deal_id', 'search_term']
    }
  },
  {
    name: 'get_email_details',
    description: 'Get complete details for a specific email including HTML content, all recipients (to/cc/bcc), thread information, and attachment indicators. Use this after finding an email of interest to get its full content.',
    input_schema: {
      type: 'object',
      properties: {
        email_id: {
          type: 'string',
          description: 'HubSpot email engagement ID (obtained from search results or email history)'
        }
      },
      required: ['email_id']
    }
  },
  {
    name: 'get_email_attachments',
    description: 'Get list of attachments for a specific email, including file names, types, sizes, and download URLs. Use this when you need to access documents that were attached to an email (like funding agreements, invoices, etc.). Returns file metadata and URLs to access the actual files.',
    input_schema: {
      type: 'object',
      properties: {
        email_id: {
          type: 'string',
          description: 'HubSpot email engagement ID (obtained from search results or email history)'
        }
      },
      required: ['email_id']
    }
  },
  {
    name: 'get_deal_files',
    description: 'Get all files associated with a grant application deal, including funding agreements, contracts, invoices, and other documents that were uploaded to the deal record. This retrieves files that may not be attached to emails but are stored directly on the deal. Use this to find important documents like signed funding agreements that might be uploaded separately.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'HubSpot deal ID for the grant application'
        }
      },
      required: ['deal_id']
    }
  },
  {
    name: 'get_contact_files',
    description: 'Get all files associated with a specific contact. Useful when you need to find files sent by or associated with a person (e.g., funding agreements sent by a client\'s finance team). When an email mentions sending a file but has no attachments in the API, check the sender\'s contact files. You can get the contact ID by searching for the contact using their email address from the email\'s "from" field.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'HubSpot contact ID of the person whose files you want to retrieve'
        }
      },
      required: ['contact_id']
    }
  },
  {
    name: 'get_file_by_id',
    description: 'Get a specific file directly by its HubSpot file ID or URL. Use this when you know the exact file ID (e.g., from a HubSpot file-preview URL like https://app.hubspot.com/file-preview/PORTAL/file/FILE_ID/) or when the user provides a file link. This is helpful when a file exists in HubSpot but isn\'t properly associated with emails or deals in the system.',
    input_schema: {
      type: 'object',
      properties: {
        file_id_or_url: {
          type: 'string',
          description: 'HubSpot file ID (e.g., "195210192980") or full URL (e.g., "https://app.hubspot.com/file-preview/21088260/file/195210192980/"). The function will extract the ID from URLs automatically.'
        }
      },
      required: ['file_id_or_url']
    }
  },
  {
    name: 'read_hubspot_file',
    description: 'Download and read the actual content of a file from HubSpot. Extracts text from PDF, DOCX, and TXT files so you can analyze the content. Use this when you need to read funding agreements, contracts, invoices, or other documents. After finding a file (via get_contact_files, get_deal_files, or get_email_attachments), use this tool with the file ID to read its contents.',
    input_schema: {
      type: 'object',
      properties: {
        file_id_or_url: {
          type: 'string',
          description: 'HubSpot file ID (e.g., "195210192980") or full URL. The file will be downloaded and text will be extracted based on file type (PDF, DOCX, or TXT).'
        }
      },
      required: ['file_id_or_url']
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
    description: 'Read the contents of a specific Google Drive file. Works with Google Docs, PDFs, and text files. Accepts either a Google Drive URL (e.g., https://docs.google.com/document/d/FILE_ID/...) or just the file ID.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'Google Drive file ID or full URL (URL will be automatically parsed to extract the file ID)'
        }
      },
      required: ['file_id']
    }
  }
];

// ============================================================================
// GOOGLE DOCS TOOLS
// Create and format Google Docs
// ============================================================================

export const GOOGLE_DOCS_TOOLS = [
  {
    name: 'create_google_drive_folder',
    description: 'Create a new folder in Google Drive to organize project documents. Returns the folder ID and URL. Use this FIRST when creating a multi-document project to organize all related files together.',
    input_schema: {
      type: 'object',
      properties: {
        folder_name: {
          type: 'string',
          description: 'Name for the folder (e.g., "Caliber Projects - BCIC Ignite Readiness"). Be descriptive - include company name and grant program for easy identification.'
        }
      },
      required: ['folder_name']
    }
  },
  {
    name: 'create_google_sheet',
    description: 'Create a Google Sheet with budget template for grant applications. Creates a spreadsheet with two tabs: "Eligible Expenses" (pre-populated with categories for client to fill amounts) and "Ineligible Expenses" (reference list). Returns shareable link.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Sheet title (e.g., "BCIC Ignite Budget Template - TechVentures Inc.")'
        },
        grant_program: {
          type: 'string',
          description: 'Optional: Grant program name to customize eligible expense categories (e.g., "BCIC Ignite", "ETG"). If not provided, uses default categories.'
        },
        parent_folder_id: {
          type: 'string',
          description: 'Optional: ID of the parent folder to place this sheet in (from create_google_drive_folder result).'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'create_advanced_document',
    description: 'Create a properly formatted Google Doc from template configuration using Google Docs API v1 (NOT markdown). Supports Readiness Assessments, Interview Questions, and Evaluation Rubrics for hiring, market-expansion, training, rd, loan, and investment grant types. Documents include branded formatting, structured tables, callouts, and placeholders for client data.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Document title (e.g., "CanExport Readiness Assessment - Acme Corp")'
        },
        grantType: {
          type: 'string',
          enum: ['hiring', 'market-expansion', 'training', 'rd', 'loan', 'investment'],
          description: 'Type of grant program'
        },
        documentType: {
          type: 'string',
          enum: ['readiness-assessment', 'interview-questions', 'evaluation-rubric'],
          description: 'Type of document to create'
        },
        data: {
          type: 'object',
          description: 'Optional: Data to populate template placeholders (e.g., { client_name: "Acme Corp", program_name: "CanExport SMEs" }). Each template has default placeholders that can be overridden.'
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: Google Drive folder ID to create the document in. If not provided, creates in user\'s root Drive.'
        }
      },
      required: ['title', 'grantType', 'documentType']
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
  ANTHROPIC_MEMORY_TOOL,
  ...MEMORY_TOOLS,
  ...HUBSPOT_TOOLS,
  ...GOOGLE_DRIVE_TOOLS,
  ...GOOGLE_DOCS_TOOLS
];

/**
 * Get tools for a specific agent type
 * @param {string} agentType - The type of agent
 * @returns {Array} Array of tool definitions for this agent
 */
export function getToolsForAgent(agentType) {
  // All agents get server tools and memory (file-based + database)
  const baseTools = [...SERVER_TOOLS, ANTHROPIC_MEMORY_TOOL, ...MEMORY_TOOLS];

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

    case 'readiness-strategist':
      // Readiness strategist gets full toolset:
      // - Server tools (WebSearch/WebFetch) for grant program research
      // - Google Drive for example assessments and Question Bank
      // - HubSpot for client context, deal integration, and assessment storage
      // - Google Docs for creating formatted readiness assessment documents
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_DOCS_TOOLS];

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
