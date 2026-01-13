# VisualPing Integration Setup Guide

**Status**: Ready for deployment and configuration
**Last Updated**: January 13, 2026

---

## What We Built

The VisualPing integration allows Oracle to automatically monitor government grant websites and receive real-time alerts when content changes. When VisualPing detects a change, it sends a webhook to our server, Claude analyzes the change, and Oracle can proactively alert the team about new opportunities.

**Components Created**:
1. ✅ Webhook endpoint (`/api/visualping-webhook`) - Receives alerts from VisualPing
2. ✅ Alert processing system - Claude analyzes changes and classifies them
3. ✅ Redis storage - Stores alerts and analysis for querying
4. ✅ Oracle tool (`get_visualping_alerts`) - Oracle can query alerts
5. ✅ Admin API endpoints - View alerts and statistics

---

## Step 1: Deploy to Railway

Before configuring VisualPing, deploy the new code to Railway:

```bash
# 1. Commit changes
git add .
git commit -m "feat: Add VisualPing webhook integration for grant page monitoring"

# 2. Push to railway-migration branch
git push origin railway-migration

# 3. Railway will auto-deploy (if connected to GitHub)
# OR manually deploy via Railway CLI:
railway up
```

**Verify deployment**:
- Check Railway logs for successful startup
- Test health endpoint: `https://grant-card-assistant-production.up.railway.app/health`
- Verify webhook endpoint exists (should return 400 for GET): `https://grant-card-assistant-production.up.railway.app/api/visualping-webhook`

---

## Step 2: Sign Up for VisualPing

1. Go to https://visualping.io/
2. Sign up for an account (use team email)
3. Choose a plan based on monitoring needs:

**Recommended Plan**: **Business** ($99/month)
- 450 checks/month
- Webhook support
- AI-powered change detection
- API access
- Priority support

**Monitoring Strategy**:
- 20-30 key grant pages
- Check every 6-12 hours (2-4 times/day)
- ~2,000-3,000 checks/month total
- Fits comfortably in Business plan

---

## Step 3: Configure Webhook URL in VisualPing

1. Log in to VisualPing
2. Go to **Account Settings** → **Integrations** → **Webhooks**
3. Add webhook URL: `https://grant-card-assistant-production.up.railway.app/api/visualping-webhook`
4. **Method**: POST
5. **Content-Type**: application/json
6. Save webhook configuration

**Test the webhook** (optional):
- VisualPing has a "Test Webhook" button
- Should receive 200 OK response
- Check Railway logs for webhook receipt confirmation

---

## Step 4: Create Monitoring Jobs

Now set up monitoring for key grant program pages. For each page:

### 4.1 Federal Programs

#### Job 1: NRC IRAP Main Page
- **URL**: `https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program`
- **Check Frequency**: Every 12 hours
- **Keywords**: "eligibility", "funding", "application", "deadline"
- **Webhook**: Enabled
- **AI Summary**: Enabled

#### Job 2: CanExport SME
- **URL**: `https://www.tradecommissioner.gc.ca/funding-financement/canexport/sme-pme/index.aspx`
- **Check Frequency**: Every 12 hours
- **Keywords**: "funding", "eligibility", "deadline", "application"
- **Webhook**: Enabled
- **AI Summary**: Enabled

#### Job 3: Strategic Innovation Fund
- **URL**: `https://ised-isde.canada.ca/site/strategic-innovation-fund/en`
- **Check Frequency**: Every 12 hours (low activity, but high value)
- **Keywords**: "stream", "deadline", "application", "eligibility"
- **Webhook**: Enabled
- **AI Summary**: Enabled

#### Job 4: Innovation, Science and Economic Development (Main Grants Page)
- **URL**: `https://ised-isde.canada.ca/site/funding/en`
- **Check Frequency**: Every 6 hours
- **Keywords**: "new program", "funding", "deadline"
- **Webhook**: Enabled
- **AI Summary**: Enabled

### 4.2 BC Provincial Programs

#### Job 5: BC Business Growth Funding Programs
- **URL**: `https://www.bcbusinessgrowth.ca/programs/`
- **Check Frequency**: Every 6 hours
- **Keywords**: "deadline", "application", "funding"
- **Webhook**: Enabled
- **AI Summary**: Enabled

#### Job 6: BC Government Grants and Supports Main Page
- **URL**: `https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/grants-and-supports`
- **Check Frequency**: Every 6 hours
- **Keywords**: "new program", "grant", "funding", "support"
- **Webhook**: Enabled
- **AI Summary**: Enabled

### 4.3 Industry-Specific Programs

#### Job 7: Agriculture and Agri-Food Canada Programs
- **URL**: `https://agriculture.canada.ca/en/programs`
- **Check Frequency**: Every 12 hours
- **Keywords**: "deadline", "application", "funding", "program"
- **Webhook**: Enabled
- **AI Summary**: Enabled

#### Job 8: NGen (Next Generation Manufacturing)
- **URL**: `https://www.ngen.ca/funding`
- **Check Frequency**: Every 12 hours
- **Keywords**: "application", "deadline", "eligibility"
- **Webhook**: Enabled
- **AI Summary**: Enabled

### 4.4 Additional Priority Pages (Add as needed)

- **Mitacs** (internship grants)
- **BCIP** (BC Innovation Program)
- **SDTC** (Sustainable Development Technology Canada)
- **FedDev Ontario** (regional programs)
- **ACOA** (Atlantic Canada Opportunities Agency)

---

## Step 5: Configure VisualPing Job Settings

For each job created above, configure these settings:

### Detection Settings
- **Detection Mode**: AI-powered (recommended) or Visual
- **Sensitivity**: Medium (adjust based on false positives)
- **Ignore Elements**: Navigation menus, footers, cookie banners, ads
- **Focus Area**: If possible, select only main content area (exclude header/footer)

### Notification Settings
- **Email Notifications**: Disable (we're using webhooks)
- **Webhook**: ✅ Enable
- **AI Summary**: ✅ Enable (sends summary in webhook)

### Advanced Options
- **Custom Selector**: Use if you want to monitor specific page sections
  - Example: `div.main-content` or `article.grant-details`
- **Keyword Alerts**: Enter keywords that should trigger immediate alert
  - Example: "deadline extension", "new program", "now open"

---

## Step 6: Test the Integration

### Test 1: Manual Webhook Test

Send a test webhook using curl or Postman:

```bash
curl -X POST https://grant-card-assistant-production.up.railway.app/api/visualping-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-job-123",
    "url": "https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program",
    "change": 15.5,
    "datetime": "2026-01-13T15:30:00Z",
    "ai_summary": "Employee eligibility limit increased from 250 to 500 employees",
    "added_text": "Companies with up to 500 employees are now eligible (previously 250)",
    "removed_text": "Companies with up to 250 employees",
    "preview": "https://example.com/preview.png"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "alertId": "vp:alert:1736783400000",
  "message": "Alert received and queued for processing"
}
```

**Check Railway Logs**:
- Should see: "📡 VisualPing webhook received"
- Should see: "🔍 Processing alert: vp:alert:..."
- Should see: "✅ Alert processed successfully"

### Test 2: Query Alerts via API

```bash
curl -X GET https://grant-card-assistant-production.up.railway.app/api/visualping/alerts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "count": 1,
  "alerts": [{
    "alert_id": "vp:alert:1736783400000",
    "url": "https://nrc.canada.ca/...",
    "change_percentage": 15.5,
    "change_type": "eligibility_update",
    "priority": "critical",
    "program_name": "NRC IRAP",
    "impact_summary": "IRAP eligibility expanded to companies with up to 500 employees...",
    "action_items": ["Contact clients with 251-500 employees", "Update eligibility docs"]
  }]
}
```

### Test 3: Oracle Can Query Alerts

In Oracle chat interface, ask:
```
"Check for recent VisualPing alerts about grant programs"
```

Oracle should use the `get_visualping_alerts` tool and return any recent alerts.

### Test 4: Real VisualPing Alert

1. Make a minor edit to one of the monitored pages (if you have access)
2. Wait for VisualPing to detect change (next check cycle)
3. Webhook should trigger
4. Check Railway logs for processing
5. Query alerts via Oracle

---

## Step 7: Monitor and Optimize

### Daily Monitoring

**Check Railway Logs**:
```bash
railway logs -f
```

Look for:
- Webhook receipts: "📡 VisualPing webhook received"
- Processing success: "✅ Alert processed successfully"
- Errors: "❌" indicators

**Check Alert Statistics**:
```bash
curl -X GET https://grant-card-assistant-production.up.railway.app/api/visualping/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Returns:
```json
{
  "success": true,
  "stats": {
    "total_alerts": 42,
    "pending_processing": 0,
    "by_priority": {
      "critical": 3,
      "high": 8,
      "medium": 20,
      "low": 11
    }
  }
}
```

### Optimization Tips

**Too Many False Positives**:
- Reduce sensitivity in VisualPing job settings
- Add more elements to ignore list (nav, footer, sidebar)
- Use custom selectors to monitor only relevant sections

**Missing Important Changes**:
- Increase sensitivity
- Check more frequently (reduce interval from 12h to 6h)
- Add more keyword alerts

**Processing Failures**:
- Check Railway logs for errors
- Verify Claude API key is valid
- Ensure Redis is connected
- Check rate limits

---

## Step 8: Set Up Notifications (Optional)

Currently, alerts are stored in Redis and queryable by Oracle. For proactive notifications:

### Option A: Slack Integration (Recommended)

**Steps**:
1. Create Slack app and incoming webhook
2. Add webhook URL to env vars: `SLACK_WEBHOOK_URL`
3. Modify `/src/api/visualping-webhook.js` to send Slack notifications on high/critical alerts
4. Redeploy

### Option B: Email Alerts

**Steps**:
1. Configure SendGrid or similar email service
2. Add email credentials to env vars
3. Modify webhook handler to send emails for critical alerts
4. Redeploy

### Option C: Oracle Proactive Messages (Future)

Oracle could proactively start conversations or send notifications within the chat interface when critical alerts arrive.

---

## Troubleshooting

### Problem: Webhook not receiving data

**Solutions**:
1. Verify webhook URL is correct in VisualPing settings
2. Check Railway deployment is live and healthy
3. Test webhook endpoint manually with curl
4. Check VisualPing webhook logs (in their dashboard)
5. Ensure no firewall blocking VisualPing IPs

### Problem: Alerts processing but no analysis

**Solutions**:
1. Check Claude API key is set: `echo $ANTHROPIC_API_KEY`
2. Verify API key has sufficient credits
3. Check Railway logs for Claude API errors
4. Test Claude API directly with simple request

### Problem: Redis errors

**Solutions**:
1. Verify Redis connection: `echo $REDIS_PUBLIC_URL`
2. Test Redis connection from Railway terminal: `redis-cli -u $REDIS_PUBLIC_URL ping`
3. Check Redis is running in Railway dashboard
4. Verify Railway Redis plan has sufficient storage

### Problem: Oracle can't query alerts

**Solutions**:
1. Verify tool is registered in `/src/tools/index.js`
2. Check Oracle's agent config includes `get_visualping_alerts` tool
3. Test API endpoint directly: `/api/visualping/alerts`
4. Redeploy if recent code changes

---

## Cost Estimates

### VisualPing Subscription
- **Business Plan**: $99/month
- **Usage**: 20-30 pages × 2-4 checks/day = ~2,000 checks/month
- **Headroom**: 450 checks/month allows growth

### Claude API Usage
- **Per Alert**: ~$0.005 (one Sonnet call for analysis)
- **Expected Volume**: 10-20 alerts/week = 40-80/month
- **Monthly Cost**: $0.20-0.40 (negligible)

### Total Monthly Cost: ~$100/month

**ROI Calculation**:
- Finding one new $50K grant opportunity = 500x ROI
- Catching one deadline extension for active client = Invaluable
- Proactive competitive advantage = Significant strategic value

---

## Maintenance Schedule

### Daily
- Review critical alerts in Railway logs
- Check Oracle for high-priority changes

### Weekly
- Review all alerts and their accuracy
- Adjust VisualPing sensitivity if needed
- Optimize monitored page list (add/remove based on value)

### Monthly
- Analyze alert statistics
- Review false positive rate
- Update keyword lists
- Assess ROI and usage patterns
- Consider adding new programs to monitor

---

## Next Steps

### Immediate (After Setup)
1. ✅ Deploy code to Railway
2. ⏸️ Sign up for VisualPing Business plan
3. ⏸️ Configure webhook URL
4. ⏸️ Create 20-30 monitoring jobs for key grant pages
5. ⏸️ Test with sample payload
6. ⏸️ Monitor for 1 week and optimize

### Short-Term (2-4 Weeks)
- Add Slack integration for proactive notifications
- Expand to 40-50 monitored pages
- Fine-tune sensitivity based on false positives
- Train team on querying alerts via Oracle

### Long-Term (2-3 Months)
- Implement automatic HubSpot client matching
- Build alert dashboard for admin view
- Add historical trend analysis
- Explore competitive monitoring (non-government pages)

---

## Support and Documentation

**VisualPing Help**:
- Documentation: https://help.visualping.io/
- Support: support@visualping.io
- API Docs: https://visualping.io/docs/api

**Internal Documentation**:
- Integration design: `ORACLE-VISUALPING-INTEGRATION.md`
- Webhook handler code: `src/api/visualping-webhook.js`
- Oracle tool code: `src/tools/visualping-alerts.js`

**Key Contacts**:
- VisualPing support for webhook issues
- Claude/Anthropic support for API questions
- Railway support for deployment/Redis issues

---

**Setup Status**: ⏸️ Ready for deployment and VisualPing configuration
**Last Updated**: January 13, 2026
**Version**: 1.0
