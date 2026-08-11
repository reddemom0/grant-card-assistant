# Final Batch Re-Resolution

**Generated:** 2026-08-11T19:08:02.275Z
**Inputs:** `dist/inventory/grants-inventory.csv` (unmodified), `dist/inventory/final-clients.csv`, `scripts/grants-lib.mjs`
**Output:** `dist/inventory/resolved-final.csv` (gitignored — regenerable)
**Method:** mechanical only. No API call of any kind. No new judgements — existing labels are reused as data.

## Step 1 — Skip list extended to 89 names

The 6 names the follow-up pass labelled `batch` are now in `MODEL_BATCH_NAMES` in `scripts/grants-lib.mjs`, and are also exported separately as `PASS2_BATCH_NAMES` so a run can diff against the pass-1 state (which is how the before/after below is computed).

| Name added | Files it held before this round |
|---|---|
| `CAJG Clients` | 1,038 |
| `2017:2018 Clients` | 216 |
| `2020 Clients - Waitlist` | 174 |
| `Clients - Q4` | 141 |
| `Clients - Q1, Q2` | 89 |
| `2016:2017 Clients (Abandoned)` | 14 |
| **Total** | **1,672** |

Same failure modes as the earlier additions: "Clients" used as a grouping word, a quarter label with no year, a program acronym, a parenthesised status suffix.

---

## Step 2 — Re-resolution

| Measure | Before (83-name list) | After (89-name list) | Δ |
|---|---|---|---|
| Distinct candidate names | 2,097 | **2,127** | +30 |
| Files attributed | 74,989 | 74,985 | -4 |
| File coverage | 98.7% | **98.7%** | |

| Status | Names |
|---|---|
| Already classified (pass 1 or 2) | 2,091 |
| **New and unjudged** | **36** |

Breakdown by carried-over label:

| Label | Names |
|---|---|
| `client` | 1,962 |
| `doctype` | 61 |
| `internal` | 58 |
| **UNCLASSIFIED** | 36 |
| `unclear` | 10 |

---

## Step 3 — What moved

**1,668 files** moved from one of the 6 batch folders to a deeper client-depth attribution.

| Batch folder descended | Files released | Distinct names beneath |
|---|---|---|
| `CAJG Clients` | 1,037 | 37 |
| `2017:2018 Clients` | 214 | 4 |
| `2020 Clients - Waitlist` | 174 | 31 |
| `Clients - Q4` | 140 | 19 |
| `Clients - Q1, Q2` | 89 | 11 |
| `2016:2017 Clients (Abandoned)` | 14 | 1 |

### Newly orphaned: 4 files

Loose files sitting directly inside a descended batch folder. Once the folder is skipped through, nothing above them qualifies as client depth, so they lose attribution entirely.

| Batch folder | Loose files orphaned |
|---|---|
| `2017:2018 Clients` | 2 |
| `Clients - Q4` | 1 |
| `CAJG Clients` | 1 |

### Running total of unattributed files

| | Files |
|---|---|
| Total files in the tree | 75,971 |
| Attributed to a name | 74,985 (98.7%) |
| **Unattributed** | **986** (1.3%) |
| — orphaned by this round | 4 |

The unattributed set is out of scope here — it goes to the review sheet.

---

## Step 4 — Has the batch pattern converged?

Skip-list growth across rounds: **16 → 83 → 6 → 0**.

**Converged.** None of the 36 newly surfaced names is batch-shaped by the mechanical classifier, and none carries a grouping tell-tale (`clients`, `intake`, `applications`, `forms`, `Q1-Q4`, `stream`, `cohort`, `waitlist`, `prospects`). No further re-resolution round is indicated.

**Cost of one more classification pass** over all 36 newly surfaced names: ~1 batch of 50 at the observed rate (~$0.0009/name) ≈ **$0.03**. **Not run** — reported only, per scope.

---

## Current state

| Measure | Value |
|---|---|
| Distinct names | 2,127 |
| Names labelled `client` | 1,962 |
| Distinct canonical companies | 1,855 |
| Files under client names | 70,725 |
| Names unjudged | 36 (750 files) |
| Files unattributed | 986 |

### Retention (client names, `client_modified`, 2020-08-11 cutoff)

`server_modified` is not used — 40,390 files share 2024-07-23 from a bulk Dropbox event.

| Group | Names | Files |
|---|---|---|
| **Live** (a file within 6 years) | 1,133 | 56,954 |
| **Archive-only** | 802 | 13,771 |
| No dated files | 27 | 0 |

⚠️ Canonical-company and retention counts above cover only the names already judged. The unjudged names are excluded, so these are a floor, not a final figure.

---

## Reproducing

```bash
node <scratchpad>/resolve-final.mjs
```

Reads two CSVs, writes two files, makes no network call. Skip list: `MODEL_BATCH_NAMES` in `scripts/grants-lib.mjs` (89 names; the last 6 also exported as `PASS2_BATCH_NAMES`).
