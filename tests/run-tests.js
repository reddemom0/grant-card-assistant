#!/usr/bin/env node

/**
 * Test Runner for Grant Card Assistant
 *
 * Orchestrates test execution, collects results, and generates reports
 */

const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { generateReportSummary } = require('./utils/evaluation-metrics');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Print colored message to console
 */
function colorPrint(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Print test suite header
 */
function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  colorPrint(title, 'cyan');
  console.log('='.repeat(60) + '\n');
}

/**
 * Run Jest tests
 *
 * @param {string} pattern - Test file pattern (optional)
 * @param {Object} options - Jest options
 * @returns {Object} Test results
 */
function runJestTests(pattern = '', options = {}) {
  const {
    coverage = false,
    verbose = true,
    bail = false
  } = options;

  let command = 'npx jest';

  if (pattern) {
    command += ` ${pattern}`;
  }

  if (coverage) {
    command += ' --coverage';
  }

  if (verbose) {
    command += ' --verbose';
  }

  if (bail) {
    command += ' --bail';
  }

  command += ' --config tests/jest.config.js';

  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Run unit tests
 */
async function runUnitTests() {
  printHeader('Running Unit Tests');

  const result = runJestTests('tests/unit', {
    coverage: false,
    verbose: true
  });

  if (result.success) {
    colorPrint('✅ Unit tests passed', 'green');
  } else {
    colorPrint('❌ Unit tests failed', 'red');
  }

  return result;
}

/**
 * Run integration tests
 */
async function runIntegrationTests() {
  printHeader('Running Integration Tests');

  const result = runJestTests('tests/integration', {
    coverage: false,
    verbose: true
  });

  if (result.success) {
    colorPrint('✅ Integration tests passed', 'green');
  } else {
    colorPrint('❌ Integration tests failed', 'red');
  }

  return result;
}

/**
 * Run all tests with coverage
 */
async function runAllTestsWithCoverage() {
  printHeader('Running All Tests with Coverage');

  const result = runJestTests('', {
    coverage: true,
    verbose: true
  });

  if (result.success) {
    colorPrint('✅ All tests passed', 'green');
  } else {
    colorPrint('❌ Some tests failed', 'red');
  }

  return result;
}

/**
 * Run tests for specific agent
 *
 * @param {string} agent - Agent name
 */
async function runAgentTests(agent) {
  printHeader(`Running Tests for ${agent}`);

  const result = runJestTests(`tests/**/*${agent}*.test.js`, {
    coverage: false,
    verbose: true
  });

  if (result.success) {
    colorPrint(`✅ ${agent} tests passed`, 'green');
  } else {
    colorPrint(`❌ ${agent} tests failed`, 'red');
  }

  return result;
}

/**
 * Generate test report
 */
async function generateReport() {
  printHeader('Generating Test Report');

  const reportDir = path.join(__dirname, 'reports');
  await fs.mkdir(reportDir, { recursive: true });

  // Check if Jest results exist
  const resultsPath = path.join(reportDir, 'jest-results.json');

  try {
    await fs.access(resultsPath);
    colorPrint('Test results found, generating report...', 'cyan');

    const resultsContent = await fs.readFile(resultsPath, 'utf8');
    const results = JSON.parse(resultsContent);

    // Generate HTML report
    const htmlReport = generateHTMLReport(results);
    const htmlPath = path.join(reportDir, 'test-report.html');
    await fs.writeFile(htmlPath, htmlReport, 'utf8');

    colorPrint(`✅ Report generated: ${htmlPath}`, 'green');

  } catch (error) {
    colorPrint('⚠️ No test results found. Run tests first.', 'yellow');
  }
}

/**
 * Generate HTML report from test results
 *
 * @param {Object} results - Jest test results
 * @returns {string} HTML content
 */
function generateHTMLReport(results) {
  const timestamp = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grant Card Assistant - Test Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 40px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0 0 10px 0;
    }
    .header p {
      margin: 0;
      opacity: 0.9;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card h3 {
      margin: 0 0 10px 0;
      color: #666;
      font-size: 14px;
      text-transform: uppercase;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #333;
    }
    .summary-card.passed .value {
      color: #10b981;
    }
    .summary-card.failed .value {
      color: #ef4444;
    }
    .test-suite {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .test-suite h2 {
      margin: 0 0 15px 0;
      color: #333;
    }
    .test-case {
      padding: 10px;
      border-left: 4px solid #10b981;
      background: #f0fdf4;
      margin-bottom: 10px;
      border-radius: 4px;
    }
    .test-case.failed {
      border-left-color: #ef4444;
      background: #fef2f2;
    }
    .test-case .name {
      font-weight: 500;
      margin-bottom: 5px;
    }
    .test-case .duration {
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Grant Card Assistant - Test Report</h1>
    <p>Generated: ${timestamp}</p>
  </div>

  <div class="summary">
    <div class="summary-card">
      <h3>Total Tests</h3>
      <div class="value">${results.numTotalTests || 0}</div>
    </div>
    <div class="summary-card passed">
      <h3>Passed</h3>
      <div class="value">${results.numPassedTests || 0}</div>
    </div>
    <div class="summary-card failed">
      <h3>Failed</h3>
      <div class="value">${results.numFailedTests || 0}</div>
    </div>
    <div class="summary-card">
      <h3>Pass Rate</h3>
      <div class="value">${results.numTotalTests > 0 ? ((results.numPassedTests / results.numTotalTests) * 100).toFixed(1) : 0}%</div>
    </div>
  </div>

  <div class="test-suite">
    <h2>Test Results</h2>
    <p>Detailed results will be available once Jest reporter is configured.</p>
  </div>
</body>
</html>`;
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  colorPrint('\n🧪 Grant Card Assistant - Test Runner\n', 'magenta');

  switch (command) {
    case 'unit':
      await runUnitTests();
      break;

    case 'integration':
      await runIntegrationTests();
      break;

    case 'coverage':
      await runAllTestsWithCoverage();
      break;

    case 'agent':
      const agentName = args[1];
      if (!agentName) {
        colorPrint('❌ Please specify agent name: npm run test:agent <agent-name>', 'red');
        process.exit(1);
      }
      await runAgentTests(agentName);
      break;

    case 'report':
      await generateReport();
      break;

    case 'all':
    default:
      const unitResult = await runUnitTests();
      const integrationResult = await runIntegrationTests();

      console.log('\n' + '='.repeat(60));
      colorPrint('Test Summary', 'cyan');
      console.log('='.repeat(60));

      if (unitResult.success && integrationResult.success) {
        colorPrint('\n✅ All tests passed!\n', 'green');
        process.exit(0);
      } else {
        colorPrint('\n❌ Some tests failed. See details above.\n', 'red');
        process.exit(1);
      }
  }
}

// Run CLI if executed directly
if (require.main === module) {
  main().catch(error => {
    colorPrint(`\n❌ Error: ${error.message}\n`, 'red');
    process.exit(1);
  });
}

module.exports = {
  runUnitTests,
  runIntegrationTests,
  runAllTestsWithCoverage,
  runAgentTests,
  generateReport
};
