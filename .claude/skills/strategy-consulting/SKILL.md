# Strategy Consulting Skill

**How Granted's consultants think: discovery, sizing, sequencing, client conversations, red flags, and timing.**

This skill is for supporting Granted's internal strategy consulting team. The user is a consultant (or another team member) preparing for or debriefing client work — not a client. Distilled from hundreds of real consultations (Jorge, Stephanie) via the strategic consulting doc lineage; this is the internal edition.

This is NOT a program reference. It teaches consultant judgment that operates across all programs. For program-specific intelligence, load `granted-insights` (consultant-grade go/no-go reads by grant type) or `grants` (eligibility/matching/validation methodology), and use `search_getgranted` for live program data.

## When to Use This Skill

Load a sub-skill when a consultant asks you to:
- **Prep for a discovery or strategy call** — what to probe, adapted to client type and who's on the call
- **Rightsize a prospect** — which service tier actually fits their situation
- **Build or sanity-check a grant roadmap** — what order, what to defer, how to layer
- **Prep for a hard conversation** — objections, competitive questions, skeptical stakeholders
- **Screen a prospect for red flags** — disqualifiers and "say no well"
- **Advise on timing** — fiscal year plays, apply-before-spend, application sequencing

## Sub-Skills

| Sub-skill | Load when the consultant needs... | Contents |
|---|---|---|
| `DISCOVERY` | Call prep, intake review, "what should I ask?" | The five core dimensions, probes for 11 client types, 5 critical eligibility gates, adapting to contact type |
| `SIZING` | "Which tier fits this client?" | Sizing decision tree by revenue/volume/sophistication, rightsizing principles |
| `SEQUENCING` | Roadmap building, prioritization | 5-part priority framework, 9 real sequencing patterns, annual strategy rhythm |
| `CONVERSATIONS` | Prep for pitching, objections, differentiation questions | Trust-building principles, analogies that land, sophistication-adapted framing, the objection playbook |
| `RED_FLAGS` | Prospect screening, "should we take this client?" | 9 hard disqualifiers, 10 soft red flags, how to deliver a "no" |
| `TIMING` | "When should they apply/spend/file?" | Apply-before-spend, fiscal-year strategy, semester alignment, re-application plays |

## Decision Tree

- "Prep me for a discovery call with [client]" → `DISCOVERY` (+ pull their HubSpot record first)
- "Meeting a manufacturer / family business / forestry company tomorrow" → `DISCOVERY` (client-type probes)
- "Should this client be on Starter or Pro?" → `SIZING`
- "Build a grant roadmap for this client" → `SEQUENCING` (+ `grants` matching if programs aren't identified yet)
- "They asked how we're different from Fundica / they got burned before" → `CONVERSATIONS`
- "Any red flags before we take this prospect?" → `RED_FLAGS`
- "When should they apply? Can they book the trade show booth now?" → `TIMING`
- Full strategy-call prep for a specific client → `DISCOVERY` + `RED_FLAGS`, then `SEQUENCING` for the roadmap

## Working With Live Data

This skill is methodology. Ground it in current data before advising:
- Client facts: `search_hubspot_companies` / `get_hubspot_company` / `get_grant_application`
- Program fit and status: `search_getgranted`, then `grants/validation` before recommending
- Granted's actual track record on a program: `get_program_stats`, `search_recent_wins` — use real numbers, don't quote remembered stats
- Landscape changes: `get_visualping_alerts`

## Boundaries

- **Always give consultants specific program names.** This is internal — the full picture, always. (The client-facing edition of this material withholds program names in lead-gen contexts; that rule does not apply here.)
- **No approval promises.** Help the consultant frame strength honestly: "strong candidate," never "you'll definitely get this."
- **Don't help force a poor fit.** If the honest read is "not a fit," say so and suggest what changes the equation.
- **No tax or legal advice.** Flag SR&ED/IP/compliance implications; recommend specialist partners for the actual advice.
- **Don't speculate on program changes.** If current status is unknown, verify (`grants/validation`) or say it needs verification.
- **Grants are not free money.** Keep the reimbursement model and cost-carry reality front and center in any framing you help build.

## What Moved Elsewhere

The source document's tactical program mechanics section (hiring grant streams, BC ETG detail, CanExport operational detail, candidate-pool prioritization) is intentionally NOT here. For that layer: `granted-insights` sub-skills by grant type, `grants` methodology, `search_getgranted` for live program cards. Keep this skill program-agnostic so it doesn't go stale.
