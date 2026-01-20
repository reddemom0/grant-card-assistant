# HubSpot Lead Verification & Enrichment - Implementation Plan
**Focus: Task 1 from Sales Director Requirements**
**Date:** January 20, 2026

---

## 🎯 GOAL

Build Oracle tools to help verify and enrich HubSpot leads with the following capabilities:

1. ✅ **Filter by lifecycle stage** to find current leads
2. ✅ **Verify active leads** – check if businesses are still operating (website, LinkedIn, company registries)
3. ✅ **Fill missing info** – email addresses, phone numbers, job titles, company size, industry
4. ✅ **Flag outdated contacts** – highlight leads that haven't engaged in a set period
5. ✅ **Deduplicate leads** – identify duplicates in HubSpot and suggest merges
6. ✅ **Standardize data** – normalize job titles, company names, addresses

---

## 📋 CURRENT STATE ANALYSIS

### **What We Have:**
- ✅ HubSpot API integration (read-only)
- ✅ Functions: `searchHubSpotContacts`, `searchHubSpotCompanies`, `getHubSpotContact`
- ✅ Can query contacts and companies
- ✅ Can search by name, email, domain

### **What We Need:**
- ❌ **Write access** to HubSpot (update contact/company properties)
- ❌ **Advanced filtering** (lifecycle stage, last activity date, industry)
- ❌ **Bulk operations** (process 100+ leads at once)
- ❌ **Enrichment integrations** (business registry, web scraping, pattern matching)

---

## 🛠️ TOOLS TO BUILD

### **Tool 1: `search_hubspot_leads` (CRITICAL)**
**Purpose:** Advanced lead search with lifecycle stage filtering

**Input:**
```javascript
{
  lifecycle_stage: 'lead' | 'marketing_qualified_lead' | 'sales_qualified_lead',
  filters: {
    industry: string,
    state: string,  // BC, ON, etc.
    city: string,
    last_activity_days: number,  // e.g., 90 for "no activity in 90 days"
    missing_fields: string[],  // e.g., ['phone', 'email', 'company']
    min_employee_count: number,
    max_employee_count: number
  },
  sort: 'last_activity' | 'create_date' | 'company_name',
  limit: number
}
```

**Output:**
```javascript
{
  success: true,
  total_count: 234,
  leads: [
    {
      id: '12345',
      email: 'john@acme.com',
      firstname: 'John',
      lastname: 'Smith',
      company: 'Acme Foods',
      jobtitle: 'CFO',
      phone: null,  // Missing
      city: 'Vancouver',
      state: 'BC',
      lifecycle_stage: 'lead',
      last_activity_date: '2025-10-15',
      days_since_activity: 97,
      missing_fields: ['phone', 'employee_count'],
      hubspot_url: 'https://app.hubspot.com/contacts/21088260/contact/12345'
    },
    // ... more leads
  ]
}
```

**Implementation:**
- Use HubSpot Search API (`POST /crm/v3/objects/contacts/search`)
- Add filters for lifecycle stage, properties, last activity
- Calculate `days_since_activity` from engagement data
- Identify missing fields

---

### **Tool 2: `verify_business_status` (HIGH PRIORITY)**
**Purpose:** Check if a business is still operating

**Input:**
```javascript
{
  company_name: string,
  website: string,
  domain: string,
  province: string  // For business registry lookup
}
```

**Process:**
1. **Website Check:**
   - Use `web_fetch` to load company website
   - Check HTTP status (200 = active, 404/timeout = inactive)
   - Look for indicators: "Out of business", "Closed", etc.

2. **Business Registry Check:**
   - Query BC Business Registry API
   - Check status: Active, Dissolved, Struck off
   - Get registration date, corporate number

3. **LinkedIn Check:**
   - Search LinkedIn for company page
   - Check if page exists and has recent posts
   - Extract employee count if available

**Output:**
```javascript
{
  success: true,
  company_name: 'Acme Foods',
  status: 'active' | 'inactive' | 'unknown',
  confidence: 0.95,  // 0.0 - 1.0
  checks: {
    website: {
      status: 'active',
      http_code: 200,
      last_updated: '2026-01-15',  // From HTML meta or content analysis
      indicators: []
    },
    registry: {
      status: 'active',
      registration_number: 'BC1234567',
      incorporation_date: '2010-03-15',
      source: 'BC Business Registry'
    },
    linkedin: {
      status: 'active',
      url: 'https://linkedin.com/company/acme-foods',
      employee_count: '51-200',
      last_post_date: '2026-01-10'
    }
  },
  recommendation: 'Business appears active. Safe to contact.'
}
```

---

### **Tool 3: `enrich_lead_data` (HIGH PRIORITY)**
**Purpose:** Fill in missing contact/company information

**Input:**
```javascript
{
  contact_id: string,  // HubSpot contact ID
  company_id: string,  // HubSpot company ID (optional)
  fields_to_enrich: ['email', 'phone', 'jobtitle', 'employee_count', 'industry'],
  sources: ['internal_docs', 'web_scraping', 'pattern_matching', 'business_registry'],
  auto_update_hubspot: boolean
}
```

**Enrichment Sources:**

**1. Internal Docs (Dropbox/Drive):**
- Search for company name in past proposals, emails
- Extract: Email addresses, phone numbers, job titles from correspondence

**2. Company Website Scraping:**
- Visit company website
- Extract from Contact page: Phone, email (info@, sales@, etc.)
- Extract from About page: Employee count range, industry description
- Extract from Team page: Names, titles, emails of key people

**3. Pattern Matching (for emails):**
```
Given: John Smith at acme.com
Try patterns:
- john.smith@acme.com
- jsmith@acme.com
- john@acme.com
- johnsmith@acme.com
Validate using email verification APIs (free tiers exist)
```

**4. Business Registry:**
- BC Business Registry for incorporation date, status, address
- Industry classification codes

**5. LinkedIn (Careful Scraping):**
- Search "John Smith Acme Foods CFO" on LinkedIn
- Extract job title, company from profile if publicly visible
- Rate limit: 1 search per 10 seconds

**Output:**
```javascript
{
  success: true,
  contact_id: '12345',
  enriched_fields: {
    email: {
      value: 'john.smith@acme.com',
      source: 'pattern_matching',
      confidence: 0.75,
      verified: false
    },
    phone: {
      value: '+1-604-555-0100',
      source: 'website_contact_page',
      confidence: 0.90
    },
    jobtitle: {
      value: 'Chief Financial Officer',
      source: 'linkedin',
      confidence: 0.85
    },
    employee_count: {
      value: 87,
      source: 'linkedin',
      confidence: 0.70
    },
    industry: {
      value: 'Food & Beverage Manufacturing',
      source: 'business_registry',
      confidence: 0.95
    }
  },
  updated_hubspot: false,  // Set to true if auto_update_hubspot was true
  manual_review_needed: [
    'email'  // Low confidence, needs verification
  ]
}
```

---

### **Tool 4: `flag_stale_leads` (MEDIUM PRIORITY)**
**Purpose:** Identify leads that haven't been engaged recently

**Input:**
```javascript
{
  lifecycle_stages: ['lead', 'marketing_qualified_lead'],
  staleness_thresholds: {
    warning: 60,  // days
    stale: 90,
    dead: 180
  },
  create_hubspot_property: boolean,  // Add 'lead_staleness' property
  create_tasks: boolean  // Create follow-up tasks for sales reps
}
```

**Process:**
1. Query all contacts in specified lifecycle stages
2. Get last engagement date (last email, call, meeting, website visit)
3. Calculate days since last engagement
4. Categorize: Fresh (<60 days), Warning (60-89), Stale (90-179), Dead (180+)
5. Optionally update HubSpot property: `lead_staleness`
6. Optionally create tasks for assigned reps

**Output:**
```javascript
{
  success: true,
  total_leads_checked: 456,
  fresh: 234,
  warning: 89,
  stale: 78,
  dead: 55,
  leads_flagged: [
    {
      id: '12345',
      name: 'John Smith - Acme Foods',
      last_activity: '2025-10-15',
      days_stale: 97,
      status: 'stale',
      assigned_to: 'sarah@granted.ca',
      recommendation: 'Re-engagement email or mark as dead lead'
    },
    // ...
  ],
  actions_taken: {
    properties_updated: 133,  // If create_hubspot_property = true
    tasks_created: 45  // If create_tasks = true
  }
}
```

---

### **Tool 5: `deduplicate_leads` (MEDIUM PRIORITY)**
**Purpose:** Find duplicate contacts/companies in HubSpot

**Input:**
```javascript
{
  record_type: 'contact' | 'company',
  matching_criteria: {
    email: boolean,  // Exact email match
    name_fuzzy: boolean,  // Fuzzy name matching
    domain: boolean,  // Same email domain = same company
    phone: boolean,  // Phone number match
    address: boolean  // Physical address match
  },
  confidence_threshold: 0.80,  // 0.0 - 1.0
  auto_merge: false  // If true, automatically merge high-confidence duplicates
}
```

**Matching Logic:**

**Exact Matches (100% confidence):**
- Same email address
- Same phone number (normalized)
- Same domain (for companies)

**Fuzzy Matches (calculated confidence):**
- Name similarity using Levenshtein distance
  - "ABC Inc." vs "ABC Incorporated" = 95% match
  - "John Smith" vs "Jon Smith" = 90% match
- Address similarity (normalize street types, remove punctuation)
  - "123 Main St." vs "123 Main Street" = 100% match

**Output:**
```javascript
{
  success: true,
  duplicates_found: 23,
  duplicate_sets: [
    {
      primary_record: {
        id: '12345',
        name: 'John Smith',
        email: 'john.smith@acme.com',
        phone: '+1-604-555-0100',
        created_date: '2023-01-15',
        completeness: 0.85  // 85% of fields filled
      },
      duplicates: [
        {
          id: '67890',
          name: 'John Smith',
          email: 'jsmith@acme.com',  // Different email, same person
          phone: '+1-604-555-0100',  // Same phone
          created_date: '2024-06-20',
          completeness: 0.60,
          match_confidence: 0.95,
          match_reasons: ['phone_exact', 'name_exact', 'company_same']
        }
      ],
      suggested_action: 'Merge 67890 into 12345 (keep older record, more complete)',
      merge_strategy: {
        keep_record: '12345',
        fields_to_merge: {
          email: '67890',  // Take email from duplicate (more recent)
          phone: '12345',  // Keep from primary
          // ...
        }
      }
    },
    // ... more duplicate sets
  ],
  merged_records: 0,  // If auto_merge = true
  manual_review_needed: 8  // Low confidence matches
}
```

---

### **Tool 6: `standardize_data` (LOW PRIORITY)**
**Purpose:** Normalize data fields for consistency

**Input:**
```javascript
{
  record_ids: string[],  // HubSpot contact/company IDs (or 'all' for bulk)
  fields_to_standardize: ['jobtitle', 'company', 'state', 'phone'],
  rules: 'default' | 'custom',
  apply_updates: boolean  // If true, write back to HubSpot
}
```

**Standardization Rules:**

**Job Titles:**
```javascript
{
  'VP Operations': 'Vice President, Operations',
  'VP of Operations': 'Vice President, Operations',
  'COO': 'Chief Operating Officer',
  'CFO': 'Chief Financial Officer',
  'HR Manager': 'Human Resources Manager',
  'Owner': 'Chief Executive Officer',
  // ... comprehensive mapping
}
```

**Company Names:**
```javascript
// Remove legal suffixes for consistency
'ABC Inc.' → 'ABC'
'ABC Incorporated' → 'ABC'
'ABC Ltd.' → 'ABC'
'ABC Corp' → 'ABC'

// Normalize casing
'ABC INC' → 'ABC Inc'
'abc inc' → 'ABC Inc'
```

**Provinces/States:**
```javascript
'British Columbia' → 'BC'
'british columbia' → 'BC'
'B.C.' → 'BC'
'Ontario' → 'ON'
```

**Phone Numbers:**
```javascript
'604-555-0100' → '+1-604-555-0100'
'(604) 555-0100' → '+1-604-555-0100'
'6045550100' → '+1-604-555-0100'
```

**Output:**
```javascript
{
  success: true,
  records_processed: 234,
  fields_standardized: {
    jobtitle: 89,
    company: 156,
    state: 234,
    phone: 67
  },
  examples: [
    {
      record_id: '12345',
      field: 'jobtitle',
      before: 'VP of Ops',
      after: 'Vice President, Operations'
    },
    {
      record_id: '67890',
      field: 'state',
      before: 'British Columbia',
      after: 'BC'
    }
  ],
  updated_hubspot: false  // Set to true if apply_updates = true
}
```

---

## 🚀 IMPLEMENTATION PRIORITY

### **Week 1: Core Infrastructure**

#### **Task 1.1: Add HubSpot Write Access**
- Create `updateHubSpotContact(contactId, properties)` function
- Create `updateHubSpotCompany(companyId, properties)` function
- Add error handling and validation
- Test with non-production data

#### **Task 1.2: Build `search_hubspot_leads`**
- Implement advanced filtering (lifecycle stage, last activity, missing fields)
- Add sorting and pagination
- Return enriched lead objects with missing fields identified
- Add to Oracle's internal-oracle tools list

**Deliverable:** Oracle can answer:
```
"Show me all leads in BC that haven't been contacted in 90 days"
"Find leads with missing phone numbers"
"List all marketing qualified leads in food industry"
```

---

### **Week 2: Business Verification**

#### **Task 2.1: Build `verify_business_status`**
- Implement website checking (HTTP status, content analysis)
- Integrate BC Business Registry API
- Add LinkedIn company page checking (careful rate limiting)
- Combine checks into confidence score

**Deliverable:** Oracle can verify if businesses are still operating before outreach

---

### **Week 3: Data Enrichment (Free Sources)**

#### **Task 3.1: Build `enrich_lead_data`**
- Internal doc search (Dropbox/Drive for past communications)
- Website scraping (contact pages, about pages)
- Email pattern matching + validation
- Business registry integration
- Output enrichment results with confidence scores

**Deliverable:** Oracle can fill missing lead data using free sources

---

### **Week 4: Stale Lead Detection**

#### **Task 4.1: Build `flag_stale_leads`**
- Query engagement data from HubSpot
- Calculate staleness based on last activity
- Add HubSpot property: `lead_staleness`
- Generate stale lead reports

**Deliverable:** Automated weekly report of stale leads needing re-engagement

---

### **Week 5: Deduplication**

#### **Task 5.1: Build `deduplicate_leads`**
- Implement exact matching (email, phone, domain)
- Add fuzzy matching (name similarity, address normalization)
- Generate merge suggestions with confidence scores
- Manual review workflow for low-confidence matches

**Deliverable:** Oracle identifies duplicates and suggests merges

---

### **Week 6: Data Standardization**

#### **Task 6.1: Build `standardize_data`**
- Create normalization rules for job titles, company names, states, phones
- Implement bulk standardization
- Add preview mode (show changes before applying)

**Deliverable:** Consistent, clean data across all leads

---

## 💡 EXAMPLE WORKFLOWS

### **Workflow 1: Weekly Lead Scrub**
```
User: "Run weekly lead verification for all BC leads"

Oracle:
1. Searches for all leads in BC (search_hubspot_leads)
2. Verifies each business is still active (verify_business_status)
3. Enriches missing data (enrich_lead_data)
4. Flags stale leads (flag_stale_leads)
5. Identifies duplicates (deduplicate_leads)
6. Generates summary report

📊 Weekly Lead Scrub Summary - Jan 20, 2026

LEADS PROCESSED: 234 BC leads

BUSINESS STATUS:
✅ Active: 210 (90%)
⚠️ Possibly inactive: 18 (8%)
❌ Confirmed inactive: 6 (2%)

DATA ENRICHMENT:
📧 Emails found: 45
📞 Phone numbers found: 23
👔 Job titles updated: 67
🏢 Employee counts added: 34

ENGAGEMENT:
🟢 Fresh (<60 days): 89
🟡 Warning (60-89 days): 45
🟠 Stale (90-179 days): 67
🔴 Dead (180+ days): 33

DUPLICATES FOUND: 12 sets (24 records)

ACTIONS RECOMMENDED:
1. Remove 6 inactive businesses
2. Re-engage 67 stale leads
3. Review 12 duplicate sets for merging
4. Follow up with 18 possibly inactive businesses

Would you like me to:
- Update HubSpot with enriched data?
- Create re-engagement tasks for stale leads?
- Generate detailed report for sales team?
```

---

### **Workflow 2: Single Lead Enrichment**
```
User: "Enrich data for John Smith at Acme Foods"

Oracle:
🔍 Searching HubSpot for "John Smith Acme Foods"...

Found: John Smith (Contact ID: 12345)
- Email: john@acme.com ✓
- Phone: [MISSING]
- Job Title: [MISSING]
- Company: Acme Foods

🔄 Enriching from multiple sources...

✅ ENRICHMENT COMPLETE:

FROM INTERNAL DOCS:
- Found in 2024 ETG proposal: "John Smith, CFO"
- Email correspondence: john.smith@acme.com (alternate email)

FROM WEBSITE (acme.com/contact):
- Phone: +1-604-555-0100
- Job title confirmed: CFO

FROM BUSINESS REGISTRY:
- Company: Acme Foods Ltd.
- Industry: Food & Beverage Manufacturing
- Employees: 50-99 (estimated from registry data)
- Status: Active

FROM LINKEDIN:
- Profile found: John Smith, CFO at Acme Foods
- Title confirmed: Chief Financial Officer

ENRICHED DATA:
📧 Email (confirmed): john.smith@acme.com
📞 Phone (high confidence): +1-604-555-0100
👔 Job Title (verified): Chief Financial Officer
🏢 Company Size: 87 employees
🏭 Industry: Food & Beverage Manufacturing

Would you like me to update HubSpot with this data?
```

---

### **Workflow 3: Duplicate Detection**
```
User: "Find duplicate leads in HubSpot"

Oracle:
🔍 Scanning 1,234 contacts for duplicates...

Found 8 duplicate sets (19 total records):

HIGH CONFIDENCE DUPLICATES:

1. John Smith - Acme Foods
   Primary: ID 12345 (created 2023-01-15, 85% complete)
   Duplicate: ID 67890 (created 2024-06-20, 60% complete)
   Match: Same phone, same name, same company
   Confidence: 98%
   Action: Merge 67890 → 12345 (keep older, more complete)

2. Sarah Johnson - Valley Foods
   Primary: ID 23456 (created 2022-08-10, 90% complete)
   Duplicate: ID 78901 (created 2023-11-05, 75% complete)
   Match: Same email (sarah.j@valleyfoods.com)
   Confidence: 100%
   Action: Merge 78901 → 23456

MEDIUM CONFIDENCE (MANUAL REVIEW NEEDED):

3. Michael Chen / Mike Chen - TechCorp
   ID 34567 vs ID 89012
   Match: Similar name, same company, similar phone
   Confidence: 75%
   Action: Manual review recommended

[5 more sets...]

SUMMARY:
- High confidence: 5 sets (auto-merge recommended)
- Medium confidence: 3 sets (manual review needed)
- Low confidence: 0 sets

Would you like me to:
- Auto-merge the 5 high-confidence duplicates?
- Generate detailed comparison for manual review?
- Create merge tasks in HubSpot?
```

---

## 📊 SUCCESS METRICS

### **After Implementation:**

| Metric | Before | Target |
|--------|--------|--------|
| **Lead data completeness** | 60% | 85% |
| **Time to verify lead** | 15 min | 2 min |
| **Stale lead identification** | Manual | Automatic |
| **Duplicate leads** | ~12% | <3% |
| **Data consistency** | 65% | 90% |
| **Inactive business contacts** | Unknown | Flagged weekly |

---

## 🎯 NEXT STEPS

1. **✅ Get approval** to start implementation
2. **✅ Verify HubSpot API write permissions** (need to test or request)
3. **✅ Week 1:** Build `search_hubspot_leads` + write functions
4. **✅ Week 2-3:** Build verification & enrichment tools
5. **✅ Week 4-6:** Build flagging, deduplication, standardization
6. **✅ Test with pilot group** (strategy team?)
7. **✅ Full rollout** to sales team

**Ready to start Week 1?** I can begin building the HubSpot search and update functions today if approved!
