/**
 * Grant Card Assistant - Main Server
 *
 * Railway deployment server with dual API support:
 * - New: Direct Claude API with custom tools
 * - Legacy: Agent SDK (for backwards compatibility during migration)
 */

// ============================================================================
// RUN MODE CHECK - Must be first, before any other code
// ============================================================================
// If RUN_MODE=sync, run the sync script instead of starting the server
// This allows Railway cron service to use the same codebase but run sync
import { execSync } from 'child_process';

if (process.env.RUN_MODE === 'sync') {
  console.log('🔄 RUN_MODE=sync detected - running database sync');
  try {
    execSync('node scripts/sync-getgranted-database.js', { stdio: 'inherit' });
    console.log('✅ Sync complete');
  } catch (e) {
    console.error('❌ Sync failed:', e.message);
  }
  process.exit(0);
}

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import cron from 'node-cron';

// Legacy handlers (for backwards compatibility)
import filesHandler from './api/files-handler.js';
import pdfHandler from './api/pdf-handler.js';

// Feedback system
import feedbackHandler from './api/feedback.js';
import feedbackNoteHandler from './api/feedback-note.js';
import feedbackMetricsHandler from './api/feedback-metrics.js';
import feedbackLearningHandler from './api/feedback-learning.js';
import sentimentAnalysisHandler from './api/sentiment-analysis.js';
import usageAnalyticsHandler from './api/usage-analytics.js';
import agentQualityHandler from './api/agent-quality.js';
import feedbackTaggingHandler from './api/feedback-tagging.js';

// New direct API handlers
import {
  handleChatRequest,
  handleGetConversation,
  handleListConversations,
  handleDeleteConversation
} from './src/api/chat.js';

// Lead-gen chatbot (public — no auth)
import { handleLeadGenChat, handleLeadGenAnalytics } from './src/api/lead-gen.js';
import { handleLeadGenInit } from './src/api/lead-gen-init.js';
import { handleLeadGenEvent } from './src/api/lead-gen-event.js';
import { handleListLeadGenConversations, handleGetLeadGenMessages, handleLeadGenStats, handleDeleteLeadGenConversation } from './src/api/admin-lead-gen.js';

// Test endpoint (temporary for email debugging)
import testEmailHandler from './api/test-email.js';

// Authentication
import authRouter from './src/api/auth.js';
import granolaAuthRouter from './src/api/granola-auth.js';
import { authenticateUser, requireAuth } from './src/middleware/auth.js';

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

// CORS configuration for widget embedding on granted.ca.
//
// SECURITY: this previously called callback(null, true) in BOTH branches, so
// `isAllowed` was computed and then ignored. Combined with credentials: true,
// the cors package reflects the caller's Origin verbatim and adds
// Access-Control-Allow-Credentials — i.e. any site on the internet could make
// credentialed cross-origin requests using a logged-in staff member's cookie.
//
// The matching was also too loose to keep as-is:
//   - startsWith() is a PREFIX match — 'https://granted.ca.evil.com' passed
//   - includes('.railway.app') matches anywhere — 'https://evil.com/.railway.app' passed
// Both are replaced with exact equality.
const ALLOWED_ORIGINS = new Set([
  'https://granted.ca',                                    // widget embed
  'https://www.granted.ca',                                // widget embed
  'https://grant-card-assistant-production.up.railway.app', // this app
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
]);

const corsOptions = {
  origin: function (origin, callback) {
    // No Origin header at all: non-browser client (curl, server-to-server,
    // health checks). CORS does not apply to these, so allow. Note this is
    // NOT the same as the literal string 'null', which is what sandboxed
    // iframes and data: URLs send — that is denied below.
    if (!origin) {
      return callback(null, true);
    }

    if (ALLOWED_ORIGINS.has(origin)) {
      return callback(null, true);
    }

    // Deny. Passing false (not an Error) omits the CORS headers and lets the
    // request continue, so the browser blocks it without a 500 in our logs.
    console.warn(`🚫 CORS: denied origin ${origin}`);
    return callback(null, false);
  },
  credentials: true
};

app.use(cors(corsOptions));
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
// Session required IN ADDITION to the existing ?secret= check. Both of these
// execute arbitrary SQL from migrations/, so a leaked secret alone must not
// be sufficient.
import { runMigrationEndpoint } from './run-migration-endpoint.js';
app.get('/run-migration', authenticateUser, requireAuth, runMigrationEndpoint);

// Database admin endpoint (diagnostics and migrations)
import { dbAdminEndpoint } from './db-admin-endpoint.js';
app.get('/db-admin', authenticateUser, requireAuth, dbAdminEndpoint);

// Import grants endpoint (for GetGranted database sync)
import { importGrantsEndpoint } from './import-grants-endpoint.js';
// Destructive (DELETE FROM grants) — requires BOTH a session and the secret.
app.get('/import-grants', authenticateUser, requireAuth, importGrantsEndpoint);

// Search grants endpoint (for Oracle to query GetGranted database)
import { searchGrantsEndpoint } from './search-grants-endpoint.js';
// Exposes the curated grants table. Oracle/lead-gen no longer reach this over
// HTTP — src/tools/getgranted-search.js calls searchGrants() in-process.
app.get('/search-grants', authenticateUser, requireAuth, searchGrantsEndpoint);

// Batch retag endpoint — re-tags all grants with updated eligibility fields
app.get('/batch-retag-grants', authenticateUser, requireAuth, async (req, res) => {
  try {
    const receivedSecret = req.query.secret?.trim();
    const expectedSecret = process.env.JWT_SECRET?.trim();

    // Fail closed when the secret is not configured, rather than comparing
    // two undefined values and passing.
    if (!expectedSecret || receivedSecret !== expectedSecret) {
      // Deliberately opaque: this previously returned receivedPrefix,
      // expectedPrefix and expectedLength of JWT_SECRET in the response body,
      // which is a shape oracle for the secret itself.
      console.warn('🚫 /batch-retag-grants rejected: invalid or missing secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { tagGrant } = await import('./src/services/grant-tagger.js');
    const { query } = await import('./src/database/connection.js');

    console.log('🚀 Starting batch re-tagging process...\n');
    res.write('🚀 Starting batch re-tagging process...\n\n');

    const result = await query('SELECT * FROM grants ORDER BY grant_id');
    const grants = result.rows;

    console.log(`📊 Found ${grants.length} grants to tag\n`);
    res.write(`📊 Found ${grants.length} grants to tag\n\n`);

    let tagged = 0;
    let failed = 0;

    for (const grant of grants) {
      try {
        const tags = await tagGrant(grant);

        if (tags && tags.eligibility) {
          await query(
            'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
            [tags, grant.grant_id]
          );
          tagged++;

          if (tagged % 50 === 0) {
            const progress = `   Progress: ${tagged}/${grants.length} (${((tagged / grants.length) * 100).toFixed(1)}%)\n`;
            console.log(progress);
            res.write(progress);
          }
        } else {
          failed++;
          console.warn(`⚠️  Failed to tag: ${grant.grant_name}`);
        }
      } catch (error) {
        failed++;
        console.error(`❌ Error tagging ${grant.grant_name}:`, error.message);
      }
    }

    const summary = `\n✅ Batch re-tagging complete!\n   Tagged: ${tagged}\n   Failed: ${failed}\n   Total: ${grants.length}\n`;
    console.log(summary);
    res.write(summary);
    res.end();

  } catch (error) {
    console.error('❌ Batch re-tagging failed:', error);
    res.status(500).write(`❌ Error: ${error.message}\n`);
    res.end();
  }
});

// Generate embeddings endpoint — re-embeds all currently_accepting grants with full text
app.get('/generate-embeddings', authenticateUser, requireAuth, async (req, res) => {
  try {
    // Simple secret-based auth for one-time operations (trim to handle whitespace)
    const receivedSecret = req.query.secret?.trim();
    const expectedSecret = process.env.JWT_SECRET?.trim();

    if (receivedSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { VoyageAIClient } = await import('voyageai');
    const pg = await import('pg');
    const { Pool } = pg;

    const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const stats = { total: 0, processed: 0, errors: [], cost: 0 };

    // Build full searchable text including recently_changed (critical for freshness signal)
    function buildGrantText(grant) {
      const parts = [];
      parts.push(grant.grant_name);
      if (grant.grant_type) parts.push(`Type: ${grant.grant_type}`);
      if (grant.program_provider) parts.push(`Provider: ${grant.program_provider}`);
      if (grant.regions) parts.push(`Regions: ${grant.regions}`);
      if (grant.industries) parts.push(`Industries: ${grant.industries}`);
      if (grant.deadline) parts.push(`Deadline: ${grant.deadline}`);
      if (grant.grant_amount) parts.push(`Amount: ${grant.grant_amount}`);
      if (grant.recently_changed) parts.push(`Recent Status: ${grant.recently_changed.slice(0, 500)}`);
      if (grant.grant_criteria) parts.push(`Criteria: ${grant.grant_criteria.slice(0, 2000)}`);
      if (grant.best_practices) parts.push(`Best Practices: ${grant.best_practices.slice(0, 800)}`);
      return parts.join('\n\n');
    }

    // Fetch all currently-accepting grants (re-embed even if already embedded)
    const result = await pool.query(`
      SELECT grant_id, grant_name, grant_type, grant_amount,
             regions, industries, program_provider, deadline,
             grant_criteria, best_practices, recently_changed,
             is_active, currently_accepting
      FROM grants
      WHERE currently_accepting = true
         OR (currently_accepting IS NULL AND is_active = true)
      ORDER BY grant_id::integer
    `);

    stats.total = result.rows.length;

    // Process each grant
    for (const grant of result.rows) {
      try {
        const text = buildGrantText(grant);

        // Generate embedding
        const response = await voyage.embed({
          input: text,
          model: 'voyage-3'
        });

        const embedding = response.data[0].embedding;
        const estimatedTokens = text.split(' ').length / 0.75;
        stats.cost += (estimatedTokens / 1000000) * 0.10;

        // Update database
        await pool.query(
          'UPDATE grants SET embedding = $1, updated_at = NOW() WHERE grant_id = $2',
          [JSON.stringify(embedding), grant.grant_id]
        );

        stats.processed++;

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        stats.errors.push({ grant_id: grant.grant_id, error: error.message });
      }
    }

    await pool.end();

    res.json({
      success: true,
      stats: {
        processed: stats.processed,
        total: stats.total,
        errors: stats.errors.length,
        cost: `$${stats.cost.toFixed(4)}`
      },
      errors: stats.errors.slice(0, 5)
    });

  } catch (error) {
    console.error('Embedding generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

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

// ============================================================================
// LEAD-GEN CHATBOT (PUBLIC — NO AUTH)
// ============================================================================

// Pre-chat form initialization — creates session with form data
app.post('/api/lead-gen/init', handleLeadGenInit);

// Chat endpoint — no authenticateUser middleware (public-facing)
app.post('/api/lead-gen/chat', handleLeadGenChat);

// Event tracking endpoint — fire-and-forget analytics (public, rate-limited by IP)
app.post('/api/lead-gen/event', handleLeadGenEvent);

// Analytics endpoint — authenticated team members only
app.get('/api/lead-gen/analytics', authenticateUser, requireAuth, handleLeadGenAnalytics);

// Admin endpoints for lead-gen dashboard — authenticated team members only
app.get('/api/admin/lead-gen-conversations', authenticateUser, requireAuth, handleListLeadGenConversations);
app.get('/api/admin/lead-gen-messages/:sessionId', authenticateUser, requireAuth, handleGetLeadGenMessages);
app.get('/api/admin/lead-gen-stats', authenticateUser, requireAuth, handleLeadGenStats);
app.delete('/api/admin/lead-gen-conversations/:sessionId', authenticateUser, requireAuth, handleDeleteLeadGenConversation);

// Test endpoint for email debugging (temporary - remove after email confirmed working)
app.get('/api/test-email', authenticateUser, requireAuth, testEmailHandler);

// Main chat endpoint (SSE streaming) - with authentication
app.post('/api/chat', authenticateUser, handleChatRequest);

// Conversation management - with authentication
app.get('/api/conversations/:id', authenticateUser, handleGetConversation);
app.get('/api/conversations', authenticateUser, handleListConversations);
app.delete('/api/conversations/:id', authenticateUser, handleDeleteConversation);

// Feedback system - with authentication
app.post('/api/feedback', authenticateUser, feedbackHandler);
app.get('/api/feedback', authenticateUser, requireAuth, feedbackHandler);
app.post('/api/feedback-note', authenticateUser, feedbackNoteHandler);
app.get('/api/feedback-note', authenticateUser, requireAuth, feedbackNoteHandler);

// Feedback metrics (non-admin) - with authentication
app.get('/api/feedback-metrics', authenticateUser, feedbackMetricsHandler);

// Feedback learning - trigger analysis and memory file generation
app.get('/api/feedback-learning', authenticateUser, feedbackLearningHandler);
app.post('/api/feedback-learning', authenticateUser, feedbackLearningHandler);

// Sentiment analysis - with authentication
app.get('/api/sentiment-analysis', authenticateUser, sentimentAnalysisHandler);
app.post('/api/sentiment-analysis', authenticateUser, sentimentAnalysisHandler);

// Usage analytics - with authentication
app.get('/api/usage-analytics', authenticateUser, usageAnalyticsHandler);

// Agent quality metrics - with authentication
app.get('/api/agent-quality', authenticateUser, agentQualityHandler);

// Feedback tagging admin - with authentication
app.get('/api/feedback-tagging', authenticateUser, feedbackTaggingHandler);
app.post('/api/feedback-tagging', authenticateUser, feedbackTaggingHandler);

// Authentication endpoints
app.use('/api', authRouter);
app.use('/api/auth/granola', granolaAuthRouter);

// Admin endpoints (requires authentication + admin role)
app.use('/api/admin', authenticateUser, adminRouter);

// Agent metadata
app.get('/api/agents', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/status', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/contacts/search', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/contacts/:contactId', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/contacts/recent', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/companies/search', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/deals/search', authenticateUser, requireAuth, async (req, res) => {
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
app.get('/api/hubspot/contacts/:contactId/deals', authenticateUser, requireAuth, async (req, res) => {
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
// VISUALPING WEBHOOK INTEGRATION
// ============================================================================

import visualPingHandler from './src/api/visualping-webhook.js';

// Webhook endpoint (no authentication - VisualPing needs to POST directly)
app.post('/api/visualping-webhook', visualPingHandler.handleVisualPingWebhook);

// HubSpot Webhook for Automatic Lead Enrichment
import * as hubspotWebhookHandler from './src/api/hubspot-webhook.js';

// POST endpoint for HubSpot to send webhook notifications
app.post('/api/hubspot-webhook', hubspotWebhookHandler.handleHubSpotWebhook);

// GET endpoint for HubSpot to verify webhook during setup
app.get('/api/hubspot-webhook', hubspotWebhookHandler.verifyHubSpotWebhook);

// Get recent alerts (authenticated - for Oracle and admin dashboard)
app.get('/api/visualping/alerts', authenticateUser, requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const priority = req.query.priority || null;

    const alerts = await visualPingHandler.getRecentAlerts(limit, priority);

    res.json({
      success: true,
      count: alerts.length,
      alerts
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch alerts',
      details: error.message
    });
  }
});

// Get alert statistics (authenticated)
app.get('/api/visualping/stats', authenticateUser, requireAuth, async (req, res) => {
  try {
    const stats = await visualPingHandler.getAlertStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch stats',
      details: error.message
    });
  }
});

// ============================================================================
// FILES API ENDPOINTS
// ============================================================================

// These routes proxy the Anthropic Files API (list/metadata/download/delete by
// file id). They were previously registered with no middleware at all, which
// made every file in the Anthropic account listable and downloadable by anyone.
// authenticateUser only POPULATES req.user (it calls next() with req.user = null
// on a missing/invalid JWT) — requireAuth is what actually returns 401.
app.post('/api/files', authenticateUser, requireAuth, filesHandler.uploadMiddleware, filesHandler.uploadFiles);
app.get('/api/files', authenticateUser, requireAuth, filesHandler.listFiles);
app.get('/api/files/:fileId', authenticateUser, requireAuth, filesHandler.getFileMetadata);
app.get('/api/files/:fileId/download', authenticateUser, requireAuth, filesHandler.downloadFile);
app.delete('/api/files/:fileId', authenticateUser, requireAuth, filesHandler.deleteFile);

// ============================================================================
// PDF PROCESSING ENDPOINTS
// ============================================================================

// Same treatment as the Files API routes above: these bill the Anthropic account
// and read batch results by id, and were previously unauthenticated.
// pdf-handler.js performs no database access, so there is no conversation to
// owner-scope here — gating is the whole fix.
app.post('/api/pdf/process', authenticateUser, requireAuth, pdfHandler.uploadMiddleware, pdfHandler.processPDF);
app.post('/api/pdf/upload-and-process', authenticateUser, requireAuth, pdfHandler.uploadMiddleware, pdfHandler.uploadAndProcess);
app.post('/api/pdf/batch', authenticateUser, requireAuth, pdfHandler.createBatch);
app.get('/api/pdf/batch/:batchId', authenticateUser, requireAuth, pdfHandler.getBatchStatus);
app.get('/api/pdf/batch/:batchId/results', authenticateUser, requireAuth, pdfHandler.getBatchResults);

// ============================================================================
// HTML PAGE ROUTES (Clean URLs)
// ============================================================================

// Serve agent HTML pages with clean URLs (including sub-routes like /new and /chat/:id)
// Unified agent interface - all agents use the same page
// Set no-cache headers to prevent browser from caching the HTML
const serveUnifiedAgents = (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.sendFile('unified-agents.html', { root: '.' });
};

// Lead-gen public chat page
app.get('/lead-gen*', (req, res) => {
  res.sendFile('lead-gen.html', { root: '.' });
});

app.get('/grant-cards*', serveUnifiedAgents);
app.get('/etg-writer*', serveUnifiedAgents);
app.get('/bcafe-writer*', serveUnifiedAgents);
app.get('/buybc-writer*', serveUnifiedAgents);
app.get('/canexport-claims*', serveUnifiedAgents);
app.get('/canexport-writer*', serveUnifiedAgents);
app.get('/readiness-strategist*', serveUnifiedAgents);
app.get('/oracle*', serveUnifiedAgents);

app.get('/dashboard', (req, res) => {
  // Redirect old dashboard route to Oracle
  res.redirect('/oracle/new');
});

app.get('/metrics', (req, res) => {
  res.sendFile('metrics.html', { root: '.' });
});

app.get('/usage', (req, res) => {
  res.sendFile('usage.html', { root: '.' });
});

app.get('/usage-analytics', (req, res) => {
  res.sendFile('usage-analytics.html', { root: '.' });
});

app.get('/feedback-metrics', (req, res) => {
  res.sendFile('feedback-metrics.html', { root: '.' });
});

app.get('/agent-quality', (req, res) => {
  res.sendFile('agent-quality.html', { root: '.' });
});

// Gates for HTML page routes. requireAuth/requireAdmin return JSON, which
// renders as a raw blob in a browser, so these redirect or send HTML instead —
// matching the client-side behaviour in public/js/agent-interface.js:145-155.

/** Any authenticated Granted staff member. */
function requirePageAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

/** Admin only. Used for the general admin dashboard. */
function requirePageAdmin(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  if (req.user.role !== 'admin') {
    // Already signed in, so redirecting to /login would loop.
    console.warn(`🚫 Admin page denied for ${req.user.email} (role: ${req.user.role})`);
    return res.status(403).setHeader('Content-Type', 'text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>Access Denied</title></head>
      <body>
        <h1>Access Denied</h1>
        <p>This page is restricted to administrators.</p>
        <p><a href="/oracle/new">Return to the AI Hub</a></p>
      </body>
      </html>
    `);
  }
  next();
}

// Lead-gen dashboards stay at STAFF level, not admin: marketing@granted.ca
// needs to read prospect conversations without holding the admin role.
// Do not tighten these to requirePageAdmin.
app.get('/admin-lead-gen', authenticateUser, requirePageAuth, (req, res) => {
  res.redirect(301, '/admin/conversations');
});

app.get('/admin/conversations', authenticateUser, requirePageAuth, (req, res) => {
  res.sendFile('admin-conversations.html', { root: '.' });
});

// The general admin dashboard. Previously had NO middleware at all; now admin
// only, which is possible because migration 022 repaired the quote-wrapped
// users.role values that made requireAdmin reject every account.
app.get('/admin*', authenticateUser, requirePageAdmin, (req, res) => {
  res.sendFile('admin.html', { root: '.' });
});

app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: '.' });
});

// Serve the landing page. This used to be handled implicitly by
// express.static('.'); now that the static mount is scoped to /public and
// /widget, `/` needs an explicit route or the bare domain 404s.
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: '.' });
});

// ============================================================================
// STATIC FILES
// ============================================================================

// SECURITY: this was previously `express.static('.')`, which served the entire
// repository root. The dotfile filter only inspects the LAST path segment, so
// `/.env` was blocked but `/.git/config`, `/.git/HEAD` and therefore
// `/.git/objects/**` were served — the full repo history, plus /server.js,
// /src/**, /data/** and /.claude/**.
//
// Only two directories are genuinely public:
//   public/ — css, js and images referenced by the served HTML pages
//   widget/ — the lead-capture widget embedded on granted.ca
//             (see widget/DEPLOYMENT.md)
// Everything else is now unreachable over HTTP.
const staticOptions = { dotfiles: 'deny', index: false, redirect: false };
app.use('/public', express.static('public', staticOptions));
app.use('/widget', express.static('widget', staticOptions));

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

      // Ensure learning applications table exists
      const { ensureLearningApplicationsTable } = await import('./src/database/learning-tracking.js');
      await ensureLearningApplicationsTable();

      // Ensure learning memory files table exists
      const { ensureLearningMemoryFilesTable } = await import('./src/database/learning-memory-storage.js');
      await ensureLearningMemoryFilesTable();
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

    // Auto-run migration 014 (add intake_cycle column if not exists)
    try {
      console.log('\n🔄 Running auto-migration 014 (intake_cycle)...');
      const { query } = await import('./src/database/connection.js');
      await query(`
        ALTER TABLE grants ADD COLUMN IF NOT EXISTS intake_cycle TEXT;
        CREATE INDEX IF NOT EXISTS idx_grants_intake_cycle ON grants(intake_cycle);
      `);
      console.log('✅ Migration 014 complete (or already applied)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 014 failed (non-fatal):', migrationError.message);
    }

    // Auto-run migration 015 (add pre-chat form fields)
    try {
      console.log('\n🔄 Running auto-migration 015 (pre-chat form fields)...');
      const { query } = await import('./src/database/connection.js');
      await query(`
        ALTER TABLE lead_gen_conversations
          ADD COLUMN IF NOT EXISTS company_name TEXT,
          ADD COLUMN IF NOT EXISTS company_website TEXT,
          ADD COLUMN IF NOT EXISTS company_background JSONB DEFAULT '{}';
        CREATE INDEX IF NOT EXISTS idx_lead_gen_company_name ON lead_gen_conversations(company_name);
      `);
      console.log('✅ Migration 015 complete (or already applied)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 015 failed (non-fatal):', migrationError.message);
    }

    // Auto-run migration 016 (add conversation_finalized event type)
    try {
      console.log('\n🔄 Running auto-migration 016 (conversation_finalized event)...');
      const { query } = await import('./src/database/connection.js');
      await query(`
        ALTER TABLE lead_gen_analytics DROP CONSTRAINT IF EXISTS lead_gen_analytics_event_type_check;
        ALTER TABLE lead_gen_analytics ADD CONSTRAINT lead_gen_analytics_event_type_check
          CHECK (event_type IN (
            'conversation_started',
            'discovery_complete',
            'search_performed',
            'programs_matched',
            'estimate_delivered',
            'cta_presented',
            'contact_captured',
            'lead_saved',
            'conversation_finalized'
          ));
      `);
      console.log('✅ Migration 016 complete (or already applied)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 016 failed (non-fatal):', migrationError.message);
    }

    // ── Migration 017: Add smart_tags column ────────────────────────────────
    console.log('🔧 Running migration 017: Add smart_tags column...');
    try {
      const { query } = await import('./src/database/connection.js');
      await query(`
        ALTER TABLE grants
        ADD COLUMN IF NOT EXISTS smart_tags JSONB DEFAULT NULL
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_grants_smart_tags
        ON grants USING gin(smart_tags)
      `);
      console.log('✅ Migration 017 complete (or already applied)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 017 failed (non-fatal):', migrationError.message);
    }

    // ── Migration 018: Import smart_tags data ────────────────────────────────
    console.log('🔧 Running migration 018: Import smart_tags data...');
    try {
      const { query } = await import('./src/database/connection.js');

      // Check if tags are already imported (need at least 590 of 598)
      const checkResult = await query('SELECT COUNT(smart_tags) as tagged, COUNT(*) as total FROM grants');
      const alreadyTagged = parseInt(checkResult.rows[0].tagged);
      const totalGrants = parseInt(checkResult.rows[0].total);

      if (alreadyTagged >= 590) {
        console.log(`✅ Migration 018 already applied (${alreadyTagged}/${totalGrants} grants tagged)`);
      } else {
        console.log(`📊 Found ${alreadyTagged}/${totalGrants} grants already tagged - importing remaining...`);
        // Import tags from JSON export
        const { readFileSync } = await import('fs');
        const tagsData = JSON.parse(readFileSync('./smart-tags-export.json', 'utf8'));

        console.log(`📥 Importing ${tagsData.total_count} smart_tags...`);

        let imported = 0;
        for (const row of tagsData.tags) {
          await query(
            'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
            [row.smart_tags, row.grant_id]
          );
          imported++;
          if (imported % 100 === 0) {
            console.log(`   Progress: ${imported}/${tagsData.total_count}`);
          }
        }

        console.log(`✅ Migration 018 complete (imported ${imported} tags)`);
      }
    } catch (migrationError) {
      console.warn('⚠️  Migration 018 failed (non-fatal):', migrationError.message);
    }

    // ── Migration 019: Add genre_scores column ───────────────────────────────
    console.log('🔧 Running migration 019: Add genre_scores column...');
    try {
      const { query } = await import('./src/database/connection.js');
      await query(`
        ALTER TABLE grants
        ADD COLUMN IF NOT EXISTS genre_scores JSONB DEFAULT NULL
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_grants_genre_scores
        ON grants USING gin(genre_scores)
      `);
      console.log('✅ Migration 019 complete (or already applied)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 019 failed (non-fatal):', migrationError.message);
    }

    // ── Migration 020: Import genre_scores data ──────────────────────────────
    console.log('🔧 Running migration 020: Import genre_scores data...');
    try {
      const { query } = await import('./src/database/connection.js');

      // Check if genre scores are already imported (need at least 440 of ~445)
      const checkResult = await query('SELECT COUNT(genre_scores) as scored, COUNT(*) as total FROM grants');
      const alreadyScored = parseInt(checkResult.rows[0].scored);
      const totalGrants = parseInt(checkResult.rows[0].total);

      if (alreadyScored >= 440) {
        console.log(`✅ Migration 020 already applied (${alreadyScored}/${totalGrants} grants scored)`);
      } else {
        console.log(`📊 Found ${alreadyScored}/${totalGrants} grants already scored - importing remaining...`);
        // Import genre scores from JSON export
        const { readFileSync } = await import('fs');
        const genreData = JSON.parse(readFileSync('./data/genre-scores-all.json', 'utf8'));

        console.log(`📥 Importing ${genreData.total_scored} genre_scores...`);

        let imported = 0;
        for (const result of genreData.results) {
          // Store both detailed scores and association_scores in the genre_scores column
          const genreScoresData = {
            scores: result.scores,
            association_scores: result.association_scores,
            scored_at: result.scored_at
          };

          await query(
            'UPDATE grants SET genre_scores = $1 WHERE grant_id = $2',
            [genreScoresData, result.grant_id]
          );
          imported++;
          if (imported % 100 === 0) {
            console.log(`   Progress: ${imported}/${genreData.total_scored}`);
          }
        }

        console.log(`✅ Migration 020 complete (imported ${imported} genre scores)`);
      }
    } catch (migrationError) {
      console.warn('⚠️  Migration 020 failed (non-fatal):', migrationError.message);
    }

    // ── Migration 021: Create lead_gen_events table ──────────────────────────
    console.log('🔧 ABOUT TO RUN migration 021...');
    console.log('🔧 Running migration 021: Create lead_gen_events table...');
    try {
      const { query } = await import('./src/database/connection.js');
      await query(`
        CREATE TABLE IF NOT EXISTS lead_gen_events (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          session_id TEXT,
          event_type TEXT NOT NULL,
          event_data JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_lead_gen_events_type
          ON lead_gen_events(event_type);

        CREATE INDEX IF NOT EXISTS idx_lead_gen_events_session
          ON lead_gen_events(session_id);

        CREATE INDEX IF NOT EXISTS idx_lead_gen_events_created
          ON lead_gen_events(created_at);
      `);
      console.log('✅ Migration 021 complete (lead_gen_events table created)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 021 failed (non-fatal):', migrationError.message);
      console.error('⚠️  Full migration 021 error:', migrationError);
    }

    // ── Migration 022: Add api_cost_total column for cost tracking ──────────
    console.log('🔧 Running migration 022: Add api_cost_total column...');
    try {
      const { query } = await import('./src/database/connection.js');
      await query(`
        ALTER TABLE lead_gen_conversations
        ADD COLUMN IF NOT EXISTS api_cost_total NUMERIC(10,4) DEFAULT 0;

        CREATE INDEX IF NOT EXISTS idx_lead_gen_cost
          ON lead_gen_conversations(api_cost_total);
      `);
      console.log('✅ Migration 022 complete (api_cost_total column added)');
    } catch (migrationError) {
      console.warn('⚠️  Migration 022 failed (non-fatal):', migrationError.message);
      console.error('⚠️  Full migration 022 error:', migrationError);
    }

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
      console.log(`  📁 Files API: /api/files`);
      console.log(`  📄 PDF Processing: /api/pdf`);
      console.log('\n' + '='.repeat(80) + '\n');
    });

    // ========================================================================
    // CRON JOB: Lead-gen inactivity finalization
    // ========================================================================
    // Run every 10 minutes to finalize abandoned conversations.
    //
    // This registers on EVERY boot, including local dev runs, and fires on the
    // wall-clock 10-minute boundary — not 10 minutes after startup. When it
    // runs it sends email via Gmail and writes to HubSpot, so local testing
    // needs a way to opt out. Set LEAD_GEN_FINALIZATION_DISABLED=true.
    const finalizationDisabled = process.env.LEAD_GEN_FINALIZATION_DISABLED === 'true';

    if (finalizationDisabled) {
      console.log('⏸️  Lead-gen finalization cron DISABLED (LEAD_GEN_FINALIZATION_DISABLED=true)');
    } else {
      cron.schedule('*/10 * * * *', async () => {
        console.log('\n🔄 Running scheduled lead-gen finalization...');
        try {
          const { finalizeInactiveSessions } = await import('./src/api/lead-gen-finalization.js');
          const result = await finalizeInactiveSessions(5, 50);
          console.log(`✅ Finalization complete: ${result.finalized} sessions finalized, ${result.errors} errors`);
        } catch (err) {
          console.error('❌ Scheduled finalization failed:', err.message);
        }
      });

      console.log('⏰ Cron job scheduled: Lead-gen finalization every 10 minutes');
    }

    // Log A/B testing configuration for lead-gen
    const leadGenVariant = process.env.LEAD_GEN_VARIANT || 'A';
    console.log(`🧪 Lead-gen A/B testing: VARIANT ${leadGenVariant.toUpperCase()}`);

    // Log test mode status
    const testMode = process.env.LEAD_GEN_TEST_MODE === 'true';
    if (testMode) {
      console.log('🧪 TEST MODE ENABLED — HubSpot writes mocked across all agents (create/update company, contact, deal; merge company, contact; associate contact↔company)');
    } else {
      console.log('✅ Production mode — HubSpot API calls active');
    }

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
