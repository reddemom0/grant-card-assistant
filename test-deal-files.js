/**
 * Test script to verify get_deal_files tool can access funding agreement
 */

import { getDealFiles } from './src/tools/hubspot.js';

const SPRING_ACTIVATOR_DEAL_ID = '35208052239';
const EXPECTED_FILE_ID = '195210192980'; // From HubSpot URL

async function testDealFiles() {
  console.log('🧪 Testing get_deal_files tool...\n');
  console.log(`📋 Deal ID: ${SPRING_ACTIVATOR_DEAL_ID}`);
  console.log(`🔍 Looking for file ID: ${EXPECTED_FILE_ID}\n`);

  try {
    const result = await getDealFiles(SPRING_ACTIVATOR_DEAL_ID);

    console.log('\n📤 Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`\n✅ Success! Found ${result.count} file(s)`);

      // Check if the funding agreement is in the results
      const fundingAgreement = result.files.find(
        f => f.id === EXPECTED_FILE_ID
      );

      if (fundingAgreement) {
        console.log('\n🎯 Funding agreement found!');
        console.log('   Name:', fundingAgreement.name);
        console.log('   Type:', fundingAgreement.type);
        console.log('   URL:', fundingAgreement.url);
      } else {
        console.log(`\n⚠️  File ${EXPECTED_FILE_ID} not found in results`);
        console.log('   Files returned:');
        result.files.forEach(f => {
          console.log(`   - ${f.id}: ${f.name}`);
        });
      }
    } else {
      console.log('\n❌ Failed:', result.error);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

testDealFiles();
