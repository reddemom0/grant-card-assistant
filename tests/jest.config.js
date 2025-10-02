/**
 * Jest Configuration for Grant Card Assistant Testing Framework
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test directory structure
  roots: ['<rootDir>/unit', '<rootDir>/integration'],

  // Test match patterns
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Coverage configuration
  collectCoverageFrom: [
    '../api/**/*.js',
    '!../api/node_modules/**',
    '!../api/server-redis-updated.js' // Exclude old version
  ],

  coverageDirectory: './reports/coverage',

  coverageReporters: ['text', 'lcov', 'html'],

  // Test timeout (30 seconds for API calls)
  testTimeout: 30000,

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/setup.js'],

  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Verbose output
  verbose: true,

  // Detect open handles (helps identify hanging tests)
  detectOpenHandles: true,

  // Force exit after tests complete
  forceExit: true,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks between tests
  restoreMocks: true
};
