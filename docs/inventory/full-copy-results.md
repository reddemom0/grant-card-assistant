# Full Copy — Final Stage

**Command:** `scripts/pilot-copy.mjs --mapping dist/inventory/full-mapping.csv`
**Destination:** Shared Drive `0AKxoOSs3WbQ0Uk9PVA`
**Completed:** 2026-08-19

Dropbox is read-only throughout — the only endpoints touched are `oauth2/token`,
`files/download`, `files/get_metadata` and `files/list_folder`. Nothing is deleted
anywhere. The mapping sheet is never written by the copier.

This is the third and final copy stage. CanExport (1,468 files) and ETG (29,535)
were copied earlier; this stage moved everything else.

---

## The run

| | |
|---|---|
| Rows attempted | 45,241 |
| **Verified** | **45,238** |
| Failed | **3** |
| Skipped (already verified) | 29,535 |
| Bytes | **27.11 GB** |
| Runtime | **21h 12m** |
| Outstanding after run | **0** |

Routes: 39,298 `sort`, 2,257 `program`, 3,683 `archive`.

**Size mismatches: 0** across all 76,241 verified ledger rows.
**Google-type conversions: 0.** 35 zero-byte files copied via the multipart path.

### Throughput, and why it took 21 hours

Observed: **0.59 files/sec, 0.38 MB/sec** overall — roughly half the ~1.15
files/sec sustained during healthy stretches. The whole difference is recurring
connectivity degradation on the copying machine, in cycles of 15–100 minutes
alternating with clean stretches.

**144 retries fired. Every single one succeeded on attempt 1 of 5** — none
escalated, none exhausted, and no file was lost to them. The request timeouts
added after ETG Run 2 are what made this survivable: each stall now costs ~60
seconds and a retry instead of blocking a worker indefinitely.

A useful diagnostic detail: the retry log prints `23`, which is not an HTTP
status but `DOMException.TIMEOUT_ERR` — the numeric code `AbortSignal.timeout`
carries. Logging `err.name` (`TimeoutError`) would read better than the bare
number.

### The three failures

None is a copier defect. All three were verified against **live** Dropbox.

```
1. Programs/Grant Planner Template/Grant Planner Template.web
   HTTP 409 unsupported_file
   The file exists (117 bytes) but Dropbox refuses to serve its content —
   a pointer stub, the same class as the six known CanExport .web/.gdoc files.
   There are no bytes to copy.

2. Clients/Nightingale Electrical/Destination Trade/2026/.../Paystubs Yu Hugo Ng.pdf
3. Clients/MiHR/Green Jobs/2026/Keystone/Jeremy N/EN Direct Deposit Authorization (1).pdf
   HTTP 409 path/not_found
   Both are genuinely gone from Dropbox. Listing the parent of (3) shows
   "EN Direct Deposit Authorization .pdf" but no "(1)" duplicate — the team
   removed it after the inventory snapshot was taken.
```

Failures 2 and 3 are the migration's standing hazard made concrete: **the source
is a moving target.** `grants-inventory.csv` is a point-in-time snapshot and the
team keeps working during the migration. This is why size checks reconcile
against live Dropbox rather than the snapshot.

### Shortcuts

**16 created this run**, 37 in the ledger, **43 in Drive**, **zero duplicates**
by name or by target, zero unresolved, zero stale labels.

Created this run: AME Consulting, AndGo Systems, Avanti CPA LLP, Cultivated Food
Labs, Dynamic Reforestation, GlassCanvas, Haven Apparel, Horizon Contracting
Group, Maple Reinders, Nova Pacific Environmental, Rice and Noodles, Sterling
IAQ, Steve Marshall Group, The AME Consulting Group Ltd., The Sutherland Group,
Top International.

The 43-in-Drive vs 37-in-ledger gap is expected and benign: six shortcuts
(Debrand Services Inc., Fine Choice Foods, Glass Canvas, Jack59, Nova Pacific,
Wild Creek) predate shortcut rows being written to the ledger. `ensureLiveShortcut`
queries Drive before creating, so it adopts them rather than duplicating them —
which is exactly what the zero-duplicate result confirms.

---

## Reconciliation — live Dropbox, Drive listed independently

The ledger is **not** consulted for this verdict. Drive is enumerated with one
flat paginated `files.list` (paths rebuilt locally from parent IDs) and compared
against the union of both mapping sheets. Sizes are compared against **live
Dropbox metadata**, obtained by walking the Grants tree with `files/list_folder`.

| | |
|---|---|
| Files in the Shared Drive | **76,241** |
| Folders | 28,325 |
| Bytes in Drive | 63.86 GB |
| Shortcuts | 43 |
| Live Dropbox files under Grants | 76,057 |
| Mapping expects | 76,250 |
| **Present at the exact mapped path** | **76,241** |
| Case-only variance | **0** |
| Absent | **9** |
| **Size agrees with live Dropbox** | **76,241 of 76,241** |
| Source changed since copy | **0** |
| Source gone from Dropbox | **0** |
| Google-type conversions | **0** |
| Extra files in Drive | **0** |

| Top-level folder | Files | Bytes |
|---|---|---|
| Clients | 58,446 | 42.97 GB |
| Old Files | 13,308 | 11.27 GB |
| Programs | 4,487 | 9.62 GB |

### Per program

268 of 272 programs reconcile perfectly. The 20 largest:

| Program | Expected | Exact | Case | Absent | Size OK | Changed | Gone |
|---|---|---|---|---|---|---|---|
| ETG (Employer Training Grant) | 29,535 | 29,535 | 0 | 0 | 29,535 | 0 | 0 |
| WorkBC Wage Subsidy | 15,617 | 15,617 | 0 | 0 | 15,617 | 0 | 0 |
| BuyBC | 1,984 | 1,984 | 0 | 0 | 1,984 | 0 | 0 |
| Magnet SWPP | 1,899 | 1,899 | 0 | 0 | 1,899 | 0 | 0 |
| Career Launcher Internships (inc DS4Y DT) | 1,628 | 1,628 | 0 | 0 | 1,628 | 0 | 0 |
| CanExport | 1,308 | 1,302 | 0 | 6 | 1,302 | 0 | 0 |
| Mon Avenir | 1,247 | 1,247 | 0 | 0 | 1,247 | 0 | 0 |
| DS4Y - VCN | 1,210 | 1,210 | 0 | 0 | 1,210 | 0 | 0 |
| WIL Digital | 1,101 | 1,101 | 0 | 0 | 1,101 | 0 | 0 |
| GYW (Youth Hiring Subsidy) | 931 | 931 | 0 | 0 | 931 | 0 | 0 |
| DS4Y - LHL | 925 | 925 | 0 | 0 | 925 | 0 | 0 |
| DS4Y - Pinnguaq | 886 | 886 | 0 | 0 | 886 | 0 | 0 |
| Talent Opportunities | 834 | 834 | 0 | 0 | 834 | 0 | 0 |
| CPF | 807 | 807 | 0 | 0 | 807 | 0 | 0 |
| Career Ready (ITAC Technation) | 763 | 763 | 0 | 0 | 763 | 0 | 0 |
| Innovate BC - ISI | 743 | 743 | 0 | 0 | 743 | 0 | 0 |
| YESP | 604 | 604 | 0 | 0 | 604 | 0 | 0 |
| DS4Y - ICNJ | 552 | 552 | 0 | 0 | 552 | 0 | 0 |
| PSYIP (Grad Hiring Subsidy) | 498 | 498 | 0 | 0 | 498 | 0 | 0 |
| Green Jobs | 471 | 470 | 0 | 1 | 470 | 0 | 0 |

**Every program with any imperfection** — four in total, nine files, all the
undownloadable-stub or deleted-at-source cases described above:

| Program | Absent | Why |
|---|---|---|
| CanExport | 6 | `.web` / `.gdoc` pointer stubs, no bytes to copy |
| Green Jobs | 1 | source deleted from Dropbox after the snapshot |
| Destination Trade | 1 | source deleted from Dropbox after the snapshot |
| Grant Planner Template | 1 | `.web` pointer stub |

---

## Corpus totals, all three stages

| Stage | Files | Bytes | Runtime |
|---|---|---|---|
| CanExport pilot | 1,468 | 20.37 GB | 47m 18s |
| ETG | 29,535 | 16.38 GB | 9h 31m (two runs + one re-copy) |
| Final stage | 45,238 | 27.11 GB | 21h 12m |
| **Total in Drive** | **76,241** | **63.86 GB** | — |

**Is every mapped file now in Drive? Yes, with nine documented exceptions.**

76,241 of 76,250 mapped files are in the Shared Drive, byte-identical to what
Dropbox serves today. The nine absentees are not losses:

- **Seven** are `.web` and `.gdoc` Dropbox pointer stubs. They contain no
  document content — they are links — and Dropbox's API refuses to serve them
  (`unsupported_file`). Nothing was lost because there is nothing in them.
- **Two** were deleted from Dropbox by the team after the inventory snapshot and
  no longer exist at the source.

No mapped file with retrievable content is missing from Drive.

---

## Verification

- **Zero Dropbox writes, zero deletions anywhere.** The copier calls only
  `oauth2/token` and `files/download`; reconciliation adds `files/get_metadata`
  and `files/list_folder`. No mutating Dropbox endpoint is imported or called,
  and no Drive DELETE or trash operation is performed by any script in this stage.
- **Reconciliation listed Drive directly**, not the ledger — a flat `files.list`
  over the drive with paths reconstructed from parent IDs.
- **`dist/` is gitignored** and absent from `git status -uall`.
- **Contract preserved.** Regenerating the mappings to prove the markdown stage
  completes also rewrites the CSVs, so both were diffed (only the retention-cutoff
  date string moved — 13,221 rows in full-mapping, 87 in canexport, **zero
  destination changes**) and then restored to the exact bytes the copy executed.

### Exit codes

| Script | Exit | Markdown stage |
|---|---|---|
| `full-mapping.mjs` | **0** | wrote `docs/inventory/full-mapping.md` (838 lines) |
| `canexport-mapping.mjs` | **0** | wrote `docs/inventory/canexport-pilot.md` (327 lines) |

Both completed through the markdown stage. This is checked explicitly because a
dropped `revBytes` reference once crashed `full-mapping.mjs` *after* the CSV
write for five days — the CSV stayed fresh while the report silently went stale,
and the pipeline exit code masked it.

---

## Known follow-ups

- `scripts/drive-restructure.mjs:45` still hardcodes `'Live Clients'`. Dormant —
  the one-off 90-folder restructure, not in the copy path — but running it today
  would recreate the old root. One-line fix.
- `T_DOWNLOAD` is a flat 30 minutes. A single hung download parks one of four
  workers for that long; it should scale with size the way `uploadTimeout` does.
- The retry log prints `23` rather than `TimeoutError`.
