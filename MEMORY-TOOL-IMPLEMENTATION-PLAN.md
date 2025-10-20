# Memory Tool Implementation Plan

**Purpose**: Add learning capabilities and cross-conversation workflows to Grant Card assistant

**Use Cases**:
1. Learn from user feedback and corrections
2. Track multi-day grant application projects
3. Build institutional knowledge base
4. Reference successful patterns and decisions

---

## Memory Structure Design

### Directory Organization

```
/memories/
├── user_feedback/
│   ├── corrections.xml          # User corrections to eligibility, criteria, etc.
│   ├── approvals.xml            # Approved grant card formats and content
│   └── preferences.xml          # User formatting and content preferences
│
├── projects/
│   ├── active/
│   │   ├── project_<id>.xml    # Active multi-day grant projects
│   │   └── ...
│   └── completed/
│       ├── project_<id>.xml    # Completed projects for reference
│       └── ...
│
├── knowledge_base/
│   ├── grant_patterns/
│   │   ├── canexport_sme.xml   # Successful CanExport patterns
│   │   ├── etg_grants.xml      # Successful ETG patterns
│   │   └── bcafe.xml           # Successful BCAFE patterns
│   │
│   ├── eligibility_rules/
│   │   ├── revenue_thresholds.xml
│   │   ├── employee_counts.xml
│   │   └── sector_requirements.xml
│   │
│   └── common_issues/
│       ├── validation_errors.xml
│       ├── edge_cases.xml
│       └── clarifications.xml
│
└── sessions/
    └── session_<date>.xml       # Daily session notes and progress
```

---

## Implementation Components

### 1. Memory Tool Handler (Client-Side)

**File**: `api/memory-tool-handler.js`

Handles all memory tool operations:
- `view` - List directory or read file
- `create` - Create/overwrite file
- `str_replace` - Replace text in file
- `insert` - Insert text at line
- `delete` - Delete file/directory
- `rename` - Rename/move file

**Security**: All operations restricted to `/memories` directory

### 2. Memory Integration in API

**Updates to**: `api/server.js`

- Add memory tool to tool definitions
- Handle memory tool_use blocks
- Execute memory operations
- Return results to Claude

### 3. Feedback Collection System

**New endpoints**:
- `/api/submit-feedback` - User submits corrections/approvals
- `/api/get-project-status` - Retrieve project context
- `/api/list-projects` - List active/completed projects

### 4. Memory Prompts

**System prompt additions**:
- Instructions for when to use memory
- Guidelines for organizing knowledge
- Feedback integration patterns

---

## Example Use Cases

### Use Case 1: Learning from Corrections

**Scenario**: User corrects an eligibility interpretation

**Conversation**:
```
User: "Actually, CanExport SME requires 5-499 employees, not 1-499"

Claude: "Thank you for the correction. Let me update my knowledge base."

[Memory Tool Call: str_replace]
Path: /memories/knowledge_base/eligibility_rules/employee_counts.xml
Old: <canexport_sme>1-499 employees</canexport_sme>
New: <canexport_sme>5-499 employees (corrected by user)</canexport_sme>

Claude: "I've updated my knowledge. Future CanExport grant cards will reflect
        the correct 5-499 employee requirement."
```

**Memory File After Update**:
```xml
<!-- /memories/knowledge_base/eligibility_rules/employee_counts.xml -->
<eligibility_rules>
  <last_updated>2025-10-15</last_updated>

  <canexport_sme>
    <requirement>5-499 employees</requirement>
    <note>Corrected by user on 2025-10-15</note>
    <previous_error>Previously stated 1-499</previous_error>
  </canexport_sme>

  <etg>
    <requirement>5-149 employees for small business stream</requirement>
  </etg>
</eligibility_rules>
```

---

### Use Case 2: Multi-Day Project Tracking

**Day 1**:
```
User: "I'm working on a grant application for TechCorp's export expansion to US markets"

Claude: "I'll help you with that. Let me create a project file to track our progress."

[Memory Tool Call: create]
Path: /memories/projects/active/techcorp_export_2025.xml
Content:
<project>
  <id>techcorp_export_2025</id>
  <created>2025-10-15</created>
  <organization>TechCorp Inc</organization>
  <objective>Export expansion to US markets</objective>
  <status>initial_assessment</status>

  <progress>
    <completed>
      <item>Identified target market: US tech sector</item>
    </completed>
    <next_steps>
      <item>Determine best grant program (CanExport vs BCAFE)</item>
      <item>Gather financial documentation</item>
    </next_steps>
  </progress>
</project>
```

**Day 2**:
```
User: "Continue with the TechCorp grant application"

Claude: [Checks memory: view /memories/projects/active/]
        [Reads: /memories/projects/active/techcorp_export_2025.xml]

"Welcome back! I see we're working on TechCorp's export expansion to US markets.

 Last session we identified the target market. Next steps are:
 1. Determine best grant program (CanExport vs BCAFE)
 2. Gather financial documentation

 Shall we evaluate which grant program is the best fit?"
```

---

### Use Case 3: Building Knowledge from Approved Formats

**Scenario**: User approves a grant card format

**Conversation**:
```
User: "This grant card is perfect - save this format for future CanExport cards"

Claude: "I'll save this approved format to my knowledge base."

[Memory Tool Call: create]
Path: /memories/knowledge_base/grant_patterns/canexport_sme_approved.xml
Content:
<approved_format>
  <approved_date>2025-10-15</approved_date>
  <grant_type>CanExport SME</grant_type>

  <structure>
    <program_details>
      <length>150 words</length>
      <format>3-4 bullet points</format>
      <includes>Application process, timelines, standout features</includes>
    </program_details>

    <eligibility_criteria>
      <length>100 words</length>
      <format>5-8 bullet points</format>
      <prioritize>Revenue requirements first, then employee count</prioritize>
    </eligibility_criteria>
  </structure>

  <style_preferences>
    <tone>Professional, concise</tone>
    <avoid>Generic boilerplate, exhaustive lists</avoid>
    <include>Specific dollar amounts, clear deadlines</include>
  </style_preferences>
</approved_format>
```

**Next CanExport Grant Card**:
```
Claude: [Checks memory before creating grant card]
        [Reads: /memories/knowledge_base/grant_patterns/canexport_sme_approved.xml]

"I'll create this CanExport grant card using the format you previously approved:
 - Revenue requirements first in eligibility
 - 3-4 bullet points for program details
 - Specific dollar amounts and deadlines included"

[Creates grant card matching approved pattern]
```

---

### Use Case 4: Cross-Conversation Institutional Knowledge

**Scenario**: Building reusable knowledge base

**First Grant Application (CanExport)**:
```
User: "What are the common validation errors for CanExport applications?"
Assistant: [Provides answer from documentation]

User: "Also, applications are often rejected for insufficient market research"
Assistant: "Let me add that to my knowledge base."

[Memory Tool Call: create]
Path: /memories/knowledge_base/common_issues/canexport_rejections.xml
Content:
<rejection_reasons>
  <grant_type>CanExport SME</grant_type>
  <common_issues>
    <issue priority="high">
      <problem>Insufficient market research</problem>
      <solution>Provide detailed competitive analysis and market sizing</solution>
      <user_insight>From user feedback 2025-10-15</user_insight>
    </issue>
  </common_issues>
</rejection_reasons>
```

**Later Grant Application (Different User/Session)**:
```
User: "Help me with a CanExport application"
Assistant: [Checks memory, finds rejection_reasons.xml]

"I'll help you with your CanExport application. Based on my knowledge base,
 here are key things to avoid:

 ⚠️ Common rejection reason: Insufficient market research
 → Make sure to include detailed competitive analysis and market sizing

 Would you like me to help you structure your market research section?"
```

---

## Technical Implementation

### Step 1: Memory Tool Handler

```javascript
// api/memory-tool-handler.js

const fs = require('fs').promises;
const path = require('path');

// Base directory for all memory operations
const MEMORY_BASE_DIR = path.join(__dirname, '..', 'memories');

// Security: Validate all paths to prevent traversal attacks
function validatePath(requestedPath) {
  // Must start with /memories
  if (!requestedPath.startsWith('/memories')) {
    throw new Error('Invalid path: must start with /memories');
  }

  // Convert to absolute path and resolve
  const absolutePath = path.join(MEMORY_BASE_DIR, requestedPath.replace('/memories', ''));
  const resolvedPath = path.resolve(absolutePath);

  // Verify it's still within memory directory
  if (!resolvedPath.startsWith(MEMORY_BASE_DIR)) {
    throw new Error('Path traversal detected');
  }

  return resolvedPath;
}

// Command handlers
async function handleView(args) {
  const filePath = validatePath(args.path);

  try {
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      // List directory contents
      const files = await fs.readdir(filePath);
      return `Directory: ${args.path}\n${files.map(f => `- ${f}`).join('\n')}`;
    } else {
      // Read file contents
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');

      // Handle view_range if specified
      if (args.view_range) {
        const [start, end] = args.view_range;
        const selectedLines = lines.slice(start - 1, end);
        return selectedLines.join('\n');
      }

      return content;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return `Error: File or directory not found: ${args.path}`;
    }
    throw error;
  }
}

async function handleCreate(args) {
  const filePath = validatePath(args.path);

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write file
  await fs.writeFile(filePath, args.file_text, 'utf8');

  return `File created: ${args.path}`;
}

async function handleStrReplace(args) {
  const filePath = validatePath(args.path);

  try {
    let content = await fs.readFile(filePath, 'utf8');

    // Check if old_str exists
    if (!content.includes(args.old_str)) {
      return `Error: String not found in file: "${args.old_str}"`;
    }

    // Replace string
    content = content.replace(args.old_str, args.new_str);

    // Write back
    await fs.writeFile(filePath, content, 'utf8');

    return `String replaced in: ${args.path}`;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return `Error: File not found: ${args.path}`;
    }
    throw error;
  }
}

async function handleInsert(args) {
  const filePath = validatePath(args.path);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');

    // Insert at specified line (1-indexed)
    lines.splice(args.insert_line - 1, 0, args.insert_text);

    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    return `Text inserted at line ${args.insert_line} in: ${args.path}`;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return `Error: File not found: ${args.path}`;
    }
    throw error;
  }
}

async function handleDelete(args) {
  const filePath = validatePath(args.path);

  try {
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
      return `Directory deleted: ${args.path}`;
    } else {
      await fs.unlink(filePath);
      return `File deleted: ${args.path}`;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return `Error: File or directory not found: ${args.path}`;
    }
    throw error;
  }
}

async function handleRename(args) {
  const oldPath = validatePath(args.old_path);
  const newPath = validatePath(args.new_path);

  try {
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(newPath), { recursive: true });

    await fs.rename(oldPath, newPath);

    return `Renamed: ${args.old_path} → ${args.new_path}`;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return `Error: Source not found: ${args.old_path}`;
    }
    throw error;
  }
}

// Main handler
async function handleMemoryToolUse(toolInput) {
  const { command } = toolInput;

  console.log(`🧠 Memory Tool: ${command} - ${JSON.stringify(toolInput)}`);

  try {
    switch (command) {
      case 'view':
        return await handleView(toolInput);
      case 'create':
        return await handleCreate(toolInput);
      case 'str_replace':
        return await handleStrReplace(toolInput);
      case 'insert':
        return await handleInsert(toolInput);
      case 'delete':
        return await handleDelete(toolInput);
      case 'rename':
        return await handleRename(toolInput);
      default:
        return `Error: Unknown command: ${command}`;
    }
  } catch (error) {
    console.error('Memory tool error:', error);
    return `Error: ${error.message}`;
  }
}

// Initialize memory directory on startup
async function initializeMemoryDirectory() {
  const dirs = [
    'user_feedback',
    'projects/active',
    'projects/completed',
    'knowledge_base/grant_patterns',
    'knowledge_base/eligibility_rules',
    'knowledge_base/common_issues',
    'sessions'
  ];

  for (const dir of dirs) {
    await fs.mkdir(path.join(MEMORY_BASE_DIR, dir), { recursive: true });
  }

  console.log('✅ Memory directory initialized');
}

module.exports = {
  handleMemoryToolUse,
  initializeMemoryDirectory
};
```

---

### Step 2: Integration with API Server

```javascript
// In api/server.js

const { handleMemoryToolUse, initializeMemoryDirectory } = require('./memory-tool-handler');

// Initialize on startup
initializeMemoryDirectory().catch(console.error);

// Memory tool definition
const MEMORY_TOOL = {
  type: "memory_20250818",
  name: "memory"
};

// Update API calls to include memory tool
// In callClaudeAPI and callClaudeAPIStream functions:

// Add to headers
headers: {
  'anthropic-beta': 'context-management-2025-06-27,files-api-2025-04-14'
}

// Add to tools array
tools: [webSearchTool, MEMORY_TOOL]

// Handle memory tool responses
// In streaming and non-streaming response handlers:

if (block.type === 'tool_use' && block.name === 'memory') {
  console.log(`🧠 Memory tool used: ${block.input.command}`);

  // Execute memory operation
  const memoryResult = await handleMemoryToolUse(block.input);

  // Add tool_result to conversation
  conversation.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: block.id,
        content: memoryResult
      }
    ]
  });

  // Continue conversation with tool result
  // ... (send updated conversation back to Claude)
}
```

---

### Step 3: Enhanced System Prompts

```javascript
// Add to system prompt when memory tool is enabled

const MEMORY_INSTRUCTIONS = `
MEMORY SYSTEM:
You have access to a persistent memory system that preserves knowledge across conversations.

WHEN TO USE MEMORY:
1. **At conversation start**: ALWAYS check /memories to see if there's relevant context
2. **Learning from feedback**: When user corrects information, update knowledge base
3. **Approved formats**: When user approves content, save pattern for future use
4. **Multi-day projects**: Track progress for projects spanning multiple sessions
5. **Institutional knowledge**: Build reusable knowledge from successful applications

MEMORY ORGANIZATION:
- /memories/user_feedback/ - Corrections, approvals, preferences
- /memories/projects/active/ - Ongoing multi-day projects
- /memories/knowledge_base/ - Reusable grant patterns and rules
- /memories/sessions/ - Daily session notes

BEST PRACTICES:
- Keep memory files concise and organized (use XML for structure)
- Update existing files rather than creating duplicates
- Delete outdated information
- Include timestamps and context in entries
- Reference memory sources when using stored knowledge

EXAMPLE WORKFLOW:
1. User asks about CanExport grant
2. Check /memories/knowledge_base/grant_patterns/canexport_sme.xml
3. Use stored knowledge to inform response
4. If user provides corrections, update knowledge base
5. If user approves format, save pattern for future reference
`;
```

---

## Rollout Plan

### Phase 1: Basic Memory (Week 1)
- ✅ Implement memory tool handler
- ✅ Add memory tool to API requests
- ✅ Test basic memory operations
- ✅ Initialize directory structure

### Phase 2: Feedback Learning (Week 2)
- ✅ Add correction tracking
- ✅ Build approval system
- ✅ Create knowledge base structure
- ✅ Test cross-conversation learning

### Phase 3: Project Tracking (Week 3)
- ✅ Implement project file format
- ✅ Add project endpoints
- ✅ Test multi-day workflows
- ✅ Build project management UI (optional)

### Phase 4: Knowledge Base Growth (Week 4)
- ✅ Refine memory organization
- ✅ Add memory search/query capabilities
- ✅ Build analytics on memory usage
- ✅ Document best practices

---

## Testing Strategy

### Test 1: Basic Memory Operations
```
1. Create a memory file
2. Read it back
3. Update with str_replace
4. Verify changes
5. Delete file
```

### Test 2: Cross-Session Learning
```
Session 1:
- User corrects eligibility rule
- Verify memory file created

Session 2 (new conversation):
- Ask same question
- Verify corrected answer used
```

### Test 3: Multi-Day Project
```
Day 1:
- Start grant project
- Verify project file created

Day 2:
- Resume project
- Verify context restored
- Add progress
- Verify updates saved
```

### Test 4: Knowledge Building
```
1. User approves grant card format
2. Verify pattern saved
3. Create new grant card
4. Verify pattern applied
```

---

## Security Considerations

### Path Traversal Prevention
```javascript
// CRITICAL: All paths validated
// ✅ Allowed: /memories/projects/active/project1.xml
// ❌ Blocked: /memories/../../../etc/passwd
// ❌ Blocked: /memories/%2e%2e%2fetc/passwd
```

### File Size Limits
```javascript
// Prevent memory files from growing too large
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_MEMORY_TOTAL = 100 * 1024 * 1024; // 100MB total
```

### Sensitive Information
```javascript
// Validate content before storing
function containsSensitiveInfo(content) {
  const patterns = [
    /api[_-]?key/i,
    /password/i,
    /secret/i,
    /credit[_-]?card/i,
    /ssn/i
  ];
  return patterns.some(p => p.test(content));
}
```

---

## Monitoring & Analytics

### Track Memory Usage
```javascript
// Log memory operations
{
  timestamp: '2025-10-15T10:30:00Z',
  operation: 'create',
  path: '/memories/knowledge_base/canexport.xml',
  userId: 'user-123',
  agentType: 'grant-cards'
}
```

### Memory Growth Metrics
- Total files created
- Total storage used
- Most accessed files
- Knowledge reuse rate
- Cross-session learning instances

---

## Next Steps

1. **Review this plan** - Confirm approach aligns with needs
2. **Implement handler** - Start with memory-tool-handler.js
3. **Integrate with API** - Update server.js
4. **Test thoroughly** - Validate all operations
5. **Deploy to development** - Test in real scenarios
6. **Monitor & refine** - Adjust based on usage patterns

---

**Ready to implement?** Let me know and I'll start building the memory tool handler!
