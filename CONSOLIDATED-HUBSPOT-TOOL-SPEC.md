# Consolidated HubSpot Search Tool Specification

**Created:** January 13, 2025
**Purpose:** Reduce 9 HubSpot tool calls → 2 calls (78% reduction) for common workflows
**Target:** All agents (canexport-claims, etg-writer, bcafe-writer, etc.)

---

## Problem Analysis

### Current Inefficiency: Audit Workflow Example

**User Query:** "Audit this expense for Spring Activator"

**Current Tool Calls (9 total):**
```
1. search_grant_applications(company_name="Spring Activator")
2. get_grant_application(deal_id)
3. get_project_email_history(deal_id)
4. search_project_emails(deal_id, "funding agreement")
5. get_email_details(email_id)
6. search_hubspot_contacts("tina@spring.is")
7. get_contact_files(contact_id)
8. read_hubspot_file(file_id)
9. memory_store(key, value)

⏱️ Time: 15-20 seconds
```

**Root Causes:**
1. **No fuzzy company name matching** - `search_grant_applications` requires exact name
   - User says: "Spring Activator"
   - HubSpot has: "Spring Activator Inc."
   - Result: 0 matches found (wrong answer)

2. **File discovery is 5-7 separate steps**
   - Funding agreements "orphaned" in HubSpot (not linked to deals)
   - Must traverse: emails → email details → sender → contact files → read file

3. **Mandatory email history loaded separately**
   - Agent instructions require email context when company mentioned
   - Currently separate API call

---

## Solution: Two Consolidated Tools

### Tool 1: `load_company_context`

**Purpose:** One-call loading of all company/deal context (replaces 3 calls)

**Signature:**
```javascript
load_company_context({
  company_name: string,           // Required - accepts fuzzy names
  grant_program?: string,         // Optional: "CanExport" | "ETG" | "BCAFE" | "Other"
  include_emails?: boolean,       // Default: true (per agent instructions)
  email_limit?: number,           // Default: 20
  load_funding_agreement?: boolean // Default: false (explicit only)
})
```

**Backend Logic:**
```javascript
// 1. Fuzzy company search
const companies = await searchHubSpotCompanies(company_name);
// Uses CONTAINS_TOKEN operator (already implemented)
// Returns: [{id: "12345", name: "Spring Activator Inc.", ...}]

// 2. Find deals for matched company (exact name now available)
const applications = await searchGrantApplications({
  company_name: companies[0].name,  // Exact name from HubSpot
  grant_program: grant_program
});

// 3. Load full deal details
const dealDetails = await getGrantApplication(applications[0].deal_id);

// 4. Load email history (if include_emails=true)
let emailSummary = null;
if (include_emails) {
  const emails = await getProjectEmailHistory(applications[0].deal_id, email_limit);
  emailSummary = {
    total: emails.length,
    inbound: emails.filter(e => e.direction === 'inbound').length,
    outbound: emails.filter(e => e.direction === 'outbound').length,
    most_recent: emails[0],
    recent_topics: extractTopics(emails.slice(0, 5))
  };
}

// 5. Load funding agreement (if requested)
let fundingAgreement = null;
if (load_funding_agreement) {
  fundingAgreement = await findAndReadFundingAgreement({
    deal_id: applications[0].deal_id
  });
}

return {
  company: companies[0],
  applications: [dealDetails],
  email_summary: emailSummary,
  funding_agreement: fundingAgreement
};
```

**Returns:**
```javascript
{
  company: {
    id: "12345",
    name: "Spring Activator Inc.",  // ← Exact HubSpot name returned
    domain: "spring.is"
  },

  applications: [
    {
      // Core fields
      deal_id: "35208052239",
      deal_name: "Spring Activator - CanExport SME",
      grant_program: "CanExport",
      status: "approved",
      project_number: "CEE-2024-SA-001",

      // Financial fields
      approvedFunding: "$50,000",
      claimed_so_far: "$12,500",
      remaining: "$37,500",

      // Timeline fields
      start_date: "2024-02-01",
      end_date: "2025-01-31",
      approval_date: "2024-01-25",

      // Claim tracking (agent-specific fields)
      claim_1_submitted: "2024-05-15",
      claim_1_amount: "$12,500",
      claim_2_due: "2024-11-30",
      next_claim_due: "2024-11-30",

      // Project details
      categories: ["A", "B", "C"],
      target_markets: ["Germany", "Netherlands"],

      // Contacts
      contacts: [
        {
          id: "550428",
          name: "Tina Ippel",
          email: "tina@spring.is",
          role: "CEO"
        }
      ]
    }
  ],

  // Email summary (for context enrichment - NOT displayed as stats)
  email_summary: {
    total: 23,
    inbound: 12,
    outbound: 11,
    most_recent: {
      date: "2024-11-10",
      subject: "Claim 2 preparation",
      from: "tina@spring.is",
      email_id: "999888777"
    },
    recent_topics: ["Claim 2 preparation", "Invoice questions", "Travel documentation"]
  },

  // Funding agreement (if load_funding_agreement=true)
  funding_agreement: {
    file_id: "195210192980",
    file_name: "Spring_Activator_FA.pdf",
    content: "FUNDING AGREEMENT\n\nProject: ...",
    parsed_fields: {
      project_period: { start: "2024-02-01", end: "2025-01-31" },
      approved_categories: ["A", "B", "C"],
      approved_funding: "$50,000"
    }
  }
}
```

**Fuzzy Matching Rules (Priority Order):**
1. **Exact match** (case insensitive)
   - "Spring Activator Inc." → "Spring Activator Inc." ✅

2. **Exact match without legal suffix**
   - "Spring Activator" → "Spring Activator Inc." ✅
   - Remove: Inc., Corp., Ltd., LLC, Corporation, Society, Association

3. **Partial name match (starts with)**
   - "Seagate" → "Seagate Mass Timber Corporation" ✅
   - "Haven" → "Haven Housing Society" ✅

4. **Word match (all words present)**
   - "Mass Timber Seagate" → "Seagate Mass Timber Corporation" ✅

5. **Acronym expansion**
   - "BCIT" → "British Columbia Institute of Technology" ✅

**Multiple Match Handling:**
```javascript
// If multiple companies match:
{
  matches: [
    {company_id: "123", name: "Spring Activator Inc.", confidence: 100},
    {company_id: "456", name: "Spring Water Corp.", confidence: 40}
  ],
  disambiguation_needed: true,
  suggested_match: {
    company_id: "123",
    name: "Spring Activator Inc.",
    reason: "Highest confidence match based on word overlap"
  }
}
```

---

### Tool 2: `find_and_read_funding_agreement`

**Purpose:** Automatic funding agreement discovery and reading (replaces 5-7 calls)

**Signature:**
```javascript
find_and_read_funding_agreement({
  // Option A: Provide deal_id directly
  deal_id?: string,

  // Option B: Provide company name (will find deal first)
  company_name?: string,
  grant_program?: string,

  // Control what's returned
  return_content?: boolean,      // Default: true
  max_content_length?: number,   // Default: 50000 chars
  parse_fields?: boolean         // Default: true (extract key data)
})
```

**Backend Logic:**
```javascript
// 1. If company_name provided, find deal_id first
if (company_name) {
  const context = await load_company_context({ company_name, grant_program });
  deal_id = context.applications[0].deal_id;
}

// 2. Search emails for funding agreement reference
const emails = await searchProjectEmails({
  deal_id,
  search_term: "funding agreement"
});

if (emails.length === 0) {
  // Fallback: Try deal files directly
  const dealFiles = await getDealFiles(deal_id);
  const faFile = dealFiles.find(f =>
    f.name.toLowerCase().includes('funding') &&
    f.name.toLowerCase().includes('agreement')
  );
  if (faFile) {
    return await readHubSpotFile(faFile.id);
  }
  return { error: "Funding agreement not found" };
}

// 3. Get email details to find file ID
const emailDetails = await getEmailDetails(emails[0].email_id);

// 4. Extract file ID from email HTML body
const fileIdMatch = emailDetails.htmlBody.match(/file\/(\d+)/);

if (fileIdMatch) {
  // Found file ID in email HTML - read directly
  const file = await readHubSpotFile(fileIdMatch[1]);
  return formatResponse(file);
}

// 5. Fallback: Search sender's contact files
const senderEmail = emailDetails.from;
const contacts = await searchHubSpotContacts(senderEmail);

if (contacts.length === 0) {
  return { error: "Could not find sender contact" };
}

const contactFiles = await getContactFiles(contacts[0].contact_id);
const faFile = contactFiles.find(f =>
  f.name.toLowerCase().includes('funding') ||
  f.name.toLowerCase().includes('agreement')
);

if (!faFile) {
  return { error: "Funding agreement file not found in contact files" };
}

// 6. Read the file
const file = await readHubSpotFile(faFile.id);

// 7. Parse key fields (if parse_fields=true)
if (parse_fields) {
  file.parsed_fields = parseFundingAgreement(file.content);
}

return formatResponse(file);
```

**Returns:**
```javascript
{
  file: {
    id: "195210192980",
    name: "Spring_Activator_Funding_Agreement.pdf",
    url: "https://app.hubspot.com/file-preview/21088260/file/195210192980/",
    uploaded_date: "2024-02-15",
    uploaded_by: {
      contact_id: "550428",
      name: "Tina Ippel",
      email: "tina@spring.is"
    }
  },

  // Full document content (if return_content=true)
  content: "FUNDING AGREEMENT\n\nProject: Spring Activator - CanExport SME\nProject Number: CEE-2024-SA-001\n\nApproved Categories:\n- Category A: International Business Travel\n- Category B: Marketing Materials\n- Category C: Translation Services\n\nProject Period: February 1, 2024 - January 31, 2025\n\nApproved Funding: $50,000 CAD (50% reimbursement rate)\n\nTarget Markets: Germany, Netherlands...",

  // Where the file was found
  discovery_path: "email_html",  // or "email_attachment", "deal_file", "contact_file"
  source_email_id: "87368673370",

  // Parsed key fields (if parse_fields=true)
  parsed_fields: {
    project_period: {
      start: "2024-02-01",
      end: "2025-01-31"
    },
    approved_categories: ["A", "B", "C"],
    approved_funding: "$50,000",
    target_markets: ["Germany", "Netherlands"],
    reimbursement_rate: "50%"
  }
}
```

**Discovery Strategy (Priority Order):**
1. **Email HTML body** - Check for file URLs with IDs (fastest)
2. **Email attachments** - Direct attachment metadata
3. **Deal files** - Files uploaded to deal record
4. **Contact files** - Files from sender's contact record (most common)

---

## Implementation Plan

### Phase 1: Backend Functions (src/tools/hubspot.js)

**File:** `src/tools/hubspot.js`

Add two new functions:

```javascript
/**
 * Load complete company context in one call
 * Replaces: search_grant_applications + get_grant_application + get_project_email_history
 */
export async function loadCompanyContext({
  company_name,
  grant_program,
  include_emails = true,
  email_limit = 20,
  load_funding_agreement = false
}) {
  // Implementation details above
}

/**
 * Find and read funding agreement automatically
 * Replaces: search_project_emails + get_email_details + search_hubspot_contacts + get_contact_files + read_hubspot_file
 */
export async function findAndReadFundingAgreement({
  deal_id,
  company_name,
  grant_program,
  return_content = true,
  max_content_length = 50000,
  parse_fields = true
}) {
  // Implementation details above
}

/**
 * Parse funding agreement content to extract key fields
 */
function parseFundingAgreement(content) {
  // Extract project dates, categories, funding, markets using regex/NLP
  return {
    project_period: extractDates(content),
    approved_categories: extractCategories(content),
    approved_funding: extractFunding(content),
    target_markets: extractMarkets(content),
    reimbursement_rate: extractRate(content)
  };
}
```

### Phase 2: Tool Definitions (src/tools/definitions.js)

**File:** `src/tools/definitions.js`

Add to `HUBSPOT_TOOLS` array:

```javascript
{
  name: 'load_company_context',
  description: 'Load complete company and grant application context in one call. Uses fuzzy name matching (e.g., "Spring Activator" finds "Spring Activator Inc."). Returns company details, all grant applications, financial status, claim tracking, timeline, contacts, and optional email summary. Use this FIRST when a user mentions a company name to get comprehensive context. Replaces multiple search calls.',
  input_schema: {
    type: 'object',
    properties: {
      company_name: {
        type: 'string',
        description: 'Company name (fuzzy matching - accepts partial names, without legal suffixes, etc.)'
      },
      grant_program: {
        type: 'string',
        enum: ['CanExport', 'ETG', 'BCAFE', 'Other'],
        description: 'Optional: Filter applications by grant program'
      },
      include_emails: {
        type: 'boolean',
        description: 'Include email summary for context enrichment (default: true)',
        default: true
      },
      email_limit: {
        type: 'number',
        description: 'Number of recent emails to analyze for context (default: 20)',
        default: 20
      },
      load_funding_agreement: {
        type: 'boolean',
        description: 'Automatically find and read funding agreement (default: false - use for audit workflows)',
        default: false
      }
    },
    required: ['company_name']
  }
},
{
  name: 'find_and_read_funding_agreement',
  description: 'Automatically discover and read a funding agreement PDF. Searches emails, deal files, and contact files to find the document. Returns full content plus parsed key fields (project dates, approved categories, funding amount, target markets). Use when you need funding agreement details for compliance auditing.',
  input_schema: {
    type: 'object',
    properties: {
      deal_id: {
        type: 'string',
        description: 'HubSpot deal ID (if known)'
      },
      company_name: {
        type: 'string',
        description: 'Company name (will find deal first if deal_id not provided)'
      },
      grant_program: {
        type: 'string',
        enum: ['CanExport', 'ETG', 'BCAFE', 'Other'],
        description: 'Grant program filter (if company has multiple deals)'
      },
      return_content: {
        type: 'boolean',
        description: 'Return full document content (default: true)',
        default: true
      },
      max_content_length: {
        type: 'number',
        description: 'Maximum content length to return (default: 50000 chars)',
        default: 50000
      },
      parse_fields: {
        type: 'boolean',
        description: 'Extract key fields from document (default: true)',
        default: true
      }
    }
  }
}
```

### Phase 3: Tool Executor (src/tools/executor.js)

**File:** `src/tools/executor.js`

Add cases to `executeToolCall()`:

```javascript
case 'load_company_context':
  return await loadCompanyContext(input);

case 'find_and_read_funding_agreement':
  return await findAndReadFundingAgreement(input);
```

### Phase 4: Agent Prompt Updates

**All agent prompts (.claude/agents/*.md):**

Update `<tool_efficiency_rules>` section to reference new tools:

```xml
<efficient_workflow_examples>
**Example 1: Status Check**
User: "Has Seagate Mass Timber CanEx been approved?"

✅ EFFICIENT (1 tool):
• load_company_context(company_name="Seagate Mass Timber", grant_program="CanExport")
• Answer with approval status immediately

❌ INEFFICIENT (7+ tools):
• search_hubspot_companies("Seagate")
• search_grant_applications(grant_program="CanExport")
• get_grant_application(deal_id)
• Answer

**Example 2: Expense Audit**
User: "Audit this invoice for Spring Activator"

✅ EFFICIENT (2 tools):
• load_company_context(company_name="Spring Activator", load_funding_agreement=true)
• Audit expense against funding agreement → Report findings

❌ INEFFICIENT (9+ tools):
• search_hubspot_companies("Spring Activator")
• search_grant_applications(company_name)
• get_grant_application(deal_id)
• get_project_email_history(deal_id)
• search_project_emails(deal_id, "funding agreement")
• get_email_details(email_id)
• search_hubspot_contacts(sender_email)
• get_contact_files(contact_id)
• read_hubspot_file(file_id)
• Audit expense
</efficient_workflow_examples>
```

---

## Performance Impact

### Before Optimization

**Query:** "Audit this invoice for Spring Activator"

```
Tool calls: 9
├─ search_grant_applications      2.2s
├─ get_grant_application          1.8s
├─ get_project_email_history      2.5s
├─ search_project_emails          2.0s
├─ get_email_details              1.5s
├─ search_hubspot_contacts        1.8s
├─ get_contact_files              1.6s
├─ read_hubspot_file              2.4s
└─ memory_store                   0.2s

⏱️ Total: 16.0 seconds (HubSpot API time)
🤖 + Claude iterations: ~40 seconds total
```

### After Optimization

**Same Query:**

```
Tool calls: 2
├─ load_company_context(
│    company_name="Spring Activator",
│    load_funding_agreement=true
│  )                               4.5s (parallel backend calls)
└─ memory_store                   0.2s

⏱️ Total: 4.7 seconds (HubSpot API time)
🤖 + Claude iterations: ~12 seconds total

💡 Backend parallelization:
   - Company search + Application search
   - Email history load
   - Funding agreement discovery
   All run concurrently
```

**Performance Gains:**
- **Tool calls:** 9 → 2 (78% reduction)
- **API time:** 16s → 4.7s (71% reduction)
- **Total time:** 40s → 12s (70% reduction)

---

## Testing Strategy

### Test Cases

**1. Fuzzy Company Name Matching**
```javascript
// Test exact match
load_company_context({ company_name: "Spring Activator Inc." })
// Expected: Match "Spring Activator Inc."

// Test without legal suffix
load_company_context({ company_name: "Spring Activator" })
// Expected: Match "Spring Activator Inc."

// Test partial name
load_company_context({ company_name: "Seagate" })
// Expected: Match "Seagate Mass Timber Corporation"

// Test acronym
load_company_context({ company_name: "BCIT" })
// Expected: Match "British Columbia Institute of Technology"

// Test multiple matches
load_company_context({ company_name: "Spring" })
// Expected: Return disambiguation with top match
```

**2. Funding Agreement Discovery**
```javascript
// Test email HTML discovery
find_and_read_funding_agreement({ deal_id: "35208052239" })
// Expected: Find file ID in email HTML, return content

// Test contact file fallback
find_and_read_funding_agreement({
  company_name: "Haven Housing",
  grant_program: "CanExport"
})
// Expected: Search sender's contact files, return content

// Test parsing
find_and_read_funding_agreement({
  deal_id: "35208052239",
  parse_fields: true
})
// Expected: Return parsed_fields with dates, categories, funding
```

**3. End-to-End Workflow**
```javascript
// Simulate audit workflow
const context = await load_company_context({
  company_name: "Spring Activator",
  load_funding_agreement: true
});

// Verify all data present
assert(context.company.name === "Spring Activator Inc.");
assert(context.applications.length > 0);
assert(context.applications[0].claimed_so_far !== undefined);
assert(context.funding_agreement.content.includes("FUNDING AGREEMENT"));
assert(context.funding_agreement.parsed_fields.approved_categories.length > 0);
```

---

## Rollback Plan

If issues arise:

**1. Keep existing tools active**
   - Don't remove old tools immediately
   - New tools coexist with old tools
   - Agents can fall back to old tools if new tools fail

**2. Feature flag**
   ```javascript
   const USE_CONSOLIDATED_TOOLS = process.env.USE_CONSOLIDATED_TOOLS === 'true';

   if (USE_CONSOLIDATED_TOOLS) {
     return await loadCompanyContext(...);
   } else {
     // Fall back to old workflow
     const apps = await searchGrantApplications(...);
     const details = await getGrantApplication(...);
     // etc.
   }
   ```

**3. Gradual rollout**
   - Phase 1: Deploy with feature flag OFF
   - Phase 2: Test with canexport-claims agent only
   - Phase 3: Enable for all agents
   - Phase 4: Remove old tools after 2 weeks of stability

---

## Success Criteria

✅ **Speed:** 70%+ reduction in total query time for common workflows
✅ **Accuracy:** Fuzzy matching finds correct company 95%+ of the time
✅ **Reliability:** Funding agreement discovery success rate >90%
✅ **Quality:** No wrong answers due to company name mismatch
✅ **Adoption:** Agents use new tools >80% of the time for context loading

---

## Next Steps

1. ✅ Design complete (this document)
2. ⏳ Implement `loadCompanyContext()` in hubspot.js
3. ⏳ Implement `findAndReadFundingAgreement()` in hubspot.js
4. ⏳ Add tool definitions to definitions.js
5. ⏳ Update tool executor
6. ⏳ Update agent prompts with new workflow examples
7. ⏳ Test with canexport-claims agent
8. ⏳ Deploy to development branch
9. ⏳ Verify on Railway with real queries
10. ⏳ Merge to main if successful
