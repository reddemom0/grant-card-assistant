# Departments Copy — Results

**Command:** `scripts/pilot-copy.mjs --mapping dist/inventory/departments-mapping.csv`
**Destination:** Shared Drive `0AKxoOSs3WbQ0Uk9PVA`
**Completed:** 2026-08-20 · **Reconciled:** 2026-08-26

A verbatim mirror of the non-Grants Dropbox department folders into `Departments/`. No
reorganization, no client/program/year routing — folder names preserved as they are, including
odd casing and asterisk prefixes.

Dropbox is read-only throughout. Nothing was deleted anywhere.

---

## The run

| | |
|---|---|
| Rows attempted | 6,215 (+20 approved sample) |
| **Verified** | **6,232** |
| Failed | **3** |
| Bytes | **24.17 GB** |
| Runtime | **2h 24m** |
| Throughput | 0.72 files/sec, 2.97 MB/sec |
| Retries | 5, all recovered on attempt 1 |
| 410 session restarts | 0 |

**Size mismatches: 0. Google-type conversions: 0.** 8 zero-byte files via the multipart path.

### The three failures

All three are `.web` pointer stubs — Dropbox links rather than documents, which the API refuses
to serve (`HTTP 409 unsupported_file`). There are no bytes to copy.

```
Departments/SALES/Grant Processes/Strategy Process Sheets.web
Departments/SALES/Onboarding Documents/Blank-Account Manager Training & Onboarding.web
Departments/SALES/Onboarding Documents/Learning Checklist.web
```

Same class as the seven encountered in the Grants stages. Not copier defects.

---

## Reconciliation — live Dropbox, Drive listed independently

The ledger is **not** consulted. Drive is enumerated with one flat paginated `files.list` and
paths rebuilt locally from parent IDs; sizes are compared against **live Dropbox metadata**
obtained by walking the team folder with `files/list_folder`.

### Per department

| Department | Expected | Present exact | Case-only | Absent | Size agrees | Changed since copy | Source gone |
|---|---|---|---|---|---|---|---|
| MARKETING | 2,624 | 2,624 | 0 | 0 | 2,624 | 0 | 0 |
| OPERATIONS | 2,279 | 2,279 | 0 | 0 | 2,279 | 0 | 0 |
| SALES | 759 | 756 | 0 | 3 | 756 | 0 | 0 |
| LEADERSHIP | 285 | 285 | 0 | 0 | 285 | 0 | 0 |
| RESEARCH | 254 | 254 | 0 | 0 | 254 | 0 | 0 |
| WRITERS | 28 | 28 | 0 | 0 | 28 | 0 | 0 |
| AI | 4 | 4 | 0 | 0 | 4 | 0 | 0 |
| Mindfulness | 2 | 2 | 0 | 0 | 2 | 0 | 0 |
| **Total** | **6,235** | **6,232** | **0** | **3** | **6,232** | **0** | **0** |

**Seven of eight departments reconcile perfectly.** SALES is short exactly the three `.web` stubs.
Zero case-only variance, zero size disagreements, zero sources vanished, zero conversions.

### Whole drive

| | |
|---|---|
| Files in the Shared Drive | **82,495** |
| Folders | 29,138 |
| Bytes | 88.04 GB |
| Shortcuts | 43 |
| Live Dropbox files under the team folder | 82,372 |
| Mapping expects (all three sheets) | 82,485 |
| **Present at the exact mapped path** | **82,473** |
| Case-only variance | **0** |
| Absent | **12** |
| Size agrees with live Dropbox | **82,463** |
| Changed since copy | **0** |
| Source gone from Dropbox | 10 |
| Google-type conversions | **0** |
| Extra files in Drive | 22 |

| Top-level folder | Files | Bytes |
|---|---|---|
| Clients | 58,446 | 42.97 GB |
| Departments | 6,254 | 24.18 GB |
| Old Files | 13,308 | 11.27 GB |
| Programs | 4,487 | 9.62 GB |

### The 12 absent files

Nine were already known from the Grants stages; three are the new SALES stubs.

| File | Why |
|---|---|
| 3 × `Departments/SALES/…/*.web` | Dropbox pointer stubs, no content |
| 6 × `Programs/CanExport/…/*.web`, `*.gdoc` | Same |
| `Programs/Grant Planner Template/…web` | Same |
| `Clients/Nightingale Electrical/…/Paystubs Yu Hugo Ng.pdf` | Deleted from Dropbox after the inventory |
| `Clients/MiHR/…/EN Direct Deposit Authorization (1).pdf` | Deleted from Dropbox after the inventory |

**Ten are undownloadable link stubs containing no document content. Two were deleted at source.**
No file with retrievable content is missing.

### The 10 `source gone` rows are the migration working

These files **are in Drive** but their Dropbox originals no longer exist — the team moved or
deleted them after the copy. They are 2026-fiscal active client work:

- 5 × `WILWorks SWPP/2026/SCG/Luke/Submission/…` — employer acceptance, employment contract,
  proof of enrolment, student information and consent forms
- 4 × `ETG/ETG-BC Applications 2026 : 2027 Intake/Sutherland/…`
- 1 × `WorkBC Wage Subsidy/Client Files - 2025:2026 Fiscal/Taymor/…`

**Drive is now the only copy of these ten documents.** That is the migration doing exactly what
it was for, and a concrete argument against treating Drive as a secondary copy.

### The 22 extras are new work, not migration artifacts

All 22 sit under `Departments/AI/` and are dated 2026-08-22 and 2026-08-26 — *after* the copy:
`Matching sweep — raw artifacts/stage-stress-*.json`, `axis-sweep-*.json`, and a
`Matching fix queue/` note. These are files created directly in Drive since the migration.

**The Shared Drive is in active use.** Reconciliation will keep reporting new work as "extra"
because it is not in any mapping sheet; that is correct behaviour, not drift.

---

## Corpus totals across all stages

| Stage | Files | Bytes |
|---|---|---|
| CanExport pilot | 1,468 | 20.37 GB |
| ETG | 29,535 | 16.38 GB |
| Grants final stage | 45,238 | 27.11 GB |
| Departments | 6,232 | 24.17 GB |
| **Total in Drive** | **82,495** | **88.04 GB** |

(The Drive total exceeds the sum of the stages by 22 — the new `Departments/AI/` work above.)

**82,473 of 82,485 mapped files are in the Shared Drive, byte-identical to
what Dropbox serves today.**

---

## What remains in Dropbox

### The five out-of-scope top-level folders

| Folder | Status | Files |
|---|---|---|
| HR | Excluded by instruction; inventoried | 38 |
| FINANCE | **Never inventoried** — `path/not_found` | unknown |
| ADMIN | **Never inventoried** — `path/not_found` | unknown |
| GETGRANTED | **Never inventoried** — `path/not_found` | unknown |
| GRANTED STARTER | **Never inventoried** — `path/not_found` | unknown |

**Four of these five have never been seen.** The service account cannot read them, so they
returned `path/not_found` during the inventory and were never counted as accessible. Their
contents, size and file count are all unknown. They are not empty — they are invisible.

Anyone reading "24.18 GB migrated" should understand it excludes four entire departments of
unknown size.

### OPERATIONS' unknown remainder

All 2,279 OPERATIONS files sit under one subfolder, `Contracts`, and the folder is flagged
`traverse_only` and `read_only`. **The service account can descend through it but cannot fully
enumerate it.**

**2,279 is a floor, not a total.** OPERATIONS may hold material outside `Contracts` that never
appeared in any listing, and `Contracts` itself may hold more than was enumerated. Every one of
those 2,279 copied and reconciled perfectly — but that says nothing about what was never listed.

To close this: grant the service account full read access to OPERATIONS and re-inventory. Until
then an unknown remainder stays in Dropbox.

### Also staying behind

- **10 `.web` / `.gdoc` pointer stubs** — links with no content. Nothing to migrate.
- **Trashed files** — excluded by `trashed = false` throughout, recoverable in Dropbox for 30 days.

---

## Script defects found during this stage

Three bugs, all the same root cause: the departments sheet has a different shape from the Grants
sheet, and code generalized from the Grants sheet kept assuming its shape.

1. **`pilot-copy.mjs` read the mapping by column index.** `r[5]` is `destination_path` in the
   Grants sheet but `size` in the departments sheet; `r[7]` is `route` versus `extension`. Now
   reads by header name with required columns asserted.
2. **`COPY_ROUTES` lacked `mirror`** — in *both* `pilot-copy.mjs` and `reconcile-drive.mjs`. Left
   unfixed, each would have filtered out all 6,235 rows and reported a clean run of nothing —
   worse than an error, because it looks like success.
3. **`reconcile-drive.mjs` required a `program` column** the departments sheet does not have, and
   **hardcoded its Dropbox root to the Grants subtree**, so it would have found none of the
   department sources. The root is now derived from the sheets' common ancestor.

The two `COPY_ROUTES` definitions now carry comments pointing at each other.

---

## Verification

- **Zero Dropbox writes, zero deletions anywhere.** The copier calls only `oauth2/token` and
  `files/download`; reconciliation adds `files/list_folder`. No mutating endpoint is imported or
  called, and no Drive DELETE or trash operation is performed.
- **Reconciliation listed Drive directly**, not the ledger.
- **The ledger is append-only** — all 76,461 pre-existing rows verified byte-identical and in
  order after the run; 6,235 appended.
- **Contract CSVs unmodified** — `full-mapping.csv` and `departments-mapping.csv` both verified
  by checksum after the copy.
- **`dist/` is gitignored** and absent from `git status -uall`.
