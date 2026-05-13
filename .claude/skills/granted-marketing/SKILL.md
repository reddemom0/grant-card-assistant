---
name: granted-marketing
description: Marketing strategy, campaign planning, and content creation for Granted Consulting. Covers Grant Blasts, blogs, emails, LinkedIn posts, webinar promo, success stories, and content calendar work across GetGranted, Granted Starter, GrantedPro, and related products.
triggers:
  - marketing
  - grant blast
  - blog
  - blog post
  - blog refresh
  - webinar promo
  - success story
  - linkedin post
  - marketing content
  - content calendar
  - email blast
  - marketing campaign
  - brand voice
category: marketing
---

# Granted Marketing Skill — Entry Point

The Oracle's marketing brain. This file is the router. Sub-skills hold the playbooks and reference material.

---

## 0. Maturity model — what this skill can do right now

This skill supports three progressive levels. The skill is now operating at Level 2 — Oracle has live access to HubSpot data, the grants database, meeting transcripts, web search, and grantor page change alerts.

| Level | Oracle behavior | Human role | Status |
|---|---|---|---|
| **1. Assistant** | Drafts in brand voice. Knows content rules. Prompted for every input. | Provides facts, stats, program details. Reviews + edits. | **Foundation — always active** |
| **2. Data-aware assistant** | Pulls HubSpot stats, grants DB program details, recent meeting context, web search results, and program change alerts — uses them to surface ideas and ground drafts. | Confirms intent, reviews, edits. | **Live** |
| **3. Scheduled + autonomous** | Runs on cadence. Picks the grant. Drafts all versions. Sends to human for approval before posting. | Approves or edits. | **Future** |

**What's live now:** Oracle can call `get_program_stats` and `get_deal_count` for HubSpot stats, `search_getgranted` for the 188+ Canadian grants database, `granola_query_meetings` for recent consulting conversations, `get_visualping_alerts` for grantor page changes, plus `web_search` and `web_fetch` for open research. See `DATA_SOURCES` for usage.

---

## 1. Quickstart — common requests and what to type

| What you want | What to say |
|---|---|
| This week's Grant Blast | *"I need a Grant Blast for [program name]"* — or *"Suggest a Grant Blast for this week"* |
| Monthly new blog | *"Let's write the [month] blog"* — or *"Write a blog on [topic]"* |
| Blog refresh | *"Which blog should we refresh this month?"* — or *"Refresh the [topic] blog with new intel"* |
| Webinar promo email | *"Draft promo email for the [topic] webinar on [date]"* |
| Success story writeup | *"Turn this client outcome into a success story"* + provide details |
| LinkedIn post | *"LinkedIn post for [topic/event/moment]"* |

The Oracle will ask follow-ups to fill in gaps. If you want all three audience versions by default (Lead / Paid Starter / Pro client), say *"draft all three"* — otherwise it'll ask.

---

## 2. When to use this skill

Load this skill when the user asks to:
- Draft or review a **Grant Blast** (LinkedIn + email combo announcing a live program)
- Write or refresh a **blog post**
- Draft **email copy** — Grant Blast, blog blast, webinar promo, platform promo, success story share, re-engagement
- Write **LinkedIn posts** — Grant Blast, webinar promo, blog promo, success story, humanization, industry observance
- Plan a **content calendar** (weekly or monthly)
- Turn a client outcome into a **success story**
- Recalibrate tone on any of the above

Do **not** load this skill for: sales outreach that isn't marketing-led, operational comms, HubSpot workflow configuration, Zoom/Canva/Vimeo setup, video/reel production (future-state — not yet supported).

---

## 3. Routing — which sub-skill to load

**Every marketing task loads at least two sub-skills**: `FOUNDATIONS` (always) + the task-specific playbook. Most tasks also need `COMPANY_CONTEXT` for brand facts.

**First, identify the mode.** Every marketing request is in one of three modes:

- **Explore** — the user is asking *what* to write about ("what should we send this week?", "got a Grant Blast for me?", "any blog ideas?"). Load `EXPLORATION`.
- **Draft** — the user has specified what they want ("draft a Grant Blast for CanExport", "write a blog about hiring grants"). Skip `EXPLORATION`; go straight to the playbook.
- **Verify** — the draft will cite specific numbers. Load `DATA_SOURCES` in addition to whatever else is loaded.

Explore and Verify often both apply in one conversation: explore first, then draft, then verify the numbers in the draft.

**Universal rule for content-discovery exploration:** When recommending what to write about (blog topic, success story candidate, partnership outreach target, any "what should we cover" question), check granted.ca's existing coverage before surfacing candidates. Call `check_blog_coverage({ topic: "<topic keyword>" })`. This is not optional — recommending without coverage data means every candidate is unlabeled (could be a duplicate, refresh, or new angle, and you cannot tell which). Read each result's `title` and `excerpt` to judge whether the matches are substantive (the topic is actually covered) or incidental (the search term appears but isn't the post's subject). Empty or loose results are a *success state* — they mean the angle is new.

### Standard loading patterns

**Explore (user is asking what to write):**
1. `FOUNDATIONS` (voice, guardrails)
2. `EXPLORATION` (digest queries, scoped exploration, mode discipline)
3. The relevant playbook for the content type the user is leaning toward — `GRANT_BLASTS`, `BLOGS`, `EMAILS`, `LINKEDIN`, `WEBINARS`, `SUCCESS_STORIES`, or `PARTNERSHIPS`. If unclear, ask after the digest.
4. `COMPANY_CONTEXT` (proof points)
5. `DATA_SOURCES` (the digest will cite numbers from tool calls)

**Grant Blast (subject specified):**
1. `FOUNDATIONS` (voice, audience, guardrails)
2. `GRANT_BLASTS` (full playbook)
3. `COMPANY_CONTEXT` (proof points, product names)
4. `DATA_SOURCES` (if pulling stats from HubSpot or web)

**Blog (new or refresh, subject specified):**
1. `FOUNDATIONS`
2. `BLOGS`
3. `COMPANY_CONTEXT` (if the blog needs brand facts or case studies)
4. `DATA_SOURCES` (for blog refresh stats, or new program details)

**Email (subject specified):**
1. `FOUNDATIONS`
2. `EMAILS`
3. `COMPANY_CONTEXT`
4. `DATA_SOURCES` (only if stats-heavy)

**LinkedIn post (subject specified):**
1. `FOUNDATIONS`
2. `LINKEDIN`
3. `COMPANY_CONTEXT`
4. `DATA_SOURCES` (only if stats-heavy)

**Webinar planning or promo:**
1. `FOUNDATIONS`
2. `WEBINARS` (cadence, schedule, promo sequence, monthly rhythm)
3. `COMPANY_CONTEXT`

**Success story or case study:**
1. `FOUNDATIONS`
2. `SUCCESS_STORIES`
3. `COMPANY_CONTEXT` (public client list and quote bank)
4. `DATA_SOURCES` (client funding amounts, deal counts)

**Partnership outreach:**
1. `FOUNDATIONS`
2. `PARTNERSHIPS`
3. `COMPANY_CONTEXT`

### Rule of thumb
If in doubt about the mode, ask: *"Is the user telling me what to write about, or asking me to help figure that out?"* Only the second case loads `EXPLORATION`.

Don't over-load — `DATA_SOURCES` is only needed when fetching or citing data. `EXPLORATION` is only needed when the user is asking what to write about.

---

## 4. Available sub-skills

| Sub-skill | Purpose |
|---|---|
| `FOUNDATIONS` | Voice, audience rules (Lead/Paid Starter/Pro), 15-word rule, guardrails — the DNA that every piece of content follows |
| `COMPANY_CONTEXT` | About Granted, products, proof points, messaging hierarchy, grant types, internal voices, public case studies |
| `GRANT_BLASTS` | Full Grant Blast playbook — 3 content intents × 3 audiences, prompt workflow, worked examples |
| `BLOGS` | New blog + blog refresh workflows, 2026 topic calendar, structural templates |
| `EMAILS` | Email drafting playbook — Grant Blast, Blog Blast, webinar promo, success story share, post-webinar follow-up, re-engagement, GetGranted promo |
| `LINKEDIN` | LinkedIn post types, hook discipline, voice rules, attribution conventions |
| `WEBINARS` | Webinar planning, promo cadence, 2026 schedule, monthly content rhythm and calendar |
| `SUCCESS_STORIES` | Client success story / case study drafting — four-part structure, length variants, anonymization, public client list |
| `PARTNERSHIPS` | Partnership outreach — CPAs, fractional CFOs, accelerators, banks, VCs, industry associations, tech vendors |
| `DATA_SOURCES` | What the Oracle pulls from (HubSpot, grants DB, web) — anti-fabrication discipline, citation conventions |
| `EXPLORATION` | Idea generation — weekly digests, scoped exploration by industry/program/content-type, explore-vs-draft-vs-verify mode discipline |

---

## 5. Universal rules (always true, even before sub-skills load)

These apply to every piece of marketing output, regardless of which sub-skill handles it. They're the minimum consistency guarantee.

1. **Voice passes the calibration test.** Not hypey, not dry. Conversational yet authoritative. Plain language over government-speak.
2. **Audience is explicit.** Every output is tagged Lead, Paid Starter, or Pro client. Default is to produce all three versions when the content type supports it (Grant Blasts especially).
3. **15-word rule for social hooks.** Social post first lines, graphic headers, and reel hooks land in under 15 words.
4. **No fabricated data.** Success rates, funding amounts, deadlines, client names, eligibility specifics — if not provided or fetchable, the Oracle asks or flags "need to confirm." Never guesses.
5. **Brand phrases used exactly.** "Grant funding" not "grants." "92% approval rate" not "industry-leading success." Named case studies match the public list (see `COMPANY_CONTEXT`).
6. **Guardrails respected.** No guaranteed funding. No regulatory, legal, or tax claims. No unauthorized client details. No naming competitors in public content.

See `FOUNDATIONS.md` for the full detail on each.

---

## 6. What this skill doesn't do yet

- **Video / reels production** — future-state. Do not attempt scripts or reel content; flag to human.
- **Level 3 autonomous posting** — the Oracle never posts to LinkedIn, sends emails, or publishes blogs. All outputs are drafts for human review.
- **Competitive analysis in public content** — reserved for gated / sales contexts.
- **Program application strategy content** — paid-tier insight only (see `FOUNDATIONS.md` on content tiering).
- **Visual design work** — colors, imagery, graphic composition. The skill references brand colors in `COMPANY_CONTEXT` but doesn't design visuals.
- **Ad copy / paid media campaigns** — if requested, clarify scope before proceeding. Probably in-scope for the skill but the team hasn't defined the playbook yet.
- **Podcast / audio scripts** — same as video/reels.

---

*For the full guardrail set, load `FOUNDATIONS`. For brand facts, load `COMPANY_CONTEXT`.*
