// apps/admin-api/jest.config.js · unit + integration projects (mirrors apps/api). `unit` is pure/mocked (no
// infra); `integration` needs a real Postgres (DATABASE_URL / DATABASE_ADMIN_URL) and runs in CI's DB job.
module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      // A GLOB, not an enumeration. This list used to name every module by hand, which meant a NEW module's specs were
      // silently never run: PC-56 ADMIN-3b's translations spec compiled, passed tsc, and `jest` reported "0 matches".
      // A test that does not run is worse than a missing one, because it looks like coverage.
      testMatch: ['<rootDir>/modules/**/__tests__/**/*.spec.ts'],
      testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      testMatch: ['<rootDir>/modules/**/__tests__/**/*.integration.spec.ts'],
    },
  ],
};
