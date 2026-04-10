-- Migration 018: Add last_edited_at column
-- Captures the most recent edit date from GG 1.0's admin edit history page
-- This is the actual edit timestamp, distinct from last_updated (public page "Updated on" text)

ALTER TABLE grants ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;

-- Index for freshness filtering (e.g., WHERE last_edited_at >= '2025-01-01')
CREATE INDEX IF NOT EXISTS idx_grants_last_edited_at ON grants (last_edited_at);
