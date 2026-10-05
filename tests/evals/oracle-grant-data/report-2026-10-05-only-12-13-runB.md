# Oracle grant-data eval — 2026-10-05

**Pass rate:** 1/2 graded (50%) — subset: 12, 13
**Oracle model:** claude-sonnet-5-5
**Cost:** $0.11 (Oracle $0.10, grader $0.02 on claude-sonnet-4-6)
**Started:** 2026-10-05T10:50:04.466Z · **Runtime:** 0.6 min

**Read-only proof**
- Database session: default_transaction_read_only = on (checked before the first question)
- Side-effect tool calls blocked: none attempted
- Writes rejected by the read-only session (SQLSTATE 25006): 0
- Messages, the team-notes audit row and cost rows go to in-memory stubs; nothing reaches the messages table.
- Test user has no account: OAuth-backed reads (Drive, Sheets, Calendar, Chat history) are unavailable.

A question passes when every applicable rule check passes and the grader passes. A grader reply that can't be read is a grader error, left out of the pass rate.

| # | Category | Result | Failed checks | Grader | Cost | Tools |
|---|---|---|---|---|---|---|
| 12 | mismatch | FAIL | mismatch_both_shown | fail: Oracle states the program is open as fact and says GG3 is 'out of date', violating the rule against stating active/open as fact or indicating which system is wrong. | $0.050 | grant_data, web_search |
| 13 | mismatch | PASS | — | pass: Checked official page with date first, then GG3 (archived) and GG1 (active) statuses, noted mismatch, stated data freshness, gave no verdict on which system is correct. | $0.063 | grant_data, web_search |

## Failures

### Q12 (mismatch): Is the Agricultural Water Infrastructure Program Stream 2 active?
- **mismatch_both_shown:** declares a verdict: "GetGranted card is out of date"
- **Grader:** Oracle states the program is open as fact and says GG3 is 'out of date', violating the rule against stating active/open as fact or indicating which system is wrong.

> **Short answer:** Yes. The funder's own page says Stream 2 is open, and our GetGranted card is out of date.
> 
> **Official page (IAF, indexed 3 days ago):**
> - Applications for Stream 2: Community Projects are open.
> - Applications close on October 29, 2026.
> - Funding is up to $21M in total, with a $2M maximum per project and a 50% cost-share.
> - The [IAF Stream 2 page](https://iafbc.ca/agriculture-water-infrastructure-program/stream-2/) says it is reopening on October 1. That matches the main page's open status. I didn't see the main page's full text, so confirm the exact open date on the IAF site.
> 
> **GetGranted (data as of Oct 5, 2026, 10:42 UTC):**
> - The [Stream 2 card](https://app.getgranted.ai/grants/1425) is listed as **inactive**, with a deadline of 31/07/2023 and a $2M maximum.
> - GG1 lists the same grant as **active**, so GG1 and GG3 disagree on its status.
> - The card's deadline is from 2023, so it doesn't reflect the current intake.
> 
> **Caveat:** The search snippets are my only view of the IAF pages. Check the [IAF program page](https://iafbc.ca/agriculture-water-infrastructure-program/) for eligibility and intake details before telling a client.
> 
> Would you like me to:
> 1. Pull th

## Rule checks, all questions

| # | links | no_internal_names | no_total_count | mismatch_both_shown | freshness_checked | no_false_absence |
|---|---|---|---|---|---|---|
| 12 | pass | pass | pass | fail | pass | pass |
| 13 | pass | pass | pass | pass | pass | pass |

Re-run: `node tests/evals/oracle-grant-data/run.mjs` (one question set: `--only 9,12`).
