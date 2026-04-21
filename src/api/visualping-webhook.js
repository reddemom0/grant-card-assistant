/**
 * VisualPing Webhook Handler
 *
 * Receives webhook alerts from VisualPing when monitored grant pages change,
 * stores them in Redis, and triggers Oracle processing.
 */

import Redis from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import { logAPICost } from '../utils/cost-logger.js';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Webhook endpoint handler
 */
export async function handleVisualPingWebhook(req, res) {
  try {
    console.log('📡 VisualPing webhook received');

    const payload = req.body;

    // Validate payload has required fields
    if (!payload.url || !payload.datetime) {
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Missing required fields: url, datetime'
      });
    }

    // Create alert ID
    const alertId = `vp:alert:${Date.now()}`;

    // Store alert in Redis
    await redis.hset(alertId, {
      job_id: payload.job_id || '',
      url: payload.url,
      change_percentage: payload.change || 0,
      datetime: payload.datetime,
      ai_summary: payload.ai_summary || '',
      added_text: payload.added_text || '',
      removed_text: payload.removed_text || '',
      preview_url: payload.preview || '',
      original_url: payload.original || '',
      current_url: payload.current || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    // Add to processing queue
    await redis.lpush('vp:queue', alertId);

    console.log(`✅ Alert stored: ${alertId}`);
    console.log(`   URL: ${payload.url}`);
    console.log(`   Change: ${payload.change}%`);

    // Acknowledge receipt immediately
    res.json({
      success: true,
      alertId,
      message: 'Alert received and queued for processing'
    });

    // Trigger async processing (don't wait for it)
    processVisualPingAlert(alertId).catch(err => {
      console.error(`❌ Alert processing failed for ${alertId}:`, err.message);
    });

  } catch (error) {
    console.error('❌ VisualPing webhook error:', error);
    res.status(500).json({
      error: 'Processing failed',
      message: error.message
    });
  }
}

/**
 * Process a VisualPing alert
 *
 * 1. Load alert data from Redis
 * 2. Analyze change with Claude
 * 3. Classify change type
 * 4. Extract key information
 * 5. Search HubSpot for relevant clients
 * 6. Store analysis results
 * 7. Generate notification (future: send to Slack/email)
 */
async function processVisualPingAlert(alertId) {
  console.log(`\n🔍 Processing alert: ${alertId}`);

  try {
    // 1. Load alert data
    const alert = await redis.hgetall(alertId);

    if (!alert || !alert.url) {
      throw new Error('Alert not found or invalid');
    }

    console.log(`   URL: ${alert.url}`);
    console.log(`   Change: ${alert.change_percentage}%`);
    console.log(`   Summary: ${alert.ai_summary?.substring(0, 100)}...`);

    // 2. Analyze change with Claude
    console.log(`   🤖 Analyzing change with Claude...`);

    const analysisPrompt = `You are analyzing a website change detected by VisualPing on a government grant page.

URL: ${alert.url}
Change Percentage: ${alert.change_percentage}%
Date: ${alert.datetime}

AI Summary from VisualPing:
${alert.ai_summary || 'No summary provided'}

Added Text:
${alert.added_text || 'No text added'}

Removed Text:
${alert.removed_text || 'No text removed'}

Analyze this change and provide:

1. **change_type**: Classify as one of: new_program, deadline_change, eligibility_update, guidelines_update, funding_change, minor_update

2. **priority**: Classify as: critical, high, medium, low
   - critical: New programs, major deadline changes, eligibility expansions
   - high: Guideline updates, funding increases, significant changes
   - medium: Minor guideline tweaks, FAQ updates
   - low: Formatting changes, trivial updates

3. **program_name**: Extract the grant program name if identifiable

4. **key_info**: Extract key details like:
   - Funding amount (if mentioned)
   - Deadline (if mentioned)
   - Eligibility criteria (if mentioned)
   - Sector/industry focus (if mentioned)

5. **impact_summary**: 2-3 sentence summary of what changed and why it matters

6. **action_items**: What should the Granted team do in response? (e.g., "Contact active IRAP clients", "Update knowledge base", "Send alert to manufacturing clients")

Return your analysis as valid JSON only, no other text:
{
  "change_type": "...",
  "priority": "...",
  "program_name": "...",
  "key_info": {
    "funding_amount": "...",
    "deadline": "...",
    "eligibility": "...",
    "sector": "..."
  },
  "impact_summary": "...",
  "action_items": ["...", "..."]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: analysisPrompt
      }]
    });

    // Log cost with full context
    if (response.usage) {
      logAPICost({
        usage: response.usage,
        model: 'claude-sonnet-4-6',
        source: 'visualping-webhook',
        metadata: {
          url: alert.url,
          changePercentage: alert.change_percentage,
          alertId
        }
      });
    }

    const analysisText = response.content[0].text;
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    console.log(`   ✅ Analysis complete:`);
    console.log(`      Type: ${analysis.change_type}`);
    console.log(`      Priority: ${analysis.priority}`);
    console.log(`      Program: ${analysis.program_name || 'Not identified'}`);

    // 3. Store analysis
    const analysisId = `vp:analysis:${alertId}`;
    await redis.hset(analysisId, {
      change_type: analysis.change_type,
      priority: analysis.priority,
      program_name: analysis.program_name || '',
      funding_amount: analysis.key_info?.funding_amount || '',
      deadline: analysis.key_info?.deadline || '',
      eligibility: analysis.key_info?.eligibility || '',
      sector: analysis.key_info?.sector || '',
      impact_summary: analysis.impact_summary,
      action_items: JSON.stringify(analysis.action_items || []),
      analyzed_at: new Date().toISOString()
    });

    // 4. Update alert status
    await redis.hset(alertId, {
      status: 'analyzed',
      processed_at: new Date().toISOString()
    });

    // 5. TODO: Search HubSpot for relevant clients (future enhancement)
    // This would use the analysis to find matching companies:
    // - If new program → search by industry/sector
    // - If deadline change → find active applications
    // - If eligibility update → find newly eligible companies

    // 6. TODO: Generate notification (future enhancement)
    // This would create Slack message, email, or Oracle proactive alert

    console.log(`   ✅ Alert processed successfully`);
    console.log(`   📊 Analysis stored: ${analysisId}`);

    // Store summary in a searchable format for Oracle
    await storeForOracle(alertId, alert, analysis);

    return {
      success: true,
      alertId,
      analysis
    };

  } catch (error) {
    console.error(`❌ Processing failed for ${alertId}:`, error);

    // Mark alert as failed
    await redis.hset(alertId, {
      status: 'failed',
      error_message: error.message,
      failed_at: new Date().toISOString()
    });

    throw error;
  }
}

/**
 * Store alert in searchable format for Oracle queries
 */
async function storeForOracle(alertId, alert, analysis) {
  // Create a searchable summary document
  const summary = {
    id: alertId,
    type: 'visualping_alert',
    url: alert.url,
    date: alert.datetime,
    change_type: analysis.change_type,
    priority: analysis.priority,
    program: analysis.program_name || 'Unknown',
    summary: analysis.impact_summary,
    actions: analysis.action_items || [],
    created_at: new Date().toISOString()
  };

  // Store in a sorted set by timestamp for recent alerts
  const timestamp = Date.now();
  await redis.zadd('vp:alerts:recent', timestamp, alertId);

  // Store by priority for quick filtering
  await redis.sadd(`vp:alerts:priority:${analysis.priority}`, alertId);

  // Store by change type
  await redis.sadd(`vp:alerts:type:${analysis.change_type}`, alertId);

  // Keep last 100 alerts in sorted set (cleanup old ones)
  await redis.zremrangebyrank('vp:alerts:recent', 0, -101);

  console.log(`   💾 Alert indexed for Oracle queries`);
}

/**
 * Get recent alerts (for Oracle or admin dashboard)
 */
export async function getRecentAlerts(limit = 20, priority = null) {
  try {
    let alertIds;

    if (priority) {
      // Get by priority
      alertIds = await redis.smembers(`vp:alerts:priority:${priority}`);
      alertIds = alertIds.slice(0, limit);
    } else {
      // Get most recent across all priorities
      alertIds = await redis.zrevrange('vp:alerts:recent', 0, limit - 1);
    }

    // Load full alert data and analysis
    const alerts = await Promise.all(
      alertIds.map(async (alertId) => {
        const alert = await redis.hgetall(alertId);
        const analysisId = `vp:analysis:${alertId}`;
        const analysis = await redis.hgetall(analysisId);

        return {
          id: alertId,
          ...alert,
          analysis: Object.keys(analysis).length > 0 ? analysis : null
        };
      })
    );

    return alerts.filter(a => a.url); // Filter out empty/invalid

  } catch (error) {
    console.error('Error fetching recent alerts:', error);
    throw error;
  }
}

/**
 * Get alert statistics (for monitoring)
 */
export async function getAlertStats() {
  try {
    const total = await redis.zcard('vp:alerts:recent');

    const pending = await redis.llen('vp:queue');

    const critical = await redis.scard('vp:alerts:priority:critical');
    const high = await redis.scard('vp:alerts:priority:high');
    const medium = await redis.scard('vp:alerts:priority:medium');
    const low = await redis.scard('vp:alerts:priority:low');

    return {
      total_alerts: total,
      pending_processing: pending,
      by_priority: {
        critical,
        high,
        medium,
        low
      }
    };

  } catch (error) {
    console.error('Error fetching alert stats:', error);
    throw error;
  }
}

export default {
  handleVisualPingWebhook,
  getRecentAlerts,
  getAlertStats
};
