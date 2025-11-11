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

// Feedback system
import feedbackHandler from './api/feedback.js';
import feedbackNoteHandler from './api/feedback-note.js';

// New direct API handlers
import {
  handleChatRequest,
  handleGetConversation,
  handleListConversations,
  handleDeleteConversation
} from './src/api/chat.js';

// Authentication
import authRouter from './src/api/auth.js';
import { authenticateUser } from './src/middleware/auth.js';

// Admin
import adminRouter from './src/api/admin.js';

// Database
import { testConnection, getPoolStats } from './src/database/connection.js';
import { getAvailableAgents } from './src/agents/load-agents.js';
import { autoMigrate } from './src/database/auto-migrate.js';

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

// Migration endpoint (temporary, for Railway deployment)
import { runMigrationEndpoint } from './run-migration-endpoint.js';
app.get('/run-migration', runMigrationEndpoint);

// Version endpoint to verify deployed code
app.get('/version', (req, res) => {
  res.json({
    version: '2.0.0-railway-migration',
    buildTimestamp: new Date().toISOString(),
    commit: 'force-redeploy-v2',
    nodeVersion: process.version,
    serverFile: 'server.js (root)'
  });
});

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

// Main chat endpoint (SSE streaming) - with authentication
app.post('/api/chat', authenticateUser, handleChatRequest);

// Conversation management - with authentication
app.get('/api/conversations/:id', authenticateUser, handleGetConversation);
app.get('/api/conversations', authenticateUser, handleListConversations);
app.delete('/api/conversations/:id', authenticateUser, handleDeleteConversation);

// Feedback system - with authentication
app.post('/api/feedback', authenticateUser, feedbackHandler);
app.get('/api/feedback', authenticateUser, feedbackHandler);
app.post('/api/feedback-note', authenticateUser, feedbackNoteHandler);
app.get('/api/feedback-note', authenticateUser, feedbackNoteHandler);

// Authentication endpoints
app.use('/api', authRouter);

// Admin endpoints (requires authentication + admin role)
app.use('/api/admin', authenticateUser, adminRouter);

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
// HUBSPOT CRM INTEGRATION (Read-Only)
// ============================================================================

import hubspotService from './services/hubspot-service.js';

// HubSpot status check
app.get('/api/hubspot/status', authenticateUser, async (req, res) => {
  try {
    const isConfigured = hubspotService.isConfigured();

    res.json({
      status: isConfigured ? 'configured' : 'not_configured',
      message: isConfigured
        ? 'HubSpot integration is active'
        : 'HUBSPOT_ACCESS_TOKEN environment variable not set',
      readOnly: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check HubSpot status',
      details: error.message
    });
  }
});

// Search contacts by email
app.get('/api/hubspot/contacts/search', authenticateUser, async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        error: 'Email parameter is required',
        usage: '/api/hubspot/contacts/search?email=user@example.com'
      });
    }

    if (!hubspotService.isConfigured()) {
      return res.status(503).json({
        error: 'HubSpot integration not configured',
        message: 'HUBSPOT_ACCESS_TOKEN environment variable not set'
      });
    }

    const contact = await hubspotService.findContactByEmail(email);

    if (!contact) {
      return res.status(404).json({
        error: 'Contact not found',
        email
      });
    }

    res.json({
      success: true,
      contact
    });
  } catch (error) {
    console.error('Error searching contact by email:', error);
    res.status(500).json({
      error: 'Failed to search contact',
      details: error.message
    });
  }
});

// Get contact by ID
app.get('/api/hubspot/contacts/:contactId', authenticateUser, async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!hubspotService.isConfigured()) {
      return res.status(503).json({
        error: 'HubSpot integration not configured',
        message: 'HUBSPOT_ACCESS_TOKEN environment variable not set'
      });
    }

    const contact = await hubspotService.getContact(contactId);

    res.json({
      success: true,
      contact
    });
  } catch (error) {
    console.error('Error getting contact:', error);
    res.status(500).json({
      error: 'Failed to get contact',
      details: error.message,
      contactId: req.params.contactId
    });
  }
});

// Get recent contacts
app.get('/api/hubspot/contacts/recent', authenticateUser, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    if (limit > 100) {
      return res.status(400).json({
        error: 'Limit cannot exceed 100',
        provided: limit
      });
    }

    if (!hubspotService.isConfigured()) {
      return res.status(503).json({
        error: 'HubSpot integration not configured',
        message: 'HUBSPOT_ACCESS_TOKEN environment variable not set'
      });
    }

    const contacts = await hubspotService.getRecentContacts(limit);

    res.json({
      success: true,
      count: contacts.length,
      contacts
    });
  } catch (error) {
    console.error('Error getting recent contacts:', error);
    res.status(500).json({
      error: 'Failed to get recent contacts',
      details: error.message
    });
  }
});

// Search companies
app.get('/api/hubspot/companies/search', authenticateUser, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Query parameter "q" is required',
        usage: '/api/hubspot/companies/search?q=company+name'
      });
    }

    if (!hubspotService.isConfigured()) {
      return res.status(503).json({
        error: 'HubSpot integration not configured',
        message: 'HUBSPOT_ACCESS_TOKEN environment variable not set'
      });
    }

    const limit = parseInt(req.query.limit) || 10;
    const companies = await hubspotService.findCompany(q, limit);

    res.json({
      success: true,
      count: companies.length,
      query: q,
      companies
    });
  } catch (error) {
    console.error('Error searching companies:', error);
    res.status(500).json({
      error: 'Failed to search companies',
      details: error.message
    });
  }
});

// Search deals
app.get('/api/hubspot/deals/search', authenticateUser, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Query parameter "q" is required',
        usage: '/api/hubspot/deals/search?q=deal+name'
      });
    }

    if (!hubspotService.isConfigured()) {
      return res.status(503).json({
        error: 'HubSpot integration not configured',
        message: 'HUBSPOT_ACCESS_TOKEN environment variable not set'
      });
    }

    const limit = parseInt(req.query.limit) || 10;
    const deals = await hubspotService.searchDeals(q, limit);

    res.json({
      success: true,
      count: deals.length,
      query: q,
      deals
    });
  } catch (error) {
    console.error('Error searching deals:', error);
    res.status(500).json({
      error: 'Failed to search deals',
      details: error.message
    });
  }
});

// Get deals for a contact
app.get('/api/hubspot/contacts/:contactId/deals', authenticateUser, async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!hubspotService.isConfigured()) {
      return res.status(503).json({
        error: 'HubSpot integration not configured',
        message: 'HUBSPOT_ACCESS_TOKEN environment variable not set'
      });
    }

    const deals = await hubspotService.getContactDeals(contactId);

    res.json({
      success: true,
      contactId,
      count: deals.length,
      deals
    });
  } catch (error) {
    console.error('Error getting contact deals:', error);
    res.status(500).json({
      error: 'Failed to get contact deals',
      details: error.message,
      contactId: req.params.contactId
    });
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
// HTML PAGE ROUTES (Clean URLs)
// ============================================================================

// Serve agent HTML pages with clean URLs (including sub-routes like /new and /chat/:id)
app.get('/grant-cards*', (req, res) => {
  res.sendFile('grant-cards.html', { root: '.' });
});

app.get('/etg-writer*', (req, res) => {
  res.sendFile('etg-agent.html', { root: '.' });
});

app.get('/bcafe-writer*', (req, res) => {
  res.sendFile('bcafe-agent.html', { root: '.' });
});

app.get('/canexport-claims*', (req, res) => {
  res.sendFile('canexport-claims.html', { root: '.' });
});

app.get('/readiness-strategist*', (req, res) => {
  res.sendFile('readiness-strategist.html', { root: '.' });
});

app.get('/dashboard', (req, res) => {
  res.sendFile('dashboard.html', { root: '.' });
});

app.get('/admin*', (req, res) => {
  res.sendFile('admin.html', { root: '.' });
});

app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: '.' });
});

// Serve root as login page
app.get('/', (req, res) => {
  res.sendFile('login.html', { root: '.' });
});

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
    } else {
      // Run auto-migrations if database is healthy
      await autoMigrate();
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
