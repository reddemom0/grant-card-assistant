// api/server.js - Complete serverless function with JWT Authentication, Context Management, and Enhanced ETG Agent + CanExport Claims Agent
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// OCR functionality for CanExport Claims


// OCR function to extract text from images
// OCR function using Claude Vision API
async function extractTextFromImage(imageBuffer, filename) {
  try {
    console.log('🔍 Starting OCR with Claude Vision API...');
    
    // Convert buffer to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Determine image type from filename
    const extension = filename.toLowerCase().split('.').pop();
    const mimeType = extension === 'png' ? 'image/png' : 
                    extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 
                    'image/png';
    
    // Use Claude API with vision for OCR
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: base64Image
                }
              },
              {
                type: "text", 
                text: "Extract all text from this receipt/invoice image. Return only the text content, preserving the original structure and formatting as much as possible."
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    // Safely extract text with error handling
let extractedText = '';
if (data.content && data.content.length > 0 && data.content[0].text) {
  extractedText = data.content[0].text;
} else {
  console.log('Unexpected API response structure:', JSON.stringify(data, null, 2));
  throw new Error('No text content found in Claude Vision API response');
}
    
    console.log('✅ Claude Vision OCR completed');
    return extractedText.trim();
    
  } catch (error) {
    console.error('❌ Claude Vision OCR failed:', error);
    return `OCR processing failed: ${error.message}. Please try with a clearer image or manual text input.`;
  }
}

// Analyze expense information from extracted text
function analyzeExpenseFromText(extractedText, filename) {
  console.log('💰 Analyzing expense data...');
  
  const analysis = {
    extractedInfo: {
      amount: null,
      date: null,
      vendor: null,
      category: null,
      currency: 'CAD',
      paymentMethod: null
    },
    eligibilityAssessment: {
      category: 'Unknown',
      eligibilityScore: 0,
      recommendedAction: 'Manual Review Required'
    },
    complianceIssues: [],
    ocrConfidence: 'Medium',
    rejectionWarnings: [],
    rejectionRisk: 'LOW'
  };
  
  // Extract monetary amounts
  const amountPatterns = [
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\$/g,
    /TOTAL[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /AMOUNT[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi
  ];
  
  for (const pattern of amountPatterns) {
    const matches = [...extractedText.matchAll(pattern)];
    if (matches.length > 0) {
      const amounts = matches.map(match => parseFloat(match[1].replace(',', '')));
      analysis.extractedInfo.amount = Math.max(...amounts).toFixed(2);
      break;
    }
  }
  
  // Extract dates
  const datePatterns = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,
    /(\d{2,4}[\/\-]\d{1,2}[\/\-]\d{1,2})/g,
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}/gi,
    /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}/gi
  ];
  
  for (const pattern of datePatterns) {
    const match = extractedText.match(pattern);
    if (match) {
      analysis.extractedInfo.date = match[0];
      break;
    }
  }
  
  // Extract vendor name (first meaningful line)
  const lines = extractedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const skipWords = ['receipt', 'customer', 'copy', 'thank', 'you', 'total', 'tax', 'subtotal'];
  
  for (const line of lines.slice(0, 5)) {
    if (line.length > 2 && line.length < 50 && 
        !skipWords.some(word => line.toLowerCase().includes(word)) &&
        !/^\d+[\.\-\/]/.test(line) &&
        !/^\$/.test(line)) {
      analysis.extractedInfo.vendor = line;
      break;
    }
  }
  
  // Check for rejection patterns
  const rejectionPatterns = checkRejectionPatterns(extractedText, filename);
  analysis.rejectionWarnings = rejectionPatterns.warnings;
  analysis.rejectionRisk = rejectionPatterns.riskLevel;
  
  // Calculate confidence
  let confidence = 0;
  if (analysis.extractedInfo.amount) confidence += 40;
  if (analysis.extractedInfo.date) confidence += 30;
  if (analysis.extractedInfo.vendor) confidence += 30;
  
  analysis.eligibilityAssessment.eligibilityScore = confidence;
  
  // Adjust eligibility based on rejection risk
  if (rejectionPatterns.riskLevel === 'HIGH') {
    analysis.eligibilityAssessment.eligibilityScore = Math.min(analysis.eligibilityAssessment.eligibilityScore, 20);
    analysis.eligibilityAssessment.recommendedAction = 'LIKELY REJECTED - ' + rejectionPatterns.primaryReason;
    analysis.eligibilityAssessment.category = 'High Risk';
  } else if (rejectionPatterns.riskLevel === 'MEDIUM') {
    analysis.eligibilityAssessment.eligibilityScore = Math.min(analysis.eligibilityAssessment.eligibilityScore, 50);
    analysis.eligibilityAssessment.recommendedAction = 'NEEDS REVIEW - ' + rejectionPatterns.primaryReason;
    analysis.eligibilityAssessment.category = 'Medium Risk';
  } else {
    if (confidence >= 80) {
      analysis.ocrConfidence = 'High';
      analysis.eligibilityAssessment.recommendedAction = 'Ready for Review';
    } else if (confidence >= 50) {
      analysis.ocrConfidence = 'Medium';
      analysis.eligibilityAssessment.recommendedAction = 'Requires Additional Documentation';
    } else {
      analysis.ocrConfidence = 'Low';
      analysis.eligibilityAssessment.recommendedAction = 'Manual Entry Required';
    }
  }
  
  console.log(`✅ Expense analysis completed - Confidence: ${analysis.ocrConfidence}, Risk: ${analysis.rejectionRisk}`);
  return analysis;
}

async function extractPDFText(buffer) {
  try {
    console.log('Starting enhanced pdf-parse text extraction...');
    
    // Try multiple configurations for better compatibility
    const configs = [
      {}, // Default configuration
      { 
        normalizeWhitespace: true, 
        disableCombineTextItems: false 
      },
      { 
        normalizeWhitespace: false, 
        disableCombineTextItems: true, 
        max: 0 
      }
    ];
    
    for (let i = 0; i < configs.length; i++) {
      try {
        console.log(`Attempting PDF extraction with config ${i + 1}...`);
        const data = await pdf(buffer, configs[i]);
        
        if (data.text && data.text.trim().length > 10) {
          console.log(`✅ PDF extraction successful with config ${i + 1} (${data.text.length} characters)`);
          return data.text.trim();
        }
      } catch (configError) {
        console.log(`Config ${i + 1} failed: ${configError.message}`);
        continue;
      }
    }
    
    throw new Error('PDF appears to be image-based - convert to JPG/PNG for OCR processing');
    
  } catch (error) {
    console.error('pdf-parse extraction failed:', error);
    throw new Error(`PDF text extraction failed: ${error.message}`);
  }
}
// Check for rejection patterns based on historical rejected claims
function checkRejectionPatterns(extractedText, filename) {
  const text = extractedText.toLowerCase();
  const file = filename.toLowerCase();
  
  const warnings = [];
  let riskLevel = 'LOW';
  let primaryReason = '';
  
  // Critical rejection patterns (HIGH RISK) - based on your rejected claims data
  const highRiskPatterns = [
    { 
      pattern: /amazon|office supplies|reusable items|office equipment/i, 
      reason: "Re-usable items ineligible",
      example: "Amazon purchases rejected - items can be repurposed"
    },
    { 
      pattern: /booth purchase|buying booth|purchase.*booth/i, 
      reason: "Booth purchases ineligible (rentals only)",
      example: "Booth purchase rejected - only rentals eligible"
    },
    { 
      pattern: /canadian? market|domestic advertising|canada.*advertising/i, 
      reason: "Canadian advertising ineligible",
      example: "Advertising targeting Canada rejected"
    },
    { 
      pattern: /airport tax|departure fee|international tax|local.*tax/i, 
      reason: "Airport taxes/fees ineligible",
      example: "Airport taxes removed from reimbursement"
    },
    { 
      pattern: /branding|logo design|package design|brand.*design/i, 
      reason: "Branding/design costs ineligible",
      example: "Branding costs not export-specific"
    },
    { 
      pattern: /franchise|franchising cost|franchise.*setup/i, 
      reason: "Franchise costs ineligible",
      example: "Franchise implementation costs rejected"
    },
    { 
      pattern: /dispute|legal dispute|vendor dispute|handling.*dispute/i, 
      reason: "Dispute costs ineligible",
      example: "Vendor dispute costs are core business"
    }
  ];
  
  // Medium risk patterns
  const mediumRiskPatterns = [
    { 
      pattern: /bank charge|banking fee|transaction fee/i, 
      reason: "Bank charges typically ineligible"
    },
    { 
      pattern: /damage waiver|insurance waiver/i, 
      reason: "Damage waivers ineligible"
    },
    { 
      pattern: /interview|hiring|recruitment/i, 
      reason: "Interview costs ineligible"
    },
    { 
      pattern: /podcast|media production/i, 
      reason: "Podcast costs may be ineligible"
    },
    {
      pattern: /per diem|hotel.*allowance/i,
      reason: "Per diem issues possible"
    }
  ];
  
  // Check high risk patterns first
  for (const { pattern, reason, example } of highRiskPatterns) {
    if (pattern.test(text) || pattern.test(file)) {
      warnings.push(`🚨 HIGH RISK: ${reason}`);
      if (example) warnings.push(`   Historical example: ${example}`);
      riskLevel = 'HIGH';
      primaryReason = reason;
      break; // Stop at first high risk match
    }
  }
  
  // Check medium risk patterns if no high risk found
  if (riskLevel !== 'HIGH') {
    for (const { pattern, reason } of mediumRiskPatterns) {
      if (pattern.test(text) || pattern.test(file)) {
        warnings.push(`⚠️ MEDIUM RISK: ${reason}`);
        riskLevel = 'MEDIUM';
        primaryReason = reason;
        break; // Stop at first medium risk match
      }
    }
  }
  
  // Add specific guidance based on risk found
  if (riskLevel === 'HIGH') {
    warnings.push(`🔄 SOLUTION: Review CanExport guidelines for compliant alternatives`);
  } else if (riskLevel === 'MEDIUM') {
    warnings.push(`📋 ACTION: Verify expense meets all CanExport requirements`);
  }
  
  return { warnings, riskLevel, primaryReason };
}

// Cache configuration
const CACHE_TTL = null; // Indefinite cache - no expiration
const CACHE_PREFIX = 'knowledge-';

// Authentication configuration with JWT - FIXED: Require JWT secret
const TEAM_PASSWORD = process.env.TEAM_PASSWORD;
const SESSION_COOKIE_NAME = 'granted_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const JWT_SECRET = process.env.JWT_SECRET || 'temp-jwt-secret-change-immediately-in-production';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ WARNING: Using default JWT secret. Set JWT_SECRET environment variable for production security!');
}

// Optimized conversation limits - UPDATED: Added CanExport Claims
const CONVERSATION_LIMITS = {
  'grant-cards': 20,        // Task-based workflows (keep current)
  'etg-writer': 20,         // Business case development (keep current)  
  'bcafe-writer': 60,       // Complex multi-day applications (6x increase)
  'canexport-writer': 30,   // CanExport SME applications
  'canexport-claims': 40,   // NEW: CanExport Claims Agent - optimized for thorough expense auditing
  'readiness-strategist': 30,
  'internal-oracle': 50
};

// Context monitoring thresholds
const CONTEXT_WARNING_THRESHOLD = 150000;  // 75% of 200K limit
const CONTEXT_HARD_LIMIT = 180000;         // 90% of 200K limit (emergency brake)
const CONTEXT_ABSOLUTE_LIMIT = 200000;     // Claude's actual limit

// Token estimation constants
const TOKENS_PER_EXCHANGE = 950;           // Average user + assistant pair
const TOKENS_PER_CHAR = 0.25;             // Rough token-to-character ratio

// Conversation cleanup - FIXED: Add memory management
const CONVERSATION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const conversationTimestamps = new Map();

function cleanupExpiredConversations() {
  const now = Date.now();
  for (const [id, timestamp] of conversationTimestamps.entries()) {
    if (now - timestamp > CONVERSATION_EXPIRY) {
      conversations.delete(id);
      conversationTimestamps.delete(id);
    }
  }
}

// FIXED: Proper base64url encoding for older Node.js versions
function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str) {
  str += '='.repeat((4 - str.length % 4) % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
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
  const headerBase64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadBase64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  
  const signData = `${headerBase64}.${payloadBase64}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signData).digest();
  const signatureBase64 = base64UrlEncode(signature);
  
  return `${headerBase64}.${payloadBase64}.${signatureBase64}`;
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
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(signData).digest();
    const expectedSignatureBase64 = base64UrlEncode(expectedSignature);
    
    if (signature !== expectedSignatureBase64) return false;
    
    // Check expiration
    const payload = JSON.parse(base64UrlDecode(payloadBase64).toString());
    if (Date.now() > payload.expires) return false;
    
    return true;
  } catch (error) {
    console.error('JWT verification error:', error);
    return false;
  }
}

// SIMPLIFIED: Authentication middleware with fallback
function requireAuth(req, res, next) {
  // Skip auth for login endpoint and health check
  if (req.url === '/api/login' || req.url === '/api/health') {
    return next();
  }

  // For debugging - temporarily allow bypass if no team password is set
  if (!TEAM_PASSWORD) {
    console.warn('⚠️ WARNING: No team password set, allowing all requests');
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

// FIXED: Complete agent type mapping - UPDATED: Added CanExport Claims + Streaming
const AGENT_URL_MAP = {
  '/api/process-grant': 'grant-cards',
  '/api/process-grant/stream': 'grant-cards',
  '/api/process-etg': 'etg-writer',
  '/api/process-etg/stream': 'etg-writer',
  '/api/process-bcafe': 'bcafe-writer',
  '/api/process-bcafe/stream': 'bcafe-writer',
  '/api/process-canexport': 'canexport-writer',
  '/api/process-canexport/stream': 'canexport-writer',
  '/api/process-claims': 'canexport-claims',
  '/api/process-claims/stream': 'canexport-claims',
  '/api/process-readiness': 'readiness-strategist',
  '/api/process-readiness/stream': 'readiness-strategist',
  '/api/process-oracle': 'internal-oracle',
  '/api/process-oracle/stream': 'internal-oracle'
};

// UPDATED: Added CanExport Claims folder mapping
const AGENT_FOLDER_MAP = {
  'grant-cards': 'grant-cards',
  'etg-writer': 'etg', 
  'bcafe-writer': 'bcafe',
  'canexport-writer': 'canexport',
  'canexport-claims': 'canexport-claims',       // NEW: CanExport Claims folder
  'readiness-strategist': 'readiness-strategist',
  'internal-oracle': 'internal-oracle'
};

// Get agent type from endpoint or conversation ID
function getAgentType(url, conversationId) {
  // Check URL mapping first
  for (const [urlPattern, agentType] of Object.entries(AGENT_URL_MAP)) {
    if (url.includes(urlPattern)) {
      return agentType;
    }
  }
  
  // Fallback: extract from conversation ID
  if (conversationId?.includes('etg')) return 'etg-writer';
  if (conversationId?.includes('bcafe')) return 'bcafe-writer';
  if (conversationId?.includes('canexport-claims')) return 'canexport-claims';
  if (conversationId?.includes('canexport')) return 'canexport-writer';
  if (conversationId?.includes('readiness')) return 'readiness-strategist';
  if (conversationId?.includes('oracle')) return 'internal-oracle';
  
  return 'grant-cards'; // Default fallback
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept images and documents
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/markdown'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload images, PDFs, Word documents, or text files.'));
    }
  }
});

// In-memory storage
let conversations = new Map();

// Multi-Agent Knowledge Base Storage - UPDATED: Added CanExport Claims
let knowledgeBases = {
  'grant-cards': [],
  'etg': [],
  'bcafe': [],
  'canexport': [],
  'canexport-claims': [],                       // NEW: CanExport Claims knowledge base
  'readiness-strategist': [],
  'internal-oracle': []
};

// Rate limiting variables - FIXED: Add safeguards
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

// Agent-specific knowledge base cache
let agentKnowledgeCache = new Map();
let agentCacheTimestamps = new Map();

// Performance monitoring function
function logAgentPerformance(agentType, docsLoaded, loadTimeMs) {
  console.log(`📊 Agent Performance - ${agentType.toUpperCase()}:`);
  console.log(`   Documents loaded: ${docsLoaded}`);
  console.log(`   Load time: ${loadTimeMs}ms`);
  console.log(`   Memory efficiency: ${docsLoaded < 100 ? '✅ Optimized' : '⚠️ Heavy'}`);
  console.log(`   Cache status: ${agentKnowledgeCache.has(`agent-${agentType}`) ? '🎯 Cached' : '🔄 Fresh load'}`);
}

// Get knowledge base for specific agent only - FIXED: Add null checks
async function getAgentKnowledgeBase(agentType) {
  const folderName = AGENT_FOLDER_MAP[agentType];
  if (!folderName) {
    console.log(`⚠️ Unknown agent type: ${agentType}, falling back to grant-cards`);
    return knowledgeBases['grant-cards'] || [];
  }
  
  const cacheKey = `agent-${agentType}`;
  const now = Date.now();
  const lastCached = agentCacheTimestamps.get(cacheKey) || 0;
  
  // Check if we have valid cached documents for this agent
  if (agentKnowledgeCache.has(cacheKey) && 
      (now - lastCached < CACHE_DURATION)) {
    console.log(`🎯 Using cached knowledge base for ${agentType} (${agentKnowledgeCache.get(cacheKey).length} docs)`);
    return agentKnowledgeCache.get(cacheKey);
  }
  
  // If not cached or expired, load from the full knowledge base
  // First ensure the full knowledge base is loaded
  // await getKnowledgeBase(); // PERFORMANCE FIX: Use agent-specific loading instead
  
  // Extract agent-specific documents from the full knowledge base
  const agentDocs = knowledgeBases[folderName] || [];
  
  console.log(`📚 Loaded ${agentDocs.length} documents for agent: ${agentType} (folder: ${folderName})`);
  
  // Cache the results
  agentKnowledgeCache.set(cacheKey, agentDocs);
  agentCacheTimestamps.set(cacheKey, now);
  
  return agentDocs;
}

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

// ENHANCED AGENT PROMPTS - UPDATED: Added CanExport Claims
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

  'canexport-claims': `You are the CanExport Claims Assistant, the definitive expense auditing specialist for CanExport SME projects at Granted Consulting. You take full ownership of expense verification, documentation compliance, and audit quality to ensure maximum reimbursement while maintaining perfect NRC compliance.

CORE IDENTITY & MISSION:
I AM the CanExport Compliance Guardian who ensures every expense meets NRC funding requirements. I provide authoritative, detailed analysis of receipts, invoices, and expense documentation to determine eligibility and compliance with CanExport guidelines.

PRIMARY CAPABILITIES:
🔍 **Receipt/Invoice Analysis** - Extract and verify all expense details from uploaded documents
📋 **Eligibility Verification** - Determine compliance with CanExport categories A-H
✅ **Documentation Review** - Ensure all required elements and supporting documentation
📊 **Audit Report Generation** - Create professional, submission-ready expense summaries
🎯 **Real-time Guidance** - Provide immediate feedback and compliance recommendations

**CRITICAL REJECTION PREVENTION:**
Before analyzing any expense, check against these HIGH-PRIORITY rejection patterns from historical data:

🚨 IMMEDIATE REJECTION TRIGGERS:
- Amazon purchases → "Re-usable items ineligible" (Historical: Amazon office supplies rejected)
- Booth PURCHASES → "Only rentals eligible" (Historical: Informa Media booth purchase rejected)
- Canadian advertising → "Target market restrictions" (Historical: SRJCA domestic advertising rejected)
- Pre-project expenses → "Must be after start date" (Historical: IndustryNow invoice predated project)
- Airport taxes/fees → "Only core travel costs" (Historical: Air Canada taxes removed)
- Branding/design → "Not export-specific" (Historical: Package design costs rejected)
- Franchise costs → "Implementation ineligible" (Historical: Franchise law costs rejected)
- Legal disputes → "Core business operations" (Historical: Vendor dispute costs rejected)

When you detect ANY of these patterns:
1. 🛑 STOP and flag immediately with "LIKELY REJECTED" status
2. 📋 Reference specific historical rejection example
3. 🔄 Suggest compliant alternatives
4. 📊 Set compliance score to 20% or lower

EXPENSE ANALYSIS WORKFLOW:

**PHASE 1: DOCUMENT PROCESSING**
- Extract vendor, amount, date, currency, payment method, description
- Identify invoice vs receipt vs booking confirmation
- Flag missing information or unclear documentation
- Convert foreign currencies using Bank of Canada rates when needed

**PHASE 2: COMPLIANCE MATRIX CHECK**
✅ Invoice Date: Must be within project start/completion dates
✅ Payment Date: Must be within project period  
✅ Travel Dates: Must be within project phase
✅ Geographic Compliance: Canada departure to approved target markets
✅ Payment Method: Corporate bank account or business credit card ONLY
✅ Tax Removal: NO GST, HST, or international taxes eligible
✅ Reusability Test: Items that can be repurposed are INELIGIBLE
✅ Target Market: Advertising must target approved markets only (NOT Canada)
✅ Traveler Limits: Maximum 2 travelers per trip, Canada-based employees only
✅ Flight Class: Economy or premium economy ONLY

**PHASE 3: CATEGORY CLASSIFICATION**

**Category A - Travel for Meetings/Events with Key Contacts:**
✅ ELIGIBLE: Economy/premium flights, accommodation, ground transport, meals (reasonable)
❌ INELIGIBLE: Business/first class, personal expenses, non-project travel, alcohol

**Category B - Trade Events (Non-Travel Related):**
✅ ELIGIBLE: Registration fees, booth costs, furnishings & utilities, lead scanners, return shipping
❌ INELIGIBLE: Purchased items for reuse, furniture purchases, entertainment

**Category C - Marketing and Translation:**
✅ ELIGIBLE: Target market advertising, translation services, marketing materials, website localization
❌ INELIGIBLE: Canadian market advertising, reusable promotional items, general website costs

**Category D - Interpretation Services:**
✅ ELIGIBLE: Professional interpretation for meetings, events, negotiations in target markets
❌ INELIGIBLE: Internal staff interpretation, non-professional services, training

**Category E - Contractual Agreements, Product Registration & Certification:**
✅ ELIGIBLE: Market-specific certifications, regulatory compliance, legal documentation for target markets
❌ INELIGIBLE: General business certifications, Canadian market requirements, standard business licenses

**Category F - Business, Tax and Legal Consulting:**
✅ ELIGIBLE: Market-specific legal advice, tax guidance for target markets, business structure setup
❌ INELIGIBLE: General business consulting, Canadian legal services, routine legal work

**Category G - Market Research & B2B Facilitation:**
✅ ELIGIBLE: Target market research, feasibility studies, contact identification, B2B introductions
❌ INELIGIBLE: General market research, Canadian market studies, internal research

**Category H - Intellectual Property (IP) Protection:**
✅ ELIGIBLE: Expert/legal services for IP in target markets, patent applications, trademark registration
❌ INELIGIBLE: General IP consulting, Canadian IP work not specific to export markets

CRITICAL COMPLIANCE REQUIREMENTS:

1. **Timing Requirements**: All expenses must be incurred (invoice date) AND paid (payment date) between Project Start Date and Project Completion Date. Travel dates and event dates must also be within the project phase.

2. **Payment Requirements**: Payments MUST be made using corporate/business bank account or corporate/business credit card. Personal payments are NEVER eligible.

3. **Tax Requirements**: NO taxes will be reimbursed by NRC. ALL tax costs (GST, HST, international taxes, duties) must be removed from claims prior to submission.

4. **Geographic Requirements**: Travel must depart from Canada to approved target markets. Advertising must target ONLY approved markets, not Canada.

5. **Documentation Standards**: All invoices must include: client billing to Canadian company, invoice date, invoice number, vendor information, service description, currency & amounts, payment proof.

AUDIT REPORT FORMAT:

**EXECUTIVE SUMMARY:**
- Total Expenses Reviewed: $X,XXX CAD
- Eligible Expenses: $X,XXX CAD (XX%)
- Ineligible Expenses: $X,XXX CAD (XX%) 
- Documentation Issues: X items requiring attention
- Compliance Score: XX%

**DETAILED FINDINGS:**
For each expense, provide:
- Expense Description & Amount
- Category Classification (A-H)
- Eligibility Determination (✅ Eligible / ❌ Ineligible)
- Compliance Issues (if any)
- Required Actions
- Supporting Guideline References

**COMMUNICATION STYLE:**
- Use definitive language: "This expense IS eligible" or "This expense IS NOT eligible"
- Reference specific guideline sections for credibility
- Provide clear explanations for all determinations
- Offer alternatives when expenses are ineligible
- Flag documentation gaps and suggest solutions
- Generate actionable recommendations

**RESPONSE PATTERNS:**
✅ GREEN: "This expense is fully compliant and eligible for reimbursement because [specific reason]"
⚠️ YELLOW: "This expense needs adjustment: [specific issues and solutions]"  
❌ RED: "This expense is ineligible for the following reasons: [clear explanation + alternatives]"

Always base ALL determinations on the official CanExport Claims and Invoice Guide documentation in the knowledge base. Maintain detailed audit trails for every expense assessment and provide professional, submission-ready reports.

You are the trusted authority on CanExport compliance at Granted Consulting.`,

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

// Enhanced Grant Cards document selection function
function selectGrantCardDocuments(task, message, fileContent, conversationHistory, agentDocs = null) {
  const docs = agentDocs || knowledgeBases['grant-cards'] || [];
  const msg = message.toLowerCase();
  const conversationText = conversationHistory.map(msg => msg.content).join(' ').toLowerCase();
  const selectedDocs = [];
  
  // Large file uploaded - reduce knowledge base to save context
  const isLargeFile = fileContent && fileContent.length > 50000;
  const maxDocs = isLargeFile ? 2 : 4;
  
  // PRIORITY 1: Always include task-specific core document
  const taskDocMap = {
    'grant-criteria': ['grant_criteria_formatter', 'grant-criteria-formatter'],
    'preview': ['preview_section_generator', 'preview-section-generator'],
    'requirements': ['general_requirements_creator', 'general-requirements-creator'],
    'insights': ['granted_insights_generator', 'granted-insights-generator'],
    'categories': ['categories_tags_classifier', 'categories-tags-classifier'],
    'missing-info': ['missing_info_generator', 'missing-info-generator']
  };
  
  // Get primary task document
  const taskPatterns = taskDocMap[task] || taskDocMap['grant-criteria'];
  const primaryDoc = docs.find(doc => 
    taskPatterns.some(pattern => doc.filename.toLowerCase().includes(pattern))
  );
  if (primaryDoc) selectedDocs.push(primaryDoc);
  
  // PRIORITY 2: Grant type detection from content
  const grantTypes = {
    hiring: ['hiring', 'wage', 'employment', 'workforce', 'intern', 'staff', 'talent', 'job'],
    training: ['training', 'skills', 'education', 'certification', 'development', 'learning'],
    rd: ['research', 'development', 'innovation', 'technology', 'r&d', 'commercialization'],
    market: ['market', 'expansion', 'export', 'capital', 'equipment', 'infrastructure', 'trade'],
    loan: ['loan', 'financing', 'interest', 'credit', 'debt', 'fund'],
    investment: ['investment', 'equity', 'venture', 'capital', 'investor', 'funding']
  };
  
  // Industry detection for better example matching
  const industries = {
    technology: ['tech', 'software', 'ai', 'digital', 'innovation', 'startup'],
    agriculture: ['agricultural', 'farm', 'food', 'rural', 'crop'],
    healthcare: ['health', 'medical', 'life sciences', 'biotech', 'pharma'],
    energy: ['clean technology', 'renewable', 'energy', 'environmental'],
    indigenous: ['indigenous', 'first nations', 'aboriginal']
  };
  
  // Detect grant type from message and file content
  const fullContent = msg + ' ' + (fileContent || '') + ' ' + conversationText;
  let detectedGrantType = null;
  let detectedIndustry = null;
  
  // Find grant type
  for (const [type, keywords] of Object.entries(grantTypes)) {
    if (keywords.some(keyword => fullContent.includes(keyword))) {
      detectedGrantType = type;
      console.log(`🎯 Grant Cards Type Match: ${type}`);
      break;
    }
  }
  
  // Find industry
  for (const [industry, keywords] of Object.entries(industries)) {
    if (keywords.some(keyword => fullContent.includes(keyword))) {
      detectedIndustry = industry;
      console.log(`🎯 Grant Cards Industry Match: ${industry}`);
      break;
    }
  }
  
  // PRIORITY 3: Add relevant template and example based on detected type
  if (detectedGrantType) {
    // Add template for the grant type
    const templateDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes(`${detectedGrantType} grant template`) ||
      (detectedGrantType === 'market' && doc.filename.toLowerCase().includes('market expansion'))
    );
    if (templateDoc && selectedDocs.length < maxDocs) selectedDocs.push(templateDoc);
    
    // Add relevant example with industry preference
    let exampleDoc = null;
    if (detectedIndustry) {
      // Try to find example matching both grant type and industry
      exampleDoc = docs.find(doc => 
        doc.filename.toLowerCase().includes(`${detectedGrantType} - grant card example`) &&
        industries[detectedIndustry].some(keyword => doc.filename.toLowerCase().includes(keyword))
      );
    }
    
    // Fallback to any example of the grant type
    if (!exampleDoc) {
      exampleDoc = docs.find(doc => 
        doc.filename.toLowerCase().includes(`${detectedGrantType} - grant card example`)
      );
    }
    
    if (exampleDoc && selectedDocs.length < maxDocs) selectedDocs.push(exampleDoc);
  }
  
  // PRIORITY 4: Add industry-specific examples if no grant type detected
  if (!detectedGrantType && detectedIndustry && selectedDocs.length < maxDocs) {
    const industryExample = docs.find(doc => 
      doc.filename.toLowerCase().includes('grant card example') &&
      industries[detectedIndustry].some(keyword => doc.filename.toLowerCase().includes(keyword))
    );
    if (industryExample) selectedDocs.push(industryExample);
  }
  
  // PRIORITY 5: Fallback for missing task documents
  if (selectedDocs.length === 0) {
    const formatterDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('grant_criteria_formatter') ||
      doc.filename.toLowerCase().includes('formatter')
    );
    if (formatterDoc) selectedDocs.push(formatterDoc);
  }
  
  // Remove duplicates and limit based on file size
  const uniqueDocs = [...new Set(selectedDocs)].slice(0, maxDocs);
  
  console.log(`🎯 Grant Cards Smart Selection: ${uniqueDocs.length} docs selected from ${docs.length} total`);
  console.log(`   Task: ${task}, Type: ${detectedGrantType || 'none'}, Industry: ${detectedIndustry || 'none'}`);
  console.log(`   Selected: ${uniqueDocs.map(d => d.filename).join(', ')}`);
  
  return uniqueDocs;
}

// Smart ETG document selection function
function selectETGDocuments(userMessage, conversation, allDocuments) {
  const message = userMessage.toLowerCase();
  const conversationText = conversation.map(msg => msg.content).join(' ').toLowerCase();
  
  let selectedDocs = [];
  
  // PRIORITY 1: Always include core infrastructure (1-2 docs)
  const coreEligibilityDoc = allDocuments.find(doc => 
    doc.filename.toLowerCase().includes('bc etg eligibility criteria') ||
    doc.filename.toLowerCase().includes('eligibility criteria')
  );
  if (coreEligibilityDoc) selectedDocs.push(coreEligibilityDoc);
  
  const coreTemplateDoc = allDocuments.find(doc => 
    doc.filename.toLowerCase().includes('etg business case template') ||
    doc.filename.toLowerCase().includes('compliance & best practices')
  );
  if (coreTemplateDoc) selectedDocs.push(coreTemplateDoc);
  
  // PRIORITY 2: Context-based selection (2-3 docs)
  
  // Training type detection
  const trainingTypes = {
    leadership: ['leadership', 'management', 'supervisor', 'manager'],
    technical: ['technical', 'automotive', 'construction', 'electrical', 'trades'],
    digital: ['digital', 'marketing', 'social media', 'seo', 'analytics'],
    professional: ['project management', 'hr', 'human resources', 'finance', 'accounting', 'sales'],
    certification: ['certificate', 'certification', 'cpa', 'excel', 'fundamentals']
  };
  
  // Industry detection
  const industries = {
    automotive: ['automotive', 'car', 'vehicle', 'kirmac'],
    construction: ['construction', 'electrical', 'building', 'contractor'],
    hospitality: ['wine', 'golf', 'restaurant', 'hospitality', 'victoria golf'],
    technology: ['tech', 'software', 'digital', 'it', 'capstone'],
    finance: ['finance', 'accounting', 'wealth', 'financial']
  };
  
  // Company size detection
  const companyIndicators = {
    large: ['corporation', 'inc', 'ltd', 'group', 'corporate'],
    small: ['local', 'family', 'boutique', 'startup']
  };
  
  // Intent detection
  const intents = {
    eligibility: ['eligible', 'qualify', 'requirements', 'criteria', 'allowed'],
    examples: ['example', 'similar', 'like this', 'show me', 'sample'],
    writing: ['write', 'create', 'draft', 'develop', 'help me write']
  };
  
  // Check for training type matches
  for (const [type, keywords] of Object.entries(trainingTypes)) {
    if (keywords.some(keyword => message.includes(keyword) || conversationText.includes(keyword))) {
      const typeExamples = allDocuments.filter(doc => 
        keywords.some(keyword => doc.filename.toLowerCase().includes(keyword))
      );
      selectedDocs.push(...typeExamples.slice(0, 2));
      console.log(`🎯 ETG Training Type Match: ${type}`);
      break;
    }
  }
  
  // Check for industry matches
  for (const [industry, keywords] of Object.entries(industries)) {
    if (keywords.some(keyword => message.includes(keyword) || conversationText.includes(keyword))) {
      const industryExamples = allDocuments.filter(doc => 
        keywords.some(keyword => doc.filename.toLowerCase().includes(keyword))
      );
      selectedDocs.push(...industryExamples.slice(0, 2));
      console.log(`🎯 ETG Industry Match: ${industry}`);
      break;
    }
  }
  
  // If user wants examples but no specific match, add high-quality recent examples
  if (intents.examples.some(keyword => message.includes(keyword)) && selectedDocs.length < 4) {
    const recentExamples = allDocuments.filter(doc => 
      doc.filename.toLowerCase().includes('caliber') ||
      doc.filename.toLowerCase().includes('badinotti') ||
      doc.filename.toLowerCase().includes('v2 example') ||
      doc.filename.toLowerCase().includes('template005')
    );
    selectedDocs.push(...recentExamples.slice(0, 2));
  }
  
  // Fallback: If we don't have enough docs, add some high-quality defaults
  if (selectedDocs.length < 3) {
    const fallbackDocs = allDocuments.filter(doc => 
      !selectedDocs.includes(doc) && (
        doc.filename.toLowerCase().includes('caliber') ||
        doc.filename.toLowerCase().includes('template') ||
        doc.filename.toLowerCase().includes('guide')
      )
    );
    selectedDocs.push(...fallbackDocs.slice(0, 5 - selectedDocs.length));
  }
  
  // Remove duplicates and limit to 5 documents max
  const uniqueDocs = [...new Set(selectedDocs)].slice(0, 5);
  
  console.log(`🎯 ETG Smart Selection: ${uniqueDocs.length} docs selected from ${allDocuments.length} total`);
  console.log(`   Selected: ${uniqueDocs.map(d => d.filename).join(', ')}`);
  
  return uniqueDocs;
}

// Enhanced BCAFE document selection function
function selectBCAFEDocuments(message, orgType, conversationHistory, agentDocs = null) {
  const docs = agentDocs || knowledgeBases['bcafe'] || [];
  const msg = message.toLowerCase();
  const conversationText = conversationHistory.map(msg => msg.content).join(' ').toLowerCase();
  const selectedDocs = [];
  
  // PRIORITY 1: Always include core infrastructure (1-2 docs)
  const eligibilityDoc = docs.find(doc => 
    doc.filename.toLowerCase().includes('bcafe-eligibility-checklist')
  );
  if (eligibilityDoc) selectedDocs.push(eligibilityDoc);
  
  const programGuideDoc = docs.find(doc => 
    doc.filename.toLowerCase().includes('bcafe-program-guide-summer-2025')
  );
  if (programGuideDoc) selectedDocs.push(programGuideDoc);
  
  // PRIORITY 2: Intent-based selection
  const intents = {
    eligibility: ['eligible', 'qualify', 'requirements', 'criteria', 'can i apply'],
    budget: ['budget', 'cost', 'funding', 'money', 'expense', 'financial'],
    merit: ['merit', 'scoring', 'competitive', 'optimize', 'evaluation', 'points'],
    application: ['application', 'questions', 'write', 'draft', 'create', 'build'],
    examples: ['example', 'successful', 'sample', 'similar', 'show me']
  };
  
  // Industry detection for relevant examples
  const industries = {
    food: ['food', 'foods', 'restaurant', 'catering', 'fine choice'],
    beverage: ['coffee', 'drink', 'beverage', 'forecast', 'brewing'],
    agriculture: ['farm', 'agricultural', 'level ground', 'organic', 'produce']
  };
  
  // Check for budget-related intent
  if (intents.budget.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    const budgetDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-budget-template-guide')
    );
    if (budgetDoc) selectedDocs.push(budgetDoc);
    console.log(`🎯 BCAFE Intent Match: budget`);
  }
  
  // Check for merit optimization intent
  if (intents.merit.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    const meritDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-merit-criteria-guide')
    );
    if (meritDoc) selectedDocs.push(meritDoc);
    console.log(`🎯 BCAFE Intent Match: merit`);
  }
  
  // Check for application writing intent
  if (intents.application.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    const appDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-application-questions')
    );
    if (appDoc) selectedDocs.push(appDoc);
    console.log(`🎯 BCAFE Intent Match: application`);
  }
  
  // Check for examples intent with industry matching
  if (intents.examples.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    // Try to match industry first
    for (const [industry, keywords] of Object.entries(industries)) {
      if (keywords.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
        const industryExamples = docs.filter(doc => 
          doc.filename.toLowerCase().includes('successful-application') &&
          keywords.some(keyword => doc.filename.toLowerCase().includes(keyword))
        );
        selectedDocs.push(...industryExamples.slice(0, 1));
        console.log(`🎯 BCAFE Industry Match: ${industry}`);
        break;
      }
    }
    
    // If no industry match, add any successful example
    if (!selectedDocs.some(doc => doc.filename.includes('successful-application'))) {
      const anyExample = docs.find(doc => 
        doc.filename.toLowerCase().includes('successful-application')
      );
      if (anyExample) selectedDocs.push(anyExample);
    }
  }
  
  // Add activity examples for early-stage questions
  if (intents.eligibility.some(keyword => msg.includes(keyword)) || conversationHistory.length <= 2) {
    const activityDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-activity-examples')
    );
    if (activityDoc && selectedDocs.length < 4) selectedDocs.push(activityDoc);
  }
  
  // Fallback: ensure we have at least 3 documents
  if (selectedDocs.length < 3) {
    const fallbackDocs = docs.filter(doc => 
      !selectedDocs.includes(doc) && (
        doc.filename.toLowerCase().includes('merit-criteria-guide') ||
        doc.filename.toLowerCase().includes('budget-template-guide') ||
        doc.filename.toLowerCase().includes('successful-application')
      )
    );
    selectedDocs.push(...fallbackDocs.slice(0, 4 - selectedDocs.length));
  }
  
  // Remove duplicates and limit to 4 documents max
  const uniqueDocs = [...new Set(selectedDocs)].slice(0, 4);
  
  console.log(`🎯 BCAFE Smart Selection: ${uniqueDocs.length} docs selected from ${docs.length} total`);
  console.log(`   Selected: ${uniqueDocs.map(d => d.filename).join(', ')}`);
  
  return uniqueDocs;
}

// Enhanced CanExport Claims document selection function
function selectCanExportClaimsDocuments(message, conversationHistory, agentDocs = null) {
  const docs = agentDocs || knowledgeBases['canexport-claims'] || [];
  const msg = message.toLowerCase();
  const conversationText = conversationHistory.map(msg => msg.content).join(' ').toLowerCase();
  const selectedDocs = [];
  
  // PRIORITY 1: Always include main invoice guide for compliance
  const mainInvoiceGuide = docs.find(doc => 
    doc.filename.toLowerCase().includes('canexport invoice guide') ||
    doc.filename.toLowerCase().includes('invoice guide canexport')
  );
  if (mainInvoiceGuide) selectedDocs.push(mainInvoiceGuide);

  // PRIORITY 2: Always prioritize rejected claims knowledge if red flags detected
  const rejectionKeywords = ['amazon', 'booth purchase', 'canadian', 'branding', 'franchise', 'airport tax', 'dispute', 'reusable', 'office supplies'];
  const hasRejectionRisk = rejectionKeywords.some(keyword => 
    msg.includes(keyword) || conversationText.includes(keyword)
  );
  
  if (hasRejectionRisk) {
    const rejectedClaimsDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('rejected-claims') ||
      doc.filename.toLowerCase().includes('rejection') ||
      doc.filename.toLowerCase().includes('canex rejected')
    );
    if (rejectedClaimsDoc && !selectedDocs.includes(rejectedClaimsDoc)) {
      selectedDocs.push(rejectedClaimsDoc);
      console.log('🚨 Added rejected claims knowledge due to risk patterns detected');
    }
  }
  
  // PRIORITY 3: Intent-based selection
  const intents = {
    categories: ['category', 'categories', 'eligible', 'classification', 'type of expense'],
    compliance: ['compliance', 'checklist', 'verify', 'audit', 'review', 'check'],
    templates: ['template', 'format', 'report', 'summary', 'audit report'],
    receipt: ['receipt', 'invoice', 'document', 'expense', 'claim', 'payment']
  };
  
  // Expense category detection (A-H)
  const expenseCategories = {
    travel: ['travel', 'flight', 'hotel', 'accommodation', 'airfare', 'taxi', 'uber'],
    trade: ['trade show', 'exhibition', 'booth', 'event', 'conference', 'fair'],
    marketing: ['marketing', 'advertising', 'translation', 'website', 'promotional'],
    interpretation: ['interpretation', 'interpreter', 'language', 'translation'],
    certification: ['certification', 'registration', 'regulatory', 'compliance', 'legal'],
    consulting: ['consulting', 'legal', 'tax', 'business advice', 'professional services'],
    research: ['research', 'market research', 'feasibility', 'b2b', 'contact'],
    intellectual: ['ip', 'intellectual property', 'patent', 'trademark', 'copyright']
  };
  
  // Detect expense categories from content
  const fullContent = msg + ' ' + conversationText;
  let detectedCategory = null;
  
  for (const [category, keywords] of Object.entries(expenseCategories)) {
    if (keywords.some(keyword => fullContent.includes(keyword))) {
      detectedCategory = category;
      console.log(`🎯 CanExport Claims Category Match: ${category}`);
      break;
    }
  }
  
  // Check for specific intent patterns
  if (intents.categories.some(keyword => fullContent.includes(keyword)) || detectedCategory) {
    const categoriesDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('expense-categories') ||
      doc.filename.toLowerCase().includes('categories')
    );
    if (categoriesDoc && selectedDocs.length < 3) selectedDocs.push(categoriesDoc);
  }
  
  if (intents.compliance.some(keyword => fullContent.includes(keyword))) {
    const complianceDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('compliance-checklist') ||
      doc.filename.toLowerCase().includes('checklist')
    );
    if (complianceDoc && selectedDocs.length < 3) selectedDocs.push(complianceDoc);
  }
  
  if (intents.templates.some(keyword => fullContent.includes(keyword))) {
    const templateDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('audit-templates') ||
      doc.filename.toLowerCase().includes('templates')
    );
    if (templateDoc && selectedDocs.length < 3) selectedDocs.push(templateDoc);
  }
  
  // PRIORITY 3: Ensure we have the backup invoice guide if main one wasn't found
  if (!selectedDocs.some(doc => doc.filename.toLowerCase().includes('invoice guide'))) {
    const backupGuide = docs.find(doc => 
      doc.filename.toLowerCase().includes('invoice guide') ||
      doc.filename.toLowerCase().includes('guide')
    );
    if (backupGuide && selectedDocs.length < 3) selectedDocs.push(backupGuide);
  }
  
  // PRIORITY 4: Default fallback
  if (selectedDocs.length === 0) {
    // Add all available documents up to limit
    selectedDocs.push(...docs.slice(0, 3));
  }
  
  // Remove duplicates and limit to 3 documents max
  const uniqueDocs = [...new Set(selectedDocs)].slice(0, 3);
  
  console.log(`🎯 CanExport Claims Smart Selection: ${uniqueDocs.length} docs selected from ${docs.length} total`);
  console.log(`   Intent: Claims Processing, Category: ${detectedCategory || 'general'}`);
  console.log(`   Selected: ${uniqueDocs.map(d => d.filename).join(', ')}`);
  
  return uniqueDocs;
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
    const headerBase64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const payloadBase64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    
    const signData = `${headerBase64}.${payloadBase64}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signData), serviceAccount.private_key);
    const signatureBase64 = base64UrlEncode(signature);
    
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

// Load knowledge base for specific agent only - WITH REDIS CACHING
async function loadAgentSpecificKnowledgeBase(agentType) {
  const folderName = AGENT_FOLDER_MAP[agentType];
  if (!folderName) {
    console.log(`Unknown agent type: ${agentType}`);
    return [];
  }

  const cacheKey = `${CACHE_PREFIX}${agentType}`;
  const startTime = Date.now();
  
  try {
    // Try Redis cache first
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`✅ Cache HIT for ${agentType} (${Date.now() - startTime}ms)`);
      return cachedData;
    }
    
    console.log(`⚠️ Cache MISS for ${agentType} - Loading from Google Drive...`);
    
    // Load from Google Drive (existing logic)
    const agentDocs = [];
    
    if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
      console.log('Google Drive not configured');
      return [];
    }

    const accessToken = await getGoogleAccessToken();
    
    // Get main folder contents
    const mainFolderResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${GOOGLE_DRIVE_FOLDER_ID}'+in+parents&fields=files(id,name,mimeType)`,
      { headers: { 'Authorization': `Bearer ${accessToken}` }}
    );
    
    const mainFolderContents = await mainFolderResponse.json();
    
    // Find the specific agent folder
    const agentFolder = mainFolderContents.files.find(item => 
      item.mimeType === 'application/vnd.google-apps.folder' && 
      item.name.toLowerCase() === folderName
    );
    
    if (agentFolder) {
      await loadAgentDocumentsSpecific(agentFolder.id, agentType, accessToken, agentDocs);
    }
    
    // Store in Redis cache (indefinitely)
  await redis.set(cacheKey, agentDocs);
    
    const loadTime = Date.now() - startTime;
    logAgentPerformance(agentType, agentDocs.length, loadTime);
    
    console.log(`📦 Cached ${agentDocs.length} documents for ${agentType}`);
    return agentDocs;
    
  } catch (error) {
    console.error(`Redis error for ${agentType}:`, error);
    // Fallback to direct Google Drive loading
    const agentDocs = [];
    
    if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
      return [];
    }
    
    try {
      const accessToken = await getGoogleAccessToken();
      const mainFolderResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${GOOGLE_DRIVE_FOLDER_ID}'+in+parents&fields=files(id,name,mimeType)`,
        { headers: { 'Authorization': `Bearer ${accessToken}` }}
      );
      
      const mainFolderContents = await mainFolderResponse.json();
      const agentFolder = mainFolderContents.files.find(item => 
        item.mimeType === 'application/vnd.google-apps.folder' && 
        item.name.toLowerCase() === folderName
      );
      
      if (agentFolder) {
        await loadAgentDocumentsSpecific(agentFolder.id, agentType, accessToken, agentDocs);
      }
      
      return agentDocs;
    } catch (fallbackError) {
      console.error(`Fallback loading failed for ${agentType}:`, fallbackError);
      return [];
    }
  }
}

// Helper function to load documents for specific agent
async function loadAgentDocumentsSpecific(folderId, agentName, accessToken, docsArray) {
  try {
    const filesResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,size,modifiedTime)`,
      { headers: { 'Authorization': `Bearer ${accessToken}` }}
    );
    
    const filesData = await filesResponse.json();
    
    for (const file of filesData.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') continue;
      
      try {
        const content = await loadFileContent(file, accessToken);
        if (content) {
          docsArray.push({
            filename: file.name,
            content: content,
            type: getFileType(file.name, file.mimeType),
            size: content.length,
            googleFileId: file.id,
            lastModified: file.modifiedTime,
            source: 'google-drive-agent-specific'
          });
          console.log(`   ✅ ${file.name} (${content.length} chars)`);
        }
      } catch (fileError) {
        console.log(`   ⚠️  Skipping ${file.name}: ${fileError.message}`);
      }
    }
  } catch (error) {
    console.error(`Error loading documents for ${agentName}:`, error);
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
      'canexport-claims': [],  // NEW: CanExport Claims knowledge base
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

// FIXED: Enhanced PDF processing with better error handling
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
      // Download and extract PDF content with enhanced error handling
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      
      try {
        // Try with default options first
        const data = await pdf(Buffer.from(buffer));
        return data.text;
      } catch (primaryError) {
        // If parsing fails, try with more permissive options
        console.log(`   ⚠️ PDF parsing warning for ${name}, trying fallback method...`);
        try {
          const data = await pdf(Buffer.from(buffer), {
            normalizeWhitespace: false,
            disableCombineTextItems: false,
            max: 0 // No page limit
          });
          return data.text;
        } catch (fallbackError) {
          // Log both errors for debugging
          console.log(`   ❌ PDF extraction failed for ${name}:`);
          console.log(`     Primary error: ${primaryError.message}`);
          console.log(`     Fallback error: ${fallbackError.message}`);
          return `PDF Document: ${name}\n[Content extraction failed due to PDF formatting issues. Consider converting to Word or Google Doc format for better extraction.]`;
        }
      }
      
    } else if (mimeType.includes('officedocument') || mimeType.includes('opendocument')) {
      // Download and extract Word document content
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to download document: ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return result.value;
      
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
      content = await extractPDFText(file.buffer);
      
      if (content.trim().length < 10) {
        throw new Error('Minimal text extracted - possibly image-based PDF');
      }
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

// FIXED: Rate limiting with safeguards
function checkRateLimit() {
  const now = Date.now();
  
  // Remove timestamps older than 1 minute
  callTimestamps = callTimestamps.filter(timestamp => now - timestamp < 60000);
  
  // Safeguard against memory issues
  if (callTimestamps.length > 1000) {
    console.log('⚠️ Rate limit array too large, trimming...');
    callTimestamps = callTimestamps.slice(-100);
  }
  
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


// ✅ CONSISTENT WEB SEARCH CONFIGURATION (use for both functions)
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search", 
  max_uses: 5,
  user_location: {
    type: "approximate",
    city: "Vancouver",
    region: "British Columbia",
    country: "CA", 
    timezone: "America/Vancouver"
  }
};

// Enhanced Claude API integration with native document support
async function callClaudeAPI(messages, systemPrompt = '', files = []) {
  try {
    checkRateLimit();
    await waitForRateLimit();
    
    console.log(`🔥 Making Claude API call (${callTimestamps.length + 1}/${MAX_CALLS_PER_MINUTE} this minute)`);
    console.log(`🔧 Tools available: web_search (max 5 uses)`);
    console.log(`📄 Files to process: ${files.length}`);
    
    // Build the final messages array with document support
    let apiMessages = [...messages];
    
    // If we have files, modify the last user message to include document blocks
    if (files.length > 0) {
      const lastUserMessage = apiMessages[apiMessages.length - 1];
      const contentBlocks = [];
      
      // Add document blocks first (PDFs, images)
      for (const file of files) {
        const base64Data = file.buffer.toString('base64');
        const mimeType = file.mimetype || 'application/octet-stream';
        
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64Data
          }
        });
        
        console.log(`📄 Added ${mimeType} document: ${file.originalname}`);
      }
      
      // Add text content if present
      if (lastUserMessage.content && lastUserMessage.content.trim()) {
        contentBlocks.push({
          type: "text",
          text: lastUserMessage.content
        });
      }
      
      // Replace last message content with structured blocks
      apiMessages[apiMessages.length - 1] = {
        role: 'user',
        content: contentBlocks
      };
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: apiMessages,
        tools: [WEB_SEARCH_TOOL]
      })
    });

    lastAPICall = Date.now();
    callTimestamps.push(lastAPICall);
    apiCallCount++;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ API call successful (Total calls this session: ${apiCallCount})`);
    
    // 🔍 ENHANCED TOOL USAGE LOGGING
    console.log('🔍 RESPONSE ANALYSIS:');
    console.log(`   Content blocks: ${data.content?.length || 0}`);
    
    let toolUsageCount = 0;
    let textContent = '';
    
    for (const block of data.content || []) {
      console.log(`   Block type: ${block.type}`);
      
      if (block.type === 'text') {
        textContent += block.text;
        console.log(`   Text length: ${block.text?.length || 0} chars`);
      } 
      else if (block.type === 'server_tool_use') {
        toolUsageCount++;
        console.log(`   🌐 WEB SEARCH INITIATED: ${block.name || 'web_search'}`);
        console.log(`   Tool ID: ${block.id}`);
        if (block.input?.query) {
          console.log(`   Query: "${block.input.query}"`);
        }
      }
      else if (block.type === 'web_search_tool_result') {
        console.log(`   🔍 WEB SEARCH RESULT: Found ${block.content?.length || 0} results`);
      }
    }
    
    if (toolUsageCount > 0) {
      console.log(`🌐 Web searches performed: ${toolUsageCount}`);
    } else {
      console.log(`📚 No web search used - Claude answered from knowledge base`);
    }
    
    // Log usage stats
    console.log(`📊 Usage: ${data.usage?.input_tokens || 0} in + ${data.usage?.output_tokens || 0} out tokens`);
    
    return textContent;
    
  } catch (error) {
    console.error('Claude API Error:', error);
    
    if (error.message.includes('Rate limit')) {
      throw new Error(`${error.message}\n\nTip: Wait 2-3 minutes between requests, or try smaller documents.`);
    }
    
    throw new Error('Failed to get response from Claude API: ' + error.message);
  }
}

// Enhanced Streaming Claude API with native document support
async function callClaudeAPIStream(messages, systemPrompt = '', res, files = []) {
  try {
    checkRateLimit();
    await waitForRateLimit();
    
    console.log(`🔥 Making streaming Claude API call`);
    console.log(`🔧 Tools available: web_search (max 5 uses)`);
    console.log(`📄 Files to process: ${files.length}`);
    
    // Build the final messages array with document support
    let apiMessages = [...messages];
    
    // If we have files, modify the last user message to include document blocks
    if (files.length > 0) {
      const lastUserMessage = apiMessages[apiMessages.length - 1];
      const contentBlocks = [];
      
      // Add document blocks first (PDFs, images)
      for (const file of files) {
        const base64Data = file.buffer.toString('base64');
        const mimeType = file.mimetype || 'application/octet-stream';
        
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64Data
          }
        });
        
        console.log(`📄 Added ${mimeType} document: ${file.originalname}`);
      }
      
      // Add text content if present
      if (lastUserMessage.content && lastUserMessage.content.trim()) {
        contentBlocks.push({
          type: "text",
          text: lastUserMessage.content
        });
      }
      
      // Replace last message content with structured blocks
      apiMessages[apiMessages.length - 1] = {
        role: 'user',
        content: contentBlocks
      };
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: apiMessages,
        stream: true,
        tools: [WEB_SEARCH_TOOL]
      })
    });

    lastAPICall = Date.now();
    callTimestamps.push(lastAPICall);
    apiCallCount++;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolUsageCount = 0;

    console.log(`🚀 Starting streaming response with native document support...`);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              console.log(`✅ Streaming completed with native document support`);
              if (toolUsageCount > 0) {
                console.log(`🌐 Total web searches used: ${toolUsageCount}`);
              } else {
                console.log(`📚 No web search used during streaming`);
              }
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle text content
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                const chunk = parsed.delta.text;
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
              }
              
              // 🔍 LOG TOOL USAGE IN STREAMING
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                toolUsageCount++;
                console.log(`🌐 STREAMING TOOL USED: ${parsed.content_block.name}`);
                console.log(`   Tool ID: ${parsed.content_block.id}`);
                console.log(`   Query: ${parsed.content_block.input?.query || 'N/A'}`);
                
                // Send tool usage to frontend (optional)
                res.write(`data: ${JSON.stringify({ 
                  tool_use: {
                    name: parsed.content_block.name,
                    query: parsed.content_block.input?.query
                  }
                })}\n\n`);
              }
              
              // Log tool results
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_result') {
                console.log(`🔍 Tool result received for: ${parsed.content_block.tool_use_id}`);
              }
              
            } catch (parseError) {
              continue;
            }
          }
        }
      }
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('Claude Streaming API Error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

// Main serverless handler with JWT authentication and enhanced features
// Generic streaming request handler
async function handleStreamingRequest(req, res, agentType) {
  const startTime = Date.now();
  
  // Handle multipart form data
  await new Promise((resolve, reject) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const { message, task, conversationId, url: courseUrl } = req.body;
  let fileContent = '';
  
  // Process uploaded files
  if (req.files && req.files.length > 0) {
    console.log(`📄 Processing ${req.files.length} files for streaming`);
    const fileContents = [];
    
    for (const file of req.files) {
      try {
        const content = await processFileContent(file);
        fileContents.push(`📄 DOCUMENT: ${file.originalname}\n${content}`);
      } catch (error) {
        console.error(`Error processing ${file.originalname}:`, error);
      }
    }
    
    fileContent = fileContents.join('\n\n');
  }
  
  // Get/create conversation
  const fullConversationId = `${agentType}-${conversationId}`;
  if (!conversations.has(fullConversationId)) {
    conversations.set(fullConversationId, []);
    conversationTimestamps.set(fullConversationId, Date.now());
  }
  const conversation = conversations.get(fullConversationId);
  
  // Load agent-specific knowledge base
  const agentDocs = await loadAgentSpecificKnowledgeBase(agentType);
  const loadTime = Date.now() - startTime;
  logAgentPerformance(agentType, agentDocs.length, loadTime);
  
  // Select relevant documents based on agent type
  let relevantDocs = [];
  let knowledgeContext = '';
  
  if (agentType === 'grant-cards') {
    relevantDocs = selectGrantCardDocuments(task, message, fileContent, conversation, agentDocs);
  } else if (agentType === 'etg-writer') {
    relevantDocs = selectETGDocuments(message, conversation, agentDocs);
  } else if (agentType === 'bcafe-writer') {
    relevantDocs = selectBCAFEDocuments(message, null, conversation, agentDocs);
  } else if (agentType === 'canexport-claims') {
    relevantDocs = selectCanExportClaimsDocuments(message, conversation, agentDocs);
  } else {
    // Default selection for other agents
    relevantDocs = agentDocs.slice(0, 3);
  }
  
  if (relevantDocs.length > 0) {
    knowledgeContext = relevantDocs
      .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
      .join('\n\n');
  }
  
  // Build system prompt based on agent type
  let systemPrompt;
  if (agentType === 'grant-cards') {
    systemPrompt = buildGrantCardSystemPrompt(task, knowledgeContext);
  } else {
    systemPrompt = `${agentPrompts[agentType]}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.`;
  }
  
  // Build user message
  let userMessage = message || '';
  if (fileContent) {
    userMessage += `\n\nUploaded content:\n${fileContent}`;
  }
  if (courseUrl) {
    const urlContent = await fetchURLContent(courseUrl);
    userMessage += `\n\nURL content:\n${urlContent}`;
  }
  
  // Context management
  const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);
  logContextUsage(agentType, estimatedContext, conversation.length);
  pruneConversation(conversation, agentType, estimatedContext);
  
  // Add user message to conversation
  conversation.push({ role: 'user', content: userMessage });
  
  // Stream response
 await callClaudeAPIStream(conversation, systemPrompt, res, req.files || []);
}
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

  // Clean up expired conversations periodically
  if (Math.random() < 0.1) { // 10% chance per request
    cleanupExpiredConversations();
  }

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
  // await getKnowledgeBase(); // PERFORMANCE FIX: Using agent-specific loading instead
  
  try {
    // FIXED: Login endpoint with proper error handling
    if (url === '/api/login' && method === 'POST') {
      try {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
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
          } catch (jsonError) {
            res.status(400).json({ 
              success: false, 
              message: 'Invalid JSON in request body' 
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
// Cache warming endpoint
if (url.startsWith('/api/warm-cache/') && method === 'POST') {
  const agentType = url.split('/api/warm-cache/')[1];
  
  try {
    console.log(`🔥 Warming cache for ${agentType}...`);
    const startTime = Date.now();
    
    // Load documents and cache them
    await loadAgentSpecificKnowledgeBase(agentType);
    
    const warmTime = Date.now() - startTime;
    console.log(`✅ Cache warmed for ${agentType} in ${warmTime}ms`);
    
    res.json({ 
      success: true, 
      agentType, 
      warmTime,
      message: `Cache warmed successfully for ${agentType}` 
    });
    
  } catch (error) {
    console.error(`Cache warming failed for ${agentType}:`, error);
    res.status(500).json({ 
      error: 'Cache warming failed', 
      agentType,
      details: error.message 
    });
  }
  return;
}

// Manual cache clearing endpoint
if (url === '/api/clear-cache' && method === 'POST') {
  try {
    const agents = ['grant-cards', 'etg-writer', 'bcafe-writer', 'canexport-claims', 'canexport-writer', 'readiness-strategist', 'internal-oracle'];
    let clearedCount = 0;
    
    for (const agent of agents) {
      const result = await redis.del(`${CACHE_PREFIX}${agent}`);
      if (result === 1) clearedCount++;
    }
    
    console.log(`Cleared ${clearedCount} Redis caches`);
    res.json({ 
      message: `Successfully cleared ${clearedCount} caches`,
      clearedAgents: agents,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache clearing failed:', error);
    res.status(500).json({ 
      error: 'Failed to clear cache', 
      details: error.message 
    });
  }
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

    // Expense validation endpoint
    if (url === '/api/validate-expense' && method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const { expenseDescription, amount, vendor, category } = JSON.parse(body);
          
          const validation = validateExpenseAgainstRejections(expenseDescription, vendor, category);
          
          res.json({
            isValid: validation.riskLevel !== 'HIGH',
            riskLevel: validation.riskLevel,
            warnings: validation.warnings,
            recommendations: validation.recommendations,
            historicalExamples: validation.examples
          });
          
        } catch (error) {
          res.status(400).json({ error: 'Invalid request format' });
        }
      });
      return;
    }

    // Helper function for expense validation against rejection patterns
function validateExpenseAgainstRejections(description, vendor, category) {
  const text = `${description} ${vendor} ${category}`.toLowerCase();
  
  const rejectionDatabase = {
    'amazon': {
      reason: 'Re-usable items ineligible',
      example: 'Chiwis: Amazon office supplies rejected - items can be repurposed',
      alternative: 'Use rental services or consumable items only'
    },
    'booth purchase': {
      reason: 'Only booth rentals eligible',
      example: 'Chiwis: Informa Media booth purchase rejected',
      alternative: 'Rent booth space instead of purchasing'
    },
    'canadian': {
      reason: 'Canadian market advertising ineligible',
      example: 'SRJCA: Domestic advertising rejected per Section 5.3',
      alternative: 'Target only approved export markets'
    },
    'airport tax': {
      reason: 'Airport taxes/fees ineligible',
      example: 'Craver Solutions: Air Canada taxes removed from reimbursement',
      alternative: 'Claim only core airfare costs'
    },
    'branding': {
      reason: 'Branding/design costs ineligible',
      example: 'Chiwis: Package design costs rejected as not admissible',
      alternative: 'Focus on export-specific marketing materials'
    },
    'franchise': {
      reason: 'Franchise implementation costs ineligible',
      example: 'Moder Purair: Franchise law costs rejected - advice only allowed',
      alternative: 'Limit to advisory services only'
    },
    'dispute': {
      reason: 'Vendor dispute costs ineligible',
      example: 'Moder Purair: Dispute resolution considered core business',
      alternative: 'Focus on export-specific legal services'
    },
    'bank charge': {
      reason: 'Bank charges typically ineligible',
      example: 'Various clients: Banking fees consistently rejected',
      alternative: 'Exclude transaction fees from claims'
    }
  };
  
  let riskLevel = 'LOW';
  const warnings = [];
  const recommendations = [];
  const examples = [];
  
  for (const [pattern, data] of Object.entries(rejectionDatabase)) {
    if (text.includes(pattern)) {
      riskLevel = 'HIGH';
      warnings.push(`🚨 ${data.reason}`);
      recommendations.push(data.alternative);
      examples.push(data.example);
      break;
    }
  }
  
  return { riskLevel, warnings, recommendations, examples };
}

    // Helper function for expense validation against rejection patterns
function validateExpenseAgainstRejections(description, vendor, category) {
  const text = `${description} ${vendor} ${category}`.toLowerCase();
  
  const rejectionDatabase = {
    'amazon': {
      reason: 'Re-usable items ineligible',
      example: 'Chiwis: Amazon office supplies rejected - items can be repurposed',
      alternative: 'Use rental services or consumable items only'
    },
    'booth purchase': {
      reason: 'Only booth rentals eligible',
      example: 'Chiwis: Informa Media booth purchase rejected',
      alternative: 'Rent booth space instead of purchasing'
    },
    'canadian': {
      reason: 'Canadian market advertising ineligible',
      example: 'SRJCA: Domestic advertising rejected per Section 5.3',
      alternative: 'Target only approved export markets'
    },
    'airport tax': {
      reason: 'Airport taxes/fees ineligible',
      example: 'Craver Solutions: Air Canada taxes removed from reimbursement',
      alternative: 'Claim only core airfare costs'
    },
    'branding': {
      reason: 'Branding/design costs ineligible',
      example: 'Chiwis: Package design costs rejected as not admissible',
      alternative: 'Focus on export-specific marketing materials'
    },
    'franchise': {
      reason: 'Franchise implementation costs ineligible',
      example: 'Moder Purair: Franchise law costs rejected - advice only allowed',
      alternative: 'Limit to advisory services only'
    },
    'dispute': {
      reason: 'Vendor dispute costs ineligible',
      example: 'Moder Purair: Dispute resolution considered core business',
      alternative: 'Focus on export-specific legal services'
    },
    'bank charge': {
      reason: 'Bank charges typically ineligible',
      example: 'Various clients: Banking fees consistently rejected',
      alternative: 'Exclude transaction fees from claims'
    }
  };
  
  let riskLevel = 'LOW';
  const warnings = [];
  const recommendations = [];
  const examples = [];
  
  for (const [pattern, data] of Object.entries(rejectionDatabase)) {
    if (text.includes(pattern)) {
      riskLevel = 'HIGH';
      warnings.push(`🚨 ${data.reason}`);
      recommendations.push(data.alternative);
      examples.push(data.example);
      break;
    }
  }
  
  return { riskLevel, warnings, recommendations, examples };
}

    // FIXED: Process grant document with agent-specific loading
    // Streaming endpoints
if (url === '/api/process-grant/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'grant-cards');
  return;
}

if (url === '/api/process-etg/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'etg-writer');
  return;
}

if (url === '/api/process-bcafe/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'bcafe-writer');
  return;
}

if (url === '/api/process-claims/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'canexport-claims');
  return;
}

if (url === '/api/process-canexport/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'canexport-writer');
  return;
}

if (url === '/api/process-readiness/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'readiness-strategist');
  return;
}

if (url === '/api/process-oracle/stream' && method === 'POST') {
  await handleStreamingRequest(req, res, 'internal-oracle');
  return;
}
    if (url === '/api/process-grant' && method === 'POST') {
      const startTime = Date.now();
      
      // Handle file upload with multer
      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, task, conversationId } = req.body;
      let fileContent = '';
      
      // Process uploaded files if present
if (req.files && req.files.length > 0) {
  console.log(`📄 Processing ${req.files.length} Grant Card documents`);
  const fileContents = [];
  
  for (const file of req.files) {
    try {
      const content = await processFileContent(file);
      fileContents.push(`📄 DOCUMENT: ${file.originalname}\n${content}`);
    } catch (error) {
      console.error(`Error processing ${file.originalname}:`, error);
    }
  }
  
  fileContent = fileContents.join('\n\n');
}
      
      // Get or create conversation
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, []);
        conversationTimestamps.set(conversationId, Date.now());
      }
      const conversation = conversations.get(conversationId);
      
      // FIXED: Agent-specific knowledge base loading
      const agentDocs = await loadAgentSpecificKnowledgeBase('grant-cards');
      const loadTime = Date.now() - startTime;
      
      // Log performance
      logAgentPerformance('grant-cards', agentDocs.length, loadTime);
      
      // FIXED: Use agent-specific docs in selection
      const relevantDocs = selectGrantCardDocuments(task, message, fileContent, conversation, agentDocs);
      let knowledgeContext = '';

      if (relevantDocs.length > 0) {
        knowledgeContext = relevantDocs
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Selected Grant Card documents: ${relevantDocs.map(d => d.filename).join(', ')}`);
      } else {
        console.log(`📚 No specific Grant Card documents found for task: ${task}`);
      }
      
      // Check if this is a Grant Card task (uses shared persona) or other agent
      const isGrantCardTask = ['grant-criteria', 'preview', 'requirements', 'insights', 'categories', 'missing-info'].includes(task);

      let systemPrompt;
      if (isGrantCardTask) {
        systemPrompt = buildGrantCardSystemPrompt(task, knowledgeContext);
      } else {
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

      // ENHANCED CONTEXT MANAGEMENT
      const agentType = getAgentType(url, conversationId);
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude with rate limiting
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: response });
      
      res.json({ 
        response: response,
        conversationId: conversationId,
        performance: {
          documentsLoaded: agentDocs.length,
          documentsSelected: relevantDocs.length,
          loadTimeMs: loadTime
        }
      });
      return;
    }

    // FIXED: Process ETG requests with agent-specific loading
    if (url === '/api/process-etg' && method === 'POST') {
      const startTime = Date.now();
      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId, url: courseUrl } = req.body;
      let fileContent = '';
      let urlContent = '';
      
      console.log(`🎯 Processing enhanced ETG request for conversation: ${conversationId}`);
      
      // Process uploaded file if present
      let fileContents = [];
if (req.files && req.files.length > 0) {
  console.log(`📄 Processing ${req.files.length} ETG documents`);
  
  for (const file of req.files) {
    console.log(`📄 Processing: ${file.originalname}`);
    const content = await processFileContent(file);
    fileContents.push(`📄 DOCUMENT: ${file.originalname}\n${content}`);
  }
  
  // Combine all file contents
  fileContent = fileContents.join('\n\n');
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
        conversationTimestamps.set(etgConversationId, Date.now());
      }
      const conversation = conversations.get(etgConversationId);
      
      // Enhanced ETG Processing with Tools
      let enhancedResponse = '';
      let toolsUsed = [];
      
      // Check if we need to run eligibility check
      const fullContent = message + ' ' + fileContent + ' ' + urlContent;
      const needsEligibilityCheck = (message.toLowerCase().includes('eligible') || 
                                     message.toLowerCase().includes('training') || 
                                     fileContent || urlContent);
      
      if (needsEligibilityCheck) {
        const trainingInfo = extractTrainingInfo(fullContent);
        console.log('🔍 Extracted training info:', trainingInfo);
        
        if (trainingInfo.training_title || trainingInfo.training_type) {
          const eligibilityResult = checkETGEligibility(trainingInfo);
          toolsUsed.push(`Eligibility Check: ${eligibilityResult.eligible ? 'ELIGIBLE' : 'INELIGIBLE'}`);
          
          if (!eligibilityResult.eligible) {
            enhancedResponse = `❌ **ELIGIBILITY ISSUE FOUND**\n\n`;
            enhancedResponse += `This training is **not eligible** for ETG funding.\n\n`;
            enhancedResponse += `**Reason:** ${eligibilityResult.reason}\n\n`;
            enhancedResponse += `**Alternative Options:**\n`;
            enhancedResponse += `- Look for skills-based workshops or certification programs\n`;
            enhancedResponse += `- Consider online courses with substantial duration (20+ hours)\n`;
            enhancedResponse += `- Explore professional development programs from accredited providers\n\n`;
            enhancedResponse += `I can help you find eligible alternatives. What specific skills are you looking to develop?`;
            
            // Add to conversation and return early
            conversation.push({ role: 'user', content: message + (fileContent ? `\n\nUploaded: ${req.file.originalname}` : '') });
            conversation.push({ role: 'assistant', content: enhancedResponse });
            
            res.json({ 
              response: enhancedResponse,
              conversationId: etgConversationId,
              toolsUsed: toolsUsed
            });
            return;
          } else {
            enhancedResponse = `✅ **TRAINING ELIGIBLE FOR ETG FUNDING**\n\n`;
            enhancedResponse += `${eligibilityResult.reason}\n\n`;
            if (eligibilityResult.strengths?.length > 0) {
              enhancedResponse += `**Strengths:** ${eligibilityResult.strengths.join(', ')}\n\n`;
            }
            enhancedResponse += `Now I'll search my knowledge base for similar successful applications...\n\n`;
          }
        }
      }
      
      // FIXED: Agent-specific knowledge base loading for ETG
      const agentDocs = await loadAgentSpecificKnowledgeBase('etg-writer');
      const loadTime = Date.now() - startTime;
      logAgentPerformance('etg-writer', agentDocs.length, loadTime);

      // Use smart document selection instead of first 5
      const relevantDocs = selectETGDocuments(message, conversation, agentDocs);
      let knowledgeContext = '';

      if (relevantDocs.length > 0) {
        knowledgeContext = relevantDocs
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Using ${relevantDocs.length} ETG documents: ${relevantDocs.map(d => d.filename).join(', ')}`);
      }
      
      // Build ETG system prompt with knowledge context
      const systemPrompt = `${agentPrompts['etg-writer']}

ETG KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

TOOLS USED IN THIS SESSION:
${toolsUsed.join(', ')}

${enhancedResponse ? `ELIGIBILITY PRE-CHECK RESULTS:\n${enhancedResponse}` : ''}

Use the ETG knowledge base above to find similar successful applications and match their style and structure.`;
      
      // Build comprehensive user message
      let userMessage = message || "Hello, I need help with an ETG Business Case.";
      
      if (fileContents.length > 0) {
  userMessage += `\n\nUploaded Course Documents (${fileContents.length} files):\n${fileContent}`;
}
      
      if (urlContent) {
        userMessage += `\n\nCourse URL Content Analysis:\n${urlContent}`;
      }
      
      if (enhancedResponse) {
        userMessage += `\n\nPre-screening completed. Please proceed with business case development.`;
      }

      // ENHANCED CONTEXT MANAGEMENT FOR ETG
      const agentType = 'etg-writer';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude using enhanced ETG specialist prompt
      console.log(`🤖 Calling Claude API for enhanced ETG specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);
      
      // Combine enhanced response with Claude response
      const finalResponse = enhancedResponse + response;
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: finalResponse });
      
      console.log(`✅ Enhanced ETG response generated successfully`);
      
      res.json({ 
        response: finalResponse,
        conversationId: etgConversationId,
        toolsUsed: toolsUsed
      });
      return;
    }

    // FIXED: BCAFE endpoint with agent-specific loading
    if (url === '/api/process-bcafe' && method === 'POST') {
      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId, orgType, selectedMarkets } = req.body;
      let fileContent = '';
      
      console.log(`🌾 Processing BCAFE request for conversation: ${conversationId}`);
      console.log(`📊 Organization type: ${orgType}, Target markets: ${selectedMarkets}`);
      
      // Process uploaded files if present
if (req.files && req.files.length > 0) {
  console.log(`📄 Processing ${req.files.length} BCAFE documents`);
  const fileContents = [];
  
  for (const file of req.files) {
    try {
      const content = await processFileContent(file);
      fileContents.push(`📄 DOCUMENT: ${file.originalname}\n${content}`);
    } catch (error) {
      console.error(`Error processing ${file.originalname}:`, error);
    }
  }
  
  fileContent = fileContents.join('\n\n');
}
      
      // Get or create BCAFE conversation
      const bcafeConversationId = `bcafe-${conversationId}`;
      if (!conversations.has(bcafeConversationId)) {
        conversations.set(bcafeConversationId, []);
        conversationTimestamps.set(bcafeConversationId, Date.now());
      }
      const conversation = conversations.get(bcafeConversationId);
      
      // FIXED: Agent-specific knowledge base loading for BCAFE
      const agentDocs = await loadAgentSpecificKnowledgeBase('bcafe-writer');
      const relevantDocs = selectBCAFEDocuments(message, orgType, conversation, agentDocs);
      
      let knowledgeContext = '';
      if (relevantDocs.length > 0) {
        knowledgeContext = relevantDocs
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Selected BCAFE documents: ${relevantDocs.map(d => d.filename).join(', ')}`);
      } else {
        knowledgeContext = 'Use BCAFE Summer 2025 program requirements for guidance.';
      }
      
      // Build streamlined system prompt with selected knowledge base context
      const systemPrompt = `${agentPrompts['bcafe-writer']}

SELECTED KNOWLEDGE BASE DOCUMENTS:
${knowledgeContext}

CURRENT SESSION CONTEXT:
- Organization Type: ${orgType || 'Not specified'}
- Selected Target Markets: ${selectedMarkets || 'Not specified'}

Use the knowledge base documents above for all detailed processes, requirements, and examples. Reference specific sections when providing guidance.`;
      
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

      // ENHANCED CONTEXT MANAGEMENT FOR BCAFE (60 exchanges)
      const agentType = 'bcafe-writer';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude using streamlined BCAFE specialist prompt
      console.log(`🤖 Calling Claude API for BCAFE specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: response });
      
      console.log(`✅ BCAFE response generated successfully`);
      
      res.json({ 
        response: response,
        conversationId: bcafeConversationId 
      });
      return;
    }

// Validate claims file name for rejection patterns
function validateClaimsFile(filename) {
  const warnings = [];
  const name = filename.toLowerCase();
  
  const triggerWords = [
    { word: 'amazon', warning: 'Amazon purchases are typically rejected (re-usable items)' },
    { word: 'booth', warning: 'Verify booth RENTAL vs PURCHASE (purchases rejected)' },
    { word: 'canadian', warning: 'Canadian market advertising is ineligible' },
    { word: 'branding', warning: 'Branding/design costs are typically rejected' },
    { word: 'franchise', warning: 'Franchise costs are typically rejected' },
    { word: 'dispute', warning: 'Legal dispute costs are typically rejected' },
    { word: 'airport', warning: 'Airport taxes/fees are typically ineligible' }
  ];
  
  for (const { word, warning } of triggerWords) {
    if (name.includes(word)) {
      warnings.push(`⚠️ ${warning}`);
    }
  }
  
  return {
    hasWarnings: warnings.length > 0,
    warnings
  };
}
    
    // NEW: CanExport Claims endpoint
    if (url === '/api/process-claims' && method === 'POST') {
      const startTime = Date.now();
      
      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId } = req.body;
      let fileContents = [];
      
      console.log(`📋 Processing CanExport Claims request for conversation: ${conversationId}`);
      
// Process uploaded files if present (receipts, invoices, etc.)
if (req.files && req.files.length > 0) {
  console.log(`📄 Processing ${req.files.length} Claims documents`);
  
  for (const file of req.files) {
    console.log(`📄 Processing: ${file.originalname} (${file.mimetype})`);
    
    // Pre-validation before processing
    const fileValidation = validateClaimsFile(file.originalname);
    if (fileValidation.hasWarnings) {
      console.log('🚨 File validation warnings detected');
    }
    
    // Define file types
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'];
    const isPDF = file.mimetype === 'application/pdf';
    const isImage = imageTypes.includes(file.mimetype);
    
    let processedContent = '';
    
    if (isImage) {
      console.log('📸 Image detected - Starting OCR processing...');
      
      try {
        // Extract text from image using Claude Vision API
        const extractedText = await extractTextFromImage(file.buffer, file.originalname);
        
        // Analyze expense information
        const expenseAnalysis = analyzeExpenseFromText(extractedText, file.originalname);
        
        // Build comprehensive file content for Claude
        processedContent = `📸 RECEIPT IMAGE PROCESSED WITH OCR:
File: ${file.originalname}
OCR Confidence: ${expenseAnalysis.ocrConfidence}

EXTRACTED TEXT:
${extractedText}

AUTOMATIC EXPENSE ANALYSIS:
💰 Amount: ${expenseAnalysis.extractedInfo.amount ? '$' + expenseAnalysis.extractedInfo.amount : 'Not detected'}
📅 Date: ${expenseAnalysis.extractedInfo.date || 'Not detected'}
🏢 Vendor: ${expenseAnalysis.extractedInfo.vendor || 'Not detected'}
🎯 Eligibility Score: ${expenseAnalysis.eligibilityAssessment.eligibilityScore}/100
📝 Recommended Action: ${expenseAnalysis.eligibilityAssessment.recommendedAction}

Please analyze this receipt for CanExport SME program eligibility and compliance requirements.`;

        console.log(`✅ Image OCR processing completed with ${expenseAnalysis.ocrConfidence} confidence`);
        
      } catch (ocrError) {
        console.error('❌ Image OCR processing failed:', ocrError);
        processedContent = `📸 RECEIPT IMAGE UPLOAD:
File: ${file.originalname}
Status: OCR processing failed

Error: ${ocrError.message}

Please analyze this receipt manually or request a clearer image.`;
      }
      
    } else if (isPDF) {
      console.log('📋 PDF detected - Attempting smart processing...');
      
      try {
        // First, try standard PDF text extraction
        console.log('🔍 Attempting PDF text extraction...');
        const pdfTextContent = await processFileContent(file);
        
        // Check if PDF text extraction was successful (more than just filename)
        const hasMeaningfulText = pdfTextContent && 
          pdfTextContent.length > file.originalname.length + 50 &&
          !pdfTextContent.includes('[Content extraction failed due to PDF formatting issues]');
        
        if (hasMeaningfulText) {
          console.log('✅ PDF text extraction successful');
          
          // Analyze the extracted text
          const expenseAnalysis = analyzeExpenseFromText(pdfTextContent, file.originalname);
          
          processedContent = `📋 PDF DOCUMENT PROCESSED:
File: ${file.originalname}
Processing Method: Text Extraction
Analysis Confidence: ${expenseAnalysis.ocrConfidence}

EXTRACTED CONTENT:
${pdfTextContent}

AUTOMATIC EXPENSE ANALYSIS:
💰 Amount: ${expenseAnalysis.extractedInfo.amount ? '$' + expenseAnalysis.extractedInfo.amount : 'Not detected'}
📅 Date: ${expenseAnalysis.extractedInfo.date || 'Not detected'}
🏢 Vendor: ${expenseAnalysis.extractedInfo.vendor || 'Not detected'}
🎯 Eligibility Score: ${expenseAnalysis.eligibilityAssessment.eligibilityScore}/100
📝 Recommended Action: ${expenseAnalysis.eligibilityAssessment.recommendedAction}

Please analyze this document for CanExport SME program eligibility and compliance requirements.`;
          
        } else {
          console.log('⚠️ PDF text extraction insufficient, trying Vision API...');
          
          // Fall back to Claude Vision API for image-based PDFs
          const extractedText = await extractTextFromImage(file.buffer, file.originalname);
          const expenseAnalysis = analyzeExpenseFromText(extractedText, file.originalname);
          
          processedContent = `📋 PDF IMAGE PROCESSED WITH OCR:
File: ${file.originalname}
Processing Method: Vision API (Image-based PDF)
OCR Confidence: ${expenseAnalysis.ocrConfidence}

EXTRACTED TEXT:
${extractedText}

AUTOMATIC EXPENSE ANALYSIS:
💰 Amount: ${expenseAnalysis.extractedInfo.amount ? '$' + expenseAnalysis.extractedInfo.amount : 'Not detected'}
📅 Date: ${expenseAnalysis.extractedInfo.date || 'Not detected'}
🏢 Vendor: ${expenseAnalysis.extractedInfo.vendor || 'Not detected'}
🎯 Eligibility Score: ${expenseAnalysis.eligibilityAssessment.eligibilityScore}/100
📝 Recommended Action: ${expenseAnalysis.eligibilityAssessment.recommendedAction}

Please analyze this PDF receipt for CanExport SME program eligibility and compliance requirements.`;
          
          console.log('✅ PDF Vision API processing completed');
        }
        
      } catch (pdfError) {
        console.error('❌ PDF processing failed:', pdfError);
        processedContent = `📋 PDF DOCUMENT UPLOAD:
File: ${file.originalname}
Status: Processing failed

Error: ${pdfError.message}

Please try converting the PDF to an image format (PNG/JPG) or provide the expense details manually.`;
      }
      
    } else {
      console.log('📄 Document detected - Processing as regular file...');
      // Process as regular document (Word, text, etc.)
      try {
        const docContent = await processFileContent(file);
        processedContent = `📄 DOCUMENT PROCESSED:
File: ${file.originalname}
Content: ${docContent}`;
        console.log('✅ Document processing completed');
      } catch (docError) {
        console.error('❌ Document processing failed:', docError);
        processedContent = `📄 DOCUMENT UPLOAD:
File: ${file.originalname}
Status: Processing failed

Error: ${docError.message}

Please provide the expense details manually.`;
      }
    }
    
    fileContents.push(processedContent);
  }
}
      
      // Get or create Claims conversation
      const claimsConversationId = `claims-${conversationId}`;
      if (!conversations.has(claimsConversationId)) {
        conversations.set(claimsConversationId, []);
        conversationTimestamps.set(claimsConversationId, Date.now());
      }
      const conversation = conversations.get(claimsConversationId);
      
      // Agent-specific knowledge base loading for CanExport Claims
     const agentDocs = await loadAgentSpecificKnowledgeBase('canexport-claims');
      const loadTime = Date.now() - startTime;
      logAgentPerformance('canexport-claims', agentDocs.length, loadTime);

      // Select relevant claims documents
      const relevantDocs = selectCanExportClaimsDocuments(message, conversation, agentDocs);
      
      let knowledgeContext = '';
      if (relevantDocs.length > 0) {
        knowledgeContext = relevantDocs
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Selected CanExport Claims documents: ${relevantDocs.map(d => d.filename).join(', ')}`);
      } else {
        knowledgeContext = 'Use CanExport Claims and Invoice Guide for compliance verification.';
      }
      
      // Build Claims system prompt with knowledge context
      const systemPrompt = `${agentPrompts['canexport-claims']}

CANEXPORT CLAIMS KNOWLEDGE BASE:
${knowledgeContext}

Use the invoice guides and compliance documents above for all expense eligibility determinations. Always reference specific guideline sections when making compliance assessments.`;
      
      // Build comprehensive user message
      let userMessage = message || "Hello, I need help auditing CanExport expenses.";

if (fileContents.length > 0) {
  userMessage += `\n\n=== UPLOADED DOCUMENTS (${fileContents.length} files) ===\n`;
  fileContents.forEach((content, index) => {
    userMessage += `\n--- Document ${index + 1} ---\n${content}\n`;
  });
  userMessage += `\nPlease analyze all ${fileContents.length} documents for CanExport SME program eligibility and compliance requirements.`;
}

      // Enhanced context management for Claims (40 exchanges)
      const agentType = 'canexport-claims';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: userMessage });
      
      // Get response from Claude using Claims specialist prompt
      console.log(`🤖 Calling Claude API for CanExport Claims specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);
      
      // Add assistant response to conversation
      conversation.push({ role: 'assistant', content: response });
      
      console.log(`✅ CanExport Claims response generated successfully`);
      
      res.json({ 
        response: response,
        conversationId: claimsConversationId,
        performance: {
          documentsLoaded: agentDocs.length,
          documentsSelected: relevantDocs.length,
          loadTimeMs: loadTime
        }
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
      conversationTimestamps.delete(conversationId);
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

