# Oracle Sales Enhancement - Gap Analysis
**Current State vs. Sales Director Requirements**
**Date:** January 20, 2026

---

## CURRENT ORACLE CAPABILITIES

### ✅ **What Oracle CAN Do Today**

#### **1. HubSpot Integration (LIMITED)**
Current tool: `hubspot_query`
- ✅ Search contacts by name/email
- ✅ Get deal information by ID
- ✅ Get company details
- ✅ Get recent activities

**Limitations:**
- **NO lead filtering** (can't search "BC manufacturing companies")
- **NO bulk operations** (can't update multiple leads)
- **NO property updates** (can't enrich data back to HubSpot)
- **NO lead scoring** capabilities
- **NO segmentation** features
- **NO activity monitoring** (no alerts for website visits, email opens)

#### **2. Knowledge Base Access**
- ✅ Search Google Drive (all company docs)
- ✅ Read Google Drive files
- ✅ Search Dropbox (3,861+ files indexed)
- ✅ Read Dropbox files
- ✅ Create Google Docs
- ✅ Create Google Sheets

#### **3. Grant Database**
- ✅ Search GetGranted (188+ Canadian grants)
- ✅ Filter by purpose, region, industry
- ✅ Match grants to client criteria

#### **4. Market Intelligence**
- ✅ VisualPing alerts (grant program changes)
- ✅ Web search
- ✅ Web fetch (scrape grant pages)

#### **5. Document Creation**
- ✅ Create advanced budgets (Google Sheets)
- ✅ Create readiness assessments (Google Docs)
- ✅ Create interview questions
- ✅ Create evaluation rubrics

---

## ❌ WHAT ORACLE CANNOT DO (Sales Director Requirements)

### **Category 1: Verify/Enrich Leads on HubSpot**

| Task | Current Status | Gap |
|------|----------------|-----|
| **1.1 Verify active leads** | ❌ Cannot | No business registry integration, no website checking, no LinkedIn verification |
| **1.2 Fill missing info** | ❌ Cannot | No email finding (Hunter.io), no phone lookup, no enrichment APIs |
| **1.3 Flag outdated contacts** | ❌ Cannot | Can query activities but cannot flag/update properties in HubSpot |
| **1.4 Deduplicate leads** | ❌ Cannot | No fuzzy matching, no bulk operations, no merge capability |
| **1.5 Standardize data** | ❌ Cannot | No normalization rules, no bulk update capability |

---

### **Category 2: Scoring/Prioritizing Leads**

| Task | Current Status | Gap |
|------|----------------|-----|
| **2.1 Predict high-value leads** | ❌ Cannot | No scoring algorithm, no ICP matching, no property updates |
| **2.2 Segment leads** | ❌ Cannot | Can query but cannot create HubSpot lists, no automatic tagging |
| **2.3 Activity alerts** | ❌ Cannot | No webhook/workflow integration, no Slack alerts, no real-time monitoring |

---

### **Category 3: Lead Research**

| Task | Current Status | Gap |
|------|----------------|-----|
| **3.1 Suggest new leads** | ⚠️ Partial | Can search web but no business directory APIs, no structured lookalike matching |
| **3.2 Find decision-makers** | ⚠️ Partial | Can search LinkedIn manually but no automated contact finding |
| **3.3 Enrich with public info** | ⚠️ Partial | Can web search but no structured enrichment (revenue, funding, news) |
| **3.4 Internal knowledge mining** | ✅ CAN DO | Has full Dropbox/Drive search - just needs systematic approach |

---

### **Category 4: Automation/Workflows on HubSpot**

| Task | Current Status | Gap |
|------|----------------|-----|
| **4.1 Auto-update CRM** | ❌ Cannot | No bulk update capability, no property write access |
| **4.2 Weekly/daily scrub** | ⚠️ Partial | Has search capability but no scheduled execution, no bulk updates |
| **4.3 Generate reports** | ⚠️ Partial | Can query data but no formatted report generation, no email delivery |

---

### **Category 5: Outreach or Insights**

| Task | Current Status | Gap |
|------|----------------|-----|
| **5.1 Draft personalized messages** | ✅ CAN DO | Already has HubSpot context + internal docs + Claude writing capability |
| **5.2 Track engagement patterns** | ❌ Cannot | No analytics on email/call performance, no pattern detection |
| **5.3 Competitive insights** | ⚠️ Partial | Can web search but no LinkedIn monitoring, no job board tracking |

---

### **Category 6: Other (Advanced Capabilities)**

| Task | Current Status | Gap |
|------|----------------|-----|
| **6.1 Knowledge-augmented queries** | ⚠️ **CLOSE!** | Can search HubSpot but limited filtering - needs enhanced search tool |
| **6.2 Cross-source insights** | ✅ **CAN DO** | Already combines HubSpot + Dropbox + Drive + GetGranted |
| **6.3 Predict churn/inactivity** | ❌ Cannot | No predictive model, no engagement trend analysis |
| **6.4 Opportunity scoring for GG2.0** | ⚠️ Partial | Can query GetGranted usage but no scoring algorithm |

---

## 🔧 REQUIRED NEW TOOLS/CAPABILITIES

### **Priority 1: Enhanced HubSpot Tools (CRITICAL)**

#### **Tool: `search_hubspot_leads`**
```javascript
{
  name: 'search_hubspot_leads',
  description: 'Advanced search of HubSpot leads with multi-criteria filtering',
  input_schema: {
    filters: {
      industry: string,
      location: string,
      employee_count_min: number,
      employee_count_max: number,
      last_activity_days: number,
      lead_score_min: number,
      lifecycle_stage: string,
      grant_eligibility: string[] // e.g., ['ETG', 'CanExport']
    },
    sort: string, // 'score', 'last_activity', 'created_date'
    limit: number
  }
}
```

#### **Tool: `enrich_hubspot_lead`**
```javascript
{
  name: 'enrich_hubspot_lead',
  description: 'Enrich a HubSpot contact/company with data from multiple sources',
  input_schema: {
    contact_id: string,
    sources: string[], // ['linkedin', 'hunter_io', 'clearbit', 'internal_docs']
    auto_update: boolean, // Write back to HubSpot?
    fields_to_enrich: string[] // ['email', 'phone', 'employee_count', etc.]
  }
}
```

#### **Tool: `update_hubspot_properties`**
```javascript
{
  name: 'update_hubspot_properties',
  description: 'Update HubSpot contact/company properties (single or bulk)',
  input_schema: {
    record_type: 'contact' | 'company',
    record_ids: string[], // Array for bulk updates
    properties: object, // { property_name: value }
    create_note: boolean // Add audit trail note
  }
}
```

#### **Tool: `create_hubspot_list`**
```javascript
{
  name: 'create_hubspot_list',
  description: 'Create a static or dynamic HubSpot list from search criteria',
  input_schema: {
    list_name: string,
    list_type: 'static' | 'dynamic',
    criteria: object, // Same as search_hubspot_leads filters
    description: string
  }
}
```

---

### **Priority 2: Third-Party Enrichment Integrations**

#### **Tool: `find_email_addresses`**
```javascript
{
  name: 'find_email_addresses',
  description: 'Find email addresses for contacts using Hunter.io or similar',
  input_schema: {
    first_name: string,
    last_name: string,
    company_domain: string,
    company_name: string
  }
}
```

#### **Tool: `enrich_company_data`**
```javascript
{
  name: 'enrich_company_data',
  description: 'Get company data (revenue, employees, industry) from Clearbit/ZoomInfo',
  input_schema: {
    company_name: string,
    domain: string,
    data_points: string[] // ['revenue', 'employee_count', 'industry', 'funding']
  }
}
```

#### **Tool: `verify_business_status`**
```javascript
{
  name: 'verify_business_status',
  description: 'Check if business is still operating (website, registry, LinkedIn)',
  input_schema: {
    company_name: string,
    website: string,
    province: string // For business registry lookup
  }
}
```

---

### **Priority 3: Lead Scoring & Segmentation**

#### **Tool: `calculate_lead_score`**
```javascript
{
  name: 'calculate_lead_score',
  description: 'Calculate lead score based on ICP fit and engagement',
  input_schema: {
    contact_id: string,
    scoring_model: 'default' | 'etg' | 'canexport' | 'custom',
    update_hubspot: boolean
  }
}
```

#### **Tool: `segment_leads_batch`**
```javascript
{
  name: 'segment_leads_batch',
  description: 'Segment multiple leads and tag/update in HubSpot',
  input_schema: {
    lead_ids: string[],
    segmentation_criteria: {
      engagement_level: boolean,
      grant_fit: boolean,
      geography: boolean,
      industry: boolean
    },
    create_lists: boolean, // Auto-create HubSpot lists per segment
    update_properties: boolean // Tag leads with segment names
  }
}
```

---

### **Priority 4: Automation & Scheduling**

#### **Tool: `schedule_lead_scrub`** (Backend cron job)
- Daily: Flag stale leads, check new activity
- Weekly: Enrich missing data, verify business status
- Monthly: Deep enrichment, lookalike lead generation

#### **Tool: `generate_sales_report`**
```javascript
{
  name: 'generate_sales_report',
  description: 'Generate formatted sales intelligence report',
  input_schema: {
    report_type: 'daily_digest' | 'weekly_summary' | 'monthly_executive',
    delivery: 'email' | 'slack' | 'google_doc',
    recipients: string[]
  }
}
```

---

### **Priority 5: Predictive Analytics**

#### **Tool: `predict_lead_churn`**
```javascript
{
  name: 'predict_lead_churn',
  description: 'Predict which leads are likely to go cold',
  input_schema: {
    lead_ids: string[],
    risk_threshold: number, // 0.0 - 1.0 (probability of churn)
    create_tasks: boolean // Create re-engagement tasks for high-risk leads
  }
}
```

---

## 🚀 IMPLEMENTATION ROADMAP

### **Phase 1: Critical HubSpot Tools (2-3 weeks)**
**Goal:** Enable Oracle to answer sales director's questions about leads

**New Tools:**
1. ✅ `search_hubspot_leads` - Advanced filtering
2. ✅ `update_hubspot_properties` - Write data back
3. ✅ `create_hubspot_list` - Auto-segmentation

**Deliverable:** Oracle can answer queries like:
- "Show me BC manufacturing leads with 50-200 employees not contacted in 3 months"
- "Create a list of warm leads in food industry eligible for BCAFE"
- "Update all stale leads with 'needs re-engagement' tag"

**Example Interaction:**
```
User: "Show me BC food companies with 50-150 employees we haven't contacted in 90 days"

Oracle:
🔍 Searching HubSpot...

Found 23 leads matching criteria:

HIGH PRIORITY (Warm → Stale):
1. Valley Fresh Produce - Abbotsford, BC
   - 87 employees | Last contact: 94 days ago
   - Previous interest: ETG training grant
   - Grant fit: ETG ✓, BCAFE ✓

2. Acme Foods Ltd - Surrey, BC
   - 134 employees | Last contact: 102 days ago
   - Previous interest: CanExport
   - Grant fit: CanExport ✓, BCAFE ✓

[21 more results...]

Would you like me to:
- Create a HubSpot list of these leads?
- Draft re-engagement emails?
- Flag them for strategy team follow-up?
```

---

### **Phase 2: Data Enrichment (3-4 weeks)**
**Goal:** Auto-fill missing lead data

**New Tools:**
1. ✅ `enrich_hubspot_lead` - Master enrichment orchestrator
2. ✅ `find_email_addresses` - Hunter.io integration
3. ✅ `enrich_company_data` - Clearbit/similar integration
4. ✅ `verify_business_status` - Business registry + website check

**Integration APIs Needed:**
- Hunter.io ($49-99/month)
- Clearbit or ZoomInfo alternative ($99-499/month)
- BC Business Registry API (free/low-cost)
- LinkedIn via Proxycurl ($500-1,000/month)

**Deliverable:**
- Click one button: "Enrich this lead" → Oracle fills all missing data
- Automated weekly scrub enriches new leads

---

### **Phase 3: Lead Scoring & Segmentation (2 weeks)**
**Goal:** Intelligent lead prioritization

**New Tools:**
1. ✅ `calculate_lead_score` - ICP matching + engagement scoring
2. ✅ `segment_leads_batch` - Auto-tag and list creation

**Deliverable:**
- Every lead gets 0-100 score automatically
- Hot/Warm/Cold/Dead segments created in HubSpot
- Grant-fit tags applied (ETG-eligible, CanExport-eligible, etc.)

---

### **Phase 4: Automation & Reports (2 weeks)**
**Goal:** Self-maintaining CRM

**Implementation:**
1. ✅ Daily cron: Flag stale leads, check activity
2. ✅ Weekly cron: Enrich new leads, verify status
3. ✅ `generate_sales_report` - Auto-generated digests

**Deliverable:**
- Sales director gets Monday email: Weekly pipeline health
- Strategy team gets daily Slack alert: Hot leads to follow up
- CRM stays fresh automatically

---

### **Phase 5: Predictive & Advanced (3-4 weeks)**
**Goal:** Anticipate needs and threats

**New Tools:**
1. ✅ `predict_lead_churn` - ML-based churn detection
2. ✅ `find_lookalike_leads` - Prospecting automation
3. ✅ `track_competitive_signals` - Monitor competitors

**Deliverable:**
- Oracle predicts which warm leads will go cold (14-day advance warning)
- Oracle suggests 50 new prospects per month (lookalike to top clients)
- Oracle alerts when lead engages with competitor

---

## 📊 EFFORT ESTIMATE

| Phase | New Tools | Effort | Dependencies |
|-------|-----------|--------|--------------|
| **Phase 1** | 3 HubSpot tools | **2-3 weeks** | HubSpot API only |
| **Phase 2** | 4 enrichment tools | **3-4 weeks** | Hunter.io, Clearbit, Proxycurl APIs |
| **Phase 3** | 2 scoring tools | **2 weeks** | Historical HubSpot data, ICP definition |
| **Phase 4** | 2 automation tools | **2 weeks** | Railway cron, email/Slack APIs |
| **Phase 5** | 3 predictive tools | **3-4 weeks** | ML model, LinkedIn monitoring |

**Total:** ~12-17 weeks (3-4 months) for full implementation

---

## 💰 COST ESTIMATE

### **Phase 1:** ~$0-50/month (HubSpot API included)
### **Phase 2:** ~$650-1,600/month
- Hunter.io: $49-99/month
- Clearbit alt: $99-499/month
- Proxycurl (LinkedIn): $500-1,000/month

### **Phase 3-5:** ~$50-200/month (infrastructure, monitoring)

**Total Monthly Cost at Scale:** ~$700-1,850/month

---

## 🎯 QUICK WINS (Can Build This Week)

### **1. Internal Knowledge Mining for Leads (2 days)**
Oracle already has Dropbox/Drive search. Just need to add systematic extraction:

```
User: "Find all companies mentioned in our proposals from the last 6 months"

Oracle:
🔍 Searching /Proposals folder...

Found 47 companies mentioned:

COMPETITORS (mentioned in competitive analysis):
- GrantMatch (12 mentions)
- FundingPortal (8 mentions)

PARTNERS (mentioned as collaborators):
- Innovation BC (5 mentions)
- Trade Commissioners (3 mentions)

PROSPECTS (mentioned but not clients):
- TechCorp Industries (2 mentions in declined proposals)
- Valley Manufacturing (1 mention in partnership discussions)

Would you like me to:
- Add these to HubSpot as leads?
- Create contact research profiles?
```

### **2. Basic Lead Search Enhancement (3 days)**
Expand current `hubspot_query` to support filtering:

```
User: "Show me all BC companies in food industry"

Oracle:
[Queries HubSpot with industry filter + location filter]

Found 34 companies:

HOT PROSPECTS (recent activity):
- Valley Fresh Produce - Last contact: 5 days ago
- ...

WARM LEADS (engaged 30-90 days):
- ...

COLD (no activity 90+ days):
- ...
```

### **3. Lead Profile Generator (1 day)**
Combine all existing sources:

```
User: "Generate full profile for Acme Foods"

Oracle:
## 360° Profile: Acme Foods Ltd

**From HubSpot:**
- Contact: John Smith (CFO)
- Deal stage: Discovery
- Last activity: 23 days ago

**From Dropbox:**
- Past proposal: ETG 2024 (not submitted)
- Meeting notes: Interested in wage subsidies

**From GetGranted:**
- Eligible grants: ETG, BCAFE, CanExport
- Est. funding potential: $75K-125K

**From Web Search:**
- Recent news: Hired new export manager (LinkedIn, 14 days ago)
- Website: Active, updated thismonth

**RECOMMENDATION:** High-value prospect - re-engage about CanExport (new hire trigger)
```

---

## ✅ WHAT ORACLE DOES WELL (Keep & Enhance)

1. **Cross-Source Intelligence** - Combining HubSpot + Dropbox + Drive + GetGranted is already powerful
2. **Grant Matching** - GetGranted search is excellent for client qualification
3. **Document Creation** - Budget templates, readiness assessments already polished
4. **Market Intelligence** - VisualPing alerts provide unique competitive advantage
5. **Conversational Interface** - Natural language queries work well

**Don't break these!** Build new tools to complement, not replace.

---

## 🎪 RECOMMENDATION

### **Start with Phase 1 (2-3 weeks)**
**Why:** Biggest impact, lowest cost, uses existing HubSpot API

**Build These 3 Tools:**
1. `search_hubspot_leads` - Advanced filtering
2. `update_hubspot_properties` - Write capability
3. `create_hubspot_list` - Auto-segmentation

**Plus 2 Quick Wins (1 week):**
4. Internal knowledge mining (systematic Dropbox extraction)
5. Lead profile generator (combine all sources)

**Total Time:** 3-4 weeks
**Total Cost:** ~$0-100/month
**Impact:** Sales director can immediately use Oracle for lead qualification queries

### **Then Phase 2 (3-4 weeks)**
**Why:** Solves biggest pain point (manual data entry)

**Add Enrichment:**
- Connect Hunter.io, Proxycurl
- Auto-fill missing emails, phones, employee counts
- Weekly batch enrichment

**Total Time:** 7-8 weeks from start
**Total Cost:** ~$650-1,600/month
**Impact:** 80% reduction in manual research time

---

## 📋 NEXT STEPS

1. **Review this analysis** with Sales Director & Jorge
2. **Confirm Phase 1 priorities** - which HubSpot queries are most critical?
3. **Get HubSpot API credentials** for write access
4. **Start building** enhanced search tool
5. **Weekly demos** to gather feedback

**Ready to start when you are!**
