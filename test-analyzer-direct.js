/**
 * Test new analyzer with direct DATABASE_URL connection
 */

// Set environment variables directly
process.env.DATABASE_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-api03-...'; // Use existing key

import { runFeedbackLearning } from './src/feedback-learning/orchestrator.js';

async function testAnalyzer() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING AI-POWERED ANALYZER');
  console.log('='.repeat(80) + '\n');

  console.log('Agent: canexport-claims');
  console.log('Key test: Should extract advertising eligibility rule\n');

  try {
    console.log('Running analysis...\n');
    const result = await runFeedbackLearning('canexport-claims');

    if (result.success) {
      console.log('\n✅ SUCCESS!\n');
      console.log('Files written:', result.filesWritten);
      console.log('\nReport summary:');
      console.log('- Success patterns:', result.report.successPatterns);
      console.log('- Error patterns:', result.report.errorPatterns);
      console.log('- Corrections:', result.report.corrections);
    } else {
      console.log('\n❌ FAILED:', result.status, result.error);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

testAnalyzer();
