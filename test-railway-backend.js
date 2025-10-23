#!/usr/bin/env node

/**
 * Railway Backend Test Script
 *
 * Tests the deployed backend to verify all endpoints work correctly.
 * Run: node test-railway-backend.js <RAILWAY_URL>
 */

import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

// Get Railway URL from command line or use default
const RAILWAY_URL = process.argv[2] || 'http://localhost:3000';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'cyan');
  console.log('='.repeat(80) + '\n');
}

/**
 * Test 1: Health Check
 */
async function testHealthCheck() {
  section('Test 1: Health Check');

  try {
    log(`Testing: ${RAILWAY_URL}/health`, 'blue');

    const response = await fetch(`${RAILWAY_URL}/health`);
    const data = await response.json();

    if (response.ok && data.status === 'healthy') {
      log('✅ Health check PASSED', 'green');
      log(`   Status: ${data.status}`, 'blue');
      log(`   Database: ${data.database?.connected ? 'Connected ✓' : 'Disconnected ✗'}`, 'blue');
      log(`   Agents: ${data.agents?.length || 0}`, 'blue');

      if (data.agents && data.agents.length > 0) {
        log(`   Available agents:`, 'blue');
        data.agents.forEach(agent => log(`     - ${agent}`, 'blue'));
      }

      return true;
    } else {
      log('❌ Health check FAILED', 'red');
      log(`   Status: ${data.status}`, 'yellow');
      log(`   Response: ${JSON.stringify(data, null, 2)}`, 'yellow');
      return false;
    }
  } catch (error) {
    log('❌ Health check ERROR', 'red');
    log(`   ${error.message}`, 'yellow');
    log(`   Make sure Railway URL is correct: ${RAILWAY_URL}`, 'yellow');
    return false;
  }
}

/**
 * Test 2: Agent Metadata
 */
async function testAgentMetadata() {
  section('Test 2: Agent Metadata Endpoint');

  try {
    log(`Testing: ${RAILWAY_URL}/api/agents`, 'blue');

    const response = await fetch(`${RAILWAY_URL}/api/agents`);
    const data = await response.json();

    if (response.ok) {
      log('✅ Agent metadata PASSED', 'green');
      log(`   Total agents: ${data.count}`, 'blue');

      if (data.agents) {
        data.agents.forEach(agent => {
          log(`   - ${agent.type}`, 'blue');
        });
      }

      return true;
    } else {
      log('❌ Agent metadata FAILED', 'red');
      log(`   Response: ${JSON.stringify(data, null, 2)}`, 'yellow');
      return false;
    }
  } catch (error) {
    log('❌ Agent metadata ERROR', 'red');
    log(`   ${error.message}`, 'yellow');
    return false;
  }
}

/**
 * Test 3: Simple Chat Request (SSE Streaming)
 */
async function testSimpleChat() {
  section('Test 3: Simple Chat Request (SSE Streaming)');

  try {
    log(`Testing: ${RAILWAY_URL}/api/chat`, 'blue');
    log('Sending: "Hello! Introduce yourself in one sentence."', 'blue');

    const response = await fetch(`${RAILWAY_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentType: 'grant-card-generator',
        message: 'Hello! Please introduce yourself in one sentence.'
        // userId omitted - will be treated as anonymous
      })
    });

    if (!response.ok) {
      log(`❌ Chat request FAILED: ${response.status}`, 'red');
      const error = await response.text();
      log(`   Error: ${error}`, 'yellow');
      return false;
    }

    log('✅ Connection established, receiving SSE stream...', 'green');
    console.log();

    // Read SSE stream
    const reader = response.body;
    let buffer = '';
    let textReceived = '';
    let connected = false;
    let completed = false;
    let sessionId = null;
    let conversationId = null;
    let toolsUsed = [];
    let tokenUsage = null;

    for await (const chunk of reader) {
      buffer += chunk.toString();

      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(line.substring(6));

          if (data.type === 'connected') {
            connected = true;
            sessionId = data.sessionId;
            conversationId = data.conversationId;
            log(`   → Connected (Session: ${sessionId?.substring(0, 8)}...)`, 'blue');
          } else if (data.type === 'message_start') {
            log(`   → Message started`, 'blue');
          } else if (data.type === 'text_delta') {
            textReceived += data.text;
            process.stdout.write(colors.green + data.text + colors.reset);
          } else if (data.type === 'thinking_delta') {
            // Thinking is happening (optional to show)
          } else if (data.type === 'tool_use') {
            toolsUsed.push({
              name: data.toolName,
              input: data.input
            });
            log(`\n   🔧 Tool used: ${data.toolName}`, 'yellow');
          } else if (data.type === 'tool_result') {
            log(`   ✓ Tool result received`, 'blue');
          } else if (data.type === 'usage') {
            tokenUsage = data.usage;
          } else if (data.type === 'done') {
            completed = true;
            console.log();
            log(`   → Stream completed`, 'blue');
            break;
          } else if (data.type === 'error') {
            log(`\n   ❌ Error: ${data.error}`, 'red');
            return false;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      if (completed) break;
    }

    console.log('\n');

    // Summary
    if (connected && textReceived.length > 0) {
      log('✅ Chat request PASSED', 'green');
      log(`   Received ${textReceived.length} characters`, 'blue');
      log(`   Conversation ID: ${conversationId?.substring(0, 8)}...`, 'blue');

      if (toolsUsed.length > 0) {
        log(`   Tools used: ${toolsUsed.length}`, 'blue');
        toolsUsed.forEach(tool => {
          log(`     - ${tool.name}`, 'blue');
        });
      }

      if (tokenUsage) {
        log(`   Token usage:`, 'blue');
        log(`     Input: ${tokenUsage.input_tokens}`, 'blue');
        log(`     Output: ${tokenUsage.output_tokens}`, 'blue');
        if (tokenUsage.cache_read_input_tokens) {
          log(`     Cache read: ${tokenUsage.cache_read_input_tokens}`, 'blue');
        }
      }

      return true;
    } else {
      log('❌ Chat request FAILED', 'red');
      log(`   Connected: ${connected}`, 'yellow');
      log(`   Text received: ${textReceived.length} chars`, 'yellow');
      return false;
    }
  } catch (error) {
    log('\n❌ Chat request ERROR', 'red');
    log(`   ${error.message}`, 'yellow');
    console.error(error);
    return false;
  }
}

/**
 * Test 4: Memory Tool
 */
async function testMemoryTool() {
  section('Test 4: Memory Tool');

  try {
    log('Testing memory storage...', 'blue');

    const response = await fetch(`${RAILWAY_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentType: 'grant-card-generator',
        message: 'Please use the memory_store tool to remember that my company is "TestCorp" and our revenue is $5M.'
        // conversationId omitted - will create new conversation
        // userId omitted - will be treated as anonymous
      })
    });

    if (!response.ok) {
      log(`❌ Memory test FAILED: ${response.status}`, 'red');
      return false;
    }

    // Read stream
    let toolUsed = false;
    const reader = response.body;
    let buffer = '';

    for await (const chunk of reader) {
      buffer += chunk.toString();

      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(line.substring(6));

          if (data.type === 'tool_use' && data.toolName === 'memory_store') {
            log(`   ✓ Memory tool used: ${data.toolName}`, 'green');
            log(`   Input: ${JSON.stringify(data.input)}`, 'blue');
            toolUsed = true;
          } else if (data.type === 'done') {
            break;
          }
        } catch (e) {
          // Ignore
        }
      }
    }

    if (toolUsed) {
      log('✅ Memory tool test PASSED', 'green');
      return true;
    } else {
      log('❌ Memory tool was not used', 'red');
      return false;
    }
  } catch (error) {
    log('❌ Memory test ERROR', 'red');
    log(`   ${error.message}`, 'yellow');
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '█'.repeat(80));
  log('Railway Backend Test Suite', 'cyan');
  log(`Testing: ${RAILWAY_URL}`, 'blue');
  console.log('█'.repeat(80));

  const results = {
    healthCheck: await testHealthCheck(),
    agentMetadata: await testAgentMetadata(),
    simpleChat: await testSimpleChat(),
    memoryTool: await testMemoryTool()
  };

  // Summary
  section('Test Summary');

  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([test, passed]) => {
    log(`${passed ? '✅' : '❌'} ${test}`, passed ? 'green' : 'red');
  });

  console.log('\n' + '='.repeat(80));
  if (passed === total) {
    log(`🎉 All tests passed! (${passed}/${total})`, 'green');
    log('\n✅ Backend is ready for frontend migration!', 'green');
  } else {
    log(`⚠️  Some tests failed (${passed}/${total})`, 'yellow');
    log('\n❌ Fix backend issues before migrating frontend', 'red');
  }
  console.log('='.repeat(80) + '\n');

  process.exit(passed === total ? 0 : 1);
}

// Run tests
if (!RAILWAY_URL || RAILWAY_URL === 'http://localhost:3000') {
  log('\n⚠️  Usage: node test-railway-backend.js <RAILWAY_URL>', 'yellow');
  log('Example: node test-railway-backend.js https://your-app.railway.app\n', 'yellow');
  log('Testing against localhost:3000 for now...\n', 'blue');
}

runAllTests().catch(error => {
  log('\n❌ Test suite error: ' + error.message, 'red');
  console.error(error);
  process.exit(1);
});
