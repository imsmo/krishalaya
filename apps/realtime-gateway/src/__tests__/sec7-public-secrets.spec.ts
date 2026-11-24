// src/__tests__/sec7-public-secrets.spec.ts
// PC-56 SEC-7 · production refuses any secret (or connection-URL password) that was committed to this PUBLIC
// repository. The values below ARE in its history (apps/api/src/core/config/__tests__/app-config.security.spec.ts).
import { randomBytes } from 'crypto';
import { loadConfig } from '../config';

const PUBLISHED = 'Zx9Qw7Vb3Nm2Kp5Lr8Td1Gh4Js6Fd0Ay2Bc7Xe';
const PUBLISHED_DB_PASSWORD = 'Str0ng-Db-Passw0rd-9x';
const fresh = () => randomBytes(32).toString('hex');
const SEC7 = /uses a value that was committed to the public repository/;
const errorOf = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

describe('realtime-gateway · SEC-7', () => {
  const base = { NODE_ENV: 'production', REDIS_URL: 'rediss://redis.example.com:6379' };
  it('refuses a published JWT_ACCESS_SECRET', () => {
    expect(errorOf(() => loadConfig({ ...base, JWT_ACCESS_SECRET: PUBLISHED }))).toMatch(/JWT_ACCESS_SECRET uses a value that was committed/);
  });
  it('boots with a fresh secret', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: fresh() })).not.toThrow();
  });
});
