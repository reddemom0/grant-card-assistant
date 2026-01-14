-- GetGranted Database Schema
-- Stores all grants from GetGranted with semantic search capabilities

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Grants table
CREATE TABLE IF NOT EXISTS grants (
  id SERIAL PRIMARY KEY,
  grant_id TEXT UNIQUE NOT NULL,           -- GetGranted's unique ID (e.g., "741")
  grant_name TEXT NOT NULL,                -- Full grant name
  grant_type TEXT,                         -- Grant type(s), comma-separated
  regions TEXT,                            -- Geographic coverage
  full_text TEXT NOT NULL,                 -- Complete text content from GetGranted
  url TEXT,                                -- Link to GetGranted grant page

  -- Semantic search embedding (1536 dimensions for text-embedding-3-small)
  embedding vector(1536),

  -- Metadata
  extracted_at TIMESTAMP,                  -- When scraped from GetGranted
  created_at TIMESTAMP DEFAULT NOW(),      -- When added to our database
  updated_at TIMESTAMP DEFAULT NOW()       -- When last updated
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_grants_grant_id ON grants(grant_id);
CREATE INDEX IF NOT EXISTS idx_grants_name ON grants USING gin(to_tsvector('english', grant_name));
CREATE INDEX IF NOT EXISTS idx_grants_type ON grants USING gin(to_tsvector('english', grant_type));
CREATE INDEX IF NOT EXISTS idx_grants_regions ON grants USING gin(to_tsvector('english', regions));
CREATE INDEX IF NOT EXISTS idx_grants_full_text ON grants USING gin(to_tsvector('english', full_text));

-- Vector similarity search index (HNSW for fast approximate nearest neighbor search)
CREATE INDEX IF NOT EXISTS idx_grants_embedding ON grants USING hnsw (embedding vector_cosine_ops);

-- Comments for documentation
COMMENT ON TABLE grants IS 'GetGranted grants database with semantic search capabilities';
COMMENT ON COLUMN grants.grant_id IS 'GetGranted unique ID (e.g., "741")';
COMMENT ON COLUMN grants.embedding IS 'Text embedding vector (1536-dim) for semantic search';
COMMENT ON COLUMN grants.full_text IS 'Complete grant content including tags, budgets, deadlines, difficulty';
