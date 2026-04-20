# GetGranted Import - Next Steps

## ✅ Completed

1. **Full Data Export** - 201 grants with complete details
2. **Database Schema** - Applied to Postgres with pgvector
3. **Import Script** - Ready to generate embeddings and load data

## 📋 Ready to Import

**What we have:**
- ✅ Export file: `/data/getgranted-full-details.json` (1.7 MB, 201 grants)
- ✅ Database table: `grants` with 21 columns + vector embeddings
- ✅ Import script: `scripts/import-getgranted-to-postgres.js`

**What's needed:**
- ⏳ OpenAI API key for generating embeddings

## 🔑 Getting an OpenAI API Key

1. Go to: https://platform.openai.com/api-keys
2. Create a new API key
3. Add to your `.env` file:
   ```
   OPENAI_API_KEY=sk-...
   ```
4. Also add to Railway:
   ```bash
   railway variables set OPENAI_API_KEY=sk-...
   ```

**Cost Estimate:**
- Model: `text-embedding-3-small` (cheapest, 1536 dimensions)
- Cost: ~$0.02 per 1M tokens
- 201 grants × ~500 tokens each = ~100K tokens
- **Total cost: ~$0.002** (less than a penny!)

## 🚀 Running the Import

Once you have the API key:

```bash
# Run locally (uses .env DATABASE_URL - Neon database)
node scripts/import-getgranted-to-postgres.js

# Or on Railway
railway run node scripts/import-getgranted-to-postgres.js
```

**What it does:**
1. Reads the JSON export (201 grants)
2. For each grant:
   - Combines text (name + type + regions + industries + criteria + best practices)
   - Calls OpenAI to generate 1536-dimension embedding
   - Inserts into Postgres with embedding
3. Takes ~5-10 minutes (100ms delay between API calls)
4. Shows progress every 10 grants

## 📊 What Happens Next

After import completes:
1. Database will have 201 grants with embeddings
2. Can create semantic search function
3. Oracle can search grants by:
   - **Semantic similarity** (understands intent)
   - **Keyword filters** (region, industry, type)
   - **Hybrid search** (combines both)

## 🔄 Keeping Data Fresh

**Scheduled Re-scraping:**

Option 1: Railway Cron (recommended)
```bash
# Add to railway.toml
[deploy]
cron = "0 2 * * 0"  # Every Sunday at 2 AM

[tasks.update-grants]
command = "node scripts/export-getgranted-full-details.js && node scripts/import-getgranted-to-postgres.js"
```

Option 2: GitHub Actions
```yaml
# .github/workflows/update-grants.yml
name: Update GetGranted Database
on:
  schedule:
    - cron: '0 2 * * 0'  # Every Sunday at 2 AM
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: node scripts/export-getgranted-full-details.js
      - run: node scripts/import-getgranted-to-postgres.js
```

Option 3: Manual (for now)
```bash
# Run weekly:
node scripts/export-getgranted-full-details.js
node scripts/import-getgranted-to-postgres.js
```

## 🔍 Next: Semantic Search

After import, we'll create:

1. **Search Function** (`src/tools/search-grants-database.js`):
   ```javascript
   async function searchGrantsDatabase(query, filters = {}) {
     // 1. Generate query embedding
     // 2. Vector similarity search in Postgres
     // 3. Apply filters (region, industry, type)
     // 4. Return top N matches with scores
   }
   ```

2. **Oracle Integration**:
   - Replace `search_getgranted` tool
   - 10-100x faster than scraping
   - More accurate matching
   - Richer results

3. **Testing**:
   - Sample queries: "BC tech companies hiring developers"
   - Verify matches are relevant
   - Compare to old scraper results

## 📝 Summary

**Status**: ✅ Export complete, schema applied, import script ready
**Blocker**: Need OpenAI API key (~$0.002 cost)
**Time to complete**: ~10 minutes after adding key
**Next step**: Add OPENAI_API_KEY and run import

Want me to proceed once you have the key?
