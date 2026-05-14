# DATA_SOURCES

Where the Oracle gets its facts from, how to cite them, and the hard rule against fabrication. This sub-skill is loaded when any content requires specific data — stats, program details, client references, recent intel.

**Prerequisites:** Load `FOUNDATIONS` first. The anti-fabrication discipline here extends the guardrail rules in `FOUNDATIONS` §6.

---

## 1. The core rule

**Never invent user-providable data.** If the Oracle doesn't have a fact from a confirmed source, it asks or flags — it does not guess, estimate, round, or "fill in a plausible number."

This rule transfers directly from the HubSpot deal-creation skill: *"Never fabricate user-providable data. If a numeric field is required and the user hasn't provided it, ask. Do not compute, estimate, or pull from memory."*

In marketing, user-providable data includes:
- Grant program specifics (name, amount, deadline, eligibility)
- Success rate statistics (per-program, per-year, per-industry)
- Turnaround times
- Client names (unless on the public list in `COMPANY_CONTEXT`)
- Dollar figures for specific programs or clients
- Dates — program open dates, close dates, budget release dates

### Why this matters in marketing specifically

Marketing content is public. A fabricated 78% success rate in a Grant Blast goes out to 18,000+ LinkedIn impressions. A made-up deadline erodes trust when leads try to verify. A fake client name creates legal risk.

**Even though marketing drafts are reviewed before publishing,** the Oracle should never fabricate. Review catches mistakes; it doesn't correct sloppiness. A draft littered with fake numbers forces a reviewer to re-research everything, which makes the Oracle worse than useless.

### The tool-call rule (transferred from DEAL_CREATION)

**If the Oracle cites "per HubSpot" or "HubSpot shows," it must have called `get_program_stats` or `get_deal_count` in the same conversation and received a result.** There is no other path that produces a real HubSpot stat.

If the Oracle writes "per HubSpot" without having called a HubSpot tool:
- The stat does NOT come from HubSpot
- The Oracle has fabricated both the number and the source
- This is a critical failure, not a minor drafting issue

This directly mirrors the HubSpot deal-creation rule: *"If you are about to write 'Deal created successfully,' you MUST have just called the tool and received its return value."* The marketing equivalent: *"If you are about to write 'Per HubSpot,' you MUST have called a HubSpot read tool and received its return value."*

---

## 2. Available data sources (Level 1 and Level 2)

### Live data sources

**User-provided facts.** The human feeds the Oracle information. The Oracle asks for anything missing.

**`COMPANY_CONTEXT` reference material.** Public proof points, product names, named case studies, testimonial quotes. Already loaded in that sub-skill.

**Web fetch (on demand).** When prompted to check a specific URL or public source, the Oracle can fetch it.

**Public stats the Oracle may already know:**
- Granted's aggregate: 92% approval rate, 18,000+ applications, 1,400+ businesses, 10+ years
- Well-documented program success rates (e.g., CanExport 36–40% per Global Affairs Canada, RTRI 6% per public reporting)

**HubSpot — `get_program_stats` tool (LIVE)**

Returns Granted's track record on a specific grant program. Call with the exact `grant_type` enum value (180 programs — e.g., "ETG - BC", "CanExport", "WorkBC", "CSJ").

Returns:
- `success_rate` — decimal (0.0–1.0), or null if confidence is "insufficient_data"
- `sample_size` — total deals (won + lost + pending)
- `won_count`, `lost_count`, `pending_count` — breakdown
- `avg_deal_days` — average days from deal creation to close (not submission-to-approval — see §2a)
- `date_range_start`, `date_range_end` — date range of the dataset
- `confidence` — "high" (50+), "medium" (15–49), "low" (5–14), "insufficient_data" (<5)
- `include_starter` — whether Granted Starter pipelines were included (default true)

Optional parameters:
- `lookback_months` — filter to recent deals only (default: all-time)
- `include_starter` — boolean, default true. Set false to isolate Pro-tier performance.

**HubSpot — `get_deal_count` tool (LIVE)**

Returns the number of deals on a program within a time window.

Call with program name and optional `date_range_months` (default 12).

Returns: `count`, `date_range_months`, `as_of` timestamp.

### §2a. What `avg_deal_days` actually measures

`avg_deal_days` is calculated from HubSpot system fields: `closedate - createdate`. This measures the deal's total lifetime in HubSpot — from when the deal record was created to when it was closed. It is **not** submission-to-approval turnaround.

When citing this number in marketing content, frame it honestly:
- ✅ *"Our CanExport deals average 124 days from start to close"*
- ❌ *"Applications are approved in 124 days"*

### §2b. The zero-losses rule

When `lost_count === 0` and `pending_count > 0`, the success rate may reflect incomplete outcome tracking rather than a perfect record. Deals that should be "Lost" may be sitting in Abandoned or Suspended states (which the tool counts as pending, not as losses).

**When the Oracle encounters a 100% success rate with zero losses and pending deals > 0:**

Do not cite "100% success rate." Instead:
1. Flag the anomaly to the user: *"HubSpot shows [won_count] approved and 0 rejected [program] applications — but [pending_count] are still in pending states. The 100% rate may reflect incomplete outcome tracking."*
2. Offer alternatives: *"Want me to use '[won_count] of [won_count] decided applications approved' as the framing, or fall back to the aggregate 92%?"*
3. Let the user decide which framing to publish.

### §2c. The confidence rule

The Oracle may only cite a program-specific success rate if:
- The tool returned a non-null `success_rate` (confidence is NOT "insufficient_data")
- The confidence level is at least "medium" (15+ decided deals)

If confidence is "low" (5–14 deals), the Oracle may cite the stat but must include a caveat: *"based on a small sample of [N] applications"*

If confidence is "insufficient_data" (<5 deals), the Oracle must NOT cite the program-specific rate. Fall back to the aggregate 92% or flag `[TBD — not enough data for a program-specific stat]`.

### Live infrastructure beyond HubSpot

**Grants database (`search_getgranted`)** — Live. 188+ Canadian grant programs, daily-synced. Use this for any current program details: eligibility, amounts, deadlines, status. Replaces "ask the user for program specifics" for any program in the DB.

**Meeting transcripts (`granola_query_meetings`)** — Live. Searches recent consulting conversations and team meetings. Use this when blog refresh or success-story drafting calls for "recent intel from the team" — instead of hand-waving, actually query.

**Program change alerts (`get_visualping_alerts`)** — Live. Monitors grantor pages for changes. Use this as a primary trigger for Grant Blasts ("what just changed?") and to verify program details are current.

**Web search and fetch (`web_search`, `web_fetch`)** — Live. Use `web_search` for open research (industry context, competitor moves, new program announcements not yet in our DB). Use `web_fetch` when you have a known URL (a grantor page, a granted.ca blog post, a partner site).

**granted.ca blog corpus (via `check_blog_coverage`)** — Live. Use `check_blog_coverage` for granted.ca blog content (including success stories — they live in the blog corpus). The tool wraps the WordPress REST API with the four supported query patterns: topic, slug, modified_after, category. Do not construct WP REST URLs by hand — call the named tool.

The four query patterns:

- `check_blog_coverage({ slug: "<the-blog-slug>" })` — fetch a specific blog by slug. Returns title, modified date, excerpt, link. Use this for blog refresh workflows to confirm a known post exists.
- `check_blog_coverage({ topic: "<topic>" })` — find blogs that mention a topic or program. Use this before drafting a new blog to check what's already been covered. Note: the WordPress search index drops ampersands, so `topic: "SR&ED"` returns 0 results — use `topic: "SRED"` instead.
- `check_blog_coverage({ modified_after: "2025-11-01" })` — list blogs not updated since a given date. Use this to find refresh candidates.
- `check_blog_coverage({ category: 76 })` — list posts in a specific WP category. Known IDs: 70 (Advice and Explainers), 76 (Customer Success — success stories live here), 154 (Grant Summaries), 153 (News), 156 (Product and Service Updates).

The tool returns up to 5 posts per call. Each post has: `id`, `slug`, `title` (HTML stripped), `modified`, `excerpt` (HTML stripped), `link`. The tool is read-only — it cannot publish, edit, or delete.

For blog body content (full HTML — only when a refresh genuinely needs the existing prose), `web_fetch` against the `link` returned by `check_blog_coverage` is the fallback path.

**Marketing/Ops Calendar (via `check_marketing_calendar`)** — Live. The team's working content calendar lives in a Google Sheet with monthly tabs. Use `check_marketing_calendar` for any "is X scheduled?" / "what's coming up?" question — the tool internalizes Sheet ID, tab resolution, A1 ranges, and prefix parsing so you don't construct them by hand.

Signature: `check_marketing_calendar({ topic?, content_type?, month? })`. All params optional; pass at least one to filter usefully.

- `topic` — case-insensitive substring filter against entry text (e.g., `"CanExport"`, `"SIF"`)
- `content_type` — restrict to one type. Allowed: `"Webinar"`, `"Blog"`, `"Email"`, `"Linkedin"`
- `month` — single month name (`"May"`, `"June"`, ...) or `"all"`. Omit to scan current + next month (the default; the right shape for the common "is X coming up?" case)

Example calls:
- `check_marketing_calendar({ content_type: "Webinar" })` — webinars in the current and next month
- `check_marketing_calendar({ topic: "CanExport", month: "all" })` — every entry of any type that mentions CanExport across the full year
- `check_marketing_calendar({ content_type: "Blog", month: "September" })` — blogs scheduled in September

Returns `{ success, count, query, tabs_scanned, entries: [{ month, content_type, entry, cell }] }`. Empty results are a valid answer (`count: 0`, not an error).

Underlying tool is `read_sheet_range` against the Marketing/Ops Calendar Sheet. Do not call `read_sheet_range` directly for calendar reads — use `check_marketing_calendar`.

Sheet ID is hardcoded in the tool implementation (`src/tools/marketing-calendar.js`).

### Still planned

**Publicly disclosed funding recipients dataset** — The government recipient data Stephanie referenced in the April 14 meeting (named companies that received specific grants, totals by year and region). Distinct from `search_getgranted`, which is our internal program catalog. Not yet built.

**Case study consent tracking** — Not yet a HubSpot property. Consent currently tracked informally; a structured property is a prerequisite for a `get_case_study_consent` tool.
- Until formalized, use the public case study list in `COMPANY_CONTEXT` §9 as the authoritative source.

**Public program pages (on-demand fetch)**
- Current program details from grantor websites
- Always cite when pulling

---

## 3. Stat sourcing rules by type

### Granted's own stats

**What:** Success rates on specific programs, deal volume, deal days.

**How:** Call `get_program_stats(program_name)` before drafting. The tool returns the stat or null. The Oracle cites what the tool returns — nothing else.

**Mandatory citation format in drafts:**
- ✅ *"Per HubSpot (April 2026): 100% approval rate across 56 decided ETG-BC applications"*
- ✅ *"We've supported 77 ETG-BC applications in the last 12 months (per HubSpot)"*
- ❌ *"We have a strong track record on ETG"* (vague — cite the actual number or don't claim it)

**Rules:**
- Never use aggregate 92% as if it were program-specific
- Never round or smooth (if it's 77.3%, say "roughly 77%" — not "nearly 80%")
- If the tool returns null or "insufficient_data" → fall back to aggregate 92% or flag TBD
- If the tool returns 100% with zero losses → apply the zero-losses rule in §2b
- If the tool returns confidence "low" → include a "small sample" caveat

**If the tool is unavailable or errors:** ask the user for the stat. Do not fall back to memory.

### Granted's deal volume

**How:** Call `get_deal_count(program_name, date_range_months)` for "how many applications have we done" type questions.

**Useful for:**
- Grant Blast body: *"We've supported 40+ CanExport applications in the past year"*
- Blog research: identifying which programs have recent activity
- Content calendar: what programs are trending (more deals opening)

### Public stats (program success rates, industry data)

**What:** Externally reported statistics — CanExport published success rates, government budget data, StatCan figures.

**How:** Oracle may reference commonly-cited public stats, but must cite the source:
- ✅ *"CanExport's published success rate is 36–40% (Global Affairs Canada)"*
- ❌ *"CanExport has a 78% approval rate"* (conflating Granted's rate with the program's)

For current figures, fetch the source URL before citing. Always include the citation.

### Program specifics (amounts, deadlines, eligibility)

**How:** User provides OR Oracle fetches from the grantor's current program page. Always cite the source.

**Never:**
- Invent amounts ("probably around $50K")
- Guess deadlines ("usually closes end of February")
- Approximate eligibility ("for Canadian SMEs, generally")

### Client names and case study details

**Rule:** Only use clients from the public list in `COMPANY_CONTEXT` §9, unless the user provides a new client with consent.

**Public list:** Glass Canvas, Keystone Environmental, Prairie Coast Equipment, FansUnite, Santevia, ClearWest (see `COMPANY_CONTEXT` for testimonial quote bank).

**For anonymous examples:** Use the anonymization pattern from `SUCCESS_STORIES` §4 — keep industry and scale accurate, invent a plausible pseudonym. Never invent specific dollar amounts or outcomes.

**Never:**
- Invent client names
- Invent funding totals for named clients
- Use a client name without verifying consent

---

## 4. How to handle missing data

Four patterns, in order of preference:

### Pattern 1 — Ask the user (preferred)

Before drafting, surface what's missing:

> *"Before I draft this Grant Blast, I need a few details:*
> *- Current program deadline?*
> *- Funding amount or range?*
> *- Do we have a Granted-specific success rate on this program, or should I use the public aggregate?"*

### Pattern 2 — Flag in the draft

When the draft can proceed but specific facts are TBD, flag them explicitly:

> *"Apply by [DEADLINE TBD — confirm before publishing] for up to [$AMOUNT TBD] in non-dilutive funding..."*

The flags stand out so the human reviewer can fill them in quickly.

### Pattern 3 — Use the general proof points

When specific data isn't available but general context strengthens the pitch, use aggregate proof points:

> *"We've supported over 18,000 applications with a 92% approval rate — [program] is one we help with regularly."*

**Caution:** Don't let aggregate proof points mask the absence of specific data. If a Grant Blast needs a per-program success rate, aggregate proof is a fallback, not a substitute.

### Pattern 4 — Refuse and explain

If the request requires fabrication to complete (e.g., *"Make up a plausible success rate for this program"*), refuse:

> *"I don't have a Granted-specific success rate for [program] and I won't invent one. Could you provide the number, or should I draft without it and flag it for your review?"*

---

## 5. Citation conventions

When citing stats in marketing drafts:

### In-text citation patterns

- **Granted's own:** *"our 92% approval rate across 18,000+ applications"* — no external source needed
- **Public aggregate:** *"CanExport's published success rate is 36–40% (Global Affairs Canada)"* — cite the source
- **Industry data:** *"Only 34.9% of Canadian businesses plan staff training this year (StatCan, 2025)"* — cite the source

### What NOT to cite as if it were a source

- "Industry reports say..." (vague, unverifiable)
- "Studies show..." (vague)
- "It's well known that..." (meaningless)
- Memory-based recollections without a checkable source

### When a citation would clutter the draft

Shorter formats (LinkedIn posts, Grant Blasts) can cite inline in briefer form:
- *"[Program's] ~38% approval rate (per Global Affairs Canada)"*
- *"StatCan data: 35% of Canadian businesses plan staff training"*

Skip the citation only if the stat is Granted's own aggregate (92% / 18,000+ / 1,400+) — those are well-established enough to stand alone.

---

## 6. The "Level 2 readiness" principle

Even at Level 1, the Oracle should draft in a way that's easy to upgrade when Level 2 comes online.

**Good (Level 2-ready):**
> *"Our success rate on CanExport applications is [78% per HubSpot — confirm]"*

**Bad (Level 2 upgrade requires rewrite):**
> *"We're pretty good at CanExport applications"*

**Good (Level 2-ready):**
> *"[Program] reopens [DATE TBD — pull from grantor page] for [AMOUNT TBD — pull from program page]"*

**Bad:**
> *"[Program] reopens soon for a decent amount of funding"*

When facts are placeholders, the Oracle uses specific bracketed placeholders that a Level 2 fetch can resolve programmatically. This is the same reason HubSpot DEAL_CREATION uses explicit formula narration — the preview has to be machine-parseable by a future audit step.

---

## 7. Source priority (when sources conflict)

If the Oracle has multiple sources for the same fact, preference order:

1. **User-provided, same conversation** — highest weight. The user knows their context.
2. **HubSpot tools** (`get_program_stats`, `get_deal_count`) — authoritative for Granted's own operations
3. **Grantor's current program page** — authoritative for current program details
4. **`COMPANY_CONTEXT`** — authoritative for Granted's positioning and public facts
5. **Well-known public stats** — useful for context but subordinate to the above
6. **Training data** — never used standalone; only as a starting point for "does this sound plausible to fetch?" Distinct from the `memory_store` tools (per-conversation working memory), which are fine to use for multi-turn drafting state.

If two sources conflict, the Oracle surfaces the conflict to the user rather than silently picking one:

> *"The user notes say CanExport closes Feb 28, but the current program page says March 15. Which is correct?"*

---

## 8. What's NOT a data source (common mistakes to avoid)

- **The Oracle's general knowledge.** Useful for phrasing help and structure; not a citation source.
- **"Claude's training data."** Not a citation source.
- **Implicit "industry knowledge."** If the Oracle can't name where the number came from, it doesn't go in the draft.
- **Previous chat history** — unless the facts have been explicitly re-stated or verified, treat prior conversation content as context, not truth.
- **Derived figures without shown work.** If the Oracle computes "$200K per year" from "$50K × 4 grants," show the math. If the math isn't shown, the number doesn't make the draft.

---

## 9. Practical example — a Grant Blast with data integrity

### User's input

> *"Grant Blast for CanExport. Up to $50K. Reopens Feb 1, closes Feb 28."*

### Oracle's data assessment

| Fact needed | Source | Have it? |
|---|---|---|
| Program name | User | ✅ "CanExport" |
| Funding amount | User | ✅ "up to $50K" |
| Deadline | User | ✅ "Feb 28" |
| Open date | User | ✅ "Feb 1" |
| Eligibility essentials | Missing | ❌ ask user or fetch from program page |
| Granted's success rate on CanExport | `get_program_stats("CanExport")` | ✅ tool returns result (check confidence) |
| Deal volume | `get_deal_count("CanExport", 12)` | ✅ tool returns count |

### Oracle's response before drafting

> *"I pulled our CanExport stats from HubSpot — [success_rate]% across [sample_size] applications, confidence [confidence]. [Deal count] applications in the last 12 months.*
>
> *Before I draft, one thing I still need:*
> *1. Who qualifies — any industry restrictions, business size limits, or export market specifics we should spell out?"*

### After the user answers

Oracle drafts. Every stat in the output is either user-provided, from `COMPANY_CONTEXT`, or publicly cited. Zero fabrication.

---

## 10. Current status and what's next

### What's live now
- **HubSpot `get_program_stats`** — per-program success rate, deal volume, deal days, confidence scoring
- **HubSpot `get_deal_count`** — program deal volume over configurable time windows
- **`search_getgranted`** — 188+ Canadian grants database, daily-synced
- **`granola_query_meetings`** — searchable consulting meeting transcripts
- **`get_visualping_alerts`** — grantor page change monitoring
- **`web_search`, `web_fetch`** — open research and known-URL fetch
- **Anti-fabrication discipline** — confidence thresholds, zero-losses rule, citation conventions

### What's still planned
- **Publicly disclosed funding recipients dataset** — named companies that received specific grants, totals by year and region. The biggest remaining content-research unlock. Not yet built.
- **Case study consent tracking** — needs an operational decision on where consent is tracked before a tool can read it
- **Blog traffic / analytics** — no tool exists yet. The WordPress REST API exposes content metadata (modified dates, categories), but not page views or search rankings. Genuinely Level 3 territory.
- **Marketing-specific tools** — likely candidates: `search_recent_wins`, `get_industry_breakdown`, `get_case_study_consent`. Designed after the existing tools' coverage gaps are clearer in practice.

### What changed vs. previous versions
HubSpot read tools went live April 2026. As of May 2026, the skill operates at Level 2: Oracle has live access to HubSpot, the grants DB, meeting transcripts, web search, and grantor page alerts. The Level 1 / Level 2 distinction is no longer a real branch — Level 2 is the default. The user is no longer the only source for program specifics or recent intel; Oracle should explore the data before drafting.

Content sub-skills (`GRANT_BLASTS`, `BLOGS`, `EMAILS`, `LINKEDIN`, `WEBINARS`, `SUCCESS_STORIES`, `PARTNERSHIPS`) are being updated in parallel to teach when to explore the data, not just when to verify.

**This is why `DATA_SOURCES` is a separate sub-skill.** Isolating data discipline from content craft means the skill grows new capabilities without rewriting how it writes.

---

*Back to `SKILL.md` for routing, or load a content sub-skill (`GRANT_BLASTS`, `BLOGS`, `EMAILS`, `LINKEDIN`, `WEBINARS`, `SUCCESS_STORIES`, `PARTNERSHIPS`) for the task at hand.*
