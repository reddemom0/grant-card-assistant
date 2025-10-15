# Memory Tool - Implementation TODO

**Status**: ⏸️ **DISABLED** - Pending serverful platform migration
**Date**: October 15, 2025

---

## Why Disabled

The memory tool requires persistent client-side storage (filesystem, database, or Redis), which doesn't work in the current serverless environment (Railway/Vercel with read-only filesystem).

**Errors encountered**:
```
ENOENT: no such file or directory, mkdir '/var/task/memories'
```

**Decision**: Wait for migration to serverful platform with backend database before implementing.

---

## What Memory Tool Does

Anthropic's memory tool enables Claude to:
- Store and retrieve information across conversations
- Learn from user corrections and feedback
- Track multi-day projects
- Build knowledge bases over time
- Remember user preferences

**Key point**: This is a **client-side tool** - your application executes the storage operations, not Anthropic.

---

## Implementation Checklist (When Ready)

### 1. Choose Storage Backend

**Recommended: PostgreSQL or Redis** (not filesystem in serverless)

**Schema example (PostgreSQL)**:
```sql
CREATE TABLE agent_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_type TEXT NOT NULL,
    path TEXT NOT NULL,  -- e.g., "/memories/user_feedback/corrections.xml"
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, agent_type, path)
);

CREATE INDEX idx_memories_user_agent ON agent_memories(user_id, agent_type);
```

**Alternative: Redis**:
```javascript
// Key pattern: memory:{userId}:{agentType}:{path}
await redis.set(`memory:${userId}:${agentType}:/memories/corrections.xml`, content);
```

### 2. Update Memory Tool Handler

**File**: `api/memory-tool-handler.js`

Replace filesystem operations with database operations:

```javascript
// BEFORE (filesystem - doesn't work in serverless)
await fs.writeFile(filePath, content, 'utf-8');

// AFTER (PostgreSQL)
await pool.query(
  'INSERT INTO agent_memories (user_id, agent_type, path, content) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, agent_type, path) DO UPDATE SET content = $4, updated_at = NOW()',
  [userId, agentType, path, content]
);

// AFTER (Redis)
await redis.set(`memory:${userId}:${agentType}:${path}`, content);
```

### 3. Enable Memory Tool in API

**File**: `api/server.js`

**Step 1**: Define memory tool (around line 3887):
```javascript
const MEMORY_TOOL = {
  type: "memory_20250818",
  name: "memory"
};
```

**Step 2**: Add to tools arrays:
```javascript
// Non-streaming (line 3974)
tools: [WEB_SEARCH_TOOL, MEMORY_TOOL]

// Streaming (line 4221)
tools: [webSearchTool, MEMORY_TOOL]
```

**Step 3**: Re-enable instructions (line 1225):
```javascript
// Uncomment and restore MEMORY_TOOL_INSTRUCTIONS
const MEMORY_TOOL_INSTRUCTIONS = `
<memory>
You have access to a memory tool for persistent knowledge across conversations.
...
</memory>
`;
```

### 4. Handle Memory Tool Use

**Non-streaming API** (line 4105):
```javascript
// Check for memory tool usage
const memoryToolResults = await processMemoryToolUse(data.content || [], userId, agentType);

if (memoryToolResults && memoryToolResults.length > 0) {
  // Add tool results and continue conversation
  messages.push({ role: 'assistant', content: data.content });
  messages.push({ role: 'user', content: memoryToolResults });
  return await callClaudeAPI(messages, systemPrompt, files);
}
```

**Streaming API** (after line 4594):
```javascript
// After stream completes, check for memory tool use
const hasMemoryToolUse = fullContentBlocks.some(
  block => block.type === 'tool_use' && block.name === 'memory'
);

if (hasMemoryToolUse) {
  // Execute memory operations
  const memoryToolResults = await processMemoryToolUse(fullContentBlocks, userId, agentType);

  // Add to conversation and continue streaming
  conversation.push({ role: 'assistant', content: fullContentBlocks });
  conversation.push({ role: 'user', content: memoryToolResults });

  // Make another streaming call
  await callClaudeAPIStream(conversation, systemPrompt, res, [], agentType);
}
```

### 5. Add User Context

**Important**: Memory operations need `userId` and `agentType` for proper scoping:

```javascript
async function processMemoryToolUse(contentBlocks, userId, agentType) {
  const memoryToolBlocks = contentBlocks.filter(
    block => block.type === 'tool_use' && block.name === 'memory'
  );

  for (const toolBlock of memoryToolBlocks) {
    // Execute with user/agent context
    const result = await handleMemoryTool(
      toolBlock.input?.command,
      toolBlock.input,
      userId,
      agentType
    );

    toolResults.push({
      type: 'tool_result',
      tool_use_id: toolBlock.id,
      content: JSON.stringify(result)
    });
  }

  return toolResults;
}
```

### 6. Update Memory Handler Signature

**File**: `api/memory-tool-handler.js`

```javascript
// Add userId and agentType parameters
async function handleMemoryTool(command, input, userId, agentType) {
  switch (command) {
    case 'view':
      return await handleView(input, userId, agentType);
    case 'create':
      return await handleCreate(input, userId, agentType);
    // ... etc
  }
}
```

### 7. Security Considerations

- ✅ **Path validation**: Ensure all paths start with `/memories`
- ✅ **User isolation**: Memory scoped to userId (don't leak across users)
- ✅ **Agent isolation**: Optionally scope by agentType
- ✅ **Size limits**: Enforce max file size (1MB recommended)
- ✅ **Rate limiting**: Prevent memory spam/abuse

### 8. Testing

**Use existing test suite**:
```bash
node tests/memory-tool-tests.js
```

**Update tests** to use database instead of filesystem:
- Replace filesystem assertions with database queries
- Test user isolation (user A can't access user B's memories)
- Test agent isolation (optional)

---

## Reference Files

### Implementation
- **Handler**: `api/memory-tool-handler.js` (388 lines)
- **Tests**: `tests/memory-tool-tests.js` (27 tests, all passing)
- **Documentation**: `MEMORY-TOOL-IMPLEMENTATION-SUMMARY.md`
- **Final report**: `MEMORY-TOOL-FINAL-REPORT.md`

### Anthropic Documentation
- **Tool docs**: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool
- **Beta header**: `context-management-2025-06-27`
- **Tool type**: `memory_20250818`

---

## When You're Ready

1. ✅ Migrate to serverful platform with backend database
2. ✅ Choose storage backend (PostgreSQL/Redis recommended)
3. ✅ Update `api/memory-tool-handler.js` to use database
4. ✅ Add `userId` and `agentType` to all memory operations
5. ✅ Re-enable memory tool in `api/server.js` (follow checklist above)
6. ✅ Update test suite for database backend
7. ✅ Test with real conversations
8. ✅ Deploy and monitor

---

**Created**: October 15, 2025
**Author**: Claude Code
**Status**: Disabled until serverful migration
