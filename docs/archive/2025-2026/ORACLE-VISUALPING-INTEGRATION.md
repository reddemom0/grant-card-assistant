# Oracle + VisualPing Integration Design

## Overview

This document outlines how Oracle will integrate with VisualPing to automatically monitor government grant websites, detect changes, and proactively alert the Granted Consulting team about new opportunities or program updates.

---

## Architecture

### 1. Webhook Endpoint (Railway)

**New API Route**: `/api/visualping-webhook`

**Implementation** (in `server.js`):

```javascript
app.post('/api/visualping-webhook', async (req, res) => {
  try {
    // Validate webhook signature (if VisualPing provides one)
    const payload = req.body;

    // Store alert in Redis
    const alertId = `vp:alert:${Date.now()}`;
    await redis.hset(alertId, {
      job_id: payload.job_id,
      url: payload.url,
      change_percentage: payload.change,
      datetime: payload.datetime,
      ai_summary: payload.ai_summary,
      added_text: payload.added_text,
      removed_text: payload.removed_text,
      preview_url: payload.preview,
      status: 'pending', // pending → processed → notified
      created_at: new Date().toISOString()
    });

    // Add to processing queue
    await redis.lpush('vp:queue', alertId);

    // Acknowledge receipt
    res.json({ success: true, alertId });

    // Trigger Oracle processing (async)
    processVisualPingAlert(alertId).catch(console.error);

  } catch (error) {
    console.error('VisualPing webhook error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});
```

**Security**:
- Optional: Add webhook secret validation
- Rate limiting to prevent spam
- IP whitelist for VisualPing servers

---

### 2. Oracle Processing Workflow

**Function**: `processVisualPingAlert(alertId)`

**Steps**:

1. **Load Alert Data**
   - Retrieve full payload from Redis
   - Extract URL, AI summary, added/removed text

2. **Contextualize Change**
   - Determine grant program affected
   - Classify change type:
     - `new_program` - New funding opportunity announced
     - `deadline_change` - Application deadline modified
     - `eligibility_update` - Eligibility criteria changed
     - `guidelines_update` - Program guidelines revised
     - `minor_update` - Small content changes

3. **Extract Key Information**
   - Use Claude to analyze `added_text` and `ai_summary`
   - Extract:
     - Grant program name
     - Funding amount (if mentioned)
     - Deadline (if mentioned)
     - Key eligibility criteria
     - Industry/sector focus

4. **Cross-Reference with HubSpot**
   - Search for relevant clients based on:
     - Industry match
     - Past grant history
     - Active deals in pipeline
     - Company size/revenue
   - Identify clients who may be eligible

5. **Generate Alert**
   - Create structured notification
   - Include:
     - Change summary
     - Affected grant program
     - Matched clients (if any)
     - Recommended actions
     - Link to changed page

6. **Store Results**
   - Update Redis alert status to 'processed'
   - Store analysis and recommendations
   - Add to Oracle's searchable knowledge

---

### 3. Example Workflows

#### Scenario A: New Grant Program Announced

**VisualPing Detects**:
- URL: `https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/grants-and-supports`
- Change: 22% of page content changed
- AI Summary: "New export development grant program announced for technology companies"
- Added Text: "Export Tech Innovation Grant - Up to $75,000 for BC tech companies expanding internationally. Applications open March 1, 2026"

**Oracle Processes**:
1. Classifies as `new_program`
2. Extracts:
   - Program: "Export Tech Innovation Grant"
   - Amount: "$75,000"
   - Deadline: "March 1, 2026"
   - Sector: "Technology"
   - Focus: "International expansion"

3. Searches HubSpot:
   - Finds 8 tech companies with international expansion plans
   - 3 currently have active deals for CanExport SME
   - 2 previously applied to other export grants

4. Generates Alert:
   ```
   🚨 NEW GRANT OPPORTUNITY DETECTED

   Program: Export Tech Innovation Grant
   Funding: Up to $75,000
   Deadline: March 1, 2026
   Source: BC Government

   SUMMARY:
   New grant program for BC tech companies expanding internationally.

   MATCHED CLIENTS (8):
   • TechCorp Inc. - Active CanExport deal, previously expressed interest in export funding
   • InnovateSoft - Exploring US market expansion (noted in last discovery call)
   • DataFlow Systems - Applied to NGen grant last year (tech sector)
   [... 5 more ...]

   RECOMMENDED ACTIONS:
   1. Send program alert to matched clients
   2. Add to Writers knowledge base for future applications
   3. Update research team grant database
   4. Schedule webinar on new program (Marketing)

   View full details: [link to changed page]
   View change diff: [VisualPing preview link]
   ```

---

#### Scenario B: Deadline Extension

**VisualPing Detects**:
- URL: `https://innovation.ised-isde.canada.ca/funding-programs`
- Change: 5% content change
- AI Summary: "Application deadline extended for Regional Innovation Program"
- Removed Text: "Applications close February 15, 2026"
- Added Text: "Applications close March 31, 2026"

**Oracle Processes**:
1. Classifies as `deadline_change`
2. Extracts:
   - Program: "Regional Innovation Program"
   - Old Deadline: "February 15, 2026"
   - New Deadline: "March 31, 2026"
   - Extension: +44 days

3. Searches HubSpot:
   - Finds clients with active applications to this program
   - Identifies deals in "Application Draft" stage
   - Checks email history for mentions of this program

4. Generates Alert:
   ```
   ⏰ DEADLINE EXTENDED

   Program: Regional Innovation Program
   Old Deadline: February 15, 2026
   New Deadline: March 31, 2026
   Extension: +44 days

   ACTIVE CLIENTS AFFECTED (3):
   • Manufacturing Co. - Application in draft (80% complete)
   • GreenTech Solutions - Waitlisted for discovery call
   • Advanced Materials Inc. - Research phase

   RECOMMENDED ACTIONS:
   1. Notify clients immediately (more time available)
   2. Reschedule rushed timelines
   3. Consider taking on additional clients for this program
   ```

---

#### Scenario C: Eligibility Criteria Update

**VisualPing Detects**:
- URL: `https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program`
- Change: 12% content change
- AI Summary: "Eligibility requirements updated for IRAP funding"
- Added Text: "Companies with up to 500 employees now eligible (previously 250)"

**Oracle Processes**:
1. Classifies as `eligibility_update`
2. Extracts:
   - Program: "NRC IRAP"
   - Change: Employee limit increased 250 → 500
   - Impact: More companies now eligible

3. Searches HubSpot:
   - Finds companies with 251-500 employees
   - Previously ineligible due to size
   - In industries IRAP typically funds (tech, manufacturing, innovation)

4. Generates Alert:
   ```
   📢 ELIGIBILITY EXPANDED

   Program: NRC IRAP
   Change: Employee limit increased from 250 to 500

   NEWLY ELIGIBLE CLIENTS (12):
   • MidSize Tech Corp (320 employees) - Expressed interest 6 months ago
   • Industrial Innovations (450 employees) - Never contacted about grants
   • [... 10 more ...]

   OPPORTUNITY:
   These companies are now eligible for a program they couldn't access before.
   High conversion potential.

   RECOMMENDED ACTIONS:
   1. Outbound campaign to newly eligible companies
   2. Update IRAP eligibility documentation
   3. Add to discovery script for mid-size companies
   ```

---

## 4. Configuration

### Pages to Monitor

**Federal Programs**:
- `https://innovation.ised-isde.canada.ca/funding-programs`
- `https://nrc.canada.ca/en/support-technology-innovation/nrc-irap-program`
- `https://www.tradecommissioner.gc.ca/funding-financement/canexport`
- `https://www.ic.gc.ca/eic/site/125.nsf/eng/home` (Strategic Innovation Fund)

**BC Provincial**:
- `https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/grants-and-supports`
- `https://www.bcbusinessgrowth.ca/programs/` (BCAFE, other programs)

**Industry-Specific**:
- `https://www.agr.gc.ca/eng/programs-and-services/` (Agriculture)
- `https://natural-resources.canada.ca/science-and-data/funding-partnerships` (Natural Resources)
- `https://www.ic.gc.ca/eic/site/099.nsf/eng/home` (Automotive Innovation Fund)

**Monitor Settings**:
- Check frequency: Every 6-12 hours (balance freshness vs. costs)
- Keyword alerts: "grant", "funding", "application", "deadline", "eligibility"
- Regions to monitor: Specific sections (e.g., "Application Process", "Eligibility", "Deadlines")

---

### Alert Routing

**Priority Levels**:

1. **Critical** (immediate notification):
   - New grant programs (especially in key sectors)
   - Deadline extensions for active client applications
   - Eligibility expansions

2. **High** (notify within 24 hours):
   - Guidelines updates affecting active applications
   - Funding amount changes
   - Application process changes

3. **Medium** (weekly digest):
   - Minor content updates
   - FAQ additions
   - Non-critical wording changes

**Notification Channels**:

1. **Slack Integration** (recommended):
   - Create `#oracle-alerts` channel
   - Post formatted messages with matched clients
   - Use threads for discussion

2. **Email Digest**:
   - Daily summary for high-priority alerts
   - Weekly digest for medium-priority
   - Sent to strategy team

3. **Oracle Chat Interface**:
   - Alerts appear as proactive messages
   - Users can click to expand and see full analysis
   - "View matched clients" button loads HubSpot data

4. **HubSpot Task Creation**:
   - For matched clients, automatically create tasks
   - Assigned to account owner
   - Task description includes alert details

---

## 5. Redis Data Structure

### Alert Storage

```
vp:alert:{timestamp} (Hash)
├── job_id: VisualPing job identifier
├── url: Monitored page URL
├── change_percentage: % of page changed
├── datetime: When change detected
├── ai_summary: VisualPing's AI summary
├── added_text: Text added to page
├── removed_text: Text removed from page
├── preview_url: Screenshot comparison URL
├── status: pending | processed | notified
├── created_at: When alert received
├── processed_at: When Oracle analyzed
└── notified_at: When team alerted
```

### Oracle Analysis

```
vp:analysis:{alertId} (Hash)
├── change_type: new_program | deadline_change | eligibility_update | etc.
├── grant_program: Extracted program name
├── funding_amount: If mentioned
├── deadline: If mentioned
├── sector: Industry/sector affected
├── eligibility_notes: Key eligibility changes
├── priority: critical | high | medium | low
├── matched_clients_count: Number of relevant clients
└── recommendations: JSON array of actions
```

### Matched Clients Index

```
vp:matches:{alertId} (Set)
└── {hubspotCompanyId1, hubspotCompanyId2, ...}
```

### Processing Queue

```
vp:queue (List)
└── [alertId1, alertId2, alertId3, ...]
```

---

## 6. Oracle System Prompt Updates

Add to `.claude/agents/internal-oracle.md`:

```markdown
### VisualPing Integration

You have access to real-time website change monitoring through VisualPing integration.

**When VisualPing Alert Received**:
1. Analyze the change context (new program, deadline, eligibility, etc.)
2. Extract key information (program name, amounts, dates, requirements)
3. Cross-reference with HubSpot to find relevant clients
4. Generate actionable alert with matched clients and recommendations
5. Determine priority level and notification urgency

**Analysis Guidelines**:
- Focus on changes that affect client eligibility or opportunity
- Consider timing (how urgent is this information?)
- Match clients based on industry, size, past grant history, active deals
- Provide specific next steps for the team

**Response Format**:
When processing VisualPing alerts, structure your response with:
- Change Summary (what changed)
- Impact Assessment (who is affected, how significant)
- Matched Clients (specific companies with context)
- Recommended Actions (concrete next steps)
- Priority Level (critical/high/medium/low)
```

---

## 7. Implementation Checklist

### Backend Development
- [ ] Add `/api/visualping-webhook` endpoint to `server.js`
- [ ] Implement `processVisualPingAlert()` function
- [ ] Add Redis data structures for alerts
- [ ] Create background worker for processing queue
- [ ] Add error handling and logging

### Oracle Integration
- [ ] Update `.claude/agents/internal-oracle.md` with VisualPing instructions
- [ ] Add VisualPing alert processing to conversation flow
- [ ] Implement client matching logic using HubSpot tools
- [ ] Create alert formatting templates

### VisualPing Configuration
- [ ] Set up jobs for all target grant pages
- [ ] Configure webhook URLs to point to Railway endpoint
- [ ] Set keyword alerts for each job
- [ ] Test webhook delivery

### Notification Setup
- [ ] Choose notification channel (Slack recommended)
- [ ] Create Slack webhook integration (if using Slack)
- [ ] Design alert message templates
- [ ] Set up priority-based routing

### Testing
- [ ] Test webhook endpoint with sample payload
- [ ] Verify Oracle processing with mock alerts
- [ ] Test client matching accuracy
- [ ] Validate notification delivery
- [ ] Run end-to-end test with real VisualPing job

### Documentation
- [ ] Document VisualPing job configuration
- [ ] Create runbook for common issues
- [ ] Add monitoring and alerting for webhook failures
- [ ] Update team training materials

---

## 8. Cost Considerations

**VisualPing Pricing** (approximate):
- Professional Plan: ~$44/month for 150 checks/month
- Business Plan: ~$99/month for 450 checks/month
- Enterprise: Custom pricing for high-frequency monitoring

**Recommended Setup**:
- Start with ~20-30 key grant pages
- Check frequency: Every 6-12 hours (2-4 checks/day per page)
- Total: ~2,400 checks/month = Business Plan
- Alternative: Monitor only highest-priority pages more frequently

**Claude API Costs** (per alert):
- Haiku 4.5 for initial analysis: ~$0.005 per alert
- Expected volume: 10-20 alerts/week = $0.40-0.80/month
- Negligible compared to VisualPing subscription

---

## 9. Success Metrics

**Operational**:
- Alert processing time (target: < 5 minutes from webhook receipt)
- Client matching accuracy (% of matched clients that team confirms as relevant)
- False positive rate (alerts that don't warrant action)

**Business Impact**:
- New opportunities identified per month
- Clients contacted about relevant changes
- Conversion rate on VisualPing-sourced opportunities
- Time saved vs. manual monitoring

**Team Adoption**:
- % of alerts acted upon
- Average time to act on high-priority alerts
- Feedback from strategy team on usefulness

---

## 10. Future Enhancements

**Phase 2 Features**:
1. **Predictive Monitoring**: ML to predict which pages are most likely to have relevant changes
2. **Competitive Intelligence**: Monitor competitor grant consulting firms
3. **Custom Filters**: Team members can subscribe to specific types of alerts
4. **Historical Analysis**: Track patterns in grant program changes over time
5. **Automated Outreach**: Generate draft emails to matched clients
6. **Integration with Calendar**: Auto-populate grant deadline calendar

**Advanced Analysis**:
- Sentiment analysis on guideline changes (more/less restrictive?)
- Budget trend analysis (are programs increasing/decreasing funding?)
- Seasonality detection (when do specific programs typically update?)

---

## Summary

This integration transforms Oracle from a reactive knowledge base into a proactive strategic intelligence system. By monitoring government grant websites 24/7, Oracle can alert the Granted Consulting team about opportunities and changes before competitors, enabling faster response times and better client service.

**Key Benefits**:
1. Never miss a new grant program or deadline extension
2. Proactive client outreach (we contact them before they find it themselves)
3. Competitive advantage through speed of response
4. Reduced manual monitoring workload
5. Data-driven prioritization of opportunities

**Next Steps**:
1. Get strategy team approval for VisualPing subscription
2. Implement webhook endpoint and processing logic
3. Configure initial set of monitored pages
4. Run pilot with 5-10 high-priority pages
5. Gather feedback and refine before full rollout
