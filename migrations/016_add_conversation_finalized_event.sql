-- Migration 016: Add "conversation_finalized" to analytics event types
-- This event is logged when a lead-gen conversation reaches finalization
-- (contact_captured or inactivity_timeout)

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
