# Memory Tool Documentation

## Overview

The Memory Tool enables Claude to store and retrieve information across conversations through a persistent file-based memory system. This allows agents to build knowledge over time, maintain project context, and learn from past interactions without keeping everything in the context window.

## Features

- **Persistent Storage**: Memory files persist between sessions in `.memories/` directory
- **Cross-Conversation Learning**: Claude can reference past conversations and decisions
- **6 Memory Commands**: view, create, str_replace, insert, delete, rename
- **Path Traversal Protection**: Secure validation prevents directory traversal attacks
- **Automatic Memory Checks**: Claude automatically checks memory before starting tasks

## Architecture

### Components

1. **Memory Tool Handler** (`src/memory-tool.js`)
   - Implements all 6 memory commands
   - Provides secure path validation
   - Manages filesystem operations in `.memories/` directory

2. **Agent SDK Configuration** (`config/agent-sdk-config.js`)
   - Adds 'Memory' to available tools
   - Enables `context-management-2025-06-27` beta header
   - Configures memory base directory

3. **Memory Directory** (`.memories/`)
   - Stores all memory files
   - Organized by agent and purpose
   - Excluded from git via `.gitignore`

## Memory Commands

### view
View directory contents or file contents with optional line ranges:
```json
{
  "command": "view",
  "path": "/memories/projects/",
  "view_range": [1, 10]  // Optional
}
```

### create
Create or overwrite a file:
```json
{
  "command": "create",
  "path": "/memories/notes.txt",
  "file_text": "Meeting notes from today..."
}
```

### str_replace
Replace exact text in a file:
```json
{
  "command": "str_replace",
  "path": "/memories/config.txt",
  "old_str": "status: draft",
  "new_str": "status: final"
}
```

### insert
Insert text at a specific line:
```json
{
  "command": "insert",
  "path": "/memories/todo.txt",
  "insert_line": 2,
  "insert_text": "- New task here"
}
```

### delete
Delete a file or directory:
```json
{
  "command": "delete",
  "path": "/memories/old_file.txt"
}
```

### rename
Rename or move a file/directory:
```json
{
  "command": "rename",
  "old_path": "/memories/draft.txt",
  "new_path": "/memories/final.txt"
}
```

## Security

### Path Traversal Protection

The memory tool implements multiple layers of security:

1. **Path Prefix Validation**: All paths must start with `/memories`
2. **Canonical Path Resolution**: Paths are resolved and verified to stay within memory directory
3. **Traversal Sequence Detection**: Blocks `../`, `..\\`, and URL-encoded sequences
4. **Absolute Path Enforcement**: Uses Node.js `path.resolve()` to detect traversal

Example blocked paths:
- `/memories/../../../etc/passwd` ❌
- `/etc/passwd` ❌
- `/memories/..%2f..%2fetc/passwd` ❌

## Integration with Agent SDK

### Configuration

The memory tool is configured in `config/agent-sdk-config.js`:

```javascript
{
  tools: {
    default: ['Read', 'Write', '...', 'Memory'],
    'grant-card-generator': ['...', 'Memory'],
    'etg-writer': ['...', 'Memory'],
    // ... other agents
  },

  memory: {
    enabled: true,
    baseDir: '.memories',
  },

  betaHeaders: ['context-management-2025-06-27'],
}
```

### Usage in Agent Handler

The memory tool works automatically when included in the `allowedTools` array. The Agent SDK handles:
- Tool call routing
- Memory command execution
- Result formatting
- Error handling

Claude will automatically:
1. Check memory directory before starting tasks
2. Create/update memory files as it works
3. Reference past memories in future conversations

## Best Practices

### Memory Organization

Organize memory files by purpose:
```
.memories/
├── projects/
│   ├── grant-xyz/
│   │   ├── requirements.md
│   │   ├── progress.md
│   │   └── decisions.md
│   └── application-abc/
│       └── notes.md
├── knowledge/
│   ├── grant-criteria.md
│   ├── common-errors.md
│   └── best-practices.md
└── preferences/
    └── user-preferences.md
```

### Prompting Guidance

You can guide what Claude writes to memory:

```
"Only write down information relevant to grant applications in your memory system."
```

Or prevent memory clutter:

```
"When editing your memory folder, keep content up-to-date and organized.
Delete files that are no longer relevant."
```

### Memory Expiration

Consider implementing periodic cleanup:
- Delete memories not accessed in 30+ days
- Archive completed project memories
- Clear temporary working files

## Testing

Run the comprehensive test suite:

```bash
node test-memory-tool.js
```

Tests cover:
- All 6 memory commands
- Path traversal protection
- Error handling
- Nested directories
- File operations

## Use Cases

### 1. Project Context Maintenance
Store project requirements, decisions, and progress across multiple agent sessions.

### 2. Learning from Feedback
Record user feedback and preferences to improve future responses.

### 3. Knowledge Base Building
Build up specialized knowledge over time (grant criteria, common patterns, etc.).

### 4. Cross-Conversation Continuity
Pick up where previous conversations left off without losing context.

### 5. Workflow State Management
Track multi-step workflow progress even when context is cleared.

## Supported Models

The memory tool is available on:
- Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Claude Opus 4.1 (`claude-opus-4-1-20250805`)
- Claude Opus 4 (`claude-opus-4-20250514`)

## Context Editing Integration

The memory tool works seamlessly with context editing:

- When approaching context limits, Claude receives a warning
- Claude automatically saves important information to memory
- Tool results can be cleared while preserving memory files
- Memory becomes an extension of working context

## Troubleshooting

### Memory files not persisting
- Check that `.memories/` directory has write permissions
- Verify `memory.enabled: true` in config
- Ensure beta header `context-management-2025-06-27` is set

### Path errors
- All memory paths must start with `/memories`
- Use forward slashes even on Windows
- Avoid special characters in filenames

### Performance issues
- Limit memory file sizes (consider pagination for large files)
- Periodically clean up unused files
- Use subdirectories to organize memories

## API Reference

See `src/memory-tool.js` for complete API documentation:

- `viewMemory(path, viewRange)`
- `createMemory(path, fileText)`
- `strReplaceMemory(path, oldStr, newStr)`
- `insertMemory(path, insertLine, insertText)`
- `deleteMemory(path)`
- `renameMemory(oldPath, newPath)`
- `executeMemoryCommand(toolInput)`
- `validateMemoryPath(memoryPath)` - Internal security function

## Future Enhancements

Potential improvements:
- Database-backed memory store (PostgreSQL, Redis)
- Cloud storage integration (S3, Google Drive)
- Encrypted memory files for sensitive data
- Memory search and indexing
- Automatic memory summarization
- Memory versioning/history
