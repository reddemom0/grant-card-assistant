/**
 * Automatic Feedback Tagging Integration
 *
 * Automatically tags feedback when submitted and stores in database
 * Metrics auto-update via database triggers
 */

import { query } from '../database/db.js';
import { classifyFeedback, getTagExplanation } from './tag-classifier.js';

/**
 * Process and tag feedback after it's been stored
 *
 * @param {number} feedbackId - ID from conversation_feedback table
 * @param {string} feedbackText - User's feedback text
 * @param {string} agentType - Type of agent
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<object>} Result with applied tags
 */
export async function tagFeedback(feedbackId, feedbackText, agentType, conversationId) {
  try {
    console.log(`\n🏷️  Auto-tagging feedback ${feedbackId}`);

    // Skip if feedback text is empty or too short
    if (!feedbackText || feedbackText.trim().length < 5) {
      console.log('⏭️  Skipping: feedback too short');
      return { success: true, tags: [], reason: 'feedback_too_short' };
    }

    // Classify the feedback
    const tags = await classifyFeedback(feedbackText, agentType, {
      confidenceThreshold: 0.70, // Only apply tags with 70%+ confidence
      useLLM: true, // Enable LLM for ambiguous cases
      maxTags: 5 // Maximum tags per feedback
    });

    if (tags.length === 0) {
      console.log('⚠️  No confident tags found - queued for manual review');

      // Log for manual review
      await logUntaggedFeedback(feedbackId, conversationId, feedbackText, agentType);

      return { success: true, tags: [], reason: 'no_confident_tags' };
    }

    // Insert tags into database
    const insertedTags = [];
    for (const tag of tags) {
      try {
        await query(`
          INSERT INTO feedback_tags (feedback_id, tag, created_at)
          VALUES ($1, $2, NOW())
        `, [feedbackId, tag.tag]);

        insertedTags.push({
          tag: tag.tag,
          category: tag.category,
          confidence: tag.confidence,
          explanation: getTagExplanation(tag.tag)
        });

        console.log(`  ✅ Tagged: ${tag.tag} (${(tag.confidence * 100).toFixed(0)}% confidence, ${tag.method})`);
      } catch (error) {
        // Ignore duplicate tag errors
        if (error.code !== '23505') {
          console.error(`  ❌ Failed to insert tag ${tag.tag}:`, error.message);
        }
      }
    }

    // Metrics will auto-update via database trigger!
    console.log(`✅ Tagged feedback ${feedbackId} with ${insertedTags.length} tags`);

    return {
      success: true,
      tags: insertedTags,
      taggingMethod: tags[0]?.method || 'unknown'
    };

  } catch (error) {
    console.error('❌ Error tagging feedback:', error);
    return {
      success: false,
      error: error.message,
      tags: []
    };
  }
}

/**
 * Tag feedback note (from feedback_notes table)
 *
 * @param {number} noteId - ID from feedback_notes table
 * @param {string} noteText - User's note text
 * @param {string} agentType - Type of agent
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<object>} Result with applied tags
 */
export async function tagFeedbackNote(noteId, noteText, agentType, conversationId) {
  try {
    console.log(`\n🏷️  Auto-tagging feedback note ${noteId}`);

    // Skip if note is empty or too short
    if (!noteText || noteText.trim().length < 5) {
      console.log('⏭️  Skipping: note too short');
      return { success: true, tags: [], reason: 'note_too_short' };
    }

    // Classify the note
    const tags = await classifyFeedback(noteText, agentType, {
      confidenceThreshold: 0.70,
      useLLM: true,
      maxTags: 5
    });

    if (tags.length === 0) {
      console.log('⚠️  No confident tags found');
      return { success: true, tags: [], reason: 'no_confident_tags' };
    }

    // Insert tags into database
    const insertedTags = [];
    for (const tag of tags) {
      try {
        await query(`
          INSERT INTO feedback_tags (note_id, tag, created_at)
          VALUES ($1, $2, NOW())
        `, [noteId, tag.tag]);

        insertedTags.push({
          tag: tag.tag,
          category: tag.category,
          confidence: tag.confidence
        });

        console.log(`  ✅ Tagged: ${tag.tag} (${(tag.confidence * 100).toFixed(0)}% confidence)`);
      } catch (error) {
        if (error.code !== '23505') {
          console.error(`  ❌ Failed to insert tag ${tag.tag}:`, error.message);
        }
      }
    }

    console.log(`✅ Tagged note ${noteId} with ${insertedTags.length} tags`);

    return {
      success: true,
      tags: insertedTags,
      taggingMethod: tags[0]?.method || 'unknown'
    };

  } catch (error) {
    console.error('❌ Error tagging note:', error);
    return {
      success: false,
      error: error.message,
      tags: []
    };
  }
}

/**
 * Log untagged feedback for manual review
 */
async function logUntaggedFeedback(feedbackId, conversationId, feedbackText, agentType) {
  try {
    // Create simple log table entry if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS untagged_feedback_queue (
        id SERIAL PRIMARY KEY,
        feedback_id INTEGER,
        note_id INTEGER,
        conversation_id UUID,
        feedback_text TEXT,
        agent_type TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        reviewed BOOLEAN DEFAULT FALSE,
        reviewer_id INTEGER,
        reviewed_at TIMESTAMP,
        CONSTRAINT untagged_source_check CHECK (
          (feedback_id IS NOT NULL AND note_id IS NULL) OR
          (feedback_id IS NULL AND note_id IS NOT NULL)
        )
      )
    `);

    await query(`
      INSERT INTO untagged_feedback_queue (feedback_id, conversation_id, feedback_text, agent_type)
      VALUES ($1, $2, $3, $4)
    `, [feedbackId, conversationId, feedbackText, agentType]);

    console.log('📋 Logged for manual review');
  } catch (error) {
    console.error('Failed to log untagged feedback:', error);
  }
}

/**
 * Backfill tags for existing feedback
 * Run this once to tag historical feedback
 */
export async function backfillTags(options = {}) {
  const {
    limit = 100,
    daysBack = 30,
    agentType = null
  } = options;

  console.log(`\n🔄 Backfilling tags for last ${daysBack} days...`);
  console.log(`   Limit: ${limit} items`);
  console.log(`   Agent: ${agentType || 'all'}`);

  try {
    // Get untagged feedback
    const feedbackQuery = `
      SELECT
        cf.id as feedback_id,
        cf.conversation_id,
        cf.feedback_text,
        c.agent_type
      FROM conversation_feedback cf
      JOIN conversations c ON cf.conversation_id = c.id
      WHERE cf.feedback_text IS NOT NULL
      AND cf.feedback_text != ''
      AND cf.created_at >= NOW() - INTERVAL '${daysBack} days'
      AND NOT EXISTS (
        SELECT 1 FROM feedback_tags ft
        WHERE ft.feedback_id = cf.id
      )
      ${agentType ? `AND c.agent_type = '${agentType}'` : ''}
      ORDER BY cf.created_at DESC
      LIMIT ${limit}
    `;

    const result = await query(feedbackQuery);
    console.log(`📊 Found ${result.rows.length} untagged feedback items`);

    let tagged = 0;
    let skipped = 0;

    for (const row of result.rows) {
      const tagResult = await tagFeedback(
        row.feedback_id,
        row.feedback_text,
        row.agent_type,
        row.conversation_id
      );

      if (tagResult.tags.length > 0) {
        tagged++;
      } else {
        skipped++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   Tagged: ${tagged}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total processed: ${result.rows.length}`);

    return {
      success: true,
      processed: result.rows.length,
      tagged,
      skipped
    };

  } catch (error) {
    console.error('❌ Backfill error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get untagged feedback queue for manual review
 */
export async function getUntaggedQueue(limit = 50) {
  try {
    const result = await query(`
      SELECT
        uq.id,
        uq.feedback_id,
        uq.note_id,
        uq.conversation_id,
        uq.feedback_text,
        uq.agent_type,
        uq.created_at,
        u.name as user_name
      FROM untagged_feedback_queue uq
      LEFT JOIN conversation_feedback cf ON uq.feedback_id = cf.id
      LEFT JOIN users u ON cf.user_id = u.id
      WHERE uq.reviewed = FALSE
      ORDER BY uq.created_at DESC
      LIMIT $1
    `, [limit]);

    return {
      success: true,
      queue: result.rows
    };
  } catch (error) {
    console.error('Error fetching untagged queue:', error);
    return {
      success: false,
      error: error.message,
      queue: []
    };
  }
}

/**
 * Manually add tag to feedback
 * For manual review queue or corrections
 */
export async function manuallyAddTag(feedbackId, noteId, tag) {
  try {
    if (feedbackId) {
      await query(`
        INSERT INTO feedback_tags (feedback_id, tag)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [feedbackId, tag]);
    } else if (noteId) {
      await query(`
        INSERT INTO feedback_tags (note_id, tag)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [noteId, tag]);
    }

    return { success: true };
  } catch (error) {
    console.error('Error manually adding tag:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove incorrectly applied tag
 */
export async function removeTag(feedbackId, noteId, tag) {
  try {
    if (feedbackId) {
      await query(`
        DELETE FROM feedback_tags
        WHERE feedback_id = $1 AND tag = $2
      `, [feedbackId, tag]);
    } else if (noteId) {
      await query(`
        DELETE FROM feedback_tags
        WHERE note_id = $1 AND tag = $2
      `, [noteId, tag]);
    }

    return { success: true };
  } catch (error) {
    console.error('Error removing tag:', error);
    return { success: false, error: error.message };
  }
}
