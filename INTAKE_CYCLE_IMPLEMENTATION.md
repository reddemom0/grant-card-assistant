# Intake Cycle Implementation - Phase 2

## Summary

Added two new fields to track grant intake periods:
1. **`intake_cycle`** - When the program typically accepts applications (e.g., "Summer, Fall")
2. **`intakes_currently_open`** - Which specific intakes are open right now (e.g., "Summer")

## Changes Made

### 1. Database Migration
**File:** `migrations/014_add_intake_cycle.sql`

- Added `intake_cycle` column (TEXT)
- Added `intakes_currently_open` column (TEXT)
- Created indexes for both fields
- Includes verification output

**Run migration:**
```bash
# Local (if DATABASE_URL is set)
node scripts/run-migration.js migrations/014_add_intake_cycle.sql

# Railway
DATABASE_URL="postgresql://..." node -e "
const fs = require('fs');
const { Pool } = require('pg');
const sql = fs.readFileSync('migrations/014_add_intake_cycle.sql', 'utf-8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(sql).then(() => { console.log('✅ Migration complete'); process.exit(0); });
"
```

### 2. Scraper Updates
**File:** `scripts/export-getgranted-all-grants.js`

**Changes:**
- Now visits `/admin/grants/{id}/edit` page (in addition to public page)
- Extracts checked values from `input[name="grant[funding_period][]"]:checked`
- Extracts checked values from `input[name="grant[intakes_currently_open][]"]:checked`
- Stores as comma-separated strings (e.g., "Summer, Fall")

**Example extraction:**
```javascript
// Grant 1: Career Launcher - Clean Tech Internship
intake_cycle: "Summer, Fall"
intakes_currently_open: "Summer, Fall"

// Grant 85: Northern Industries Innovation Fund
intake_cycle: "Year Round"
intakes_currently_open: ""
```

### 3. Sync Script Updates
**File:** `scripts/sync-getgranted-database.js`

- Added `intake_cycle` and `intakes_currently_open` to INSERT statement
- Now expects these fields in JSON export

### 4. Search API Updates
**File:** `src/tools/getgranted-search.js`

- Added `intake_cycle` to response object (line 185)
- Added `intakes_currently_open` to response object (line 186)

**Example API response:**
```json
{
  "grant_name": "Career Launcher - Clean Tech Internship",
  "intake_cycle": "Summer, Fall",
  "intakes_currently_open": "Summer, Fall",
  "is_active": true,
  "currently_accepting": true,
  "exclusion_reason": null
}
```

## Testing

**Test script:** `scripts/test-intake-cycle-extraction.js`

Tests extraction on 3 sample grants:
- Grant 1: Career Launcher (Summer, Fall expected)
- Grant 85: Northern Industries (Year Round expected)
- Grant 34: Industry Commercialization (unknown)

**Run test:**
```bash
node scripts/test-intake-cycle-extraction.js
```

Expected output:
```
✅ All tests passed! Ready for full export.
```

## Full Export Process

After testing passes:

1. **Run migration** (adds columns to database)
2. **Run full export** (scrapes all grants with new fields)
3. **Verify data** (check sample grants in database)
4. **Deploy search API updates** (if not already deployed)

**Full export command:**
```bash
# This takes 30-45 minutes for ~600 grants
node scripts/export-getgranted-all-grants.js

# Then sync to database
node scripts/sync-getgranted-database.js
```

## Verification Queries

```sql
-- Check how many grants have intake_cycle populated
SELECT COUNT(*) FROM grants WHERE intake_cycle IS NOT NULL AND intake_cycle != '';

-- Show sample grants with intake cycles
SELECT grant_id, grant_name, intake_cycle, intakes_currently_open
FROM grants
WHERE intake_cycle IS NOT NULL AND intake_cycle != ''
LIMIT 10;

-- Count by intake cycle value
SELECT intake_cycle, COUNT(*) as count
FROM grants
WHERE intake_cycle IS NOT NULL AND intake_cycle != ''
GROUP BY intake_cycle
ORDER BY count DESC;
```

## Use Cases

### Lead-gen agent can now:

1. **Filter seasonal programs**
   ```javascript
   search_getgranted({
     query: "hiring",
     regions: ["British Columbia"],
     include_inactive: true
   })
   // Agent sees: "Summer, Fall" and can say:
   // "This program accepts applications in Summer and Fall"
   ```

2. **Show currently open intakes**
   ```javascript
   // Agent can check intakes_currently_open field:
   // "The Summer intake is currently accepting applications"
   ```

3. **Explain why programs are inactive**
   ```javascript
   // Combined with exclusion_reason:
   // "This program is closed for the season (Winter intake only),
   //  but will reopen in December"
   ```

## Phase 1 + Phase 2 Complete

**Fields now available to agent:**
- ✅ `currently_accepting` (boolean)
- ✅ `exclusion_reason` (string)
- ✅ `keyword_score` (integer)
- ✅ `intake_cycle` (string)
- ✅ `intakes_currently_open` (string)
- ✅ `include_inactive` parameter

**Agent can now provide:**
- Accurate seasonal program information
- Clear explanations for why programs are closed
- Guidance on when to apply
- Full program counts including inactive grants
