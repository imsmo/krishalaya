// apps/web-partner/jest.render.config.js · DEV-24 (KV-BL-056 insurer console). A SEPARATE jest project from
// `jest.config.js` (which scopes to `src/test/**/*.spec.ts`, pure framework-free logic per that file's own
// header comment) — this one covers render-level proof that the new insurer console pages' presentational
// composition (the local `components/DataTable.tsx` + the pure action-gate functions from
// `features/insurance/insurance.ts`) actually renders the right rows/status classes/action forms, mirroring
// `apps/web-tenant/jest.render.config.js`'s own precedent for this exact "new test class, new project"
// pattern (itself following DEV-46's mobile `render` project precedent).
//
// DISCLOSED SUBSTITUTION (same one web-tenant's own jest.render.config.js discloses): a real jsdom test
// would need `jest-environment-jsdom`, which is not installed anywhere in this repo (no network access to
// add it, and Hard Rule "no new deps" applies to this batch regardless). This uses `testEnvironment: 'node'`
// + `react-dom/server`'s `renderToStaticMarkup` instead — zero new dependencies, same substitution already
// established as this monorepo's convention for "render" test classes that don't need live DOM interaction.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/test-render/**/*.render.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, strict: true, jsx: 'react-jsx' } }],
  },
};
