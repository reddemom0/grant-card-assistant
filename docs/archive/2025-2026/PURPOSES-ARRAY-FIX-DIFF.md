# Purposes Array Fix - Changes Summary

## Problem
Genre-score search results were getting `purposes = []`, causing all 15 programs to be categorized as "Other" instead of being distributed across Hiring/Training/Market Expansion/R&D pillars.

## Solution
Created `derivePurposesFromSmartTags(grant)` helper function that derives purposes from existing grant metadata in priority order:
1. smart_tags.primary_intents (highest confidence)
2. smart_tags.genres (keyword matching)
3. grant_type field (last resort)

## Changes Made

### 1. New Helper Function (lines 141-264)

```javascript
/**
 * Derive purposes array from smart_tags for genre-score search results
 *
 * Genre-score search doesn't inherit purposes from search queries (unlike keyword search),
 * so we need to derive them from the grant's existing metadata.
 *
 * @param {Object} grant - Grant object with smart_tags, genre_scores, grant_type
 * @returns {string[]} Array of purposes: 'Hiring', 'Training', 'Market Expansion', 'Research & Development'
 */
function derivePurposesFromSmartTags(grant) {
  const purposes = new Set();

  // STEP 1: Try smart_tags.primary_intents (highest confidence)
  const intents = grant.smart_tags?.primary_intents || [];

  if (intents.length > 0) {
    for (const intent of intents) {
      switch (intent) {
        case 'Talent':
          purposes.add('Hiring');
          purposes.add('Training');
          break;
        case 'Markets':
        case 'Markets_International':
        case 'Markets_Domestic':
          purposes.add('Market Expansion');
          break;
        case 'Innovation':
        case 'Technology':
          purposes.add('Research & Development');
          break;
        case 'Growth':
          purposes.add('Hiring');
          purposes.add('Training');
          break;
        // 'Startups', 'Foundational', 'Operations', 'Capital', 'Sustainability' are too vague
      }
    }

    if (purposes.size > 0) {
      return Array.from(purposes);
    }
  }

  // STEP 2: Fall back to smart_tags.genres (keyword matching)
  const genres = grant.smart_tags?.genres || [];

  if (genres.length > 0) {
    const genresLower = genres.map(g => g.toLowerCase());

    // Hiring indicators
    if (genresLower.some(g =>
      g.includes('wage subsidy') ||
      g.includes('internship') ||
      g.includes('youth hire') ||
      g.includes('co-op') ||
      g.includes('apprentice') ||
      g.includes('employment') ||
      g.includes('hiring')
    )) {
      purposes.add('Hiring');
    }

    // Training indicators
    if (genresLower.some(g =>
      g.includes('training') ||
      g.includes('skills') ||
      g.includes('upskilling') ||
      g.includes('professional development') ||
      g.includes('certification') ||
      g.includes('leadership development')
    )) {
      purposes.add('Training');
    }

    // Market Expansion indicators
    if (genresLower.some(g =>
      g.includes('export') ||
      g.includes('international') ||
      g.includes('trade') ||
      g.includes('market entry') ||
      g.includes('market expansion') ||
      g.includes('market research')
    )) {
      purposes.add('Market Expansion');
    }

    // R&D indicators
    if (genresLower.some(g =>
      g.includes('r&d') ||
      g.includes('research') ||
      g.includes('innovation') ||
      g.includes('ip') ||
      g.includes('patent') ||
      g.includes('prototype')
    )) {
      purposes.add('Research & Development');
    }

    if (purposes.size > 0) {
      return Array.from(purposes);
    }
  }

  // STEP 3: Last resort - parse grant_type field
  if (grant.grant_type) {
    // grant_type format: "Grant Type\n      Hiring"
    const grantType = grant.grant_type
      .replace(/Grant Type\s*/i, '')
      .replace(/\n/g, '')
      .trim();

    const typeLower = grantType.toLowerCase();

    if (typeLower.includes('hiring')) purposes.add('Hiring');
    if (typeLower.includes('training')) purposes.add('Training');
    if (typeLower.includes('market') || typeLower.includes('export')) purposes.add('Market Expansion');
    if (typeLower.includes('research') || typeLower.includes('development') || typeLower.includes('innovation')) {
      purposes.add('Research & Development');
    }
  }

  return Array.from(purposes);
}
```

### 2. Applied Helper to Genre-Score Results (lines 416-420)

**BEFORE:**
```javascript
// Tag grants with search origin
genreResults.grants.forEach(grant => {
  grant.search_origin = 'Genre Score Match';
  grant.purposes = []; // Will be inferred from smart tags/genres
});
```

**AFTER:**
```javascript
// Tag grants with search origin and derive purposes from smart_tags
genreResults.grants.forEach(grant => {
  grant.search_origin = 'Genre Score Match';
  grant.purposes = derivePurposesFromSmartTags(grant);
});
```

## Expected Behavior

**Before:** All genre-score results → `purposes: []` → categorized as "Other"
```
By category: Hiring (0), Training (0), Market Expansion (0), R&D (0), Other (15)
```

**After:** Genre-score results → derived purposes → properly categorized
```
By category: Hiring (5), Training (3), Market Expansion (2), R&D (0), Other (5)
```

## Testing

With this fix, when `planned_activities` is empty and genre-score search runs:
1. Each grant gets purposes derived from its smart_tags.primary_intents
2. If no intents, falls back to genre keyword matching
3. If still empty, parses grant_type field
4. Categorization logic now has non-empty purposes to work with
5. Programs are distributed across correct pillars
6. Agent can build pillar-by-pillar funding estimate

## Files Modified
- `src/services/grant-search-pipeline.js` (lines 141-264, 416-420)
