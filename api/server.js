// api/server.js - Complete serverless function with JWT Authentication, Context Management, and Enhanced ETG Agent
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const path = require('path');
const crypto = require('crypto');

// Authentication configuration with JWT
const TEAM_PASSWORD = process.env.TEAM_PASSWORD;
const SESSION_COOKIE_NAME = 'granted_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const JWT_SECRET = process.env.JWT_SECRET || 'granted-consulting-jwt-secret-2025-change-in-production';

// Optimized conversation limits
const CONVERSATION_LIMITS = {
  'grant-cards': 20,        // Task-based workflows (keep current)
  'etg-writer': 20,         // Business case development (keep current)  
  'bcafe-writer': 60        // Complex multi-day applications (6x increase)
};

// Context monitoring thresholds
const CONTEXT_WARNING_THRESHOLD = 150000;  // 75% of 200K limit
const CONTEXT_HARD_LIMIT = 180000;         // 90% of 200K limit (emergency brake)
const CONTEXT_ABSOLUTE_LIMIT = 200000;     // Claude's actual limit

// Token estimation constants
const TOKENS_PER_EXCHANGE = 950;           // Average user + assistant pair
const TOKENS_PER_CHAR = 0.25;             // Rough token-to-character ratio

// PERFORMANCE OPTIMIZATIONS
const RATE_LIMIT_DELAY = 500; // Reduced from 3000ms
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache
const MAX_CALLS_PER_MINUTE = 30; // Increased from 15
// Response caching system
const responseCache = new Map();
const RESPONSE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
// SAFETY CONFIGURATION FOR KNOWLEDGE BASE
const SAFETY_CONFIG = {
  alwayssFallbackToFullKB: ['eligibility', 'compliance', 'requirements'],
  maxTruncateLength: 10000,
  criticalDocumentCheck: true,
  warnOnMissingDocs: true,
  maxContextUtilization: 0.8,
  criticalDocMaxSize: 50000
};
// CRITICAL DOCUMENTS REGISTRY
const CRITICAL_DOCUMENTS = {
  'etg': {
    eligibility: [
      'eligibility',
      'ineligible',
      'requirements'
    ],
    businessCase: [
      'business-case',
      'questions',
      'successful'
    ]
  },
  'grant-cards': {
    'grant-criteria': ['grant-criteria-formatter', 'grant_criteria_formatter'],
    'preview': ['preview-section-generator', 'preview_section_generator'],
    'requirements': ['general-requirements-creator', 'general_requirements_creator'],
    'insights': ['granted-insights-generator', 'granted_insights_generator'],
    'categories': ['categories-tags-classifier', 'categories_tags_classifier'],
    'missing-info': ['missing-info-generator', 'missing_info_generator']
  },
  'bcafe': {
    eligibility: ['eligibility-checklist'],
    merit: ['merit-criteria-guide'],
    budget: ['budget-template-guide'],
    application: ['application-questions']
  }
};
// AGENT CONFIGURATION
const AGENT_CONFIG = {
  'etg-writer': {
    alwaysLoadForKeywords: ['eligib', 'seminar', 'conference', 'coaching', 'training', 'course'],
    criticalDocs: ['eligibility', 'ineligible'],
    skipKBForSimple: true
  },
  'grant-cards': {
    alwaysLoadForKeywords: ['criteria', 'format', 'template', 'grant'],
    criticalDocs: ['formatter', 'generator', 'creator'],
    skipKBForSimple: false // Grant cards always needs templates
  },
  'bcafe-writer': {
    alwaysLoadForKeywords: ['merit', 'score', 'eligib', 'budget'],
    criticalDocs: ['checklist', 'merit-criteria', 'budget-template'],
    skipKBForSimple: true
  }
};
// Performance tracking
const performanceMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  kbLoadsFull: 0,
  kbLoadsPartial: 0,
  kbSkipped: 0,
  avgResponseTime: 0,
  totalRequests: 0
};

// Cache management functions
function checkResponseCache(key) {
  if (responseCache.has(key)) {
    const cached = responseCache.get(key);
    if (Date.now() - cached.time < RESPONSE_CACHE_TTL) {
      performanceMetrics.cacheHits++;
      console.log('🎯 Cache hit!');
      return cached.data;
    }
  }
  performanceMetrics.cacheMisses++;
  return null;
}

function cacheResponse(key, data) {
  responseCache.set(key, {
    data: data,
    time: Date.now()
  });
  
  // Clean old cache entries if too many
  if (responseCache.size > 100) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}

// Generate JWT token
function generateJWTToken() {
  const payload = {
    authenticated: true,
    loginTime: Date.now(),
    expires: Date.now() + SESSION_DURATION
  };
  
  // Simple JWT implementation for serverless
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const signData = `${headerBase64}.${payloadBase64}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signData).digest('base64url');
  
  return `${headerBase64}.${payloadBase64}.${signature}`;
}

// Check if request is authenticated with JWT
function isAuthenticated(req) {
  const sessionToken = req.headers.cookie?.split(';')
    .find(cookie => cookie.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.split('=')[1];

  if (!sessionToken) return false;

  try {
    // Verify JWT token
    const [headerBase64, payloadBase64, signature] = sessionToken.split('.');
    
    if (!headerBase64 || !payloadBase64 || !signature) return false;
    
    // Verify signature
    const signData = `${headerBase64}.${payloadBase64}`;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(signData).digest('base64url');
    
    if (signature !== expectedSignature) return false;
    
    // Check expiration
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());
    if (Date.now() > payload.expires) return false;
    
    return true;
  } catch (error) {
    console.error('JWT verification error:', error);
    return false;
  }
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

// Estimate total context size for a request
function estimateContextSize(conversation, knowledgeContext, systemPrompt, currentMessage = '') {
  const convTokens = conversation.length * (TOKENS_PER_EXCHANGE / 2); // Only count existing messages
  const kbTokens = knowledgeContext.length * TOKENS_PER_CHAR;
  const sysTokens = systemPrompt.length * TOKENS_PER_CHAR;
  const msgTokens = currentMessage.length * TOKENS_PER_CHAR;
  const responseBuffer = 4000; // Reserve space for Claude's response
  
  return Math.ceil(convTokens + kbTokens + sysTokens + msgTokens + responseBuffer);
}

// Get agent type from endpoint or conversation ID
function getAgentType(url, conversationId) {
  if (url.includes('/api/process-grant')) return 'grant-cards';
  if (url.includes('/api/process-etg')) return 'etg-writer';
  if (url.includes('/api/process-bcafe')) return 'bcafe-writer';
  
  // Fallback: extract from conversation ID
  if (conversationId.includes('etg')) return 'etg-writer';
  if (conversationId.includes('bcafe')) return 'bcafe-writer';
  return 'grant-cards';
}

// Smart conversation pruning with context awareness
function pruneConversation(conversation, agentType, estimatedContextSize) {
  const limit = CONVERSATION_LIMITS[agentType] || 20;
  
  // Standard pruning if over limit
  if (conversation.length > limit * 2) { // *2 because each exchange = 2 messages
    const messagesToKeep = limit * 2;
    const removed = conversation.length - messagesToKeep;
    conversation.splice(0, removed);
    console.log(`🗂️ Standard pruning: Removed ${removed} messages, keeping last ${messagesToKeep}`);
  }
  
  // Emergency pruning if context too large
  if (estimatedContextSize > CONTEXT_HARD_LIMIT && conversation.length > 20) {
    const emergencyLimit = Math.max(20, Math.floor((CONTEXT_HARD_LIMIT - 50000) / (TOKENS_PER_EXCHANGE / 2)));
    if (conversation.length > emergencyLimit) {
      const removed = conversation.length - emergencyLimit;
      conversation.splice(0, removed);
      console.log(`🚨 Emergency pruning: Context too large, removed ${removed} messages`);
    }
  }
  
  return conversation.length;
}

// Context monitoring and logging
function logContextUsage(agentType, estimatedTokens, conversationLength) {
  const utilization = (estimatedTokens / CONTEXT_ABSOLUTE_LIMIT * 100).toFixed(1);
  const exchangeCount = Math.floor(conversationLength / 2);
  
  console.log(`📊 Context Usage - ${agentType.toUpperCase()}:`);
  console.log(`   Estimated tokens: ${estimatedTokens.toLocaleString()} (${utilization}%)`);
  console.log(`   Conversation: ${exchangeCount} exchanges (limit: ${CONVERSATION_LIMITS[agentType]})`);
  
  if (estimatedTokens > CONTEXT_WARNING_THRESHOLD) {
    console.log(`⚠️ High context usage warning!`);
  }
  
  if (estimatedTokens > CONTEXT_HARD_LIMIT) {
    console.log(`🚨 Context approaching limit - emergency measures may activate`);
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
let apiCallCount = 0;
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

// ETG Eligibility Checker Function
function checkETGEligibility(trainingData) {
    const { training_title = '', training_type = '', training_content = '', training_duration = '' } = trainingData;
    
    // Convert to lowercase for checking
    const title = training_title.toLowerCase();
    const type = training_type.toLowerCase();
    const content = training_content.toLowerCase();
    
    // Ineligible keywords/types
    const ineligibleKeywords = [
        'seminar', 'conference', 'coaching', 'consulting', 'mentorship',
        'trade show', 'networking', 'annual meeting', 'practicum',
        'diploma', 'degree', 'bachelor', 'master', 'phd'
    ];
    
    // Check for ineligible keywords
    const foundIneligible = ineligibleKeywords.find(keyword => 
        title.includes(keyword) || type.includes(keyword) || content.includes(keyword)
    );
    
    if (foundIneligible) {
        return {
            eligible: false,
            reason: `Training type contains ineligible keyword: "${foundIneligible}". ETG does not fund ${foundIneligible}s.`,
            confidence: 'high',
            ineligible_type: foundIneligible
        };
    }
    
    // Check for positive indicators
    const eligibleIndicators = [
        'certification', 'certificate', 'course', 'training program', 
        'workshop', 'skills development', 'professional development'
    ];
    
    const foundEligible = eligibleIndicators.find(indicator =>
        title.includes(indicator) || type.includes(indicator) || content.includes(indicator)
    );
    
    // Check duration (substantial training is preferred)
    const hasDuration = training_duration && (
        training_duration.includes('hour') || 
        training_duration.includes('day') || 
        training_duration.includes('week')
    );
    
    const strengths = [];
    if (foundEligible) strengths.push(`${foundEligible} format`);
    if (hasDuration) strengths.push('substantial duration');
    if (content.length > 50) strengths.push('comprehensive curriculum');
    
    return {
        eligible: true,
        reason: `Training appears to meet ETG requirements - no ineligible keywords found`,
        confidence: foundEligible ? 'high' : 'medium',
        strengths: strengths,
        notes: foundEligible ? 'Strong ETG candidate - meets eligibility criteria' : 'Review recommended'
    };
}

// Extract training information from text
function extractTrainingInfo(text) {
    const lines = text.split('\n');
    let trainingInfo = {};
    
    // Look for training details in various formats
    lines.forEach(line => {
        const lower = line.toLowerCase();
        if (lower.includes('training title:') || lower.includes('course title:')) {
            trainingInfo.training_title = line.split(':')[1]?.trim() || '';
        }
        if (lower.includes('training type:') || lower.includes('course type:')) {
            trainingInfo.training_type = line.split(':')[1]?.trim() || '';
        }
        if (lower.includes('provider:')) {
            trainingInfo.training_provider = line.split(':')[1]?.trim() || '';
        }
        if (lower.includes('content:') || lower.includes('description:')) {
            trainingInfo.training_content = line.split(':')[1]?.trim() || '';
        }
        if (lower.includes('duration:') || lower.includes('length:')) {
            trainingInfo.training_duration = line.split(':')[1]?.trim() || '';
        }
    });
    
    // Fallback: extract from general text
    if (!trainingInfo.training_title) {
        const titleMatch = text.match(/(?:training|course|program).*?(?:title|name)[:\s]+([^.\n]+)/i);
        if (titleMatch) trainingInfo.training_title = titleMatch[1].trim();
    }
    
    return trainingInfo;
}

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

// ENHANCED AGENT PROMPTS
const agentPrompts = {
  'etg-writer': `You are an ETG Business Case specialist for British Columbia's Employee Training Grant program. You provide flexible consultation on ETG matters and can write complete, submission-ready business cases.

YOUR IDENTITY AS ETG SPECIALIST:
You ARE the ETG Business Case specialist with complete ETG expertise. You take full ownership of business case development while also serving as a knowledgeable consultant for any ETG-related questions.

CORE CAPABILITIES:
- Answer questions about ETG requirements, eligibility, and processes
- Research and discuss previous successful applications from your knowledge base
- Help users identify and research eligible training courses
- Write complete, submission-ready ETG business cases following the structured workflow

COMMUNICATION STYLE:
- Speak with authority and confidence as the specialist
- Provide flexible, conversational responses for general ETG questions
- Switch to structured workflow mode when business case development begins
- Take ownership of all research and analysis tasks
- Present solutions and definitive guidance

FLEXIBLE CONSULTATION MODE:
When users ask general ETG questions, provide comprehensive answers using your knowledge base.

BUSINESS CASE DEVELOPMENT WORKFLOW:
When a user uploads training information or requests business case development, follow this structured process:

1. **ELIGIBILITY VERIFICATION**
   - State: "Let me verify this training's eligibility for ETG funding..."
   - Check against ineligible course types (seminars, conferences, coaching, consulting, trade shows, networking events, degree programs)
   - If ineligible: Stop, explain why, suggest alternatives
   - If eligible: Confirm and proceed to step 2

2. **COMPANY & PARTICIPANT INFORMATION GATHERING**
   - Ask targeted questions about the applying company and training participants
   - Gather background information needed to inform responses to each business case question
   - Examples: company size, industry, business challenges, participant roles, expected outcomes

3. **DRAFT QUESTIONS 1-3**
   - Use gathered information to populate professional responses for Questions 1-3
   - Present completed Questions 1-3 to user for review
   - Ask: "Please review Questions 1-3. Are you satisfied with the content, or would you like adjustments?"

4. **TRAINING SELECTION INQUIRY**
   - Ask the user specific questions about why they chose this particular training
   - Understand their decision-making criteria and preferences
   - Gather information needed for competitive analysis in Questions 4-7

5. **BC ALTERNATIVES RESEARCH**
   - Search for current BC-based training alternatives
   - Present findings: "I found these BC alternatives:" [list providers with details]
   - Use this research to inform competitive analysis

6. **DRAFT QUESTIONS 4-7**
   - Use BC alternatives research and user's training selection reasoning
   - Populate professional responses for Questions 4-7 with competitive analysis
   - Present complete ETG business case for final review

CRITICAL ELIGIBILITY SCREENING:
Before any business case development, verify training eligibility:

KEY INELIGIBLE TRAINING TYPES:
- SEMINARS (any training called "seminar" is ineligible)
- Consulting, Coaching, Mentorships
- Trade shows, Annual meetings, Networking, Conferences
- Paid practicums, Diploma/degree programs

Always maintain your authoritative ETG specialist persona while providing flexible, helpful responses to any ETG-related inquiry.`,

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

  'bcafe-writer': `You are a BC Agriculture and Food Export Program (BCAFE) specialist for Summer 2025 applications.

CORE IDENTITY:
I AM the BCAFE application expert who takes full ownership of creating submission-ready applications that meet all compliance requirements and maximize merit scoring potential.

MANDATORY WORKFLOW:
1. **ELIGIBILITY VERIFICATION** - Use "bcafe-eligibility-checklist" to verify all requirements before proceeding
2. **FUNDING CALCULATION** - Apply formulas from eligibility document to determine maximum eligible amount  
3. **MERIT OPTIMIZATION** - Follow "bcafe-merit-criteria-guide" strategies for competitive positioning
4. **APPLICATION CONSTRUCTION** - Use "bcafe-application-questions" template and successful examples
5. **BUDGET DEVELOPMENT** - Apply "bcafe-budget-template-guide" for compliant budget creation

PROGRAM ESSENTIALS:
- Application deadline: September 5, 2025 (4:00 PM PDT)
- Project period: November 17, 2025 - March 1, 2026  
- Merit evaluation: 5 criteria with Budget/Timeline weighted highest (30%)
- Cash match required: 50% (producers/processors/cooperatives), 30% (associations)

KNOWLEDGE BASE INTEGRATION:
Use the provided BCAFE knowledge base documents for all detailed guidance:
- Eligibility verification process and requirements
- Merit optimization strategies for each evaluation criterion
- Budget template requirements and compliance rules
- Application question structure and best practices
- Successful application examples and patterns

COMMUNICATION APPROACH:
- Take definitive ownership of application development
- Provide expert guidance based on knowledge base documents
- Reference specific successful examples when relevant
- Deliver submission-ready applications requiring minimal user revision
- Always verify eligibility first, then proceed with strategic application development

Follow the detailed processes outlined in the knowledge base documents rather than attempting to recreate them.`
};

// INTELLIGENT GRANT CARD DOCUMENT SELECTION FUNCTION
function selectGrantCardDocuments(task, message, fileContent, conversationHistory) {
  const docs = knowledgeBases['grant-cards'] || [];
  const msg = message.toLowerCase();
  const selectedDocs = [];
  
  // Determine what the user needs based on task and message content
  const needsFormatter = task === 'grant-criteria' || msg.includes('criteria') || msg.includes('format');
  const needsPreview = task === 'preview' || msg.includes('preview') || msg.includes('description');
  const needsRequirements = task === 'requirements' || msg.includes('requirements') || msg.includes('general');
  const needsInsights = task === 'insights' || msg.includes('insights') || msg.includes('strategy');
  const needsCategories = task === 'categories' || msg.includes('categories') || msg.includes('tags');
  const needsMissing = task === 'missing-info' || msg.includes('missing') || msg.includes('gaps');
  
  // Large file uploaded - reduce knowledge base to save context
  const isLargeFile = fileContent && fileContent.length > 50000;
  const maxDocs = isLargeFile ? 1 : 3;
  
  // Select task-specific documents (with underscores and hyphens)
  if (needsFormatter) {
    const formatterDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('grant_criteria_formatter') ||
      doc.filename.toLowerCase().includes('grant-criteria-formatter')
    );
    if (formatterDoc) selectedDocs.push(formatterDoc);
  }
  
  if (needsPreview) {
    const previewDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('preview_section_generator') ||
      doc.filename.toLowerCase().includes('preview-section-generator')
    );
    if (previewDoc) selectedDocs.push(previewDoc);
  }
  
  if (needsRequirements) {
    const reqDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('general_requirements_creator') ||
      doc.filename.toLowerCase().includes('general-requirements-creator')
    );
    if (reqDoc) selectedDocs.push(reqDoc);
  }
  
  if (needsInsights) {
    const insightsDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('granted_insights_generator') ||
      doc.filename.toLowerCase().includes('granted-insights-generator')
    );
    if (insightsDoc) selectedDocs.push(insightsDoc);
  }
  
  if (needsCategories) {
    const categoriesDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('categories_tags_classifier') ||
      doc.filename.toLowerCase().includes('categories-tags-classifier')
    );
    if (categoriesDoc) selectedDocs.push(categoriesDoc);
  }
  
  if (needsMissing) {
    const missingDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('missing_info_generator') ||
      doc.filename.toLowerCase().includes('missing-info-generator')
    );
    if (missingDoc) selectedDocs.push(missingDoc);
  }
  
  // Default fallback - include grant criteria formatter
  if (selectedDocs.length === 0) {
    const formatterDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('grant_criteria_formatter') ||
      doc.filename.toLowerCase().includes('grant-criteria-formatter') ||
      doc.filename.toLowerCase().includes('formatter')
    );
    if (formatterDoc) selectedDocs.push(formatterDoc);
  }
  
  // Remove duplicates and limit based on file size
  const uniqueDocs = [...new Map(selectedDocs.map(doc => [doc.filename, doc])).values()];
  return uniqueDocs.slice(0, maxDocs);
}

// INTELLIGENT BCAFE DOCUMENT SELECTION FUNCTION
function selectBCAFEDocuments(message, orgType, conversationHistory) {
  const docs = knowledgeBases['bcafe'] || [];
  const msg = message.toLowerCase();
  const selectedDocs = [];
  
  // Determine what the user needs and select appropriate documents
  const needsEligibility = msg.includes('eligible') || msg.includes('qualify') || 
                          conversationHistory.length <= 2 || msg.includes('requirements');
  
  const needsApplication = msg.includes('application') || msg.includes('create') || 
                          msg.includes('write') || msg.includes('build');
  
  const needsBudget = msg.includes('budget') || msg.includes('cost') || 
                     msg.includes('quote') || msg.includes('funding');
  
  const needsMerit = msg.includes('merit') || msg.includes('optimize') || 
                    msg.includes('scoring') || msg.includes('competitive');
  
  const needsExamples = msg.includes('example') || msg.includes('similar') || 
                       msg.includes('successful') || msg.includes('fine choice');

  // Select core documents based on needs
  if (needsEligibility) {
    const eligibilityDoc = docs.find(doc => doc.filename.includes('eligibility-checklist'));
    if (eligibilityDoc) selectedDocs.push(eligibilityDoc);
  }
  
  if (needsMerit) {
    const meritDoc = docs.find(doc => doc.filename.includes('merit-criteria-guide'));
    if (meritDoc) selectedDocs.push(meritDoc);
  }
  
  if (needsBudget) {
    const budgetDoc = docs.find(doc => doc.filename.includes('budget-template-guide'));
    if (budgetDoc) selectedDocs.push(budgetDoc);
  }
  
  if (needsApplication) {
    const appDoc = docs.find(doc => doc.filename.includes('application-questions'));
    if (appDoc) selectedDocs.push(appDoc);
  }
  
  if (needsExamples) {
    const exampleDocs = docs.filter(doc => 
      doc.filename.includes('successful') || 
      doc.filename.includes('fine-choice') ||
      doc.filename.includes('example')
    );
    selectedDocs.push(...exampleDocs.slice(0, 1)); // Add 1 example max
  }
  
  // Default fallback - include eligibility and one guide
  if (selectedDocs.length === 0) {
    const eligibilityDoc = docs.find(doc => doc.filename.includes('eligibility-checklist'));
    const meritDoc = docs.find(doc => doc.filename.includes('merit-criteria-guide'));
    if (eligibilityDoc) selectedDocs.push(eligibilityDoc);
    if (meritDoc) selectedDocs.push(meritDoc);
  }
  
  // Remove duplicates and limit to 3 documents max
  const uniqueDocs = [...new Map(selectedDocs.map(doc => [doc.filename, doc])).values()];
  return uniqueDocs.slice(0, 3);
}

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
    console.log(`⏱️ Rate limiting: waiting ${waitTime}ms before API call`);
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

// Universal smart processing function with all safety features
async function processRequestWithSmartKnowledge(agentType, message, conversationId, fileContent = '', additionalContext = {}) {
  const startTime = Date.now();
  const fullConversationId = `${agentType}-${conversationId}`;
  
  // Check cache first
  const cacheKey = `${agentType}-${message.toLowerCase().substring(0, 100)}-${fileContent.length}`;
  const cached = checkResponseCache(cacheKey);
  if (cached && !fileContent) { // Don't use cache for file uploads
    return cached;
  }
  
  // Get or create conversation
  if (!conversations.has(fullConversationId)) {
    conversations.set(fullConversationId, []);
  }
  const conversation = conversations.get(fullConversationId);
  
  // Check if we can skip knowledge base
  const canSkip = canSkipKnowledgeBase(agentType, message, fileContent);
  
  if (canSkip) {
    console.log(`💬 Pure greeting for ${agentType} - skipping knowledge base`);
    performanceMetrics.kbSkipped++;
    
    const systemPrompt = agentPrompts[agentType] || agentPrompts['etg-writer'];
    conversation.push({ role: 'user', content: message });
    
    const response = await callClaudeAPI(conversation.slice(-4), systemPrompt);
    conversation.push({ role: 'assistant', content: response });
    
    const result = {
      response: response,
      conversationId: fullConversationId,
      knowledgeUsed: false,
      processingTime: Date.now() - startTime
    };
    
    cacheResponse(cacheKey, result);
    return result;
  }
  
  // Determine request type for critical document loading
  const requestType = determineRequestType(agentType, message, fileContent, additionalContext);
  console.log(`📋 Request type identified: ${agentType}/${requestType}`);
  
  // Load critical documents
  let knowledgeContext = '';
  const requiredDocs = getRequiredDocuments(agentType, requestType);
  
  if (requiredDocs.length > 0) {
    console.log(`🎯 Loading ${requiredDocs.length} CRITICAL documents`);
    knowledgeContext = await loadCriticalDocuments(agentType, requiredDocs);
    performanceMetrics.kbLoadsFull++;
  }
  
  // Add additional searched documents if needed
  if (requestType !== 'simple' && knowledgeContext.length < 5000) {
    const additionalDocs = await searchForAdditionalContext(agentType, message, requiredDocs);
    knowledgeContext += additionalDocs;
  }
  
  // Check context size and warn if necessary
  const estimatedTokens = estimateContextSize(conversation, knowledgeContext, '', message);
  if (estimatedTokens > CONTEXT_WARNING_THRESHOLD) {
    console.log(`⚠️ High context usage: ${estimatedTokens} tokens`);
    // Trim knowledge context if needed
    if (knowledgeContext.length > 20000) {
      knowledgeContext = knowledgeContext.substring(0, 20000) + '\n\n[Knowledge truncated due to context limits]';
    }
  }
  
  // Build system prompt
  let systemPrompt;
  if (agentType === 'grant-cards') {
    const task = additionalContext.task || 'grant-criteria';
    systemPrompt = buildGrantCardSystemPrompt(task, knowledgeContext);
  } else {
    systemPrompt = `${agentPrompts[agentType] || ''}

${knowledgeContext ? `RELEVANT KNOWLEDGE:
${knowledgeContext}` : ''}`;
  }
  
  // Build user message
  let userMessage = message;
  if (fileContent) {
    userMessage += `\n\nUploaded document:\n${fileContent.substring(0, 10000)}`; // Limit file content
  }
  
  // Add additional context
  if (additionalContext.orgType) {
    userMessage += `\n\nOrganization Type: ${additionalContext.orgType}`;
  }
  if (additionalContext.selectedMarkets) {
    userMessage += `\n\nTarget Markets: ${additionalContext.selectedMarkets}`;
  }
  
  // Manage conversation length
  const maxConvLength = CONVERSATION_LIMITS[agentType] * 2 || 40;
  if (conversation.length > maxConvLength) {
    conversation.splice(0, conversation.length - maxConvLength);
  }
  
  conversation.push({ role: 'user', content: userMessage });
  
  // Call Claude
  const response = await callClaudeAPI(conversation, systemPrompt);
  conversation.push({ role: 'assistant', content: response });
  
  // Update metrics
  performanceMetrics.totalRequests++;
  const responseTime = Date.now() - startTime;
  performanceMetrics.avgResponseTime = 
    (performanceMetrics.avgResponseTime * (performanceMetrics.totalRequests - 1) + responseTime) / 
    performanceMetrics.totalRequests;
  
  const result = {
    response: response,
    conversationId: fullConversationId,
    knowledgeUsed: knowledgeContext.length > 0,
    processingTime: responseTime,
    contextSize: estimatedTokens
  };
  
  // Cache the response
  cacheResponse(cacheKey, result);
  
  return result;
}

// Helper function to check if we can skip knowledge base
function canSkipKnowledgeBase(agentType, message, fileContent) {
  // NEVER skip if file uploaded
  if (fileContent) return false;
  
  const config = AGENT_CONFIG[agentType];
  if (!config) return false;
  if (!config.skipKBForSimple) return false;
  
  // NEVER skip if critical keywords present
  const hasKeyword = config.alwaysLoadForKeywords.some(kw => 
    message.toLowerCase().includes(kw)
  );
  if (hasKeyword) return false;
  
  // Only skip for pure greetings
  const pureGreetings = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'good morning'];
  return pureGreetings.includes(message.toLowerCase().trim());
}

// Determine request type
function determineRequestType(agentType, message, fileContent, additionalContext) {
  const msgLower = message.toLowerCase();
  
  if (agentType === 'etg-writer' || agentType === 'etg') {
    if (msgLower.includes('eligib') || msgLower.includes('qualify') || 
        msgLower.includes('seminar') || msgLower.includes('conference') || 
        msgLower.includes('coaching') || fileContent) {
      return 'eligibility';
    }
    if (msgLower.includes('business case') || msgLower.includes('question')) {
      return 'businessCase';
    }
  }
  
  if (agentType === 'grant-cards') {
    return additionalContext.task || 'grant-criteria';
  }
  
  if (agentType === 'bcafe-writer' || agentType === 'bcafe') {
    if (msgLower.includes('eligib') || msgLower.includes('qualify')) {
      return 'eligibility';
    }
    if (msgLower.includes('merit') || msgLower.includes('score')) {
      return 'merit';
    }
    if (msgLower.includes('budget')) {
      return 'budget';
    }
    if (msgLower.includes('application')) {
      return 'application';
    }
  }
  
  return 'general';
}

// Get required documents
function getRequiredDocuments(agentType, requestType) {
  const agentFolder = getAgentFolder(agentType);
  const agentDocs = CRITICAL_DOCUMENTS[agentFolder];
  if (!agentDocs) return [];
  
  return agentDocs[requestType] || [];
}

// Load critical documents
async function loadCriticalDocuments(agentType, requiredDocNames) {
  if (!requiredDocNames || requiredDocNames.length === 0) {
    return '';
  }
  
  const agentFolder = getAgentFolder(agentType);
  const docs = knowledgeBases[agentFolder] || [];
  let content = '';
  const missingDocs = [];
  
  for (const reqDocName of requiredDocNames) {
    const doc = docs.find(d => 
      d.filename.toLowerCase().includes(reqDocName.toLowerCase())
    );
    
    if (doc) {
      console.log(`✅ Loaded: ${doc.filename}`);
      // Don't truncate critical documents
      content += `=== ${doc.filename} ===\n${doc.content}\n\n`;
    } else {
      console.log(`⚠️ Missing: ${reqDocName}`);
      missingDocs.push(reqDocName);
    }
  }
  
  // If critical docs missing, load ALL docs as fallback
  if (missingDocs.length > 0 && SAFETY_CONFIG.warnOnMissingDocs) {
    console.log(`⚠️ Missing ${missingDocs.length} critical docs, loading all as fallback`);
    const allDocs = docs.slice(0, 5); // Load up to 5 docs as fallback
    for (const doc of allDocs) {
      content += `=== ${doc.filename} ===\n${doc.content.substring(0, 10000)}\n\n`;
    }
  }
  
  return content;
}

// Search for additional context
async function searchForAdditionalContext(agentType, message, alreadyLoaded) {
  const searchQuery = buildSearchQuery(agentType, message);
  const agentFolder = getAgentFolder(agentType);
  const searchResults = searchKnowledgeBase(searchQuery, agentFolder);
  
  // Filter out already loaded docs
  const additionalDocs = searchResults.filter(doc => 
    !alreadyLoaded.some(loaded => 
      doc.filename.toLowerCase().includes(loaded.toLowerCase())
    )
  );
  
  if (additionalDocs.length > 0) {
    console.log(`📚 Adding ${Math.min(2, additionalDocs.length)} additional docs from search`);
    return additionalDocs
      .slice(0, 2)
      .map(doc => `=== ${doc.filename} (search result) ===\n${doc.content.substring(0, 5000)}`)
      .join('\n\n');
  }
  
  return '';
}

// Get agent folder mapping
function getAgentFolder(agentType) {
  const folderMap = {
    'etg-writer': 'etg',
    'grant-cards': 'grant-cards',
    'bcafe-writer': 'bcafe',
    'canexport-writer': 'canexport',
    'readiness-strategist': 'readiness-strategist',
    'internal-oracle': 'internal-oracle'
  };
  
  return folderMap[agentType] || agentType;
}

// Build search query helper (keep your existing implementation)
function buildSearchQuery(agentType, message) {
  // Your existing buildSearchQuery implementation
  const msgLower = message.toLowerCase();
  
  const searchMap = {
    'etg-writer': {
      'eligib': 'eligibility requirements ineligible',
      'business case': 'business case questions template',
      'question': 'questions template',
      'default': 'etg business case'
    },
    'grant-cards': {
      'criteria': 'grant criteria formatter',
      'preview': 'preview section generator',
      'requirement': 'general requirements creator',
      'insight': 'granted insights generator',
      'default': 'grant card'
    },
    'bcafe-writer': {
      'eligib': 'eligibility checklist',
      'merit': 'merit criteria guide',
      'budget': 'budget template',
      'application': 'application questions',
      'default': 'bcafe application'
    }
  };
  
  const agentSearches = searchMap[agentType] || {};
  
  for (const [key, value] of Object.entries(agentSearches)) {
    if (key !== 'default' && msgLower.includes(key)) {
      return value;
    }
  }
  
  return agentSearches.default || 'relevant information';
}

// Main serverless handler with JWT authentication and enhanced features
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
    // Login endpoint with JWT
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
            // Create JWT token
            const sessionToken = generateJWTToken();

            // Set secure cookie
            res.setHeader('Set-Cookie', [
              `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION/1000}; Path=/`
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
      // Just clear the cookie
      res.setHeader('Set-Cookie', [
        `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`
      ]);

      res.json({ success: true, message: 'Logged out successfully' });
      return;
    }

    // Enhanced health check endpoint with context monitoring
    if (url === '/api/health') {
      const totalDocs = Object.values(knowledgeBases).reduce((sum, docs) => sum + docs.length, 0);
      const totalConversations = conversations.size;
      const activeExchanges = Array.from(conversations.values())
        .reduce((sum, conv) => sum + Math.floor(conv.length / 2), 0);
      
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
        jwtEnabled: true,
        contextManagement: {
          conversationLimits: CONVERSATION_LIMITS,
          totalConversations: totalConversations,
          totalActiveExchanges: activeExchanges,
          warningThreshold: CONTEXT_WARNING_THRESHOLD,
          hardLimit: CONTEXT_HARD_LIMIT
        }
      });
      return;
    }

    // Debug endpoint for testing document selection
    if (url === '/api/debug-grant-docs' && method === 'GET') {
      const task = req.query.task || 'grant-criteria';
      console.log(`\n🧪 TESTING DOCUMENT SELECTION FOR TASK: ${task}`);
      
      const docs = knowledgeBases['grant-cards'] || [];
      console.log(`Available docs: ${docs.map(d => d.filename).join(', ')}`);
      
      // Test the selection function
      const testDocs = selectGrantCardDocuments(task, `test message for ${task}`, '', []);
      
      res.json({
        task: task,
        totalDocs: docs.length,
        availableDocs: docs.map(d => d.filename),
        selectedDocs: testDocs.map(d => ({ filename: d.filename, size: d.content.length })),
        searchPatterns: {
          'grant-criteria': 'grant_criteria_formatter or grant-criteria-formatter',
          'preview': 'preview_section_generator or preview-section-generator',
          'requirements': 'general_requirements_creator or general-requirements-creator',
          'insights': 'granted_insights_generator or granted-insights-generator',
          'categories': 'categories_tags_classifier or categories-tags-classifier',
          'missing-info': 'missing_info_generator or missing-info-generator'
        },
        actualFileNames: docs.map(d => d.filename)
      });
      return;
    }
    
    // Context status endpoint
    if (url === '/api/context-status' && method === 'GET') {
      const conversationId = req.query?.conversationId || 'default';
      const agentType = req.query?.agentType || 'grant-cards';
      
      const conversation = conversations.get(conversationId) || [];
      const exchangeCount = Math.floor(conversation.length / 2);
      const limit = CONVERSATION_LIMITS[agentType];
      
      // Rough estimate without full context
      const estimatedTokens = conversation.length * (TOKENS_PER_EXCHANGE / 2) + 30000; // +30K for system + KB
      const utilization = (estimatedTokens / CONTEXT_ABSOLUTE_LIMIT * 100).toFixed(1);
      
      res.json({
        agentType,
        conversationId,
        exchanges: exchangeCount,
        exchangeLimit: limit,
        utilizationPercent: utilization,
        estimatedTokens: estimatedTokens,
        status: estimatedTokens > CONTEXT_WARNING_THRESHOLD ? 'warning' : 'good',
        remainingCapacity: CONTEXT_ABSOLUTE_LIMIT - estimatedTokens
      });
      return;
    }

    // ETG tools status endpoint
    if (url === '/api/etg-tools-status') {
      res.json({
        eligibilityChecker: 'Active',
        knowledgeBaseSearch: 'Active', 
        bcAlternativesSearch: 'Available via web search',
        totalETGDocuments: knowledgeBases['etg']?.length || 0
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

// Performance monitoring endpoint
if (url === '/api/performance-stats') {
  res.json({
    cacheStats: {
      size: responseCache.size,
      hits: performanceMetrics.cacheHits,
      misses: performanceMetrics.cacheMisses,
      hitRate: performanceMetrics.cacheHits / (performanceMetrics.cacheHits + performanceMetrics.cacheMisses) || 0
    },
    knowledgeBaseStats: {
      loaded: knowledgeBaseLoaded,
      totalDocs: Object.values(knowledgeBases).reduce((sum, docs) => sum + docs.length, 0),
      kbLoadsFull: performanceMetrics.kbLoadsFull,
      kbLoadsPartial: performanceMetrics.kbLoadsPartial,
      kbSkipped: performanceMetrics.kbSkipped
    },
    performance: {
      avgResponseTime: Math.round(performanceMetrics.avgResponseTime) + 'ms',
      totalRequests: performanceMetrics.totalRequests,
      rateLimitDelay: RATE_LIMIT_DELAY + 'ms',
      cacheDuration: (CACHE_DURATION / 1000 / 60) + ' minutes'
    }
  });
  return;
}

// Cache invalidation endpoint
if (url === '/api/clear-cache' && method === 'POST') {
  responseCache.clear();
  knowledgeBaseLoaded = false;
  knowledgeBaseCacheTime = 0;
  console.log('🗑️ Cache cleared - will reload on next request');
  res.json({ success: true, message: 'Cache cleared successfully' });
  return;
}

  // Grant Cards Endpoint - REPLACE your existing one
if (url === '/api/process-grant' && method === 'POST') {
  await new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  const { message, task, conversationId } = req.body;
  let fileContent = '';
  
  if (req.file) {
    fileContent = await processFileContent(req.file);
  }
  
  try {
    const result = await processRequestWithSmartKnowledge(
      'grant-cards',
      message || 'Generate grant criteria',
      conversationId,
      fileContent,
      { task }
    );
    
    console.log(`✅ Grant Card Response in ${result.processingTime}ms`);
    res.json(result);
  } catch (error) {
    console.error('Grant Card processing error:', error);
    res.status(500).json({ error: error.message });
  }
  return;
}

// ETG Endpoint - REPLACE your existing one
if (url === '/api/process-etg' && method === 'POST') {
  await new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const { message, conversationId } = req.body;
  let fileContent = '';
  
  console.log(`🎯 ETG Request: "${message?.substring(0, 50)}..."`);
  
  if (req.file) {
    fileContent = await processFileContent(req.file);
  }
  
  try {
    const result = await processRequestWithSmartKnowledge(
      'etg-writer',
      message || 'Hello',
      conversationId,
      fileContent
    );
    
    console.log(`✅ ETG Response in ${result.processingTime}ms (KB: ${result.knowledgeUsed})`);
    res.json(result);
  } catch (error) {
    console.error('ETG processing error:', error);
    res.status(500).json({ error: error.message });
  }
  return;
}

   // BCAFE Endpoint - REPLACE your existing one
if (url === '/api/process-bcafe' && method === 'POST') {
  await new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  const { message, conversationId, orgType, selectedMarkets } = req.body;
  let fileContent = '';
  
  if (req.file) {
    fileContent = await processFileContent(req.file);
  }
  
  try {
    const result = await processRequestWithSmartKnowledge(
      'bcafe-writer',
      message || 'Help with BCAFE application',
      conversationId,
      fileContent,
      { orgType, selectedMarkets }
    );
    
    console.log(`✅ BCAFE Response in ${result.processingTime}ms`);
    res.json(result);
  } catch (error) {
    console.error('BCAFE processing error:', error);
    res.status(500).json({ error: error.message });
  }
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
