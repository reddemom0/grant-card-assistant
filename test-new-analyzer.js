/**
 * Test the new AI-powered analyzer on canexport-claims
 * Compare with existing learning files to show improvement
 */

import { runFeedbackLearning } from './src/feedback-learning/orchestrator.js';

async function testNewAnalyzer() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING NEW AI-POWERED ANALYZER');
  console.log('='.repeat(80) + '\n');

  console.log('Testing on: canexport-claims (has the advertising correction)');
  console.log('Expected: Should extract specific rule about trade event ads vs email newsletters\n');

  try {
    const result = await runFeedbackLearning('canexport-claims');

    if (result.success) {
      console.log('\n✅ Analysis completed successfully!');
      console.log('\nResult summary:');
      console.log(JSON.stringify(result.report, null, 2));
    } else {
      console.log('\n❌ Analysis failed:', result.error);
    }

    // Exit process
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

testNewAnalyzer();
