// src/test/sec7-public-secrets.spec.ts
// PC-56 SEC-7 · production refuses any secret (or connection-URL password) that was committed to this PUBLIC
// repository. The values below ARE in its history (apps/api/src/core/config/__tests__/app-config.security.spec.ts).
import { randomBytes } from 'crypto';
import { WalletConfig } from '../core/config/wallet-config';

const PUBLISHED = 'Zx9Qw7Vb3Nm2Kp5Lr8Td1Gh4Js6Fd0Ay2Bc7Xe';
const PUBLISHED_DB_PASSWORD = 'Str0ng-Db-Passw0rd-9x';
const fresh = () => randomBytes(32).toString('hex');
const SEC7 = /uses a value that was committed to the public repository/;
const errorOf = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

describe('wallet-service · SEC-7', () => {
  it('refuses a published database password', () => {
    expect(errorOf(() => new WalletConfig({ NODE_ENV: 'production',
      DATABASE_WALLET_URL: `postgresql://kv_wallet:${PUBLISHED_DB_PASSWORD}@db.example.com:5432/krishalaya` })))
      .toMatch(/DATABASE_WALLET_URL uses a value that was committed/);
  });
  it('refuses a published service token', () => {
    expect(errorOf(() => new WalletConfig({ NODE_ENV: 'production', WALLET_S2S_TOKEN: PUBLISHED,
      DATABASE_WALLET_URL: `postgresql://kv_wallet:${fresh()}@db.example.com:5432/krishalaya` }))).toMatch(SEC7);
  });
  it('accepts a fresh password', () => {
    expect(errorOf(() => new WalletConfig({ NODE_ENV: 'production',
      DATABASE_WALLET_URL: `postgresql://kv_wallet:${fresh()}@db.example.com:5432/krishalaya` }))).not.toMatch(SEC7);
  });
});
