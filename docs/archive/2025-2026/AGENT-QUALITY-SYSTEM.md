# Agent Quality Metrics System

## Overview

A comprehensive system for tracking and measuring the performance of all AI agents based on well-defined success criteria aligned with each agent's specific role and system prompt.

## What Was Built

### 1. Success Criteria Definition
Each agent has specific, measurable success criteria based on what they're instructed to do:

**Grant Card Generator:**
- Extraction completeness (95%+)
- Format compliance (word limits, bullet formatting)
- No hallucinations (98%+)
- Low revision count (≤2)

**ETG Business Case Writer:**
- Workflow compliance (no repetition)
- HubSpot context usage
- Eligibility verification accuracy (100% for false approvals)
- Complete 7-step workflow execution

**BCAFE Writer:**
- Eligibility verification first (100%)
- All 5 merit criteria addressed
- Budget/Timeline section prioritized (30% weight)
- Export market focus (not domestic)

**CanExport Claims Auditor:**
- Tax removal accuracy (100%)
- Historical rejection pattern detection (90%+)
- Direct answer first (response structure)
- Auto-load HubSpot context
- No document re-analysis

**Readiness Strategist:**
- One document per response rule (100%)
- Research completeness (program criteria extraction)
- Proper document structure
- Successful Google Doc/Sheet creation

### 2. Database Schema (`database-schema-agent-metrics.sql`)

**New Tables:**

**`feedback_tags`** - Structured feedback categorization
- Links to conversation_feedback or feedback_notes
- Categories: accuracy, format, workflow, instruction-following, context-usage, success indicators
- Auto-updates metrics via triggers

**`agent_evaluations`** - Manual spot-check evaluations
- 0-100 scores for each success criterion
- Issues found (JSONB array)
- Strengths noted
- Evaluation notes

**`agent_metrics_daily`** - Daily rollup of metrics
- Volume metrics (conversations, messages, users)
- Feedback metrics (positive/negative rates)
- Issue counts by category
- Calculated scores (accuracy, workflow, format, instruction, context)
- Weighted quality score

**New Columns:**
- `conversations.workflow_state` - Track workflow progress (JSON)
- `conversations.workflow_violations` - Count workflow issues
- `messages.user_instruction` - Extracted user instruction
- `messages.instruction_followed` - Boolean tracking

**Views:**
- `agent_performance_summary` - 30-day overview
- `feedback_with_tags` - Feedback with aggregated tags

**Functions:**
- `calculate_agent_quality_score()` - Weighted composite score
- `update_agent_metrics_daily()` - Refresh daily metrics
- Triggers to auto-update on feedback changes

### 3. Backend API (`api/agent-quality.js`)

**Endpoints:**
- `GET /api/agent-quality?days=7` - Get quality matrix for all agents
- `GET /api/agent-quality?action=agent-details&agentType=etg-writer&days=7` - Get detailed agent metrics

**Metrics Calculated:**
- **Accuracy Score**: % conversations without accuracy issues (missed info, hallucinations, wrong data)
- **Workflow Score**: % conversations without workflow issues (repeated steps, wrong sequence)
- **Format Score**: % conversations without format issues (wrong structure, missing sections)
- **Instruction Score**: % conversations following user instructions
- **Context Score**: % conversations properly using provided materials/HubSpot
- **Quality Score**: Weighted composite (Accuracy 30%, Instructions 25%, Positive Rate 20%, Format 10%, Workflow 10%, Context 5%)

### 4. Frontend Dashboard (`agent-quality.html`)

**Features:**
- Time filtering (24 hours, 7 days, 30 days, 90 days)
- Summary cards (total conversations, avg quality, positive rate, active agents)
- Agent quality matrix table (clickable rows)
- Color-coded scores (green=90+, blue=80-89, yellow=70-79, red=<70)
- Modal with detailed agent metrics
- Recent feedback display with tags
- Issue breakdown visualization

**Routing:** `/agent-quality`

## How to Use

### Step 1: Run Database Migration

```bash
node migrations/add-agent-metrics-schema.js
```

This creates all tables, views, functions, and triggers.

### Step 2: Start Tagging Feedback

When users provide feedback, parse their text for keywords and add tags to `feedback_tags`:

**Keyword → Tag Mapping:**
```javascript
const tagMappings = {
  // Accuracy issues
  'missed': 'missed-information',
  'incomplete': 'incomplete-extraction',
  'hallucination': 'hallucination',
  'not in document': 'hallucination',
  'wrong data': 'wrong-data',

  // Format issues
  'wrong format': 'wrong-format',
  'missing sections': 'missing-sections',
  'too long': 'too-long',
  'wrong structure': 'wrong-structure',

  // Workflow issues
  'already asked': 'already-asked',
  'already told you': 'already-asked',
  'repeated': 'repeated-step',
  'wrong sequence': 'wrong-sequence',

  // Instruction following
  'not what i asked': 'not-what-i-asked',
  'wrong section': 'wrong-section',
  'ignored': 'ignored-request',
  'opposite': 'did-opposite',

  // Context usage
  'didn\'t use hubspot': 'didnt-use-hubspot',
  'didn\'t check': 'ignored-uploaded-file',

  // Success indicators
  'perfect': 'perfect',
  'exactly what i needed': 'exactly-what-i-needed',
  'ready to submit': 'ready-to-submit',
  'great work': 'great-work'
};
```

**Example API call:**
```javascript
// When user provides feedback
const feedbackText = "You missed the eligibility criteria and wrong format";

// Parse and insert tags
await query(`
  INSERT INTO feedback_tags (feedback_id, tag)
  VALUES ($1, $2)
`, [feedbackId, 'missed-information']);

await query(`
  INSERT INTO feedback_tags (feedback_id, tag)
  VALUES ($1, $2)
`, [feedbackId, 'wrong-format']);

// Metrics auto-update via trigger!
```

### Step 3: Access the Dashboard

Visit: `https://your-domain.com/agent-quality`

**What You'll See:**
1. Summary cards showing overall performance
2. Agent quality matrix with all metrics
3. Click any agent row to see:
   - Detailed scores breakdown
   - Common issues
   - Recent feedback with tags
4. Time filter to analyze different periods

### Step 4: Perform Manual Spot Checks (Optional)

For more rigorous evaluation:

```sql
INSERT INTO agent_evaluations (
  conversation_id,
  agent_type,
  evaluator_id,
  accuracy_score,
  workflow_score,
  format_score,
  instruction_following_score,
  context_usage_score,
  overall_score,
  verdict,
  issues_found,
  strengths_noted,
  notes
) VALUES (
  'conversation-uuid',
  'etg-writer',
  1, -- your user id
  85.0,
  90.0,
  95.0,
  80.0,
  88.0,
  86.5,
  'good',
  '[{"type": "accuracy", "description": "Missed one eligibility criterion", "severity": "minor"}]'::jsonb,
  '[{"area": "format", "description": "Perfect structure and formatting"}]'::jsonb,
  'Good overall performance but needs to be more careful with eligibility checks'
);
```

Manual evaluations are incorporated into daily metrics rollup.

## Metrics Interpretation

### Quality Score Ranges
- **90-100**: Excellent - Exceeds expectations
- **80-89**: Good - Meets expectations with strengths
- **70-79**: Fair - Acceptable but needs improvement
- **<70**: Poor - Requires attention

### What Drives Quality Score
1. **Accuracy (30%)** - Most important: is information correct and complete?
2. **Instruction Following (25%)** - Does it deliver what user asked for?
3. **Positive Feedback Rate (20%)** - Are users satisfied?
4. **Format Compliance (10%)** - Does it follow required structure?
5. **Workflow Compliance (10%)** - Does it follow process correctly?
6. **Context Usage (5%)** - Does it use provided materials?

### Common Issue Patterns to Watch

**High Accuracy Issues:**
- Agent hallucinating information not in source
- Missing critical details from documents
- Extracting data incorrectly

**High Instruction Issues:**
- Agent drafting wrong section when asked for specific one
- Ignoring user's specific requests
- Doing opposite of what was asked

**High Workflow Issues:**
- Re-asking questions already answered
- Skipping required verification steps
- Repeating completed work

**High Format Issues:**
- Wrong document structure
- Exceeding word limits
- Missing required sections

## Next Steps

After the agent quality matrix is established:

1. **Implement time filtering for feedback dashboard** - Apply same time filter approach to existing feedback/learning dashboard
2. **Create unified dashboard layout** - Merge usage, feedback, and quality dashboards into one interface
3. **Set up alerts** - Notify when agent quality drops below thresholds
4. **Weekly reviews** - Review agent performance trends
5. **Continuous improvement** - Use insights to refine agent prompts

## Files Created

```
/database-schema-agent-metrics.sql          # Database schema
/migrations/add-agent-metrics-schema.js     # Migration script
/api/agent-quality.js                       # Backend API
/agent-quality.html                         # Frontend dashboard
/vercel.json                                # Updated with new route
/AGENT-QUALITY-SYSTEM.md                    # This documentation
```

## Architecture Benefits

1. **Evidence-Based**: Metrics directly tied to success criteria from system prompts
2. **Automated**: Triggers auto-calculate metrics when feedback added
3. **Scalable**: Structured tags enable programmatic analysis
4. **Actionable**: Clear metrics → identify issues → improve prompts
5. **User-Focused**: "Instruction following" metric prioritizes user satisfaction
6. **Comprehensive**: Covers accuracy, usability, and process compliance

## Sample Queries

**Get agent performance trends:**
```sql
SELECT
  date,
  agent_type,
  quality_score,
  accuracy_score,
  instruction_score
FROM agent_metrics_daily
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC, quality_score DESC;
```

**Find most common issues by agent:**
```sql
SELECT
  c.agent_type,
  ft.tag,
  COUNT(*) as count
FROM feedback_tags ft
JOIN conversation_feedback cf ON ft.feedback_id = cf.id
JOIN conversations c ON cf.conversation_id = c.id
WHERE cf.created_at >= NOW() - INTERVAL '7 days'
GROUP BY c.agent_type, ft.tag
ORDER BY count DESC;
```

**Compare agents side-by-side:**
```sql
SELECT * FROM agent_performance_summary
ORDER BY quality_score DESC;
```
