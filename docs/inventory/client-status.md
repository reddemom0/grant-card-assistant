# Client Status — Live vs Archived

**Inputs:** `dist/inventory/clients-final.csv` (1,740 canonical clients), HubSpot companies via `scripts/fetch-hubspot-company-status.mjs`
**HubSpot access:** read-only. One endpoint, `GET /crm/v3/objects/companies`, plus `GET /crm/v3/properties/companies` for the schema. No POST, PATCH, PUT or DELETE.
**HubSpot is a status authority only.** No canonical name was renamed, replaced, or overridden by a HubSpot name.
**Archived here means "not currently engaged."** It is not the 6-year retention line, which governs deletion and is phase 4.

## Headline

| Status | Clients | Share | Files | Size |
|---|---|---|---|---|
| **Live** | 46 | 2.6% | 6,136 | 3.46 GB |
| Archived — matched, not active | 1172 | 67.4% | 42,761 | 30.31 GB |
| Archived — unmatched-default | 522 | 30.0% | 21,828 | 20.04 GB |
| **Total** | **1740** | | **70,725** | **53.82 GB** |

Archived total: **1694** clients, 64,589 files.

> ⚠️ **Read the Live number with the Step 1 caveat in mind.** Only 96 of 13,806 HubSpot companies carry `active = true`. A small Live set is what the data says, not a matching failure.

---

## Step 1 — the fields, confirmed before pulling

`GET /crm/v3/properties/companies` returns **349** company properties. The two that matter:

| Purpose | Property | Label | Type | Values |
|---|---|---|---|---|
| Status | `active` | Active | `enumeration/booleancheckbox`, custom | `true`, `false` |
| Product / tier | `best_fit_product` | Product Type | `enumeration/select`, custom | Granted Pro, Granted Pro Lite, Granted Starter, Get Granted, Nonprofit, Unknown, Not a Fit |

Supporting fields pulled alongside them: `extra6` (Legal Business Name) as an alias source for matching, plus the standard `lifecyclestage` and `type` for cross-checking.

### Fill rates across all 13,806 companies

| Property | Populated | Share |
|---|---|---|
| `name` | 13,436 | 97.3% |
| `active` | 12,782 | 92.6% |
| `best_fit_product` | 12,299 | 89.1% |
| `best_fit_product_company` | 815 | 5.9% |
| `extra6 (Legal Business Name)` | 1,135 | 8.2% |
| `lifecyclestage` | 13,806 | 100.0% |
| `type` | 2,369 | 17.2% |
| `domain` | 6,972 | 50.5% |

**Neither field is mostly empty**, so the pull proceeded. Two things to say plainly anyway:

1. **`active` is populated but overwhelmingly false.** 96 true, 12,686 false, 1,024 empty. Only **0.7%** of companies are marked active. That is not a broken field — the 96 look like real current engagements (69 are lifecycle `customer`, weighted to Granted Pro, created through April 2026). It does mean the Live set is small by construction.
2. **`best_fit_product_company` ("Best Fit Product") is a near-duplicate of `best_fit_product` and is 5.9% populated.** Same seven options, different field. `best_fit_product` at 89.1% is the one to use; the other looks abandoned. Flagging it because picking the wrong one would have emptied Step 6.

---

## The first-rule-wins fix

The previous version returned at the **first rule that produced a hit**, and its preference for an active company only operated *within* that single lookup. An inactive company found by an early rule therefore beat an active company that a later rule would have found.

Now every rule runs, all candidates are collected per client, and the choice is made once at the end: **active first, then the strongest rule.**

**0 clients changed status** since the previous run: 0 into Live, 0 out of Live, 0 newly matched but still archived.

**1 canonicals from the previous run no longer exist** — folded into another canonical by the merges recorded in this pass, not lost. Their files moved with them, which is why the client count falls by 1 while the file total holds.

| Merged-away canonical | Was |
|---|---|
| Elleboxco (Blume) | Archived (unmatched-default) |

### The two known cases

| Case | Status | Matched to | Rule | Evidence |
|---|---|---|---|---|
| Blume (326 files) | **Live** ✅ | Blume | `exact string` | HubSpot name matches the canonical exactly |
| Divert Millwork (3 files) | **Live** ✅ | DML Architectural | `legal-name field` | Legal Business Name "Divert Millwork Ltd." reduces to "divert millwork" |

- **Blume** — HubSpot holds two records, `"Blume"` (inactive, `opportunity`) and `"Blume "` with a trailing space (active, `customer`). Trimming (below) collapses them into one exact-string bucket; preferring active then picks the right one.
- **Divert Millwork** — two inactive companies carry that exact name, while the active `DML Architectural` carries "Divert Millwork Ltd." in its Legal Business Name. Gathering all rules before choosing is what reaches it.

### The active-preference condition

Preferring an active company applies **only when a strong rule found it** — exact string, normalized, legal-suffix stripped, legal-name field, or raw folder name. An active company reached by a *weak* rule (edit distance, token-wise, containment) does not outrank an inactive one reached by a strong rule.

Without that condition, `KAF Consulting` came out Live off `KIS Consulting`, 2 characters away, while its own strong inactive match `KAF Consulting Group` was ignored. With it, KAF Consulting is correctly Archived and the two cases that motivated the fix still hold.

Active-via-strong-rule still overrides a stronger *inactive* rule on **1 client** — this is the intended behaviour, not a side effect:

| Canonical | Files | Chosen (active) | Rule | Beat |
|---|---|---|---|---|
| Divert Millwork | 3 | DML Architectural | `legal-name field` | a stronger inactive match |

✅ **KAF Consulting** is now **Archived** — matched to `KAF Consulting Group` via `legal suffix stripped`.

### Whitespace trimming

**112 company names and 18 legal names had leading or trailing whitespace**, out of 13,806 records. Names are trimmed before any key is built. Without it the exact-string index splits `"Blume"` and `"Blume "` into separate buckets and the active record is unreachable.

### Legal Business Name as a first-class target

Every company with `extra6` populated now contributes a **second searchable entry**, so the legal name is tested by *all* rules rather than only the exact-key lookups. That is 1,135 extra entries on top of 13,436 names.

**51 clients matched through a legal name**, of which 0 were previously unmatched. These are the renames the review flagged:

| Canonical | Files | HubSpot company | Legal Business Name | Status |
|---|---|---|---|---|
| TQ Construction | 275 | T Q Construction | T.Q. Construction Ltd. | Archived |
| Van Bower | 247 | Van Bower Construction Services | Van Bower Group Ltd. | Archived |
| Modern Purair | 229 | Modern PURAIR Inc. Headquarters | Modern PURAIR Inc. | Archived |
| Smith Cameron | 142 | SCG Process (ON) | Smith Cameron Pump Solutions Inc. | Archived |
| Heritage Office | 141 | HOF | Heritage Office Furnishings Ltd. | Archived |
| FMR Management | 114 | Kitchen Table Group | FMR Management Ltd. (DBA Kitchen Table) | Archived |
| Remedi Wellness | 62 | Remedi | Remedi Wellness and Spa Ltd. | Archived |
| Remedi Wellness and Spa Ltd. | 61 | Remedi | Remedi Wellness and Spa Ltd. | Archived |
| Heritage Office Furnishings | 49 | HOF | Heritage Office Furnishings Ltd. | Archived |
| Liz McDonald Consulting | 39 | Cove Coast Studio | Liz McDonald Consulting | Archived |
| CB Process | 36 | CB Process Instrumentation & Controls | CB PROCESS ULC | Archived |
| Cork It Wine | 29 | Cork It Wine Making Ltd. | Cork It Wine Ltd. | Archived |
| Flahr Studio | 28 | Modern PURAIR Franchise (Vernon) | Flahr Studio Ltd | Archived |
| Beacon Collective | 26 | The Beacon Design Collective Inc. | The Beacon Collective | Archived |
| DentX Solutions Inc | 22 | DentX Solutions Inc. (BC) | DentX Solutions Inc. | Archived |
| mQ Consulting | 21 | International Infant Development Centre, Inc. | mQ Consulting | Archived |
| Sangha Tone | 21 | Sangha Tone Chartered Professional Accountants | Sanga Tone Inc. | Archived |
| Ezry Foods Inc. | 19 | Ezry Foods Inc. (DBA It's GUD) | Ezry Foods Inc. | Archived |
| Mendoza Physiotherapist | 18 | Mendoza Physiotherapist Co. (DBA ScoliClinic) | Mendoza Physiotherapist Corp | Archived |
| Space Harmony Interiors Inc. | 17 | Space Harmony | Space Harmony Interiors Inc. | Archived |
| _+31 more_ | | | | |

---

## Steps 3 and 4 — matching

| Tier | Clients | Share |
|---|---|---|
| Exact string on canonical name | 515 | 29.6% |
| Recovered by fuzzy rules | 703 | 40.4% |
| Still unmatched | 522 | 30.0% |
| **Total** | **1740** | |

Step 3 alone matched **515**. The fuzzy pass recovered **703** more, taking coverage from 29.6% to **70.0%**.

### What each rule recovered

| Rule | Recovered | What it catches |
|---|---|---|
| `containment` | 269 | One name sits intact inside the other — usually a DBA or legal entity wrapper |
| `legal suffix stripped` | 230 | `Ltd` / `Inc` / `Corp` / `Co` present on one side only |
| `normalized` | 73 | Case, punctuation, `&` vs `and`, leading `The` |
| `edit distance 1` | 44 | One character apart, scaled to name length |
| `legal-name field` | 35 | Matches HubSpot's `extra6` Legal Business Name rather than its display name |
| `token-wise` | 23 | Same token count, tokens differ by abbreviation, small edit, or shared root |
| `edit distance 2` | 15 | Two characters apart on a name long enough to allow it |
| `raw folder name` | 14 | A raw Dropbox folder name for this client matches, where the canonical did not |

### Evidence — the 20 largest fuzzy matches

| Canonical | Files | HubSpot company | Rule | Evidence |
|---|---|---|---|---|
| Keystone Environmental | 985 | Keystone Environmental Ltd | legal suffix stripped | both reduce to "keystone environmental" |
| Spare Labs | 802 | Spare Labs Inc. | legal suffix stripped | both reduce to "spare labs" |
| SAAM Towage | 651 | SAAM Towage Canada Inc. | containment | "saam towage" sits intact inside it; extra words: "canada" "inc" |
| Taymor Industries | 615 | Taymor Industries Ltd. | legal suffix stripped | both reduce to "taymor industries" |
| Clarus | 556 | Clarus Electric Corp | raw folder name | Dropbox folder "Clarus Electric" matches |
| Native Shoes | 521 | Native Canada Footwear Ltd. (DBA Native Shoes) | containment | "native shoes" sits intact inside it; extra words: "native" "canada" "footwear" "ltd" "dba" |
| Bittered Sling | 507 | Kale & Nori Culinary Arts (DBA Bittered Sling) | containment | "bittered sling" sits intact inside it; extra words: "kale" "and" "nori" "culinary" "arts" "dba" |
| ClearDent | 503 | Prococious Technology Inc. (DBA ClearDent) | raw folder name | Dropbox folder "Prococious Technology Inc. (DBA ClearDent)" matches |
| Creator Co | 443 | Creator | legal suffix stripped | both reduce to "creator" |
| Twin Lions | 393 | Twin Lions Contracting Ltd | containment | "twin lions" sits intact inside it; extra words: "contracting" "ltd" |
| Pearl | 367 | Superprem Industries Ltd (DBA Pearl) | raw folder name | Dropbox folder "Superprem Industries Ltd (DBA Pearl)" matches |
| Major Tom | 304 | Major Tom Inc. | legal suffix stripped | both reduce to "major tom" |
| Coast Spas | 285 | Coast Spas Lifestyles | containment | "coast spas" sits intact inside it; extra words: "lifestyles" |
| TQ Construction | 275 | T Q Construction | legal-name field | Legal Business Name "T.Q. Construction Ltd." reduces to "tq construction" |
| Folklore | 270 | FOLKLIFE | edit distance 2 | 2 characters apart on a 8-character name |
| Fernie Brewing | 269 | Fernie Brewing Company | legal suffix stripped | both reduce to "fernie brewing" |
| PHL Capital | 269 | PHL Capital Corp | legal suffix stripped | both reduce to "phl capital" |
| Atkinson Landscaping | 267 | Atkinson Landscaping lnc | containment | "atkinson landscaping" sits intact inside it; extra words: "lnc" |
| Regehr Contracting Ltd | 260 | Regehr Contracting Ltd. | normalized | both reduce to "regehr contracting ltd" |
| AME Consulting | 253 | AME Consulting Group | legal suffix stripped | both reduce to "ame consulting" |

**204 clients matched more than one HubSpot company.** Where that happened the active record wins, so an ambiguous match can only push a client toward Live, never toward Archived. Erring that way is deliberate: wrongly archiving a current client is the expensive mistake.

---

## Step 5 — status assignment

| Rule | Status | Clients | Files | Size |
|---|---|---|---|---|
| matched and `active = true` | **Live** | 46 | 6,136 | 3.46 GB |
| matched and not active | Archived | 1172 | 42,761 | 30.31 GB |
| unmatched | Archived (`unmatched-default`) | 522 | 21,828 | 20.04 GB |

**30.0% of all clients are archived by default rather than by evidence.** That is the weakest part of this split and Step 7 lists the ones it costs most.

---

## Step 6 — product type across Live clients

Informational only. Nothing is built from this.

| Product Type | Live clients | Share of Live |
|---|---|---|
| Granted Pro | 35 | 76.1% |
| Granted Pro Lite | 4 | 8.7% |
| Get Granted | 3 | 6.5% |
| _(not set)_ | 2 | 4.3% |
| Not a Fit | 1 | 2.2% |
| Granted Starter | 1 | 2.2% |
| **Total** | **46** | |

---

## Step 7 — the 30 largest clients archived by default

These matched no HubSpot company at all, so they were archived on the default rather than on a status. **If the default is wrong, these are the most expensive errors** — worth eyeballing.

| # | Canonical | Files | Size | Raw folder names in Dropbox |
|---|---|---|---|---|
| 1 | Caliber | 1,185 | 0.26 GB | `Caliber`, `Caliber - Nov 2021`, `Caliber - Oct 4th` |
| 2 | Horizon | 780 | 0.43 GB | `Horizon`, `Horizon - not eligible` |
| 3 | Trotman | 664 | 0.19 GB | `Trotman` |
| 4 | Musora | 631 | 0.13 GB | `Musora` |
| 5 | Ledcor | 621 | 0.16 GB | `Ledcor` |
| 6 | Clir | 485 | 0.55 GB | `Clir` |
| 7 | Strategex | 325 | 0.10 GB | `Strategex` |
| 8 | Primex | 308 | 0.14 GB | `Primex` |
| 9 | Solaris | 275 | 0.09 GB | `Solaris` |
| 10 | Stormtec | 270 | 0.07 GB | `Stormtec` |
| 11 | HTC | 264 | 0.06 GB | `HTC` |
| 12 | The Acorn | 259 | 0.38 GB | `The Acorn`, `Acorn`, `The Acorn-Abandoned` |
| 13 | TEC | 257 | 0.04 GB | `TEC (One-Off)`, `TEC`, `Stenberg (TEC)` +1 |
| 14 | AME | 256 | 0.10 GB | `AME` |
| 15 | ChopValue | 241 | 0.87 GB | `ChopValue` |
| 16 | Wakefield | 239 | 0.12 GB | `Wakefield` |
| 17 | Mayne | 233 | 0.06 GB | `Mayne Inc`, `Mayne` |
| 18 | Wise Earth Farms | 230 | 0.05 GB | `Wise Earth Farms`, `Wise Earth Farm` |
| 19 | Scout | 228 | 0.29 GB | `Scout (Megan)`, `Scout 2016` |
| 20 | Organika | 222 | 0.15 GB | `Organika` |
| 21 | Clearwest | 219 | 0.04 GB | `Clearwest` |
| 22 | Lux Quality Homes | 216 | 0.06 GB | `Lux Quality Homes` |
| 23 | Dynamix | 206 | 0.06 GB | `Dynamix` |
| 24 | PLT | 205 | 0.06 GB | `PLT` |
| 25 | Santevia | 186 | 0.76 GB | `Santevia` |
| 26 | Paintillio | 180 | 0.73 GB | `Paintillio` |
| 27 | TAG | 172 | 0.03 GB | `TAG` |
| 28 | FansUnite | 170 | 0.07 GB | `FansUnite` |
| 29 | Magnum | 165 | 0.04 GB | `Magnum` |
| 30 | Greenlight | 164 | 0.04 GB | `Greenlight` |

Those 30 alone hold 9,856 files.

---

## Stem merges applied

Four stem/full-name pairs were merged in `scripts/client-corrections.json` under source `stem merge 2026-08-13`, then the client list was rebuilt. Each stem was re-verified to prefix **exactly one** canonical before writing, so there was no competing claim.

| Stem (was Archived) | Files | Merged into | Files | Combined |
|---|---|---|---|---|
| Keystone | 900 | **Keystone Environmental** | 85 | **985** |
| Taymor | 348 | **Taymor Industries** | 267 | **615** |
| Debrand | 263 | **Debrand Services Inc.** | 43 | **306** |
| Regehr | 205 | **Regehr Contracting Ltd** | 55 | **260** |

All four targets were already Live, so 1,716 files moved from Archived to Live without changing the Live client count.

### Nightingale — held in the stem pass, resolved in this one

The stem pass refused `Nightingale` because it prefixed **two** canonicals, not one: `Nightingale Electrical` (344) and `Nightingale Electric` (16). That ambiguity has now been settled in two stages, as instructed — the two full names merged first, then the bare stem into the result. Combined: **651 files**, and no canonical other than these three ever began with "Nightingale".

---

## Stem vs full name, statuses disagree (13)

**Chris's decision list. Nothing here was merged.** Pairs of canonical clients where one name is a strict prefix of the other and the two landed on different sides of the split. If a pair is one company, the Live side's file count is understated by the Archived side's.

| Live side | Files | Archived side | Files | Files that would move | Stem also prefixes |
|---|---|---|---|---|---|
| Horizon Contracting | 51 | Horizon | 780 | **780** | **4** other canonicals |
| Horizon CPA | 14 | Horizon | 780 | **780** | **4** other canonicals |
| Horizon Contracting Group | 7 | Horizon | 780 | **780** | **4** other canonicals |
| AME Consulting | 253 | AME | 256 | **256** | **3** other canonicals |
| The AME Consulting Group Ltd. | 8 | AME | 256 | **256** | **3** other canonicals |
| Ventana Construction | 119 | Ventana | 154 | **154** | 1 other |
| Seagate Mass Timber | 34 | Seagate | 127 | **127** | 1 other |
| PrairieCoast Equipment | 22 | PrairieCoast | 95 | **95** | 1 other |
| The Sutherland Group | 1 | Sutherland | 87 | **87** | 1 other |
| Haven Apparel | 18 | HAVEN | 39 | **39** | **2** other canonicals |
| Avanti CPA LLP | 6 | Avanti | 27 | **27** | 1 other |
| AndGo Systems | 25 | Andgo | 10 | **10** | 1 other |
| Dynamic Reforestation | 26 | Dynamic | 5 | **5** | 1 other |

Total that would move if every pair were merged: **3,396 files** across 10 archived canonicals.

**Read the last column before deciding.** A stem that also prefixes several other canonicals is probably a common word rather than the same company — `Horizon` heads a family of unrelated businesses. A stem prefixing nothing else is the stronger merge case.

---

## Step 4 — DBA-wrapper review list (39)

A stem canonical sitting **inside** another canonical rather than at its start — the ClearDent and Blume shape. The prefix detector only sees prefixes and the 2-token containment guard blocks the match, so these fall through both. Run across every remaining canonical.

**Nothing here was merged. This is a review list.**

| Stem canonical | Files | Status | Active? | Wrapper canonical | Files | Status | Active? | Shared |
|---|---|---|---|---|---|---|---|---|
| Left Coast Naturals | 724 | Archived | no | Hippie Snacks / Left Coast Naturals | 21 | Archived | no | `left coast naturals` |
| Twin Lions | 393 | Archived | no | TLG Millwerks (Twin Lions) | 4 | Archived | — | `twin lions` |
| Overstory Media Group | 273 | Archived | no | Capital City News / Overstory Media | 159 | Archived | — | `overstory media` |
| Overstory Media Group | 273 | Archived | no | Capital City News Group Ltd. (DBA Overstory Media Inc.) | 5 | Archived | no | `overstory media` |
| Mayne | 233 | Archived | — | Longboard (Previously Mayne Inc) | 91 | Archived | — | `mayne` |
| Jelly Marketing | 135 | Archived | no | JMI Jelly Marketing Inc | 17 | Archived | no | `jelly marketing` |
| AP Insurance | 134 | Archived | no | CF Canada Financial & AP Insurance | 0 | Archived | no | `ap insurance` |
| Left Coast | 119 | Archived | no | Hippie Snacks / Left Coast Naturals | 21 | Archived | no | `left coast` |
| Coastal | 72 | Archived | — | Sunshine Coastal Health | 2 | Archived | — | `coastal` |
| Liquid & Solids | 66 | Archived | — | MRC Liquid & Solids | 1 | Archived | — | `liquid and solids` |
| Jelly | 61 | Archived | — | JMI Jelly Marketing Inc | 17 | Archived | no | `jelly` |
| Millwerks | 50 | Archived | — | TLG Millwerks | 32 | Archived | no | `millwerks` |
| Millwerks | 50 | Archived | — | TLG Millwerks (Twin Lions) | 4 | Archived | — | `millwerks` |
| Kerrisdale Group | 39 | Archived | no | Yaletown and Kerrisdale Dental | 7 | Archived | — | `kerrisdale` |
| Capstone | 35 | Archived | no | Taimuri / Capstone | 21 | Archived | — | `capstone` |
| CF Canada Financial | 28 | Archived | no | AP Insurance (CF Canada Financial) | 46 | Archived | no | `cf canada financial` |
| Overstory | 25 | Archived | — | Capital City News / Overstory Media | 159 | Archived | — | `overstory` |
| Overstory | 25 | Archived | — | Capital City News Group Ltd. (DBA Overstory Media Inc.) | 5 | Archived | no | `overstory` |
| Overstory | 25 | Archived | — | Capital City Overstory | 2 | Archived | — | `overstory` |
| SQBox | 16 | Archived | — | Intranet Connections / SQBox Solutions Ltd. | 57 | Archived | no | `sqbox` |
| Gooseneck | 11 | Archived | — | Lucky Taco (Gooseneck Hospitality) | 7 | Archived | no | `gooseneck` |
| Porter | 11 | Archived | no | Janice Porter | 9 | Archived | no | `porter` |
| Beyond Landscaping | 10 | Archived | — | Great Lawns & Beyond Landscaping | 2 | Archived | — | `beyond landscaping` |
| Bench | 9 | Archived | no | Support Bench | 69 | Archived | no | `bench` |
| Essence | 8 | Archived | — | New Essence Healthcare Services | 2 | Archived | no | `essence` |
| Kerrisdale Dental | 7 | Archived | no | Yaletown and Kerrisdale Dental | 7 | Archived | — | `kerrisdale dental` |
| Kitchen Table Group | 3 | Archived | no | FMR (Kitchen Table Restaurants) | 7 | Archived | — | `kitchen table` |
| McCormick Studio | 2 | Archived | no | Matthew McCormick Studio | 28 | Archived | no | `mccormick studio` |
| Mendoza | 2 | Archived | — | Andrea Mendoza Physiotherapy | 1 | Archived | — | `mendoza` |
| The Education Company | 2 | Archived | no | TEC The Education Company | 24 | Archived | no | `education` |
| The Education Company | 2 | Archived | no | Kueis Education | 9 | Archived | no | `education` |
| The Education Company | 2 | Archived | no | VISM Vancouver International Education Foundation | 6 | Archived | no | `education` |
| The Education Company | 2 | Archived | no | Key Education | 1 | Archived | — | `education` |
| Gooseneck Hospitality | 1 | Archived | no | Lucky Taco (Gooseneck Hospitality) | 7 | Archived | no | `gooseneck hospitality` |
| Katlan | 1 | Archived | — | 1012198 BC Ltd (Katlan) | 23 | Archived | no | `katlan` |
| Kitchen Table | 1 | Archived | no | FMR (Kitchen Table Restaurants) | 7 | Archived | — | `kitchen table` |
| Liquids + Solids | 1 | Archived | — | MRC Liquids + Solids | 7 | Archived | — | `liquids + solids` |
| Ninja Group | 1 | Archived | no | Tree Ninja | 2 | Archived | no | `ninja` |
| Rolla Skate Club | 1 | Archived | no | Girl Gang / Rolla Skate Club | 34 | Archived | — | `rolla skate club` |

0 of 39 straddle the Live/Archived line, which is where a wrong call costs the most.

## Steps 1-3 — identity merges applied

Recorded in `scripts/client-corrections.json` under source `client identity 2026-08-13`, then the client list was rebuilt.

| Canonical kept | Merged from | Combined files | Status now |
|---|---|---|---|
| **ClearDent** | `ClearDent (501)`, `Precocious Technology Inc. (DBA ClearDent) (2)` | 503 | **Live** ✅ |
| **Nightingale Electrical** | `Nightingale Electrical (344)`, `Nightingale Electric (16)`, `Nightingale (291)` | 651 | **Live** ✅ |
| **Blume** | `Blume (309)`, `Blume / Ellebox (13)` | 326 | **Live** ✅ |

- **ClearDent** — One HubSpot record covers both — "Prococious Technology Inc. (DBA ClearDent)", active, domain `cleardent.com`. Canonical kept as **ClearDent**: that is what the GCs call it and where the files are. `Precocious` vs `Prococious` is a typo in one source, not a second company.
- **Nightingale Electrical** — Merged in two stages as instructed: the two full names first (one character apart, both matched the same active HubSpot company), then the bare stem into the result. No canonical other than these three begins with "Nightingale".
- **Blume** — Same shape as ClearDent. The active HubSpot record carries Legal Business Name **"ElleBoxCo Inc."** and domain `blume.com`, so ElleBoxCo is the legal entity and Blume the operating name. The `Blume` canonical already absorbed the raw folder `Blume (Ellebox)`, and **no standalone `Ellebox` canonical exists anywhere in the tree**.

`ClearDent` is **Live**, matched to `Prococious Technology Inc. (DBA ClearDent)` via `raw folder name` (active). Its 503 files moved from Archived to Live.

> ⚠️ **One knock-on to settle.** `scripts/canexport-mapping.mjs` records `blume : ellebox` in its `JOINT` map as a **two-client** folder, to be dual-filed as `Blume` + `Ellebox`. That was a provisional call from the colon triage and it now contradicts this merge. The JOINT map was not edited — out of scope here — but that entry should be removed or it will dual-file a folder belonging to one company.

---

## Reverse check — active companies with no Dropbox folder

Of the 96 companies HubSpot marks active, **39 matched a canonical client and 57 did not.**

That is not alarming on its face: most of the unmatched ones are lifecycle `lead` or `Get Granted` self-serve, who would not have a Grants delivery folder. The ones worth a second look are the `customer` + `Granted Pro` records, which normally would.

| Lifecycle | Companies active but unmatched |
|---|---|
| customer | 34 |
| lead | 22 |
| opportunity | 1 |

### The 2-token containment guard, retained

`Blume` is **Live** with 326 files across 5 raw folder names. Every Blume variant now resolves to this one canonical — no fragment left on the Archived side.

The guard requiring **two or more tokens** in a containment match stays in place. It exists because single-token containment matched `Spring` inside `Admin Slayer - Spring Planning`; relaxing it would reintroduce `Icon` inside `Micon Products` and `home` inside `Lux Quality Homes`. The Step 4 list above is how single-token cases get surfaced instead — detection without letting them match automatically.

---

## What this is not

- **Not a retention decision.** Archived here means "not currently engaged". The 6-year retention line governs deletion and is phase 4. A client can be Archived and still well inside retention.
- **Not a renaming pass.** HubSpot supplied status only. Every canonical name in the output CSV is exactly the name from `clients-final.csv`.
- **Not a mapping.** No file was copied, moved, renamed, or deleted, and nothing was written to Dropbox or Drive.

## Output

`dist/inventory/client-status.csv` — one row per canonical client, 1740 rows, sorted by file count. Columns: canonical_name, status, reason, match_tier, match_rule, hubspot_id, hubspot_name, hubspot_active, product_type, lifecycle, files, bytes, ambiguous_candidates, evidence.

## Reproducing

```bash
node scripts/hubspot-company-schema.mjs        # GET /crm/v3/properties/companies
node scripts/fetch-hubspot-company-status.mjs  # GET /crm/v3/objects/companies (paged)
node scripts/client-status-match.mjs           # local matching, no network
```

