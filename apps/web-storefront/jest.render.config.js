// apps/web-storefront/jest.render.config.js · PC-56 STORE-1a · C1 — the storefront's RENDER harness, copied from
// apps/web-tenant/jest.render.config.js (whose header documents the choice in full). A SEPARATE jest project from `jest.config.js`
// (pure, framework-free `src/test/**/*.spec.ts`): this one renders real server components to static markup.
//
// SAME DISCLOSED SUBSTITUTION as web-tenant: `testEnvironment: 'node'` + `react-dom/server`'s `renderToStaticMarkup` — no
// `jest-environment-jsdom` (not installed anywhere in this repo; no new dependency added). The request-scoped modules a page imports
// (lib/i18n, lib/session, lib/api-client, lib/login-flow, lib/tenant-context — `server-only` + `next/headers`) are replaced with
// deterministic fixtures by jest.mock in each test (the seam web-tenant's rtl-sweep test documents); the async page/component is awaited
// for its element tree and rendered. Every later STORE wave adds its render tests here.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/test-render/**/*.render.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, strict: true, jsx: 'react-jsx' } }],
  },
};
