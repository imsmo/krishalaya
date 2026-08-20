-- 0159_dairy_cycle_second_signature.sql · PC-56 TENANT-6c-3 · W169 (Dairy payout cycles)
--
-- W169 states the control twice, and the second time it says why:
--   *"Preview/approve needs dairy-desk + `settlement.close` + checker — this is 312 families' milk money."*
--
-- THREE THINGS WERE WRONG, AND THE FIRST IS THE WORST.
--
--   1. **THE FARMER ROLE HOLDS `dairy.manage`.** `db/seeds/core/0004_roles_permissions.sql` grants it to
--      `('dairy_farmer','tenant_admin')`. That permission's own description is *"Manage dairy MCC + collections + milk
--      bills"*, and `dairy.policies.ts` documents it as *"the cooperative/MCC operator: create MCCs + rate cards, enrol
--      members, record collections, generate/approve/PAY milk bills. Members READ their own data (no perm)."* The
--      comment and the grant contradict each other and THE GRANT WINS: any user carrying the `dairy_farmer` role can
--      create the rate card that sets what every member is paid, record collections, generate bills, approve them, and
--      PAY them out of the cooperative's wallet.
--
--      Every sibling vertical in that same file has TWO verbs — `loan.borrow` for the farmer and `loan.manage` for the
--      banker; `insurance.enrol` and `insurance.manage`; `contract.grow` and `contract.manage`. Dairy has only the
--      manage verb, so whoever wrote the matrix gave farmers that one because there was nothing else to give them.
--      TENANT-6b-1 and 6b-2 both recorded "a read-only `dairy.read` scope" as named-not-closed; this is that gap, and it
--      is not a missing read scope — it is a WRITE grant on a money path.
--
--      It is removed here, and NOTHING A MEMBER DOES BREAKS: every member-facing dairy route (their own bill list, one
--      bill, its dispute history, and raising a dispute) carries no `@RequirePermissions` at all — it authorises by
--      OWNERSHIP, which is what TENANT-6c-2 built the dispute route around. A cooperative that genuinely runs a
--      member-operated centre can still grant the permission to that ONE user through the per-user override the request
--      context already merges; what it can no longer be is the default for everyone holding a farmer role.
--
--   2. **`settlement.close` WAS NOT CHECKED ON EITHER ACT.** 0144 seeded the permission (W147 named it twice and no file
--      granted it — the promise-with-no-grant class). TENANT-6c-2 then shipped the cycle preview behind `dairy.manage`
--      alone. Both acts now require `dairy.manage` AND `settlement.close`, which today means the desk previews and a
--      tenant admin approves, because `tenant_admin` is the only role 0144 granted it to. That is the correct shape:
--      the second signature is meant to come from somebody other than the desk.
--
--   3. **THERE WAS NO CHECKER.** Nothing anywhere stopped one person previewing a cycle and approving it. The rule is
--      unconditional — no threshold — following 0144's own ruling for the settlement cycle close: *"W147 states no
--      threshold here, and a cycle close is not an amount — it is a decision that turns a fortnight of trade into
--      documents a member will hold and a bank manager will read. Every one of them gets two humans."* A milk cycle is
--      312 families' fortnight; the same reasoning applies with more force.
--
-- WHAT THIS MIGRATION DOES NOT DO, AND SAYS SO:
--   * The DEDUCTION still has no destination, so `MilkBillService.pay` still refuses a bill that carries one
--     (`DEDUCTION_HAS_NO_DESTINATION`, 0157). W169's *"deductions above 25% of gross need the member's fresh consent"*
--     is therefore still a gate in front of a wall, and both are TENANT-6c-4 — which is also why `paid` is still absent
--     from the cycle status vocabulary below, along with the payout batch behind *"one bank trip"*.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- 159.1  THE GRANT A FARMER SHOULD NEVER HAVE HAD
-- ---------------------------------------------------------------------------------------------------------------
-- The seed is corrected in the same commit so a fresh install never has it; this DELETE is what repairs an install
-- that already ran. Both are needed and they are not two mechanisms for one fact: the seed states the desired grant
-- matrix, and a migration is the only thing that can change state a previous seed already wrote.
DELETE FROM role_permissions
 WHERE permission_code = 'dairy.manage'
   AND role_id IN (SELECT id FROM roles WHERE code = 'dairy_farmer');

-- ---------------------------------------------------------------------------------------------------------------
-- 159.2  THE SECOND SIGNATURE, ON THE CYCLE
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE dairy_bill_cycles
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  -- Symmetric with `bills_previewed` (0158): the per-bill pass is bounded and resumable, and this is what makes
  -- "is it done?" answerable after a partial run.
  ADD COLUMN IF NOT EXISTS bills_approved integer;

ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_status;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_status
  CHECK (status IN ('open','closed','previewed','approved'));

ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_approve_stamp;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_approve_stamp
  CHECK ((approved_at IS NULL) = (approved_by IS NULL));

-- `approved` requires its own stamp AND the preview that preceded it: approving a cycle no member has seen would be
-- approving money nobody was told about, which is the exact promise W169's subtitle makes.
ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_approved_after_preview;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_approved_after_preview
  CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND previewed_at IS NOT NULL));

-- **THE CHECKER RULE, IN THE DATABASE.** The domain refuses it too, and both are deliberate: the domain gives the
-- operator a readable error, and this makes the rule true of the ROW no matter what wrote it — a hand-run UPDATE
-- during an incident, a future job, a bug. 0143 put the same constraint on `payout_batches`
-- (`ck_payout_batch_maker_ne_checker`) for the same reason.
ALTER TABLE dairy_bill_cycles DROP CONSTRAINT IF EXISTS ck_dairy_bill_cycle_maker_ne_checker;
ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_maker_ne_checker
  CHECK (approved_by IS NULL OR previewed_by IS NULL OR approved_by <> previewed_by);

COMMENT ON COLUMN dairy_bill_cycles.approved_by IS
  'PC-56 TENANT-6c-3. The SECOND human. W169: "Preview/approve needs dairy-desk + settlement.close + checker - this is '
  '312 families milk money." Constrained to differ from previewed_by, unconditionally and with no threshold - 0144''s '
  'ruling for a settlement cycle close, which a milk cycle deserves at least as much. Before this wave nothing stopped '
  'one person previewing a cycle and approving it, and neither act checked settlement.close at all.';

GRANT UPDATE (approved_at, approved_by, bills_approved) ON dairy_bill_cycles TO kv_app;

-- The approver's claim: previewed cycles waiting for a second signature.
CREATE INDEX IF NOT EXISTS idx_dairy_cycle_awaiting_approval
  ON dairy_bill_cycles (tenant_id, previewed_at)
  WHERE status = 'previewed' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 159.3  THE FLAG (Law 10)
-- ---------------------------------------------------------------------------------------------------------------
-- A SECOND flag rather than reusing `dairy_cycle_preview`, because the two acts have different blast radii and a
-- kill-switch on one must not silence the other: switching off APPROVAL should stop money advancing while members are
-- still told what they are owed, and switching off PREVIEW must not leave an already-previewed cycle unapprovable.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_cycle_approve',
   'PC-56 TENANT-6c-3: approve a previewed dairy cycle - the second signature. Requires dairy.manage AND '
   'settlement.close, and the approver must not be the person who previewed it. OFF means the route is unreachable and '
   'bills stay previewed, which is where TENANT-6c-2 left them. Separate from dairy_cycle_preview on purpose: killing '
   'approval must not stop members being told what they are owed.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

COMMIT;
