# Delta Pull — Post-Freeze Results

**Dropbox froze:** Fri 2026-09-11 16:00 Pacific · **Walked / copied / reconciled:** 2026-09-13
**Dropbox cancelled:** 2026-09-15
**Destination:** Shared Drive `0AKxoOSs3WbQ0Uk9PVA`

Everything added, modified or deleted in Dropbox since the original inventories, diffed against
the copy ledger, then **genuinely new content only** copied through the existing pipeline — in two
passes: Part B (333 rows), then a follow-up for the 14 SALES triage-only files.

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

**Every DELETED file is a move, proven by content.** All 746 match a NEW file. The team re-sorted
SALES into `*Keep`, `*Obsolete : Duplicate - Delete` and `*Needs Review` (732 files), and reshuffled
14 files inside Grants client folders.

- **505 (≤ 4 MiB):** Drive's copy of the old path hashes to the new path's `content_hash`.
- **241 (> 4 MiB, 5.51 GB):** Part A first matched these on name and size only. Because a new file
  wrongly treated as a move would never be copied, they were then proven from Dropbox's revision
  history: for every old path, the revision current at copy time predates the ledger's copy stamp,
  equals the size the copier received, has no later revision, and carries the same `content_hash` as
  the file now at the new path. **241 of 241 proven.** Drive holds the exact bytes of every move.

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
| Triage-only new content | 14 | Exists only inside SALES triage folders; mirroring it would build the triage structure in Drive. **Copied in the follow-up pass at each file's pre-triage path — see below** |
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

## Follow-up — the 14 SALES triage-only files

Part B held these back: they exist only inside `*Keep` and `*Obsolete : Duplicate - Delete`, and
mirroring them at their current path would build the triage structure in Drive. With Dropbox cancelled
on 2026-09-15, they were copied in a second pass. The 3 `.web` stubs in `*Keep` were not attempted.

### Why they looked new

`dropbox-inventory-non-grants.js` walked SALES child by child to skip the Grants tree. **Files sitting
loose at the SALES root — and at the team-folder root — were collected into `looseTopFiles` and never
written out.** The August inventory holds zero SALES-root files. All 14 were loose SALES-root files:
never inventoried, never mapped, never copied. The 2026-08-28 triage moved them into the triage folders,
where the delta walk found them.

### Step 1 — content re-verified: 14 of 14 new

Against a fresh listing of all 82,888 Drive file items: **no content-hash match for any of the 14**, and
no name-and-size match either. All are ≤ 4 MiB, so the check is exact. Every file's `content_hash` is
unchanged since the Part A walk. **Final count: 14. None dropped as a move.**

### Step 2 — destination: the pre-triage path, proven by bytes

A moved Dropbox file leaves a deleted entry at its old path. Listing the SALES root with deleted entries
included shows all 14 names there, and `files/list_revisions` on each deleted path returns the content
hash of what it held. **For all 14, the SALES-root entry's revision hash equals the current file's hash**
— identity proven by bytes, not name. No file's bytes live anywhere else in Dropbox. **Zero ambiguous.**

**Destination: `Departments/SALES/<filename>`** — the pre-triage equivalent, through the departments
mirror rule unchanged. It is exactly the row that mapping would have produced had the inventory
recorded these files, and it creates no triage folder. Mirroring at the current path was rejected: it
would create `Departments/SALES/*Keep/` and `Departments/SALES/*Obsolete - Duplicate - Delete/`.

| From (Dropbox, now) | Pre-triage path | Drive destination |
|---|---|---|
| `SALES/*Keep/Client Renewal Battlecards.pptx` | `SALES/Client Renewal Battlecards.pptx` | `Departments/SALES/Client Renewal Battlecards.pptx` |
| `SALES/*Keep/PocketedVsGranted_presentation.pptx` | `SALES/PocketedVsGranted_presentation.pptx` | `Departments/SALES/PocketedVsGranted_presentation.pptx` |
| `SALES/*Keep/Service Comparison One-pager for Consulting services (2).png` | `SALES/…(2).png` | `Departments/SALES/Service Comparison One-pager for Consulting services (2).png` |
| `SALES/*Obsolete : Duplicate - Delete/` + the 11 below | `SALES/<same name>` | `Departments/SALES/<same name>` |

The 11: `Business Case ETG - 2025 Template.docx`, `Checklist when receiving handoffs from Strategy team
members.docx`, `CustomerTouchPoints.pdf`, `Granted Service Brochure v4-reduced.pdf`, `Jan 2021 to Mar 19
Annual Clients - GG Status.xlsx`, `NP Expo West 2026 Booth Deta.textClipping`, `NP Expo West 2026 Booth
Details.pdf`, `Payment Terms - ruks copy.xlsx`, `Payment Terms.xlsx`, `Scenarios on how to hit
target.pptx`, `strategy meeting slide deck changes.docx`.

### Step 3 — collisions: zero

Checked against every file item in Drive and every copyable destination in all five sheets: 0 exact,
0 case-only, 0 among the 14.

### Step 4 — the copy

| | |
|---|---|
| Attempted / **verified** / failed | 14 / **14** / 0 |
| Transferred | 5.60 MB in 17s |
| Retries / 410 restarts | 0 / 0 |
| Verified-ID guard | 82,843 present, 0 gone, 0 unknown |
| Size mismatches / Google-type conversions | 0 / 0 |
| Shortcuts created | 0 (no client folder involved) |

Ledger append-only: 83,029 pre-existing rows byte-identical, 14 appended, each matching its mapping row.
Pre-run copy: `dist/inventory/delta/copy-ledger.pre-triage.jsonl`.

### The other loose SALES-root files

The SALES root's deleted entries include five more files. Four are safe — their bytes are live
elsewhere in Dropbox and already in Drive: `Rudy-Herr-Resume-Electrical-Apprentice.docx`, `District of
Port Edward Grant Consulting Proposal 2.pdf`, `Discovery Call Deck 2025.pptx`, `Simplified Granted
Contract Terms.pdf`. The fifth is also safe; see below.

### Correction — `SALES/Rudy Herr - Vetting File .xlsx` is not staying behind

An earlier version of this document said this file "exists nowhere" and was "the one file found whose
only surviving copy disappears with Dropbox". **That was wrong.** The check behind it matched the
deleted entry against Drive by content and by name-and-size, not by Dropbox file identity. An edit made
two minutes after the deletion changed both the size and the hash, so the match was missed.

**Drive holds the document in its current version**, at
`Clients/Nightingale Electrical/Destination Trade/2024/Electrical Apprentice - Rudy Herr/Rudy Herr - Vetting File .xlsx`
(Drive ID `11PWyu-JpmaFK7fKXvWIBYbEed-Z8R3IR`, copied 2026-08-19, 33,299 bytes). Its Drive
`sha256Checksum` derives to Dropbox hash `606b9c6b…d36da5`, **identical to the live Dropbox file**
at `SALES/Grants/Destination Trade/Nightingale Electrical/Electrical Apprentice - Rudy Herr/`.

The deleted SALES-root entry was not a separate document. It was one stop, ten seconds long, while the
file was dragged into its client folder. `files/list_revisions` in `id` mode on the live file
(Dropbox ID `id:ISzPFl-ufmAAAAAAAAKqgw`) returns its whole life, root stop included:

| `server_modified` (UTC) | Path (under `/Granted Team Folder/`) | Bytes | Dropbox hash | Rev |
|---|---|---|---|---|
| 2024-05-03 18:50:51 | `sales/Grants/Destination Trade/Nightingale Electrical/` | 33,266 | `a92239d7…3408b7` | `6179132e1fddf3b5b480f` |
| 2024-05-03 18:51:12 | `Sales/Grants/Destination Trade/Nightingale Electrical/Vetting Files/` | 33,266 | `a92239d7…3408b7` | `61791341f190f3b5b480f` |
| 2024-05-29 21:46:32 | `SALES/Grants/Destination Trade/Nightingale Electrical/Vetting Files/` | 33,266 | `a92239d7…3408b7` | `016199eaf059c88000000012a69e201` |
| **2024-06-20 17:44:35** | **`SALES/`** — the deleted root entry | 33,266 | `a92239d7…3408b7` | **`0161b55de41c276000000012a69e201`** |
| 2024-06-20 17:44:45 | `SALES/Grants/Destination Trade/` | 33,266 | `a92239d7…3408b7` | `0161b55dee0c4b3000000012a69e201` |
| 2024-06-20 17:44:48 | `SALES/Grants/Destination Trade/Nightingale Electrical/` | 33,266 | `a92239d7…3408b7` | `0161b55df058f33000000012a69e201` |
| 2024-06-20 17:44:51 | `…/Nightingale Electrical/Electrical Apprentice - Rudy Herr/` | 33,266 | `a92239d7…3408b7` | `0161b55df34c801000000012a69e201` |
| **2024-06-20 17:46:34** | `…/Electrical Apprentice - Rudy Herr/` — **edited** | **33,299** | **`606b9c6b…d36da5`** | `0161b55e5592378000000012a69e201` |
| 2024-07-23 18:17:53 | `…/Electrical Apprentice - Rudy Herr/` — current rev, same bytes | 33,299 | `606b9c6b…d36da5` | `61dee2e1e2752c96122c3` |

The root path's own history, from `files/list_revisions` in `path` mode, agrees: one revision
(`0161b55de41c276000000012a69e201`, 33,266 bytes, `a92239d7…`), `server_deleted` 2024-06-20 17:44:45 —
the moment the file arrived in `Destination Trade/`. The deletion predates the migration by two years.

**What was actually missing from Drive:** only the bytes of the pre-edit draft (33,266 bytes, content
last changed on the client 2024-05-02), superseded two minutes after the move. They were downloaded by
revision ID — read-only — and verified against the revision's size and `content_hash`. **They are saved
locally, not in Drive**, by decision:

| | |
|---|---|
| File | `dist/inventory/delta/recovered/Rudy Herr - Vetting File .xlsx (dropbox rev 0161b55de41c276000000012a69e201)` (gitignored) |
| Size | 33,266 bytes |
| Dropbox content hash | `a92239d7ceff67ce5a9199316b232c5e42093866f93486dc3788e81bd33408b7` — matches the revision |
| SHA-256 | `48c155e4e2942005c446f84909a1ce0e9e1d2145b2b594e4dbcbc07d6a267591` |

No Drive write was made for it, and no ledger row was added.

---

## Step 6 — reconciliation against live Dropbox, Drive listed directly

Re-run after the follow-up, across all six sheets.

**The ledger was not consulted.** Drive was enumerated with one flat paginated `files.list` and paths
rebuilt from parent IDs. Dropbox was walked fresh, per in-scope folder — not from the sheets' common
ancestor, which with the delta sheet's team-root files becomes the team folder and would have listed
HR. Beyond size, files ≤ 4 MiB were compared by content hash.

| | After Part B | **Final** |
|---|---|---|
| Expected (all sheets) | 82,818 | **82,832** |
| **Present at the exact mapped path** | 82,806 | **82,820** |
| Case-only variance | 0 | 0 |
| Absent | 12 | **12** |
| Size agrees with live Dropbox | 82,060 | **82,074** |
| Content hash checked / agrees | 80,026 / 80,026 | 80,040 / **80,040** |
| **Changed since copy** | 0 | **0** |
| Source gone from Dropbox | 746 | 746 |
| Google-type conversions | 0 | 0 |
| Extra files in Drive | 78 | 78 |

82,820 present − 746 source-gone = 82,074 size-agreeing. Every figure closes, and every figure that
moved moved by exactly 14.

### Per sheet

| Sheet | Expected | Present | Absent | Size agrees | Hash agrees | Changed | Source gone |
|---|---|---|---|---|---|---|---|
| full-mapping | 74,776 | 74,773 | 3 | 74,759 | 73,813 | 0 | 14 |
| canexport-mapping | 1,474 | 1,468 | 6 | 1,468 | 1,216 | 0 | 0 |
| departments-mapping | 6,235 | 6,232 | 3 | 5,500 | 4,667 | 0 | 732 |
| **delta-grants** | **324** | **324** | **0** | **324** | **323** | **0** | **0** |
| **delta-departments** | **9** | **9** | **0** | **9** | **7** | **0** | **0** |
| **delta-triage** | **14** | **14** | **0** | **14** | **14** | **0** | **0** |

**All 347 delta rows are present, size-identical and — where checkable — hash-identical to live Dropbox.**

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
| Files (distinct paths) | **82,898** |
| File items | 82,902 — see note |
| Folders | 29,285 |
| Shortcuts | 43 |
| Bytes | **88.18 GB** |

| Top-level folder | Files | Bytes |
|---|---|---|
| Clients | 58,767 | 43.08 GB |
| Old Files | 13,308 | 11.27 GB |
| Departments | 6,333 | 24.21 GB |
| Programs | 4,490 | 9.62 GB |

| Stage | Files | Bytes |
|---|---|---|
| CanExport pilot | 1,468 | 20.37 GB |
| ETG | 29,535 | 16.38 GB |
| Grants final stage | 45,238 | 27.11 GB |
| Departments | 6,232 | 24.17 GB |
| **Delta pull — Part B** | **333** | **137.35 MB** |
| **Delta pull — triage follow-up** | **14** | **5.60 MB** |
| Created directly in Drive (AI, HR) | 78 | 12.57 MB |
| **Total in Drive** | **82,898** | **88.18 GB** |

**82,820 of 82,832 mapped files are in the Shared Drive, byte-identical to what Dropbox serves today.**
The 12 that are not are ten link stubs with no content and two files deleted at source before the
original copy.

> **Note — four same-path duplicates.** Reconciliation keys Drive files by path, so it counts 82,898;
> Drive holds 82,902 items. Four paths carry two files each. Two pairs are in `Departments/AI`, created
> directly in Drive. The other two are byte-identical orphan uploads from the original migration —
> created by the service account on 2026-08-17 (`Old Files/ETG…/PGL/…/1801162 - Receipt May 13.pdf`)
> and 2026-08-18 (`Clients/Privilege Clothing/Mon Avenir/2023/…/Candidate Vetting_Student
> Grant_Privilige_Noorie.docx`) — 41 minutes and 20 seconds, respectively, before the ledgered twin —
> with no ledger row of their own in any ledger or backup. None came from this pass. Every earlier file total, including August's 82,495,
> is likewise a distinct-path count. Nothing was deleted.

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

**3. The SALES triage structure — in Dropbox, not in Drive.** The folders exist only in Dropbox; **their
content is now entirely in Drive**, at pre-triage paths.

| Dropbox folder | Files | Where the content is in Drive |
|---|---|---|
| `SALES/*Obsolete : Duplicate - Delete` | 539 | 528 at their pre-triage subfolders; 11 at `Departments/SALES/` root |
| `SALES/*Keep` | 169 | 163 at their pre-triage subfolders; 3 at `Departments/SALES/` root; 3 are link stubs with no content |
| `SALES/*Needs Review` | 39 | All 39 at their pre-triage subfolders |

Drive's `Departments/SALES/` still reflects the pre-triage layout, and every triage-folder file with
content has a proven byte-identical counterpart there. **The SALES triage job is now metadata-only:**
744 Drive files to move into triage folders — the 730 moves plus the 14 root files from the follow-up.
The list of which Drive file belongs in which triage folder is in `dist/inventory/delta/delta-diff.csv`
(moves: `probable_move_of`) and `delta-triage-mapping.csv` (the 14).

**4. Also staying behind.** 10 link stubs with no content. Trashed files, including deleted revision
history such as the pre-edit Rudy Herr vetting draft — whose bytes are nonetheless saved locally, and
whose document is in Drive in its current version (see the correction in the follow-up). And two
namespace-root folders outside the Granted Team Folder — `Strategy Consultants` and `Team Paper Docs` —
which no inventory, this one included, has ever been scoped to.

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
6. **`dropbox-inventory-non-grants.js` never wrote out loose files at the team-folder root or the SALES
   root.** It collects them into `looseTopFiles` and drops them. That is why the three team-root PDFs
   and the 14 SALES-root files were missed in August and surfaced only as "new" in the delta.
7. **Drive reconciliation keys files by path**, in `reconcile-drive.mjs` and `delta-pull-reconcile.mjs`
   alike, so two files at one path count once. It hid four same-path duplicates, two of them orphan
   uploads from the August copy runs.
8. **The copier can leave an orphan upload.** Two byte-identical Drive files from 2026-08-17/18 have no
   ledger row. An upload that completes on Drive's side but whose response never reaches the copier is
   retried and uploaded again; only the second is recorded.

---

## Verification

- **a. `git status -uall`:** `dist/` absent (gitignored). New and untracked: the five `scripts/delta-pull-*.mjs`
  and this file. The 15 pre-existing modified files are checksum-identical to before the work.
- **b. Zero Dropbox writes, zero deletions anywhere.** Dropbox calls across every pass were
  `oauth2/token`, `users/get_current_account`, `files/get_metadata`, `files/list_folder` (including
  `include_deleted`), `files/list_folder/continue`, `files/list_revisions` and `files/download`. Every
  delta script that touches Drive requests `drive.readonly`; the only Drive writes were the copier's
  folder creates and uploads. No DELETE, trash or move was issued to either service — the four
  same-path duplicates were left in place.
- **c. Step 6 listed Drive directly.** `delta-pull-reconcile.mjs` reads no ledger file; its report
  records `ledger_consulted: false`.
- **d. No moved file was copied.** The 347 ledger rows appended across both passes share no source with
  the 748 moves, the 10 stubs or the 746 deleted sources; none of the 14 follow-up destinations lies
  under a triage folder.
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
| `delta-pull-reconcile.mjs` — after Part B | **0** |
| `delta-pull-triage.mjs` (run twice — second after a report-field fix) | 0, 0 |
| Large-move revision proof (read-only, scratch) | 0 |
| `pilot-copy.mjs --dry-run` — triage sheet | 0 |
| `pilot-copy.mjs` — triage sheet | **0** |
| `delta-pull-reconcile.mjs` — final | **0** |

The two Part B `pilot-copy.mjs --dry-run` invocations were piped through `tail`, so their exit codes
were not captured; both printed complete results.

## Reproducing

```bash
node scripts/delta-pull-inventory.mjs     # Part A: walk + diff (read-only)
node scripts/delta-pull-verify.mjs        # content check against all of Drive (read-only)
node scripts/delta-pull-mapping.mjs       # sandboxed pipeline run + collision check (no network)
node scripts/pilot-copy.mjs --mapping dist/inventory/delta/delta-grants-mapping.csv
node scripts/pilot-copy.mjs --mapping dist/inventory/delta/delta-departments-mapping.csv
node scripts/delta-pull-triage.mjs        # the 14: verify, prove pre-triage home, map, collisions (read-only)
node scripts/pilot-copy.mjs --mapping dist/inventory/delta/delta-triage-mapping.csv
node scripts/delta-pull-reconcile.mjs     # read-only
```

The mapping script excludes the triage-only files by folder; the copy set is otherwise every NEW
file that is not a move or a stub. Outputs are in `dist/inventory/delta/` (gitignored).
