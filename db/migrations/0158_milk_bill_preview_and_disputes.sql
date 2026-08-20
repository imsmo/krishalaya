-- 0158_milk_bill_preview_and_disputes.sql · PC-56 TENANT-6c-2 · W169 (Dairy payout cycles)
--
-- W169's subtitle is a promise to 312 families:
--   *"Preview goes to every member in Gujarati BEFORE money moves — surprises are for birthdays, not milk money."*
-- and its timeline spells out the mechanism:
--   *"bills `previewed` Thu morning (member sees every pour + every deduction, 24h dispute window) → `approved` Thu
--    evening (maker-checker) → `paid` Fri 17 Jul"*, with *"disputed pauses one bill, never the cycle"* and a tile
--   counting *"Last cycle disputes 2 / 309 · both resolved before payday"*.
--
-- NOT ONE PART OF THAT EXISTED.
--
--   1. **`dispute_window_ends` HAS A READER AND NO WRITER.** The column has been on `milk_bills` since 0009 and is read
--      by `apps/mobile/src/features/dairy/dairy.ts:disputeWindowOpen()`. Nothing has ever written it: `MilkBill.generate`
--      defaults it to null, the DTO has no field for it, and `update()` does not touch the column. So the window is
--      CLOSED for every bill that has ever existed, and the mobile app's function has returned `false` on every call
--      it has ever made.
--
--   2. **A MEMBER CANNOT DISPUTE A BILL AT ALL.** `MilkBill.dispute()` exists on the aggregate and is called by NO
--      service and NO route — `MilkBillService.transition` is only ever invoked by `preview` and `approve`. There is
--      no dispute record anywhere: no reason, no raiser, no time, no outcome. W169's "2 / 309 disputes" counts rows
--      of a table that does not exist.
--
--   3. **NOTHING TELLS THE MEMBER ANYTHING.** No dairy bill event is in `notification-event-map.ts` (before this wave
--      it held only 6b-1's two quality events), so "preview goes to every member in Gujarati" is a promise nothing
--      keeps. **AND IT IS WORSE THAN A MISSING ROW** — see 158.6.
--
--   4. **PREVIEW IS PER-BILL AND THE CANON'S ACT IS PER-CYCLE.** W169's header button is *"Preview cycle 01–15 Jul
--      (Wed close)"* — one act over 312 bills. `POST /dairy/milk-bills/:id/preview` moves exactly one.
--
--   5. **AND THE WINDOW WOULD HAVE MEANT NOTHING IF IT HAD BEEN WRITTEN.** `pay()` checks `status === 'approved'` and
--      nothing else. A 24-hour window whose expiry no money path consults is decoration — the same defect shape this
--      programme has now found in a rate card that nothing archived and a premium band nothing applied. So the window
--      is ENFORCED here: the wallet movement is refused while the member's window is still open.
--
-- WHAT THIS MIGRATION DOES NOT DO, AND SAYS SO:
--   * `settlement.close` + maker-checker on APPROVE, and the deduction's destination with W169's ">25% needs the
--     member's fresh consent" — TENANT-6c-3. The cycle status CHECK below therefore admits `previewed` and NOT
--     `approved`: a state no code can reach is how a board ends up showing something nobody can act on.
--   * Correcting the ARITHMETIC of a bill an upheld dispute proved wrong. There is no adjustment line and no credit
--     note on a milk bill, so the honest resolution built here is a VOID: the bill is soft-deleted, its pours are
--     released back to unbilled, and the cycle's next generation pass rebuilds it from whatever the pours now say
--     (which is what 6b-1's quality path can already correct). Named in 158.3.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- 158.1  THE PREVIEW, ON THE CYCLE
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE dairy_bill_cycles
  ADD COLUMN IF NOT EXISTS previewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS previewed_by uuid REFERENCES users(id),
  -- How far the bounded, resumable preview pass has got. 312 bills cannot be one transaction (0157's header argues
  -- this for generation and the same argument holds here: one member's failure must not discard 311 notifications
  -- already queued), so the pass is re-callable and this is what makes "is it done?" answerable.
  ADD COLUMN IF NOT EXISTS bills_previewed integer;

ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_status;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_status
  CHECK (status IN ('open','closed','previewed'));

-- **0157'S CLOSE-STAMP CHECK ASSUMED ITS OWN STATUS LIST WAS FINAL, AND A LIVE TEST CAUGHT IT.**
-- It read `CHECK ((status = 'closed') = (closed_at IS NOT NULL))`, which was exactly right while `closed` was the only
-- state past `open` — and refuses every row the moment a cycle moves ON from closed, because `closed_at` stays set and
-- the equality breaks. Generalised to the invariant that was actually meant: `open` means no close stamp, and every
-- other state means there is one. Worth writing down as a pattern: a CHECK phrased against one VALUE of an enum, rather
-- than against the property that value stands for, becomes a bug the next time the enum grows.
ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_closed_stamp;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_closed_stamp
  CHECK ((status = 'open') = (closed_at IS NULL));

-- A preview carries its author and its time, or it is an act nobody is accountable for — the ruling 0156 made for a
-- quality decision, applied to the act that tells 312 families what they are about to be paid.
ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_preview_stamp;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_preview_stamp
  CHECK ((previewed_at IS NULL) = (previewed_by IS NULL));

-- `previewed` requires the stamp, and cannot be reached without first being closed. A cycle previewed while still
-- collecting milk would show members a bill for half a fortnight.
ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_previewed_after_close;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_previewed_after_close
  CHECK (status <> 'previewed' OR (previewed_at IS NOT NULL AND closed_at IS NOT NULL));

COMMENT ON COLUMN dairy_bill_cycles.previewed_at IS
  'PC-56 TENANT-6c-2. When this cycle''s bills were sent to their members for checking — W169''s "Preview cycle 01-15 '
  'Jul (Wed close)". The act is on the CYCLE because the canon''s button is: one decision over 312 bills, not 312 '
  'decisions. The per-bill work it drives is bounded and resumable (bills_previewed), so a partial pass is a state an '
  'operator can read rather than an unknown.';

GRANT UPDATE (previewed_at, previewed_by, bills_previewed) ON dairy_bill_cycles TO kv_app;

-- **AND THE SAME MISTAKE AGAIN, IN AN INDEX PREDICATE.** 0157's claim index for "cycles that still need bills" reads
-- `WHERE status = 'closed' AND ...`, so it stops covering a cycle the moment it is previewed — and a bill VOIDED after
-- preview (TENANT-6c-2's only way to correct a wrong bill) releases its pours and would never be rebuilt, because
-- neither the index nor the query behind it would look at that cycle again. Rephrased against the PROPERTY the status
-- stood for: has this window shut. Third instance of the shape in two waves; the pattern is now written down in three
-- places so the next wave phrases its guards against facts rather than against enum values.
DROP INDEX IF EXISTS idx_dairy_cycle_needs_bills;
CREATE INDEX IF NOT EXISTS idx_dairy_cycle_needs_bills
  ON dairy_bill_cycles (closes_at)
  WHERE closed_at IS NOT NULL AND deleted_at IS NULL
    AND (bills_generated_at IS NULL OR coalesce(bills_failed, 0) > 0);

-- ---------------------------------------------------------------------------------------------------------------
-- 158.2  THE WINDOW, ON THE BILL
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_bills
  ADD COLUMN IF NOT EXISTS previewed_at timestamptz,
  -- Why a bill was voided. Free text and REQUIRED by the domain rather than a code list: the reasons a milk bill
  -- turns out wrong are as varied as the reasons milk is (a mis-keyed weight, a pour credited to the wrong card, a
  -- quality hold decided after the bill was built), and a closed vocabulary here would be a guess dressed as data.
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);

ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_void_stamp;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_void_stamp
  CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));

-- A previewed bill must carry the window it promised. W169 tells the member they have 24 hours; a `previewed` row with
-- no expiry is that promise with no end, which is a different (and unenforceable) promise.
ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_preview_window;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_preview_window
  CHECK (previewed_at IS NULL OR dispute_window_ends IS NOT NULL);

COMMENT ON COLUMN milk_bills.previewed_at IS
  'PC-56 TENANT-6c-2: when this bill was shown to its member. Distinct from `status`, which a later dispute and its '
  'resolution move back and forth — this is the instant the 24h window started, and the window''s expiry '
  '(dispute_window_ends) is now ENFORCED: MilkBillService.pay refuses to move money while it is open.';

-- **THE UNIQUE CONSTRAINT BECOMES PARTIAL, WHICH IS WHAT MAKES A VOID POSSIBLE AT ALL.**
-- `UNIQUE (membership_id, period_start, period_end)` counted soft-deleted rows, so a bill an upheld dispute proved
-- wrong could be soft-deleted and then NEVER REBUILT: the constraint still held its place. Voiding without this is
-- deleting a member's bill and leaving them unpayable for that fortnight, which is worse than the bug being disputed.
ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS milk_bills_membership_id_period_start_period_end_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_milkbills_member_period
  ON milk_bills (membership_id, period_start, period_end)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX uq_milkbills_member_period IS
  'PC-56 TENANT-6c-2: one LIVE bill per member per period. Replaces the total UNIQUE constraint, which counted '
  'soft-deleted rows and therefore made voiding a wrong bill a one-way door — the member could never be rebuilt a '
  'correct one for that fortnight. Still the mechanism that makes cycle generation idempotent (0157).';

-- The preview pass and the payday both ask "which of this cycle's bills are still waiting?"
CREATE INDEX IF NOT EXISTS idx_milkbills_cycle_window
  ON milk_bills (tenant_id, cycle_id, status, dispute_window_ends)
  WHERE cycle_id IS NOT NULL AND deleted_at IS NULL;

-- NO COLUMN GRANT IS WRITTEN FOR `milk_bills`, DELIBERATELY. 0079 gave kv_app TABLE-level INSERT+UPDATE on this table
-- (it is the writer of `status` and `payout_id`), so a column list here would be decoration — 0157's finding, and the
-- reason that finding is written down. Narrowing `milk_bills` the way 0080 narrowed `milk_collections` is a real piece
-- of work with a real blast radius (every bill transition goes through `update()`), and it is NAMED, not smuggled into
-- a wave about disputes.

-- ---------------------------------------------------------------------------------------------------------------
-- 158.3  THE DISPUTE — the record W169 counts and this platform never kept
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milk_bill_disputes (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  bill_id           uuid NOT NULL REFERENCES milk_bills(id),
  membership_id     uuid NOT NULL REFERENCES dairy_memberships(id),

  -- The MEMBER's own user id. Staff raising a dispute on a member's behalf is a different act with a different meaning
  -- and is not built: the whole point of the window is that the person whose money it is gets to object.
  raised_by_user_id uuid NOT NULL REFERENCES users(id),
  raised_at         timestamptz NOT NULL DEFAULT now(),

  -- The member's own words, required. NOT a code list: inventing a closed set of reasons a farmer may give about their
  -- own milk money would discard the only part of a dispute that is actually informative, and every list we could write
  -- would be missing the case that matters (Law 6 cuts the other way here — this is not a string a tenant admin should
  -- control, it is testimony).
  reason            text NOT NULL,

  -- The window this dispute was raised INSIDE, copied at insert. Evidence: a dispute must be arguable years later
  -- without depending on a column the bill has since had rewritten.
  window_ended_at   timestamptz NOT NULL,

  status            varchar(16) NOT NULL DEFAULT 'open',
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES users(id),
  resolution_note   text,
  /** Set when the resolution was to VOID and rebuild the bill — the only correction this platform can make. */
  voided_bill       boolean NOT NULL DEFAULT false,

  CONSTRAINT ck_milk_bill_dispute_status CHECK (status IN ('open','upheld','rejected')),
  CONSTRAINT ck_milk_bill_dispute_reason CHECK (length(btrim(reason)) >= 10),
  -- A resolution carries its decider, its time AND its reasoning. A member told "your dispute was rejected" with no
  -- explanation has been processed, not answered.
  CONSTRAINT ck_milk_bill_dispute_resolution CHECK (
    (status = 'open') = (resolved_at IS NULL)
    AND (resolved_at IS NULL) = (resolved_by IS NULL)
    AND (resolved_at IS NULL) = (resolution_note IS NULL)),
  CONSTRAINT ck_milk_bill_dispute_note CHECK (resolution_note IS NULL OR length(btrim(resolution_note)) >= 10),
  -- Only an UPHELD dispute can have voided the bill; rejecting one and voiding the bill anyway is two different
  -- decisions recorded as one.
  CONSTRAINT ck_milk_bill_dispute_void CHECK (voided_bill = false OR status = 'upheld')
);
CALL add_std_columns('milk_bill_disputes');

COMMENT ON TABLE milk_bill_disputes IS
  'PC-56 TENANT-6c-2. W169 counts "Last cycle disputes 2 / 309 - both resolved before payday" and promises the member '
  'a "24h dispute window". BEFORE THIS TABLE A MEMBER COULD NOT DISPUTE A BILL AT ALL: MilkBill.dispute() existed on '
  'the aggregate and was called by no service and no route, dispute_window_ends had a reader in apps/mobile and no '
  'writer anywhere, and there was no record of a reason, a raiser, a time or an outcome. One row per objection, raised '
  'by the MEMBER inside their own window, resolved by the cooperative with a note the member is told.';

-- ONE OPEN DISPUTE PER BILL. Two would let two resolutions disagree about one payment; a member who objects again
-- after a rejection raises a NEW dispute, which the history keeps.
CREATE UNIQUE INDEX IF NOT EXISTS uq_milk_bill_dispute_open
  ON milk_bill_disputes (bill_id) WHERE status = 'open' AND deleted_at IS NULL;

-- The operator's queue: what is waiting on the cooperative, oldest first (a dispute is a family waiting for money).
CREATE INDEX IF NOT EXISTS idx_milk_bill_dispute_open
  ON milk_bill_disputes (tenant_id, raised_at)
  WHERE status = 'open' AND deleted_at IS NULL;

-- W169's per-cycle count, and a member's own history.
CREATE INDEX IF NOT EXISTS idx_milk_bill_dispute_bill
  ON milk_bill_disputes (tenant_id, bill_id, raised_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_milk_bill_dispute_member
  ON milk_bill_disputes (tenant_id, membership_id, raised_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE milk_bill_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE milk_bill_disputes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_milk_bill_disputes ON milk_bill_disputes;
CREATE POLICY tenant_isolation_milk_bill_disputes ON milk_bill_disputes
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- 0157's finding, applied from the start this time: `ALTER DEFAULT PRIVILEGES` on this database grants kv_app
-- INSERT+SELECT+UPDATE and kv_relay INSERT+SELECT+UPDATE+DELETE on every new table at CREATE TABLE time, and a
-- TABLE-level UPDATE supersedes every column-level one. So the REVOKEs come first or the narrowing is decoration.
REVOKE UPDATE, DELETE ON milk_bill_disputes FROM kv_app;
REVOKE ALL ON milk_bill_disputes FROM kv_relay;
GRANT SELECT, INSERT ON milk_bill_disputes TO kv_app;
-- A dispute's own testimony (reason, raiser, time, the window it was raised in) is APPEND-ONLY. Only the resolution
-- may be written, once, and the CHECK above forces it to arrive complete.
GRANT UPDATE (status, resolved_at, resolved_by, resolution_note, voided_bill, updated_at, updated_by)
  ON milk_bill_disputes TO kv_app;

-- ---------------------------------------------------------------------------------------------------------------
-- 158.4  THE WINDOW'S LENGTH, AS A TENANT'S OWN DECISION (Law 6)
-- ---------------------------------------------------------------------------------------------------------------
-- W169 says 24 hours. Stored rather than hardcoded for the same reason 0157 stored the payday: a cooperative whose
-- members walk in once a week may need three days, and one paying daily may need six hours. A literal 24 in the
-- service would be exactly the string Law 6 exists to stop.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.dispute_window_hours', 'int', 'tenant', 'money_path', '24'::jsonb,
       'Hours a member has to object to a previewed milk bill before it can be paid. W169: "member sees every pour + '
       'every deduction, 24h dispute window". ENFORCED — the wallet movement is refused while the window is open. '
       'Set 0 to pay as soon as a bill is approved, which is a decision to remove the member''s check, not a default.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.dispute_window_hours');

-- ---------------------------------------------------------------------------------------------------------------
-- 158.5  THE FLAG (Law 10)
-- ---------------------------------------------------------------------------------------------------------------
-- Gates the cooperative's SURFACE (previewing a cycle), because one click sends 312 SMS and starts 312 clocks. It
-- deliberately does NOT gate the member's DISPUTE, nor the pay-time window check: a farmer's right to object to their
-- own bill must not depend on whether a console feature is switched on, and a money guard that a flag can remove is
-- not a guard. Same ruling 0156 made for the pour-level hold.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_cycle_preview',
   'PC-56 TENANT-6c-2: preview a closed dairy cycle — set every bill''s 24h dispute window and notify every member in '
   'their own language, which is W169''s "preview goes to every member in Gujarati BEFORE money moves". OFF means the '
   'route is unreachable and bills stay in draft, i.e. exactly today''s behaviour. The member''s DISPUTE act and the '
   'pay-time window check are NOT behind this flag.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- 158.6  WHAT THIS FILE DOES NOT CONTAIN, AND WHERE IT LIVES INSTEAD
-- ---------------------------------------------------------------------------------------------------------------
-- **EVERY NOTIFICATION TEMPLATE SEEDED IN `db/seeds/core/0007_notification_events_templates.sql` RESOLVES TO NOTHING.**
--
-- 0122 made template wording versioned and put a send-time gate in `NotificationTemplateRepository.resolve()`, which
-- INNER JOINs `notification_template_versions` on `serving_version_id` with `lifecycle = 'approved'`. 0129's own header
-- spells out the consequence in capitals: *"A SEEDED TEMPLATE THAT SKIPS VERSIONING RESOLVES TO NOTHING AND THE SEND IS
-- RECORDED AS `no_template` — SILENTLY."* The migrations that added templates (0123, 0129, 0149) each fed the gate.
-- The BASE SEED FILE never has. Counted on a freshly built database: **123 platform templates, 81 with a serving
-- version, 42 without** — among them `order.confirmed`, `payment.success`, `auth.otp`, `wage.paid`, `review.prompt`,
-- `shipment.delivered`, every `dispute.*`, and all ten of TENANT-6b-1's `dairy.quality_flag_*` rows. So W168's *"member
-- notified in Gujarati"*, which 6b-1 built the whole plumbing for, has never sent a single message.
--
-- The fix belongs in the seed file, not here: that file inserts the template rows, so it owns their versions, and
-- `pnpm seed` is documented as idempotent and re-runnable (db/README.md), which makes it the mechanism that repairs a
-- deployed environment as well as a fresh one. Putting the backfill in a migration too would be two mechanisms for one
-- fact, and the copy in the migration would be the one that goes stale the next time a template is added.

COMMIT;
