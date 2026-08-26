# Departments Mapping — non-Grants Dropbox tree

**Generated:** 2026-08-20T18:00:09.334Z
**Source:** `dist/inventory/non-grants-inventory.csv`
**Output:** `dist/inventory/departments-mapping.csv`

**A straight mirror, not a reorganization.** Every file maps to
`Departments/<Top Level Folder>/<exact Dropbox substructure>/<filename>`. None of the
client / program / year / archive routing that produced the Grants mapping is applied here.
Folder names are preserved verbatim — odd casing, prefixes, leading asterisks and all.
Reorganizing the departments is a later phase; mirroring first means nothing has to be
re-decided if that structure changes.

Read-only: two local CSVs in, one CSV and this report out. No Dropbox call, no Drive call,
nothing copied.

---

## Scope

| Folder | Files | Folders | Size | Access |
|---|---|---|---|---|
| MARKETING | 2,624 | 296 | 12.51 GB | full |
| OPERATIONS | 2,279 | 53 | 1.39 GB | traverse_only, read_only |
| SALES | 759 | 361 | 5.84 GB | full |
| LEADERSHIP | 285 | 67 | 0.33 GB | full |
| RESEARCH | 254 | 26 | 1.40 GB | full |
| WRITERS | 28 | 13 | 2.65 GB | full |
| AI | 4 | 2 | 0.03 GB | full |
| Mindfulness | 2 | 1 | 0.02 GB | full |
| **In scope** | **6,235** | **819** | **24.17 GB** | |

### Reconciliation against the earlier non-Grants inventory

The 2026-08-12 inventory reported **6,273 files / 24.18 GB** accessible. This mapping covers
**6,235 files / 24.17 GB**.

| | Files | Bytes |
|---|---|---|
| Inventory total (accessible) | 6,273 | 24.18 GB |
| less HR (out of scope) | −38 | −0.01 GB |
| **Mapped here** | **6,235** | **24.17 GB** |

The difference is entirely **HR (38 files)**, excluded by instruction.

**FINANCE, ADMIN, GETGRANTED and GRANTED STARTER contribute nothing to either number.** They
returned `path/not_found` during the inventory — the service account cannot see them at all —
so they were never counted as accessible. Excluding them changes no total; it only means
they remain uninventoried, not that they are empty.

---

## SALES — what remains besides Grants

The migrated Grants tree is excluded: **0 rows** under
`/Granted Team Folder/SALES/Grants/` were skipped. (The inventory was itself built excluding
that subtree, so the figure is 0 — the guard is belt-and-braces, and it matches on the exact
subtree rather than a prefix.)

**SALES contributes 759 files / 5.84 GB** across 22 second-level folders:

| Second-level folder | Files | Size |
|---|---|---|
| *Annual Strategic Meetings | 362 | 2.76 GB |
| Strat Team Files - Clara Handover | 70 | 0.01 GB |
| Grant Processes | 60 | 0.28 GB |
| Discovery Call | 55 | 0.33 GB |
| Onboarding Documents | 46 | 0.01 GB |
| Training | 33 | 2.18 GB |
| Grants - Granted Starter | 27 | 0.01 GB |
| One-Pagers | 24 | 0.01 GB |
| Client | 20 | 0.12 GB |
| Resources | 17 | 0.09 GB |
| Call Checklists | 8 | 0.00 GB |
| Client Contracts | 7 | 0.01 GB |
| FCC Bid (Jan 17 2024) | 6 | 0.03 GB |
| COVID | 5 | 0.00 GB |
| Sales Coaching - Reg | 5 | 0.00 GB |
| Zoom Backgrounds | 4 | 0.00 GB |
| Strategy Vetting Files - Hiring | 3 | 0.00 GB |
| Reports | 2 | 0.00 GB |
| Proposals | 2 | 0.00 GB |
| Statistics | 1 | 0.00 GB |
| Grant Calculator | 1 | 0.00 GB |
| Grant Calculator Exports 2025 | 1 | 0.00 GB |

> ⚠️ **`Grants - Granted Starter` is included, and you may want it excluded.** It is a distinct
> folder from the migrated `SALES/Grants/` tree and was never copied, so on a literal reading it
> belongs in this mirror. But its name references Granted Starter, which is on the out-of-scope
> list as a *top-level* folder. Prefix-matching it away would also have swallowed it into the
> "already migrated" bucket, which would be wrong — so it is mapped, and flagged here instead of
> being silently decided either way.

---

## OPERATIONS — the count is a floor, not a total

**All 2,279 OPERATIONS files sit under a single subfolder, `Contracts`.** The folder
is flagged `traverse_only` and `read_only` in the inventory.

**`traverse_only` means the service account can descend through the folder but cannot fully
enumerate it.** The 2,279 figure is therefore a **floor**: it is what was visible, not what is
there. OPERATIONS may hold material outside `Contracts` that never appeared, and `Contracts`
itself may hold more than was listed.

Do not read this row as a complete account of OPERATIONS. Before copying, either grant the
service account full read access to OPERATIONS and re-inventory, or accept explicitly that an
unknown remainder is being left behind.

---

## Name changes

**14 folder names changed**, only where Drive cannot store the original:

| Dropbox | Drive |
|---|---|
| ` Wakefield Video Planning Doc` | `Wakefield Video Planning Doc` |
| `04:2015 - Steve Marks' groups` | `04 - 2015 - Steve Marks' groups` |
| `05:2015 - Joyce Groote's group` | `05 - 2015 - Joyce Groote's group` |
| `05:2015 - Randy Williams' Group` | `05 - 2015 - Randy Williams' Group` |
| `05:2015 - TEC Best Practices` | `05 - 2015 - TEC Best Practices` |
| `06:2015 - Mauro Meneghetti's group` | `06 - 2015 - Mauro Meneghetti's group` |
| `07:2015 - Mauro Meneghetti's group` | `07 - 2015 - Mauro Meneghetti's group` |
| `2011:2014 Templates` | `2011 - 2014 Templates` |
| `Black:White Transparent` | `Black - White Transparent` |
| `Black:White` | `Black - White` |
| `Environment:Ecology PowerPoint` | `Environment - Ecology PowerPoint` |
| `Fitness:Sport PowerPoint` | `Fitness - Sport PowerPoint` |
| `New:Mode` | `New - Mode` |
| `PDF contracts w: old address` | `PDF contracts w - old address` |

Filenames are never altered. Casing, prefixes and spacing are preserved everywhere else.

---

## Case-folding

**No case-variant folders found.** No two department folder paths differ only in capitalization,
so nothing needed folding.

---

## Collision check

Every destination checked against each other **and** against the 76,250 destinations already
occupied by the migrated Grants and CanExport trees.

**Zero collisions.** No two source files map to the same destination, and nothing here would
overwrite a file already in Drive.

---

## Volume and runtime

| | |
|---|---|
| Files to copy | **6,235** |
| Bytes | **24.17 GB** |
| Folders to create | 811 |
| Observed throughput | 0.59 files/sec |
| **Estimated runtime** | **2h 56m** |

The rate is the measured average from the final Grants copy stage (45,238 files in 21h 12m),
which includes the connectivity degradation seen throughout that run. At the healthy-stretch
rate of ~1.15 files/sec the same work takes about 1h 30m — treat the figure above as
the pessimistic end.

| Department | Files | Size | Est. runtime |
|---|---|---|---|
| MARKETING | 2,624 | 12.51 GB | 1h 14m |
| OPERATIONS | 2,279 | 1.39 GB | 1h 4m |
| SALES | 759 | 5.84 GB | 0h 21m |
| LEADERSHIP | 285 | 0.33 GB | 0h 8m |
| RESEARCH | 254 | 1.40 GB | 0h 7m |
| WRITERS | 28 | 2.65 GB | 0h 1m |
| AI | 4 | 0.03 GB | 0h 0m |
| Mindfulness | 2 | 0.02 GB | 0h 0m |

