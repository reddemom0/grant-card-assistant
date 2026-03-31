# Program Diversity Cap + Activity Text Keyword Boost

## Problem Statement

SWPP (Student Work Placement Program) variants flood search results because:
- 15+ SWPP programs exist in 194-program database (8% of all programs)
- They score well on broad searches (Talent intent + Wage Subsidy/Student Hire genres)
- ETG (best training program for BC engineering firms) scores +11 but gets pushed out by 8 SWPPs scoring +12-14

## Proposed Solution

Two complementary changes to `src/services/grant-search-pipeline.js`:

### CHANGE 1: Activity Text Keyword Boost

Use prospect's `planned_activities` field from form to reward programs matching user intent.

**Example:** "Looking into training grants for our engineering team" → ETG gets +2-6 boost

**Implementation:**

1. Thread `planned_activities` through prospectData in **src/tools/executor.js**
2. Add activity text keyword boost scoring in **grant-search-pipeline.js** (line ~289, after smart tags, before eligibility penalties)

**Scoring rules:**
- Tokenize activity text: lowercase, split on spaces, remove stopwords ("the", "a", "for", "to", "and", "or", "in", "on", "of")
- For each program, check if activity keywords appear in `grant_name` or `grant_criteria`
- **+2 per keyword match** (max **+6**)
- Log matches: `"Activity boost: +4 for 'ETG' (matched: training, engineering)"`

**Example scenarios:**
- Activity: "training grants for engineering team" → Keywords: [training, grants, engineering, team]
- ETG program name: "Employer Training Grant" → Matches: training → **+2**
- ETG criteria: "training support for engineering firms..." → Matches: training, engineering → **+4 total**
- SWPP program: "Venture for Canada SWPP" → No matches → **+0**

---

### CHANGE 2: Program Type Diversity Cap

Prevent single program family from dominating top 10.

**Implementation:**

Add diversity enforcement in **grant-search-pipeline.js** (line ~403, after sorting, before taking top 10)

**Logic:**
```javascript
/**
 * Detect program family from grant name
 * Returns: "SWPP", "CanExport", "IRAP", etc. or null if no family detected
 */
function detectProgramFamily(grantName) {
  const name = grantName.toLowerCase();

  // SWPP variants
  if (name.includes('swpp') || name.includes('student work placement')) {
    return 'SWPP';
  }

  // CanExport variants
  if (name.includes('canexport')) {
    return 'CanExport';
  }

  // IRAP variants
  if (name.includes('irap') || name.includes('industrial research assistance')) {
    return 'IRAP';
  }

  // Mitacs variants
  if (name.includes('mitacs')) {
    return 'Mitacs';
  }

  // Alberta Jobs Now variants
  if (name.includes('alberta jobs now')) {
    return 'Alberta Jobs Now';
  }

  // No family detected - each program is unique
  return null;
}

/**
 * Apply diversity cap to top programs
 * Max 3 programs from same family in top 10
 */
function applyDiversityCap(scoredPrograms, maxPerFamily = 3, topN = 10) {
  const familyCounts = {};
  const diverseTop10 = [];
  const overflow = [];

  for (const program of scoredPrograms) {
    const family = detectProgramFamily(program.grant_name || program.name);

    // If no family, always include (until we hit topN)
    if (!family) {
      if (diverseTop10.length < topN) {
        diverseTop10.push(program);
      } else {
        overflow.push(program);
      }
      continue;
    }

    // Track family count
    familyCounts[family] = familyCounts[family] || 0;

    // Include if under cap and still have room in top 10
    if (familyCounts[family] < maxPerFamily && diverseTop10.length < topN) {
      diverseTop10.push(program);
      familyCounts[family]++;
    } else {
      overflow.push(program);
      if (familyCounts[family] >= maxPerFamily) {
        console.log(`      🚫 Diversity cap: "${program.grant_name}" pushed to #${diverseTop10.length + overflow.length} (${family} family limit reached)`);
      }
    }
  }

  return diverseTop10.concat(overflow);
}
```

**Call site (line ~403):**
```javascript
// Sort by relevance score (highest first)
scoredPrograms.sort((a, b) => b.relevance_score - a.relevance_score);

// Apply diversity cap BEFORE taking top 10
const diversifiedPrograms = applyDiversityCap(scoredPrograms, 3, 10);

// Keep top 10 overall (now diversified)
const top10Programs = diversifiedPrograms.slice(0, 10);
```

---

## Expected Impact

### Before (current behavior):
```
Top 10 results for BC engineering firm:
1. SWPP - Venture for Canada (+14)
2. SWPP - Palette Skills (+14)
3. SWPP - Career Launcher (+13)
4. SWPP - Magnet (+13)
5. SWPP - Riipen (+12)
6. SWPP - TalentLift (+12)
7. SWPP - NPower (+12)
8. SWPP - Juno College (+12)
9. Canada Summer Jobs (+11)
10. Youth Job Connection (+11)

ETG (BC Employer Training Grant): #14 (+11, pushed out)
```

### After (with both changes):
```
Top 10 results for BC engineering firm with activity: "training grants for engineering team"
1. ETG - BC Employer Training Grant (+17) [+11 base, +6 activity boost]
2. Canada-BC Job Grant (+14) [+12 base, +2 activity boost]
3. SWPP - Venture for Canada (+14) [allowed: 1/3 SWPP]
4. SWPP - Palette Skills (+14) [allowed: 2/3 SWPP]
5. SWPP - Career Launcher (+13) [allowed: 3/3 SWPP - cap reached]
6. Canada Summer Jobs (+11)
7. Youth Job Connection (+11)
8. Innovation Skills Training (+10)
9. CanExport SME (+10)
10. Digital Adoption Program (+9)

SWPP - Magnet (+13): #11 [diversity cap applied]
SWPP - Riipen (+12): #12 [diversity cap applied]
SWPP - TalentLift (+12): #13 [diversity cap applied]
```

---

## Implementation Files

### File 1: src/tools/executor.js
**Line 78-111** - Add `planned_activities` to prospectData:

```javascript
const data = {
  // Industry (prioritize Haiku extraction over form-provided)
  industry: companyBackground.industry || prospectData.industry || null,

  // Province (normalize to code: "British Columbia" → "BC")
  province: normalizeProvince(prospectData.province) || 'ON',

  // Revenue tier mapping
  revenue_tier: mapRevenueTier(prospectData.revenue_range),

  // Employee count (parse from range string)
  num_ftes: parseEmployeeCount(prospectData.employee_count),

  // Hiring plans (parse from text)
  ...parseHiringPlans(prospectData.hiring_plans),

  // Training budget (parse from range string)
  annual_training_spend: parseSpendAmount(prospectData.training_budget),

  // Market expansion (parse from range string)
  international_market_spend: parseSpendAmount(prospectData.expansion_budget),

  // R&D spend (not collected in form yet, default to 0)
  rd_spend: 0,

  // Incorporation status (assume yes if they have revenue)
  is_incorporated_1yr: prospectData.revenue_range !== 'Pre-revenue',

  // Nonprofit status (assume no unless explicitly indicated)
  is_nonprofit: false,

  // Funds raised (not collected in form, default to 0)
  funds_raised: 0,

  // NEW: Activity text for keyword boost
  planned_activities: prospectData.planned_activities || null
};
```

---

### File 2: src/services/grant-search-pipeline.js

**Add helper functions at top of file (after CATEGORY_TAG_MAP, line ~33):**

```javascript
/**
 * Tokenize activity text into keywords
 * Remove stopwords, lowercase, deduplicate
 */
function tokenizeActivityText(text) {
  if (!text || typeof text !== 'string') return [];

  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'can', 'could', 'may', 'might', 'must', 'shall',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'our',
    'this', 'that', 'these', 'those'
  ]);

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2) // Min 3 chars
    .filter(word => !stopwords.has(word));

  return [...new Set(tokens)]; // Deduplicate
}

/**
 * Detect program family from grant name
 */
function detectProgramFamily(grantName) {
  if (!grantName) return null;

  const name = grantName.toLowerCase();

  if (name.includes('swpp') || name.includes('student work placement')) {
    return 'SWPP';
  }

  if (name.includes('canexport')) {
    return 'CanExport';
  }

  if (name.includes('irap') || name.includes('industrial research assistance')) {
    return 'IRAP';
  }

  if (name.includes('mitacs')) {
    return 'Mitacs';
  }

  if (name.includes('alberta jobs now')) {
    return 'Alberta Jobs Now';
  }

  return null;
}

/**
 * Apply diversity cap to prevent program family flooding
 */
function applyDiversityCap(scoredPrograms, maxPerFamily = 3, topN = 10) {
  const familyCounts = {};
  const diverseTop10 = [];
  const overflow = [];

  for (const program of scoredPrograms) {
    const family = detectProgramFamily(program.grant_name || program.name);

    // If no family, always include (until we hit topN)
    if (!family) {
      if (diverseTop10.length < topN) {
        diverseTop10.push(program);
      } else {
        overflow.push(program);
      }
      continue;
    }

    // Track family count
    familyCounts[family] = familyCounts[family] || 0;

    // Include if under cap and still have room in top 10
    if (familyCounts[family] < maxPerFamily && diverseTop10.length < topN) {
      diverseTop10.push(program);
      familyCounts[family]++;
    } else {
      overflow.push(program);
      if (familyCounts[family] >= maxPerFamily) {
        console.log(`      🚫 Diversity cap: "${program.grant_name}" pushed to #${diverseTop10.length + overflow.length} (${family} family limit reached)`);
      }
    }
  }

  return diverseTop10.concat(overflow);
}
```

**Modify scoring section (line ~289, after smart tags scoring, before eligibility penalties):**

```javascript
      // ── SMART TAGS SCORING ────────────────────────────────────────────────────

      const tags = program.smart_tags;
      const searchOrigin = program.search_origin || 'General Industry Programs';
      const expectedTags = CATEGORY_TAG_MAP[searchOrigin] || CATEGORY_TAG_MAP['General Industry Programs'];
      let tagBoost = 0;

      if (tags) {
        // +5 for primary intent match
        if (expectedTags.intents.length > 0 && tags.primary_intents) {
          const intentMatch = tags.primary_intents.some(i => expectedTags.intents.includes(i));
          if (intentMatch) {
            tagBoost += 5;
          }
        }

        // +2 per genre match, up to +6
        if (expectedTags.genres.length > 0 && tags.genres) {
          const genreMatches = tags.genres.filter(g => expectedTags.genres.includes(g)).length;
          const genreBoost = Math.min(genreMatches * 2, 6);
          tagBoost += genreBoost;
        }

        // +2-4 for max_funding_numeric (logarithmic boost — $50K scores higher than $5K)
        if (tags.max_funding_numeric && tags.max_funding_numeric > 0) {
          const fundingBoost = Math.min(Math.floor(Math.log10(tags.max_funding_numeric)), 4);
          tagBoost += fundingBoost;
        }

        if (tagBoost > 0) {
          score += tagBoost;
          const intentMatch = tags.primary_intents && expectedTags.intents.some(i => tags.primary_intents.includes(i));
          const genreMatches = tags.genres ? tags.genres.filter(g => expectedTags.genres.includes(g)).length : 0;
          console.log(`      Smart tag boost: +${tagBoost} for "${program.grant_name}" (intents: ${intentMatch}, genres: ${genreMatches})`);
        }
      }

      // ── ACTIVITY TEXT KEYWORD BOOST ───────────────────────────────────────────

      if (prospectData && prospectData.planned_activities) {
        const activityKeywords = tokenizeActivityText(prospectData.planned_activities);

        if (activityKeywords.length > 0) {
          const programName = (program.grant_name || program.name || '').toLowerCase();
          const programCriteria = (program.grant_criteria || '').toLowerCase();
          const combinedText = `${programName} ${programCriteria}`;

          const matchedKeywords = activityKeywords.filter(keyword =>
            combinedText.includes(keyword)
          );

          if (matchedKeywords.length > 0) {
            const activityBoost = Math.min(matchedKeywords.length * 2, 6);
            score += activityBoost;
            console.log(`      💬 Activity boost: +${activityBoost} for "${program.grant_name}" (matched: ${matchedKeywords.join(', ')})`);
          }
        }
      }

      // ── ELIGIBILITY PENALTY SCORING ───────────────────────────────────────────
      // (existing eligibility penalty code remains unchanged)
```

**Modify diversity cap application (line ~354, after sorting):**

```javascript
    // Sort by relevance score (highest first)
    scoredPrograms.sort((a, b) => b.relevance_score - a.relevance_score);

    // Apply diversity cap to prevent program family flooding
    console.log('\n  🎯 Applying diversity cap (max 3 per family in top 10)...');
    const diversifiedPrograms = applyDiversityCap(scoredPrograms, 3, 10);

    // Keep top 10 overall (now diversified)
    const top10Programs = diversifiedPrograms.slice(0, 10);
```

---

## Testing Plan

### Test Case 1: BC Engineering Firm Looking for Training

**Input:**
- Province: BC
- Industry: Engineering
- Activity: "training grants for our engineering team"

**Expected:**
- ETG gets +6 activity boost (matches: training, engineering)
- ETG moves to #1 or #2 position
- Max 3 SWPPs in top 10
- Other SWPPs pushed to #11+

### Test Case 2: Ontario Manufacturer Planning Export

**Input:**
- Province: ON
- Industry: Manufacturing
- Activity: "trade show in Germany and international marketing"

**Expected:**
- CanExport gets +4-6 activity boost (matches: trade, show, international, marketing)
- CanExport moves to top 3
- SWPP programs deprioritized (no activity match)

### Test Case 3: Alberta Startup Hiring Students

**Input:**
- Province: AB
- Industry: Technology
- Activity: "hiring co-op students for software development"

**Expected:**
- SWPP programs still score well (activity match: hiring, students)
- Diversity cap still applies (max 3 in top 10)
- Other hiring programs (Canada Summer Jobs, etc.) get visibility

---

## Rollback Plan

If issues arise:

1. **Rollback diversity cap only:**
   - Comment out lines calling `applyDiversityCap()`
   - Revert to direct `scoredPrograms.slice(0, 10)`

2. **Rollback activity boost only:**
   - Comment out "ACTIVITY TEXT KEYWORD BOOST" section
   - Remove `planned_activities` from prospectData (optional)

3. **Full rollback:**
   - Git revert commit
   - Redeploy previous version

---

## Risk Assessment

**Low Risk:**
- Activity boost is additive (doesn't break existing scoring)
- Diversity cap is conservative (max 3 per family still allows significant representation)
- Both changes have clear logging for debugging

**Potential Issues:**
- If activity text is poorly written or too generic, boost may not help
- Diversity cap may occasionally push out a legitimately high-scoring program
- New program families may need detection rules added

**Mitigation:**
- Log all boosts and cap applications for monitoring
- Tune parameters (max boost, family cap) based on real-world results
- Add more family detection rules as needed
