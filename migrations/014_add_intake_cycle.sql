-- Migration 014: Add Intake Cycle Field
-- Created: 2026-02-24
-- Purpose: Add field to track when grants accept applications throughout the year.
--
-- intake_cycle: When the program typically accepts applications (e.g., "Summer, Fall")
-- Scraped from admin edit page (/admin/grants/{id}/edit) from grant[funding_period][] checkboxes

-- ========================================
-- NEW COLUMN
-- ========================================

-- When does this grant typically accept applications?
-- Comma-separated list of: Summer, Fall, Winter, Year Round
-- Example: "Summer, Fall" or "Year Round"
ALTER TABLE grants ADD COLUMN IF NOT EXISTS intake_cycle TEXT;

-- ========================================
-- INDEX
-- ========================================

-- Index for intake_cycle (used in search filters and WHERE clauses)
CREATE INDEX IF NOT EXISTS idx_grants_intake_cycle ON grants(intake_cycle);

-- ========================================
-- VERIFICATION
-- ========================================

DO $$
DECLARE
  total_count INTEGER;
  intake_cycle_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM grants;
  SELECT COUNT(*) INTO intake_cycle_count FROM grants WHERE intake_cycle IS NOT NULL AND intake_cycle != '';

  RAISE NOTICE '✅ Migration 014 complete:';
  RAISE NOTICE '   Total grants: %', total_count;
  RAISE NOTICE '   Grants with intake_cycle: %', intake_cycle_count;
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  NOTE: intake_cycle will be NULL until next scraper run.';
  RAISE NOTICE '   Run: node scripts/export-getgranted-all-grants.js';
END $$;
