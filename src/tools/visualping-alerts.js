/**
 * VisualPing Alerts Tool for Oracle
 *
 * Allows Oracle to query VisualPing website change alerts,
 * providing proactive intelligence on grant program updates.
 */

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Get recent VisualPing alerts
 *
 * @param {Object} input
 * @param {number} input.limit - Max alerts to return (default 10, max 50)
 * @param {string} input.priority - Filter by priority: critical, high, medium, low
 * @param {string} input.change_type - Filter by type: new_program, deadline_change, eligibility_update, etc.
 * @param {number} input.days - Only show alerts from last N days (default 30)
 * @returns {Promise<Object>} Alert results
 */
export async function getVisualPingAlerts(input) {
  try {
    const {
      limit = 10,
      priority = null,
      change_type = null,
      days = 30
    } = input;

    console.log(`🔍 Fetching VisualPing alerts (limit: ${limit}, priority: ${priority || 'all'}, type: ${change_type || 'all'})`);

    // Calculate timestamp cutoff for date filtering
    const cutoffTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);

    let alertIds = [];

    // Get alerts filtered by priority or change type
    if (priority) {
      alertIds = await redis.smembers(`vp:alerts:priority:${priority}`);
    } else if (change_type) {
      alertIds = await redis.smembers(`vp:alerts:type:${change_type}`);
    } else {
      // Get most recent across all
      alertIds = await redis.zrevrange('vp:alerts:recent', 0, limit * 2); // Get extra to filter by date
    }

    // Load full alert data and analysis
    const alerts = await Promise.all(
      alertIds.map(async (alertId) => {
        const alert = await redis.hgetall(alertId);
        const analysisId = `vp:analysis:${alertId}`;
        const analysis = await redis.hgetall(analysisId);

        // Skip empty alerts
        if (!alert || !alert.url) {
          return null;
        }

        // Parse timestamp from alertId
        const timestampMatch = alertId.match(/vp:alert:(\d+)/);
        const alertTimestamp = timestampMatch ? parseInt(timestampMatch[1]) : 0;

        // Filter by date
        if (alertTimestamp < cutoffTimestamp) {
          return null;
        }

        // Parse action items from JSON
        let actionItems = [];
        if (analysis.action_items) {
          try {
            actionItems = JSON.parse(analysis.action_items);
          } catch (e) {
            actionItems = [];
          }
        }

        return {
          alert_id: alertId,
          url: alert.url,
          change_percentage: parseFloat(alert.change_percentage) || 0,
          date_detected: alert.datetime,
          status: alert.status,

          // VisualPing provided info
          ai_summary: alert.ai_summary || '',
          added_text: alert.added_text || '',
          removed_text: alert.removed_text || '',
          preview_url: alert.preview_url || '',

          // Our analysis
          change_type: analysis.change_type || 'unknown',
          priority: analysis.priority || 'medium',
          program_name: analysis.program_name || 'Not identified',
          funding_amount: analysis.funding_amount || '',
          deadline: analysis.deadline || '',
          eligibility: analysis.eligibility || '',
          sector: analysis.sector || '',
          impact_summary: analysis.impact_summary || '',
          action_items: actionItems,

          analyzed_at: analysis.analyzed_at || '',
          created_at: alert.created_at || ''
        };
      })
    );

    // Filter out nulls and sort by date
    const validAlerts = alerts
      .filter(a => a !== null)
      .sort((a, b) => new Date(b.date_detected) - new Date(a.date_detected))
      .slice(0, Math.min(limit, 50));

    console.log(`   ✅ Found ${validAlerts.length} alerts`);

    if (validAlerts.length === 0) {
      return {
        success: true,
        count: 0,
        message: `No alerts found${priority ? ` with priority: ${priority}` : ''}${change_type ? ` of type: ${change_type}` : ''}`,
        alerts: []
      };
    }

    return {
      success: true,
      count: validAlerts.length,
      filters_applied: {
        priority: priority || 'all',
        change_type: change_type || 'all',
        days: days
      },
      alerts: validAlerts
    };

  } catch (error) {
    console.error('❌ Error fetching VisualPing alerts:', error);
    return {
      success: false,
      error: error.message,
      alerts: []
    };
  }
}

/**
 * Tool definition for Claude agent
 */
export const visualPingAlertsTool = {
  name: 'get_visualping_alerts',
  description: `Get recent website change alerts from VisualPing monitoring of government grant pages.

Use this to:
- Check for new grant programs that have been announced
- Find recent deadline changes or extensions
- Discover eligibility updates that might benefit clients
- Monitor guideline or funding amount changes
- Stay informed about the grant landscape

Each alert includes VisualPing's AI summary plus our own Claude analysis with change classification, priority level, and recommended actions.

This tool provides proactive market intelligence - check it regularly or when clients ask about "new grants" or "what's changed recently".`,

  input_schema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of alerts to return (default 10, max 50)',
        minimum: 1,
        maximum: 50
      },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter by priority level. Critical = new programs or major changes, High = significant updates, Medium = guideline tweaks, Low = minor changes. Leave empty for all priorities.'
      },
      change_type: {
        type: 'string',
        enum: ['new_program', 'deadline_change', 'eligibility_update', 'guidelines_update', 'funding_change', 'minor_update'],
        description: 'Filter by type of change detected. Leave empty for all types.'
      },
      days: {
        type: 'number',
        description: 'Only show alerts from the last N days (default 30)',
        minimum: 1,
        maximum: 365
      }
    },
    required: []
  },

  handler: getVisualPingAlerts
};

export default visualPingAlertsTool;
