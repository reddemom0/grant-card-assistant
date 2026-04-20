# Automatic Learning System

## ✅ **Fully Automatic in Production**

The learning system now works **end-to-end automatically** in production. No manual intervention required!

---

## 🔄 How It Works

### 1. User Gives Feedback
Users interact with the app normally:
- Click thumbs up/down on responses
- Write feedback notes in sidebar

**→ Feedback saved to database immediately**

### 2. Automatic Threshold Check
After each feedback submission:
- System counts new feedback since last learning generation
- Threshold: **5 new feedback items**

### 3. Auto-Trigger Learning Generation
When threshold is reached:
- Triggers learning generation **automatically in background**
- Doesn't slow down or block the feedback submission
- Uses Claude API to analyze patterns

### 4. Learning Files Updated
Learning files written to production database:
- `learned-patterns.md` - Success patterns from positive feedback
- `common-errors.md` - Error patterns from negative feedback
- `user-corrections.md` - Explicit corrections from notes
- `README.md` - Summary and stats

### 5. Applied to Future Conversations
All new conversations automatically:
- Load learning files from database
- Inject into system prompt
- Agent applies learnings to improve responses

---

## 📊 System Behavior

### Threshold: 5 New Feedback Items

**Why 5?**
- Balances freshness vs. API costs
- Enough data to identify meaningful patterns
- Prevents regenerating on every single feedback

**Counts toward threshold:**
- Thumbs up/down ratings
- Feedback notes
- Both positive and negative feedback

### Background Processing

Learning generation runs **asynchronously**:
- Feedback submission returns immediately (fast UX)
- Learning generation happens in background
- Logs show: `🧠 Auto-triggering learning generation for <agent> (threshold reached)`

### Per-Agent Tracking

Each agent type has its own counter:
- `readiness-strategist` - tracks its own 5-feedback threshold
- `grant-card-generator` - separate counter
- `etg-writer` - separate counter
- etc.

So if you get 5 new feedback items for readiness-strategist, it regenerates learnings for that agent only.

---

## 📝 Example Flow

```
Day 1:
- User gives feedback on readiness-strategist response #1
  → Feedback saved
  → Check: 1 new feedback (threshold: 5) ✗ Don't trigger

- User gives feedback on readiness-strategist response #2
  → Feedback saved
  → Check: 2 new feedback (threshold: 5) ✗ Don't trigger

Day 2:
- User gives feedback on readiness-strategist response #3
  → Feedback saved
  → Check: 3 new feedback (threshold: 5) ✗ Don't trigger

- User gives feedback on readiness-strategist response #4
  → Feedback saved
  → Check: 4 new feedback (threshold: 5) ✗ Don't trigger

- User gives feedback on readiness-strategist response #5
  → Feedback saved
  → Check: 5 new feedback (threshold: 5) ✅ TRIGGER!
  → Background: Analyze 5 new feedback items
  → Background: Update learning files
  → Learning counter resets to 0

Day 3:
- New conversation with readiness-strategist
  → Loads updated learning files
  → Agent applies new patterns from recent feedback
```

---

## 🔍 Monitoring

### Railway Logs

Watch for these log messages:

**Feedback Submission:**
```
✅ Feedback saved: <conv-id> - positive (quality: 1.00)
📊 Learning check for readiness-strategist: 3 new feedback items (threshold: 5)
✓ Learning threshold not reached for readiness-strategist yet
```

**Threshold Reached:**
```
✅ Feedback saved: <conv-id> - negative (quality: 0.25)
📊 Learning check for readiness-strategist: 5 new feedback items (threshold: 5)
🧠 Auto-triggering learning generation for readiness-strategist (threshold reached)
```

**Learning Generation Complete:**
```
================================================================================
🧠 Running Feedback Learning: readiness-strategist
================================================================================
📊 Step 1: Analyzing feedback...
✅ Analysis complete:
   - 3 success patterns
   - 2 error patterns
   - 1 user corrections
📝 Step 2: Writing to memory files...
✅ Wrote success patterns to database: learned-patterns.md
✅ Wrote error patterns to database: common-errors.md
✅ Wrote user corrections to database: user-corrections.md
✅ Wrote summary to database: README.md
================================================================================
✅ Feedback Learning Complete: readiness-strategist
================================================================================
✅ Auto-generated learning files for readiness-strategist: [learned-patterns.md, common-errors.md, user-corrections.md, README.md]
```

**Learning Applied:**
```
📚 Loading learned patterns from user feedback...
✓ Loaded 4 learning files for readiness-strategist: [learned-patterns.md, common-errors.md, user-corrections.md, README.md]
  Last updated: 2025-11-13T17:42:31.000Z
✓ Injected learned patterns from feedback into system prompt
```

### Check Current State

```bash
# Count new feedback since last learning generation
node check-production-learning.js

# View learning file content
node view-learning-content.js
```

---

## ⚙️ Configuration

### Changing the Threshold

Edit `src/feedback-learning/auto-trigger.js`:

```javascript
// Threshold: trigger learning after N new feedback items
const FEEDBACK_THRESHOLD = 5;  // ← Change this number
```

**Recommendations:**
- **3-5**: Frequent updates, higher API costs
- **5-10**: Balanced (current setting: 5)
- **10-20**: Less frequent, lower costs

### Disabling Auto-Trigger

Comment out the auto-trigger code in:
- `api/feedback.js` (line 140-152)
- `api/feedback-note.js` (line 110-123)

You can still manually trigger via `/api/feedback-learning` endpoint.

---

## 🧪 Testing

### Verify Auto-Trigger Works

1. Give 5 feedback items to the same agent (e.g., readiness-strategist)
2. Check Railway logs for `🧠 Auto-triggering learning generation`
3. Verify learning files updated in database:
   ```bash
   node check-production-learning.js
   ```
4. Start new conversation and check logs for `✓ Loaded X learning files`

### Test Learning Application

1. Give negative feedback: "Response was too verbose"
2. After 5 total feedback items, learnings regenerate
3. Start new conversation
4. Agent should keep responses more concise

---

## 💰 Cost Considerations

### Claude API Usage

Learning generation uses Claude API:
- **Haiku model** for analysis (cheap)
- Processes all feedback for an agent (~1-10 messages)
- Cost per generation: ~$0.01-0.05

**Monthly estimate at threshold=5:**
- 100 feedback items/month = 20 learning generations
- Cost: ~$0.20-1.00/month
- **Negligible compared to conversation costs**

### Optimization

Current implementation is already optimized:
- Runs in background (doesn't block user)
- Only triggers when threshold reached
- Per-agent tracking (doesn't regenerate all agents)

---

## 🐛 Troubleshooting

### Learning files not updating

**Check 1**: Is threshold being reached?
- Look for log: `📊 Learning check for <agent>: X new feedback items (threshold: 5)`
- If X < 5, give more feedback

**Check 2**: Is auto-trigger running?
- Look for log: `🧠 Auto-triggering learning generation`
- If missing, check Railway deployment

**Check 3**: Did generation succeed?
- Look for log: `✅ Auto-generated learning files`
- If error, check error logs

### Learnings not applied to conversations

**Check 1**: Are files in database?
```bash
node check-production-learning.js
```

**Check 2**: Are files being loaded?
- Check conversation logs for: `✓ Loaded X learning files`
- If missing, check `src/claude/client.js` line 99

---

## 📅 Deployed

**Date**: November 13, 2025
**Commit**: 1e641d1
**Branch**: railway-migration (production)
**Status**: ✅ Active in production

---

## 🎯 Summary

**Before:**
1. Feedback stored ✅
2. Learning generation ❌ Manual trigger required
3. Learning application ✅ Automatic

**After:**
1. Feedback stored ✅ Automatic
2. Learning generation ✅ **Automatic (threshold-based)**
3. Learning application ✅ Automatic

**Result**: **100% automatic learning system in production!** 🚀
