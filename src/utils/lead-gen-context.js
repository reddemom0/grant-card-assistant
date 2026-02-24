/**
 * Lead-Gen Context Injection
 *
 * Loads form data and company background for lead-gen sessions
 * and formats them for injection into agent system prompt.
 */

import { query } from '../database/connection.js';

/**
 * Load lead-gen form data and company background for a session.
 *
 * Returns formatted context string to inject into agent system prompt, or null if no data found.
 *
 * @param {string} conversationId - Lead-gen session ID
 * @returns {Promise<string|null>} Formatted context for agent, or null
 */
export async function getLeadGenFormContext(conversationId) {
  try {
    const result = await query(
      `SELECT contact_name, contact_email, company_name, company_website, company_background
       FROM lead_gen_conversations
       WHERE session_id = $1`,
      [conversationId]
    );

    const session = result.rows[0];
    if (!session) {
      console.log(`⚠️  No lead-gen session found for ${conversationId} - skipping form context injection`);
      return null;
    }

    // Check if form data exists (these fields are populated after form submission)
    if (!session.contact_name && !session.company_name) {
      console.log(`ℹ️  Session ${conversationId} has no form data yet - skipping context injection`);
      return null;
    }

    console.log(`✓ Loading form context for session ${conversationId}`);
    console.log(`  Contact: ${session.contact_name} <${session.contact_email}>`);
    console.log(`  Company: ${session.company_name} (${session.company_website || 'no website'})`);

    // Build context string
    let context = `<lead_info>\nName: ${session.contact_name}\n`;
    context += `Email: ${session.contact_email}\n`;
    context += `Company: ${session.company_name}\n`;
    if (session.company_website) {
      context += `Website: ${session.company_website}\n`;
    }
    context += `</lead_info>\n\n`;

    // Add company background if extracted
    if (session.company_background && Object.keys(session.company_background).length > 0) {
      const bg = session.company_background;

      context += `<company_background>\n`;

      if (bg.description) {
        context += `Description: ${bg.description}\n`;
      }

      if (bg.industry) {
        context += `Industry: ${bg.industry}\n`;
      }

      if (bg.location) {
        context += `Location: ${bg.location}\n`;
      }

      if (bg.estimated_team_size) {
        context += `Estimated Team Size: ${bg.estimated_team_size}\n`;
      }

      if (bg.products_services) {
        context += `Products/Services: ${bg.products_services}\n`;
      }

      context += `</company_background>\n`;

      console.log(`✓ Company background extracted from website:\n${context}`);
    } else {
      context += `<company_background>\nCould not extract company information from website. Proceed with standard discovery.\n</company_background>\n`;
      console.log(`ℹ️  No company background available - website extraction may still be running`);
    }

    return context;

  } catch (error) {
    console.warn(`⚠️  Failed to load lead-gen form context for ${conversationId}:`, error.message);
    return null;
  }
}
