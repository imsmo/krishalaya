-- ============================================================================
-- MIGRATION 0090 — PARTNER API REALM (a partner becomes a first-class API caller, PC-55 A10)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): PC55_COMPLETION_PROMPTS.md wave A10 — "Build `partner-api-realm` DARK: migration
-- `partner_api_keys` (partner_id, key_hash, scopes, rate_limit, is_active, last_used_at) + a PartnerKeyGuard auth
-- strategy (hashed keys, scope checks, per-key rate limit) + a minimal /v1/partner-api/* surface (own book reads
-- only: insurer book, lending servicing reads) + webhook signing for tenant-webhooks → partners. ALL behind a
-- `partner_api` feature flag DEFAULT OFF." Companion doc: PC55_A10_PARTNER_API_SECURITY_NOTES.md (in the
-- founder's Development_Program folder, outside this repo) — the S2 review sitting reads that, not this file.
--
-- THE PROBLEM THIS SOLVES, PRECISELY. Until now a "partner" (bank/NBFC/insurer — financial_partners, 0011) had NO
-- identity of its own. Every partner-facing surface built so far (PC-2A/2B/2C, W54-8/W54-9) is a TENANT user holding
-- `insurance.manage`/`loan.manage` who PASSES a partnerId in the request — fine for a console operated inside a
-- tenant, useless for a bank's own systems calling us machine-to-machine. `partner_api_keys` IS that missing
-- identity: the key names the partner, and nothing else in the request is trusted to.
--
-- WHY A PARTNER READ CANNOT USE TENANT RLS (the hard part). An insurer's book spans MANY tenants (one insurer serves
-- hundreds of FPOs); a lender's servicing book likewise. Tenant RLS (`app.tenant_id`) is exactly the wrong axis, and
-- "just query with a partner_id filter on a BYPASSRLS connection" would make partner confidentiality depend on every
-- future SQL author remembering a WHERE clause. Rule Zero forbids that trade. So this file adds the OTHER axis as
-- real database physics:
--   • role `kv_partner` — NOLOGIN, SELECT on exactly three relations (loans, loan_repayments, insurance_policies)
--     and nothing else. kv_app is a NON-INHERITING member (WITH INHERIT FALSE — the lesson 0076 learned the hard
--     way), so the app holds these privileges ONLY inside an explicit `SET LOCAL ROLE kv_partner` block and drops
--     them again in the same transaction. A bug elsewhere in the app cannot read cross-tenant partner data.
--   • `current_partner_id()` — the partner axis GUC (`app.partner_id`), mirroring current_tenant_id() (0001).
--   • RLS policies `TO kv_partner` (SELECT only), OR'd alongside the existing tenant_isolation policies. They are
--     role-scoped on purpose: setting app.partner_id can NEVER widen what kv_app sees, because the policies simply
--     do not apply to kv_app. And with app.partner_id unset every policy is false (NULL-guarded explicitly), so an
--     elevated block that forgets to set the partner sees ZERO rows rather than everything.
-- Net effect: a partner read is wrong-by-construction unless it names the partner. The WHERE clause is defence in
-- depth, not the defence.
--
-- INSURER PRICING IP (why a SECURITY DEFINER helper, not a grant). insurance_policies has no partner_id — ownership
-- lives one hop away in insurance_products.partner_id, whose `premium_calc` is the insurer's pricing model (their
-- commercial IP, and a competitor's dream). Granting kv_partner SELECT on insurance_products to make an EXISTS
-- subquery work would expose EVERY insurer's pricing to EVERY partner key. Instead
-- `partner_owns_insurance_policy(product_id)` is STABLE SECURITY DEFINER, EXECUTE-granted to kv_partner and revoked
-- from PUBLIC: it answers exactly one yes/no question and hands back not a single product row.
--
-- FOUND WHILE BUILDING (a live trap this file must defuse): 0014 line 149 and 0018 line 24 set ALTER DEFAULT
-- PRIVILEGES for kv_app (SELECT/INSERT/UPDATE), kv_relay (all DML) and kv_readonly (SELECT) on FUTURE tables. So a
-- newly created `partner_api_keys` would arrive with the app able to INSERT keys, the relay able to rewrite them, and
-- the analytics role able to read every key_hash — none of which anyone would have written by hand. The intended
-- posture ("only a human-run mint script creates a key; the API may only stamp last_used_at") therefore requires
-- explicit REVOKEs, which this file does for both new tables. Recorded because every future table in this repo
-- inherits the same surprise.
--
-- KEY MATERIAL. The key is `kv_pk_<env>_<prefix>.<secret>`; we store only key_prefix (indexed, the lookup handle)
-- and key_hash = SHA-256 hex of the secret half. SHA-256 (not bcrypt/argon2) is the CORRECT choice here and is a
-- reasoned exception to password-hashing dogma: the secret is 32 bytes of CSPRNG entropy, so there is no dictionary
-- to attack and no work factor worth paying on EVERY API request; the comparison is timing-safe in code. Keys are
-- never recoverable — the mint script prints the key once (db/scripts/mint-partner-key.js).
--
-- WEBHOOKS OUT TO PARTNERS. `partner_webhook_endpoints` mirrors the tenant table (0002) but on the partner axis, and
-- deliberately REUSES the entire proven delivery rail rather than forking it: the same HMAC signer
-- (modules/tenant-webhooks/domain/webhook-signature.ts: `X-KV-Signature: t=<unix>,v1=…`), the same AES-256-GCM
-- secret-at-rest (core/crypto/secret-box — reversible by necessity: the sender must reproduce the HMAC), the same
-- partitioned `webhook_deliveries` queue, the same worker with its backoff/park semantics. The one seam is the view
-- `webhook_delivery_targets` (tenant endpoints UNION ALL partner endpoints) which the worker joins instead of
-- webhook_endpoints — one line there, zero new delivery code, no second retry policy to drift out of sync.
--   • Deliveries keep the ORIGINATING tenant_id. That is intentional transparency, not sloppiness: the tenant whose
--     farmer's data left the platform can be shown exactly which partner received it.
--   • The view is `security_invoker = true` so it can never become a privilege-laundering back door (a plain view
--     runs with its OWNER's rights and would have handed any grantee an RLS bypass); SELECT is granted to kv_relay
--     alone — the delivery tier that already legitimately bypasses RLS.
--   • WHAT A PARTNER MAY BE TOLD is decided in code, not here (domain/partner-webhook.rules.ts +
--     events/handlers/partner-webhook-fanout.handler.ts), and ownership is resolved from the AGGREGATE'S OWN ROW —
--     loans.partner_id, or policy → product → partner — NEVER from the event payload. A payload field can be
--     missing, stale or simply wrong in a future emitter; a foreign key cannot. An event whose ownership cannot be
--     proven is DROPPED, never broadcast.
--
-- DARK BY DEFAULT: the `partner_api` flag row is seeded is_enabled=false, rollout_pct=0. FlagsService fails closed,
-- and FeatureFlagGuard answers 404 (not 403) so the realm is invisible until the S2 review says otherwise.
--
-- SCALE NOTE (Rule Zero, deliberately not capped): partner_api_keys.partner_id references financial_partners because
-- the two books this wave exposes (insurer, lending) both hang off it. A future logistics-partner realm
-- (logistics_partners, 0007) adds a NULLABLE sibling column + a CHECK that exactly one is set — an additive
-- migration, not a rewrite of this one. Cross-shard partner reads scatter-gather per shard in the repository (see
-- partner-api.repository.ts); nothing here assumes shard 0.
-- ============================================================================

-- ---------- the partner's machine identity
CREATE TABLE partner_api_keys (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  partner_id          uuid NOT NULL REFERENCES financial_partners(id),
  name                varchar(100) NOT NULL,            -- 'ICICI Lombard prod integration' (operator-facing)
  key_prefix          varchar(32) NOT NULL,             -- visible handle 'kv_pk_live_a1b2c3d4' (the lookup key)
  key_hash            char(64) NOT NULL,                -- SHA-256 hex of the secret half; NEVER the secret
  scopes              jsonb NOT NULL DEFAULT '[]',      -- ['insurance:book:read','lending:book:read']
  rate_limit_per_hour integer NOT NULL DEFAULT 1000 CHECK (rate_limit_per_hour > 0),
  is_active           boolean NOT NULL DEFAULT true,
  last_used_at        timestamptz,
  revoked_at          timestamptz
);
CALL add_std_columns('partner_api_keys');
CREATE UNIQUE INDEX uq_partner_api_keys_prefix ON partner_api_keys (key_prefix);
CREATE INDEX idx_partner_api_keys_partner ON partner_api_keys (partner_id) WHERE revoked_at IS NULL;

-- Defuse the inherited default privileges (see the FOUND WHILE BUILDING note above).
-- The API may read a key and stamp its last_used_at. It may NOT create, revoke, re-scope or delete one.
REVOKE INSERT, UPDATE, DELETE ON partner_api_keys FROM kv_app;
GRANT  UPDATE (last_used_at, updated_at) ON partner_api_keys TO kv_app;
REVOKE INSERT, UPDATE, DELETE ON partner_api_keys FROM kv_relay;   -- the relay has no business with credentials
REVOKE SELECT ON partner_api_keys FROM kv_readonly;                -- analytics/support never needs key material

-- ---------- the partner axis (mirrors current_tenant_id(), 0001)
CREATE OR REPLACE FUNCTION current_partner_id() RETURNS uuid AS $$
SELECT NULLIF(current_setting('app.partner_id', true), '')::uuid; $$ LANGUAGE sql STABLE;

-- ---------- the least-privilege partner read role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kv_partner') THEN
    CREATE ROLE kv_partner NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO kv_partner;
-- EXACTLY the three relations the partner surface reads. Nothing else — no users, no tenants, no products, no money
-- tables. (Privileges on a partitioned parent cover reads through the parent, which is how loan_repayments is read.)
GRANT SELECT ON loans              TO kv_partner;
GRANT SELECT ON loan_repayments    TO kv_partner;
GRANT SELECT ON insurance_policies TO kv_partner;
-- NON-INHERITING membership: kv_app cannot passively exercise these; it must `SET LOCAL ROLE kv_partner` and the
-- privileges evaporate at RESET ROLE / end of transaction. This is the 0076 lesson applied at birth.
GRANT kv_partner TO kv_app WITH INHERIT FALSE;

-- Ownership oracle for insurance_policies WITHOUT exposing insurance_products (insurer pricing IP).
CREATE OR REPLACE FUNCTION partner_owns_insurance_policy(p_product_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM insurance_products p
     WHERE p.id = p_product_id
       AND current_partner_id() IS NOT NULL
       AND p.partner_id = current_partner_id());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION partner_owns_insurance_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_owns_insurance_policy(uuid) TO kv_partner;

-- ---------- RLS on the partner axis (SELECT-only, role-scoped, NULL-guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='loans' AND policyname='partner_own_book_loans') THEN
    CREATE POLICY partner_own_book_loans ON loans FOR SELECT TO kv_partner
      USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
  END IF;

  -- A repayment is readable only through an owned loan. The EXISTS is itself evaluated under
  -- partner_own_book_loans, so TWO independent policies must agree before a row is returned.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='loan_repayments' AND policyname='partner_own_book_loan_repayments') THEN
    CREATE POLICY partner_own_book_loan_repayments ON loan_repayments FOR SELECT TO kv_partner
      USING (current_partner_id() IS NOT NULL
             AND EXISTS (SELECT 1 FROM loans l WHERE l.id = loan_repayments.loan_id AND l.partner_id = current_partner_id()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='insurance_policies' AND policyname='partner_own_book_insurance_policies') THEN
    CREATE POLICY partner_own_book_insurance_policies ON insurance_policies FOR SELECT TO kv_partner
      USING (current_partner_id() IS NOT NULL AND partner_owns_insurance_policy(product_id));
  END IF;
END $$;

-- ---------- outbound webhooks to partners (partner axis of 0002's tenant table)
CREATE TABLE partner_webhook_endpoints (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  partner_id   uuid NOT NULL REFERENCES financial_partners(id),
  url          varchar(500) NOT NULL,                   -- https only, SSRF-guarded before it is ever stored
  secret_enc   varchar(500) NOT NULL,                   -- AES-256-GCM ciphertext (core/crypto/secret-box)
  event_types  jsonb NOT NULL DEFAULT '[]',             -- allow-listed in domain/partner-webhook.rules.ts
  is_active    boolean NOT NULL DEFAULT true
);
CALL add_std_columns('partner_webhook_endpoints');
CREATE INDEX idx_partner_wh_partner ON partner_webhook_endpoints (partner_id) WHERE is_active;

-- Same posture as the keys: endpoints are provisioned by a human-run onboarding step, not by request handlers.
-- The relay READS them (to sign+enqueue); kv_readonly must never see a reversible signing secret.
REVOKE INSERT, UPDATE, DELETE ON partner_webhook_endpoints FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON partner_webhook_endpoints FROM kv_relay;
REVOKE SELECT ON partner_webhook_endpoints FROM kv_readonly;

-- The single seam that lets the EXISTING worker drain partner deliveries too (see header). `security_invoker = true`
-- keeps the caller's own privileges + RLS in force — without it a plain view would run with the owner's rights and
-- become an RLS bypass for anyone granted SELECT. Only the relay (already BYPASSRLS by design, 0018) may read it.
CREATE OR REPLACE VIEW webhook_delivery_targets WITH (security_invoker = true) AS
  SELECT id, url, secret_hash AS secret_enc, is_active, tenant_id AS owner_tenant_id, NULL::uuid AS owner_partner_id
    FROM webhook_endpoints
  UNION ALL
  SELECT id, url, secret_enc,                 is_active, NULL::uuid AS owner_tenant_id, partner_id AS owner_partner_id
    FROM partner_webhook_endpoints;
REVOKE ALL ON webhook_delivery_targets FROM PUBLIC;
GRANT SELECT ON webhook_delivery_targets TO kv_relay;

-- ---------- dark switch
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
 ('partner_api',
  'Partner machine-to-machine API realm (/v1/partner-api/*, partner_api_keys). DEFAULT OFF — stays off until the S2 security review signs off (see PC55_A10_PARTNER_API_SECURITY_NOTES.md).',
  false, 0, '{}')
ON CONFLICT (key) DO NOTHING;
