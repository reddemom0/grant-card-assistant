/**
 * Test Script for Feedback Learning System
 *
 * Tests the feedback learning pipeline locally
 */

import { runFeedbackLearning, runFeedbackLearningForAllAgents } from './src/feedback-learning/orchestrator.js';

async function main() {
  const args = process.argv.slice(2);
  const agentType = args[0] || 'all';

  console.log('\n🧪 Testing Feedback Learning System\n');

  try {
    if (agentType === 'all') {
      console.log('Running feedback learning for ALL agents...\n');
      const result = await runFeedbackLearningForAllAgents();

      console.log('\n📊 Results Summary:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Running feedback learning for: ${agentType}\n`);
      const result = await runFeedbackLearning(agentType);

      console.log('\n📊 Result:');
      console.log(JSON.stringify(result, null, 2));
    }

    console.log('\n✅ Test completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
