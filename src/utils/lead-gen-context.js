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
      `SELECT contact_name, contact_email, company_name, company_website, company_background, prospect_data
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

    // Get prospect_data if available
    const prospectData = session.prospect_data || {};

    // Build context string
    let context = `<lead_info>\nName: ${session.contact_name}\n`;
    context += `Email: ${session.contact_email}\n`;
    context += `Company: ${session.company_name}\n`;
    if (session.company_website) {
      context += `Website: ${session.company_website}\n`;
    }

    // Add new fields from prospect_data
    // Province is always required and always from form
    if (prospectData.province) {
      context += `Province: ${prospectData.province}\n`;
    }
    if (prospectData.revenue_range) {
      context += `Revenue: ${prospectData.revenue_range}\n`;
    }
    if (prospectData.employee_count) {
      context += `Employees: ${prospectData.employee_count}\n`;
    }
    if (prospectData.hiring_plans) {
      context += `Hiring Plans: ${prospectData.hiring_plans}\n`;
    }
    if (prospectData.training_budget) {
      context += `Training Budget: ${prospectData.training_budget}\n`;
    }
    if (prospectData.expansion_budget) {
      context += `Market Expansion: ${prospectData.expansion_budget}\n`;
    }
    if (prospectData.planned_activities) {
      context += `Planned Activities: ${prospectData.planned_activities}\n`;
    } else {
      context += `Planned Activities: None specified\n`;
    }

    context += `</lead_info>\n\n`;

    // Add company background if extracted
    if (session.company_background && Object.keys(session.company_background).length > 0) {
      const bg = session.company_background;

      context += `<company_background>\n`;

      if (bg.description) {
        context += `Description: ${bg.description}\n`;
      }

      // Industry: prioritize Haiku extraction over form-provided
      if (bg.industry) {
        context += `Industry: ${bg.industry}\n`;
      } else if (prospectData.industry) {
        context += `Industry: ${prospectData.industry} (form-provided)\n`;
      }

      // Location: if Haiku extracted location, include it (form province already in <lead_info>)
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
      // No website extraction - use form-provided industry if available
      context += `<company_background>\n`;

      if (prospectData.industry) {
        context += `Industry: ${prospectData.industry} (form-provided)\n`;
      }

      if (!prospectData.industry) {
        context += `Could not extract company information from website. Proceed with standard discovery.\n`;
      }

      context += `</company_background>\n`;

      console.log(`ℹ️  No website extraction - using form-provided industry`);
    }

    return context;

  } catch (error) {
    console.warn(`⚠️  Failed to load lead-gen form context for ${conversationId}:`, error.message);
    return null;
  }
}

/**
 * Tokenize text for query building
 * Remove stopwords, lowercase, deduplicate
 */
function tokenizeText(text) {
  if (!text) return [];

  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'we', 'our', 'are',
    'is', 'am', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had'
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word));
}

/**
 * Load strategic context for lead-gen session (one-time lookup)
 *
 * Builds query from prospect data and calls search_lead_gen_strategy
 * to provide strategic recommendations before agent composes opening message.
 *
 * Cached in conversation_memory to avoid repeated lookups.
 *
 * @param {string} conversationId - Lead-gen session ID
 * @returns {Promise<string|null>} Formatted strategic context, or null
 */
export async function getStrategicContext(conversationId) {
  try {
    // Check if already loaded
    const memoryResult = await query(
      `SELECT value FROM conversation_memory WHERE conversation_id = $1 AND key = 'strategic_context'`,
      [conversationId]
    );

    if (memoryResult.rows.length > 0) {
      console.log(`✓ Strategic context already loaded (cached)`);
      return memoryResult.rows[0].value;
    }

    // Load prospect data
    const sessionResult = await query(
      `SELECT prospect_data, company_background FROM lead_gen_conversations WHERE session_id = $1`,
      [conversationId]
    );

    if (sessionResult.rows.length === 0) {
      console.log(`⚠️  No session found for strategic context lookup`);
      return null;
    }

    const session = sessionResult.rows[0];
    const prospectData = session.prospect_data || {};
    const companyBg = session.company_background || {};

    // Build query from industry + planned_activities
    let queryParts = [];

    // Add industry
    const industry = companyBg.industry || prospectData.industry;
    if (industry) {
      queryParts.push(industry);
    }

    // Add planned_activities (tokenized)
    if (prospectData.planned_activities) {
      const tokens = tokenizeText(prospectData.planned_activities);
      queryParts.push(...tokens);
    } else {
      // Fallback: use revenue tier + activity flags
      if (prospectData.revenue_range) {
        queryParts.push(prospectData.revenue_range.replace(/[^a-zA-Z0-9]/g, ' '));
      }
      if (prospectData.hiring_plans && prospectData.hiring_plans !== 'No plans to hire') {
        queryParts.push('hiring');
      }
      if (prospectData.training_budget && prospectData.training_budget !== 'Under $10K') {
        queryParts.push('training');
      }
      if (prospectData.expansion_budget && prospectData.expansion_budget !== 'Under $10K') {
        queryParts.push('export', 'markets');
      }
    }

    const strategyQuery = queryParts.join(' ').trim();

    if (!strategyQuery) {
      console.log(`⚠️  No data to build strategic query - skipping`);
      return null;
    }

    console.log(`🧠 Building strategic context with query: "${strategyQuery}"`);

    // Call search_lead_gen_strategy with 3s timeout
    const startTime = Date.now();
    const { searchLeadGenStrategy } = await import('../tools/lead-gen-knowledge.js');

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Strategic lookup timeout')), 3000)
    );

    const strategyResult = await Promise.race([
      searchLeadGenStrategy({ query: strategyQuery }),
      timeoutPromise
    ]);

    const elapsed = Date.now() - startTime;

    if (!strategyResult || !strategyResult.success) {
      console.log(`⚠️  Strategic lookup returned no results - proceeding without it`);
      return null;
    }

    const contextText = strategyResult.content || strategyResult.answer || '';
    const charCount = contextText.length;

    console.log(`🧠 Strategic context loaded: "${strategyQuery}" → ${charCount} chars`);
    console.log(`🧠 Strategy lookup: ${elapsed}ms`);

    // Format as XML block
    const formattedContext = `<strategic_context>\n${contextText}\n</strategic_context>\n`;

    // Store in conversation_memory
    await query(
      `INSERT INTO conversation_memory (conversation_id, key, value)
       VALUES ($1, 'strategic_context', $2)
       ON CONFLICT (conversation_id, key) DO UPDATE SET value = $2`,
      [conversationId, formattedContext]
    );

    return formattedContext;

  } catch (error) {
    if (error.message === 'Strategic lookup timeout') {
      console.warn(`⚠️  Strategic lookup timed out (>3s) - proceeding without it`);
    } else {
      console.warn(`⚠️  Strategic context lookup failed: ${error.message}`);
    }
    return null;
  }
}
