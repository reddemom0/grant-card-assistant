# `.claude/agents/CLAUDE.md` — Agents in the AI Hub

How agents are defined, wired, and routed. Read this before modifying anything in `.claude/agents/` or adding a new agent.

## What an agent is (in this repo)

An agent is a named persona with a dedicated system prompt, a specific tool loadout, and a frontend route. Agents are not per-folder code modules — they're flat `.md` files in `.claude/agents/` plus case branches in a central switch.

The runtime for all authenticated agents is the same: `POST /api/chat` → `handleChatRequest` → `runAgent` → `getToolsForAgent` → tool loop. Only the prompt + tool loadout + UI routing differ per agent.

## Current agents (11)

| Agent file | Backend `agentType` | Frontend route | Notes |
|------------|---------------------|----------------|-------|
| `internal-oracle.md` | `internal-oracle` | `/oracle` | No YAML frontmatter |
| `grant-card-generator.md` | `grant-card-generator` | `/grant-cards` | |
| `etg-writer.md` | `etg-writer` | `/etg-writer` | |
| `bcafe-writer.md` | `bcafe-writer` | `/bcafe-writer` | |
| `buybc-writer.md` | `buybc-writer` | `/buybc-writer` | |
| `canexport-claims.md` | `canexport-claims` | `/canexport-claims` | |
| `canexport-writer.md` | `canexport-writer` | `/canexport-writer` | |
| `readiness-strategist.md` | `readiness-strategist` | `/readiness-strategist` | |
| `lead-gen.md` + `lead-gen-variant-a.md` | `lead-gen` | `/lead-gen` | Both lack YAML frontmatter; Variant A default; Variant B loaded from `.claude/skills/lead-gen-variant-b/` via concatenation |
| `orchestrator.md` | `orchestrator` | (no UI) | Gets `ALL_TOOLS` |
| `getgranted-ai.md` | `getgranted-ai` | (no UI) | Client-facing; likely invoked externally |

**URL aliases** (URL slug ≠ backend `agentType`): `oracle → internal-oracle`, `grant-cards → grant-card-generator`. All others are identity.

**Note:** `researcher.md` also lives in `.claude/agents/` but is a Claude Code subagent, not a backend agent. It doesn't have a backend `agentType` or tool loadout.

## Agent file structure

Standard agent prompt file:

```yaml
---
name: agent-name
description: one-line purpose
model: claude-sonnet-4-5
temperature: 0.7
tools:                           # YAML list — advertises intended tools to Claude Code
  - Read
  - Write
  - WebSearch
  - Memory
  - search_hubspot_contacts
  - ...
---

# System prompt content here
...
```

**Important caveat on YAML `tools:` frontmatter:** This list is NOT load-bearing at runtime for the live `/api/chat` path. Runtime tool access is determined entirely by the case branch in `getToolsForAgent` (see `src/tools/definitions.js:2047`). The frontmatter exists for Claude Code visibility and Claude Agent SDK compatibility — but editing it does not change what the running agent can do.

To actually change an agent's tool access, edit the switch case in `definitions.js`. The frontmatter is best-effort documentation.

### Agents without frontmatter

Three agents ship with no YAML frontmatter — their files start directly with content:

- `internal-oracle.md` — starts with `# Oracle - Granted Consulting's AI Assistant`
- `lead-gen.md` — starts with `<absolute_output_rule>`
- `lead-gen-variant-a.md` — starts with `<absolute_output_rule>`

`loadAgentPrompt()` in `src/agents/load-agents.js:101-108` handles this as a fallback: when the frontmatter regex doesn't match, it returns the full file content as the prompt. Works correctly — but breaks the standard pattern. If you're extending one of these agents, preserve the no-frontmatter structure, don't add frontmatter without testing.

## Agent validation

`src/api/chat.js:61` calls `isValidAgentType` (imported at line 11 from `src/agents/load-agents.js:134`). The validator is **directory-based**: it calls `getAvailableAgents()` which reads `.claude/agents/*.md` (see `load-agents.js:123-126`) and returns the filenames (minus extension). Any file whose name matches an incoming `agentType` string is accepted.

**Consequence:** dropping a new `.md` file into `.claude/agents/` makes it a valid `agentType` immediately — no other registration needed to pass validation. No caching at this layer, so the check is live per-request. This is why the `canexport-writer-BACKUP-20260129.md` file (removed in Session 1) had technically been accepted as an `agentType` before removal.

## Tool loadout

Tool loadout lives in the `getToolsForAgent(agentType)` switch in `src/tools/definitions.js:2047`. The switch returns an array of tool schemas that Claude's API receives.

Typical structure:

```javascript
case 'some-agent':
  return [
    ...SERVER_TOOLS,
    ...ANTHROPIC_MEMORY_TOOL,
    ...MEMORY_TOOLS,
    LOAD_SKILL_TOOL,             // if the agent should be able to load skills
    ...coreHubSpotTools,         // if the agent needs restricted HubSpot access
    ...GOOGLE_DRIVE_TOOLS,
    ...SOME_OTHER_TOOL_SET
  ];
```

### Common tool set constants (all defined in `definitions.js`)

| Constant | Line | Purpose |
|----------|------|---------|
| `SERVER_TOOLS` | 16 | `web_search`, `web_fetch`, etc. |
| `ANTHROPIC_MEMORY_TOOL` | 32 | Filesystem memory, writes to `.memories/` |
| `MEMORY_TOOLS` | 42 | `memory_store`, `memory_recall`, `memory_list` (Postgres-backed) |
| `LOAD_SKILL_TOOL` | 1303 | Enables `load_skill` calls |
| `HUBSPOT_TOOLS` | 90 | Full HubSpot tool set (read + write) |
| `coreHubSpotTools` | 2056 | Filtered subset, local const inside `getToolsForAgent` |
| `GOOGLE_DRIVE_TOOLS` | 1231 | |
| `GOOGLE_DOCS_TOOLS` | 1646 | |
| `DROPBOX_TOOLS` | 1278 | |
| `ALL_TOOLS` | 2028 | Used by orchestrator only |

### Oracle's `ANTHROPIC_MEMORY_TOOL` opt-out

Oracle opts OUT of `ANTHROPIC_MEMORY_TOOL` explicitly. Comment at `definitions.js:2098-2102`:

```
// Oracle needs: search/enrichment tools + Oracle KB + minimal HubSpot + skill loading
// EXCLUDE filesystem-based ANTHROPIC_MEMORY_TOOL (.memories/) - wastes iteration checking empty directory
// KEEP Postgres-based MEMORY_TOOLS (conversation key-value store) and SERVER_TOOLS
// LOAD_SKILL_TOOL: uses the shared definition (not a per-agent copy) so Oracle can load
// hubspot/DEAL_CREATION and any future skills without enum drift.
```

Other agents vary by design choice. If modifying memory behavior, check each affected agent's tool loadout.

## Request path (authenticated agents)

For everything except lead-gen, the flow is:

```
Frontend (unified-agents.html)
  ↓ fetch POST /api/chat { agentType, message, conversationId, attachments }
  ↓ URL slug → backend agentType via AGENT_TYPE_MAP (unified-agents.html:843)

server.js:396
  ↓ app.post('/api/chat', authenticateUser, handleChatRequest)

src/api/chat.js:22 handleChatRequest
  ↓ isValidAgentType(agentType) at line 61
  ↓ load conversation from DB (src/database/messages.js)

src/claude/client.js:99 runAgent
  ↓ system prompt assembled inline via systemBlocks array (starts line 449)
    — baseAgentPrompt loaded at line 137
    — memories loaded at line 145
    — learningMemory loaded at line 158
    — leadGenFormContext loaded at line 174 (lead-gen only)
    — summaryForSystem loaded at line 308
  ↓ tools = getToolsForAgent(agentType) at line 414
  ↓ Anthropic API call with streaming SSE
  ↓ tool_use detected → dispatch to executor

src/tools/executor.js:294 executeToolCall(toolName, input, conversationId, userId, agentType)
  ↓ switch on toolName → import + invoke implementation
  ↓ tool_result returned to runAgent loop

Loop until stop_reason === 'end_turn', stream final response to client
```

Storage: `messages` table (one row per message) via `src/database/messages.js`.

**There is no single `assembleSystemPrompt` function** — the prompt is composed inline in `runAgent`. If you need to modify how the system prompt is built, the relevant lines are in `client.js` around line 449 and the individual loaders cited above.

## Request path (lead-gen)

Lead-gen is a separate world. Different endpoints (`/api/lead-gen/chat`, `/api/lead-gen/init`, `/api/lead-gen/event`), different storage (`lead_gen_conversations` with JSONB messages), different UI (`lead-gen.html`), no authentication. For the full picture, see root `CLAUDE.md` — Request paths section.

### Lead-gen A/B variants

`LEAD_GEN_VARIANT` env var (A or B) selects the prompt at load time. Handled in `src/agents/load-agents.js` lines 34-70.

- **Variant A:** loads `.claude/agents/lead-gen.md` or `lead-gen-variant-a.md` (standard agent file pattern, no frontmatter)
- **Variant B:** at `load-agents.js:42-46`, reads three files from `.claude/skills/lead-gen-variant-b/` in this order:
  1. `base-system-prompt.md`
  2. `client-communication.md`
  3. `system-operations.md`

  Then at `load-agents.js:61`, joins them with `\n\n---\n\n` and returns the concatenation as the prompt.

The variant-B files live under `.claude/skills/` but are NOT runtime-loadable skills — they're prompt fragments loaded at agent-prompt-load time. Do not add them to `SKILL_PATHS`.

## Frontend routing

### Most agents: `unified-agents.html`

All authenticated agents except lead-gen share `unified-agents.html`. The first URL path segment identifies the agent (e.g., `/oracle/new` → `oracle`). Translation happens in `AGENT_TYPE_MAP` at line 843:

```javascript
const AGENT_TYPE_MAP = {
  'oracle': 'internal-oracle',
  'grant-cards': 'grant-card-generator',
  'canexport-claims': 'canexport-claims',
  'etg-writer': 'etg-writer',
  'bcafe-writer': 'bcafe-writer',
  'buybc-writer': 'buybc-writer',
  'canexport-writer': 'canexport-writer',
  'readiness-strategist': 'readiness-strategist'
};
function getBackendAgentType(urlAgentName) {
  return AGENT_TYPE_MAP[urlAgentName] || urlAgentName;
}
```

The `|| urlAgentName` fallback means identity mappings work without explicit entries. Entries are really only needed for aliases, though the current code lists identity mappings explicitly.

The `AGENTS` config object begins at line 860 and holds per-agent display names, descriptions, and UI config.

### Lead-gen: standalone

`lead-gen.html` is a separate page served directly at `server.js:778-780` via `res.sendFile('lead-gen.html', { root: '.' })`. No `unified-agents.html` reuse.

### Unrouted agents

`orchestrator` and `getgranted-ai` have no frontend route (zero `app.get()` or `app.post()` entries for either in `server.js`). They exist in the backend switch but aren't reachable via UI. `orchestrator` may be invoked by tests or internal calls; `getgranted-ai` is likely invoked from an external integration (widget, SDK).

## How to add a new agent

Before writing code, decide:

1. **What's the agent's core job?** If it overlaps heavily with an existing agent, consider extending rather than creating.
2. **What tools does it need?** Reuse existing tool sets rather than inventing new ones unless the tool itself is new.
3. **Does it need skills?** If yes, confirm `LOAD_SKILL_TOOL` is in its loadout.
4. **Public or authenticated?** Public agents need to follow the lead-gen pattern (separate storage, restricted tools, no auth). Almost all new agents should be authenticated.

### Step 1: Write the prompt file

Create `.claude/agents/{agent-name}.md` with YAML frontmatter + system prompt body. Match the pattern of a similar existing agent. The `tools:` frontmatter list is not load-bearing but should reflect intent.

### Step 2: Add tool loadout case

Edit `src/tools/definitions.js` around line 2047 (`getToolsForAgent` switch). Add:

```javascript
case 'your-agent-name':
  return [
    ...SERVER_TOOLS,
    ...MEMORY_TOOLS,
    // ...pick tool sets that match frontmatter intent
  ];
```

### Step 3: Add frontend routing (if it needs a UI)

Edit `server.js`. In the route registrations section (look for similar routes at lines 782-789), add:

```javascript
app.get('/your-agent*', serveUnifiedAgents);
```

Edit `unified-agents.html` line 843 if the URL slug differs from the backend `agentType`:

```javascript
const AGENT_TYPE_MAP = {
  // ...existing
  'your-url-slug': 'your-agent-name',
};
```

And update the `AGENTS` config object at line 860 with the agent's display name, description, and any UI config.

### Step 4: Test end-to-end

Since `isValidAgentType` is directory-based, the new `.md` file makes the `agentType` valid immediately. But you still need:

- The switch case (or the agent gets no tools and does nothing useful)
- The UI route (or the agent isn't reachable from the browser)
- The `AGENT_TYPE_MAP` entry if using an alias

## How to modify an existing agent

- **Prompt changes:** edit the `.md` file in `.claude/agents/`. `loadAgentPrompt()` reads fresh on each request — no restart needed.
- **Tool loadout changes:** edit the switch case in `definitions.js`. Prod deploy required.
- **Adding/removing tool access:** edit the switch case. Do NOT edit only the YAML frontmatter — that won't change runtime behavior.
- **Changing frontend routing:** edit `unified-agents.html` (`AGENT_TYPE_MAP`, `AGENTS` config). Static file change, takes effect on next page load.

## Gotchas

- **Frontmatter `tools:` is cosmetic at runtime.** Editing it won't grant or revoke tool access for the live `/api/chat` path. Runtime tool access is 100% in `getToolsForAgent`.
- **No separation of agent concerns.** Agents are flat `.md` files + switch cases. There's no per-agent code module. This is intentional — the shared runtime (`runAgent`, `executor`) is the same for all.
- **Backup files are live.** Any `.md` in `.claude/agents/` becomes a valid `agentType`. If you need to keep an old prompt for reference, move it out of this directory (e.g., `docs/archive/`) or rename to something that makes clear it's not a real agent (but better: just move it).
- **Name conventions are inconsistent.** Some frontmatter uses `searchHubSpotContacts` (camelCase), runtime tools use `search_hubspot_contacts` (snake_case). The model may be confused about exact tool names. See `canexport-claims.md` for a visible example. Fixing this is a separate cleanup project.
- **Orchestrator gets `ALL_TOOLS`.** Be deliberate when adding new tools — they automatically become available to orchestrator.

## When something's broken

For agent-specific issues, use the researcher subagent:

```
/investigate trace the request path for an incoming POST /api/chat with
agentType: {AGENT}. Report which tool loadout it gets, which prompt is loaded,
and any inconsistencies with frontend routing.
```

For "agent can't do X", the issue is almost always one of:

1. Tool missing from the switch case
2. Prompt doesn't instruct the agent to use the tool
3. `LOAD_SKILL_TOOL` missing for a skill-invoking agent
4. Frontmatter advertises a tool that isn't actually wired

Check in that order.
