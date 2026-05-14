# EMAILS

Playbook for marketing email drafting — Grant Blast emails, Blog Blast emails, webinar promo sequences, success story shares, post-webinar follow-ups, re-engagement / winback emails, and GetGranted platform promos. Load when the user asks for an email draft of any kind that isn't a sales-led 1:1 outreach.

**Prerequisites:** Load `FOUNDATIONS` and `COMPANY_CONTEXT` first.

---

## 1. Email types in the current mix

- **Grant Blast** — weekly (handled in `GRANT_BLASTS`)
- **Blog Blast** — announcing a new or refreshed blog
- **Webinar promo sequence** — teaser → announcement → final reminder
- **GetGranted platform promo** — monthly-ish
- **Success story share**
- **Post-webinar follow-up** — recording + CTA to grant calculator + CTA to next webinar
- **Re-engagement / winback** — per customer journey stage

## 1a. When the user doesn't name a specific piece of content

When the user names a content type — *"draft a Blog Blast"* / *"draft a success story share email"* — without saying which blog or which story, list recent candidates from granted.ca before drafting. Don't draft a piece you can't anchor to a real published post.

**Always** call `get_recent_granted_ca_post()` before drafting a Blog Blast (no params; defaults to the most recent 10 blog posts in the last 30 days, all categories). **Always** call `get_recent_granted_ca_post({ category: 76 })` before drafting a Success story share (filters to published Customer Success posts).

If the user already named the specific blog or story (slug, title, or URL), skip the call — you already have the subject.

After the call, list the results with `title` and `modified` date, end the response with a "which one would you like to use?" question, and wait for the user to pick before drafting.

Three outcomes to handle:

- **Recent matches found** — list them as candidates and ask the user to pick. Don't pick for them, even when one is clearly the most recent. The marketer's editorial judgment is the point.
- **No recent matches in the default window** — surface that honestly. Don't auto-widen the window silently; that's a workflow choice the user should make. Ask whether they want to (a) widen the window (e.g., `days: 90`, or `days: 365` for category 76 since success stories are published less often), (b) pivot the approach (write something fresh? draft a teaser without anchoring?), or (c) wait for new content.
- **No matches across any window the user asks for** — same honesty discipline. Do not invent a blog or story that doesn't exist on granted.ca, and do not synthesize a slug or title from training memory.

## 2. Core structure

- **Subject line** — specific over clever. Include the hook (program name, number, deadline).
- **Preview text** — completes the hook, doesn't repeat the subject
- **Opening** — single-sentence promise of what's in the email
- **Body** — 100–300 words. One core message. Bullets when scanning helps.
- **CTA** — one primary action. Secondary optional but don't dilute.

## 3. Voice rules (email-specific)

- **First-person** ("I" / "we") — feels human, not corporate
- **Short sentences. Short paragraphs.** One idea per paragraph.
- **Sign-off from a specific person** (typically Stephanie), not "the Granted team"
- **Cadence matches content type** — Grant Blasts are time-sensitive; re-engagement is patient

## 4. Segmentation (respect these)

- **Webinar-only contacts** → webinar communications only. No general marketing.
- **Marketing opt-in contacts** → full marketing touch
- **Active GetGranted users** → platform-specific comms (features, new grants added)
- **Specific webinar-timeslot segment** → post-webinar follow-up only

## 5. Compliance (always true)

- Marketing opt-in respected — webinar-only contacts get webinar-only communications
- Unsubscribe always present
- CASL compliance: clear sender identification, functional unsubscribe
- If a contact is no longer at a company: remove marketing opt-in, remove company association

---

*For stat sourcing when an email body cites a success rate or program detail, see `DATA_SOURCES`. For LinkedIn post equivalents, see `LINKEDIN`. For success-story narrative structure used in success story share emails, see `SUCCESS_STORIES`.*
