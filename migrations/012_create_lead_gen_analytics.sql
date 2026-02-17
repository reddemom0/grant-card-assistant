-- ============================================================================
-- Migration 012: Lead-Gen Analytics Funnel Table
--
-- Lightweight event tracking for the public lead-gen chatbot funnel.
-- Server-side events only (conversation_started, search_performed,
-- contact_captured). Agent-side events (discovery_complete, etc.) can be
-- derived from conversation transcripts later.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_gen_analytics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT        NOT NULL REFERENCES lead_gen_conversations(session_id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN (
                                'conversation_started',
                                'discovery_complete',
                                'search_performed',
                                'programs_matched',
                                'estimate_delivered',
                                'cta_presented',
                                'contact_captured',
                                'lead_saved'
                              )),
  event_data      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for funnel queries by event type and time window
CREATE INDEX IF NOT EXISTS idx_lead_gen_analytics_event_type
  ON lead_gen_analytics (event_type, created_at DESC);

-- Index for per-conversation event lookup
CREATE INDEX IF NOT EXISTS idx_lead_gen_analytics_conversation
  ON lead_gen_analytics (conversation_id, created_at ASC);

COMMENT ON TABLE lead_gen_analytics IS
  'Funnel event log for the public lead-gen chatbot. One row per event.';

COMMENT ON COLUMN lead_gen_analytics.event_type IS
  'conversation_started | discovery_complete | search_performed | programs_matched | estimate_delivered | cta_presented | contact_captured | lead_saved';

COMMENT ON COLUMN lead_gen_analytics.event_data IS
  'Optional JSONB context: { results_count, estimated_funding, cta_type, lead_score, ... }';
