/**
 * Manually trigger feedback learning generation in PRODUCTION
 * This simulates what the /api/feedback-learning endpoint does
 */

// Set production DATABASE_URL BEFORE importing modules
process.env.DATABASE_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';

import { runFeedbackLearningForAllAgents } from './src/feedback-learning/orchestrator.js';

async function triggerProductionLearning() {
  console.log('🎯 Manually triggering learning generation in PRODUCTION database');
  console.log('📍 Database: nozomi.proxy.rlwy.net:16552\n');

  try {
    const result = await runFeedbackLearningForAllAgents();

    console.log('\n📊 Results:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }

  // Give time for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  process.exit(0);
}

triggerProductionLearning();
