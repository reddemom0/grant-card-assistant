# CanExport Pilot — Phase 1

**Generated:** 2026-08-13T20:45:25.667Z
**Inputs:** `dist/inventory/grants-inventory.csv`, `dist/inventory/clients-final.csv`, `dist/inventory/resolved-final.csv`
**Output:** `dist/inventory/canexport-mapping.csv` (gitignored — regenerable)
**Nothing was copied, renamed, or moved.** This is a proposal for review.

## Step 1-2 — Drive write path (established)

| | |
|---|---|
| Working path | `claude_ai_Google_Drive` MCP connector |
| Account | **writers@granted.ca** |
| Pilot folder | `MIGRATION PILOT` — `1lUlMi23k5_Xs4tuNUaCISKbAZ_1Ifdav` (My Drive root) |
| Nested folders | works |
| Type conversion | can be disabled — files stay PDF/DOCX rather than converting to Google formats |

The local OAuth credential in `mcp-servers/gdrive/` is **dead**: the refresh token returns `invalid_grant`, and its scope was `drive.readonly` regardless, so it could never have written. Re-consent with a write scope would be needed to use it.

`MIGRATION PILOT` stays in My Drive as scratch space; the Shared Drive decision is open.

---

## Step 3 — CanExport program folders (2)

Matched case-insensitively on the program folder name with punctuation and spacing ignored, so variants and year suffixes are caught.

| Program folder | Files | Size |
|---|---|---|
| `CanExport` | 1,332 | 19.95 GB |
| `CanExport Innovation (CXI)` | 166 | 0.43 GB |
| **Total** | **1,498** | **20.37 GB** |

That is 2.0% of the 75,971-file corpus — a reasonable pilot slice.

---

## Mapping rows

**1,519 rows** for 1,498 files. The count exceeds the file count because 21 files under joint-client folders are **dual-filed** — one row per client, as agreed.

Columns: `source_path`, `client`, `program`, `year`, `destination_path`, `proposed_filename`, `route`, `confidence`, `reason`.

**Year comes from the first sub-path segment when it carries one, else `client_modified`** (see Part A). `server_modified` is not used anywhere: 40,390 files across the corpus share the single date 2024-07-23 from a bulk Dropbox event, which would put most of the pilot in the wrong year folder.

Years present: 2016–2026 (11 distinct).

### Destination rule

```
Client / Program / Year / <remaining Dropbox path below the client folder> / filename
```

Everything **above** the client folder in Dropbox is discarded — that is the reorganization. Everything **below** it carries over unchanged, so deliberate structure someone created inside a client's work survives the move.

Where the client's own sub-path begins with a folder whose name is **exactly** the derived year, that segment is dropped so the year does not appear twice: `Client/CanExport/2023/2023/Interview - Budget/` becomes `Client/CanExport/2023/Interview - Budget/`. Exact string match only — `2023-24`, `2023 Application` and similar are left in place. **318** files had a segment collapsed this way.

Destination depth: **max 11**, average 6.1 segments.

The ten deepest destinations:

```
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Dec/Amazon.com 12.07.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Nov/Amazon.ca 11.13.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Nov/Amazon.ca 11.27.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Nov/Amazon.com 11.09.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Nov/Amazon.com 11.23.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Oct/Amazon.ca 10.30.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Oct/Amazon.com 10.26.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Oct/Amazon.ca 10.16.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Oct/Amazon.com 10.12.2020.pdf
(11) Clients/Fatso Peanut Butter/CanExport/2020/2020 project/Claim #1/Invoices to submit/Contractor Fees (Category C - D - E)/Amazon/Sept/Amazon.ca 09.18.2020.pdf
```

### Folder-name sanitization

Colons in **folder** segments become ` - `. Filenames are never touched by this — only directory segments. 8 distinct folder names changed:

| Old folder name | New folder name |
|---|---|
| `2022:23 application` | `2022 - 23 application` |
| `2023:24 application` | `2023 - 24 application` |
| `Claim:Reporting Docs` | `Claim - Reporting Docs` |
| `Consultant Fees (Category F:G)` | `Consultant Fees (Category F - G)` |
| `Contractor Fees (Category C:D:E)` | `Contractor Fees (Category C - D - E)` |
| `Interview : Budget` | `Interview - Budget` |
| `New:Mode` | `New - Mode` |
| `Reporting:Claim Docs` | `Reporting - Claim Docs` |

⚠️ Sanitization is applied to **every** route, including `archive`. "Mirrors the Dropbox path exactly" now means structurally identical — same folders, same nesting — with colons sanitized. Leaving raw colons in the archive tree would have made it the only part of the destination with a different naming convention.

### Proposed filenames

`proposed_filename` is a cleaned name and is **not applied** — it is phase-3 input only. 60 of 1,519 rows (3.9%) would change if applied. Cleanup rules, deliberately conservative:

| Rule | Rationale |
|---|---|
| `:` → ` - ` | A colon in a macOS-sourced name is a typed `/`; both are awkward in a path |
| `\ \| < > " ? *` → `-` | Awkward across filesystems |
| Strip leading `*`, `_`, `-` | Sort-order decoration, not part of the name |
| Collapse whitespace runs; trim trailing dots/spaces | Silent breakage source |
| Lowercase the extension | `.PDF` → `.pdf` |

Nothing else is touched — no case normalization, no word reordering, no truncation.

---

# Part A — Year audit (report only)

Nothing in this section changes the mapping. The year rule is unchanged; these are the numbers behind the decision.

## A1 — Clients spread across multiple year folders

**54 of 90 clients** in the `sort` route have files landing in more than one year folder (60.0%).

That is expected to a degree — a client who applied in 2019 and again in 2023 genuinely has two years of work. It becomes a problem when a *single* body of work is scattered because individual files were touched at different times.

The 15 widest spreads:

| Client | Years | Spread | Files per year |
|---|---|---|---|
| WiderFunnel | 4 | 2017–2020 | 2017:39, 2018:8, 2019:21, 2020:1 |
| Hatchways | 4 | 2020–2023 | 2020:5, 2021:31, 2022:7, 2023:1 |
| Spare Labs | 3 | 2020–2022 | 2020:38, 2021:10, 2022:8 |
| Fatso Peanut Butter | 3 | 2019–2022 | 2019:6, 2020:35, 2022:5 |
| Clearmind International Institute | 3 | 2021–2023 | 2021:18, 2022:14, 2023:2 |
| ProCogia | 3 | 2021–2023 | 2021:19, 2022:7, 2023:4 |
| RTOWN | 3 | 2020–2022 | 2020:5, 2021:18, 2022:4 |
| Paintillio | 3 | 2021–2023 | 2021:15, 2022:9, 2023:3 |
| Modern Purair | 3 | 2021–2024 | 2021:7, 2022:16, 2024:1 |
| Hippie Snacks | 3 | 2020–2022 | 2020:9, 2021:3, 2022:8 |
| Eligeo | 3 | 2021–2023 | 2021:10, 2022:4, 2023:4 |
| Latero Labs | 3 | 2021–2023 | 2021:11, 2022:6, 2023:1 |
| Streetscape | 3 | 2020–2022 | 2020:9, 2021:7, 2022:1 |
| New:Mode | 3 | 2020–2022 | 2020:2, 2021:1, 2022:10 |
| Left Coast Naturals | 3 | 2021–2023 | 2021:3, 2022:1, 2023:1 |

## A2 — Folder year vs `client_modified` year

For every file whose Dropbox sub-path contains a year-like segment, that segment is compared against the year derived from `client_modified`. The comparison uses the **original** sub-path, before the duplicate-year collapse.

| Outcome | Files | Share of comparable |
|---|---|---|
| Agree | 399 | 70.4% |
| **Differ** | **168** | **29.6%** |
| No comparable year (no folder year, or no `client_modified`) | 931 | — |

Ten disagreements:

| Folder segment | Folder year | Derived year | Source |
|---|---|---|---|
| `2022 Application` | 2022 | **2023** | `CanExport/Clients/Clearmind/2022 Application/Claims/Claim #3/Clearmind Claim #3.xlsx` |
| `Trip 1 - Nov 2018` | 2018 | **2019** | `CanExport Innovation (CXI)/TF Massif/Reporting/Trip 1 - Nov 2018/Signed Docs (from submission email)/GGI Report Form - TF Massif Technologies Ltd. - GGI-1819-084_interim report.pdf` |
| `Trip 1 - Nov 2018` | 2018 | **2019** | `CanExport Innovation (CXI)/TF Massif/Reporting/Trip 1 - Nov 2018/Signed Docs (from submission email)/Claim Form - TF Massif Technologies LTD. - GGI-1819-084.xlsm` |
| `Trip 1 - Nov 2018` | 2018 | **2019** | `CanExport Innovation (CXI)/TF Massif/Reporting/Trip 1 - Nov 2018/Signed Docs (from submission email)/Claim Form - TF Massif Technologies LTD. - GGI-1819-084.pdf` |
| `Trip 1 - Nov 2018` | 2018 | **2019** | `CanExport Innovation (CXI)/TF Massif/Reporting/Trip 1 - Nov 2018/GGI Report Form - TF Massif Technologies Ltd. - GGI-1819-084.docx` |
| `Trip 1 - Nov 2018` | 2018 | **2019** | `CanExport Innovation (CXI)/TF Massif/Reporting/Trip 1 - Nov 2018/Claim Form - TF Massif Technologies LTD. - GGI-1819-084.xlsx` |
| `Trip 1 - Nov 2018` | 2018 | **2019** | `CanExport Innovation (CXI)/TF Massif/Reporting/Trip 1 - Nov 2018/Claim Form - TF Massif Technologies LTD. - GGI-1819-084.xlsm` |
| `Wider Funnel 2019 CXI Application - Final` | 2019 | **2021** | `CanExport Innovation (CXI)/Widerfunnel 2018:2019/Wider Funnel 2019 CXI Application - Final/CanExport Innovation 2020-2021 Final Report - WiderFunnel.docx` |
| `2023` | 2023 | **2022** | `CanExport/Clients/Eligeo/2023/chat.txt` |
| `2023` | 2023 | **2022** | `CanExport/Clients/Eligeo/2023/recording.conf` |

## A3 — Which year source is better?

**Where both exist, the folder segment is the better source.** 168 of 567 comparable files (29.6%) disagree, and in the disagreements the folder is right more often than the timestamp for a structural reason:

- **A folder year records intent.** Someone named a folder `2019 Application` because the work belongs to the 2019 intake. That is a deliberate statement about the grant cycle.
- **`client_modified` records a file event.** It moves whenever a file is edited, re-saved, re-exported, or re-uploaded. A 2019 application PDF re-saved in 2023 carries a 2023 timestamp while still being 2019 work.
- **The drift is one-directional.** In the sample above the derived year is consistently *later* than the folder year, which is the signature of files being touched after the fact rather than of folders being mislabelled.
- **It explains the spread in A1.** 54 clients are split across year folders; timestamp drift is the most likely cause for the ones whose work is really a single cycle.

The counter-argument is coverage: a folder year only exists for some files (931 here have no comparable folder year), so `client_modified` is still needed as the fallback.

## A4 — Rule adopted

**Year now comes from the first segment of the client's sub-path when that segment carries a year; `client_modified` otherwise.**

The guard matters: **only the first segment counts.** A year-like segment deeper in the path does not override. `Reporting/Trip 1 - Nov 2018/…` keeps its `client_modified` year, because `Trip 1 - Nov 2018` describes something that happened *inside* a cycle rather than naming the cycle. Only `2022 Application/…` — a first segment — sets the year.

| Effect | Files |
|---|---|
| Year **changed** (folder overrode `client_modified`) | **161** |
| Folder agreed with `client_modified` — no change | 348 |
| Year **recovered** where `client_modified` was absent | 0 |
| Still on `client_modified` (first segment carries no year) | 1,010 |

161 files move to a different year folder than the previous run placed them in. That is fewer than the 168 disagreements counted in A2, because A2 looked for a year *anywhere* in the sub-path while the adopted rule only honours the first segment.

Every row in the CSV carries a `year_source` column (`folder`, `client_modified`, or `none`) so the provenance of each year is auditable without re-deriving it.

---

# Part B — Routing

## Routing

| Route | Rule | Rows | Distinct files | Bytes |
|---|---|---|---|---|
| **sort** | Attributed to a live client | 1,259 | 1,259 | 16.87 GB |
| **program** | Top folder labelled `internal` or `doctype` — belongs to the program, not a client | 128 | 128 | 3.24 GB |
| **archive** | Client archive-only past the 6-year line | 87 | 87 | 0.25 GB |
| **review** | No client, unjudged name, or joint-client folder | 45 | 24 | 0.01 GB |

Destination shapes:

| Route | Shape |
|---|---|
| `sort` | `Client/Program/Year/<sub-path below the client folder>/filename` |
| `program` | `Programs/<Program>/<sub-path below the program>/filename` |
| `archive` | `Archive/<full Dropbox path>` — structure mirrored exactly, colons sanitized |
| `review` | `Review/<full Dropbox path>`; dual-filed rows are `Review/Client/Program/Year/<sub-path>/filename` |

90 distinct clients appear in the `sort` route.

### What remains in review

| Reason | Files |
|---|---|
| joint-client folder (dual-filed) | 21 |
| no attributed client | 3 |

### Programs tree

`program` is a new fourth route. A file lands there when the top folder under its grant program is labelled `internal` or `doctype` by the classification — the label decides it, not a hardcoded folder list, so this generalizes to other programs unchanged.

| Top folder under the program | Files |
|---|---|
| `CanExport Process Docs` | 46 |
| `Online Application` | 11 |
| `z_Old` | 10 |
| `Other resources` | 10 |
| `One-Offs` | 10 |
| `CanExport Govt Docs` | 8 |
| `Old Docs` | 7 |
| `Video Webinar` | 6 |
| `2018 Forms` | 4 |
| `11-2020 Forms` | 3 |
| `2019 Forms` | 3 |
| `2022 Forms` | 3 |
| `Training` | 3 |
| `Steph working - Spring 2019` | 2 |
| `Prospects` | 2 |

These keep their full structure below the program: `Programs/CanExport/CanExport Process Docs/…`. No year folder is inserted — program material is not client work and has no intake year.

### Dual-filed joint-client folders

Each file under these folders produces two rows, one per client. Both are routed `review` — dual-filing records the ambiguity, it does not resolve it. A `split` or `keep` decision in `colon-triage.md` collapses these.

| Joint folder | Filed under | Rows |
|---|---|---|
| `Taimuri:Capstone` | Taimuri + Capstone | 42 |

---

## Step 4 — Collision check

**Zero collisions.** No two source files map to the same destination path.

Preserving the sub-path is what makes that true, and the difference is measurable rather than theoretical. Re-running the collision check against the **previous flat** `Client/Program/Year/filename` rule on the same data gives **48 collisions covering 50 files** — those files would have silently overwritten each other on copy. Two examples: `Capstone Canada/2023` had `chat.txt` and `recording.conf` in both an `Interview - Budget` and an `RA` subfolder; WiderFunnel had the same application documents in a `June Submission` folder and a nested `June Submission/June Submission` folder.

---

## Step 5 — Routing split vs the prior run

| Route | Prior run | This run | Change |
|---|---|---|---|
| sort | 1,259 | 1,259 | none |
| program | 128 | 128 | none |
| archive | 87 | 87 | none |
| review | 45 | 45 | none |

**Unchanged.** Only the destination string was rewritten; the routing rules and the client list are identical.

---

## Sample rows

First five `sort` rows, verbatim from the CSV:

```
/Granted Team Folder/SALES/Grants/CanExport/Clients/Clearmind/2022 Application/Claims/Claim #3/Clearmind Claim #3.xlsx
  -> Clients/Clearmind International Institute/CanExport/2022/2022 Application/Claims/Claim #3/Clearmind Claim #3.xlsx
     client=Clearmind International Institute | year=2022 | high | client match high confidence
/Granted Team Folder/SALES/Grants/CanExport/Clients/Capstone Canada/2023/Interview : Budget/chat.txt
  -> Clients/Capstone Canada/CanExport/2023/Interview - Budget/chat.txt
     client=Capstone Canada | year=2023 | high | client match high confidence
/Granted Team Folder/SALES/Grants/CanExport/Clients/Capstone Canada/2023/Interview : Budget/recording.conf
  -> Clients/Capstone Canada/CanExport/2023/Interview - Budget/recording.conf
     client=Capstone Canada | year=2023 | high | client match high confidence
/Granted Team Folder/SALES/Grants/CanExport/Clients/Capstone Canada/2023/Interview : Budget/audio1768696769.m4a
  -> Clients/Capstone Canada/CanExport/2023/Interview - Budget/audio1768696769.m4a
     client=Capstone Canada | year=2023 | high | client match high confidence
/Granted Team Folder/SALES/Grants/CanExport/Clients/Capstone Canada/2023/Interview : Budget/video1768696769.mp4
  -> Clients/Capstone Canada/CanExport/2023/Interview - Budget/video1768696769.mp4
     client=Capstone Canada | year=2023 | high | client match high confidence
```

First three `archive` rows — note the destination mirrors the source exactly:

```
/Granted Team Folder/SALES/Grants/CanExport Innovation (CXI)/TF Massif/2019 Application/GGI 2019 Application Form TF Massif.docx
  -> Archive/CanExport Innovation (CXI)/TF Massif/2019 Application/GGI 2019 Application Form TF Massif.docx
/Granted Team Folder/SALES/Grants/CanExport Innovation (CXI)/TF Massif/2019 Application/TF Massif Notes.docx
  -> Archive/CanExport Innovation (CXI)/TF Massif/2019 Application/TF Massif Notes.docx
/Granted Team Folder/SALES/Grants/CanExport Innovation (CXI)/TF Massif/2019 Application/Approved Budget Form - TF Massif Inc. - CXI-19-20-077P.xlsx
  -> Archive/CanExport Innovation (CXI)/TF Massif/2019 Application/Approved Budget Form - TF Massif Inc. - CXI-19-20-077P.xlsx
```

---

## What phase 1 does not settle

- **Nothing has been copied.** This sheet is the input to that decision.
- **Proposed filenames are not applied.** Phase 3 input only.
- **Joint-client folders are unresolved** — dual-filed and parked in review pending `colon-triage.md`.
- **The Shared Drive question is open.** The pilot folder is in a personal My Drive; team-owned storage is a separate decision.
- **Transport for the real copy is unsettled.** The MCP connector works file-by-file; a corpus copy wants a service account or a re-consented OAuth credential driving the REST API directly.

## Reproducing

```bash
node scripts/canexport-mapping.mjs
```

Reads three CSVs, writes two files, makes no network call.
