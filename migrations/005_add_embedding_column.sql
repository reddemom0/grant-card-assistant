-- Migration 005: Add embedding column to grants table
-- Created: 2026-02-17
-- Purpose: Adds vector embedding column for semantic search via pgvector.
--          voyage-3 (Voyage AI) outputs 1024-dimensional embeddings.

-- Enable pgvector extension (safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (voyage-3 = 1024 dimensions)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- HNSW index for fast approximate nearest-neighbor search
-- Only built on rows with embeddings (WHERE clause not supported by HNSW, built post-populate)
CREATE INDEX IF NOT EXISTS idx_grants_embedding
  ON grants USING hnsw (embedding vector_cosine_ops);

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 005 complete: embedding vector(1024) column added to grants';
END $$;
