// apps/admin-api/src/core/config/admin-config.ts · the ONLY place process.env is read in admin-api.
// Separate security realm from apps/api (own JWT issuer/secret, own DB role kv_admin, IP allowlist). Fail-closed
// (§4): in production it refuses to boot with a weak/dev admin JWT secret, with the IP allowlist disabled, or
// with hardware-key/step-up enforcement turned off. Injected everywhere — never read env elsewhere.
import { Injectable } from '@nestjs/common';
import { publicSecretProblems } from './known-public-secrets.generated';
import { OperatorBinding, parseOperatorBindings } from '../auth/operator-bindings';

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
  // PC-56 ADMIN-9: the operator registry — AdminAuthGuard checks the realm's own record of the operator (suspension,
  // session revocation, dormancy, deny-only restrictions). DEFAULT ON: a security control that ships off is a security
  // control nobody turns on. The switch exists so a defect in a front-door read is recoverable without a deploy.
  ADMIN_OPERATOR_REGISTRY_ENABLED: boolean;
  // DEV-56 Part 3: a DEV-ONLY way into the god-mode realm (see `core/auth/dev-login.controller.ts`) — the founder's
  // local machine has no seeded operator, no dev bypass and no live IdP integration, so there is no other way in
  // today. Defaults OFF (Law 8) and is asserted OFF below whenever NODE_ENV==='production' — mirrors apps/api's own
  // `AUTH_EXPOSE_OTP` production guard exactly (see `apps/api/src/core/config/app-config.ts`).
  ADMIN_DEV_LOGIN_ENABLED: boolean;
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
  // ---- PC-56 ADMIN-AUTH-1 · operator sign-in (OpenID Connect + WebAuthn hardware key) ----
  ADMIN_OIDC_ISSUER: string;           // default https://accounts.google.com (Google Workspace)
  ADMIN_OIDC_CLIENT_ID: string;
  ADMIN_OIDC_CLIENT_SECRET: string;
  ADMIN_OIDC_REDIRECT_URI: string;     // THIS process's /v1/auth/sso/callback (https in production)
  ADMIN_OIDC_ALLOWED_DOMAINS: string[];// lower-cased; enforced on `hd` (when present) AND the verified email's domain
  ADMIN_OIDC_HTTP_TIMEOUT_MS: number;  // every outbound IdP call (discovery, JWKS, token) is bounded by this
  ADMIN_CONSOLE_URL: string;           // web-admin origin the callback redirects back to
  ADMIN_OPERATOR_BINDINGS: OperatorBinding[];   // parsed + validated (core/auth/operator-bindings.ts)
  ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256: string;   // hex sha256 of the founder's one-time first-key code ('' = none)
  ADMIN_WEBAUTHN_RP_ID: string;        // registrable domain of the console (e.g. krishalaya.com)
  ADMIN_WEBAUTHN_RP_NAME: string;
  ADMIN_WEBAUTHN_ORIGIN: string;       // web-admin origin (where the browser ceremony runs)
  ADMIN_SESSION_TTL_SEC: number;       // lifetime of a minted admin session token (step-up never extends it)
}

function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
/** The raw environment as strings (process.env, or a test's object) — for the published-secret check. */
function stringEnv(raw: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === 'string' ? v : undefined;
  return out;
}

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
      ADMIN_OPERATOR_REGISTRY_ENABLED: bool(raw.ADMIN_OPERATOR_REGISTRY_ENABLED, true),
      ADMIN_DEV_LOGIN_ENABLED: bool(raw.ADMIN_DEV_LOGIN_ENABLED, false),   // Law 8: default OFF
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
      ADMIN_OIDC_ISSUER: String(raw.ADMIN_OIDC_ISSUER ?? 'https://accounts.google.com').replace(/\/+$/, ''),
      ADMIN_OIDC_CLIENT_ID: String(raw.ADMIN_OIDC_CLIENT_ID ?? ''),
      ADMIN_OIDC_CLIENT_SECRET: String(raw.ADMIN_OIDC_CLIENT_SECRET ?? ''),
      ADMIN_OIDC_REDIRECT_URI: String(raw.ADMIN_OIDC_REDIRECT_URI ?? ''),
      ADMIN_OIDC_ALLOWED_DOMAINS: list(raw.ADMIN_OIDC_ALLOWED_DOMAINS).map((d) => d.toLowerCase()),
      ADMIN_OIDC_HTTP_TIMEOUT_MS: Math.min(Math.max(num(raw.ADMIN_OIDC_HTTP_TIMEOUT_MS, 5000), 500), 15000),
      ADMIN_CONSOLE_URL: String(raw.ADMIN_CONSOLE_URL ?? '').replace(/\/+$/, ''),
      ADMIN_OPERATOR_BINDINGS: [],
      ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256: String(raw.ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256 ?? '').trim().toLowerCase(),
      ADMIN_WEBAUTHN_RP_ID: String(raw.ADMIN_WEBAUTHN_RP_ID ?? '').trim().toLowerCase(),
      ADMIN_WEBAUTHN_RP_NAME: String(raw.ADMIN_WEBAUTHN_RP_NAME ?? 'Krishalaya Admin'),
      ADMIN_WEBAUTHN_ORIGIN: String(raw.ADMIN_WEBAUTHN_ORIGIN ?? '').replace(/\/+$/, ''),
      // 8 h default (a working day), clamped to [5 min, 12 h]. Sensitive actions still need a step-up within
      // ADMIN_STEP_UP_MAX_AGE_SEC, so a long session never means a long-lived elevation.
      ADMIN_SESSION_TTL_SEC: Math.min(Math.max(num(raw.ADMIN_SESSION_TTL_SEC, 28_800), 300), 43_200),
    };
    // Bindings are parsed here (the only env reader) and validated against owner-roles.ts. Malformed JSON and duplicate
    // emails are refused in EVERY environment — a half-read binding list is worse than none. Unknown roles and zero
    // bindings are boot refusals in production (assertProductionSecurity) and loud warnings elsewhere.
    const isProdEnv = this.env.NODE_ENV === 'production';
    const parsedBindings = parseOperatorBindings(raw.ADMIN_OPERATOR_BINDINGS, isProdEnv);
    this.bindingProblems = parsedBindings.errors;
    if (!isProdEnv && parsedBindings.errors.length) throw new Error(`FATAL: admin-api ADMIN_OPERATOR_BINDINGS -> ${parsedBindings.errors.join('; ')}`);
    // eslint-disable-next-line no-console
    for (const w of parsedBindings.warnings) console.warn(`[admin-api] WARNING: ${w}`);
    this.env.ADMIN_OPERATOR_BINDINGS = parsedBindings.bindings;
    this.assertProductionSecurity(raw);
  }

  /** Binding errors, kept for assertProductionSecurity (in production they are reported with every other problem). */
  private bindingProblems: string[] = [];

  /** Fail-closed: a weak/misconfigured god-mode realm crashes boot, never ships. */
  private assertProductionSecurity(raw: Record<string, unknown>): void {
    if (this.env.NODE_ENV !== 'production') return;
    const weak = (v: string) => !v || v.length < 32 || /change-?me|dev-|test|secret-secret|placeholder/i.test(v);
    const problems: string[] = [];
    if (weak(this.env.ADMIN_JWT_SECRET)) problems.push('ADMIN_JWT_SECRET (unique random >=32 chars)');
    if (this.env.ADMIN_IP_ALLOWLIST.length === 0) problems.push('ADMIN_IP_ALLOWLIST must be set (god-mode is IP-restricted)');
    if (!this.env.ADMIN_REQUIRE_HARDWARE_KEY) problems.push('ADMIN_REQUIRE_HARDWARE_KEY must be true in production');
    // Running production with the registry off means no suspension, no session revocation and no dormancy limit — the
    // pre-0118 realm, where a dismissed operator keeps god mode until their token expires.
    if (!this.env.ADMIN_OPERATOR_REGISTRY_ENABLED) problems.push('ADMIN_OPERATOR_REGISTRY_ENABLED must be true in production (operator suspension + session revocation depend on it)');
    if (!this.env.DATABASE_ADMIN_URL) problems.push('DATABASE_ADMIN_URL must be set');
    // If impersonation is enabled in prod, its dedicated signing key must be strong (act-as is the riskiest control).
    if (this.env.IMPERSONATION_ENABLED && weak(this.env.IMPERSONATION_TOKEN_SECRET)) problems.push('IMPERSONATION_TOKEN_SECRET (unique random >=32 chars) is required when IMPERSONATION_ENABLED');
    // DEV-56 Part 3: the dev-only login bypass must be IMPOSSIBLE to run in production, not merely off by default —
    // the process refuses to boot if this is ever true here, exactly like AUTH_EXPOSE_OTP in apps/api.
    if (this.env.ADMIN_DEV_LOGIN_ENABLED) problems.push('ADMIN_DEV_LOGIN_ENABLED must be false in production (dev-only auth bypass)');
    // PC-56 ADMIN-AUTH-1: the real sign-in must be fully configured — without it nobody can reach the console, and a
    // half-configured one (http redirect, no domain restriction, a WebAuthn origin the RP id does not cover) is worse.
    problems.push(...this.signInProblems());
    // PC-56 SEC-7: any secret whose value was ever committed to this PUBLIC repository (dev passwords, examples).
    problems.push(...publicSecretProblems(stringEnv(raw)));
    if (problems.length) throw new Error(`FATAL: insecure admin-api config -> ${problems.join('; ')}`);
  }

  /** Production-only checks for the operator sign-in (OIDC + WebAuthn + bindings + bootstrap code). */
  private signInProblems(): string[] {
    const p: string[] = [...this.bindingProblems];
    const e = this.env;
    const https = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
    if (!https(e.ADMIN_OIDC_ISSUER)) p.push('ADMIN_OIDC_ISSUER must be an https URL');
    if (!e.ADMIN_OIDC_CLIENT_ID) p.push('ADMIN_OIDC_CLIENT_ID must be set');
    // Google's client secrets are ~35 chars; the length floor is lower than ADMIN_JWT_SECRET's, the placeholder check is the same.
    if (!e.ADMIN_OIDC_CLIENT_SECRET || e.ADMIN_OIDC_CLIENT_SECRET.length < 16 || /change-?me|placeholder/i.test(e.ADMIN_OIDC_CLIENT_SECRET)) p.push('ADMIN_OIDC_CLIENT_SECRET must be set (the IdP client secret)');
    if (!https(e.ADMIN_OIDC_REDIRECT_URI) || !/\/v1\/auth\/sso\/callback$/.test(e.ADMIN_OIDC_REDIRECT_URI)) p.push('ADMIN_OIDC_REDIRECT_URI must be the https …/v1/auth/sso/callback URL of this admin-api');
    if (e.ADMIN_OIDC_ALLOWED_DOMAINS.length === 0) p.push('ADMIN_OIDC_ALLOWED_DOMAINS must list the Workspace domain(s) operators sign in from');
    if (!https(e.ADMIN_CONSOLE_URL)) p.push('ADMIN_CONSOLE_URL must be the https origin of web-admin');
    if (!e.ADMIN_WEBAUTHN_RP_ID) p.push('ADMIN_WEBAUTHN_RP_ID must be set (the console\'s registrable domain)');
    if (!https(e.ADMIN_WEBAUTHN_ORIGIN)) p.push('ADMIN_WEBAUTHN_ORIGIN must be the https origin of web-admin');
    else if (e.ADMIN_WEBAUTHN_RP_ID) {
      const host = new URL(e.ADMIN_WEBAUTHN_ORIGIN).hostname.toLowerCase();
      if (host !== e.ADMIN_WEBAUTHN_RP_ID && !host.endsWith(`.${e.ADMIN_WEBAUTHN_RP_ID}`)) p.push('ADMIN_WEBAUTHN_ORIGIN\'s host must equal ADMIN_WEBAUTHN_RP_ID or be a subdomain of it');
    }
    if (e.ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256 && !/^[0-9a-f]{64}$/.test(e.ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256)) p.push('ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256 must be 64 hex characters (sha256 of the code), or empty');
    return p;
  }

  get isProd() { return this.env.NODE_ENV === 'production'; }
  get jwt() { return { secret: this.env.ADMIN_JWT_SECRET, issuer: this.env.ADMIN_JWT_ISSUER, audience: this.env.ADMIN_JWT_AUDIENCE }; }
  get wallet() { return { addr: this.env.WALLET_GRPC_ADDR, token: this.env.WALLET_S2S_TOKEN, timeoutMs: this.env.WALLET_GRPC_TIMEOUT_MS }; }
  get oidc() {
    const e = this.env;
    return { issuer: e.ADMIN_OIDC_ISSUER, clientId: e.ADMIN_OIDC_CLIENT_ID, clientSecret: e.ADMIN_OIDC_CLIENT_SECRET, redirectUri: e.ADMIN_OIDC_REDIRECT_URI, allowedDomains: e.ADMIN_OIDC_ALLOWED_DOMAINS, timeoutMs: e.ADMIN_OIDC_HTTP_TIMEOUT_MS };
  }
  get webauthn() { return { rpId: this.env.ADMIN_WEBAUTHN_RP_ID, rpName: this.env.ADMIN_WEBAUTHN_RP_NAME, origin: this.env.ADMIN_WEBAUTHN_ORIGIN }; }
  get impersonation() { return { enabled: this.env.IMPERSONATION_ENABLED, secret: this.env.IMPERSONATION_TOKEN_SECRET, issuer: this.env.IMPERSONATION_TOKEN_ISSUER, audience: this.env.IMPERSONATION_TOKEN_AUDIENCE, maxTtlSec: this.env.IMPERSONATION_MAX_TTL_SEC }; }
}
export const ADMIN_CONFIG = Symbol('ADMIN_CONFIG');
