# VisualPing Webhook Setup - Quick Guide

## Where Webhooks Are Configured

⚠️ **Important**: Webhooks are configured **per monitoring job**, NOT in account settings!

---

## Step 1: Deploy to Railway First

```bash
git add .
git commit -m "feat: Add VisualPing webhook integration"
git push origin railway-migration
```

Wait 2-3 minutes for deployment, then your webhook URL will be:
```
https://grant-card-assistant-production.up.railway.app/api/visualping-webhook
```

---

## Step 2: Create or Edit a Monitoring Job

1. **Log in to VisualPing**
2. **Create a new job** (or edit existing one)
   - Example: Monitor `https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program`
3. **Configure basic settings**:
   - Check frequency: Every 6-12 hours
   - Detection mode: AI-powered (recommended)

---

## Step 3: Add Webhook to the Job

1. **Open the job settings** (click on the job)
2. **Go to "Notifications" tab**
3. **Click on "Webhook"** option
4. **Paste your webhook URL**:
   ```
   https://grant-card-assistant-production.up.railway.app/api/visualping-webhook
   ```
5. **Click "Test"** to verify connection
   - ✅ Green checkmark = Success!
   - ❌ Red X = Check Railway logs for errors
6. **Save the job**

---

## Step 4: Repeat for Each Grant Page You Want to Monitor

Set up webhooks for these priority pages:

**Federal Programs**:
- [ ] IRAP: `https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program`
- [ ] CanExport: `https://www.tradecommissioner.gc.ca/funding-financement/canexport/sme-pme/index.aspx`
- [ ] SIF: `https://ised-isde.canada.ca/site/strategic-innovation-fund/en`
- [ ] ISED Main: `https://ised-isde.canada.ca/site/funding/en`

**BC Provincial**:
- [ ] BC Business Growth: `https://www.bcbusinessgrowth.ca/programs/`
- [ ] BC Grants Hub: `https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/grants-and-supports`

**Industry-Specific**:
- [ ] Agriculture Canada: `https://agriculture.canada.ca/en/programs`
- [ ] NGen: `https://www.ngen.ca/funding`

---

## Step 5: Test It Works

### Option A: Use VisualPing's Test Button
- In the job settings → Notifications → Webhook
- Click "Test" button
- Check Railway logs: `railway logs -f`
- Should see: "📡 VisualPing webhook received"

### Option B: Wait for Real Change Detection
- VisualPing will check the page on next cycle (6-12 hours)
- If change detected → Webhook fires automatically
- Check Railway logs for processing

### Option C: Manual Test with Curl
```bash
curl -X POST https://grant-card-assistant-production.up.railway.app/api/visualping-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-irap",
    "workspace_id": "your-workspace",
    "url": "https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program",
    "change": 15.5,
    "datetime": "2026-01-13T16:00:00Z",
    "summarizer": "IRAP eligibility expanded to companies with up to 500 employees (previously 250)",
    "added_text": "Companies with up to 500 employees now eligible",
    "removed_text": "Companies with up to 250 employees",
    "preview": "https://example.com/preview.png"
  }'
```

---

## Step 6: Query Alerts via Oracle

Once alerts are flowing in:

1. Open Oracle: `https://grant-card-assistant-production.up.railway.app/oracle`
2. Ask: **"Check for recent VisualPing alerts"**
3. Oracle will use the `get_visualping_alerts` tool
4. See analyzed alerts with priorities and recommendations

---

## What VisualPing Sends in Webhook

```json
{
  "job_id": "abc123",
  "workspace_id": "workspace-id",
  "url": "https://nrc.canada.ca/...",
  "datetime": "2026-01-13T15:30:00Z",
  "change": 12.5,
  "summarizer": "AI-generated summary of what changed",
  "added_text": "New text that appeared;separated;by;semicolons",
  "removed_text": "Old text that was removed;also;separated",
  "original": "URL to screenshot before change",
  "current": "URL to screenshot after change",
  "preview": "URL to diff comparison image",
  "labels": "tag1,tag2",
  "important": false
}
```

---

## Troubleshooting

### "Test" button shows red X
- **Check**: Railway deployment is complete and healthy
- **Check**: Webhook URL is exactly: `https://grant-card-assistant-production.up.railway.app/api/visualping-webhook`
- **Check**: No typos in URL
- **View**: Railway logs with `railway logs -f` to see error

### Webhook receives data but no analysis
- **Check**: Claude API key is set in Railway env vars
- **Check**: Railway logs for Claude API errors
- **Check**: Redis is connected (REDIS_PUBLIC_URL env var)

### Oracle can't find alerts
- **Check**: Webhook actually received data (Railway logs)
- **Check**: Alert was processed successfully (look for "✅ Alert processed")
- **Check**: Oracle has `get_visualping_alerts` tool enabled

---

## Quick Reference

**Webhook URL**:
```
https://grant-card-assistant-production.up.railway.app/api/visualping-webhook
```

**Where to Add It**:
- Job Settings → Notifications Tab → Webhook

**Check Logs**:
```bash
railway logs -f
```

**Test Manually**:
```bash
curl -X POST https://grant-card-assistant-production.up.railway.app/api/visualping-webhook \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test","url":"https://test.com","change":10,"datetime":"2026-01-13T16:00:00Z","summarizer":"Test alert"}'
```

---

## Next Steps After Setup

1. ✅ Deploy to Railway
2. ✅ Add webhook to 8 priority jobs in VisualPing
3. ⏸️ Monitor for 1 week
4. ⏸️ Optimize sensitivity (reduce false positives)
5. ⏸️ Add Slack integration for proactive notifications
6. ⏸️ Expand to 20-30 monitored pages

---

**Ready to deploy?** Just need to push to Railway and then add the webhook URL to each VisualPing job!
