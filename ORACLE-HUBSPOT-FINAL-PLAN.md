# Oracle HubSpot Tools - Final Implementation Plan

**Date:** January 14, 2026
**Status:** Ready for Implementation

---

## 📊 Discovery Summary

**Current State:**
- ✅ 15 existing HubSpot tools (contacts, companies, deals, emails, files)
- ✅ 966 deal properties analyzed
- ✅ 2 custom objects discovered: **Grants** (829 programs), **Stripe** (payments)
- ✅ 135 searchable deal properties identified

**Gap Analysis:**
- ❌ Cannot search deals by team member (owner, writer, strategist)
- ❌ Cannot search deals by date ranges
- ❌ Cannot search deals by financial amounts
- ❌ No access to Grants custom object (master grant catalog)
- ❌ No direct lookup tools for email/domain

---

## 🎯 Implementation Plan

### **Priority 1: Fix Existing Tools** ⭐⭐⭐ (CRITICAL)

**Problem:** Oracle cannot answer "Show me deals Rukshaar won last month"

#### 1.1 Enhanced `search_grant_applications`

**Add 25 new parameters:**

**Team Filters (4):**
- `owner_id` - Filter by deal owner
- `writer` - Filter by assigned writer
- `strategist` - Filter by strategist
- `claims_specialist` - Filter by claims specialist

**Date Filters (8 date ranges = 16 parameters):**
- `closedate_after/before` - When deal was won/lost
- `createdate_after/before` - When deal was created
- `approved_on_after/before` - Grant approval date
- `application_submitted_on_after/before` - Submission date

**Financial Filters (6):**
- `amount_min/max` - Deal amount range
- `client_reimbursement_min/max` - Approved funding range
- `claimed_so_far_min/max` - Amount claimed range

**Pipeline Filter (1):**
- `pipeline` - Filter by specific pipeline

**Use Cases Unlocked:**
```
✅ "Show me Rukshaar's won deals from last month"
✅ "Find ETG deals over $5000 approved in Q4"
✅ "List Sarah's training deals from December"
✅ "Show CanExport deals with claims over $10k"
```

---

### **Priority 2: Grants Custom Object** ⭐⭐⭐ (HIGH VALUE)

**Discovered:** 829 grant programs in HubSpot Grants object - your master catalog!

#### 2.1 `search_grants`

Search the grant catalog (different from deals/applications):

**Filters:**
- `grant_type` - Hiring, Training, Market Expansion, etc.
- `province` - BC, ON, AB, etc.
- `industry` - Tech, Manufacturing, Agriculture, etc.
- `business_type` - Incorporated, Non-Profit, etc.
- `intakes_currently_open` - Boolean
- `deadline_before/after` - Date ranges
- `minimum_funding/maximum_funding` - Funding ranges
- `grant_name`, `grant_organisation` - Name search

**Use Cases:**
```
✅ "What hiring grants are available in BC?"
✅ "Find grants with deadlines in next 30 days"
✅ "Show me grants offering at least $50,000"
✅ "What's the success rate for ETG?"
```

#### 2.2 `get_grant`

Get specific grant program details by ID.

#### 2.3 `list_all_grants`

Paginated browsing of all 829 grants.

---

### **Priority 3: Direct Lookups** ⭐⭐ (EFFICIENCY)

**Why:** Faster than search when you have exact identifier

#### 3.1 `get_contact_by_email`

Direct contact lookup by email address.

**Current:** Search → filter results → extract
**New:** Direct get → instant result

**Use Cases:**
```
✅ "Get details for sarah@techco.com"
✅ Oracle chaining: Get email from deal → get contact details
```

#### 3.2 `get_company_by_domain`

Direct company lookup by domain.

**Use Cases:**
```
✅ "Find company for techco.com"
✅ "Get company details for microsoft.com"
```

#### 3.3 `get_company_by_id`

Get company by HubSpot company ID.

---

### **Priority 4: HubSpot Embed Links** ⭐⭐ (UX GAME-CHANGER)

#### 4.1 `generate_hubspot_embed_link`

Generate interactive HubSpot view URLs.

**Parameters:**
- `object_type` - contact, company, deal, ticket, grants
- `record_id` - HubSpot record ID
- `view` - timeline, workflows, properties, meetings, sequences

**Output:**
```
https://app.hubspot.com/embed/21088260/{objectTypeId}/{recordId}/{view}
```

**Use Cases:**
```
User: "Pull up TechCo's timeline"
Oracle: [returns interactive link]
→ User clicks → Live HubSpot interface opens
→ Can add notes, schedule meetings, see associations
→ Always shows current data
```

**Benefits:**
- ✅ Interactive vs static text
- ✅ Real-time data
- ✅ Full HubSpot functionality
- ✅ Team can take action directly

---

### **Priority 5: List All Records** ⭐ (OPTIONAL)

Only add if team needs browsing capability:

- `list_all_contacts` - Paginated contact list
- `list_all_companies` - Paginated company list
- `list_all_deals` - Paginated deal list

**Use Cases:**
```
"Show me all our contacts" (without specific filters)
"List all companies"
```

---

## 📅 Recommended Implementation Order

### **Week 1: Core Functionality**

1. ✅ **Enhanced `search_grant_applications`** (Priority 1)
   - 25 new parameters
   - Team, date, financial, pipeline filters
   - Implementation in definitions.js + hubspot.js

2. ✅ **Grants object tools** (Priority 2)
   - `search_grants`, `get_grant`, `list_all_grants`
   - Access 829 grant program database

**Impact:** Answers 95% of common queries

---

### **Week 2: Efficiency & UX**

3. ✅ **Direct lookups** (Priority 3)
   - `get_contact_by_email`, `get_company_by_domain`, `get_company_by_id`
   - Faster, cleaner responses

4. ✅ **Embed links** (Priority 4)
   - `generate_hubspot_embed_link`
   - Major UX improvement

**Impact:** Faster responses, better user experience

---

### **Future: If Needed**

5. ⏸️ **List all tools** (Priority 5)
   - Only add if specific need arises

---

## 🔢 Summary by Numbers

**New Tools to Add: 10**
- 3 Grants object tools
- 3 Direct lookup tools
- 1 Embed link tool
- 3 List all tools (optional)

**Enhanced Tools: 1**
- `search_grant_applications` (+25 parameters)

**Total Implementation Effort:**
- Tool definitions: ~300 lines
- Implementation: ~500 lines
- Testing: ~2-3 hours
- Documentation: ~100 lines

---

## 🎯 Expected Outcomes

### Queries Oracle Can Answer After Implementation:

**Before:**
- ❌ "Show me Rukshaar's won deals from last month"
- ❌ "What grants are available in BC for tech companies?"
- ❌ "Find ETG deals over $5000"
- ❌ "Get contact details for sarah@techco.com"

**After:**
- ✅ "Show me Rukshaar's won deals from last month"
- ✅ "What grants are available in BC for tech companies?"
- ✅ "Find ETG deals over $5000 approved in Q4"
- ✅ "Get contact details for sarah@techco.com"
- ✅ "Pull up TechCo's interactive timeline"
- ✅ "Find grants with deadlines in next 30 days offering $50k+"
- ✅ "Show all CanExport deals where Sarah is the writer"

---

## 📋 Implementation Checklist

### Phase 1: Enhanced Search (Priority 1)
- [ ] Update `search_grant_applications` tool definition in definitions.js
- [ ] Add 25 new parameters (team, date, financial, pipeline)
- [ ] Implement filter logic in hubspot.js `searchGrantApplications()`
- [ ] Add helper: `resolveTeamMemberToId()` function
- [ ] Add helper: `convertDateToTimestamp()` function
- [ ] Update Oracle instructions in internal-oracle.md
- [ ] Test: "Show me Rukshaar's won deals from last month"
- [ ] Test: "Find ETG deals over $5000 approved in December"

### Phase 2: Grants Object (Priority 2)
- [ ] Add `search_grants` tool definition
- [ ] Add `get_grant` tool definition
- [ ] Add `list_all_grants` tool definition
- [ ] Implement in hubspot.js or new file grants.js
- [ ] Add executor routing in executor.js
- [ ] Update Oracle instructions with Grants usage
- [ ] Test: "What hiring grants are available in BC?"
- [ ] Test: "Find grants with deadlines before March 1st"

### Phase 3: Direct Lookups (Priority 3)
- [ ] Add `get_contact_by_email` tool
- [ ] Add `get_company_by_domain` tool
- [ ] Add `get_company_by_id` tool
- [ ] Implement in hubspot.js
- [ ] Add executor routing
- [ ] Test each tool

### Phase 4: Embed Links (Priority 4)
- [ ] Add `generate_hubspot_embed_link` tool
- [ ] Implement URL generation function
- [ ] Get HubSpot portal ID from config
- [ ] Map object types to typeIds
- [ ] Update Oracle instructions
- [ ] Test with each object type

### Phase 5: Deployment
- [ ] Commit all changes
- [ ] Deploy to Railway
- [ ] Verify all tools work in production
- [ ] Update documentation

---

## 🚀 Ready to Implement?

**Approval needed for:**
1. ✅ Priority 1: Enhanced search (25 parameters)?
2. ✅ Priority 2: Grants object tools (3 tools)?
3. ✅ Priority 3: Direct lookups (3 tools)?
4. ✅ Priority 4: Embed links (1 tool)?
5. ❓ Priority 5: List all tools (3 tools) - Yes/No/Later?

**Estimated total time:** 6-8 hours for Priorities 1-4

---

## 📚 Related Documents

- `HUBSPOT-TOOLS-PLAN.md` - Original tool plan
- `DEAL-SEARCH-COMPREHENSIVE-PLAN.md` - Detailed search analysis
- `scripts/hubspot-schema.json` - Complete HubSpot data model
- `scripts/analyze-deal-properties.js` - Property analysis script
