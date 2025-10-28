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
   * Get email engagements for a company/deal
   * @param {string} objectType - 'company' or 'deal'
   * @param {string} objectId - Company or Deal ID
   * @param {number} limit - Maximum number of engagements to retrieve
   * @returns {Promise<Array>} Array of email engagement objects
   */
  async getEmailEngagements(objectType, objectId, limit = 50) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      // Get all engagements associated with the object
      const response = await client.crm.objects.associationsApi.getAll(
        objectType,
        objectId,
        'emails'
      );

      if (!response.results || response.results.length === 0) {
        return [];
      }

      // Get full email details for each engagement
      const emailIds = response.results.slice(0, limit).map(r => r.toObjectId);
      const emails = [];

      for (const emailId of emailIds) {
        try {
          await this.rateLimitDelay();
          const emailResponse = await client.crm.objects.emails.basicApi.getById(
            emailId,
            [
              'hs_email_subject',
              'hs_email_text',
              'hs_email_html',
              'hs_timestamp',
              'hs_email_from',
              'hs_email_to',
              'hs_email_status',
              'hs_email_direction',
              'hs_attachment_ids'
            ]
          );

          emails.push(this.formatEmailEngagement(emailResponse));
        } catch (emailError) {
          console.warn(`Failed to retrieve email ${emailId}:`, emailError.message);
          continue;
        }
      }

      // Sort by timestamp descending (most recent first)
      return emails.sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        return dateB - dateA;
      });
    } catch (error) {
      console.error(`Error getting email engagements for ${objectType} ${objectId}:`, error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Get email engagements for a contact
   * @param {string} contactId - Contact ID
   * @param {number} limit - Maximum number of emails to retrieve
   * @returns {Promise<Array>} Array of email engagement objects
   */
  async getContactEmailEngagements(contactId, limit = 50) {
    try {
      const client = this.initClient();
      await this.rateLimitDelay();

      const response = await client.crm.objects.associationsApi.getAll(
        'contacts',
        contactId,
        'emails'
      );

      if (!response.results || response.results.length === 0) {
        return [];
      }

      const emailIds = response.results.slice(0, limit).map(r => r.toObjectId);
      const emails = [];

      for (const emailId of emailIds) {
        try {
          await this.rateLimitDelay();
          const emailResponse = await client.crm.objects.emails.basicApi.getById(
            emailId,
            [
              'hs_email_subject',
              'hs_email_text',
              'hs_email_html',
              'hs_timestamp',
              'hs_email_from',
              'hs_email_to',
              'hs_email_status',
              'hs_email_direction',
              'hs_attachment_ids'
            ]
          );

          emails.push(this.formatEmailEngagement(emailResponse));
        } catch (emailError) {
          console.warn(`Failed to retrieve email ${emailId}:`, emailError.message);
          continue;
        }
      }

      return emails.sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        return dateB - dateA;
      });
    } catch (error) {
      console.error(`Error getting contact email engagements:`, error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Search email engagements by keywords in subject or body
   * @param {string} objectType - 'company', 'deal', or 'contact'
   * @param {string} objectId - Object ID
   * @param {string} searchTerm - Keywords to search for (e.g., "funding agreement", "claim")
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} Filtered array of email engagements
   */
  async searchEmailEngagements(objectType, objectId, searchTerm, limit = 20) {
    try {
      // Get all emails first
      let emails;
      if (objectType === 'contact') {
        emails = await this.getContactEmailEngagements(objectId, 100);
      } else {
        emails = await this.getEmailEngagements(objectType, objectId, 100);
      }

      // Filter by search term
      const searchLower = searchTerm.toLowerCase();
      const filtered = emails.filter(email => {
        const subject = (email.subject || '').toLowerCase();
        const textBody = (email.textBody || '').toLowerCase();
        return subject.includes(searchLower) || textBody.includes(searchLower);
      });

      return filtered.slice(0, limit);
    } catch (error) {
      console.error('Error searching email engagements:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Get email summary for a deal/project
   * Provides high-level overview of email communication
   * @param {string} dealId - Deal ID
   * @returns {Promise<Object>} Email communication summary
   */
  async getEmailSummary(dealId) {
    try {
      const emails = await this.getEmailEngagements('deal', dealId, 100);

      // Analyze email patterns
      const inbound = emails.filter(e => e.direction === 'INCOMING_EMAIL').length;
      const outbound = emails.filter(e => e.direction === 'OUTGOING_EMAIL').length;

      // Group by month
      const emailsByMonth = {};
      emails.forEach(email => {
        const date = new Date(email.timestamp);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!emailsByMonth[monthKey]) {
          emailsByMonth[monthKey] = [];
        }
        emailsByMonth[monthKey].push(email);
      });

      // Get most recent email
      const mostRecent = emails.length > 0 ? emails[0] : null;

      return {
        totalEmails: emails.length,
        inboundCount: inbound,
        outboundCount: outbound,
        mostRecentEmail: mostRecent ? {
          subject: mostRecent.subject,
          from: mostRecent.from,
          timestamp: mostRecent.timestamp,
          direction: mostRecent.direction
        } : null,
        emailsByMonth,
        firstEmailDate: emails.length > 0 ? emails[emails.length - 1].timestamp : null,
        lastEmailDate: mostRecent ? mostRecent.timestamp : null
      };
    } catch (error) {
      console.error('Error getting email summary:', error.message);
      throw new Error(`HubSpot API error: ${error.message}`);
    }
  }

  /**
   * Format email engagement object
   * @private
   */
  formatEmailEngagement(email) {
    return {
      id: email.id,
      subject: email.properties.hs_email_subject || '(No Subject)',
      textBody: email.properties.hs_email_text || '',
      htmlBody: email.properties.hs_email_html || '',
      timestamp: email.properties.hs_timestamp || email.createdAt,
      from: email.properties.hs_email_from || '',
      to: email.properties.hs_email_to || '',
      status: email.properties.hs_email_status || '',
      direction: email.properties.hs_email_direction || '',
      attachmentIds: email.properties.hs_attachment_ids || '',
      hasAttachments: !!(email.properties.hs_attachment_ids),
      createdAt: email.createdAt,
      updatedAt: email.updatedAt
    };
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
