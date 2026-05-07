---
name: staff-meeting-recap
description: Process a Granted weekly staff meeting end-to-end — pull the Granola transcript, cross-reference HubSpot/GG/web for verifiable claims, write per-line discussion notes to the Weekly Staff Meeting Google Sheet, mark last week's action items done/not-done, and propose coming-week action items. MUST use this skill whenever Chris or any team member asks to recap, process, populate, fill out, or write up a staff meeting, weekly meeting, or Tuesday meeting — even if they don't say "Oracle Notes" explicitly. Trigger phrases include "process the [date] meeting", "recap last Tuesday", "fill in the staff meeting notes", "write up the meeting", or any reference to "the staff meeting sheet".
---

# Staff Meeting Recap

Each week, the Granted team holds a staff meeting that's transcribed by Granola. The Weekly Staff Meeting Google Sheet has one tab per meeting, structured into department sections (Strat, GCs, Research, Marketing/Communications, AI, Finance) plus Company KPIs, Research Grant Highlights, Quarterly Goals, and action-item sections. Each tab has an "Oracle Notes" column at column E.

This skill runs the recap workflow: read the transcript, cross-reference what's verifiable, fill in per-line context for the data rows of each section, update last week's action items, and propose coming-week items.

## Critical principles

**1. Anchor by label, never by row number.** Row numbers in the sheet shift week to week — the team adds or removes action items, edits the Template, etc. Always find sections at runtime by reading column A.

**2. Batch writes per section, never across sections.** When writing column E for a department section, batch all that section's data rows into a single `update_sheet_range` call covering the section's range (e.g., `E30:E33` for Strat). Do NOT batch across multiple sections in one call — that's what caused alignment failures where the AI section's content bled into Finance's header. The section map from Step 3 gives you the exact start and end row of each section's data; that's the range for each batch. Action items use per-row writes since their counts vary.

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

Walk column A row by row. Identify the row index of every recognized anchor and build a section map.

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

**Recognized end-of-action-items boundary:** the next row after "Action Items for coming week" where column A has any non-empty value (after walking past pre-existing carry-forward items). Don't hard-code the boundary label.

For each department section, record:
- `header_row` — the row of the section's header
- `data_start_row` — `header_row + 1` (or `header_row + 2` if the row immediately below is a sub-header like "Target / Actual")
- `data_end_row` — the last row before the next recognized header

If the "Action Items from last week" or "Action Items for coming week" anchors are missing, stop and tell the user the Template structure has changed.

### Step 4 — Fill the Oracle Notes cells (the reasoning step)

This step uses **per-section batched writes**.

For each department section in the section map (Company KPIs, Strat, GCs, Research, Marketing/Communications, AI, Finance, Research Grant Highlights, Quarterly Goals):

**4a. Build the values array for the section.**

The section's range is `data_start_row` through `data_end_row` (inclusive). For each row in that range, decide what value goes in column E:

- **Skip rows that classify as sub-headers** (column A empty AND column B = Target/Benchmark). Value: `""` (empty string).
- **Skip empty-label continuation rows** (column A empty but column B/C/D have data, e.g., LinkedIn metric breakdown sub-rows). Value: `""`.
- **Data rows** (column A has a label) — three outcomes:
  1. Discussed in transcript → write the note in Oracle's voice (third-person objective). One or two sentences.
  2. Not discussed but Oracle has cross-reference data worth surfacing → write the cross-ref note prefixed with `(no team discussion — context from HubSpot/GG)` or `(no team discussion — context from web)`.
  3. Nothing relevant either way → value: `""`.

**4b. Verify array length before writing.**

Confirm `len(values_array) == (data_end_row - data_start_row + 1)`. If not, do NOT write — stop and report the discrepancy. This check catches misalignment bugs before they corrupt the sheet.

**4c. Write the section.**

Make a single `update_sheet_range` call:

```
update_sheet_range({
  spreadsheet_id: "1SGZ0HombWMiOI7k_oAL3m9nfMXK2LU1NnLpUOIOaEaA",
  range: "'<tab>'!E<data_start_row>:E<data_end_row>",
  values: [
    ["note for first row, or ''"],
    ["note for second row, or ''"],
    ...
  ]
})
```

The values array is a 2D array — one inner array per row, each containing exactly one string (the note for column E, or `""` to skip).

Do this for each section, one batch per section. Approximately 9 calls total for all department sections combined. Never combine multiple sections into one call.

**Cross-reference behavior.** When the transcript mentions a verifiable claim, look it up:
- Deal/company claims → `search_grant_applications` (with `company_name`) or `search_hubspot_companies` (with `query`)
- Pipeline counts / deal-stage queries → `search_grant_applications` with `dealstage` and `pipeline` filters. Note: HubSpot deals in this codebase are surfaced as "grant applications" — there's no `search_hubspot_deals` tool.
- Grant lookups → `search_getgranted`, plus `web_search` if context warrants
- Highlighted grants → `search_getgranted` (have we seen it? similar funders we work with?) AND `web_search` (recent program changes, deadlines, news)

When the transcript matches reality, write the note as stated. When it contradicts, write the note AND flag the contradiction inline. Don't quietly correct — surface disagreements.

**Voice rules.**

*Third-person objective throughout.* "Chris demoed the new workflow", not "I demoed". Even when the cells are written by Oracle on Chris's behalf, the artifact is for the team.

*Name attribution — be conservative.* Only attribute a statement by name when the transcript explicitly identifies the speaker for that specific statement. If the transcript shows a comment without a clear speaker tag, write it without naming anyone. Use neutral phrasing instead: "Team noted...", "Discussion covered...", or just state the fact directly. Don't infer who said something based on context, role, or which department the topic falls under. (The exception is action item ownership in Step 6 — for those, work harder to determine ownership because that's the operational point.)

**Example values array for the Strat section** (data rows 30-33):

```
values: [
  ["Beginning of month — 5 logged against 100 target. Discussion focused on May webinar attendees and food-sector contacts."],
  ["Green Jobs Initiative applied last week — brand new grant submitted just before close."],
  ["2 discovery calls logged so far this month."],
  ["Hiring decision imminent — down to 2 candidates, offer going out today."]
]
```

### Step 5 — Mark last week's action items

Find `LW_HEADER_ROW` (the "Action Items from last week" anchor) and `CW_HEADER_ROW` (the "Action Items for coming week" anchor) from Step 3.

Walk every row between `LW_HEADER_ROW + 1` and `CW_HEADER_ROW - 1`. For each row that has content in column A, search the transcript for evidence the item was completed.

**Build a single column E values array for the entire last-week range.** For each row:
- `"TRUE"` if transcript indicates clear completion
- `"FALSE"` if not done, blocked, ambiguous, or no mention
- `""` (empty string) for empty rows in the range (no item to mark)

Verify array length matches the row count, then write in one batch:

```
update_sheet_range({
  spreadsheet_id: "...",
  range: "'<tab>'!E<LW_HEADER_ROW + 1>:E<CW_HEADER_ROW - 1>",
  values: [["TRUE"], ["FALSE"], ...]
})
```

Never write to columns A-D of last-week's items.

If transcript mentions partial progress, default to `"FALSE"` and surface in the final summary.

### Step 6 — Propose coming-week action items

Find `CW_HEADER_ROW` (already located). Find `BOUNDARY_ROW`:
1. Walk forward from `CW_HEADER_ROW + 1`
2. Skip rows that have content in column A (these are pre-existing carry-forward items — don't overwrite)
3. The first row where column A is empty — call this `FIRST_WRITE_ROW`
4. Continue walking forward from `FIRST_WRITE_ROW`. The first row where column A is non-empty AGAIN is `BOUNDARY_ROW`.

Identify items the team committed to in the transcript (not aspirational discussion). Look for explicit commitments ("I'll handle X", "let's get Y done by Friday", "[name] is owning this").

Write items sequentially starting at `FIRST_WRITE_ROW`, one row at a time, no gaps. Stop before reaching `BOUNDARY_ROW`.

**Per-row writes for action items** (each row needs columns A through E):

```
update_sheet_range({
  spreadsheet_id: "...",
  range: "'<tab>'!A<row>:E<row>",
  values: [["description", "primary owner", "secondary owner", "due date", "FALSE"]]
})
```

One call per item. With 5-10 items typical per week, this is ~5-10 calls — well within iteration budget.

For each proposed item:
- A: short action description
- B: primary responsible party (use names from the transcript — Steph, Ruk, Natalie, Olivia, Souad, Chris, Delpreet — or department names: Strategy, GCs, Research, Marketing, AI)
- C: secondary responsible party if mentioned, else `""`
- D: due date if mentioned, else `""`
- E: `"FALSE"`

For action item ownership specifically, work harder than for general name attribution — the operational value of these rows is knowing who's doing what. If the transcript doesn't make ownership clear, infer from context (whoever raised the work, whoever owns the area) but be conservative: when truly ambiguous, leave column B `""` and surface the unassigned items in the final summary.

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

## Iteration budget

This workflow uses approximately 18-25 agent loop iterations:
- 2-3: tab metadata read + transcript fetch
- 1: full sheet read for section map
- 9: section batches for Oracle Notes (Company KPIs, Strat, GCs, Research, Marketing/Comms, AI, Finance, Grant Highlights, Quarterly Goals)
- 1: last-week action items batch
- 5-10: per-row writes for new coming-week items
- 1: final summary

Cross-reference lookups (HubSpot, web_search, search_getgranted) add iterations as needed but should be used sparingly — only when the transcript surfaces a verifiable claim worth checking.

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
- **Writing to header rows** — every section header row has column E that says "Oracle Notes" or is blank. Per-section batching with `data_start_row` (one row below the header) prevents this categorically.
- **Row numbers from memory** — never use a remembered row number. Always use the section map from the *current* tab.
- **First-person voice creep** — third-person always.
- **Over-attribution** — only name a speaker when the transcript explicitly tags them.
- **Cross-section batching** — never combine sections in one write call. The misalignment risk is the original v2 bug.
- **Array-length mismatch** — always verify `len(values) == (end_row - start_row + 1)` before writing. If it doesn't match, stop and report — don't write a misaligned batch.
- **Per-cell writes for column E** — don't. The iteration cost is too high (50+ iterations vs. budget of ~25). Section batches are the correct grain.
- **Bold formatting in writes** — Oracle's writes don't apply formatting; values land in whatever style the cell already has. If notes are coming out bold, the underlying cell formatting in the Template needs to be cleaned, not the skill.
