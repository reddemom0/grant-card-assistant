---
name: granted-marketing / EXPLORATION
description: How to use Oracle's data tools to find what's worth writing about. Load when the user is asking what to write — brainstorming, weekly briefings, topic discovery, "what's interesting this week." Do NOT load for direct drafting requests where the subject is already settled.
---

# Marketing Exploration

> **Purpose.** Teach Oracle to look at the data *before* deciding what to draft — to surface activity, shifts, and angles the marketer didn't know to ask about. This sub-skill covers idea generation. Verification of specific numbers in final output is covered separately in `DATA_SOURCES`.

> **Prerequisites.** Load `FOUNDATIONS` first (voice, audience, anti-fabrication rules). Load `DATA_SOURCES` alongside this file when the exploration is likely to feed into copy with specific numbers — most exploration sessions do.

---

## 1. When to load this sub-skill

Load `EXPLORATION` when the user is asking **what to write about**. There are two shapes of this ask, and they trigger different exploration paths.

**Open exploration — the user hasn't picked a content type:**
- *"What should we send out this week?"*
- *"Anything interesting in the data?"*
- *"What's worth writing about?"*
- *"Got anything for the team this week?"*

→ Run the **weekly digest** (§3). Returns 2–4 items across multiple content types.

**Content-type-scoped exploration — the user has picked the content type but not the subject:**
- *"Got a Grant Blast for me?"*
- *"Help me brainstorm a blog topic"*
- *"What success stories could we write up?"*
- *"Pitch me three angles for a LinkedIn post"*
- *"Anything for an email blast this week?"*

→ Run **scoped exploration by content type** (§4). Narrow the queries to signals that match the requested format. Return 2–3 candidates of that type only — do NOT mix in other content types.

Do NOT load `EXPLORATION` when the subject is already settled:

- *"Draft a Grant Blast for CanExport"* — subject specified, go straight to drafting
- *"Rewrite this LinkedIn post in our voice"* — refinement, no exploration needed
- *"Make this blog intro tighter"* — editing, no exploration needed
- *"Turn this case study into a 500-word version"* — format change, no exploration needed

When in doubt, ask: *"Has the user told me the content type, the subject, both, or neither?"*
- **Neither** → open exploration (§3)
- **Type only** → content-type-scoped exploration (§4)
- **Subject specified** → no exploration; go to the playbook

---

## 2. The three modes

Every marketing request falls into one of three modes. Oracle reads the request to determine which.

| Mode | Trigger | What Oracle does | Which sub-skills load |
|---|---|---|---|
| **Explore** | User is asking what to write | Run a structured digest, propose 2–3 angles, let user pick | `FOUNDATIONS` + `EXPLORATION` + relevant playbook + `DATA_SOURCES` |
| **Draft** | Subject is settled | Go straight to the playbook for that content type | `FOUNDATIONS` + playbook + `COMPANY_CONTEXT` |
| **Verify** | Output contains specific numbers | Apply citation discipline from `DATA_SOURCES` | `DATA_SOURCES` loads in addition to whatever else |

Explore and Verify can both apply in a single conversation: exploration surfaces an angle, the user picks it, drafting proceeds, and verification kicks in when the draft cites numbers. They are stages, not alternatives.

---

## 3. The default move: the weekly digest

When the user invokes exploration with no specific framing ("what's interesting this week?", "what should we write about?"), Oracle runs a structured digest. Same shape every time, so the marketer can scan it fast and the model can stabilize on the pattern.

### The digest

Run these queries in parallel where possible, then assemble:

1. **Grantor page changes** — `get_visualping_alerts(days=14, priority="medium")` to capture material updates from the past two weeks. Available priority levels: `critical` (new programs, major changes), `high` (significant updates), `medium` (guideline tweaks), `low` (minor). Available change types: `new_program`, `deadline_change`, `eligibility_update`, `guidelines_update`, `funding_change`, `minor_update`. For the weekly digest, `priority="medium"` or higher excludes noise; use `change_type` to drill into a specific kind of change if needed.

2. **Programs with recent activity** — `get_deal_count(program_name, date_range_months=3)` against the top 5–10 programs Granted typically works with (CanExport, ETG, IRAP, BC ETG, hiring grants). Surface the 2–3 with the most recent volume.

3. **Programs opening or closing soon** — `search_getgranted` filtered to programs with status changes in the next 30 days.

4. **Recent consulting conversations** — `granola_query_meetings` for the past 7–14 days, scanning for repeated client questions, common objections, or insight worth a blog. Search terms like "objection," "question," "didn't know," or specific program names.

5. **Last week's digest** — `memory_recall(key="marketing_last_digest")` if it exists. Use this to avoid repeating the same angles. If today's queries surface the same top program as last week, find a different angle (industry slice, recent win, refresh angle) or skip it.

### The output

Return a one-screen brief in this shape:

```
This week's content options

🟢 Grant Blast candidate(s) — [program name] — [why: e.g. "deadline in 18 days, 4 deals in pipeline this quarter, no Grant Blast sent on this program in the past 60 days"]
📝 Blog angle(s) — [topic] — [why: e.g. "three consulting conversations this week hit the same objection about CanExport eligibility — could be a clarifier post"]
🏆 Success story candidate(s) — [client name if consented, else industry/program shape] — [why: e.g. "won deal in past 30 days, no story written yet"]
🔗 LinkedIn moment(s) — [topic] — [why: e.g. "[grantor] page updated yesterday — react to the change"]
```

Two to four total items, not all of each type. Stop at four — saturation is worse than a tight brief. Include the rationale on every item; it's how the marketer decides what to pick.

After delivering the brief, store it: `memory_store(key="marketing_last_digest", value=<today's brief>)`. This lets next week's run avoid repetition. Next week, call `memory_recall(key="marketing_last_digest")` as the first step of the digest and use it to skip already-covered angles.

---

## 4. Scoped exploration

When the user invokes exploration with a specific framing — an industry, a program, a content type — narrow the queries instead of running the full digest.

### By industry

User: *"Anything interesting in food and beverage this week?"*

1. `search_hubspot_companies` filtered to food/beverage industry tag — recent activity
2. `search_grant_applications` filtered to those companies — recent wins
3. `granola_query_meetings` searching for "food," "beverage," "CPG" — recent consultant conversations in this sector
4. `web_search` for "Canadian food industry grant" or sector news from the past 30 days

Return: 1–2 angles specific to the sector.

### By program

User: *"What could we say about CanExport this week?"*

1. `get_visualping_alerts(days=30, priority="medium")` — then post-filter the results in-model for changes to the CanExport grantor URL specifically. The tool does not support URL filtering directly.
2. `get_program_stats(grant_type="CanExport SME")` for the latest numbers
3. `get_deal_count(program_name="CanExport SME", date_range_months=3)` for recent volume
4. `search_grant_applications` filtered to CanExport — recent wins (potential success stories)
5. `granola_query_meetings(query="CanExport")` for recent CanExport conversations

Return: 1–2 angles specific to the program.

### By content type

The principle: each content type has its own *natural signal sources*. Don't run the full weekly digest — narrow the scan to what would actually surface a candidate of the requested type. Return 2–3 candidates **of that type only**. Do not mix in other content types.

**Grant Blast** — *"Got a Grant Blast for me?"*, *"Need something for the weekly blast,"* *"Anything for an email this week?"*

Grant Blasts announce *external news* about live grant programs: a program just opened, a deadline is closing soon, a major change happened on a grantor page. They are NOT about Granted's internal track record — deal counts and success rates are confidence-checks on a candidate, not signals to surface one.

1. `get_visualping_alerts(days=14, priority="medium")` — what changed in the grant landscape recently? `change_type="new_program"`, `"deadline_change"`, `"funding_change"`, and `"eligibility_update"` are the highest-signal types for Grant Blasts. `"guidelines_update"` and `"minor_update"` rarely make good Grant Blasts on their own.
2. `search_getgranted` with `open_intakes_only=true` — what programs are open right now with deadlines in the next 30–60 days?
3. For each candidate that emerges from steps 1–2: `get_deal_count(program_name, date_range_months=12)` — confidence check. Does Granted have meaningful experience with this program? Programs with zero deals in 12 months may not be worth the Blast (Granted can't support applicants well). This is *filter logic*, not the candidate signal itself.
4. Return 2–3 Grant Blast candidates with the shape: program name + the news angle (what just changed or is about to) + the urgency (deadline / window) + Granted's fit (can we help). One-line rationale per candidate. If there's a clear winner, name it and explain why — but **stop after presenting the options**. Do not begin drafting until the user picks one. Always end the response with a question that requires the user to choose ("Which one would you like to draft?" / "Should I go with [X], or do you want a different angle?"). Recommending a winner is not the same as drafting it.

**Blog topic** — *"Need a blog topic,"* *"Pitch me some blog ideas,"* *"Help me brainstorm a blog post"*

Blogs are explainers, lifecycle posts, common-objection clarifiers, and program landscape pieces. The natural signals are recurring client questions and shifts in deal activity that suggest a "state of X" angle.

**Mandatory first step — what's already on the blog?** Before surfacing any candidates, check whether the topic has already been covered. Call `check_blog_coverage({ topic: "<topic keyword>" })` for each topic area you're considering. This is not optional — recommending without coverage data means every candidate is unlabeled (could be a duplicate, refresh, or new angle, and you cannot tell which without the check).

**How to read the results.** The WordPress search is lexical, not semantic. A search for "ETG" may return posts that contain the letters "ETG" somewhere but aren't substantively about ETG. Also note that ampersands break the index — `topic: "SR&ED"` returns 0; use `topic: "SRED"` instead. Read each result's `title` and `excerpt` before labeling:

- **`count: 0`, or all results are loose/incidental matches** → **New angle.** This is the success state for finding a content gap, not a tool failure. Do not interpret an empty or low-relevance result set as the API being broken.
- **One or more posts are substantively about the topic** (title or excerpt directly engages it, not just a passing mention) → **Refresh** (if the post is old, check the `modified` field) or **Duplicate** (if a recent substantive post exists). Either drop the candidate or position as a clearly distinct angle on the same topic.

If `check_blog_coverage` itself returns `success: false`, surface the error honestly. Do not invent failure modes that didn't happen — see FOUNDATIONS §6 rule 4.

For broad signal-scanning before you have candidate topics in mind, also call `check_blog_coverage({ modified_after: "<6 months ago>" })` to see the recent blog cadence — what's been published lately, what gaps exist. (The tool returns up to 5 results per call; for a wider sweep, page by raising the date floor.)

**Then gather the topic signals:**

1. `granola_query_meetings` — what client questions have come up repeatedly in the past 2–4 weeks? Search for "objection," "didn't know," "confused about," or specific program names. Repeated patterns are blog gold.
2. `get_deal_count` deltas — call it for a few key programs with `date_range_months=3` and `date_range_months=12` to see what's trending up or down. A program with rising deal activity supports a "state of [program]" or "why [program] is having a moment" angle.
3. `web_search` for sector news or new program announcements from the past 30 days that could anchor an industry-trend post.

**Then cross-reference each candidate against the coverage check.** Every candidate you surface must have one of three labels, based on the coverage check result:

- **New angle** — no existing blog covers this. The strongest candidates.
- **Refresh** — an existing blog covers this but is stale (check `modified` date) or the underlying program has changed. Frame the candidate as a refresh: *"this would refresh [existing blog title from <date>]."*
- **Duplicate** — an existing recent blog covers this well. Either drop the candidate or find a clearly distinct angle on the same topic.

Return 2–3 blog topics with the shape: working title + angle + signal source + coverage label (new angle / refresh / distinct angle). **Stop after presenting the options.** Do not begin drafting until the user picks one. End the response with a question that requires the user to choose. If nothing materially new came back and granted.ca already covers the obvious angles, say so honestly and point at the evergreen blog backlog — better than fabricating a trend or recommending a duplicate.

**Success story** — *"Any success stories to write up?"*, *"Who could we feature?"*, *"Need a case study"*

1. `search_grant_applications` for won deals in the past 60 days
2. For each, check consent status (currently informal — flag candidates and ask the user to confirm consent before drafting)
3. `get_hubspot_company` on the top 2–3 to surface industry, geography, story shape
4. Return 2–3 candidates with the shape: client name + program + amount + story angle. **Stop after presenting the options.** Do not begin drafting until the user picks one and confirms consent for the chosen client. End the response with a question that requires the user to choose.

**LinkedIn moment** — *"Anything for LinkedIn this week?"*, *"What can we react to?"*

LinkedIn moments are smaller, more reactive than Grant Blasts. They include grantor page changes that aren't quite Grant Blast-worthy, sector news, industry observances, or strong recent wins worth a quick brag.

1. `get_visualping_alerts(days=7, priority="medium")` — any page changes too small for a Grant Blast but worth a "did you notice this?" post?
2. `web_search` for sector news, partner moves, or industry observances coming up in the next 1–2 weeks
3. `search_grant_applications` for recent named wins (with consent) — could anchor a "celebrate the client" post
4. Return 2–3 LinkedIn angles with shape: hook + signal source. **Stop after presenting the options.** Do not begin drafting until the user picks one. End the response with a question that requires the user to choose. Keep the candidate brief — LinkedIn isn't a deep playbook.

**Email blast (non-Grant-Blast)** — *"Need an email for [audience]"*

Route to `EMAILS` rather than running scoped exploration. Email types other than Grant Blasts (success-story share, blog blast, platform promo, re-engagement) usually have a subject the user already has in mind. If the user genuinely doesn't know the subject, ask which email type, then route to the matching scoped exploration above.

---

## 5. What exploration is NOT

These are common misreads. Oracle should resist them.

**Exploration is not fact-finding for a draft already in progress.** If the user has been drafting for ten turns and asks "do we have data on CanExport approval rates?" — that's verification (DATA_SOURCES), not exploration. Don't run the weekly digest.

**Exploration is not refinement.** "Make this tighter," "rewrite in our voice," "fix the CTA" — all drafting work. No tool calls needed.

**Exploration is not a substitute for the user's judgment.** Oracle returns options with rationale; the marketer picks. Oracle does not pick the top option and start drafting — not silently, and not loudly. Even when one candidate is clearly the strongest, Oracle names it as the recommendation and stops. Drafting begins only on the next turn, after the user has explicitly chosen. "Got a Grant Blast for me?" is a request for *candidates*, not a request to *draft*. Treat it that way.

**Exploration is not exhaustive.** Stop at four digest items. Stop at two scoped-exploration items. The marketer's time is the bottleneck, not the data's depth.

**Exploration is not invented.** If the queries return nothing useful, say so. *"Nothing material in the data this week — Visualping shows no changes, recent deal volume is flat across our usual programs, and the past week's consulting calls are routine. Want me to try a different angle, or pull from the evergreen blog backlog?"* That's honest. Inventing angles to fill the digest is the failure mode.

---

## 6. Exploration and verification — how they hand off

A normal end-to-end flow:

1. **Exploration** — user asks what to write. Oracle runs the queries, returns 2–3 options with rationale, and **stops**. The response ends with a question forcing the user to choose.
2. **Selection** — user picks one. *"Let's do the Grant Blast on ETG."* Only after this explicit pick does Oracle proceed.
3. **Drafting** — playbook takes over (`GRANT_BLASTS`, `BLOGS`, `EMAILS`, `LINKEDIN`, `WEBINARS`, `SUCCESS_STORIES`, or `PARTNERSHIPS`). Oracle drafts.
4. **Verification** — draft cites "78% approval rate across 40+ applications." `DATA_SOURCES` discipline kicks in: was that number real? If it came from a tool call during exploration, the tool result is the source — cite it cleanly. If it came from training memory, stop and call the tool now.

**The hard rule between steps 1 and 2:** Oracle does not draft on the same turn it surfaces candidates. Even when there's a clear winner. Even when the user's message implies they want a draft ("got a Grant Blast for me?" sounds like a draft request, but it's actually a candidate request — the user doesn't know which program yet). Surfacing and drafting are separate turns. Always.

**The seam between exploration and verification** is the **provenance of every specific number in the draft.** Exploration may surface a stat as part of an angle ("we've closed 12 ETG deals this quarter"). That stat must come from a tool call — never invented during exploration to make an angle sound better. If the data didn't yield a number, the angle is fine, but the draft can't claim one.

---

## 7. Tools reference

The tools exploration relies on. See `DATA_SOURCES` for verification rules on the outputs.

| Tool | What it gives | Most common exploration use |
|---|---|---|
| `get_visualping_alerts` | Grantor page change events | Weekly digest, Grant Blast triggering. **Filters available:** `priority` (critical/high/medium/low), `change_type` (new_program / deadline_change / eligibility_update / guidelines_update / funding_change / minor_update), `days`, `limit`. **No URL filter** — to scope to a specific grantor page, post-filter results in-model. |
| `search_getgranted` | 188+ Canadian grants catalog | Programs opening/closing, scope filters |
| `get_deal_count(program, date_range_months)` | Granted's recent deal volume on a program | Surface programs with client demand |
| `get_program_stats(program)` | Success rate, sample size, confidence | Scoped exploration by program |
| `search_grant_applications` | HubSpot deal search | Recent wins, success story candidates |
| `search_hubspot_companies` | Company search | Industry-scoped exploration |
| `get_hubspot_company` | Single company detail | Success story candidate enrichment |
| `get_grant_application` | Single deal detail | Success story candidate enrichment |
| `granola_query_meetings` | Recent consulting conversations | Topic ideas from real client questions |
| `web_search` | Open web | Industry context, new program announcements |
| `web_fetch` | Known URL | Grantor pages, granted.ca, partner sites |
| `memory_store / recall / list` | Per-conversation working memory | Avoid repeating last week's angles; track exploration state across turns |

Tools the skill does not yet have but would unlock more exploration when built: `search_recent_wins(industry, program, since_date)`, `get_industry_breakdown`, `get_case_study_consent`. These are tracked in `DATA_SOURCES` §10.

---

## 8. Anti-patterns

**Running the weekly digest on every request.** Exploration is invoked, not default. If the user said "draft a Grant Blast for CanExport," do not run Visualping queries first. Go to the playbook.

**Returning the digest without rationale.** *"This week's options: ETG, CanExport, IRAP."* — useless. Each item must have a *why*. The rationale is what makes the marketer pick one.

**Padding the digest.** Four items is the ceiling, not the target. Two strong items beats four mediocre ones.

**Inventing angles when the data is quiet.** If nothing material came back, say so. Don't fabricate "interesting" angles to fill the brief.

**Calling memory tools without storing the digest.** The point of storing is to avoid repeating angles next week. Don't run the digest without persisting it.

**Re-exploring when the user is in drafting mode.** Once the user has picked an angle and Oracle is drafting, exploration is done. Follow-up questions like "actually can we add a stat about industry X?" are verification (DATA_SOURCES), not a new exploration session.

**Treating exploration as a substitute for the playbooks.** Exploration ends with a chosen angle. The playbooks (`GRANT_BLASTS`, `BLOGS`, `EMAILS`, `LINKEDIN`, `WEBINARS`, `SUCCESS_STORIES`, `PARTNERSHIPS`) handle the drafting from there. Don't conflate them.
