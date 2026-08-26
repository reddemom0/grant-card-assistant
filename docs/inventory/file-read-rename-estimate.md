# File-Read Rename Pass — Scoping Estimate

**Generated:** 2026-08-21 · **Status:** estimate only. Nothing was read, nothing renamed.

Scopes an AI pass that would open documents to extract the naming fields that cannot be
recovered from folder paths — Position, Student Name, Payroll Dates, Course Name, Project Name.

**No file content was read to produce this. No API was called.** Every figure comes from
filenames, destination paths and file sizes already recorded in the mapping CSVs.

**Mapped year is used throughout, never `server_modified`** — 40,390 files share a corrupted
2024-07-23 bulk timestamp that would date most of the corpus to the same wrong day.

---

## The recommendation, up front

**Don't run this across the archive. If you run it at all, run it on the 1,311 files belonging
to current clients.**

Cost is not the reason — the whole set is about $39 on Haiku, which is nothing. The reasons are
that **89% of the work benefits dormant clients**, and that this would be **the first time any AI
in this project reads a client document**. Those two facts together make a full-archive pass a
poor trade.

---

## 1. What needs a file read

**12,321 files** match one of Olivia's conventions but are missing at least one required
field from the path.

| Document type | Files |
|---|---|
| Paystubs | 8,944 |
| Funding Agreement | 901 |
| Business Certificate | 603 |
| Employment Contract | 399 |
| Student Information Form | 307 |
| Proof of Payment | 234 |
| Employer Participation Form | 234 |
| Bank Statement | 199 |
| Budget Sheet | 182 |
| Proof of WIL | 173 |
| Invoice | 79 |
| Tax Documents | 37 |
| Financial Statement | 29 |

| Missing field(s) | Files |
|---|---|
| position + student + period | 7,180 |
| position + student | 3,148 |
| period | 1,415 |
| course | 313 |
| project name | 265 |

**Paystubs are 73% of the problem** — 8,944 files needing Position, Student Name and usually
Payroll Dates, none of which is in the path.

| Program | Files |
|---|---|
| WorkBC Wage Subsidy | 6,123 |
| ETG (Employer Training Grant) | 950 |
| DS4Y - VCN | 399 |
| Magnet SWPP | 363 |
| Mon Avenir | 301 |
| WIL Digital | 239 |
| DS4Y - LHL | 231 |
| Career Ready (ITAC Technation) | 216 |
| Trucking HR SWSP | 183 |
| Career Launcher Internships (inc DS4Y DT) | 175 |

**WorkBC Wage Subsidy alone is half the set** (6,123). It is a high-volume hiring program with
monthly paystub claims per participant.

---

## 2. Retention filter — mapped year ≥ 2019

| | Files | Share |
|---|---|---|
| Year ≥ 2019 — **keep** | **12,123** | 98.4% |
| Year < 2019 — drop | 198 | 1.6% |

**The retention filter barely helps.** It removes 198 files — 1.6%. This work is recent:
2021, 2022 and 2023 alone account for 9,433 of the 12,321.

| Document type | Keep (≥2019) | Drop (<2019) |
|---|---|---|
| Paystubs | 8,935 | 9 |
| Funding Agreement | 821 | 80 |
| Business Certificate | 595 | 8 |
| Employment Contract | 390 | 9 |
| Student Information Form | 304 | 3 |
| Employer Participation Form | 215 | 19 |
| Proof of Payment | 210 | 24 |
| Bank Statement | 198 | 1 |
| Proof of WIL | 173 | 0 |
| Budget Sheet | 157 | 25 |
| Invoice | 64 | 15 |
| Tax Documents | 35 | 2 |
| Financial Statement | 26 | 3 |

If you were hoping age would shrink this to something trivial, it does not. **The number that
does is client status.**

---

## 3. Live versus archived clients

| | Files | Clients |
|---|---|---|
| **Live clients** | **1,311** | **34** |
| Archived clients | 10,812 | 679 |

**Only 11% of the work benefits a current client.** The other
10,812 files belong to 679 dormant clients — companies whose folders
nobody is opening.

This is the single most decision-relevant number in the document. A better filename helps
someone who is looking for the file. Nobody is looking in these folders.

| Live-client files by type | Files |
|---|---|
| Paystubs | 938 |
| Funding Agreement | 111 |
| Employment Contract | 60 |
| Business Certificate | 48 |
| Student Information Form | 41 |
| Employer Participation Form | 41 |
| Proof of WIL | 25 |
| Budget Sheet | 15 |

---

## 4. Scannability — how reliable would extraction be?

| Format | Files |
|---|---|
| `.pdf` | 8,963 |
| `.xls` | 1,627 |
| `.xlsx` | 840 |
| `.png` | 272 |
| `.docx` | 152 |
| `.jpg` | 118 |
| `.zip` | 26 |
| `.doc` | 25 |
| `.numbers` | 23 |
| `.mp4` | 16 |

| | Files | Extraction confidence |
|---|---|---|
| PDF under 400 KB | 7,313 | Good — almost certainly born-digital with a text layer |
| PDF 400 KB and over | 1,650 | **Poor** — size-per-page consistent with a scan |
| Images (`.png/.jpg/.jpeg/.tif`) | 401 | **Poor** — photographs or screenshots, no text layer |
| Spreadsheets (`.xls/.xlsx/.csv/.numbers`) | 2,501 | Good — structured, but fields may be in cells rather than headers |

**Reasoning for the proxy.** Page counts are not available without opening the files, which is
out of scope here, so file size stands in. A born-digital 1–3 page paystub or certificate is
typically well under 150 KB; a scanned page runs 300 KB to 2 MB. The median file in this set is
**84 KB**, which suggests the bulk is born-digital — good news for extraction.

**About 2,051 files (17%) are likely scans or images.** For those,
extraction depends on OCR quality and a misread name is worse than a generic one: `Paystubs-
202203-202204-Acme-Fall2022-WorkBC-Electrcian-Jhon Smith.pdf` is harder to find than
`Paystub.pdf`, and it looks authoritative while being wrong.

---

## 5. Cost

**Assumption: 2,900 input tokens and 60 output tokens per document.**
A paystub, employment contract or business certificate is 1–3 pages. Claude reads a PDF page as
roughly 1,200–1,800 tokens, so two pages is ~3,000; the instruction adds ~400; text-only formats
come in cheaper. Output is a single filename plus a confidence field — 60 tokens is generous.

### All 12,123 files

- Input: 12,123 × 2,900 = **35,156,700 tokens**
- Output: 12,123 × 60 = **727,380 tokens**

| Model | Input | Output | **Total** |
|---|---|---|---|
| Haiku 4.5 ($1 / $5 per Mtok) | $35.16 | $3.64 | **$38.79** |
| Sonnet ($3 / $15 per Mtok) | $105.47 | $10.91 | **$116.38** |

### Live clients only — 1,311 files

| Model | **Total** |
|---|---|
| Haiku 4.5 | **$4.20** |
| Sonnet | **$12.59** |

**Cost does not decide this.** Even the maximal option is roughly one hour of a consultant's
time. Anyone arguing from budget is arguing about the wrong thing — the real costs are
confidentiality and the risk of confidently wrong filenames.

---

## 6. Runtime

**Assumption: 5–11 seconds per file end to end** — download from Drive (median file is
84 KB, so under a second), then one model call at 4–8 seconds, plus retry headroom.
**Parallelism 8**, which the copy runs have shown this environment sustains comfortably.

| Scope | Files | Runtime at parallelism 8 |
|---|---|---|
| All | 12,123 | **2.1–4.6 hours** |
| Live clients only | 1,311 | **0.2–0.5 hours** |

Total download volume is 4.55 GB — trivial next to the 63.86 GB already moved.

Add a manual review pass on top. At even 10 seconds per name, spot-checking 10% of 12,123 files
is another 3½ hours of human time — plausibly more than the machine time.

---

## 7. Confidentiality — a decision for Steph, not a technical detail

**No AI has read a single client document in this project so far.** Every stage — the inventory,
client-name resolution, the mapping, all three copy stages, the naming gap analysis — was done
from folder names, file names, sizes and timestamps. Not one document was opened.

**This pass would change that**, and the documents in question are among the most sensitive in
the corpus:

- **Paystubs — 8,935 files.** Employee names, wage rates, hours, gross and net pay,
  deductions, employer details. Canadian paystubs frequently carry a **Social Insurance Number**.
- **Employment contracts — 390.** Names, addresses, salary, terms.
- **Student information forms — 304.** Personal details of named individuals, often students.
- **Bank and financial statements — 224.** Account numbers, balances, transaction histories.
- **Tax documents — 35.** T4s carry SINs by definition.

These are third-party personal data. The individuals are not Granted's employees — they are
clients' employees and students, who never consented to anything of the sort.

**The questions Steph should answer before this runs:**

1. Do the client agreements permit sending client documents to a third-party AI provider?
2. Does anything here fall under PIPEDA or provincial privacy legislation in a way that
   requires notice or consent for processing?
3. Is there a data-residency requirement? API calls leave Canada.
4. Is a filename improvement worth transmitting SINs and wage data at all?

A narrower option exists if the answer to (4) is uneasy: run the pass **only on document types
that carry no personal data** — Business Certificates (595), Funding Agreements (821), Budget
Sheets (157). That is 1,573 files, no SINs, no wages, no named individuals.

---

## 8. Is this worth doing?

### The case for

- 12,123 files currently have names like `Paystub.pdf`, `Claim 1.rtf`, `Scan_004.pdf`.
- Consistent names make documents findable by search rather than by remembering the folder.
- It is cheap and fast in machine terms: ~$39 and a few hours.
- The corpus is freshly organized; this is the natural moment, before people re-learn old habits.

### The case against

- **Only 1,311 files (11%) belong to current clients.** The rest is tidying folders
  for 679 dormant companies nobody opens.
- **It breaks a clean record.** Nothing in this project has read a client document. That is a
  genuinely valuable property, and it is spent the first time it is broken.
- **~2,051 files are probably scans**, where a wrong-but-confident name is worse than the
  generic one it replaced.
- **The naming gap analysis found that 65.5% of client files match no convention at all.** This
  pass addresses a fraction of a problem whose larger half is unsolved. Deciding what to do about
  the uncovered two thirds is worth more than perfecting the covered third.
- **Renaming is not reorganizing.** Files are already in `Clients/<Client>/<Program>/<Year>/`.
  Most of the find-ability benefit has already been delivered by the migration.

### Recommendation

**Run it on the 1,311 live-client files, or not at all.**

At that scope it costs about **$4 on Haiku**, takes **15–30 minutes**, touches only clients
someone is actively working with, and can be reviewed by a human in an afternoon. That is a
proportionate experiment: if the names come back good, extending later is easy; if they come
back wrong, little was risked.

**Do not run it across all 12,123.** The extra 10,812 files buy filename quality in folders
nobody opens, in exchange for transmitting thousands of SINs and wage records to a third party.

**And answer Olivia's open questions first.** Four of her fourteen conventions specify fields
that may not be right — Business Certificate and Funding Agreement are named per-student when
both are normally per-employer, and Project Name exists nowhere in our data. Extracting fields to
satisfy a convention that is still being revised is work done twice.
