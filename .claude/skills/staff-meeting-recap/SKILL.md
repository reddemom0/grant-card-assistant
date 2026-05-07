---
name: staff-meeting-recap
description: Process a Granted weekly staff meeting end-to-end — pull the Granola transcript, cross-reference HubSpot/GG/web for verifiable claims, write per-line discussion notes to the Weekly Staff Meeting Google Sheet, mark last week's action items done/not-done, and propose coming-week action items. MUST use this skill whenever Chris or any team member asks to recap, process, populate, fill out, or write up a staff meeting, weekly meeting, or Tuesday meeting — even if they don't say "Oracle Notes" explicitly. Trigger phrases include "process the [date] meeting", "recap last Tuesday", "fill in the staff meeting notes", "write up the meeting", or any reference to "the staff meeting sheet".
---

# Staff Meeting Recap

Each week, the Granted team holds a staff meeting that's transcribed by Granola. The Weekly Staff Meeting Google Sheet has one tab per meeting, structured into department sections (Strat, GCs, Research, Marketing, AI, Finance) plus Company KPIs, Research Grant Highlights, Quarterly Goals, and action-item rows. Each tab has an "Oracle Notes" column at column E.

This skill runs the recap workflow: read the transcript, cross-reference what's verifiable, fill in per-line context for ~50 cells, update last week's action items, and propose coming-week items.

## When this skill triggers

- "Process the [date] staff meeting" / "recap [date]'s meeting"
- "Fill in the meeting notes for [date]"
- "Write up Tuesday's meeting"
- Any request that references the staff meeting sheet and a date

If the user gives a relative reference ("last Tuesday", "this week's") without a specific date, resolve it before proceeding. If genuinely ambiguous, ask which meeting.

## Inputs

**Spreadsheet:** Always `1SGZ0HombWMiOI7k_oAL3m9nfMXK2LU1NnLpUOIOaEaA` (Weekly Staff Meeting). This is fixed — don't ask the user.

**Tab naming:** Tabs are named like "May 6, 2026" but formatting varies. Some have leading spaces (" April 29,2026"), some have "th" suffix on the day ("April 22nd 2026"), comma placement varies. Match by date components, not exact string.

## Workflow

### Step 1 — Find the meeting tab

Use `read_sheet_metadata` with the spreadsheet ID to get the spreadsheet title and the list of all tabs. Match the user's date against tab names liberally (date components, not exact string).

If no matching tab exists, stop and tell the user the tab needs to be created first. Example response: "I don't see a tab for May 13, 2026 yet. Once someone duplicates the Template tab and names it, I can populate it." Don't try to create the tab — humans handle weekly tab creation.

Save the resolved tab name for use in all subsequent range arguments. Tab names containing spaces or special characters need single quotes when used in A1 ranges: `'May 6, 2026'!E20`.

### Step 2 — Pull the Granola transcript

Use `granola_list_meetings` with a 24-hour window covering the meeting date. Match on title — typically "Granted Staff Meeting" or "Weekly Staff Meeting". If no match for that day, try ±1 day (timezone shifts sometimes misdate recordings).

If multiple meetings match, prefer the longest. If none match after the ±1 day check, stop and tell the user.

Then `granola_get_meeting_transcript` for the verbatim transcript. Verbatim is preferred over enhanced notes — accuracy on action items and quoted claims matters more than polish.

### Step 3 — Read the current state of the tab

Use `read_sheet_range` for `'<tab>'!A19:E101` in one call. This captures every section header, every line item label, and the current state of all Oracle Notes cells and action item rows. Use this as your reference throughout the rest of the workflow rather than re-reading.

### Step 3.5 — Validate Template structure

Before writing any cells, confirm the row layout matches expected. Check that column A of each row contains the expected label:

- Row 19: starts with "Company KPIs"
- Row 29: "Strat"
- Row 34: "GCs"
- Row 44: "Research"
- Row 49: "Marketing/Communications"
- Row 59: "AI"
- Row 62: "Finance"
- Row 71: starts with "Research Grant Highlights"
- Row 75: "Quarterly Goals"
- Row 84: starts with "Action Items from last week"
- Row 92: starts with "Action Items for coming week"

Match leniently — case-insensitive and whitespace-tolerant. If any check fails, stop and tell the user: "The Template structure has changed since this skill was written. Section [X] is no longer at row [N]. The skill needs an update before I can reliably populate the tab." Don't try to guess or write to wrong rows — surface the drift.

### Step 4 — Fill the Oracle Notes cells (the reasoning step)

This is the substantive part of the workflow. Oracle is writing context to up to ~50 cells across 9 sections. Not every cell gets filled — for each cell, decide between three outcomes:

1. **The line item was discussed in the transcript.** Write what was said, in Oracle's voice (third-person objective). Include who flagged what if it's relevant. Keep it tight — one or two sentences usually.

2. **The line item wasn't discussed, but Oracle has cross-reference data worth surfacing.** Write the cross-ref note, prefixed with `(no team discussion — context from HubSpot/GG)` or `(no team discussion — context from web)`. Examples: pipeline counts that contradict the actual reported number, recent news about a funder, GG database matches for a highlighted grant.

3. **Nothing relevant either way.** Leave blank. Don't fill cells just because they're there.

Cells to consider, by section:

| Section | Header cell | Per-line cells Oracle writes to | Notes |
|---|---|---|---|
| Company KPIs | E19 (skip — header) | E20:E26 | KPI rows: Monthly Subs, Pending Approvals, New Clients, Renewals, Pipeline |
| Strat | E29 (skip) | E30:E33 | Outreach/Leads, New Grants, 20 DCs, Challenges/Support |
| GCs | E34 (skip) | E35:E43 | Deal stages, training stages, hiring stages, vetting, claims, Challenges |
| Research | E44 (skip) | E45:E48 | New Grants, Updates, Funder Reachouts, Challenges |
| Marketing/Comms | E49 (skip) | E50:E58 | Calculator subs, Pro/Online, LinkedIn, Blogs, Elivated, Challenges. **Skip E53 and E55 — empty-label sub-rows of E52 and E54.** |
| AI | E59 (skip) | E60:E61 | Single data row + Challenges. AI section has Chris demoing/discussing AI work — write objectively ("Chris demoed X", not "I demoed X") |
| Finance | E62 (skip) | E63:E69 | Multiple data rows + Challenges |
| Research Grant Highlights | E71 (skip) | E72:E74 | Per-grant cells. Cross-reference each highlighted grant against GG database AND web search; combine with team commentary if the grant was discussed |
| Quarterly Goals | E75 (skip) | E76:E82 | Per-quarterly-metric context |

The header cells (E19, E29, E34, E44, E49, E59, E62, E71, E75) already say "Oracle Notes" in the Template — don't overwrite those.

**Cross-reference behavior.** When the transcript mentions a verifiable claim, look it up:
- Deal/company claims → `search_grant_applications` (with `company_name`) or `search_hubspot_companies` (with `query`)
- Pipeline counts / deal-stage queries → `search_grant_applications` with `dealstage` and `pipeline` filters. Note: HubSpot deals in this codebase are surfaced as "grant applications" — there's no `search_hubspot_deals` tool.
- Grant lookups → `search_getgranted`, plus `web_search` if context warrants
- Highlighted grants → `search_getgranted` (have we seen it? similar funders we work with?) AND `web_search` (recent program changes, deadlines, news)

When the transcript matches reality, write the note as stated. When it contradicts, write the note AND flag the contradiction inline. Don't quietly correct — surface disagreements so humans can resolve.

**Example cell content:**

> E20 (Monthly Submissions): "Steph reported 12 submissions to date, on track for monthly target. Discussion focused on pushing remaining 4 by month-end."

> E30 (Strat - Outreach/Leads): "(no team discussion — context from HubSpot) 47 outreach activities logged this month against 100 target."

> E72 (Research Grant Highlights): "BC Employer Training Grant featured. GG database shows 3 active clients pursuing this; Steph noted strong fit for manufacturing leads. Web check: program reopened May 1 with $300K cap unchanged."

**Voice rule:** Third-person objective throughout, including the AI section. "Chris demoed the new workflow" not "I demoed". Even when the cells are written by Oracle on Chris's behalf, the artifact is for the team.

**Write strategy:** Build the full set of cell updates first (in memory), then write in batches. Use `update_sheet_range` for the full E20:E82 range with an array of values rather than 50 individual calls. For ranges with skips (like E50:E58 where E53 and E55 are blank), pass empty strings for skipped rows so the existing content isn't disturbed. Note that batch ranges include the section-header rows (E29, E34, etc.) — pass empty strings for those too so the "Oracle Notes" headers aren't overwritten.

### Step 5 — Mark last week's action items

Read the action items rows (already captured in Step 3, A85:E91). Each row has: A=description, B=responsibility, C=2nd responsibility, D=due date, E=Done? (boolean).

For each non-empty row, search the transcript for evidence the item was completed, in progress, or blocked. Update column E:
- `TRUE` if the transcript indicates completion
- `FALSE` if not done, blocked, or no mention

Write column E only — don't touch columns A-D of last week's items. Use `update_sheet_range` with range `'<tab>'!E85:E91` and a single column of values.

If there's ambiguity — e.g., transcript mentions partial progress — default to `FALSE` and surface it in the final summary. Don't mark `TRUE` unless there's clear evidence of completion.

### Step 6 — Propose coming-week action items

The coming-week rows are A93:E101 — A=description, B=responsibility, C=2nd responsibility, D=due date, E=Done? (FALSE for new items).

From the transcript, identify items the team committed to for the coming week. Look for explicit commitments ("I'll handle X", "let's get Y done by Friday") rather than aspirational discussion.

Don't overwrite rows that already have content. Find the first empty row (E93+) and write proposed items starting there. Stop at row 101 — if there are more items than rows, surface the overflow in the final summary rather than truncating silently.

For each proposed item:
- A: short action description
- B: primary responsible party (use names from the transcript: Steph, Ruk, Natalie, etc., or department names: Strategy, GCs, Research)
- C: secondary responsible party if mentioned, else blank
- D: due date if mentioned, else blank
- E: FALSE

Write with `update_sheet_range` using range `'<tab>'!A93:E101`.

### Step 7 — Final summary

After all writes complete, summarize for the user:
- Tab populated and date
- Count of Oracle Notes cells filled (e.g., "Filled 31 of ~50 candidate cells; rest left blank because not discussed and no relevant cross-ref")
- Any contradictions flagged during cross-reference
- Any action items marked differently than they currently appeared (e.g., "Marked R86 'Update marketing dashboard' as done based on Steph mentioning shipped Tuesday")
- Any proposed coming-week items that didn't fit (overflow past row 101)

Don't enumerate every cell — the user can read the sheet. Surface the parts that need human attention.

## Out of scope

- The Identify/Discuss/Solve section at row 109+ — skip entirely.
- Tab creation or duplication — humans handle this before invoking the workflow.
- Old tabs that predate the Oracle Notes column — only process tabs duplicated from the current Template.
- The Bravo Card row (115).
- Retroactive backfilling of historical tabs.
- Modifying the Template tab itself.

## Common failure modes

- **Tab name mismatch** — the date is right but the tab name has irregular spacing/punctuation. Always match on date components, not exact string.
- **No Granola meeting found** — the staff meeting may be recorded under a slightly different title or the wrong date due to timezone. Try ±1 day before giving up.
- **Sparse transcripts** — if the transcript is under ~500 words, the recap will be thin. Tell the user before writing notes.
- **Cross-reference timeouts** — if a HubSpot lookup or web search fails, write the note without verification rather than blocking. Note the unverified status.
- **Filling cells with filler** — if there's no discussion AND no relevant cross-ref, leave the cell blank. Don't write "No discussion this week" in 30 cells.
- **First-person voice creep** — when summarizing AI section content where Chris was the speaker, the temptation is to write "I" or "we" — always third-person.
- **Template drift** — if the validation step (3.5) fails, stop and surface the drift. Don't write to wrong rows.
