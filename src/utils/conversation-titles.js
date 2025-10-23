/**
 * Conversation Title Generation
 *
 * Generates smart, concise titles for conversations based on content.
 * Similar to how Claude.ai automatically names conversations.
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Generate a smart title for a conversation based on the first user message
 * @param {string} firstMessage - The first user message in the conversation
 * @param {string} agentType - The type of agent (for context)
 * @returns {Promise<string>} Generated title (max 60 characters)
 */
export async function generateConversationTitle(firstMessage, agentType = null) {
  try {
    // For very short messages, use them directly as title
    if (firstMessage.length < 40) {
      return firstMessage.trim().replace(/\s+/g, ' ');
    }

    // Use Claude to generate a concise title
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022', // Fast, cheap model for titles
      max_tokens: 100,
      temperature: 0.3, // Low temperature for consistent titles
      messages: [{
        role: 'user',
        content: `Generate a short, descriptive title (max 8 words) for a conversation that starts with this message:

"${firstMessage.substring(0, 500)}"

${agentType ? `This is a conversation with a ${agentType} agent.` : ''}

Return ONLY the title, no quotes, no punctuation at the end, no explanation.`
      }]
    });

    const title = response.content[0].text.trim()
      .replace(/^["']|["']$/g, '') // Remove quotes if added
      .replace(/[.!?]+$/, '') // Remove ending punctuation
      .substring(0, 60); // Limit length

    return title || 'New Conversation';
  } catch (error) {
    console.error('Error generating conversation title:', error);
    // Fallback: use first few words of the message
    return fallbackTitle(firstMessage);
  }
}

/**
 * Generate a fallback title from the message without AI
 * @param {string} message - The message to generate a title from
 * @returns {string} Fallback title
 */
function fallbackTitle(message) {
  // Clean the message
  const cleaned = message
    .replace(/\s+/g, ' ')
    .trim();

  // Take first 60 characters or first sentence
  const firstSentence = cleaned.split(/[.!?]/)[0];
  const title = firstSentence.length <= 60
    ? firstSentence
    : cleaned.substring(0, 60).trim() + '...';

  return title || 'New Conversation';
}

/**
 * Update conversation title in database
 * @param {string} conversationId - UUID of the conversation
 * @param {string} title - New title
 * @returns {Promise<void>}
 */
export async function updateConversationTitle(conversationId, title) {
  try {
    const { updateConversationTitle: dbUpdateTitle } = await import('../database/messages.js');
    await dbUpdateTitle(conversationId, title);
    console.log(`✓ Updated conversation title: "${title}"`);
  } catch (error) {
    console.error('Error updating conversation title:', error);
    // Non-critical error, don't throw
  }
}

/**
 * Generate and save title for a new conversation
 * @param {string} conversationId - UUID of the conversation
 * @param {string} firstMessage - First user message
 * @param {string} agentType - Agent type
 * @returns {Promise<string>} The generated title
 */
export async function generateAndSaveTitle(conversationId, firstMessage, agentType) {
  const title = await generateConversationTitle(firstMessage, agentType);
  await updateConversationTitle(conversationId, title);
  return title;
}
