# GetGranted Automatic Database Sync

## Overview
The GetGranted database automatically syncs every Sunday at 2:00 AM UTC via a Railway cron service.

## How It Works

### Automated Weekly Sync
- **Schedule:** Every Sunday at 2:00 AM UTC (`0 2 * * 0`)
- **Duration:** ~30-45 minutes
- **Process:**
  1. Scrapes all grant IDs 1-1000 from GetGranted
  2. Detects active/inactive status for each grant
  3. Replaces entire database with fresh data
  4. Logs sync results

### Railway Cron Service
- **Service Name:** `getgranted-sync`
- **Start Command:** `node scripts/sync-getgranted-database.js`
- **Restart Policy:** NEVER (runs once per schedule)
- **Environment Variables:**
  - `DATABASE_URL` - Postgres connection
  - `GETGRANTED_EMAIL` - GetGranted login
  - `GETGRANTED_PASSWORD` - GetGranted password

## Manual Sync (If Needed)

### Option 1: Trigger Cron Service Manually
1. Go to Railway Dashboard → `getgranted-sync` service
2. Click "Deployments"
3. Click "Deploy" button
4. Monitor logs to see progress

### Option 2: Run Import Endpoint (If data already exported)
```bash
curl -X GET "https://grant-card-assistant-production.up.railway.app/import-grants?secret=<JWT_SECRET>"
```

This imports from the latest `data/getgranted-all-grants-by-id.json` file.

## Monitoring

### Check Last Sync
View deployment logs in Railway Dashboard for the `getgranted-sync` service.

### Verify Database
```bash
# Get database statistics
curl -s "https://grant-card-assistant-production.up.railway.app/search-grants?stats=true"
```

Should return:
```json
{
  "total": 598,
  "active": 536,
  "inactive": 62,
  "topTypes": [...]
}
```

## What Gets Updated

### On Each Sync:
- ✅ New grants added to GetGranted
- ✅ Grants marked active → inactive
- ✅ Grants marked inactive → active
- ✅ Updated criteria, best practices, deadlines
- ✅ Changed funding amounts, regions, industries

### Data Freshness:
- **Maximum staleness:** 7 days (if sync runs every Sunday)
- **Typical staleness:** 0-7 days
- **Impact:** Low - most grants are open for weeks/months

## Changing Sync Frequency

### To sync more frequently:

**Daily (2 AM UTC):**
```
0 2 * * *
```

**Twice weekly (Sunday & Wednesday at 2 AM):**
```
0 2 * * 0,3
```

**Every 6 hours:**
```
0 */6 * * *
```

Update in Railway Dashboard → `getgranted-sync` service → Settings → Cron.

## Troubleshooting

### Sync Failed
1. Check `getgranted-sync` service logs in Railway
2. Common issues:
   - GetGranted login credentials changed
   - Railway timeout (script takes too long)
   - Network issues during scraping
   - Database connection failed

### Data Not Updating
1. Verify cron service is running: Railway Dashboard → `getgranted-sync` → Deployments
2. Check last deployment time
3. Check logs for errors

### Emergency Manual Sync
If automatic sync fails and you need fresh data immediately:
1. Run the scraper manually (takes 30-45 min)
2. Trigger import endpoint with the JWT secret

## Architecture

```
┌─────────────────────┐
│   Railway Cron      │
│  (getgranted-sync)  │
│                     │
│  Runs: Sundays 2AM  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Scraper Script     │
│  export-all-grants  │
│  -by-id.js          │
│                     │
│  Iterates IDs 1-1000│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  JSON Export File   │
│  getgranted-all-    │
│  grants-by-id.json  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Import to Postgres │
│  DELETE + INSERT    │
│  all grants         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Postgres Database  │
│  598 grants ready   │
│  for Oracle queries │
└─────────────────────┘
```

## Summary

✅ **Automatic:** Syncs every Sunday at 2 AM UTC
✅ **Complete:** Scrapes all 1000 possible grant IDs
✅ **Fresh:** Database never more than 7 days old
✅ **Reliable:** Failures don't break Oracle (keeps old data)
✅ **Manual Override:** Can trigger sync anytime if needed
