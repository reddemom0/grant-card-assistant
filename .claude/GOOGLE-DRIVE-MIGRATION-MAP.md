# Google Drive → .claude/ Migration Mapping

This document tracks the migration of knowledge base content from Google Drive to the `.claude/` directory structure for the Anthropic Agent SDK.

## Migration Status: Phase 1 Complete ✅

**Last Updated:** 2025-10-08

---

## Migration Overview

### Current Architecture (Google Drive-based)
- **Location:** Google Drive folders organized by agent type
- **Access Method:** Service Account API (25-50 API calls per knowledge load)
- **Performance:** 5-6 second cold start latency
- **Storage:** Remote, requires network calls
- **Configuration:** `AGENT_FOLDER_MAP` in `api/server.js` (lines 395-403)

### Target Architecture (Agent SDK)
- **Location:** `.claude/` directory in Git repository
- **Access Method:** Direct file system reads (via `settingSources: ['project']`)
- **Performance:** Instant access, cached by Agent SDK
- **Storage:** Local, version-controlled
- **Configuration:** Agent-specific `.md` files + shared `CLAUDE.md`

---

## Agent Migration Roadmap

### ✅ Phase 1: Grant Card Agent (COMPLETE)

**Google Drive Source:**
- Folder: `grant-cards/` (within main knowledge base folder)
- Files: 48 documents (5 MD, 30 PDF, 13 DOCX)
- Export Date: 2025-10-08
- Export Location: `/Users/Chris/grant-card-assistant/migration-exports/grant-card/`

**Migration Target:**
- `.claude/agents/grant-card.md` ✅ Created
- Consolidated all 6 workflows into single comprehensive file
- 1,413 lines covering:
  - 6 specialized workflows (criteria, preview, requirements, insights, categories, missing info)
  - 6 grant type templates (hiring, market expansion, training, R&D, investment, loan)
  - Quality checklists and common mistakes
  - Workflow tips and best practices

**Source Files Processed:**
1. `grant_criteria_formatter.md` → Workflow 1 ✅
2. `preview_section_generator.md` → Workflow 2 ✅
3. `general_requirements_creator.md` → Workflow 3 ✅
4. `granted_insights_generator.md` → Workflow 4 ✅
5. `missing_info_generator.md` → Workflow 6 ✅
6. `categories_tags_classifier.md.docx` → Workflow 5 ✅
7. 6 template DOCX files → Grant Card Templates section ✅
8. Example files (30 PDFs, 7 DOCX) → Workflow examples integrated ✅

### ⏳ Phase 2: ETG Writer Agent (PENDING)

**Google Drive Source:**
- Folder: `etg/` (ETG business case documents)
- Estimated Files: Unknown (requires export)
- Export Date: TBD

**Migration Target:**
- `.claude/agents/etg-writer.md` (to be created)

**Current Code References:**
- System Prompt: `api/server.js` lines 896-928
- Document Selection: `selectETGDocuments()` lines 2307-2401
- Conversation Limit: 40 messages (lines 72-80)

### ⏳ Phase 3: BCAFE Writer Agent (PENDING)

**Google Drive Source:**
- Folder: `bcafe/` (BC Agriculture and Food Export Program)
- Estimated Files: Unknown (requires export)
- Export Date: TBD

**Migration Target:**
- `.claude/agents/bcafe-writer.md` (to be created)

**Current Code References:**
- System Prompt: `api/server.js` lines 930-959
- Document Selection: `selectBCAFEDocuments()` lines 2404-2493
- Conversation Limit: 40 messages (lines 72-80)

### ⏳ Phase 4: CanExport Claims Agent (PENDING)

**Google Drive Source:**
- Folder: `canexport-claims/` (Claims auditing documents)
- Estimated Files: Unknown (requires export)
- Export Date: TBD

**Migration Target:**
- `.claude/agents/canexport-claims.md` (to be created)

**Current Code References:**
- System Prompt: `api/server.js` lines 961-1006
- Document Selection: Smart selection based on conversation context
- Conversation Limit: 50 messages (lines 72-80)

### 📋 Phase 5: Future Agents (PLANNED)

**Not Yet Implemented (placeholders in current system):**

1. **CanExport Writer Agent**
   - Folder: `canexport/`
   - Target: `.claude/agents/canexport-writer.md`
   - Status: Not yet developed

2. **Readiness Strategist Agent**
   - Folder: `readiness-strategist/`
   - Target: `.claude/agents/readiness-strategist.md`
   - Status: Not yet developed

3. **Internal Oracle Agent**
   - Folder: `internal-oracle/`
   - Target: `.claude/agents/internal-oracle.md`
   - Status: Not yet developed

---

## File Structure Mapping

### Current Google Drive Structure
```
Main Knowledge Base Folder (GOOGLE_DRIVE_FOLDER_ID)
├── grant-cards/ ✅ MIGRATED
│   ├── grant_criteria_formatter.md
│   ├── preview_section_generator.md
│   ├── general_requirements_creator.md
│   ├── granted_insights_generator.md
│   ├── missing_info_generator.md
│   ├── categories_tags_classifier.md.docx
│   ├── [6 template DOCX files]
│   └── [30 example PDF files]
│
├── etg/ ⏳ PENDING
│   └── [ETG knowledge base documents]
│
├── bcafe/ ⏳ PENDING
│   └── [BCAFE knowledge base documents]
│
├── canexport-claims/ ⏳ PENDING
│   └── [CanExport claims documents]
│
├── canexport/ 📋 PLANNED
│   └── [CanExport writer documents]
│
├── readiness-strategist/ 📋 PLANNED
│   └── [Readiness strategist documents]
│
└── internal-oracle/ 📋 PLANNED
    └── [Internal oracle documents]
```

### Target .claude/ Structure
```
.claude/
├── CLAUDE.md ✅ CREATED
│   └── Shared knowledge for ALL agents
│       ├── Company Information (Granted Consulting)
│       ├── Universal Writing Guidelines
│       ├── Shared Best Practices
│       └── Agent-specific file references
│
├── agents/ ✅ CREATED
│   ├── grant-card.md ✅ COMPLETE (1,413 lines)
│   ├── etg-writer.md ⏳ PENDING
│   ├── bcafe-writer.md ⏳ PENDING
│   ├── canexport-claims.md ⏳ PENDING
│   ├── canexport-writer.md 📋 PLANNED
│   ├── readiness-strategist.md 📋 PLANNED
│   └── internal-oracle.md 📋 PLANNED
│
└── commands/ ✅ CREATED (empty, for future slash commands)
```

---

## Migration Methodology

### Export Process (Manual Option A - Selected)

1. **Export from Google Drive**
   - User manually downloads folder as ZIP
   - Supports: .md, .pdf, .docx formats
   - Maintains folder structure

2. **Extract to Local Directory**
   - Location: `/Users/Chris/grant-card-assistant/migration-exports/[agent-name]/`
   - Preserves all file types

3. **Read and Parse Files**
   - Markdown: Direct read with Read tool
   - PDF: Direct read with Read tool (text extraction)
   - DOCX: Convert using macOS `textutil -convert txt -stdout [file]`

4. **Consolidate into Single Agent File**
   - Organize by workflow/section
   - Include templates and examples
   - Add quality checklists
   - Document best practices

5. **Create Agent-Specific .md File**
   - Location: `.claude/agents/[agent-name].md`
   - Comprehensive single-file knowledge base
   - Follows Agent SDK best practices

### File Conversion Methods

**DOCX Files:**
```bash
textutil -convert txt -stdout "/path/to/file.docx"
```
- Extracts plain text from Microsoft Word documents
- Preserves structure and formatting as much as possible
- macOS built-in utility, no additional dependencies

**PDF Files:**
- Read tool supports direct PDF reading
- Extracts text content automatically
- Handles multi-page documents

**Markdown Files:**
- Direct read with Read tool
- No conversion needed

---

## Code Migration Checklist

### Backend Changes Required (api/server.js)

**Phase 1: Dual-mode operation (backward compatible)**
- [ ] Keep Google Drive loading as fallback
- [ ] Add Agent SDK integration alongside existing system
- [ ] Test both knowledge sources in parallel
- [ ] Verify Agent SDK `settingSources: ['project']` configuration

**Phase 2: Agent SDK primary (hybrid)**
- [ ] Switch Grant Card agent to Agent SDK
- [ ] Keep other agents on Google Drive
- [ ] Monitor performance and accuracy
- [ ] Collect feedback

**Phase 3: Full migration (Google Drive deprecated)**
- [ ] Migrate all agents to Agent SDK
- [ ] Remove Google Drive code (lines 2789-3021)
- [ ] Remove `loadKnowledgeBaseFromGoogleDrive()` function
- [ ] Remove `loadAgentDocuments()` function
- [ ] Remove `AGENT_FOLDER_MAP` constant
- [ ] Archive Service Account credentials
- [ ] Update environment variables documentation

### Frontend Changes Required
- [ ] No changes required (UI remains the same)
- [ ] Agent interactions unchanged from user perspective

### Configuration Changes
- [ ] Add `settingSources: ['project']` to Agent SDK initialization
- [ ] Update system prompts to reference `.claude/` files
- [ ] Configure agent-specific knowledge loading from `.claude/agents/`

---

## Performance Comparison

### Google Drive-based System
- **Cold start:** 5-6 seconds
- **API calls per load:** 25-50 requests
- **Network dependency:** Required for every knowledge load
- **Caching:** Redis-based, 24-hour TTL
- **Cost:** Google Drive API quota consumption

### Agent SDK-based System
- **Cold start:** < 1 second (local file access)
- **API calls per load:** 0 (file system reads)
- **Network dependency:** None (Git-based)
- **Caching:** Automatic prompt caching (50-75% cost reduction)
- **Cost:** Reduced Claude API costs via prompt caching

**Expected Improvements:**
- 5-6x faster knowledge loading
- Zero external API dependencies
- Automatic cost optimization via prompt caching
- Version-controlled knowledge base
- Simpler deployment (no Service Account setup)

---

## Rollback Plan

If migration causes issues, rollback is straightforward:

1. **Keep Google Drive code intact during migration**
   - Don't delete existing functions until all agents migrated
   - Maintain Service Account credentials

2. **Feature flag for Agent SDK**
   - Add `USE_AGENT_SDK` environment variable
   - Default to `false` for safety
   - Switch agents individually

3. **Rollback procedure**
   - Set `USE_AGENT_SDK=false`
   - Redeploy previous version
   - Knowledge loading reverts to Google Drive
   - No data loss (Google Drive unchanged)

---

## Next Steps

### Immediate (Week 1)
1. ✅ Complete Grant Card migration
2. ⏳ Create Google Drive mapping document (this file)
3. ⏳ Commit `.claude/` structure to `agent-sdk-migration` branch
4. Test Agent SDK locally with Grant Card agent
5. Validate all 6 workflows function correctly

### Short-term (Week 2)
1. Export ETG knowledge from Google Drive
2. Consolidate into `.claude/agents/etg-writer.md`
3. Export BCAFE knowledge from Google Drive
4. Consolidate into `.claude/agents/bcafe-writer.md`
5. Export CanExport Claims knowledge
6. Consolidate into `.claude/agents/canexport-claims.md`

### Medium-term (Week 3)
1. Integrate Agent SDK into backend
2. Test dual-mode operation
3. Deploy to Vercel preview environment
4. Validate performance improvements
5. Collect user feedback

### Long-term (Weeks 4-6)
1. Complete migration of all existing agents
2. Deprecate Google Drive loading
3. Remove legacy code
4. Document new architecture
5. Train team on `.claude/` system

---

## Migration Benefits Summary

**Technical Benefits:**
- 5-6x faster knowledge loading (< 1s vs 5-6s)
- Zero external API dependencies
- Automatic prompt caching (50-75% cost savings)
- Version-controlled knowledge base
- Simpler deployment (no Service Account)

**Operational Benefits:**
- Easier knowledge updates (Git workflow)
- Better change tracking (Git history)
- Collaborative editing (Pull requests)
- No API quota concerns
- Reduced infrastructure complexity

**Development Benefits:**
- Faster iteration on agent knowledge
- Local testing without API calls
- Clear knowledge organization
- Built-in Agent SDK tools
- Standardized agent structure

---

**Migration Progress:** 1/4 agents complete (Grant Card ✅)
**Next Milestone:** Export and consolidate ETG agent knowledge
