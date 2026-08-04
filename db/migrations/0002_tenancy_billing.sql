-- ============================================================================
-- MIGRATION 0002 — TENANCY BILLING
-- Source of truth: Database_Architecture/full_platform/01_tenancy_billing.sql (reproduced verbatim)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
-- ============================================================================

-- ============================================================================
-- FILE 01 — TENANCY, PLANS, BILLING, FEATURE FLAGS, INTEGRATIONS
-- Dynamic everything: plans/limits/features/settings are DATA, not code.
-- ============================================================================

CREATE TYPE tenant_status AS ENUM ('pending','trial','active','grace','suspended','archived','terminated'); -- PRD §5.5 lifecycle (state machine → enum, L2)
CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','paused','cancelled','expired');
CREATE TYPE invoice_status AS ENUM ('draft','issued','paid','partially_paid','overdue','void');

-- ---------- plans: fully dynamic (new tier = INSERT, price change = new version)
CREATE TABLE plans (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code          varchar(40) NOT NULL,                 -- 'starter','growth','professional','enterprise','government'
  version       integer NOT NULL DEFAULT 1,           -- grandfathering: old tenants keep old version
  default_name  varchar(100) NOT NULL,
  country_code  char(2) NOT NULL REFERENCES countries(code),
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  monthly_price_minor bigint NOT NULL,
  annual_price_minor  bigint NOT NULL,
  setup_fee_minor     bigint NOT NULL DEFAULT 0,
  is_public     boolean NOT NULL DEFAULT true,        -- govt/enterprise = custom, not public
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (code, version, country_code)
);
CALL add_std_columns('plans');

CREATE TABLE features (                               -- platform feature catalog (PRD feature flags §5.1)
  code          varchar(60) PRIMARY KEY,              -- 'bidding','voice_listing','ai_grading','whatsapp_commerce','labour','dairy_mcc',...
  default_name  varchar(120) NOT NULL,
  module_code   varchar(10),                          -- 'M04','M15'... maps feature→PRD module
  description   text
);
CALL add_std_columns('features');

CREATE TABLE plan_features (                          -- what each plan includes
  plan_id      uuid NOT NULL REFERENCES plans(id),
  feature_code varchar(60) NOT NULL REFERENCES features(code),
  is_included  boolean NOT NULL DEFAULT true,
  config       jsonb NOT NULL DEFAULT '{}',           -- per-plan feature config
  PRIMARY KEY (plan_id, feature_code)
);

CREATE TABLE plan_limits (                            -- dynamic quotas (PRD §5.2)
  plan_id     uuid NOT NULL REFERENCES plans(id),
  limit_code  varchar(60) NOT NULL,                   -- 'max_farmers','max_orders_month','max_languages','api_rph','storage_gb'
  limit_value bigint NOT NULL,                        -- -1 = unlimited
  PRIMARY KEY (plan_id, limit_code)
);

-- ---------- tenants
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug            varchar(50) UNIQUE NOT NULL,
  legal_name      varchar(250) NOT NULL,
  display_name    varchar(150) NOT NULL,
  tenant_type_id  uuid NOT NULL REFERENCES lookup_values(id), -- lookup 'tenant_type': fpo|cooperative|dairy_union|startup|corporate|government|shg_federation... (dynamic, L1)
  country_code    char(2) NOT NULL REFERENCES countries(code),
  region_id       uuid REFERENCES admin_regions(id),  -- home district
  gstin           varchar(20),
  pan             varchar(15),
  cin_or_reg_no   varchar(40),                        -- incorporation / society registration
  fssai_license   varchar(20),
  owner_name      varchar(200),
  owner_phone     varchar(20),
  owner_email     varchar(200),
  status          tenant_status NOT NULL DEFAULT 'pending',
  onboarded_by    uuid,                               -- sales/ambassador attribution
  approved_at     timestamptz,
  risk_score      smallint NOT NULL DEFAULT 0
);
CALL add_std_columns('tenants');
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_region ON tenants(region_id);
ALTER TABLE tenant_languages ADD CONSTRAINT fk_tl_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

CREATE TABLE tenant_domains (                         -- subdomain + custom domains (PRD §5.1)
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  domain      varchar(255) UNIQUE NOT NULL,           -- 'mybrand.krishi-verse.com' | 'mandi.gov.in'
  is_primary  boolean NOT NULL DEFAULT false,
  tls_status  varchar(20) NOT NULL DEFAULT 'pending',
  verified_at timestamptz
);
CALL add_std_columns('tenant_domains');

-- typed key-value settings: new setting = INSERT into registry, never a migration
CREATE TABLE setting_definitions (
  key           varchar(80) PRIMARY KEY,              -- 'order.auto_confirm_hours','review.enabled','listing.approval_required'
  value_type    varchar(15) NOT NULL CHECK (value_type IN ('string','int','decimal','bool','json')),
  default_value jsonb NOT NULL,
  scope         varchar(15) NOT NULL DEFAULT 'tenant' CHECK (scope IN ('platform','tenant','user')),
  description   text
);
CREATE TABLE tenant_settings (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key       varchar(80) NOT NULL REFERENCES setting_definitions(key),
  value     jsonb NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
CALL add_std_columns('tenant_settings');

CREATE TABLE tenant_features (                        -- per-tenant overrides beyond plan (anchor deals, pilots)
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  feature_code varchar(60) NOT NULL REFERENCES features(code),
  is_enabled   boolean NOT NULL,
  reason       text,
  expires_at   timestamptz,
  PRIMARY KEY (tenant_id, feature_code)
);
CALL add_std_columns('tenant_features');

CREATE TABLE tenant_service_areas (                   -- serviceable regions/pincodes (PRD regional controls)
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  region_id uuid REFERENCES admin_regions(id),
  pincode   varchar(10),
  is_active boolean NOT NULL DEFAULT true,
  CHECK (region_id IS NOT NULL OR pincode IS NOT NULL)
);
CREATE INDEX idx_tsa_tenant ON tenant_service_areas(tenant_id) WHERE is_active;

CREATE TABLE tenant_status_events (                   -- lifecycle audit (pending→trial→active→...)
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  from_status tenant_status,
  to_status   tenant_status NOT NULL,
  reason      text,
  actor_user_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tse_tenant ON tenant_status_events(tenant_id, created_at);

-- ---------- subscriptions & SaaS billing (Krishi-Verse revenue stream #1)
CREATE TABLE subscriptions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  plan_id         uuid NOT NULL REFERENCES plans(id),
  status          subscription_status NOT NULL DEFAULT 'trialing',
  billing_cycle   varchar(10) NOT NULL CHECK (billing_cycle IN ('monthly','annual')),
  price_minor     bigint NOT NULL,                    -- negotiated price (may differ from list)
  currency_code   char(3) NOT NULL REFERENCES currencies(code),
  discount_pct    numeric(5,2) NOT NULL DEFAULT 0,
  anchor_terms    jsonb NOT NULL DEFAULT '{}',        -- founding-partner terms (price lock, free months)
  current_period_start date NOT NULL,
  current_period_end   date NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at    timestamptz
);
CALL add_std_columns('subscriptions');
CREATE INDEX idx_subs_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_subs_renewal ON subscriptions(current_period_end) WHERE status IN ('active','trialing');

CREATE TABLE subscription_addons (                    -- extra language, +1000 farmers, CSM... (Revenue Playbook add-ons)
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  addon_code      varchar(60) NOT NULL,               -- lookup-driven
  quantity        integer NOT NULL DEFAULT 1,
  price_minor     bigint NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date
);
CALL add_std_columns('subscription_addons');

CREATE TABLE saas_invoices (                          -- our invoices TO tenants
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  subscription_id uuid REFERENCES subscriptions(id),
  invoice_no      varchar(40) UNIQUE NOT NULL,        -- via next_doc_number()
  status          invoice_status NOT NULL DEFAULT 'draft',
  currency_code   char(3) NOT NULL,
  subtotal_minor  bigint NOT NULL,
  tax_minor       bigint NOT NULL DEFAULT 0,
  total_minor     bigint NOT NULL,
  due_date        date NOT NULL,
  paid_at         timestamptz,
  pdf_media_id    uuid REFERENCES media_assets(id),
  line_items      jsonb NOT NULL                       -- [{desc, qty, unit_minor, total_minor, hsn, gst_rate}]
);
CALL add_std_columns('saas_invoices');
CREATE INDEX idx_saas_inv_tenant ON saas_invoices(tenant_id, status);

-- ---------- platform feature flags (runtime kill-switches, % rollouts)
CREATE TABLE feature_flags (
  key          varchar(80) PRIMARY KEY,
  description  text,
  is_enabled   boolean NOT NULL DEFAULT false,
  rollout_pct  smallint NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  rules        jsonb NOT NULL DEFAULT '{}'            -- targeting: {tenant_ids:[], plans:[], countries:[]}
);
CALL add_std_columns('feature_flags');

-- ---------- tenant API access & webhooks (PRD §36)
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  name         varchar(100) NOT NULL,
  key_prefix   varchar(12) NOT NULL,                  -- visible part 'kv_live_a1b2'
  key_hash     varchar(128) NOT NULL,                 -- store hash only
  scopes       jsonb NOT NULL DEFAULT '[]',
  rate_per_hour integer NOT NULL DEFAULT 1000,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CALL add_std_columns('api_keys');
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE webhook_endpoints (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  url         varchar(500) NOT NULL,
  secret_hash varchar(128) NOT NULL,
  event_types jsonb NOT NULL DEFAULT '[]',            -- ['order.created','payout.completed']
  is_active   boolean NOT NULL DEFAULT true
);
CALL add_std_columns('webhook_endpoints');

CREATE TABLE webhook_deliveries (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  endpoint_id  uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  event_type   varchar(100) NOT NULL,
  payload      jsonb NOT NULL,
  attempt      smallint NOT NULL DEFAULT 1,
  status_code  integer,
  succeeded    boolean NOT NULL DEFAULT false,
  next_retry_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_whd_retry ON webhook_deliveries(next_retry_at) WHERE NOT succeeded;

-- ---------- third-party integrations registry (Razorpay, MSG91, NDDB, e-NAM…)
CREATE TABLE integration_providers (
  code         varchar(60) PRIMARY KEY,               -- 'razorpay','msg91','gupshup','agmarknet','inaph','pfms'
  default_name varchar(120) NOT NULL,
  category     varchar(40) NOT NULL,                  -- 'payment','sms','kyc','government','satellite'
  is_active    boolean NOT NULL DEFAULT true
);
CREATE TABLE tenant_integrations (                    -- tenant-level credentials live in Secrets Manager; row stores ref
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  provider_code varchar(60) NOT NULL REFERENCES integration_providers(code),
  secret_ref    varchar(200) NOT NULL,                -- AWS Secrets Manager ARN
  config        jsonb NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, provider_code)
);
CALL add_std_columns('tenant_integrations');

