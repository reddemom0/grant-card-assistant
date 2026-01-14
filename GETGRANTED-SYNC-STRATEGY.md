# GetGranted Database Sync Strategy

## Overview

The GetGranted grant database is kept up-to-date through automated scheduled syncing. This document explains how the sync process works and how to manage it.

## How It Works

### Current State
- **Database**: PostgreSQL on Railway with ~477 grants
- **Fields**: All grant card fields (name, type, amount, regions, industries, criteria, best practices, etc.)
- **Active Status**: Each grant flagged as `is_active` (true/false)

### Sync Process

#### 1. **Full Re-Sync (Weekly)**
**When**: Every Sunday at 2:00 AM UTC
**Duration**: ~30-45 minutes
**What it does**:
- Scrapes ALL grant IDs (1-1000) from GetGranted
- Detects active/inactive status for each grant
- Replaces entire database with fresh data
- Logs sync results to `data/sync-log.json`

**Script**: `scripts/sync-getgranted-database.js`

#### 2. **Why Weekly?**
- GetGranted updates are not real-time critical for Oracle
- Weekly catches:
  - New grants added
  - Grants marked inactive
  - Deadline changes
  - Criteria/best practice updates
  - Funding amount changes
- Balance between freshness and resource usage

### What Oracle Sees

Oracle searches the database and gets:
- **Active grants**: Programs currently accepting applications
- **Inactive grants**: Closed programs (still useful for context/history)
- **All details**: Full criteria, best practices, deadlines, amounts

Oracle then:
1. Filters grants by keywords/regions/industries
2. Reads the full details of candidate grants
3. Intelligently matches against client needs
4. Selects the best 3-5 programs to recommend

## Manual Sync

If you need to sync immediately (e.g., you know GetGranted added new grants):

```bash
# Run sync manually
railway run node scripts/sync-getgranted-database.js

# Or locally (if you have Playwright installed)
node scripts/sync-getgranted-database.js
```

## Monitoring Sync Health

### Check Last Sync
```bash
# View sync log
cat data/sync-log.json
```

Example log entry:
```json
{
  "synced_at": "2026-01-14T02:00:00.000Z",
  "duration_minutes": 42,
  "total_grants": 477,
  "active_grants": 189,
  "inactive_grants": 288,
  "failed": 0,
  "success": true
}
```

### Check Database Stats
```bash
# Run search function test
railway run node scripts/create-search-function.js
```

Shows:
- Total grants in database
- Active vs inactive count
- Top grant types

## Railway Cron Setup

The weekly sync is configured as a Railway cron job:

1. **Create new service** in Railway project
2. **Link to same repo** (grant-card-assistant)
3. **Set start command**: `node scripts/sync-getgranted-database.js`
4. **Add cron schedule**: `0 2 * * 0` (Sundays 2 AM UTC)
5. **Set restart policy**: NEVER (one-time run)
6. **Add environment variables**:
   - `DATABASE_URL` (from Postgres service)
   - `GETGRANTED_EMAIL`
   - `GETGRANTED_PASSWORD`

Or use the Railway CLI:
```bash
railway up -d --service getgranted-sync --cron "0 2 * * 0"
```

## Scaling Considerations

### If GetGranted Grows (500+ grants)
- Current approach (ID iteration) scales linearly
- 1000 IDs takes ~45 min
- Could optimize by:
  - Parallel scraping (multiple browsers)
  - Incremental updates (only changed grants)
  - Caching grant IDs to skip 404s faster

### If You Need More Frequent Updates
- Change cron to daily: `0 2 * * *`
- Or twice weekly: `0 2 * * 0,3` (Sun & Wed)

### If Sync Fails
- Check sync log: `data/sync-log.json`
- Common issues:
  - GetGranted login credentials changed
  - Railway timeout (extend to 60 min)
  - Network issues (retry logic built in)
- Sync failures don't delete existing data - Oracle keeps working with last successful sync

## Data Freshness

| Component | Freshness | Impact |
|-----------|-----------|---------|
| Active grants | Up to 7 days old | Low - most grants open for weeks/months |
| Inactive grants | Up to 7 days old | Very Low - historical data |
| Deadlines | Up to 7 days old | Medium - but Oracle warns to verify |
| Criteria | Up to 7 days old | Low - rarely change mid-cycle |

## Future Enhancements

Potential improvements:
1. **Incremental sync**: Only update changed grants (compare `last_updated`)
2. **New grant detection**: Daily check for IDs beyond current max
3. **Change detection**: Alert on significant changes (new deadline, amount change)
4. **Webhook**: If GetGranted adds API, use real-time updates
5. **Cache warming**: Pre-compute common searches for faster Oracle response

## Summary

**TL;DR**:
- ✅ Weekly automatic sync keeps database fresh
- ✅ Oracle always has access to all active + inactive grants
- ✅ Manual sync available if needed urgently
- ✅ Logs track sync health and history
- ✅ System designed for reliability (failures don't break Oracle)
