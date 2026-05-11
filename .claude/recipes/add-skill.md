# Recipe: Add a new skill

Follow this recipe when adding a new skill to the AI hub. Skills are runtime-loadable content modules invoked via the `load_skill` tool. Each skill must be wired at 5 registration touchpoints — miss any one and you get silent drift.

This recipe is prescriptive. Follow every step in order. Do not skip "obvious" ones.

## When to use this recipe

Use when:
- Adding a brand-new skill (new folder under `.claude/skills/`)
- Adding a sub-skill to an existing skill (new file inside an existing skill folder)

Do NOT use for:
- Editing existing skill content (just edit the `.md` file directly)
- Prompt variant systems like `lead-gen-variant-b/` (different loading mechanism — see `.claude/agents/CLAUDE.md`)

## Inputs you need before starting

Collect these from the user before touching any file. If any are unclear, stop and ask.

1. **Skill name** — lowercase-kebab-case (e.g., `granted-validation`, `workbc-claims`). For new skills, folder name should match skill name. Note: three legacy skills (`sales`, `grants`, `research`) use `-consultant`-suffixed folder names (`sales-consultant/`, etc.); don't copy that pattern for new skills.
2. **Sub-skill name(s)** — one or more. Naming convention depends on skill:
   - For new skills or sub-skills added to `canexport-writer`, `bcafe-writer`, `hubspot`, `granted-marketing`, `grant-card-writing`, `grant-card-tagging`: use UPPERCASE_SNAKE_CASE (e.g., `RUBRIC_V1`, `CLAIMS_PACKAGE`)
   - For sub-skills added to `sales`, `grants`, `research`: use lowercase_snake_case (e.g., `lead_farming`, `eligibility`)
   - The `overview` sub-skill name is reserved for top-level skill entry points
3. **Skill content** — the `.md` file content for each sub-skill. Must be pre-written before starting this recipe.
4. **Which agents will invoke this skill** — list of agent names. Determines Step 5.
5. **Tool dependencies** — does the skill instruct the model to call any runtime tools? If yes, which ones? Determines Step 6.

## Pre-flight checks

Run these before making any edits. Stop immediately if any fail.

**Check 1: skill name doesn't already exist**
```bash
ls .claude/skills/
```
If a folder with your proposed name already exists, STOP. Either you're adding a sub-skill (skip Step 1 below) or you need a different name.

**Check 2: sub-skill names don't collide with existing enum values**
Read `src/tools/definitions.js` lines 1386-1393 (the `sub_skill` enum). The `sub_skill` namespace is GLOBAL across all skills — if any existing skill uses the same sub-skill name, you'll share the enum entry. The lowercase `overview` entry is already shared across `grants`, `canexport-writer`, `granted-marketing`, `staff-meeting-recap`; the uppercase `OVERVIEW` entry is shared across `grant-card-writing`, `grant-card-tagging` — both are intentional. For other names, decide deliberately whether sharing or renaming is correct.

**Check 3: at least one target agent has `LOAD_SKILL_TOOL`**
Open `src/tools/definitions.js`, find `getToolsForAgent` at line 2047. Agents with `LOAD_SKILL_TOOL`: `bcafe-writer` (line 2083), `canexport-writer` (line 2091), `internal-oracle` (line 2105), and `orchestrator` via `ALL_TOOLS` (line 2114).

If none of your target agents have `LOAD_SKILL_TOOL`, the skill cannot be invoked.

## The 5 registration touchpoints

Execute in order.

### Step 1: Create content on disk

```bash
mkdir -p .claude/skills/<skill-name>
```

Write each sub-skill file at:
````
.claude/skills/<skill-name>/<SUB_SKILL>.md
````

If the skill has a top-level `overview`, add `SKILL.md`:
````
.claude/skills/<skill-name>/SKILL.md
````

Not every skill follows this convention — `sales-consultant/` has a `SKILL.md` on disk that is NOT registered as an `overview` entry in `SKILL_PATHS`. Follow the convention for new skills; don't assume every existing skill matches.

### Step 2: Add to `SKILL_PATHS` in `src/tools/load-skill.js`

Open `src/tools/load-skill.js`. Locate the `SKILL_PATHS` object (starts at line 21).

Append your skill as a new property. The object is insertion-order, not alphabetical — add at the end.

Shape:
```javascript
'<skill-name>': {
  '<SUB_SKILL_1>': '.claude/skills/<skill-name>/<SUB_SKILL_1>.md',
  '<SUB_SKILL_2>': '.claude/skills/<skill-name>/<SUB_SKILL_2>.md',
  overview: '.claude/skills/<skill-name>/SKILL.md'
}
```

Example from `hubspot` skill (lines 51-53):
```javascript
'hubspot': {
  DEAL_CREATION: '.claude/skills/hubspot/DEAL_CREATION.md'
}
```

**Failure mode if skipped:** `loadSkill()` throws `"Unknown skill: <name>. Available skills: ..."` at `load-skill.js:79-81`. This is the actual server-side gate.

### Step 3: Add to enums in `src/tools/definitions.js`

**3a: `skill_name` enum at line 1381**

Append your skill name to the array. Live enum is insertion-order, not alphabetical:
```javascript
skill_name: {
  type: "string",
  enum: ["sales", "research", "grants", "canexport-writer", "bcafe-writer", "hubspot", "granted-marketing", "staff-meeting-recap", "grant-card-writing", "grant-card-tagging", "<your-skill-name>"]
}
```

**3b: `sub_skill` enum at lines 1386-1393**

Append each new sub-skill name. This enum is global — do not duplicate if the name already exists.

**Failure mode if skipped:** The model may still call the skill (enum is a hint to the Anthropic API, not server-enforced), but schema won't advertise it properly.

### Step 4: Update `LOAD_SKILL_TOOL.description`

Open `src/tools/definitions.js`, find `LOAD_SKILL_TOOL.description` (lines 1305-1375).

**4a: Add a description line** in the list of skills:
````
- `<skill-name>`: <one-line purpose>
````

**4b: Add at least one invocation example** in the examples block (runs from 1362-1375). Insert before the trailing grant-card-tagging example line:
````
"<natural language trigger>" → load_skill(<skill-name>, <SUB_SKILL>)
````

**Failure mode if skipped:** Model doesn't know the skill exists. Silent omission.

### Step 5: Verify agent tool loadouts

For each target agent, open `getToolsForAgent` in `src/tools/definitions.js` (line 2047). Confirm their case includes `LOAD_SKILL_TOOL`.

If missing, add it. If adding `LOAD_SKILL_TOOL` is the only change to the agent, note it in `DECISIONS.md` — this is a meaningful capability change.

### Step 6: Update tool subset (conditional)

**Only applies if** your skill instructs the model to call runtime tools.

For HubSpot tools referenced by any `hubspot` skill: add to `coreHubSpotTools` at `definitions.js:2056-2068`. This applies to both read tools (`search_hubspot_contacts`, `list_hubspot_owners`) and write tools (`create_hubspot_deal`, `update_hubspot_deal`).

For other tool categories: check whether a curated subset exists for the target agent. If yes, add there. If no, add directly to the agent's case in `getToolsForAgent`.

**The invariant** (verbatim from `definitions.js:2051-2055`):
````
// Core HubSpot tools needed for most agents (enrichment, search, CRUD operations).
// This whitelist feeds the Oracle and other curated agents. Tools referenced by
// skills (e.g., DEAL_CREATION references list_hubspot_owners in Section 5.6) must
// be listed here — otherwise the agent will see the skill instruction but lack
// the tool to follow it.
````

**Failure mode if skipped:** Agent loads the skill, reads "call `create_hubspot_deal`," but the tool isn't in its loadout.

## Verification

**1. Diff review:**
```bash
git diff src/tools/load-skill.js src/tools/definitions.js
git status .claude/skills/
```

Expect: 2 modified files + N new files under `.claude/skills/<skill-name>/`.

**2. Registry status table:** 3-column comparison of `skill_name` enum / `SKILL_PATHS` keys / on-disk files. All three must agree.

**3. Live invocation test:** Prompt a target agent in a way that should trigger the skill. Then:
```bash
node scripts/inspect-conversation.js --agent <agent-type> --limit 1 --format trace
```

Confirm `load_skill` appeared in the tool trace and returned `success: true`.

**Diagnosis guide:**
- `success: false, error: "file not found"` → Step 1 or 2 wrong (path mismatch)
- Model never calls the skill → Step 3 or 4 wrong (enum or description)
- Skill loads but agent can't follow instructions → Step 5 or 6 wrong (missing tools)

**4. Log the decision:**
````
/log-decision Added <skill-name> skill with sub-skills X, Y. Used by agents A, B.
````

## Rollback

- Files on disk: `rm -rf .claude/skills/<skill-name>/`
- Code edits: `git checkout src/tools/load-skill.js src/tools/definitions.js`
- Already committed: `git revert <commit>`

## Reference implementation

Study `hubspot/DEAL_CREATION` — the gold standard, all 5 touchpoints correctly wired:
- Disk: `.claude/skills/hubspot/DEAL_CREATION.md`
- `SKILL_PATHS`: `load-skill.js:51-53`
- Enums: `skill_name` line 1381, `sub_skill` line 1391
- Description: `definitions.js:1338-1339` + example line 1373
- Tool subset: `coreHubSpotTools` lines 2056-2068

## See also

- `.claude/skills/CLAUDE.md` — skill system reference
- `.claude/agents/CLAUDE.md` — agent definition reference
- `src/tools/CLAUDE.md` — tool system reference
