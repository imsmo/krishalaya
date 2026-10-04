-- ==================================================================================================================
-- 0202 · PC-56 TENANT-SW-f · INSIGHTS, LEARNER INSIGHTS, OFFLINE — the last sweep wave
--        canon W193 + W2678–W2682 (mandi pulse) · W194 + W2569–W2573 (demand map) · W195 + W2824–W2828 (wastage)
--        · W196 + W2738–W2740 (report builder) · W318 (offline & stale canon) · W417 (learner insights)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration (fix forward).
-- No money moves in this file. Every figure the console prints is a READ with a published method, or refused by name.
--
-- Founder decisions (2026-10-04), built as decided:
--   • WASTAGE_EVENTS FROM RECORDED FACTS ONLY (DELTA-031) — a row exists only because a source row recorded a loss: a return
--     refunded, a rejected milk pour, a POD-opened dispute resolved with a refund, a cold-chain loss recorded, a POD rejected.
--     The writer names the SOURCE and nothing else: `trg_we_before` derives every fact column (time, kind, product, quantity,
--     value, currency) from the source row itself, refuses a source that is not in a loss state, refuses a second row for the
--     same source, and refuses every UPDATE / DELETE / TRUNCATE. kv_app holds SELECT + INSERT only. Manual entry is REFUSED.
--   • TENANT REPORT STORE + BOUNDED BUILDER OVER ALLOW-LISTED DATASETS (DELTA-028) — `saved_report_definitions` is opened to
--     tenants under the 0175 split (tenant rows own-only; platform rows read-only), `report_runs` (≤ 92 days by CHECK as well
--     as by the DTO and the service), `report_run_results` (what the run read, frozen for the plane's file), `report_schedules`.
--   • OFFLINE = STALE + DEGRADED + VERIFY-BEFORE-WRITE, NO SERVICE WORKER — console-only; nothing in the database.
--   • LEARNER INSIGHTS = NEW CAPTURE + 50-LEARNER FLOOR — `quiz_answers` + `watch_events`, written in the same transaction as
--     the existing lesson-progress write, append-only; `capture_epochs` records when capture began.
--
--   202.1  permissions · flags · the notification catalogue row
--   202.2  wastage_events: table, fact derivation `kv_wastage_fact`, the writer `kv_wastage_record`, the trigger, the per-tenant
--          `kv_wastage_backfill`, and the BACKFILL of every existing source row (method_code = 'backfill')
--   202.3  saved_report_definitions opened to tenants; report_runs; report_run_results; report_schedules
--   202.4  quiz_answers; watch_events; capture_epochs
--   202.5  RLS (the 0175 split) · grants (kv_app only; kv_relay nothing) · indexes
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 202.1  PERMISSIONS · FLAGS · NOTIFICATION CATALOGUE
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('report.run', 'Report builder: run allow-listed datasets (92 days, 50,000 rows, 60 s), save and schedule (auditor: its datasets, runs only)', NULL),
  ('insights.manage', 'Insights: re-run the wastage backfill from recorded facts (idempotent; never a manual loss)', NULL)
ON CONFLICT (code) DO NOTHING;
-- The coordinator role is seeded by core/0004 (which migrate.js applies before 0125); guaranteed HERE as well, before it is bound below
-- (0174's shape for `instructor`), so this grant can never silently grant nothing on a database built another way.
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT 'fpo_coordinator', 'FPO Coordinator', 'tenant', true, true, NULL
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = 'fpo_coordinator');
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (p.code = 'report.run' AND r.code IN ('tenant_admin', 'fpo_coordinator', 'auditor'))
    OR (p.code = 'insights.manage' AND r.code = 'tenant_admin')
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('insights_wastage', 'PC-56 TENANT-SW-f: measured loss from recorded facts only (returns, rejected pours, POD disputes, cold-chain losses, POD rejections) (W195) — OFF = the wastage screen says it is off', false, 100, '{}'),
  ('insights_reports', 'PC-56 TENANT-SW-f: the tenant report builder — allow-listed datasets, ≤ 92 days, 50,000 rows, 60 s statement timeout, watermarked + audited CSV on the export plane (W196) — OFF = the builder says it is off', false, 100, '{}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('insights.report_ready', 'A scheduled report is ready', 'informational', '["inapp","push"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 202.2  WASTAGE EVENTS — FROM RECORDED FACTS ONLY
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wastage_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  occurred_at   timestamptz NOT NULL,
  kind          varchar(10) NOT NULL,
  source_kind   varchar(30) NOT NULL,
  -- THE SOURCE REFERENCE (table + id). The only thing a writer names; every other column is derived from it by the trigger.
  source_table  varchar(40) NOT NULL,
  source_id     uuid NOT NULL,
  -- ONE LOSS, TWO RECORDS: a POD rejection opens a dispute, and that dispute may later resolve with a refund. Both are facts and
  -- both are kept; `chain_key` ('dispute:<id>') lets every reader count the loss ONCE (the dispute's resolution when it exists).
  chain_key     text,
  product_id    uuid REFERENCES products(id),
  subject_type  varchar(40),
  subject_id    uuid,
  quantity      numeric(14,3),
  unit_code     varchar(20) REFERENCES units(code),
  value_minor   bigint,
  currency_code char(3),
  -- Why there is no money value — the source carries no recorded money fact for this loss. Never 0, never guessed.
  value_reason  varchar(40),
  method_code   varchar(10) NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid REFERENCES users(id),
  CONSTRAINT ck_we_kind CHECK (kind IN ('transit', 'storage', 'milk', 'other')),
  CONSTRAINT ck_we_source CHECK (
       (source_kind = 'return_accepted'          AND source_table = 'returns')
    OR (source_kind = 'dairy_pour_rejected'      AND source_table = 'milk_quality_reviews')
    OR (source_kind = 'transit_dispute_variance' AND source_table = 'disputes')
    OR (source_kind = 'cold_chain_loss'          AND source_table = 'cold_chain_breaches')
    OR (source_kind = 'pod_rejection'            AND source_table = 'pod_reviews')),
  CONSTRAINT ck_we_method CHECK (method_code IN ('event', 'backfill', 'rerun', 'sweep')),
  CONSTRAINT ck_we_value CHECK (value_minor IS NULL OR value_minor > 0),
  CONSTRAINT ck_we_value_currency CHECK ((value_minor IS NULL) = (currency_code IS NULL)),
  CONSTRAINT ck_we_value_reason CHECK ((value_minor IS NULL) = (value_reason IS NOT NULL)),
  CONSTRAINT ck_we_qty CHECK ((quantity IS NULL) = (unit_code IS NULL) AND (quantity IS NULL OR quantity > 0))
);
COMMENT ON TABLE wastage_events IS
  'PC-56 TENANT-SW-f (0202, DELTA-031): one row per RECORDED loss fact in a source table. A writer names (source_table, source_id); trg_we_before derives every other column from the source row and refuses a source not in a loss state, a second row for one source, and any update or delete. Manual entry is refused by name (MANUAL_WASTAGE_REFUSED).';

-- The facts of one source row, as recorded — or NO ROW when the source is not (or not yet) a loss. INVOKER: under kv_app it sees
-- only the caller's tenant (RLS on every source table); the migration's backfill runs it as the owner over every tenant.
CREATE OR REPLACE FUNCTION kv_wastage_fact(p_table text, p_id uuid)
RETURNS TABLE (f_tenant uuid, f_occurred timestamptz, f_kind text, f_source_kind text, f_chain text, f_product uuid, f_subject_type text,
               f_subject_id uuid, f_quantity numeric, f_unit text, f_value bigint, f_currency text, f_value_reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tenant uuid; v_at timestamptz; v_kind text; v_sk text; v_chain text; v_product uuid; v_st text; v_sid uuid;
  v_qty numeric; v_unit text; v_value bigint; v_cur text; v_reason text; v_order uuid; v_found boolean := false;
BEGIN
  IF p_table = 'returns' THEN
    SELECT r.tenant_id, r.updated_at, r.order_id, r.refund_amount_minor INTO v_tenant, v_at, v_order, v_value
      FROM returns r WHERE r.id = p_id AND r.status = 'refunded';
    v_found := FOUND; v_kind := 'other'; v_sk := 'return_accepted'; v_st := 'order'; v_sid := v_order;
    IF v_value IS NULL THEN v_reason := 'no_refund_amount_recorded'; END IF;
  ELSIF p_table = 'milk_quality_reviews' THEN
    SELECT q.tenant_id, q.decided_at, q.amount_withheld_minor, q.currency_code::text, q.collection_id, mc.weight_kg
      INTO v_tenant, v_at, v_value, v_cur, v_sid, v_qty
      FROM milk_quality_reviews q
      LEFT JOIN milk_collections mc ON mc.id = q.collection_id AND mc.collected_on = q.collected_on AND mc.tenant_id = q.tenant_id
     WHERE q.id = p_id AND q.status = 'rejected';
    v_found := FOUND; v_kind := 'milk'; v_sk := 'dairy_pour_rejected'; v_st := 'milk_collection';
    IF v_qty IS NOT NULL AND v_qty > 0 THEN v_unit := 'kg'; ELSE v_qty := NULL; END IF;
    IF v_value IS NOT NULL AND v_value <= 0 THEN v_value := NULL; END IF;
    IF v_value IS NULL THEN v_reason := 'no_priced_amount'; END IF;
  ELSIF p_table = 'disputes' THEN
    SELECT d.tenant_id, d.resolved_at, d.order_id, d.resolution_amount_minor, d.disputed_quantity
      INTO v_tenant, v_at, v_order, v_value, v_qty
      FROM disputes d
     WHERE d.id = p_id AND d.status = 'resolved' AND d.opened_via = 'pod_review'
       AND d.resolution_type IN ('refund_full', 'refund_partial') AND d.resolution_amount_minor IS NOT NULL AND d.resolution_amount_minor > 0;
    v_found := FOUND; v_kind := 'transit'; v_sk := 'transit_dispute_variance'; v_chain := 'dispute:' || p_id::text; v_st := 'order'; v_sid := v_order;
  ELSIF p_table = 'cold_chain_breaches' THEN
    SELECT b.tenant_id, b.outcome_at, b.subject_type, b.subject_id, b.loss_minor, b.loss_currency::text
      INTO v_tenant, v_at, v_st, v_sid, v_value, v_cur
      FROM cold_chain_breaches b WHERE b.id = p_id AND b.outcome = 'loss_recorded';
    v_found := FOUND; v_sk := 'cold_chain_loss';
    v_kind := CASE WHEN v_st = 'shipment' THEN 'transit' WHEN v_st = 'bmc_unit' THEN 'milk' ELSE 'storage' END;
    IF v_value IS NULL THEN v_reason := 'no_loss_amount_recorded'; v_cur := NULL; END IF;
  ELSIF p_table = 'pod_reviews' THEN
    SELECT p.tenant_id, p.decided_at, p.order_id, p.variance_minor, p.shipment_id, 'dispute:' || p.dispute_id::text
      INTO v_tenant, v_at, v_order, v_value, v_sid, v_chain
      FROM pod_reviews p WHERE p.id = p_id AND p.status = 'rejected';
    v_found := FOUND; v_kind := 'transit'; v_sk := 'pod_rejection'; v_st := 'shipment';
    IF v_value IS NULL THEN v_reason := 'no_variance_entered'; END IF;
  ELSE
    RETURN;
  END IF;
  IF NOT v_found OR v_tenant IS NULL OR v_at IS NULL THEN RETURN; END IF;

  -- the order behind a return / dispute / POD: its currency (for the value) and, when it has exactly ONE line, its product and unit
  IF v_order IS NOT NULL THEN
    IF v_cur IS NULL THEN SELECT o.currency_code::text INTO v_cur FROM orders o WHERE o.id = v_order AND o.tenant_id = v_tenant LIMIT 1; END IF;
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(oi.product_id))[1] END, CASE WHEN count(*) = 1 THEN (array_agg(oi.unit_code::text))[1] END
      INTO v_product, v_unit
      FROM order_items oi WHERE oi.order_id = v_order AND oi.tenant_id = v_tenant;
    IF v_qty IS NULL THEN v_unit := NULL; END IF;
    IF v_qty IS NOT NULL AND v_unit IS NULL THEN v_qty := NULL; END IF;   -- a quantity without a known unit is not printed as a quantity
  END IF;
  IF v_value IS NOT NULL AND v_cur IS NULL THEN v_value := NULL; v_reason := 'currency_unknown'; END IF;
  IF v_value IS NULL THEN v_cur := NULL; v_reason := coalesce(v_reason, 'no_money_fact'); ELSE v_reason := NULL; END IF;

  f_tenant := v_tenant; f_occurred := v_at; f_kind := v_kind; f_source_kind := v_sk; f_chain := v_chain; f_product := v_product;
  f_subject_type := v_st; f_subject_id := v_sid; f_quantity := v_qty; f_unit := v_unit; f_value := v_value; f_currency := v_cur;
  f_value_reason := v_reason;
  RETURN NEXT;
END $$;
COMMENT ON FUNCTION kv_wastage_fact(text, uuid) IS
  'PC-56 TENANT-SW-f (0202): the recorded loss facts of one source row (returns refunded · milk_quality_reviews rejected · disputes opened from a POD and resolved with a refund · cold_chain_breaches loss_recorded · pod_reviews rejected), or no row. Value only where the source carries a recorded money fact; otherwise value NULL with its reason.';

CREATE OR REPLACE FUNCTION trg_wastage_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[WASTAGE_APPEND_ONLY] a wastage event is a recorded fact: it is never changed or removed' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO f FROM kv_wastage_fact(NEW.source_table, NEW.source_id);
  IF NOT FOUND OR f.f_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION '[WASTAGE_SOURCE_NOT_A_FACT] % % is not a recorded loss in this tenant (facts only — no manual wastage)', NEW.source_table, NEW.source_id USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM wastage_events w WHERE w.source_table = NEW.source_table AND w.source_id = NEW.source_id) THEN
    RAISE EXCEPTION '[WASTAGE_EVENT_ONCE] % % already has its wastage event', NEW.source_table, NEW.source_id USING ERRCODE = 'P0001';
  END IF;
  -- every fact column from the source, whatever the statement carried
  NEW.occurred_at := f.f_occurred; NEW.kind := f.f_kind; NEW.source_kind := f.f_source_kind; NEW.chain_key := f.f_chain;
  NEW.product_id := f.f_product; NEW.subject_type := f.f_subject_type; NEW.subject_id := f.f_subject_id;
  NEW.quantity := f.f_quantity; NEW.unit_code := f.f_unit; NEW.value_minor := f.f_value; NEW.currency_code := f.f_currency;
  NEW.value_reason := f.f_value_reason; NEW.recorded_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_we_before ON wastage_events;
CREATE TRIGGER trg_we_before BEFORE INSERT OR UPDATE OR DELETE ON wastage_events FOR EACH ROW EXECUTE FUNCTION trg_wastage_events_guard();
DROP TRIGGER IF EXISTS trg_we_no_truncate ON wastage_events;
CREATE TRIGGER trg_we_no_truncate BEFORE TRUNCATE ON wastage_events FOR EACH STATEMENT EXECUTE FUNCTION trg_wastage_events_guard();
CREATE UNIQUE INDEX IF NOT EXISTS uq_wastage_source ON wastage_events (source_table, source_id);

-- THE WRITER every path uses (the relay handlers, the sweep job, the admin re-run, the backfill below): names the source, takes a
-- per-source advisory lock, answers 'exists' for a source already recorded (idempotent), 'not_fact' for one that is not a loss.
CREATE OR REPLACE FUNCTION kv_wastage_record(p_table text, p_id uuid, p_method text, p_by uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wastage:' || p_table || ':' || p_id::text, 0));
  IF EXISTS (SELECT 1 FROM wastage_events w WHERE w.source_table = p_table AND w.source_id = p_id) THEN RETURN 'exists'; END IF;
  SELECT f.f_tenant INTO v_tenant FROM kv_wastage_fact(p_table, p_id) f;
  IF v_tenant IS NULL THEN RETURN 'not_fact'; END IF;
  INSERT INTO wastage_events (tenant_id, occurred_at, kind, source_kind, source_table, source_id, method_code, recorded_by)
  VALUES (v_tenant, now(), 'other', 'return_accepted', p_table, p_id, p_method, p_by);   -- placeholders: the trigger derives every fact
  RETURN 'written';
END $$;
COMMENT ON FUNCTION kv_wastage_record(text, uuid, text, uuid) IS
  'PC-56 TENANT-SW-f (0202): record the wastage event of one source row, once. Returns written | exists | not_fact. The trigger derives the facts.';

-- Every qualifying source row of one tenant, through the writer. Idempotent: a second run writes nothing and says so.
CREATE OR REPLACE FUNCTION kv_wastage_backfill(p_tenant uuid, p_method text, p_by uuid DEFAULT NULL)
RETURNS TABLE (o_source text, o_written int, o_existing int)
LANGUAGE plpgsql AS $$
DECLARE r record; v text; w int; e int;
BEGIN
  w := 0; e := 0;
  FOR r IN SELECT id FROM returns WHERE tenant_id = p_tenant AND status = 'refunded' ORDER BY id LOOP
    v := kv_wastage_record('returns', r.id, p_method, p_by); IF v = 'written' THEN w := w + 1; ELSIF v = 'exists' THEN e := e + 1; END IF;
  END LOOP;
  o_source := 'returns'; o_written := w; o_existing := e; RETURN NEXT;
  w := 0; e := 0;
  FOR r IN SELECT id FROM milk_quality_reviews WHERE tenant_id = p_tenant AND status = 'rejected' ORDER BY id LOOP
    v := kv_wastage_record('milk_quality_reviews', r.id, p_method, p_by); IF v = 'written' THEN w := w + 1; ELSIF v = 'exists' THEN e := e + 1; END IF;
  END LOOP;
  o_source := 'milk_quality_reviews'; o_written := w; o_existing := e; RETURN NEXT;
  w := 0; e := 0;
  FOR r IN SELECT id FROM disputes WHERE tenant_id = p_tenant AND status = 'resolved' AND opened_via = 'pod_review' ORDER BY id LOOP
    v := kv_wastage_record('disputes', r.id, p_method, p_by); IF v = 'written' THEN w := w + 1; ELSIF v = 'exists' THEN e := e + 1; END IF;
  END LOOP;
  o_source := 'disputes'; o_written := w; o_existing := e; RETURN NEXT;
  w := 0; e := 0;
  FOR r IN SELECT id FROM cold_chain_breaches WHERE tenant_id = p_tenant AND outcome = 'loss_recorded' ORDER BY id LOOP
    v := kv_wastage_record('cold_chain_breaches', r.id, p_method, p_by); IF v = 'written' THEN w := w + 1; ELSIF v = 'exists' THEN e := e + 1; END IF;
  END LOOP;
  o_source := 'cold_chain_breaches'; o_written := w; o_existing := e; RETURN NEXT;
  w := 0; e := 0;
  FOR r IN SELECT id FROM pod_reviews WHERE tenant_id = p_tenant AND status = 'rejected' ORDER BY id LOOP
    v := kv_wastage_record('pod_reviews', r.id, p_method, p_by); IF v = 'written' THEN w := w + 1; ELSIF v = 'exists' THEN e := e + 1; END IF;
  END LOOP;
  o_source := 'pod_reviews'; o_written := w; o_existing := e; RETURN NEXT;
END $$;
COMMENT ON FUNCTION kv_wastage_backfill(uuid, text, uuid) IS
  'PC-56 TENANT-SW-f (0202): record every qualifying source row of one tenant through kv_wastage_record (idempotent). Used by this migration (method backfill), the hourly sweep job (sweep) and the admin re-run (rerun).';

-- THE BACKFILL: every existing loss fact, method_code = 'backfill'. Counted per source in the migration log.
DO $$
DECLARE r record; tot_w int := 0; tot_e int := 0;
BEGIN
  FOR r IN SELECT b.o_source, sum(b.o_written)::int AS w, sum(b.o_existing)::int AS e
             FROM tenants t CROSS JOIN LATERAL kv_wastage_backfill(t.id, 'backfill', NULL) b GROUP BY b.o_source ORDER BY b.o_source LOOP
    RAISE NOTICE '0202 wastage backfill: % written=% existing=%', r.o_source, r.w, r.e;
    tot_w := tot_w + r.w; tot_e := tot_e + r.e;
  END LOOP;
  RAISE NOTICE '0202 wastage backfill: total written=% existing=%', tot_w, tot_e;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 202.3  THE TENANT REPORT STORE
-- ------------------------------------------------------------------------------------------------------------------
-- saved_report_definitions (0120, admin-only until now) opened to tenants: a NULL tenant is a PLATFORM definition (admin-api writes
-- it; a tenant reads it, never writes it); a tenant definition names an ALLOW-LISTED dataset, its dimensions and measures (keys
-- validated in code against the allow-list — never SQL), and a relative range of at most 92 days.
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS dataset_code varchar(60);
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS dimensions text[] NOT NULL DEFAULT '{}';
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS measures text[] NOT NULL DEFAULT '{}';
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS range_days integer;
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);
ALTER TABLE saved_report_definitions ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE saved_report_definitions ALTER COLUMN metric DROP NOT NULL;
ALTER TABLE saved_report_definitions ALTER COLUMN created_by_admin_id DROP NOT NULL;
ALTER TABLE saved_report_definitions DROP CONSTRAINT IF EXISTS ck_srd_realm;
ALTER TABLE saved_report_definitions ADD CONSTRAINT ck_srd_realm CHECK (
     (tenant_id IS NULL AND metric IS NOT NULL AND created_by_admin_id IS NOT NULL)
  OR (tenant_id IS NOT NULL AND dataset_code IS NOT NULL AND created_by_user_id IS NOT NULL AND range_days IS NOT NULL
      AND range_days BETWEEN 1 AND 92 AND cardinality(measures) BETWEEN 1 AND 6 AND cardinality(dimensions) <= 3));
ALTER TABLE saved_report_definitions DROP CONSTRAINT IF EXISTS ck_srd_archive;
ALTER TABLE saved_report_definitions ADD CONSTRAINT ck_srd_archive CHECK (
  tenant_id IS NULL OR (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
  OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND char_length(btrim(coalesce(archive_reason, ''))) >= 10));
-- one live slug per realm: platform slugs unique among platform rows; tenant slugs unique within the tenant
DROP INDEX IF EXISTS uq_srd_slug_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_srd_slug_live_platform ON saved_report_definitions (slug) WHERE tenant_id IS NULL AND archived_at IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_srd_slug_live_tenant ON saved_report_definitions (tenant_id, slug) WHERE tenant_id IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_srd_tenant_feed ON saved_report_definitions (tenant_id, created_at DESC, id DESC) WHERE tenant_id IS NOT NULL;

-- An archived tenant definition stays archived; its dataset is its identity; kv_app never touches a platform row (RLS says so too).
CREATE OR REPLACE FUNCTION trg_srd_tenant_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS NULL AND kv_db_actor() IN ('kv_app', 'kv_relay') THEN
    RAISE EXCEPTION '[PLATFORM_DEFINITION_READ_ONLY] a platform report definition is read-only to a cooperative' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.tenant_id IS NOT NULL THEN
    IF OLD.archived_at IS NOT NULL THEN RAISE EXCEPTION '[REPORT_DEFINITION_ARCHIVED] an archived definition is final' USING ERRCODE = 'P0001'; END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.dataset_code IS DISTINCT FROM OLD.dataset_code OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
      RAISE EXCEPTION '[REPORT_DEFINITION_IDENTITY_FINAL] a definition''s tenant, dataset and author are final' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_srd_moves ON saved_report_definitions;
CREATE TRIGGER trg_srd_moves BEFORE UPDATE ON saved_report_definitions FOR EACH ROW EXECUTE FUNCTION trg_srd_tenant_moves();

CREATE TABLE IF NOT EXISTS report_runs (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  definition_id       uuid REFERENCES saved_report_definitions(id),
  schedule_id         uuid,
  dataset_code        varchar(60) NOT NULL,
  dimensions          text[] NOT NULL DEFAULT '{}',
  measures            text[] NOT NULL,
  from_day            date NOT NULL,
  to_day              date NOT NULL,
  requested_by        uuid NOT NULL REFERENCES users(id),
  status              varchar(10) NOT NULL DEFAULT 'queued',
  row_count           integer,
  export_job_id       uuid,
  statement_ms        integer,
  -- what `current_setting('statement_timeout')` answered INSIDE the run's transaction — the 60 s limit, as observed, not as hoped
  statement_timeout   text,
  watermark           text,
  error_code          varchar(40),
  error_detail        text,
  queued_at           timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rr_status CHECK (status IN ('queued', 'running', 'ready', 'failed', 'refused')),
  -- THE 92-DAY BOUND, a third time (the DTO and the service say RANGE_TOO_WIDE first): inclusive days ≤ 92
  CONSTRAINT ck_rr_range CHECK (to_day >= from_day AND (to_day - from_day) <= 91),
  CONSTRAINT ck_rr_measures CHECK (cardinality(measures) BETWEEN 1 AND 6 AND cardinality(dimensions) <= 3),
  CONSTRAINT ck_rr_ready CHECK (status <> 'ready' OR (row_count IS NOT NULL AND export_job_id IS NOT NULL AND watermark IS NOT NULL AND finished_at IS NOT NULL)),
  CONSTRAINT ck_rr_error CHECK ((status IN ('failed', 'refused')) = (error_code IS NOT NULL)),
  CONSTRAINT ck_rr_row_cap CHECK (row_count IS NULL OR row_count BETWEEN 0 AND 50000)
);
COMMENT ON TABLE report_runs IS
  'PC-56 TENANT-SW-f (0202, DELTA-028): one run of an allow-listed dataset (≤ 92 days, ≤ 50,000 rows, statement timeout 60 s on the primary — no analytics replica is provisioned). The CSV goes to the 6e-2 export plane with a watermark header; every run is audited (report.run).';

CREATE TABLE IF NOT EXISTS report_run_results (
  run_id     uuid PRIMARY KEY REFERENCES report_runs(id),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  header     text[] NOT NULL,
  rows       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rrr_rows CHECK (jsonb_typeof(rows) = 'array')
);
COMMENT ON TABLE report_run_results IS
  'PC-56 TENANT-SW-f (0202): exactly what a run read, frozen inside the run''s own transaction, so the plane''s file is that read and not a second one.';

CREATE TABLE IF NOT EXISTS report_schedules (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  definition_id     uuid NOT NULL REFERENCES saved_report_definitions(id),
  cadence           varchar(8) NOT NULL,
  weekday_iso       smallint,
  month_day         smallint,
  time_ist          time NOT NULL,
  recipient_roles   text[] NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  next_run_at       timestamptz NOT NULL,
  last_run_at       timestamptz,
  last_run_id       uuid,
  created_by        uuid NOT NULL REFERENCES users(id),
  deactivated_by    uuid REFERENCES users(id),
  deactivated_at    timestamptz,
  deactivate_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rs_cadence CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT ck_rs_shape CHECK (
       (cadence = 'daily'   AND weekday_iso IS NULL AND month_day IS NULL)
    OR (cadence = 'weekly'  AND weekday_iso BETWEEN 1 AND 7 AND month_day IS NULL)
    OR (cadence = 'monthly' AND month_day BETWEEN 1 AND 28 AND weekday_iso IS NULL)),
  CONSTRAINT ck_rs_recipients CHECK (cardinality(recipient_roles) BETWEEN 1 AND 5),
  CONSTRAINT ck_rs_deactivated CHECK (active = (deactivated_at IS NULL) AND (deactivated_at IS NULL) = (deactivated_by IS NULL)
    AND (deactivated_at IS NULL OR char_length(btrim(coalesce(deactivate_reason, ''))) >= 10))
);
CREATE OR REPLACE FUNCTION trg_rs_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active = false THEN RAISE EXCEPTION '[REPORT_SCHEDULE_FINAL] a deactivated schedule is final' USING ERRCODE = 'P0001'; END IF;
  IF NEW.definition_id IS DISTINCT FROM OLD.definition_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.cadence IS DISTINCT FROM OLD.cadence
     OR NEW.time_ist IS DISTINCT FROM OLD.time_ist OR NEW.weekday_iso IS DISTINCT FROM OLD.weekday_iso OR NEW.month_day IS DISTINCT FROM OLD.month_day
     OR NEW.recipient_roles IS DISTINCT FROM OLD.recipient_roles THEN
    RAISE EXCEPTION '[REPORT_SCHEDULE_SHAPE_FINAL] a schedule''s definition, cadence, time and recipients are final — deactivate and create another' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rs_moves ON report_schedules;
CREATE TRIGGER trg_rs_moves BEFORE UPDATE ON report_schedules FOR EACH ROW EXECUTE FUNCTION trg_rs_moves();
DROP TRIGGER IF EXISTS report_runs_uat ON report_runs;
CREATE TRIGGER report_runs_uat BEFORE UPDATE ON report_runs FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS report_schedules_uat ON report_schedules;
CREATE TRIGGER report_schedules_uat BEFORE UPDATE ON report_schedules FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ------------------------------------------------------------------------------------------------------------------
-- 202.4  LEARNER INSIGHTS — THE NEW CAPTURE
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_answers (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  enrollment_id    uuid NOT NULL REFERENCES enrollments(id),
  course_id        uuid NOT NULL REFERENCES courses(id),
  lesson_id        uuid NOT NULL REFERENCES course_lessons(id),
  attempt_id       uuid NOT NULL,
  question_no      smallint NOT NULL,
  learner_user_id  uuid NOT NULL REFERENCES users(id),
  chosen           smallint,            -- NULL = left unanswered (no negative marking: counted as not correct)
  correct          boolean NOT NULL,
  answered_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_qa_question CHECK (question_no BETWEEN 1 AND 50),
  CONSTRAINT ck_qa_chosen CHECK (chosen IS NULL OR chosen BETWEEN 0 AND 5),
  CONSTRAINT uq_qa_attempt_question UNIQUE (attempt_id, question_no)
);
CREATE TABLE IF NOT EXISTS watch_events (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  enrollment_id    uuid NOT NULL REFERENCES enrollments(id),
  course_id        uuid NOT NULL REFERENCES courses(id),
  lesson_id        uuid NOT NULL REFERENCES course_lessons(id),
  learner_user_id  uuid NOT NULL REFERENCES users(id),
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz NOT NULL,
  seconds          integer NOT NULL,
  -- client_interval: the app sent the interval it played; progress_delta: the growth of seconds_watched between two progress
  -- reports, placed at the server's clock when it was reported (the method sentence says so)
  source           varchar(16) NOT NULL,
  ist_hour         smallint GENERATED ALWAYS AS ((extract(hour FROM (started_at AT TIME ZONE 'Asia/Kolkata')))::smallint) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_we2_interval CHECK (ended_at > started_at AND seconds BETWEEN 1 AND 86400),
  CONSTRAINT ck_we2_source CHECK (source IN ('client_interval', 'progress_delta'))
);
CREATE OR REPLACE FUNCTION trg_capture_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '[LEARNER_CAPTURE_APPEND_ONLY] captured answers and watch events are never changed or removed' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS trg_qa_append_only ON quiz_answers;
CREATE TRIGGER trg_qa_append_only BEFORE UPDATE OR DELETE ON quiz_answers FOR EACH ROW EXECUTE FUNCTION trg_capture_append_only();
DROP TRIGGER IF EXISTS trg_wev_append_only ON watch_events;
CREATE TRIGGER trg_wev_append_only BEFORE UPDATE OR DELETE ON watch_events FOR EACH ROW EXECUTE FUNCTION trg_capture_append_only();

-- When a capture began — the studio prints "no answers captured yet — capture began <date>" from HERE, not from a constant.
CREATE TABLE IF NOT EXISTS capture_epochs (
  capture    varchar(40) PRIMARY KEY,
  began_at   timestamptz NOT NULL DEFAULT now(),
  note       text NOT NULL
);
INSERT INTO capture_epochs (capture, note) VALUES
  ('learner_quiz_watch', 'PC-56 TENANT-SW-f (0202): per-question quiz answers and lesson watch intervals are captured from the lesson-progress write onward; nothing before this instant exists.')
ON CONFLICT (capture) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 202.5  RLS (the 0175 split) · GRANTS · INDEXES
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wastage_events', 'report_runs', 'report_run_results', 'report_schedules', 'quiz_answers', 'watch_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly, kv_ingest', t);
  END LOOP;
END $$;

-- saved_report_definitions: the split with a READ that includes platform rows (tenant_id IS NULL), writes own-only, kv_admin whole
ALTER TABLE saved_report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_report_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS srd_read ON saved_report_definitions;
DROP POLICY IF EXISTS srd_insert_own ON saved_report_definitions;
DROP POLICY IF EXISTS srd_update_own ON saved_report_definitions;
DROP POLICY IF EXISTS srd_admin_realm ON saved_report_definitions;
CREATE POLICY srd_read ON saved_report_definitions FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY srd_insert_own ON saved_report_definitions FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY srd_update_own ON saved_report_definitions FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY srd_admin_realm ON saved_report_definitions FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON saved_report_definitions FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON saved_report_definitions TO kv_app;
GRANT UPDATE (title, dimensions, measures, range_days, notes, archived_at, archived_by, archive_reason, updated_at, updated_by) ON saved_report_definitions TO kv_app;
GRANT SELECT ON saved_report_definitions TO kv_readonly;

-- wastage_events: INSERT-ONLY for the request tier (no UPDATE, no DELETE — the trigger refuses them for every role as well)
GRANT SELECT, INSERT ON wastage_events TO kv_app;
GRANT EXECUTE ON FUNCTION kv_wastage_fact(text, uuid), kv_wastage_record(text, uuid, text, uuid), kv_wastage_backfill(uuid, text, uuid) TO kv_app;
GRANT SELECT, INSERT ON report_runs TO kv_app;
GRANT UPDATE (status, row_count, export_job_id, statement_ms, statement_timeout, watermark, error_code, error_detail, started_at, finished_at, updated_at) ON report_runs TO kv_app;
GRANT SELECT, INSERT ON report_run_results TO kv_app;
GRANT SELECT, INSERT ON report_schedules TO kv_app;
GRANT UPDATE (active, next_run_at, last_run_at, last_run_id, deactivated_by, deactivated_at, deactivate_reason, updated_at) ON report_schedules TO kv_app;
GRANT SELECT, INSERT ON quiz_answers TO kv_app;
GRANT SELECT, INSERT ON watch_events TO kv_app;
GRANT SELECT ON capture_epochs TO kv_app, kv_readonly;
GRANT SELECT ON wastage_events, report_runs, report_schedules, quiz_answers, watch_events TO kv_readonly;

CREATE INDEX IF NOT EXISTS idx_we_tenant_time ON wastage_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_we_chain ON wastage_events (tenant_id, chain_key) WHERE chain_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rr_tenant_feed ON report_runs (tenant_id, queued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_rr_queued ON report_runs (queued_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_rs_due ON report_schedules (next_run_at) WHERE active;
CREATE INDEX IF NOT EXISTS idx_rs_tenant ON report_schedules (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_qa_lesson ON quiz_answers (tenant_id, lesson_id, question_no);
CREATE INDEX IF NOT EXISTS idx_qa_learner ON quiz_answers (tenant_id, lesson_id, learner_user_id);
CREATE INDEX IF NOT EXISTS idx_wev_lesson ON watch_events (tenant_id, lesson_id, ist_hour);
CREATE INDEX IF NOT EXISTS idx_wev_learner ON watch_events (tenant_id, lesson_id, learner_user_id);
