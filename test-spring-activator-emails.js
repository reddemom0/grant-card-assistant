import axios from 'axios';
import { config } from 'dotenv';

config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE_URL = 'https://api.hubapi.com';

// Deal IDs from the logs
const SPRING_ACTIVATOR_DEALS = [
  { id: '21734994407', label: 'Question 2' },
  { id: '19268051388', label: 'Question 3' },
  { id: '21070649988', label: 'Question 4' }
];

// Haven deal that worked successfully
const HAVEN_DEAL = { id: '33462394735', label: 'Haven (Working)' };

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

async function getDealDetails(dealId) {
  try {
    const response = await client.get(`/crm/v3/objects/deals/${dealId}`, {
      params: {
        properties: 'dealname,dealstage,amount,pipeline',
        associations: 'contacts,emails,companies'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching deal ${dealId}:`, error.response?.data || error.message);
    return null;
  }
}

async function getAssociatedEmails(dealId) {
  try {
    const response = await client.get(`/crm/v3/objects/deals/${dealId}/associations/emails`);
    return response.data.results || [];
  } catch (error) {
    console.error(`❌ Error fetching associated emails for deal ${dealId}:`, error.response?.data || error.message);
    return [];
  }
}

async function searchEmailsByDeal(dealId) {
  try {
    const response = await client.post('/crm/v3/objects/emails/search', {
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
        'hs_email_direction'
      ],
      sorts: [{
        propertyName: 'hs_timestamp',
        direction: 'DESCENDING'
      }],
      limit: 50
    });
    return response.data.results || [];
  } catch (error) {
    console.error(`❌ Error searching emails for deal ${dealId}:`, error.response?.data || error.message);
    return [];
  }
}

async function getContactEmails(contactId) {
  try {
    const response = await client.get(`/crm/v3/objects/contacts/${contactId}/associations/emails`);
    return response.data.results || [];
  } catch (error) {
    console.error(`❌ Error fetching contact emails for ${contactId}:`, error.response?.data || error.message);
    return [];
  }
}

async function getEmailDetails(emailId) {
  try {
    const response = await client.get(`/crm/v3/objects/emails/${emailId}`, {
      params: {
        properties: 'hs_email_subject,hs_email_text,hs_timestamp,hs_email_from,hs_email_to,hs_email_direction',
        associations: 'deals,contacts'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching email ${emailId}:`, error.response?.data || error.message);
    return null;
  }
}

async function analyzeDeal(dealInfo) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ANALYZING: ${dealInfo.label} (Deal ID: ${dealInfo.id})`);
  console.log('='.repeat(80));

  // 1. Get deal details
  console.log('\n1️⃣  DEAL DETAILS:');
  const deal = await getDealDetails(dealInfo.id);
  if (deal) {
    console.log(`   Name: ${deal.properties.dealname || 'N/A'}`);
    console.log(`   Stage: ${deal.properties.dealstage || 'N/A'}`);
    console.log(`   Amount: ${deal.properties.amount || 'N/A'}`);
    console.log(`   Pipeline: ${deal.properties.pipeline || 'N/A'}`);
  }

  // 2. Check direct email associations
  console.log('\n2️⃣  DIRECT EMAIL ASSOCIATIONS (via Associations API):');
  const associatedEmails = await getAssociatedEmails(dealInfo.id);
  console.log(`   Found ${associatedEmails.length} email association(s)`);

  if (associatedEmails.length > 0) {
    console.log('\n   📧 Associated Email IDs:');
    for (const assoc of associatedEmails.slice(0, 5)) {
      console.log(`      - ${assoc.id}`);
      const emailDetails = await getEmailDetails(assoc.id);
      if (emailDetails) {
        console.log(`        Subject: ${emailDetails.properties.hs_email_subject || '(No Subject)'}`);
        console.log(`        From: ${emailDetails.properties.hs_email_from || 'N/A'}`);
        console.log(`        Date: ${emailDetails.properties.hs_timestamp || 'N/A'}`);
      }
    }
    if (associatedEmails.length > 5) {
      console.log(`      ... and ${associatedEmails.length - 5} more`);
    }
  }

  // 3. Check Search API results
  console.log('\n3️⃣  SEARCH API RESULTS (filtering by deal association):');
  const searchResults = await searchEmailsByDeal(dealInfo.id);
  console.log(`   Found ${searchResults.length} email(s) via Search API`);

  if (searchResults.length > 0) {
    console.log('\n   📧 Search Results:');
    for (const email of searchResults.slice(0, 5)) {
      console.log(`      - ${email.id}`);
      console.log(`        Subject: ${email.properties.hs_email_subject || '(No Subject)'}`);
      console.log(`        From: ${email.properties.hs_email_from || 'N/A'}`);
      console.log(`        Date: ${email.properties.hs_timestamp || 'N/A'}`);
    }
    if (searchResults.length > 5) {
      console.log(`      ... and ${searchResults.length - 5} more`);
    }
  }

  // 4. Check contact associations
  if (deal && deal.associations && deal.associations.contacts) {
    console.log('\n4️⃣  CONTACT ASSOCIATIONS:');
    const contacts = deal.associations.contacts.results || [];
    console.log(`   Found ${contacts.length} associated contact(s)`);

    for (const contact of contacts.slice(0, 3)) {
      console.log(`\n   👤 Contact ID: ${contact.id}`);
      const contactEmails = await getContactEmails(contact.id);
      console.log(`      Emails on this contact: ${contactEmails.length}`);

      if (contactEmails.length > 0) {
        console.log('\n      📧 Sample emails from this contact:');
        for (const emailAssoc of contactEmails.slice(0, 3)) {
          const emailDetails = await getEmailDetails(emailAssoc.id);
          if (emailDetails) {
            console.log(`         - ${emailDetails.properties.hs_email_subject || '(No Subject)'}`);
            console.log(`           Date: ${emailDetails.properties.hs_timestamp || 'N/A'}`);

            // Check if this email is associated with the deal
            const emailDeals = emailDetails.associations?.deals?.results || [];
            const isDealAssociated = emailDeals.some(d => d.id === dealInfo.id);
            console.log(`           Associated with this deal: ${isDealAssociated ? '✅ YES' : '❌ NO'}`);
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(80));
}

async function runDiagnostics() {
  console.log('\n🔍 SPRING ACTIVATOR EMAIL DIAGNOSTIC SCRIPT');
  console.log('==========================================\n');
  console.log('This script will investigate why Spring Activator emails are not being');
  console.log('retrieved by the Search API despite being visible in HubSpot UI.\n');

  // First analyze Haven (the working example) as a baseline
  console.log('\n📌 BASELINE: Analyzing Haven deal (which successfully retrieved 15 emails)');
  await analyzeDeal(HAVEN_DEAL);

  // Then analyze all Spring Activator deals
  console.log('\n\n📌 PROBLEM CASES: Analyzing Spring Activator deals (which return 0 emails)');
  for (const deal of SPRING_ACTIVATOR_DEALS) {
    await analyzeDeal(deal);
  }

  console.log('\n\n✅ DIAGNOSTIC COMPLETE\n');
  console.log('KEY QUESTIONS TO ANSWER:');
  console.log('1. Do the Spring Activator deals have email associations in the Associations API?');
  console.log('2. Do those emails show up when filtering by deal ID in the Search API?');
  console.log('3. Are the emails associated with contacts but not with deals?');
  console.log('4. What differences exist between Haven\'s structure and Spring Activator\'s structure?');
  console.log('\n');
}

runDiagnostics().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
