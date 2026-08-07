-- ============================================================================
-- MIGRATION 0120 — THE FRONT DOOR WITH NOTHING ON IT, AND A WATERMARK NOBODY APPLIES (PC-56 ADMIN-10)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- FINDING 1: THE PLATFORM DASHBOARD IS TWENTY-SIX LINES AND ONE LINK
-- ---------------------------------------------------------------------------
-- `apps/web-admin/src/app/dashboard/page.tsx` is, in full: a title, a lead paragraph, and one card linking to
-- `/ai-models`. No figure, no chart, no API call. **W001 is the first screen a platform operator sees** and it promises
-- GMV today, active tenants, orders per minute, payout success, a 14-day GMV trend, an alert stack and the tenant
-- lifecycle band.
--
-- **AND THE BACKEND FOR MOST OF IT HAS EXISTED SINCE PC-54.** `platform-reports` computes MRR/ARR from `subscriptions`,
-- lifecycle counts from `tenants.status`, GMV + platform fee + commission from `orders`, active users and a login-success
-- ratio in basis points, tenant growth, and a whitelisted custom series — all money in bigint minor units, all ratios in
-- integer basis points, windows bounded at 366 days. Nine waves of this programme have built deep planes behind a front
-- door with nothing on it. That is not a defect in any one wave; it is what happens when every wave picks the plane with
-- the most findings, and it is worth recording as its own kind of miss.
--
-- ---------------------------------------------------------------------------
-- FINDING 2: THE WATERMARK HELPER IS DEAD CODE
-- ---------------------------------------------------------------------------
-- ADMIN-5c extracted `core/export/receipt.ts` and its header states the case plainly: "W045 and W018 both promise
-- 'every download watermarked per user', and nothing has ever marked a file." It then wrote `watermarkPreamble()` and
-- `withWatermark()`.
--
-- `grep -rn "withWatermark" apps/admin-api/src --include=*.ts` outside tests returns **the definition and nothing
-- else.** Five export services import `contentDigest` and `DIGEST_BASIS`; not one applies the watermark. So the digest
-- half of that wave landed and the artefact half did not — **a helper written to close a promise, and then not wired,
-- which is a new shape: the fix exists, is correct, and is unreachable.**
--
-- ---------------------------------------------------------------------------
-- FINDING 3: "EVERY FETCH LOGGED" AND A PRESIGNED URL ARE INCOMPATIBLE
-- ---------------------------------------------------------------------------
-- W2127 promises: "Audit-stamped receipt: file name, row count, sha256, generated-at, requester — delivery via 15-min
-- signed URL, every fetch logged."
--
-- **A PRESIGNED URL IS FETCHED FROM S3, NOT FROM THIS PLATFORM.** Once the link is handed over, the download does not
-- touch admin-api, so the platform cannot log it — not as an oversight but as a property of the delivery mechanism. The
-- two halves of that sentence cannot both be true at once, and the canon asks for both.
--
-- This file takes the side that keeps the promise: report exports on this plane are small aggregates (a board pack, not
-- a data dump), so they are served THROUGH admin-api and **every fetch is a row in `report_export_downloads`**. The
-- presigned surfaces elsewhere keep presigned delivery and the console says, on those screens, that the fetch is not
-- logged — because a 4 GB tenant dump streamed through an API server is a different and worse problem.
--
-- (The TTL divergence is deliberate too: the canon says 15 minutes, `MEDIA_PRESIGN_EXPIRY_SEC` is 120 seconds. The
-- shorter link is the safer one and it stays. A link that outlives the click is a link that gets pasted into a chat.)
--
-- ---------------------------------------------------------------------------
-- FINDING 4: DELTA-028 IS HALF-CLOSED ALREADY AND NOBODY NOTICED
-- ---------------------------------------------------------------------------
-- W111's banner: "Backend pending (DELTA-028): saved report definitions + schedules table — builder runs ad-hoc queries
-- today. Design leads." Two objects, and **ADMIN-1e already built the second one**: `scheduled_reports` +
-- `scheduled_report_runs` (0095), with a cadence enum, an IST hour, ISO weekday, recipients, a due index and a worker
-- that claims them. It is scoped to the billing export vocabulary, and its `report varchar(40)` comment says it "mirrors
-- the export vocabulary" rather than being fixed to it.
--
-- So this file adds the missing half — the saved DEFINITION — and points `scheduled_reports.report` at it, rather than
-- inventing a second scheduling mechanism beside a working one. The ADMIN-3c precedent: a delta closed with less new
-- schema than its banner implies, because part of the answer was already in the database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 120.1  SAVED REPORT DEFINITIONS — the half of DELTA-028 that was missing
-- ---------------------------------------------------------------------------
CREATE TABLE saved_report_definitions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- The slug a schedule points at. `scheduled_reports.report` is a varchar of the export vocabulary, so a saved
  -- definition joins that vocabulary by NAME rather than by FK — deliberately: a schedule must survive its definition
  -- being archived (it then fails loudly with "no such report" instead of cascading away silently, which is how a
  -- board pack stops arriving and nobody notices for a quarter).
  slug          varchar(60) NOT NULL,
  title         varchar(160) NOT NULL,

  -- **THE DEFINITION IS A WHITELISTED METRIC, NOT A QUERY.** The builder's dataset/dimension/measure vocabulary is a
  -- frozen map in `platform-reports` (`SRC` in the read model), and this column stores a KEY from that map. Storing
  -- arbitrary SQL — or a JSON tree that compiles to SQL — would be a stored-query engine in the god-mode realm, and the
  -- first person to save `SELECT * FROM users` would have built themselves an exfiltration tool with a friendly name.
  metric        varchar(40) NOT NULL,
  bucket        varchar(10) NOT NULL DEFAULT 'day' CHECK (bucket IN ('day', 'week', 'month')),

  -- A RELATIVE window, not two dates. "The last 30 days" is what a saved report means; a saved definition pinned to
  -- 2026-06-01 → 2026-07-12 is a report that is wrong the day after it is saved, and W111's own date inputs are
  -- absolute — which is right for an ad-hoc run and wrong for a saved one.
  window_days   integer NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 366),

  currency_code varchar(3) NOT NULL DEFAULT 'INR',
  filters       jsonb NOT NULL DEFAULT '{}',

  -- Who may see it. A definition saved by one desk is not automatically another desk's business, and the console shows
  -- the owner rather than presenting every saved report as institutional.
  created_by_admin_id uuid NOT NULL,
  is_shared     boolean NOT NULL DEFAULT false,
  archived_at   timestamptz,
  notes         text,

  CONSTRAINT ck_srd_slug CHECK (slug ~ '^[a-z][a-z0-9-]{1,59}$')
);
CALL add_std_columns('saved_report_definitions');
-- One live definition per slug: a schedule points at a slug, and two live definitions sharing one would make "which
-- report did Monday's email contain" unanswerable.
CREATE UNIQUE INDEX uq_srd_slug_live ON saved_report_definitions(slug)
  WHERE archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_srd_owner ON saved_report_definitions(created_by_admin_id, created_at DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

COMMENT ON COLUMN saved_report_definitions.metric IS
  'A KEY from the frozen whitelist in platform-reports, never SQL and never a query tree. A stored-query engine in the '
  'god-mode realm is an exfiltration tool with a friendly name.';
COMMENT ON COLUMN saved_report_definitions.window_days IS
  'Relative window. A saved definition pinned to absolute dates is a report that is wrong the day after it is saved.';

REVOKE ALL ON saved_report_definitions FROM kv_app, kv_relay;
GRANT SELECT ON saved_report_definitions TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 120.2  THE EXPORT RECEIPT, PERSISTED — because a receipt returned in a response is not a record
-- ---------------------------------------------------------------------------
-- Six surfaces compute a digest and hand it back in the HTTP response, with the same fields copied into an `audit_log`
-- row. That is defensible and it makes one question hard: "show me every export of platform revenue this quarter and
-- prove none of them has been altered" requires scanning a jsonb column in a partitioned audit table for six different
-- action names. A receipt is a first-class artefact on this platform's own telling — W2127 calls it "audit-stamped" —
-- so it gets a table, and the audit row keeps pointing at it.
CREATE TABLE report_export_receipts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  report            varchar(60) NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  generated_by_admin_id uuid NOT NULL,
  row_count         integer NOT NULL CHECK (row_count >= 0),
  -- A truncated export that looks complete is how a reconciliation goes wrong months later (the ADMIN-1d wording,
  -- promoted from a jsonb field to a column so it can be filtered on).
  truncated         boolean NOT NULL DEFAULT false,
  file_name         varchar(200) NOT NULL,
  content_sha256    char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- WHAT THE DIGEST COVERS, stored beside it. A hash whose basis is unrecorded cannot be re-derived by anybody who did
  -- not write the code, which makes it a decoration.
  digest_basis      varchar(40) NOT NULL,
  -- Whether the ARTEFACT carries the per-user mark. Recorded because the watermark helper existed unwired for a whole
  -- wave, and a column that reads `false` on every row is the fastest way to notice that again.
  watermarked       boolean NOT NULL DEFAULT false,
  pii_masked        boolean,
  filters           jsonb NOT NULL DEFAULT '{}',
  -- Where the bytes live, when they were stored rather than streamed. NULL means the file was generated and streamed in
  -- one response — which is the honest state for a small aggregate and is NOT the same as "the file is missing".
  object_key        varchar(400),
  expires_at        timestamptz
);
CREATE INDEX idx_rer_report ON report_export_receipts(report, generated_at DESC, id);
CREATE INDEX idx_rer_actor ON report_export_receipts(generated_by_admin_id, generated_at DESC);
-- APPEND-ONLY, and revoked from kv_admin too: a receipt an operator can edit is a receipt that proves nothing about the
-- operator. The same rule 0119 applied to the impersonation action log, for the same reason.
REVOKE ALL ON report_export_receipts FROM kv_app, kv_relay;
REVOKE UPDATE, DELETE, TRUNCATE ON report_export_receipts FROM kv_admin;
GRANT SELECT ON report_export_receipts TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 120.3  EVERY FETCH LOGGED — the half of W2127 a presigned URL cannot deliver
-- ---------------------------------------------------------------------------
CREATE TABLE report_export_downloads (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  receipt_id    uuid NOT NULL REFERENCES report_export_receipts(id),
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  fetched_by_admin_id uuid NOT NULL,
  ip            inet,
  user_agent    varchar(300),
  -- The digest RE-COMPUTED at fetch time over the bytes about to be sent. **This is what makes the receipt worth
  -- having**: a receipt records what was generated, and this records that what was delivered still matched. A mismatch
  -- is the only evidence a reader could ever have that a stored artefact changed between generation and download.
  served_sha256 char(64) CHECK (served_sha256 IS NULL OR served_sha256 ~ '^[0-9a-f]{64}$'),
  digest_matched boolean
);
CREATE INDEX idx_red_receipt ON report_export_downloads(receipt_id, fetched_at DESC);
CREATE INDEX idx_red_actor ON report_export_downloads(fetched_by_admin_id, fetched_at DESC);
-- A mismatch must be findable in one index scan rather than by reading every download of every export.
CREATE INDEX idx_red_mismatch ON report_export_downloads(receipt_id, fetched_at DESC)
  WHERE digest_matched = false;

REVOKE ALL ON report_export_downloads FROM kv_app, kv_relay;
REVOKE UPDATE, DELETE, TRUNCATE ON report_export_downloads FROM kv_admin;
GRANT SELECT ON report_export_downloads TO kv_readonly;

COMMENT ON TABLE report_export_downloads IS
  'One row per FETCH of a report export, with the digest re-computed over the delivered bytes. W2127 promises "every '
  'fetch logged"; a presigned S3 URL is fetched from S3 and cannot be logged here, so this plane serves its own bytes.';

-- ---------------------------------------------------------------------------
-- 120.4  THE STATEMENT TIMEOUT, AS DATA
-- ---------------------------------------------------------------------------
-- W111: "Narrow the date range or drop a dimension — the 60s replica limit protects everyone." The limit is buildable
-- and the replica is not: admin-api holds ONE pool on `DATABASE_ADMIN_URL` and `grep -rn replica apps/admin-api/src`
-- finds no pool selection at all. So this file lands the timeout and the console states plainly that report queries run
-- against the primary — a claim about which server answers is a claim an operator would rely on when deciding whether a
-- heavy report is safe to run at 6 p.m.
CREATE TABLE report_query_policy (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  statement_timeout_ms  integer NOT NULL DEFAULT 60000 CHECK (statement_timeout_ms BETWEEN 1000 AND 600000),
  -- The canon's own numbers (W111's fine print): 92 days, 50,000 rows. Tighter than `MAX_WINDOW_DAYS = 366` in the
  -- existing window guard, and the tighter bound wins for the BUILDER while the dashboard keeps the wider one — a
  -- 14-day dashboard chart and a 92-day ad-hoc export are different risks.
  max_range_days        integer NOT NULL DEFAULT 92 CHECK (max_range_days BETWEEN 1 AND 366),
  max_rows              integer NOT NULL DEFAULT 50000 CHECK (max_rows BETWEEN 1 AND 1000000),
  -- FALSE, and it is the honest value: there is no replica pool in this realm. When one lands, this flips and the
  -- console's sentence changes with it rather than needing an edit to stop being wrong.
  reads_from_replica    boolean NOT NULL DEFAULT false,
  updated_by_admin_id   uuid
);
CALL add_std_columns('report_query_policy');
INSERT INTO report_query_policy (id) VALUES (true);
REVOKE ALL ON report_query_policy FROM kv_app, kv_relay;
GRANT SELECT ON report_query_policy TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 120.5  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO ASYNC EXPORT QUEUE.** W2126 promises "this job is queued with a position and ETA". Every export on this platform
-- is synchronous, and a queue table with a position column that nothing enqueues into would be the seventh
-- status-recording-an-act-nobody-performs. The queued state page instead says the export is generated on the spot, and
-- the async queue is filed as ADMIN-10-Q1 for the day an export is large enough to need one.
--
-- NO PER-MINUTE ORDER ROLLUP. W001's "Orders / min 642 · peak 1,190" needs minute-granularity history; the only source
-- is the partitioned `orders` table, and a peak-over-time figure would mean scanning it per minute. The dashboard shows
-- the rate it can compute honestly (orders in the last hour ÷ 60) and names the peak as unavailable (ADMIN-10-Q2).
--
-- NO `analytics.farmer360` PERMISSION. W111 names it as the gate for row-level person data, and this realm has no
-- farmer-360 surface at all — a permission with no route behind it is a promise nothing keeps (the ADMIN-5 rule).
