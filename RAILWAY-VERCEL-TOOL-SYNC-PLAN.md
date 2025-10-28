# Railway → Vercel Tool Sync Plan

## Current State Analysis

### Railway Deployment (railway-migration branch) ✅

**Architecture:**
- Modular Express server (`server.js` at root)
- Tool system in `src/tools/` directory
- Agent definitions in `.claude/agents/*.md` with YAML frontmatter
- Clean separation of concerns

**Available Tools (11 total):**
1. `read_file` - Read files with line numbers and ranges
2. `write_file` - Create/overwrite files
3. `edit_file` - Replace exact text in files
4. `bash` - Execute shell commands
5. `glob` - Find files by pattern
6. `grep` - Search content with regex
7. `web_search` - Search the web for information
8. `web_fetch` - Fetch and parse web content
9. `todo_write` - Track multi-step workflows
10. `hubspot_query` - Query HubSpot CRM data
11. *(Memory tool exists but not yet fully integrated)*

**Agent Tool Assignments:**
- `grant-card-generator`: Read, Write, Edit, Glob, Grep, WebSearch, TodoWrite (7 tools)
- `etg-writer`: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, TodoWrite (8 tools)
- `bcafe-writer`: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, TodoWrite (8 tools)
- `canexport-claims`: Read, Write, Edit, Glob, Grep, WebSearch, TodoWrite (7 tools)
- `orchestrator`: Read, Glob, Grep, Agent, TodoWrite (5 tools)

---

### Vercel Deployment (main branch) ❌

**Architecture:**
- Monolithic serverless function (`api/server.js` - 6205 lines)
- Agent prompts hardcoded in `agentPrompts` object
- No modular tool system

**Available Tools (2 total):**
1. `web_search` - Web search (Anthropic native tool)
2. `web_fetch` - Web fetch (Anthropic native tool)

**Missing Capabilities:**
- ❌ No file operations (read/write/edit)
- ❌ No bash command execution
- ❌ No file search (glob/grep)
- ❌ No todo/workflow tracking
- ❌ No HubSpot CRM integration
- ❌ All agents have same 2 tools (no per-agent customization)

---

## Problem Statement

Vercel deployment is **significantly behind** Railway in capabilities:

1. **Missing 9 critical tools** that agents need for:
   - Reading grant documents
   - Creating output files
   - Editing drafts
   - Searching knowledge base
   - Tracking complex workflows
   - Querying client data from HubSpot

2. **No tool customization per agent** - all agents get the same limited toolset

3. **Maintenance burden** - 6200-line monolithic file vs modular architecture

---

## Migration Strategy

### Option 1: Full Architecture Migration (RECOMMENDED)

**Approach:** Migrate Vercel to use the Railway architecture

**Steps:**
1. Copy `src/tools/` directory to main branch
2. Copy `.claude/agents/*.md` definitions to main branch
3. Copy `src/agents/load-agents.js` to main branch
4. Replace agent prompt loading in `api/server.js` with modular system
5. Add tool executor integration to Claude API calls
6. Test each agent with new toolset

**Pros:**
- ✅ Future-proof: One codebase to maintain
- ✅ All 11 tools available immediately
- ✅ Per-agent tool customization
- ✅ Easier to add new tools
- ✅ Easier to debug

**Cons:**
- ⚠️ Requires modifying 6200-line file
- ⚠️ Higher risk (more changes)
- ⚠️ Need comprehensive testing

**Timeline:** 2-3 hours

---

### Option 2: Incremental Tool Addition (SAFER)

**Approach:** Add tools one-by-one to existing Vercel architecture

**Steps:**
1. Add read_file tool definition to api/server.js
2. Add tool executor logic
3. Test with one agent
4. Repeat for each tool
5. Update agent prompts to reference available tools

**Pros:**
- ✅ Lower risk (incremental changes)
- ✅ Can test each tool individually
- ✅ Easier to rollback if issues

**Cons:**
- ⚠️ Still working with monolithic file
- ⚠️ Takes longer (10-15 steps)
- ⚠️ Technical debt remains

**Timeline:** 4-5 hours

---

### Option 3: Hybrid Approach (BALANCED)

**Approach:** Extract tools to modules but keep server.js structure

**Steps:**
1. Create `api/tools/` directory in main branch
2. Copy tool implementations from Railway
3. Create tool registry (`api/tools/index.js`)
4. Integrate tool executor into existing Claude API call
5. Update agent prompts with tool lists
6. Test incrementally

**Pros:**
- ✅ Modular tools (maintainable)
- ✅ Keep existing server.js mostly intact
- ✅ Medium risk
- ✅ Can be done incrementally

**Cons:**
- ⚠️ Still have some duplication between branches
- ⚠️ Not full architectural alignment

**Timeline:** 3-4 hours

---

## Recommended Tools to Prioritize

If doing incremental migration, add tools in this order:

### Phase 1: Core File Operations (Critical)
1. **read_file** - Agents need to read grant documents
2. **write_file** - Agents need to create outputs
3. **edit_file** - Agents need to revise drafts

### Phase 2: Search & Discovery (High Priority)
4. **glob** - Find relevant documents
5. **grep** - Search within documents

### Phase 3: Workflow Enhancement (Medium Priority)
6. **todo_write** - Track multi-step workflows
7. **bash** - Run commands (git, npm, etc.)

### Phase 4: Integrations (Lower Priority)
8. **hubspot_query** - CRM integration (when token available)

---

## Tool Implementation Checklist

For each tool being migrated:

- [ ] Copy tool implementation from `src/tools/{tool}.js`
- [ ] Add tool definition to tool registry
- [ ] Update agent prompt/config to include tool
- [ ] Test tool execution in isolation
- [ ] Test tool with actual agent workflow
- [ ] Document tool usage for team
- [ ] Update agent HTML pages if needed (UI hints)

---

## Risk Mitigation

1. **Create feature branch** - Don't modify main directly
   ```bash
   git checkout main
   git checkout -b tools-migration
   ```

2. **Test locally first**
   ```bash
   npm run dev
   # Test each agent
   ```

3. **Gradual rollout**
   - Deploy to Vercel preview environment first
   - Test with real workflows
   - Promote to production after validation

4. **Rollback plan**
   - Keep main branch unchanged until full validation
   - Can revert instantly if issues arise

---

## Success Metrics

Migration is successful when:

- ✅ All 5 agents have appropriate tools available
- ✅ Agents can read grant documents (read_file works)
- ✅ Agents can create outputs (write_file works)
- ✅ Agents can search knowledge base (glob/grep work)
- ✅ Agents can track workflows (todo_write works)
- ✅ No regressions in existing functionality (web_search/fetch still work)
- ✅ Response times remain acceptable
- ✅ Error rates don't increase

---

## Next Steps

**DECISION REQUIRED:**

Which migration strategy do you want to use?

1. **Option 1** - Full Architecture Migration (recommended, 2-3 hours)
2. **Option 2** - Incremental Tool Addition (safer, 4-5 hours)
3. **Option 3** - Hybrid Approach (balanced, 3-4 hours)

Once decided, I'll create a detailed implementation plan with step-by-step instructions.

---

**Created:** October 23, 2025
**Branch:** railway-migration
**Status:** Analysis Complete - Awaiting Decision
