# SUCCESS_STORIES

Playbook for drafting client success stories and case studies — long, short, and abridged formats. Load when the user asks to turn a client outcome into a success story, write up a case study, or feature a named client.

**Prerequisites:** Load `FOUNDATIONS` and `COMPANY_CONTEXT` first.

---

## 1. Core narrative format

Granted's four-part case study structure. Use this for every success story — long, short, or abridged:

1. **The Business** — 2–3 sentences establishing who they are. Industry, size, what makes them interesting.
2. **The Opportunity** — the problem or goal. Why grants were relevant. What they didn't know going in.
3. **The Story** — how they came to Granted, what Granted did, friction points addressed.
4. **The Outcomes** — specific dollar amounts secured, business impact (hires, training, expansion), named client quote.

## 2. Three length variants

**Long version** (full case study for website):
- Company basics: name, industry, size, what they do
- Hopes when first exploring grants (hiring / training / expansion / R&D / exporting)
- What made grants difficult before Granted
- When they started working with Granted (month / year)
- Services provided (grant ID & planning / application writing / hiring grants / training grants / ongoing strategy)
- Results: total funding $, # hiring grants, # training grants, other grant types
- Business impact (hires, upskilled staff, growth, risk reduction, new markets)
- What they're planning to do next
- Testimonial (named person with title)
- Permission to share

**Short version** (web snippet, social, email):
- Business name + industry
- Total grant funding secured: $__________
- Main goal
- Which grants Granted helped secure
- Short testimonial (few sentences)
- Name, title
- Permission to share

**Abridged version** (quote + context):
- Business name
- Biggest challenge with grants before Granted (one line)
- Results seen (one line: funding secured, new hires, team upskilled, growth accelerated, risk reduced)
- One-sentence impact + one-sentence testimonial
- Name, title
- Permission to share

## 3. Voice rules (success stories)

- **Let the client's language come through** — don't over-polish the testimonial
- **Quantify where possible** ($X secured, Y hires, Z months saved)
- **Show before/after** — don't just assert "we were great"
- **If total funding is large, call it out:** *"[Business Name] secured over $XXX,XXX in their first year with Granted"*
- **Use the four-part structure** even in short variants — compress sections, don't drop them

## 4. Anonymization (when consent isn't given or specifics need protection)

Default to **named + consented**. When consent isn't given, substitute a plausible pseudonym:
- "Naked Snacks" → "Nuts 'n Stuff"
- "Wide Funnel" → "ConversionWizards"
- "Magnum Nutraceuticals" → "Trojan Horse Supplements"

**Keep industry and scale accurate; change the name only.** Never invent dollar amounts, employee counts, or outcome details.

## 5. Recurring themes in Granted's case studies

Useful patterns when drafting new ones:
- "Boil the ocean" → narrowing focus
- "Paperwork burden" → relief through Granted
- "No more than 2 hours" of client time per application
- Fear of employee development → relieved by training grants
- Cash flow pressure → eased by grants
- Referrals to Granted → client feels like a "rock star" for passing it along

## 6. Public case study references

See `COMPANY_CONTEXT` §9 for the full list of named, public case studies (Glass Canvas, Keystone Environmental, Prairie Coast Equipment, FansUnite, Santevia, ClearWest) and the testimonial quote bank.

**Coverage check before drafting.** Before writing a new success story, check what already exists on granted.ca:

1. Call `check_blog_coverage({ category: 76 })` to surface published Customer Success posts. This is the corpus of stories already on the site.
2. If drafting on a specific company, also call `check_blog_coverage({ topic: "<client name>" })` to find any post that mentions them.

Read each result's `title`, `excerpt`, and `modified` date before deciding what to draft. The point is to **shape the angle, not skip the client**:

- **Story exists and is recent** → the new piece is a refresh, a different length variant (long → abridged for social, abridged → long for the website), a different format (written → quote + context for an email), or a follow-up angle ("here's what's happened since"). Don't republish.
- **Story exists but is stale** (older `modified` date, outdated funding numbers, expired program references) → the new piece is an explicit refresh; reuse the four-part structure but update outcomes and quotes.
- **No story exists or matches are loose/incidental** → new angle. Proceed with the four-part structure.

---

*For success story share emails, see `EMAILS`. For LinkedIn success story posts, see `LINKEDIN`. For stat sourcing (funding amounts, deal counts), see `DATA_SOURCES`.*
