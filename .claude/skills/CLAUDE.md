# `.claude/skills/CLAUDE.md` — Skills in the AI Hub

How skills work here and how to add new ones. Read this before modifying anything under `.claude/skills/` or touching `load_skill`-related code.

## What a skill is (in this repo)

A skill is a runtime-loadable content module that an agent invokes via the `load_skill` tool. The model calls it, the server reads the corresponding file from disk, the content returns in the tool result.

Skills in this repo are NOT the same thing as Claude Code's native `.claude/skills/` `SKILL.md` format. Our skills use a custom registry system. Superficially the folder path matches; the loading mechanism is entirely different.

## The 5 registration touchpoints

Every skill must be wired at all five of these points. Missing any one creates silent drift.

| # | What | Where |
|---|------|-------|
| 1 | Content on disk | `.claude/skills/{skill-name}/{sub-skill}.md` |
| 2 | `SKILL_PATHS` mapping | `src/tools/load-skill.js:21-66` |
| 3 | `skill_name` + `sub_skill` enums | `src/tools/definitions.js` — `skill_name` at line 1381, `sub_skill` at lines 1386-1393 |
| 4 | Description body | `src/tools/definitions.js:1305-1375` (`LOAD_SKILL_TOOL.description`) |
| 5 | Tool subset (conditional) | `src/tools/definitions.js` — e.g., `coreHubSpotTools` at line 2056 |

### Layer-by-layer, what happens when you skip one

- **Skip 1 (no folder):** `loadSkill()` returns `{ success: false, error: "file not found" }` to the agent
- **Skip 2 (no `SKILL_PATHS` entry):** `loadSkill()` throws `"Unknown skill"` — this is the actual server-side gate (see `load-skill.js:79-81` and `:85-87`)
- **Skip 3 (missing from enum):** The model may still call it successfully — the enum is a hint to Anthropic's API, not server-enforced — but it won't appear in schema docs and the model may not discover it
- **Skip 4 (no description):** Model doesn't know the skill exists. Silent omission.
- **Skip 5 (tool subset):** Agent may call the skill but lack underlying tools. Skill instructs model to call tools the agent can't use. Runtime errors.

## What "enum is a hint, not enforcement" means

The `skill_name` enum in `LOAD_SKILL_TOOL` is documentation for the Anthropic API. It's not validated server-side. Server validation happens at `SKILL_PATHS` lookup in `loadSkill()` (see `load-skill.js:79-81`). This is why `granted-marketing` worked in production even while missing from the enum — the enum drifted, but the `SKILL_PATHS` entry carried the calls. Do not rely on this. Fix drift when you see it.

## The reference implementation: `hubspot/DEAL_CREATION`

Study this skill before adding a new one. It's correctly wired at all 5 touchpoints:

- **On disk:** `.claude/skills/hubspot/DEAL_CREATION.md` (~90KB, single file, no `SKILL.md` entry point)
- **`SKILL_PATHS`:** `src/tools/load-skill.js:51-53` maps `hubspot.DEAL_CREATION` → `.claude/skills/hubspot/DEAL_CREATION.md`
- **Enums:** `hubspot` in `skill_name` at line 1381, `DEAL_CREATION` in `sub_skill` at line 1391
- **Description:** block at `definitions.js:1338-1339`, example at line 1373: `"Create a WorkBC deal for TechCo" → load_skill(hubspot, DEAL_CREATION)`
- **Tool subset:** `coreHubSpotTools` at lines 2056-2068 includes every tool the skill teaches (`list_hubspot_owners`, `create_hubspot_deal`, `update_hubspot_deal`, etc.)

The comment at `definitions.js:2051-2055` states the invariant:

```
// Tools referenced by skills (e.g., DEAL_CREATION references list_hubspot_owners
// in Section 5.6) must be listed here — otherwise the agent will see the skill
// instruction but lack the tool to follow it.
```

This is a human-maintained invariant — no automation enforces it. When writing a skill that teaches tools, double-check the appropriate tool subset.

## Current skill inventory (as of April 2026)

The "Invoked by" column shows agents whose prompts actually invoke the skill — not just agents that could load it via tool loadout. Availability via tool loadout is noted separately.

| Skill | Sub-skills | Invoked by |
|-------|------------|------------|
| `sales` | `lead_farming`, `linkedin_enrichment`, `data_quality`, `icp_analysis` | Oracle |
| `grants` | `overview`, `eligibility`, `matching`, `validation` | Oracle |
| `research` | `company_intelligence` | (pre-provisioned, folder doesn't exist yet) |
| `canexport-writer` | `overview`, `PROGRAM_DETAILS`, `APPLICATION_STRUCTURE`, `KNOWLEDGE_BASE_INDEX`, `STAGE_1_READINESS`, `STAGE_1_BUDGET_GUIDE`, `STAGE_1_INTERVIEW_QUESTIONS`, `STAGE_2_DRAFTING`, `STAGE_3_REVIEW` | canexport-writer |
| `bcafe-writer` | `FINAL_REPORT` | bcafe-writer |
| `hubspot` | `DEAL_CREATION` | Oracle |
| `granted-marketing` | `overview`, `FOUNDATIONS`, `COMPANY_CONTEXT`, `GRANT_BLASTS`, `BLOGS`, `OTHER_CONTENT`, `DATA_SOURCES` | Oracle |
| `grant-card-writing` | `OVERVIEW`, `RD`, `BUSINESS_ASSESSMENT`, `MARKET_EXPANSION`, `HIRING_TRAINING`, `SYSTEMS_PROCESSES`, `CAPITAL_COST`, `LOANS`, `INVESTMENT`, `PRIZES_CONTESTS` | grant-card-generator |
| `grant-card-tagging` | `OVERVIEW` | grant-card-generator |

### Which agents have `LOAD_SKILL_TOOL`

Only agents with `LOAD_SKILL_TOOL` in their `getToolsForAgent` case (see `src/tools/definitions.js:2047`) can invoke skills. Currently:

- `bcafe-writer` (line 2083)
- `canexport-writer` (line 2091)
- `internal-oracle` (line 2105)
- `orchestrator` (line 2114) — receives it transitively via `ALL_TOOLS`
- `grant-card-generator` (line 2257)

Having the tool doesn't mean a skill is invoked. `bcafe-writer` and `canexport-writer` have `LOAD_SKILL_TOOL` and HubSpot tool access, but their prompts don't instruct invoking `hubspot/DEAL_CREATION`. Only Oracle's prompt currently invokes the `hubspot` skill.

## Separate pattern: prompt-load skills

`lead-gen-variant-b/` is NOT a runtime-loadable skill. Despite living under `.claude/skills/`, its contents are concatenated into the system prompt at prompt-load time by `loadAgentPrompt()` in `src/agents/load-agents.js:40-65`. Selected via `LEAD_GEN_VARIANT=B` env var (`load-agents.js:35`).

**Do not add `lead-gen-variant-b` to `SKILL_PATHS`. Do not try to load it via `load_skill`.** It's a different mechanism entirely.

## Naming conventions

The `overview` sub-skill is consistently lowercase across every skill that uses it (`grants`, `canexport-writer`, `granted-marketing`, `staff-meeting-recap`). Newer skills (`grant-card-writing`, `grant-card-tagging`) use uppercase `OVERVIEW` for the parent entry — both casings coexist intentionally in the global `sub_skill` enum.

For non-`overview` sub-skills, convention splits by vintage:

- **Legacy skills** use `lowercase_snake`: `sales` (`lead_farming`, `linkedin_enrichment`), `grants` (`eligibility`, `matching`, `validation`), `research` (`company_intelligence`)
- **Newer skills** use `UPPERCASE_SNAKE`: `canexport-writer` (`STAGE_1_READINESS`, `APPLICATION_STRUCTURE`), `hubspot` (`DEAL_CREATION`), `bcafe-writer` (`FINAL_REPORT`), `granted-marketing` (`FOUNDATIONS`, `GRANT_BLASTS`)

When extending an existing skill, follow its established casing. When creating a new skill, `UPPERCASE_SNAKE` for substantive sub-skills + lowercase `overview` is the newer pattern.

## How to add a new skill

Before writing any code, answer three questions:

1. **What's the right granularity?** A skill is a coherent workflow or knowledge domain. Multiple sub-skills under one `skill_name`, not a proliferation of top-level skills.
2. **Does it teach the model to use specific tools?** If yes, those tools need to be in the agent's loadout (and possibly in a tool subset like `coreHubSpotTools`).
3. **Which agents should have access?** Only agents with `LOAD_SKILL_TOOL` in their switch case can load any skill.

Then execute these steps in order:

### Step 1: Content on disk

```
.claude/skills/{skill-name}/
  ├── SKILL.md              (optional, use if you have an overview file — matches `overview` sub-skill key)
  ├── {SUB_SKILL_1}.md
  ├── {SUB_SKILL_2}.md
  └── ...
```

Some skills use `SKILL.md` as the overview entry point (`granted-marketing`, `canexport-writer` do; `bcafe-writer`, `hubspot` do NOT). Match the pattern of the closest analog.

### Step 2: Register in `SKILL_PATHS`

Edit `src/tools/load-skill.js`. Add to the `SKILL_PATHS` object (around lines 21-66):

```javascript
'your-skill-name': {
  overview: '.claude/skills/your-skill-name/SKILL.md',  // if applicable
  SUB_ONE: '.claude/skills/your-skill-name/SUB_ONE.md',
  SUB_TWO: '.claude/skills/your-skill-name/SUB_TWO.md',
}
```

### Step 3: Add to enums

Edit `src/tools/definitions.js`:

- Line 1381: add `'your-skill-name'` to the `skill_name` enum array
- Lines 1386-1393: add any new sub-skill names to the `sub_skill` enum array (existing entries like `overview`, `FOUNDATIONS` can be reused — the enum is a flat global list)

### Step 4: Update `LOAD_SKILL_TOOL.description`

In the description body (lines 1305-1375), add a block like:

```
**Your Skill Name:**
- `overview` - One-line description
- `SUB_ONE` - One-line description
- `SUB_TWO` - One-line description
```

And optionally add an example line to the "Load skills for specialized tasks" section:

```
- "Example trigger phrase" → load_skill(your-skill-name, SUB_ONE)
```

### Step 5: Tool subset (if needed)

If your skill teaches tools that live in a restricted subset (like `coreHubSpotTools` at line 2056), add the necessary tools to that subset. Otherwise skip — the skill will still load.

If your skill teaches tools the agents using it DON'T have, those agents will fail when the model tries to call the tools. Either:

- Add `LOAD_SKILL_TOOL` + the underlying tools to the agent's switch case in `getToolsForAgent`, OR
- Don't let that agent use the skill

### Step 6: Verify

- Read the diff: only 2 files should change (`definitions.js`, `load-skill.js`). The skill content files are new.
- Stage, commit, push.
- Test by invoking the skill from an agent that has `LOAD_SKILL_TOOL` and verifying the `tool_result` comes back with `success: true` and the expected content.

## How to modify an existing skill

- **Usually safe:** edit the content files in `.claude/skills/{skill-name}/`. Content changes don't require registry updates.
- **Needs registry update:**
  - Renaming a sub-skill → update `SKILL_PATHS`, enum, description
  - Removing a sub-skill → delete the file, remove from `SKILL_PATHS`; leave the enum entry if other skills use the same name
  - Adding a sub-skill → add the file, add to `SKILL_PATHS`, add to description, ensure the `sub_skill` name is in the enum (reuse if possible)

## Gotchas

- **Don't rely on the enum alone.** It's a hint. Actual server gate is `SKILL_PATHS` (`load-skill.js:79-81`). But if you skip the enum, the model may not discover the skill.
- **`coreHubSpotTools` is human-maintained.** No test enforces the invariant. When adding HubSpot tools to a skill, double-check the subset.
- **No caching.** `loadSkill()` reads from disk every call (see `load-skill.js:98`). Content changes take effect immediately on next invocation. (Good for development. Slightly wasteful at scale.)
- **Error surface is silent-ish.** `loadSkill()` returns `{ success: false, error }` for read failures — it does not throw. Exception: unknown `skill_name`/`sub_skill` throws `"Unknown skill"` before reaching the read. Check the `tool_result` content for `success` flag.
- **Sub-skills are global.** The `sub_skill` enum is shared across all skills. Two skills can use the same sub-skill name (e.g., `overview` — used by 4 skills). Not a namespace collision.

## When something's broken

Don't guess at the registry state. Use the researcher subagent:

```
/investigate check the current state of skill registration: compare skill_name enum
in definitions.js, SKILL_PATHS in load-skill.js, and actual folders under
.claude/skills/. Report any mismatches.
```

For diagnosing whether a specific `load_skill` call succeeded or failed, query the `messages` table for the conversation (see root `CLAUDE.md` — storage section) and look for `tool_use` / `tool_result` pairs.
