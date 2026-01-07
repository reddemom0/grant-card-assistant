# Oracle Metadata Schema

**Purpose:** Store searchable metadata for ~150 knowledge base documents in Redis

---

## Design Principles

For 150 documents, we can use **simple keyword-based search** without embeddings:
- Fast metadata generation (one-time ~15 min process)
- Fast search (<50ms)
- Low cost (Redis storage only, no vector DB)
- Easy to maintain

**Future-proof:** Schema supports adding embeddings later if we scale to 500+ docs

---

## Redis Data Structures

### 1. Document Metadata (Hash)

**Key:** `oracle:doc:{fileId}`

**Fields:**
```javascript
{
  fileId: "1ABC123xyz",                    // Google Drive file ID
  fileName: "ETG-Business-Case-Template.docx",
  department: "Writers",                    // Writers, Strategy, Research, Marketing, GCs
  fileType: "template",                     // template, example, process, reference, data
  mimeType: "application/vnd.google-apps.document",
  summary: "Comprehensive template for...", // 2-3 sentence AI-generated summary
  keywords: "etg,business case,training,bc,template,eligibility", // Comma-separated, lowercase
  dateModified: "2025-01-15T10:30:00Z",
  dateIndexed: "2025-01-20T14:00:00Z",
  fileSizeBytes: 45000,
  webViewLink: "https://docs.google.com/document/d/...",
  isShortcut: true                          // true if this is a Drive shortcut
}
```

**Storage estimate:** ~1KB per document × 150 = 150KB total

---

### 2. Department Index (Set)

**Purpose:** Fast filtering by department

**Keys:**
```
oracle:dept:Writers → Set of fileIds
oracle:dept:Strategy → Set of fileIds
oracle:dept:Research → Set of fileIds
oracle:dept:Marketing → Set of fileIds
oracle:dept:GCs → Set of fileIds
```

**Example:**
```redis
SADD oracle:dept:Writers "1ABC123" "1DEF456" "1GHI789"
```

---

### 3. File Type Index (Set)

**Purpose:** Fast filtering by document type

**Keys:**
```
oracle:type:template → Set of fileIds
oracle:type:example → Set of fileIds
oracle:type:process → Set of fileIds
oracle:type:reference → Set of fileIds
oracle:type:data → Set of fileIds
```

---

### 4. Keyword Index (Set)

**Purpose:** Fast keyword search

**Keys:** `oracle:keyword:{keyword}` → Set of fileIds

**Example:**
```redis
SADD oracle:keyword:etg "1ABC123" "1DEF456"
SADD oracle:keyword:template "1ABC123" "1GHI789"
SADD oracle:keyword:pricing "1JKL012" "1MNO345"
```

**Indexing strategy:**
- Extract keywords from summary + fileName
- Lowercase all keywords
- Store as individual sets for fast intersection queries

---

### 5. Search Stats (Hash)

**Purpose:** Track search usage and optimize

**Key:** `oracle:stats`

**Fields:**
```javascript
{
  totalDocuments: 150,
  lastIndexedAt: "2025-01-20T14:00:00Z",
  totalSearches: 450,
  avgSearchTimeMs: 35,
  topKeywords: "etg:45,canexport:38,pricing:32,template:28"
}
```

---

## Search Algorithm

### Simple Keyword Search (Phase 1 - Current)

```javascript
async function searchDocuments(query, filters = {}) {
  // 1. Extract keywords from query
  const keywords = extractKeywords(query); // ["etg", "business", "case"]

  // 2. Get candidate file IDs from keyword index
  const candidates = [];
  for (const keyword of keywords) {
    const fileIds = await redis.smembers(`oracle:keyword:${keyword}`);
    candidates.push(...fileIds);
  }

  // 3. Count keyword matches per document
  const scores = {};
  candidates.forEach(fileId => {
    scores[fileId] = (scores[fileId] || 0) + 1;
  });

  // 4. Apply filters (department, type)
  if (filters.department) {
    const deptDocs = await redis.smembers(`oracle:dept:${filters.department}`);
    // Only keep candidates in this department
    Object.keys(scores).forEach(fileId => {
      if (!deptDocs.includes(fileId)) delete scores[fileId];
    });
  }

  // 5. Sort by score (most keyword matches first)
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([fileId]) => fileId);

  // 6. Load top 10 document metadata
  const topDocs = sorted.slice(0, 10);
  const metadata = await Promise.all(
    topDocs.map(id => redis.hgetall(`oracle:doc:${id}`))
  );

  return metadata;
}
```

**Performance:** ~30-50ms for 150 docs

---

### Enhanced Search (Phase 2 - Future, if needed)

If keyword search isn't accurate enough, add:

**A. TF-IDF Scoring**
```javascript
// Weight rare keywords higher than common ones
const termFrequency = keywordCount / totalKeywordsInDoc;
const inverseDocFrequency = Math.log(totalDocs / docsContainingKeyword);
const score = termFrequency * inverseDocFrequency;
```

**B. Embeddings (Upstash Vector)**
```javascript
// Store in additional structure
oracle:embedding:{fileId} → { vector: [...], metadata: {...} }

// Search becomes:
const semanticResults = await vectorSearch(query, topK=20);
const keywordResults = await keywordSearch(query, topK=20);
const combined = mergeAndRerank(semanticResults, keywordResults);
```

**Only add if:**
- Users report poor search results
- We scale beyond 300 docs
- Budget allows (~$20/mo for Upstash Vector)

---

## Metadata Generation Process

### Script: `scripts/generate-oracle-metadata.js`

**Process:**
```javascript
1. Scan Oracle KB folder (1Dn0bqabKU1Z7NLKrFUOhR18vXxnYhEev)
2. Get all department subfolders
3. For each folder:
   a. List all files (including shortcuts)
   b. For each file:
      - Download content (first 10,000 chars for large files)
      - Send to Claude API:
        Prompt: "Analyze this document and provide:
                 1. A 2-3 sentence summary
                 2. 8-12 relevant keywords (comma-separated, lowercase)
                 3. Document type: template, example, process, reference, or data

                 Document: {content}

                 Return JSON: { summary, keywords, fileType }"
      - Store metadata in Redis
      - Update indexes (dept, type, keywords)
4. Update oracle:stats
```

**Runtime:** ~150 docs × 3 seconds = ~8 minutes total

**Cost:** 150 docs × ~3K tokens = ~450K tokens = ~$1.35 (using Claude Haiku for metadata generation)

---

## File Type Classification

**template** - Blank forms, templates, standard structures
- Examples: "ETG-Business-Case-Template.docx", "Client-Intake-Form.xlsx"

**example** - Completed samples, case studies, past work
- Examples: "Company-X-CanExport-Application.pdf", "Tech-Sector-Grant-Example.docx"

**process** - SOPs, workflows, how-to guides
- Examples: "Weekly-Launch-Process.md", "Claims-Submission-SOP.pdf"

**reference** - Guidelines, rubrics, program rules
- Examples: "ETG-Eligibility-Criteria.pdf", "Brand-Guidelines.pdf"

**data** - Databases, lists, calendars, pricing sheets
- Examples: "Marketing-Calendar-2025.xlsx", "Partnership-Leads.xlsx"

---

## Implementation Checklist

- [ ] Create metadata generation script
- [ ] Add Redis connection in script
- [ ] Test on 5 sample documents
- [ ] Run full index generation
- [ ] Verify all indexes populated
- [ ] Build search function
- [ ] Test search with sample queries
- [ ] Integrate with Oracle agent
- [ ] Deploy to Railway
- [ ] Test end-to-end

---

## Maintenance

**Re-indexing triggers:**
- New documents added to knowledge base folders
- Existing documents significantly updated
- Search quality issues reported

**Re-index process:**
```bash
npm run oracle:reindex
# Scans for changes, updates only modified docs
# ~2-3 min for incremental updates
```

**Manual re-index:**
```bash
npm run oracle:reindex -- --full
# Re-indexes all documents from scratch
# ~8-10 min total
```

---

## Success Metrics

**Phase 1 (Simple Keyword Search):**
- ✅ Search returns relevant results in top 5 for 80%+ of queries
- ✅ Average search time <100ms
- ✅ Team reports finding docs faster than manual browsing

**Phase 2 triggers (if needed):**
- ❌ Search accuracy below 70%
- ❌ Frequent "couldn't find" responses from Oracle
- ❌ Team requests for better semantic search

Then consider adding embeddings/TF-IDF.
