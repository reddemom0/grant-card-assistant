/**
 * Test HubSpot Search with Correct Property Names
 *
 * Tests the updated searchGrantApplications() function with the
 * user's original query: "search for current CanExports and tell me which ones have been approved"
 */

import { searchGrantApplications } from './src/tools/hubspot.js';

async function runTest() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 Testing HubSpot Grant Application Search');
  console.log('='.repeat(80) + '\n');

  // Test 1: Search for CanExport applications
  console.log('Test 1: Search for CanExport Applications');
  console.log('-'.repeat(80));

  const canExportResults = await searchGrantApplications('CanExport', null, null);

  if (canExportResults.success) {
    console.log(`✅ Found ${canExportResults.count} CanExport applications\n`);

    if (canExportResults.count > 0) {
      console.log('Sample applications:');
      canExportResults.applications.slice(0, 3).forEach((app, i) => {
        console.log(`\n${i + 1}. ${app.name} (${app.refNumber || 'No Ref'})`);
        console.log(`   Program: ${app.program}`);
        console.log(`   Company: ${app.companyName || 'N/A'}`);
        console.log(`   Amount: $${app.amount || '0'}`);
        console.log(`   Status: ${app.status}`);
        console.log(`   State: ${app.state || 'N/A'}`);
        console.log(`   Submitted: ${app.submittedDate || 'N/A'}`);
        console.log(`   Approved: ${app.approvedDate || 'Not yet approved'}`);
      });
    }
  } else {
    console.log(`❌ Error: ${canExportResults.error}`);
  }

  // Test 2: Search for approved CanExport applications
  console.log('\n\nTest 2: Search for APPROVED CanExport Applications');
  console.log('-'.repeat(80));

  const approvedResults = await searchGrantApplications('CanExport', 'approved', null);

  if (approvedResults.success) {
    console.log(`✅ Found ${approvedResults.count} approved CanExport applications\n`);

    if (approvedResults.count > 0) {
      console.log('Approved applications:');
      approvedResults.applications.slice(0, 5).forEach((app, i) => {
        console.log(`\n${i + 1}. ${app.name} (${app.refNumber || 'No Ref'})`);
        console.log(`   Company: ${app.companyName || 'N/A'}`);
        console.log(`   Approved Date: ${app.approvedDate}`);
        console.log(`   Reimbursement: $${app.reimbursementAmount || '0'}`);
        console.log(`   State: ${app.state || 'N/A'}`);
      });
    } else {
      console.log('No approved CanExport applications found (this could mean none have approved_on date set)');
    }
  } else {
    console.log(`❌ Error: ${approvedResults.error}`);
  }

  // Test 3: Search for all applications with any grant type
  console.log('\n\nTest 3: Recent Applications (All Programs)');
  console.log('-'.repeat(80));

  const allResults = await searchGrantApplications(null, null, null);

  if (allResults.success) {
    console.log(`✅ Found ${allResults.count} total applications\n`);

    if (allResults.count > 0) {
      // Count by program type
      const programCounts = {};
      allResults.applications.forEach(app => {
        const program = app.program || 'Unknown';
        programCounts[program] = (programCounts[program] || 0) + 1;
      });

      console.log('Applications by Program Type (top 10):');
      Object.entries(programCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([program, count]) => {
          console.log(`  ${program}: ${count}`);
        });
    }
  } else {
    console.log(`❌ Error: ${allResults.error}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ HubSpot Search Tests Complete');
  console.log('='.repeat(80) + '\n');
}

runTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
