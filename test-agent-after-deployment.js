/**
 * Wait for Railway deployment and test agent tool access
 * This script waits for deployment to complete, then verifies the agent has create_advanced_document
 */

const RAILWAY_STAGING_URL = 'https://grant-card-assistant-staging.up.railway.app';
const DEPLOYMENT_WAIT_TIME = 180000; // 3 minutes
const POLL_INTERVAL = 10000; // Check every 10 seconds

async function waitForDeployment() {
  console.log('🚂 Waiting for Railway deployment to complete...\n');
  console.log(`⏱️  Will wait up to ${DEPLOYMENT_WAIT_TIME / 1000} seconds\n`);

  const startTime = Date.now();
  let deploymentComplete = false;
  let lastCheck = '';

  while (Date.now() - startTime < DEPLOYMENT_WAIT_TIME) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r⏳ Elapsed: ${elapsed}s | Last check: ${lastCheck}     `);

    try {
      // Check health endpoint
      const response = await fetch(`${RAILWAY_STAGING_URL}/health`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (response.ok) {
        const health = await response.json();
        if (health.status === 'healthy') {
          lastCheck = '✓ healthy';

          // Wait a bit longer to ensure full deployment
          if (elapsed > 60) {
            deploymentComplete = true;
            break;
          }
        }
      } else {
        lastCheck = `⚠ ${response.status}`;
      }
    } catch (error) {
      lastCheck = `❌ ${error.message.substring(0, 20)}`;
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  console.log('\n');

  if (!deploymentComplete) {
    console.log('⚠️  Deployment may not be complete yet, but proceeding with test...\n');
  } else {
    console.log('✅ Deployment appears complete!\n');
  }
}

async function testAgentTools() {
  console.log('🧪 Testing agent tool access...\n');
  console.log('─────────────────────────────────────────────────────\n');

  try {
    const response = await fetch(`${RAILWAY_STAGING_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentType: 'readiness-strategist',
        message: 'List all the document creation tools you have access to. For each tool, provide: 1) The exact tool name, 2) What it does. Be specific and comprehensive.',
        conversationId: null
      })
    });

    console.log(`Status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const text = await response.text();
      console.log('❌ Error:', text);
      return false;
    }

    // Parse SSE stream
    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.trim());

    let fullMessage = '';
    let toolsUsed = [];

    for (const event of events) {
      if (!event.startsWith('data: ')) continue;

      try {
        const data = JSON.parse(event.substring(6));

        if (data.type === 'content_delta') {
          fullMessage += data.text;
        } else if (data.type === 'tool_use') {
          toolsUsed.push(data.toolName);
        } else if (data.type === 'connected') {
          console.log(`✓ Connected (conversation: ${data.conversationId.substring(0, 8)}...)\n`);
        }
      } catch (e) {
        // Skip malformed events
      }
    }

    // Display agent's response
    console.log('📝 Agent\'s full response:');
    console.log('═════════════════════════════════════════════════════');
    console.log(fullMessage || '(empty response)');
    console.log('═════════════════════════════════════════════════════\n');

    // Analysis
    console.log('🔍 Analysis:');
    console.log('─────────────────────────────────────────────────────');

    const hasAdvanced = fullMessage.toLowerCase().includes('create_advanced_document');
    const hasOld = fullMessage.toLowerCase().includes('create_google_doc');

    console.log(`${hasAdvanced ? '✅' : '❌'} Mentions create_advanced_document: ${hasAdvanced ? 'YES' : 'NO'}`);
    console.log(`${!hasOld ? '✅' : '❌'} Does NOT mention create_google_doc: ${!hasOld ? 'YES (GOOD)' : 'NO (BAD)'}`);

    if (toolsUsed.length > 0) {
      console.log(`\n📋 Tools used during response: ${toolsUsed.join(', ')}`);
    }

    console.log('\n');

    // Final verdict
    if (hasAdvanced && !hasOld) {
      console.log('✅ SUCCESS! Agent has access to create_advanced_document tool!');
      console.log('✅ The old create_google_doc tool has been successfully removed!');
      return true;
    } else if (!hasAdvanced && !hasOld) {
      console.log('⚠️  Agent didn\'t mention either tool - the response may be incomplete');
      return false;
    } else if (hasOld) {
      console.log('❌ FAILED: Agent still has access to old create_google_doc tool');
      return false;
    } else if (!hasAdvanced) {
      console.log('❌ FAILED: Agent does not have access to create_advanced_document');
      return false;
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 Railway Deployment Verification Test');
  console.log('='.repeat(80) + '\n');

  // Wait for deployment
  await waitForDeployment();

  // Test agent tools
  const success = await testAgentTools();

  console.log('\n' + '='.repeat(80));
  if (success) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('='.repeat(80) + '\n');
    process.exit(0);
  } else {
    console.log('❌ TESTS FAILED');
    console.log('='.repeat(80) + '\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
