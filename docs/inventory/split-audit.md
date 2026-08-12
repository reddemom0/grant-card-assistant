# Canonical Name Split Audit

**Generated:** 2026-08-12T01:39:57.484Z
**Inputs:** `dist/inventory/clients-final.csv`, `scripts/client-corrections.json`, plus `dist/inventory/grants-inventory.csv` for program membership (neither of the first two carries program *names*, only counts).
**Detection only.** Nothing was merged, and `client-corrections.json` was not modified.

## Why this audit exists

The variant-group review in `final-classification.md` could only surface a split when **two raw folder names shared one canonical**. When each raw name produced its *own* canonical — `Fine Choice Foods` and `Fine Choice Foods Ltd`, both classified `high` confidence — no group formed and the split stayed invisible. This compares canonicals against each other instead.

**1,847 canonical clients examined; 552 suspect pairs found.**

| Tier | Rule | Pairs | Files at stake |
|---|---|---|---|
| near-certain | legal suffix / punctuation | 119 | 8,756 |
| likely | typo (edit distance ≤ 2) | 78 | 8,488 |
| ambiguous | prefix — needs judgement | 355 | 43,443 |

**On the "same program" column:** if two names both appear in the *same* program folder, that is weak evidence they are genuinely different companies — a GC filing one client twice under one program is less likely than the same client recurring across different programs. It is a hint, not a verdict.

Write `merge`, `separate`, or `?` in the Decision column.

---

## Tier 1 — near-certain (119)

Identical once a legal suffix (`Ltd`, `Inc`, `Corp`, `Holdings`, `Group`…) or punctuation and spacing differences are removed. These are the same string written two ways.

⚠️ `Group` and `Holdings` are stripped alongside the true legal suffixes, which is more aggressive: `AME` / `AME Group` and `Strategex` / `Strategex Group` could legitimately be a company and a distinct group entity. Treat those two as tier-2 confidence.

| Name A | Files | Name B | Files | Total | Same program? | Why | Decision |
|---|---|---|---|---|---|---|---|
| AME | 256 | AME Group | 112 | **368** | **yes** (Career Launcher Internships (inc DS4Y DT), ETG (Employer Training Grant)) | both reduce to "ame" |  |
| Nightingale Electrical | 328 | Nightingale Electrical Ltd | 16 | **344** | no | both reduce to "nightingale electrical" |  |
| Strategex | 325 | Strategex Group | 4 | **329** | **yes** (ETG (Employer Training Grant)) | both reduce to "strategex" |  |
| Carmanah Technologies | 272 | Carmanah Technologies Corp | 8 | **280** | **yes** (ETG (Employer Training Grant)) | both reduce to "carmanah technologies" |  |
| Fernie Brewing | 264 | Fernie Brewing Co. | 4 | **268** | no | both reduce to "fernie brewing" |  |
| Taymor Industries | 164 | Taymor Industries Ltd. | 103 | **267** | **yes** (WorkBC Wage Subsidy, ETG (Employer Training Grant)) | both reduce to "taymor industries" |  |
| Fernie Brewing | 264 | Fernie Brewing Company | 1 | **265** | **yes** (ETG (Employer Training Grant)) | both reduce to "fernie brewing" |  |
| The Acorn | 146 | Acorn | 113 | **259** | **yes** (DS4Y - VCN, ETG (Employer Training Grant)) | both reduce to "acorn" |  |
| PHL Capital | 230 | PHL Capital Corp | 24 | **254** | no | both reduce to "phl capital" |  |
| PHL Capital | 230 | PHL Capital Co | 15 | **245** | no | both reduce to "phl capital" |  |
| Mayne Inc. | 210 | Mayne | 23 | **233** | **yes** (ETG (Employer Training Grant)) | both reduce to "mayne" |  |
| Modern Purair | 221 | Modern PURAIR Inc | 8 | **229** | no | both reduce to "modern purair" |  |
| Fine Choice Foods | 196 | Fine Choice Foods Ltd | 4 | **200** | no | both reduce to "fine choice foods" |  |
| The Artona Group | 114 | Artona Group | 61 | **175** | **yes** (WorkBC Wage Subsidy) | both reduce to "artona group" |  |
| Capital City News / Overstory Media | 156 | Capital City News (Overstory Media) | 3 | **159** | no | both reduce to "capital city news overstory media" |  |
| Mak Physiotherapist Co. | 100 | Mak Physiotherapist | 57 | **157** | **yes** (ETG (Employer Training Grant)) | both reduce to "mak physiotherapist" |  |
| Maven Consulting | 145 | Maven Consulting Limited | 5 | **150** | **yes** (ETG (Employer Training Grant)) | both reduce to "maven consulting" |  |
| Trotman Auto Group | 76 | Trotman Auto | 70 | **146** | **yes** (ETG (Employer Training Grant)) | both reduce to "trotman auto" |  |
| Mak Physiotherapist Co. | 100 | Mak Physiotherapist Corp. | 36 | **136** | **yes** (ETG (Employer Training Grant)) | both reduce to "mak physiotherapist" |  |
| Grace & Stella | 117 | Grace and Stella | 14 | **131** | **yes** (GYW (Youth Hiring Subsidy), ETG (Employer Training Grant)) | both reduce to "grace and stella" |  |
| The Cheerful Pelvis | 112 | Cheerful Pelvis | 13 | **125** | **yes** (WorkBC Wage Subsidy, Career Ready (ITAC Technation)) | both reduce to "cheerful pelvis" |  |
| The Answer Company | 92 | The Answer Co | 25 | **117** | **yes** (ETG (Employer Training Grant)) | both reduce to "the answer" |  |
| Artona Group | 61 | Artona | 54 | **115** | no | both reduce to "artona" |  |
| Metropolitan Fine Printers | 88 | Metropolitan Fine Printers Inc. | 23 | **111** | **yes** (WorkBC Wage Subsidy) | both reduce to "metropolitan fine printers" |  |
| Capital City News | 64 | Capital City News Group Ltd. | 47 | **111** | no | both reduce to "capital city news" |  |
| A & B Dental | 62 | A&B Dental | 49 | **111** | **yes** (WorkBC Wage Subsidy) | both reduce to "a and b dental" |  |
| Smile Innovations Group | 103 | Smile Innovations | 7 | **110** | **yes** (WorkBC Wage Subsidy) | both reduce to "smile innovations" |  |
| NGX Interactive | 104 | NGX Interactive Inc | 1 | **105** | no | both reduce to "ngx interactive" |  |
| Simpli Assets | 67 | Simpli Assets Ltd. | 30 | **97** | **yes** (DS4Y - LHL) | both reduce to "simpli assets" |  |
| Mak Physiotherapist | 57 | Mak Physiotherapist Corp. | 36 | **93** | **yes** (ETG (Employer Training Grant)) | both reduce to "mak physiotherapist" |  |
| Tenisci Piva | 75 | Tenisci Piva LLP | 10 | **85** | no | both reduce to "tenisci piva" |  |
| Keystone Environmental | 63 | Keystone Environmental Ltd | 22 | **85** | no | both reduce to "keystone environmental" |  |
| Mellenger Interactive Ltd. | 66 | Mellenger Interactive | 17 | **83** | no | both reduce to "mellenger interactive" |  |
| Meitou | 52 | Meitou Inc. | 30 | **82** | no | both reduce to "meitou" |  |
| The Arbor | 50 | Arbor | 31 | **81** | **yes** (ETG (Employer Training Grant)) | both reduce to "arbor" |  |
| Belleisle Fishing Co. Ltd. | 66 | Belleisle Fishing Co. | 8 | **74** | no | both reduce to "belleisle fishing" |  |
| Wind Sun Sky Entertainment | 58 | Wind Sun Sky Entertainment Inc. | 13 | **71** | no | both reduce to "wind sun sky entertainment" |  |
| Mellenger Interactive Ltd. | 66 | Mellenger Interactive Inc. | 4 | **70** | no | both reduce to "mellenger interactive" |  |
| Northam Law Corporation | 51 | Northam Law | 15 | **66** | **yes** (ETG (Employer Training Grant)) | both reduce to "northam law" |  |
| Vitae Apparel | 38 | Vitae Apparel Inc. | 27 | **65** | **yes** (WorkBC Wage Subsidy) | both reduce to "vitae apparel" |  |
| Stas Holdings | 38 | Stas Holdings Inc. | 25 | **63** | **yes** (ETG (Employer Training Grant)) | both reduce to "stas" |  |
| Wind Sun Sky Entertainment | 58 | Wind Sun Sky Entertainment Co. | 3 | **61** | no | both reduce to "wind sun sky entertainment" |  |
| Remedi Wellness and Spa Ltd. | 59 | Remedi Wellness & Spa Ltd. | 2 | **61** | no | both reduce to "remedi wellness and spa ltd" |  |
| Horizon Contracting | 51 | Horizon Contracting Group | 7 | **58** | no | both reduce to "horizon contracting" |  |
| PG Group Management Ltd | 37 | PG Group Management | 21 | **58** | **yes** (ETG (Employer Training Grant)) | both reduce to "pg management" |  |
| CH Robinson | 54 | C.H. Robinson | 2 | **56** | **yes** (ETG (Employer Training Grant)) | both reduce to "ch robinson" |  |
| Andrea Rodman Interiors | 53 | Andrea Rodman Interiors Inc. | 1 | **54** | no | both reduce to "andrea rodman interiors" |  |
| Invoke Media | 49 | Invoke Media Inc. | 5 | **54** | no | both reduce to "invoke media" |  |
| Director's Guild | 47 | Directors Guild | 7 | **54** | **yes** (ETG (Employer Training Grant)) | both reduce to "directors guild" |  |
| Premium Fence | 29 | Premium Fence Co. | 24 | **53** | **yes** (ETG (Employer Training Grant)) | both reduce to "premium fence" |  |
| Cartems | 39 | Cartem's | 11 | **50** | **yes** (ETG (Employer Training Grant)) | both reduce to "cartems" |  |
| Clir Renewables | 48 | Clir Renewables Inc. | 1 | **49** | no | both reduce to "clir renewables" |  |
| Primex Manufacturing | 30 | Primex Manufacturing Ltd. | 18 | **48** | **yes** (ETG (Employer Training Grant)) | both reduce to "primex manufacturing" |  |
| Colony Construction | 39 | Colony Construction Corporation | 8 | **47** | **yes** (ETG (Employer Training Grant)) | both reduce to "colony construction" |  |
| PS&CO | 30 | PS & CO | 17 | **47** | no | both reduce to "ps and co" |  |
| Multi-Power | 40 | Multi Power | 5 | **45** | no | both reduce to "multi power" |  |
| Mubarak Restaurant | 42 | Mubarak Restaurant Ltd. | 2 | **44** | **yes** (WorkBC Wage Subsidy) | both reduce to "mubarak restaurant" |  |
| Maven | 30 | Maven Group | 14 | **44** | no | both reduce to "maven" |  |
| Hook & Ladder | 34 | Hook and Ladder | 9 | **43** | no | both reduce to "hook and ladder" |  |
| TW Hawes Inc | 28 | TW Hawes | 14 | **42** | **yes** (ETG (Employer Training Grant)) | both reduce to "tw hawes" |  |
| Wakefield Productions Inc. | 32 | Wakefield Productions | 9 | **41** | **yes** (ETG (Employer Training Grant)) | both reduce to "wakefield productions" |  |
| Northam Beverages | 26 | Northam Beverages Ltd. | 15 | **41** | **yes** (ETG (Employer Training Grant)) | both reduce to "northam beverages" |  |
| PHL Capital Corp | 24 | PHL Capital Co | 15 | **39** | **yes** (ETG (Employer Training Grant)) | both reduce to "phl capital" |  |
| Myro Sales Inc. | 20 | Myro Sales | 19 | **39** | **yes** (ETG (Employer Training Grant)) | both reduce to "myro sales" |  |
| Kerrisdale Group | 38 | The Kerrisdale Group | 1 | **39** | **yes** (ETG (Employer Training Grant)) | both reduce to "kerrisdale group" |  |
| Mount Pleasant Dental | 28 | Mount Pleasant Dental Group | 9 | **37** | no | both reduce to "mount pleasant dental" |  |
| Refrigerative Supply | 21 | Refrigerative Supply Limited | 16 | **37** | no | both reduce to "refrigerative supply" |  |
| Pivot and Pilot | 33 | Pivot & Pilot | 4 | **37** | no | both reduce to "pivot and pilot" |  |
| Premium Fence | 29 | Premium Fence Company | 7 | **36** | **yes** (ETG (Employer Training Grant)) | both reduce to "premium fence" |  |
| The Answer Co | 25 | Answer Co. | 11 | **36** | no | both reduce to "answer co" |  |
| E3 Eco | 30 | E3 Eco Group | 5 | **35** | **yes** (ETG (Employer Training Grant)) | both reduce to "e3 eco" |  |
| E3 Eco | 30 | E3 Eco Group Inc. | 5 | **35** | **yes** (ETG (Employer Training Grant)) | both reduce to "e3 eco" |  |
| Workshop Vegetarian | 27 | The Workshop Vegetarian | 8 | **35** | no | both reduce to "workshop vegetarian" |  |
| Key Marketing | 33 | Key Marketing Ltd | 0 | **33** | **yes** (GYW (Youth Hiring Subsidy)) | both reduce to "key marketing" |  |
| Great Canadian Landscaping Company | 29 | Great Canadian Landscaping | 4 | **33** | **yes** (ETG (Employer Training Grant)) | both reduce to "great canadian landscaping" |  |
| OVOU | 29 | Ovou Inc | 3 | **32** | no | both reduce to "ovou" |  |
| Premium Fence Co. | 24 | Premium Fence Company | 7 | **31** | **yes** (ETG (Employer Training Grant)) | both reduce to "premium fence" |  |
| Bells & Whistles | 25 | Bells and Whistles | 6 | **31** | **yes** (ETG (Employer Training Grant)) | both reduce to "bells and whistles" |  |
| Global Alignment Group | 30 | Global Alignment | 0 | **30** | **yes** (ETG (Employer Training Grant)) | both reduce to "global alignment" |  |
| SISU | 21 | Sisu Inc | 9 | **30** | **yes** (ETG (Employer Training Grant)) | both reduce to "sisu" |  |
| MountainBerry Landscaping | 24 | Mountainberry Landscaping Ltd. | 2 | **26** | **yes** (ETG (Employer Training Grant)) | both reduce to "mountainberry landscaping" |  |
| Scoli Clinic | 26 | The Scoli Clinic | 0 | **26** | **yes** (ETG (Employer Training Grant)) | both reduce to "scoli clinic" |  |
| Beacon Collective | 21 | The Beacon Collective | 5 | **26** | no | both reduce to "beacon collective" |  |
| Jaeny Baik Media | 18 | Jaeny Baik Media Inc. | 7 | **25** | **yes** (ETG (Employer Training Grant)) | both reduce to "jaeny baik media" |  |
| Zhao & Associates | 16 | Zhao and Associates | 9 | **25** | **yes** (ETG (Employer Training Grant)) | both reduce to "zhao and associates" |  |
| Legacy Family Office at Assante Financial Management Ltd. | 19 | Legacy Family Office at Assante Financial Management | 4 | **23** | no | both reduce to "legacy family office at assante financial management" |  |
| PrairieCoast Equipment | 16 | PrairieCoast Equipment Inc. | 6 | **22** | **yes** (ETG (Employer Training Grant)) | both reduce to "prairiecoast equipment" |  |
| DentX Solutions Inc | 15 | DentX Solutions Inc. | 7 | **22** | no | both reduce to "dentx solutions inc" |  |
| Mellenger Interactive | 17 | Mellenger Interactive Inc. | 4 | **21** | no | both reduce to "mellenger interactive" |  |
| Brix and Mortar | 19 | Brix & Mortar | 1 | **20** | no | both reduce to "brix and mortar" |  |
| Satya Organics Inc. | 14 | Satya Organics | 5 | **19** | no | both reduce to "satya organics" |  |
| Moonshine Mama's | 11 | Moonshine Mamas | 8 | **19** | no | both reduce to "moonshine mamas" |  |
| Smash & Tess | 11 | Smash and Tess | 8 | **19** | no | both reduce to "smash and tess" |  |
| Keith Jack | 16 | Keith Jack Inc. | 2 | **18** | no | both reduce to "keith jack" |  |
| Mendoza Physiotherapist | 9 | Mendoza Physiotherapist Co. | 9 | **18** | no | both reduce to "mendoza physiotherapist" |  |
| Kindred Studio | 9 | The Kindred Studio | 9 | **18** | no | both reduce to "kindred studio" |  |
| Wind Sun Sky Entertainment Inc. | 13 | Wind Sun Sky Entertainment Co. | 3 | **16** | no | both reduce to "wind sun sky entertainment" |  |
| Kerry Vega Group | 15 | Kerry Vega | 1 | **16** | **yes** (ETG (Employer Training Grant)) | both reduce to "kerry vega" |  |
| Dynamix Agitators | 13 | Dynamix Agitators Inc | 3 | **16** | no | both reduce to "dynamix agitators" |  |
| Enginuity Consulting | 7 | Enginuity Consulting Ltd. | 7 | **14** | **yes** (ETG (Employer Training Grant)) | both reduce to "enginuity consulting" |  |
| Northam Group | 12 | Northam | 1 | **13** | **yes** (ETG (Employer Training Grant)) | both reduce to "northam" |  |
| Blume / Ellebox | 10 | Blume-Ellebox | 3 | **13** | no | both reduce to "blume ellebox" |  |
| Notaco | 10 | Notaco Holdings | 2 | **12** | no | both reduce to "notaco" |  |
| The Workshop Vegetarian | 8 | The Workshop Vegetarian Ltd. | 3 | **11** | no | both reduce to "the workshop vegetarian" |  |
| Victory Square Technologies | 7 | Victory Square Technologies Inc. | 4 | **11** | no | both reduce to "victory square technologies" |  |
| The Woods Spirit Company | 9 | Woods Spirit Company | 2 | **11** | **yes** (ETG (Employer Training Grant)) | both reduce to "woods spirit company" |  |
| E3 Eco Group | 5 | E3 Eco Group Inc. | 5 | **10** | **yes** (ETG (Employer Training Grant)) | both reduce to "e3 eco" |  |
| AJK Consulting Inc | 9 | AJK Consulting | 1 | **10** | no | both reduce to "ajk consulting" |  |
| Urbane Luxury Services | 6 | Urbane Luxury Services Inc. | 4 | **10** | no | both reduce to "urbane luxury services" |  |
| Kids Physio | 7 | Kids Physio Group | 1 | **8** | **yes** (ETG (Employer Training Grant)) | both reduce to "kids physio" |  |
| BC Food and Beverage | 7 | BC Food & Beverage | 1 | **8** | no | both reduce to "bc food and beverage" |  |
| Noel Asmar Group | 5 | Noel Asmar | 2 | **7** | no | both reduce to "noel asmar" |  |
| HRx Technology Inc. | 5 | HRx Technology | 1 | **6** | **yes** (ETG (Employer Training Grant)) | both reduce to "hrx technology" |  |
| Fernie Brewing Co. | 4 | Fernie Brewing Company | 1 | **5** | no | both reduce to "fernie brewing" |  |
| Clementine Natural Health Inc | 4 | Clementine Natural Health | 1 | **5** | no | both reduce to "clementine natural health" |  |
| Sand and Sea Design Company | 4 | Sand and Sea Design | 1 | **5** | **yes** (ETG (Employer Training Grant)) | both reduce to "sand and sea design" |  |
| Dominion NewEnergy | 3 | Dominion Newenergy Inc. | 2 | **5** | no | both reduce to "dominion newenergy" |  |
| Kitchen Table Group | 3 | Kitchen Table | 1 | **4** | no | both reduce to "kitchen table" |  |
| Practical Coaching | 2 | Practical Coaching Ltd | 1 | **3** | **yes** (ETG (Employer Training Grant)) | both reduce to "practical coaching" |  |

---

## Tier 2 — likely (78)

A typo that produced a second canonical instead of merging into the first.

Allowed distance scales with name length — 2 characters only at 8+ characters, 1 at 6–7, and none below 6. Without that guard the rule matched `TEC`/`TAG`, `Clir`/`CFI` and `ClearDent`/`Clearwest`, which are plainly different companies. **160 such pairs were suppressed.**

| Name A | Files | Name B | Files | Total | Same program? | Why | Decision |
|---|---|---|---|---|---|---|---|
| Spare Labs | 802 | Sparelabs | 8 | **810** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 9-character name |  |
| ClearDent | 501 | Clearwest | 219 | **720** | **yes** (WorkBC Wage Subsidy, ETG (Employer Training Grant)) | 2 characters apart on a 9-character name |  |
| Fresh Prep | 590 | FreshPrep | 62 | **652** | **yes** (Career Launcher Internships (inc DS4Y DT)) | 1 character apart on a 9-character name |  |
| Houston Landscapes | 463 | Houston Landscape | 39 | **502** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 17-character name |  |
| Nightingale Electrical | 328 | Nightingale Electric | 16 | **344** | no | 2 characters apart on a 20-character name |  |
| Gunn Consultants | 324 | Gunn Consultant | 7 | **331** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 15-character name |  |
| Coast Spas | 285 | Coast Spa | 7 | **292** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 9-character name |  |
| New:Mode | 164 | New Mode | 120 | **284** | **yes** (DS4Y - LHL, WorkBC Wage Subsidy…) | 1 character apart on a 8-character name |  |
| AME Consulting | 253 | AJK Consulting | 1 | **254** | **yes** (WorkBC Wage Subsidy) | 2 characters apart on a 14-character name |  |
| ChopValue | 241 | Chop Value | 8 | **249** | no | 1 character apart on a 9-character name |  |
| Glass Canvas | 234 | GlassCanvas | 14 | **248** | no | 1 character apart on a 11-character name |  |
| Titan Boats | 242 | TitanBoats | 1 | **243** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 10-character name |  |
| Dynamix | 206 | Dynamic | 5 | **211** | **yes** (Eco Canada - Environmental Jobs Growth) | 1 character apart on a 7-character name |  |
| Hatchways | 189 | Hatchways.io | 5 | **194** | no | 2 characters apart on a 9-character name |  |
| Laid Back Snacks | 155 | Laidback Snacks | 39 | **194** | **yes** (DS4Y - Innovate BC, WorkBC Wage Subsidy) | 1 character apart on a 15-character name |  |
| Frontier CFO | 125 | FrontierCFO | 66 | **191** | **yes** (WorkBC Wage Subsidy) | 1 character apart on a 11-character name |  |
| Westpoint Naturals | 175 | Wespoint Naturals | 10 | **185** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 17-character name |  |
| FansUnite | 170 | Fans Unite | 4 | **174** | no | 1 character apart on a 9-character name |  |
| RightMetric | 133 | Right Metric | 16 | **149** | **yes** (Career Launcher Internships (inc DS4Y DT)) | 1 character apart on a 11-character name |  |
| B Collective | 103 | BCollective | 29 | **132** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 11-character name |  |
| Star West Petroleum | 119 | StarWest Petroleum | 10 | **129** | no | 1 character apart on a 18-character name |  |
| ScoliClinic | 82 | Scoli Clinic | 26 | **108** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 11-character name |  |
| Northyard | 68 | Northyards | 38 | **106** | no | 1 character apart on a 9-character name |  |
| LifeSpace | 83 | Life Space | 11 | **94** | no | 1 character apart on a 9-character name |  |
| Blue Ocean Tea | 83 | Blue Ocean Teaz | 6 | **89** | no | 1 character apart on a 14-character name |  |
| Spring Activators | 76 | Spring Activator | 13 | **89** | no | 1 character apart on a 16-character name |  |
| Blue Ocean Tea | 83 | Blue Ocean Teas | 3 | **86** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 14-character name |  |
| Overlanders | 70 | Overlander | 15 | **85** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 10-character name |  |
| ScoliClinic | 82 | The Scoli Clinic | 0 | **82** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 11-character name |  |
| Black Bird Interactive | 51 | Blackbird Interactive | 16 | **67** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 21-character name |  |
| Allclean | 50 | All Clean | 15 | **65** | no | 1 character apart on a 8-character name |  |
| RedDog | 42 | Red Dog | 22 | **64** | no | 1 character apart on a 6-character name |  |
| Wise Bites | 54 | Wisebites | 3 | **57** | no | 1 character apart on a 9-character name |  |
| Black Tie | 50 | BlackTie | 6 | **56** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 8-character name |  |
| Penny AI | 51 | PennyAI | 4 | **55** | no | 1 character apart on a 7-character name |  |
| Prairie Coast Equipment | 34 | PrairieCoast Equipment | 16 | **50** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 22-character name |  |
| e-Visa Immigration | 47 | eVisa Immigration | 1 | **48** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 17-character name |  |
| BlueMeta Media | 41 | Blue Meta Media | 7 | **48** | no | 1 character apart on a 14-character name |  |
| Director's Guild | 47 | Director Guild | 0 | **47** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 14-character name |  |
| Multi-Power | 40 | Multipower | 7 | **47** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 10-character name |  |
| Liddleworks | 43 | Liddle Works | 3 | **46** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 11-character name |  |
| Coromandel | 43 | Coromondel | 1 | **44** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 10-character name |  |
| mQ Consulting | 21 | mQconsulting | 20 | **41** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 12-character name |  |
| Nice Job | 25 | NiceJob | 15 | **40** | **yes** (Career Launcher Internships (inc DS4Y DT), ETG (Employer Training Grant)) | 1 character apart on a 7-character name |  |
| Sangha Tone | 21 | SanghaTone | 19 | **40** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 10-character name |  |
| CB Process | 36 | CB Processes | 3 | **39** | **yes** (ETG (Employer Training Grant)) | 2 characters apart on a 10-character name |  |
| Shift Interiors | 21 | Shift Interior | 8 | **29** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 14-character name |  |
| Les Amis du Fromage | 14 | Les Amies du Fromage | 13 | **27** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 19-character name |  |
| Fresh Paint | 21 | Freshpaint | 5 | **26** | no | 1 character apart on a 10-character name |  |
| Sangha Tone | 21 | Sangatone | 5 | **26** | **yes** (ETG (Employer Training Grant)) | 2 characters apart on a 9-character name |  |
| Liquid + Solids | 23 | Liquids + Solids | 1 | **24** | no | 1 character apart on a 15-character name |  |
| SanghaTone | 19 | Sangatone | 5 | **24** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 9-character name |  |
| Rainbow Works | 11 | Rainbowworks | 9 | **20** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 12-character name |  |
| Mindful Matter Counselling | 14 | Mindful Matters Counselling | 5 | **19** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 26-character name |  |
| Stonz Wear | 16 | Stonzwear | 1 | **17** | no | 1 character apart on a 9-character name |  |
| TangibleTalk | 9 | Tangible Talk | 8 | **17** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 12-character name |  |
| Domain 7 | 10 | Domain7 | 6 | **16** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 7-character name |  |
| North West Paint | 10 | NorthWest Paint | 3 | **13** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 15-character name |  |
| Vancouver Brain Lab | 10 | Vancouver Brain Labs | 2 | **12** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 19-character name |  |
| Multipower | 7 | Multi Power | 5 | **12** | no | 1 character apart on a 10-character name |  |
| St. Johns Society | 7 | St. John Society | 5 | **12** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 15-character name |  |
| Bel Pacific | 6 | BelPacific | 6 | **12** | no | 1 character apart on a 10-character name |  |
| Facet Advisors | 11 | Facet Advisor | 0 | **11** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 13-character name |  |
| Pranin Organics | 10 | Pranin Organic | 1 | **11** | no | 1 character apart on a 14-character name |  |
| Gibson Dental | 9 | Gibsons Dental | 1 | **10** | no | 1 character apart on a 13-character name |  |
| Platinum Millwork | 8 | Platinum Millworks | 1 | **9** | no | 1 character apart on a 17-character name |  |
| Blue Ocean Teaz | 6 | Blue Ocean Teas | 3 | **9** | no | 1 character apart on a 15-character name |  |
| Directors Guild | 7 | Director Guild | 0 | **7** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 14-character name |  |
| Mogiana Coffee | 5 | Mojiana Coffee | 2 | **7** | no | 1 character apart on a 14-character name |  |
| GDirect Finance | 5 | G-Direct Finance | 1 | **6** | no | 1 character apart on a 15-character name |  |
| MRC Liquids & Solids | 5 | MRC Liquid & Solids | 1 | **6** | no | 1 character apart on a 21-character name |  |
| VanHacks | 5 | VanHack | 1 | **6** | no | 1 character apart on a 7-character name |  |
| Bedford Interactive | 4 | Bedford Integrative | 0 | **4** | **yes** (ETG (Employer Training Grant)) | 2 characters apart on a 19-character name |  |
| Dominion NewEnergy | 3 | Dominion New Energy | 1 | **4** | no | 1 character apart on a 18-character name |  |
| BBS Pro | 2 | BBSPro | 1 | **3** | no | 1 character apart on a 6-character name |  |
| Bite Snacks | 2 | Bite Snack | 1 | **3** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 10-character name |  |
| Lamp Financial | 2 | Lamp Financials | 1 | **3** | **yes** (ETG (Employer Training Grant)) | 1 character apart on a 14-character name |  |
| Rolla Skate Club | 1 | RollaSkate Club | 1 | **2** | no | 1 character apart on a 15-character name |  |

---

## Tier 3 — ambiguous (355)

One name is a strict prefix of the other, with one or two extra words. **These need a human call** — `Clarus` / `Clarus Electrical` turned out to be one company, but a parent and a genuinely separate subsidiary look identical from here.

**Read the “stem shared by” column first.** It counts how many *other* canonicals the shorter name also prefixes. `Horizon` prefixes four unrelated companies (Contracting, CPA, Planners, Contracting Group) — a stem with high fan-out is a common word, not a split. A stem shared by 0 others is the far more likely merge.

| Name A | Files | Name B | Files | Total | Same program? | Stem shared by | Why | Decision |
|---|---|---|---|---|---|---|---|---|
| Caliber | 1,185 | Caliber Projects | 35 | **1,220** | **yes** (Canada Summer Jobs, GYW (Youth Hiring Subsidy)…) | 1 other | "Caliber Projects" = "Caliber" + "projects" |  |
| Keystone | 900 | Keystone Environmental | 63 | **963** | no | **2** others | "Keystone Environmental" = "Keystone" + "environmental" |  |
| Keystone | 900 | Keystone Environmental Ltd | 22 | **922** | **yes** (WorkBC Wage Subsidy) | **2** others | "Keystone Environmental Ltd" = "Keystone" + "environmental ltd" |  |
| Spare | 51 | Spare Labs | 802 | **853** | **yes** (Career Launcher Internships (inc DS4Y DT), Mon Avenir…) | 1 other | "Spare Labs" = "Spare" + "labs" |  |
| Left Coast | 119 | Left Coast Naturals | 724 | **843** | **yes** (ETG (Employer Training Grant)) | 1 other | "Left Coast Naturals" = "Left Coast" + "naturals" |  |
| Horizon | 780 | Horizon Contracting | 51 | **831** | **yes** (ETG (Employer Training Grant), GYW (Youth Hiring Subsidy)) | **4** others | "Horizon Contracting" = "Horizon" + "contracting" |  |
| Horizon | 780 | Horizon CPA | 14 | **794** | **yes** (PSYIP (Grad Hiring Subsidy)) | **4** others | "Horizon CPA" = "Horizon" + "cpa" |  |
| Horizon | 780 | Horizon Planners | 12 | **792** | **yes** (ETG (Employer Training Grant)) | **4** others | "Horizon Planners" = "Horizon" + "planners" |  |
| Horizon | 780 | Horizon Contracting Group | 7 | **787** | no | **4** others | "Horizon Contracting Group" = "Horizon" + "contracting group" |  |
| Trotman | 664 | Trotman Auto Group | 76 | **740** | **yes** (WorkBC Wage Subsidy, ETG (Employer Training Grant)) | **2** others | "Trotman Auto Group" = "Trotman" + "auto group" |  |
| Trotman | 664 | Trotman Auto | 70 | **734** | **yes** (ETG (Employer Training Grant)) | **2** others | "Trotman Auto" = "Trotman" + "auto" |  |
| Nightingale | 291 | Nightingale Electrical | 328 | **619** | **yes** (ETG (Employer Training Grant)) | **3** others | "Nightingale Electrical" = "Nightingale" + "electrical" |  |
| Clir | 485 | Clir Renewables | 48 | **533** | no | **2** others | "Clir Renewables" = "Clir" + "renewables" |  |
| Taymor | 348 | Taymor Industries | 164 | **512** | **yes** (WorkBC Wage Subsidy, ETG (Employer Training Grant)) | **2** others | "Taymor Industries" = "Taymor" + "industries" |  |
| AME | 256 | AME Consulting | 253 | **509** | no | **3** others | "AME Consulting" = "AME" + "consulting" |  |
| Clir | 485 | Clir Renewables Inc. | 1 | **486** | no | **2** others | "Clir Renewables Inc." = "Clir" + "renewables inc" |  |
| Taymor | 348 | Taymor Industries Ltd. | 103 | **451** | **yes** (WorkBC Wage Subsidy, ETG (Employer Training Grant)) | **2** others | "Taymor Industries Ltd." = "Taymor" + "industries ltd" |  |
| Norland | 428 | Norland (BEL) | 1 | **429** | no | 1 other | "Norland (BEL)" = "Norland" + "bel" |  |
| Atkinson | 136 | Atkinson Landscaping | 267 | **403** | **yes** (GYW (Youth Hiring Subsidy), WorkBC Wage Subsidy) | **2** others | "Atkinson Landscaping" = "Atkinson" + "landscaping" |  |
| Twin Lions | 393 | Twin Lions Construction | 8 | **401** | no | **2** others | "Twin Lions Construction" = "Twin Lions" + "construction" |  |
| Twin Lions | 393 | Twin Lions Contracting | 5 | **398** | no | **2** others | "Twin Lions Contracting" = "Twin Lions" + "contracting" |  |
| Modern Purair | 221 | Modern PURAIR Franchises | 156 | **377** | **yes** (WorkBC Wage Subsidy) | **6** others | "Modern PURAIR Franchises" = "Modern Purair" + "franchises" |  |
| Coastal | 72 | Coastal Church | 288 | **360** | **yes** (ETG (Employer Training Grant)) | **3** others | "Coastal Church" = "Coastal" + "church" |  |
| Modern Purair | 221 | Modern PURAIR Kelowna Franchise | 133 | **354** | **yes** (WorkBC Wage Subsidy) | **6** others | "Modern PURAIR Kelowna Franchise" = "Modern Purair" + "kelowna franchise" |  |
| Primex | 308 | Primex Manufacturing | 30 | **338** | **yes** (ETG (Employer Training Grant)) | **2** others | "Primex Manufacturing" = "Primex" + "manufacturing" |  |
| Gunn | 9 | Gunn Consultants | 324 | **333** | **yes** (GYW (Youth Hiring Subsidy)) | **2** others | "Gunn Consultants" = "Gunn" + "consultants" |  |
| Fernie | 66 | Fernie Brewing | 264 | **330** | **yes** (ETG (Employer Training Grant)) | **3** others | "Fernie Brewing" = "Fernie" + "brewing" |  |
| Primex | 308 | Primex Manufacturing Ltd. | 18 | **326** | **yes** (ETG (Employer Training Grant)) | **2** others | "Primex Manufacturing Ltd." = "Primex" + "manufacturing ltd" |  |
| Blume | 309 | Blume / Ellebox | 10 | **319** | **yes** (Career Launcher Internships (inc DS4Y DT)) | **2** others | "Blume / Ellebox" = "Blume" + "ellebox" |  |
| Herschel | 4 | Herschel Supply Co. | 312 | **316** | no | 1 other | "Herschel Supply Co." = "Herschel" + "supply co" |  |
| Blume | 309 | Blume-Ellebox | 3 | **312** | no | **2** others | "Blume-Ellebox" = "Blume" + "ellebox" |  |
| Nightingale | 291 | Nightingale Electric | 16 | **307** | no | **3** others | "Nightingale Electric" = "Nightingale" + "electric" |  |
| Nightingale | 291 | Nightingale Electrical Ltd | 16 | **307** | no | **3** others | "Nightingale Electrical Ltd" = "Nightingale" + "electrical ltd" |  |
| Debrand | 263 | Debrand Services Inc. | 43 | **306** | **yes** (WorkBC Wage Subsidy) | 1 other | "Debrand Services Inc." = "Debrand" + "services inc" |  |
| Heritage | 163 | Heritage Office | 141 | **304** | **yes** (ETG (Employer Training Grant)) | **4** others | "Heritage Office" = "Heritage" + "office" |  |
| PHL | 68 | PHL Capital | 230 | **298** | no | **3** others | "PHL Capital" = "PHL" + "capital" |  |
| Overstory | 25 | Overstory Media Group | 273 | **298** | no | 1 other | "Overstory Media Group" = "Overstory" + "media group" |  |
| SCG | 55 | SCG Process | 229 | **284** | no | 1 other | "SCG Process" = "SCG" + "process" |  |
| QAI | 77 | QAI Laboratories | 201 | **278** | **yes** (ETG (Employer Training Grant)) | 1 other | "QAI Laboratories" = "QAI" + "laboratories" |  |
| Marine Drive | 21 | Marine Drive Golf Club | 256 | **277** | **yes** (Propel SWPP) | 1 other | "Marine Drive Golf Club" = "Marine Drive" + "golf club" |  |
| Modern Purair | 221 | Modern Purair Kelowna | 55 | **276** | **yes** (ETG (Employer Training Grant)) | **6** others | "Modern Purair Kelowna" = "Modern Purair" + "kelowna" |  |
| Santevia | 186 | Santevia Water Systems | 90 | **276** | **yes** (WorkBC Wage Subsidy) | **2** others | "Santevia Water Systems" = "Santevia" + "water systems" |  |
| Ventana | 154 | Ventana Construction | 119 | **273** | **yes** (ETG (Employer Training Grant)) | 1 other | "Ventana Construction" = "Ventana" + "construction" |  |
| Wakefield | 239 | Wakefield Productions Inc. | 32 | **271** | **yes** (DS4Y - LHL, ETG (Employer Training Grant)) | **2** others | "Wakefield Productions Inc." = "Wakefield" + "productions inc" |  |
| AME Consulting | 253 | The AME Consulting Group Ltd. | 8 | **261** | no | 1 other | "The AME Consulting Group Ltd." = "AME Consulting" + "group ltd" |  |
| Regehr | 205 | Regehr Contracting Ltd | 55 | **260** | **yes** (ETG (Employer Training Grant)) | 1 other | "Regehr Contracting Ltd" = "Regehr" + "contracting ltd" |  |
| Modern Purair | 221 | Modern Purair Saskatoon | 38 | **259** | no | **6** others | "Modern Purair Saskatoon" = "Modern Purair" + "saskatoon" |  |
| Wind Sun Sky | 193 | Wind Sun Sky Entertainment | 58 | **251** | **yes** (DS4Y - VCN, Career Launcher Internships (inc DS4Y DT)) | **3** others | "Wind Sun Sky Entertainment" = "Wind Sun Sky" + "entertainment" |  |
| Van Bower | 247 | Van Bower Construction | 1 | **248** | no | 1 other | "Van Bower Construction" = "Van Bower" + "construction" |  |
| Wakefield | 239 | Wakefield Productions | 9 | **248** | **yes** (ETG (Employer Training Grant)) | **2** others | "Wakefield Productions" = "Wakefield" + "productions" |  |
| Clearwest | 219 | Clearwest Solutions | 29 | **248** | no | 1 other | "Clearwest Solutions" = "Clearwest" + "solutions" |  |
| C Market | 7 | C Market Coffee | 237 | **244** | **yes** (Career Launcher Internships (inc DS4Y DT)) | 1 other | "C Market Coffee" = "C Market" + "coffee" |  |
| Modern Purair | 221 | Modern PURAIR Vancouver | 4 | **225** | no | **6** others | "Modern PURAIR Vancouver" = "Modern Purair" + "vancouver" |  |
| Lux | 9 | Lux Quality Homes | 216 | **225** | **yes** (ETG (Employer Training Grant)) | **3** others | "Lux Quality Homes" = "Lux" + "quality homes" |  |
| TAG | 172 | Tag Panels | 49 | **221** | no | 1 other | "Tag Panels" = "TAG" + "panels" |  |
| Capital City News | 64 | Capital City News / Overstory Media | 156 | **220** | no | **4** others | "Capital City News / Overstory Media" = "Capital City News" + "overstory media" |  |
| Dynamix | 206 | Dynamix Agitators | 13 | **219** | no | **2** others | "Dynamix Agitators" = "Dynamix" + "agitators" |  |
| Santevia | 186 | Santevia Water | 32 | **218** | **yes** (WorkBC Wage Subsidy) | **2** others | "Santevia Water" = "Santevia" + "water" |  |
| Periphery | 23 | Periphery Digital | 190 | **213** | no | 1 other | "Periphery Digital" = "Periphery" + "digital" |  |
| Heritage | 163 | Heritage Office Furnishings | 49 | **212** | **yes** (ETG (Employer Training Grant)) | **4** others | "Heritage Office Furnishings" = "Heritage" + "office furnishings" |  |
| Dynamix | 206 | Dynamix Agitators Inc | 3 | **209** | **yes** (ETG (Employer Training Grant)) | **2** others | "Dynamix Agitators Inc" = "Dynamix" + "agitators inc" |  |
| Wind Sun Sky | 193 | Wind Sun Sky Entertainment Inc. | 13 | **206** | no | **3** others | "Wind Sun Sky Entertainment Inc." = "Wind Sun Sky" + "entertainment inc" |  |
| Hapa | 61 | Hapa Collaborative | 142 | **203** | **yes** (ETG (Employer Training Grant)) | 1 other | "Hapa Collaborative" = "Hapa" + "collaborative" |  |
| Wind Sun Sky | 193 | Wind Sun Sky Entertainment Co. | 3 | **196** | **yes** (WorkBC Wage Subsidy) | **3** others | "Wind Sun Sky Entertainment Co." = "Wind Sun Sky" + "entertainment co" |  |
| Jelly | 61 | Jelly Marketing | 135 | **196** | **yes** (ETG (Employer Training Grant)) | 1 other | "Jelly Marketing" = "Jelly" + "marketing" |  |
| Marwick | 65 | Marwick Marketing | 127 | **192** | no | 1 other | "Marwick Marketing" = "Marwick" + "marketing" |  |
| Heritage Office | 141 | Heritage Office Furnishings | 49 | **190** | **yes** (ETG (Employer Training Grant)) | **2** others | "Heritage Office Furnishings" = "Heritage Office" + "furnishings" |  |
| Paintillio | 180 | Paintillio Enterprises | 8 | **188** | **yes** (ETG (Employer Training Grant)) | 1 other | "Paintillio Enterprises" = "Paintillio" + "enterprises" |  |
| Spring | 112 | Spring Activators | 76 | **188** | **yes** (WorkBC Wage Subsidy) | **6** others | "Spring Activators" = "Spring" + "activators" |  |
| Modern Purair Kelowna | 55 | Modern PURAIR Kelowna Franchise | 133 | **188** | no | 1 other | "Modern PURAIR Kelowna Franchise" = "Modern Purair Kelowna" + "franchise" |  |
| IBC | 64 | IBC Technologies | 123 | **187** | **yes** (WorkBC Wage Subsidy, WILWorks SWPP) | 1 other | "IBC Technologies" = "IBC" + "technologies" |  |
| Anita's Organic | 161 | Anita's Organic Mill | 25 | **186** | no | 1 other | "Anita's Organic Mill" = "Anita's Organic" + "mill" |  |
| Remedi | 119 | Remedi Wellness | 62 | **181** | no | **3** others | "Remedi Wellness" = "Remedi" + "wellness" |  |
| Magnum | 165 | Magnum Nutraceuticals | 13 | **178** | **yes** (ETG (Employer Training Grant)) | **2** others | "Magnum Nutraceuticals" = "Magnum" + "nutraceuticals" |  |
| New:Mode | 164 | New:Mode Consulting | 13 | **177** | no | 1 other | "New:Mode Consulting" = "New:Mode" + "consulting" |  |
| Maven | 30 | Maven Consulting | 145 | **175** | **yes** (ETG (Employer Training Grant)) | **4** others | "Maven Consulting" = "Maven" + "consulting" |  |
| Legacy | 21 | Legacy Family Office | 153 | **174** | **yes** (ETG (Employer Training Grant)) | **7** others | "Legacy Family Office" = "Legacy" + "family office" |  |
| NGX | 68 | NGX Interactive | 104 | **172** | **yes** (GYW (Youth Hiring Subsidy), ETG (Employer Training Grant)) | **2** others | "NGX Interactive" = "NGX" + "interactive" |  |
| The Acorn | 146 | Acorn / Abror | 25 | **171** | **yes** (ETG (Employer Training Grant)) | 1 other | "Acorn / Abror" = "The Acorn" + "abror" |  |
| Nova Pacific | 140 | Nova Pacific Environmental | 31 | **171** | no | 1 other | "Nova Pacific Environmental" = "Nova Pacific" + "environmental" |  |
| Shanto | 97 | Shanto Dental Ceramics | 72 | **169** | **yes** (DS4Y - VCN, ETG (Employer Training Grant)) | 1 other | "Shanto Dental Ceramics" = "Shanto" + "dental ceramics" |  |
| Artona | 54 | The Artona Group | 114 | **168** | **yes** (Magnet SWPP) | **2** others | "The Artona Group" = "Artona" + "group" |  |
| Goldilocks | 85 | Goldilocks Wraps | 82 | **167** | **yes** (WorkBC Wage Subsidy) | **2** others | "Goldilocks Wraps" = "Goldilocks" + "wraps" |  |
| Magnum | 165 | Magnum Pharma | 1 | **166** | **yes** (GYW (Youth Hiring Subsidy)) | **2** others | "Magnum Pharma" = "Magnum" + "pharma" |  |
| Heritage | 163 | Heritage Furniture | 3 | **166** | no | **4** others | "Heritage Furniture" = "Heritage" + "furniture" |  |
| AWC | 35 | AWC Process Solutions | 131 | **166** | **yes** (ETG (Employer Training Grant)) | **2** others | "AWC Process Solutions" = "AWC" + "process solutions" |  |
| Heritage | 163 | Heritage Office Financial | 2 | **165** | **yes** (ETG (Employer Training Grant)) | **4** others | "Heritage Office Financial" = "Heritage" + "office financial" |  |
| LifeSpace | 83 | LifeSpace Gardens | 82 | **165** | **yes** (WorkBC Wage Subsidy) | 1 other | "LifeSpace Gardens" = "LifeSpace" + "gardens" |  |
| Anita's | 1 | Anita's Organic | 161 | **162** | no | **2** others | "Anita's Organic" = "Anita's" + "organic" |  |
| Seagate | 127 | Seagate Mass Timber | 34 | **161** | **yes** (ETG (Employer Training Grant)) | 1 other | "Seagate Mass Timber" = "Seagate" + "mass timber" |  |
| Coromandel | 43 | Coromandel Properties | 114 | **157** | **yes** (ETG (Employer Training Grant)) | 1 other | "Coromandel Properties" = "Coromandel" + "properties" |  |
| Legacy Family Office | 153 | Legacy Family Office at Assante | 2 | **155** | **yes** (WorkBC Wage Subsidy) | **3** others | "Legacy Family Office at Assante" = "Legacy Family Office" + "at assante" |  |
| Smith Cameron | 142 | Smith Cameron Process Solutions | 12 | **154** | **yes** (ETG (Employer Training Grant)) | 1 other | "Smith Cameron Process Solutions" = "Smith Cameron" + "process solutions" |  |
| Progrus | 77 | Progrus Constructors | 75 | **152** | **yes** (ETG (Employer Training Grant)) | 1 other | "Progrus Constructors" = "Progrus" + "constructors" |  |
| Camp Fircom | 121 | Camp Fircom Society | 27 | **148** | **yes** (ETG (Employer Training Grant)) | 1 other | "Camp Fircom Society" = "Camp Fircom" + "society" |  |
| RightMetric | 133 | RightMetric Digital | 12 | **145** | **yes** (ETG (Employer Training Grant)) | 1 other | "RightMetric Digital" = "RightMetric" + "digital" |  |
| Heritage Office | 141 | Heritage Office Financial | 2 | **143** | **yes** (ETG (Employer Training Grant)) | **2** others | "Heritage Office Financial" = "Heritage Office" + "financial" |  |
| Atkinson | 136 | Atkinson Landscape | 6 | **142** | no | **2** others | "Atkinson Landscape" = "Atkinson" + "landscape" |  |
| Craver | 127 | Craver Solutions | 13 | **140** | no | 1 other | "Craver Solutions" = "Craver" + "solutions" |  |
| Humanity | 11 | Humanity Financial | 129 | **140** | no | 1 other | "Humanity Financial" = "Humanity" + "financial" |  |
| Acorn | 113 | Acorn / Abror | 25 | **138** | **yes** (ETG (Employer Training Grant)) | 1 other | "Acorn / Abror" = "Acorn" + "abror" |  |
| Star West | 19 | Star West Petroleum | 119 | **138** | **yes** (ETG (Employer Training Grant)) | 1 other | "Star West Petroleum" = "Star West" + "petroleum" |  |
| Stardust Solar | 27 | Stardust Solar Technologies | 106 | **133** | no | 1 other | "Stardust Solar Technologies" = "Stardust Solar" + "technologies" |  |
| Lux | 9 | Lux Insights | 124 | **133** | **yes** (ETG (Employer Training Grant)) | **3** others | "Lux Insights" = "Lux" + "insights" |  |
| Bellrock | 119 | Bellrock Benchmarking | 11 | **130** | no | 1 other | "Bellrock Benchmarking" = "Bellrock" + "benchmarking" |  |
| Reliable Equipment | 21 | Reliable Equipment Rentals | 107 | **128** | **yes** (WorkBC Wage Subsidy, ETG (Employer Training Grant)) | 1 other | "Reliable Equipment Rentals" = "Reliable Equipment" + "rentals" |  |
| Everyoung | 24 | Everyoung Medical Aesthetics | 102 | **126** | **yes** (GYW (Youth Hiring Subsidy), WorkBC Wage Subsidy) | 1 other | "Everyoung Medical Aesthetics" = "Everyoung" + "medical aesthetics" |  |
| Spring | 112 | Spring Activator | 13 | **125** | no | **6** others | "Spring Activator" = "Spring" + "activator" |  |
| Spring | 112 | Spring Planning | 12 | **124** | **yes** (Magnet SWPP, ETG (Employer Training Grant)) | **6** others | "Spring Planning" = "Spring" + "planning" |  |
| Spring | 112 | Spring U | 12 | **124** | no | **6** others | "Spring U" = "Spring" + "u" |  |
| Santevia Water | 32 | Santevia Water Systems | 90 | **122** | **yes** (WorkBC Wage Subsidy) | 1 other | "Santevia Water Systems" = "Santevia Water" + "systems" |  |
| Nexus | 76 | Nexus Construction | 45 | **121** | **yes** (ETG (Employer Training Grant)) | 1 other | "Nexus Construction" = "Nexus" + "construction" |  |
| Trading Post | 42 | Trading Post Brewing | 79 | **121** | **yes** (GYW (Youth Hiring Subsidy), ETG (Employer Training Grant)) | 1 other | "Trading Post Brewing" = "Trading Post" + "brewing" |  |
| Romex | 62 | Romex Canada | 57 | **119** | **yes** (ETG (Employer Training Grant)) | 1 other | "Romex Canada" = "Romex" + "canada" |  |
| Goldilocks | 85 | Goldilocks Sustainable | 33 | **118** | no | **2** others | "Goldilocks Sustainable" = "Goldilocks" + "sustainable" |  |
| Cross the Road | 114 | Cross The Road Restaurant | 3 | **117** | no | 1 other | "Cross The Road Restaurant" = "Cross the Road" + "restaurant" |  |
| Icon | 18 | Icon Global Supply | 97 | **115** | no | **2** others | "Icon Global Supply" = "Icon" + "global supply" |  |
| Spring | 112 | Spring Financial Planning | 2 | **114** | **yes** (ETG (Employer Training Grant)) | **6** others | "Spring Financial Planning" = "Spring" + "financial planning" |  |
| Blue Meta | 105 | Blue Meta Media | 7 | **112** | no | 1 other | "Blue Meta Media" = "Blue Meta" + "media" |  |
| PrairieCoast | 95 | PrairieCoast Equipment | 16 | **111** | no | **2** others | "PrairieCoast Equipment" = "PrairieCoast" + "equipment" |  |
| Launchtrip | 101 | Launchtrip Technologies Co. | 9 | **110** | no | 1 other | "Launchtrip Technologies Co." = "Launchtrip" + "technologies co" |  |
| Icon Global | 13 | Icon Global Supply | 97 | **110** | no | 1 other | "Icon Global Supply" = "Icon Global" + "supply" |  |
| PGL | 37 | PGL Consultants | 67 | **104** | **yes** (ETG (Employer Training Grant)) | **2** others | "PGL Consultants" = "PGL" + "consultants" |  |
| Smile | 1 | Smile Innovations Group | 103 | **104** | **yes** (ETG (Employer Training Grant)) | **2** others | "Smile Innovations Group" = "Smile" + "innovations group" |  |
| Coastal | 72 | Coastal Reign | 30 | **102** | **yes** (ETG (Employer Training Grant)) | **3** others | "Coastal Reign" = "Coastal" + "reign" |  |
| PrairieCoast | 95 | PrairieCoast Equipment Inc. | 6 | **101** | no | **2** others | "PrairieCoast Equipment Inc." = "PrairieCoast" + "equipment inc" |  |
| Andrea Rodman | 45 | Andrea Rodman Interiors | 53 | **98** | **yes** (DS4Y - VCN, Career Launcher Internships (inc DS4Y DT)) | **2** others | "Andrea Rodman Interiors" = "Andrea Rodman" + "interiors" |  |
| Delta-Q | 13 | Delta-Q Technologies | 85 | **98** | **yes** (ETG (Employer Training Grant)) | 1 other | "Delta-Q Technologies" = "Delta-Q" + "technologies" |  |
| CondoWorks | 36 | Condoworks Design Renovations | 60 | **96** | no | 1 other | "Condoworks Design Renovations" = "CondoWorks" + "design renovations" |  |
| DNE | 77 | DNE Resources | 18 | **95** | **yes** (Green Jobs) | 1 other | "DNE Resources" = "DNE" + "resources" |  |
| Semperviva | 76 | Semperviva Yoga | 17 | **93** | **yes** (ETG (Employer Training Grant)) | 1 other | "Semperviva Yoga" = "Semperviva" + "yoga" |  |
| Pacific Solutions | 21 | Pacific Solutions Contracting | 72 | **93** | **yes** (ETG (Employer Training Grant)) | 1 other | "Pacific Solutions Contracting" = "Pacific Solutions" + "contracting" |  |
| PHL | 68 | PHL Capital Corp | 24 | **92** | **yes** (ETG (Employer Training Grant)) | **3** others | "PHL Capital Corp" = "PHL" + "capital corp" |  |
| Decade | 19 | Decade Impact | 73 | **92** | no | 1 other | "Decade Impact" = "Decade" + "impact" |  |
| Clearmind | 74 | Clearmind International Institute | 15 | **89** | no | 1 other | "Clearmind International Institute" = "Clearmind" + "international institute" |  |
| Great Lawns | 14 | Great Lawns & Beyond | 75 | **89** | no | **2** others | "Great Lawns & Beyond" = "Great Lawns" + "and beyond" |  |
| Sutherland | 87 | The Sutherland Group | 1 | **88** | no | 1 other | "The Sutherland Group" = "Sutherland" + "group" |  |
| Stonz | 72 | Stonz Wear | 16 | **88** | **yes** (ETG (Employer Training Grant)) | 1 other | "Stonz Wear" = "Stonz" + "wear" |  |
| LBN | 60 | LBN Brands | 26 | **86** | no | 1 other | "LBN Brands" = "LBN" + "brands" |  |
| Invoke | 35 | Invoke Media | 49 | **84** | no | **2** others | "Invoke Media" = "Invoke" + "media" |  |
| Blue Ocean | 1 | Blue Ocean Tea | 83 | **84** | **yes** (CanExport) | **3** others | "Blue Ocean Tea" = "Blue Ocean" + "tea" |  |
| PHL | 68 | PHL Capital Co | 15 | **83** | **yes** (ETG (Employer Training Grant)) | **3** others | "PHL Capital Co" = "PHL" + "capital co" |  |
| Capstone | 35 | Capstone ITS | 47 | **82** | **yes** (DS4Y - VCN) | **2** others | "Capstone ITS" = "Capstone" + "its" |  |
| Black Tie | 50 | Black Tie Property | 31 | **81** | **yes** (ETG (Employer Training Grant)) | **2** others | "Black Tie Property" = "Black Tie" + "property" |  |
| Harmonic | 29 | Harmonic Machine | 52 | **81** | **yes** (WorkBC Wage Subsidy) | **2** others | "Harmonic Machine" = "Harmonic" + "machine" |  |
| Sunrise Village | 3 | Sunrise Village Dental | 78 | **81** | no | 1 other | "Sunrise Village Dental" = "Sunrise Village" + "dental" |  |
| McMaster | 19 | McMaster Digital | 61 | **80** | **yes** (DS4Y - LHL) | 1 other | "McMaster Digital" = "McMaster" + "digital" |  |
| 6s | 9 | 6S Marketing | 71 | **80** | **yes** (ETG (Employer Training Grant)) | 1 other | "6S Marketing" = "6s" + "marketing" |  |
| Gentai | 44 | Gentai Capital | 34 | **78** | **yes** (ETG (Employer Training Grant)) | 1 other | "Gentai Capital" = "Gentai" + "capital" |  |
| Legacy | 21 | Legacy Advantage | 57 | **78** | **yes** (ETG (Employer Training Grant)) | **7** others | "Legacy Advantage" = "Legacy" + "advantage" |  |
| Tenisci | 3 | Tenisci Piva | 75 | **78** | **yes** (Mon Avenir) | **2** others | "Tenisci Piva" = "Tenisci" + "piva" |  |
| Great Lawns & Beyond | 75 | Great Lawns & Beyond Landscaping | 2 | **77** | no | 1 other | "Great Lawns & Beyond Landscaping" = "Great Lawns & Beyond" + "landscaping" |  |
| Gibsons | 24 | Gibsons Dental Centre | 53 | **77** | **yes** (WorkBC Wage Subsidy) | **2** others | "Gibsons Dental Centre" = "Gibsons" + "dental centre" |  |
| Falcon | 4 | Falcon Equipment | 71 | **75** | **yes** (ETG (Employer Training Grant)) | **4** others | "Falcon Equipment" = "Falcon" + "equipment" |  |
| Coastal | 72 | Coastal Cogs | 1 | **73** | no | **3** others | "Coastal Cogs" = "Coastal" + "cogs" |  |
| Longboard | 69 | Longboard Architectural Products | 4 | **73** | no | **2** others | "Longboard Architectural Products" = "Longboard" + "architectural products" |  |
| Fernie | 66 | Fernie Brewing Co. | 4 | **70** | no | **3** others | "Fernie Brewing Co." = "Fernie" + "brewing co" |  |
| Pivot and Pilot | 33 | Pivot & Pilot Creative | 37 | **70** | **yes** (DS4Y - Innovate BC) | 1 other | "Pivot & Pilot Creative" = "Pivot and Pilot" + "creative" |  |
| NGX | 68 | NGX Interactive Inc | 1 | **69** | no | **2** others | "NGX Interactive Inc" = "NGX" + "interactive inc" |  |
| Tandem | 18 | Tandem IG | 51 | **69** | no | **2** others | "Tandem IG" = "Tandem" + "ig" |  |
| Fernie | 66 | Fernie Brewing Company | 1 | **67** | **yes** (ETG (Employer Training Grant)) | **3** others | "Fernie Brewing Company" = "Fernie" + "brewing company" |  |
| Capital City News | 64 | Capital City News (Overstory Media) | 3 | **67** | **yes** (GYW (Youth Hiring Subsidy)) | **4** others | "Capital City News (Overstory Media)" = "Capital City News" + "overstory media" |  |
| A & B Dental | 62 | A & B Dental Clinic | 5 | **67** | no | 1 other | "A & B Dental Clinic" = "A & B Dental" + "clinic" |  |
| Stonebridge | 36 | Stonebridge Imports | 31 | **67** | no | 1 other | "Stonebridge Imports" = "Stonebridge" + "imports" |  |
| Black Tie | 50 | Black Tie Property Services | 16 | **66** | **yes** (ETG (Employer Training Grant)) | **2** others | "Black Tie Property Services" = "Black Tie" + "property services" |  |
| Vitae | 27 | Vitae Apparel | 38 | **65** | no | **2** others | "Vitae Apparel" = "Vitae" + "apparel" |  |
| Capital City | 1 | Capital City News | 64 | **65** | no | **6** others | "Capital City News" = "Capital City" + "news" |  |
| West X | 40 | West X Business Solutions | 24 | **64** | **yes** (ETG (Employer Training Grant)) | 1 other | "West X Business Solutions" = "West X" + "business solutions" |  |
| Swift | 36 | Swift Disability | 28 | **64** | **yes** (WorkBC Wage Subsidy) | **3** others | "Swift Disability" = "Swift" + "disability" |  |
| Fatso | 14 | Fatso Peanut Butter | 50 | **64** | no | 1 other | "Fatso Peanut Butter" = "Fatso" + "peanut butter" |  |
| Benchmark | 37 | Benchmark Homes | 26 | **63** | **yes** (ETG (Employer Training Grant)) | 1 other | "Benchmark Homes" = "Benchmark" + "homes" |  |
| Sterling Cooper | 51 | Sterling Cooper-NDY | 11 | **62** | **yes** (ETG (Employer Training Grant)) | 1 other | "Sterling Cooper-NDY" = "Sterling Cooper" + "ndy" |  |
| Chong Hong | 36 | Chong Hong Construction | 26 | **62** | **yes** (ETG (Employer Training Grant)) | 1 other | "Chong Hong Construction" = "Chong Hong" + "construction" |  |
| Final Touch | 30 | Final Touch Window Coverings | 32 | **62** | **yes** (ETG (Employer Training Grant)) | 1 other | "Final Touch Window Coverings" = "Final Touch" + "window coverings" |  |
| Capstone | 35 | Capstone Canada | 26 | **61** | no | **2** others | "Capstone Canada" = "Capstone" + "canada" |  |
| Body Energy | 3 | Body Energy Club | 58 | **61** | no | 1 other | "Body Energy Club" = "Body Energy" + "club" |  |
| Clementine | 59 | Clementine Natural Health | 1 | **60** | no | **2** others | "Clementine Natural Health" = "Clementine" + "natural health" |  |
| Penny AI | 51 | Penny AI Technologies | 9 | **60** | no | 1 other | "Penny AI Technologies" = "Penny AI" + "technologies" |  |
| Windfall | 2 | Windfall Cider | 57 | **59** | no | 1 other | "Windfall Cider" = "Windfall" + "cider" |  |
| Ronin8 | 22 | Ronin8 Technologies | 36 | **58** | **yes** (ETG (Employer Training Grant)) | 1 other | "Ronin8 Technologies" = "Ronin8" + "technologies" |  |
| Stoxx | 18 | Stoxx Vintage | 40 | **58** | no | 1 other | "Stoxx Vintage" = "Stoxx" + "vintage" |  |
| LendingArch | 54 | Lendingarch Financial | 3 | **57** | no | 1 other | "Lendingarch Financial" = "LendingArch" + "financial" |  |
| HAVEN | 39 | Haven Apparel | 18 | **57** | no | **2** others | "Haven Apparel" = "HAVEN" + "apparel" |  |
| A&B Dental | 49 | A & B Dental Clinic | 5 | **54** | no | 1 other | "A & B Dental Clinic" = "A&B Dental" + "clinic" |  |
| AWC | 35 | AWC Solutions | 19 | **54** | **yes** (ETG (Employer Training Grant)) | **2** others | "AWC Solutions" = "AWC" + "solutions" |  |
| Vitae | 27 | Vitae Apparel Inc. | 27 | **54** | no | **2** others | "Vitae Apparel Inc." = "Vitae" + "apparel inc" |  |
| Gibsons Dental | 1 | Gibsons Dental Centre | 53 | **54** | no | 1 other | "Gibsons Dental Centre" = "Gibsons Dental" + "centre" |  |
| Boast | 31 | Boast Capital | 22 | **53** | no | 1 other | "Boast Capital" = "Boast" + "capital" |  |
| Laidback | 14 | Laidback Snacks | 39 | **53** | no | 1 other | "Laidback Snacks" = "Laidback" + "snacks" |  |
| Six and a Half | 3 | Six and a Half Consulting | 50 | **53** | **yes** (ETG (Employer Training Grant)) | 1 other | "Six and a Half Consulting" = "Six and a Half" + "consulting" |  |
| Aegis | 2 | Aegis Finishing | 51 | **53** | no | 1 other | "Aegis Finishing" = "Aegis" + "finishing" |  |
| Vegpro | 48 | Vegpro (Salad Etc) | 4 | **52** | no | 1 other | "Vegpro (Salad Etc)" = "Vegpro" + "salad etc" |  |
| Sterling Fleet | 31 | Sterling Fleet Outfitters | 21 | **52** | **yes** (ETG (Employer Training Grant)) | 1 other | "Sterling Fleet Outfitters" = "Sterling Fleet" + "outfitters" |  |
| Northam | 1 | Northam Law Corporation | 51 | **52** | **yes** (ETG (Employer Training Grant)) | **5** others | "Northam Law Corporation" = "Northam" + "law corporation" |  |
| Stony Point | 3 | Stony Point Construction | 48 | **51** | **yes** (ETG (Employer Training Grant)) | 1 other | "Stony Point Construction" = "Stony Point" + "construction" |  |
| Blackfish | 27 | Blackfish Homes | 23 | **50** | **yes** (ETG (Employer Training Grant)) | 1 other | "Blackfish Homes" = "Blackfish" + "homes" |  |
| Pique | 46 | Pique Ventures | 1 | **47** | no | 1 other | "Pique Ventures" = "Pique" + "ventures" |  |
| Black Tie Property | 31 | Black Tie Property Services | 16 | **47** | **yes** (ETG (Employer Training Grant)) | 1 other | "Black Tie Property Services" = "Black Tie Property" + "services" |  |
| Liz McDonald | 8 | Liz McDonald Consulting | 39 | **47** | **yes** (ETG (Employer Training Grant)) | 1 other | "Liz McDonald Consulting" = "Liz McDonald" + "consulting" |  |
| Andrea Rodman | 45 | Andrea Rodman Interiors Inc. | 1 | **46** | no | **2** others | "Andrea Rodman Interiors Inc." = "Andrea Rodman" + "interiors inc" |  |
| Steadfast | 40 | Steadfast Counselling | 5 | **45** | **yes** (ETG (Employer Training Grant)) | 1 other | "Steadfast Counselling" = "Steadfast" + "counselling" |  |
| Swift | 36 | Swift Security | 9 | **45** | **yes** (WorkBC Wage Subsidy) | **3** others | "Swift Security" = "Swift" + "security" |  |
| Essence | 8 | Essence Properties | 36 | **44** | **yes** (ETG (Employer Training Grant)) | 1 other | "Essence Properties" = "Essence" + "properties" |  |
| Mubarak | 2 | Mubarak Restaurant | 42 | **44** | no | **2** others | "Mubarak Restaurant" = "Mubarak" + "restaurant" |  |
| Eligeo | 34 | Eligeo CRM Inc. | 9 | **43** | no | 1 other | "Eligeo CRM Inc." = "Eligeo" + "crm inc" |  |
| Ascent | 23 | Ascent Drywall | 20 | **43** | **yes** (WorkBC Wage Subsidy) | **2** others | "Ascent Drywall" = "Ascent" + "drywall" |  |
| Stillhead | 8 | Stillhead Distillery | 35 | **43** | no | 1 other | "Stillhead Distillery" = "Stillhead" + "distillery" |  |
| Spark | 12 | Spark Kombucha | 29 | **41** | no | 1 other | "Spark Kombucha" = "Spark" + "kombucha" |  |
| Pivot & Pilot | 4 | Pivot & Pilot Creative | 37 | **41** | no | 1 other | "Pivot & Pilot Creative" = "Pivot & Pilot" + "creative" |  |
| Invoke | 35 | Invoke Media Inc. | 5 | **40** | **yes** (WorkBC Wage Subsidy) | **2** others | "Invoke Media Inc." = "Invoke" + "media inc" |  |
| Veza | 30 | Veza Community | 10 | **40** | no | **2** others | "Veza Community" = "Veza" + "community" |  |
| Catapult | 17 | Catapult ERP | 23 | **40** | **yes** (ETG (Employer Training Grant)) | **2** others | "Catapult ERP" = "Catapult" + "erp" |  |
| Northyards | 38 | Northyards Cidery | 1 | **39** | **yes** (WorkBC Wage Subsidy) | 1 other | "Northyards Cidery" = "Northyards" + "cidery" |  |
| Reliance | 35 | Reliance Insurance | 4 | **39** | **yes** (ETG (Employer Training Grant)) | 1 other | "Reliance Insurance" = "Reliance" + "insurance" |  |
| Maven | 30 | Maven Studios | 9 | **39** | **yes** (ETG (Employer Training Grant)) | **4** others | "Maven Studios" = "Maven" + "studios" |  |
| Juke | 11 | Juke Fried Chicken | 28 | **39** | **yes** (BuyBC) | 1 other | "Juke Fried Chicken" = "Juke" + "fried chicken" |  |
| Swift | 36 | Swift Security Systems | 2 | **38** | no | **3** others | "Swift Security Systems" = "Swift" + "security systems" |  |
| PGL | 37 | PGL Environment | 0 | **37** | **yes** (ETG (Employer Training Grant)) | **2** others | "PGL Environment" = "PGL" + "environment" |  |
| Cork It Wine | 29 | Cork It Wine Making | 8 | **37** | no | 1 other | "Cork It Wine Making" = "Cork It Wine" + "making" |  |
| Workshop Vegetarian | 27 | Workshop Vegetarian Cafe | 10 | **37** | no | **2** others | "Workshop Vegetarian Cafe" = "Workshop Vegetarian" + "cafe" |  |
| Blueprint | 13 | Blueprint Strata | 24 | **37** | **yes** (ETG (Employer Training Grant)) | 1 other | "Blueprint Strata" = "Blueprint" + "strata" |  |
| TLG Millwerks | 32 | TLG Millwerks (Twin Lions) | 4 | **36** | no | 1 other | "TLG Millwerks (Twin Lions)" = "TLG Millwerks" + "twin lions" |  |
| Veza | 30 | Veza Consulting | 6 | **36** | **yes** (Career Launcher Internships (inc DS4Y DT)) | **2** others | "Veza Consulting" = "Veza" + "consulting" |  |
| IV Health | 24 | IV Health Centre | 12 | **36** | **yes** (WorkBC Wage Subsidy) | 1 other | "IV Health Centre" = "IV Health" + "centre" |  |
| Larry's | 18 | Larry's Market | 18 | **36** | no | 1 other | "Larry's Market" = "Larry's" + "market" |  |
| Maven | 30 | Maven Consulting Limited | 5 | **35** | **yes** (ETG (Employer Training Grant)) | **4** others | "Maven Consulting Limited" = "Maven" + "consulting limited" |  |
| Harmonic | 29 | Harmonic Arts | 6 | **35** | no | **2** others | "Harmonic Arts" = "Harmonic" + "arts" |  |
| Dawn Cox | 20 | Dawn Cox Counselling | 15 | **35** | **yes** (ETG (Employer Training Grant)) | 1 other | "Dawn Cox Counselling" = "Dawn Cox" + "counselling" |  |
| BetterWith | 17 | Betterwith Foods | 18 | **35** | no | **2** others | "Betterwith Foods" = "BetterWith" + "foods" |  |
| Elettra | 14 | Elettra Communications Ltd. | 21 | **35** | **yes** (ETG (Employer Training Grant)) | 1 other | "Elettra Communications Ltd." = "Elettra" + "communications ltd" |  |
| Andgo | 10 | AndGo Systems | 25 | **35** | no | 1 other | "AndGo Systems" = "Andgo" + "systems" |  |
| Mankind | 16 | Mankind Media | 18 | **34** | no | 1 other | "Mankind Media" = "Mankind" + "media" |  |
| Avanti | 27 | Avanti CPA LLP | 6 | **33** | no | 1 other | "Avanti CPA LLP" = "Avanti" + "cpa llp" |  |
| NDY | 9 | NDY Contracting | 24 | **33** | no | 1 other | "NDY Contracting" = "NDY" + "contracting" |  |
| Humanising Data | 1 | Humanising Data Consulting | 32 | **33** | **yes** (ETG (Employer Training Grant)) | 1 other | "Humanising Data Consulting" = "Humanising Data" + "consulting" |  |
| Red Dog | 22 | Red Dog Deli | 10 | **32** | no | 1 other | "Red Dog Deli" = "Red Dog" + "deli" |  |
| Bandidas | 22 | Bandidas Taqueria | 9 | **31** | **yes** (ETG (Employer Training Grant)) | 1 other | "Bandidas Taqueria" = "Bandidas" + "taqueria" |  |
| Icon | 18 | Icon Global | 13 | **31** | no | **2** others | "Icon Global" = "Icon" + "global" |  |
| AmPlus | 15 | AmPlus Marketing | 16 | **31** | **yes** (ETG (Employer Training Grant)) | 1 other | "AmPlus Marketing" = "AmPlus" + "marketing" |  |
| Dynamic | 5 | Dynamic Reforestation | 26 | **31** | no | 1 other | "Dynamic Reforestation" = "Dynamic" + "reforestation" |  |
| Workshop Vegetarian | 27 | The Workshop Vegetarian Ltd. | 3 | **30** | no | **2** others | "The Workshop Vegetarian Ltd." = "Workshop Vegetarian" + "ltd" |  |
| Bonjour | 15 | Bonjour Marketplace | 15 | **30** | no | 1 other | "Bonjour Marketplace" = "Bonjour" + "marketplace" |  |
| Dossier | 7 | Dossier Creative | 23 | **30** | **yes** (ETG (Employer Training Grant)) | 1 other | "Dossier Creative" = "Dossier" + "creative" |  |
| Kalev Fitness | 19 | Kalev Fitness Solution | 10 | **29** | **yes** (PSYIP (Grad Hiring Subsidy)) | 1 other | "Kalev Fitness Solution" = "Kalev Fitness" + "solution" |  |
| Nemesis | 15 | Nemesis Coffee | 14 | **29** | **yes** (ETG (Employer Training Grant)) | **3** others | "Nemesis Coffee" = "Nemesis" + "coffee" |  |
| Blackbird | 13 | Blackbird Interactive | 16 | **29** | **yes** (ETG (Employer Training Grant)) | 1 other | "Blackbird Interactive" = "Blackbird" + "interactive" |  |
| Catapult ERP | 23 | Catapult ERP Services | 5 | **28** | **yes** (ETG (Employer Training Grant)) | 1 other | "Catapult ERP Services" = "Catapult ERP" + "services" |  |
| Delish | 20 | Delish General Store | 8 | **28** | **yes** (ETG (Employer Training Grant)) | 1 other | "Delish General Store" = "Delish" + "general store" |  |
| BerryMobile | 19 | BerryMobile Fruit Distribution | 9 | **28** | **yes** (ETG (Employer Training Grant)) | 1 other | "BerryMobile Fruit Distribution" = "BerryMobile" + "fruit distribution" |  |
| Sasen | 2 | Sasen Renovations | 26 | **28** | no | 1 other | "Sasen Renovations" = "Sasen" + "renovations" |  |
| Pranin | 17 | Pranin Organics | 10 | **27** | no | **2** others | "Pranin Organics" = "Pranin" + "organics" |  |
| Northam | 1 | Northam Beverages | 26 | **27** | **yes** (ETG (Employer Training Grant)) | **5** others | "Northam Beverages" = "Northam" + "beverages" |  |
| New Vision | 12 | New Vision Projects | 14 | **26** | **yes** (ETG (Employer Training Grant)) | 1 other | "New Vision Projects" = "New Vision" + "projects" |  |
| Anita's | 1 | Anita's Organic Mill | 25 | **26** | **yes** (ETG (Employer Training Grant)) | **2** others | "Anita's Organic Mill" = "Anita's" + "organic mill" |  |
| Gibsons | 24 | Gibsons Dental | 1 | **25** | no | **2** others | "Gibsons Dental" = "Gibsons" + "dental" |  |
| Nemesis | 15 | Nemesis Coffee (Commissary) | 10 | **25** | no | **3** others | "Nemesis Coffee (Commissary)" = "Nemesis" + "coffee commissary" |  |
| Tangible Talk | 8 | Tangible Talk Integrative Therapy | 17 | **25** | **yes** (ETG (Employer Training Grant)) | 1 other | "Tangible Talk Integrative Therapy" = "Tangible Talk" + "integrative therapy" |  |
| Nemesis Coffee | 14 | Nemesis Coffee (Commissary) | 10 | **24** | no | **2** others | "Nemesis Coffee (Commissary)" = "Nemesis Coffee" + "commissary" |  |
| Bon Voyage | 16 | Bon Voyage Medical | 7 | **23** | no | 1 other | "Bon Voyage Medical" = "Bon Voyage" + "medical" |  |
| Victory Square | 16 | Victory Square Technologies | 7 | **23** | no | **2** others | "Victory Square Technologies" = "Victory Square" + "technologies" |  |
| Kalev | 4 | Kalev Fitness | 19 | **23** | **yes** (ETG (Employer Training Grant)) | **2** others | "Kalev Fitness" = "Kalev" + "fitness" |  |
| ShipTop | 3 | Shiptop Logistics | 20 | **23** | no | 1 other | "Shiptop Logistics" = "ShipTop" + "logistics" |  |
| Catapult | 17 | Catapult ERP Services | 5 | **22** | **yes** (ETG (Employer Training Grant)) | **2** others | "Catapult ERP Services" = "Catapult" + "erp services" |  |
| Bemoved | 15 | Bemoved Media | 7 | **22** | no | 1 other | "Bemoved Media" = "Bemoved" + "media" |  |
| Sole Girls | 11 | Sole Girls Youth Program | 11 | **22** | **yes** (ETG (Employer Training Grant)) | 1 other | "Sole Girls Youth Program" = "Sole Girls" + "youth program" |  |
| NuAge | 6 | NuAge Laser | 16 | **22** | **yes** (ETG (Employer Training Grant)) | 1 other | "NuAge Laser" = "NuAge" + "laser" |  |
| Gordon | 2 | Gordon Food Service | 20 | **22** | **yes** (ETG (Employer Training Grant)) | 1 other | "Gordon Food Service" = "Gordon" + "food service" |  |
| Marquis | 0 | Marquis Wine Cellars | 22 | **22** | no | 1 other | "Marquis Wine Cellars" = "Marquis" + "wine cellars" |  |
| Ascent Drywall | 20 | Ascent Drywall and Coatings | 1 | **21** | no | 1 other | "Ascent Drywall and Coatings" = "Ascent Drywall" + "and coatings" |  |
| Tandem | 18 | Tandem Innovation Group | 3 | **21** | no | **2** others | "Tandem Innovation Group" = "Tandem" + "innovation group" |  |
| BetterWith | 17 | Betterwith Ice Cream | 4 | **21** | no | **2** others | "Betterwith Ice Cream" = "BetterWith" + "ice cream" |  |
| Bench | 9 | Bench Accounting | 12 | **21** | no | 1 other | "Bench Accounting" = "Bench" + "accounting" |  |
| Nutmeg | 1 | NutMeg Mylk | 20 | **21** | no | 1 other | "NutMeg Mylk" = "Nutmeg" + "mylk" |  |
| Victory Square | 16 | Victory Square Technologies Inc. | 4 | **20** | no | **2** others | "Victory Square Technologies Inc." = "Victory Square" + "technologies inc" |  |
| Carlino | 11 | Carlino Restaurant | 9 | **20** | no | 1 other | "Carlino Restaurant" = "Carlino" + "restaurant" |  |
| Nemesis | 15 | Nemesis Coffee (Gastown) | 4 | **19** | no | **3** others | "Nemesis Coffee (Gastown)" = "Nemesis" + "coffee gastown" |  |
| BINQUIP | 13 | Binquip Mfg Solutions | 6 | **19** | no | 1 other | "Binquip Mfg Solutions" = "BINQUIP" + "mfg solutions" |  |
| Saffea Natural | 11 | Saffea Natural Foods | 8 | **19** | **yes** (ETG (Employer Training Grant)) | 1 other | "Saffea Natural Foods" = "Saffea Natural" + "foods" |  |
| Cloud 9 | 8 | Cloud 9 Bakery | 11 | **19** | no | 1 other | "Cloud 9 Bakery" = "Cloud 9" + "bakery" |  |
| Life Beyond Limits | 7 | Life Beyond Limits Counselling | 12 | **19** | **yes** (ETG (Employer Training Grant)) | 1 other | "Life Beyond Limits Counselling" = "Life Beyond Limits" + "counselling" |  |
| HGC | 1 | HGC Engineering | 18 | **19** | no | 1 other | "HGC Engineering" = "HGC" + "engineering" |  |
| Pranin | 17 | Pranin Organic | 1 | **18** | **yes** (ETG (Employer Training Grant)) | **2** others | "Pranin Organic" = "Pranin" + "organic" |  |
| CopCan | 14 | Copcan Civil | 4 | **18** | no | 1 other | "Copcan Civil" = "CopCan" + "civil" |  |
| Nemesis Coffee | 14 | Nemesis Coffee (Gastown) | 4 | **18** | no | **2** others | "Nemesis Coffee (Gastown)" = "Nemesis Coffee" + "gastown" |  |
| The Workshop Vegetarian | 8 | Workshop Vegetarian Cafe | 10 | **18** | no | **2** others | "Workshop Vegetarian Cafe" = "The Workshop Vegetarian" + "cafe" |  |
| ACUVA | 7 | ACUVA Technologies | 11 | **18** | **yes** (ETG (Employer Training Grant)) | 1 other | "ACUVA Technologies" = "ACUVA" + "technologies" |  |
| CEFA | 5 | CEFA Coquitlam | 13 | **18** | **yes** (ETG (Employer Training Grant)) | **2** others | "CEFA Coquitlam" = "CEFA" + "coquitlam" |  |
| Lux | 9 | Lux Homes | 8 | **17** | no | **3** others | "Lux Homes" = "Lux" + "homes" |  |
| Rent It | 4 | Rent It Furnished | 13 | **17** | **yes** (ETG (Employer Training Grant)) | 1 other | "Rent It Furnished" = "Rent It" + "furnished" |  |
| SMC | 3 | SMC Communications | 14 | **17** | **yes** (ETG (Employer Training Grant)) | 1 other | "SMC Communications" = "SMC" + "communications" |  |
| Deep Cove | 15 | Deep Cove Kayak | 1 | **16** | no | 1 other | "Deep Cove Kayak" = "Deep Cove" + "kayak" |  |
| Gunn | 9 | Gunn Consultant | 7 | **16** | no | **2** others | "Gunn Consultant" = "Gunn" + "consultant" |  |
| Sharaya Stanger | 7 | Sharaya Stanger Physio | 9 | **16** | **yes** (ETG (Employer Training Grant)) | 1 other | "Sharaya Stanger Physio" = "Sharaya Stanger" + "physio" |  |
| Facet | 5 | Facet Advisors | 11 | **16** | **yes** (ETG (Employer Training Grant)) | **2** others | "Facet Advisors" = "Facet" + "advisors" |  |
| Simply | 3 | Simply Computing | 13 | **16** | no | **2** others | "Simply Computing" = "Simply" + "computing" |  |
| Northam | 1 | Northam Beverages Ltd. | 15 | **16** | **yes** (ETG (Employer Training Grant)) | **5** others | "Northam Beverages Ltd." = "Northam" + "beverages ltd" |  |
| Northam | 1 | Northam Law | 15 | **16** | **yes** (ETG (Employer Training Grant)) | **5** others | "Northam Law" = "Northam" + "law" |  |
| Point Blank | 1 | Point Blank Creative | 15 | **16** | **yes** (ETG (Employer Training Grant)) | 1 other | "Point Blank Creative" = "Point Blank" + "creative" |  |
| Forecast | 12 | Forecast Coffee | 3 | **15** | no | 1 other | "Forecast Coffee" = "Forecast" + "coffee" |  |
| Falcon | 4 | Falcon E | 11 | **15** | **yes** (ETG (Employer Training Grant)) | **4** others | "Falcon E" = "Falcon" + "e" |  |
| Y5 | 2 | Y5 Creative | 13 | **15** | no | 1 other | "Y5 Creative" = "Y5" + "creative" |  |
| DLD | 10 | DLD Financial Group | 4 | **14** | **yes** (ETG (Employer Training Grant)) | 1 other | "DLD Financial Group" = "DLD" + "financial group" |  |
| Rainbowworks | 9 | Rainbowworks Facilitating | 5 | **14** | **yes** (ETG (Employer Training Grant)) | 1 other | "Rainbowworks Facilitating" = "Rainbowworks" + "facilitating" |  |
| Kalev | 4 | Kalev Fitness Solution | 10 | **14** | no | **2** others | "Kalev Fitness Solution" = "Kalev" + "fitness solution" |  |
| Traine | 12 | Traine Construction | 1 | **13** | no | 1 other | "Traine Construction" = "Traine" + "construction" |  |
| Tenisci | 3 | Tenisci Piva LLP | 10 | **13** | no | **2** others | "Tenisci Piva LLP" = "Tenisci" + "piva llp" |  |
| Gooseneck | 11 | Gooseneck Hospitality | 1 | **12** | **yes** (ETG (Employer Training Grant)) | 1 other | "Gooseneck Hospitality" = "Gooseneck" + "hospitality" |  |
| Oakwood Health | 8 | Oakwood Health Network | 4 | **12** | **yes** (DS4Y - Pinnguaq) | 1 other | "Oakwood Health Network" = "Oakwood Health" + "network" |  |
| OPUS | 7 | Opus Forming | 5 | **12** | **yes** (WorkBC Wage Subsidy) | 1 other | "Opus Forming" = "OPUS" + "forming" |  |
| Girl Gang | 3 | Girl Gang Enterprises | 9 | **12** | no | **2** others | "Girl Gang Enterprises" = "Girl Gang" + "enterprises" |  |
| The Walker Group | 10 | Walker Group of Companies | 1 | **11** | **yes** (ETG (Employer Training Grant)) | 1 other | "Walker Group of Companies" = "The Walker Group" + "of companies" |  |
| Swift Security | 9 | Swift Security Systems | 2 | **11** | no | 1 other | "Swift Security Systems" = "Swift Security" + "systems" |  |
| Bedford | 7 | Bedford Interactive | 4 | **11** | **yes** (ETG (Employer Training Grant)) | **2** others | "Bedford Interactive" = "Bedford" + "interactive" |  |
| St. John | 6 | St. John Ambulance | 5 | **11** | **yes** (ETG (Employer Training Grant)) | **2** others | "St. John Ambulance" = "St. John" + "ambulance" |  |
| St. John | 6 | St. John Society | 5 | **11** | **yes** (ETG (Employer Training Grant)) | **2** others | "St. John Society" = "St. John" + "society" |  |
| Falcon | 4 | Falcon Rail | 7 | **11** | **yes** (ETG (Employer Training Grant)) | **4** others | "Falcon Rail" = "Falcon" + "rail" |  |
| New World Technologies | 3 | New World Technologies (Rad Torque) | 8 | **11** | **yes** (ETG (Employer Training Grant)) | 1 other | "New World Technologies (Rad Torque)" = "New World Technologies" + "rad torque" |  |
| CAI Capital | 2 | CAI Capital Partners | 9 | **11** | no | 1 other | "CAI Capital Partners" = "CAI Capital" + "partners" |  |
| Don Mann | 2 | Don Mann Excavating | 9 | **11** | no | 1 other | "Don Mann Excavating" = "Don Mann" + "excavating" |  |
| Mendoza | 2 | Mendoza Physiotherapist | 9 | **11** | no | **2** others | "Mendoza Physiotherapist" = "Mendoza" + "physiotherapist" |  |
| Mendoza | 2 | Mendoza Physiotherapist Co. | 9 | **11** | **yes** (ETG (Employer Training Grant)) | **2** others | "Mendoza Physiotherapist Co." = "Mendoza" + "physiotherapist co" |  |
| Global Alignment | 0 | Global Alignment Coaching | 11 | **11** | **yes** (ETG (Employer Training Grant)) | **2** others | "Global Alignment Coaching" = "Global Alignment" + "coaching" |  |
| Vancouver Foodie | 7 | Vancouver Foodie Tours | 3 | **10** | no | 1 other | "Vancouver Foodie Tours" = "Vancouver Foodie" + "tours" |  |
| Allego | 7 | Allego Global Corp | 2 | **9** | no | 1 other | "Allego Global Corp" = "Allego" + "global corp" |  |
| HardLink | 4 | Hardlink Consulting Corp. | 5 | **9** | no | 1 other | "Hardlink Consulting Corp." = "HardLink" + "consulting corp" |  |
| Prosperity | 3 | Prosperity Workforce Solutions | 6 | **9** | no | 1 other | "Prosperity Workforce Solutions" = "Prosperity" + "workforce solutions" |  |
| Sterling IAQ | 1 | Sterling IAQ Consultants Ltd | 8 | **9** | no | 1 other | "Sterling IAQ Consultants Ltd" = "Sterling IAQ" + "consultants ltd" |  |
| Sharaya | 0 | Sharaya Stanger Physio | 9 | **9** | **yes** (ETG (Employer Training Grant)) | **2** others | "Sharaya Stanger Physio" = "Sharaya" + "stanger physio" |  |
| Isle of Mann | 4 | Isle of Mann Construction Ltd | 4 | **8** | no | 1 other | "Isle of Mann Construction Ltd" = "Isle of Mann" + "construction ltd" |  |
| KOZ | 4 | KOZ Sales | 4 | **8** | no | 1 other | "KOZ Sales" = "KOZ" + "sales" |  |
| Smile | 1 | Smile Innovations | 7 | **8** | no | **2** others | "Smile Innovations" = "Smile" + "innovations" |  |
| Bedford | 7 | Bedford Integrative | 0 | **7** | **yes** (ETG (Employer Training Grant)) | **2** others | "Bedford Integrative" = "Bedford" + "integrative" |  |
| Tongue and Groove | 7 | Tongue and Groove Construction | 0 | **7** | **yes** (ETG (Employer Training Grant)) | 1 other | "Tongue and Groove Construction" = "Tongue and Groove" + "construction" |  |
| Clear Directions | 2 | Clear Directions Coaching | 5 | **7** | **yes** (ETG (Employer Training Grant)) | 1 other | "Clear Directions Coaching" = "Clear Directions" + "coaching" |  |
| Blue Ocean | 1 | Blue Ocean Teaz | 6 | **7** | no | **3** others | "Blue Ocean Teaz" = "Blue Ocean" + "teaz" |  |
| Buy Rite | 1 | Buy Rite Business Furnishings | 6 | **7** | **yes** (ETG (Employer Training Grant)) | **2** others | "Buy Rite Business Furnishings" = "Buy Rite" + "business furnishings" |  |
| Sharaya | 0 | Sharaya Stanger | 7 | **7** | **yes** (ETG (Employer Training Grant)) | **2** others | "Sharaya Stanger" = "Sharaya" + "stanger" |  |
| CEFA | 5 | CEFA North Van | 1 | **6** | no | **2** others | "CEFA North Van" = "CEFA" + "north van" |  |
| Legacy Family Office at Assante | 2 | Legacy Family Office at Assante Financial Management | 4 | **6** | no | **2** others | "Legacy Family Office at Assante Financial Management" = "Legacy Family Office at Assante" + "financial management" |  |
| Adroit | 1 | Adroit Overseas Enterprises | 5 | **6** | no | 1 other | "Adroit Overseas Enterprises" = "Adroit" + "overseas enterprises" |  |
| HPP | 1 | HPP Canada | 5 | **6** | no | **2** others | "HPP Canada" = "HPP" + "canada" |  |
| Facet | 5 | Facet Advisor | 0 | **5** | **yes** (ETG (Employer Training Grant)) | **2** others | "Facet Advisor" = "Facet" + "advisor" |  |
| Simply | 3 | Simply Productive | 2 | **5** | no | **2** others | "Simply Productive" = "Simply" + "productive" |  |
| HPP | 1 | HPP Tolling | 4 | **5** | no | **2** others | "HPP Tolling" = "HPP" + "tolling" |  |
| Bike Hike | 3 | Bike Hike Adventure | 1 | **4** | **yes** (ETG (Employer Training Grant)) | 1 other | "Bike Hike Adventure" = "Bike Hike" + "adventure" |  |
| Mubarak | 2 | Mubarak Restaurant Ltd. | 2 | **4** | no | **2** others | "Mubarak Restaurant Ltd." = "Mubarak" + "restaurant ltd" |  |
| The Education Company | 2 | The Education Company (TEC) | 2 | **4** | no | 1 other | "The Education Company (TEC)" = "The Education Company" + "tec" |  |
| Blue Ocean | 1 | Blue Ocean Teas | 3 | **4** | no | **3** others | "Blue Ocean Teas" = "Blue Ocean" + "teas" |  |
| Frankie | 3 | Frankie Collective | 0 | **3** | no | 1 other | "Frankie Collective" = "Frankie" + "collective" |  |
| Buy Rite | 1 | Buy Rite BC | 2 | **3** | **yes** (ETG (Employer Training Grant)) | **2** others | "Buy Rite BC" = "Buy Rite" + "bc" |  |
| Capital City | 1 | Capital City Overstory | 2 | **3** | no | **6** others | "Capital City Overstory" = "Capital City" + "overstory" |  |
| Empathic Heart | 2 | Empathic Heart Counselling | 0 | **2** | **yes** (ETG (Employer Training Grant)) | 1 other | "Empathic Heart Counselling" = "Empathic Heart" + "counselling" |  |
| Dr. Muir | 1 | Dr. Muir Dental Corp | 1 | **2** | **yes** (ETG (Employer Training Grant)) | 1 other | "Dr. Muir Dental Corp" = "Dr. Muir" + "dental corp" |  |
| Dunbar Dental | 1 | Dunbar Dental Centre | 1 | **2** | **yes** (ETG (Employer Training Grant)) | 1 other | "Dunbar Dental Centre" = "Dunbar Dental" + "centre" |  |
| Pristine | 1 | Pristine Technologies | 1 | **2** | no | 1 other | "Pristine Technologies" = "Pristine" + "technologies" |  |

---

## Notes

- **6 canonicals already carry a hand correction.** Pairs involving them are still listed — a prior correction does not rule out a further split.
- **254 of 552 pairs never share a program folder**, which is the pattern you would expect from one client split in two rather than two distinct clients.
- Detection is string-based only. No file contents were read and no model was asked to judge — every pair here is a candidate for review, not a finding.
- The audit is repeatable: `node scripts/split-audit.mjs`.
