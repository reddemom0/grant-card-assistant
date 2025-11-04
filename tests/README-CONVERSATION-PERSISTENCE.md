# Conversation Persistence Testing Guide

This guide explains how to test the conversation persistence system with Postgres.

## Overview

The conversation persistence system has three layers of tests:

1. **Unit Tests** (`tests/unit/database-messages.test.js`) - Test database operations directly
2. **Integration Tests** (`tests/integration/conversation-api.test.js`) - Test API endpoints
3. **End-to-End Tests** (included in integration) - Test full user flow

## Prerequisites

### 1. Database Setup

Ensure you have a Postgres database configured with the conversation schema:

```bash
# Option A: Use local Postgres
export DATABASE_URL="postgresql://user:password@localhost:5432/grant_card_assistant"

# Option B: Use Railway Postgres (testing against production)
export DATABASE_URL="postgresql://..."
```

The schema will be automatically created by the auto-migrate system when you first run the server or tests.

### 2. Environment Variables

Create a `.env` file with required variables:

```env
# Database
DATABASE_URL=postgresql://...

# Claude API (for integration tests)
ANTHROPIC_API_KEY=sk-ant-...

# Authentication (for API tests)
JWT_SECRET=your-jwt-secret

# Optional: Test auth cookie
TEST_AUTH_COOKIE=granted_session=your_test_jwt_token

# Test API endpoint
TEST_API_URL=http://localhost:3000
```

### 3. Start the Server

For integration tests, you need a running server:

```bash
npm start
```

The server should be accessible at `http://localhost:3000`.

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Unit Tests Only

```bash
npm run test:unit
```

This will run the database operation tests:
- Conversation creation
- Message saving and retrieval
- Conversation listing
- Conversation deletion
- Edge cases (long messages, special characters, rapid saves)

### Run Integration Tests Only

```bash
npm run test:integration
```

This will run the API endpoint tests:
- POST /api/chat (conversation creation)
- GET /api/conversations/:id (load conversation)
- GET /api/conversations (list conversations)
- DELETE /api/conversations/:id (delete conversation)
- End-to-end conversation flow

### Run with Coverage

```bash
npm run test:coverage
```

Generates coverage report for all conversation-related code.

### Run Specific Test File

```bash
# Database unit tests
npx jest tests/unit/database-messages.test.js

# API integration tests
npx jest tests/integration/conversation-api.test.js
```

## Test Authentication

### Getting a Test Auth Cookie

API integration tests require authentication. You have two options:

**Option 1: Use a test JWT token**

Generate a JWT token for testing:

```javascript
// In Node.js console or test script
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    id: 999, // Test user ID
    email: 'test@example.com',
    name: 'Test User'
  },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

console.log('granted_session=' + token);
```

Add this to your `.env`:

```env
TEST_AUTH_COOKIE=granted_session=eyJhbGc...
```

**Option 2: Login and extract cookie**

1. Login to the application via Google OAuth
2. Open browser DevTools → Application → Cookies
3. Copy the `granted_session` cookie value
4. Add to `.env` as above

### Running Tests Without Authentication

If you don't have an auth cookie, the integration tests will skip API tests with a warning:

```
⚠️  No TEST_AUTH_COOKIE found - API tests will be skipped
```

The database unit tests will still run since they don't require authentication.

## Test Structure

### Unit Tests (`database-messages.test.js`)

Tests database operations in isolation:

```javascript
describe('Database Messages Operations', () => {
  describe('Conversation Creation', () => {
    // Creates conversations, handles duplicates
  });

  describe('Message Saving', () => {
    // Saves user/assistant messages with content blocks
  });

  describe('Message Retrieval', () => {
    // Retrieves messages, filters thinking blocks
  });

  describe('List Conversations', () => {
    // Lists conversations, filters by agent type
  });

  describe('Edge Cases', () => {
    // Long messages, special characters, rapid saves
  });
});
```

### Integration Tests (`conversation-api.test.js`)

Tests full API endpoints:

```javascript
describe('Conversation API Integration', () => {
  describe('POST /api/chat', () => {
    // Creates conversations, validates input
  });

  describe('GET /api/conversations/:id', () => {
    // Loads conversations with messages
  });

  describe('GET /api/conversations', () => {
    // Lists user conversations, filters by agent
  });

  describe('DELETE /api/conversations/:id', () => {
    // Deletes conversations
  });

  describe('End-to-End Flow', () => {
    // Complete user journey: create → message → load → delete
  });
});
```

## Expected Test Results

### All Tests Passing

```
 PASS  tests/unit/database-messages.test.js
  ✓ should create a new conversation (125ms)
  ✓ should save a user message (89ms)
  ✓ should retrieve all messages (76ms)
  ✓ should list conversations for a user (103ms)
  ✓ should delete a conversation (92ms)
  ... 20+ more tests

 PASS  tests/integration/conversation-api.test.js
  ✓ should create new conversation on first message (3542ms)
  ✓ should load conversation with messages (234ms)
  ✓ should list user conversations (189ms)
  ✓ should delete a conversation (412ms)
  ✓ E2E: complete conversation flow (8763ms)

Test Suites: 2 passed, 2 total
Tests:       35 passed, 35 total
Time:        24.567s
```

### Tests with Warnings (No Auth)

```
 PASS  tests/unit/database-messages.test.js
  ... all pass ...

 PASS  tests/integration/conversation-api.test.js
  ⚠️  No TEST_AUTH_COOKIE found - API tests will be skipped
  ⚠️  Skipping test - no auth cookie (x10)

Test Suites: 2 passed, 2 total
Tests:       25 passed, 10 skipped, 35 total
```

## Troubleshooting

### "Cannot connect to database"

**Cause**: Database URL not configured or database not accessible

**Fix**:
1. Check `DATABASE_URL` in `.env`
2. Ensure database is running
3. Test connection: `psql $DATABASE_URL`

### "Table conversations does not exist"

**Cause**: Database schema not created

**Fix**:
1. Run the server once to trigger auto-migration:
   ```bash
   npm start
   ```
2. Or manually run migration:
   ```bash
   psql $DATABASE_URL < migrations/000_initial_schema.sql
   ```

### "401 Unauthorized" in integration tests

**Cause**: Missing or invalid auth cookie

**Fix**:
1. Generate test JWT token (see "Test Authentication" above)
2. Add to `.env` as `TEST_AUTH_COOKIE`
3. Ensure `JWT_SECRET` matches between test token and server

### "Tests timeout"

**Cause**: Server not running or slow database

**Fix**:
1. Start server: `npm start`
2. Check server is accessible: `curl http://localhost:3000/health`
3. Increase timeout in tests (default 60s for integration)

### "Messages contain thinking blocks"

**Expected**: Our system filters thinking blocks when loading from database

**Check**: Verify `getConversationMessages` in `src/database/messages.js` filters blocks with type `thinking` or `redacted_thinking`

## Testing on Railway

To test against the Railway production database:

1. Get the Railway database URL:
   ```bash
   # In Railway dashboard: project → Postgres → Variables
   export DATABASE_URL="postgresql://..."
   ```

2. Set Railway API endpoint:
   ```env
   TEST_API_URL=https://grant-card-assistant-production.up.railway.app
   ```

3. Run tests:
   ```bash
   npm run test:integration
   ```

**⚠️ Warning**: This will create real data in production database. Use a test user account.

## Continuous Integration

To run these tests in CI/CD:

```yaml
# .github/workflows/test.yml
name: Test Conversation Persistence

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm install

      - name: Run database tests
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          JWT_SECRET: test-secret
        run: npm run test:unit

      - name: Start server
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          JWT_SECRET: test-secret
        run: npm start &

      - name: Wait for server
        run: sleep 10

      - name: Run API tests
        env:
          TEST_API_URL: http://localhost:3000
          TEST_AUTH_COOKIE: ${{ secrets.TEST_AUTH_COOKIE }}
        run: npm run test:integration
```

## Writing New Tests

### Add a Database Test

```javascript
// tests/unit/database-messages.test.js

test('should handle my new feature', async () => {
  const convId = crypto.randomUUID();
  await createConversation(convId, TEST_USER_ID, 'etg-writer', 'Test');

  // Your test logic here
  const result = await myNewFunction(convId);

  expect(result).toBeDefined();
}, 10000);
```

### Add an API Test

```javascript
// tests/integration/conversation-api.test.js

test('should test my new endpoint', async () => {
  if (!authCookie) {
    console.log('⚠️  Skipping test - no auth cookie');
    return;
  }

  const response = await fetch(`${API_BASE}/api/my-endpoint`, {
    headers: { 'Cookie': authCookie }
  });

  expect(response.ok).toBe(true);
  const data = await response.json();
  expect(data).toHaveProperty('result');
}, TEST_TIMEOUT);
```

## Performance Benchmarks

Expected performance on standard hardware:

| Operation | Expected Time | Warning Threshold |
|-----------|--------------|-------------------|
| Create conversation | < 100ms | > 500ms |
| Save message | < 100ms | > 500ms |
| Load conversation | < 200ms | > 1000ms |
| List conversations (50) | < 300ms | > 1500ms |
| Delete conversation | < 150ms | > 750ms |

If tests exceed warning thresholds, check:
- Database connection latency
- Database indexes are present
- Connection pool is not exhausted

## Questions?

If you encounter issues not covered here:

1. Check server logs: `npm start`
2. Check database logs: `psql $DATABASE_URL`
3. Run tests with verbose output: `npm test -- --verbose`
4. Check Railway logs in dashboard

For further help, consult the main project documentation or reach out to the development team.
