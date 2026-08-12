-- 0138_listing_qc.sql · W126/W127 listing QC — the dead path made real (PC-56 TENANT-2a).
--
-- THE FINDING THIS MIGRATION ANSWERS: quality control over listings has been a VOCABULARY with no verbs since
-- 0005. `pending_approval` sits in listing_status, `Listing.submitForApproval()` and `.reject()` exist with zero
-- callers, `reject_reason` (0005) has never been written by any code, and `listing.approve` was seeded and
-- granted to tenant_admin in 0004 while nothing anywhere checks it — a granted permission with no route behind
-- it is the same promise nothing keeps that 0120 named, seen from a third side. W126's queue ("oldest 2.1h",
-- "median QC time 38 min") and W127's review could not have shown a single true number.
--
-- WHAT THE QC CLOCK NEEDS: when a listing ENTERED review, who decided, when. Three columns, never backfilled —
-- history that was never recorded is not invented (the 0136 ack-clock rule): every pre-0138 listing shows no
-- submission time, and the median is measured only over decisions this clock has stamped.
ALTER TABLE listings
  ADD COLUMN qc_submitted_at timestamptz,
  ADD COLUMN qc_reviewed_by  uuid REFERENCES users(id),
  ADD COLUMN qc_reviewed_at  timestamptz;

-- REVIEWER ≠ CREATOR, AS A CONSTRAINT (the appeals rule, 0132's precedent): the application asserts it with its
-- own error codes; this CHECK is the backstop that survives every future writer. Both identities matter — the
-- SELLER whose produce it is may not clear their own lot, and the STAFF creator (created_by, when recorded) may
-- not review a draft they typed (W127's own words: "a different staff member must review it").
ALTER TABLE listings ADD CONSTRAINT chk_listings_qc_reviewer_neq CHECK (
  qc_reviewed_by IS NULL
  OR (qc_reviewed_by <> seller_user_id AND (created_by IS NULL OR qc_reviewed_by <> created_by))
);

-- A decision has a moment; a moment has a decider. Half-written decisions cannot exist.
ALTER TABLE listings ADD CONSTRAINT chk_listings_qc_decided_shape CHECK (
  (qc_reviewed_by IS NULL) = (qc_reviewed_at IS NULL)
);

-- The queue read: waiting listings oldest-first, per tenant. Partial — the queue is small by design.
CREATE INDEX idx_listings_qc_queue ON listings (tenant_id, qc_submitted_at)
  WHERE status = 'pending_approval' AND deleted_at IS NULL;

-- The decided read (approved/rejected today, median over 7d): decisions by time, per tenant.
CREATE INDEX idx_listings_qc_decided ON listings (tenant_id, qc_reviewed_at)
  WHERE qc_reviewed_at IS NOT NULL;

-- REJECTION REASONS ARE DATA, NOT CODE (Law 6): W127's reject teaches, and what it teaches with is a closed,
-- translatable vocabulary a platform admin can extend without a deploy. Platform-level rows (tenant_id NULL),
-- WHERE NOT EXISTS because ON CONFLICT cannot see a NULL tenant_id (the 0134 lesson, kept).
INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
SELECT 'listing_reject_reason', 'Listing rejection reason', true   -- a co-op may add its own teaching reasons
WHERE NOT EXISTS (SELECT 1 FROM lookup_types WHERE code = 'listing_reject_reason');

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, sort_order)
SELECT v.code2 AS type_code, NULL, v.code, v.name, v.ord FROM (VALUES
  ('listing_reject_reason', 'photos_unclear',    'Photos unclear — a how-to retake guide is attached', 1),
  ('listing_reject_reason', 'quantity_mismatch', 'Quantity does not match the photos',                 2),
  ('listing_reject_reason', 'wrong_product',     'Wrong product selected',                             3),
  ('listing_reject_reason', 'restricted_item',   'Restricted item — a licence is needed first',        4)
) AS v(code2, code, name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM lookup_values lv
   WHERE lv.type_code = v.code2 AND lv.code = v.code AND lv.tenant_id IS NULL
);

-- NO CLAIM COLUMN, BY DECISION: "Take next" reads the oldest waiting row; two reviewers colliding costs a
-- duplicate LOOK, never a double write — the decide UPDATE is guarded by status = 'pending_approval', so the
-- second decision meets an illegal transition, not a lost one. A claim plane (0133's pattern) is warranted when
-- the queue grows contested; adding it then is one column, not a redesign.
