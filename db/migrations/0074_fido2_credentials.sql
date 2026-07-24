-- ============================================================================
-- MIGRATION 0074 — FIDO2 CREDENTIALS (DELTA-066, DEV-06, founder-ordered addition)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ZERO-SCHEMA-TODAY PROOF (grepped fresh, this batch):
--   $ grep -rln "fido2\|webauthn\|passkey\|credential_id" db/migrations/*.sql   → 0 matches (exit 1)
--   $ grep -rn "bytea" db/migrations/*.sql                                     → 0 matches (exit 1, informs the
--     text-not-bytea column choice below — this repo stores every opaque token as text/varchar, never bytea:
--     `bank_accounts.vault_ref`, `sessions.refresh_token_hash`, `devices.push_token` all follow this convention)
-- Matches W439-admin-staff-security.html's own banner verbatim: "Backend pending (DELTA-066, filed this batch):
-- no fido2_credentials/webauthn_credentials table exists in schema today (grepped: 0 hits for
-- fido2/webauthn/passkey/credential across db/migrations/*.sql)." — this migration is DELTA-066's fulfillment.
--
-- FILED SHAPE: W439 itself + WebAuthn Level 2 conventions (the founder brief's own citation) — canon columns
-- read directly from W439: registered-key name ("YubiKey 5 NFC"), added-date, last-used, revoke action with a
-- "last key" business rule (app-layer — see below), step-up log referencing `audit_log` (already real, untouched
-- here). WebAuthn L2 server-side storage requirements: credential_id (unique, looked up BEFORE the user is known
-- at login time), public_key (COSE-encoded), sign_count (clone-detection counter), transports, aaguid
-- (authenticator model), backup-eligibility/state flags (L2 "resident key"/multi-device credential properties).
--
-- WHO THIS BELONGS TO / RLS DECISION (founder's explicit ask: "decide tenant-scoped vs platform-scoped by reading
-- how admin staff users are stored"): `users` (0003_identity_access.sql) is declared "ONE global identity per
-- human (phone), tenant-independent" — there is no separate "platform staff" table; a platform/admin-realm staff
-- member (super_admin/support_agent/ai_ops/auditor/etc., all `roles.scope='platform'`, 0003) is simply a `users`
-- row, same identity space as every farmer/buyer/tenant-staff account. Login security primitives keyed on that
-- global identity ALREADY have no tenant_id column at all — `sessions` and `devices` (both 0003) are exactly
-- this shape, and W439's own banner confirms both are "real" today, used as-is by the very screen this delta is
-- for. `fido2_credentials` is a WebAuthn login credential — the same class of primitive as `sessions`/`devices`,
-- not a tenant business record — so it is **PLATFORM-SCOPED: NO tenant_id column**, matching that precedent
-- exactly (also matching 0067's platform-scoped moderation tables' RLS reasoning: "no tenant_id ⇒ the idempotent
-- RLS pass naturally skips them"). A tenant-side "who has a passkey" concept does not exist in this delta at all
-- — FIDO2 here is specifically the admin-realm staff self-service screen (W439/W438), not a farmer/buyer feature.
--
-- LAW 10 (secrets vs credentials — founder's explicit instruction): a WebAuthn public key is, BY DESIGN, public
-- — the whole point of the protocol is that only the public half ever leaves the authenticator; the private key
-- never exists outside the physical security key/platform authenticator and is never transmitted, let alone
-- stored, anywhere. `public_key` below is therefore fine to store in plain `text` (not a vault_ref/secret) —
-- there is no private-material column anywhere in this table, by construction, matching the founder's brief
-- ("fido2 public keys are credentials-not-secrets ... but no private material").
--
-- APP-LAYER RULE (deliberately NOT a DB constraint): W439's own "this is your last key — revoking it would lock
-- you out" rule is a business rule over a COUNT (≥1 active credential per user), not a schema invariant — a hard
-- DB CHECK/trigger enforcing "never zero active rows for a user" would make a legitimate super_admin bulk-reset
-- (explicitly described on both W439 and W104: "a super_admin resets the account, sessions killed, key unbound")
-- impossible to express as a plain DELETE/UPDATE. Left to the application layer, same discipline as DEV-04's
-- `risk_rules` ₹-threshold note ("a business rule that can change without a migration").
-- ============================================================================

CREATE TABLE fido2_credentials (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           uuid NOT NULL REFERENCES users(id),   -- global identity — platform staff are `users` rows (see header)
  credential_id     text NOT NULL,        -- WebAuthn credential ID, base64url — looked up BEFORE user_id is known at login
  public_key        text NOT NULL,        -- COSE-encoded public key — PUBLIC by protocol design, never the private half (Law 10)
  sign_count        bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),  -- clone-detection counter, incremented every auth
  aaguid            uuid,                 -- authenticator model id (WebAuthn L2) — NULL if the authenticator doesn't report one
  transports        jsonb NOT NULL DEFAULT '[]',  -- ['usb','nfc','ble','internal','hybrid'] (WebAuthn L2 AuthenticatorTransport)
  backup_eligible   boolean NOT NULL DEFAULT false,  -- WebAuthn L2 credential-properties: multi-device/"synced passkey" capable
  backup_state      boolean NOT NULL DEFAULT false,  -- currently backed up (synced passkey), vs single-device security key
  nickname          varchar(120),         -- display name only, e.g. 'YubiKey 5 NFC' (W439) — never a secret
  last_used_at      timestamptz,          -- W439: "last used today 09:02"
  revoked_at        timestamptz,          -- soft-revoke (distinct from add_std_columns' generic deleted_at — a
                                          -- revoked key is a real security event with its own timestamp/reason,
                                          -- not a row-hidden-from-view concern)
  revoke_reason     varchar(300),         -- e.g. 'lost device' (mirrors W439's session-revoke reason field)
  UNIQUE (credential_id)
);
CALL add_std_columns('fido2_credentials');
CREATE INDEX idx_fido2_credentials_user ON fido2_credentials(user_id) WHERE revoked_at IS NULL;

-- RLS — no tenant_id column on this table (see header's RLS DECISION), so the idempotent tenant-isolation pass
-- naturally SKIPS it (same as `sessions`/`devices`) — kept here only for the convention every migration since
-- 0014 follows, in case a future migration in this same file ever adds a tenant-scoped table that needs it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='tenant_id'
    WHERE t.schemaname='public'
      AND t.tablename NOT IN ('wallet_accounts','ledger_entries','ledger_transactions','reconciliation_runs')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format($f$CREATE POLICY tenant_isolation_%s ON %I
                     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());$f$,
                   r.tablename, r.tablename);
  END LOOP;
END $$;
