// src/__tests__/sec7-public-secrets.spec.ts
// PC-56 SEC-7 · production refuses any secret (or connection-URL password) that was committed to this PUBLIC
// repository. The values below ARE in its history (apps/api/src/core/config/__tests__/app-config.security.spec.ts).
import { randomBytes } from 'crypto';
import { WorkerConfig } from '../config';

const PUBLISHED = 'Zx9Qw7Vb3Nm2Kp5Lr8Td1Gh4Js6Fd0Ay2Bc7Xe';
const PUBLISHED_DB_PASSWORD = 'Str0ng-Db-Passw0rd-9x';
const fresh = () => randomBytes(32).toString('hex');
const SEC7 = /uses a value that was committed to the public repository/;
const errorOf = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

describe('worker · SEC-7', () => {
  const kek = randomBytes(32).toString('base64');
  it('refuses a published database password', () => {
    expect(errorOf(() => new WorkerConfig({ NODE_ENV: 'production', WEBHOOK_SIGNING_KEK: kek,
      DATABASE_URL: `postgresql://kv_relay:${PUBLISHED_DB_PASSWORD}@db.example.com:5432/krishalaya?sslmode=require` })))
      .toMatch(/DATABASE_URL uses a value that was committed/);
  });
  it('accepts a fresh password', () => {
    expect(errorOf(() => new WorkerConfig({ NODE_ENV: 'production', WEBHOOK_SIGNING_KEK: kek,
      DATABASE_URL: `postgresql://kv_relay:${fresh()}@db.example.com:5432/krishalaya?sslmode=require` }))).not.toMatch(SEC7);
  });
});
