-- Granted Files RAG, phase 1 (src/services/rag/): storage for an index of Granted
-- Files so Oracle can answer from file contents. One row per Drive file seen, and
-- text chunks with voyage-3.5 embeddings at 512 dimensions stored as halfvec.
-- No HNSW/IVF index by decision: exact search until it gets slow.
-- Idempotent. Apply via railway ssh (the DB has no public proxy).

CREATE EXTENSION IF NOT EXISTS vector;  -- 0.8.7 available on Railway; halfvec needs ≥ 0.7

-- Every Granted Files file the indexer has looked at, whatever happened to it.
-- duplicate_of: files sharing an md5 are indexed once (the canonical copy holds
-- the chunks); the others point at it so citations can list every copy.
CREATE TABLE IF NOT EXISTS drive_files (
  file_id          TEXT PRIMARY KEY,
  md5              TEXT,                 -- null for native Google files
  name             TEXT NOT NULL,
  path             TEXT NOT NULL,        -- folder path below the Granted Files root
  area             TEXT NOT NULL,        -- Clients | Programs | Departments | Old Files | Other
  client           TEXT,
  program          TEXT,
  year             SMALLINT,
  mime             TEXT NOT NULL,
  modified_time    TIMESTAMPTZ,
  status           TEXT NOT NULL CHECK (status IN ('indexed', 'scanned', 'skipped', 'excluded', 'failed')),
  status_reason    TEXT,                 -- e.g. sensitive_path, type:image, parse_error
  truncated        BOOLEAN NOT NULL DEFAULT false,
  duplicate_of     TEXT REFERENCES drive_files(file_id) ON DELETE SET NULL,
  token_count      INTEGER,
  chunk_count      INTEGER,
  redaction_counts JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {sin, card, bank}: counts only, never values
  last_indexed_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS drive_files_md5 ON drive_files (md5);
CREATE INDEX IF NOT EXISTS drive_files_duplicate_of ON drive_files (duplicate_of);
CREATE INDEX IF NOT EXISTS drive_files_status ON drive_files (status);
CREATE INDEX IF NOT EXISTS drive_files_area_year ON drive_files (area, year);

-- Redacted text chunks of indexed files. area and year are copied from the file
-- so answers can filter or flag Old Files without a join.
CREATE TABLE IF NOT EXISTS drive_chunks (
  id          BIGSERIAL PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES drive_files(file_id) ON DELETE CASCADE,
  chunk_no    INTEGER NOT NULL,
  locator     TEXT,                      -- "p. 3", "pp. 3–4", "Sheet: Budget"
  text        TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding   halfvec(512),              -- voyage-3.5 at 512 dims; null until embedded
  area        TEXT NOT NULL,
  year        SMALLINT,
  UNIQUE (file_id, chunk_no)
);
CREATE INDEX IF NOT EXISTS drive_chunks_area_year ON drive_chunks (area, year);
