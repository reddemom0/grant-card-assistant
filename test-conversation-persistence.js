#!/usr/bin/env node

/**
 * Conversation Persistence Test Runner
 *
 * Quick script to run conversation persistence tests
 * Usage: node test-conversation-persistence.js [unit|api|all]
 */

import { execSync } from 'child_process';
import { config } from 'dotenv';

config();

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function print(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printHeader(title) {
  console.log('\n' + '='.repeat(70));
  print(title, 'cyan');
  console.log('='.repeat(70) + '\n');
}

function checkEnv() {
  const required = ['DATABASE_URL'];
  const optional = ['TEST_AUTH_COOKIE', 'JWT_SECRET'];

  print('🔍 Checking environment variables...\n', 'cyan');

  let allGood = true;

  for (const varName of required) {
    if (process.env[varName]) {
      print(`  ✓ ${varName} is set`, 'green');
    } else {
      print(`  ✗ ${varName} is NOT set (required)`, 'red');
      allGood = false;
    }
  }

  for (const varName of optional) {
    if (process.env[varName]) {
      print(`  ✓ ${varName} is set`, 'green');
    } else {
      print(`  ⚠ ${varName} is NOT set (some tests will be skipped)`, 'yellow');
    }
  }

  console.log('');
  return allGood;
}

function runCommand(command, description) {
  try {
    print(`▶ ${description}`, 'cyan');
    execSync(command, { stdio: 'inherit', cwd: process.cwd() });
    print(`✅ ${description} - PASSED\n`, 'green');
    return true;
  } catch (error) {
    print(`❌ ${description} - FAILED\n`, 'red');
    return false;
  }
}

async function runDatabaseTests() {
  printHeader('Database Unit Tests');
  return runCommand(
    'npx jest tests/unit/database-messages.test.js --verbose',
    'Database operations (conversations, messages)'
  );
}

async function runAPITests() {
  printHeader('API Integration Tests');

  if (!process.env.TEST_AUTH_COOKIE) {
    print('⚠️  Warning: TEST_AUTH_COOKIE not set', 'yellow');
    print('   API tests will be skipped. See tests/README-CONVERSATION-PERSISTENCE.md\n', 'yellow');
  }

  return runCommand(
    'npx jest tests/integration/conversation-api.test.js --verbose',
    'API endpoints (chat, list, load, delete)'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'all';

  print('\n💬 Conversation Persistence Test Suite\n', 'magenta');

  // Check environment
  if (!checkEnv()) {
    print('❌ Missing required environment variables. Set DATABASE_URL and try again.\n', 'red');
    process.exit(1);
  }

  let results = [];

  if (mode === 'unit' || mode === 'all') {
    results.push(await runDatabaseTests());
  }

  if (mode === 'api' || mode === 'all') {
    results.push(await runAPITests());
  }

  if (mode !== 'unit' && mode !== 'api' && mode !== 'all') {
    print(`❌ Unknown mode: ${mode}`, 'red');
    print('   Usage: node test-conversation-persistence.js [unit|api|all]\n', 'yellow');
    process.exit(1);
  }

  // Summary
  printHeader('Test Summary');

  const passed = results.filter(r => r).length;
  const total = results.length;

  if (passed === total) {
    print(`✅ All test suites passed! (${passed}/${total})\n`, 'green');
    process.exit(0);
  } else {
    print(`❌ Some test suites failed (${passed}/${total} passed)\n`, 'red');
    process.exit(1);
  }
}

main().catch(error => {
  print(`\n❌ Error: ${error.message}\n`, 'red');
  process.exit(1);
});
