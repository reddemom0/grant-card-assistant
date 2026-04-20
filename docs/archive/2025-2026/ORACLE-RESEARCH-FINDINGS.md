# Granted Oracle - Research Findings
**Date:** December 9, 2025
**Research Question:** How do similar-sized companies (10-15 people) handle internal knowledge bases and AI search?

---

## 🔍 Key Findings

### 1. Google Drive Shortcuts Approach ✅

**What we learned:**
- Google Drive's "Add shortcut" feature is EXACTLY the right approach
- It allows files to appear in multiple folders without duplication
- Files stay in their original location (single source of truth)
- Updates automatically reflected everywhere
- This is a standard best practice for knowledge organization

**Third-party tools that do this:**
- **Fulcrum.wiki** - Specifically designed to turn Google Drive into a searchable knowledge base using links and tags
- **Spaceli** - Creates knowledge base from existing Google Docs/folders in clicks
- **Tettra** - Integrates with Google Drive to create central knowledge repository

**Our advantage:** We're building custom AI on top of Drive, which gives us more flexibility than these tools!

---

### 2. Document Selection Strategies (RAG Best Practices)

**Industry standard approaches for RAG systems:**

**Option A: Semantic Search + Top-K Retrieval (Most Common)**
- Embed all document chunks
- When query comes in, find the K most similar chunks
- Typically K = 3-5 documents
- **Pro:** Simple, proven, effective
- **Con:** Requires embedding all documents upfront

**Option B: Re-Ranking (Advanced)**
- First pass: Retrieve 10-20 candidate documents
- Second pass: Re-rank by relevance
- Final: Return top 3-5
- **Pro:** Better accuracy
- **Con:** More complex, slower

**Option C: Diversity Ranking**
- Retrieve documents but maximize diversity
- Prevents all documents being too similar
- **Pro:** Better coverage of topic
- **Con:** May include less-relevant docs

**Option D: Context Layout Optimization**
- Place most relevant chunks at beginning and end of context
- Avoids "lost in the middle" problem
- **Pro:** Better LLM performance
- **Con:** Requires careful chunk ordering

**Recommendation for small teams:** Start with **Option A** (Semantic Search + Top-K). It's proven, simple, and works well for 50-200 documents.

---

### 3. How Similar-Sized Teams Organize Knowledge

**Popular solutions for 10-15 person teams:**

| Tool | Cost | Best For | Key Features |
|------|------|----------|--------------|
| **Notion** | $10/user/mo | Flexible teams | All-in-one, highly customizable |
| **Confluence** | $5/user/mo | Structured teams | Enterprise features, affordable |
| **Nuclino** | $6/user/mo | Simple workflows | Easy collaboration, minimal setup |
| **Slite** | $8/user/mo | Small teams | Purpose-built for <20 people |
| **BookStack** | Free (self-host) | Technical teams | Open-source, simple wiki |
| **Docmost** | Free (self-host) | Tech-savvy teams | Open-source Notion/Confluence alternative |

**Common patterns we saw:**
1. **Department-based folders** (like you're planning)
2. **Tag/metadata systems** for cross-referencing
3. **Search-first interfaces** rather than navigation
4. **Template standardization** for common doc types
5. **Regular maintenance schedules** (quarterly reviews)

---

### 4. Google Drive Limitations & Workarounds

**Limitations:**
- ❌ No built-in tagging system (only folders/shortcuts)
- ❌ Search is basic (no semantic search)
- ❌ No automatic categorization
- ❌ No AI-powered recommendations

**Why companies leave Google Drive:**
- Lacks advanced knowledge management features
- Gets messy as content grows
- Hard to find things across departments
- No ownership/maintenance workflows

**Why you're in a GOOD position:**
- ✅ You're adding AI search layer on top
- ✅ Custom agent can understand context
- ✅ Department structure keeps things organized
- ✅ Shortcuts solve the "single source of truth" problem

---

## 💡 Recommendations Based on Research

### Recommendation #1: Use Department + Type Hybrid Structure

Instead of just departments OR types, use BOTH:

```
Internal Oracle Knowledge Base/
├── Writers/
│   ├── Templates/
│   ├── Examples/
│   ├── Style-Guides/
│   └── Processes/
├── Strategy/
│   ├── Templates/
│   ├── Frameworks/
│   ├── Processes/
│   └── Case-Studies/
├── Research/
│   ├── Databases/
│   ├── Methodologies/
│   ├── Funder-Profiles/
│   └── Processes/
└── Grant-Consultants/
    ├── Templates/
    ├── Case-Studies/
    ├── Playbooks/
    └── Processes/
```

**Why:** Makes it easier for AI to find "Strategy templates" vs "Writer templates"

---

### Recommendation #2: Start with Simple Department-Based Selection

For your first version (MVP):

```javascript
function selectOracleDocuments(userQuery, conversationHistory) {
  const query = userQuery.toLowerCase();

  // Detect department keywords
  const departments = {
    writers: ['write', 'writing', 'template', 'draft', 'style', 'narrative'],
    strategy: ['client', 'intake', 'discovery', 'readiness', 'pricing', 'proposal'],
    research: ['grant program', 'eligibility', 'funder', 'deadline', 'research'],
    consultants: ['case study', 'consultation', 'client success', 'problem']
  };

  // Find matching departments
  const matches = [];
  for (const [dept, keywords] of Object.entries(departments)) {
    if (keywords.some(kw => query.includes(kw))) {
      matches.push(dept);
    }
  }

  // Load documents from matching departments
  // If no match, load from all departments
  // Limit to 5-7 documents total
}
```

**Why:** Simple, fast, good enough for 95% of queries

---

### Recommendation #3: Add Document Type as Secondary Filter

Within each department folder, organize by type:
1. **Templates** - Reusable documents
2. **Examples** - Real-world samples
3. **Processes** - How-to guides, SOPs
4. **References** - Best practices, guides
5. **Data** - Databases, spreadsheets

This lets your AI do:
- Department detection (Strategy, Research, etc.)
- Type detection (Template, Example, etc.)
- Load only relevant subset

---

### Recommendation #4: Use Naming Conventions

Based on research, standardize file names:

**Format:** `[Department]-[Type]-[Name]-[Date].ext`

**Examples:**
- `Writers-Template-ETG-Business-Case-2024.docx`
- `Strategy-Process-Client-Intake-Workflow-2025.md`
- `Research-Database-BC-Grant-Programs-2025.csv`
- `Consultants-CaseStudy-Tech-Sector-Export-2024.pdf`

**Why:** Makes it easier for AI to understand document purpose before even opening it

---

## 🎯 Proposed Architecture (Based on Research)

### Storage Layer
```
Google Drive: Internal Oracle Knowledge Base/
├── [Department folders with shortcuts]
└── [Organized by department + type]
```

### Access Layer
- Current system: Google Drive API (already working in your codebase)
- Load on startup or cache in Redis
- Parse all document types (PDF, DOCX, Google Docs, Markdown)

### Selection Layer
```javascript
// Stage 1: Department Detection
- Analyze user query
- Match to 1-2 departments
- Load only those department folders

// Stage 2: Document Type Detection (optional)
- Is user looking for template, example, or process?
- Further filter within department

// Stage 3: Top-K Selection
- If still >5 documents, use keyword matching
- Return 3-5 most relevant
```

### Response Layer
- Build system prompt with selected documents
- Include document source in response (for citations)
- Stream response like your other agents

---

## 📊 Comparison: Build vs Buy

| Option | Cost | Pros | Cons | Recommendation |
|--------|------|------|------|----------------|
| **Build Custom (Your Plan)** | Dev time only | Full control, integrated with existing system, exactly what you need | Requires maintenance | ✅ **BEST CHOICE** |
| **Fulcrum.wiki** | ~$99/mo | Pre-built, nice UI | Another tool to manage, less flexible | Skip |
| **Tettra** | ~$100/mo | Purpose-built for teams | Not customizable, another login | Skip |
| **Notion/Confluence** | ~$120/mo | Full-featured | Migration headache, doesn't integrate with your agents | Skip |

**Verdict:** Your custom solution is the right approach because:
1. You already have the infrastructure (server.js, Google Drive API, Claude API)
2. Integrates seamlessly with existing agents
3. Full customization for your team's specific needs
4. No additional tool licensing costs

---

## ✅ Final Recommendations

### Architecture Decision
**Use Department-Based Selection with Type Subfolders**

```
Internal Oracle Knowledge Base/
├── Writers/
│   ├── Templates/
│   ├── Examples/
│   ├── Guides/
├── Strategy/
│   ├── Templates/
│   ├── Frameworks/
│   ├── Case-Studies/
├── Research/
│   ├── Databases/
│   ├── Funder-Info/
│   ├── Methodologies/
└── Grant-Consultants/
    ├── Templates/
    ├── Case-Studies/
    ├── Playbooks/
```

### Document Selection Strategy
**Start simple, optimize later:**
1. **V1 (MVP):** Department keyword matching → Load that department's docs (all of them if <20 docs)
2. **V2:** Add document type detection → Further filter by Templates/Examples/etc
3. **V3:** Add semantic search/embeddings if needed (only if V1/V2 aren't good enough)

### Team Instructions
1. Create folder structure above
2. Each team adds shortcuts (not moves!) to their key documents
3. Follow naming convention: `[Dept]-[Type]-[Name].ext`
4. Organize into Type subfolders
5. You build the selection logic to match

---

**Next Step:** Create the folder structure and department assignment document?
