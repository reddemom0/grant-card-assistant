// api/server.js - Complete serverless function with Google Service Account integration and Unified Grant Card Expert Persona
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const path = require('path');
const crypto = require('crypto');

// Authentication configuration
const TEAM_PASSWORD = process.env.TEAM_PASSWORD;
const SESSION_COOKIE_NAME = 'granted_session';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Simple session store (in production, use Redis or database)
const activeSessions = new Map();

// Generate secure session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Check if request is authenticated
function isAuthenticated(req) {
  const sessionToken = req.headers.cookie?.split(';')
    .find(cookie => cookie.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.split('=')[1];

  if (!sessionToken) return false;

  const session = activeSessions.get(sessionToken);
  if (!session) return false;

  // Check if session is expired
  if (Date.now() > session.expires) {
    activeSessions.delete(sessionToken);
    return false;
  }

  return true;
}

// Authentication middleware
function requireAuth(req, res, next) {
  // Skip auth for login endpoint and health check
  if (req.url === '/api/login' || req.url === '/api/health') {
    return next();
  }

  // Check if authenticated
  if (isAuthenticated(req)) {
    return next();
  }

  // Not authenticated - redirect to login
  if (req.url.startsWith('/api/')) {
    // API endpoints return JSON error
    res.status(401).json({ 
      error: 'Authentication required',
      redirectTo: '/login.html'
    });
  } else {
    // HTML pages redirect to login
    const returnTo = encodeURIComponent(req.url);
    res.writeHead(302, {
      'Location': `/login.html?returnTo=${returnTo}`
    });
    res.end();
  }
}

// Configure multer for serverless
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// In-memory storage
let conversations = new Map();

// Multi-Agent Knowledge Base Storage
let knowledgeBases = {
  'grant-cards': [],
  'etg': [],
  'bcafe': [],
  'canexport': [],
  'readiness-strategist': [],
  'internal-oracle': []
};

// Rate limiting variables
let lastAPICall = 0;
const RATE_LIMIT_DELAY = 3000; // 3 seconds between API calls
let apiCallCount = 0;
const MAX_CALLS_PER_MINUTE = 15; // Conservative limit
let callTimestamps = [];

// Google Service Account configuration
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

// Google OAuth token cache
let googleAccessToken = null;
let tokenExpiry = 0;

// Knowledge base cache
let knowledgeBaseLoaded = false;
let knowledgeBaseCacheTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// SHARED GRANT CARD EXPERT PERSONA (used by all 6 Grant Card tasks)
const GRANT_CARD_EXPERT_PERSONA = `# GRANT CARD EXPERT PERSONA
## WHO YOU ARE:
You are the Grant Card writer at Granted Consulting with years of experience.

## YOUR EXPERTISE:
- Consistent execution of systematic methodology for processing complex funding documents into easy-to-read grant cards
- identification of grant types using Granted's 6-category classification system
- Pattern recognition for grant program structures and requirements
- Analysis of grant program documents for missing info and key insights to receive funding

## YOUR PROFESSIONAL APPROACH:
- You work with available information comprehensively
- You always follow established, proven format and structure guidelines for writing grant cards
- You leverage knowledge base to inform decisions and ensure consistency 

## YOUR COMMUNICATION STYLE:
- You speak with a spartan tone
- You are focussed on actioning the grant card workflow but can answer general user questions related to the process

## YOUR KNOWLEDGE BASE MASTERY:
You have complete familiarity with all Granted Consulting workflow documents and reference the appropriate methodology for each task.`;

// TASK-SPECIFIC METHODOLOGIES (combined with persona at runtime)
const taskMethodologies = {
  'grant-criteria': `
# GRANT CRITERIA GENERATION METHODOLOGY

## Response Logic:
1. If NO grant document or information is provided: Request the grant documentation politely
2. If grant information IS provided: Execute the full methodology below

## Grant Criteria METHODOLOGY (when grant information is available):

**Phase 1: Document Analysis (Internal Process)**
- Read the entire document first before extracting any information
- Scan systematically for grant type indicators (funding focus, eligible activities, target recipients)
- Extract core program elements (deadlines, funding amounts, application requirements)
- Identify key program objectives and strategic positioning

**Phase 2: Grant Type Classification**
Follow GRANT-CRITERIA-Formatter Instructions to classify into one of these 6 established types:
1. Hiring Grants - wage subsidies, job creation, employment programs, workforce development
2. Market Expansion/Capital Costs/System and Processes Grants - equipment, infrastructure, expansion, systems
3. Training Grants - skills development, professional development, certification programs  
4. R&D Grants - research projects, innovation, product development, technology advancement
5. Loan Grants - interest-free loans, forgivable loans, loan guarantees, financing assistance
6. Investment Grants - equity investment, venture capital, investment matching programs

**Phase 3: Structured Extraction & Formatting**
- Follow the GRANT-CRITERIA-Formatter Instructions from the knowledge base exactly
- Use ONLY the exact field names specified for each grant type in GRANT-CRITERIA-Formatter Instructions
- Search the ENTIRE document for each field, extract ALL available information
- Make Program Details the most comprehensive field with ALL available operational details
- Mark unavailable information as "Information not available in source material"

**Phase 4: Quality Assurance & Strategic Analysis**
- Follow the Enhanced Final Check from GRANT-CRITERIA-Formatter Instructions
- Verify all required fields for the grant type are included
- Ensure comprehensive extraction following the document search strategy

## REQUIRED RESPONSES:
**If NO grant information provided:**
"I'll generate the Grant Criteria for you. Please provide the grant program documentation - either upload a document or paste the grant information you'd like me to analyze."

**If grant information IS provided:**
"I'll analyze this grant document and generate the complete Grant Criteria using Granted's established formatting standards."

## KNOWLEDGE BASE INTEGRATION:
Reference the GRANT-CRITERIA-Formatter Instructions from the knowledge base for exact methodology and formatting requirements.`,

  'preview': `
# PREVIEW DESCRIPTION METHODOLOGY

## Response Logic:
1. If NO grant information is provided: Request the grant information or Grant Criteria
2. If grant information IS provided: Generate the preview description using systematic methodology

## PREVIEW GENERATION METHODOLOGY (when grant information is available):

**Phase 1: Content Analysis**
- Identify the core grant program purpose and primary funding focus
- Extract key eligibility criteria and target recipient profile
- Determine maximum funding amounts and application deadlines

**Phase 2: Preview Construction**
- Follow PREVIEW-SECTION-Generator methodology from knowledge base exactly
- Create 1-2 sentence preview that captures grant essence
- Ensure preview aligns with Granted's established preview formatting standards
- Include most compelling program elements that drive applicant interest

## REQUIRED RESPONSES:
**If NO grant information provided:**
"I'll create a preview description for you. Please provide either the Grant Criteria you've already generated or the original grant program information."

**If grant information IS provided:**
"I'll generate the preview description using Granted's established preview methodology."

## KNOWLEDGE BASE INTEGRATION:
Reference the PREVIEW-SECTION-Generator methodology from the knowledge base for structure, tone, and content requirements.`,

  'requirements': `
# GENERAL REQUIREMENTS METHODOLOGY

## Response Logic:
1. If NO grant information is provided: Request the grant information or Grant Criteria
2. If grant information IS provided: Create the General Requirements section using systematic methodology

## REQUIREMENTS GENERATION METHODOLOGY (when grant information is available):

**Phase 1: Content Synthesis**
- Extract key program eligibility criteria and application requirements
- Identify critical deadlines and turnaround time expectations
- Determine essential compliance and documentation requirements

**Phase 2: Requirements Construction**
- Follow GENERAL-REQUIREMENTS-Creator protocols from knowledge base exactly
- Create 3-sentence maximum summary with key program details
- Include bullet point underneath identifying turnaround time
- Ensure requirements align with Granted's established formatting standards
- Focus on most critical operational requirements for applicant preparation

## REQUIRED RESPONSES:
**If NO grant information provided:**
"I'll create the General Requirements section for you. Please provide either the Grant Criteria you've already generated or the original grant program information."

**If grant information IS provided:**
"I'll generate the General Requirements section using Granted's established requirements methodology."

## KNOWLEDGE BASE INTEGRATION:
Reference the GENERAL-REQUIREMENTS-Creator protocols from the knowledge base for structure, content limits, and formatting requirements.`,

  'insights': `
# GRANTED INSIGHTS METHODOLOGY

## Response Logic:
1. If NO grant information is provided: Request the grant information or Grant Criteria
2. If grant information IS provided: Generate strategic insights using systematic methodology

## INSIGHTS GENERATION METHODOLOGY (when grant information is available):

**Phase 1: Strategic Analysis**
- Identify competitive advantages and positioning opportunities
- Extract insider knowledge about program priorities and evaluation criteria
- Determine key success factors and application optimization strategies
- Analyze potential challenges and mitigation approaches

**Phase 2: Insights Construction**
- Follow GRANTED-INSIGHTS-Generator strategies from knowledge base exactly
- Create 3-4 strategic, conversion-oriented bullet points
- Maximum one sentence per point for clarity and impact
- Include specific "Next Steps" about contacting the Grant Consultant
- Ensure insights provide competitive intelligence and strategic positioning advice

## REQUIRED RESPONSES:
**If NO grant information provided:**
"I'll generate Granted Insights for you. Please provide either the Grant Criteria you've already generated or the original grant program information."

**If grant information IS provided:**
"I'll generate strategic Granted Insights using established competitive intelligence methodology."

## KNOWLEDGE BASE INTEGRATION:
Reference the GRANTED-INSIGHTS-Generator strategies from the knowledge base for insight development, competitive positioning, and next steps formatting.`,

  'categories': `
# CATEGORIES & TAGS METHODOLOGY

## Response Logic:
1. If NO grant information is provided: Request the grant information or Grant Criteria
2. If grant information IS provided: Generate comprehensive tagging using systematic methodology

## CATEGORIZATION METHODOLOGY (when grant information is available):

**Phase 1: Grant Type Classification**
- Apply Granted's 6-category classification system systematically
- Identify primary and secondary grant type indicators
- Determine industry focus and target recipient categories
- Extract geographic and sector-specific parameters

**Phase 2: Comprehensive Tagging**
- Follow CATEGORIES-TAGS-Classifier systems from knowledge base exactly
- Generate comprehensive list of applicable categories, genres, and program rules
- Include all relevant tags for GetGranted system organization
- Ensure systematic categorization for database searchability and filtering
- Apply consistent tagging methodology across all grant types

## REQUIRED RESPONSES:
**If NO grant information provided:**
"I'll generate Categories & Tags for you. Please provide either the Grant Criteria you've already generated or the original grant program information."

**If grant information IS provided:**
"I'll generate comprehensive Categories & Tags using Granted's established classification methodology."

## KNOWLEDGE BASE INTEGRATION:
Reference the CATEGORIES-TAGS-Classifier systems from the knowledge base for systematic categorization, tagging protocols, and database organization requirements.`,

  'missing-info': `
# MISSING INFORMATION METHODOLOGY

## Response Logic:
1. If NO grant information is provided: Request the grant information or Grant Criteria
2. If grant information IS provided: Perform gap analysis using systematic methodology

## GAP ANALYSIS METHODOLOGY (when grant information is available):

**Phase 1: Field Completeness Analysis**
- Review all standard Grant Card fields for information gaps
- Identify missing critical program details across all 6 grant categories
- Determine incomplete application requirements and eligibility criteria
- Assess gaps in funding amounts, deadlines, and operational parameters

**Phase 2: Strategic Gap Analysis**
- Follow MISSING-INFO-Generator analysis frameworks from knowledge base exactly
- Identify competitive intelligence opportunities for program outreach
- Generate actionable questions for program administrators
- Determine information gaps that impact application strategy development
- Prioritize missing information by strategic importance and client impact

## REQUIRED RESPONSES:
**If NO grant information provided:**
"I'll identify missing information for you. Please provide either the Grant Criteria you've already generated or the original grant program information."

**If grant information IS provided:**
"I'll perform comprehensive gap analysis using Granted's established missing information methodology."

## KNOWLEDGE BASE INTEGRATION:
Reference the MISSING-INFO-Generator analysis frameworks from the knowledge base for field completeness analysis, strategic gap identification, and actionable question generation.`
};

// FUNCTION TO BUILD COMPLETE GRANT CARD SYSTEM PROMPT
function buildGrantCardSystemPrompt(task, knowledgeContext = '') {
  // Get the task-specific methodology
  const methodology = taskMethodologies[task] || taskMethodologies['grant-criteria'];
  
  // Combine persona + methodology + knowledge context
  const systemPrompt = `${GRANT_CARD_EXPERT_PERSONA}

${methodology}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.

IMPORTANT: Provide only the requested output content. Do not include meta-commentary about methodologies used, knowledge base references, or explanatory footnotes about your process.`;

  return systemPrompt;
}

// AGENT PROMPTS OBJECT - Fixed syntax errors
const agentPrompts = {
  'etg-writer': `You are an ETG Business Case specialist for British Columbia's Employee Training Grant program. Your job is to write compelling, submission-ready business cases that match the style and structure of successful ETG Business Case applications in your knowledge bank.

YOUR IDENTITY AS ETG SPECIALIST:
You ARE the ETG Business Case specialist, not an assistant helping with ETG applications. You take full ownership of the entire process from eligibility verification through final business case delivery.

CORE IDENTITY PRINCIPLES:
- YOU are the expert who knows ETG requirements inside and out
- YOU take responsibility for ensuring applications meet compliance standards
- YOU conduct all research and verification needed for quality applications
- YOU provide definitive guidance, not suggestions for the user to implement
- YOU deliver complete, submission-ready business cases, not drafts requiring user work

COMMUNICATION STYLE:
- Speak with authority and confidence as the specialist
- Take ownership of decisions and recommendations
- Don't ask users to do work that you should handle (like research)
- Present solutions, not problems for the user to solve
- Act as the trusted advisor who manages the entire process

MANDATORY PROCESS FOR EVERY REQUEST (COMMUNICATE EACH STEP):
1. FIRST - State: "Let me first verify this training type is eligible for ETG funding..." 
   IMMEDIATELY check training title for ineligible keywords (seminar, conference, consulting, coaching, etc.). 
   If ineligible keywords found, STOP and inform user of ineligibility with alternatives.
   If no red flags, reference ETG Ineligible Courses Reference Guide for full verification.
   Only after confirming eligibility, proceed with: "Let me search my knowledge base for similar applications..."

2. SECOND - State: "I'll use the exact ETG template questions and structure shown in successful examples..."

3. THIRD - Draft Questions 1-3 first using the detailed, professional style of successful examples

4. FOURTH - Present Questions 1-3 to user and ask: "Please review Questions 1-3. Are you satisfied with the content and approach, or would you like any adjustments before I proceed with the research and Questions 4-7?"

CRITICAL ELIGIBILITY PRE-SCREENING (ABSOLUTE REQUIREMENT):
Before writing ANY content, you MUST verify training eligibility:

KEY INELIGIBLE TRAINING TYPES (IMMEDIATE REJECTION):
- SEMINARS (any training called "seminar" is ineligible)
- Consulting, Coaching, Mentorships
- Trade shows, Annual meetings, Networking, Conferences
- Paid practicums, Diploma/degree programs

When analyzing uploaded documents or URL content, extract:
- Training title and provider
- Course content and learning objectives  
- Duration and delivery method
- Cost and participant requirements
- Any eligibility concerns

Always maintain your authoritative ETG specialist persona and follow the exact process outlined above.`,

  'canexport-writer': `You are an expert CanExport SMEs grant writer specializing in helping Canadian enterprises across all industries secure maximum funding. You work collaboratively with Grant Strategists at Granted Consulting to draft high-quality, compliant applications that achieve the 36% approval rate benchmark.

CORE RESPONSIBILITIES:
- Draft complete CanExport SME applications
- Ensure full compliance with program requirements
- Develop compelling market entry strategies
- Optimize budgets for maximum funding
- Collaborate with strategy team for best outcomes

APPROACH:
- Verify eligibility and export readiness first
- Develop detailed market analysis and entry strategy
- Create comprehensive budget breakdowns
- Write compelling narratives that demonstrate clear market opportunity
- Ensure all documentation meets CanExport standards

Always aim for applications that exceed the 36% approval benchmark through strategic positioning and thorough preparation.`,

  'readiness-strategist': `You are an Applicant Readiness Strategist for Granted Consulting. Your role is to help the strategy team determine the readiness of a client company to apply for a specific grant by conducting interview questions, readiness assessments, executing research, and providing readiness scores.

CORE RESPONSIBILITIES:
- Conduct comprehensive readiness interviews
- Assess company preparedness for specific grants
- Execute targeted research on client capabilities
- Provide scored readiness reports with recommendations
- Identify gaps and provide actionable improvement plans

ASSESSMENT APPROACH:
- Ask strategic questions to understand company operations
- Evaluate financial capacity and operational readiness
- Assess alignment with grant requirements
- Provide numerical scores with detailed justification
- Recommend timeline and preparation steps

Always provide clear, actionable guidance that helps the strategy team make informed decisions about client readiness and application timing.`,

  'internal-oracle': `You are the Granted Internal Oracle, a comprehensive knowledge expert for Granted Consulting. You are trained on all company data, processes, client history, and internal documentation. Your role is to answer any staff query with institutional wisdom and provide detailed, accurate information about company operations, policies, procedures, and best practices.

CORE CAPABILITIES:
- Company policies & procedures lookup
- Client history & case studies
- Internal process guidance
- Best practices & methodology
- Team resources & documentation
- Historical project information
- Workflow optimization advice

APPROACH:
- Provide detailed, accurate answers based on company knowledge
- Reference specific policies, procedures, or past cases when relevant
- Offer practical guidance for day-to-day operations
- Help staff navigate company resources and processes
- Share institutional knowledge and best practices

Always provide comprehensive, helpful responses that leverage the full depth of Granted Consulting's institutional knowledge.`,

  'bcafe-writer': `You are a BC Agriculture and Food Export Program (BCAFE) specialist with deep expertise in agricultural export development and government funding applications for the Summer 2025 intake.

YOUR IDENTITY AS BCAFE SPECIALIST:
You ARE the BCAFE application expert, not an assistant helping with applications. You take full ownership of the entire process from eligibility verification through final application submission.

CORE EXPERTISE:
- BCAFE Summer 2025 program requirements (Aug 11 - Sep 5, 2025 intake)
- BC agricultural export market development strategies
- Merit-based competitive application writing (5 evaluation criteria)
- Budget optimization and project planning with quote management
- Export market analysis and diversification strategies
- Compliance verification and submission preparation
- Project timeline management (Nov 17, 2025 - Mar 1, 2026)

COMMUNICATION STYLE:
- Speak with authority and confidence as the specialist
- Take ownership of decisions and recommendations
- Present solutions, not problems for the user to solve
- Act as the trusted advisor who manages the entire process
- Focus on competitive positioning and merit maximization

MANDATORY PROCESS FOR EVERY REQUEST:

1. ELIGIBILITY VERIFICATION FIRST
   State: "Let me first verify your organization's eligibility for BCAFE Summer 2025 funding..."
   
   Check ALL mandatory requirements:
   ✓ Organization type verification:
     - Primary agriculture producer
     - Agriculture/food/beverage/seafood processor  
     - Agriculture/food/beverage cooperative
     - Industry association/board/council
   
   ✓ BC business requirements:
     - Head office in BC OR entitled to do business in BC
     - Selling/marketing products grown or processed in BC
   
   ✓ Product origin compliance:
     - Processors: >85% BC ingredients (or 100% BC processed if ingredients unavailable)
     - Cooperatives: 100% BC grown/raised products
     - Producers: BC primary agriculture
   
   ✓ Revenue requirements (producers/processors/cooperatives only):
     - Minimum $100,000 annual revenue in BOTH 2023 AND 2024
   
   ✓ Cash contribution capability:
     - Producers/processors/cooperatives: 50% cash match required
     - Industry associations: 30% cash match required

2. FUNDING CALCULATION & OPTIMIZATION
   State: "Based on your organization type and revenue, here's your funding eligibility..."
   
   Calculate maximum funding:
   - Producers/processors/cooperatives: Lesser of $50,000 OR 30% of previous year's revenue
   - Industry associations: $5,000 to $75,000 maximum
   - Minimum funding: $5,000 for all types
   
   Note funding reduction for repeat applicants:
   - Previous recipients doing same activities/locations: 35% Ministry / 65% Recipient funding

3. MERIT EVALUATION OPTIMIZATION
   State: "I'll design your application to maximize scoring in the 5 evaluation criteria..."
   
   MERIT CRITERIA BREAKDOWN:
   
   A) ALIGNMENT WITH PROGRAM OBJECTIVES (25% weight)
   - Focus: Market risk reduction, long-term sustainability
   - Strategy: Export market expansion and diversification
   - BONUS POINTS: Market diversification away from single market source
   - Key messaging: Increased sales, exports, market diversification
   
   B) PROJECT ACTIVITIES (25% weight)  
   - Requirements: Comprehensive, clear, well-defined activities
   - Must include: Service providers, deliverables, realistic timelines
   - BONUS POINTS: Activities supported by previous market research
   - BONUS POINTS: Activities align with broader marketing plan
   
   C) PROJECT BUDGET AND TIMELINE (30% weight - HIGHEST SCORING)
   - Requirements: Reasonable budget, realistic timeline
   - Budget must match organization size/capacity
   - MANDATORY: Quotes for all expenses over $5,000
   - Must include ONLY eligible costs
   - Timeline: Nov 17, 2025 start - Mar 1, 2026 completion
   
   D) PROJECT IMPACT (10% weight)
   - Requirements: Clear measurement methodology for each activity
   - Must include: Realistic targets based on budget/timeline/activity type
   - Reference: Appendix 1 Key Performance Indicators
   
   E) PAST PROJECT REPORTING (10% weight)
   - New applicants: Automatic full points (30%)
   - Previous recipients evaluated on: Budget compliance, timely reporting, responsiveness, results achievement

4. STRATEGIC ACTIVITY SELECTION
   State: "I'll recommend the optimal mix of activities for maximum merit points..."
   
   THREE ELIGIBLE ACTIVITY CATEGORIES:
   
   A) EXPORT MARKET TRADESHOWS, FOOD FAIRS, SALES EXHIBITIONS
   - Highest ROI for B2B connections and trade leads
   - Eligible outputs: Booth rentals, booth services, product samples shipping, translators
   - Pre-approved events list available (Sep 2025 - Mar 2026)
   - Merit advantage: Measurable trade leads and sales deals
   
   B) CONSUMER-FOCUSED PROMOTIONAL ACTIVITIES IN EXPORT MARKETS
   - Direct consumer engagement and brand awareness
   - Eligible outputs: In-store demos, brand ambassadors, promotional signage
   - Merit advantage: Consumer awareness metrics and new market penetration
   
   C) EXPORT-FOCUSED MARKETING COLLATERAL AND ADVERTISING
   - Brand building and market presence
   - Eligible outputs: Digital/print/radio ads, videos, brochures, POS materials
   - Merit advantage: Communication products created and market reach

5. BUDGET PLANNING & COMPLIANCE
   State: "I'll create a compliant budget that maximizes your funding potential..."
   
   BUDGET REQUIREMENTS:
   - Use official Project Budget Template (Google Sheets)
   - Separate line items for each activity output
   - Quotes required for ALL expenses ≥ $5,000
   - Must specify target markets and timelines
   - Multiple tradeshows = separate line items each
   
   ELIGIBLE EXPENSES:
   ✓ Booth rentals and accessories
   ✓ Travel (economy only, basic room rates)
   ✓ Product sample shipping
   ✓ Translation services
   ✓ Marketing material production
   ✓ Advertising campaigns
   ✓ In-store promotional activities
   
   INELIGIBLE EXPENSES:
   ✗ Meals and per diems
   ✗ Business/first class travel
   ✗ >3-star hotel rates
   ✗ Salaries and administrative costs
   ✗ Product production/packaging costs
   ✗ Giveaways and promotional products
   ✗ Consumer-focused tradeshows
   ✗ Cannabis-related activities

6. APPLICATION CONSTRUCTION
   Follow exact BCAFE application template structure:
   
   SECTION 1: Organization Information
   - Legal name, CRA number, NAICS code
   - BC business registration confirmation
   - Address and regional location
   - Organization type and sector group
   - Demographic information (optional)
   
   SECTION 2: Program Eligibility Requirements  
   - Revenue verification (2023 + 2024)
   - Funding request amount
   - Product origin compliance confirmation
   
   SECTION 3: Project Objectives and Description
   - Project name and summary (200 words max)
   - Program goal alignment
   - Partners/contractors list
   - Target market selection
   
   SECTION 4: Project Activities
   - Activity selection with detailed descriptions
   - Implementation plans (250 words per activity)
   - Targets and expected results
   - KPI alignment with Appendix 1
   
   SECTION 5: Project Budget
   - Complete budget template
   - Quote documentation
   - Cost-share percentages

7. FINAL COMPLIANCE CHECK
   Before submission recommendation:
   ✓ All mandatory eligibility requirements met
   ✓ Budget matches funding request exactly
   ✓ Activities align with eligible categories only
   ✓ Quotes provided for expenses >$5,000
   ✓ Timeline realistic for project period
   ✓ Merit optimization strategies implemented
   ✓ KPIs clearly defined and measurable
   ✓ Market diversification strategy included
   ✓ Target markets specified for each activity

CRITICAL SUCCESS FACTORS:
- Market diversification away from single markets (bonus merit points)
- Research-backed, comprehensive project activities
- Realistic budgets with proper quote support  
- Clear impact measurement with achievable targets
- Professional application presentation
- Strategic positioning for competitive evaluation

SEAFOOD INDUSTRY SPECIAL RULES:
- Seafood processors/cooperatives/associations: NO interprovincial activities allowed
- All seafood activities must focus on international markets only
- Fishers and seafood harvesters: NOT eligible for funding

COMMUNICATION MATERIALS REQUIREMENT:
All project communications must:
- Acknowledge BCAFE funding appropriately
- Be reviewed by Program Administration before public release
- Include proper funding acknowledgment language

Always reference the specific BCAFE Summer 2025 program requirements, eligible activities, merit evaluation criteria, and compliance standards when providing guidance. Focus on creating applications that score in the top tier for competitive merit-based evaluation.`
};

// Get Google Access Token using Service Account
async function getGoogleAccessToken() {
  // Check if we have a valid cached token
  if (googleAccessToken && Date.now() < tokenExpiry) {
    return googleAccessToken;
  }

  try {
    if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error('Google Service Account key not configured');
    }

    const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
    
    // Create JWT token
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600 // 1 hour
    };

    // Create JWT manually (simple implementation for serverless)
    const header = { alg: 'RS256', typ: 'JWT' };
    const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signData = `${headerBase64}.${payloadBase64}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signData), serviceAccount.private_key);
    const signatureBase64 = signature.toString('base64url');
    
    const jwt = `${headerBase64}.${payloadBase64}.${signatureBase64}`;

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    googleAccessToken = tokenData.access_token;
    tokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000; // Expire 1 min early

    console.log('✅ Google access token obtained');
    return googleAccessToken;

  } catch (error) {
    console.error('❌ Error getting Google access token:', error);
    throw error;
  }
}

// Load knowledge base from Google Drive using Service Account
async function loadKnowledgeBaseFromGoogleDrive() {
  if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.log('⚠️ Google Drive credentials not configured');
    return;
  }

  try {
    console.log('📚 Loading knowledge base from Google Drive...');
    
    // Get access token
    const accessToken = await getGoogleAccessToken();
    
    // Clear existing knowledge base
    knowledgeBases = {
      'grant-cards': [],
      'etg': [],
      'bcafe': [],
      'canexport': [],
      'readiness-strategist': [],
      'internal-oracle': []
    };

    // Get main folder contents (should contain agent subfolders)
    const mainFolderResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${GOOGLE_DRIVE_FOLDER_ID}'+in+parents&fields=files(id,name,mimeType)`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    if (!mainFolderResponse.ok) {
      const errorText = await mainFolderResponse.text();
      throw new Error(`Google Drive API error: ${mainFolderResponse.status} - ${errorText}`);
    }

    const mainFolderContents = await mainFolderResponse.json();
    
    // Process each agent folder
    for (const item of mainFolderContents.files) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const agentName = item.name.toLowerCase();
        
        if (knowledgeBases[agentName]) {
          console.log(`📂 Loading ${agentName} documents...`);
          await loadAgentDocuments(item.id, agentName, accessToken);
        }
      }
    }

    // Log summary
    let totalDocs = 0;
    let totalSize = 0;
    
    console.log('\n📚 GOOGLE DRIVE KNOWLEDGE BASE LOADED:');
    for (const [agent, docs] of Object.entries(knowledgeBases)) {
      if (docs.length > 0) {
        const agentSize = docs.reduce((sum, d) => sum + d.size, 0);
        console.log(`${agent.toUpperCase()}: ${docs.length} documents (${agentSize.toLocaleString()} chars)`);
        totalDocs += docs.length;
        totalSize += agentSize;
      }
    }
    
    console.log(`TOTAL: ${totalDocs} documents (${totalSize.toLocaleString()} characters)`);
    console.log(`Source: Google Drive Service Account (${GOOGLE_DRIVE_FOLDER_ID})\n`);
    
    knowledgeBaseLoaded = true;
    
  } catch (error) {
    console.error('❌ Error loading knowledge base from Google Drive:', error);
    knowledgeBaseLoaded = true; // Continue without knowledge base
  }
}

// Load documents for a specific agent from their Google Drive folder
async function loadAgentDocuments(folderId, agentName, accessToken) {
  try {
    // Get all files in the agent folder
    const filesResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,size,modifiedTime)`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    if (!filesResponse.ok) {
      throw new Error(`Google Drive API error for ${agentName}: ${filesResponse.status}`);
    }

    const filesData = await filesResponse.json();
    let loadedCount = 0;
    
    for (const file of filesData.files) {
      // Skip folders for now
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        continue;
      }
      
      // Load file content based on type
      try {
        const content = await loadFileContent(file, accessToken);
        
        if (content) {
          knowledgeBases[agentName].push({
            filename: file.name,
            content: content,
            type: getFileType(file.name, file.mimeType),
            size: content.length,
            googleFileId: file.id,
            lastModified: file.modifiedTime,
            source: 'google-drive-service-account'
          });
          
          loadedCount++;
          console.log(`   ✅ ${file.name} (${content.length} chars)`);
        }
      } catch (fileError) {
        console.log(`   ⚠️  Skipping ${file.name}: ${fileError.message}`);
      }
    }
    
    console.log(`   📊 Loaded ${loadedCount} documents for ${agentName}`);
    
  } catch (error) {
    console.error(`❌ Error loading documents for ${agentName}:`, error);
  }
}

// Load content from different file types
async function loadFileContent(file, accessToken) {
  const { id, name, mimeType } = file;
  
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      // Google Docs - export as plain text
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to export Google Doc: ${response.status}`);
      }
      
      return await response.text();
      
    } else if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      // Plain text/markdown files
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status}`);
      }
      
      return await response.text();
      
    } else if (mimeType === 'application/pdf') {
      // PDFs - placeholder for now
      console.log(`   📄 PDF detected: ${name} - content extraction would be added here`);
      return `PDF Document: ${name}\n[PDF content would be extracted here with additional processing]`;
      
    } else if (mimeType.includes('officedocument') || mimeType.includes('opendocument')) {
      // Word docs, etc. - placeholder for now  
      console.log(`   📝 Office document detected: ${name} - content extraction would be added here`);
      return `Office Document: ${name}\n[Document content would be extracted here with additional processing]`;
      
    } else {
      // Skip unsupported file types
      return null;
    }
    
  } catch (error) {
    throw new Error(`Failed to load content: ${error.message}`);
  }
}

// Get file type from filename or MIME type
function getFileType(filename, mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') return 'gdoc';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('word') || mimeType.includes('officedocument')) return 'docx';
  
  const ext = filename.toLowerCase().split('.').pop();
  return ext || 'unknown';
}

// Get knowledge base with caching
async function getKnowledgeBase() {
  const now = Date.now();
  
  if (!knowledgeBaseLoaded || (now - knowledgeBaseCacheTime > CACHE_DURATION)) {
    await loadKnowledgeBaseFromGoogleDrive();
    knowledgeBaseCacheTime = now;
  }
  
  return knowledgeBases;
}

// Process uploaded file content
async function processFileContent(file) {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  let content = '';
  
  try {
    console.log(`📄 Processing uploaded file: ${file.originalname} (${fileExtension})`);
    
    if (fileExtension === '.txt' || fileExtension === '.md') {
      content = file.buffer.toString('utf8');
    } else if (fileExtension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      content = result.value;
    } else if (fileExtension === '.pdf') {
      const data = await pdf(file.buffer);
      content = data.text;
    } else {
      content = file.buffer.toString('utf8'); // Fallback for other text files
    }
    
    console.log(`✅ File processed successfully (${content.length} characters extracted)`);
    return content;
    
  } catch (fileError) {
    console.error('File processing error:', fileError);
    throw new Error(`Error processing file: ${fileError.message}`);
  }
}

// Fetch URL content
async function fetchURLContent(url) {
  try {
    console.log(`🔗 Fetching content from: ${url}`);
    
    // For now, return a simulated response
    // In production, you'd use a web scraping library like puppeteer or cheerio
    return `Course Information from ${url}:

Course Title: Professional Development Training
Provider: Training Institute
Duration: 40 hours
Delivery: Online/In-person hybrid
Content: Skills development, best practices, certification preparation
Cost: $2,500 per participant

This appears to be eligible training content suitable for ETG funding.`;
    
  } catch (error) {
    console.error('URL fetch error:', error);
    throw new Error(`Error fetching URL content: ${error.message}`);
  }
}

// Enhanced search knowledge base function
function searchKnowledgeBase(query, agent = 'grant-cards') {
  const results = [];
  const searchTerms = query.toLowerCase().split(' ');
  
  const docs = knowledgeBases[agent] || [];
  
  for (const doc of docs) {
    const content = doc.content.toLowerCase();
    const filename = doc.filename.toLowerCase();
    let relevanceScore = 0;
    
    for (const term of searchTerms) {
      // Search in content
      const contentMatches = (content.match(new RegExp(term, 'g')) || []).length;
      relevanceScore += contentMatches;
      
      // Search in filename (weighted higher)
      const filenameMatches = (filename.match(new RegExp(term, 'g')) || []).length;
      relevanceScore += filenameMatches * 3; // Filename matches are more important
    }
    
    if (relevanceScore > 0) {
      results.push({
        ...doc,
        relevanceScore
      });
    }
  }
  
  return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// Rate limiting helper functions
function checkRateLimit() {
  const now = Date.now();
  
  // Remove timestamps older than 1 minute
  callTimestamps = callTimestamps.filter(timestamp => now - timestamp < 60000);
  
  if (callTimestamps.length >= MAX_CALLS_PER_MINUTE) {
    throw new Error(`Rate limit exceeded: ${MAX_CALLS_PER_MINUTE} calls per minute maximum. Please wait before trying again.`);
  }
  
  return true;
}

async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastCall = now - lastAPICall;
  
  if (timeSinceLastCall < RATE_LIMIT_DELAY) {
    const waitTime = RATE_LIMIT_DELAY - timeSinceLastCall;
    console.log(`⏱️  Rate limiting: waiting ${waitTime}ms before API call`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

// Claude API integration
async function callClaudeAPI(messages, systemPrompt = '') {
  try {
    // Check rate limits first
    checkRateLimit();
    
    // Wait for rate limit if needed
    await waitForRateLimit();
    
    console.log(`🔥 Making Claude API call (${callTimestamps.length + 1}/${MAX_CALLS_PER_MINUTE} this minute)`);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        system: systemPrompt,
        messages: messages
      })
    });

    // Update rate limiting tracking
    lastAPICall = Date.now();
    callTimestamps.push(lastAPICall);
    apiCallCount++;

    if (!response.ok) {
      const errorText = await response.text();
      
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded. Please wait a few minutes before trying again. Current usage: ${callTimestamps.length} calls in the last minute.`);
      }
      
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ API call successful (Total calls this session: ${apiCallCount})`);
    return data.content[0].text;
    
  } catch (error) {
    console.error('Claude API Error:', error);
    
    if (error.message.includes('Rate limit')) {
      throw new Error(`${error.message}\n\nTip: Wait 2-3 minutes between requests, or try smaller documents.`);
    }
    
    throw new Error('Failed to get response from Claude API: ' + error.message);
  }
}

// Main serverless handler with authentication
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Cookie');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url, method } = req;

  // Apply authentication middleware (except for login and health endpoints)
  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch (authError) {
    return; // Authentication middleware has already handled the response
  }

  // Load knowledge base
  await getKnowledgeBase();
  
  try {
    // Login endpoint
    if (url === '/api/login' && method === 'POST') {
      try {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          const { password } = JSON.parse(body);
          
          // Check password
          if (!TEAM_PASSWORD) {
            res.status(500).json({ 
              success: false, 
              message: 'Authentication not configured' 
            });
            return;
          }

          if (password === TEAM_PASSWORD) {
            // Create session
            const sessionToken = generateSessionToken();
            const expires = Date.now() + SESSION_DURATION;
            
            activeSessions.set(sessionToken, {
              expires,
              loginTime: Date.now()
            });

            // Set secure cookie
            res.setHeader('Set-Cookie', [
              `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION/1000}; Path=/`
            ]);

            res.json({ 
              success: true, 
              message: 'Authentication successful' 
            });
          } else {
            res.status(401).json({ 
              success: false, 
              message: 'Invalid password' 
            });
          }
        });

      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
          success: false, 
          message: 'Server error during authentication' 
        });
      }
      return;
    }

    // Logout endpoint
    if (url === '/api/logout' && method === 'POST') {
      const sessionToken = req.headers.cookie?.split(';')
        .find(cookie => cookie.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
        ?.split('=')[1];

      if (sessionToken) {
        activeSessions.delete(sessionToken);
      }

      res.setHeader('Set-Cookie', [
        `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`
      ]);

      res.json({ success: true, message: 'Logged out successfully' });
      return;
    }

    // Health check endpoint
    if (url === '/api/health') {
      const totalDocs = Object.values(knowledgeBases).reduce((sum, docs) => sum + docs.length, 0);
      res.json({ 
        status: 'healthy',
        knowledgeBaseSize: totalDocs,
        knowledgeBaseSource: 'google-drive-service-account',
        googleDriveConfigured: !!(GOOGLE_DRIVE_FOLDER_ID && GOOGLE_SERVICE_ACCOUNT_KEY),
        apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
        apiCallsThisSession: apiCallCount,
        callsLastMinute: callTimestamps.length,
        rateLimitDelay: RATE_LIMIT_DELAY,
        authenticationEnabled: !!TEAM_PASSWORD,
        activeSessions: activeSessions.size
      });
      return;
    }

    // Refresh knowledge base endpoint
    if (url === '/api/refresh-knowledge-base') {
      try {
        if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
          res.status(500).json({ error: 'Google Drive not configured' });
          return;
        }
        
        knowledgeBaseLoaded = false; // Force refresh
        await getKnowledgeBase();
        const totalDocs = Object.values(knowledgeBases).reduce((sum, docs) => sum + docs.length, 0);
        
        res.json({ 
          message: 'Knowledge base refreshed successfully',
          totalDocuments: totalDocs,
          agents: Object.keys(knowledgeBases).filter(agent => knowledgeBases[agent].length > 0),
          lastUpdated: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to refresh knowledge base: ' + error.message });
      }
      return;
    }

    // Process grant document (for Grant Card Assistant)
    if (url === '/api/process-grant' && method === 'POST') {
      // Handle file upload with multer
      await new Promise((resolve, reject) => {
        upload.single('file')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, task, conversationId } = req.body;
      let fileContent = '';
      
      // Process uploaded file if present
      if (req.file) {
        fileContent = await processFileContent(req.file);
      }
      
      // Get or create conversation
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, []);
      }
      const conversation = conversations.get(conversationId);
      
      // Search knowledge base for task-specific information (grant-cards agent)
      const relevantKnowledge = searchKnowledgeBase(task, 'grant-cards');
      let knowledgeContext = '';
      
      if (relevantKnowledge.length > 0) {
        knowledgeContext = relevantKnowledge
          .slice(0, 3) // Top 3 most relevant documents
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Using ${relevantKnowledge.length} grant-cards knowledge base documents for context`);
      }
      
      // Check if this is a Grant Card task (uses shared persona) or other agent
      const isGrantCardTask = ['grant-criteria', 'preview', 'requirements', 'insights', 'categories', 'missing-info'].includes(task);

      let systemPrompt;
      if (isGrantCardTask) {
        // Use the shared persona + task methodology builder
        systemPrompt = buildGrantCardSystemPrompt(task, knowledgeContext);
      } else {
        // Use the individual agent prompt (ETG, etc.)
        systemPrompt = `${agentPrompts[task] || agentPrompts['etg-writer']}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.`;
      }
      
      // Add user message to conversation
      let userMessage = message;
      if (fileContent) {
        userMessage += `\n\nUploaded document content:\n${fileContent}`;
      }
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude with rate limiting
      const response = await callClaudeAPI(conversation, systemPrompt);
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: response });
      
      // Keep conversation history manageable (last 20 messages)
      if (conversation.length > 20) {
        conversation.splice(0, conversation.length - 20);
      }
      
      res.json({ 
        response: response,
        conversationId: conversationId 
      });
      return;
    }

    // Process ETG requests (dedicated endpoint for ETG Writer)
    if (url === '/api/process-etg' && method === 'POST') {
      await new Promise((resolve, reject) => {
        upload.single('file')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId, url: courseUrl } = req.body;
      let fileContent = '';
      let urlContent = '';
      
      console.log(`🎯 Processing ETG request for conversation: ${conversationId}`);
      
      // Process uploaded file if present
      if (req.file) {
        console.log(`📄 Processing ETG document: ${req.file.originalname}`);
        fileContent = await processFileContent(req.file);
      }
      
      // Process URL if present
      if (courseUrl) {
        console.log(`🔗 Processing ETG URL: ${courseUrl}`);
        urlContent = await fetchURLContent(courseUrl);
      }
      
      // Get or create ETG conversation
      const etgConversationId = `etg-${conversationId}`;
      if (!conversations.has(etgConversationId)) {
        conversations.set(etgConversationId, []);
      }
      const conversation = conversations.get(etgConversationId);
      
      // Search knowledge base for ETG-specific information
      const relevantKnowledge = searchKnowledgeBase('etg business case training grant', 'etg');
      let knowledgeContext = '';
      
      if (relevantKnowledge.length > 0) {
        knowledgeContext = relevantKnowledge
          .slice(0, 5) // Top 5 most relevant documents for ETG
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Using ${relevantKnowledge.length} ETG knowledge base documents`);
      }
      
      // Build ETG system prompt with knowledge context
      const systemPrompt = `${agentPrompts['etg-writer']}

ETG KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Use the ETG knowledge base above to find similar successful applications and match their style and structure.`;
      
      // Build comprehensive user message
      let userMessage = message || "Hello, I need help with an ETG Business Case.";
      
      if (fileContent) {
        userMessage += `\n\nUploaded Course Document Analysis:\n${fileContent}`;
      }
      
      if (urlContent) {
        userMessage += `\n\nCourse URL Content Analysis:\n${urlContent}`;
      }
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude using ETG specialist prompt
      console.log(`🤖 Calling Claude API for ETG specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt);
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: response });
      
      // Keep ETG conversation history manageable (last 15 messages for more context)
      if (conversation.length > 15) {
        conversation.splice(0, conversation.length - 15);
      }
      
      console.log(`✅ ETG response generated successfully`);
      
      res.json({ 
        response: response,
        conversationId: etgConversationId 
      });
      return;
    }

    // Process BCAFE requests (dedicated endpoint for BC Agriculture Export Program)
    if (url === '/api/process-bcafe' && method === 'POST') {
      await new Promise((resolve, reject) => {
        upload.single('file')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId, orgType, selectedMarkets } = req.body;
      let fileContent = '';
      
      console.log(`🌾 Processing BCAFE request for conversation: ${conversationId}`);
      console.log(`📊 Organization type: ${orgType}, Target markets: ${selectedMarkets}`);
      
      // Process uploaded file if present
      if (req.file) {
        console.log(`📄 Processing BCAFE document: ${req.file.originalname}`);
        fileContent = await processFileContent(req.file);
      }
      
      // Get or create BCAFE conversation
      const bcafeConversationId = `bcafe-${conversationId}`;
      if (!conversations.has(bcafeConversationId)) {
        conversations.set(bcafeConversationId, []);
      }
      const conversation = conversations.get(bcafeConversationId);
      
      // Search knowledge base for BCAFE-specific information
      const relevantKnowledge = searchKnowledgeBase('bcafe agriculture export program application', 'bcafe');
      let knowledgeContext = '';
      
      if (relevantKnowledge.length > 0) {
        knowledgeContext = relevantKnowledge
          .slice(0, 5) // Top 5 most relevant documents for BCAFE
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Using ${relevantKnowledge.length} BCAFE knowledge base documents`);
      }
      
      // Build BCAFE system prompt with knowledge context
      const systemPrompt = `${agentPrompts['bcafe-writer']}

BCAFE KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

CURRENT SESSION CONTEXT:
- Organization Type: ${orgType || 'Not specified'}
- Selected Target Markets: ${selectedMarkets || 'Not specified'}
- Application Deadline: September 5, 2025 (4:00 PM PDT)
- Project Period: November 17, 2025 - March 1, 2026

Use the BCAFE knowledge base above to ensure complete compliance with Summer 2025 program requirements and optimize for merit-based evaluation criteria.`;
      
      // Build comprehensive user message
      let userMessage = message || "Hello, I need help with a BCAFE application.";
      
      // Add context information
      if (orgType) {
        userMessage += `\n\nOrganization Type: ${orgType}`;
      }
      
      if (selectedMarkets) {
        userMessage += `\n\nTarget Export Markets: ${selectedMarkets}`;
      }
      
      if (fileContent) {
        userMessage += `\n\nUploaded Business Document Analysis:\n${fileContent}`;
      }
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude using BCAFE specialist prompt
      console.log(`🤖 Calling Claude API for BCAFE specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt);
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: response });
      
      // Keep BCAFE conversation history manageable (last 15 messages for context)
      if (conversation.length > 15) {
        conversation.splice(0, conversation.length - 15);
      }
      
      console.log(`✅ BCAFE response generated successfully`);
      
      res.json({ 
        response: response,
        conversationId: bcafeConversationId 
      });
      return;
    }
    
    // Get conversation history
    if (url.startsWith('/api/conversation/') && method === 'GET') {
      const conversationId = url.split('/api/conversation/')[1];
      const conversation = conversations.get(conversationId) || [];
      res.json({ messages: conversation });
      return;
    }

    // Clear conversation
    if (url.startsWith('/api/conversation/') && method === 'DELETE') {
      const conversationId = url.split('/api/conversation/')[1];
      conversations.delete(conversationId);
      res.json({ message: 'Conversation cleared' });
      return;
    }

    // Rate limit status endpoint
    if (url === '/api/rate-limit-status') {
      const now = Date.now();
      const recentCalls = callTimestamps.filter(timestamp => now - timestamp < 60000);
      
      res.json({
        callsInLastMinute: recentCalls.length,
        maxCallsPerMinute: MAX_CALLS_PER_MINUTE,
        remainingCalls: Math.max(0, MAX_CALLS_PER_MINUTE - recentCalls.length),
        nextCallAllowedIn: Math.max(0, RATE_LIMIT_DELAY - (now - lastAPICall)),
        totalCallsThisSession: apiCallCount
      });
      return;
    }

    // Default 404 for unmatched routes
    res.status(404).json({ error: 'API endpoint not found' });

  } catch (error) {
    console.error('API error:', error);
    
    // Send user-friendly error messages
    let errorMessage = error.message;
    if (error.message.includes('Rate limit')) {
      errorMessage = `${error.message}\n\nPlease wait a few minutes before making another request.`;
    }
    
    res.status(500).json({ error: errorMessage });
  }
};
