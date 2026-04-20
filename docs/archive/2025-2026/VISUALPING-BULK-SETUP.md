# VisualPing Bulk Webhook Setup

## Problem: You have 5000+ jobs - can't add webhooks manually!

## Solution: Use Bulk Editing + Filtering

---

## Option 1: Filter + Bulk Edit (Recommended)

You probably don't need webhooks on ALL 5000 jobs - just government grant pages. Here's how to set up only the relevant ones:

### Step 1: Filter Jobs to Grant Pages Only

In VisualPing dashboard:

1. **Use Search Bar**: Search for keywords like:
   - "canada.ca"
   - "gov.bc.ca"
   - "ised"
   - "nrc"
   - "grant"
   - "funding"

2. **OR Use Labels** (if you've tagged grant jobs):
   - Filter by label: "grants", "government", "funding", etc.

3. **OR Use Folders/Workspaces**:
   - If grant pages are in a specific workspace, switch to that workspace

### Step 2: Select Filtered Jobs

1. Click checkbox at top left
2. Choose:
   - **"Select all on this page"** (if few results)
   - **"Select all active jobs"** (if you've filtered correctly)

### Step 3: Bulk Edit Notifications

1. Click **"Job Settings"** button (appears when jobs selected)
2. Select **"Notifications"** tab
3. **Enable Webhook**
4. **Paste webhook URL**:
   ```
   https://grant-card-assistant-production.up.railway.app/api/visualping-webhook
   ```
5. **Click "Test"** to verify
6. **Apply to all selected jobs**

✅ Done! Webhook added to filtered jobs in bulk.

---

## Option 2: Use VisualPing API (For Advanced Users)

If you have API access (Business plan), you can programmatically update jobs:

### Get Your API Key

1. Go to VisualPing Settings → API
2. Generate API key

### List All Jobs

```bash
curl -X GET "https://api.visualping.io/v2/jobs" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Filter to Grant Jobs (Script)

```javascript
// Get all jobs
const jobs = await fetch('https://api.visualping.io/v2/jobs', {
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
}).then(r => r.json());

// Filter to government grant pages
const grantJobs = jobs.filter(job =>
  job.url.includes('canada.ca') ||
  job.url.includes('gov.bc.ca') ||
  job.url.includes('ised') ||
  job.url.includes('nrc') ||
  job.url.includes('ngen.ca') ||
  job.url.includes('grant') ||
  job.url.includes('funding')
);

console.log(`Found ${grantJobs.length} grant-related jobs`);
```

### Update Jobs with Webhook (Loop)

```javascript
const webhookUrl = 'https://grant-card-assistant-production.up.railway.app/api/visualping-webhook';

for (const job of grantJobs) {
  await fetch(`https://api.visualping.io/v2/jobs/${job.id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      notifications: {
        webhook: {
          enabled: true,
          url: webhookUrl
        }
      }
    })
  });

  console.log(`✅ Updated job: ${job.url}`);

  // Rate limit: wait 100ms between requests
  await new Promise(r => setTimeout(r, 100));
}
```

**Note**: Check VisualPing API docs for exact field names - this is a conceptual example.

---

## Option 3: Contact VisualPing Support

For enterprise customers with thousands of jobs, VisualPing support might be able to:

1. **Bulk enable webhooks** on your behalf (backend operation)
2. **Export job list** → You mark which need webhooks → They import
3. **Provide custom solution** for large-scale deployments

**Contact**: support@visualping.io
**Subject**: "Bulk webhook configuration for 5000+ jobs"

---

## Option 4: Strategic Approach - Start Small

You probably don't need ALL 5000 jobs sending webhooks. Consider:

### Phase 1: High-Value Pages Only (10-20 jobs)

Monitor only the most important grant program pages:
- NRC IRAP
- CanExport SME
- Strategic Innovation Fund
- BC Business Growth programs
- Major industry programs (NGen, Agriculture Canada)

**Add webhooks manually** to these ~20 jobs.

### Phase 2: Expand by Category (50-100 jobs)

After validating Phase 1 works, expand to:
- All federal grant programs
- All provincial grant programs
- Industry-specific programs

**Use bulk edit** with filtering.

### Phase 3: Full Rollout (If Needed)

Based on Phase 1-2 results, decide if you need webhooks on all 5000 jobs or just a subset.

**Benefits**:
- Lower webhook traffic (easier to manage)
- Fewer false positives
- Focus on high-value changes
- Cost-effective (fewer Claude API calls)

---

## Recommended Approach

### For You (5000+ Jobs):

**Step 1**: Identify Grant Pages
- How many of your 5000 jobs are actually government grant pages?
- Use VisualPing search: "canada.ca", "gov.bc.ca", "grant", "funding"
- Probably 20-200 jobs, not all 5000?

**Step 2**: Use Bulk Edit
- Filter to grant pages only
- Select all filtered results
- Bulk edit → Notifications → Add webhook
- Apply to all

**Step 3**: Or Contact Support
- If filtering doesn't work well
- Email VisualPing: "Need to add webhook to ~200 grant-related jobs, can you help?"
- They may have backend tools for this

---

## Quick Decision Tree

```
Do you need webhooks on ALL 5000 jobs?
├─ NO (only grant pages - probably 20-200 jobs)
│  └─ Use Filter + Bulk Edit (Option 1)
│
├─ YES (really need all 5000)
│  ├─ Have API access?
│  │  ├─ YES → Use API script (Option 2)
│  │  └─ NO → Contact Support (Option 3)
│  │
│  └─ Or reconsider: Do you REALLY need all 5000?
│      └─ Maybe start with high-value subset?

```

---

## What I Recommend

1. **First**: Search your VisualPing dashboard for "canada.ca OR gov.bc.ca OR grant OR funding"
2. **Count**: How many results? (probably 20-200, not 5000)
3. **Bulk Edit**: Select all → Job Settings → Notifications → Add webhook
4. **If still too many**: Contact VisualPing support for help

You definitely shouldn't need webhooks on all 5000 jobs unless they're ALL grant-related pages (which seems unlikely).

---

## Next Steps

1. **Check**: How many jobs are actually grant pages?
2. **Decide**: Bulk edit, API script, or contact support?
3. **Deploy**: Push code to Railway first
4. **Configure**: Add webhooks to filtered jobs
5. **Monitor**: Watch for alerts over next week

---

Let me know how many grant-related jobs you have and I can help you choose the best approach!
