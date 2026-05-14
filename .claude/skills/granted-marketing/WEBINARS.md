# WEBINARS

Playbook for webinar planning, promotion, and the surrounding monthly content rhythm. Load when the user asks about webinars (planning, promo, follow-up), about the content calendar, or about monthly content planning.

**Prerequisites:** Load `FOUNDATIONS` and `COMPANY_CONTEXT` first.

---

## Resources

**Webinar SOP — `Webinar_SOP_-_2026.md`.** Step-by-step ops guide covering Zoom webinar creation, HubSpot sign-up form, website page setup, redirect handling, workflow enrollment, Zapier integration, and post-webinar email. When a consultant asks about webinar setup, the registration form, workflow enrollment, or any ops step, point at the SOP rather than improvising from training data.

---

## 1. Cadence

Monthly webinars, typically on the 3rd Thursday. Used for lead capture and sales conversation. Sign-ups feed into segmented HubSpot workflows.

## 2. 2026 webinar schedule

| Month | Topic |
|---|---|
| January | Grant Strategy |
| February | Grant Roadmap; CanExport (separate event) |
| March | Using Grants to Fund Interns / New Hires |
| April | How to Understand Grant Eligibility |
| May | Maximising Grants Using Grant Platforms (GetGranted Demo) |
| June | How to Manage Claims / Reporting |
| July | Granted's 14th Anniversary: How Grants Have Changed |
| August | (break) |
| September | How Small Businesses Are Winning Grants (3-user panel) |
| October | How to Prepare Business Financials for Grant Applications |
| November | Federal Budget Webinar (interview with Jeff Phillips) |
| December | (break) |

**Live source — the working calendar.** The hardcoded table above is the planning rhythm. The team's actual working calendar is the Marketing/Ops Calendar Sheet (see `DATA_SOURCES` §2). When the user asks *"what's the next webinar?"*, call `check_marketing_calendar({ content_type: "Webinar" })` (defaults to current and next month). When the user asks *"what's scheduled for [month]?"*, call `check_marketing_calendar({ content_type: "Webinar", month: "<MonthName>" })`.

## 3. Standard sign-up form fields

- First name • Last name • Email • Company name • Province
- Webinar opt-in
- Marketing opt-in (separate field — don't conflate)

**Optional topic-specific fields:** Job title, Industry, Website, Annual revenue, Provinces with offices, topic-specific qualifier.

## 4. Promo cadence (per webinar)

Always follow this sequence:

- **Landing page live early**
- **LinkedIn post 1** — as soon as announced
- **LinkedIn post 2** — Monday prior
- **Email blast 1** — as soon as announced
- **Email blast 2** — Monday prior
- **Webinar image** in `help@` and `marketing@` signatures; team invited to do the same
- **Post-webinar email** — recording link (password-protected), CTA to grant calculator, CTA to next webinar

## 5. Input checklist for webinar promotion

**Always** call `check_marketing_calendar({ content_type: "Webinar" })` before asking the user for topic or date. The default scan covers the current and next month, which is the relevant window for "what's the next webinar?" If the user proposes a specific topic, also pass `topic` — e.g., `check_marketing_calendar({ content_type: "Webinar", topic: "<topic>" })` — to check whether that topic is already scheduled before asking the user for a date. If a webinar is already scheduled with a topic and date, confirm that's the one we're promoting before asking the user to fill in details we already have. Skipping this risks fabricating a calendar answer without checking.

The Oracle asks for any missing:
- Webinar topic + angle
- Date, time, registration link
- Speakers + their relevant background
- Target ICP
- Partner co-host if applicable

## 6. Voice rules (webinar promo)

- **Sell the outcome, not the topic.** *"Walk out with a shortlist of grants you actually qualify for"* beats *"Learn about Canadian grants."*
- **Name the speakers** and why their perspective matters
- **Be specific about format** — live Q&A? demo? panel?

## 7. Backlog webinar ideas (for replacements / new slots)

- Non-Dilutive Funding 101 for Canadian Businesses
- How to Build a Grant Strategy for 2026
- Where Startups Go Wrong With Grants (And How to Fix It)
- Grants, SR&ED & Tax Credits: What You're Missing Out On
- How to Fund R&D Without Giving Up Equity
- Grant Funding for Cleantech & Climate Tech (industry-specific)
- Funding for Manufacturing Modernization (industry)
- AI & Advanced Tech Grant Programs (industry)

Before recommending a backlog topic as the next webinar, call `check_blog_coverage({ topic })` to see what blog content already exists on it. Related blog content informs the webinar angle: a topic with a strong existing blog frames the webinar as a deep-dive or live Q&A on that material; a topic with no coverage frames it as an introduction. The point is to shape the angle, not to skip topics we've blogged about.

---

## 8. Monthly rhythm and calendar

### Weekly rhythm

- **Monday** — Grant Blast scheduling (see `GRANT_BLASTS`)
- **Wednesday** — LinkedIn Grant Blast promo
- **Throughout week** — LinkedIn posts (webinar, blog, humanization, success story, meme)
- **Weekly minimum** — email sends; more during webinar promo windows

### Monthly rhythm

- 1 feature blog (new)
- 1 blog refresh
- 1 webinar (except August + December)
- 1 success story share
- Budget blogs when applicable
- Industry-month alignment

### Distribution partners for content sharing

- Chambers of Commerce
- Incubators
- Accelerators
- Business Improvement Associations
- TikTok (Stephanie-led sound bites for brand awareness)

---

*For the webinar promo email sequence, see `EMAILS`. For LinkedIn webinar promo posts, see `LINKEDIN`. For success stories shared in the monthly rhythm, see `SUCCESS_STORIES`.*
