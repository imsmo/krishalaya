-- ============================================================================
-- MIGRATION 0107 — AN ERASURE THAT CANNOT CLAIM WHAT IT DID NOT DO (PC-56 ADMIN-5)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT. THE PLATFORM CAN RECORD "ERASURE COMPLETED" WHILE EVERY ROW STILL EXISTS.
-- ---------------------------------------------------------------------------
-- Trace the path a farmer's erasure request actually takes today:
--   1. They file it from the app (`POST /v1/privacy/deletion-requests`) — real, idempotent, one open request per kind.
--   2. `data_subject_requests` gets a row with a 90-day `cooling_ends_at`. Real.
--   3. `apps/worker/src/jobs/dpdp-erasure-cooling.job.ts` runs hourly, and after the cooling window advances the row
--      `open → in_progress` and emits an outbox event `identity.erasure_ready`. Real.
--   4. **NOTHING CONSUMES `identity.erasure_ready`.** grep across every app: the event is emitted and no handler
--      exists. No row is deleted. No row is anonymised. Nothing happens.
--   5. An operator then calls `PATCH /v1/compliance/dsr/:id` with `action: 'complete'` and a free-text `resolution`,
--      and the request becomes `completed`.
--
-- So the platform acknowledged a statutory right within SLA, ran a 90-day clock, told the farmer (per W042's timeline)
-- that "erasure executes automatically... certificate issued" — and the only thing that changed is a status column.
-- The paperwork says the data is gone. The data is there.
--
-- THIS IS WORSE THAN A MISSING FEATURE, because a missing feature is visible. `completed` is the most reassuring word
-- in the schema and nothing was standing behind it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES, AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------------------
-- IT DOES NOT BUILD THE ERASURE EXECUTOR. Deleting and anonymising a farmer's data across ~150 tables, honouring
-- retention law per class, in the right FK order, idempotently, is a wave of its own with a rehearsal on real data —
-- and an executor written quickly is how somebody's ledger history disappears. Writing one here to make a screen look
-- finished would be the worst possible trade.
--
-- IT MAKES THE FALSE CLAIM UNREPRESENTABLE INSTEAD. `dsr_erasure_actions` records, per data class, WHAT WAS ACTUALLY
-- DONE — and the service refuses to mark an erasure `completed` unless every in-scope class has a row. Today that
-- means an erasure CANNOT be completed, which is correct: nothing has erased anything. The operator sees exactly why,
-- and the queue shows the request honestly stuck instead of dishonestly closed. When the executor is built, it writes
-- these rows and the guard passes on its own.
--
-- THREE MORE THINGS THE CANON NEEDS THAT THE SCHEMA COULD NOT SUPPLY:
--   • `acknowledged_at`. W041 states the SLA as "acknowledge 72h, resolve 30d" and shows "SLA breaches YTD 0". There
--     was no acknowledgement timestamp AT ALL, so the 72-hour clock could not be measured, let alone breached. A
--     compliance screen reporting zero breaches against a clock it cannot read is not a clean record; it is an
--     unmeasured one, which is what a regulator would find first.
--   • CODED REJECTION GROUNDS. W042 lists exactly three lawful grounds and says the data principal "receives the
--     grounds verbatim and can appeal to the Data Protection Board". Grounds were free text inside `resolution`, so
--     an unlawful ground was as easy to type as a lawful one and nothing could count them.
--   • DPO COUNTERSIGN. W042: "Beginning erasure needs compliance.dsr + DPO countersign (maker–checker)." Compliance
--     ops was single-operator: one admin with a hardware key could work a rights request end to end.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE SLA CLOCK THAT DID NOT EXIST
-- ---------------------------------------------------------------------------
ALTER TABLE data_subject_requests
  ADD COLUMN acknowledged_at timestamptz,
  -- Coded grounds. NULL for every non-rejected request; a CHECK below ties them together, so a rejection cannot be
  -- recorded without a ground and a ground cannot be attached to a live request.
  ADD COLUMN rejection_ground varchar(32),
  -- The DPO countersign. No FK to users(id): a platform operator is an admin-realm identity, and ADMIN-2d established
  -- they have no tenant `users` row to point at. `scheme_registry_changes.actor_user_id` (0042) made the same call.
  ADD COLUMN countersigned_by uuid,
  ADD COLUMN countersigned_at timestamptz,
  -- When the erasure scope was last computed from `data_retention_policies`. Stamped so the console can say how old
  -- the preview a farmer was shown is, rather than implying it is live.
  ADD COLUMN scope_computed_at timestamptz;

COMMENT ON COLUMN data_subject_requests.acknowledged_at IS
  'When the data principal was told we received the request (DPDP 72h SLA). NULL means NOT YET ACKNOWLEDGED — never treat NULL as "acknowledged at creation", which would make every SLA measurement pass.';

-- The three grounds W042 names, and nothing else. `legal_hold` is separated from `identity_unverified` because they
-- lead to completely different next steps for the farmer: one is fixable by them in minutes, the other is not fixable
-- at all until the hold lifts, and collapsing them into "rejected" tells them nothing they can act on.
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_rejection_ground CHECK (
  rejection_ground IS NULL OR rejection_ground IN ('identity_unverified', 'legal_hold', 'manifestly_unfounded')
);
-- Tied both ways: a rejection MUST name a ground, and a ground may not sit on a request that is not rejected.
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_rejection_needs_ground CHECK (
  (status = 'rejected') = (rejection_ground IS NOT NULL)
);
-- MAKER ≠ CHECKER AT THE DATABASE, the platform's THIRD such control (after 0093's billing adjustments and 0105's
-- scheme versions) and deliberately the same shape. `updated_by` carries the operator who last moved the request, so a
-- countersign by that same person is refused by the row itself rather than only by the service.
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_countersign_ne_actor CHECK (
  countersigned_by IS NULL OR updated_by IS NULL OR countersigned_by <> updated_by
);
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_countersign_pair CHECK (
  (countersigned_by IS NULL) = (countersigned_at IS NULL)
);

-- The queue's SLA reads: open requests by age, and the acknowledge clock. Partial because the queue only ever asks
-- about live requests; completed history is read by id or by a different, bounded query.
CREATE INDEX idx_dsr_open_sla ON data_subject_requests (created_at)
  WHERE status IN ('open', 'in_progress') AND deleted_at IS NULL;
CREATE INDEX idx_dsr_unacknowledged ON data_subject_requests (created_at)
  WHERE acknowledged_at IS NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. THE EVIDENCE TABLE — what an erasure ACTUALLY did, per data class
-- ---------------------------------------------------------------------------
-- APPEND-ONLY. An erasure certificate is a statement to a person about their own data, and a statement that can be
-- edited afterwards is not evidence. `kv_app` gets INSERT and SELECT only; UPDATE and DELETE are revoked from every
-- role that is not kv_admin, and there is deliberately no soft-delete column — a retracted claim is a NEW row with
-- action 'retracted', not a vanished one.
CREATE TABLE dsr_erasure_actions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  request_id        uuid NOT NULL REFERENCES data_subject_requests(id),
  -- The data class, named as the table it covers, matching `data_retention_policies.table_name` so the evidence and
  -- the scope preview are talking about the same thing. Free varchar for the same reason that column is.
  data_class        varchar(100) NOT NULL,
  -- What was done. 'blocked_by_law' is the one that matters most: it is how the record says "we did NOT delete this,
  -- and here is the statute". Without it, a class with no row would be indistinguishable from a class nobody got to.
  action            varchar(20) NOT NULL CHECK (action IN ('deleted', 'anonymised', 'archived', 'blocked_by_law', 'retracted')),
  rows_affected     bigint NOT NULL DEFAULT 0 CHECK (rows_affected >= 0),
  -- The legal basis SNAPSHOT, copied from the policy at execution time rather than joined at read time. A policy that
  -- is edited two years later must not silently rewrite the reason a farmer was given.
  legal_basis       varchar(200),
  -- Who or what did it. 'worker' for the (future) executor, an operator id for a hand-run class. Free text because
  -- the honest answer today is neither.
  executed_by       varchar(60) NOT NULL,
  executed_at       timestamptz NOT NULL DEFAULT now(),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One live claim per (request, class): a second row for the same class supersedes nothing silently, it collides. A
-- correction is a 'retracted' row followed by a new one, which is why 'retracted' is excluded from the uniqueness.
CREATE UNIQUE INDEX uq_dsr_erasure_action_class ON dsr_erasure_actions (request_id, data_class)
  WHERE action <> 'retracted';
CREATE INDEX idx_dsr_erasure_actions_request ON dsr_erasure_actions (request_id, executed_at DESC);

COMMENT ON TABLE dsr_erasure_actions IS
  'Append-only per-data-class record of what an erasure actually did. The completion guard refuses to mark an erasure completed unless every in-scope class has a row here — so the platform cannot record a completed erasure that did not happen. action=blocked_by_law is how the record states that a class was lawfully KEPT.';

REVOKE ALL ON dsr_erasure_actions FROM kv_app, kv_relay;
-- SELECT so apps/api can show a farmer their own certificate; INSERT so the future executor (which runs as kv_app in
-- the worker) can record what it did. No UPDATE, no DELETE, for anybody but kv_admin.
GRANT SELECT, INSERT ON dsr_erasure_actions TO kv_app;
GRANT SELECT, INSERT, UPDATE ON dsr_erasure_actions TO kv_admin;
GRANT SELECT ON dsr_erasure_actions TO kv_readonly;

-- No tenant_id and no RLS: a data-subject request belongs to a PERSON, not a tenant, and the same farmer may hold
-- accounts across several tenants. `data_subject_requests` made this choice in 0003 and this table follows it.

-- ---------------------------------------------------------------------------
-- 3. RETENTION POLICIES HAD NO SEED, WHICH WOULD HAVE MADE THE PREVIEW LIE
-- ---------------------------------------------------------------------------
-- `data_retention_policies` (0015) has existed with `action` and `legal_basis` columns and **not one row has ever been
-- inserted** — no seed, anywhere. W042's scope preview is computed from this table, so on an empty table the honest
-- rendering is "no retention policy is configured", and the DANGEROUS rendering is an empty list, which reads as
-- "nothing of yours will be kept". The console distinguishes those two, and these rows mean the common case is a real
-- answer rather than a caveat.
--
-- Every row below is a legal claim and is written as one. The three that say `keep_forever` are the ones a farmer is
-- most surprised by, so their `legal_basis` names the statute rather than a category:
INSERT INTO data_retention_policies (table_name, active_months, archive_months, legal_basis, action, is_active) VALUES
  -- deleted outright: no statute requires us to keep these once the person is gone
  ('users',                    0,  NULL, NULL,                                                              'delete',       true),
  ('user_devices',             0,  NULL, NULL,                                                              'delete',       true),
  ('kyc_documents',            0,  NULL, 'DPDP s.8(7) — erase once the purpose is served',                   'delete',       true),
  ('notification_deliveries',  6,  NULL, NULL,                                                              'delete',       true),
  -- anonymised: the platform's aggregate truth survives, the person does not
  ('listings',                 0,  NULL, 'marketplace statistics survive without the principal',             'anonymise',    true),
  ('reviews',                  0,  NULL, 'other traders relied on these; authorship is removed',             'anonymise',    true),
  ('media_assets',             0,  NULL, 'derived crop imagery retained without principal linkage',          'anonymise',    true),
  -- archived: kept because tax and commercial law require it, then removed
  ('orders',                  24,    72, 'CGST Act s.36 — books of account 72 months',                       'archive',      true),
  ('invoices',                24,    72, 'CGST Act s.36 — 72 months from the annual return due date',        'archive',      true),
  -- kept for good: deleting these is itself unlawful, and the farmer is told exactly this
  ('ledger_entries',         120,  NULL, 'RBI PSS master direction — payment records 10 years',               'keep_forever', true),
  ('ledger_transactions',    120,  NULL, 'RBI PSS master direction — payment records 10 years',               'keep_forever', true),
  ('consents',               120,  NULL, 'DPDP — consent records are the proof of lawful processing',         'keep_forever', true),
  ('audit_log',               84,  NULL, 'DPDP + SOC2 — 7-year immutable trail; erasing it erases the proof', 'keep_forever', true)
ON CONFLICT (table_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. WHAT IS STILL MISSING, RECORDED HERE BECAUSE THE NEXT PERSON WILL LOOK
-- ---------------------------------------------------------------------------
--   • THE ERASURE EXECUTOR. `identity.erasure_ready` still has no consumer. The completion guard now makes that
--     visible rather than survivable, which is the honest interim state.
--   • `anonymise` AND `archive` PIPELINES. `apps/worker/src/jobs/retention-enforcer.job.ts` implements `action='delete'`
--     only and says so in its own comment. Four of the rows above are `anonymise` and two are `archive`; nothing runs
--     them, and the console must not imply otherwise.
--   • `consent_purposes` HAS NO NOTICE TEXT. W047 shows a notice in 12 languages per purpose and the table holds only
--     `code`, `default_name`, `is_mandatory`, `current_version`. That is ADMIN-5b, named rather than half-built here.
--   • NO CERTIFICATE DOCUMENT. W042's timeline says "certificate issued". `dsr_erasure_actions` is the DATA a
--     certificate would be rendered from; rendering and delivering one (in the farmer's language, over a channel that
--     works) needs the notification providers the platform does not have.
