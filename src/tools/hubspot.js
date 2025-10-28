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
  'candidate___name__job_title___email',  // Candidate info
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
export async function searchHubSpotContacts(query, limit = 10) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      contacts: []
    };
  }

  try {
    const client = createHubSpotClient();

    const response = await client.post('/crm/v3/objects/contacts/search', {
      filterGroups: [
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
      ],
      properties: [
        'email',
        'firstname',
        'lastname',
        'phone',
        'company',
        'jobtitle',
        'city',
        'state',
        'country'
      ],
      limit: Math.min(limit, 100)
    });

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
        ].filter(Boolean).join(', ')
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
 * Search HubSpot companies
 * @param {string} query - Search query (name, domain, industry)
 * @param {number|null} minRevenue - Minimum annual revenue filter
 * @param {number|null} maxRevenue - Maximum annual revenue filter
 * @returns {Object} Search results
 */
export async function searchHubSpotCompanies(query, minRevenue = null, maxRevenue = null) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      companies: []
    };
  }

  try {
    const client = createHubSpotClient();

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

    // Add revenue filters if provided
    if (minRevenue !== null || maxRevenue !== null) {
      const revenueFilters = [];

      if (minRevenue !== null) {
        revenueFilters.push({
          propertyName: 'annualrevenue',
          operator: 'GTE',
          value: minRevenue.toString()
        });
      }

      if (maxRevenue !== null) {
        revenueFilters.push({
          propertyName: 'annualrevenue',
          operator: 'LTE',
          value: maxRevenue.toString()
        });
      }

      // Apply revenue filter to all filter groups (AND condition)
      filterGroups.forEach(group => {
        group.filters.push(...revenueFilters);
      });
    }

    const response = await client.post('/crm/v3/objects/companies/search', {
      filterGroups,
      properties: [
        'name', 'domain', 'industry', 'city', 'state', 'country',
        'numberofemployees', 'annualrevenue', 'description'
      ],
      limit: 10
    });

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
        description: company.properties.description
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

/**
 * Search grant applications (deals in HubSpot)
 * @param {string|null} grantProgram - Filter by grant program type (e.g., "CanExport", "ETG", "BCAFE")
 * @param {string|null} status - Filter by application status (e.g., "approved", "submitted", "open")
 * @param {string|null} companyName - Filter by company name
 * @param {string|null} agentType - Agent type for field selection
 * @returns {Object} Search results
 */
export async function searchGrantApplications(grantProgram = null, status = null, companyName = null, agentType = null) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured',
      applications: []
    };
  }

  try {
    const client = createHubSpotClient();

    const filters = [];

    // Filter by grant program if specified
    // Maps common terms to HubSpot grant_type values
    if (grantProgram) {
      const normalizedProgram = grantProgram.toLowerCase().trim();

      // For partial matching, just search for the key term
      // HubSpot CONTAINS_TOKEN works with individual words
      let searchTerm = grantProgram;

      // Map common short forms to searchable terms
      if (normalizedProgram === 'etg') {
        searchTerm = 'ETG';
      } else if (normalizedProgram === 'bcafe' || normalizedProgram === 'bc mdp') {
        searchTerm = 'BCAFE';
      } else if (normalizedProgram === 'csjg') {
        searchTerm = 'CSJG';
      } else if (normalizedProgram === 'csj') {
        searchTerm = 'CSJ';
      } else if (normalizedProgram.includes('canexport') || normalizedProgram === 'canex') {
        searchTerm = 'CanExport';
      }

      // Use CONTAINS_TOKEN for flexible word matching
      filters.push({
        propertyName: 'grant_type',
        operator: 'CONTAINS_TOKEN',
        value: searchTerm
      });
    }

    // Filter by status if specified
    // Maps common status terms to HubSpot field values
    if (status) {
      const statusLower = status.toLowerCase().trim();

      if (statusLower.includes('approv')) {
        // Filter by approved_on field being set (not null)
        filters.push({
          propertyName: 'approved_on',
          operator: 'HAS_PROPERTY'
        });
      } else if (statusLower.includes('submit')) {
        // Filter by application_submitted_on being set
        filters.push({
          propertyName: 'application_submitted_on',
          operator: 'HAS_PROPERTY'
        });
      } else if (statusLower.includes('won') || statusLower.includes('invoice')) {
        // Filter by state = Invoice Sent (Won)
        filters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Invoice Sent (Won)'
        });
      } else if (statusLower.includes('open')) {
        // Filter by state = Open
        filters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Open'
        });
      } else if (statusLower.includes('lost')) {
        filters.push({
          propertyName: 'state',
          operator: 'EQ',
          value: 'Lost'
        });
      } else {
        // Try as dealstage value
        filters.push({
          propertyName: 'dealstage',
          operator: 'EQ',
          value: status
        });
      }
    }

    // Filter by company name if specified
    if (companyName) {
      filters.push({
        propertyName: 'company_name',
        operator: 'CONTAINS_TOKEN',
        value: companyName
      });
    }

    // Get agent-specific fields
    const properties = getFieldsForAgent(agentType);
    console.log(`  Agent type: ${agentType || 'default'}, using ${properties.length} HubSpot properties`);

    const searchBody = {
      filterGroups: filters.length > 0 ? [{ filters }] : [],
      properties,
      limit: 50,
      sorts: [
        {
          propertyName: 'createdate',
          direction: 'DESCENDING'
        }
      ]
    };

    console.log('🔍 HubSpot search query:', JSON.stringify({ filters: searchBody.filterGroups }, null, 2));

    const response = await client.post('/crm/v3/objects/deals/search', searchBody);

    console.log(`✓ HubSpot grant applications search: found ${response.data.results.length} results`);

    // Log some sample grant_type values if we got results
    if (response.data.results.length > 0 && grantProgram) {
      const sampleTypes = response.data.results.slice(0, 3).map(d => d.properties.grant_type);
      console.log(`  Sample grant_type values: ${sampleTypes.join(', ')}`);
    }

    return {
      success: true,
      count: response.data.results.length,
      applications: response.data.results.map(deal => {
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
        if (deal.properties.candidate___name__job_title___email) {
          app.candidateInfo = deal.properties.candidate___name__job_title___email;
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

    // Use Search API to find all emails associated with the deal
    // This includes emails in the activity timeline, not just direct associations
    const searchResponse = await client.post('/crm/v3/objects/emails/search', {
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
      limit: Math.min(limit, 100) // HubSpot max is 100
    });

    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      console.log(`ℹ️  No emails found for deal ${dealId} (checked activity timeline)`);
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

    // Format email results
    const emails = searchResponse.data.results.map(email => ({
      id: email.id,
      subject: email.properties.hs_email_subject || '(No Subject)',
      textBody: email.properties.hs_email_text || '',
      timestamp: email.properties.hs_timestamp || email.createdAt,
      from: email.properties.hs_email_from || '',
      to: email.properties.hs_email_to || '',
      direction: email.properties.hs_email_direction || '',
      hasAttachments: !!(email.properties.hs_attachment_ids)
    }));

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
