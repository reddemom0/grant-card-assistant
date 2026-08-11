# Candidate Client Names — Extraction

**Generated:** 2026-08-11T18:53:37.233Z
**Input:** `dist/inventory/grants-inventory.csv` (unmodified — opened read-only)
**Full list:** `dist/inventory/candidate-clients.csv` (gitignored — regenerable)
**Method:** local string analysis. No network, no API, no LLM. Batch detection and segment classification are reused verbatim from the logic behind `docs/inventory/path-profile.md`.

## Purpose

Size the AI classification pass. This document says how many distinct names it would have to judge, which ones can be ruled out mechanically first, and how many are archive-only and might not need judging at all.

## Headline

| | |
|---|---|
| Distinct names at candidate-client depth (raw) | **1,035** |
| After case/punctuation dedupe | **996** |
| Confidently excluded (keyword / bare year) | **12** |
| **Left for the AI pass to judge** | **984** |
| — of those, archive-only (no file newer than 6y) | 106 |
| — of those, live | 868 |

---

## Step 1 — Client depth per program folder

Depth is resolved per program by walking down from level 1 and **skipping consecutive `batch` levels**, then requiring the next level to be `client`.

A fixed depth of 2 for the `program/batch/client` shape would have been wrong: `path-profile.md` showed nested batches — `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2017/Herschel/` is `batch/batch/client`, so depth 2 returns an inner batch folder, not a client.

**160 of 309 program folders resolve to a confident client depth** (73,235 files, 96.4% of all files).

| Resolved client depth | Programs |
|---|---|
| 1 (`program/client`) | 145 |
| 2 (`program/batch/client`) | 15 |

**149 do not resolve** (2,736 files, 3.6%), broken down by what sits at the first non-batch level:

| Level label found | Programs | Meaning |
|---|---|---|
| `none` | 138 | program folder has no subfolders — files sit directly inside |
| `doctype` | 6 | first level is document types, not names |
| `mixed` | 3 | no majority label at that level |
| `date` | 1 | first level is dates |
| `unclear` | 1 | generic or unparseable folder names |

⚠️ The `none` group is large in program count but tiny in file count — these are small program folders holding a handful of loose files. They carry no client folder at all, so no name can be extracted for them by any path rule.

---

## Steps 2 & 3 — Extraction and dedupe

| Measure | Count |
|---|---|
| Folder instances at client depth (program + name pairs) | 1,959 |
| Distinct raw names (exact string) | 1,035 |
| Distinct after dedupe | 996 |
| Collapsed by dedupe | 39 (3.8%) |

Dedupe rule: trim surrounding whitespace, strip trailing `.,;:_-*` and whitespace, collapse internal runs of whitespace, compare case-insensitively. The display name kept for each group is the variant with the most files beneath it.

39 names had more than one spelling variant. The 15 with the most variants:

| Name | Variants | Programs | Files |
|---|---|---|---|
| Forms | 2 — `Forms`, `FORMS` | 6 | 25 |
| Fresh Prep | 2 — `Fresh Prep`, `Fresh prep` | 8 | 429 |
| AVID Architecture | 2 — `Avid Architecture`, `AVID Architecture` | 3 | 37 |
| Procogia | 2 — `ProCogia`, `Procogia` | 17 | 438 |
| Laidback snacks | 2 — `Laidback Snacks`, `Laidback snacks` | 2 | 35 |
| LNG Studios | 2 — `LNG Studios`, `LNG studios` | 2 | 35 |
| Refeed | 2 — `Refeed`, `ReFeed` | 2 | 3 |
| ClearDent | 2 — `ClearDent`, `Cleardent` | 11 | 281 |
| Mayne Inc. | 2 — `Mayne Inc`, `Mayne Inc.` | 4 | 174 |
| GameOn | 2 — `GameOn`, `GameON` | 3 | 74 |
| All Clean | 2 — `All Clean`, `All clean` | 4 | 13 |
| ShipTop Logistics | 2 — `Shiptop Logistics`, `ShipTop Logistics` | 5 | 20 |
| 2019 clients | 2 — `2019 clients`, `2019 Clients` | 3 | 152 |
| Modern Purair | 2 — `Modern Purair`, `Modern PURAIR` | 4 | 164 |
| Gunn Consultants | 2 — `Gunn Consultants`, `GUNN Consultants` | 10 | 183 |

---

## Step 4 — Per-name detail

Full table is in `dist/inventory/candidate-clients.csv` — one row per distinct name with: `name`, `normalized_key`, `variant_count`, `programs`, `files`, `bytes`, `server_first`, `server_last`, `client_first`, `client_last`, `retention`, `excluded`, `exclusion_reason`, `segment_label`.

Top 40 by file count:

Date columns show `server_modified` as specified in the brief, plus `client_modified` alongside — see the warning below for why the server dates cannot be read as recency.

| Name | Programs | Files | server first→last | client first→last | Retention | Excluded |
|---|---|---|---|---|---|---|
| `CJG-BC Applications 2020 and prior` | 1 | 14,532 | 2022-08-24 → 2022-08-24 | 2015-03-04 → 2021-01-22 | live | no |
| `Old Folders` | 1 | 4,937 | 2022-07-06 → 2023-01-17 | 2017-03-30 → 2022-06-29 | live | no |
| `ETG-BC Applications 2022` | 1 | 2,363 | 2022-02-01 → 2024-10-10 | 2019-10-22 → 2023-09-12 | live | no |
| `ETG-BC Applications 2023 : 2024 Intake` | 1 | 1,780 | 2023-02-01 → 2024-10-24 | 2020-05-25 → 2024-07-22 | live | no |
| `2016:2017 Clients` | 1 | 1,488 | 2024-07-23 → 2024-07-23 | 2008-03-04 → 2018-09-21 | archive_only | no |
| `ETG-BC Applications 2024 : 2025 Intake` | 1 | 1,269 | 2024-02-01 → 2026-07-17 | 2021-11-03 → 2026-01-15 | live | no |
| `DS4Y - Digital Tech Stream` | 1 | 1,158 | 2024-07-23 → 2024-07-23 | 2018-10-03 → 2022-05-18 | live | no |
| `CAJG` | 1 | 1,051 | 2022-01-04 → 2026-03-24 | 2015-03-20 → 2026-03-24 | live | no |
| `DS4Y 2020 clients` | 1 | 982 | 2024-07-23 → 2024-07-23 | 2020-07-14 → 2021-08-03 | live | no |
| `ETG-BC Applications 2025 : 2026 Intake` | 1 | 855 | 2024-10-30 → 2026-07-16 | 2021-11-25 → 2026-07-16 | live | no |
| `ETG TPs` | 1 | 824 | 2020-11-13 → 2024-03-06 | 2015-02-05 → 2024-03-06 | live | no |
| `Client Folder` | 1 | 771 | 2024-07-23 → 2024-07-23 | 2013-06-12 → 2020-06-25 | archive_only | no |
| `Keystone` | 18 | 675 | 2024-07-23 → 2026-07-30 | 2023-07-20 → 2026-07-30 | live | no |
| `Spare Labs` | 12 | 642 | 2024-07-23 → 2025-01-27 | 2020-07-20 → 2025-01-27 | live | no |
| `ETG-BC Applications 2021xx` | 1 | 596 | 2021-09-07 → 2023-01-17 | 2019-10-25 → 2022-10-17 | live | no |
| `Musora` | 8 | 565 | 2022-12-19 → 2024-08-14 | 2021-12-15 → 2024-08-14 | live | no |
| `Ledcor` | 2 | 482 | 2024-07-23 → 2024-07-23 | 2020-11-17 → 2023-05-05 | live | no |
| `Caliber` | 6 | 442 | 2024-07-23 → 2025-09-24 | 2021-02-26 → 2025-09-24 | live | no |
| `Procogia` | 17 | 438 | 2024-07-23 → 2024-10-10 | 2020-10-30 → 2024-10-03 | live | no |
| `SAAM Towage` | 7 | 435 | 2024-07-23 → 2026-06-16 | 2022-08-17 → 2026-06-16 | live | no |
| `Clir` | 13 | 432 | 2024-07-23 → 2024-07-23 | 2021-03-16 → 2023-07-13 | live | no |
| `Fresh Prep` | 8 | 429 | 2024-07-23 → 2024-07-23 | 2018-11-05 → 2023-02-16 | live | no |
| `Clients 2017:18` | 1 | 386 | 2024-07-23 → 2024-07-23 | 2017-07-27 → 2019-10-31 | archive_only | no |
| `Houston Landscapes` | 4 | 384 | 2024-07-23 → 2024-10-21 | 2021-12-21 → 2024-10-21 | live | no |
| `ETG-BC Applications 2026 : 2027 Intake` | 1 | 320 | 2026-03-24 → 2026-07-28 | 2025-04-08 → 2026-07-28 | live | no |
| `Pearl` | 10 | 317 | 2024-07-23 → 2025-06-02 | 2022-04-01 → 2025-06-02 | live | no |
| `ICMS` | 7 | 316 | 2024-07-23 → 2025-09-22 | 2022-03-24 → 2025-09-22 | live | no |
| `2022` | 4 | 304 | 2024-07-23 → 2024-07-23 | 2022-03-30 → 2023-04-27 | live | **yes** — bare year |
| `ClearDent` | 11 | 281 | 2024-07-23 → 2026-07-29 | 2021-08-16 → 2026-07-29 | live | no |
| `2021` | 1 | 279 | 2024-07-23 → 2024-07-23 | 2021-01-05 → 2022-07-18 | live | **yes** — bare year |
| `2023` | 1 | 272 | 2023-04-28 → 2024-07-23 | 2022-04-30 → 2024-04-08 | live | **yes** — bare year |
| `Clients - 2022` | 1 | 272 | 2024-07-23 → 2024-07-23 | 2022-02-01 → 2023-07-20 | live | no |
| `Business Licenses` | 1 | 270 | 2021-01-26 → 2025-07-24 | 2020-09-09 → 2025-07-24 | live | no |
| `Creator Co` | 13 | 270 | 2023-04-12 → 2025-01-10 | 2022-01-13 → 2025-01-10 | live | no |
| `Native Shoes` | 11 | 267 | 2023-02-22 → 2025-03-21 | 2020-12-11 → 2025-03-21 | live | no |
| `Clients` | 7 | 265 | 2023-05-25 → 2024-07-23 | 2017-11-07 → 2024-04-29 | live | no |
| `Ame Consulting` | 6 | 253 | 2024-07-23 → 2026-06-05 | 2022-04-22 → 2026-06-05 | live | no |
| `Clients 2016:17` | 1 | 253 | 2024-07-23 → 2024-07-23 | 2016-05-06 → 2017-04-03 | archive_only | no |
| `PSYIP 2017` | 1 | 252 | 2024-07-23 → 2024-07-23 | 2016-08-02 → 2018-03-27 | archive_only | no |
| `Solaris` | 11 | 252 | 2024-07-23 → 2025-02-21 | 2022-03-01 → 2025-02-21 | live | no |

### What actually landed at client depth

Running the segment classifier back over the extracted names shows how much non-client material the depth rule let through:

| Segment label | Names | Files |
|---|---|---|
| `client` | 925 | 43,685 |
| `doctype` | 33 | 1,147 |
| `unclear` | 18 | 1,079 |
| `batch` | 16 | 26,942 |
| `date` | 4 | 56 |

`batch`-labelled entries here are the depth rule's known failure mode: where batch folders nest more deeply than the per-program majority vote detects, level *d* lands on an inner batch folder rather than a client. Those names survive into the list because Step 6's exclusion vocabulary is deliberately narrow.

---

## Step 5 — Retention split (6-year line)

Cutoff: **2020-08-11**. A name is *archive-only* when its newest file predates that date.

### ⚠️ This split uses `client_modified`, not `server_modified`

**40,390 files — 53% of the entire corpus — share a single `server_modified` date: 2024-07-23.**

That is the same date carried by the `Granted Team Folder (view-only conflicts 2024-07-23)` folder found during the access probe. A bulk Dropbox event that day (restructure, conflict resolution, or mass re-sync) rewrote the server timestamp on over half the files, regardless of how old their content is.

`server_modified` therefore measures *when Dropbox last wrote the file*, not when anyone last worked on it. Using it for retention classifies **982 of 996 names as "live"** — a meaningless result.

`client_modified` preserves the originating file's own timestamp and survives moves. Across the corpus it spans 2008–2026 with a natural distribution, so it is the field used below. Both are kept in the CSV.

| Group | Distinct names | % of names | Files | % of resolved files |
|---|---|---|---|---|
| **Archive-only** (all files older than 6y) | 110 | 11.0% | 4,860 | 6.6% |
| **Live** (any file within 6y) | 876 | 88.0% | 68,049 | 92.9% |
| No dated files (folder rows only) | 10 | 1.0% | 0 | 0.0% |

For contrast, the same split computed on the corrupted field:

| Field used | Archive-only names | Live names |
|---|---|---|
| `client_modified` (used above) | 110 | 876 |
| `server_modified` (misleading) | 4 | 982 |

---

## Step 6 — Conservative exclusions

Only unambiguous non-clients are flagged. Anything debatable is deliberately left unresolved — judging it is the AI pass's job, not this one's.

Rules: whole-word match on `claim(s)`, `reimbursement(s)`, `paystub(s)` / `pay stub(s)`, `invoice(s)` / `invoicing`, `template(s)`; or the whole name is a bare year / year range.

| Outcome | Distinct names | Files |
|---|---|---|
| Confidently excluded | 12 (1.2%) | 915 |
| **Unresolved — for the AI pass** | 984 (98.8%) | 71,994 |

Exclusions by rule:

| Rule | Names |
|---|---|
| bare year | 8 |
| keyword | 4 |

---

## What this means for the AI pass

**984 distinct names** need judging. Two facts shape the cost:

1. **Only 868 of them are live** (106 are archive-only). If archive-only names can be deferred or handled in bulk, the pass shrinks by 11%.
2. **They are names, not documents.** Each judgement is a short string, so they batch densely — this is not a per-file classification problem. 984 names covers 71,994 files, roughly 73 files resolved per judgement.

Not covered by any name: the 2,736 files under the 149 unresolved program folders. Those need a different approach entirely — no path rule yields a client for them.

---

## Reproducing

Extraction script and shared library live in the session scratchpad, not the repo. They read the inventory CSV read-only and write only the two outputs named above.
