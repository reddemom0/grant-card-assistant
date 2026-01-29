# Grants Consultant Skill

**Expert capability for grant program analysis, client matching, and eligibility assessment.**

## When to Use This Skill

Activate this skill when you need to:
- **Analyze grant eligibility** for specific clients or scenarios
- **Match clients to grant programs** based on their profile
- **Validate grant program status** before making recommendations
- **Assess qualification criteria** across multiple programs
- **Prioritize grant opportunities** by fit score and value

## Quick Capabilities Overview

### 📋 Eligibility Analysis
Assess whether clients qualify for specific grant programs:
- Must-have vs. nice-to-have criteria evaluation
- Common disqualifiers by program type (Hiring, Export, R&D, Training)
- Qualification scoring frameworks
- Red flag identification

### 🎯 Program Matching
Match client profiles to optimal grant opportunities:
- Multi-dimensional fit scoring (eligibility, value, effort, timing)
- Portfolio approach for multiple program recommendations
- Prioritization logic for limited resources
- Strategic sequencing (which grants to pursue first)

### ✅ Status Validation
Verify grant programs are active and accepting applications:
- 5-step validation workflow (GetGranted → Web Search → Official Page → VisualPing → Timeline)
- Annual vs. closed program differentiation
- Deadline verification and extension tracking
- Open intake confirmation

## Detailed Guides

For comprehensive workflows and methodologies, load specific sub-skills:

### Core Workflows

**ELIGIBILITY.md** - Eligibility Analysis Framework
- Load when: Assessing if a client qualifies for specific programs
- Contains: Criteria frameworks, must-have checks, disqualifier identification
- Token cost: ~3K tokens

**MATCHING.md** - Program Matching Methodology
- Load when: Finding best-fit programs for a client
- Contains: Fit scoring, prioritization logic, portfolio strategies
- Token cost: ~3K tokens

**VALIDATION.md** - Status Validation Workflow
- Load when: Verifying grant program status before recommending
- Contains: 5-step validation checklist, annual program handling, timing verification
- Token cost: ~2.5K tokens

## Available Tools

You already have access to grant-related tools (loaded separately):
- `search_getgranted` - Search 188+ Canadian grants by criteria
- `get_visualping_alerts` - Monitor grant page changes in real-time
- `WebSearch`, `WebFetch` - Validate official grant pages
- `search_hubspot_companies` - Pull client data for matching

**This skill provides the METHODOLOGY for using those tools effectively.**

## Decision Tree: Which Sub-Skill to Load?

**User asks: "Does Company X qualify for Grant Y?"**
→ Load `eligibility` sub-skill for qualification framework

**User asks: "Find grants for Company X"**
→ Load `matching` sub-skill for client-to-program matching logic

**User asks: "Is Grant Y still accepting applications?"**
→ Load `validation` sub-skill for status verification workflow

**User asks: "Which grants should we prioritize for this client?"**
→ Load `matching` sub-skill for prioritization framework

**User provides grant recommendation task without specific ask:**
→ Load `matching` + `validation` (match programs, then validate before presenting)

## Key Concepts

### Eligibility Tiers
- **Must-Have:** Hard requirements (business type, location, industry). Missing one = disqualified.
- **Should-Have:** Strong preferences (company size, revenue, demographics). Missing = lower fit score.
- **Nice-to-Have:** Bonus qualifiers (certifications, partnerships). Not required.

### Fit Scoring Dimensions
1. **Eligibility Fit** (0-100%): How well client meets criteria
2. **Value Fit** (0-100%): Funding amount relative to client size/need
3. **Effort Fit** (0-100%): Application complexity relative to client capacity
4. **Timing Fit** (0-100%): Deadline alignment with client readiness

### Grant Status Types
- **Active - Open Intake:** Accepting applications NOW
- **Active - Closed Intake:** Program exists but not currently accepting
- **Annual - Predictable:** Opens same time each year
- **Inactive:** Program discontinued or suspended indefinitely

### The Cardinal Rule
**NEVER recommend a closed grant without clarifying when it opens.**

Annual programs are okay to recommend IF you clearly state: "Opens [month/quarter] - prepare now, apply then."

## Example Use Cases

### Use Case 1: Eligibility Assessment
```
User: "Does TechCo (BC, 25 employees, software) qualify for IRAP?"

Process:
1. Load eligibility sub-skill for qualification framework
2. Assess TechCo against IRAP criteria:
   - Must-Have: Canadian company (✓), R&D project (?)
   - Should-Have: Growth-stage (✓), tech industry (✓)
3. Identify information gaps (need to confirm R&D project)
4. Return: "Likely qualifies IF they have an R&D project. Next step: Ask about their R&D activities."
```

### Use Case 2: Program Matching
```
User: "Find grants for Acme Construction (BC, 50 employees, actively hiring)"

Process:
1. Load matching sub-skill for fit scoring logic
2. Search GetGranted with construction + BC + hiring filters
3. Score each result across 4 fit dimensions
4. Prioritize by total fit score
5. Load validation sub-skill to verify status
6. Present: Top 3-5 programs with fit scores and reasoning
```

### Use Case 3: Status Validation
```
User: "Is Basin Apprentice Wage Subsidy still available?"

Process:
1. Load validation sub-skill for 5-step workflow
2. Search GetGranted (active_only=true)
3. WebSearch: "[program name] 2026 open intake"
4. WebFetch official program page
5. Check VisualPing alerts for recent changes
6. Return: "✓ ACTIVE and accepting applications. Deadline: [date]. No recent changes detected."
```

## Integration with HubSpot

For client-based grant matching:
1. Pull company data: `search_hubspot_companies` or `get_hubspot_company`
2. Extract: industry, location, size, best_fit_product
3. Load `matching` sub-skill
4. Use HubSpot data as input for fit scoring
5. Update HubSpot notes with grant recommendations

## Best Practices

**✅ DO:**
- Always validate grant status before recommending (use `validation` sub-skill)
- Score fit across multiple dimensions (not just eligibility)
- Provide reasoning for recommendations (why this grant for this client)
- Flag programs requiring additional client information
- Consider timing (don't recommend if deadline is 2 days away)

**❌ DON'T:**
- Recommend closed grants without timing clarification
- Only consider funding amount (higher $ ≠ better fit)
- Ignore effort required (complex grants may not be worth it for small funding)
- Skip status validation ("I saw it on GetGranted" is not enough)

## Skill Metadata

**Token Cost:**
- SKILL.md (this overview): ~2,000 tokens
- ELIGIBILITY.md: ~3,000 tokens
- MATCHING.md: ~3,000 tokens
- VALIDATION.md: ~2,500 tokens
- **Total:** ~10,500 tokens (load only what you need)

**Tools Required:**
- `search_getgranted` (primary grant search)
- `get_visualping_alerts` (status monitoring)
- `WebSearch`, `WebFetch` (validation)
- `search_hubspot_companies` (client data)

**Knowledge Base:** None required (self-contained)

---

**Ready to match clients with perfect-fit grants.** Load specific sub-skills as needed for detailed methodologies.
