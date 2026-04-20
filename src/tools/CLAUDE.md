# `src/tools/CLAUDE.md` — Tool System in the AI Hub

How tools are defined, registered, and executed. Read this before modifying anything under `src/tools/` or adding a new tool.

## The split: schemas vs implementations

Tools follow a two-file pattern.

- **Schemas (what the model sees):** defined as constants or inline arrays in `src/tools/definitions.js`. These are the `Anthropic.Tool[]` shapes that ship to the API.
- **Implementations (what actually runs):** in topical files under `src/tools/` — `hubspot.js`, `google-drive.js`, `oracle-search.js`, `memory.js`, and others.
- **Dispatch:** `src/tools/executor.js:294` — `executeToolCall(toolName, input, conversationId, userId, agentType)` routes each `tool_use` to its implementation.

When the model calls a tool:

1. Tool schema was advertised from `getToolsForAgent` in `definitions.js:2047`
2. Model emits `tool_use` with the tool name and input
3. `runAgent` in `src/claude/client.js` catches it and calls `executeToolCall`
4. `executor.js` switch dispatches to the right implementation file
5. Result returns as `tool_result` to the agent loop

## Tool set constants

These live at the top of `definitions.js`. Most are arrays of schemas; a few are single tool objects.

| Constant | Line | What it contains |
|----------|------|------------------|
| `SERVER_TOOLS` | 16 | `web_search`, `web_fetch`, etc. |
| `ANTHROPIC_MEMORY_TOOL` | 32 | Filesystem memory tool (writes to `.memories/`) |
| `MEMORY_TOOLS` | 42 | `memory_store`, `memory_recall`, `memory_list` (Postgres-backed) |
| `HUBSPOT_TOOLS` | 90 | Full HubSpot tool set (read + write) |
| `LOAD_SKILL_TOOL` | 1303 | The `load_skill` tool schema |
| `GOOGLE_DRIVE_TOOLS` | 1231 | Google Drive read/write tools |
| `DROPBOX_TOOLS` | 1278 | Dropbox tools |
| `GOOGLE_DOCS_TOOLS` | 1646 | Google Docs creation/edit tools |
| `ALL_TOOLS` | 2028 | Everything, used by orchestrator only |

And two important local-scope constants inside `getToolsForAgent`:

| Constant | Line | Purpose |
|----------|------|---------|
| `coreHubSpotTools` | 2056 | Filtered subset of `HUBSPOT_TOOLS` — tools referenced by the `hubspot/DEAL_CREATION` skill |
| `oracleBaseTools` | 2103 | `SERVER_TOOLS + MEMORY_TOOLS` (Oracle's base, excludes `ANTHROPIC_MEMORY_TOOL`) |

### `ORACLE_TOOLS` — shared, not Oracle-exclusive

Despite the name, `ORACLE_TOOLS` is consumed in three places:

- `definitions.js:2035` — spread into `ALL_TOOLS` (so orchestrator receives it)
- `definitions.js:2105` — spread into `internal-oracle`'s loadout (primary use)
- `definitions.js:2127` — `ORACLE_TOOLS.find(t => t.name === 'search_getgranted')` inside the lead-gen case (lead-gen extracts just the `search_getgranted` schema)

When adding a tool to `ORACLE_TOOLS`, know that orchestrator automatically gets it, and if it's named `search_getgranted`, lead-gen's behavior changes too.

For which agent uses which tool sets, see `.claude/agents/CLAUDE.md`.

## Dispatch in `executor.js`

`executor.js:294` exports `executeToolCall`. The function signature:

```javascript
export async function executeToolCall(toolName, input, conversationId, userId = null, agentType = null)
```

Internally it's a large switch on `toolName`. Each case either inline-implements the tool or delegates to an imported module.

### Static vs dynamic imports

- **Static imports** at the top of `executor.js` (lines 8-17): `memory`, `hubspot`, `googleDrive`, `dropbox`, `googleDocs`, `googleSheets`, `getgrantedTools`, and a few others. ~10 modules. Used by the majority of switch cases.
- **Dynamic imports** inside specific cases: ~8 places use `const { fn } = await import('./module.js')`. Used selectively for heavy, optional, or circular-risk modules:

```javascript
case 'load_skill':
  const { loadSkill } = await import('./load-skill.js');
  result = await loadSkill({ skill_name: input.skill_name, sub_skill: input.sub_skill });
  break;
```

Other dynamic imports: `tool-search.js`, `oracle-search-rag.js`, `visualping-alerts.js`, `lead-gen-knowledge.js`, `save-lead-data.js`, `getgranted-search.js`.

When in doubt, static import at the top is the default. Use dynamic only when there's a specific reason (circular dependency, heavy init, conditional load).

## Error handling

Tool errors are caught, not thrown. Implementations can throw freely — the executor catches and returns an error object.

What the model sees is a `tool_result` with the error object JSON-stringified inside the `content` field. **There is NO `is_error` flag set on the `tool_result` block** — the failure is signaled inside the `content` payload as `{success: false, error: "..."}`.

```javascript
// What the model gets on tool failure:
{
  type: 'tool_result',
  tool_use_id: '...',
  content: '{"success":false,"error":"HubSpot 401 unauthorized"}'
}
```

The model can read the `success: false` flag inside `content` and decide how to respond (retry, explain, etc.).

## The dual HubSpot layer — important gotcha

Two separate HubSpot code paths exist. Bug fixes in one do NOT propagate to the other. Read before touching anything HubSpot-related.

| File | Imported by | Purpose |
|------|-------------|---------|
| `services/hubspot-service.js` (repo root) | `server.js:454`, `test-hubspot-integration.js` | Direct Express routes (e.g., `/api/hubspot/contacts/search`). Older. |
| `src/tools/hubspot.js` | `executor.js:9`, `src/api/lead-gen-finalization.js:24`, `src/api/hubspot-webhook.js:13`, `src/tools/save-lead-data.js:26`, plus scripts and tests | Newer, used by the tool system. |

The two files maintain independent implementations. A fix to search behavior in `src/tools/hubspot.js` does not improve the direct Express routes (and vice versa).

Consolidating them is a real refactor — not on the cleanup roadmap yet. For now: when fixing a HubSpot bug, grep for the symbol across both files. If both have it, patch both.

## Current implementation files

Core tool implementation modules live in `src/tools/`:

```
src/tools/
  definitions.js              schemas for every tool + getToolsForAgent
  executor.js                 dispatch switch (tool name → implementation)
  load-skill.js               loadSkill() — runtime skill file reader
  tool-search.js              general tool invocation helpers
  tool-embeddings.json        embeddings cache for tool search

  hubspot.js                  HubSpot CRM operations (NEW layer — see dual HubSpot gotcha)
  google-drive.js             Google Drive operations
  google-docs.js              Google Docs creation/edit basics
  google-docs-advanced.js     advanced Google Docs operations
  google-docs-construction.js document construction helpers
  google-sheets.js            Google Sheets operations
  google-sheets-advanced.js   Google Sheets advanced operations
  dropbox.js                  Dropbox operations
  oracle-search.js            Oracle semantic search
  oracle-search-rag.js        Oracle RAG search variant

  memory.js                   memory tool implementations
  learning-memory.js          learning-system memory

  save-lead-data.js           lead-gen lead data persistence (uses HubSpot)
  visualping-alerts.js        VisualPing integration

  getgranted-tools.js         GetGranted AI helper tools
  getgranted-search.js        GetGranted search
  lead-gen-knowledge.js       lead-gen knowledge retrieval
  budget-templates.js         budget template generation
  doc-templates/              doc templates (directory)

  edit.js, read.js, write.js  filesystem helpers (editFile, readFile, writeFile)
```

### Known dead code: `src/tools/index.js`

`src/tools/index.js` exists but references five modules that don't exist in `src/tools/`: `./bash.js`, `./glob.js`, `./grep.js`, `./web-search.js`, `./web-fetch.js`. Imports would fail at runtime. Either this file is unused (dead), or it's a planned future registry that was never completed. Don't extend it. Candidate for removal in a future cleanup session.

## How to add a new tool

### Step 1: Write the implementation

Decide which topical file the tool belongs to. If it fits an existing area, add it there. If it's genuinely new, create a new file at `src/tools/{area}.js`.

The implementation function should be `async`, accept an input object matching the schema, and return a serializable result. Errors can throw — the executor catches and wraps them as `{success: false, error}` in the `tool_result` content.

### Step 2: Define the schema

Open `src/tools/definitions.js`. Add a new constant for the tool schema (or add it to an existing `*_TOOLS` array if it's part of a thematic group):

```javascript
const YOUR_TOOL = {
  name: 'your_tool_name',
  description: '...',
  input_schema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' },
    },
    required: ['param1']
  }
};
```

**Tool naming:** `snake_case` for runtime tool names. Consistent with `search_hubspot_contacts`, `load_skill`, `memory_store`, etc. Do NOT use camelCase in new runtime tool names, even though some agent frontmatter uses camelCase — the runtime speaks `snake_case`.

### Step 3: Add to the right tool set

If the tool belongs to an existing thematic set (like `HUBSPOT_TOOLS`), add it there. If it's standalone, it can be added directly in the relevant agent's `getToolsForAgent` case.

If it's a HubSpot write tool referenced by the `hubspot/DEAL_CREATION` skill (or any future HubSpot skill that teaches writes), also add it to `coreHubSpotTools` at line 2056. Otherwise Oracle and `bcafe-writer` will see the skill instruction but lack the tool. See `.claude/skills/CLAUDE.md` for the invariant.

### Step 4: Add to the executor switch

Open `src/tools/executor.js`. Find the switch on `toolName` around line 294. Add a case:

```javascript
case 'your_tool_name':
  result = await yourImplementation(input);
  break;
```

If your implementation is in a new file, add the import at the top of `executor.js` (static import is the default; use dynamic only if there's a specific reason).

### Step 5: Add to agent tool loadouts

Edit `src/tools/definitions.js` `getToolsForAgent` switch at line 2047. For each agent that should have access, add your tool (or the constant containing it) to the return array.

### Step 6: Verify

- Only files changed: `definitions.js`, `executor.js`, and your implementation file
- The tool schema name (in `definitions`) matches exactly the case value in `executor`
- Affected agents have the tool in their switch case
- Test by invoking the tool from an agent that should have access. Check the `tool_result` comes back as expected.

## How to modify an existing tool

- **Implementation-only changes** (behavior fixes, new internal logic): edit the implementation file. No schema or executor changes needed. Prod deploy required for tool code.
- **Schema changes** (renaming a param, adding required fields, changing types): edit BOTH the schema in `definitions.js` AND the implementation that reads those params. Both must change together, or the model will send data the implementation can't read.
- **Renaming a tool:** schema name, executor switch case, every agent's tool loadout reference, and any prompt text that mentions the tool name — all must update together. This is a coordinated change; use Plan mode.
- **Deprecating a tool:** remove from the agent loadouts first (so nothing calls it), then remove the schema and the executor case. Leave the implementation file if other code imports its functions.

## Gotchas

- **Tool names must match exactly** between `definitions.js` schemas and `executor.js` switch cases. A typo is a silent failure — the model calls the tool, executor's default case returns an error, the agent gets a confusing error back.
- **Dynamic imports are used selectively, not as the default.** Static imports at the top of `executor.js` are the norm. Reach for dynamic imports only when circular dependencies or heavy init make them worthwhile.
- **The dual HubSpot layer.** Grep both files when fixing HubSpot bugs.
- **`coreHubSpotTools` is human-maintained.** If you add a HubSpot write tool that the `hubspot/DEAL_CREATION` skill teaches, add it to `coreHubSpotTools` too. No test enforces this.
- **Tool naming conventions:** `snake_case` at runtime. `camelCase` appears in some agent frontmatter but isn't load-bearing — the runtime speaks `snake_case` only.
- **`ORACLE_TOOLS` is not Oracle-exclusive.** Also used by orchestrator (via `ALL_TOOLS`) and partially by lead-gen (for `search_getgranted`). Deliberate additions only.
- **`src/tools/index.js` is broken/dead.** Don't extend it. See known dead code section above.

## When something's broken

For tool-related issues, use the researcher subagent:

```
/investigate trace how {tool_name} is dispatched — show the schema definition,
the executor case, the implementation function, and which agents currently have
it in their loadout.
```

Common failure modes:

- **Tool not being called by the model** → schema description unclear or tool not in agent's loadout
- **Tool called but errors out** → check the implementation; also check that input schema matches what the implementation expects
- **Tool works for some agents, not others** → check which agents have it in their `getToolsForAgent` case
- **HubSpot tool works in agent chat, fails on direct API route (or vice versa)** → dual layer problem; check both `src/tools/hubspot.js` and `services/hubspot-service.js`
