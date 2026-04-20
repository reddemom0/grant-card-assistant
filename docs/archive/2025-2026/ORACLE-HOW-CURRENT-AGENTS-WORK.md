# How Current Agents Use Knowledge Bases

**Date:** December 9, 2025
**Analysis of:** server.js.old (current production system)

---

## 🔍 Current System Architecture

### 1. Knowledge Base Loading (Startup)

**File:** server.js.old, lines 3656-3717

```javascript
// On server startup, load ALL documents into memory
async function loadKnowledgeBaseFromGoogleDrive() {
  knowledgeBases = {
    'grant-cards': [],
    'etg': [],
    'bcafe': [],
    'canexport': [],
    'canexport-claims': [],
    'readiness-strategist': [],
    'internal-oracle': []
  };

  // Download ALL documents from Google Drive
  // Parse PDFs, DOCX, Google Docs, etc.
  // Store in memory with structure:
  {
    filename: "grant_criteria_formatter.md",
    content: "Full document text...",
    size: 12500,
    type: "markdown"
  }
}
```

**Key Points:**
- ✅ **ALL documents loaded into memory at startup**
- ✅ **Cached in memory** for fast access
- ✅ No database or vector store
- ✅ Simple, works well for small knowledge bases

**Current Document Counts (estimate from logs):**
- Grant Cards: ~6-10 documents
- ETG: ~8-12 documents
- BCAFE: ~5-8 documents
- CanExport Claims: ~3-5 documents

**Total: ~30-40 documents across all agents**

---

### 2. Per-Request Document Selection

**File:** server.js.old, lines 4691-4711

For each user query, agents use **smart selection functions**:

```javascript
// Example from actual code
if (agentType === 'grant-cards') {
  relevantDocs = selectGrantCardDocuments(task, message, '', conversation, agentDocs);
} else if (agentType === 'etg-writer') {
  relevantDocs = selectETGDocuments(message, conversation, agentDocs);
} else if (agentType === 'bcafe-writer') {
  relevantDocs = selectBCAFEDocuments(message, null, conversation, agentDocs);
} else if (agentType === 'canexport-claims') {
  relevantDocs = selectCanExportClaimsDocuments(message, conversation, agentDocs);
} else {
  relevantDocs = agentDocs.slice(0, 3);  // Fallback: first 3 docs
}

// Build context from selected docs
if (relevantDocs.length > 0) {
  knowledgeContext = relevantDocs
    .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
    .join('\n\n');
}
```

---

### 3. Document Selection Logic

#### Grant Cards Agent (lines 3062-3165)

**Max Documents:** 2-4 (2 if large file uploaded, 4 otherwise)

**Selection Strategy:**
```javascript
// 1. Always include task-specific document
taskDocMap = {
  'grant-criteria': ['grant_criteria_formatter'],
  'preview': ['preview_section_generator'],
  'requirements': ['general_requirements_creator'],
  ...
}

// 2. Detect grant type from message
grantTypes = {
  hiring: ['hiring', 'wage', 'employment'...],
  training: ['training', 'skills', 'education'...],
  rd: ['research', 'development', 'innovation'...],
  ...
}

// 3. Detect industry
industries = {
  technology: ['tech', 'software', 'ai'...],
  agriculture: ['farm', 'food', 'rural'...],
  healthcare: ['health', 'medical'...],
  ...
}

// 4. Add relevant example documents
// 5. Return top 2-4 documents
```

**Example Output:**
```
🎯 Grant Cards Smart Selection: 3 docs selected from 10 total
- grant_criteria_formatter.md
- training-grant-example.pdf
- healthcare-sector-example.pdf
```

---

#### ETG Agent (lines 3169-3263)

**Max Documents:** 5

**Selection Strategy:**
```javascript
// 1. Always include eligibility criteria
// 2. Always include business case template
// 3. Detect training type: leadership, technical, digital, professional, certification
// 4. Detect industry: automotive, construction, hospitality, technology, healthcare
// 5. Add matching examples
// 6. Return up to 5 documents
```

**Example Output:**
```
🎯 ETG Smart Selection: 4 docs selected from 12 total
- BC-ETG-Eligibility-Criteria.pdf
- ETG-Business-Case-Template.docx
- Technical-Training-Example.pdf
- Automotive-Industry-Example.pdf
```

---

#### BCAFE Agent (lines 3267-3365)

**Max Documents:** 4

**Selection Strategy:**
```javascript
// 1. Always include eligibility checklist
// 2. Always include program guide
// 3. Detect intent: eligibility, budget, merit, application, examples
// 4. Detect industry: food, beverage, agriculture
// 5. Add matching documents
// 6. Return up to 4 documents
```

**Example Output:**
```
🎯 BCAFE Smart Selection: 3 docs selected from 8 total
- BCAFE-Eligibility-Checklist.md
- BCAFE-Program-Guide-Summer-2025.pdf
- Food-Sector-Example.pdf
```

---

#### CanExport Claims Agent (lines 3369-3468)

**Max Documents:** 3

**Selection Strategy:**
```javascript
// 1. Detect intent: eligibility, expense categories, compliance, consistency
// 2. Add matching guides
// 3. If no match, return first 3 documents
// 4. Return up to 3 documents
```

**Example Output:**
```
🎯 CanExport Claims Smart Selection: 2 docs selected from 5 total
- CanExport-Claims-Guidelines.pdf
- Expense-Categories-Guide.pdf
```

---

## 🎯 Key Selection Patterns

### Pattern 1: Core + Examples
```
Always include 1-2 "core" documents (eligibility, template)
+ Add 1-3 relevant examples based on detected context
= 2-5 total documents
```

### Pattern 2: Keyword Matching
```javascript
// Detect user intent from message keywords
const message = userMessage.toLowerCase();

if (['template', 'format', 'structure'].some(kw => message.includes(kw))) {
  // Include template documents
}

if (['example', 'sample', 'show me'].some(kw => message.includes(kw))) {
  // Include example documents
}
```

### Pattern 3: Conversation Context
```javascript
// Also check conversation history for context
const conversationText = conversationHistory
  .map(msg => msg.content)
  .join(' ')
  .toLowerCase();

// This helps maintain context across multi-turn conversations
```

---

## 📊 Why This Works for Current Agents

| Factor | Current State | Why It Works |
|--------|---------------|--------------|
| **Document Count** | 30-40 total, 5-12 per agent | Small enough to fit in memory |
| **Selection Speed** | Keyword matching | Fast, O(n) search through small arrays |
| **Memory Usage** | ~500KB total | Negligible for serverless function |
| **Accuracy** | Keyword-based | Good enough with well-categorized docs |
| **Maintenance** | Manual organization | Manageable with small doc count |

---

## ⚠️ Why This WON'T Work for Oracle (2000 docs)

| Problem | Impact |
|---------|--------|
| **Memory** | 2000 docs × 2500 tokens = ~5M tokens = ~12MB+ text | Would exceed serverless limits |
| **Load Time** | Downloading 2000 docs from Google Drive = 30-60 seconds | Timeout on every cold start |
| **Selection Speed** | O(n) keyword search through 2000 docs | Too slow (100ms+) |
| **Context Limit** | Can only use 5-10 docs, need smart selection | Keyword matching insufficient |
| **Maintenance** | Manual categorization of 2000 docs | Impossible to maintain |

---

## ✅ What We Can Learn for Oracle

### Keep What Works:
1. ✅ **Smart selection functions** - Don't load everything
2. ✅ **Keyword + intent detection** - Understand what user needs
3. ✅ **Max document limits** - Keep context manageable (5-10 docs)
4. ✅ **Core + Examples pattern** - Always include foundational docs
5. ✅ **Conversation context** - Use history to refine selection

### What Must Change:
1. ❌ **Can't load all docs in memory** → Need metadata index in Redis
2. ❌ **Can't use simple keyword search** → Need smarter ranking
3. ❌ **Can't manually categorize** → Need AI-generated metadata
4. ❌ **Can't search linearly** → Need indexed search (Redis sets)

---

## 🔧 Recommended Oracle Architecture

### Based on Current System Patterns:

```javascript
// Stage 1: Metadata Index (Redis)
// Instead of loading 2000 docs, load 2000 metadata records

oracle:doc:001 = {
  filename: "Client-Intake-Template.docx",
  department: "Strategy",
  type: "Template",
  summary: "Standard client intake form with discovery questions...",
  keywords: ["client", "intake", "discovery", "onboarding"],
  driveId: "abc123"
}

// Stage 2: Smart Selection (Similar to current agents)
function selectOracleDocuments(userQuery, conversation) {
  const query = userQuery.toLowerCase();

  // 1. Detect department (like current agents detect grant type)
  const departments = {
    writers: ['write', 'writing', 'template', 'draft'],
    strategy: ['client', 'intake', 'discovery', 'pricing'],
    research: ['grant program', 'eligibility', 'funder'],
    consultants: ['case study', 'consultation', 'problem']
  };

  // 2. Detect document type (like current agents detect industry)
  const types = {
    template: ['template', 'format', 'blank', 'form'],
    example: ['example', 'sample', 'case study'],
    process: ['how to', 'process', 'workflow', 'sop']
  };

  // 3. Search metadata index for matching documents
  const candidates = searchRedisIndex(query, departments, types);

  // 4. Score and rank (keyword overlap)
  const ranked = rankByRelevance(candidates, query);

  // 5. Return top 5-10
  return ranked.slice(0, 7);
}

// Stage 3: Load Selected Documents (from Google Drive)
const selectedDocs = await loadDocumentsFromDrive(selectedIds);

// Stage 4: Build Context (same as current agents)
const knowledgeContext = selectedDocs
  .map(doc => `=== ${doc.filename} ===\n${doc.content}`)
  .join('\n\n');
```

---

## 📋 Implementation Strategy

### Week 1: Build Metadata Index
- Generate metadata for 2000 docs using Claude
- Store in Redis with searchable structure
- Implement keyword search function

### Week 2: Build Selection Function
- Copy pattern from `selectGrantCardDocuments`
- Adapt for department + type detection
- Test with sample queries

### Week 3: Integrate with Google Drive
- Load selected docs on-demand (not at startup)
- Cache frequently accessed docs
- Monitor performance

### Week 4: Optimize
- Add semantic search if needed
- Tune ranking algorithms
- Add usage analytics

---

## 💡 Key Insight

**Current agents prove the pattern works:**
- Load only what you need (2-5 docs per query)
- Use keyword detection for selection
- Maintain conversation context
- Keep it simple and fast

**For Oracle, we just need:**
- Metadata index instead of full docs in memory
- Smarter search instead of linear keyword match
- On-demand loading instead of startup loading
- Same selection logic pattern (department + type + keywords)

**This is totally doable and will feel familiar!**

---

**Next Step:** Build the metadata generation script to create the Redis index?
