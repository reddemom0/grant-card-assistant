// api/server.js - Complete serverless function preserving ALL features
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const path = require('path'); // ADDED: Missing path import

// Configure multer for serverless
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// In-memory storage (consider using database for production persistence)
let conversations = new Map();

// Multi-Agent Knowledge Base Storage (same structure as your original)
let knowledgeBases = {
  'grant-cards': [],
  'etg': [],
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

// NOTE: In serverless, we can't load files from filesystem in the same way
// Knowledge base will need to be handled differently (see deployment notes below)

// Process uploaded file content (identical to your original)
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

// Fetch URL content (identical to your original)
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

// Agent system prompts (COMPLETE - identical to your original)
const agentPrompts = {
  'grant-criteria': `You are a Grant Card Assistant for Granted Consulting. Your task is to generate and format 'Grant Criteria' using the EXACT workflow specified in the knowledge base.

CRITICAL REQUIREMENTS:
1. Identify the grant type from these 6 options: Hiring Grants, Market Expansion/Capital Costs/System and Processes Grants, Training Grants, R&D Grants, Loan Grants, Investment Grants
2. Use ONLY the exact field structures for that grant type
3. Start with: # GRANT CARD: [Grant Name] and **Grant Type:** [One of the 6 types]
4. List each required field as: **[Field Name]:** [All extracted information]
5. Always include ALL required fields for the grant type, even if information is not available - write "Information not available in source material" for empty fields
6. Use individual field names as headers, NOT folder structure
7. Make Program Details the most comprehensive field with all detailed program information`,

  'preview': `You are a Grant Card Assistant for Granted Consulting. Generate a 1-2 sentence preview description that captures the essence of the grant program. Follow the instructions in PREVIEW-SECTION-Generator.md from the knowledge base.`,

  'requirements': `You are a Grant Card Assistant for Granted Consulting. Create a 'General Requirements' section with a 3-sentence maximum summary and a bullet point for turnaround time. Follow the instructions in GENERAL-REQUIREMENTS-Creator.md from the knowledge base.`,

  'insights': `You are a Grant Card Assistant for Granted Consulting. Generate 'Granted Insights' with 3-4 strategic bullet points containing insider knowledge and competitive intelligence. Follow the instructions in GRANTED-INSIGHTS-Generator.md from the knowledge base. Use varied engaging phrases and include specific numbers, percentages, and strategic timing advice.`,

  'categories': `You are a Grant Card Assistant for Granted Consulting. Add 'Categories and Tags' by analyzing the grant and generating comprehensive categories, genres, and program rules for tagging. Follow the instructions in CATEGORIES-TAGS-Classifier.md from the knowledge base.`,

  'missing-info': `You are a Grant Card Assistant for Granted Consulting. Identify missing information by performing field completeness analysis and strategic gap analysis. Follow the instructions in MISSING-INFO-Generator.md from the knowledge base to generate actionable questions for program outreach.`,

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

Always provide comprehensive, helpful responses that leverage the full depth of Granted Consulting's institutional knowledge.`
};

// Search knowledge base function (identical to your original)
function searchKnowledgeBase(query, agent = 'grant-cards') {
  const results = [];
  const searchTerms = query.toLowerCase().split(' ');
  
  // Get the appropriate knowledge base for the agent
  const docs = knowledgeBases[agent] || [];
  
  for (const doc of docs) {
    const content = doc.content.toLowerCase();
    let relevanceScore = 0;
    
    for (const term of searchTerms) {
      const occurrences = (content.match(new RegExp(term, 'g')) || []).length;
      relevanceScore += occurrences;
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

// Rate limiting helper functions (identical to your original)
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

// Claude API integration (identical to your original)
async function callClaudeAPI(messages, systemPrompt = '') {
  try {
    // Check rate limits first
    checkRateLimit();
    
    // Wait for rate limit if needed
    await waitForRateLimit();
    
    console.log(`🔄 Making Claude API call (${callTimestamps.length + 1}/${MAX_CALLS_PER_MINUTE} this minute)`);
    
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

// FIXED: Changed from export default to module.exports
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url, method } = req;
  
  try {
    // Health check endpoint
    if (url === '/api/health') {
      res.json({ 
        status: 'healthy', 
        knowledgeBaseSize: knowledgeBases['grant-cards'].length,
        apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
        apiCallsThisSession: apiCallCount,
        callsLastMinute: callTimestamps.length,
        rateLimitDelay: RATE_LIMIT_DELAY
      });
      return;
    }

    // Process grant document (for Grant Card Assistant) - COMPLETE LOGIC
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
      
      // Build system prompt
      const systemPrompt = `${agentPrompts[task] || agentPrompts['grant-criteria']}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.`;
      
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

    // Process ETG requests (dedicated endpoint for ETG Writer) - COMPLETE LOGIC
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
