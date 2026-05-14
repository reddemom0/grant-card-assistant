# LINKEDIN

Playbook for LinkedIn post drafting — Grant Blast posts, webinar promo, blog promo, success stories, holiday/observance, team humanization, memes, industry calendar moments, event attendance. Load when the user asks for a LinkedIn post of any kind.

**Prerequisites:** Load `FOUNDATIONS` and `COMPANY_CONTEXT` first.

---

## 1. Post types in the rotation

- **Grant Blast post** (see `GRANT_BLASTS`)
- **Webinar promo** (announcement + Monday-prior)
- **Blog promo** (new or refresh)
- **Success story** — public case studies, testimonial quotes
- **Holiday / observance** — aligned to the content calendar
- **Team humanization** — intros, behind-the-scenes, values-driven posts
- **Meme / cheeky** — lighter-weight brand personality
- **Industry calendar moments** — Manufacturing Month, Small Business Week, Indigenous Peoples Month
- **Event attendance / speaking** — when Stephanie or team is at an event

## 1a. When the user doesn't name a specific piece of content

When the user names a content type — *"draft a Blog promo"* / *"draft a success story post"* — without saying which blog or which story, list recent candidates from granted.ca before drafting. Don't draft a piece you can't anchor to a real published post.

**Always** call `get_recent_granted_ca_post()` before drafting a Blog promo (no params; defaults to the most recent 10 blog posts in the last 30 days, all categories). **Always** call `get_recent_granted_ca_post({ category: 76 })` before drafting a Success story post (filters to published Customer Success posts).

If the user already named the specific blog or story (slug, title, or URL), skip the call — you already have the subject.

After the call, list the results with `title` and `modified` date, end the response with a "which one would you like to use?" question, and wait for the user to pick before drafting.

Three outcomes to handle:

- **Recent matches found** — list them as candidates and ask the user to pick. Don't pick for them, even when one is clearly the most recent. The marketer's editorial judgment is the point.
- **No recent matches in the default window** — surface that honestly. Don't auto-widen the window silently; that's a workflow choice the user should make. Ask whether they want to (a) widen the window (e.g., `days: 90`, or `days: 365` for category 76 since success stories are published less often), (b) pivot the approach (write something fresh? draft a teaser without anchoring?), or (c) wait for new content.
- **No matches across any window the user asks for** — same honesty discipline. Do not invent a blog or story that doesn't exist on granted.ca, and do not synthesize a slug or title from training memory.

## 2. Core structure

- **Hook in first line** — under 15 words (15-word rule from `FOUNDATIONS`). LinkedIn truncates at ~3 lines, so frontload.
- **One idea per post.** Don't try to cover multiple angles.
- **Scannable** — line breaks between sentences
- **CTA in the last line** — clear and specific
- **Hashtags** — 1–3 max, relevant

## 3. Voice (LinkedIn-specific)

- **Conversational but credible.** Not as loose as Twitter/X. Not as polished as a press release.
- **First-person preferred** — feels human
- **Hot takes welcome** when genuinely held. Safe / vague posts get ignored.
- **Memes earn their place** — use sparingly, and only after enough ratio-correct serious posts to have built credibility

## 4. When attribution matters

- **Broad brand content** — unattributed or "the Granted team"
- **Thought leadership** — Stephanie
- **Industry-specific** — the consultant for that industry (Ruk for construction/ag/manufacturing, Jorge for environmental/tech/aerospace)
- **Humanization** — the specific person being featured

See `COMPANY_CONTEXT` for the full voice roster.

---

*For email equivalents of these post types, see `EMAILS`. For success-story posts, the underlying narrative structure lives in `SUCCESS_STORIES`. For webinar-promo posts, the cadence and promo sequence live in `WEBINARS`.*
