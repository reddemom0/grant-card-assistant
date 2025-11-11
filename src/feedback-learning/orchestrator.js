/**
 * Feedback Learning Orchestrator
 *
 * Main entry point for feedback learning system.
 * Analyzes feedback and updates agent memory files.
 */

import { generateLearningReport } from './analyzer.js';
import { writeLearnedPatterns } from './memory-writer.js';
import { getAgentTypesWithFeedback } from './retrieval.js';

/**
 * Run feedback learning for a specific agent
 * @param {string} agentType - Agent type to process
 * @returns {Promise<Object>} Processing result
 */
export async function runFeedbackLearning(agentType) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧠 Running Feedback Learning: ${agentType}`);
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Generate learning report
    console.log(`📊 Step 1: Analyzing feedback...`);
    const report = await generateLearningReport(agentType);

    if (!report.summary.hasLearnings) {
      console.log(`ℹ️  No feedback data available for ${agentType} yet`);
      return {
        success: true,
        agentType,
        status: 'no-data',
        message: 'No feedback data to process'
      };
    }

    console.log(`✅ Analysis complete:`);
    console.log(`   - ${report.successPatterns.count} success patterns`);
    console.log(`   - ${report.errorPatterns.count} error patterns`);
    console.log(`   - ${report.corrections.count} user corrections`);

    // 2. Write to memory files
    console.log(`\n📝 Step 2: Writing to memory files...`);
    const writeResult = await writeLearnedPatterns(agentType, report);

    console.log(`\n✅ Memory update complete:`);
    console.log(`   - ${writeResult.filesWritten.length} files written`);
    if (writeResult.errors.length > 0) {
      console.log(`   - ${writeResult.errors.length} errors occurred`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Feedback Learning Complete: ${agentType}`);
    console.log('='.repeat(80) + '\n');

    return {
      success: true,
      agentType,
      status: 'completed',
      report: {
        totalFeedback: report.stats.totalFeedback,
        positiveRate: report.stats.positiveRate,
        averageQuality: report.stats.averageQuality,
        successPatterns: report.successPatterns.count,
        errorPatterns: report.errorPatterns.count,
        corrections: report.corrections.count
      },
      filesWritten: writeResult.filesWritten,
      errors: writeResult.errors
    };

  } catch (error) {
    console.error(`\n❌ Error running feedback learning for ${agentType}:`, error);

    return {
      success: false,
      agentType,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Run feedback learning for all agents with feedback
 * @returns {Promise<Object[]>} Results for all agents
 */
export async function runFeedbackLearningForAllAgents() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧠 Running Feedback Learning: ALL AGENTS`);
  console.log('='.repeat(80) + '\n');

  try {
    // Get all agents that have feedback
    const agentsWithFeedback = await getAgentTypesWithFeedback();

    if (agentsWithFeedback.length === 0) {
      console.log(`ℹ️  No agents have feedback data yet`);
      return {
        success: true,
        totalAgents: 0,
        results: []
      };
    }

    console.log(`📋 Found ${agentsWithFeedback.length} agents with feedback:`);
    agentsWithFeedback.forEach(agent => {
      console.log(`   - ${agent.agent_type} (${agent.feedback_count} feedback items)`);
    });
    console.log('');

    // Process each agent
    const results = [];
    for (const agent of agentsWithFeedback) {
      const result = await runFeedbackLearning(agent.agent_type);
      results.push(result);
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const noData = results.filter(r => r.status === 'no-data').length;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Feedback Learning Complete: ALL AGENTS`);
    console.log('='.repeat(80));
    console.log(`   Total: ${results.length} agents`);
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ℹ️  No data: ${noData}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('='.repeat(80) + '\n');

    return {
      success: true,
      totalAgents: results.length,
      successful,
      noData,
      failed,
      results
    };

  } catch (error) {
    console.error(`\n❌ Error running feedback learning for all agents:`, error);

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get learning status for an agent
 * @param {string} agentType - Agent type
 * @returns {Promise<Object>} Learning status
 */
export async function getLearningStatus(agentType) {
  try {
    const report = await generateLearningReport(agentType);

    return {
      agentType,
      hasData: report.summary.hasLearnings,
      stats: report.stats,
      lastGenerated: report.generatedAt,
      counts: {
        successPatterns: report.successPatterns.count,
        errorPatterns: report.errorPatterns.count,
        corrections: report.corrections.count
      }
    };

  } catch (error) {
    return {
      agentType,
      hasData: false,
      error: error.message
    };
  }
}
