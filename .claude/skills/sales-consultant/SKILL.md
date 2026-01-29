---
name: sales-consultant
description: Sales & Lead Generation Expert - Create, enrich, and qualify sales leads using HubSpot, LinkedIn research, and data quality best practices
triggers:
  - lead generation
  - lead farming
  - linkedin enrichment
  - sales research
  - create leads
  - enrich company
  - find decision makers
  - data quality
  - deduplicate
category: sales
---

# Sales Consultant Skill

**Expert capability for comprehensive lead generation, enrichment, and qualification workflows.**

## When to Use This Skill

Activate this skill when you need to:
- **Create and enrich sales leads** in HubSpot
- **Research companies and decision-makers** using LinkedIn and web sources
- **Qualify prospects** and determine best-fit products
- **Verify lead data quality** and deduplicate records
- **Build comprehensive lead profiles** with complete company information

## Quick Capabilities Overview

### 🌱 Lead Farming (Full Lifecycle)
Research → Create → Enrich → Qualify

Create complete lead records from minimal information:
- Research potential client companies
- Create company and contact records in HubSpot
- Enrich with 12+ priority fields
- Link contacts to companies
- Assign best-fit products

### 🔍 LinkedIn Lead Enrichment (Free)
Extract publicly available data without paid tools:
- Find company pages and extract size, industry, description
- Locate decision-makers by role and company
- Verify current employment and job titles
- Pattern-match email addresses
- Build complete leadership profiles

### 📊 Data Quality & Verification
Maintain clean, accurate CRM data:
- Verify company websites are active
- Find and merge duplicate records
- Identify stale leads for cleanup
- Validate contact information
- Flag incomplete records for enrichment

### 🎯 Advanced HubSpot Operations
Access specialized HubSpot functionality via Python scripts:
- Deal creation and pipeline management
- Task and note creation
- Batch operations for efficiency
- Deal stage updates
- Owner assignment

## Detailed Guides

For comprehensive workflows and best practices, see:

### Core Workflows
- **[LEAD_FARMING.md](./LEAD_FARMING.md)** - Complete lead creation and enrichment process
- **[LINKEDIN_ENRICHMENT.md](./LINKEDIN_ENRICHMENT.md)** - Free LinkedIn research strategies
- **[DATA_QUALITY.md](./DATA_QUALITY.md)** - Verification and deduplication workflows

### Available Scripts
All HubSpot operations available in `./scripts/`:
- `create_deal.py` - Create deals and opportunities
- `create_note.py` - Add notes to records
- `create_task.py` - Create follow-up tasks
- `update_deal_stage.py` - Move deals through pipeline
- `batch_operations.py` - Bulk record updates
- And 11 more specialized operations

## Activation Commands

To load detailed instructions for a specific workflow:

```bash
# Load lead farming complete guide
cat .claude/skills/sales-consultant/LEAD_FARMING.md

# Load LinkedIn enrichment strategies
cat .claude/skills/sales-consultant/LINKEDIN_ENRICHMENT.md

# Load data quality workflows
cat .claude/skills/sales-consultant/DATA_QUALITY.md

# List all available scripts
ls -la .claude/skills/sales-consultant/scripts/
```

## Example Use Cases

### Use Case 1: Create Lead from Scratch
```
User: "I found a potential client called TechStart Inc in Vancouver, they do AI consulting"

Process:
1. Load LEAD_FARMING.md for workflow
2. Research company website and LinkedIn
3. Create company record with 12+ priority fields
4. Find and create decision-maker contacts
5. Link contacts to company
6. Assign best-fit product
7. Create initial outreach task
```

### Use Case 2: Enrich Existing Lead
```
User: "Enrich the HubSpot record for Acme Foods"

Process:
1. Load LEAD_FARMING.md for priority fields
2. Search HubSpot for current data
3. Research: website, business registry, LinkedIn
4. Fill 12 priority enrichment fields
5. Update HubSpot with high-confidence data
6. Flag medium-confidence data for verification
```

### Use Case 3: LinkedIn Research Sprint
```
User: "Find the CFOs at these 5 companies and add them to HubSpot"

Process:
1. Load LINKEDIN_ENRICHMENT.md for search strategies
2. For each company:
   - Find LinkedIn company page
   - Search for CFO profile
   - Extract name, title, location
   - Pattern-match email
3. Create all contacts in HubSpot
4. Link to respective companies
5. Create introduction tasks
```

### Use Case 4: Data Quality Cleanup
```
User: "Find duplicate companies for techstart.io and merge them"

Process:
1. Load DATA_QUALITY.md for deduplication workflow
2. Find duplicate records
3. Compare data completeness
4. Ask user which to keep as primary
5. Merge duplicates
6. Verify associations transferred
```

## Integration with Oracle Agent

When the Oracle agent activates this skill:
- ~100 tokens for skill metadata (always loaded)
- ~5-8K tokens for detailed guides (loaded on-demand via bash)
- 0 tokens for script execution (runs via bash, not loaded into context)

This allows the Oracle to have full sales/lead gen expertise without context bloat.

## Key Concepts

### 12 Priority Enrichment Fields
Every lead enrichment should target these fields:
1. **best_fit_product_company** - Product/service recommendation
2. **industry** - Industry classification
3. **extra6** - Legal business name
4. **annualrevenue** - Annual revenue (dollars)
5. **incorporation_date** - Incorporation date (YYYY-MM-DD)
6. **description** - Company description
7. **city**, **state**, **country** - Location data
8. **domain** - Website domain
9. **numberofemployees** - Company size
10. **linkedin_company_page** - LinkedIn URL

### Confidence Scoring
All enriched data must have confidence levels:
- ✅ **HIGH (90-100%)** - Official sources, populate immediately
- ⚠️ **MEDIUM (60-89%)** - Third-party sources, flag for verification
- ❌ **LOW (0-59%)** - Conflicting/speculative, do not populate

### HubSpot URL Format
Always use modern record URL format:
```
Companies: https://app.hubspot.com/contacts/21088260/record/0-2/[COMPANY_ID]
Contacts: https://app.hubspot.com/contacts/21088260/record/0-1/[CONTACT_ID]
Deals: https://app.hubspot.com/contacts/21088260/record/0-3/[DEAL_ID]
```

## Best Practices

**✅ DO:**
- Search HubSpot first to avoid duplicates
- Try all 4 URL variations (http/https, www/non-www)
- Validate across 2+ sources before updating
- Provide confidence scores for all findings
- Link contacts to companies immediately after creation
- Use pattern matching for email addresses (firstname.lastname@domain.com)

**❌ DON'T:**
- Create leads without checking for duplicates first
- Give up after one WebFetch failure
- Mix high and low confidence data without distinction
- Merge records without user confirmation
- Make rapid-fire LinkedIn requests (rate limiting)

## Skill Metadata

**Token Cost:**
- Metadata: ~100 tokens (this overview)
- LEAD_FARMING.md: ~2,000 tokens
- LINKEDIN_ENRICHMENT.md: ~2,500 tokens
- DATA_QUALITY.md: ~1,500 tokens
- Scripts: 0 tokens (executed via bash)

**Total Context:** ~6,000 tokens when all guides loaded

**Tools Required:**
- WebSearch (company/LinkedIn research)
- WebFetch (website/profile extraction)
- HubSpot tools (create, update, search, associate)
- Bash (script execution)

**Knowledge Base:** None required (self-contained)

---

**Ready to generate and enrich leads like a pro.** Load specific guides as needed for detailed workflows.
