// packages/ui/jest.config.js · DEV-15. Mirrors the monorepo's existing minimal ts-jest pattern
// (packages/sdk-js/jest.config.js, packages/tokens's package.json script) — no new test framework, no new
// external dependency beyond `react-dom` (already resolved repo-wide at the exact peer version, added as a
// devDependency here purely for `react-dom/server`'s `renderToStaticMarkup`). `testEnvironment: 'node'` is
// sufficient (not `jsdom`) because every test renders to a static HTML string and asserts on it — no real
// DOM/browser APIs are exercised, so no `jest-environment-jsdom` dependency is needed either.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }] },
};
