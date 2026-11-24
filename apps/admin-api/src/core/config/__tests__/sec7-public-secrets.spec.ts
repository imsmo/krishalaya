// src/core/config/__tests__/sec7-public-secrets.spec.ts
// PC-56 SEC-7 · production refuses any secret (or connection-URL password) that was committed to this PUBLIC
// repository. The values below ARE in its history (apps/api/src/core/config/__tests__/app-config.security.spec.ts).
import { randomBytes } from 'crypto';
import { AdminConfig } from '../admin-config';

const PUBLISHED = 'Zx9Qw7Vb3Nm2Kp5Lr8Td1Gh4Js6Fd0Ay2Bc7Xe';
const PUBLISHED_DB_PASSWORD = 'Str0ng-Db-Passw0rd-9x';
const fresh = () => randomBytes(32).toString('hex');
const SEC7 = /uses a value that was committed to the public repository/;
const errorOf = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

describe('admin-api · SEC-7', () => {
  const base = { NODE_ENV: 'production', ADMIN_IP_ALLOWLIST: '203.0.113.7', ADMIN_REQUIRE_HARDWARE_KEY: 'true', ADMIN_OPERATOR_REGISTRY_ENABLED: 'true' };
  it('refuses a published ADMIN_JWT_SECRET and a published database password, by name', () => {
    const msg = errorOf(() => new AdminConfig({ ...base, ADMIN_JWT_SECRET: PUBLISHED,
      DATABASE_ADMIN_URL: `postgresql://kv_admin:${PUBLISHED_DB_PASSWORD}@db.example.com:5432/krishalaya` }));
    expect(msg).toMatch(/ADMIN_JWT_SECRET uses a value that was committed/);
    expect(msg).toMatch(/DATABASE_ADMIN_URL uses a value that was committed/);
  });
  it('boots with freshly generated secrets', () => {
    expect(() => new AdminConfig({ ...base, ADMIN_JWT_SECRET: fresh(),
      DATABASE_ADMIN_URL: `postgresql://kv_admin:${fresh()}@db.example.com:5432/krishalaya` })).not.toThrow();
  });
  it('is not applied outside production', () => {
    expect(() => new AdminConfig({ NODE_ENV: 'development', ADMIN_JWT_SECRET: PUBLISHED })).not.toThrow();
  });
});
