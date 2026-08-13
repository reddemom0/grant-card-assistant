/**
 * HubSpot Webhook Handler for Automatic Lead Enrichment
 *
 * Receives webhook notifications from HubSpot when:
 * - New lead is created in CRM
 * - Grant Calculator form is submitted
 *
 * Automatically triggers Internal Oracle to research and generate Oracle Insight.
 */

import { runAgent } from '../claude/client.js';
import { createConversation } from '../database/messages.js';
import { getCompanyById } from '../tools/hubspot.js';
import crypto from 'crypto';

// In-memory deduplication cache (tracks recent enrichments to prevent duplicates)
const recentEnrichments = new Map(); // Map<companyId, timestamp>
const DEDUPE_WINDOW_MS = 60000; // 60 seconds

/**
 * Authenticate an inbound webhook by shared token in the query string.
 *
 * WHY A QUERY-STRING TOKEN, AND NOT A SIGNATURE
 * ---------------------------------------------
 * Two different senders POST to this endpoint:
 *
 *   1. The HubSpot app's webhook subscription, which DOES send signatures
 *      (x-hubspot-signature v1 plus x-hubspot-signature-v3 and
 *      x-hubspot-request-timestamp). A previous, broken HMAC check rejected
 *      every one of these with 401, silently, for as long as it existed.
 *
 *   2. A HubSpot *workflow* action ("Oracle Insight - Auto Enrichment"),
 *      which sends NO signature headers at all — only x-hubspot-correlation-id,
 *      x-hubspot-origin-hublet and x-hubspot-timeout-millis. Its events carry
 *      changeSource: "WORKFLOW". This unsigned path is the one that has
 *      actually driven every enrichment to date.
 *
 * Because the real traffic is unsigned, signature verification alone would not
 * secure this endpoint — it would reject the sender we depend on while
 * protecting one we don't currently use. A workflow action's only configurable
 * field is its URL, so a shared token in the query string is the mechanism
 * available. Proper v3 signature verification for sender (1) is DEFERRED to
 * its own task.
 *
 * CAVEAT: query strings can appear in upstream proxy/edge access logs. Our own
 * logging excludes them (the request logger and 404 handler use req.path, which
 * omits the query), but Railway's edge logs are outside our control.
 *
 * @param {import('express').Request} req
 * @returns {{ok: boolean, reason: string|null}} reason never contains the token
 */
function verifyWorkflowToken(req) {
  const expected = process.env.HUBSPOT_WORKFLOW_TOKEN;

  // Fail closed: an unconfigured token rejects everything rather than
  // defaulting to allow, which is how the previous check failed open.
  if (typeof expected !== 'string' || expected.length === 0) {
    return { ok: false, reason: 'HUBSPOT_WORKFLOW_TOKEN not configured' };
  }

  const provided = req.query?.token;
  if (typeof provided !== 'string' || provided.length === 0) {
    return { ok: false, reason: 'missing token' };
  }

  // Compare SHA-256 digests rather than the raw strings: timingSafeEqual
  // throws on length mismatch, and a length pre-check would leak the secret's
  // length. Digests are always 32 bytes, so the comparison is constant-time
  // and length-independent.
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();

  return crypto.timingSafeEqual(providedDigest, expectedDigest)
    ? { ok: true, reason: null }
    : { ok: false, reason: 'invalid token' };
}

/**
 * Extract company information from HubSpot webhook payload
 * @param {Object} payload - HubSpot webhook payload
 * @returns {Object} - Extracted company info
 */
function extractCompanyInfo(payload) {
  // HubSpot sends different payload structures depending on the trigger
  // Handle form submission
  if (payload.formGuid) {
    const submittedData = payload.submittedData || [];
    const data = {};

    submittedData.forEach(field => {
      data[field.name] = field.value;
    });

    return {
      companyName: data.company || data.company_name || null,
      contactEmail: data.email || null,
      contactName: `${data.firstname || ''} ${data.lastname || ''}`.trim() || null,
      phone: data.phone || null,
      website: data.website || null,
      industry: data.industry || null,
      formName: payload.formName || 'Grant Calculator',
      submittedAt: new Date().toISOString()
    };
  }

  // Handle company.creation event webhook (most common for lead enrichment)
  if (payload.objectId && payload.subscriptionType === 'company.creation') {
    const changeSource = payload.changeSource || 'unknown';
    console.log(`✅ Detected company.creation event - objectId: ${payload.objectId}, changeSource: ${changeSource}`);
    return {
      objectId: payload.objectId,
      objectType: 'company',
      subscriptionType: payload.subscriptionType,
      changeSource
    };
  }

  // Handle contact/company property change webhook
  if (payload.objectId && payload.propertyName) {
    return {
      objectId: payload.objectId,
      objectType: payload.objectType || 'contact',
      propertyName: payload.propertyName,
      propertyValue: payload.propertyValue,
      changeSource: payload.changeSource || 'unknown'
    };
  }

  // Handle workflow webhook
  if (payload.properties) {
    return {
      objectId: payload.objectId || payload.vid || payload.dealId,
      objectType: payload.objectType || 'contact',
      companyName: payload.properties.company || payload.properties.associatedcompanyid,
      contactEmail: payload.properties.email,
      contactName: `${payload.properties.firstname || ''} ${payload.properties.lastname || ''}`.trim() || null
    };
  }

  return null;
}

/**
 * Generate comprehensive Oracle Insight enrichment prompt
 * @param {Object} companyInfo - Company information to research
 * @returns {string} - Enrichment prompt for Internal Oracle
 */
function generateOracleInsightPrompt(companyInfo) {
  // If we only have objectId, tell Oracle to fetch the company first
  if (companyInfo.objectId && !companyInfo.companyName) {
    return `# AUTOMATIC LEAD ENRICHMENT - ORACLE INSIGHT GENERATION

A new company was just created in HubSpot (ID: ${companyInfo.objectId}).

**FIRST STEP:** Use \`get_hubspot_company\` to fetch this company's full details:

\`\`\`
get_hubspot_company({ company_id: "${companyInfo.objectId}" })
\`\`\`

Once you have the company details, conduct COMPREHENSIVE research and generate an **Oracle Insight** for the sales team following the complete research checklist below.

---`;
  }

  // If we have company details from a form submission
  return `# AUTOMATIC LEAD ENRICHMENT - ORACLE INSIGHT GENERATION

A new lead has been created in HubSpot. You must conduct COMPREHENSIVE research and generate an **Oracle Insight** for the sales team.

## Lead Information:
${companyInfo.companyName ? `- Company Name: ${companyInfo.companyName}` : ''}
${companyInfo.contactEmail ? `- Contact Email: ${companyInfo.contactEmail}` : ''}
${companyInfo.contactName ? `- Contact Name: ${companyInfo.contactName}` : ''}
${companyInfo.phone ? `- Phone: ${companyInfo.phone}` : ''}
${companyInfo.website ? `- Website: ${companyInfo.website}` : ''}
${companyInfo.industry ? `- Industry: ${companyInfo.industry}` : ''}

---

## 🚨 CRITICAL: CANADIAN COMPANIES ONLY

**BEFORE YOU START:** Verify this is a Canadian company.

If the company is US-based or non-Canadian:
- ❌ DO NOT generate Oracle Insight
- ❌ DO NOT create/update HubSpot record
- ❌ Respond with: "ERROR: [Company Name] is a US/[country] business. Granted only serves Canadian companies."
- STOP immediately

**How to verify:**
1. Check website address (city, province)
2. Look for .ca domain
3. Search business registry (BC Registry, Canada Business Registry)
4. Check LinkedIn location

Only proceed if confirmed Canadian.

---

## ⛔ DISQUALIFICATION CHECK

Check for automatic disqualifiers:
- ❌ Non-Canadian company
- ❌ Sole proprietor with 0 employees
- ❌ Non-profit/charity without incorporation
- ❌ Excluded industries: Cannabis, adult entertainment, gambling, tobacco
- ❌ Company incorporated <6 months ago
- ❌ Website inactive/under construction/parked
- ❌ No verifiable business presence

If disqualified, respond with:

❌ DISQUALIFIED: [Company Name]
Reason: [Specific disqualifier]

---

## 🔬 COMPREHENSIVE RESEARCH CHECKLIST

**YOU MUST BE EXHAUSTIVE.** Complete ALL 9 steps:

### 1. Company Website Deep Dive
- Try all URL variations (http/https, www/non-www)
- Read: About Us, Services, Products, Team, Careers
- Extract: Location, contact info, description, team size
- Look for: Testimonials, case studies, partnerships, certifications
- Financial health: Funding announcements, growth indicators
- Co-investment capacity: Can they afford grant matching (20-50%)?

### 2. Business Registry Verification
- BC Registry (BC companies) or Canada Business Registry
- Confirm: Legal name, incorporation date, business number
- Verify: Active, Canadian-registered

### 3. LinkedIn Intelligence
- Find company LinkedIn page
- Extract: Employee count, industry, description, recent posts
- Identify: Key decision-makers (CEO, CFO, Operations Director)
- Check: Growth indicators (hiring, updates)

### 4. Web Search Research
- Search: "[company name] news"
- Search: "[company name] awards certifications"
- Search: "[company name] clients customers"
- Search: "[company name] funding investment"
- Search: "[company name] export international markets"
- Search: "[company name] grant consultant" (competitor check)
- Check website/LinkedIn for testimonials from other consultants

### 5. Grant Program Matching & Validation

**🚨 THE CARDINAL RULE: NEVER recommend a closed grant 🚨**

**Step 1: Find Active Grants**
- **CRITICAL:** Use search_getgranted with **active_only=true** (MANDATORY)
- Check **open_intakes_only=true** for immediate opportunities
- **Consult get_visualping_alerts (past 30 days)** for program changes

**Step 2: VALIDATE Each Grant is Currently Open**

For EVERY grant you plan to recommend:

1. Web search for current status:
   - WebSearch: "[grant name] 2026 open intake deadline"
   - WebSearch: "[grant name] currently accepting applications"

2. Check official program page:
   - WebFetch: [official URL from GetGranted]

3. Look for OPEN signals:
   ✅ "Now accepting applications"
   ✅ "Apply now" / "Open intake"
   ✅ Future deadline visible

4. Look for CLOSED signals:
   🛑 "Applications closed"
   🛑 "No longer accepting"
   🛑 Past deadline with no new intake

5. For annual programs without current intake:
   ✅ YOU CAN recommend with timing: "ANNUAL - Opens Q[X] [year]"
   ✅ Provide preparation timeline: "Worth preparing now for [month] intake"
   ✅ Always include immediate alternatives alongside

**If grant is closed:**
- **Annually recurring programs** → CAN recommend with clear opening timeline
- **Permanently discontinued programs** → DO NOT recommend, find alternatives

**Step 3: Cross-Reference Eligibility**
- Match company profile to eligibility requirements
- Verify deadlines are realistic (3-4 weeks minimum)
- Check province-specific programs:
  - BC: BCAFE, InnovateBC, New Ventures BC
  - Ontario: Ontario Together Fund, Regional Development
  - Alberta: ATB Financial, AgriSpirit Fund
  - Quebec: Investment Quebec

### 6. Internal Intelligence (HubSpot Historical Analysis)
- Search won deals with similar profile (same industry + program + province)
- Extract: Average funding, close rate, timeline
- Search lost/abandoned deals (why did they fail?)
- Calculate success probability (High/Medium/Low)

### 7. Competitive/Market Context
- Identify: Direct competitors, market position
- Assess: Unique value proposition, differentiation
- Determine: Market segment (SME vs enterprise, B2B vs B2C)

### 8. Decision-Maker & Contact Intelligence
- Identify primary decision-maker (CEO/CFO/COO)
- Find contact info (email, phone, LinkedIn)
- Assess grant sophistication (first-timer vs experienced)
- Communication style indicators (formal vs casual)

### 9. Urgency & Timing Signals
- **Hiring signals:** Job postings → CSJ, DS4Y, WIL priority
- **Export signals:** Trade shows, international partnerships → CanExport priority
- **R&D signals:** Patents, innovation features → SR&ED, IRAP priority
- **Training signals:** Upskilling messaging, certifications → ETG priority
- **Financial signals:** Funding rounds (capacity), distress warnings (deprioritize)

**Minimum 5+ sources required.** Cite all sources in Oracle Insight.

---

## 📊 ORACLE INSIGHT STRUCTURE (200-300 words)

Generate the Oracle Insight using this EXACT structure:

### 🏢 COMPANY OVERVIEW (50-75 words)
- Industry and market position
- Company size (revenue, employees)
- Geographic presence (city, province - MUST be Canada)
- Key capabilities/products/services
- Notable characteristics (innovation, growth stage, niche)
- **(Sources: List sources, e.g., "Website, BC Registry, LinkedIn")**

### 💰 GRANT PROGRAM FIT (50-75 words)
- Specific programs they qualify for (CanExport, IRAP, SR&ED, ETG, BCAFE, CSJ, DS4Y)
- **Verify each is ACTIVE** (state intake status, deadline)
- Why eligible (qualifying factors)
- Priority programs (which first, why)
- **Internal Success Data:** "Based on [X] similar clients, avg $[amount] funding, [%] close rate. Comparable to [client name]."
- **Timing Trigger:** [Specific urgency: hiring activity, trade show, R&D announcement]

### 🎯 SERVICE OFFERING (20-30 words)
- **Consult "Granted-Service-Tiers-Enhanced-for-Qualification" Google Doc**
- Recommend: Granted Pro / Granted Starter / Custom
- Rationale (1 sentence from qualification framework)
- **Affordability Check:** [Can afford tier / May need payment plan / Budget constraints]

### ✅ RECOMMENDED ACTION (30-50 words)
Choose ONE:

**REACH OUT IMMEDIATELY** (High priority, clear fit, urgency)
- **Contact:** [Name], [Title] ([email], [LinkedIn URL])
- **Approach:** [Email/LinkedIn/phone] - [Formal/casual tone]
- **Opening:** [Specific talking point tailored to situation]
- **Grant Sophistication:** [First-timer / Experienced / Unknown]

**RESEARCH FURTHER** (Potential fit, needs validation)
- What to verify, where to find info

**WARM NURTURE** (Good fit, timing unclear)
- Add to drip campaign, revisit when [timing trigger]

**DEPRIORITIZE** (Poor fit)
- Why not good fit (specific reasons)

**If competitor detected:**
⚠️ **Competitor Alert:** Working with [Name] (found on [source]). Recommend: [Nurture / Differentiation pitch]

### 🎯 CONFIDENCE LEVEL: [HIGH / MEDIUM / LOW]

**Rationale:**
- HIGH (90%+): 7+ sources, clear fit, strong precedent, verified Canadian, decision-maker found
- MEDIUM (60-89%): 4-6 sources, likely fit, assumptions made, verification needed
- LOW (<60%): <4 sources, speculative fit, major gaps

**Data Sources Used:** [List: Website, LinkedIn, BC Registry, GetGranted, HubSpot, News, VisualPing]
**Information Gaps:** [What's missing, e.g., "Revenue unknown", "Decision-maker not found"]

---

## ✅ FINAL QUALITY CONTROL

Before submitting, verify:
1. ✅ Company is Canadian (verified via registry/website)
2. ✅ No automatic disqualifiers
3. ✅ 5+ sources consulted and cited
4. ✅ All grants are ACTIVE (active_only=true confirmed)
5. ✅ Deadlines realistic (3+ weeks)
6. ✅ VisualPing alerts checked
7. ✅ Service tier matches qualification framework doc
8. ✅ Decision-maker identified (or "Not found")
9. ✅ HubSpot comparables searched
10. ✅ Specific action with timeline
11. ✅ Confidence level with sources listed
12. ✅ Answers: "Should we pursue?" with YES/NO

**Word count:**
- Section 1: 50-75 words ✓
- Section 2: 50-75 words ✓
- Section 3: 20-30 words ✓
- Section 4: 30-50 words ✓
- TOTAL: 200-300 words ✓

**If ANY item NOT checked → STOP, continue research or flag gaps.**

---

## 📝 YOUR TASK

1. **Verify Canadian company** (STOP if not)
2. **Check disqualifiers** (STOP if disqualified)
3. **Complete 9-step research** (minimum 5+ sources)
4. **Generate Oracle Insight** (follow structure exactly)
5. **Update HubSpot** with oracle_insight property

Use update_hubspot_company tool:

update_hubspot_company({
  company_id: "[found or created company ID]",
  properties: {
    oracle_insight: "[generated Oracle Insight]",
    best_fit_product_company: "[Granted Pro/Starter/Custom]",
    // ... other enriched fields (industry, description, etc.)
  }
})

**Remember:** This is AUTOMATIC enrichment. Be thorough, systematic, and actionable.`;
}

/**
 * Trigger Internal Oracle to research and enrich a lead
 * @param {Object} companyInfo - Company information to research
 * @returns {Promise<Object>} - Enrichment result
 */
async function enrichLead(companyInfo) {
  try {
    // Check deduplication cache
    const companyId = companyInfo.objectId || companyInfo.companyId;
    const now = Date.now();

    if (recentEnrichments.has(companyId)) {
      const lastEnrichment = recentEnrichments.get(companyId);
      const timeSince = now - lastEnrichment;

      if (timeSince < DEDUPE_WINDOW_MS) {
        console.log(`⏭️  Skipping duplicate enrichment for company ${companyId} (enriched ${Math.round(timeSince/1000)}s ago)`);
        return {
          success: false,
          error: 'Duplicate enrichment (deduplicated)',
          skipped: true
        };
      }
    }

    // Mark this enrichment in cache
    recentEnrichments.set(companyId, now);

    // Clean up old entries from cache (older than dedupe window)
    for (const [id, timestamp] of recentEnrichments.entries()) {
      if (now - timestamp > DEDUPE_WINDOW_MS) {
        recentEnrichments.delete(id);
      }
    }

    // Wait 3 seconds to allow HubSpot to index the new company
    console.log(`⏳ Waiting 3 seconds for HubSpot to index company ${companyId}...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Fetch company name from HubSpot if not provided (fixes "undefined" bug)
    let companyName = companyInfo.companyName;
    if (!companyName && companyId) {
      try {
        const result = await getCompanyById(companyId);
        if (result && result.success && result.company) {
          companyName = result.company.name || 'Unknown';
        }
      } catch (err) {
        console.warn(`⚠️  Could not fetch company name for ${companyId}:`, err.message);
        companyName = `Company ${companyId}`;
      }
    }

    console.log(`🔬 Starting automatic lead enrichment for: ${companyName}`);

    // Create a system conversation for the automated enrichment
    const conversationId = crypto.randomUUID();
    const agentType = 'internal-oracle';
    const userId = 1; // System user ID for automated tasks

    // Create conversation in database
    await createConversation(
      conversationId,
      userId,
      agentType,
      `Auto-enrichment: ${companyName}`
    );

    // Build comprehensive enrichment prompt with Oracle Insight instructions
    const enrichmentPrompt = generateOracleInsightPrompt(companyInfo);

    console.log(`📝 Oracle Insight enrichment prompt prepared (${enrichmentPrompt.length} chars)`);

    // Run the Internal Oracle agent (no streaming - webhook enrichment)
    // Use Haiku for cost efficiency - enrichment is structured/templated work
    const result = await runAgent({
      agentType,
      conversationId,
      userId,
      message: enrichmentPrompt,
      sessionId: crypto.randomUUID(),
      res: null, // No SSE streaming for webhook enrichment
      forceModel: 'claude-haiku-4-5', // Force Haiku: 5x cheaper than Sonnet
      modelConfig: { maxIterations: 15 } // More iterations for complex enrichments
    });

    console.log(`✅ Lead enrichment completed for: ${companyName}`);

    return {
      success: true,
      conversationId,
      result: result.response
    };

  } catch (error) {
    console.error('❌ Lead enrichment failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main webhook handler
 */
export async function handleHubSpotWebhook(req, res) {
  console.log('\n' + '='.repeat(80));
  console.log('📡 HubSpot webhook received');
  console.log('='.repeat(80));

  // ==========================================================================
  // AUTHENTICATION — must stay the FIRST thing this handler does.
  // Everything below it has side effects: the 200 ack, createConversation(),
  // and a full Oracle agent loop with HubSpot WRITE tools. Rejecting here means
  // an unauthenticated request creates no conversation row and makes no
  // Anthropic call. Do not move this below the ack.
  // ==========================================================================
  const auth = verifyWorkflowToken(req);
  if (!auth.ok) {
    // Log the reason only — never the provided or expected token value.
    console.error(`❌ HubSpot webhook rejected: ${auth.reason}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let payload = req.body;
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));

    // HubSpot can send either a single event object or an array of events
    // Normalize to array format
    if (!Array.isArray(payload)) {
      console.log('📝 Converting single event to array format');
      payload = [payload];
    }

    if (payload.length === 0) {
      console.error('❌ Empty payload received');
      return res.status(400).json({
        error: 'Empty payload',
        message: 'No events to process'
      });
    }

    // Respond immediately to HubSpot (don't make them wait)
    res.status(200).json({
      success: true,
      message: `Webhook received, processing ${payload.length} event(s)`
    });

    console.log(`🔄 Processing ${payload.length} event(s)...`);

    // Process each event asynchronously (don't block response)
    payload.forEach((event, index) => {
      // Extract company information from this event
      const companyInfo = extractCompanyInfo(event);

      if (!companyInfo) {
        console.error(`❌ Could not extract company information from event ${index}`);
        return;
      }

      console.log(`🏢 Event ${index + 1}/${payload.length} - Extracted company info:`, companyInfo);

      // -----------------------------------------------------------------------
      // Anti-loop guard: skip oracle enrichment for companies created by our
      // own API (changeSource === "INTEGRATION"). These are created by the
      // save_lead_data tool during lead-gen sessions. The HubSpot Note created
      // by save_lead_data already gives the sales team full context, so running
      // a concurrent oracle enrichment during the active lead-gen conversation
      // is unnecessary and can cause interleaving issues in the agent loop.
      // -----------------------------------------------------------------------
      if (
        companyInfo.subscriptionType === 'company.creation' &&
        companyInfo.changeSource === 'INTEGRATION'
      ) {
        console.log(`⏭️  Skipping oracle enrichment for INTEGRATION company creation (objectId: ${companyInfo.objectId}) — created by save_lead_data, HubSpot Note already contains full context`);
        return;
      }

      // Process enrichment asynchronously
      enrichLead(companyInfo)
        .then(result => {
          if (result.success) {
            console.log(`✅ Async enrichment completed for event ${index + 1}: ${companyInfo.objectId || companyInfo.companyName}`);
          } else {
            console.error(`❌ Async enrichment failed for event ${index + 1}: ${result.error}`);
          }
        })
        .catch(error => {
          console.error(`❌ Async enrichment error for event ${index + 1}:`, error);
        });
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);

    // Still return 200 to HubSpot to avoid retries
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET endpoint for webhook verification (HubSpot sends this to verify the endpoint)
 */
export async function verifyHubSpotWebhook(req, res) {
  console.log('🔐 HubSpot webhook verification request');

  // HubSpot sends a verification challenge
  const challenge = req.query.challenge || req.query.hub_challenge;

  if (challenge) {
    console.log('✅ Responding to verification challenge');
    return res.status(200).send(challenge);
  }

  res.status(200).json({
    status: 'ready',
    endpoint: '/api/hubspot-webhook'
  });
}
