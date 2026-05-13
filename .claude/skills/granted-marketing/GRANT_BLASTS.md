# GRANT_BLASTS

The deepest playbook in the marketing skill. Grant Blasts are the weekly volume driver — typically a LinkedIn post + email combo announcing a live or opening grant program. This sub-skill covers the full drafting workflow.

**Prerequisites:** Load `FOUNDATIONS` and `COMPANY_CONTEXT` first. Load `DATA_SOURCES` if pulling stats from HubSpot, grants DB, or web.

---

## 1. What a Grant Blast is

A timed content piece announcing a grant opportunity. Two formats, sent in parallel:

- **LinkedIn post** — public, hook-forward, 100–180 words
- **Email** — list-segmented, more specific, 100–200 words

**Cadence:** Typically Mondays (scheduling) with LinkedIn promo Wednesdays. Weekly rhythm.

**Primary goals:**
1. Flag time-sensitive opportunities to the right audience
2. Drive inbound for Granted-supported programs
3. Build authority ("we know what's coming before you do")

---

## 2. The three content intents

Every Grant Blast has one of three intents. Identify (or ask) which applies before drafting.

### Intent A — "We can help you with this"

- Program is one GrantedPro actively supports
- **LinkedIn post redacts the program name** for Lead audiences — describes the opportunity without saying which program
- Named for Paid Starter and Pro audiences
- **CTA:** book a call / grant calculator / contact us

**Why redact:** The value is in knowing which program. Redacting drives inbound to Granted while protecting paid-user value. Paid audiences get the name because they've earned it.

### Intent B — "We can't work on this, but it's great for you"

- Program is out of scope for GrantedPro (e.g., Amber Grant, BMO Women's Grant, founder-specific grants we don't facilitate)
- **Fully named across all audiences** — we're not competing for this
- **CTA:** apply directly — include link

**Why name:** We're not trying to win the work. The value is community service — we tell you about a good grant, you feel helped, you remember us when you need someone who *can* help.

### Intent C — "Timing is tight — this is why you need a system"

- Program is closing soon or has rolling deadlines that are easy to miss
- Positioned as the reason to subscribe to GetGranted
- **CTA:** subscribe / sign up to catch the next one in time

**Why:** Tight timing is the pain GetGranted solves. Intent C content is effectively a GetGranted product promo with a real grant as the hook.

### How to pick the intent

If the user specifies, use that. If not, the Oracle asks:

> *"Which intent — A (we can help, CTA to contact us), B (we can't help but it's good for you, apply directly), or C (timing is tight, subscribe to GetGranted)?"*

Or the Oracle infers from context and states its assumption:

> *"Based on the program description, this looks like Intent A (GrantedPro supports CanExport applications). I'll draft with Intent A unless you redirect."*

---

## 3. Prompt workflow (Level 1)

User says: *"I need a Grant Blast for [program name]"* or *"Suggest a Grant Blast for this week"* or *"Do a Grant Blast on [X]"*.

### Step 1 — Establish intent and confirm audience

If the user hasn't specified:

1. **Intent** — ask A, B, or C (or infer and state)
2. **Audience** — Lead / Paid Starter / Pro, or all three (default: all three)

### Step 2 — Gather required facts

The Oracle asks for any missing:

- **Program name** (don't guess)
- **Funding amount or range** (e.g., "up to $50K", "$5K–$500K")
- **Application deadline** (specific date)
- **Eligibility essentials** (industry, size, stage — enough for readers to self-qualify)
- **Credibility stat, if available** — Granted's success rate on this program, typical turnaround, spots remaining. If unknown, flag *"[no stat available — confirm before publishing]"* rather than inventing.

**Never fabricate any of these.** See `FOUNDATIONS` §6. If the user says "make up something plausible," refuse and ask for real data.

### Step 3 — Draft the versions

Default: produce all three audience versions (Lead / Paid Starter / Pro) for the confirmed intent.

The Oracle presents each version labeled clearly:

> **LinkedIn post — Lead version**
> *(draft)*
>
> **LinkedIn post — Paid Starter version**
> *(draft)*
>
> **LinkedIn post — Pro version**
> *(draft)*
>
> **Email — Lead version**
> *(draft)*
>
> *... etc.*

### Step 4 — Offer to iterate

End with:

> *"Want me to tighten any of these, shift tone, or produce additional variants? I can also swap the intent if this should be B or C instead of A."*

---

## 4. Output structure — LinkedIn post

Every LinkedIn Grant Blast has five parts:

1. **Hook line** — under 15 words (per the 15-word rule in FOUNDATIONS). Lead with deadline, funding amount, or a surprising eligibility fact.
2. **The opportunity** — 2–3 sentences in plain language. What the program funds, for whom.
3. **Who it's for** — eligibility essentials, specific enough that a reader can self-qualify ("if you're a BC-based manufacturer with 10+ employees...").
4. **Why it matters now** — real urgency: deadline, program opening, limited spots. No manufactured countdowns.
5. **CTA** — matched to intent + audience.

**Total length:** 100–180 words. **Hashtags:** 1–2 max, relevant.

### Example hook lines (passing the 15-word rule)

- *"**$6M in energy grants** closes Friday — here's who qualifies."* (11 words)
- *"The **BMO Women's Grant** just opened. Apply directly — we can't help with this one, but you should."* (18 words — too long, trim)
- *"**CanExport SME reopens next week.** We've supported 40+ applications."* (9 words)

---

## 5. Output structure — Email

1. **Subject line** — program + deadline specific for Paid/Pro audiences. Benefit-forward for Lead. *"CanExport SME reopens — applications due Feb 28"* beats *"Don't miss this opportunity!"*
2. **Preview text** — completes the hook, doesn't repeat the subject
3. **Opening** — one-sentence promise of what's in this email
4. **Body** — 100–200 words. Who qualifies + what it funds + why move fast.
5. **CTA** — one primary action, matched to intent + audience

### Email-specific rules

- First-person voice ("I / we")
- Sign-off from a specific person (typically Stephanie), not "the Granted team"
- Short paragraphs. One idea per paragraph.

---

## 6. Audience × intent mapping (quick reference)

Use this to match length, specificity, and CTA to the audience.

| Intent | Lead version | Paid Starter version | Pro client version |
|---|---|---|---|
| **A. We can help** | Redacted program name. ~3 sentences. CTA: contact us / calculator | Named. ~5 sentences. CTA: use a token / book consult | Named. ~5 sentences + 2 to-dos (send docs, book call this week) |
| **B. We can't help** | Named. ~3 sentences. CTA: apply directly | Named. ~5 sentences + *"we can't help with this specifically — here's what we can help with instead"* | Named. Brief — Pro clients rarely need this intent |
| **C. Timing is tight** | Named if non-competitive. ~3 sentences. CTA: subscribe to GetGranted | Usually skip — they're already subscribed | Usually skip |

---

## 7. Stats integration

When a Grant Blast cites stats, they come from one of these sources:

### Granted's own stats
- **Per-program success rate** — call `get_program_stats(program_name)`. Apply citation discipline from `DATA_SOURCES` (confidence thresholds, zero-losses rule).
- **Typical turnaround time** — call `get_program_stats(program_name)`; the `avg_deal_days` field returns deal-creation-to-close days. Note: this is not the same as submission-to-approval — cite as "average deal turnaround" not "average approval time."
- **Number of applications supported** — call `get_deal_count(program_name, date_range_months)`.
- **General aggregate proof** — 92% / 18,000+ / 1,400+ (use exactly from `COMPANY_CONTEXT`).

### Public stats (when Granted-specific isn't available)
- Program-wide success rates reported elsewhere (e.g., CanExport 36–40%, RTRI 6%)
- Always cite the source: *"CanExport's published success rate is 36–40% (Global Affairs Canada)"*

### Anti-fabrication rule

**The Oracle does not make up stats.** If a stat isn't provided or fetchable:
- Ask the user
- OR flag *"[Granted's success rate on this program: TBD — confirm before publishing]"*

See `FOUNDATIONS` §6 for the full anti-fabrication discipline.

---

## 8. Worked example

Here's a complete Grant Blast draft, showing what the Oracle's output should look like.

### User input

> *"Draft a Grant Blast for CanExport SME. Applications reopen Feb 1, close Feb 28. Up to $50K. For Canadian SMEs expanding into new international markets. Our success rate on CanExport is 78% across 40+ applications."*

### Oracle response

**Intent:** A (we can help — GrantedPro supports CanExport applications)
**Audience:** Drafting all three versions

---

**LinkedIn — Lead version** *(redacted program name)*

> **$50K in non-dilutive funding** for Canadian businesses expanding internationally — applications close Feb 28.
>
> If you're a Canadian SME breaking into new export markets, there's a federal program that'll cover half your market-entry costs. The window's tight — 4 weeks from open to close.
>
> Our team has supported 40+ applications in this space with a 78% approval rate. If you're not sure whether you qualify, we can walk you through eligibility in 15 minutes.
>
> [Grant calculator link] — find out what your business qualifies for.

*(106 words)*

---

**LinkedIn — Paid Starter version** *(named)*

> **CanExport SME reopens Feb 1** — applications close Feb 28.
>
> Up to $50K for Canadian SMEs expanding into new international markets. Our CanExport success rate: 78% across 40+ applications.
>
> If you have a CanExport application in mind, log in and use a token — we'll prep and submit it for you. Tight window, don't wait until week 4.
>
> [Log in] | [Use a token]

*(70 words)*

---

**LinkedIn — Pro version** *(named + to-dos)*

> **CanExport SME: Feb 1 – Feb 28.**
>
> If you've been planning export market expansion this year, this is your window. $50K cap, 50% cost coverage, new international markets only.
>
> Two to-dos this week:
> 1. Reply with the target market and expansion plan
> 2. Book a 30-min call to prep the eligibility package
>
> We want applications in our hands by Feb 14 to allow real review time.

*(75 words)*

---

**Email — Lead version**

> **Subject:** $50K to help your business expand internationally — closes Feb 28
>
> **Preview:** 4-week window on a federal program for Canadian SMEs entering new markets
>
> Hi there,
>
> There's a federal program reopening this week that covers up to 50% of market-entry costs for Canadian SMEs expanding internationally — up to $50K.
>
> It's called CanExport SME. Eligibility hinges on a few things: you need to be an incorporated Canadian business, have some existing revenue, and target a genuinely new international market.
>
> Our team has prepared 40+ of these applications with a 78% approval rate. Deadlines are tight — 4 weeks from open to close — so if you're considering it, let's talk soon.
>
> — Stephanie
>
> *[CTA button: Book a 15-min eligibility call]*

*(130 words)*

---

**Email — Paid Starter version** and **Email — Pro version** would follow the same pattern with appropriate specificity and CTAs.

---

## 9. Pitfalls to avoid

- **Manufactured urgency.** Real deadlines matter. Fake countdowns ("only 3 days left!!!" when the program closes in 3 weeks) erode credibility fast.
- **Stat inflation.** A 78% success rate becomes 85% becomes 92% through sloppy iteration. Use the number once and hold it exactly.
- **Over-claiming eligibility.** Always hedge: *"your business may qualify if..."* Never say *"you qualify"* without seeing the business.
- **Revealing redacted programs in comments.** If the LinkedIn post redacts the name, don't reveal it in a reply comment or DM response template. Consistency across touchpoints matters.
- **Naming competitors.** If a grant is better served by another firm, don't name them. Just say *"we can't help with this one, apply directly"* (Intent B).
- **Fabricating turnaround claims.** *"We can turn this around in 48 hours"* — only say this if the user confirms it.

---

## 10. Edge cases

### The user asks for "a Grant Blast" with no program specified

Oracle has live access to grants data and can proactively suggest. The default move is to scan and offer options, not to ask the user to pick blind:

1. Call `get_visualping_alerts` to check for grantor page changes in the past 1–2 weeks
2. Call `search_getgranted` to find programs opening or closing within the next 30 days
3. Cross-reference with `get_deal_count(program_name, date_range_months=3)` to see which of those programs Granted has recent activity on (signal of client demand)
4. Propose 2–3 candidates with a one-line rationale each, then let the user pick

If those queries return nothing useful, fall back to: *"Which program should this be about?"*

### The user asks for "just the LinkedIn post" or "just the email"

Draft only the requested format. Still produce all three audience versions unless the user specifies.

### The user asks for a Grant Blast on a program we've never done

No Granted-specific stats available. Use public stats if they exist (e.g., CanExport 36–40%), and flag: *"[No Granted-specific data on this program — this is our first time tracking it]"*. Consider: is this actually Intent B (we can't help)?

### The user provides partial or contradictory data

Oracle asks clarifying questions. Never resolves contradictions by guessing. Example: user says "program closes Feb 28" and "applications due March 15" — ask which is correct.

### The user wants a Grant Blast for a program where eligibility is unclear

The Oracle drafts the opportunity and eligibility essentials, and flags: *"[Eligibility notes to confirm: [specific ambiguity]]"*. Publishing an ambiguous Grant Blast that over-promises eligibility is worse than publishing nothing.

---

*For email-specific voice, see `EMAILS`. For LinkedIn post general patterns, see `LINKEDIN`. For stats sources and fetching rules, see `DATA_SOURCES`.*
