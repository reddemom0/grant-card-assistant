# Eligibility-Aware Scoring Proposal

## Overview
Add eligibility penalty scoring to smart_tags ranking to deprioritize programs the prospect is unlikely to qualify for.

## Data Flow
1. **Prospect data** collected via webform → stored in session
2. **buildProspectDataFromSession()** extracts data (line 744 in executor.js)
3. **runFocusedSearch()** called with categorization (line 755)
4. **Scoring logic** in grant-search-pipeline.js applies boosts/penalties

## Changes Required

---

## CHANGE 1: Update Tagger Schema

**File**: `src/services/grant-tagger.js`

**Add to prompt** (line 142, after existing JSON schema):

```javascript
  "eligibility": {
    "requires_incorporation": boolean (true if program explicitly requires incorporated business, nonprofit, or charity structure),
    "requires_revenue": boolean (true if program requires the business to have existing revenue/sales),
    "requires_employer_status": boolean (true if program requires having employees - e.g., wage subsidy programs),
    "min_employees": number or null (minimum number of employees required, null if no minimum),
    "requires_matching_funds": boolean (true if program requires business to contribute matching funds)
  }
```

**Update example output** (line 204):

```json
{
  "primary_intents": ["Talent", "Growth"],
  "genres": ["Wage Subsidy", "Skills Training"],
  "max_funding_numeric": 10000,
  "specificity": "broad",
  "complexity": "moderate",
  "target_populations": ["Youth"],
  "funding_model": "wage_subsidy",
  "eligibility": {
    "requires_incorporation": true,
    "requires_revenue": false,
    "requires_employer_status": true,
    "min_employees": 1,
    "requires_matching_funds": false
  }
}
```

**Update required fields** (line 277):

```javascript
const requiredFields = [
  'primary_intents',
  'genres',
  'max_funding_numeric',
  'specificity',
  'complexity',
  'target_populations',
  'funding_model',
  'eligibility',  // NEW
];
```

---

## CHANGE 2: Update Pipeline Signature

**File**: `src/services/grant-search-pipeline.js`

**Update function signature** (line 42):

```javascript
// OLD:
export async function runFocusedSearch(categorization, searchFunction, conversationId) {

// NEW:
export async function runFocusedSearch(categorization, searchFunction, conversationId, prospectData = null) {
```

---

## CHANGE 3: Add Eligibility Penalty Scoring

**File**: `src/services/grant-search-pipeline.js`

**Insert after line 287** (after smart tags scoring, before `return { ...program, relevance_score: score }`):

```javascript
      // ── ELIGIBILITY PENALTY SCORING ───────────────────────────────────────────

      const eligibility = tags?.eligibility;
      let eligibilityPenalty = 0;

      if (eligibility && prospectData) {
        // Extract prospect profile from categorization or prospectData
        const revenue_tier = prospectData.revenue_tier || 'unknown';
        const num_ftes = prospectData.num_ftes || 0;
        const is_incorporated = prospectData.is_incorporated_1yr === true || prospectData.is_incorporated_1yr === 'true';
        const annual_training_spend = prospectData.annual_training_spend || 0;
        const international_market_spend = prospectData.international_market_spend || 0;

        // Penalty 1: Pre-revenue company + program requires revenue
        if (revenue_tier === 'pre_revenue' && eligibility.requires_revenue === true) {
          eligibilityPenalty += 10;
          console.log(`      ❌ Eligibility penalty: -10 for "${program.grant_name}" (pre-revenue + requires_revenue)`);
        }

        // Penalty 2: Not incorporated + program requires incorporation
        if (!is_incorporated && eligibility.requires_incorporation === true) {
          eligibilityPenalty += 10;
          console.log(`      ❌ Eligibility penalty: -10 for "${program.grant_name}" (not incorporated + requires_incorporation)`);
        }

        // Penalty 3: Zero employees + program requires employer status
        if (num_ftes === 0 && eligibility.requires_employer_status === true) {
          eligibilityPenalty += 8;
          console.log(`      ❌ Eligibility penalty: -8 for "${program.grant_name}" (0 employees + requires_employer_status)`);
        }

        // Penalty 4: Below minimum employees
        if (eligibility.min_employees && num_ftes < eligibility.min_employees) {
          eligibilityPenalty += 5;
          console.log(`      ❌ Eligibility penalty: -5 for "${program.grant_name}" (${num_ftes} < min ${eligibility.min_employees} employees)`);
        }

        // Penalty 5: Training program + zero training budget
        const isTrainingProgram = tags.genres && tags.genres.some(g =>
          ['Skills Training', 'Technical Training', 'Leadership Development', 'Health & Safety Certification', 'Digital Literacy'].includes(g)
        );
        if (isTrainingProgram && annual_training_spend === 0) {
          eligibilityPenalty += 3;
          console.log(`      ❌ Eligibility penalty: -3 for "${program.grant_name}" (training program + $0 training budget)`);
        }

        // Penalty 6: Export/market expansion program + zero international spend
        const isExportProgram = tags.genres && tags.genres.some(g =>
          ['Export', 'Trade Show', 'Market Research', 'International Marketing', 'Foreign Certification'].includes(g)
        );
        if (isExportProgram && international_market_spend === 0) {
          eligibilityPenalty += 3;
          console.log(`      ❌ Eligibility penalty: -3 for "${program.grant_name}" (export program + $0 international spend)`);
        }

        // Apply penalty to score
        if (eligibilityPenalty > 0) {
          score -= eligibilityPenalty;
        }
      }

      return { ...program, relevance_score: score };
```

---

## CHANGE 4: Thread prospectData Through

**File**: `src/tools/executor.js`

**Update line 755** to pass prospectData:

```javascript
// OLD:
const searchResults = await runFocusedSearch(
  categorization,
  async (searchParams) => {
    return await searchGetGranted({
      query: searchParams.query,
      purposes: searchParams.purposes,
      regions: [searchParams.province],
      industries: [],
      active_only: input.active_only,
      open_intakes_only: input.open_intakes_only,
      limit: searchParams.limit || 15,
      fetch_full_details: input.fetch_full_details,
      bypass_cache: input.bypass_cache
    });
  },
  conversationId
);

// NEW:
const searchResults = await runFocusedSearch(
  categorization,
  async (searchParams) => {
    return await searchGetGranted({
      query: searchParams.query,
      purposes: searchParams.purposes,
      regions: [searchParams.province],
      industries: [],
      active_only: input.active_only,
      open_intakes_only: input.open_intakes_only,
      limit: searchParams.limit || 15,
      fetch_full_details: input.fetch_full_details,
      bypass_cache: input.bypass_cache
    });
  },
  conversationId,
  prospectData  // NEW: Pass prospect data for eligibility scoring
);
```

---

## CHANGE 5: Re-tag All Grants

After making the above changes, run the batch tagger to regenerate all smart_tags with eligibility fields:

```bash
node src/services/grant-tagger-batch.js
```

**Expected**:
- Duration: ~50 minutes
- Cost: ~$4 (598 grants × Claude Haiku)
- Output: All grants will have `smart_tags.eligibility` object

---

## Testing Plan

1. **Test Case 1: Pre-revenue company searching hiring programs**
   - Input: revenue_tier = "pre_revenue", looking for hiring grants
   - Expected: Wage subsidy programs that require revenue get -10 penalty

2. **Test Case 2: Solo entrepreneur (0 employees) searching training**
   - Input: num_ftes = 0, looking for training programs
   - Expected: Employer-status programs get -8 penalty

3. **Test Case 3: Incorporated company with 5 employees**
   - Input: is_incorporated_1yr = true, num_ftes = 5
   - Expected: No incorporation penalties, no employee penalties

4. **Test Case 4: Export-focused search with $0 international budget**
   - Input: international_market_spend = 0, searching market expansion
   - Expected: Export programs get -3 penalty

---

## Expected Logs

After deployment, Railway logs should show:

```
🔍 RUNNING FOCUSED SEARCH
  → Hiring Programs: "hiring construction"
      ✅ Found 12 grants
      Smart tag boost: +7 for "Building Green Program" (intents: true, genres: 2)
      ❌ Eligibility penalty: -10 for "WILWorks SWPP" (pre-revenue + requires_revenue)
      Smart tag boost: +5 for "Venture for Canada Internship" (intents: true, genres: 1)
      ❌ Eligibility penalty: -8 for "Mitacs Accelerate" (0 employees + requires_employer_status)
```

---

## Rollback Plan

If issues arise:
1. Revert changes to `grant-search-pipeline.js` (remove eligibility scoring section)
2. Revert changes to `executor.js` (remove prospectData parameter)
3. No need to revert tagger changes - extra `eligibility` field in smart_tags won't break anything

---

## Questions?

- Should we add more penalty conditions (e.g., incorporated_for_min_years)?
- Should penalties be configurable per agent?
- Should we log penalty totals in analytics?
