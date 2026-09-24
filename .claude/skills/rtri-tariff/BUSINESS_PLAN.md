# RTRI — Business Plan (pivot applications)

Drafts a client's business plan for an RTRI pivot application — the PacifiCan
Regional Tariff Response Initiative, the BC tariff program. Not the R&D program
also abbreviated RTRI; if the request is about R&D readiness or innovation
funding, this is the wrong path.

The business plan is an optional supporting document for pivot projects, but a
strong one supports the application form across Tabs 2, 4, 5, 6, 7, and 8.

**Pivot only.** If the client is applying for liquidity assistance alone, say
the business plan is for pivot projects and that a liquidity cash-flow forecast
isn't available yet. If they're applying for both, the plan covers the pivot
project.

---

## Load first

- `PROGRAM_FACTS` — program facts: streams, eligible costs, dates, open items.
- `APPLICATION_FIELDS` — the form tabs the plan has to match.
- `BUSINESS_PLAN_TEMPLATE` — Steph's template: the section order, each
  section's character target, its guiding questions, its tables, and the
  internal checklist. It is the only business plan template. The older
  "Business Plan for RTRI.docx" in the RTRI Application Templates folder is not
  used.

**Where the template and Granted's RTRI notes disagree on a program fact, the
notes win** — follow the template's structure and questions, take the facts
from the notes, and tell the consultant about the difference. Known ones:

- **1.3, the "Other" dropdown.** The template says it flags the file for
  priority processing. The guide says it ensures applications are easily
  identified. Use the guide's wording.
- **1.2, Section 301.** The template lists it; it isn't one of the program's
  tariff impact categories. Mention it only if the client's own evidence shows
  it, and never present it as a program category.
- **3.x, training.** The template asks for training costs. Training eligibility
  is an open item — mark every training line
  `[TO CONFIRM: training eligibility is an open item]`.

---

## Gather inputs before drafting — in this order

1. **The budget (Tab 3).** Use the budget the consultant links. Otherwise look
   in the client's RTRI folder for a budget file. A budget in Google Sheets is
   read with `read_sheet_metadata`, then `read_sheet_range` for each tab — not
   the Drive file reader, which can't open Sheets.
2. **Interview answers.** The completed RA or interview answers — a link from
   the consultant, or found in the client's folder. Always report them as found
   (with a link) or not found, then carry on with what's available.
3. **The rest of the client's RTRI folder** — application form draft,
   financial statements, evidence. **An existing business plan draft is an
   input:** read it and cite it like any other source. It is never where you
   write.

Find the client's folder by listing the RTRI Drive root and matching the name,
under the client-folder rules in the overview: this client's folder only, never
another client's specifics.

Before drafting anything, give the consultant this block, every time, with
exactly these three lines:

> **Budget:** found ([link]) / not found / found but unreadable ([link] — why)
> **Interview answers:** found ([link]) / not found
> **Section 10:** will be drafted / won't be drafted (why)

Then list anything else you found (with links) and what else is missing.

**No budget found → say so, and don't draft Section 10.** A budget that exists
but can't be read counts as missing: say why, and don't draft Section 10.
Sections 3 and 4 can still be drafted, with every cost figure marked
`[TO CONFIRM]`.

**Then draft — don't stop to ask.** In the same reply as the found/missing
summary, draft Section 1. The consultant reviews it from there.

---

## Drafting

Same mechanics as the application writeup:

- **Always a new Doc.** Create it on the first section with
  `create_google_doc`, titled as an RTRI (tariff program) business plan for
  the client. Never write into the client's existing files, including an
  earlier business plan draft — the client folder is read-only. One heading per
  template section; headings must be unique.
- **One section at a time,** starting with Section 1. Draft it, show it, take
  the consultant's edits, and move on only when they're satisfied. Add each
  new section with `insert_into_google_doc`; revise an existing one with
  `replace_google_doc_section`.
- **Use each section's character target and guiding questions** from the
  template. Show the character count against the target. Answer every guiding
  question the inputs support; mark the rest.
- **Cover page and table of contents last.**

**Tables become labelled lists while drafting.** The Doc edit tools refuse
tables, so write each template table as a labelled list — for example
"Revenue and impact table — FY2023 (baseline): total revenue $X; export
revenue $X; export share X%; gross margin X%." Keep the template's rows and
columns so nothing is lost.

**Final Doc with real tables.** When every section is approved, offer to build
a clean final Doc in one go with `create_google_doc`: read the approved draft
back, and turn each labelled list into a real table. The draft Doc stays as it
is.

---

## Numbers and gaps

Your core sourcing rules apply throughout, and so does the writeup's rule on
marking gaps inside the draft text.

- **Never invent a number.** Financial content uses only figures from the
  budget, the financial statements, or the interview answers, each traceable
  to its file.
- **Every missing figure is marked inline** — `[TO CONFIRM: FY2023 export
  revenue]` — in the sentence or list line where it belongs.
- **Conflicts across the client's own files are marked inline too.** When two
  of the client's files give different dates or figures for the same thing,
  don't pick one: write both in the text where it's used —
  `[TO CONFIRM: April 6, 2026 or June 2025]` — and say which file gave which.
- **Section 10 projections** — forecasts, scenarios, breakevens — are never
  made up. Use projections the client provided. A figure you derive is a
  labelled estimate with the math shown, and only when every input is cited.

---

## Closing check

When the draft is complete, run the template's internal checklist — the
"Business plan cross-checks" and "Financial documents" items — against what's
available:

- Section 3 project costs vs Tab 3 (Funding)
- Section 3 milestones vs Tab 5 (Timelines)
- Start and end dates across Sections 3 and 10 and Tabs 2, 3, and 5
- The CapEx table vs the Section 3 phase costs
- Tab 4 indicators vs the outcomes in Sections 4 and 10

Report each item as **matches**, **mismatch** (both values, and where each
came from), or **can't check** (what's missing). **Never silently fix a
mismatch** — the consultant decides which figure is right.
