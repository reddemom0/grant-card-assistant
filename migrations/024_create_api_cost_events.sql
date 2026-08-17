-- Migration 024: Persist per-call Anthropic token usage and estimated cost
--
-- WHY
-- src/utils/cost-logger.js:22 already receives the full `usage` object from
-- every Claude API call — input_tokens, output_tokens,
-- cache_creation_input_tokens, cache_read_input_tokens — computes a cost, prints
-- it to stdout, and discards it. Nothing anywhere persists token data: the only
-- stored cost figure in the whole system is lead_gen_conversations.api_cost_total
-- (dollars only, lead-gen only). That left basic questions unanswerable — which
-- agent costs what, whether prompt caching is paying for itself, how cost grows
-- across agent-loop iterations.
--
-- ONE ROW PER API CALL
-- Not per conversation. Cache behaviour is only visible per call: a cold first
-- call writes the prefix, later calls read it, and aggregating hides exactly the
-- signal worth having.
--
-- COST_USD IS AN ESTIMATE, NOT THE INVOICE
-- calculateRequestCost (src/config/cost-settings.js:71) uses a hardcoded rate
-- table labelled "as of Jan 2026". It applies ONE cache-write price to
-- cache_creation_input_tokens, so it cannot distinguish a 1h-TTL write (billed
-- at 2x base) from a 5m write (1.25x), and it silently falls back to Sonnet
-- pricing for any model not in its table — an Opus or Sonnet-5 call would be
-- understated with no warning. Trust the token columns; treat cost_usd as
-- indicative. usage_raw preserves the untouched payload so a corrected cost can
-- be recomputed later without re-instrumenting anything.
--
-- EVERYTHING EXCEPT source AND model IS NULLABLE
-- Of the 16 logAPICost call sites, only 1 (src/claude/client.js:734, the agent
-- loop) carries agent + conversation + user. 8 carry agent_type alone; 7 carry
-- neither — background work like the VisualPing webhook
-- (src/api/visualping-webhook.js:171) and PDF processing
-- (src/anthropic-client.js:413) genuinely has no user or conversation.
--
-- NO FOREIGN KEYS
-- conversation_id may reference conversations(id), or a lead-gen session_id, or
-- nothing at all. An FK would turn a logging failure into a request failure,
-- which is the opposite of what this table is for.
--
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS api_cost_events (
  -- BIGSERIAL, not UUID: this is a high-volume append-only log. Recent tables
  -- use gen_random_uuid(), but nothing here needs an unguessable ID and a
  -- monotonic integer key is cheaper to index and to range-scan.
  id                          BIGSERIAL PRIMARY KEY,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The only two fields present at every call site.
  source                      TEXT NOT NULL,
  model                       TEXT NOT NULL,

  agent_type                  TEXT,

  -- TEXT, not UUID, deliberately: conversations.id is a uuid but lead-gen
  -- passes lead_gen_conversations.session_id, which is TEXT
  -- (src/api/lead-gen.js:518). A uuid column would reject those inserts
  -- outright, and a rejected insert on the logging path is worse than a
  -- loosely-typed column.
  conversation_id             TEXT,

  user_id                     INTEGER,
  user_email                  TEXT,

  -- The four counts kept separate — the entire point of the table. Rolling them
  -- into one total would hide the cache-write vs cache-read split.
  input_tokens                INTEGER NOT NULL DEFAULT 0,
  output_tokens               INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,

  cost_usd                    NUMERIC(12,6) NOT NULL DEFAULT 0,

  usage_raw                   JSONB,
  metadata                    JSONB
);

COMMENT ON TABLE api_cost_events IS
  'One row per Anthropic API call: token counts, estimated cost, and whatever attribution the call site had. Written fire-and-forget from logAPICost (src/utils/cost-logger.js) — a failed insert warns and is dropped, never blocking a user turn.';

COMMENT ON COLUMN api_cost_events.source IS
  'Call-site identifier, e.g. agent-loop, conversation-title-generation, visualping-webhook, pdf-processing. Always present.';
COMMENT ON COLUMN api_cost_events.agent_type IS
  'NULL for the 7 call sites with no agent context (PDF processing, VisualPing, vector-search rerank, batch retag, smart-filter mapping, 2x google-docs advanced).';
COMMENT ON COLUMN api_cost_events.conversation_id IS
  'TEXT because it holds either a conversations.id uuid or a lead-gen session_id. No FK by design. NULL for background work.';
COMMENT ON COLUMN api_cost_events.user_id IS
  'users.id. NULL for lead-gen (public endpoint, no authenticated user) and all background work. NOTE: the HubSpot auto-enrichment webhook runs as synthetic system user 1 (src/api/hubspot-webhook.js:493) — those rows are indistinguishable from real user-1 activity except by joining conversations.title LIKE ''Auto-enrichment:%''.';
COMMENT ON COLUMN api_cost_events.cost_usd IS
  'ESTIMATE from calculateRequestCost, not billed cost. Cannot distinguish 5m from 1h cache writes; defaults unknown models to Sonnet pricing. See the migration header.';
COMMENT ON COLUMN api_cost_events.usage_raw IS
  'The untouched usage object from the API response. Preserves fields the scalar columns do not model — notably any future per-TTL cache_creation breakdown.';
COMMENT ON COLUMN api_cost_events.metadata IS
  'Free-form context from the call site. For 11 of 16 sites this is the only attribution available (e.g. lead-gen session, VisualPing alertId).';

-- Time-range scans are the default access pattern for any cost question.
CREATE INDEX IF NOT EXISTS idx_api_cost_events_created_at
  ON api_cost_events(created_at DESC);

-- "What does each agent cost over time" — the primary reporting query.
CREATE INDEX IF NOT EXISTS idx_api_cost_events_agent_created
  ON api_cost_events(agent_type, created_at DESC);

-- Partial: user_id is NULL for lead-gen and all background work, and NULLs are
-- not meaningful to search on.
CREATE INDEX IF NOT EXISTS idx_api_cost_events_user_created
  ON api_cost_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Partial: supports drilling into one conversation's per-call cost curve, which
-- is how cache and tool-result growth become visible.
CREATE INDEX IF NOT EXISTS idx_api_cost_events_conversation
  ON api_cost_events(conversation_id)
  WHERE conversation_id IS NOT NULL;
