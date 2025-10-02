# Test Execution Guide

A practical guide for running tests in your daily development workflow.

---

## Quick Start (TL;DR)

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests
npm test

# Before merging: Run all tests with coverage
npm run test:coverage
```

---

## Understanding Test Dependencies

### Tests That Require Running Server ✅

**ALL current tests require a running development server** because they test actual agent API endpoints.

These tests make real HTTP requests to:
- `POST /api/chat` (all agent tests)
- Claude API (via server proxy)
- Redis (for conversation state)

**Why?** We're testing the complete integration: server → Claude API → response parsing → validation

---

### Tests That DON'T Require Server ❌

**Currently: None** - All 12 example tests are integration tests requiring the server.

**Future tests that won't need server**:
- Pure utility function tests (e.g., `anonymizeText()`, `parseXMLResponse()`)
- Validation logic tests (e.g., `checkETGEligibility()` direct calls)
- Fixture generator tests (test the fixture creation, not API calls)

**Example** (not yet implemented):
```javascript
// This would NOT require server
const { checkETGEligibility } = require('../../api/server');

test('Eligibility checker rejects seminars', () => {
  const result = checkETGEligibility({
    training_title: 'Leadership Seminar',
    training_type: 'seminar'
  });

  expect(result.eligible).toBe(false);
  expect(result.ineligible_type).toBe('seminar');
});
```

---

## Step-by-Step: Running Tests

### Step 1: Ensure Environment Variables Are Set

Create or verify `.env` file in project root:

```bash
# Required for tests
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
GOOGLE_DRIVE_FOLDER_ID=your-folder-id
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AxxxxXXXXxxxx

# Required for OAuth (not needed for tests)
GOOGLE_CLIENT_ID=xxxxx
GOOGLE_CLIENT_SECRET=xxxxx
JWT_SECRET=your-jwt-secret

# Optional: Custom test API URL (defaults to http://localhost:3000)
TEST_API_URL=http://localhost:3000
```

**Check if variables are set**:
```bash
node -e "require('dotenv').config(); console.log('✅ ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'Set' : 'Missing')"
```

---

### Step 2: Start Development Server

**Terminal 1** (keep this running):

```bash
npm run dev
```

**Expected output**:
```
Vercel CLI 28.x.x
Ready! Available at http://localhost:3000
```

**Verify server is running**:
```bash
# In another terminal
curl http://localhost:3000
# Should return HTML (not connection refused)
```

**Common issues**:
- **Port 3000 already in use**: Kill existing process or change port
- **Environment variables missing**: Check `.env` file exists
- **Dependencies not installed**: Run `npm install`

---

### Step 3: Run Tests

**Terminal 2** (while dev server runs in Terminal 1):

#### Run All Tests
```bash
npm test
```

Expected runtime: **5-10 minutes** (depends on number of tests and API response times)

#### Run Only Unit Tests (faster)
```bash
npm run test:unit
```

Expected runtime: **3-5 minutes**

#### Run Only Integration Tests (LLM-graded, slower)
```bash
npm run test:integration
```

Expected runtime: **3-5 minutes** (LLM grading is expensive)

#### Run Tests for Specific Agent
```bash
npm run test:agent canexport-claims  # CanExport Claims tests
npm run test:agent etg-writer         # ETG Writer tests
npm run test:agent grant-cards        # Grant Cards tests
npm run test:agent bcafe-writer       # BCAFE Writer tests
```

Expected runtime: **1-2 minutes per agent**

---

### Step 4: Review Test Results

#### Console Output

**Passing tests** (green):
```
✅ PASS tests/unit/canexport-claims-tax-calc.test.js
  CanExport Claims - Tax Calculation Accuracy
    HST Removal (13% in Ontario)
      ✓ Correctly removes HST from expense (245 ms)
    GST Removal (5% federal)
      ✓ Correctly removes GST from translation services (198 ms)
```

**Failing tests** (red):
```
❌ FAIL tests/unit/grant-cards-classification.test.js
  Grant Cards - Grant Type Classification Accuracy
    Hiring Grant Classification
      ✕ Correctly identifies wage subsidy program (312 ms)

  Expected: "Hiring Grant"
  Received: "Training Grant"
```

**Test Summary**:
```
Test Suites: 10 passed, 2 failed, 12 total
Tests:       68 passed, 12 failed, 80 total
Snapshots:   0 total
Time:        6.234 s
```

---

## Daily Development Workflow

### Workflow 1: Adding a New Feature

**Scenario**: You're adding support for a new expense category to CanExport Claims.

```bash
# 1. Switch to development branch
git checkout development
git pull

# 2. Create feature branch
git checkout -b feature/canexport-category-e

# 3. Make code changes to api/server.js
# (add Category E support)

# 4. Write test for new feature
# Create tests/unit/canexport-claims-category-e.test.js
```

```javascript
// tests/unit/canexport-claims-category-e.test.js
const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Category E Support', () => {
  test('Approves Category E expense', async () => {
    const expense = {
      vendor: 'Test Vendor',
      amount: 1000,
      tax: 50,
      category: 'E',
      description: 'New category E activity'
    };

    const result = await testExpenseAnalysis(expense);

    expect(result.verdict).toBe('APPROVED');
    expect(result.parsed.compliance_analysis).toMatch(/category\s*e/i);
  });
});
```

```bash
# 5. Start dev server (Terminal 1)
npm run dev

# 6. Run your new test (Terminal 2)
npm run test:agent canexport-claims

# 7. Fix any failures, re-run until passing

# 8. Run full test suite before committing
npm test

# 9. Commit if all tests pass
git add .
git commit -m "feat: Add Category E support to CanExport Claims with tests"
git push origin feature/canexport-category-e
```

---

### Workflow 2: Before Merging to Main

**Scenario**: Your feature is complete and you want to merge to main.

```bash
# 1. Ensure you're on your feature branch
git checkout feature/your-feature

# 2. Pull latest development changes
git checkout development
git pull
git checkout feature/your-feature
git merge development
# (resolve any conflicts)

# 3. Start dev server
npm run dev  # Terminal 1

# 4. Run FULL test suite with coverage
npm run test:coverage  # Terminal 2

# 5. Review coverage report
open tests/reports/coverage/index.html
# (or check tests/reports/coverage/lcov-report/index.html)

# 6. Ensure pass rate meets threshold
# - Unit tests: Should be 100% pass
# - Integration tests: Should be 95%+ pass
# - Overall: 95%+ pass rate required

# 7. If all tests pass, merge to development
git checkout development
git merge feature/your-feature
git push origin development

# 8. Create pull request to main (if using PR workflow)
# OR merge directly if you're the maintainer
```

---

### Workflow 3: Quick Smoke Test

**Scenario**: You made a small change and want to quickly verify nothing broke.

```bash
# 1. Start dev server (if not already running)
npm run dev

# 2. Run tests for affected agent only
npm run test:agent canexport-claims  # If you changed Claims code
npm run test:agent etg-writer         # If you changed ETG code

# 3. If tests pass, you're good to commit
```

---

## Understanding Test Failures

### Common Failure: Server Not Running

**Error**:
```
Error: connect ECONNREFUSED 127.0.0.1:3000
```

**Fix**:
```bash
# Start dev server in another terminal
npm run dev
```

---

### Common Failure: Environment Variable Missing

**Error**:
```
⚠️ Warning: Missing environment variables: ANTHROPIC_API_KEY
```

**Fix**:
```bash
# Check .env file exists and has required variables
cat .env | grep ANTHROPIC_API_KEY

# If missing, add to .env
echo 'ANTHROPIC_API_KEY=sk-ant-api03-xxxxx' >> .env
```

---

### Common Failure: API Rate Limit

**Error**:
```
Error: Request failed: 429 Too Many Requests
```

**Fix**:
```bash
# Wait 60 seconds and re-run
# OR reduce number of tests run at once

# Run one agent at a time instead of all
npm run test:agent canexport-claims
# (wait 30 seconds)
npm run test:agent etg-writer
```

---

### Common Failure: Test Timeout

**Error**:
```
Timeout - Async callback was not invoked within the 30000 ms timeout
```

**Reasons**:
- Server is slow to respond
- Claude API is slow
- Network issues

**Fix**:
```bash
# Re-run the specific test file
npm test -- tests/unit/grant-cards-classification.test.js

# If still fails, check:
# 1. Is dev server responding? (curl http://localhost:3000)
# 2. Is internet connection stable?
# 3. Is Claude API down? (check status.anthropic.com)
```

---

### Common Failure: LLM Grading Below Threshold

**Error**:
```
Expected quality score 3.2 to meet threshold 4.0 (gap: 0.8)
```

**Reasons**:
- Agent output quality degraded
- System prompt changed
- Test expectations too high

**Fix**:
```bash
# 1. Review the actual output (check console logs in test)
# 2. If output is actually good quality, adjust threshold
# 3. If output is poor quality, fix agent system prompt

# Run with verbose logging to see full output
npm test -- tests/integration/grant-cards-insights-quality.test.js --verbose
```

---

## Performance Benchmarks

### Expected Test Execution Times

**Full test suite** (`npm test`):
- **Fast**: 5-8 minutes (all tests passing, good network)
- **Slow**: 10-15 minutes (some retries, slower network)

**Unit tests only** (`npm run test:unit`):
- **Fast**: 3-5 minutes
- **Slow**: 6-8 minutes

**Integration tests only** (`npm run test:integration`):
- **Fast**: 2-3 minutes (3 test files, LLM grading)
- **Slow**: 4-6 minutes

**Single agent tests** (`npm run test:agent <name>`):
- **Fast**: 1-2 minutes
- **Slow**: 3-4 minutes

**Factors affecting speed**:
- Network latency to Claude API
- Redis response times (Upstash)
- Number of parallel tests running
- Agent response complexity
- LLM grading (slower than regular tests)

---

## Test Coverage Reports

### Generating Coverage

```bash
npm run test:coverage
```

This will:
1. Run all tests with coverage tracking
2. Generate reports in `tests/reports/coverage/`
3. Create HTML, LCOV, and text reports

### Viewing Coverage Report

**HTML Report** (recommended):
```bash
# Mac
open tests/reports/coverage/index.html

# Linux
xdg-open tests/reports/coverage/index.html

# Windows
start tests/reports/coverage/index.html
```

**Console Report**:
```bash
cat tests/reports/coverage/coverage.txt
```

### Understanding Coverage Metrics

**Coverage types**:
- **Line coverage**: % of code lines executed during tests
- **Branch coverage**: % of if/else branches executed
- **Function coverage**: % of functions called
- **Statement coverage**: % of statements executed

**Coverage targets**:
- **Critical code** (eligibility checker, tax calculations): 90%+
- **Agent endpoints**: 80%+
- **Utility functions**: 70%+
- **Overall project**: 60%+ (with focus on critical paths)

**Example coverage report**:
```
File                | % Stmts | % Branch | % Funcs | % Lines | Uncovered Lines
--------------------|---------|----------|---------|---------|----------------
api/server.js       |   67.23 |    54.12 |   71.43 |   68.45 | 234-245,389-401
utils/test-helpers  |   89.32 |    78.56 |   92.11 |   90.12 | 45-47
```

---

## Continuous Integration (CI) Setup

### Running Tests in CI (GitHub Actions Example)

If you want to run tests automatically on every push:

**Create `.github/workflows/test.yml`**:

```yaml
name: Run Tests

on:
  push:
    branches: [ development, main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '22'

    - name: Install dependencies
      run: npm install

    - name: Start dev server
      run: npm run dev &
      env:
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
        UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}

    - name: Wait for server
      run: npx wait-on http://localhost:3000

    - name: Run tests
      run: npm test
      env:
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
        UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}

    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./tests/reports/coverage/lcov.info
```

**Add secrets to GitHub**:
1. Go to repository Settings → Secrets and variables → Actions
2. Add secrets: `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

---

## Debugging Failing Tests

### Enable Verbose Logging

```bash
# Run with verbose output
npm test -- --verbose

# Run specific test file with debug output
DEBUG=* npm test -- tests/unit/canexport-claims-tax-calc.test.js
```

### Inspect API Responses

Add console.log to test to see full response:

```javascript
test('Debug failing test', async () => {
  const result = await testExpenseAnalysis(expense);

  console.log('Full response:', JSON.stringify(result, null, 2));
  console.log('Parsed verdict:', result.parsed.verdict);
  console.log('Raw content:', result.rawResponse);

  expect(result.verdict).toBe('APPROVED');
});
```

### Run Single Test

```bash
# Run only one test file
npm test -- tests/unit/canexport-claims-tax-calc.test.js

# Run only one test within a file (add .only to test)
```

```javascript
test.only('This test will run', async () => {
  // Only this test runs
});

test('This test will be skipped', async () => {
  // Skipped
});
```

### Check Server Logs

Watch dev server logs (Terminal 1) while tests run to see:
- API requests being made
- Errors from server
- Claude API responses

---

## Best Practices

### ✅ DO:

1. **Run tests before committing**
   ```bash
   npm test
   # Wait for all tests to pass
   git commit -m "..."
   ```

2. **Write tests for new features**
   - Add test file in `tests/unit/` or `tests/integration/`
   - Follow existing patterns (see `WRITING-TESTS.md`)
   - Run tests to verify they pass

3. **Run specific agent tests when working on that agent**
   ```bash
   # Working on ETG agent? Run ETG tests frequently
   npm run test:agent etg-writer
   ```

4. **Keep dev server running**
   - Start once, leave running
   - Faster test execution
   - Re-run tests quickly

5. **Check coverage before major releases**
   ```bash
   npm run test:coverage
   open tests/reports/coverage/index.html
   ```

---

### ❌ DON'T:

1. **Don't commit failing tests**
   - All tests must pass before pushing
   - Fix or skip failing tests

2. **Don't skip tests to make them pass**
   ```javascript
   // Bad - hides real issues
   test.skip('Fix this later', async () => {
     // Skipped test
   });
   ```

3. **Don't run tests without server running**
   - Tests will fail with ECONNREFUSED
   - Always start `npm run dev` first

4. **Don't modify test helpers without testing**
   - Changes to `test-helpers.js` affect all tests
   - Run full suite after modifying utilities

5. **Don't ignore LLM grading failures**
   - If quality score drops, investigate
   - Agent output quality may have degraded

---

## Troubleshooting Checklist

Before asking for help, check:

- [ ] Dev server is running (`npm run dev`)
- [ ] Environment variables are set (`.env` file exists)
- [ ] Dependencies are installed (`npm install`)
- [ ] Tests are running from project root directory
- [ ] No other process using port 3000
- [ ] Internet connection is stable
- [ ] Claude API is operational (status.anthropic.com)
- [ ] Redis instance is operational (Upstash dashboard)

---

## FAQ

### Q: How long should tests take to run?
**A**: Full suite: 5-10 minutes. Single agent: 1-2 minutes.

### Q: Can I run tests in parallel?
**A**: Yes, Jest runs tests in parallel by default. But be aware of API rate limits.

### Q: Do I need to restart the dev server between test runs?
**A**: No, keep it running. Tests will connect to the same server instance.

### Q: What if a test is flaky (passes sometimes, fails others)?
**A**: This indicates non-deterministic behavior. Check:
- Is the agent using `temperature=0` for deterministic responses?
- Is the test checking exact wording (bad) or key facts (good)?
- Does the test have proper timeouts?

### Q: Can I run tests in production?
**A**: **NO.** Tests are for development only. They:
- Make real API calls (costs money)
- Modify conversation state in Redis
- Require Claude API access
- Are not designed for production monitoring

### Q: How do I add a test that doesn't require the server?
**A**: Test pure functions directly:
```javascript
const { anonymizeText } = require('../utils/fixture-generator');

test('Anonymizes email addresses', () => {
  const result = anonymizeText('Contact: john@example.com');
  expect(result).toBe('Contact: [EMAIL]');
  // No server needed!
});
```

---

## Summary: Daily Workflow Commands

```bash
# Morning: Pull latest changes
git checkout development
git pull

# Start dev server (leave running all day)
npm run dev  # Terminal 1

# While developing: Run tests frequently
npm run test:agent <agent-name>  # Terminal 2

# Before committing: Run full suite
npm test

# Before merging: Run with coverage
npm run test:coverage

# End of day: Stop dev server
# Ctrl+C in Terminal 1
```

---

**Last Updated**: October 2, 2025
**Framework Version**: 1.0
**Questions?** See `tests/README.md` or `tests/WRITING-TESTS.md`
