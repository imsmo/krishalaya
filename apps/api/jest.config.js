// apps/api/jest.config.js
// Phase-1 scope: the fully-implemented `listings` vertical slice (+ shared core).
// `unit` runs everywhere (pure/mocked, no infra). `integration` needs a real
// Postgres (DATABASE_URL) and runs in the CI service-container job. As each
// further PRD module is implemented, add its path to the testMatch globs.
module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      testMatch: [
        '<rootDir>/modules/listings/__tests__/**/*.spec.ts',
        '<rootDir>/modules/identity/__tests__/**/*.spec.ts',
        '<rootDir>/modules/catalogue/__tests__/**/*.spec.ts',
        '<rootDir>/modules/orders/__tests__/**/*.spec.ts',
        '<rootDir>/modules/payments/__tests__/**/*.spec.ts',
        '<rootDir>/modules/auctions/__tests__/**/*.spec.ts',
        '<rootDir>/modules/offers/__tests__/**/*.spec.ts',
        '<rootDir>/modules/requirements/__tests__/**/*.spec.ts',
        '<rootDir>/modules/logistics/__tests__/**/*.spec.ts',
        '<rootDir>/modules/reviews/__tests__/**/*.spec.ts',
        '<rootDir>/modules/disputes/__tests__/**/*.spec.ts',
        '<rootDir>/modules/promotions/__tests__/**/*.spec.ts',
        '<rootDir>/modules/memberships/__tests__/**/*.spec.ts',
        '<rootDir>/modules/tenancy/__tests__/**/*.spec.ts',
        '<rootDir>/modules/labour/__tests__/**/*.spec.ts',
        '<rootDir>/modules/livestock/__tests__/**/*.spec.ts',
        '<rootDir>/modules/dairy/__tests__/**/*.spec.ts',
        '<rootDir>/modules/equipment/__tests__/**/*.spec.ts',
        '<rootDir>/modules/warehousing/__tests__/**/*.spec.ts',
        '<rootDir>/modules/contract-farming/__tests__/**/*.spec.ts',
        '<rootDir>/modules/exports/__tests__/**/*.spec.ts',
        '<rootDir>/modules/land-soil-weather/__tests__/**/*.spec.ts',
        '<rootDir>/modules/fintech/__tests__/**/*.spec.ts',
        '<rootDir>/modules/insurance/__tests__/**/*.spec.ts',
        '<rootDir>/modules/schemes/__tests__/**/*.spec.ts',
        '<rootDir>/modules/services-marketplace/__tests__/**/*.spec.ts',
        '<rootDir>/modules/communication/__tests__/**/*.spec.ts',
        '<rootDir>/modules/education/__tests__/**/*.spec.ts',
        '<rootDir>/modules/ambassadors/__tests__/**/*.spec.ts',
        '<rootDir>/modules/support/__tests__/**/*.spec.ts',
        '<rootDir>/modules/cms/__tests__/**/*.spec.ts',
        '<rootDir>/modules/market-intel/__tests__/**/*.spec.ts',
        '<rootDir>/modules/traceability/__tests__/**/*.spec.ts',
        '<rootDir>/modules/ai-governance/__tests__/**/*.spec.ts',
        '<rootDir>/core/**/__tests__/**/*.spec.ts',
        '<rootDir>/shared/**/__tests__/**/*.spec.ts',
      ],
      testPathIgnorePatterns: ['\\.e2e-spec\\.ts$', '\\.integration\\.spec\\.ts$'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      // Build the test DB ONCE from the real db/migrations + seeds (single source of truth).
      globalSetup: '<rootDir>/../test/integration-global-setup.js',
      testMatch: ['<rootDir>/modules/listings/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/identity/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/catalogue/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/orders/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/payments/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/auctions/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/offers/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/requirements/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/logistics/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/reviews/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/disputes/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/promotions/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/memberships/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/tenancy/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/labour/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/livestock/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/dairy/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/equipment/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/warehousing/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/contract-farming/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/exports/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/land-soil-weather/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/fintech/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/insurance/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/schemes/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/services-marketplace/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/communication/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/education/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/ambassadors/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/support/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/cms/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/market-intel/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/traceability/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/ai-governance/__tests__/**/*.integration.spec.ts', '<rootDir>/core/**/__tests__/**/*.integration.spec.ts'],
    },
    {
      // HTTP-through-the-app e2e: boots the REAL AppModule over the same test DB the integration
      // globalSetup builds (real migrations + seeds), driven by supertest. Each spec describe.skips
      // itself when DATABASE_URL is unset, so it runs in the CI DB job and is a no-op elsewhere.
      displayName: 'e2e',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      globalSetup: '<rootDir>/../test/integration-global-setup.js',
      testMatch: ['<rootDir>/modules/**/__tests__/**/*.e2e-spec.ts', '<rootDir>/../test/e2e/**/*.e2e-spec.ts'],
    },
  ],
};
