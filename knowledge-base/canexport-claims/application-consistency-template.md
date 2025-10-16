# CanExport Claims - Application Consistency Checking Guide

## PURPOSE

This guide teaches the Claims Agent how to perform **optional** multi-document consistency analysis when users upload:
1. Original application document (proposed activities and budget)
2. Funding agreement (approved activities and budget)
3. Actual expense documents (receipts/invoices being claimed)

**Key Principle**: Consistency checking is **ADDITIVE** to core expense auditing. Always perform standard eligibility verification regardless of whether consistency check is possible.

---

## DOCUMENT DETECTION LOGIC

### How to Recognize Each Document Type

#### Application Document Indicators:
- Contains **proposed** activities, target markets, budget estimates
- Language patterns: "we plan to," "we will," "we propose," "our objective is"
- Detailed rationale and strategic approach
- Business case and market opportunity narrative
- Estimated costs and projected outcomes
- More narrative-heavy and forward-looking

**Example phrases**:
- "We propose to enter the German market via..."
- "Our export strategy involves..."
- "Estimated budget for this initiative is..."

#### Funding Agreement Indicators:
- Contains **approved** amounts, project period dates, terms and conditions
- Language patterns: "approved," "shall," "must," "is authorized"
- Official approval signatures, dates, project ID numbers
- Specific eligible expense categories listed (A-H)
- Maximum reimbursement amounts stated
- Project start and end dates clearly defined
- NRC letterhead or official CanExport branding

**Example phrases**:
- "This project is approved for a maximum of..."
- "Project period: [Start Date] to [End Date]"
- "Eligible activities include Category B..."

#### Expense Documents:
- Receipts, invoices, proof of payment
- Vendor names, contact information
- Specific dates (invoice date, payment date)
- Line-item costs with tax breakdowns
- Actual services/products purchased
- Present tense or past tense language
- Transaction-focused rather than narrative

**Example phrases**:
- "Invoice #12345 for services rendered..."
- "Amount due: $X.XX"
- "Payment received on [date]"

---

## STEP-BY-STEP CROSS-CHECK WORKFLOW

### STEP 1: Detect Document Types

When user uploads multiple documents, analyze each to identify:
- Is this an application (proposed plan)?
- Is this a funding agreement (what was approved)?
- Is this an expense document (what actually happened)?

**If all three types detected** → Automatically perform consistency analysis

**If only 1-2 types present** → Note which documents would enable comprehensive consistency check, then proceed with standard audit

### STEP 2: Extract Key Elements from Each Document

#### From Application:
- **Proposed target markets**: Which countries/regions were they planning to enter?
- **Planned activities**: What specific tactics did they propose? (trade shows, consultants, marketing materials, etc.)
- **Deliverables**: What did they promise to produce?
- **Estimated budget allocation**: How did they plan to spend funds across categories?
- **Strategic approach**: What was the overall market entry strategy?

#### From Funding Agreement:
- **Approved target markets**: Which markets did NRC approve? (May differ from application)
- **Approved activities**: Which activities were authorized? (May be subset of application)
- **Approved budget by category**: Maximum amounts for each eligible expense category (A-H)
- **Project start date**: When can eligible expenses begin?
- **Project end date**: When must expenses be completed and paid?
- **Special conditions or restrictions**: Any specific requirements or limitations noted?

#### From Expenses:
- **Markets evidenced**: Which markets do the receipts show? (trade show locations, consultant focus markets, marketing material languages)
- **Activities evidenced**: What was actually purchased? (booth rental, consultant services, website localization, etc.)
- **Actual spending by category**: How much was spent in each expense category?
- **Expense dates**: Are all invoice and payment dates within the project period?

### STEP 3: Perform Three-Way Comparison

#### Comparison 1: Application → Funding Agreement
**Question**: What changed from proposal to approval?

- Did NRC approve all proposed markets or only some?
- Were certain activities removed during approval process?
- Did approved budget differ from requested amount?
- Were there any conditions added?

**Why this matters**: Understanding what NRC approved helps contextualize whether execution deviations need approval.

#### Comparison 2: Funding Agreement → Expenses
**Question**: Is execution aligned with what was approved?

- Do expense receipts match approved target markets?
- Do purchased activities align with approved categories?
- Is spending within approved budget allocations per category?
- Are deliverables evidenced in receipts?
- Are all expenses within approved project period?

**Why this matters**: This is the PRIMARY compliance check for consistency.

#### Comparison 3: Overall Trajectory Analysis
**Question**: What's the overall drift from Application → Approval → Execution?

- **Full alignment**: Proposed → Approved → Executed as planned (GREEN)
- **Minor adjustments**: Tactical changes within approved strategy (YELLOW)
- **Major pivot**: Significant departure from approved plan (RED)

---

## COMPARISON FRAMEWORK

### 1. Market Alignment Check

**GREEN (Fully Aligned)**:
- Expenses match approved target markets exactly
- Example: Agreement approves "Germany," expenses show German trade show and consultant focused on Germany

**YELLOW (Minor Variance, Likely Acceptable)**:
- Additional markets added, but original approved markets still pursued
- Example: Agreement approves "Germany," expenses show Germany + France
- **Rationale**: Expanding markets while maintaining original focus is generally acceptable

**RED (Major Discrepancy)**:
- Completely different markets than approved, no evidence of approved markets
- Example: Agreement approves "USA," expenses show only China activities
- **Rationale**: This is a significant pivot requiring approval before reimbursement

### 2. Activity Consistency Check

**GREEN (Fully Aligned)**:
- Activities match approved plan exactly
- Example: Agreement approves "trade shows and marketing materials," expenses show booth rental and brochure printing

**YELLOW (Tactical Changes, Likely Acceptable)**:
- Different tactics within same overall strategy
- Example: Agreement approves "digital marketing," expenses show social media ads instead of planned Google Ads
- **Rationale**: Same objective, different implementation method

**RED (Major Strategic Pivot)**:
- Complete change in market entry approach
- Example: Agreement approves "B2B distributor strategy," expenses show B2C e-commerce platform development
- **Rationale**: Fundamentally different approach requires approval

### 3. Budget Alignment Check

**GREEN (Within Allocations)**:
- Spending stays within approved category allocations
- Example: Agreement approves $10K Category B, expenses show $9K Category B

**YELLOW (10-25% Variance)**:
- Budget reallocation between categories, but within reasonable limits
- Example: Agreement approves $10K Category B + $5K Category C, expenses show $12K Category B + $3K Category C
- **Rationale**: Minor reallocations (<25%) generally don't require approval

**RED (>25% Reallocation)**:
- Major budget shifts between approved categories
- Example: Agreement approves $10K Category B + $5K Category C, expenses show $15K Category B + $0 Category C
- **Rationale**: Major reallocations (>25%) require approval before reimbursement

### 4. Deliverable Evidence Check

**GREEN (All Deliverables Present)**:
- Receipts show evidence of all promised deliverables
- Example: Application promised "website translation + trade show attendance," expenses show both

**YELLOW (Partial Delivery)**:
- Some deliverables completed, others missing or modified
- Example: Application promised "French + Spanish translations," expenses show only French
- **Rationale**: Request client explanation - was Spanish deferred, removed, or completed separately?

**RED (Major Deliverables Missing)**:
- Core promised deliverables completely absent
- Example: Application promised "trade show attendance + consultant," expenses show only consultant, no trade show evidence
- **Rationale**: Significant scope reduction may require approval and could affect reimbursement eligibility

### 5. Timeline Compliance Check

**GREEN (All Within Project Period)**:
- ALL invoice dates ≥ project start date
- ALL payment dates ≤ project completion date

**RED (Any Dates Outside Period)**:
- **ANY** invoice dated before project start date → **AUTOMATIC REJECTION**
- **ANY** payment dated after project completion date → **AUTOMATIC REJECTION**
- **Rationale**: Pre-project and post-project expenses are strictly ineligible, no exceptions

### 6. Scope Changes Assessment

**GREEN (Scope Maintained)**:
- Execution matches approved scope exactly
- No unauthorized additions or reductions

**YELLOW (Minor Scope Adjustments)**:
- Small modifications within approved activity types
- Example: Agreement approves "marketing materials," client produces videos instead of planned brochures
- **Rationale**: Same category, different format

**RED (Unauthorized Scope Changes)**:
- Scope expansion: New activity types not in approval
- Example: Agreement approves "marketing only," expenses include travel (Category E not approved)
- Scope reduction: Abandoning core approved activities
- Example: Agreement approves "trade shows + marketing," expenses show only marketing
- **Rationale**: Major scope changes require approval

---

## SEVERITY LEVELS & FLAG MEANINGS

### ✅ GREEN FLAGS - Fully Aligned
**Meaning**: Expenses match approved plan across all dimensions

**Agent Response**:
- Proceed with standard expense audit
- Note in consistency analysis: "✅ Full alignment confirmed - Execution matches approved plan"
- No additional client action needed for consistency

### ⚠️ YELLOW FLAGS - Minor Variance
**Meaning**: Some deviations, but likely acceptable under CanExport flexibility rules

**Agent Response**:
- Proceed with standard expense audit
- Note in consistency analysis: "⚠️ Minor variance detected - [specific description]"
- Request client explanation/justification
- Generally does not block reimbursement if client provides reasonable explanation

**Examples**:
- Budget reallocation 10-25% between categories
- Additional markets added (if originals still active)
- Tactical implementation differences within same strategy
- Partial deliverable completion

### ❌ RED FLAGS - Major Discrepancy
**Meaning**: Significant departure from approved plan requiring approval before reimbursement

**Agent Response**:
- Flag in consistency analysis: "❌ Major discrepancy - [specific description]"
- Recommend client contact CanExport for approval before submitting claim
- May block reimbursement until client obtains approval for changes
- Clearly explain impact on claim eligibility

**Examples**:
- Complete market pivot (abandoning approved markets)
- Major strategic changes (B2B → B2C, trade shows → digital only)
- Budget reallocation >25% between categories
- Timeline violations (pre-project or post-project expenses)
- Unauthorized scope expansion or reduction

---

## CANEXPORT FLEXIBILITY RULES

### Changes That DON'T Require Approval

✅ **Minor budget reallocations** (<10% within same activity type)
- Example: Approved $10K for marketing, spent $9K on brochures instead of $10K on website

✅ **Vendor substitutions** (same service/product, different provider)
- Example: Approved "marketing consultant," used different consultant than originally planned

✅ **Timeline adjustments** (within approved project period)
- Example: Project period is Jan-Dec 2025, originally planned trade show in March, attended in June instead

✅ **Adding target markets** (if original approved markets still active)
- Example: Approved for Germany, also pursued France while maintaining Germany activities

### Changes That REQUIRE Notice to CanExport

⚠️ **Major budget reallocations** (>25% between expense categories)
- Example: Approved $10K Category B + $5K Category C, want to spend $13K Category B + $2K Category C

⚠️ **Complete market pivot** (abandoning approved markets)
- Example: Approved for USA, now targeting China exclusively

⚠️ **Scope expansion** (adding new activity types not in approval)
- Example: Approved for marketing only, now want to add international travel

⚠️ **Project timeline extensions** (beyond approved end date)
- Example: Approved end date Dec 31, 2025, want to extend to March 2026

### Changes That May Be REJECTED

❌ **Using funds for ineligible expense categories**
- Example: Approved for Category B (marketing), spending on ineligible items like office equipment

❌ **Abandoning core approved activities**
- Example: Approved for trade shows + marketing, only did marketing, no trade shows

❌ **Pre-project or post-project expenses**
- Example: Any expenses dated before project start or after project end

❌ **Scope reduction undermining project objectives**
- Example: Approved for comprehensive market entry, only did minimal marketing

---

## INTEGRATION WITH REGULAR AUDITING

**CRITICAL**: Consistency checking is **ADDITIVE**, not a replacement for standard auditing.

### How to Blend Consistency Analysis into Expense Evaluation

#### Your Standard Workflow (Always Perform):
1. Extract expense details (vendor, amount, date, description)
2. Check rejection patterns (Amazon, booth purchase, Canadian market, etc.)
3. Verify financial compliance (tax removal, 50% cap, per diem limits)
4. Verify project compliance (dates, categories, target market)
5. Provide structured verdict (Approved/Needs Adjustment/Rejected)

#### Enhanced Workflow (When Consistency Check Possible):
1. **[NEW]** Detect if application + funding agreement + expenses all present
2. **[NEW]** Extract approved elements from application and funding agreement
3. Perform standard expense audit (steps 1-5 above)
4. **[NEW]** Compare actual expenses against approved plan
5. **[NEW]** Flag any discrepancies with appropriate severity level
6. **[NEW]** Integrate consistency findings into verdict and recommendations

#### Response Structure with Consistency Check:

```
<thinking>
<document_tracking>
  <!-- Check for previously reviewed documents -->
</document_tracking>

<consistency_check_detection>
  <!-- Are application + funding agreement + expenses all present? -->
  <!-- If yes: Extract approved elements -->
</consistency_check_detection>

<mode>Quick Check / Full Audit</mode>

<expense_extraction>
  <!-- Standard extraction -->
</expense_extraction>

<rejection_pattern_check>
  <!-- Standard rejection patterns -->
</rejection_pattern_check>

<financial_compliance>
  <!-- Standard financial checks -->
</financial_compliance>

<project_compliance>
  <!-- Standard project checks -->
</project_compliance>

<consistency_analysis if_documents_available="true">
  <application_vs_approval>
    <!-- What changed from proposal to approval? -->
  </application_vs_approval>

  <approval_vs_execution>
    <!-- Is execution aligned with approval? -->
    <market_alignment>GREEN/YELLOW/RED with reasoning</market_alignment>
    <activity_consistency>GREEN/YELLOW/RED with reasoning</activity_consistency>
    <budget_alignment>GREEN/YELLOW/RED with reasoning</budget_alignment>
    <deliverable_evidence>GREEN/YELLOW/RED with reasoning</deliverable_evidence>
    <timeline_compliance>GREEN/RED with reasoning</timeline_compliance>
    <scope_changes>GREEN/YELLOW/RED with reasoning</scope_changes>
  </approval_vs_execution>

  <overall_alignment_verdict>
    <!-- Overall consistency assessment: FULLY ALIGNED / MINOR VARIANCE / MAJOR DISCREPANCY -->
  </overall_alignment_verdict>
</consistency_analysis>

<preliminary_assessment>
  <!-- Standard reasoning for verdict, now including consistency findings -->
</preliminary_assessment>
</thinking>

<!-- Then standard expense_summary, compliance_analysis, verdict, recommendations -->
<!-- But now verdict and recommendations INCLUDE consistency findings -->
```

#### Key Integration Principles:

1. **Consistency check enhances, doesn't replace**: Still do standard eligibility verification
2. **Add consistency section to thinking**: New `<consistency_analysis>` section in `<thinking>` tags
3. **Incorporate findings into verdict**: If RED flag, mention in verdict and recommendations
4. **Provide actionable guidance**: Tell client exactly what approval they need to get from CanExport
5. **Don't block eligible expenses unnecessarily**: GREEN and YELLOW flags don't prevent reimbursement if expenses are individually eligible

---

## RESPONSE FORMAT EXAMPLES

### Example 1: Full Alignment (GREEN)

```
<consistency_analysis>
<application_vs_approval>
Application proposed Germany market entry via trade shows and digital marketing. Funding agreement approved exactly as proposed with $15K maximum reimbursement.
</application_vs_approval>

<approval_vs_execution>
<market_alignment>✅ GREEN - Expenses show German trade show attendance and German website localization, fully aligned with approved Germany market</market_alignment>
<activity_consistency>✅ GREEN - Trade show booth rental and website translation match approved activities exactly</activity_consistency>
<budget_alignment>✅ GREEN - Spent $8K Category B + $4K Category C, within approved allocations</budget_alignment>
<deliverable_evidence>✅ GREEN - All promised deliverables evidenced in receipts</deliverable_evidence>
<timeline_compliance>✅ GREEN - All expenses within project period (Feb 1 - Dec 31, 2025)</timeline_compliance>
<scope_changes>✅ GREEN - No unauthorized scope changes</scope_changes>
</approval_vs_execution>

<overall_alignment_verdict>
✅ FULLY ALIGNED - Execution matches approved plan across all dimensions. No consistency concerns.
</overall_alignment_verdict>
</consistency_analysis>
```

**Impact on Verdict**: Proceed with standard expense audit. Consistency check adds confidence to approval.

---

### Example 2: Minor Variance (YELLOW)

```
<consistency_analysis>
<application_vs_approval>
Application proposed $10K Category B (marketing materials) + $5K Category C (translation). Funding agreement approved as proposed.
</application_vs_approval>

<approval_vs_execution>
<market_alignment>✅ GREEN - Expenses target approved Germany market</market_alignment>
<activity_consistency>✅ GREEN - Marketing and translation activities match approval</activity_consistency>
<budget_alignment>⚠️ YELLOW - Spent $12K Category B + $3K Category C (20% reallocation from translation to marketing)</budget_alignment>
<deliverable_evidence>✅ GREEN - All deliverables present</deliverable_evidence>
<timeline_compliance>✅ GREEN - All dates within project period</timeline_compliance>
<scope_changes>✅ GREEN - No scope changes</scope_changes>
</approval_vs_execution>

<overall_alignment_verdict>
⚠️ MINOR VARIANCE - Budget reallocation of 20% between approved categories. This is within acceptable limits (<25%) and likely doesn't require approval, but client should document rationale for the change.
</overall_alignment_verdict>
</consistency_analysis>
```

**Impact on Verdict**: Proceed with standard expense audit. Note budget variance in recommendations, request client explanation, but don't block reimbursement.

---

### Example 3: Major Discrepancy (RED)

```
<consistency_analysis>
<application_vs_approval>
Application proposed USA market entry via B2B distributor network. Funding agreement approved: "USA market, distributor strategy, trade show attendance + marketing materials."
</application_vs_approval>

<approval_vs_execution>
<market_alignment>❌ RED - Expenses show China market (consultant invoices for China B2C strategy, Chinese e-commerce platform fees), NO evidence of approved USA market activities</market_alignment>
<activity_consistency>❌ RED - Complete strategic pivot from B2B distributor network to B2C e-commerce, fundamentally different approach than approved</activity_consistency>
<budget_alignment>⚠️ YELLOW - Budget categories roughly aligned, but applied to wrong market</budget_alignment>
<deliverable_evidence>❌ RED - Deliverables focus on China B2C, not USA B2B as approved</deliverable_evidence>
<timeline_compliance>✅ GREEN - Dates within project period</timeline_compliance>
<scope_changes>❌ RED - Major market pivot (USA → China) and strategy pivot (B2B distributor → B2C e-commerce)</scope_changes>
</approval_vs_execution>

<overall_alignment_verdict>
❌ MAJOR DISCREPANCY - Complete departure from approved plan. Client pursued China B2C e-commerce strategy instead of approved USA B2B distributor approach. This change requires approval from CanExport before expenses can be reimbursed.
</overall_alignment_verdict>
</consistency_analysis>
```

**Impact on Verdict**: Even if expenses are individually eligible (correct categories, proper documentation), **FLAG FOR REVIEW**. Client must obtain CanExport approval for market and strategy pivot before claim can be submitted.

---

## HANDLING MISSING DOCUMENTS

### If Consistency Check Documents Are Missing

#### Scenario 1: Only Expenses Uploaded (No Application or Funding Agreement)

**Your Response**:
- Perform standard expense audit (eligibility, documentation, compliance)
- At end of response, add:

```
📋 **Note**: For comprehensive consistency analysis, upload the original application and funding agreement alongside expense documents. This allows me to verify that your execution aligns with what NRC approved, preventing compliance issues.
```

**DO NOT**:
- ❌ Require these documents - consistency checking is optional
- ❌ Block expense evaluation due to missing documents
- ❌ Make it seem like the analysis is incomplete

#### Scenario 2: Application + Expenses (But No Funding Agreement)

**Your Response**:
- Note: "I can see your original application and expenses, but funding agreement is missing."
- Perform **limited** consistency check: Compare expenses to what was proposed
- Flag if expenses deviate significantly from proposal
- Note: "For complete consistency verification, upload the funding agreement to see what NRC actually approved (which may differ from your application)."

#### Scenario 3: Funding Agreement + Expenses (But No Application)

**Your Response**:
- This is sufficient for consistency check! Funding agreement shows what was approved.
- Perform standard consistency check: Compare expenses to approved plan
- Application is helpful for context but not required

#### Scenario 4: User Explicitly Requests Consistency Check But Documents Missing

**Your Response**:
```
I'd be happy to perform a comprehensive consistency check! To do this, I need:

✅ Original application document (your proposal to CanExport)
✅ Funding agreement (NRC's approval letter with project details)
✅ Expense receipts/invoices (what you're claiming)

Currently, I have: [list what's uploaded]
Missing: [list what's needed]

Once you upload the missing documents, I can perform a full three-way comparison to verify execution aligns with approval and identify any discrepancies that need approval.
```

---

## EDGE CASES TO HANDLE

### Edge Case 1: Documents Uploaded Across Multiple Messages

**Scenario**: User uploads application in message 1, then expenses in message 2, then funding agreement in message 3.

**How to Handle**:
- **Check conversation history** for previously uploaded documents
- When all three document types are present in conversation, **automatically trigger consistency check**
- In your `<thinking>`, note: "Detected all three document types across conversation history: Application (message 1), Funding agreement (message 3), Expenses (message 2). Performing consistency analysis."

### Edge Case 2: Ambiguous Document Types

**Scenario**: Document could be either application or funding agreement (unclear from content).

**How to Handle**:
- **Ask the user for clarification**: "I see a document titled [filename]. Is this your original application to CanExport, or is this the funding agreement (approval letter) from NRC? This helps me perform accurate consistency checking."
- **Don't assume** - better to confirm than make wrong comparison

### Edge Case 3: Combined Application + Funding Agreement Document

**Scenario**: Some clients receive approval letters that include their original application text, creating a single document with both proposal and approval.

**How to Handle**:
- **Recognize this pattern**: Look for sections like "Your Application:" followed by "NRC Decision:" or "Approved Activities:"
- **Extract both parts**: Treat the application section as proposal and the approval section as funding agreement
- Perform normal three-way comparison using the two sections

### Edge Case 4: Multiple Versions of Application/Agreement

**Scenario**: User uploads revised application or amended funding agreement.

**How to Handle**:
- **Use the most recent/final version** for consistency checking
- If unclear which is final, ask user: "I see multiple application documents. Which version should I use for consistency checking - the one submitted to CanExport, or a revised version?"
- **Note in analysis** if client mentions changes: "Checking against amended funding agreement dated [date]"

### Edge Case 5: Partial Expenses (More Claims Coming Later)

**Scenario**: User uploads some expenses now, plans to submit more later.

**How to Handle**:
- Perform consistency check on expenses provided so far
- Note in verdict: "Consistency check performed on current expense set. Overall project alignment may become clearer when additional expenses are reviewed."
- **Don't flag as RED** just because deliverables are incomplete - client may have partial claims

---

## CRITICAL REMINDERS

### 1. Consistency Checking is Optional and Additive
- ✅ Enhances audit quality when documents available
- ✅ Prevents compliance issues by catching scope changes early
- ❌ Does NOT replace standard eligibility verification
- ❌ Does NOT block auditing if documents unavailable

### 2. Always Perform Standard Expense Audit
- Regardless of consistency check capability, ALWAYS verify:
  - Expense eligibility (Categories A-H)
  - Rejection patterns (Amazon, booth purchase, etc.)
  - Financial compliance (tax removal, 50% cap, per diem limits)
  - Documentation requirements (proof of payment, currency conversion)

### 3. Integration is Seamless
- Add `<consistency_analysis>` section to `<thinking>` tags
- Incorporate findings into verdict and recommendations
- Provide actionable guidance if RED flags detected
- Don't create separate "consistency report" - blend into expense evaluation

### 4. Context Preservation Across Messages
- Check conversation history for previously uploaded documents
- When all three document types present (even across messages), trigger consistency check
- Remember file context using conversation metadata

### 5. Severity Levels Guide Response
- **GREEN**: Note alignment, proceed with standard audit
- **YELLOW**: Request client explanation, generally don't block reimbursement
- **RED**: Flag for review, recommend client get CanExport approval before submitting claim

### 6. Be Helpful and Clear
- Explain exactly what the discrepancy is
- Tell client what they need to do (get approval, provide explanation, adjust claim)
- Reference specific sections of funding agreement when relevant
- Provide alternative compliant approaches when possible

---

## SUMMARY: When and How to Use This Guide

**TRIGGER**: When you detect application + funding agreement + expenses in conversation

**PROCESS**:
1. Identify document types by content analysis
2. Extract approved elements from application and funding agreement
3. Perform standard expense audit
4. Compare actual expenses against approved plan
5. Flag discrepancies using GREEN/YELLOW/RED severity levels
6. Integrate findings into verdict and recommendations

**OUTCOME**: Enhanced expense evaluation that prevents compliance issues before claim submission

**REMEMBER**: Your primary role is expense auditing. Consistency checking is a powerful enhancement, not a replacement.
