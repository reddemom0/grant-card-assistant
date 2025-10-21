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
 * @param {string|null} grantProgram - Filter by grant program type
 * @param {string|null} status - Filter by application status
 * @param {string|null} companyName - Filter by company name
 * @returns {Object} Search results
 */
export async function searchGrantApplications(grantProgram = null, status = null, companyName = null) {
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
    if (grantProgram) {
      filters.push({
        propertyName: 'grant_program',
        operator: 'EQ',
        value: grantProgram
      });
    }

    // Filter by status if specified
    if (status) {
      filters.push({
        propertyName: 'dealstage',
        operator: 'EQ',
        value: status
      });
    }

    const response = await client.post('/crm/v3/objects/deals/search', {
      filterGroups: filters.length > 0 ? [{ filters }] : [],
      properties: [
        'dealname', 'amount', 'dealstage', 'closedate',
        'grant_program', 'application_deadline', 'createdate'
      ],
      limit: 20,
      sorts: [
        {
          propertyName: 'createdate',
          direction: 'DESCENDING'
        }
      ]
    });

    console.log(`✓ HubSpot grant applications search: found ${response.data.results.length} results`);

    return {
      success: true,
      count: response.data.results.length,
      applications: response.data.results.map(deal => ({
        id: deal.id,
        name: deal.properties.dealname,
        program: deal.properties.grant_program,
        amount: deal.properties.amount,
        status: deal.properties.dealstage,
        deadline: deal.properties.application_deadline,
        closeDate: deal.properties.closedate,
        createdDate: deal.properties.createdate
      }))
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
 * @returns {Object} Application details
 */
export async function getGrantApplication(applicationId) {
  if (!HUBSPOT_TOKEN) {
    return {
      success: false,
      error: 'HubSpot access token not configured'
    };
  }

  try {
    const client = createHubSpotClient();

    const response = await client.get(`/crm/v3/objects/deals/${applicationId}`, {
      params: {
        properties: [
          'dealname', 'amount', 'dealstage', 'closedate',
          'grant_program', 'application_deadline',
          'eligibility_criteria_met', 'required_documents', 'createdate'
        ].join(','),
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
