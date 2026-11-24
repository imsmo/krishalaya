// apps/wallet-service/src/core/config/wallet-config.ts · the ONLY place process.env is read in the money service.
// Fail-closed (§4): in production it refuses to boot without a kv_wallet DB URL — the money authority must never
// start mis-wired. Plain class (no framework) so the ledger core stays dependency-light.
import { readWalletEnv, WalletEnv } from './env.validation';
import { publicSecretProblems } from './known-public-secrets.generated';

/** The raw environment as strings (process.env, or a test's object) — for the published-secret check. */
function stringEnv(raw: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === 'string' ? v : undefined;
  return out;
}

export class WalletConfig {
  readonly env: WalletEnv;
  constructor(raw: Record<string, unknown> = process.env) {
    this.env = readWalletEnv(raw);
    this.assertProductionSecurity(raw);
  }
  private assertProductionSecurity(raw: Record<string, unknown>): void {
    if (this.env.NODE_ENV !== 'production') return;
    const problems: string[] = [];
    if (!this.env.DATABASE_WALLET_URL) problems.push('DATABASE_WALLET_URL must be set (kv_wallet role)');
    if (/(^|:)(postgres|password|changeme)@/i.test(this.env.DATABASE_WALLET_URL)) problems.push('DATABASE_WALLET_URL must not use a default/dev password');
    // PC-56 SEC-7: any secret whose value was ever committed to this PUBLIC repository (dev passwords, examples).
    problems.push(...publicSecretProblems(stringEnv(raw)));
    if (problems.length) throw new Error(`FATAL: insecure wallet-service config -> ${problems.join('; ')}`);
  }
  get isProd() { return this.env.NODE_ENV === 'production'; }
}
