# ETG Copy — Stage 1

**Command:** `scripts/pilot-copy.mjs --mapping dist/inventory/full-mapping.csv --program "ETG (Employer Training Grant)"`
**Destination:** Shared Drive `0AKxoOSs3WbQ0Uk9PVA`

Dropbox is read-only throughout — the only two endpoints touched are `oauth2/token` and `files/download`. Nothing is deleted anywhere. The mapping sheet is never written.

---

## Run 1 — 2026-08-17, stopped early in error

| | |
|---|---|
| Rows attempted | 11,221 |
| Verified | 11,068 |
| Failed | 153 |
| Bytes | 7.11 GB |
| Runtime | 2h 43m |
| Size mismatches | 0 |
| Google-type conversions | 0 |
| Live shortcuts created | 10 |

### What actually went wrong

**A 112-second burst of HTTP 403s from Google, between 20:40:50 and 20:42:38.** Not storage.

```
20:39   ok=59   SA-quota=0   quota-exceeded=0
20:40   ok=60   SA-quota=8   quota-exceeded=5
20:41   ok=0    SA-quota=28  quota-exceeded=58     <- total outage, one minute
20:42   ok=22   SA-quota=0   quota-exceeded=52
20:43   ok=68   SA-quota=0   quota-exceeded=0      <- recovered on its own
20:44   ok=71   SA-quota=0   quota-exceeded=0
```

**561 files uploaded successfully after the first quota error**, and the last success was at 20:50:43 — eight minutes after the last failure, at a normal ~68 files/min. The run had fully recovered before it was stopped.

Two error wordings appeared, both HTTP 403:

| Message | Count |
|---|---|
| `The user's Drive storage quota has been exceeded.` | 115 |
| `Service Accounts do not have storage quota. Leverage shared drives…` | 36 |
| `Failed to parse Content-Range header.` (unrelated — zero-byte files) | 2 |

Google uses these interchangeably when throttling writes. The wording is misleading boilerplate; neither describes the state of this drive.

### The diagnosis that was wrong, and why

**This document previously concluded that Google storage was exhausted. That was incorrect.** The run was stopped on the strength of it. Every piece of evidence contradicts it:

| Check | Result |
|---|---|
| Workspace pool | 226 GB used of 30 TB |
| Shared Drive item count | 17,057 of the 400,000 limit — **4.3%** |
| `about.get` storageQuota | `{limit: "0", usage: "0", …}` — **normal for a service account**, which has no personal quota by design. `usage: 0` proves nothing leaked into My Drive. `limit: 0` means "not applicable", not "exhausted". |
| `supportsAllDrives` | present on **every** call in the upload path — `findFolder`, `createFolder`, upload initiate, `stat`, shortcut find/create |
| Target parent folders | 45 distinct parents across the 151 failures; every one sampled exists and reports `driveId: 0AKxoOSs3WbQ0Uk9PVA` — inside the Shared Drive |
| Correlation with parent ID | none — 45 different parents, all valid |
| Correlation with file size | none — 35 KB to 8.3 MB, overlapping ranges, 235 MB total |
| Correlation with path depth | none — failures max depth 8, successes max depth 10 |
| Correlation with **time** | **total** — every failure inside one 112-second window |

The conclusive proof that the parents were never the problem: 561 files landed successfully **in those same folders** minutes later.

### The real defect

`withRetry` treated every 403 as fatal:

```js
const retryable = status === 429 || (status >= 500 && status < 600) || transport;
```

Google returns 403 for write throttling and expects exponential-backoff retry. With retry in place, all 151 would have ridden out the 112-second window. Zero would have failed.

---

## Fixes applied before Run 2

**1. 403 is retryable when the body says throttling.** `httpError` now parses `error.errors[0].reason` off the response and keeps it. A 403 retries only when the reason is in `RETRYABLE_403`; permission refusals (`insufficientFilePermissions`, `appNotAuthorizedToFile`, `domainPolicy`, `forbidden`, …) are in `FATAL_403` and still fail immediately.

> ⚠️ `RETRYABLE_403` contains `userRateLimitExceeded`, `rateLimitExceeded` **and `storageQuotaExceeded`**. The third goes beyond Google's default advice, which treats it as permanent. It is included on direct evidence: the burst above reported exactly that reason while the pool was at 226 GB of 30 TB. Without it, the fix would not have caught the incident it was written for. A genuinely full drive still fails — just after the retries are exhausted rather than on the first attempt. **Remove this entry if the pool is ever actually at capacity.**

**2. Every ledger row records the target parent folder ID.** `parent_folder_id` on both verified and failed rows, plus `error_reason` and `http_status` on failures. The 2026-08-17 incident could not be diagnosed from the ledger because the target parent was never written down — that gap is closed.

**3. Zero-byte files use a single multipart upload.** A resumable session for an empty body computes `Content-Range: bytes 0-(-1)/0`, which Drive rejects. `uploadEmpty()` sends `uploadType=multipart` instead, with no ranges involved. **41 files corpus-wide are zero bytes** — mostly `.aspx` stubs and macOS `.textClipping` files, plus a few genuinely empty documents. None had ever copied.

---

---

## Run 2 — 2026-08-17/18, complete

| | |
|---|---|
| Rows attempted | 18,467 |
| Verified | **18,466** |
| Failed | **1** |
| Skipped (already in Drive) | 11,068 |
| Bytes | 9.27 GB |
| Runtime | 6h 48m |
| Outstanding after run | **0** |

Routes: 10,258 `sort`, 7,589 `archive`, 619 `program`.

**All 152 source paths that failed in Run 1 are now verified in Drive.** The 403
retry fix did its job the moment it mattered — although, as it happens, Run 2 saw
**no 403s at all**, so the `storageQuotaExceeded` entry has still never been
exercised in anger.

### The zero-byte fix worked

Six ETG files uploaded at 0 bytes, none of which had ever copied before:

```
Programs/ETG…/ETG TPs/TP Contracts/Granted Contract - Training .textClipping
All Clients/TPD/ETG…/2017/SEEDS Mastery/Generic SEEDS Mastery brochu.textClipping
Old Files/ETG…/CJG-BC Applications 2016x…/Leoganda/Leoganda - CJG 1702342 - Sch.textClipping
All Clients/Diverse Construction/ETG…/2019/Business License/2665_001.pdf
All Clients/Diverse Construction/ETG…/2019/Business License/17-120647.pdf
All Clients/Spare Labs/ETG…/2023/Training_Planner_2022.xlsx
```

### The one failure

```
SPRAT Level 1.docx
  src  …/ETG-BC Applications 2019xx/Black Tie Property/SPRAT Level 1/
  dst  All Clients/Black Tie Property/ETG…/2019/SPRAT Level 1/
  upload → 500 internalError → retry 1/5 → 410 Gone
```

Google invalidated the resumable upload session between the 500 and the retry.
410 is not in the retryable set, so it failed — and re-PUTting a dead session URI
could not have worked anyway. **A 410 on a resumable upload means "discard this
session and start a new one."**

**Resolved 2026-08-18 (Run 3):** after the fixes below were applied, a re-run
copied the file in 5 seconds — verified, 25,637 bytes. ETG now stands at
**29,535 of 29,535**.

### Two defects found, both fixed 2026-08-18

**1. `410 Gone` on a resumable session.** `upload()` now loops over sessions:
the inner `withRetry` still refuses to retry a 410 against the same URI, and the
outer loop catches it, requests a fresh session, and restarts the transfer — up
to 3 sessions per file. The observed failure sequence (500 kills the session
server-side, retry of the same URI gets 410) is exactly what this handles.

**2. No request timeout anywhere.** Node's `fetch` has no default timeout, so a
socket that goes silent mid-request blocks until the OS gives up. Four times
during Run 2 this cost **15–20 minutes of complete stall**:

```
183m48s → 188m24s     4.5 min      28 files
188m24s → 208m08s    19.7 min      12 files   <- stall
208m38s → 224m18s    15.7 min      39 files   <- stall
224m18s → 224m50s      32 sec      33 files   <- normal cadence
```

Normal cadence is a progress line every ~31 seconds. The retry logic could not
help: it only runs *after* the hang resolves.

Every `fetch` in `pilot-copy.mjs` now carries an `AbortSignal.timeout()`:
**30s** for token calls, **60s** for metadata (find/create folder, stat, upload
init, shortcuts), **30 min** for Dropbox downloads (size unknown in advance),
and **size-scaled for uploads** — floor 3 min, budget 256 KiB/s, cap 30 min, so
a hung socket on a small file dies in minutes while a legitimately slow
gigabyte is left alone. A fired timeout surfaces as `TimeoutError`, which
`withRetry` treats as transport and retries. Each Run 2 stall would have cost
~60 seconds plus one retry instead of 15–20 minutes.

The stalls are the entire reason Run 2 averaged 0.75 files/sec against Run 1's
1.13. Excluding the stall windows the working rate was ~70 files/min, matching
Run 1 exactly.

---

## Reconciliation — Run 2

Performed by listing the Shared Drive independently and comparing against the ETG
rows of `full-mapping.csv`. **The ledger is not consulted**; it is the copier's own
account of what it believes it did, and checking against it would only prove the
copier is self-consistent.

| | |
|---|---|
| Files in the Shared Drive | 31,002 |
| Folders | 10,124 |
| Bytes in Drive | 36.75 GB |
| Shortcuts | 27 |
| Mapping expects (ETG) | 29,535 |
| Present at the exact mapped path | **29,377** |
| Present, path differs only in case | 157 |
| Genuinely absent | **1** |
| Size mismatches | **0** (see below) |
| Google-type conversions | **0** |

| Top-level folder | Files | Bytes |
|---|---|---|
| All Clients | 19,147 | 23.06 GB |
| Old Files | 9,625 | 8.01 GB |
| Programs | 2,230 | 5.67 GB |

The single absent file is the SPRAT 410 failure. Both the ledger and an
independent Drive listing agree on that, and on nothing else being missing.

### The size mismatch that wasn't

The reconciliation flagged one file where Drive disagreed with the inventory:

```
All Clients/Tradable Bits/ETG…/2025/Management Foundations - Course Outline.docx
  grants-inventory.csv  33,296 bytes   (snapshot: client_modified 2025-03-18)
  downloaded at copy    32,997 bytes
  in Drive now          32,997 bytes
```

Dropbox metadata read live: **32,997 bytes, client_modified 2026-08-13** — the
file was edited in Dropbox four days before the copy, after the inventory
snapshot was taken. The copy is byte-exact; the inventory is the stale party.
No file in Drive differs from what Dropbox actually served.

This is worth remembering for later stages: `grants-inventory.csv` is a point-in-time
snapshot, and size comparisons against it will produce false positives as the
source keeps changing under an active team.

### The 1,625 "extra" files are fully accounted for

Files present in Drive but not matching any `full-mapping.csv` destination:

| | Count |
|---|---|
| Case-variant paths (the same 157 files, counted from the other side) | 157 |
| CanExport pilot files (mapped by `canexport-mapping.csv`, a separate stage) | 1,468 |
| **Total** | **1,625** |

Nothing unexplained landed in the drive.

**A pre-existing gap, noted not fixed:** `canexport-mapping.csv` has 1,474 copyable
rows and 1,468 are in Drive. The 6 absent are all `.web` and `.gdoc` files —
Dropbox pointer stubs rather than real content, which the download API rejects as
`unsupported_file`. They carry no bytes worth migrating.

### Shortcuts

Drive holds 27 Live-client shortcuts; the ledger records 21. The 6 unrecorded
(Debrand Services Inc., Fine Choice Foods, Glass Canvas, Jack59, Nova Pacific,
Wild Creek) are CanExport-pilot clients, created before shortcut rows were being
written to the ledger. 11 of the 21 were created during Run 2.

---

## Corrections made before Run 1

Two files from the 20-file sample landed under a wrong year: the sub-segment year rule read a course code as a year (`BLDT 2031`, `Advanced NMEA 2000 Installer`). The rule was tightened — a sub-segment year must fall in 2013–2027 and must not contradict a cohort year above it — and both files were re-parented by metadata move:

- `Course Outline.docx` → `All Clients/Seagate Mass Timber/ETG…/2023/BLDT 2031/`
- `Advanced NMEA 2000® Installer Training Course Outline.pdf` → `All Clients/Titan Boats/ETG…/2022/Advanced NMEA 2000 Installer/`

Both verified: file ID unchanged, parent correct, bytes unchanged. The vacated year folders were confirmed to hold zero files at any depth and trashed.

That rule change moved 592 rows corpus-wide (BuyBC 338, ETG 231, CPF 21, Agri-Export 2). CanExport regenerated byte-identical apart from the root segment and the retention-cutoff date.

---

## The case-collision

**157 ETG files** sit in Drive at a path differing from the mapping **only in
capitalisation** (132 after Run 1; Run 2 added 25 more).

```
Dropbox has BOTH, as separate folders:
   ETG (Employer Training Grant)/cjg reference docs/           153 files
   ETG (Employer Training Grant)/CJG Reference Docs/            11 files
   ETG (Employer Training Grant)/cjg govt documents and forms/  106 files
   ETG (Employer Training Grant)/CJG Govt Documents and Forms/   20 files

Drive has ONE of each — whichever was created first.
```

Drive's `name =` folder query is case-insensitive, so `findFolder('CJG Reference Docs')`
matched the existing `cjg reference docs`. No file was lost or overwritten; the
filenames beneath differ. It reaches deeper than the two folders above —
`…/_Unfiled/cjg-manitoba applications all intakes/Castle Team/` vs `castle team/`,
`…/cjg-bc/Z_OLD/` vs `z_old/`, `…/2019/Reim/` vs `reim/`.

Arguably the better outcome — two casings of one folder merged — but it was a
divergence from the mapping, and any path-comparing reconciliation kept
flagging these 157.

**Resolved 2026-08-18: the merges are accepted and the mapping folds to
Drive's spelling.** The rule — first-created wins — now lives in
`foldDestinationCase()` in `scripts/mapping-lib.mjs`, applied corpus-wide by
`full-mapping.mjs` before collision detection. Where a folder already exists in
Drive its spelling is canonical (loaded from
`reconcile-drive.mjs --folders-only`); where it does not, the first mapping
row's spelling is — which is exactly what the copier will create. Filenames
never fold.

The full set was 15 variant groups, all ETG, all already in Drive; the
un-copied ~45,000 files contribute **zero** further groups, and folding created
**zero** new file-level collisions (the 285 suffixed rows are unchanged). In 5
of the 15 groups Drive kept the marginally rarer spelling (`reim`×2, `Reim`,
`Alberta`, `BC` — margins of 1–17 files, nothing ugly); flagged here, adopted
per the rule, since renaming Drive folders is off the table. The 157
already-copied ledger rows were re-cased to match (backup:
`copy-ledger.jsonl.bak-2026-08-18`), and the todo count did not move — the
ledger is keyed on `drive_file_id`, so the rewrite is cosmetic.

Post-fold reconciliation against live Dropbox: **29,535 of 29,535 present at
the exact mapped path, case-only variance 0, absent 0, size mismatches 0,
extras 0.**

---

## Throughput

| | ETG Run 1 | ETG Run 2 | CanExport pilot |
|---|---|---|---|
| Files | 11,068 | 18,466 | 1,468 |
| Bytes | 7.11 GB | 9.27 GB | 20.37 GB |
| Runtime | 2h 43m | 6h 48m | 47m 18s |
| **Files/sec** | **1.13** | **0.75** | 0.52 |
| **MB/sec** | **0.74** | **0.40** | 7.35 |

Different constraints: CanExport was a handful of very large videos,
bandwidth-bound. ETG is tens of thousands of small documents (mean 673 KB),
per-file-overhead-bound. Run 2's lower figure is entirely the four socket stalls
— its working rate matched Run 1 at ~70 files/min.

**Use ~1.1 files/sec as the planning figure** for the remaining corpus. The fetch
timeouts are now in place (2026-08-18), so the stall pattern that dragged Run 2
down should not recur.

⚠️ **`docs/inventory/full-mapping.md` carries a wrong runtime estimate** — 38h 46m, built on a `PILOT_BYTES` constant of 4.05 GB in `scripts/full-mapping.mjs`. The pilot actually moved **20.37 GB**; the constant is off by 5× and the estimate should not be relied on. ETG's figures are the better model for the remaining corpus.

---

## Reconciliation method

Reconciliation is now a durable script — `scripts/reconcile-drive.mjs` — that
lists the Shared Drive independently and compares it against the mapping.
**The ledger is never consulted for the verdict.**

The Drive listing is a single flat paginated `files.list` scoped to the drive
(`corpora=drive&driveId=…`), returning every item with its `parents` field, with
paths reconstructed locally from parent IDs.

> Earlier text here claimed that was the method while the code actually recursed
> folder by folder, one API call per folder. On a drive of 10,124 folders that is
> ~10,000 sequential round-trips and takes **51 minutes**. The flat listing needs
> 92 calls and takes **1m 51s** — the same 31,002 files and 10,124 folders, from
> both methods, run side by side to confirm. The description now matches what runs.

**Sizes are compared against live Dropbox metadata, not `grants-inventory.csv`**
(changed 2026-08-18). The inventory is a point-in-time snapshot, and the team
keeps editing source files during the migration — the Tradable Bits false
positive above is exactly that failure mode. The script lists the Grants tree
live (`files/list_folder`, read-only) and classifies each expected file three
ways: size agrees with Dropbox-as-of-now, `source_changed_since_copy` (Drive
disagrees with today's Dropbox — to be re-copied in a refresh pass, not evidence
of a bad copy), or `source_gone_from_dropbox` (moved or deleted at the source
since mapping). A genuinely corrupt copy can no longer hide behind — or be
invented by — a stale snapshot.

### Results after Run 3 (SPRAT re-copy, live-size reconciliation)

Drive: 31,003 files, 10,124 folders, 27 shortcuts. Dropbox live: 76,037 files
under the Grants tree.

| | Rows |
|---|---|
| Expected (ETG) | 29,535 |
| Present at the exact mapped path | 29,378 |
| Present, path differs only in case | 157 |
| Genuinely absent | **0** |
| Size agrees with live Dropbox | **29,535 of 29,535** |
| Source changed since copy | 0 |
| Source gone from Dropbox | 0 |
| Google-type conversions | 0 |
| Extra files in Drive | **0** |

**All 29,535 ETG files are in the Shared Drive, byte-identical to what Dropbox
serves today.** The extras count fell from 1,625 to 0 because the check now runs
against the union of both mapping sheets and tolerates case variance — the
previous figure was entirely CanExport-pilot files plus the case-variant paths,
both now accounted for structurally rather than by hand.
