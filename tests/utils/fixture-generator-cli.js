#!/usr/bin/env node

/**
 * CLI for Fixture Generator
 *
 * Generates test fixtures from knowledge base documents
 */

require('dotenv').config({ path: '../../.env' });

const {
  generateFixturesForAgent,
  generateAllFixtures
} = require('./fixture-generator');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m'
};

function colorPrint(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printUsage() {
  colorPrint('\n📁 Fixture Generator CLI\n', 'cyan');
  console.log('Usage:');
  console.log('  npm run fixtures:generate [command] [options]\n');
  console.log('Commands:');
  console.log('  all                  Generate fixtures for all agents');
  console.log('  <agent-name>         Generate fixtures for specific agent\n');
  console.log('Agent Names:');
  console.log('  canexport-claims     CanExport Claims auditing agent');
  console.log('  etg-writer           ETG Business Case writer');
  console.log('  grant-cards          Grant Cards creation agent');
  console.log('  bcafe-writer         BCAFE application writer\n');
  console.log('Options:');
  console.log('  --limit <n>          Limit number of files to process\n');
  console.log('Examples:');
  console.log('  npm run fixtures:generate all');
  console.log('  npm run fixtures:generate canexport-claims');
  console.log('  npm run fixtures:generate etg-writer --limit 5\n');
}

async function main() {
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  // Check for required environment variables
  const required = ['GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_SERVICE_ACCOUNT_KEY'];
  const missing = required.filter(v => !process.env[v]);

  if (missing.length > 0) {
    colorPrint(`\n❌ Error: Missing required environment variables: ${missing.join(', ')}\n`, 'red');
    process.exit(1);
  }

  // Parse options
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 && args[limitIndex + 1]
    ? parseInt(args[limitIndex + 1])
    : null;

  const options = { limit };

  try {
    if (command === 'all') {
      colorPrint('\n🚀 Generating fixtures for all agents...\n', 'cyan');
      const summary = await generateAllFixtures(options);

      colorPrint('\n✅ Fixture generation complete!\n', 'green');
      console.log('Summary:');
      console.log(`  Total fixtures: ${summary.total}`);
      console.log(`  Agents processed: ${Object.keys(summary.agents).length}`);

      if (summary.errors.length > 0) {
        colorPrint(`\n⚠️ Errors encountered: ${summary.errors.length}`, 'yellow');
        summary.errors.forEach(err => {
          console.log(`  - ${err.agent}: ${err.error}`);
        });
      }

    } else {
      // Generate for specific agent
      const validAgents = ['canexport-claims', 'etg-writer', 'grant-cards', 'bcafe-writer'];

      if (!validAgents.includes(command)) {
        colorPrint(`\n❌ Error: Unknown agent "${command}"`, 'red');
        colorPrint('Valid agents: ' + validAgents.join(', ') + '\n', 'yellow');
        process.exit(1);
      }

      colorPrint(`\n🚀 Generating fixtures for ${command}...\n`, 'cyan');
      const fixtures = await generateFixturesForAgent(command, options);

      colorPrint(`\n✅ Generated ${fixtures.length} fixtures for ${command}\n`, 'green');
    }

  } catch (error) {
    colorPrint(`\n❌ Error: ${error.message}\n`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
