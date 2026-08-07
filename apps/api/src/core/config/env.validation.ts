// core/config/env.validation.ts
// Validates EVERY env var at boot — a missing/invalid variable crashes the pod
// at startup (loudly), never at 2 AM mid-request. Add every new variable HERE
// first. Infra essentials are required; integrations default to empty so the
// API can boot for the listings slice without the whole platform configured.
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1), // # of trusted proxies/LB hops in front of the API
  // CORS allowlist for the 4 Next.js web apps (tenant/admin/storefront/partner) that call this API from the
  // browser — comma-separated exact origins, e.g. "https://sell.krishalaya.com,https://admin.krishalaya.com".
  // Mobile apps and server-to-server webhooks never send an Origin header and are unaffected either way.
  // Empty (default) ⇒ CORS is left OFF entirely — identical to today's (no-CORS) behavior. Required in
  // production (assertProductionSecurity) once real web-app origins exist.
  WEB_ORIGINS: z.string().default(''),

  // --- data stores (required) ---
  DATABASE_URL: z.string().min(1),
  DATABASE_REPLICA_URL: z.string().optional(),          // defaults to DATABASE_URL
  DATABASE_POOL_MAX: z.coerce.number().min(1).max(200).default(20),
  SHARD_COUNT: z.coerce.number().min(1).max(4096).default(1),

  // --- auth (required) ---
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ISSUER: z.string().default('krishalaya'),
  JWT_AUDIENCE: z.string().default('krishalaya-api'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-32x'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),        // 15 min
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(2592000),   // 30 days
  AUTH_HASH_PEPPER: z.string().min(16).default('dev-pepper-change-me-min-32-chars!'),
  // --- PC-56 ADMIN-9b: honouring an admin-realm act-as token ---
  // The DEDICATED secret admin-api signs act-as tokens with. NOT the access secret and not the refresh secret: the
  // god-mode realm must never hold the key that mints ordinary user sessions, which is the property that made an
  // un-upgraded apps/api fail closed. Empty by default and empty means OFF — an impersonation bearer is then simply an
  // unrecognised token and produces the ordinary 401.
  IMPERSONATION_TOKEN_SECRET: z.string().default(''),
  IMPERSONATION_TOKEN_ISSUER: z.string().default('krishalaya-admin'),
  IMPERSONATION_TOKEN_AUDIENCE: z.string().default('krishalaya-api'),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),               // 5 min
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_REQUEST_MAX_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(30),
  OTP_VERIFY_MAX_PER_HOUR: z.coerce.number().int().positive().default(30),
  // Whether /auth/otp may return the code in its response. MUST be false in prod
  // (AppConfig fails boot if true in production). Defaults to true only under test.
  AUTH_EXPOSE_OTP: z.enum(['true', 'false']).optional(),

  // --- optional infra / integrations (empty-safe defaults) ---
  REDIS_URL: z.string().optional(),                     // absent ⇒ in-memory cache
  OPENSEARCH_URL: z.string().optional(),                // absent ⇒ replica-backed search
  OPENSEARCH_USERNAME: z.string().optional(),           // optional basic-auth for the OpenSearch cluster
  OPENSEARCH_PASSWORD: z.string().optional(),
  OPENSEARCH_INDEX_PREFIX: z.string().default('kv'),    // namespaces indices, e.g. kv_listings
  WALLET_GRPC_URL: z.string().default(''),
  AWS_REGION: z.string().default('ap-south-1'),
  S3_MEDIA_BUCKET: z.string().default(''),
  // tenant-integrations credential vault (P1-11). 'local' = dev no-op (discards plaintext); 'aws' = Secrets Manager.
  INTEGRATION_SECRETS_BACKEND: z.enum(['local', 'aws']).default('local'),
  INTEGRATION_SECRET_PREFIX: z.string().default('krishi/tenant-integrations'),
  // tenant-webhooks signing-secret encryption key (P1-11). 32 bytes (hex or base64); fail-closed in prod if unset.
  WEBHOOK_SIGNING_KEK: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),             // empty ⇒ use the instance IAM role (no static keys)
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_ENDPOINT: z.string().optional(),                   // set for MinIO/LocalStack; absent ⇒ AWS S3
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),  // MinIO needs path-style addressing
  S3_PRESIGN_EXPIRY_SEC: z.coerce.number().int().positive().max(604800).default(900), // 15 min (max 7d)
  MEDIA_SCAN_SECRET: z.string().default(''),            // HMAC secret for the AV scan-result webhook
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(52428800), // 50 MiB default cap
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  RAZORPAY_BASE_URL: z.string().optional(),
  PAYMENTS_DEFAULT_PROVIDER: z.string().default('razorpay'),
  // money-OUT (RazorpayX). Empty ⇒ deterministic sandbox payout gateway (non-prod only).
  RAZORPAYX_KEY_ID: z.string().default(''),
  RAZORPAYX_KEY_SECRET: z.string().default(''),
  RAZORPAYX_ACCOUNT_NUMBER: z.string().default(''),
  RAZORPAYX_BASE_URL: z.string().optional(),
  RAZORPAYX_WEBHOOK_SECRET: z.string().default(''),
  SANDBOX_WEBHOOK_SECRET: z.string().default(''),
  // --- SMS / OTP delivery ---
  // noop = log only (dev). msg91 = Indian DLT gateway (prod default). twilio = global fallback.
  SMS_PROVIDER: z.enum(['noop', 'msg91', 'twilio']).default('noop'),
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_SENDER_ID: z.string().default(''),              // DLT-registered 6-char header
  MSG91_OTP_TEMPLATE_ID: z.string().default(''),        // DLT-approved OTP template id (carries the {code} var) — default/fallback locale
  // Optional PER-LANGUAGE DLT template ids (DLT approves each language's exact text as a SEPARATE template).
  // Unset ⇒ falls back to MSG91_OTP_TEMPLATE_ID for that locale (e.g. only one language registered so far).
  MSG91_OTP_TEMPLATE_ID_HI: z.string().default(''),
  MSG91_OTP_TEMPLATE_ID_GU: z.string().default(''),
  MSG91_OTP_TEMPLATE_ID_EN: z.string().default(''),
  MSG91_BASE_URL: z.string().default('https://control.msg91.com'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM: z.string().default(''),                  // sender number / messaging-service SID
  SMS_DAILY_BUDGET_PAISE: z.coerce.number().nonnegative().default(0),
  NOTIFY_GATEWAY_URL: z.string().default(''),           // external notification product base URL; absent ⇒ noop gateway
  NOTIFY_GATEWAY_API_KEY: z.string().default(''),
  NOTIFY_WEBHOOK_SECRET: z.string().default(''),        // HMAC secret for the delivery-status callback
  EKYC_PROVIDER_KIND: z.string().default('sandbox'),    // eKYC: 'sandbox' (dev) | 'digilocker'… (prod fail-closed)
  EKYC_PROVIDER_URL: z.string().default(''),            // external eKYC base URL (required for a real provider)
  EKYC_PROVIDER_API_KEY: z.string().default(''),        // eKYC api key (secret; never logged)
  BANK_VAULT_KIND: z.string().default('sandbox'),       // bank fund-account tokeniser (P1-16): 'sandbox' (dev) | 'razorpayx' (prod fail-closed)
  PUSH_PROVIDER: z.string().default('expo'),            // first-party push sender: 'expo' (default) | 'none' (noop)
  EXPO_PUSH_URL: z.string().default(''),                // Expo push base (default https://exp.host)
  EXPO_ACCESS_TOKEN: z.string().default(''),            // optional Expo access token (raises rate limits + auth)
  MASKING_PROVIDER_URL: z.string().default(''),         // external number-masking telephony provider; absent ⇒ noop
  MASKING_PROVIDER_API_KEY: z.string().default(''),
  MASKING_WEBHOOK_SECRET: z.string().default(''),       // HMAC secret for the call-status callback
  STREAM_PROVIDER_URL: z.string().default(''),          // external live-streaming provider; absent ⇒ noop
  STREAM_PROVIDER_API_KEY: z.string().default(''),
  // --- insurance Wave 7 external integrations (DEV-25, KV-BL-057): PMFBY govt portal, surveyor-network
  // dispatch, vet-certificate verification. No named commercial partner is contracted yet (§8) — every
  // adapter below is OUR domain-shaped port; absent URL ⇒ the honest noop adapter (never a fabricated
  // success). Auto-debit/e-NACH reuses the EXISTING payments-module UPI-AutoPay mandate machinery
  // (MANDATE_GATEWAY/autopay_execution) — no separate provider env is introduced for it.
  PMFBY_PORTAL_URL: z.string().default(''),             // govt PMFBY portal base URL; absent ⇒ noop (no invented gov API)
  PMFBY_PORTAL_API_KEY: z.string().default(''),
  SURVEYOR_DISPATCH_URL: z.string().default(''),        // external surveyor-network dispatch base URL; absent ⇒ noop
  SURVEYOR_DISPATCH_API_KEY: z.string().default(''),
  VET_CERT_PROVIDER_URL: z.string().default(''),        // veterinary-certificate verification service base URL; absent ⇒ noop
  VET_CERT_PROVIDER_API_KEY: z.string().default(''),
  // --- geocoded weather forecast (P0-12) ---
  WEATHER_PROVIDER_KIND: z.string().default('open-meteo'),   // 'open-meteo' (default, free) | 'imd' | 'none' (degrade)
  WEATHER_PROVIDER_URL: z.string().default(''),              // override base URL (aggregator); default open-meteo public
  WEATHER_PROVIDER_API_KEY: z.string().default(''),          // optional api key (aggregators that require one)
  WEATHER_CACHE_TTL_SEC: z.coerce.number().int().positive().max(86400).default(3600),  // 1h forecast cache (cost cap)
  WEATHER_FORECAST_DAYS: z.coerce.number().int().min(1).max(16).default(7),
  // P1-4 reverse-geocoder for the weather header place-name (best-effort; 'none' ⇒ generic label)
  WEATHER_GEOCODE_KIND: z.string().default('bigdatacloud'),   // 'bigdatacloud' (default, free) | 'none' (degrade)
  WEATHER_GEOCODE_URL: z.string().default(''),               // override base URL; default bigdatacloud public
  WEATHER_GEOCODE_API_KEY: z.string().default(''),           // optional api key
  // --- governed farmer AI assistant (P1-13) ---
  AI_SERVICES_URL: z.string().default(''),                   // base URL of the internal ai-services tier; '' ⇒ degrade
  AI_SERVICES_SHARED_SECRET: z.string().default(''),         // s2s bearer (must match ai-services API_SHARED_SECRET)
  AI_SERVICES_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(12000),
  AI_ASSISTANT_DAILY_CAP: z.coerce.number().int().min(1).max(1000).default(50),     // per-user/day message cap (cost guard)
  AI_ASSISTANT_PER_MINUTE_CAP: z.coerce.number().int().min(1).max(120).default(6),  // per-user/min burst cap (abuse guard)

  // --- outbox relay timer (KV-BL-063) ---
  // The api runs the transactional-outbox relay (core/outbox/outbox.dispatcher.ts) on an in-process
  // timer so cross-module event handlers actually fire (payment_succeeded -> order confirmed,
  // orders.order_completed -> escrow release + notification fan-out, …). See ADR-0001's 2026-07-10
  // amendment for why this runs here rather than as a standalone satellite service.
  RELAY_ENABLED: z.enum(['true', 'false']).default('true'),
  // Dedicated connection for the relay — MUST be the kv_relay BYPASSRLS role (migration 0018), never
  // kv_app (RLS-scoped; cannot see other tenants' pending events). Empty ⇒ falls back to DATABASE_URL
  // (local dev convenience only); assertProductionSecurity requires the kv_relay role name in prod.
  RELAY_DATABASE_URL: z.string().optional(),
  RELAY_POOL_MAX: z.coerce.number().int().min(1).max(20).default(4),
  RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(750),      // tick cadence
  RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),          // max events claimed per tick

  // --- scheduled-jobs runner (P0-9-follow-on) ---
  // The api hosts the pilot's CADENCE-driven domain-handler jobs (core/jobs/jobs.runner.ts) the same
  // way RELAY_* above hosts the EVENT-driven outbox relay — see WORKER-RUNTIME.md "Deferred:
  // domain-handler jobs" + ADR-0001's amendment. Each registered job also runs under its own Postgres
  // advisory lock (multi-pod safe), so N api pods each running this timer never double-run a job.
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  // Dedicated connection — MUST be kv_relay (BYPASSRLS), same reasoning as RELAY_DATABASE_URL: cadence
  // jobs like settlement-statement generation scan un-statemented lines ACROSS every tenant. Empty ⇒
  // falls back to RELAY_DATABASE_URL, then DATABASE_URL (local dev convenience only).
  JOBS_DATABASE_URL: z.string().optional(),
  JOBS_POOL_MAX: z.coerce.number().int().min(1).max(20).default(2),
  // --- settlement-statements cadence job ---
  SETTLEMENT_STATEMENTS_JOB_ENABLED: z.enum(['true', 'false']).default('true'),
  SETTLEMENT_STATEMENTS_JOB_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(86_400_000), // default: once/day
  // --- kyc-expiry-reminders cadence job (wave-1 follow-on; identity bank-KYC gate now lifted this) ---
  KYC_EXPIRY_JOB_ENABLED: z.enum(['true', 'false']).default('true'),
  KYC_EXPIRY_JOB_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(86_400_000), // default: once/day
  // --- payout-execution cadence job (S5 review P0: PayoutExecutionJob existed but was registered
  // NOWHERE — a queued payout (POST /v1/payouts) never disbursed to the bank). Frequent cadence
  // (default 5 min, NOT the once/day settlement-statements default) — a labourer/seller's wallet
  // funds are already reserved once queued, so this must not wait a day like a reporting job.
  PAYOUT_EXECUTION_JOB_ENABLED: z.enum(['true', 'false']).default('true'),
  PAYOUT_EXECUTION_JOB_INTERVAL_MS: z.coerce.number().int().min(30_000).max(86_400_000).default(300_000), // default: every 5 min
  PAYOUT_EXECUTION_JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100), // max payouts claimed per tick
});

export type Env = z.infer<typeof EnvSchema>;
export const validateEnv = (cfg: Record<string, unknown>): Env => EnvSchema.parse(cfg);
