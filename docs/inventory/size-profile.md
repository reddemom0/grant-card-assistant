# Corpus Size Profile

**Inputs:** `dist/inventory/grants-inventory.csv`, `dist/inventory/full-mapping.csv`, `dist/inventory/client-status.csv`
**Read-only.** No file contents were read, no API called, nothing copied or excluded. Sizes come from Dropbox metadata in the inventory.

**74,473 files, 43.45 GB.** This is the Grants tree outside CanExport — the corpus the full copy would move. CanExport's 1,498 files are already in Drive and are not counted here.

Bytes are counted once per file. 303 files are dual-filed into two client folders; they are one file each here.

## Step 1 — bytes by route, and by extension

| Route | Files | Bytes | Share |
|---|---|---|---|
| sort | 56,887 | 26.05 GB | 59.9% |
| archive | 13,221 | 11.02 GB | 25.4% |
| program | 4,365 | 6.38 GB | 14.7% |
| **Total** | **74,473** | **43.45 GB** | |

### The 15 largest extensions by total size

| Extension | Files | Bytes | Share | Mean file |
|---|---|---|---|---|
| `.pdf` | 52,634 | 24.31 GB | 55.9% | 484 KB |
| `.mp4` | 66 | 8.81 GB | 20.3% | 136.7 MB |
| `.docx` | 10,454 | 1.87 GB | 4.3% | 187 KB |
| `.m4a` | 53 | 1.48 GB | 3.4% | 28.7 MB |
| `.jpg` | 1,224 | 1.31 GB | 3.0% | 1.1 MB |
| `.zip` | 162 | 1.09 GB | 2.5% | 6.9 MB |
| `.mov` | 10 | 1.07 GB | 2.5% | 109.3 MB |
| `.mp3` | 11 | 0.97 GB | 2.2% | 90.0 MB |
| `.png` | 2,318 | 0.71 GB | 1.6% | 323 KB |
| `.xlsx` | 3,379 | 0.43 GB | 1.0% | 135 KB |
| `.pptx` | 41 | 0.31 GB | 0.7% | 7.8 MB |
| `.tif` | 9 | 0.23 GB | 0.5% | 26.0 MB |
| `.(none)` | 197 | 0.15 GB | 0.3% | 806 KB |
| `.jpeg` | 216 | 0.14 GB | 0.3% | 695 KB |
| `.eml` | 345 | 0.09 GB | 0.2% | 286 KB |

Those 15 are 98.9% of all bytes.

### Extension mix within each route

**sort** — 26.05 GB: `.pdf` 14.36 GB, `.mp4` 6.65 GB, `.zip` 1.01 GB, `.docx` 1017.8 MB, `.m4a` 990.2 MB, `.jpg` 506.6 MB, `.png` 445.4 MB, `.xlsx` 313.8 MB

**archive** — 11.02 GB: `.pdf` 8.50 GB, `.jpg` 792.5 MB, `.docx` 563.3 MB, `.m4a` 316.3 MB, `.png` 247.6 MB, `.tif` 234.4 MB, `.xlsx` 94.5 MB, `.(none)` 69.1 MB

**program** — 6.38 GB: `.mp4` 2.15 GB, `.pdf` 1.44 GB, `.mov` 1.03 GB, `.mp3` 889.9 MB, `.docx` 328.8 MB, `.m4a` 213.4 MB, `.pptx` 172.0 MB, `.jpg` 39.2 MB

---

## Step 3 — size distribution

| Percentile | Size |
|---|---|
| median (p50) | 119 KB |
| p75 | 304 KB |
| p90 | 1015 KB |
| p99 | 4.6 MB |
| max | 650.0 MB |
| mean | 612 KB |

**The largest 1% of files — 745 of 74,473 — account for 18.66 GB, or 43.0% of the total.** The largest 10% account for 74.3%.

This is a corpus of small documents with a heavy tail. The median file is well under a megabyte; a few hundred media files carry a large share of the volume.

| Band | Files | Share of files | Bytes | Share of bytes |
|---|---|---|---|---|
| under 100 KB | 33,597 | 45.1% | 1.56 GB | 3.6% |
| 100 KB – 1 MB | 33,492 | 45.0% | 9.67 GB | 22.3% |
| 1 – 10 MB | 7,091 | 9.5% | 16.31 GB | 37.5% |
| 10 – 100 MB | 251 | 0.3% | 6.51 GB | 15.0% |
| over 100 MB | 42 | 0.1% | 9.41 GB | 21.7% |

---

## Step 4 — media

| Category | Files | Bytes | Share of total | Mean file |
|---|---|---|---|---|
| Video (mp4, mov, avi, wmv) | 77 | 9.95 GB | 22.9% | 132.3 MB |
| Audio (mp3, m4a, wav) | 64 | 2.45 GB | 5.6% | 39.2 MB |
| Images over 5 MB | 36 | 0.42 GB | 1.0% | 11.8 MB |
| **Combined** | **177** | **12.82 GB** | **29.5%** | |

Media is **0.2% of files but 29.5% of bytes.**

**Video** — top programs: BuyBC 1.35 GB, WAGE Funding 1.08 GB, ETG (Employer Training Grant) 1.03 GB, Accelerated Manufacturing Grant 748.9 MB, Food Storage, Distribution and Retail Program 620.6 MB

**Video** — top clients: SAAM Towage 680.0 MB, Liquid & Solids 650.0 MB, Northyards 645.7 MB, B Collective 527.9 MB, BCollective 369.5 MB

**Audio** — top programs: ETG (Employer Training Grant) 518.5 MB, WAGE Funding 382.9 MB, AgriMarketing 236.5 MB, CPF 204.1 MB, Creative Export 151.8 MB

**Audio** — top clients: Left Coast Naturals 167.8 MB, SAAM Towage 141.9 MB, Paintillio 107.5 MB, LifeSpace 100.5 MB, Surrey604 88.4 MB

**Images over 5 MB** — top programs: BuyBC 256.4 MB, ETG (Employer Training Grant) 31.0 MB, CPF 28.6 MB, Talent Opportunities 27.8 MB, DS4Y - VCN 21.5 MB

**Images over 5 MB** — top clients: Bittered Sling 234.4 MB, Scout 28.6 MB, Fernie Brewing 22.0 MB, Marwick Marketing 21.5 MB, Enhanced Performance 16.5 MB

---

## Step 5 — pruning categories

**Counted, not acted on.** Nothing is excluded from the mapping; every file still migrates. These are the same string and size signals reported in the full mapping, now priced in bytes.

| Signal | Files | Bytes | Share of total |
|---|---|---|---|
| Under `Old Folders` / `z_Old` / `1.DELETE` and similar | 5,167 | 1.65 GB | 3.8% |
| Filename marks it template / blank / sample | 1,122 | 0.34 GB | 0.8% |
| Redundant copies, same size + same name | 6,338 | 2.27 GB | 5.2% |
| **Combined, de-overlapped** | **11,618** | **3.96 GB** | **9.1%** |

The three overlap, so the combined row counts each file once rather than summing the rows above it.

⚠️ **The redundancy figure is a proxy.** The inventory carries no content hash, so this counts files sharing an exact byte size *and* an identical filename — 4,302 such groups. Strong evidence, not proof. Confirming it means hashing, which means downloading.

---

## Step 6 — bytes by client

| # | Client | Status | Files | Bytes | Share |
|---|---|---|---|---|---|
| 1 | (no client — program or unfiled) | — | 4,365 | 6.38 GB | 14.7% |
| 2 | SAAM Towage | Live | 651 | 1.22 GB | 2.8% |
| 3 | Bittered Sling | Archived | 507 | 0.95 GB | 2.2% |
| 4 | Liquid & Solids | Archived | 66 | 0.65 GB | 1.5% |
| 5 | Northyards | Archived | 38 | 0.64 GB | 1.5% |
| 6 | Forecast | Archived | 12 | 0.64 GB | 1.5% |
| 7 | B Collective | Archived | 103 | 0.59 GB | 1.4% |
| 8 | Left Coast Naturals | Archived | 719 | 0.59 GB | 1.4% |
| 9 | Level Ground Trading | Archived | 706 | 0.52 GB | 1.2% |
| 10 | Paintillio | Archived | 153 | 0.50 GB | 1.1% |
| 11 | BCollective | Archived | 29 | 0.46 GB | 1.1% |
| 12 | NACO | Archived | 39 | 0.45 GB | 1.0% |
| 13 | Horizon | Archived | 780 | 0.43 GB | 1.0% |
| 14 | Intercity Packers | Archived | 421 | 0.42 GB | 1.0% |
| 15 | The Acorn | Archived | 259 | 0.38 GB | 0.9% |
| 16 | Keystone Environmental | Live | 985 | 0.34 GB | 0.8% |
| 17 | Islands West | Archived | 3 | 0.34 GB | 0.8% |
| 18 | Fresh Prep | Archived | 590 | 0.30 GB | 0.7% |
| 19 | Scout | Archived | 228 | 0.29 GB | 0.7% |
| 20 | BNAC | Archived | 4 | 0.29 GB | 0.7% |
| 21 | Herschel Supply Co. | Archived | 312 | 0.28 GB | 0.6% |
| 22 | Fort Distillery | Archived | 28 | 0.27 GB | 0.6% |
| 23 | Fernie Brewing | Archived | 269 | 0.27 GB | 0.6% |
| 24 | Vegpro | Archived | 48 | 0.27 GB | 0.6% |
| 25 | Caliber | Archived | 1,185 | 0.26 GB | 0.6% |
| 26 | Kirmac | Archived | 1,299 | 0.25 GB | 0.6% |
| 27 | Urban Digs Farm | Archived | 128 | 0.25 GB | 0.6% |
| 28 | Blue Ocean Tea | Archived | 81 | 0.24 GB | 0.6% |
| 29 | Spreadem | Archived | 17 | 0.24 GB | 0.5% |
| 30 | Clarus | Archived | 556 | 0.22 GB | 0.5% |
| 31 | Windfall Cider | Archived | 57 | 0.19 GB | 0.4% |
| 32 | Trotman | Archived | 664 | 0.19 GB | 0.4% |
| 33 | Clir | Archived | 481 | 0.19 GB | 0.4% |
| 34 | Twin Lions | Archived | 393 | 0.19 GB | 0.4% |
| 35 | ClearDent | Live | 503 | 0.18 GB | 0.4% |
| 36 | Marine Drive Golf Club | Archived | 256 | 0.18 GB | 0.4% |
| 37 | BEC | Archived | 51 | 0.17 GB | 0.4% |
| 38 | Wise Bites | Archived | 54 | 0.17 GB | 0.4% |
| 39 | Carmanah Technologies | Archived | 280 | 0.17 GB | 0.4% |
| 40 | ICMS | Archived | 337 | 0.17 GB | 0.4% |
| 41 | Maison Apothecare | Archived | 36 | 0.17 GB | 0.4% |
| 42 | MET Printers | Archived | 137 | 0.16 GB | 0.4% |
| 43 | Hon's | Archived | 127 | 0.16 GB | 0.4% |
| 44 | Ledcor | Archived | 621 | 0.16 GB | 0.4% |
| 45 | Workshop Vegetarian | Archived | 38 | 0.15 GB | 0.4% |
| 46 | Organika | Archived | 222 | 0.15 GB | 0.3% |
| 47 | Nightingale Electrical | Live | 651 | 0.14 GB | 0.3% |
| 48 | LifeSpace | Archived | 83 | 0.14 GB | 0.3% |
| 49 | Primex | Archived | 308 | 0.14 GB | 0.3% |
| 50 | Spare Labs | Archived | 746 | 0.14 GB | 0.3% |

### Live versus Archived

| | Files | Bytes | Share |
|---|---|---|---|
| Live clients | 6,112 | 2.79 GB | 6.4% |
| Archived clients | 63,947 | 34.27 GB | 78.9% |
| No client (program / unfiled) | 4,414 | 6.38 GB | 14.7% |

**Live clients are 6.4% of the corpus.** That is the number to hold against any argument for copying only current work: the other 93.6% is history and program material.

---

## Step 7 — bytes by mapped year

| Year | Files | Bytes | Share |
|---|---|---|---|
| 1970 | 1 | 0.00 GB | 0.0% |
| 2000 | 7 | 0.00 GB | 0.0% |
| 2003 | 3 | 0.00 GB | 0.0% |
| 2013 | 4 | 0.01 GB | 0.0% |
| 2014 | 23 | 0.06 GB | 0.1% |
| 2015 | 2,461 | 2.47 GB | 5.7% |
| 2016 | 6,350 | 6.49 GB | 14.9% |
| 2017 | 5,359 | 4.46 GB | 10.3% |
| 2018 | 2,810 | 1.43 GB | 3.3% |
| 2019 | 4,588 | 1.47 GB | 3.4% |
| 2020 | 5,992 | 1.78 GB | 4.1% |
| 2021 | 14,329 | 6.68 GB | 15.4% |
| 2022 | 13,009 | 7.89 GB | 18.2% |
| 2023 | 10,059 | 6.24 GB | 14.4% |
| 2024 | 5,669 | 3.17 GB | 7.3% |
| 2025 | 2,964 | 1.01 GB | 2.3% |
| 2026 | 841 | 0.28 GB | 0.7% |
| 2031 | 4 | 0.00 GB | 0.0% |

Year is the mapped year — first sub-path segment, else a discarded batch level, else `client_modified`. It is the year the file is filed under, not necessarily the year it was authored.

---

## Step 2 — the 200 largest files

| # | Size | Ext | Route | Client | Source path |
|---|---|---|---|---|---|
| 1 | 650.0 MB | `mp4` | sort | Liquid & Solids | `Accelerated Manufacturing Grant/Clients/Liquid & Solids/zoom_0.mp4` |
| 2 | 636.9 MB | `zip` | sort | Forecast | `BCAFE/2024 Clients/Forecast/Photos-20250314T215044Z-001.zip` |
| 3 | 614.9 MB | `mp4` | program | — | `Jobs Growth Fund/Granted/Jobs Growth Aug 19.mp4` |
| 4 | 540.1 MB | `mp4` | sort | Northyards | `BuyBC/2022 Clients/*Northyards/Northyards BuyBC RA Nov 12 2021.mp4` |
| 5 | 527.9 MB | `mp4` | sort | B Collective | `Housing Supply Challenge/B Collective/RA Call/video1548645173.mp4` |
| 6 | 454.0 MB | `mov` | program | — | `WAGE Funding/WAGE ONAIS Video.mov` |
| 7 | 314.5 MB | `mp4` | program | — | `WAGE Funding/WAGE Chat with Coralus.mp4` |
| 8 | 307.2 MB | `mp4` | sort | NACO | `WES/NACO/WES NACO Recording Mar 4 2022.mp4` |
| 9 | 300.5 MB | `mp4` | sort | Islands West | `Food Storage, Distribution and Retail Program/Clients/Islands West/Fresh Direct_Islands West Interview call  - Oct 19 2023.mp4` |
| 10 | 286.3 MB | `mov` | program | — | `WAGE Funding/WAGE Application Walkthrough - Video.mov` |
| 11 | 276.0 MB | `mp4` | sort | SAAM Towage | `Green Shipping/SAAM Towage/2024-02-13 08.34.29 Green Shipping Review/video1160837592.mp4` |
| 12 | 263.9 MB | `mp4` | sort | The Acorn | `Good Spark/Acorn/video1959622586.mp4` |
| 13 | 258.2 MB | `mp4` | sort | Fort Distillery | `CAP Value-Added/Fort Distillery/2022-04-26 13.33.12 Nathan Flim_ CAP Value-Added RA/video1378283679.mp4` |
| 14 | 257.3 MB | `mp4` | sort | BNAC | `Greening Government/BNAC/video1774671804.mp4` |
| 15 | 213.0 MB | `mp4` | sort | BCollective | `Good Spark/BCollective/video1052689530.mp4` |
| 16 | 198.7 MB | `mp4` | sort | SAAM Towage | `Green Shipping/SAAM Towage/Additional Information/video1263992236.mp4` |
| 17 | 193.8 MB | `mp3` | program | — | `ETG (Employer Training Grant)/CJG Reference Docs/BC/Discussions/Richard Jun 24 2021.MP3` |
| 18 | 180.1 MB | `mp4` | sort | Vegpro | `Food Storage, Distribution and Retail Program/Clients/Salad Etc!/FSDR Project review - Jon_Lauren  - Oct 20 2023.mp4` |
| 19 | 171.6 MB | `mp4` | program | — | `ETG (Employer Training Grant)/ETG Business Case Bank/*BASIC BC*/Business Case Training May 2022.mp4` |
| 20 | 171.6 MB | `mp4` | program | — | `ETG (Employer Training Grant)/ETG Business Case Bank 2/*BASIC BC*/Business Case Training May 2022.mp4` |
| 21 | 168.9 MB | `mp4` | sort | SAAM Towage | `CVP/SAAM Towage/video1298108573.mp4` |
| 22 | 160.9 MB | `mp4` | sort | Spreadem | `BSP/Spreadem/video1866553393.mp4` |
| 23 | 156.5 MB | `mp4` | program | — | `Canada Summer Jobs/CSJ Training Jan 12 2018.mp4` |
| 24 | 156.5 MB | `mp4` | sort | BCollective | `CBBIF/BCollective/Meeting 1/video1647977427.mp4` |
| 25 | 155.3 MB | `mp4` | program | — | `ETG (Employer Training Grant)/*ETG - Team Docs/Training/ETG Training Video - Practical Walkthrough.mp4` |
| 26 | 154.0 MB | `mp3` | program | — | `WAGE Funding/Wage Info Call Review - Oct 11 2023.MP3` |
| 27 | 140.3 MB | `mp4` | program | — | `BC Recovery/Training Videos/Application Prep and Process.mp4` |
| 28 | 133.6 MB | `mov` | program | — | `ETG (Employer Training Grant)/*ETG - Team Docs/BCeID/CJG PIF Process New.mov` |
| 29 | 132.5 MB | `mp4` | sort | Fresh Prep | `BCASMDP (Agri-Food Market Development Program)/2022 Clients/Fresh Prep/Stephanie_Sang's_RingCentral_Video_meeting_2021-11-30T20_59_52.353Z.mp4` |
| 30 | 132.2 MB | `mp4` | sort | MRC Liquids & Solids | `Innovation Booster/MRC Liquids & Solids/Stephanie_Sang's_RingCentral_Video_meeting_2022-01-12T17_30_37.452Z.mp4` |
| 31 | 131.9 MB | `mp4` | sort | Paintillio | `Creative Export/Paintillio/2023/Export Development Stream 2023/video1026074101.mp4` |
| 32 | 124.8 MB | `mp4` | sort | MET Printers | `ETG (Employer Training Grant)/ETG-BC Applications 2022/Met Printers/Additional Documents/Explaination Video with Steph/zoom_0.mp4` |
| 33 | 115.5 MB | `mp4` | sort | Paintillio | `Creative Export/Paintillio/2023/Export Ready Stream 2023/video1869338954.mp4` |
| 34 | 113.0 MB | `mp4` | sort | Windfall Cider | `BuyBC/2022 Clients/*Windfall Cider/Recording.mp4` |
| 35 | 109.2 MB | `mp3` | program | — | `ETG (Employer Training Grant)/CJG Reference Docs/BC/Discussions/Richard May 14 2021.MP3` |
| 36 | 109.2 MB | `mp3` | program | — | `ETG (Employer Training Grant)/cjg reference docs/BC/ETG Richard Part 1.MP3` |
| 37 | 108.6 MB | `mp4` | sort | Wise Bites | `BCASMDP (Agri-Food Market Development Program)/2022 Clients/Wise Bites/Wise Bites MDP Recording Nov 30 2022.mp4` |
| 38 | 105.6 MB | `mp4` | sort | Northyards | `BuyBC/2022 Clients/*Northyards/Northyards BuyBC RA Nov 12 2021 Compressed.mp4` |
| 39 | 105.5 MB | `mp4` | sort | Blue Ocean Teaz | `Food Storage, Distribution and Retail Program/Clients/Blue Ocean Teaz/BOT & Granted FSDR Interview  - Oct 19 2023.mp4` |
| 40 | 101.9 MB | `mp4` | sort | Blue Ocean Tea | `BCASMDP (Agri-Food Market Development Program)/2022 Clients/Blue Ocean Tea/Blue Ocean MDP Recording.mp4` |
| 41 | 101.3 MB | `mp4` | sort | Paintillio | `Creative Export/Paintillio/2023/Export Ready Stream 2023/video1468569506.mp4` |
| 42 | 100.5 MB | `mp3` | sort | LifeSpace | `Accelerated Manufacturing Grant/Clients/LifeSpace/Lifespace AMG.MP3` |
| 43 | 98.0 MB | `mp4` | program | — | `ETG (Employer Training Grant)/ETG TPs/TP Webinar July 22 2021.mp4` |
| 44 | 94.7 MB | `mp3` | program | — | `ETG (Employer Training Grant)/CJG Reference Docs/BC/Discussions/Richard May 7 2021.MP3` |
| 45 | 92.2 MB | `mp4` | sort | Workshop Vegetarian | `Agri-Assurance SME/Clients/Workshop Vegetarian/GMT20231023-203036_Recording_640x360.mp4` |
| 46 | 91.5 MB | `mp4` | sort | Maison Apothecare | `COIL/Maison Apothecare/video1546909709.mp4` |
| 47 | 91.2 MB | `mp4` | sort | Blue Ocean Tea | `BCASMDP (Agri-Food Market Development Program)/2020 clients/Blue Ocean Tea/Claim Docs/Claim 1 (July 19)/Claim 1 Recording.mp4` |
| 48 | 89.6 MB | `m4a` | sort | SAAM Towage | `Green Shipping/SAAM Towage/2024-02-13 08.34.29 Green Shipping Review/audio1160837592.m4a` |
| 49 | 88.4 MB | `m4a` | archive | Surrey604 | `CPF/Client Folder/2017:2018 Clients/Surrey604 (Abandoned)/Recording - Feb 15 2017.m4a` |
| 50 | 85.9 MB | `mp4` | sort | Island Nut Roastery | `BuyBC/2022 Clients/*Island nut Roastery/BuyBC Island Nut 2022.mp4` |
| 51 | 84.3 MB | `m4a` | sort | Left Coast Naturals | `AgriMarketing/Clients 2017:18/Left Coast Naturals/Notes/Phone Call with R&R April 17 2018.m4a` |
| 52 | 83.5 MB | `m4a` | sort | Left Coast Naturals | `AgriMarketing/Clients 2017:18/Left Coast Naturals/Notes/Left Coast - AgriMarketing - Recording - Aug 10, 2017.m4a` |
| 53 | 82.8 MB | `mp4` | sort | Laidback | `BuyBC/2022 Clients/*Laidback/LaidBack BuyBC Discussion.mp4` |
| 54 | 82.1 MB | `mp4` | sort | Digital One | `Accelerated Manufacturing Grant/Clients/Digital One/zoom_0.mp4` |
| 55 | 76.2 MB | `wmv` | sort | Left Coast Naturals | `BuyBC/2016:2017 Clients/Left Coast Naturals 2016/Midterm (Jun 6, 2017-Dec 31, 2016)/Reference/Deliverables/Outputs-Approved Materials/2.4 Hippie Foods Buy Local Vid 1.wmv` |
| 56 | 71.0 MB | `zip` | sort | BEC | `EAF/BEC/Store Photos.zip` |
| 57 | 69.3 MB | `mp4` | sort | Vegpro | `Food Processing Growth Fund/Clients/Vegpro: Salad Etc/RA recording.mp4` |
| 58 | 68.7 MB | `m4a` | archive | GIPT | `AgriMarketing/Clients 2018:19/GIPT/Notes/GIPT Recording.m4a` |
| 59 | 68.2 MB | `mov` | program | — | `BuyBC/Training audio/BC Buy Local 2.mov` |
| 60 | 67.2 MB | `mp4` | sort | Windfall Cider | `BuyBC/2022 Clients/*Windfall Cider/Windfall RA BuyBC Nov 12 2021 Compressed.mp4` |
| 61 | 66.8 MB | `mp4` | sort | Elias Honey | `BuyBC/2021 clients/Elias Honey/Approval Doc/Elias Honey Approval Review BuyBC.mp4` |
| 62 | 66.4 MB | `mp4` | program | — | `ETG (Employer Training Grant)/CAJG/Training/CJG AB Training - Overall.mp4` |
| 63 | 62.1 MB | `mp4` | program | — | `ETG (Employer Training Grant)/*ETG - Team Docs/Training/Training Provider Course Outline.mp4` |
| 64 | 61.1 MB | `mp4` | program | — | `Career Launcher Internships (inc DS4Y DT)/DS4Y - Digital Tech Stream/2021 Clients/zoom_0.mp4` |
| 65 | 59.7 MB | `mp3` | program | — | `WAGE Funding/ZOOM0101.MP3` |
| 66 | 59.3 MB | `mp4` | sort | Workshop Vegetarian | `BuyBC/2023 Clients/The Workshop Vegetarian/Interview call.mp4` |
| 67 | 58.8 MB | `mp4` | sort | Laid Back Snacks | `BCASMDP (Agri-Food Market Development Program)/2022 Clients/Laid Back Snacks/Laid Back Snacks BCMDP.mp4` |
| 68 | 57.9 MB | `m4a` | archive | Retail Insider | `CPF/Client Folder/2017:2018 Clients/Retail Insider/Notes/Retail Insider - Feb 23 2017.m4a` |
| 69 | 57.9 MB | `m4a` | program | — | `CPF/Retail Insider - Feb 23 2017.m4a` |
| 70 | 53.9 MB | `mp3` | program | — | `WAGE Funding/ZOOM0102.MP3` |
| 71 | 53.0 MB | `pdf` | sort | Lendingarch Financial | `Alberta Innovates - Digital Traction/2021 Clients/LendingArch Financial/LendingArch - Digital Traction Submission.pdf` |
| 72 | 52.7 MB | `mp3` | program | — | `WAGE Funding/ZOOM0100.MP3` |
| 73 | 51.1 MB | `mov` | program | — | `WAGE Funding/Questions from Wage Webinar - Video.mov` |
| 74 | 50.6 MB | `pptx` | program | — | `ETG (Employer Training Grant)/ETG TPs/TP Course Info + Course Outlines (* means TP paying GC)/TP - Spark*/Culture Leadership Program (1 year)/CultureLeadership_InfoSession_2016Nov18.pptx` |
| 75 | 50.3 MB | `mp4` | sort | Umyum Foods | `Food Safety/2023 Clients/Umyum Foods/Interview Recording.mp4` |
| 76 | 49.8 MB | `mp4` | program | — | `YESP/YESP Opps Training June 9 2021.mp4` |
| 77 | 49.4 MB | `m4a` | sort | BCollective | `CBBIF/BCollective/Meeting 1/audio1647977427.m4a` |
| 78 | 48.1 MB | `m4a` | sort | Paintillio | `Creative Export/Paintillio/2023/Export Development Stream 2023/audio1026074101.m4a` |
| 79 | 48.0 MB | `m4a` | sort | B Collective | `Housing Supply Challenge/B Collective/RA Call/audio1548645173.m4a` |
| 80 | 46.9 MB | `mp4` | program | — | `GYW (Youth Hiring Subsidy)/Training/GRA002 - How to apply for GYW - WATCH ME!.mp4` |
| 81 | 44.9 MB | `docx` | archive | Fernie Brewing | `BuyBC/2016:2017 Clients/Fernie Brewing 2016/Final Report/Editted/Rough draft/FB rough report.docx` |
| 82 | 44.7 MB | `pdf` | sort | ICMS | `BioTalent SWPP/2022/ICMS/Research tech- Angela/Employment Contract_Angela Jennings_Signed (1).pdf` |
| 83 | 44.3 MB | `m4a` | sort | GameOn | `Creative Export/GameON/CEC GameOn Chat.m4a` |
| 84 | 44.0 MB | `m4a` | sort | Paintillio | `Creative Export/Paintillio/2023/Export Ready Stream 2023/audio1869338954.m4a` |
| 85 | 44.0 MB | `m4a` | sort | Islands West | `Food Storage, Distribution and Retail Program/Clients/Islands West/Part 2/audio1970536841.m4a` |
| 86 | 43.0 MB | `m4a` | sort | BNAC | `Greening Government/BNAC/audio1774671804.m4a` |
| 87 | 40.1 MB | `mp4` | sort | Spreadem | `BuyBC/2023 Clients/Spreadem/Interview call.mp4` |
| 88 | 39.9 MB | `pptx` | program | — | `WorkXP/2022/Strat Team Training Session/WorkXP Presentation.pptx` |
| 89 | 38.8 MB | `pdf` | sort | NACO | `WES/NACO/Research/FoundHers Report 2021.pdf` |
| 90 | 38.6 MB | `mp3` | program | — | `WAGE Funding/ZOOM0103.MP3` |
| 91 | 38.3 MB | `m4a` | program | — | `Food Storage, Distribution and Retail Program/Documents/Application review and RA intro.m4a` |
| 92 | 37.5 MB | `pdf` | sort | SAAM Towage | `CVP/SAAM Towage/Submission/Technical_Docs.pdf` |
| 93 | 36.3 MB | `mov` | sort | SAAM Towage | `Green Shipping/SAAM Towage/Photos/IMG_9331.MOV` |
| 94 | 35.6 MB | `m4a` | sort | Fine Choice Foods | `Food Processing Growth Fund/Clients/Fine Choice Foods/Interview Call.m4a` |
| 95 | 34.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/COCKTAILS/CRD_9324-Edit.tif` |
| 96 | 34.4 MB | `mp4` | sort | HPP Tolling | `Food Storage, Distribution and Retail Program/Clients/HPP tolling/FSDR Interview call - Lauren_Patricia - Oct 20 2023.mp4` |
| 97 | 33.7 MB | `m4a` | sort | SAAM Towage | `CVP/SAAM Towage/audio1298108573.m4a` |
| 98 | 33.6 MB | `pdf` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Photography:Book/Bittered Sling Booklet Assets/Booklet High Res/BitteredSlingBooklet_guts_FINAL_070516.pdf` |
| 99 | 32.8 MB | `pdf` | program | — | `Rhyze Up!/Rhyze-Up-FAQ-Oct-2023.pdf` |
| 100 | 32.4 MB | `m4a` | archive | PHOX | `Investment Readiness/PHOX/Phox Foods IRP.m4a` |
| 101 | 31.5 MB | `m4a` | sort | Nemesis | `BuyBC/2023 Clients/Nemesis/Interview for both comissary and roastery.m4a` |
| 102 | 31.4 MB | `pdf` | archive | Fernie Brewing | `BuyBC/2016:2017 Clients/Fernie Brewing 2016/Mid Term Report/BL259 Fernie Deliverables Report.pdf` |
| 103 | 30.0 MB | `docx` | archive | Fernie Brewing | `BuyBC/2016:2017 Clients/Fernie Brewing 2016/Mid Term Report/BL259 Fernie Deliverables Report.docx` |
| 104 | 29.3 MB | `m4a` | sort | The Acorn | `Good Spark/Acorn/audio1959622586.m4a` |
| 105 | 28.9 MB | `mp4` | sort | Point Blank Creative | `ETG (Employer Training Grant)/Old Folders/ETG-BC Applications 2020x/Point Blank Creative/Overview of Within People - Course Outline.mp4` |
| 106 | 28.7 MB | `m4a` | sort | Spreadem | `BSP/Spreadem/audio1866553393.m4a` |
| 107 | 28.6 MB | `mp4` | sort | Juke Fried Chicken | `BuyBC/2023 Clients/Juke Fried Chicken/Interview call.mp4` |
| 108 | 27.8 MB | `m4a` | sort | Maison Apothecare | `COIL/Maison Apothecare/audio1546909709.m4a` |
| 109 | 27.6 MB | `pdf` | sort | Left Coast Naturals | `AgriMarketing/Clients 2017:18/Left Coast Naturals/Final Report/Receipts/Locations/Activity 1 - Baltimore (2) Sept 13 - 17/Per Diem/Per Diem - Thomas.pdf` |
| 110 | 27.5 MB | `m4a` | program | — | `Women Entrepreneur Fund/*Submitted/Ainsliewear/Ainsliewear WEF.m4a` |
| 111 | 27.5 MB | `m4a` | program | — | `Jobs Growth Fund/Granted/Steph Intro Aug 9 2021.m4a` |
| 112 | 27.5 MB | `m4a` | sort | BCollective | `Good Spark/BCollective/audio1052689530.m4a` |
| 113 | 27.3 MB | `mp4` | program | — | `Venture for Canada/VFC Training.mp4` |
| 114 | 27.1 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/COCKTAILS/CRD_9351-Edit.tif` |
| 115 | 26.0 MB | `mov` | program | — | `Advanced Manufacturing - NGen/Step 3.mov` |
| 116 | 25.9 MB | `m4a` | program | — | `Women Entrepreneur Fund/*Submitted/Mine & Yours/Mine & Yours WEF.m4a` |
| 117 | 25.8 MB | `pdf` | archive | Scout | `CPF/Client Folder/2015:2016 Clients/Scout (Megan)/Scout 2014-2015 Submission/Scanned Submission w:o Financials/Scout Final 2.pdf` |
| 118 | 25.5 MB | `m4a` | archive | Pique | `Women Entrepreneur Fund/Pique/Pique Zoom Call/audio_only.m4a` |
| 119 | 24.9 MB | `pdf` | sort | Loren Nancke | `Talent Opportunities/Loren Nancke/Erika Bonifacio/Erika Bonifacio Signed Employment Contract.pdf` |
| 120 | 24.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/Bottles/_DSC2223.tif` |
| 121 | 24.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/Bottles/_DSC2229.tif` |
| 122 | 24.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/Bottles/_DSC2240.tif` |
| 123 | 24.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/Bottles/_DSC2237.tif` |
| 124 | 24.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/Bottles/_DSC2233.tif` |
| 125 | 24.8 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/Bottles/_DSC2244.tif` |
| 126 | 24.3 MB | `mp4` | program | — | `ETG (Employer Training Grant)/CAJG/Training/CJG AB Training - Application Form.mp4` |
| 127 | 24.1 MB | `m4a` | archive | Humanity | `Investment Readiness/Humanity/Humanity - IRP.m4a` |
| 128 | 24.0 MB | `mp3` | program | — | `WAGE Funding/ZOOM0104.MP3` |
| 129 | 23.7 MB | `tif` | archive | Bittered Sling | `BuyBC/2016:2017 Clients/Bittered Sling 2016/BSE Approval/GRANTED Bittered Sling Final Report - Deliverables + Receipts/Deliverables/Website/SHARED-EPIX-NoticeGroup/COCKTAILS/CRD_9335-Edit.tif` |
| 130 | 23.6 MB | `m4a` | sort | Refeed | `Investment Readiness/ReFeed/audio_only.m4a` |
| 131 | 23.5 MB | `pdf` | sort | Fable Kitchen | `DS4Y - VCN/DS4Y 2020 clients/Fable Kitchen/PIFs/ID.pdf` |
| 132 | 23.3 MB | `pptx` | program | — | `ICE FUnd/2026 ICE Fund - BC ECO.pptx` |
| 133 | 23.3 MB | `pdf` | program | — | `ETG (Employer Training Grant)/ETG TPs/TP Course Info + Course Outlines (* means TP paying GC)/TPs we dont work with anymore/TP - mQ Consulting/Intermediate Business Development 2018.pdf` |
| 134 | 23.2 MB | `pdf` | program | — | `ETG (Employer Training Grant)/ETG TPs/TP Course Info + Course Outlines (* means TP paying GC)/TPs we dont work with anymore/TP - mQ Consulting/Previous/Intro to Business Development 2017_2018.pdf` |
| 135 | 23.2 MB | `pdf` | archive | Coco Finaldi Yoga | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2017xx (Jan 2018 onwards)/Coco Finaldi Yoga/Intro to Business Development 2017_2018.pdf` |
| 136 | 23.2 MB | `pdf` | program | — | `ETG (Employer Training Grant)/ETG TPs/TP Course Info + Course Outlines (* means TP paying GC)/TPs we dont work with anymore/TP - mQ Consulting/Intermediate Business Development 2018 Bio.pdf` |
| 137 | 23.1 MB | `m4a` | sort | LBN Brands | `Investment Readiness/LBN Brands/LBN IRP.m4a` |
| 138 | 23.1 MB | `pdf` | program | — | `ETG (Employer Training Grant)/ETG TPs/TP Course Info + Course Outlines (* means TP paying GC)/TPs we dont work with anymore/TP - mQ Consulting/Previous/Intro to Business Development - Instructor Bio.pdf` |
| 139 | 23.1 MB | `pdf` | archive | Coco Finaldi Yoga | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2017xx (Jan 2018 onwards)/Coco Finaldi Yoga/Intro to Business Development - Instructor Bio.pdf` |
| 140 | 23.0 MB | `pdf` | program | — | `WorkBC Wage Subsidy/Client Files - 2022:2023 Fiscal/LNG/Cal Hui - Proj Mgr/Wage Subsidy Agreement_LNG Studios V02 (signed).pdf` |
| 141 | 22.9 MB | `pdf` | archive | Urban Digs Farm | `BuyBC/2015:2016 Clients/Urban Digs Farm/Mid Term Report/Summary/2. Graphic Design for Singage, Recipes, Advertising (Print:Online)/Urban Digs Signage(1).pdf` |
| 142 | 22.9 MB | `pdf` | archive | Urban Digs Farm | `BuyBC/2015:2016 Clients/Urban Digs Farm/Mid Term Report/Summary/2. Graphic Design for Signage, Recipes, Advertising (Print:Online)/Urban Digs Signage(1).pdf` |
| 143 | 22.7 MB | `pdf` | sort | Capital City News Group Ltd. | `Talent Opportunities/Capital City News Group Ltd./Summer 2022/Emma Boyne/Emma Boyne - Citizenship.pdf` |
| 144 | 22.6 MB | `pdf` | sort | Clarus | `BC Recovery/Clarus/2019 ADP report.pdf` |
| 145 | 22.5 MB | `pptx` | archive | Scout | `CPF/Client Folder/2015:2016 Clients/Scout (Megan)/Final Report/Scout Screenshots in PPT.pptx` |
| 146 | 22.0 MB | `pdf` | sort | LeadVantage | `ETG (Employer Training Grant)/ETG-BC Applications 2022/LeadVantage - OneOff/Coach-Training-With-Essential-Impact-2021.pdf` |
| 147 | 21.9 MB | `pdf` | archive | Re-Nu Wellness Clinic (Totality Living Inc.) | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2015-c Extension 2 (Q1 2016) - BC/Re-Nu Wellness Clinic (Totality Living Inc)/Totality Living (Re-Nu Wellness) - CJG1605476 - Schedule A & B, Letter_signed.pdf` |
| 148 | 21.5 MB | `png` | sort | Marwick Marketing | `DS4Y - VCN/DS4Y 2020 clients/Marwick Marketing/image.png` |
| 149 | 21.4 MB | `pdf` | sort | Fresh Prep | `BCASMDP (Agri-Food Market Development Program)/2022 Clients/Fresh Prep/Claims/Claim#1(June30)/Claim_1_Docs/Facebook_Invoices_May.pdf` |
| 150 | 21.4 MB | `mp4` | sort | More Than Just Feed | `AgriInnovation/Agrilinnovate 2023/Clients/More than just feed/RA.mp4` |
| 151 | 21.2 MB | `pdf` | sort | Ledcor | `Magnet SWPP/Ledcor/Fall 2022/Syed Faheem/Syed Faheem Uddin-31113-Structural and .pdf` |
| 152 | 20.7 MB | `pdf` | archive | mQ Consulting | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2015-c Extension 2 (Q1 2016) - BC/mQ Consulting/CJGAgreement1604948.PDF` |
| 153 | 20.7 MB | `pdf` | sort | Mak Physiotherapist | `Talent Opportunities/Mak Physiotherapist Co./Kristin McElroy - Passport.pdf` |
| 154 | 20.1 MB | `pdf` | archive | Scout | `CPF/Client Folder/2015:2016 Clients/Scout (Megan)/Scout 2014-2015 Submission/Scanned Submission w:o Financials/Scout Final 1.pdf` |
| 155 | 19.7 MB | `m4a` | sort | Fresh Prep | `AgriInnovation/Fresh Prep/audio_only.m4a` |
| 156 | 19.6 MB | `mov` | program | — | `BuyBC/Training audio/BC Buy Local 1.mov` |
| 157 | 19.6 MB | `pptx` | archive | Plan Genie | `Women Entrepreneur Fund/Plan Genie/Reference Docs/19Apr2018 BDC TEC Info session_FINAL.pptx` |
| 158 | 19.5 MB | `pdf` | archive | MountainBerry Landscaping | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2016x (October onwards)/MountainBerry Landscaping/Mountainberry Landscaping - CJG1702281 - Schedules and Agreement_signed.pdf` |
| 159 | 19.4 MB | `m4a` | program | — | `BCAFE/2024 Clients/audio1850662920.m4a` |
| 160 | 19.3 MB | `m4a` | archive | Plan Genie | `Women Entrepreneur Fund/Plan Genie/Inteview with Natrisha/audio_only.m4a` |
| 161 | 19.0 MB | `pdf` | sort | Keystone Environmental | `BioTalent SWPP/2025/Keystone/Maksymilian/KEL MSosnowski Coop Term Offer Letter - FILLED.pdf` |
| 162 | 18.8 MB | `pdf` | sort | NACO | `WES/NACO/Research/GSER_2019_Series_-_Insights_on_Female_Founders__Cleantech__Agtecn___New_Food.pdf` |
| 163 | 18.8 MB | `pdf` | sort | NACO | `WES/NACO/Research/Top Ecosystem Rankings for Female Founders, Agtech and Cleantech.pdf` |
| 164 | 18.7 MB | `pdf` | sort | Stillhead Distillery | `WorkBC Wage Subsidy/Client Files - 2021/Stillhead Distillery/Claims/Claim 2- June/Meagan-Time cards and pay documents.pdf` |
| 165 | 18.5 MB | `pdf` | sort | AME | `ECO Canada - Science Horizons/AME/Celina Wong/Report 1/Celina Wong Paystubs_Sept 15 to Jan 30.pdf` |
| 166 | 18.5 MB | `m4a` | sort | SAAM Towage | `Green Shipping/SAAM Towage/New Recording 125.m4a` |
| 167 | 18.4 MB | `pdf` | archive | Urban Digs Farm | `BuyBC/2015:2016 Clients/Urban Digs Farm/Mid Term Report/Summary/2. Graphic Design for Singage, Recipes, Advertising (Print:Online)/Urban Digs Signage(2).pdf` |
| 168 | 18.4 MB | `pdf` | archive | Urban Digs Farm | `BuyBC/2015:2016 Clients/Urban Digs Farm/Mid Term Report/Summary/6. Farm Market for Urban Digs/UrbanDigs_FarmEntranceSign_2_36x24inches_FINAL.pdf` |
| 169 | 18.4 MB | `pdf` | archive | Urban Digs Farm | `BuyBC/2015:2016 Clients/Urban Digs Farm/Mid Term Report/Summary/2. Graphic Design for Signage, Recipes, Advertising (Print:Online)/Urban Digs Signage(2).pdf` |
| 170 | 18.2 MB | `pdf` | archive | Scout | `CPF/Client Folder/2015:2016 Clients/Scout (Megan)/*SUBMISSION 2015/**Full Scout Application 2015_Scanned.pdf` |
| 171 | 18.1 MB | `pdf` | sort | ClearDent | `Innovate BC - ISI/2022 Clients/ClearDent/Antonmy Angkriwan - Marketing Coordinator/Reimbursement/Antony Paystubs.pdf` |
| 172 | 17.9 MB | `pdf` | archive | Align Your Space | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2016x (October onwards)/Align Your Space/Align Your Space - CJG 1702770 - Schedule A_signed.pdf` |
| 173 | 17.7 MB | `pptx` | sort | Maison Apothecare | `COIL/Maison Apothecare/MA_COIL_pitchdeck.pptx` |
| 174 | 17.7 MB | `pptx` | sort | Maison Apothecare | `I.D.E.A. Fund/Maison Apothecare/BDC.pptx` |
| 175 | 17.7 MB | `zip` | sort | Kirmac | `ETG (Employer Training Grant)/Old Folders/ETG-BC Applications 2021/Kirmac/May 2021/*NEW Business Cases.zip` |
| 176 | 17.7 MB | `zip` | sort | Kirmac | `ETG (Employer Training Grant)/Old Folders/ETG-BC Applications 2021/Kirmac/May 2021/*NEW Business Cases/Archive.zip` |
| 177 | 17.7 MB | `pdf` | archive | Access Information Technology | `DSYIP/Clients 2016:17/Access Information Technology/Access.pdf` |
| 178 | 17.7 MB | `pptx` | sort | Fatso Peanut Butter | `AgriMarketing/Clients 2019-2020/Fatso Peanut Butter/Barbours Nut Butter Capabilities rvd.pptx` |
| 179 | 17.7 MB | `pdf` | sort | SaltyFace | `WorkBC Wage Subsidy/Client Files - 2022:2023 Fiscal/SaltyFace/Taylor Stuart - Resume & Portfolio.pdf` |
| 180 | 17.5 MB | `pdf` | archive | Sterling Fleet | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/ETG-BC Applications 2019/Sterling Fleet/Business License/Sterling Fleet Biz License copy.pdf` |
| 181 | 17.3 MB | `xlsx` | sort | New:Mode | `DS4Y - Pinnguaq/2020 Clients/New:Mode/Final Claims/New:Mode-Claim-Advance-Sheet-2020-2021-v1.2-Template.xlsx` |
| 182 | 17.3 MB | `eml` | sort | Blue Ocean Tea | `BCASMDP (Agri-Food Market Development Program)/2022 Clients/Blue Ocean Tea/Fwd_ Trade Show Banner size for 10' x 10' booth.eml` |
| 183 | 17.3 MB | `pptx` | archive | Scout | `CPF/Client Folder/2015:2016 Clients/Scout (Megan)/Final Report/Scout Screenshots in PPT (Granted (2)'s conflicted copy 2015-05-26).pptx` |
| 184 | 17.2 MB | `pdf` | sort | Transitions Business Coaching | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2018xx/Transitions Business Coaching/Sample C-IQ-2017-Certification-Program-Participant-Handbook.pdf` |
| 185 | 16.9 MB | `mov` | program | — | `ETG (Employer Training Grant)/*ETG - Team Docs/BCeID/BCeID Process/BCeID Process Video.mov` |
| 186 | 16.8 MB | `mp4` | sort | LifeSpace | `Accelerated Manufacturing Grant/Clients/LifeSpace/Submission/AMG Lifespace Submission.mp4` |
| 187 | 16.8 MB | `m4a` | sort | Westpoint Naturals | `Manufacturing Jobs Fund/Clients/Westpoint Naturals/RA recording.m4a` |
| 188 | 16.6 MB | `zip` | sort | SAAM Towage | `CVP/SAAM Towage/Claims and Reporting/Interim Report - 2/Clean BC Grant - Claim 2.zip` |
| 189 | 16.4 MB | `pdf` | archive | Fernie Brewing | `BuyBC/2016:2017 Clients/Fernie Brewing 2016/Mid Term Report/Receipts.pdf` |
| 190 | 16.4 MB | `pdf` | program | — | `BuyBC/2016:2017 Clients/Level Ground 2016/Mid-Term Report - submitted Aug 1, 2017/Reference/Deliverables - see submission folder for combined/00. Deliverables - Combined USE SMALL IN MIDTERM FOLDER.pdf` |
| 191 | 16.2 MB | `pdf` | archive | Avenue PR | `Women Entrepreneur Fund/Avenue PR/Blacksand_AvenuePR_Nov1318.pdf` |
| 192 | 16.1 MB | `pdf` | sort | Level Ground Trading | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2016xx (Q1 2017)/Level Ground Trading/B App 1703524/Level Ground - CJG 1703524 Agreement -Signed.pdf` |
| 193 | 16.1 MB | `tiff` | sort | Coastal Reign | `Workplace Accessbility Grant/Coastal Reign/Coastal Reign Printing Mail - Thanks for shopping with us (#10324)2.tiff` |
| 194 | 16.0 MB | `pdf` | sort | Marine Drive Golf Club | `Propel SWPP/2022/Marine Drive Golf Club/Matthew/Matthew Rukavina - SWPP - Signed.pdf` |
| 195 | 16.0 MB | `pdf` | sort | Westpoint Naturals | `Manufacturing Jobs Fund/Clients/Westpoint Naturals/Westpoint Naturals _ Phase 1 FINAL (1) (1).pdf` |
| 196 | 15.9 MB | `pdf` | archive | Touch of Joy | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2016 Intake (April onwards) - Submitted/Touch of Joy/Touch of Joy - 2016 - CJG1701515 - Agreement_Sched A:B.pdf` |
| 197 | 15.7 MB | `pdf` | archive | LifeBooster Inc. | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2016xx (Q1 2017)/LifeBooster Inc/Appoval docs_signed.pdf` |
| 198 | 15.6 MB | `pdf` | archive | Steadfast | `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2016 Intake (April onwards) - Submitted/Steadfast/CJG - Steadfast .pdf` |
| 199 | 15.6 MB | `pdf` | sort | PHL Capital | `ETG (Employer Training Grant)/ETG-BC Applications 2024 : 2025 Intake/PHL Capital Co/Chief of Staff/NovaSyllabus.pdf` |
| 200 | 15.6 MB | `pdf` | sort | Marine Drive Golf Club | `Propel SWPP/2022/Marine Drive Golf Club/William/William Johnston - SWPP - Signed.pdf` |

Those 200 files are 14.78 GB, 34.0% of the corpus.

