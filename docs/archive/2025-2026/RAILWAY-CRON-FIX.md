# Railway Cron Service Configuration Fix

**Date:** March 12, 2026
**Issue:** Weekly GetGranted database sync failing with DNS error since Feb 12
**Root Cause:** Cron service using same code as main service (server.js), trying to start web server instead of running sync script

---

## Solution Implemented

### Code Changes (Commit: a585a9e)

Added `RUN_MODE` environment variable check at top of `server.js`:

```javascript
// At top of server.js, before any imports
if (process.env.RUN_MODE === 'sync') {
  console.log('🔄 RUN_MODE=sync detected - running database sync instead of server');
  import('./scripts/sync-getgranted-database.js')
    .then(() => {
      console.log('✅ Sync completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Sync failed:', error);
      process.exit(1);
    });
  throw new Error('SYNC_MODE'); // Prevent rest of module from loading
}
```

**How it works:**
- When `RUN_MODE=sync`, server.js runs the sync script instead of starting Express
- When `RUN_MODE` is undefined/not set, server starts normally
- Same codebase, different behavior based on environment variable

---

## Railway Dashboard Configuration Steps

### 1. Navigate to Cron Service

Go to Railway Dashboard → Your Project → Services

**If cron service exists:**
- Look for service named `getgranted-sync` or similar

**If cron service doesn't exist:**
- Click "+ New Service"
- Select "From GitHub repo"
- Choose your repository
- Name it `getgranted-sync`

### 2. Configure Environment Variables

**Settings** → **Variables** → **+ New Variable**

Add the following variables:

| Variable | Value | Source |
|----------|-------|--------|
| `RUN_MODE` | `sync` | Manual entry (NEW) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference from Postgres plugin |
| `GETGRANTED_EMAIL` | `writers+1@granted.ca` | Manual entry |
| `GETGRANTED_PASSWORD` | `Writers-2025` | Manual entry |

**Critical:**
- `RUN_MODE=sync` tells server.js to run sync script
- `DATABASE_URL` must be shared from Postgres plugin (not manual string)

### 3. Attach Postgres Plugin

**Settings** → **Service** → **Add Plugin** → Select your Postgres database

This automatically populates `DATABASE_URL` reference variable.

### 4. Configure Cron Schedule

**Settings** → **Cron**

| Field | Value |
|-------|-------|
| **Enable Cron** | ✅ Enabled |
| **Schedule** | `0 2 * * 0` |
| **Description** | "Weekly GetGranted database sync - Sundays 2 AM UTC" |

**Schedule Breakdown:**
- `0 2 * * 0` = Every Sunday at 2:00 AM UTC (Saturday 6 PM Pacific)
- Alternative daily: `0 10 * * *` (daily at 10 AM UTC / 2 AM Pacific)

### 5. Deploy & Test

**Deployments** → **Deploy**

Click "Deploy" to trigger manual deployment.

**Expected logs:**
```
🔄 RUN_MODE=sync detected - running database sync instead of server
🔄 Starting GetGranted database sync...
⏰ Started at: 2026-03-12T...
1️⃣ Exporting all grants from GetGranted...
   This will take 30-45 minutes for ~1000 IDs
...
✅ Export complete (18 minutes)
✅ Database updated
   Imported: 598
   Failed: 0
✅ Sync complete!
```

**If it fails with DNS error:**
- Verify Postgres plugin is attached
- Verify `DATABASE_URL` uses reference syntax (`${{Postgres.DATABASE_URL}}`)
- Check that cron service is in same Railway project as Postgres database

### 6. Verify Sync Completed

After deployment finishes (~30-45 minutes), check database:

```bash
# Query last extraction date
SELECT MAX(extracted_at), COUNT(*) FROM grants;
```

Should show extraction timestamp matching the sync run time.

---

## Troubleshooting

### Error: "getaddrinfo ENOTFOUND postgres.railway.internal"

**Cause:** `DATABASE_URL` environment variable not properly set or Postgres plugin not attached

**Fix:**
1. Delete manual `DATABASE_URL` entry if exists
2. Attach Postgres plugin to cron service
3. Add `DATABASE_URL` as reference: `${{Postgres.DATABASE_URL}}`
4. Redeploy

### Error: "SYNC_MODE" thrown

**Expected behavior** - This error is intentional. It prevents the rest of server.js from loading after the sync script is imported. Check if sync script actually ran (look for sync output in logs before the error).

### Cron not running on schedule

**Symptoms:** Sync runs manually but not automatically

**Fix:**
1. Verify cron schedule syntax in Railway dashboard
2. Check that "Enable Cron" toggle is ON
3. Verify restart policy is set to NEVER (crons should not auto-restart)
4. Check Railway project billing status (crons may be disabled on free tier)

### Sync runs but database not updating

**Cause:** Sync script may be failing silently or transaction rollback

**Fix:**
1. Check full deployment logs for error messages
2. Verify `data/sync-log.json` has recent entry with `success: true`
3. Run manual sync locally: `node scripts/sync-getgranted-database.js`
4. Check if migration 004 was applied (adds `currently_accepting` column)

---

## Migration 004 Status

**Applied:** March 12, 2026
**Adds:** `currently_accepting`, `last_verified_at`, `exclusion_reason` columns

**Impact on Sync:**
- After next sync completes, migration 004 heuristics will be re-applied to fresh data
- `currently_accepting` will be recalculated based on:
  - Garbage name prefixes (Z-COVID, DORMANT, etc.)
  - `recently_changed` closure language
  - `is_active = false`
  - `last_updated < '2022-01-01'`

**Verification:**
Run `node verify-migration-004.js` to see:
- Overall acceptance status counts
- False positives caught (active but actually closed)
- Exclusion reason breakdown
- Data freshness

---

## Summary

✅ **Code fixed** - `RUN_MODE=sync` check added to server.js
✅ **Migration 004 applied** - `currently_accepting` heuristic active
⏳ **Manual sync running** - Will complete in ~30-45 minutes
📋 **Railway config needed** - Follow steps above to configure cron service

**Next Steps:**
1. Apply Railway dashboard configuration (steps 1-5 above)
2. Wait for manual sync to complete
3. Run verification: `node verify-migration-004.js`
4. Monitor next scheduled cron run (Sunday 2 AM UTC)
