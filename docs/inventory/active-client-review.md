# Active Client Match Review

**Purpose:** confirm the Live set by hand. For each of the 96 active HubSpot companies, every canonical client folder that matches under *any* rule is listed, however weak.
**Inputs:** `dist/inventory/client-status.csv`, `dist/inventory/clients-final.csv`, cached HubSpot pull (`dist/inventory/hubspot-companies-status.json`).
**No network call.** The HubSpot pull was reused from cache — zero API requests in this pass. Nothing was written to HubSpot, Dropbox, or Drive. No match was applied and no canonical name was overridden.

**Loose on purpose.** Weak rules are shown and labelled, never suppressed. Expect false positives; that is the trade.

## Rules, strongest first

| Rule | Strength | Meaning |
|---|---|---|
| `exact` | strong | Identical strings |
| `normalized` | strong | Same after case, punctuation, `&`/`and`, leading `The` |
| `legal suffix stripped` | strong | Same once `Ltd`/`Inc`/`Corp`/`Co` etc. are removed |
| `legal-name field` | strong | Matches HubSpot's `extra6` Legal Business Name |
| `raw folder name` | strong | Matches a raw Dropbox folder name rather than the canonical |
| `edit distance` | weak | Within 1–3 characters, scaled to name length |
| `token-wise` | weak | Same token count; tokens differ by abbreviation, small edit, or shared root |
| `containment` | weak | One name sits inside the other, 2+ tokens |
| `containment (1 token)` | **very weak** | One name sits inside the other, single token — see Step 2 |
| `shared stem` | weak | Same opening token(s), then divergence |
| `substring` | **very weak** | Raw substring either direction, 4+ characters |

## Summary

| List | Active companies | Meaning |
|---|---|---|
| A — confident | 9 | Exactly one candidate, matched by a strong rule |
| B — needs a decision | 43 | Several candidates, or a single weak-rule candidate |
| C — no candidate | 44 | Active in HubSpot, nothing resembling it in the folder tree |
| **Total** | **96** | |

---

## A confirmed error in the current split (2)

Canonicals marked **Archived** in `client-status.csv` that match an **active** HubSpot company under a *strong* rule. These are not judgement calls — the current status contradicts the status field.

| Canonical | Files | Current status | Matched by | Active HubSpot company | Rule |
|---|---|---|---|---|---|
| **Blume** | 309 | Archived (matched, not active) | `Blume` | "Blume " | `normalized` |
| **Divert Millwork** | 3 | Archived (matched, not active) | `Divert Millwork` | "DML Architectural" | `legal-name field` |

**One root cause: the matcher stops at the first rule that hits.** `scripts/client-status-match.mjs` tries exact, then normalized, then legal-suffix, and so on, taking the first rule that returns anything. Its tie-break preferring an active record only operates *within* that one lookup — so an inactive company found by an earlier rule beats an active company that a later rule would have found. Two different flavours of the same bug:

- **Blume** — duplicate HubSpot records differing only by whitespace. `"Blume"` (inactive, lifecycle `opportunity`) and `"Blume "` with a trailing space (active, lifecycle `customer`). Exact-string matched the inactive one; the active duplicate normalizes to the same key but was never reached.
- **Divert Millwork** — exact-name matched an inactive company of that name, while the active company `DML Architectural` carries "Divert Millwork" in its Legal Business Name field. The `legal-name field` rule runs later, so it never got a look.

The fix is to gather candidates from every rule before choosing, then prefer an active one. **Not applied here** — this pass produces a list to confirm, and `scripts/client-status-match.mjs` is unchanged.

---

## Step 2 — dropping the 2-token containment guard

The guard was added in the Strategy Reports pass because single-token containment matched `Spring` inside `Admin Slayer - Spring Planning`. It is correct there. It also hid `Blume`, which is active and does have folders. Dropped **for this pass only** — `scripts/client-status-match.mjs` is unchanged.

**25 active companies gained at least one candidate** they would not otherwise have. All are low precision by construction — a single shared word.

| HubSpot company | Newly surfaced canonical | Files | Evidence |
|---|---|---|---|
| Ventana Construction | Ventana | 154 | "ventana" sits inside it; extra: "construction" — single-token, low precision |
| AME Consulting Group | AME | 256 | "ame" sits inside it; extra: "consulting" "group" — single-token, low precision |
| AME Consulting Group | AME Group | 112 | "ame" sits inside it; extra: "consulting" — single-token, low precision |
| PrairieCoast Equipment Inc | PrairieCoast | 95 | "prairiecoast" sits inside it; extra: "equipment" "inc" — single-token, low precision |
| Blume  | Blume / Ellebox | 13 | "blume" sits inside it; extra: "ellebox" — single-token, low precision |
| Blume  | Elleboxco (Blume) | 4 | "blume" sits inside it; extra: "elleboxco" — single-token, low precision |
| Debrand Services Inc. | Debrand | 263 | "debrand" sits inside it; extra: "services" "inc" — single-token, low precision |
| Seagate Mass Timber Inc. | Seagate | 127 | "seagate" sits inside it; extra: "mass" "timber" "inc" — single-token, low precision |
| Folklore Contracting Ltd | Folklore | 270 | "folklore" sits inside it; extra: "contracting" "ltd" — single-token, low precision |
| Haven Apparel Inc | HAVEN | 39 | "haven" sits inside it; extra: "apparel" "inc" — single-token, low precision |
| Regehr Contracting Ltd. | Regehr | 205 | "regehr" sits inside it; extra: "contracting" "ltd" — single-token, low precision |
| Nightingale Electrical | Nightingale | 291 | "nightingale" sits inside it; extra: "electrical" — single-token, low precision |
| Horizon CPA | Horizon | 780 | "horizon" sits inside it; extra: "cpa" — single-token, low precision |
| VGC Vancouver General Contractors | VGC | 14 | "vgc" sits inside it; extra: "vancouver" "general" "contractors" — single-token, low precision |
| Prococious Technology Inc. (DBA ClearDent) | ClearDent | 501 | "cleardent" sits inside it; extra: "prococious" "technology" "inc" "dba" — single-token, low precision |
| WREN - Women's Real Estate Network | WREN | 4 | "wren" sits inside it; extra: "womens" "real" "estate" "network" — single-token, low precision |
| Avanti CPA LLP | Avanti | 27 | "avanti" sits inside it; extra: "cpa" "llp" — single-token, low precision |
| Horizon Contracting Group | Horizon | 780 | "horizon" sits inside it; extra: "contracting" "group" — single-token, low precision |
| Andgo Systems | Andgo | 10 | "andgo" sits inside it; extra: "systems" — single-token, low precision |
| Sutherland Group of Companies | Sutherland | 87 | "sutherland" sits inside it; extra: "group" "of" "companies" — single-token, low precision |
| Peterson Commercial Property Management Inc. | Peterson | 150 | "peterson" sits inside it; extra: "commercial" "property" "management" "inc" — single-token, low precision |
| Peterson Investment Group Inc (PIGI) | Peterson | 150 | "peterson" sits inside it; extra: "investment" "group" "inc" "pigi" — single-token, low precision |
| Dynamic Reforestation Ltd | Dynamic | 5 | "dynamic" sits inside it; extra: "reforestation" "ltd" — single-token, low precision |
| Taymor Industries Ltd.  | Taymor | 348 | "taymor" sits inside it; extra: "industries" "ltd" — single-token, low precision |
| Dynamic Reforestation | Dynamic | 5 | "dynamic" sits inside it; extra: "reforestation" — single-token, low precision |
| Cedarline Industries | Cedarline | 3 | "cedarline" sits inside it; extra: "industries" — single-token, low precision |
| Keystone Environmental Ltd | Keystone | 900 | "keystone" sits inside it; extra: "environmental" "ltd" — single-token, low precision |

✅ **`Blume` is recovered** — the case that motivated dropping the guard.

---

## List A — confident (9)

One candidate, strong rule. Still worth a glance, but no decision expected.

| HubSpot company | Lifecycle | Product | Canonical | Files | Rule | Evidence |
|---|---|---|---|---|---|---|
| More Than Just Feed Inc. | customer | Granted Pro | More Than Just Feed | 130 | `legal suffix stripped` | both reduce to "more than just feed" |
| Tradable Bits | customer | Granted Pro | Tradable Bits | 162 | `exact` | identical strings |
| Top Intl Group | lead | Get Granted | Top International | 4 | `raw folder name` | Dropbox folder "Top Intl." matches |
| Steve Marshall Group | customer | Granted Starter | Steve Marshall Group | 2 | `exact` | identical strings |
| Cultivated Food Labs | customer | Granted Pro | Cultivated Food Labs | 7 | `exact` | identical strings |
| Zanzibar Holdings Ltd | customer | Granted Pro | Zanzibar Holdings | 10 | `legal suffix stripped` | both reduce to "zanzibar" |
| High Country Cold Storage Ltd | customer | Granted Pro | High Country Cold Storage Ltd | 1 | `exact` | identical strings |
| Zanzibar Holdings | lead | — | Zanzibar Holdings | 10 | `exact` | identical strings |
| Hive Naturals | customer | Granted Pro | Hive Naturals | 67 | `exact` | identical strings |

---

## List B — needs a decision (43)

Several candidates, or one candidate found only by a weak rule. Write `yes`, `no`, or `?` in the Confirm column.

**Ventana Construction** — lifecycle `customer`, product `Granted Pro Lite`, legal name "Ventana Construction Corporation"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Ventana Construction | 119 | Live | `exact` | identical strings |  |
| Ventana | 154 | Archived | `containment (1 token)` | "ventana" sits inside it; extra: "construction" — single-token, low precision |  |

**AME Consulting Group** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| AME Consulting | 253 | Live | `legal suffix stripped` | both reduce to "ame consulting" |  |
| The AME Consulting Group Ltd. | 8 | Live | `legal suffix stripped` | both reduce to "ame consulting" |  |
| AME | 256 | Archived | `containment (1 token)` | "ame" sits inside it; extra: "consulting" "group" — single-token, low precision |  |
| AME Group | 112 | Archived | `containment (1 token)` | "ame" sits inside it; extra: "consulting" — single-token, low precision |  |

**SAAM Towage Canada Inc.** — lifecycle `customer`, product `Granted Pro`, legal name "SAAM Towage Canada Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| SAAM Towage | 651 | Live | `containment` | "saam towage" sits inside it; extra: "canada" "inc" |  |

**PrairieCoast Equipment Inc** — lifecycle `customer`, product `Granted Pro`, legal name "PrairieCoast Equipment Inc. "

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| PrairieCoast Equipment | 22 | Live | `legal suffix stripped` | both reduce to "prairiecoast equipment" |  |
| PrairieCoast | 95 | Archived | `containment (1 token)` | "prairiecoast" sits inside it; extra: "equipment" "inc" — single-token, low precision |  |

**Nova Pacific** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Nova Pacific | 140 | Live | `exact` | identical strings |  |
| Nova Pacific Environmental | 31 | Live | `containment` | "nova pacific" sits inside it; extra: "environmental" |  |

**Wild Creek Corporation (DBA Noble Premium Bison)** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Wild Creek | 20 | Live | `containment` | "wild creek" sits inside it; extra: "corporation" "dba" "noble" "premium" "bison" |  |

**Blume ** — lifecycle `customer`, product `Not a Fit`, legal name "ElleBoxCo Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Blume | 309 | Archived | `normalized` | both reduce to "blume" |  |
| Blume / Ellebox | 13 | Archived | `containment (1 token)` | "blume" sits inside it; extra: "ellebox" — single-token, low precision |  |
| Elleboxco (Blume) | 4 | Archived | `containment (1 token)` | "blume" sits inside it; extra: "elleboxco" — single-token, low precision |  |

**Pacific Solutions Contracting Ltd.** — lifecycle `customer`, product `Granted Pro`, legal name "Pacific Solutions Contracting Ltd."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Pacific Solutions Contracting | 72 | Live | `legal suffix stripped` | both reduce to "pacific solutions contracting" |  |
| Pacific Solutions | 21 | Live | `containment` | "pacific solutions" sits inside it; extra: "contracting" "ltd" |  |
| Pacific Coast Community College | 22 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "coast community college") |  |
| Pacific Bottle Works | 14 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "bottle works") |  |
| Pacific Angler | 8 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "angler") |  |
| Pacific Forensic | 8 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "forensic") |  |
| Pacific Restaurant Supply | 7 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "restaurant supply") |  |
| Pacific Industrial Movers | 5 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "industrial movers") |  |
| The Pacific Forensic Mental Health Practice | 3 | Archived | `shared stem` | both begin "pacific", then diverge ("solutions contracting" vs "forensic mental health practice") |  |

**Debrand Services Inc.** — lifecycle `customer`, product `Granted Pro`, legal name "Debrand Services Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Debrand Services Inc. | 43 | Live | `exact` | identical strings |  |
| Debrand | 263 | Archived | `containment (1 token)` | "debrand" sits inside it; extra: "services" "inc" — single-token, low precision |  |

**Glass Canvas** — lifecycle `customer`, product `Granted Pro`, legal name "GLASS CANVAS MEDIA INC DBA TILMA"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Glass Canvas | 234 | Live | `exact` | identical strings |  |
| GlassCanvas | 14 | Live | `edit distance` | 1 char apart on a 11-char name |  |

**Seagate Mass Timber Inc.** — lifecycle `customer`, product `Granted Pro`, legal name "Seagate Mass Timber Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Seagate Mass Timber | 34 | Live | `legal suffix stripped` | both reduce to "seagate mass timber" |  |
| Seagate | 127 | Archived | `containment (1 token)` | "seagate" sits inside it; extra: "mass" "timber" "inc" — single-token, low precision |  |

**Fine Choice Foods** — lifecycle `customer`, product `Granted Pro Lite`, legal name "Fine Choice Foods Ltd."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Fine Choice Foods | 200 | Live | `exact` | identical strings |  |
| Fine Balance Yoga | 51 | Archived | `shared stem` | both begin "fine", then diverge ("choice foods" vs "balance yoga") |  |

**Jack 59** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Jack59 | 12 | Live | `edit distance` | 1 char apart on a 6-char name |  |
| Jack Cewe Construction | 102 | Archived | `shared stem` | both begin "jack", then diverge ("59" vs "cewe construction") |  |

**Folklore Contracting Ltd** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Folklore | 270 | Archived | `containment (1 token)` | "folklore" sits inside it; extra: "contracting" "ltd" — single-token, low precision |  |

**Haven Apparel Inc** — lifecycle `customer`, product `Granted Pro`, legal name "Haven Apparel Inc"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Haven Apparel | 18 | Live | `legal suffix stripped` | both reduce to "haven apparel" |  |
| HAVEN | 39 | Archived | `containment (1 token)` | "haven" sits inside it; extra: "apparel" "inc" — single-token, low precision |  |
| Haven Kitchen + Bar | 6 | Archived | `shared stem` | both begin "haven", then diverge ("apparel" vs "kitchen + bar") |  |

**Regehr Contracting Ltd.** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Regehr Contracting Ltd | 55 | Live | `normalized` | both reduce to "regehr contracting ltd" |  |
| Regehr | 205 | Archived | `containment (1 token)` | "regehr" sits inside it; extra: "contracting" "ltd" — single-token, low precision |  |

**Nightingale Electrical** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Nightingale Electrical | 344 | Live | `exact` | identical strings |  |
| Nightingale Electric | 16 | Live | `edit distance` | 2 chars apart on a 20-char name |  |
| Nightingale | 291 | Archived | `containment (1 token)` | "nightingale" sits inside it; extra: "electrical" — single-token, low precision |  |

**Kelowna Software Ltd** — lifecycle `opportunity`, product `Get Granted`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Kelowna Arctic Spas | 5 | Archived | `shared stem` | both begin "kelowna", then diverge ("software" vs "arctic spas") |  |

**Horizon CPA** — lifecycle `lead`, product `Get Granted`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Horizon CPA | 14 | Live | `exact` | identical strings |  |
| Horizon | 780 | Archived | `containment (1 token)` | "horizon" sits inside it; extra: "cpa" — single-token, low precision |  |
| Horizon Contracting | 51 | Live | `shared stem` | both begin "horizon", then diverge ("cpa" vs "contracting") |  |
| Horizon Planners | 12 | Archived | `shared stem` | both begin "horizon", then diverge ("cpa" vs "planners") |  |
| Horizon Contracting Group | 7 | Live | `shared stem` | both begin "horizon", then diverge ("cpa" vs "contracting") |  |

**VGC Vancouver General Contractors** — lifecycle `customer`, product `Get Granted`, legal name "VGC Vancouver General Contractors Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Vancouver General Contractors | 22 | Live | `containment` | "vancouver general contractors" sits inside it; extra: "vgc" |  |
| VGC | 14 | Archived | `containment (1 token)` | "vgc" sits inside it; extra: "vancouver" "general" "contractors" — single-token, low precision |  |

**Prococious Technology Inc. (DBA ClearDent)** — lifecycle `customer`, product `Granted Pro Lite`, legal name "Prococious Technology Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Precocious Technology Inc. (DBA ClearDent) | 2 | Live | `raw folder name` | Dropbox folder "Prococious Technology Inc. (DBA ClearDent)" matches |  |
| ClearDent | 501 | Archived | `containment (1 token)` | "cleardent" sits inside it; extra: "prococious" "technology" "inc" "dba" — single-token, low precision |  |

**Black Business Association of BC** — lifecycle `lead`, product `Get Granted`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Black Bird Interactive | 51 | Archived | `shared stem` | both begin "black", then diverge ("business association of bc" vs "bird interactive") |  |
| Black Tie | 50 | Archived | `shared stem` | both begin "black", then diverge ("business association of bc" vs "tie") |  |
| Black Tie Property | 31 | Archived | `shared stem` | both begin "black", then diverge ("business association of bc" vs "tie property") |  |
| Black Tie Property Services | 16 | Archived | `shared stem` | both begin "black", then diverge ("business association of bc" vs "tie property services") |  |
| Black & White Zebra | 1 | Archived | `shared stem` | both begin "black", then diverge ("business association of bc" vs "and white zebra") |  |

**WREN - Women's Real Estate Network** — lifecycle `customer`, product `Granted Starter`, legal name "Women's Real Estate Network"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| WREN | 4 | Archived | `containment (1 token)` | "wren" sits inside it; extra: "womens" "real" "estate" "network" — single-token, low precision |  |

**Avanti CPA LLP** — lifecycle `customer`, product `Granted Pro`, legal name "Avanti CPA LLP"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Avanti CPA LLP | 6 | Live | `exact` | identical strings |  |
| Avanti | 27 | Archived | `containment (1 token)` | "avanti" sits inside it; extra: "cpa" "llp" — single-token, low precision |  |

**Horizon Contracting Group** — lifecycle `customer`, product `Granted Pro`, legal name "Horizon Landscape Contractors LTD"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Horizon Contracting Group | 7 | Live | `exact` | identical strings |  |
| Horizon Contracting | 51 | Live | `legal suffix stripped` | both reduce to "horizon contracting" |  |
| Horizon | 780 | Archived | `containment (1 token)` | "horizon" sits inside it; extra: "contracting" "group" — single-token, low precision |  |
| Horizon CPA | 14 | Live | `shared stem` | both begin "horizon", then diverge ("contracting" vs "cpa") |  |
| Horizon Planners | 12 | Archived | `shared stem` | both begin "horizon", then diverge ("contracting" vs "planners") |  |

**KIS Consulting** — lifecycle `lead`, product `Get Granted`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| AME Consulting | 253 | Live | `edit distance` | 3 chars apart on a 14-char name |  |
| mQ Consulting | 21 | Archived | `edit distance` | 3 chars apart on a 13-char name |  |
| AJK Consulting | 10 | Archived | `edit distance` | 3 chars apart on a 14-char name |  |
| KAF Consulting | 4 | Archived | `edit distance` | 2 chars apart on a 14-char name |  |

**Sterling IAQ Consultants Ltd** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Sterling IAQ Consultants Ltd | 8 | Live | `exact` | identical strings |  |
| Sterling IAQ | 1 | Live | `containment` | "sterling iaq" sits inside it; extra: "consultants" "ltd" |  |
| Sterling Cooper | 51 | Archived | `shared stem` | both begin "sterling", then diverge ("iaq consultants" vs "cooper") |  |
| Sterling Fleet | 31 | Archived | `shared stem` | both begin "sterling", then diverge ("iaq consultants" vs "fleet") |  |
| Sterling Fleet Outfitters | 21 | Archived | `shared stem` | both begin "sterling", then diverge ("iaq consultants" vs "fleet outfitters") |  |
| Sterling Cooper-NDY | 11 | Archived | `shared stem` | both begin "sterling", then diverge ("iaq consultants" vs "cooper ndy") |  |

**Andgo Systems** — lifecycle `customer`, product `Granted Pro`, legal name "Andgo Systems Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| AndGo Systems | 25 | Live | `normalized` | both reduce to "andgo systems" |  |
| Andgo | 10 | Archived | `containment (1 token)` | "andgo" sits inside it; extra: "systems" — single-token, low precision |  |

**Sutherland Group of Companies** — lifecycle `customer`, product `Granted Pro`, legal name "Sutherland Group of Companies"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| The Sutherland Group | 1 | Live | `containment` | "sutherland group" sits inside it; extra: "of" "companies" |  |
| Sutherland | 87 | Archived | `containment (1 token)` | "sutherland" sits inside it; extra: "group" "of" "companies" — single-token, low precision |  |

**Peterson Commercial Property Management Inc.** — lifecycle `customer`, product `Granted Pro`, legal name "Peterson Commercial Property Management Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Peterson | 150 | Archived | `containment (1 token)` | "peterson" sits inside it; extra: "commercial" "property" "management" "inc" — single-token, low precision |  |

**49th Parallel Coffee Roasters** — lifecycle `customer`, product `Granted Pro`, legal name "49th Parallel Coffee Roasters"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| 49th Parallel | 59 | Live | `containment` | "49th parallel" sits inside it; extra: "coffee" "roasters" |  |

**Vista Railing Systems Inc** — lifecycle `customer`, product `Granted Pro`, legal name "Vista Railing Systems Inc."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Vista Railings | 4 | Archived | `shared stem` | both begin "vista", then diverge ("railing systems" vs "railings") |  |

**Maple Reinders** — lifecycle `customer`, product `Granted Pro`, legal name "Maple Reinders Constructors Ltd."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Maple Reinders | 26 | Live | `exact` | identical strings |  |
| Maple Organics | 30 | Archived | `shared stem` | both begin "maple", then diverge ("reinders" vs "organics") |  |
| Maple Roch | 3 | Archived | `shared stem` | both begin "maple", then diverge ("reinders" vs "roch") |  |

**Peterson Investment Group Inc (PIGI)** — lifecycle `customer`, product `Granted Pro`, legal name "Peterson Investment Group Inc (PIGI)"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Peterson | 150 | Archived | `containment (1 token)` | "peterson" sits inside it; extra: "investment" "group" "inc" "pigi" — single-token, low precision |  |

**Arbutus Grove Nursery Ltd** — lifecycle `customer`, product `Granted Pro`, legal name "Arbutus Grove Nursery Ltd."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Arbutus Financial | 1 | Archived | `shared stem` | both begin "arbutus", then diverge ("grove nursery" vs "financial") |  |

**Dynamic Reforestation Ltd** — lifecycle `customer`, product `Granted Pro`, legal name "Dynamic Reforestation Ltd"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Dynamic Reforestation | 26 | Live | `legal suffix stripped` | both reduce to "dynamic reforestation" |  |
| Dynamic | 5 | Archived | `containment (1 token)` | "dynamic" sits inside it; extra: "reforestation" "ltd" — single-token, low precision |  |

**Taymor Industries Ltd. ** — lifecycle `customer`, product `Granted Pro`, legal name "Taymor Industries Ltd."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Taymor Industries | 267 | Live | `legal suffix stripped` | both reduce to "taymor industries" |  |
| Taymor | 348 | Archived | `containment (1 token)` | "taymor" sits inside it; extra: "industries" "ltd" — single-token, low precision |  |

**Micon Products Ltd** — lifecycle `customer`, product `Granted Pro`, legal name "Micon Products Ltd"

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Icon | 18 | Archived | `substring` | "icon" appears inside "micon products" |  |

**Dynamic Reforestation** — lifecycle `lead`, product `—`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Dynamic Reforestation | 26 | Live | `exact` | identical strings |  |
| Dynamic | 5 | Archived | `containment (1 token)` | "dynamic" sits inside it; extra: "reforestation" — single-token, low precision |  |

**DML Architectural** — lifecycle `customer`, product `Granted Pro`, legal name "Divert Millwork Ltd."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| DML Architectural | 8 | Live | `exact` | identical strings |  |
| Divert Millwork | 3 | Archived | `legal-name field` | HubSpot Legal Business Name "Divert Millwork Ltd." matches |  |

**Rice and Noodle** — lifecycle `customer`, product `Granted Pro Lite`, legal name "RNN FOOD SUPPLY LTD."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Rice and Noodles | 1 | Live | `edit distance` | 1 char apart on a 15-char name |  |

**Cedarline Industries** — lifecycle `customer`, product `Granted Pro`, legal name "CEDARLINE INDUSTRIES LTD."

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Cedarline | 3 | Archived | `containment (1 token)` | "cedarline" sits inside it; extra: "industries" — single-token, low precision |  |

**Keystone Environmental Ltd** — lifecycle `customer`, product `Granted Pro`

| Canonical candidate | Files | Current status | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|
| Keystone Environmental | 85 | Live | `legal suffix stripped` | both reduce to "keystone environmental" |  |
| Keystone | 900 | Archived | `containment (1 token)` | "keystone" sits inside it; extra: "environmental" "ltd" — single-token, low precision |  |

---

## List C — no candidate at all (44)

Active in HubSpot; nothing in the folder tree resembles them under any rule, including plain substring. Most are `lead` — a prospect with no delivery folder yet is expected. `customer` rows are the ones worth a second look.

| HubSpot company | Lifecycle | Product | Legal name |
|---|---|---|---|
| 12107341 canada inc. | customer | Granted Starter | 12107341 canada inc |
| Ampco Manufacturers Inc. | customer | Granted Pro | — |
| BC Eco Industrial Services Ltd. | customer | Granted Pro | BC Eco Industrial Services |
| Blend Projects | customer | Granted Pro | — |
| Burnaby Blacktop Ltd | customer | Granted Pro | BC0882604 |
| Cariboo Carbon Solutions Ltd | customer | Granted Pro | Cariboo Carbon Solutions Ltd |
| Galaxy Plastics  | customer | Granted Pro | Galaxy Plastics Ltd. |
| Gladius Partners | customer | Granted Pro | — |
| Innovative Parts & Solutions | customer | Granted Pro | Micon Products Ltd. |
| K.C. Drilling and Blasting Ltd. | customer | Granted Starter | KC Drilling & Blasting |
| Magnus Massage Therapy Corporation | customer | Granted Starter | — |
| Nicely Made Foods | customer | Granted Pro Lite | Nicely Made Foods Inc. |
| No Bev | customer | Granted Starter | — |
| Nor-Van Cable & Marine Supplies (1975) Ltd | customer | Granted Pro | Nor-Van Cable & Marine Supplies (1975) Ltd |
| Pazmac | customer | Granted Pro | — |
| PNP Pharmaceuticals | customer | Granted Pro | PNP Pharmaceuticals Inc. |
| Portofino Bakery | customer | Granted Pro | Portofino Bakery Ltd. |
| Rhema Health Products Limited | customer | Granted Starter | — |
| Sutco Contracting Ltd. | customer | Granted Starter | Sutco Transportation Specialists |
| SynergyAspen Environmental | customer | Get Granted | — |
| The Institute of Communication Agencies | customer | Granted Starter | — |
| Valkerie Growth Consulting Inc. | customer | Granted Pro | Valkerie Growth Consulting Inc. |
| Vericatch Solutions Inc. | customer | Granted Pro | — |
| Yeshi | customer | Granted Pro | Yeshi Foods |
| 9432 2195 QC inc. | lead | Get Granted | — |
| Astro Dental Art | lead | Get Granted | — |
| BC Ecopaving | lead | Get Granted | — |
| Codeco Nutrition | lead | Get Granted | — |
| Cooks Who Feed Inc. | lead | Get Granted | — |
| Dom Productions Inc. | lead | Get Granted | — |
| EcoSafe Zero Waste Inc.  | lead | Get Granted | — |
| ENTAX | lead | Get Granted | — |
| Entreflow Consulting Group | lead | Get Granted | — |
| Ever Sick Ink Tattoos and Piercings  | lead | Get Granted | — |
| Helius Originals LTD. | lead | Get Granted | — |
| LYP Program | lead | Get Granted | — |
| Nature Bee | lead | Get Granted | — |
| Saskatchewan Research Council | lead | Get Granted | — |
| Tao Day Spa Ltd. | lead | Get Granted | — |
| The Cove Indoor Play | lead | Granted Starter | — |
| VCRC | lead | Get Granted | — |
| WACADS Group Inc. | lead | Get Granted | — |
| Wanye Enterprises | lead | Get Granted | — |
| YAJU INC. | lead | Get Granted | — |

| Lifecycle | Count |
|---|---|
| customer | 24 |
| lead | 20 |

---

## Step 4 — the 30 largest clients archived by default

The reverse direction: for each, every plausible HubSpot company under the same loose rules, **active or not**. The `Active?` column is what decides whether a confirmed match changes the client to Live.

**Caliber** — 1,185 files, 0.26 GB. Dropbox folders: `Caliber`, `Caliber - Nov 2021`, `Caliber - Oct 4th`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Caliber Projects Ltd. | no | customer | Granted Pro | `containment (1 token)` | "caliber" sits inside it; extra: "projects" "ltd" — single-token, low precision |  |

**Horizon** — 780 files, 0.43 GB. Dropbox folders: `Horizon`, `Horizon - not eligible`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Horizon CPA | **yes** | lead | Get Granted | `containment (1 token)` | "horizon" sits inside it; extra: "cpa" — single-token, low precision |  |
| Horizon Contracting Group | **yes** | customer | Granted Pro | `containment (1 token)` | "horizon" sits inside it; extra: "contracting" "group" — single-token, low precision |  |
| Horizon Chartered Professional Accountants | no | customer | Get Granted | `containment (1 token)` | "horizon" sits inside it; extra: "chartered" "professional" "accountants" — single-token, low precision |  |
| Horizon Chartered Accountants | no | lead | Granted Starter | `containment (1 token)` | "horizon" sits inside it; extra: "chartered" "accountants" — single-token, low precision |  |
| horizon eco builders | no | lead | Get Granted | `containment (1 token)` | "horizon" sits inside it; extra: "eco" "builders" — single-token, low precision |  |
| Above the Horizon Wellness | no | lead | Granted Starter | `containment (1 token)` | "horizon" sits inside it; extra: "above" "the" "wellness" — single-token, low precision |  |
| Horizon Landscape | no | lead | Granted Pro | `containment (1 token)` | "horizon" sits inside it; extra: "landscape" — single-token, low precision |  |
| horizonor.com | no | opportunity | Granted Starter | `substring` | "horizon" appears inside "horizonorcom" |  |

**Trotman** — 664 files, 0.19 GB. Dropbox folders: `Trotman`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Trotman Auto Group | no | customer | Granted Pro | `containment (1 token)` | "trotman" sits inside it; extra: "auto" "group" — single-token, low precision |  |

**Musora** — 631 files, 0.13 GB. Dropbox folders: `Musora`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Musora Media Inc. | no | customer | Granted Pro | `containment (1 token)` | "musora" sits inside it; extra: "media" "inc" — single-token, low precision |  |

**Ledcor** — 621 files, 0.16 GB. Dropbox folders: `Ledcor`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Ledcor Industries Inc. | no | customer | Granted Pro | `containment (1 token)` | "ledcor" sits inside it; extra: "industries" "inc" — single-token, low precision |  |

**ClearDent** — 501 files, 0.18 GB. Dropbox folders: `ClearDent`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Prococious Technology Inc. (DBA ClearDent) | **yes** | customer | Granted Pro Lite | `containment (1 token)` | "cleardent" sits inside it; extra: "prococious" "technology" "inc" "dba" — single-token, low precision |  |

**Clir** — 485 files, 0.55 GB. Dropbox folders: `Clir`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Clir Renewables Inc. | no | customer | Granted Pro | `containment (1 token)` | "clir" sits inside it; extra: "renewables" "inc" — single-token, low precision |  |

**Taymor** — 348 files, 0.07 GB. Dropbox folders: `Taymor`, `Taymor (1)`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Taymor Industries Ltd.  | **yes** | customer | Granted Pro | `containment (1 token)` | "taymor" sits inside it; extra: "industries" "ltd" — single-token, low precision |  |

**Strategex** — 325 files, 0.10 GB. Dropbox folders: `Strategex`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Strategex CPA LLP | no | customer | Granted Pro | `containment (1 token)` | "strategex" sits inside it; extra: "cpa" "llp" — single-token, low precision |  |

**Primex** — 308 files, 0.14 GB. Dropbox folders: `Primex`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Primex Manufacturing Ltd. | no | customer | Granted Pro | `containment (1 token)` | "primex" sits inside it; extra: "manufacturing" "ltd" — single-token, low precision |  |
| PrimeX Global Agency | no | lead | — | `containment (1 token)` | "primex" sits inside it; extra: "global" "agency" — single-token, low precision |  |

**Nightingale** — 291 files, 0.06 GB. Dropbox folders: `Nightingale`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Nightingale Electrical | **yes** | customer | Granted Pro | `containment (1 token)` | "nightingale" sits inside it; extra: "electrical" — single-token, low precision |  |

**Solaris** — 275 files, 0.09 GB. Dropbox folders: `Solaris`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Solaris Management Consultants Inc | no | customer | Granted Pro | `containment (1 token)` | "solaris" sits inside it; extra: "management" "consultants" "inc" — single-token, low precision |  |

**Stormtec** — 270 files, 0.07 GB. Dropbox folders: `Stormtec`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Stormtec Water Filtration Inc. | no | customer | Granted Pro | `containment (1 token)` | "stormtec" sits inside it; extra: "water" "filtration" "inc" — single-token, low precision |  |

**HTC** — 264 files, 0.06 GB. Dropbox folders: `HTC`

_No HubSpot company matches under any rule._

**Debrand** — 263 files, 0.53 GB. Dropbox folders: `Debrand`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Debrand Services Inc. | **yes** | customer | Granted Pro | `containment (1 token)` | "debrand" sits inside it; extra: "services" "inc" — single-token, low precision |  |
| Cassandra Hildebrand Counselling Inc. | no | lead | Get Granted | `substring` | "debrand" appears inside "cassandra hildebrand counselling" |  |

**The Acorn** — 259 files, 0.38 GB. Dropbox folders: `The Acorn`, `Acorn`, `The Acorn-Abandoned`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| The Acorn Restaurant Ltd. | no | customer | Granted Pro | `containment (1 token)` | "acorn" sits inside it; extra: "restaurant" "ltd" — single-token, low precision |  |
| Acorn Interactive | no | opportunity | Get Granted | `containment (1 token)` | "acorn" sits inside it; extra: "interactive" — single-token, low precision |  |

**TEC** — 257 files, 0.04 GB. Dropbox folders: `TEC (One-Off)`, `TEC`, `Stenberg (TEC)`, `TEC - Stenberg College`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| The Executive Committee (TEC) Canada | no | lead | Granted Pro | `containment (1 token)` | "tec" sits inside it; extra: "executive" "committee" "canada" — single-token, low precision |  |
| TEC The Education Company | no | customer | Granted Pro | `containment (1 token)` | "tec" sits inside it; extra: "the" "education" "company" — single-token, low precision |  |
| TEC Canada - The Executive Committee | no | customer | Granted Pro | `containment (1 token)` | "tec" sits inside it; extra: "canada" "the" "executive" "committee" — single-token, low precision |  |
| Castus TEC | no | lead | Get Granted | `containment (1 token)` | "tec" sits inside it; extra: "castus" — single-token, low precision |  |
| Tec Canada | no | lead | Get Granted | `containment (1 token)` | "tec" sits inside it; extra: "canada" — single-token, low precision |  |

**AME** — 256 files, 0.10 GB. Dropbox folders: `AME`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| AME Consulting Group | **yes** | customer | Granted Pro | `containment (1 token)` | "ame" sits inside it; extra: "consulting" "group" — single-token, low precision |  |

**ChopValue** — 241 files, 0.87 GB. Dropbox folders: `ChopValue`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| ChopValue Manufacturing Ltd. | no | customer | Granted Pro | `containment (1 token)` | "chopvalue" sits inside it; extra: "manufacturing" "ltd" — single-token, low precision |  |
| ChopValue YYC | no | lead | Granted Starter | `containment (1 token)` | "chopvalue" sits inside it; extra: "yyc" — single-token, low precision |  |
| ChopValue Toronto | no | lead | Granted Starter | `containment (1 token)` | "chopvalue" sits inside it; extra: "toronto" — single-token, low precision |  |

**Wakefield** — 239 files, 0.12 GB. Dropbox folders: `Wakefield`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Wakefield Productions Inc. | no | customer | Granted Starter | `containment (1 token)` | "wakefield" sits inside it; extra: "productions" "inc" — single-token, low precision |  |

**Mayne** — 233 files, 0.06 GB. Dropbox folders: `Mayne Inc`, `Mayne`

_No HubSpot company matches under any rule._

**Wise Earth Farms** — 230 files, 0.05 GB. Dropbox folders: `Wise Earth Farms`, `Wise Earth Farm`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Earth Group | no | customer | Granted Pro | `containment (1 token)` | "earth" sits inside it; extra: "wise" "farms" — single-token, low precision |  |
| Wise Bites Collections Inc. | no | customer | Get Granted | `shared stem` | both begin "wise", then diverge ("bites collections" vs "earth farms") |  |
| The Wise Self Psychotherapy Clinic Inc | no | customer | Get Granted | `shared stem` | both begin "wise", then diverge ("self psychotherapy clinic" vs "earth farms") |  |
| Wise Bites Collections Inc | no | lead | Get Granted | `shared stem` | both begin "wise", then diverge ("bites collections" vs "earth farms") |  |

**Scout** — 228 files, 0.29 GB. Dropbox folders: `Scout (Megan)`, `Scout 2016`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Broker Scout Inc | no | lead | Granted Starter | `containment (1 token)` | "scout" sits inside it; extra: "broker" "inc" — single-token, low precision |  |
| Scout Magazine Inc | no | customer | Granted Pro | `containment (1 token)` | "scout" sits inside it; extra: "magazine" "inc" — single-token, low precision |  |
| Help Scout | no | lead | Granted Pro | `containment (1 token)` | "scout" sits inside it; extra: "help" — single-token, low precision |  |
| Scout Talent Canada | no | opportunity | Granted Pro | `containment (1 token)` | "scout" sits inside it; extra: "talent" "canada" — single-token, low precision |  |

**Organika** — 222 files, 0.15 GB. Dropbox folders: `Organika`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Organika Health Products | no | customer | Granted Pro | `containment (1 token)` | "organika" sits inside it; extra: "health" "products" — single-token, low precision |  |

**Clearwest** — 219 files, 0.04 GB. Dropbox folders: `Clearwest`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Clearwest Solutions Inc. | no | customer | Granted Pro | `containment (1 token)` | "clearwest" sits inside it; extra: "solutions" "inc" — single-token, low precision |  |

**Lux Quality Homes** — 216 files, 0.06 GB. Dropbox folders: `Lux Quality Homes`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| home | no | lead | Get Granted | `substring` | "home" appears inside "lux quality homes" |  |
| Home | no | lead | Get Granted | `substring` | "home" appears inside "lux quality homes" |  |

**Dynamix** — 206 files, 0.06 GB. Dropbox folders: `Dynamix`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Dynamix Management | no | lead | Get Granted | `containment (1 token)` | "dynamix" sits inside it; extra: "management" — single-token, low precision |  |
| Dynamix Agitators Inc. | no | customer | Granted Pro | `containment (1 token)` | "dynamix" sits inside it; extra: "agitators" "inc" — single-token, low precision |  |

**PLT** — 205 files, 0.06 GB. Dropbox folders: `PLT`

_No HubSpot company matches under any rule._

**Regehr** — 205 files, 0.05 GB. Dropbox folders: `Regehr`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Regehr Contracting Ltd. | **yes** | customer | Granted Pro | `containment (1 token)` | "regehr" sits inside it; extra: "contracting" "ltd" — single-token, low precision |  |

**Santevia** — 186 files, 0.76 GB. Dropbox folders: `Santevia`

| HubSpot candidate | Active? | Lifecycle | Product | Rule | Evidence | Confirm? |
|---|---|---|---|---|---|---|
| Santevia Water Systems Inc. | no | customer | Granted Pro | `containment (1 token)` | "santevia" sits inside it; extra: "water" "systems" "inc" — single-token, low precision |  |

### Caliber check

✅ **Caught.** `Caliber` (1,185 files) → **Caliber Projects Ltd.** via `containment (1 token)` — "caliber" sits inside it; extra: "projects" "ltd" — single-token, low precision. Active: no.

---

## Notes

- Nothing here is applied. `dist/inventory/client-status.csv` is unchanged; this is a list to confirm.
- HubSpot remains a status authority only. Canonical names are quoted as-is and none was overridden.
- The 2-token containment guard was dropped **for this document only**. `scripts/client-status-match.mjs` still carries it.
- Candidate lists are capped at 12 rows per entry; any overflow is stated explicitly rather than dropped silently.

