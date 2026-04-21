# Recipe: Add a new agent

Follow this recipe when adding a new agent to the AI hub. Agents are Claude-API conversational bots with specific prompts, tool loadouts, and UI routes. Adding one touches 4 systems: prompt file, tool loadout, frontend routing, and (optionally) AGENT_TYPE_MAP.

This recipe is prescriptive. Follow every step in order.

## When to use this recipe

Use when:
- Adding a new conversational agent with its own prompt and UI
- Adding a backend-only agent (no UI, invoked by other code) — skip Steps 3 and 4

Do NOT use for:
- Editing an existing agent's prompt (just edit the `.md` file directly)
- Creating a prompt variant for an existing agent (e.g., A/B test) — different pattern, see `lead-gen-variant-a.md` / `lead-gen-variant-b/` for the model
- Creating Claude Code subagents like `researcher` — those live in `.claude/agents/` but aren't backend agents; don't register them in `getToolsForAgent`

## Inputs you need before starting

1. **Agent name (agentType)** — lowercase-kebab-case. Backend identifier. Must match the `.md` filename without the extension. Examples: `grant-validator`, `bcafe-claims-helper`. Must be unique across all existing agents.
2. **Agent prompt content** — the full `.md` file content. Must be pre-written. Include YAML frontmatter with `name`, `description`, and `tools` fields. (Three agents omit frontmatter: `internal-oracle`, `lead-gen`, `lead-gen-variant-a`. The fallback pattern works but explicit frontmatter is preferred.)
3. **Frontend route** — the URL path users will visit. Examples: `/grant-validator`, `/bcafe-claims`. Must be unique. Skip this input for backend-only agents.
4. **Frontend display name** — shown in the unified-agents.html UI (e.g., "Grant Validator"). Skip for backend-only.
5. **Backend agentType mapping** — if the frontend route slug differs from the backend agentType, you need an AGENT_TYPE_MAP entry. Examples: `/oracle` → `internal-oracle`, `/grant-cards` → `grant-card-generator`. Convention: add an identity mapping even when slug === agentType (see Step 4b).
6. **Tool loadout** — which tools does this agent get? Choose from the constants at the top of `definitions.js`:
   - `SERVER_TOOLS` (line 16) — base for most agents
   - `ANTHROPIC_MEMORY_TOOL` (line 32) — writes to `.memories/` on disk
   - `MEMORY_TOOLS` (line 42) — Postgres-backed memory (memory_store/recall/list)
   - `LOAD_SKILL_TOOL` (line 1303) — required if the agent will invoke any skill
   - `HUBSPOT_TOOLS` (line 90) — full HubSpot tool set
   - `coreHubSpotTools` (line 2056) — curated HubSpot subset for skill-driven use
   - `GOOGLE_DRIVE_TOOLS` (line 1231), `GOOGLE_DOCS_TOOLS` (line 1646), `DROPBOX_TOOLS` (line 1278)
   - `ORACLE_TOOLS` — Oracle-specific search/research tools
   - `ALL_TOOLS` (line 2028) — everything (only orchestrator currently uses this)
7. **Whether to opt out of ANTHROPIC_MEMORY_TOOL** — Oracle does this deliberately (see `definitions.js:2098-2102`). Most new agents should include it.

## Pre-flight checks

**Check 1: agentType doesn't already exist**
```bash
ls .claude/agents/
```
If `<agentType>.md` exists, STOP.

**Check 2: frontend route doesn't collide**
Open `server.js` and grep for existing `app.get('/<route>` patterns. Confirm your proposed route is unused.

**Check 3: display name doesn't collide in the UI**
Open `unified-agents.html`, find the AGENTS config object (starts at line 860). Verify your proposed display name isn't already used.

## The 4 registration touchpoints

### Step 1: Create the agent prompt file

Write `.claude/agents/<agentType>.md`.

Standard structure (with frontmatter):
```markdown
---
name: <agentType>
description: <one-line summary of what this agent does>
tools:
  - tool_name_1
  - tool_name_2
---

# <Agent Display Name>

<prompt body>
```

**Important caveat:** The frontmatter `tools:` field is NOT load-bearing at runtime. The actual tool loadout is set in Step 2 (`getToolsForAgent`). The frontmatter is documentation for humans reading the prompt file. Keep it accurate so it matches runtime behavior, but know that editing it alone does nothing.

**Validation is directory-based:** `isValidAgentType` at `src/agents/load-agents.js:134` reads `.claude/agents/*.md` and accepts any filename. As soon as your file exists, the agentType is accepted. No additional registration needed for validation to pass.

### Step 2: Add the tool loadout in `getToolsForAgent`

Open `src/tools/definitions.js`, find `getToolsForAgent` at line 2047.

Add a new case:
```javascript
case '<agentType>':
  return [
    ...SERVER_TOOLS,
    ...MEMORY_TOOLS,
    ANTHROPIC_MEMORY_TOOL,  // omit this line only if deliberately opting out
    LOAD_SKILL_TOOL,         // omit if the agent won't invoke skills
    // ...other tool sets as needed
  ];
```

**Oracle's opt-out pattern** (verbatim from `definitions.js:2098-2102`):
````
// Oracle needs: search/enrichment tools + Oracle KB + minimal HubSpot + skill loading
// EXCLUDE filesystem-based ANTHROPIC_MEMORY_TOOL (.memories/) - wastes iteration checking empty directory
// KEEP Postgres-based MEMORY_TOOLS (conversation key-value store) and SERVER_TOOLS
// LOAD_SKILL_TOOL: uses the shared definition (not a per-agent copy) so Oracle can load
// hubspot/DEAL_CREATION and any future skills without enum drift.
````

Copy this pattern only if you have an equivalent deliberate reason.

**Failure mode if skipped:** The agent validates successfully (Step 1 passed) but has no tools. Every message returns text-only with no tool use capability.

### Step 3: Register the frontend route in `server.js`

Skip if this is a backend-only agent.

Open `server.js`. Find the block of `app.get('/<agent>*', serveUnifiedAgents)` registrations (around line 782). Add yours following the existing pattern:

```javascript
app.get('/<route>*', serveUnifiedAgents);
```

The `*` wildcard catches all sub-paths. `serveUnifiedAgents` returns the `unified-agents.html` file. Note: `authenticateUser` is NOT in the middleware chain for page routes — it's applied to `/api/*` routes only (including `/api/chat`). Page serves return the HTML shell; the API gate is where access control lives.

**Exception: standalone HTML pages.** `lead-gen` uses `lead-gen.html` directly, not `unified-agents.html` (`server.js:778-780`). Only use this pattern if your agent has genuinely different UI requirements — almost always, use `serveUnifiedAgents`.

**Failure mode if skipped:** Visiting `/<route>` returns 404. The agent works via direct API calls but has no UI.

### Step 4: Register the agent in `unified-agents.html`

Skip if this is a backend-only agent.

Open `unified-agents.html`. Two edits:

**4a: AGENTS config object** (starts at line 860)

Add an entry:
```javascript
'<route-slug>': {
  name: '<Display Name>',
  subtitle: '<one-line description shown in UI>',
  icon: '<SVG path markup>',  // e.g., '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5..."/>'
  prompts: [
    { title: '...', description: '...', prompt: '...' },
    { title: '...', description: '...', prompt: '...' }
    // 2-4 suggested prompts shown to the user
  ]
}
```

The `icon` field is SVG `<path>` markup, not an emoji or icon name. Copy an existing icon from `grant-cards` or another agent and swap the path data if needed. The `prompts` array seeds the "suggested prompts" UI — include 2-4 examples relevant to what the agent does.

Match the shape exactly — missing fields break the UI.

**4b: AGENT_TYPE_MAP** (at line 843)

Add an entry, even if the slug matches the agentType:
```javascript
const AGENT_TYPE_MAP = {
  'oracle': 'internal-oracle',
  'grant-cards': 'grant-card-generator',
  'etg-writer': 'etg-writer',         // identity mapping — live convention
  // ...
  '<route-slug>': '<agentType>'        // add yours here
};
```

**Convention:** The live `AGENT_TYPE_MAP` includes identity entries even where the `|| urlAgentName` fallback at `getBackendAgentType()` (line 856) would suffice. Add an explicit identity entry to match this convention; don't rely on the fallback.

**Failure mode if skipped (4a):** The route resolves, the page loads, but the agent doesn't appear in the UI dropdown. Users can't select it.

**Failure mode if skipped (4b):** Identity fallback covers the case, but your agent now deviates from the codebase convention.

## Verification

**1. Diff review:**
```bash
git diff src/tools/definitions.js server.js unified-agents.html
git status .claude/agents/
```

Expect: 3 modified files + 1 new file under `.claude/agents/`.

**2. Validation check:**
```bash
node -e "import('./src/agents/load-agents.js').then(m => console.log(m.isValidAgentType('<agentType>')))"
```

Should print `true`.

**3. Tool loadout check:**
```bash
node -e "import('./src/tools/definitions.js').then(m => console.log(m.getToolsForAgent('<agentType>').map(t => t.name)))"
```

Should print the array of tool names matching what you configured in Step 2.

**4. UI check (skip for backend-only agents):**
Start the server (`npm run dev`), navigate to `/<route>`, verify:
- Page loads without console errors
- Agent appears in the UI dropdown with correct display name
- Sending a test message reaches the backend and returns a response

**5. Conversation trace check:**
After sending a test message:
```bash
node scripts/inspect-conversation.js --agent <agentType> --limit 1 --format summary
```

Should show a real conversation with the expected tool calls (if any tools were invoked).

**6. Log the decision:**
````
/log-decision Added <agentType> agent at /<route>. Tool loadout: [summary]. Used for [purpose].
````

## Rollback

- Prompt file: `rm .claude/agents/<agentType>.md`
- Code edits: `git checkout src/tools/definitions.js server.js unified-agents.html`
- Already committed: `git revert <commit>`

## Reference implementations

**Straightforward agent with skills** — `internal-oracle`:
- Prompt: `.claude/agents/internal-oracle.md`
- Tool loadout: `definitions.js:2105` (case branch)
- Route: `server.js` (search for `/oracle`)
- AGENT_TYPE_MAP: `unified-agents.html:843` (`'oracle': 'internal-oracle'`)
- AGENTS config: `unified-agents.html` around line 860

**Simple agent, no skills, identity mapping** — `etg-writer`:
- Prompt: `.claude/agents/etg-writer.md`
- Tool loadout: `definitions.js` (case branch without LOAD_SKILL_TOOL)
- Route: `server.js` (`/etg-writer*`)
- AGENT_TYPE_MAP: explicit identity entry

**Backend-only agent, no frontend** — `orchestrator`:
- Prompt: `.claude/agents/orchestrator.md`
- Tool loadout: `ALL_TOOLS` at `definitions.js:2114`
- No route in `server.js`
- No entry in `unified-agents.html`

## See also

- `.claude/agents/CLAUDE.md` — agent definition reference
- `.claude/skills/CLAUDE.md` — skill system (relevant if the new agent uses skills)
- `src/tools/CLAUDE.md` — tool system reference
- Recipe: `add-skill.md` — if this agent needs a new skill built alongside it
