# Grant Status Validation Workflow

**Systematic 5-step process for verifying grant programs are active and accepting applications before making recommendations.**

## The Cardinal Rule

**NEVER recommend a closed grant without clarifying when it opens.**

Recommending closed programs destroys credibility and wastes everyone's time. Always validate status before final recommendation.

## Why Validation Matters

**Common failure scenarios:**
- Grant program listed in GetGranted but intake closed 6 months ago
- Annual program that opens predictably but not currently accepting
- Program suspended due to budget cuts
- Deadline extended or changed (old information cached)
- Program restructured or renamed

**The cost of getting it wrong:**
- Client wastes time preparing application for closed program
- Loss of trust in recommendations
- Missed opportunities while pursuing dead ends
- Reputational damage to consulting business

---

## The 5-Step Validation Workflow

### Step 1: Search GetGranted with `active_only=true`

**Always start here:**

```javascript
search_getgranted({
  purposes: ["Hiring"],
  regions: ["British Columbia"],
  active_only: true,  // DEFAULT - DO NOT change to false
  open_intakes_only: false,  // Use true only for urgent needs
  limit: 20
})
```

**What `active_only=true` means:**
- Program exists and has not been discontinued
- Program has either current open intake OR predictable future intake
- Does NOT guarantee applications are being accepted right now

**Why this isn't enough:**
- GetGranted may have stale intake dates
- Programs can close between GetGranted updates
- Need real-time validation from official sources

**Output:**
- List of potentially active programs
- Proceed to Step 2 for each program before recommending

---

### Step 2: Validate with Web Search

**For EACH program you plan to recommend:**

```javascript
WebSearch({
  query: "[Grant Program Name] [Current Year] open intake deadline application"
})
```

**Example:**
```
WebSearch: "Basin Apprentice Wage Subsidy 2026 open intake deadline application"
```

**Look for these signals:**

**✅ OPEN SIGNALS (good to recommend):**
- "Now accepting applications"
- "Apply now"
- "Deadline: [future date]"
- "Open intake"
- "Rolling applications accepted"
- "Applications open until [future date]"

**🛑 CLOSED SIGNALS (do NOT recommend without clarification):**
- "Applications closed"
- "No longer accepting applications"
- "Intake closed until [future date]"
- "Waitlist only"
- "Program suspended"
- Past deadline with no new intake announced

**⚠️ ANNUAL SIGNALS (clarify timing):**
- "Opens [month/season] annually"
- "Next intake: [future month]"
- "Applications typically open in [timeframe]"
- "Currently not accepting - check back [month]"

**What to do with each:**
```
✅ OPEN: Continue to Step 3 (verify official page)

🛑 CLOSED:
  - If permanently closed → Remove from recommendations
  - If annual/temporary closure → Note timing and continue to Step 3

⚠️ ANNUAL:
  - Note expected opening date
  - Continue to Step 3 to confirm annual pattern
  - Include timing in final recommendation
```

---

### Step 3: Check Official Program Page

**Use WebFetch to load the official government/program page:**

```javascript
WebFetch({
  url: "[Official program URL from GetGranted or search results]",
  prompt: "Extract: 1) Current application status (open/closed), 2) Deadline if open, 3) Next intake date if closed, 4) Any special conditions or updates"
})
```

**Try multiple URL variations if needed:**
```
1. HTTPS with www: https://www.example.com/program
2. HTTPS without www: https://example.com/program
3. HTTP with www: http://www.example.com/program
4. HTTP without www: http://example.com/program

NEVER give up after one failed attempt.
```

**What to extract:**
```
CURRENT STATUS:
□ Applications open
□ Applications closed
□ Rolling intake (always open)
□ Waitlist only

IF OPEN:
□ Deadline date: [YYYY-MM-DD]
□ Intake period: [start date] to [end date]
□ Any funding caps or limits reached?

IF CLOSED:
□ Next intake: [Expected date or season]
□ Annual pattern: [When does it typically open?]
□ Reason for closure: [Budget exhausted, program redesign, scheduled closure]

SPECIAL CONDITIONS:
□ Priority populations or regions?
□ First-come, first-served?
□ Application limit per organization?
```

**Compare official page against GetGranted data:**
- Deadlines match? → Good sign
- Deadlines different? → Use official page (more current)
- Status contradicts GetGranted? → Trust official page

---

### Step 4: Cross-Reference VisualPing Alerts

**Check for recent changes to the program page:**

```javascript
get_visualping_alerts({
  days: 30,  // Check last 30 days
  priority: "high",  // Filter for significant changes
  change_type: "deadline_change,new_program,eligibility_update"
})
```

**Search alerts for the program name:**
```
Filter results for mentions of:
- Program name
- Administering agency
- Deadline keywords
```

**What VisualPing reveals:**
```
✅ RECENT CHANGES DETECTED:
- Deadline extended → Update recommendation with new date
- Eligibility expanded → Client may now qualify
- New intake announced → Confirm timing

⚠️ WARNING CHANGES:
- Deadline moved up → Urgent action needed
- Eligibility restricted → Verify client still qualifies
- Funding reduced → Adjust value expectations

🛑 NEGATIVE CHANGES:
- Program suspended → Remove from recommendations
- Intake closed early → Do not recommend
- "No longer accepting" added → Mark as inactive
```

**Why this matters:**
- Catches changes between GetGranted updates and your recommendation
- Provides proof of due diligence
- Identifies opportunities (extensions) and risks (early closures)

---

### Step 5: Synthesize and Categorize

**Based on Steps 1-4, categorize each program:**

### Category A: ACTIVE - Open Intake

**Criteria:**
- ✅ Found in GetGranted (active_only=true)
- ✅ Web search confirms open status
- ✅ Official page confirms accepting applications
- ✅ Deadline is in the FUTURE
- ✅ No VisualPing alerts indicating closure

**Recommendation format:**
```markdown
### [GRANT NAME] - ✅ ACTIVE & OPEN
- **Status:** Currently accepting applications
- **Deadline:** [Date]
- **Funding:** $[amount] for [purpose]
- **Next Steps:** [Start application immediately / Schedule discovery call / Gather documents]

**VALIDATION CONFIRMED:**
- GetGranted: Active ✓
- Web search: Open intake confirmed ✓
- Official page: Accepting apps until [date] ✓
- Last verified: [Date]
```

---

### Category B: ACTIVE - Closed Intake (Annual Pattern)

**Criteria:**
- ✅ Found in GetGranted (active_only=true)
- ⚠️ Web search indicates "opens annually in [month]"
- ⚠️ Official page shows "next intake [future date]"
- ✅ No VisualPing alerts indicating permanent closure

**Recommendation format:**
```markdown
### [GRANT NAME] - 🔄 ANNUAL PROGRAM (Not Currently Accepting)
- **Status:** Closed - Opens [Month/Quarter Year]
- **Expected Timeline:** Applications typically open [timeframe]
- **Funding:** $[amount] for [purpose]
- **Next Steps:** [Prepare application materials now / Set reminder for [month] / Monitor for intake announcement]

**VALIDATION CONFIRMED:**
- GetGranted: Active (annual program) ✓
- Web search: Opens [month] annually ✓
- Official page: Next intake [estimated date] ✓
- Recommendation: **Prepare now, apply when opens**

⚠️ **IMPORTANT:** This program is NOT currently accepting applications. Recommended action is to prepare materials now and apply when the next intake opens in [month].
```

**You CAN recommend annual programs IF you clearly state timing.**

---

### Category C: ACTIVE - Rolling Intake

**Criteria:**
- ✅ Found in GetGranted (active_only=true)
- ✅ Web search indicates "rolling applications" or "continuous intake"
- ✅ Official page confirms "no deadline" or "ongoing"
- ✅ No recent VisualPing alerts indicating closure

**Recommendation format:**
```markdown
### [GRANT NAME] - ✅ ROLLING INTAKE
- **Status:** Continuously accepting applications (no deadline)
- **Funding:** $[amount] for [purpose]
- **Processing Time:** [Typical decision timeline]
- **Next Steps:** [Apply when ready - no rush due to deadline]

**VALIDATION CONFIRMED:**
- GetGranted: Active ✓
- Web search: Rolling basis confirmed ✓
- Official page: No deadline listed ✓
- Last verified: [Date]

**Note:** While there's no application deadline, funding is often first-come-first-served. Don't delay unnecessarily.
```

---

### Category D: INACTIVE - Do Not Recommend

**Criteria:**
- ❌ Not found in GetGranted OR active_only=false required to find
- ❌ Web search indicates "program closed" or "suspended"
- ❌ Official page shows no future intake planned
- ❌ VisualPing alerts indicate permanent closure

**What to do:**
```
DO NOT INCLUDE IN RECOMMENDATIONS

If user specifically asks about this program:
"[Grant Name] is currently inactive. [Reason if known].

ALTERNATIVE PROGRAMS:
- [Similar Program 1]: [Brief description]
- [Similar Program 2]: [Brief description]

Would you like me to analyze these alternatives?"
```

---

## Validation Checklist

**Before recommending ANY grant, confirm:**

- [ ] Found in GetGranted with `active_only=true`
- [ ] Web search confirms current status (open, annual, or rolling)
- [ ] Official program page verified (tried all 4 URL variations if needed)
- [ ] Cross-referenced VisualPing alerts for recent changes
- [ ] Deadline is in the FUTURE (if fixed deadline)
- [ ] Categorized correctly (Active-Open / Annual / Rolling / Inactive)
- [ ] Timing clearly communicated in recommendation

**If any step fails or raises doubt → Do additional research before recommending.**

---

## Special Validation Scenarios

### Scenario 1: Conflicting Information

**Problem:**
```
- GetGranted says: "Deadline March 31, 2026"
- Official page says: "Deadline extended to April 30, 2026"
- Web search finds: "No longer accepting applications"
```

**Resolution:**
1. **Trust most recent official source** (official page > web search > GetGranted)
2. **Use VisualPing to see if page recently changed**
3. **Call program administrator if still unclear** (rare, but sometimes necessary)
4. **Document the conflict in notes**

**Recommendation:**
```
Based on most recent official page (checked [date]), deadline is April 30, 2026.

Note: Conflicting information found during validation. Official program page trusted as primary source. Recommend confirming with program administrator before finalizing application.
```

---

### Scenario 2: Soft Close (Funding Depleted)

**Problem:**
```
Program is "open" but funding already committed for the year
```

**Signals:**
- Page says "applications accepted" but also mentions "subject to availability"
- News articles: "[Program] funding exhausted for 2026"
- VisualPing alert: "Waitlist only" added to page

**Resolution:**
```
DO NOT RECOMMEND unless:
1. Client is okay with waitlist risk
2. Program explicitly states new funding coming soon
3. Alternative similar programs exist

Better: Find similar programs with confirmed funding
```

---

### Scenario 3: Phase-Out Program

**Problem:**
```
Program exists but being phased out/replaced
```

**Signals:**
- GetGranted: Active
- Official page: "This program will be replaced by [New Program] in [date]"
- Current intake is final or second-to-last

**Resolution:**
```
Recommend with caveat:

"[Grant Name] - Final Intake
- Status: Open (final or second-to-last intake before phase-out)
- Deadline: [Date]
- Replacement: [New Program Name] launches [date]

⚠️ This is the final/second-to-last intake for this program. If client misses this deadline, they'll need to wait for replacement program [Name] in [date]."
```

---

### Scenario 4: Regional Pilot Programs

**Problem:**
```
Program exists but only in limited regions for pilot testing
```

**What to check:**
- Is client's location explicitly listed as eligible region?
- Is pilot expanding to other regions (and when)?
- Are similar programs available in client's region?

**Resolution:**
```
If client in pilot region: Recommend normally

If client NOT in pilot region:
"[Grant Name] is currently a pilot program only available in [regions]. Your location ([client location]) is not eligible at this time.

The pilot is expected to [expand/remain limited]. [Expected expansion date if known].

ALTERNATIVE PROGRAMS available in your region:
- [Alternative 1]
- [Alternative 2]"
```

---

## Validation Shortcuts (When to Skip Steps)

### Skip Step 3 (Official Page) when:
- Program is very well-known and recently validated (e.g., SR&ED, IRAP)
- GetGranted and web search perfectly align
- Client asking for general eligibility, not ready to apply yet

### Skip Step 4 (VisualPing) when:
- Program has rolling intake (no deadline to change)
- You already validated same program earlier same day
- Low-priority program in larger portfolio

**Never skip Steps 1 and 2.**

---

## Output Template

**After completing validation, present findings:**

```markdown
## GRANT STATUS VALIDATION

**Program:** [Grant Name]
**Validation Date:** [YYYY-MM-DD]

### Validation Steps Completed:
✅ Step 1: GetGranted search (active_only=true) → Found
✅ Step 2: Web search → Status confirmed
✅ Step 3: Official program page → Verified
✅ Step 4: VisualPing alerts → No concerning changes
✅ Step 5: Categorization → [Category]

### Current Status:
**[✅ ACTIVE & OPEN / 🔄 ANNUAL / ✅ ROLLING / ❌ INACTIVE]**

- **Application Status:** [Accepting applications / Opens [date] / Closed]
- **Deadline:** [Date or "Rolling" or "TBD"]
- **Last Page Update:** [Date if known]
- **Confidence Level:** [High/Medium/Low]

### Recommendation:
[Proceed immediately / Prepare for [month] intake / Find alternatives]

### Sources Consulted:
1. GetGranted: [URL or "Internal DB"]
2. Official Page: [URL]
3. Web Search: [Query used]
4. VisualPing: [Alert findings or "No alerts"]
```

---

**Remember: 5 minutes of validation saves 50 hours of wasted application effort.**

**When in doubt, validate again. It's always worth the extra time.**
