# Grant Card Assistant - Testing Framework

Automated testing framework for the Grant Card Assistant AI Hub, testing 4 operational agents across their core capabilities with both code-based validation and LLM-based quality evaluation.

---

## Quick Start

### Prerequisites

1. **Node.js 22.x** installed
2. **Environment variables** configured in `.env`:
   - `ANTHROPIC_API_KEY` - For Claude API calls and LLM grading
   - `GOOGLE_DRIVE_FOLDER_ID` - Root knowledge base folder
   - `GOOGLE_SERVICE_ACCOUNT_KEY` - Service account JSON for Drive access
   - `UPSTASH_REDIS_REST_URL` - Redis instance URL
   - `UPSTASH_REDIS_REST_TOKEN` - Redis authentication token
   - `TEST_API_URL` (optional) - API endpoint for testing (default: `http://localhost:3000`)

3. **Install dependencies**:
```bash
npm install
```

---

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Unit Tests Only
```bash
npm run test:unit
```

### Run Integration Tests Only
```bash
npm run test:integration
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Tests for Specific Agent
```bash
npm run test:agent canexport-claims
npm run test:agent etg-writer
npm run test:agent grant-cards
npm run test:agent bcafe-writer
```

### Generate Test Report
```bash
npm run test:report
```

---

## Generating Test Fixtures

Fixtures are automatically generated from knowledge base documents stored in Google Drive.

### Generate All Fixtures
```bash
npm run fixtures:generate all
```

### Generate Fixtures for Specific Agent
```bash
npm run fixtures:generate canexport-claims
npm run fixtures:generate etg-writer
npm run fixtures:generate grant-cards
npm run fixtures:generate bcafe-writer
```

### Limit Number of Files Processed
```bash
npm run fixtures:generate etg-writer --limit 5
```

**What the fixture generator does:**
- Connects to Google Drive using service account
- Downloads documents from agent-specific folders
- Extracts text from PDF, DOCX, and TXT files
- Anonymizes sensitive data (emails, phone numbers, postal codes)
- Categorizes documents by type (e.g., "approved-expense", "eligible-training")
- Saves fixtures to `tests/fixtures/<agent-type>/` directory

---

## Directory Structure

```
tests/
├── unit/                  # Unit tests for individual functions
├── integration/           # Integration tests for multi-step workflows
├── fixtures/              # Test data generated from knowledge base
│   ├── canexport-claims/  # CanExport Claims fixtures
│   ├── etg-writer/        # ETG Writer fixtures
│   ├── grant-cards/       # Grant Cards fixtures
│   └── bcafe-writer/      # BCAFE Writer fixtures
├── utils/                 # Testing utilities
│   ├── test-helpers.js    # API wrappers and parsing utilities
│   ├── llm-grader.js      # LLM-as-judge quality evaluation
│   ├── evaluation-metrics.js  # Statistical analysis and scoring
│   └── fixture-generator.js   # Fixture auto-generation from knowledge base
├── reports/               # Test results and coverage reports
├── jest.config.js         # Jest configuration
├── setup.js               # Test environment setup
└── run-tests.js           # Test runner CLI
```

---

## Agents Under Test

### 1. CanExport Claims Agent (`canexport-claims`)
**Function**: Audit expense claims for CanExport SME program compliance

**Test Coverage**:
- Tax calculation accuracy (HST, GST removal)
- Expense categorization (Categories A-H)
- Rejection pattern detection
- Web search usage (limited to 3 searches, .gc.ca domains)
- Documentation requirement identification
- Verdict formulation (Approve/Conditional/Reject)

**Example Tests**:
- Tax removal validation
- Category assignment accuracy
- Historical rejection pattern matching
- Compliance score calculation

---

### 2. ETG Writer Agent (`etg-writer`)
**Function**: Create BC Employer Training Grant business cases

**Test Coverage**:
- Eligibility checker accuracy (keyword detection)
- Business case completeness
- "Better job" outcome definitions
- Ineligible keyword detection (seminar, conference, degree)

**Example Tests**:
- Eligible training approval
- Ineligible training rejection
- All 5 ineligible keywords detected correctly
- Business case structure validation

---

### 3. Grant Cards Agent (`grant-cards`)
**Function**: Extract grant criteria and create structured grant cards

**Test Coverage** (6 task types):
- Grant type classification (6 types)
- Field extraction completeness
- Preview description generation
- General requirements section
- Granted Insights quality
- Categories & tags assignment
- Missing information identification

**Example Tests**:
- Classification consistency across runs
- Strategic insight quality (LLM-graded)
- Format compliance (XML structure)
- Completeness validation

---

### 4. BCAFE Writer Agent (`bcafe-writer`)
**Function**: Create BC Agriculture and Food Export Program applications

**Test Coverage**:
- Cash match calculation (50% vs 30%)
- Merit optimization strategies
- Eligibility verification
- Budget template compliance

**Example Tests**:
- Producer cash match (50%)
- Association cash match (30%)
- Funding amount calculations
- Application structure validation

---

## Test Categories

### Category A: Structural Validation (Code-based)
**What**: Output structure, required fields, format compliance

**Evaluation**: Regex parsing, JSON schema validation, field presence checks

**Pass Criteria**: 100% of required fields present

**Example**:
```javascript
test('CanExport Claims response contains all XML sections', async () => {
  const response = await testExpenseAnalysis(expense);

  expect(response.rawResponse).toContainXMLTags([
    'thinking',
    'expense_summary',
    'compliance_analysis',
    'verdict',
    'recommendations'
  ]);
});
```

---

### Category B: Accuracy & Compliance (Code-based + LLM hybrid)
**What**: Factual correctness, rule compliance, calculation accuracy

**Evaluation**: Mathematical validation, keyword detection, classification logic

**Pass Criteria**: 95%+ accuracy on known test cases

**Example**:
```javascript
test('Tax calculation removes HST correctly', async () => {
  const expense = { amount: 1130, tax: 130, taxType: 'HST' };
  const result = await testExpenseAnalysis(expense);

  expect(result.taxRemoved).toBe(130);
  expect(result.eligibleAmount).toBe(1000);
  expect(result.estimatedReimbursement).toBe(500); // 50%
});
```

---

### Category C: Quality & Strategic Value (LLM-based)
**What**: Tone, persuasiveness, strategic insight quality, professional writing

**Evaluation**: LLM-as-judge with Claude Sonnet 4.5 using grading rubrics

**Pass Criteria**: Average score ≥4.0 (on 1-5 scale)

**Example**:
```javascript
test('Granted Insights meet quality threshold', async () => {
  const response = await generateGrantCard(fixture, 'insights');

  const grading = await gradeWithLLM({
    task: 'Evaluate strategic value of Granted Insights',
    output: response.insights,
    rubric: createInsightRubric()
  });

  expect(grading).toMeetQualityThreshold(4.0);
});
```

---

### Category D: Consistency (Code-based)
**What**: Same inputs produce similar outputs across runs

**Evaluation**: Run tests 3+ times, calculate variance

**Pass Criteria**: Core factual elements 100% consistent, CV ≤5% for numeric values

**Example**:
```javascript
test('Grant type classification is consistent', async () => {
  const runs = await Promise.all([
    testGrantCardClassification(fixture),
    testGrantCardClassification(fixture),
    testGrantCardClassification(fixture)
  ]);

  const grantTypes = runs.map(r => r.grantType);
  expect(grantTypes[0]).toBe(grantTypes[1]);
  expect(grantTypes[1]).toBe(grantTypes[2]);
});
```

---

### Category E: Edge Cases & Error Handling (Code-based)
**What**: Graceful handling of incomplete data, malformed inputs

**Evaluation**: Error message validation, fallback behavior checks

**Pass Criteria**: No crashes, helpful error messages, clear guidance

**Example**:
```javascript
test('Missing tax information triggers warning', async () => {
  const expense = { vendor: 'Test', amount: 1000, tax: null };
  const result = await testExpenseAnalysis(expense);

  expect(result.warnings).toContain('Tax information missing');
  expect(result.verdict).toBe('CONDITIONAL');
});
```

---

## Test Utilities

### test-helpers.js
**Core Functions**:
- `sendMessageToAgent(agentType, message, options)` - Send message to agent
- `parseXMLResponse(response, tags)` - Extract XML sections
- `extractThinking(response)` - Separate thinking from main content
- `validateRequiredFields(parsed, fields)` - Check field completeness
- `loadFixture(filename, category)` - Load test fixture

**Agent-Specific Functions**:
- `testGrantCardClassification(document)` - Test grant type classification
- `testExpenseAnalysis(expense)` - Test expense auditing
- `testETGEligibility(training)` - Test training eligibility
- `testBCAFEFunding(scenario)` - Test funding calculations

---

### llm-grader.js
**Core Functions**:
- `gradeWithLLM(params)` - Grade output using Claude API
- `gradeMultiple(tasks)` - Batch grading with aggregate statistics
- `validateGradingThreshold(result, threshold)` - Check if score meets minimum

**Standard Rubrics**:
- `createGrantWritingRubric()` - For grant cards and applications
- `createComplianceRubric()` - For compliance analysis
- `createInsightRubric()` - For strategic insights

**Grading Scale**: 1-5 where 1=Poor, 5=Excellent

---

### evaluation-metrics.js
**Core Functions**:
- `calculateStats(values)` - Mean, median, min, max, stdDev
- `calculateConsistency(values)` - Coefficient of variation
- `checkConsistencyThreshold(values, maxVariance)` - Validate consistency
- `calculatePassRate(results)` - Overall pass percentage
- `calculateAccuracy(results)` - Classification accuracy
- `detectOutliers(values)` - Identify anomalies using IQR
- `calculateConfusionMatrix(results)` - Binary classification metrics
- `detectRegressions(baseline, current)` - Compare test runs

---

### fixture-generator.js
**Core Functions**:
- `generateFixturesForAgent(agentType, options)` - Generate all fixtures for agent
- `generateAllFixtures(options)` - Generate fixtures for all agents
- `loadFixtures(agentType, category)` - Load saved fixtures
- `anonymizeText(text)` - Remove sensitive data
- `categorizeDocument(filename, content, agentType)` - Auto-categorize

**Options**:
- `limit` - Max files to process
- `anonymize` - Enable/disable anonymization (default: true)
- `maxLength` - Max characters per fixture (default: 10000)

---

## Custom Jest Matchers

The framework includes custom matchers for common assertions:

### `.toBeApproximately(expected, tolerance)`
Check numeric equality with tolerance:
```javascript
expect(result.amount).toBeApproximately(1000, 0.01);
```

### `.toContainXMLTags(tags)`
Validate XML structure:
```javascript
expect(response).toContainXMLTags(['thinking', 'verdict', 'recommendations']);
```

### `.toMeetQualityThreshold(threshold)`
Check LLM grading score:
```javascript
expect(grading).toMeetQualityThreshold(4.0);
```

### `.toBeConsistent(maxVariance)`
Validate consistency across runs:
```javascript
const scores = [4.2, 4.3, 4.1, 4.2];
expect(scores).toBeConsistent(5); // CV must be ≤5%
```

---

## Success Metrics

### Coverage Targets
- **CanExport Claims**: 100% coverage of expense categories A-H
- **ETG Writer**: 100% coverage of eligibility checker logic
- **Grant Cards**: 100% coverage of 6 task types
- **BCAFE Writer**: 100% coverage of funding calculation scenarios

### Quality Benchmarks
- **Structural Tests**: 100% pass rate (no malformed outputs)
- **Accuracy Tests**: 95%+ pass rate
- **Quality Tests**: 4.0+ average LLM grade (on 1-5 scale)
- **Consistency Tests**: ≤5% coefficient of variation
- **Edge Case Tests**: 100% graceful error handling

### Performance Targets
- **Unit test suite**: Completes in <5 minutes
- **Full test suite**: Completes in <30 minutes
- **Test flakiness**: <2% (passes 98+ times out of 100)

---

## Writing New Tests

See [WRITING-TESTS.md](./WRITING-TESTS.md) for detailed guide on:
- Test file naming conventions
- Writing unit tests vs integration tests
- Using test utilities effectively
- Creating LLM-based quality tests
- Handling async operations
- Best practices and patterns

---

## Test Reports

### HTML Report
Generated in `tests/reports/test-report.html` with:
- Overall pass/fail summary
- Test breakdown by agent
- Failed test details
- Coverage metrics

### Coverage Report
Generated in `tests/reports/coverage/` with:
- Line coverage by file
- Branch coverage
- Function coverage
- Uncovered lines highlighted

### Console Output
Real-time colored output showing:
- ✅ Passed tests (green)
- ❌ Failed tests (red)
- ⚠️ Warnings (yellow)
- Test duration and statistics

---

## Troubleshooting

### Tests failing with "Request timeout"
**Cause**: API calls taking too long

**Solution**: Increase timeout in `jest.config.js`:
```javascript
testTimeout: 60000 // 60 seconds
```

### Fixture generation fails with "Folder not found"
**Cause**: Agent folder doesn't exist in Google Drive or wrong folder ID

**Solution**:
1. Verify `GOOGLE_DRIVE_FOLDER_ID` in `.env`
2. Check agent folder names match `AGENT_FOLDER_MAP` in `api/server.js`
3. Ensure service account has access to folders

### LLM grading tests are expensive
**Cause**: Using expensive model (e.g., Opus) for grading

**Solution**: Configure faster model in `llm-grader.js`:
```javascript
const DEFAULT_GRADING_MODEL = 'claude-sonnet-4.5-20250929'; // Already optimized
```

### Tests are flaky (pass sometimes, fail other times)
**Cause**: Non-deterministic AI responses

**Solution**:
1. Use `temperature: 0` in API calls (already set)
2. Test core facts, not exact wording
3. Run consistency tests to measure variance
4. If CV >5%, investigate test design

---

## Contributing

When adding new tests:
1. Place unit tests in `tests/unit/`
2. Place integration tests in `tests/integration/`
3. Name files: `<agent-name>-<capability>.test.js`
4. Use test helpers for API calls
5. Include both happy path and edge cases
6. Document expected behavior in test descriptions
7. Ensure tests are deterministic and don't rely on external state

---

## API

For programmatic usage:

```javascript
const { testExpenseAnalysis } = require('./utils/test-helpers');
const { gradeWithLLM } = require('./utils/llm-grader');
const { calculateStats } = require('./utils/evaluation-metrics');

// Test an expense
const result = await testExpenseAnalysis({
  vendor: 'Test Vendor',
  amount: 1000,
  tax: 130,
  category: 'B'
});

// Grade quality
const grading = await gradeWithLLM({
  task: 'Evaluate this content',
  output: result.rawResponse,
  rubric: createComplianceRubric()
});

// Analyze results
const stats = calculateStats([4.2, 4.3, 4.1, 4.2]);
console.log(`Mean quality score: ${stats.mean}`);
```

---

## Support

For issues or questions:
1. Check this README and [WRITING-TESTS.md](./WRITING-TESTS.md)
2. Review example tests in `tests/unit/` and `tests/integration/`
3. Check console output for error messages
4. Verify environment variables are set correctly

---

**Last Updated**: 2025-10-02
**Framework Version**: 1.0
**Status**: Phase 1 Complete (Infrastructure)
