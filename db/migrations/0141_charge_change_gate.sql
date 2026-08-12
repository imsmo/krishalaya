-- ============================================================================
-- MIGRATION 0141 — THE TENANT'S OWN FEE TABLE: A WRITE PATH THAT CANNOT LIE, OVERLAP, OR REACH THE PLATFORM
-- (PC-56 TENANT-3c-2 · W150 + W2524–W2530 — the wave that closes TENANT-3)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- PROVEN BEFORE FIXING: on a pre-0141 database, `SET ROLE kv_app` + a tenant context inserted a `tenant_id IS NULL`
-- row successfully ("INSERT 0 1", and the row read back as a platform default). After this migration the same
-- statement is refused. The defect below is demonstrated, not inferred.
-- NEVER edit an applied migration — add a new numbered one (Law 9).
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: `charge_definitions` HAS NO WRITER ANYWHERE, WHILE W150 DRAWS TWO BUTTONS OVER IT
-- ---------------------------------------------------------------------------
-- `ChargeDefinitionRepository` is `resolve()` and `resolveById()` — two SELECTs. There is no INSERT, no UPDATE, no
-- service, no controller and no page in any app. The table's entire content is db/seeds/rules/0204: three PLATFORM
-- rows (delivery_fee, buyer_platform_fee, emd). W150 renders "Propose change (checker)" and "Add charge" over a
-- table that has never been written by anything, and its subtitle promises "both data, both effective-dated, no code
-- deploys to change a delivery slab" — true of the schema, and impossible through the product.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2 (THE SECURITY ONE): RLS WOULD LET A TENANT WRITE A **PLATFORM-DEFAULT** CHARGE
-- ---------------------------------------------------------------------------
-- `charge_definitions` is hybrid: `tenant_id IS NULL` means "platform default, applies to every tenant". The RLS
-- sweep (0014/0020) gave it the standard hybrid policy:
--
--     tenant_isolation_charge_definitions  FOR ALL  USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
--
-- **A `FOR ALL` POLICY WITH NO `WITH CHECK` USES ITS `USING` EXPRESSION AS THE WRITE CHECK.** So `tenant_id IS NULL`
-- satisfies INSERT and UPDATE — and `kv_app` (the tenant application role) already holds INSERT and UPDATE on this
-- table. Nothing has exploited it because nothing writes the table at all; TENANT-3c-2 is the wave that adds the
-- writer, so it closes the hole first. The policy is split here: reads still see platform defaults, writes are pinned
-- to the caller's own tenant, and `kv_relay` loses write privileges it never needed on a pricing table.
--
-- This is the same shape as ADMIN-6's dead column and 0139's ungranted permission, one layer down: a control that
-- reads as correct (RLS is enabled! the policy names the tenant!) and is not.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: OVERLAPPING EFFECTIVE WINDOWS ARE UNGUARDED, AND THE RESOLVER PICKS ONE SILENTLY
-- ---------------------------------------------------------------------------
-- `resolve()` ends with `ORDER BY (tenant_id IS NOT NULL) DESC, effective_from DESC LIMIT 1`. Two active rows for the
-- same `charge_code` whose windows overlap are perfectly legal today, and the later `effective_from` wins — silently.
-- W150's own promise is "effective-dated rows, never edits", which only means something if two rows cannot both be
-- in force: otherwise the "history" is a set of candidates and the price a buyer pays depends on an ORDER BY.
--
-- 0141 adds an EXCLUDE constraint over (tenant scope, charge_code, effective window). **IT CAN BE ADDED VALIDATED
-- TODAY PRECISELY BECAUSE THE TABLE HAS NO WRITER**: its content is the three-row seed, one row per code, provably
-- non-overlapping. After a write path ships, this constraint could only ever be added NOT VALID over data somebody
-- would then have to clean by hand. The order of these two waves is the only reason it is free.
--
-- ---------------------------------------------------------------------------
-- DEFECT 4: `calc_method` ACCEPTS `per_km`, AND THE CALCULATOR THROWS ON IT
-- ---------------------------------------------------------------------------
-- The column's CHECK is `('flat','percent','slab','per_km','per_unit')`. `computeCharge` implements four of those and
-- ends with `default: throw new UnsupportedChargeMethodError(method)` — its own header says "per_km is intentionally
-- not handled here (it needs a resolved delivery distance — deferred)". So a `per_km` row is a definition the SCHEMA
-- invites and CHECKOUT crashes on. No such row exists (no writer), and the write path added by this wave refuses the
-- method by name rather than offering a choice that breaks an order. **The CHECK is deliberately NOT narrowed**: the
-- method is a real intention with a real blocker, and removing it from the schema would erase the plan instead of
-- gating it. The gate lives where the writing happens, and the console never offers it.
--
-- ---------------------------------------------------------------------------
-- DEFECT 5: W150's FIRST COLUMN HAS NO COLUMN — CHARGES HAVE A CODE AND NO NAME
-- ---------------------------------------------------------------------------
-- The screen lists "Delivery slab · 0–10 km", "Delivery slab · 10–30 km", "Listing boost · 7 days", "Auction EMD
-- default". `charge_definitions` carries `charge_code` and nothing else human — so those four labels cannot be
-- stored, and two delivery slabs cannot be told apart on a screen at all (they are both `delivery_fee`). 0141 adds a
-- tenant-authored `label`. Platform rows keep NULL and the console prints the CODE for them: an invented label on a
-- row the tenant does not own would read as their own naming.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES *NOT* DO
-- ---------------------------------------------------------------------------
-- IT DOES NOT MAKE `tax_rules` TENANT-WRITABLE, AND THAT REFUSAL IS THE FEATURE. W150 states it: "Tax rules are
-- platform-maintained per country and never tenant-editable — statutory correctness is our job, not your risk." No
-- tenant_id column, no write path, no permission. The screen's second table is READ-ONLY by construction, and the
-- console says which recorded rule each code path actually reads (0140 gave the table `legal_ref` for its Authority
-- column) — including that the canon's "TDS 194Q (buyer purchases > ₹50L/yr)" is NOT recorded and NOT computed here,
-- because it is the BUYER's own deduction obligation and this platform deducts 194-O instead (TENANT-3a's correction).
--
-- IT DOES NOT SEED COMMODITY GST RATES. 0140 refused the same thing for the same reason, and the two waves have to
-- agree: per-HSN produce rates are statutory data "maintained by platform compliance, per country" (W150's own
-- footer). Their absence is exactly why W151 counts invoices whose goods line reads "rate not recorded" — the console
-- names that link rather than papering over it with a plausible 5%.
--
-- IT DOES NOT REUSE 0139's `refund_approvals` PLANE. A charge change is a CONFIG change, not money going back to a
-- buyer: that table's `order_id` is NOT NULL and its `amount_minor` is the figure a checker signs for. Bending it
-- would mean a synthetic order id and an amount that is not an amount. This is the THIRD maker-checker site in the
-- tenant realm, and three sites is the argument for extracting the plane into `core/approval` (recorded in 0140 as a
-- follow-up) — not the argument for forcing config through a money table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 141.1  THE RLS HOLE, CLOSED BEFORE THE WRITER EXISTS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_charge_definitions ON charge_definitions;
-- READS see the platform defaults (that is the hybrid design and the resolver depends on it) plus the tenant's own.
CREATE POLICY charge_definitions_read ON charge_definitions
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
-- WRITES are pinned to the caller's own tenant. `tenant_id IS NULL` is no longer writable by kv_app at all, so no
-- code path — and no injected statement — can price another tenant's orders.
CREATE POLICY charge_definitions_insert ON charge_definitions
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY charge_definitions_update ON charge_definitions
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The relay moves outbox events; it has no business writing a pricing table (0139/0140's grant discipline).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON charge_definitions FROM kv_relay;
-- A tenant may add and end-date rows; deleting a priced-against row would take an order's basis with it.
REVOKE DELETE, TRUNCATE ON charge_definitions FROM kv_app;

COMMENT ON TABLE charge_definitions IS
  'Dynamic tenant/platform fees, effective-dated (0006). tenant_id NULL = PLATFORM DEFAULT applying to every tenant; a tenant row overrides it. Writes are pinned to the caller''s own tenant by RLS (0141) — before that, the sweep''s FOR ALL policy used its USING clause as the write check, so `tenant_id IS NULL` satisfied INSERT and kv_app could have created a platform-wide fee.';

-- ---------------------------------------------------------------------------
-- 141.2  ONE ROW IN FORCE AT A TIME, PER SCOPE, PER CODE
-- ---------------------------------------------------------------------------
-- btree_gist is enabled in 0001, so uuid/text equality can share a GiST index with the range overlap operator.
-- COALESCE folds the platform scope into a fixed sentinel: without it, two overlapping PLATFORM rows would both be
-- allowed (SQL treats NULLs as distinct), which is the exact ambiguity this constraint exists to forbid.
ALTER TABLE charge_definitions DROP CONSTRAINT IF EXISTS ex_charge_def_no_overlap;
ALTER TABLE charge_definitions
  ADD CONSTRAINT ex_charge_def_no_overlap EXCLUDE USING gist (
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    charge_code WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (is_active AND deleted_at IS NULL);

-- An end date before the start date is a window that can never be in force.
ALTER TABLE charge_definitions DROP CONSTRAINT IF EXISTS ck_charge_def_window;
ALTER TABLE charge_definitions
  ADD CONSTRAINT ck_charge_def_window CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- ---------------------------------------------------------------------------
-- 141.3  THE NAME W150's FIRST COLUMN NEEDS, AND WHO PUT THE ROW THERE
-- ---------------------------------------------------------------------------
ALTER TABLE charge_definitions
  ADD COLUMN IF NOT EXISTS label       varchar(120),
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS proposal_id uuid;

COMMENT ON COLUMN charge_definitions.label IS
  'The tenant''s own name for this row — W150 lists "Delivery slab · 0–10 km" and two slabs are otherwise both just `delivery_fee` (0141). NULL on platform rows, where the console prints the CODE: inventing a label for a row the tenant does not own would read as their naming.';

-- ---------------------------------------------------------------------------
-- 141.4  THE PROPOSAL PLANE FOR CONFIG (owner + checker, W150's audit note)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charge_change_proposals (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  charge_code       varchar(60) NOT NULL,
  -- add    — a code this tenant does not yet override
  -- change — supersede the tenant's current row from a future date (the old row is END-DATED, never edited)
  -- end    — stop overriding: end-date the tenant's row and fall back to the platform default
  action            varchar(10) NOT NULL,
  label             varchar(120),
  calc_method       varchar(20),
  config            jsonb,
  currency_code     char(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  effective_from    date NOT NULL,
  -- The row this proposal supersedes, read server-side at propose time. NULL for 'add'.
  supersedes_id     uuid REFERENCES charge_definitions(id),
  status            varchar(10) NOT NULL DEFAULT 'pending',
  proposed_by       uuid NOT NULL REFERENCES users(id),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  proposal_note     text NOT NULL,
  decided_by        uuid REFERENCES users(id),
  decided_at        timestamptz,
  decision_note     text,
  applied_at        timestamptz,
  -- The row this proposal created, once applied — the link from a decision to the price it produced.
  applied_definition_id uuid REFERENCES charge_definitions(id)
);
CALL add_std_columns('charge_change_proposals');

ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_action;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_action CHECK (action IN ('add', 'change', 'end'));
ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_status;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_status CHECK (status IN ('pending', 'approved', 'rejected', 'applied'));

-- THE THIRD MAKER-CHECKER SITE IN THE TENANT REALM (0114's shape, 0139's rule): W150's audit note reads "Charge
-- changes are recorded · owner + checker". Both NULL escapes are load-bearing — a pending proposal has no checker.
ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_maker_ne_checker;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_maker_ne_checker CHECK (
    decided_by IS NULL OR decided_by <> proposed_by);

ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_decision_evidence;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_decision_evidence CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected', 'applied') AND decided_by IS NOT NULL AND decided_at IS NOT NULL));

-- **BOTH NOTE FLOORS NAME THEIR COLUMN FIRST** — 0139 shipped `status <> 'rejected' OR char_length(...) >= 20`, and a
-- NULL note made that `false OR NULL` = NULL, which a CHECK treats as SATISFIED. The rule was a comment until a live
-- apply tried the thing it forbade. Written correctly here from the start.
ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_notes;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_notes CHECK (
    proposal_note IS NOT NULL AND char_length(btrim(proposal_note)) >= 20
    AND (status <> 'rejected'
         OR (decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20)));

-- An 'add' or 'change' must carry the rule it proposes; an 'end' must not (it removes an override).
ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_shape;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_shape CHECK (
    (action = 'end' AND calc_method IS NULL AND config IS NULL AND supersedes_id IS NOT NULL)
    OR (action = 'change' AND calc_method IS NOT NULL AND config IS NOT NULL AND supersedes_id IS NOT NULL)
    OR (action = 'add' AND calc_method IS NOT NULL AND config IS NOT NULL AND supersedes_id IS NULL));

ALTER TABLE charge_change_proposals DROP CONSTRAINT IF EXISTS ck_charge_prop_applied;
ALTER TABLE charge_change_proposals
  ADD CONSTRAINT ck_charge_prop_applied CHECK (
    (applied_at IS NULL AND status <> 'applied') OR (applied_at IS NOT NULL AND status = 'applied'));

-- ONE OPEN PROPOSAL PER CODE. Two pending changes to the same fee mean two checkers can each approve a different
-- price and whichever applies first decides what buyers pay — a race over money, settled by network latency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_prop_open
  ON charge_change_proposals (tenant_id, charge_code)
  WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_charge_prop_pending
  ON charge_change_proposals (tenant_id, proposed_at)
  WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_charge_prop_recent
  ON charge_change_proposals (tenant_id, proposed_at DESC, id DESC);

-- Append-only for the platform realm, writable by the tenant app that proposes and signs (0119/0121/0126/0139/0140).
REVOKE ALL ON charge_change_proposals FROM kv_relay;
REVOKE DELETE, TRUNCATE ON charge_change_proposals FROM kv_app, kv_admin;
REVOKE INSERT, UPDATE ON charge_change_proposals FROM kv_admin;
GRANT SELECT, INSERT, UPDATE ON charge_change_proposals TO kv_app;
GRANT SELECT ON charge_change_proposals TO kv_readonly;

ALTER TABLE charge_change_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_reads_own_charge_proposals ON charge_change_proposals;
CREATE POLICY tenant_reads_own_charge_proposals ON charge_change_proposals
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Now the back-reference, once both tables exist.
ALTER TABLE charge_definitions DROP CONSTRAINT IF EXISTS charge_definitions_proposal_id_fkey;
ALTER TABLE charge_definitions
  ADD CONSTRAINT charge_definitions_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES charge_change_proposals(id);

COMMENT ON TABLE charge_change_proposals IS
  'Owner + checker for a tenant''s own fee table (0141, PC-56 TENANT-3c-2). W150: "Charge changes are recorded · owner + checker · effective-dated rows, never edits". Applying a proposal INSERTS a new dated row and END-DATES the previous one; no approved figure is ever edited in place. Deliberately NOT refund_approvals (0139): that table''s order_id is NOT NULL and its amount is a refund a checker signs for — a config change is neither.';
