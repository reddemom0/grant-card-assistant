/**
 * Tool Definitions for Direct Claude API
 *
 * Defines all tools available to agents:
 * - Server tools (executed by Anthropic)
 * - Client tools (executed locally)
 *
 * Last updated: 2026-02-16 - Added canexport-writer skills to load_skill enum
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
          description: 'Best fit product/service for this company (e.g., "Granted Pro", "Granted Starter", "Custom", "CanExport", "Get Granted")'
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
              description: 'Best fit product/service for this company (e.g., "Granted Pro", "Granted Starter", "Custom", "CanExport", "Get Granted")'
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
    name: 'create_hubspot_deal',
    description: 'Create a new deal in HubSpot with the specified properties and optional company/contact associations. Use this when a team member asks to create a new grant application deal, either from a conversation or from a spreadsheet. The deal will be created in the pipeline and stage you specify. You MUST provide at minimum: dealname, pipeline (as the pipeline ID), and dealstage (as the pipeline-specific stage ID). Other properties depend on which pipeline and stage you\'re creating into — consult the HubSpot Deal Creation skill for the full required-field matrix per pipeline. Associations (company + contact) should be included in the same call when possible; if either fails after the deal is created, the function will still return success with warnings. Returns the new deal ID and a direct HubSpot URL.',
    input_schema: {
      type: 'object',
      properties: {
        properties: {
          type: 'object',
          description: 'HubSpot deal properties. Keys must be HubSpot API names (e.g., "dealname", "pipeline", "dealstage", "grant_type", "dealtype"). At minimum must include dealname, pipeline, and dealstage. Use HubSpot API names, not display labels.',
          additionalProperties: true,
          properties: {
            dealname: {
              type: 'string',
              description: 'Deal name (REQUIRED) - e.g., "Acme Corp - ETG - Q2 2026"'
            },
            pipeline: {
              type: 'string',
              description: 'Pipeline ID (REQUIRED) - e.g., "2662913" for Hiring Grants. Use the numeric pipeline ID, not the label.'
            },
            dealstage: {
              type: 'string',
              description: 'Stage ID (REQUIRED) - e.g., "9371216" for Hiring Pending Submission. Use the pipeline-specific numeric stage ID, not the label.'
            }
          },
          required: ['dealname', 'pipeline', 'dealstage']
        },
        associations: {
          type: 'object',
          description: 'Optional associations to create alongside the deal.',
          properties: {
            companyId: {
              type: 'string',
              description: 'HubSpot company ID to associate as primary company on the deal'
            },
            contactIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of HubSpot contact IDs to associate with the deal'
            }
          }
        }
      },
      required: ['properties']
    }
  },
  {
    name: 'update_hubspot_deal',
    description: 'Update properties on an existing HubSpot deal. Use this to change property values on a deal that already exists — for example, moving it to a new stage, updating a reimbursement amount, or filling in fields after the fact. Requires the deal ID and an object of properties to update (only include the properties you want to change, not all of them). Does not touch associations. For creating a new deal, use create_hubspot_deal instead.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'HubSpot deal ID to update (from create_hubspot_deal or search results)'
        },
        properties: {
          type: 'object',
          description: 'Properties to update. Keys are HubSpot API names (e.g., "dealstage", "grant_type", "amount"), values are the new values. Only include properties you want to change.',
          additionalProperties: true
        }
      },
      required: ['deal_id', 'properties']
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
  },
  {
    name: 'get_hubspot_notes',
    description: 'Get notes associated with a HubSpot record (company, contact, or deal). Returns all notes logged on the record\'s timeline, sorted by most recent first. Use this to see internal team notes, client communications, and historical context. Notes can contain important context about client conversations, project updates, or internal decisions.',
    input_schema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          enum: ['companies', 'contacts', 'deals'],
          description: 'Type of HubSpot record (companies, contacts, or deals)'
        },
        record_id: {
          type: 'string',
          description: 'HubSpot record ID (company ID, contact ID, or deal ID)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return (default: 20)',
          default: 20
        }
      },
      required: ['object_type', 'record_id']
    }
  },
  {
    name: 'get_program_stats',
    description: 'Returns Granted\'s aggregate track record on a specific grant program: success rate, sample size, deal duration, and confidence band. Queries HubSpot deals across all 6 grant pipelines. Success = Won + downstream states (Invoice Paid/Cleared, Retainer Sent/Paid). success_rate denominator is won+lost (pending deals excluded from rate). Use this when the marketing skill or any other skill needs a traceable, auditable stat to cite about Granted\'s performance on a program. Returns structured error if program_name is not a valid grant_type enum value — never returns silent 0%.',
    input_schema: {
      type: 'object',
      properties: {
        program_name: {
          type: 'string',
          description: 'Exact grant_type enum value (e.g., "ETG - BC", "CanExport", "BC MDP", "CSJ"). Must match HubSpot grant_type enum exactly.'
        },
        include_starter: {
          type: 'boolean',
          description: 'Include Granted Starter pipelines in the stats (default true). Set false to isolate the Pro-tier track record.',
          default: true
        }
      },
      required: ['program_name']
    }
  },
  {
    name: 'get_deal_count',
    description: 'Returns the count of HubSpot deals on a grant program within a lookback window. Used to identify programs with recent activity. Queries all 6 grant pipelines by default. Returns structured error if program_name is not a valid grant_type enum value.',
    input_schema: {
      type: 'object',
      properties: {
        program_name: {
          type: 'string',
          description: 'Exact grant_type enum value (e.g., "ETG - BC", "CanExport").'
        },
        date_range_months: {
          type: 'number',
          description: 'Lookback window in months (default 12). Counts deals with createdate >= now - N months.',
          default: 12
        },
        include_starter: {
          type: 'boolean',
          description: 'Include Granted Starter pipelines in the count (default true).',
          default: true
        }
      },
      required: ['program_name']
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
// GRANOLA TOOLS
// Wrap the Granola MCP server's tools (per-user OAuth via remote MCP client).
// User connects via /api/auth/granola; tokens stored in user_oauth_tokens.
// ============================================================================

export const GRANOLA_TOOLS = [
  {
    name: 'granola_query_meetings',
    description: 'Search and chat with the user\'s Granola meeting notes. Use when the user asks a natural-language question about their meetings (e.g., "what did we decide about pricing last week?").',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language search query.' }
      },
      required: ['query']
    }
  },
  {
    name: 'granola_list_meetings',
    description: 'List the user\'s Granola meetings with metadata (id, title, date, attendees). Use to find meeting IDs before fetching content. Optional folder/date filters.',
    input_schema: {
      type: 'object',
      properties: {
        folder_id:  { type: 'string', description: 'Optional Granola folder ID to filter by.' },
        start_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD); only meetings on or after this date.' },
        end_date:   { type: 'string', description: 'Optional ISO date (YYYY-MM-DD); only meetings on or before this date.' },
        limit:      { type: 'number', description: 'Optional max number of meetings to return.' }
      }
    }
  },
  {
    name: 'granola_get_meetings',
    description: 'Get full meeting content (private and enhanced notes) for one or more Granola meetings by ID. Use after granola_list_meetings or granola_query_meetings has identified candidates.',
    input_schema: {
      type: 'object',
      properties: {
        meeting_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Granola meeting IDs.'
        }
      },
      required: ['meeting_ids']
    }
  },
  {
    name: 'granola_get_meeting_transcript',
    description: 'Get the raw transcript for a specific Granola meeting by ID. Use when the user asks for verbatim quotes or detailed conversation flow.',
    input_schema: {
      type: 'object',
      properties: {
        meeting_id: { type: 'string', description: 'Granola meeting ID.' }
      },
      required: ['meeting_id']
    }
  },
  {
    name: 'granola_list_meeting_folders',
    description: 'List the Granola meeting folders the user is a member of. Use to discover folder IDs for filtering granola_list_meetings.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  }
];

// ============================================================================
// LOAD SKILL TOOL
// Single source of truth for skill loading across all agents.
// DO NOT create per-agent copies of this tool definition. If a new skill domain
// or sub-skill needs to be added, update the enums here — every agent that
// includes LOAD_SKILL_TOOL will pick up the change automatically.
// ============================================================================

export const LOAD_SKILL_TOOL = {
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

**CanExport Writer Skill:**
- \`overview\` - Skills overview and decision tree for CanExport application lifecycle
- \`PROGRAM_DETAILS\` - Complete CanExport SME program details (eligibility, expenses, compliance rules)
- \`APPLICATION_STRUCTURE\` - All 8 application sections with character limits and requirements
- \`KNOWLEDGE_BASE_INDEX\` - Index of Google Drive knowledge base documents
- \`STAGE_1_READINESS\` - Preparedness assessment methodology and rubrics
- \`STAGE_1_BUDGET_GUIDE\` - Budget Building Guide creation methodology
- \`STAGE_1_INTERVIEW_QUESTIONS\` - Budget Review Interview Questions generation
- \`STAGE_2_DRAFTING\` - Section-by-section application drafting guidance
- \`STAGE_3_REVIEW\` - Application review and optimization using evaluation criteria

**BCAFE Writer Skill:**
- \`FINAL_REPORT\` - Final Progress Report writing guide (template-aligned, section-by-section guidance)

**HubSpot Skill:**
- \`DEAL_CREATION\` - Full deal creation workflow: pipeline selection, required-field matrix, enum references, confirmation flow, batch mode, error handling. MANDATORY before any deal write.

**Granted Marketing Skill:**
- \`overview\` - Marketing strategy and content production overview
- \`FOUNDATIONS\` - Brand voice, audience, and positioning fundamentals
- \`COMPANY_CONTEXT\` - Granted Consulting product lines and positioning
- \`GRANT_BLASTS\` - Grant Blasts content methodology
- \`BLOGS\` - Blog post creation methodology
- \`EMAILS\` - Email drafting playbook (Grant Blast, Blog Blast, webinar promo, success story share, re-engagement, etc.)
- \`LINKEDIN\` - LinkedIn post types, hook discipline, voice rules, attribution
- \`WEBINARS\` - Webinar cadence, 2026 schedule, promo sequence, monthly content rhythm
- \`SUCCESS_STORIES\` - Client success story drafting — four-part narrative, length variants, anonymization
- \`PARTNERSHIPS\` - Partnership outreach (CPAs, CFOs, accelerators, banks, VCs, industry associations)
- \`DATA_SOURCES\` - Content sourcing and data references
- \`EXPLORATION\` - Idea-generation: weekly digests + scoped exploration. Load when the user is asking what to write about (not when they've already specified the subject).

**Staff Meeting Recap Skill:**
- \`overview\` - End-to-end weekly staff meeting recap (Granola transcript → Weekly Staff Meeting Sheet Oracle Notes column + last-week/coming-week action items). MANDATORY for any "process/recap/fill in [date] staff meeting" request.

**Grant Card Writing Skill:**
- \`OVERVIEW\` - General formatting rules, grant-type detection, and routing to the type-specific sub-skill (load first)
- \`RD\` - R&D grant card format (TRL, scalability, IP, GHG outcomes)
- \`BUSINESS_ASSESSMENT\` - Advisory/planning/coaching grant card format
- \`MARKET_EXPANSION\` - Domestic/international market entry grant card format
- \`HIRING_TRAINING\` - Wage subsidy/student placement/workforce grant card format
- \`SYSTEMS_PROCESSES\` - Software adoption/automation/process improvement grant card format
- \`CAPITAL_COST\` - Equipment/facility/retrofit grant card format
- \`LOANS\` - Repayable financing program card format
- \`INVESTMENT\` - Equity investment program card format
- \`PRIZES_CONTESTS\` - Competition/award/prize program card format

**Grant Card Tagging Skill:**
- \`OVERVIEW\` - Score grant programs across 13 fields × 52 genres on 0-3 scale (matches GG2 v2 mirror taxonomy)

**Granted Insights Skill:**
- \`OVERVIEW\` - Consultant-grade strategic insights framework: voice, anti-fabrication discipline, grant-type classification, and fallback output format (load first)
- \`HIRING\` - Strategic read on Pure/dominant Hiring grants (net-new requirement, candidate constraints, timing rules, reimbursement burden)
- \`TRAINING\` - Strategic read on Training grants (fine-print exclusions, exam/certification fees, approved-provider lists, pre-approval)
- \`MARKET_EXPANSION\` - Strategic read on Market Expansion grants (export-readiness bar, eligible markets, project window, spend-first cash flow)
- \`RD_CAPEX\` - Strategic read on R&D and Capital Cost grants (TRL fit, pre-approval, matching funds, max-vs-realistic funding)
- \`REPAYABLE_FUNDING\` - Strategic read on loans/repayable/non-dilutive financing (forgivable portion, guarantees, underwriting, "sounds like a grant" trap)
- \`EXEMPLAR\` - Always load alongside the type sub-skill — anchors the strategist voice and rhythm the output should match

**Strategy Consulting Skill (internal team — how Granted's consultants think):**
- \`overview\` - Skill map, decision tree, and internal-use boundaries (program names always shared internally)
- \`DISCOVERY\` - Discovery call prep: five core dimensions, probes for 11 client types, 5 critical eligibility gates, contact-type adaptation
- \`SIZING\` - Rightsizing a client to a service tier: decision tree by revenue/volume/sophistication, 10x-ROI heuristic
- \`SEQUENCING\` - Grant roadmap building: 5-part priority framework, 9 real sequencing patterns, annual strategy rhythm
- \`CONVERSATIONS\` - Consultant prep for client conversations: trust principles, analogies, sophistication-adapted framing, competitive differentiation, 11-objection playbook
- \`RED_FLAGS\` - Prospect screening: 9 hard disqualifiers, 10 soft red flags, how to deliver a "no"
- \`TIMING\` - Timing strategy: apply-before-spend, fiscal-year plays, semester alignment, re-application timing

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
- "Validate if program X is accepting applications" → load_skill(grants, validation)
- "What are the CanExport application questions?" → load_skill(canexport-writer, APPLICATION_STRUCTURE)
- "Assess client readiness for CanExport" → load_skill(canexport-writer, STAGE_1_READINESS)
- "Draft Section 2 of the application" → load_skill(canexport-writer, STAGE_2_DRAFTING)
- "Review this CanExport draft" → load_skill(canexport-writer, STAGE_3_REVIEW)
- "Help with BCAFE final report" → load_skill(bcafe-writer, FINAL_REPORT)
- "Create a WorkBC deal for TechCo" → load_skill(hubspot, DEAL_CREATION)
- "Draft a Grant Blast for GetGranted" → load_skill(granted-marketing, GRANT_BLASTS)
- "Process the May 6 staff meeting" → load_skill(staff-meeting-recap, overview)
- "Recap last Tuesday's meeting" → load_skill(staff-meeting-recap, overview)
- "Write a grant card for this RFP" → load_skill(grant-card-writing, OVERVIEW)
- "This looks like an R&D program — generate the card" → load_skill(grant-card-writing, RD)
- "Generate genre tags for this program" → load_skill(grant-card-tagging, OVERVIEW)
- "Give me the Granted Insights on this program" → load_skill(granted-insights, OVERVIEW)
- "Strategic read on this hiring grant — is it worth pursuing?" → load_skill(granted-insights, HIRING)
- "Should we recommend this loan program to a client?" → load_skill(granted-insights, REPAYABLE_FUNDING)
- "Prep me for a discovery call with a manufacturer" → load_skill(strategy-consulting, DISCOVERY)
- "Build a grant roadmap for this client" → load_skill(strategy-consulting, SEQUENCING)
- "Should this client be on Starter or Pro?" → load_skill(strategy-consulting, SIZING)
- "Any red flags before we take this prospect?" → load_skill(strategy-consulting, RED_FLAGS)
- "They got burned by a grant consultant before — how do I handle it?" → load_skill(strategy-consulting, CONVERSATIONS)`,
  input_schema: {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
        enum: ['sales', 'research', 'grants', 'canexport-writer', 'bcafe-writer', 'hubspot', 'granted-marketing', 'staff-meeting-recap', 'grant-card-writing', 'grant-card-tagging', 'granted-insights', 'strategy-consulting'],
        description: 'The skill domain to load'
      },
      sub_skill: {
        type: 'string',
        enum: [
          'lead_farming', 'linkedin_enrichment', 'data_quality', 'icp_analysis',
          'overview', 'eligibility', 'matching', 'validation', 'company_intelligence',
          'PROGRAM_DETAILS', 'APPLICATION_STRUCTURE', 'KNOWLEDGE_BASE_INDEX',
          'STAGE_1_READINESS', 'STAGE_1_BUDGET_GUIDE', 'STAGE_1_INTERVIEW_QUESTIONS',
          'STAGE_2_DRAFTING', 'STAGE_3_REVIEW', 'FINAL_REPORT', 'DEAL_CREATION',
          'FOUNDATIONS', 'COMPANY_CONTEXT', 'GRANT_BLASTS', 'BLOGS', 'EMAILS', 'LINKEDIN', 'WEBINARS', 'SUCCESS_STORIES', 'PARTNERSHIPS', 'DATA_SOURCES', 'EXPLORATION',
          'OVERVIEW', 'RD', 'BUSINESS_ASSESSMENT', 'MARKET_EXPANSION', 'HIRING_TRAINING',
          'SYSTEMS_PROCESSES', 'CAPITAL_COST', 'LOANS', 'INVESTMENT', 'PRIZES_CONTESTS',
          'HIRING', 'TRAINING', 'RD_CAPEX', 'REPAYABLE_FUNDING', 'EXEMPLAR',
          'DISCOVERY', 'SIZING', 'SEQUENCING', 'CONVERSATIONS', 'RED_FLAGS', 'TIMING'
        ],
        description: 'Specific methodology to load. For sales: lead_farming (enrichment), linkedin_enrichment (research), data_quality (deduplication), icp_analysis (customer patterns). For grants: overview (decision tree), eligibility (qualification framework), matching (program selection), validation (status verification). For canexport-writer: overview (skills index), PROGRAM_DETAILS (program rules), APPLICATION_STRUCTURE (form sections), STAGE_1_READINESS (assessment), STAGE_1_BUDGET_GUIDE (budget guides), STAGE_1_INTERVIEW_QUESTIONS (interview questions), STAGE_2_DRAFTING (section drafting), STAGE_3_REVIEW (application review). For bcafe-writer: FINAL_REPORT (final progress report writing guide). For hubspot: DEAL_CREATION (deal creation workflow — MANDATORY before any deal write). For granted-marketing: overview (marketing overview), FOUNDATIONS (brand voice/audience), COMPANY_CONTEXT (product lines), GRANT_BLASTS (blast methodology), BLOGS (blog methodology), EMAILS (email drafting), LINKEDIN (LinkedIn posts), WEBINARS (webinar planning + monthly rhythm), SUCCESS_STORIES (case study drafting), PARTNERSHIPS (partner outreach), DATA_SOURCES (content sourcing), EXPLORATION (idea generation/weekly digests). For grant-card-writing: OVERVIEW (general rules + type detection, load first), RD/BUSINESS_ASSESSMENT/MARKET_EXPANSION/HIRING_TRAINING/SYSTEMS_PROCESSES/CAPITAL_COST/LOANS/INVESTMENT/PRIZES_CONTESTS (per-type section format rules). For grant-card-tagging: OVERVIEW (score grant programs across 13 fields × 52 genres on 0-3 scale, GG2 v2 mirror-taxonomy compatible). For granted-insights: OVERVIEW (general strategic-insights framework + fallback output format, load first), HIRING/TRAINING/MARKET_EXPANSION/RD_CAPEX/REPAYABLE_FUNDING (type-specific consultant read — fit, effort, competitiveness, watchouts), EXEMPLAR (always load alongside the type sub-skill to anchor strategist voice). For strategy-consulting: overview (skill map + internal boundaries), DISCOVERY (call prep + client-type probes), SIZING (service-tier rightsizing), SEQUENCING (grant roadmap building), CONVERSATIONS (objection/differentiation prep), RED_FLAGS (prospect screening), TIMING (fiscal-year and apply-before-spend strategy).'
      }
    },
    required: ['skill_name', 'sub_skill']
  }
};

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
    name: 'check_blog_coverage',
    description: `Check existing granted.ca blog coverage on a topic before recommending new blog posts or refreshes. Wraps the granted.ca WordPress REST API and returns matching posts (id, slug, title, modified date, excerpt, link).

Use this whenever the marketing skill asks you to check what's already been written — including the §3 universal content-discovery rule in granted-marketing/SKILL.md.

Provide at least one of:
- topic — free-text search (e.g., "agritech grants", "CanExport"). NOTE: WordPress's search index drops ampersands, so "SR&ED" returns 0 results — use "SRED" instead.
- slug — exact post slug for known-post lookup
- modified_after — ISO 8601 date (e.g., "2024-01-01") for freshness/staleness checks
- category — WordPress category ID. Known IDs: 70 (Advice and Explainers), 76 (Customer Success — success stories live here), 154 (Grant Summaries), 153 (News), 156 (Product and Service Updates).

Returns up to 5 posts per call with title and excerpt HTML stripped. Interpret results:
- count=0 or all matches loose/incidental → likely a new-angle opportunity
- multiple substantive recent matches → topic is well-covered, consider refresh or distinct angle
- matches with old modified dates → refresh candidates`,
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Free-text search query against post title and content.'
        },
        slug: {
          type: 'string',
          description: 'Exact WordPress post slug for known-post lookup.'
        },
        modified_after: {
          type: 'string',
          description: 'ISO 8601 date (e.g., "2024-01-01"). Returns only posts modified after this date.'
        },
        category: {
          type: 'number',
          description: 'WordPress category ID. Use 76 to filter to Customer Success (success stories).'
        }
      }
    }
  },
  {
    name: 'check_marketing_calendar',
    description: `Check the team's working Marketing/Ops Calendar Sheet for what content is scheduled. Wraps read_sheet_range against the calendar Sheet — internalizes the Sheet ID, monthly tab resolution, A1 ranges, and prefix-parse logic so you don't have to construct them.

Use this whenever the marketing skill (BLOGS, WEBINARS, EMAILS, LINKEDIN, SUCCESS_STORIES, EXPLORATION) asks you to check what's actually scheduled — including the §5 "before asking the user for topic and date" pre-check in WEBINARS.md and the §2 live-source pointers in BLOGS/WEBINARS.

All three params are optional. Default behavior (no params) scans the current month + next month tabs only — the common case ("is X coming up?"). Pass month: "all" to scan all 12 monthly tabs (use only when the user explicitly asks about full-year scheduling).

- topic — case-insensitive substring filter against the entry text (e.g., "CanExport", "SIF")
- content_type — restrict to one type. Allowed: "Webinar", "Blog", "Email", "Linkedin"
- month — single month name ("May", "June", ...) or "all". Omit to default to current + next month.

Returns: { success, count, query, tabs_scanned, entries: [{ month, content_type, entry, cell }] }. Empty results are a valid answer (success: true, count: 0) — not a tool error.`,
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Case-insensitive substring filter against entry text. E.g., "CanExport", "SIF", "Strategic Innovation Fund".'
        },
        content_type: {
          type: 'string',
          enum: ['Webinar', 'Blog', 'Email', 'Linkedin'],
          description: 'Restrict to one content type. Omit to return all four.'
        },
        month: {
          type: 'string',
          description: 'Single month name (e.g., "May") or "all" for every monthly tab. Omit to scan current + next month (the default).'
        }
      }
    }
  },
  {
    name: 'get_recent_granted_ca_post',
    description: `List the most recently modified posts on granted.ca, sorted by modified date descending. Wraps the granted.ca WordPress REST API and returns slim post records (id, slug, title, modified date, excerpt, link).

Use this when the question is "what got published recently?" rather than "is X covered?":
- EMAILS / LINKEDIN slug-lookup workflows: user asks for a Blog Blast or success-story share / blog promo / success-story post → list recent posts → user picks one → draft.
- BLOGS refresh discovery: list recent blogs to spot what hasn't been refreshed lately (combine with the modified date in each result).

For category-specific recency:
- category: 76 → recent Customer Success posts (the published success-story corpus)
- category: 70 → Advice and Explainers
- category: 154 → Grant Summaries
- category: 153 → News
- category: 156 → Product and Service Updates
- (omit category to scan all categories)

Defaults: days=30, limit=10, no category filter. limit capped at 20. Returns up to limit posts within the time window. Empty results are a valid answer (count: 0, not an error).`,
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'number',
          description: 'WordPress category ID. Use 76 for Customer Success (success stories). Omit for all categories.'
        },
        days: {
          type: 'number',
          description: 'How far back to scan, in days. Default 30. Use larger values (e.g., 90) when "recent" should mean quarterly.'
        },
        limit: {
          type: 'number',
          description: 'How many posts to return. Default 10, max 20.'
        }
      }
    }
  },
  {
    name: 'search_recent_wins',
    description: `Returns recent won deals. Filterable by program, industry, and date window. Note: industry filtering triggers an extra company-data lookup; prefer program or date filters when both will return what you need.

Wraps search_grant_applications under the hood for marketing analytics use cases — proof points, humanization posts, "what did we win for [industry] this quarter" questions. Defaults: days=90 (one quarter), limit=10, no program or industry filter; cap at 25.

**Returned fields:** company_name, program, deal_amount (approved funding), won_date (close date), consultant (resolved owner name). When industry filter is used, an industry field is also included.

**Consent discipline:** Returns named clients without consent filtering. Treat results as internal reference only. Anonymize before publishing unless the client appears in the public-consent list (COMPANY_CONTEXT §9 of the granted-marketing skill).

**Amount accuracy:** deal_amount reflects the client_reimbursement field (grant amount won by the client). It may be null for some programs (e.g., CSJ where 76% of past-approval deals lack the field). Surface null amounts honestly; do not invent dollar figures when amounts are missing.

**Filter semantics:** This tool filters by deal stage (past-approval stages across grant pipelines), not by deal status. The two can diverge — a deal may have a "Won" status but be in an Abandoned stage. Stage is the source of truth for "did this grant actually land?" in Granted's workflow.

**Industry filter data-availability:** When an industry filter is requested but the companies in the result set lack industry data (common for older deals or accounts where industry was not filled in), the response will include \`filter_data_unavailable: true\` and a \`note\` field. In that case, unfiltered wins are returned alongside the flag — surface this honestly to the user; do not pretend the filter applied.

**Industry filter zero-match with vocabulary mismatch:** When the industry filter substring-matches nothing but companies in the result set DO have industry data (e.g., user searched "food" but the actual enum values are "RESTAURANTS", "COFFEE_TEA", etc.), the response includes \`available_industry_values\` (the full sorted list of industry enum values present in the result set) plus a \`match_hint\` field. Use this list to re-query against the actual vocabulary rather than the user's natural-language phrasing.`,
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Lookback window in days. Default 90 (one quarter). Use 30 for "this month", 365 for "this year".'
        },
        program: {
          type: 'string',
          description: 'Optional program filter (e.g., "ETG", "CanExport", "BCAFE", "DS4Y", "CSJ"). Pass-through to search_grant_applications, which handles the program-name enum mapping.'
        },
        industry: {
          type: 'string',
          description: 'Optional industry filter — case-insensitive substring match against the HubSpot industry property on the associated company for each deal (e.g., "Construction", "food", "tech"). Triggers an extra company-data lookup; omit when not needed.'
        },
        limit: {
          type: 'number',
          description: 'Maximum wins to return. Default 10, max 25.'
        }
      }
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
- Search grants by name or keywords (e.g., "BuyBC", "hiring grant", "export funding")
- Find grants for specific clients based on their industry, location, and needs
- Discover hiring, training, export, R&D, or capital grants
- Filter by region, company size, owner demographics
- Get quick summaries or full grant card details

This tool searches the internal GetGranted database (188+ Canadian grants, synced daily at 2 AM PT) and returns matching opportunities with eligibility, funding details, and deadlines.

**⚠️ DATA FRESHNESS**: Database syncs daily at 2 AM Pacific Time, so data may be up to 24 hours old. For critical deadline verification, Oracle should also:
1. Check VisualPing alerts for recent changes to this grant
2. Run a web search for "{grant_name} deadline 2026" to find recent announcements
3. Cross-reference multiple sources before confirming deadline dates

**Search Strategy:**
1. Start with 'query' parameter for text-based search (searches grant names, criteria, descriptions)
2. Add filters (purposes, regions, industries) to narrow results
3. Use 'fetch_full_details' to get complete grant card information

**Common use cases:**
- "Find the BuyBC grant" → query: "BuyBC", active_only: true
- "Find hiring grants for a BC tech company" → query: "hiring", regions: ["British Columbia"], industries: ["Technology"], active_only: true
- "Show market expansion grants for Indigenous-owned businesses" → purposes: ["Market Expansion"], owner_demographics: ["Indigenous"], active_only: true
- "Search for R&D grants in Ontario with open intakes" → query: "R&D", regions: ["Ontario"], open_intakes_only: true, active_only: true
- "What grants did we have for digitization in 2023?" → query: "digitization", active_only: false (historical search)`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search query to match against grant names, descriptions, criteria, and other text fields. Use this for searching specific grant names or keywords (e.g., "BuyBC", "export", "training"). Leave empty to browse all grants with filters only.'
        },
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
    name: 'search_federal_grants_aggregate',
    description: `Aggregate-mode search over the Government of Canada Proactive Disclosure dataset (federal grants and contribution agreements, ~1.26M rows). Returns grouped rollups: counts, total dollars, average award size, median, YoY growth, p90. Always returns net values — queries run against pdg_latest_amendments (one row per ref_number) so amendments don't double-count.

**When to use:** the question is "what's the trend / how much / by which program or department / which industries / which provinces". For "show me actual recipients" or "list the agreements", use search_federal_grants_records instead.

**Source routing (transparent):** when group_by + filters + metrics fit the pdg_program_yearly matview shape (program / department / fiscal_year / province / recipient_type), the matview is used (sub-second). Otherwise falls back to pdg_latest_amendments (slower but supports naics, riding, city, description keyword, having_distinct, p90, fiscal_quarter, min/max value, agreement_type, recipient_business_number). The response includes a query_path field so you can see which was used.

**NAICS filters:** pass EITHER naics_industry (substring matched against StatsCan NAICS label_en — e.g., "agriculture", "manufacturing") OR naics_prefix (raw 2-6 digit code — e.g., "11", "311"). Not both.

**having_distinct:** group_by + HAVING COUNT(DISTINCT field) >= min_count. Use for "companies with multiple federal grants across different programs" — group_by recipient_business_number, having_distinct={field:'program', min_count:2}. Forces latest_view path.

**Data caveats:** federal only (no provincial/municipal). Post-award only (no rejections). Program names are not de-duplicated — the same program may appear under spelling variants. Treat top-N lists as approximate.`,
    input_schema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['program', 'department', 'province', 'recipient_type', 'naics_industry', 'fiscal_year', 'fiscal_quarter', 'riding', 'recipient_business_number']
          },
          description: 'One or more grouping dimensions. Most queries use 1-2.'
        },
        metrics: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['count', 'total_value', 'avg_value', 'median_value', 'yoy_growth', 'p90_value']
          },
          description: 'What to compute per group. Default ["count","total_value"]. yoy_growth compares last 12 months to the prior 12 months per group (do NOT combine with fiscal_year group_by). p90_value forces latest_view path.'
        },
        filters: {
          type: 'object',
          properties: {
            program_name:        { type: 'string', description: 'Substring match against prog_name_en.' },
            department:          { type: 'string', description: 'Substring match against owner_org_title.' },
            province:            { type: 'string', description: '2-letter province code (e.g., "BC").' },
            recipient_type:      { type: 'string', enum: ['F','N','A','S','P','G','I','O'], description: 'F=for-profit, N=non-profit, A=Indigenous, S=academia, P=individual, G=government, I=international, O=other.' },
            naics_industry:      { type: 'string', description: 'Substring matched against StatsCan NAICS label_en (e.g., "agriculture"). Resolved to codes, then applied as a NAICS prefix filter. Mutually exclusive with naics_prefix.' },
            naics_prefix:        { type: 'string', description: 'Raw 2-6 digit NAICS code prefix (e.g., "11" or "311"). Mutually exclusive with naics_industry.' },
            riding_number:       { type: 'string' },
            city:                { type: 'string', description: 'Substring match against recipient_city.' },
            min_value:           { type: 'number' },
            max_value:           { type: 'number' },
            agreement_type:      { type: 'string', enum: ['G','C','O'], description: 'G=Grant, C=Contribution, O=Other.' },
            description_keyword: { type: 'string', description: 'Trigram match against description_en. Forces latest_view path.' },
            recipient_business_number: { type: 'string', description: 'Exact CRA BN match.' }
          }
        },
        date_range: {
          type: 'object',
          properties: {
            start:            { type: 'string', description: 'ISO date — applies to agreement_start_date.' },
            end:              { type: 'string', description: 'ISO date.' },
            lookback_months:  { type: 'number', description: 'Convenience: last N months from today. Mutually exclusive with start/end.' }
          }
        },
        having_distinct: {
          type: 'object',
          properties: {
            field:     { type: 'string', enum: ['program', 'department'] },
            min_count: { type: 'number' }
          },
          description: 'Filter groups to those with >= min_count distinct values of field. Use for repeat-recipient / multi-program queries.'
        },
        sort_by: { type: 'string', description: 'Metric name to sort by (default: total_value). Ignored when yoy_growth is requested (always sorts by yoy_growth DESC).' },
        limit:   { type: 'number', description: 'Max groups to return. Default 25, cap 100.' }
      },
      required: ['group_by']
    }
  },
  {
    name: 'search_federal_grants_records',
    description: `Record-mode search over the Government of Canada Proactive Disclosure dataset. Returns individual grant/contribution agreements with recipient, program, value, and dates.

**When to use:** the question is "show me the agreements that match X" or "which companies received funding for Y". For totals or rollups, use search_federal_grants_aggregate instead.

**Amendment handling:** by default reads pdg_latest_amendments (one row per ref_number, latest amendment). Pass include_amendments=true ONLY when explicitly auditing amendment history — that path reads the raw table and returns every amendment row.

**NAICS filters:** same convention as search_federal_grants_aggregate — pass EITHER naics_industry (label substring) OR naics_prefix (raw code). Not both.

**Data caveats:** federal only (no provincial/municipal). Post-award only (no rejections). Program names not de-duplicated; recipient names may have casing/punctuation variants — use recipient_name_query (trigram fuzzy match) rather than exact equality when looking up by name.`,
    input_schema: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          properties: {
            recipient_name_query:      { type: 'string', description: 'Fuzzy (trigram) match against recipient_legal_name and recipient_operating_name.' },
            recipient_business_number: { type: 'string', description: 'Exact CRA BN9 / BN15.' },
            program_name:              { type: 'string' },
            department:                { type: 'string' },
            province:                  { type: 'string', description: '2-letter province code.' },
            city:                      { type: 'string' },
            riding_number:             { type: 'string' },
            recipient_type:            { type: 'string', enum: ['F','N','A','S','P','G','I','O'] },
            naics_industry:            { type: 'string', description: 'Substring matched against NAICS label_en. Mutually exclusive with naics_prefix.' },
            naics_prefix:              { type: 'string', description: 'Raw 2-6 digit NAICS code prefix.' },
            min_value:                 { type: 'number' },
            max_value:                 { type: 'number' },
            description_keyword:       { type: 'string', description: 'Trigram match against description_en.' },
            agreement_type:            { type: 'string', enum: ['G','C','O'] }
          }
        },
        date_range: {
          type: 'object',
          properties: {
            start:           { type: 'string' },
            end:             { type: 'string' },
            lookback_months: { type: 'number' }
          }
        },
        sort_by: {
          type: 'string',
          enum: ['agreement_value_desc', 'agreement_value_asc', 'start_date_desc', 'start_date_asc'],
          description: 'Default agreement_value_desc.'
        },
        limit:               { type: 'number', description: 'Max records. Default 25, cap 200.' },
        include_amendments:  { type: 'boolean', description: 'When false (default), returns only the latest amendment per ref_number. When true, returns every amendment row (audit history).' }
      }
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
          description: 'Section number (1-7). Limits: Section 1 Products/Services (2000), Section 2 Project Summary (4000), Section 3 Capacity (4000), Section 4 IP Strategy (2000), Section 5 Market Potential / Opportunities / Competitive Advantages (1800 per target market, call once per target market), Section 6 Benefits to Canada (4000 per benefit field, call once per field, 7 fields total), Section 7 Budget Activity Descriptions (1000 per activity row, call once per row).',
          enum: [1, 2, 3, 4, 5, 6, 7]
        },
        section_name: {
          type: 'string',
          description: 'Name of the section being checked (e.g., "Products/Services", "Project Summary", "Capacity", etc.)'
        },
        text: {
          type: 'string',
          description: 'The drafted text to check character count for. For Sections 5, 6, and 7, pass the text of one target market / benefit field / activity row at a time.'
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
        },
        share_with_link: {
          type: 'boolean',
          description: 'Optional, defaults to false. When false the document is PRIVATE to the person who requested it — the normal case. Set true ONLY when the document is deliberately going to someone outside Granted (e.g. a client deliverable), which makes it readable by anyone who has the link. It never grants edit access.'
        }
      },
      required: ['title', 'content']
    }
  }
];

// ============================================================================
// GOOGLE SHEETS — read/write surface for any Google-connected agent.
// Implementations live in src/tools/google-sheets.js.
// ============================================================================

/**
 * Google Calendar tools — per-user delegated OAuth.
 *
 * DELIBERATELY a standalone const, NOT part of ORACLE_TOOLS and NOT part of
 * ALL_TOOLS. ORACLE_TOOLS is spread into ALL_TOOLS, which the orchestrator
 * receives — adding Calendar there would silently give the orchestrator write
 * access to people's calendars. Referenced explicitly in the internal-oracle
 * case of getToolsForAgent() and nowhere else.
 *
 * create/update carry a `confirmed` property because CONFIRMATION_POLICY in
 * src/tools/executor.js refuses those calls without it when attendees are
 * involved.
 */
export const GOOGLE_CALENDAR_TOOLS = [
  {
    name: 'list_calendar_events',
    description: 'List the signed-in user\'s OWN upcoming or past calendar events. Use when they ask what is on their calendar, whether they are free, or to find a specific meeting. Reads only their own calendar — to see when a COLLEAGUE is busy use check_calendar_availability instead.',
    input_schema: {
      type: 'object',
      properties: {
        time_min: { type: 'string', description: 'Start of the window, RFC3339 (e.g. "2026-08-14T00:00:00Z"). Defaults to now.' },
        time_max: { type: 'string', description: 'End of the window, RFC3339. Optional.' },
        query: { type: 'string', description: 'Optional free-text search across event fields.' },
        max_results: { type: 'number', description: 'Maximum events to return (default 20, cap 50).' }
      },
      required: []
    }
  },
  {
    name: 'check_calendar_availability',
    description: 'Check when one or more people are BUSY, using the signed-in user\'s own access. Returns busy time blocks only — never event titles or details. Works for colleagues who have never connected to Oracle, subject to Workspace sharing settings. Calendars that cannot be seen are returned in calendars_unavailable; that is normal, report it per person and continue with the rest.',
    input_schema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Calendar addresses to check, usually work email addresses. Include the user themselves if their own availability matters. Max 50.'
        },
        time_min: { type: 'string', description: 'Start of the window, RFC3339. Required.' },
        time_max: { type: 'string', description: 'End of the window, RFC3339. Required.' }
      },
      required: ['emails', 'time_min', 'time_max']
    }
  },
  {
    name: 'create_calendar_event',
    description: 'Create an event on the signed-in user\'s calendar. IF attendees are included this invites real people and sends them email — you MUST show the user exactly what you are about to create and get an explicit yes, then call again with confirmed: true. An event with no attendees affects only them and needs no confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title.' },
        start: { type: 'string', description: 'Start time, RFC3339 with offset (e.g. "2026-08-20T14:00:00-07:00").' },
        end: { type: 'string', description: 'End time, RFC3339 with offset.' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Email addresses to invite. Including anyone here REQUIRES confirmation.'
        },
        description: { type: 'string', description: 'Optional event description.' },
        location: { type: 'string', description: 'Optional location.' },
        add_meet_link: { type: 'boolean', description: 'Attach a Google Meet link. Default false.' },
        send_updates: { type: 'string', enum: ['all', 'externalOnly', 'none'], description: 'Who gets an email notification. Default "all" when there are attendees.' },
        confirmed: { type: 'boolean', description: 'Set true ONLY after the user has explicitly approved the exact event. Required when attendees are present.' }
      },
      required: ['title', 'start', 'end']
    }
  },
  {
    name: 'update_calendar_event',
    description: 'Modify an existing event on the signed-in user\'s calendar — change the time, title, location, attendees, or set status to "cancelled". If the event involves other people (either already, or because you are adding them) you MUST show the user the change and get an explicit yes, then call again with confirmed: true. Use event_id from list_calendar_events.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID, from list_calendar_events.' },
        title: { type: 'string', description: 'New title.' },
        start: { type: 'string', description: 'New start time, RFC3339 with offset.' },
        end: { type: 'string', description: 'New end time, RFC3339 with offset.' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Replacement attendee list. Setting this REQUIRES confirmation.' },
        description: { type: 'string', description: 'New description.' },
        location: { type: 'string', description: 'New location.' },
        status: { type: 'string', enum: ['confirmed', 'tentative', 'cancelled'], description: 'Set "cancelled" to cancel the event — this notifies attendees.' },
        send_updates: { type: 'string', enum: ['all', 'externalOnly', 'none'], description: 'Who gets an email notification. Default "all" when attendees exist.' },
        confirmed: { type: 'boolean', description: 'Set true ONLY after the user has explicitly approved the change. Required when the event has attendees.' }
      },
      required: ['event_id']
    }
  }
];

export const GOOGLE_SHEETS_READWRITE_TOOLS = [
  {
    name: 'read_sheet_range',
    description: 'Read cell values from a Google Sheets A1 range (e.g. "Sheet1!A1:D10"). Use when the user asks to inspect specific cells, rows, columns, or named ranges. Defaults to formatted display values; pass value_render_option=UNFORMATTED_VALUE for raw numbers or =FORMULA for cell formulas.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID (the long string in the spreadsheet URL between /d/ and /edit).'
        },
        range: {
          type: 'string',
          description: 'A1-notation range, e.g. "Sheet1!A1:D10" or "April 22nd 2026!A:E". Tab name is required when the spreadsheet has multiple tabs.'
        },
        value_render_option: {
          type: 'string',
          enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'],
          description: 'Optional. Default FORMATTED_VALUE returns display text. UNFORMATTED_VALUE returns raw numbers. FORMULA returns the cell formula source.'
        }
      },
      required: ['spreadsheet_id', 'range']
    }
  },
  {
    name: 'read_sheet_metadata',
    description: 'Get spreadsheet title and the list of tabs (id, title, index, row/column counts) without reading cell data. Use first when you need to discover what tabs exist before calling read_sheet_range, or to confirm a spreadsheet is structured the way you expect.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID.'
        }
      },
      required: ['spreadsheet_id']
    }
  },
  {
    name: 'update_sheet_range',
    description: 'Write a 2D array of values to a Google Sheets A1 range, overwriting existing content in that range. Use when the user asks to fill specific cells or replace content in a known location. For appending new rows to a table, prefer append_sheet_row.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID.'
        },
        range: {
          type: 'string',
          description: 'A1-notation target range. The values array must fit within this range (excess cells are ignored, missing cells are left untouched).'
        },
        values: {
          type: 'array',
          description: '2D array of cell values: outer array = rows, inner array = cells in that row. Strings starting with "=" are interpreted as formulas when value_input_option=USER_ENTERED.',
          items: { type: 'array' }
        },
        value_input_option: {
          type: 'string',
          enum: ['USER_ENTERED', 'RAW'],
          description: 'Optional. Default USER_ENTERED parses input like a typing user (numbers, dates, formulas). RAW writes verbatim strings.'
        }
      },
      required: ['spreadsheet_id', 'range', 'values']
    }
  },
  {
    name: 'append_sheet_row',
    description: 'Append one or more rows at the bottom of a Google Sheets table. Pass the table\'s range to identify which table to append to (Google scans within that range for the data\'s last row and inserts after it). Use for adding new entries to logs, action-item lists, or running ledgers.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID.'
        },
        range: {
          type: 'string',
          description: 'A1-notation range covering the table to append to (e.g. "Sheet1!A:E"). Google finds the last row of data within this range and inserts new rows after it.'
        },
        values: {
          type: 'array',
          description: '2D array of new rows: outer array = rows, inner array = cells. Each inner array becomes one new appended row.',
          items: { type: 'array' }
        },
        value_input_option: {
          type: 'string',
          enum: ['USER_ENTERED', 'RAW'],
          description: 'Optional. Default USER_ENTERED parses input like a typing user. RAW writes verbatim strings.'
        }
      },
      required: ['spreadsheet_id', 'range', 'values']
    }
  }
];

// ============================================================================
// GOOGLE SHEETS — heavyweight creation tool.
// Restricted to canexport-writer + readiness-strategist (matches the prior
// GOOGLE_DOCS_TOOLS distribution where create_advanced_budget previously lived).
// Implementation in src/tools/google-sheets-advanced.js.
// ============================================================================

export const GOOGLE_SHEETS_CREATE_TOOLS = [
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
  }
];

// ============================================================================
// LEAD-GEN KNOWLEDGE BASE TOOLS
// Lightweight on-demand search for the public lead-gen chatbot.
// Avoids stuffing knowledge into the system prompt (token cost optimization).
// Both files are small and static — cached in memory on first call.
// ============================================================================

export const LEAD_GEN_KNOWLEDGE_TOOLS = [
  {
    name: 'search_lead_gen_knowledge',
    description: 'Search the Grant Advisor FAQ knowledge base for answers to common prospect questions about how Canadian business grants work, timing strategy, pricing, eligibility requirements, DIY vs consultant, stacking grants, and other frequently asked questions. Use when a prospect asks a general question about grants.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "The prospect's question or topic to search for"
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_lead_gen_strategy',
    description: 'Search the strategic consulting knowledge base for frameworks on how to evaluate prospects, reframe business activities into fundable grant categories, prioritize programs, understand company size heuristics, CanExport insider knowledge, hiring grant nuances, and common client scenarios. Use during and after discovery to inform your recommendations and provide expert-level consulting insight.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The strategic topic or client scenario to look up'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'save_lead_data',
    description: "Save the prospect's contact information and conversation summary when they provide their name and email. This creates or updates their HubSpot Contact and Company records and adds a note with the full conversation context so the sales consultant has everything before the call. Call this as soon as you have both name and email — don't wait for the conversation to end.",
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Prospect's full name"
        },
        email: {
          type: 'string',
          description: "Prospect's email address"
        },
        company_name: {
          type: 'string',
          description: 'Business name'
        },
        province: {
          type: 'string',
          description: 'Province or territory (e.g. "BC", "Ontario")'
        },
        industry: {
          type: 'string',
          description: 'Industry or sector'
        },
        revenue: {
          type: 'string',
          description: 'Approximate annual revenue range (e.g. "$500K–$1M")'
        },
        employee_count: {
          type: 'string',
          description: 'Number of employees (e.g. "12", "15-20 employees", "about 30")'
        },
        company_description: {
          type: 'string',
          description: 'Brief description of what the company does, based on conversation context'
        },
        activities_summary: {
          type: 'string',
          description: 'Summary of the business activities discussed: hiring plans, training plans, expansion plans, R&D'
        },
        prior_grant_experience: {
          type: 'string',
          description: "The prospect's prior experience with government grants — e.g. 'First time, never applied', 'Applied for IRAP once, not approved', 'Receives Canada Summer Jobs every year'"
        },
        prospect_summary: {
          type: 'string',
          description: '2-3 sentence natural language summary for the sales consultant: who the prospect is, what they need, what was recommended, and why they are booking'
        },
        matched_programs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of grant programs discussed or matched during the conversation'
        },
        estimated_funding: {
          type: 'string',
          description: 'Estimated total grant funding potential discussed (e.g. "$15K–$40K per year")'
        },
        cta_selected: {
          type: 'string',
          enum: ['book_call', 'email_summary', 'resources', 'none'],
          description: 'Which call-to-action the prospect selected: book_call (strategy call), email_summary (email breakdown), resources (service links), or none'
        },
        lead_score: {
          type: 'string',
          enum: ['hot', 'warm', 'cool'],
          description: "Your assessment of this prospect's readiness and grant potential. hot: multiple fundable activities, clear timeline, established business (1+ years, incorporated), ready to book. warm: some fundable activities but timeline unclear, or early-stage but promising. cool: very early stage, limited activities, pre-revenue, or not incorporated."
        },
        hs_lead_status: {
          type: 'string',
          enum: ['New', 'Open', 'Unqualified'],
          description: 'HubSpot lead status. Typically set based on CTA choice: book_call → New, email_summary → Open, resources → Unqualified. If not provided, will be derived from lead_score.'
        },
        // Individual scoring signals (optional, captured via strategic questions)
        timeline: {
          type: 'string',
          description: 'When they plan to hire/invest: "this quarter", "within 6 months", "next year", etc.'
        },
        budget_committed: {
          type: 'string',
          description: 'Whether budget is already allocated: "Yes, budgeted", "Exploring options", "Not yet", etc.'
        },
        is_decision_maker: {
          type: 'string',
          description: 'Whether prospect is the decision maker: "Yes, CEO", "Yes, VP Operations", "No, need to check with boss", etc.'
        },
        growth_plans: {
          type: 'string',
          description: 'Additional growth plans beyond immediate needs: "Hiring 5 more next quarter", "Expanding to Alberta", etc.'
        },
        existing_consultant: {
          type: 'string',
          description: 'Whether working with another grant consultant: "No one, handling in-house", "Working with [name]", etc.'
        }
      },
      required: ['name', 'email', 'lead_score']
    }
  }
];

// ============================================================================
// GETGRANTED AI TOOLS
// Financial calculations, program cards, and GetGranted integration
// ============================================================================

export const GETGRANTED_AI_TOOLS = [
  {
    name: 'listAvailablePrograms',
    description: 'List all available grant program cards organized by type (hiring/training). Use this when a user asks what programs are available or needs to explore options.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'loadProgramCard',
    description: 'Load a specific grant program card by ID to get detailed information including eligibility requirements, financial details, application process, required documents, and program-specific rules. Use this when a user mentions a specific program by name or wants to work on an application.',
    input_schema: {
      type: 'object',
      properties: {
        programId: {
          type: 'string',
          description: 'Program identifier (filename without .md extension, e.g. "workbc-wage-subsidy", "canada-job-grant", "etg")'
        }
      },
      required: ['programId']
    }
  },
  {
    name: 'calculateMERCs',
    description: 'Calculate Mandatory Employment Related Costs (MERCs) including CPP, EI, QPIP (Quebec), Vacation Pay, and WCB. Returns detailed breakdown of base wage, all MERCs components, total employment cost, and MERC percentage. Use this when calculating total employment costs for grant applications.',
    input_schema: {
      type: 'object',
      properties: {
        hourlyWage: {
          type: 'number',
          description: 'Hourly wage rate in dollars'
        },
        hoursPerWeek: {
          type: 'number',
          description: 'Hours worked per week'
        },
        province: {
          type: 'string',
          description: 'Province code (BC, ON, QC, AB, etc.)',
          default: 'BC'
        },
        vacationPct: {
          type: 'number',
          description: 'Vacation pay percentage: 4 (standard) or 6 (after 5 years)',
          enum: [4, 6],
          default: 4
        },
        industry: {
          type: 'string',
          description: 'Industry type for WCB calculation: office, retail, manufacturing, construction, hospitality, healthcare, technology, or default',
          default: 'default'
        }
      },
      required: ['hourlyWage', 'hoursPerWeek']
    }
  },
  {
    name: 'convertSalary',
    description: 'Convert between hourly wage and annual salary. Returns detailed breakdown with hourly, weekly, and annual amounts.',
    input_schema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to convert (hourly wage or annual salary depending on direction)'
        },
        direction: {
          type: 'string',
          description: 'Conversion direction',
          enum: ['hourlyToAnnual', 'annualToHourly']
        },
        hoursPerWeek: {
          type: 'number',
          description: 'Hours worked per week',
          default: 40
        }
      },
      required: ['amount', 'direction']
    }
  },
  {
    name: 'getGrantedLookup',
    description: 'Query GetGranted platform for available grants and client details (STUB - returns placeholder response). Future implementation will search GetGranted database for matching programs and client information.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        filters: {
          type: 'object',
          description: 'Optional filters (type, deadline, province, etc.)',
          properties: {
            type: { type: 'string' },
            deadline: { type: 'string' },
            province: { type: 'string' }
          }
        }
      },
      required: ['query']
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
  LOAD_SKILL_TOOL,
  ...HUBSPOT_TOOLS,
  ...GOOGLE_DRIVE_TOOLS,
  ...ORACLE_TOOLS,
  ...CANEXPORT_WRITER_TOOLS,
  ...GOOGLE_DOCS_TOOLS,
  ...GOOGLE_SHEETS_READWRITE_TOOLS,
  ...GOOGLE_SHEETS_CREATE_TOOLS,
  ...GETGRANTED_AI_TOOLS
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

  // Core HubSpot tools needed for most agents (enrichment, search, CRUD operations).
  // This whitelist feeds the Oracle and other curated agents. Tools referenced by
  // skills (e.g., DEAL_CREATION references list_hubspot_owners in Section 5.6) must
  // be listed here — otherwise the agent will see the skill instruction but lack
  // the tool to follow it.
  const coreHubSpotTools = HUBSPOT_TOOLS.filter(tool =>
    ['search_hubspot_contacts', 'search_hubspot_companies',
     'search_grant_applications',  // Deal search (actual name, not search_hubspot_deals)
     'get_hubspot_contact', 'get_hubspot_company',
     'get_grant_application',  // Get deal by ID (actual name, not get_hubspot_deal)
     'list_hubspot_owners',  // Resolve owner names → user IDs (required by DEAL_CREATION skill)
     'create_hubspot_contact', 'create_hubspot_company',
     'update_hubspot_contact', 'update_hubspot_company',
     'create_hubspot_deal', 'update_hubspot_deal',
     'associate_contact_with_company', 'search_getgranted',
     'generate_hubspot_embed_link',
     'get_program_stats', 'get_deal_count'].includes(tool.name)
  );

  // Curated tool sets per agent - only include what each agent actually uses
  switch (agentType) {
    case 'grant-card-generator':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + 1 + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length + GOOGLE_SHEETS_READWRITE_TOOLS.length} tools)`);
      return [...baseTools, LOAD_SKILL_TOOL, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS];

    case 'etg-writer':
    case 'buybc-writer':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length + GOOGLE_SHEETS_READWRITE_TOOLS.length} tools)`);
      return [...baseTools, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS];

    case 'bcafe-writer':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + 1 + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length + GOOGLE_SHEETS_READWRITE_TOOLS.length} tools)`);
      return [...baseTools, LOAD_SKILL_TOOL, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS];

    case 'canexport-claims':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + HUBSPOT_TOOLS.length + GOOGLE_DRIVE_TOOLS.length + GOOGLE_SHEETS_READWRITE_TOOLS.length} tools)`);
      return [...baseTools, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS];

    case 'canexport-writer':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + 1 + HUBSPOT_TOOLS.length + GOOGLE_DRIVE_TOOLS.length + CANEXPORT_WRITER_TOOLS.length + GOOGLE_DOCS_TOOLS.length + GOOGLE_SHEETS_READWRITE_TOOLS.length + GOOGLE_SHEETS_CREATE_TOOLS.length + GRANOLA_TOOLS.length} tools)`);
      return [...baseTools, LOAD_SKILL_TOOL, ...HUBSPOT_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...CANEXPORT_WRITER_TOOLS, ...GOOGLE_DOCS_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS, ...GOOGLE_SHEETS_CREATE_TOOLS, ...GRANOLA_TOOLS];

    case 'readiness-strategist':
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + coreHubSpotTools.length + GOOGLE_DRIVE_TOOLS.length + GOOGLE_DOCS_TOOLS.length + GOOGLE_SHEETS_READWRITE_TOOLS.length + GOOGLE_SHEETS_CREATE_TOOLS.length + GRANOLA_TOOLS.length} tools)`);
      return [...baseTools, ...coreHubSpotTools, ...GOOGLE_DRIVE_TOOLS, ...GOOGLE_DOCS_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS, ...GOOGLE_SHEETS_CREATE_TOOLS, ...GRANOLA_TOOLS];

    case 'internal-oracle':
      // Oracle needs: search/enrichment tools + Oracle KB + minimal HubSpot + skill loading
      // EXCLUDE filesystem-based ANTHROPIC_MEMORY_TOOL (.memories/) - wastes iteration checking empty directory
      // KEEP Postgres-based MEMORY_TOOLS (conversation key-value store) and SERVER_TOOLS
      // LOAD_SKILL_TOOL: uses the shared definition (not a per-agent copy) so Oracle can load
      // hubspot/DEAL_CREATION and any future skills without enum drift.
      const oracleBaseTools = [...SERVER_TOOLS, ...MEMORY_TOOLS]; // No ANTHROPIC_MEMORY_TOOL
      // GOOGLE_CALENDAR_TOOLS is referenced HERE and only here — deliberately not
      // in ORACLE_TOOLS, which is spread into ALL_TOOLS and would hand Calendar
      // write access to the orchestrator.
      // Docs: create-and-write ONLY. Deliberately a filtered subset rather than
      // spreading GOOGLE_DOCS_TOOLS, which also carries create_google_drive_folder,
      // copy_template_file (CanExport-specific, and likely blocked by the narrow
      // drive.file scope) and create_advanced_document (closed enum of consulting
      // templates — the model cannot supply its own content). Oracle needs none
      // of those. Editing existing documents is Phase 2.
      const oracleDocsTools = GOOGLE_DOCS_TOOLS.filter(t => t.name === 'create_google_doc');
      const oracleTools = [...oracleBaseTools, LOAD_SKILL_TOOL, ...ORACLE_TOOLS, ...GOOGLE_DRIVE_TOOLS, ...DROPBOX_TOOLS, ...coreHubSpotTools, ...GRANOLA_TOOLS, ...GOOGLE_SHEETS_READWRITE_TOOLS, ...GOOGLE_CALENDAR_TOOLS, ...oracleDocsTools];
      // Count derived from the actual array rather than hand-summed, so it
      // cannot drift out of sync with what is returned.
      console.log(`🔧 Agent ${agentType} using curated tool set (${oracleTools.length} tools, filesystem memory excluded)`);
      return oracleTools;

    case 'getgranted-ai':
      // GetGrantedAI needs: base tools + GetGrantedAI-specific tools (no HubSpot, no Google Drive)
      console.log(`🔧 Agent ${agentType} using curated tool set (${baseTools.length + GETGRANTED_AI_TOOLS.length} tools)`);
      return [...baseTools, ...GETGRANTED_AI_TOOLS];

    case 'orchestrator':
      console.log(`🔧 Agent ${agentType} using ALL tools (${ALL_TOOLS.length} tools)`);
      return ALL_TOOLS;

    case 'lead-gen': {
      // Public chatbot — deliberately restricted tool set for security.
      // Excluded intentionally:
      //   - ANTHROPIC_MEMORY_TOOL: file-based, cross-agent shared storage on disk.
      //     A public (unauthenticated) user could corrupt memory files read by internal agents.
      //   - web_fetch: fetches arbitrary URLs — prompt injection surface on a public endpoint.
      //   - All HubSpot write tools, Google Drive, Oracle — not needed, not safe.
      // HubSpot write tools (create_contact, etc.) will be added back in a later step
      // once proper input validation is in place.
      const webSearchTool = SERVER_TOOLS.find(t => t.name === 'web_search');
      // search_getgranted is defined in ORACLE_TOOLS (not HUBSPOT_TOOLS)
      const searchGrantedTool = ORACLE_TOOLS.find(t => t.name === 'search_getgranted');
      const leadGenTools = [
        ...(webSearchTool ? [webSearchTool] : []),   // Anthropic-controlled, safe
        ...MEMORY_TOOLS,                              // session-scoped DB key-value, safe
        ...(searchGrantedTool ? [searchGrantedTool] : []), // read-only grants DB, safe
        ...LEAD_GEN_KNOWLEDGE_TOOLS                  // on-demand FAQ + strategy KB search
      ];
      console.log(`🔧 Agent lead-gen using restricted public tool set (${leadGenTools.length} tools): web_search, memory_store/recall/list, search_getgranted, search_lead_gen_knowledge, search_lead_gen_strategy, save_lead_data`);
      return leadGenTools;
    }

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
