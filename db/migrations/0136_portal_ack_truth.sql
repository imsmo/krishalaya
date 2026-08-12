-- ============================================================================
-- MIGRATION 0136 — THE PORTAL SYNC REGISTRY'S ONE MISSING FACT (PC-56 ADMIN-SWEEP-c1, W077 + W2214–W2216)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE WAVE'S PREMISE WAS STALE AGAIN, AND THE REALITY IS BARER THAN THE INSTRUCTION
-- ---------------------------------------------------------------------------
-- 01_ADMIN's ADMIN-SWEEP-c instruction says the sync jobs "exist in the worker and there is no registry". Neither
-- half survives contact with the repository: **no portal job exists in apps/worker at all** (grep: zero), no
-- client for any government portal exists anywhere (PFMS is an explicit Noop — "no automatic pull has run"; there
-- has never been an iKhedut client), and the mapping registry DOES exist (external_entity_refs rows via
-- schemes-registry-ops, whose own comment says a synced state "would be the registry lying about work that never
-- happened"). So W077's registry is built over what is TRUE: per-portal mapping state, real pending-push counts,
-- and — the one fact this migration adds — the acknowledgement timestamp without which "ack lag p50" can never be
-- measured. W077's "Run all pulls" is NOT built and NOT queued: with no worker to consume it, a run-request row
-- would be a status recording an act nobody performs (the ADMIN-10-Q1 shape, refused here for the second time).
-- And no `schemes.sync` permission is added: nothing writes sync state yet, and a permission with no route behind
-- it is a promise nothing keeps (0120's rule) — the day a pull worker lands, its trigger route brings the grant.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 136.1  WHEN DID THE PORTAL ANSWER — the ack-lag clock's missing half
-- ---------------------------------------------------------------------------
-- `scheme_applications.govt_app_ref` is the portal's acknowledgement number, typed in by an officer, with no
-- record of WHEN. Ack lag (submitted → acknowledged) is therefore uncomputable for all history. This column starts
-- the clock going forward: apps/api's application update sets it the moment a ref first lands. **History stays
-- NULL, deliberately** — backfilling from updated_at would invent acknowledgement times out of arbitrary later
-- edits, and a p50 over invented times is worse than "unmeasured".
ALTER TABLE scheme_applications ADD COLUMN govt_acked_at timestamptz;
COMMENT ON COLUMN scheme_applications.govt_acked_at IS
  'W077 (ADMIN-SWEEP-c1): when govt_app_ref FIRST landed — set by the application update path, never backfilled. Ack lag p50 = govt_acked_at − submitted_at over rows where both exist; the console says "unmeasured — recording starts now" until they do.';

-- A ref that exists must have its timestamp from now on; history (ref without timestamp) is permitted and reads as
-- "acknowledged at an unrecorded time". No CHECK, deliberately: a CHECK would make historic rows unwritable.

-- ---------------------------------------------------------------------------
-- 136.2  THE PENDING-PUSH COUNT MUST BE AN INDEX LOOKUP
-- ---------------------------------------------------------------------------
-- "Pending pushes" per portal = submitted applications with no portal acknowledgement, grouped through
-- schemes.authority_id. The registry page reads this on every load; without a partial index it is a scan over the
-- whole application history of every tenant.
CREATE INDEX idx_schemeapps_awaiting_ack ON scheme_applications (scheme_id)
  WHERE submitted_at IS NOT NULL AND govt_app_ref IS NULL AND deleted_at IS NULL;
-- and the lag read, over exactly the rows that can answer it
CREATE INDEX idx_schemeapps_acked ON scheme_applications (scheme_id, govt_acked_at)
  WHERE govt_acked_at IS NOT NULL AND deleted_at IS NULL;
