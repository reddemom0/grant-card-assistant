/**
 * Lead Generation Event Tracking Endpoint
 *
 * Handles lightweight analytics events from the widget:
 * - widget_opened, form_started, form_completed
 * - message_sent, message_received, estimate_delivered
 * - cta_clicked, session_ended
 *
 * Fire-and-forget pattern - no auth required, just IP rate limiting
 */

import { query } from '../database/connection.js';

// In-memory rate limiting (simple IP-based)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_EVENTS_PER_MINUTE = 100; // Allow up to 100 events per IP per minute

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip;

  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  const limit = rateLimits.get(key);

  // Reset if window expired
  if (now > limit.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  // Check count
  if (limit.count >= MAX_EVENTS_PER_MINUTE) {
    return false;
  }

  limit.count++;
  return true;
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of rateLimits.entries()) {
    if (now > limit.resetAt) {
      rateLimits.delete(key);
    }
  }
}, 5 * 60 * 1000);

export async function handleLeadGenEvent(req, res) {
  try {
    const { session_id, event_type, event_data } = req.body;

    // Validate event_type
    const validEventTypes = [
      'widget_opened',
      'form_started',
      'form_completed',
      'message_sent',
      'message_received',
      'estimate_delivered',
      'cta_clicked',
      'session_ended'
    ];

    if (!event_type || !validEventTypes.includes(event_type)) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }

    // Get IP for rate limiting
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';

    // Rate limit check
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Insert event into database
    await query(
      `INSERT INTO lead_gen_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [session_id || null, event_type, event_data || {}]
    );

    // Fire-and-forget - return 204 No Content (success with no response body)
    res.status(204).send();

  } catch (error) {
    console.error('Error tracking lead-gen event:', error);
    // Still return success - don't break widget functionality
    res.status(204).send();
  }
}
