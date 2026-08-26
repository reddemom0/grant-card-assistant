# Naming Convention — Gap Analysis

**Generated:** 2026-08-20 · **Scope:** the `sort` route of the migrated corpus —
**58,449 client-filed files** across `full-mapping.csv` and `canexport-mapping.csv`.

**Read-only.** Filenames and destination paths only. No file was opened, no API was called,
no file or mapping was renamed or modified. Every number here comes from string analysis of
paths already recorded in the mapping CSVs.

**Every match below is a keyword signal, not a classification.** A file called
`Invoice.pdf` counts as an Invoice; a file called `Scan_004.pdf` that happens to be an invoice
does not. Read the percentages as floors.

---

## The short version

| | Files | Share |
|---|---|---|
| Match one of the 14 conventions by filename keyword | 20,137 | 34.5% |
| **Fall outside every convention** | **38,312** | **65.5%** |

**About two thirds of client-filed documents are things the conventions do not currently name.**
That is the headline finding, and the uncovered-cluster list below is what needs your eyes.

A second finding matters just as much for planning: **the fields your conventions need are
mostly not recoverable from what we have.** Only
**7,816 files (13.4%)** could be renamed correctly from the path and existing
filename alone.

---

## 1. What documents actually exist

Filenames clustered by normalized stem — dates, numbers, client names and extensions stripped.
30,446 distinct stems across 58,449 files. The 40 largest:

| # | Files | Cluster |
|---|---|---|
| 1 | 988 | `(no alpha stem)` |
| 2 | 260 | `workbc wage subsidy` |
| 3 | 205 | `claim` |
| 4 | 195 | `paystub` |
| 5 | 194 | `claim submission` |
| 6 | 185 | `invoice` |
| 7 | 168 | `image` |
| 8 | 167 | `screen shot at pm` |
| 9 | 163 | `course outline` |
| 10 | 149 | `wage subsidy employer application` |
| 11 | 141 | `renewables inc` |
| 12 | 140 | `timesheet` |
| 13 | 118 | `claim form` |
| 14 | 113 | `business license` |
| 15 | 113 | `paystubs` |
| 16 | 110 | `receipt` |
| 17 | 100 | `pay statement` |
| 18 | 99 | `course outline template copy` |
| 19 | 97 | `proof of payment` |
| 20 | 89 | `resume` |
| 21 | 87 | `mail attachment` |
| 22 | 87 | `funding agreement` |
| 23 | 86 | `etg business case information form` |
| 24 | 85 | `course outline template` |
| 25 | 83 | `remboursements` |
| 26 | 83 | `img` |
| 27 | 82 | `void cheque` |
| 28 | 81 | `screen shot at am` |
| 29 | 73 | `business case template` |
| 30 | 71 | `workbc wage subsidy claim confirmation` |
| 31 | 69 | `pay stub` |
| 32 | 68 | `inc` |
| 33 | 66 | `biotalent canada science horizons youth intership` |
| 34 | 65 | `etg business case` |
| 35 | 64 | `business licence` |
| 36 | 63 | `workbc wage subsidy application` |
| 37 | 60 | `estimator bundle` |
| 38 | 59 | `bank statement` |
| 39 | 57 | `swpp student consent form` |
| 40 | 57 | `participant information form part` |

The long tail is the real story: no cluster exceeds 1.7% of the corpus, and the distribution
is extremely flat. There is no small set of document types to cover — there are thousands of
locally-invented names.

---

## 2. Coverage of your 14 conventions

Matched with separator normalization, so `Funding_Agreement.pdf`, `PayStub.pdf` and
`funding agreement.pdf` all count. A file can match more than one convention.

| Convention | Files matching | Share of sort route |
|---|---|---|
| Paystubs | 9,077 | 15.5% |
| Application Document | 3,488 | 6.0% |
| Proof of Payment | 2,654 | 4.5% |
| Invoice | 1,832 | 3.1% |
| Funding Agreement | 1,271 | 2.2% |
| Business Certificate | 614 | 1.1% |
| Employment Contract | 535 | 0.9% |
| Student Information Form | 404 | 0.7% |
| Employer Participation Form | 307 | 0.5% |
| Bank Statement | 230 | 0.4% |
| Proof of WIL | 224 | 0.4% |
| Budget Sheet | 195 | 0.3% |
| Tax Documents | 37 | 0.1% |
| Financial Statement | 29 | 0.0% |

**Paystubs dominate at 15.5%** — by far the highest-volume document type, and also the one whose
convention needs the most fields. That combination makes it both the biggest win and the
hardest to automate.

**Tax Documents (37) and Financial Statement (29) barely appear.** Either those documents live
outside the client folders, or they are named something else entirely.

---

## 3. THE GAP — what your conventions do not cover

**38,312 files (65.5%) match none of the 14 conventions.**

The 25 largest uncovered clusters — this is the list that needs decisions:

| # | Files | Cluster | Mostly from | Example |
|---|---|---|---|---|
| 1 | 981 | `(no alpha stem)` | WorkBC Wage Subsidy | `20180523_125422.jpeg` |
| 2 | 260 | `workbc wage subsidy` | WorkBC Wage Subsidy | `WorkBC Wage Subsidy.pdf` |
| 3 | 205 | `claim` | WorkBC Wage Subsidy | `Claim 1.rtf` |
| 4 | 194 | `claim submission` | WorkBC Wage Subsidy | `September Claim Submission.pdf` |
| 5 | 168 | `image` | ETG (Employer Training G | `image001.jpg` |
| 6 | 167 | `screen shot at pm` | ETG (Employer Training G | `Screen Shot 2023-10-26 at 4.16.29 PM.png` |
| 7 | 163 | `course outline` | ETG (Employer Training G | `Course Outline.docx` |
| 8 | 141 | `renewables inc` | ECO Canada-YNR:STIP | `Clir Renewables Inc-C1568843-26-Nov-2021.pdf` |
| 9 | 140 | `timesheet` | WorkBC Wage Subsidy | `Timesheet Dec.xls` |
| 10 | 118 | `claim form` | WorkBC Wage Subsidy | `Claim form.pdf` |
| 11 | 99 | `course outline template copy` | ETG (Employer Training G | `Course Outline Template copy.docx` |
| 12 | 89 | `resume` | WorkBC Wage Subsidy | `ResumeMarcelGravelle.pdf` |
| 13 | 87 | `mail attachment` | ETG (Employer Training G | `Mail Attachment.eml` |
| 14 | 85 | `course outline template` | ETG (Employer Training G | `Course Outline Template.docx` |
| 15 | 83 | `remboursements` | DS4Y - ICNJ | `Remboursements #1.pdf` |
| 16 | 83 | `img` | Green Shipping | `IMG_2205.jpeg` |
| 17 | 81 | `screen shot at am` | ETG (Employer Training G | `Screen Shot 2021-01-04 at 10.20.06 AM.png` |
| 18 | 71 | `workbc wage subsidy claim confirma` | WorkBC Wage Subsidy | `WorkBC Wage Subsidy Claim Confirmation.pdf` |
| 19 | 68 | `inc` | Magnet SWPP | `Paneless Window Washing Inc-F7255278-14-Apr-` |
| 20 | 66 | `biotalent canada science horizons ` | Science Horizons - BioTa | `BioTalent Canada- Science Horizons Youth Int` |
| 21 | 60 | `estimator bundle` | ETG (Employer Training G | `Estimator Bundle .docx` |
| 22 | 56 | `canexport claim template` | CanExport | `CanExport_Claim Template.xlsx` |
| 23 | 55 | `bc course planner` | ETG (Employer Training G | `2021 Q1 BC Course Planner.xlsx` |
| 24 | 52 | `cjg schedule` | ETG (Employer Training G | `Native Shoes - CJG1605089 - Schedule A & B.p` |
| 25 | 52 | `funding agreement` | CanExport | `Funding_Agreement[56] .pdf` |

### What this list is telling you

**Claims and reimbursement workflow is the single biggest uncovered category.** `claim`,
`claim submission`, `claim form`, `claim confirmation`, `remboursements`, `reimbursements` —
thousands of files describing the claims process, with no convention covering any of them.

**Evidence-of-work documents are uncovered.** `timesheet` (140), `resume` (89),
`job description` (46), `course outline` (163 plus 184 more as templates).

**Camera and screenshot dumps have no name at all.** `(no alpha stem)` is the single largest
cluster at 981 files — `20180523_125422.jpeg`, `IMG_2205.jpeg`, `image001.jpg` — plus 248 more
as `screen shot at pm` / `screen shot at am`. **No convention can rescue these; they need a
human or a file read to know what they are.**

**One vocabulary problem worth fixing regardless.** "Reimbursement" appears as a folder name in
at least eight spellings: `Reimbursement`, `Reimbursements`, `*Reimbursements`, `Reimbursment`,
`Reim`, `Reimb`, `Reimbursments`, `*Reimbursement`. Any convention referencing it will need one
canonical spelling.

---

## 4. Field derivability

Where each field in your conventions could come from. Three categories:
**path** = already in the destination path; **filename** = sometimes present in the existing
name; **file** = not available without opening the document.

Destination paths are shaped `Clients/<Client>/<Program>/<Year>/<sub-path>/<filename>`.

| Convention | Field | Source | Notes |
|---|---|---|---|
| Invoice | Course Name | **file** | See below — course folders are rare in practice |
|  | Client Name | **path** | Canonical, from the mapping |
| Proof of Payment | Course Name | **file** | Same as above |
|  | Client Name | **path** | Canonical |
| Paystubs | Payroll Dates (YYYYMM-YYYYMM) | **file** | Only 2.6% of filenames carry any date in this shape |
|  | Client Name | **path** | Canonical |
|  | Intake | **path** | Derivable from the year segment for ETG; unreliable elsewhere |
|  | Program Name | **path** | Canonical |
|  | Position | **file** | Present in only ~16% of hiring paths |
|  | Student Name | **file** | Same folder as Position — same ~16% |
| Employment Contract | Client / Intake / Program | **path** | Canonical |
|  | Position / Student Name | **file** | ~16% of hiring paths |
| Business Certificate | Client / Intake / Program | **path** | Canonical |
|  | Position / Student Name | **file** | ~16%; also questionable — a business certificate belongs to the employer, not a student |
| Proof of WIL | Client / Intake / Program | **path** | Canonical |
|  | Position / Student Name | **file** | ~16% |
| Funding Agreement | Client / Intake / Program | **path** | Canonical |
|  | Position / Student Name | **file** | ~16%; a funding agreement is usually per-client, not per-student |
| Student Information Form | Client / Intake / Program | **path** | Canonical |
|  | Position / Student Name | **file** | ~16% |
| Employer Participation Form | Client / Intake / Program | **path** | Canonical |
|  | Position / Student Name | **file** | ~16% |
| Bank Statement | Project Name | **file** | No project-name field exists anywhere in the mapping |
|  | Client / Program | **path** | Canonical |
| Financial Statement | Project Name | **file** | Same |
| Tax Documents | Project Name | **file** | Same |
| Budget Sheet | Period (YYYYMM-YYYYMM) | **file** | Same date problem as Paystubs |
|  | Client / Program | **path** | Canonical |
| Application Document | Client / Program | **path** | **Fully derivable — the only convention that is** |

### The important correction

Your folder specification assumes a structure that the legacy data mostly does not have:

```
Your spec, Hiring:   Program > Client > "Role and Candidate Name" > claims > 1,2,3…
Your spec, Training: Program > Intake > Client > Course name > Claims
```

If that held, Position, Student Name and Course Name would all be free — readable straight from
the folder. **In the migrated corpus it usually does not hold:**

| | Files | Has a `Role - Person Name` folder at any depth |
|---|---|---|
| Hiring-type programs | 28,412 | 4,438 (**16%**) |
| ETG / Training | 17,890 | 922 (**5%**) |

The most common first sub-folder under a client is not a course or a candidate — it is a
workflow stage:

| Sub-folder | Files |
|---|---|
| `Reimbursement` | 4,135 |
| `Reimbursements` | 2,646 |
| `Claims` | 2,143 |
| `*Reimbursements` | 1,889 |
| `Paystubs` | 1,090 |
| `Reimbursment` | 934 |
| `Reim` | 751 |
| `Reimb` | 329 |
| `*Reimbursement` | 250 |
| `Reimbursments` | 218 |

**Your structure is a good target for new work. It is not a description of the existing
archive.** Position, Student Name, Course Name, Payroll Dates and Project Name all fall into the
"needs a file read" category for the large majority of files.

---

## 5. What could actually be renamed

| | Files | Share |
|---|---|---|
| **a. Renameable from path + filename alone** | **7,816** | **13.4%** |
| **b. Needs a file read to complete the name** | **12,321** | **21.1%** |
| **c. No convention applies at all** | **38,312** | **65.5%** |

What is missing in category (b):

| Missing field(s) | Files |
|---|---|
| position+student + period | 7,180 |
| position+student | 3,148 |
| period | 1,415 |
| course | 313 |
| project name | 265 |

**Reasoning.** A file lands in (a) only if its convention's every field is derivable: the
document type is recognizable from the filename, and Client/Program/Year come from the path. It
drops to (b) as soon as the convention requires Position, Student Name, Payroll Dates, Period or
Project Name and the path does not supply it. It is (c) if no convention covers the document type.

The single biggest blocker is the Position + Student Name pair, missing for 10,328 files that
otherwise match a hiring convention.

---

## 6. Is anyone already doing this?

**7,776 filenames (13.3%) already have a `Type - Field - Field` shape.** So the
habit exists, but it is a minority one.

Separator styles in use — no house style has emerged:

| Style | Files | Share |
|---|---|---|
| spaces only | 24,197 | 41.4% |
| spaced hyphen | 18,608 | 31.8% |
| bare hyphen | 9,291 | 15.9% |
| underscore | 7,418 | 12.7% |
| leading YYYYMM date | 1,533 | 2.6% |

Adherence varies enormously by program, which suggests it tracks individual habits rather than
team practice:

| Program | Convention-shaped | of | Rate |
|---|---|---|---|
| Opportunities Fund Program - BCA | 131 | 338 | **38.8%** |
| Food Processing SWPP | 78 | 239 | **32.6%** |
| Science Horizons - BioTalent | 94 | 320 | **29.4%** |
| DS4Y - Pinnguaq | 201 | 853 | **23.6%** |
| Skilled Newcomer Bio-Economy | 56 | 250 | **22.4%** |
| Talent Opportunities | 170 | 826 | **20.6%** |
| Discovering Potential | 58 | 283 | **20.5%** |
| UNAC-Green Corps-STIP | 59 | 315 | **18.7%** |
| … | | | |
| AgriMarketing | 25 | 398 | 6.3% |
| Get BC Working | 25 | 407 | 6.1% |
| CanExport | 70 | 1,171 | 6.0% |
| Alberta Jobs Now | 25 | 461 | 5.4% |
| Trucking HR SWSP | 20 | 380 | 5.3% |

**No program exceeds 39%.** There is no existing local convention strong enough to adopt
wholesale — but the higher-scoring programs are worth asking about, since someone there is
already doing something deliberate.

---

## Questions this raises for Olivia

1. **The uncovered two thirds.** Claims/reimbursement paperwork, timesheets, resumes, job
   descriptions and course outlines are all high-volume and unnamed. Should they get
   conventions, or be left as-is?
2. **Position and Student Name.** Both are required by seven of the fourteen conventions but
   present in ~16% of hiring paths. Is a rename worth doing when it needs a human to open five
   files out of six?
3. **Business Certificate and Funding Agreement** are specified per-student, but both are
   normally per-employer documents. Is that intentional?
4. **Project Name** appears in three financial conventions and exists nowhere in our data. Where
   does it come from?
5. **Scope.** Applying conventions to new work is cheap. Retrofitting the archive costs a file
   read for 12,321 documents and cannot be done at all for 38,312. Is the goal new work,
   or the archive too?
