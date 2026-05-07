---
name: staff-meeting-recap
description: Process a Granted weekly staff meeting end-to-end — pull the Granola transcript, cross-reference HubSpot/GG/web for verifiable claims, write per-line discussion notes to the Weekly Staff Meeting Google Sheet, mark last week's action items done/not-done, and propose coming-week action items. MUST use this skill whenever Chris or any team member asks to recap, process, populate, fill out, or write up a staff meeting, weekly meeting, or Tuesday meeting — even if they don't say "Oracle Notes" explicitly. Trigger phrases include "process the [date] meeting", "recap last Tuesday", "fill in the staff meeting notes", "write up the meeting", or any reference to "the staff meeting sheet".
---

# Staff Meeting Recap

Each week, the Granted team holds a staff meeting that's transcribed by Granola. The Weekly Staff Meeting Google Sheet has one tab per meeting, structured into department sections (Strat, GCs, Research, Marketing/Communications, AI, Finance) plus Company KPIs, Research Grant Highlights, Quarterly Goals, and action-item sections. Each tab has an "Oracle Notes" column at column E.

This skill runs the recap workflow: read the transcript, cross-reference what's verifiable, fill in per-line context for the data rows of each section, update last week's action items, and propose coming-week items.

## Critical principle: anchor by label, never by row number

Row numbers in the sheet shift week to week — the team adds or removes action items, edits the Template, etc. **Never assume any section sits at a fixed row.** Always find sections at runtime by reading column A and matching the section's label.

The only fixed identifier is the spreadsheet ID itself. Everything else is discovered live.

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

### Step 3 — Read the tab and build a section map

Use `read_sheet_range` to read column A and column E of the entire tab in one call: `'<tab>'!A1:E125`. (Reading to row 125 ensures the Bravo Card row at the bottom is captured regardless of how many action item rows the team added.)

Walk column A and identify the row of every recognized anchor label below. This produces the section map for this specific tab.

**Section header anchors** (rows where Oracle never writes to column E — these are headers):

- "Company KPIs" (column A starts with this — there's usually a month parenthetical)
- "Strat"
- "GCs"
- "Research"
- "Marketing/Communications"
- "AI"
- "Finance"
- "Research Grant Highlights of the Week"
- "Quarterly Goals"
- "Departmental KPIs for this month"
- Any row where column A is empty AND column B contains "Target" or "Benchmark" (these are sub-header rows like the "Target / Actual" row that sits between Departmental KPIs and Strat)

**Action item anchors:**

- "Action Items from last week" — start of last-week section
- "Action Items for coming week" — start of coming-week section (also marks end of last-week section)
- "Customer Headlines" — end of coming-week section (Oracle must never write at or below this row)

If any of these anchors are missing, stop and tell the user the Template structure has changed: "I can't find a row labeled '[X]' — the Template structure has changed since this skill was written and I need to be updated before I can populate this tab reliably."

### Step 4 — Fill the Oracle Notes cells (the reasoning step)

For each department section identified in Step 3, the **data rows** are every row between its header and the next recognized header (whether that's another department header, an action-items anchor, or the column-A-empty/column-B-Target sub-header rows).

For each data row in each section, decide between three outcomes:

1. **The line item was discussed in the transcript.** Write what was said in column E for that row, in Oracle's voice (third-person objective). Keep it tight — one or two sentences usually.

2. **The line item wasn't discussed, but Oracle has cross-reference data worth surfacing.** Write the cross-ref note in column E, prefixed with `(no team discussion — context from HubSpot/GG)` or `(no team discussion — context from web)`. Examples: pipeline counts that contradict the actual reported number, recent news about a funder, GG database matches for a highlighted grant.

3. **Nothing relevant either way.** Leave column E blank. Don't fill cells just because they're there.

**Header row protection.** Every section header row identified in Step 3 has column E left untouched. The Template seeds those cells with the literal text "Oracle Notes" — don't overwrite that. If column E of a header row is somehow blank, still don't write to it.

**Empty-label rows.** Some sections have rows where column A is empty but column B/C/D have data — these are continuation rows of the row above (e.g., LinkedIn metric breakdowns under "LinkedIn - last 7 days", or sub-rows under "Online Services"). Skip these. The discussion context belongs in the parent row's column E.

**Cross-reference behavior.** When the transcript mentions a verifiable claim, look it up:
- Deal/company claims → `search_grant_applications` (with `company_name`) or `search_hubspot_companies` (with `query`)
- Pipeline counts / deal-stage queries → `search_grant_applications` with `dealstage` and `pipeline` filters. Note: HubSpot deals in this codebase are surfaced as "grant applications" — there's no `search_hubspot_deals` tool.
- Grant lookups → `search_getgranted`, plus `web_search` if context warrants
- Highlighted grants → `search_getgranted` (have we seen it? similar funders we work with?) AND `web_search` (recent program changes, deadlines, news)

When the transcript matches reality, write the note as stated. When it contradicts, write the note AND flag the contradiction inline. Don't quietly correct — surface disagreements so humans can resolve.

**Voice rules.**

*Third-person objective throughout.* "Chris demoed the new workflow", not "I demoed". Even when the cells are written by Oracle on Chris's behalf, the artifact is for the team.

*Name attribution — be conservative.* Only attribute a statement by name when the transcript explicitly identifies the speaker for that specific statement. If the transcript shows a comment without a clear speaker tag, write it without naming anyone. Use neutral phrasing instead: "Team noted...", "Discussion covered...", or just state the fact directly. Don't infer who said something based on context, role, or which department the topic falls under. (The exception is action item ownership in Step 6 — for those, work harder to determine ownership because that's the operational point.)

**Example cell content:**

> Monthly Submissions row: "Q4 began this week — $50 actual against $100K monthly target. Heavy reliance on M/E grants this quarter; 2-3 RTRIs and 2 CanExports expected."

> Strat - Outreach/Leads row: "(no team discussion — context from HubSpot) 5 outreach activities logged this month against 100 target."

> Research Grant Highlights row: "Graduate to Opportunity Innovate (GTO Innovate) confirmed as brand new — Nova Scotia hiring subsidy for master's/PhD grads, up to $31K, financial support for 2 years. GG database has 0 matches; net-new program."

**Write strategy.** Build the full set of cell updates first (in memory), then write column E in one batch using `update_sheet_range` with a range covering all the data rows. For ranges that span multiple sections, pass empty strings for header rows, empty-label continuation rows, and rows where Oracle decided to leave the cell blank — those values won't disturb existing content because they're explicitly empty. Confirm via the section map from Step 3 that header rows get empty-string values, never content.

### Step 5 — Mark last week's action items

Find the "Action Items from last week" row (located in Step 3). The action item rows are every row between this anchor and the "Action Items for coming week" anchor. Skip any row in this range where column A is empty (no item to mark).

For each row that has content in column A, search the transcript for evidence the item was completed, in progress, or blocked. Update column E only:
- `TRUE` if the transcript indicates clear completion
- `FALSE` if not done, blocked, ambiguous, or no mention

Never write to columns A-D of last-week's items. Use `update_sheet_range` with a range targeting just column E of those rows.

If transcript mentions partial progress, default to `FALSE` and surface it in the final summary. Don't mark `TRUE` unless there's clear evidence of completion.

### Step 6 — Propose coming-week action items

Find the "Action Items for coming week" anchor (located in Step 3) and the "Customer Headlines" anchor (the boundary).

The coming-week section is every row between these two anchors. Some rows in this section may already have content (e.g., a carry-forward item from the Template, or items that were typed in pre-meeting). Don't overwrite rows that already have content in column A.

Find the first empty row below the "Action Items for coming week" anchor and below any pre-existing items. Write proposed new items starting there. Stop before reaching the "Customer Headlines" row.

For each proposed item:
- A: short action description
- B: primary responsible party (use names from the transcript — Steph, Ruk, Natalie, Olivia, Souad, Chris, Delpreet — or department names: Strategy, GCs, Research, Marketing, AI)
- C: secondary responsible party if mentioned, else blank
- D: due date if mentioned, else blank
- E: FALSE

Identify items the team committed to, not aspirational discussion. Look for explicit commitments ("I'll handle X", "let's get Y done by Friday", "[name] is owning this").

For action item ownership specifically, work harder than for general name attribution — the operational value of these rows is knowing who's doing what. If the transcript doesn't make ownership clear, infer from the context (whoever raised the work, whoever owns the area) but be conservative: when truly ambiguous, leave column B blank and surface the unassigned items in the final summary.

If there are more proposed items than rows available before "Customer Headlines", list the overflow in the final summary rather than truncating silently. Don't insert new rows or push other content down.

Use `update_sheet_range` with a range targeting just the rows being added (A:E of the empty rows in the coming-week section).

### Step 7 — Final summary

After all writes complete, summarize for the user:

- Tab populated and date
- Count of Oracle Notes cells filled (e.g., "Filled 31 cells; rest left blank because not discussed and no relevant cross-ref")
- Any contradictions flagged during cross-reference
- Any action items marked differently than they currently appeared
- Any unassigned coming-week items (column B blank)
- Any proposed coming-week items that didn't fit (overflow before Customer Headlines)

Don't enumerate every cell — the user can read the sheet. Surface the parts that need human attention.

## Out of scope

- The Identify/Discuss/Solve section — skip entirely.
- Tab creation or duplication — humans handle this before invoking the workflow.
- Old tabs that predate the Oracle Notes column — only process tabs duplicated from the current Template.
- The Bravo Card row.
- Retroactive backfilling of historical tabs.
- Modifying the Template tab itself.

## Common failure modes

- **Tab name mismatch** — the date is right but the tab name has irregular spacing/punctuation. Always match on date components, not exact string. If the user gave an exact tab name, use that exact name.
- **No Granola meeting found** — the staff meeting may be recorded under a slightly different title or the wrong date due to timezone. Try ±1 day before giving up.
- **Sparse transcripts** — if the transcript is under ~500 words, the recap will be thin. Tell the user before writing notes.
- **Cross-reference timeouts** — if a HubSpot lookup or web search fails, write the note without verification rather than blocking. Note the unverified status.
- **Filling cells with filler** — if there's no discussion AND no relevant cross-ref, leave the cell blank. Don't write "No discussion this week" in 30 cells.
- **Writing to header rows** — every section header row (Strat, GCs, Company KPIs, etc.) has column E that says "Oracle Notes" or is blank. Don't overwrite. Verify against the section map from Step 3 before writing.
- **Row numbers from memory** — never use a remembered row number from a previous run. Always use the section map from Step 3 of the *current* tab.
- **First-person voice creep** — when summarizing AI section content where Chris was the speaker, the temptation is to write "I" or "we" — always third-person.
- **Over-attribution** — only name a speaker when the transcript explicitly tags them for that statement. Default to neutral phrasing.
