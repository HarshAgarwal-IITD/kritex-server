/** Unit tests: src/**\/*.spec.ts and prisma/**\/*.spec.ts (seed/import helpers). No database needed. */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  roots: ['<rootDir>', '<rootDir>/../prisma'],
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': require('./jest.swc.js') },
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!main.ts', '!**/*.module.ts', '!**/dto/**'],
  coverageDirectory: '../coverage',
};
