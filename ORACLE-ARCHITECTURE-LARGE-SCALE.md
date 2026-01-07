# Granted Oracle - Large-Scale Architecture (2000+ Documents)

**Scale:** ~500 documents per department × 4 departments = **~2000 documents**
**Challenge:** Cannot load all documents into context (would exceed 200K token limit massively)
**Solution Required:** Multi-stage retrieval with semantic search

---

## 🚨 The Problem

### Context Math:
- **Average document size:** 2,000 words = ~2,500 tokens
- **500 documents × 2,500 tokens = 1,250,000 tokens per department**
- **Total knowledge base: ~5,000,000 tokens**
- **Claude's context limit: 200,000 tokens**

**We can only load ~80 documents maximum in context (and that's with NO conversation history or system prompt!)**

**Realistic limit: 5-10 documents per query**

---

## 🏗️ Required Architecture

### Stage 1: Document Indexing (One-time setup)

**Option A: Embedding-Based Search (Recommended)**

```javascript
// For each document:
1. Split into chunks (500-1000 words each)
2. Generate embeddings using OpenAI or similar
3. Store in vector database:
   - Pinecone (managed, $70/mo)
   - Weaviate (self-hosted, free)
   - Qdrant (self-hosted, free)
   - Upstash Vector (serverless, $10-30/mo)

// Store metadata with each chunk:
{
  text: "chunk content...",
  embedding: [0.123, 0.456, ...],
  metadata: {
    department: "Writers",
    docType: "Template",
    fileName: "ETG-Business-Case-Template.docx",
    dateModified: "2025-01-15",
    keywords: ["etg", "business case", "training"]
  }
}
```

**Option B: Hybrid Search (Best Results)**

Combine:
1. **Semantic search** (embeddings) - finds conceptually similar content
2. **Keyword search** (BM25/ElasticSearch) - finds exact matches
3. **Metadata filtering** - department, type, date

---

### Stage 2: Query Processing

```javascript
async function processOracleQuery(userQuery) {
  // 1. Analyze query
  const analysis = {
    departments: detectDepartments(userQuery),      // ["Strategy", "Writers"]
    docTypes: detectDocumentTypes(userQuery),       // ["Template"]
    keywords: extractKeywords(userQuery),           // ["client", "intake", "process"]
    intent: classifyIntent(userQuery)               // "find_template" | "how_to" | "example"
  };

  // 2. First-stage retrieval (cast wide net)
  const candidates = await vectorSearch({
    query: userQuery,
    filters: {
      department: analysis.departments,
      type: analysis.docTypes
    },
    topK: 20  // Get 20 candidate chunks
  });

  // 3. Re-rank by relevance
  const reranked = await rerank(candidates, userQuery);

  // 4. Select top 5-7 chunks (from different documents if possible)
  const finalChunks = selectDiverseChunks(reranked.slice(0, 7));

  // 5. Build context and call Claude
  return await callClaudeWithContext(finalChunks, userQuery);
}
```

---

### Stage 3: Response Generation

```javascript
// System prompt includes:
- Oracle role definition
- Selected document chunks with source citations
- Instructions to cite sources

// Response format:
"Based on the Writers Template for ETG Business Cases (ETG-Template-2024.docx),
the process is:
1. ...
2. ...

See also: Strategy-Client-Intake-Process.md for related workflows."
```

---

## 🛠️ Technology Stack Options

### Option 1: Full Embedding Solution (Best for 2000+ docs)

**Components:**
- **Embedding Model:** OpenAI `text-embedding-3-small` ($0.02 per 1M tokens)
- **Vector Database:** Upstash Vector (serverless, integrates with Redis)
- **Metadata Store:** Your existing Upstash Redis
- **Processing:** Update your existing `api/server.js`

**Cost:**
- Embedding 2000 docs (5M tokens): ~$0.10 one-time
- Upstash Vector storage: ~$20/mo
- Query cost: ~$0.001 per search
- Total: **~$20-30/mo**

**Implementation Time:** 2-3 days

---

### Option 2: Google Drive Native Search + Smart Filtering

**Components:**
- Use Google Drive API search
- Pre-index document metadata in Redis
- Keyword-based filtering + manual relevance ranking
- Load top documents via Drive API

**Cost:**
- Free (uses existing infrastructure)

**Limitations:**
- No semantic search (only keyword matching)
- Slower than vector search
- Less accurate results

**Implementation Time:** 1 day

---

### Option 3: Hybrid Approach (Recommended for MVP)

**Phase 1 (Week 1): Metadata Index**
```javascript
// Build searchable index in Redis
{
  "doc_123": {
    fileName: "ETG-Business-Case-Template.docx",
    department: "Writers",
    type: "Template",
    keywords: ["etg", "business case", "training", "template"],
    summary: "Template for ETG business case applications...",
    driveId: "abc123",
    lastModified: "2025-01-15"
  }
}

// Search process:
1. Match query keywords to document keywords/summaries
2. Filter by department/type
3. Score and rank documents
4. Load top 5-7 via Google Drive API
5. Send to Claude
```

**Phase 2 (Week 2-3): Add Embeddings**
- Generate embeddings for document summaries (not full text)
- Store in Upstash Vector
- Hybrid search: keyword match + semantic similarity

**Phase 3 (Week 4+): Full Vector Search**
- Chunk all documents
- Embed all chunks
- Full semantic search with re-ranking

**Advantages:**
- Start simple, iterate based on results
- Each phase delivers value
- Learn what works before investing in full solution

---

## 📊 Architecture Comparison

| Approach | Accuracy | Speed | Cost | Complexity | Recommendation |
|----------|----------|-------|------|------------|----------------|
| **Full Embeddings** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | $30/mo | High | Best long-term |
| **Drive Search + Metadata** | ⭐⭐⭐ | ⭐⭐⭐ | Free | Low | Quick MVP |
| **Hybrid (Recommended)** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | $20/mo | Medium | **START HERE** |

---

## 🚀 Recommended Implementation Plan

### Week 1: Metadata Index (MVP)

**Goal:** Get something working quickly

**Steps:**
1. Each department creates their folder structure
2. For each document, create metadata entry:
   - Title
   - Department
   - Type
   - 2-3 sentence summary
   - 5-10 keywords
3. Store in Redis hash: `oracle:docs:[docId]`
4. Build search function:
   ```javascript
   function searchDocuments(query) {
     // 1. Extract keywords from query
     // 2. Match against document keywords/summaries
     // 3. Filter by department if detected
     // 4. Score by number of keyword matches
     // 5. Return top 10 document IDs
     // 6. Load those documents from Drive
     // 7. Send to Claude with context
   }
   ```

**Deliverable:** Working Oracle that can find documents by keywords

---

### Week 2: Document Summaries with AI

**Goal:** Improve search accuracy

**Steps:**
1. Use Claude to generate better summaries:
   ```javascript
   for each document:
     summary = await claude.generate({
       prompt: "Read this document and create a 3-sentence summary
                highlighting: purpose, key topics, and when to use it.",
       document: documentContent
     });
   ```
2. Extract keywords automatically
3. Update metadata in Redis
4. Improve search ranking with better summaries

**Deliverable:** More accurate document discovery

---

### Week 3: Add Embeddings

**Goal:** Semantic search capability

**Steps:**
1. Sign up for Upstash Vector (~$20/mo)
2. Generate embeddings for document summaries:
   ```javascript
   const embedding = await openai.embeddings.create({
     model: "text-embedding-3-small",
     input: documentSummary
   });
   ```
3. Store in Upstash Vector with metadata
4. Update search to use hybrid:
   - Semantic similarity (embeddings)
   - Keyword matching (existing)
   - Combine scores

**Deliverable:** Can find documents even with different wording

---

### Week 4: Full Chunking (Optional)

**Goal:** Find specific sections within documents

**Steps:**
1. Split large documents into chunks (500-1000 words)
2. Embed each chunk
3. Return specific chunks instead of whole documents
4. Include document context with each chunk

**Deliverable:** Pinpoint accuracy for large documents

---

## 💾 Data Structure

### Redis Metadata Schema

```javascript
// Document index
HSET oracle:docs:doc_001 {
  "fileName": "ETG-Business-Case-Template.docx",
  "department": "Writers",
  "type": "Template",
  "driveId": "abc123xyz",
  "summary": "Comprehensive template for BC Employee Training Grant business cases...",
  "keywords": ["etg", "business case", "training", "bc", "template"],
  "dateModified": "2025-01-15",
  "fileSize": 45000,
  "chunkCount": 8
}

// Department index (for fast filtering)
SADD oracle:dept:Writers doc_001 doc_002 doc_003 ...

// Type index (for fast filtering)
SADD oracle:type:Template doc_001 doc_005 doc_012 ...

// Keyword index (for fast searching)
SADD oracle:keyword:etg doc_001 doc_023 doc_045 ...
```

### Upstash Vector Schema (Week 3+)

```javascript
{
  id: "doc_001_chunk_1",
  vector: [0.123, 0.456, ...],  // 1536 dimensions
  metadata: {
    docId: "doc_001",
    department: "Writers",
    type: "Template",
    fileName: "ETG-Business-Case-Template.docx",
    chunkIndex: 1,
    chunkText: "First 500 words of document..."
  }
}
```

---

## 🎯 Document Collection Process (Updated for Scale)

### New Requirements for Teams:

Instead of just adding shortcuts, teams need to provide:

**For each document:**
1. ✅ Add shortcut to appropriate folder
2. ✅ Fill out metadata form:
   - Title
   - Department
   - Type (Template/Example/Process/Reference/Data)
   - 2-3 sentence description
   - 5-10 keywords
   - Tags (optional)

**Metadata Collection Options:**

**Option A: Google Sheet**
- Create shared sheet: "Oracle Document Registry"
- Each team fills in rows for their docs
- You import to Redis

**Option B: Google Form**
- Create form with fields above
- Auto-populates sheet
- Import to Redis

**Option C: Automated (Best)**
- Teams just add shortcuts to folders
- Your script:
  1. Scans folders
  2. Reads each document
  3. Uses Claude to generate summary + keywords
  4. Auto-creates metadata
- Teams review and correct if needed

---

## 🔄 Automated Metadata Generation Script

```javascript
async function generateMetadataForDocument(driveFileId, department, type) {
  // 1. Download document from Drive
  const content = await downloadFromDrive(driveFileId);

  // 2. Use Claude to analyze
  const analysis = await claude.messages.create({
    model: "claude-sonnet-4",
    messages: [{
      role: "user",
      content: `Analyze this document and provide:
      1. A 2-3 sentence summary of its purpose and content
      2. 5-10 relevant keywords
      3. Primary use case (when would someone need this?)

      Document:
      ${content.substring(0, 10000)}  // First 10k chars

      Format as JSON.`
    }]
  });

  // 3. Store metadata
  await redis.hset(`oracle:docs:${driveFileId}`, {
    fileName: content.name,
    department: department,
    type: type,
    driveId: driveFileId,
    summary: analysis.summary,
    keywords: analysis.keywords.join(','),
    dateModified: new Date().toISOString(),
    dateIndexed: new Date().toISOString()
  });

  // 4. Update indexes
  await redis.sadd(`oracle:dept:${department}`, driveFileId);
  await redis.sadd(`oracle:type:${type}`, driveFileId);
  for (const keyword of analysis.keywords) {
    await redis.sadd(`oracle:keyword:${keyword.toLowerCase()}`, driveFileId);
  }
}
```

---

## ✅ Revised Recommendations

### For 2000 Documents:

1. **Week 1: Build metadata index with AI-generated summaries**
   - Teams add shortcuts to folders
   - Script auto-generates metadata
   - Keyword-based search works

2. **Week 2: Test and refine**
   - Use it internally
   - Identify gaps
   - Improve metadata quality

3. **Week 3: Add embeddings if needed**
   - Only if keyword search isn't good enough
   - Upstash Vector for semantic search
   - Hybrid scoring

4. **Week 4: Optimize**
   - Add chunking if documents are very long
   - Tune ranking algorithms
   - Add usage analytics

### Critical Success Factors:

1. **Good metadata is EVERYTHING**
   - Auto-generate with AI
   - Let teams review and improve
   - Keep it updated

2. **Start simple, iterate**
   - Don't build full vector DB on day 1
   - Learn what queries people actually ask
   - Optimize for real usage patterns

3. **Make it easy for teams**
   - Just add shortcuts to folders
   - Automation handles the rest
   - Minimal manual work

---

**Next step:** Should we build the automated metadata generation script?
