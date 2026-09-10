-- ==================================================================================================================
-- 0169 · PC-56 TENANT-6e-2 · THE EXPORT — W2553 (export queued) + W2554 (export ready), the tenant EXPORT PLANE
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
-- ==================================================================================================================
--
-- W2553: *"Exports are async at scale: this job is queued with a position and ETA; you will find the file on the
-- ready page — audit-stamped, checksummed, delivered by signed URL."*
-- W2554: *"Audit-stamped receipt: file name, row count, sha256, generated-at, requester — delivery via 15-min signed
-- URL, every fetch logged."*
--
-- TENANT-6e-1 named the evidence and this file is the answer to it. The tenant realm had NONE of that plane:
--   • `report_export_receipts` / `report_export_downloads` (0120) are `REVOKE ALL … FROM kv_app, kv_relay`, keyed on
--     `generated_by_admin_id` and written only by apps/admin-api — god mode's receipt, not a cooperative's (Law 11).
--   • `data_export_jobs` (0015) is the DPDP/offboarding queue: admin-approved, no position, no ETA, no row count, no
--     checksum and no fetch log.
--   • Every tenant export this programme has shipped — TENANT-3c-1's GSTR-1, TENANT-5d's logistics insights — is
--     SYNCHRONOUS, and each recorded the canon's queued/position/ETA state as PARITY-DECOR *with a reason*: a queue
--     table nothing enqueues into is "a status recording an act no code performs" (ADMIN-10-Q1, applied ten times).
--
-- THIS WAVE IS WHERE THAT REASON STOPS HOLDING. The plane is built FOR REAL and dairy is merely its first dataset:
-- a tenant-scoped job with a status machine a worker actually drives, a position computed live over the worker's own
-- queue, an ETA that is an estimate and says so (and is NULL when there is no history — unknown is not zero), a file
-- whose sha256 and row count are computed while it is written, a 15-minute HMAC-signed link whose jti lands in a log
-- row on EVERY fetch including the refused ones, and a retention after which the receipt says `expired` rather than
-- 404. A second dataset registers a producer and gets all of it.
--
-- WHY A NEW PAIR OF TABLES AND NOT 0015's. `data_export_jobs` is a LEGAL instrument — a data subject's right to their
-- own data, approved by an operator and produced in a fixed format. A cooperative exporting its 90-day insights is an
-- operational file for a board meeting. Widening the DPDP queue with "position" and "sha256" would make an auditor read
-- the two as one register, and the DPDP job's own status vocabulary (`requested|approved|processing|delivered`) means
-- something different from a worker's `queued→running→ready`.
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION. Both tables carry `tenant_id` and are ENABLED + FORCED with the house policy. The WORKER runs the
-- tenant half of every job through the unit of work as `kv_app` with `app.tenant_id` set (exactly as
-- `DairyCycleCloseCadenceJob` does), so it never needs to bypass RLS to write; the ONE cross-tenant read it performs
-- — "which job is oldest in the whole queue" — and the two the status page performs — position and median runtime,
-- both over EVERY tenant's jobs because the queue is one queue — run on the runner's `kv_relay` (BYPASSRLS) pool and
-- are SELECT-only. `kv_relay` is therefore revoked INSERT/UPDATE/DELETE on both tables below (0018's default grant is
-- wider than this plane needs), and `kv_app`'s UPDATE is narrowed to the columns the state machine moves.
--
-- PARTITION NOTE. Not partitioned. A job row is written once per export a human asks for and a download row once per
-- click; a district union exporting daily for ten years is ~3,650 job rows. The queue's hot set is `status='queued'`
-- and is served by a partial index that stays tiny regardless of history. Should the download log ever need it, it is
-- keyed by uuid_v7 and can be range-partitioned by `uuid_v7_time(id)` without changing a reader (Law 8).
-- ------------------------------------------------------------------------------------------------------------------

-- ------------------------------------------------------------------------------------------------------------------
-- 169.0  THE GATE FINDING FIRST: 0166 ENABLED ROW LEVEL SECURITY AND DID NOT FORCE IT
-- ------------------------------------------------------------------------------------------------------------------
-- `node db/scripts/verify-rls-coverage.js` reports `dairy_shift_diversions: RLS enabled but NOT forced (owner can
-- bypass)`. Every other tenant table in 0155–0168 is forced; 0166 wrote `ENABLE` alone. The gate is the CI merge gate
-- for tenant isolation and it has been red since 0166 landed. Fixed forward here (Law 9: an applied migration is never
-- edited), and the gate is green again from this file on.
ALTER TABLE dairy_shift_diversions FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------------------------------------------
-- 169.1  THE JOB — one export a human asked for, from queued to a receipt (or to a reason it never became one)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_export_jobs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  -- WHICH producer makes this file. A code in the API's dataset registry (`core/exports-plane/dataset.registry.ts`),
  -- e.g. `dairy.insights`. The registry is what says which permission reads the job and which module builds the rows;
  -- a job whose code nothing registers is failed by the worker with `unknown_dataset`, never silently skipped.
  dataset_code    varchar(60) NOT NULL,
  -- The producer's own parameters (for dairy.insights: `{ "window": 90 }`), validated by the producer's zod schema at
  -- enqueue time, and their canonical sha256 so two requests for the same file can be recognised as the same request.
  params          jsonb NOT NULL DEFAULT '{}',
  params_sha256   char(64) NOT NULL CHECK (params_sha256 ~ '^[0-9a-f]{64}$'),
  -- THE REQUESTER. W2554's receipt names them; `users` because the requester is a person with a role in this tenant.
  requested_by    uuid NOT NULL REFERENCES users(id),
  -- THE STATE MACHINE (domain/export-job.state.ts is the only writer of transitions — Law 5):
  --   queued → running → ready → expired
  --                    ↘ failed
  --   running → queued  (a crash mid-run: the claim is released and attempts counts it)
  status          varchar(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','ready','failed','expired')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  queued_at       timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  generated_at    timestamptz,
  failed_at       timestamptz,
  expired_at      timestamptz,
  -- WHEN THE FILE STOPS BEING SERVED. `generated_at + retention`, stamped at generation so the receipt can print the
  -- date and the sweep can find it by index. The retention is `EXPORT_FILE_RETENTION_DAYS` in the API (7), and the
  -- reason it is a constant and not a tenant setting is written beside it.
  expires_at      timestamptz,
  -- THE RECEIPT (W2554): file name, row count, sha256, generated-at, requester. Row count is DATA rows — the header
  -- line is not a row and the receipt says so. `content_sha256` is over the bytes as stored; a download re-computes
  -- it over the bytes served and the download row records whether they matched (0120's discipline, kept).
  row_count       integer CHECK (row_count >= 0),
  content_sha256  char(64) CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  file_name       varchar(200),
  byte_size       bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  content_type    varchar(80),
  -- Where the bytes live in the object store (`MediaModule`'s `ObjectStore`). NULL until ready; kept after expiry so
  -- an operator can find what was deleted, if anything ever needs to be.
  storage_key     varchar(400),
  -- WHAT THE FILE ADMITS. The producer's own notes, e.g. dairy.insights: "payout streak refused: not recorded; spoilage
  -- refused: not measurable". A refused figure is NOT a row in the file, and this is where the receipt says so, because
  -- a spreadsheet missing a column invites somebody to compute it from the wrong ones (TENANT-5d's rule).
  notes           jsonb NOT NULL DEFAULT '[]',
  -- WHY IT FAILED, as a code the screen can translate (`unknown_dataset`, `dataset_disabled`, `money_shape_missing`,
  -- `storage_failed`, `producer_failed`, `too_many_attempts`) plus the untranslated detail for the operator.
  failure_code    varchar(60),
  failure_detail  text,
  version         integer NOT NULL DEFAULT 1,
  -- Every terminal state carries the facts it claims. A `ready` row without a digest is a receipt that proves nothing;
  -- a `failed` row without a code is a screen that can only say "something went wrong".
  CONSTRAINT ck_texp_ready CHECK (status <> 'ready' OR (
    generated_at IS NOT NULL AND row_count IS NOT NULL AND content_sha256 IS NOT NULL AND file_name IS NOT NULL
    AND byte_size IS NOT NULL AND storage_key IS NOT NULL AND content_type IS NOT NULL AND expires_at IS NOT NULL)),
  CONSTRAINT ck_texp_failed CHECK (status <> 'failed' OR (failed_at IS NOT NULL AND failure_code IS NOT NULL)),
  CONSTRAINT ck_texp_expired CHECK ((status = 'expired') = (expired_at IS NOT NULL)),
  -- An expired file was once ready: it keeps its receipt. This is what lets W2554 print the receipt with the word
  -- "expired" beside the download instead of a blank page.
  CONSTRAINT ck_texp_expired_has_receipt CHECK (status <> 'expired' OR (generated_at IS NOT NULL AND content_sha256 IS NOT NULL))
);
CALL add_std_columns('tenant_export_jobs');

-- THE QUEUE. One queue across every tenant (the worker is one worker), FIFO by `queued_at` then id. Partial, so it
-- holds only what is waiting — the position query ("how many are ahead of me") and the worker's claim both walk it.
CREATE INDEX IF NOT EXISTS idx_texp_queue ON tenant_export_jobs (queued_at, id) WHERE status = 'queued';
-- What a tenant sees: its own recent jobs, newest first.
CREATE INDEX IF NOT EXISTS idx_texp_tenant_recent ON tenant_export_jobs (tenant_id, queued_at DESC, id);
-- THE ETA'S HISTORY: the last N ready jobs' runtimes. Partial on ready, ordered by when they finished.
CREATE INDEX IF NOT EXISTS idx_texp_ready_recent ON tenant_export_jobs (generated_at DESC) WHERE status = 'ready';
-- THE EXPIRY SWEEP: ready files past their retention.
CREATE INDEX IF NOT EXISTS idx_texp_expiry ON tenant_export_jobs (expires_at) WHERE status = 'ready';
-- STALE CLAIMS: a job left `running` by a pod that died. The worker's sweep releases them by `started_at`.
CREATE INDEX IF NOT EXISTS idx_texp_running ON tenant_export_jobs (started_at) WHERE status = 'running';

-- ONE OPEN JOB PER (tenant, dataset, params, requester). The SAME request twice while the first is still queued or
-- running returns the first — a secretary who double-clicks Export must not put two identical files on the queue.
-- Partial and over NOT NULL columns only (6c-4's finding: ON CONFLICT cannot fire on a nullable key). Across different
-- requesters the jobs are different jobs: the receipt names the requester, and two people asking is two receipts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_texp_open_request
  ON tenant_export_jobs (tenant_id, dataset_code, params_sha256, requested_by)
  WHERE status IN ('queued','running') AND deleted_at IS NULL;

ALTER TABLE tenant_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_export_jobs ON tenant_export_jobs;
CREATE POLICY p_tenant_export_jobs ON tenant_export_jobs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- LEAST PRIVILEGE. `kv_app` (the request tier AND the worker's tenant half, through the unit of work) may enqueue and
-- may move the state machine; it may not rewrite WHAT was asked for, by WHOM or WHEN — the columns an auditor reads to
-- decide whether a receipt is the receipt of the request that was made. `kv_relay` (the runner's pool) reads the
-- queue across tenants and writes nothing. Nobody deletes: an export a tenant asked for is history.
REVOKE UPDATE, DELETE ON tenant_export_jobs FROM kv_app;
GRANT UPDATE (status, attempts, started_at, generated_at, failed_at, expired_at, expires_at, row_count, content_sha256,
              file_name, byte_size, content_type, storage_key, notes, failure_code, failure_detail, version,
              updated_at, updated_by)
  ON tenant_export_jobs TO kv_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_export_jobs FROM kv_relay;

COMMENT ON TABLE tenant_export_jobs IS
  'PC-56 TENANT-6e-2 (W2553/W2554): the TENANT export plane''s job. One row per file a person asked for: dataset + '
  'params + requester, a worker-driven status machine (queued->running->ready|failed, ready->expired), and the receipt '
  '(file name, DATA row count, sha256, generated_at, byte size, storage key, notes naming what the file refuses). '
  'Position and ETA are COMPUTED from this table, never stored: position is the count of queued rows ahead by '
  'queued_at, ETA is that times the median runtime of the last ready jobs, and NULL when there is no history.';
COMMENT ON COLUMN tenant_export_jobs.row_count IS
  'DATA rows in the file. The CSV header is not a row. The receipt on W2554 prints this number and says so.';
COMMENT ON COLUMN tenant_export_jobs.expires_at IS
  'generated_at + EXPORT_FILE_RETENTION_DAYS (API constant, 7 days). After it the job is swept to ''expired'', the '
  'receipt stays and the download says the file is gone rather than 404.';

-- ------------------------------------------------------------------------------------------------------------------
-- 169.1b  POSITION AND ETA, READ FROM THE REQUEST TIER WITHOUT SEEING ANOTHER TENANT'S ROW
-- ------------------------------------------------------------------------------------------------------------------
-- The queue is ONE queue across every tenant, so "how many jobs are ahead of mine" is a count over rows RLS hides from
-- the caller — correctly. The request tier holds no BYPASSRLS pool (only the jobs runner does, and a status page must
-- not borrow the worker's connection). So the two counts the page needs are computed INSIDE the database by a function
-- owned by `kv_relay` (BYPASSRLS) and executable by `kv_app`: it returns three NUMBERS — jobs ahead, the size of the
-- runtime sample, and the median runtime — and nothing else about anybody's job. It refuses to answer for a job the
-- caller cannot see (the RLS-filtered lookup of the caller's own row happens first, as `kv_app`).
--
-- FIFO is `(queued_at, id)`, the same order the worker claims in; `id` is uuid_v7 so ties on the instant break the way
-- they were enqueued. The median is `percentile_cont(0.5)` over the last EXPORT_ETA_SAMPLE ready jobs' `generated_at -
-- started_at`, bounded by `idx_texp_ready_recent`; `sample = 0` means "no history", and the API turns that into an ETA
-- of NULL rather than zero.
CREATE OR REPLACE FUNCTION export_queue_standing(p_job_id uuid, p_sample integer DEFAULT 20)
RETURNS TABLE (ahead integer, sample integer, median_ms integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT queued_at, id FROM tenant_export_jobs WHERE id = p_job_id AND status = 'queued'
  ),
  recent AS (
    SELECT extract(epoch FROM (generated_at - started_at)) * 1000 AS ms
      FROM tenant_export_jobs
     WHERE status = 'ready' AND started_at IS NOT NULL AND generated_at IS NOT NULL
     ORDER BY generated_at DESC
     LIMIT greatest(1, least(p_sample, 200))
  )
  SELECT
    (SELECT count(*)::int FROM tenant_export_jobs q, me
      WHERE q.status = 'queued' AND (q.queued_at, q.id) < (me.queued_at, me.id)) AS ahead,
    (SELECT count(*)::int FROM recent) AS sample,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::int FROM recent) AS median_ms;
$$;
ALTER FUNCTION export_queue_standing(uuid, integer) OWNER TO kv_relay;
REVOKE ALL ON FUNCTION export_queue_standing(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_queue_standing(uuid, integer) TO kv_app;
COMMENT ON FUNCTION export_queue_standing(uuid, integer) IS
  'PC-56 TENANT-6e-2: jobs ahead of p_job_id in the one cross-tenant export FIFO, plus the ready-runtime sample and its '
  'median (ms). SECURITY DEFINER as kv_relay so kv_app can read three counts without reading another tenant''s rows. '
  'ahead is 0 when the job is not queued (the caller checks status first).';

-- ------------------------------------------------------------------------------------------------------------------
-- 169.2  EVERY FETCH LOGGED — including the ones that were refused
-- ------------------------------------------------------------------------------------------------------------------
-- The download is served THROUGH the API (never a presigned object-store URL) for the reason 0120 gave: a fetch from
-- S3 cannot be logged here. The link is a 15-minute HMAC-signed token minted by `POST /exports/:id/link` (jti, job,
-- tenant, expiry, requester) and presented on `GET /exports/:id/download`; the API verifies it, writes this row, and
-- streams the bytes while re-computing the digest. A refused attempt — no token, bad signature, expired token, token
-- for another job, job not ready, file past retention — is a row too, with its `outcome`, because "every fetch logged"
-- that omits the refused ones is a log of the fetches that went well.
CREATE TABLE IF NOT EXISTS tenant_export_downloads (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  job_id          uuid NOT NULL REFERENCES tenant_export_jobs(id),
  -- The AUTHENTICATED caller. The signed link authorises the file; the session says who. Both are required to fetch,
  -- so a link pasted into a chat does not hand the file to whoever finds it (the decision 0120's admin plane made too).
  fetched_by      uuid NOT NULL REFERENCES users(id),
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  -- The link's jti, when the request carried a token whose shape could be read at all. NULL for `refused_no_token`.
  token_jti       uuid,
  outcome         varchar(30) NOT NULL CHECK (outcome IN (
                    'served', 'aborted', 'storage_failed',
                    'refused_no_token', 'refused_bad_signature', 'refused_expired', 'refused_wrong_job',
                    'refused_not_ready', 'refused_file_expired')),
  bytes_served    bigint CHECK (bytes_served IS NULL OR bytes_served >= 0),
  -- The digest RE-COMPUTED over the bytes actually sent (0120's discipline). `digest_matched = false` is the only
  -- evidence anybody could have that a stored file changed between generation and download.
  served_sha256   char(64) CHECK (served_sha256 IS NULL OR served_sha256 ~ '^[0-9a-f]{64}$'),
  digest_matched  boolean,
  ip              inet,
  user_agent      varchar(300),
  CONSTRAINT ck_texd_served CHECK (outcome <> 'served' OR (bytes_served IS NOT NULL AND served_sha256 IS NOT NULL AND digest_matched IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_texd_job ON tenant_export_downloads (tenant_id, job_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_texd_mismatch ON tenant_export_downloads (job_id, fetched_at DESC) WHERE digest_matched = false;

ALTER TABLE tenant_export_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_export_downloads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_export_downloads ON tenant_export_downloads;
CREATE POLICY p_tenant_export_downloads ON tenant_export_downloads
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- APPEND-ONLY. A fetch log an application can edit is a fetch log that proves nothing about the application.
REVOKE UPDATE, DELETE ON tenant_export_downloads FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_export_downloads FROM kv_relay;

COMMENT ON TABLE tenant_export_downloads IS
  'PC-56 TENANT-6e-2 (W2554 "every fetch logged"): one row per attempt to fetch a tenant export - served OR refused, '
  'with the signed link''s jti, the authenticated fetcher, bytes served and the digest re-computed over them. '
  'Append-only.';

-- ------------------------------------------------------------------------------------------------------------------
-- 169.3  THE FLAG (Law 10) — the PLANE's flag, distinct from each dataset's own
-- ------------------------------------------------------------------------------------------------------------------
-- `tenant_exports` switches the plane: enqueue, status, link, download and the worker's tick. A dataset is additionally
-- gated by whatever gates its screen (dairy.insights reads `dairy_insights` in its producer, as 6e-1's read model
-- does), so switching the insights page off also stops its export being produced — the worker fails the job with
-- `dataset_disabled` and the receipt says so, rather than producing a file for a screen the tenant cannot see.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('tenant_exports',
   'PC-56 TENANT-6e-2 (W2553/W2554): the tenant export plane - queued jobs with a live position and an ETA that is an '
   'estimate, a worker that writes the file and its sha256, an audit-stamped receipt, 15-minute signed links and a '
   'log of every fetch. OFF means no export can be enqueued and the worker does not tick; the screens say the plane '
   'is not switched on. Each dataset is ALSO gated by its own screen''s flag.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 169.4  THE NOTIFICATION (copy lives in the seed, above the version backfill)
-- ------------------------------------------------------------------------------------------------------------------
-- The worker emits `exports.export_ready` in the SAME transaction that marks the job ready (Law 4). It is catalogued
-- here so a template can tell the requester their file is on the ready page; `inapp` and `push` only — an export link
-- is not something to read out over IVR, and an SMS about a spreadsheet to a phone that cannot open one is noise.
-- `user_can_opt_out = true`: this is a courtesy, not a safety notice. The copy is in `db/seeds/core/0007` in en/hi/gu
-- with the three variables declared, and is held to TENANT-6d-7's guard like every other template.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('exports.export_ready', 'Your export is ready', 'informational', '["inapp","push"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 169.5  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • **It does not store position or ETA.** Both are derived at read time from this table (see the job comment). A
--     stored position is stale the moment the job ahead finishes; a stored ETA is a promise the worker did not make.
--   • **It does not register a second dataset.** `dairy.insights` is the first; the registry is the extension point.
--     The GSTR-1 export (3c-1) and the logistics insights export (5d) stay synchronous and bounded, which their own
--     screens already say, and moving either onto this plane is a wave of its own with its own receipt semantics.
--   • **It does not delete the bytes.** Expiry flips the row to `expired` and stops the download; the object store's
--     own lifecycle rule (infra) is where the bytes are removed, and that rule is named in the report, not here.
--   • **It does not widen 0015's `data_export_jobs`.** See the header.
