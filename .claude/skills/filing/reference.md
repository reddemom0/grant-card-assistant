# Filing reference: every document type

Source of truth for names and homes. Built from the naming-conventions workbook (13 Oct 2026) and updated to Chris's filing decisions of 20 Oct 2026 (see DECISIONS.md), which describe Granted Files as it is after the October cleanup. Where the two differ, this file wins.

## Client files

Paths below are **inside the year folder** (`Clients/{Client}/{Program}/{YYYY}/`) unless they start with `Clients/` or `Programs/`. In a file name, `{Program}` is the program's **short code** from the program table below.


### Application and approval

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Application Document | Standalone | `Application Document-{Client}-{Program}` | Application Document-Caliber Projects-CanEx | `Application/` |  |
| Funding Agreement | Standalone | `Funding Agreement-{Client}-{Program}` | Funding Agreement-Nightingale Electrical-Destination Trade | `Approval Docs/` | One per employer, not per student |
| Business Certificate | Standalone | `Business Certificate-{Client}-{Program}` | Business Certificate-Nightingale Electrical-Destination Trade | `Application/` | One per employer, not per student |
| Employer Participation Form | Standalone | `Employer Participation Form-{Client}-{Program}` | Employer Participation Form-Nightingale Electrical-Destination Trade | `Application/` |  |
| Eligibility Assessment | Standalone | `Eligibility Assessment-{Client}-{Program}` | Eligibility Assessment-Caliber Projects-CanEx | `Application/` |  |
| Training Plan | Standalone | `Training Plan-{Client}-{Program}` | Training Plan-Tradable Bits-ETG | `Application/` |  |
| Support Letter | Standalone | `Support Letter-{From}-{Client}-{Program}` | Support Letter-City of Surrey-Caliber Projects-CanEx | `Application/` | Reference letters too |

### Financials (mostly Market Expansion)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Budget Sheet | Standalone | `Budget Sheet-{YYYYMM-YYYYMM}-{Client}-{Program}` | Budget Sheet-202401-202412-Caliber Projects-CanEx | `Application/` |  |
| Bank Statement | Standalone | `Bank Statement-{YYYYMM-YYYYMM}-{Client}-{Program}` | Bank Statement-202401-202406-Caliber Projects-CanEx | `Application/` |  |
| Financial Statement | Standalone | `Financial Statement-FY{YYYY}-{Client}-{Program}` | Financial Statement-FY2024-Caliber Projects-CanEx | `Application/` |  |
| Tax Documents | Standalone | `Tax Documents-{YYYY}-{Client}-{Program}` | Tax Documents-2024-Caliber Projects-CanEx | `Application/` | T4s, returns |

### Claims

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Claim Submission | Standalone | `Claim Submission-{YYYYMM}-{Client}-{Program}` | Claim Submission-202409-Keirton-WorkBC WS | `Claims/{YYYYMM}/` | The month is the claim period |
| Claim Confirmation | Standalone | `Claim Confirmation-{YYYYMM}-{Client}-{Program}` | Claim Confirmation-202409-Keirton-WorkBC WS | `Claims/{YYYYMM}/` | The funder's receipt |
| Invoice | Supporting | `Invoice-{YYYYMM}-{Course or Vendor}` | Invoice-202405-Bellrock Management Foundations | `Claims/{YYYYMM}/` |  |
| Proof of Payment | Supporting | `Proof of Payment-{YYYYMM}-{Course or Vendor}` | Proof of Payment-202405-Bellrock Management Foundations | `Claims/{YYYYMM}/` |  |
| Quote | Supporting | `Quote-{YYYYMM}-{Vendor}` | Quote-202403-Bellrock | `Claims/{YYYYMM}/` | Estimates too |
| Receipt | Supporting | `Receipt-{YYYYMM}-{Vendor}` | Receipt-202405-Air Canada | `Reimbursements/` | Reuse an existing variant (Reimbursement, Reim, Reimb…) |
| Timesheet | Supporting | `Timesheet-{YYYYMM}-{Person}` | Timesheet-202409-Igor Soreas | `Claims/{YYYYMM}/` |  |
| Paystub | Supporting | `Paystub-{YYYYMM-YYYYMM}-{Student Name}` | Paystub-202401-202403-Igor Soreas | `Paystubs/` | Hiring programs only |

### Hiring — per student (in the student's folder)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Employment Contract | Supporting | `Employment Contract-{Student Name}` | Employment Contract-Igor Soreas | `{Role}-{Student}/` |  |
| Proof of WIL Form | Supporting | `Proof of WIL Form-{Student Name}` | Proof of WIL Form-Igor Soreas | `{Role}-{Student}/` |  |
| Student Information Form | Supporting | `Student Information Form-{Student Name}` | Student Information Form-Igor Soreas | `{Role}-{Student}/` | Same pattern for other per-student forms |
| Vetting Form | Supporting | `Vetting Form-{Candidate Name}` | Vetting Form-Igor Soreas | `{Role}-{Student}/` |  |
| Resume | Supporting | `Resume-{Candidate Name}` | Resume-Igor Soreas | `{Role}-{Student}/` |  |
| Job Description | Supporting | `Job Description-{Role}` | Job Description-Electrical Apprentice | `{Role}-{Student}/` |  |

### Training — per course (in the course folder)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Course Outline | Supporting | `Course Outline-{Course Name}` | Course Outline-Bellrock Management Foundations | `{Course Name}/` |  |
| Business Case | Supporting | `Business Case-{Course Name}` | Business Case-Bellrock Management Foundations | `{Course Name}/` |  |
| Training Certificate | Supporting | `Training Certificate-{Course Name}-{Person}` | Training Certificate-Bellrock Management Foundations-Igor Soreas | `{Course Name}/` |  |

### Reporting

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Progress Report | Standalone | `Progress Report-{YYYYMM}-{Client}-{Program}` | Progress Report-202406-Caliber Projects-CanEx | `Reporting/` |  |
| Final Report | Standalone | `Final Report-{Client}-{Program}` | Final Report-Caliber Projects-CanEx | `Reporting/` |  |

### Client work tied to no program (in `Clients/{Client}/General/`)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Grant Planner | Living | `Grant Planner-{Client}-{YYYY}` | Grant Planner-Caliber Projects-2026 | `Clients/{Client}/General/{YYYY}/` | New planners only; existing planners keep their names |
| Readiness Assessment | Standalone | `Readiness Assessment-{Client}` | Readiness Assessment-Tradable Bits | `Clients/{Client}/General/{YYYY}/` | Use `Undated` if there is no year |
| Business Licence | Supporting | `Business Licence-{Client}` | Business Licence-Caliber Projects | `Clients/{Client}/General/{YYYY}/` | Business info (incorporation, registry) goes here too |

### Media

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Logos, photos, video | Media | `Describe it plainly — no strict pattern` | Caliber Projects Logo White | `wherever it is used` |  |

### Program templates (not client work)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Claim Form | Program | `Claim Form-{Program}` | Claim Form-WorkBC Wage Subsidy | `Programs/{Program}/Templates/` | The blank form |

## Client folders

Full path: `Clients/{Client}/{Program}/{YYYY}/…` (program work) or `Clients/{Client}/General/{YYYY}/` (client work tied to no program).

| Level | Rule | Example |
|---|---|---|
| Client | The folder under `Clients/` with the client's name. The lookup also finds a client by the start of its name ("Caliber" → `Caliber Projects`). | `Clients/Caliber Projects/` |
| Program | The program's **standard folder name** from the program table (the full name, not the code). `General` is the official folder for work tied to no program. | `CanExport`, `ETG (Employer Training Grant)`, `General` |
| Year | A bare `YYYY` (in `General/` also `Undated`). Don't create folders that combine client, program and year in one name. Season or intake subfolders are allowed under the year. | `2026`, `2026/Summer 2026` |
| Hiring: per student | `{Role}-{Student Name}` | `Electrical Apprentice-Igor Soreas` |
| Training: per course | `{Course Name}` | `Bellrock Management Foundations` |
| Stage | Standard names: Application · Approval Docs · Claims · Reimbursements · Paystubs (hiring only) · Reporting · Hiring. **Reuse an existing variant** in that folder rather than creating a second one; create new stage folders with the standard name only. | `…/2026/Claims/` |
| Stage aliases | `Reimbursement`, `Reim`, `Reimb`, `Reimbursment` and any `…Reimbursements` count as Reimbursements | |
| Inside Claims | One folder per claim month | `Claims/202409/` |
| Approval docs | The funding agreement and approval letter go in `Approval Docs/` | |

Full example: `Clients/Nightingale Electrical/Destination Trade/2026/Electrical Apprentice-Igor Soreas/Claims/202409/`

Sharing with a client: share the **year** folder, never the client folder, as **Contributor** (not the default Content manager).

## Program folders

`Programs/{Program}/Guidance` (guides, guidelines, FAQs) · `Templates` (blank forms) · `Examples` (past winning samples, anonymised where possible).

Unsorted program material goes in `Programs/{Program}/_Unfiled/` until someone sorts it.

## Programs: standard folder name and short code

Folders use the **standard folder name** (the current `Programs/` folder names, plus programs that so far exist only as client folders). File names use the **short code**. Codes never contain a hyphen, because the hyphen separates the parts of a file name. A code marked **(proposed)** was made up for this table and is pending Chris's check. Variants still under review (e.g. `DS4Y - 2023`, `Mitacs - UBC`, `Incentives in Trades - Career Launcher`) are not listed: match them to the folder that exists.

| Standard folder name | Short code | In `Programs/` |
|---|---|---|
| Accelerated Manufacturing Grant | AMG (proposed) | yes |
| AccelerateIP | AccelerateIP | yes |
| Accelerating Agricultural Innovations 2.0 | AAI2 (proposed) | yes |
| Accelerating Digital Career for Youth | ADCY (proposed) | yes |
| Access to Opportunities | ATO (proposed) | yes |
| Access to Talent | Access to Talent | no — client folders only |
| Advanced Manufacturing - NGen | AMN (proposed) | yes |
| Agri-Assurance SME | Agri Assurance SME | yes |
| Agri-Export (BC) | Agri Export BC | yes |
| Agri-talent | Agri talent | yes |
| Agriculture Labour Task Force Grant | ALTFG (proposed) | yes |
| AgriFoods - Green Jobs Initiative | AGJI (proposed) | yes |
| AgriInnovate | AgriInnovate | yes |
| AgriInnovation | AgriInnovation | yes |
| AgriMarketing | AgriMarketing | yes |
| Agritech Innovation Fund - Controlled Environment Agriculture | AIFCEA (proposed) | yes |
| AI Compute Access Fund | AI Compute Access Fund | yes |
| Alberta Digital Traction Program | ADT (proposed) | yes |
| Alberta Export Expansion Program | AEE (proposed) | yes |
| Alberta Innovates | Alberta Innovates | yes |
| Alberta Innovates - Agri-Food and Bio-Industrial Innovation | AIAFBI (proposed) | yes |
| Alberta Innovates - Entrepreneur Incubator Program | AIEI (proposed) | yes |
| Alberta Innovates - Voucher | AIV (proposed) | yes |
| Alberta Jobs Now | AJN (proposed) | yes |
| Alberta STEP | Alberta STEP | yes |
| Amber Grant | Amber Grant | yes |
| Apartment Construction Loan Program - Standard Rental Housing | ACLP (proposed) | yes |
| Apparel (Career Focus) | Apparel Career Focus | yes |
| Apprenticeship Service Program - Eco Canada | ASEC (proposed) | yes |
| Artificial Intelligence - Protein Industries Canada | AIPIC (proposed) | yes |
| BC Buy Local | BC Buy Local | yes |
| BC Food Safety | BC Food Safety | yes |
| BC FoodWorks | BC FoodWorks | yes |
| BC Lean for Food Processors | BCLFP (proposed) | yes |
| BC Maritime Industries Infrastructure Modernization and Expansion Grant Program | BCMIIM (proposed) | no — client folders only |
| BC Recovery | BC Recovery | yes |
| BC Wood Marketing and Business Development | BCWMBD (proposed) | yes |
| BCAFE | BCAFE | yes |
| BCASMDP (Agri-Food Market Development Program) | BCASMDP | yes |
| BCCAF (Climate Agri Solutions) | BCCAF | yes |
| Beneficial Management Practices Program- Fuel & Energy | BMPF&E (proposed) | yes |
| BioTalent | BioTalent | yes |
| BioTalent STIP - Green Jobs | BioTalent STIP | yes |
| BioTalent SWPP | BioTalent SWPP | yes |
| Biotech Grant (Career Focus) | Biotech Career Focus | yes |
| Bowman (Career Focus) | Bowman Career Focus | yes |
| BSP | BSP | yes |
| Build in Canada Program | BIC (proposed) | yes |
| BuyBC | BuyBC | yes |
| Call for Industrial Decarbonization (NorthX) | CIDN (proposed) | yes |
| Canada Alberta Productivity Grant | CAPG (proposed) | yes |
| Canada Summer Jobs | CSJ | yes |
| Canada-Alberta Job Grant | CAJG | yes |
| Canadian Agricultural Loans Act program | CALA (proposed) | yes |
| Canadian Mining CMWP | Canadian Mining CMWP | yes |
| CanExport | CanEx | yes |
| CanExport Innovation (CXI) | CXI | yes |
| Capital Retrofit_AB_2026 | CRAB (proposed) | yes |
| Career Launcher Internships (inc DS4Y DT) | Career Launcher | yes |
| Career Ready (ITAC Technation) | Career Ready | yes |
| Career Ready with CTMA | Career Ready with CTMA | yes |
| Career Starter (Biotalent) | Career Starter | yes |
| CBBIF | CBBIF | yes |
| CCSIF (College & Community Social Innovation Fund) | CCSIF | yes |
| CIF CleanBC Industry Fund | CIF | yes |
| Circular Food Innovators Fund | CFIF (proposed) | yes |
| CLAC | CLAC | yes |
| Clean Resources - Alberta Innovates | CRAI (proposed) | yes |
| CleanBC | CleanBC | yes |
| CleanBC Custom Program | CleanBC Custom Program | yes |
| CleanBC Plastics Action Fund | CleanBC PAF (proposed) | yes |
| Co-operative Education Incentive | COEI (proposed) | yes |
| COIL | COIL | yes |
| COJG | COJG | yes |
| CPF | CPF | yes |
| Creating, Knowing, Sharing - Small Scale Activities | CKSSSA (proposed) | yes |
| Creative Employment Options | CEOP (proposed) | yes |
| Creative Export | Creative Export | yes |
| Cultural Human Resources Council Student Work Placement Program (CHRC SWPP) | CHRC SWPP | yes |
| CVP | CVP | yes |
| Destination Trade | Destination Trade | yes |
| Development and Commercialization Program | DCP (proposed) | yes |
| Digital Adoption Program | CDAP | yes |
| Digital Lift | Digital Lift | yes |
| Digital Marketing Skills Experience (DMSE) | DMSE | yes |
| Digital Modernization and Adoption Program - DCC | DMADCC (proposed) | yes |
| Digital Skills For Youth (DS4Y) - Communautique | DS4Y Communautique | yes |
| Digital Skills for Youth (DS4Y) - Eco Canada [Waitlist] | DS4Y Eco Canada | yes |
| DigitalWorks (Pinnguaq) | DigitalWorks | yes |
| Discovering Potential | Discovering Potential | yes |
| DS4Y | DS4Y | yes |
| DS4Y - BioTalent | DS4Y BioTalent | yes |
| DS4Y - ICNJ | DS4Y ICNJ | yes |
| DS4Y - IMAA | DS4Y IMAA | yes |
| DS4Y - Innovate BC | DS4Y Innovate BC | yes |
| DS4Y - LHL | DS4Y LHL | yes |
| DS4Y - PCPI | DS4Y PCPI | yes |
| DS4Y - Pinnguaq | DS4Y Pinnguaq | yes |
| DS4Y - VCN | DS4Y VCN | yes |
| DSYIP | DSYIP | yes |
| Early Childhood Educator Training Wage Program | ECETW (proposed) | yes |
| ECO Canada | ECO Canada | yes |
| Eco Canada - Employability Pathways | ECEP (proposed) | no — client folders only |
| Eco Canada - Environmental Jobs Growth | ECEJG (proposed) | no — client folders only |
| ECO Canada - Science Horizons | ECO CSH (proposed) | yes |
| ECO Canada-DS4Y | ECO Canada DS4Y | yes |
| ECO Canada-YNR - STIP | ECO Canada YNR STIP | yes |
| Eco-Canada CO-OP | Eco Canada CO OP | yes |
| Eco-Canada S&T Internship | ECS&TI (proposed) | no — client folders only |
| EI Wage Subsidy | EI WS (proposed) | yes |
| Employ PEI | Employ PEI | yes |
| Employment Services | Employment Services | yes |
| Empowering Futures | Empowering Futures | yes |
| Enabling Accessibility Fund | EAF | yes |
| Energy Innovation Program_Artificial Intelligence for Canadian Energy Innovation | EIAICE (proposed) | yes |
| Environment (CF) | Environment CF | yes |
| Environmental Foreign Talent Development Program (EFTD) | EFTD | yes |
| EPF | EPF | no — client folders only |
| Equity and Emerging Development_Creative BC | EEDCBC (proposed) | yes |
| ETG (Employer Training Grant) | ETG | yes |
| Eurostar Call for Proposal | ECP (proposed) | yes |
| Expanded Energy Management Program | EEM (proposed) | yes |
| Experience Matters | Experience Matters | no — client folders only |
| Export Ready | Export Ready | yes |
| Export Travel Trade Program | ETT (proposed) | yes |
| Facebook Small Biz Grant | FSBG (proposed) | yes |
| FACTAP | FACTAP | yes |
| Farm Solar Grants - BC | Farm Solar Grants BC | yes |
| First Peoples Economic Growth Fund | FPEGF (proposed) | yes |
| Food Futures | Food Futures | yes |
| Food Processing Growth Fund | FPGF (proposed) | yes |
| Food Processing SWPP | Food Processing SWPP | yes |
| Food Processors (Career Focus) | Food Processors Career Focus | yes |
| Food Safety | Food Safety | yes |
| Food Storage, Distribution and Retail Program | FSDR (proposed) | yes |
| FRRF | FRRF | yes |
| Future Ready Program | Future Ready Program | yes |
| GC Wood | GC Wood | yes |
| GCCC Tree Planting | GCCC Tree Planting | yes |
| Gearing Up SWPP | Gearing Up SWPP | yes |
| Get BC Working | Get BC Working | yes |
| Go-To-Market Microgrant | GMM (proposed) | yes |
| Good Spark | Good Spark | yes |
| Graduate to Opportunity | GTO (proposed) | yes |
| GradWorks - Employer Incentive Program | GEI (proposed) | yes |
| Green Freight | Green Freight | yes |
| Green Jobs | Green Jobs | yes |
| Green Shipping | Green Shipping | yes |
| Greening Government | Greening Government | yes |
| Greenworks Pinnguaq | Greenworks Pinnguaq | no — client folders only |
| GYW (Youth Hiring Subsidy) | GYW | yes |
| Heavy-Duty Vehicle Efficiency Program - Rebate | HDVER (proposed) | yes |
| Horizon AI - Global Advantage Stream | HAIGAS (proposed) | yes |
| Horizon AI - Tech Commercialization Stream | HAITCS (proposed) | yes |
| Housing Supply Challenge | HSC (proposed) | yes |
| I.D.E.A. Fund | I.D.E.A. Fund | yes |
| iAdvance Pathways | iAdvance Pathways | yes |
| ICE Fund | ICE Fund | yes |
| ICTC (Career Focus) | ICTC Career Focus | yes |
| IDM Fund | IDM Fund | yes |
| Indigenous Languages s.8&9 | ILA s8&9 (proposed) | yes |
| Industry Commercialization Associates Program - Alberta Innovates | ICAP (proposed) | yes |
| Industry R&D Associates Program - Alberta Innovates | IRDAP (proposed) | yes |
| Innovate BC - BC Tech Co-Op Grants Program | IBCBCT (proposed) | no — client folders only |
| Innovate BC - ISI | ISI | yes |
| Innovate BC Microgrant - Commercialization | IBCMC (proposed) | yes |
| Innovation Booster | Innovation Booster | yes |
| Integrated Marketplace_ Early-Stage Demonstration Call | IMESDC (proposed) | yes |
| International Student (ISI) Co-op Hiring Grant | ISI Co op | yes |
| International Technology Partnership Program (ITP) | ITP | yes |
| International Technology Pilot and Demonstration | ITPD (proposed) | yes |
| INVEST North Program - Grow Stream | INVEST North Grow | yes |
| Investment Readiness | Investment Readiness | yes |
| ISED - Business Succession Planning | ISED BSP (proposed) | yes |
| ISSP | ISSP | yes |
| Job Creation Incentive Program_incomplete | JCIP (proposed) | yes |
| Jobs Growth Fund | JGF (proposed) | yes |
| JobsNL Wage Subsidy Program | JWS (proposed) | yes |
| Life Sciences Innovation Fund | LSIF (proposed) | yes |
| Lighthouse Labs Wage Subsidy | LLWS (proposed) | no — client folders only |
| LNG Grant | LNG Grant | yes |
| Magnet SWPP | Magnet SWPP | yes |
| Manufacturing Jobs Fund | MJF | yes |
| Market Entry Development Program | MED (proposed) | yes |
| Micro Voucher Program | Micro Voucher Program | yes |
| Mitacs | Mitacs | yes |
| Mitacs BSI - KPU | Mitacs BSI KPU | yes |
| Mon Avenir | Mon Avenir | yes |
| NRC IRAP | IRAP | yes |
| On-Farm Value-Added Program | OFVA (proposed) | yes |
| Ontario Food Technology Pilot (OFTP) | OFTP | yes |
| Opportunities Fund - Biotalent | OF BioTalent (proposed) | yes |
| Opportunities Fund Program - BCA | OF BCA (proposed) | yes |
| Opportunities Fund Program - STRIDES - ODG | OF STRIDES (proposed) | yes |
| PLTC | PLTC | no — client folders only |
| PROCESSOR PRODUCTIVITY PROGRAM (PPP) - BC | PPP BC | yes |
| Product Demonstration Program - Alberta Innovates | PDAI (proposed) | yes |
| Project Development Fund | PDFund (proposed) | yes |
| Propel SWPP | Propel SWPP | yes |
| PSYIP (Grad Hiring Subsidy) | PSYIP | yes |
| RAII | RAII | yes |
| RDII | RDII | yes |
| Regional Defence Initiative- BC | RDIBC (proposed) | yes |
| RELAY-Green Careers | RELAY Green Careers | yes |
| Rhyze Up! | Rhyze Up! | yes |
| RTRI | RTRI | yes |
| Scale AI | Scale AI | yes |
| Science Horizons - BioTalent | SHB (proposed) | yes |
| Science Horizons - Clean Foundations | SHCF (proposed) | yes |
| Securing Small Business Rebate Program | SSBR (proposed) | yes |
| SEED Fund | SEED Fund | yes |
| Skilled Newcomer Bio-Economy | SNBE (proposed) | yes |
| START | START | yes |
| Strategic Energy Management for Industry (SEMI) | SEMI | yes |
| Strategic Innovation Fund | SIF | yes |
| Supply Management Processing Investment Fund | SMPIF (proposed) | yes |
| Sustainable Growth and Adoption Program | SGA (proposed) | yes |
| SUVI | SUVI | yes |
| SWPP | SWPP | yes |
| SWPP AgriTalent | SWPP AgriTalent | yes |
| TACC Business Equity Program (BEP) | BEP | yes |
| Tailings Technology Challenge | TTC (proposed) | yes |
| Talent Opportunities | Talent Opportunities | yes |
| TAP | TAP | yes |
| Tech2Farm | Tech2Farm | yes |
| Technology Demonstration Program - DCC | TDDCC (proposed) | yes |
| The Shift Fund | The Shift Fund | yes |
| Tourism Fund | Tourism Fund | yes |
| Traceability | Traceability | yes |
| Trucking HR - EWSY | Trucking HR EWSY | yes |
| Trucking HR SWPP | Trucking HR SWPP | yes |
| Trucking HR SWSP | Trucking HR SWSP | yes |
| UNAC-Green Corps-STIP | Green Corps STIP | yes |
| Venture for Canada | VFC | yes |
| WAGE Funding | WAGE Funding | yes |
| Welcoming Newcomers | Welcoming Newcomers | yes |
| WEOC | WEOC | yes |
| WES | WES | yes |
| WIL Digital | WIL Digital | yes |
| WIL Internship | WIL Internship | yes |
| WILWorks SWPP | WILWorks SWPP | yes |
| Women Entrepreneur Fund | WEF | yes |
| Women in Climate_North X | WCNX (proposed) | yes |
| Work Sharing Program | Work Sharing Program | yes |
| Work To Grow | Work To Grow | no — client folders only |
| WorkBC Wage Subsidy | WorkBC WS (proposed) | yes |
| Workers in Transition | Workers in Transition | yes |
| Workplace Accessibility Grant | WAG | no — client folders only |
| Workplace Education Initiative | WEI (proposed) | yes |
| Workplace Innovation and Productivity Skills Incentive (WIPSI) | WIPSI | yes |
| WorkXP | WorkXP | yes |
| YBBE | YBBE | yes |
| YESP | YESP | yes |
| Youth Internship Incentive Program (YIIP) | YIIP | yes |
| Youth Job Connection | Youth Job Connection | yes |

## Internal docs

| Kind | What | Pattern | Example |
|---|---|---|---|
| Controlled | Policies, SOPs, templates, guides | `{DEPT}-{###}-{Short Name}` | `OPS-004-Claims Submission Process` |
| Everyday | Meeting notes, drafts, reports, working docs | `{Type}-{YYYYMMDD}-{Topic}` | `Meeting Notes-20261007-Staff Meeting` |
| Everyday | Sales proposals | `Proposal-{YYYYMMDD}-{Client}` | `Proposal-20261013-Caliber Projects` |
| Living | Trackers, logs, planners | `{Type}-{Topic}` | `Tracker-Webinar Signups` |

Controlled docs: no date in the name; keep a version table at the top of the doc.

Department codes → folders: OPS → OPERATIONS · MKT → MARKETING · SLS → SALES · RES → RESEARCH · WRT → WRITERS · PRD → PRODUCT · AI → AI · LDR → LEADERSHIP. (FIN and HR exist as codes but their files don't go in Granted Files. `Departments/HR` and `Departments/FINANCE` still exist today and are pending a move to Granted Archive; don't file into them.)

Inside `Departments/{DEPT}`, group files in a **topic subfolder** (e.g. `Departments/PRODUCT/Control Centre`, `Departments/OPERATIONS/Grant Coordinator Processes`). Don't leave files loose at the top of a department folder; if no topic folder fits, propose one, marked (new).

## Other areas of Granted Files

| Folder | What it is | File here? |
|---|---|---|
| `Clients/_Unsorted` | Files Oracle couldn't place after asking the person | Only as the fallback, after asking |
| `Programs/{Program}/_Unfiled` | Program material not yet sorted | Yes, for unsorted program material |
| `Active Clients/` | Shortcuts to live clients only | Never |
| `Review/` | Internal working folder | Never — not a filing target |
| `Pre-Call Briefings/` | Written by Oracle's scheduled jobs | Never — owned by the jobs |
| `Old Files/` | Stays as it is | Never |
| `Departments/Mindfulness` | Legacy, not a department | Never |

## Format rules

- Order: Type → When → Who → Program. Separator: a hyphen, no spaces around it. Types are Title Case and spelled exactly as above (`Proof of Payment`, never `POP`).
- Dates: month `YYYYMM` · period `YYYYMM-YYYYMM` · day `YYYYMMDD` · year `YYYY` · fiscal year `FY2024`.
- Program: in file names, the **short code** from the program table; in folder paths, the full standard folder name.
- These patterns are for **new files only**. Existing files are never renamed to match.
- No versions in names: no `v2`, `FINAL`, `draft`, `updated`, `Copy of`. Name milestones in version history. Don't duplicate a file to version it. A copy sent to a funder is its own file, named by convention. For Word/Excel, use Manage versions → Upload new version.
- Not listed: use the kind's pattern. Standalone `Type-Client-Program`; supporting `Type-When-Who`; internal `Type-YYYYMMDD-Topic`; living `Type-Topic`.
- Camera dumps and screenshots: no pattern.
