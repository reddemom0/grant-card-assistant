-- Migration 004: Grant Quality Fields
-- Created: 2026-02-17
-- Purpose: Add fields to track whether a grant is actually accepting applications,
--          when data was last verified, and why a grant might be excluded.
--          Also cleans dirty grant_type data (newline artifacts from scraping).

-- ========================================
-- NEW COLUMNS
-- ========================================

-- Is the grant currently accepting applications?
-- Separate from is_active (which comes from GetGranted and is unreliable).
-- Populated by parsing recently_changed text and grant name patterns on import.
ALTER TABLE grants ADD COLUMN IF NOT EXISTS currently_accepting BOOLEAN;

-- When was this grant record last verified as accurate?
-- Set to extracted_at on initial import; updated when manually confirmed.
ALTER TABLE grants ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP;

-- Why is this grant excluded from normal search results?
-- NULL = no exclusion. Set when currently_accepting = false.
ALTER TABLE grants ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

-- Index for the new boolean column (used heavily in WHERE clauses)
CREATE INDEX IF NOT EXISTS idx_grants_currently_accepting ON grants(currently_accepting);

-- ========================================
-- CLEAN DIRTY grant_type DATA
-- Scraper captured "Grant Type\n      Hiring" — strip to just "Hiring" etc.
-- ========================================

UPDATE grants
SET grant_type = trim(regexp_replace(grant_type, '^Grant Type\s+', '', 'i'))
WHERE grant_type ILIKE 'Grant Type%';

-- ========================================
-- POPULATE currently_accepting
-- Logic (in order of priority):
--   1. Garbage name prefix → false (Z-COVID, Z-DUPLICATE, DORMANT, Replaced by)
--   2. recently_changed contains closed/capacity language → false
--   3. is_active = false → false
--   4. last_updated before 2020 → false (clearly stale)
--   5. All else → true
-- ========================================

-- Step A: Set everyone to true first (default)
UPDATE grants SET currently_accepting = true, last_verified_at = extracted_at;

-- Step B: Exclude garbage name prefixes (internal GetGranted archival convention)
UPDATE grants
SET
  currently_accepting = false,
  exclusion_reason = 'Archived program (name prefix indicates internal archival: Z-COVID, Z-DUPLICATE, DORMANT, or replaced)'
WHERE
  grant_name ILIKE '[Z-%'
  OR grant_name ILIKE '(Z-%'
  OR grant_name ILIKE 'Z-COVID%'
  OR grant_name ILIKE '%DORMANT%'
  OR grant_name ILIKE '%(DORMANT)%'
  OR grant_name ILIKE '%[DORMANT]%'
  OR grant_name ILIKE '%Replaced by%'
  OR grant_name ILIKE '%-DUPLICATE]%'
  OR grant_name ILIKE '%[Z-DUPLICATE]%';

-- Step C: Exclude grants where recently_changed explicitly says closed/at capacity
UPDATE grants
SET
  currently_accepting = false,
  exclusion_reason = 'recently_changed indicates program is no longer accepting applications'
WHERE
  currently_accepting = true  -- don't overwrite already-excluded grants
  AND recently_changed IS NOT NULL
  AND (
    recently_changed ILIKE '%no longer accepting%'
    OR recently_changed ILIKE '%at capacity%'
    OR recently_changed ILIKE '%program is closed%'
    OR recently_changed ILIKE '%intake is closed%'
    OR recently_changed ILIKE '%applications are closed%'
    OR recently_changed ILIKE '%applications closed%'
    OR recently_changed ILIKE '%funding exhausted%'
    OR recently_changed ILIKE '%funding has been fully allocated%'
    OR recently_changed ILIKE '%program has ended%'
    OR recently_changed ILIKE '%program has been cancelled%'
    OR recently_changed ILIKE '%no longer available%'
    OR recently_changed ILIKE '%not currently accepting%'
    OR recently_changed ILIKE '%temporarily closed%'
    OR recently_changed ILIKE '%paused%applications%'
  );

-- Step D: Exclude grants that GetGranted itself marked inactive
UPDATE grants
SET
  currently_accepting = false,
  exclusion_reason = COALESCE(exclusion_reason, 'Marked inactive by GetGranted (is_active = false)')
WHERE
  currently_accepting = true
  AND is_active = false;

-- Step E: Exclude grants not updated since 2020 (clearly stale, pre-COVID era programs)
UPDATE grants
SET
  currently_accepting = false,
  exclusion_reason = COALESCE(exclusion_reason, 'Last updated before 2020 — program is likely discontinued')
WHERE
  currently_accepting = true
  AND last_updated IS NOT NULL
  AND last_updated < '2020/01/01';

-- ========================================
-- VERIFY RESULTS
-- ========================================

DO $$
DECLARE
  total_count INTEGER;
  accepting_count INTEGER;
  excluded_count INTEGER;
  reason_counts TEXT;
BEGIN
  SELECT COUNT(*) INTO total_count FROM grants;
  SELECT COUNT(*) INTO accepting_count FROM grants WHERE currently_accepting = true;
  SELECT COUNT(*) INTO excluded_count FROM grants WHERE currently_accepting = false;

  RAISE NOTICE '✅ Migration 004 complete:';
  RAISE NOTICE '   Total grants: %', total_count;
  RAISE NOTICE '   Currently accepting: %', accepting_count;
  RAISE NOTICE '   Excluded from search: %', excluded_count;
END $$;
