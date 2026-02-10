-- Migration 003: Add recently_changed field to grants table
-- Created: 2026-02-10
-- Purpose: Capture the "Recently Changed" section from GetGranted grant cards
--          This section contains critical deadline updates and program changes

-- Add recently_changed column
ALTER TABLE grants
ADD COLUMN IF NOT EXISTS recently_changed TEXT;

-- Add comment for documentation
COMMENT ON COLUMN grants.recently_changed IS 'Recently Changed section from GetGranted showing latest program updates, deadline changes, and important announcements';

-- Create full-text search index for recently_changed content
CREATE INDEX IF NOT EXISTS idx_grants_recently_changed_search
  ON grants USING gin(to_tsvector('english', COALESCE(recently_changed, '')));

-- Update the search function to include recently_changed in text search
CREATE OR REPLACE FUNCTION search_grants_by_text(search_query TEXT)
RETURNS TABLE (
  grant_id TEXT,
  grant_name TEXT,
  grant_type TEXT,
  regions TEXT,
  url TEXT,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.grant_id,
    g.grant_name,
    g.grant_type,
    g.regions,
    g.url,
    ts_rank(
      to_tsvector('english',
        COALESCE(g.grant_name, '') || ' ' ||
        COALESCE(g.grant_criteria, '') || ' ' ||
        COALESCE(g.best_practices, '') || ' ' ||
        COALESCE(g.recently_changed, '')
      ),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM grants g
  WHERE to_tsvector('english',
    COALESCE(g.grant_name, '') || ' ' ||
    COALESCE(g.grant_criteria, '') || ' ' ||
    COALESCE(g.best_practices, '') || ' ' ||
    COALESCE(g.recently_changed, '')
  ) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 003 complete: recently_changed field added to grants table';
END $$;
