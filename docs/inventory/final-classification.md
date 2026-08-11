# Final Client Classification

**Generated:** 2026-08-11T18:56:01.241Z
**Model:** `claude-sonnet-4-6` (follow-up pass, batches of 50, same prompt and schema as pass 1)
**Full results:** `dist/inventory/final-clients.csv` (gitignored — regenerable)
**Scope:** folder names only. No Dropbox, Drive, or HubSpot call.

This is the review document. **Section “Variant groups” is the list to check by hand** — every canonical company that more than one raw folder name maps onto, across both classification passes.

## Headline

| | |
|---|---|
| Names in the resolved universe | 2,097 |
| — judged in pass 1 | 1,552 |
| — judged in this follow-up pass | 545 |
| **Distinct canonical companies** | **1,855** |
| — new companies from this pass | 462 |
| — names that merged into an existing company | 42 |
| Variant groups needing review (>1 raw name) | **93** |
| File coverage | 74,989 / 75,971 (98.7%) |
| Follow-up API cost | $0.49 |

---

## Step 1 — Library moved into the repo

`grants-lib.mjs` now lives at **`scripts/grants-lib.mjs`** and is version-controlled. It encodes every batch-detection decision in this project:

- the segment classifier (`classify`) with its year / date / doctype / corporate-suffix rules
- `MODEL_BATCH_NAMES` — 83 batch folder names identified by the model, which the regex provably cannot catch
- `isBatchName()` — the regex-OR-list predicate that drives branch descent
- `loadRows` / `parseCsv` / `normalizeName` — the shared parsing and identity rules

The 83-name list is not reproducible without re-running the AI pass, which is why the file had to be tracked rather than left in a scratch directory. All three prior scripts were re-run against the moved path and reproduce their previous numbers exactly (1,635 names / 2,097 rows / 996 deduped).

---

## Step 2 — Classifying the previously unjudged names

545 names in 11 batched calls. No call failed.

| Label | Names |
|---|---|
| `client` | 516 |
| `doctype` | 13 |
| `internal` | 8 |
| `batch` | 6 |
| `unclear` | 2 |

---

## Step 3 — Merge into the canonical list

| Outcome | Names |
|---|---|
| Formed a **new** canonical company | 462 companies from 474 names |
| **Merged into an existing** canonical company | 42 |
| Not a client (`batch`/`doctype`/`internal`/`unclear`/`date`) | 29 |

### Merged into existing companies (42) — every one

These raw names were judged to be the same company as something already in the list. **Each is a merge that changes an existing group — review before anything moves.**

| Raw name (new) | Joined existing company | Files | Programs | Confidence |
|---|---|---|---|---|
| `Bittered Sling 2016` | **Bittered Sling** | 500 | 1 | high |
| `Left Coast Naturals 2016` | **Left Coast Naturals** | 354 | 1 | high |
| `Fernie Brewing 2016` | **Fernie Brewing** | 245 | 1 | high |
| `Level Ground - Sales Admin` | **Level Ground Trading** | 42 | 1 | medium |
| `Corporate Finance Institude` | **Corporate Finance Institute** | 31 | 1 | high |
| `Coromandel Propeties` | **Coromandel Properties** | 23 | 1 | high |
| `*Jelly Mktg - 2022` | **Jelly Marketing** | 22 | 1 | high |
| `Admin Slayer:Spring Planning` | **Admin Slayer** | 20 | 1 | high |
| `Hippie Snacks (LCN)` | **Hippie Snacks** | 20 | 1 | high |
| `*Windfall Cider` | **Windfall Cider** | 17 | 1 | high |
| `E2+ : Streetscape` | **Streetscape** | 17 | 1 | medium |
| `Mosaic 2019` | **Mosaic** | 15 | 1 | medium |
| `Twin Lions_submitted` | **Twin Lions** | 14 | 1 | high |
| `*Northyards` | **Northyards** | 12 | 1 | medium |
| `Body Energy Club (West Broadway - Danni)` | **Body Energy Club** | 12 | 1 | high |
| `Kelly&Kelly` | **Kelly & Kelly** | 12 | 1 | medium |
| `Les Amis du Fromage_complete` | **Les Amis du Fromage** | 12 | 1 | high |
| `Mindful Matter Conselling` | **Mindful Matter Counselling** | 9 | 1 | high |
| `Dali Wireles` | **Dali Wireless** | 8 | 1 | high |
| `Spark Kombucha` | **Spark Kombucha** | 8 | 1 | high |
| `Level Ground Trading - submitted` | **Level Ground Trading** | 7 | 1 | high |
| `Body Energy Club - Grayson` | **Body Energy Club** | 6 | 1 | high |
| `Mainland Ford (TAG)` | **Mainland Ford** | 6 | 1 | high |
| `The Arbor-Abandoned` | **The Arbor** | 5 | 1 | medium |
| `Semperviva - submitted` | **Semperviva** | 4 | 1 | high |
| `The Acorn-Abandoned` | **The Acorn** | 4 | 1 | high |
| `Scholantis (Edlio)` | **Scholantis** | 3 | 1 | high |
| `Caliber - Oct 4th` | **Caliber** | 2 | 1 | medium |
| `Clarus Eletrical` | **Clarus Electrical** | 2 | 1 | high |
| `Cloud 9 - initial meeting only` | **Cloud 9** | 2 | 1 | medium |
| `Fabutek (Unicode Encoding Conflict)` | **Fabutek** | 2 | 1 | high |
| `Fresh Paint - contract?` | **Fresh Paint** | 2 | 1 | medium |
| `Polycrete (Deloitte)` | **Polycrete** | 2 | 1 | high |
| `Salad Etc!` | **Salad Etc!** | 2 | 1 | high |
| `Taymor (1)` | **Taymor** | 2 | 1 | high |
| `White Rock Volkswagen (TAG)` | **White Rock Volkswagen** | 2 | 1 | high |
| `Blue Meta -2 positions, one all OK` | **Blue Meta** | 1 | 1 | high |
| `Clarus - oneoff` | **Clarus** | 1 | 1 | high |
| `Horizon - not eligible` | **Horizon** | 1 | 1 | high |
| `Lyne Systems - TBC` | **Lyne Systems** | 1 | 1 | high |
| `Preimum Fence` | **Premium Fence** | 0 | 1 | high |
| `RTown (contact Thomas for Details)` | **RTOWN** | 0 | 1 | medium |

### Non-client labels from this pass (29)

| Name | Label | Files | Reason |
|---|---|---|---|
| `CAJG Clients` | batch | 1,038 | Group label for clients under a program acronym. |
| `2017:2018 Clients` | batch | 216 | Fiscal-year grouping of multiple clients. |
| `2020 Clients - Waitlist` | batch | 174 | Fiscal-year client grouping with waitlist qualifier. |
| `Clients - Q4` | batch | 141 | Quarterly grouping of client files. |
| `Mid-Term Report - submitted Aug 1, 2017` | doctype | 134 | Report document type with submission date. |
| `Clients - Q1, Q2` | batch | 89 | Quarterly grouping of multiple client files. |
| `FCF` | unclear | 46 | Acronym alone; insufficient context to classify confidently. |
| `30 Day` | unclear | 34 | Ambiguous; could be a period, program, or company name. |
| `MDPP - Market Development Preparedness Program (Agri & Seafood)` | internal | 17 | Describes a grant program, not a client company. |
| `Not submitted or approved` | doctype | 16 | Describes submission/approval status, administrative category. |
| `References` | doctype | 16 | Document category for reference materials. |
| `2016:2017 Clients (Abandoned)` | batch | 14 | Fiscal-year client grouping with abandoned status note. |
| `Granted Docs` | internal | 13 | Granted Consulting's own internal document repository. |
| `GRANTED BSP` | internal | 12 | Granted Consulting internal BSP (business service provider) folder. |
| `Submission Docs` | doctype | 10 | Document category for grant submissions. |
| `Approved Docs` | doctype | 9 | Document category for approved grant documents. |
| `Govt Docs` | doctype | 9 | Document category for government documents. |
| `Notes` | doctype | 9 | Generic notes document category folder. |
| `Communication Documents and Logos` | doctype | 8 | Clearly a document/artifact category folder. |
| `Industry Association Stream` | doctype | 5 | Describes an intake stream/category, not a company. |
| `Biotech Application Package` | doctype | 4 | Describes a document/application package type, not a company. |
| `Caliber BD Coordinator` | internal | 4 | BD Coordinator suggests internal staff/admin role folder. |
| `* TRAINING` | internal | 2 | Asterisk prefix and caps indicate internal training folder. |
| `Approval` | doctype | 2 | Document category for approval documents. |
| `Desktop` | internal | 2 | Likely a misplaced internal or temp folder. |
| `Internal` | internal | 2 | Clearly an internal administrative folder. |
| `Statistics` | doctype | 2 | Generic term likely denoting a document or data category. |
| `Steph working - Spring 2019` | internal | 2 | Staff name with date indicates internal work folder. |
| `Submission` | doctype | 1 | Generic document/process category name. |

---

## Step 4 — Is another re-resolution round needed?

**Yes.** 6 names came back `batch` and would need adding to `MODEL_BATCH_NAMES`, followed by one more re-resolution round.

Those folders currently hold **1,672 files** (2.2% of the tree). Re-resolving would push those files down to whatever sits beneath, surfacing a further tranche of unjudged names — and, as in the last round, orphaning any files sitting loose directly inside them.

**Not run** — reported only, per scope.

| Name to add to the skip list | Files | Programs |
|---|---|---|
| `CAJG Clients` | 1,038 | 1 |
| `2017:2018 Clients` | 216 | 1 |
| `2020 Clients - Waitlist` | 174 | 1 |
| `Clients - Q4` | 141 | 1 |
| `Clients - Q1, Q2` | 89 | 1 |
| `2016:2017 Clients (Abandoned)` | 14 | 1 |

---

## Step 5 — Updated totals

| Measure | Value |
|---|---|
| Distinct canonical companies | **1,855** |
| Names labelled `client` | 1,962 |
| Files under client names | 69,808 (91.9% of tree) |
| Files attributed to any name | 74,989 / 75,971 (**98.7%**) |
| Files still unattributed | 982 (1.3%) |

All labels across the resolved universe:

| Label | Names |
|---|---|
| `client` | 1,962 |
| `doctype` | 61 |
| `internal` | 58 |
| `unclear` | 10 |
| `batch` | 6 |

### Retention (client names, `client_modified`, 2020-08-11 cutoff)

`server_modified` is **not** used: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports nearly everything as recent regardless of real content age.

| Group | Names | % | Files |
|---|---|---|---|
| **Live** (a file within 6 years) | 1,128 | 57.5% | 56,095 |
| **Archive-only** | 807 | 41.1% | 13,713 |
| No dated files | 27 | 1.4% | 0 |

---

## Variant groups — the hand-review list (93)

**Every canonical company that more than one raw folder name maps onto, across both passes.** Nothing here was merged silently; the raw names are untouched on disk. `pass` shows which classification round produced each name.

| Canonical company | Raw folder names (files, pass) | Programs | Total files |
|---|---|---|---|
| **Caliber** | `Caliber` (1162, p1)<br>`Caliber - Nov 2021` (21, p1)<br>`Caliber - Oct 4th` (2, p2) | 9 | 1,185 |
| **Spare Labs** | `Spare Labs` (794, p1)<br>`Spare Labs - Senior Software Developer -Josef Waller` (2, p1) | 19 | 796 |
| **Horizon** | `Horizon` (773, p1)<br>`Horizon - not eligible` (1, p2) | 7 | 774 |
| **Left Coast Naturals** | `Left Coast Naturals` (370, p1)<br>`Left Coast Naturals 2016` (354, p2) | 5 | 724 |
| **Bittered Sling** | `Bittered Sling 2016` (500, p2)<br>`Bittered Sling` (7, p1) | 1 | 507 |
| **Level Ground** | `Level Ground` (394, p1)<br>`Level Ground Coffee` (5, p1) | 13 | 399 |
| **Twin Lions** | `Twin Lions` (379, p1)<br>`Twin Lions_submitted` (14, p2) | 5 | 393 |
| **Superprem Industries Ltd** | `Pearl` (352, p1)<br>`Superprem Industries Ltd (DBA Pearl)` (1, p1) | 13 | 353 |
| **Taymor** | `Taymor` (346, p1)<br>`Taymor (1)` (2, p2) | 7 | 348 |
| **Gunn Consultants** | `GUNN Consultants` (314, p1)<br>`Gunn Consutlants` (4, p1) | 14 | 318 |
| **Blume** | `Blume` (304, p1)<br>`Blume (Ellebox)` (3, p1) | 13 | 307 |
| **Level Ground Trading** | `Level Ground Trading` (258, p1)<br>`Level Ground - Sales Admin` (42, p2)<br>`Level Ground Trading - submitted` (7, p2) | 3 | 307 |
| **TQ Construction** | `TQ Construction` (167, p1)<br>`T Q Construction` (108, p1) | 3 | 275 |
| **Overstory Media Group** | `Overstory Media Group` (225, p1)<br>`Overstory Media Grup` (28, p1)<br>`Oversotry Media Group` (14, p1)<br>`Overstory Media` (6, p1) | 4 | 273 |
| **Atkinson Landscaping** | `Atkinson Landscaping` (251, p1)<br>`Atkinson Lanscaping` (14, p1)<br>`Atkinson Landdscaping` (2, p1) | 6 | 267 |
| **Fernie Brewing** | `Fernie Brewing 2016` (245, p2)<br>`Fernie Brewing` (19, p1) | 3 | 264 |
| **Eevee's** | `eevee's` (222, p1)<br>`Eevees` (29, p1) | 5 | 251 |
| **Victoria Golf Club** | `Victoria Golf Club` (226, p1)<br>`Victora Golf Club` (7, p1) | 7 | 233 |
| **Wise Earth Farms** | `Wise Earth Farms` (184, p1)<br>`Wise Earth Farm` (46, p1) | 1 | 230 |
| **Scout** | `Scout (Megan)` (119, p2)<br>`Scout 2016` (109, p2) | 1 | 228 |
| **Modern Purair** | `Modern Purair` (209, p1)<br>`Modern PURAIR Headquarters` (9, p1)<br>`Moder PurAir` (3, p1) | 8 | 221 |
| **TEC** | `TEC (One-Off)` (143, p1)<br>`TEC` (68, p1) | 5 | 211 |
| **QAI Laboratories** | `QAI Laboratories` (111, p1)<br>`QAI Labratories` (90, p1) | 4 | 201 |
| **Clarus** | `Clarus` (193, p1)<br>`Clarus - oneoff` (1, p2) | 8 | 194 |
| **Anita's Organic** | `Anita's Organic` (127, p2)<br>`Anita's Organic - Project Coordinator` (34, p2) | 2 | 161 |
| **The Acorn** | `The Acorn` (142, p1)<br>`The Acorn-Abandoned` (4, p2) | 8 | 146 |
| **Jelly Marketing** | `Jelly Marketing` (108, p1)<br>`*Jelly Mktg - 2022` (22, p2)<br>`Jelly Mktg` (5, p1) | 6 | 135 |
| **WiderFunnel** | `WiderFunnel` (48, p1)<br>`Widerfunnel 2017:18` (47, p1)<br>`Widerfunnel 2018:2019` (22, p1)<br>`Wider Funnel` (9, p1) | 3 | 126 |
| **Corporate Finance Institute** | `CFI (Corporate Finance Institute)` (65, p1)<br>`Corporate Finance Institude` (31, p2)<br>`Corporate Finance Institute` (22, p1) | 2 | 118 |
| **Grace & Stella** | `Grace & Stella` (107, p1)<br>`Grace&Stella` (10, p1) | 7 | 117 |
| **Paneless Window Washing** | `Paneless Window Washing` (103, p1)<br>`Paneless` (14, p1) | 2 | 117 |
| **Coromandel Properties** | `Coromandel Properties` (91, p1)<br>`Coromandel Propeties` (23, p2) | 2 | 114 |
| **FMR Management** | `FMR Management (Kitchen Table)` (60, p1)<br>`FMR Management` (54, p1) | 4 | 114 |
| **Arts & Labour** | `Arts & Labour` (104, p1)<br>`Arts&Labour` (3, p1) | 2 | 107 |
| **Blue Meta** | `Blue Meta` (104, p1)<br>`Blue Meta -2 positions, one all OK` (1, p2) | 3 | 105 |
| **Privilege Clothing** | `Privilege Clothing` (78, p1)<br>`Privlege Clothing` (21, p1) | 7 | 99 |
| **Office of McFarlane** | `Office of McFarlane` (82, p1)<br>`Office of Mcfarlane (OMB)` (6, p1) | 4 | 88 |
| **RTOWN** | `RTown` (79, p1)<br>`RTown (contact Thomas for Details)` (0, p2) | 4 | 79 |
| **Semperviva** | `Semperviva` (72, p1)<br>`Semperviva - submitted` (4, p2) | 3 | 76 |
| **O2E Brands** | `O2E Brands` (40, p1)<br>`O2E` (32, p1) | 1 | 72 |
| **PGL Consultants** | `PGL Consultants` (64, p1)<br>`PGLconsultants` (3, p1) | 1 | 67 |
| **Vancouver Island Brewing** | `Vancouver Island Brewing (VIB)` (59, p1)<br>`Vancouver Island Brewing` (3, p1)<br>`Vancouver Island Brewing - KPU` (2, p1) | 1 | 64 |
| **Windfall Cider** | `Windfall Cider` (40, p1)<br>`*Windfall Cider` (17, p2) | 5 | 57 |
| **Body Energy Club** | `Body Energy Club` (39, p1)<br>`Body Energy Club (West Broadway - Danni)` (12, p2)<br>`Body Energy Club - Grayson` (6, p2) | 5 | 57 |
| **Artona** | `Artona` (47, p1)<br>`Artona'` (7, p1) | 3 | 54 |
| **Clarus Electrical** | `Clarus Electrical` (49, p1)<br>`Clarus Eletrical` (2, p2) | 1 | 51 |
| **Fine Balance Yoga** | `Fine Balance yoga` (49, p1)<br>`Fine Balance Yoga SUSPENDED` (2, p1) | 1 | 51 |
| **The Arbor** | `The Arbor` (45, p1)<br>`The Arbor-Abandoned` (5, p2) | 3 | 50 |
| **Kelly & Kelly** | `Kelly & Kelly` (38, p1)<br>`Kelly&Kelly` (12, p2) | 4 | 50 |
| **Mosaic** | `Mosaic` (35, p1)<br>`Mosaic 2019` (15, p2) | 1 | 50 |
| **Heritage Office Furnishings** | `Heritage Office Furnishings` (47, p1)<br>`Heritage Office Funishings` (2, p1) | 4 | 49 |
| **Admin Slayer** | `Admin Slayer` (29, p1)<br>`Admin Slayer:Spring Planning` (20, p2) | 2 | 49 |
| **Stenberg College** | `Stenberg (TEC)` (26, p2)<br>`TEC - Stenberg College` (20, p2) | 1 | 46 |
| **Streetscape** | `Streetscape` (27, p1)<br>`E2+ : Streetscape` (17, p2) | 4 | 44 |
| **Retail Insider** | `Retail Insider CPF 2019` (26, p2)<br>`Retail Insider` (9, p2)<br>`Retail Insider CPF 2019x` (8, p2) | 1 | 43 |
| **Lyne Systems** | `Lyne Systems` (41, p1)<br>`Lyne Systems - TBC` (1, p2) | 4 | 42 |
| **E2+ Associates** | `E2+ Associates` (31, p1)<br>`E2+Associates` (9, p1) | 1 | 40 |
| **Vegpro** | `Vegpro` (25, p2)<br>`Vegpro: Salad Etc` (14, p2) | 2 | 39 |
| **Northyards** | `Northyards` (26, p1)<br>`*Northyards` (12, p2) | 2 | 38 |
| **Nourish** | `Nourish - Cook:Trainer` (27, p2)<br>`Nourish_abandoned` (9, p2) | 1 | 36 |
| **Hippie Snacks** | `Hippie Snacks (LCN)` (20, p2)<br>`Hippie Snacks` (13, p1) | 2 | 33 |
| **Klondike** | `Klondike` (23, p1)<br>`Klondike (applied on their own)` (8, p1) | 1 | 31 |
| **Mine & Yours** | `Mine & Yours` (29, p2)<br>`Mine&Yours` (1, p2) | 2 | 30 |
| **Premium Fence** | `Premium Fence` (28, p1)<br>`Premium Fence:Concept House:Kurt` (1, p1)<br>`Preimum Fence` (0, p2) | 1 | 29 |
| **Dali Wireless** | `Dali Wireless` (19, p1)<br>`Dali Wireles` (8, p2) | 2 | 27 |
| **Spark Kombucha** | `Spark Kombuxha` (19, p1)<br>`Spark Kombucha` (8, p2) | 1 | 27 |
| **Juvenation** | `Juvenation` (21, p1)<br>`Juvenation - Dr Michael` (5, p1) | 1 | 26 |
| **Sunshine Coast Health Centre** | `Sunshine Coast Health Center` (19, p1)<br>`Sunshine Coast Health Centre` (7, p1) | 1 | 26 |
| **Office of McFarlane Biggar Architects + Designers** | `Office of Mcfarlane Biggar Architects + Designers` (13, p1)<br>`office of mcfarlane biggar architects designers` (10, p1) | 1 | 23 |
| **Bandidas** | `Bandidas` (20, p1)<br>`Las Bandidas` (2, p1) | 1 | 22 |
| **Fabutek** | `Fabutek` (20, p1)<br>`Fabutek (Unicode Encoding Conflict)` (2, p2) | 4 | 22 |
| **Fresh Paint** | `Fresh Paint` (19, p1)<br>`Fresh Paint - contract?` (2, p2) | 5 | 21 |
| **NutMeg Mylk** | `NutMegMylk` (13, p1)<br>`Nutmeg Mylk` (7, p1) | 1 | 20 |
| **BYU Design** | `BYU Design` (13, p2)<br>`BYU Design - one off` (6, p2) | 1 | 19 |
| **PS & CO** | `PS & CO` (15, p1)<br>`PSandCo` (2, p1) | 1 | 17 |
| **Bemoved** | `Bemoved - Digital Mkt Coordinator` (13, p2)<br>`Bemoved` (2, p2) | 1 | 15 |
| **Inland Glass & Aluminum Ltd** | `Inland Glass and Aluminum Ltd` (8, p1)<br>`Inland Glass & Aluminum Ltd.` (7, p1) | 1 | 15 |
| **Les Amis du Fromage** | `Les Amis du Fromage_complete` (12, p2)<br>`Les Amis Du Fromage` (2, p1) | 1 | 14 |
| **Mindful Matter Counselling** | `Mindful Matter Conselling` (9, p2)<br>`Mindful Matter Counselling` (5, p1) | 1 | 14 |
| **Alta West** | `Alta West` (8, p1)<br>`Alta West copy` (6, p1) | 1 | 14 |
| **Forecast** | `Forecast` (8, p2)<br>`Forecast (Village)` (4, p2) | 1 | 12 |
| **BEL Contracting** | `BEL Contracting (Norland)` (8, p1)<br>`Bel Contracting` (3, p1) | 2 | 11 |
| **The Walker Group** | `The Walker Group` (9, p1)<br>`Walker Group` (1, p1) | 1 | 10 |
| **Salad Etc!** | `Salad Etc! (Vegpro)` (7, p1)<br>`Salad Etc!` (2, p2) | 1 | 9 |
| **Cloud 9** | `Cloud 9` (6, p1)<br>`Cloud 9 - initial meeting only` (2, p2) | 1 | 8 |
| **Mainland Ford** | `Mainland Ford (TAG)` (6, p2)<br>`Mainland Ford` (1, p1) | 1 | 7 |
| **Latreille Architectural Photography** | `Latreille Architectural Photography` (4, p2)<br>`Latreille Architectural Photography - One Off` (2, p2) | 1 | 6 |
| **White Rock Volkswagen** | `White Rock Volkswagen` (4, p1)<br>`White Rock Volkswagen (TAG)` (2, p2) | 1 | 6 |
| **Prosperity Workforce Solutions** | `Prosperity Workforce Solutions` (3, p1)<br>`ProsperityWorkforce Solutions` (3, p1) | 1 | 6 |
| **Sea2Sky Wellness** | `ONE OFF - Sea2Sky Wellness` (4, p1)<br>`Sea2Sky Wellness` (0, p1) | 1 | 4 |
| **Clementine Natural Health Inc** | `Clementine (1)` (3, p1)<br>`Clementine Natural Health Inc` (1, p1) | 1 | 4 |
| **Scholantis** | `Scholantis (Edlio)` (3, p2)<br>`Scholantis` (1, p1) | 1 | 4 |
| **Polycrete** | `Polycrete (Deloitte)` (2, p2)<br>`Polycrete` (1, p1) | 1 | 3 |

---

## Cost and tokens (this pass)

| Metric | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| API calls | 11 (0 failed) |
| Input tokens | 27,109 |
| Output tokens | 27,202 |
| **Cost** | **$0.4894** |

At list rates $3.00/M input and $15.00/M output. Combined with pass 1 ($1.4753), total spend on classification is **$1.96**.

---

## Reproducing

```bash
node <scratchpad>/classify-followup.mjs   # this pass
```

The shared library is now `scripts/grants-lib.mjs` and is version-controlled. Re-running incurs the API cost again.
