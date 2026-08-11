-- ============================================================================
-- MIGRATION 0125 — A WORKER'S KYC OPENS THE MONEY GATE FOR A FARMER'S CROP PROCEEDS (PC-56 TENANT-1)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, AND IT IS ON THE MONEY PATH
-- ---------------------------------------------------------------------------
-- W153 (tenant Members) states the platform's own rule twice, in its subtitle and in its table:
--
--   "1,284 people, each with one or more roles (farmer, pashupalak, worker…) — **KYC is per role, not per person**."
--   "Fully verified members · 89% (**worst-status view — multi-role members count at their lowest role**)"
--
-- And `PayoutRepository.callerKycVerified` gates every rupee leaving a wallet like this:
--
--     SELECT 1 FROM user_tenant_roles
--      WHERE tenant_id=$1 AND user_id=$2 AND is_active=true AND kyc_status='verified' AND deleted_at IS NULL
--      LIMIT 1
--
-- with its own comment saying so out loud: "as soon as the caller has kyc_status='verified' on **ANY** of their active
-- roles in this tenant".
--
-- **THE CANON'S OWN EXAMPLE ROW IS THE EXPLOIT.** W153 lists Kanji Bhai R. as `worker: verified` / `farmer: pending`.
-- Today he can request a settlement payout — crop sale proceeds — because his WORKER verification satisfies the gate.
-- A worker KYC in an FPO is frequently the lighter check (a wage receipt against a muster roll); a farmer/seller KYC is
-- the one that carries land records, a bank account in the seller's name and the anti-fraud checks that matter when
-- produce money moves. The schema models this correctly — `user_tenant_roles.kyc_status` is per person × tenant × role
-- (0003) — and the money path collapses it to "any".
--
-- This is the shape this programme keeps finding: a rule written on a screen and enforced backwards in code. It is the
-- first time the rule was inverted on a MONEY GATE.
--
-- ---------------------------------------------------------------------------
-- WHY A MAP AND NOT A SINGLE ROLE
-- ---------------------------------------------------------------------------
-- A payout already carries a PURPOSE (`payouts.purpose_id` → `lookup_values` of type `payout_purpose`, dynamic since
-- 0006), and the purpose is exactly what says under which capacity the money is being claimed. Wage money is claimed as
-- a worker; settlement money as a seller; a dividend as a member.
--
-- So the fix is a declared purpose → eligible-role map, and it is DATA rather than code for the same reason every other
-- vocabulary on this platform is data: a new purpose (a new country's subsidy, a new payout kind for a new module)
-- must not need a deploy, and a founder must be able to see and change who may receive what money without reading
-- TypeScript. Rule zero: a hard-coded map is a shortcut that blocks a country.
--
-- **AND AN UNMAPPED PURPOSE FAILS TO THE STRICTEST READING, NOT THE PERMISSIVE ONE.** If a purpose has no rows in this
-- map, the gate requires EVERY active role to be verified rather than any. That is the sixth time this programme has
-- had to make unknown mean "refuse": an unmapped purpose is a payout kind nobody has thought about yet, and the moment
-- to discover that is before the money moves.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 125.1  THE MAP
-- ---------------------------------------------------------------------------
CREATE TABLE payout_purpose_roles (
  -- The lookup VALUE code ('settlement', 'wage', …), not its uuid: the code is the stable thing across environments,
  -- and a map keyed on a uuid could not be seeded in a migration that runs before the lookup rows exist.
  purpose_code varchar(60) NOT NULL,
  role_code    varchar(50) NOT NULL REFERENCES roles(code),   -- matches roles.code exactly: a narrower FK column would refuse a legitimate future role code before the FK ever spoke
  -- Why this role may receive this money. Prose, for the founder reading the map rather than for a resolver.
  rationale    varchar(300),
  PRIMARY KEY (purpose_code, role_code)
);
CALL add_std_columns('payout_purpose_roles');

CREATE INDEX idx_ppr_purpose ON payout_purpose_roles(purpose_code) WHERE deleted_at IS NULL;

REVOKE ALL ON payout_purpose_roles FROM kv_relay;
-- The tenant realm READS this on every payout request and must never write it: who may receive which money is a
-- platform decision, and a tenant that could edit its own eligibility map has no gate at all.
GRANT SELECT ON payout_purpose_roles TO kv_app, kv_readonly;
REVOKE INSERT, UPDATE, DELETE ON payout_purpose_roles FROM kv_app;

COMMENT ON TABLE payout_purpose_roles IS
  'Which ROLE a person must hold VERIFIED KYC in to receive money for a given payout purpose (0125). A purpose with no rows here requires EVERY active role verified — unknown fails strict. Before this migration the gate accepted a verified status on ANY role, so a worker verification opened the gate for a farmer settlement.';

-- ---------------------------------------------------------------------------
-- 125.2  THE MAP'S CONTENT, AND THE REASONING FOR EACH LINE
-- ---------------------------------------------------------------------------
-- Only purposes that are actually seeded are mapped ('settlement' and 'wage' from 0005; 'dividend' and
-- 'patronage_bonus' from 0088; 'loan_disbursal' from 0089). The four purposes named in 0006's comment but never seeded
-- ('commission', 'refund', 'milk_bill', 'claim') are deliberately NOT pre-mapped: a row here for a purpose no lookup
-- value exists for would be this table telling the same kind of lie the gate was telling.
INSERT INTO payout_purpose_roles (purpose_code, role_code, rationale) VALUES
  -- SETTLEMENT — produce or livestock sale proceeds. Any SELLER capacity qualifies, and the point of the list is what
  -- it EXCLUDES: a worker, an ambassador, a delivery partner. Seller KYC is the one that carries the land record and a
  -- bank account in the seller's own name.
  ('settlement', 'farmer',       'Crop sale proceeds are claimed as a farmer: seller KYC carries the land record and a bank account in the seller''s name.'),
  ('settlement', 'dairy_farmer', 'Milk and dairy produce sold through the tenant is a seller settlement under the dairy role.'),
  ('settlement', 'pashupalak',   'Livestock and livestock-produce sales are claimed under the pashupalak role.'),
  ('settlement', 'vyapari',      'A trader selling through the platform settles as a vyapari.'),
  ('settlement', 'organic_store','A producer-store selling its own output settles under its store role.'),

  -- WAGE — money against labour performed. A sardar (gang leader) legitimately receives on behalf of a crew, which is
  -- a real practice and is why the list is two rows rather than one.
  ('wage', 'worker', 'Wages are claimed as a worker, against a muster or attendance record.'),
  ('wage', 'sardar', 'A sardar receives crew wages on behalf of the gang — a real labour practice, recorded rather than pretended away.'),

  -- DIVIDEND / PATRONAGE BONUS — a co-operative return on membership. Claimed in the member capacity the shareholding
  -- belongs to, which is why the seller roles appear and staff roles do not: a tenant_admin is not a member.
  ('dividend', 'farmer',       'A co-op dividend is a return on a member''s shareholding, claimed in the member''s own capacity.'),
  ('dividend', 'dairy_farmer', 'Dairy members hold shares and receive dividends in that capacity.'),
  ('dividend', 'pashupalak',   'Livestock members hold shares and receive dividends in that capacity.'),
  ('patronage_bonus', 'farmer',       'Patronage bonus follows produce delivered, so it is claimed in the delivering member''s capacity.'),
  ('patronage_bonus', 'dairy_farmer', 'Patronage bonus on milk delivered is claimed under the dairy role.'),
  ('patronage_bonus', 'pashupalak',   'Patronage bonus on livestock produce is claimed under the pashupalak role.'),

  -- LOAN DISBURSAL — the money lands with the BORROWER. A banker arranges it and never receives it, which is exactly
  -- the kind of confusion a permissive gate would let through.
  ('loan_disbursal', 'farmer',       'A disbursed loan lands with the borrowing farmer, whose KYC the lender relied on.'),
  ('loan_disbursal', 'dairy_farmer', 'A disbursed loan lands with the borrowing dairy member.'),
  ('loan_disbursal', 'pashupalak',   'A disbursed loan lands with the borrowing livestock keeper.'),
  ('loan_disbursal', 'vyapari',      'Trade finance lands with the borrowing trader.')
ON CONFLICT (purpose_code, role_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 125.3  THE AUDIT QUERY, BECAUSE THIS DEFECT HAS A BLAST RADIUS IN LIVE DATA
-- ---------------------------------------------------------------------------
-- Every payout already paid under the permissive gate whose recipient did NOT hold verified KYC in an eligible role for
-- its purpose. This is not backfilled or reversed by this migration — money that has moved has moved, and a migration
-- that reclassified settled payouts would be rewriting financial history. It is a founder's question, and the console
-- surfaces the count.
--
--   SELECT p.id, p.user_id, lv.value_code AS purpose, p.amount_minor, p.status, p.created_at
--     FROM payouts p
--     JOIN lookup_values lv ON lv.id = p.purpose_id
--    WHERE NOT EXISTS (
--            SELECT 1 FROM user_tenant_roles utr
--              JOIN roles r ON r.id = utr.role_id
--              JOIN payout_purpose_roles ppr
--                ON ppr.purpose_code = lv.value_code AND ppr.role_code = r.code AND ppr.deleted_at IS NULL
--             WHERE utr.user_id = p.user_id AND utr.tenant_id = p.tenant_id
--               AND utr.is_active = true AND utr.deleted_at IS NULL AND utr.kyc_status = 'verified')
--      AND p.created_at > now() - interval '180 days';
--
-- ---------------------------------------------------------------------------
-- 125.4  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO CHANGE TO `users.kyc_status`.** A person-level status still exists and is still meaningful (it is the identity
-- check on the human being); what this migration fixes is a MONEY gate reading it as though it were the role check.
-- Collapsing the two would lose the distinction the schema has had right since 0003.
--
-- NO NEW ROLES. Every `role_code` above is a row that already exists in `roles` (seeded by
-- db/seeds/core/0004_roles_permissions.sql), and the FK proves it: a typo in this map fails the migration rather than
-- silently mapping a purpose to nothing, which would be the permissive failure all over again.
--
-- NO RETRO-QUARANTINE OF PAID PAYOUTS (see 125.3). NO CHANGE TO the payout approval gate (0114's maker-checker) — this
-- is the ELIGIBILITY question ("may this person receive this kind of money at all"), which sits before the
-- AUTHORISATION question ("has a second person approved this batch") and is a different control.
