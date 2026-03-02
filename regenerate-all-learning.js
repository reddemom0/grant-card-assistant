/**
 * Regenerate all learning files using the new AI-powered analyzer
 *
 * Run in production: railway run node regenerate-all-learning.js
 */

import { runFeedbackLearningForAllAgents } from './src/feedback-learning/orchestrator.js';

async function regenerateAll() {
  console.log('\n' + '='.repeat(80));
  console.log('REGENERATING ALL LEARNING FILES WITH AI ANALYZER');
  console.log('='.repeat(80) + '\n');

  console.log('This will:');
  console.log('1. Analyze all existing feedback using Claude Haiku');
  console.log('2. Extract specific, actionable corrections');
  console.log('3. Generate new learning files for all agents');
  console.log('4. Store in learning_memory_files table\n');

  try {
    const result = await runFeedbackLearningForAllAgents();

    if (result.success) {
      console.log('\n' + '='.repeat(80));
      console.log('✅ SUCCESS');
      console.log('='.repeat(80));
      console.log(`\nProcessed ${result.totalAgents} agents:`);
      console.log(`  ✅ Successful: ${result.successful}`);
      console.log(`  ℹ️  No data: ${result.noData}`);
      console.log(`  ❌ Failed: ${result.failed}\n`);

      if (result.results && result.results.length > 0) {
        console.log('Details:');
        result.results.forEach(r => {
          if (r.status === 'completed') {
            console.log(`\n  ${r.agentType}:`);
            console.log(`    - Files written: ${r.filesWritten.join(', ')}`);
            console.log(`    - Success patterns: ${r.report.successPatterns}`);
            console.log(`    - Error patterns: ${r.report.errorPatterns}`);
            console.log(`    - Corrections: ${r.report.corrections}`);
          } else if (r.status === 'no-data') {
            console.log(`\n  ${r.agentType}: No feedback data yet`);
          } else if (r.status === 'error') {
            console.log(`\n  ${r.agentType}: ❌ Error - ${r.error}`);
          }
        });
      }

      console.log('\n' + '='.repeat(80));
      console.log('Next: Verify files with: node check-learning-files.js');
      console.log('='.repeat(80) + '\n');

    } else {
      console.log('\n❌ FAILED');
      console.log('Error:', result.error);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

regenerateAll();
