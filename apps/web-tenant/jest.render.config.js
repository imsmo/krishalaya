// apps/web-tenant/jest.render.config.js · DEV-18 (packages/ui port batch 4 — real consuming-app smoke
// test). A SEPARATE jest project from `jest.config.js` (which scopes to `src/test/**/*.spec.ts`, pure
// framework-free logic, per that file's own header comment) — this one covers the new render-level proof
// that the rewired console shell (`AppShell`/`Sidebar`/`Topbar`/`PageHeader`/`DataTable` from
// `@krishalaya/ui`) actually renders, mirroring DEV-46's own precedent of adding a SEPARATE jest project
// for a new test class rather than touching the existing config's scope (`apps/mobile/jest.config.js`'s
// `render` project).
//
// DISCLOSED SUBSTITUTION (Hard Rule 4/7 honesty — not a silent shortcut): the founder's own brief asks for
// "a jsdom test." This sandboxed build environment has NO network access (verified: `getaddrinfo EAI_AGAIN
// registry.npmjs.org`) to install the `jest-environment-jsdom` package, which does not exist anywhere in
// this repo's `node_modules` or pnpm store today (grep-verified). Per contract §7 ("no new dependency
// added without justification" AND "no claim of done without actual pasted command output") I will not
// claim a jsdom-environment test suite passes when the package cannot actually be resolved/installed in
// this session. Instead this uses `testEnvironment: 'node'` + `react-dom/server`'s `renderToStaticMarkup`
// — the EXACT same zero-new-dependency convention `packages/ui`'s own test harness already established
// (`packages/ui/jest.config.js`'s own header comment: "no real DOM/browser APIs are exercised, so no
// `jest-environment-jsdom` dependency is needed either"). The assertion this batch actually needs (the
// composed shell + table renders with the expected structure) does not require live DOM interaction, so
// this substitution is sufficient for the intended proof, disclosed rather than silently done — a real
// jsdom-backed harness remains ENGINEERING-OWED (flagged, not fixed here) for whenever this sandbox (or a
// real CI runner with npm registry access) can install the package.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['<rootDir>/test-render/**/*.render.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, strict: true, jsx: 'react-jsx' } }],
  },
};
