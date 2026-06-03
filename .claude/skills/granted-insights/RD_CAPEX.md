# Granted Insights — R&D and Capital Expenditure Grants

Load for R&D programs, capital cost programs, equipment funding, retrofits, scale-up, and commercialization grants.

## Reasoning scaffold (internal — do not output)

1. What should a business realistically expect — true implementation funding, planning/assessment support, or something in between?
2. Is this better suited for planning, pilot work, scale-up, equipment purchase, commercialization, or process improvement?
3. How competitive does it appear? What signals point to a high or low bar?
4. What's the effort to apply well — technical scope, quotes, milestones, business plan, financials, partnership letters?
5. What company / project stage is the best fit — early R&D, late-stage commercialization, established operators only?
6. Are there hidden constraints — pre-approval, retention, intellectual property terms, matching funds?
7. Is the advertised funding maximum realistic in practice, or is the typical award much smaller?
8. What expectation should we set?

## Pay special attention to

### For R&D programs specifically

- **Technology Readiness Level (TRL).** Most R&D programs target a specific TRL band (e.g., 4–7). Projects outside the band are ineligible. Confirm where the client's project actually sits.
- **Pure research rarely funded.** Programs almost always expect a path to commercial application. Academic-flavored projects without a clear commercialization arc are weak fits.
- **Validation expectations.** Lab validation alone is rarely enough. Real-world or industrial validation is often required.
- **Quantifiable outcomes.** Evaluators want measurable results — GHG reduction, efficiency gain, performance improvement, IP creation. Soft outcomes ("improved knowledge") don't compete.
- **Max vs. realistic funding.** R&D programs often advertise high ceilings ($1M+) but typical awards are a fraction of that. Calibrate the client's expectation accordingly.

### For Capital Cost programs specifically

- **Pre-approval is critical.** Most Capital Cost programs require formal approval before the applicant purchases the asset. Spending before approval typically disqualifies the expense. This is the single most common disqualifier across this category.
- **Reimbursement-based payment.** Funds release after the asset is purchased and installed. Applicants must front the capital.
- **Retention obligations.** Many programs require the applicant to retain the funded asset for a defined period (often 3–5 years). Disposal or relocation can trigger clawback.
- **Quotes and documentation.** Programs typically require multiple quotes for major purchases plus invoices and proof of payment for claims.
- **Ownership rules.** Leased equipment is often ineligible. Some programs require the asset to be owned outright at the time of claim.

### Common to both

- **Matching funds.** Many programs require the applicant to contribute 25–50% from their own resources. Confirm capacity.
- **Project plan rigor.** Both types reward detailed milestones, budgets, and risk mitigation. Light project plans do not compete.
- **Reporting and milestone gates.** Funding is often released in tranches against milestone completion, not lump-sum.

## Output format

```
## Granted Insights — R&D / Capital Expenditure Grant

**Top 3 insights**
1. [Most important strategic point]
2. [Second insight]
3. [Third insight]

**Best-fit applicant / project stage**
[1–2 sentences on company profile and where the project needs to sit (TRL, scale-up stage, asset class)]

**Effort level**
[Low / Moderate / High — typically High for this category. One sentence on what drives it.]

**Competitiveness**
[Assessment. Distinguish between competitive (oversubscribed) and selective (high bar, fewer applicants but tight criteria).]

**Key watchouts**
- [Watchout 1 — for Capital Cost, pre-approval should almost always be flagged; for R&D, TRL fit or commercialization expectation]
- [Watchout 2 — matching funds, retention, or reimbursement cash flow]
- [Watchout 3 if material]

**Expectation to set with client**
[2–3 sentences. Cover realistic funding (not max), cash flow burden of reimbursement, and the project rigor required to compete. If pre-approval applies, name it explicitly.]
```
