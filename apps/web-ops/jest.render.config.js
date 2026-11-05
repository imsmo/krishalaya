// apps/web-ops/jest.render.config.js · PC-56 OPS-1a (OPS1-B21) — the web-ops RENDER harness, copied from web-partner's
// `jest.render.config.js` (itself web-tenant's precedent). A SEPARATE jest project from `jest.config.js` (which scopes to pure, framework-free
// specs under `src/test/**/*.spec.ts` and `src/features/**/*.test.ts`): this one renders the presentational components under `src/components/**`
// to static markup and asserts what a person would see.
//
// DISCLOSED SUBSTITUTION (the same one web-partner and web-tenant disclose): a real jsdom test would need `jest-environment-jsdom`, which is
// not installed anywhere in this repo (and no new dependency is added by this wave). This uses `testEnvironment: 'node'` + `react-dom/server`'s
// `renderToStaticMarkup` — zero new dependencies, the monorepo's convention for render test classes that need no live DOM interaction.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/test-render/**/*.render.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, strict: true, jsx: 'react-jsx' } }],
  },
};
