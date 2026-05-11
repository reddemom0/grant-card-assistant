# Grant Card Writing — Overview

This skill governs how grant cards are written for the GetGranted platform. It is loaded by the grant card agent whenever the user wants to produce a grant card or any section of one.

The skill has two layers:

1. **This overview file** — general rules that apply to every grant card regardless of grant type, plus guidance on detecting grant type and routing to the right sub-skill.
2. **Grant-type sub-skills** — one per grant type. Each defines the section-by-section format rules specific to that type. After detecting the grant type, the agent loads the matching sub-skill before writing.

The agent should always load this overview first, then load the type-specific sub-skill.

---

## Grant Type Detection

Before writing any card, identify the grant type. There are nine types:

| Grant Type | Sub-skill to load | When to use |
|---|---|---|
| R&D | `RD` | Programs funding research, prototyping, validation, commercialization of technical innovation. Often references TRL levels, scalability, quantifiable outcomes (GHG, efficiency, IP). |
| Business Assessment / Planning & Coaching | `BUSINESS_ASSESSMENT` | Programs funding advisory services, planning, coaching, assessments, audits. Output is typically a plan or report, not capital or hiring. |
| Market Expansion | `MARKET_EXPANSION` | Programs funding domestic or international market entry, trade shows, marketing, sales growth. |
| Hiring & Training | `HIRING_TRAINING` | Programs funding wage subsidies, student placements, training programs, apprenticeships, workforce development. |
| Systems & Processes | `SYSTEMS_PROCESSES` | Programs funding software adoption, AI tools, digitalization, process improvement, automation. |
| Capital Cost | `CAPITAL_COST` | Programs funding equipment purchases, facility expansion, retrofits, hardware. |
| Loans | `LOANS` | Programs offering repayable financing rather than non-repayable grants. |
| Investment | `INVESTMENT` | Programs offering equity investment in exchange for company shares. |
| Prizes, Awards, Contests | `PRIZES_CONTESTS` | Competitions where applicants win cash prizes, in-kind services, or recognition. |

**Detection process:**

1. Read the program documentation provided by the user (RFP, program guidelines, webpage links).
2. Identify the program's primary purpose: what does the funding enable the applicant to do?
3. Match to one of the nine types above.
4. Confirm with the user before proceeding: *"This looks like a [type] grant — sound right?"*
5. If the user confirms, load the matching sub-skill (e.g., `load_skill("grant-card-writing", "RD")`).
6. If the user disagrees or the type is ambiguous, ask them which type they'd categorize it as.

**Edge cases:**

- A program that funds *both* hiring and training equally → use `HIRING_TRAINING`.
- A program that funds equipment as part of a broader productivity initiative → judge by where the funding emphasis lies. If equipment dominates, `CAPITAL_COST`; if process change dominates, `SYSTEMS_PROCESSES`.
- A program with mixed components (e.g., advisory + capital) → use the dominant component. Note any secondary components in the Program Details section.
- A program that doesn't fit any of the nine types → flag it to the user. Don't force-fit.

---

## General Formatting Rules

These apply to every card, every section, every grant type. Sub-skills extend these rules with type-specific requirements but never override them.

**Bullet style:**
- Use concise bullet points with a semicolon at the end of each bullet
- Keep each bullet to a maximum of 2 lines, focusing only on essential information
- Write bullets in natural, conversational business language — not compressed, robotic phrasing
- Group bullets logically (e.g., core eligibility → additional criteria → priorities)

**Voice and tone:**
- Plain business language. No jargon, no marketing fluff, no hedging
- Active voice. Direct. Decision-oriented
- Maintain a clean, human tone — not overly formal, not AI-generated
- Prioritize clarity and usability for quick reading

**Section discipline:**
- **No overlap between sections.** Eligibility ≠ Activities ≠ Expenses ≠ Program Details. Each section has a single responsibility.
- **No inferred exclusions.** Do not list ineligible applicants, projects, activities, or expenses unless they are clearly cited in the source material.
- **Optional sections** are included *only* if explicitly cited in source material. Never inferred or fabricated.
- **Long lists with links:** If a referenced list is long and significant, pull key bullets and provide a link to the remaining list as a hyperlink.

**Content discipline:**
- Extract information verbatim from source material where the exact language matters (eligibility criteria, dollar amounts, deadlines). Do not paraphrase.
- When information is missing, mark it as unavailable. Do not guess, infer, or fabricate.
- Each section has a unique purpose — avoid repeating the same information across multiple sections.

---

## Card Structure (Shared Across All Grant Types)

Every grant card follows this section structure. Sub-skills define how to write each section for their specific grant type.

1. **Grant/Program Metadata** — name, grantor, type, industries, region, genre tags, contribution percentages, max amount, contact info
2. **Preview Description** — 1-2 sentence summary, no dollar amounts, plain business language
3. **General Requirements** — grant overview + grant value + turnaround time
4. **Eligibility Criteria** — eligible/ineligible applicants, projects, activities, expenses (sub-sections vary by type)
5. **Program Details** — operational mechanics (deadlines, stages, payments, timelines, evaluation criteria)
6. **Best Practices and Forms** — eligible best practices, process best practices, links to forms
7. **Application Process** — condensed steps (1-5 short) + extended steps (with detail)

Some grant types (e.g., Prizes/Contests) modify this structure — sub-skills will indicate where.

---

## What This Skill Does Not Cover

- **Genre tagging.** Use the `grant-card-tagging` skill for that. Tagging happens after the card is written, when the user confirms they want tags.
- **Database field extraction.** The agent has a separate "database metadata" mode for that (search-criteria style output) — not part of the card itself.
- **Internal consultant notes.** The agent has a separate "internal notes" mode for that — not part of the client-facing card.
- **Marketing artifacts** like LinkedIn posts or grant blasts. Those belong to the marketing agent, not this skill.

---

## Workflow Summary

1. User provides program documentation (RFP, links, etc.)
2. Agent reads the docs and identifies grant type
3. Agent confirms grant type with user
4. Agent loads matching sub-skill from `grant-card-writing`
5. Agent writes the requested card or section(s), following:
   - General rules from this overview
   - Type-specific rules from the sub-skill
6. After delivery, agent asks if user wants tags → loads `grant-card-tagging` skill if yes

If the user requests only a specific section (e.g., "just the preview"), the agent writes only that section using the matching sub-skill's rules for that section.
