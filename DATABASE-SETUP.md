# Database Setup Guide for Railway

This guide explains how to set up the PostgreSQL database for a new Railway environment (staging, production, etc.).

## Problem

When creating a new Railway environment, the PostgreSQL database starts empty. The application needs:
- **users** table with OAuth token columns
- **conversations** table
- **messages** table
- **conversation_memory** table

Without these tables, you'll see errors like:
```
column "google_access_token" of relation "users" does not exist
```

## Prerequisites

- Railway CLI installed (`npm install -g @railway/cli`)
- Access to your Railway project
- PostgreSQL database service created in Railway

## Setup Steps

### Option 1: Automated Script (Recommended)

1. **Switch to staging environment in Railway:**
   ```bash
   railway environment
   # Select "staging"
   ```

2. **Run the setup script:**
   ```bash
   ./scripts/setup-staging-database.sh
   ```

   This script will:
   - Check if Railway CLI is installed
   - Prompt you to confirm
   - Run the complete database schema on staging
   - Create all necessary tables with correct columns

### Option 2: Manual Setup via Railway Dashboard

1. **Go to Railway Dashboard**
   - Open your project at https://railway.app
   - Select the **staging** environment
   - Click on the **PostgreSQL** service

2. **Open the Data tab**
   - Click "Query" at the top
   - Copy the entire contents of `migrations/setup-railway-complete.sql`
   - Paste into the query editor
   - Click "Run Query"

3. **Verify tables were created:**
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public';
   ```

   You should see:
   - users
   - conversations
   - messages
   - conversation_memory

### Option 3: Manual Setup via psql CLI

1. **Get database connection string from Railway:**
   ```bash
   railway variables --environment staging | grep DATABASE_URL
   ```

2. **Connect with psql:**
   ```bash
   psql "<DATABASE_URL>"
   ```

3. **Run the setup script:**
   ```bash
   \i migrations/setup-railway-complete.sql
   ```

## What Gets Created

### Tables

1. **users** - User accounts via Google OAuth
   - `id` (SERIAL PRIMARY KEY)
   - `google_id`, `email`, `name`, `picture`
   - `google_access_token`, `google_refresh_token`, `google_token_expiry` (OAuth tokens)
   - `role`, `is_active`, `last_login`
   - Timestamps: `created_at`, `updated_at`

2. **conversations** - User conversations with AI agents
   - `id` (UUID PRIMARY KEY)
   - `user_id` (INTEGER, references users.id)
   - `agent_type` (VARCHAR)
   - `title` (VARCHAR)
   - Timestamps: `created_at`, `updated_at`

3. **messages** - Individual messages within conversations
   - `id` (UUID PRIMARY KEY)
   - `conversation_id` (UUID, references conversations.id)
   - `role` (VARCHAR: user/assistant/system)
   - `content` (TEXT)
   - `created_at` (TIMESTAMP)

4. **conversation_memory** - Key-value storage for agent memory tool
   - `id` (SERIAL PRIMARY KEY)
   - `conversation_id` (UUID, references conversations.id)
   - `key`, `value` (TEXT)
   - Timestamps: `created_at`, `updated_at`

### Indexes

Performance indexes are created on:
- User lookups: `google_id`, `email`, `refresh_token`
- Conversation queries: `user_id`, `agent_type`, `created_at`, `updated_at`
- Message queries: `conversation_id`, `created_at`
- Memory queries: `conversation_id`, `(conversation_id, key)`

### Triggers

Automatic timestamp updates:
- `users.updated_at` updated on any user record change
- `conversations.updated_at` updated on any conversation change
- `conversation_memory.updated_at` updated on any memory change

## Verifying Setup

After running the setup, test the staging environment:

1. **Try logging in:**
   ```
   https://grant-card-assistant-staging.up.railway.app
   ```

2. **Create a test conversation:**
   - Select any agent (e.g., Grant Cards)
   - Send a test message
   - Verify it works without database errors

3. **Test Google Docs creation:**
   - Use the Grant Cards agent
   - Request it to create a Google Doc
   - Verify OAuth tokens are saved

## Troubleshooting

### "railway: command not found"
Install Railway CLI:
```bash
npm install -g @railway/cli
railway login
```

### "relation already exists"
This is OK! The script uses `CREATE TABLE IF NOT EXISTS`, so it's safe to run multiple times.

### Still getting "column does not exist" errors
1. Verify you're connected to the correct environment:
   ```bash
   railway status
   ```

2. Check which tables exist:
   ```bash
   railway run -- psql $DATABASE_URL -c "\dt"
   ```

3. Check users table schema:
   ```bash
   railway run -- psql $DATABASE_URL -c "\d users"
   ```

   Should show `google_access_token`, `google_refresh_token`, and `google_token_expiry` columns.

## Environment Variables Required

Make sure your Railway environment has these variables set:

```
DATABASE_URL=postgresql://... (automatically set by Railway Postgres)
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_DRIVE_FOLDER_ID=...
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
JWT_SECRET=...
```

## Migration from Old Schema

If you have an existing database without OAuth columns:

```sql
-- Add OAuth columns to existing users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_refresh_token ON users(google_refresh_token);
```

This is what `migrations/004_add_oauth_tokens.sql` does.
