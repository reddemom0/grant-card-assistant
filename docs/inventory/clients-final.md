# Final Client List

**Generated:** 2026-08-17T16:29:45.278Z
**Inputs:** `dist/inventory/resolved-final.csv`, `scripts/client-corrections.json`
**Output:** `dist/inventory/clients-final.csv` (gitignored — regenerable)
**Method:** mechanical. No API call of any kind. The six corrections are hand-review decisions applied as data.

This is the list the pilot runs against.

## Totals

| | |
|---|---|
| **Canonical companies** | **1,766** |
| Raw client folder names behind them | 1,962 |
| Files under client names | 70,725 (93.1% of the tree) |
| Companies with >1 raw folder name | 178 |
| Live | 999 companies, 58,167 files |
| Archive-only | 745 companies, 13,308 files |

---

## The six corrections

Recorded in `scripts/client-corrections.json` (version-controlled) so they survive any re-run of the pipeline. Each is matched on the normalized folder-name key, so they keep applying even if file counts shift.

Canonical company count: **1,855 → 1,766** (−89; the six corrections collapsed 280 model-assigned canonicals into 159).

| # | Canonical after correction | Raw folder names merged | Files | Was |
|---|---|---|---|---|
| 1 | **Level Ground Trading** | `Level Ground` (394)<br>`Level Ground Trading` (258)<br>`Level Ground - Sales Admin` (42)<br>`Level Ground Trading - submitted` (7)<br>`Level Ground Coffee` (5) | **706** | `Level Ground`, `Level Ground Trading` |
| 2 | **Office of McFarlane Biggar Architects + Designers** | `Office of McFarlane` (82)<br>`Office of Mcfarlane Biggar Architects + Designers` (13)<br>`office of mcfarlane biggar architects designers` (10)<br>`Office of Mcfarlane (OMB)` (6) | **111** | `Office of McFarlane`, `Office of McFarlane Biggar Architects + Designers` |
| 3 | **Vegpro** | `Vegpro` (25)<br>`Vegpro: Salad Etc` (14)<br>`Salad Etc! (Vegpro)` (7)<br>`Salad Etc!` (2) | **48** | `Vegpro`, `Salad Etc!` |
| 4 | **Clarus** | `Clarus Electric` (277)<br>`Clarus` (193)<br>`Clarus Electrical` (49)<br>`Clarus Electric Corp` (26)<br>`Clarus Electronic` (8)<br>`Clarus Eletrical` (2)<br>`Clarus - oneoff` (1) | **556** | `Clarus`, `Clarus Electrical`, `Clarus Electric`, `Clarus Electric Corp`, `Clarus Electronic` |
| 5 | **TEC** | `TEC (One-Off)` (143)<br>`TEC` (68)<br>`Stenberg (TEC)` (26)<br>`TEC - Stenberg College` (20) | **257** | `TEC`, `Stenberg College` |
| 6 | **Pearl** | `Pearl` (366)<br>`Superprem Industries Ltd (DBA Pearl)` (1) | **367** | `Superprem Industries Ltd` |
| 7 | **Nightingale Electrical** | `Nightingale Electrical` (328)<br>`Nightingale Electrical Ltd` (16) | **344** | `Nightingale Electrical`, `Nightingale Electrical Ltd` |
| 8 | **Carmanah Technologies** | `Carmanah` (272)<br>`Carmanah Technologies Corp` (8) | **280** | `Carmanah Technologies`, `Carmanah Technologies Corp` |
| 9 | **Fernie Brewing** | `Fernie Brewing 2016` (245)<br>`Fernie Brewing` (19)<br>`Fernie Brewing Co.` (4)<br>`Fernie Brewing Company` (1) | **269** | `Fernie Brewing`, `Fernie Brewing Co.`, `Fernie Brewing Company` |
| 10 | **PHL Capital** | `PHL Capital` (230)<br>`PHL Capital Corp` (24)<br>`PHL Capital Co` (15) | **269** | `PHL Capital`, `PHL Capital Corp`, `PHL Capital Co` |
| 11 | **Taymor Industries** | `Taymor Industries` (164)<br>`Taymor Industries Ltd.` (103) | **267** | `Taymor Industries`, `Taymor Industries Ltd.` |
| 12 | **The Acorn** | `The Acorn` (142)<br>`Acorn` (113)<br>`The Acorn-Abandoned` (4) | **259** | `The Acorn`, `Acorn` |
| 13 | **Mayne** | `Mayne Inc` (210)<br>`Mayne` (23) | **233** | `Mayne Inc.`, `Mayne` |
| 14 | **Modern Purair** | `Modern Purair` (209)<br>`Modern PURAIR Headquarters` (9)<br>`Modern PURAIR Inc` (8)<br>`Moder PurAir` (3) | **229** | `Modern Purair`, `Modern PURAIR`, `Modern PurAir`, `Modern PURAIR Inc` |
| 15 | **Fine Choice Foods** | `Fine Choice Foods` (196)<br>`Fine Choice Foods Ltd` (4) | **200** | `Fine Choice Foods`, `Fine Choice Foods Ltd` |
| 16 | **Mak Physiotherapist** | `Mak Physiotherapist Co.` (100)<br>`Mak Physiotherapist` (57)<br>`Mak Physiotherapist Corp` (36) | **193** | `Mak Physiotherapist Co.`, `Mak Physiotherapist`, `Mak Physiotherapist Corp.` |
| 17 | **The Artona Group** | `The Artona Group` (114)<br>`Artona Group` (61) | **175** | `The Artona Group`, `Artona Group` |
| 18 | **Capital City News / Overstory Media** | `Capital City News:Overstory Media` (156)<br>`Capital City News (Overstory Media)` (3) | **159** | `Capital City News / Overstory Media`, `Capital City News (Overstory Media)` |
| 19 | **Maven Consulting** | `Maven Consulting` (145)<br>`Maven Consulting Limited` (5) | **150** | `Maven Consulting`, `Maven Consulting Limited` |
| 20 | **Grace & Stella** | `Grace & Stella` (107)<br>`Grace and Stella` (14)<br>`Grace&Stella` (10) | **131** | `Grace & Stella`, `Grace and Stella` |
| 21 | **The Answer Company** | `The Answer Company` (92)<br>`The Answer Co` (25)<br>`Answer Co.` (11) | **128** | `The Answer Company`, `The Answer Co`, `Answer Co.` |
| 22 | **The Cheerful Pelvis** | `The Cheerful Pelvis` (112)<br>`Cheerful Pelvis` (13) | **125** | `The Cheerful Pelvis`, `Cheerful Pelvis` |
| 23 | **Metropolitan Fine Printers** | `Metropolitan Fine Printers` (88)<br>`Metropolitan Fine Printers Inc.` (23) | **111** | `Metropolitan Fine Printers`, `Metropolitan Fine Printers Inc.` |
| 24 | **A & B Dental** | `A & B Dental` (62)<br>`A&B Dental` (49) | **111** | `A & B Dental`, `A&B Dental` |
| 25 | **NGX Interactive** | `NGX Interactive` (104)<br>`NGX Interactive Inc` (1) | **105** | `NGX Interactive`, `NGX Interactive Inc` |
| 26 | **Simpli Assets** | `Simpli Assets` (67)<br>`Simpli Assets Ltd.` (30) | **97** | `Simpli Assets`, `Simpli Assets Ltd.` |
| 27 | **Mellenger Interactive** | `Mellenger Interactive Ltd.` (66)<br>`Mellenger Interactive` (17)<br>`Mellenger Interactive Inc.` (4) | **87** | `Mellenger Interactive Ltd.`, `Mellenger Interactive`, `Mellenger Interactive Inc.` |
| 28 | **Tenisci Piva** | `Tenisci Piva` (75)<br>`Tenisci Piva LLP` (10) | **85** | `Tenisci Piva`, `Tenisci Piva LLP` |
| 29 | **Keystone Environmental** | `Keystone Environmental` (63)<br>`Keystone Environmental Ltd` (22) | **85** | `Keystone Environmental`, `Keystone Environmental Ltd` |
| 30 | **Meitou** | `Meitou` (52)<br>`Meitou Inc.` (30) | **82** | `Meitou`, `Meitou Inc.` |
| 31 | **The Arbor** | `The Arbor` (45)<br>`Arbor` (31)<br>`The Arbor-Abandoned` (5) | **81** | `The Arbor`, `Arbor` |
| 32 | **Belleisle Fishing Co. Ltd.** | `Belleisle Fishing Co. Ltd.` (66)<br>`Belleisle Fishing Co.` (8) | **74** | `Belleisle Fishing Co. Ltd.`, `Belleisle Fishing Co.` |
| 33 | **Wind Sun Sky Entertainment** | `Wind Sun Sky Entertainment` (58)<br>`Wind Sun Sky Ent. Inc` (13)<br>`Wind Sun Sky Entertainment Co.` (3) | **74** | `Wind Sun Sky Entertainment`, `Wind Sun Sky Entertainment Inc.`, `Wind Sun Sky Entertainment Co.` |
| 34 | **Northam Law** | `Northam Law Corporation` (51)<br>`Northam Law` (15) | **66** | `Northam Law Corporation`, `Northam Law` |
| 35 | **Vitae Apparel** | `Vitae Apparel` (38)<br>`Vitae Apparel Inc.` (27) | **65** | `Vitae Apparel`, `Vitae Apparel Inc.` |
| 36 | **Stas Holdings** | `Stas Holdings` (38)<br>`Stas Holdings Inc. (holds Final Touch)` (25) | **63** | `Stas Holdings`, `Stas Holdings Inc.` |
| 37 | **Remedi Wellness and Spa Ltd.** | `Remedi Wellness and Spa Ltd.` (59)<br>`Remedi Wellness & Spa Ltd.` (2) | **61** | `Remedi Wellness and Spa Ltd.`, `Remedi Wellness & Spa Ltd.` |
| 38 | **Premium Fence** | `Premium Fence` (28)<br>`Premium Fence Co.` (24)<br>`Premium Fence Company` (7)<br>`Premium Fence:Concept House:Kurt` (1)<br>`Preimum Fence` (0) | **60** | `Premium Fence`, `Premium Fence Co.`, `Premium Fence Company` |
| 39 | **PG Group Management** | `PGGROUP Management LTD` (37)<br>`PGGroup Management` (21) | **58** | `PG Group Management Ltd`, `PG Group Management` |
| 40 | **CH Robinson** | `CH Robinson` (54)<br>`C.H. Robinson` (2) | **56** | `CH Robinson`, `C.H. Robinson` |
| 41 | **Andrea Rodman Interiors** | `Andrea Rodman Interiors` (53)<br>`Andrea Rodman Interiors Inc.` (1) | **54** | `Andrea Rodman Interiors`, `Andrea Rodman Interiors Inc.` |
| 42 | **Invoke Media** | `Invoke Media` (49)<br>`Invoke Media Inc.` (5) | **54** | `Invoke Media`, `Invoke Media Inc.` |
| 43 | **Director's Guild** | `Director's Guild` (47)<br>`Directors Guild` (7) | **54** | `Director's Guild`, `Directors Guild` |
| 44 | **Cartems** | `Cartems` (39)<br>`Cartem's` (11) | **50** | `Cartems`, `Cartem's` |
| 45 | **Clir Renewables** | `Clir Renewables` (48)<br>`Clir Renewables Inc.` (1) | **49** | `Clir Renewables`, `Clir Renewables Inc.` |
| 46 | **Primex Manufacturing** | `Primex Manufacturing` (30)<br>`Primex Manufacturing Ltd.` (18) | **48** | `Primex Manufacturing`, `Primex Manufacturing Ltd.` |
| 47 | **Colony Construction** | `Colony Construction` (39)<br>`Colony Construction Corporation` (8) | **47** | `Colony Construction`, `Colony Construction Corporation` |
| 48 | **PS&CO** | `PS&CO` (30)<br>`PS & CO` (15)<br>`PSandCo` (2) | **47** | `PS&CO`, `PS & CO`, `PS & Co` |
| 49 | **Multi-Power** | `Multi-Power` (40)<br>`Multi Power` (5) | **45** | `Multi-Power`, `Multi Power` |
| 50 | **Mubarak Restaurant** | `Mubarak Restaurant` (42)<br>`Mubarak Restaurant Ltd.` (2) | **44** | `Mubarak Restaurant`, `Mubarak Restaurant Ltd.` |
| 51 | **Hook & Ladder** | `Hook & Ladder` (34)<br>`Hook and Ladder` (9) | **43** | `Hook & Ladder`, `Hook and Ladder` |
| 52 | **TW Hawes** | `TW Hawes Inc` (28)<br>`TW Hawes` (14) | **42** | `TW Hawes Inc`, `TW Hawes` |
| 53 | **Wakefield Productions** | `Wakefield Productions Inc.` (32)<br>`Wakefield Productions` (9) | **41** | `Wakefield Productions Inc.`, `Wakefield Productions` |
| 54 | **Northam Beverages** | `Northam Beverages` (26)<br>`Northam Beverages Ltd.` (15) | **41** | `Northam Beverages`, `Northam Beverages Ltd.` |
| 55 | **Myro Sales** | `Myro Sales Inc.` (20)<br>`Myro Sales` (19) | **39** | `Myro Sales Inc.`, `Myro Sales` |
| 56 | **Kerrisdale Group** | `Kerrisdale Group` (38)<br>`The Kerrisdale Group` (1) | **39** | `Kerrisdale Group`, `The Kerrisdale Group` |
| 57 | **Workshop Vegetarian** | `Workshop Vegetarian` (27)<br>`The Workshop Vegetarian` (8)<br>`The Workshop Vegetarian Ltd.` (3) | **38** | `Workshop Vegetarian`, `The Workshop Vegetarian`, `The Workshop Vegetarian Ltd.` |
| 58 | **Refrigerative Supply** | `Refrigerative Supply` (21)<br>`Refrigerative Supply Limited` (16) | **37** | `Refrigerative Supply`, `Refrigerative Supply Limited` |
| 59 | **Pivot and Pilot** | `Pivot and Pilot` (33)<br>`Pivot & Pilot` (4) | **37** | `Pivot and Pilot`, `Pivot & Pilot` |
| 60 | **Key Marketing** | `Key Marketing` (33)<br>`Key Marketing Ltd` (0) | **33** | `Key Marketing`, `Key Marketing Ltd` |
| 61 | **Great Canadian Landscaping** | `Great Canadian Landscaping Company` (29)<br>`Great Canadian Landscaping` (4) | **33** | `Great Canadian Landscaping Company`, `Great Canadian Landscaping` |
| 62 | **OVOU** | `OVOU` (29)<br>`Ovou Inc` (3) | **32** | `OVOU`, `Ovou Inc` |
| 63 | **Bells & Whistles** | `Bells & Whistles` (25)<br>`Bells and Whistles` (6) | **31** | `Bells & Whistles`, `Bells and Whistles` |
| 64 | **SISU** | `SISU` (21)<br>`Sisu Inc` (9) | **30** | `SISU`, `Sisu Inc` |
| 65 | **MountainBerry Landscaping** | `MountainBerry Landscaping` (24)<br>`Mountainberry Landscaping Ltd.` (2) | **26** | `MountainBerry Landscaping`, `Mountainberry Landscaping Ltd.` |
| 66 | **Scoli Clinic** | `Scoli Clinic` (26)<br>`The Scoli Clinic` (0) | **26** | `Scoli Clinic`, `The Scoli Clinic` |
| 67 | **Beacon Collective** | `Beacon Collective` (21)<br>`The Beacon Collective` (5) | **26** | `Beacon Collective`, `The Beacon Collective` |
| 68 | **Jaeny Baik Media** | `Jaeny Baik Media` (18)<br>`Jaeny Baik Media Inc` (7) | **25** | `Jaeny Baik Media`, `Jaeny Baik Media Inc.` |
| 69 | **Zhao & Associates** | `Zhao & Associates` (16)<br>`Zhao and Associates` (9) | **25** | `Zhao & Associates`, `Zhao and Associates` |
| 70 | **Legacy Family Office at Assante Financial Management** | `Legacy Family Office at Assante Financial Management Ltd.` (19)<br>`Legacy Family Office at Assante Financial Management` (4) | **23** | `Legacy Family Office at Assante Financial Management Ltd.`, `Legacy Family Office at Assante Financial Management` |
| 71 | **PrairieCoast Equipment** | `PrairieCoast Equipment` (16)<br>`PrairieCoast Equipment Inc.` (6) | **22** | `PrairieCoast Equipment`, `PrairieCoast Equipment Inc.` |
| 72 | **DentX Solutions Inc** | `DentX Solutions Inc (QC)` (15)<br>`DentX Solutions Inc.` (7) | **22** | `DentX Solutions Inc`, `DentX Solutions Inc.` |
| 73 | **Brix and Mortar** | `Brix and Mortar` (19)<br>`Brix & Mortar` (1) | **20** | `Brix and Mortar`, `Brix & Mortar` |
| 74 | **Satya Organics** | `Satya Organics Inc` (14)<br>`Satya Organics` (5) | **19** | `Satya Organics Inc.`, `Satya Organics` |
| 75 | **Moonshine Mama's** | `Moonshine Mama's` (11)<br>`Moonshine Mamas` (8) | **19** | `Moonshine Mama's`, `Moonshine Mamas` |
| 76 | **Smash & Tess** | `Smash & Tess` (11)<br>`Smash and Tess` (8) | **19** | `Smash & Tess`, `Smash and Tess` |
| 77 | **Keith Jack** | `Keith Jack` (16)<br>`Keith Jack Inc.` (2) | **18** | `Keith Jack`, `Keith Jack Inc.` |
| 78 | **Mendoza Physiotherapist** | `Mendoza Phisiotherpist` (9)<br>`Mendoza Physiotherapist Co.` (9) | **18** | `Mendoza Physiotherapist`, `Mendoza Physiotherapist Co.` |
| 79 | **Kindred Studio** | `Kindred Studio` (9)<br>`The Kindred Studio` (9) | **18** | `Kindred Studio`, `The Kindred Studio` |
| 80 | **Dynamix Agitators** | `Dynamix Agitators` (13)<br>`Dynamix Agitators Inc` (3) | **16** | `Dynamix Agitators`, `Dynamix Agitators Inc` |
| 81 | **Enginuity Consulting** | `Enginuity Consulting` (7)<br>`Enginuity Consulting Ltd.` (7) | **14** | `Enginuity Consulting`, `Enginuity Consulting Ltd.` |
| 82 | **Blume / Ellebox** | `Blume : Ellebox` (10)<br>`Blume-Ellebox` (3) | **13** | `Blume / Ellebox`, `Blume-Ellebox` |
| 83 | **Victory Square Technologies** | `Victory Square Technologies` (7)<br>`Victory Square Technologies Inc.` (4) | **11** | `Victory Square Technologies`, `Victory Square Technologies Inc.` |
| 84 | **The Woods Spirit Company** | `The Woods Spirit Company` (9)<br>`Woods Spirit Company` (2) | **11** | `The Woods Spirit Company`, `Woods Spirit Company` |
| 85 | **E3 Eco Group** | `E3 Eco Group` (5)<br>`E3 Eco Group Inc.` (5) | **10** | `E3 Eco Group`, `E3 Eco Group Inc.` |
| 86 | **AJK Consulting** | `AJK Consulting Inc` (9)<br>`AJK Consulting` (1) | **10** | `AJK Consulting Inc`, `AJK Consulting` |
| 87 | **Urbane Luxury Services** | `Urbane Luxury Services` (6)<br>`Urbane Luxury Services Inc.` (4) | **10** | `Urbane Luxury Services`, `Urbane Luxury Services Inc.` |
| 88 | **BC Food and Beverage** | `BC Food And Beverage` (7)<br>`BC Food & Beverage` (1) | **8** | `BC Food and Beverage`, `BC Food & Beverage` |
| 89 | **HRx Technology** | `HRx Technology Inc` (5)<br>`HRx Technology` (1) | **6** | `HRx Technology Inc.`, `HRx Technology` |
| 90 | **Clementine Natural Health** | `Clementine (1)` (3)<br>`Clementine Natural Health Inc` (1)<br>`Clementine Natural Health` (1) | **5** | `Clementine Natural Health Inc`, `Clementine Natural Health` |
| 91 | **Sand and Sea Design** | `Sand and Sea Design Company` (4)<br>`Sand and Sea Design` (1) | **5** | `Sand and Sea Design Company`, `Sand and Sea Design` |
| 92 | **Dominion NewEnergy** | `Dominion NewEnergy` (3)<br>`Dominion Newenergy Inc.` (2) | **5** | `Dominion NewEnergy`, `Dominion Newenergy Inc.` |
| 93 | **Practical Coaching** | `Practical Coaching` (2)<br>`Practical Coaching Ltd` (1) | **3** | `Practical Coaching`, `Practical Coaching Ltd` |
| 94 | **Chen's Enterprise** | `Chens Enterprise` (23) | **23** | `Chen's Enterprise` |
| 95 | **E2+ Associates** | `E2+ Associates` (31)<br>`E2+Associates` (9) | **40** | `E2+ Associates` |
| 96 | **Spark Kombucha** | `Spark Kombuxha` (21)<br>`Spark Kombucha` (8) | **29** | `Spark Kombucha` |
| 97 | **Support Bench** | `Support Bench` (69) | **69** | `Support Bench` |
| 98 | **Vancouver Island Brewing** | `Vancouver Island Brewing (VIB)` (59)<br>`Vancouver Island Brewing` (3)<br>`Vancouver Island Brewing - KPU` (2) | **64** | `Vancouver Island Brewing` |
| 99 | **Arts & Labour** | `Arts & Labour` (104)<br>`Arts&Labour` (3) | **107** | `Arts & Labour` |
| 100 | **Corporate Finance Institute** | `CFI (Corporate Finance Institute)` (65)<br>`Corporate Finance Institude` (31)<br>`Corporate Finance Institute` (22) | **118** | `Corporate Finance Institute` |
| 101 | **Dooly** | `Dooly` (34) | **34** | `Dooly` |
| 102 | **Ethony** | `Ethony` (46) | **46** | `Ethony` |
| 103 | **GameOn** | `GameOn` (82) | **82** | `GameOn` |
| 104 | **Loren Nancke** | `Loren Nancke` (33) | **33** | `Loren Nancke` |
| 105 | **Satisfai** | `Satisfai` (37) | **37** | `Satisfai` |
| 106 | **Simplex** | `Simplex` (3) | **3** | `Simplex` |
| 107 | **SupportingLines** | `SupportingLines` (8) | **8** | `SupportingLines` |
| 108 | **Tamwood** | `Tamwood` (11) | **11** | `Tamwood` |
| 109 | **Unbounce** | `Unbounce` (2) | **2** | `Unbounce` |
| 110 | **Videre** | `Videre` (13) | **13** | `Videre` |
| 111 | **ALL Movement (House of A La Ligne)** | `ALL Movement (House of A La Ligne)` (39) | **39** | `ALL Movement (House of A La Ligne)` |
| 112 | **DEVA Training & Staffing** | `DEVA Training & Staffing` (4) | **4** | `DEVA Training & Staffing` |
| 113 | **Clearmind International Institute** | `Clearmind` (74)<br>`Clearmind International Institute` (15) | **89** | `Clearmind`, `Clearmind International Institute` |
| 114 | **Abilities Rehabilitation** | `Abilities Rehabilitation` (18)<br>`Abilities Rehab` (10) | **28** | `Abilities Rehab`, `Abilities Rehabilitation` |
| 115 | **New World Technologies** | `New World Tech` (18)<br>`New World Technologies` (3) | **21** | `New World Tech`, `New World Technologies` |
| 116 | **Keystone Environmental** | `Keystone` (900)<br>`Keystone Environmental` (63)<br>`Keystone Environmental Ltd` (22) | **985** | `Keystone Environmental`, `Keystone Environmental Ltd`, `Keystone` |
| 117 | **Taymor Industries** | `Taymor` (346)<br>`Taymor Industries` (164)<br>`Taymor Industries Ltd.` (103)<br>`Taymor (1)` (2) | **615** | `Taymor Industries`, `Taymor Industries Ltd.`, `Taymor` |
| 118 | **Debrand Services Inc.** | `Debrand` (263)<br>`Debrand Services Inc.` (43) | **306** | `Debrand Services Inc.`, `Debrand` |
| 119 | **Regehr Contracting Ltd** | `Regehr` (205)<br>`Regehr Contracting Ltd.` (55) | **260** | `Regehr Contracting Ltd`, `Regehr` |
| 120 | **ClearDent** | `ClearDent` (501)<br>`Prococious Technology Inc. (DBA ClearDent)` (2) | **503** | `ClearDent`, `Precocious Technology Inc. (DBA ClearDent)` |
| 121 | **Nightingale Electrical** | `Nightingale Electrical` (328)<br>`Nightingale` (291)<br>`Nightingale Electrical Ltd` (16)<br>`Nightingale Electric` (16) | **651** | `Nightingale Electrical`, `Nightingale Electrical Ltd`, `Nightingale Electric`, `Nightingale` |
| 122 | **Blume** | `Blume` (306)<br>`Blume : Ellebox` (10)<br>`Blume (Ellebox)` (3)<br>`Blume-Ellebox` (3) | **322** | `Blume`, `Blume / Ellebox`, `Blume-Ellebox` |
| 123 | **Blume** | `Elleboxco (Blume)` (4) | **4** | `Elleboxco (Blume)` |
| 124 | **The Tyee** | `The Tyee 2nd Sub` (39) | **39** | `null` |
| 125 | **Graycon** | `Graycon Group` (25) | **25** | `null` |
| 126 | **505-JUNK** | `505 Junk` (14) | **14** | `null` |
| 127 | **Hatchways.io** | `Hatchways.io - APPROVED` (13) | **13** | `null` |
| 128 | **More Than Just Feed** | `More Than Just Feed (1)` (10) | **10** | `null` |
| 129 | **Mine & Yours** | `Mine and Yours` (2) | **2** | `null` |
| 130 | **Black Tie Property** | `Black Tie Properties` (2) | **2** | `null` |
| 131 | **Key Marketing** | `Key Marketing - no moving forward` (1) | **1** | `null` |
| 132 | **Pure+** | `Pure +` (2) | **2** | `null` |
| 133 | **Blume** | `ElleBox` (10) | **10** | `null` |
| 134 | **Nilex** | `Nilex` (130) | **130** | `null` |
| 135 | **Bromwich Smith** | `Bromwich Smith` (113) | **113** | `null` |
| 136 | **Solo Traveler** | `Solo Traveler` (67) | **67** | `null` |
| 137 | **CHRIS COLLINS** | `CHRIS COLLINS` (51) | **51** | `null` |
| 138 | **Grah-Ter Constuction Inc.** | `Grah-Ter Constuction Inc._closed` (41) | **41** | `null` |
| 139 | **Whissell** | `Whissell` (38) | **38** | `null` |
| 140 | **J Ennis Fabrics** | `J Ennis Fabrics` (22) | **22** | `null` |
| 141 | **AVL** | `AVL` (20) | **20** | `null` |
| 142 | **Executive Academy** | `Executive Academy` (15) | **15** | `null` |
| 143 | **Ferus** | `Ferus` (15) | **15** | `null` |
| 144 | **Legend Distlling** | `Buy Local BC - Legend Distlling` (14) | **14** | `null` |
| 145 | **ACM** | `ACM` (14) | **14** | `null` |
| 146 | **Consumer Genius** | `Consumer Genius` (12) | **12** | `null` |
| 147 | **MealShare** | `MealShare` (10) | **10** | `null` |
| 148 | **Peace River Bible Institute** | `Peace River Bible Institute` (10) | **10** | `null` |
| 149 | **CIA** | `CIA` (8) | **8** | `null` |
| 150 | **Surrey604** | `Surrey604 (Abandoned)` (7) | **7** | `null` |
| 151 | **AssetPlus** | `AssetPlus` (7) | **7** | `null` |
| 152 | **Hot Neon** | `Hot Neon` (7) | **7** | `null` |
| 153 | **Kick Ass** | `Kick Ass` (6) | **6** | `null` |
| 154 | **AY Tech** | `AY Tech` (6) | **6** | `null` |
| 155 | **Kettera** | `Kettera` (6) | **6** | `null` |
| 156 | **Aly Armstrong** | `Aly Armstrong` (5) | **5** | `null` |
| 157 | **Pacific Blasting** | `Pacific Blasting` (4) | **4** | `null` |
| 158 | **DH1 Development Ltd** | `DH1 Development Ltd` (2) | **2** | `null` |
| 159 | **TO ADD A REPRESENTATIVE** | `TO ADD A REPRESENTATIVE` (2) | **2** | `null` |

All 23 raw folder names resolved cleanly; every one was already labelled `client`. No correction was partially applied.

Note on #6 (Pearl): the canonical was deliberately flipped away from the registered entity name. 366 of 367 files sit under the folder `Pearl`, and that is the name the GCs use. `Superprem Industries Ltd` is recorded in the corrections file as the legal entity behind it.

---

## Colon audit

macOS stores a `/` typed into a folder name as `:` at the POSIX layer. A colon in a Dropbox folder name is therefore usually **a forward slash the user typed**, not a literal colon — `Widerfunnel 2017:18` is almost certainly `Widerfunnel 2017/18`.

This matters for the migration: Google Drive accepts `/` in folder names but Dropbox's API returns the `:` form, so a naive copy would create folders whose names differ from what the user originally typed.

| Measure | Count |
|---|---|
| Raw folder names containing `:` | **23** |
| Files under them | **777** |
| Canonical company names containing `:` | 3 |

By label:

| Label | Names |
|---|---|
| `client` | 23 |

Every affected raw name:

| Raw folder name | Label | Files | Reads as |
|---|---|---|---|
| `New:Mode` | client | 164 | `New/Mode` |
| `Capital City News:Overstory Media` | client | 156 | `Capital City News/Overstory Media` |
| `DH1:Our Town Cafe` | client | 59 | `DH1/Our Town Cafe` |
| `Widerfunnel 2017:18` | client | 47 | `Widerfunnel 2017/18` |
| `Birds Nest : ACD Realty` | client | 40 | `Birds Nest / ACD Realty` |
| `Girl Gang:Rolla Skate Club` | client | 34 | `Girl Gang/Rolla Skate Club` |
| `Nourish - Cook:Trainer` | client | 27 | `Nourish - Cook/Trainer` |
| `Acorn : Abror` | client | 25 | `Acorn / Abror` |
| `Cocoon Home Office:SommEvents` | client | 24 | `Cocoon Home Office/SommEvents` |
| `Healthy Hooch:Functional Beverage Group` | client | 24 | `Healthy Hooch/Functional Beverage Group` |
| `Widerfunnel 2018:2019` | client | 22 | `Widerfunnel 2018/2019` |
| `Hippie Snacks : Left Coast Naturals` | client | 21 | `Hippie Snacks / Left Coast Naturals` |
| `Taimuri:Capstone` | client | 21 | `Taimuri/Capstone` |
| `Admin Slayer:Spring Planning` | client | 20 | `Admin Slayer/Spring Planning` |
| `E2+ : Streetscape` | client | 17 | `E2+ / Streetscape` |
| `Madison Builders:E2 + Associates` | client | 16 | `Madison Builders/E2 + Associates` |
| `Victory Square : Draft Label` | client | 16 | `Victory Square / Draft Label` |
| `Vegpro: Salad Etc` | client | 14 | `Vegpro/ Salad Etc` |
| `New:Mode Consulting` | client | 13 | `New/Mode Consulting` |
| `Blume : Ellebox` | client | 10 | `Blume / Ellebox` |
| `Pure+:Nineteen02 Kombucha` | client | 4 | `Pure+/Nineteen02 Kombucha` |
| `Capital City:Overstory` | client | 2 | `Capital City/Overstory` |
| `Premium Fence:Concept House:Kurt` | client | 1 | `Premium Fence/Concept House/Kurt` |

Canonical names still carrying a colon:

- `New:Mode`
- `New:Mode Consulting`
- `Pure+:Nineteen02 Kombucha`

**Not rewritten.** This is an audit only — Google Drive folder naming needs a decision first.

---

## Carried forward (not resolved here)

| Item | Count | Notes |
|---|---|---|
| Files unattributed to any name | 986 | Program folders with no subfolder structure, plus files orphaned by batch descent |
| Names never judged | 36 (750 files) | Surfaced by the final resolution round; ~$0.03 to classify |
| Names judged non-client | 129 (3,510 files) | `doctype` / `internal` / `unclear` — not migration destinations |

Both the unattributed files and the unjudged names go to the review sheet. Neither is in scope here.

---

## Live vs archive-only (`client_modified`, 2020-08-17 cutoff)

`server_modified` is **not** used: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports nearly everything as recent regardless of real content age.

| Group | Companies | % | Files | % of client files |
|---|---|---|---|---|
| **Live** (a file within 6 years) | 999 | 56.6% | 58,167 | 81.4% |
| **Archive-only** | 745 | 42.2% | 13,308 | 18.6% |
| No dated files | 22 | 1.2% | 0 | 0% |

42.2% of companies are archive-only but hold only 18.6% of the files — the tail is old and light.

---

## Largest 40 companies by file count

| Canonical company | Raw names | Programs | Files | Retention |
|---|---|---|---|---|
| Kirmac | 1 | 5 | 1,299 | live |
| Caliber | 3 | 9 | 1,185 | live |
| Keystone Environmental ✎ | 3 | 22 | 985 | live |
| Spare Labs | 2 | 19 | 802 | live |
| Horizon | 2 | 7 | 780 | live |
| Left Coast Naturals | 2 | 5 | 724 | live |
| Level Ground Trading ✎ | 5 | 13 | 706 | live |
| Trotman | 1 | 3 | 664 | live |
| Nightingale Electrical ✎ | 4 | 7 | 651 | live |
| SAAM Towage | 1 | 9 | 651 | live |
| Musora | 1 | 12 | 631 | live |
| Ledcor | 1 | 3 | 621 | live |
| Taymor Industries ✎ | 4 | 7 | 615 | live |
| Fresh Prep | 1 | 14 | 590 | live |
| Clarus ✎ | 7 | 8 | 556 | live |
| Native Shoes | 1 | 16 | 521 | live |
| Bittered Sling | 2 | 1 | 507 | archive_only |
| ClearDent ✎ | 2 | 15 | 503 | live |
| ProCogia | 1 | 24 | 502 | live |
| Clir | 1 | 16 | 485 | live |
| Houston Landscapes | 1 | 6 | 463 | live |
| Creator Co | 1 | 20 | 443 | live |
| Norland | 1 | 7 | 428 | live |
| Intercity Packers | 1 | 1 | 421 | archive_only |
| Twin Lions | 2 | 5 | 393 | live |
| Pearl ✎ | 2 | 13 | 367 | live |
| ICMS | 1 | 10 | 337 | live |
| Blume ✎ | 6 | 13 | 336 | live |
| Strategex | 1 | 8 | 325 | live |
| Gunn Consultants | 2 | 14 | 324 | live |
| Herschel Supply Co. | 1 | 1 | 312 | archive_only |
| Primex | 1 | 4 | 308 | live |
| Debrand Services Inc. ✎ | 2 | 13 | 306 | live |
| Major Tom | 1 | 14 | 304 | live |
| Coastal Church | 1 | 5 | 288 | live |
| Coast Spas | 1 | 7 | 285 | live |
| Carmanah Technologies ✎ | 2 | 1 | 280 | archive_only |
| Solaris | 1 | 12 | 275 | live |
| TQ Construction | 2 | 3 | 275 | live |
| Overstory Media Group | 4 | 4 | 273 | live |

✎ = hand-corrected. Full list in `dist/inventory/clients-final.csv`.

---

## Reproducing

```bash
node scripts/build-final-clients.mjs
```

Reads `dist/inventory/resolved-final.csv` and `scripts/client-corrections.json`, writes two files, makes no network call. To change a merge decision, edit the JSON and re-run — nothing needs re-classifying.
