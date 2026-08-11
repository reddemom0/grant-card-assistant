# Grants Inventory — Summary

**Generated:** 2026-07-30T19:41:04.675Z
**Source:** `/Granted Team Folder/SALES/Grants` (Dropbox team namespace)
**Runtime:** 22m 13s
**Method:** metadata only — `files/list_folder` (recursive), `files/get_metadata`, `sharing/get_folder_metadata`. No file content fetched.

## Totals

| Metric | Value |
|---|---|
| Total entries | 100,050 |
| Files | 75,971 |
| Folders | 24,079 |
| Total bytes | 68,523,993,451 (63.82 GB) |
| Immediate child folders of grants | 309 |
| Distinct third-level segments | 1,254 |
| Oldest `server_modified` | 2017-06-23T23:57:29Z |
| Newest `server_modified` | 2026-07-30T18:40:02Z |
| Files with no extension | 154 |

## Completeness verdict — FULLY VISIBLE

| Check | Count |
|---|---|
| Immediate children checked | 309 |
| `no_access` | 0 |
| `traverse_only` | 0 |
| Clean | 309 |
| Metadata errors | 0 |
| Folders flagged anywhere in the walk | 0 |

**The Grants tree is FULLY VISIBLE to this token.** No folder in the tree carries `no_access` or `traverse_only`, and every one of the 309 immediate child folders resolved cleanly. The counts above are complete, not a lower bound.

## Files by extension

| Extension | Files |
|---|---|
| `.pdf` | 53,181 |
| `.docx` | 10,744 |
| `.xlsx` | 3,608 |
| `.png` | 2,352 |
| `.xls` | 1,950 |
| `.jpg` | 1,227 |
| `.eml` | 349 |
| `.doc` | 305 |
| `.xlsm` | 276 |
| `.zip` | 229 |
| `.jpeg` | 216 |
| `.mp4` | 207 |
| `.js` | 205 |
| `.m4a` | 126 |
| `.rtf` | 118 |
| `.html` | 62 |
| `.numbers` | 54 |
| `.webloc` | 50 |
| `.pptx` | 48 |
| `.csv` | 46 |
| `.css` | 45 |
| `.conf` | 39 |
| `.aspx` | 30 |
| `.heic` | 28 |
| `.dotx` | 26 |
| `.txt` | 25 |
| `.webarchive` | 25 |
| `.tiff` | 24 |
| `.textclipping` | 19 |
| `.gif` | 18 |
| `.svg` | 16 |
| `.plist` | 16 |
| `.otf` | 16 |
| `.docm` | 15 |
| `.m3u` | 14 |
| `.mp3` | 12 |
| `.eps` | 12 |
| `.mov` | 10 |
| `.tif` | 9 |
| `.axd` | 9 |
| `.ai` | 8 |
| `.pages` | 7 |
| `.web` | 6 |
| `.gdoc` | 5 |
| `.htm` | 4 |
| `.msg` | 4 |
| `.odt` | 4 |
| `.url` | 2 |
| `.xml` | 2 |
| `.webp` | 1 |
| `.sb-cfa4211c-jnd1cq` | 1 |
| `.sb-87f0d457-msqubf` | 1 |
| `.sb-4d714116-copz58` | 1 |
| `.inetloc` | 1 |
| `.wmv` | 1 |
| `.xltx` | 1 |
| `.vtt` | 1 |
| `.thmx` | 1 |
| `.sb-9aceb089-fjdnrr` | 1 |
| `.sb-7427c181-jqp492` | 1 |
| `.sb-8e379955-bjlrgk` | 1 |
| `. nilex - cjg 2016 - reimbursement package` | 1 |
| `. nilex - cajg14-005813 - reimbursement package` | 1 |
| _(none)_ | 154 |

## Path shape (files only)

Depth is relative to `grants/`.

| Depth | Shape | Files |
|---|---|---|
| 1 | file directly in grants/ | 7 |
| 2 | program/file | 480 |
| 3 | program/client/file | 2,759 |
| 4 | depth 4 (deeper than program/client/file) | 10,345 |
| 5 | depth 5 (deeper than program/client/file) | 21,998 |
| 6 | depth 6 (deeper than program/client/file) | 19,733 |
| 7 | depth 7 (deeper than program/client/file) | 16,344 |
| 8 | depth 8 (deeper than program/client/file) | 2,906 |
| 9 | depth 9 (deeper than program/client/file) | 707 |
| 10 | depth 10 (deeper than program/client/file) | 588 |
| 11 | depth 11 (deeper than program/client/file) | 35 |
| 12 | depth 12 (deeper than program/client/file) | 69 |

## Sibling top-level folders (one level, no recursion)

`grants` is not itself top-level — it sits under `SALES`. All 13 top-level folders of the team folder are listed here.

| Folder | Access | Immediate children |
|---|---|---|
| Mindfulness | ACCESSIBLE | 2 (0 folders, 2 files) |
| LEADERSHIP | ACCESSIBLE | 6 (5 folders, 1 files) |
| FINANCE | **DENIED** (no_access) | path/not_found/ |
| GETGRANTED | **DENIED** (no_access) | path/not_found/ |
| GRANTED STARTER | **DENIED** (no_access) | path/not_found/ |
| ADMIN | **DENIED** (no_access) | path/not_found/ |
| OPERATIONS | ACCESSIBLE (traverse_only — may be partial) | 1 (1 folders, 0 files) |
| AI | ACCESSIBLE | 4 (1 folders, 3 files) |
| RESEARCH | ACCESSIBLE | 17 (8 folders, 9 files) |
| HR | ACCESSIBLE (traverse_only — may be partial) | 5 (5 folders, 0 files) |
| MARKETING | ACCESSIBLE | 21 (19 folders, 2 files) |
| SALES | ACCESSIBLE | 36 (23 folders, 13 files) |
| WRITERS | ACCESSIBLE | 5 (5 folders, 0 files) |

## Outputs

| File | Size | In git? |
|---|---|---|
| `dist/inventory/grants-inventory.csv` | 24.39 MB | no — gitignored, regenerable |
| `dist/inventory/raw-client-names.csv` | 35.3 KB | no — gitignored, regenerable |
| `docs/inventory/inventory-summary.md` | this file | yes |

`raw-client-names.csv` columns: `raw_segment` (verbatim, un-normalized), `occurrences` (how many distinct program folders contain that segment name), `entries_beneath` (total inventory rows at or under it).

## Reproducing

```bash
node scripts/dropbox-inventory.js
```

Read-only and resumable. Delete `/private/tmp/claude-502/-Users-Chris-grant-card-assistant/7d749464-333a-42ff-899f-752bf4b95d32/scratchpad/dbx-inv/grants-walk.checkpoint.json` to force a fresh walk.
