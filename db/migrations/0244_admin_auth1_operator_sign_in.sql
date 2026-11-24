-- ==================================================================================================================
-- MIGRATION 0244 — PC-56 ADMIN-AUTH-1 · THE GOD-MODE REALM CAN FINALLY SIGN SOMEBODY IN.
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. Nothing here edits an applied one: seven NEW tables, all in the
-- admin realm, plus grants. NOT MONEY.
-- ==================================================================================================================
--
-- WHAT WAS WRONG (launch blocker 1): web-admin's /login linked to `${adminApiUrl}/auth/sso/start`, which existed nowhere.
-- admin-api only VERIFIED an HS256 admin JWT; nothing minted one except the dev-only bypass, refused in production. And the
-- hardware-key guard checked a string (`amr` contains 'hwk') that no credential anywhere could back: 0074's
-- `fido2_credentials` keys on the TENANT realm's `users(id)`, which a platform operator is not (0118, ADMIN-9-Q3).
--
-- THE FLOW THESE TABLES SERVE (apps/admin-api/src/modules/operator-auth):
--   web-admin /login → GET /v1/auth/sso/start (an `sso_flows` row: state/nonce/PKCE) → the IdP (OpenID Connect; Google
--   Workspace by default) → GET /v1/auth/sso/callback (id_token verified; email bound to roles by CONFIG, never by a row
--   here) → a single-use `login_tickets` row (≤ 5 min) → web-admin /login/key → a WebAuthn ceremony against a key in
--   `operator_credentials` (or, for an operator with no key, an enrollment against a single-use code) → the admin JWT
--   (amr ['oidc','hwk'], a new `platform_operator_sessions` row) → the console.
--
-- ------------------------------------------------------------------------------------------------------------------
-- WHAT IS STILL NOT DATA: WHO IS AN OPERATOR, AND WITH WHICH ROLES.
-- ------------------------------------------------------------------------------------------------------------------
-- The email → roles bindings live in `ADMIN_OPERATOR_BINDINGS` (Secrets Manager), validated against owner-roles.ts at
-- boot. Law 11 keeps the permission ceiling out of database rows: if a row could make somebody an operator, anything with
-- a write grant on that row — including a bug — would be a route into god mode. Changing who is an admin therefore needs
-- secret + deploy access. Nothing in this file can grant a role; 0118's "can revoke, never grant" holds unchanged.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 0118 SAID "NO EMAIL COLUMN — THE TOKEN CARRIES NO EMAIL". THAT IS NO LONGER TRUE, SO THE REALM NOW OBSERVES ONE.
-- ------------------------------------------------------------------------------------------------------------------
-- 0118 refused a name/email column because the realm could not obtain one, and a roster of values it could not obtain
-- would be invented. The realm now verifies the IdP's id_token itself (signature, issuer, audience, nonce,
-- `email_verified === true`, allowed domain), so `operator_identities.email` is OBSERVED from a verified credential at
-- each sign-in — exactly the "observed, never invented" rule 0118 set, applied to a value that has become observable.
-- It is refreshed at every login (an IdP rename shows up at the next sign-in) and is never an input to authorisation:
-- the binding is looked up by the email in the CURRENT verified id_token, not by this column.
--
-- IDENTITY IS (issuer, subject), NOT EMAIL. Emails get reassigned; the IdP's `sub` does not. A new Google account that
-- inherits a departed person's address gets a NEW admin_user_id with no keys, and must be enrolled with a code.
--
-- ------------------------------------------------------------------------------------------------------------------
-- GRANTS — kv_admin only; the tenant realm and every other realm get NOTHING.
-- ------------------------------------------------------------------------------------------------------------------
-- 0014's ALTER DEFAULT PRIVILEGES hands every new table SELECT/INSERT/UPDATE to kv_app and 0018's hands kv_relay
-- SELECT/INSERT/UPDATE/DELETE, so each table below is REVOKEd from them explicitly (0118 §118.5, 0140's lesson), and from
-- kv_partner / kv_gov / PUBLIC for completeness (they get nothing by default; the REVOKE makes "nothing" a stated fact).
-- kv_admin gets explicit, minimal verbs (0140: it gets nothing by default). DELETE is granted ONLY on the three
-- short-lived ceremony tables (flows, tickets, challenges), so admin-api can purge expired rows; credentials, identities,
-- codes and bootstrap uses are never deleted — revocation is a timestamp, and the evidence stays.
-- kv_readonly (reporting) sees identities and credential METADATA only — never a code hash, a ticket hash, a PKCE
-- verifier or a challenge.
--
-- RLS: none of these tables carries a tenant_id (the same as 0118's four), so the tenant-isolation sweep skips them by
-- construction and the access wall is the grant set above. Stated so the absence is not read as an omission.
-- ==================================================================================================================

-- ---------------------------------------------------------------------------
-- 244.1  OPERATOR IDENTITIES — (issuer, subject) → admin_user_id
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operator_identities (
  -- THE id every 0118 table already keys on (`platform_operators.admin_user_id`, sessions, restrictions, step-up events)
  -- and the admin JWT's `sub`. Minted here on the first successful sign-in; never reused.
  admin_user_id     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  issuer            varchar(300) NOT NULL,
  subject           varchar(255) NOT NULL,
  -- OBSERVED from the last verified id_token (email_verified = true). Lower-cased. Display only — see the header.
  email             varchar(320) NOT NULL,
  email_observed_at timestamptz NOT NULL DEFAULT now(),
  first_login_at    timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_poi_issuer_subject UNIQUE (issuer, subject),
  CONSTRAINT ck_poi_email_lower CHECK (email = lower(email) AND position('@' in email) > 1),
  CONSTRAINT ck_poi_subject CHECK (length(subject) >= 1 AND length(issuer) >= 8)
);
CREATE INDEX idx_poi_email ON platform_operator_identities(email);
COMMENT ON TABLE platform_operator_identities IS
  'PC-56 ADMIN-AUTH-1: the IdP identity (issuer, sub) behind each admin_user_id. email is OBSERVED from a verified '
  'id_token at each sign-in (display only); roles come from ADMIN_OPERATOR_BINDINGS config, never from this table.';

-- ---------------------------------------------------------------------------
-- 244.2  OPERATOR CREDENTIALS — the hardware keys (WebAuthn)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operator_credentials (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  admin_user_id      uuid NOT NULL REFERENCES platform_operator_identities(admin_user_id),
  -- The authenticator's credential id, base64url, exactly as the browser reports it. Globally unique: one physical key
  -- credential can belong to one operator only.
  credential_id      varchar(1400) NOT NULL,
  public_key         bytea NOT NULL,                       -- COSE public key as returned by the authenticator
  -- Signature counter. Must never go backwards (a clone signal). 0 stays 0 for keys that never increment.
  sign_count         bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports         jsonb NOT NULL DEFAULT '[]',
  aaguid             varchar(36),
  label              varchar(60) NOT NULL,
  enrolled_via       varchar(20) NOT NULL CHECK (enrolled_via IN ('bootstrap', 'enrollment_code', 'self_with_key')),
  enrollment_code_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  revoked_by_admin_id uuid,
  revoke_reason      text,
  CONSTRAINT uq_poc_credential_id UNIQUE (credential_id),
  CONSTRAINT ck_poc_label CHECK (length(btrim(label)) >= 1),
  CONSTRAINT ck_poc_code_named CHECK (enrolled_via <> 'enrollment_code' OR enrollment_code_id IS NOT NULL),
  CONSTRAINT ck_poc_revoke_evidence CHECK (
    revoked_at IS NULL OR (revoked_by_admin_id IS NOT NULL AND length(coalesce(revoke_reason, '')) >= 5)
  )
);
CREATE INDEX idx_poc_operator_live ON platform_operator_credentials(admin_user_id) WHERE revoked_at IS NULL;
COMMENT ON TABLE platform_operator_credentials IS
  'PC-56 ADMIN-AUTH-1: WebAuthn credentials (hardware keys) of platform operators. The ONLY thing that lets a token carry '
  'amr ''hwk''. Revocation is a timestamp; rows are never deleted.';

-- ---------------------------------------------------------------------------
-- 244.3  ENROLLMENT CODES — the only way to add a FIRST key to an account (after bootstrap)
-- ---------------------------------------------------------------------------
-- A stolen IdP account alone must not be able to add a key. So an operator with no key can enroll one only with a
-- single-use code that a DIFFERENT operator issued for that exact email. Stored hashed; shown once at issue.
CREATE TABLE platform_operator_enrollment_codes (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code_sha256         char(64) NOT NULL,
  email               varchar(320) NOT NULL,              -- the operator the code is FOR (lower-cased)
  issued_by_admin_id  uuid NOT NULL,
  issued_by_email     varchar(320) NOT NULL,              -- the issuer's observed email, so "not for self" is a CHECK
  reason              text NOT NULL,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  consumed_at         timestamptz,
  consumed_by_admin_id uuid,
  revoked_at          timestamptz,
  revoked_by_admin_id uuid,
  CONSTRAINT uq_poec_code UNIQUE (code_sha256),
  CONSTRAINT ck_poec_hash CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_poec_email_lower CHECK (email = lower(email) AND issued_by_email = lower(issued_by_email)),
  -- AN OPERATOR CANNOT ISSUE A CODE FOR THEMSELVES — enforced here as well as in the service.
  CONSTRAINT ck_poec_not_self CHECK (email <> issued_by_email),
  CONSTRAINT ck_poec_ttl CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'),
  CONSTRAINT ck_poec_reason CHECK (length(reason) >= 10),
  CONSTRAINT ck_poec_consumed CHECK (consumed_at IS NULL OR consumed_by_admin_id IS NOT NULL),
  CONSTRAINT ck_poec_revoked CHECK (revoked_at IS NULL OR revoked_by_admin_id IS NOT NULL)
);
CREATE INDEX idx_poec_email ON platform_operator_enrollment_codes(email, issued_at DESC);
ALTER TABLE platform_operator_credentials
  ADD CONSTRAINT fk_poc_enrollment_code FOREIGN KEY (enrollment_code_id) REFERENCES platform_operator_enrollment_codes(id);

-- ---------------------------------------------------------------------------
-- 244.4  BOOTSTRAP USES — the founder's first key, once
-- ---------------------------------------------------------------------------
-- `ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256` is accepted ONLY while zero active operator credentials exist platform-wide,
-- and a hash recorded here is never accepted again. Break-glass recovery after every key is lost is therefore: a NEW
-- code hash in Secrets Manager + a deploy (secret + deploy access, the same bar as changing a binding).
CREATE TABLE platform_operator_bootstrap_uses (
  code_sha256       char(64) PRIMARY KEY CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  admin_user_id     uuid NOT NULL REFERENCES platform_operator_identities(admin_user_id),
  credential_id     uuid NOT NULL REFERENCES platform_operator_credentials(id),
  consumed_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 244.5  SSO FLOWS — state / nonce / PKCE verifier, server-side, single use, 10 minutes
-- ---------------------------------------------------------------------------
-- A server-side row rather than a sealed cookie: single use is a conditional UPDATE the database enforces, there is no
-- extra sealing key to rotate, and the verifier never leaves this realm. The browser holds only a random BINDING value
-- (an httpOnly cookie on the admin-api host) whose hash is stored here, so a callback URL replayed into another browser
-- is refused (login CSRF).
CREATE TABLE platform_operator_sso_flows (
  state_sha256      char(64) PRIMARY KEY CHECK (state_sha256 ~ '^[0-9a-f]{64}$'),
  binding_sha256    char(64) NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  nonce             varchar(100) NOT NULL,
  code_verifier     varchar(128) NOT NULL,
  ip                inet,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  CONSTRAINT ck_posf_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX idx_posf_expiry ON platform_operator_sso_flows(expires_at);

-- ---------------------------------------------------------------------------
-- 244.6  LOGIN TICKETS — the verified IdP identity, waiting for the key (≤ 5 min, single use, hashed)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operator_login_tickets (
  ticket_sha256     char(64) PRIMARY KEY CHECK (ticket_sha256 ~ '^[0-9a-f]{64}$'),
  admin_user_id     uuid NOT NULL REFERENCES platform_operator_identities(admin_user_id),
  email             varchar(320) NOT NULL,
  ip                inet,
  failed_attempts   integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  consumed_session_id varchar(80),
  CONSTRAINT ck_polt_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CONSTRAINT ck_polt_consumed CHECK (consumed_at IS NULL OR consumed_session_id IS NOT NULL)
);
CREATE INDEX idx_polt_expiry ON platform_operator_login_tickets(expires_at);

-- ---------------------------------------------------------------------------
-- 244.7  WEBAUTHN CHALLENGES — one per ceremony, single use, 5 minutes
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operator_webauthn_challenges (
  challenge_sha256  char(64) PRIMARY KEY CHECK (challenge_sha256 ~ '^[0-9a-f]{64}$'),
  challenge         varchar(128) NOT NULL,
  admin_user_id     uuid NOT NULL REFERENCES platform_operator_identities(admin_user_id),
  purpose           varchar(20) NOT NULL CHECK (purpose IN ('login', 'enroll', 'step_up', 'add_key')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  CONSTRAINT ck_powc_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX idx_powc_expiry ON platform_operator_webauthn_challenges(expires_at);

-- ---------------------------------------------------------------------------
-- 244.8  GRANTS
-- ---------------------------------------------------------------------------
REVOKE ALL ON platform_operator_identities, platform_operator_credentials, platform_operator_enrollment_codes,
              platform_operator_bootstrap_uses, platform_operator_sso_flows, platform_operator_login_tickets,
              platform_operator_webauthn_challenges
  FROM PUBLIC, kv_app, kv_relay, kv_partner, kv_gov, kv_readonly;

GRANT SELECT, INSERT, UPDATE ON platform_operator_identities, platform_operator_credentials,
                                platform_operator_enrollment_codes TO kv_admin;
GRANT SELECT, INSERT ON platform_operator_bootstrap_uses TO kv_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_operator_sso_flows, platform_operator_login_tickets,
                                        platform_operator_webauthn_challenges TO kv_admin;
-- A bootstrap use is permanent: no UPDATE, no DELETE, for anyone.
GRANT SELECT ON platform_operator_identities, platform_operator_credentials TO kv_readonly;
-- kv_readonly sees credential METADATA, never the public key bytes (not secret, but not reporting data either).
REVOKE SELECT ON platform_operator_credentials FROM kv_readonly;
GRANT SELECT (id, admin_user_id, label, enrolled_via, aaguid, transports, created_at, last_used_at, revoked_at,
              revoked_by_admin_id, revoke_reason) ON platform_operator_credentials TO kv_readonly;
