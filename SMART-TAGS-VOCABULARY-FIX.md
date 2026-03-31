# Smart Tags Vocabulary Fix

## Problem

For a Technology/EdTech company hiring 3-5 people with a training budget, almost every program returned:
- `intents: false`
- `genres: 0`

This meant programs weren't getting smart tag boosts, resulting in poor search ranking.

## Root Cause

**CATEGORY_TAG_MAP had incomplete vocabulary** - it only included a small subset of the actual genre strings in the database.

### Example: Hiring Programs

**Old vocabulary (6 genres):**
```javascript
genres: ['Wage Subsidy', 'Student/Co-op Hire', 'Youth Hire', 'Apprenticeship', 'Internship', 'General Hiring']
```

**Actual database (20+ genres used in hiring programs):**
- Wage Subsidy: 167 programs
- Skills Training: 99 programs ← **NOT in old vocabulary**
- Youth Hire: 70 programs
- Internship: 67 programs
- Student/Co-op Hire: 40 programs
- Technical Training: 33 programs ← **NOT in old vocabulary**
- General Hiring: 31 programs
- Apprenticeship: 14 programs
- Leadership Development: 11 programs ← **NOT in old vocabulary**
- Digital Literacy: 9 programs ← **NOT in old vocabulary**

Many hiring programs have genres like "Skills Training" or "Technical Training" which weren't in the expected list, so they got `genres: 0`.

## Fix Applied

### 1. Queried Actual Database Vocabulary

**All distinct primary_intents (11 total):**
- Capital, Foundational, Growth, Innovation, Markets, Markets_Domestic, Operations, Startups, Sustainability, Talent, Technology

**All distinct genres (43 total):**
- AI/ML Integration, Advisory, Apprenticeship, Automation, Building Retrofits, Business Assessment, Clean Tech, Cloud Migration, Coaching, Commercialization, Cybersecurity, Decarbonization, Digital Literacy, E-commerce, Electric Vehicles, Energy Efficiency, Equipment Purchase, Export, Facility Renovation, Feasibility Studies, Foreign Certification, GHG Reduction, General Hiring, Health & Safety Certification, IP Protection, International Marketing, Internship, Leadership Development, Machinery Upgrades, Market Analysis, Market Research, Pilot Projects, Product Testing, Prototype Development, R&D, Scale-up, Skills Training, Software/ERP/CRM, Student/Co-op Hire, Technical Training, Trade Show, Wage Subsidy, Youth Hire

### 2. Expanded CATEGORY_TAG_MAP

**Hiring Programs:**
```javascript
intents: ['Talent', 'Growth'],  // Added 'Growth'
genres: [
  'Wage Subsidy',           // 167 programs
  'Youth Hire',             // 70 programs
  'Internship',             // 67 programs
  'Student/Co-op Hire',     // 40 programs
  'General Hiring',         // 31 programs
  'Apprenticeship',         // 14 programs
  'Skills Training',        // 99 programs (NEW)
  'Technical Training',     // 33 programs (NEW)
  'Leadership Development', // 11 programs (NEW)
  'Digital Literacy'        // 9 programs (NEW)
]
```

**Training Programs:**
```javascript
intents: ['Talent', 'Operations'],
genres: [
  'Skills Training',        // 109 programs
  'Technical Training',     // 43 programs
  'Leadership Development', // 10 programs
  'Digital Literacy',       // 11 programs
  'Health & Safety Certification', // 3 programs
  'Apprenticeship',         // 8 programs (NEW)
  'Wage Subsidy',           // 61 programs (NEW - overlap with hiring)
  'Youth Hire',             // 34 programs (NEW - overlap with hiring)
  'Internship'              // 29 programs (NEW - overlap with hiring)
]
```

**R&D Programs:**
```javascript
intents: ['Innovation', 'Technology'],  // Added 'Technology'
genres: [
  'R&D', 'Prototype Development', 'Product Testing', 'IP Protection',
  'Pilot Projects', 'Feasibility Studies',
  'AI/ML Integration',     // NEW
  'Automation',            // NEW
  'Cloud Migration'        // NEW
]
```

### 3. Made Scoring Independence Crystal Clear

**Before:** Genre boost was independent, but the code structure was unclear.

**After:** Each boost is calculated and applied separately with explicit variable names:
```javascript
let intentBoostApplied = 0;
let genreBoostApplied = 0;
let fundingBoostApplied = 0;

// +5 for intent match (INDEPENDENT)
if (intentMatch) {
  intentBoostApplied = 5;
  score += intentBoostApplied;
}

// +2 per genre match, up to +6 (INDEPENDENT - applies even without intent match)
if (genreMatches > 0) {
  genreBoostApplied = Math.min(genreMatches * 2, 6);
  score += genreBoostApplied;
}

// +2-4 for funding (INDEPENDENT)
if (tags.max_funding_numeric > 0) {
  fundingBoostApplied = Math.min(Math.floor(Math.log10(tags.max_funding_numeric)), 4);
  score += fundingBoostApplied;
}
```

### 4. Improved Logging

**Before:**
```
Smart tag boost: +3 for "Program Name" (intents: false, genres: 0)
```
(Unclear what boost was applied or why)

**After:**
```
Smart tag boost: +8 for "Program Name" (intent: +0, genre: +4 [2 matches: Skills Training, Wage Subsidy], funding: +4)
```
(Shows exactly which boosts applied and which genres matched)

## Expected Impact

For a Technology/EdTech company hiring 3-5 people with training budget:

**Before fix:**
- Most hiring programs: `intents: false, genres: 0` → no smart tag boost
- Poor ranking, wrong programs surfaced

**After fix:**
- Hiring programs with "Skills Training" or "Technical Training": `intent: +5, genre: +2 to +6` → +7 to +11 boost
- Programs with "Talent" or "Growth" intents now match
- Proper ranking based on actual relevance

## Files Changed

- `src/services/grant-search-pipeline.js`:
  - Lines 10-54: Updated CATEGORY_TAG_MAP with actual database vocabulary
  - Lines 390-433: Refactored scoring to make independence explicit and improve logging

## Testing

Run a search for a Technology company hiring 3-5 people:
```bash
# Expected: Many programs now show genre matches like:
# "genre: +4 [2 matches: Skills Training, Technical Training]"
# instead of "genres: 0"
```

## Database Queries Used

```sql
-- All distinct intents
SELECT DISTINCT jsonb_array_elements_text(smart_tags->'primary_intents') as intent
FROM grants WHERE smart_tags IS NOT NULL ORDER BY intent;

-- All distinct genres
SELECT DISTINCT jsonb_array_elements_text(smart_tags->'genres') as genre
FROM grants WHERE smart_tags IS NOT NULL ORDER BY genre;

-- Top genres in hiring programs
SELECT
  jsonb_array_elements_text(smart_tags->'genres') as genre,
  COUNT(*) as count
FROM grants
WHERE smart_tags IS NOT NULL
  AND (grant_type LIKE '%Hiring%' OR smart_tags->'primary_intents' @> '["Talent"]')
  AND grant_name NOT LIKE '%Z-%'
GROUP BY genre ORDER BY count DESC LIMIT 20;
```
