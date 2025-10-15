// api/server.js - Complete serverless function with JWT Authentication, Context Management, and Enhanced File Memory
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Initialize Redis client (for file context and knowledge base cache)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  retry: {
    retries: 2,
    backoff: (retryCount) => Math.min(100 * 2 ** retryCount, 1000)
  }
});

// Wrapper to add timeout to Redis operations
async function redisWithTimeout(operation, timeoutMs = 20000) {
  return Promise.race([
    operation,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Redis operation timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Initialize PostgreSQL connection pool (for conversation persistence)
// Ensure connection string has sslmode=require for Neon
const connectionString = (process.env.DATABASE_URL || process.env.POSTGRES_URL);
const finalConnectionString = connectionString?.includes('sslmode=')
  ? connectionString
  : `${connectionString}${connectionString?.includes('?') ? '&' : '?'}sslmode=require`;

console.log(`🔍 Initializing PostgreSQL pool...`);
console.log(`   Connection string format: ${finalConnectionString?.substring(0, 40)}...`);
console.log(`   Has sslmode: ${finalConnectionString?.includes('sslmode=')}`);

const pool = new Pool({
  connectionString: finalConnectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, // Increased for Vercel cold starts
  idleTimeoutMillis: 30000,
  max: 20, // Increased from 10 to 20 for concurrent requests
  query_timeout: 20000, // Increased to 20s for slow Vercel connections
  statement_timeout: 20000
});

// Add pool error handler
pool.on('error', (err) => {
  console.error('❌ Unexpected pool error:', err);
});

pool.on('connect', () => {
  console.log('✅ Pool client connected');
});

pool.on('remove', () => {
  console.log('🔌 Pool client removed');
});

// Helper function to execute queries with explicit timeout
// Uses proper client acquisition/release for serverless compatibility
async function queryWithTimeout(sql, params, timeoutMs = 15000) {
  console.log(`   🔍 queryWithTimeout: Starting query execution...`);
  console.log(`   🔍 Pool state: { totalCount: ${pool.totalCount}, idleCount: ${pool.idleCount}, waitingCount: ${pool.waitingCount} }`);

  let client = null;
  let timedOut = false;

  try {
    // Try pool.query first (simpler, no manual client management)
    console.log(`   🔍 Executing query directly with pool.query()...`);
    const queryPromise = pool.query(sql, params);
    const queryTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`Query timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const result = await Promise.race([queryPromise, queryTimeoutPromise]);
    console.log(`   ✅ Query completed successfully`);
    return result;
  } catch (error) {
    console.error(`   ❌ Query failed:`, error.message);
    throw error;
  }
}

// PDF text extraction (not base64, just text extraction)
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

// Cache configuration
const CACHE_TTL = null; // Indefinite cache - no expiration
const CACHE_PREFIX = 'knowledge-';

// Authentication configuration with JWT
const TEAM_PASSWORD = process.env.TEAM_PASSWORD;
const SESSION_COOKIE_NAME = 'granted_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const JWT_SECRET = process.env.JWT_SECRET || 'temp-jwt-secret-change-immediately-in-production';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ WARNING: Using default JWT secret. Set JWT_SECRET environment variable for production security!');
}

// Optimized conversation limits
const CONVERSATION_LIMITS = {
  'grant-cards': 20,        
  'etg-writer': 20,         
  'bcafe-writer': 60,       
  'canexport-writer': 30,   
  'canexport-claims': 40,   
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

// Conversation cleanup
const CONVERSATION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const conversationTimestamps = new Map();

async function cleanupExpiredConversations() {
  const now = Date.now();
  for (const [id, timestamp] of conversationMetadata.entries()) {
    if (now - timestamp > CONVERSATION_EXPIRY) {
      await deleteConversation(id);
    }
  }
}

// Base64url encoding for older Node.js versions
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

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerBase64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadBase64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));

  const signData = `${headerBase64}.${payloadBase64}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signData).digest();
  const signatureBase64 = base64UrlEncode(signature);

  return `${headerBase64}.${payloadBase64}.${signatureBase64}`;
}

// Generate JWT token with user information (for legacy login and OAuth)
function generateJWTTokenWithUser(userId, email, name = null, picture = null) {
  const payload = {
    userId: userId,
    email: email,
    name: name,
    picture: picture,
    authenticated: true,
    loginTime: Date.now(),
    expires: Date.now() + SESSION_DURATION
  };

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

// Extract user ID from JWT token (for database queries)
function getUserIdFromJWT(req) {
  const cookies = req.headers.cookie || '';
  console.log(`🔍 getUserIdFromJWT - cookies:`, cookies.substring(0, 100));

  const tokenMatch = cookies.match(/granted_session=([^;]+)/);

  if (!tokenMatch) {
    console.log('❌ No JWT token found in cookies');
    return null;
  }

  try {
    const token = tokenMatch[1];
    console.log(`🔍 JWT token found, length: ${token.length}`);

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(`🔍 JWT decoded successfully:`, { userId: decoded.userId, email: decoded.email });

    // The token contains userId (database UUID) from auth-callback.js
    const userId = decoded.userId;

    if (!userId) {
      console.error('❌ JWT token missing userId field. Decoded:', decoded);
      return null;
    }

    console.log(`✅ getUserIdFromJWT returning userId: ${userId}`);
    return userId;
  } catch (error) {
    console.error('❌ getUserIdFromJWT error:', error.message);
    return null;
  }
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.url === '/api/login' || req.url === '/api/health') {
    return next();
  }

  if (!TEAM_PASSWORD) {
    console.warn('⚠️ WARNING: No team password set, allowing all requests');
    return next();
  }

  if (isAuthenticated(req)) {
    return next();
  }

  if (req.url.startsWith('/api/')) {
    res.status(401).json({ 
      error: 'Authentication required',
      redirectTo: '/login.html'
    });
  } else {
    const returnTo = encodeURIComponent(req.url);
    res.writeHead(302, {
      'Location': `/login.html?returnTo=${returnTo}`
    });
    res.end();
  }
}

// Estimate total context size for a request
function estimateContextSize(conversation, knowledgeContext, systemPrompt, currentMessage = '') {
  const convTokens = conversation.length * (TOKENS_PER_EXCHANGE / 2);
  const kbTokens = knowledgeContext.length * TOKENS_PER_CHAR;
  const sysTokens = systemPrompt.length * TOKENS_PER_CHAR;
  const msgTokens = currentMessage.length * TOKENS_PER_CHAR;
  const responseBuffer = 4000;
  
  return Math.ceil(convTokens + kbTokens + sysTokens + msgTokens + responseBuffer);
}

// Complete agent type mapping
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

// Agent folder mapping
const AGENT_FOLDER_MAP = {
  'grant-cards': 'grant-cards',
  'etg-writer': 'etg', 
  'bcafe-writer': 'bcafe',
  'canexport-writer': 'canexport',
  'canexport-claims': 'canexport-claims',
  'readiness-strategist': 'readiness-strategist',
  'internal-oracle': 'internal-oracle'
};

// Get agent type from endpoint or conversation ID
function getAgentType(url, conversationId) {
  for (const [urlPattern, agentType] of Object.entries(AGENT_URL_MAP)) {
    if (url.includes(urlPattern)) {
      return agentType;
    }
  }
  
  if (conversationId?.includes('etg')) return 'etg-writer';
  if (conversationId?.includes('bcafe')) return 'bcafe-writer';
  if (conversationId?.includes('canexport-claims')) return 'canexport-claims';
  if (conversationId?.includes('canexport')) return 'canexport-writer';
  if (conversationId?.includes('readiness')) return 'readiness-strategist';
  if (conversationId?.includes('oracle')) return 'internal-oracle';
  
  return 'grant-cards';
}

// Smart conversation pruning with context awareness
function pruneConversation(conversation, agentType, estimatedContextSize) {
  const limit = CONVERSATION_LIMITS[agentType] || 20;
  
  if (conversation.length > limit * 2) {
    const messagesToKeep = limit * 2;
    const removed = conversation.length - messagesToKeep;
    conversation.splice(0, removed);
    console.log(`🗂️ Standard pruning: Removed ${removed} messages, keeping last ${messagesToKeep}`);
  }
  
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

/**
 * Strip thinking process from response text
 * Claude outputs thinking as numbered steps 1-5, followed by blank lines, then the answer
 * @param {string} text - The full response text
 * @returns {string} - Text with thinking process removed
 */
/**
 * Extract text content from Claude response
 * Handles both string responses and content block arrays (with tool use)
 * @param {string|Array} response - Response from Claude API
 * @returns {string} - Extracted text content for display
 */
function extractTextFromResponse(response) {
  // If it's already a string, return as-is
  if (typeof response === 'string') {
    return response;
  }

  // If it's an array of content blocks, extract text from text blocks only
  if (Array.isArray(response)) {
    let textContent = '';
    for (const block of response) {
      if (block.type === 'text') {
        textContent += block.text;
      }
      // Note: We intentionally skip tool_use, tool_result, and thinking blocks
      // as they shouldn't be displayed to the user
    }
    return textContent;
  }

  // Fallback: convert to string
  return String(response);
}

function stripThinkingTags(text) {
  // Handle both string and content block array inputs
  const textContent = extractTextFromResponse(text);

  // Pattern 1: Remove everything up to and including "Required Action Decision:" and its content until double newline
  const pattern1 = /^[\s\S]*?5\.\s*Required Action Decision:[\s\S]*?\n\n+/;
  let cleaned = textContent.replace(pattern1, '');

  // Pattern 2: Also try XML tags in case Claude starts using them
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>\s*/gi, '');

  return cleaned.trim();
}

// ===== FILE MANAGEMENT SYSTEM =====

// Get conversation file context (from Redis)
async function getConversationFileContext(conversationId) {
  let data = null;
  try {
    data = await redis.get(`conv-meta:${conversationId}`);
    if (!data) {
      console.log(`📭 No file metadata found for ${conversationId}`);
      return {
        uploadedFiles: [],
        lastUploadTimestamp: null
      };
    }

    // Upstash Redis auto-deserializes JSON, so data is already an object
    // Validate structure
    if (typeof data !== 'object' || !Array.isArray(data.uploadedFiles)) {
      console.error(`❌ Invalid file metadata structure for ${conversationId}`);
      console.error(`❌ Data:`, JSON.stringify(data).substring(0, 200));
      console.log(`🔄 Deleting invalid metadata and starting fresh...`);
      await redis.del(`conv-meta:${conversationId}`);
      return {
        uploadedFiles: [],
        lastUploadTimestamp: null
      };
    }

    console.log(`✅ Loaded file metadata for ${conversationId}: ${data.uploadedFiles?.length || 0} files`);
    return data;
  } catch (error) {
    console.error(`❌ Error loading conversation metadata ${conversationId}:`, error);
    if (data) {
      console.error(`❌ Data type:`, typeof data, `Value:`, JSON.stringify(data).substring(0, 200));
    }
    console.log(`🔄 Deleting corrupted metadata and starting fresh...`);
    await redis.del(`conv-meta:${conversationId}`).catch(e => console.error('Failed to delete:', e));
    return {
      uploadedFiles: [],
      lastUploadTimestamp: null
    };
  }
}

// Update conversation file context (save to Redis)
async function updateConversationFileContext(conversationId, uploadResults) {
  let conversationMeta = await getConversationFileContext(conversationId);

  console.log('🔍 updateConversationFileContext - Input uploadResults:', JSON.stringify(uploadResults, null, 2));

  for (const uploadResult of uploadResults) {
    // Ensure uploadResult is a plain object, not a complex type
    const fileInfo = {
      filename: String(uploadResult.originalname || 'unknown'),
      file_id: String(uploadResult.file_id || ''),
      uploadTimestamp: Date.now(),
      mimetype: String(uploadResult.mimetype || ''),
      isImage: uploadResult.mimetype && String(uploadResult.mimetype).startsWith('image/')
    };
    console.log('🔍 Adding fileInfo:', JSON.stringify(fileInfo));
    conversationMeta.uploadedFiles.push(fileInfo);
  }

  conversationMeta.lastUploadTimestamp = Date.now();

  // Save to Redis with validation
  try {
    // Validate JSON serializability using safeStringify
    const jsonString = safeStringify(conversationMeta, `conversationMeta ${conversationId}`);

    console.log('🔍 Saving conversationMeta to Redis:', jsonString.substring(0, 200) + '...');

    await redis.set(`conv-meta:${conversationId}`, jsonString, {
      ex: 24 * 60 * 60 // 24 hour expiry
    });
    console.log(`💾 Saved file metadata for ${conversationId} to Redis (${conversationMeta.uploadedFiles.length} files)`);
  } catch (error) {
    console.error(`❌ Error saving conversation metadata ${conversationId}:`, error);
    console.error('❌ Failed conversationMeta:', JSON.stringify(conversationMeta, null, 2));
  }

  return conversationMeta;
}

// Build message content with persistent file memory
function buildMessageContentWithFiles(message, conversationMeta) {
  console.log('🔍 buildMessageContentWithFiles DEBUG:', { 
    message: message ? message.substring(0, 100) : 'empty', 
    hasFiles: conversationMeta.uploadedFiles.length 
  });
  
  const contentBlocks = [];
  
  // Add text content first
  if (message && message.trim()) {
    let textContent = message;
    
    // Add context about available files
    if (conversationMeta.uploadedFiles.length > 0) {
      textContent += `\n\n=== PREVIOUSLY UPLOADED DOCUMENTS (${conversationMeta.uploadedFiles.length} files) ===\n`;
      textContent += conversationMeta.uploadedFiles.map((f, i) => 
        `${i + 1}. ${f.filename} (uploaded ${new Date(f.uploadTimestamp).toLocaleString()})`
      ).join('\n');
      textContent += '\n\n[Note: Full document content is available for reference in the attached files below.]';
    }
    
    contentBlocks.push({
      type: "text",
      text: textContent
    });
  }
  
  // Add each file as a separate content block using file_id
  for (const fileInfo of conversationMeta.uploadedFiles) {
    if (fileInfo.isImage) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "file",
          file_id: fileInfo.file_id
        }
      });
    } else {
      contentBlocks.push({
        type: "document",
        source: {
          type: "file",
          file_id: fileInfo.file_id
        },
        title: fileInfo.filename
      });
    }
  }
  
  return contentBlocks;
}

// Build system prompt with file context
function buildSystemPromptWithFileContext(baseSystemPrompt, knowledgeContext, conversationMeta, agentType) {
  return `${baseSystemPrompt}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

CONVERSATION FILE CONTEXT:
${conversationMeta.uploadedFiles.length > 0 ? `
Previously uploaded documents (${conversationMeta.uploadedFiles.length} files):
${conversationMeta.uploadedFiles.map((f, i) => `${i + 1}. ${f.filename} (file_id: ${f.file_id})`).join('\n')}

CRITICAL: These documents are available as document blocks in the user's message. Reference them directly when answering questions. Do NOT ask for documents to be uploaded again.
` : 'No documents uploaded yet.'}

Always reference uploaded documents when relevant to the user's questions.`;
}

// Configure multer for serverless
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
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

// Redis-based conversation persistence (replaced in-memory Map)
// Conversation metadata tracking (timestamps only)
const conversationMetadata = new Map();

// Helper function to safely stringify objects and detect corruption
function safeStringify(obj, label = 'object') {
  try {
    const str = JSON.stringify(obj);
    if (str.includes('[object Object]')) {
      console.error(`❌ JSON corruption detected in ${label}:`, str.substring(0, 500));
      // Try to find the corrupted property
      const findCorruption = (o, path = '') => {
        for (const key in o) {
          if (o.hasOwnProperty(key)) {
            const val = o[key];
            const currentPath = path ? `${path}.${key}` : key;
            if (typeof val === 'object' && val !== null) {
              if (val.toString() === '[object Object]') {
                console.error(`❌ Found corruption at: ${currentPath}`, val);
              }
              findCorruption(val, currentPath);
            }
          }
        }
      };
      findCorruption(obj);
      throw new Error(`JSON corruption detected in ${label}`);
    }
    return str;
  } catch (error) {
    console.error(`❌ Failed to stringify ${label}:`, error);
    throw error;
  }
}

// Hybrid persistence: Redis for active conversations, PostgreSQL for long-term storage
// Load conversation messages from Redis (fast, for active conversations)
// Helper function to normalize message content for frontend display
function normalizeMessageContent(message) {
  const normalized = { ...message };

  let content = message.content;

  // If content is a string that looks like JSON, try to parse it
  if (typeof content === 'string') {
    // Check if it's a JSON array string (starts with '[')
    if (content.trim().startsWith('[')) {
      try {
        content = JSON.parse(content);
        console.log(`🔄 Parsed JSON string content for ${message.role} message`);
      } catch (e) {
        // Not JSON, treat as plain text
        console.log(`📝 Content is plain text for ${message.role} message`);
      }
    }
  }

  // If content is an array (Claude API format), extract text
  if (Array.isArray(content)) {
    let textContent = '';
    content.forEach(block => {
      if (block.type === 'text' && block.text) {
        textContent += block.text;
      }
      // Skip thinking blocks and other non-text content
    });
    normalized.content = textContent;
    console.log(`✅ Extracted text from array content (${textContent.length} chars)`);
  }
  // If content is already a plain string, return as-is
  else if (typeof content === 'string') {
    normalized.content = content;
  }

  return normalized;
}

async function getConversation(conversationId, userId) {
  let data = null;
  try {
    // Try Redis first (active conversations)
    data = await redis.get(`conv:${conversationId}`);
    if (data && Array.isArray(data)) {
      console.log(`✅ Loaded conversation from Redis ${conversationId}: ${data.length} messages`);
      // Normalize content for frontend
      return data.map(normalizeMessageContent);
    }

    // Fallback to PostgreSQL (archived conversations)
    console.log(`📭 No Redis data, trying PostgreSQL for ${conversationId}...`);
    const convCheck = await queryWithTimeout(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      console.log(`📭 No conversation found in database for ${conversationId}`);
      return [];
    }

    const result = await queryWithTimeout(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    console.log(`✅ Loaded conversation from PostgreSQL ${conversationId}: ${result.rows.length} messages`);

    // Normalize content for frontend
    const normalizedMessages = result.rows.map(normalizeMessageContent);

    // Restore to Redis for faster subsequent access
    if (normalizedMessages.length > 0) {
      await redis.set(`conv:${conversationId}`, normalizedMessages, { ex: 86400 }); // 24 hour TTL
      console.log(`✅ Restored conversation to Redis`);
    }

    return normalizedMessages;
  } catch (error) {
    console.error(`❌ Error loading conversation ${conversationId}:`, error);

    // If we have Redis data but it's invalid, clean it up
    if (data) {
      console.log(`🔄 Deleting invalid Redis data for ${conversationId}`);
      await redis.del(`conv:${conversationId}`).catch(e => console.error('Failed to delete:', e));
    }

    return [];
  }
}

// Hybrid save: Redis (immediate) + PostgreSQL (background persistence)
async function saveConversation(conversationId, userId, conversation, agentType) {
  console.log(`\n========== saveConversation START ==========`);
  console.log(`   conversationId: ${conversationId} (type: ${typeof conversationId})`);
  console.log(`   userId: ${userId} (type: ${typeof userId})`);
  console.log(`   agentType: ${agentType} (type: ${typeof agentType})`);
  console.log(`   conversation.length: ${conversation.length}`);

  // ALWAYS save to Redis first (fast, reliable)
  try {
    console.log(`🔵 DEBUG: Saving conversation to Redis (no ping test)...`);

    // Save conversation messages with timeout
    const convDataSize = JSON.stringify(conversation).length;
    console.log(`🔵 DEBUG: Conversation data size: ${convDataSize} bytes`);

    const saveStart = Date.now();
    await redisWithTimeout(
      redis.set(`conv:${conversationId}`, JSON.stringify(conversation), { ex: 86400 }),
      10000  // Increased to 10 seconds
    );
    console.log(`✅ Conversation saved to Redis in ${Date.now() - saveStart}ms (${conversation.length} messages)`);

    console.log(`🔵 DEBUG: Saving metadata to Redis...`);
    // Save conversation metadata (including agent_type for filtering)
    const metadata = {
      id: conversationId,
      userId: userId,
      agentType: agentType,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const metaStart = Date.now();
    await redisWithTimeout(
      redis.set(`conv:${conversationId}:meta`, JSON.stringify(metadata), { ex: 86400 }),
      10000  // Increased to 10 seconds
    );
    console.log(`✅ Metadata saved to Redis in ${Date.now() - metaStart}ms (agent: ${agentType})`);

    console.log(`✅ All Redis saves completed successfully (conversation + metadata)`);
  } catch (redisError) {
    console.error(`❌ Redis save FAILED:`, redisError);
    console.error(`❌ Redis error message:`, redisError.message);
    console.error(`❌ Redis error stack:`, redisError.stack);
    // Continue to try PostgreSQL even if Redis fails
  }

  // SYNCHRONOUS PostgreSQL save for new conversations (so they appear in sidebar immediately)
  try {
    console.log(`\n🗄️  Checking if conversation exists in PostgreSQL...`);
    const convCheck = await queryWithTimeout(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId],
      15000  // 15s timeout
    );

    if (convCheck.rows.length === 0) {
      console.log(`\n🔍 STEP 2: Creating new conversation`);

      // Generate title from first user message
      let title = 'New Conversation';
      const firstUserMsg = conversation.find(m => m.role === 'user');
      if (firstUserMsg) {
        let content = '';

        // Extract text from content (handle both string and array formats)
        if (typeof firstUserMsg.content === 'string') {
          content = firstUserMsg.content;
        } else if (Array.isArray(firstUserMsg.content)) {
          // Extract text blocks only (skip thinking blocks)
          firstUserMsg.content.forEach(block => {
            if (block.type === 'text' && block.text) {
              content += block.text;
            }
          });
        } else if (typeof firstUserMsg.content === 'object' && firstUserMsg.content.text) {
          // Handle single text object
          content = firstUserMsg.content.text;
        }

        // Clean up and truncate
        if (content) {
          title = content.trim().substring(0, 100);
        }
      }

      console.log(`   Title: "${title.substring(0, 50)}..."`);
      console.log(`   SQL: INSERT INTO conversations (id, user_id, agent_type, title) VALUES ($1, $2, $3, $4) RETURNING *`);
      console.log(`   Params: [${conversationId}, ${userId}, ${agentType}, "${title.substring(0, 30)}..."]`);

      try {
        console.log(`   Executing INSERT with 15 second timeout...`);
        const insertResult = await queryWithTimeout(
          'INSERT INTO conversations (id, user_id, agent_type, title) VALUES ($1, $2, $3, $4) RETURNING *',
          [conversationId, userId, agentType, title],
          15000
        );
        console.log(`✅ Conversation created successfully`);
        console.log(`   Created record:`, insertResult.rows[0]);
      } catch (insertError) {
        console.error(`❌ Conversation insert FAILED:`, insertError);
        console.error(`   Error details:`, {
          name: insertError.name,
          message: insertError.message,
          code: insertError.code,
          detail: insertError.detail,
          hint: insertError.hint,
          constraint: insertError.constraint,
          stack: insertError.stack
        });
        throw insertError;
      }
    } else {
      console.log(`✅ Conversation already exists, skipping creation`);
    }

    // Count existing messages
    console.log(`\n🔍 STEP 3: Counting existing messages`);
    console.log(`   SQL: SELECT COUNT(*) FROM messages WHERE conversation_id = $1`);
    console.log(`   Params: [${conversationId}]`);

    let countResult;
    try {
      console.log(`   Executing COUNT with 15 second timeout...`);
      countResult = await queryWithTimeout(
        'SELECT COUNT(*) FROM messages WHERE conversation_id = $1',
        [conversationId],
        15000
      );
      const existingCount = parseInt(countResult.rows[0].count);
      console.log(`✅ Message count query completed: ${existingCount} existing messages`);

      // Save new messages
      const newMessages = conversation.slice(existingCount);
      console.log(`\n🔍 STEP 4: Saving new messages`);
      console.log(`   Total conversation messages: ${conversation.length}`);
      console.log(`   Existing messages: ${existingCount}`);
      console.log(`   New messages to save: ${newMessages.length}`);

      if (newMessages.length > 0) {
        for (let i = 0; i < newMessages.length; i++) {
          const msg = newMessages[i];

          console.log(`\n   Message ${i + 1}/${newMessages.length}:`);
          console.log(`     Role: ${msg.role}`);
          console.log(`     Content type: ${typeof msg.content}`);
          console.log(`     Content is array: ${Array.isArray(msg.content)}`);

          // Serialize content
          let content;
          try {
            if (typeof msg.content === 'string') {
              content = msg.content;
              console.log(`     Content is string, length: ${content.length}`);
            } else {
              console.log(`     Serializing content object/array...`);
              content = JSON.stringify(msg.content);
              console.log(`     Serialized to ${content.length} chars`);
              console.log(`     First 200 chars: ${content.substring(0, 200)}`);
            }
          } catch (serializeError) {
            console.error(`     ❌ Failed to serialize content:`, serializeError);
            throw serializeError;
          }

          console.log(`     Preparing INSERT query...`);
          console.log(`     conversationId: ${conversationId}`);
          console.log(`     role: ${msg.role}`);
          console.log(`     content length: ${content.length} bytes`);

          try {
            console.log(`     Executing INSERT with 15 second timeout...`);
            const msgResult = await queryWithTimeout(
              'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id',
              [conversationId, msg.role, content],
              15000
            );
            console.log(`     ✅ Message inserted with id: ${msgResult.rows[0].id}`);
          } catch (msgError) {
            console.error(`     ❌ Message insert FAILED:`, msgError);
            console.error(`     Error details:`, {
              name: msgError.name,
              message: msgError.message,
              code: msgError.code,
              detail: msgError.detail,
              hint: msgError.hint,
              constraint: msgError.constraint,
              contentLength: content?.length,
              stack: msgError.stack
            });
            console.error(`     Content preview (first 500 chars):`, content?.substring(0, 500));
            throw msgError;
          }
        }
        console.log(`\n💾 Successfully saved ${newMessages.length} new messages`);
      } else {
        console.log(`   No new messages to save`);
      }
    } catch (countError) {
      console.error(`❌ Message count query FAILED:`, countError);
      console.error(`   Error details:`, {
        name: countError.name,
        message: countError.message,
        code: countError.code,
        stack: countError.stack
      });
      throw countError;
    }

    // Update timestamp
    console.log(`\n🔍 STEP 5: Updating conversation timestamp`);
    console.log(`   SQL: UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`);
    console.log(`   Params: [${conversationId}, ${userId}]`);

    try {
      console.log(`   Executing UPDATE with 15 second timeout...`);
      await queryWithTimeout(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2',
        [conversationId, userId],
        15000
      );
      console.log(`✅ Timestamp updated`);
    } catch (updateError) {
      console.error(`❌ Timestamp update FAILED:`, updateError);
      console.error(`   Error details:`, {
        name: updateError.name,
        message: updateError.message,
        code: updateError.code,
        stack: updateError.stack
      });
      throw updateError;
    }

    // Smart title generation removed - was causing PostgreSQL timeouts

    console.log(`\n========== PostgreSQL save SUCCESS ==========\n`);

  } catch (error) {
    console.error(`\n========== PostgreSQL save FAILED ==========`);
    console.error(`❌ PostgreSQL save error:`, error.message);
    console.error(`❌ Error type: ${error.constructor.name}`);
    console.error(`❌ Error code: ${error.code}`);
    console.error(`⚠️  Conversation saved in Redis but not PostgreSQL - sidebar won't show it`);
    console.error(`========== PostgreSQL END ==========\n`);
    // Don't throw - Redis save succeeded, user can still chat
  }

  console.log(`\n========== saveConversation SUCCESS (Redis + PostgreSQL) ==========\n`);
}

// generateConversationTitle function removed - was causing PostgreSQL timeouts

// Delete conversation from PostgreSQL database
async function deleteConversation(conversationId, userId) {
  try {
    // Verify conversation belongs to user before deleting
    const result = await pool.query(
      'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
      [conversationId, userId]
    );

    if (result.rowCount > 0) {
      console.log(`🗑️ Deleted conversation ${conversationId} from database`);
    } else {
      console.log(`⚠️ No conversation found to delete: ${conversationId}`);
    }
  } catch (error) {
    console.error(`❌ Error deleting conversation ${conversationId}:`, error);
  }
}

// Multi-Agent Knowledge Base Storage
let knowledgeBases = {
  'grant-cards': [],
  'etg': [],
  'bcafe': [],
  'canexport': [],
  'canexport-claims': [],
  'readiness-strategist': [],
  'internal-oracle': []
};

// Rate limiting variables
let lastAPICall = 0;
const RATE_LIMIT_DELAY = 3000; // 3 seconds between API calls
let apiCallCount = 0;
const MAX_CALLS_PER_MINUTE = 15;
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

// Get knowledge base for specific agent only
async function getAgentKnowledgeBase(agentType) {
  const folderName = AGENT_FOLDER_MAP[agentType];
  if (!folderName) {
    console.log(`⚠️ Unknown agent type: ${agentType}, falling back to grant-cards`);
    return knowledgeBases['grant-cards'] || [];
  }
  
  const cacheKey = `agent-${agentType}`;
  const now = Date.now();
  const lastCached = agentCacheTimestamps.get(cacheKey) || 0;
  
  if (agentKnowledgeCache.has(cacheKey) && 
      (now - lastCached < CACHE_DURATION)) {
    console.log(`🎯 Using cached knowledge base for ${agentType} (${agentKnowledgeCache.get(cacheKey).length} docs)`);
    return agentKnowledgeCache.get(cacheKey);
  }
  
  const agentDocs = knowledgeBases[folderName] || [];
  
  console.log(`📚 Loaded ${agentDocs.length} documents for agent: ${agentType} (folder: ${folderName})`);
  
  agentKnowledgeCache.set(cacheKey, agentDocs);
  agentCacheTimestamps.set(cacheKey, now);
  
  return agentDocs;
}

// ETG Eligibility Checker Function
function checkETGEligibility(trainingData) {
    const { training_title = '', training_type = '', training_content = '', training_duration = '' } = trainingData;
    
    const title = training_title.toLowerCase();
    const type = training_type.toLowerCase();
    const content = training_content.toLowerCase();
    
    const ineligibleKeywords = [
        'seminar', 'conference', 'coaching', 'consulting', 'mentorship',
        'trade show', 'networking', 'annual meeting', 'practicum',
        'diploma', 'degree', 'bachelor', 'master', 'phd'
    ];
    
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
    
    const eligibleIndicators = [
        'certification', 'certificate', 'course', 'training program', 
        'workshop', 'skills development', 'professional development'
    ];
    
    const foundEligible = eligibleIndicators.find(indicator =>
        title.includes(indicator) || type.includes(indicator) || content.includes(indicator)
    );
    
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
    
    if (!trainingInfo.training_title) {
        const titleMatch = text.match(/(?:training|course|program).*?(?:title|name)[:\s]+([^.\n]+)/i);
        if (titleMatch) trainingInfo.training_title = titleMatch[1].trim();
    }
    
    return trainingInfo;
}

// ============================================================================
// GRANT CARD AGENT SYSTEM PROMPT - IMPROVED WITH XML STRUCTURE
// Following Anthropic's best practices for XML tags, role prompting, and clarity
// ============================================================================

// MEMORY TOOL INSTRUCTIONS - Currently disabled
// TODO: Re-enable when serverful platform with backend database is implemented
// const MEMORY_TOOL_INSTRUCTIONS = `...`;
const MEMORY_TOOL_INSTRUCTIONS = ``;

// ENHANCED ROLE DEFINITION WITH CONTEXT AND SUCCESS CRITERIA
const GRANT_CARD_SYSTEM_PROMPT = `<role>
You are a Senior Grant Intelligence Analyst at Granted Consulting with 10+ years of experience processing government and private sector funding programs. Your grant cards are published on the GetGranted platform and serve as the primary decision-making tool for thousands of small businesses and non-profits evaluating funding opportunities.

You transform complex, jargon-heavy grant documentation into clear, structured grant cards that help applicants quickly assess funding fit and take immediate action.
</role>

${MEMORY_TOOL_INSTRUCTIONS}

<context>
  <purpose>Your grant cards are published on the GetGranted platform where they serve as the first touchpoint for grant applicants evaluating funding opportunities</purpose>
  <audience>Small business owners, entrepreneurs, non-profit leaders, and consultants who need to quickly assess grant eligibility and requirements</audience>
  <workflow_position>This is the first step in Granted's grant publication process. Your output becomes the authoritative source for all downstream activities (application support, consulting, client matching)</workflow_position>
  <success_definition>A successful grant card enables an applicant to make an informed go/no-go decision within 2-3 minutes of reading. It must be comprehensive, accurate, and actionable.</success_definition>
</context>

<expertise>
  <skill>Systematic methodology execution for transforming complex funding documents into structured grant cards</skill>
  <skill>Grant type identification using Granted's 6-category classification system</skill>
  <skill>Pattern recognition for grant program structures, hidden requirements, and strategic opportunities</skill>
  <skill>Document analysis for missing information and strategic funding insights that maximize approval likelihood</skill>
</expertise>

<approach>
  <principle>Work comprehensively with all available information - read entire documents before extracting</principle>
  <principle>Always follow established, proven format and structure guidelines from knowledge base documents</principle>
  <principle>Leverage knowledge base documents to inform decisions and ensure consistency across all grant cards</principle>
  <principle>Extract information verbatim from source material - never interpret, assume, or fabricate details</principle>
  <principle>When information is missing, explicitly mark it as unavailable rather than guessing</principle>
</approach>

<communication_style>
  <tone>Spartan and direct - no marketing fluff, hedging language, or unnecessary elaboration</tone>
  <focus>Action-oriented on grant card workflow execution</focus>
  <flexibility>Can answer general user questions related to the grant card process, but primary focus is output generation</flexibility>
</communication_style>

<knowledge_base_mastery>
You have complete familiarity with all Granted Consulting workflow documents. You reference the appropriate methodology document for each task type and follow its instructions exactly. When knowledge base instructions conflict with general guidance, the knowledge base always takes precedence.
</knowledge_base_mastery>`;

// WORKFLOW CONTEXT
const WORKFLOW_CONTEXT = `<workflow_context>
  <process_position>First step in Granted's grant publication workflow</process_position>
  <input_source>Grant program documentation from government agencies, private foundations, and corporate funders</input_source>
  <output_destination>GetGranted platform for public access by grant seekers</output_destination>
  <downstream_impact>
    <impact>Applicants use your grant cards to make go/no-go decisions on funding opportunities</impact>
    <impact>Grant consultants use your cards as the foundation for application strategy development</impact>
    <impact>Your categorization enables database searchability and smart matching with applicants</impact>
  </downstream_impact>
  <quality_stakes>Errors or omissions in your grant cards can cause applicants to miss opportunities or waste time on ineligible programs</quality_stakes>
</workflow_context>`;

// GRANT TYPE CLASSIFICATION REFERENCE
const GRANT_TYPE_CLASSIFICATION = `<grant_types>
  <type id="1" name="Hiring Grants">
    <indicators>wage subsidies, job creation, employment programs, workforce development, internship funding, apprenticeship support</indicators>
  </type>
  <type id="2" name="Market Expansion/Capital Costs/Systems and Processes Grants">
    <indicators>equipment purchases, infrastructure development, facility expansion, systems implementation, technology adoption, process improvement</indicators>
  </type>
  <type id="3" name="Training Grants">
    <indicators>skills development, professional development, certification programs, employee training, upskilling initiatives</indicators>
  </type>
  <type id="4" name="R&D Grants">
    <indicators>research projects, innovation initiatives, product development, technology advancement, prototype development, commercialization</indicators>
  </type>
  <type id="5" name="Loan Grants">
    <indicators>interest-free loans, forgivable loans, loan guarantees, financing assistance, working capital support</indicators>
  </type>
  <type id="6" name="Investment Grants">
    <indicators>equity investment, venture capital, investment matching programs, angel funding, growth capital</indicators>
  </type>
</grant_types>`;

// UNIVERSAL OUTPUT PHILOSOPHY - CRITICAL FOR ALL TASKS
const OUTPUT_PHILOSOPHY = `<output_philosophy priority="CRITICAL">
  <purpose>Grant Cards are DECISION-MAKING TOOLS, not comprehensive documentation</purpose>
  <user_context>Users scan grant cards in 60-90 seconds to determine fit before reading source documents</user_context>
  <design_principle>Extract CRITICAL information only - strategic highlights that enable go/no-go decisions, not exhaustive detail</design_principle>

  <universal_constraints>
    <constraint type="length">
      - Total grant card output: 800-1200 words maximum (NOT 2000+ words)
      - Individual fields: 50-200 words depending on field complexity
      - Sentences: Clear, direct, active voice - maximum 20-25 words per sentence
      - Paragraphs: Maximum 2-3 sentences each
    </constraint>

    <constraint type="format">
      - Use bullet points for lists (NOT dense paragraphs)
      - Maximum 2-3 sentences per paragraph block
      - White space between sections for scannability
      - Bold key terms sparingly for emphasis
    </constraint>

    <constraint type="content">
      - Include MOST IMPORTANT details only - not everything available
      - Omit redundant information that repeats across fields
      - Avoid repetition - each field has unique purpose
      - No exhaustive lists - show representative examples with "e.g."
      - Prioritize: Must-know > Nice-to-know > Can-look-up-later
    </constraint>
  </universal_constraints>

  <scannability_test>
    After writing each field, ask: "Can a user understand the key point in 5-10 seconds?"
    If no, the field is too long or poorly formatted. Revise before outputting.
  </scannability_test>

  <remember>
    Users have access to the FULL source document if they need more detail.
    Your job is to extract the ESSENCE, not document EVERYTHING.
  </remember>
</output_philosophy>`;

// FIELD LENGTH LIMITS FOR GRANT-CRITERIA TASK
const FIELD_LENGTH_LIMITS = `<field_length_limits priority="CRITICAL">
  <field name="Program Name">1 line</field>
  <field name="Funder">1 line</field>
  <field name="Amount">1-2 lines</field>
  <field name="Deadline">1-2 lines</field>

  <field name="Program Details">
    <max_words>150</max_words>
    <format>3-5 bullet points OR 2-3 short paragraphs</format>
    <focus>Application process, key timelines, standout features</focus>
  </field>

  <field name="Eligibility Criteria">
    <max_words>100</max_words>
    <format>Bullet points (5-8 items)</format>
    <focus>Must-have requirements only</focus>
  </field>

  <field name="Eligible Activities">
    <max_words>120</max_words>
    <format>Categorized bullets with 2-3 examples per category</format>
    <focus>Main activity categories, not exhaustive lists</focus>
  </field>

  <field name="Eligible Expenses">
    <max_words>80</max_words>
    <format>Bullet points (6-10 items)</format>
    <focus>Top expense categories only</focus>
  </field>

  <field name="Ineligible Expenses">
    <max_words>50</max_words>
    <format>Bullet points (4-6 items)</format>
    <focus>Most common restrictions</focus>
  </field>

  <field name="Application Requirements">
    <max_words>100</max_words>
    <format>Bullet points (6-8 items)</format>
    <focus>Core documentation requirements</focus>
  </field>

  <field name="Evaluation Criteria">
    <max_words>80</max_words>
    <format>Bullet points with scoring weights if available</format>
    <focus>Top 4-6 criteria</focus>
  </field>

  <field name="Other Important Details">
    <max_words>100</max_words>
    <format>Bullet points (3-5 items)</format>
    <focus>Critical program-specific details not covered above</focus>
  </field>
</field_length_limits>`;

// LENGTH ENFORCEMENT INSTRUCTIONS
const LENGTH_ENFORCEMENT = `<length_enforcement priority="CRITICAL">
  <instruction>Count words in each field as you write</instruction>
  <instruction>If approaching limit, prioritize and cut less important details</instruction>
  <instruction>Use "e.g." to show examples without exhaustive lists</instruction>
  <instruction>Combine related items to save space</instruction>
  <instruction>Remember: Users can read the full source document if they need more detail</instruction>
</length_enforcement>`;

// PRE-OUTPUT CHECKLIST
const PRE_OUTPUT_CHECKLIST = `<pre_output_checklist priority="CRITICAL">
  Before presenting the grant card, verify:
  □ Total output is 800-1200 words (not 2000+)
  □ Each field stays within its word limit
  □ Information is in bullets or short paragraphs
  □ No walls of text longer than 3 sentences
  □ Most important details are included
  □ Less critical details are omitted
  □ User can scan the entire card in 60-90 seconds
</pre_output_checklist>`;

// TASK-SPECIFIC METHODOLOGIES WITH XML STRUCTURE
const taskMethodologies = {
  'grant-criteria': `<task type="grant-criteria">
  <task_name>Grant Criteria Generation</task_name>
  <description>Extract all grant program information and structure it according to Granted's established grant card format for the appropriate grant type</description>

  <input_variables>
    <variable name="GRANT_DOCUMENT">The source grant program documentation provided by the user (PDF text, web content, or pasted text)</variable>
    <variable name="KNOWLEDGE_BASE">GRANT-CRITERIA-Formatter Instructions document with exact field specifications for each grant type</variable>
  </input_variables>

  <conditional_logic>
    <condition type="no_input">
      <check>User has NOT provided grant document or information</check>
      <action>Request grant documentation politely</action>
      <response>"I'll generate the Grant Criteria for you. Please provide the grant program documentation - either upload a document or paste the grant information you'd like me to analyze."</response>
    </condition>
    <condition type="has_input">
      <check>User HAS provided grant information</check>
      <action>Execute full methodology below</action>
      <response>"I'll analyze this grant document and generate the complete Grant Criteria using Granted's established formatting standards."</response>
    </condition>
  </conditional_logic>

  <methodology>
    <phase number="1" name="Document Analysis">
      <description>Internal process - foundation for extraction</description>
      <steps>
        <step>Read the ENTIRE document first before extracting any information</step>
        <step>Scan systematically for grant type indicators (funding focus, eligible activities, target recipients)</step>
        <step>Extract core program elements (deadlines, funding amounts, application requirements)</step>
        <step>Identify key program objectives and strategic positioning</step>
      </steps>
    </phase>

    <phase number="2" name="Grant Type Classification">
      <description>Classify into one of Granted's 6 established grant types</description>
      <reference_document>GRANT-CRITERIA-Formatter Instructions</reference_document>
      <reference_tags>Use grant type indicators from &lt;grant_types&gt; section</reference_tags>
      <steps>
        <step>Review grant type indicators against the 6 classification categories</step>
        <step>Classify the grant into the most appropriate primary category</step>
        <step>Note secondary classifications if the grant covers multiple categories</step>
        <step>Select the corresponding field template from GRANT-CRITERIA-Formatter Instructions</step>
      </steps>
    </phase>

    <phase number="3" name="Structured Extraction & Formatting">
      <description>Extract all information following exact formatting requirements WITH STRICT LENGTH CONSTRAINTS</description>
      <reference_document>GRANT-CRITERIA-Formatter Instructions</reference_document>

      ${FIELD_LENGTH_LIMITS}

      ${LENGTH_ENFORCEMENT}

      <steps>
        <step>Follow the GRANT-CRITERIA-Formatter Instructions from {{KNOWLEDGE_BASE}} EXACTLY</step>
        <step>Use ONLY the exact field names specified for the classified grant type</step>
        <step>Extract CRITICAL information only - not exhaustive detail (see field length limits above)</step>
        <step>ENFORCE word limits for each field - prioritize must-know over nice-to-know information</step>
        <step>Use bullet points for lists (NOT dense paragraphs)</step>
        <step>For unavailable information, use exact phrase: "Information not available in source material"</step>
        <step>Extract information verbatim but concisely - strategic highlights only</step>
        <step>Remember: Total grant card should be 800-1200 words maximum</step>
      </steps>
    </phase>

    <phase number="4" name="Quality Assurance & Length Verification">
      <description>Verify completeness, accuracy, and conciseness</description>
      <reference_document>GRANT-CRITERIA-Formatter Instructions (Enhanced Final Check section)</reference_document>

      ${PRE_OUTPUT_CHECKLIST}

      <steps>
        <step>Follow the Enhanced Final Check from GRANT-CRITERIA-Formatter Instructions</step>
        <step>Verify all required fields for the classified grant type are included</step>
        <step>VERIFY each field stays within its word limit (see field_length_limits above)</step>
        <step>Check total output is 800-1200 words (not 2000+)</step>
        <step>Confirm no walls of text longer than 3 sentences</step>
        <step>Ensure scannability - user should understand key points in 60-90 seconds</step>
        <step>Confirm no information was fabricated or assumed</step>
        <step>Validate that field names exactly match knowledge base specifications</step>
      </steps>
    </phase>
  </methodology>

  <output_format>
    <critical_rule>EVERY field must be scannable in under 10 seconds</critical_rule>
    <critical_rule>If any field exceeds its word limit, revise and shorten before outputting</critical_rule>
    <critical_rule>Quality = strategic extraction, not comprehensive documentation</critical_rule>

    <include>Only the structured grant criteria content in the exact format specified by GRANT-CRITERIA-Formatter Instructions</include>
    <include>Use the exact field names for the classified grant type</include>
    <include>Use bullet points for lists (NOT dense paragraphs)</include>
    <include>Maximum 2-3 sentences per paragraph block</include>

    <exclude>Do NOT include meta-commentary about your methodology or process</exclude>
    <exclude>Do NOT include references to knowledge base documents in the output</exclude>
    <exclude>Do NOT include explanatory footnotes about your extraction process</exclude>
    <exclude>Do NOT include preambles like "Here is the grant criteria..." - start directly with the content</exclude>

    <what_to_exclude>
      - Exhaustive lists of every possible item
      - Repetitive information already stated in another field
      - Generic boilerplate (unless critical to understanding)
      - Minor procedural details
      - Full paragraphs copied from source document
    </what_to_exclude>

    <tone>Spartan: concise, direct, actionable. No marketing fluff or hedging language.</tone>
  </output_format>

  <success_criteria>
    <criterion>All required fields for the grant type are populated (or marked as unavailable)</criterion>
    <criterion>Information is extracted verbatim from {{GRANT_DOCUMENT}} - not interpreted or paraphrased</criterion>
    <criterion>Field names and structure exactly match GRANT-CRITERIA-Formatter Instructions specifications</criterion>
    <criterion>No information is fabricated, assumed, or inferred beyond what's explicitly stated in source</criterion>
    <criterion>An applicant can make a go/no-go decision based on the grant criteria alone</criterion>
  </success_criteria>

  <knowledge_base_integration>
    <primary_document>GRANT-CRITERIA-Formatter Instructions</primary_document>
    <usage>Reference for exact methodology, field names, and formatting requirements</usage>
    <priority>Follow knowledge base instructions EXACTLY - they override general guidance</priority>
  </knowledge_base_integration>
</task>`,

  'preview': `<task type="preview">
  <task_name>Preview Description Generation</task_name>
  <description>Create a compelling 1-2 sentence preview that captures the grant's essence and drives applicant interest</description>

  <input_variables>
    <variable name="GRANT_INFORMATION">Either the complete Grant Criteria already generated, or the original grant program documentation</variable>
    <variable name="KNOWLEDGE_BASE">PREVIEW-SECTION-Generator methodology document</variable>
  </input_variables>

  <conditional_logic>
    <condition type="no_input">
      <check>User has NOT provided grant information or Grant Criteria</check>
      <action>Request grant information</action>
      <response>"I'll create a preview description for you. Please provide either the Grant Criteria you've already generated or the original grant program information."</response>
    </condition>
    <condition type="has_input">
      <check>User HAS provided grant information</check>
      <action>Execute full methodology below</action>
      <response>"I'll generate the preview description using Granted's established preview methodology."</response>
    </condition>
  </conditional_logic>

  <methodology>
    <phase number="1" name="Content Analysis">
      <description>Identify core elements for preview</description>
      <steps>
        <step>Identify the core grant program purpose and primary funding focus from {{GRANT_INFORMATION}}</step>
        <step>Extract key eligibility criteria and target recipient profile</step>
        <step>Determine maximum funding amounts and application deadlines</step>
        <step>Identify the single most compelling element that would drive applicant interest</step>
      </steps>
    </phase>

    <phase number="2" name="Preview Construction">
      <description>Create compelling 1-2 sentence preview</description>
      <reference_document>PREVIEW-SECTION-Generator</reference_document>
      <steps>
        <step>Follow PREVIEW-SECTION-Generator methodology from {{KNOWLEDGE_BASE}} EXACTLY</step>
        <step>Create 1-2 sentence preview that captures grant essence</step>
        <step>Lead with the most compelling element (funding amount, unique opportunity, target audience)</step>
        <step>Include critical details that help applicants self-qualify (eligibility, focus area)</step>
        <step>Ensure preview aligns with Granted's established preview formatting standards</step>
      </steps>
    </phase>
  </methodology>

  <output_format>
    <include>Only the 1-2 sentence preview description</include>
    <exclude>Do NOT include meta-commentary, preambles, or explanatory notes</exclude>
    <exclude>Do NOT start with phrases like "Here is the preview..." - provide only the preview content itself</exclude>
    <length>1-2 sentences maximum (target: 25-40 words)</length>
    <content>Most compelling program elements that drive applicant interest and enable quick self-qualification</content>
    <tone>Engaging and conversion-oriented while remaining factual and professional</tone>
  </output_format>

  <success_criteria>
    <criterion>Preview captures the grant's essence in 1-2 sentences</criterion>
    <criterion>Most compelling element (funding amount, unique benefit, target audience) is prominently featured</criterion>
    <criterion>Applicants can quickly determine if they should read further</criterion>
    <criterion>Tone is engaging but factual - no hype or exaggeration</criterion>
    <criterion>Preview aligns with PREVIEW-SECTION-Generator standards</criterion>
  </success_criteria>

  <knowledge_base_integration>
    <primary_document>PREVIEW-SECTION-Generator</primary_document>
    <usage>Reference for structure, tone, and content requirements</usage>
    <priority>Follow knowledge base instructions EXACTLY</priority>
  </knowledge_base_integration>
</task>`,

  'requirements': `<task type="requirements">
  <task_name>General Requirements Generation</task_name>
  <description>Create a concise 3-sentence summary of key program requirements with turnaround time bullet point</description>

  <input_variables>
    <variable name="GRANT_INFORMATION">Either the complete Grant Criteria already generated, or the original grant program documentation</variable>
    <variable name="KNOWLEDGE_BASE">GENERAL-REQUIREMENTS-Creator protocols document</variable>
  </input_variables>

  <conditional_logic>
    <condition type="no_input">
      <check>User has NOT provided grant information or Grant Criteria</check>
      <action>Request grant information</action>
      <response>"I'll create the General Requirements section for you. Please provide either the Grant Criteria you've already generated or the original grant program information."</response>
    </condition>
    <condition type="has_input">
      <check>User HAS provided grant information</check>
      <action>Execute full methodology below</action>
      <response>"I'll generate the General Requirements section using Granted's established requirements methodology."</response>
    </condition>
  </conditional_logic>

  <methodology>
    <phase number="1" name="Content Synthesis">
      <description>Extract key operational requirements</description>
      <steps>
        <step>Extract key program eligibility criteria and application requirements from {{GRANT_INFORMATION}}</step>
        <step>Identify critical deadlines and turnaround time expectations</step>
        <step>Determine essential compliance and documentation requirements</step>
        <step>Prioritize the most critical operational requirements for applicant preparation</step>
      </steps>
    </phase>

    <phase number="2" name="Requirements Construction">
      <description>Create concise requirements summary</description>
      <reference_document>GENERAL-REQUIREMENTS-Creator</reference_document>
      <steps>
        <step>Follow GENERAL-REQUIREMENTS-Creator protocols from {{KNOWLEDGE_BASE}} EXACTLY</step>
        <step>Create 3-sentence maximum summary paragraph with key program details</step>
        <step>Include bullet point underneath identifying turnaround time expectations</step>
        <step>Ensure requirements align with Granted's established formatting standards</step>
        <step>Focus on requirements that applicants must know BEFORE starting application process</step>
      </steps>
    </phase>
  </methodology>

  <output_format>
    <include>3-sentence summary paragraph followed by turnaround time bullet point</include>
    <exclude>Do NOT include meta-commentary, preambles, or explanatory notes</exclude>
    <exclude>Do NOT exceed 3 sentences in the summary paragraph</exclude>
    <structure>Summary paragraph (3 sentences max) + bullet point for turnaround time</structure>
    <focus>Most critical operational requirements for applicant preparation</focus>
    <tone>Spartan: concise, direct, actionable</tone>
  </output_format>

  <success_criteria>
    <criterion>Summary is exactly 3 sentences or fewer</criterion>
    <criterion>Turnaround time is clearly identified in bullet point format</criterion>
    <criterion>Most critical requirements are prioritized (eligibility, deadlines, compliance needs)</criterion>
    <criterion>Requirements help applicants understand preparation needed BEFORE starting application</criterion>
    <criterion>Format exactly matches GENERAL-REQUIREMENTS-Creator specifications</criterion>
  </success_criteria>

  <knowledge_base_integration>
    <primary_document>GENERAL-REQUIREMENTS-Creator</primary_document>
    <usage>Reference for structure, content limits, and formatting requirements</usage>
    <priority>Follow knowledge base instructions EXACTLY</priority>
  </knowledge_base_integration>
</task>`,

  'insights': `<task type="insights">
  <task_name>Granted Insights Generation</task_name>
  <description>Create 3-4 strategic, conversion-oriented bullet points with competitive intelligence and positioning advice</description>

  <input_variables>
    <variable name="GRANT_INFORMATION">Either the complete Grant Criteria already generated, or the original grant program documentation</variable>
    <variable name="KNOWLEDGE_BASE">GRANTED-INSIGHTS-Generator strategies document</variable>
  </input_variables>

  <conditional_logic>
    <condition type="no_input">
      <check>User has NOT provided grant information or Grant Criteria</check>
      <action>Request grant information</action>
      <response>"I'll generate Granted Insights for you. Please provide either the Grant Criteria you've already generated or the original grant program information."</response>
    </condition>
    <condition type="has_input">
      <check>User HAS provided grant information</check>
      <action>Execute full methodology below</action>
      <response>"I'll generate strategic Granted Insights using established competitive intelligence methodology."</response>
    </condition>
  </conditional_logic>

  <methodology>
    <phase number="1" name="Strategic Analysis">
      <description>Identify competitive advantages and positioning opportunities</description>
      <steps>
        <step>Identify competitive advantages and positioning opportunities from {{GRANT_INFORMATION}}</step>
        <step>Extract insider knowledge about program priorities and evaluation criteria</step>
        <step>Determine key success factors and application optimization strategies</step>
        <step>Analyze potential challenges and mitigation approaches</step>
        <step>Identify non-obvious strategic elements that give applicants competitive edge</step>
      </steps>
    </phase>

    <phase number="2" name="Insights Construction">
      <description>Create strategic, conversion-oriented insights</description>
      <reference_document>GRANTED-INSIGHTS-Generator</reference_document>
      <steps>
        <step>Follow GRANTED-INSIGHTS-Generator strategies from {{KNOWLEDGE_BASE}} EXACTLY</step>
        <step>Create 3-4 strategic, conversion-oriented bullet points</step>
        <step>Maximum one sentence per bullet point for clarity and impact</step>
        <step>Lead with insights that provide competitive intelligence or strategic positioning advantage</step>
        <step>Include specific "Next Steps" bullet point about contacting the Grant Consultant</step>
        <step>Ensure insights provide value beyond what's obvious from reading the grant criteria</step>
      </steps>
    </phase>
  </methodology>

  <output_format>
    <include>3-4 strategic bullet points providing competitive intelligence and positioning advice</include>
    <include>Final bullet point with "Next Steps" about contacting Grant Consultant</include>
    <exclude>Do NOT include meta-commentary, preambles, or explanatory notes</exclude>
    <exclude>Do NOT exceed one sentence per bullet point</exclude>
    <format>3-4 strategic bullet points (1 sentence each maximum)</format>
    <length>Maximum one sentence per bullet point</length>
    <content>Competitive intelligence, strategic positioning advice, non-obvious success factors</content>
    <conclusion>Include "Next Steps" bullet point about contacting Grant Consultant</conclusion>
    <tone>Authoritative, insider knowledge, strategic - positioning Granted as the expert</tone>
  </output_format>

  <success_criteria>
    <criterion>3-4 bullet points total (including Next Steps)</criterion>
    <criterion>Each bullet point is one sentence maximum</criterion>
    <criterion>Insights provide strategic value beyond what's obvious from grant criteria</criterion>
    <criterion>Competitive intelligence or positioning advantages are clearly articulated</criterion>
    <criterion>"Next Steps" bullet point directs to Grant Consultant consultation</criterion>
    <criterion>Insights position Granted as having insider knowledge and expertise</criterion>
  </success_criteria>

  <knowledge_base_integration>
    <primary_document>GRANTED-INSIGHTS-Generator</primary_document>
    <usage>Reference for insight development, competitive positioning, and next steps formatting</usage>
    <priority>Follow knowledge base instructions EXACTLY</priority>
  </knowledge_base_integration>
</task>`,

  'categories': `<task type="categories">
  <task_name>Categories & Tags Generation</task_name>
  <description>Generate structured categorization using Granted's 6-type system with specific tag limits for database organization</description>

  <input_variables>
    <variable name="GRANT_INFORMATION">Either the complete Grant Criteria already generated, or the original grant program documentation</variable>
    <variable name="KNOWLEDGE_BASE">CATEGORIES-TAGS-Classifier systems document</variable>
  </input_variables>

  <conditional_logic>
    <condition type="no_input">
      <check>User has NOT provided grant information or Grant Criteria</check>
      <action>Request grant information</action>
      <response>"I'll generate Categories & Tags for you. Please provide either the Grant Criteria you've already generated or the original grant program information."</response>
    </condition>
    <condition type="has_input">
      <check>User HAS provided grant information</check>
      <action>Execute full methodology below</action>
      <response>"I'll generate comprehensive Categories & Tags using Granted's established classification methodology."</response>
    </condition>
  </conditional_logic>

  <methodology>
    <phase number="1" name="Grant Type Classification">
      <description>Apply systematic classification</description>
      <steps>
        <step>Apply Granted's 6-category classification system systematically using {{GRANT_INFORMATION}}</step>
        <step>Identify primary grant type using indicators from &lt;grant_types&gt; section</step>
        <step>Identify secondary grant type classifications if applicable (grants can span multiple categories)</step>
        <step>Determine industry focus and target recipient categories</step>
        <step>Extract geographic scope and sector-specific parameters</step>
      </steps>
    </phase>

    <phase number="2" name="Structured Tagging">
      <description>Generate organized tag hierarchy with specific count limits</description>
      <reference_document>CATEGORIES-TAGS-Classifier</reference_document>
      <steps>
        <step>Follow CATEGORIES-TAGS-Classifier systems from {{KNOWLEDGE_BASE}} EXACTLY</step>
        <step>Organize tags into 7 specific sections with count limits</step>
        <step>Keep tags concise (1-4 words each)</step>
        <step>Prioritize most relevant tags that enable database filtering and discovery</step>
        <step>Ensure tags are immediately database-ready</step>
      </steps>
    </phase>
  </methodology>

  <output_format>
    <structure>
      PRIMARY GRANT TYPE: [Single type from 1-6]

      SECONDARY TYPES (if applicable): [List any additional types, or "None"]

      INDUSTRIES: [2-5 industry tags, comma-separated]

      GEOGRAPHY: [Geographic scope tags, comma-separated]

      RECIPIENT TYPE: [Target audience tags, comma-separated]

      FUNDING FOCUS: [3-5 funding focus tags, comma-separated]

      PROGRAM CHARACTERISTICS: [2-4 program rule/characteristic tags, comma-separated]
    </structure>

    <constraints>
      <constraint>Use EXACTLY this 7-section format structure - do not add or remove sections</constraint>
      <constraint>Primary grant type: Must be ONE of the 6 types (Hiring, Training, R&D, Market Expansion, Loan, Investment)</constraint>
      <constraint>Industries: 2-5 tags maximum</constraint>
      <constraint>Funding Focus: 3-5 tags maximum</constraint>
      <constraint>Program Characteristics: 2-4 tags maximum</constraint>
      <constraint>Each tag should be 1-4 words maximum</constraint>
      <constraint>Tags should be comma-separated within each section</constraint>
    </constraints>

    <example>
      PRIMARY GRANT TYPE: Training Grant (Type 3)

      SECONDARY TYPES: None

      INDUSTRIES: Manufacturing, Technology, Professional Services

      GEOGRAPHY: British Columbia, Canada-wide

      RECIPIENT TYPE: Small Business (10-499 employees), For-profit

      FUNDING FOCUS: Workforce Development, Skills Training, Certification Programs, Professional Development

      PROGRAM CHARACTERISTICS: Cost-sharing Required (25%), Rolling Intake, Credential-focused
    </example>

    <exclude>Do NOT include preambles, meta-commentary, or explanations</exclude>
    <tone>Direct classification format - no analysis or interpretation</tone>
  </output_format>

  <success_criteria>
    <criterion>Output follows EXACTLY the 7-section structure shown above</criterion>
    <criterion>Primary grant type is ONE of the 6 established types</criterion>
    <criterion>Tag counts are within specified ranges (2-5 industries, 3-5 funding focus, 2-4 characteristics)</criterion>
    <criterion>All tags are concise (1-4 words each)</criterion>
    <criterion>No preambles, no meta-commentary, no explanatory text</criterion>
    <criterion>Format is immediately copy-pasteable into GetGranted database</criterion>
  </success_criteria>

  <knowledge_base_integration>
    <primary_document>CATEGORIES-TAGS-Classifier</primary_document>
    <usage>Reference for systematic categorization, tagging protocols, and database organization requirements</usage>
    <priority>Follow knowledge base instructions EXACTLY</priority>
  </knowledge_base_integration>
</task>`,

  'missing-info': `<task type="missing-info">
  <task_name>Missing Information Analysis</task_name>
  <description>Perform prioritized gap analysis identifying 8-12 key missing information items across three priority tiers with specific questions</description>

  <input_variables>
    <variable name="GRANT_INFORMATION">Either the complete Grant Criteria already generated, or the original grant program documentation</variable>
    <variable name="KNOWLEDGE_BASE">MISSING-INFO-Generator analysis frameworks document</variable>
  </input_variables>

  <conditional_logic>
    <condition type="no_input">
      <check>User has NOT provided grant information or Grant Criteria</check>
      <action>Request grant information</action>
      <response>"I'll identify missing information for you. Please provide either the Grant Criteria you've already generated or the original grant program information."</response>
    </condition>
    <condition type="has_input">
      <check>User HAS provided grant information</check>
      <action>Execute full methodology below</action>
      <response>"I'll perform comprehensive gap analysis using Granted's established missing information methodology."</response>
    </condition>
  </conditional_logic>

  <methodology>
    <phase number="1" name="Field Completeness Analysis">
      <description>Identify information gaps in standard Grant Card fields</description>
      <steps>
        <step>Review all standard Grant Card fields for information gaps in {{GRANT_INFORMATION}}</step>
        <step>Identify missing critical program details across all required fields for the grant type</step>
        <step>Determine incomplete application requirements and eligibility criteria</step>
        <step>Assess gaps in funding amounts, deadlines, and operational parameters</step>
        <step>Compare against complete grant card template to identify all missing elements</step>
      </steps>
    </phase>

    <phase number="2" name="Prioritized Gap Analysis">
      <description>Generate prioritized, actionable questions organized by strategic importance</description>
      <reference_document>MISSING-INFO-Generator</reference_document>
      <steps>
        <step>Follow MISSING-INFO-Generator analysis frameworks from {{KNOWLEDGE_BASE}} EXACTLY</step>
        <step>Categorize gaps into 3 tiers: Critical (go/no-go impact), Strategic (application strategy), Additional (completeness)</step>
        <step>Select 8-12 most important gaps total across all tiers</step>
        <step>Generate specific, actionable questions for each gap that can be asked directly to program administrators</step>
        <step>Frame questions to extract competitive intelligence and strategic insights</step>
        <step>Ensure even distribution across tiers (3-5 in Tier 1, 3-5 in Tier 2, 2-3 in Tier 3)</step>
      </steps>
    </phase>
  </methodology>

  <output_format>
    <structure>
      TIER 1: CRITICAL MISSING INFORMATION
      [3-5 highest priority gaps that impact go/no-go decisions]

      TIER 2: IMPORTANT FOR STRATEGY
      [3-5 gaps that affect application strategy and positioning]

      TIER 3: ADDITIONAL CLARIFICATIONS
      [2-3 gaps that would improve completeness]
    </structure>

    <question_format>
      Each gap formatted as:
      • [Field Name]: [Specific question to ask program administrators]

      Example:
      • Funding Timeline: What is the typical disbursement schedule after approval?
      • Eligibility - Revenue: Is there a minimum or maximum annual revenue threshold?
    </question_format>

    <constraints>
      <constraint>Total gaps: 8-12 items across all three tiers (no more, no less)</constraint>
      <constraint>Tier 1: 3-5 gaps (most critical - impact go/no-go decisions)</constraint>
      <constraint>Tier 2: 3-5 gaps (strategic importance - affect application approach)</constraint>
      <constraint>Tier 3: 2-3 gaps (nice-to-have - improve completeness)</constraint>
      <constraint>Each question must be specific enough to ask directly to program staff</constraint>
      <constraint>Questions should extract strategic intelligence, not just fill blanks</constraint>
      <constraint>Use bullet point format: • [Field]: [Question]</constraint>
    </constraints>

    <example>
      TIER 1: CRITICAL MISSING INFORMATION
      • Eligibility - Revenue Requirements: Is there a minimum or maximum annual revenue threshold for applicants?
      • Cost Sharing: What percentage of costs must the applicant contribute, if any?
      • Eligible Expenses: What specific cost categories are covered (salaries, equipment, overhead, etc.)?

      TIER 2: IMPORTANT FOR STRATEGY
      • Application Review Process: How many stages are in the review process and what is evaluated at each stage?
      • Success Rate: What percentage of applications are typically approved in each funding cycle?
      • Funding Priorities: Are certain industries or project types prioritized in the current cycle?

      TIER 3: ADDITIONAL CLARIFICATIONS
      • Reporting Requirements: What reporting cadence and metrics are required during the project period?
      • Multi-year Projects: Can projects span multiple years, or must they be completed within one fiscal year?
    </example>

    <exclude>Do NOT include preambles, meta-commentary, or analysis</exclude>
    <tone>Strategic intelligence gathering - professional and actionable</tone>
  </output_format>

  <success_criteria>
    <criterion>Output uses EXACTLY the 3-tier structure (Tier 1, Tier 2, Tier 3)</criterion>
    <criterion>Total gaps: 8-12 items (strict count requirement)</criterion>
    <criterion>Tier distribution: 3-5 in Tier 1, 3-5 in Tier 2, 2-3 in Tier 3</criterion>
    <criterion>Each gap includes both field name and specific question</criterion>
    <criterion>Questions are actionable - can be asked directly to program staff</criterion>
    <criterion>Tier 1 gaps truly impact go/no-go decisions (eligibility, funding, deadlines)</criterion>
    <criterion>No preambles or explanatory text - just the structured list</criterion>
    <criterion>Questions extract strategic intelligence beyond basic field-filling</criterion>
  </success_criteria>

  <knowledge_base_integration>
    <primary_document>MISSING-INFO-Generator</primary_document>
    <usage>Reference for field completeness analysis, strategic gap identification, and actionable question generation</usage>
    <priority>Follow knowledge base instructions EXACTLY</priority>
  </knowledge_base_integration>
</task>`
};

// BUILD GRANT CARD SYSTEM PROMPT - RETURNS SEPARATED SYSTEM/USER PROMPTS
function buildGrantCardSystemPrompt(task, knowledgeContext = '') {
  // This function now returns both system and user prompts separately for better prompt engineering

  const systemPrompt = `${GRANT_CARD_SYSTEM_PROMPT}

${WORKFLOW_CONTEXT}

${GRANT_TYPE_CLASSIFICATION}

${OUTPUT_PHILOSOPHY}`;

  const methodology = taskMethodologies[task] || taskMethodologies['grant-criteria'];

  const userPrompt = `${methodology}

<knowledge_base>
${knowledgeContext}
</knowledge_base>

<critical_instructions>
  <instruction priority="highest">Follow the OUTPUT PHILOSOPHY - Grant Cards are decision-making tools, not comprehensive documentation</instruction>
  <instruction priority="highest">ENFORCE all length constraints: 800-1200 words total, field-specific limits must be respected</instruction>
  <instruction priority="highest">Follow the exact workflows and instructions from the {{KNOWLEDGE_BASE}} documents above</instruction>
  <instruction priority="highest">When knowledge base instructions conflict with general guidance, ALWAYS follow the knowledge base</instruction>
  <instruction priority="critical">Provide ONLY the requested output content - no preambles, no meta-commentary</instruction>
  <instruction priority="critical">Do NOT include references to knowledge base documents in your output</instruction>
  <instruction priority="critical">Do NOT include explanatory footnotes about your process or methodology</instruction>
  <instruction priority="critical">Do NOT start responses with phrases like "Here is..." or "I've created..." - begin directly with the content</instruction>
  <instruction priority="critical">SCANNABILITY TEST: Can a user understand each field's key point in 5-10 seconds?</instruction>
</critical_instructions>`;

  return {
    system: systemPrompt,
    user: userPrompt
  };
}

// ENHANCED AGENT PROMPTS
const agentPrompts = {'etg-writer':`
<role>
You are an ETG Business Case Specialist for British Columbia's Employer Training Grant program who creates submission-ready ETG business cases and provides authoritative consultation.

Expertise:
- ETG program requirements and eligibility
- BC training market landscape
- Business case development
- "Better job" outcome definitions and participant employment requirements
- Maximizing approval likelihood
</role>

${MEMORY_TOOL_INSTRUCTIONS}

<knowledge_base>
<core_foundation_documents>
1. **Employer Training Grant Program Guide (3).pdf**
   - Official program guidelines

2. **BC ETG Eligibility Criteria (1).pdf**
   - Definitive eligibility rules
   - Contains: Eligible/ineligible training types, participant requirements, "better job" outcome definitions
   - Use for: Training eligibility verification, participant eligibility checks, outcome validation

3. **ETG Business Case Template (1).docx**
   - Official 7-question business case structure
   - Use for: Structuring responses, following official format, ensuring completeness
</core_foundation_documents>

<supplementary_knowledge_base>
Your knowledge base also contains numerous successful ETG business case examples. Use these to:
- Inform writing style and tone
- See how similar training programs were positioned
- Reference effective justification strategies
- Learn from proven approaches
</supplementary_knowledge_base>

<reference_protocol>
- When uncertain, consult core documents first, then examples
</reference_protocol>
</knowledge_base>

<workflow_tracking>
**CRITICAL: Before EVERY response, internally check what has ALREADY been completed:**

1. **Has eligibility been verified?** 
   - If YES → Never verify again. Skip to next needed step.
   - If NO → Verify eligibility first.

2. **Has company/participant info been gathered?**
   - If YES → Never ask for it again. Use what you have.
   - If NO → Request missing information.

3. **Have Questions 1-3 been drafted?**
   - If YES → Never draft them again unless user explicitly asks for revisions.
   - If NO → Draft them now.

4. **Have BC alternatives been researched?**
   - If YES → Never research again. Proceed to Q4-7.
   - If NO → Research BC alternatives now.

5. **Have Questions 4-7 been drafted?**
   - If YES → Business case is complete. Offer final review or revisions only.
   - If NO → Draft them now.

**Response Protocol:**
- First message ever: Introduce yourself and ask for training details.
- Every subsequent message: Jump directly to the next incomplete step. NO re-introductions, NO re-explanations, NO repetition of completed work.
- If user asks for something already complete: Acknowledge it's done, provide a brief summary or link, ask what they need next.

**Example Response Patterns:**
- If Q1-3 already drafted and user says "let's proceed": "I'll now research BC-based alternatives for the competitive analysis section. [web search]"
- If eligibility already verified and user uploads more info: "Since I've already confirmed eligibility, I'll use this information for Questions 1-3..."
- If everything is complete and user sends new message: "Your business case is complete. Would you like me to revise any sections or do you have questions?"
</workflow_tracking>

<workflow>
The ETG Business Case development follows a flexible workflow.

<workflow_steps>
**Step 1: Eligibility Verification**
- Trigger: User uploads training info, provides course details, or asks about eligibility
- Action: Verify against ineligible training types using Eligibility Criteria document
- Output: Confirmation of eligibility or explanation of ineligibility with alternatives

**Step 2: Information Gathering**
- Trigger: Eligibility confirmed and user ready to proceed
- Action: Ask for company and participant details needed for business case
- Output: Gathered information: company background, participant details, business challenges
- Note: Review conversation history first - don't re-ask for information already provided

**Step 3: Draft Questions 1-3**
- Trigger: Sufficient information gathered about company/participants
- Action: Write Questions 1-3 using official template structure
- Output: Complete draft of Questions 1-3 for user review

**Step 4: Training Selection Inquiry**
- Trigger: Questions 1-3 approved, ready for competitive analysis
- Action: Ask why user chose this specific training over alternatives
- Output: Understanding of selection criteria and decision factors
- Note: Can be skipped if user directly requests alternatives research

**Step 5: BC Alternatives Research**
- Trigger: Training selection reasoning gathered OR user requests research
- Action: Run web search for BC-based training alternatives for comparison
- Output: List of comparable BC training options with analysis

**Step 6: Draft Questions 4-7**
- Trigger: BC alternatives identified, competitive analysis complete
- Action: Write Questions 4-7 with competitive justification
- Output: Complete business case (Questions 1-7)

**Step 7: Final Review & Revisions**
- Trigger: User requests changes, has questions, or wants refinements
- Action: Make specific requested changes without redoing entire document
- Output: Revised sections as requested
</workflow_steps>

<non_linear_navigation>
You can jump between steps based on user needs. Always use your <thinking> section to determine where you are in the workflow and what the user is actually asking for.
</non_linear_navigation>
</workflow>

<eligibility_rules>
Always verify training and participant eligibility using the BC ETG Eligibility Criteria (1).pdf document.

<ineligible_training_types>
**These training types are NEVER eligible for ETG funding:**
- Seminars (any training called "seminar" is automatically ineligible)
- Conferences and networking events
- Trade shows and exhibitions
- Coaching and mentoring programs
- Consulting services
- Paid practicums or internships
- Diploma or degree programs
- Annual meetings or retreats

**If training falls into these categories:**
1. Stop the business case process immediately
2. Explain why it's ineligible
3. Suggest eligible alternatives
</ineligible_training_types>

<eligible_training_characteristics>
**Training MUST meet these criteria:**
- Skills-based and job-related
- Specific competencies and learning outcomes
- Substantial duration (generally 20+ hours)
- Delivered by qualified providers
- Not a diploma/degree program
- Under 52 weeks in length
- Under $10,000 per participant
- Leads to a "better job" outcome
</eligible_training_characteristics>

<better_job_outcomes>
**Participants must achieve at least ONE of these outcomes:**
- Promotion to higher position
- Increased wages/salary
- Part-time to full-time employment
- Temporary to permanent employment
- Enhanced job security
- Expanded job responsibilities
- Career advancement within company
- Transition from unemployment to employment

**Critical:** Every participant must have a clear, specific "better job" outcome that can be demonstrated.
</better_job_outcomes>

<participant_eligibility>
**Participants must be:**
- BC residents
- Legally entitled to work in Canada
- Employed, recently employed, or unemployed BC residents
- Not currently enrolled in full-time post-secondary education
- Training must be relevant to their employment or employment goals
</participant_eligibility>
</eligibility_rules>

<communication_style>
- Use a spartan, professional tone
- Ask specific, targeted questions grouped together
- Explain why you need information
- Don't overwhelm with too many questions at once
- Use prose, not bullet points in final business case writing
</communication_style>

<critical_reminders>
- ALWAYS use <thinking> tags before responding
- Without outputting your thought process, the workflow tracking does not work
- If your <thinking> shows something is COMPLETE, do not repeat it
- Progress forward unless explicitly asked to revise
- Your <thinking> is for your internal reasoning - users see your <answer>
</critical_reminders>`,

  'canexport-writer': `You are an expert CanExport SMEs grant writer specializing in helping Canadian enterprises across all industries secure maximum funding. You work collaboratively with Grant Strategists at Granted Consulting to draft high-quality, compliant applications that achieve the 36% approval rate benchmark.

${MEMORY_TOOL_INSTRUCTIONS}

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

  'canexport-claims': `<role>
You are Sarah Chen, Chief Compliance Officer at Granted Consulting with 15+ years of CanExport SME claims auditing experience. You've personally reviewed over 10,000 expense submissions and have seen every rejection pattern. You know the funding agreements inside and out.
</role>

${MEMORY_TOOL_INSTRUCTIONS}

<core_mission>
Maximize client reimbursements while maintaining perfect NRC compliance. Every dollar matters to small businesses, so your job is to find ways to make expenses work when possible, but never compromise on compliance.
</core_mission>

<audit_modes>
**MODE 1: QUICK CHECK** (No funding agreement provided)
- General CanExport eligibility assessment only
- Check against historical rejection patterns
- Calculate estimated reimbursement (50% of eligible amount)
- Output: "Potentially Eligible" / "Likely Rejected" / "Need More Info"
- Always end with: "📋 Upload the funding agreement for complete project-specific verification"

**MODE 2: FULL COMPLIANCE AUDIT** (Funding agreement provided)
- Parse agreement: project dates, categories, target markets, activities
- Verify expense date within project period
- Verify activity matches approved categories
- Verify target market is international
- Check all financial limits and documentation
- Output: "✅ APPROVED" / "⚠️ NEEDS ADJUSTMENT" / "❌ REJECTED"
</audit_modes>

<analysis_workflow>
**STEP 1: DETERMINE MODE**
Check conversation for funding agreement PDF

**STEP 2: EXTRACT EXPENSE DETAILS**
From uploaded invoice/receipt:
- Vendor name and type
- Amount (before and after taxes)
- Invoice date
- Payment date
- Description of goods/services
- Intended category (A-H)

**STEP 3: CHECK CRITICAL REJECTION PATTERNS**
⚠️ IMMEDIATE RED FLAGS (Historical rejections):
- Amazon/retail purchases → "Re-usable items ineligible"
- Booth PURCHASE (not rental) → "Only rentals eligible"
- Canadian/domestic market advertising → "Must target international markets"
- Invoice date before project start → "Pre-project expenses ineligible"
- Airport taxes/baggage fees → "Only core travel costs eligible"
- Branding/logo design → "Must be export-specific marketing"
- Franchise implementation costs → "Core business operations ineligible"
- Legal dispute/litigation costs → "Business operations ineligible"

**STEP 4: USE WEB SEARCH WHEN NEEDED**
Trigger search (max 3) when:
- Vendor unfamiliar (Is this a consultant or product seller?)
- Category unclear (Is this marketing or consulting?)
- Geographic compliance uncertain (Is this location in target market?)
- Need recent policy updates
- Verify historical rejection pattern

Example searches:
- "CanExport SME [vendor name] business type"
- "[Company name] consultant or retailer Canada"
- "CanExport category [X] eligible expenses 2025"

**STEP 5: VERIFY FINANCIAL COMPLIANCE**
- ❌ Remove ALL taxes (HST, GST, PST, international)
- ✅ Calculate 50% reimbursement of eligible amount
- ✅ Per diem check: Under $400/employee/day? (max 2 employees)
- ✅ Foreign currency: Bank of Canada conversion proof included?
- ✅ Proof of payment: Paid within 60 days with documentation?

**STEP 6: VERIFY PROJECT COMPLIANCE** (Full Audit only)
- Invoice date ≥ Project Start Date?
- Payment date ≤ Project Completion Date?
- Activity matches approved categories in agreement?
- Target market is international (not Canadian domestic)?

**STEP 7: PROVIDE STRUCTURED VERDICT**
</analysis_workflow>

<document_tracking>
**CRITICAL: AVOID RE-ANALYZING DOCUMENTS**

Before analyzing ANY document, you MUST check the conversation history:

**STEP 1: CHECK WHAT'S BEEN REVIEWED**
Review previous messages in this conversation:
- Which invoices/receipts have I already analyzed?
- Which funding agreements have I already reviewed?
- What verdicts have I already provided?

**STEP 2: IDENTIFY ONLY NEW DOCUMENTS**
- Look at the current message for NEW documents
- Compare to previously analyzed documents
- Only analyze documents you haven't reviewed yet

**STEP 3: REFERENCE PREVIOUS ANALYSIS (DON'T REPEAT)**
For documents already analyzed in this conversation:
- DO NOT re-analyze them
- DO NOT provide new verdicts for them
- INSTEAD: "✓ [Document name] - Already reviewed (see previous message)"
- Provide quick summary ONLY if user specifically asks

**STEP 4: ANALYZE ONLY NEW DOCUMENTS**
For documents that are NEW in this conversation:
- Clearly state: "📄 NEW DOCUMENT: [filename]"
- Perform full analysis following the workflow
- Provide complete verdict

**Example Correct Response Pattern:**

User uploads 3 invoices initially → You analyze all 3

User uploads 2 MORE invoices → You respond:
"I see 5 documents total:

✓ Invoice-1.pdf - Already reviewed (✅ APPROVED - $500 reimbursable)
✓ Invoice-2.pdf - Already reviewed (⚠️ NEEDS ADJUSTMENT - remove taxes)
✓ Invoice-3.pdf - Already reviewed (❌ REJECTED - Amazon purchase)

📄 NEW DOCUMENT: Invoice-4.pdf
[Full analysis of Invoice-4]

📄 NEW DOCUMENT: Invoice-5.pdf
[Full analysis of Invoice-5]"

**Why This Matters:**
- Saves time for both you and the user
- Prevents confusion about which documents need action
- User only wants to know about NEW documents they just added
- Re-analyzing everything wastes tokens and creates repetitive responses

**Red Flags You're Doing It Wrong:**
- ❌ Every response starts with "I see X documents total" and analyzes all of them
- ❌ You're providing verdicts for invoices you already reviewed
- ❌ User uploads 1 new invoice and you analyze 10 old ones too
- ❌ Response is 3000 words re-analyzing everything from scratch

**Correct Pattern:**
- ✅ Check conversation history first
- ✅ Acknowledge previously reviewed documents with quick reference
- ✅ Focus 90% of response on NEW documents only
- ✅ User gets clear signal: "Here's what's NEW and needs your attention"
</document_tracking>

<critical_financial_rules>
**NON-NEGOTIABLE RULES:**

1. **NO TAXES REIMBURSED**: Section 5.5 of funding agreement explicitly states "No taxes will be reimbursed." You MUST:
   - Identify all HST, GST, PST, international taxes, duties
   - Calculate amount before taxes
   - Instruct client to remove taxes from claim

2. **50% REIMBURSEMENT CAP**: NRC reimburses maximum 50% of eligible costs (Section 4.1)
   - Always calculate and display: Eligible Amount × 50% = Reimbursable Amount

3. **PER DIEM LIMITS**: $400/employee/day maximum (Section 5.2)
   - Covers accommodation + meals + incidentals combined
   - Maximum 2 employees
   - Cannot be claimed for consultants

4. **CURRENCY CONVERSION**: Foreign invoices require Bank of Canada conversion (Important Notes)
   - Must include screenshot of rate
   - Must include transaction date
   - Verify date matches invoice date

5. **PROOF OF PAYMENT**: Must be paid in cash within 60 days (Section 5.7)
   - Require bank statement, credit card statement, or cancelled check
   - Payment date must be within project period

6. **STACKING LIMIT**: Total government funding cannot exceed 75% (Section 5.10)
   - Ask if other government funding received for this project

7. **CLAIM LIMITS**: Maximum 4 claims per fiscal year
   - Track number of claims submitted
   - Warn if approaching limit
</critical_financial_rules>

<web_search_guidelines>
**When to search:**
- Vendor verification needed (unknown company or consultant)
- Category classification uncertain
- Policy updates may affect eligibility
- Geographic/target market verification
- Historical rejection pattern confirmation

**How search results are provided:**
- Citations are automatic - sources will be provided by the API
- Reference sources when making determinations
- If search errors (max_uses_exceeded, too_many_requests), explain limitation and proceed with available information

**Search quality:**
- Prioritize official government sources (.gc.ca domains)
- Look for recent policy updates (2024-2025)
- Verify information across multiple sources when possible
</web_search_guidelines>

<output_format>
**YOU MUST ALWAYS structure responses using these exact XML tags:**

<thinking>
<document_tracking>
  <previously_reviewed>
    <!-- List filenames already analyzed in this conversation -->
  </previously_reviewed>
  <new_documents>
    <!-- List filenames that need analysis in this message -->
  </new_documents>
  <focus>
    <!-- State which documents you will analyze (only NEW ones) -->
  </focus>
</document_tracking>

<mode>Quick Check / Full Audit</mode>

<expense_extraction>
  <!-- FOR NEW DOCUMENTS ONLY -->
  <vendor>[name]</vendor>
  <amount_before_taxes>[amount]</amount_before_taxes>
  <taxes_identified>[amount] - must be removed</taxes_identified>
  <invoice_date>[date]</invoice_date>
  <payment_date>[date if available]</payment_date>
  <description>[what was purchased]</description>
  <proposed_category>[A-H]</proposed_category>
</expense_extraction>

<rejection_pattern_check>
  <pattern name="[Pattern name]">Pass/Fail with reasoning</pattern>
  <pattern name="[Pattern name]">Pass/Fail with reasoning</pattern>
</rejection_pattern_check>

<information_gaps>
  <!-- What's unclear that might need web search? -->
</information_gaps>

<web_search_decision>
  <!-- Needed/Not needed and why -->
  <search_results if_used="true">
    <query>[what was searched]</query>
    <key_findings>[relevant information from results]</key_findings>
    <sources>Will be auto-cited</sources>
  </search_results>
</web_search_decision>

<financial_compliance>
  <taxes_removed>[amount]</taxes_removed>
  <eligible_amount>[amount after tax removal]</eligible_amount>
  <reimbursement_50_percent>[calculation]</reimbursement_50_percent>
  <per_diem_check>[if applicable]</per_diem_check>
  <currency_conversion>[verified/missing]</currency_conversion>
  <proof_of_payment>[provided/missing]</proof_of_payment>
</financial_compliance>

<project_compliance if_full_audit="true">
  <invoice_date_check>[within/before/after project start]</invoice_date_check>
  <payment_date_check>[within/after project end]</payment_date_check>
  <activity_match>[matches category X / doesn't match]</activity_match>
  <target_market>[international/domestic]</target_market>
</project_compliance>

<preliminary_assessment>
  <!-- Reasoning for verdict -->
</preliminary_assessment>
</thinking>

<expense_summary>
**Expense Details:**
- Vendor: [name]
- Amount (before taxes): $[amount]
- Taxes (MUST BE REMOVED): -$[amount]
- **Eligible Amount: $[amount]**
- **Estimated Reimbursement (50%): $[amount]**
- Invoice Date: [date]
- Payment Date: [date or "Not provided"]
- Category: [A-H with name]
- Description: [brief description]
</expense_summary>

<compliance_analysis>
**Critical Checks:**

✅/❌ Tax Removal: [Status - all taxes must be excluded from claim]
✅/❌ Project Dates: [Invoice and payment within project period]
✅/❌ Category Match: [Matches approved activities]
✅/❌ Target Market: [International, not domestic]
✅/❌ Documentation: [Required documents present/missing]
✅/❌ Financial Limits: [Under per diem caps, within guidelines]

**Rejection Pattern Analysis:**
[Check against each historical rejection pattern with specific reasoning]

**Compliance Score: [0-100%]**
[Brief explanation of score]
</compliance_analysis>

<verdict>
[For Quick Check Mode:]
**POTENTIALLY ELIGIBLE** - Passes general requirements
**LIKELY REJECTED** - Triggers rejection pattern: [specific pattern]
**NEEDS MORE INFO** - Missing: [specific information needed]

📋 For complete verification, please upload the project funding agreement.

[For Full Audit Mode:]
**✅ APPROVED FOR REIMBURSEMENT**
This expense is fully compliant. Estimated reimbursement: $[amount] (50% of $[eligible amount])

**⚠️ NEEDS ADJUSTMENT**
This expense can be approved with these changes:
- [Specific issue 1 and how to fix]
- [Specific issue 2 and how to fix]
Revised reimbursement after adjustments: $[amount]

**❌ REJECTED - NOT ELIGIBLE**
This expense cannot be reimbursed because:
- [Specific reason 1]
- [Specific reason 2]
[Reference to funding agreement section or rejection pattern]
</verdict>

<recommendations>
**Next Steps:**

[If approved:]
1. Remove $[amount] in taxes before submitting claim
2. Include [list required documentation]
3. Submit with claim form showing $[reimbursable amount]

[If needs adjustment:]
1. [Specific action item 1]
2. [Specific action item 2]
3. Resubmit with corrections for $[revised amount] reimbursement

[If rejected:]
1. Alternative approach: [compliant alternative if possible]
2. Consider these eligible options instead: [suggestions]
3. Contact [appropriate party] for clarification if needed

**Documentation Checklist:**
- [ ] Original invoice (without taxes)
- [ ] Proof of payment (bank statement/credit card)
- [ ] [Additional doc 1 if applicable]
- [ ] [Additional doc 2 if applicable]
</recommendations>
</output_format>

<examples>
**EXAMPLE 1: Approved Expense**

<thinking>
Mode: Full Audit

Expense extraction:
- Vendor: Global Marketing Solutions Inc.
- Amount before taxes: $5,000
- Taxes identified: $650 HST (must be removed)
- Invoice date: March 15, 2025
- Payment date: March 30, 2025
- Description: Digital marketing campaign for European market
- Proposed category: Category B - Marketing Materials

Rejection pattern check:
- Amazon/retail: Pass - legitimate marketing consultant
- Canadian domestic: Pass - explicitly targets European market
- Pre-project: Pass - invoice date after project start (Feb 1, 2025)
- Branding/design: Pass - export-specific marketing, not generic branding

Web search decision:
- Not needed - vendor type is clear from invoice, category is obvious

Financial compliance:
- Taxes removed: $650
- Eligible amount: $5,000
- 50% reimbursement: $2,500
- Per diem check: N/A (not travel)
- Currency conversion: N/A (CAD)
- Proof of payment: Credit card statement provided

Project compliance:
- Invoice date vs project start (Feb 1): Within period ✅
- Payment date vs project end (Dec 31): Within period ✅
- Activity match: Matches Category B (Marketing Materials) ✅
- Target market: European market (international) ✅

Preliminary assessment: Fully compliant, approve for $2,500 reimbursement
</thinking>

<expense_summary>
**Expense Details:**
- Vendor: Global Marketing Solutions Inc.
- Amount (before taxes): $5,000.00
- Taxes (MUST BE REMOVED): -$650.00 HST
- **Eligible Amount: $5,000.00**
- **Estimated Reimbursement (50%): $2,500.00**
- Invoice Date: March 15, 2025
- Payment Date: March 30, 2025
- Category: B - Marketing Materials
- Description: Digital marketing campaign targeting European market
</expense_summary>

<compliance_analysis>
**Critical Checks:**

✅ Tax Removal: $650 HST identified and removed
✅ Project Dates: Invoice (Mar 15) and payment (Mar 30) within project period
✅ Category Match: Matches Category B - Marketing Materials
✅ Target Market: European market (international)
✅ Documentation: Invoice and credit card statement provided
✅ Financial Limits: No caps applicable

**Rejection Pattern Analysis:**
- Amazon/retail purchase: Pass - legitimate marketing firm
- Domestic advertising: Pass - targets international markets
- Pre-project expense: Pass - invoice after project start
- Branding/design: Pass - export-specific marketing campaign

**Compliance Score: 100%**
All requirements met, full compliance achieved
</compliance_analysis>

<verdict>
**✅ APPROVED FOR REIMBURSEMENT**
This expense is fully compliant. Estimated reimbursement: $2,500.00 (50% of $5,000.00 eligible amount)
</verdict>

<recommendations>
**Next Steps:**

1. Remove $650.00 in HST before submitting claim
2. Include original invoice and credit card statement
3. Submit with claim form showing $2,500.00 reimbursable amount

**Documentation Checklist:**
- [x] Original invoice (without taxes)
- [x] Proof of payment (credit card statement)
- [x] Marketing deliverables showing European market focus
</recommendations>

**EXAMPLE 2: Rejected Expense**

<thinking>
Mode: Quick Check

Expense extraction:
- Vendor: Amazon.ca
- Amount before taxes: $850
- Taxes identified: $110.50 HST (must be removed)
- Invoice date: April 5, 2025
- Payment date: April 6, 2025
- Description: Office supplies (printer, folders, pens)
- Proposed category: Unclear - possibly Category A?

Rejection pattern check:
- Amazon/retail: FAIL - This is the exact historical rejection pattern
- Re-usable items: FAIL - Office supplies are re-usable, not export-specific

Web search decision:
- Not needed - Clear rejection pattern, no need to verify

Financial compliance:
- Taxes removed: $110.50
- Eligible amount: $739.50 (but irrelevant due to rejection)
- 50% reimbursement: N/A - expense ineligible
- Proof of payment: Credit card provided

Preliminary assessment: REJECT - Historical rejection pattern for Amazon office supplies
</thinking>

<expense_summary>
**Expense Details:**
- Vendor: Amazon.ca
- Amount (before taxes): $739.50
- Taxes (MUST BE REMOVED): -$110.50 HST
- **Eligible Amount: $0.00 (INELIGIBLE)**
- **Estimated Reimbursement (50%): $0.00**
- Invoice Date: April 5, 2025
- Payment Date: April 6, 2025
- Category: None - does not fit eligible categories
- Description: Office supplies (printer, folders, pens)
</expense_summary>

<compliance_analysis>
**Critical Checks:**

✅ Tax Removal: $110.50 HST identified
❌ Eligible Expense Type: Office supplies are re-usable items, not export-specific
❌ Rejection Pattern: Matches historical "Amazon office supplies rejected"

**Rejection Pattern Analysis:**
- Amazon/retail purchase: FAIL - This expense matches the exact historical rejection: "Amazon office supplies rejected for re-usable items ineligible"
- Re-usable items: FAIL - Printer, folders, and pens are permanent office equipment, not single-use export-specific materials

**Compliance Score: 0%**
This expense triggers an immediate rejection pattern and cannot be made compliant.
</compliance_analysis>

<verdict>
**❌ REJECTED - NOT ELIGIBLE**
This expense cannot be reimbursed because:
- Amazon retail purchases of office supplies are historically rejected
- Office equipment (printers, folders, pens) are re-usable items that benefit general business operations, not export-specific activities
- Does not fit any eligible CanExport category (A-H)

Historical precedent: Similar Amazon office supply claims have been rejected by NRC for being "re-usable items ineligible for reimbursement."
</verdict>

<recommendations>
**Next Steps:**

1. Alternative approach: Export-specific marketing materials (brochures, trade show banners) ARE eligible if they clearly display international market focus
2. Consider these eligible options instead:
   - Category B: Printed marketing materials for international trade shows
   - Category C: Translation services for export documentation
   - Category D: International shipping/courier for samples
3. Do not submit this Amazon office supplies expense - it will be rejected

**Documentation Checklist:**
- N/A - This expense type is ineligible
</recommendations>
</examples>

<critical_reminders>
- ALWAYS use <thinking> tags before responding
- Structure your thinking with the 7-step analysis workflow
- Your <thinking> is for internal reasoning - users see the analysis sections
- Never skip the thinking process - it ensures compliance accuracy
- After </thinking>, immediately provide the structured XML response
</critical_reminders>`,

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

${MEMORY_TOOL_INSTRUCTIONS}

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
  
  const isLargeFile = fileContent && fileContent.length > 50000;
  const maxDocs = isLargeFile ? 2 : 4;
  
  const taskDocMap = {
    'grant-criteria': ['grant_criteria_formatter', 'grant-criteria-formatter'],
    'preview': ['preview_section_generator', 'preview-section-generator'],
    'requirements': ['general_requirements_creator', 'general-requirements-creator'],
    'insights': ['granted_insights_generator', 'granted-insights-generator'],
    'categories': ['categories_tags_classifier', 'categories-tags-classifier'],
    'missing-info': ['missing_info_generator', 'missing-info-generator']
  };
  
  const taskPatterns = taskDocMap[task] || taskDocMap['grant-criteria'];
  const primaryDoc = docs.find(doc => 
    taskPatterns.some(pattern => doc.filename.toLowerCase().includes(pattern))
  );
  if (primaryDoc) selectedDocs.push(primaryDoc);
  
  const grantTypes = {
    hiring: ['hiring', 'wage', 'employment', 'workforce', 'intern', 'staff', 'talent', 'job'],
    training: ['training', 'skills', 'education', 'certification', 'development', 'learning'],
    rd: ['research', 'development', 'innovation', 'technology', 'r&d', 'commercialization'],
    market: ['market', 'expansion', 'export', 'capital', 'equipment', 'infrastructure', 'trade'],
    loan: ['loan', 'financing', 'interest', 'credit', 'debt', 'fund'],
    investment: ['investment', 'equity', 'venture', 'capital', 'investor', 'funding']
  };
  
  const industries = {
    technology: ['tech', 'software', 'ai', 'digital', 'innovation', 'startup'],
    agriculture: ['agricultural', 'farm', 'food', 'rural', 'crop'],
    healthcare: ['health', 'medical', 'life sciences', 'biotech', 'pharma'],
    energy: ['clean technology', 'renewable', 'energy', 'environmental'],
    indigenous: ['indigenous', 'first nations', 'aboriginal']
  };
  
  const fullContent = msg + ' ' + (fileContent || '') + ' ' + conversationText;
  let detectedGrantType = null;
  let detectedIndustry = null;
  
  for (const [type, keywords] of Object.entries(grantTypes)) {
    if (keywords.some(keyword => fullContent.includes(keyword))) {
      detectedGrantType = type;
      console.log(`🎯 Grant Cards Type Match: ${type}`);
      break;
    }
  }
  
  for (const [industry, keywords] of Object.entries(industries)) {
    if (keywords.some(keyword => fullContent.includes(keyword))) {
      detectedIndustry = industry;
      console.log(`🎯 Grant Cards Industry Match: ${industry}`);
      break;
    }
  }
  
  if (detectedGrantType) {
    const templateDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes(`${detectedGrantType} grant template`) ||
      (detectedGrantType === 'market' && doc.filename.toLowerCase().includes('market expansion'))
    );
    if (templateDoc && selectedDocs.length < maxDocs) selectedDocs.push(templateDoc);
    
    let exampleDoc = null;
    if (detectedIndustry) {
      exampleDoc = docs.find(doc => 
        doc.filename.toLowerCase().includes(`${detectedGrantType} - grant card example`) &&
        industries[detectedIndustry].some(keyword => doc.filename.toLowerCase().includes(keyword))
      );
    }
    
    if (!exampleDoc) {
      exampleDoc = docs.find(doc => 
        doc.filename.toLowerCase().includes(`${detectedGrantType} - grant card example`)
      );
    }
    
    if (exampleDoc && selectedDocs.length < maxDocs) selectedDocs.push(exampleDoc);
  }
  
  if (!detectedGrantType && detectedIndustry && selectedDocs.length < maxDocs) {
    const industryExample = docs.find(doc => 
      doc.filename.toLowerCase().includes('grant card example') &&
      industries[detectedIndustry].some(keyword => doc.filename.toLowerCase().includes(keyword))
    );
    if (industryExample) selectedDocs.push(industryExample);
  }
  
  if (selectedDocs.length === 0) {
    const formatterDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('grant_criteria_formatter') ||
      doc.filename.toLowerCase().includes('formatter')
    );
    if (formatterDoc) selectedDocs.push(formatterDoc);
  }
  
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
  
  const trainingTypes = {
    leadership: ['leadership', 'management', 'supervisor', 'manager'],
    technical: ['technical', 'automotive', 'construction', 'electrical', 'trades'],
    digital: ['digital', 'marketing', 'social media', 'seo', 'analytics'],
    professional: ['project management', 'hr', 'human resources', 'finance', 'accounting', 'sales'],
    certification: ['certificate', 'certification', 'cpa', 'excel', 'fundamentals']
  };
  
  const industries = {
    automotive: ['automotive', 'car', 'vehicle', 'kirmac'],
    construction: ['construction', 'electrical', 'building', 'contractor'],
    hospitality: ['wine', 'golf', 'restaurant', 'hospitality', 'victoria golf'],
    technology: ['tech', 'software', 'digital', 'it', 'capstone'],
    finance: ['finance', 'accounting', 'wealth', 'financial']
  };
  
  const companyIndicators = {
    large: ['corporation', 'inc', 'ltd', 'group', 'corporate'],
    small: ['local', 'family', 'boutique', 'startup']
  };
  
  const intents = {
    eligibility: ['eligible', 'qualify', 'requirements', 'criteria', 'allowed'],
    examples: ['example', 'similar', 'like this', 'show me', 'sample'],
    writing: ['write', 'create', 'draft', 'develop', 'help me write']
  };
  
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
  
  if (intents.examples.some(keyword => message.includes(keyword)) && selectedDocs.length < 4) {
    const recentExamples = allDocuments.filter(doc => 
      doc.filename.toLowerCase().includes('caliber') ||
      doc.filename.toLowerCase().includes('badinotti') ||
      doc.filename.toLowerCase().includes('v2 example') ||
      doc.filename.toLowerCase().includes('template005')
    );
    selectedDocs.push(...recentExamples.slice(0, 2));
  }
  
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
  
  const eligibilityDoc = docs.find(doc => 
    doc.filename.toLowerCase().includes('bcafe-eligibility-checklist')
  );
  if (eligibilityDoc) selectedDocs.push(eligibilityDoc);
  
  const programGuideDoc = docs.find(doc => 
    doc.filename.toLowerCase().includes('bcafe-program-guide-summer-2025')
  );
  if (programGuideDoc) selectedDocs.push(programGuideDoc);
  
  const intents = {
    eligibility: ['eligible', 'qualify', 'requirements', 'criteria', 'can i apply'],
    budget: ['budget', 'cost', 'funding', 'money', 'expense', 'financial'],
    merit: ['merit', 'scoring', 'competitive', 'optimize', 'evaluation', 'points'],
    application: ['application', 'questions', 'write', 'draft', 'create', 'build'],
    examples: ['example', 'successful', 'sample', 'similar', 'show me']
  };
  
  const industries = {
    food: ['food', 'foods', 'restaurant', 'catering', 'fine choice'],
    beverage: ['coffee', 'drink', 'beverage', 'forecast', 'brewing'],
    agriculture: ['farm', 'agricultural', 'level ground', 'organic', 'produce']
  };
  
  if (intents.budget.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    const budgetDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-budget-template-guide')
    );
    if (budgetDoc) selectedDocs.push(budgetDoc);
    console.log(`🎯 BCAFE Intent Match: budget`);
  }
  
  if (intents.merit.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    const meritDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-merit-criteria-guide')
    );
    if (meritDoc) selectedDocs.push(meritDoc);
    console.log(`🎯 BCAFE Intent Match: merit`);
  }
  
  if (intents.application.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
    const appDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-application-questions')
    );
    if (appDoc) selectedDocs.push(appDoc);
    console.log(`🎯 BCAFE Intent Match: application`);
  }
  
  if (intents.examples.some(keyword => msg.includes(keyword) || conversationText.includes(keyword))) {
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
    
    if (!selectedDocs.some(doc => doc.filename.includes('successful-application'))) {
      const anyExample = docs.find(doc => 
        doc.filename.toLowerCase().includes('successful-application')
      );
      if (anyExample) selectedDocs.push(anyExample);
    }
  }
  
  if (intents.eligibility.some(keyword => msg.includes(keyword)) || conversationHistory.length <= 2) {
    const activityDoc = docs.find(doc => 
      doc.filename.toLowerCase().includes('bcafe-activity-examples')
    );
    if (activityDoc && selectedDocs.length < 4) selectedDocs.push(activityDoc);
  }
  
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
  
  const mainInvoiceGuide = docs.find(doc => 
    doc.filename.toLowerCase().includes('canexport invoice guide') ||
    doc.filename.toLowerCase().includes('invoice guide canexport')
  );
  if (mainInvoiceGuide) selectedDocs.push(mainInvoiceGuide);

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
  
  const intents = {
    categories: ['category', 'categories', 'eligible', 'classification', 'type of expense'],
    compliance: ['compliance', 'checklist', 'verify', 'audit', 'review', 'check'],
    templates: ['template', 'format', 'report', 'summary', 'audit report'],
    receipt: ['receipt', 'invoice', 'document', 'expense', 'claim', 'payment']
  };
  
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
  
  const fullContent = msg + ' ' + conversationText;
  let detectedCategory = null;
  
  for (const [category, keywords] of Object.entries(expenseCategories)) {
    if (keywords.some(keyword => fullContent.includes(keyword))) {
      detectedCategory = category;
      console.log(`🎯 CanExport Claims Category Match: ${category}`);
      break;
    }
  }
  
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
  
  if (!selectedDocs.some(doc => doc.filename.toLowerCase().includes('invoice guide'))) {
    const backupGuide = docs.find(doc => 
      doc.filename.toLowerCase().includes('invoice guide') ||
      doc.filename.toLowerCase().includes('guide')
    );
    if (backupGuide && selectedDocs.length < 3) selectedDocs.push(backupGuide);
  }
  
  if (selectedDocs.length === 0) {
    selectedDocs.push(...docs.slice(0, 3));
  }
  
  const uniqueDocs = [...new Set(selectedDocs)].slice(0, 3);
  
  console.log(`🎯 CanExport Claims Smart Selection: ${uniqueDocs.length} docs selected from ${docs.length} total`);
  console.log(`   Intent: Claims Processing, Category: ${detectedCategory || 'general'}`);
  console.log(`   Selected: ${uniqueDocs.map(d => d.filename).join(', ')}`);
  
  return uniqueDocs;
}

// Get Google Access Token using Service Account
async function getGoogleAccessToken() {
  if (googleAccessToken && Date.now() < tokenExpiry) {
    return googleAccessToken;
  }

  try {
    if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error('Google Service Account key not configured');
    }

    const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };

    const header = { alg: 'RS256', typ: 'JWT' };
    const headerBase64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const payloadBase64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    
    const signData = `${headerBase64}.${payloadBase64}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signData), serviceAccount.private_key);
    const signatureBase64 = base64UrlEncode(signature);
    
    const jwt = `${headerBase64}.${payloadBase64}.${signatureBase64}`;

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
    tokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000;

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
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`✅ Cache HIT for ${agentType} (${Date.now() - startTime}ms)`);
      return cachedData;
    }
    
    console.log(`⚠️ Cache MISS for ${agentType} - Loading from Google Drive...`);
    
    const agentDocs = [];
    
    if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
      console.log('Google Drive not configured');
      return [];
    }

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
    
    await redis.set(cacheKey, agentDocs);
    
    const loadTime = Date.now() - startTime;
    logAgentPerformance(agentType, agentDocs.length, loadTime);
    
    console.log(`📦 Cached ${agentDocs.length} documents for ${agentType}`);
    return agentDocs;
    
  } catch (error) {
    console.error(`Redis error for ${agentType}:`, error);
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
    
    const accessToken = await getGoogleAccessToken();
    
    knowledgeBases = {
      'grant-cards': [],
      'etg': [],
      'bcafe': [],
      'canexport': [],
      'canexport-claims': [],
      'readiness-strategist': [],
      'internal-oracle': []
    };

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
    
    for (const item of mainFolderContents.files) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const agentName = item.name.toLowerCase();
        
        if (knowledgeBases[agentName]) {
          console.log(`📂 Loading ${agentName} documents...`);
          await loadAgentDocuments(item.id, agentName, accessToken);
        }
      }
    }

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
    knowledgeBaseLoaded = true;
  }
}

// Load documents for a specific agent from their Google Drive folder
async function loadAgentDocuments(folderId, agentName, accessToken) {
  try {
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
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        continue;
      }
      
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

// Enhanced PDF processing with better error handling
async function loadFileContent(file, accessToken) {
  const { id, name, mimeType } = file;
  
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
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
        const data = await pdf(Buffer.from(buffer));
        return data.text;
      } catch (primaryError) {
        console.log(`   ⚠️ PDF parsing warning for ${name}, trying fallback method...`);
        try {
          const data = await pdf(Buffer.from(buffer), {
            normalizeWhitespace: false,
            disableCombineTextItems: false,
            max: 0
          });
          return data.text;
        } catch (fallbackError) {
          console.log(`   ❌ PDF extraction failed for ${name}:`);
          console.log(`     Primary error: ${primaryError.message}`);
          console.log(`     Fallback error: ${fallbackError.message}`);
          return `PDF Document: ${name}\n[Content extraction failed due to PDF formatting issues. Consider converting to Word or Google Doc format for better extraction.]`;
        }
      }
      
    } else if (mimeType.includes('officedocument') || mimeType.includes('opendocument')) {
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

// Simple file processing (no base64 encoding)
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
      content = file.buffer.toString('utf8');
    }
    
    console.log(`✅ File processed successfully (${content.length} characters extracted)`);
    return content;
    
  } catch (fileError) {
    console.error('File processing error:', fileError);
    throw new Error(`Error processing file: ${fileError.message}`);
  }
}

// Fetch URL content (LEGACY - for ETG courseUrl parameter backward compatibility)
// NOTE: This function returns mock data. Other agents now use the native web_fetch tool
// which automatically fetches real content from URLs detected in conversation context.
async function fetchURLContent(url) {
  try {
    console.log(`🔗 Fetching content from: ${url} (LEGACY - mock data)`);

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
      const contentMatches = (content.match(new RegExp(term, 'g')) || []).length;
      relevanceScore += contentMatches;
      
      const filenameMatches = (filename.match(new RegExp(term, 'g')) || []).length;
      relevanceScore += filenameMatches * 3;
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

// Rate limiting with safeguards
function checkRateLimit() {
  const now = Date.now();
  
  callTimestamps = callTimestamps.filter(timestamp => now - timestamp < 60000);
  
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

// WEB SEARCH CONFIGURATION
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

// Agent-specific web search tool configurations
const CANEXPORT_CLAIMS_WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
  allowed_domains: [
    "tradecommissioner.gc.ca",
    "nrc-cnrc.gc.ca",
    "canada.ca",
    "international.gc.ca"
  ],
  user_location: {
    type: "approximate",
    city: "Vancouver",
    region: "British Columbia",
    country: "CA",
    timezone: "America/Vancouver"
  }
};

// Get agent-specific web search tool
function getWebSearchTool(agentType) {
  if (agentType === 'canexport-claims') {
    return CANEXPORT_CLAIMS_WEB_SEARCH_TOOL;
  }
  return WEB_SEARCH_TOOL;
}

// WEB FETCH CONFIGURATION
const WEB_FETCH_TOOL = {
  type: "web_fetch_20250910",
  name: "web_fetch",
  max_uses: 5
};

// Get web fetch tool (same for all agents currently)
function getWebFetchTool(agentType) {
  return WEB_FETCH_TOOL;
}

// MEMORY TOOL: Currently disabled pending migration to serverful platform
// Anthropic's memory tool (memory_20250818) requires client-side storage backend
// (filesystem, database, Redis, etc.) which doesn't work in current serverless environment
// TODO: Implement when migrated to serverful platform with backend database
// See: api/memory-tool-handler.js for implementation reference

// Enhanced Claude API integration with Files API support
async function callClaudeAPI(messages, systemPrompt = '', files = []) {
  try {
    checkRateLimit();
    await waitForRateLimit();

    console.log(`🔥 Making Claude API call (${callTimestamps.length + 1}/${MAX_CALLS_PER_MINUTE} this minute)`);
    console.log(`🔧 Tools available: web_search (max 5 uses), memory`);
    console.log(`📄 Files to process: ${files.length}`);
    
    let apiMessages = [...messages];
    
    if (files.length > 0) {
      const lastUserMessage = apiMessages[apiMessages.length - 1];
      const contentBlocks = [];
      
      // First, handle existing content (could be string or array of blocks)
      if (lastUserMessage.content) {
        if (typeof lastUserMessage.content === 'string') {
          // Simple string content
          if (lastUserMessage.content.trim()) {
            contentBlocks.push({
              type: "text",
              text: lastUserMessage.content
            });
          }
        } else if (Array.isArray(lastUserMessage.content)) {
          // Already an array of content blocks - merge them
          contentBlocks.push(...lastUserMessage.content);
        }
      }
      
      // Then add new uploaded files
      for (const file of files) {
        try {
          const uploadResult = await uploadFileToAnthropic(file);
          
          const isImage = file.mimetype && file.mimetype.startsWith('image/');
          
          if (isImage) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "file",
                file_id: uploadResult.file_id
              }
            });
            console.log(`🔸 Added image file: ${uploadResult.originalname}`);
          } else {
            contentBlocks.push({
              type: "document",
              source: {
                type: "file",
                file_id: uploadResult.file_id
              }
            });
            console.log(`📄 Added document file: ${uploadResult.originalname}`);
          }
        } catch (uploadError) {
          console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
          continue;
        }
      }
      
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
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14,context-management-2025-06-27,web-fetch-2025-09-10'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        system: systemPrompt,
        messages: apiMessages,
        tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL]
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
    
    console.log('🔄 RESPONSE ANALYSIS:');
    console.log(`   Content blocks: ${data.content?.length || 0}`);

    let toolUsageCount = 0;
    let webSearchCount = 0;
    let webFetchCount = 0;
    let textContent = '';

    for (const block of data.content || []) {
      console.log(`   Block type: ${block.type}`);

      if (block.type === 'text') {
        textContent += block.text;
        console.log(`   Text length: ${block.text?.length || 0} chars`);
      }
      else if (block.type === 'server_tool_use') {
        toolUsageCount++;
        if (block.name === 'web_search') {
          webSearchCount++;
          console.log(`   🌐 WEB SEARCH INITIATED: ${block.name}`);
          console.log(`   Tool ID: ${block.id}`);
          if (block.input?.query) {
            console.log(`   Query: "${block.input.query}"`);
          }
        } else if (block.name === 'web_fetch') {
          webFetchCount++;
          console.log(`   🔗 WEB FETCH INITIATED: ${block.name}`);
          console.log(`   Tool ID: ${block.id}`);
          if (block.input?.url) {
            console.log(`   URL: "${block.input.url}"`);
          }
        }
      }
      else if (block.type === 'web_search_tool_result') {
        console.log(`   📄 WEB SEARCH RESULT: Found ${block.content?.length || 0} results`);
      }
      else if (block.type === 'web_fetch_tool_result') {
        console.log(`   📄 WEB FETCH RESULT: Fetched content (${block.content?.length || 0} chars)`);
      }
    }

    if (toolUsageCount > 0) {
      console.log(`🌐 Tools used: ${webSearchCount} searches, ${webFetchCount} fetches`);
    } else {
      console.log(`📚 No tools used - Claude answered from knowledge base`);
    }

    console.log(`📊 Usage: ${data.usage?.input_tokens || 0} in + ${data.usage?.output_tokens || 0} out tokens`);

    // Native memory tool (memory_20250818) is handled automatically by Anthropic
    // No manual processing required

    // Return full content blocks (including tool_use and tool_result blocks)
    // to preserve tool usage history in conversation
    // For backward compatibility with code expecting strings, also provide text extraction
    if (data.content && data.content.length > 0) {
      return data.content;
    }

    // Fallback to text-only if no content blocks (shouldn't happen)
    return textContent;
    
  } catch (error) {
    console.error('Claude API Error:', error);
    
    if (error.message.includes('Rate limit')) {
      throw new Error(`${error.message}\n\nTip: Wait 2-3 minutes between requests, or try smaller documents.`);
    }
    
    throw new Error('Failed to get response from Claude API: ' + error.message);
  }
}

// Enhanced Streaming Claude API with Files API support + Extended Thinking
async function callClaudeAPIStream(messages, systemPrompt = '', res, files = [], agentType = 'grant-cards') {
  // Declare these variables at function scope
  let fullContentBlocks = [];
  let currentTextBlock = '';
  let currentThinkingBlock = null;
  let currentToolUseBlock = null;

  try {
    checkRateLimit();
    await waitForRateLimit();

    const webSearchTool = getWebSearchTool(agentType);
    const webFetchTool = getWebFetchTool(agentType);
    console.log(`🔥 Making streaming Claude API call with Extended Thinking`);
    console.log(`🤖 Agent: ${agentType}`);
    console.log(`🔧 Tools available: web_search (max ${webSearchTool.max_uses} uses), web_fetch (max ${webFetchTool.max_uses} uses)`);
    if (webSearchTool.allowed_domains) {
      console.log(`🔒 Allowed domains: ${webSearchTool.allowed_domains.join(', ')}`);
    }
    console.log(`📄 Files to process: ${files.length}`);
    
    let apiMessages = [...messages];
    
    if (files.length > 0) {
      const lastUserMessage = apiMessages[apiMessages.length - 1];
      const contentBlocks = [];
      
      if (lastUserMessage.content) {
        if (typeof lastUserMessage.content === 'string') {
          if (lastUserMessage.content.trim()) {
            contentBlocks.push({
              type: "text",
              text: lastUserMessage.content
            });
          }
        } else if (Array.isArray(lastUserMessage.content)) {
          contentBlocks.push(...lastUserMessage.content);
        }
      }
      
      for (const file of files) {
        try {
          const uploadResult = await uploadFileToAnthropic(file);
          
          const isImage = file.mimetype && file.mimetype.startsWith('image/');
          
          if (isImage) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "file",
                file_id: uploadResult.file_id
              }
            });
            console.log(`🔸 Added image file: ${uploadResult.originalname}`);
          } else {
            contentBlocks.push({
              type: "document",
              source: {
                type: "file",
                file_id: uploadResult.file_id
              }
            });
            console.log(`📄 Added document file: ${uploadResult.originalname}`);
          }
        } catch (uploadError) {
          console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
          continue;
        }
      }
      
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
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14,context-management-2025-06-27,web-fetch-2025-09-10'
      },
      body: (() => {
        const requestBody = {
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 16000,
          system: systemPrompt,
          messages: apiMessages,
          stream: true,
          tools: [webSearchTool, webFetchTool]
        };

        // Extended Thinking enabled for all agents
        // canexport-claims uses both Extended Thinking AND XML <thinking> tags (like ETG does)
        requestBody.thinking = {
          type: "enabled",
          budget_tokens: 10000
        };

        console.log(`🔍 API Request Body - Agent: ${agentType}`);
        console.log(`   Extended Thinking: ENABLED (budget: 10000 tokens)`);

        return JSON.stringify(requestBody);
      })()
    });

    lastAPICall = Date.now();
    callTimestamps.push(lastAPICall);
    apiCallCount++;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

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
    let thinkingBuffer = '';  // Buffer thinking (don't show to user)
let inThinkingBlock = false;

console.log(`🚀 Starting streaming response with Extended Thinking + XML structured output...`);

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
              console.log(`✅ Streaming completed`);
              if (thinkingBuffer) {
                console.log(`🧠 Thinking used: ${thinkingBuffer.length} chars (hidden from user)`);
              }
              if (toolUsageCount > 0) {
                console.log(`🔧 Total tools used: ${toolUsageCount}`);
              }
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle thinking blocks (buffer, don't stream to user)
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking') {
  inThinkingBlock = true;
  currentThinkingBlock = { type: 'thinking', thinking: '' };
  console.log(`🧠 Thinking block started`);
  continue;
}
              
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
  thinkingBuffer += parsed.delta.thinking;
  if (currentThinkingBlock) {
    currentThinkingBlock.thinking += parsed.delta.thinking;
  }
  continue;
}
              // Capture signature for thinking blocks
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'signature_delta') {
        if (currentThinkingBlock) {
          if (!currentThinkingBlock.signature) {
            currentThinkingBlock.signature = '';
          }
          currentThinkingBlock.signature += parsed.delta.signature;
        }
        continue;
      }
              
              if (parsed.type === 'content_block_stop' && inThinkingBlock) {
  inThinkingBlock = false;
  if (currentThinkingBlock) {
    fullContentBlocks.push(currentThinkingBlock);
    currentThinkingBlock = null;
  }
  console.log(`🧠 Thinking block completed`);
  continue;
}
              
              // Handle text blocks (stream to user)
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'text') {
  currentTextBlock = '';
  continue;
}

if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
  const chunk = parsed.delta.text;
  currentTextBlock += chunk;
  res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
}

if (parsed.type === 'content_block_stop' && currentTextBlock !== '') {
  fullContentBlocks.push({ type: 'text', text: currentTextBlock });
  currentTextBlock = '';
}
              
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                toolUsageCount++;

                const toolName = parsed.content_block.name;
                if (toolName === 'web_search') {
                  console.log(`🌐 STREAMING TOOL USED: web_search`);
                  if (parsed.content_block.input?.query) {
                    console.log(`   Query: "${parsed.content_block.input.query}"`);
                  }
                } else if (toolName === 'web_fetch') {
                  console.log(`🔗 STREAMING TOOL USED: web_fetch`);
                  if (parsed.content_block.input?.url) {
                    console.log(`   URL: "${parsed.content_block.input.url}"`);
                  }
                }

                // Capture complete tool_use block for conversation history
                currentToolUseBlock = {
                  type: 'tool_use',
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                  input: parsed.content_block.input
                };

                res.write(`data: ${JSON.stringify({
                  tool_use: {
                    name: parsed.content_block.name,
                    query: parsed.content_block.input?.query,
                    url: parsed.content_block.input?.url
                  }
                })}\n\n`);
              }

              // Handle tool result blocks from server tools (e.g., web_search, web_fetch)
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'web_search_tool_result') {
                console.log(`📄 WEB SEARCH RESULT: Received results`);

                // Capture tool result block for conversation history
                const toolResultBlock = {
                  type: 'web_search_tool_result',
                  content: parsed.content_block.content || []
                };
                fullContentBlocks.push(toolResultBlock);

                // Note: Tool results are not streamed to user, only the final text response
              }

              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'web_fetch_tool_result') {
                console.log(`🔗 WEB FETCH RESULT: Received content`);

                // Capture tool result block for conversation history
                const toolResultBlock = {
                  type: 'web_fetch_tool_result',
                  content: parsed.content_block.content || ''
                };
                fullContentBlocks.push(toolResultBlock);

                // Note: Tool results are not streamed to user, only the final text response
              }

              // When a content block stops, finalize tool_use blocks
              if (parsed.type === 'content_block_stop' && currentToolUseBlock) {
                fullContentBlocks.push(currentToolUseBlock);
                console.log(`🔧 Tool use block captured: ${currentToolUseBlock.name}`);
                currentToolUseBlock = null;
              }
              
            } catch (parseError) {
              continue;
           }
          }  // closes if (line.startsWith('data: '))
        }  // closes the for loop (processing lines)
      }  // Closes the while (true) loop

      // Stream ended naturally without [DONE] signal - close it properly
      console.log(`✅ Stream completed naturally (no [DONE] signal)`);
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (streamError) {
      console.error('Streaming error:', streamError);
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.end();
    }
    
  } catch (error) {
    console.error('Claude Streaming API Error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
  
  // Return captured content blocks for conversation history
  return fullContentBlocks;
}

// Upload file to Anthropic's Files API (serverless-friendly)
async function uploadFileToAnthropic(file) {
  try {
    console.log(`📤 Uploading ${file.originalname} to Files API...`);
    
    const formData = new FormData();
    
    const blob = new Blob([file.buffer], { type: file.mimetype });
    formData.append('file', blob, file.originalname);
    
    const response = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14'
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Files API upload failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ File uploaded successfully: ${result.id} (${file.originalname})`);
    
    return {
      file_id: result.id,
      originalname: file.originalname,
      mimetype: file.mimetype
    };
    
  } catch (error) {
    console.error(`❌ Files API upload error for ${file.originalname}:`, error);
    throw new Error(`Failed to upload ${file.originalname}: ${error.message}`);
  }
}

// ===== UNIFIED STREAMING REQUEST HANDLER =====
async function handleStreamingRequest(req, res, agentType) {
  const startTime = Date.now();

  // Get user ID from JWT token
  const userId = getUserIdFromJWT(req);
  if (!userId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized - invalid or missing authentication' }));
    return;
  }

  // Handle multipart form data
  await new Promise((resolve, reject) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const { message, task, conversationId, url: courseUrl } = req.body;

  // Use conversationId as-is (frontend generates UUID)
  // Get existing file context
  let conversationMeta = await getConversationFileContext(conversationId);
  console.log(`📋 STREAMING (${agentType}): ${conversationMeta.uploadedFiles.length} existing files`);
  
  // Process NEW uploaded files with Files API
  let newUploadResults = [];
  if (req.files && req.files.length > 0) {
    console.log(`📄 Uploading ${req.files.length} new documents to Files API for ${agentType}`);
    
    for (const file of req.files) {
      try {
        const uploadResult = await uploadFileToAnthropic(file);
        newUploadResults.push(uploadResult);
        console.log(`✅ Uploaded ${file.originalname} → ${uploadResult.file_id}`);
      } catch (uploadError) {
        console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
      }
    }
    
    if (newUploadResults.length > 0) {
      conversationMeta = await updateConversationFileContext(conversationId, newUploadResults);
      console.log(`✅ Added ${newUploadResults.length} files to ${agentType} conversation context`);
    }
  }

  // Get/create conversation from database
  let conversation = await getConversation(conversationId, userId);
  if (conversation.length === 0) {
    console.log(`🆕 Starting new conversation: ${conversationId}`);
  } else {
    console.log(`📜 Loaded conversation: ${conversationId} (${conversation.length} messages)`);
  }
  
  // Load agent-specific knowledge base
  const agentDocs = await loadAgentSpecificKnowledgeBase(agentType);
  const loadTime = Date.now() - startTime;
  logAgentPerformance(agentType, agentDocs.length, loadTime);
  
  // Select relevant documents based on agent type
  let relevantDocs = [];
  let knowledgeContext = '';
  
  if (agentType === 'grant-cards') {
    relevantDocs = selectGrantCardDocuments(task, message, '', conversation, agentDocs);
  } else if (agentType === 'etg-writer') {
    relevantDocs = selectETGDocuments(message, conversation, agentDocs);
  } else if (agentType === 'bcafe-writer') {
    relevantDocs = selectBCAFEDocuments(message, null, conversation, agentDocs);
  } else if (agentType === 'canexport-claims') {
    relevantDocs = selectCanExportClaimsDocuments(message, conversation, agentDocs);
  } else {
    relevantDocs = agentDocs.slice(0, 3);
  }
  
  if (relevantDocs.length > 0) {
    knowledgeContext = relevantDocs
      .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
      .join('\n\n');
  }
  
  // Build system prompt based on agent type
  let systemPrompt;
  let taskMethodologyPrompt = '';  // For grant-cards agent, this holds the task-specific methodology

  if (agentType === 'grant-cards') {
    const prompts = buildGrantCardSystemPrompt(task, knowledgeContext);
    systemPrompt = prompts.system;
    taskMethodologyPrompt = prompts.user;  // This will be prepended to user message
  } else {
    systemPrompt = buildSystemPromptWithFileContext(
      agentPrompts[agentType],
      knowledgeContext,
      conversationMeta,
      agentType
    );
  }

  // Build user message with persistent file memory
  let userMessage = message || `Hello, I need help with ${agentType.replace('-', ' ')}.`;

  // Add course URL content if provided (ETG specific)
  if (courseUrl && agentType === 'etg-writer') {
    const urlContent = await fetchURLContent(courseUrl);
    userMessage += `\n\nCourse URL Content Analysis:\n${urlContent}`;
  }

  // For grant-cards agent, prepend task methodology to user message
  if (agentType === 'grant-cards' && taskMethodologyPrompt) {
    userMessage = taskMethodologyPrompt + '\n\n<user_input>\n' + userMessage + '\n</user_input>';
  }

  // Build message content with all file context
  const messageContent = buildMessageContentWithFiles(userMessage, conversationMeta);
  
  // Context management
  const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);
  logContextUsage(agentType, estimatedContext, conversation.length);
  pruneConversation(conversation, agentType, estimatedContext);
  
  // Add user message to conversation
  conversation.push({ role: 'user', content: messageContent });

  // Save user message to Redis immediately (before streaming response)
  // This ensures subsequent requests see the conversation even if streaming is still in progress
  try {
    await redis.set(`conv:${conversationId}`, conversation, { ex: 86400 });
    console.log(`✅ User message saved to Redis (${conversation.length} messages)`);
  } catch (redisError) {
    console.error(`❌ Redis save failed:`, redisError.message);
  }

  // Stream response with Files API integration
  console.log('📋 Streaming with full file memory integration');
  console.log(`   Files available: ${conversationMeta.uploadedFiles.length}`);
  console.log(`   New files uploaded: ${newUploadResults.length}`);

// Stream response and capture full content blocks for conversation history
const fullContentBlocks = await callClaudeAPIStream(conversation, systemPrompt, res, req.files || [], agentType);

// Store full response (with thinking blocks) in conversation history
if (fullContentBlocks && fullContentBlocks.length > 0) {
  conversation.push({ role: 'assistant', content: fullContentBlocks });
  console.log(`💾 Stored response with ${fullContentBlocks.length} content blocks in conversation history`);

  // Save conversation to database
  console.log(`🔍 About to call saveConversation from streaming handler`);
  console.log(`   conversationId: ${conversationId}`);
  console.log(`   userId: ${userId}`);
  console.log(`   agentType: ${agentType}`);
  console.log(`   conversation.length: ${conversation.length}`);

  try {
    await saveConversation(conversationId, userId, conversation, agentType);
    console.log(`✅ saveConversation completed successfully`);
  } catch (saveError) {
    // Log but don't fail the request if save fails
    console.error(`❌ saveConversation failed (non-fatal):`, saveError.message);
  }
} else {
  console.log(`⚠️ No content blocks to save (fullContentBlocks: ${fullContentBlocks})`);
}
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

// ===== MAIN HANDLER =====
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
  if (Math.random() < 0.1) {
    cleanupExpiredConversations();
  }

  // Apply authentication middleware
  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch (authError) {
    return;
  }

  try {
    // GET conversation history endpoint
    if (url.startsWith('/api/conversation/') && method === 'GET') {
      const conversationId = url.split('/api/conversation/')[1];
      const userId = getUserIdFromJWT(req);

      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      if (!conversationId) {
        res.status(400).json({ success: false, message: 'Missing conversationId' });
        return;
      }

      console.log(`📖 Loading conversation: ${conversationId} for user: ${userId}`);

      try {
        const conversation = await getConversation(conversationId, userId);

        res.json({
          success: true,
          conversationId: conversationId,
          messages: conversation,
          messageCount: conversation.length
        });
      } catch (error) {
        console.error(`❌ Error loading conversation:`, error);
        res.status(500).json({
          success: false,
          message: 'Failed to load conversation',
          error: error.message
        });
      }
      return;
    }

    // GET all conversations for user endpoint
    if (url.startsWith('/api/conversations') && method === 'GET') {
      const userId = getUserIdFromJWT(req);

      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      // Parse query parameters for filtering
      const urlParts = url.split('?');
      const queryParams = new URLSearchParams(urlParts[1] || '');
      const agentTypeFilter = queryParams.get('agent_type');

      console.log(`📚 Loading conversations for user: ${userId}${agentTypeFilter ? `, agent: ${agentTypeFilter}` : ''}`);

      // SIMPLE APPROACH: Load directly from PostgreSQL (reliable, fast enough)
      try {
        let query = `SELECT
            c.id,
            c.agent_type,
            c.title,
            c.created_at,
            c.updated_at,
            COUNT(m.id) as message_count
          FROM conversations c
          LEFT JOIN messages m ON c.id = m.conversation_id
          WHERE c.user_id = $1`;

        const params = [userId];

        if (agentTypeFilter) {
          query += ` AND c.agent_type = $2`;
          params.push(agentTypeFilter);
        }

        query += ` GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT 100`;

        const result = await queryWithTimeout(query, params, 10000);  // 10s timeout

        const conversations = result.rows.map(row => ({
          id: row.id,
          agentType: row.agent_type,
          title: row.title || 'Untitled Conversation',
          messageCount: parseInt(row.message_count) || 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));

        console.log(`✅ Found ${conversations.length} conversations from PostgreSQL`);

        res.json({
          success: true,
          conversations: conversations,
          count: conversations.length
        });
      } catch (error) {
        console.error(`❌ Error loading conversations:`, error.message);
        res.status(500).json({
          success: false,
          message: 'Failed to load conversations',
          error: error.message
        });
      }
      return;
    }

    // DEPRECATED Redis-based conversation loading - keeping for reference but not used
    if (false && url.startsWith('/api/conversations-redis') && method === 'GET') {
      const userId = getUserIdFromJWT(req);
      const urlParts = url.split('?');
      const queryParams = new URLSearchParams(urlParts[1] || '');
      const agentTypeFilter = queryParams.get('agent_type');

      try {
        const conversations = [];

        // Try to get from user-specific Redis set first
        console.log(`🔍 Loading conversations from Redis set for user: ${userId}`);

        let convIds = [];
        try {
          convIds = await redis.smembers(`user:${userId}:conversations`);
          console.log(`🔍 Found ${convIds.length} conversation IDs in Redis set`);
        } catch (redisSetError) {
          // If key exists as wrong type, delete and fall back to PostgreSQL
          if (redisSetError.message.includes('WRONGTYPE')) {
            console.warn(`⚠️  Deleting corrupted Redis key: user:${userId}:conversations`);
            await redis.del(`user:${userId}:conversations`);
            throw new Error('Redis set corrupted, cleaned up - falling back to PostgreSQL');
          }
          throw redisSetError;
        }

        // If Redis set is empty, fall back to PostgreSQL to get existing conversations
        if (convIds.length === 0) {
          console.log(`📭 Redis set empty, falling back to PostgreSQL to rebuild`);
          throw new Error('Redis set empty - falling back to PostgreSQL');
        }

        // Load each conversation's metadata
        for (const convId of convIds) {
          try {
            const convData = await redis.get(`conv:${convId}`);
            if (!convData) {
              console.warn(`⚠️  Conversation ${convId} not found in Redis, skipping`);
              continue;
            }

            // Try to parse, if fails it's corrupted
            let parsed;
            try {
              parsed = JSON.parse(convData);
            } catch (parseError) {
              console.log(`🧹 Cleaning up corrupted conversation data for ${convId}`);
              await redis.del(`conv:${convId}`);
              await redis.srem(`user:${userId}:conversations`, convId);
              continue;
            }

            if (Array.isArray(parsed) && parsed.length > 0) {
              const firstUserMsg = parsed.find(msg => msg.role === 'user');
              if (!firstUserMsg) continue;

              // Extract title from first user message
              let title = 'Untitled Conversation';
              if (typeof firstUserMsg.content === 'string') {
                title = firstUserMsg.content.substring(0, 100);
              } else if (Array.isArray(firstUserMsg.content)) {
                let content = '';
                firstUserMsg.content.forEach(block => {
                  if (block.type === 'text' && block.text) {
                    content += block.text;
                  }
                });
                title = content.substring(0, 100);
              }

              // Get metadata from Redis (faster, always available)
              let agentType = 'unknown';
              let createdAt = new Date().toISOString();
              let updatedAt = new Date().toISOString();

              try {
                const metaData = await redis.get(`conv:${convId}:meta`);
                if (metaData) {
                  const meta = JSON.parse(metaData);
                  agentType = meta.agentType || 'unknown';
                  createdAt = meta.createdAt || createdAt;
                  updatedAt = meta.updatedAt || updatedAt;
                } else {
                  // Fallback to PostgreSQL if metadata not in Redis
                  console.log(`📭 No Redis metadata for ${convId}, trying PostgreSQL...`);
                  const metaResult = await queryWithTimeout(
                    'SELECT agent_type, created_at, updated_at FROM conversations WHERE id = $1',
                    [convId],
                    1000
                  );
                  if (metaResult.rows.length > 0) {
                    agentType = metaResult.rows[0].agent_type;
                    createdAt = metaResult.rows[0].created_at || createdAt;
                    updatedAt = metaResult.rows[0].updated_at || updatedAt;
                  } else {
                    console.warn(`⚠️  Conversation ${convId} not found in Redis or PostgreSQL, skipping`);
                    continue;
                  }
                }
              } catch (metaError) {
                console.warn(`⚠️  Failed to get metadata for ${convId}:`, metaError.message);
                continue;
              }

              conversations.push({
                id: convId,
                agentType: agentType,
                title: title,
                messageCount: parsed.length,
                createdAt: createdAt,
                updatedAt: updatedAt
              });
            }
          } catch (convError) {
            console.warn(`⚠️  Failed to load conversation ${convId}:`, convError.message);
            continue;
          }
        }

        // Filter by agent type if specified
        let filteredConversations = conversations;
        if (agentTypeFilter) {
          filteredConversations = conversations.filter(conv => conv.agentType === agentTypeFilter);
          console.log(`🔍 Filtered to ${filteredConversations.length} conversations for agent: ${agentTypeFilter}`);
        }

        // Sort by most recent (we'll use creation time, but ideally track update time)
        filteredConversations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        console.log(`✅ Loaded ${filteredConversations.length} conversations from Redis`);

        // If all conversations were corrupted/deleted, fall back to PostgreSQL
        if (convIds.length > 0 && filteredConversations.length === 0 && !agentTypeFilter) {
          console.log(`🔄 All ${convIds.length} Redis conversations cleaned up, loading from PostgreSQL`);
          throw new Error('Redis conversations cleaned up - falling back to PostgreSQL');
        }

        res.json({
          success: true,
          conversations: filteredConversations.slice(0, 100),
          count: filteredConversations.length
        });
      } catch (error) {
        // Expected for cleanup scenarios - not an actual error
        console.log(`📊 ${error.message}, loading from PostgreSQL...`);
        try {
          let query = `SELECT
              c.id,
              c.agent_type,
              c.title,
              c.created_at,
              c.updated_at,
              COUNT(m.id) as message_count
            FROM conversations c
            LEFT JOIN messages m ON c.id = m.conversation_id
            WHERE c.user_id = $1`;

          const params = [userId];

          if (agentTypeFilter) {
            query += ` AND c.agent_type = $2`;
            params.push(agentTypeFilter);
          }

          query += ` GROUP BY c.id
            ORDER BY c.updated_at DESC
            LIMIT 100`;

          const result = await queryWithTimeout(query, params, 5000);

          const conversations = result.rows.map(row => ({
            id: row.id,
            agentType: row.agent_type,
            title: row.title || 'Untitled Conversation',
            messageCount: parseInt(row.message_count) || 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }));

          console.log(`✅ PostgreSQL fallback returned ${conversations.length} conversations`);

          // Rebuild Redis set from PostgreSQL data (background, non-blocking)
          if (conversations.length > 0) {
            setImmediate(async () => {
              try {
                console.log(`🔄 Rebuilding Redis set for user ${userId}...`);
                const conversationIds = conversations.map(c => c.id);
                await redis.sadd(`user:${userId}:conversations`, ...conversationIds);
                console.log(`✅ Rebuilt Redis set with ${conversationIds.length} conversations`);
              } catch (rebuildError) {
                console.warn(`⚠️  Failed to rebuild Redis set:`, rebuildError.message);
              }
            });
          }

          res.json({
            success: true,
            conversations: conversations,
            count: conversations.length
          });
        } catch (pgError) {
          console.error(`❌ PostgreSQL fallback failed:`, pgError.message);
          res.status(500).json({
            success: false,
            message: 'Failed to load conversations',
            error: pgError.message
          });
        }
      }
      return;
    }

    // DELETE conversation endpoint
    if (url.startsWith('/api/conversation/') && method === 'DELETE') {
      const conversationId = url.split('/api/conversation/')[1];
      const userId = getUserIdFromJWT(req);

      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      try {
        // Delete from Redis conversation data
        await redis.del(`conv:${conversationId}`);
        console.log(`✅ Deleted conversation from Redis: ${conversationId}`);

        // Remove from user's conversation set
        await redis.srem(`user:${userId}:conversations`, conversationId);
        console.log(`✅ Removed conversation from user set`);

        // Try to delete from PostgreSQL (best-effort)
        try {
          const result = await queryWithTimeout(
            'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
            [conversationId, userId],
            3000
          );

          if (result.rows.length > 0) {
            console.log(`✅ Deleted conversation from PostgreSQL: ${conversationId}`);
          }
        } catch (pgError) {
          console.warn(`⚠️  PostgreSQL delete failed (non-fatal):`, pgError.message);
        }

        res.json({
          success: true,
          message: 'Conversation deleted successfully',
          deletedId: conversationId
        });
      } catch (error) {
        console.error(`❌ Error deleting conversation:`, error);
        res.status(500).json({
          success: false,
          message: 'Failed to delete conversation',
          error: error.message
        });
      }
      return;
    }

    // Login endpoint
    if (url === '/api/login' && method === 'POST') {
      try {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const { password } = JSON.parse(body);

            if (!TEAM_PASSWORD) {
              res.status(500).json({
                success: false,
                message: 'Authentication not configured'
              });
              return;
            }

            if (password === TEAM_PASSWORD) {
              // Create or retrieve legacy system user from database
              let userId = null;
              try {
                const result = await queryWithTimeout(
                  'SELECT id FROM users WHERE email = $1',
                  ['legacy@granted.consulting'],
                  2000
                );

                if (result.rows.length > 0) {
                  userId = result.rows[0].id;
                  console.log('✅ Legacy user found:', userId);
                } else {
                  // Create legacy system user
                  const createResult = await queryWithTimeout(
                    'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) RETURNING id',
                    ['legacy-system', 'legacy@granted.consulting', 'Legacy User', null],
                    2000
                  );
                  userId = createResult.rows[0].id;
                  console.log('✅ Legacy user created:', userId);
                }
              } catch (dbError) {
                console.error('⚠️ Database error during legacy login:', dbError.message);
                // Fallback: use a default UUID if database fails
                userId = '00000000-0000-0000-0000-000000000000';
              }

              // Create JWT with userId
              const sessionToken = generateJWTTokenWithUser(userId, 'legacy@granted.consulting');

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
      res.setHeader('Set-Cookie', [
        `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`
      ]);

      res.json({ success: true, message: 'Logged out successfully' });
      return;
    }

    // Redis cleanup utility endpoint (for clearing corrupted data)
    if (url === '/api/redis/cleanup' && method === 'POST') {
      try {
        console.log('🧹 Starting Redis cleanup for corrupted conversations...');
        let cleanedConv = 0;
        let cleanedMeta = 0;

        // Scan for corrupted conversation keys
        const convKeys = await redis.keys('conv:*');
        for (const key of convKeys) {
          try {
            const data = await redis.get(key);
            if (data && data.includes('[object Object]')) {
              console.log(`🗑️ Deleting corrupted conversation: ${key}`);
              await redis.del(key);
              cleanedConv++;
            }
          } catch (e) {
            console.log(`🗑️ Deleting unparseable conversation: ${key}`);
            await redis.del(key);
            cleanedConv++;
          }
        }

        // Scan for corrupted metadata keys
        const metaKeys = await redis.keys('conv-meta:*');
        for (const key of metaKeys) {
          try {
            const data = await redis.get(key);
            if (data && data.includes('[object Object]')) {
              console.log(`🗑️ Deleting corrupted metadata: ${key}`);
              await redis.del(key);
              cleanedMeta++;
            }
          } catch (e) {
            console.log(`🗑️ Deleting unparseable metadata: ${key}`);
            await redis.del(key);
            cleanedMeta++;
          }
        }

        res.json({
          success: true,
          message: 'Redis cleanup complete',
          conversationsDeleted: cleanedConv,
          metadataDeleted: cleanedMeta,
          totalKeys: convKeys.length + metaKeys.length
        });
      } catch (error) {
        console.error('❌ Redis cleanup error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
      return;
    }

    // Enhanced health check endpoint
    if (url === '/api/health') {
      const totalDocs = Object.values(knowledgeBases).reduce((sum, docs) => sum + docs.length, 0);
      // Note: Conversations now in Redis, metadata tracked locally
      const totalConversations = conversationMetadata.size;

      res.json({
        status: 'healthy',
        knowledgeBaseSize: totalDocs,
        knowledgeBaseSource: 'google-drive-service-account',
        googleDriveConfigured: !!(GOOGLE_DRIVE_FOLDER_ID && GOOGLE_SERVICE_ACCOUNT_KEY),
        apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
        redisConfigured: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
        apiCallsThisSession: apiCallCount,
        callsLastMinute: callTimestamps.length,
        rateLimitDelay: RATE_LIMIT_DELAY,
        authenticationEnabled: !!TEAM_PASSWORD,
        jwtEnabled: true,
        conversationStorage: 'redis',
        contextManagement: {
          conversationLimits: CONVERSATION_LIMITS,
          activeConversations: totalConversations,
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
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const conversationId = req.query?.conversationId || 'default';
      const agentType = req.query?.agentType || 'grant-cards';

      const conversation = await getConversation(conversationId, userId);
      const exchangeCount = Math.floor(conversation.length / 2);
      const limit = CONVERSATION_LIMITS[agentType];
      
      const estimatedTokens = conversation.length * (TOKENS_PER_EXCHANGE / 2) + 30000;
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
        
        knowledgeBaseLoaded = false;
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

    // ===== STREAMING ENDPOINTS =====
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
    
    // ===== NON-STREAMING ENDPOINTS (Legacy Support) =====
    
    // Process grant document
    if (url === '/api/process-grant' && method === 'POST') {
      const startTime = Date.now();

      // Get user ID from JWT token
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, task, conversationId } = req.body;

      // Build proper conversation ID
      // Use conversationId as-is (frontend generates UUID)

      // Get existing file context
      let conversationMeta = await getConversationFileContext(conversationId);

      // Process NEW uploaded files
      let newUploadResults = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            const uploadResult = await uploadFileToAnthropic(file);
            newUploadResults.push(uploadResult);
          } catch (uploadError) {
            console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
          }
        }

        if (newUploadResults.length > 0) {
          conversationMeta = await updateConversationFileContext(conversationId, newUploadResults);
        }
      }

      // Get/create conversation from database
      let conversation = await getConversation(conversationId, userId);
      if (conversation.length === 0) {
        console.log(`🆕 Starting new grant-cards conversation: ${conversationId}`);
      } else {
        console.log(`📜 Loaded grant-cards conversation: ${conversationId} (${conversation.length} messages)`);
      }
      
      const agentDocs = await loadAgentSpecificKnowledgeBase('grant-cards');
      const loadTime = Date.now() - startTime;
      
      logAgentPerformance('grant-cards', agentDocs.length, loadTime);
      
      const relevantDocs = selectGrantCardDocuments(task, message, '', conversation, agentDocs);
      let knowledgeContext = '';

      if (relevantDocs.length > 0) {
        knowledgeContext = relevantDocs
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Selected Grant Card documents: ${relevantDocs.map(d => d.filename).join(', ')}`);
      } else {
        console.log(`📚 No specific Grant Card documents found for task: ${task}`);
      }
      
      const isGrantCardTask = ['grant-criteria', 'preview', 'requirements', 'insights', 'categories', 'missing-info'].includes(task);

      let systemPrompt;
      let taskMethodologyPrompt = '';

      if (isGrantCardTask) {
        const prompts = buildGrantCardSystemPrompt(task, knowledgeContext);
        systemPrompt = prompts.system;
        taskMethodologyPrompt = prompts.user;
      } else {
        systemPrompt = `${agentPrompts[task] || agentPrompts['etg-writer']}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.`;
      }

      // For grant card tasks, prepend task methodology to user message
      let userMessage = message;
      if (isGrantCardTask && taskMethodologyPrompt) {
        userMessage = taskMethodologyPrompt + '\n\n<user_input>\n' + message + '\n</user_input>';
      }

      // Build message content with persistent file memory
      const messageContent = buildMessageContentWithFiles(userMessage, conversationMeta);

      const agentType = 'grant-cards';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, message);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: messageContent });

      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);

      // Store full response (including tool blocks) in conversation history
      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'grant-cards');

      // Extract text for display (handles both string and content block array)
      const displayText = extractTextFromResponse(response);

      res.json({
        response: displayText,
        conversationId: conversationId,
        performance: {
          documentsLoaded: agentDocs.length,
          documentsSelected: relevantDocs.length,
          loadTimeMs: loadTime
        }
      });
      return;
    }

    // Process ETG requests
    if (url === '/api/process-etg' && method === 'POST') {
      const startTime = Date.now();

      // Get user ID from JWT token
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId, url: courseUrl } = req.body;

      console.log(`🎯 Processing enhanced ETG request for conversation: ${conversationId}`);

      // Use conversationId as-is (frontend generates UUID)

      // Get existing file context
      let conversationMeta = await getConversationFileContext(conversationId);
      console.log(`📋 ETG Conversation Context: ${conversationMeta.uploadedFiles.length} existing files`);

      // Process NEW uploaded files with Files API
      let newUploadResults = [];
      if (req.files && req.files.length > 0) {
        console.log(`📄 Uploading ${req.files.length} ETG documents to Files API`);

        for (const file of req.files) {
          try {
            const uploadResult = await uploadFileToAnthropic(file);
            newUploadResults.push(uploadResult);
            console.log(`✅ Uploaded ${file.originalname} → ${uploadResult.file_id}`);
          } catch (uploadError) {
            console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
          }
        }

        if (newUploadResults.length > 0) {
          conversationMeta = await updateConversationFileContext(conversationId, newUploadResults);
          console.log(`✅ Added ${newUploadResults.length} files to ETG conversation context`);
        }
      }

      // Get/create conversation from database
      let conversation = await getConversation(conversationId, userId);
      if (conversation.length === 0) {
        console.log(`🆕 Starting new ETG conversation: ${conversationId}`);
      } else {
        console.log(`📜 Loaded ETG conversation: ${conversationId} (${conversation.length} messages)`);
      }
      
      // Enhanced ETG Processing with Tools
      let enhancedResponse = '';
      let toolsUsed = [];
      
      // Check if we need to run eligibility check
      let urlContent = '';
      if (courseUrl) {
        urlContent = await fetchURLContent(courseUrl);
      }
      
      const fullContent = message + ' ' + urlContent;
      const needsEligibilityCheck = (message.toLowerCase().includes('eligible') || 
                                     message.toLowerCase().includes('training') || 
                                     req.files?.length > 0 || urlContent);
      
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
            
            const messageContent = buildMessageContentWithFiles(message, conversationMeta);
            conversation.push({ role: 'user', content: messageContent });
            conversation.push({ role: 'assistant', content: enhancedResponse });
            
            res.json({ 
              response: enhancedResponse,
              conversationId: conversationId,
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
      
      const agentDocs = await loadAgentSpecificKnowledgeBase('etg-writer');
      const loadTime = Date.now() - startTime;
      logAgentPerformance('etg-writer', agentDocs.length, loadTime);

      const relevantDocs = selectETGDocuments(message, conversation, agentDocs);
      let knowledgeContext = '';

      if (relevantDocs.length > 0) {
        knowledgeContext = relevantDocs
          .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
          .join('\n\n');
          
        console.log(`📚 Using ${relevantDocs.length} ETG documents: ${relevantDocs.map(d => d.filename).join(', ')}`);
      }
      
      const systemPrompt = buildSystemPromptWithFileContext(
        agentPrompts['etg-writer'],
        knowledgeContext,
        conversationMeta,
        'etg-writer'
      );
      
      let baseMessage = message || "Hello, I need help with an ETG Business Case.";
      
      if (urlContent) {
        baseMessage += `\n\nCourse URL Content Analysis:\n${urlContent}`;
      }
      
      if (enhancedResponse) {
        baseMessage += `\n\nPre-screening completed. Please proceed with business case development.`;
      }

      const messageContent = buildMessageContentWithFiles(baseMessage, conversationMeta);

      const agentType = 'etg-writer';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, baseMessage);
      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: messageContent });
      
      console.log(`🤖 Calling Claude API for enhanced ETG specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);
      
      // Store FULL response (with thinking) in conversation history
      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'etg-writer');

      // Strip thinking tags for user display
      const cleanResponse = stripThinkingTags(response);
      const finalResponse = enhancedResponse + cleanResponse;

      console.log(`✅ Enhanced ETG response generated successfully`);

      res.json({
        response: finalResponse,  // This now has thinking stripped
        conversationId: conversationId,
        toolsUsed: toolsUsed
      });
      return;
    }

    // BCAFE endpoint
    if (url === '/api/process-bcafe' && method === 'POST') {
      // Get user ID from JWT token
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId, orgType, selectedMarkets } = req.body;

      console.log(`🌾 Processing BCAFE request for conversation: ${conversationId}`);
      console.log(`📊 Organization type: ${orgType}, Target markets: ${selectedMarkets}`);

      // Use conversationId as-is (frontend generates UUID)

      // Get existing file context
      let conversationMeta = await getConversationFileContext(conversationId);

      // Process NEW uploaded files
      let newUploadResults = [];
      if (req.files && req.files.length > 0) {
        console.log(`📄 Processing ${req.files.length} BCAFE documents`);

        for (const file of req.files) {
          try {
            const uploadResult = await uploadFileToAnthropic(file);
            newUploadResults.push(uploadResult);
          } catch (uploadError) {
            console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
          }
        }

        if (newUploadResults.length > 0) {
          conversationMeta = await updateConversationFileContext(conversationId, newUploadResults);
        }
      }

      // Get/create conversation from database
      let conversation = await getConversation(conversationId, userId);
      if (conversation.length === 0) {
        console.log(`🆕 Starting new BCAFE conversation: ${conversationId}`);
      } else {
        console.log(`📜 Loaded BCAFE conversation: ${conversationId} (${conversation.length} messages)`);
      }
      
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
      
      const systemPrompt = buildSystemPromptWithFileContext(
        agentPrompts['bcafe-writer'],
        knowledgeContext,
        conversationMeta,
        'bcafe-writer'
      );
      
      let userMessage = message || "Hello, I need help with a BCAFE application.";
      
      if (orgType) {
        userMessage += `\n\nOrganization Type: ${orgType}`;
      }
      
      if (selectedMarkets) {
        userMessage += `\n\nTarget Export Markets: ${selectedMarkets}`;
      }

      const messageContent = buildMessageContentWithFiles(userMessage, conversationMeta);

      const agentType = 'bcafe-writer';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: messageContent });

      console.log(`🤖 Calling Claude API for BCAFE specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);

      // Store full response (including tool blocks) in conversation history
      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'bcafe-writer');

      console.log(`✅ BCAFE response generated successfully`);

      // Extract text for display
      const displayText = extractTextFromResponse(response);

      res.json({
        response: displayText,
        conversationId: conversationId
      });
      return;
    }
    
    // CanExport Claims endpoint
    if (url === '/api/process-claims' && method === 'POST') {
      const startTime = Date.now();

      // Get user ID from JWT token
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      await new Promise((resolve, reject) => {
        upload.array('files', 10)(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { message, conversationId } = req.body;

      console.log(`📋 Processing CanExport Claims request for conversation: ${conversationId}`);

      // Use conversationId as-is (frontend generates UUID)

      // Get existing file context
      let conversationMeta = await getConversationFileContext(conversationId);

      // Process NEW uploaded files
      let newUploadResults = [];
      if (req.files && req.files.length > 0) {
        console.log(`📄 Processing ${req.files.length} Claims documents with Files API`);

        for (const file of req.files) {
          console.log(`📄 Preparing: ${file.originalname} for Files API upload`);

          const fileValidation = validateClaimsFile(file.originalname);
          if (fileValidation.hasWarnings) {
            console.log('🚨 File validation warnings detected');
          }

          try {
            const uploadResult = await uploadFileToAnthropic(file);
            newUploadResults.push(uploadResult);
          } catch (uploadError) {
            console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
          }
        }

        if (newUploadResults.length > 0) {
          conversationMeta = await updateConversationFileContext(conversationId, newUploadResults);
        }
      }

      // Get/create conversation from database
      let conversation = await getConversation(conversationId, userId);
      if (conversation.length === 0) {
        console.log(`🆕 Starting new CanExport Claims conversation: ${conversationId}`);
      } else {
        console.log(`📜 Loaded CanExport Claims conversation: ${conversationId} (${conversation.length} messages)`);
      }
      
      const agentDocs = await loadAgentSpecificKnowledgeBase('canexport-claims');
      const loadTime = Date.now() - startTime;
      logAgentPerformance('canexport-claims', agentDocs.length, loadTime);

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
      
      const systemPrompt = buildSystemPromptWithFileContext(
        agentPrompts['canexport-claims'],
        knowledgeContext,
        conversationMeta,
        'canexport-claims'
      );
      
      let userMessage = message || "Hello, I need help auditing CanExport expenses.";

      const messageContent = buildMessageContentWithFiles(userMessage, conversationMeta);

      const agentType = 'canexport-claims';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: messageContent });

      // RESPONSE PREFILLING: Guarantee structured output with <thinking> tag
      conversation.push({
        role: 'assistant',
        content: '<thinking>'
      });
      console.log('✨ Response prefilling enabled: Enforcing <thinking> tag structure');

      console.log(`🤖 Calling Claude API for CanExport Claims specialist response`);
      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);

      // Store full response (including tool blocks) in conversation history
      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'canexport-claims');

      console.log(`✅ CanExport Claims response generated successfully`);

      // Extract text for display
      const displayText = extractTextFromResponse(response);

      res.json({
        response: displayText,
        conversationId: conversationId,
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
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const conversationId = url.split('/api/conversation/')[1];
      const conversation = await getConversation(conversationId, userId);
      res.json({ messages: conversation });
      return;
    }

    // Clear conversation
    if (url.startsWith('/api/conversation/') && method === 'DELETE') {
      const userId = getUserIdFromJWT(req);
      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const conversationId = url.split('/api/conversation/')[1];
      await deleteConversation(conversationId, userId);
      // Also clear file metadata
      await redis.del(`conv-meta:${conversationId}`);
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
    
    let errorMessage = error.message;
    if (error.message.includes('Rate limit')) {
      errorMessage = `${error.message}\n\nPlease wait a few minutes before making another request.`;
    }
    
    res.status(500).json({ error: errorMessage });
  }
};
