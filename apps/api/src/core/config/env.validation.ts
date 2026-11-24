// core/config/env.validation.ts
// Validates EVERY env var at boot — a missing/invalid variable crashes the pod
// at startup (loudly), never at 2 AM mid-request. Add every new variable HERE
// first. Infra essentials are required; integrations default to empty so the
// API can boot for the listings slice without the whole platform configured.
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).prefault('development'),
  PORT: z.coerce.number().prefault(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).prefault(1), // # of trusted proxies/LB hops in front of the API
  // CORS allowlist for the 4 Next.js web apps (tenant/admin/storefront/partner) that call this API from the
  // browser — comma-separated exact origins, e.g. "https://sell.krishalaya.com,https://admin.krishalaya.com".
  // Mobile apps and server-to-server webhooks never send an Origin header and are unaffected either way.
  // Empty (default) ⇒ CORS is left OFF entirely — identical to today's (no-CORS) behavior. Required in
  // production (assertProductionSecurity) once real web-app origins exist.
  WEB_ORIGINS: z.string().prefault(''),
  // PC-56 TENANT-13d · the hosts the API itself answers on (never a tenant Host lookup when `tenant_host_routing` is on); comma-separated.
  PLATFORM_HOSTS: z.string().prefault(''),

  // --- data stores (required) ---
  DATABASE_URL: z.string().min(1),
  DATABASE_REPLICA_URL: z.string().optional(),          // defaults to DATABASE_URL
  DATABASE_POOL_MAX: z.coerce.number().min(1).max(200).prefault(20),
  SHARD_COUNT: z.coerce.number().min(1).max(4096).prefault(1),

  // --- auth (required) ---
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ISSUER: z.string().prefault('krishalaya'),
  JWT_AUDIENCE: z.string().prefault('krishalaya-api'),
  JWT_REFRESH_SECRET: z.string().min(16).prefault('dev-refresh-secret-change-me-32x'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().prefault(900),        // 15 min
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().prefault(2592000),   // 30 days
  AUTH_HASH_PEPPER: z.string().min(16).prefault('dev-pepper-change-me-min-32-chars!'),
  // --- PC-56 ADMIN-9b: honouring an admin-realm act-as token ---
  // The DEDICATED secret admin-api signs act-as tokens with. NOT the access secret and not the refresh secret: the
  // god-mode realm must never hold the key that mints ordinary user sessions, which is the property that made an
  // un-upgraded apps/api fail closed. Empty by default and empty means OFF — an impersonation bearer is then simply an
  // unrecognised token and produces the ordinary 401.
  IMPERSONATION_TOKEN_SECRET: z.string().prefault(''),
  IMPERSONATION_TOKEN_ISSUER: z.string().prefault('krishalaya-admin'),
  IMPERSONATION_TOKEN_AUDIENCE: z.string().prefault('krishalaya-api'),
  // --- PC-56 STORE-1a · A1 (founder D3): the storefront server's signed client-IP header (core/http/client-ip.ts) ---
  // Shared with apps/web-storefront (its server env, never NEXT_PUBLIC). Unset = the forwarded address is never honoured (every
  // request is accounted to req.ip, the pre-STORE-1a behaviour). Production REQUIRES it (AppConfig.collectProductionProblems).
  STOREFRONT_CALLER_SECRET: z.union([z.literal(''), z.string().min(32)]).optional(),   // '' (an empty .env line) = unset
  OTP_TTL_SEC: z.coerce.number().int().positive().prefault(300),               // 5 min
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).prefault(6),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().prefault(5),
  OTP_REQUEST_MAX_PER_HOUR: z.coerce.number().int().positive().prefault(5),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().prefault(30),
  OTP_VERIFY_MAX_PER_HOUR: z.coerce.number().int().positive().prefault(30),
  // Whether /auth/otp may return the code in its response. MUST be false in prod
  // (AppConfig fails boot if true in production). Defaults to true only under test.
  AUTH_EXPOSE_OTP: z.enum(['true', 'false']).optional(),

  // --- optional infra / integrations (empty-safe defaults) ---
  REDIS_URL: z.string().optional(),                     // absent ⇒ in-memory cache
  OPENSEARCH_URL: z.string().optional(),                // absent ⇒ replica-backed search
  OPENSEARCH_USERNAME: z.string().optional(),           // optional basic-auth for the OpenSearch cluster
  OPENSEARCH_PASSWORD: z.string().optional(),
  OPENSEARCH_INDEX_PREFIX: z.string().prefault('kv'),    // namespaces indices, e.g. kv_listings
  WALLET_GRPC_URL: z.string().prefault(''),
  AWS_REGION: z.string().prefault('ap-south-1'),
  S3_MEDIA_BUCKET: z.string().prefault(''),
  // tenant-integrations credential vault (P1-11). 'local' = dev no-op (discards plaintext); 'aws' = Secrets Manager.
  INTEGRATION_SECRETS_BACKEND: z.enum(['local', 'aws']).prefault('local'),
  INTEGRATION_SECRET_PREFIX: z.string().prefault('krishi/tenant-integrations'),
  // tenant-webhooks signing-secret encryption key (P1-11). 32 bytes (hex or base64); fail-closed in prod if unset.
  WEBHOOK_SIGNING_KEK: z.string().prefault(''),
  // PC-56 TENANT-SW-c: the tenant console's public base URL — a staff invite SMS carries `<base>/invite?t=<token>`; empty ⇒ the SMS
  // carries the code to type on the console's invite page instead (no link is invented).
  TENANT_CONSOLE_BASE_URL: z.string().prefault(''),
  S3_ACCESS_KEY_ID: z.string().prefault(''),             // empty ⇒ use the instance IAM role (no static keys)
  S3_SECRET_ACCESS_KEY: z.string().prefault(''),
  S3_ENDPOINT: z.string().optional(),                   // set for MinIO/LocalStack; absent ⇒ AWS S3
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),  // MinIO needs path-style addressing
  S3_PRESIGN_EXPIRY_SEC: z.coerce.number().int().positive().max(604800).prefault(900), // 15 min (max 7d)
  MEDIA_SCAN_SECRET: z.string().prefault(''),            // HMAC secret for the AV scan-result webhook
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().prefault(52428800), // 50 MiB default cap
  RAZORPAY_KEY_ID: z.string().prefault(''),
  RAZORPAY_KEY_SECRET: z.string().prefault(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().prefault(''),
  RAZORPAY_BASE_URL: z.string().optional(),
  PAYMENTS_DEFAULT_PROVIDER: z.string().prefault('razorpay'),
  // money-OUT (RazorpayX). Empty ⇒ deterministic sandbox payout gateway (non-prod only).
  RAZORPAYX_KEY_ID: z.string().prefault(''),
  RAZORPAYX_KEY_SECRET: z.string().prefault(''),
  RAZORPAYX_ACCOUNT_NUMBER: z.string().prefault(''),
  RAZORPAYX_BASE_URL: z.string().optional(),
  RAZORPAYX_WEBHOOK_SECRET: z.string().prefault(''),
  SANDBOX_WEBHOOK_SECRET: z.string().prefault(''),
  // --- SMS / OTP delivery ---
  // noop = log only (dev). msg91 = Indian DLT gateway (prod default). twilio = global fallback.
  SMS_PROVIDER: z.enum(['noop', 'msg91', 'twilio']).prefault('noop'),
  MSG91_AUTH_KEY: z.string().prefault(''),
  MSG91_SENDER_ID: z.string().prefault(''),              // DLT-registered 6-char header
  MSG91_OTP_TEMPLATE_ID: z.string().prefault(''),        // DLT-approved OTP template id (carries the {code} var) — default/fallback locale
  // Optional PER-LANGUAGE DLT template ids (DLT approves each language's exact text as a SEPARATE template).
  // Unset ⇒ falls back to MSG91_OTP_TEMPLATE_ID for that locale (e.g. only one language registered so far).
  MSG91_OTP_TEMPLATE_ID_HI: z.string().prefault(''),
  MSG91_OTP_TEMPLATE_ID_GU: z.string().prefault(''),
  MSG91_OTP_TEMPLATE_ID_EN: z.string().prefault(''),
  MSG91_BASE_URL: z.string().prefault('https://control.msg91.com'),
  TWILIO_ACCOUNT_SID: z.string().prefault(''),
  TWILIO_AUTH_TOKEN: z.string().prefault(''),
  TWILIO_FROM: z.string().prefault(''),                  // sender number / messaging-service SID
  SMS_DAILY_BUDGET_PAISE: z.coerce.number().nonnegative().prefault(0),
  NOTIFY_GATEWAY_URL: z.string().prefault(''),           // external notification product base URL; absent ⇒ noop gateway
  NOTIFY_GATEWAY_API_KEY: z.string().prefault(''),
  NOTIFY_WEBHOOK_SECRET: z.string().prefault(''),        // HMAC secret for the delivery-status callback
  EKYC_PROVIDER_KIND: z.string().prefault('sandbox'),    // eKYC: 'sandbox' (dev) | 'digilocker'… (prod fail-closed)
  EKYC_PROVIDER_URL: z.string().prefault(''),            // external eKYC base URL (required for a real provider)
  EKYC_PROVIDER_API_KEY: z.string().prefault(''),        // eKYC api key (secret; never logged)
  BANK_VAULT_KIND: z.string().prefault('sandbox'),       // bank fund-account tokeniser (P1-16): 'sandbox' (dev) | 'razorpayx' (prod fail-closed)
  PUSH_PROVIDER: z.string().prefault('expo'),            // first-party push sender: 'expo' (default) | 'none' (noop)
  EXPO_PUSH_URL: z.string().prefault(''),                // Expo push base (default https://exp.host)
  EXPO_ACCESS_TOKEN: z.string().prefault(''),            // optional Expo access token (raises rate limits + auth)
  MASKING_PROVIDER_URL: z.string().prefault(''),         // external number-masking telephony provider; absent ⇒ noop
  MASKING_PROVIDER_API_KEY: z.string().prefault(''),
  MASKING_WEBHOOK_SECRET: z.string().prefault(''),       // HMAC secret for the call-status callback
  STREAM_PROVIDER_URL: z.string().prefault(''),          // external live-streaming provider; absent ⇒ noop
  STREAM_PROVIDER_API_KEY: z.string().prefault(''),
  // --- insurance Wave 7 external integrations (DEV-25, KV-BL-057): PMFBY govt portal, surveyor-network
  // dispatch, vet-certificate verification. No named commercial partner is contracted yet (§8) — every
  // adapter below is OUR domain-shaped port; absent URL ⇒ the honest noop adapter (never a fabricated
  // success). Auto-debit/e-NACH reuses the EXISTING payments-module UPI-AutoPay mandate machinery
  // (MANDATE_GATEWAY/autopay_execution) — no separate provider env is introduced for it.
  PMFBY_PORTAL_URL: z.string().prefault(''),             // govt PMFBY portal base URL; absent ⇒ noop (no invented gov API)
  PMFBY_PORTAL_API_KEY: z.string().prefault(''),
  SURVEYOR_DISPATCH_URL: z.string().prefault(''),        // external surveyor-network dispatch base URL; absent ⇒ noop
  SURVEYOR_DISPATCH_API_KEY: z.string().prefault(''),
  VET_CERT_PROVIDER_URL: z.string().prefault(''),        // veterinary-certificate verification service base URL; absent ⇒ noop
  VET_CERT_PROVIDER_API_KEY: z.string().prefault(''),
  // --- geocoded weather forecast (P0-12) ---
  WEATHER_PROVIDER_KIND: z.string().prefault('open-meteo'),   // 'open-meteo' (default, free) | 'imd' | 'none' (degrade)
  WEATHER_PROVIDER_URL: z.string().prefault(''),              // override base URL (aggregator); default open-meteo public
  WEATHER_PROVIDER_API_KEY: z.string().prefault(''),          // optional api key (aggregators that require one)
  WEATHER_CACHE_TTL_SEC: z.coerce.number().int().positive().max(86400).prefault(3600),  // 1h forecast cache (cost cap)
  WEATHER_FORECAST_DAYS: z.coerce.number().int().min(1).max(16).prefault(7),
  // P1-4 reverse-geocoder for the weather header place-name (best-effort; 'none' ⇒ generic label)
  WEATHER_GEOCODE_KIND: z.string().prefault('bigdatacloud'),   // 'bigdatacloud' (default, free) | 'none' (degrade)
  WEATHER_GEOCODE_URL: z.string().prefault(''),               // override base URL; default bigdatacloud public
  WEATHER_GEOCODE_API_KEY: z.string().prefault(''),           // optional api key
  // --- governed farmer AI assistant (P1-13) ---
  AI_SERVICES_URL: z.string().prefault(''),                   // base URL of the internal ai-services tier; '' ⇒ degrade
  AI_SERVICES_SHARED_SECRET: z.string().prefault(''),         // s2s bearer (must match ai-services API_SHARED_SECRET)
  AI_SERVICES_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).prefault(12000),
  AI_ASSISTANT_DAILY_CAP: z.coerce.number().int().min(1).max(1000).prefault(50),     // per-user/day message cap (cost guard)
  AI_ASSISTANT_PER_MINUTE_CAP: z.coerce.number().int().min(1).max(120).prefault(6),  // per-user/min burst cap (abuse guard)

  // --- outbox relay timer (KV-BL-063) ---
  // The api runs the transactional-outbox relay (core/outbox/outbox.dispatcher.ts) on an in-process
  // timer so cross-module event handlers actually fire (payment_succeeded -> order confirmed,
  // orders.order_completed -> escrow release + notification fan-out, …). See ADR-0001's 2026-07-10
  // amendment for why this runs here rather than as a standalone satellite service.
  RELAY_ENABLED: z.enum(['true', 'false']).prefault('true'),
  // Dedicated connection for the relay — MUST be the kv_relay BYPASSRLS role (migration 0018), never
  // kv_app (RLS-scoped; cannot see other tenants' pending events). Empty ⇒ falls back to DATABASE_URL
  // (local dev convenience only); assertProductionSecurity requires the kv_relay role name in prod.
  RELAY_DATABASE_URL: z.string().optional(),
  RELAY_POOL_MAX: z.coerce.number().int().min(1).max(20).prefault(4),
  RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).prefault(750),      // tick cadence
  RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).prefault(100),          // max events claimed per tick

  // --- scheduled-jobs runner (P0-9-follow-on) ---
  // The api hosts the pilot's CADENCE-driven domain-handler jobs (core/jobs/jobs.runner.ts) the same
  // way RELAY_* above hosts the EVENT-driven outbox relay — see WORKER-RUNTIME.md "Deferred:
  // domain-handler jobs" + ADR-0001's amendment. Each registered job also runs under its own Postgres
  // advisory lock (multi-pod safe), so N api pods each running this timer never double-run a job.
  JOBS_ENABLED: z.enum(['true', 'false']).prefault('true'),
  // Dedicated connection — MUST be kv_relay (BYPASSRLS), same reasoning as RELAY_DATABASE_URL: cadence
  // jobs like settlement-statement generation scan un-statemented lines ACROSS every tenant. Empty ⇒
  // falls back to RELAY_DATABASE_URL, then DATABASE_URL (local dev convenience only).
  JOBS_DATABASE_URL: z.string().optional(),
  JOBS_POOL_MAX: z.coerce.number().int().min(1).max(20).prefault(2),
  // --- PC-56 TENANT-SW-e · the cold-chain DEVICE INGEST route's own connection: MUST be the kv_ingest role (0014's ingestion role;
  // 0201 grants it exactly its device lookup, the nonce and the device columns of cold_chain_logs). Empty ⇒ the ingest route
  // answers 503 COLD_CHAIN_INGEST_NOT_CONFIGURED — it never falls back to kv_app (fail closed).
  INGEST_DATABASE_URL: z.string().optional(),
  INGEST_POOL_MAX: z.coerce.number().int().min(1).max(20).prefault(2),
  // --- settlement-statements cadence job ---
  SETTLEMENT_STATEMENTS_JOB_ENABLED: z.enum(['true', 'false']).prefault('true'),
  SETTLEMENT_STATEMENTS_JOB_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).prefault(86_400_000), // default: once/day
  // --- kyc-expiry-reminders cadence job (wave-1 follow-on; identity bank-KYC gate now lifted this) ---
  KYC_EXPIRY_JOB_ENABLED: z.enum(['true', 'false']).prefault('true'),
  KYC_EXPIRY_JOB_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).prefault(86_400_000), // default: once/day
  // --- payout-execution cadence job (S5 review P0: PayoutExecutionJob existed but was registered
  // NOWHERE — a queued payout (POST /v1/payouts) never disbursed to the bank). Frequent cadence
  // (default 5 min, NOT the once/day settlement-statements default) — a labourer/seller's wallet
  // funds are already reserved once queued, so this must not wait a day like a reporting job.
  PAYOUT_EXECUTION_JOB_ENABLED: z.enum(['true', 'false']).prefault('true'),
  PAYOUT_EXECUTION_JOB_INTERVAL_MS: z.coerce.number().int().min(30_000).max(86_400_000).prefault(300_000), // default: every 5 min
  PAYOUT_EXECUTION_JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).prefault(100), // max payouts claimed per tick
  // --- saas-billing-cycle cadence job (PC-56 TENANT-4d-4: raise renewal -> overdue -> grace -> expire).
  // DAILY by default: the unit of this cycle is a DAY (a period ends on a date, a grace window is counted in
  // whole days), so a frequent tick would do nothing almost every time. Two feature flags gate the BEHAVIOUR
  // (`saas_billing_cadence`, `saas_billing_grace`) on top of this env switch — the flags are the kill switch a
  // founder reaches for, this is the deployment one.
  SAAS_BILLING_CYCLE_JOB_ENABLED: z.enum(['true', 'false']).prefault('true'),
  SAAS_BILLING_CYCLE_JOB_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).prefault(86_400_000),
  SAAS_BILLING_CYCLE_JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).prefault(200),
  // PC-56 TENANT-4d-5 · the two tenancy notice producers (trial ending, usage-limit alert). ONE gate for both:
  // they are one decision — whether this deployment sends tenants proactive billing notices at all — and two
  // env vars would let an operator half-enable a promise W118 and W120 make together.
  // PC-56 TENANT-5b · the RC-parking clock behind W229's "an expired RC parks the vehicle automatically", and
  // the cold-chain alert cadence that was CONSTRUCTED in LogisticsModule and never registered with the runner.
  LOGISTICS_FLEET_JOBS_ENABLED: z.enum(['true', 'false']).prefault('true'),
  LOGISTICS_RC_PARKING_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).prefault(86_400_000),
  LOGISTICS_RC_PARKING_BATCH_SIZE: z.coerce.number().int().min(1).max(5_000).prefault(500),
  TENANT_NOTICES_JOB_ENABLED: z.enum(['true', 'false']).prefault('true'),
  TENANT_NOTICES_JOB_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).prefault(86_400_000),
  TENANT_NOTICES_JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).prefault(200),
  // The usage scan is per (tenant, metric) rather than per tenant, so its natural batch is an order of
  // magnitude larger than the trial scan's — the same figure the job has always defaulted to.
  TENANT_NOTICES_USAGE_BATCH_SIZE: z.coerce.number().int().min(1).max(20_000).prefault(2000),
  // W118's own number: the nudge lands this many days before a trial ends.
  TENANT_NOTICES_TRIAL_DAYS: z.coerce.number().int().min(1).max(30).prefault(3),
});

export type Env = z.infer<typeof EnvSchema>;
export const validateEnv = (cfg: Record<string, unknown>): Env => EnvSchema.parse(cfg);
