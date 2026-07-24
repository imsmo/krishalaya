// apps/mobile/jest.config.js · DEV-46: multi-project jest config. Project 1 ("core") is the pre-existing,
// UNCHANGED pure-logic suite (framework-free state machine / offline queue / pure helpers, node + ts-jest,
// scoped to src/core/__tests__) — untouched by this batch, byte-identical roots/testMatch/transform to the
// pre-DEV-46 single-project config. Project 2 ("render") is NEW: a real React Native render harness on the
// jest-expo preset (already a devDependency of this package pre-DEV-46; not newly added) + react-test-renderer
// (promoted from an existing transitive resolution — see apps/mobile/package.json, zero new external package).
// This closes Founder Review Queue item 7 / DEV-46: apps/mobile previously had ZERO component-level render
// tests anywhere — every "test" to date only ever exercised pure functions, never mounted a screen's JSX or
// caught a render-time crash. `pnpm test` (unchanged script) now runs BOTH projects; `--selectProjects` isolates
// either one (see the two convenience scripts added to package.json).
module.exports = {
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/core/__tests__'],
      testMatch: ['**/*.spec.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
    },
    {
      displayName: 'render',
      preset: 'jest-expo',
      roots: ['<rootDir>/src/app'],
      testMatch: ['**/__tests__/render/*.render-spec.tsx'],
      setupFiles: ['<rootDir>/src/test-utils/jest.setup.render.ts'],
      // jest-expo's own transformIgnorePatterns assumes a classic flat node_modules, where its allowlist regex
      // matches right at the `node_modules/` boundary of the real package (react-native, expo*, etc.). Under
      // pnpm's store layout every package sits at `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>/...` —
      // there are TWO `node_modules/` segments per path, and the preset's pattern (no anchor) matches at the
      // FIRST one, where what follows is `.pnpm/...` (not on the allowlist), so its negative-lookahead trivially
      // succeeds there and jest ignores (never transforms) the file — it never even gets to re-check the real
      // package name one level down, because a single regex `.test()` only needs one matching position anywhere
      // in the string. Symptom (reproduced, not theoretical): RN's own Flow-typed polyfill
      // (`@react-native/js-polyfills/error-guard.js`, required by `react-native/jest/setup.js`) fails with
      // "Unexpected identifier 'ErrorHandler'" — a real, pnpm-specific finding absent from jest-expo's own docs
      // (which assume npm/yarn hoisting). Fix: add `(?!.*/node_modules/)` so the pattern only matches the LAST
      // `node_modules/` segment in the path (the one immediately owning the real package's files) — the
      // intermediate `.pnpm/.../node_modules/` mount point is skipped because it IS followed by another
      // `node_modules/` later, restoring classic flat-node_modules semantics on top of pnpm's nested one.
      transformIgnorePatterns: [
        '/node_modules/(?!.*/node_modules/)(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
        '/node_modules/react-native-reanimated/plugin/',
      ],
    },
  ],
};
