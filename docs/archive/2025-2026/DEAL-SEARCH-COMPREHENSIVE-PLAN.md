# Comprehensive Deal Search Plan for Oracle

**Analysis Date:** January 14, 2026
**Total Deal Properties:** 966
**Searchable Properties:** 135
**Display-Only Properties:** 752

---

## 📊 Property Categories

Based on analysis of all 966 deal properties:

| Category | Count | Purpose |
|----------|-------|---------|
| **Identification** | 3 | dealname, grant_type, currency |
| **Team Members** | 11 | Owners, writers, strategists, collaborators |
| **Dates & Timeline** | 50 | Application dates, approval dates, claim deadlines, etc. |
| **Financial & Budget** | 31 | Amounts, claims, fees, funding |
| **Status & Stage** | 13 | Deal stage, state, grant stage |
| **Grant Program Info** | 15 | Grant-specific fields |
| **CanExport Claims** | 2 | CanExport-specific |
| **ETG Training** | 6 | ETG training-specific |
| **Company Info** | 2 | Company references |
| **Workflow & Pipeline** | 2 | Pipeline tracking |
| **System/Calculated** | 752 | Auto-calculated, display-only |

---

## 🎯 Recommended Search Tool Design

### Design Philosophy

**Problem:** 135 searchable parameters would be overwhelming for Oracle to understand and use effectively.

**Solution:** Three-tier approach with most common filters always available.

---

### **Tier 1: Core Filters** (Always Available)

These cover 90% of common queries:

```javascript
{
  name: 'search_grant_applications',
  description: 'Search deals/grant applications with comprehensive filters',
  input_schema: {
    type: 'object',
    properties: {

      // ============ IDENTIFICATION ============
      grant_program: {
        type: 'string',
        enum: ['ETG', 'BCAFE', 'BC MDP', 'CanExport', 'DS4Y', ...],
        description: 'Filter by grant program type'
      },
      deal_name: {
        type: 'string',
        description: 'Search deal names (partial match supported)'
      },
      company_name: {
        type: 'string',
        description: 'Filter by company name'
      },

      // ============ STATUS ============
      status: {
        type: 'string',
        enum: ['draft', 'in_progress', 'submitted', 'approved', 'won', 'lost', ...],
        description: 'Filter by deal state'
      },
      dealstage: {
        type: 'string',
        description: 'Filter by specific pipeline stage ID'
      },
      pipeline: {
        type: 'string',
        description: 'Filter by pipeline (e.g., "Hiring Grants Pipeline", "Training Grants Pipeline")'
      },

      // ============ TEAM MEMBERS ============
      owner_id: {
        type: 'string',
        description: 'Filter by deal owner (HubSpot user ID or name). Example: "Rukshaar"'
      },
      writer: {
        type: 'string',
        description: 'Filter by assigned writer'
      },
      strategist: {
        type: 'string',
        description: 'Filter by strategist'
      },
      claims_specialist: {
        type: 'string',
        description: 'Filter by claims specialist'
      },

      // ============ KEY DATES ============
      // Close date (when deal was won/lost)
      closedate_after: {
        type: 'string',
        format: 'date',
        description: 'Deals closed after this date (YYYY-MM-DD)'
      },
      closedate_before: {
        type: 'string',
        format: 'date',
        description: 'Deals closed before this date (YYYY-MM-DD)'
      },

      // Create date
      createdate_after: {
        type: 'string',
        format: 'date',
        description: 'Deals created after this date'
      },
      createdate_before: {
        type: 'string',
        format: 'date',
        description: 'Deals created before this date'
      },

      // Approval date
      approved_on_after: {
        type: 'string',
        format: 'date',
        description: 'Grants approved after this date'
      },
      approved_on_before: {
        type: 'string',
        format: 'date',
        description: 'Grants approved before this date'
      },

      // Submission date
      application_submitted_on_after: {
        type: 'string',
        format: 'date',
        description: 'Applications submitted after this date'
      },
      application_submitted_on_before: {
        type: 'string',
        format: 'date',
        description: 'Applications submitted before this date'
      },

      // ============ FINANCIAL ============
      amount_min: {
        type: 'number',
        description: 'Minimum deal amount'
      },
      amount_max: {
        type: 'number',
        description: 'Maximum deal amount'
      },
      client_reimbursement_min: {
        type: 'number',
        description: 'Minimum approved funding (client reimbursement)'
      },
      client_reimbursement_max: {
        type: 'number',
        description: 'Maximum approved funding'
      },
      claimed_so_far_min: {
        type: 'number',
        description: 'Minimum amount claimed'
      },
      claimed_so_far_max: {
        type: 'number',
        description: 'Maximum amount claimed'
      },

      // ============ PAGINATION ============
      limit: {
        type: 'number',
        default: 10,
        maximum: 100,
        description: 'Maximum results to return'
      },
      properties: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific properties to return in results'
      }
    }
  }
}
```

---

### **Tier 2: Program-Specific Filters** (Extended Search)

Add these for specialized queries:

#### **CanExport-Specific:**
```javascript
// Add to input_schema.properties:
{
  claim_1_submitted: { type: 'boolean', description: 'Claim 1 submitted status' },
  claim_2_submitted: { type: 'boolean' },
  claim_3_submitted: { type: 'boolean' },
  claim_4_submitted: { type: 'boolean' },
  next_claim_due_after: { type: 'string', format: 'date' },
  next_claim_due_before: { type: 'string', format: 'date' }
}
```

#### **ETG-Specific:**
```javascript
{
  tuition_fee_min: { type: 'number', description: 'Minimum tuition fee per person' },
  tuition_fee_max: { type: 'number', description: 'Maximum tuition fee' },
  training_hours_min: { type: 'number', description: 'Minimum training hours' },
  training_hours_max: { type: 'number', description: 'Maximum training hours' },
  training_delivery_method: {
    type: 'string',
    enum: ['Online', 'In-Person', 'Hybrid'],
    description: 'Training delivery method'
  }
}
```

---

## 🔨 Implementation Strategy

### **Phase 1: Implement Tier 1 Core Filters**

Update `search_grant_applications` to include:

1. **Team filters:** owner_id, writer, strategist, claims_specialist
2. **Date range filters:** closedate, createdate, approved_on, application_submitted_on (each with _after/_before)
3. **Financial filters:** amount, client_reimbursement, claimed_so_far (each with _min/_max)
4. **Pipeline filter:** pipeline

**Implementation in hubspot.js:**

```javascript
export async function searchGrantApplications(filters, agentType = null) {
  const hsFilters = [];

  // Owner/Team member filters
  if (filters.owner_id) {
    // Try to resolve name to ID if needed
    hsFilters.push({
      propertyName: 'hubspot_owner_id',
      operator: 'EQ',
      value: filters.owner_id
    });
  }

  if (filters.writer) {
    hsFilters.push({
      propertyName: 'real_assigned_writer',
      operator: 'CONTAINS_TOKEN',
      value: filters.writer
    });
  }

  // Date range filters
  if (filters.closedate_after) {
    hsFilters.push({
      propertyName: 'closedate',
      operator: 'GTE',
      value: convertToTimestamp(filters.closedate_after)
    });
  }

  if (filters.closedate_before) {
    hsFilters.push({
      propertyName: 'closedate',
      operator: 'LTE',
      value: convertToTimestamp(filters.closedate_before)
    });
  }

  // Financial range filters
  if (filters.amount_min) {
    hsFilters.push({
      propertyName: 'amount',
      operator: 'GTE',
      value: filters.amount_min
    });
  }

  // ... continue for all Tier 1 filters

  // Make search request
  const searchBody = {
    filterGroups: hsFilters.length > 0 ? [{ filters: hsFilters }] : [],
    properties: getFieldsForAgent(agentType),
    limit: filters.limit || 10
  };

  const response = await client.crm.deals.searchApi.doSearch(searchBody);
  return formatResults(response);
}
```

---

### **Phase 2: Add Tier 2 Program-Specific** (If Needed)

Only add if team frequently searches by these:
- Claim submission statuses
- Training-specific fields
- Export-specific fields

---

## 💡 Oracle's Understanding

### What Oracle Needs to Know

Add to `.claude/agents/internal-oracle.md`:

```markdown
## Searching Grant Applications (Deals)

You can search deals using **comprehensive filters**:

### **Common Query Patterns:**

**By team member:**
- "Show me Rukshaar's won deals" → owner_id="Rukshaar", status="won"
- "What deals is Sarah writing?" → writer="Sarah"

**By date range:**
- "Deals won last month" → closedate_after="2025-12-14", closedate_before="2026-01-14", status="won"
- "Approvals in Q4" → approved_on_after="2025-10-01", approved_on_before="2025-12-31"

**By financial amounts:**
- "Deals over $50k" → amount_min=50000
- "Claims between $10k-$30k" → claimed_so_far_min=10000, claimed_so_far_max=30000

**Combined filters:**
- "Show me ETG deals worth over $5000 that John wrote and were approved in December"
  → grant_program="ETG", amount_min=5000, writer="John", approved_on_after="2025-12-01", approved_on_before="2025-12-31"

### **Available Properties:**

**Identification:** grant_type, dealname, company_name, deal_currency_code

**Team:** hubspot_owner_id, writer, strategist, claims_specialist, external_writer_assigned

**Dates:** closedate, createdate, approved_on, application_submitted_on, start_date, end_date,
         claim_1_due through claim_10_due, next_claim_due, invoice_date, retainer_date_sent

**Financial:** amount, client_reimbursement (approved funding), claimed_so_far, tuition_fee,
              service_fee, grant_value

**Status:** state, dealstage, pipeline, grant_stage, contract_status

**CanExport:** claim_1/2/3/4_submitted

**ETG:** tuition_fee, training_hours_per_person, training_delivery_method
```

---

## 📋 Summary

### Immediate Action Items:

1. ✅ **Update `search_grant_applications` tool definition** with Tier 1 filters (25 new parameters)
2. ✅ **Implement filter logic in `searchGrantApplications` function**
3. ✅ **Update Oracle instructions** with comprehensive search examples
4. ✅ **Add helper function** to resolve team member names to IDs
5. ✅ **Add date conversion helper** (YYYY-MM-DD → Unix timestamp)

### This enables queries like:

- ✅ "Show me all deals Rukshaar won last month"
- ✅ "Find ETG deals with tuition over $5000"
- ✅ "List CanExport deals where claim 2 is submitted"
- ✅ "Show deals approved in Q4 2024 worth over $20k"
- ✅ "Find all training deals where Sarah is the writer"

---

**Ready to implement?** This gives Oracle comprehensive search capability across all deal properties that matter, without overwhelming it with 135 parameters.
