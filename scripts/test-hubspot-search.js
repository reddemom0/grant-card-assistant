/**
 * Test HubSpot search API to see raw response data
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_PORTAL_ID = '21088260';

async function testHubSpotSearch() {
  try {
    console.log('\n🔍 Testing HubSpot company search with createdate sort...\n');

    const client = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // Search for lifecycle stage = "lead", sorted by createdate DESC
    const searchRequest = {
      filterGroups: [{
        filters: [{
          propertyName: 'lifecyclestage',
          operator: 'EQ',
          value: 'lead'
        }]
      }],
      properties: [
        'name',
        'domain',
        'lifecyclestage',
        'createdate',
        'hs_lastmodifieddate',
        'hubspot_owner_id'
      ],
      sorts: [{
        propertyName: 'createdate',
        direction: 'DESCENDING'
      }],
      limit: 10
    };

    console.log('📤 Request:', JSON.stringify(searchRequest, null, 2));
    console.log('\n⏳ Calling HubSpot API...\n');

    const response = await client.post('/crm/v3/objects/companies/search', searchRequest);

    console.log(`✅ Found ${response.data.results.length} companies\n`);

    // Show raw response for first 5 companies
    response.data.results.slice(0, 5).forEach((company, index) => {
      console.log(`\n${index + 1}. ${company.properties.name || 'Unnamed'}`);
      console.log(`   ID: ${company.id}`);
      console.log(`   Raw createdate: ${company.properties.createdate}`);
      console.log(`   Type: ${typeof company.properties.createdate}`);

      if (company.properties.createdate) {
        // Test the new parsing function
        const dateValue = company.properties.createdate;
        let parsed;

        if (typeof dateValue === 'string' && dateValue.includes('T')) {
          // ISO string format
          parsed = new Date(dateValue).toISOString();
          console.log(`   Format: ISO 8601 string`);
        } else {
          // Unix timestamp format
          const timestamp = typeof dateValue === 'string' ? parseInt(dateValue) : dateValue;
          parsed = new Date(timestamp).toISOString();
          console.log(`   Format: Unix timestamp (${timestamp})`);
        }

        console.log(`   Parsed result: ${parsed}`);
        console.log(`   ✅ Valid: ${parsed && parsed !== '1970-01-01T00:00:02.026Z'}`);
      } else {
        console.log(`   ⚠️  NULL or missing`);
      }
    });

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testHubSpotSearch();
