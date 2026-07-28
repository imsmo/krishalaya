// core/config/app-config.ts
// The ONLY place process.env is read. Everywhere else injects AppConfig — typed,
// validated, mockable. Rule of thumb:
//   infrastructure values (URLs, keys, pools)  → env vars / Secrets Manager (here)
//   business values (commission %, languages…) → DATABASE tables — NEVER env vars.
import { Injectable } from '@nestjs/common';
import { validateEnv, Env } from './env.validation';

@Injectable()
export class AppConfig {
  private readonly env: Env;
  constructor(raw: Record<string, unknown> = process.env) {
    this.env = validateEnv(raw);
    this.assertProductionSecurity(); // fail-closed: a weak prod secret crashes boot, never ships
  }

  /**
   * Fail CLOSED in production. A weak/dev/misconfigured value crashes boot loudly — it never ships.
   * Covers: auth secrets, OTP exposure, the DB connection (no localhost/superuser/dev-password), Redis TLS,
   * S3 (IRSA only — no static keys), OpenSearch TLS+auth, and every external-provider webhook secret that is
   * meaningless if weak. Exported as a pure helper (collectProductionProblems) so it is unit-testable.
   */
  private assertProductionSecurity(): void {
    if (this.env.NODE_ENV !== 'production') return;
    const problems = AppConfig.collectProductionProblems(this.env);
    if (problems.length) throw new Error(`FATAL: insecure production config -> ${problems.join('; ')}`);
  }

  /** Pure: given the validated env, list every production-security problem. Empty = safe to boot. */
  static collectProductionProblems(env: Env): string[] {
    const p: string[] = [];
    const weak = (v?: string) =>
      !v || v.length < 32 || /change-?me|dev-|^test|secret-secret|placeholder|sandbox-secret|^changeme/i.test(v);
    const weak16 = (v?: string) => !v || v.length < 16 || /change-?me|dev-|^test|placeholder|sandbox-secret/i.test(v);

    // --- auth ---
    if (weak(env.JWT_ACCESS_SECRET)) p.push('JWT_ACCESS_SECRET (unique random >=32 chars)');
    if (weak(env.JWT_REFRESH_SECRET)) p.push('JWT_REFRESH_SECRET (unique random >=32 chars)');
    if (weak(env.AUTH_HASH_PEPPER)) p.push('AUTH_HASH_PEPPER (unique random >=32 chars)');
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) p.push('JWT access and refresh secrets must differ');
    if (env.AUTH_EXPOSE_OTP === 'true') p.push('AUTH_EXPOSE_OTP must be false in production');

    // --- CORS: the 4 Next.js web apps call this API from the browser and NEED an explicit allowlist in
    // production (mobile apps + server-to-server webhooks are unaffected either way — they send no Origin
    // header). An empty list in prod would either leave real web traffic unable to read responses, or (worse)
    // signal the allowlist was simply never configured — fail loud at boot rather than silently.
    if (env.WEB_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean).length === 0) {
      p.push('WEB_ORIGINS must be set in production (comma-separated allowed web-app origins)');
    }

    // --- primary database: must be a real managed endpoint, least-privilege role, strong password ---
    for (const [label, url] of [['DATABASE_URL', env.DATABASE_URL], ['DATABASE_REPLICA_URL', env.DATABASE_REPLICA_URL]] as const) {
      if (!url) continue;
      const u = AppConfig.tryParsePg(url);
      if (!u) { p.push(`${label} is not a valid postgres URL`); continue; }
      if (/^(localhost|127\.|::1|0\.0\.0\.0)/.test(u.host)) p.push(`${label} must not point at localhost in production`);
      if (['postgres', 'rdsadmin', 'root', 'admin', 'kv_owner'].includes(u.user)) p.push(`${label} must use a least-privilege role (kv_app), not a superuser/owner`);
      if (!u.password || /^(postgres|password|dev|changeme|admin|secret)$/i.test(u.password) || u.password.length < 12) p.push(`${label} must use a strong, non-default password (from Secrets Manager)`);
      if (u.sslDisabled) p.push(`${label} must require TLS (sslmode=require), not disable it`);
    }

    // --- Redis: required + TLS + not localhost (rate-limits/OTP store/realtime bus) ---
    if (!env.REDIS_URL) p.push('REDIS_URL must be set in production');
    else {
      if (!/^rediss:\/\//.test(env.REDIS_URL)) p.push('REDIS_URL must use TLS (rediss://) in production');
      if (/@?(localhost|127\.0\.0\.1)/.test(env.REDIS_URL)) p.push('REDIS_URL must not point at localhost in production');
    }

    // --- S3 media: IRSA only — static keys are forbidden in prod; no MinIO endpoint ---
    if (!env.S3_MEDIA_BUCKET) p.push('S3_MEDIA_BUCKET must be set in production');
    if (env.S3_ACCESS_KEY_ID || env.S3_SECRET_ACCESS_KEY) p.push('S3 static keys must be EMPTY in production (use the IRSA role, no long-lived keys)');
    if (env.S3_ENDPOINT) p.push('S3_ENDPOINT must be empty in production (real AWS S3, not MinIO/LocalStack)');

    // --- OpenSearch: if configured, must be TLS + authenticated ---
    if (env.OPENSEARCH_URL) {
      if (!/^https:\/\//.test(env.OPENSEARCH_URL)) p.push('OPENSEARCH_URL must use https in production');
      if (!env.OPENSEARCH_USERNAME || !env.OPENSEARCH_PASSWORD) p.push('OPENSEARCH_USERNAME/PASSWORD required when OpenSearch is configured');
    }

    // --- payments: a real gateway must be wired; its webhook secret must be strong (no sandbox in prod) ---
    if (!env.RAZORPAY_KEY_ID) p.push('RAZORPAY_KEY_ID must be set in production (no sandbox gateway for real money)');
    if (env.RAZORPAY_KEY_ID && weak16(env.RAZORPAY_WEBHOOK_SECRET)) p.push('RAZORPAY_WEBHOOK_SECRET (strong; verifies pay-in webhooks)');
    if (env.RAZORPAYX_KEY_ID && weak16(env.RAZORPAYX_WEBHOOK_SECRET)) p.push('RAZORPAYX_WEBHOOK_SECRET (strong; verifies payout webhooks) required when RazorpayX is configured');
    if (/sandbox-secret/.test(env.SANDBOX_WEBHOOK_SECRET ?? '')) p.push('SANDBOX_WEBHOOK_SECRET must not be the shared default in production');

    // --- external-provider webhook secrets: weak HMAC = forgeable callbacks ---
    if (env.NOTIFY_GATEWAY_URL && weak16(env.NOTIFY_WEBHOOK_SECRET)) p.push('NOTIFY_WEBHOOK_SECRET (strong) required when NOTIFY_GATEWAY_URL is set');
    if (env.MASKING_PROVIDER_URL && weak16(env.MASKING_WEBHOOK_SECRET)) p.push('MASKING_WEBHOOK_SECRET (strong) required when MASKING_PROVIDER_URL is set');

    // --- insurance Wave 7 external integrations (DEV-25, KV-BL-057): if a real provider URL is configured,
    // its api key must be a real secret, not a placeholder — these are outbound-only calls (no inbound
    // webhook in this integration-layer batch, so no webhook-secret check applies yet).
    if (env.PMFBY_PORTAL_URL && weak16(env.PMFBY_PORTAL_API_KEY)) p.push('PMFBY_PORTAL_API_KEY (strong) required when PMFBY_PORTAL_URL is set');
    if (env.SURVEYOR_DISPATCH_URL && weak16(env.SURVEYOR_DISPATCH_API_KEY)) p.push('SURVEYOR_DISPATCH_API_KEY (strong) required when SURVEYOR_DISPATCH_URL is set');
    if (env.VET_CERT_PROVIDER_URL && weak16(env.VET_CERT_PROVIDER_API_KEY)) p.push('VET_CERT_PROVIDER_API_KEY (strong) required when VET_CERT_PROVIDER_URL is set');

    // --- SMS/OTP: a real provider must be wired (noop drops messages → no real user can log in) ---
    if (env.SMS_PROVIDER === 'noop') p.push('SMS_PROVIDER must be msg91 or twilio in production (noop drops OTP texts — login impossible)');
    if (env.SMS_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_OTP_TEMPLATE_ID || !env.MSG91_SENDER_ID)) p.push('MSG91_AUTH_KEY + MSG91_OTP_TEMPLATE_ID + MSG91_SENDER_ID required when SMS_PROVIDER=msg91');
    if (env.SMS_PROVIDER === 'twilio' && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM)) p.push('TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM required when SMS_PROVIDER=twilio');

    // --- eKYC: the sandbox provider accepts a FIXED test OTP — it must NEVER run in production (identity backdoor).
    if ((env.EKYC_PROVIDER_KIND ?? 'sandbox') === 'sandbox') p.push('EKYC_PROVIDER_KIND must be a real provider (e.g. digilocker) in production — the sandbox accepts a fixed test OTP');
    if (env.EKYC_PROVIDER_KIND && env.EKYC_PROVIDER_KIND !== 'sandbox' && (!env.EKYC_PROVIDER_URL || weak16(env.EKYC_PROVIDER_API_KEY))) p.push('EKYC_PROVIDER_URL + strong EKYC_PROVIDER_API_KEY required when a real EKYC_PROVIDER_KIND is set');

    // --- bank fund-account tokeniser (P1-16): the sandbox returns a fake vault ref — it must NEVER run in production.
    if ((env.BANK_VAULT_KIND ?? 'sandbox') === 'sandbox') p.push('BANK_VAULT_KIND must be a real tokeniser (razorpayx) in production — the sandbox returns a fake vault ref');
    if (env.BANK_VAULT_KIND === 'razorpayx' && (!env.RAZORPAYX_KEY_ID || weak16(env.RAZORPAYX_KEY_SECRET))) p.push('RAZORPAYX_KEY_ID + strong RAZORPAYX_KEY_SECRET required when BANK_VAULT_KIND=razorpayx');

    // --- outbox relay (KV-BL-063): must run as kv_relay (BYPASSRLS), never localhost/kv_app/weak ---
    if (env.RELAY_ENABLED !== 'false') {
      const relayUrl = env.RELAY_DATABASE_URL && env.RELAY_DATABASE_URL.length > 0 ? env.RELAY_DATABASE_URL : env.DATABASE_URL;
      const u = AppConfig.tryParsePg(relayUrl);
      if (!u) p.push('RELAY_DATABASE_URL (or DATABASE_URL fallback) is not a valid postgres URL');
      else {
        if (u.user !== 'kv_relay') p.push('RELAY_DATABASE_URL must connect as kv_relay (the BYPASSRLS relay role, migration 0018), not kv_app/superuser');
        if (/^(localhost|127\.|::1|0\.0\.0\.0)/.test(u.host)) p.push('RELAY_DATABASE_URL must not point at localhost in production');
        if (!u.password || /^(postgres|password|dev|changeme|admin|secret)$/i.test(u.password) || u.password.length < 12) p.push('RELAY_DATABASE_URL must use a strong, non-default password (from Secrets Manager)'); // parity with primary DATABASE_URL denylist (S1 review advisory)
        if (u.sslDisabled) p.push('RELAY_DATABASE_URL must require TLS (sslmode=require), not disable it');
      }
    }

    // --- scheduled-jobs runner (P0-9-follow-on): same kv_relay/BYPASSRLS requirement as the outbox relay ---
    if (env.JOBS_ENABLED !== 'false') {
      const jobsUrl = (env.JOBS_DATABASE_URL && env.JOBS_DATABASE_URL.length > 0) ? env.JOBS_DATABASE_URL
        : (env.RELAY_DATABASE_URL && env.RELAY_DATABASE_URL.length > 0) ? env.RELAY_DATABASE_URL : env.DATABASE_URL;
      const u = AppConfig.tryParsePg(jobsUrl);
      if (!u) p.push('JOBS_DATABASE_URL (or RELAY_DATABASE_URL/DATABASE_URL fallback) is not a valid postgres URL');
      else {
        if (u.user !== 'kv_relay') p.push('JOBS_DATABASE_URL must connect as kv_relay (the BYPASSRLS relay role, migration 0018), not kv_app/superuser');
        if (/^(localhost|127\.|::1|0\.0\.0\.0)/.test(u.host)) p.push('JOBS_DATABASE_URL must not point at localhost in production');
        if (!u.password || /^(postgres|password|dev|changeme|admin|secret)$/i.test(u.password) || u.password.length < 12) p.push('JOBS_DATABASE_URL must use a strong, non-default password (from Secrets Manager)');
        if (u.sslDisabled) p.push('JOBS_DATABASE_URL must require TLS (sslmode=require), not disable it');
      }
    }

    // --- P0-13 decommission dev affordances: catch these at BOOT, not at the first upload/intent ---
    // Media downloads are gated on a CLEAN AV scan; the scan-result webhook is HMAC-verified with MEDIA_SCAN_SECRET.
    // An empty/weak secret means the webhook rejects every scan (no media ever clears) — fail at boot, not silently.
    if (weak16(env.MEDIA_SCAN_SECRET)) p.push('MEDIA_SCAN_SECRET (strong; verifies the AV scan-result webhook) required in production');
    // The deterministic sandbox payment gateway is never registered in prod — selecting it as the default would
    // break new intents (or, worse, route real money through a fake). Forbid it at boot.
    if (env.PAYMENTS_DEFAULT_PROVIDER === 'sandbox') p.push('PAYMENTS_DEFAULT_PROVIDER must not be "sandbox" in production (no fake money rail)');

    return p;
  }

  /** Best-effort parse of a postgres URL into {host,user,password,sslDisabled}. Returns null if unparseable. */
  private static tryParsePg(url: string): { host: string; user: string; password: string; sslDisabled: boolean } | null {
    try {
      const u = new URL(url);
      if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
      return {
        host: u.hostname,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        sslDisabled: /sslmode=disable/i.test(u.search),
      };
    } catch {
      return null;
    }
  }

  get nodeEnv()    { return this.env.NODE_ENV; }
  get port()       { return this.env.PORT; }
  get isProd()     { return this.env.NODE_ENV === 'production'; }
  get shardCount() { return this.env.SHARD_COUNT; }
  /** Tenant-integration credential vault (P1-11). backend 'local' = dev no-op; 'aws' = Secrets Manager. */
  get integrationSecrets() { return { backend: this.env.INTEGRATION_SECRETS_BACKEND, region: this.env.AWS_REGION, prefix: this.env.INTEGRATION_SECRET_PREFIX }; }
  /** Tenant-webhook signing-secret encryption key (P1-11). Empty = unset (fail-closed in prod). */
  get webhookSigningKek() { return this.env.WEBHOOK_SIGNING_KEK; }
  get trustProxyHops() { return this.env.TRUST_PROXY_HOPS; }
  /** CORS allowlist for the 4 Next.js web apps. Empty ⇒ CORS left off entirely (main.ts skips app.enableCors,
   *  matching today's no-CORS behavior byte-for-byte). Mobile apps + server-to-server webhooks send no Origin
   *  header, so they are never affected by this list either way. */
  get corsOrigins(): string[] { return this.env.WEB_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean); }

  get db() {
    return {
      writerUrl: this.env.DATABASE_URL,
      replicaUrl: this.env.DATABASE_REPLICA_URL && this.env.DATABASE_REPLICA_URL.length > 0
        ? this.env.DATABASE_REPLICA_URL : this.env.DATABASE_URL,
      poolMax: this.env.DATABASE_POOL_MAX,
    };
  }
  get redis()  { return { url: this.env.REDIS_URL ?? null }; }
  get search() { return { url: this.env.OPENSEARCH_URL ?? null, username: this.env.OPENSEARCH_USERNAME ?? null, password: this.env.OPENSEARCH_PASSWORD ?? null, indexPrefix: this.env.OPENSEARCH_INDEX_PREFIX }; }
  get jwt()    { return { accessSecret: this.env.JWT_ACCESS_SECRET, issuer: this.env.JWT_ISSUER, audience: this.env.JWT_AUDIENCE }; }
  get auth() {
    return {
      accessSecret: this.env.JWT_ACCESS_SECRET,
      refreshSecret: this.env.JWT_REFRESH_SECRET,
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
      accessTtlSec: this.env.JWT_ACCESS_TTL_SEC,
      refreshTtlSec: this.env.JWT_REFRESH_TTL_SEC,
      hashPepper: this.env.AUTH_HASH_PEPPER,
      otp: {
        ttlSec: this.env.OTP_TTL_SEC,
        length: this.env.OTP_LENGTH,
        maxVerifyAttempts: this.env.OTP_MAX_VERIFY_ATTEMPTS,
        requestMaxPerHour: this.env.OTP_REQUEST_MAX_PER_HOUR,
        resendCooldownSec: this.env.OTP_RESEND_COOLDOWN_SEC,
        verifyMaxPerHour: this.env.OTP_VERIFY_MAX_PER_HOUR,
      },
      exposeOtp: this.env.AUTH_EXPOSE_OTP !== undefined ? this.env.AUTH_EXPOSE_OTP === 'true' : this.env.NODE_ENV === 'test',
    };
  }
  get media() {
    return {
      region: this.env.AWS_REGION,
      bucket: this.env.S3_MEDIA_BUCKET,
      accessKeyId: this.env.S3_ACCESS_KEY_ID,
      secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
      endpoint: this.env.S3_ENDPOINT ?? null,
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE === 'true',
      presignExpirySec: this.env.S3_PRESIGN_EXPIRY_SEC,
      scanSecret: this.env.MEDIA_SCAN_SECRET,
      maxUploadBytes: this.env.MEDIA_MAX_UPLOAD_BYTES,
    };
  }
  get wallet() { return { grpcUrl: this.env.WALLET_GRPC_URL }; }
  /** Outbox relay timer (KV-BL-063): in-process runner that drains OutboxDispatcher on an interval.
   * databaseUrl MUST resolve to the kv_relay BYPASSRLS role in production (assertProductionSecurity
   * enforces it); falls back to DATABASE_URL for local dev where a single role often has both. */
  get relay() {
    const url = this.env.RELAY_DATABASE_URL && this.env.RELAY_DATABASE_URL.length > 0
      ? this.env.RELAY_DATABASE_URL : this.env.DATABASE_URL;
    return {
      enabled: this.env.RELAY_ENABLED !== 'false',
      databaseUrl: url,
      poolMax: this.env.RELAY_POOL_MAX,
      intervalMs: this.env.RELAY_INTERVAL_MS,
      batchSize: this.env.RELAY_BATCH_SIZE,
    };
  }
  /** Scheduled-jobs runner (P0-9-follow-on): in-process host for the pilot's CADENCE-driven
   * domain-handler jobs (core/jobs/jobs.runner.ts) — the time-based sibling of `relay` above. Falls
   * back to the relay's kv_relay URL, then DATABASE_URL, for local dev where one role has both. */
  get jobs() {
    const url = (this.env.JOBS_DATABASE_URL && this.env.JOBS_DATABASE_URL.length > 0) ? this.env.JOBS_DATABASE_URL
      : (this.env.RELAY_DATABASE_URL && this.env.RELAY_DATABASE_URL.length > 0) ? this.env.RELAY_DATABASE_URL : this.env.DATABASE_URL;
    return {
      enabled: this.env.JOBS_ENABLED !== 'false',
      databaseUrl: url,
      poolMax: this.env.JOBS_POOL_MAX,
      settlementStatements: {
        enabled: this.env.SETTLEMENT_STATEMENTS_JOB_ENABLED !== 'false',
        intervalMs: this.env.SETTLEMENT_STATEMENTS_JOB_INTERVAL_MS,
      },
      // KV-BL-P0-9-follow-on: KYC-expiry reminders, wired now that the identity bank-KYC gate has
      // landed (kyc_documents.valid_until is populated for verified docs). Same per-job env-gate
      // convention as settlementStatements above, independent of the runner-wide JOBS_ENABLED switch.
      kycExpiryReminders: {
        enabled: this.env.KYC_EXPIRY_JOB_ENABLED !== 'false',
        intervalMs: this.env.KYC_EXPIRY_JOB_INTERVAL_MS,
      },
      // S5 review P0: payout disbursement was completely unwired (PayoutExecutionJob existed, ran
      // nowhere). Frequent cadence (default every 5 min) — same per-job env-gate convention as the
      // two jobs above, independent of the runner-wide JOBS_ENABLED switch.
      payoutExecution: {
        enabled: this.env.PAYOUT_EXECUTION_JOB_ENABLED !== 'false',
        intervalMs: this.env.PAYOUT_EXECUTION_JOB_INTERVAL_MS,
        batchSize: this.env.PAYOUT_EXECUTION_JOB_BATCH_SIZE,
      },
    };
  }
  get razorpay(){ return { keyId: this.env.RAZORPAY_KEY_ID, webhookSecret: this.env.RAZORPAY_WEBHOOK_SECRET }; }
  /** Full payments wiring. All env reads for payment gateways live HERE (never process.env in modules). */
  get payments() {
    const isProd = this.env.NODE_ENV === 'production';
    return {
      isProd,
      defaultProvider: this.env.PAYMENTS_DEFAULT_PROVIDER,
      razorpay: {
        keyId: this.env.RAZORPAY_KEY_ID,
        keySecret: this.env.RAZORPAY_KEY_SECRET,
        webhookSecret: this.env.RAZORPAY_WEBHOOK_SECRET,
        baseUrl: this.env.RAZORPAY_BASE_URL ?? undefined,
        configured: this.env.RAZORPAY_KEY_ID.length > 0,
      },
      razorpayx: {
        keyId: this.env.RAZORPAYX_KEY_ID,
        keySecret: this.env.RAZORPAYX_KEY_SECRET,
        accountNumber: this.env.RAZORPAYX_ACCOUNT_NUMBER,
        baseUrl: this.env.RAZORPAYX_BASE_URL ?? undefined,
        webhookSecret: this.env.RAZORPAYX_WEBHOOK_SECRET,
        configured: this.env.RAZORPAYX_KEY_ID.length > 0,
      },
      // Resolved payout-webhook HMAC secret. NEVER falls back to a shared literal in production
      // (so a forged callback can't be accepted on a default secret — fail closed).
      payoutWebhookSecret:
        this.env.RAZORPAYX_WEBHOOK_SECRET || this.env.SANDBOX_WEBHOOK_SECRET || (isProd ? '' : 'sandbox-secret'),
      // Whether the deterministic sandbox gateway may be registered (NON-prod only).
      allowSandbox: !isProd,
    };
  }
  get smsBudgetPaise() { return this.env.SMS_DAILY_BUDGET_PAISE; }
  /** SMS/OTP delivery wiring. All SMS env reads live here. */
  get sms() {
    return {
      provider: this.env.SMS_PROVIDER,
      msg91: {
        authKey: this.env.MSG91_AUTH_KEY,
        senderId: this.env.MSG91_SENDER_ID,
        otpTemplateId: this.env.MSG91_OTP_TEMPLATE_ID,
        // DLT approves each language's exact SMS text as a SEPARATE template — a farmer requesting the OTP in
        // hi/gu should get the DLT template registered for THAT language, not whatever the default happens to be.
        // Any locale left unset here falls back to `otpTemplateId` (single-template deployments keep working).
        otpTemplateIdByLocale: {
          ...(this.env.MSG91_OTP_TEMPLATE_ID_EN ? { en: this.env.MSG91_OTP_TEMPLATE_ID_EN } : {}),
          ...(this.env.MSG91_OTP_TEMPLATE_ID_HI ? { hi: this.env.MSG91_OTP_TEMPLATE_ID_HI } : {}),
          ...(this.env.MSG91_OTP_TEMPLATE_ID_GU ? { gu: this.env.MSG91_OTP_TEMPLATE_ID_GU } : {}),
        },
        baseUrl: this.env.MSG91_BASE_URL,
        configured: this.env.MSG91_AUTH_KEY.length > 0 && this.env.MSG91_OTP_TEMPLATE_ID.length > 0,
      },
      twilio: {
        accountSid: this.env.TWILIO_ACCOUNT_SID,
        authToken: this.env.TWILIO_AUTH_TOKEN,
        from: this.env.TWILIO_FROM,
        configured: this.env.TWILIO_ACCOUNT_SID.length > 0 && this.env.TWILIO_AUTH_TOKEN.length > 0 && this.env.TWILIO_FROM.length > 0,
      },
      dailyBudgetPaise: this.env.SMS_DAILY_BUDGET_PAISE,
    };
  }
  get notifications() {
    return {
      gatewayUrl: this.env.NOTIFY_GATEWAY_URL || null,   // null ⇒ noop gateway (dev) / drop (prod)
      gatewayApiKey: this.env.NOTIFY_GATEWAY_API_KEY,
      webhookSecret: this.env.NOTIFY_WEBHOOK_SECRET,
    };
  }
  get push() {
    // First-party PUSH transport (P0-10). Default provider is Expo (no key required for basic sends; an access
    // token raises rate limits + adds auth). PUSH_PROVIDER='none' forces the noop sender (drops in prod, accepts
    // in dev). The token is a provider secret — read here, never logged.
    return {
      provider: (this.env.PUSH_PROVIDER || 'expo').toLowerCase(),   // 'expo' | 'none'
      expoBaseUrl: this.env.EXPO_PUSH_URL || 'https://exp.host',
      expoAccessToken: this.env.EXPO_ACCESS_TOKEN || null,
    };
  }
  get ekyc() {
    // eKYC provider (P0-11). Default 'sandbox' (dev/test only — accepts a fixed OTP; assertProductionSecurity
    // forbids it in prod). A real provider needs URL + api key (secrets, never logged). Gated by the `kyc` flag.
    return {
      kind: (this.env.EKYC_PROVIDER_KIND || 'sandbox').toLowerCase(),   // 'sandbox' | 'digilocker' | …
      baseUrl: this.env.EKYC_PROVIDER_URL || '',
      apiKey: this.env.EKYC_PROVIDER_API_KEY || '',
    };
  }
  get bankVault() {
    // Bank fund-account tokeniser (P1-16). Default 'sandbox' (dev/test only — returns a local token;
    // assertProductionSecurity forbids it in prod). The real adapter (razorpayx) reuses the RAZORPAYX_* creds.
    return {
      kind: (this.env.BANK_VAULT_KIND || 'sandbox').toLowerCase(),      // 'sandbox' | 'razorpayx'
      baseUrl: this.env.RAZORPAYX_BASE_URL ?? undefined,
      keyId: this.env.RAZORPAYX_KEY_ID,
      keySecret: this.env.RAZORPAYX_KEY_SECRET,
    };
  }
  get weather() {
    // Geocoded forecast provider (P0-12). Default Open-Meteo public endpoint (free, no key); an IMD/Skymet
    // aggregator drops in via WEATHER_PROVIDER_URL + key. `enabled` ⇒ bind the HTTP adapter; otherwise the
    // noop/degrade adapter (always falls back to regional advisory — a forecast is never fabricated).
    const kind = (this.env.WEATHER_PROVIDER_KIND || 'open-meteo').toLowerCase();
    const baseUrl = this.env.WEATHER_PROVIDER_URL || (kind === 'open-meteo' ? 'https://api.open-meteo.com' : '');
    // P1-4: reverse-geocoder for the header place-name (BigDataCloud public endpoint by default — free, no key).
    // Best-effort: `enabled` ⇒ bind the HTTP adapter; otherwise the noop (returns null → generic "your area").
    const geocodeKind = (this.env.WEATHER_GEOCODE_KIND || 'bigdatacloud').toLowerCase();
    const geocodeUrl = this.env.WEATHER_GEOCODE_URL || (geocodeKind === 'bigdatacloud' ? 'https://api.bigdatacloud.net' : '');
    return {
      kind,
      enabled: kind !== 'none' && !!baseUrl,
      baseUrl,
      apiKey: this.env.WEATHER_PROVIDER_API_KEY || '',
      cacheTtlSec: this.env.WEATHER_CACHE_TTL_SEC,   // forecast cache TTL (cost/rate-limit control)
      forecastDays: this.env.WEATHER_FORECAST_DAYS,
      geocode: {
        kind: geocodeKind,
        enabled: geocodeKind !== 'none' && !!geocodeUrl,
        baseUrl: geocodeUrl,
        apiKey: this.env.WEATHER_GEOCODE_API_KEY || '',
      },
    };
  }
  get assistant() {
    // Governed farmer AI assistant (P1-13). Calls the internal ai-services tier over s2s (shared secret bearer),
    // resilience-wrapped. `enabled` ⇒ bind the HTTP adapter; otherwise the noop/degrade adapter (returns a
    // needs_review result — NEVER a fabricated answer). Per-user caps bound cost + abuse.
    const baseUrl = (this.env.AI_SERVICES_URL || '').replace(/\/$/, '');
    return {
      enabled: !!baseUrl && !!this.env.AI_SERVICES_SHARED_SECRET,
      baseUrl,
      sharedSecret: this.env.AI_SERVICES_SHARED_SECRET || '',
      timeoutMs: this.env.AI_SERVICES_TIMEOUT_MS,
      dailyCap: this.env.AI_ASSISTANT_DAILY_CAP,
      perMinuteCap: this.env.AI_ASSISTANT_PER_MINUTE_CAP,
    };
  }
  get masking() {
    return {
      providerUrl: this.env.MASKING_PROVIDER_URL || null,   // null ⇒ noop masking provider
      providerApiKey: this.env.MASKING_PROVIDER_API_KEY,
      webhookSecret: this.env.MASKING_WEBHOOK_SECRET,
    };
  }
  get insurance() {
    // Wave 7 external integrations (DEV-25, KV-BL-057): PMFBY govt portal sync, surveyor-network dispatch,
    // vet-certificate verification. Each is OFF (noop, honest degrade) until a URL is configured — no named
    // commercial partner is contracted in this environment, per the founder's own §8 provider-account rule.
    return {
      pmfby: { baseUrl: this.env.PMFBY_PORTAL_URL || null, apiKey: this.env.PMFBY_PORTAL_API_KEY },
      surveyorDispatch: { baseUrl: this.env.SURVEYOR_DISPATCH_URL || null, apiKey: this.env.SURVEYOR_DISPATCH_API_KEY },
      vetCert: { baseUrl: this.env.VET_CERT_PROVIDER_URL || null, apiKey: this.env.VET_CERT_PROVIDER_API_KEY },
    };
  }
  get streaming() {
    return {
      providerUrl: this.env.STREAM_PROVIDER_URL || null,    // null ⇒ noop stream provider
      providerApiKey: this.env.STREAM_PROVIDER_API_KEY,
    };
  }
}
