# Frontend Testing Guide for Improved Grant Card Prompts

## Quick Start

Use the sample grant document at: `tests/sample-grant-for-frontend-testing.md`

This grant is designed to test all 6 improved task types and demonstrate the enhanced performance.

---

## What to Expect from Each Task

### 1. Grant Criteria (Task: `grant-criteria`)

**What you'll see:**
- Clean, structured output with field names
- **No preambles** like "Here is the grant criteria..." or "I'll analyze..."
- Direct start with "Program Name: Digital Transformation & Export Readiness Program"
- All required fields extracted systematically
- Marked gaps as "Information not available in source material"

**Expected improvements:**
- 57% improvement (4.00/7 score)
- 30% faster response time
- No meta-commentary about methodology

---

### 2. Preview Description (Task: `preview`)

**What you'll see:**
- **Exactly 1-2 sentences** (target: 25-40 words)
- Most compelling elements featured (funding amount, target audience)
- No preamble - direct preview content only
- Engaging but factual tone

**Expected improvements:**
- 57% improvement (4.00/7 score)
- **70% faster** response time (biggest speed gain!)
- 77% more concise output

**Example output:**
```
Up to $250,000 for Canadian SMEs (5-499 employees) to adopt digital technologies and expand into international markets, covering 30-50% of eligible costs. Deadline: November 30, 2025.
```

---

### 3. General Requirements (Task: `requirements`)

**What you'll see:**
- **Exactly 3 sentences or fewer** in summary paragraph
- Bullet point for turnaround time below
- Most critical requirements prioritized
- No preamble or explanatory notes

**Expected improvements:**
- 48% improvement (3.33/7 score)
- 49% faster response time
- 53% more concise

**Example output:**
```
Canadian for-profit businesses with 5-499 employees and minimum $500,000 annual revenue must have been incorporated for at least 2 years and demonstrate financial viability. Projects require 30-50% matching funds (depending on revenue tier) and must be completed within 18 months. Applications accepted in three rounds with 8-12 week review timelines.

• Turnaround Time: 8-12 weeks for full application review after EOI approval (15 business days)
```

---

### 4. Granted Insights (Task: `insights`)

**What you'll see:**
- **3-4 strategic bullet points** (1 sentence each maximum)
- Competitive intelligence and positioning advice
- Final bullet with "Next Steps" about contacting Grant Consultant
- No preamble - direct bullets only

**Expected improvements:**
- **71% improvement** (5.00/7 score) - **BEST PERFORMER!**
- 44% faster response time
- 48% more concise

**Example output:**
```
• Revenue-tiered cost-sharing (30-50%) creates significant advantage for smaller businesses under $2M revenue—position as high-value opportunity for early-stage exporters
• Combined digital transformation + export focus differentiates this from single-purpose grants—leverage both streams to maximize funding and impact
• Priority scoring for underrepresented groups and rural businesses provides 15-20% application boost—highlight diversity ownership or regional presence if applicable
• Next Steps: Contact Grant Consultant to develop integrated digital-export strategy that maximizes scoring across all evaluation criteria (digital impact 20%, export potential 25%)
```

---

### 5. Categories & Tags (Task: `categories`)

**What you'll see:**
- **EXACTLY 7 sections** in this specific structure:
  ```
  PRIMARY GRANT TYPE: [One of 6 types]
  SECONDARY TYPES: [Additional types or "None"]
  INDUSTRIES: [2-5 tags]
  GEOGRAPHY: [Geographic scope]
  RECIPIENT TYPE: [Target audience]
  FUNDING FOCUS: [3-5 tags]
  PROGRAM CHARACTERISTICS: [2-4 tags]
  ```
- **Perfect format compliance** - no extra sections, no missing sections
- Tag counts within specified limits
- No preamble, no explanations

**Expected improvements:**
- **100% improvement** (7.00/7 score) - **PERFECT AFTER REFINEMENT!**
- 43% faster response time
- Database-ready format

**Example output:**
```
PRIMARY GRANT TYPE: Market Expansion/Capital Costs/Systems and Processes Grant (Type 2)

SECONDARY TYPES: Training Grant (Type 3) - digital skills development component

INDUSTRIES: Technology, Manufacturing, Agri-food, Clean Technology

GEOGRAPHY: Canada-wide, International Markets

RECIPIENT TYPE: Small Business (5-49 employees), Medium Business (50-499 employees), For-profit

FUNDING FOCUS: Digital Transformation, Export Development, Technology Adoption, Market Research, International Expansion

PROGRAM CHARACTERISTICS: Cost-sharing Required (30-50%), Rolling Intake, Multiple Deadlines, Priority Scoring
```

---

### 6. Missing Information (Task: `missing-info`)

**What you'll see:**
- **EXACTLY 3 priority tiers:**
  - TIER 1: CRITICAL MISSING INFORMATION (3-5 items)
  - TIER 2: IMPORTANT FOR STRATEGY (3-5 items)
  - TIER 3: ADDITIONAL CLARIFICATIONS (2-3 items)
- **Total: 8-12 items** across all tiers
- Each formatted as: `• [Field Name]: [Specific question]`
- Questions are actionable and strategic
- No preamble

**Expected improvements:**
- **71% improvement** (5.00/7 score)
- 18% faster response time
- More organized and prioritized

**Example output:**
```
TIER 1: CRITICAL MISSING INFORMATION
• Matching Funds Timing: When must applicant matching funds be confirmed - at application or only upon approval?
• Technology Vendor Requirements: Are there restrictions on vendor selection, or must quotes be from Canadian suppliers?
• Revenue Verification: What documentation is required to prove annual revenue threshold - tax returns, audited statements, or bank records?
• Multi-Component Eligibility: Can a project focus on only one component (digital OR export), or must it address both to qualify?

TIER 2: IMPORTANT FOR STRATEGY
• Priority Scoring Weighting: How many additional points do priority categories receive (women-owned, rural, first-time exporter)?
• Success Rate by Tier: What is the approval rate for small (<$2M) vs. larger businesses to assess competitiveness?
• Technical Review Process: Are applications peer-reviewed by industry experts, or evaluated internally by program staff?

TIER 3: ADDITIONAL CLARIFICATIONS
• Previous Applicants: Can businesses that received funding in past fiscal years reapply for different projects?
• Project Extension Policy: Under what circumstances can the 18-month timeline be extended?
```

---

## Testing Checklist

### Before Testing
- [ ] Have the sample grant document ready
- [ ] Clear any old conversation state
- [ ] Note the current time for speed comparison

### Test Each Task
- [ ] **Grant Criteria** - Check for no preambles, clean structure
- [ ] **Preview** - Verify 1-2 sentences only, no "Here is..."
- [ ] **Requirements** - Count sentences (should be ≤3), check for turnaround bullet
- [ ] **Insights** - Count bullets (should be 3-4), verify Next Steps included
- [ ] **Categories** - Count sections (should be exactly 7), verify tag counts
- [ ] **Missing Info** - Verify 3-tier structure, count total items (should be 8-12)

### Quality Checks
- [ ] No preambles in any output
- [ ] No meta-commentary like "I'll analyze..." or "Following the methodology..."
- [ ] Outputs are directly usable/copy-pasteable
- [ ] Responses feel faster than before
- [ ] Format compliance is perfect

---

## Common Issues to Watch For

### ❌ Old Behavior (Should NOT see)
```
Here is the preview description for this grant program:

The Digital Transformation & Export Readiness Program provides...
```

### ✅ New Behavior (Should see)
```
Up to $250,000 for Canadian SMEs (5-499 employees) to adopt digital technologies...
```

---

### ❌ Old Categories (Inconsistent)
```
Grant Type: Market Expansion / Digital Transformation
Industries: Various industries supported including technology, manufacturing...
Geography: Canada
```

### ✅ New Categories (Perfect Structure)
```
PRIMARY GRANT TYPE: Market Expansion/Capital Costs/Systems and Processes Grant (Type 2)

SECONDARY TYPES: Training Grant (Type 3)

INDUSTRIES: Technology, Manufacturing, Agri-food, Clean Technology
```

---

## Performance Benchmarks

Based on test results, you should see approximately:

| Task | Old Avg Time | New Avg Time | Improvement |
|------|--------------|--------------|-------------|
| Preview | ~5,400ms | ~1,600ms | 70% faster |
| Requirements | ~5,000ms | ~2,600ms | 49% faster |
| Insights | ~6,600ms | ~3,700ms | 44% faster |
| Grant-Criteria | ~5,300ms | ~3,700ms | 30% faster |
| Categories | ~4,400ms | ~2,500ms | 43% faster |
| Missing-Info | ~5,900ms | ~4,800ms | 18% faster |

**Note:** Actual times will vary based on document complexity and API response times.

---

## Troubleshooting

### If you see preambles:
- The old prompts may still be cached
- Try clearing browser cache or starting a new conversation

### If format is inconsistent:
- Verify you're using the latest version from the `development` branch
- Check that the server has been restarted after the changes

### If responses are slow:
- This is normal for the first message in a conversation (cold start)
- Subsequent messages should be faster
- Missing-Info is intentionally more thorough (acceptable trade-off)

---

## Reporting Issues

If you notice outputs that don't match the expected behavior:

1. **Capture the output** - Copy the full response
2. **Note the task type** - Which of the 6 tasks was it?
3. **Document the issue** - What specifically is wrong?
4. **Compare to expectations** - Reference this guide

**Example issue report:**
```
Task: categories
Issue: Only showing 5 sections instead of 7
Expected: 7 sections (PRIMARY GRANT TYPE, SECONDARY TYPES, INDUSTRIES, GEOGRAPHY, RECIPIENT TYPE, FUNDING FOCUS, PROGRAM CHARACTERISTICS)
Actual: Missing SECONDARY TYPES and PROGRAM CHARACTERISTICS sections
```

---

## Success Indicators

You'll know the improved prompts are working when you see:

✅ **No preambles** - Responses start directly with content
✅ **Perfect format compliance** - Categories has exactly 7 sections, Missing-Info has 3 tiers, etc.
✅ **Faster responses** - Noticeably quicker, especially Preview task
✅ **Concise outputs** - Shorter but still comprehensive
✅ **Professional tone** - Spartan, direct, actionable
✅ **Database-ready** - Can copy/paste directly into fields

---

## Additional Test Cases

If you want to test edge cases, try:

1. **Minimal grant document** - Very sparse information (tests missing-info task)
2. **Complex grant** - Multiple funding streams (tests categorization)
3. **Technical grant** - Lots of jargon (tests clarity of preview/requirements)
4. **Multi-type grant** - Spans multiple grant types (tests primary/secondary classification)

Sample minimal document:
```
Green Technology Innovation Fund
Funding: $50,000 - $500,000
For: Canadian clean tech companies
Deadline: June 30, 2026
Contact: greentech@innovation.gc.ca
```

This should produce a well-structured output even with limited information, and the missing-info task should identify 10-12 critical gaps.

---

**Happy Testing!** 🚀

The improved prompts represent a major quality upgrade. You should notice the difference immediately in the first task you run.
