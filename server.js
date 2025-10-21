/**
 * Grant Card Assistant - Main Server
 *
 * Railway deployment server with dual API support:
 * - New: Direct Claude API with custom tools
 * - Legacy: Agent SDK (for backwards compatibility during migration)
 */

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

// Legacy handlers (for backwards compatibility)
import agentHandler from './api/agent-sdk-handler.js';
import filesHandler from './api/files-handler.js';
import pdfHandler from './api/pdf-handler.js';

// New direct API handlers
import {
  handleChatRequest,
  handleGetConversation,
  handleListConversations,
  handleDeleteConversation
} from './src/api/chat.js';

// Database
import { testConnection, getPoolStats } from './src/database/connection.js';
import { getAvailableAgents } from './src/agents/load-agents.js';

config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for image/PDF uploads

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(
      `${req.method} ${req.path} ${statusColor}${res.statusCode}\x1b[0m ${duration}ms`
    );
  });

  next();
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const dbHealthy = await testConnection();
    const poolStats = getPoolStats();

    res.json({
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: {
        connected: dbHealthy,
        ...poolStats
      },
      agents: getAvailableAgents()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// ============================================================================
// NEW DIRECT API ENDPOINTS
// ============================================================================

// Main chat endpoint (SSE streaming)
app.post('/api/chat', handleChatRequest);

// Conversation management
app.get('/api/conversations/:id', handleGetConversation);
app.get('/api/conversations', handleListConversations);
app.delete('/api/conversations/:id', handleDeleteConversation);

// Agent metadata
app.get('/api/agents', async (req, res) => {
  try {
    const { getAgentMetadata } = await import('./src/agents/load-agents.js');
    const agents = getAgentMetadata();
    res.json({
      count: agents.length,
      agents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LEGACY AGENT SDK ENDPOINT (for backwards compatibility)
// ============================================================================

app.post('/api/agent', agentHandler);

// ============================================================================
// FILES API ENDPOINTS
// ============================================================================

app.post('/api/files', filesHandler.uploadMiddleware, filesHandler.uploadFiles);
app.get('/api/files', filesHandler.listFiles);
app.get('/api/files/:fileId', filesHandler.getFileMetadata);
app.get('/api/files/:fileId/download', filesHandler.downloadFile);
app.delete('/api/files/:fileId', filesHandler.deleteFile);

// ============================================================================
// PDF PROCESSING ENDPOINTS
// ============================================================================

app.post('/api/pdf/process', pdfHandler.uploadMiddleware, pdfHandler.processPDF);
app.post('/api/pdf/upload-and-process', pdfHandler.uploadMiddleware, pdfHandler.uploadAndProcess);
app.post('/api/pdf/batch', pdfHandler.createBatch);
app.get('/api/pdf/batch/:batchId', pdfHandler.getBatchStatus);
app.get('/api/pdf/batch/:batchId/results', pdfHandler.getBatchResults);

// ============================================================================
// STATIC FILES
// ============================================================================

app.use(express.static('.'));

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 Starting Grant Card Assistant Server');
    console.log('='.repeat(80) + '\n');

    // Test database connection
    console.log('🔌 Testing database connection...');
    const dbHealthy = await testConnection();

    if (!dbHealthy) {
      console.warn('⚠️  Database connection test failed - continuing anyway');
    }

    // Check required environment variables
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('⚠️  ANTHROPIC_API_KEY not set - direct API will not work');
    }

    // Check optional integrations
    if (!process.env.HUBSPOT_ACCESS_TOKEN) {
      console.log('ℹ️  HUBSPOT_ACCESS_TOKEN not set - HubSpot tools disabled');
    }

    if (!process.env.GOOGLE_DRIVE_CLIENT_ID) {
      console.log('ℹ️  Google Drive credentials not set - Drive tools disabled');
    }

    // List available agents
    const agents = getAvailableAgents();
    console.log(`\n📋 Available agents (${agents.length}):`);
    agents.forEach(agent => console.log(`   - ${agent}`));

    // Start Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n' + '='.repeat(80));
      console.log('✅ Server started successfully');
      console.log('='.repeat(80));
      console.log(`\n🌐 Server running on: http://0.0.0.0:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log('\nEndpoints:');
      console.log(`  💬 Direct API Chat: POST /api/chat`);
      console.log(`  📝 Conversations: GET /api/conversations`);
      console.log(`  🤖 Legacy Agent SDK: POST /api/agent`);
      console.log(`  📁 Files API: /api/files`);
      console.log(`  📄 PDF Processing: /api/pdf`);
      console.log('\n' + '='.repeat(80) + '\n');
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n\n${signal} received, shutting down gracefully...`);

      server.close(async () => {
        console.log('✓ HTTP server closed');

        // Close database pool
        const { closePool } = await import('./src/database/connection.js');
        await closePool();

        console.log('✓ Graceful shutdown complete');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('⚠️  Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Failed to start server');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
  }
}

// Start the server
startServer();
