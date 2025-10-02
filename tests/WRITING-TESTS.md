# Writing Tests for Grant Card Assistant

A practical guide to adding new tests as you build features for the AI Hub agents.

---

## Philosophy

**Tests should be easy to write and maintain.** When you build a new feature, adding tests should feel natural, not burdensome. This framework provides utilities that make testing AI agents as simple as testing regular functions.

**Test what matters.** Focus on:
- ✅ Core functionality works correctly
- ✅ Edge cases are handled gracefully
- ✅ Quality meets professional standards
- ❌ Don't test exact wording (AI is non-deterministic)
- ❌ Don't over-test internal implementation details

---

## Quick Start: Your First Test

Let's write a test for the CanExport Claims agent's tax calculation:

### Step 1: Create test file

```javascript
// tests/unit/canexport-claims-tax-calc.test.js

const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Tax Calculation', () => {

  test('Removes HST (13%) from Ontario expense', async () => {
    const expense = {
      vendor: 'Test Vendor',
      amount: 1130,
      tax: 130,
      taxType: 'HST',
      province: 'ON',
      category: 'B',
      description: 'Marketing materials'
    };

    const result = await testExpenseAnalysis(expense);

    expect(result.taxRemoved).toBe(130);
    expect(result.eligibleAmount).toBe(1000);
    expect(result.estimatedReimbursement).toBe(500); // 50% of $1000
  });

});
```

### Step 2: Run the test

```bash
npm run test:unit
```

That's it! The test helper handles API calls, parsing, and response extraction for you.

---

## Test File Organization

### Naming Convention

```
tests/
├── unit/
│   └── <agent-name>-<capability>.test.js
└── integration/
    └── <agent-name>-<workflow>.test.js
```

**Examples**:
- `canexport-claims-tax-calc.test.js` - Unit test for tax calculations
- `etg-writer-eligibility.test.js` - Unit test for eligibility checker
- `grant-cards-classification.test.js` - Unit test for grant type classification
- `canexport-claims-full-workflow.test.js` - Integration test for end-to-end expense analysis

### File Structure Template

```javascript
// Import test helpers
const { testAgentFunction } = require('../utils/test-helpers');
const { gradeWithLLM } = require('../utils/llm-grader');
const { loadFixture } = require('../utils/fixture-generator');

// Describe the test suite
describe('Agent Name - Capability Being Tested', () => {

  // Group related tests
  describe('Specific Functionality', () => {

    test('Happy path: what should work', async () => {
      // Arrange: Set up test data
      const input = { /* ... */ };

      // Act: Call the agent
      const result = await testAgentFunction(input);

      // Assert: Verify results
      expect(result.something).toBe(expected);
    });

    test('Edge case: unusual but valid input', async () => {
      // ...
    });

    test('Error case: invalid input handled gracefully', async () => {
      // ...
    });

  });

});
```

---

## Using Test Helpers

Test helpers abstract away the complexity of API calls and response parsing.

### Available Helpers

#### 1. `sendMessageToAgent(agentType, message, options)`

Generic message sender for any agent:

```javascript
const { sendMessageToAgent } = require('../utils/test-helpers');

test('Send custom message to agent', async () => {
  const response = await sendMessageToAgent(
    'etg-writer',
    'What makes a training eligible for ETG?',
    {
      conversationId: 'test-conv-123', // Optional: maintain conversation
      timeout: 30000 // Optional: custom timeout
    }
  );

  expect(response.content).toContain('eligible');
  expect(response.conversationId).toBe('test-conv-123');
});
```

#### 2. Agent-Specific Helpers

Pre-configured for common agent tasks:

**Grant Cards Classification**:
```javascript
const { testGrantCardClassification } = require('../utils/test-helpers');

test('Classify hiring grant correctly', async () => {
  const grantDoc = `
    Wage Subsidy Program for Small Businesses
    Funding: Up to $50,000 for hiring new employees
    Deadline: March 31, 2026
  `;

  const result = await testGrantCardClassification(grantDoc);

  expect(result.grantType).toBe('Hiring Grant');
});
```

**CanExport Claims Expense Analysis**:
```javascript
const { testExpenseAnalysis } = require('../utils/test-helpers');

test('Analyze expense for eligibility', async () => {
  const expense = {
    vendor: 'Vancouver Translation Services',
    amount: 525,
    tax: 25,
    taxType: 'GST',
    category: 'C',
    description: 'Website translation to French'
  };

  const result = await testExpenseAnalysis(expense);

  expect(result.verdict).toBe('APPROVED');
  expect(result.eligibleAmount).toBe(500);
});
```

**ETG Eligibility Check**:
```javascript
const { testETGEligibility } = require('../utils/test-helpers');

test('Reject ineligible seminar', async () => {
  const training = {
    training_title: 'Leadership Seminar 2025',
    training_type: 'Seminar',
    training_content: 'Leadership best practices',
    training_duration: '6 hours'
  };

  const result = await testETGEligibility(training);

  expect(result.eligible).toBe(false);
  expect(result.mentionedKeywords).toContain('seminar');
});
```

**BCAFE Funding Calculation**:
```javascript
const { testBCAFEFunding } = require('../utils/test-helpers');

test('Calculate cash match for producer', async () => {
  const scenario = {
    applicantType: 'producer',
    totalProjectCost: 10000
  };

  const result = await testBCAFEFunding(scenario);

  expect(result.cashMatchPercent).toBe(50);
  expect(result.cashMatchRequired).toBe(5000);
  expect(result.maxGrantAmount).toBe(5000);
});
```

---

## Parsing Responses

### Extract XML Sections

```javascript
const { parseXMLResponse } = require('../utils/test-helpers');

test('Parse CanExport Claims XML response', async () => {
  const response = await sendMessageToAgent('canexport-claims', message);

  const parsed = parseXMLResponse(response.content, [
    'thinking',
    'expense_summary',
    'compliance_analysis',
    'verdict',
    'recommendations'
  ]);

  expect(parsed.verdict).toContain('APPROVED');
  expect(parsed.expense_summary).toContain('$500');
});
```

### Extract Thinking Section

```javascript
const { extractThinking } = require('../utils/test-helpers');

test('Thinking section is present', async () => {
  const response = await sendMessageToAgent('canexport-claims', message);
  const { thinking, mainContent, hasThinking } = extractThinking(response.content);

  expect(hasThinking).toBe(true);
  expect(thinking).toContain('Expense classification');
  expect(mainContent).not.toContain('<thinking>');
});
```

### Validate Required Fields

```javascript
const { validateRequiredFields } = require('../utils/test-helpers');

test('Response contains all required fields', async () => {
  const parsed = { /* parsed response */ };

  const validation = validateRequiredFields(parsed, [
    'expense_summary',
    'verdict',
    'recommendations'
  ]);

  expect(validation.isValid).toBe(true);
  expect(validation.completeness).toBe(1.0); // 100%
});
```

---

## Loading Test Fixtures

Fixtures are pre-generated from knowledge base documents.

### Load Fixtures

```javascript
const { loadFixture } = require('../utils/test-helpers');

test('Process real grant document', async () => {
  // Load fixture from fixtures/grant-cards/hiring-grant.json
  const grantDoc = await loadFixture('hiring-grant.json', 'grant-cards');

  const result = await testGrantCardClassification(grantDoc);

  expect(result.grantType).toBe('Hiring Grant');
});
```

### Generate New Fixtures

Before writing tests, generate fresh fixtures:

```bash
# Generate all fixtures
npm run fixtures:generate all

# Generate for specific agent
npm run fixtures:generate canexport-claims

# Limit number of files
npm run fixtures:generate etg-writer --limit 5
```

Fixtures are saved to `tests/fixtures/<agent-type>/` and automatically categorized.

---

## Testing Quality with LLM Grading

Use LLM-as-judge to evaluate subjective quality dimensions.

### Basic LLM Grading

```javascript
const { gradeWithLLM, createInsightRubric } = require('../utils/llm-grader');

test('Granted Insights meet quality standards', async () => {
  const response = await sendMessageToAgent('grant-cards', grantDoc, {
    task: 'insights'
  });

  const grading = await gradeWithLLM({
    task: 'Generate strategic insights for grant opportunity',
    output: response.content,
    rubric: createInsightRubric(),
    context: grantDoc // Optional: provide original input for context
  });

  expect(grading.overallScore).toBeGreaterThanOrEqual(4.0);
  expect(grading.scores.actionability).toBeGreaterThanOrEqual(4);
});
```

### Standard Rubrics

**Grant Writing Quality**:
```javascript
const { createGrantWritingRubric } = require('../utils/llm-grader');

const rubric = createGrantWritingRubric();
// Evaluates: clarity, professional tone, strategic value, completeness, format adherence
```

**Compliance Analysis Quality**:
```javascript
const { createComplianceRubric } = require('../utils/llm-grader');

const rubric = createComplianceRubric();
// Evaluates: accuracy, thoroughness, clarity of verdict, actionability, evidence use
```

**Strategic Insight Quality**:
```javascript
const { createInsightRubric } = require('../utils/llm-grader');

const rubric = createInsightRubric();
// Evaluates: depth, relevance, competitive intelligence, clarity, actionability
```

### Custom Rubric

```javascript
test('Custom quality evaluation', async () => {
  const grading = await gradeWithLLM({
    task: 'Evaluate business case quality',
    output: response.content,
    rubric: {
      criteria: [
        'Clear problem statement',
        'Measurable outcomes defined',
        'Budget justification provided',
        'Risk mitigation addressed'
      ],
      scale: '1-5 where 5 is excellent'
    }
  });

  expect(grading.overallScore).toBeGreaterThanOrEqual(4.0);
});
```

---

## Testing Consistency

Verify that agents produce consistent results for the same input.

### Basic Consistency Test

```javascript
const { testConsistency } = require('../utils/test-helpers');

test('Grant classification is consistent across runs', async () => {
  const consistency = await testConsistency(
    testGrantCardClassification,
    [grantDocument],
    3 // Run 3 times
  );

  const grantTypes = consistency.results.map(r => r.grantType);

  // All runs should produce same classification
  expect(grantTypes[0]).toBe(grantTypes[1]);
  expect(grantTypes[1]).toBe(grantTypes[2]);
});
```

### Numeric Consistency

```javascript
const { checkConsistencyThreshold } = require('../utils/evaluation-metrics');

test('Tax calculations are consistent', async () => {
  const expense = { /* ... */ };

  // Run multiple times
  const amounts = await Promise.all([
    testExpenseAnalysis(expense).then(r => r.eligibleAmount),
    testExpenseAnalysis(expense).then(r => r.eligibleAmount),
    testExpenseAnalysis(expense).then(r => r.eligibleAmount)
  ]);

  const consistency = checkConsistencyThreshold(amounts, 5); // Max 5% variance

  expect(consistency.consistent).toBe(true);
  expect(consistency.cv).toBeLessThan(5);
});
```

---

## Testing Edge Cases

### Missing Information

```javascript
test('Handles missing tax information', async () => {
  const expense = {
    vendor: 'Test Vendor',
    amount: 1000,
    tax: null, // Missing
    category: 'B'
  };

  const result = await testExpenseAnalysis(expense);

  // Should not crash, should request information
  expect(result.verdict).toBe('CONDITIONAL');
  expect(result.parsed.recommendations).toContain('tax');
});
```

### Malformed Input

```javascript
test('Handles incomplete training description', async () => {
  const training = {
    training_title: 'Some Course',
    training_type: '', // Empty
    training_content: '', // Empty
    training_duration: ''
  };

  const result = await testETGEligibility(training);

  // Should not crash, should indicate uncertainty
  expect(result.eligible).toBeDefined();
});
```

### Extremely Long Input

```javascript
test('Handles very long document', async () => {
  const longDocument = 'Grant information '.repeat(5000); // Very long

  await expect(async () => {
    await testGrantCardClassification(longDocument);
  }).not.toThrow();
});
```

---

## Custom Jest Matchers

Use custom matchers for common assertions:

### `.toBeApproximately(expected, tolerance)`

For numeric comparisons with floating-point tolerance:

```javascript
test('Reimbursement calculation', async () => {
  const result = await testExpenseAnalysis(expense);

  expect(result.estimatedReimbursement).toBeApproximately(500.00, 0.01);
  // Passes if within $0.01 of $500.00
});
```

### `.toContainXMLTags(tags)`

For XML structure validation:

```javascript
test('Response has required XML structure', async () => {
  const response = await sendMessageToAgent('canexport-claims', message);

  expect(response.content).toContainXMLTags([
    'expense_summary',
    'verdict',
    'recommendations'
  ]);
});
```

### `.toMeetQualityThreshold(threshold)`

For LLM grading assertions:

```javascript
test('Quality meets professional standards', async () => {
  const grading = await gradeWithLLM({ /* ... */ });

  expect(grading).toMeetQualityThreshold(4.0);
  // Passes if overallScore >= 4.0
});
```

### `.toBeConsistent(maxVariance)`

For consistency assertions:

```javascript
test('Results are consistent', async () => {
  const scores = [4.2, 4.3, 4.1, 4.2];

  expect(scores).toBeConsistent(5); // Max 5% CV
});
```

---

## Async Testing Best Practices

### Always Use `async/await`

```javascript
// ✅ Good
test('Test with proper async handling', async () => {
  const result = await testExpenseAnalysis(expense);
  expect(result.verdict).toBe('APPROVED');
});

// ❌ Bad - missing async/await
test('Test without async handling', () => {
  const result = testExpenseAnalysis(expense);
  expect(result.verdict).toBe('APPROVED'); // Will fail!
});
```

### Handle Timeouts

```javascript
test('Long-running operation', async () => {
  const result = await sendMessageToAgent('agent-name', message, {
    timeout: 60000 // 60 seconds
  });

  expect(result.content).toBeDefined();
}, 60000); // Also set Jest timeout
```

### Parallel vs Sequential

**Run independent tests in parallel** (faster):
```javascript
test('Multiple independent checks', async () => {
  const [result1, result2, result3] = await Promise.all([
    testExpenseAnalysis(expense1),
    testExpenseAnalysis(expense2),
    testExpenseAnalysis(expense3)
  ]);

  expect(result1.verdict).toBe('APPROVED');
  expect(result2.verdict).toBe('REJECTED');
  expect(result3.verdict).toBe('CONDITIONAL');
});
```

**Run dependent tests sequentially**:
```javascript
test('Multi-step conversation', async () => {
  const conv = generateTestConversationId('etg-writer');

  const response1 = await sendMessageToAgent('etg-writer', 'First question', {
    conversationId: conv
  });

  const response2 = await sendMessageToAgent('etg-writer', 'Follow-up', {
    conversationId: conv
  });

  expect(response2.content).toContain('previous'); // References first message
});
```

---

## Common Patterns

### Test Suite for Agent Feature

```javascript
const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Category Assignment', () => {

  describe('Category A: International Travel', () => {

    test('Airfare is correctly categorized', async () => {
      const expense = {
        vendor: 'Air Canada',
        amount: 1200,
        description: 'Flight to London for trade show',
        category: 'A'
      };

      const result = await testExpenseAnalysis(expense);

      expect(result.parsed.compliance_analysis).toContain('Category A');
      expect(result.verdict).toBe('APPROVED');
    });

  });

  describe('Category B: Marketing Materials', () => {

    test('Brochures are correctly categorized', async () => {
      // Similar structure
    });

  });

  // Continue for all categories...

});
```

### Data-Driven Tests

Test multiple scenarios with same logic:

```javascript
const testCases = [
  {
    name: 'HST in Ontario (13%)',
    expense: { amount: 1130, tax: 130, taxType: 'HST', province: 'ON' },
    expected: { taxRemoved: 130, eligible: 1000 }
  },
  {
    name: 'GST federal (5%)',
    expense: { amount: 525, tax: 25, taxType: 'GST' },
    expected: { taxRemoved: 25, eligible: 500 }
  },
  {
    name: 'PST + GST in BC (12%)',
    expense: { amount: 1120, tax: 120, taxType: 'PST+GST', province: 'BC' },
    expected: { taxRemoved: 120, eligible: 1000 }
  }
];

testCases.forEach(({ name, expense, expected }) => {
  test(name, async () => {
    const result = await testExpenseAnalysis(expense);

    expect(result.taxRemoved).toBe(expected.taxRemoved);
    expect(result.eligibleAmount).toBe(expected.eligible);
  });
});
```

---

## Debugging Tests

### Enable Verbose Logging

```javascript
test('Debug failing test', async () => {
  const result = await testExpenseAnalysis(expense);

  // Log full response for inspection
  console.log('Raw response:', result.rawResponse);
  console.log('Parsed verdict:', result.verdict);
  console.log('Eligible amount:', result.eligibleAmount);

  expect(result.verdict).toBe('APPROVED');
});
```

### Isolate Failing Tests

Run single test file:
```bash
npm test -- tests/unit/canexport-claims-tax-calc.test.js
```

Run single test:
```javascript
test.only('Focus on this test', async () => {
  // Only this test will run
});
```

Skip tests:
```javascript
test.skip('Skip this test', async () => {
  // This test will be skipped
});
```

---

## Performance Tips

### Reuse Conversations

```javascript
describe('Multi-turn conversation', () => {
  let conversationId;

  beforeAll(() => {
    conversationId = generateTestConversationId('etg-writer');
  });

  test('First message', async () => {
    await sendMessageToAgent('etg-writer', 'Message 1', { conversationId });
  });

  test('Second message', async () => {
    await sendMessageToAgent('etg-writer', 'Message 2', { conversationId });
  });
});
```

### Cache Fixtures

```javascript
describe('Grant Cards with fixture', () => {
  let fixture;

  beforeAll(async () => {
    fixture = await loadFixture('hiring-grant.json', 'grant-cards');
  });

  test('Classification', async () => {
    const result = await testGrantCardClassification(fixture);
    // Use cached fixture
  });

  test('Preview generation', async () => {
    // Reuse same fixture
  });
});
```

---

## Checklist for New Tests

When adding a test, ensure:

- [ ] Test has clear, descriptive name
- [ ] Uses `async/await` properly
- [ ] Uses test helpers (not raw API calls)
- [ ] Tests one thing (single responsibility)
- [ ] Includes both happy path and edge cases
- [ ] Has meaningful assertions (not just "no error")
- [ ] Runs quickly (<30s for unit tests)
- [ ] Is deterministic (passes consistently)
- [ ] Cleans up after itself (if needed)
- [ ] Is documented (test description explains what it does)

---

## Examples by Agent

### CanExport Claims
```javascript
// tests/unit/canexport-claims-categories.test.js
const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Expense Categorization', () => {
  test('Category A: Airfare', async () => { /* ... */ });
  test('Category B: Marketing', async () => { /* ... */ });
  test('Category C: Translation', async () => { /* ... */ });
  test('Category D: Shipping', async () => { /* ... */ });
});
```

### ETG Writer
```javascript
// tests/unit/etg-writer-eligibility.test.js
const { testETGEligibility } = require('../utils/test-helpers');

describe('ETG Writer - Eligibility Checker', () => {
  test('Approves certification course', async () => { /* ... */ });
  test('Rejects seminar', async () => { /* ... */ });
  test('Rejects degree program', async () => { /* ... */ });
});
```

### Grant Cards
```javascript
// tests/unit/grant-cards-classification.test.js
const { testGrantCardClassification } = require('../utils/test-helpers');

describe('Grant Cards - Grant Type Classification', () => {
  test('Identifies Hiring Grant', async () => { /* ... */ });
  test('Identifies R&D Grant', async () => { /* ... */ });
  test('Identifies Training Grant', async () => { /* ... */ });
});
```

### BCAFE Writer
```javascript
// tests/unit/bcafe-writer-funding.test.js
const { testBCAFEFunding } = require('../utils/test-helpers');

describe('BCAFE Writer - Funding Calculations', () => {
  test('Producer: 50% cash match', async () => { /* ... */ });
  test('Association: 30% cash match', async () => { /* ... */ });
});
```

---

## Getting Help

1. **Check existing tests** in `tests/unit/` and `tests/integration/` for examples
2. **Review test helpers** in `tests/utils/test-helpers.js` for available functions
3. **Read console output** - error messages often point to the issue
4. **Use `console.log`** liberally when debugging
5. **Run tests with `--verbose`** flag for detailed output

---

**Happy Testing!** 🧪

Remember: The goal is to catch bugs early and ensure quality, not to have 100% test coverage. Focus on testing critical paths and edge cases first.
