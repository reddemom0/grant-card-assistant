-- 039: one-to-one links between GG1 grants and the GG3 copy, by name
--
-- GG1 and GG3 ids never overlap, so the only join is by name. The builder in
-- src/services/gg1-gg3-links.js normalizes both sides (NFKD accent strip,
-- lowercase, [bracketed] segments dropped, non-alphanumerics collapsed to single
-- spaces, trimmed) and links a GG1 grant to a GG3 grant only when exactly one
-- record on each side shares the name. A stream guard keeps names that differ
-- by a stream / component / phase number apart, even when the number sat in the
-- dropped brackets. No fuzzy matching.
--
-- gg1_gg3_unmatched lists everything else for humans: no_counterpart (nothing
-- on the other side has the name) or ambiguous (two or more candidates on
-- either side). status is the record's own side: GG1 'active'/'inactive' from
-- is_active, GG3 status as sent.
--
-- Both tables are replaced in one transaction after every successful GG3
-- refresh (src/services/gg3-refresh.js). A failed rebuild leaves the previous
-- links in place and never affects the refresh.
--
-- Depends on: 038 (gg3_grants) and the GG1 grants table. Apply BEFORE deploying
-- the code — until then every rebuild fails on the missing tables (logged only).

CREATE TABLE IF NOT EXISTS gg1_gg3_links (
  gg1_id TEXT PRIMARY KEY,
  gg3_id INTEGER NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gg1_gg3_unmatched (
  side TEXT NOT NULL CHECK (side IN ('gg1', 'gg3')),
  grant_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  normalized_name TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('no_counterpart', 'ambiguous')),
  listed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (side, grant_id)
);
