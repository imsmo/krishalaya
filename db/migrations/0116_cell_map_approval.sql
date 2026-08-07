-- ============================================================================
-- MIGRATION 0116 — THE ROUTING MAP'S INTEGRITY: A CHECKER THE CANON NAMES FIVE TIMES, A `weight`
-- COLUMN NOTHING READS, AND A DEFAULT CELL AN OPERATOR CAN DRAIN (PC-56 ADMIN-8)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- FIRST, WHAT IS ALREADY RIGHT HERE, because it changes what this migration should be. Unlike every plane since
-- ADMIN-5, the cells module is genuinely well built: 0043's schema is sound, the residency lock IS enforced on every
-- move (`sameResidency`, fail-closed), the capacity guard IS enforced on every placement (`hasRoom`), retire-is-refused-
-- when-not-empty IS guarded, `placed_count` IS maintained in the same transaction as the placement, and `dsn_secret_ref`
-- really does hold a vault reference rather than a DSN. So this wave adds controls rather than repairing claims — three
-- of them — and does NOT touch the routing invariants that work.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: THE CANON NAMES A CHECKER FIVE TIMES AND THERE IS NO CHECKER ANYWHERE
-- ---------------------------------------------------------------------------
--   W029  "ALL changes are maker-checker + reasoned"
--   W030  drain dialog: "This action is recorded · requires checker (`cells.approve`) · blocked while is_default=true"
--   W031  "Weight/status changes need `cells.write` + checker; they shift the placement hash for new tenants"
--   W036  "Raising capacity_tenants needs `cells.write` + checker (infra cost approval)"
--   W038  "Set is_default for BD → open for placements (checker)"
--
-- Every one of those writes today is ONE operator holding `cells.manage`, applied immediately. **`cells.approve` does
-- not exist as a permission in any realm.** A reason IS mandatory and IS recorded (0043 got that right, and it is why
-- `cell_map_changes.reason` is NOT NULL) — but a reason is a note, not a second pair of eyes, and this map decides which
-- physical stack and which COUNTRY a tenant's data lives in.
--
-- TWELFTH MAKER-CHECKER SITE. The shape differs from the previous eleven and the difference is the design: those all
-- guarded ONE object (an adjustment, a scheme version, a DSR, a payout batch, a model). This map has three object types
-- — cell, shard, placement — and the canon asks for a checker on transitions of all three. One proposal table serving
-- all three is therefore the right answer here where a central `approvals` table was the wrong answer in
-- `two-person-rule.ts`'s header: there, three genuinely different workflows would have needed a polymorphic entity_type
-- for no gain; here the three objects already SHARE a change log (`cell_map_changes`, keyed exactly this way) and share
-- one lifecycle (`node.state.ts` is explicit that cells and shards are identical). The polymorphism is not introduced by
-- the approval table — it is already the shape of the domain.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: `shards.weight` IS VALIDATED, DISPLAYED, AND READ BY NOTHING
-- ---------------------------------------------------------------------------
-- W031's subtitle: "tenant→shard via consistent hash weighted by `weight`. **weight 0 = drain (no new placements)**."
-- W030 shows shard-2 as "draining · weight 0" and W036 draws a shard-balance chart with "draining (weight 0)" in its
-- legend.
--
-- `assertWeight` bounds the value in `routing.ts`. `TenantCellAssignmentService.place` checks
-- `acceptsPlacement(shard.status)` — status only. **THERE IS NO READ OF `weight` ON THE PLACEMENT PATH.** So an operator
-- who sets a hot shard to weight 0 to drain it keeps receiving new tenants onto it, and the console shows weight 0 beside
-- a rising `placed_count`. That is a column recording an intention no code honours — the same shape as ADMIN-5f's
-- `action_taken`, 0114's payout approval and ADMIN-7's fairness column, and the FIFTH occurrence of the family.
--
-- Fixed in apps/admin-api on the placement path AND here as a trigger, for the reason 0114 gave: a guard living in one
-- service method is one careless caller away from being gone, and the condition spans two tables so no CHECK can express
-- it. **NOT the consistent hash itself** — W031 describes an automatic weighted placement, and placement today is an
-- explicit operator choice (`dto.shardId`). An auto-placer is ADMIN-8-Q1, named rather than invented, because a hash
-- function that starts routing tenants is not a thing to add in the same wave that adds the approval gate for routing.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: AN OPERATOR CAN DRAIN THE CELL EVERY NEW TENANT IN THE COUNTRY LANDS IN
-- ---------------------------------------------------------------------------
-- W030's drain dialog says it twice — "default flag must move to another IN cell first" and "blocked while
-- is_default=true". `setCellStatus` checks retire-when-empty and nothing else. So `in-west-1`, the default landing cell
-- for IN, can be moved to `draining` by one operator with one reason string — and because `acceptsPlacement` is
-- fail-closed on anything but `active`, **every new tenant registration in India then fails at placement**. Existing
-- tenants keep working, which is exactly what makes it hard to notice: the platform does not go down, it stops taking
-- customers.
--
-- A CHECK cannot express it (the guard is about a row's own two columns and IS expressible — see below) so it lands as a
-- CHECK as well as a service assertion, which is the cheapest possible correct answer and the one this migration prefers
-- wherever it is available.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · THE DEFAULT CELL MAY NOT LEAVE `active`
-- ---------------------------------------------------------------------------
-- The whole of defect 3, as one constraint on one row's two columns. NOT VALID because the platform's live map may
-- already hold a non-active default (nothing has ever forbidden it) and the console must be able to SHOW that rather
-- than the migration refusing to apply — the pattern 0115 established with the unaudited-model gate.
--
-- WHY THE CONSTRAINT AND NOT ONLY THE SERVICE CHECK: this one is a pure single-row invariant, which makes it the cheapest
-- kind of guarantee there is. The service assertion still exists, because it can say "move the default flag to another IN
-- cell first" and a constraint violation cannot.
ALTER TABLE cells
  DROP CONSTRAINT IF EXISTS ck_cells_default_is_active;
ALTER TABLE cells
  ADD CONSTRAINT ck_cells_default_is_active CHECK (
    NOT is_default OR status = 'active') NOT VALID;

-- ---------------------------------------------------------------------------
-- 2 · THE CHANGE PROPOSAL — THE TWELFTH MAKER-CHECKER SITE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cell_map_proposals (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- The same three-value vocabulary `cell_map_changes` uses, and deliberately the same column names: a proposal becomes
  -- a change, and a reader comparing the two tables should not have to translate.
  entity_type   varchar(16) NOT NULL,
  entity_id     varchar(80) NOT NULL,
  action        varchar(20) NOT NULL,
  -- WHAT IS BEING PROPOSED, as the patch that will be applied. Stored rather than recomputed at approval, because a
  -- checker signs a specific change: "raise capacity to 2000" and "raise capacity to whatever the maker typed when you
  -- press this" are different acts, and the second is not an approval.
  patch         jsonb NOT NULL,
  -- The state the maker OBSERVED. Re-read at approval and compared — if the row moved in between, the proposal is stale
  -- and must be refused rather than applied over a world the checker never saw. Same reasoning as 0114's preflight drift.
  observed      jsonb NOT NULL,
  reason        text NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'open',
  -- Bare uuids, no FK. A platform operator has no `users` row — realm-identity for the SEVENTH time (ADMIN-2d's support
  -- reply, the ticket ATTACH, 0067's checker columns, 0112's `handled_by_admin_id`, 0114's payout approval, 0115's audit
  -- and now this). Note that 0043 already got this right for `cell_map_changes.actor_user_id`, which is a bare uuid with
  -- no reference — one of the few places on this platform that did.
  proposed_by_admin_id uuid NOT NULL,
  proposed_at   timestamptz NOT NULL DEFAULT now(),
  decided_by_admin_id  uuid,
  decided_at    timestamptz,
  decision_note text,
  -- The change row this proposal produced, once applied. What makes the audit trail answer "who authorised this routing
  -- change" with a row rather than with an adjacent timestamp.
  applied_change_id uuid REFERENCES cell_map_changes(id)
);
CALL add_std_columns('cell_map_proposals');

ALTER TABLE cell_map_proposals
  ADD CONSTRAINT ck_cmp_entity_type CHECK (entity_type IN ('cell', 'shard', 'placement'));
ALTER TABLE cell_map_proposals
  ADD CONSTRAINT ck_cmp_action CHECK (
    action IN ('created', 'updated', 'status_changed', 'placed', 'moved', 'removed'));
ALTER TABLE cell_map_proposals
  ADD CONSTRAINT ck_cmp_status CHECK (status IN ('open', 'applied', 'rejected', 'stale'));
-- 'stale' is its own terminal status rather than a rejection, because the two mean different things to the maker: a
-- rejection is a colleague saying no, and a stale proposal is the world having moved. Collapsing them would tell somebody
-- their reasoning was refused when nobody read it.

-- THE TWELFTH MAKER-CHECKER SITE. Shape from `makerNeCheckerConstraint`; both NULL escapes load-bearing.
ALTER TABLE cell_map_proposals
  ADD CONSTRAINT ck_cell_map_proposals_maker_ne_checker CHECK (
    decided_by_admin_id IS NULL OR proposed_by_admin_id IS NULL OR decided_by_admin_id <> proposed_by_admin_id);

-- A DECIDED PROPOSAL NAMES ITS DECIDER AND ITS TIME, and an applied one names the change it produced. Without the second
-- half, `status='applied'` could exist with no `applied_change_id` — a claim that a routing change happened with nothing
-- in the change log to point at, which is the defect family this programme keeps finding.
ALTER TABLE cell_map_proposals
  ADD CONSTRAINT ck_cmp_decision_evidence CHECK (
    (status = 'open' AND decided_by_admin_id IS NULL AND decided_at IS NULL AND applied_change_id IS NULL)
    OR (status = 'applied' AND decided_by_admin_id IS NOT NULL AND decided_at IS NOT NULL AND applied_change_id IS NOT NULL)
    OR (status IN ('rejected', 'stale') AND decided_at IS NOT NULL));
-- A rejection needs a decider; a STALE outcome does not, because staleness is detected rather than decided — the
-- proposal was found to be out of date, possibly by the maker themselves reloading the page.
ALTER TABLE cell_map_proposals
  ADD CONSTRAINT ck_cmp_rejection_reason CHECK (
    status <> 'rejected'
    OR (decided_by_admin_id IS NOT NULL AND char_length(btrim(coalesce(decision_note, ''))) >= 20));

-- ONE OPEN PROPOSAL PER OBJECT. Two open proposals on the same cell would let a checker approve the one nobody meant —
-- and on this map the two could be "drain it" and "raise its capacity", which are opposite intentions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmp_one_open_per_entity
  ON cell_map_proposals (entity_type, entity_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_cmp_open ON cell_map_proposals (proposed_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_cmp_recent ON cell_map_proposals (created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 3 · THE WEIGHT-0 PLACEMENT GATE
-- ---------------------------------------------------------------------------
-- Defect 2, as a trigger. The condition spans `tenant_placements` and `shards`, so no CHECK can reach it — the same
-- situation 0114 was in with the payout batch, and the same instrument.
--
-- IT FIRES ON INSERT AND ON A SHARD CHANGE, not on every UPDATE. A placement being REMOVED from a weight-0 shard is
-- exactly what draining means and must never be blocked; a placement being moved ONTO one is what this refuses.
CREATE OR REPLACE FUNCTION assert_shard_accepts_placement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  w int;
  st text;
BEGIN
  -- On UPDATE, only a change of shard matters. A `pinned` toggle or a soft-delete on a placement that already lives on a
  -- draining shard must pass, or draining becomes impossible to administer.
  IF TG_OP = 'UPDATE' AND NEW.shard_id = OLD.shard_id THEN
    RETURN NEW;
  END IF;
  -- A soft-deleted placement is a placement being REMOVED. Never blocked.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT weight, status INTO w, st FROM shards WHERE id = NEW.shard_id;

  IF w IS NULL THEN
    RAISE EXCEPTION 'placement names shard % which does not exist', NEW.shard_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- `weight = 0` MEANS DRAIN, and W031 says so in as many words. Until this trigger the column said it and nothing
  -- enforced it.
  IF w = 0 THEN
    RAISE EXCEPTION 'shard % has weight 0, which means draining — it accepts no new placements (W031)', NEW.shard_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Belt to the service's brace: `acceptsPlacement` already refuses a non-active shard, and a guard on the routing map
  -- is worth having in both places.
  IF st <> 'active' THEN
    RAISE EXCEPTION 'shard % is %, and only an active shard accepts placements', NEW.shard_id, st
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_placement_shard_accepts ON tenant_placements;
CREATE TRIGGER trg_placement_shard_accepts
  BEFORE INSERT OR UPDATE OF shard_id ON tenant_placements
  FOR EACH ROW
  EXECUTE FUNCTION assert_shard_accepts_placement();

-- ---------------------------------------------------------------------------
-- 4 · THE DENORMALISED COUNT NOBODY VERIFIES
-- ---------------------------------------------------------------------------
-- `cells.placed_count` and `shards.placed_count` are maintained atomically with each placement change — 0043 and the
-- repository both say so, and it is true. **But nothing has ever compared them against `tenant_placements`.** The capacity
-- guard reads the denormalised number, so drift means one of two things: a cell with room refusing placements, or a cell
-- past its cap accepting them. Same shape as ADMIN-6's `cached_balance_minor`, where the per-account drift check had
-- existed twice since 0006 and never run — and the same reason it matters: the denormalised figure is the one the guard
-- trusts and the derived one is the truth.
--
-- Append-only, like `ledger_chain_verifications` (0113). A reconciliation that can be edited is not evidence.
CREATE TABLE IF NOT EXISTS placement_count_checks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  node_type     varchar(8) NOT NULL,
  node_id       uuid NOT NULL,
  -- The two numbers, kept apart. `stored` is what the guard reads; `derived` is `count(*)` over live placements.
  stored_count  integer NOT NULL,
  derived_count integer NOT NULL,
  drift         integer NOT NULL,
  -- NULL for the scheduled sweep, an admin uuid for an on-demand check from the console — so a console-run check is
  -- distinguishable from the cadence, the same reasoning as 0114's `triggered_by_admin_id`.
  checked_by_admin_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE placement_count_checks
  ADD CONSTRAINT ck_pcc_node_type CHECK (node_type IN ('cell', 'shard'));
-- The drift must equal the difference. Not a comment — a stored drift that disagrees with its own operands would make
-- the whole record useless, and this is the one arithmetic a CHECK can hold.
ALTER TABLE placement_count_checks
  ADD CONSTRAINT ck_pcc_drift CHECK (drift = stored_count - derived_count);
ALTER TABLE placement_count_checks
  ADD CONSTRAINT ck_pcc_nonneg CHECK (stored_count >= 0 AND derived_count >= 0);

-- The console's read: the newest check per node, and every drifted node.
CREATE INDEX IF NOT EXISTS idx_pcc_node_recent ON placement_count_checks (node_type, node_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pcc_drifted ON placement_count_checks (created_at DESC) WHERE drift <> 0;

-- ---------------------------------------------------------------------------
-- 5 · W036's GROWTH RATE, FROM THE HISTORY THAT ALREADY EXISTS
-- ---------------------------------------------------------------------------
-- W036 prints "+38/week · full in ≈ 21 weeks at current rate", and W037's banner declares a forecasting service backend-
-- pending (DELTA-013). **The weekly rate is not a forecast — it is a count of `cell_map_changes` rows with
-- `action='placed'`**, and that table has existed since 0043 with every placement in it. So the rate is computable today
-- and the PROJECTION is not, which is exactly where the line between this wave and ADMIN-8b falls.
--
-- The index that makes it a range scan rather than a filter over the whole history. `idx_cell_map_changes` (0043) leads
-- with `entity_type, entity_id` — right for one object's history and useless for "every placement in the last 8 weeks".
CREATE INDEX IF NOT EXISTS idx_cell_map_changes_placed
  ON cell_map_changes (created_at DESC)
  WHERE entity_type = 'placement' AND action IN ('placed', 'moved', 'removed');

-- ---------------------------------------------------------------------------
-- 6 · GRANTS
-- ---------------------------------------------------------------------------
-- The 0014/0018 `ALTER DEFAULT PRIVILEGES` trap: every grant and revoke below is explicit.
--
-- The proposal table is a god-mode object end to end — proposed, decided and applied by platform operators — so kv_admin
-- writes it and nobody else touches it. kv_app must not even read it: which cells are draining is infrastructure, and a
-- tenant-facing service has no business knowing the platform is planning to move it.
REVOKE ALL ON cell_map_proposals FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON cell_map_proposals TO kv_admin;
GRANT SELECT ON cell_map_proposals TO kv_readonly;
-- No DELETE to anybody: a rejected proposal is the record that somebody looked at a routing change and said no.

-- The count check is written by the console (kv_admin) and by a worker sweep (kv_relay).
REVOKE ALL ON placement_count_checks FROM kv_app;
GRANT SELECT, INSERT ON placement_count_checks TO kv_admin;
GRANT SELECT, INSERT ON placement_count_checks TO kv_relay;
GRANT SELECT ON placement_count_checks TO kv_readonly;
-- Append-only, for the reason above.
REVOKE UPDATE, DELETE ON placement_count_checks FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 7 · RLS SWEEP
-- ---------------------------------------------------------------------------
-- Both new tables are GLOBAL by nature: the cell map is the routing directory itself and `tenant_placements` is
-- explicitly "GLOBAL directory, no RLS by design" in 0043's own comment. No tenant_id, no policy — same reasoning as
-- `reconciliation_runs`, `ledger_chain_verifications` (0113), `settlement_runs` (0114) and `ai_fairness_audits` (0115).
-- Stated because 0020 once claimed RLS on a table that had none.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cell_map_proposals', 'placement_count_checks'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t AND rowsecurity) THEN
      RAISE NOTICE '% has RLS enabled; it is a global routing-directory table and should not', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8 · WHAT IS DELIBERATELY NOT DONE
-- ---------------------------------------------------------------------------
-- NO CONSISTENT-HASH AUTO-PLACER. W031 says "tenant→shard via consistent hash weighted by `weight`" and placement today
-- is an explicit operator choice of `shardId`. Adding a hash function that starts routing tenants automatically, in the
-- same wave that adds the approval gate FOR routing changes, would be two large changes to one safety-critical path at
-- once. ADMIN-8-Q1. What this wave does instead is make `weight` MEAN something — a weight-0 shard now refuses
-- placements, which is the half of the canon's sentence that was a lie rather than merely unbuilt.
--
-- NO `migration_jobs` TABLE (W034). The canon's own banner: "Backend pending (DELTA-012): the move executes as a
-- background job pipeline (copy → verify → cutover → cleanup) … a dedicated migration_jobs table/state machine is not yet
-- in schema. Design leads." A five-state pipeline with a write freeze, a rollback and a 7-day safety hold is a
-- subsystem, and inventing its state machine inside an approval wave is the guess that becomes permanent. ADMIN-8b.
--
-- NO FORECAST STORE (W037). Same: "Backend pending (DELTA-013): forecast analytics (growth model per cell) … a
-- forecasting service is not in schema. Design leads." The RATE is computable from history and is built (§5); the
-- PROJECTION is not. ADMIN-8b.
--
-- NO RICHER RESIDENCY ENGINE (W033). Same again: "a richer rules engine (per-data-class residency, cross-border
-- processing agreements) is BACKEND PENDING — DELTA-011." The lock that exists is enforced and correct; per-data-class
-- rules are a different object. ADMIN-8b.
--
-- THE NOT VALID CONSTRAINT: `ck_cells_default_is_active` only. The live map may already hold a non-active default,
-- because nothing has ever forbidden it — and that is the finding, so the console must be able to show it. Everything
-- else in this file constrains new tables and is validated. The standing debt item now covers 0110–0116.
