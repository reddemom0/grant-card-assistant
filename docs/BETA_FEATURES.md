# Agent SDK Beta Features

This document covers the beta features enabled in the Agent SDK for enhanced performance and functionality.

## Overview

Three beta features are enabled by default:

1. **Memory Tool** (`context-management-2025-06-27`) - Cross-conversation memory persistence
2. **Token-Efficient Tool Use** (`token-efficient-tools-2025-02-19`) - 14% avg output token reduction
3. **Fine-Grained Tool Streaming** (`fine-grained-tool-streaming-2025-05-14`) - Reduced latency for tool parameters

## 1. Token-Efficient Tool Use

### Description
Reduces output tokens when calling tools, saving an average of 14% (up to 70%) in output tokens and improving latency.

### Key Benefits
- **14% average token reduction** across all tool use responses
- **Up to 70% reduction** for specific response patterns
- **Lower latency** due to fewer tokens generated
- **Automatic cost savings** without code changes

### Model Support
- **Claude Sonnet 3.7**: Requires beta header
- **Claude 4 models** (Opus 4.1, Opus 4, Sonnet 4.5, Sonnet 4, Haiku 4.5): Built-in support (header optional)

### Configuration
```javascript
// config/agent-sdk-config.js
{
  betaHeaders: [
    'token-efficient-tools-2025-02-19'  // Token-efficient tools
  ],

  tokenEfficiency: {
    enabled: true,
    averageSavings: 0.14,  // 14% average
    maxSavings: 0.70,      // Up to 70%
  }
}
```

### Important Notes

**Prompt Caching Compatibility**
- Use the beta header consistently for requests you want to cache
- Inconsistent use will cause prompt caching to fail
- All agents use the beta header by default for maximum efficiency

**Limitations**
- Does NOT work with `disable_parallel_tool_use: true`
- All parallel tool use must remain enabled for token efficiency

### Example Savings

**Without Token-Efficient Tools:**
```json
{
  "input_tokens": 1524,
  "output_tokens": 127,  // Full tool use response
  "total_cost": "$0.0062"
}
```

**With Token-Efficient Tools:**
```json
{
  "input_tokens": 1524,
  "output_tokens": 89,   // 30% reduction in this case
  "total_cost": "$0.0051"  // 18% cost reduction
}
```

### Testing Token Efficiency

Compare requests with and without the beta header:

```bash
# With token efficiency (default)
curl -X POST $BASE_URL/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "grant-card-generator",
    "conversationId": "test-123",
    "userId": "user-123",
    "message": "Analyze this grant criteria..."
  }' | jq '.usage.output_tokens'

# Result: Typically 10-15% fewer output tokens
```

## 2. Fine-Grained Tool Streaming

### Description
Streams tool use parameters without buffering or JSON validation, significantly reducing latency for large parameter values.

### Key Benefits
- **Reduced latency** - Parameters stream immediately without buffering
- **Faster user feedback** - See tool calls as they happen
- **Better UX** - No waiting for JSON validation
- **Handles large parameters** - Streams long text, arrays, etc.

### Model Support
All Claude models support fine-grained tool streaming with the beta header.

### Configuration
```javascript
// config/agent-sdk-config.js
{
  betaHeaders: [
    'fine-grained-tool-streaming-2025-05-14'  // Fine-grained streaming
  ],

  fineGrainedStreaming: {
    enabled: true,
    handleInvalidJSON: true,  // Wrap invalid JSON in error responses
  }
}
```

### How It Works

**Traditional Streaming (buffered):**
- Waits for entire parameter to validate JSON
- 10-15 second delay before first chunk
- Many small chunks with word breaks

```
[15s delay]
Chunk 1: '{"'
Chunk 2: 'query": "Ty'
Chunk 3: 'peScri'
Chunk 4: 'pt features'
...
```

**Fine-Grained Streaming (immediate):**
- Streams parameters as they're generated
- 2-3 second delay before first chunk
- Larger chunks with fewer breaks

```
[3s delay]
Chunk 1: '{"query": "TypeScript 5.0 5.1 5.2'
Chunk 2: ' new features comparison'
...
```

### Streaming Events

The Agent SDK handler processes streaming events:

```javascript
// Stream event types in agent-sdk-handler.js
for await (const msg of result) {
  if (msg.type === 'stream_event') {
    if (msg.event.type === 'content_block_start' &&
        msg.event.content_block?.type === 'tool_use') {
      // Tool use started - stream to client immediately
      const toolName = msg.event.content_block.name;
      console.log(`🔧 Using tool: ${toolName}`);

      res.write(`data: ${JSON.stringify({
        type: 'tool_use',
        tool: toolName
      })}\n\n`);
    }
  }
}
```

### Handling Invalid JSON

**Warning:** Fine-grained streaming may produce invalid JSON if `max_tokens` is reached mid-parameter.

When this occurs, wrap the invalid JSON for error handling:

```javascript
// Invalid JSON received
const invalidJSON = '{"query": "incomplete string...'

// Wrap for error response
const errorResponse = {
  "INVALID_JSON": invalidJSON
}

// Return to model
{
  "type": "tool_result",
  "tool_use_id": "toolu_xyz",
  "content": JSON.stringify(errorResponse),
  "is_error": true
}
```

**Handling in Agent SDK:**

The SDK automatically handles `max_tokens` stop reason:

```javascript
if (msg.type === 'result' && msg.stop_reason === 'max_tokens') {
  // Check if last content block is incomplete tool_use
  const lastBlock = msg.content[msg.content.length - 1];

  if (lastBlock.type === 'tool_use') {
    // Tool use truncated - retry with higher max_tokens
    console.warn('⚠️ Tool use truncated, retrying with higher max_tokens');
    // SDK handles retry automatically
  }
}
```

### Use Cases

1. **Large Code Generation**
   - Stream code into file creation tools
   - See code as it's generated (no buffering)
   - Faster feedback for long files

2. **Batch Data Processing**
   - Stream arrays of items as they're created
   - Process items immediately (no waiting for complete array)
   - Better UX for bulk operations

3. **Long-Form Content**
   - Stream essays, reports, documentation
   - Display content as it's written
   - Improved perceived performance

### Example: Streaming File Creation

```javascript
// Tool definition
{
  "name": "create_file",
  "input_schema": {
    "type": "object",
    "properties": {
      "filename": { "type": "string" },
      "lines": {
        "type": "array",
        "description": "Lines of text to write"
      }
    }
  }
}

// Without fine-grained streaming:
// [15s delay] Then entire array appears at once

// With fine-grained streaming:
// [3s delay] Lines stream as they're generated:
// Chunk 1: '{"filename": "code.js", "lines": ["import React'
// Chunk 2: ' from '\''react'\'';", "export default'
// Chunk 3: ' function App() {", "  return <div>Hello</div>"'
// ...
```

## 3. Memory Tool

See [MEMORY_TOOL.md](./MEMORY_TOOL.md) for complete memory tool documentation.

### Quick Overview
- **Beta Header**: `context-management-2025-06-27`
- **Purpose**: Cross-conversation persistent memory
- **Storage**: `.memories/` directory
- **Commands**: view, create, str_replace, insert, delete, rename
- **Security**: Path traversal protection, restricted to `/memories`

## Configuration Summary

All beta features are enabled by default in `config/agent-sdk-config.js`:

```javascript
export const agentSDKConfig = {
  // ... other config

  betaHeaders: [
    'context-management-2025-06-27',           // Memory tool
    'token-efficient-tools-2025-02-19',        // Token efficiency
    'fine-grained-tool-streaming-2025-05-14'   // Fine-grained streaming
  ],

  tokenEfficiency: {
    enabled: true,
    averageSavings: 0.14,
    maxSavings: 0.70,
  },

  fineGrainedStreaming: {
    enabled: true,
    handleInvalidJSON: true,
  },

  memory: {
    enabled: true,
    baseDir: '.memories',
  }
};
```

## Monitoring & Metrics

### Token Efficiency Tracking

Monitor token savings in console logs:

```bash
✅ Session complete: session_xyz
💰 Cost: $0.0051 (calculated: $0.0051)
📊 Tokens - Input: 1524, Output: 89  # Note: Reduced output tokens
🗄️ Cache - Read: 0, Write: 1524
⚡ Cache Efficiency: 0.0%
```

Compare output tokens with/without beta header to verify savings.

### Streaming Performance

Track latency improvements:

```bash
🚀 Agent initialized
🛠️ Tools: Read, Write, Edit, Glob, Grep, WebSearch, TodoWrite, Memory
📦 Model: claude-sonnet-4-20250514
🔧 Using tool: create_file  # Immediate tool use notification
# [Content streams immediately]
```

### Cost Analysis

Calculate savings with `calculateCost()` utility:

```javascript
import { calculateCost } from '../config/agent-sdk-config.js';

// Calculate cost with token efficiency
const cost = calculateCost(usage);
console.log(`Total cost: $${cost.toFixed(4)}`);

// Compare with baseline (without token efficiency)
const baselineCost = cost / (1 - 0.14);  // Assume 14% savings
console.log(`Savings: $${(baselineCost - cost).toFixed(4)}`);
```

## Best Practices

### 1. Prompt Caching with Token Efficiency
- Use beta headers consistently across requests
- Don't toggle token efficiency on/off (breaks caching)
- Let all requests use the same beta configuration

### 2. Fine-Grained Streaming Error Handling
- Always check for `max_tokens` stop reason
- Wrap invalid JSON in error responses
- Implement retry logic with higher `max_tokens`

### 3. Memory Tool Usage
- Keep memory files organized and up-to-date
- Use descriptive filenames and directory structure
- Periodically clean up old/unused memories

### 4. Combined Benefits
- All three beta features work together seamlessly
- Token efficiency reduces streaming overhead
- Memory tool leverages fine-grained streaming for fast updates
- Combined savings can exceed 20% on tool-heavy workflows

## Troubleshooting

### Token Efficiency Not Working
- **Symptom**: No reduction in output tokens
- **Check**: Verify beta header in request logs
- **Fix**: Ensure `betas: agentConfig.betaHeaders` in query options

### Streaming Delays
- **Symptom**: Still seeing buffering delays
- **Check**: Confirm `fine-grained-tool-streaming-2025-05-14` header
- **Fix**: Check that streaming is enabled (`stream: true`)

### Invalid JSON Errors
- **Symptom**: Tool calls failing with JSON parse errors
- **Check**: Review `max_tokens` and stop reason
- **Fix**: Increase `max_tokens` or wrap invalid JSON in error response

### Memory Tool Issues
- **Symptom**: Memory files not persisting
- **Check**: Verify `.memories/` directory permissions
- **Fix**: Ensure `context-management-2025-06-27` beta header is set

## API Reference

### Beta Headers
```javascript
{
  'context-management-2025-06-27',           // Memory tool support
  'token-efficient-tools-2025-02-19',        // Token efficiency
  'fine-grained-tool-streaming-2025-05-14'   // Fine-grained streaming
}
```

### Agent SDK Query Options
```javascript
query({
  prompt: enhancedPrompt,
  options: {
    // ... other options
    betas: agentConfig.betaHeaders,  // Pass beta headers
  }
})
```

### Cost Calculation
```javascript
calculateCost(usage) => number  // Returns cost in USD
getCacheStats(usage) => {
  cacheHit: boolean,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  cacheEfficiency: number  // percentage
}
```

## Future Enhancements

Potential improvements:
- Dynamic beta header selection based on request type
- Per-agent beta feature toggles
- Real-time cost optimization metrics
- A/B testing framework for beta features
- Automatic beta header updates when features go GA

## Resources

- [Memory Tool Documentation](./MEMORY_TOOL.md)
- [Anthropic Tool Use Docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Streaming Guide](https://docs.anthropic.com/en/docs/build-with-claude/streaming)
- [Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
