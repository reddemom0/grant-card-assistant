# Granted Oracle - Federated Search Architecture

**Date:** December 9, 2025
**Concept:** Let each platform (Google Drive, HubSpot, Dropbox) handle its own search, then aggregate results

---

## 🎯 Core Concept

Instead of centralizing 2000+ documents, **query each system in parallel** and let them use their native search capabilities:

```
User Query: "What's our client intake process?"
         ↓
   Oracle Agent
         ↓
    ┌────┴────┬─────────┬─────────┐
    ↓         ↓         ↓         ↓
Google API  HubSpot   Dropbox  (Future)
Search      Search    Search    Systems
(parallel)  (parallel)(parallel)
    ↓         ↓         ↓
[5 results][3 results][2 results]
    ↓         ↓         ↓
    └────┬────┴─────────┘
         ↓
  Aggregate & Rank
  (10 total results)
         ↓
  Select Top 5-7
         ↓
  Load Full Content
         ↓
    Send to Claude
         ↓
Response with Source Citations
"Based on Client-Intake-Template.docx (Google Drive)
and Sarah's onboarding workflow (HubSpot)..."
```

---

## 🔍 Platform Search Capabilities

### Google Drive API ✅ EXCELLENT

**Endpoint:** `/drive/v3/files`
**Query Parameter:** `q=fullText contains 'keyword'`

**Capabilities:**
- ✅ Full-text search (searches file CONTENT, not just names)
- ✅ Boolean operators (AND, OR, NOT)
- ✅ Phrase matching: `fullText contains '"exact phrase"'`
- ✅ Folder filtering: `'folderId' in parents`
- ✅ File type filtering: `mimeType = 'application/pdf'`
- ✅ Metadata search: modified date, owner, etc.

**Example Query:**
```javascript
const query = `fullText contains 'client intake' and 'FOLDER_ID' in parents`;

const response = await fetch(
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime)`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
```

**Performance:** Fast, optimized by Google
**Cost:** Free (within quota)
**Rating:** ⭐⭐⭐⭐⭐

---

### HubSpot API ⚠️ LIMITED

**Endpoint:** `/crm/v3/objects/{objectType}/search`
**Method:** POST with search criteria

**Capabilities:**
- ✅ CRM Object Search (contacts, companies, deals, tickets, notes)
- ⚠️ Knowledge Base has NO public API
- ⚠️ Content Search API exists but limited
- ✅ Can search Notes, Documents attached to records
- ✅ Filter by properties, associations

**What We CAN Search:**
- Notes (rich text notes on contacts/deals)
- Documents (attachments on records)
- Email content (logged emails)
- Call notes (logged calls)
- Task descriptions

**Example Query:**
```javascript
// Search Notes objects
const response = await fetch('https://api.hubapi.com/crm/v3/objects/notes/search', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${hubspotToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: 'client intake',
    limit: 10,
    properties: ['hs_note_body', 'hs_timestamp']
  })
});
```

**Workaround for Knowledge Base:**
- Use Content Search API (undocumented but works)
- Search CRM Notes where teams document processes
- Export key KB articles to Google Drive

**Performance:** Good for CRM objects
**Cost:** Free (within API limits)
**Rating:** ⭐⭐⭐ (good but Knowledge Base limitation is painful)

---

### Dropbox API ✅ VERY GOOD

**Endpoint:** `/files/search_v2`
**Method:** POST

**Capabilities:**
- ✅ Full-text content search
- ✅ File name and extension search
- ✅ Image OCR text search
- ✅ Folder-scoped search: `path` parameter
- ✅ File category filtering
- ✅ 20%+ faster than v1

**Example Query:**
```javascript
const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${dropboxToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: 'client intake',
    options: {
      path: '/Granted Consulting/Strategy',
      max_results: 10,
      file_categories: ['.pdf', '.docx']
    }
  })
});
```

**Performance:** Very good, optimized in v2
**Cost:** Free (within API limits)
**Rating:** ⭐⭐⭐⭐⭐

---

## 🏗️ Implementation Architecture

### Phase 1: Parallel Search

```javascript
async function searchAllSources(userQuery) {
  // Launch all searches in parallel
  const [googleResults, hubspotResults, dropboxResults] = await Promise.all([
    searchGoogleDrive(userQuery),
    searchHubSpot(userQuery),
    searchDropbox(userQuery)
  ]);

  return {
    google: googleResults,    // Array of {id, name, mimeType, source: 'google'}
    hubspot: hubspotResults,  // Array of {id, title, type, source: 'hubspot'}
    dropbox: dropboxResults   // Array of {id, name, path, source: 'dropbox'}
  };
}
```

---

### Phase 2: Aggregation & Ranking

```javascript
function aggregateResults(searchResults, userQuery) {
  const allResults = [
    ...searchResults.google.map(r => ({ ...r, source: 'google', platform: 'Google Drive' })),
    ...searchResults.hubspot.map(r => ({ ...r, source: 'hubspot', platform: 'HubSpot' })),
    ...searchResults.dropbox.map(r => ({ ...r, source: 'dropbox', platform: 'Dropbox' }))
  ];

  // Score each result
  const scored = allResults.map(result => ({
    ...result,
    score: calculateRelevanceScore(result, userQuery)
  }));

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Return top 10 candidates
  return scored.slice(0, 10);
}

function calculateRelevanceScore(result, query) {
  let score = 0;
  const queryLower = query.toLowerCase();
  const titleLower = (result.name || result.title || '').toLowerCase();

  // Exact title match: +10 points
  if (titleLower === queryLower) score += 10;

  // Title contains all query words: +5 points
  const queryWords = queryLower.split(' ');
  if (queryWords.every(word => titleLower.includes(word))) score += 5;

  // Partial word match: +1 per word
  score += queryWords.filter(word => titleLower.includes(word)).length;

  // Boost recent files
  if (result.modifiedTime) {
    const daysSinceModified = (Date.now() - new Date(result.modifiedTime)) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 30) score += 2;
    if (daysSinceModified < 7) score += 1;
  }

  // Platform priority (adjust based on your needs)
  if (result.source === 'google') score += 1;  // Google Drive often has templates
  if (result.source === 'hubspot') score += 0.5;  // HubSpot has practical notes

  return score;
}
```

---

### Phase 3: Content Loading

```javascript
async function loadDocumentContent(result) {
  switch (result.source) {
    case 'google':
      return await loadFromGoogleDrive(result.id);

    case 'hubspot':
      return await loadFromHubSpot(result.id, result.type);

    case 'dropbox':
      return await loadFromDropbox(result.path);
  }
}

// Load top 5-7 documents
const topResults = rankedResults.slice(0, 7);
const documents = await Promise.all(
  topResults.map(result => loadDocumentContent(result))
);
```

---

### Phase 4: Context Building

```javascript
function buildOracleContext(documents) {
  return documents.map(doc =>
    `=== ${doc.name} (${doc.platform}) ===
Source: ${doc.platform} - ${doc.path || doc.url}
Last Modified: ${doc.modifiedTime}

${doc.content}
`
  ).join('\n\n');
}
```

---

## 📊 Comparison: Federated vs Centralized

| Aspect | Federated (Your Idea) | Centralized (Original Plan) |
|--------|----------------------|----------------------------|
| **Data Sync** | ✅ Always current | ❌ Needs sync process |
| **Search Speed** | ✅ Platform-optimized | ⚠️ Custom implementation |
| **Maintenance** | ✅ Minimal | ❌ Metadata upkeep |
| **Complexity** | ✅ Simpler | ❌ More complex |
| **Storage** | ✅ None needed | ❌ Redis storage costs |
| **Security** | ✅ Data stays in place | ⚠️ Centralized copy |
| **Cost** | ✅ Free APIs | ⚠️ Storage + embedding costs |
| **Search Quality** | ⚠️ Varies by platform | ✅ Consistent |
| **HubSpot KB** | ❌ Not searchable | ✅ Would be indexed |

**Verdict:** Federated is BETTER for most use cases! 🎉

---

## 💡 Hybrid Approach (Best of Both Worlds)

**Recommendation:** Start with federated, add selective caching

```javascript
async function oracleSearch(userQuery) {
  // 1. Check cache for common queries (optional)
  const cached = await redis.get(`oracle:query:${hash(userQuery)}`);
  if (cached) return JSON.parse(cached);

  // 2. Federated search
  const results = await searchAllSources(userQuery);

  // 3. Aggregate and rank
  const ranked = aggregateResults(results, userQuery);

  // 4. Load content for top 5-7
  const documents = await loadTopDocuments(ranked.slice(0, 7));

  // 5. Cache frequently accessed docs (optional)
  for (const doc of documents) {
    await redis.setex(`oracle:doc:${doc.id}`, 3600, doc.content);
  }

  // 6. Cache query results for 10 minutes
  await redis.setex(`oracle:query:${hash(userQuery)}`, 600, JSON.stringify(documents));

  return documents;
}
```

---

## 🚀 Implementation Steps

### Week 1: Google Drive Search
```javascript
// Implement Google Drive search first (easiest, best search)
async function searchGoogleDrive(query) {
  const searchQuery = `fullText contains '${query}' and '${ORACLE_FOLDER_ID}' in parents`;

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}&fields=files(id,name,mimeType,modifiedTime)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const data = await response.json();
  return data.files;
}

// Test with: "client intake"
// Should return: Client-Intake-Template.docx, Client-Onboarding.pdf, etc.
```

### Week 2: Add Dropbox Search
```javascript
async function searchDropbox(query) {
  const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${dropboxToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: query,
      options: {
        path: '/Granted Consulting',
        max_results: 10
      }
    })
  });

  const data = await response.json();
  return data.matches.map(m => m.metadata.metadata);
}
```

### Week 3: Add HubSpot Search
```javascript
async function searchHubSpot(query) {
  // Search Notes
  const notesResponse = await fetch('https://api.hubapi.com/crm/v3/objects/notes/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: query,
      limit: 5,
      properties: ['hs_note_body', 'hs_timestamp']
    })
  });

  // Could also search: Emails, Tasks, Documents
  return notesResponse.json();
}
```

### Week 4: Aggregation + Ranking
```javascript
// Implement scoring algorithm
// Test with various queries
// Tune ranking weights
// Add citation formatting
```

---

## 🎯 Query Examples

### Example 1: Process Question
**Query:** "What's our client intake process?"

**Google Drive finds:**
- `Strategy/Client-Intake-Template.docx` (score: 8)
- `Processes/Onboarding-Workflow.pdf` (score: 6)

**HubSpot finds:**
- Note: "Updated client intake process - March 2025" (score: 7)
- Email: "RE: New client onboarding checklist" (score: 4)

**Dropbox finds:**
- `Templates/Client-Onboarding-Checklist.xlsx` (score: 5)

**Ranked Results:**
1. Client-Intake-Template.docx (Google, score: 8)
2. "Updated client intake process" note (HubSpot, score: 7)
3. Onboarding-Workflow.pdf (Google, score: 6)
4. Client-Onboarding-Checklist.xlsx (Dropbox, score: 5)

**Oracle Response:**
```
Based on the Client Intake Template (Google Drive) and Sarah's process note
from March 2025 (HubSpot), here's our current client intake process:

1. Initial Discovery Call (use Discovery-Framework.docx)
2. Needs Assessment (complete Intake-Template.docx)
3. Proposal Development (reference Pricing-Guide.xlsx)
...

Sources:
- Client-Intake-Template.docx (Google Drive, Strategy folder)
- "Updated client intake process - March 2025" (HubSpot note by Sarah Chen)
- Onboarding-Workflow.pdf (Google Drive, Processes folder)
```

---

## ✅ Advantages of Federated Approach

1. **No Data Duplication** - Everything stays in source systems
2. **Always Current** - No sync lag, no stale data
3. **Simpler Code** - Just query APIs, no indexing/embeddings
4. **Lower Cost** - Free API usage, no storage costs
5. **Better Security** - Data doesn't leave platforms
6. **Platform Features** - Leverage Google/Dropbox/HubSpot's optimizations
7. **Easy Maintenance** - Teams manage their own platforms
8. **Scalable** - Add new sources easily (Notion, SharePoint, etc.)

---

## ⚠️ Challenges & Solutions

### Challenge 1: HubSpot Knowledge Base Not Searchable
**Solution:**
- Search Notes, Emails, Documents instead
- Export critical KB articles to Google Drive
- Use HubSpot for CRM-specific knowledge (client history, deals)

### Challenge 2: Different Result Formats
**Solution:**
- Normalize all results to common schema:
  ```javascript
  {
    id: string,
    title: string,
    content: string,
    source: 'google' | 'hubspot' | 'dropbox',
    url: string,
    modifiedTime: Date,
    type: string
  }
  ```

### Challenge 3: Rate Limits
**Solution:**
- Cache common queries (10-minute TTL)
- Cache frequently accessed documents (1-hour TTL)
- Implement exponential backoff

### Challenge 4: Varying Search Quality
**Solution:**
- Boost Google Drive results (best search)
- Lower weight for HubSpot results
- Post-process with keyword matching to improve ranking

---

## 🎉 Recommendation

**Use Federated Search Architecture!**

**Phase 1:** Google Drive only (70% of docs are here anyway)
**Phase 2:** Add Dropbox (another 20% of docs)
**Phase 3:** Add HubSpot CRM search (10%, but valuable context)
**Phase 4:** Optional caching layer for performance

**This is simpler, cheaper, more maintainable, and always up-to-date!**

---

**Next Step:** Build the Google Drive federated search first?
