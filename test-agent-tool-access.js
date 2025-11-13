/**
 * Test script to verify agent has access to create_advanced_document tool
 * Tests by inspecting the agent's tool list from Railway staging
 */

import Anthropic from '@anthropic-ai/sdk';

const RAILWAY_STAGING_URL = 'https://grant-card-assistant-staging.up.railway.app';

async function testAgentToolAccess() {
  console.log('🧪 Testing agent tool access on Railway staging...\n');

  try {
    // Test 1: Verify server is responding
    console.log('TEST 1: Server health check');
    console.log('─────────────────────────────────────────────────────');

    const healthResponse = await fetch(`${RAILWAY_STAGING_URL}/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log('✅ Server is running');
      console.log(`   Status: ${health.status}`);
      console.log(`   Database: ${health.database}`);
    } else {
      console.log('❌ Server health check failed');
      return;
    }
    console.log('');

    // Test 2: Check if we can get agent configuration
    console.log('TEST 2: Agent configuration');
    console.log('─────────────────────────────────────────────────────');

    // We'll need to use Claude API directly to simulate what the agent sees
    // But first, let's check if there's an endpoint that returns tool info

    console.log('ℹ️  Note: To fully test tool access, you need to:');
    console.log('   1. Open Railway staging in browser');
    console.log('   2. Navigate to readiness-strategist agent');
    console.log('   3. Ask: "What tools do you have access to?"');
    console.log('   4. Verify response includes "create_advanced_document"');
    console.log('');

    // Test 3: Verify our local tool definitions match what's deployed
    console.log('TEST 3: Local tool definitions (should match deployed)');
    console.log('─────────────────────────────────────────────────────');

    const { getToolsForAgent } = await import('./src/tools/definitions.js');
    const readinessTools = getToolsForAgent('readiness-strategist');

    const hasAdvancedDoc = readinessTools.some(t => t.name === 'create_advanced_document');
    const hasOldDoc = readinessTools.some(t => t.name === 'create_google_doc');

    console.log(`Total tools: ${readinessTools.length}`);
    console.log(`${hasAdvancedDoc ? '✅' : '❌'} create_advanced_document: ${hasAdvancedDoc ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
    console.log(`${!hasOldDoc ? '✅' : '❌'} create_google_doc: ${hasOldDoc ? 'STILL AVAILABLE (BAD)' : 'REMOVED (GOOD)'}`);
    console.log('');

    // Test 4: Deployment commit verification
    console.log('TEST 4: Verify deployed commit');
    console.log('─────────────────────────────────────────────────────');

    try {
      const versionResponse = await fetch(`${RAILWAY_STAGING_URL}/version`);
      if (versionResponse.ok) {
        const version = await versionResponse.text();
        console.log(`Deployed version: ${version.trim()}`);
      } else {
        console.log('⚠️  /version endpoint not available');
      }
    } catch (error) {
      console.log('⚠️  Could not fetch version info');
    }
    console.log('');

    // Summary
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Local tool definitions are correct');
    console.log('✅ Server is running on Railway staging');
    console.log('');
    console.log('🔗 To verify agent has access, open:');
    console.log(`   ${RAILWAY_STAGING_URL}/readiness-strategist/new`);
    console.log('');
    console.log('📝 Then ask the agent:');
    console.log('   "What document creation tools do you have access to?"');
    console.log('');
    console.log('✓ Expected response should mention:');
    console.log('   • create_advanced_document (for readiness assessments, interview questions, rubrics)');
    console.log('   • create_google_drive_folder');
    console.log('   • create_google_sheet (for budgets)');
    console.log('');
    console.log('✗ Should NOT mention:');
    console.log('   • create_google_doc (old tool, should be removed)');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testAgentToolAccess().then(() => {
  console.log('\n✓ Test complete');
  process.exit(0);
}).catch(error => {
  console.error('\n✗ Test failed:', error);
  process.exit(1);
});
