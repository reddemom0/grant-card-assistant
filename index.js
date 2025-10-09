#!/usr/bin/env node

/**
 * Grant Card Assistant - Agent SDK Integration
 *
 * Unified API server using Anthropic Agent SDK for 4 specialized agents:
 * 1. Grant Card Agent - Grant criteria extraction and card creation
 * 2. ETG Writer Agent - BC Employer Training Grant business cases
 * 3. BCAFE Writer Agent - BC Agriculture and Food Export Program applications
 * 4. CanExport Claims Agent - CanExport SME claims auditing
 *
 * Features:
 * - Unified /api/chat endpoint with agentType routing
 * - Conversation/session management with Upstash Redis
 * - File upload support compatible with Agent SDK
 * - Streaming responses with Server-Sent Events
 * - Error handling and logging
 * - Vercel serverless compatibility
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@vercel/kv';
import multer from 'multer';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Upstash Redis for conversation storage (optional for local dev)
let redis = null;
const inMemoryStorage = new Map();

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('✅ Redis configured for conversation storage');
} else {
  console.log('⚠️  Redis not configured - using in-memory storage (development mode)');
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Agent configurations
const AGENT_CONFIGS = {
  'grant-cards': {
    name: 'Grant Card Agent',
    knowledgeFile: '.claude/agents/grant-card.md',
    conversationLimit: 30,
    description: 'Grant criteria extraction and card creation specialist',
  },
  'etg-writer': {
    name: 'ETG Writer Agent',
    knowledgeFile: '.claude/agents/etg-writer.md',
    conversationLimit: 40,
    description: 'BC Employer Training Grant business case specialist',
  },
  'bcafe-writer': {
    name: 'BCAFE Writer Agent',
    knowledgeFile: '.claude/agents/bcafe-writer.md',
    conversationLimit: 40,
    description: 'BC Agriculture and Food Export Program application specialist',
  },
  'canexport-claims': {
    name: 'CanExport Claims Agent',
    knowledgeFile: '.claude/agents/canexport-claims.md',
    conversationLimit: 50,
    description: 'CanExport SME claims auditing specialist',
  },
};

// Load shared CLAUDE.md knowledge base
const SHARED_KNOWLEDGE = fs.readFileSync(
  join(__dirname, '.claude', 'CLAUDE.md'),
  'utf-8'
);

// Initialize all agents
const agents = {};

async function initializeAgents() {
  console.log('🚀 Initializing agents...\n');

  for (const [agentType, config] of Object.entries(AGENT_CONFIGS)) {
    try {
      // Load agent-specific knowledge
      const agentKnowledge = fs.readFileSync(
        join(__dirname, config.knowledgeFile),
        'utf-8'
      );

      // Combine shared and agent-specific knowledge
      const systemPrompt = `${SHARED_KNOWLEDGE}\n\n---\n\n${agentKnowledge}`;

      // Store system prompt for this agent
      agents[agentType] = {
        systemPrompt,
        config
      };

      console.log(`✅ ${config.name} initialized`);
      console.log(`   Knowledge: ${config.knowledgeFile}`);
      console.log(`   Conversation limit: ${config.conversationLimit} messages`);
      console.log();
    } catch (error) {
      console.error(`❌ Failed to initialize ${config.name}:`, error.message);
      throw error;
    }
  }

  console.log('🎉 All agents initialized successfully!\n');
}

// Conversation management helpers
async function getConversation(conversationId) {
  try {
    let data;
    if (redis) {
      data = await redis.get(`conversation:${conversationId}`);
      if (data) return JSON.parse(data);
    } else {
      // In-memory fallback
      data = inMemoryStorage.get(conversationId);
      if (data) return data;
    }

    // Return new conversation
    return {
      id: conversationId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error getting conversation:', error);
    return {
      id: conversationId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

async function saveConversation(conversationId, conversation) {
  try {
    conversation.updatedAt = new Date().toISOString();
    if (redis) {
      await redis.set(
        `conversation:${conversationId}`,
        JSON.stringify(conversation),
        { ex: 86400 } // 24 hour expiry
      );
    } else {
      // In-memory fallback
      inMemoryStorage.set(conversationId, conversation);
    }
    return true;
  } catch (error) {
    console.error('Error saving conversation:', error);
    return false;
  }
}

async function pruneConversation(messages, agentType, limit) {
  const conversationLimit = AGENT_CONFIGS[agentType]?.conversationLimit || 30;

  if (messages.length > conversationLimit) {
    // Keep system message (if any) and most recent messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const recentMessages = messages.slice(-conversationLimit);
    return [...systemMessages, ...recentMessages];
  }

  return messages;
}

// Generate unique conversation ID
function generateConversationId(agentType) {
  return `${agentType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const {
      agentType,
      message,
      conversationId,
      stream = true
    } = req.body;

    // Validate agent type
    if (!agentType || !AGENT_CONFIGS[agentType]) {
      return res.status(400).json({
        error: 'Invalid agent type',
        validTypes: Object.keys(AGENT_CONFIGS),
      });
    }

    // Validate message
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
      });
    }

    // Get or create conversation
    const convId = conversationId || generateConversationId(agentType);
    let conversation = await getConversation(convId);

    // Add user message to conversation
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    // Prune conversation if needed
    conversation.messages = await pruneConversation(
      conversation.messages,
      agentType,
      AGENT_CONFIGS[agentType].conversationLimit
    );

    console.log(`\n📨 Incoming chat request:`);
    console.log(`   Agent: ${AGENT_CONFIGS[agentType].name}`);
    console.log(`   Conversation: ${convId}`);
    console.log(`   Messages: ${conversation.messages.length}`);
    console.log(`   Stream: ${stream}`);

    // Get agent instance
    const agent = agents[agentType];

    if (stream) {
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send conversation ID immediately
      res.write(`data: ${JSON.stringify({
        type: 'conversation_id',
        conversationId: convId
      })}\n\n`);

      let fullResponse = '';

      try {
        // Stream response from agent
        const stream = await anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: agent.systemPrompt,
          messages: conversation.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        });

        // Handle stream events
        stream.on('text', (text) => {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({
            type: 'content',
            content: text
          })}\n\n`);
        });

        stream.on('message', async (message) => {
          // Add assistant response to conversation
          conversation.messages.push({
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString(),
          });

          // Save conversation
          await saveConversation(convId, conversation);

          // Send completion event
          res.write(`data: ${JSON.stringify({
            type: 'done',
            conversationId: convId,
            messageCount: conversation.messages.length,
            usage: message.usage,
          })}\n\n`);

          res.end();
        });

        stream.on('error', (error) => {
          console.error('Stream error:', error);
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: error.message
          })}\n\n`);
          res.end();
        });

      } catch (error) {
        console.error('Streaming error:', error);
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: error.message
        })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: agent.systemPrompt,
          messages: conversation.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        });

        const assistantMessage = response.content[0].text;

        // Add assistant response to conversation
        conversation.messages.push({
          role: 'assistant',
          content: assistantMessage,
          timestamp: new Date().toISOString(),
        });

        // Save conversation
        await saveConversation(convId, conversation);

        // Send response
        res.json({
          conversationId: convId,
          message: assistantMessage,
          messageCount: conversation.messages.length,
          usage: response.usage,
        });

      } catch (error) {
        console.error('API error:', error);
        res.status(500).json({
          error: 'Failed to generate response',
          message: error.message,
        });
      }
    }

  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
      });
    }

    const { agentType, conversationId } = req.body;

    // Validate agent type
    if (!agentType || !AGENT_CONFIGS[agentType]) {
      return res.status(400).json({
        error: 'Invalid agent type',
        validTypes: Object.keys(AGENT_CONFIGS),
      });
    }

    console.log(`\n📎 File upload:`);
    console.log(`   Agent: ${AGENT_CONFIGS[agentType].name}`);
    console.log(`   Conversation: ${conversationId}`);
    console.log(`   File: ${req.file.originalname}`);
    console.log(`   Size: ${req.file.size} bytes`);
    console.log(`   Type: ${req.file.mimetype}`);

    // Get conversation
    const convId = conversationId || generateConversationId(agentType);
    let conversation = await getConversation(convId);

    // Initialize file context if needed
    if (!conversation.fileContext) {
      conversation.fileContext = [];
    }

    // Add file to context
    const fileInfo = {
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      buffer: req.file.buffer.toString('base64'), // Store as base64
    };

    conversation.fileContext.push(fileInfo);

    // Save conversation
    await saveConversation(convId, conversation);

    res.json({
      success: true,
      conversationId: convId,
      file: {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
      fileCount: conversation.fileContext.length,
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Failed to upload file',
      message: error.message,
    });
  }
});

// Get conversation history
app.get('/api/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await getConversation(conversationId);

    res.json({
      conversationId,
      messageCount: conversation.messages.length,
      messages: conversation.messages,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      hasFiles: !!conversation.fileContext?.length,
      fileCount: conversation.fileContext?.length || 0,
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      error: 'Failed to get conversation',
      message: error.message,
    });
  }
});

// Delete conversation
app.delete('/api/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (redis) {
      await redis.del(`conversation:${conversationId}`);
    } else {
      inMemoryStorage.delete(conversationId);
    }

    console.log(`🗑️  Deleted conversation: ${conversationId}`);

    res.json({
      success: true,
      conversationId,
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      error: 'Failed to delete conversation',
      message: error.message,
    });
  }
});

// List available agents
app.get('/api/agents', (req, res) => {
  res.json({
    agents: Object.entries(AGENT_CONFIGS).map(([type, config]) => ({
      type,
      name: config.name,
      description: config.description,
      conversationLimit: config.conversationLimit,
    })),
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    agents: Object.keys(agents).length,
    redisConnected: !!redis,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
  });
});

// Start server
async function startServer() {
  try {
    // Initialize agents
    await initializeAgents();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`\n🚀 Grant Card Assistant API Server`);
      console.log(`   Port: ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Agents loaded: ${Object.keys(agents).length}`);
      console.log(`\n📡 Endpoints:`);
      console.log(`   POST   /api/chat`);
      console.log(`   POST   /api/upload`);
      console.log(`   GET    /api/conversation/:id`);
      console.log(`   DELETE /api/conversation/:id`);
      console.log(`   GET    /api/agents`);
      console.log(`   GET    /api/health`);
      console.log(`\n✅ Server ready!\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Vercel serverless export
export default app;

// Start server if running directly
if (process.env.NODE_ENV !== 'production') {
  startServer();
}
