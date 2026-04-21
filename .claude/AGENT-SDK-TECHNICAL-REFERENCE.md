# Agent SDK Technical Reference - Critical Details

**Source:** Official Anthropic Agent SDK Documentation
**Last Updated:** 2025-10-08
**Status:** Ready for implementation

---

## 🚨 CRITICAL REQUIREMENTS - MUST FOLLOW

### 1. settingSources is MANDATORY for CLAUDE.md

```typescript
// ❌ WRONG - CLAUDE.md will NOT load
const result = query({
  prompt: "Generate a grant card",
  options: {
    systemPrompt: { type: 'preset', preset: 'claude_code' }
    // Missing settingSources - CLAUDE.md is ignored!
  }
});

// ✅ CORRECT - CLAUDE.md loads automatically
const result = query({
  prompt: "Generate a grant card",
  options: {
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project']  // REQUIRED TO LOAD .claude/ FILES
  }
});
```

**From official docs:**
> "To load these files, you must explicitly set `settingSources: ['project']` in your options."

**Why:** SDK defaults to NO filesystem settings for isolation. Must explicitly opt-in.

**Available Setting Sources:**
- `'user'` - Global user settings (`~/.claude/settings.json`)
- `'project'` - Project settings (`.claude/settings.json` + `CLAUDE.md`)
- `'local'` - Local settings (`.claude/settings.local.json`, gitignored)

---

### 2. Agent Definition Structure

```typescript
// Complete agent definition interface
interface AgentDefinition {
  description: string;  // REQUIRED - When Claude should use this agent
  prompt: string;       // REQUIRED - Agent's system prompt/knowledge
  tools?: string[];     // OPTIONAL - Allowed tools (inherits all if omitted)
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';  // OPTIONAL
}

// Implementation for Granted AI Hub
const AGENTS = {
  'grant-card': {
    description: 'Grant Card specialist. Creates grant cards from RFP documents. Use when user needs grant eligibility analysis.',
    prompt: fs.readFileSync('./.claude/agents/grant-card.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],  // Read + write, no Bash
    model: 'sonnet'
  },
  'etg': {
    description: 'ETG business case writer. Specializes in BC Employee Training Grant applications.',
    prompt: fs.readFileSync('./.claude/agents/etg-writer.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit'],  // Minimal tools
    model: 'sonnet'
  },
  'bcafe': {
    description: 'BC Agriculture and Food Export program specialist.',
    prompt: fs.readFileSync('./.claude/agents/bcafe-writer.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit'],
    model: 'sonnet'
  },
  'canexport': {
    description: 'CanExport SME claims auditor. Analyzes and validates export claims.',
    prompt: fs.readFileSync('./.claude/agents/canexport-claims.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit', 'Grep'],  // Add Grep for analysis
    model: 'sonnet'
  }
};
```

**Key Points:**
- Agent names in `agents` object override filesystem-based agents
- Description guides when Claude should invoke the agent (CRITICAL for routing)
- Tools array restricts agent capabilities (security + safety)
- Model can be overridden per-agent (opus for complex, sonnet for most)

---

### 3. System Prompt Strategy for Granted AI Hub

**RECOMMENDED: Empty/Default (Option A)**
```typescript
options: {
  // No systemPrompt specified - uses empty default
  settingSources: ['project'],  // Loads CLAUDE.md and all agent .md files
  agents: AGENTS
}
```

**Why this approach:**
- ✅ Maximum flexibility
- ✅ All instructions from `.claude/` knowledge base
- ✅ No Claude Code CLI-specific instructions (not needed for web app)
- ✅ Agents fully defined by their `.md` files

**Alternative: Claude Code Preset + Append (Option B)**
```typescript
options: {
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    append: 'Additional web-specific instructions'
  },
  settingSources: ['project'],
  agents: AGENTS
}
```
- ✅ Gets tool instructions and safety guidelines
- ⚠️ Includes CLI-specific behavior (may not be relevant)

**Recommendation:** Start with Option A (empty/default)

---

## 📁 Required File Structure for Granted AI Hub

```
grant-card-assistant/
├── .claude/                           # Agent SDK configuration
│   ├── CLAUDE.md                      # SHARED knowledge (ALL agents see)
│   │                                  # - Company info
│   │                                  # - Universal writing guidelines
│   │                                  # - Shared best practices
│   │
│   ├── agents/                        # ISOLATED knowledge (per-agent)
│   │   ├── grant-card.md             # Grant Card ONLY
│   │   │                             # - 6 workflows
│   │   │                             # - Grant card examples
│   │   │                             # - Templates
│   │   │
│   │   ├── etg-writer.md             # ETG ONLY
│   │   │                             # - ETG workflows
│   │   │                             # - Business case examples
│   │   │
│   │   ├── bcafe-writer.md           # BCAFE ONLY
│   │   │                             # - BCAFE workflows
│   │   │
│   │   └── canexport-claims.md       # CanExport ONLY
│   │                                 # - Claims auditing workflows
│   │
│   └── settings.json                  # OPTIONAL: Permission rules, hooks
│
├── api/
│   └── index.js                       # NEW - Agent SDK implementation
│
├── vercel.json
└── package.json
```

### Knowledge Isolation - CRITICAL:
- ✅ `CLAUDE.md` → Shared across ALL agents
- ✅ `agents/grant-card.md` → ONLY Grant Card agent sees
- ✅ `agents/etg-writer.md` → ONLY ETG agent sees
- ❌ Grant Card agent NEVER sees ETG knowledge
- ❌ ETG agent NEVER sees Grant Card knowledge

**This prevents knowledge contamination and keeps agents focused.**

---

## 💻 Complete Implementation for Granted AI Hub

### api/index.js (New Agent SDK Implementation)

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import express from 'express';
import fs from 'fs';

const app = express();
app.use(express.json());

// Define all agents
const AGENTS = {
  'grant-card': {
    description: 'Grant Card specialist. Creates grant cards from RFP documents. Use when user needs grant eligibility analysis.',
    prompt: fs.readFileSync('./.claude/agents/grant-card.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    model: 'sonnet'
  },
  'etg': {
    description: 'ETG business case writer. Specializes in BC Employee Training Grant applications.',
    prompt: fs.readFileSync('./.claude/agents/etg-writer.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit'],
    model: 'sonnet'
  },
  'bcafe': {
    description: 'BC Agriculture and Food Export program specialist.',
    prompt: fs.readFileSync('./.claude/agents/bcafe-writer.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit'],
    model: 'sonnet'
  },
  'canexport': {
    description: 'CanExport SME claims auditor. Analyzes and validates export claims.',
    prompt: fs.readFileSync('./.claude/agents/canexport-claims.md', 'utf8'),
    tools: ['Read', 'Write', 'Edit', 'Grep'],
    model: 'sonnet'
  }
};

// Unified API endpoint with agent routing
app.post('/api/chat', async (req, res) => {
  try {
    const { agentType, message, sessionId, conversationId } = req.body;

    // Validate agent type
    if (!AGENTS[agentType]) {
      return res.status(400).json({
        success: false,
        error: `Unknown agent type: ${agentType}. Available: ${Object.keys(AGENTS).join(', ')}`
      });
    }

    console.log(`🔵 Agent SDK Query: ${agentType}, Session: ${sessionId || 'new'}`);

    // Create query with Agent SDK
    const result = query({
      prompt: message,
      options: {
        agents: AGENTS,                          // All agent definitions
        settingSources: ['project'],             // REQUIRED: Load CLAUDE.md + agent .md files
        model: 'claude-sonnet-4-6',    // Default model (Sonnet 4.6)
        allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],  // Global tool allowlist
        resume: sessionId,                       // Continue existing session (if provided)
        permissionMode: 'acceptEdits',          // Auto-accept file edits (for web app)
        maxTurns: 10,                           // Prevent infinite loops

        // Custom permission handler (block dangerous operations)
        canUseTool: async (toolName, input) => {
          // Block Bash commands in production
          if (toolName === 'Bash') {
            console.warn('⚠️  Bash command blocked:', input.command);
            return {
              behavior: 'deny',
              message: 'Bash commands are not allowed in production environment'
            };
          }

          // Allow all other tools
          return {
            behavior: 'allow',
            updatedInput: input
          };
        }
      }
    });

    // Variables to capture from stream
    let capturedSessionId = sessionId;  // May be updated if new session
    let assistantResponse = '';
    let usage = null;
    let cost = null;

    // Process streaming messages
    for await (const msg of result) {
      // System initialization - capture new session ID
      if (msg.type === 'system' && msg.subtype === 'init') {
        capturedSessionId = msg.session_id;
        console.log('✅ Session initialized:', capturedSessionId);
        console.log('   Model:', msg.model);
        console.log('   Tools:', msg.tools.length);
      }

      // Assistant message - accumulate response
      if (msg.type === 'assistant') {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          content.forEach(block => {
            if (block.type === 'text') {
              assistantResponse += block.text;
            }
          });
        } else if (typeof content === 'string') {
          assistantResponse += content;
        }
      }

      // Tool use - log for debugging
      if (msg.type === 'tool_use') {
        console.log('🔧 Tool used:', msg.tool_name);
      }

      // Final result
      if (msg.type === 'result') {
        usage = msg.usage;
        cost = msg.total_cost_usd;

        console.log('✅ Query complete');
        console.log('   Duration:', msg.duration_ms, 'ms');
        console.log('   Cost: $', cost);
        console.log('   Tokens:', usage.input_tokens + usage.output_tokens);

        // Return response to client
        return res.json({
          success: true,
          response: assistantResponse,
          result: msg.result,
          sessionId: capturedSessionId,
          conversationId: conversationId,  // Pass through for frontend
          agentType,
          usage,
          cost,
          duration_ms: msg.duration_ms
        });
      }

      // Error result
      if (msg.type === 'result' && msg.subtype.startsWith('error')) {
        console.error('❌ Query error:', msg.subtype);
        return res.status(500).json({
          success: false,
          error: msg.subtype,
          sessionId: capturedSessionId
        });
      }
    }

  } catch (error) {
    console.error('❌ Agent SDK error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'agent-sdk',
    agents: Object.keys(AGENTS),
    timestamp: new Date().toISOString()
  });
});

// For local development
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Agent SDK server running on port ${PORT}`);
    console.log(`📁 Agents loaded: ${Object.keys(AGENTS).join(', ')}`);
  });
}

// For Vercel serverless
export default app;
```

---

## 🔄 Session Management

### How Sessions Work
```typescript
// 1. First request - no sessionId provided
// SDK creates new session, returns session_id in 'system' message

// 2. Subsequent requests - provide sessionId
// SDK continues conversation with full context

// 3. Frontend responsibility:
// - Capture session_id from first response
// - Include it in all subsequent requests
// - Store in conversation metadata (PostgreSQL)
```

### Session Strategies

| Use Case | Strategy |
|----------|----------|
| **Continue conversation** | `resume: sessionId, forkSession: false` |
| **Explore alternatives** | `resume: sessionId, forkSession: true` (creates branch) |
| **Fresh start** | Don't provide `resume` option |

### Implementation in Frontend

```javascript
// Frontend (etg-agent.html, grant-cards.html, etc.)
let agentSessionId = null;  // SDK session ID

async function sendMessage(message) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      agentType: 'etg',  // or 'grant-card', 'bcafe', 'canexport'
      message,
      sessionId: agentSessionId,           // Agent SDK session
      conversationId: currentConversationId // PostgreSQL conversation ID
    })
  });

  const data = await response.json();

  // Capture Agent SDK session ID for next request
  if (data.sessionId) {
    agentSessionId = data.sessionId;
  }

  return data;
}
```

---

## 🔒 Permission Management for Granted AI Hub

### Recommended Permission Mode

```typescript
options: {
  permissionMode: 'acceptEdits',  // Auto-accept file edits only

  // Block dangerous operations
  canUseTool: async (toolName, input) => {
    // Block all Bash commands in production
    if (toolName === 'Bash') {
      return {
        behavior: 'deny',
        message: 'Bash commands not allowed'
      };
    }

    // Allow all other tools
    return {
      behavior: 'allow',
      updatedInput: input
    };
  }
}
```

### Permission Modes Explained

| Mode | Use Case | Risk |
|------|----------|------|
| `'default'` | Standard permission checks | Medium |
| `'acceptEdits'` | Auto-accept file edits only | Low |
| `'bypassPermissions'` | Auto-accept ALL operations | High ⚠️ |

**Recommendation:** Use `'acceptEdits'` + custom `canUseTool` handler

---

## 🛠️ Tool Restrictions for Security

### Granted AI Hub Tool Strategy

```typescript
// Global allowlist (applied to all agents unless overridden)
allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob']

// Per-agent restrictions (more specific)
agents: {
  'grant-card': {
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob']  // Full access
  },
  'etg': {
    tools: ['Read', 'Write', 'Edit']  // No search tools
  },
  'read-only-analyst': {
    tools: ['Read', 'Grep', 'Glob']  // Read-only
  }
}
```

### Available Built-in Tools

**File Operations:**
- `Read` - Read files (text, PDF, images, notebooks)
- `Write` - Write/create files
- `Edit` - Exact string replacement
- `Grep` - Search with regex
- `Glob` - Pattern matching

**Execution:**
- `Bash` - Run shell commands (⚠️ DANGEROUS - block in production)

**Web:**
- `WebSearch` - Search the web
- `WebFetch` - Fetch and process URLs

**Agent:**
- `Task` - Launch subagents

**Other:**
- `TodoWrite` - Task list management

---

## ⚠️ Common Pitfalls & Solutions

### Pitfall #1: CLAUDE.md Not Loading

```typescript
// ❌ WRONG - CLAUDE.md will NOT load
const result = query({
  prompt: "Hello",
  options: {
    agents: AGENTS
    // Missing settingSources!
  }
});

// ✅ CORRECT
const result = query({
  prompt: "Hello",
  options: {
    agents: AGENTS,
    settingSources: ['project']  // REQUIRED
  }
});
```

### Pitfall #2: Agent Knowledge Leaking

```typescript
// ❌ WRONG - All knowledge in CLAUDE.md
// .claude/CLAUDE.md:
// - Grant Card workflows
// - ETG workflows
// - BCAFE workflows
// Result: Every agent sees everything! Confusion!

// ✅ CORRECT - Separate files
// .claude/CLAUDE.md: Only shared knowledge (company info, guidelines)
// .claude/agents/grant-card.md: Grant Card workflows ONLY
// .claude/agents/etg-writer.md: ETG workflows ONLY
```

### Pitfall #3: Tool Security Bypass

```typescript
// ❌ DANGEROUS - Agent has ALL tools
agents: {
  'research-agent': {
    description: 'Research documents',
    prompt: 'You research...'
    // No tools specified - inherits ALL tools including Bash!
  }
}

// ✅ SAFE - Restricted tools
agents: {
  'research-agent': {
    description: 'Research documents',
    prompt: 'You research...',
    tools: ['Read', 'Grep', 'Glob']  // Read-only
  }
}
```

### Pitfall #4: Session Management Forgotten

```typescript
// ❌ WRONG - Losing context every request
app.post('/api/chat', async (req, res) => {
  const result = query({ prompt: req.body.message });
  // Session ID never captured or returned!
  // Every request is a fresh conversation!
});

// ✅ CORRECT - Track sessions
app.post('/api/chat', async (req, res) => {
  const result = query({
    prompt: req.body.message,
    options: {
      resume: req.body.sessionId  // Continue previous session
    }
  });

  for await (const msg of result) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      // Capture and return session ID to client
      sessionId = msg.session_id;
    }
  }

  res.json({ sessionId, response });
});
```

---

## 🚀 Vercel Deployment Checklist

### Pre-Deployment
- [ ] `.claude/` folder committed to Git (REQUIRED)
- [ ] All agent `.md` files exist and populated
- [ ] `CLAUDE.md` contains shared knowledge only
- [ ] `package.json` includes `@anthropic-ai/claude-agent-sdk`
- [ ] Environment variables set in Vercel dashboard:
  - `ANTHROPIC_API_KEY`
  - `JWT_SECRET`
  - `NODE_ENV=production`

### Vercel Configuration

**vercel.json:**
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/chat",
      "dest": "/api/index.js"
    },
    {
      "src": "/api/health",
      "dest": "/api/index.js"
    }
  ]
}
```

### Post-Deployment Testing
- [ ] `/api/health` returns 200 OK
- [ ] Test each agent individually
- [ ] Verify `.claude/` files accessible (check logs)
- [ ] Confirm CLAUDE.md loading (check response quality)
- [ ] Test session continuity (multiple messages)
- [ ] Monitor cold start performance (< 3s acceptable)
- [ ] Check API costs (should be ~50% lower with prompt caching)

### Monitoring
```bash
# Vercel logs
vercel logs [deployment-url] --follow

# Look for:
# ✅ "Session initialized"
# ✅ "Agents loaded: grant-card, etg, bcafe, canexport"
# ✅ "Query complete"
# ❌ "CLAUDE.md not found" (means settingSources not set)
# ❌ "Agent SDK error"
```

---

## 📊 Expected Benefits After Migration

### Performance
- ⚡ **50-80% faster** (no Google Drive API calls)
- ⚡ **Instant knowledge access** (.claude/ files in deployment)
- ⚡ **Consistent response times** (no external API variability)

### Cost
- 💰 **50-75% cheaper** (prompt caching automatically enabled)
- 💰 **Zero Google Drive API costs**
- 💰 **Predictable costs** (no quota overages)

### Reliability
- 🛡️ **No external API dependencies** for knowledge
- 🛡️ **Version controlled knowledge** (Git history)
- 🛡️ **Instant rollback** (Git branches)

### Developer Experience
- 👨‍💻 **90% less code** (300+ lines → 50-75 lines)
- 👨‍💻 **Easier to add agents** (just create .md file)
- 👨‍💻 **Better debugging** (all knowledge searchable in repo)

---

## 🎯 Implementation Checklist for Day 1

### Morning (3 hours)
- [ ] Create `agent-sdk-migration` branch
- [ ] Install Agent SDK: `npm install @anthropic-ai/claude-agent-sdk`
- [ ] Create `.claude/` structure:
  ```bash
  mkdir -p .claude/agents
  touch .claude/CLAUDE.md
  touch .claude/agents/grant-card.md
  ```
- [ ] Test minimal example locally

### Afternoon (3 hours)
- [ ] Export Grant Card knowledge from Google Drive
- [ ] Consolidate into `.claude/agents/grant-card.md`
- [ ] Create shared knowledge in `.claude/CLAUDE.md`
- [ ] Commit to Git
- [ ] Create `api/index.js` with Grant Card agent only
- [ ] Test locally with real documents

---

## 🔗 Quick Reference Links

- **Agent SDK Docs:** https://docs.anthropic.com/api/agent-sdk/overview
- **TypeScript Reference:** https://docs.anthropic.com/api/agent-sdk/typescript
- **System Prompts:** https://docs.anthropic.com/api/agent-sdk/modifying-system-prompts
- **Session Management:** https://docs.anthropic.com/api/agent-sdk/session-management
- **Permissions:** https://docs.anthropic.com/api/agent-sdk/handling-permissions

---

## 💡 Key Takeaways

1. **`settingSources: ['project']` is MANDATORY** to load `.claude/` files
2. **Agent definitions** require `description` + `prompt` at minimum
3. **Knowledge isolation** via separate agent `.md` files is critical
4. **Session management** must capture and resume `session_id`
5. **Tool restrictions** prevent security issues
6. **Permission mode** should be `'acceptEdits'` + custom handler
7. **Empty system prompt** recommended (let knowledge base drive behavior)
8. **Commit `.claude/` to Git** - required for Vercel deployment

---

**This document is your technical implementation guide. Refer to it when coding. Good luck! 🚀**
