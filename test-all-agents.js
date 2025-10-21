import fetch from 'node-fetch';

const RAILWAY_URL = 'https://grant-card-assistant-production.up.railway.app';

const agentTests = [
  {
    name: 'Grant Card Generator',
    agentType: 'grant-card-generator',
    message: `I need help creating a grant card. Can you:
1. Tell me what tools you have available
2. Try to search for grant documents in the knowledge base using gdrive_search
3. Explain your workflow for creating grant cards

This is a test to verify your tools and MCP access work.`,
    expectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'TodoWrite', 'Memory'],
    testMCP: true
  },
  {
    name: 'ETG Writer',
    agentType: 'etg-writer',
    message: `Hello! I'm testing your capabilities. Can you:
1. Introduce yourself and your role
2. List the tools you have access to
3. Explain your workflow for ETG business cases

This is a test to verify you're configured correctly.`,
    expectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Memory'],
    testMCP: true
  },
  {
    name: 'BCAFE Writer',
    agentType: 'bcafe-writer',
    message: `Hi! I'm testing your setup. Can you:
1. Introduce yourself
2. Tell me what tools you can use
3. Explain how you help with BCAFE applications

This is a functionality test.`,
    expectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Memory'],
    testMCP: true
  },
  {
    name: 'CanExport Claims Auditor',
    agentType: 'canexport-claims',
    message: `Hello! Testing your configuration. Please:
1. Introduce yourself and your audit role
2. List your available tools
3. Explain your dual-mode auditing approach

This is a setup verification test.`,
    expectedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'TodoWrite', 'Memory'],
    testMCP: true
  }
];

async function testAgent(test) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Testing: ${test.name}`);
  console.log(`${'='.repeat(60)}\n`);

  const conversationId = `test-${test.agentType}-${Date.now()}`;

  try {
    const response = await fetch(`${RAILWAY_URL}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentType: test.agentType,
        conversationId,
        userId: 'test-user-agent-verification',
        message: test.message,
      }),
    });

    if (!response.ok) {
      console.error(`❌ HTTP Error: ${response.status}`);
      return false;
    }

    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.startsWith('data: '));

    let fullResponse = '';
    let hasContent = false;
    let hasComplete = false;
    let hasError = false;
    let toolsUsed = [];
    let cost = 0;

    for (const event of events) {
      try {
        const data = JSON.parse(event.replace('data: ', ''));

        if (data.type === 'content') {
          fullResponse += data.text;
          hasContent = true;
        } else if (data.type === 'complete') {
          hasComplete = true;
          cost = data.cost || 0;
        } else if (data.type === 'error') {
          hasError = true;
          console.error(`❌ Error: ${data.error}`);
        } else if (data.type === 'tool_use') {
          toolsUsed.push(data.tool);
          console.log(`  🔧 Tool used: ${data.tool}`);
        }
      } catch (e) {
        // Skip malformed events
      }
    }

    console.log(`\n📝 Response Preview (first 500 chars):`);
    console.log(fullResponse.substring(0, 500) + '...\n');

    console.log(`📊 Test Results:`);
    console.log(`  ✅ Has content: ${hasContent}`);
    console.log(`  ✅ Completed: ${hasComplete}`);
    console.log(`  ❌ Errors: ${hasError}`);
    console.log(`  🔧 Tools used: ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'None'}`);
    console.log(`  💰 Cost: $${cost.toFixed(4)}`);

    if (test.testMCP) {
      const hasMCPReference = fullResponse.toLowerCase().includes('gdrive') ||
                              fullResponse.toLowerCase().includes('google drive') ||
                              fullResponse.toLowerCase().includes('knowledge base');
      console.log(`  📁 MCP mentioned: ${hasMCPReference}`);
    }

    const success = hasContent && hasComplete && !hasError;
    console.log(`\n${success ? '✅ PASS' : '❌ FAIL'}: ${test.name}\n`);

    return success;

  } catch (error) {
    console.error(`❌ Test failed with error: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('\n🚀 Starting Agent Verification Tests\n');
  console.log(`Testing ${agentTests.length} agents on Railway...\n`);

  const results = [];

  for (const test of agentTests) {
    const result = await testAgent(test);
    results.push({ name: test.name, passed: result });

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(60) + '\n');

  results.forEach(r => {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
  });

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  console.log(`\n🎯 Score: ${passed}/${total} agents working correctly\n`);

  if (passed === total) {
    console.log('🎉 All agents are operational!\n');
  } else {
    console.log('⚠️  Some agents need attention.\n');
  }
}

runAllTests();
