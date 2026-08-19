-- 0156_milk_quality_hold_and_bonus.sql · PC-56 TENANT-6b-1 · W168 (Milk quality desk)
--
-- W168 makes three promises about a flagged pour, and this platform kept NONE of them:
--
--   1. *"Rate card holds this pour's payment only; the member's other pours pay normally."*
--      **THE FLAGGED POUR WAS PAID.** `MilkCollectionRepository.aggregateUnbilledForUpdate` — the only reader that
--      feeds bill generation — sums every unbilled collection in the period with NO reference to `water_flag` or
--      `adulteration_flags`. So a pour the operator marked as watered went into the next bill at full price, and the
--      bill could be approved and PAID out of the cooperative's wallet before anybody re-tested the sealed sample.
--      This migration gives the pour a HOLD STATE and the aggregation excludes the held and the rejected.
--
--   2. *"Flag decisions are recorded."* Nothing recorded them. There was no re-test, no outcome, no decider, no time —
--      the flag was a boolean on a row and the story stopped there. `milk_quality_reviews` is that record: who opened
--      it, whether the sample was sealed, whether the member was present at the re-test, what was decided and by whom.
--
--   3. *"Repeat pattern (3+ in 90d) → dairy committee review."* Nothing counted. The count is now derivable from the
--      review history and stamped on the review when it opens; the COMMITTEE itself is governance and is not built —
--      the desk says so rather than implying a review happened.
--
-- AND *"every drop rated by the active rate card"* was short by the premium W168 advertises:
--   **`milk_rate_cards.bonus_rules` HAS BEEN READ BY NOTHING SINCE 0007.** The column is not in the rate-card
--   repository's own column list; the pricing engine's header calls the slabs "DEFERRED". W168 prints
--   *"Bonus slab: fat ≥ 6.5 → +₹0.50/L"* and *"premium band pourers 184 / 312"*, describing money no pour has ever
--   been paid. The engine now reads the slabs. Applying them CHANGES WHAT A COOPERATIVE PAYS, so it is behind a flag
--   that ships OFF: a treasury that has been quoting members a rate without the bonus for a year decides when to start
--   honouring it. What is no longer possible is the silent version, where the card promises a premium and nothing
--   anywhere applies it.
--
-- NOT RETROACTIVE, DELIBERATELY. Existing flagged pours keep `hold_state='none'`: back-filling them to 'held' would
-- withhold money for pours nobody will ever re-test, months after the fact. They were paid; the desk states that
-- history rather than rewriting it.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. THE POUR'S HOLD STATE
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_collections
  ADD COLUMN IF NOT EXISTS hold_state varchar(16) NOT NULL DEFAULT 'none';

DO $$ BEGIN
  ALTER TABLE milk_collections ADD CONSTRAINT ck_milkcoll_hold_state
    CHECK (hold_state IN ('none', 'held', 'released', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN milk_collections.hold_state IS
  'PC-56 TENANT-6b-1. W168: "Rate card holds this pour''s payment only; the member''s other pours pay normally." '
  'none = never flagged; held = flagged at the counter, payment withheld pending the re-test; released = the re-test '
  'cleared it and it is payable again; rejected = confirmed adulteration, never payable. Bill generation counts only '
  'none and released. Before this column the flagged pour was billed and PAID at full price. The pour keeps its priced '
  'amount_minor in every state — zeroing it would destroy the evidence of what the milk was worth.';

COMMENT ON COLUMN milk_collections.density IS
  'PC-56 TENANT-6b-1. W168 shows the water flag''s own evidence as "density 1.024 (low)". This column existed from '
  '0009 and was DEAD — no writer, no reader, and the record-collection DTO did not accept it, so the number the '
  'operator read off the analyzer had nowhere to go. Now written with the pour and shown beside the flag. There is '
  'deliberately NO automatic density threshold: "below 1.026 means watered" is a business rule a tenant''s dairy '
  'committee owns (Law 6), not a constant in application code.';

-- ---------------------------------------------------------------------------------------------------------------
-- 1b. WHAT THE PREMIUM PAID THIS POUR, kept with the pour
-- ---------------------------------------------------------------------------------------------------------------
-- `amount_minor` includes the bonus once the slabs are applied, and that is not enough. W168 promises the counter
-- "shows this arithmetic to the farmer, line by line", a rate card can be superseded, and the flag can be switched —
-- so how much of a pour's price was PREMIUM must be a stored fact about the pour rather than something a later reader
-- tries to recompute from a card that has since changed.
ALTER TABLE milk_collections
  ADD COLUMN IF NOT EXISTS bonus_minor   bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_applied boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE milk_collections ADD CONSTRAINT ck_milkcoll_bonus
    CHECK (bonus_minor >= 0 AND bonus_minor <= amount_minor AND (bonus_minor = 0 OR bonus_applied));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN milk_collections.bonus_minor IS
  'PC-56 TENANT-6b-1. The part of amount_minor that came from the rate card''s premium slabs (W168: "fat >= 6.5 -> '
  '+Rs 0.50/L"). Zero for every pour recorded before this wave, because the engine ignored bonus_rules entirely.';
COMMENT ON COLUMN milk_collections.bonus_applied IS
  'PC-56 TENANT-6b-1. Whether the slabs were APPLIED when this pour was priced — which is not the same as whether any '
  'premium was earned. A pour priced under the bonus regime that cleared no slab is (true, 0); a pour priced while the '
  'dairy_bonus_slabs flag was off is (false, 0). Without this column those two are indistinguishable, and a member '
  'asking "was my milk ever eligible?" could not be answered.';

-- ---------------------------------------------------------------------------------------------------------------
-- 1c. THE GRANT, AS NARROW AS 0080 MADE IT
-- ---------------------------------------------------------------------------------------------------------------
-- `milk_collections` is a money-bearing partitioned table and 0078/0080 deliberately reduced `kv_app` to
-- `UPDATE (milk_bill_id)` — exactly the one column `attachToBill` writes, nothing else. A blanket
-- `GRANT UPDATE ON milk_collections` here would quietly undo that whole sweep and hand the application role the power
-- to rewrite a pour''s weight, its quality or its price. So the hold gets its own column grant and nothing more.
-- (Found by the live probe: the decision path failed with "permission denied for table milk_collections", which is the
-- least-privilege design working exactly as intended.)
GRANT UPDATE (hold_state) ON milk_collections TO kv_app;

-- The desk''s own list: this cycle''s flagged pours, per tenant, newest first. Partial, because a flagged pour is rare.
CREATE INDEX IF NOT EXISTS idx_milkcoll_hold
  ON milk_collections (tenant_id, collected_on DESC)
  WHERE hold_state <> 'none';

-- ---------------------------------------------------------------------------------------------------------------
-- 2. THE FLAG DECISION RECORD
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milk_quality_reviews (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  collection_id             uuid NOT NULL,
  -- Carried so every read of a review can reach the pour WITHOUT scanning every partition of milk_collections, and
  -- so the composite foreign key below can point at the partitioned table's real primary key.
  collected_on              date NOT NULL,
  membership_id             uuid NOT NULL REFERENCES dairy_memberships(id),
  mcc_id                    uuid NOT NULL REFERENCES mcc_centres(id),
  shift                     milk_shift NOT NULL,

  -- A SNAPSHOT of why it was flagged. The pour's own arrays can be corrected later; what the operator saw at the
  -- counter is what a committee reviews, so it is copied rather than joined.
  water_flag                boolean NOT NULL DEFAULT false,
  reasons                   jsonb   NOT NULL DEFAULT '[]',
  density_at_flag           numeric(6,3),
  fat_pct_at_flag           numeric(4,2),
  snf_pct_at_flag           numeric(4,2),
  amount_withheld_minor     bigint  NOT NULL,
  currency_code             char(3) NOT NULL,

  -- *"Sample retained & sealed"* is a claim about a PHYSICAL act this platform cannot witness, so it is recorded as
  -- somebody's assertion with their name on it, never as a fact the system establishes.
  sample_sealed             boolean NOT NULL DEFAULT false,

  status                    varchar(16) NOT NULL DEFAULT 'open',
  opened_at                 timestamptz NOT NULL DEFAULT now(),
  opened_by                 uuid REFERENCES users(id),

  -- W168 step 1: *"Operator re-tests sealed sample WITH MEMBER PRESENT (today evening shift)"*. Whether the member
  -- was actually there is the difference between a re-test and a thing done to somebody, so it is its own column.
  retest_at                 timestamptz,
  retest_by                 uuid REFERENCES users(id),
  member_present            boolean,

  outcome_note              text,
  decided_at                timestamptz,
  decided_by                uuid REFERENCES users(id),

  -- W168 step 3: *"Repeat pattern (3+ in 90d) → dairy committee review"*. Stamped when the review opens, from this
  -- table's own history. The committee is a governance body this platform does not model — the flag says a review is
  -- OWED, and the desk refuses to imply one happened.
  prior_reviews_90d         integer NOT NULL DEFAULT 0,
  committee_review_required boolean NOT NULL DEFAULT false,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  created_by                uuid,
  updated_by                uuid,

  CONSTRAINT fk_quality_review_collection
    FOREIGN KEY (collection_id, collected_on) REFERENCES milk_collections (id, collected_on),
  -- One review per pour: a pour is flagged once, and a second row would let two decisions disagree about one payment.
  CONSTRAINT uq_quality_review_collection UNIQUE (collection_id),
  CONSTRAINT ck_quality_review_status CHECK (status IN ('open', 'retested', 'cleared', 'rejected')),
  -- A decision must carry its decider and its time, or it is an outcome nobody is accountable for.
  CONSTRAINT ck_quality_review_decided
    CHECK ((status IN ('cleared', 'rejected')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  -- A re-test must carry its own stamp, and a decision cannot precede the test it was based on.
  CONSTRAINT ck_quality_review_retest
    CHECK ((retest_at IS NULL) = (retest_by IS NULL)),
  CONSTRAINT ck_quality_review_reasons CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT ck_quality_review_withheld CHECK (amount_withheld_minor >= 0)
);

COMMENT ON TABLE milk_quality_reviews IS
  'PC-56 TENANT-6b-1. W168: "Flag decisions are recorded · pour-level hold, never wallet freeze · member notified in '
  'Gujarati." Before this table NOTHING after the flag was recorded anywhere: no retained sample, no re-test, no '
  'outcome, no decider, no notification — and the flagged pour was paid in the next bill regardless. One row per '
  'flagged pour, opened in the SAME transaction as the pour so a hold can never exist without its reason.';

CREATE INDEX IF NOT EXISTS idx_quality_review_open
  ON milk_quality_reviews (tenant_id, opened_at DESC)
  WHERE status IN ('open', 'retested') AND deleted_at IS NULL;

-- The 3-in-90-days question, and the member's own history on the desk.
CREATE INDEX IF NOT EXISTS idx_quality_review_member
  ON milk_quality_reviews (tenant_id, membership_id, opened_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quality_review_collection_lookup
  ON milk_quality_reviews (tenant_id, collection_id);

ALTER TABLE milk_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE milk_quality_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_milk_quality_reviews ON milk_quality_reviews;
CREATE POLICY tenant_isolation_milk_quality_reviews ON milk_quality_reviews
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP TRIGGER IF EXISTS milk_quality_reviews_uat ON milk_quality_reviews;
CREATE TRIGGER milk_quality_reviews_uat BEFORE UPDATE ON milk_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON milk_quality_reviews TO kv_app;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. THE PREMIUM BAND THE ENGINE NOW READS
-- ---------------------------------------------------------------------------------------------------------------
-- The column has held tenant data since 0007 and was never read. Shape is validated in the DTO and the domain (a slab
-- is {metric, minCentiPct, bonusMinorPerLitre}); the only thing the database insists on is that it is an ARRAY, so a
-- card cannot carry an object the engine would iterate to nothing.
DO $$ BEGIN
  ALTER TABLE milk_rate_cards ADD CONSTRAINT ck_rate_card_bonus_rules_array
    CHECK (bonus_rules IS NULL OR jsonb_typeof(bonus_rules) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN milk_rate_cards.bonus_rules IS
  'PC-56 TENANT-6b-1. Premium slabs, e.g. W168''s "fat >= 6.5 -> +Rs 0.50/L", as a jsonb ARRAY of '
  '{metric: fat|snf, minCentiPct: int, bonusMinorPerLitre: int}. READ BY NOTHING FROM 0007 UNTIL THIS WAVE: the '
  'pricing engine''s header called the slabs DEFERRED, the rate-card repository did not even SELECT the column, and '
  'W168 advertised a premium band to 184 of 312 pourers that no pour was ever paid. MilkRateCard.priceMinor now '
  'applies them in exact integer arithmetic, gated by the flag dairy_bonus_slabs so that starting to honour a slab '
  'is a cooperative''s own decision rather than a silent change to what it pays.';

-- ---------------------------------------------------------------------------------------------------------------
-- 4. FLAGS
-- ---------------------------------------------------------------------------------------------------------------
-- The HOLD is deliberately NOT flagged. A write that stops a watered pour being paid needs no permission slip, and
-- gating it would mean flagged pours keep getting paid until somebody enables a screen — the same ruling TENANT-5d
-- made for recording a failure reason.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_bonus_slabs',
   'PC-56 TENANT-6b-1: apply milk_rate_cards.bonus_rules when pricing a pour — the premium band W168 advertises '
   '("fat >= 6.5 -> +Rs 0.50/L") which the pricing engine has ignored since 0007. OFF means pours price exactly as '
   'they always have (base + fat/SNF axes) and the quality desk states that the tenant''s configured slabs are not '
   'being applied. ON means every pour priced from that moment forward includes the slab it qualifies for; already '
   'priced pours are never re-priced. Money-affecting, so it is a deliberate treasury decision.',
   false, 100, 'experiment'),
  ('dairy_quality_desk',
   'PC-56 TENANT-6b-2: W168''s milk quality desk — the cycle''s fat/SNF averages, the flagged pours with their hold '
   'state and re-test protocol, the active rate card with its worked example, and the premium band count. OFF means '
   'the desk is not reachable; the HOLD on a flagged pour and its review record are NOT gated by this flag and apply '
   'regardless, because a farmer''s money must not depend on whether a screen is switched on.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

COMMIT;
