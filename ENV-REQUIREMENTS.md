# Environment Variables Required

## Current Variables (Already Configured)
- `ANTHROPIC_API_KEY` - Claude AI API key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth secret
- `GOOGLE_DRIVE_FOLDER_ID` - Knowledge base folder ID
- `GOOGLE_SERVICE_ACCOUNT_KEY` - Service account JSON (for Drive access)
- `UPSTASH_REDIS_REST_URL` - Redis connection URL
- `UPSTASH_REDIS_REST_TOKEN` - Redis auth token
- `JWT_SECRET` - JWT token signing secret
- `TEAM_PASSWORD` - Legacy password (JWT auth is primary)

## New Variable Required for Database Persistence
- `POSTGRES_URL` - PostgreSQL connection string from Neon

### How to Get POSTGRES_URL:
1. Log into your Neon dashboard at https://console.neon.tech
2. Select your project
3. Go to "Dashboard" or "Connection Details"
4. Copy the connection string (format: `postgresql://user:password@host/database`)
5. Add to your `.env` file:
   ```
   POSTGRES_URL=postgresql://your-connection-string
   ```

### Database Setup Steps:
1. Ensure `POSTGRES_URL` is in `.env` file
2. Run: `npm run db:setup`
3. Verify tables are created (conversations, messages)

### Vercel Environment Variables:
For production deployment, add `POSTGRES_URL` to Vercel:
1. Go to project settings in Vercel dashboard
2. Navigate to Environment Variables
3. Add `POSTGRES_URL` with your production database URL
4. Redeploy
