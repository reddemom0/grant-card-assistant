# Tier 1 Merges — Applied

**Generated:** 2026-08-13T17:32:30.209Z
**Inputs:** `docs/inventory/split-audit.md`, `scripts/client-corrections.json`, `dist/inventory/clients-final.csv`
**Applied to:** `scripts/client-corrections.json` (version-controlled). Re-run `node scripts/build-final-clients.mjs` to regenerate the client list.
**No file was copied, moved, renamed, or deleted. No API was called.**

## What was applied

| | |
|---|---|
| Tier 1 pairs considered | 16 |
| Applied as safe merges | **0** pairs → **0** clusters |
| Deferred (Group / Holdings) | 16 |
| Held back by a family guard | 0 |
| New corrections written | 0 |
| Existing corrections extended | 0 |

A merge is **safe** only when the two canonical names differ by a legal suffix (`Ltd`, `Inc`, `Corp`, `Co`, `LLC`, `ULC`, `Limited`, `Company`…), punctuation or spacing, `&` versus `and`, or a leading `The`. Anything else was left alone.

## Step 4 — transitive collapse

0 pairs collapsed into 0 clusters, so a three-way family produces one correction rather than three overlapping pairs.

**Canonical choice:** the variant carrying the most files, except that a name is never kept with a legal suffix when a suffix-free variant of the same company exists in the cluster. Folder naming stays consistent across the tree; groupings and file counts are identical either way.


## The 20 largest merges

| Canonical kept | Merged from | Files |
|---|---|---|

## Step 3 — the two protected families

`Northam` and `Maven` each head a family of related but distinct businesses, so a bare stem must never absorb a named sibling.

| Family | Applied | Not applied |
|---|---|---|
| Northam | _none_ | Northam Group / Northam |
| Maven | _none_ | Maven / Maven Group |

## Step 6 — deferred: Group and Holdings

Recorded in the `deferred` block of `scripts/client-corrections.json`, **not merged.** A `Group` or `Holdings` entity may be a legally distinct company; merging would be a business assertion rather than a spelling fix. Pending confirmation from Nat or a GC.

These files still migrate — they simply land as two client folders instead of one.

| Name A | Files | Name B | Files | Total |
|---|---|---|---|---|
| AME | 256 | AME Group | 112 | **368** |
| Strategex | 325 | Strategex Group | 4 | **329** |
| Trotman Auto Group | 76 | Trotman Auto | 70 | **146** |
| Capital City News | 64 | Capital City News Group Ltd. | 47 | **111** |
| Smile Innovations Group | 103 | Smile Innovations | 7 | **110** |
| Horizon Contracting | 51 | Horizon Contracting Group | 7 | **58** |
| Maven | 30 | Maven Group | 14 | **44** |
| E3 Eco | 30 | E3 Eco Group | 10 | **40** |
| Mount Pleasant Dental | 28 | Mount Pleasant Dental Group | 9 | **37** |
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
| Canonical companies | 1,847 | **AFTER_COMPANIES** |
| Attributed files | 70,725 | AFTER_FILES |
| Raw folder names mapped | 1,962 | AFTER_RAWS |

Merging regroups names; it must never drop a file. The file and raw-name counts are unchanged, which is the check that matters.

## Reproducing

```bash
node scripts/apply-tier1-merges.mjs   # edits client-corrections.json
node scripts/build-final-clients.mjs  # regenerates the client list
```
