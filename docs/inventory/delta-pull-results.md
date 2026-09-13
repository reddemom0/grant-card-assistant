# Delta Pull — Post-Freeze Results

**Dropbox froze:** Fri 2026-09-11 16:00 Pacific · **Walked / copied / reconciled:** 2026-09-13
**Destination:** Shared Drive `0AKxoOSs3WbQ0Uk9PVA`

Everything added, modified or deleted in Dropbox since the original inventories, diffed against
the copy ledger, then **genuinely new content only** copied through the existing pipeline.

Dropbox was read-only throughout. Nothing was deleted anywhere.

---

## Part A — what changed since the inventory

A fresh walk of every in-scope folder (FINANCE, HR, ADMIN, GETGRANTED and GRANTED STARTER never
listed): **82,508 files, 88.12 GB.** The namespace resolved to the team root (`3248953587`), not the
member's home (`4543298785`). **No file carries a `server_modified` after the freeze** — the last
write anywhere was 2026-09-11 21:01 UTC.

| Category | Files | Bytes |
|---|---|---|
| NEW — no ledger entry | 1,084 | 5.97 GB |
| **MODIFIED** | **0** | — |
| DELETED — copied, now gone from Dropbox | 746 | 5.83 GB |
| UNCHANGED | 81,424 | 82.15 GB |

**Nothing was edited in place.** The ledger never recorded a `content_hash`, so a baseline had to be
derived. For a file of one 4 MiB block, Dropbox's `content_hash` is SHA-256 of SHA-256 of the bytes,
and Drive's `sha256Checksum` is SHA-256 of the bytes — so the hash of what Drive actually holds is
exact without a download. All 79,696 Drive copies checked that way matched. The 2,031 larger copies
have no Dropbox revision after their copy timestamp, even with an hour's margin. No size differs.

**Every DELETED file is a move.** All 746 match a NEW file — 505 by content hash, 241 by name and
size. The team re-sorted SALES into `*Keep`, `*Obsolete : Duplicate - Delete` and `*Needs Review`
(732 files), and reshuffled 14 files inside Grants client folders.

NEW therefore splits into 748 moves, 305 files of genuinely new content, 24 inventoried files never
copied (CanExport `review` rows) and 7 known link stubs.

---

## Part B — what was copied

| Set | Sources | Rows | Bytes |
|---|---|---|---|
| New Grants content | 279 | 279 | 108.14 MB |
| New department files | 9 | 9 | 19.93 MB |
| CanExport carryover (never copied) | 24 | 45 | 5.55 MB |
| **Total** | **312** | **333** | **133.61 MB** (137.35 MB transferred, dual-filing included) |

### Deliberately not copied

| | Files | Why |
|---|---|---|
| Moves | 748 | Drive already holds the content at its pre-triage path |
| Triage-only new content | 14 | Exists only inside SALES triage folders; mirroring it would build the triage structure in Drive. **Handed to the SALES triage job — see below** |
| Link stubs | 10 | `.web` / `.gdoc` pointers with no retrievable content — the 7 known failures, plus the 3 SALES stubs that moved into `*Keep`. Not attempted |

### Content re-verified against all of Drive first

Part A checked NEW files only against DELETED sources. Before copying, every selected file was
checked against **every** file in Drive — by derived hash for files ≤ 4 MiB, and for the three
larger files by downloading from Dropbox and comparing SHA-256 with Drive directly (each download
also re-hashed to its listed `content_hash`).

**320 matched nothing. 6 matched bytes already in Drive — all copies, none a misclassified move:** the
Drive file each one matches still has its own live Dropbox source. They are reused templates
(`Electrical Apprentice.docx`, already in Drive 18×; `CanExport - Intro Sheet.docx`, 13×;
`TCS Survey.docx`), two Nightingale ETG course documents reused in the 2026–27 intake, and one
candidate's resume filed under both Norland and BelPacific. Copied, by decision, as the original
corpus copied every live path.

---

## Mapping — the existing pipeline, unchanged

`scripts/full-mapping.mjs` ran **as-is** in a sandbox under `dist/inventory/delta/sandbox/`, fed the
original inputs plus only the new rows, with a fresh dump of Drive's folder names for case-folding.
`departments-mapping.mjs` ran the same way; its sandbox copy differs only in the removed
`process.chdir` into the repo and in import paths.

**Proof it is unchanged:** every pre-existing source regenerated to the committed row.

| Sheet | Committed rows | Regenerated | Result |
|---|---|---|---|
| `full-mapping.csv` | 74,776 | 74,776 | Identical except the retention cutoff date in 13,221 archive *reason* strings (`2020-08-18` → `2020-09-13`; the script computes it from today). Every destination, route, year and client identical |
| `departments-mapping.csv` | 6,235 | 6,235 | Byte-identical |

A new file that shifted an existing destination — a collision suffix, a case fold, a node change —
would have broken that equivalence and aborted the run.

Routes: sort 321, program 3, mirror 9. Year provenance across Grants rows: `client_modified` 199,
batch level 87, first sub-path segment 38. **`server_modified` used nowhere.**

### Two inputs augmented beyond appending rows

**CanExport review rows.** `canexport-mapping.csv` predates the review-pile routing in
`full-mapping.mjs`, so its 45 review rows were never routed. The same routing was applied here:
the 21 `Taimuri:Capstone` files dual-file to `Clients/Taimuri/CanExport/…` and
`Clients/Capstone/CanExport/…` (42 rows); the 3 no-client files go to `Programs/CanExport/_Unfiled/`.

**Zanzibar** — see Step 2.

---

## Step 2 — the never-seen folder name

Part A found **one** never-seen folder name, not three: `ETG/ETG-BC Applications 2026 : 2027
Intake/Zanzibar`, holding 3 files.

**Not a new client. A variant of the existing canonical `Zanzibar Holdings`.**

- The existing folder is `ETG/ETG-BC Applications 2025 : 2026 Intake/Zanzibar Holdings/`, with an
  `S-100/` course subfolder. The new one is `…2026 : 2027 Intake/Zanzibar/S-100/` — same client,
  same course, next intake.
- The new folder's own invoice is `S100 invoice_Zanzibar Holdings Ltd_June 2026.pdf`.
- `Zanzibar Holdings` is already Live (HubSpot `39424427343`, active), with a Current Clients shortcut.
- Under `normalizeName` the two keys differ (`zanzibar` vs `zanzibar holdings`); under the status
  matcher's legal-suffix key they are identical.

`build-final-clients.mjs` only builds canonicals from names already in `resolved-final.csv`, which
Zanzibar never entered, so a corrections entry alone cannot route it — the pipeline would leave the
files in `review`. The sandbox applied the correction as `build-final-clients.mjs` would emit it.
**The committed `client-corrections.json`, `clients-final.csv` and `client-status.csv` were not
modified** — the brief adds corrections only for genuinely new clients, and none was. HubSpot status
matching was therefore not re-run.

| File | Destination |
|---|---|
| `S-100/claims/Invoice-2751712.pdf` | `Clients/Zanzibar Holdings/ETG (Employer Training Grant)/2026/S-100/claims/` |
| `S-100/claims/POP-2751712.pdf` | same |
| `S-100/S100 invoice_Zanzibar Holdings Ltd_June 2026.pdf` | `Clients/Zanzibar Holdings/ETG (Employer Training Grant)/2026/S-100/` |

Year 2026 from the batch level (`…2026 : 2027 Intake`).

---

## Step 3 — new folder, known client name

All 9 resolve to the existing canonical through the unchanged name lookup.

| Folder | Files | Canonical | Status | Destination |
|---|---|---|---|---|
| `ETG/…2026 : 2027 Intake/Tradable Bits` | 2 | **Tradable Bits** | Live | `Clients/Tradable Bits/ETG (Employer Training Grant)/2026/Bellrock Management Foundations/` (year: batch) |
| `Talent Opportunities/Horizon` | 7 | **Horizon** | Archived | `Clients/Horizon/Talent Opportunities/2026/Tannor/` (year: client_modified) |

> ⚠️ **`Horizon` was already a mixed canonical before this pull.** Its folders span 2016–17 PSYIP
> junior-accountant hires and a 2024 Career Launcher watering-labour placement. The new Tannor files
> are Horizon Landscape (a certificate of name change, "DIL to HLC"); HubSpot holds `Horizon
> Landscape` as a separate, inactive company. The pipeline filed them correctly by its own rules; the
> canonical itself may need splitting. Not acted on.

---

## Step 4 — collisions: zero

Every one of the 333 new destinations was checked against every file actually present in Drive
(82,555 at listing time), every copyable destination in the three committed sheets, and each other.

| Check | Collisions |
|---|---|
| Exact path already occupied | 0 |
| Case-only match to an existing path | 0 |
| Two new rows, one destination | 0 |

---

## Step 5 — the copy

**Command:** `scripts/pilot-copy.mjs --mapping` on each delta sheet, unmodified.

| | Grants sheet | Departments sheet |
|---|---|---|
| Attempted | 324 | 9 |
| **Verified** | **324** | **9** |
| Failed | 0 | 0 |
| Transferred | 117.42 MB | 19.93 MB |
| Runtime | 6m 58s | 18s |
| Retries / 410 restarts | 0 / 0 | 0 / 0 |
| Verified-ID guard | 82,510 present, 0 gone, 0 unknown | 82,834 present, 0 gone, 0 unknown |

**Size mismatches: 0. Google-type conversions: 0.** All guards active as committed: timeouts on every
fetch site, 403 retry gated on rate-limit reasons, 410 fresh session, zero-byte multipart, transport
errors read from `err.cause.code`, abort above 2% unresolved IDs.

### Shortcuts

**No new Live client, so no shortcut was created** — zero shortcut rows in the ledger. The 16 Live
clients the delta touched all already had a Current Clients shortcut, checked in Drive before the run.

One new client folder appeared: **`Clients/Taimuri`**, from the joint-client rule. `Taimuri` has no
canonical or status row and no HubSpot match, so it is not Live. `Capstone` is Archived.

### Ledger

**Append-only.** The 82,696 pre-existing rows (49,388,517 bytes) are byte-identical and in order; 333
verified rows appended, each matching its mapping row's source and destination exactly. Pre-run copy:
`dist/inventory/delta/copy-ledger.pre-delta.jsonl`.

---

## Step 6 — reconciliation against live Dropbox, Drive listed directly

**The ledger was not consulted.** Drive was enumerated with one flat paginated `files.list` and paths
rebuilt from parent IDs. Dropbox was walked fresh, per in-scope folder — not from the sheets' common
ancestor, which with the delta sheet's team-root files becomes the team folder and would have listed
HR. Beyond size, files ≤ 4 MiB were compared by content hash.

| | |
|---|---|
| Expected (all five sheets) | **82,818** |
| **Present at the exact mapped path** | **82,806** |
| Case-only variance | 0 |
| Absent | **12** |
| Size agrees with live Dropbox | **82,060** |
| Content hash checked / agrees | 80,026 / **80,026** |
| **Changed since copy** | **0** |
| Source gone from Dropbox | 746 |
| Google-type conversions | 0 |
| Extra files in Drive | 78 |

82,806 present − 746 source-gone = 82,060 size-agreeing. Every figure closes.

### Per sheet

| Sheet | Expected | Present | Absent | Size agrees | Hash agrees | Changed | Source gone |
|---|---|---|---|---|---|---|---|
| full-mapping | 74,776 | 74,773 | 3 | 74,759 | 73,813 | 0 | 14 |
| canexport-mapping | 1,474 | 1,468 | 6 | 1,468 | 1,216 | 0 | 0 |
| departments-mapping | 6,235 | 6,232 | 3 | 5,500 | 4,667 | 0 | 732 |
| **delta-grants** | **324** | **324** | **0** | **324** | **323** | **0** | **0** |
| **delta-departments** | **9** | **9** | **0** | **9** | **7** | **0** | **0** |

**All 333 delta rows are present, size-identical and — where checkable — hash-identical to live Dropbox.**

### The 12 absent are the same 12 as August

Ten link stubs with no content (`Programs/Grant Planner Template/…web`, six under CanExport, three in
`Departments/SALES`), plus two files deleted from Dropbox before they could be copied
(`Nightingale Electrical/…/Paystubs Yu Hugo Ng.pdf`, `MiHR/…/EN Direct Deposit Authorization (1).pdf`).
No file with retrievable content is missing.

### The 746 source-gone are the moves

732 under `Departments/SALES/<pre-triage folder>/` and 14 inside Grants client folders. **Drive is now
the only place these files exist at those paths.** In Dropbox the same bytes sit in their new
locations.

### The 78 extras were created in Drive, not copied

| Folder | Files | What |
|---|---|---|
| `Departments/AI` | 63 | Matching sweep artifacts and fix-queue notes, dated 2026-08-22 onward — new work |
| **`Departments/HR`** | **15** | Employee handbook, 2026 payroll dates, org chart, statutory holidays and similar. **HR is being moved manually by its owners; these arrived that way.** None appears in the ledger |

---

## Step 7 — corpus totals and what remains in Dropbox

### The Shared Drive

| | |
|---|---|
| Files | **82,884** |
| Folders | 29,285 |
| Shortcuts | 43 |
| Bytes | **88.18 GB** |

| Top-level folder | Files | Bytes |
|---|---|---|
| Clients | 58,767 | 43.08 GB |
| Old Files | 13,308 | 11.27 GB |
| Departments | 6,319 | 24.20 GB |
| Programs | 4,490 | 9.62 GB |

| Stage | Files | Bytes |
|---|---|---|
| CanExport pilot | 1,468 | 20.37 GB |
| ETG | 29,535 | 16.38 GB |
| Grants final stage | 45,238 | 27.11 GB |
| Departments | 6,232 | 24.17 GB |
| **Delta pull** | **333** | **137.35 MB** |
| Created directly in Drive (AI, HR) | 78 | 12.57 MB |
| **Total in Drive** | **82,884** | **88.18 GB** |

**82,806 of 82,818 mapped files are in the Shared Drive, byte-identical to what Dropbox serves today.**

### What remains in Dropbox

**1. The five out-of-scope folders.**

| Folder | Visibility to the service account | Status |
|---|---|---|
| FINANCE | `no_access` — never seen | Contents, size and count unknown |
| ADMIN | `no_access` — never seen | Contents, size and count unknown |
| GETGRANTED | `no_access` — never seen | Contents, size and count unknown |
| GRANTED STARTER | `no_access` — never seen | Contents, size and count unknown |
| HR | `traverse_only` — partially visible | 38 files inventoried in August; not listed this pass. Owners moving it manually — 15 files already in Drive |

Four of the five have never been seen at all. **They are not empty — they are invisible.**

**2. OPERATIONS' unknown remainder.** Still `traverse_only`. The walk again saw exactly 2,279 files,
all under `Contracts`, and all are in Drive. **2,279 is a floor, not a total**: the service account can
descend through OPERATIONS but cannot fully enumerate it. Granting full read access and re-walking is
the only way to close this.

**3. The SALES triage structure — in Dropbox, not in Drive.**

| Dropbox folder | Files | In Drive? |
|---|---|---|
| `SALES/*Obsolete : Duplicate - Delete` | 539 | 528 as moves (at pre-triage paths); **11 exist only in Dropbox** |
| `SALES/*Keep` | 169 | 163 as moves; **3 exist only in Dropbox**; 3 are stubs with no content |
| `SALES/*Needs Review` | 39 | All 39 as moves |

Drive's `Departments/SALES/` still reflects the pre-triage layout. **The SALES triage job has two parts,
not one:** move the 730 files Drive already holds, *and copy the 14 below*, which are in Drive nowhere.
None matches any file in Drive by content.

| File | Size |
|---|---|
| `*Keep/Client Renewal Battlecards.pptx` | 371 KB |
| `*Keep/PocketedVsGranted_presentation.pptx` | 1.50 MB |
| `*Keep/Service Comparison One-pager for Consulting services (2).png` | 349 KB |
| `*Obsolete : Duplicate - Delete/Business Case ETG - 2025 Template.docx` | 16 KB |
| `*Obsolete : Duplicate - Delete/Checklist when receiving handoffs from Strategy team members.docx` | 18 KB |
| `*Obsolete : Duplicate - Delete/CustomerTouchPoints.pdf` | 26 KB |
| `*Obsolete : Duplicate - Delete/Granted Service Brochure v4-reduced.pdf` | 2.44 MB |
| `*Obsolete : Duplicate - Delete/Jan 2021 to Mar 19 Annual Clients - GG Status.xlsx` | 17 KB |
| `*Obsolete : Duplicate - Delete/NP Expo West 2026 Booth Deta.textClipping` | 291 B |
| `*Obsolete : Duplicate - Delete/NP Expo West 2026 Booth Details.pdf` | 778 KB |
| `*Obsolete : Duplicate - Delete/Payment Terms - ruks copy.xlsx` | 26 KB |
| `*Obsolete : Duplicate - Delete/Payment Terms.xlsx` | 11 KB |
| `*Obsolete : Duplicate - Delete/Scenarios on how to hit target.pptx` | 65 KB |
| `*Obsolete : Duplicate - Delete/strategy meeting slide deck changes.docx` | 16 KB |

**If Dropbox is cancelled before that job runs, these 14 files are lost.**

**4. Also staying behind.** 10 link stubs with no content. Trashed files. And two namespace-root folders
outside the Granted Team Folder — `Strategy Consultants` and `Team Paper Docs` — which no inventory,
this one included, has ever been scoped to.

---

## Pipeline limitations found

Recorded, not fixed.

1. **A new folder name cannot be routed through `client-corrections.json` alone.**
   `build-final-clients.mjs` only builds canonicals from `resolved-final.csv`; a correction naming a
   folder outside it is reported as "not found in resolved list" and dropped. Any future re-map from a
   fresh inventory will send `Zanzibar` to review unless the classification universe is rebuilt.
2. **`canexport-mapping.csv` never received the review-pile routing** that `full-mapping.mjs` applies.
   Its 45 review rows sat unrouted until this pass.
3. **`reconcile-drive.mjs` walks from the sheets' common ancestor.** Any sheet with a team-root file
   makes that the whole team folder, pulling out-of-scope folders into the walk.
4. **`full-mapping.mjs` computes its retention cutoff from the current date**, so a regeneration
   rewrites every archive reason string. Destinations are unaffected.
5. **`pilot-copy.mjs --dry-run` reads byte counts from `grants-inventory.csv`**, so files absent from
   the original inventory contribute 0 bytes to the estimate.

---

## Verification

- **a. `git status -uall`:** `dist/` absent (gitignored). New and untracked: the four `scripts/delta-pull-*.mjs`
  and this file. The 15 pre-existing modified files are checksum-identical to before the work.
- **b. Zero Dropbox writes, zero deletions anywhere.** Dropbox calls were `oauth2/token`,
  `users/get_current_account`, `files/list_folder`, `files/list_folder/continue` and `files/download`
  (`files/list_revisions` is wired in Part A but had zero suspects to resolve, so was never called).
  Every delta script that touches Drive requests `drive.readonly`; the only Drive writes were the
  copier's folder creates and uploads. No DELETE, trash or move was issued to either service.
- **c. Step 6 listed Drive directly.** `delta-pull-reconcile.mjs` reads no ledger file; its report
  records `ledger_consulted: false`.
- **d. No file from the moves list was copied.** The 333 appended ledger rows share no source with the
  748 moves, the 14 triage-only files, the 10 stubs or the 746 deleted sources.
- **Contract files unchanged:** `full-mapping.csv`, `canexport-mapping.csv`, `departments-mapping.csv`,
  `clients-final.csv`, `client-status.csv`, `resolved-final.csv`, both inventories and
  `client-corrections.json` all verified by SHA-256 against a pre-work baseline. Only
  `copy-ledger.jsonl` changed, append-only as above.

## Exit codes

| Run | Exit |
|---|---|
| `delta-pull-inventory.mjs` (Part A, run twice — second after a report-only fix) | 0, 0 |
| `delta-pull-verify.mjs` | 0 |
| `delta-pull-mapping.mjs` (run twice — second after a report-only fix), incl. sandboxed `full-mapping.mjs` and `departments-mapping.mjs` | 0, 0 |
| `pilot-copy.mjs` — grants sheet | **0** |
| `pilot-copy.mjs` — departments sheet | **0** |
| `delta-pull-reconcile.mjs` | **0** |

The two `pilot-copy.mjs --dry-run` invocations were piped through `tail`, so their exit codes were not
captured; both printed complete results.

## Reproducing

```bash
node scripts/delta-pull-inventory.mjs     # Part A: walk + diff (read-only)
node scripts/delta-pull-verify.mjs        # content check against all of Drive (read-only)
node scripts/delta-pull-mapping.mjs       # sandboxed pipeline run + collision check (no network)
node scripts/pilot-copy.mjs --mapping dist/inventory/delta/delta-grants-mapping.csv
node scripts/pilot-copy.mjs --mapping dist/inventory/delta/delta-departments-mapping.csv
node scripts/delta-pull-reconcile.mjs     # read-only
```

The mapping script excludes the triage-only files by folder; the copy set is otherwise every NEW
file that is not a move or a stub. Outputs are in `dist/inventory/delta/` (gitignored).
