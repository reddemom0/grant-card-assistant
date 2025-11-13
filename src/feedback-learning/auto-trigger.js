/**
 * Auto-Trigger Learning Generation
 *
 * Automatically triggers learning generation when feedback threshold is reached.
 * This runs in the background after feedback is submitted.
 */

import { runFeedbackLearning } from './orchestrator.js';
import { query } from '../database/connection.js';

// Threshold: trigger learning after N new feedback items
const FEEDBACK_THRESHOLD = 5;

/**
 * Check if learning generation should be triggered for an agent
 * @param {string} agentType - Agent type to check
 * @returns {Promise<boolean>} True if learning should be regenerated
 */
async function shouldRegenerateLearnings(agentType) {
  try {
    // Get last learning generation time for this agent
    const lastGenResult = await query(
      `SELECT MAX(updated_at) as last_updated
       FROM learning_memory_files
       WHERE agent_type = $1`,
      [agentType]
    );

    const lastUpdated = lastGenResult.rows[0]?.last_updated;

    if (!lastUpdated) {
      // No learning files exist yet - generate if there's any feedback
      const feedbackCount = await query(
        `SELECT COUNT(*) as count
         FROM conversation_feedback cf
         JOIN conversations c ON cf.conversation_id = c.id
         WHERE c.agent_type = $1`,
        [agentType]
      );

      return parseInt(feedbackCount.rows[0].count) > 0;
    }

    // Count new feedback since last learning generation
    const newFeedbackResult = await query(
      `SELECT COUNT(*) as count
       FROM conversation_feedback cf
       JOIN conversations c ON cf.conversation_id = c.id
       WHERE c.agent_type = $1
       AND cf.created_at > $2`,
      [agentType, lastUpdated]
    );

    const newFeedbackCount = parseInt(newFeedbackResult.rows[0].count);

    console.log(`📊 Learning check for ${agentType}: ${newFeedbackCount} new feedback items (threshold: ${FEEDBACK_THRESHOLD})`);

    return newFeedbackCount >= FEEDBACK_THRESHOLD;

  } catch (error) {
    console.error(`Error checking learning threshold for ${agentType}:`, error);
    return false;
  }
}

/**
 * Auto-trigger learning generation if threshold reached
 * This runs asynchronously in the background
 *
 * @param {string} agentType - Agent type to check
 */
export async function autoTriggerLearningGeneration(agentType) {
  try {
    const shouldRegenerate = await shouldRegenerateLearnings(agentType);

    if (shouldRegenerate) {
      console.log(`🧠 Auto-triggering learning generation for ${agentType} (threshold reached)`);

      // Run learning generation asynchronously (don't await)
      runFeedbackLearning(agentType)
        .then(result => {
          if (result.success) {
            console.log(`✅ Auto-generated learning files for ${agentType}:`, result.filesWritten);
          } else {
            console.log(`ℹ️  Learning generation for ${agentType}: ${result.status}`);
          }
        })
        .catch(error => {
          console.error(`❌ Auto-learning generation failed for ${agentType}:`, error);
        });
    } else {
      console.log(`✓ Learning threshold not reached for ${agentType} yet`);
    }

  } catch (error) {
    console.error(`Error in auto-trigger for ${agentType}:`, error);
    // Don't throw - this is a background process
  }
}

/**
 * Get the current threshold setting
 */
export function getLearningThreshold() {
  return FEEDBACK_THRESHOLD;
}
