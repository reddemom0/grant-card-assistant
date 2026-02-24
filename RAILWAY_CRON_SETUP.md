# Railway Cron Job Setup for Lead-Gen Finalization

Railway doesn't support traditional cron syntax. Instead, you need to use one of these approaches:

## Option 1: External Cron Service (Recommended)

Use a service like **Cron-job.org** or **EasyCron** to hit a webhook endpoint every 10 minutes:

1. Create endpoint in server.js:
```javascript
app.post('/api/admin/run-finalization', authenticateUser, async (req, res) => {
  const { finalizeInactiveSessions } = await import('./src/api/lead-gen-finalization.js');
  const result = await finalizeInactiveSessions(5, 50);
  res.json(result);
});
```

2. Set up external cron:
- URL: `https://grant-card-assistant-production.up.railway.app/api/admin/run-finalization`
- Schedule: `*/10 * * * *` (every 10 minutes)
- Method: POST
- Headers: `Authorization: Bearer <JWT_TOKEN>`

## Option 2: Railway Cron Service (Beta)

Create a separate Railway service for the cron job:

```bash
railway service create lead-gen-cron
railway up --service lead-gen-cron
```

Set start command to:
```bash
while true; do node scripts/finalize-inactive-lead-gen.js && sleep 600; done
```

## Option 3: Node-cron (In-process)

Add to server.js startup:

```javascript
import cron from 'node-cron';

// Run finalization every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  console.log('Running scheduled finalization...');
  const { finalizeInactiveSessions } = await import('./src/api/lead-gen-finalization.js');
  await finalizeInactiveSessions(5, 50);
});
```

Requires: `npm install node-cron`

**Recommended: Option 3 (node-cron)** - Simple, runs in the same process, no external dependencies.
