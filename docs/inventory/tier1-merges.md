# Tier 1 Merges — Applied

**Generated:** 2026-08-12T01:53:55.111Z
**Inputs:** `docs/inventory/split-audit.md`, `scripts/client-corrections.json`, `dist/inventory/clients-final.csv`
**Applied to:** `scripts/client-corrections.json` (version-controlled). Re-run `node scripts/build-final-clients.mjs` to regenerate the client list.
**No file was copied, moved, renamed, or deleted. No API was called.**

## What was applied

| | |
|---|---|
| Tier 1 pairs considered | 119 |
| Applied as safe merges | **101** pairs → **87** clusters |
| Deferred (Group / Holdings) | 18 |
| Held back by a family guard | 0 |
| New corrections written | 87 |
| Existing corrections extended | 0 |

A merge is **safe** only when the two canonical names differ by a legal suffix (`Ltd`, `Inc`, `Corp`, `Co`, `LLC`, `ULC`, `Limited`, `Company`…), punctuation or spacing, `&` versus `and`, or a leading `The`. Anything else was left alone.

## Step 4 — transitive collapse

101 pairs collapsed into 87 clusters, so a three-way family produces one correction rather than three overlapping pairs.

**Canonical choice:** the variant carrying the most files, except that a name is never kept with a legal suffix when a suffix-free variant of the same company exists in the cluster. Folder naming stays consistent across the tree; groupings and file counts are identical either way.

15 clusters took the suffix-free name over the higher-file one:

| Most files | Chosen canonical |
|---|---|
| `Mayne Inc.` (210) | **Mayne** (23) |
| `Mak Physiotherapist Co.` (100) | **Mak Physiotherapist** (57) |
| `Mellenger Interactive Ltd.` (66) | **Mellenger Interactive** (17) |
| `Northam Law Corporation` (51) | **Northam Law** (15) |
| `PG Group Management Ltd` (37) | **PG Group Management** (21) |
| `TW Hawes Inc` (28) | **TW Hawes** (14) |
| `Wakefield Productions Inc.` (32) | **Wakefield Productions** (9) |
| `Myro Sales Inc.` (20) | **Myro Sales** (19) |
| `Great Canadian Landscaping Company` (29) | **Great Canadian Landscaping** (4) |
| `Legacy Family Office at Assante Financial Management Ltd.` (19) | **Legacy Family Office at Assante Financial Management** (4) |
| `Satya Organics Inc.` (14) | **Satya Organics** (5) |
| `AJK Consulting Inc` (9) | **AJK Consulting** (1) |
| `HRx Technology Inc.` (5) | **HRx Technology** (1) |
| `Clementine Natural Health Inc` (4) | **Clementine Natural Health** (1) |
| `Sand and Sea Design Company` (4) | **Sand and Sea Design** (1) |


8 clusters have three or more members:

| Canonical kept | Members | Files |
|---|---|---|
| **Fernie Brewing** | `Fernie Brewing` (264), `Fernie Brewing Co.` (4), `Fernie Brewing Company` (1) | 269 |
| **PHL Capital** | `PHL Capital` (230), `PHL Capital Corp` (24), `PHL Capital Co` (15) | 269 |
| **Mak Physiotherapist** | `Mak Physiotherapist Co.` (100), `Mak Physiotherapist` (57), `Mak Physiotherapist Corp.` (36) | 193 |
| **The Answer Company** | `The Answer Company` (92), `The Answer Co` (25), `Answer Co.` (11) | 128 |
| **Mellenger Interactive** | `Mellenger Interactive Ltd.` (66), `Mellenger Interactive` (17), `Mellenger Interactive Inc.` (4) | 87 |
| **Wind Sun Sky Entertainment** | `Wind Sun Sky Entertainment` (58), `Wind Sun Sky Entertainment Inc.` (13), `Wind Sun Sky Entertainment Co.` (3) | 74 |
| **Premium Fence** | `Premium Fence` (29), `Premium Fence Co.` (24), `Premium Fence Company` (7) | 60 |
| **Workshop Vegetarian** | `Workshop Vegetarian` (27), `The Workshop Vegetarian` (8), `The Workshop Vegetarian Ltd.` (3) | 38 |

## The 20 largest merges

| Canonical kept | Merged from | Files |
|---|---|---|
| **Nightingale Electrical** | `Nightingale Electrical Ltd` (16) | 344 |
| **Carmanah Technologies** | `Carmanah Technologies Corp` (8) | 280 |
| **Fernie Brewing** | `Fernie Brewing Co.` (4), `Fernie Brewing Company` (1) | 269 |
| **PHL Capital** | `PHL Capital Corp` (24), `PHL Capital Co` (15) | 269 |
| **Taymor Industries** | `Taymor Industries Ltd.` (103) | 267 |
| **The Acorn** | `Acorn` (113) | 259 |
| **Mayne** | `Mayne` (23) | 233 |
| **Modern Purair** | `Modern PURAIR Inc` (8) | 229 |
| **Fine Choice Foods** | `Fine Choice Foods Ltd` (4) | 200 |
| **Mak Physiotherapist** | `Mak Physiotherapist` (57), `Mak Physiotherapist Corp.` (36) | 193 |
| **The Artona Group** | `Artona Group` (61) | 175 |
| **Capital City News / Overstory Media** | `Capital City News (Overstory Media)` (3) | 159 |
| **Maven Consulting** | `Maven Consulting Limited` (5) | 150 |
| **Grace & Stella** | `Grace and Stella` (14) | 131 |
| **The Answer Company** | `The Answer Co` (25), `Answer Co.` (11) | 128 |
| **The Cheerful Pelvis** | `Cheerful Pelvis` (13) | 125 |
| **Metropolitan Fine Printers** | `Metropolitan Fine Printers Inc.` (23) | 111 |
| **A & B Dental** | `A&B Dental` (49) | 111 |
| **NGX Interactive** | `NGX Interactive Inc` (1) | 105 |
| **Simpli Assets** | `Simpli Assets Ltd.` (30) | 97 |

## Step 3 — the two protected families

`Northam` and `Maven` each head a family of related but distinct businesses, so a bare stem must never absorb a named sibling.

| Family | Applied | Not applied |
|---|---|---|
| Northam | Northam Law Corporation + Northam Law; Northam Beverages + Northam Beverages Ltd. | Northam Group / Northam |
| Maven | Maven Consulting + Maven Consulting Limited | Maven / Maven Group |

## Step 6 — deferred: Group and Holdings

Recorded in the `deferred` block of `scripts/client-corrections.json`, **not merged.** A `Group` or `Holdings` entity may be a legally distinct company; merging would be a business assertion rather than a spelling fix. Pending confirmation from Nat or a GC.

These files still migrate — they simply land as two client folders instead of one.

| Name A | Files | Name B | Files | Total |
|---|---|---|---|---|
| AME | 256 | AME Group | 112 | **368** |
| Strategex | 325 | Strategex Group | 4 | **329** |
| Trotman Auto Group | 76 | Trotman Auto | 70 | **146** |
| Artona Group | 61 | Artona | 54 | **115** |
| Capital City News | 64 | Capital City News Group Ltd. | 47 | **111** |
| Smile Innovations Group | 103 | Smile Innovations | 7 | **110** |
| Horizon Contracting | 51 | Horizon Contracting Group | 7 | **58** |
| Maven | 30 | Maven Group | 14 | **44** |
| Mount Pleasant Dental | 28 | Mount Pleasant Dental Group | 9 | **37** |
| E3 Eco | 30 | E3 Eco Group | 5 | **35** |
| E3 Eco | 30 | E3 Eco Group Inc. | 5 | **35** |
| Global Alignment Group | 30 | Global Alignment | 0 | **30** |
| Kerry Vega Group | 15 | Kerry Vega | 1 | **16** |
| Northam Group | 12 | Northam | 1 | **13** |
| Notaco | 10 | Notaco Holdings | 2 | **12** |
| Kids Physio | 7 | Kids Physio Group | 1 | **8** |
| Noel Asmar Group | 5 | Noel Asmar | 2 | **7** |
| Kitchen Table Group | 3 | Kitchen Table | 1 | **4** |

## Step 7 — no file lost its client

| | Before | After |
|---|---|---|
| Canonical companies | 1,847 | **1,752** |
| Attributed files | 70,725 | 70,725 |
| Raw folder names mapped | 1,962 | 1,962 |

Merging regroups names; it must never drop a file. The file and raw-name counts are unchanged, which is the check that matters.

## Reproducing

```bash
node scripts/apply-tier1-merges.mjs   # edits client-corrections.json
node scripts/build-final-clients.mjs  # regenerates the client list
```
