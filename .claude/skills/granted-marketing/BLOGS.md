# BLOGS

Blog content playbook. Two workflows: writing a **new blog** and **refreshing an existing blog**. Cadence is 2 per month — one new, one refresh.

**Prerequisites:** Load `FOUNDATIONS` and `COMPANY_CONTEXT` first. Load `DATA_SOURCES` if pulling stats or recent client patterns.

---

## 1. What the blog program does

Long-form educational content for awareness and SEO. Serves three purposes:

1. **SEO anchor** — blogs rank on search terms Canadian businesses query
2. **Authority signal** — positions Granted as the expert
3. **Lead generation** — CTAs drive to grant calculator, demo, or specific landing pages

**Cadence:** 2 per month
- **1 new blog** — fresh topic, timely or evergreen
- **1 refresh** — existing blog updated with new intel

**Length target:** 1,200–1,800 words (default). Tactical pieces can run shorter; comprehensive guides can run longer.

---

## 2. Content architecture

### Four content categories

**Grants 101** — awareness, SEO, top-of-funnel
Examples: "What Is Non-Dilutive Funding?", "Grants vs. Loans vs. SR&ED", "10 Myths About Government Grants in Canada"

**Grants 201** — consideration, mid-funnel
Examples: "Why Most Grant Applications Fail", "DIY vs. Using a Grant Consultant: Cost, Risk & ROI", "Who on Your Team Will Need to Help with Grants"

**About Granted / GetGranted** — brand-building
Examples: "14 Years of Granted: A Look Back", product deep-dives, behind-the-scenes content

**Industry-specific** — high-conversion, targeted
Examples: "Grant Funding for Cleantech", "How Canadian Manufacturers Use Training Grants", "Grants for Food & Beverage Businesses"

**Evergreen / timely** — budget recaps, year-in-reviews
Examples: "BC Budget 2026 Summary", "Federal Budget Release Analysis", "Agri-food Grants in Canada 2026"

---

## 3. New blog workflow

### Prompt workflow (Level 1)

User says: *"Let's write the [month] blog"* or *"Write a blog on [topic]"* or *"Suggest a blog topic"*.

### Step 1 — Identify the topic

If user specifies, use that. If not:
- Check the 2026 scheduled topic for the current month (see section 5)
- OR suggest from the backlog
- OR ask: *"Would you like to tackle the scheduled [topic] or pick something else?"*

### Step 2 — Gather required inputs

The Oracle asks for any missing:

1. **Target audience** — Lead (awareness SEO), Paid Starter (mid-funnel), or broad
2. **SEO keyword** (if SEO-driven)
3. **Length target** (default 1,200–1,800 words)
4. **CTA destination** — grant calculator, demo, specific landing page, subscribe
5. **Specific data to include** — program names, stats, recent news tie-ins
6. **Any case study or client example to reference** — check `COMPANY_CONTEXT` for the public list

### Step 3 — Pick a structural template

Two proven structures exist. Either fits most topics.

**Model A — Lifecycle-by-stage**
Example exemplar: *"How to Leverage Grants at Different Stages of Business"*
- Short intro: why this matters now
- One section per stage (Early / Startup / Growth / Mature) — one paragraph each
- A "what grants don't fund" section for honest expectation-setting
- CTA targets Growth + Mature stages (the converters)

**Model B — Numbered checklist**
Example exemplar: *"How to Set Your Company Up for Grant Success"*
- Short intro framing the problem
- 5 numbered items with clear H2 per item
- Each item: 2–4 sentences, concrete and actionable
- Close with a light CTA

### Step 4 — Default structure

If neither model fits, fall back to this default:

1. **H1** — question or specific promise (not clickbait)
2. **Hook** (2–3 sentences) — why this matters to the reader today
3. **TL;DR or key takeaways** (3–5 bullets for scanners)
4. **Body** — H2-organized sections. One idea per section. Examples throughout.
5. **Closing + CTA** — tied to the post's promise

### Step 5 — Draft

Key rules:
- **Open with the reader's problem**, not Granted's credentials
- **Use concrete examples** — *"a 12-person manufacturer in Burnaby"* beats *"a growing business"*
- **Reference real programs by name** when it adds specificity (CanExport, ETG, IRAP, SR&ED)
- **If multiple audiences**, segment mid-post: *"If you're just starting out... / If you've applied before and are looking to scale..."*
- **Quote the testimonial bank** in `COMPANY_CONTEXT` where it strengthens an argument
- **Honest about limits** — acknowledge early-stage businesses have limited grant access, some expenses don't qualify

### Step 6 — CTA matching

Pick CTA based on target audience and topic:

| Target audience | CTA fit |
|---|---|
| Lead (broad awareness) | Grant calculator ("find out what you qualify for") |
| Interested reader | Subscribe to newsletter or GetGranted free trial |
| Ready to engage | Book a 15-min call / demo |
| Specific program topic | Landing page for that program |

---

## 4. Blog refresh workflow

### The rationale

From Stephanie (April 14 meeting): *"AI likes websites that are updated on a regular basis and that's how we pop up high. That's how we've gotten a good number of people who have found us because they've used AI."*

**Goal:** never rewrite from scratch. Targeted updates to existing blogs keep them current, extend their SEO life, and signal to search engines that the content is maintained.

### Prompt workflow (Level 1)

User says: *"Refresh the [topic] blog"* or *"Which blog should we refresh this month?"* or *"Update the CanExport blog with new intel"*.

### Step 1 — Identify candidates

If the user specifies a blog, use that. If not, the Oracle recommends candidates based on:

- **Program changes** — blogs that reference programs with recent amount changes, new eligibility, new deadlines
- **Seasonal relevance** — blogs matching upcoming content calendar moments (e.g., budget-season blogs before budget release)
- **Stale figures** — blogs with year-specific stats from 2024 or earlier
- **Traffic/performance signals** — blogs that rank well but haven't been updated in 6+ months (Level 2: pulls traffic data)

### Step 2 — List what's changed

Before editing, identify:
- **What's changed** in the program or topic since the blog was written
- **What's stale** (dates, amounts, eligibility criteria, program names that have been renamed)
- **What new intel is available** — from recent consulting conversations, HubSpot data, public program updates

### Step 3 — Produce targeted edits

**Not a rewrite.** Specific paragraphs updated in place:

1. Flag the specific passages that need updating (quote the old text)
2. Provide the replacement text
3. Add a *"Last updated [date]"* note at the top
4. If the update is material, draft a short LinkedIn post flagging the refresh

### Step 4 — Output format

The Oracle's output for a refresh should look like:

> **Blog refresh: [blog title]**
>
> **Summary of changes:**
> - Updated funding amounts for [program] from [old] to [new]
> - Updated deadline from [old] to [new]
> - Added reference to [new development]
>
> **Edits:**
>
> **Passage 1 — Original:**
> *"[quote old text]"*
>
> **Passage 1 — Updated:**
> *"[new text]"*
>
> **Passage 2 — Original:**
> *"[quote old text]"*
>
> **Passage 2 — Updated:**
> *"[new text]"*
>
> **Last updated note** (add to top of post):
> *"Last updated: April 2026 — refreshed to reflect the 2026 CanExport reopening and updated funding cap."*
>
> **Optional LinkedIn flag** (if material):
> *"Refreshed our CanExport guide with the 2026 program updates — new $50K cap and eligibility expansion. [Link]"*

---

## 5. 2026 content calendar (scheduled blogs)

Use these as the default monthly picks unless redirected:

| Month | Blog |
|---|---|
| January | Agri-food grants in Canada |
| February | Year of the Firehorse; BC Budget; Alberta Budget |
| March | 10 Myths About Government Grants; Ontario Budget |
| April | 7 Red Flags That Can Get Your Grant Application Rejected |
| May | Are Grants "Free Money"? The Truth About Eligibility & Reporting |
| June | Which Industries Are Most "Grantable"? |
| July | 14 Years of Granted: A Look Back (interview-style) |
| August | The Full Timeline of a Grant Application |
| September | Do You Need a Grant Writer or Grant Consultant? (CTA: GetGranted) |
| October | Difference Between Provincial, Regional, and Federal Grants |
| November | Federal Budget Release |
| December | Break |

---

## 6. Backlog topics (refresh or replacement options)

### Grants 101
- What Is Non-Dilutive Funding? A Startup Founder's Guide
- Grants vs. Loans vs. SR&ED: What's the Difference?
- Federal vs. Provincial Grants: Which Should You Apply For First?
- How Do You Know When to Start Looking for Grants?

### Grants 201
- Why Most Grant Applications Fail (And How to Avoid It)
- DIY vs. Using a Grant Consultant: Cost, Risk & ROI
- Who on Your Team Will Need to Help with Grants?
- What Grant Assessors Actually Look For in Applications

### High-intent / conversion
- How Much Funding Can Your Business Realistically Access?
- Grant Funding for [Industry]: Tech / Cleantech / AgriTech / Manufacturing
- SR&ED vs. Innovation Grants: When Should You Use Each?
- How Companies Use Grants to Extend Runway by 6–18 Months
- Case Study: How [Business Type] Secured $XXX,XXX in Non-Dilutive Funding

### Ongoing SEO series (monthly repeat potential)
- "Grant Deadline Roundup: [Month / Quarter]"
- "New Grants Launched in [Province]"
- "Grant Program Deep Dive: [Program Name]"
- "Funding Opportunities for [Industry] This Quarter"

### Industry-specific
- Grant Funding for Cleantech & Climate Tech
- Funding for Manufacturing Modernization
- AgriTech & Food Tech Grant Opportunities
- Digital Transformation Grants for SMBs
- AI & Advanced Tech Grant Programs

---

## 7. What grants typically do NOT fund

The Oracle must respect these limits in all blog content. Never imply otherwise.

- **Capital expenditures** (loans may apply)
- **Operational expenses** (rent, furniture, software subscriptions)
- **Transitioning existing staff into new positions** (usually only net-new hires)
- **Early-stage businesses** (pre-1-year) have limited grant access

Including a "what grants don't fund" section in a blog is often a trust-builder — it signals honesty and prevents wasted reader time.

---

## 8. Pitfalls to avoid

- **"Ultimate guide" posts without specifics.** Generic, encyclopedic content that doesn't help the reader decide anything.
- **Burying the CTA.** The reader should know what to do next before they leave the page. Don't hide the CTA in the last line of a wall of text.
- **Stale program details.** Funding amounts, deadlines, eligibility change. If a blog references any of these, flag for the user: *"[confirm current figures for this program]"*.
- **Over-claiming eligibility in writing.** A blog that reads *"your business can apply for…"* creates legal and reputation risk. Use *"may qualify if..."* / *"eligible businesses include..."*
- **Fabricating case study numbers.** Only reference clients on the public list (see `COMPANY_CONTEXT`). For anonymous examples, use *"a BC-based manufacturer"* style — not invented specifics like "Acme Corp secured $100K."
- **Pulling strategic application advice into public content.** *"Here's exactly how to frame your CanExport application"* — paid-tier only. Public content teaches eligibility and opportunity; strategic angles are gated.
- **Voice drift across sections.** A blog that opens warm and chatty but ends in government-speak fails the voice test. Calibrate the voice once, hold it throughout.

---

## 9. Worked example — a new blog

### User input

> *"Let's write the April blog: '7 Red Flags That Can Get Your Grant Application Rejected.' Target: Lead audience, SEO-driven. CTA: grant calculator."*

### Oracle's drafting steps

1. **Structure check:** Model B (numbered checklist) fits perfectly — 7 items, clear H2 per item.
2. **Audience check:** Lead audience. Use redacted examples (not specific clients). Grants 201 level of depth.
3. **Tone check:** Honest-about-limits voice works well — red flags inherently require candor.
4. **CTA check:** Grant calculator matches Lead + "find out what you qualify for" theme.

### Structural output

**H1:** 7 Red Flags That Can Get Your Grant Application Rejected

**Hook (2–3 sentences):** Most rejected grant applications don't fail because the business doesn't qualify. They fail because the application has signals reviewers are trained to catch. Here are the seven most common ones we see at Granted — and how to avoid them.

**TL;DR:**
- Applications are often rejected for process issues, not merit
- Most red flags are avoidable with 15 minutes of review
- If you've been rejected before, it's probably one of the seven issues below

**Body (7 numbered items, 150–250 words each):**
1. **Incomplete or inconsistent business information** — 2–4 sentences on what this looks like and how to fix it
2. **Vague project descriptions** — ditto
3. **Misaligned eligibility claims** — ditto
4. **Financial projections that don't add up** — ditto
5. **Weak or missing supporting documentation** — ditto
6. **Generic "why us" framing** — ditto
7. **Late or improperly formatted submission** — ditto

**Closing:**
> The good news: all seven of these are fixable before you submit. If you're preparing an application and want a second set of eyes, our grant calculator can also help you confirm you're applying to the right program in the first place.
>
> *[CTA button: Try the Grant Calculator]*

### Voice check before delivery

- [ ] Clear over clever — checks out, uses plain language
- [ ] Direct "you" address — yes, every item speaks to the reader
- [ ] Specific — each red flag has concrete examples
- [ ] Honest about limits — core message is acknowledging that applications fail
- [ ] Brand phrases used — "grant funding," "at Granted," "eligible businesses"
- [ ] No fabricated stats — general ("most rejected applications") rather than invented specifics
- [ ] No competitor mentions — none

---

## 10. Worked example — a blog refresh

### User input

> *"The 10 Myths About Government Grants blog from last year needs a refresh. What would you update?"*

### Oracle's approach

1. **Identify stale content** — any program names that have changed, funding amounts that moved, deadlines or eligibility criteria that changed in the last year
2. **Layer new intel** — what have we learned since writing it? (From recent consulting conversations — Level 2 pull from transcripts when available)
3. **Flag budget-era context** — is there a provincial or federal budget that would inform one of the myths?

### Output

> **Blog refresh: "10 Myths About Government Grants in Canada"**
>
> **Summary of changes (4 updates recommended):**
> - **Myth 3** (funding amounts) — update to reflect 2026 program caps
> - **Myth 5** (eligibility) — CanExport expanded eligibility to digital services (Feb 2026)
> - **Myth 7** (SR&ED timing) — update based on changes announced in the 2026 federal budget
> - **Myth 10** (consultant value) — refresh the closing with 2026 proof points (1,400+ businesses, 18,000+ apps)
>
> **Edits:**
>
> *(specific passage-level edits follow)*
>
> **Last updated note** (top of blog):
> *"Last updated: April 2026 — refreshed to reflect the 2026 federal budget and CanExport eligibility expansion."*
>
> **Optional LinkedIn flag:**
> *"Refreshed our '10 Myths About Government Grants' post with 2026 updates — including the CanExport eligibility expansion and latest SR&ED changes. [Link]"*

---

*For email blasts promoting new or refreshed blogs, see `OTHER_CONTENT`. For stats integration in blogs, see `DATA_SOURCES`.*
