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
    description: 'Search HubSpot CRM for contacts with advanced cross-filtering. Search by name, email, or company, then filter by lifecycle stage, creation/modification dates, owner, lead status, and any custom properties. Perfect for finding leads like "all MQLs created in the last 30 days" or "leads owned by Sarah modified this week".',
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
        },
        lifecycle_stage: {
          type: 'string',
          enum: ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'],
          description: 'Filter by lifecycle stage: subscriber (newsletter signups), lead (early interest), marketingqualifiedlead (MQL), salesqualifiedlead (SQL), opportunity (active deal), customer (closed-won), evangelist (promoters), other (uncategorized)'
        },
        createdate_after: {
          type: 'string',
          format: 'date',
          description: 'Filter contacts created after this date (YYYY-MM-DD format, e.g., "2025-01-01")'
        },
        createdate_before: {
          type: 'string',
          format: 'date',
          description: 'Filter contacts created before this date (YYYY-MM-DD format)'
        },
        lastmodifieddate_after: {
          type: 'string',
          format: 'date',
          description: 'Filter contacts modified after this date (YYYY-MM-DD format) - useful for finding recently updated leads'
        },
        lastmodifieddate_before: {
          type: 'string',
          format: 'date',
          description: 'Filter contacts modified before this date (YYYY-MM-DD format)'
        },
        owner_id: {
          type: 'string',
          description: 'Filter by HubSpot owner ID - use list_hubspot_owners to find owner IDs'
        },
        hs_lead_status: {
          type: 'string',
          description: 'Filter by lead status (e.g., "NEW", "OPEN", "IN_PROGRESS", "OPEN_DEAL", "UNQUALIFIED", "ATTEMPTED_TO_CONTACT", "CONNECTED", "BAD_TIMING")'
        },
        custom_filters: {
          type: 'array',
          description: 'Advanced: Array of custom property filters for any HubSpot contact property not covered above. Each filter has propertyName, operator (EQ, NEQ, LT, LTE, GT, GTE, CONTAINS_TOKEN, etc.), and value.',
          items: {
            type: 'object',
            properties: {
              propertyName: {
                type: 'string',
                description: 'HubSpot contact property name (e.g., "jobtitle", "industry", "num_notes")'
              },
              operator: {
                type: 'string',
                enum: ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE', 'CONTAINS_TOKEN', 'HAS_PROPERTY', 'NOT_HAS_PROPERTY'],
                description: 'Filter operator'
              },
              value: {
                type: 'string',
                description: 'Value to filter by'
              }
            },
            required: ['propertyName', 'operator']
          }
        },
        sort_by: {
          type: 'string',
          enum: ['createdate', 'lastmodifieddate', 'email', 'firstname', 'lastname', 'hs_lead_status'],
          description: 'Sort results by this property. Most useful: "createdate" (find newest/oldest contacts), "lastmodifieddate" (find recently updated contacts)'
        },
        sort_order: {
          type: 'string',
          enum: ['DESC', 'ASC'],
          default: 'DESC',
          description: 'Sort order: DESC = newest/highest first (default), ASC = oldest/lowest first. Use DESC with createdate to find most recent contacts.'
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
    name: 'get_contact_by_email',
    description: 'Direct lookup of a HubSpot contact by email address. Much faster than search_hubspot_contacts when you have an exact email. Use this when you need contact details for a specific email address (e.g., from an email engagement, deal association, or user mention). Returns full contact details including associated companies and deals.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Contact email address (e.g., "sarah@techco.com")'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'search_hubspot_companies',
    description: 'Search HubSpot for companies with advanced cross-filtering. Search by name, domain, or industry, then filter by lifecycle stage, revenue range, creation/modification dates, owner, company type, and any custom properties. Perfect for queries like "all lead companies created in Q1 2025" or "technology companies with $1M+ revenue that are opportunities".',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company name, domain, or industry to search for'
        },
        min_revenue: {
          type: 'number',
          description: 'Filter by minimum annual revenue (in dollars, e.g., 1000000 for $1M+)'
        },
        max_revenue: {
          type: 'number',
          description: 'Filter by maximum annual revenue (in dollars)'
        },
        lifecycle_stage: {
          type: 'string',
          enum: ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'],
          description: 'Filter by lifecycle stage: subscriber, lead, marketingqualifiedlead (MQL), salesqualifiedlead (SQL), opportunity, customer, evangelist, other'
        },
        createdate_after: {
          type: 'string',
          format: 'date',
          description: 'Filter companies created after this date (YYYY-MM-DD format, e.g., "2025-01-01")'
        },
        createdate_before: {
          type: 'string',
          format: 'date',
          description: 'Filter companies created before this date (YYYY-MM-DD format)'
        },
        lastmodifieddate_after: {
          type: 'string',
          format: 'date',
          description: 'Filter companies modified after this date (YYYY-MM-DD format) - useful for finding recently updated prospects'
        },
        lastmodifieddate_before: {
          type: 'string',
          format: 'date',
          description: 'Filter companies modified before this date (YYYY-MM-DD format)'
        },
        owner_id: {
          type: 'string',
          description: 'Filter by HubSpot owner ID - use list_hubspot_owners to find owner IDs'
        },
        type: {
          type: 'string',
          enum: ['PROSPECT', 'PARTNER', 'RESELLER', 'VENDOR', 'OTHER'],
          description: 'Filter by company type: PROSPECT (potential customers), PARTNER (business partners), RESELLER (resellers/distributors), VENDOR (suppliers), OTHER'
        },
        custom_filters: {
          type: 'array',
          description: 'Advanced: Array of custom property filters for any HubSpot company property not covered above. Each filter has propertyName, operator (EQ, NEQ, LT, LTE, GT, GTE, CONTAINS_TOKEN, etc.), and value.',
          items: {
            type: 'object',
            properties: {
              propertyName: {
                type: 'string',
                description: 'HubSpot company property name (e.g., "numberofemployees", "city", "num_associated_deals")'
              },
              operator: {
                type: 'string',
                enum: ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE', 'CONTAINS_TOKEN', 'HAS_PROPERTY', 'NOT_HAS_PROPERTY'],
                description: 'Filter operator'
              },
              value: {
                type: 'string',
                description: 'Value to filter by'
              }
            },
            required: ['propertyName', 'operator']
          }
        },
        sort_by: {
          type: 'string',
          enum: ['createdate', 'hs_lastmodifieddate', 'name', 'annualrevenue', 'numberofemployees'],
          description: 'Sort results by this property. Most useful: "createdate" (find newest/oldest companies), "hs_lastmodifieddate" (find recently updated companies), "annualrevenue" (sort by size)'
        },
        sort_order: {
          type: 'string',
          enum: ['DESC', 'ASC'],
          default: 'DESC',
          description: 'Sort order: DESC = newest/highest first (default), ASC = oldest/lowest first. Use DESC with createdate to find most recent companies.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_company_by_domain',
    description: 'Direct lookup of a HubSpot company by domain name. Much faster than search_hubspot_companies when you have an exact domain. Use this when you know the company\'s website domain (e.g., "techco.com", "microsoft.com"). Returns full company details including associated contacts and deals.',
    input_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Company domain name (e.g., "techco.com", "example.org"). Do not include "www." or "https://"'
        }
      },
      required: ['domain']
    }
  },
  {
    name: 'get_company_by_id',
    description: 'Get complete details for a specific HubSpot company by company ID. Use this when you have a HubSpot company ID from another tool result. Returns full company details including associated contacts and deals.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: {
          type: 'string',
          description: 'HubSpot company ID'
        }
      },
      required: ['company_id']
    }
  },
  {
    name: 'search_grant_applications',
    description: 'Search for grant applications (HubSpot deals) with comprehensive filtering across team members, dates, financials, and all deal properties. Returns agent-specific application details - fields returned vary by agent type (CanExport agents see claim tracking fields, ETG agents see training fields, etc.). Always includes: approvedFunding (the ACTUAL approved funding amount), project details, team assignments, timeline, and workflow status. Supports filtering on all 128 properties from dealinformation, deal_activity, and deal_revenue groups using either explicit parameters (for common queries) or custom_filters array (for advanced queries).',
    input_schema: {
      type: 'object',
      properties: {
        // ============ EXISTING CORE FILTERS ============
        grant_program: {
          type: 'string',
          enum: ['ETG', 'BCAFE', 'BC MDP', 'CanExport', 'DS4Y', 'Digital Skills for Youth', 'Canada Summer Jobs', 'CSJ', 'Other'],
          description: 'Filter by grant program. Maps to actual HubSpot grant_type values: ETG → "ETG - BC", BCAFE → "BC MDP", CanExport → ["CanExport", "CanEx Innovate"], DS4Y → matches all DS4Y variants (DS4Y - Eco Canada, DS4Y - PCPI, DS4Y - BioTalent, DS4Y - ICNJ, DS4Y - IMAA, DS4Y - Innovate BC, DS4Y - Lighthouse Labs, DS4Y - Pinnguaq, DS4Y VCN), Canada Summer Jobs → "CSJ". For other grant types, use deal_name parameter or select "Other".'
        },
        status: {
          type: 'string',
          enum: ['draft', 'in_progress', 'submitted', 'under_review', 'approved', 'rejected', 'won', 'lost', 'open', 'abandoned', 'invoice_cleared', 'invoice_paid', 'invoice_sent', 'suspended', 'retainer_sent', 'retainer_paid'],
          description: 'Filter by application status. Common statuses: "lost" (abandoned deals), "won" (completed/invoiced deals), "open" (active deals), "approved" (approved applications), "invoice_sent"/"invoice_paid"/"invoice_cleared" (invoicing workflow), "retainer_sent"/"retainer_paid" (retainer workflow), "suspended" (temporarily on hold), "abandoned" (formally abandoned).'
        },
        dealstage: {
          type: 'string',
          description: 'Filter by specific deal stage ID (HubSpot pipeline stage). Example stage IDs: "qualifiedtobuy", "presentationscheduled", "decisionmakerboughtin", "contractsent", "closedwon", "closedlost". Use this for precise pipeline stage filtering.'
        },
        company_name: {
          type: 'string',
          description: 'Filter by applicant company name'
        },
        deal_name: {
          type: 'string',
          description: 'Search for deals containing this text in the deal name (e.g., "DS4Y", "Peterson", "Ampere"). Very useful for programs like DS4Y that appear in deal names rather than grant_type field.'
        },

        // ============ TEAM MEMBER FILTERS ============
        owner_id: {
          type: 'string',
          description: 'Filter by deal owner (HubSpot user ID or team member name, e.g., "Rukshaar", "Sarah", "John"). The system will attempt to resolve names to HubSpot user IDs automatically.'
        },
        writer: {
          type: 'string',
          description: 'Filter by assigned writer (searches real_assigned_writer field). Use team member name or email.'
        },
        strategist: {
          type: 'string',
          description: 'Filter by strategist assigned to the deal.'
        },
        claims_specialist: {
          type: 'string',
          description: 'Filter by claims specialist (Grant Coordinator).'
        },

        // ============ DATE RANGE FILTERS ============
        closedate_after: {
          type: 'string',
          format: 'date',
          description: 'Deals closed after this date (YYYY-MM-DD). Use this to find deals won/lost after a specific date.'
        },
        closedate_before: {
          type: 'string',
          format: 'date',
          description: 'Deals closed before this date (YYYY-MM-DD). Use this to find deals won/lost before a specific date.'
        },
        createdate_after: {
          type: 'string',
          format: 'date',
          description: 'Deals created after this date (YYYY-MM-DD).'
        },
        createdate_before: {
          type: 'string',
          format: 'date',
          description: 'Deals created before this date (YYYY-MM-DD).'
        },
        approved_on_after: {
          type: 'string',
          format: 'date',
          description: 'Grants approved after this date (YYYY-MM-DD). Use this to find recently approved applications.'
        },
        approved_on_before: {
          type: 'string',
          format: 'date',
          description: 'Grants approved before this date (YYYY-MM-DD).'
        },
        application_submitted_on_after: {
          type: 'string',
          format: 'date',
          description: 'Applications submitted after this date (YYYY-MM-DD).'
        },
        application_submitted_on_before: {
          type: 'string',
          format: 'date',
          description: 'Applications submitted before this date (YYYY-MM-DD).'
        },

        // ============ FINANCIAL FILTERS ============
        amount_min: {
          type: 'number',
          description: 'Minimum deal amount (service fee charged to client).'
        },
        amount_max: {
          type: 'number',
          description: 'Maximum deal amount (service fee charged to client).'
        },
        client_reimbursement_min: {
          type: 'number',
          description: 'Minimum approved funding amount (client reimbursement from grant program).'
        },
        client_reimbursement_max: {
          type: 'number',
          description: 'Maximum approved funding amount (client reimbursement from grant program).'
        },
        claimed_so_far_min: {
          type: 'number',
          description: 'Minimum amount claimed so far (for CanExport/BCAFE multi-claim programs).'
        },
        claimed_so_far_max: {
          type: 'number',
          description: 'Maximum amount claimed so far (for CanExport/BCAFE multi-claim programs).'
        },

        // ============ PIPELINE FILTER ============
        pipeline: {
          type: 'string',
          enum: [
            'Hiring Grants Pipeline',
            'Training Grants Pipeline',
            'Market Expansion Pipeline',
            'Granted Starter Hiring Grants Pipeline',
            'Granted Starter Training Grants Pipeline',
            'Misc. Grant Pipeline',
            'Pro Onboarding Pipeline',
            'Completed Deals',
            'Lost/Abandoned/Suspended',
            'Review Required',
            'Grant Research',
            'Grant Calculator - Post Submission',
            'Whitelabel Pipeline',
            'Mock Applications'
          ],
          description: 'Filter by HubSpot pipeline. Main grant pipelines: "Hiring Grants Pipeline" (hiring/wage subsidy programs like CSJ, DS4Y), "Training Grants Pipeline" (training programs like ETG, WIL Digital, Magnet, CAPG), "Market Expansion Pipeline" (export/market expansion programs like CanExport, BCAFE), "Granted Starter Hiring Grants Pipeline" and "Granted Starter Training Grants Pipeline" (Granted Starter subscription deals). Other pipelines include Pro Onboarding, Completed Deals, Lost/Abandoned/Suspended, Review Required, Grant Research, and administrative pipelines.'
        },

        // ============ ADVANCED GENERIC FILTERS ============
        custom_filters: {
          type: 'array',
          description: 'Advanced filters for any deal property not covered by explicit parameters above. Use this to filter on specialized fields like tuition_fee, claim_2_submitted, training_delivery_method, start_date, end_date, budget_complete, etc. Supports all 128 properties from dealinformation, deal_activity, and deal_revenue groups. Each filter specifies propertyName, operator, and value.',
          items: {
            type: 'object',
            properties: {
              propertyName: {
                type: 'string',
                description: 'HubSpot property name (e.g., "tuition_fee", "claim_2_submitted", "training_delivery_method", "start_date", "next_claim_due", "budget_complete"). Refer to HubSpot deal properties documentation for available property names.'
              },
              operator: {
                type: 'string',
                enum: ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE', 'BETWEEN', 'IN', 'NOT_IN', 'CONTAINS_TOKEN', 'HAS_PROPERTY', 'NOT_HAS_PROPERTY'],
                description: 'Comparison operator. EQ=equals, NEQ=not equals, LT=less than, LTE=less than or equal, GT=greater than, GTE=greater than or equal, BETWEEN=between two values, IN=matches any value in list, NOT_IN=does not match any value in list, CONTAINS_TOKEN=contains word/token, HAS_PROPERTY=property has any value (not null), NOT_HAS_PROPERTY=property is null/empty.'
              },
              value: {
                type: 'string',
                description: 'Value to compare against (for most operators). For dates, use YYYY-MM-DD format or Unix timestamp. For numbers, use numeric strings. For booleans, use "true" or "false".'
              },
              highValue: {
                type: 'string',
                description: 'High value for BETWEEN operator (required when operator is BETWEEN).'
              },
              values: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of values for IN or NOT_IN operators (required when operator is IN or NOT_IN).'
              }
            },
            required: ['propertyName', 'operator']
          }
        },

        // ============ PAGINATION ============
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50, max: 100).',
          default: 50,
          maximum: 100
        },
        properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Specific properties to return in results (default: agent-specific field set).'
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
    name: 'list_hubspot_owners',
    description: 'Get a list of all HubSpot users who can own deals (contacts, companies, etc.). Use this when you need to find the correct owner name/ID for filtering deals, or when an owner name search fails. Returns each owner\'s ID, full name, and email address. Very helpful when a user asks about deals for a team member but you\'re not sure of the exact name spelling.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'generate_hubspot_embed_link',
    description: 'Generate an interactive HubSpot embed URL for viewing records directly in HubSpot\'s interface. These links open live HubSpot views where users can see real-time data, add notes, schedule meetings, and take actions. Much better than static text responses - provides full HubSpot functionality. Use this when users want to "pull up", "show me", or "open" a record.',
    input_schema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          enum: ['contact', 'company', 'deal', 'ticket', 'email'],
          description: 'Type of HubSpot object. Maps to HubSpot objectTypeIds: contact=0-1, company=0-2, deal=0-3, ticket=0-5, email=0-19.'
        },
        record_id: {
          type: 'string',
          description: 'HubSpot record ID (e.g., contact ID, company ID, deal ID)'
        },
        view: {
          type: 'string',
          enum: ['overview', 'activity', 'timeline', 'associations', 'properties', 'meetings', 'emails', 'tasks', 'notes', 'calls'],
          description: 'Which view/tab to open. Default: "overview" (main record page). "activity" shows recent activities, "associations" shows related records, "properties" shows all fields, etc.',
          default: 'overview'
        }
      },
      required: ['object_type', 'record_id']
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
  },
  {
    name: 'load_company_context',
    description: 'CONSOLIDATED TOOL (Phase 2): Load complete company and grant application context in ONE call. Uses fuzzy name matching (e.g., "Spring Activator" finds "Spring Activator Inc.", "Seagate" finds "Seagate Mass Timber Corporation"). Returns company details, all grant applications, financial status, claim tracking, timeline, contacts, and optional email summary. Replaces multiple separate searches (search_grant_applications + get_grant_application + get_project_email_history). Use this FIRST when a user mentions a company name to get comprehensive context efficiently.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: {
          type: 'string',
          description: 'Company name (fuzzy matching supported - accepts partial names, names without legal suffixes like "Inc." or "Corp.", acronyms, etc.)'
        },
        grant_program: {
          type: 'string',
          enum: ['CanExport', 'ETG', 'BCAFE', 'Other'],
          description: 'Optional: Filter applications by specific grant program'
        },
        include_emails: {
          type: 'boolean',
          description: 'Include email summary for context enrichment (default: true). Email history is loaded silently and used to enrich responses with relevant communication context.',
          default: true
        },
        email_limit: {
          type: 'number',
          description: 'Number of recent emails to analyze for context (default: 20)',
          default: 20
        },
        load_funding_agreement: {
          type: 'boolean',
          description: 'Automatically find and read funding agreement PDF (default: false). Set to true for audit workflows that need funding agreement details.',
          default: false
        }
      },
      required: ['company_name']
    }
  },
  {
    name: 'find_and_read_funding_agreement',
    description: 'CONSOLIDATED TOOL (Phase 2): Automatically discover and read a funding agreement PDF in ONE call. Searches emails, deal files, and contact files to find the document. Returns full content plus parsed key fields (project dates, approved categories, funding amount, target markets). Replaces 5-7 separate tool calls (search_project_emails + get_email_details + search_hubspot_contacts + get_contact_files + read_hubspot_file). Use when you need funding agreement details for compliance auditing.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'HubSpot deal ID (if known). Either deal_id or company_name must be provided.'
        },
        company_name: {
          type: 'string',
          description: 'Company name with fuzzy matching (will find deal first if deal_id not provided). Either deal_id or company_name must be provided.'
        },
        grant_program: {
          type: 'string',
          enum: ['CanExport', 'ETG', 'BCAFE', 'Other'],
          description: 'Grant program filter (if company has multiple deals)'
        },
        return_content: {
          type: 'boolean',
          description: 'Return full document content (default: true)',
          default: true
        },
        max_content_length: {
          type: 'number',
          description: 'Maximum content length to return in characters (default: 50000)',
          default: 50000
        },
        parse_fields: {
          type: 'boolean',
          description: 'Extract key fields from document (project dates, categories, funding, markets) using pattern matching (default: true)',
          default: true
        }
      }
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
// DROPBOX TOOLS
// Document search and retrieval from Dropbox team folders
// ============================================================================

export const DROPBOX_TOOLS = [
  {
    name: 'read_dropbox_file',
    description: 'Read the contents of a specific Dropbox file. Works with PDFs, DOCX, and text files. Use this after search_oracle_kb returns a Dropbox document (source: dropbox). The file path is provided in the dropboxPath field of search results.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Dropbox file path (e.g., "/Oracle KB/Writers/template.docx"). Get this from the dropboxPath field in search_oracle_kb results.'
        }
      },
      required: ['file_path']
    }
  }
];

// ============================================================================
// ORACLE TOOLS
// Internal knowledge base search for Granted Consulting documentation
// ============================================================================

export const ORACLE_TOOLS = [
  {
    name: 'search_oracle_kb',
    description: `Search Granted Consulting's internal knowledge base (Oracle).

Use this to find company documents, processes, templates, examples, and information across all departments.

The knowledge base includes:
- **Writers**: Application templates, writing guides, program documentation
- **Strategy**: Pricing guides, discovery scripts, client intake processes
- **Research**: Grant program databases, eligibility rubrics, procedures
- **Marketing**: Content calendars, webinar topics, customer story templates
- **GCs**: Branding guidelines, hiring processes, claim procedures

Returns metadata about matching documents including file name, summary, keywords, and source location (Google Drive or Dropbox).

After searching:
- For Google Drive files (source: google-drive), use read_google_drive_file with the fileId
- For Dropbox files (source: dropbox), use read_dropbox_file with the dropboxPath`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords or natural language question)'
        },
        department: {
          type: 'string',
          enum: ['Writers', 'Strategy', 'Research', 'Marketing', 'GCs'],
          description: 'Optional: Filter results to specific department'
        },
        fileType: {
          type: 'string',
          enum: ['template', 'example', 'process', 'reference', 'data'],
          description: 'Optional: Filter by document type (template=blank forms, example=completed samples, process=SOPs, reference=guidelines, data=databases/lists)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 10, max 20)',
          minimum: 1,
          maximum: 20,
          default: 10
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_visualping_alerts',
    description: `Get recent website change alerts from VisualPing monitoring of government grant pages.

Use this to:
- Check for new grant programs that have been announced
- Find recent deadline changes or extensions
- Discover eligibility updates that might benefit clients
- Monitor guideline or funding amount changes
- Stay informed about the grant landscape

Each alert includes VisualPing's AI summary plus our own Claude analysis with change classification, priority level, and recommended actions.

This tool provides proactive market intelligence - check it regularly or when clients ask about "new grants" or "what's changed recently".`,
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of alerts to return (default 10, max 50)',
          minimum: 1,
          maximum: 50
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Filter by priority level. Critical = new programs or major changes, High = significant updates, Medium = guideline tweaks, Low = minor changes. Leave empty for all priorities.'
        },
        change_type: {
          type: 'string',
          enum: ['new_program', 'deadline_change', 'eligibility_update', 'guidelines_update', 'funding_change', 'minor_update'],
          description: 'Filter by type of change detected. Leave empty for all types.'
        },
        days: {
          type: 'number',
          description: 'Only show alerts from the last N days (default 30)',
          minimum: 1,
          maximum: 365
        }
      },
      required: []
    }
  },
  {
    name: 'search_getgranted',
    description: `Search Granted Consulting's GetGranted database for grant opportunities matching client criteria.

Use this to:
- Find grants for specific clients based on their industry, location, and needs
- Discover hiring, training, export, R&D, or capital grants
- Filter by region, company size, owner demographics
- Get quick summaries or full grant card details

This tool searches the internal GetGranted database (188+ Canadian grants) and returns matching opportunities with eligibility, funding details, and deadlines.

**Common use cases:**
- "Find hiring grants for a BC tech company with 25 employees"
- "Show market expansion grants for Indigenous-owned businesses"
- "Search for R&D grants in Ontario with open intakes"
- "Find all grants for female-owned manufacturing companies"`,
    input_schema: {
      type: 'object',
      properties: {
        purposes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['Hiring', 'Training', 'Market Expansion', 'Capital Costs', 'Business Assessments, Planning & Coaching', 'Systems & Processes', 'Loan', 'Contests & Prizes', 'Investment', 'Research & Development', 'Rebates']
          },
          description: 'Grant purposes/types to search for. Leave empty for all types.'
        },
        regions: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['British Columbia', 'Ontario', 'Alberta', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon']
          },
          description: 'Canadian provinces/territories. Leave empty for all regions.'
        },
        industries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Industry sectors (e.g., "Technology", "Manufacturing", "Agriculture"). Leave empty for all industries.'
        },
        business_type: {
          type: 'string',
          enum: ['Incorporated', 'Sole Proprietorship', 'General Partnership', 'Non-Profit', 'Charity'],
          description: 'Business structure type. Leave empty for any business type.'
        },
        owner_demographics: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['Female', 'Indigenous', 'Newcomers', 'People with disabilities', 'Rural Entrepreneur', 'Youth']
          },
          description: 'Owner demographics for targeted grants. Leave empty if not applicable.'
        },
        company_size_min: {
          type: 'number',
          description: 'Minimum company size (number of employees). Leave empty for no minimum.'
        },
        company_size_max: {
          type: 'number',
          description: 'Maximum company size (number of employees). Leave empty for no maximum.'
        },
        active_only: {
          type: 'boolean',
          description: 'Only show active grants (default true).'
        },
        open_intakes_only: {
          type: 'boolean',
          description: 'Only show grants with open intake periods (default false).'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of grants to return (default 10, max 50).',
          minimum: 1,
          maximum: 50
        },
        fetch_full_details: {
          type: 'boolean',
          description: 'Fetch full grant card details including eligibility criteria and best practices (slower, default false).'
        },
        bypass_cache: {
          type: 'boolean',
          description: 'Force fresh scraping, bypassing Redis cache. Use this if results seem stale or incorrect (default false).'
        }
      },
      required: []
    }
  }
];

// ============================================================================
// CANEXPORT WRITER TOOLS
// Application drafting utilities
// ============================================================================

export const CANEXPORT_WRITER_TOOLS = [
  {
    name: 'check_character_count',
    description: 'Check if drafted application section text is within the character limit. Returns exact character count, limit, and whether it passes. Use this IMMEDIATELY after drafting each section before showing to user - Claude cannot accurately count characters, so this tool provides reliable validation.',
    input_schema: {
      type: 'object',
      properties: {
        section_number: {
          type: 'number',
          description: 'Section number (1-8). Each section has a specific character limit: Section 1 (2000), Section 2 (4000), Section 3 (3000), Section 4 (3000), Section 5 (3000), Section 6 (3000), Section 7 (2000), Section 8 (see budget line limits)',
          enum: [1, 2, 3, 4, 5, 6, 7, 8]
        },
        section_name: {
          type: 'string',
          description: 'Name of the section being checked (e.g., "Products/Services", "Project Summary", "Capacity", etc.)'
        },
        text: {
          type: 'string',
          description: 'The drafted text to check character count for'
        }
      },
      required: ['section_number', 'section_name', 'text']
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
    name: 'copy_template_file',
    description: 'Copy a CanExport template file (Budget, RA, or Interview Questions) from the knowledge base and rename it for a specific client project. Use this to create client-specific versions of CanExport templates. The tool will search for the template by name in Google Drive, copy it, rename it with the client name, and place it in the project folder.',
    input_schema: {
      type: 'object',
      properties: {
        template_file_id_or_name: {
          type: 'string',
          description: 'Template file name or ID to copy. Common templates: "canexport-budget-template.xlsx", "canexport-readiness-assessment-template.pdf", "canexport-interview-questions.pdf". Can provide either the exact filename or a Google Drive file ID.'
        },
        new_file_name: {
          type: 'string',
          description: 'New name for the copied file (e.g., "Spring Activator - CanExport Budget 2026", "Acme Corp - CanExport Interview Questions"). Include client name and document type for easy identification.'
        },
        target_folder_id: {
          type: 'string',
          description: 'Google Drive folder ID where the copied file should be placed (from create_google_drive_folder). This organizes all client documents in one project folder.'
        }
      },
      required: ['template_file_id_or_name', 'new_file_name', 'target_folder_id']
    }
  },
  {
    name: 'create_advanced_budget',
    description: 'Create a comprehensive budget spreadsheet using Google Sheets API with program-specific templates. Generates multi-sheet workbooks with branded formatting, formulas, validation rules, and dynamic budget tables tailored to specific grant programs (e.g., ETG, BCIC Ignite, CanExport). Supports custom budget data injection for automated budget generation.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Spreadsheet title (e.g., "ETG Budget - Q1 2024 Training Program")'
        },
        grantProgram: {
          type: 'string',
          description: 'Grant program name to determine template structure and categories (e.g., "ETG", "BCIC Ignite", "CanExport SMEs"). Each program has a specific template with appropriate expense categories, formulas, and validation rules.'
        },
        budgetData: {
          type: 'object',
          description: 'Optional: Structured budget data to populate the spreadsheet dynamically. If provided, the tool will generate budget rows from this data instead of using a blank template. Format depends on grant program requirements.'
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: Google Drive folder ID to create the spreadsheet in (from create_google_drive_folder). If not provided, creates in user\'s root Drive.'
        }
      },
      required: ['title', 'grantProgram']
    }
  },
  {
    name: 'create_advanced_document',
    description: 'Create a properly formatted Google Doc from template configuration using Google Docs API v1 (NOT markdown). Supports Readiness Assessments, Interview Questions, and Evaluation Rubrics for hiring, market-expansion, training, rd, loan, and investment grant types. Documents include branded formatting, structured tables, callouts, and placeholders for client data. For interview questions, can dynamically generate questions based on grant criteria instead of using static templates.',
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
        grantCriteria: {
          type: 'string',
          description: 'Optional: For interview-questions and evaluation-rubric documents, provide the grant program\'s evaluation criteria to dynamically generate tailored content. For interview questions: generates ~10 strategic questions. For evaluation rubrics: generates comprehensive scoring framework with categories, sub-criteria, and assessment tables. Include: eligibility requirements, evaluation factors, program priorities, and assessment dimensions. When provided, overrides static templates with AI-generated content. Example: "CanExport evaluates: export readiness (market research, capacity), international growth strategy, project viability, financial capacity, and team experience. Priorities: first-time exporters, innovative products, emerging markets."'
        },
        companyContext: {
          type: 'string',
          description: 'Optional: For interview-questions documents, provide company information from HubSpot (obtained via load_company_context tool) to generate company-specific questions and preliminary fit assessment. Include: company name, industry, size, revenue, current activities, stage, key challenges. When provided with grantCriteria, questions will be tailored to this specific company\'s situation and a preliminary fit assessment will be included. Example: "Acme Corp - Manufacturing, 50 employees, $5M revenue, currently selling domestically in Canada, looking to expand to US market, challenges: limited marketing budget, no prior export experience."'
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: Google Drive folder ID to create the document in. If not provided, creates in user\'s root Drive.'
        }
      },
      required: ['title', 'grantType', 'documentType']
    }
  },
  {
    name: 'create_google_doc',
    description: 'Create a Google Doc from markdown content with Granted Consulting branding and formatting. Converts markdown (headers, bold, italic, lists, tables) to properly formatted Google Docs. Use this for flexible document creation when you need full control over content (e.g., Budget Building Guides, custom reports, strategic briefs). For standardized templates (Readiness Assessments, Interview Questions, Evaluation Rubrics), use create_advanced_document instead.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Document title (e.g., "Budget Building Guide - Acme Manufacturing")'
        },
        content: {
          type: 'string',
          description: 'Markdown-formatted content for the document. Supports: headers (#, ##, ###), bold (**text**), italic (*text*), bullet lists (- item), numbered lists (1. item), tables (| col1 | col2 |), and checkboxes (- [ ] item). Line breaks and spacing will be preserved.'
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: Google Drive folder ID to create the document in (from create_google_drive_folder). If not provided, creates in user\'s root Drive.'
        }
      },
      required: ['title', 'content']
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
  ...ORACLE_TOOLS,
  ...CANEXPORT_WRITER_TOOLS,
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

    case 'canexport-writer':
      // CanExport Writer gets full toolset including character counter
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...CANEXPORT_WRITER_TOOLS, ...GOOGLE_DOCS_TOOLS];

    case 'readiness-strategist':
      // Readiness strategist gets full toolset:
      // - Server tools (WebSearch/WebFetch) for grant program research
      // - Google Drive for example assessments and Question Bank
      // - HubSpot for client context, deal integration, and assessment storage
      // - Google Docs for creating formatted readiness assessment documents
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_DOCS_TOOLS];

    case 'internal-oracle':
      // Internal Oracle gets:
      // - Server tools (WebSearch/WebFetch) for external research if needed
      // - Oracle search tool for internal knowledge base
      // - Google Drive for reading Google Drive documents
      // - Dropbox for reading Dropbox documents
      // - HubSpot for company/project context
      // - Google Docs for creating new documentation
      return [...baseTools, ...ORACLE_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...DROPBOX_TOOLS, ...HUBSPOT_TOOLS, ...GOOGLE_DOCS_TOOLS];

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
