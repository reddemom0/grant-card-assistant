# Batch Re-Resolution — Applying the Model's Batch Labels

**Generated:** 2026-08-11T18:53:37.170Z
**Inputs:** `dist/inventory/grants-inventory.csv` (unmodified), `dist/inventory/classified-clients.csv`
**Output:** `dist/inventory/resolved-clients.csv` (gitignored — regenerable)
**Method:** mechanical only. No API call of any kind — no Anthropic, Dropbox, Drive, or HubSpot. No new judgements were made; the existing classifications are reused as data.

## What changed

`docs/inventory/client-classification.md` flagged that the string classifier caught only 16 batch folders while the model found 83 more. Those 83 names are now an explicit skip list in the shared library, so per-branch depth resolution descends through them too.

The list is **data, not regex**, deliberately. The pattern missed these for reasons no regex generalizes cleanly:

| Failure mode | Examples |
|---|---|
| Year with a trailing letter — no word boundary after the digits | `ETG-BC Applications 2021x`, `CJG-BC Applications 2018xx` |
| Says "Clients", not "Client Files" — outside the hint vocabulary | `2016:2017 Clients`, `Clients 2017:18` |
| Program-stream grouping with no date token at all | `Clean Tech Stream`, `Impact Stream`, `DS4Y - Digital Tech Stream` |
| Bare grant-program acronym | `CAJG`, `BCMJG`, `CJG Manitoba` |
| Ordinal intake | `Second Intake`, `Third Intake` |

Widening the regex to catch these would over-match real client names. An explicit list cannot.

---

## Step 2 — Re-resolution with the widened skip list

| Measure | Before | After | Δ |
|---|---|---|---|
| Distinct candidate names | 1,635 | **2,097** | +462 |
| Files attributed to a name | 75,125 | 74,989 | -136 |
| File coverage | 98.9% | **98.7%** | |

### ⚠️ Coverage went **down**, not up — 136 files were orphaned

Attributed file count fell by 136. This is a real side effect of the skip list, not a counting error.

Skipping *through* a batch folder means the folder itself is no longer a client-depth node. Any file sitting **loose directly inside** that batch folder — not in a subfolder — therefore loses its attribution: there is nothing beneath it to descend to, and the folder above it no longer qualifies. 136 files are in that position.

| Batch folder | Loose files orphaned |
|---|---|
| `2016 Forms` | 14 |
| `2018 Files` | 11 |
| `2023 Documents` | 9 |
| `CAJG` | 9 |
| `Forms 2015:16` | 8 |
| `2022 Clients` | 8 |
| `Export-Development Stream 2023` | 6 |
| `2015 Forms` | 5 |
| `2016 FORMS for Employers` | 4 |
| `Postsecondary - Aviation & Aerospace (Career Focus)` | 4 |

This is the correct trade: 20,659 files gained a real client attribution and 136 lost a false one (a fiscal-year folder was never a client). But those 136 files now belong to no name and would be missed by any client-keyed process.

Of the resulting names:

| Status | Names |
|---|---|
| `client` | 1,446 |
| **UNCLASSIFIED** (new — never judged) | 545 |
| `internal` | 50 |
| `doctype` | 48 |
| `unclear` | 8 |

**1,552 names already carry a classification; 545 are new and unjudged.**

---

## Step 3 — Files released from batch attribution

**20,659 files** moved from a batch-folder attribution to a deeper (client-depth) attribution — 27.2% of all files in the tree.

The 10 batch folders that released the most files:

| Batch folder | Files released | Distinct names beneath |
|---|---|---|
| `Clients` | 1,519 | 134 |
| `2016:2017 Clients` | 1,488 | 12 |
| `ETG-BC Applications 2021x` | 1,264 | 65 |
| `ETG-BC Applications 2020x` | 1,234 | 82 |
| `ETG-BC Applications 2019x` | 1,166 | 114 |
| `DS4Y - Digital Tech Stream` | 1,158 | 110 |
| `CJG-BC Applications 2016x (October onwards)` | 1,052 | 65 |
| `CAJG` | 1,051 | 3 |
| `CJG-BC Applications 2018xx` | 1,006 | 115 |
| `DS4Y 2020 clients` | 982 | 54 |

84 batch folders released files in total; the 10 above account for 57.7% of the movement.

---

## Step 4 — Newly surfaced names needing classification

**545 names are new and have never been judged.** They hold 8,393 files. Classifying them requires a follow-up AI pass, which is **not** part of this task — they are counted and listed here only.

| Name | Programs | Files | First seen | Last modified |
|---|---|---|---|---|
| `CAJG Clients` | 1 | 1,038 | 2015-03-20 | 2026-03-24 |
| `Bittered Sling 2016` | 1 | 500 | 2008-03-04 | 2016-12-20 |
| `Left Coast Naturals 2016` | 1 | 354 | 2016-04-15 | 2018-09-21 |
| `Fernie Brewing 2016` | 1 | 245 | 2016-03-17 | 2018-03-22 |
| `2017:2018 Clients` | 1 | 216 | 2016-08-16 | 2018-07-27 |
| `Hatchways` | 4 | 189 | 2020-10-06 | 2023-10-17 |
| `2020 Clients - Waitlist` | 1 | 174 | 2019-12-10 | 2021-03-29 |
| `Clients - Q4` | 1 | 141 | 2017-10-12 | 2018-03-27 |
| `Mid-Term Report - submitted Aug 1, 2017` | 1 | 134 | 2017-02-16 | 2018-03-23 |
| `Urban Digs Farm` | 1 | 128 | 2015-01-24 | 2016-04-29 |
| `Anita's Organic` | 2 | 127 | 2016-01-16 | 2017-06-22 |
| `Scout (Megan)` | 1 | 119 | 2013-06-12 | 2016-08-03 |
| `Scout 2016` | 1 | 109 | 2015-08-03 | 2018-08-27 |
| `Oilers Nation` | 1 | 93 | 2015-02-19 | 2016-08-17 |
| `Clients - Q1, Q2` | 1 | 89 | 2017-02-22 | 2017-11-28 |
| `iCan Systems Inc.` | 1 | 88 | 2019-02-26 | 2019-03-15 |
| `Trotman Auto` | 1 | 70 | 2017-06-16 | 2021-01-04 |
| `Canucks` | 1 | 62 | 2015-02-19 | 2016-08-17 |
| `Beyond Capture` | 3 | 60 | 2019-01-28 | 2022-11-18 |
| `North Shore Mountain Biking` | 1 | 59 | 2015-06-17 | 2017-01-17 |
| `Jelly` | 3 | 53 | 2017-10-16 | 2021-04-09 |
| `Black Bird Interactive*` | 1 | 51 | 2018-09-14 | 2019-01-24 |
| `Westmill` | 1 | 51 | 2020-08-18 | 2020-09-28 |
| `Fatso Peanut Butter` | 3 | 50 | 2019-03-26 | 2022-10-28 |
| `Synic Software` | 1 | 50 | 2019-07-17 | 2019-12-07 |
| `Clir Renewables` | 1 | 48 | 2021-09-30 | 2022-01-11 |
| `FCF` | 1 | 46 | 2025-04-03 | 2025-06-05 |
| `Ethony` | 1 | 45 | 2020-09-25 | 2021-07-06 |
| `AP Insurance (CF Canada Financial)` | 1 | 44 | 2020-07-14 | 2021-07-16 |
| `Ainsliewear` | 2 | 43 | 2015-07-20 | 2020-10-22 |
| `Level Ground - Sales Admin` | 1 | 42 | 2016-06-24 | 2017-04-19 |
| `Pivot & Pilot Creative` | 2 | 37 | 2021-05-06 | 2022-04-08 |
| `Kitply` | 3 | 37 | 2016-05-30 | 2016-12-16 |
| `30 Day` | 1 | 34 | 2015-12-16 | 2016-03-02 |
| `Wind Sun Sky Entertainment` | 2 | 34 | 2020-07-16 | 2022-01-21 |
| `Anita's Organic - Project Coordinator` | 1 | 34 | 2016-06-14 | 2017-05-05 |
| `MeeT` | 1 | 32 | 2020-11-17 | 2022-02-07 |
| `Stonebridge Imports` | 2 | 31 | 2021-05-14 | 2022-04-20 |
| `Key Marketing` | 3 | 31 | 2016-08-17 | 2017-03-03 |
| `Corporate Finance Institude` | 1 | 31 | 2020-08-21 | 2020-11-19 |
| `Veza` | 1 | 30 | 2018-11-16 | 2019-10-01 |
| `Primex Manufacturing` | 1 | 30 | 2019-11-08 | 2020-03-10 |
| `Mine & Yours` | 2 | 29 | 2016-03-18 | 2021-04-05 |
| `Yeti Farm Creative` | 1 | 29 | 2021-09-17 | 2021-11-16 |
| `Lekker` | 1 | 28 | 2020-08-06 | 2020-10-26 |
| `Nourish - Cook:Trainer` | 1 | 27 | 2016-07-12 | 2017-04-20 |
| `Stardust Solar` | 1 | 27 | 2021-05-28 | 2022-04-05 |
| `Retail Insider CPF 2019` | 1 | 26 | 2017-04-24 | 2020-06-25 |
| `Capstone Canada` | 1 | 26 | 2022-04-07 | 2024-03-14 |
| `Stenberg (TEC)` | 1 | 26 | 2020-09-03 | 2020-12-23 |
| `Overstory` | 1 | 25 | 2021-09-08 | 2022-04-08 |
| `Vegpro` | 2 | 25 | 2023-07-04 | 2023-10-03 |
| `Bells & Whistles` | 1 | 25 | 2021-08-30 | 2022-03-17 |
| `Acorn : Abror` | 1 | 25 | 2020-10-06 | 2021-03-10 |
| `Chong Hong Construction` | 3 | 24 | 2019-10-09 | 2021-08-06 |
| `Healthy Hooch:Functional Beverage Group` | 1 | 24 | 2020-08-07 | 2021-04-07 |
| `West X Business Solutions` | 1 | 24 | 2018-05-30 | 2020-08-28 |
| `Naturally Crafted` | 1 | 24 | 2015-07-20 | 2018-09-27 |
| `Premium Fence Co.` | 1 | 24 | 2016-09-01 | 2016-11-23 |
| `MountainBerry Landscaping` | 1 | 24 | 2016-07-22 | 2016-11-16 |
| `Coromandel Propeties` | 1 | 23 | 2018-09-17 | 2019-01-30 |
| `Mayne` | 1 | 23 | 2021-03-17 | 2022-04-13 |
| `GIPT` | 1 | 22 | 2018-05-07 | 2019-09-25 |
| `*Jelly Mktg - 2022` | 1 | 22 | 2022-01-28 | 2022-03-31 |
| `Red Dog` | 1 | 22 | 2020-07-15 | 2021-03-23 |
| `The Tyee 2016` | 1 | 21 | 2016-06-10 | 2018-10-22 |
| `Shift Interiors` | 2 | 21 | 2019-10-09 | 2021-03-30 |
| `Taimuri:Capstone` | 1 | 21 | 2021-01-19 | 2022-02-03 |
| `MTJF` | 1 | 21 | 2024-07-24 | 2024-10-25 |
| `PGGroup Management` | 1 | 21 | 2016-09-21 | 2016-11-16 |
| `Hippie Snacks (LCN)` | 1 | 20 | 2020-05-12 | 2022-10-27 |
| `Admin Slayer:Spring Planning` | 1 | 20 | 2019-11-13 | 2020-03-19 |
| `The Juice Truck` | 1 | 20 | 2016-09-06 | 2016-12-05 |
| `TEC - Stenberg College` | 1 | 20 | 2020-12-02 | 2020-12-16 |
| `McMaster` | 1 | 19 | 2021-08-19 | 2022-04-08 |
| `Kalev Fitness` | 2 | 19 | 2019-01-14 | 2019-03-26 |
| `Safecrush` | 1 | 19 | 2020-02-13 | 2021-03-05 |
| `Pisano Capital` | 1 | 19 | 2020-03-13 | 2020-06-11 |
| `SanghaTone` | 1 | 19 | 2019-03-12 | 2019-11-13 |
| `1068444 B.C. LTD.` | 1 | 19 | 2021-10-28 | 2022-02-01 |
| `Ezry Foods Inc. (DBA Its GUD)` | 1 | 19 | 2021-10-25 | 2021-12-20 |
| `Legacy Family Office at Assante Financial Management Ltd.` | 1 | 19 | 2019-10-22 | 2021-02-18 |
| `Relentless Baking` | 1 | 18 | 2020-07-17 | 2021-04-06 |
| `Kwong Fung` | 1 | 18 | 2016-07-15 | 2016-07-19 |
| `New World Tech` | 2 | 18 | 2018-04-09 | 2019-10-31 |
| `Catapult` | 3 | 17 | 2019-04-12 | 2020-11-20 |
| `National Standards` | 1 | 17 | 2016-08-26 | 2017-02-20 |
| `Neighbourhood Brand` | 1 | 17 | 2016-04-27 | 2016-09-26 |
| `*Windfall Cider` | 1 | 17 | 2021-03-11 | 2022-08-04 |
| `MDPP - Market Development Preparedness Program (Agri & Seafood)` | 1 | 17 | 2016-06-07 | 2018-10-18 |
| `Pranin` | 2 | 17 | 2018-03-16 | 2019-02-11 |
| `E2+ : Streetscape` | 1 | 17 | 2020-11-17 | 2022-01-25 |
| `Superior Restoration` | 1 | 17 | 2018-05-31 | 2018-09-28 |
| `Steel & Oak` | 1 | 17 | 2020-08-19 | 2020-10-05 |
| `Victory Square : Draft Label` | 1 | 16 | 2020-08-18 | 2021-04-07 |
| `Madison Builders:E2 + Associates` | 1 | 16 | 2020-08-12 | 2021-03-19 |
| `Stonz Wear` | 2 | 16 | 2016-08-29 | 2017-02-23 |
| `Nightingale Electrical Ltd` | 1 | 16 | 2023-05-26 | 2023-08-25 |
| `Not submitted or approved` | 1 | 16 | 2016-06-06 | 2016-07-11 |
| `MKT Digital` | 3 | 16 | 2021-08-06 | 2022-08-09 |
| `References` | 1 | 16 | 2016-01-16 | 2016-12-12 |
| `E3Eco` | 1 | 16 | 2018-04-09 | 2019-12-17 |
| `Black Tie Property Services` | 1 | 16 | 2018-05-23 | 2022-02-16 |
| `Luxe Agency` | 1 | 16 | 2016-08-19 | 2017-02-15 |
| `Merit Functional Foods` | 1 | 16 | 2020-09-02 | 2020-09-08 |
| `Clearmind International Institute` | 2 | 15 | 2020-08-19 | 2021-08-18 |
| `International Financial Consulting` | 2 | 15 | 2019-06-19 | 2019-12-04 |
| `NiceJob` | 4 | 15 | 2018-08-28 | 2019-12-17 |
| `Mosaic 2019` | 1 | 15 | 2018-08-09 | 2019-02-21 |
| `Scarab Media` | 1 | 15 | 2021-10-25 | 2021-11-29 |
| `ServiceMaster Restore of Fraser Valley` | 1 | 15 | 2020-10-06 | 2020-12-21 |
| `Grace and Stella` | 2 | 14 | 2019-05-24 | 2020-03-19 |
| `*Laidback` | 1 | 14 | 2021-03-10 | 2023-03-03 |
| `*Island nut Roastery` | 1 | 14 | 2021-10-20 | 2022-09-01 |
| `2016:2017 Clients (Abandoned)` | 1 | 14 | 2015-10-29 | 2016-02-10 |
| `Vegpro: Salad Etc` | 1 | 14 | 2023-05-09 | 2023-06-01 |
| `Carmanah Tech Corp.` | 1 | 14 | 2019-03-09 | 2019-08-13 |
| `Town Hall Brands` | 1 | 14 | 2018-05-15 | 2019-03-22 |
| `New Vision Projects` | 1 | 14 | 2017-11-30 | 2019-01-14 |
| `Pacific Bottle Works` | 1 | 14 | 2016-09-29 | 2016-12-15 |
| _…and 425 more — full list in the CSV, `classification_status = UNCLASSIFIED`_ | | | | |

Sizing the follow-up: ~11 batches of 50 at the previous pass's rate (~$0.0009 per name) ≈ **$0.49**.

---

## Current state of the client list

| Measure | Value |
|---|---|
| Names carrying `client` | 1,446 |
| Files under those names | 63,446 |
| Names unjudged | 545 |
| Files under unjudged names | 8,393 |
| Files under no name at all | 982 |
| — of which newly orphaned by this pass | 136 |

`dist/inventory/resolved-clients.csv` carries every name with its `classification_status` (`classified` / `UNCLASSIFIED`), plus the label, canonical name, confidence, and retention carried over from the AI pass where one exists.

---

## Reproducing

```bash
node <scratchpad>/resolve-batches.mjs
```

Reads two CSVs, writes two files, makes no network call. The skip list lives in `grants-lib.mjs` as `MODEL_BATCH_NAMES`.
