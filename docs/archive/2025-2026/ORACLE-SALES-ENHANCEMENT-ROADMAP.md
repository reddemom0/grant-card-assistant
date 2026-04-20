# Oracle Sales Enhancement Roadmap
**Sales Director Requirements Analysis**
**Date:** January 20, 2026

---

## Overview

This document breaks down the sales director's requirements for Oracle enhancements into specific, implementable tasks. Each task is categorized by complexity, priority, and technical requirements.

---

## 1. VERIFY / ENRICH LEADS ON HUBSPOT

### Task 1.1: Verify Active Leads (Business Operating Status)
**Description:** Check if businesses are still operating using website, LinkedIn, company registries.

**Implementation:**
- Tool: `verify_business_status`
- Data Sources:
  - Website check (HTTP status, content analysis)
  - LinkedIn company page check
  - BC/Canadian business registry API
  - Google search for closure announcements
- Output: Active status flag + confidence score

**Priority:** 🔴 HIGH
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- Web scraping capability
- LinkedIn API or alternative
- Business registry API access

**Estimated Dev Time:** 2-3 weeks

---

### Task 1.2: Fill Missing Information
**Description:** Auto-populate missing email addresses, phone numbers, job titles, company size, industry.

**Implementation:**
- Tool: `enrich_lead_data`
- Data Sources:
  - LinkedIn (company profiles, employee data)
  - Hunter.io or similar (email finding)
  - Clearbit, ZoomInfo alternatives (phone, company data)
  - Company websites (scrape contact pages)
  - Internal Dropbox/Google Drive docs (past proposals, contracts)
- Fields to enrich:
  - Email addresses
  - Phone numbers
  - Job titles
  - Company size (employee count)
  - Industry classification
  - Revenue range
  - Physical address

**Priority:** 🔴 HIGH
**Complexity:** 🔴 HIGH
**Dependencies:**
- HubSpot API (read/write)
- Third-party enrichment APIs (Hunter.io, Proxycurl, etc.)
- Internal document search

**Estimated Dev Time:** 3-4 weeks

---

### Task 1.3: Flag Outdated Contacts
**Description:** Highlight leads that haven't engaged in a set period.

**Implementation:**
- Tool: `flag_stale_leads`
- Logic:
  - Query HubSpot for last activity date
  - Define thresholds: 3 months (warning), 6 months (critical), 12 months (dead)
  - Check last email open, click, meeting, call
  - Add HubSpot property: `lead_staleness` (fresh/aging/stale/dead)
  - Create task for sales rep if previously hot lead goes stale
- Automation: Daily cron job

**Priority:** 🟢 MEDIUM
**Complexity:** 🟢 LOW
**Dependencies:**
- HubSpot API (activity data, properties)

**Estimated Dev Time:** 1 week

---

### Task 1.4: Deduplicate Leads
**Description:** Automatically identify duplicates in HubSpot and merge those records if possible.

**Implementation:**
- Tool: `deduplicate_leads`
- Matching Logic:
  - Exact match: Email, phone
  - Fuzzy match: Company name (handle "ABC Inc" vs "ABC Inc." vs "A.B.C. Incorporated")
  - Domain match: Email domains (john@acme.com, jane@acme.com = same company)
  - Address match: Normalize addresses
- Merge Strategy:
  - Keep most complete record
  - Preserve all activity history
  - Flag for manual review if confidence < 90%
- Output: List of duplicates + suggested merges

**Priority:** 🟡 MEDIUM-HIGH
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot API (search, merge contacts/companies)
- Fuzzy matching library (fuzzywuzzy, Levenshtein)

**Estimated Dev Time:** 2 weeks

---

### Task 1.5: Standardize Data
**Description:** Normalize job titles, company names, and addresses.

**Implementation:**
- Tool: `standardize_lead_data`
- Normalization Rules:

  **Job Titles:**
  - "VP of Operations" → "Vice President, Operations"
  - "HR Manager" → "Human Resources Manager"
  - "Owner" → "Chief Executive Officer"
  - Create mapping table based on grant eligibility patterns

  **Company Names:**
  - Remove "Inc.", "Ltd.", "Corp." suffixes
  - Normalize casing (ABC INC → ABC Inc)
  - Handle legal entity types (Ltd vs Limited)

  **Addresses:**
  - Standardize province codes (BC, British Columbia → BC)
  - Normalize street types (St, Street, St. → Street)
  - Validate postal codes (format: A1A 1A1)

**Priority:** 🟢 MEDIUM
**Complexity:** 🟢 LOW-MEDIUM
**Dependencies:**
- HubSpot API (bulk update)
- Canadian address validation API

**Estimated Dev Time:** 1-2 weeks

---

## 2. SCORING / PRIORITIZING LEADS

### Task 2.1: Predict High-Value Leads
**Description:** Use past deal data or ICP to rank likelihood of conversion.

**Implementation:**
- Tool: `score_lead_value`
- Scoring Model:
  - Historical data: Past won deals (industry, size, revenue, engagement pattern)
  - ICP matching:
    - Industry match (food/bev, manufacturing = +20 points)
    - Employee count (50-250 = +15 points)
    - Location (BC = +10 points)
    - Revenue range ($5M-$50M = +15 points)
    - Previous grant recipient = +25 points
    - Decision-maker engaged = +20 points
  - Engagement signals:
    - Website visits (recent = +5 points)
    - Email opens (3+ in 30 days = +10 points)
    - Meeting booked = +30 points
- Output: Lead score (0-100) + HubSpot property update

**Priority:** 🔴 HIGH
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot API (deal data, engagement tracking)
- ICP definition document
- Historical won/lost deal analysis

**Estimated Dev Time:** 2-3 weeks

---

### Task 2.2: Segment Leads
**Description:** Categorize by engagement level, industry, geography, or other internal criteria.

**Implementation:**
- Tool: `segment_leads`
- Segmentation Criteria:

  **Engagement Level:**
  - Hot: Engaged in last 7 days, meeting booked
  - Warm: Engaged in last 30 days
  - Cold: Engaged 30-90 days ago
  - Dead: No engagement in 90+ days

  **Industry:**
  - Food & Beverage
  - Manufacturing
  - Technology
  - Professional Services
  - Other

  **Geography:**
  - BC (Metro Vancouver, Fraser Valley, Interior, Island, North)
  - Other provinces

  **Grant Fit:**
  - ETG eligible (training focus, BC, 50-250 employees)
  - CanExport eligible (export activity, eligible expenses)
  - BCAFE eligible (agriculture/food, export)
  - IRAP eligible (innovation, R&D)

- Output: HubSpot lists + tags

**Priority:** 🔴 HIGH
**Complexity:** 🟢 LOW
**Dependencies:**
- HubSpot API (lists, properties)
- Grant eligibility criteria rules

**Estimated Dev Time:** 1-2 weeks

---

### Task 2.3: Activity Alerts
**Description:** Notify team when high-priority leads take certain actions (website visits, form fills).

**Implementation:**
- Tool: `lead_activity_monitor`
- Trigger Events:
  - High-value lead visits pricing page
  - Decision-maker opens email 3+ times
  - Lead downloads case study/whitepaper
  - Form submission (contact, demo request)
  - LinkedIn profile view (if Sales Navigator)
  - Competitor mention (in email reply)
- Notification Channels:
  - Slack (sales channel)
  - Email (assigned sales rep)
  - HubSpot task creation
- Smart Alerts:
  - Only for leads with score > 60
  - Suppress notifications if contacted in last 24h
  - Aggregate multiple actions into digest

**Priority:** 🟡 MEDIUM-HIGH
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot webhooks/workflows
- Slack API
- Website analytics integration

**Estimated Dev Time:** 2 weeks

---

## 3. LEAD RESEARCH

### Task 3.1: Suggest New Leads (Lookalike Companies)
**Description:** Find companies similar to your top clients.

**Implementation:**
- Tool: `find_lookalike_leads`
- Similarity Criteria:
  - Same industry (NAICS code)
  - Similar employee count (±30%)
  - Same geography (region)
  - Similar revenue range
  - Same grant history (past grant recipients)
- Data Sources:
  - BC/Canadian business registries
  - LinkedIn company database
  - Grant recipient public lists (gov websites)
  - Industry association directories
- Input: Top 10 clients (HubSpot companies)
- Output: List of 50-100 lookalike prospects with contact info

**Priority:** 🔴 HIGH
**Complexity:** 🔴 HIGH
**Dependencies:**
- Business directory APIs
- LinkedIn API or alternative (Proxycurl)
- Web scraping (grant recipient lists)

**Estimated Dev Time:** 3-4 weeks

---

### Task 3.2: Find Decision-Makers
**Description:** Automatically identify key contacts using internal docs or LinkedIn.

**Implementation:**
- Tool: `find_decision_makers`
- Target Roles:
  - HR Director/Manager (ETG, training grants)
  - CFO/Controller (financial decision-maker)
  - Export Manager/Director (CanExport)
  - Operations VP/Director (IRAP, innovation)
  - CEO/Owner (small businesses)
- Data Sources:
  - LinkedIn (employee search, job titles)
  - Company website (leadership page scraping)
  - Internal docs (past proposals, emails in Dropbox)
  - HubSpot (existing contacts at company)
- Output: List of decision-makers with contact info + confidence score

**Priority:** 🔴 HIGH
**Complexity:** 🔴 HIGH
**Dependencies:**
- LinkedIn API (Sales Navigator or Proxycurl)
- Internal document search (already built)
- Web scraping capability

**Estimated Dev Time:** 3 weeks

---

### Task 3.3: Enrich with Public Info
**Description:** Company revenue, funding rounds, news mentions.

**Implementation:**
- Tool: `enrich_public_data`
- Data Points:
  - Revenue/annual sales
  - Funding rounds (if startup)
  - Recent news mentions
  - Awards/certifications
  - Expansion announcements
  - New product launches
  - Executive changes
- Data Sources:
  - Google News API
  - Crunchbase (for tech companies)
  - Canadian Business databases
  - Industry publications
  - Press release sites
- Automation: Weekly refresh for active leads

**Priority:** 🟡 MEDIUM
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- News API access
- Business data API (Crunchbase, etc.)
- Web scraping

**Estimated Dev Time:** 2-3 weeks

---

### Task 3.4: Internal Knowledge Mining
**Description:** Search Dropbox/Google Drive docs to extract potential leads or contacts.

**Implementation:**
- Tool: `mine_internal_leads`
- Strategy:
  - Scan past proposals for mentioned companies (competitors, partners)
  - Extract contacts from email threads
  - Find companies mentioned in case studies
  - Parse event attendee lists
  - Extract names from webinar registrations
- Search Targets:
  - /Proposals folder (company names in competitive analysis)
  - /Client folder (partner organizations mentioned)
  - /Marketing folder (event lists, webinar attendees)
- Output: New lead suggestions with source document

**Priority:** 🟢 MEDIUM
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- Oracle Dropbox/Google Drive search (already built)
- NLP/entity extraction (company names, contact info)

**Estimated Dev Time:** 2 weeks

---

## 4. AUTOMATION / WORKFLOWS ON HUBSPOT

### Task 4.1: Auto-Update CRM
**Description:** Push validated/enriched data back into HubSpot.

**Implementation:**
- Tool: `sync_enriched_data_to_hubspot`
- Update Workflow:
  1. Oracle enriches lead data
  2. Validate data quality (confidence threshold)
  3. Map to HubSpot properties
  4. Batch update via API
  5. Log changes in audit trail
  6. Create activity note: "Auto-enriched by Oracle"
- Safety Measures:
  - Never overwrite manually entered data
  - Flag conflicts for review
  - Preserve data history

**Priority:** 🔴 HIGH
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot API (bulk update)
- Data validation rules

**Estimated Dev Time:** 2 weeks

**Note:** Requires coordination with Nat (HubSpot workflows expert)

---

### Task 4.2: Weekly/Daily Scrub
**Description:** Automated job to keep leads current.

**Implementation:**
- Tool: `scheduled_lead_scrub`
- Daily Jobs:
  - Flag stale leads (no activity in 90 days)
  - Check for new website visits (hot leads)
  - Monitor high-value lead activity
- Weekly Jobs:
  - Verify business status (still operating?)
  - Enrich missing data for new leads
  - Update company size/employee count
  - Check for news mentions
  - Deduplicate new entries
- Monthly Jobs:
  - Deep enrichment (revenue, funding, etc.)
  - Lookalike lead generation
  - Competitive intelligence refresh
- Execution: Railway cron jobs

**Priority:** 🔴 HIGH
**Complexity:** 🟢 LOW-MEDIUM
**Dependencies:**
- All enrichment tools (Tasks 1.x, 3.x)
- Railway/cron scheduler

**Estimated Dev Time:** 1 week (orchestration layer)

---

### Task 4.3: Generate Reports
**Description:** Summarize lead status, enrichment progress, and new opportunities.

**Implementation:**
- Tool: `generate_sales_reports`
- Report Types:

  **Daily Digest (Sales Team):**
  - Hot leads with recent activity
  - New leads added
  - High-priority alerts

  **Weekly Report (Sales Director):**
  - Pipeline health (lead count by stage)
  - Enrichment progress (% complete)
  - New lookalike leads discovered
  - Lead score distribution
  - Stale lead count

  **Monthly Report (Executive):**
  - Lead generation trends
  - Conversion rates by source
  - Data quality metrics
  - Top performing segments
  - Opportunity forecast

- Delivery: Email + Slack + Dashboard

**Priority:** 🟡 MEDIUM
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot API (reporting data)
- Email service (SendGrid, etc.)
- Report templating

**Estimated Dev Time:** 2 weeks

---

## 5. OUTREACH OR INSIGHTS

### Task 5.1: Draft Personalized Messages
**Description:** Email or call scripts using CRM history and internal notes.

**Implementation:**
- Tool: `generate_outreach_message`
- Input:
  - Lead profile (HubSpot data)
  - Company research (Oracle enrichment)
  - Past interaction history
  - Internal notes from Dropbox
  - Similar client success stories
- Message Types:
  - Cold outreach (introduction)
  - Warm follow-up (after discovery call)
  - Re-engagement (stale leads)
  - Grant-specific pitch (ETG, CanExport, etc.)
- Personalization Elements:
  - Recent company news
  - Grant eligibility match
  - Similar client case study reference
  - Decision-maker's background
- Output: 3-4 message variations (A/B testing)

**Priority:** 🔴 HIGH
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot API (contact history)
- Oracle knowledge base (case studies)
- Claude API (message generation)

**Estimated Dev Time:** 2 weeks

---

### Task 5.2: Track Lead Engagement Patterns
**Description:** AI analyzes what types of messaging work best.

**Implementation:**
- Tool: `analyze_engagement_patterns`
- Analysis:
  - Email subject line performance
  - Message length correlation with response
  - Best time/day to send
  - Call script effectiveness
  - Follow-up cadence optimization
- Metrics:
  - Open rate by subject line template
  - Response rate by message type
  - Meeting booking rate by approach
  - Time to response
- Insights:
  - "Subject lines mentioning 'grant funding' have 23% higher open rate"
  - "Warm leads respond best to 2-day follow-up cadence"
  - "CFOs prefer morning calls, HR Directors prefer afternoon"
- Output: Quarterly playbook updates

**Priority:** 🟢 MEDIUM-LOW
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot API (email/call metrics)
- Analytics/BI tool

**Estimated Dev Time:** 2-3 weeks

---

### Task 5.3: Competitive Insights
**Description:** Flag leads that are interacting with competitors or attending relevant events.

**Implementation:**
- Tool: `monitor_competitive_signals`
- Signals to Monitor:
  - LinkedIn connections with competitor employees
  - Engagement with competitor content
  - Event attendance (grant webinars, industry conferences)
  - Google search intent (searching for grant consultants)
  - Job postings (hiring grant writers)
- Data Sources:
  - LinkedIn Sales Navigator (if available)
  - Event registration lists (public webinars)
  - Industry association member directories
  - Google Alerts for company mentions
- Alerts:
  - "ABC Corp attended CanExport webinar (competitor hosting)"
  - "XYZ Ltd posted job for Grant Writer (competitive threat)"
- Action: Create task for sales rep to reach out

**Priority:** 🟡 MEDIUM
**Complexity:** 🔴 HIGH
**Dependencies:**
- LinkedIn monitoring
- Event tracking systems
- Job board monitoring

**Estimated Dev Time:** 3 weeks

---

## 6. OTHER (ADVANCED CAPABILITIES)

### Task 6.1: Knowledge-Augmented Queries
**Description:** Allow team to ask Oracle questions like "Which leads in HubSpot haven't been contacted in 3 months but match our top client profile?"

**Implementation:**
- Tool: Oracle conversational interface (already exists)
- Enhancement: Add HubSpot query capabilities
- Example Queries:
  - "Show me all BC manufacturing companies with 50-200 employees that we haven't contacted in 6 months"
  - "Find leads that opened our last 3 emails but haven't booked a meeting"
  - "Which of our warm leads are in the food industry and eligible for BCAFE?"
  - "List all leads that mentioned 'export' in their discovery call notes"
- Technical:
  - Natural language → HubSpot API query
  - Combine HubSpot data + Oracle knowledge base
  - Format results for easy action

**Priority:** 🔴 CRITICAL
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- Oracle interface (exists)
- HubSpot API integration
- Claude prompt engineering

**Estimated Dev Time:** 2 weeks

---

### Task 6.2: Cross-Source Insights
**Description:** Combine CRM + internal docs + public data for richer lead profiles.

**Implementation:**
- Tool: `generate_360_lead_profile`
- Data Integration:

  **From HubSpot:**
  - Contact info, activity history, deal stage

  **From Internal Docs:**
  - Past proposals, contracts, meeting notes
  - Email correspondence
  - Case study references

  **From Public Sources:**
  - LinkedIn (employees, company updates)
  - News articles
  - Government grant databases
  - Business registries

  **From GetGranted:**
  - Past grant applications
  - Success rates
  - Grant fit analysis

- Output: Comprehensive lead profile with timeline

**Priority:** 🔴 HIGH
**Complexity:** 🔴 HIGH
**Dependencies:**
- All data sources integrated
- Oracle search (existing)
- HubSpot API

**Estimated Dev Time:** 3 weeks

---

### Task 6.3: Predict Churn or Inactivity
**Description:** Flag leads likely to go cold based on trends.

**Implementation:**
- Tool: `predict_lead_churn`
- Churn Indicators:
  - Declining email engagement (opens down 50% over 30 days)
  - No meeting booked in 90 days (previously active)
  - Decision-maker left company (LinkedIn job change)
  - Negative sentiment in last interaction
  - Long email response times (3+ days → 7+ days)
  - Budget year change (fiscal year reset, funds allocated elsewhere)
- Risk Levels:
  - 🔴 High risk (80%+ chance of going cold in 30 days)
  - 🟡 Medium risk (50-80% chance)
  - 🟢 Low risk (<50% chance)
- Action: Create re-engagement task for sales rep

**Priority:** 🟡 MEDIUM
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- HubSpot engagement data
- Predictive model (historical churn patterns)
- LinkedIn monitoring (job changes)

**Estimated Dev Time:** 2-3 weeks

---

### Task 6.4: Opportunity Scoring for New Products/Services
**Description:** Suggest leads most likely to adopt a new offering (e.g., GG2.0).

**Implementation:**
- Tool: `score_product_opportunity`
- Use Case: GetGranted 2.0 Launch
- Scoring Criteria:
  - Current GG usage (active users)
  - Grant volume (high-volume clients need automation)
  - Pain points mentioned ("grant tracking is manual")
  - Tech adoption (use other SaaS tools)
  - Budget tier (can afford upgrade)
  - Engagement level (will respond to outreach)
- Output: Ranked list of 50 best prospects for GG2.0
- Deliverable: Sales playbook with personalized pitch for each prospect

**Priority:** 🟡 MEDIUM (depends on GG2.0 launch timeline)
**Complexity:** 🟡 MEDIUM
**Dependencies:**
- GetGranted usage analytics
- HubSpot deal/product data
- Customer pain point analysis (from notes)

**Estimated Dev Time:** 2 weeks

---

## IMPLEMENTATION ROADMAP

### Priority Matrix

| Priority | Tasks | Total Effort |
|----------|-------|--------------|
| 🔴 **CRITICAL** (Do First) | 6.1, 6.2 | 5 weeks |
| 🔴 **HIGH** (Do Next) | 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1 | 22-26 weeks |
| 🟡 **MEDIUM** (Do After) | 1.3, 1.4, 1.5, 2.3, 3.3, 3.4, 4.3, 5.2, 5.3, 6.3, 6.4 | 22-27 weeks |
| 🟢 **LOW** (Nice to Have) | - | - |

---

## PHASED ROLLOUT (Recommended)

### **Phase 1: Foundation (Weeks 1-6)** 🏗️
**Goal:** Enable basic HubSpot queries and lead enrichment

**Tasks:**
- 6.1: Knowledge-Augmented Queries (2 weeks) ✅ CRITICAL
- 1.2: Fill Missing Information (3 weeks)
- 4.1: Auto-Update CRM (2 weeks)

**Deliverable:** Oracle can answer HubSpot questions and enrich leads

---

### **Phase 2: Intelligence Layer (Weeks 7-12)** 🧠
**Goal:** Smart lead scoring and cross-source insights

**Tasks:**
- 6.2: Cross-Source Insights (3 weeks) ✅ CRITICAL
- 2.1: Predict High-Value Leads (2 weeks)
- 2.2: Segment Leads (1 week)

**Deliverable:** Oracle provides 360° lead profiles and prioritization

---

### **Phase 3: Automation (Weeks 13-18)** 🤖
**Goal:** Automated workflows and maintenance

**Tasks:**
- 4.2: Weekly/Daily Scrub (1 week)
- 1.3: Flag Outdated Contacts (1 week)
- 1.4: Deduplicate Leads (2 weeks)
- 5.1: Draft Personalized Messages (2 weeks)

**Deliverable:** Self-maintaining CRM with automated outreach support

---

### **Phase 4: Research & Prospecting (Weeks 19-26)** 🔍
**Goal:** Find new leads and decision-makers

**Tasks:**
- 3.1: Suggest New Leads (3-4 weeks)
- 3.2: Find Decision-Makers (3 weeks)
- 1.1: Verify Active Leads (2-3 weeks)

**Deliverable:** Oracle generates new prospect lists automatically

---

### **Phase 5: Advanced Features (Weeks 27-36)** 🚀
**Goal:** Predictive analytics and competitive intelligence

**Tasks:**
- 6.3: Predict Churn/Inactivity (2-3 weeks)
- 5.3: Competitive Insights (3 weeks)
- 3.3: Enrich with Public Info (2-3 weeks)
- 4.3: Generate Reports (2 weeks)

**Deliverable:** Full sales intelligence platform

---

### **Phase 6: Optimization (Weeks 37-40)** ⚡
**Goal:** Polish and refine

**Tasks:**
- 1.5: Standardize Data (1-2 weeks)
- 3.4: Internal Knowledge Mining (2 weeks)
- 5.2: Track Engagement Patterns (2-3 weeks)
- 6.4: Opportunity Scoring for GG2.0 (2 weeks)

**Deliverable:** Mature, optimized system

---

## TECHNICAL DEPENDENCIES

### APIs & Integrations Required

| Service | Purpose | Cost Estimate | Priority |
|---------|---------|---------------|----------|
| **HubSpot API** | CRM integration | Included with HS | 🔴 CRITICAL |
| **LinkedIn API** | Company/people data | $800-1,600/year (Sales Nav) | 🔴 HIGH |
| **Proxycurl** | LinkedIn alternative | $500-1,000/month | 🔴 HIGH |
| **Hunter.io** | Email finding | $49-99/month | 🟡 MEDIUM |
| **Clearbit** | Data enrichment | $99-499/month | 🟡 MEDIUM |
| **Google News API** | News monitoring | Free (limited) | 🟢 LOW |
| **Business Registry APIs** | Company verification | Varies by province | 🟡 MEDIUM |
| **Slack API** | Notifications | Free | 🟡 MEDIUM |

**Total Monthly Cost (Full Suite):** ~$650-1,600/month
**Phase 1 Cost:** ~$100-200/month (HubSpot API + basic enrichment)

---

## ORACLE TOOL DEFINITIONS (Examples)

### Tool: `search_hubspot_leads`

```javascript
{
  name: 'search_hubspot_leads',
  description: 'Search HubSpot CRM for leads matching specific criteria',
  input_schema: {
    type: 'object',
    properties: {
      filters: {
        type: 'object',
        description: 'Search filters',
        properties: {
          industry: { type: 'string' },
          location: { type: 'string' },
          employee_count_min: { type: 'number' },
          employee_count_max: { type: 'number' },
          last_activity_days: { type: 'number' },
          lead_score_min: { type: 'number' },
          lifecycle_stage: { type: 'string' }
        }
      },
      limit: { type: 'number', default: 25 }
    }
  }
}
```

### Tool: `enrich_lead`

```javascript
{
  name: 'enrich_lead',
  description: 'Enrich a HubSpot lead with data from multiple sources',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', required: true },
      sources: {
        type: 'array',
        items: { enum: ['linkedin', 'public_data', 'internal_docs', 'all'] },
        default: ['all']
      },
      auto_update_hubspot: { type: 'boolean', default: false }
    }
  }
}
```

### Tool: `generate_lead_profile`

```javascript
{
  name: 'generate_lead_profile',
  description: 'Generate comprehensive 360° lead profile combining all data sources',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', required: true },
      include_recommendations: { type: 'boolean', default: true }
    }
  }
}
```

---

## NEXT STEPS

1. **Review with Sales Director & Jorge**
   - Validate priorities
   - Adjust timeline
   - Confirm budget

2. **Coordinate with Nat (HubSpot Expert)**
   - HubSpot workflow integration points
   - Custom properties needed
   - Automation rules

3. **Begin Phase 1 Development**
   - Set up HubSpot API integration
   - Build knowledge-augmented query tool
   - Test with pilot group

4. **Weekly Progress Reviews**
   - Demo completed features
   - Gather feedback
   - Adjust roadmap as needed

---

## SUCCESS METRICS

| Metric | Current | Target (6 months) | Target (12 months) |
|--------|---------|-------------------|-------------------|
| **Lead enrichment completion** | ~30% | 70% | 90% |
| **Time to qualify lead** | 30 min | 5 min | 2 min |
| **Duplicate leads** | ~15% | 5% | <2% |
| **Stale lead identification** | Manual | Automatic (daily) | Predictive (14-day advance) |
| **New lead generation** | Manual research | 50/month automated | 100/month automated |
| **Sales rep time on admin** | 40% | 25% | 15% |
| **Lead conversion rate** | Baseline | +15% | +30% |

---

**Document Version:** 1.0
**Last Updated:** January 20, 2026
**Owner:** Chris (Engineering)
**Stakeholders:** Sales Director, Jorge, Nat (HubSpot)
