# Souad-Driven Section Merge — Grant Card Writing Sub-Skills

**Date:** 2026-05-20
**Trigger:** Souad's feedback on GCCC Tree Planting card comparison
**Scope:** 9 sub-skill files in `.claude/skills/grant-card-writing/`
**Sections updated:** 2 (Preview), 3.1 (Grant/Program Overview), 3.2 (Grant/Loan/Investment/Prize Value), 5 (Program Details — voice only), 6.3 (Forms)
**Sections preserved:** All others (Section 1, 3.3, 3.4, 4.x, 6.1, 6.2, 7)

This file is the source of truth for the merge. Apply each block to the corresponding file. After install, this reference file can be deleted.

---

## FILE: SYSTEMS_PROCESSES.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what system, process, or operational challenge the program supports.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language") — write for a small business owner, not a policy analyst
- Outcome-focused (what the business gets)
- No jargon, no program mechanics

**Formatting:**
- Single paragraph
- No bullets

**AI Rule:** Describe what operational system is being improved + the intended business or environmental outcome. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Grant Overview

```markdown
### 3.1 Grant Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?"

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Includes, in this order, only when relevant:
  - grant value to the applicant
  - contribution percentage
  - expected outcomes of the program
  - who it's for

**Language style:**
- Plain business language ("Layman's language")
- Informational, not instructional
- Not narrative history — do not describe when the program launched, why it was created, or government priorities

**Formatting:**
- Paragraph format
- Followed by "Grant Value" as a separate line or block

**Critical distinction — total program budget vs. grant value:**
- The program's total budget (e.g., "$291 million initiative") is the funding allocated to run the overall program. Rarely useful to an individual applicant.
- The grant value is what an individual applicant can receive (e.g., "up to $100K per project, covering up to 50% of eligible costs").
- Always report grant value to the applicant. Never use total program budget as the headline figure.

**AI Rule:** If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it. If the source mentions total program funding, do not lead with that number.
```

### Section 3.2: Grant Value

```markdown
### 3.2 Grant Value

**Aim:** Clearly quantify the financial or in-kind support. Consistent structure across all grant cards.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - % of funding (coverage percentage of eligible costs)
  - maximum funding amount per applicant
  - additional funding for specific project types or applicant groups (if applicable — e.g., underrepresented applicants, Indigenous organizations, rural projects)
  - applicant contribution requirement (if applicable — minimum project size, matching funds, contribution %)
  - stream-specific limits or special caps (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Separate streams/tiers clearly
- Use consistent wording across cards: "Up to X% of eligible costs," "Up to $X per [project/applicant/year]"

**Critical distinction — program budget vs. applicant value:**
- Report grant value to the applicant, not the program's total budget.
- If the source material only gives a total program budget without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Use bullets when there are multiple streams, caps, or cost-share rates. Always distinguish between maximum funding and realistic/average funding when source material provides both.
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the program actually runs. Includes:
- project location requirements
- stream structure
- cost-share rules
- reimbursement basis
- project completion deadlines
- claim/payment rules
- approvals required before starting
- application limits
- evaluation priorities
- evaluation criteria (only when clearly stated)
- any other constraints

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Projects must...", "Funding is...", "Applicants must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**AI Rule:** This is the operational mechanics section. It explains how the grant works after eligibility is established — not eligibility or funding.
```

### Section 6.3: Forms

```markdown
### 6.3 Forms

Direct access to application materials. No descriptions, just links.

- Program Website: [URL from source material]
- Program Guidelines: [URL from source material]
- Application Portal: [URL from source material]

**Rules:**
- Use these three labels exactly (Title Case). Do not invent alternative labels (e.g., "FCM Portal," "Eligible Costs Document," "FAQ").
- If a URL is in the source material, include it as a clickable link.
- If a URL is not in the source material, omit that bullet entirely. Do not write "[click here]," "TBD," or any placeholder.
- Do not add new rows beyond these three labels, even if the source material contains additional resources.

**AI Rule:** Exactly three possible rows. Include each only if you have a real URL from the source. No descriptions, no placeholders, no extras.
```

---

## FILE: CAPITAL_COST.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what capital investment the program supports and why.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Outcome-focused (what the business gets)
- No jargon, no program mechanics

**Typical wording:**
- "supports construction of..."
- "funds purchase and installation of..."
- "helps businesses adopt equipment..."
- "improves accessibility, efficiency, capacity, productivity, or emissions performance"

**Formatting:**
- Single paragraph
- No bullets

**AI Rule:** Describe the asset being funded + the intended operational or public benefit. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Grant Overview

(Identical to SYSTEMS_PROCESSES.md Section 3.1 above.)

### Section 3.2: Grant Value

(Identical to SYSTEMS_PROCESSES.md Section 3.2 above.)

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the program actually runs. Includes:
- reimbursement basis
- approval required before spending
- ownership/retention obligations
- project completion deadlines
- minimum investment requirements
- cost-share requirements
- application limits
- funding agreement terms
- reporting or claim rules
- evaluation criteria (only when clearly stated)
- any other constraints

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Projects must...", "Funding is...", "Applicants must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**AI Rule:** This is the operational mechanics section. It explains how the grant works after eligibility is established — not eligibility or funding.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## FILE: PRIZES_CONTESTS.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** A quick, high-level explanation of who the competition is for, what they can win, and what achievement or business profile is being recognized.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Outcome-focused (what the business gets)
- No jargon, no program mechanics

**Formatting:**
- Single paragraph
- No bullets

**AI Rule:** Describe who can compete + prize/recognition type + competition purpose. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Grant Overview

```markdown
### 3.1 Grant Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?"

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Includes, in this order, only when relevant:
  - prize value to the winner
  - contribution percentage or matching requirement (if applicable)
  - expected outcomes of the program (recognition, exposure, mentorship)
  - who it's for

**Language style:**
- Plain business language ("Layman's language")
- Informational, not instructional
- Not narrative history

**Formatting:**
- Paragraph format
- Followed by "Prize Value" as a separate line or block

**Critical distinction — total prize pool vs. prize value to winner:**
- Report prize value to the winner, not the total prize pool (unless the total pool is the single award).
- Never lead with the total program budget or aggregate prize fund.

**AI Rule:** If a sentence describes program mechanics, history, or government goals rather than what's offered to the winner, remove it.
```

### Section 3.2: Prize Value

```markdown
### 3.2 Prize Value

**Aim:** Clearly quantify the financial or in-kind support. Consistent structure across all cards.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - cash prize amounts (top prize and tiered prizes if applicable)
  - in-kind value (coaching, mentorship, exposure, recognition)
  - finalist or runner-up awards (if applicable)
  - prize structure cadence (annual/monthly/quarterly)
  - additional benefits for specific project types or applicant groups (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Separate prize tiers when applicable
- Use consistent wording across cards: "$X grand prize," "$X runner-up," "Up to $X in in-kind services"

**Critical distinction — total prize pool vs. winner value:**
- Report what a winner receives, not the total prize pool.
- If the source material only gives a total prize pool without per-winner figures, state that the per-winner amount is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Use "Prize Value" or "Award Value" as the section heading, not "Grant Value." Clearly list prize amounts and categories.
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the competition works. Includes:
- application deadline
- entry fee (if applicable)
- number of winners
- finalist stages
- round details / timeline
- pitch video requirements
- public voting
- live pitch competition
- evaluation criteria (if applicable)
- mentorship / workshops
- sponsor or administrator
- reporting or promotional obligations

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings. Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**AI Rule:** This section explains the competition mechanics.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## FILE: RD.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what kind of innovation the program supports and what problem it is trying to solve.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Outcome + innovation focused
- Often includes sector/problem (e.g., emissions, energy, AI)
- No jargon, no program mechanics

**Formatting:**
- Single short paragraph
- No bullets

**AI Rule:** Describe innovation type + impact outcome. Not funding, not process. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Grant Overview

```markdown
### 3.1 Grant Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?" For R&D programs, anchor the overview in funding scale + innovation stage + commercialization intent.

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Must include:
  - funding range or typical size (per-applicant value, not total program budget)
  - stage of development (TRL or equivalent)
  - commercialization or validation goal
- Add additional context only when relevant: contribution percentage, expected outcomes, who it's for

**Language style:**
- Still plain, but more technical than other grant types (TRL, prototype, scale-up are acceptable)
- Informational, not instructional
- Not narrative history — do not describe when the program launched or government priorities

**Formatting:**
- Paragraph format
- Followed by "Grant Value" as a separate line or block

**Critical distinction — total program budget vs. grant value:**
- The program's total budget (e.g., "$291 million initiative") is the funding allocated to run the overall program. Rarely useful to an individual applicant.
- The grant value is what an individual applicant can receive.
- Always report grant value to the applicant. Never use total program budget as the headline figure.

**AI Rule:** Anchor the program in stage of innovation + funding scale + commercialization intent. If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it.
```

### Section 3.2: Grant Value

```markdown
### 3.2 Grant Value

**Aim:** Clearly quantify the financial or in-kind support. Distinguish averages vs. caps vs. cost-share.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - % contribution (coverage percentage of eligible costs)
  - maximum funding amount per applicant
  - average funding (if relevant — add a NOTE if averages differ from caps)
  - additional funding for specific project types or applicant groups (if applicable)
  - applicant contribution requirement (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Use consistent wording across cards: "Up to X% of eligible costs," "Up to $X per [project/applicant/year]"

**Critical distinction — program budget vs. applicant value:**
- Report grant value to the applicant, not the program's total budget.
- If the source material only gives a total program budget without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Always distinguish between maximum funding and realistic/average funding.
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the funding program operates structurally. Includes:
- constraints (1 application, ability to submit multiple projects, deadlines)
- multi-stage process (EOI → Proposal → Decision)
- milestone-based payments
- project timelines (start, duration)
- evaluation criteria

**Length & depth:**
- 6–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Projects must...", "Funding is...", "Applicants must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)
  - evaluation criteria

**AI Rule:** This section explains program mechanics, not eligibility.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## FILE: BUSINESS_ASSESSMENT.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what kind of business support or planning the program funds.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Focus on the type of assessment or planning support
- Often includes the area of focus (e.g., digital readiness, market research, strategic planning)
- No jargon, no program mechanics

**Formatting:**
- Single short paragraph
- No bullets

**AI Rule:** For this grant type, the preview usually highlights:
- type of support (advisory, mentorship, planning, IP, etc.)
- core objective (decision-making, growth, IP protection, scaling)

The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Grant Overview

```markdown
### 3.1 Grant Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?" For Business Assessment programs, anchor the overview in advisory scope + funding scale + intended deliverable.

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Must include:
  - funding range or typical size (per-applicant value, not total program budget)
  - type of advisory work covered
  - intended deliverable (plan, assessment, report)
- Add additional context only when relevant: contribution percentage, expected outcomes, who it's for

**Language style:**
- Plain business language ("Layman's language")
- Informational, not instructional
- Not narrative history — do not describe when the program launched or government priorities

**Formatting:**
- Paragraph format
- Followed by "Grant Value" as a separate line or block

**Critical distinction — total program budget vs. grant value:**
- The program's total budget (e.g., "$291 million initiative") is rarely useful to an individual applicant.
- The grant value is what an individual applicant can receive.
- Always report grant value to the applicant. Never use total program budget as the headline figure.

**AI Rule:** Anchor the program in advisory scope + funding scale + deliverable. If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it.
```

### Section 3.2: Grant Value

```markdown
### 3.2 Grant Value

**Aim:** Clearly quantify the financial support and any caps.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - % contribution (coverage percentage of eligible costs)
  - maximum funding amount per applicant
  - per-hour or per-project caps (common in this grant type)
  - additional funding for specific project types or applicant groups (if applicable)
  - applicant contribution requirement (if applicable)
  - NOTE if caps differ from typical use

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Use consistent wording across cards: "Up to X% of eligible costs," "Up to $X per [project/applicant/hour]"

**Critical distinction — program budget vs. applicant value:**
- Report grant value to the applicant, not the program's total budget.
- If the source material only gives a total program budget without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** The value of mentorship programs is estimated based on the number of hours of professional guidance provided. Some programs estimate this value, others don't. If the value is known and listed on the program's website, add it to the grant card. If the value is unknown, use: *"This program provides in-kind support only (no direct funding)."*
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the program actually runs. Includes:
- phases (Discovery, Traction, Streams, etc.)
- timelines
- constraints (1 application, deadlines)
- evaluation criteria

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Projects must...", "Funding is...", "Applicants must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**AI Rule:** This is the "how it works" section, not eligibility or funding.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## FILE: MARKET_EXPANSION.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what kind of expansion the program supports (domestic vs. international), including:
- What market growth activity is being supported
- Where growth is happening (domestic / international / export / new markets)
- Why the program exists

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Vocabulary: expand, diversify, export, enter new markets, increase sales, trade resilience
- No jargon, no program mechanics

**Formatting:**
- Single short paragraph
- No bullets

**AI Rule:** Describe where the business is expanding + how the program helps them get there. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Grant Overview

```markdown
### 3.1 Grant Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?" For Market Expansion programs, explain the funding model, project streams, and broad target audience.

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Must include:
  - funding % (per-applicant coverage)
  - maximum contribution (per-applicant value, not total program budget)
  - major project streams/categories
  - broad applicant type
- Add additional context only when relevant: expected outcomes

**Language style:**
- Plain language. Market expansion programs frequently have multiple project streams:
  - planning
  - implementation
  - trade shows
  - export development
  - equipment tied to expansion
- Informational, not instructional
- Not narrative history — do not describe when the program launched or government priorities

**Formatting:**
- Paragraph format
- Followed by "Grant Value" as a separate line or block

**Critical distinction — total program budget vs. grant value:**
- The program's total budget (e.g., "$291 million initiative") is rarely useful to an individual applicant.
- The grant value is what an individual applicant can receive.
- Always report grant value to the applicant. Never use total program budget as the headline figure.

**AI Rule:** Explain what kind of growth activities the funding supports. If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it.
```

### Section 3.2: Grant Value

```markdown
### 3.2 Grant Value

**Aim:** Clearly quantify the financial or in-kind support. Distinguish averages vs. caps vs. cost-share.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - % contribution (coverage percentage of eligible costs)
  - maximum funding amount per applicant
  - average funding (if relevant — add NOTE if averages differ from caps)
  - minimum spend thresholds (if applicable)
  - multiple caps by activity type (mention in Expenses section if needed)
  - additional funding for specific project types or applicant groups (if applicable)
  - applicant contribution requirement (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Use consistent wording across cards: "Up to X% of eligible costs," "Up to $X per [project/applicant/year]"

**Critical distinction — program budget vs. applicant value:**
- Report grant value to the applicant, not the program's total budget.
- If the source material only gives a total program budget without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Market Expansion programs often have:
- minimum spend thresholds
- multiple caps by activity type (mention in Expenses section if needed)
- reimbursement models
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the funding program operates structurally.

**Length & depth:**
- 6–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Projects must...", "Funding is...", "Applicants must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**Common inclusions:**
- reimbursement model
- reporting frequency
- project duration
- number of applications allowed
- milestone payments
- claim requirements

**AI Rule:** This is the "how it works" section, not eligibility or funding. It explains the mechanics of funding and selection.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above. NOTE: this replaces the existing "Program Website" capitalized version — final state is the canonical Title Case block with URL placeholders and omission rules.)

---

## FILE: LOANS.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what the loan supports, who it is for, and the business or project outcome.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Outcome-focused (what the business gets)
- No jargon, no program mechanics

**Typical wording:**
- "provides loans to support..."
- "offers low-cost financing for..."
- "provides repayable contributions for..."

**Formatting:**
- Single paragraph
- No bullets

**AI Rule:** Describe the financing purpose + target applicant + intended project or business outcome. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Program Overview

**HEADING MUST BE "Program Overview", NOT "Grant Overview"**

```markdown
### 3.1 Program Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?" For Loan programs, anchor the overview in funding structure + applicant scope + program intent.

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Includes:
  - funding model (%, max $, interest rates)
  - key eligibility signal
  - program intent
- Add additional context only when relevant: contribution percentage, expected outcomes

**Language style:**
- Still plain, but slightly more detailed
- Informational, not instructional
- Not narrative history — do not describe when the program launched or government priorities

**Formatting:**
- Paragraph format
- Followed by "Loan Value" as a separate line or block

**Critical distinction — total loan envelope vs. loan value:**
- The program's total loan envelope (e.g., "$500 million loan fund") is rarely useful to an individual applicant.
- The loan value is what an individual applicant can receive (e.g., "loans up to $5M at 0% interest").
- Always report loan value to the applicant. Never use total fund size as the headline figure.

**AI Rule:** Expand the preview by adding who it's for, how much funding is provided, and how funding works — without going into lists. If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it.
```

### Section 3.2: Loan Value

**HEADING MUST BE "Loan Value", NOT "Grant Value"**

```markdown
### 3.2 Loan Value

**Aim:** Clearly explain the financing structure.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - minimum and maximum loan amount (per applicant)
  - repayable vs. non-repayable portion
  - forgivable portion (if applicable)
  - loan-to-cost percentage
  - cost-share percentage
  - repayment deferral
  - interest-free or low-interest terms
  - collateral / personal guarantee requirements (if stated)
  - additional terms for specific project types or applicant groups (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Use bullets, especially when different applicant types receive different support
- Separate streams/tiers clearly
- Use consistent wording across cards: "Loans up to $X," "Up to X% loan-to-cost," "0% interest for first X months"

**Critical distinction — total loan fund vs. applicant loan value:**
- Report loan value to the applicant, not the total fund size.
- If the source material only gives a total fund size without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Do not label this "Grant Value" unless the program includes a non-repayable grant. Use **Loan Value**, **Funding Value**, or **Repayable Contribution Value**.
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the program operates. Includes:
- financial readiness requirements
- repayment terms
- amortization period
- interest terms
- deferral period
- forgivable portion rules
- contribution agreement or loan agreement
- underwriting process
- collateral / personal guarantee rules
- disbursement process
- project duration
- application phases
- reporting obligations
- any other constraints

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Applicants must...", "The loan must...", "Repayment is..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure
  - timelines
  - limits / thresholds

**AI Rule:** This section explains the financial mechanics and project delivery rules.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## FILE: INVESTMENT.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** Explain what kind of company the program invests in and what stage of growth it supports.

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Outcome-focused (what the company gets — growth capital, validation, partnership)
- No jargon, no program mechanics

**Formatting:**
- Single paragraph
- No bullets

**AI Rule:** Describe the company stage + investment focus + growth purpose. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.
```

### Section 3.1: Program Overview

**HEADING MUST BE "Program Overview", NOT "Grant Overview"**

```markdown
### 3.1 Program Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?" For Investment programs, anchor the overview in investment structure + program scope + applicant fit.

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Includes:
  - investment model (direct equity, convertible debenture, SAFE, etc.)
  - investment range (per-applicant value, not total fund size)
  - key eligibility signal
  - program intent
- Add additional context only when relevant: matching requirements, expected outcomes

**Language style:**
- Still plain, but slightly more detailed
- Informational, not instructional
- Not narrative history — do not describe when the program launched or government priorities

**Formatting:**
- Paragraph format
- Followed by "Investment Value" as a separate line or block

**Critical distinction — total fund size vs. investment value:**
- The program's total fund size (e.g., "$200 million fund") is rarely useful to an individual applicant.
- The investment value is what an individual company can receive (e.g., "$500K–$5M direct equity per company").
- Always report investment value to the applicant. Never use total fund size as the headline figure.

**AI Rule:** Expand the preview by adding who it's for, how much investment is provided, and the investment structure — without going into lists. If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it.
```

### Section 3.2: Investment Value

**HEADING MUST BE "Investment Value", NOT "Grant Value"**

```markdown
### 3.2 Investment Value

**Aim:** Clearly quantify the financial support and investment structure.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - investment range — minimum and maximum (per applicant)
  - equity percentage taken
  - matching private capital requirements
  - convertible debenture or SAFE terms (if applicable)
  - follow-on investment terms (if applicable)
  - additional terms for specific project types or applicant groups (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Separate streams/tiers clearly
- Use consistent wording across cards: "Investments from $X to $Y," "Up to X% equity," "X:1 matching private capital required"

**Critical distinction — total fund size vs. applicant investment value:**
- Report investment value to the applicant, not the total fund size.
- If the source material only gives a total fund size without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Use **Investment Value**, not Grant Value, unless the program is truly non-repayable.
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the investment process works. Includes:
- direct investment vs. fund investment
- investment committee review
- matching private capital
- due diligence
- investment agreement
- convertible debenture / SAFE terms
- activation requirements
- reporting period
- milestone requirements
- impact metrics
- evaluation criteria

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Companies must...", "Investments are...", "Founders must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**AI Rule:** This section should explain investment mechanics, not just eligibility.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## FILE: HIRING_TRAINING.md

### Section 2: Preview Description

```markdown
## Section 2: Preview Description

**Aim:** A quick, high-level explanation of what the program does and why it exists. Help someone instantly decide: "Is this relevant to me?"

Quickly explain:
- who the employer can hire/train
- what cost is being offset
- why the program exists

**Length & depth:**
- 2–3 lines maximum (1–2 sentences)
- Paragraph format, not bullets
- No dollar amounts, no percentages, no eligibility details, no deadlines, no process, no project examples, no program history, no government commitments

**Language style:**
- Plain business language ("Layman's language")
- Outcome-focused (what the business gets)
- No jargon, no program mechanics

**Formatting:**
- Single paragraph
- No bullets

**AI Rule:** Clearly identify whether the funding supports hiring, training, or both. The Preview answers "what is this program?" — nothing else. If a sentence contains a number, a percentage, a date, or the word "eligible," remove it.

**Examples by sub-type:**

*Hiring:* "This program helps Nova Scotia businesses offset the cost of hiring recent master's and PhD graduates into innovation-focused roles."

*Training:* "This program helps employers reduce employee training costs by subsidizing external workforce training."

*Hybrid:* "This program helps employers hire youth while reducing both wage and onboarding costs."
```

### Section 3.1: Grant Overview

```markdown
### 3.1 Grant Overview

**Aim:** Expand the Preview by adding the key details an applicant needs to decide if the program is a fit for them. Answers: "What is this program, and is it a fit for me?" For Hiring/Training programs, add the funding structure, program scope, and who it's for.

**Length & depth:**
- 3–4 lines maximum (2–4 sentences)
- Includes:
  - funding model (%, max, in-kind) — per-applicant value, not total program budget
  - key eligibility signal
  - program intent
- Add additional context only when relevant: contribution percentage, expected outcomes

**Language style:**
- Still plain, but slightly more detailed
- Informational, not instructional
- Not narrative history — do not describe when the program launched or government priorities

**Formatting:**
- Paragraph format
- Followed by "Grant Value" as a separate line or block

**Critical distinction — total program budget vs. grant value:**
- The program's total budget (e.g., "$291 million initiative") is rarely useful to an individual employer.
- The grant value is what an individual employer can receive (e.g., "up to $7K per hired graduate").
- Always report grant value to the applicant. Never use total program budget as the headline figure.

**AI Rule:** Expand the preview by adding who it's for + how funding works, without going into lists. If a sentence describes program mechanics, history, or government goals rather than what's offered to the applicant, remove it.
```

### Section 3.2: Grant Value

```markdown
### 3.2 Grant Value

**Aim:** Clearly quantify the financial or in-kind support.

**Length & depth:**
- As short as possible
- Bullets in this order:
  - % of funding (coverage percentage of wages or training costs)
  - maximum amounts per hire / per trainee / per employer
  - special tiers — funding range based on hours worked (if applicable)
  - additional funding for specific project types or applicant groups (if applicable — e.g., underrepresented hires, equity-deserving groups, Indigenous applicants)
  - applicant contribution requirement (if applicable)

**Language style:**
- Numeric and precise
- No explanation unless necessary

**Formatting:**
- Bullet points or short lines
- Separate streams/tiers clearly
- Use consistent wording across cards: "Up to X% of wages," "Up to $X per hire," "Up to $X per trainee"

**Critical distinction — program budget vs. applicant value:**
- Report grant value to the applicant, not the program's total budget.
- If the source material only gives a total program budget without per-applicant figures, state that the per-applicant maximum is not specified in source material. Do not divide, estimate, or infer.
- If a value isn't in the source material, omit the bullet. Do not fabricate.

**AI Rule:** Break funding into clean tiers when necessary.
```

### Section 5: Program Details

```markdown
## Section 5: Program Details

**Aim:** Explain how the program actually runs. Includes:
- hiring deadlines
- placement duration
- reporting requirements
- milestone payments
- reimbursement schedule
- claim requirements
- any constraints (minimum hours thresholds, employment retention obligations, etc.)

**Length & depth:**
- 5–15 concise bullet points

**Language style:**
- Operational, structured
- Vary sentence structure across bullets. Avoid stacking many short, formulaic openings ("Employers must...", "Funding is...", "Hires must..."). Combine related rules into flowing phrasing where natural. Write like a knowledgeable consultant briefing a client, not a policy document.

**Formatting:**
- Bullet points ending with semicolons
- Group by:
  - structure (phases, streams)
  - timelines
  - limits (applications, duration)

**AI Rule:** This is the "how it works" section, not eligibility or funding. It should explain operational mechanics after approval.
```

### Section 6.3: Forms

(Identical to SYSTEMS_PROCESSES.md Section 6.3 above.)

---

## End of merge reference

After all 9 files are updated and verified, this reference file can be deleted.
