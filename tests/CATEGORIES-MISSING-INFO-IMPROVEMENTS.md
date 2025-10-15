# Improving Categories & Missing-Info Tasks

## Problem Analysis

### Categories Task: 1.33/7 (19% improvement)
**Why it underperformed:**
- ❌ Vague output format: "comprehensive list organized by classification type" - not specific enough
- ❌ No explicit structure (bullets? JSON? table?)
- ❌ No length constraints like successful tasks have
- ❌ Success criteria are process-oriented, not output-oriented
- ❌ Old prompt already performed decently (harder to improve)

### Missing-Info Task: 2.00/7 (29% improvement)
**Why mixed results:**
- ✅ More comprehensive output (GOOD - this is desired!)
- ❌ But 54% slower
- ❌ Vague output format: "organized list" could mean anything
- ❌ No brevity constraints
- ⚠️ Thoroughness vs speed trade-off (actually acceptable for this task)

---

## What Made Other Tasks Successful

### Insights Task: 5.00/7 (71% improvement) ⭐
**Success factors:**
- ✅ **Specific count**: "3-4 bullet points"
- ✅ **Length constraint**: "Maximum one sentence per bullet point"
- ✅ **Clear structure**: Bullets with specific content requirements
- ✅ **Measurable success criteria**: Easy to verify compliance

### Preview Task: 4.00/7 (57% improvement) ⭐
**Success factors:**
- ✅ **Ultra-specific length**: "1-2 sentences maximum (target: 25-40 words)"
- ✅ **Simple output**: Just the preview, nothing else
- ✅ **Clear exclusions**: No preambles, meta-commentary, etc.

---

## Improved Categories Task Prompt

### Key Changes:
1. **Add explicit structure**: Organized hierarchy with clear labels
2. **Add output template**: Show exactly what format to follow
3. **Add length/count constraints**: Limit tag proliferation
4. **Make success criteria output-focused**: Easy to measure

### New Output Format Specification:

```xml
<output_format>
  <structure>
    PRIMARY GRANT TYPE: [Single type from 1-6]

    SECONDARY TYPES (if applicable): [List any additional types]

    INDUSTRIES: [2-5 industry tags]

    GEOGRAPHY: [Geographic scope tags]

    RECIPIENT TYPE: [Target audience tags]

    FUNDING FOCUS: [3-5 funding focus tags]

    PROGRAM CHARACTERISTICS: [2-4 program rule tags]
  </structure>

  <constraints>
    <constraint>Use EXACTLY this format structure - do not add or remove sections</constraint>
    <constraint>Primary grant type: Must be ONE of the 6 types (Hiring, Training, R&D, Market Expansion, Loan, Investment)</constraint>
    <constraint>Industries: 2-5 tags maximum</constraint>
    <constraint>Funding Focus: 3-5 tags maximum</constraint>
    <constraint>Program Characteristics: 2-4 tags maximum</constraint>
    <constraint>Each tag should be 1-4 words</constraint>
  </constraints>

  <example>
    PRIMARY GRANT TYPE: Training Grant (Type 3)

    SECONDARY TYPES: None

    INDUSTRIES: Manufacturing, Technology, Professional Services

    GEOGRAPHY: British Columbia, Canada-wide

    RECIPIENT TYPE: Small Business (10-499 employees), For-profit

    FUNDING FOCUS: Workforce Development, Skills Training, Certification Programs, Professional Development

    PROGRAM CHARACTERISTICS: Cost-sharing Required (25%), Rolling Intake, Credential-focused
  </example>

  <tone>Direct classification format - no explanations or analysis</tone>
</output_format>

<success_criteria>
  <criterion>Output follows EXACTLY the 7-section structure above</criterion>
  <criterion>Primary grant type is ONE of the 6 types</criterion>
  <criterion>Tag counts are within specified ranges (2-5 industries, 3-5 funding focus, etc.)</criterion>
  <criterion>All tags are concise (1-4 words each)</criterion>
  <criterion>No preambles or meta-commentary</criterion>
  <criterion>Format is immediately copy-pasteable into database</criterion>
</success_criteria>
```

---

## Improved Missing-Info Task Prompt

### Key Changes:
1. **Add structure with priority levels**: Tier 1 (critical), Tier 2 (important), Tier 3 (nice-to-have)
2. **Add count constraints**: Limit to 8-12 key gaps total
3. **Add question format template**: Specific format for questions
4. **Embrace thoroughness**: The slower speed is actually a feature for this task

### New Output Format Specification:

```xml
<output_format>
  <structure>
    TIER 1: CRITICAL MISSING INFORMATION
    [3-5 highest priority gaps that impact go/no-go decisions]

    TIER 2: IMPORTANT FOR STRATEGY
    [3-5 gaps that affect application strategy and positioning]

    TIER 3: ADDITIONAL CLARIFICATIONS
    [2-3 gaps that would improve completeness]
  </structure>

  <question_format>
    Each gap should be formatted as:
    • [Field Name]: [Specific question to ask program administrators]

    Example:
    • Funding Timeline: What is the typical disbursement schedule after approval?
  </question_format>

  <constraints>
    <constraint>Total gaps: 8-12 items across all three tiers</constraint>
    <constraint>Tier 1: 3-5 gaps (most critical)</constraint>
    <constraint>Tier 2: 3-5 gaps (strategic importance)</constraint>
    <constraint>Tier 3: 2-3 gaps (nice-to-have)</constraint>
    <constraint>Each question must be specific enough to ask directly to program staff</constraint>
    <constraint>Questions should extract strategic intelligence, not just fill blanks</constraint>
  </constraints>

  <example>
    TIER 1: CRITICAL MISSING INFORMATION
    • Eligibility - Revenue Requirements: Is there a minimum or maximum annual revenue threshold for applicants?
    • Cost Sharing: What percentage of costs must the applicant contribute, if any?
    • Eligible Expenses: What specific cost categories are covered (salaries, equipment, overhead, etc.)?

    TIER 2: IMPORTANT FOR STRATEGY
    • Application Review Process: How many stages are in the review process and what is evaluated at each stage?
    • Success Rate: What percentage of applications are typically approved?
    • Funding Priorities: Are certain industries or project types prioritized in the current funding cycle?

    TIER 3: ADDITIONAL CLARIFICATIONS
    • Reporting Requirements: What reporting cadence and metrics are required during the project?
    • Multi-year Projects: Can projects span multiple years, or must they be completed within one fiscal year?
  </example>

  <tone>Strategic and professional - positioning questions as intelligence gathering</tone>
</output_format>

<success_criteria>
  <criterion>Output uses EXACTLY the 3-tier structure</criterion>
  <criterion>Total gaps: 8-12 items (no more, no less)</criterion>
  <criterion>Each gap includes both field name and specific question</criterion>
  <criterion>Questions are actionable - can be asked directly to program staff</criterion>
  <criterion>Tier 1 gaps truly impact go/no-go decisions</criterion>
  <criterion>No preambles, just the structured list</criterion>
  <criterion>Questions extract strategic intelligence, not just fill fields</criterion>
</success_criteria>
```

---

## Implementation Plan

### Step 1: Update Categories Task
```javascript
'categories': `<task type="categories">
  <task_name>Categories & Tags Generation</task_name>
  <description>Generate structured categorization using Granted's 6-type system with specific tag limits for database organization</description>

  // ... [keep existing input_variables and conditional_logic]

  <output_format>
    <structure>
      PRIMARY GRANT TYPE: [Single type from 1-6]

      SECONDARY TYPES (if applicable): [List any additional types]

      INDUSTRIES: [2-5 industry tags]

      GEOGRAPHY: [Geographic scope tags]

      RECIPIENT TYPE: [Target audience tags]

      FUNDING FOCUS: [3-5 funding focus tags]

      PROGRAM CHARACTERISTICS: [2-4 program rule tags]
    </structure>

    <constraints>
      <constraint>Use EXACTLY this 7-section format</constraint>
      <constraint>Primary: ONE of 6 types only</constraint>
      <constraint>Industries: 2-5 tags max</constraint>
      <constraint>Funding Focus: 3-5 tags max</constraint>
      <constraint>Program Characteristics: 2-4 tags max</constraint>
      <constraint>Each tag: 1-4 words</constraint>
    </constraints>

    <tone>Direct classification - no explanations</tone>
  </output_format>

  <success_criteria>
    <criterion>Follows EXACTLY the 7-section structure</criterion>
    <criterion>Tag counts within limits</criterion>
    <criterion>No preambles or analysis</criterion>
    <criterion>Format is database-ready</criterion>
  </success_criteria>
</task>`
```

### Step 2: Update Missing-Info Task
```javascript
'missing-info': `<task type="missing-info">
  <task_name>Missing Information Analysis</task_name>
  <description>Perform prioritized gap analysis identifying 8-12 key missing information items across three priority tiers</description>

  // ... [keep existing input_variables and conditional_logic]

  <output_format>
    <structure>
      TIER 1: CRITICAL MISSING INFORMATION
      [3-5 highest priority gaps]

      TIER 2: IMPORTANT FOR STRATEGY
      [3-5 strategic gaps]

      TIER 3: ADDITIONAL CLARIFICATIONS
      [2-3 nice-to-have gaps]
    </structure>

    <question_format>
      • [Field Name]: [Specific question for program staff]
    </question_format>

    <constraints>
      <constraint>Total: 8-12 gaps across all tiers</constraint>
      <constraint>Tier 1: 3-5 gaps (critical)</constraint>
      <constraint>Tier 2: 3-5 gaps (strategic)</constraint>
      <constraint>Tier 3: 2-3 gaps (clarifications)</constraint>
      <constraint>Questions must be specific and actionable</constraint>
    </constraints>

    <tone>Strategic intelligence gathering</tone>
  </output_format>

  <success_criteria>
    <criterion>Uses 3-tier structure exactly</criterion>
    <criterion>8-12 total gaps</criterion>
    <criterion>Each has field name + question</criterion>
    <criterion>Questions are program-staff-ready</criterion>
    <criterion>No preambles</criterion>
  </success_criteria>
</task>`
```

---

## Expected Improvements

### Categories Task
**Current:** 1.33/7 (19% improvement)
**Expected:** 3.5-4.0/7 (50-57% improvement)

**Why it will improve:**
- ✅ Explicit 7-section structure (like Insights' bullet format)
- ✅ Clear count constraints (2-5 industries, 3-5 funding focus)
- ✅ Example template showing exact format
- ✅ Measurable success criteria

### Missing-Info Task
**Current:** 2.00/7 (29% improvement)
**Expected:** 3.5-4.0/7 (50-57% improvement)

**Why it will improve:**
- ✅ 3-tier priority structure (clear organization)
- ✅ Count constraints (8-12 total, distributed across tiers)
- ✅ Question format template (• [Field]: [Question])
- ✅ Embraces thoroughness as a feature (not a bug)

---

## Testing Strategy

1. **Create improved prompts** in new file
2. **Run comparison tests** on same 3 grants (hiring, training, R&D)
3. **Measure:**
   - Format compliance (follows structure?)
   - Count compliance (within limits?)
   - No preambles
   - Response time (acceptable if still thorough)
4. **Compare:**
   - Old categories vs new categories
   - Old missing-info vs new missing-info

---

## Summary

The key insight from successful tasks (Insights, Preview) is:

**Specificity = Performance**

- Vague: "comprehensive list" → ❌ Poor results
- Specific: "3-4 bullet points, 1 sentence each" → ✅ Excellent results

We're applying this lesson to Categories and Missing-Info by adding:
1. **Explicit structure templates**
2. **Count constraints**
3. **Format examples**
4. **Measurable success criteria**

This should bring both tasks up to the 3.5-4.0/7 range (50-57% improvement), matching the performance of Grant-Criteria, Preview, and Requirements.
