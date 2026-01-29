# Lead Verification & Data Quality

**Maintain clean, accurate CRM data through verification, deduplication, and data quality workflows.**

## Overview

Data quality is critical for effective sales operations. This guide covers three essential data quality workflows:
1. **Verify Active Leads** - Check if companies are still operating
2. **Find Stale/Outdated Leads** - Identify leads needing attention
3. **Deduplicate Leads** - Find and merge duplicate records

## 1. Verify Active Leads

Check if companies are still operating and their websites are still live.

### When to Verify Leads

- Before reaching out to old leads (check if still operating)
- During data cleanup campaigns
- When leads haven't engaged in 6+ months
- Before major outreach efforts
- When website domain looks suspicious
- After bounced emails or failed contact attempts

### Verification Workflow

```
User: "Verify if TechStart Inc is still active"

Process:

1. FIND COMPANY IN HUBSPOT:
   search_hubspot_companies({ domain: "techstart.io" })
   → Found company ID: 12345
   → Domain: techstart.io

2. VERIFY WEBSITE:
   verify_company_website({ domain: "techstart.io" })
   → Status: 200 OK
   → Result: ✅ ACTIVE

3. ADDITIONAL VERIFICATION (optional):
   WebFetch: https://techstart.io
   → Website loads successfully
   → Content looks current (copyright 2026, recent blog posts)

   WebSearch: "site:linkedin.com/company techstart"
   → LinkedIn page exists and active

4. REPORT STATUS:
   ✅ ACTIVE LEAD - TechStart Inc

   Website Status: 200 OK (accessible)
   Domain: techstart.io
   LinkedIn: Active company page
   Last Website Update: Recent (copyright 2026)

   Recommendation: Lead is active and operational. Safe to proceed with outreach.

   HubSpot Record: https://app.hubspot.com/contacts/21088260/record/0-2/12345
```

### Website Verification Status Codes

**✅ ACTIVE (200 OK)**
- Website accessible and loading
- **Action:** Lead is active, proceed with engagement

**❌ INACTIVE (404 Not Found)**
- Website doesn't exist
- Domain may be expired or business closed
- **Action:** Mark as inactive, remove from active outreach

**⚠️ UNKNOWN (Timeout/Server Error)**
- Website timing out, blocking requests, or server issues
- May be temporary technical problem
- **Action:** Try again later, check alternative sources (LinkedIn, directory listings)

**🔄 REDIRECTED**
- Domain redirects to different website
- May indicate company was acquired or rebranded
- **Action:** Research redirect target, update company info

### Verification Status Updates

**When Lead is INACTIVE:**
```
update_hubspot_company({
  company_id: "12345",
  properties: {
    hs_lead_status: "Inactive",
    notes: "Website inactive (404) as of 2026-01-29. Business may be closed."
  }
})
```

**When Lead is ACTIVE:**
```
update_hubspot_company({
  company_id: "12345",
  properties: {
    notes: "Website verified active as of 2026-01-29. Safe for outreach."
  }
})
```

## 2. Find Stale/Outdated Leads

Identify leads that haven't been updated or engaged in a long time.

### Finding Stale Leads

Use date filters to find leads with no recent activity:

```
User: "Find leads that haven't been updated in 90 days"

Process:

1. CALCULATE DATE THRESHOLD:
   Today: 2026-01-29
   90 days ago: 2025-10-31

2. SEARCH HUBSPOT:
   search_hubspot_companies({
     query: "*",
     lifecycle_stage: "lead",
     lastmodifieddate_before: "2025-10-31",
     sort_by: "hs_lastmodifieddate",
     sort_order: "ASC",
     limit: 20
   })

3. REVIEW RESULTS:
   Found 15 leads not updated since October 2025:

   📊 STALE LEADS (90+ days no updates)

   1. Acme Corp - Last updated: 2025-08-15 (166 days ago)
   2. TechVenture Inc - Last updated: 2025-09-10 (141 days ago)
   3. GreenFood Ltd - Last updated: 2025-10-01 (120 days ago)
   ... (12 more)

4. SUGGEST ACTIONS:
   These leads are stale and need attention:

   Options:
   A) Verify which companies are still active (batch verification)
   B) Update lifecycle stage to "inactive" for closed businesses
   C) Archive permanently defunct companies
   D) Flag active companies for re-engagement campaign

   Would you like me to verify website status for all 15 leads?
```

### Common Stale Lead Scenarios

**Scenario 1: Lost Interest**
- Engaged initially, then went silent
- **Action:** Re-engagement campaign with updated value prop

**Scenario 2: Bad Timing**
- Weren't ready when first contacted
- **Action:** Verify still active, re-approach with timing-sensitive offer

**Scenario 3: Business Closed**
- Company no longer operating
- **Action:** Verify website status, mark inactive if confirmed

**Scenario 4: Slipped Through Cracks**
- Valid lead but never followed up
- **Action:** Verify active, add to active outreach queue

### Batch Verification Workflow

```
User: "Verify website status for all stale leads"

Process:

1. FOR EACH STALE LEAD:
   - Get domain from HubSpot record
   - verify_company_website({ domain })
   - Wait 2-3 seconds between requests
   - Store results

2. CATEGORIZE RESULTS:
   ✅ ACTIVE (10 companies):
   - Acme Corp - 200 OK
   - TechVenture Inc - 200 OK
   ... (8 more)

   ❌ INACTIVE (3 companies):
   - OldCo Inc - 404 Not Found
   - DeadBiz Ltd - Domain doesn't exist
   - FailedStartup - 404 Not Found

   ⚠️ UNKNOWN (2 companies):
   - TimeoutCo - Server timeout
   - BlockedSite - Access denied

3. RECOMMEND ACTIONS:
   ACTIVE LEADS (10):
   → Flag for re-engagement campaign
   → Update notes with verification date
   → Assign to sales rep for outreach

   INACTIVE LEADS (3):
   → Update lifecycle stage to "Inactive"
   → Remove from active lists
   → Archive after 30 days if no other info found

   UNKNOWN (2):
   → Manually research (LinkedIn, news, directories)
   → Re-verify in 7 days
```

## 3. Deduplicate Leads

Find and merge duplicate company and contact records to maintain data quality.

### Why Deduplication Matters

- **Avoids confusion** - Multiple records for same company causes errors
- **Improves data quality** - Consolidated data is more complete
- **Prevents duplicate outreach** - Don't contact same lead twice
- **Better reporting** - Accurate counts and metrics

### Finding Duplicate Companies

```
User: "Check for duplicate companies for techstart.io"

Process:

1. FIND DUPLICATES:
   find_duplicate_companies({ domain: "techstart.io" })

2. REVIEW RESULTS:
   📊 DUPLICATE COMPANIES FOUND

   Company A (Primary Candidate):
   - ID: 12345678901
   - Name: TechStart Inc
   - Created: 2024-01-15
   - Associated Contacts: 3
   - Associated Deals: 2
   - Last Modified: 2025-12-10
   - Has Data: domain, industry, revenue, description, LinkedIn

   Company B (Secondary Candidate):
   - ID: 98765432109
   - Name: TechStart Innovations Inc
   - Created: 2025-01-10
   - Associated Contacts: 1
   - Associated Deals: 0
   - Last Modified: 2025-01-10
   - Has Data: domain, city, state

3. ANALYZE WHICH TO KEEP:
   ✅ Recommend keeping Company A as primary:
   - Older record (more history)
   - More contacts and deals associated
   - More complete data (7 fields vs 3 fields)
   - More recent activity

4. PRESENT RECOMMENDATION:
   I found 2 duplicate records for TechStart.

   RECOMMENDED: Keep Company A (ID: 12345678901) as primary

   Reasons:
   ✅ Older record with more history (1 year vs 2 weeks)
   ✅ Has 3 contacts linked (vs 1)
   ✅ Has 2 deals linked (vs 0)
   ✅ More complete data (domain, industry, revenue, etc.)

   Company B will be merged into Company A and then deleted.
   All contacts, deals, and activities will be transferred.

   This action is IRREVERSIBLE. Proceed with merge?
```

### Finding Duplicate Contacts

```
User: "Check for duplicate contacts for john.smith@techstart.io"

Process:

1. FIND DUPLICATES:
   find_duplicate_contacts({ email: "john.smith@techstart.io" })

2. REVIEW RESULTS:
   📊 DUPLICATE CONTACTS FOUND

   Contact A (Primary Candidate):
   - ID: 11111111111
   - Name: John Smith
   - Email: john.smith@techstart.io
   - Created: 2024-06-15
   - Company: TechStart Inc (linked)
   - Has Data: title, phone, LinkedIn, city, state
   - Last Activity: 2025-12-28 (recent)

   Contact B (Secondary Candidate):
   - ID: 22222222222
   - Name: John Smith
   - Email: john.smith@techstart.io
   - Created: 2025-01-10
   - Company: Not linked
   - Has Data: name, email only
   - Last Activity: 2025-01-10 (creation date)

3. RECOMMEND:
   ✅ Keep Contact A as primary:
   - Older, more established record
   - Linked to company (Contact B is not)
   - Much more complete data
   - Recent activity shows active engagement
```

### Merging Duplicate Records

**CRITICAL RULES:**
- ⚠️ **Merges are IRREVERSIBLE** - secondary record is permanently deleted
- Always use `find_duplicate_companies` or `find_duplicate_contacts` FIRST
- Always ASK USER which record to keep as primary
- Review data completeness - keep the record with more information
- Check for legitimate non-duplicates (subsidiaries, franchises)

```
User: "Merge those duplicate TechStart records"

Process:

1. CONFIRM WITH USER:
   ⚠️ MERGE CONFIRMATION REQUIRED

   You're about to merge:
   - Primary (KEEP): Company A (ID: 12345678901) - TechStart Inc
   - Secondary (DELETE): Company B (ID: 98765432109) - TechStart Innovations Inc

   This will:
   ✅ Transfer all contacts from B to A
   ✅ Transfer all deals from B to A
   ✅ Transfer all activities from B to A
   ✅ Delete Company B permanently

   ❌ This action CANNOT be undone

   Type "confirm" to proceed with merge.

2. USER CONFIRMS:
   User: "confirm"

3. EXECUTE MERGE:
   merge_duplicate_companies({
     primary_company_id: "12345678901",
     secondary_company_id: "98765432109"
   })

4. VERIFY MERGE:
   get_hubspot_company({ company_id: "12345678901" })
   → Confirm all contacts/deals transferred

5. REPORT SUCCESS:
   ✅ MERGE COMPLETE

   Primary Record (Kept): TechStart Inc
   - ID: 12345678901
   - Contacts: 4 (3 original + 1 transferred)
   - Deals: 2 (all retained)
   - All activities consolidated

   Secondary Record: DELETED (ID: 98765432109)

   HubSpot Record: https://app.hubspot.com/contacts/21088260/record/0-2/12345678901
```

### Common Duplicate Scenarios

**Scenario 1: Same Domain, Different Names**
```
Example:
- Record A: "Acme Corp" - acme.com
- Record B: "Acme Corporation" - acme.com

Analysis: Usually duplicates (same company, slight name variation)
Action: Merge, keep record with more data
```

**Scenario 2: Same Name, No Domains**
```
Example:
- Record A: "TechStart Inc" - no domain
- Record B: "TechStart Inc" - no domain

Analysis: May be duplicates (verify manually with location, contacts)
Action: Research before merging - could be different companies
```

**Scenario 3: Same Name, Different Domains**
```
Example:
- Record A: "Acme Inc" - acme.com
- Record B: "Acme Inc" - acme.ca

Analysis: Likely NOT duplicates (subsidiaries, regional offices, or different businesses)
Action: Do NOT merge - keep separate, note relationship if applicable
```

**Scenario 4: Same Email for Contacts**
```
Example:
- Contact A: john.smith@acme.com
- Contact B: john.smith@acme.com

Analysis: Usually duplicates (same person, same email)
Action: Merge, keep record with more data and company association
```

### Deduplication Best Practices

**✅ ALWAYS:**
- Search for duplicates BEFORE creating new records
- Use `find_duplicate_companies` or `find_duplicate_contacts` first
- Ask user confirmation before merging
- Review both records completely
- Keep the record with more contacts, deals, and activities
- Keep the record with more complete data
- Document merge actions in notes

**❌ NEVER:**
- Merge without user confirmation
- Merge without using find_duplicate tools first
- Assume same name = duplicate (verify with domain/email)
- Merge subsidiaries or related companies
- Merge without reviewing data completeness

### Proactive Deduplication

**During Lead Creation:**
```
Before creating new company:
1. search_hubspot_companies({ domain: "newcompany.com" })
2. If found: Update existing record instead
3. If not found: Create new record

Before creating new contact:
1. search_hubspot_contacts({ email: "person@company.com" })
2. If found: Update existing record instead
3. If not found: Create new record
```

**Regular Cleanup Schedule:**
```
Monthly: Run duplicate checks on recently created leads
- Find companies created in last 30 days
- Check each for duplicates
- Merge any found

Quarterly: Full database cleanup
- Find all companies with no domain
- Search for potential duplicates by name
- Verify and merge as needed
```

## Data Quality Checklist

### Lead Verification Checklist
- [ ] Search HubSpot for company by domain
- [ ] Use `verify_company_website` tool
- [ ] Check for recent activity (LinkedIn, news, etc.)
- [ ] Update HubSpot with verification status and date
- [ ] Take appropriate action (re-engage, mark inactive, etc.)

### Stale Lead Cleanup Checklist
- [ ] Define staleness threshold (30/60/90 days)
- [ ] Search HubSpot with date filters
- [ ] Verify website status for all stale leads
- [ ] Categorize: Active, Inactive, Unknown
- [ ] Update lifecycle stages appropriately
- [ ] Create re-engagement tasks for active leads
- [ ] Archive or mark inactive for closed businesses

### Deduplication Checklist
- [ ] Use `find_duplicate_companies` or `find_duplicate_contacts`
- [ ] Review BOTH records completely
- [ ] Compare: creation dates, data completeness, associations
- [ ] Identify which record to keep as primary
- [ ] Confirm with user BEFORE merging
- [ ] Execute merge with appropriate tool
- [ ] Verify all data transferred successfully
- [ ] Document merge in primary record notes

## Data Quality Metrics

Track these metrics to measure CRM health:

**Verification Metrics:**
- % of leads with verified websites
- # of inactive leads identified
- # of leads marked inactive per month

**Staleness Metrics:**
- Average days since last update
- % of leads not updated in 90+ days
- # of stale leads re-engaged successfully

**Duplication Metrics:**
- # of duplicate records found
- # of duplicates merged
- % of database with duplicates

**Completeness Metrics:**
- % of companies with all 12 priority fields
- % of contacts with email + title
- % of companies with LinkedIn URLs

## Quick Reference Commands

**Verify Website:**
```
verify_company_website({ domain: "example.com" })
```

**Find Stale Leads:**
```
search_hubspot_companies({
  query: "*",
  lifecycle_stage: "lead",
  lastmodifieddate_before: "YYYY-MM-DD"
})
```

**Find Duplicates:**
```
find_duplicate_companies({ domain: "example.com" })
find_duplicate_contacts({ email: "person@example.com" })
```

**Merge Duplicates:**
```
merge_duplicate_companies({
  primary_company_id: "[id]",
  secondary_company_id: "[id]"
})

merge_duplicate_contacts({
  primary_contact_id: "[id]",
  secondary_contact_id: "[id]"
})
```

---

**Clean data = effective sales. Verify, deduplicate, and maintain data quality regularly.**
