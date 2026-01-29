# Ideal Client Profile (ICP) Analysis

**Build data-driven ideal client profiles from won customers to optimize sales targeting and messaging.**

## Overview

ICP analysis transforms historical customer data into actionable targeting criteria. By analyzing patterns in won deals, you can identify the most valuable customer segments and optimize sales efforts.

## When to Build an ICP

- Launching a new sales campaign or initiative
- Entering a new market or industry vertical
- Optimizing sales team focus and prioritization
- Creating targeted marketing campaigns
- Training new sales team members
- Annual sales planning and strategy sessions
- Low conversion rates (need to refine targeting)

## ICP Analysis Framework

### Step 1: Data Collection

**Gather won customer data from HubSpot:**

```javascript
// Search for won customers
search_hubspot_companies({
  query: "*",
  lifecycle_stage: "customer",
  // Add filters for specific segment:
  // - industry
  // - createdate_after (recent wins)
  // - min_revenue / max_revenue
  limit: 50,
  sort_by: "createdate",
  sort_order: "DESC"
})

// For each customer, get complete details:
get_hubspot_company({ company_id: "[id]" })
```

**What to collect:**
- Company size (employees, revenue)
- Industry and specialization
- Geographic location
- Deal value and services purchased
- Time to close
- Engagement history
- Referral source

### Step 2: Segmentation Analysis

**Group customers into tiers based on value:**

**Tier 1 - High-Value Customers:**
- Characteristics: Largest revenue, highest LTV, multiple services
- Example criteria: $50M+ revenue, 100+ employees
- Why segment: Premium service, white-glove treatment, case studies

**Tier 2 - Core Customers:**
- Characteristics: Solid revenue, good fit, repeatable process
- Example criteria: $10M-$50M revenue, 30-100 employees
- Why segment: Scalable sales motion, primary target

**Tier 3 - Small Customers:**
- Characteristics: Lower revenue, simpler needs, high volume potential
- Example criteria: $1M-$10M revenue, 10-30 employees
- Why segment: Self-service options, limited touch

**Analyze each tier separately for patterns.**

### Step 3: Pattern Identification

**Look for patterns across 7 key dimensions:**

#### 1. Geographic Patterns
```
Analyze location data:
- Primary markets: Which provinces/states have most customers?
- Secondary markets: Where else do we win?
- Market concentration: Are customers clustered geographically?
- Expansion opportunities: Adjacent markets to enter?

Example output:
"90% of customers in British Columbia, 10% in Alberta.
Within BC: 50% Lower Mainland, 20% Interior, 15% Vancouver Island.
Opportunity: Target Metro Vancouver specifically."
```

#### 2. Size Patterns
```
Analyze revenue and employee count:
- Revenue sweet spot: Which revenue range converts best?
- Employee range: Ideal team size for our services?
- Growth stage: Startups vs established vs enterprise?

Example output:
"Sweet spot: $5M-$50M revenue, 30-115 employees.
$50M+ = high value but longer sales cycles.
Under $1M = low ROI, avoid."
```

#### 3. Industry/Vertical Patterns
```
Analyze industry and specialization:
- Which industries convert best?
- What specializations within industries?
- Are there sub-niches to target?

Example output:
"All construction specializations work, but residential and civil
construction show highest engagement and deal sizes."
```

#### 4. Service/Product Patterns
```
Analyze what they buy:
- Most common first purchase?
- Upsell patterns?
- Service bundles?
- Recurring vs one-time?

Example output:
"Primary: Hiring grants (80%), Training grants (60%)
Secondary: Export grants (20%), R&D grants (10% but high value)
Upsell path: Hiring → Training → Export"
```

#### 5. Qualification Criteria
```
Identify must-have characteristics:
- Legal structure required?
- Financial thresholds?
- Operational requirements?
- Technical capabilities?

Example output:
"Must be: BC-based, incorporated, $10M+ revenue, actively hiring.
Nice to have: Existing HR systems, growth-focused, open to training."
```

#### 6. Exclusion Criteria
```
Identify red flags and non-fits:
- Too small (under what threshold?)
- Wrong industry?
- Geographic limitations?
- Behavioral red flags?

Example output:
"Exclude: Under 10 employees, under $1M revenue, sole proprietors,
poor record-keeping, outside BC/AB."
```

#### 7. Lifetime Value Analysis
```
Calculate expected value by tier:
- Year 1 revenue
- Year 2-3 revenue (retention)
- Total LTV
- Cost to acquire
- LTV:CAC ratio

Example output:
"Tier 1 LTV: $55K-$140K (3-5 year avg)
Tier 2 LTV: $24K-$50K (2-3 year avg)
Tier 3 LTV: $9K-$18K (1-2 year avg)"
```

### Step 4: ICP Documentation

**Create structured ICP document with sections:**

#### ICP Template Structure

```markdown
# [INDUSTRY/VERTICAL] - Ideal Client Profile

## Summary
- Target market: [Geographic focus]
- Company size: [Revenue and employee ranges]
- Industry: [Primary and secondary verticals]
- Sweet spot: [Most valuable segment]

## Geographic Profile
- Primary market: [State/province with %]
- Secondary markets: [Other locations]
- Why this matters: [Strategic reasoning]

## Company Size Profile
### Tier 1 - High-Value Clients
- Size: [Revenue, employees]
- Examples: [2-3 company names]
- Service fit: [What they buy]
- Value: [Expected LTV]

### Tier 2 - Core Clients
- [Same structure]

### Tier 3 - Small Clients
- [Same structure]

## Industry/Specialization
- Primary: [Main verticals]
- Secondary: [Adjacent verticals]
- Why it matters: [Grant fit, needs alignment]

## Revenue Profile
- Ideal range: [$X - $Y]
- High value: [$Z+]
- Minimum viable: [$W]
- Red flags: [When to avoid]

## Service Offerings & Fit
### Primary Services (Highest Demand)
1. [Service name]
   - Why: [Customer need]
   - Value: [Deal size]
   - Fit: [Which tier]

### Secondary Services
[Same structure]

## Qualification Criteria
✅ IDEAL CLIENT Checklist:
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

⚠️ QUALIFIED WITH CAUTION:
- [Scenarios that need extra vetting]

❌ NOT QUALIFIED:
- [Hard disqualifiers]

## Lead Generation Strategy
### Where to Find Them
1. [Channel 1]: [Specific tactics]
2. [Channel 2]: [Specific tactics]

### Messaging & Positioning
- Pain points: [Top 3]
- Value propositions: [Top 3]
- Subject lines: [Examples]

## Success Metrics
- Conversion rate targets by tier
- Average deal value by tier
- Expected LTV by tier
- Sales cycle length by tier

## Next Steps
[Recommended actions to activate ICP]
```

### Step 5: Actionable Outputs

**Transform ICP into operational tools:**

#### Lead Scoring Model
```
Create point system:
- BC-based: +10 points
- 30-100 employees: +15 points
- $10M+ revenue: +20 points
- Actively hiring: +10 points
- Existing HR systems: +5 points

Score interpretation:
- 50+ points: Tier 1 (immediate outreach)
- 30-49 points: Tier 2 (qualified lead)
- 15-29 points: Tier 3 (nurture)
- <15 points: Not qualified
```

#### Outreach Templates by Tier
```
Tier 1 (High-Touch):
Subject: "[Name], $75K funding opportunity for [Company]"
Body: Personalized, reference-specific company details, executive tone

Tier 2 (Standard):
Subject: "Is [Company] hiring in 2026? You could qualify for $21K+"
Body: Semi-personalized, focus on common pain point, professional tone

Tier 3 (Scale):
Subject: "Free training for your team - BC covers 80% of costs"
Body: Template-based, educational focus, self-service CTA
```

#### Discovery Call Scripts
```
Tier 1 qualifying questions:
- What are your growth goals for the next 3 years?
- How many employees are you planning to hire this year?
- Have you considered expanding to US markets?
- What's your annual training budget?

Tier 2 qualifying questions:
- Are you currently hiring?
- What positions are hardest to fill?
- Have you used government grants before?
- What training does your team need?
```

#### HubSpot Views & Filters
```
Create saved views:
- "ICP Tier 1 Prospects" (50+ score)
- "ICP Tier 2 Prospects" (30-49 score)
- "Recently Added - ICP Match" (new leads matching ICP)
- "ICP Customers - Upsell Ready" (existing customers in ICP)
```

## ICP Analysis Example: Construction Companies

**Based on 10 won customers analysis:**

### Summary
- **Target market:** British Columbia (focus: Lower Mainland)
- **Company size:** 30-115 employees, $10M-$50M revenue
- **Industry:** All construction specializations (residential, civil, commercial, specialty)
- **Sweet spot:** $10M revenue, 30-50 employees, BC-based, actively hiring

### Geographic Profile
- **Primary:** British Columbia (90%)
  - Lower Mainland: 50%
  - Interior BC: 20%
  - Vancouver Island: 15%
  - Northern BC: 5%
- **Secondary:** Alberta (10%)
- **Why:** BC has 13+ provincial grants unavailable in other provinces

### Size Segmentation

**Tier 1 (100+ employees, $50M+):**
- Examples: Traine Construction (104 emp), All Roads Construction (115 emp)
- Services: Multi-grant portfolios, R&D grants ($300K+), export grants
- LTV: $55K-$140K

**Tier 2 (30-50 employees, $10M):**
- Examples: A.W.Kennedy, Construction Drilling, Alderidge, HIBCO
- Services: Hiring grants, training grants, market expansion
- LTV: $24K-$50K

**Tier 3 (10-30 employees, $1M-$5M):**
- Examples: TQ Construction (16 emp)
- Services: Hiring grants, small training grants
- LTV: $9K-$18K

### Service Patterns
1. **Hiring Grants (80% of customers)**
   - Basin Apprentice Wage Subsidy: $21.6K
   - Basin Summer Works: $7K
   - Why: Constant need for skilled trades

2. **Training Grants (60% of customers)**
   - Employer Training Grant: Up to 80% of costs
   - Why: Project management, safety training needs

3. **Export Grants (20% of customers)**
   - CanExport SME: Up to $75K
   - Why: Expansion to US markets (Colony Construction example)

### Qualification Criteria
✅ **IDEAL:**
- BC-based (especially Lower Mainland)
- 30-100+ employees
- $10M+ revenue
- Actively hiring skilled trades
- Open to training/development
- Growth-focused

❌ **DISQUALIFIED:**
- Under 10 employees
- Under $1M revenue
- Outside BC/AB
- Sole proprietors
- Poor financial records

### Lead Generation
**Where to find:**
- BC Construction Association
- LinkedIn (Construction + BC + 30-500 employees)
- VRCA events
- Referrals from accountants/equipment suppliers

**Messaging:**
- Pain: "Struggling to find skilled trades?"
- Solution: "$21K+ wage subsidies + free training"
- Proof: "[X] BC construction companies funded in 2025"

### Activation Plan
1. Build LinkedIn list: 50 BC construction companies (30-115 emp)
2. Outreach sequence: Email + LinkedIn InMail + phone
3. Discovery calls: Hiring plans, training needs, growth goals
4. Service matching: Hiring grants → Training grants → Export grants

---

## ICP Maintenance & Refinement

**Review ICP quarterly:**

### What to Track
- Conversion rate by tier (improving or declining?)
- Deal size trends (growing or shrinking?)
- New patterns emerging (new industries, geographies?)
- Failed deals analysis (why did they not convert?)
- Customer feedback (what attracted them?)

### When to Update ICP
- **Major change:** New service offering, market shift, economic changes
- **Data threshold:** After 20+ new customers (refresh patterns)
- **Performance issues:** Low conversion, longer sales cycles
- **Expansion:** Entering new market or vertical

### Red Flags to Watch
- Declining conversion rates → ICP may be outdated
- Increasing churn → Wrong customer profile
- Lower deal sizes → Targeting too small
- Longer sales cycles → Wrong decision-makers

## Advanced ICP Techniques

### Multi-Dimensional Segmentation
```
Instead of single tier (Tier 1/2/3), use matrix:

           | High Urgency | Med Urgency | Low Urgency
-----------|--------------|-------------|-------------
High Value | HOT (call)   | WARM (email)| NURTURE
Med Value  | WARM (email) | NURTURE     | DISQUALIFY
Low Value  | NURTURE      | DISQUALIFY  | DISQUALIFY
```

### Negative ICP (Anti-Persona)
```
Document who NOT to target:

"Don't waste time on:
- Startups under 2 years old (no grant history = harder approval)
- Companies outside BC/AB (no provincial grants)
- Companies with outstanding CRA debts (grant disqualification)
- Companies resistant to process documentation
- Price shoppers (lowest fee, not best service)"
```

### Predictive Lead Scoring
```
Use historical data to predict success:

High Success Indicators:
+ Referred by existing customer (+30 points)
+ Multiple decision-makers engaged (+20 points)
+ Fast response time (<24hr) (+15 points)
+ Asked detailed questions (+10 points)

Failure Indicators:
- Ghosted after proposal (-20 points)
- Only interested in pricing (-15 points)
- "Just browsing" language (-10 points)
```

## ICP Tools & Resources

### HubSpot Properties for ICP Tracking
```
Custom properties to add:
- ICP_Score (calculated)
- ICP_Tier (Tier 1/2/3)
- ICP_Match_Reason (why they fit)
- ICP_Red_Flags (concerns to address)
- ICP_Next_Action (recommended step)
```

### Templates & Checklists
- ICP Workshop Agenda (for team alignment)
- ICP Scoring Spreadsheet (point system calculator)
- ICP Validation Survey (send to existing customers)
- ICP Refresh Checklist (quarterly review)

---

**Remember: An ICP is a living document. Start with data, validate with results, refine continuously.**
