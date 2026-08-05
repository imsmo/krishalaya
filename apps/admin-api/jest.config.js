// apps/admin-api/jest.config.js · unit + integration projects (mirrors apps/api). `unit` is pure/mocked (no
// infra); `integration` needs a real Postgres (DATABASE_URL / DATABASE_ADMIN_URL) and runs in CI's DB job.
module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      // Only the implemented modules' specs run. Add a module's path here as it's built (the other ops modules
      // are still scaffolds with no tests).
      testMatch: ['<rootDir>/modules/ai-models-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/tenant-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/recon-monitor/__tests__/**/*.spec.ts', '<rootDir>/modules/compliance-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/billing-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/flags-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/plans-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/impersonation/__tests__/**/*.spec.ts', '<rootDir>/modules/support-oversight/__tests__/**/*.spec.ts', '<rootDir>/modules/platform-reports/__tests__/**/*.spec.ts', '<rootDir>/modules/providers-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/announcements/__tests__/**/*.spec.ts', '<rootDir>/modules/global-catalogue-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/schemes-registry-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/cells-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/tenant-applications-ops/__tests__/**/*.spec.ts', '<rootDir>/modules/catalogue-depth/__tests__/**/*.spec.ts'],
      testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: 'src',
      testMatch: ['<rootDir>/modules/ai-models-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/tenant-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/recon-monitor/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/compliance-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/billing-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/flags-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/plans-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/impersonation/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/support-oversight/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/platform-reports/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/providers-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/announcements/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/global-catalogue-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/schemes-registry-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/cells-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/tenant-applications-ops/__tests__/**/*.integration.spec.ts', '<rootDir>/modules/catalogue-depth/__tests__/**/*.integration.spec.ts'],
    },
  ],
};
