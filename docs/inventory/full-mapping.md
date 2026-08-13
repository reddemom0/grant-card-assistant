# Full Corpus Mapping — all programs outside CanExport

**Inputs:** `dist/inventory/grants-inventory.csv`, `clients-final.csv`, `resolved-final.csv`, `canexport-mapping.csv`
**Read-only.** No Dropbox call, no Drive call, nothing copied, moved, renamed or deleted. Proposed filenames are phase-3 input and are not applied.
**Routing rules** come from `scripts/mapping-lib.mjs`, shared with the CanExport pass.

## Headline

| | Rows | Distinct files | Size |
|---|---|---|---|
| sort | 56,481 | 56,481 | 25.92 GB |
| program | 3,146 | 3,146 | 3.80 GB |
| archive | 12,574 | 12,574 | 10.72 GB |
| review | 2,575 | 2,272 | 3.05 GB |
| **Total** | **74,776** | **74,473** | **43.45 GB** |

Across **307 programs**. CanExport (2 programs, already mapped and copied) is excluded.

---

## Step 1 — how the logic was shared

**Extracted, not generalized.** The routing core is about 200 lines of pure logic; the other ~480 lines of `canexport-mapping.mjs` are a pilot-specific narrative with no analogue at corpus scale. Parameterizing the whole script would have dragged that report along, so the rules moved to `scripts/mapping-lib.mjs` and both passes import them.

**CanExport regenerates byte-identical.** `dist/inventory/canexport-mapping.csv` is unchanged (SHA-256 `1ebcfe18…`); `docs/inventory/canexport-pilot.md` differs only on its `**Generated:**` timestamp line. This run also re-maps CanExport through the library and asserts every row matches the committed CSV — if the library ever drifts, the run aborts.

---

## Step 3 — routing split per program (270)

| Program | Files | Size | sort | program | archive | review | review % |
|---|---|---|---|---|---|---|---|
| ETG (Employer Training Grant) | 29,489 | 16.37 GB | 17,724 | 1,774 | 9,082 | 955 | 3.2% |
| WorkBC Wage Subsidy | 15,406 | 3.22 GB | 15,059 | 71 | 0 | 487 | 3.1% |
| BuyBC | 1,984 | 3.54 GB | 634 | 198 | 1,107 | 45 | 2.3% |
| Magnet SWPP | 1,899 | 0.59 GB | 1,890 | 8 | 1 | 0 | 0.0% |
| Career Launcher Internships (inc DS4Y DT) | 1,628 | 0.37 GB | 1,280 | 50 | 265 | 33 | 2.0% |
| Mon Avenir | 1,247 | 0.46 GB | 1,199 | 4 | 0 | 44 | 3.5% |
| DS4Y - VCN | 1,166 | 0.24 GB | 1,064 | 6 | 44 | 96 | 7.9% |
| WIL Digital | 1,101 | 0.22 GB | 1,092 | 2 | 4 | 3 | 0.3% |
| GYW (Youth Hiring Subsidy) | 929 | 0.41 GB | 563 | 245 | 82 | 41 | 4.4% |
| DS4Y - LHL | 925 | 0.14 GB | 877 | 47 | 0 | 1 | 0.1% |
| DS4Y - Pinnguaq | 886 | 0.32 GB | 853 | 32 | 0 | 1 | 0.1% |
| Talent Opportunities | 834 | 0.42 GB | 826 | 6 | 0 | 2 | 0.2% |
| CPF | 807 | 0.71 GB | 0 | 26 | 622 | 159 | 19.7% |
| Career Ready (ITAC Technation) | 763 | 0.14 GB | 752 | 0 | 7 | 4 | 0.5% |
| Innovate BC - ISI | 743 | 0.20 GB | 712 | 4 | 19 | 8 | 1.1% |
| YESP | 604 | 0.30 GB | 569 | 16 | 11 | 8 | 1.3% |
| DS4Y - ICNJ | 552 | 0.22 GB | 545 | 5 | 0 | 2 | 0.4% |
| PSYIP (Grad Hiring Subsidy) | 498 | 0.20 GB | 60 | 42 | 316 | 80 | 16.1% |
| Green Jobs | 471 | 0.16 GB | 405 | 54 | 5 | 7 | 1.5% |
| Alberta Jobs Now | 462 | 0.08 GB | 461 | 1 | 0 | 0 | 0.0% |
| AgriMarketing | 443 | 0.55 GB | 398 | 14 | 24 | 7 | 1.6% |
| Get BC Working | 418 | 0.13 GB | 407 | 0 | 0 | 11 | 2.6% |
| DS4Y - Innovate BC | 417 | 0.06 GB | 391 | 22 | 2 | 2 | 0.5% |
| Venture for Canada | 403 | 0.16 GB | 396 | 5 | 0 | 2 | 0.5% |
| Trucking HR SWSP | 381 | 0.07 GB | 380 | 0 | 0 | 1 | 0.3% |
| Workplace Accessbility Grant | 360 | 0.16 GB | 360 | 0 | 0 | 0 | 0.0% |
| Opportunities Fund Program - BCA | 346 | 0.09 GB | 338 | 8 | 0 | 0 | 0.0% |
| Science Horizons - BioTalent | 328 | 0.12 GB | 320 | 8 | 0 | 0 | 0.0% |
| Food Processors (Career Focus) | 324 | 0.16 GB | 72 | 10 | 224 | 18 | 5.6% |
| UNAC-Green Corps-STIP | 317 | 0.12 GB | 315 | 2 | 0 | 0 | 0.0% |
| Food Processing SWPP | 291 | 0.10 GB | 239 | 4 | 0 | 48 | 16.5% |
| Canada Summer Jobs | 289 | 0.29 GB | 178 | 12 | 62 | 37 | 12.8% |
| iAdvance Pathways | 289 | 0.12 GB | 281 | 5 | 0 | 3 | 1.0% |
| Discovering Potential | 288 | 0.07 GB | 283 | 5 | 0 | 0 | 0.0% |
| Welcoming Newcomers | 287 | 0.05 GB | 287 | 0 | 0 | 0 | 0.0% |
| Agri-talent | 280 | 0.11 GB | 276 | 4 | 0 | 0 | 0.0% |
| LNG Grant | 274 | 0.05 GB | 76 | 24 | 170 | 4 | 1.5% |
| DSYIP | 272 | 0.16 GB | 44 | 9 | 200 | 19 | 7.0% |
| Career Starter (Biotalent) | 269 | 0.10 GB | 264 | 4 | 0 | 1 | 0.4% |
| Skilled Newcomer Bio-Economy | 258 | 0.10 GB | 250 | 8 | 0 | 0 | 0.0% |
| BioTalent SWPP | 245 | 0.14 GB | 239 | 6 | 0 | 0 | 0.0% |
| CVP | 239 | 0.41 GB | 234 | 0 | 0 | 5 | 2.1% |
| Women Entrepreneur Fund | 236 | 0.28 GB | 10 | 147 | 74 | 5 | 2.1% |
| Eco-Canada CO-OP | 210 | 0.07 GB | 210 | 0 | 0 | 0 | 0.0% |
| BCASMDP (Agri-Food Market Development Program) | 200 | 0.67 GB | 175 | 18 | 1 | 6 | 3.0% |
| ECO Canada-YNR:STIP | 199 | 0.06 GB | 198 | 0 | 0 | 1 | 0.5% |
| Destination Trade | 185 | 0.03 GB | 184 | 1 | 0 | 0 | 0.0% |
| Workers in Transition | 180 | 0.03 GB | 180 | 0 | 0 | 0 | 0.0% |
| WILWorks SWPP | 152 | 0.05 GB | 145 | 6 | 0 | 1 | 0.7% |
| Creative Employment Options | 149 | 0.03 GB | 148 | 1 | 0 | 0 | 0.0% |
| Trucking HR SWPP | 143 | 0.03 GB | 143 | 0 | 0 | 0 | 0.0% |
| ECO Canada - Science Horizons | 127 | 0.05 GB | 127 | 0 | 0 | 0 | 0.0% |
| Investment Readiness | 115 | 0.15 GB | 40 | 3 | 60 | 12 | 10.4% |
| DS4Y - 2023 | 111 | 0.03 GB | 111 | 0 | 0 | 0 | 0.0% |
| BC Maritime Industries Infrastructure Modernization and Expansion Grant Program | 111 | 0.07 GB | 111 | 0 | 0 | 0 | 0.0% |
| Eco Canada - Environmental Jobs Growth | 109 | 0.03 GB | 109 | 0 | 0 | 0 | 0.0% |
| BC Recovery | 96 | 0.23 GB | 43 | 47 | 0 | 6 | 6.3% |
| Agri-Export (BC) | 95 | 0.05 GB | 73 | 7 | 7 | 8 | 8.4% |
| Green Shipping | 84 | 0.72 GB | 81 | 0 | 0 | 3 | 3.6% |
| Opportunities Fund Program - STRIDES - ODG | 80 | 0.02 GB | 79 | 1 | 0 | 0 | 0.0% |
| ECO Canada-DS4Y | 76 | 0.03 GB | 74 | 0 | 0 | 2 | 2.6% |
| DS4Y - PCPI | 75 | 0.02 GB | 59 | 16 | 0 | 0 | 0.0% |
| EPF | 71 | 0.02 GB | 71 | 0 | 0 | 0 | 0.0% |
| Accelerated Manufacturing Grant | 70 | 0.85 GB | 63 | 0 | 0 | 7 | 10.0% |
| Science Horizons - Clean Foundations | 67 | 0.03 GB | 35 | 8 | 24 | 0 | 0.0% |
| Biotech Grant (Career Focus) | 64 | 0.04 GB | 8 | 6 | 45 | 5 | 7.8% |
| Eco Canada - Employability Pathways | 64 | 0.01 GB | 64 | 0 | 0 | 0 | 0.0% |
| AgriFoods - Green Jobs Initiative | 63 | 0.03 GB | 29 | 8 | 25 | 1 | 1.6% |
| Trucking HR - EWSY | 62 | 0.01 GB | 57 | 5 | 0 | 0 | 0.0% |
| ICTC (Career Focus) ⚠️ | 61 | 0.02 GB | 24 | 16 | 6 | 15 | 24.6% |
| Propel SWPP | 59 | 0.09 GB | 58 | 1 | 0 | 0 | 0.0% |
| Agri-Assurance SME | 58 | 0.11 GB | 44 | 5 | 0 | 9 | 15.5% |
| Competitiveness Consulting Rebate | 54 | 0.03 GB | 54 | 0 | 0 | 0 | 0.0% |
| Securing Small Business Rebate Program | 50 | 0.03 GB | 48 | 0 | 0 | 2 | 4.0% |
| BSP ⚠️ | 49 | 0.21 GB | 13 | 24 | 0 | 12 | 24.5% |
| Creative Export | 46 | 0.53 GB | 35 | 3 | 0 | 8 | 17.4% |
| DS4Y - BioTalent | 46 | 0.01 GB | 42 | 4 | 0 | 0 | 0.0% |
| Digital Lift | 45 | 0.01 GB | 44 | 1 | 0 | 0 | 0.0% |
| WES | 44 | 0.45 GB | 42 | 0 | 0 | 2 | 4.5% |
| EAF | 44 | 0.17 GB | 44 | 0 | 0 | 0 | 0.0% |
| Eco-Canada S&T Internship | 43 | 0.01 GB | 43 | 0 | 0 | 0 | 0.0% |
| WorkXP | 40 | 0.04 GB | 39 | 1 | 0 | 0 | 0.0% |
| WIL Internship | 39 | 0.01 GB | 2 | 2 | 29 | 6 | 15.4% |
| COJG | 38 | 0.04 GB | 36 | 2 | 0 | 0 | 0.0% |
| CLAC | 38 | 0.01 GB | 36 | 0 | 0 | 2 | 5.3% |
| Biotalent STIP - Green Jobs | 36 | 0.01 GB | 34 | 2 | 0 | 0 | 0.0% |
| Employment Services | 30 | 0.01 GB | 28 | 2 | 0 | 0 | 0.0% |
| SWPP AgriTalent | 28 | 0.01 GB | 27 | 0 | 0 | 1 | 3.6% |
| Mitacs BSI - KPU | 27 | 0.01 GB | 24 | 3 | 0 | 0 | 0.0% |
| Manufacturing Jobs Fund ⚠️ | 26 | 0.04 GB | 20 | 0 | 0 | 6 | 23.1% |
| Empowering Futures | 25 | 0.00 GB | 22 | 1 | 2 | 0 | 0.0% |
| Mitacs - UBC | 24 | 0.01 GB | 24 | 0 | 0 | 0 | 0.0% |
| BCAFE | 24 | 0.67 GB | 22 | 0 | 0 | 2 | 8.3% |
| YBBE | 23 | 0.00 GB | 20 | 3 | 0 | 0 | 0.0% |
| BCCAF (Climate Agri Solutions) | 23 | 0.02 GB | 23 | 0 | 0 | 0 | 0.0% |
| Food Processing Growth Fund | 23 | 0.11 GB | 22 | 0 | 0 | 1 | 4.3% |
| Eco Canada Internship | 20 | 0.02 GB | 18 | 0 | 2 | 0 | 0.0% |
| Experience Matters | 20 | 0.01 GB | 18 | 0 | 2 | 0 | 0.0% |
| Incentives in Trades - Career Launcher | 20 | 0.01 GB | 20 | 0 | 0 | 0 | 0.0% |
| Lighthouse Labs Wage Subsidy | 19 | 0.00 GB | 19 | 0 | 0 | 0 | 0.0% |
| z_Career Focus (Post Secondary)_dormat ⚠️ | 19 | 0.01 GB | 0 | 4 | 4 | 11 | 57.9% |
| DS4Y - IMAA | 19 | 0.00 GB | 18 | 1 | 0 | 0 | 0.0% |
| Innovate BC - BC Tech Co-Op Grants Program | 18 | 0.00 GB | 8 | 0 | 10 | 0 | 0.0% |
| AgriInnovation ⚠️ | 17 | 0.04 GB | 5 | 2 | 1 | 9 | 52.9% |
| Innovation Booster ⚠️ | 16 | 0.14 GB | 5 | 0 | 0 | 11 | 68.8% |
| Digital Adoption Program ⚠️ | 16 | 0.01 GB | 0 | 6 | 0 | 10 | 62.5% |
| DigitalWorks (Pinnguaq) | 16 | 0.01 GB | 16 | 0 | 0 | 0 | 0.0% |
| Work To Grow | 15 | 0.00 GB | 15 | 0 | 0 | 0 | 0.0% |
| I.D.E.A. Fund | 14 | 0.02 GB | 12 | 0 | 0 | 2 | 14.3% |
| BC Food Safety ⚠️ | 13 | 0.02 GB | 2 | 2 | 2 | 7 | 53.8% |
| Post Farm Food Safety (PFFS) | 13 | 0.00 GB | 0 | 0 | 13 | 0 | 0.0% |
| Youth Job Connection | 13 | 0.01 GB | 13 | 0 | 0 | 0 | 0.0% |
| Gearing Up SWPP | 13 | 0.01 GB | 13 | 0 | 0 | 0 | 0.0% |
| Food Safety | 13 | 0.07 GB | 11 | 0 | 0 | 2 | 15.4% |
| Greenworks Pinnguaq | 13 | 0.00 GB | 13 | 0 | 0 | 0 | 0.0% |
| Opportunities Fund - Biotalent | 13 | 0.00 GB | 0 | 13 | 0 | 0 | 0.0% |
| Apparel (Career Focus) ⚠️ | 12 | 0.00 GB | 0 | 4 | 5 | 3 | 25.0% |
| CBBIF ⚠️ | 12 | 0.21 GB | 5 | 3 | 0 | 4 | 33.3% |
| Food Storage, Distribution and Retail Program | 12 | 0.69 GB | 10 | 1 | 0 | 1 | 8.3% |
| *Job description templates ⚠️ | 11 | 0.00 GB | 0 | 0 | 0 | 11 | 100.0% |
| CAP Value-Added | 11 | 0.27 GB | 11 | 0 | 0 | 0 | 0.0% |
| Good Spark | 11 | 0.55 GB | 10 | 0 | 0 | 1 | 9.1% |
| Canadian Mining CMWP | 11 | 0.00 GB | 10 | 0 | 0 | 1 | 9.1% |
| WAGE Funding ⚠️ | 11 | 1.45 GB | 0 | 0 | 0 | 11 | 100.0% |
| MiTacs | 10 | 0.01 GB | 9 | 1 | 0 | 0 | 0.0% |
| Environmental Foreign Talent Development Program (EFTD) | 10 | 0.00 GB | 10 | 0 | 0 | 0 | 0.0% |
| BC Innovator Skills - BC-ISI | 9 | 0.00 GB | 9 | 0 | 0 | 0 | 0.0% |
| COIL | 9 | 0.14 GB | 9 | 0 | 0 | 0 | 0.0% |
| Housing Supply Challenge | 9 | 0.57 GB | 9 | 0 | 0 | 0 | 0.0% |
| Building Green Program | 9 | 0.00 GB | 9 | 0 | 0 | 0 | 0.0% |
| Bowman (Career Focus) ⚠️ | 8 | 0.00 GB | 0 | 0 | 6 | 2 | 25.0% |
| Hiring Resources ⚠️ | 8 | 0.00 GB | 0 | 0 | 0 | 8 | 100.0% |
| Co-operative Education Incentive ⚠️ | 8 | 0.00 GB | 0 | 0 | 0 | 8 | 100.0% |
| CIF CleanBC Industry Fund ⚠️ | 8 | 0.01 GB | 0 | 6 | 0 | 2 | 25.0% |
| Canada Alberta Productivity Grant | 8 | 0.00 GB | 7 | 0 | 0 | 1 | 12.5% |
| On-Farm Value-Added Program ⚠️ | 7 | 0.01 GB | 0 | 0 | 0 | 7 | 100.0% |
| Integrated Marketplace_ Early-Stage Demonstration Call | 7 | 0.00 GB | 0 | 6 | 0 | 1 | 14.3% |
| z_Sent Grant Summaries ⚠️ | 6 | 0.00 GB | 0 | 0 | 0 | 6 | 100.0% |
| **Job Descriptions Pending | 6 | 0.00 GB | 6 | 0 | 0 | 0 | 0.0% |
| Infuse Student Work Placement Program | 6 | 0.00 GB | 6 | 0 | 0 | 0 | 0.0% |
| WilWorks Skilled Trades | 6 | 0.00 GB | 6 | 0 | 0 | 0 | 0.0% |
| Agriculture Labour Task Force Grant ⚠️ | 6 | 0.01 GB | 0 | 0 | 0 | 6 | 100.0% |
| Regional Defence Initiative- BC ⚠️ | 6 | 0.01 GB | 0 | 1 | 0 | 5 | 83.3% |
| Alberta Innovates - Entrepreneur Incubator Program ⚠️ | 5 | 0.00 GB | 0 | 0 | 0 | 5 | 100.0% |
| Columbia Basin | 5 | 0.00 GB | 5 | 0 | 0 | 0 | 0.0% |
| Hiring Grant Fall 2018 | 5 | 0.00 GB | 0 | 0 | 5 | 0 | 0.0% |
| B Collective ⚠️ | 5 | 0.00 GB | 0 | 0 | 0 | 5 | 100.0% |
| RELAY-Green Careers | 5 | 0.00 GB | 0 | 5 | 0 | 0 | 0.0% |
| Interim Applications for time-limited funding under Section 8 and 9 of the Indigenous Languages Act ⚠️ | 5 | 0.00 GB | 0 | 0 | 0 | 5 | 100.0% |
| Horizon AI - Tech Commercialization Stream ⚠️ | 5 | 0.01 GB | 0 | 0 | 0 | 5 | 100.0% |
| Scale AI | 5 | 0.00 GB | 5 | 0 | 0 | 0 | 0.0% |
| Invest North – Grow | 5 | 0.00 GB | 5 | 0 | 0 | 0 | 0.0% |
| graduate to opportunity ⚠️ | 5 | 0.00 GB | 0 | 0 | 0 | 5 | 100.0% |
| Apartment Construction Loan Program: Standard Rental Housing ⚠️ | 5 | 0.00 GB | 0 | 0 | 0 | 5 | 100.0% |
| CareerLaunch: Workplace Training | 5 | 0.00 GB | 5 | 0 | 0 | 0 | 0.0% |
| ICE FUnd ⚠️ | 5 | 0.03 GB | 0 | 0 | 0 | 5 | 100.0% |
| BC Basin | 4 | 0.00 GB | 0 | 0 | 4 | 0 | 0.0% |
| Marketing Grant Summaries ⚠️ | 4 | 0.00 GB | 0 | 0 | 0 | 4 | 100.0% |
| Strategic Innovation Fund ⚠️ | 4 | 0.00 GB | 0 | 0 | 0 | 4 | 100.0% |
| Greening Government | 4 | 0.29 GB | 4 | 0 | 0 | 0 | 0.0% |
| Canada - Sasketchewan Job Grant | 4 | 0.00 GB | 4 | 0 | 0 | 0 | 0.0% |
| Accelerating Digital Career for Youth | 4 | 0.00 GB | 4 | 0 | 0 | 0 | 0.0% |
| Digital Marketing Skills Experience (DMSE) | 4 | 0.00 GB | 4 | 0 | 0 | 0 | 0.0% |
| Pinnguaq Digital Works | 4 | 0.00 GB | 4 | 0 | 0 | 0 | 0.0% |
| Workplace Innovation and Productivity Skills Incentive (WIPSI) ⚠️ | 4 | 0.00 GB | 0 | 0 | 0 | 4 | 100.0% |
| Future Ready Program ⚠️ | 4 | 0.00 GB | 0 | 0 | 0 | 4 | 100.0% |
| RDII ⚠️ | 4 | 0.00 GB | 0 | 0 | 0 | 4 | 100.0% |
| Alberta Innovates | 3 | 0.00 GB | 0 | 3 | 0 | 0 | 0.0% |
| Environment (CF) ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| Work Sharing Program ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| FRRF ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| Access to Talent | 3 | 0.00 GB | 3 | 0 | 0 | 0 | 0.0% |
| Advanced Manufacturing - NGen ⚠️ | 3 | 0.03 GB | 0 | 0 | 0 | 3 | 100.0% |
| Career Ready with CTMA | 3 | 0.00 GB | 3 | 0 | 0 | 0 | 0.0% |
| CleanBC Plastics Action Fund ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| Industry Commercialization Associates Program | 3 | 0.00 GB | 3 | 0 | 0 | 0 | 0.0% |
| CleanBC Custom Program ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| Strategic Energy Management for Industry (SEMI) ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| Tailings Technology Challenge ⚠️ | 3 | 0.00 GB | 0 | 0 | 0 | 3 | 100.0% |
| International Student (ISI) Co-op Hiring Grant | 3 | 0.00 GB | 3 | 0 | 0 | 0 | 0.0% |
| FuturePath | 3 | 0.00 GB | 3 | 0 | 0 | 0 | 0.0% |
| Jobs Growth Fund | 2 | 0.63 GB | 0 | 2 | 0 | 0 | 0.0% |
| Apprenticeship Service Program - Eco Canada ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| BC Wood Marketing and Business Development ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| BC Lean for Food Processors ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Horizon AI - Global Advantage Stream ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Alberta Innovates - Agri-Food and Bio-Industrial Innovation ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| GradWorks: Employer Incentive Program ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Industry Commercialization Associates Program - Alberta Innovates ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Industry R&D Associates Program - Alberta Innovates ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Early Childhood Educator Training Wage Program ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| INVEST North Program - Grow Stream ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Workplace Education Initiative ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Alberta Digital Traction Program ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| First Peoples Economic Growth Fund ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Project Development Fund ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| TACC Business Equity Program (BEP) ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Tech2Farm ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Call for Industrial Decarbonization (NorthX) ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Energy Innovation Program_Artificial Intelligence for Canadian Energy Innovation ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Ontario Food Technology Pilot (OFTP) ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Expanded Energy Management Program ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Circular Food Innovators Fund ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Beneficial Management Practices Program- Fuel & Energy ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Capital Retrofit_AB_2026 ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Women in Climate_North X ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Farm Solar Grants - BC ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| GCCC Tree Planting ⚠️ | 2 | 0.00 GB | 0 | 0 | 0 | 2 | 100.0% |
| Alberta STEP ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| BC FoodWorks ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Build in Canada Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| EI Wage Subsidy ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Facebook Small Biz Grant ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Foodworks ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Getting your company 'Granted'.eml ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Grant Summary Template.docx ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Job Creation Incentive Program_incomplete ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| FACTAP | 1 | 0.00 GB | 0 | 1 | 0 | 0 | 0.0% |
| Alberta Innovates - Digital Traction | 1 | 0.05 GB | 1 | 0 | 0 | 0 | 0.0% |
| Clir Renewables - Research Project ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Business Case Template  2022 (2).docx ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Grant Planner Template ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Tourism Fund ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Agritech Innovation Fund - Controlled Environment Agriculture ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| EnMax Amplifier Fund | 1 | 0.00 GB | 1 | 0 | 0 | 0 | 0.0% |
| Industry R&D Associates | 1 | 0.00 GB | 1 | 0 | 0 | 0 | 0.0% |
| Cultural Human Resources Council Student Work Placement Program (CHRC SWPP) ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Digital Skills For Youth (DS4Y) - Communautique ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Digital Skills for Youth (DS4Y) - Eco Canada [Waitlist] ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Employ PEI ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Food Futures ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| JobsNL Wage Subsidy Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| START ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Youth Internship Incentive Program (YIIP) ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Creating, Knowing, Sharing: Small Scale Activities ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| The Shift Fund ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| AccelerateIP ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Accelerating Agricultural Innovations 2.0 ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Alberta Export Expansion Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Alberta Innovates - Voucher ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Artificial Intelligence - Protein Industries Canada ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Canadian Agricultural Loans Act program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Clean Resources - Alberta Innovates ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Development and Commercialization Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Digital Modernization and Adoption Program - DCC ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Heavy-Duty Vehicle Efficiency Program - Rebate ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| International Technology Partnership Program (ITP) ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Life Sciences Innovation Fund ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Market Entry Development Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Micro Voucher Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Product Demonstration Program - Alberta Innovates ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Rhyze Up! ⚠️ | 1 | 0.03 GB | 0 | 0 | 0 | 1 | 100.0% |
| Sustainable Growth and Adoption Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Technology Demonstration Program - DCC ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| ABCMI SAAM Towage - Milestone 2.zip ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Access to Opportunities ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| ISSP ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Untitled.rtf ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Career Launch | 1 | 0.00 GB | 1 | 0 | 0 | 0 | 0.0% |
| Equity and Emerging Development_Creative BC ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Go-To-Market Microgrant ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Innovate BC Microgrant - Commercialization ⚠️ | 1 | 0.01 GB | 0 | 0 | 0 | 1 | 100.0% |
| TNS_DCMP_Program_Guidelines_2026to2027_FINAL_optimized.pdf ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| 23SHI.EN.Wrap Around Services.2.pdf ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| export travel trade Program ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| International Technology Pilot and Demonstration ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| Eurostar Call for Proposal ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| PROCESSOR PRODUCTIVITY PROGRAM (PPP) - BC ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| OJG ⚠️ | 1 | 0.00 GB | 0 | 0 | 0 | 1 | 100.0% |
| ISED - Business Succession Planning ⚠️ | 1 | 0.01 GB | 0 | 0 | 0 | 1 | 100.0% |

### ⚠️ Programs where review exceeds 20% (123)

These are structurally unlike CanExport and should be looked at before copying.

| Program | Files | review % | Dominant reason |
|---|---|---|---|
| ICTC (Career Focus) | 61 | **24.6%** | no attributed client (15) |
| BSP | 49 | **24.5%** | no attributed client (12) |
| Manufacturing Jobs Fund | 26 | **23.1%** | no attributed client (6) |
| z_Career Focus (Post Secondary)_dormat | 19 | **57.9%** | no attributed client (11) |
| AgriInnovation | 17 | **52.9%** | no attributed client (9) |
| Innovation Booster | 16 | **68.8%** | no attributed client (11) |
| Digital Adoption Program | 16 | **62.5%** | no attributed client (10) |
| BC Food Safety | 13 | **53.8%** | no attributed client (7) |
| Apparel (Career Focus) | 12 | **25.0%** | no attributed client (3) |
| CBBIF | 12 | **33.3%** | no attributed client (4) |
| *Job description templates | 11 | **100.0%** | no attributed client (11) |
| WAGE Funding | 11 | **100.0%** | no attributed client (11) |
| Bowman (Career Focus) | 8 | **25.0%** | no attributed client (2) |
| Hiring Resources | 8 | **100.0%** | no attributed client (8) |
| Co-operative Education Incentive | 8 | **100.0%** | no attributed client (8) |
| CIF CleanBC Industry Fund | 8 | **25.0%** | no attributed client (2) |
| On-Farm Value-Added Program | 7 | **100.0%** | no attributed client (7) |
| z_Sent Grant Summaries | 6 | **100.0%** | no attributed client (6) |
| Agriculture Labour Task Force Grant | 6 | **100.0%** | no attributed client (6) |
| Regional Defence Initiative- BC | 6 | **83.3%** | no attributed client (5) |
| Alberta Innovates - Entrepreneur Incubator Program | 5 | **100.0%** | no attributed client (5) |
| B Collective | 5 | **100.0%** | no attributed client (5) |
| Interim Applications for time-limited funding under Section 8 and 9 of the Indigenous Languages Act | 5 | **100.0%** | no attributed client (5) |
| Horizon AI - Tech Commercialization Stream | 5 | **100.0%** | no attributed client (5) |
| graduate to opportunity | 5 | **100.0%** | no attributed client (5) |
| Apartment Construction Loan Program: Standard Rental Housing | 5 | **100.0%** | no attributed client (5) |
| ICE FUnd | 5 | **100.0%** | no attributed client (5) |
| Marketing Grant Summaries | 4 | **100.0%** | no attributed client (4) |
| Strategic Innovation Fund | 4 | **100.0%** | no attributed client (4) |
| Workplace Innovation and Productivity Skills Incentive (WIPSI) | 4 | **100.0%** | no attributed client (4) |
| Future Ready Program | 4 | **100.0%** | no attributed client (4) |
| RDII | 4 | **100.0%** | no attributed client (4) |
| Environment (CF) | 3 | **100.0%** | no attributed client (3) |
| Work Sharing Program | 3 | **100.0%** | no attributed client (3) |
| FRRF | 3 | **100.0%** | no attributed client (3) |
| Advanced Manufacturing - NGen | 3 | **100.0%** | no attributed client (3) |
| CleanBC Plastics Action Fund | 3 | **100.0%** | no attributed client (3) |
| CleanBC Custom Program | 3 | **100.0%** | no attributed client (3) |
| Strategic Energy Management for Industry (SEMI) | 3 | **100.0%** | no attributed client (3) |
| Tailings Technology Challenge | 3 | **100.0%** | no attributed client (3) |
| Apprenticeship Service Program - Eco Canada | 2 | **100.0%** | no attributed client (2) |
| BC Wood Marketing and Business Development | 2 | **100.0%** | no attributed client (2) |
| BC Lean for Food Processors | 2 | **100.0%** | no attributed client (2) |
| Horizon AI - Global Advantage Stream | 2 | **100.0%** | no attributed client (2) |
| Alberta Innovates - Agri-Food and Bio-Industrial Innovation | 2 | **100.0%** | no attributed client (2) |
| GradWorks: Employer Incentive Program | 2 | **100.0%** | no attributed client (2) |
| Industry Commercialization Associates Program - Alberta Innovates | 2 | **100.0%** | no attributed client (2) |
| Industry R&D Associates Program - Alberta Innovates | 2 | **100.0%** | no attributed client (2) |
| Early Childhood Educator Training Wage Program | 2 | **100.0%** | no attributed client (2) |
| INVEST North Program - Grow Stream | 2 | **100.0%** | no attributed client (2) |
| Workplace Education Initiative | 2 | **100.0%** | no attributed client (2) |
| Alberta Digital Traction Program | 2 | **100.0%** | no attributed client (2) |
| First Peoples Economic Growth Fund | 2 | **100.0%** | no attributed client (2) |
| Project Development Fund | 2 | **100.0%** | no attributed client (2) |
| TACC Business Equity Program (BEP) | 2 | **100.0%** | no attributed client (2) |
| Tech2Farm | 2 | **100.0%** | no attributed client (2) |
| Call for Industrial Decarbonization (NorthX) | 2 | **100.0%** | no attributed client (2) |
| Energy Innovation Program_Artificial Intelligence for Canadian Energy Innovation | 2 | **100.0%** | no attributed client (2) |
| Ontario Food Technology Pilot (OFTP) | 2 | **100.0%** | no attributed client (2) |
| Expanded Energy Management Program | 2 | **100.0%** | no attributed client (2) |
| Circular Food Innovators Fund | 2 | **100.0%** | no attributed client (2) |
| Beneficial Management Practices Program- Fuel & Energy | 2 | **100.0%** | no attributed client (2) |
| Capital Retrofit_AB_2026 | 2 | **100.0%** | no attributed client (2) |
| Women in Climate_North X | 2 | **100.0%** | no attributed client (2) |
| Farm Solar Grants - BC | 2 | **100.0%** | no attributed client (2) |
| GCCC Tree Planting | 2 | **100.0%** | no attributed client (2) |
| Alberta STEP | 1 | **100.0%** | no attributed client (1) |
| BC FoodWorks | 1 | **100.0%** | no attributed client (1) |
| Build in Canada Program | 1 | **100.0%** | no attributed client (1) |
| EI Wage Subsidy | 1 | **100.0%** | no attributed client (1) |
| Facebook Small Biz Grant | 1 | **100.0%** | no attributed client (1) |
| Foodworks | 1 | **100.0%** | no attributed client (1) |
| Getting your company 'Granted'.eml | 1 | **100.0%** | no attributed client (1) |
| Grant Summary Template.docx | 1 | **100.0%** | no attributed client (1) |
| Job Creation Incentive Program_incomplete | 1 | **100.0%** | no attributed client (1) |
| Clir Renewables - Research Project | 1 | **100.0%** | no attributed client (1) |
| Business Case Template  2022 (2).docx | 1 | **100.0%** | no attributed client (1) |
| Grant Planner Template | 1 | **100.0%** | no attributed client (1) |
| Tourism Fund | 1 | **100.0%** | no attributed client (1) |
| Agritech Innovation Fund - Controlled Environment Agriculture | 1 | **100.0%** | no attributed client (1) |
| Cultural Human Resources Council Student Work Placement Program (CHRC SWPP) | 1 | **100.0%** | no attributed client (1) |
| Digital Skills For Youth (DS4Y) - Communautique | 1 | **100.0%** | no attributed client (1) |
| Digital Skills for Youth (DS4Y) - Eco Canada [Waitlist] | 1 | **100.0%** | no attributed client (1) |
| Employ PEI | 1 | **100.0%** | no attributed client (1) |
| Food Futures | 1 | **100.0%** | no attributed client (1) |
| JobsNL Wage Subsidy Program | 1 | **100.0%** | no attributed client (1) |
| START | 1 | **100.0%** | no attributed client (1) |
| Youth Internship Incentive Program (YIIP) | 1 | **100.0%** | no attributed client (1) |
| Creating, Knowing, Sharing: Small Scale Activities | 1 | **100.0%** | no attributed client (1) |
| The Shift Fund | 1 | **100.0%** | no attributed client (1) |
| AccelerateIP | 1 | **100.0%** | no attributed client (1) |
| Accelerating Agricultural Innovations 2.0 | 1 | **100.0%** | no attributed client (1) |
| Alberta Export Expansion Program | 1 | **100.0%** | no attributed client (1) |
| Alberta Innovates - Voucher | 1 | **100.0%** | no attributed client (1) |
| Artificial Intelligence - Protein Industries Canada | 1 | **100.0%** | no attributed client (1) |
| Canadian Agricultural Loans Act program | 1 | **100.0%** | no attributed client (1) |
| Clean Resources - Alberta Innovates | 1 | **100.0%** | no attributed client (1) |
| Development and Commercialization Program | 1 | **100.0%** | no attributed client (1) |
| Digital Modernization and Adoption Program - DCC | 1 | **100.0%** | no attributed client (1) |
| Heavy-Duty Vehicle Efficiency Program - Rebate | 1 | **100.0%** | no attributed client (1) |
| International Technology Partnership Program (ITP) | 1 | **100.0%** | no attributed client (1) |
| Life Sciences Innovation Fund | 1 | **100.0%** | no attributed client (1) |
| Market Entry Development Program | 1 | **100.0%** | no attributed client (1) |
| Micro Voucher Program | 1 | **100.0%** | no attributed client (1) |
| Product Demonstration Program - Alberta Innovates | 1 | **100.0%** | no attributed client (1) |
| Rhyze Up! | 1 | **100.0%** | no attributed client (1) |
| Sustainable Growth and Adoption Program | 1 | **100.0%** | no attributed client (1) |
| Technology Demonstration Program - DCC | 1 | **100.0%** | no attributed client (1) |
| ABCMI SAAM Towage - Milestone 2.zip | 1 | **100.0%** | no attributed client (1) |
| Access to Opportunities | 1 | **100.0%** | no attributed client (1) |
| ISSP | 1 | **100.0%** | no attributed client (1) |
| Untitled.rtf | 1 | **100.0%** | no attributed client (1) |
| Equity and Emerging Development_Creative BC | 1 | **100.0%** | no attributed client (1) |
| Go-To-Market Microgrant | 1 | **100.0%** | no attributed client (1) |
| Innovate BC Microgrant - Commercialization | 1 | **100.0%** | no attributed client (1) |
| TNS_DCMP_Program_Guidelines_2026to2027_FINAL_optimized.pdf | 1 | **100.0%** | no attributed client (1) |
| 23SHI.EN.Wrap Around Services.2.pdf | 1 | **100.0%** | no attributed client (1) |
| export travel trade Program | 1 | **100.0%** | no attributed client (1) |
| International Technology Pilot and Demonstration | 1 | **100.0%** | no attributed client (1) |
| Eurostar Call for Proposal | 1 | **100.0%** | no attributed client (1) |
| PROCESSOR PRODUCTIVITY PROGRAM (PPP) - BC | 1 | **100.0%** | no attributed client (1) |
| OJG | 1 | **100.0%** | no attributed client (1) |
| ISED - Business Succession Planning | 1 | **100.0%** | no attributed client (1) |

---

## Step 4 — structural shapes the four routes do not handle cleanly (5)

### Program with files but no resolvable client level — 93

resolveNodes() descends through batch folders looking for a client name and finds nothing, so every file lands in review.

- *Job description templates (11 files)
- WAGE Funding (11 files)
- Hiring Resources (8 files)
- Co-operative Education Incentive (8 files)
- On-Farm Value-Added Program (7 files)
- z_Sent Grant Summaries (6 files)
- Agriculture Labour Task Force Grant (6 files)
- B Collective (5 files)
- Interim Applications for time-limited funding under Section 8 and 9 of the Indigenous Languages Act (5 files)
- Horizon AI - Tech Commercialization Stream (5 files)
- graduate to opportunity (5 files)
- Apartment Construction Loan Program: Standard Rental Housing (5 files)
- Marketing Grant Summaries (4 files)
- Strategic Innovation Fund (4 files)
- Workplace Innovation and Productivity Skills Incentive (WIPSI) (4 files)
- Future Ready Program (4 files)
- RDII (4 files)
- Environment (CF) (3 files)
- Work Sharing Program (3 files)
- FRRF (3 files)
- _+73 more_

### Loose files directly under a program root — 15

No folder between the program and the file, so there is no client folder to attribute from. CanExport had these too; at corpus scale they are far more common.

- Canada Summer Jobs: 20 files
- Investment Readiness: 12 files
- *Job description templates: 11 files
- WAGE Funding: 11 files
- CPF: 10 files
- DSYIP: 10 files
- Digital Adoption Program: 10 files
- Agri-Export (BC): 8 files
- AgriInnovation: 8 files
- Hiring Resources: 8 files
- ICTC (Career Focus): 8 files
- Co-operative Education Incentive: 8 files
- AgriMarketing: 7 files
- BC Food Safety: 7 files
- DS4Y - VCN: 7 files

### Nested batch levels above the client folder — 8

Year-and-cohort groupings stacked more than one deep. resolveNodes() skips through them up to MAX_SKIP=8; anything deeper would strand files in review.

- ETG (Employer Training Grant) (2 nested batch levels)
- BuyBC (2 nested batch levels)
- Career Launcher Internships (inc DS4Y DT) (2 nested batch levels)
- CPF (2 nested batch levels)
- PSYIP (Grad Hiring Subsidy) (2 nested batch levels)
- Food Processors (Career Focus) (2 nested batch levels)
- Agri-Assurance SME (2 nested batch levels)
- AgriInnovation (2 nested batch levels)

### Client folders at more than one depth inside a single program — 43

Some clients sit directly under the program, others under a year or cohort folder. The mapping handles it, but it means the program has no single consistent shape.

- ETG (Employer Training Grant) (client folders at depths 2, 3, 4)
- WorkBC Wage Subsidy (client folders at depths 2, 3)
- BuyBC (client folders at depths 2, 3, 4)
- Career Launcher Internships (inc DS4Y DT) (client folders at depths 2, 3, 4)
- Mon Avenir (client folders at depths 2, 3)
- DS4Y - VCN (client folders at depths 2, 3)
- GYW (Youth Hiring Subsidy) (client folders at depths 2, 3)
- DS4Y - LHL (client folders at depths 2, 3)
- DS4Y - Pinnguaq (client folders at depths 2, 3)
- CPF (client folders at depths 2, 3, 4)
- Innovate BC - ISI (client folders at depths 2, 3)
- YESP (client folders at depths 2, 3)
- PSYIP (Grad Hiring Subsidy) (client folders at depths 2, 3, 4)
- Green Jobs (client folders at depths 2, 3)
- Alberta Jobs Now (client folders at depths 2, 3)
- AgriMarketing (client folders at depths 2, 3)
- DS4Y - Innovate BC (client folders at depths 2, 3)
- Opportunities Fund Program - BCA (client folders at depths 2, 3)
- Food Processors (Career Focus) (client folders at depths 3, 4)
- Food Processing SWPP (client folders at depths 2, 3)
- _+23 more_

### Cycle year lives in a batch level that the mapping discards — 20

resolveNodes() skips batch folders to reach the client beneath, but in these programs that skipped level IS the program cycle (e.g. "2021 CSJ - Applications"). The year then falls back to client_modified, and two cycles for one client collapse onto one destination. This is the direct cause of every collision in Step 5.

- ETG (Employer Training Grant): 21749 files under a year-carrying batch level
- WorkBC Wage Subsidy: 15372 files under a year-carrying batch level
- BuyBC: 1972 files under a year-carrying batch level
- DS4Y - VCN: 1157 files under a year-carrying batch level
- DS4Y - LHL: 918 files under a year-carrying batch level
- DS4Y - Pinnguaq: 856 files under a year-carrying batch level
- Innovate BC - ISI: 719 files under a year-carrying batch level
- GYW (Youth Hiring Subsidy): 685 files under a year-carrying batch level
- Mon Avenir: 646 files under a year-carrying batch level
- YESP: 583 files under a year-carrying batch level
- PSYIP (Grad Hiring Subsidy): 475 files under a year-carrying batch level
- Alberta Jobs Now: 461 files under a year-carrying batch level
- AgriMarketing: 422 files under a year-carrying batch level
- DS4Y - Innovate BC: 412 files under a year-carrying batch level
- Opportunities Fund Program - BCA: 338 files under a year-carrying batch level
- Food Processors (Career Focus): 322 files under a year-carrying batch level
- Food Processing SWPP: 287 files under a year-carrying batch level
- iAdvance Pathways: 282 files under a year-carrying batch level
- Canada Summer Jobs: 265 files under a year-carrying batch level
- DSYIP: 261 files under a year-carrying batch level

---

## Step 5 — collision check

Every non-review destination in this mapping, checked against each other **and** against the 1,474 destinations already occupied by copied CanExport files.

## 139 collisions found — **all resolved, zero remain**

The batch-year fix removed 149 of the original 288. The remaining 139 were resolved by suffixing the filename, applied to **285 rows**. A fresh occupancy check across the whole corpus — including the 1,474 destinations already occupied by copied CanExport files — now returns **0**.

| Program | Collisions |
|---|---|
| ETG (Employer Training Grant) | 115 |
| Career Launcher Internships (inc DS4Y DT) | 14 |
| GYW (Youth Hiring Subsidy) | 8 |
| Mon Avenir | 2 |

### Root cause, and what the batch-year fix removed

The original 288 came from one thing: `resolveNodes()` skips cohort folders like `2021 CSJ - Applications` and `Client Files - 2022:2023 Fiscal` to reach the client beneath, and that skipped level is usually the grant cycle. With it discarded the year fell back to `client_modified` — the last time a byte moved — so two cycles of one client landed on one destination.

Reading the year from the discarded level removed **149 of the 288**. What survives is 139.

**None of the 139 touches a destination already occupied by a copied CanExport file** — all 1,474 were checked.

### What survives, and why

Two cohort folders that encode the *same* year still collapse. `ETG-BC Applications 2020x` and `ETG-BC Applications 2020xx` are different intakes but both yield `2020`, so a client appearing in both still shares a destination. That is the residue.

| Group | Meaning | Collisions | Bytes at stake |
|---|---|---|---|
| **A** | Same name, same size, same date — almost certainly one file filed twice | 121 | 59.2 MB |
| **B** | Same name, but different size or date — genuinely different files that would overwrite | 18 | 3.7 MB |

Of group A, 121 have sources in different cohort folders. Of group B, 15 differ in size and 3 share a size but differ in date.

⚠️ **146 files would be silently overwritten** if this were copied as-is — each collision keeps one source and loses the rest.

### Step 6 — the suffix rule, APPLIED

**Both groups are suffixed.** The discriminator is the thing that was lost: the **first path segment where the colliding sources differ** — usually the cohort folder.

```
Clients/Terry Hawes/ETG…/2020/New Administrative Law/"New" Administrative Law.docx
  from …/ETG-BC Applications 2020x/…   ->  "New" Administrative Law (ETG-BC Applications 2020x).docx
  from …/ETG-BC Applications 2020xx/…  ->  "New" Administrative Law (ETG-BC Applications 2020xx).docx
```

That disambiguated **139 of 139** on the first differing segment alone. It is stable (derived from the source, not a counter), reproducible across re-runs, and human-meaningful: it names the intake the file came from. The implementation widens to further differing segments if sanitizing ever made two discriminators collide, and falls back to an 8-character hash of the source path if the path itself cannot separate them — neither fallback was needed here.

The suffix is applied to **both** `destination_path` and `proposed_filename`. If phase 3 ever applies the proposed name, it must not strip the suffix and recreate the collision.

**Nothing was deduped or dropped.** All 146 files that would have been overwritten now have distinct destinations.

**Group A — suffix as well, reluctantly.** These look like one file filed twice, so the tidy answer is to copy once. Three options and their costs:

| Option | Cost |
|---|---|
| **Dedupe** — copy one, drop the rest | Cheapest and cleanest, but **out of scope: every file migrates.** It also rests on same-name+size+date, which is a proxy for identity, not proof — no content hash exists without downloading. |
| **Dual-file** | Wrong shape. Dual-filing exists for one file belonging to *two clients*; here it is one client and two intakes. |
| **Suffix** (applied) | Preserves every file, no judgement about identity. Costs 121 visually duplicated pairs and 59.2 MB of probably-redundant storage. |

Suffixing both groups treats all 139 the same way and needs no identity judgement — that judgement belongs in phase 4 pruning, where the 6,338 same-size-same-name candidates already sit.

### All 139 collisions and their resolved filenames

`Was` is the destination both sources wanted; `Now` is the filename each ended up with.

| Group | Program | Was (colliding destination) | Now |
|---|---|---|---|
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/AME/Career Launcher Internships (inc DS4Y DT)/2023/Aksah Kapoor - Mechanical Designer/Akash Kapoor AME Vetting candidate General copy.docx` | `Akash Kapoor AME Vetting candidate General copy (Clean Tech Stream).docx`<br>`Akash Kapoor AME Vetting candidate General copy (Natural Resources Stream).docx` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/AME/Career Launcher Internships (inc DS4Y DT)/2023/Aksah Kapoor - Mechanical Designer/Resume-AkashKapoor.pdf` | `Resume-AkashKapoor (Clean Tech Stream).pdf`<br>`Resume-AkashKapoor (Natural Resources Stream).pdf` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/AME/Career Launcher Internships (inc DS4Y DT)/2023/Aksah Kapoor - Mechanical Designer/Schedule A - Designer.docx` | `Schedule A - Designer (Clean Tech Stream).docx`<br>`Schedule A - Designer (Natural Resources Stream).docx` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/AME/Career Launcher Internships (inc DS4Y DT)/2023/Johann Barnard - Mechanical Designer/Johann Barnard EIT.pdf` | `Johann Barnard EIT (Clean Tech Stream).pdf`<br>`Johann Barnard EIT (Natural Resources Stream).pdf` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/AME/Career Launcher Internships (inc DS4Y DT)/2023/Johann Barnard - Mechanical Designer/Johannes Barnard AME Vetting candidate General copy.docx` | `Johannes Barnard AME Vetting candidate General copy (Clean Tech Stream).docx`<br>`Johannes Barnard AME Vetting candidate General copy (Natural Resources Stream).docx` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/AME/Career Launcher Internships (inc DS4Y DT)/2023/Johann Barnard - Mechanical Designer/Schedule A - Designer.docx` | `Schedule A - Designer (Clean Tech Stream).docx`<br>`Schedule A - Designer (Natural Resources Stream).docx` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Fabutek/Career Launcher Internships (inc DS4Y DT)/2024/Jeff_Clarke-Janzen_2024.04.25.pdf` | `Jeff_Clarke-Janzen_2024.04.25 (Clean Tech Stream).pdf`<br>`Jeff_Clarke-Janzen_2024.04.25 (Natural Resources Stream).pdf` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Fabutek/Career Launcher Internships (inc DS4Y DT)/2024/Vetting - CDD - Jeff - Fabutek.pdf` | `Vetting - CDD - Jeff - Fabutek (Clean Tech Stream - Fabutek (Unicode Encoding Conflict)).pdf`<br>`Vetting - CDD - Jeff - Fabutek (Clean Tech Stream - Fabutek).pdf`<br>`Vetting - CDD - Jeff - Fabutek (Natural Resources Stream - Fabutek).pdf` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Keystone Environmental/Career Launcher Internships (inc DS4Y DT)/2023/Kharazm Khaledi - Environmental Engineer/*Vetting File as of June 23.xlsm` | `*Vetting File as of June 23 (Clean Tech Stream).xlsm`<br>`*Vetting File as of June 23 (Impact Stream).xlsm` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Keystone Environmental/Career Launcher Internships (inc DS4Y DT)/2023/Kharazm Khaledi - Environmental Engineer/KHALEDI (06.29.23).pdf` | `KHALEDI (06.29.23) (Clean Tech Stream).pdf`<br>`KHALEDI (06.29.23) (Impact Stream).pdf` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Keystone Environmental/Career Launcher Internships (inc DS4Y DT)/2023/Kharazm Khaledi - Environmental Engineer/Phase 1 -  Contaminated Sites.doc` | `Phase 1 -  Contaminated Sites (Clean Tech Stream).doc`<br>`Phase 1 -  Contaminated Sites (Impact Stream).doc` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Keystone Environmental/Career Launcher Internships (inc DS4Y DT)/2024/Paul Quin Yeung - GIS - CAD Specialist/CAD GIS Specialist Job Description.docx` | `CAD GIS Specialist Job Description (Natural Resources Stream).docx`<br>`CAD GIS Specialist Job Description (Clean Tech Stream).docx` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Keystone Environmental/Career Launcher Internships (inc DS4Y DT)/2024/Paul Quin Yeung - GIS - CAD Specialist/Paul Quin Yeung Keystone VETTING FILE AS OF 9.14 (w DS4Y and ELECTRICAL) copy.xlsm` | `Paul Quin Yeung Keystone VETTING FILE AS OF 9.14 (w DS4Y and ELECTRICAL) copy (Natural Resources Stream).xlsm`<br>`Paul Quin Yeung Keystone VETTING FILE AS OF 9.14 (w DS4Y and ELECTRICAL) copy (Clean Tech Stream).xlsm` |
| **A** | Career Launcher Internships (inc DS4Y DT) | `Clients/Keystone Environmental/Career Launcher Internships (inc DS4Y DT)/2024/Paul Quin Yeung - GIS - CAD Specialist/Resume Paul Quin Yeung.pdf` | `Resume Paul Quin Yeung (Natural Resources Stream).pdf`<br>`Resume Paul Quin Yeung (Clean Tech Stream).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Atkinson Landscaping/ETG (Employer Training Grant)/2021/Atkinson Landscaping BL 2021.pdf` | `Atkinson Landscaping BL 2021 (ETG-BC Applications 2021).pdf`<br>`Atkinson Landscaping BL 2021 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Atkinson Landscaping/ETG (Employer Training Grant)/2021/Blueprint/Danny Kerr Resume.pdf` | `Danny Kerr Resume (ETG-BC Applications 2021).pdf`<br>`Danny Kerr Resume (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Atkinson Landscaping/ETG (Employer Training Grant)/2021/Blueprint/ETG-Business-Case-Atkinson Landscaping-Blueprint.pdf` | `ETG-Business-Case-Atkinson Landscaping-Blueprint (ETG-BC Applications 2021).pdf`<br>`ETG-Business-Case-Atkinson Landscaping-Blueprint (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Badinotti/ETG (Employer Training Grant)/2021/2021 BC ETG Training Planner - Badinotti Apr 6.xlsx` | `2021 BC ETG Training Planner - Badinotti Apr 6 (ETG-BC Applications 2021).xlsx`<br>`2021 BC ETG Training Planner - Badinotti Apr 6 (ETG-BC Applications 2021x).xlsx` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Business License/Business License Upload.pdf` | `Business License Upload (ETG-BC Applications 2019).pdf`<br>`Business License Upload (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Business License/Reference/57369497242__1323C984-73F4-4BD9-8130-8FF4550C31D9.jpeg` | `57369497242__1323C984-73F4-4BD9-8130-8FF4550C31D9 (ETG-BC Applications 2019).jpeg`<br>`57369497242__1323C984-73F4-4BD9-8130-8FF4550C31D9 (ETG-BC Applications 2019x).jpeg` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Business License/Reference/57369506522__36B18DB8-BAA2-4878-ACAD-BFAD982199D1.jpeg` | `57369506522__36B18DB8-BAA2-4878-ACAD-BFAD982199D1 (ETG-BC Applications 2019).jpeg`<br>`57369506522__36B18DB8-BAA2-4878-ACAD-BFAD982199D1 (ETG-BC Applications 2019x).jpeg` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Erickson/Richard Hyams - Erickson Coaching Instructor .docx` | `Richard Hyams - Erickson Coaching Instructor  (ETG-BC Applications 2019).docx`<br>`Richard Hyams - Erickson Coaching Instructor  (ETG-BC Applications 2019x).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Erickson/Richard Hyams - Erickson Coaching Instructor .pdf` | `Richard Hyams - Erickson Coaching Instructor  (ETG-BC Applications 2019).pdf`<br>`Richard Hyams - Erickson Coaching Instructor  (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Erickson/The Art of Science and Coaching Outline .docx` | `The Art of Science and Coaching Outline  (ETG-BC Applications 2019).docx`<br>`The Art of Science and Coaching Outline  (ETG-BC Applications 2019x).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2019/Erickson/The Art of Science and Coaching Outline .pdf` | `The Art of Science and Coaching Outline  (ETG-BC Applications 2019).pdf`<br>`The Art of Science and Coaching Outline  (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Blume/ETG (Employer Training Grant)/2020/Digital Marketing 2/Maggie Lin.pdf` | `Maggie Lin (ETG-BC Applications 2020x).pdf`<br>`Maggie Lin (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2020/Certificate in Leadership Fundamentals/Caliber Business Case.pdf` | `Caliber Business Case (ETG-BC Applications 2020x).pdf`<br>`Caliber Business Case (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2020/Certificate in Leadership Fundamentals/Certificate in Leadership Fundamentals.pdf` | `Certificate in Leadership Fundamentals (ETG-BC Applications 2020x).pdf`<br>`Certificate in Leadership Fundamentals (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2020/Certificate in Leadership Fundamentals/Instructor Biography - Trevor Throness.pdf` | `Instructor Biography - Trevor Throness (ETG-BC Applications 2020x).pdf`<br>`Instructor Biography - Trevor Throness (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2021/Certificate in Leadership - GPR/GPR 2021 x 20 people - ETG Bus Case Info.pdf` | `GPR 2021 x 20 people - ETG Bus Case Info (ETG-BC Applications 2021).pdf`<br>`GPR 2021 x 20 people - ETG Bus Case Info (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Camp Fircom/ETG (Employer Training Grant)/2020/Trauma Tech copy/Instructors.pdf` | `Instructors (Old Folders - ETG-BC Applications 2020x).pdf`<br>`Instructors (Old Folders - ETG-BC Applications 2020xx).pdf`<br>`Instructors (CJG-BC Applications 2020 and prior - ETG-BC Applications 2020).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Camp Fircom/ETG (Employer Training Grant)/2020/Trauma Tech copy/Occupational First Aid L3 Training Guide August 2018.pdf` | `Occupational First Aid L3 Training Guide August 2018 (ETG-BC Applications 2020x).pdf`<br>`Occupational First Aid L3 Training Guide August 2018 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Camp Fircom/ETG (Employer Training Grant)/2020/Trauma Tech copy/Occupational First Aid Level 3-converted.docx` | `Occupational First Aid Level 3-converted (ETG-BC Applications 2020x).docx`<br>`Occupational First Aid Level 3-converted (ETG-BC Applications 2020xx).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/CH Robinson/ETG (Employer Training Grant)/2019/INSTRUCTORS BIO Casey Miller.pdf` | `INSTRUCTORS BIO Casey Miller (CJG-BC Applications 2020 and prior).pdf`<br>`INSTRUCTORS BIO Casey Miller (CAJG).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Clarus/ETG (Employer Training Grant)/2019/Business License/Business License Upload.pdf` | `Business License Upload (ETG-BC Applications 2019).pdf`<br>`Business License Upload (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Coromandel Properties/ETG (Employer Training Grant)/2021/Coromandel Properties Ltd-Business Licence-2021.pdf` | `Coromandel Properties Ltd-Business Licence-2021 (ETG-BC Applications 2021).pdf`<br>`Coromandel Properties Ltd-Business Licence-2021 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Enhanced Performance/ETG (Employer Training Grant)/2020/04 - Invoice Vancouver 2019-2020.pdf` | `04 - Invoice Vancouver 2019-2020 (Old Folders).pdf`<br>`04 - Invoice Vancouver 2019-2020 (CJG-BC Applications 2020 and prior).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Enhanced Performance/ETG (Employer Training Grant)/2020/07 - Pre-Admission Info 2020.pdf` | `07 - Pre-Admission Info 2020 (Old Folders).pdf`<br>`07 - Pre-Admission Info 2020 (CJG-BC Applications 2020 and prior).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Enhanced Performance/ETG (Employer Training Grant)/2020/CEO - Study Program Vancouver 2020-2025.pdf` | `CEO - Study Program Vancouver 2020-2025 (Old Folders - ETG-BC Applications 2020x).pdf`<br>`CEO - Study Program Vancouver 2020-2025 (Old Folders - ETG-BC Applications 2020xx).pdf`<br>`CEO - Study Program Vancouver 2020-2025 (CJG-BC Applications 2020 and prior - ETG-BC Applications 2020).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Enhanced Performance/ETG (Employer Training Grant)/2020/CEO Course Costs Vancouver 2020-2025.pdf` | `CEO Course Costs Vancouver 2020-2025 (Old Folders - ETG-BC Applications 2020x).pdf`<br>`CEO Course Costs Vancouver 2020-2025 (Old Folders - ETG-BC Applications 2020xx).pdf`<br>`CEO Course Costs Vancouver 2020-2025 (CJG-BC Applications 2020 and prior - ETG-BC Applications 2020).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Enhanced Performance/ETG (Employer Training Grant)/2020/CEO Course Dates - Schedule Vancouver 1V 2020-21.pdf` | `CEO Course Dates - Schedule Vancouver 1V 2020-21 (Old Folders - ETG-BC Applications 2020x).pdf`<br>`CEO Course Dates - Schedule Vancouver 1V 2020-21 (Old Folders - ETG-BC Applications 2020xx).pdf`<br>`CEO Course Dates - Schedule Vancouver 1V 2020-21 (CJG-BC Applications 2020 and prior - ETG-BC Applications 2020).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Horizon/ETG (Employer Training Grant)/2017/Info/Leveraging Training Grants-Best Practices.pdf` | `Leveraging Training Grants-Best Practices (CJG-BC Applications 2017x (Sept 2017 onwards)).pdf`<br>`Leveraging Training Grants-Best Practices (CJG-BC Applications 2017xx (Jan 2018 onwards)).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Humanity Financial/ETG (Employer Training Grant)/2021/Business Licence/2021-03-26 HFM 2021 Business Licence.pdf` | `2021-03-26 HFM 2021 Business Licence (ETG-BC Applications 2021).pdf`<br>`2021-03-26 HFM 2021 Business Licence (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Humanity Financial/ETG (Employer Training Grant)/2021/Business Licence/Humanity Financial - Busines Licence -2020.pdf` | `Humanity Financial - Busines Licence -2020 (ETG-BC Applications 2021).pdf`<br>`Humanity Financial - Busines Licence -2020 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Keirton/ETG (Employer Training Grant)/2020/Keirton Inc Incorporation Certificate.pdf` | `Keirton Inc Incorporation Certificate (ETG-BC Applications 2020x).pdf`<br>`Keirton Inc Incorporation Certificate (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Keirton/ETG (Employer Training Grant)/2020/Keirton Inc Name Change.pdf` | `Keirton Inc Name Change (ETG-BC Applications 2020x).pdf`<br>`Keirton Inc Name Change (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kerrisdale Lumber/ETG (Employer Training Grant)/2019/Bringing-Purpose-to-Life.pdf` | `Bringing-Purpose-to-Life (ETG-BC Applications 2019).pdf`<br>`Bringing-Purpose-to-Life (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kerrisdale Lumber/ETG (Employer Training Grant)/2019/Business License/Scanned from a Xerox Multifunction Device.pdf` | `Scanned from a Xerox Multifunction Device (ETG-BC Applications 2019).pdf`<br>`Scanned from a Xerox Multifunction Device (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kerrisdale Lumber/ETG (Employer Training Grant)/2019/Co-Creating-Accountability-.pdf` | `Co-Creating-Accountability- (ETG-BC Applications 2019).pdf`<br>`Co-Creating-Accountability- (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kerrisdale Lumber/ETG (Employer Training Grant)/2019/Metaskills-for-Effective-Team-Building.pdf` | `Metaskills-for-Effective-Team-Building (ETG-BC Applications 2019).pdf`<br>`Metaskills-for-Effective-Team-Building (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kerrisdale Lumber/ETG (Employer Training Grant)/2019/What-is-My-Leadership-Impact.pdf` | `What-is-My-Leadership-Impact (ETG-BC Applications 2019).pdf`<br>`What-is-My-Leadership-Impact (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kirmac/ETG (Employer Training Grant)/2020/Business Licenses - 2020.pdf` | `Business Licenses - 2020 (ETG-BC Applications 2020x).pdf`<br>`Business Licenses - 2020 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Kirmac/ETG (Employer Training Grant)/2020/ST045L01 - Aluminum GMA (MIG) Welding/Marcus Yeo.pdf` | `Marcus Yeo (ETG-BC Applications 2020x).pdf`<br>`Marcus Yeo (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/LBN/ETG (Employer Training Grant)/2020/Getting to 80/instructor bios.pdf.pdf` | `instructor bios.pdf (ETG-BC Applications 2020x).pdf`<br>`instructor bios.pdf (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/LBN/ETG (Employer Training Grant)/2020/Getting to 80/LBN-Gto80-training package-Sep2020.pdf` | `LBN-Gto80-training package-Sep2020 (ETG-BC Applications 2020x).pdf`<br>`LBN-Gto80-training package-Sep2020 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Life Beyond Limits Counselling/ETG (Employer Training Grant)/2019/Cindi Bio.pdf` | `Cindi Bio (ETG-BC Applications 2019).pdf`<br>`Cindi Bio (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Life Beyond Limits Counselling/ETG (Employer Training Grant)/2019/Small Business Marketing Program- 2018.pdf` | `Small Business Marketing Program- 2018 (ETG-BC Applications 2019).pdf`<br>`Small Business Marketing Program- 2018 (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Longevity Graphics/ETG (Employer Training Grant)/2020/business licence upload.pdf` | `business licence upload (ETG-BC Applications 2020x).pdf`<br>`business licence upload (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Longevity Graphics/ETG (Employer Training Grant)/2020/Cultivate Advisors/26317.pdf` | `26317 (ETG-BC Applications 2020x).pdf`<br>`26317 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Longevity Graphics/ETG (Employer Training Grant)/2020/Cultivate Advisors/Course - Sales Training.pdf` | `Course - Sales Training (ETG-BC Applications 2020x).pdf`<br>`Course - Sales Training (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Longevity Graphics/ETG (Employer Training Grant)/2020/Cultivate Advisors/Trainer Profile.pdf` | `Trainer Profile (ETG-BC Applications 2020x).pdf`<br>`Trainer Profile (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Mayne/ETG (Employer Training Grant)/2021/Mayne Coatings Abbortsford - 2021 Business Licence.pdf` | `Mayne Coatings Abbortsford - 2021 Business Licence (ETG-BC Applications 2021).pdf`<br>`Mayne Coatings Abbortsford - 2021 Business Licence (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Mayne/ETG (Employer Training Grant)/2021/Mayne Coatings Langley - 2021 Business Licence.pdf` | `Mayne Coatings Langley - 2021 Business Licence (ETG-BC Applications 2021).pdf`<br>`Mayne Coatings Langley - 2021 Business Licence (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Native Shoes/ETG (Employer Training Grant)/2020/Leading Self Workshops - 3 Fold/CGJ Resume - One Page - 2020.pdf` | `CGJ Resume - One Page - 2020 (ETG-BC Applications 2020x).pdf`<br>`CGJ Resume - One Page - 2020 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Native Shoes/ETG (Employer Training Grant)/2020/Leading Self Workshops - 3 Fold/Fall 2020 Leading Self Series - Level 2 - Core Copy.pdf` | `Fall 2020 Leading Self Series - Level 2 - Core Copy (ETG-BC Applications 2020x).pdf`<br>`Fall 2020 Leading Self Series - Level 2 - Core Copy (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Native Shoes/ETG (Employer Training Grant)/2020/Leading Self Workshops - 3 Fold/Fall 2020_ Leading Self Level 1 - Core Copy.pdf` | `Fall 2020_ Leading Self Level 1 - Core Copy (ETG-BC Applications 2020x).pdf`<br>`Fall 2020_ Leading Self Level 1 - Core Copy (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Norland/ETG (Employer Training Grant)/2021/2021 InterMunicipal-BPES.pdf` | `2021 InterMunicipal-BPES (ETG-BC Applications 2021).pdf`<br>`2021 InterMunicipal-BPES (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Norland/ETG (Employer Training Grant)/2021/2021 InterMunicipal-PBD.pdf` | `2021 InterMunicipal-PBD (ETG-BC Applications 2021).pdf`<br>`2021 InterMunicipal-PBD (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/North Shore Twins/ETG (Employer Training Grant)/2020/Blueprint-for-Success.pdf` | `Blueprint-for-Success (Old Folders).pdf`<br>`Blueprint-for-Success (CJG-BC Applications 2020 and prior).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/North Shore Twins/ETG (Employer Training Grant)/2020/FRASER ENGEL CV 2020.pdf` | `FRASER ENGEL CV 2020 (Old Folders).pdf`<br>`FRASER ENGEL CV 2020 (CJG-BC Applications 2020 and prior).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/North Shore Twins/ETG (Employer Training Grant)/2020/North Shore Twins 2020 Q2Q3 BC Course Planner July 2020.xlsx` | `North Shore Twins 2020 Q2Q3 BC Course Planner July 2020 (Old Folders).xlsx`<br>`North Shore Twins 2020 Q2Q3 BC Course Planner July 2020 (CJG-BC Applications 2020 and prior).xlsx` |
| **A** | ETG (Employer Training Grant) | `Clients/Point Blank Creative/ETG (Employer Training Grant)/2020/Instructor Bios.pdf` | `Instructor Bios (Old Folders).pdf`<br>`Instructor Bios (CJG-BC Applications 2020 and prior).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Primex/ETG (Employer Training Grant)/2018/DEP Instructors.pdf` | `DEP Instructors (CJG-BC Applications 2018x).pdf`<br>`DEP Instructors (CJG-BC Applications 2018xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Revesco Properties/ETG (Employer Training Grant)/2021/2021 Business Licence - PIPI.pdf` | `2021 Business Licence - PIPI (ETG-BC Applications 2021).pdf`<br>`2021 Business Licence - PIPI (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Revesco Properties/ETG (Employer Training Grant)/2021/ETG Business Case Information Form-V5.pdf` | `ETG Business Case Information Form-V5 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Information Form-V5 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Shanto/ETG (Employer Training Grant)/2021/Notice of Articles.pdf` | `Notice of Articles (ETG-BC Applications 2021).pdf`<br>`Notice of Articles (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Shanto/ETG (Employer Training Grant)/2021/Pages from Notice of Articles.pdf` | `Pages from Notice of Articles (ETG-BC Applications 2021).pdf`<br>`Pages from Notice of Articles (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Smith Cameron/ETG (Employer Training Grant)/2018/MS Office Instructor - PhilippaRobertshawProfile.pdf` | `MS Office Instructor - PhilippaRobertshawProfile (CJG-BC Applications 2018x).pdf`<br>`MS Office Instructor - PhilippaRobertshawProfile (CJG-BC Applications 2018xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Smith Cameron/ETG (Employer Training Grant)/2019/business license.pdf` | `business license (ETG-BC Applications 2019).pdf`<br>`business license (ETG-BC Applications 2019x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Stonz/ETG (Employer Training Grant)/2018/Instructors - Emergenetics.pdf` | `Instructors - Emergenetics (CJG-BC Applications 2018x).pdf`<br>`Instructors - Emergenetics (CJG-BC Applications 2018xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Stonz/ETG (Employer Training Grant)/2018/Outline - Emergenetics .pdf` | `Outline - Emergenetics  (CJG-BC Applications 2018x).pdf`<br>`Outline - Emergenetics  (CJG-BC Applications 2018xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/TAG/ETG (Employer Training Grant)/2017/Wye Management - Instructor Qualifications.pdf` | `Wye Management - Instructor Qualifications (CJG-BC Applications 2017x (Sept 2017 onwards)).pdf`<br>`Wye Management - Instructor Qualifications (CJG-BC Applications 2017xx (Jan 2018 onwards)).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/TAG/ETG (Employer Training Grant)/2019/Leadership Foundations Outline and Bio/Outline - More Co Leadership Foundations.pdf` | `Outline - More Co Leadership Foundations (ETG-BC Applications 2019x).pdf`<br>`Outline - More Co Leadership Foundations (ETG-BC Applications 2019xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/ETG Business Case Ajay Jaiswall Course 1.pdf` | `ETG Business Case Ajay Jaiswall Course 1 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Ajay Jaiswall Course 1 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/ETG Business Case Ajay Jaiswall Course 2.pdf` | `ETG Business Case Ajay Jaiswall Course 2 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Ajay Jaiswall Course 2 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/ETG Business Case Nik Schulz Course 1.pdf` | `ETG Business Case Nik Schulz Course 1 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Nik Schulz Course 1 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/ETG Business Case Nik Schulz Course 2.pdf` | `ETG Business Case Nik Schulz Course 2 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Nik Schulz Course 2 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/ETG Business Case Sid Shah Course 1.pdf` | `ETG Business Case Sid Shah Course 1 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Sid Shah Course 1 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/ETG Business Case Sid Shah Course 2.pdf` | `ETG Business Case Sid Shah Course 2 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Sid Shah Course 2 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/Taymor_Working Proposal_Updated_Aug 3 2021.pptx` | `Taymor_Working Proposal_Updated_Aug 3 2021 (CJG MANITOBA).pptx`<br>`Taymor_Working Proposal_Updated_Aug 3 2021 (CAJG).pptx` |
| **A** | ETG (Employer Training Grant) | `Clients/Taymor Industries/ETG (Employer Training Grant)/2021/Teneo Training Participant Lists Oct 2021-2.xlsx` | `Teneo Training Participant Lists Oct 2021-2 (CJG MANITOBA).xlsx`<br>`Teneo Training Participant Lists Oct 2021-2 (CAJG).xlsx` |
| **A** | ETG (Employer Training Grant) | `Clients/Terry Hawes/ETG (Employer Training Grant)/2020/New Administrative Law/Raj Anand.pdf` | `Raj Anand (ETG-BC Applications 2020x).pdf`<br>`Raj Anand (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/20201117_BUSINESS LICENCE BUS-0028082.pdf` | `20201117_BUSINESS LICENCE BUS-0028082 (ETG-BC Applications 2020x).pdf`<br>`20201117_BUSINESS LICENCE BUS-0028082 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy 2nd/20201117_BUSINESS LICENCE BUS-0028082.pdf` | `20201117_BUSINESS LICENCE BUS-0028082 (ETG-BC Applications 2020x).pdf`<br>`20201117_BUSINESS LICENCE BUS-0028082 (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy 2nd/Business Builder Academy.pdf` | `Business Builder Academy (ETG-BC Applications 2020x).pdf`<br>`Business Builder Academy (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy 2nd/ETG Business Case - Vela Wealth.docx` | `ETG Business Case - Vela Wealth (ETG-BC Applications 2020x).docx`<br>`ETG Business Case - Vela Wealth (ETG-BC Applications 2020xx).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy 2nd/Norm Trainor.pdf` | `Norm Trainor (ETG-BC Applications 2020x).pdf`<br>`Norm Trainor (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy/Business Builder Academy.docx` | `Business Builder Academy (ETG-BC Applications 2020x).docx`<br>`Business Builder Academy (ETG-BC Applications 2020xx).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy/Business Builder Academy.pdf` | `Business Builder Academy (ETG-BC Applications 2020x).pdf`<br>`Business Builder Academy (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy/ETG Business Case - Vela Wealth.docx` | `ETG Business Case - Vela Wealth (ETG-BC Applications 2020x).docx`<br>`ETG Business Case - Vela Wealth (ETG-BC Applications 2020xx).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business Builder Academy/Norm Trainor.pdf` | `Norm Trainor (Old Folders - ETG-BC Applications 2020x).pdf`<br>`Norm Trainor (Old Folders - ETG-BC Applications 2020xx).pdf`<br>`Norm Trainor (CJG-BC Applications 2020 and prior - ETG-BC Applications 2020).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/Business License Payment receipt.pdf` | `Business License Payment receipt (ETG-BC Applications 2020x).pdf`<br>`Business License Payment receipt (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vela Wealth/ETG (Employer Training Grant)/2020/ETG Business Case - Vela Wealth.docx` | `ETG Business Case - Vela Wealth (ETG-BC Applications 2020x).docx`<br>`ETG Business Case - Vela Wealth (ETG-BC Applications 2020xx).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Vorum/ETG (Employer Training Grant)/2020/Kathy Andrews_Resume 2020.docx` | `Kathy Andrews_Resume 2020 (Old Folders).docx`<br>`Kathy Andrews_Resume 2020 (CJG-BC Applications 2020 and prior).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Vorum/ETG (Employer Training Grant)/2021/Business Licence 2021.pdf` | `Business Licence 2021 (ETG-BC Applications 2021).pdf`<br>`Business Licence 2021 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vorum/ETG (Employer Training Grant)/2021/ETG Business Case Information Form-V5.pdf` | `ETG Business Case Information Form-V5 (ETG-BC Applications 2021).pdf`<br>`ETG Business Case Information Form-V5 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vorum/ETG (Employer Training Grant)/2021/Facilitator Bio.pdf` | `Facilitator Bio (ETG-BC Applications 2021).pdf`<br>`Facilitator Bio (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Vorum/ETG (Employer Training Grant)/2021/Kathy Andrews_Resume 2020.pdf` | `Kathy Andrews_Resume 2020 (ETG-BC Applications 2021).pdf`<br>`Kathy Andrews_Resume 2020 (ETG-BC Applications 2021x).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Wakefield/ETG (Employer Training Grant)/2020/15-Week Online Screenplay Story & Structure Workshop Overview/15 Week Screen Writing Course.docx` | `15 Week Screen Writing Course (ETG-BC Applications 2020x).docx`<br>`15 Week Screen Writing Course (ETG-BC Applications 2020xx).docx` |
| **A** | ETG (Employer Training Grant) | `Clients/Wakefield/ETG (Employer Training Grant)/2020/15-Week Online Screenplay Story & Structure Workshop Overview/15 Week Screen Writing Course.pdf` | `15 Week Screen Writing Course (ETG-BC Applications 2020x).pdf`<br>`15 Week Screen Writing Course (ETG-BC Applications 2020xx).pdf` |
| **A** | ETG (Employer Training Grant) | `Clients/Wakefield/ETG (Employer Training Grant)/2020/15-Week Online Screenplay Story & Structure Workshop Overview/Hal Cantor.pdf` | `Hal Cantor (ETG-BC Applications 2020x).pdf`<br>`Hal Cantor (ETG-BC Applications 2020xx).pdf` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/Colm Topkins/Artona Photographer Job Description (1).docx` | `Artona Photographer Job Description (1) (2022 Q2).docx`<br>`Artona Photographer Job Description (1) (2022 Q3).docx` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/Colm Topkins/Colm Topkins.pdf` | `Colm Topkins (2022 Q2).pdf`<br>`Colm Topkins (2022 Q3).pdf` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/Felipe/Artona Photographer Job Description (1).docx` | `Artona Photographer Job Description (1) (2022 Q2).docx`<br>`Artona Photographer Job Description (1) (2022 Q3).docx` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/Felipe/Felipe De Souza.pdf` | `Felipe De Souza (2022 Q2).pdf`<br>`Felipe De Souza (2022 Q3).pdf` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/Felipe/GYW Employer Application.docx` | `GYW Employer Application (2022 Q2).docx`<br>`GYW Employer Application (2022 Q3).docx` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/King Saturno/Artona Photographer Job Description.docx` | `Artona Photographer Job Description (2022 Q2).docx`<br>`Artona Photographer Job Description (2022 Q3).docx` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/King Saturno/GYW Employer Application - King Saturno.docx` | `GYW Employer Application - King Saturno (2022 Q2).docx`<br>`GYW Employer Application - King Saturno (2022 Q3).docx` |
| **A** | GYW (Youth Hiring Subsidy) | `Clients/The Artona Group/GYW (Youth Hiring Subsidy)/2022/King Saturno/King Saturno.pdf` | `King Saturno (2022 Q2).pdf`<br>`King Saturno (2022 Q3).pdf` |
| **A** | Mon Avenir | `Clients/Urban Block Media/Mon Avenir/2021/Stefan Tarnawsky Resume.pdf` | `Stefan Tarnawsky Resume (2021).pdf`<br>`Stefan Tarnawsky Resume (Urban Block Media).pdf` |
| **A** | Mon Avenir | `Clients/Urban Block Media/Mon Avenir/2021/Virtual Event Production Assistant.pdf` | `Virtual Event Production Assistant (2021).pdf`<br>`Virtual Event Production Assistant (Urban Block Media).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2018/Syllabus - Prosci Change Management Certification Program.docx` | `Syllabus - Prosci Change Management Certification Program (CJG-BC Applications 2018x).docx`<br>`Syllabus - Prosci Change Management Certification Program (CJG-BC Applications 2018xx).docx` |
| **B** | ETG (Employer Training Grant) | `Clients/Bellrock/ETG (Employer Training Grant)/2018/Syllabus - Prosci Change Management Certification Program.pdf` | `Syllabus - Prosci Change Management Certification Program (CJG-BC Applications 2018x).pdf`<br>`Syllabus - Prosci Change Management Certification Program (CJG-BC Applications 2018xx).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Blume/ETG (Employer Training Grant)/2020/Digital Marketing 2/Digital Marketing Certificate Course.docx` | `Digital Marketing Certificate Course (ETG-BC Applications 2020x).docx`<br>`Digital Marketing Certificate Course (ETG-BC Applications 2020xx).docx` |
| **B** | ETG (Employer Training Grant) | `Clients/Blume/ETG (Employer Training Grant)/2020/Digital Marketing 2/Digital Marketing Certificate Course.pdf` | `Digital Marketing Certificate Course (ETG-BC Applications 2020x).pdf`<br>`Digital Marketing Certificate Course (ETG-BC Applications 2020xx).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2021/Certificate in Leadership - GPR/1.0 CERTIFICATE IN LEADERSHIP FUNDAMENTALS.docx` | `1.0 CERTIFICATE IN LEADERSHIP FUNDAMENTALS (ETG-BC Applications 2021).docx`<br>`1.0 CERTIFICATE IN LEADERSHIP FUNDAMENTALS (ETG-BC Applications 2021x).docx` |
| **B** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2021/Certificate in Leadership - GPR/1.0 CERTIFICATE IN LEADERSHIP FUNDAMENTALS.pdf` | `1.0 CERTIFICATE IN LEADERSHIP FUNDAMENTALS (ETG-BC Applications 2021).pdf`<br>`1.0 CERTIFICATE IN LEADERSHIP FUNDAMENTALS (ETG-BC Applications 2021x).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Caliber/ETG (Employer Training Grant)/2021/Certificate in Leadership - GPR/ETG-Business-Case-Leadership Fundamentals - GPR.pdf` | `ETG-Business-Case-Leadership Fundamentals - GPR (ETG-BC Applications 2021).pdf`<br>`ETG-Business-Case-Leadership Fundamentals - GPR (ETG-BC Applications 2021x).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Camp Fircom/ETG (Employer Training Grant)/2020/Trauma Tech copy/Occupational First Aid Level 3-converted.pdf` | `Occupational First Aid Level 3-converted (Old Folders - ETG-BC Applications 2020x).pdf`<br>`Occupational First Aid Level 3-converted (Old Folders - ETG-BC Applications 2020xx).pdf`<br>`Occupational First Aid Level 3-converted (CJG-BC Applications 2020 and prior - ETG-BC Applications 2020).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Horizon/ETG (Employer Training Grant)/2017/Info/CPA-Module-Key-Dates-2017-FINAL-V4_0412.pdf` | `CPA-Module-Key-Dates-2017-FINAL-V4_0412 (CJG-BC Applications 2017x (Sept 2017 onwards)).pdf`<br>`CPA-Module-Key-Dates-2017-FINAL-V4_0412 (CJG-BC Applications 2017xx (Jan 2018 onwards)).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Kirmac/ETG (Employer Training Grant)/2020/ST045L01 - Aluminum GMA (MIG) Welding/ST045L01 - Aluminum GMA (MIG) Welding.docx` | `ST045L01 - Aluminum GMA (MIG) Welding (ETG-BC Applications 2020x).docx`<br>`ST045L01 - Aluminum GMA (MIG) Welding (ETG-BC Applications 2020xx).docx` |
| **B** | ETG (Employer Training Grant) | `Clients/Kirmac/ETG (Employer Training Grant)/2020/ST045L01 - Aluminum GMA (MIG) Welding/ST045L01 - Aluminum GMA (MIG) Welding.pdf` | `ST045L01 - Aluminum GMA (MIG) Welding (ETG-BC Applications 2020x).pdf`<br>`ST045L01 - Aluminum GMA (MIG) Welding (ETG-BC Applications 2020xx).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Mind Over Learning/ETG (Employer Training Grant)/2021/MOL 2021 Business Licence.pdf` | `MOL 2021 Business Licence (ETG-BC Applications 2021).pdf`<br>`MOL 2021 Business Licence (ETG-BC Applications 2021x).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Smith Cameron/ETG (Employer Training Grant)/2016/Reim/Employer Reimbursement Verification Form 16_17.docx` | `Employer Reimbursement Verification Form 16_17 (CJG-BC Applications 2016 Intake (April onwards) - Submitted).docx`<br>`Employer Reimbursement Verification Form 16_17 (CJG-BC Applications 2016xx (Q1 2017)).docx` |
| **B** | ETG (Employer Training Grant) | `Clients/Terry Hawes/ETG (Employer Training Grant)/2020/Graduate Legal Studies/Intro to Graduate Legal Studies.pdf` | `Intro to Graduate Legal Studies (Old Folders).pdf`<br>`Intro to Graduate Legal Studies (CJG-BC Applications 2020 and prior).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/Terry Hawes/ETG (Employer Training Grant)/2020/New Administrative Law/"New" Administrative Law.docx` | `"New" Administrative Law (ETG-BC Applications 2020x).docx`<br>`"New" Administrative Law (ETG-BC Applications 2020xx).docx` |
| **B** | ETG (Employer Training Grant) | `Clients/Terry Hawes/ETG (Employer Training Grant)/2020/New Administrative Law/"New" Administrative Law.pdf` | `"New" Administrative Law (ETG-BC Applications 2020x).pdf`<br>`"New" Administrative Law (ETG-BC Applications 2020xx).pdf` |
| **B** | ETG (Employer Training Grant) | `Clients/TPD/ETG (Employer Training Grant)/2016/TPD Submission Status - Sept 23 2016.xlsx` | `TPD Submission Status - Sept 23 2016 (CJG-BC Applications 2016 Intake (April onwards) - Submitted).xlsx`<br>`TPD Submission Status - Sept 23 2016 (CJG-BC Applications 2016x (October onwards)).xlsx` |
| **B** | ETG (Employer Training Grant) | `Clients/Vorum/ETG (Employer Training Grant)/2020/Kathy Andrews_Resume 2020.pdf` | `Kathy Andrews_Resume 2020 (Old Folders).pdf`<br>`Kathy Andrews_Resume 2020 (CJG-BC Applications 2020 and prior).pdf` |

---

## Step 6 — the review pile (2,575 rows)

Grouped by reason class so the review rule can be decided per class rather than per file.

| Reason | Rows | Distinct files | Size |
|---|---|---|---|
| no client folder above this file | 983 | 983 | 2.44 GB |
| folder name was never classified | 750 | 750 | 0.38 GB |
| joint-client folder (dual-filed) | 606 | 303 | 0.05 GB |
| folder labelled unclear, not a client | 236 | 236 | 0.13 GB |
| **Total** | **2,575** | **2,272** | **3.00 GB** |

---

## Step 7 — mechanical pruning signals

**Counted, not acted on.** No file is proposed for deletion; pruning is phase 4. These are string and size signals only — none is a judgement about whether a file matters.

| Signal | Files | Size |
|---|---|---|
| Under a folder named z_Old / OLD STUFF / 1.DELETE / Old Folders and similar | 5,167 | 1.65 GB |
| Filename marks it a template / blank / sample | 1,122 | 0.34 GB |
| Redundant copies in same-size + same-name groups | 6,338 | 2.27 GB |

⚠️ **The duplicate figure is a proxy, not proof.** The inventory carries no content hash, so this counts files sharing an exact byte size *and* an identical filename — 4,302 such groups. That is strong evidence but not byte-identity; confirming it needs hashes, which would mean downloading. Reported as a signal to size the opportunity.

### Folder-name matches, by segment

| Folder segment | Files | Size |
|---|---|---|
| `Old Folders` | 4,937 | 1564.6 MB |
| `z_Old` | 105 | 33.4 MB |
| `z_old` | 42 | 62.7 MB |
| `Z_OLD` | 27 | 11.7 MB |
| `z_Old Documents:Processes` | 26 | 4.0 MB |
| `z_old documents:processes` | 24 | 7.5 MB |
| `Duplicates` | 2 | 0.1 MB |
| `client copy of forms` | 2 | 0.2 MB |
| `Copy of Cheques Received` | 2 | 0.6 MB |

---

## Step 7 — the programs whose cycle year sat in a discarded level

Each row: how many distinct cohort folders the sources came from, and how many distinct year segments they now produce. More years than before means cycles that used to collapse now separate.

| Program | sort files | Source cohort folders | Distinct years now | Cycles separate? |
|---|---|---|---|---|
| ETG (Employer Training Grant) | 17,366 | 21 | 15 | **115 still collide** |
| WorkBC Wage Subsidy | 15,059 | 5 | 5 | yes ✅ |
| Career Launcher Internships (inc DS4Y DT) | 1,206 | 10 | 7 | **14 still collide** |
| DS4Y - VCN | 1,064 | 4 | 4 | yes ✅ |
| DS4Y - LHL | 877 | 6 | 6 | yes ✅ |
| DS4Y - Pinnguaq | 853 | 6 | 6 | yes ✅ |
| Innovate BC - ISI | 712 | 4 | 4 | yes ✅ |
| BuyBC | 634 | 6 | 7 | yes ✅ |
| Mon Avenir | 622 | 6 | 4 | **2 still collide** |
| YESP | 569 | 8 | 8 | yes ✅ |
| GYW (Youth Hiring Subsidy) | 563 | 17 | 9 | **8 still collide** |
| Magnet SWPP | 527 | 14 | 6 | yes ✅ |
| Alberta Jobs Now | 461 | 2 | 2 | yes ✅ |
| AgriMarketing | 398 | 3 | 3 | yes ✅ |
| DS4Y - Innovate BC | 391 | 3 | 3 | yes ✅ |
| Opportunities Fund Program - BCA | 338 | 1 | 1 | yes ✅ |
| iAdvance Pathways | 281 | 2 | 2 | yes ✅ |
| Food Processing SWPP | 239 | 3 | 3 | yes ✅ |
| BioTalent SWPP | 229 | 4 | 4 | yes ✅ |
| Career Ready (ITAC Technation) | 194 | 15 | 4 | yes ✅ |

⚠️ **Fewer distinct years than cohort folders is expected, and is where the residue lives.** ETG has 21 cohort folders yielding 15 years because `ETG-BC Applications 2020x` and `2020xx` are different intakes of the same year. Those are exactly the collisions in Step 5 — the year is right, but the year alone does not separate two intakes within one year.

---

## Step 8 — copy volume and runtime

| Route | Files | Size |
|---|---|---|
| sort | 56,481 | 25.92 GB |
| program | 3,146 | 3.80 GB |
| archive | 12,574 | 10.72 GB |
| **Copyable total** | **72,201** | **40.44 GB** |
| review (not copied) | 2,272 | 3.00 GB |

**Estimated runtime: 38h 46m.** Extrapolated from the pilot's observed throughput — 1,468 files / 4.05 GB in 47m18s, i.e. 1.93s per file or 1.5 MB/s, whichever binds. Here the binding constraint is **per-file overhead**.

That figure assumes the pilot's conditions hold at 40× the volume. It excludes retries, rate limiting beyond what the pilot saw, and the review pile.

---

## Notes

- Year comes from the first sub-path segment when that segment carries a year, else `client_modified`. **`server_modified` is never used** — 40,390 files share a single corrupted 2024-07-23 bulk-event date.
- **Year precedence:** first sub-path segment below the client, then a year on a level discarded between program and client, then `client_modified`. Where discarded levels nest and disagree, the innermost wins — that happened on **13,503** rows.
- 54,822 rows take their year from a discarded batch level; of those 17,173 disagreed with `client_modified` and 0 recovered a year it lacked.
- 866 rows had a leading sub-path segment equal to the year collapsed away; 830 took a first-sub-segment year that disagreed with `client_modified`, 0 recovered a year that `client_modified` lacked.
- 325 distinct folder names were sanitized (colon → ` - `). Filenames are never sanitized on the copy path.
- Nothing here is applied. `dist/inventory/full-mapping.csv` is a proposal for review.

## Reproducing

```bash
node scripts/canexport-mapping.mjs   # unchanged, byte-identical output
node scripts/full-mapping.mjs        # this report
```

