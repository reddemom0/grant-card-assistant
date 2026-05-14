/**
 * HubSpot CRM Integration Tools
 *
 * Provides access to HubSpot CRM data including:
 * - Contacts
 * - Companies
 * - Deals (Grant Applications)
 */

import axios from 'axios';
import axiosRetry from 'axios-retry';

const HUBSPOT_API = 'https://api.hubapi.com';
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_PORTAL_ID = '21088260'; // Granted Consulting's HubSpot portal ID

// ============================================================================
// AGENT-SPECIFIC FIELD CONFIGURATIONS
// Define which HubSpot fields each agent needs access to
// ============================================================================

const COMMON_FIELDS = [
  // Core deal info
  'dealname',
  'dealstage',
  'dealtype',
  'closedate',
  'createdate',
  'company_name',
  'state',
  'ref__',

  // Grant program basics
  'grant_type',
  'grant_reliant',

  // Timeline
  'application_submitted_on',
  'approved_on',
  'start_date',
  'end_date',

  // Team
  'hubspot_owner_id',
  'grant_coordinator',
  'external_writer_assigned'
];

const CANEXPORT_FIELDS = [
  ...COMMON_FIELDS,

  // CanExport Project Details
  'project_name',
  'project_number',
  'waitlisted_',
  'ghost_stage_',

  // Financial - CanExport specific
  'client_reimbursement',
  'actual_reimbursement',
  'retainer',
  'service_fee',
  'invoice_sent_date',
  'invoice_due',

  // CanExport Claims Tracking (Multiple claim submissions)
  'claim_type',
  'next_claim_due',
  'claim_1_due',
  'claim_1_submitted',
  'claim_2_due',
  'claim_2_submitted',
  'claim_3_due',
  'claim_3_submitted',
  'claim_4_due',
  'claim_4_submitted',
  'claim_approved',
  'claimed_so_far',
  'final_report_submitted',

  // Workflow status
  'ra_complete',
  'budget_complete',
  'writer_draft_review_completion_date',
  'google_drive_link_to_docs',
  'funding_contribution',
  'retainer_date_sent',
  'retainer_date_paid'
];

const ETG_FIELDS = [
  ...COMMON_FIELDS,

  // ETG Training Specific
  'candidate_name_job_title_email',  // Candidate - Name, Job Title & Email field
  'tuition_fee_per_person',
  'training_hours_per_person',
  'training_delivery_method',
  'training_link_url',
  'additional_material_list___cost',

  // Third Party Payer Info
  'tp_paying',
  'tp_company',
  'tp_address',
  'pif_x_x',

  // Financial - ETG specific
  'client_reimbursement',
  'actual_reimbursement',
  'retainer',
  'service_fee',
  'invoice_sent_date',
  'invoice_due',

  // ETG Claims (Usually one-off)
  'claim_type',
  'next_claim_due',
  'final_claim_submitted',
  'claim_returned',
  'claim_approved',
  'completion_report',

  // Workflow
  'google_drive_link_to_docs',
  'retainer_date_sent',
  'retainer_date_paid'
];

const BCAFE_FIELDS = [
  ...COMMON_FIELDS,

  // BCAFE Project Details
  'project_name',
  'project_number',

  // Financial - BCAFE specific
  'client_reimbursement',
  'actual_reimbursement',
  'retainer',
  'service_fee',
  'invoice_sent_date',
  'invoice_due',

  // BCAFE typically has simpler claims
  'claim_type',
  'next_claim_due',
  'final_claim_submitted',
  'claim_approved',
  'claimed_so_far',

  // Workflow
  'ra_complete',
  'budget_complete',
  'google_drive_link_to_docs',
  'funding_contribution'
];

/**
 * Get HubSpot fields based on agent type
 * @param {string} agentType - Agent type (canexport-claims, etg-writer, bcafe-writer, etc.)
 * @returns {string[]} Array of field names
 */
function getFieldsForAgent(agentType) {
  switch (agentType) {
    case 'canexport-claims':
      return CANEXPORT_FIELDS;
    case 'etg-writer':
      return ETG_FIELDS;
    case 'bcafe-writer':
      return BCAFE_FIELDS;
    default:
      // Default to CanExport fields for backward compatibility
      return CANEXPORT_FIELDS;
  }
}

/**
 * Create HubSpot API client with retry logic
 */
function createHubSpotClient() {
  const client = axios.create({
    baseURL: HUBSPOT_API,
    headers: {
      'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000 // 10 second timeout
  });

  // Add retry logic for rate limits and network errors
  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
      return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
             error.response?.status === 429; // Rate limit
    },
    onRetry: (retryCount, error) => {
      console.log(`HubSpot API retry attempt ${retryCount} for ${error.config?.url}`);
    }
  });

  return client;
}

/**
 * Search HubSpot contacts
 * @param {string} query - Search query (name, email, company)
 * @param {number} limit - Maximum results to return
 * @returns {Object} Search results
 */
export async function searchHubSpotContacts(query, limit = 10, filters = {}) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      contacts: []
    };
  }

  try {
    const client = createHubSpotClient();

    // Backwards compatibility: if filters is a string, treat it as lifecycle_stage
    if (typeof filters === 'string') {
      filters = { lifecycle_stage: filters };
    }

    // Ensure filters is an object
    if (!filters || typeof filters !== 'object') {
      filters = {};
    }

    // Extract filters (support both old lifecycle_stage param and new filters object)
    const {
      lifecycle_stage = null,
      createdate_after = null,
      createdate_before = null,
      lastmodifieddate_after = null,
      lastmodifieddate_before = null,
      owner_id = null,
      hs_lead_status = null,
      custom_filters = [],
      sort_by = null,
      sort_order = 'DESC'
    } = filters;

    // Build filter groups (OR logic between groups, AND within groups)
    const filterGroups = [
      {
        filters: [
          {
            propertyName: 'email',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      },
      {
        filters: [
          {
            propertyName: 'firstname',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      },
      {
        filters: [
          {
            propertyName: 'lastname',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      },
      {
        filters: [
          {
            propertyName: 'company',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      }
    ];

    // Collect common filters to apply to ALL filter groups (AND conditions)
    const commonFilters = [];

    // Add lifecycle_stage filter
    if (lifecycle_stage) {
      commonFilters.push({
        propertyName: 'lifecyclestage',
        operator: 'EQ',
        value: lifecycle_stage
      });
      console.log(`  🎯 Filtering by lifecycle stage: ${lifecycle_stage}`);
    }

    // Add date filters
    if (createdate_after) {
      const timestamp = new Date(createdate_after).getTime();
      commonFilters.push({
        propertyName: 'createdate',
        operator: 'GTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Created after: ${createdate_after}`);
    }

    if (createdate_before) {
      const timestamp = new Date(createdate_before).getTime();
      commonFilters.push({
        propertyName: 'createdate',
        operator: 'LTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Created before: ${createdate_before}`);
    }

    if (lastmodifieddate_after) {
      const timestamp = new Date(lastmodifieddate_after).getTime();
      commonFilters.push({
        propertyName: 'lastmodifieddate',
        operator: 'GTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Modified after: ${lastmodifieddate_after}`);
    }

    if (lastmodifieddate_before) {
      const timestamp = new Date(lastmodifieddate_before).getTime();
      commonFilters.push({
        propertyName: 'lastmodifieddate',
        operator: 'LTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Modified before: ${lastmodifieddate_before}`);
    }

    // Add owner filter
    if (owner_id) {
      commonFilters.push({
        propertyName: 'hubspot_owner_id',
        operator: 'EQ',
        value: owner_id
      });
      console.log(`  👤 Owner ID: ${owner_id}`);
    }

    // Add lead status filter
    if (hs_lead_status) {
      commonFilters.push({
        propertyName: 'hs_lead_status',
        operator: 'EQ',
        value: hs_lead_status
      });
      console.log(`  🏷️  Lead status: ${hs_lead_status}`);
    }

    // Add custom filters
    if (custom_filters && custom_filters.length > 0) {
      custom_filters.forEach(filter => {
        commonFilters.push(filter);
        console.log(`  🔧 Custom filter: ${filter.propertyName} ${filter.operator} ${filter.value || filter.values?.join(',')}`);
      });
    }

    // Build sorts array if sort_by is specified
    const sorts = [];
    if (sort_by) {
      sorts.push({
        propertyName: sort_by,
        direction: sort_order === 'ASC' ? 'ASCENDING' : 'DESCENDING'
      });
      console.log(`  📊 Sorting by ${sort_by} ${sort_order}`);
    }

    // Apply common filters to ALL filter groups
    if (commonFilters.length > 0) {
      filterGroups.forEach(group => {
        group.filters.push(...commonFilters);
      });
    }

    const searchRequest = {
      filterGroups,
      properties: [
        'email',
        'firstname',
        'lastname',
        'phone',
        'company',
        'jobtitle',
        'city',
        'state',
        'country',
        'lifecyclestage',
        'createdate',
        'lastmodifieddate',
        'hubspot_owner_id',
        'hs_lead_status'
      ],
      limit: Math.min(limit, 100)
    };

    // Add sorts if specified
    if (sorts.length > 0) {
      searchRequest.sorts = sorts;
    }

    const response = await client.post('/crm/v3/objects/contacts/search', searchRequest);

    console.log(`✓ HubSpot contact search: found ${response.data.results.length} results`);

    return {
      success: true,
      count: response.data.results.length,
      contacts: response.data.results.map(contact => ({
        id: contact.id,
        email: contact.properties.email,
        name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
        company: contact.properties.company,
        phone: contact.properties.phone,
        jobTitle: contact.properties.jobtitle,
        location: [
          contact.properties.city,
          contact.properties.state,
          contact.properties.country
        ].filter(Boolean).join(', '),
        lifecycleStage: contact.properties.lifecyclestage,
        createDate: parseHubSpotDate(contact.properties.createdate),
        lastModifiedDate: parseHubSpotDate(contact.properties.lastmodifieddate),
        ownerId: contact.properties.hubspot_owner_id,
        leadStatus: contact.properties.hs_lead_status
      }))
    };
  } catch (error) {
    console.error('HubSpot search contacts error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      contacts: []
    };
  }
}

/**
 * Get specific HubSpot contact by ID
 * @param {string} contactId - HubSpot contact ID
 * @returns {Object} Contact details
 */
export async function getHubSpotContact(contactId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    const response = await client.get(`/crm/v3/objects/contacts/${contactId}`, {
      params: {
        properties: [
          'email', 'firstname', 'lastname', 'phone', 'company',
          'jobtitle', 'city', 'state', 'country',
          'lifecyclestage', 'createdate'
        ].join(','),
        associations: 'companies,deals'
      }
    });

    console.log(`✓ HubSpot contact retrieved: ${contactId}`);

    return {
      success: true,
      contact: {
        id: response.data.id,
        ...response.data.properties
      },
      associations: response.data.associations || {}
    };
  } catch (error) {
    console.error('HubSpot get contact error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get contact by email address (direct lookup)
 * More efficient than search when you have exact email
 * @param {string} email - Contact email address
 * @returns {Object} Contact details
 */
export async function getContactByEmail(email) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔍 Direct lookup: contact by email "${email}"`);

    // Use search API with email filter (HubSpot doesn't have a direct email lookup endpoint)
    const response = await client.post('/crm/v3/objects/contacts/search', {
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email
        }]
      }],
      properties: [
        'email', 'firstname', 'lastname', 'phone', 'company',
        'jobtitle', 'city', 'state', 'country',
        'lifecyclestage', 'createdate'
      ],
      limit: 1
    });

    if (!response.data.results || response.data.results.length === 0) {
      console.log(`ℹ️  No contact found for email: ${email}`);
      return {
        success: false,
        error: `No contact found with email: ${email}`,
        contact: null
      };
    }

    const contact = response.data.results[0];
    console.log(`✓ Found contact: ${contact.id}`);

    // Get associations
    const contactWithAssociations = await client.get(`/crm/v3/objects/contacts/${contact.id}`, {
      params: {
        associations: 'companies,deals'
      }
    });

    return {
      success: true,
      contact: {
        id: contact.id,
        ...contact.properties,
        associations: contactWithAssociations.data.associations || {}
      }
    };
  } catch (error) {
    console.error('Get contact by email error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get company by domain (direct lookup)
 * More efficient than search when you have exact domain
 * @param {string} domain - Company domain (e.g., "techco.com")
 * @returns {Object} Company details
 */
export async function getCompanyByDomain(domain) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    // Clean domain (remove www., https://, trailing slashes)
    const cleanDomain = domain
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .replace(/\/$/, '');

    console.log(`🔍 Direct lookup: company by domain "${cleanDomain}"`);

    // Use search API with domain filter
    const response = await client.post('/crm/v3/objects/companies/search', {
      filterGroups: [{
        filters: [{
          propertyName: 'domain',
          operator: 'EQ',
          value: cleanDomain
        }]
      }],
      properties: [
        'name', 'domain', 'industry', 'city', 'state', 'country',
        'numberofemployees', 'annualrevenue', 'description', 'phone',
        'website', 'createdate'
      ],
      limit: 1
    });

    if (!response.data.results || response.data.results.length === 0) {
      console.log(`ℹ️  No company found for domain: ${cleanDomain}`);
      return {
        success: false,
        error: `No company found with domain: ${cleanDomain}`,
        company: null
      };
    }

    const company = response.data.results[0];
    console.log(`✓ Found company: ${company.id} (${company.properties.name})`);

    // Get associations
    const companyWithAssociations = await client.get(`/crm/v3/objects/companies/${company.id}`, {
      params: {
        associations: 'contacts,deals'
      }
    });

    return {
      success: true,
      company: {
        id: company.id,
        ...company.properties,
        associations: companyWithAssociations.data.associations || {}
      }
    };
  } catch (error) {
    console.error('Get company by domain error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get company by ID (direct lookup)
 * @param {string} companyId - HubSpot company ID
 * @returns {Object} Company details
 */
export async function getCompanyById(companyId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔍 Direct lookup: company by ID "${companyId}"`);

    const response = await client.get(`/crm/v3/objects/companies/${companyId}`, {
      params: {
        properties: [
          'name', 'domain', 'industry', 'city', 'state', 'country',
          'numberofemployees', 'annualrevenue', 'description', 'phone',
          'website', 'createdate'
        ].join(','),
        associations: 'contacts,deals'
      }
    });

    console.log(`✓ Found company: ${companyId} (${response.data.properties.name})`);

    return {
      success: true,
      company: {
        id: response.data.id,
        ...response.data.properties,
        associations: response.data.associations || {}
      }
    };
  } catch (error) {
    console.error('Get company by ID error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * List all HubSpot owners (users who can own records)
 * @returns {Object} List of owners with their details
 */
export async function listHubSpotOwners() {
  try {
    const owners = await fetchHubSpotOwners();

    console.log(`✓ Retrieved ${owners.length} HubSpot owners`);

    return {
      success: true,
      count: owners.length,
      owners: owners.map(owner => ({
        id: owner.id,
        firstName: owner.firstName || '',
        lastName: owner.lastName || '',
        fullName: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
        email: owner.email || '',
        userId: owner.userId
      }))
    };
  } catch (error) {
    console.error('List HubSpot owners error:', error.message);
    return {
      success: false,
      error: error.message,
      owners: []
    };
  }
}

/**
 * Generate HubSpot embed link for interactive record viewing
 * Creates URL that opens live HubSpot interface for a record
 * @param {string} objectType - Object type (contact, company, deal, ticket, email)
 * @param {string} recordId - HubSpot record ID
 * @param {string} view - View to open (overview, activity, timeline, associations, properties, etc.)
 * @returns {Object} Embed link result
 */
export async function generateHubSpotEmbedLink(objectType, recordId, view = 'overview') {
  try {
    // Map object types to HubSpot URL paths (modern format)
    const objectTypePathMap = {
      'contact': 'contact',
      'company': 'company',
      'deal': 'deal',
      'ticket': 'ticket',
      'email': 'email'
    };

    const objectPath = objectTypePathMap[objectType.toLowerCase()];

    if (!objectPath) {
      return {
        success: false,
        error: `Invalid object type: ${objectType}. Must be one of: contact, company, deal, ticket, email`
      };
    }

    // Generate HubSpot URL (modern format)
    // Format: https://app.hubspot.com/contacts/{portalId}/{objectType}/{recordId}
    // Example: https://app.hubspot.com/contacts/21088260/contact/35474251
    const embedUrl = `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/${objectPath}/${recordId}`;

    console.log(`🔗 Generated HubSpot embed link: ${objectType} ${recordId} (view: ${view})`);

    return {
      success: true,
      url: embedUrl,
      objectType,
      recordId,
      view,
      description: `Interactive HubSpot ${objectType} record - opens in HubSpot with full functionality (add notes, schedule meetings, see associations, view properties, etc.)`
    };
  } catch (error) {
    console.error('Generate HubSpot embed link error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Search HubSpot companies
 * @param {string} query - Search query (name, domain, industry)
 * @param {number|null} minRevenue - Minimum annual revenue filter
 * @param {number|null} maxRevenue - Maximum annual revenue filter
 * @param {string|null} lifecycle_stage - Lifecycle stage filter
 * @returns {Object} Search results
 */
export async function searchHubSpotCompanies(query, minRevenue = null, maxRevenue = null, filters = {}) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      companies: []
    };
  }

  try {
    const client = createHubSpotClient();

    // Backwards compatibility: if filters is a string, treat it as lifecycle_stage
    if (typeof filters === 'string') {
      filters = { lifecycle_stage: filters };
    }

    // Ensure filters is an object
    if (!filters || typeof filters !== 'object') {
      filters = {};
    }

    // Extract filters (support both old parameters and new filters object)
    const {
      lifecycle_stage = null,
      createdate_after = null,
      createdate_before = null,
      lastmodifieddate_after = null,
      lastmodifieddate_before = null,
      owner_id = null,
      type = null,
      custom_filters = [],
      sort_by = null,
      sort_order = 'DESC'
    } = filters;

    // Build filter groups for OR search across multiple fields
    const filterGroups = [
      {
        filters: [
          {
            propertyName: 'name',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      },
      {
        filters: [
          {
            propertyName: 'domain',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      },
      {
        filters: [
          {
            propertyName: 'industry',
            operator: 'CONTAINS_TOKEN',
            value: query
          }
        ]
      }
    ];

    // Collect common filters to apply to ALL filter groups (AND conditions)
    const commonFilters = [];

    // Add revenue filters if provided
    if (minRevenue !== null) {
      commonFilters.push({
        propertyName: 'annualrevenue',
        operator: 'GTE',
        value: minRevenue.toString()
      });
      console.log(`  💰 Min revenue: $${minRevenue}`);
    }

    if (maxRevenue !== null) {
      commonFilters.push({
        propertyName: 'annualrevenue',
        operator: 'LTE',
        value: maxRevenue.toString()
      });
      console.log(`  💰 Max revenue: $${maxRevenue}`);
    }

    // Add lifecycle_stage filter
    if (lifecycle_stage) {
      commonFilters.push({
        propertyName: 'lifecyclestage',
        operator: 'EQ',
        value: lifecycle_stage
      });
      console.log(`  🎯 Filtering by lifecycle stage: ${lifecycle_stage}`);
    }

    // Add date filters
    if (createdate_after) {
      const timestamp = new Date(createdate_after).getTime();
      commonFilters.push({
        propertyName: 'createdate',
        operator: 'GTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Created after: ${createdate_after}`);
    }

    if (createdate_before) {
      const timestamp = new Date(createdate_before).getTime();
      commonFilters.push({
        propertyName: 'createdate',
        operator: 'LTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Created before: ${createdate_before}`);
    }

    if (lastmodifieddate_after) {
      const timestamp = new Date(lastmodifieddate_after).getTime();
      commonFilters.push({
        propertyName: 'hs_lastmodifieddate',
        operator: 'GTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Modified after: ${lastmodifieddate_after}`);
    }

    if (lastmodifieddate_before) {
      const timestamp = new Date(lastmodifieddate_before).getTime();
      commonFilters.push({
        propertyName: 'hs_lastmodifieddate',
        operator: 'LTE',
        value: timestamp.toString()
      });
      console.log(`  📅 Modified before: ${lastmodifieddate_before}`);
    }

    // Add owner filter
    if (owner_id) {
      commonFilters.push({
        propertyName: 'hubspot_owner_id',
        operator: 'EQ',
        value: owner_id
      });
      console.log(`  👤 Owner ID: ${owner_id}`);
    }

    // Add company type filter
    if (type) {
      commonFilters.push({
        propertyName: 'type',
        operator: 'EQ',
        value: type
      });
      console.log(`  🏢 Company type: ${type}`);
    }

    // Add custom filters
    if (custom_filters && custom_filters.length > 0) {
      custom_filters.forEach(filter => {
        commonFilters.push(filter);
        console.log(`  🔧 Custom filter: ${filter.propertyName} ${filter.operator} ${filter.value || filter.values?.join(',')}`);
      });
    }

    // Build sorts array if sort_by is specified
    const sorts = [];
    if (sort_by) {
      sorts.push({
        propertyName: sort_by,
        direction: sort_order === 'ASC' ? 'ASCENDING' : 'DESCENDING'
      });
      console.log(`  📊 Sorting by ${sort_by} ${sort_order}`);
    }

    // Apply common filters to ALL filter groups
    if (commonFilters.length > 0) {
      filterGroups.forEach(group => {
        group.filters.push(...commonFilters);
      });
    }

    const searchRequest = {
      filterGroups,
      properties: [
        'name', 'domain', 'industry', 'city', 'state', 'country',
        'numberofemployees', 'annualrevenue', 'description', 'lifecyclestage',
        'createdate', 'hs_lastmodifieddate', 'hubspot_owner_id', 'type'
      ],
      limit: 10
    };

    // Add sorts if specified
    if (sorts.length > 0) {
      searchRequest.sorts = sorts;
    }

    const response = await client.post('/crm/v3/objects/companies/search', searchRequest);

    console.log(`✓ HubSpot company search: found ${response.data.results.length} results`);

    return {
      success: true,
      count: response.data.results.length,
      companies: response.data.results.map(company => ({
        id: company.id,
        name: company.properties.name,
        domain: company.properties.domain,
        industry: company.properties.industry,
        location: [
          company.properties.city,
          company.properties.state,
          company.properties.country
        ].filter(Boolean).join(', '),
        employees: company.properties.numberofemployees,
        revenue: company.properties.annualrevenue,
        description: company.properties.description,
        lifecycleStage: company.properties.lifecyclestage,
        createDate: parseHubSpotDate(company.properties.createdate),
        lastModifiedDate: parseHubSpotDate(company.properties.hs_lastmodifieddate),
        ownerId: company.properties.hubspot_owner_id,
        type: company.properties.type
      }))
    };
  } catch (error) {
    console.error('HubSpot search companies error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      companies: []
    };
  }
}

// ============================================================================
// COMPANY & CONTACT WRITE OPERATIONS
// ============================================================================

/**
 * Create a new company in HubSpot
 * @param {Object} companyData - Company properties
 * @param {string} companyData.name - Company name (REQUIRED)
 * @param {string} companyData.domain - Company domain (e.g., "techco.com")
 * @param {string} companyData.website - Website URL
 * @param {string} companyData.industry - Industry (use industry1 property)
 * @param {string} companyData.description - Company description
 * @param {string} companyData.about_us - About us section
 * @param {string} companyData.city - City
 * @param {string} companyData.state - State/province
 * @param {string} companyData.country - Country
 * @param {string} companyData.phone - Phone number
 * @param {number} companyData.numberofemployees - Number of employees
 * @param {number} companyData.annualrevenue - Annual revenue (in default currency)
 * @param {string} companyData.lifecyclestage - Lifecycle stage (default: "lead")
 * @param {string} companyData.hubspot_owner_id - Owner ID
 * @param {string} companyData.linkedin_company_page - LinkedIn URL
 * @returns {Object} Created company with id and properties
 */
export async function createHubSpotCompany(companyData) {
  if (!companyData.name) {
    return {
      success: false,
      error: 'Company name is required'
    };
  }

  // Build properties object, filtering out undefined/null values
  const properties = {};

  // Required field
  properties.name = companyData.name;

  // Optional fields - only include if provided
  if (companyData.domain) properties.domain = companyData.domain;
  if (companyData.website) properties.website = companyData.website;
  if (companyData.industry) properties.industry = companyData.industry;
  if (companyData.description) properties.description = companyData.description;
  if (companyData.about_us) properties.about_us = companyData.about_us;
  if (companyData.city) properties.city = companyData.city;
  if (companyData.state) properties.state = companyData.state;
  if (companyData.country) properties.country = companyData.country;
  if (companyData.phone) properties.phone = companyData.phone;
  if (companyData.numberofemployees !== undefined) properties.numberofemployees = companyData.numberofemployees;
  if (companyData.annualrevenue !== undefined) properties.annualrevenue = companyData.annualrevenue;
  if (companyData.hubspot_owner_id) properties.hubspot_owner_id = companyData.hubspot_owner_id;
  if (companyData.linkedin_company_page) properties.linkedin_company_page = companyData.linkedin_company_page;

  // Set lifecycle stage to "lead" by default if not specified
  properties.lifecyclestage = companyData.lifecyclestage || 'lead';

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would create HubSpot company:');
    console.log(JSON.stringify({ endpoint: '/crm/v3/objects/companies', method: 'POST', properties }, null, 2));
    console.log('');
    return {
      success: true,
      company: {
        id: 'TEST_COMPANY_' + Date.now(),
        ...properties
      },
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🏢 Creating company: ${companyData.name}`);

    const response = await client.post('/crm/v3/objects/companies', {
      properties
    });

    console.log(`✅ Company created with ID: ${response.data.id}`);

    return {
      success: true,
      company: {
        id: response.data.id,
        ...response.data.properties
      }
    };
  } catch (error) {
    console.error('Create HubSpot company error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Update an existing company in HubSpot
 * @param {string} companyId - HubSpot company ID
 * @param {Object} properties - Properties to update (same as createHubSpotCompany)
 * @returns {Object} Updated company
 */
export async function updateHubSpotCompany(companyId, properties) {
  if (!companyId) {
    return {
      success: false,
      error: 'Company ID is required'
    };
  }

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would update HubSpot company:');
    console.log(JSON.stringify({ endpoint: `/crm/v3/objects/companies/${companyId}`, method: 'PATCH', properties }, null, 2));
    console.log('');
    return {
      success: true,
      company: {
        id: companyId,
        ...properties
      },
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔄 Updating company ID: ${companyId}`);

    // Filter out undefined/null values
    const cleanedProperties = {};
    Object.keys(properties).forEach(key => {
      if (properties[key] !== undefined && properties[key] !== null) {
        cleanedProperties[key] = properties[key];
      }
    });

    const response = await client.patch(`/crm/v3/objects/companies/${companyId}`, {
      properties: cleanedProperties
    });

    console.log(`✅ Company updated: ${companyId}`);

    return {
      success: true,
      company: {
        id: response.data.id,
        ...response.data.properties
      }
    };
  } catch (error) {
    console.error('Update HubSpot company error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Create a new contact in HubSpot
 * @param {Object} contactData - Contact properties
 * @param {string} contactData.email - Email address (REQUIRED)
 * @param {string} contactData.firstname - First name
 * @param {string} contactData.lastname - Last name
 * @param {string} contactData.jobtitle - Job title
 * @param {string} contactData.phone - Phone number
 * @param {string} contactData.mobilephone - Mobile phone
 * @param {string} contactData.city - City
 * @param {string} contactData.state - State/province
 * @param {string} contactData.country - Country
 * @param {string} contactData.lifecyclestage - Lifecycle stage
 * @param {string} contactData.hubspot_owner_id - Owner ID
 * @returns {Object} Created contact with id and properties
 */
export async function createHubSpotContact(contactData) {
  if (!contactData.email) {
    return {
      success: false,
      error: 'Contact email is required'
    };
  }

  // Build properties object
  const properties = {};

  // Required field
  properties.email = contactData.email;

  // Optional fields
  if (contactData.firstname) properties.firstname = contactData.firstname;
  if (contactData.lastname) properties.lastname = contactData.lastname;
  if (contactData.jobtitle) properties.jobtitle = contactData.jobtitle;
  if (contactData.phone) properties.phone = contactData.phone;
  if (contactData.mobilephone) properties.mobilephone = contactData.mobilephone;
  if (contactData.city) properties.city = contactData.city;
  if (contactData.state) properties.state = contactData.state;
  if (contactData.country) properties.country = contactData.country;
  if (contactData.lifecyclestage) properties.lifecyclestage = contactData.lifecyclestage;
  if (contactData.hubspot_owner_id) properties.hubspot_owner_id = contactData.hubspot_owner_id;
  if (contactData.hs_lead_status) properties.hs_lead_status = contactData.hs_lead_status;

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would create HubSpot contact:');
    console.log(JSON.stringify({ endpoint: '/crm/v3/objects/contacts', method: 'POST', properties }, null, 2));
    console.log('');
    return {
      success: true,
      contact: {
        id: 'TEST_CONTACT_' + Date.now(),
        ...properties
      },
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`👤 Creating contact: ${contactData.email}`);

    const response = await client.post('/crm/v3/objects/contacts', {
      properties
    });

    console.log(`✅ Contact created with ID: ${response.data.id}`);

    return {
      success: true,
      contact: {
        id: response.data.id,
        ...response.data.properties
      }
    };
  } catch (error) {
    console.error('Create HubSpot contact error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Update an existing contact in HubSpot
 * @param {string} contactId - HubSpot contact ID
 * @param {Object} properties - Properties to update (same as createHubSpotContact)
 * @returns {Object} Updated contact
 */
export async function updateHubSpotContact(contactId, properties) {
  if (!contactId) {
    return {
      success: false,
      error: 'Contact ID is required'
    };
  }

  // Filter out undefined/null values
  const cleanedProperties = {};
  Object.keys(properties).forEach(key => {
    if (properties[key] !== undefined && properties[key] !== null) {
      cleanedProperties[key] = properties[key];
    }
  });

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would update HubSpot contact:');
    console.log(JSON.stringify({ endpoint: `/crm/v3/objects/contacts/${contactId}`, method: 'PATCH', properties: cleanedProperties }, null, 2));
    console.log('');
    return {
      success: true,
      contact: {
        id: contactId,
        ...cleanedProperties
      },
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔄 Updating contact ID: ${contactId}`);

    const response = await client.patch(`/crm/v3/objects/contacts/${contactId}`, {
      properties: cleanedProperties
    });

    console.log(`✅ Contact updated: ${contactId}`);

    return {
      success: true,
      contact: {
        id: response.data.id,
        ...response.data.properties
      }
    };
  } catch (error) {
    console.error('Update HubSpot contact error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Associate a contact with a company in HubSpot
 * @param {string} contactId - HubSpot contact ID
 * @param {string} companyId - HubSpot company ID
 * @returns {Object} Association result
 */
export async function associateContactWithCompany(contactId, companyId) {
  if (!contactId || !companyId) {
    return {
      success: false,
      error: 'Both contact ID and company ID are required'
    };
  }

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would associate contact with company:');
    console.log(JSON.stringify({
      endpoint: `/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`,
      method: 'PUT',
      contactId,
      companyId
    }, null, 2));
    console.log('');
    return {
      success: true,
      message: `Contact ${contactId} associated with company ${companyId}`,
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔗 Associating contact ${contactId} with company ${companyId}`);

    // Association type ID for contact-to-company: 279
    // https://developers.hubspot.com/docs/api/crm/associations
    await client.put(
      `/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`,
      []
    );

    console.log(`✅ Association created successfully`);

    return {
      success: true,
      message: `Contact ${contactId} associated with company ${companyId}`
    };
  } catch (error) {
    console.error('Associate contact with company error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

// ============================================================================
// DEAL WRITE OPERATIONS
// ============================================================================

/**
 * Create a new deal in HubSpot, optionally with company and contact associations.
 *
 * @param {Object} params
 * @param {Object} params.properties - HubSpot deal property payload. Keys must be HubSpot API names
 *   (e.g., 'dealname', 'pipeline', 'dealstage', 'grant_type', 'participant_name', etc.).
 *   At minimum must include 'dealname', 'pipeline', and 'dealstage'.
 * @param {Object} [params.associations] - Optional object describing records to associate with the new deal.
 * @param {string} [params.associations.companyId] - HubSpot company ID to associate as Primary.
 * @param {string[]} [params.associations.contactIds] - Array of HubSpot contact IDs to associate.
 * @returns {Promise<Object>} { success, deal: { id, properties }, associations_created, warnings, hubspotUrl }
 */
export async function createHubSpotDeal({ properties, associations = {} }) {
  // Validate required fields
  for (const field of ['dealname', 'pipeline', 'dealstage']) {
    if (!properties[field]) {
      return {
        success: false,
        error: `Missing required property: ${field}`
      };
    }
  }

  // Filter out undefined/null values
  const cleanedProperties = {};
  Object.keys(properties).forEach(key => {
    if (properties[key] !== undefined && properties[key] !== null) {
      cleanedProperties[key] = properties[key];
    }
  });

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    const fakeDealId = 'TEST_DEAL_' + Date.now();
    console.log('\n🧪 TEST MODE — Would create HubSpot deal:');
    console.log(JSON.stringify({ endpoint: '/crm/v3/objects/deals', method: 'POST', properties: cleanedProperties, associations }, null, 2));
    console.log('');
    const associations_created = {};
    if (associations.companyId) associations_created.companyId = associations.companyId;
    if (associations.contactIds && associations.contactIds.length > 0) associations_created.contactIds = [...associations.contactIds];
    return {
      success: true,
      deal: {
        id: fakeDealId,
        ...cleanedProperties
      },
      associations_created,
      warnings: [],
      hubspotUrl: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${fakeDealId}`,
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`📋 Creating deal: ${properties.dealname}`);

    const response = await client.post('/crm/v3/objects/deals', {
      properties: cleanedProperties
    });

    const dealId = response.data.id;
    console.log(`✅ Deal created with ID: ${dealId}`);

    // Verify the deal actually exists in HubSpot before proceeding
    console.log(`🔍 Verifying deal exists in HubSpot...`);
    try {
      await client.get(`/crm/v3/objects/deals/${dealId}`);
      console.log(`✅ Deal verified`);
    } catch (verifyError) {
      console.error('Deal verification failed:', verifyError.response?.data || verifyError.message);
      return {
        success: false,
        error: 'Verification failed: deal was not found in HubSpot after creation. The POST returned ID ' + dealId + ' but a follow-up GET could not retrieve it. The deal likely was not actually created.',
        attempted_deal_id: dealId,
        verification_error: verifyError.response?.data?.message || verifyError.message
      };
    }

    const warnings = [];
    const associations_created = {};

    // Associate company if provided
    if (associations.companyId) {
      try {
        console.log(`🔗 Associating deal ${dealId} with company ${associations.companyId}`);
        await client.put(
          `/crm/v4/objects/deals/${dealId}/associations/default/companies/${associations.companyId}`,
          []
        );
        console.log(`✅ Company association created`);
        associations_created.companyId = associations.companyId;
      } catch (assocError) {
        const msg = `Failed to associate company ${associations.companyId}: ${assocError.response?.data?.message || assocError.message}`;
        console.error(`⚠️  ${msg}`);
        warnings.push(msg);
      }
    }

    // Associate contacts if provided
    if (associations.contactIds && associations.contactIds.length > 0) {
      associations_created.contactIds = [];
      for (const contactId of associations.contactIds) {
        try {
          console.log(`🔗 Associating deal ${dealId} with contact ${contactId}`);
          await client.put(
            `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`,
            []
          );
          console.log(`✅ Contact association created: ${contactId}`);
          associations_created.contactIds.push(contactId);
        } catch (assocError) {
          const msg = `Failed to associate contact ${contactId}: ${assocError.response?.data?.message || assocError.message}`;
          console.error(`⚠️  ${msg}`);
          warnings.push(msg);
        }
      }
    }

    const hubspotUrl = `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}`;

    return {
      success: true,
      deal: {
        id: dealId,
        ...response.data.properties
      },
      associations_created,
      warnings,
      hubspotUrl
    };
  } catch (error) {
    console.error('Create HubSpot deal error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Update properties on an existing HubSpot deal.
 *
 * @param {string} dealId - The HubSpot deal ID to update.
 * @param {Object} properties - Properties to update (keys are HubSpot API names, values are the new values).
 *   Only include properties you want to change.
 * @returns {Promise<Object>} { success, deal: { id, properties } } on success, { success: false, error } on failure.
 */
export async function updateHubSpotDeal(dealId, properties) {
  if (!dealId) {
    return {
      success: false,
      error: 'Deal ID is required'
    };
  }

  if (!properties || Object.keys(properties).length === 0) {
    return {
      success: false,
      error: 'At least one property to update is required'
    };
  }

  // Filter out undefined/null values
  const cleanedProperties = {};
  Object.keys(properties).forEach(key => {
    if (properties[key] !== undefined && properties[key] !== null) {
      cleanedProperties[key] = properties[key];
    }
  });

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would update HubSpot deal:');
    console.log(JSON.stringify({ endpoint: `/crm/v3/objects/deals/${dealId}`, method: 'PATCH', properties: cleanedProperties }, null, 2));
    console.log('');
    return {
      success: true,
      deal: {
        id: dealId,
        ...cleanedProperties
      },
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔄 Updating deal ID: ${dealId}`);

    const response = await client.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: cleanedProperties
    });

    console.log(`✅ Deal updated: ${dealId}`);

    return {
      success: true,
      deal: {
        id: response.data.id,
        ...response.data.properties
      }
    };
  } catch (error) {
    console.error('Update HubSpot deal error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

// ============================================================================
// LEAD VERIFICATION & MANAGEMENT
// ============================================================================

/**
 * Verify if a company's website is still active/operating
 * Checks HTTP status, redirects, and basic accessibility
 * @param {string} domain - Company domain or full URL
 * @returns {Object} Verification result with status and details
 */
export async function verifyCompanyWebsite(domain) {
  try {
    // Clean domain (remove protocol, www, trailing slash)
    let cleanDomain = domain
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .replace(/\/$/, '');

    // Build test URL
    const testUrl = `https://${cleanDomain}`;

    console.log(`🔍 Verifying website: ${testUrl}`);

    // Use axios with timeout and redirect following
    const axios = (await import('axios')).default;
    const response = await axios.get(testUrl, {
      timeout: 10000, // 10 second timeout
      maxRedirects: 5,
      validateStatus: null // Don't throw on any status
    });

    const status = response.status;
    const finalUrl = response.request.res.responseUrl || testUrl;

    let verification = {
      success: true,
      domain: cleanDomain,
      testedUrl: testUrl,
      finalUrl: finalUrl,
      statusCode: status,
      isActive: status >= 200 && status < 400,
      redirected: finalUrl !== testUrl
    };

    // Determine status message
    if (status >= 200 && status < 300) {
      verification.message = '✅ Website is active and accessible';
    } else if (status >= 300 && status < 400) {
      verification.message = `⚠️ Website redirects (${status}) - may have moved`;
    } else if (status === 404) {
      verification.message = '❌ Website not found (404) - domain may be inactive';
      verification.isActive = false;
    } else if (status === 403) {
      verification.message = '⚠️ Website is accessible but blocking automated requests (403)';
    } else if (status >= 500) {
      verification.message = `⚠️ Website is down or having issues (${status})`;
      verification.isActive = false;
    } else {
      verification.message = `⚠️ Unexpected status code: ${status}`;
    }

    console.log(`  ${verification.message}`);
    return verification;

  } catch (error) {
    console.error(`  ❌ Verification failed: ${error.message}`);

    let message = '❌ Website verification failed';
    let isActive = false;

    if (error.code === 'ENOTFOUND') {
      message = '❌ Domain not found (DNS) - company may no longer exist';
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      message = '⚠️ Website timeout - may be slow or blocking requests';
      isActive = null; // Unknown
    } else if (error.code === 'ECONNREFUSED') {
      message = '❌ Connection refused - website may be down';
    }

    return {
      success: false,
      domain: domain,
      isActive: isActive,
      error: error.message,
      errorCode: error.code,
      message: message
    };
  }
}

/**
 * Find duplicate companies in HubSpot by domain, name, or email
 * @param {Object} criteria - Search criteria
 * @param {string} criteria.domain - Company domain to check for duplicates
 * @param {string} criteria.name - Company name to check for duplicates
 * @param {string} criteria.email - Company email to check for duplicates
 * @returns {Object} List of potential duplicate companies
 */
export async function findDuplicateCompanies(criteria) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  if (!criteria.domain && !criteria.name && !criteria.email) {
    return {
      success: false,
      error: 'At least one search criterion required (domain, name, or email)'
    };
  }

  try {
    const client = createHubSpotClient();
    const filterGroups = [];

    console.log(`🔍 Finding duplicate companies...`);

    // Search by domain (most reliable)
    if (criteria.domain) {
      const cleanDomain = criteria.domain
        .toLowerCase()
        .replace(/^(https?:\/\/)?(www\.)?/, '')
        .replace(/\/$/, '');

      filterGroups.push({
        filters: [{
          propertyName: 'domain',
          operator: 'EQ',
          value: cleanDomain
        }]
      });
      console.log(`  🔎 Searching by domain: ${cleanDomain}`);
    }

    // Search by exact name match
    if (criteria.name) {
      filterGroups.push({
        filters: [{
          propertyName: 'name',
          operator: 'EQ',
          value: criteria.name
        }]
      });
      console.log(`  🔎 Searching by name: ${criteria.name}`);
    }

    const searchRequest = {
      filterGroups,
      properties: [
        'name', 'domain', 'city', 'state', 'country',
        'createdate', 'hs_lastmodifieddate', 'lifecyclestage',
        'numberofemployees', 'annualrevenue'
      ],
      limit: 100 // Get all potential duplicates
    };

    const response = await client.post('/crm/v3/objects/companies/search', searchRequest);

    const companies = response.data.results;
    console.log(`  ✓ Found ${companies.length} potential duplicates`);

    if (companies.length <= 1) {
      return {
        success: true,
        hasDuplicates: false,
        count: companies.length,
        companies: companies.map(c => ({
          id: c.id,
          name: c.properties.name,
          domain: c.properties.domain,
          createDate: parseHubSpotDate(c.properties.createdate),
          lifecycleStage: c.properties.lifecyclestage
        })),
        message: 'No duplicates found'
      };
    }

    return {
      success: true,
      hasDuplicates: true,
      count: companies.length,
      companies: companies.map(c => ({
        id: c.id,
        name: c.properties.name,
        domain: c.properties.domain,
        location: [c.properties.city, c.properties.state, c.properties.country].filter(Boolean).join(', '),
        createDate: parseHubSpotDate(c.properties.createdate),
        lastModified: parseHubSpotDate(c.properties.hs_lastmodifieddate),
        lifecycleStage: c.properties.lifecyclestage,
        employees: c.properties.numberofemployees,
        revenue: c.properties.annualrevenue
      })),
      message: `Found ${companies.length} duplicate companies`
    };

  } catch (error) {
    console.error('Find duplicate companies error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Find duplicate contacts in HubSpot by email
 * @param {string} email - Email address to check for duplicates
 * @returns {Object} List of potential duplicate contacts
 */
export async function findDuplicateContacts(email) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  if (!email) {
    return {
      success: false,
      error: 'Email address is required'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔍 Finding duplicate contacts for: ${email}`);

    const searchRequest = {
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email
        }]
      }],
      properties: [
        'email', 'firstname', 'lastname', 'jobtitle', 'company',
        'createdate', 'lastmodifieddate', 'lifecyclestage'
      ],
      limit: 100
    };

    const response = await client.post('/crm/v3/objects/contacts/search', searchRequest);

    const contacts = response.data.results;
    console.log(`  ✓ Found ${contacts.length} potential duplicates`);

    if (contacts.length <= 1) {
      return {
        success: true,
        hasDuplicates: false,
        count: contacts.length,
        contacts: contacts.map(c => ({
          id: c.id,
          email: c.properties.email,
          name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
          createDate: parseHubSpotDate(c.properties.createdate)
        })),
        message: 'No duplicates found'
      };
    }

    return {
      success: true,
      hasDuplicates: true,
      count: contacts.length,
      contacts: contacts.map(c => ({
        id: c.id,
        email: c.properties.email,
        firstname: c.properties.firstname,
        lastname: c.properties.lastname,
        name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
        jobtitle: c.properties.jobtitle,
        company: c.properties.company,
        createDate: parseHubSpotDate(c.properties.createdate),
        lastModified: parseHubSpotDate(c.properties.lastmodifieddate),
        lifecycleStage: c.properties.lifecyclestage
      })),
      message: `Found ${contacts.length} duplicate contacts`
    };

  } catch (error) {
    console.error('Find duplicate contacts error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Merge duplicate companies in HubSpot
 * @param {string} primaryCompanyId - ID of company to keep (will receive all data)
 * @param {string} secondaryCompanyId - ID of company to merge and delete
 * @returns {Object} Merge result
 */
export async function mergeDuplicateCompanies(primaryCompanyId, secondaryCompanyId) {
  if (!primaryCompanyId || !secondaryCompanyId) {
    return {
      success: false,
      error: 'Both primary and secondary company IDs are required'
    };
  }

  if (primaryCompanyId === secondaryCompanyId) {
    return {
      success: false,
      error: 'Cannot merge a company with itself'
    };
  }

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would merge HubSpot companies:');
    console.log(JSON.stringify({ endpoint: '/crm/v3/objects/companies/merge', method: 'POST', primaryObjectId: primaryCompanyId, objectIdToMerge: secondaryCompanyId }, null, 2));
    console.log('');
    return {
      success: true,
      primaryCompanyId,
      mergedCompanyId: secondaryCompanyId,
      message: `[TEST MODE] Would merge company ${secondaryCompanyId} into ${primaryCompanyId}. No live merge performed.`,
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔀 Merging companies: ${secondaryCompanyId} → ${primaryCompanyId}`);

    // HubSpot Merge API
    // Primary company receives all data from secondary
    // Secondary company is deleted
    const response = await client.post('/crm/v3/objects/companies/merge', {
      primaryObjectId: primaryCompanyId,
      objectIdToMerge: secondaryCompanyId
    });

    console.log(`  ✅ Merge successful`);

    return {
      success: true,
      primaryCompanyId: primaryCompanyId,
      mergedCompanyId: secondaryCompanyId,
      message: `Successfully merged company ${secondaryCompanyId} into ${primaryCompanyId}. All associations and data have been transferred.`
    };

  } catch (error) {
    console.error('Merge companies error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Merge duplicate contacts in HubSpot
 * @param {string} primaryContactId - ID of contact to keep (will receive all data)
 * @param {string} secondaryContactId - ID of contact to merge and delete
 * @returns {Object} Merge result
 */
export async function mergeDuplicateContacts(primaryContactId, secondaryContactId) {
  if (!primaryContactId || !secondaryContactId) {
    return {
      success: false,
      error: 'Both primary and secondary contact IDs are required'
    };
  }

  if (primaryContactId === secondaryContactId) {
    return {
      success: false,
      error: 'Cannot merge a contact with itself'
    };
  }

  // TEST MODE: Skip HubSpot API call and log payload
  if (process.env.LEAD_GEN_TEST_MODE === 'true') {
    console.log('\n🧪 TEST MODE — Would merge HubSpot contacts:');
    console.log(JSON.stringify({ endpoint: '/crm/v3/objects/contacts/merge', method: 'POST', primaryObjectId: primaryContactId, objectIdToMerge: secondaryContactId }, null, 2));
    console.log('');
    return {
      success: true,
      primaryContactId,
      mergedContactId: secondaryContactId,
      message: `[TEST MODE] Would merge contact ${secondaryContactId} into ${primaryContactId}. No live merge performed.`,
      testMode: true
    };
  }

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔀 Merging contacts: ${secondaryContactId} → ${primaryContactId}`);

    // HubSpot Merge API
    const response = await client.post('/crm/v3/objects/contacts/merge', {
      primaryObjectId: primaryContactId,
      objectIdToMerge: secondaryContactId
    });

    console.log(`  ✅ Merge successful`);

    return {
      success: true,
      primaryContactId: primaryContactId,
      mergedContactId: secondaryContactId,
      message: `Successfully merged contact ${secondaryContactId} into ${primaryContactId}. All associations and data have been transferred.`
    };

  } catch (error) {
    console.error('Merge contacts error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR SEARCH
// ============================================================================

// Cache for HubSpot owners (refreshed every 1 hour)
let ownersCache = null;
let ownersCacheTime = 0;
const OWNERS_CACHE_TTL = 3600000; // 1 hour

/**
 * Fetch all HubSpot owners (users who can own records)
 * Results are cached for 1 hour to avoid repeated API calls
 * @returns {Array} List of owner objects with id, firstName, lastName, email
 */
async function fetchHubSpotOwners() {
  const now = Date.now();

  // Return cached owners if still valid
  if (ownersCache && (now - ownersCacheTime) < OWNERS_CACHE_TTL) {
    console.log(`  📋 Using cached HubSpot owners (${ownersCache.length} owners)`);
    return ownersCache;
  }

  try {
    const client = createHubSpotClient();
    console.log(`  🔄 Fetching HubSpot owners from API...`);

    const response = await client.get('/crm/v3/owners', {
      params: {
        limit: 100
      }
    });

    ownersCache = response.data.results || [];
    ownersCacheTime = now;

    console.log(`  ✓ Fetched ${ownersCache.length} HubSpot owners`);
    return ownersCache;
  } catch (error) {
    console.error('Error fetching HubSpot owners:', error.response?.data || error.message);
    return [];
  }
}

/**
 * Parse HubSpot date property value to ISO string
 * HubSpot can return dates as either Unix timestamps (numbers) or ISO 8601 strings
 * @param {string|number} dateValue - Date value from HubSpot API
 * @returns {string|null} ISO 8601 date string or null if invalid
 */
function parseHubSpotDate(dateValue) {
  if (!dateValue) return null;

  try {
    // If it's already an ISO string (contains 'T'), use it directly
    if (typeof dateValue === 'string' && dateValue.includes('T')) {
      const date = new Date(dateValue);
      return !isNaN(date.getTime()) ? date.toISOString() : null;
    }

    // If it's a numeric string or number, treat as Unix timestamp
    const timestamp = typeof dateValue === 'string' ? parseInt(dateValue) : dateValue;
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      return !isNaN(date.getTime()) ? date.toISOString() : null;
    }

    return null;
  } catch (error) {
    console.warn(`⚠️  Error parsing HubSpot date ${dateValue}:`, error.message);
    return null;
  }
}

/**
 * Convert YYYY-MM-DD date string to Unix timestamp (milliseconds)
 * HubSpot expects timestamps in milliseconds
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Unix timestamp in milliseconds as string
 */
function convertDateToTimestamp(dateStr) {
  if (!dateStr) return null;

  try {
    // Parse date and set to start of day (midnight UTC)
    const date = new Date(dateStr + 'T00:00:00.000Z');
    const timestamp = date.getTime();

    if (isNaN(timestamp)) {
      console.warn(`⚠️  Invalid date format: ${dateStr}`);
      return null;
    }

    return timestamp.toString();
  } catch (error) {
    console.warn(`⚠️  Error converting date ${dateStr}:`, error.message);
    return null;
  }
}

/**
 * Resolve team member name/email to HubSpot user ID
 * Queries HubSpot Owners API and matches by name or email
 * @param {string} nameOrId - Team member name, email, or HubSpot user ID
 * @returns {Promise<string|null>} HubSpot user ID or null if not found
 */
async function resolveTeamMemberToId(nameOrId) {
  if (!nameOrId) return null;

  // If already a numeric ID, return it
  if (/^\d+$/.test(nameOrId.toString())) {
    return nameOrId.toString();
  }

  // Fetch owners from HubSpot (uses cache if available)
  const owners = await fetchHubSpotOwners();

  if (owners.length === 0) {
    console.warn(`⚠️  No HubSpot owners found, returning input as-is: ${nameOrId}`);
    return nameOrId;
  }

  const searchTerm = nameOrId.toLowerCase().trim();

  // Try to match by:
  // 1. Email (exact match)
  // 2. Full name (case-insensitive contains)
  // 3. First name (case-insensitive contains)
  // 4. Last name (case-insensitive contains)

  const match = owners.find(owner => {
    const email = (owner.email || '').toLowerCase();
    const firstName = (owner.firstName || '').toLowerCase();
    const lastName = (owner.lastName || '').toLowerCase();
    const fullName = `${firstName} ${lastName}`.trim();

    // Exact email match
    if (email === searchTerm) return true;

    // Full name contains search term
    if (fullName.includes(searchTerm)) return true;

    // First name contains search term
    if (firstName.includes(searchTerm)) return true;

    // Last name contains search term
    if (lastName.includes(searchTerm)) return true;

    return false;
  });

  if (match) {
    console.log(`  ✓ Resolved "${nameOrId}" to HubSpot owner: ${match.firstName} ${match.lastName} (ID: ${match.id})`);
    return match.id;
  }

  console.warn(`⚠️  Could not resolve "${nameOrId}" to HubSpot owner ID. Available owners:`);
  owners.slice(0, 10).forEach(owner => {
    console.warn(`     - ${owner.firstName} ${owner.lastName} (${owner.email}) - ID: ${owner.id}`);
  });
  if (owners.length > 10) {
    console.warn(`     ... and ${owners.length - 10} more`);
  }

  return null; // Return null instead of the input to prevent false matches
}

/**
 * Search grant applications (deals in HubSpot)
 * Enhanced version with comprehensive filtering support
 *
 * @param {Object} filters - Filter parameters (all optional)
 * @param {string} [filters.grant_program] - Grant program type (e.g., "CanExport", "ETG", "BCAFE")
 * @param {string} [filters.status] - Application status (e.g., "approved", "won", "open")
 * @param {string} [filters.company_name] - Filter by company name
 * @param {string} [filters.deal_name] - Search deal names
 * @param {string} [filters.owner_id] - Deal owner (name or HubSpot user ID)
 * @param {string} [filters.writer] - Assigned writer
 * @param {string} [filters.strategist] - Assigned strategist
 * @param {string} [filters.claims_specialist] - Claims specialist
 * @param {string} [filters.closedate_after] - Closed after date (YYYY-MM-DD)
 * @param {string} [filters.closedate_before] - Closed before date (YYYY-MM-DD)
 * @param {string} [filters.createdate_after] - Created after date (YYYY-MM-DD)
 * @param {string} [filters.createdate_before] - Created before date (YYYY-MM-DD)
 * @param {string} [filters.approved_on_after] - Approved after date (YYYY-MM-DD)
 * @param {string} [filters.approved_on_before] - Approved before date (YYYY-MM-DD)
 * @param {string} [filters.application_submitted_on_after] - Submitted after date (YYYY-MM-DD)
 * @param {string} [filters.application_submitted_on_before] - Submitted before date (YYYY-MM-DD)
 * @param {number} [filters.amount_min] - Minimum deal amount
 * @param {number} [filters.amount_max] - Maximum deal amount
 * @param {number} [filters.client_reimbursement_min] - Minimum approved funding
 * @param {number} [filters.client_reimbursement_max] - Maximum approved funding
 * @param {number} [filters.claimed_so_far_min] - Minimum claimed amount
 * @param {number} [filters.claimed_so_far_max] - Maximum claimed amount
 * @param {string} [filters.pipeline] - Pipeline name
 * @param {Array} [filters.custom_filters] - Array of custom filter objects
 * @param {number} [filters.limit] - Maximum results (default: 50, max: 100)
 * @param {Array} [filters.properties] - Specific properties to return
 * @param {string} [agentType] - Agent type for field selection
 * @returns {Object} Search results
 */
export async function searchGrantApplications(filters = {}, agentType = null) {
  // Legacy support: if called with old positional arguments, convert to filters object
  if (typeof filters === 'string' || filters === null && arguments.length > 1) {
    console.warn('⚠️  searchGrantApplications called with legacy positional arguments, converting to filters object');
    filters = {
      grant_program: arguments[0],
      status: arguments[1],
      company_name: arguments[2],
      deal_name: arguments[4] // agentType is arguments[3]
    };
    agentType = arguments[3];
  }
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      applications: []
    };
  }

  try {
    const client = createHubSpotClient();

    const hsFilters = []; // HubSpot filter array

    console.log(`\n🔍 Building search filters...`);
    console.log(`  Raw filters:`, JSON.stringify(filters, null, 2));

    // ============================================================================
    // CORE FILTERS (existing logic preserved)
    // ============================================================================

    // Filter by deal name if specified (highest priority - searches exact deal name)
    if (filters.deal_name) {
      hsFilters.push({
        propertyName: 'dealname',
        operator: 'CONTAINS_TOKEN',
        value: filters.deal_name
      });
      console.log(`  ✓ Deal name filter: "${filters.deal_name}"`);
    }

    // Filter by grant program if specified
    if (filters.grant_program && !filters.deal_name) {
      const normalizedProgram = filters.grant_program.toLowerCase().trim();
      let searchTerm = filters.grant_program;

      // Map common short forms to searchable terms
      if (normalizedProgram === 'etg') {
        searchTerm = 'ETG';
      } else if (normalizedProgram === 'bcafe') {
        searchTerm = 'BC MDP';
      } else if (normalizedProgram === 'bc mdp') {
        searchTerm = 'BC MDP';
      } else if (normalizedProgram === 'csj' || normalizedProgram.includes('summer jobs')) {
        searchTerm = 'CSJ';
      } else if (normalizedProgram.includes('canexport') || normalizedProgram === 'canex') {
        searchTerm = 'CanExport';
      } else if (normalizedProgram === 'ds4y' || normalizedProgram.includes('digital skills')) {
        searchTerm = 'DS4Y';
      }

      // Use CONTAINS_TOKEN for programs with multiple variants
      const useContainsToken = ['ds4y', 'digital skills for youth'].includes(normalizedProgram);

      if (useContainsToken) {
        hsFilters.push({
          propertyName: 'grant_type',
          operator: 'CONTAINS_TOKEN',
          value: searchTerm
        });
      } else {
        let grantTypeValues = [];

        if (normalizedProgram === 'etg') {
          grantTypeValues = ['ETG - BC'];
        } else if (normalizedProgram.includes('canexport')) {
          grantTypeValues = ['CanExport', 'CanEx Innovate'];
        } else if (normalizedProgram === 'bcafe' || normalizedProgram === 'bc mdp') {
          grantTypeValues = ['BC MDP'];
        } else if (normalizedProgram.includes('summer jobs') || normalizedProgram === 'csj') {
          grantTypeValues = ['CSJ'];
        } else {
          grantTypeValues = [searchTerm];
        }

        hsFilters.push({
          propertyName: 'grant_type',
          operator: 'IN',
          values: grantTypeValues
        });
      }
      console.log(`  ✓ Grant program filter: "${filters.grant_program}"`);
    }

    // Filter by status if specified
    if (filters.status) {
      const statusLower = filters.status.toLowerCase().trim();

      if (statusLower.includes('approv')) {
        hsFilters.push({
          propertyName: 'approved_on',
          operator: 'HAS_PROPERTY'
        });
      } else if (statusLower.includes('submit')) {
        hsFilters.push({
          propertyName: 'application_submitted_on',
          operator: 'HAS_PROPERTY'
        });
      } else if (statusLower.includes('invoice_sent') || statusLower === 'invoice sent') {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Invoice Sent (Won)'
        });
      } else if (statusLower.includes('invoice_paid') || statusLower === 'invoice paid') {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Invoice Paid'
        });
      } else if (statusLower.includes('invoice_cleared') || statusLower === 'invoice cleared') {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Invoice Cleared'
        });
      } else if (statusLower.includes('retainer_sent') || statusLower === 'retainer sent') {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Retainer Sent'
        });
      } else if (statusLower.includes('retainer_paid') || statusLower === 'retainer paid') {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Retainer Paid'
        });
      } else if (statusLower.includes('suspended')) {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Suspended'
        });
      } else if (statusLower.includes('abandoned')) {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Abandoned'
        });
      } else if (statusLower.includes('won') || statusLower.includes('invoice')) {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Invoice Sent (Won)'
        });
      } else if (statusLower.includes('open')) {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Open'
        });
      } else if (statusLower.includes('lost')) {
        hsFilters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Lost'
        });
      } else {
        hsFilters.push({
          propertyName: 'dealstage',
          operator: 'EQ',
          value: filters.status
        });
      }
      console.log(`  ✓ Status filter: "${filters.status}"`);
    }

    // Filter by dealstage if explicitly specified
    if (filters.dealstage) {
      hsFilters.push({
        propertyName: 'dealstage',
        operator: 'EQ',
        value: filters.dealstage
      });
      console.log(`  ✓ Deal stage filter: "${filters.dealstage}"`);
    }

    // Filter by company name if specified
    if (filters.company_name) {
      hsFilters.push({
        propertyName: 'company_name',
        operator: 'CONTAINS_TOKEN',
        value: filters.company_name
      });
      console.log(`  ✓ Company name filter: "${filters.company_name}"`);
    }

    // ============================================================================
    // NEW: TEAM MEMBER FILTERS
    // ============================================================================

    if (filters.owner_id) {
      const ownerId = await resolveTeamMemberToId(filters.owner_id);
      if (ownerId) {
        hsFilters.push({
          propertyName: 'hubspot_owner_id',
          operator: 'EQ',
          value: ownerId
        });
        console.log(`  ✓ Owner filter: "${filters.owner_id}" → HubSpot ID: ${ownerId}`);
      } else {
        console.warn(`  ⚠️  Could not resolve owner "${filters.owner_id}", skipping owner filter`);
        // Return early with helpful error message
        return {
          success: false,
          error: `Could not find HubSpot owner matching "${filters.owner_id}". Please check the name/email or use the HubSpot user ID directly.`,
          applications: [],
          count: 0
        };
      }
    }

    if (filters.writer) {
      hsFilters.push({
        propertyName: 'real_assigned_writer',
        operator: 'CONTAINS_TOKEN',
        value: filters.writer
      });
      console.log(`  ✓ Writer filter: "${filters.writer}"`);
    }

    if (filters.strategist) {
      hsFilters.push({
        propertyName: 'strategist',
        operator: 'CONTAINS_TOKEN',
        value: filters.strategist
      });
      console.log(`  ✓ Strategist filter: "${filters.strategist}"`);
    }

    if (filters.claims_specialist) {
      hsFilters.push({
        propertyName: 'grant_coordinator',
        operator: 'CONTAINS_TOKEN',
        value: filters.claims_specialist
      });
      console.log(`  ✓ Claims specialist filter: "${filters.claims_specialist}"`);
    }

    // ============================================================================
    // NEW: DATE RANGE FILTERS
    // ============================================================================

    // Close date (when deal was won/lost)
    if (filters.closedate_after) {
      const timestamp = convertDateToTimestamp(filters.closedate_after);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'closedate',
          operator: 'GTE',
          value: timestamp
        });
        console.log(`  ✓ Close date after: ${filters.closedate_after}`);
      }
    }

    if (filters.closedate_before) {
      const timestamp = convertDateToTimestamp(filters.closedate_before);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'closedate',
          operator: 'LTE',
          value: timestamp
        });
        console.log(`  ✓ Close date before: ${filters.closedate_before}`);
      }
    }

    // Create date
    if (filters.createdate_after) {
      const timestamp = convertDateToTimestamp(filters.createdate_after);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'createdate',
          operator: 'GTE',
          value: timestamp
        });
        console.log(`  ✓ Create date after: ${filters.createdate_after}`);
      }
    }

    if (filters.createdate_before) {
      const timestamp = convertDateToTimestamp(filters.createdate_before);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'createdate',
          operator: 'LTE',
          value: timestamp
        });
        console.log(`  ✓ Create date before: ${filters.createdate_before}`);
      }
    }

    // Approval date
    if (filters.approved_on_after) {
      const timestamp = convertDateToTimestamp(filters.approved_on_after);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'approved_on',
          operator: 'GTE',
          value: timestamp
        });
        console.log(`  ✓ Approved after: ${filters.approved_on_after}`);
      }
    }

    if (filters.approved_on_before) {
      const timestamp = convertDateToTimestamp(filters.approved_on_before);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'approved_on',
          operator: 'LTE',
          value: timestamp
        });
        console.log(`  ✓ Approved before: ${filters.approved_on_before}`);
      }
    }

    // Submission date
    if (filters.application_submitted_on_after) {
      const timestamp = convertDateToTimestamp(filters.application_submitted_on_after);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'application_submitted_on',
          operator: 'GTE',
          value: timestamp
        });
        console.log(`  ✓ Submitted after: ${filters.application_submitted_on_after}`);
      }
    }

    if (filters.application_submitted_on_before) {
      const timestamp = convertDateToTimestamp(filters.application_submitted_on_before);
      if (timestamp) {
        hsFilters.push({
          propertyName: 'application_submitted_on',
          operator: 'LTE',
          value: timestamp
        });
        console.log(`  ✓ Submitted before: ${filters.application_submitted_on_before}`);
      }
    }

    // ============================================================================
    // NEW: FINANCIAL FILTERS
    // ============================================================================

    if (filters.amount_min !== undefined && filters.amount_min !== null) {
      hsFilters.push({
        propertyName: 'amount',
        operator: 'GTE',
        value: filters.amount_min.toString()
      });
      console.log(`  ✓ Amount min: ${filters.amount_min}`);
    }

    if (filters.amount_max !== undefined && filters.amount_max !== null) {
      hsFilters.push({
        propertyName: 'amount',
        operator: 'LTE',
        value: filters.amount_max.toString()
      });
      console.log(`  ✓ Amount max: ${filters.amount_max}`);
    }

    if (filters.client_reimbursement_min !== undefined && filters.client_reimbursement_min !== null) {
      hsFilters.push({
        propertyName: 'client_reimbursement',
        operator: 'GTE',
        value: filters.client_reimbursement_min.toString()
      });
      console.log(`  ✓ Client reimbursement min: ${filters.client_reimbursement_min}`);
    }

    if (filters.client_reimbursement_max !== undefined && filters.client_reimbursement_max !== null) {
      hsFilters.push({
        propertyName: 'client_reimbursement',
        operator: 'LTE',
        value: filters.client_reimbursement_max.toString()
      });
      console.log(`  ✓ Client reimbursement max: ${filters.client_reimbursement_max}`);
    }

    if (filters.claimed_so_far_min !== undefined && filters.claimed_so_far_min !== null) {
      hsFilters.push({
        propertyName: 'claimed_so_far',
        operator: 'GTE',
        value: filters.claimed_so_far_min.toString()
      });
      console.log(`  ✓ Claimed so far min: ${filters.claimed_so_far_min}`);
    }

    if (filters.claimed_so_far_max !== undefined && filters.claimed_so_far_max !== null) {
      hsFilters.push({
        propertyName: 'claimed_so_far',
        operator: 'LTE',
        value: filters.claimed_so_far_max.toString()
      });
      console.log(`  ✓ Claimed so far max: ${filters.claimed_so_far_max}`);
    }

    // ============================================================================
    // NEW: PIPELINE FILTER
    // ============================================================================

    if (filters.pipeline) {
      hsFilters.push({
        propertyName: 'pipeline',
        operator: 'CONTAINS_TOKEN',
        value: filters.pipeline
      });
      console.log(`  ✓ Pipeline filter: "${filters.pipeline}"`);
    }

    // ============================================================================
    // NEW: CUSTOM FILTERS (for any other property)
    // ============================================================================

    if (filters.custom_filters && Array.isArray(filters.custom_filters)) {
      console.log(`  📋 Processing ${filters.custom_filters.length} custom filter(s)...`);

      filters.custom_filters.forEach((customFilter, index) => {
        const { propertyName, operator, value, highValue, values } = customFilter;

        // Validate required fields
        if (!propertyName || !operator) {
          console.warn(`  ⚠️  Custom filter ${index + 1} missing propertyName or operator, skipping`);
          return;
        }

        // Build HubSpot filter based on operator
        const hsFilter = {
          propertyName,
          operator
        };

        // Add value(s) based on operator
        if (operator === 'IN' || operator === 'NOT_IN') {
          if (!values || !Array.isArray(values)) {
            console.warn(`  ⚠️  Custom filter ${index + 1}: ${operator} requires 'values' array, skipping`);
            return;
          }
          hsFilter.values = values;
        } else if (operator === 'BETWEEN') {
          if (!value || !highValue) {
            console.warn(`  ⚠️  Custom filter ${index + 1}: BETWEEN requires both 'value' and 'highValue', skipping`);
            return;
          }
          hsFilter.value = value;
          hsFilter.highValue = highValue;
        } else if (operator === 'HAS_PROPERTY' || operator === 'NOT_HAS_PROPERTY') {
          // These operators don't need a value
        } else {
          if (value === undefined || value === null) {
            console.warn(`  ⚠️  Custom filter ${index + 1}: ${operator} requires 'value', skipping`);
            return;
          }
          hsFilter.value = value.toString();
        }

        hsFilters.push(hsFilter);
        console.log(`  ✓ Custom filter ${index + 1}: ${propertyName} ${operator} ${value || (values && values.join(',')) || '(no value)'}`);
      });
    }

    // ============================================================================
    // FINALIZE SEARCH QUERY
    // ============================================================================

    // Get agent-specific fields (or custom fields if specified)
    const properties = filters.properties || getFieldsForAgent(agentType);
    console.log(`  Agent type: ${agentType || 'default'}, using ${properties.length} HubSpot properties`);

    // Get requested limit (user can request any amount, we'll paginate)
    const requestedLimit = filters.limit || 50;
    const pageSize = 100; // HubSpot max per page
    const maxResults = 500; // Safety limit to prevent infinite loops

    console.log(`\n📤 HubSpot Search API Request:`);
    console.log(`  Requested limit: ${requestedLimit}`);
    console.log(`  Will paginate if needed (max ${maxResults} total)`);
    console.log(`  Filters: ${hsFilters.length} filter(s)`);
    console.log(`  Properties: ${properties.length}`);

    // Fetch results with pagination
    let allResults = [];
    let after = null;
    let pageNum = 1;

    do {
      const searchBody = {
        filterGroups: hsFilters.length > 0 ? [{ filters: hsFilters }] : [],
        properties,
        limit: pageSize,
        sorts: [
          {
            propertyName: 'createdate',
            direction: 'DESCENDING'
          }
        ]
      };

      // Add pagination token if not first page
      if (after) {
        searchBody.after = after;
      }

      console.log(`  📄 Fetching page ${pageNum} (after: ${after || 'start'})...`);

      const response = await client.post('/crm/v3/objects/deals/search', searchBody);
      const results = response.data.results || [];

      allResults = allResults.concat(results);
      console.log(`  ✓ Page ${pageNum}: ${results.length} results (total so far: ${allResults.length})`);

      // Check if there are more pages
      after = response.data.paging?.next?.after;
      pageNum++;

      // Stop if we've hit the requested limit, max results, or no more pages
      if (allResults.length >= requestedLimit || allResults.length >= maxResults || !after) {
        break;
      }

    } while (after);

    // Trim to requested limit
    const finalResults = allResults.slice(0, requestedLimit);

    console.log(`\n✅ HubSpot search completed: found ${finalResults.length} result(s) (${allResults.length > requestedLimit ? `trimmed from ${allResults.length}` : 'all'})`);

    // Log some sample grant_type values if we got results
    if (finalResults.length > 0 && filters.grant_program) {
      const sampleTypes = finalResults.slice(0, 3).map(d => d.properties.grant_type);
      console.log(`  Sample grant_type values: ${sampleTypes.join(', ')}`);
    }

    return {
      success: true,
      count: finalResults.length,
      total_available: allResults.length,
      has_more: allResults.length > requestedLimit,
      applications: finalResults.map(deal => {
        const app = {
          // Core info (always present)
          id: deal.id,
          name: deal.properties.dealname,
          companyName: deal.properties.company_name,
          refNumber: deal.properties.ref__,

          // Grant program
          program: deal.properties.grant_type,
          dealType: deal.properties.dealtype,
          grantReliant: deal.properties.grant_reliant,

          // Status
          status: deal.properties.dealstage,
          state: deal.properties.state,

          // Timeline
          createdDate: deal.properties.createdate,
          submittedDate: deal.properties.application_submitted_on,
          approvedDate: deal.properties.approved_on,
          startDate: deal.properties.start_date,
          endDate: deal.properties.end_date,
          closeDate: deal.properties.closedate,

          // Financial (ONLY reimbursement amounts, NO deal.amount field)
          approvedFunding: deal.properties.client_reimbursement,
          actualReimbursement: deal.properties.actual_reimbursement,
          retainerAmount: deal.properties.retainer,
          serviceFee: deal.properties.service_fee,

          // Team
          ownerId: deal.properties.hubspot_owner_id,
          grantCoordinator: deal.properties.grant_coordinator,
          externalWriter: deal.properties.external_writer_assigned
        };

        // Conditionally add fields based on agent type and presence

        // CanExport-specific fields
        if (deal.properties.project_name) app.projectName = deal.properties.project_name;
        if (deal.properties.project_number) app.projectNumber = deal.properties.project_number;
        if (deal.properties.waitlisted_) app.waitlisted = deal.properties.waitlisted_;
        if (deal.properties.ghost_stage_) app.grantComplete = deal.properties.ghost_stage_;

        // CanExport multiple claims
        if (deal.properties.claim_1_due) app.claim1Due = deal.properties.claim_1_due;
        if (deal.properties.claim_1_submitted) app.claim1Submitted = deal.properties.claim_1_submitted;
        if (deal.properties.claim_2_due) app.claim2Due = deal.properties.claim_2_due;
        if (deal.properties.claim_2_submitted) app.claim2Submitted = deal.properties.claim_2_submitted;
        if (deal.properties.claim_3_due) app.claim3Due = deal.properties.claim_3_due;
        if (deal.properties.claim_3_submitted) app.claim3Submitted = deal.properties.claim_3_submitted;
        if (deal.properties.claim_4_due) app.claim4Due = deal.properties.claim_4_due;
        if (deal.properties.claim_4_submitted) app.claim4Submitted = deal.properties.claim_4_submitted;
        if (deal.properties.claimed_so_far) app.claimedSoFar = deal.properties.claimed_so_far;
        if (deal.properties.final_report_submitted) app.finalReportSubmitted = deal.properties.final_report_submitted;

        // ETG-specific fields
        if (deal.properties.candidate_name_job_title_email) {
          app.candidateInfo = deal.properties.candidate_name_job_title_email;
        }
        if (deal.properties.tuition_fee_per_person) app.tuitionFeePerPerson = deal.properties.tuition_fee_per_person;
        if (deal.properties.training_hours_per_person) app.trainingHoursPerPerson = deal.properties.training_hours_per_person;
        if (deal.properties.training_delivery_method) app.trainingDeliveryMethod = deal.properties.training_delivery_method;
        if (deal.properties.training_link_url) app.trainingLinkUrl = deal.properties.training_link_url;
        if (deal.properties.additional_material_list___cost) {
          app.additionalMaterialsCost = deal.properties.additional_material_list___cost;
        }

        // ETG third party payer
        if (deal.properties.tp_paying) app.thirdPartyPaying = deal.properties.tp_paying;
        if (deal.properties.tp_company) app.thirdPartyCompany = deal.properties.tp_company;
        if (deal.properties.tp_address) app.thirdPartyAddress = deal.properties.tp_address;
        if (deal.properties.pif_x_x) app.pifSubmitted = deal.properties.pif_x_x;

        // ETG claims (single/final claim)
        if (deal.properties.final_claim_submitted) app.finalClaimSubmitted = deal.properties.final_claim_submitted;
        if (deal.properties.claim_returned) app.claimReturned = deal.properties.claim_returned;
        if (deal.properties.completion_report) app.completionReport = deal.properties.completion_report;

        // Common claims fields
        if (deal.properties.claim_type) app.claimType = deal.properties.claim_type;
        if (deal.properties.next_claim_due) app.nextClaimDue = deal.properties.next_claim_due;
        if (deal.properties.claim_approved) app.claimApproved = deal.properties.claim_approved;

        // Workflow status
        if (deal.properties.ra_complete) app.raComplete = deal.properties.ra_complete;
        if (deal.properties.budget_complete) app.budgetComplete = deal.properties.budget_complete;
        if (deal.properties.writer_draft_review_completion_date) {
          app.writerDraftReviewDate = deal.properties.writer_draft_review_completion_date;
        }

        // Additional details
        if (deal.properties.google_drive_link_to_docs) app.googleDriveLink = deal.properties.google_drive_link_to_docs;
        if (deal.properties.funding_contribution) app.fundingContribution = deal.properties.funding_contribution;
        if (deal.properties.invoice_sent_date) app.invoiceSentDate = deal.properties.invoice_sent_date;
        if (deal.properties.invoice_due) app.invoiceDueDate = deal.properties.invoice_due;
        if (deal.properties.retainer_date_sent) app.retainerDateSent = deal.properties.retainer_date_sent;
        if (deal.properties.retainer_date_paid) app.retainerDatePaid = deal.properties.retainer_date_paid;

        return app;
      })
    };
  } catch (error) {
    console.error('HubSpot search grant applications error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      applications: []
    };
  }
}

/**
 * Get specific grant application by ID
 * @param {string} applicationId - HubSpot deal ID
 * @param {string|null} agentType - Agent type for field selection
 * @returns {Object} Application details
 */
export async function getGrantApplication(applicationId, agentType = null) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    // Get agent-specific fields
    const properties = getFieldsForAgent(agentType);
    console.log(`  Agent type: ${agentType || 'default'}, using ${properties.length} HubSpot properties`);

    const response = await client.get(`/crm/v3/objects/deals/${applicationId}`, {
      params: {
        properties: properties.join(','),
        associations: 'contacts,companies'
      }
    });

    console.log(`✓ HubSpot grant application retrieved: ${applicationId}`);

    return {
      success: true,
      application: {
        id: response.data.id,
        ...response.data.properties
      },
      associations: response.data.associations || {}
    };
  } catch (error) {
    console.error('HubSpot get grant application error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// EMAIL ENGAGEMENT TOOLS
// ============================================================================

/**
 * Get email history for a deal/project
 * @param {string} dealId - HubSpot deal ID
 * @param {number} limit - Maximum number of emails to retrieve
 * @returns {Object} Email history with summary
 */
export async function getProjectEmailHistory(dealId, limit = 20) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      emails: []
    };
  }

  try {
    const client = createHubSpotClient();

    // STRATEGY 1: Try to get emails directly associated with the deal
    console.log(`🔍 Searching for emails directly associated with deal ${dealId}...`);
    const directSearchResponse = await client.post('/crm/v3/objects/emails/search', {
      filterGroups: [{
        filters: [{
          propertyName: 'associations.deal',
          operator: 'EQ',
          value: dealId
        }]
      }],
      properties: [
        'hs_email_subject',
        'hs_email_text',
        'hs_timestamp',
        'hs_email_from',
        'hs_email_to',
        'hs_email_status',
        'hs_email_direction',
        'hs_attachment_ids'
      ],
      sorts: [{
        propertyName: 'hs_timestamp',
        direction: 'DESCENDING'
      }],
      limit: Math.min(limit, 100)
    });

    const directEmails = directSearchResponse.data.results || [];
    console.log(`  Found ${directEmails.length} emails directly associated with deal`);

    // STRATEGY 2: If no direct emails, get emails from deal's contacts
    let contactEmails = [];
    if (directEmails.length === 0) {
      console.log(`🔍 No direct email associations found. Searching contacts...`);

      // Get the deal with its contact associations
      const dealResponse = await client.get(`/crm/v3/objects/deals/${dealId}`, {
        params: {
          associations: 'contacts'
        }
      });

      const deal = dealResponse.data;
      const contactAssociations = deal.associations?.contacts?.results || [];
      console.log(`  Deal has ${contactAssociations.length} associated contact(s)`);

      if (contactAssociations.length > 0) {
        // Get emails from each contact
        const emailPromises = contactAssociations.map(async (contactAssoc) => {
          try {
            const contactEmailsResponse = await client.get(
              `/crm/v3/objects/contacts/${contactAssoc.id}/associations/emails`
            );
            return contactEmailsResponse.data.results || [];
          } catch (error) {
            console.error(`  ⚠️  Error fetching emails for contact ${contactAssoc.id}:`, error.message);
            return [];
          }
        });

        const contactEmailResults = await Promise.all(emailPromises);
        const emailIds = [...new Set(contactEmailResults.flat().map(e => e.id))]; // Deduplicate
        console.log(`  Found ${emailIds.length} unique email(s) from contacts`);

        // Fetch full email details
        if (emailIds.length > 0) {
          const emailDetailsPromises = emailIds.map(async (emailId) => {
            try {
              const emailResponse = await client.get(`/crm/v3/objects/emails/${emailId}`, {
                params: {
                  properties: [
                    'hs_email_subject',
                    'hs_email_text',
                    'hs_timestamp',
                    'hs_email_from',
                    'hs_email_to',
                    'hs_email_status',
                    'hs_email_direction',
                    'hs_attachment_ids'
                  ]
                }
              });
              return emailResponse.data;
            } catch (error) {
              console.error(`  ⚠️  Error fetching email ${emailId}:`, error.message);
              return null;
            }
          });

          const emailDetails = await Promise.all(emailDetailsPromises);
          contactEmails = emailDetails.filter(e => e !== null);
          console.log(`  ✓ Retrieved ${contactEmails.length} email details from contacts`);
        }
      }
    }

    // Combine both sources
    const allEmailResults = [...directEmails, ...contactEmails];

    if (allEmailResults.length === 0) {
      console.log(`ℹ️  No emails found for deal ${dealId} (checked both deal associations and contacts)`);
      return {
        success: true,
        count: 0,
        emails: [],
        summary: {
          totalEmails: 0,
          inboundCount: 0,
          outboundCount: 0,
          mostRecentEmail: null
        }
      };
    }

    // Format email results with truncated bodies to prevent context overflow
    const MAX_EMAIL_BODY_LENGTH = 500; // Limit email body to 500 chars for context efficiency
    const emails = allEmailResults.map(email => {
      const fullBody = email.properties.hs_email_text || '';
      const truncatedBody = fullBody.length > MAX_EMAIL_BODY_LENGTH
        ? fullBody.substring(0, MAX_EMAIL_BODY_LENGTH) + '...'
        : fullBody;

      return {
        id: email.id,
        subject: email.properties.hs_email_subject || '(No Subject)',
        textBody: truncatedBody,
        timestamp: email.properties.hs_timestamp || email.createdAt,
        from: email.properties.hs_email_from || '',
        to: email.properties.hs_email_to || '',
        direction: email.properties.hs_email_direction || '',
        hasAttachments: !!(email.properties.hs_attachment_ids)
      };
    });

    // Already sorted by API, but ensure descending order
    emails.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Generate summary
    const inbound = emails.filter(e => e.direction === 'INCOMING_EMAIL').length;
    const outbound = emails.filter(e => e.direction === 'OUTGOING_EMAIL').length;
    const mostRecent = emails[0] || null;

    console.log(`✓ Retrieved ${emails.length} emails for deal ${dealId}`);

    return {
      success: true,
      count: emails.length,
      emails: emails.slice(0, limit),
      summary: {
        totalEmails: emails.length,
        inboundCount: inbound,
        outboundCount: outbound,
        mostRecentEmail: mostRecent ? {
          subject: mostRecent.subject,
          from: mostRecent.from,
          timestamp: mostRecent.timestamp,
          direction: mostRecent.direction
        } : null,
        firstEmailDate: emails.length > 0 ? emails[emails.length - 1].timestamp : null,
        lastEmailDate: mostRecent ? mostRecent.timestamp : null
      }
    };
  } catch (error) {
    console.error('Get project email history error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      emails: []
    };
  }
}

/**
 * Search emails by keywords (e.g., "funding agreement", "claim")
 * @param {string} dealId - HubSpot deal ID
 * @param {string} searchTerm - Keywords to search for in subject or body
 * @param {number} limit - Maximum results to return
 * @returns {Object} Filtered email results
 */
export async function searchProjectEmails(dealId, searchTerm, limit = 10) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      emails: []
    };
  }

  try {
    // Get all emails first
    const emailHistory = await getProjectEmailHistory(dealId, 100);

    if (!emailHistory.success) {
      return emailHistory;
    }

    // Filter by search term
    const searchLower = searchTerm.toLowerCase();
    const filtered = emailHistory.emails.filter(email => {
      const subject = (email.subject || '').toLowerCase();
      const textBody = (email.textBody || '').toLowerCase();
      return subject.includes(searchLower) || textBody.includes(searchLower);
    });

    console.log(`✓ Found ${filtered.length} emails matching "${searchTerm}"`);

    return {
      success: true,
      count: filtered.length,
      searchTerm,
      emails: filtered.slice(0, limit)
    };
  } catch (error) {
    console.error('Search project emails error:', error.message);
    return {
      success: false,
      error: error.message,
      emails: []
    };
  }
}

/**
 * Get detailed email content by ID
 * @param {string} emailId - HubSpot email engagement ID
 * @returns {Object} Full email details including HTML content
 */
export async function getEmailDetails(emailId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    const response = await client.get(`/crm/v3/objects/emails/${emailId}`, {
      params: {
        properties: [
          'hs_email_subject',
          'hs_email_text',
          'hs_email_html',
          'hs_timestamp',
          'hs_email_from',
          'hs_email_to',
          'hs_email_cc',
          'hs_email_bcc',
          'hs_email_status',
          'hs_email_direction',
          'hs_attachment_ids',
          'hs_email_thread_id'
        ].join(',')
      }
    });

    console.log(`✓ Retrieved email details: ${emailId}`);

    return {
      success: true,
      email: {
        id: response.data.id,
        subject: response.data.properties.hs_email_subject || '(No Subject)',
        textBody: response.data.properties.hs_email_text || '',
        htmlBody: response.data.properties.hs_email_html || '',
        timestamp: response.data.properties.hs_timestamp || response.data.createdAt,
        from: response.data.properties.hs_email_from || '',
        to: response.data.properties.hs_email_to || '',
        cc: response.data.properties.hs_email_cc || '',
        bcc: response.data.properties.hs_email_bcc || '',
        status: response.data.properties.hs_email_status || '',
        direction: response.data.properties.hs_email_direction || '',
        attachmentIds: response.data.properties.hs_attachment_ids || '',
        threadId: response.data.properties.hs_email_thread_id || '',
        hasAttachments: !!(response.data.properties.hs_attachment_ids)
      }
    };
  } catch (error) {
    console.error('Get email details error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get attachments for an email
 * @param {string} emailId - HubSpot email engagement ID
 * @returns {Object} List of attachments with download URLs
 */
export async function getEmailAttachments(emailId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      attachments: []
    };
  }

  try {
    const client = createHubSpotClient();

    // First get the email to get attachment IDs
    const emailResponse = await client.get(`/crm/v3/objects/emails/${emailId}`, {
      params: {
        properties: ['hs_attachment_ids']
      }
    });

    const attachmentIds = emailResponse.data.properties.hs_attachment_ids;

    if (!attachmentIds) {
      console.log(`ℹ️  Email ${emailId} has no attachments`);
      return {
        success: true,
        count: 0,
        attachments: []
      };
    }

    // Parse attachment IDs (comma-separated string)
    const idList = attachmentIds.split(',').map(id => id.trim()).filter(id => id);
    console.log(`  Found ${idList.length} attachment ID(s) for email ${emailId}`);

    // Fetch file details for each attachment
    // Handle both public files and HIDDEN_PRIVATE files (email attachments)
    const attachmentPromises = idList.map(async (fileId) => {
      try {
        // Try to get file metadata first
        const fileResponse = await client.get(`/files/v3/files/${fileId}`);
        const file = fileResponse.data;

        let downloadUrl = file.url || '';

        // If file is hidden/private, get signed URL
        // Hidden files have empty or inaccessible URLs
        if (!downloadUrl || file.hidden || file.access === 'PRIVATE' || file.access === 'HIDDEN_PRIVATE') {
          try {
            console.log(`  File ${fileId} is hidden/private, getting signed URL...`);
            const signedUrlResponse = await client.get(`/files/v3/files/${fileId}/signed-url`);
            downloadUrl = signedUrlResponse.data.url || downloadUrl;
            console.log(`  ✓ Got signed URL for file ${fileId}`);
          } catch (signedUrlError) {
            console.error(`  ⚠️  Could not get signed URL for file ${fileId}:`, signedUrlError.message);
          }
        }

        return {
          id: file.id,
          name: file.name || 'Unnamed file',
          extension: file.extension || '',
          type: file.type || '',
          size: file.size || 0,
          url: downloadUrl,
          hidden: file.hidden || false,
          access: file.access || 'PUBLIC',
          createdAt: file.createdAt || ''
        };
      } catch (error) {
        // If getting file metadata fails, the file might be deleted or inaccessible
        console.error(`  ⚠️  Error fetching file ${fileId}:`, error.message);

        // Try to get signed URL directly as last resort for hidden files
        if (error.response?.status === 404 || error.response?.status === 403) {
          try {
            console.log(`  Attempting signed URL for potentially hidden file ${fileId}...`);
            const signedUrlResponse = await client.get(`/files/v3/files/${fileId}/signed-url`);
            return {
              id: fileId,
              name: 'Hidden file (metadata unavailable)',
              extension: '',
              type: '',
              size: 0,
              url: signedUrlResponse.data.url || '',
              hidden: true,
              access: 'HIDDEN_PRIVATE',
              createdAt: ''
            };
          } catch (signedUrlError) {
            console.error(`  ⚠️  Signed URL also failed for file ${fileId}:`, signedUrlError.message);
          }
        }

        return null;
      }
    });

    const attachments = (await Promise.all(attachmentPromises)).filter(a => a !== null);
    console.log(`✓ Retrieved ${attachments.length} attachment(s) for email ${emailId}`);

    return {
      success: true,
      count: attachments.length,
      attachments
    };
  } catch (error) {
    console.error('Get email attachments error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      attachments: []
    };
  }
}

/**
 * Get files associated with a deal (grant application)
 * This retrieves files uploaded to or associated with the deal record,
 * which may include funding agreements, contracts, and other documents
 * that were uploaded separately from emails.
 * @param {string} dealId - HubSpot deal ID
 * @returns {Object} List of associated files with download URLs
 */
export async function getDealFiles(dealId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      files: []
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔍 Getting files associated with deal ${dealId}...`);

    // Get file associations for the deal
    const associationsResponse = await client.get(
      `/crm/v3/objects/deals/${dealId}/associations/files`
    );

    const fileAssociations = associationsResponse.data.results || [];

    if (fileAssociations.length === 0) {
      console.log(`ℹ️  Deal ${dealId} has no associated files`);
      return {
        success: true,
        count: 0,
        files: []
      };
    }

    console.log(`   Found ${fileAssociations.length} file association(s)`);

    // Fetch details for each file
    // Handle both public files and HIDDEN_PRIVATE files
    const filePromises = fileAssociations.map(async (assoc) => {
      try {
        const fileResponse = await client.get(`/files/v3/files/${assoc.id}`);
        const file = fileResponse.data;

        let downloadUrl = file.url || '';

        // If file is hidden/private, get signed URL
        if (!downloadUrl || file.hidden || file.access === 'PRIVATE' || file.access === 'HIDDEN_PRIVATE') {
          try {
            console.log(`  File ${assoc.id} is hidden/private, getting signed URL...`);
            const signedUrlResponse = await client.get(`/files/v3/files/${assoc.id}/signed-url`);
            downloadUrl = signedUrlResponse.data.url || downloadUrl;
            console.log(`  ✓ Got signed URL for file ${assoc.id}`);
          } catch (signedUrlError) {
            console.error(`  ⚠️  Could not get signed URL for file ${assoc.id}:`, signedUrlError.message);
          }
        }

        return {
          id: file.id,
          name: file.name || 'Unnamed file',
          extension: file.extension || '',
          type: file.type || '',
          size: file.size || 0,
          url: downloadUrl,
          hidden: file.hidden || false,
          access: file.access || 'PUBLIC',
          createdAt: file.createdAt || '',
          updatedAt: file.updatedAt || ''
        };
      } catch (error) {
        console.error(`  ⚠️  Error fetching file ${assoc.id}:`, error.message);

        // Try to get signed URL directly as last resort for hidden files
        if (error.response?.status === 404 || error.response?.status === 403) {
          try {
            console.log(`  Attempting signed URL for potentially hidden file ${assoc.id}...`);
            const signedUrlResponse = await client.get(`/files/v3/files/${assoc.id}/signed-url`);
            return {
              id: assoc.id,
              name: 'Hidden file (metadata unavailable)',
              extension: '',
              type: '',
              size: 0,
              url: signedUrlResponse.data.url || '',
              hidden: true,
              access: 'HIDDEN_PRIVATE',
              createdAt: '',
              updatedAt: ''
            };
          } catch (signedUrlError) {
            console.error(`  ⚠️  Signed URL also failed for file ${assoc.id}:`, signedUrlError.message);
          }
        }

        return null;
      }
    });

    const files = (await Promise.all(filePromises)).filter(f => f !== null);

    console.log(`✓ Retrieved ${files.length} file(s) for deal ${dealId}`);

    return {
      success: true,
      count: files.length,
      dealId,
      files
    };
  } catch (error) {
    // 404 likely means no associations exist
    if (error.response?.status === 404) {
      console.log(`ℹ️  Deal ${dealId} has no file associations`);
      return {
        success: true,
        count: 0,
        files: []
      };
    }

    console.error('Get deal files error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}

/**
 * Get files associated with a contact
 * Useful for finding files sent by or associated with a specific person
 * @param {string} contactId - HubSpot contact ID
 * @returns {Object} List of associated files with download URLs
 */
export async function getContactFiles(contactId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      files: []
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`🔍 Getting files associated with contact ${contactId}...`);

    // Get file associations for the contact
    const associationsResponse = await client.get(
      `/crm/v3/objects/contacts/${contactId}/associations/files`
    );

    const fileAssociations = associationsResponse.data.results || [];

    if (fileAssociations.length === 0) {
      console.log(`ℹ️  Contact ${contactId} has no associated files`);
      return {
        success: true,
        count: 0,
        files: []
      };
    }

    console.log(`   Found ${fileAssociations.length} file association(s)`);

    // Fetch details for each file (reuse same logic as getDealFiles)
    const filePromises = fileAssociations.map(async (assoc) => {
      try {
        const fileResponse = await client.get(`/files/v3/files/${assoc.id}`);
        const file = fileResponse.data;

        let downloadUrl = file.url || '';

        // If file is hidden/private, get signed URL
        if (!downloadUrl || file.hidden || file.access === 'PRIVATE' || file.access === 'HIDDEN_PRIVATE') {
          try {
            console.log(`  File ${assoc.id} is hidden/private, getting signed URL...`);
            const signedUrlResponse = await client.get(`/files/v3/files/${assoc.id}/signed-url`);
            downloadUrl = signedUrlResponse.data.url || downloadUrl;
            console.log(`  ✓ Got signed URL for file ${assoc.id}`);
          } catch (signedUrlError) {
            console.error(`  ⚠️  Could not get signed URL for file ${assoc.id}:`, signedUrlError.message);
          }
        }

        return {
          id: file.id,
          name: file.name || 'Unnamed file',
          extension: file.extension || '',
          type: file.type || '',
          size: file.size || 0,
          url: downloadUrl,
          hidden: file.hidden || false,
          access: file.access || 'PUBLIC',
          createdAt: file.createdAt || '',
          updatedAt: file.updatedAt || ''
        };
      } catch (error) {
        console.error(`  ⚠️  Error fetching file ${assoc.id}:`, error.message);

        // Try to get signed URL directly as last resort for hidden files
        if (error.response?.status === 404 || error.response?.status === 403) {
          try {
            console.log(`  Attempting signed URL for potentially hidden file ${assoc.id}...`);
            const signedUrlResponse = await client.get(`/files/v3/files/${assoc.id}/signed-url`);
            return {
              id: assoc.id,
              name: 'Hidden file (metadata unavailable)',
              extension: '',
              type: '',
              size: 0,
              url: signedUrlResponse.data.url || '',
              hidden: true,
              access: 'HIDDEN_PRIVATE',
              createdAt: '',
              updatedAt: ''
            };
          } catch (signedUrlError) {
            console.error(`  ⚠️  Signed URL also failed for file ${assoc.id}:`, signedUrlError.message);
          }
        }

        return null;
      }
    });

    const files = (await Promise.all(filePromises)).filter(f => f !== null);

    console.log(`✓ Retrieved ${files.length} file(s) for contact ${contactId}`);

    return {
      success: true,
      count: files.length,
      contactId,
      files
    };
  } catch (error) {
    // 404 likely means no associations exist
    if (error.response?.status === 404) {
      console.log(`ℹ️  Contact ${contactId} has no file associations`);
      return {
        success: true,
        count: 0,
        files: []
      };
    }

    console.error('Get contact files error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}

/**
 * Get a specific file by ID (from URL or known file ID)
 * Useful when file ID is known but file isn't associated with emails/deals
 * @param {string} fileIdOrUrl - HubSpot file ID or full URL (e.g., https://app.hubspot.com/file-preview/.../file/123456/...)
 * @returns {Object} File metadata with download URL
 */
export async function getFileById(fileIdOrUrl) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    // Extract file ID from URL if needed
    let fileId = fileIdOrUrl;
    if (fileIdOrUrl.includes('hubspot.com') || fileIdOrUrl.includes('/file/')) {
      const match = fileIdOrUrl.match(/\/file\/(\d+)/);
      if (match) {
        fileId = match[1];
        console.log(`  Extracted file ID ${fileId} from URL`);
      }
    }

    const client = createHubSpotClient();

    console.log(`🔍 Getting file ${fileId}...`);

    // Get file metadata
    const fileResponse = await client.get(`/files/v3/files/${fileId}`);
    const file = fileResponse.data;

    let downloadUrl = file.url || '';

    // If file is hidden/private, get signed URL
    if (!downloadUrl || file.hidden || file.access === 'PRIVATE' || file.access === 'HIDDEN_PRIVATE') {
      try {
        console.log(`  File ${fileId} is hidden/private, getting signed URL...`);
        const signedUrlResponse = await client.get(`/files/v3/files/${fileId}/signed-url`);
        downloadUrl = signedUrlResponse.data.url || downloadUrl;
        console.log(`  ✓ Got signed URL for file ${fileId}`);
      } catch (signedUrlError) {
        console.error(`  ⚠️  Could not get signed URL for file ${fileId}:`, signedUrlError.message);
      }
    }

    console.log(`✓ Retrieved file ${fileId}: ${file.name}`);

    return {
      success: true,
      file: {
        id: file.id,
        name: file.name || 'Unnamed file',
        extension: file.extension || '',
        type: file.type || '',
        size: file.size || 0,
        url: downloadUrl,
        hidden: file.hidden || false,
        access: file.access || 'PUBLIC',
        createdAt: file.createdAt || '',
        updatedAt: file.updatedAt || ''
      }
    };
  } catch (error) {
    // Try signed URL as fallback for hidden files
    if (error.response?.status === 404 || error.response?.status === 403) {
      try {
        const fileId = fileIdOrUrl.includes('/file/')
          ? fileIdOrUrl.match(/\/file\/(\d+)/)?.[1]
          : fileIdOrUrl;

        console.log(`  Attempting signed URL for potentially hidden file ${fileId}...`);
        const client = createHubSpotClient();
        const signedUrlResponse = await client.get(`/files/v3/files/${fileId}/signed-url`);

        return {
          success: true,
          file: {
            id: fileId,
            name: 'Hidden file (metadata unavailable)',
            extension: '',
            type: '',
            size: 0,
            url: signedUrlResponse.data.url || '',
            hidden: true,
            access: 'HIDDEN_PRIVATE',
            createdAt: '',
            updatedAt: ''
          }
        };
      } catch (signedUrlError) {
        console.error(`  ⚠️  Signed URL also failed for file:`, signedUrlError.message);
      }
    }

    console.error('Get file by ID error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Read and extract text content from a HubSpot file
 * Downloads the file and extracts text based on file type (PDF, DOCX, TXT)
 * @param {string} fileIdOrUrl - HubSpot file ID or full URL
 * @returns {Object} Extracted text content
 */
export async function readHubSpotFile(fileIdOrUrl) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    // Extract file ID from URL if needed
    let fileId = fileIdOrUrl;
    if (fileIdOrUrl.includes('hubspot.com') || fileIdOrUrl.includes('/file/')) {
      const match = fileIdOrUrl.match(/\/file\/(\d+)/);
      if (match) {
        fileId = match[1];
        console.log(`  Extracted file ID ${fileId} from URL`);
      }
    }

    const client = createHubSpotClient();

    console.log(`📖 Reading file ${fileId}...`);

    // Step 1: Get file metadata
    console.log(`  1️⃣ Getting file metadata...`);
    const fileResponse = await client.get(`/files/v3/files/${fileId}`);
    const file = fileResponse.data;

    const fileName = file.name || 'Unknown file';
    const fileExtension = (file.extension || '').toLowerCase();
    const fileSize = file.size || 0;

    console.log(`  ✓ File: ${fileName}`);
    console.log(`  ✓ Type: ${fileExtension}`);
    console.log(`  ✓ Size: ${fileSize} bytes`);

    // Check file size (Claude limit: 32MB for documents)
    const MAX_FILE_SIZE = 32 * 1024 * 1024; // 32MB
    if (fileSize > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large for processing: ${fileSize} bytes (max: ${MAX_FILE_SIZE} bytes)`
      };
    }

    // Step 2: Get signed URL (handles hidden/private files)
    console.log(`  2️⃣ Getting download URL...`);
    let downloadUrl = file.url || '';

    if (!downloadUrl || file.hidden || file.access === 'PRIVATE' || file.access === 'HIDDEN_PRIVATE') {
      try {
        const signedUrlResponse = await client.get(`/files/v3/files/${fileId}/signed-url`);
        downloadUrl = signedUrlResponse.data.url;
        console.log(`  ✓ Got signed URL for ${file.hidden ? 'hidden' : 'private'} file`);
      } catch (signedUrlError) {
        return {
          success: false,
          error: `Could not get download URL: ${signedUrlError.message}`
        };
      }
    } else {
      console.log(`  ✓ Using public URL`);
    }

    // Step 3: Download file content
    console.log(`  3️⃣ Downloading file...`);
    const downloadResponse = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });

    const fileBuffer = Buffer.from(downloadResponse.data);
    console.log(`  ✓ Downloaded ${fileBuffer.length} bytes`);

    // Verify download size matches
    if (fileSize > 0 && fileBuffer.length !== fileSize) {
      console.warn(`  ⚠️ Downloaded size (${fileBuffer.length}) doesn't match expected (${fileSize})`);
    }

    // Step 4: Extract text based on file type
    console.log(`  4️⃣ Extracting text...`);
    let extractedText = '';

    if (fileExtension === '.pdf' || fileExtension === 'pdf') {
      // Dynamic import with error handling for pdf-parse initialization bug
      // Import from lib/pdf-parse.js directly to avoid the buggy index.js debug code
      try {
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const pdfData = await pdfParse(fileBuffer);
        extractedText = pdfData.text;
        console.log(`  ✓ Extracted ${extractedText.length} characters from PDF`);
        console.log(`  ✓ PDF has ${pdfData.numpages} page(s)`);
      } catch (pdfError) {
        console.error(`  ❌ PDF parsing failed:`, pdfError.message);
        return {
          success: false,
          error: `PDF parsing not available: ${pdfError.message}. This is likely due to a pdf-parse library issue. Please use an alternative PDF viewer or contact support.`,
          file: {
            id: fileId,
            name: fileName,
            extension: fileExtension,
            size: fileSize,
            url: downloadUrl
          }
        };
      }

    } else if (fileExtension === '.docx' || fileExtension === 'docx') {
      // Dynamic import
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = result.value;
        console.log(`  ✓ Extracted ${extractedText.length} characters from DOCX`);
      } catch (docxError) {
        console.error(`  ❌ DOCX parsing failed:`, docxError.message);
        return {
          success: false,
          error: `DOCX parsing failed: ${docxError.message}`,
          file: {
            id: fileId,
            name: fileName,
            extension: fileExtension,
            size: fileSize,
            url: downloadUrl
          }
        };
      }

    } else if (fileExtension === '.txt' || fileExtension === 'txt' || fileExtension === '.md' || fileExtension === 'md') {
      // Plain text file
      extractedText = fileBuffer.toString('utf-8');
      console.log(`  ✓ Read ${extractedText.length} characters from text file`);

    } else {
      return {
        success: false,
        error: `Unsupported file type: ${fileExtension}. Supported types: PDF, DOCX, TXT`
      };
    }

    // Check if we actually got text
    if (!extractedText || extractedText.trim().length === 0) {
      return {
        success: false,
        error: 'File appears to be empty or contains no extractable text'
      };
    }

    console.log(`✓ Successfully read file ${fileName}`);
    console.log(`  Total characters extracted: ${extractedText.length}`);

    return {
      success: true,
      file: {
        id: fileId,
        name: fileName,
        extension: fileExtension,
        size: fileSize,
        type: file.type || '',
        hidden: file.hidden || false,
        access: file.access || 'PUBLIC'
      },
      content: extractedText,
      length: extractedText.length
    };

  } catch (error) {
    console.error('Read HubSpot file error:', error.message);

    // Provide helpful error messages
    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        error: 'Download timeout - file may be too large or connection is slow'
      };
    }

    if (error.response?.status === 404) {
      return {
        success: false,
        error: 'File not found or you do not have permission to access it'
      };
    }

    if (error.response?.status === 403) {
      return {
        success: false,
        error: 'Access denied - check that files.ui_hidden.read scope is enabled'
      };
    }

    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// CONSOLIDATED TOOLS (Phase 2 Optimization)
// These tools reduce multiple API calls into single operations
// ============================================================================

/**
 * Fuzzy match company name against HubSpot company records
 * Handles partial names, missing legal suffixes, acronyms, etc.
 * @param {string} userInput - Company name provided by user
 * @param {Array} companies - HubSpot company search results
 * @returns {Object} Best match with confidence score
 */
function fuzzyMatchCompany(userInput, companies) {
  if (!companies || companies.length === 0) {
    return { match: null, confidence: 0 };
  }

  const normalizeForMatching = (str) => {
    if (!str) return '';
    return str.toLowerCase()
      .replace(/\b(inc|corp|ltd|llc|corporation|society|association|co|company)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const userNormalized = normalizeForMatching(userInput);
  const userWords = new Set(userNormalized.split(' '));

  let bestMatch = null;
  let highestConfidence = 0;

  for (const company of companies) {
    const companyNormalized = normalizeForMatching(company.name);
    const companyWords = new Set(companyNormalized.split(' '));

    let confidence = 0;

    // Rule 1: Exact match (case insensitive, without legal suffix) = 100
    if (userNormalized === companyNormalized) {
      confidence = 100;
    }
    // Rule 2: Company name starts with user input = 90
    else if (companyNormalized.startsWith(userNormalized)) {
      confidence = 90;
    }
    // Rule 3: All user words present in company name = 80
    else if ([...userWords].every(word => companyWords.has(word))) {
      confidence = 80;
    }
    // Rule 4: Partial word overlap
    else {
      const overlap = [...userWords].filter(word => companyWords.has(word)).length;
      const totalWords = Math.max(userWords.size, companyWords.size);
      confidence = (overlap / totalWords) * 70;
    }

    if (confidence > highestConfidence) {
      highestConfidence = confidence;
      bestMatch = company;
    }
  }

  return { match: bestMatch, confidence: highestConfidence };
}

/**
 * Parse funding agreement content to extract key fields
 * Uses regex patterns to find project dates, categories, funding, markets
 * @param {string} content - Full document text
 * @returns {Object} Parsed fields
 */
function parseFundingAgreement(content) {
  const parsed = {
    project_period: null,
    approved_categories: [],
    approved_funding: null,
    target_markets: [],
    reimbursement_rate: null
  };

  if (!content) return parsed;

  // Extract project period
  const datePatterns = [
    /project\s+period[:\s]+(\w+\s+\d{1,2},\s+\d{4})\s*[-–to]+\s*(\w+\s+\d{1,2},\s+\d{4})/i,
    /start\s+date[:\s]+(\d{4}-\d{2}-\d{2}).*?end\s+date[:\s]+(\d{4}-\d{2}-\d{2})/is,
    /(\d{4}-\d{2}-\d{2})\s*[-–to]+\s*(\d{4}-\d{2}-\d{2})/
  ];

  for (const pattern of datePatterns) {
    const match = content.match(pattern);
    if (match) {
      parsed.project_period = {
        start: match[1],
        end: match[2]
      };
      break;
    }
  }

  // Extract approved categories (A-H pattern common in CanExport)
  const categoryPattern = /category\s+([A-H])[:\s-]/gi;
  const categoryMatches = content.matchAll(categoryPattern);
  for (const match of categoryMatches) {
    if (!parsed.approved_categories.includes(match[1].toUpperCase())) {
      parsed.approved_categories.push(match[1].toUpperCase());
    }
  }

  // Extract approved funding
  const fundingPatterns = [
    /approved\s+funding[:\s]+\$?([\d,]+)/i,
    /total\s+funding[:\s]+\$?([\d,]+)/i,
    /reimbursement[:\s]+\$?([\d,]+)/i
  ];

  for (const pattern of fundingPatterns) {
    const match = content.match(pattern);
    if (match) {
      parsed.approved_funding = `$${match[1]}`;
      break;
    }
  }

  // Extract target markets (countries)
  const marketPattern = /target\s+market[s]?[:\s]+([^.\n]+)/i;
  const marketMatch = content.match(marketPattern);
  if (marketMatch) {
    parsed.target_markets = marketMatch[1]
      .split(/[,;]/)
      .map(m => m.trim())
      .filter(m => m.length > 0);
  }

  // Extract reimbursement rate
  const ratePattern = /(\d{1,3})%\s+reimbursement/i;
  const rateMatch = content.match(ratePattern);
  if (rateMatch) {
    parsed.reimbursement_rate = `${rateMatch[1]}%`;
  }

  return parsed;
}

/**
 * Load complete company context in one consolidated call
 * Replaces: searchGrantApplications + getGrantApplication + getProjectEmailHistory
 *
 * @param {Object} params - Search parameters
 * @param {string} params.company_name - Company name (fuzzy matching supported)
 * @param {string} [params.grant_program] - Filter by grant program (CanExport, ETG, BCAFE)
 * @param {boolean} [params.include_emails=true] - Include email summary for context
 * @param {number} [params.email_limit=20] - Number of recent emails to analyze
 * @param {boolean} [params.load_funding_agreement=false] - Auto-load funding agreement
 * @param {string} [params.agent_type] - Agent type for field selection
 * @returns {Object} Complete company context
 */
export async function loadCompanyContext({
  company_name,
  grant_program = null,
  include_emails = true,
  email_limit = 20,
  load_funding_agreement = false,
  agent_type = null
}) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 CONSOLIDATED TOOL: load_company_context`);
  console.log(`   Company: "${company_name}"`);
  console.log(`   Grant Program: ${grant_program || 'any'}`);
  console.log(`   Include Emails: ${include_emails}`);
  console.log(`   Load FA: ${load_funding_agreement}`);
  console.log('='.repeat(80));

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    // STEP 1: Fuzzy company search
    console.log(`\n📍 STEP 1: Searching for company "${company_name}"...`);
    const companySearchResult = await searchHubSpotCompanies(company_name);

    if (!companySearchResult.success || companySearchResult.companies.length === 0) {
      console.log(`❌ No companies found matching "${company_name}"`);
      return {
        success: false,
        error: `No companies found matching "${company_name}"`
      };
    }

    // Apply fuzzy matching to find best match
    const { match: bestCompany, confidence } = fuzzyMatchCompany(
      company_name,
      companySearchResult.companies
    );

    console.log(`✓ Found ${companySearchResult.companies.length} company matches`);
    console.log(`  Best match: "${bestCompany.name}" (${confidence}% confidence)`);

    // STEP 2: Search grant applications for this company
    console.log(`\n📍 STEP 2: Searching grant applications...`);

    // 🔍 DIAGNOSTIC: First search without grant_program filter to see ALL deals
    console.log(`\n🔍 DIAGNOSTIC: Searching for ALL deals for "${bestCompany.name}" (no grant filter)...`);
    const diagnosticResult = await searchGrantApplications(
      {
        company_name: bestCompany.name
      },
      agent_type
    );

    if (diagnosticResult.success && diagnosticResult.applications.length > 0) {
      console.log(`🔍 FOUND ${diagnosticResult.applications.length} total deal(s) for "${bestCompany.name}"`);
      console.log(`🔍 Sample deal data:`);
      diagnosticResult.applications.slice(0, 3).forEach((app, i) => {
        console.log(`   Deal ${i + 1}:`);
        console.log(`     - ID: ${app.id}`);
        console.log(`     - Name: ${app.name}`);
        console.log(`     - Company Name (property): "${app.companyName}"`);
        console.log(`     - Grant Type: "${app.program}"`);
        console.log(`     - Status: ${app.status}`);
      });
    } else {
      console.log(`🔍 NO DEALS FOUND for "${bestCompany.name}" (even without grant filter)`);
      console.log(`🔍 This suggests the company_name property doesn't match "${bestCompany.name}"`);
    }

    // Now do the actual filtered search
    const applicationsResult = await searchGrantApplications(
      {
        grant_program,
        company_name: bestCompany.name // Use exact HubSpot name
      },
      agent_type
    );

    if (!applicationsResult.success || applicationsResult.applications.length === 0) {
      console.log(`⚠️  No grant applications found for "${bestCompany.name}" with grant_program="${grant_program}"`);
      return {
        success: true,
        company: bestCompany,
        applications: [],
        message: `Found company but no grant applications${grant_program ? ` for ${grant_program}` : ''}`
      };
    }

    console.log(`✓ Found ${applicationsResult.applications.length} grant application(s)`);

    // STEP 3: Load full details for each application
    console.log(`\n📍 STEP 3: Loading application details...`);
    const detailedApplications = [];

    for (const app of applicationsResult.applications) {
      const appDetails = await getGrantApplication(app.id, agent_type);
      if (appDetails.success) {
        // Merge application data with associations
        detailedApplications.push({
          deal_id: app.id,
          ...appDetails.application,
          contacts: appDetails.associations?.contacts?.results || [],
          companies: appDetails.associations?.companies?.results || []
        });
      }
    }

    console.log(`✓ Loaded details for ${detailedApplications.length} application(s)`);

    // STEP 4: Load email history for primary application (if requested)
    let emailSummary = null;
    if (include_emails && detailedApplications.length > 0) {
      console.log(`\n📍 STEP 4: Loading email history...`);
      const primaryDealId = detailedApplications[0].deal_id;

      const emailHistory = await getProjectEmailHistory(primaryDealId, email_limit);
      if (emailHistory.success && emailHistory.emails.length > 0) {
        const emails = emailHistory.emails;

        // Calculate summary statistics
        const inboundCount = emails.filter(e => e.direction === 'INBOUND').length;
        const outboundCount = emails.filter(e => e.direction === 'OUTBOUND').length;

        // Extract recent topics from email subjects
        const recentTopics = emails
          .slice(0, 5)
          .map(e => e.subject)
          .filter(s => s && s.length > 0);

        emailSummary = {
          total: emails.length,
          inbound: inboundCount,
          outbound: outboundCount,
          most_recent: emails[0] ? {
            date: emails[0].timestamp,
            subject: emails[0].subject,
            from: emails[0].from,
            email_id: emails[0].id
          } : null,
          recent_topics: recentTopics
        };

        console.log(`✓ Loaded ${emails.length} emails (${inboundCount} in, ${outboundCount} out)`);
      } else {
        console.log(`ℹ️  No email history found`);
      }
    }

    // STEP 5: Load funding agreement (if requested)
    let fundingAgreement = null;
    if (load_funding_agreement && detailedApplications.length > 0) {
      console.log(`\n📍 STEP 5: Loading funding agreement...`);
      const primaryDealId = detailedApplications[0].deal_id;

      const faResult = await findAndReadFundingAgreement({
        deal_id: primaryDealId,
        agent_type
      });

      if (faResult.success) {
        fundingAgreement = faResult;
        console.log(`✓ Loaded funding agreement: ${faResult.file.name}`);
      } else {
        console.log(`⚠️  Could not load funding agreement: ${faResult.error}`);
      }
    }

    // Build final response
    const response = {
      success: true,
      company: bestCompany,
      applications: detailedApplications,
      match_confidence: confidence
    };

    if (emailSummary) {
      response.email_summary = emailSummary;
    }

    if (fundingAgreement) {
      response.funding_agreement = fundingAgreement;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ CONSOLIDATED CONTEXT LOADED SUCCESSFULLY`);
    console.log(`   Company: ${bestCompany.name}`);
    console.log(`   Applications: ${detailedApplications.length}`);
    console.log(`   Emails: ${emailSummary ? emailSummary.total : 'not loaded'}`);
    console.log(`   Funding Agreement: ${fundingAgreement ? 'loaded' : 'not loaded'}`);
    console.log('='.repeat(80) + '\n');

    return response;

  } catch (error) {
    console.error('❌ load_company_context error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Find and read funding agreement automatically
 * Replaces: searchProjectEmails + getEmailDetails + searchHubSpotContacts + getContactFiles + readHubSpotFile
 *
 * @param {Object} params - Search parameters
 * @param {string} [params.deal_id] - HubSpot deal ID (if known)
 * @param {string} [params.company_name] - Company name (will find deal first)
 * @param {string} [params.grant_program] - Grant program filter
 * @param {boolean} [params.return_content=true] - Return full document content
 * @param {number} [params.max_content_length=50000] - Maximum content length
 * @param {boolean} [params.parse_fields=true] - Extract key fields from document
 * @param {string} [params.agent_type] - Agent type for field selection
 * @returns {Object} Funding agreement with metadata and content
 */
export async function findAndReadFundingAgreement({
  deal_id = null,
  company_name = null,
  grant_program = null,
  return_content = true,
  max_content_length = 50000,
  parse_fields = true,
  agent_type = null
}) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 CONSOLIDATED TOOL: find_and_read_funding_agreement`);
  console.log(`   Deal ID: ${deal_id || 'not provided'}`);
  console.log(`   Company: ${company_name || 'not provided'}`);
  console.log('='.repeat(80));

  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    // STEP 1: If company_name provided, find deal_id first
    if (!deal_id && company_name) {
      console.log(`\n📍 STEP 1: Finding deal for company "${company_name}"...`);
      const context = await loadCompanyContext({
        company_name,
        grant_program,
        include_emails: false,
        load_funding_agreement: false,
        agent_type
      });

      if (!context.success || !context.applications || context.applications.length === 0) {
        return {
          success: false,
          error: `Could not find grant application for company "${company_name}"`
        };
      }

      deal_id = context.applications[0].deal_id;
      console.log(`✓ Found deal ID: ${deal_id}`);
    }

    if (!deal_id) {
      return {
        success: false,
        error: 'Either deal_id or company_name must be provided'
      };
    }

    // STEP 2: Search emails for funding agreement reference
    console.log(`\n📍 STEP 2: Searching emails for funding agreement...`);
    const emailSearchResult = await searchProjectEmails(
      deal_id,
      'funding agreement',
      10
    );

    if (!emailSearchResult.success || emailSearchResult.emails.length === 0) {
      console.log(`⚠️  No emails found mentioning "funding agreement"`);

      // Fallback: Try to find in deal files directly
      console.log(`\n📍 FALLBACK: Checking deal files...`);
      const dealFilesResult = await getDealFiles(deal_id);

      if (dealFilesResult.success && dealFilesResult.files.length > 0) {
        const faFile = dealFilesResult.files.find(f =>
          f.name.toLowerCase().includes('funding') &&
          (f.name.toLowerCase().includes('agreement') || f.name.toLowerCase().includes('contract'))
        );

        if (faFile) {
          console.log(`✓ Found funding agreement in deal files: ${faFile.name}`);
          const fileContent = await readHubSpotFile(faFile.id);

          if (fileContent.success) {
            const response = {
              success: true,
              file: fileContent.file,
              discovery_path: 'deal_file'
            };

            if (return_content) {
              response.content = fileContent.content.substring(0, max_content_length);
            }

            if (parse_fields && fileContent.content) {
              response.parsed_fields = parseFundingAgreement(fileContent.content);
            }

            return response;
          }
        }
      }

      return {
        success: false,
        error: 'Funding agreement not found in emails or deal files'
      };
    }

    console.log(`✓ Found ${emailSearchResult.emails.length} email(s) mentioning funding agreement`);

    // STEP 3: Get email details to find file ID
    console.log(`\n📍 STEP 3: Checking email for file links...`);
    const primaryEmail = emailSearchResult.emails[0];
    const emailDetails = await getEmailDetails(primaryEmail.id);

    if (!emailDetails.success) {
      return {
        success: false,
        error: 'Could not retrieve email details'
      };
    }

    // STEP 4: Extract file ID from email HTML body
    let fileId = null;
    let discoveryPath = null;

    if (emailDetails.email.htmlBody) {
      const fileIdMatch = emailDetails.email.htmlBody.match(/file[\/:](\d+)/);
      if (fileIdMatch) {
        fileId = fileIdMatch[1];
        discoveryPath = 'email_html';
        console.log(`✓ Found file ID in email HTML: ${fileId}`);
      }
    }

    // STEP 5: If no file ID in email, search sender's contact files
    if (!fileId) {
      console.log(`\n📍 STEP 5: Searching sender's contact files...`);
      const senderEmail = emailDetails.email.from;

      if (!senderEmail) {
        return {
          success: false,
          error: 'Could not identify email sender'
        };
      }

      const contactSearchResult = await searchHubSpotContacts(senderEmail, 1);

      if (!contactSearchResult.success || contactSearchResult.contacts.length === 0) {
        return {
          success: false,
          error: `Could not find contact record for sender: ${senderEmail}`
        };
      }

      const senderId = contactSearchResult.contacts[0].id;
      console.log(`✓ Found sender contact: ${senderId}`);

      const contactFilesResult = await getContactFiles(senderId);

      if (!contactFilesResult.success || contactFilesResult.files.length === 0) {
        return {
          success: false,
          error: 'No files found in sender\'s contact record'
        };
      }

      // Find funding agreement file
      const faFile = contactFilesResult.files.find(f =>
        f.name.toLowerCase().includes('funding') ||
        f.name.toLowerCase().includes('agreement') ||
        f.name.toLowerCase().includes('contract')
      );

      if (!faFile) {
        return {
          success: false,
          error: 'Funding agreement not found in sender\'s files'
        };
      }

      fileId = faFile.id;
      discoveryPath = 'contact_file';
      console.log(`✓ Found funding agreement in contact files: ${faFile.name}`);
    }

    // STEP 6: Read the file
    console.log(`\n📍 STEP 6: Reading file content...`);
    const fileContent = await readHubSpotFile(fileId);

    if (!fileContent.success) {
      return {
        success: false,
        error: `Could not read file: ${fileContent.error}`
      };
    }

    console.log(`✓ Read ${fileContent.length} characters from ${fileContent.file.name}`);

    // Build response
    const response = {
      success: true,
      file: fileContent.file,
      discovery_path: discoveryPath,
      source_email_id: primaryEmail.id
    };

    if (return_content) {
      response.content = fileContent.content.substring(0, max_content_length);
    }

    if (parse_fields && fileContent.content) {
      console.log(`\n📍 PARSING: Extracting key fields...`);
      response.parsed_fields = parseFundingAgreement(fileContent.content);
      console.log(`  Parsed fields:`, response.parsed_fields);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ FUNDING AGREEMENT LOADED SUCCESSFULLY`);
    console.log(`   File: ${fileContent.file.name}`);
    console.log(`   Discovery: ${discoveryPath}`);
    console.log(`   Size: ${fileContent.length} characters`);
    console.log('='.repeat(80) + '\n');

    return response;

  } catch (error) {
    console.error('❌ find_and_read_funding_agreement error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get notes associated with a HubSpot record (company, contact, or deal)
 * @param {string} objectType - Type of record ('companies', 'contacts', 'deals')
 * @param {string} recordId - ID of the record
 * @param {number} limit - Maximum number of notes to return (default: 20)
 * @returns {Object} List of notes with their details
 */
export async function getHubSpotNotes(objectType, recordId, limit = 20) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    console.log(`📝 Getting notes for ${objectType}/${recordId}...`);

    // Step 1: Get note IDs associated with the record using Associations API v4
    const associationsResponse = await client.get(`/crm/v4/objects/${objectType}/${recordId}/associations/notes`);

    if (!associationsResponse.data.results || associationsResponse.data.results.length === 0) {
      console.log(`ℹ️  No notes found for ${objectType}/${recordId}`);
      return {
        success: true,
        notes: [],
        count: 0
      };
    }

    const noteIds = associationsResponse.data.results.map(result => result.toObjectId).slice(0, limit);
    console.log(`✓ Found ${noteIds.length} note(s) associated with ${objectType}/${recordId}`);

    // Step 2: Batch fetch note details
    const notesResponse = await client.post('/crm/v3/objects/notes/batch/read', {
      properties: [
        'hs_note_body',
        'hs_timestamp',
        'hs_created_by',
        'hs_lastmodifieddate',
        'hubspot_owner_id',
        'hs_attachment_ids'
      ],
      inputs: noteIds.map(id => ({ id }))
    });

    // Format the notes for easy reading
    const notes = notesResponse.data.results.map(note => ({
      id: note.id,
      body: note.properties.hs_note_body || '',
      timestamp: note.properties.hs_timestamp || note.properties.hs_lastmodifieddate,
      created_by_id: note.properties.hs_created_by,
      owner_id: note.properties.hubspot_owner_id,
      has_attachments: !!note.properties.hs_attachment_ids,
      created_at: note.createdAt,
      updated_at: note.updatedAt
    }));

    // Sort by timestamp descending (most recent first)
    notes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log(`✓ Retrieved ${notes.length} note(s)`);

    return {
      success: true,
      notes,
      count: notes.length,
      object_type: objectType,
      record_id: recordId
    };

  } catch (error) {
    console.error('Get HubSpot notes error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// PROGRAM STATS & DEAL COUNT
// Aggregate-level reporting tools used by the marketing skill for traceable
// stat citations. Both tools validate program names against the live
// grant_type enum and return structured errors (not silent 0%) on mismatch.
// ============================================================================

const GRANT_PIPELINES = {
  hiring: '2662913',
  training: '2662912',
  market_expansion: '10188292',
  misc: '26501516',
  starter_hiring: '48715861',
  starter_training: '48715862'
};

const ALL_GRANT_PIPELINE_IDS = Object.values(GRANT_PIPELINES);
const STARTER_PIPELINE_IDS = [GRANT_PIPELINES.starter_hiring, GRANT_PIPELINES.starter_training];
const MAIN_PIPELINE_IDS = ALL_GRANT_PIPELINE_IDS.filter(id => !STARTER_PIPELINE_IDS.includes(id));

// Include both canonical internal value (`Won`) per DEAL_CREATION skill and the
// legacy display-prefixed value (`Invoice Sent (Won)`) used elsewhere in this
// file, so aggregation is resilient to whichever the portal actually stores.
const SUCCESS_STATES = ['Won', 'Invoice Sent (Won)', 'Invoice Paid', 'Invoice Cleared', 'Retainer Sent', 'Retainer Paid'];
const FAILURE_STATES = ['Lost'];
const PENDING_STATES = ['Open', 'Abandoned', 'Suspended'];

let GRANT_TYPE_ENUM_CACHE = null;
let GRANT_TYPE_ENUM_FETCHED_AT = 0;
const GRANT_TYPE_ENUM_TTL_MS = 60 * 60 * 1000;

async function fetchGrantTypeEnum(client) {
  const now = Date.now();
  if (GRANT_TYPE_ENUM_CACHE && (now - GRANT_TYPE_ENUM_FETCHED_AT) < GRANT_TYPE_ENUM_TTL_MS) {
    return GRANT_TYPE_ENUM_CACHE;
  }
  const response = await client.get('/crm/v3/properties/deals/grant_type');
  const options = response.data?.options || [];
  GRANT_TYPE_ENUM_CACHE = options.map(opt => opt.value);
  GRANT_TYPE_ENUM_FETCHED_AT = now;
  console.log(`  Cached grant_type enum: ${GRANT_TYPE_ENUM_CACHE.length} values`);
  return GRANT_TYPE_ENUM_CACHE;
}

async function fetchAllMatchingDeals(client, { grantType, pipelineIds, extraFilters = [], properties, maxResults = 5000 }) {
  const allDeals = [];
  let after;
  const limit = 100;
  const maxPages = Math.ceil(maxResults / limit);
  let pageCount = 0;

  while (pageCount < maxPages) {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'grant_type', operator: 'EQ', value: grantType },
          { propertyName: 'pipeline', operator: 'IN', values: pipelineIds },
          ...extraFilters
        ]
      }],
      properties,
      limit,
      ...(after ? { after } : {})
    };

    const response = await client.post('/crm/v3/objects/deals/search', body);
    const results = response.data?.results || [];
    allDeals.push(...results);

    after = response.data?.paging?.next?.after;
    pageCount++;
    if (!after) break;
  }

  return allDeals;
}

/**
 * Get aggregate stats for a grant program based on HubSpot deal history.
 * Counts Won + downstream states (Invoice Paid/Cleared, Retainer Sent/Paid) as successes.
 * success_rate denominator = won + lost (pending deals excluded from rate).
 *
 * @param {string} programName - exact grant_type enum value (e.g., "ETG - BC", "CanExport")
 * @param {Object} options
 * @param {boolean} options.include_starter - include Granted Starter pipelines (default true)
 * @returns {Object} stats with confidence band, or structured error on invalid program
 */
export async function getProgramStats(programName, { include_starter = true } = {}) {
  if (!HUBSPOT_TOKEN) {
    return { success: false, error: 'HubSpot access token not configured' };
  }

  if (!programName || typeof programName !== 'string') {
    return { success: false, error: 'program_name is required and must be a string' };
  }

  try {
    const client = createHubSpotClient();
    console.log(`📊 get_program_stats: program="${programName}", include_starter=${include_starter}`);

    const enumValues = await fetchGrantTypeEnum(client);
    if (!enumValues.includes(programName)) {
      console.warn(`⚠️  Unknown program name: "${programName}" — not in grant_type enum`);
      return {
        success: false,
        error: `Unknown program name: "${programName}". Not a valid grant_type enum value.`,
        program: programName,
        valid_examples: enumValues.slice(0, 10)
      };
    }

    const pipelineIds = include_starter ? ALL_GRANT_PIPELINE_IDS : MAIN_PIPELINE_IDS;
    const deals = await fetchAllMatchingDeals(client, {
      grantType: programName,
      pipelineIds,
      properties: ['dealname', 'state', 'createdate', 'closedate', 'grant_type', 'pipeline']
    });

    console.log(`  Found ${deals.length} deal(s) for "${programName}"`);

    let wonCount = 0;
    let lostCount = 0;
    let pendingCount = 0;
    const dealDurations = [];
    let minCreate = null;
    let maxCreate = null;

    for (const deal of deals) {
      const state = deal.properties.state;
      const createdate = deal.properties.createdate;
      const closedate = deal.properties.closedate;

      if (SUCCESS_STATES.includes(state)) wonCount++;
      else if (FAILURE_STATES.includes(state)) lostCount++;
      else pendingCount++;

      if (createdate) {
        const d = new Date(createdate);
        if (!minCreate || d < minCreate) minCreate = d;
        if (!maxCreate || d > maxCreate) maxCreate = d;
      }

      if (createdate && closedate &&
          (SUCCESS_STATES.includes(state) || FAILURE_STATES.includes(state))) {
        const days = (new Date(closedate) - new Date(createdate)) / (1000 * 60 * 60 * 24);
        if (days >= 0) dealDurations.push(days);
      }
    }

    const sampleSize = deals.length;

    let confidence;
    if (sampleSize < 5) confidence = 'insufficient_data';
    else if (sampleSize < 15) confidence = 'low';
    else if (sampleSize < 50) confidence = 'medium';
    else confidence = 'high';

    let successRate = null;
    if (confidence !== 'insufficient_data' && (wonCount + lostCount) > 0) {
      successRate = Math.round((wonCount / (wonCount + lostCount)) * 1000) / 1000;
    }

    const avgDealDays = dealDurations.length > 0
      ? Math.round((dealDurations.reduce((a, b) => a + b, 0) / dealDurations.length) * 10) / 10
      : null;

    const result = {
      success: true,
      program: programName,
      success_rate: successRate,
      sample_size: sampleSize,
      won_count: wonCount,
      lost_count: lostCount,
      pending_count: pendingCount,
      avg_deal_days: avgDealDays,
      date_range_start: minCreate ? minCreate.toISOString().split('T')[0] : null,
      date_range_end: maxCreate ? maxCreate.toISOString().split('T')[0] : null,
      last_updated: new Date().toISOString(),
      confidence,
      include_starter,
      source: 'HubSpot'
    };

    console.log(`✓ get_program_stats: won=${wonCount} lost=${lostCount} pending=${pendingCount} confidence=${confidence}`);
    return result;

  } catch (error) {
    console.error('get_program_stats error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      program: programName
    };
  }
}

/**
 * Count deals on a grant program within a time window.
 *
 * @param {string} programName - exact grant_type enum value
 * @param {Object} options
 * @param {number} options.date_range_months - lookback window in months (default 12)
 * @param {boolean} options.include_starter - include Granted Starter pipelines (default true)
 * @returns {Object} count and metadata, or structured error on invalid program
 */
export async function getDealCount(programName, { date_range_months = 12, include_starter = true } = {}) {
  if (!HUBSPOT_TOKEN) {
    return { success: false, error: 'HubSpot access token not configured' };
  }

  if (!programName || typeof programName !== 'string') {
    return { success: false, error: 'program_name is required and must be a string' };
  }

  if (!Number.isFinite(date_range_months) || date_range_months <= 0) {
    return { success: false, error: 'date_range_months must be a positive number' };
  }

  try {
    const client = createHubSpotClient();
    console.log(`📊 get_deal_count: program="${programName}", months=${date_range_months}, include_starter=${include_starter}`);

    const enumValues = await fetchGrantTypeEnum(client);
    if (!enumValues.includes(programName)) {
      console.warn(`⚠️  Unknown program name: "${programName}"`);
      return {
        success: false,
        error: `Unknown program name: "${programName}". Not a valid grant_type enum value.`,
        program: programName,
        valid_examples: enumValues.slice(0, 10)
      };
    }

    const pipelineIds = include_starter ? ALL_GRANT_PIPELINE_IDS : MAIN_PIPELINE_IDS;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - date_range_months);

    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'grant_type', operator: 'EQ', value: programName },
          { propertyName: 'pipeline', operator: 'IN', values: pipelineIds },
          { propertyName: 'createdate', operator: 'GTE', value: String(cutoff.getTime()) }
        ]
      }],
      limit: 1,
      properties: ['dealname']
    };

    const response = await client.post('/crm/v3/objects/deals/search', body);
    const count = response.data?.total ?? 0;

    console.log(`✓ get_deal_count: ${count} deal(s) in last ${date_range_months} month(s)`);

    return {
      success: true,
      program: programName,
      count,
      date_range_months,
      include_starter,
      as_of: new Date().toISOString(),
      source: 'HubSpot'
    };

  } catch (error) {
    console.error('get_deal_count error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      program: programName
    };
  }
}

// ============================================================================
// search_recent_wins
//
// Wraps searchGrantApplications + (conditional) batch company-association +
// batch company-properties reads to return marketing-shaped won deals.
// Bounded latency: 2 HubSpot calls without industry filter, 4 with.
// Schema lives in src/tools/definitions.js (ORACLE_TOOLS).
// ============================================================================

const RECENT_WINS_DEFAULT_DAYS = 90;
const RECENT_WINS_DEFAULT_LIMIT = 10;
const RECENT_WINS_MAX_LIMIT = 25;

function recentWinsWindowStart(days, today = new Date()) {
  const ms = today.getTime() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD for closedate_after
}

export async function searchRecentWins({ days, program, industry, limit } = {}) {
  const effectiveDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : RECENT_WINS_DEFAULT_DAYS;
  let effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RECENT_WINS_DEFAULT_LIMIT;
  if (effectiveLimit > RECENT_WINS_MAX_LIMIT) effectiveLimit = RECENT_WINS_MAX_LIMIT;

  const windowStart = recentWinsWindowStart(effectiveDays);

  console.log(`   🏆 search_recent_wins: window=${windowStart} program=${program || 'any'} industry=${industry || 'any'} limit=${effectiveLimit}`);

  // Step 1: search won deals via existing tool
  const dealFilters = {
    status: 'won',
    closedate_after: windowStart,
    limit: effectiveLimit
  };
  if (program) dealFilters.grant_program = program;

  const dealResult = await searchGrantApplications(dealFilters);
  if (!dealResult.success) {
    return {
      success: false,
      error: dealResult.error || 'Deal search failed',
      query: { days: effectiveDays, program, industry, limit: effectiveLimit },
      window_start: windowStart,
      wins: []
    };
  }

  let apps = dealResult.applications || [];

  // Step 2 (conditional): industry filter via batch association + batch company read.
  // Hoisted maps so the industry data is also available for output enrichment.
  let dealToCompany = new Map();
  let companyIndustry = new Map();
  if (industry && apps.length > 0) {
    try {
      const client = createHubSpotClient();
      const dealIds = apps.map(a => a.id).filter(Boolean);

      const assocResp = await client.post(
        '/crm/v4/associations/deals/companies/batch/read',
        { inputs: dealIds.map(id => ({ id })) }
      );
      for (const r of assocResp.data?.results || []) {
        const dealId = r.from?.id;
        const firstCompany = r.to?.[0]?.toObjectId;
        if (dealId && firstCompany) dealToCompany.set(String(dealId), String(firstCompany));
      }

      const uniqueCompanyIds = Array.from(new Set(dealToCompany.values()));
      if (uniqueCompanyIds.length > 0) {
        const companiesResp = await client.post(
          '/crm/v3/objects/companies/batch/read',
          {
            properties: ['industry', 'name'],
            inputs: uniqueCompanyIds.map(id => ({ id }))
          }
        );
        for (const c of companiesResp.data?.results || []) {
          companyIndustry.set(String(c.id), c.properties?.industry || '');
        }
      }

      const wantedLower = industry.toLowerCase();
      apps = apps.filter(a => {
        const cId = dealToCompany.get(String(a.id));
        if (!cId) return false;
        const ind = (companyIndustry.get(cId) || '').toLowerCase();
        return ind.includes(wantedLower);
      });
    } catch (err) {
      console.error('search_recent_wins industry-filter error:', err.message);
      return {
        success: false,
        error: `Industry filter failed: ${err.message}`,
        query: { days: effectiveDays, program, industry, limit: effectiveLimit },
        window_start: windowStart,
        wins: []
      };
    }
  }

  // Step 3: resolve consultant names via one owners-list call
  const ownerMap = new Map();
  try {
    const ownersResult = await listHubSpotOwners();
    if (ownersResult.success) {
      for (const o of ownersResult.owners) {
        ownerMap.set(String(o.id), o.fullName || o.email || String(o.id));
      }
    }
  } catch (err) {
    console.warn('search_recent_wins owner-resolve warning:', err.message);
    // Continue with raw IDs if owner lookup fails.
  }

  // Step 4: slim to marketing shape. Industry field only populated when the
  // industry filter ran (otherwise we don't know it without extra HubSpot calls).
  const wins = apps.map(a => {
    const win = {
      company_name: a.companyName || a.name || '',
      program: a.program || '',
      deal_amount: a.approvedFunding ? Number(a.approvedFunding) : null,
      won_date: a.closeDate || '',
      consultant: ownerMap.get(String(a.ownerId)) || null
    };
    if (industry) {
      const cId = dealToCompany.get(String(a.id));
      win.industry = cId ? (companyIndustry.get(cId) || '') : '';
    }
    return win;
  });

  return {
    success: true,
    count: wins.length,
    query: { days: effectiveDays, program, industry, limit: effectiveLimit },
    window_start: windowStart,
    wins
  };
}
