# Production Learning Generation Workflow

## ✅ Problem Fixed

**Issue**: Learning files were stored in staging database instead of production.

**Root Cause**: Local `.env` file pointed to Neon database, but Railway production uses a different `DATABASE_URL`.

**Solution**: Generated learning files from production feedback (now stored in production DB).

---

## 📊 Current State (Nov 13, 2025)

**Production Database** (`nozomi.proxy.rlwy.net:16552`):
- ✅ 10 learning files across 4 agents
- ✅ Generated from actual production feedback
- ✅ Ready to be applied in new conversations

**Learning Files by Agent:**
- `readiness-strategist`: 3 files (learned-patterns, common-errors, README)
- `grant-card-generator`: 3 files
- `etg-writer`: 2 files (common-errors, README)
- `canexport-claims`: 2 files (learned-patterns, README)

---

## 🔄 How Learning System Works

### 1. Feedback Collection
Users provide feedback on agent responses:
- **Thumbs up/down** → stored in `conversation_feedback` table
- **Feedback notes** → stored in `feedback_notes` table

### 2. Learning Generation
The `/api/feedback-learning` endpoint analyzes feedback and creates learning files:
- **Success patterns**: Common themes in positively-rated responses
- **Common errors**: Patterns in negatively-rated responses
- **User corrections**: Explicit corrections from users

### 3. Learning Application
When an agent starts a conversation:
1. Loads agent prompt from `.claude/agents/<agent>.md`
2. Loads conversation memories (user's working context)
3. **Loads learning files** from database via `loadLearningMemory()`
4. Injects learnings into system prompt with `<learning_from_feedback>` tags
5. Agent applies learnings to improve responses

---

## 🚀 Triggering Learning Generation in Production

### Method 1: Via Production API (Recommended)

```bash
# Trigger learning for all agents with feedback
curl -X POST https://grant-card-assistant-production.up.railway.app/api/feedback-learning \
  -H "Content-Type: application/json" \
  -H "Cookie: token=YOUR_JWT_TOKEN" \
  -d '{"all": true}'

# Trigger learning for specific agent
curl -X POST https://grant-card-assistant-production.up.railway.app/api/feedback-learning \
  -H "Content-Type: application/json" \
  -H "Cookie: token=YOUR_JWT_TOKEN" \
  -d '{"agentType": "readiness-strategist"}'
```

**Note**: Requires authentication. Get JWT token from browser cookies after logging into production app.

### Method 2: Via Admin Panel (Easiest)

1. Log into production: `https://grant-card-assistant-production.up.railway.app/admin`
2. Navigate to "Feedback Learning" section
3. Click "Generate Learning Files for All Agents"

### Method 3: Manual Script (For Development)

```bash
# 1. Temporarily update .env to point to production
echo "DATABASE_URL=postgresql://postgres:PASSWORD@nozomi.proxy.rlwy.net:16552/railway" > .env

# 2. Run trigger script
node trigger-production-learning.js

# 3. Restore original .env
git checkout .env
```

---

## 🔧 Environment Variable Setup

### Railway Production
Set these environment variables in Railway dashboard:

```
DATABASE_URL=postgresql://postgres:PASSWORD@nozomi.proxy.rlwy.net:16552/railway
ANTHROPIC_API_KEY=<your-key>
# ... other variables ...
```

### Local Development
Your local `.env` file can point to whatever database you want for testing:

```
DATABASE_URL=postgresql://neondb_owner:...@ep-lively-bar...neon.tech/neondb
```

The key is that **Railway uses its own `DATABASE_URL`**, so local `.env` doesn't affect production.

---

## 📅 Recommended Schedule

**Trigger learning generation:**
- **Weekly**: After significant usage or feedback collection
- **On-demand**: When you notice recurring issues in agent responses
- **After major changes**: When updating agent prompts or behavior

**Why not automatic?**
- Learning generation uses Claude API (costs tokens)
- Better to trigger intentionally when there's meaningful new feedback
- Allows review of learning files before they're applied

---

## 🧪 Testing Learning Application

### Verify learnings are loaded:

1. Start a new conversation with any agent
2. Check Railway logs for:
   ```
   📚 Loading learned patterns from user feedback...
   ✓ Loaded 3 learning files for readiness-strategist
   ✓ Injected learned patterns from feedback into system prompt
   ```

3. Agent should apply learnings (e.g., "Not succinct enough" → agent keeps responses shorter)

### Check learning file content:

```bash
node check-production-learning.js
```

This shows all learning files in production database with their timestamps and content.

---

## 🐛 Troubleshooting

### Issue: "No agents have feedback data yet"
**Cause**: Script using wrong DATABASE_URL (e.g., local Neon DB instead of Railway production)

**Fix**: Ensure `DATABASE_URL` environment variable points to production:
- Railway: Set in Railway dashboard (automatic)
- Local script: Temporarily update `.env` or pass as env var

### Issue: Learning files not being applied
**Cause 1**: Files not in production database
**Fix**: Run learning generation as shown above

**Cause 2**: `loadLearningMemory()` not being called
**Fix**: Verify `src/claude/client.js` line 99 calls `loadLearningMemory(agentType, conversationId, userId)`

### Issue: Old learning files (timestamps from days ago)
**Cause**: Files not regenerated after new feedback
**Fix**: Trigger learning generation via API or admin panel

---

## 📝 Next Steps

1. **Add admin UI button** to trigger learning generation (in progress)
2. **Add automatic weekly cron job** (optional - requires Railway cron setup)
3. **Monitor learning effectiveness** via feedback metrics

---

**Last Updated**: November 13, 2025
**Learning Files Generated**: 4 agents, 10 total files
**Production Status**: ✅ Working correctly
