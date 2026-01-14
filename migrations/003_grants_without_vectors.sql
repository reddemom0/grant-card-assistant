-- Create grants table for GetGranted data (without vector embeddings)
CREATE TABLE IF NOT EXISTS grants (
  id SERIAL PRIMARY KEY,
  grant_id TEXT UNIQUE NOT NULL,
  grant_name TEXT NOT NULL,
  grant_type TEXT,
  grant_amount TEXT,
  url TEXT NOT NULL,
  regions TEXT,
  industries TEXT,
  program_provider TEXT,
  deadline TEXT,
  max_spend TEXT,
  contribution_percentage TEXT,
  difficulty TEXT,
  grant_criteria TEXT,
  best_practices TEXT,
  full_page_text TEXT,
  last_updated TEXT,
  extracted_at TIMESTAMP NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_grants_active ON grants(is_active);
CREATE INDEX IF NOT EXISTS idx_grants_grant_id ON grants(grant_id);
CREATE INDEX IF NOT EXISTS idx_grants_regions_text ON grants USING gin(to_tsvector('english', COALESCE(regions, '')));
CREATE INDEX IF NOT EXISTS idx_grants_industries_text ON grants USING gin(to_tsvector('english', COALESCE(industries, '')));
CREATE INDEX IF NOT EXISTS idx_grants_grant_type ON grants(grant_type);
CREATE INDEX IF NOT EXISTS idx_grants_created_at ON grants(created_at);
