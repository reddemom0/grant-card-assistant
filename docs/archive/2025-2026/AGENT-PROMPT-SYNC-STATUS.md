# Agent Prompt Sync Status

## Goal
Sync comprehensive XML-structured agent prompts from Railway deployment to Vercel deployment.

## Current Status

### ✅ Completed
1. Copied all `.claude/agents/*.md` files from railway-migration branch to main branch
2. Files now available in `.claude/agents/`:
   - `bcafe-writer.md` (206 lines)
   - `canexport-claims.md` (715 lines) - VERY comprehensive!
   - `etg-writer.md` (208 lines)
   - `grant-card-assistant.md` (293 lines)
   - `orchestrator.md` (291 lines)

### 📋 Next Steps

The agent prompts in `api/server.js` need to be updated with the comprehensive versions from `.claude/agents/*.md`.

**Current structure in `api/server.js`:**
```javascript
const agentPrompts = {
  'etg-writer': `<role>...</role>...`,
  'canexport-writer': `You are an expert...`,
  // Other agents
};
```

**Changes needed:**
1. Extract prompt content from each `.md` file (skip YAML frontmatter)
2. Update `agentPrompts` object with comprehensive XML-structured content
3. Ensure all agents have consistent XML tag structure

### Agent Comparison

| Agent | Railway Lines | Vercel Status | Action Needed |
|-------|--------------|---------------|---------------|
| etg-writer | 208 | Similar structure | Minor updates |
| bcafe-writer | 206 | Needs update | Full replacement |
| canexport-claims | 715 | Much simpler | **Major update needed** |
| grant-card-generator | 293 | Uses taskMethodologies | Needs review |
| orchestrator | 291 | May not exist | Add if needed |

### Key Differences Found

**Railway agents have:**
- ✅ Comprehensive XML tag structure (`<role>`, `<workflow>`, `<eligibility_rules>`, etc.)
- ✅ YAML frontmatter specifying tools
- ✅ Detailed workflows and step-by-step processes
- ✅ Extensive examples and edge cases

**Vercel agents currently have:**
- ⚠️ Some XML tags but less comprehensive
- ⚠️ Simpler structure in some cases
- ⚠️ Less detailed workflows

## Recommendation

Update `api/server.js` to use the comprehensive prompts from `.claude/agents/*.md` files.

This can be done by:
1. Reading each `.md` file in `api/server.js` at runtime (dynamic loading)
2. OR manually copying the prompt content (static, faster)

**Option 1 (Dynamic)** - Cleaner long-term:
```javascript
const fs = require('fs');
const path = require('path');

function loadAgentPrompt(agentType) {
  const filePath = path.join(__dirname, '../.claude/agents', `${agentType}.md`);
  const content = fs.readFileSync(filePath, 'utf-8');
  // Strip YAML frontmatter
  return content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

const agentPrompts = {
  'etg-writer': loadAgentPrompt('etg-writer'),
  'bcafe-writer': loadAgentPrompt('bcafe-writer'),
  // ...
};
```

**Option 2 (Static)** - Faster, no runtime file reads:
- Manually copy prompt content from each `.md` file
- Paste into `agentPrompts` object
- Remove YAML frontmatter manually

---

**Status:** Ready to proceed with updates
**Branch:** sync-agent-prompts
**Next Action:** Update api/server.js with comprehensive prompts
