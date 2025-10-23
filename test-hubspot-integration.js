/**
 * Test HubSpot Integration
 *
 * This script tests the HubSpot CRM read-only integration
 * to verify all endpoints work correctly.
 */

import hubspotService from './services/hubspot-service.js';

async function runTests() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 Testing HubSpot Integration');
  console.log('='.repeat(80) + '\n');

  // Test 1: Check if HubSpot is configured
  console.log('Test 1: Check HubSpot Configuration');
  console.log('-'.repeat(80));
  const isConfigured = hubspotService.isConfigured();
  console.log(`Status: ${isConfigured ? '✅ Configured' : '❌ Not Configured'}`);

  if (!isConfigured) {
    console.log('\n⚠️  HUBSPOT_ACCESS_TOKEN not found in environment variables');
    console.log('Please add HUBSPOT_ACCESS_TOKEN to your .env file to test the integration.\n');
    return;
  }

  try {
    // Test 2: Get recent contacts
    console.log('\nTest 2: Get Recent Contacts (limit: 3)');
    console.log('-'.repeat(80));
    const recentContacts = await hubspotService.getRecentContacts(3);
    console.log(`✅ Retrieved ${recentContacts.length} contacts`);

    if (recentContacts.length > 0) {
      const sample = recentContacts[0];
      console.log('\nSample Contact:');
      console.log(`  ID: ${sample.id}`);
      console.log(`  Name: ${sample.properties.firstname} ${sample.properties.lastname}`);
      console.log(`  Email: ${sample.properties.email}`);
      console.log(`  Company: ${sample.properties.company || 'N/A'}`);
      console.log(`  Job Title: ${sample.properties.jobtitle || 'N/A'}`);
    }

    // Test 3: Search for a contact by email (if we have any contacts)
    if (recentContacts.length > 0 && recentContacts[0].properties.email) {
      const testEmail = recentContacts[0].properties.email;

      console.log(`\nTest 3: Find Contact by Email (${testEmail})`);
      console.log('-'.repeat(80));
      const foundContact = await hubspotService.findContactByEmail(testEmail);

      if (foundContact) {
        console.log(`✅ Contact found by email`);
        console.log(`  ID: ${foundContact.id}`);
        console.log(`  Name: ${foundContact.properties.firstname} ${foundContact.properties.lastname}`);
      } else {
        console.log('❌ Contact not found');
      }

      // Test 4: Get contact by ID
      console.log(`\nTest 4: Get Contact by ID (${recentContacts[0].id})`);
      console.log('-'.repeat(80));
      const contactById = await hubspotService.getContact(recentContacts[0].id);
      console.log(`✅ Contact retrieved by ID`);
      console.log(`  ID: ${contactById.id}`);
      console.log(`  Email: ${contactById.properties.email}`);

      // Test 5: Get deals for the contact
      console.log(`\nTest 5: Get Deals for Contact (${recentContacts[0].id})`);
      console.log('-'.repeat(80));
      const contactDeals = await hubspotService.getContactDeals(recentContacts[0].id);
      console.log(`✅ Retrieved ${contactDeals.length} deals for this contact`);

      if (contactDeals.length > 0) {
        const sampleDeal = contactDeals[0];
        console.log('\nSample Deal:');
        console.log(`  ID: ${sampleDeal.id}`);
        console.log(`  Name: ${sampleDeal.properties.dealName}`);
        console.log(`  Stage: ${sampleDeal.properties.dealStage}`);
        console.log(`  Amount: $${sampleDeal.properties.amount}`);
      }
    }

    // Test 6: Search for companies
    console.log('\nTest 6: Search Companies (generic search)');
    console.log('-'.repeat(80));
    const companies = await hubspotService.findCompany('company', 3);
    console.log(`✅ Retrieved ${companies.length} companies`);

    if (companies.length > 0) {
      const sampleCompany = companies[0];
      console.log('\nSample Company:');
      console.log(`  ID: ${sampleCompany.id}`);
      console.log(`  Name: ${sampleCompany.properties.name}`);
      console.log(`  Domain: ${sampleCompany.properties.domain || 'N/A'}`);
      console.log(`  Industry: ${sampleCompany.properties.industry || 'N/A'}`);
    }

    // Test 7: Search for deals
    console.log('\nTest 7: Search Deals (generic search)');
    console.log('-'.repeat(80));
    const deals = await hubspotService.searchDeals('deal', 3);
    console.log(`✅ Retrieved ${deals.length} deals`);

    if (deals.length > 0) {
      const sampleDeal = deals[0];
      console.log('\nSample Deal:');
      console.log(`  ID: ${sampleDeal.id}`);
      console.log(`  Name: ${sampleDeal.properties.dealName}`);
      console.log(`  Stage: ${sampleDeal.properties.dealStage}`);
      console.log(`  Amount: $${sampleDeal.properties.amount}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ All HubSpot Integration Tests Passed!');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Test Failed');
    console.error('='.repeat(80));
    console.error(`Error: ${error.message}`);
    console.error('\nStack trace:');
    console.error(error.stack);
    console.error('\n');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
