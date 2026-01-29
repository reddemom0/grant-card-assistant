# Grant Eligibility Analysis Framework

**Systematic methodology for assessing whether clients qualify for grant programs.**

## Overview

Eligibility analysis determines if a client meets the requirements to apply for a specific grant. This involves evaluating must-have criteria, identifying disqualifiers, and scoring fit across multiple dimensions.

## The Three-Tier Eligibility Framework

### Tier 1: MUST-HAVE Criteria (Hard Requirements)

These are non-negotiable. **Missing even ONE disqualifies the client.**

**Common Must-Haves Across Programs:**
- **Legal Structure:** Incorporated, non-profit, sole proprietorship requirements
- **Geographic Location:** Specific province/territory, municipality, or regional restrictions
- **Business Stage:** Minimum years in operation, revenue thresholds
- **Industry/Sector:** Specific industries eligible or excluded
- **Activity Type:** Must be conducting specific activities (hiring, exporting, R&D, training)

**How to assess:**
1. Extract must-have criteria from grant card or program guide
2. Check client profile for each criterion
3. **ONE missing = DISQUALIFIED** (stop assessment, don't waste time on other criteria)
4. **ALL present = Continue to Tier 2**

### Tier 2: SHOULD-HAVE Criteria (Strong Preferences)

These significantly improve chances but aren't absolute requirements.

**Common Should-Haves:**
- **Company Size:** Preferred employee count or revenue range
- **Owner Demographics:** Female-owned, Indigenous-owned, newcomer-led
- **Financial Health:** Positive cash flow, no CRA debts
- **Capacity:** Has HR department, accounting systems, project management
- **Track Record:** Previous grant success, strong references

**How to assess:**
1. Score each should-have criterion: Met (1 point) or Not Met (0 points)
2. Calculate percentage: (Met criteria / Total criteria) × 100
3. **Interpretation:**
   - 80-100%: Strong candidate (high priority)
   - 60-79%: Good candidate (medium priority)
   - 40-59%: Marginal candidate (low priority, high effort)
   - <40%: Weak candidate (probably not worth pursuing)

### Tier 3: NICE-TO-HAVE Criteria (Bonus Qualifiers)

These provide competitive advantages but don't determine basic eligibility.

**Common Nice-to-Haves:**
- Certifications (ISO, B-Corp, industry-specific)
- Partnerships with anchor organizations
- Previous program participation (shows capability)
- Strong community ties or social impact
- Innovative approaches or technologies

**How to assess:**
- Add bonus points to fit score (don't base qualification on these alone)
- Use as tie-breakers when multiple grants have similar fit scores
- Highlight in applications to strengthen competitiveness

## Eligibility Assessment Workflow

### Step 1: Gather Client Information

**Minimum data needed:**
- Legal business name
- Business structure (incorporated, sole prop, non-profit)
- Province/territory location
- Industry/sector
- Number of employees
- Annual revenue (approximate)
- What they want funding for (hiring, export, R&D, training, equipment)

**How to gather:**
```
From HubSpot:
- get_hubspot_company({ company_id: "[id]" })
- Extract: name, domain, industry, city, state, numberofemployees, annualrevenue

From discovery questions:
- "What specifically do you need funding for?"
- "Are you actively [hiring/exporting/doing R&D/training]?"
- "Do you have any CRA debts or legal issues?"
```

### Step 2: Search for Relevant Programs

Use `search_getgranted` with client-specific filters:

```javascript
search_getgranted({
  purposes: ["Hiring"],  // Based on client need
  regions: ["British Columbia"],  // Client location
  industries: ["Technology"],  // Client industry
  company_size_min: 20,  // Employee count
  company_size_max: 100,
  active_only: true,  // ALWAYS true unless historical research
  open_intakes_only: true,  // If urgent need
  limit: 20
})
```

### Step 3: Assess Each Program

For each program returned:

**A. Extract Eligibility Criteria**
- Read program description and eligibility section
- Categorize criteria into Must-Have / Should-Have / Nice-to-Have
- Note any explicit disqualifiers

**B. Check Must-Haves**
```
For each must-have criterion:
  ✅ Met: Continue to next criterion
  ❌ Not Met: DISQUALIFY, move to next program
  ❓ Unknown: Flag for client follow-up

If ALL must-haves met → Continue to Should-Haves
```

**C. Score Should-Haves**
```
Calculate fit percentage:
- Met criteria: +1 point each
- Not met: 0 points
- Unknown: 0 points (conservative approach)

Total Fit Score = (Met / Total) × 100%
```

**D. Note Nice-to-Haves**
- Don't impact qualification, but note for application strength

### Step 4: Identify Information Gaps

**If critical information is missing:**
- Flag as "REQUIRES FOLLOW-UP"
- List specific questions to ask client
- Provide conditional eligibility: "Qualifies IF [condition met]"

**Example:**
```
Program: IRAP (Industrial Research Assistance Program)

Assessment:
✅ Must-Have: Canadian company (confirmed)
✅ Must-Have: For-profit business (confirmed)
❓ Must-Have: R&D project in progress (UNKNOWN)

RESULT: "Likely qualifies IF they have an active R&D project.

Next Step: Ask client:
- 'Are you currently developing new technology or improving existing products?'
- 'Do you have a specific R&D project planned?'
- 'What percentage of your work involves research & development?'"
```

### Step 5: Rank Programs by Fit

Sort programs into priority tiers:

**Tier A - High Priority (80-100% fit):**
- Meets all must-haves
- Meets 80%+ of should-haves
- Strong value proposition (funding > effort required)
- **Recommendation:** Pursue immediately

**Tier B - Medium Priority (60-79% fit):**
- Meets all must-haves
- Meets 60-79% of should-haves
- Reasonable value proposition
- **Recommendation:** Pursue if capacity allows

**Tier C - Low Priority (40-59% fit):**
- Meets must-haves barely or has information gaps
- Meets <60% of should-haves
- Low value relative to effort
- **Recommendation:** Only pursue if no better options

**Tier D - Not Qualified (<40% fit or missing must-haves):**
- **Recommendation:** Do not pursue

## Common Disqualifiers by Program Type

### Hiring Grants (Wage Subsidies, Apprenticeships)
**Disqualifiers:**
- Not actively hiring (must have new position available)
- Replacing existing employee (must be net-new job)
- Seasonal/temporary position (many require permanent roles)
- Hiring family member (often excluded)
- Outstanding CRA payroll debts

**Red Flags:**
- High employee turnover (suggests retention issues)
- Previous wage subsidy claims but employee left early
- Unclear job description or necessity

### Export/Market Expansion Grants (CanExport, etc.)
**Disqualifiers:**
- No export activity planned (must have specific market target)
- Already selling in target market (many require NEW market entry)
- Importing goods (must be EXPORTING Canadian goods/services)
- Not majority Canadian-owned
- Target market is USA only (some grants exclude USA)

**Red Flags:**
- No market research done (suggests unprepared)
- Unrealistic sales projections
- No export-ready product or service

### R&D Grants (IRAP, SR&ED)
**Disqualifiers:**
- No technological innovation (routine improvements don't qualify)
- Not Canadian-controlled private corporation (CCPC requirement for SR&ED)
- No qualified R&D personnel
- Project already complete (must be future or ongoing)
- Purchasing existing technology (must be developing NEW tech)

**Red Flags:**
- Can't articulate technical uncertainty being resolved
- No documented R&D process
- Misunderstanding of what qualifies as R&D

### Training Grants (Employer Training Grant, etc.)
**Disqualifiers:**
- Not employer-led (employee self-directed training often excluded)
- Training for owner/sole proprietor only (must train employees)
- Mandatory training (e.g., safety certifications often excluded)
- Training provider not approved (check approved trainer list)
- Employee leaving before completion period

**Red Flags:**
- No training plan or provider identified
- Training doesn't align with business needs
- Poor employee retention history

## Eligibility Scoring Formula

Use this formula for quick fit assessment:

```
ELIGIBILITY FIT SCORE = (Must-Haves Met / Total Must-Haves) × 70
                      + (Should-Haves Met / Total Should-Haves) × 25
                      + (Nice-to-Haves Met / Total Nice-to-Haves) × 5

Interpretation:
- 85-100: Excellent fit (top priority)
- 70-84: Good fit (pursue)
- 55-69: Marginal fit (case-by-case)
- <55: Poor fit (likely not worth effort)

Note: If ANY must-have is missing, score = 0 (disqualified)
```

## Special Cases

### Multi-Location Businesses
```
If business operates in multiple provinces:
- Check if grant requires all operations to be in eligible province
- OR if head office location determines eligibility
- OR if specific project location determines eligibility

Common rule: Head office location = eligibility (but verify)
```

### Newly Incorporated Businesses
```
Many grants require:
- 1-2 years of operation
- Minimum revenue history
- Tax returns filed

If too new:
- Look for "startup-specific" grants
- Consider waiting until minimum age requirement met
- Some grants have "new business" streams
```

### Franchises
```
Eligibility varies by grant:
- Some exclude franchises entirely
- Some treat franchisee as independent business
- Franchisor may be required to have specific Canadian ownership %

Always verify franchise eligibility explicitly.
```

### Non-Profits vs. For-Profits
```
Many grants are for-profit ONLY.
Some are non-profit ONLY.
Few are open to both.

Check legal structure requirement first.
```

## Output Format

When presenting eligibility assessment:

```markdown
## [GRANT NAME] - Eligibility Assessment for [CLIENT NAME]

**OVERALL FIT: [Excellent/Good/Marginal/Poor] ([Score]%)**

### Must-Have Criteria (ALL required)
✅ [Criterion 1]: Met
✅ [Criterion 2]: Met
❓ [Criterion 3]: Unknown - requires follow-up

### Should-Have Criteria ([X]% met)
✅ [Criterion 1]: Met
❌ [Criterion 2]: Not Met
✅ [Criterion 3]: Met

### Nice-to-Have Criteria
✅ [Criterion 1]: Met (bonus)

---

**RECOMMENDATION:** [Pursue / Pursue with conditions / Do not pursue]

**REASONING:** [1-2 sentence explanation]

**NEXT STEPS:**
1. [Action item 1]
2. [Action item 2]

**INFORMATION GAPS:**
- [Question to ask client]
```

---

**Remember:** Eligibility is binary (qualified or not), but fit is a spectrum. A qualified client with 60% fit might not be worth the effort if other 85% fit opportunities exist.

**Conservative approach:** When in doubt, mark as "requires follow-up" rather than making assumptions.
