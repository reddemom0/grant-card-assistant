# Recipe: Add a new tool

Follow this recipe when adding a new runtime tool to the AI hub. Tools are what agents call at runtime to do things (search HubSpot, read a Google Doc, load a skill). Adding a tool touches 3 systems: schema definition, implementation, and executor dispatch.

This recipe is prescriptive. Follow every step in order.

## When to use this recipe

Use when:
- Adding a brand-new tool that no existing code provides
- Wrapping an existing internal function as a tool an agent can call

Do NOT use for:
- Adding an existing tool to a new agent (just add the tool constant to the agent's case in `getToolsForAgent`)
- Refactoring an existing tool's implementation (edit the implementation file directly)
- Changing a tool's schema in a backward-compatible way (edit `definitions.js` directly)

## Inputs you need before starting

1. **Tool name** — snake_case (e.g., `search_grant_archive`, `create_workbc_claim`). Must be unique across all existing tools. The tool name is what the model invokes.
2. **Tool purpose** — one-line description of what the tool does. This goes into the schema's `description` field and determines whether the model will call it.
3. **Input schema** — what parameters does the tool accept? JSON schema format. Be explicit about required vs optional.
4. **Implementation** — the actual JavaScript function. Sketch it out before starting this recipe.
5. **Tool category** — does this tool belong to an existing category (HubSpot, Google Drive, Oracle, memory, etc.) or is it standalone? Determines which file holds the implementation.
6. **Which agents will call this tool** — list of agent names. Determines where to add the tool to loadouts.
7. **External dependencies** — does the tool call out to a third-party API? If yes, credentials must already exist in env vars; if not, add them before starting this recipe.

## Pre-flight checks

**Check 1: tool name doesn't already exist**
```bash
grep -r "name: '<tool-name>'" src/tools/ | head
```
Any match = collision. STOP.

**Check 2: implementation file choice**
Open `src/tools/` and identify where this tool belongs:
- HubSpot-related → `src/tools/hubspot.js`
- Google Drive → `src/tools/google-drive.js`
- Google Docs → `src/tools/google-docs.js`, `google-docs-advanced.js`, or `google-docs-construction.js`
- Dropbox → `src/tools/dropbox.js`
- Memory → `src/tools/memory.js` or `learning-memory.js`
- Oracle search → `src/tools/oracle-search.js` or `oracle-search-rag.js`
- Lead-gen specific → `src/tools/lead-gen-knowledge.js`, `save-lead-data.js`
- GetGranted database → `src/tools/getgranted-tools.js` or `getgranted-search.js`
- Standalone → create a new file `src/tools/<tool-name>.js` or add to an existing topical file

If unsure, group by external service or domain, not by verb.

**Check 3: env vars (external APIs only)**
If your tool calls a third-party API, grep for the credential env var name in `.env.example` or existing code:
```bash
grep -r "<API_KEY_VAR>" src/
```
Missing env var = add it before continuing, not during.

## The 3 registration touchpoints

### Step 1: Add the tool schema in `src/tools/definitions.js`

Schema location depends on whether you're grouping or standalone:

**If grouping into an existing constant** (e.g., adding to `HUBSPOT_TOOLS`):
Append a new schema object to the array. Match the format of existing entries:
```javascript
{
  name: '<tool_name>',
  description: '<one-line purpose>',
  input_schema: {
    type: 'object',
    properties: {
      <param>: {
        type: '<string|number|boolean|array|object>',
        description: '<what this param is for>'
      }
    },
    required: ['<param>']
  }
}
```

**If standalone:** Add the schema as a standalone `const` near the bottom of the constants section, then reference it in the agent loadouts that should include it.

**Description matters:** The model decides whether to call a tool based on the description. Vague descriptions = unreliable invocation. Include trigger hints where relevant (e.g., `"Search HubSpot contacts by email or company name. Use when the user asks about a specific person or company."`).

**Failure mode if skipped:** Tool has no schema. Agents that include it in their loadout will throw at load time or the model will hallucinate an invocation format.

### Step 2: Implement the tool in `src/tools/<topical-file>.js`

Export a named function matching the pattern of existing tools in that file. Signature convention:
```javascript
export async function toolNameInCamelCase(input, context = {}) {
  // input is the parsed JSON matching the schema
  // context contains userId, conversationId, agentType — use as needed

  try {
    // do the work
    return { success: true, result: <whatever> };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

**Naming convention:** Tool names are snake_case (`create_hubspot_deal`). Implementation function names are camelCase, **but preserve internal word-boundary capitalization from proper nouns**: `createHubSpotDeal` (not `createHubspotDeal`), `searchHubSpotContacts`, `listHubSpotOwners`. When wrapping external services, keep the service's own capitalization (HubSpot, GetGranted, etc.).

**Error handling contract:** Prefer the return-style: `{ success: false, error: '...' }`. The executor catches thrown errors and wraps them, but return-style is the convention across existing tools and is easier to reason about. Do NOT set an `is_error` flag — the executor handles that.

### Step 3: Wire the executor dispatch in `src/tools/executor.js`

Open `src/tools/executor.js`. Find the switch statement in `executeToolCall` (at line 294).

Add a case:
```javascript
case '<tool_name>': {
  const { <toolFunctionName> } = await import('./<topical-file>.js');
  return await <toolFunctionName>(input, { conversationId, userId, agentType });
}
```

**Static vs dynamic imports:** The executor uses a mix. Static imports at the top of `executor.js` cover ~10 modules; ~10 other modules use dynamic imports deferred until first call. Dynamic imports suit heavy or infrequently-used modules; static imports suit frequently-used tools. Match the pattern of neighboring tools in the same category.

**Failure mode if skipped:** Agent has the tool in its loadout. Model calls the tool. Executor throws "Unknown tool: `<tool_name>`" and the tool_result contains the error.

### Step 4 (conditional): Add to agent loadouts

For each agent that should have access, add the tool to their case in `getToolsForAgent` at `definitions.js:2047`.

Two paths:

**Path A: add individually**
If the tool is standalone, include it directly in the agent's array:
```javascript
case 'my-agent':
  return [
    ...SERVER_TOOLS,
    MY_NEW_TOOL,
    // ...
  ];
```

**Path B: add to a category constant**
If the tool was added to an existing category (e.g., `HUBSPOT_TOOLS`), all agents using that category automatically get it. No per-agent edit needed — but verify this is what you want. Some categories are deliberately curated (`coreHubSpotTools` is a subset of `HUBSPOT_TOOLS`).

**If the tool is referenced by any skill:** Add it to the relevant tool subset. For HubSpot skill tools, that's `coreHubSpotTools` at `definitions.js:2056-2068`. See the invariant comment at lines 2051-2055.

## Verification

**1. Diff review:**
```bash
git diff src/tools/definitions.js src/tools/executor.js src/tools/<topical-file>.js
```

Expect: 3 modified files (or 2 modified + 1 new if the topical file is new).

**2. Schema check:**
```bash
node -e "import('./src/tools/definitions.js').then(m => { const tools = m.getToolsForAgent('<target-agent>'); const t = tools.find(x => x.name === '<tool_name>'); console.log(t ? JSON.stringify(t, null, 2) : 'NOT FOUND'); })"
```

Should print the schema.

**3. Implementation unit test** (manual):
```bash
node -e "import('./src/tools/<topical-file>.js').then(m => m.<toolFunctionName>({<test-input>}).then(r => console.log(JSON.stringify(r, null, 2))))"
```

Should print `{ success: true, ... }` or `{ success: false, error: '...' }` — not throw.

**4. Live invocation test:**
Prompt a target agent in a way that should trigger the tool. Then:
```bash
node scripts/inspect-conversation.js --agent <agent-type> --limit 1 --format trace
```

Confirm the tool call appeared with the expected input and returned a non-error result.

**5. Log the decision:**
````
/log-decision Added <tool_name> tool. Category: <category>. Used by agents: A, B. Purpose: <one line>.
````

## Rollback

- Implementation: `git checkout src/tools/<topical-file>.js`
- Schema and dispatch: `git checkout src/tools/definitions.js src/tools/executor.js`
- Already committed: `git revert <commit>`

## Reference implementation

Study `list_hubspot_owners` — simple, well-shaped:
- Schema: in `HUBSPOT_TOOLS` array at `definitions.js:1040`
- Implementation: `src/tools/hubspot.js` (export named `listHubSpotOwners` — capital S)
- Dispatch: `src/tools/executor.js:575-577` case `list_hubspot_owners`
- Referenced by: `coreHubSpotTools` subset at `definitions.js:2061` with inline comment "required by DEAL_CREATION skill"

## See also

- `src/tools/CLAUDE.md` — tool system reference (authoritative)
- `.claude/skills/CLAUDE.md` — if the new tool will be invoked by a skill
- Recipe: `add-skill.md` — if you're adding this tool specifically to support a new skill
