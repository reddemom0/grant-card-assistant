# Client Name Classification — AI Pass

**Generated:** 2026-08-11T18:23:50.737Z
**Model:** `claude-sonnet-4-6` (batches of 50, forced tool-use schema)
**Full results:** `dist/inventory/classified-clients.csv` (gitignored — regenerable)
**Scope:** folder NAMES only. No file contents read, no Dropbox or Drive API call.

## Headline

| | |
|---|---|
| Distinct client-depth names after widening the batch exclusion | **1,635** |
| — new names surfaced by re-resolving beneath batch folders | **692** |
| Names judged by the model | 1,632 |
| **Labelled `client`** | **1,446** |
| Distinct canonical companies after variant grouping | **1,393** |
| Variant groups with >1 member | 46 |
| Files covered | 75,125 of 75,971 (98.9%) |
| API cost | **$1.48** |

---

## Step 1 — Widened batch exclusion and re-resolution

The prior pass resolved client depth with a **per-program majority vote**, which let nested batch folders through as "clients". This pass resolves **per branch**: it walks down from each program folder and descends *through* any batch-shaped folder on that branch, emitting the first non-batch folder it reaches. A nested `CJG-BC Applications 2017` inside `CJG-BC Applications 2020 and prior` is now skipped on its own branch instead of being averaged away.

| Measure | Value |
|---|---|
| Client-depth folder instances | 1,635 distinct names |
| New vs the prior 996-name list | **692** |
| Files attributed to a client-depth name | 75,125 (98.9%) |
| Mechanically excluded before the AI pass | 3 |
| Sent to the model | 1,632 |

**All 16 previously-flagged batch names are gone from the candidate list** — the resolver descended through every one of them, which is what produced the 692 new names. Nothing was dropped: the ~26,942 files that sat under those batch folders are now attributed to the client-depth folders beneath them.

Largest newly-surfaced names (all were invisible to the prior pass):

| Name | Files |
|---|---|
| `ETG-BC Applications 2021x` | 1,264 |
| `ETG-BC Applications 2020x` | 1,234 |
| `ETG-BC Applications 2019x` | 1,166 |
| `CJG-BC Applications 2016x (October onwards)` | 1,052 |
| `CJG-BC Applications 2018xx` | 1,006 |
| `ETG-BC Applications 2020xx` | 794 |
| `ETG-BC Applications 2019xx` | 780 |
| `*DS4Y-LHL 2021` | 536 |
| `Intercity Packers` | 421 |
| `*DS4Y 2021` | 341 |
| `CJG-BC Applications 2018x` | 308 |
| `Herschel` | 262 |
| `Organika` | 178 |
| `Levelground` | 143 |
| `TAG` | 116 |

---

## Step 2 — Classification

1,632 names in 33 batched calls to `claude-sonnet-4-6`. Each call used a forced tool-use schema (`label`, `canonical_name`, `confidence`, `reason`) rather than free text, so every response is structurally valid. No call failed.

| Label | Names |
|---|---|
| `client` | 1,446 |
| `batch` | 83 |
| `internal` | 50 |
| `doctype` | 48 |
| `unclear` | 8 |

| Confidence (judged names) | Count |
|---|---|
| high | 1,358 |
| medium | 261 |
| low | 13 |

⚠️ **83 names were labelled `batch` by the model** — fiscal-year and intake folders that the mechanical string classifier missed (it only caught the 16 with a clean year token; names like `ETG-BC Applications 2021x` and `2016:2017 Clients` slipped through). Their files are currently attributed to the batch folder rather than to a client. Resolving them needs one more re-resolution round beneath those folders — see *Known gaps* below.

---

## Step 3 — Variant groups

46 canonical companies have more than one raw folder name. **Nothing was merged silently — every group is listed here in full for review.** Grouping is by the model's `canonical_name`; the raw names are unchanged on disk and in the CSV.

| Canonical | Raw names | Programs | Files |
|---|---|---|---|
| **Caliber** | `Caliber` (946), `Caliber - Nov 2021` (17) | 9 | 963 |
| **Spare Labs** | `Spare Labs` (655), `Spare Labs - Senior Software Developer -Josef Waller` (2) | 14 | 657 |
| **Superprem Industries Ltd** | `Pearl` (338), `Superprem Industries Ltd (DBA Pearl)` (1) | 11 | 339 |
| **TQ Construction** | `TQ Construction` (167), `T Q Construction` (108) | 4 | 275 |
| **Overstory Media Group** | `Overstory Media Group` (225), `Overstory Media Grup` (28), `Oversotry Media Group` (14), `Overstory Media` (6) | 7 | 273 |
| **Level Ground** | `Level Ground` (239), `Level Ground Coffee` (5) | 6 | 244 |
| **Gunn Consultants** | `Gunn Consultants` (233), `Gunn Consutlants` (4) | 12 | 237 |
| **Eevee's** | `eevee's` (222), `Eevees` (12) | 7 | 234 |
| **Wise Earth Farms** | `Wise Earth Farms` (184), `Wise Earth Farm` (46) | 2 | 230 |
| **Atkinson Landscaping** | `Atkinson Landscaping` (201), `Atkinson Lanscaping` (14), `Atkinson Landdscaping` (2) | 6 | 217 |
| **Victoria Golf Club** | `Victoria Golf Club` (202), `Victora Golf Club` (7) | 7 | 209 |
| **Blume** | `Blume` (203), `Blume (Ellebox)` (3) | 10 | 206 |
| **QAI Laboratories** | `QAI Laboratories` (111), `QAI Labratories` (90) | 6 | 201 |
| **Modern Purair** | `Modern Purair` (180), `Modern PURAIR Headquarters` (9), `Moder PurAir` (3) | 7 | 192 |
| **TEC** | `TEC (One-Off)` (143), `TEC` (46) | 5 | 189 |
| **Paneless Window Washing** | `Paneless Window Washing` (103), `Paneless` (14) | 4 | 117 |
| **FMR Management** | `FMR Management (Kitchen Table)` (60), `FMR Management` (48) | 3 | 108 |
| **Arts & Labour** | `Arts & Labour` (104), `Arts&Labour` (3) | 3 | 107 |
| **Widerfunnel** | `Widerfunnel 2017:18` (47), `Widerfunnel 2018:2019` (22), `WiderFunnel` (16), `Wider Funnel` (9) | 3 | 94 |
| **Office of McFarlane** | `Office of McFarlane` (79), `Office of Mcfarlane (OMB)` (6) | 4 | 85 |
| **Corporate Finance Institute** | `CFI (Corporate Finance Institute)` (65), `Corporate Finance Institute` (16) | 2 | 81 |
| **Grace & Stella** | `Grace & Stella` (71), `Grace&Stella` (10) | 5 | 81 |
| **Privilege Clothing** | `Privilege Clothing` (70), `Privlege Clothing` (3) | 5 | 73 |
| **Vancouver Island Brewing** | `Vancouver Island Brewing (VIB)` (59), `Vancouver Island Brewing` (3), `Vancouver Island Brewing - KPU` (2) | 3 | 64 |
| **PGL Consultants** | `PGL Consultants` (52), `PGLconsultants` (3) | 1 | 55 |
| **Artona** | `Artona` (47), `Artona'` (7) | 4 | 54 |
| **Fine Balance Yoga** | `Fine Balance yoga` (49), `Fine Balance Yoga SUSPENDED` (2) | 1 | 51 |
| **O2E Brands** | `O2E brands` (22), `O2E` (21) | 1 | 43 |
| **E2+ Associates** | `E2+ Associates` (31), `E2+Associates` (9) | 2 | 40 |
| **Heritage Office Furnishings** | `Heritage Office Furnishings` (40), `Heritage Office Funishings` (0) | 4 | 40 |
| **Jelly Marketing** | `Jelly Marketing` (30), `Jelly Mktg` (5) | 4 | 35 |
| **Klondike** | `Klondike` (23), `Klondike (applied on their own)` (8) | 2 | 31 |
| **Juvenation** | `Juvenation` (21), `Juvenation - Dr Michael` (5) | 2 | 26 |
| **Sunshine Coast Health Centre** | `Sunshine Coast Health Center` (19), `Sunshine Coast Health Centre` (6) | 1 | 25 |
| **Premium Fence** | `Premium Fence` (23), `Premium Fence:Concept House:Kurt` (1) | 1 | 24 |
| **Office of McFarlane Biggar Architects + Designers** | `Office of Mcfarlane Biggar Architects + Designers` (13), `office of mcfarlane biggar architects designers` (10) | 2 | 23 |
| **Bandidas** | `Bandidas` (20), `Las Bandidas` (2) | 1 | 22 |
| **NutMeg Mylk** | `NutMegMylk` (13), `Nutmeg Mylk` (7) | 2 | 20 |
| **PS & CO** | `PS & CO` (15), `PSandCo` (2) | 2 | 17 |
| **Inland Glass & Aluminum Ltd** | `Inland Glass and Aluminum Ltd` (8), `Inland Glass & Aluminum Ltd.` (7) | 1 | 15 |
| **Alta West** | `Alta West` (8), `Alta West copy` (6) | 2 | 14 |
| **Bel Contracting** | `BEL Contracting (Norland)` (8), `Bel Contracting` (3) | 3 | 11 |
| **The Walker Group** | `The Walker Group` (9), `Walker Group` (1) | 1 | 10 |
| **Prosperity Workforce Solutions** | `Prosperity Workforce Solutions` (3), `ProsperityWorkforce Solutions` (3) | 2 | 6 |
| **Clementine Natural Health Inc** | `Clementine (1)` (3), `Clementine Natural Health Inc` (1) | 2 | 4 |
| **Sea2Sky Wellness** | `ONE OFF - Sea2Sky Wellness` (4), `Sea2Sky Wellness` (0) | 1 | 4 |

---

## Step 4 — HubSpot cross-check

Matched 1,393 canonical companies against **13,432 HubSpot company records** (read-only; fetched via the CRM API using the token already in `.env`).

Matching is three-tier: exact on normalized name, then on name with legal suffixes (Inc/Ltd/Corp/…) stripped, then Levenshtein distance ≤ 2 as a near-miss.

| Result | Companies | % |
|---|---|---|
| Exact match | 471 | 33.8% |
| Match ignoring legal suffix | 185 | 13.3% |
| Near-miss (edit distance ≤ 2) | 86 | 6.2% |
| **Unmatched** | **651** | **46.7%** |

**742 of 1,393 (53.3%) have a plausible HubSpot counterpart.**

**No AI output was overwritten with a HubSpot name.** Where the two disagree, both are shown below and the conflict is left for a human.

### Spelling differences (185) — same company, different string

| AI canonical | HubSpot name | Files |
|---|---|---|
| Spare Labs | Spare Labs Inc. | 657 |
| Creator Co | Creator | 351 |
| Major Tom | Major Tom Inc. | 271 |
| AME Consulting | AME Consulting Group | 253 |
| PHL Capital | PHL Capital Corp | 230 |
| Clarus Electric | Clarus Electric Corp | 219 |
| QAI Laboratories | QAI Laboratories LTD. | 201 |
| Titan Boats | Titan Boats Ltd. | 175 |
| C Market Coffee | C Market Coffee Ltd.  | 169 |
| Taymor Industries | Taymor Industries Ltd.  | 164 |
| Exact Detailing | Exact Detailing Ltd. | 147 |
| Paintillio | Paintillio Enterprises Inc. | 146 |
| Maven Consulting | Maven Consulting Ltd. | 145 |
| Keirton | Keirton Inc. | 138 |
| IBC Technologies | IBC Technologies Inc.  | 123 |
| Earthling Foods | Earthling Foods Inc | 114 |
| Stardust Solar Technologies | Stardust Solar Technologies Inc. | 106 |
| Smile Innovations Group | Smile Innovations Group Inc. | 103 |
| Jack Cewe Construction | Jack Cewe Construction Ltd. | 102 |
| Laid Back Snacks | Laid Back Snacks Inc. | 102 |
| Wicks Electric | Wicks Electric Inc. | 101 |
| Icon Global Supply | Icon Global Supply Inc. | 97 |
| Latero Labs | Latero Labs Inc. | 95 |
| Advanced Material Handling | Advanced Material Handling Ltd. | 91 |
| Make Projects | MAKE Projects Ltd. | 91 |
| More Than Just Feed | More Than Just Feed Inc. | 91 |
| Metropolitan Fine Printers | Metropolitan Fine Printers Inc. | 88 |
| Santevia Water Systems | Santevia Water Systems Inc. | 88 |
| FLIR Systems | FLIR Systems, Inc. | 86 |
| Mak Physiotherapist Co. | Mak Physiotherapist Corp. | 84 |
| Grace & Stella | Grace & Stella Inc. | 81 |
| Progrus Constructors | Progrus Constructors Inc. | 75 |
| NGX Interactive | NGX Interactive Inc | 74 |
| Digital Hot Sauce | Digital Hot Sauce Inc. | 70 |
| Full Line Specialties | Full Line Specialties Inc | 68 |
| Keystone Environmental | Keystone Environmental Ltd | 63 |
| Forte Law | Forte Law Co. | 61 |
| Tree Construction | Tree Construction Inc | 58 |
| Harmonic Machine | Harmonic Machine Inc | 52 |
| Falcon Equipment | Falcon Equipment Ltd. | 50 |
| Six and a Half Consulting | Six and a Half Consulting Inc. | 50 |
| Turn-key Controls | Turn-Key Controls Ltd | 47 |
| Horizon Contracting | Horizon Contracting Group | 46 |
| Caribou | Caribou Inc. | 42 |
| Mubarak Restaurant | Mubarak Restaurant Ltd. | 42 |
| Zamola | Zamola Enterprises Limited | 40 |
| Clarity Planning | Clarity Planning Inc. | 39 |
| Vitae Apparel | Vitae Apparel Inc. | 38 |
| Colony Construction | Colony Construction Corporation | 37 |
| Mak Physiotherapist | Mak Physiotherapist Corp. | 37 |
| Stas Holdings | Stas Holdings Inc. | 37 |
| Maison Apothecare | Maison Apothecare Inc. | 36 |
| Ronin8 Technologies | Ronin8 Technologies Ltd | 36 |
| Simpli Assets | Simpli Assets Ltd. | 36 |
| Stillhead Distillery | Stillhead Distillery Inc. | 35 |
| Gentai Capital | Gentai Capital Corporation | 34 |
| Seagate Mass Timber | Seagate Mass Timber Inc. | 34 |
| Sweet Georgia Yarns | Sweet Georgia Yarns Inc. | 34 |
| Pacific Solutions Contracting | Pacific Solutions Contracting Ltd. | 33 |
| Coromandel Properties | Coromandel Properties Ltd. | 32 |
| _…and 125 more_ | | |

### Near-misses (86) — likely the same company, needs a human call

| AI canonical | Closest HubSpot name | Edit distance | Files |
|---|---|---|---|
| Folklore | FOLKLIFE | 2 | 262 |
| Dynamix | Dynamics | 2 | 195 |
| TEC | Tecus Enterprises Inc | 2 | 189 |
| TAG | Tagga | 2 | 116 |
| Bellrock | belrock | 1 | 95 |
| DNE | DNEG | 1 | 77 |
| Spring Activators | Spring Activator | 1 | 76 |
| Progrus | Progress Group | 2 | 73 |
| AWC Process Solutions | AWC Process Solution | 1 | 65 |
| Artona Group | ARTSSA | 2 | 61 |
| Artona | ARTSSA | 2 | 54 |
| Zeemac | Zeegar | 2 | 50 |
| Verka | Verto | 2 | 42 |
| BlueMeta Media | Blue Meta Media Ltd. | 1 | 41 |
| Frontier CFO | FrontierCFO | 1 | 41 |
| Support Bench | Supportbench | 1 | 41 |
| Houston Landscape | Houston Landscapes | 1 | 39 |
| NACO | NACCA | 2 | 39 |
| Magnum | Magnet | 2 | 38 |
| Richmond Plastic | Richmond Plastics | 1 | 38 |
| Swift | Swivl | 2 | 36 |
| Laidback Snacks | Laid Back Snacks Inc. | 1 | 35 |
| Spare | Spark | 1 | 35 |
| Clarus Electrical | Clarus Electric Corp | 2 | 34 |
| Prairie Coast Equipment | PrairieCoast Equipment Inc | 1 | 34 |
| Loren Nancke | Loren Nancke & Company Inc. | 2 | 31 |
| Harmonic | Harmonia | 1 | 29 |
| Hawthorne Landscape Design | Hawthorn Landscape Design Inc.  | 1 | 28 |
| ARI | Aria Holdings Ltd. | 1 | 24 |
| Cartems | careme | 2 | 24 |
| LeadVantage | Lead Vantage | 1 | 24 |
| Ascent | Ascend LLP | 1 | 23 |
| Kelly & Kelly | Kelly&Kelly Inc. | 2 | 18 |
| Stoxx | Stonz | 2 | 18 |
| Nightingale Electric | Nightingale Electrical | 2 | 16 |
| Zhao & Associates | Zhao & Associate Inc. | 1 | 16 |
| CareAge | careme | 2 | 15 |
| Space Harmony Interiors Inc. | Space Harmony Interior | 1 | 15 |
| FreshPrep | Fresh Prep | 1 | 14 |
| Cocoa West Chocolatiers | Cocoa West Chocolatier | 1 | 13 |
| Les Amies du Fromage | Les Amis du Fromage | 1 | 13 |
| RST Instruments | Rstinstruments | 1 | 12 |
| Traine | TRAINFO | 2 | 12 |
| BCFPA | BCFB | 2 | 11 |
| Black Tie | Black Tar Corp | 2 | 11 |
| Excellence Seminar International | Excellence Seminars International | 1 | 11 |
| GlassCanvas | Glass Canvas | 1 | 11 |
| Sole Girls Youth Program | Sole Girls Youth Programs | 1 | 11 |
| StarWest Petroleum | Star West Petroleum | 1 | 10 |
| Wespoint Naturals | Westpoint Naturals | 1 | 10 |
| Chamber Stream | ChamberStream | 1 | 9 |
| Arbor | ArboID | 2 | 8 |
| Clarus Electronic | Clarus Electric Corp | 2 | 8 |
| Jack59 | Jack 59 | 1 | 8 |
| Shift Interior | Shift Interiors | 1 | 8 |
| Sparelabs | Spare Labs Inc. | 1 | 8 |
| Dat Wong | Dat Wong & Company Inc. | 2 | 7 |
| Gunn Consultant | Gunn Consultants | 1 | 7 |
| Route One Research & Marketing Service | Route One Research & Marketing Services | 1 | 7 |
| BelPacific | Bel Pacific | 1 | 6 |
| _…and 26 more_ | | | |

### Unmatched (651) — top 40 by file count

An unmatched name is not necessarily wrong. It may be a company that was never entered in HubSpot, a legacy client, a mis-read folder name, or a name the model invented from an abbreviation.

| AI canonical | Programs | Files | Retention |
|---|---|---|---|
| Caliber | 8 | 963 | live |
| Keystone | 20 | 850 | live |
| SAAM Towage | 8 | 647 | live |
| Musora | 10 | 593 | live |
| Horizon | 5 | 497 | live |
| Trotman | 3 | 490 | live |
| Ledcor | 3 | 484 | live |
| Clir | 14 | 450 | live |
| ClearDent | 12 | 369 | live |
| Native Shoes | 12 | 368 | live |
| Nightingale | 4 | 291 | live |
| Solaris | 12 | 275 | live |
| TQ Construction | 3 | 275 | live |
| Taymor | 6 | 268 | live |
| Strategex | 8 | 261 | live |
| HTC | 11 | 260 | live |
| Twin Lions | 4 | 259 | live |
| Level Ground | 5 | 244 | live |
| Wise Earth Farms | 1 | 230 | live |
| Clearwest | 3 | 219 | live |
| Atkinson Landscaping | 4 | 217 | live |
| Coast Spas | 5 | 215 | live |
| Lux Quality Homes | 4 | 213 | live |
| PLT | 1 | 205 | live |
| Regehr | 4 | 205 | live |
| ChopValue | 7 | 204 | live |
| Van Bower | 8 | 202 | live |
| Primex | 2 | 201 | live |
| Debrand | 11 | 197 | live |
| SCG Process | 4 | 197 | live |
| Modern Purair | 6 | 192 | live |
| Clarus | 8 | 188 | live |
| AME | 8 | 185 | live |
| Mayne Inc. | 4 | 181 | live |
| Organika | 1 | 178 | archive_only |
| Greenlight | 10 | 164 | live |
| Big River | 3 | 160 | live |
| Capital City News / Overstory Media | 1 | 156 | live |
| Modern PURAIR Franchises | 2 | 156 | live |
| FansUnite | 3 | 152 | live |

---

## Step 5 — Retention split (2020-08-11 cutoff)

Computed on **`client_modified`**, not `server_modified`. `server_modified` is corrupted: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports almost everything as recent regardless of actual content age.

| Group | Names | % | Files |
|---|---|---|---|
| **Live** (a file within 6 years) | 891 | 61.6% | 43,523 |
| **Archive-only** (nothing newer) | 545 | 37.7% | 7,972 |
| No dated files | 10 | 0.7% | 0 |

**37.7% of client names are archive-only, but they hold only 15.5% of the client files.** The long tail is old and light; live clients are fewer and much heavier.

---

## Low-confidence classifications (13)

Every name the model marked `low`. These are the first place to look when spot-checking.

| Name | Label | Canonical | Programs | Files | Model reason |
|---|---|---|---|---|---|
| `PCE` | unclear | — | 4 | 62 | Three-letter abbreviation; insufficient context to confirm client. |
| `PRS` | unclear | — | 1 | 31 | Three-letter abbreviation; insufficient context to confirm client. |
| `LNG` | unclear | — | 2 | 22 | Three-letter abbreviation; insufficient context to confirm client. |
| `Patio` | client | Patio | 1 | 21 | Could be a business name; single word is ambiguous but files suggest client. |
| `Anita` | client | Anita | 1 | 8 | First name only; could be sole proprietor or staff. |
| `Natural Resources` | unclear | — | 1 | 7 | Too generic; could be a client or internal resource folder. |
| `Dynamic` | client | Dynamic | 1 | 5 | Generic but could be a client company abbreviation. |
| `Fraser Valley` | unclear | — | 1 | 4 | Too generic; could be partial company name or region. |
| `SGC` | client | SGC | 1 | 4 | Short abbreviation, likely a client company. |
| `BATW` | client | BATW | 1 | 3 | Ambiguous acronym, but fits client context with few files. |
| `EGFG` | client | EGFG | 1 | 3 | Abbreviation, likely a client company; insufficient info to expand. |
| `AAA` | unclear | — | 1 | 0 | Too generic/abbreviated with 0 files to classify confidently. |
| `Prcogoia` | unclear | — | 1 | 0 | Unrecognizable word, 0 files, possibly a typo or test. |

---

## Cost and tokens

| Metric | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| API calls | 33 (0 failed) |
| Input tokens | 80,844 |
| Output tokens | 82,182 |
| Cache read / write tokens | 0 / 0 |
| **Total cost** | **$1.4753** |

Priced at list rates for `claude-sonnet-4-6`: $3.00/M input, $15.00/M output. Cost per name judged: $0.00090.

No prompt caching was used — the system prompt is under the 1024-token minimum for this model, so a cache breakpoint would never have been written.

---

## Known gaps

1. **83 names came back `batch`.** The widened exclusion in Step 1 only descends through folders the *string* classifier recognises as batch-shaped. The model caught 83 more that it missed. Their files are attributed to a batch folder, not a client. Fixing this means one more re-resolution round using the model's `batch` labels as the skip list — mechanical, no new judgement needed.
2. **50 names are `internal`** (Granted's own templates, training, staff-owner folders). They are not clients and should not become destinations.
3. **846 files sit under no client-depth name at all** — program folders with no subfolder structure. No path rule reaches them.
4. **Canonical names are model output, not ground truth.** The HubSpot cross-check above is the evidence for which ones are real; unmatched names are unverified.

---

## Reproducing

```bash
node <scratchpad>/classify-clients.mjs        # Steps 1-3, 5 -> CSV + state
node <scratchpad>/fetch-hubspot-companies.mjs # HubSpot company dump (read-only)
node <scratchpad>/report-classification.mjs   # Step 4 + this document
```

Scripts live in the session scratchpad, not the repo. Re-running the classification incurs the API cost again.
