---
name: staff-meeting-recap
description: Process a Granted weekly staff meeting end-to-end — pull the Granola transcript, cross-reference HubSpot/GG/web for verifiable claims, write per-line discussion notes to the Weekly Staff Meeting Google Sheet, mark last week's action items done/not-done, and propose coming-week action items. MUST use this skill whenever Chris or any team member asks to recap, process, populate, fill out, or write up a staff meeting, weekly meeting, or Tuesday meeting — even if they don't say "Oracle Notes" explicitly. Trigger phrases include "process the [date] meeting", "recap last Tuesday", "fill in the staff meeting notes", "write up the meeting", or any reference to "the staff meeting sheet".
---

# Staff Meeting Recap

Each week, the Granted team holds a staff meeting that's transcribed by Granola. The Weekly Staff Meeting Google Sheet has one tab per meeting, structured into department sections (Strat, GCs, Research, Marketing/Communications, AI, Finance) plus Company KPIs, Research Grant Highlights, Quarterly Goals, and action-item sections. Each tab has an "Oracle Notes" column at column E.

This skill runs the recap workflow: read the transcript, cross-reference what's verifiable, fill in per-line context for the data rows of each section, update last week's action items, and propose coming-week items.

## Critical principles

**1. Anchor by label, never by row number.** Row numbers in the sheet shift week to week — the team adds or removes action items, edits the Template, etc. Always find sections at runtime by reading column A.

**2. One cell per write call. Never build value arrays for batch writes.** Constructing arrays risks misalignment between intended rows and array indices, which has caused header rows to be overwritten with data and data rows to be overwritten with empty strings. Always use `update_sheet_range` with a single-cell range like `'<tab>'!E20` and a 1×1 values array (`[["the note text"]]`). Yes, this means more API calls — that's the cost of guaranteed correctness.

**3. The only fixed identifier is the spreadsheet ID.** Everything else — section row positions, action item count, header labels — is discovered live.

## When this skill triggers

- "Process the [date] staff meeting" / "recap [date]'s meeting"
- "Fill in the meeting notes for [date]"
- "Write up Tuesday's meeting"
- Any request that references the staff meeting sheet and a date

If the user gives a relative reference ("last Tuesday", "this week's") without a specific date, resolve it before proceeding. If genuinely ambiguous, ask which meeting. If the user gives an exact tab name (e.g., "the TEST May 6, 2026 tab"), use that exact name and skip date-matching.

## Inputs

**Spreadsheet:** Always `1SGZ0HombWMiOI7k_oAL3m9nfMXK2LU1NnLpUOIOaEaA` (Weekly Staff Meeting). This is fixed — don't ask the user.

**Tab naming:** Tabs are named like "May 6, 2026" but formatting varies. Some have leading spaces (" April 29,2026"), some have "th" suffix on the day ("April 22nd 2026"), comma placement varies. Match by date components, not exact string.

## Workflow

### Step 1 — Find the meeting tab

Use `read_sheet_metadata` with the spreadsheet ID to get the spreadsheet title and the list of all tabs. Match the user's date against tab names liberally (date components, not exact string). If the user gave an exact tab name, use that exact name.

If no matching tab exists, stop and tell the user the tab needs to be created first. Don't try to create the tab — humans handle weekly tab creation.

Save the resolved tab name for use in all subsequent range arguments. Tab names containing spaces or special characters need single quotes when used in A1 ranges: `'May 6, 2026'!A19`.

### Step 2 — Pull the Granola transcript

Use `granola_list_meetings` with a 24-hour window covering the meeting date. Match on title — typically "Granted Staff Meeting" or "Weekly Staff Meeting". If no match for that day, try ±1 day (timezone shifts sometimes misdate recordings).

If multiple meetings match, prefer the longest. If none match after the ±1 day check, stop and tell the user.

Then `granola_get_meeting_transcript` for the verbatim transcript. Verbatim is preferred over enhanced notes — accuracy on action items and quoted claims matters more than polish.

### Step 3 — Read the tab and build the section map

Use `read_sheet_range` to read the relevant columns of the entire tab in one call: `'<tab>'!A1:E125`. (Reading to row 125 ensures the bottom of the sheet is captured regardless of how many action item rows the team added.)

Walk column A row by row. Build the section map — a list of records, one per row, capturing the row index, the column A label, and a classification.

**Recognized section header anchors** (rows where Oracle never writes to column E):

- Column A starts with "Company KPIs"
- Column A = "Strat"
- Column A = "GCs"
- Column A = "Research"
- Column A = "Marketing/Communications"
- Column A = "AI"
- Column A = "Finance"
- Column A starts with "Research Grant Highlights"
- Column A = "Quarterly Goals"
- Column A = "Departmental KPIs for this month"
- Column A is empty AND column B contains "Target" or "Benchmark" (sub-header rows)

**Recognized action-item anchors:**

- Column A starts with "Action Items from last week"
- Column A starts with "Action Items for coming week"

**Recognized end-of-action-items boundary:** the next row after "Action Items for coming week" where column A has any non-empty value. The boundary label can vary ("Customer Headlines", "Identify, Discuss, Solve", or anything else) — don't hard-code the label, just find the next non-empty column A row after the coming-week header.

If the "Action Items from last week" or "Action Items for coming week" anchors are missing, stop and tell the user the Template structure has changed.

### Step 4 — Fill the Oracle Notes cells (the reasoning step)

Iterate through every row in the section map. For each row, classify it:

- **Section header row** → SKIP. Never write to column E.
- **Sub-header row** (column A empty, column B = Target/Benchmark) → SKIP.
- **Empty-label continuation row** (column A empty AND column B/C/D have data, e.g. LinkedIn metric breakdown sub-rows) → SKIP. The discussion context belongs in the parent row's column E.
- **Data row** (column A has a label that's not a section header AND not an action-item anchor) → CANDIDATE for an Oracle Note.

For each candidate row, decide between three outcomes:

1. **The line item was discussed in the transcript.** Write the note in column E for that row.
2. **The line item wasn't discussed, but Oracle has cross-reference data worth surfacing.** Write the cross-ref note in column E with a `(no team discussion — context from HubSpot/GG)` or `(no team discussion — context from web)` prefix.
3. **Nothing relevant either way.** Skip — don't write anything to that cell.

**Write strategy: one cell at a time.** For each cell that gets a note, make a separate `update_sheet_range` call:

```
update_sheet_range({
  spreadsheet_id: "1SGZ0HombWMiOI7k_oAL3m9nfMXK2LU1NnLpUOIOaEaA",
  range: "'<tab>'!E<row>",
  values: [["the note text"]]
})
```

One call per cell. Do not assemble arrays of values across rows. Do not call `update_sheet_range` once with a multi-row range — that has produced misalignment errors where notes land one row off, header text bleeds into data rows, and AI-section notes leak into Finance headers.

**Cross-reference behavior.** When the transcript mentions a verifiable claim, look it up:
- Deal/company claims → `search_grant_applications` (with `company_name`) or `search_hubspot_companies` (with `query`)
- Pipeline counts / deal-stage queries → `search_grant_applications` with `dealstage` and `pipeline` filters. Note: HubSpot deals in this codebase are surfaced as "grant applications" — there's no `search_hubspot_deals` tool.
- Grant lookups → `search_getgranted`, plus `web_search` if context warrants
- Highlighted grants → `search_getgranted` (have we seen it? similar funders we work with?) AND `web_search` (recent program changes, deadlines, news)

When the transcript matches reality, write the note as stated. When it contradicts, write the note AND flag the contradiction inline. Don't quietly correct — surface disagreements.

**Voice rules.**

*Third-person objective throughout.* "Chris demoed the new workflow", not "I demoed". Even when the cells are written by Oracle on Chris's behalf, the artifact is for the team.

*Name attribution — be conservative.* Only attribute a statement by name when the transcript explicitly identifies the speaker for that specific statement. If the transcript shows a comment without a clear speaker tag, write it without naming anyone. Use neutral phrasing instead: "Team noted...", "Discussion covered...", or just state the fact directly. Don't infer who said something based on context, role, or which department the topic falls under. (The exception is action item ownership in Step 6 — for those, work harder to determine ownership because that's the operational point.)

**Example cell content:**

> Monthly Submissions row: "Q4 began this week — $50 actual against $100K monthly target. Heavy reliance on M/E grants this quarter; 2-3 RTRIs and 2 CanExports expected."

> Strat - Outreach/Leads row: "(no team discussion — context from HubSpot) 5 outreach activities logged this month against 100 target."

> Research Grant Highlights row: "Graduate to Opportunity Innovate (GTO Innovate) confirmed as brand new — Nova Scotia hiring subsidy for master's/PhD grads, up to $31K, financial support for 2 years. GG database has 0 matches; net-new program."

### Step 5 — Mark last week's action items

Find the row where column A starts with "Action Items from last week" — call this `LW_HEADER_ROW`. Find the row where column A starts with "Action Items for coming week" — call this `CW_HEADER_ROW`.

For each row R between `LW_HEADER_ROW + 1` and `CW_HEADER_ROW - 1`:
- If column A of row R is empty, skip.
- If column A of row R has content (an actual action item), search the transcript for evidence the item was completed, in progress, or blocked.

For each row that needs an update, write column E only — one cell at a time:

```
update_sheet_range({
  spreadsheet_id: "...",
  range: "'<tab>'!E<R>",
  values: [["TRUE"]]    // or [["FALSE"]]
})
```

`TRUE` only if the transcript indicates clear completion. `FALSE` if not done, blocked, ambiguous, or no mention. Never write to columns A-D of last-week's items.

If transcript mentions partial progress, default to `FALSE` and surface in the final summary.

### Step 6 — Propose coming-week action items

Find `CW_HEADER_ROW` (already located in Step 5). Find the boundary row: the next row after `CW_HEADER_ROW` where column A has any non-empty value AND that row is NOT `CW_HEADER_ROW + 1` (since there might be carry-forward items immediately below). Call this `BOUNDARY_ROW`.

To find `BOUNDARY_ROW` correctly:
1. Walk forward from `CW_HEADER_ROW + 1`
2. Skip any rows that have content in column A (these are pre-existing carry-forward items — don't overwrite)
3. The first row where column A is empty — call this `FIRST_WRITE_ROW`
4. Continue walking forward from `FIRST_WRITE_ROW`. The first row where column A is non-empty AGAIN is `BOUNDARY_ROW` (this is the next labeled section, e.g., "Customer Headlines" or "Identify, Discuss, Solve" or anything else).

Identify items the team committed to in the transcript (not aspirational discussion). For each new item, write it to a row starting at `FIRST_WRITE_ROW` and incrementing. Do not skip rows. Do not leave gaps. Stop before reaching `BOUNDARY_ROW`.

For each item, write columns A through E in a single multi-cell write:

```
update_sheet_range({
  spreadsheet_id: "...",
  range: "'<tab>'!A<row>:E<row>",
  values: [["description", "primary owner", "secondary owner", "due date", "FALSE"]]
})
```

Each row written individually. Do NOT batch multiple rows into one call.

For each proposed item:
- A: short action description
- B: primary responsible party (use names from the transcript — Steph, Ruk, Natalie, Olivia, Souad, Chris, Delpreet — or department names: Strategy, GCs, Research, Marketing, AI)
- C: secondary responsible party if mentioned, else blank string
- D: due date if mentioned, else blank string
- E: "FALSE"

For action item ownership specifically, work harder than for general name attribution — the operational value of these rows is knowing who's doing what. If the transcript doesn't make ownership clear, infer from context (whoever raised the work, whoever owns the area) but be conservative: when truly ambiguous, leave column B blank and surface the unassigned items in the final summary.

If there are more proposed items than rows available before `BOUNDARY_ROW`, list the overflow in the final summary rather than truncating silently. Do NOT insert new rows or push other content down.

### Step 7 — Final summary

After all writes complete, summarize for the user:

- Tab populated and date
- Count of Oracle Notes cells filled
- Any contradictions flagged during cross-reference
- Any action items marked differently than they currently appeared
- Any unassigned coming-week items (column B blank)
- Any proposed coming-week items that didn't fit (overflow before the boundary row)

Don't enumerate every cell — the user can read the sheet. Surface the parts that need human attention.

## Out of scope

- The Identify/Discuss/Solve section — skip entirely.
- Tab creation or duplication — humans handle this before invoking the workflow.
- Old tabs that predate the Oracle Notes column — only process tabs duplicated from the current Template.
- The Bravo Card row.
- Retroactive backfilling of historical tabs.
- Modifying the Template tab itself.
- Cell formatting (bold, wrap, font, color). Oracle writes values only — formatting is controlled by the Template.

## Common failure modes

- **Tab name mismatch** — match by date components, not exact string. If the user gave an exact tab name, use that exact name.
- **No Granola meeting found** — try ±1 day before giving up.
- **Sparse transcripts** — if under ~500 words, tell the user before writing notes; the recap will be thin.
- **Cross-reference timeouts** — if a HubSpot or web search fails, write the note without verification rather than blocking.
- **Filling cells with filler** — if there's no discussion AND no relevant cross-ref, leave the cell blank.
- **Writing to header rows** — every section header row has column E that says "Oracle Notes" or is blank. Verify against the section map from Step 3 before writing.
- **Row numbers from memory** — never use a remembered row number. Always use the section map from the *current* tab.
- **First-person voice creep** — third-person always.
- **Over-attribution** — only name a speaker when the transcript explicitly tags them.
- **Batch arrays for column E writes** — never. One cell per call. The misalignment risk is too high.
- **Skipping rows in coming-week section** — don't search for "the first empty row" in the middle of an empty section. Walk past pre-existing items, then write sequentially starting at the first empty row, no gaps.
- **Bold formatting in writes** — Oracle's writes don't apply formatting; values land in whatever style the cell already has. If notes are coming out bold, the underlying cell formatting in the Template needs to be cleaned (one-time human fix), not the skill.
