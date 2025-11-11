/**
 * Learning Memory Loader
 *
 * Loads learned patterns from feedback analysis and injects them into agent prompts.
 * This completes the learning loop by making agents aware of user feedback.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveLearningApplication } from '../database/learning-tracking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Load learning memory files for an agent
 * @param {string} agentType - Type of agent (e.g., 'etg-writer')
 * @param {string} conversationId - UUID of the conversation
 * @param {string} userId - UUID of the user
 * @returns {Promise<string|null>} Formatted learning memory to inject into prompt
 */
export async function loadLearningMemory(agentType, conversationId, userId) {
  try {
    const memoryDir = path.join(PROJECT_ROOT, 'memories', 'agents', agentType);

    // Check if memory directory exists
    if (!fs.existsSync(memoryDir)) {
      console.log(`ℹ️  No learning memory found for ${agentType} yet`);
      return null;
    }

    // Read all learning files
    const learnedPatternsPath = path.join(memoryDir, 'learned-patterns.md');
    const commonErrorsPath = path.join(memoryDir, 'common-errors.md');
    const userCorrectionsPath = path.join(memoryDir, 'user-corrections.md');
    const readmePath = path.join(memoryDir, 'README.md');

    let memoryContent = '';
    let filesLoaded = [];
    let lastUpdated = null;

    // Load learned success patterns
    if (fs.existsSync(learnedPatternsPath)) {
      const content = fs.readFileSync(learnedPatternsPath, 'utf-8');
      memoryContent += `\n\n${content}`;
      filesLoaded.push('learned-patterns.md');

      // Get last modified time
      const stats = fs.statSync(learnedPatternsPath);
      lastUpdated = stats.mtime;
    }

    // Load common errors to avoid
    if (fs.existsSync(commonErrorsPath)) {
      const content = fs.readFileSync(commonErrorsPath, 'utf-8');
      memoryContent += `\n\n${content}`;
      filesLoaded.push('common-errors.md');
    }

    // Load user corrections
    if (fs.existsSync(userCorrectionsPath)) {
      const content = fs.readFileSync(userCorrectionsPath, 'utf-8');
      memoryContent += `\n\n${content}`;
      filesLoaded.push('user-corrections.md');
    }

    if (filesLoaded.length === 0) {
      console.log(`ℹ️  No learning files found for ${agentType}`);
      return null;
    }

    console.log(`✓ Loaded ${filesLoaded.length} learning files for ${agentType}:`, filesLoaded);
    if (lastUpdated) {
      console.log(`  Last updated: ${lastUpdated.toLocaleString()}`);
    }

    // Track that learning was applied to this conversation
    try {
      console.log(`📊 Tracking learning application:`, {
        agentType,
        conversationId,
        userId,
        userIdType: typeof userId,
        filesLoaded,
        lastUpdated
      });

      await saveLearningApplication(
        agentType,
        conversationId,
        userId,
        filesLoaded,
        lastUpdated
      );

      console.log(`✓ Learning application tracked successfully`);
    } catch (trackingError) {
      console.error('❌ Failed to track learning application:', trackingError);
      console.error('   Error details:', {
        message: trackingError.message,
        code: trackingError.code,
        detail: trackingError.detail,
        stack: trackingError.stack
      });
      // Don't fail the whole request if tracking fails
    }

    // Format the memory injection
    const formattedMemory = `

<learning_from_feedback>
# 🧠 LEARNED INSIGHTS FROM USER FEEDBACK

The following insights have been extracted from user feedback on your previous responses.
These represent patterns that led to high-quality (positive) outcomes and common mistakes
that led to negative outcomes. Apply these learnings to improve your responses.

**Last Updated**: ${lastUpdated ? lastUpdated.toLocaleString() : 'Unknown'}
**Files Loaded**: ${filesLoaded.join(', ')}

${memoryContent}

</learning_from_feedback>
`;

    return formattedMemory;

  } catch (error) {
    console.error('Error loading learning memory:', error);
    return null;
  }
}

/**
 * Check if learning memory exists for an agent
 * @param {string} agentType - Type of agent
 * @returns {boolean} True if learning memory exists
 */
export function hasLearningMemory(agentType) {
  const memoryDir = path.join(PROJECT_ROOT, 'memories', 'agents', agentType);
  return fs.existsSync(memoryDir);
}

/**
 * Get learning memory stats for an agent
 * @param {string} agentType - Type of agent
 * @returns {Object|null} Stats object or null
 */
export function getLearningMemoryStats(agentType) {
  try {
    const memoryDir = path.join(PROJECT_ROOT, 'memories', 'agents', agentType);

    if (!fs.existsSync(memoryDir)) {
      return null;
    }

    const readmePath = path.join(memoryDir, 'README.md');
    if (!fs.existsSync(readmePath)) {
      return null;
    }

    const readmeContent = fs.readFileSync(readmePath, 'utf-8');

    // Parse README to extract stats
    const lastUpdatedMatch = readmeContent.match(/\*\*Last Updated\*\*:\s*(.+)/);
    const totalFeedbackMatch = readmeContent.match(/\*\*Total Feedback\*\*:\s*(\d+)/);

    return {
      lastUpdated: lastUpdatedMatch ? lastUpdatedMatch[1] : null,
      totalFeedback: totalFeedbackMatch ? parseInt(totalFeedbackMatch[1]) : 0,
      exists: true
    };
  } catch (error) {
    console.error('Error getting learning memory stats:', error);
    return null;
  }
}
