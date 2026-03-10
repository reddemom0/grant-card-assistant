/**
 * Quick deployment verification script
 * Checks if the planned activities feature is deployed and working
 */

import fetch from 'node-fetch';

const RAILWAY_URL = 'https://grant-card-assistant-production.up.railway.app';

console.log('🔍 Verifying Planned Activities Deployment\n');
console.log(`Target: ${RAILWAY_URL}\n`);

async function verifyEndpoint() {
  console.log('1. Testing /api/lead-gen-init endpoint...');

  try {
    const response = await fetch(`${RAILWAY_URL}/api/lead-gen-init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Verification Test',
        email: 'verify@example.com',
        company: 'Test Corp',
        province: 'British Columbia',
        revenue_range: '$500K - $1M',
        employee_count: '10 - 49 employees',
        hiring_plans: '3 – 5 people',
        training_budget: '$10K - $25K',
        expansion_budget: 'None planned',
        planned_activities: 'Test activity for deployment verification',
        test_mode: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    console.log('   ✓ Endpoint is responding');
    console.log(`   ✓ Conversation created: ${result.conversation_id}`);

    // Check if form_data includes planned_activities
    if (result.form_data && 'planned_activities' in result.form_data) {
      console.log('   ✓ planned_activities field is recognized by backend');
      console.log(`   ✓ Value received: "${result.form_data.planned_activities}"`);
    } else {
      console.log('   ✗ WARNING: planned_activities field NOT found in response');
      console.log('   → Check if lead-gen-init.js is deployed');
    }

    return result.conversation_id;

  } catch (error) {
    console.log(`   ✗ FAILED: ${error.message}`);
    return null;
  }
}

async function verifyContextInjection(conversationId) {
  console.log('\n2. Testing context injection in agent response...');

  try {
    const response = await fetch(`${RAILWAY_URL}/api/lead-gen-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: 'Hello',
        test_mode: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();

    console.log('   ✓ Agent responded successfully');
    console.log(`   ✓ Response length: ${text.length} chars`);

    // Check Railway logs message
    console.log('\n   📋 To verify context injection, check Railway logs for:');
    console.log('      "Planned Activities: Test activity for deployment verification"');

    return true;

  } catch (error) {
    console.log(`   ✗ FAILED: ${error.message}`);
    return false;
  }
}

async function verifyWidget() {
  console.log('\n3. Testing widget JavaScript file...');

  try {
    const response = await fetch(`${RAILWAY_URL}/widget/getgranted-widget.js`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const code = await response.text();

    // Check if planned_activities field is in the widget code
    if (code.includes('gg-planned-activities')) {
      console.log('   ✓ Widget includes planned_activities textarea');
    } else {
      console.log('   ✗ WARNING: planned_activities field NOT found in widget');
      console.log('   → Check if getgranted-widget.js is deployed');
    }

    // Check if form submission includes the field
    if (code.includes('planned_activities:')) {
      console.log('   ✓ Widget form submission includes planned_activities');
    } else {
      console.log('   ✗ WARNING: Form submission may not include planned_activities');
    }

    return true;

  } catch (error) {
    console.log(`   ✗ FAILED: ${error.message}`);
    return false;
  }
}

async function checkSystemPrompts() {
  console.log('\n4. Checking system prompt files...');

  const files = [
    '.claude/skills/lead-gen-variant-b/base-system-prompt.md',
    '.claude/skills/lead-gen-variant-b/client-communication.md',
    '.claude/skills/lead-gen-variant-b/system-operations.md'
  ];

  try {
    const fs = await import('fs');

    for (const file of files) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');

        // Check for key terms related to planned activities
        const hasPlannedActivities = content.includes('planned_activities') ||
                                     content.includes('Planned Activities');

        if (hasPlannedActivities) {
          console.log(`   ✓ ${file.split('/').pop()} includes planned activities documentation`);
        } else {
          console.log(`   ⚠ ${file.split('/').pop()} may not document planned activities`);
        }
      } else {
        console.log(`   ✗ ${file} not found`);
      }
    }

    return true;

  } catch (error) {
    console.log(`   ✗ FAILED: ${error.message}`);
    return false;
  }
}

async function run() {
  console.log('═'.repeat(80));

  const conversationId = await verifyEndpoint();

  if (conversationId) {
    // Wait a moment for database persistence
    await new Promise(resolve => setTimeout(resolve, 1000));
    await verifyContextInjection(conversationId);
  }

  await verifyWidget();
  await checkSystemPrompts();

  console.log('\n' + '═'.repeat(80));
  console.log('✅ DEPLOYMENT VERIFICATION COMPLETE\n');
  console.log('Next steps:');
  console.log('1. Review Railway logs for context injection confirmation');
  console.log('2. Run full API tests: node test-planned-activities.js');
  console.log('3. Run manual UI tests: see MANUAL-TEST-GUIDE.md');
  console.log('═'.repeat(80) + '\n');
}

run().catch(error => {
  console.error('\n❌ Verification failed:', error);
  process.exit(1);
});
