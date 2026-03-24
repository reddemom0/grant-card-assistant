-- Migration 014: Add lead_gen_events table for lightweight analytics tracking
-- Date: 2026-03-24
-- Purpose: Track user interactions with the lead-gen widget without blocking the UI
--          Events include: widget_opened, form_started, form_completed, message_sent,
--          message_received, estimate_delivered, cta_clicked, session_ended

CREATE TABLE IF NOT EXISTS lead_gen_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtering by event type
CREATE INDEX IF NOT EXISTS idx_lead_gen_events_type
  ON lead_gen_events(event_type);

-- Index for filtering by session
CREATE INDEX IF NOT EXISTS idx_lead_gen_events_session
  ON lead_gen_events(session_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_lead_gen_events_created
  ON lead_gen_events(created_at);

COMMENT ON TABLE lead_gen_events IS
  'Lightweight event tracking for lead-gen widget interactions. Fire-and-forget logging '
  'that does not block the UI. Tracks funnel progression from widget open to CTA click.';

COMMENT ON COLUMN lead_gen_events.session_id IS
  'References lead_gen_conversations.session_id. NULL for pre-session events like widget_opened.';

COMMENT ON COLUMN lead_gen_events.event_type IS
  'Event types: widget_opened, form_started, form_completed, message_sent, message_received, '
  'estimate_delivered, cta_clicked, session_ended';

COMMENT ON COLUMN lead_gen_events.event_data IS
  'Context data: { widget_mode: "inline" | "popup", page_url: "...", referrer: "...", '
  'cta_type: "email_summary" | "book_call" | "service_page", ... }';
