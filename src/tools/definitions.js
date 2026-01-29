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
    description: 'Search HubSpot CRM for individual people/contacts (decision-makers, employees, partners, auditors, etc.). Use this to find specific people by name or email, or to get contact details for people associated with companies. NOTE: For finding sales leads/prospects, use search_hubspot_companies instead - contacts include many non-lead people like grant auditors and client employees.',
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
    name: 'get_hubspot_company',
    description: 'Get complete details for a specific HubSpot company by ID. Use this when you have a company ID and need full details (name, industry, revenue, contacts, etc.). Much faster than searching when you already know the company ID.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: {
          type: 'string',
          description: 'HubSpot company ID (e.g., "50176995348")'
        }
      },
      required: ['company_id']
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
    description: 'Search HubSpot for companies/organizations (the primary entity for sales leads and prospects). Use this to find potential clients, active leads, opportunities, and customers. When asked about "leads", "prospects", "new clients", or "recent businesses", search COMPANIES not contacts - contacts include many non-lead people like grant auditors and client employees. Perfect for: "show me all lead companies created this week", "find technology companies that are opportunities", "list prospects with $1M+ revenue".',
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
    name: 'create_hubspot_company',
    description: 'Create a new company (sales lead) in HubSpot CRM. Use this for lead farming when you identify a potential client company. Automatically sets lifecyclestage to "lead". Returns the created company ID which you can use with update_hubspot_company or create_hubspot_contact. IMPORTANT: After creating a company, you should typically create associated contacts (decision-makers) using create_hubspot_contact and link them with associate_contact_with_company.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Company name (REQUIRED) - e.g., "Acme Corp", "TechStart Inc"'
        },
        domain: {
          type: 'string',
          description: 'Company website domain (recommended) - e.g., "acmecorp.com", "techstart.io". Do not include "www." or "https://"'
        },
        website: {
          type: 'string',
          description: 'Full website URL - e.g., "https://www.acmecorp.com"'
        },
        industry: {
          type: 'string',
          description: 'Industry/sector - e.g., "Technology", "Manufacturing", "Healthcare", "Agriculture"'
        },
        description: {
          type: 'string',
          description: 'Brief company description (1-2 sentences about what they do)'
        },
        about_us: {
          type: 'string',
          description: 'Detailed "About Us" section (longer description of company history, mission, products/services)'
        },
        city: {
          type: 'string',
          description: 'City location - e.g., "Vancouver", "Toronto"'
        },
        state: {
          type: 'string',
          description: 'Province/State - e.g., "British Columbia", "Ontario", "BC"'
        },
        country: {
          type: 'string',
          description: 'Country - e.g., "Canada", "United States"'
        },
        phone: {
          type: 'string',
          description: 'Company phone number'
        },
        numberofemployees: {
          type: 'number',
          description: 'Number of employees'
        },
        annualrevenue: {
          type: 'number',
          description: 'Annual revenue in dollars (e.g., 1000000 for $1M)'
        },
        incorporation_date: {
          type: 'string',
          description: 'Incorporation date in YYYY-MM-DD format (e.g., "2015-03-20")'
        },
        best_fit_product_company: {
          type: 'string',
          description: 'Best fit product/service for this company (e.g., "Granted Pro", "Granted Starter", "Custom", "CanExport", "Not a Fit")'
        },
        extra6: {
          type: 'string',
          description: 'Legal Business Name (official registered business name, may differ from "name")'
        },
        oracle_insight: {
          type: 'string',
          description: 'Oracle AI-generated lead insight (200-300 words): Company overview, grant program fit analysis, service offering recommendation, and recommended next action for sales team'
        },
        hubspot_owner_id: {
          type: 'string',
          description: 'HubSpot owner ID to assign this lead to (get from team members in your context)'
        },
        linkedin_company_page: {
          type: 'string',
          description: 'LinkedIn company page URL'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'update_hubspot_company',
    description: 'Update/enrich an existing company in HubSpot with additional information. Use this to fill in missing data after creating a company or to update outdated information. Only include properties you want to change - existing values for other properties will be preserved.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: {
          type: 'string',
          description: 'HubSpot company ID to update (from create_hubspot_company or search results)'
        },
        properties: {
          type: 'object',
          description: 'Properties to update (any combination of: name, domain, website, industry, description, about_us, city, state, country, phone, numberofemployees, annualrevenue, lifecyclestage, hubspot_owner_id, linkedin_company_page, best_fit_product_company, incorporation_date, extra6, oracle_insight)',
          properties: {
            name: { type: 'string' },
            domain: { type: 'string' },
            website: { type: 'string' },
            industry: { type: 'string' },
            description: { type: 'string' },
            about_us: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            country: { type: 'string' },
            phone: { type: 'string' },
            numberofemployees: { type: 'number' },
            annualrevenue: { type: 'number' },
            incorporation_date: {
              type: 'string',
              description: 'Incorporation date in YYYY-MM-DD format'
            },
            best_fit_product_company: {
              type: 'string',
              description: 'Best fit product/service for this company (e.g., "Granted Pro", "Granted Starter", "Custom", "CanExport", "Not a Fit")'
            },
            extra6: {
              type: 'string',
              description: 'Legal Business Name (official registered business name)'
            },
            oracle_insight: {
              type: 'string',
              description: 'Oracle AI-generated lead insight (200-300 words): Company overview, grant program fit analysis, service offering recommendation, and recommended next action for sales team'
            },
            lifecyclestage: {
              type: 'string',
              enum: ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other']
            },
            hubspot_owner_id: { type: 'string' },
            linkedin_company_page: { type: 'string' }
          }
        }
      },
      required: ['company_id', 'properties']
    }
  },
  {
    name: 'create_hubspot_contact',
    description: 'Create a new contact (person) in HubSpot CRM. Use this to add decision-makers, employees, or key contacts when lead farming. After creating, use associate_contact_with_company to link them to their company. Email is required - this is how HubSpot identifies unique contacts.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address (REQUIRED) - e.g., "john.doe@acmecorp.com". Must be unique in HubSpot.'
        },
        firstname: {
          type: 'string',
          description: 'First name - e.g., "John"'
        },
        lastname: {
          type: 'string',
          description: 'Last name - e.g., "Doe"'
        },
        jobtitle: {
          type: 'string',
          description: 'Job title - e.g., "CEO", "VP of Sales", "Marketing Director"'
        },
        phone: {
          type: 'string',
          description: 'Work phone number'
        },
        mobilephone: {
          type: 'string',
          description: 'Mobile phone number'
        },
        city: {
          type: 'string',
          description: 'City'
        },
        state: {
          type: 'string',
          description: 'Province/State'
        },
        country: {
          type: 'string',
          description: 'Country'
        },
        lifecyclestage: {
          type: 'string',
          enum: ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'],
          description: 'Lifecycle stage for this contact'
        },
        hubspot_owner_id: {
          type: 'string',
          description: 'HubSpot owner ID to assign this contact to'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'update_hubspot_contact',
    description: 'Update/enrich an existing contact in HubSpot with additional information. Only include properties you want to change - existing values will be preserved.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'HubSpot contact ID to update'
        },
        properties: {
          type: 'object',
          description: 'Properties to update (any combination of: email, firstname, lastname, jobtitle, phone, mobilephone, city, state, country, lifecyclestage, hubspot_owner_id)',
          properties: {
            email: { type: 'string' },
            firstname: { type: 'string' },
            lastname: { type: 'string' },
            jobtitle: { type: 'string' },
            phone: { type: 'string' },
            mobilephone: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            country: { type: 'string' },
            lifecyclestage: {
              type: 'string',
              enum: ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other']
            },
            hubspot_owner_id: { type: 'string' }
          }
        }
      },
      required: ['contact_id', 'properties']
    }
  },
  {
    name: 'associate_contact_with_company',
    description: 'Link a contact (person) to a company in HubSpot. Use this after creating both a company and contact to establish the relationship (e.g., "John Doe works at Acme Corp"). This creates the association visible in HubSpot UI showing the contact is employed by/related to the company.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'HubSpot contact ID (from create_hubspot_contact or search)'
        },
        company_id: {
          type: 'string',
          description: 'HubSpot company ID (from create_hubspot_company or search)'
        }
      },
      required: ['contact_id', 'company_id']
    }
  },
  {
    name: 'verify_company_website',
    description: 'Verify if a company\'s website is still active and accessible. Checks HTTP status, handles redirects, and identifies if the business appears to still be operating. Use this for lead verification to identify inactive/defunct companies. Returns status (active/inactive/unknown), HTTP status code, and detailed message about accessibility.',
    input_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Company domain or full URL to verify (e.g., "techco.com", "https://www.example.com")'
        }
      },
      required: ['domain']
    }
  },
  {
    name: 'find_duplicate_companies',
    description: 'Find potential duplicate company records in HubSpot by domain, name, or both. Use this to identify companies that may have been entered multiple times. Returns all matching records with key details (ID, name, domain, creation date, lifecycle stage) so you can decide which to merge. IMPORTANT: Always review results before merging - some matches may be legitimate separate entities (e.g., subsidiaries, franchises).',
    input_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Company domain to search for duplicates (e.g., "techco.com"). Most reliable method.'
        },
        name: {
          type: 'string',
          description: 'Company name to search for exact matches (e.g., "Acme Corp")'
        }
      },
      required: []
    }
  },
  {
    name: 'find_duplicate_contacts',
    description: 'Find potential duplicate contact records in HubSpot by email address. Use this to identify contacts that may have been entered multiple times. Returns all matching records with details (ID, name, job title, company, creation date) so you can decide which to merge.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to search for duplicates (e.g., "john@techco.com")'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'merge_duplicate_companies',
    description: 'Merge two duplicate company records in HubSpot. The primary company receives all data from the secondary company, and the secondary is deleted. All associations (contacts, deals, notes) are transferred to the primary. CRITICAL: This action is irreversible! Always use find_duplicate_companies first to confirm duplicates, and ask user which record to keep as primary.',
    input_schema: {
      type: 'object',
      properties: {
        primary_company_id: {
          type: 'string',
          description: 'HubSpot ID of the company to KEEP (receives all data). Usually the older/more complete record.'
        },
        secondary_company_id: {
          type: 'string',
          description: 'HubSpot ID of the company to MERGE and DELETE (data transferred to primary)'
        }
      },
      required: ['primary_company_id', 'secondary_company_id']
    }
  },
  {
    name: 'merge_duplicate_contacts',
    description: 'Merge two duplicate contact records in HubSpot. The primary contact receives all data from the secondary contact, and the secondary is deleted. All associations (companies, deals, notes) are transferred to the primary. CRITICAL: This action is irreversible! Always use find_duplicate_contacts first to confirm duplicates, and ask user which record to keep as primary.',
    input_schema: {
      type: 'object',
      properties: {
        primary_contact_id: {
          type: 'string',
          description: 'HubSpot ID of the contact to KEEP (receives all data). Usually the older/more complete record.'
        },
        secondary_contact_id: {
          type: 'string',
          description: 'HubSpot ID of the contact to MERGE and DELETE (data transferred to primary)'
        }
      },
      required: ['primary_contact_id', 'secondary_contact_id']
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

**CRITICAL - Active vs Inactive Grants:**
- By default, this tool ONLY returns ACTIVE grants (grants you can apply to NOW)
- When users ask "find grants for X", they mean ACTIVE grants unless stated otherwise
- NEVER return inactive grants unless the user explicitly asks for historical/inactive grants
- Always use active_only=true (default) for normal grant searches
- If an inactive grant is returned, CLEARLY label it as INACTIVE and suggest active alternatives

Use this to:
- Find grants for specific clients based on their industry, location, and needs
- Discover hiring, training, export, R&D, or capital grants
- Filter by region, company size, owner demographics
- Get quick summaries or full grant card details

This tool searches the internal GetGranted database (188+ Canadian grants) and returns matching opportunities with eligibility, funding details, and deadlines.

**Common use cases:**
- "Find hiring grants for a BC tech company with 25 employees" → active_only=true (default)
- "Show market expansion grants for Indigenous-owned businesses" → active_only=true
- "Search for R&D grants in Ontario with open intakes" → active_only=true, open_intakes_only=true
- "What grants did we have for digitization in 2023?" → active_only=false (historical search)`,
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
          default: true,
          description: 'Only show ACTIVE grants that can be applied to NOW (default: true). Set to false ONLY if user explicitly asks for inactive/historical/closed grants. When users ask "find grants for X", they mean active grants - keep this as true.'
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
  },
  {
    name: 'load_skill',
    description: `Load specialized skill documentation with methodologies, frameworks, and best practices for complex workflows.

**When to use this tool:**
Use when simple information retrieval is insufficient and you need specialized expertise for complex tasks.

**Available skills:**

**Sales Skill:**
- \`lead_farming\` - Complete lead creation & enrichment workflow (12 priority fields, confidence scoring)
- \`linkedin_enrichment\` - Free LinkedIn research strategies for companies and decision-makers
- \`data_quality\` - Verification, deduplication, and cleanup workflows
- \`icp_analysis\` - Build Ideal Client Profiles from won customer patterns

**Grants Skill:**
- \`overview\` - Grant workflow decision tree and capability overview
- \`eligibility\` - Eligibility analysis framework and disqualifiers
- \`matching\` - Client-to-program matching methodology
- \`validation\` - Grant status validation workflow (MANDATORY before recommendations)

**Research Skill (coming soon):**
- \`company_intelligence\` - Systematic company research with multi-source validation

**Do NOT load skills for simple queries:**
- "Tell me about Company X" → Use tools directly
- "Find grants for BC tech companies" → Use search_getgranted
- "Show me recent alerts" → Use get_visualping_alerts

**Load skills for specialized tasks:**
- "Enrich TechCo's HubSpot record with 12 priority fields" → load_skill(sales, lead_farming)
- "Find duplicate companies and merge them" → load_skill(sales, data_quality)
- "Build an ICP from our construction customers" → load_skill(sales, icp_analysis)
- "Check if Company X qualifies for Grant Y" → load_skill(grants, eligibility)
- "Find best grants for this construction company" → load_skill(grants, matching)
- "Validate if program X is accepting applications" → load_skill(grants, validation)`,
    input_schema: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          enum: ['sales', 'research', 'grants', 'writing'],
          description: 'The skill domain to load'
        },
        sub_skill: {
          type: 'string',
          enum: ['lead_farming', 'linkedin_enrichment', 'data_quality', 'icp_analysis', 'overview', 'eligibility', 'matching', 'validation', 'company_intelligence'],
          description: 'Specific methodology to load. For sales: lead_farming (enrichment), linkedin_enrichment (research), data_quality (deduplication), icp_analysis (customer patterns). For grants: overview (decision tree), eligibility (qualification framework), matching (program selection), validation (status verification).'
        }
      },
      required: ['skill_name', 'sub_skill']
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
 * @param {boolean} useToolSearch - If true, use tool search pattern (default: true)
 * @returns {Array} Array of tool definitions for this agent
 */
export function getToolsForAgent(agentType) {
  // All agents get server tools and memory (file-based + database)
  const baseTools = [...SERVER_TOOLS, ANTHROPIC_MEMORY_TOOL, ...MEMORY_TOOLS];

  // Core HubSpot tools needed for most agents (enrichment, search, CRUD operations)
  const coreHubSpotTools = HUBSPOT_TOOLS.filter(tool =>
    ['search_hubspot_contacts', 'search_hubspot_companies', 'search_hubspot_deals',
     'get_hubspot_contact', 'get_hubspot_company', 'get_hubspot_deal',
     'create_hubspot_contact', 'create_hubspot_company',
     'update_hubspot_contact', 'update_hubspot_company', 'update_hubspot_deal',
     'associate_contact_with_company', 'search_getgranted',
     'generate_hubspot_embed_link'].includes(tool.name)
  );

  // Curated tool sets per agent - only include what each agent actually uses
  switch (agentType) {
    case 'grant-card-generator':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length} tools)`);
      return [...baseTools, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS];

    case 'etg-writer':
    case 'bcafe-writer':
    case 'buybc-writer':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length} tools)`);
      return [...baseTools, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS];

    case 'canexport-claims':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + HUBSPOT_TOOLS.length + GOOGLE_DRIVE_TOOLS.length} tools)`);
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS];

    case 'canexport-writer':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + HUBSPOT_TOOLS.length + GOOGLE_DRIVE_TOOLS.length + CANEXPORT_WRITER_TOOLS.length + GOOGLE_DOCS_TOOLS.length} tools)`);
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...CANEXPORT_WRITER_TOOLS, ...GOOGLE_DOCS_TOOLS];

    case 'readiness-strategist':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length + GOOGLE_DOCS_TOOLS.length} tools)`);
      return [...baseTools, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_DOCS_TOOLS];

    case 'internal-oracle':
      // Oracle needs: search/enrichment tools + Oracle KB + minimal HubSpot
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + ORACLE_TOOLS.length + GOOGLE_DRIVE_TOOLS.length + DROPBOX_TOOLS.length + coreHubSpotTools.length} tools)`);
      return [...baseTools, ...ORACLE_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...DROPBOX_TOOLS, ...coreHubSpotTools];

    case 'orchestrator':
      console.log(`🔧 Agent ${agentType} using ALL tools (${ALL_TOOLS.length} tools)`);
      return ALL_TOOLS;

    default:
      console.warn(`Unknown agent type: ${agentType}, using base tools only (${baseTools.length} tools)`);
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
