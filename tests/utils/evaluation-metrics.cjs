/**
 * Evaluation Metrics for Testing Framework
 *
 * Provides statistical analysis, consistency checks, and scoring utilities
 * for evaluating agent performance across multiple test runs.
 */

/**
 * Calculate basic statistics for numeric array
 *
 * @param {Array<number>} values - Array of numeric values
 * @returns {Object} Statistical summary
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return {
      mean: null,
      median: null,
      min: null,
      max: null,
      stdDev: null,
      count: 0
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / values.length;

  // Calculate median
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  // Calculate standard deviation
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return {
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev,
    count: values.length
  };
}

/**
 * Calculate coefficient of variation (CV) to measure consistency
 * CV = (stdDev / mean) * 100
 * Lower CV indicates higher consistency
 *
 * @param {Array<number>} values - Array of numeric values
 * @returns {number} Coefficient of variation as percentage
 */
function calculateConsistency(values) {
  const stats = calculateStats(values);

  if (!stats.mean || stats.mean === 0) {
    return null;
  }

  return (stats.stdDev / stats.mean) * 100;
}

/**
 * Check if values are within acceptable variance threshold
 *
 * @param {Array<number>} values - Array of numeric values
 * @param {number} maxVariance - Maximum acceptable CV percentage (default: 5%)
 * @returns {Object} Consistency check result
 */
function checkConsistencyThreshold(values, maxVariance = 5) {
  const cv = calculateConsistency(values);
  const stats = calculateStats(values);

  if (cv === null) {
    return {
      consistent: false,
      cv: null,
      reason: 'Insufficient data or zero mean'
    };
  }

  return {
    consistent: cv <= maxVariance,
    cv,
    maxVariance,
    stats,
    message: cv <= maxVariance
      ? `Values are consistent (CV: ${cv.toFixed(2)}%)`
      : `Values show high variance (CV: ${cv.toFixed(2)}% exceeds ${maxVariance}% threshold)`
  };
}

/**
 * Calculate pass rate for test results
 *
 * @param {Array<Object>} results - Array of test results with 'passed' property
 * @returns {Object} Pass rate analysis
 */
function calculatePassRate(results) {
  if (!results || results.length === 0) {
    return {
      passRate: null,
      passed: 0,
      failed: 0,
      total: 0
    };
  }

  const passed = results.filter(r => r.passed === true).length;
  const failed = results.length - passed;

  return {
    passRate: (passed / results.length) * 100,
    passed,
    failed,
    total: results.length
  };
}

/**
 * Compare two values for equality with tolerance
 *
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} tolerance - Acceptable difference (default: 0.01)
 * @returns {boolean} True if values are equal within tolerance
 */
function approximatelyEqual(a, b, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Calculate accuracy percentage for classification results
 *
 * @param {Array<Object>} results - Array with 'expected' and 'actual' properties
 * @returns {Object} Accuracy analysis
 */
function calculateAccuracy(results) {
  if (!results || results.length === 0) {
    return {
      accuracy: null,
      correct: 0,
      incorrect: 0,
      total: 0
    };
  }

  const correct = results.filter(r => r.expected === r.actual).length;
  const incorrect = results.length - correct;

  return {
    accuracy: (correct / results.length) * 100,
    correct,
    incorrect,
    total: results.length
  };
}

/**
 * Identify outliers using IQR method
 *
 * @param {Array<number>} values - Array of numeric values
 * @returns {Object} Outlier analysis
 */
function detectOutliers(values) {
  if (!values || values.length < 4) {
    return {
      outliers: [],
      lowerBound: null,
      upperBound: null
    };
  }

  const sorted = [...values].sort((a, b) => a - b);

  // Calculate quartiles
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);

  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  // Calculate bounds
  const lowerBound = q1 - (1.5 * iqr);
  const upperBound = q3 + (1.5 * iqr);

  // Find outliers
  const outliers = values.filter(v => v < lowerBound || v > upperBound);

  return {
    outliers,
    lowerBound,
    upperBound,
    q1,
    q3,
    iqr
  };
}

/**
 * Calculate confusion matrix for binary classification
 *
 * @param {Array<Object>} results - Array with 'expected' and 'actual' boolean properties
 * @returns {Object} Confusion matrix with metrics
 */
function calculateConfusionMatrix(results) {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const result of results) {
    if (result.expected === true && result.actual === true) {
      truePositive++;
    } else if (result.expected === false && result.actual === false) {
      trueNegative++;
    } else if (result.expected === false && result.actual === true) {
      falsePositive++;
    } else if (result.expected === true && result.actual === false) {
      falseNegative++;
    }
  }

  const total = results.length;
  const accuracy = total > 0 ? ((truePositive + trueNegative) / total) * 100 : null;

  const precision = (truePositive + falsePositive) > 0
    ? (truePositive / (truePositive + falsePositive)) * 100
    : null;

  const recall = (truePositive + falseNegative) > 0
    ? (truePositive / (truePositive + falseNegative)) * 100
    : null;

  const f1Score = (precision !== null && recall !== null)
    ? (2 * (precision * recall) / (precision + recall))
    : null;

  return {
    matrix: {
      truePositive,
      trueNegative,
      falsePositive,
      falseNegative
    },
    metrics: {
      accuracy,
      precision,
      recall,
      f1Score
    }
  };
}

/**
 * Generate test report summary
 *
 * @param {Object} testResults - Test results by category
 * @returns {Object} Formatted report summary
 */
function generateReportSummary(testResults) {
  const summary = {
    timestamp: new Date().toISOString(),
    categories: {},
    overall: {
      totalTests: 0,
      passed: 0,
      failed: 0,
      passRate: 0
    }
  };

  let totalPassed = 0;
  let totalTests = 0;

  for (const [category, results] of Object.entries(testResults)) {
    const passRate = calculatePassRate(results);

    summary.categories[category] = {
      total: passRate.total,
      passed: passRate.passed,
      failed: passRate.failed,
      passRate: passRate.passRate
    };

    totalTests += passRate.total;
    totalPassed += passRate.passed;
  }

  summary.overall.totalTests = totalTests;
  summary.overall.passed = totalPassed;
  summary.overall.failed = totalTests - totalPassed;
  summary.overall.passRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

  return summary;
}

/**
 * Compare two test runs to identify regressions
 *
 * @param {Object} baselineResults - Previous test results
 * @param {Object} currentResults - Current test results
 * @returns {Object} Regression analysis
 */
function detectRegressions(baselineResults, currentResults) {
  const regressions = [];
  const improvements = [];

  const baselinePassRate = calculatePassRate(baselineResults);
  const currentPassRate = calculatePassRate(currentResults);

  const passRateDiff = currentPassRate.passRate - baselinePassRate.passRate;

  if (passRateDiff < -5) {
    // 5% drop is considered a regression
    regressions.push({
      metric: 'Overall Pass Rate',
      baseline: baselinePassRate.passRate,
      current: currentPassRate.passRate,
      change: passRateDiff
    });
  } else if (passRateDiff > 5) {
    improvements.push({
      metric: 'Overall Pass Rate',
      baseline: baselinePassRate.passRate,
      current: currentPassRate.passRate,
      change: passRateDiff
    });
  }

  return {
    hasRegressions: regressions.length > 0,
    regressions,
    improvements,
    summary: regressions.length > 0
      ? `⚠️ ${regressions.length} regression(s) detected`
      : improvements.length > 0
      ? `✅ ${improvements.length} improvement(s) detected`
      : '➡️ No significant changes'
  };
}

/**
 * Format test results as readable text summary
 *
 * @param {Object} results - Test results to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted text
 */
function formatTestResults(results, options = {}) {
  const {
    includeDetails = false,
    colorize = false
  } = options;

  let output = '';

  // Overall summary
  const passRate = calculatePassRate(results);
  const passRateStr = passRate.passRate !== null ? passRate.passRate.toFixed(2) : 'N/A';

  output += `Test Results Summary\n`;
  output += `====================\n`;
  output += `Total Tests: ${passRate.total}\n`;
  output += `Passed: ${passRate.passed}\n`;
  output += `Failed: ${passRate.failed}\n`;
  output += `Pass Rate: ${passRateStr}%\n\n`;

  if (includeDetails) {
    output += `Individual Test Results:\n`;
    output += `------------------------\n`;

    results.forEach((result, index) => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      output += `${index + 1}. ${result.name || 'Unnamed Test'}: ${status}\n`;

      if (!result.passed && result.error) {
        output += `   Error: ${result.error}\n`;
      }
    });
  }

  return output;
}

module.exports = {
  // Statistical analysis
  calculateStats,
  calculateConsistency,
  checkConsistencyThreshold,
  detectOutliers,

  // Accuracy metrics
  calculateAccuracy,
  calculatePassRate,
  calculateConfusionMatrix,

  // Comparison utilities
  approximatelyEqual,
  detectRegressions,

  // Reporting
  generateReportSummary,
  formatTestResults
};
