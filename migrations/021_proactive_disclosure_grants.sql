-- Migration 021: Proactive Disclosure - Grants and Contributions
-- Date: 2026-05-14
-- Purpose: Ingest the Government of Canada's federal grants/contributions
--          dataset (~3M rows from open.canada.ca, refreshed quarterly).
--          Adds main table, NAICS reference labels, ingest meta, helper
--          view + materialized view, and 8 query-tuning indexes.
--
-- Idempotent: every statement uses IF NOT EXISTS / OR REPLACE / ON CONFLICT
-- so this file can be re-applied safely.

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Trigram matching is used for fuzzy recipient-name lookups and free-text
-- description search. On Railway managed Postgres this requires the
-- connecting role to have CREATE privileges; the ingestion script's preflight
-- check probes pg_extension first and prints an actionable error if missing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- MAIN TABLE: proactive_disclosure_grants
-- ============================================================================
-- One row per (ref_number, amendment_number). Original agreement is
-- amendment_number = 0; subsequent amendments increment. Column order is
-- deliberate: small fixed-width fields first (better heap-page packing),
-- wide TOAST-eligible text last.
CREATE TABLE IF NOT EXISTS proactive_disclosure_grants (
  -- Identity (composite PK)
  ref_number                TEXT        NOT NULL,
  amendment_number          INTEGER     NOT NULL DEFAULT 0,

  -- Dates (clustered together for alignment)
  amendment_date            DATE,
  disclosed_date            DATE,                -- NULL when source doesn't expose it; do not invent

  -- Classification (CHAR(1) enums per federal data dictionary)
  agreement_type            CHAR(1),             -- G=Grant, C=Contribution, O=Other
  recipient_type            CHAR(1),             -- F=For-profit, N=Non-profit, A=Indigenous,
                                                 -- S=Academia, P=Individual, G=Government,
                                                 -- I=International, O=Other

  -- Recipient identity + geography
  recipient_business_number TEXT,                -- CRA BN; NULL for individuals / foreign
  recipient_legal_name      TEXT,
  recipient_operating_name  TEXT,
  recipient_country         TEXT,
  recipient_province        TEXT,                -- 2-letter (normalized at ingest); CA only
  recipient_city            TEXT,
  recipient_postal_code     TEXT,
  federal_riding_name_en    TEXT,
  federal_riding_number     TEXT,

  -- Program + agreement
  prog_name_en              TEXT,
  prog_purpose_en           TEXT,
  agreement_title_en        TEXT,
  agreement_number          TEXT,
  agreement_value           NUMERIC(15,2),       -- NET dollars; amendments may be negative (clawbacks)
  agreement_start_date      DATE,
  agreement_end_date        DATE,
  naics_identifier          TEXT,                -- 2-6 digit string; inconsistent per row in source
  owner_org                 TEXT,                -- department short code
  owner_org_title           TEXT,                -- department English title

  -- Wide text fields (TOAST-eligible, kept last)
  description_en            TEXT,
  expected_results_en       TEXT,

  -- House-keeping
  ingested_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (ref_number, amendment_number),
  CONSTRAINT pdg_amendment_number_nonneg CHECK (amendment_number >= 0),
  CONSTRAINT pdg_agreement_type_enum     CHECK (agreement_type IS NULL OR agreement_type IN ('G','C','O')),
  CONSTRAINT pdg_recipient_type_enum     CHECK (recipient_type IS NULL OR recipient_type IN ('F','N','A','S','P','G','I','O'))
);

COMMENT ON TABLE proactive_disclosure_grants IS
  'Government of Canada Proactive Disclosure - Grants and Contributions. '
  'Source: open.canada.ca dataset 432527ab-7aac-45b5-81d6-7597107a7013. '
  'Refreshed manually via scripts/ingest-federal-grants.js; quarterly cadence per source.';
COMMENT ON COLUMN proactive_disclosure_grants.agreement_value IS
  'Net dollar value of the agreement as of this amendment. Amendments may reduce '
  'an earlier value to zero or negative (clawback). For "total disbursed" '
  'aggregates, sum from view pdg_latest_amendments (one row per ref_number).';
COMMENT ON COLUMN proactive_disclosure_grants.disclosed_date IS
  'Date the row was published on open.canada.ca. NULL when not exposed in the '
  'source CSV. Do not coerce to ingested_at — they are not equivalent.';

-- ============================================================================
-- NAICS LABELS: official StatsCan codes → English labels
-- ============================================================================
-- v1 loads only 2- and 3-digit codes; CHECK accepts 2-6 so the table can grow
-- without a schema change. parent_code FK gives free hierarchical lookups.
CREATE TABLE IF NOT EXISTS naics_labels (
  code        TEXT        PRIMARY KEY,
  length      SMALLINT    NOT NULL CHECK (length IN (2,3,4,5,6)),
  label_en    TEXT        NOT NULL,
  parent_code TEXT        REFERENCES naics_labels(code),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_naics_labels_length ON naics_labels (length);

COMMENT ON TABLE naics_labels IS
  'NAICS Canada 2022 v1.0 hierarchy from StatsCan. Loaded via ingest-federal-grants.js --naics-only. '
  'v1 keeps only 2- and 3-digit codes; longer codes accepted by CHECK if loaded later.';

-- ============================================================================
-- INGEST META: single-row tracker for the federal-grants source
-- ============================================================================
-- One row, id=1, enforced via CHECK. Used by --refresh mode to skip re-ingest
-- when the source's Last-Modified header hasn't advanced.
CREATE TABLE IF NOT EXISTS proactive_disclosure_meta (
  id                       SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_modified            TIMESTAMPTZ,
  last_ingested_at         TIMESTAMPTZ,
  last_ingested_row_count  BIGINT,
  last_ingest_mode         TEXT,
  source_etag              TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO proactive_disclosure_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE proactive_disclosure_meta IS
  'Single-row metadata for the federal grants ingestion. Maintained by scripts/ingest-federal-grants.js.';

-- ============================================================================
-- INDEXES (8 total, sized to support the 20 Oracle queries in the discovery doc)
-- ============================================================================

-- Aggregate by program, often filtered/sorted by start date (Q1-3, Q11-13, Q19, Q21)
CREATE INDEX IF NOT EXISTS idx_pdg_prog_start
  ON proactive_disclosure_grants (prog_name_en, agreement_start_date);

-- Aggregate by department (Q4, Q22)
CREATE INDEX IF NOT EXISTS idx_pdg_owner_org
  ON proactive_disclosure_grants (owner_org_title);

-- Province + recipient_type slicing (Q1, Q5, Q10)
CREATE INDEX IF NOT EXISTS idx_pdg_prov_rectype_start
  ON proactive_disclosure_grants (recipient_province, recipient_type, agreement_start_date);

-- NAICS 2-digit rollup (Q4, Q5, Q9, Q16). Functional index lets queries
-- filter on LEFT(naics_identifier, 2) without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_pdg_naics_prefix
  ON proactive_disclosure_grants (LEFT(naics_identifier, 2));

-- Repeat-funding lookups (Q7, Q8, Q15). Partial because individuals lack BN.
CREATE INDEX IF NOT EXISTS idx_pdg_recipient_bn
  ON proactive_disclosure_grants (recipient_business_number)
  WHERE recipient_business_number IS NOT NULL;

-- Fuzzy recipient-name match when BN is unavailable (Q6, Q8, Q18)
CREATE INDEX IF NOT EXISTS idx_pdg_recipient_legal_trgm
  ON proactive_disclosure_grants
  USING GIN (recipient_legal_name gin_trgm_ops);

-- Keyword search inside agreement descriptions (Q17)
CREATE INDEX IF NOT EXISTS idx_pdg_description_trgm
  ON proactive_disclosure_grants
  USING GIN (description_en gin_trgm_ops);

-- Riding / city geographic queries (Q10). Partial: many older rows lack riding.
CREATE INDEX IF NOT EXISTS idx_pdg_riding
  ON proactive_disclosure_grants (federal_riding_number)
  WHERE federal_riding_number IS NOT NULL;

-- ============================================================================
-- VIEW: pdg_latest_amendments — one row per ref_number, the latest amendment
-- ============================================================================
-- DISTINCT ON resolves to the row with the highest amendment_number, breaking
-- ties by amendment_date (latest) and ingested_at (latest). This is what Oracle
-- tools query when "show me agreements" really means "show me the current
-- state of each agreement, not the audit history".
CREATE OR REPLACE VIEW pdg_latest_amendments AS
SELECT DISTINCT ON (ref_number) *
FROM proactive_disclosure_grants
ORDER BY ref_number, amendment_number DESC, amendment_date DESC NULLS LAST, ingested_at DESC;

COMMENT ON VIEW pdg_latest_amendments IS
  'One row per ref_number, resolved to the latest amendment. Use for "current state" '
  'queries; the raw table is the audit history.';

-- ============================================================================
-- MATERIALIZED VIEW: pdg_program_yearly — pre-aggregated program rollups
-- ============================================================================
-- Built on pdg_latest_amendments (not the raw table) so amendments don't
-- double-count toward program totals. Refreshed by the ingestion script with
-- REFRESH MATERIALIZED VIEW CONCURRENTLY after every load.
--
-- Note: CREATE MATERIALIZED VIEW does NOT support OR REPLACE in Postgres
-- (unlike regular views). IF NOT EXISTS is the only idempotent option.
CREATE MATERIALIZED VIEW IF NOT EXISTS pdg_program_yearly AS
SELECT
  prog_name_en,
  owner_org_title,
  DATE_TRUNC('year', agreement_start_date)::DATE AS year,
  recipient_province,
  recipient_type,
  COUNT(*)                                       AS agreement_count,
  SUM(agreement_value)                           AS total_value,
  AVG(agreement_value)                           AS avg_value,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY agreement_value) AS median_value
FROM pdg_latest_amendments
WHERE agreement_start_date IS NOT NULL
GROUP BY prog_name_en, owner_org_title, year, recipient_province, recipient_type;

-- Unique index required by REFRESH ... CONCURRENTLY. COALESCE wraps every
-- nullable grouping column because Postgres treats NULL as distinct, which
-- would otherwise allow two "all-NULL" rows past the unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdg_pyy_pk
  ON pdg_program_yearly (
    COALESCE(prog_name_en, ''),
    COALESCE(owner_org_title, ''),
    year,
    COALESCE(recipient_province, ''),
    COALESCE(recipient_type, '')
  );

-- Common access pattern: "top programs over time"
CREATE INDEX IF NOT EXISTS idx_pdg_pyy_prog
  ON pdg_program_yearly (prog_name_en, year);

COMMENT ON MATERIALIZED VIEW pdg_program_yearly IS
  'Yearly rollup of net program funding. Built from pdg_latest_amendments so '
  'amendments do not double-count. Refresh CONCURRENTLY after every ingest.';
