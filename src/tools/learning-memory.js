/**
 * Learning Memory Loader
 *
 * Loads learned patterns from feedback analysis and injects them into agent prompts.
 * This completes the learning loop by making agents aware of user feedback.
 */

import { saveLearningApplication } from '../database/learning-tracking.js';
import { getLearningMemoryFiles, getLearningMemoryStats } from '../database/learning-memory-storage.js';

/**
 * Load learning memory files for an agent
 * @param {string} agentType - Type of agent (e.g., 'etg-writer')
 * @param {string} conversationId - UUID of the conversation
 * @param {string} userId - UUID of the user
 * @returns {Promise<string|null>} Formatted learning memory to inject into prompt
 */
export async function loadLearningMemory(agentType, conversationId, userId) {
  try {
    // Load memory files from database
    const memoryFiles = await getLearningMemoryFiles(agentType);

    if (!memoryFiles || memoryFiles.length === 0) {
      console.log(`ℹ️  No learning memory found for ${agentType} yet`);
      return null;
    }

    // Build content from database files
    let memoryContent = '';
    let filesLoaded = [];
    let lastUpdated = null;

    // Load files in specific order (excluding README)
    const fileOrder = ['learned-patterns.md', 'common-errors.md', 'user-corrections.md'];

    for (const fileName of fileOrder) {
      const file = memoryFiles.find(f => f.file_name === fileName);
      if (file) {
        memoryContent += `\n\n${file.content}`;
        filesLoaded.push(fileName);

        // Track most recent update
        if (!lastUpdated || new Date(file.updated_at) > new Date(lastUpdated)) {
          lastUpdated = file.updated_at;
        }
      }
    }

    if (filesLoaded.length === 0) {
      console.log(`ℹ️  No learning files found for ${agentType}`);
      return null;
    }

    console.log(`✓ Loaded ${filesLoaded.length} learning files for ${agentType}:`, filesLoaded);
    if (lastUpdated) {
      console.log(`  Last updated: ${new Date(lastUpdated).toLocaleString()}`);
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
 * @returns {Promise<boolean>} True if learning memory exists
 */
export async function hasLearningMemory(agentType) {
  const stats = await getLearningMemoryStats(agentType);
  return stats !== null && stats.fileCount > 0;
}
