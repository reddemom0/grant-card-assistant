# Client.js Context Injection Patch

## Location: src/claude/client.js

Add this import at the top of the file (around line 14, after other imports):

```javascript
import { getLeadGenFormContext } from '../utils/lead-gen-context.js';
```

## Add context loading section after line 115 (after loading learning memory):

```javascript
// ============================================================================
// 2.7. Load lead-gen form context (LEAD-GEN ONLY - NOT CACHEABLE)
// ============================================================================

let leadGenFormContext = null;
if (agentType === 'lead-gen') {
  console.log(`📝 Loading lead-gen form context...`);
  leadGenFormContext = await getLeadGenFormContext(conversationId);
  if (leadGenFormContext) {
    console.log(`✓ Injected lead form data and company background into system prompt`);
  } else {
    console.log(`✓ No form context available (may be first message before form submission)`);
  }
}
```

## Add context to system blocks (after line 379, after learningMemory injection):

```javascript
// Add lead-gen form context (if present) - NOT CACHED
if (leadGenFormContext) {
  systemBlocks.push({
    type: 'text',
    text: leadGenFormContext  // ❌ NOT CACHED (conversation-specific)
  });
}
```

## Summary

These changes will:
1. Import the helper function
2. Load form data and company background for lead-gen sessions
3. Inject it into the system prompt so the agent sees:
   - Lead name, email, company, website
   - Extracted company info (description, industry, location, team size, products/services)

The agent will receive this context at the start of every message, but it will NEVER reference the website or form directly in responses - it will use the information naturally in its conversation.
