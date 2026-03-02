# Feedback Analyzer Upgrade Summary

## What Changed

### BEFORE: Basic Keyword Counting
**File**: `src/feedback-learning/analyzer.js` (old version)

**Problems**:
- Used simple JavaScript string operations (`extractKeywords()`)
- Counted word frequencies instead of extracting meaning
- No AI analysis - just `text.split(/\s+/)` and word length filtering
- Processed raw JSON with thinking tags, resulting in garbage themes like `{"type":"thinking","index":0`
- Generic advice like "be concise" instead of specific corrections
- No distinction between "nice job!" and "actually, X is wrong"

**Example Output**:
```markdown
## Top Themes
1. business (6 occurrences)
2. {"type":"thinking","index":0 (2 occurrences)
3. hubspot (4 occurrences)

## Successful Approaches
**Approach**: [{"type":"thinking","index":0,"thinking":"I can see my memory directory...
```

### AFTER: Claude Haiku AI Analysis
**File**: `src/feedback-learning/analyzer.js` (new version)

**Improvements**:
1. **Strips thinking tags FIRST** - New `stripThinkingTags()` function parses JSON and filters out thinking blocks
2. **Uses Claude Haiku API** - Sends feedback batches to AI for actual analysis
3. **Extracts specific corrections** - Identifies factual errors, procedural issues, format requirements
4. **Structured output** - Returns actionable rules with "WRONG" vs "CORRECT" format
5. **Categorizes intelligently** - Distinguishes between factual_error, wrong_format, missed_requirement, etc.

**Expected Output** (once deployed with API key):
```markdown
## Error Categories
1. **factual_error** - Incorrect eligibility rules (3 occurrences)
2. **wrong_format** - Used 3 bullets instead of 4 (2 occurrences)

## Specific Error Examples

### Error 1: factual_error

**Issue**: Agent stated training must be "20+ hours" for ETG eligibility

**Context**:
❌ WRONG: Training must have substantial duration (generally 20+ hours)
✅ CORRECT: ETG has NO minimum hours requirement. 1-day courses ARE eligible.

**Quality Score**: 0.25
```

---

## Key Changes in Code

### 1. New Function: `stripThinkingTags(messageContent)`
```javascript
// Parses JSON message content and filters out thinking blocks
const visibleBlocks = parsed.filter(block =>
  block.type !== 'thinking' &&
  block.type !== 'tool_use'
);
```

### 2. New AI Analysis: `analyzeSuccessPatterns(agentType, limit)`
- Sends feedback batch to Claude Haiku
- Prompt asks for specific, actionable patterns
- Returns structured themes with descriptions and actionable instructions
- Fallback to basic summary if AI fails

### 3. New AI Analysis: `analyzeErrorPatterns(agentType, limit)`
- Analyzes negative feedback to extract corrections
- Categorizes by error type (factual, format, procedural, etc.)
- Extracts "what went wrong" AND "correct behavior"
- Formats as ❌ WRONG / ✅ CORRECT pairs

### 4. New AI Analysis: `analyzeUserCorrections(agentType, limit)`
- Processes mid-conversation corrections (words like "actually", "incorrect", "wrong")
- Categorizes into factual, procedural, formatting
- Extracts specific rules from detailed corrections

---

## Test Case: CanExport Advertising Eligibility

**Staff Feedback** (from conversation_feedback table):
> "this is not correct. any advertising expenses related to direct mail campaigns (e.g. cold calling, telemarketing, email campaigns) including newsletters (in print and online) in ineligible for CanExport. only Advertising costs related to participation in a trade event. Advertising must be targeted to audiences in the approved target market..."

**OLD Analyzer Output**:
```markdown
**User Feedback**: this is not correct. any advertising expenses related to...
```
(Just dumped raw text, no extraction)

**NEW Analyzer Output** (expected with AI):
```markdown
### Factual Correction: CanExport Advertising Eligibility

**Issue**: Agent incorrectly approved email newsletter advertising

**Context**:
❌ AGENT SAID: Digital advertising (email newsletters) are eligible expenses
✅ CORRECT: ONLY advertising related to trade events is eligible
  - ❌ INELIGIBLE: Email newsletters, direct mail, cold calling, telemarketing
  - ✅ ELIGIBLE: Banner ads at tradeshows, ads on tradeshow websites, trade event marketing

**Source**: Staff correction (Jan 5, 2026)
```

---

## Deployment Instructions

### Step 1: Verify Code is Deployed
The new analyzer.js is already written. Verify it's in production:
```bash
git status
git add src/feedback-learning/analyzer.js
git commit -m "Upgrade analyzer to use Claude Haiku for AI-powered feedback analysis"
git push
```

### Step 2: Verify API Key Exists
The analyzer uses `process.env.ANTHROPIC_API_KEY`. Verify it's set in Railway:
```bash
railway variables
# Should show ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Step 3: Re-run Learning Generation for All Agents

**Option A: Via API** (recommended)
```bash
curl -X POST https://your-app.railway.app/api/feedback-learning \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<your-jwt-token>" \
  -d '{"all": true}'
```

**Option B: Via Script**
```bash
railway run node -e "
import { runFeedbackLearningForAllAgents } from './src/feedback-learning/orchestrator.js';
runFeedbackLearningForAllAgents().then(result => {
  console.log(result);
  process.exit(0);
});
"
```

### Step 4: Verify New Learning Files

**Check database for updated files**:
```bash
railway run node check-learning-files.js
```

Should show files updated with today's timestamp and MUCH better content than before.

### Step 5: Test with New Conversation

1. Start a new conversation with ETG agent
2. Ask about 1-day training eligibility
3. Agent should NO LONGER say "20+ hours required" (we fixed the prompt)
4. If agent makes other mistakes, give detailed feedback
5. After 5 feedback items, system auto-regenerates learning files
6. Check logs for: `🧠 Auto-triggering learning generation for etg-writer`

---

## Expected Improvements

### Before (Current Learning Files)
- **Generic themes**: "business", "hubspot", "integration"
- **Garbage data**: `{"type":"thinking","index":0` counted as theme
- **No specificity**: "responses should be concise" (too vague)
- **Lost details**: Specific corrections not extracted from text

### After (With New AI Analyzer)
- **Specific patterns**: "Used 4 bullet points for Granted Insights", "Referenced specific program rules"
- **Clean data**: Thinking tags stripped before analysis
- **Actionable rules**: "❌ WRONG: 3 bullets → ✅ CORRECT: 4 bullets"
- **Preserves details**: "CanExport ads only eligible for trade events, NOT email newsletters"

---

## Monitoring

### Check if AI Analysis is Working

**Good logs** (AI analysis succeeded):
```
🔍 Analyzing success patterns for etg-writer using AI...
✅ Analysis complete:
   - 3 success patterns
   - 2 error patterns
   - 1 user corrections
```

**Bad logs** (AI analysis failed, using fallback):
```
Error in AI analysis of success patterns: Error: API key missing
✅ Analysis complete:
   - 0 success patterns (analysis-failed)
```

### Check Generated Files Quality

**Before**: Word frequency lists
```markdown
1. **business** (6 occurrences)
2. **{"type":"thinking"** (3 occurrences)
```

**After**: Actionable insights
```markdown
1. **Detailed eligibility breakdown** (5 occurrences)
   - Description: Agent provided specific program rules with bullet points
   - Actionable: Continue breaking down eligibility into clear, bulleted criteria
```

---

## Cost Impact

**Claude Haiku API Usage**:
- ~$0.01-0.05 per learning generation
- Triggered every 5 feedback items per agent
- Estimated monthly cost: ~$1-5 (negligible)

**Value**:
- Prevents repeated mistakes (e.g., ETG "20+ hours" error)
- Captures specific staff corrections automatically
- Improves agent behavior without manual prompt updates

---

## Rollback Plan

If the new analyzer causes issues:

1. **Revert analyzer.js**:
   ```bash
   git revert <commit-hash>
   git push
   ```

2. **Delete bad learning files**:
   ```sql
   DELETE FROM learning_memory_files WHERE updated_at > '2026-03-02';
   ```

3. **Regenerate with old analyzer**:
   ```bash
   railway run node trigger-production-learning.js
   ```

---

## Next Steps

1. ✅ Deploy new analyzer (code already written)
2. ⏳ Verify ANTHROPIC_API_KEY in Railway
3. ⏳ Re-run learning generation for all agents
4. ⏳ Verify output quality (check for specific rules vs generic themes)
5. ⏳ Monitor first 5 new feedback items to test auto-trigger
6. ⏳ Fix message_id join issue in retrieval.js (some agents like canexport-claims have broken joins)

---

## Status

- [x] Analyzer rewritten with Claude Haiku integration
- [x] Thinking tag stripping implemented
- [x] Structured correction extraction implemented
- [x] Fallback mechanism for API failures
- [ ] Deployed to production with API key
- [ ] Tested on real feedback data
- [ ] Learning files regenerated with AI analysis
- [ ] Agent behavior verified to improve

**Ready for deployment and testing in production environment.**
