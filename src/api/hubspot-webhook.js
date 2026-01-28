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
import crypto from 'crypto';

/**
 * Verify HubSpot webhook signature (optional but recommended)
 * @param {string} signature - X-HubSpot-Signature header
 * @param {string} requestBody - Raw request body
 * @returns {boolean} - Whether signature is valid
 */
function verifyHubSpotSignature(signature, requestBody) {
  if (!process.env.HUBSPOT_WEBHOOK_SECRET) {
    console.warn('⚠️  HUBSPOT_WEBHOOK_SECRET not set - skipping signature verification');
    return true;
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.HUBSPOT_WEBHOOK_SECRET)
    .update(requestBody)
    .digest('hex');

  return signature === expectedSignature;
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

  // Handle workflow webhook (most common)
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
\`\`\`
❌ DISQUALIFIED: [Company Name]
Reason: [Specific disqualifier]
\`\`\`

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

### 5. Grant Program Matching
- **CRITICAL:** Use search_getgranted with **active_only=true**
- Check **open_intakes_only=true** for urgent opportunities
- **Consult get_visualping_alerts (past 30 days)** for program changes
- Cross-reference eligibility vs company profile
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
\`\`\`
update_hubspot_company({
  company_id: "[found or created company ID]",
  properties: {
    oracle_insight: "[generated Oracle Insight]",
    best_fit_product_company: "[Granted Pro/Starter/Custom]",
    // ... other enriched fields (industry, description, etc.)
  }
})
\`\`\`

**Remember:** This is AUTOMATIC enrichment. Be thorough, systematic, and actionable.`;
}

/**
 * Trigger Internal Oracle to research and enrich a lead
 * @param {Object} companyInfo - Company information to research
 * @returns {Promise<Object>} - Enrichment result
 */
async function enrichLead(companyInfo) {
  console.log(`🔬 Starting automatic lead enrichment for: ${companyInfo.companyName || companyInfo.contactEmail}`);

  try {
    // Create a system conversation for the automated enrichment
    const conversationId = crypto.randomUUID();
    const agentType = 'internal-oracle';
    const userId = 1; // System user ID for automated tasks

    // Create conversation in database
    await createConversation(
      conversationId,
      userId,
      agentType,
      `Auto-enrichment: ${companyInfo.companyName || companyInfo.contactEmail}`
    );

    // Build comprehensive enrichment prompt with Oracle Insight instructions
    const enrichmentPrompt = generateOracleInsightPrompt(companyInfo);

    console.log(`📝 Oracle Insight enrichment prompt prepared (${enrichmentPrompt.length} chars)`);

    // Run the Internal Oracle agent
    const result = await runAgent({
      agentType,
      conversationId,
      userId,
      message: enrichmentPrompt,
      sessionId: crypto.randomUUID()
    });

    console.log(`✅ Lead enrichment completed for: ${companyInfo.companyName || companyInfo.contactEmail}`);

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

  try {
    // Verify signature if configured
    const signature = req.headers['x-hubspot-signature'];
    const rawBody = JSON.stringify(req.body);

    if (signature && !verifyHubSpotSignature(signature, rawBody)) {
      console.error('❌ Invalid HubSpot webhook signature');
      return res.status(401).json({
        error: 'Invalid signature'
      });
    }

    const payload = req.body;
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));

    // Extract company information
    const companyInfo = extractCompanyInfo(payload);

    if (!companyInfo) {
      console.error('❌ Could not extract company information from payload');
      return res.status(400).json({
        error: 'Invalid payload format',
        message: 'Could not extract company information'
      });
    }

    console.log('🏢 Extracted company info:', companyInfo);

    // Respond immediately to HubSpot (don't make them wait)
    res.status(200).json({
      success: true,
      message: 'Webhook received, enrichment queued'
    });

    // Process enrichment asynchronously (don't block response)
    enrichLead(companyInfo)
      .then(result => {
        if (result.success) {
          console.log(`✅ Async enrichment completed: ${companyInfo.companyName || companyInfo.contactEmail}`);
        } else {
          console.error(`❌ Async enrichment failed: ${result.error}`);
        }
      })
      .catch(error => {
        console.error('❌ Async enrichment error:', error);
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
