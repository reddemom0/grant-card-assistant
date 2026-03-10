/**
 * API Test Script for Planned Activities Feature
 *
 * Tests the backend flow: form submission → database storage → context injection
 * Run with: node test-planned-activities.js
 */

import fetch from 'node-fetch';

const RAILWAY_URL = 'https://grant-card-assistant-production.up.railway.app';
const TEST_MODE = true; // Set to true to avoid creating real HubSpot records

// Test scenarios
const testCases = [
  {
    name: 'Test 1: Blank Activity (Path A)',
    data: {
      name: 'Test User 1',
      email: 'test1@example.com',
      company: 'Test Corp 1',
      province: 'British Columbia',
      revenue_range: '$500K - $1M',
      employee_count: '10 - 49 employees',
      hiring_plans: '3 – 5 people',
      training_budget: '$10K - $25K',
      expansion_budget: 'None planned',
      planned_activities: '' // Blank
    },
    expected: {
      stored: null,
      injected: 'None specified',
      path: 'A - immediate estimate'
    }
  },
  {
    name: 'Test 2: Clear Activity (Path B)',
    data: {
      name: 'Test User 2',
      email: 'test2@example.com',
      company: 'Test Corp 2',
      province: 'British Columbia',
      revenue_range: '$1M - $3M',
      employee_count: '50 - 99 employees',
      hiring_plans: '6 – 10 people',
      training_budget: '$25K - $50K',
      expansion_budget: '$10K - $25K',
      planned_activities: 'Attending a food trade show in Germany next spring'
    },
    expected: {
      stored: 'Attending a food trade show in Germany next spring',
      injected: 'Planned Activities: Attending a food trade show in Germany next spring',
      path: 'B - immediate estimate with activity'
    }
  },
  {
    name: 'Test 3: Ambiguous Activity (Path C)',
    data: {
      name: 'Test User 3',
      email: 'test3@example.com',
      company: 'Test Corp 3',
      province: 'Ontario',
      revenue_range: '$3M - $5M',
      employee_count: '100 - 249 employees',
      hiring_plans: '11 – 20 people',
      training_budget: '$50K+',
      expansion_budget: '$50K+',
      planned_activities: 'Buying new equipment and expanding our operations'
    },
    expected: {
      stored: 'Buying new equipment and expanding our operations',
      injected: 'Planned Activities: Buying new equipment and expanding our operations',
      path: 'C - clarification question first'
    }
  },
  {
    name: 'Test 4: Non-Grantable Activity',
    data: {
      name: 'Test User 4',
      email: 'test4@example.com',
      company: 'Test Corp 4',
      province: 'Alberta',
      revenue_range: '$500K - $1M',
      employee_count: '10 - 49 employees',
      hiring_plans: '1 – 2 people',
      training_budget: 'None planned',
      expansion_budget: 'None planned',
      planned_activities: 'Purchasing a new commercial oven and kitchen equipment'
    },
    expected: {
      stored: 'Purchasing a new commercial oven and kitchen equipment',
      injected: 'Planned Activities: Purchasing a new commercial oven and kitchen equipment',
      path: 'B - honest response about non-grantable equipment'
    }
  },
  {
    name: 'Test 5: Complex Activity',
    data: {
      name: 'Test User 5',
      email: 'test5@example.com',
      company: 'Test Corp 5',
      province: 'British Columbia',
      revenue_range: '$5M - $10M',
      employee_count: '250 - 499 employees',
      hiring_plans: '20+ people',
      training_budget: '$50K+',
      expansion_budget: '$50K+',
      planned_activities: 'Developing an AI-powered predictive maintenance system for our manufacturing line'
    },
    expected: {
      stored: 'Developing an AI-powered predictive maintenance system for our manufacturing line',
      injected: 'Planned Activities: Developing an AI-powered predictive maintenance system for our manufacturing line',
      path: 'C - search_lead_gen_strategy for R&D/innovation'
    }
  },
  {
    name: 'Test 6: Verbose Activity',
    data: {
      name: 'Test User 6',
      email: 'test6@example.com',
      company: 'Test Corp 6',
      province: 'Quebec',
      revenue_range: '$1M - $3M',
      employee_count: '50 - 99 employees',
      hiring_plans: '3 – 5 people',
      training_budget: '$25K - $50K',
      expansion_budget: '$25K - $50K',
      planned_activities: 'We are planning to attend three major trade shows this year - one in Germany for food manufacturing, one in the US for retail buyers, and one in Asia for sourcing. We also want to hire 2-3 sales reps to cover new territories, send our management team through leadership training, and potentially set up a co-op program with the local college for summer students.'
    },
    expected: {
      stored: 'We are planning to attend three major trade shows this year - one in Germany for food manufacturing, one in the US for retail buyers, and one in Asia for sourcing. We also want to hire 2-3 sales reps to cover new territories, send our management team through leadership training, and potentially set up a co-op program with the local college for summer students.',
      injected: 'Planned Activities: We are planning to attend three major trade shows...',
      path: 'B - agent summarizes and addresses multiple activities'
    }
  }
];

async function testLeadGenInit(testCase) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Running: ${testCase.name}`);
  console.log(`${'='.repeat(80)}`);

  try {
    const response = await fetch(`${RAILWAY_URL}/api/lead-gen-init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...testCase.data,
        test_mode: TEST_MODE
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    console.log('\n✓ Response received successfully');
    console.log(`  Conversation ID: ${result.conversation_id}`);
    console.log(`  Agent Type: ${result.agent_type}`);

    if (result.form_data) {
      console.log('\n📋 Form Data:');
      console.log(`  Planned Activities: ${result.form_data.planned_activities || '(empty)'}`);
    }

    console.log('\n✓ Expected Behavior:');
    console.log(`  Path: ${testCase.expected.path}`);
    console.log(`  Should be stored as: ${testCase.expected.stored || '(null)'}`);
    console.log(`  Should be injected as: ${testCase.expected.injected}`);

    return {
      success: true,
      conversationId: result.conversation_id,
      testCase: testCase.name
    };

  } catch (error) {
    console.error(`\n✗ Test failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      testCase: testCase.name
    };
  }
}

async function verifyContextInjection(conversationId, testCase) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log('Verifying context injection in first agent message...');
  console.log(`${'─'.repeat(80)}`);

  try {
    // Send first message to trigger agent response
    const response = await fetch(`${RAILWAY_URL}/api/lead-gen-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: 'Hello', // Minimal message to trigger estimate
        test_mode: TEST_MODE
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // For SSE responses, we need to read the stream
    const text = await response.text();

    console.log('\n✓ Agent responded');
    console.log('\n📝 Response preview (first 300 chars):');
    console.log(text.substring(0, 300).replace(/data: /g, '').trim() + '...');

    // Check if the agent's response mentions the planned activity (for non-blank cases)
    if (testCase.data.planned_activities && testCase.data.planned_activities.length > 0) {
      const mentioned = text.toLowerCase().includes('trade show') ||
                        text.toLowerCase().includes('equipment') ||
                        text.toLowerCase().includes('expanding') ||
                        text.toLowerCase().includes('ai-powered') ||
                        text.toLowerCase().includes('activities');

      if (mentioned) {
        console.log('\n✓ Agent appears to reference planned activities in response');
      } else {
        console.log('\n⚠ Agent response may not reference planned activities (check manually)');
      }
    }

    return { success: true };

  } catch (error) {
    console.error(`\n✗ Context verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   PLANNED ACTIVITIES API TEST SUITE                                           ║');
  console.log('║   Testing: Form submission → Storage → Context injection                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${RAILWAY_URL}`);
  console.log(`Test Mode: ${TEST_MODE ? 'ENABLED (no HubSpot records created)' : 'DISABLED (real HubSpot records)'}`);
  console.log(`Total Tests: ${testCases.length}`);

  const results = [];

  for (const testCase of testCases) {
    const initResult = await testLeadGenInit(testCase);
    results.push(initResult);

    if (initResult.success && initResult.conversationId) {
      // Wait a moment for database to persist
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify context injection
      await verifyContextInjection(initResult.conversationId, testCase);
    }

    // Wait between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Summary
  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   TEST SUMMARY                                                                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed} ✓`);
  console.log(`Failed: ${failed} ${failed > 0 ? '✗' : ''}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  ✗ ${r.testCase}: ${r.error}`);
    });
  }

  console.log('\n');
  console.log('═'.repeat(80));
  console.log('MANUAL VERIFICATION REQUIRED:');
  console.log('═'.repeat(80));
  console.log('1. Check Railway logs for planned_activities in context injection');
  console.log('2. For Path C tests, verify agent asks clarifying question');
  console.log('3. For non-grantable tests, verify agent responds honestly');
  console.log('4. Test email summary personalization (click button in UI)');
  console.log('5. Check HubSpot notes include planned activities section');
  console.log('═'.repeat(80));
  console.log('\n');
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
