# Database Migration Guide: Vercel → Railway

This guide walks you through migrating your PostgreSQL database from Vercel to Railway.

## Prerequisites

- Node.js installed
- `pg` npm package (already in your project)
- Vercel PostgreSQL connection string
- Railway PostgreSQL connection string

## Migration Scripts

1. **`create-schema.js`** - Creates tables, indexes, and triggers on Railway
2. **`migrate-data.js`** - Copies all data from Vercel to Railway

## Step-by-Step Instructions

### Step 1: Get Your Connection Strings

**Vercel Postgres:**
```bash
# Get from Vercel dashboard or environment variables
# Format: postgresql://username:password@host:port/database
```

**Railway Postgres:**
```bash
# Get from Railway dashboard → your project → PostgreSQL → Connect
# Format: postgresql://username:password@host:port/database
```

### Step 2: Create Schema on Railway

Run the schema creation script:

```bash
RAILWAY_DATABASE_URL="postgresql://..." node create-schema.js
```

**Expected output:**
```
🚀 Starting schema creation on Railway PostgreSQL...

🔌 Testing Railway connection...
✅ Connected to Railway PostgreSQL

📋 Creating tables...
  ✅ Users table created
  ✅ Conversations table created
  ✅ Messages table created

📊 Creating indexes...
  ✅ Users indexes created
  ✅ Conversations indexes created
  ✅ Messages indexes created

⚡ Creating trigger function...
  ✅ Trigger function created
  ✅ Trigger created

🔍 Verifying schema...
  Tables created: conversations, messages, users
  Indexes created: 9
  Triggers created: 1

✅ Schema creation completed successfully!
```

### Step 3: Migrate Data from Vercel to Railway

Run the data migration script:

```bash
VERCEL_POSTGRES_URL="postgresql://..." \
RAILWAY_DATABASE_URL="postgresql://..." \
node migrate-data.js
```

**Expected output:**
```
🚀 Starting data migration from Vercel to Railway...

🔌 Testing connections...
  ✅ Connected to Vercel PostgreSQL
  ✅ Connected to Railway PostgreSQL

📊 Counting source data (Vercel)...
  Users:         5
  Conversations: 47
  Messages:      234

👥 Migrating users table...
  ✅ Migrated 5 users

💬 Migrating conversations table...
  ✅ Migrated 47 conversations

📨 Migrating messages table...
  📦 Inserted batch: 100 messages so far...
  📦 Inserted batch: 200 messages so far...
  ✅ Migrated 234 messages

🔍 Verifying migration...
  Source (Vercel)     → Destination (Railway)
  ───────────────────────────────────────────
  Users:         5    → 5
  Conversations: 47   → 47
  Messages:      234  → 234

✅ Migration completed successfully!
```

### Step 4: Update Your Application

1. **Update environment variables:**
   ```bash
   # In your .env file
   DATABASE_URL=your_railway_connection_string

   # Or set in Vercel/Railway dashboard
   DATABASE_URL=your_railway_connection_string
   ```

2. **Update `api/server.js`** (if needed):
   ```javascript
   // Change from POSTGRES_URL to DATABASE_URL if necessary
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL,
     ssl: { rejectUnauthorized: false }
   });
   ```

3. **Test locally:**
   ```bash
   # Set Railway connection string
   export DATABASE_URL="postgresql://..."

   # Run your app
   npm run dev
   ```

4. **Verify everything works:**
   - Login with Google OAuth
   - Create a new conversation
   - Check sidebar shows conversations
   - Switch between conversations
   - Delete a conversation

### Step 5: Deploy to Production

Once verified locally:

1. Update environment variables in your hosting platform (Vercel/Railway)
2. Deploy your application
3. Test in production

## Troubleshooting

### Connection Errors

**Error: `Connection timed out`**
```bash
# Solution: Check your connection string format
# Should include ?ssl=true or ssl=require if needed
postgresql://user:pass@host:port/db?sslmode=require
```

**Error: `password authentication failed`**
```bash
# Solution: Double-check your connection string
# Copy directly from Railway/Vercel dashboard
```

### Migration Errors

**Error: `relation "users" already exists`**
```bash
# Solution: This is OK - script uses IF NOT EXISTS
# Safe to run multiple times
```

**Error: `duplicate key value violates unique constraint`**
```bash
# Solution: Script uses ON CONFLICT DO NOTHING
# Skipped records are logged but won't fail migration
```

### Verification Failures

**Row counts don't match:**
```bash
# Check logs for "Skipped" messages
# Common causes:
# - Duplicate google_id (users already exist)
# - Foreign key violations (orphaned records)
# - UUID conflicts
```

**Missing data:**
```bash
# Run queries to compare:
# Vercel:
psql $VERCEL_POSTGRES_URL -c "SELECT COUNT(*) FROM users"

# Railway:
psql $RAILWAY_DATABASE_URL -c "SELECT COUNT(*) FROM users"
```

## Schema Details

### Users Table
- `id` - SERIAL PRIMARY KEY (integer)
- `uuid` - UUID (referenced by conversations)
- `google_id` - Google OAuth identifier
- `email`, `name`, `picture` - User profile data
- `last_login`, `created_at` - Timestamps

### Conversations Table
- `id` - UUID PRIMARY KEY
- `user_id` - UUID (references users.uuid)
- `agent_type` - Agent identifier (grant-cards, etg-writer, etc.)
- `title` - Auto-generated from first message
- `created_at`, `updated_at` - Timestamps

### Messages Table
- `id` - UUID PRIMARY KEY
- `conversation_id` - UUID (references conversations.id)
- `role` - 'user', 'assistant', or 'system'
- `content` - Message text
- `created_at` - Timestamp

### Indexes
- Users: google_id, email, uuid
- Conversations: user_id, updated_at, (user_id + agent_type)
- Messages: conversation_id

### Triggers
- Auto-update `conversations.updated_at` when messages inserted

## Rollback Plan

If something goes wrong:

1. **Keep Vercel database running** (don't delete until Railway is verified)
2. **Switch back to Vercel:**
   ```bash
   # Update environment variable
   DATABASE_URL=your_vercel_connection_string
   ```
3. **Re-deploy** with Vercel connection string

## Post-Migration Checklist

- [ ] Schema created on Railway
- [ ] All data migrated (verify row counts)
- [ ] Application tested locally with Railway
- [ ] Environment variables updated
- [ ] Application deployed to production
- [ ] Production testing complete
- [ ] Old Vercel database backed up
- [ ] Monitor for 24-48 hours before deleting Vercel database

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review migration script logs
3. Verify connection strings are correct
4. Test connections manually with `psql`

---

**Generated by Claude Code**
