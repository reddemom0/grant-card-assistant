# HubSpot Tools Enhancement Plan for Oracle

**Date:** January 14, 2026
**Purpose:** Complete Oracle's HubSpot READ capabilities

---

## Current State (What Oracle Already Has)

### ✅ Contacts (2 tools)
- `search_hubspot_contacts` - Search by name, email, company
- `get_hubspot_contact` - Get by contact ID

### ✅ Companies (1 tool)
- `search_hubspot_companies` - Search by name, domain, industry, revenue

### ✅ Deals/Grant Applications (2 tools)
- `search_grant_applications` - Search by program, status, company, deal name, dates
- `get_grant_application` - Get by deal ID

### ✅ Emails (4 tools)
- `get_project_email_history` - All emails for a deal
- `search_project_emails` - Search emails by keywords
- `get_email_details` - Full email content
- `get_email_attachments` - List attachments

### ✅ Files (4 tools)
- `get_deal_files` - Files attached to deals
- `get_contact_files` - Files attached to contacts
- `get_file_by_id` - Direct file access
- `read_hubspot_file` - Extract text from PDF/DOCX

### ✅ Consolidated Tools (2 tools)
- `load_company_context` - ONE-CALL company + deals + emails
- `find_and_read_funding_agreement` - Auto-find and read funding agreement

**Total Current Tools: 15**

---

## Phase 1: Essential Quick Wins (Priority: HIGH)

### 1. Direct Lookups (3 new tools)

**Why:** Much faster than search, common use cases

#### `get_contact_by_email(email)`
```javascript
{
  name: 'get_contact_by_email',
  description: 'Get contact details directly by email address. Faster than searching.',
  input_schema: {
    properties: {
      email: { type: 'string' },
      properties: { type: 'array', items: { type: 'string' } }
    }
  }
}
```
**Use case:** "Get john@techco.com's contact info"

#### `get_company_by_id(company_id)`
```javascript
{
  name: 'get_company_by_id',
  description: 'Get company details by HubSpot company ID.',
  input_schema: {
    properties: {
      company_id: { type: 'string' },
      properties: { type: 'array', items: { type: 'string' } }
    }
  }
}
```
**Use case:** "Get company details for ID 12345"

#### `get_company_by_domain(domain)`
```javascript
{
  name: 'get_company_by_domain',
  description: 'Get company details by domain name. Faster than searching.',
  input_schema: {
    properties: {
      domain: { type: 'string' },
      properties: { type: 'array', items: { type: 'string' } }
    }
  }
}
```
**Use case:** "Find the company for techco.com"

---

## Phase 2: Grants Custom Object (Priority: HIGH)

**Discovery:** 829 grant programs in HubSpot Grants object

### 2. Grants Object Tools (3 new tools)

#### `search_grants(filters)`
```javascript
{
  name: 'search_grants',
  description: 'Search the master grant catalog (829 programs). Find available grants by type, province, industry, deadline, etc.',
  input_schema: {
    properties: {
      grant_type: { enum: ['Hiring', 'Training', 'Market Expansion', ...] },
      grant_sub_type: { type: 'string' },
      province: { enum: ['British Columbia', 'Ontario', 'Alberta', ...] },
      industry: { type: 'array' },
      business_type: { enum: ['Incorporated', 'Non-Profit', ...] },
      participant_type: { enum: ['Youth', 'Students', 'Newcomers', ...] },
      intakes_currently_open: { type: 'boolean' },
      availability: { enum: ['Open', 'Closed', 'Upcoming'] },
      deadline_before: { type: 'string', format: 'date' },
      deadline_after: { type: 'string', format: 'date' },
      minimum_funding: { type: 'number' },
      maximum_funding: { type: 'number' },
      grant_name: { type: 'string' },
      grant_organisation: { type: 'string' },
      limit: { type: 'number', default: 10 }
    }
  }
}
```
**Use cases:**
- "What hiring grants are available in BC?"
- "Find grants with deadlines in the next 30 days"
- "Show me grants with at least $50,000 funding"

#### `get_grant(grant_id)`
```javascript
{
  name: 'get_grant',
  description: 'Get detailed information about a specific grant program from the catalog.',
  input_schema: {
    properties: {
      grant_id: { type: 'string' },
      properties: { type: 'array', items: { type: 'string' } }
    }
  }
}
```
**Use case:** "What's the deadline for grant ID 7140766094?"

#### `list_all_grants(pagination)`
```javascript
{
  name: 'list_all_grants',
  description: 'Browse all grants in the catalog with pagination.',
  input_schema: {
    properties: {
      limit: { type: 'number', default: 10, maximum: 100 },
      after: { type: 'string' },
      properties: { type: 'array' }
    }
  }
}
```
**Use case:** "Show me all grants" (paginated browsing)

---

## Phase 3: HubSpot Embed Links (Priority: MEDIUM)

### 3. Interactive HubSpot Views (1 new tool)

**Why:** Give team live, interactive HubSpot interfaces instead of static text

#### `generate_hubspot_embed_link(object_type, record_id, view)`
```javascript
{
  name: 'generate_hubspot_embed_link',
  description: 'Generate an interactive HubSpot embed URL. Opens live timeline, workflows, properties, or meetings view for a record.',
  input_schema: {
    properties: {
      object_type: {
        enum: ['contact', 'company', 'deal', 'ticket', 'grants'],
        description: 'Type of HubSpot record'
      },
      record_id: {
        type: 'string',
        description: 'HubSpot record ID'
      },
      view: {
        enum: ['timeline', 'workflows', 'sequences', 'properties', 'meetings'],
        default: 'timeline',
        description: 'Which view to display'
      }
    }
  }
}
```

**Output format:**
```
https://app.hubspot.com/embed/{hubId}/{objectTypeId}/{recordId}/{view}
```

**Use cases:**
- "Pull up TechCo's timeline" → Returns interactive link
- "Show me Sarah's meeting scheduler" → Returns meetings tab link
- "Open the DS4Y deal workflow status" → Returns workflows tab link

**Benefits:**
- User can interact with record (add notes, schedule meetings)
- Always shows live data
- Access associated records
- Full HubSpot functionality

---

## Phase 4: List All Records (Priority: MEDIUM)

### 4. Pagination Tools (3 new tools)

**Why:** Support "show me everything" queries

#### `list_all_contacts(pagination)`
```javascript
{
  name: 'list_all_contacts',
  description: 'List all contacts with pagination. Supports browsing entire contact database.',
  input_schema: {
    properties: {
      limit: { type: 'number', default: 10, maximum: 100 },
      after: { type: 'string', description: 'Pagination cursor from previous response' },
      properties: { type: 'array' }
    }
  }
}
```

#### `list_all_companies(pagination)`
```javascript
{
  name: 'list_all_companies',
  description: 'List all companies with pagination.',
  input_schema: {
    properties: {
      limit: { type: 'number', default: 10, maximum: 100 },
      after: { type: 'string' },
      properties: { type: 'array' }
    }
  }
}
```

#### `list_all_deals(pagination)`
```javascript
{
  name: 'list_all_deals',
  description: 'List all deals with pagination.',
  input_schema: {
    properties: {
      limit: { type: 'number', default: 10, maximum: 100 },
      after: { type: 'string' },
      properties: { type: 'array' }
    }
  }
}
```

**Use cases:**
- "Show me all our contacts"
- "List all companies"
- "Browse all deals"

---

## Phase 5: Advanced Features (Priority: LOW)

### 5. Enhanced Search Filters

**Add to existing search tools:**

#### Enhanced `search_hubspot_contacts`
- Add date range filters: `created_after`, `created_before`, `modified_after`, `modified_before`
- Add lifecycle stage filters
- Add owner/team filters

#### Enhanced `search_hubspot_companies`
- Add date filters
- Add owner/team filters

#### Enhanced `search_grant_applications`
- ✅ Already has date filters
- Add team member filters: `writer`, `strategist`, `claims_specialist`
- Add pipeline filter (beyond just grant_program)

### 6. Property History Support

**Add to existing get tools:**
- Support `propertiesWithHistory` parameter
- Returns current + historical values for properties
- Shows when values changed

**Use case:** "Show me all the times this deal's stage changed"

### 7. Batch Read Operations

**Add batch versions:**
- `batch_read_contacts` - Get multiple contacts by ID
- `batch_read_companies` - Get multiple companies by ID
- `batch_read_deals` - Get multiple deals by ID

**Why:** More efficient when retrieving multiple records

---

## Summary: Total New Tools

### Phase 1 (Essential): 3 tools
- get_contact_by_email
- get_company_by_id
- get_company_by_domain

### Phase 2 (Grants): 3 tools
- search_grants
- get_grant
- list_all_grants

### Phase 3 (Embed): 1 tool
- generate_hubspot_embed_link

### Phase 4 (Pagination): 3 tools
- list_all_contacts
- list_all_companies
- list_all_deals

### Phase 5 (Advanced): Enhancements to existing tools
- Enhanced search filters
- Property history
- Batch operations

**Total New Tools: 10 core tools + enhancements**

---

## Implementation Order

1. **Phase 1 (3 tools)** - Quick wins, high impact
2. **Phase 2 (3 tools)** - Grants object is unique to your business
3. **Phase 3 (1 tool)** - Embed links are a UX game-changer
4. **Phase 4 (3 tools)** - If team needs browsing capability
5. **Phase 5** - Only if specific needs arise

---

## Questions Before Implementation

1. **Phase 1-3:** Should we implement all 7 core tools (Phases 1-3)?
2. **Phase 4:** Do you need "list all" tools or will search always suffice?
3. **Phase 5:** Do you need property history? Team member filters?
4. **Grants Object:** Should Oracle search GetGranted AND HubSpot Grants object? Or just one?

---

## Next Steps

Once approved:
1. Add tool definitions to `src/tools/definitions.js`
2. Implement functions in `src/tools/hubspot.js`
3. Add executor routing in `src/tools/executor.js`
4. Update Oracle instructions in `.claude/agents/internal-oracle.md`
5. Test each tool
6. Deploy to Railway
