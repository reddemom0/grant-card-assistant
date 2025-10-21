#!/usr/bin/env node

/**
 * Direct API Test Script
 *
 * Tests the new direct Claude API implementation:
 * - Server health check
 * - Agent metadata
 * - Simple chat request
 * - Memory tool usage
 * - Streaming response handling
 */

import fetch from 'node-fetch';
import { config } from 'dotenv';

config();

const API_URL = process.env.API_URL || 'http://localhost:3000';

// Colors for console output
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

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test 1: Health Check
 */
async function testHealthCheck() {
  section('Test 1: Health Check');

  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();

    if (response.ok && data.status === 'healthy') {
      log('✅ Health check passed', 'green');
      log(`   Status: ${data.status}`, 'blue');
      log(`   Database: ${data.database?.connected ? 'Connected' : 'Disconnected'}`, 'blue');
      log(`   Agents: ${data.agents?.length || 0}`, 'blue');
      return true;
    } else {
      log('❌ Health check failed', 'red');
      log(`   Status: ${data.status}`, 'yellow');
      return false;
    }
  } catch (error) {
    log('❌ Health check error: ' + error.message, 'red');
    return false;
  }
}

/**
 * Test 2: Get Available Agents
 */
async function testGetAgents() {
  section('Test 2: Get Available Agents');

  try {
    const response = await fetch(`${API_URL}/api/agents`);
    const data = await response.json();

    if (response.ok) {
      log('✅ Retrieved agent list', 'green');
      log(`   Count: ${data.count}`, 'blue');
      data.agents.forEach(agent => {
        log(`   - ${agent.type}: ${agent.name}`, 'blue');
      });
      return true;
    } else {
      log('❌ Failed to get agents', 'red');
      return false;
    }
  } catch (error) {
    log('❌ Get agents error: ' + error.message, 'red');
    return false;
  }
}

/**
 * Test 3: Simple Chat Request
 */
async function testSimpleChat() {
  section('Test 3: Simple Chat Request');

  try {
    log('Sending chat request...', 'cyan');

    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentType: 'grant-card-generator',
        message: 'Hello! Please introduce yourself briefly in one sentence.',
        userId: 'test-user'
      })
    });

    if (!response.ok) {
      log(`❌ Chat request failed: ${response.status}`, 'red');
      const error = await response.text();
      log(`   Error: ${error}`, 'yellow');
      return false;
    }

    log('Receiving SSE stream...', 'cyan');

    // Read SSE stream
    const reader = response.body;
    let buffer = '';
    let textReceived = '';
    let messageStarted = false;
    let completed = false;

    for await (const chunk of reader) {
      buffer += chunk.toString();

      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(line.substring(6));

          if (data.type === 'connected') {
            log(`✓ Connected - Session: ${data.sessionId}`, 'green');
            messageStarted = true;
          } else if (data.type === 'text_delta') {
            textReceived += data.text;
            process.stdout.write(colors.blue + data.text + colors.reset);
          } else if (data.type === 'done') {
            completed = true;
            console.log(); // New line
            log('✓ Stream completed', 'green');
          } else if (data.type === 'error') {
            log(`\n❌ Error: ${data.error}`, 'red');
            return false;
          } else if (data.type === 'usage') {
            log(`\n✓ Token usage:`, 'green');
            log(`   Input: ${data.usage.input_tokens}`, 'blue');
            log(`   Output: ${data.usage.output_tokens}`, 'blue');
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      if (completed) break;
    }

    if (messageStarted && textReceived.length > 0) {
      log('\n✅ Simple chat test passed', 'green');
      log(`   Received ${textReceived.length} characters`, 'blue');
      return true;
    } else {
      log('\n❌ Did not receive expected response', 'red');
      return false;
    }
  } catch (error) {
    log('\n❌ Chat test error: ' + error.message, 'red');
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
    log('Testing memory storage...', 'cyan');

    const conversationId = `test-memory-${Date.now()}`;

    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentType: 'grant-card-generator',
        message: 'Please store this information: my company name is "Test Corp" and our revenue is $2.5M. Use the memory_store tool to remember this.',
        conversationId,
        userId: 'test-user'
      })
    });

    if (!response.ok) {
      log(`❌ Memory storage failed: ${response.status}`, 'red');
      return false;
    }

    // Read stream until done
    let toolUsed = false;
    const reader = response.body;
    let buffer = '';

    for await (const chunk of reader) {
      buffer += chunk.toString();

      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(line.substring(6));

          if (data.type === 'tool_use' && data.toolName === 'memory_store') {
            log(`✓ Memory tool used: ${data.toolName}`, 'green');
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
      log('✅ Memory tool test passed', 'green');
      return true;
    } else {
      log('❌ Memory tool was not used', 'red');
      return false;
    }
  } catch (error) {
    log('❌ Memory test error: ' + error.message, 'red');
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n' + '█'.repeat(80));
  log('Direct Claude API Test Suite', 'cyan');
  log(`API URL: ${API_URL}`, 'blue');
  console.log('█'.repeat(80));

  const results = {
    healthCheck: await testHealthCheck(),
    getAgents: await testGetAgents(),
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
  } else {
    log(`⚠️  Some tests failed (${passed}/${total})`, 'yellow');
  }
  console.log('='.repeat(80) + '\n');

  process.exit(passed === total ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  log('\n❌ Test suite error: ' + error.message, 'red');
  console.error(error);
  process.exit(1);
});
