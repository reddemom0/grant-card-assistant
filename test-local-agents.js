#!/usr/bin/env node

/**
 * Local Agent Testing Script
 *
 * Tests all 4 agents via the /api/chat endpoint
 */

const BASE_URL = 'http://localhost:3000';

async function testAgent(agentType, message) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${agentType}`);
  console.log('='.repeat(60));

  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentType,
        message,
        stream: false, // Non-streaming for easier testing
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(`❌ Error: ${error.error}`);
      return false;
    }

    const data = await response.json();

    console.log(`✅ Response received`);
    console.log(`   Conversation ID: ${data.conversationId}`);
    console.log(`   Message count: ${data.messageCount}`);
    console.log(`   Input tokens: ${data.usage.input_tokens}`);
    console.log(`   Output tokens: ${data.usage.output_tokens}`);
    console.log(`\n📝 Response preview (first 500 chars):`);
    console.log(data.message.substring(0, 500) + '...\n');

    return true;
  } catch (error) {
    console.error(`❌ Request failed:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🧪 Testing All Agents Locally\n');

  const tests = [
    {
      agentType: 'grant-cards',
      message: 'What are the key types of grant cards you can create?',
    },
    {
      agentType: 'etg-writer',
      message: 'What is the BC Employer Training Grant program?',
    },
    {
      agentType: 'bcafe-writer',
      message: 'What is the BC Agriculture and Food Export Program?',
    },
    {
      agentType: 'canexport-claims',
      message: 'What are the 8 expense categories for CanExport claims?',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await testAgent(test.agentType, test.message);
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passed}/${tests.length}`);
  console.log(`❌ Failed: ${failed}/${tests.length}`);

  if (failed === 0) {
    console.log('\n🎉 All agents working correctly!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Check logs above.\n');
    process.exit(1);
  }
}

main();
