-- GetGranted Full Database Schema
-- Migration 002: Create comprehensive grants database with semantic search
-- Created: 2026-01-14

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ========================================
-- GRANTS TABLE (Complete grant information)
-- ========================================
CREATE TABLE IF NOT EXISTS grants (
  id SERIAL PRIMARY KEY,
  grant_id TEXT UNIQUE NOT NULL,                 -- GetGranted's unique ID (e.g., "741")

  -- Basic Information
  grant_name TEXT NOT NULL,
  grant_type TEXT,                                -- "Market Expansion, Capital Costs"
  grant_amount TEXT,                              -- "$40,000,000"
  url TEXT NOT NULL,

  -- Geographic & Industry Scope
  regions TEXT,                                    -- "All of Canada" or specific provinces
  industries TEXT,                                 -- Comma-separated list

  -- Program Details
  program_provider TEXT,                           -- "Government of Canada", "New Ventures BC"
  deadline TEXT,                                   -- "Open until filled", "2026/02/20"
  max_spend TEXT,                                  -- "$20,000,000"
  contribution_percentage TEXT,                    -- "50%", "75%"
  difficulty TEXT,                                 -- "3/5", rating level

  -- Rich Content (Large text fields)
  grant_criteria TEXT,                             -- Detailed eligibility, expenses, projects
  best_practices TEXT,                             -- Process guidance, forms, links
  full_page_text TEXT,                             -- Complete page backup

  -- Semantic Search
  embedding vector(1536),                          -- Text embedding for similarity search

  -- Metadata
  last_updated TEXT,                               -- "2025/04/02" from GetGranted
  extracted_at TIMESTAMP NOT NULL,                 -- When we scraped this data
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- INDEXES for Performance
-- ========================================

-- Primary lookups
CREATE INDEX IF NOT EXISTS idx_grants_grant_id ON grants(grant_id);
CREATE INDEX IF NOT EXISTS idx_grants_updated ON grants(updated_at DESC);

-- Full-text search indexes (PostgreSQL native search)
CREATE INDEX IF NOT EXISTS idx_grants_name_search
  ON grants USING gin(to_tsvector('english', grant_name));

CREATE INDEX IF NOT EXISTS idx_grants_type_search
  ON grants USING gin(to_tsvector('english', COALESCE(grant_type, '')));

CREATE INDEX IF NOT EXISTS idx_grants_regions_search
  ON grants USING gin(to_tsvector('english', COALESCE(regions, '')));

CREATE INDEX IF NOT EXISTS idx_grants_industries_search
  ON grants USING gin(to_tsvector('english', COALESCE(industries, '')));

CREATE INDEX IF NOT EXISTS idx_grants_criteria_search
  ON grants USING gin(to_tsvector('english', COALESCE(grant_criteria, '')));

-- Vector similarity search index (HNSW for fast approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_grants_embedding
  ON grants USING hnsw (embedding vector_cosine_ops);

-- ========================================
-- HELPER FUNCTIONS
-- ========================================

-- Function to search grants by text (combines name, criteria, best_practices)
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
        COALESCE(g.best_practices, '')
      ),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM grants g
  WHERE to_tsvector('english',
    COALESCE(g.grant_name, '') || ' ' ||
    COALESCE(g.grant_criteria, '') || ' ' ||
    COALESCE(g.best_practices, '')
  ) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar grants by vector embedding
CREATE OR REPLACE FUNCTION search_grants_by_embedding(query_embedding vector(1536), result_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  grant_id TEXT,
  grant_name TEXT,
  grant_type TEXT,
  regions TEXT,
  url TEXT,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.grant_id,
    g.grant_name,
    g.grant_type,
    g.regions,
    g.url,
    1 - (g.embedding <=> query_embedding) AS similarity
  FROM grants g
  WHERE g.embedding IS NOT NULL
  ORDER BY g.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- COMMENTS for Documentation
-- ========================================

COMMENT ON TABLE grants IS 'GetGranted grants database with full detail pages and semantic search';
COMMENT ON COLUMN grants.grant_id IS 'GetGranted unique ID (e.g., "741")';
COMMENT ON COLUMN grants.grant_criteria IS 'Detailed eligibility, applicants, expenses, projects, program details';
COMMENT ON COLUMN grants.best_practices IS 'Process guidance, eligible best practices, forms and links';
COMMENT ON COLUMN grants.full_page_text IS 'Complete page text backup for fallback searching';
COMMENT ON COLUMN grants.embedding IS 'Text embedding vector (1536-dim) for semantic similarity search';
COMMENT ON COLUMN grants.extracted_at IS 'When this grant was scraped from GetGranted';
COMMENT ON COLUMN grants.last_updated IS 'Last updated date shown on GetGranted page';

-- ========================================
-- GRANT ACCESS (if needed for specific users)
-- ========================================
-- GRANT SELECT ON grants TO getgranted_read_user;
-- GRANT ALL ON grants TO getgranted_admin_user;
