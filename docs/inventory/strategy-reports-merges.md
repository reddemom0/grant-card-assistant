# Strategy Reports — Merges Applied

**Applied:** 2026-08-12 review, recorded 2026-08-13
**Source tag:** `strategy reports review 2026-08-12`
**Inputs:** `docs/inventory/strategy-reports-reconciliation.md`, `scripts/client-corrections.json`, `dist/inventory/resolved-final.csv`
**Method:** mechanical. Every merge below is Chris's decision from the reconciliation doc, written down as data. No API call of any kind — no Anthropic, no Dropbox, no Drive, no HubSpot. Nothing was copied, moved, renamed, or deleted.

| | |
|---|---|
| Corrections added | **22** (19 single + 3 clusters) |
| Corrections file | 93 → **115** |
| Canonical companies | 1,752 → **1,749** (−3) |
| Attributed files | 70,725 → **70,725** (no change) |
| Joint folders recorded | 11 → **14** |
| Deferred pairs added | **2** |
| Problems reported by the build | **0** |

---

## The two trees, and why most merges move no files

This matters for reading every number below.

`build-final-clients.mjs` works from `dist/inventory/resolved-final.csv` — 2,127 folder names harvested from **`SALES/Grants`**. The Strategy Reports folders live somewhere else entirely: `SALES/*Annual Strategic Meetings/Client Strategy Meeting Reports`. That tree has never been folded into the resolved universe.

So of the 22 Strategy folder names merged here, **21 do not exist in the Grants universe at all.** Only `Spark Kombuxha` appears in both, and it was already resolving to `Spark Kombucha`.

The consequence: a correction like `Dooly Research Ltd. → Dooly` collapses nothing today. `Dooly` is already its own canonical; the Strategy folder is not yet in the universe. What the correction does is **pin** the canonical against future re-classification and record where the Strategy folder belongs when that tree is migrated.

### Schema: `strategy_folders`

Strategy folder names are kept **out of `raw_names`** and put in a new `strategy_folders` field.

`build-final-clients.mjs` matches each entry in `raw_names` against the resolved universe and reports any miss as `not found in resolved list`. Putting 21 not-yet-existing names in `raw_names` would have produced 21 spurious problems and printed a "⚠️ Problems applying corrections" banner in `docs/inventory/clients-final.md` — making working corrections look broken. The separate field records the identical human decision without corrupting that signal. The `matching` note at the top of the JSON explains it.

**Result: the build reports `problems: 0`.**

---

## Step 1 — 19 single merges

Canonical is the existing company; the Strategy folder name merges into it.

| Strategy folder | → Canonical | Grants raw names pinned | Files on canonical |
|---|---|---|---|
| Chens Enterprises | Chen's Enterprise | 1 | 23 |
| E2 + Associates | E2+ Associates | 2 | 40 |
| Spark Kombuxha | Spark Kombucha | 2 | 29 |
| SupportBench | Support Bench | 1 | 69 |
| Vancouver Isl Brewery | Vancouver Island Brewing | 3 | 64 |
| Arts & Labour Artisans | Arts & Labour | 2 | 107 |
| Corporate Finance Institute (CFI Education) | Corporate Finance Institute | 3 | 118 |
| Dooly Research Ltd. | Dooly | 1 | 34 |
| Ethony Enterprises | Ethony | 1 | 46 |
| Gameon Entertainment Technologies | GameOn | 1 | 82 |
| Loren Nancke & Company | Loren Nancke | 1 | 33 |
| Satisfai Health | Satisfai | 1 | 37 |
| Simplex Services Inc. | Simplex | 1 | 3 |
| SupportingLines Institute | SupportingLines | 1 | 8 |
| Tamwood International College | Tamwood | 1 | 11 |
| Unbounce Marketing Solutions Inc | Unbounce | 1 | 2 |
| Videre Financiers | Videre | 1 | 13 |
| House of A La Ligne | ALL Movement (House of A La Ligne) | 1 | 39 |
| DEVA Training & Staff Solutions | DEVA Training & Staffing | 1 | 4 |

Three of these pinned more Grants spellings than expected, which is the pinning working as intended:

- **Corporate Finance Institute** — also pins `CFI (Corporate Finance Institute)` (65 files) and the typo `Corporate Finance Institude` (31 files).
- **Vancouver Island Brewing** — also pins `Vancouver Island Brewing (VIB)` (59 files) and `Vancouver Island Brewing - KPU` (2 files).
- **Arts & Labour** — also pins `Arts&Labour` (3 files).

`Spark Kombuxha` is the one Strategy name that also exists in Grants (21 files there), already resolving correctly. It is listed in both `raw_names` and `strategy_folders`.

---

## Steps 2 and 3 — 3 clusters

Each collapses into **one** correction, not overlapping pairs. These are the only three entries that reduce the canonical count.

| Canonical | Members folded in | Strategy folder | Canonicals collapsed | Files after |
|---|---|---|---|---|
| Clearmind International Institute | `Clearmind` (74) + `Clearmind International Institute` (15) | Clearmind International | 2 → 1 | 89 |
| Abilities Rehabilitation | `Abilities Rehab` (10) + `Abilities Rehabilitation` (18) | Abilities Neurological Rehabilitation | 2 → 1 | 28 |
| New World Technologies | `New World Tech` (18) + `New World Technologies` (3) | New World Technology | 2 → 1 | 21 |

**−3 canonicals, and every file retained.** 74 + 15 = 89, 10 + 18 = 28, 18 + 3 = 21.

`New World Technologies (Rad Torque)` (8 files) is **excluded** from the New World merge and recorded as deferred, per Step 3.

---

## Step 4 — joint folders

### Where the existing 11 live

Not in a doc — in **code**: the `JOINT` Map at `scripts/canexport-mapping.mjs:30`. Files under those folders get dual-filed, one row per client, routed to `review`.

Because they do not live only in a doc, the fallback instruction — migrate all 15 into a `joint_folders` block in `client-corrections.json` — **was not triggered, and no migration was done.**

### What was added

Three entries, not four. Two of the four requested were already covered.

| Folder | Clients | Tree | Status |
|---|---|---|---|
| `Healthy Hooch:Functional Beverage Group` | Healthy Hooch + Functional Beverage Group | Grants | **added** — live for `canexport-mapping.mjs` (24 files) |
| `Admin Slayer - Spring Planning` | Admin Slayer + Spring Planning | Strategy | **added** — inert today (4 files) |
| `CF Canada & AP Insurance` | CF Canada Financial + AP Insurance | Strategy | **added** — inert today (1 file) |
| `Madison Builders:E2 + Associates` | Madison Builders + E2+ Associates | Grants | already present since the colon triage (16 files) |

Three things worth knowing:

1. **`Madison Builders / E2 + Associates` was already there.** It is `madison builders:e2 + associates` in the map. No duplicate was added.
2. **`Admin Slayer - Spring Planning` is the same client pair as an existing entry.** The Grants tree spells it `admin slayer:spring planning` (already in the map); the Strategy tree spells it with a hyphen. Both are now recorded, so the count is 14 folder records covering 13 distinct client pairs.
3. **The two Strategy entries are inert.** `canexport-mapping.mjs` walks `grants-inventory.csv` only, so it will never encounter a Strategy folder name. They are recorded so joint handling has one list to read when the Strategy tree is migrated. Both are commented as such in the file.

### Related names not touched

The CF Canada cluster has Grants-side relatives that were **not** merged and not made joint, because Step 4 asked only for the Strategy folder: `AP Insurance (CF Canada Financial)` (46 files), `CF Canada Financial` (28), `AP Insurance` (134), and `CF Canada Financial & AP Insurance` (0). Worth a decision at some point — flagging, not acting.

---

## Step 5 — deferred

Added under `deferred.strategy_reports` in `scripts/client-corrections.json`.

| Names | Files | Reason |
|---|---|---|
| `Linetest Collective` / `Linetest TV` | 1 + 12 = **13** | Shared stem, then divergence. A collective and a TV arm may be two divisions of one business or two entities. Not a spelling difference. |
| `New World Technologies` / `New World Technologies (Rad Torque)` | 3 + 8 = **11** | Excluded from the New World merge on purpose. The parenthetical suggests a distinct entity or brand. |

**Fixed.** `scripts/apply-tier1-merges.mjs` used to reassign the whole `deferred` object at line 204, which silently dropped this sub-block on every re-run. It now merges into the existing object and rewrites only the three keys it owns (`description`, `source`, `pairs`), logging any sibling block it carries forward. See "Sibling-block preservation" below.

---

## Step 6 — build re-run

`node scripts/build-final-clients.mjs`

| | Before | After | Δ |
|---|---|---|---|
| Canonical companies | 1,752 | **1,749** | **−3** |
| Attributed files | 70,725 | **70,725** | **0** |
| Attributed bytes | 57,783,742,063 | **57,783,742,063** | **0** |
| Corrections applied | 93 | 115 | +22 |
| Problems | — | **0** | |

**The attributed file count did not drop.** Byte total is identical too. −3 canonicals is exactly the three clusters; the other 19 corrections pin names without collapsing anything, as expected.

The build's own internal figure reads `1855 → 1749` — that is the *uncorrected* model output vs. the corrected result, computed fresh each run. The 1,752 → 1,749 comparison above is the one that answers the question asked: previous `clients-final.csv` vs. current.

---

## Step 7 — `suffixKey` normalization fix

**Fixed** at `scripts/split-audit.mjs:76`. The first token is now held back before legal suffixes are stripped.

```
"Co-llective Consulting"   old: "-llective consulting"   new: "co-llective consulting"
"Group Health Centre"      old: "health centre"          new: "group health centre"
"Ltd Brands"               old: "brands"                 new: "ltd brands"
"Fine Choice Foods Ltd"    old: "fine choice foods"      new: "fine choice foods"   (unchanged)
"AME Group"                old: "ame"                    new: "ame"                 (unchanged)
```

Real trailing suffixes still strip. Only names whose *first* token is a suffix word change.

### Does the Tier 1 count change from 119?

**No — but 119 was never the number to compare against.**

- **119** is what `docs/inventory/split-audit.md` recorded on 2026-08-12, against an **1,847**-canonical list, before commit `a042b7e0` applied 87 tier-1 merges.
- Against the current **1,749**-canonical list, Tier 1 was **16 before the fix and 16 after**. The 87 merges are what removed the other ~103 pairs, not this change.

**Why the fix moved nothing:** exactly **1 canonical of 1,749** has a changed Step-1 key — `PS&CO`, which went from the mangled `ps&` to `ps&co`. It formed no pair either way. The fix is still correct: `ps&` is a truncated key that could collide with any other name reducing to `ps&`.

**`Co-llective Consulting` is not a canonical.** It is a Strategy Reports folder in the "genuinely new clients" list of the reconciliation. The bug was found there and would have caused a real mis-key the moment that tree was folded in. Fixing it ahead of that is the point.

Full re-run: 1,749 clients, 413 suspect pairs — 16 near-certain, 75 likely, 322 ambiguous. `docs/inventory/split-audit.md` was regenerated.

---

## Sibling-block preservation in `deferred`

`scripts/apply-tier1-merges.mjs` owns `deferred.description`, `deferred.source`, and `deferred.pairs`. It used to write them with `doc.deferred = {…}`, replacing the whole object — so any sub-block another pass had added was destroyed the next time it ran.

It now spreads the prior object first and rewrites only its own three keys, and logs what it carried:

```
deferred: carrying forward 1 sibling block(s): strategy_reports
```

**Verified by running it.** `deferred.strategy_reports` survives byte-identical, all 115 corrections are untouched, and `version` / `description` / `matching` are unchanged. Two further consecutive runs produce a byte-identical file, so it is idempotent.

### One real change the re-run made, unrelated to the fix

`deferred.pairs` went **18 → 16**. The script re-derives that list from `docs/inventory/split-audit.md` and `clients-final.csv` on every run, and both were regenerated in this pass. Two pairs dropped:

| Dropped pair | Why |
|---|---|
| `E3 Eco / E3 Eco Group Inc.` | Clean de-duplication. `E3 Eco Group Inc.` no longer exists as a canonical — an earlier tier-1 merge folded it into `E3 Eco Group`. The same question is still recorded as `E3 Eco / E3 Eco Group`. |
| `Artona Group / Artona` | ⚠️ **A recorded decision is now unrecorded.** `Artona Group` was folded into `The Artona Group` (175 files). `Artona` (54 files) still exists separately, so the "are these one company?" question is still live — but the pair no longer appears in Tier 1, so nothing records it. |

**Why Tier 1 stopped seeing the Artona pair:** `suffixKey` strips `Group` but not a leading `The`, and `punctKey` strips a leading `The` but not `Group`. `The Artona Group` reduces to `the artona` under one key and `artona group` under the other; `Artona` reduces to `artona` under both. Neither key matches, so no pair forms. A name carrying *both* a leading `The` and a trailing `Group` falls through the gap between the two keys.

This is a pre-existing detection gap, not something this pass introduced, and it is not fixed here — the brief scoped the change to the reassignment bug. Flagging it because a deferred decision quietly stopped being tracked. `Artona` (54) vs `The Artona Group` (175) still needs an answer.

---

## Counts that differ from the brief

Reported rather than reconciled silently:

- The brief said **20 merges**; the steps enumerate **22** (19 + 2 + 1). All 22 were applied.
- The brief said **4 joint folders**; **3** were added, because `Madison Builders:E2 + Associates` was already recorded. Total is **14**, not 15.
- The brief anticipated migrating 15 joint folders into `client-corrections.json`; that was conditional on the existing 11 living only in a doc. They live in code, so no migration was done.

---

## Files changed

| File | Change |
|---|---|
| `scripts/client-corrections.json` | +22 corrections (93 → 115), new `strategy_folders` field, `deferred.strategy_reports` block, `matching` note extended |
| `scripts/canexport-mapping.mjs` | +3 entries in the `JOINT` map (11 → 14) |
| `scripts/split-audit.mjs` | `suffixKey` holds the first token back |
| `scripts/apply-tier1-merges.mjs` | `deferred` is merged into, not reassigned — sibling blocks survive re-runs |
| `docs/inventory/tier1-merges.md` | regenerated by the re-run |
| `dist/inventory/clients-final.csv` | regenerated (gitignored) |
| `docs/inventory/clients-final.md` | regenerated by the build |
| `docs/inventory/split-audit.md` | regenerated by the re-run |
| `docs/inventory/strategy-reports-merges.md` | this file |

Not touched: `OPERATIONS/Contracts`, `src/tools/dropbox.js:99-101` (known, deferred), `dist/inventory/grants-inventory.csv` (checksum verified unchanged).

Nothing was committed.

---

## Reproducing

```
node scripts/build-final-clients.mjs   # applies corrections, writes clients-final.csv
node scripts/split-audit.mjs           # re-runs the split audit
```

Both read local files only and make no network call. To change a merge decision, edit `scripts/client-corrections.json` and re-run — nothing needs re-classifying.
