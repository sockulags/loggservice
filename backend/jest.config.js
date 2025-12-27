module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/__tests__/**',
    '!src/server.js' // Exclude server.js from coverage as it's hard to test
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 45,
      lines: 55,
      statements: 55
    }
  },
  coverageReporters: ['text', 'lcov', 'html'],
  // Transform uuid ESM module to CommonJS
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)'
  ],
  transform: {
    '^.+\\.js$': 'babel-jest'
  }
};
