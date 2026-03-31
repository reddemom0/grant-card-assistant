# Purposes Array Bug Analysis

## The Problem

When `planned_activities` is empty, the infrastructure uses **genre-score search** instead of keyword search. Genre-score search returns programs with `purposes: []`, causing all 15 results to be categorized as "Other" instead of being distributed across hiring/training/market expansion pillars.

**Logs show:**
```
By category: Hiring (0), Training (0), Market Expansion (0), R&D (0), Other (15)
```

## Root Cause

### Database Schema (grants table)
- ✅ **EXISTS**: `grant_type` (text) - contains "Grant Type\n      Hiring"
- ✅ **EXISTS**: `smart_tags` (jsonb) - contains `{"genres": [...], "primary_intents": [...]}`
- ✅ **EXISTS**: `genre_scores` (jsonb) - contains AI relevance scores
- ❌ **DOES NOT EXIST**: `purposes` column
- ❌ **DOES NOT EXIST**: `categories` column

### SQL Queries

**searchByGenreScores** (scripts/create-search-function.js:314-339)
```sql
SELECT grant_id, grant_name, grant_type, grant_amount, url, regions, industries,
       program_provider, deadline, contribution_percentage, grant_criteria,
       currently_accepting, intake_cycle, smart_tags, genre_scores, ...
FROM grants
```
**Does NOT select `purposes` or `categories` because they don't exist in the table.**

### Code Flow

**1. Genre-Score Search** (grant-search-pipeline.js:292-295)
```javascript
genreResults.grants.forEach(grant => {
  grant.search_origin = 'Genre Score Match';
  grant.purposes = []; // ❌ SETS EMPTY ARRAY
});
```

**2. Keyword Search** (grant-search-pipeline.js:346-350)
```javascript
const taggedGrants = results.grants.map(grant => ({
  ...grant,
  purposes: searchCall.purposes.length > 0 ? searchCall.purposes : (grant.purposes || []),
  // ✅ Uses search query's purposes: ['Hiring'], ['Training'], ['Market Expansion']
  search_origin: searchCall.name
}));
```

**3. Categorization** (grant-search-pipeline.js:677-710)
```javascript
for (const program of diversifiedPrograms) {
  const purposes = program.purposes || []; // ❌ Gets empty array from genre-score results
  const categories = program.categories || []; // ❌ Also empty

  // Hiring
  if (purposes.includes('Hiring') || categories.some(c => c.toLowerCase().includes('hiring'))) {
    byCategory.hiring.push(program); // ❌ Never matches
  }
  
  // Training
  if (purposes.includes('Training') || ...) {
    byCategory.training.push(program); // ❌ Never matches
  }
  
  // If not categorized, goes to "Other"
  if (!categorized) {
    byCategory.other.push(program); // ✅ Everything ends up here
  }
}
```

## The Fix

Genre-score search results need to derive `purposes` from the grant's existing data:

### Option 1: Parse grant_type field
```javascript
// grant_type = "Grant Type\n      Hiring"
const grantType = grant.grant_type?.replace(/Grant Type\s+/i, '').trim();
if (grantType === 'Hiring') grant.purposes = ['Hiring'];
if (grantType === 'Training') grant.purposes = ['Training'];
// etc.
```

### Option 2: Map from smart_tags.genres (more accurate)
```javascript
// smart_tags.genres = ["Wage Subsidy", "Internship", "Skills Training"]
const genres = grant.smart_tags?.genres || [];

if (genres.some(g => ['Wage Subsidy', 'Youth Hire', 'Internship', ...].includes(g))) {
  purposes.push('Hiring');
}
if (genres.some(g => ['Skills Training', 'Technical Training', ...].includes(g))) {
  purposes.push('Training');
}
// etc.
```

### Option 3: Map from smart_tags.primary_intents
```javascript
// smart_tags.primary_intents = ["Talent", "Growth"]
const intents = grant.smart_tags?.primary_intents || [];

if (intents.includes('Talent')) purposes.push('Hiring', 'Training');
if (intents.includes('Markets')) purposes.push('Market Expansion');
if (intents.includes('Innovation')) purposes.push('Research & Development');
```

**Recommendation:** Use **Option 2** (smart_tags.genres) as it's the most granular and accurate. The genre taxonomy is already comprehensive and maintained.

## Files Involved

1. **scripts/create-search-function.js** - SQL queries (no changes needed)
2. **src/services/grant-search-pipeline.js:292-295** - Where genre-score results get `purposes = []`
3. **src/services/grant-search-pipeline.js:677-710** - Categorization logic using `purposes` array

## Next Steps

Add a function to derive purposes from smart_tags.genres when genre-score search is used, so categorization logic works correctly even when planned_activities is empty.
