# 🚀 Granted AI Hub - Agent SDK Migration & Development Plan

**Status:** Planning Phase - Not Started
**Branch:** `agent-sdk-migration` (to be created)
**Timeline:** 6 weeks (3 weeks migration + 3 weeks improvements)
**Last Updated:** 2025-10-08

---

## 📋 CRITICAL CONTEXT - READ FIRST

### Current Production System
- **Hosting:** Vercel (serverless, ephemeral file system)
- **Knowledge Base:** Google Drive folders accessed via API at runtime
- **Architecture:** Custom Node.js → Google Drive API → Claude API
- **Model:** Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- **Code:** ~300+ lines in `api/server.js`
- **Agents:** 4 active (Grant Card, ETG, BCAFE, CanExport Claims)

### Target System
- **Hosting:** Vercel (same)
- **Knowledge Base:** `.claude/` folder in Git repository (NO Google Drive API calls)
- **Architecture:** Agent SDK → Claude API
- **Code:** ~50-75 lines in `index.js`
- **Benefits:**
  - 50-80% faster (no Drive API latency)
  - 50-75% cheaper (prompt caching)
  - More reliable (no external dependencies)
  - Version controlled knowledge (Git)

### Strategic Approach
1. ✅ **Create development branch:** `agent-sdk-migration` (DO NOT work on main)
2. ✅ **Keep production running** during entire migration
3. ✅ **Export Google Drive knowledge first** (this is the foundation)
4. ✅ **Start with Grant Card agent** (underused, lower risk)
5. ✅ **Test on Vercel preview** before production
6. ✅ **Agent-by-agent migration** (not all at once)

---

## 📁 Current Project Structure

```
grant-card-assistant/ (Deployed on Vercel)
├── api/
│   ├── server.js                # 5000+ lines - Main backend
│   ├── auth-callback.js         # Google OAuth handler
│   └── auth-google.js           # OAuth initiator
├── etg-agent.html               # ETG Business Case Writer UI
├── grant-cards.html             # Grant Card Assistant UI
├── bcafe-agent.html             # BC Agriculture Export UI
├── canexport-claims.html        # CanExport Claims Auditor UI
├── dashboard.html               # Post-login dashboard
├── index.html                   # Landing page
├── login.html                   # Google OAuth login
├── vercel.json                  # Vercel deployment config
├── package.json
├── .env                         # API keys (Anthropic + Google Drive)
└── .claude/
    └── settings.local.json      # Exists but minimal

KNOWLEDGE BASE: Currently in Google Drive (not in repo)
- Each agent has dedicated Google Drive folder
- Documents fetched via Google Drive API at runtime
- NOT stored locally on server
```

### Critical Architecture: Current Knowledge Flow
```
User Request
  → Vercel Serverless Function
  → Google Drive API (fetch KB docs - SLOW)
  → Build context with KB content
  → Claude API
  → Response to User

Problems:
- Google Drive API latency (50-200ms per doc)
- API quota limits
- External dependency (reliability risk)
- No version control for knowledge
```

---

## 🎯 Target Project Structure (After Migration)

```
grant-card-assistant/ (Deployed on Vercel)
├── api/
│   ├── server.js                # ARCHIVED (kept for reference)
│   ├── index.js                 # NEW - 50-75 lines, Agent SDK
│   ├── auth-callback.js         # Keep (no changes)
│   └── auth-google.js           # Keep (no changes)
├── .claude/                     # NEW - Agent SDK structure (IN GIT REPO)
│   ├── CLAUDE.md               # Shared knowledge across all agents
│   ├── settings.json           # Agent SDK configuration
│   ├── agents/                 # Agent-specific knowledge
│   │   ├── grant-card.md       # Grant Card specialist knowledge
│   │   ├── etg-writer.md       # ETG agent knowledge
│   │   ├── bcafe-writer.md     # BCAFE agent knowledge
│   │   └── canexport-claims.md # CanExport agent knowledge
│   └── commands/               # Custom slash commands (optional)
├── etg-agent.html               # Keep (backend changes only)
├── grant-cards.html             # Keep (backend changes only)
├── bcafe-agent.html             # Keep (backend changes only)
├── canexport-claims.html        # Keep (backend changes only)
├── dashboard.html               # Keep (consolidate later in Phase 2)
├── index.html                   # Keep (consolidate later in Phase 2)
├── login.html                   # Keep (no changes)
├── vercel.json                  # Update for new routing
├── package.json                 # Add @anthropic-ai/claude-agent-sdk
└── .env                         # Keep ANTHROPIC_API_KEY (Google Drive optional)

KNOWLEDGE BASE: In Git repository (.claude/ folder)
- All knowledge exported from Google Drive to Markdown
- Deployed with code to Vercel
- No runtime API calls needed
- Version controlled via Git
```

### New Architecture: Target Knowledge Flow
```
User Request
  → Vercel Serverless Function
  → Agent SDK (reads .claude/ from deployed code - FAST)
  → Claude API (with prompt caching)
  → Response to User

Benefits:
- No external API calls for knowledge (0ms latency)
- No API quota limits
- Deployed with code (deterministic)
- Version controlled (Git history)
- 50-75% cost savings (prompt caching)
```

---

## 📅 PHASE 1: Agent SDK Migration (Weeks 1-3)

### Week 1: Setup & Grant Card Agent Migration

#### Day 1: Environment Setup & Knowledge Base Export (6 hours)

**Critical First Step: Export Google Drive Knowledge**

1. Create development branch
   ```bash
   git checkout -b agent-sdk-migration
   ```

2. **Export Grant Card knowledge from Google Drive**
   - Identify all Google Drive folders/docs for Grant Card agent
   - Current location: [Document Google Drive folder structure]
   - Export each document as Markdown (Google Docs → Download as Markdown)
   - Organize locally in `./migration-exports/grant-card/`
   - Create mapping document: `GOOGLE-DRIVE-MAPPING.md`
     ```
     Google Drive Doc ID → Future .claude/agents/grant-card.md section
     ```

3. Install Agent SDK
   ```bash
   npm install @anthropic-ai/claude-agent-sdk
   ```

4. Create `.claude/` folder structure
   ```bash
   mkdir -p .claude/agents
   mkdir -p .claude/commands
   ```

5. Create initial files:
   ```bash
   touch .claude/CLAUDE.md
   touch .claude/settings.json
   touch .claude/agents/grant-card.md
   ```

6. Test Agent SDK installation with minimal example
   ```javascript
   // test-sdk.js
   import { Agent } from '@anthropic-ai/claude-agent-sdk';

   const agent = new Agent({
     systemPrompt: 'You are a helpful assistant.',
     settingSources: ['project']
   });

   const response = await agent.sendMessage('Hello!');
   console.log(response);
   ```

**Deliverables:**
- ✅ Development branch created
- ✅ All Grant Card knowledge exported from Google Drive
- ✅ Agent SDK installed and tested locally
- ✅ `.claude/` structure created
- ✅ Can run basic Agent SDK example
- ✅ Google Drive mapping documented

---

#### Day 2: Migrate Grant Card Knowledge Base (6 hours)

**Tasks:**

1. Review exported Grant Card knowledge from `./migration-exports/grant-card/`

2. Consolidate into `.claude/agents/grant-card.md`
   - Combine all exported markdown files
   - Move all Grant Card examples (from Google Drive exports)
   - Move all Grant Card workflows (from Google Drive exports)
   - Move Grant Card templates (from Google Drive exports)
   - Format as single cohesive markdown document
   - Ensure all content is well-organized and searchable

3. Create shared knowledge in `.claude/CLAUDE.md`
   ```markdown
   # Granted AI Hub - Shared Knowledge

   ## Company Information
   [General info about Granted Consulting]

   ## General Writing Guidelines
   [Guidelines that apply to ALL agents]

   ## Shared Best Practices
   [Cross-agent best practices]

   NOTE: Agent-specific knowledge goes in .claude/agents/[agent].md
   ```

4. Structure of `grant-card.md`:
   ```markdown
   # Grant Card Specialist Agent

   You are an expert at creating Grant Cards for Granted Consulting.

   ## Your Role
   [Define what this agent does]

   ## Successful Examples
   [3-5 complete examples of great grant cards from Google Drive]

   ## Templates
   [Exact template to follow from Google Drive]

   ## Workflows
   ### Generate Grant Card Criteria
   1. [Step by step process from Google Drive docs]

   ### Preview Grant Card
   1. [Step by step process]

   [All 6 workflows documented from Google Drive]

   ## Common Mistakes to Avoid
   [List of things NOT to do]

   ## Quality Checklist
   [How to verify output quality]
   ```

5. **Commit `.claude/` to Git**
   ```bash
   git add .claude/
   git commit -m "Add Grant Card agent knowledge base from Google Drive"
   ```

**Deliverables:**
- ✅ `.claude/CLAUDE.md` populated with shared knowledge
- ✅ `.claude/agents/grant-card.md` complete with all workflows and examples
- ✅ All Google Drive content successfully migrated
- ✅ Knowledge base committed to Git
- ✅ Clear mapping from old Google Drive structure to new `.claude/` structure

---

#### Day 3: Implement Grant Card Agent with SDK (8 hours)

**Tasks:**

1. Create new `api/index.js` with Agent SDK implementation
   ```javascript
   import { Agent } from '@anthropic-ai/claude-agent-sdk';
   import express from 'express';
   import fs from 'fs';

   const app = express();
   app.use(express.json());

   // Load Grant Card agent (reads from .claude/ folder)
   const grantCardAgent = new Agent({
     systemPrompt: fs.readFileSync('./.claude/agents/grant-card.md', 'utf8'),
     settingSources: ['project'],  // Auto-loads CLAUDE.md
     allowedTools: ['filesystem']
   });

   // API endpoint for Grant Card agent
   app.post('/api/chat/grant-card', async (req, res) => {
     try {
       const { message, conversationId } = req.body;
       const response = await grantCardAgent.sendMessage(message, {
         conversationId
       });
       res.json(response);
     } catch (error) {
       console.error('Grant Card agent error:', error);
       res.status(500).json({ error: error.message });
     }
   });

   // Health check
   app.get('/api/health', (req, res) => {
     res.json({ status: 'ok', version: 'sdk-preview' });
   });

   // For local development
   const PORT = process.env.PORT || 3001;
   if (process.env.NODE_ENV !== 'production') {
     app.listen(PORT, () => {
       console.log(`SDK version running on port ${PORT}`);
     });
   }

   // For Vercel serverless
   export default app;
   ```

2. **Test locally first**
   ```bash
   # Run SDK version locally
   node api/index.js

   # Test with curl
   curl -X POST http://localhost:3001/api/chat/grant-card \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello, create a grant card for a tech startup"}'
   ```

3. **Update `vercel.json` for SDK routing**
   ```json
   {
     "rewrites": [
       { "source": "/api/chat/(.*)", "destination": "/api/index.js" }
     ]
   }
   ```

4. **Create Vercel preview deployment**
   ```bash
   git add .
   git commit -m "Add Grant Card agent with Agent SDK"
   git push origin agent-sdk-migration

   # Vercel automatically deploys to preview URL
   # Access at: https://grant-card-assistant-git-agent-sdk-migration-[team].vercel.app
   ```

5. Update `grant-cards.html` to test SDK version
   ```javascript
   // Add environment detection
   const API_BASE = window.location.hostname.includes('agent-sdk-migration')
     ? '/api/chat/grant-card'  // SDK version
     : '/api/chat-old/grant-card';  // Old version

   console.log('Using API:', API_BASE);
   ```

6. Test Grant Card agent with SDK:
   - Upload real grant documents
   - Test all 6 workflows
   - Compare output to old system (still running in production)
   - Verify file processing works
   - Check context management
   - **Confirm no Google Drive API calls needed** (check Vercel logs)

**Deliverables:**
- ✅ `api/index.js` created with Grant Card agent
- ✅ SDK version tested locally
- ✅ SDK version deployed to Vercel preview
- ✅ Old production system still running (safety net)
- ✅ Can compare old vs new implementations
- ✅ Basic functionality working
- ✅ Confirmed `.claude/` files deploy correctly to Vercel

---

#### Day 4-5: Testing & Refinement (10 hours)

**Comprehensive Testing Checklist:**

1. **Functional Testing:**
   - [ ] Test with 10+ real grant documents
   - [ ] Test all 6 workflows:
     - [ ] Generate Grant Card Criteria
     - [ ] Preview Grant Card Description
     - [ ] Generate Requirements
     - [ ] Generate Insights
     - [ ] Generate Categories
     - [ ] Identify Missing Information
   - [ ] Test file uploads:
     - [ ] .pdf files
     - [ ] .docx files
     - [ ] .md files
     - [ ] .txt files
     - [ ] Large files (> 5MB)
   - [ ] Test conversation continuity (multi-turn)
   - [ ] Test error handling (bad inputs, timeouts)

2. **Quality Comparison:**
   - Create spreadsheet: `migration-testing/grant-card-comparison.xlsx`
   - Columns: Test Case | Old System Output | SDK Output | Quality Rating | Notes
   - Test same inputs on both systems
   - Document any quality differences
   - Identify any issues

3. **Performance Testing:**
   - [ ] Response time comparison (old vs new)
   - [ ] Cold start performance on Vercel
   - [ ] Check for timeout issues (Vercel 10s/60s limit)
   - [ ] Monitor Vercel function logs
   - [ ] Verify prompt caching working (check API costs)

4. **Refinement:**
   - Adjust `.claude/agents/grant-card.md` based on test results
   - Improve prompts if quality issues found
   - Fix any bugs in `api/index.js`
   - Optimize performance (if needed)

5. **User Feedback:**
   - Have team member test Grant Card SDK version
   - Document feedback in `migration-testing/user-feedback.md`
   - Make improvements based on feedback

**Decision Gate:**
- ✅ If quality is same/better → Proceed to Week 2
- ⚠️ If quality issues → Investigate and fix before proceeding
- 🛑 If unfixable quality issues → Escalate (rare, but document for Anthropic support)

**Deliverables:**
- ✅ Grant Card agent fully tested
- ✅ Quality comparison documented
- ✅ Any issues fixed
- ✅ Team feedback incorporated
- ✅ Confidence in SDK approach
- ✅ Ready to migrate next agent

---

### Week 2: Migrate Remaining Agents (20 hours)

#### Agent Migration Priority:
1. **ETG Writer** (most used after Grant Card)
2. **BCAFE Writer** (medium complexity)
3. **CanExport Claims** (most complex, save for last)

#### Per Agent Process (5 hours each):

**Step 1: Export from Google Drive (1 hour)**
1. Identify all Google Drive folders/docs for this agent
2. Export each document as Markdown
3. Organize exported files in `./migration-exports/[agent-name]/`
4. Document in `GOOGLE-DRIVE-MAPPING.md`:
   ```
   ## [Agent Name]
   - Google Drive folder: [URL]
   - Documents exported: [list]
   - Mapping: [Drive doc → .claude/agents/[agent].md section]
   ```

**Step 2: Knowledge Migration (2 hours)**
1. Review agent's exported Google Drive content
2. Create `.claude/agents/[agent-name].md`
3. Consolidate all agent-specific content:
   - Examples (from Google Drive)
   - Workflows (from Google Drive)
   - Templates (from Google Drive)
   - Best practices (from Google Drive)
4. Ensure knowledge isolation (agent doesn't see other agents' knowledge)
5. Structure similar to grant-card.md:
   ```markdown
   # [Agent Name] Agent

   ## Your Role
   [Define agent purpose]

   ## Successful Examples
   [3-5 examples from Google Drive]

   ## Templates
   [Templates from Google Drive]

   ## Workflows
   [Step-by-step processes from Google Drive]

   ## Common Mistakes
   [What to avoid]

   ## Quality Checklist
   [How to verify quality]
   ```
6. Commit to Git:
   ```bash
   git add .claude/agents/[agent-name].md
   git commit -m "Add [agent-name] knowledge from Google Drive"
   ```

**Step 3: Code Implementation (1 hour)**
```javascript
// In api/index.js, add new agent:
const etgAgent = new Agent({
  systemPrompt: fs.readFileSync('./.claude/agents/etg-writer.md', 'utf8'),
  settingSources: ['project'],
  allowedTools: ['filesystem']
});

// Add API endpoint
app.post('/api/chat/etg', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    const response = await etgAgent.sendMessage(message, { conversationId });
    res.json(response);
  } catch (error) {
    console.error('ETG agent error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

**Step 4: Testing (1 hour)**
1. Test locally:
   ```bash
   node api/index.js
   curl -X POST http://localhost:3001/api/chat/etg -H "Content-Type: application/json" -d '{"message": "Help me with an ETG business case"}'
   ```
2. Deploy to Vercel preview:
   ```bash
   git push origin agent-sdk-migration
   ```
3. Test with real documents on Vercel preview
4. Compare to old system (still running in production)
5. Get user feedback
6. Refine prompts/knowledge as needed

**Repeat for all 3 agents**

**Deliverables:**
- ✅ All 4 agents migrated to SDK
- ✅ All Google Drive content exported and consolidated
- ✅ All agents tested and working on Vercel preview
- ✅ Production system still running as safety net
- ✅ Knowledge base fully organized in `.claude/` and committed to Git

---

### Week 3: Integration, Testing & Deployment (15 hours)

#### Day 1: Full Integration (5 hours)

**Tasks:**

1. Integrate all agents into single `api/index.js`
   ```javascript
   import { Agent } from '@anthropic-ai/claude-agent-sdk';
   import express from 'express';
   import fs from 'fs';

   const app = express();
   app.use(express.json());

   // Load all agents
   const agents = {
     'grant-card': new Agent({
       systemPrompt: fs.readFileSync('./.claude/agents/grant-card.md', 'utf8'),
       settingSources: ['project'],
       allowedTools: ['filesystem']
     }),
     'etg': new Agent({
       systemPrompt: fs.readFileSync('./.claude/agents/etg-writer.md', 'utf8'),
       settingSources: ['project'],
       allowedTools: ['filesystem']
     }),
     'bcafe': new Agent({
       systemPrompt: fs.readFileSync('./.claude/agents/bcafe-writer.md', 'utf8'),
       settingSources: ['project'],
       allowedTools: ['filesystem']
     }),
     'canexport': new Agent({
       systemPrompt: fs.readFileSync('./.claude/agents/canexport-claims.md', 'utf8'),
       settingSources: ['project'],
       allowedTools: ['filesystem']
     })
   };

   // Unified API endpoint with agent routing
   app.post('/api/chat', async (req, res) => {
     try {
       const { agentType, message, conversationId } = req.body;

       if (!agents[agentType]) {
         return res.status(400).json({ error: `Unknown agent type: ${agentType}` });
       }

       const agent = agents[agentType];
       const response = await agent.sendMessage(message, { conversationId });

       res.json({
         success: true,
         response,
         agentType,
         conversationId
       });
     } catch (error) {
       console.error(`Agent error (${req.body.agentType}):`, error);
       res.status(500).json({
         success: false,
         error: error.message
       });
     }
   });

   // Health check
   app.get('/api/health', (req, res) => {
     res.json({
       status: 'ok',
       version: 'sdk',
       agents: Object.keys(agents),
       timestamp: new Date().toISOString()
     });
   });

   // For Vercel serverless
   export default app;
   ```

2. Update all frontend HTML files to use new API structure:
   ```javascript
   // In etg-agent.html, grant-cards.html, etc.
   async function sendMessage(message) {
     const response = await fetch('/api/chat', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         agentType: 'etg',  // or 'grant-card', 'bcafe', 'canexport'
         message,
         conversationId: currentConversationId
       })
     });
     return response.json();
   }
   ```

3. Test agent switching works correctly on Vercel preview
4. Verify all `.claude/` files are included in Vercel build:
   ```bash
   # Check Vercel build logs for:
   # "Including .claude/ in deployment"
   ```

**Deliverables:**
- ✅ Single unified API endpoint
- ✅ All agents accessible via routing
- ✅ Frontend updated for all 4 agents
- ✅ Clean code structure
- ✅ Working on Vercel preview deployment

---

#### Day 2: Comprehensive Testing (5 hours)

**End-to-End Testing Checklist:**

1. **Functional Testing (Vercel Preview):**
   - [ ] Test each agent individually
   - [ ] Test switching between agents in same session
   - [ ] Test file uploads on all agents
   - [ ] Test conversation continuity across agents
   - [ ] Test concurrent users (simulate load)
   - [ ] Test error scenarios (bad inputs, network errors)
   - [ ] **Verify no Google Drive API calls** (check Vercel logs)

2. **Performance Comparison:**
   Create `migration-testing/performance-comparison.xlsx`:
   - Response time: Old vs SDK
   - Cold start time: Old vs SDK
   - API cost per request: Old vs SDK (should be 50-75% lower)
   - Vercel function duration: Old vs SDK
   - Memory usage: Old vs SDK

3. **Vercel-Specific Testing:**
   - [ ] Test serverless function timeout limits
   - [ ] Verify `.claude/` files accessible in serverless environment
   - [ ] Test edge cases (large files, long conversations)
   - [ ] Check cold start performance (first request after idle)
   - [ ] Monitor Vercel function logs for errors

4. **Create Test Documentation:**
   - `migration-testing/test-plan.md` - Test cases
   - `migration-testing/test-results.md` - Results
   - `migration-testing/issues-found.md` - Issues and resolutions

**Deliverables:**
- ✅ All functionality tested on Vercel
- ✅ Performance metrics documented
- ✅ No critical bugs
- ✅ System ready for production deployment

---

#### Day 3: Production Deployment & Documentation (5 hours)

**Pre-Deployment Checklist:**

1. **Code Cleanup:**
   - [ ] Archive old `api/server.js`:
     ```bash
     mkdir archive
     git mv api/server.js archive/server-old-google-drive.js
     git commit -m "Archive old Google Drive-based system"
     ```
   - [ ] Document how old system worked:
     Create `archive/OLD-SYSTEM-ARCHITECTURE.md`
   - [ ] Remove unused dependencies:
     ```bash
     npm uninstall googleapis google-auth-library
     npm audit fix
     ```
   - [ ] Update `package.json` with new dependencies
   - [ ] Ensure `vercel.json` configured correctly:
     ```json
     {
       "version": 2,
       "builds": [
         { "src": "api/index.js", "use": "@vercel/node" }
       ],
       "routes": [
         { "src": "/api/chat", "dest": "/api/index.js" },
         { "src": "/api/health", "dest": "/api/index.js" }
       ]
     }
     ```

2. **Documentation:**
   - [ ] Update `README.md`:
     ```markdown
     # Granted AI Hub

     ## Architecture
     - Agent SDK-based system
     - Knowledge base in `.claude/` folder (Git repository)
     - No external API dependencies for knowledge serving

     ## Adding New Agents
     1. Create `.claude/agents/new-agent.md`
     2. Add agent to `api/index.js`
     3. Test locally, deploy to preview, merge to production

     ## Updating Knowledge Base
     ### Option 1: Direct Git Updates
     1. Edit `.claude/agents/[agent].md`
     2. Commit and push
     3. Vercel auto-deploys

     ### Option 2: Admin UI (Phase 2)
     Coming soon - edit knowledge via web interface

     ## Environment Variables
     - `ANTHROPIC_API_KEY` - Required
     - `NODE_ENV` - development | production
     - `PORT` - Local development port (default: 3001)
     ```

   - [ ] Create `.claude/README.md`:
     ```markdown
     # Agent Knowledge Base

     ## Structure
     - `CLAUDE.md` - Shared knowledge across all agents
     - `agents/` - Agent-specific knowledge
     - `settings.json` - Agent SDK configuration

     ## Agent Files
     - `grant-card.md` - Grant Card Assistant
     - `etg-writer.md` - ETG Business Case Writer
     - `bcafe-writer.md` - BC Agriculture Export Writer
     - `canexport-claims.md` - CanExport Claims Auditor

     ## Updating Knowledge
     Edit markdown files directly, commit, and push.
     Changes deploy automatically via Vercel.
     ```

   - [ ] Document environment variables:
     Create `.env.example`:
     ```
     ANTHROPIC_API_KEY=your_key_here
     NODE_ENV=development
     PORT=3001
     ```

3. **Production Deployment:**
   ```bash
   # Final checks
   git status
   git log --oneline -10

   # Merge to main
   git checkout main
   git merge agent-sdk-migration

   # Tag release
   git tag -a v2.0.0-agent-sdk -m "Migration to Agent SDK complete"

   # Deploy to production
   git push origin main --tags

   # Monitor Vercel deployment
   # Check logs at: https://vercel.com/[team]/grant-card-assistant/deployments
   ```

4. **Post-Deployment Monitoring:**
   - [ ] Monitor Vercel logs for 1 hour
   - [ ] Test all agents in production
   - [ ] Check API costs (should be lower)
   - [ ] Verify response times (should be faster)
   - [ ] Monitor error rates
   - [ ] Keep `agent-sdk-migration` branch for 1 week (rollback safety)

5. **Team Training:**
   - [ ] Show team new `.claude/` structure
   - [ ] Explain how to update knowledge base (Git workflow)
   - [ ] Demonstrate how to add new agents
   - [ ] Document common troubleshooting steps

**Vercel Deployment Checklist:**
- [ ] `vercel.json` configured for serverless functions
- [ ] `.claude/` folder committed to Git
- [ ] Environment variables set in Vercel dashboard
- [ ] Build succeeds on Vercel
- [ ] All routes working
- [ ] Serverless functions respond correctly
- [ ] No 504 timeout errors
- [ ] Cold starts acceptable (< 3 seconds)

**Deliverables:**
- ✅ Clean codebase
- ✅ Documentation complete
- ✅ Deployed to Vercel production
- ✅ Team trained
- ✅ Google Drive API calls eliminated
- ✅ Migration complete! 🎉

**Expected Results:**
- ⚡ 50-80% faster response times
- 💰 50-75% lower API costs
- 🛡️ More reliable (no external dependencies)
- 👨‍💻 90% less code to maintain
- 📊 Version controlled knowledge

---

## 📅 PHASE 2: Site Improvements (Weeks 4-6)

### Parallel Work During Migration (Can be done simultaneously)

These features don't depend on backend architecture:
- ✅ Custom 404 page (2 hours)
- ✅ About page content (3 hours)
- ✅ Help documentation content writing (4 hours)
- ✅ Legal pages drafts (Privacy, Terms, Support) (2 hours)
- ✅ UI polish and styling improvements (4 hours)

**Total: ~15 hours of work that can happen during Weeks 1-3**

---

### Week 4: Foundation & Core Features (18 hours)

#### URL Structure Cleanup (3 hours)

**Current URLs:**
```
/grant-cards.html
/etg-agent.html
/bcafe-agent.html
/canexport-claims.html
```

**New URLs:**
```
/agents/grant-cards
/agents/etg-writer
/agents/bcafe-writer
/agents/canexport-claims
```

**Implementation:**
1. Update `vercel.json` with rewrites:
   ```json
   {
     "rewrites": [
       { "source": "/agents/grant-cards", "destination": "/grant-cards.html" },
       { "source": "/agents/etg-writer", "destination": "/etg-agent.html" },
       { "source": "/agents/bcafe-writer", "destination": "/bcafe-agent.html" },
       { "source": "/agents/canexport-claims", "destination": "/canexport-claims.html" }
     ]
   }
   ```
2. Add redirects from old URLs (301 permanent)
3. Update all internal links
4. Update agent selection grid in dashboard
5. Test all routes

---

#### Dashboard Consolidation (4 hours)

**Current:** Both `index.html` and `dashboard.html` exist (redundant)

**New Structure:**
```
/                    → Public landing (if not authenticated)
                      OR redirect to /dashboard
/dashboard           → Main authenticated home with agent grid
/login               → Google OAuth login
```

**Implementation:**
1. Merge index + dashboard into single `/dashboard`
2. Create simple public landing at `/` (if not auth'd)
3. Add auth check and redirect logic
4. Update navigation flow
5. Test authentication flow

---

#### Conversation History Page (8 hours)

**Route:** `/history`

**Features:**
- View all conversations across all agents
- Filter by agent type, date range
- Search by keywords
- Click to resume conversation
- Export individual conversations (JSON/Markdown)
- Delete conversations

**Implementation:**
1. Backend API endpoint:
   ```javascript
   // GET /api/conversations?agentType=etg&startDate=2025-01-01
   app.get('/api/conversations', async (req, res) => {
     const { agentType, startDate, endDate, search } = req.query;
     // Query PostgreSQL with filters
     // Return conversation list
   });
   ```

2. Frontend UI with search/filter controls
3. Resume conversation functionality
4. Export and delete actions
5. Responsive design (mobile-friendly)

---

#### Custom 404 Page (2 hours)

Deploy the 404 page created during parallel work.

**Implementation:**
1. Create `404.html` with helpful navigation
2. Configure in `vercel.json`:
   ```json
   { "error": 404, "destination": "/404.html" }
   ```
3. Test with various invalid URLs

---

### Week 5: Admin Features (15 hours)

#### Admin Dashboard & Role System (10 hours)

**Route:** `/admin` (admin-only access)

**Phase 1: Role System**
1. Add `role` field to user JWT (`admin` | `user`)
2. Create `requireAdmin()` middleware in `api/index.js`:
   ```javascript
   function requireAdmin(req, res, next) {
     const token = req.cookies.granted_session;
     const decoded = jwt.verify(token, process.env.JWT_SECRET);
     if (decoded.role !== 'admin') {
       return res.status(403).json({ error: 'Admin access required' });
     }
     next();
   }
   ```
3. Set initial admins via env: `ADMIN_EMAILS=admin1@granted.com,admin2@granted.com`

**Phase 2: Admin Dashboard UI**

**System Overview Section:**
- Total active users (today, this week, all time)
- API calls today/month + estimated cost
- Knowledge base document count (files in `.claude/`)
- Server health status (Vercel function status)
- Average response time
- Error rate

**User Management Section:**
- List all users with roles
- Promote/demote admin status (toggle)
- View user activity stats (conversations, API calls)
- Deactivate/activate users
- User details modal (signup date, last active, usage)

**Activity Monitor:**
- Recent conversations (all users) with previews
- API usage by user (chart)
- Most used agents (chart)
- Error log (last 100 errors)

**Knowledge Base Management:**
- **View `.claude/` structure** (agents and their knowledge files)
- **Edit knowledge inline** (Monaco code editor for `.claude/agents/*.md`)
- **Preview changes** before committing
- **Git integration:**
  - Commit changes with message
  - Push to trigger Vercel deployment
  - View commit history (last 50 commits)
  - Diff viewer (compare versions)
- **Upload new markdown files** to replace existing ones
- View last sync/deployment time
- Deployment status (pending, success, failed)

**Phase 3: Admin API Endpoints**
```javascript
GET    /api/admin/analytics          # System stats
GET    /api/admin/users              # List users
PUT    /api/admin/users/:id/role     # Change user role
GET    /api/admin/activity           # Recent activity
GET    /api/admin/knowledge          # List .claude/ files
GET    /api/admin/knowledge/:file    # Get file content
PUT    /api/admin/knowledge/:file    # Update knowledge file
POST   /api/admin/knowledge/deploy   # Commit + deploy changes
GET    /api/admin/knowledge/history  # Git commit history
GET    /api/admin/errors             # Error log
```

**Implementation Notes:**
- Knowledge updates write to `.claude/` files in Git
- Use simple Git commands via Node.js child_process:
  ```javascript
  import { exec } from 'child_process';

  app.post('/api/admin/knowledge/deploy', requireAdmin, async (req, res) => {
    const { message } = req.body;

    // Stage changes
    exec('git add .claude/', (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Commit
      exec(`git commit -m "${message}"`, (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Push (triggers Vercel deployment)
        exec('git push origin main', (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, message: 'Deployment triggered' });
        });
      });
    });
  });
  ```
- Admin sees deployment status in real-time (webhook from Vercel)
- Changes are version controlled (Git history)
- Can revert to previous versions if needed

**Benefits:**
- Non-technical team can update knowledge base
- Version control for all knowledge changes
- No more Google Drive dependencies
- Faster updates (no external API calls)
- Audit trail (who changed what, when)

---

#### User Profile Page (5 hours)

**Route:** `/profile`

**Features:**
- User info (name, email, photo from Google)
- Account creation date
- Usage statistics:
  - Total conversations
  - API calls made
  - Files uploaded
  - Favorite agent (most used)
- Active sessions (list of devices/browsers)
- Logout button (all sessions or current only)

**Implementation:**
1. Backend API:
   ```javascript
   GET /api/profile        # Get user profile + stats
   GET /api/profile/sessions  # List active sessions
   DELETE /api/profile/sessions/:id  # Logout specific session
   ```
2. Frontend UI with cards for each section
3. Charts for usage over time
4. Session management (logout controls)

---

### Week 6: Polish & Documentation (9 hours)

#### Help/Documentation Page (6 hours)

**Route:** `/help`

**Content Sections:**
- **Getting Started Guide**
  - How to log in
  - How to choose an agent
  - How to upload files
  - How to start a conversation

- **Agent-Specific Guides**
  - Grant Card Assistant - How to use
  - ETG Writer - How to use
  - BCAFE Writer - How to use
  - CanExport Claims - How to use

- **Tips for Best Results**
  - How to write effective prompts
  - What information to provide
  - How to iterate on results
  - File format best practices

- **Troubleshooting**
  - Can't log in
  - File upload fails
  - Agent not responding
  - Conversation disappeared

- **FAQ**
  - Is my data private?
  - How much does it cost?
  - Can I export conversations?
  - How do I report a bug?

**Implementation:**
1. Create `help.html` with searchable content
2. Add table of contents navigation
3. Add search functionality (client-side)
4. Link from all pages (help icon in header)
5. Deploy content written during parallel work

---

#### About & Legal Pages (3 hours)

**Routes:**
- `/about` - About Granted Consulting and AI Hub
- `/privacy` - Privacy Policy
- `/terms` - Terms of Service
- `/support` - Contact/Support

**Implementation:**
1. Create each page with professional content
2. Add links in footer
3. Ensure legal compliance (GDPR, privacy)
4. Deploy content written during parallel work

---

## ✅ Success Criteria

### Phase 1 (SDK Migration) Success Metrics:
- [ ] All 4 agents migrated to Agent SDK
- [ ] Output quality same or better than old system
- [ ] All file processing works correctly
- [ ] Context management handles large documents (200K tokens)
- [ ] API costs reduced by ~50-75% (prompt caching)
- [ ] Response times 50-80% faster (no Google Drive API)
- [ ] Code reduced from ~300 lines to ~50-75 lines
- [ ] Team trained on new structure
- [ ] Old system archived as backup
- [ ] `.claude/` folder committed to Git
- [ ] Deployed successfully on Vercel production
- [ ] No Google Drive API dependencies

### Phase 2 (Site Improvements) Success Metrics:
- [ ] Clean URL structure (/agents/*)
- [ ] Single dashboard entry point
- [ ] Conversation history accessible and searchable
- [ ] Admin can manage users and knowledge base
- [ ] Knowledge base editable via admin UI (Git-backed)
- [ ] Users can view their profile and stats
- [ ] Professional help documentation
- [ ] Legal compliance (privacy, terms)
- [ ] Custom 404 page
- [ ] All features tested and deployed

---

## 🔧 Technical Notes

### Key Files to Focus On:

**During Migration:**
1. `api/server.js` - Study current logic and Google Drive integration
2. Google Drive folders - Content to export and migrate
3. Create new `api/index.js` - Agent SDK implementation
4. `.claude/agents/*.md` - Knowledge base files

**During Site Improvements:**
1. Frontend HTML files - UI updates
2. `api/index.js` - Add new API endpoints for admin features
3. Create new pages: `/admin`, `/profile`, `/history`, etc.

### Testing Commands:

```bash
# Local development:
node api/index.js
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"agentType":"grant-card","message":"Hello"}'

# Vercel preview deployment:
git push origin agent-sdk-migration
# Access at preview URL from Vercel dashboard

# Production deployment:
git checkout main
git merge agent-sdk-migration
git push origin main
```

### Important Vercel Considerations:

**✅ What Works Great on Vercel:**
- Agent SDK with `.claude/` files in Git repo
- Serverless functions (api/index.js becomes serverless)
- Automatic preview deployments per branch
- Zero-downtime deployments
- Edge caching for static assets

**⚠️ Vercel Limitations:**
- Serverless function timeout: 10 seconds (Hobby), 60 seconds (Pro)
  - Long-running agent tasks might timeout
  - Test with complex grants to verify
- Ephemeral file system (why `.claude/` must be in Git)
- Cold starts on serverless functions (first request slower ~2-3s)
- 50MB deployment size limit (shouldn't be an issue)

**💡 Optimization Tips:**
- Keep `.claude/` files reasonable size (< 5MB total recommended)
- Use prompt caching (Agent SDK does automatically)
- Monitor Vercel function logs for timeout issues
- Consider upgrading to Pro if hitting 10s timeout frequently
- Use Vercel Edge Functions for faster cold starts (optional, Phase 3)

### Environment Variables:

**Required:**
```bash
ANTHROPIC_API_KEY=your_key_here
JWT_SECRET=your_jwt_secret
```

**Optional:**
```bash
ADMIN_EMAILS=admin1@granted.com,admin2@granted.com
NODE_ENV=development
PORT=3001
```

**No Longer Needed (After Migration):**
```bash
# These can be removed after migration:
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_API_KEY=...
```

### Git Workflow:

```bash
# Start migration:
git checkout -b agent-sdk-migration

# Regular commits:
git add .
git commit -m "Descriptive message"
git push origin agent-sdk-migration

# When ready to deploy:
git checkout main
git merge agent-sdk-migration
git push origin main

# Tag release:
git tag -a v2.0.0 -m "Agent SDK migration complete"
git push origin --tags
```

---

## 🚨 Critical Reminders

1. **DO NOT work directly on `main` branch** - Always use `agent-sdk-migration` branch
2. **Export all Google Drive knowledge first** - This is the foundation
3. **Keep old system running** until SDK version is fully tested
4. **Test with real grant documents** - Don't just test with dummy data
5. **Get user feedback** after each agent migration
6. **Document everything** - Future you will thank present you
7. **Backup before deployment** - Always have a rollback plan
8. **Agent knowledge isolation** - Each agent should only see its own `.md` file + shared `CLAUDE.md`
9. **Vercel preview testing** - Always test on Vercel infrastructure before production
10. **Monitor Vercel logs** - Watch for timeout or cold start issues
11. **Commit `.claude/` to Git** - Knowledge must be in repository for Vercel deployment
12. **No runtime file generation** - All knowledge must exist at build time

---

## 📞 Support & Resources

**Agent SDK Documentation:**
- Official Docs: https://docs.anthropic.com/claude-code/sdk
- GitHub: https://github.com/anthropics/claude-agent-sdk-typescript
- Examples: https://github.com/anthropics/claude-agent-sdk-typescript/tree/main/examples

**Vercel Documentation:**
- Serverless Functions: https://vercel.com/docs/functions/serverless-functions
- Deployments: https://vercel.com/docs/deployments/overview
- Environment Variables: https://vercel.com/docs/projects/environment-variables

**Questions to Ask During Migration:**
- "How do I implement [specific feature] with Agent SDK?"
- "What's the best way to structure knowledge for [agent type]?"
- "How can I test this functionality on Vercel?"
- "Is there a better way to do this?"
- "How do I handle [edge case]?"

**Debugging Tips:**
- Use `console.log()` extensively during development
- Test each agent individually before integration
- Compare SDK output with old system output side-by-side
- Check Agent SDK error messages carefully
- Monitor Vercel logs for serverless-specific issues
- Use Vercel CLI for local testing: `vercel dev`

---

## 🎯 End Goal

**A production-ready AI Hub with:**
- ✅ Clean, maintainable codebase (90% less code)
- ✅ Professional site structure
- ✅ Multiple specialized agents (4 initially, easy to add more)
- ✅ Admin management capabilities (users + knowledge)
- ✅ User profiles and conversation history
- ✅ Comprehensive documentation
- ✅ Legal compliance (privacy, terms)
- ✅ Scalable architecture (Agent SDK + Vercel serverless)
- ✅ Cost-optimized (50-75% reduction via prompt caching)
- ✅ Future-proof (Agent SDK maintained by Anthropic)
- ✅ **50-80% faster response times** (no Google Drive API latency)
- ✅ **More reliable** (no external API dependencies for knowledge)
- ✅ **Version controlled knowledge** (Git-based, audit trail)
- ✅ **Vercel-optimized** (serverless-friendly architecture)
- ✅ **Easy knowledge updates** (admin UI or direct Git edits)

---

## 📈 Expected Benefits After Migration

### Performance Improvements:
- ⚡ **50-80% faster response times** (no Google Drive API calls)
- ⚡ **Cold start optimized** (knowledge embedded in deployment)
- ⚡ **No API quota limits** (knowledge in Git, not external API)
- ⚡ **Consistent performance** (no external API variability)

### Cost Savings:
- 💰 **50-75% reduced Claude API costs** (prompt caching)
- 💰 **Zero Google Drive API costs** (no more API calls)
- 💰 **Reduced Vercel function duration** (faster = cheaper)
- 💰 **Predictable costs** (no Google Drive API quota overages)

### Reliability Improvements:
- 🛡️ **No Google Drive API downtime risk**
- 🛡️ **Version control for knowledge** (Git history, revert capability)
- 🛡️ **Rollback capability** (Git branch management)
- 🛡️ **Deterministic deployments** (everything in code)
- 🛡️ **Audit trail** (who changed what, when)

### Developer Experience:
- 👨‍💻 **90% less code to maintain** (300+ lines → 50-75 lines)
- 👨‍💻 **Easier to add new agents** (just create .md file)
- 👨‍💻 **Better debugging** (all knowledge in repo, searchable)
- 👨‍💻 **Anthropic handles infrastructure** (SDK maintained for us)
- 👨‍💻 **Standard tooling** (Git, Vercel, no custom integrations)

### Team Experience:
- 🎯 **Non-technical team can update knowledge** (admin UI in Phase 2)
- 🎯 **Faster iterations** (edit .md file, deploy in 2 minutes)
- 🎯 **Clear ownership** (Git history shows who changed what)
- 🎯 **No more Google Drive sync issues**
- 🎯 **Consistent knowledge** (single source of truth in Git)

---

## 📝 Current Status

**Phase:** Planning Complete ✅
**Next Step:** Day 1 - Environment Setup & Knowledge Base Export
**Blocked On:** Agent SDK documentation from user

**Pending Actions:**
1. Receive Agent SDK documentation
2. Create `agent-sdk-migration` branch
3. Begin Google Drive knowledge export

---

## 📅 Timeline Summary

| Week | Focus | Hours | Status |
|------|-------|-------|--------|
| 1 | Setup + Grant Card Migration | 30 | ⏳ Pending |
| 2 | Migrate Remaining Agents | 20 | ⏳ Pending |
| 3 | Integration + Deployment | 15 | ⏳ Pending |
| 4 | Site Improvements Foundation | 18 | ⏳ Pending |
| 5 | Admin Features | 15 | ⏳ Pending |
| 6 | Polish + Documentation | 9 | ⏳ Pending |
| **Total** | | **107 hours** | |

**Parallel Work:** ~15 hours (404, About, Help content) can be done during Weeks 1-3

---

**This is the roadmap. Ready to execute! 🚀**
