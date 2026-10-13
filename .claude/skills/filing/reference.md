# Filing reference: every document type

Source of truth for names and homes. Generated from the naming-conventions workbook (13 Oct 2026). Don't edit names here without updating the workbook.

## Client files

Paths below are **inside the engagement folder** unless they start with `Clients/` or `Programs/`.


### Application and approval

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Application Document | Standalone | `Application Document-{Client}-{Program}` | Application Document-Acuva-CanExport | `Application/` |  |
| Funding Agreement | Standalone | `Funding Agreement-{Client}-{Program}` | Funding Agreement-Nightingale Electrical-Destination Trade | `Application/` | One per employer, not per student |
| Business Certificate | Standalone | `Business Certificate-{Client}-{Program}` | Business Certificate-Nightingale Electrical-Destination Trade | `Application/` | One per employer, not per student |
| Employer Participation Form | Standalone | `Employer Participation Form-{Client}-{Program}` | Employer Participation Form-Nightingale Electrical-Destination Trade | `Application/` |  |
| Eligibility Assessment | Standalone | `Eligibility Assessment-{Client}-{Program}` | Eligibility Assessment-Acuva-CanExport | `Application/` |  |
| Training Plan | Standalone | `Training Plan-{Client}-{Program}` | Training Plan-Tradable Bits-ETG | `Application/` |  |
| Support Letter | Standalone | `Support Letter-{From}-{Client}-{Program}` | Support Letter-City of Surrey-Acuva-CanExport | `Application/` | Reference letters too |

### Financials (mostly Market Expansion)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Budget Sheet | Standalone | `Budget Sheet-{YYYYMM-YYYYMM}-{Client}-{Program}` | Budget Sheet-202401-202412-Acuva-CanExport | `Application/` |  |
| Bank Statement | Standalone | `Bank Statement-{YYYYMM-YYYYMM}-{Client}-{Program}` | Bank Statement-202401-202406-Acuva-CanExport | `Application/` |  |
| Financial Statement | Standalone | `Financial Statement-FY{YYYY}-{Client}-{Program}` | Financial Statement-FY2024-Acuva-CanExport | `Application/` |  |
| Tax Documents | Standalone | `Tax Documents-{YYYY}-{Client}-{Program}` | Tax Documents-2024-Acuva-CanExport | `Application/` | T4s, returns |

### Claims

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Claim Submission | Standalone | `Claim Submission-{YYYYMM}-{Client}-{Program}` | Claim Submission-202409-Keirton-WorkBC Wage Subsidy | `Claims/{YYYYMM}/` | The month is the claim period |
| Claim Confirmation | Standalone | `Claim Confirmation-{YYYYMM}-{Client}-{Program}` | Claim Confirmation-202409-Keirton-WorkBC Wage Subsidy | `Claims/{YYYYMM}/` | The funder's receipt |
| Invoice | Supporting | `Invoice-{YYYYMM}-{Course or Vendor}` | Invoice-202405-Bellrock Management Foundations | `Claims/{YYYYMM}/` |  |
| Proof of Payment | Supporting | `Proof of Payment-{YYYYMM}-{Course or Vendor}` | Proof of Payment-202405-Bellrock Management Foundations | `Claims/{YYYYMM}/` |  |
| Quote | Supporting | `Quote-{YYYYMM}-{Vendor}` | Quote-202403-Bellrock | `Claims/{YYYYMM}/` | Estimates too |
| Receipt | Supporting | `Receipt-{YYYYMM}-{Vendor}` | Receipt-202405-Air Canada | `Reimbursements/` |  |
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
| Progress Report | Standalone | `Progress Report-{YYYYMM}-{Client}-{Program}` | Progress Report-202406-Acuva-CanExport | `Reporting/` |  |
| Final Report | Standalone | `Final Report-{Client}-{Program}` | Final Report-Acuva-CanExport | `Reporting/` |  |

### Client planning (internal — sits in the client folder, above the engagements)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Grant Planner | Living | `Grant Planner-{Client}` | Grant Planner-Acuva | `Clients/{Client}/` | No date — it keeps changing |

### Media

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Logos, photos, video | Media | `Describe it plainly — no strict pattern` | Acuva Logo White | `wherever it is used` |  |

### Program templates (not client work)

| Type | Kind | Pattern | Example | Home | Notes |
|---|---|---|---|---|---|
| Claim Form | Program | `Claim Form-{Program}` | Claim Form-WorkBC Wage Subsidy | `Programs/{Program}/Templates/` | The blank form |

## Client folders

Full path: `Clients/{Client}/{Program}/{Engagement}/…`

| Level | Rule | Example |
|---|---|---|
| Engagement | `{Client}-{Program}-{Year}` for new engagements. If a bare year folder like `2026` already exists for that client and program, use it; don't create a second one | `Caliber Projects-CanExport-2026` |
| Hiring: per student | `{Role}-{Student Name}` | `Electrical Apprentice-Igor Soreas` |
| Training: per course | `{Course Name}` | `Bellrock Management Foundations` |
| Stage | Only: Application · Claims · Reimbursements · Paystubs (hiring only) · Reporting | `…/Claims/` |
| Inside Claims | One folder per claim month | `Claims/202409/` |
| Approval docs | Funding agreement and approval letter go in `Application/` | |

Full example: `Clients/Nightingale Electrical/Destination Trade/Nightingale Electrical-Destination Trade-2026/Electrical Apprentice-Igor Soreas/Claims/202409/`

Sharing with a client: share the **engagement** folder, never the client folder, as **Contributor** (not the default Content manager).

## Program folders

`Programs/{Program}/Guidance` (guides, guidelines, FAQs) · `Templates` (blank forms) · `Examples` (past winning samples, anonymised where possible).

## Internal docs

| Kind | What | Pattern | Example |
|---|---|---|---|
| Controlled | Policies, SOPs, templates, guides | `{DEPT}-{###}-{Short Name}` | `OPS-004-Claims Submission Process` |
| Everyday | Meeting notes, drafts, reports, working docs | `{Type}-{YYYYMMDD}-{Topic}` | `Meeting Notes-20261007-Staff Meeting` |
| Everyday | Sales proposals | `Proposal-{YYYYMMDD}-{Client}` | `Proposal-20261013-Acuva` |
| Living | Trackers, logs, planners | `{Type}-{Topic}` | `Tracker-Webinar Signups` |

Controlled docs: no date in the name; keep a version table at the top of the doc.

Department codes → folders: OPS → OPERATIONS · MKT → MARKETING · SLS → SALES · RES → RESEARCH · WRT → WRITERS · PRD → PRODUCT · AI → AI · LDR → LEADERSHIP. (FIN and HR exist as codes but their files don't go in Granted Files.)

## Format rules

- Order: Type → When → Who → Program. Separator: a hyphen, no spaces around it. Types are Title Case and spelled exactly as above (`Proof of Payment`, never `POP`).
- Dates: month `YYYYMM` · period `YYYYMM-YYYYMM` · day `YYYYMMDD` · year `YYYY` · fiscal year `FY2024`.
- Program: the short name (list pending; until it's agreed, use the existing `Programs/` folder name).
- No versions in names: no `v2`, `FINAL`, `draft`, `updated`, `Copy of`. Name milestones in version history. Don't duplicate a file to version it. A copy sent to a funder is its own file, named by convention. For Word/Excel, use Manage versions → Upload new version.
- Not listed: use the kind's pattern. Standalone `Type-Client-Program`; supporting `Type-When-Who`; internal `Type-YYYYMMDD-Topic`; living `Type-Topic`.
- Camera dumps and screenshots: no pattern.
