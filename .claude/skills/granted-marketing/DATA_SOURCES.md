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

---

## 2. Available data sources (Level 1 and Level 2)

### Level 1 — what the Oracle has today

**User-provided facts.** The human feeds the Oracle the information needed to draft. The Oracle asks for anything missing.

**`COMPANY_CONTEXT` reference material.** Public proof points, product names, named case studies, testimonial quotes. All already loaded in that sub-skill.

**Web fetch (on demand).** When prompted to check a specific URL or public source, the Oracle can fetch it.

**Public stats the Oracle may already know:**
- Granted's aggregate: 92% approval rate, 18,000+ applications, 1,400+ businesses, 10+ years
- Well-documented program success rates (e.g., CanExport 36–40% per Global Affairs Canada, RTRI 6% per public reporting)

**What Level 1 does not have:**
- HubSpot access (per-program stats, deal counts, turnaround times)
- Grants database integration
- Current program open/close dates without explicit fetching

### Level 2 — planned infrastructure

These capabilities are being built. When they come online, they plug into this sub-skill without needing a rewrite of the content playbooks.

**HubSpot integration**
- Per-program success rate, turnaround time, deal counts
- Existing case study metadata (which clients have consent)
- Segment and list data for campaign targeting

**Government grants database scraper**
- Publicly disclosed funding recipients (the database Stephanie referenced in the April 14 meeting)
- Program funding totals by year and region
- Named companies that received specific grants (useful for lead gen and blog research)
- Monthly refresh cadence

**granted.ca blog scraper**
- Existing blog content for refresh identification
- Traffic / performance signals (Level 2+)
- Internal linking opportunities

**Public program pages (on-demand fetch)**
- Current program details from grantor websites
- Always cite when pulling

---

## 3. Stat sourcing rules by type

### Granted's own stats

**What:** Success rates on specific programs, turnaround times, deal counts, case study metadata.

**Level 1:** User provides the specific stat (e.g., *"Our CanExport success rate is 78% across 40+ applications"*). The Oracle cites the user-provided number.

**Level 2:** Oracle pulls from HubSpot. Always cites source in the draft: *"Per HubSpot, our CanExport success rate is 78% across 42 applications since 2021."*

**Never:**
- Use aggregate 92% as if it were program-specific
- Round or smooth numbers (if it's 77.3%, it's 77.3% or "roughly 77%" — not "nearly 80%")
- Reference stats from memory without sourcing

### Public stats (program success rates, industry data)

**What:** Externally reported statistics — CanExport published success rates, government budget data, StatCan figures.

**Level 1:** Oracle may reference commonly-cited public stats it knows, but must cite the source. Example:
- ✅ *"CanExport's published success rate is 36–40% (Global Affairs Canada)"*
- ❌ *"CanExport has a 78% approval rate"* (conflating Granted's rate with the program's)

**Level 2 (web fetch enabled):** Oracle fetches the current source URL before citing. Always includes the citation.

### Program specifics (amounts, deadlines, eligibility)

**Level 1:** User provides these. If the user says *"up to $50K, closes Feb 28,"* the Oracle uses those exact numbers. If the user doesn't provide them, the Oracle asks.

**Level 2:** Oracle fetches from the grantor's current program page when prompted. Always cites the source URL.

**Never:**
- Invent amounts ("probably around $50K")
- Guess deadlines ("usually closes end of February")
- Approximate eligibility ("for Canadian SMEs, generally")

### Client names and case study details

**Rule:** Only use clients from the public list in `COMPANY_CONTEXT` §9, unless the user provides a new client with consent.

**Public list:** Glass Canvas, Keystone Environmental, Prairie Coast Equipment, FansUnite, Santevia, ClearWest (see `COMPANY_CONTEXT` for testimonial quote bank).

**For anonymous examples:** Use the anonymization pattern from `OTHER_CONTENT` §4 — keep industry and scale accurate, invent a plausible pseudonym. Never invent specific dollar amounts or outcomes.

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
2. **HubSpot** (Level 2) — authoritative for Granted's own operations
3. **Grantor's current program page** — authoritative for current program details
4. **`COMPANY_CONTEXT`** — authoritative for Granted's positioning and public facts
5. **Well-known public stats** — useful for context but subordinate to the above
6. **Memory / training data** — never used standalone; only as a starting point for "does this sound plausible to fetch?"

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
| Eligibility essentials | Missing | ❌ need to ask or fetch |
| Granted's success rate on CanExport | Missing (Level 1) | ❌ need to ask, or use aggregate |
| Public success rate | Known (Level 1) | ✅ "CanExport ~36–40% per Global Affairs Canada" |

### Oracle's response before drafting

> *"I have the basics — $50K, Feb 1 reopen, Feb 28 close. Before I draft:*
> *1. Who qualifies — any industry restrictions, business size limits, or export market specifics we should spell out?*
> *2. Do we have a Granted-specific success rate on CanExport, or should I reference the public 36–40% from Global Affairs Canada?"*

### After the user answers

Oracle drafts. Every stat in the output is either user-provided, from `COMPANY_CONTEXT`, or publicly cited. Zero fabrication.

---

## 10. Upgrading to Level 2 — what changes

When HubSpot and grants DB integrations come online, this sub-skill gets updated in two places:

1. **Section 2 (available sources)** — HubSpot and grants DB move from "planned" to "live"
2. **Section 3 (stat sourcing rules)** — Level 1 / Level 2 distinction collapses for stat types that now have live pulls

Content sub-skills (`GRANT_BLASTS`, `BLOGS`, `OTHER_CONTENT`) don't change. They already cite this sub-skill for stat sourcing; the rules here get richer, and the content sub-skills inherit the upgrade for free.

**This is why `DATA_SOURCES` is a separate sub-skill.** Isolating data discipline from content craft means the skill can grow new capabilities without rewriting how it writes.

---

*Back to `SKILL.md` for routing, or load a content sub-skill (`GRANT_BLASTS`, `BLOGS`, `OTHER_CONTENT`) for the task at hand.*
