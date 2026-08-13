# Non-Grants Dropbox Inventory

**Generated:** 2026-08-12T18:56:00.460Z
**Source:** `/granted team folder` — every top-level folder except the already-inventoried `SALES/Grants`
**Runtime:** 2m 14s
**Method:** metadata only — `files/list_folder` recursive. No file content fetched, nothing written to Dropbox.

## Per top-level folder

| Folder | Files | Folders | Size |
|---|---|---|---|
| MARKETING | 2,624 | 296 | 12.51 GB |
| SALES | 759 | 361 | 5.84 GB |
| WRITERS | 28 | 13 | 2.65 GB |
| RESEARCH | 254 | 26 | 1.40 GB |
| OPERATIONS | 2,279 | 53 | 1.39 GB |
| LEADERSHIP | 285 | 67 | 0.33 GB |
| AI | 4 | 2 | 0.03 GB |
| Mindfulness | 2 | 1 | 0.02 GB |
| HR | 38 | 10 | 0.01 GB |
| **Total (accessible)** | **6,273** | **829** | **24.18 GB** |

### Inaccessible — not counted above

| Folder | Error | Flags |
|---|---|---|
| FINANCE | path/not_found/ | no_access |
| GETGRANTED | path/not_found/ | no_access |
| GRANTED STARTER | path/not_found/ | no_access |
| ADMIN | path/not_found/ | no_access |

---

## Combined total — the storage number

| | Files | Folders | Size |
|---|---|---|---|
| Grants (already inventoried) | 75,971 | 24,079 | 63.82 GB |
| Everything else | 6,273 | 829 | 24.18 GB |
| **Combined** | **82,244** | **24,908** | **88.00 GB** |

⚠️ **This is an accessible-only figure, not the true total.** It counts what the `consultants@granted.ca` member can see. It excludes:

- `FINANCE` — could not be listed at all
- `GETGRANTED` — could not be listed at all
- `GRANTED STARTER` — could not be listed at all
- `ADMIN` — could not be listed at all

Budget for the storage upgrade should treat this as a **floor**.

---

## Step 4 — completeness

| Folder | no_access | traverse_only |
|---|---|---|
| Mindfulness | no | no |
| LEADERSHIP | no | no |
| FINANCE | **yes** | no |
| GETGRANTED | **yes** | no |
| GRANTED STARTER | **yes** | no |
| ADMIN | **yes** | no |
| OPERATIONS | no | **yes** |
| AI | no | no |
| RESEARCH | no | no |
| HR | no | **yes** |
| MARKETING | no | no |
| SALES/*Annual Strategic Meetings | no | no |
| SALES/COVID | no | no |
| SALES/Discovery Call | no | no |
| SALES/Training | no | no |
| SALES/Reports | no | no |
| SALES/Statistics | no | no |
| SALES/Strat Team Files - Clara Handover | no | no |
| SALES/Resources | no | no |
| SALES/Client | no | no |
| SALES/Sales Coaching - Reg | no | no |
| SALES/Grant Calculator | no | no |
| SALES/Client Contracts | no | no |
| SALES/Strategy Vetting Files - Hiring | no | no |
| SALES/Grant Processes | no | no |
| SALES/One-Pagers | no | no |
| SALES/Onboarding Documents | no | no |
| SALES/Call Checklists | no | no |
| SALES/FCC Bid (Jan 17 2024) | no | no |
| SALES/Proposals | no | no |
| SALES/Grant Calculator Exports 2025 | no | no |
| SALES/Grants - Granted Starter | no | no |
| SALES/Zoom Backgrounds | no | no |
| WRITERS | no | no |

⚠️ **6 folders are only partially visible.** A `traverse_only` folder returns *only the subset this member can reach* — the listing looks complete and is not. Their counts are a **lower bound, not a total**:

- `FINANCE` — no_access
- `GETGRANTED` — no_access
- `GRANTED STARTER` — no_access
- `ADMIN` — no_access
- `OPERATIONS` — traverse_only
- `HR` — traverse_only

3 folder(s) **inside** the walked trees carry a restriction flag; their subtrees are likewise a lower bound. First 20:

| Path | Flags |
|---|---|
| `/Granted Team Folder/OPERATIONS` | traverse_only |
| `/Granted Team Folder/HR/Employee Handbook and Processes` | traverse_only |
| `/Granted Team Folder/HR` | traverse_only |

---

## Step 7 — extensions

| Extension | Files |
|---|---|
| `.pdf` | 2,896 |
| `.jpg` | 983 |
| `.png` | 604 |
| `.pptx` | 544 |
| `.docx` | 519 |
| `.ai` | 124 |
| `.mp4` | 117 |
| `.eps` | 99 |
| `.xlsx` | 69 |
| `.svg` | 50 |
| `.mp3` | 28 |
| `.jpeg` | 25 |
| `.m4a` | 24 |
| `.md` | 24 |
| `.doc` | 21 |
| `.mov` | 18 |
| `.txt` | 10 |
| `.ppt` | 10 |
| `.rtf` | 10 |
| `.cpgz` | 7 |
| `.csv` | 6 |
| `.pictclipping` | 6 |
| `.attributes` | 5 |
| `.tif` | 4 |
| `.zip` | 4 |
| `.psd` | 4 |
| `.webarchive` | 3 |
| `.webloc` | 3 |
| `.xlsm` | 3 |
| `.web` | 3 |
| _(none)_ | 26 |

Client-modified range: 2010-01-06 → 2026-06-26.

---

## Step 7 — folders that look like client material

Flagged by shape only: a second-level folder whose children look like company names rather than document categories. **Not acted on** — this changes migration scope and is Chris's call.

| Folder | Child folders | Classed as client | Share | Files |
|---|---|---|---|---|
| `OPERATIONS/Contracts` | 10 | 8 | 80% | 2,279 |
| `MARKETING/OLD STUFF` | 23 | 21 | 91% | 853 |
| `SALES` | 22 | 16 | 73% | 759 |
| `SALES/*Annual Strategic Meetings` | 4 | 4 | 100% | 362 |
| `SALES/*Annual Strategic Meetings/Client Strategy Meeting Reports` | 179 | 175 | 98% | 336 |
| `LEADERSHIP` | 5 | 5 | 100% | 285 |
| `RESEARCH` | 8 | 6 | 75% | 254 |
| `MARKETING/OLD STUFF/Annual Strat Day` | 17 | 16 | 94% | 236 |
| `MARKETING/OLD STUFF/Wakefield Productions` | 6 | 6 | 100% | 211 |
| `RESEARCH/Inactive Grants` | 8 | 8 | 100% | 210 |
| `MARKETING/Presentations/Infograpify Powerpoint Templates` | 44 | 44 | 100% | 199 |
| `MARKETING/1.DELETE/Web Images` | 7 | 5 | 71% | 166 |
| `MARKETING/*Image Resources/Vector Icons` | 4 | 4 | 100% | 119 |
| `LEADERSHIP/Workshop Tactics - Digital Deck/Workshop Tactics - Drag Drop Cards` | 56 | 55 | 98% | 112 |
| `MARKETING/Logos - GetGranted` | 6 | 5 | 83% | 97 |
| `MARKETING/Presentations/TEC - Canada` | 6 | 5 | 83% | 76 |
| `MARKETING/Social Media Posts` | 4 | 4 | 100% | 67 |
| `SALES/Grant Processes/Old Processes` | 26 | 26 | 100% | 55 |
| `SALES/Strat Team Files - Clara Handover/Erin` | 6 | 6 | 100% | 46 |
| `MARKETING/Logos - GetGranted/PNG` | 4 | 4 | 100% | 40 |
| `MARKETING/OLD STUFF/Logos Icons Brand Sheet - Elivated` | 4 | 4 | 100% | 37 |
| `SALES/Training` | 5 | 5 | 100% | 33 |
| `MARKETING/Testimonials` | 7 | 7 | 100% | 28 |
| `WRITERS` | 5 | 4 | 80% | 28 |
| `SALES/Grants - Granted Starter` | 5 | 4 | 80% | 27 |
| `MARKETING/One-Pagers` | 4 | 4 | 100% | 24 |
| `SALES/One-Pagers` | 5 | 5 | 100% | 24 |
| `SALES/Strat Team Files - Clara Handover/Pedro` | 6 | 6 | 100% | 23 |
| `MARKETING/OLD STUFF/Client Logos` | 4 | 3 | 75% | 18 |

**7,004 files** sit under folders whose children read as company names. If any of these are client work rather than internal material, the migration scope is larger than the Grants tree alone.

---

## Reproducing

```bash
node scripts/dropbox-inventory-non-grants.js
```

Read-only and resumable. Delete `/private/tmp/claude-502/-Users-Chris-grant-card-assistant/7d749464-333a-42ff-899f-752bf4b95d32/scratchpad/dbx-nongrants/walk.checkpoint.json` to force a fresh walk.
