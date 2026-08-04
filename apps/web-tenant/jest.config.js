// apps/web-tenant/jest.config.js · unit tests for the console's PURE logic (the framework-free modules in
// src/features/** + helpers). These have no React, no Next, no SDK runtime (type-only imports), so they run under
// ts-jest in a node env — fast and deterministic. Page/Server-Action behaviour is covered by CI's typecheck + the
// e2e suite; this config deliberately scopes to the pure modules. Mirrors web-storefront's setup.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  // PC-23 fix: the vertical-operator waves added co-located `features/**/*.test.ts` specs (dairy/labour/
  // ambassadors/group-lots/ai-review/audit) which the original pattern silently never ran. Both patterns now run.
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/features/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, strict: true, jsx: 'preserve' } }],
  },
};
