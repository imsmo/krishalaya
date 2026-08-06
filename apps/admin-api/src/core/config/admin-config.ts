// apps/admin-api/src/core/config/admin-config.ts · the ONLY place process.env is read in admin-api.
// Separate security realm from apps/api (own JWT issuer/secret, own DB role kv_admin, IP allowlist). Fail-closed
// (§4): in production it refuses to boot with a weak/dev admin JWT secret, with the IP allowlist disabled, or
// with hardware-key/step-up enforcement turned off. Injected everywhere — never read env elsewhere.
import { Injectable } from '@nestjs/common';

export interface AdminEnv {
  NODE_ENV: string;
  PORT: number;
  DATABASE_ADMIN_URL: string;          // connects as kv_admin (RLS-bypass capable; every query audited)
  ADMIN_JWT_SECRET: string;            // distinct from apps/api's JWT secrets
  ADMIN_JWT_ISSUER: string;
  ADMIN_JWT_AUDIENCE: string;
  ADMIN_IP_ALLOWLIST: string[];        // CIDR-free exact IPs/prefixes; empty = allow-all (non-prod only)
  ADMIN_REQUIRE_HARDWARE_KEY: boolean; // require amr=hwk (FIDO2 at login)
  ADMIN_STEP_UP_MAX_AGE_SEC: number;   // sensitive ops require a re-auth this recent
  DATABASE_POOL_MAX: number;
  WALLET_GRPC_ADDR: string;            // wallet-service gRPC endpoint — the ONLY money writer (Law 2/9)
  WALLET_S2S_TOKEN: string;            // service-to-service bearer for the wallet call (never logged)
  WALLET_GRPC_TIMEOUT_MS: number;      // hard deadline on every wallet RPC (resilience, Law 12)
  IMPERSONATION_ENABLED: boolean;      // kill-switch (Law 10) — default OFF; act-as is refused unless explicitly on
  IMPERSONATION_TOKEN_SECRET: string;  // DEDICATED signing key for act-as tokens (NOT the admin/user secret)
  IMPERSONATION_TOKEN_ISSUER: string;
  IMPERSONATION_TOKEN_AUDIENCE: string;
  IMPERSONATION_MAX_TTL_SEC: number;   // hard upper bound on a grant's lifetime (time-box)
  // ---- object storage (PC-56 ADMIN-1c) ----
  // READ-ONLY here by intent: admin-api hands operators DOWNLOAD links for artefacts apps/api produced (SaaS-invoice
  // PDFs). It never uploads, so no PUT presign and no bucket-write credential is wired in this realm — the blast
  // radius of a compromised admin token stays "can read documents it is already allowed to read".
  MEDIA_BUCKET: string;
  MEDIA_REGION: string;
  MEDIA_ACCESS_KEY_ID: string;
  MEDIA_SECRET_ACCESS_KEY: string;
  MEDIA_ENDPOINT: string | null;       // MinIO/LocalStack; absent ⇒ AWS virtual-hosted
  MEDIA_FORCE_PATH_STYLE: boolean;
  // Short by design: a download link for a tax document should not survive being pasted into a chat thread.
  MEDIA_PRESIGN_EXPIRY_SEC: number;
}

function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function bool(v: unknown, d: boolean): boolean { return v === undefined ? d : v === 'true' || v === true; }
function list(v: unknown): string[] { return typeof v === 'string' && v.length ? v.split(',').map((s) => s.trim()).filter(Boolean) : []; }

@Injectable()
export class AdminConfig {
  readonly env: AdminEnv;
  constructor(raw: Record<string, unknown> = process.env) {
    this.env = {
      NODE_ENV: String(raw.NODE_ENV ?? 'development'),
      PORT: num(raw.ADMIN_PORT, 4001),
      DATABASE_ADMIN_URL: String(raw.DATABASE_ADMIN_URL ?? raw.DATABASE_URL ?? ''),
      ADMIN_JWT_SECRET: String(raw.ADMIN_JWT_SECRET ?? ''),
      ADMIN_JWT_ISSUER: String(raw.ADMIN_JWT_ISSUER ?? 'krishalaya-admin'),
      ADMIN_JWT_AUDIENCE: String(raw.ADMIN_JWT_AUDIENCE ?? 'krishalaya-admin-api'),
      ADMIN_IP_ALLOWLIST: list(raw.ADMIN_IP_ALLOWLIST),
      ADMIN_REQUIRE_HARDWARE_KEY: bool(raw.ADMIN_REQUIRE_HARDWARE_KEY, raw.NODE_ENV === 'production'),
      ADMIN_STEP_UP_MAX_AGE_SEC: num(raw.ADMIN_STEP_UP_MAX_AGE_SEC, 900),   // 15 min
      MEDIA_BUCKET: String(raw.MEDIA_BUCKET ?? ''),
      MEDIA_REGION: String(raw.MEDIA_REGION ?? 'ap-south-1'),
      MEDIA_ACCESS_KEY_ID: String(raw.MEDIA_ACCESS_KEY_ID ?? ''),
      MEDIA_SECRET_ACCESS_KEY: String(raw.MEDIA_SECRET_ACCESS_KEY ?? ''),
      MEDIA_ENDPOINT: raw.MEDIA_ENDPOINT ? String(raw.MEDIA_ENDPOINT) : null,
      MEDIA_FORCE_PATH_STYLE: bool(raw.MEDIA_FORCE_PATH_STYLE, false),
      MEDIA_PRESIGN_EXPIRY_SEC: num(raw.MEDIA_PRESIGN_EXPIRY_SEC, 120),
      DATABASE_POOL_MAX: num(raw.DATABASE_ADMIN_POOL_MAX, 10),
      WALLET_GRPC_ADDR: String(raw.WALLET_GRPC_ADDR ?? ''),
      WALLET_S2S_TOKEN: String(raw.WALLET_S2S_TOKEN ?? ''),
      WALLET_GRPC_TIMEOUT_MS: num(raw.WALLET_GRPC_TIMEOUT_MS, 4000),
      IMPERSONATION_ENABLED: bool(raw.IMPERSONATION_ENABLED, false),   // Law 10: default OFF
      IMPERSONATION_TOKEN_SECRET: String(raw.IMPERSONATION_TOKEN_SECRET ?? ''),
      IMPERSONATION_TOKEN_ISSUER: String(raw.IMPERSONATION_TOKEN_ISSUER ?? 'krishalaya-impersonation'),
      IMPERSONATION_TOKEN_AUDIENCE: String(raw.IMPERSONATION_TOKEN_AUDIENCE ?? 'krishalaya-api'),
      IMPERSONATION_MAX_TTL_SEC: num(raw.IMPERSONATION_MAX_TTL_SEC, 1800),   // 30 min hard cap
    };
    this.assertProductionSecurity();
  }

  /** Fail-closed: a weak/misconfigured god-mode realm crashes boot, never ships. */
  private assertProductionSecurity(): void {
    if (this.env.NODE_ENV !== 'production') return;
    const weak = (v: string) => !v || v.length < 32 || /change-?me|dev-|test|secret-secret|placeholder/i.test(v);
    const problems: string[] = [];
    if (weak(this.env.ADMIN_JWT_SECRET)) problems.push('ADMIN_JWT_SECRET (unique random >=32 chars)');
    if (this.env.ADMIN_IP_ALLOWLIST.length === 0) problems.push('ADMIN_IP_ALLOWLIST must be set (god-mode is IP-restricted)');
    if (!this.env.ADMIN_REQUIRE_HARDWARE_KEY) problems.push('ADMIN_REQUIRE_HARDWARE_KEY must be true in production');
    if (!this.env.DATABASE_ADMIN_URL) problems.push('DATABASE_ADMIN_URL must be set');
    // If impersonation is enabled in prod, its dedicated signing key must be strong (act-as is the riskiest control).
    if (this.env.IMPERSONATION_ENABLED && weak(this.env.IMPERSONATION_TOKEN_SECRET)) problems.push('IMPERSONATION_TOKEN_SECRET (unique random >=32 chars) is required when IMPERSONATION_ENABLED');
    if (problems.length) throw new Error(`FATAL: insecure admin-api config -> ${problems.join('; ')}`);
  }

  get isProd() { return this.env.NODE_ENV === 'production'; }
  get jwt() { return { secret: this.env.ADMIN_JWT_SECRET, issuer: this.env.ADMIN_JWT_ISSUER, audience: this.env.ADMIN_JWT_AUDIENCE }; }
  get wallet() { return { addr: this.env.WALLET_GRPC_ADDR, token: this.env.WALLET_S2S_TOKEN, timeoutMs: this.env.WALLET_GRPC_TIMEOUT_MS }; }
  get impersonation() { return { enabled: this.env.IMPERSONATION_ENABLED, secret: this.env.IMPERSONATION_TOKEN_SECRET, issuer: this.env.IMPERSONATION_TOKEN_ISSUER, audience: this.env.IMPERSONATION_TOKEN_AUDIENCE, maxTtlSec: this.env.IMPERSONATION_MAX_TTL_SEC }; }
}
export const ADMIN_CONFIG = Symbol('ADMIN_CONFIG');
