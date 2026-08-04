// @krishalaya/config/jest — shared ts-jest preset for Node libraries.
module.exports = { preset: 'ts-jest', testEnvironment: 'node', rootDir: 'src',
  testMatch: ['**/__tests__/**/*.spec.ts', '**/*.spec.ts'] };
