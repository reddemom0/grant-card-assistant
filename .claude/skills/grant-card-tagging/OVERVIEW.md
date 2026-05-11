# Grant Card Tagging — Overview

This skill governs how grant programs are tagged with genre scores during card writing. Tags are reviewed by the grant coordinator and become part of the program's record in the GetGranted platform.

The skill emits a list of all 52 genres across 13 fields, each scored 0–3, based on the program's content. The output is human-reviewable — the coordinator can adjust scores before they're written to the database.

This skill matches the taxonomy and scoring rubric used by the prototype's batch tagger (`scripts/genre-tagger-mirror.js`). Genre names are the database keys themselves — they must be reproduced verbatim, including typos.

---

## Critical: Preserve Genre Names Verbatim

The genre name string **is** the database key. There is no separate ID mapping. This means:

- Reproducing a genre name with a typo fixed (e.g., "Intellectual Property" instead of "Intelletual Property") creates an orphan that doesn't match existing records.
- Renaming any genre requires a coordinated re-tag of all existing grants. The data quality log explicitly forbids unilateral renames.

Genres with known typos or non-standard capitalization (all preserved on purpose):

- **Intelletual Property** (not "Intellectual Property")
- **Product development** (lowercase d)
- **Prototype development** (lowercase d)
- **Process improvement** (lowercase i)
- **Domestic Trade shows** (lowercase s)
- **Student/ Co-op Intern** (space after slash)

When emitting tags, copy names exactly as listed in the taxonomy below.

---

## Scoring Rubric

For each genre, assign a score 0–3 using this exact rubric. Language matches the prototype tagger:

- **3 = STRONG match** — this is a primary/core use of the program
- **2 = GOOD match** — this is clearly eligible but not the main focus
- **1 = POSSIBLE match** — might be eligible but unclear or indirect
- **0 = NOT a match** — not relevant or explicitly excluded

The rubric applies to every genre. Every genre receives a score (even if 0). Never skip a genre.

---

## What to Tag Against

Tag based on the program's **eligibility, eligible projects, eligible activities, eligible costs, and program purpose** — the content equivalent of what the prototype tagger sees in the `grant_criteria` field. Plus the grant name (a strong signal — "Wage Subsidy for X" → Wage Subsidy = 3).

Don't tag against marketing fluff or context that doesn't appear in the official program rules. If the source RFP contains promotional language, ignore it for tagging purposes.

---

## Taxonomy (13 Fields × 52 Genres)

Each genre includes a brief description to support the coordinator's review. These descriptions are for human reading — the scoring judgment still comes from the 0–3 rubric applied to the program's content, not from the description.

### Field: Commercialization & Validation

- **Commercialization** — Moving a developed product or service from development into market-ready, revenue-generating status.
- **Feasibility Assessment** — Evaluating whether a proposed initiative is viable (technical, financial, market).
- **Product Validation** — Testing a product with real users or in real conditions to confirm fit, performance, or market demand.
- **Scaling Up** — Growing an existing operation to higher production volume, larger customer base, or new geography.

### Field: Domestic Sales & Marketing

- **Domestic Expansion** — Growing a business into new domestic markets (other provinces, regions).
- **Domestic Marketing** — Marketing activities targeted at domestic customers.
- **Domestic Trade shows** — Attending or exhibiting at trade shows within Canada.

### Field: Expert Support

- **Advisory/Coaching** — One-on-one or small-group advisory support, mentorship, executive coaching.
- **Audits** — Formal audits — energy, financial, operational, compliance.
- **Consulting** — Engaging external consultants to deliver a specific project or deliverable.
- **Market Research & Planning** — Researching markets, customers, or competitors to inform business strategy.

### Field: Export & Global Markets

- **Export Readiness** — Preparing a business to begin exporting (market research, certifications, capability building).
- **International Expansion** — Growing an existing export business into new countries or regions.
- **International Market Entry** — Entering a specific new international market for the first time.
- **International Trade Show** — Attending or exhibiting at trade shows outside Canada.

### Field: Facilities & Equipment

- **Equipment Purchase** — Buying machinery, tools, or specialized equipment.
- **Facility Expansion** — Expanding an existing physical facility (square footage, capacity).
- **Production Upgrade** — Upgrading production capability (new lines, increased throughput).
- **Retrofits & Upgrades** — Retrofitting existing facilities or equipment (energy efficiency, modernization, accessibility).

### Field: Grant Type

- **Hiring** — Programs that fund hiring activities (wage subsidies, recruitment support).
- **Training** — Programs that fund training activities (courses, skill development, upskilling).

### Field: Hiring & Workforce

- **Apprentices** — Programs that fund apprenticeship hires or apprenticeship training.
- **Equity Hire** — Programs targeting hires from equity-deserving groups (women, BIPOC, persons with disabilities, newcomers).
- **Green Jobs Hire** — Programs that fund hires into roles tied to environmental, cleantech, or sustainability work.
- **Remote Hire** — Programs that fund remote work arrangements or rural/remote hires.
- **Student/ Co-op Intern** — Programs that fund student or co-op placements with employers.
- **Wage Subsidy** — Programs that cover a percentage of an employee's wages for a defined period.
- **Youth Hire (<29 years old)** — Programs that fund hires of candidates under age 29 (or under 30, depending on program).

### Field: Innovation & R&D

- **Intelletual Property** — Filing patents, trademarks, or other IP protection. *(Note: typo preserved intentionally.)*
- **Pilot Testing** — Running a pilot or demonstration to test a product or process in a real environment.
- **Product development** — Building new products or significantly improving existing ones.
- **Prototype development** — Building working prototypes of new technology, products, or systems.
- **R&D** — Research and development activities, often pre-commercial or pre-prototype.

### Field: Operations & Efficiency

- **Advanced Manufacturing** — Adopting advanced manufacturing techniques (Industry 4.0, additive manufacturing, robotics).
- **Automation** — Automating manual processes (robotic process automation, factory automation).
- **Process improvement** — Improving existing business processes for efficiency, quality, or cost reduction.
- **Productivity Boost** — Initiatives focused on increasing overall business productivity.

### Field: Start-Ups

- **Start-Up Advisory & Systems** — Advisory and systems support for early-stage startups.
- **Start-Up Expansion** — Growth-stage support for startups expanding operations.
- **Start-Up Hiring** — Hiring support targeted specifically at startups.
- **Start-Up Loans** — Loan programs targeted at startups.
- **Start-Up R&D** — R&D support targeted at startups.
- **Start-Up Training** — Training support targeted at startups.

### Field: Sustainability

- **Emissions/GHG reduction** — Reducing greenhouse gas emissions, carbon footprint, or environmental impact.
- **Upcycling** — Converting waste materials or by-products into higher-value products.
- **Waste-to-Value** — Processes that turn waste streams into commercially valuable outputs.

### Field: Technology & Digital

- **AI & Emerging Tech** — Adopting AI, machine learning, blockchain, or other emerging technologies.
- **Digital Marketing** — Digital marketing activities (SEO, paid ads, social, content).
- **Hardware** — Adopting hardware solutions (sensors, IoT devices, specialized computing).
- **Software** — Adopting software solutions (SaaS, custom software, digital tools).

### Field: Training & Development

- **Technology Training** — Training focused on technology adoption, digital skills, or software proficiency.
- **Upskilling** — Training existing employees in new skills or advanced competencies.

---

## Output Format

Emit a single Markdown table with all 52 genres. Group by field. Use this exact structure:

```
## Genre Tags for [Program Name]

### Commercialization & Validation
| Genre | Score | Note (optional) |
|---|---|---|
| Commercialization | 0 | |
| Feasibility Assessment | 0 | |
| Product Validation | 0 | |
| Scaling Up | 0 | |

### Domestic Sales & Marketing
| Genre | Score | Note (optional) |
|---|---|---|
| Domestic Expansion | 0 | |
| Domestic Marketing | 0 | |
| Domestic Trade shows | 0 | |

[...continue for all 13 fields and 52 genres...]
```

**Rules for the output table:**

- Every genre listed, even if the score is 0
- Genre names copied **verbatim** from the taxonomy above
- Score in the second column: 0, 1, 2, or 3
- Note column is optional — use for brief justification or to flag ambiguous calls for the coordinator's review (e.g., "Could be 2 if equipment is a major component")
- After the table, optionally add a short summary: *"This program scores STRONG (3) on [genres]. Primary focus is [field]."* Keep this to 1–2 sentences.

---

## Workflow

When the user asks for tags:

1. Review the program content (eligibility, eligible projects/activities/expenses, program purpose, grant name).
2. For each of the 52 genres, apply the 0–3 rubric.
3. Emit the table in the format above.
4. Optionally add a short summary at the end.
5. Remind the user that they can adjust scores before they're written to the database.

Do not emit JSON. Do not compute `association_scores` (those are derived downstream). Do not emit boost attributes (those are derived by the cron tagger, not Souad's manual review).
