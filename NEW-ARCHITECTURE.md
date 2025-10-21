# New Architecture: Railway + Claude API + Custom Tools

## Overview
Direct Claude API integration on Railway with full custom tool suite, HubSpot integration, and persistent conversation history.

## Architecture Stack

### Backend
- **Platform**: Railway (serverful Node.js app)
- **Framework**: Express.js
- **AI**: Claude API (direct, no SDK wrapper)
- **Database**: Postgres (conversation history, patterns, user data)
- **Integrations**: HubSpot API

### Tool System
Custom implementation of Claude Code tools using Claude's function calling:
- **Read**: Read files from filesystem or uploaded documents
- **Write**: Create new files
- **Edit**: Modify existing files with string replacement
- **Bash**: Execute shell commands safely
- **Glob**: Find files by pattern
- **Grep**: Search content in files
- **WebSearch**: Search the web (via API)
- **WebFetch**: Fetch and parse URLs
- **TodoWrite**: Manage task lists in conversation context
- **HubSpot**: Query HubSpot CRM data (custom)

### Agent System
- Agent definitions from `.claude/agents/*.md` files
- Each agent has specialized prompt + allowed tools
- Agents share the same tool system (evergreen)
- Tools can be added globally or per-agent

## Key Benefits

1. **Evergreen Tools**: Add once, available to all agents (unless restricted)
2. **Conversation Patterns**: Full history in Postgres enables pattern analysis
3. **HubSpot Integration**: Live CRM data for context-aware responses
4. **No SDK Limitations**: Full control over tool execution and streaming
5. **Railway Native**: Persistent server, easy deployment, Postgres included

## Directory Structure

```
/
├── server.js                      # Main Express server (Railway entrypoint)
├── config/
│   ├── claude-config.js          # Claude API configuration
│   ├── hubspot-config.js         # HubSpot API configuration
│   └── tools-config.js           # Tool definitions and permissions
├── src/
│   ├── agents/
│   │   └── load-agents.js        # Load agent definitions from .claude/agents/
│   ├── tools/
│   │   ├── index.js              # Tool registry and executor
│   │   ├── read.js               # Read file tool
│   │   ├── write.js              # Write file tool
│   │   ├── edit.js               # Edit file tool
│   │   ├── bash.js               # Bash execution tool
│   │   ├── glob.js               # File pattern matching
│   │   ├── grep.js               # Content search tool
│   │   ├── web-search.js         # Web search tool
│   │   ├── web-fetch.js          # URL fetching tool
│   │   ├── todo-write.js         # Task management tool
│   │   └── hubspot.js            # HubSpot CRM tool
│   ├── claude-client.js          # Claude API client with streaming
│   ├── conversation-service.js   # Conversation history management
│   └── database-service.js       # Postgres database operations
├── .claude/
│   └── agents/                   # Agent prompt definitions (unchanged)
└── package.json
```

## Implementation Plan

### Phase 1: Core Tool System (Priority 1)
1. Create tool registry with schema definitions for Claude function calling
2. Implement each tool with proper execution and error handling
3. Create tool executor that handles Claude's function calling protocol
4. Add tool permission system per agent

### Phase 2: HubSpot Integration (Priority 2)
1. Set up HubSpot API client
2. Implement HubSpot tool with operations:
   - Search contacts
   - Get deal details
   - Get company information
   - Get recent activities
3. Add to tool registry

### Phase 3: Railway Server Setup (Priority 3)
1. Create Express server with SSE streaming
2. Set up API endpoints:
   - POST /api/chat - Main conversation endpoint
   - GET /api/conversations - List user conversations
   - GET /api/conversations/:id - Get conversation history
   - POST /api/conversations/:id/analyze - Analyze conversation patterns
4. Configure Railway deployment

### Phase 4: Enhanced Conversation History (Priority 4)
1. Add conversation pattern analysis queries
2. Implement conversation summarization
3. Add conversation search across agent history
4. Create pattern detection (common questions, success patterns, etc.)

### Phase 5: Testing & Migration (Priority 5)
1. Test each tool individually
2. Test all 4 agents with new system
3. Verify HubSpot integration
4. Load test conversation history performance
5. Deploy to Railway production

## Tool Schema Example

Each tool is defined with Claude function calling schema:

```javascript
{
  name: "read_file",
  description: "Read contents of a file from the filesystem or uploaded documents",
  input_schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to read"
      },
      offset: {
        type: "number",
        description: "Optional line number to start reading from"
      },
      limit: {
        type: "number",
        description: "Optional number of lines to read"
      }
    },
    required: ["file_path"]
  }
}
```

## Agent Integration

Agents remain defined in `.claude/agents/*.md` but tools are passed via Claude API:

```javascript
const response = await claude.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  system: agentPrompt,  // From .claude/agents/grant-card-generator.md
  messages: conversationHistory,
  tools: allowedTools,   // Filtered based on agent's tool list
  stream: true
});
```

## Next Steps

1. Create tool system foundation
2. Implement each tool
3. Add HubSpot integration
4. Set up Railway Express server
5. Test and deploy
