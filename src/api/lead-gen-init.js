/**
 * Lead Gen Pre-Chat Form Initialization
 *
 * POST /api/lead-gen/init
 *
 * Creates a lead-gen session with pre-populated form data and starts
 * background company website extraction via Haiku.
 *
 * Request body:
 *   {
 *     contact_name: string,
 *     email: string,
 *     company_name: string,
 *     company_website: string | null
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     session_id: string
 *   }
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/connection.js';
import { createConversation } from '../database/messages.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract the real client IP, respecting Railway / proxy headers.
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Count new sessions created by this IP in the last hour.
 */
async function countRecentSessionsForIp(ipAddress) {
  const result = await query(
    `SELECT COUNT(DISTINCT session_id) AS cnt
     FROM lead_gen_conversations
     WHERE ip_address = $1
       AND created_at >= NOW() - INTERVAL '1 hour'`,
    [ipAddress]
  );
  return parseInt(result.rows[0]?.cnt || 0, 10);
}

/**
 * Create a new lead-gen session row with form data.
 * Returns the session_id UUID.
 */
async function createLeadGenSessionWithFormData(ipAddress, formData) {
  const sessionId = uuidv4();

  // Create entry in the internal conversations table
  await createConversation(sessionId, null, 'lead-gen', 'Lead Gen Chat');

  // Build prospect_data object with all form fields
  const prospectData = {
    contact_name: formData.contact_name,
    email: formData.email,
    company_name: formData.company_name,
    company_website: formData.company_website,
    province: formData.province,
    industry: formData.industry,
    revenue_range: formData.revenue_range,
    employee_count: formData.employee_count,
    hiring_plans: formData.hiring_plans,
    training_budget: formData.training_budget,
    expansion_budget: formData.expansion_budget
  };

  // Create the lead-gen-specific metadata row with form data
  await query(
    `INSERT INTO lead_gen_conversations
       (session_id, ip_address, contact_name, contact_email, company_name, company_website, prospect_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      ipAddress,
      formData.contact_name,
      formData.email,
      formData.company_name,
      formData.company_website,
      JSON.stringify(prospectData)
    ]
  );

  // Fire-and-forget: log conversation_started analytics event
  query(
    `INSERT INTO lead_gen_analytics (conversation_id, event_type)
     VALUES ($1, $2)`,
    [sessionId, 'conversation_started']
  ).catch(err => console.warn('⚠️  Analytics log failed (conversation_started):', err.message));

  console.log(`✓ Lead-gen session created with form data: ${sessionId} (IP: ${ipAddress})`);
  console.log(`  Contact: ${formData.contact_name} <${formData.email}>`);
  console.log(`  Company: ${formData.company_name} (${formData.company_website || 'no website'})`);
  console.log(`  Revenue: ${formData.revenue_range}, Employees: ${formData.employee_count}`);
  console.log(`  Hiring: ${formData.hiring_plans}, Training: ${formData.training_budget || 'none'}, Expansion: ${formData.expansion_budget || 'none'}`);
  if (formData.province && formData.industry) {
    console.log(`  Province: ${formData.province}, Industry: ${formData.industry} (form-provided)`);
  }

  return sessionId;
}

/**
 * Extract company background from website using Haiku.
 * Runs in background with 5-second timeout.
 *
 * Returns: { description, industry, location, estimated_team_size, products_services }
 * or null if extraction fails or times out.
 */
async function extractCompanyBackgroundFromWebsite(websiteUrl, sessionId) {
  if (!websiteUrl) return null;

  console.log(`🌐 Background: Fetching ${websiteUrl} for session ${sessionId}...`);

  try {
    // Fetch website with 5-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GrantedConsultingBot/1.0 (Lead Gen Research)'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`⚠️  Website fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const html = await response.text();

    // Extract text content (simple heuristic - remove scripts, styles, HTML tags)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000); // Limit to 8K characters for Haiku

    console.log(`✓ Fetched ${textContent.length} characters from ${websiteUrl}`);

    // Extract structured info via Haiku
    console.log(`🤖 Extracting company info via Haiku for session ${sessionId}...`);

    const extractionPrompt = `You are analyzing a company website to extract key business information for grant eligibility assessment.

Website URL: ${websiteUrl}
Website Content:
${textContent}

Please extract the following information in JSON format. If information is not found, use null.

{
  "description": "1-2 sentence summary of what the company does",
  "industry": "best guess at industry/sector (e.g., Technology, Manufacturing, Agriculture, etc.)",
  "location": "city, province if found (e.g., Vancouver, BC), otherwise null",
  "estimated_team_size": "number or range if found (e.g., 5-10, 20+), otherwise null",
  "products_services": "brief list of what they sell/offer (1-2 sentences)"
}

Return ONLY the JSON object, no additional text.`;

    const extractionResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: extractionPrompt
      }]
    });

    const extractedText = extractionResponse.content[0].text.trim();
    console.log(`✓ Haiku extraction complete for session ${sessionId}:`, extractedText);

    // Parse JSON response
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`⚠️  No JSON found in Haiku response for session ${sessionId}`);
      return null;
    }

    const companyBackground = JSON.parse(jsonMatch[0]);
    return companyBackground;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`⚠️  Website fetch timed out for session ${sessionId}`);
    } else {
      console.warn(`⚠️  Company background extraction failed for session ${sessionId}:`, error.message);
    }
    return null;
  }
}

/**
 * Update session with extracted company background (fire-and-forget).
 */
async function saveCompanyBackground(sessionId, companyBackground) {
  try {
    await query(
      `UPDATE lead_gen_conversations
       SET company_background = $1
       WHERE session_id = $2`,
      [JSON.stringify(companyBackground), sessionId]
    );
    console.log(`✓ Company background saved for session ${sessionId}`);
  } catch (error) {
    console.warn(`⚠️  Failed to save company background for session ${sessionId}:`, error.message);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * POST /api/lead-gen/init
 *
 * Creates a lead-gen session with pre-populated form data.
 * Starts background company website extraction (non-blocking).
 */
export async function handleLeadGenInit(req, res) {
  console.log('\n' + '▓'.repeat(80));
  console.log('📝 Lead-gen pre-chat form submission');
  console.log('▓'.repeat(80));

  try {
    const {
      contact_name,
      email,
      company_name,
      company_website,
      province,
      industry,
      revenue_range,
      employee_count,
      hiring_plans,
      training_budget,
      expansion_budget
    } = req.body;

    const ipAddress = getClientIp(req);

    // -------------------------------------------------------------------------
    // 1. Validate input
    // -------------------------------------------------------------------------

    if (!contact_name || !email || !company_name) {
      return res.status(400).json({
        error: 'Missing required fields: contact_name, email, company_name'
      });
    }

    // Basic email validation
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({
        error: 'Invalid email address'
      });
    }

    // Validate new required fields from page 2
    if (!revenue_range || !employee_count || !hiring_plans) {
      return res.status(400).json({
        error: 'Missing required fields: revenue_range, employee_count, hiring_plans'
      });
    }

    // -------------------------------------------------------------------------
    // 2. Rate limiting
    // -------------------------------------------------------------------------

    const recentCount = await countRecentSessionsForIp(ipAddress);
    if (recentCount >= 50) {
      console.warn(`⚠️  Rate limit hit for IP ${ipAddress}: ${recentCount} sessions in last hour`);
      return res.status(429).json({
        error: "You've started several chats recently. Please wait a bit before starting a new one."
      });
    }

    // -------------------------------------------------------------------------
    // 3. Create session with form data
    // -------------------------------------------------------------------------

    const formData = {
      contact_name,
      email,
      company_name,
      company_website: company_website || null,
      province: province || null,
      industry: industry || null,
      revenue_range,
      employee_count,
      hiring_plans,
      training_budget: training_budget || null,
      expansion_budget: expansion_budget || null
    };

    const sessionId = await createLeadGenSessionWithFormData(ipAddress, formData);

    // -------------------------------------------------------------------------
    // 4. Background: Extract company info from website (non-blocking)
    // -------------------------------------------------------------------------

    if (company_website) {
      // Fire-and-forget: extract company background in background
      (async () => {
        const companyBackground = await extractCompanyBackgroundFromWebsite(company_website, sessionId);
        if (companyBackground) {
          await saveCompanyBackground(sessionId, companyBackground);
        }
      })().catch(err => {
        console.warn(`⚠️  Background company extraction failed for session ${sessionId}:`, err.message);
      });
    }

    // -------------------------------------------------------------------------
    // 5. Return session ID immediately (don't wait for background extraction)
    // -------------------------------------------------------------------------

    return res.json({
      success: true,
      session_id: sessionId
    });

  } catch (error) {
    console.error('\n' + '▓'.repeat(80));
    console.error('❌ Lead-gen init error:', error);
    console.error('▓'.repeat(80) + '\n');

    return res.status(500).json({
      error: 'Something went wrong on our end. Please try again in a moment.'
    });
  }
}
