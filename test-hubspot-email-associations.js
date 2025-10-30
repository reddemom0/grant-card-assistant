/**
 * Diagnostic Script: HubSpot Email Association Testing
 *
 * Tests different methods of retrieving emails for Haven's deal to identify
 * why emails visible in HubSpot UI aren't being returned by the API.
 */

import axios from 'axios';
import { config } from 'dotenv';

config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HAVEN_DEAL_ID = '33462394735'; // From console logs

const client = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

console.log('🔍 Diagnosing Email Associations for Haven Deal\n');
console.log(`Deal ID: ${HAVEN_DEAL_ID}\n`);
console.log('─'.repeat(80));

async function testDirectDealEmails() {
  console.log('\n📧 TEST 1: Direct Deal → Email Associations');
  console.log('Endpoint: /crm/v4/objects/deals/{dealId}/associations/emails\n');

  try {
    const response = await client.get(
      `/crm/v4/objects/deals/${HAVEN_DEAL_ID}/associations/emails`
    );

    console.log(`✓ Response received`);
    console.log(`  Results: ${response.data.results?.length || 0} emails`);

    if (response.data.results && response.data.results.length > 0) {
      console.log(`  Sample email IDs:`, response.data.results.slice(0, 3).map(r => r.toObjectId));
    } else {
      console.log(`  ⚠️  No direct email associations found`);
    }

    return response.data.results?.length || 0;
  } catch (error) {
    console.error(`❌ Error:`, error.response?.data || error.message);
    return 0;
  }
}

async function testDealContacts() {
  console.log('\n👥 TEST 2: Deal → Contact Associations');
  console.log('Endpoint: /crm/v4/objects/deals/{dealId}/associations/contacts\n');

  try {
    const response = await client.get(
      `/crm/v4/objects/deals/${HAVEN_DEAL_ID}/associations/contacts`
    );

    console.log(`✓ Response received`);
    console.log(`  Results: ${response.data.results?.length || 0} contacts`);

    if (response.data.results && response.data.results.length > 0) {
      const contactIds = response.data.results.map(r => r.toObjectId);
      console.log(`  Contact IDs:`, contactIds);
      return contactIds;
    } else {
      console.log(`  ⚠️  No contacts associated with deal`);
      return [];
    }
  } catch (error) {
    console.error(`❌ Error:`, error.response?.data || error.message);
    return [];
  }
}

async function testContactEmails(contactId) {
  console.log(`\n📧 TEST 3: Contact → Email Associations`);
  console.log(`Endpoint: /crm/v4/objects/contacts/${contactId}/associations/emails\n`);

  try {
    const response = await client.get(
      `/crm/v4/objects/contacts/${contactId}/associations/emails`
    );

    console.log(`✓ Response received for contact ${contactId}`);
    console.log(`  Results: ${response.data.results?.length || 0} emails`);

    if (response.data.results && response.data.results.length > 0) {
      console.log(`  Sample email IDs:`, response.data.results.slice(0, 5).map(r => r.toObjectId));

      // Get details of first email
      const firstEmailId = response.data.results[0].toObjectId;
      return { contactId, emailId: firstEmailId, total: response.data.results.length };
    }

    return { contactId, emailId: null, total: 0 };
  } catch (error) {
    console.error(`❌ Error:`, error.response?.data || error.message);
    return { contactId, emailId: null, total: 0 };
  }
}

async function testEmailDetails(emailId) {
  console.log(`\n📄 TEST 4: Get Email Details`);
  console.log(`Endpoint: /crm/v3/objects/emails/${emailId}\n`);

  try {
    const response = await client.get(`/crm/v3/objects/emails/${emailId}`, {
      params: {
        properties: 'hs_email_subject,hs_email_text,hs_timestamp,hs_email_direction'
      }
    });

    console.log(`✓ Email retrieved:`);
    console.log(`  Subject: ${response.data.properties.hs_email_subject || '(No Subject)'}`);
    console.log(`  Date: ${response.data.properties.hs_timestamp || 'Unknown'}`);
    console.log(`  Direction: ${response.data.properties.hs_email_direction || 'Unknown'}`);

    return response.data;
  } catch (error) {
    console.error(`❌ Error:`, error.response?.data || error.message);
    return null;
  }
}

async function runDiagnostics() {
  try {
    // Test 1: Direct deal emails
    const directEmails = await testDirectDealEmails();

    // Test 2: Get contacts on deal
    const contactIds = await testDealContacts();

    if (contactIds.length === 0) {
      console.log('\n⚠️  ISSUE IDENTIFIED: No contacts associated with deal');
      console.log('    Emails in HubSpot UI might be visible through company association');
      return;
    }

    // Test 3: Get emails for each contact
    console.log('\n' + '─'.repeat(80));
    let totalContactEmails = 0;
    let sampleEmailId = null;

    for (const contactId of contactIds) {
      const result = await testContactEmails(contactId);
      totalContactEmails += result.total;
      if (result.emailId && !sampleEmailId) {
        sampleEmailId = result.emailId;
      }
    }

    // Test 4: Get details of one email
    if (sampleEmailId) {
      console.log('\n' + '─'.repeat(80));
      await testEmailDetails(sampleEmailId);
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('\n📊 DIAGNOSTIC SUMMARY\n');
    console.log(`Deal → Email (direct): ${directEmails} emails`);
    console.log(`Deal → Contact: ${contactIds.length} contacts`);
    console.log(`Contact → Email: ${totalContactEmails} emails total`);
    console.log('');

    if (directEmails === 0 && totalContactEmails > 0) {
      console.log('✅ ROOT CAUSE IDENTIFIED:');
      console.log('   Emails are associated with CONTACTS, not directly with the DEAL');
      console.log('   Current implementation only checks deal → email associations');
      console.log('   Solution: Update getProjectEmailHistory to also check contact associations');
    } else if (directEmails > 0) {
      console.log('✅ Emails are directly associated with deal');
      console.log('   This should work with current implementation');
    } else {
      console.log('⚠️  No emails found through either method');
      console.log('   Emails visible in UI might be through company or other associations');
    }

    console.log('\n' + '═'.repeat(80));

  } catch (error) {
    console.error('\n❌ Diagnostic failed:', error.message);
  }
}

runDiagnostics();
