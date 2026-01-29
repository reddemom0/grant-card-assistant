# Grant Program Matching Methodology

**Strategic framework for matching clients to optimal grant opportunities based on fit, value, and feasibility.**

## Overview

Program matching goes beyond eligibility - it's about finding the BEST grants for each client based on their profile, needs, capacity, and timing. A client may qualify for 20 programs, but only 3-5 are worth pursuing.

## The Four-Dimensional Fit Model

Evaluate every grant across these four dimensions:

### Dimension 1: Eligibility Fit (0-100%)

**What it measures:** How well the client meets program requirements

**Scoring:**
```
100% = Exceeds all criteria (must-haves + should-haves + nice-to-haves)
85% = Meets all must-haves + most should-haves
70% = Meets all must-haves + some should-haves
55% = Barely meets must-haves
0% = Missing one or more must-haves (disqualified)
```

**Use:** Load `eligibility` sub-skill for detailed framework

### Dimension 2: Value Fit (0-100%)

**What it measures:** Funding amount relative to client size and need

**Scoring Formula:**
```
For Hiring/Wage Subsidy Grants:
Value Fit = (Grant Amount / Client Annual Payroll) × 100
  - >10% of payroll = 100 points (high impact)
  - 5-10% of payroll = 75 points (good impact)
  - 2-5% of payroll = 50 points (moderate impact)
  - <2% of payroll = 25 points (low impact)

For Capital/Equipment Grants:
Value Fit = (Grant Amount / Project Cost) × Coverage Factor
  - Covers 50%+ of project = 100 points
  - Covers 30-49% = 75 points
  - Covers 15-29% = 50 points
  - Covers <15% = 25 points

For Export/R&D Grants:
Value Fit = Based on strategic importance
  - Critical to growth plan = 100 points
  - Nice to have = 50 points
  - Opportunistic = 25 points
```

**Key Principle:** A $5K grant for a $50M company has low value fit. A $50K grant for a $1M company has high value fit.

### Dimension 3: Effort Fit (0-100%)

**What it measures:** Application complexity relative to client capacity

**Scoring:**
```
100 = Simple application + client has capacity
  - 1-2 page form
  - Minimal documentation
  - Quick turnaround (<1 month decision)
  - Client has organized records

75 = Moderate application + adequate capacity
  - 5-10 page application
  - Standard financial docs required
  - Normal timeline (1-3 months)
  - Client has some systems

50 = Complex application but manageable
  - 15-20 pages
  - Detailed project plans needed
  - 3-6 month process
  - Client needs support

25 = Very complex + client lacks capacity
  - 30+ page application
  - Technical reports required
  - 6-12 month process
  - Client disorganized/overwhelmed

0 = Unrealistic for client
  - Requires expertise client doesn't have
  - Timeline conflicts with other priorities
  - Client fundamentally unequipped
```

**Capacity Indicators:**
```
HIGH CAPACITY:
✅ Has accounting software and current financials
✅ HR systems in place
✅ Previous grant experience
✅ Organized document management
✅ Dedicated admin/management bandwidth

LOW CAPACITY:
❌ Disorganized financial records
❌ No HR systems or processes
❌ Never applied for grants before
❌ Operates on paper/spreadsheets
❌ Owner is sole employee doing everything
```

### Dimension 4: Timing Fit (0-100%)

**What it measures:** Deadline alignment with client readiness

**Scoring:**
```
100 = Perfect timing
  - Deadline 2-6 months away
  - Client ready to start now
  - No competing priorities
  - Open intake (no rush)

75 = Good timing
  - Deadline 1-2 months away
  - Client mostly ready
  - Manageable alongside other work

50 = Tight timing
  - Deadline <1 month away
  - Client needs prep time
  - Requires focus/prioritization

25 = Poor timing
  - Deadline <2 weeks away
  - Client not ready
  - Competing with other applications

0 = Impossible timing
  - Deadline passed
  - Intake closed
  - Client can't possibly prepare in time
```

**Always validate timing with `validation` sub-skill before scoring.**

## Total Fit Score Calculation

```
TOTAL FIT SCORE = (Eligibility × 0.40) + (Value × 0.25) + (Effort × 0.20) + (Timing × 0.15)

Weights explained:
- Eligibility (40%): Most important - client must qualify
- Value (25%): Significant - funding must be worthwhile
- Effort (20%): Important - must be feasible to complete
- Timing (15%): Relevant - must align with schedule

Interpretation:
- 85-100: Excellent match (top priority, pursue immediately)
- 70-84: Good match (solid opportunity, pursue)
- 55-69: Fair match (pursue if capacity allows)
- <55: Poor match (deprioritize or skip)
```

## Strategic Program Matching Workflow

### Step 1: Understand Client Profile

**Essential Information:**
```javascript
// From HubSpot
const clientProfile = {
  name: "TechStart Inc",
  industry: "Technology",
  location: "Vancouver, BC",
  employees: 35,
  revenue: "$5M",
  stage: "Growth-stage",

  // From discovery
  needs: ["Hiring 5 developers", "Export to USA market", "R&D for new product"],
  capacity: "Medium", // Organized but first-time grant applicant
  urgency: "Hiring is immediate, export is 6 months out, R&D is ongoing",

  // Constraints
  bandwidth: "Can handle 2-3 applications maximum",
  timeline: "Need funding decisions within 3 months"
};
```

### Step 2: Broad Search

Cast a wide net initially:

```javascript
search_getgranted({
  purposes: ["Hiring", "Market Expansion", "Research & Development"],
  regions: ["British Columbia"],
  industries: ["Technology"],
  company_size_min: 10,
  company_size_max: 100,
  active_only: true,
  limit: 50  // Get comprehensive list first
})
```

### Step 3: Score Each Program

For each grant returned:

**A. Eligibility Fit**
- Load `eligibility` sub-skill if needed for complex assessment
- Score 0-100%

**B. Value Fit**
- Calculate funding amount relative to client size
- Consider strategic importance of funded activity
- Score 0-100%

**C. Effort Fit**
- Assess application complexity
- Compare against client capacity
- Score 0-100%

**D. Timing Fit**
- Check deadline (use `validation` sub-skill)
- Assess client readiness
- Score 0-100%

**E. Calculate Total Fit**
- Apply weighted formula
- Round to whole number

### Step 4: Rank and Filter

**Sort programs by Total Fit Score (descending)**

**Filter by feasibility:**
```
Consider client constraints:
- Bandwidth: "Can handle 2-3 applications maximum"
  → Select top 3 programs only

- Timeline: "Need decisions within 3 months"
  → Remove any programs with 6+ month timelines

- Urgency: "Hiring is immediate"
  → Prioritize hiring grants over R&D grants
```

### Step 5: Portfolio Strategy

Don't just pick highest-scoring grants. Build a balanced portfolio:

**Portfolio Approach:**
```
TIER 1 (Top Priority - Pursue First):
- 1-2 grants with 85+ fit score
- Address most urgent need
- Quickest decision timeline

TIER 2 (Secondary - Pursue If Capacity):
- 2-3 grants with 70-84 fit score
- Address other important needs
- Manageable alongside Tier 1

TIER 3 (Backup - Monitor for Next Round):
- Grants with good fit but poor timing
- Save for future when client has more capacity
- Set reminders for next intake period
```

### Step 6: Present Recommendations

Format recommendations by priority tier with reasoning:

```markdown
# Grant Recommendations for [CLIENT NAME]

## TIER 1: TOP PRIORITIES (Pursue Immediately)

### 1. [Grant Name] - Fit Score: [92%]
- **Funding:** $[amount] for [purpose]
- **Timeline:** Application deadline: [date], Decision: [date]
- **Why This Grant:**
  - ✅ Addresses urgent [hiring] need
  - ✅ Excellent eligibility match (95%)
  - ✅ High value ($[X] = [Y]% of payroll)
  - ✅ Simple application (client can handle)

**RECOMMENDED ACTION:** Start application this week

---

### 2. [Grant Name] - Fit Score: [88%]
[Same format]

---

## TIER 2: SECONDARY OPPORTUNITIES (Pursue If Capacity)

[Same format for 2-3 more grants]

---

## TIER 3: FUTURE CONSIDERATION

[List 1-2 grants to revisit later]

---

## PORTFOLIO SUMMARY

**Total Potential Funding:** $[X]
**Total Applications:** [Y]
**Estimated Timeline:** [Z] months
**Success Probability:** [%] (based on fit scores)

**NEXT STEPS:**
1. [Action item 1]
2. [Action item 2]
```

## Advanced Matching Strategies

### Strategy 1: Sequencing Grants

Some grants should be pursued in sequence, not parallel:

**Example:**
```
CLIENT GOAL: Enter USA market

WRONG APPROACH:
Apply for CanExport and Trade Accelerator simultaneously

RIGHT APPROACH:
1. First: Trade Accelerator (market research & readiness assessment)
   → Use findings to strengthen CanExport application
2. Then: CanExport SME (market entry costs)
   → Use TAP deliverables as proof of market research
```

**Why this matters:**
- Grants build on each other (earlier grants provide evidence for later ones)
- Avoids duplication (some grants don't allow concurrent funding)
- Better outcomes (proper sequencing increases success rates)

### Strategy 2: Anchor Programs

Identify "anchor" grants that unlock others:

**Example:**
```
If client qualifies for IRAP (R&D support):
→ This often unlocks SR&ED tax credits (use IRAP as evidence)
→ May enable access to Innovation Grants (proof of R&D capability)
→ Can support Export grants (innovative product = competitive advantage)

IRAP becomes the "anchor" that validates other applications.
```

**How to identify anchors:**
- Grants with third-party validation (government assessment = strong proof)
- Grants requiring extensive documentation (reuse for other applications)
- Grants with brand recognition (mentioning IRAP in other apps adds credibility)

### Strategy 3: Diversification

Don't put all eggs in one basket:

**Portfolio Mix:**
```
RISKY: Apply to 1 large grant ($100K, 30% chance of success)

DIVERSIFIED: Apply to:
- 1 medium grant ($50K, 60% chance)
- 2 small grants ($25K each, 75% chance)
- Expected Value: $50K × 0.6 + $25K × 0.75 + $25K × 0.75 = $67.5K

Diversification increases expected outcome.
```

### Strategy 4: Client Capacity Matching

Match grant complexity to client maturity:

**First-Time Grant Applicants:**
- Start with simple, quick-win grants (Wage subsidies, small training grants)
- Build confidence and track record
- Move to complex grants later

**Experienced Grant Recipients:**
- Can handle complex, high-value grants (IRAP, CanExport, large R&D)
- Focus on strategic, high-impact opportunities
- Skip small grants unless very easy

### Strategy 5: Opportunity Cost Analysis

Every grant application has opportunity cost:

```
GRANT A:
- Funding: $25K
- Effort: 20 hours
- Timeline: 2 months
- Success Rate: 80%
- Expected Value: $25K × 0.8 = $20K
- Value per Hour: $20K / 20hr = $1,000/hr

GRANT B:
- Funding: $75K
- Effort: 100 hours
- Timeline: 6 months
- Success Rate: 30%
- Expected Value: $75K × 0.3 = $22.5K
- Value per Hour: $22.5K / 100hr = $225/hr

INSIGHT: Grant A is 4x more efficient despite lower total funding.
```

**When to prioritize efficiency:**
- Client has limited bandwidth
- Multiple good opportunities available
- Fast decision timelines needed

**When to prioritize total value:**
- One grant stands out as transformational
- Client has capacity for complex application
- Strategic importance > efficiency

## Common Matching Mistakes

**MISTAKE 1: Chasing Biggest Dollar Amount**
```
Wrong: "Let's apply for this $200K grant!"
Right: "Does the $200K grant fit our needs, or are we just chasing money?"

Reality: A poor-fit $200K grant with 10% success rate = $20K expected value
Better: A great-fit $30K grant with 80% success rate = $24K expected value
```

**MISTAKE 2: Ignoring Client Capacity**
```
Wrong: "Client qualifies for 15 grants, let's do them all!"
Right: "Client can realistically handle 3 applications. Which 3 are best?"

Reality: 15 half-done applications = 0 successful grants
Better: 3 well-done applications = 2-3 successful grants
```

**MISTAKE 3: Forgetting Timing**
```
Wrong: "This grant is a perfect match!" (deadline in 5 days)
Right: "Great match, but timing is impossible. Let's wait for next intake."

Reality: Rushed applications rarely succeed
Better: Well-prepared applications in next round
```

**MISTAKE 4: Not Validating Status**
```
Wrong: "I found this on GetGranted, so it must be open"
Right: "Let me validate the status before recommending"

Reality: GetGranted shows historical data too
Better: Always use `validation` sub-skill before final recommendation
```

---

**Remember:** Matching is as much art as science. Use the frameworks as guidelines, but apply judgment based on each client's unique situation.

**The goal:** Not to find the MOST grants, but to find the RIGHT grants.
