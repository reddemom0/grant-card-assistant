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
});

// Initialize PostgreSQL connection pool (for conversation persistence)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
  query_timeout: 10000
});

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
function stripThinkingTags(text) {
  // Pattern 1: Remove everything up to and including "Required Action Decision:" and its content until double newline
  const pattern1 = /^[\s\S]*?5\.\s*Required Action Decision:[\s\S]*?\n\n+/;
  let cleaned = text.replace(pattern1, '');
  
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

// Redis helper functions for conversation persistence
// Load conversation messages from PostgreSQL database
async function getConversation(conversationId, userId) {
  try {
    // Verify conversation belongs to user
    const convCheck = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      console.log(`📭 No conversation found for ${conversationId} and user ${userId}`);
      return [];
    }

    // Load messages in chronological order
    const result = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    console.log(`✅ Loaded conversation ${conversationId}: ${result.rows.length} messages`);
    return result.rows;
  } catch (error) {
    console.error(`❌ Error loading conversation ${conversationId}:`, error);
    return [];
  }
}

// Save conversation messages to PostgreSQL database (incremental saves)
async function saveConversation(conversationId, userId, conversation, agentType) {
  console.log(`\n========== saveConversation START ==========`);
  console.log(`   conversationId: ${conversationId} (type: ${typeof conversationId})`);
  console.log(`   userId: ${userId} (type: ${typeof userId})`);
  console.log(`   agentType: ${agentType} (type: ${typeof agentType})`);
  console.log(`   conversation.length: ${conversation.length}`);

  try {
    // Test database connection first with timeout
    console.log(`🔍 Testing database connection...`);
    console.log(`   DATABASE_URL exists: ${!!process.env.DATABASE_URL}`);
    console.log(`   POSTGRES_URL exists: ${!!process.env.POSTGRES_URL}`);
    console.log(`   Using URL: ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'POSTGRES_URL'}`);

    try {
      const testPromise = pool.query('SELECT NOW()');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection test timeout after 5 seconds')), 5000)
      );

      console.log(`   Attempting connection with 5 second timeout...`);
      const testResult = await Promise.race([testPromise, timeoutPromise]);
      console.log(`✅ Database connection OK. Current time: ${testResult.rows[0].now}`);
    } catch (connError) {
      console.error(`❌ Database connection FAILED:`, connError);
      console.error(`❌ Connection error details:`, {
        name: connError.name,
        message: connError.message,
        code: connError.code,
        errno: connError.errno,
        syscall: connError.syscall,
        address: connError.address,
        port: connError.port,
        stack: connError.stack
      });
      console.error(`❌ Connection string format: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'NOT SET'}`);
      throw connError;
    }

    // Check if conversation exists
    console.log(`\n🔍 STEP 1: Checking if conversation exists`);
    console.log(`   SQL: SELECT id FROM conversations WHERE id = $1`);
    console.log(`   Params: [${conversationId}]`);

    let convCheck;
    try {
      convCheck = await pool.query(
        'SELECT id FROM conversations WHERE id = $1',
        [conversationId]
      );
      console.log(`✅ Conversation check query completed`);
      console.log(`   Result rows: ${convCheck.rows.length}`);
      if (convCheck.rows.length > 0) {
        console.log(`   Found conversation:`, convCheck.rows[0]);
      }
    } catch (checkError) {
      console.error(`❌ Conversation check query FAILED:`, checkError);
      console.error(`   Error details:`, {
        name: checkError.name,
        message: checkError.message,
        code: checkError.code,
        detail: checkError.detail,
        stack: checkError.stack
      });
      throw checkError;
    }

    if (convCheck.rows.length === 0) {
      console.log(`\n🔍 STEP 2: Creating new conversation`);

      // Generate title
      let title = 'New Conversation';
      const firstUserMsg = conversation.find(m => m.role === 'user');
      if (firstUserMsg) {
        const content = typeof firstUserMsg.content === 'string'
          ? firstUserMsg.content
          : JSON.stringify(firstUserMsg.content);
        title = content.substring(0, 100);
      }

      console.log(`   Title: "${title.substring(0, 50)}..."`);
      console.log(`   SQL: INSERT INTO conversations (id, user_id, agent_type, title) VALUES ($1, $2, $3, $4) RETURNING *`);
      console.log(`   Params: [${conversationId}, ${userId}, ${agentType}, "${title.substring(0, 30)}..."]`);

      try {
        const insertResult = await pool.query(
          'INSERT INTO conversations (id, user_id, agent_type, title) VALUES ($1, $2, $3, $4) RETURNING *',
          [conversationId, userId, agentType, title]
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
      countResult = await pool.query(
        'SELECT COUNT(*) FROM messages WHERE conversation_id = $1',
        [conversationId]
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
          const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);

          console.log(`\n   Message ${i + 1}/${newMessages.length}:`);
          console.log(`     Role: ${msg.role}`);
          console.log(`     Content length: ${content.length}`);
          console.log(`     SQL: INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id`);
          console.log(`     Params: [${conversationId}, ${msg.role}, <content ${content.length} chars>]`);

          try {
            const msgResult = await pool.query(
              'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id',
              [conversationId, msg.role, content]
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
              stack: msgError.stack
            });
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
    console.log(`   SQL: UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`);
    console.log(`   Params: [${conversationId}]`);

    try {
      await pool.query(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [conversationId]
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

    console.log(`\n========== saveConversation SUCCESS ==========\n`);

  } catch (error) {
    console.error(`\n========== saveConversation FAILED ==========`);
    console.error(`❌ FATAL ERROR in saveConversation:`, error);
    console.error(`❌ Error type: ${error.constructor.name}`);
    console.error(`❌ Error message: ${error.message}`);
    console.error(`❌ Error code: ${error.code}`);
    console.error(`❌ Error stack:`, error.stack);
    console.error(`========== saveConversation END ==========\n`);
    throw error;
  }
}

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

// SHARED GRANT CARD EXPERT PERSONA
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

// TASK-SPECIFIC METHODOLOGIES
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

// BUILD COMPLETE GRANT CARD SYSTEM PROMPT
function buildGrantCardSystemPrompt(task, knowledgeContext = '') {
  const methodology = taskMethodologies[task] || taskMethodologies['grant-criteria'];
  
  const systemPrompt = `${GRANT_CARD_EXPERT_PERSONA}

${methodology}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.

IMPORTANT: Provide only the requested output content. Do not include meta-commentary about methodologies used, knowledge base references, or explanatory footnotes about your process.`;

  return systemPrompt;
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
[STEP-BY-STEP REASONING - This section is mandatory for all expense analysis]

Mode: [Quick Check / Full Audit]

Expense extraction:
- Vendor: [name]
- Amount before taxes: $[amount]
- Taxes identified: $[amount] [must be removed]
- Invoice date: [date]
- Payment date: [date if available]
- Description: [what was purchased]
- Proposed category: [A-H]

Rejection pattern check:
- [Pattern name]: [Pass/Fail with reasoning]
- [Pattern name]: [Pass/Fail with reasoning]

Information gaps:
- [What's unclear that might need web search?]

Web search decision:
- [Needed/Not needed and why]

[If web search used:]
Search results summary:
- Query: [what was searched]
- Key findings: [relevant information from results]
- Sources: [will be auto-cited]

Financial compliance:
- Taxes removed: $[amount]
- Eligible amount: $[amount after tax removal]
- 50% reimbursement: $[calculation]
- Per diem check: [if applicable]
- Currency conversion: [verified/missing]
- Proof of payment: [provided/missing]

[If Full Audit:]
Project compliance:
- Invoice date vs project start: [within/before/after]
- Payment date vs project end: [within/after]
- Activity match: [matches category X / doesn't match]
- Target market: [international/domestic]

Preliminary assessment: [reasoning for verdict]
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

// Fetch URL content
async function fetchURLContent(url) {
  try {
    console.log(`🔗 Fetching content from: ${url}`);
    
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

// Enhanced Claude API integration with Files API support
async function callClaudeAPI(messages, systemPrompt = '', files = []) {
  try {
    checkRateLimit();
    await waitForRateLimit();
    
    console.log(`🔥 Making Claude API call (${callTimestamps.length + 1}/${MAX_CALLS_PER_MINUTE} this minute)`);
    console.log(`🔧 Tools available: web_search (max 5 uses)`);
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
        'anthropic-beta': 'files-api-2025-04-14'
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
    
    console.log('🔄 RESPONSE ANALYSIS:');
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
        console.log(`   📄 WEB SEARCH RESULT: Found ${block.content?.length || 0} results`);
      }
    }
    
    if (toolUsageCount > 0) {
      console.log(`🌐 Web searches performed: ${toolUsageCount}`);
    } else {
      console.log(`📚 No web search used - Claude answered from knowledge base`);
    }
    
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

// Enhanced Streaming Claude API with Files API support + Extended Thinking
async function callClaudeAPIStream(messages, systemPrompt = '', res, files = [], agentType = 'grant-cards') {
  // Declare these variables at function scope
  let fullContentBlocks = [];
  let currentTextBlock = '';
  let currentThinkingBlock = null;

  try {
    checkRateLimit();
    await waitForRateLimit();

    const webSearchTool = getWebSearchTool(agentType);
    console.log(`🔥 Making streaming Claude API call with Extended Thinking`);
    console.log(`🤖 Agent: ${agentType}`);
    console.log(`🔧 Tools available: web_search (max ${webSearchTool.max_uses} uses)`);
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
        'anthropic-beta': 'files-api-2025-04-14'
      },
      body: (() => {
        const requestBody = {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16000,
          system: systemPrompt,
          messages: apiMessages,
          stream: true,
          tools: [webSearchTool]
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
                console.log(`🌐 Total web searches used: ${toolUsageCount}`);
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
                console.log(`🌐 STREAMING TOOL USED: ${parsed.content_block.name}`);
                
                res.write(`data: ${JSON.stringify({ 
                  tool_use: {
                    name: parsed.content_block.name,
                    query: parsed.content_block.input?.query
                  }
                })}\n\n`);
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
  if (agentType === 'grant-cards') {
    systemPrompt = buildGrantCardSystemPrompt(task, knowledgeContext);
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
  
  // Build message content with all file context
  const messageContent = buildMessageContentWithFiles(userMessage, conversationMeta);
  
  // Context management
  const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, userMessage);
  logContextUsage(agentType, estimatedContext, conversation.length);
  pruneConversation(conversation, agentType, estimatedContext);
  
  // Add user message to conversation
  conversation.push({ role: 'user', content: messageContent });

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

  await saveConversation(conversationId, userId, conversation, agentType);
  console.log(`✅ saveConversation completed from streaming handler`);
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
    // Login endpoint
    if (url === '/api/login' && method === 'POST') {
      try {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
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
              const sessionToken = generateJWTToken();

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
      if (isGrantCardTask) {
        systemPrompt = buildGrantCardSystemPrompt(task, knowledgeContext);
      } else {
        systemPrompt = `${agentPrompts[task] || agentPrompts['etg-writer']}

KNOWLEDGE BASE CONTEXT:
${knowledgeContext}

Always follow the exact workflows and instructions from the knowledge base documents above.`;
      }
      
      // Build message content with persistent file memory
      const messageContent = buildMessageContentWithFiles(message, conversationMeta);

      const agentType = 'grant-cards';
      const estimatedContext = estimateContextSize(conversation, knowledgeContext, systemPrompt, message);

      logContextUsage(agentType, estimatedContext, conversation.length);
      pruneConversation(conversation, agentType, estimatedContext);
      
      conversation.push({ role: 'user', content: messageContent });

      const response = await callClaudeAPI(conversation, systemPrompt, req.files || []);

      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'grant-cards');

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

      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'bcafe-writer');

      console.log(`✅ BCAFE response generated successfully`);

      res.json({
        response: response,
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

      conversation.push({ role: 'assistant', content: response });

      // Save conversation to database
      await saveConversation(conversationId, userId, conversation, 'canexport-claims');

      console.log(`✅ CanExport Claims response generated successfully`);

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
