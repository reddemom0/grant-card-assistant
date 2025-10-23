import { Client } from "@hubspot/api-client";

/**
 * HubSpot CRM Service - Read-Only Access
 * Provides methods to query contacts, companies, and deals from HubSpot CRM
 */

class HubSpotService {
  constructor() {
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    this.client = null;
    this.lastCallTime = 0;
    this.minCallInterval = 100; // 100ms between calls for rate limiting
  }

  /**
   * Initialize HubSpot client
   * @throws {Error} if HUBSPOT_ACCESS_TOKEN is not configured
   */
  initClient() {
    if (!this.accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN environment variable is not set');
    }

    if (!this.client) {
      this.client = new Client({ accessToken: this.accessToken });
    }

    return this.client;
  }

  /**
   * Rate limiting helper - ensures minimum time between API calls
   */
  async rateLimitDelay() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;

    if (timeSinceLastCall < this.minCallInterval) {
      await new Promise(resolve =>
        setTimeout(resolve, this.minCallInterval - timeSinceLastCall)
      );
    }

    this.lastCallTime = Date.now();
  }

  /**
   * Check if HubSpot is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.accessToken;
  }

  /**
   * Find a contact by email address
   * @param {string} email - Contact email address
   * @returns {Promise<Object|null>} Contact object or null if not found
   */
  async findContactByEmail(email) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.contacts.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: 'EQ',
            value: email
          }]
        }],
        properties: [
          'firstname',
          'lastname',
          'email',
          'phone',
          'company',
          'jobtitle',
          'lifecyclestage',
          'hs_lead_status',
          'createdate',
          'lastmodifieddate'
        ],
        limit: 1
      });

      if (response.results && response.results.length > 0) {
        return this.formatContact(response.results[0]);
      }

      return null;
    } catch (error) {
      console.error('Error finding contact by email:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Get a contact by ID
   * @param {string} contactId - HubSpot contact ID
   * @returns {Promise<Object>} Contact object
   */
  async getContact(contactId) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.contacts.basicApi.getById(contactId, [
        'firstname',
        'lastname',
        'email',
        'phone',
        'company',
        'jobtitle',
        'lifecyclestage',
        'hs_lead_status',
        'createdate',
        'lastmodifieddate',
        'address',
        'city',
        'state',
        'zip',
        'country'
      ]);

      return this.formatContact(response);
    } catch (error) {
      console.error('Error getting contact:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Search for companies by name or domain
   * @param {string} searchTerm - Company name or domain to search for
   * @param {number} limit - Maximum number of results (default: 10)
   * @returns {Promise<Array>} Array of company objects
   */
  async findCompany(searchTerm, limit = 10) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.companies.searchApi.doSearch({
        filterGroups: [{
          filters: [
            {
              propertyName: 'name',
              operator: 'CONTAINS_TOKEN',
              value: searchTerm
            }
          ]
        }, {
          filters: [
            {
              propertyName: 'domain',
              operator: 'CONTAINS_TOKEN',
              value: searchTerm
            }
          ]
        }],
        properties: [
          'name',
          'domain',
          'industry',
          'city',
          'state',
          'country',
          'numberofemployees',
          'annualrevenue',
          'createdate',
          'hs_lastmodifieddate'
        ],
        limit: limit
      });

      return response.results.map(company => this.formatCompany(company));
    } catch (error) {
      console.error('Error searching companies:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Search for deals by name or stage
   * @param {string} searchTerm - Deal name to search for
   * @param {number} limit - Maximum number of results (default: 10)
   * @returns {Promise<Array>} Array of deal objects
   */
  async searchDeals(searchTerm, limit = 10) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.deals.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'dealname',
            operator: 'CONTAINS_TOKEN',
            value: searchTerm
          }]
        }],
        properties: [
          'dealname',
          'dealstage',
          'amount',
          'closedate',
          'pipeline',
          'createdate',
          'hs_lastmodifieddate',
          'dealtype',
          'description'
        ],
        limit: limit
      });

      return response.results.map(deal => this.formatDeal(deal));
    } catch (error) {
      console.error('Error searching deals:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Get all deals associated with a contact
   * @param {string} contactId - HubSpot contact ID
   * @returns {Promise<Array>} Array of deal objects
   */
  async getContactDeals(contactId) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.contacts.associationsApi.getAll(
        contactId,
        'deals'
      );

      if (!response.results || response.results.length === 0) {
        return [];
      }

      // Fetch deal details for each associated deal
      const dealPromises = response.results.map(async (association) => {
        await this.rateLimitDelay();
        return client.crm.deals.basicApi.getById(association.id, [
          'dealname',
          'dealstage',
          'amount',
          'closedate',
          'pipeline',
          'createdate',
          'hs_lastmodifieddate'
        ]);
      });

      const deals = await Promise.all(dealPromises);
      return deals.map(deal => this.formatDeal(deal));
    } catch (error) {
      console.error('Error getting contact deals:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Get recently created or modified contacts
   * @param {number} limit - Maximum number of contacts to return (default: 10)
   * @returns {Promise<Array>} Array of contact objects
   */
  async getRecentContacts(limit = 10) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.contacts.basicApi.getPage(
        limit,
        undefined,
        [
          'firstname',
          'lastname',
          'email',
          'phone',
          'company',
          'jobtitle',
          'lifecyclestage',
          'createdate',
          'lastmodifieddate'
        ],
        undefined,
        undefined,
        false
      );

      return response.results.map(contact => this.formatContact(contact));
    } catch (error) {
      console.error('Error getting recent contacts:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Format contact object for consistent API responses
   * @private
   */
  formatContact(contact) {
    return {
      id: contact.id,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      archived: contact.archived || false,
      properties: {
        firstname: contact.properties.firstname || '',
        lastname: contact.properties.lastname || '',
        email: contact.properties.email || '',
        phone: contact.properties.phone || '',
        company: contact.properties.company || '',
        jobtitle: contact.properties.jobtitle || '',
        lifecyclestage: contact.properties.lifecyclestage || '',
        leadStatus: contact.properties.hs_lead_status || '',
        address: contact.properties.address || '',
        city: contact.properties.city || '',
        state: contact.properties.state || '',
        zip: contact.properties.zip || '',
        country: contact.properties.country || '',
        createDate: contact.properties.createdate || '',
        lastModifiedDate: contact.properties.lastmodifieddate || ''
      }
    };
  }

  /**
   * Format company object for consistent API responses
   * @private
   */
  formatCompany(company) {
    return {
      id: company.id,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      archived: company.archived || false,
      properties: {
        name: company.properties.name || '',
        domain: company.properties.domain || '',
        industry: company.properties.industry || '',
        city: company.properties.city || '',
        state: company.properties.state || '',
        country: company.properties.country || '',
        numberOfEmployees: company.properties.numberofemployees || '',
        annualRevenue: company.properties.annualrevenue || '',
        createDate: company.properties.createdate || '',
        lastModifiedDate: company.properties.hs_lastmodifieddate || ''
      }
    };
  }

  /**
   * Format deal object for consistent API responses
   * @private
   */
  formatDeal(deal) {
    return {
      id: deal.id,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
      archived: deal.archived || false,
      properties: {
        dealName: deal.properties.dealname || '',
        dealStage: deal.properties.dealstage || '',
        amount: deal.properties.amount || '0',
        closeDate: deal.properties.closedate || '',
        pipeline: deal.properties.pipeline || '',
        dealType: deal.properties.dealtype || '',
        description: deal.properties.description || '',
        createDate: deal.properties.createdate || '',
        lastModifiedDate: deal.properties.hs_lastmodifieddate || ''
      }
    };
  }
}

// Export singleton instance
const hubspotService = new HubSpotService();
export default hubspotService;
