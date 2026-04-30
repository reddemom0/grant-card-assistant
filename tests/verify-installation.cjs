#!/usr/bin/env node

/**
 * Verify Testing Framework Installation
 *
 * Checks that all required files and dependencies are present
 */

const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function colorPrint(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

console.log('\n' + '='.repeat(60));
colorPrint('Testing Framework Installation Verification', 'cyan');
console.log('='.repeat(60) + '\n');

let allChecksPass = true;

// Check directories
const requiredDirs = [
  'tests/unit',
  'tests/integration',
  'tests/fixtures',
  'tests/utils',
  'tests/reports'
];

colorPrint('📁 Checking Directory Structure...', 'cyan');
requiredDirs.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  if (fs.existsSync(fullPath)) {
    console.log(`  ✅ ${dir}`);
  } else {
    console.log(`  ❌ ${dir} - MISSING`);
    allChecksPass = false;
  }
});

// Check utility files
const requiredFiles = [
  'tests/utils/test-helpers.js',
  'tests/utils/llm-grader.js',
  'tests/utils/evaluation-metrics.js',
  'tests/utils/fixture-generator.js',
  'tests/utils/fixture-generator-cli.js',
  'tests/jest.config.js',
  'tests/setup.js',
  'tests/run-tests.js',
  'tests/README.md',
  'tests/WRITING-TESTS.md',
  'tests/PHASE-1-COMPLETE.md'
];

colorPrint('\n📄 Checking Required Files...', 'cyan');
requiredFiles.forEach(file => {
  const fullPath = path.join(__dirname, '..', file);
  if (fs.existsSync(fullPath)) {
    const stats = fs.statSync(fullPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`  ✅ ${file} (${sizeKB} KB)`);
  } else {
    console.log(`  ❌ ${file} - MISSING`);
    allChecksPass = false;
  }
});

// Check package.json scripts
colorPrint('\n📦 Checking Package Scripts...', 'cyan');
const packageJsonPath = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const requiredScripts = [
    'test',
    'test:unit',
    'test:integration',
    'test:coverage',
    'test:agent',
    'test:report',
    'fixtures:generate'
  ];

  requiredScripts.forEach(script => {
    if (packageJson.scripts && packageJson.scripts[script]) {
      console.log(`  ✅ npm run ${script}`);
    } else {
      console.log(`  ❌ npm run ${script} - MISSING`);
      allChecksPass = false;
    }
  });
} else {
  console.log('  ❌ package.json not found');
  allChecksPass = false;
}

// Check environment variables
colorPrint('\n🔐 Checking Environment Variables...', 'cyan');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (error) {
  console.log('  ℹ️  dotenv not installed yet (will be installed with: npm install)');
}

const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN'
];

requiredEnvVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`  ✅ ${varName}`);
  } else {
    console.log(`  ⚠️  ${varName} - NOT SET (required for fixture generation and testing)`);
  }
});

// Count lines of code
colorPrint('\n📊 Code Statistics...', 'cyan');
let totalLines = 0;
const utilFiles = [
  'tests/utils/test-helpers.js',
  'tests/utils/llm-grader.js',
  'tests/utils/evaluation-metrics.js',
  'tests/utils/fixture-generator.js',
  'tests/utils/fixture-generator-cli.js',
  'tests/jest.config.js',
  'tests/setup.js',
  'tests/run-tests.js'
];

utilFiles.forEach(file => {
  const fullPath = path.join(__dirname, '..', file);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n').length;
    totalLines += lines;
  }
});

console.log(`  Total Infrastructure Code: ${totalLines} lines`);

// Final summary
console.log('\n' + '='.repeat(60));
if (allChecksPass) {
  colorPrint('✅ Installation Complete - All Checks Passed!', 'green');
  console.log('\nNext Steps:');
  console.log('  1. Generate fixtures: npm run fixtures:generate all');
  console.log('  2. Read guides: tests/README.md and tests/WRITING-TESTS.md');
  console.log('  3. Create example tests (Phase 2)');
  console.log('  4. Run tests: npm test\n');
} else {
  colorPrint('❌ Installation Incomplete - Some Checks Failed', 'red');
  console.log('\nPlease review errors above and fix missing components.\n');
  process.exit(1);
}
console.log('='.repeat(60) + '\n');
