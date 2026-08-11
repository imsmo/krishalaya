-- ============================================================================
-- MIGRATION 0124 — A MANUAL PRICE GOES STRAIGHT TO A FARMER'S SELLING DECISION (PC-56 ADMIN-SWEEP)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, AND IT IS THE SHARPEST ONE THIS PANEL HAS PRODUCED
-- ---------------------------------------------------------------------------
-- W107 (Mandi Pulse) prints this as a property of the platform:
--
--   "3 price-anomaly holds today: ambassador_manual entries > 20% off modal are quarantined for review before feeding
--    farmer alerts — **bad data never reaches a selling decision**."
--
-- `MandiPriceService.ingest` does this instead, in ONE transaction:
--
--     await this.prices.insert(tx, price);
--     for (const alert of await this.alerts.matchActive(tx, tenantId, price.productId, price.regionId)) {
--       if (!alert.isCrossedBy(price.modalMinor)) continue;
--       await this.outbox.write(tx, { ... MarketEventType.PriceAlertTriggered ... });   // → farmer SMS/push
--     }
--
-- There is no anomaly check anywhere on the path. **An ambassador who types ₹64,200 instead of ₹6,420 sends a
-- "groundnut is above your threshold" alert to every subscribed farmer in that region, in Gujarati, within the same
-- transaction** — and W109's own timeline shows what a farmer does with that alert: "Price alert hit: groundnut above
-- ₹6,300 · alerted in Gujarati, **listed same day**."
--
-- This is not a missing dashboard. It is a farmer selling a crop at the wrong moment because of one typo, and the
-- screen that describes the guard is the only place the guard exists.
--
-- **AND `ai_review_queue.queue_kind` HAS CARRIED A `'price_anomaly'` VALUE SINCE MIGRATION 0013.** The value is real,
-- the console that works that queue is real (web-tenant `/ai-review`, and 0115 widened the CHECK to include it), and
-- `grep -rn "price_anomaly" apps` finds it enqueued by ONE path: AI inference on a subject of type 'price'. Manual
-- ingestion enqueues nothing. Ninth occurrence of a status recording an act no code performs — and the first where the
-- act it records is a safety control on a farmer's income.
--
-- ---------------------------------------------------------------------------
-- WHAT ELSE THIS FILE FIXES, BECAUSE W107 CANNOT BE HONEST WITHOUT IT
-- ---------------------------------------------------------------------------
-- **`mandi_prices` HAS NO `created_at`.** `add_std_columns` was never called on it (`grep -n "add_std_columns('mandi_prices')"`
-- returns nothing), so the table records WHEN A PRICE APPLIES (`price_date`, a DATE) and never when it ARRIVED. W107's
-- "Ingest lag (p95) · 41 min · target < 60 min" therefore had no source at all, and could not be computed to within a
-- day, let alone a minute. One column fixes it — and until this migration the figure was unanswerable rather than
-- wrong, which is worth the distinction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 124.1  THE COLUMNS A QUARANTINE NEEDS
-- ---------------------------------------------------------------------------
ALTER TABLE mandi_prices
  -- When the observation REACHED us, as against the day it describes. Defaulted, so every future insert is stamped
  -- without touching a single call site — and NULL on every existing row, because a backfill from `price_date` would be
  -- a fabricated timestamp on a figure whose whole purpose is measuring promptness.
  ADD COLUMN ingested_at timestamptz DEFAULT now(),
  -- **THE STATE W107 PROMISES.** `accepted` = feeds farmer alerts. `quarantined` = recorded, visible, and feeding
  -- NOTHING until a human decides. `released` = a reviewer judged it correct after all (it feeds alerts from then on).
  -- `rejected` = a reviewer judged it wrong; the row stays for ever because deleting a bad observation destroys the
  -- evidence of how it got in, and because an ambassador's error rate is a real signal about training.
  ADD COLUMN anomaly_state varchar(12) NOT NULL DEFAULT 'accepted'
    CHECK (anomaly_state IN ('accepted', 'quarantined', 'released', 'rejected')),
  -- How far off the reference modal it was, in BASIS POINTS and never a float: 2_000 = 20.00%. The threshold this is
  -- compared against is a platform setting (0121's registry), so a founder can tighten it without a deploy.
  ADD COLUMN deviation_bp integer,
  -- The modal this observation was judged against, so the decision is reproducible months later. Recomputing the
  -- reference at review time would compare today's market to yesterday's typo.
  ADD COLUMN reference_modal_minor bigint,
  ADD COLUMN anomaly_decided_at timestamptz,
  ADD COLUMN anomaly_decided_by_user_id uuid,
  ADD COLUMN anomaly_note varchar(300),
  -- An observation cannot be released or rejected without somebody having done it. Recorded as a CHECK because this is
  -- the one column pair a reviewer's evidence rests on.
  ADD CONSTRAINT ck_mandi_anomaly_decided CHECK (
    anomaly_state IN ('accepted', 'quarantined') OR (anomaly_decided_at IS NOT NULL AND anomaly_decided_by_user_id IS NOT NULL)
  ) NOT VALID;

-- The quarantine worklist: what is held, oldest first, so a review queue is a FIFO rather than a pile.
CREATE INDEX idx_mandi_prices_quarantined ON mandi_prices(price_date DESC, id)
  WHERE anomaly_state = 'quarantined';
-- The ingest-lag query, bounded by the partition key.
CREATE INDEX idx_mandi_prices_ingested ON mandi_prices(price_date, ingested_at)
  WHERE ingested_at IS NOT NULL;

COMMENT ON COLUMN mandi_prices.anomaly_state IS
  'Whether this observation may feed farmer price alerts (0124). Only accepted|released do. A quarantined row is recorded and visible and feeds NOTHING — W107: "bad data never reaches a selling decision", which before this migration was true of no code.';

-- ---------------------------------------------------------------------------
-- 124.2  THE THRESHOLD AS A SETTING, NOT A CONSTANT
-- ---------------------------------------------------------------------------
-- W107 names 20%. A constant in TypeScript would mean that tightening the guard after an incident needs a deploy, and
-- ADMIN-11 built the registry precisely so a value like this is an INSERT. `risk_class = 'security'` because loosening
-- it widens what reaches a farmer unreviewed — so it takes two administrators (0121's rule), which is the correct
-- weight for a control on somebody else's income.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES (
  'market.price_anomaly_threshold_bp', 'int', 'platform', 'security', '2000'::jsonb,
  'How far a manually-reported mandi price may sit from the reference modal before it is quarantined instead of feeding farmer alerts, in basis points (2000 = 20%). W107 states 20%.',
  'Raising this widens what reaches a farmer''s selling decision unreviewed. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- Which sources are trusted enough to skip the gate. **A GOVERNMENT FEED AND A PERSON WITH A PHONE ARE NOT THE SAME
-- RISK**, and a gate that treated them alike would either quarantine the entire agmarknet ingest on a volatile day or
-- wave through every manual entry. Stored as a setting so a founder can add a source without a deploy — and defaulting
-- to the two human-entered ones, which is where a typo comes from.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES (
  'market.price_anomaly_gated_sources', 'json', 'platform', 'security', '["ambassador_manual","platform_txn"]'::jsonb,
  'Price sources whose observations pass through the anomaly gate before they may feed farmer alerts. Government/exchange feeds (agmarknet, enam) are not gated: they are the reference, and gating them would quarantine a whole day''s ingest on a volatile market.',
  'Removing a source from this list lets its prices reach farmers unreviewed. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 124.3  THE QUEUE ROW — reusing the one that already exists
-- ---------------------------------------------------------------------------
-- **NO NEW QUEUE TABLE.** `ai_review_queue` already carries `queue_kind = 'price_anomaly'` (0013, CHECK widened by
-- 0115), already has a working reviewer console in web-tenant, and already has the status machine a decision needs.
-- Adding a second queue would split one worklist across two surfaces — the ADMIN-3c pattern of a delta closed by
-- reading the schema rather than adding to it.
--
-- What it lacks is a way to point at a mandi price: `inference_id` is a bigint FK-by-convention to `ai_inferences`, and
-- a manual observation has no inference. Two nullable columns rather than overloading that one, because a reader who
-- found a price id in `inference_id` would reasonably conclude an AI had produced it.
ALTER TABLE ai_review_queue
  ADD COLUMN subject_kind varchar(30),
  ADD COLUMN subject_bigint_id bigint,
  ADD COLUMN subject_date date;

COMMENT ON COLUMN ai_review_queue.subject_kind IS
  'What this queue row is about when it is NOT an AI inference — ''mandi_price'' (0124). NULL keeps every pre-existing row meaning exactly what it meant.';

-- The queue's own lookup for the price case. Partial, so it costs nothing on the AI rows.
CREATE INDEX idx_ai_queue_price_subject ON ai_review_queue(subject_kind, subject_bigint_id)
  WHERE subject_kind IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 124.4  WHAT A FARMER IS TOLD, AND WHAT THEY ARE NOT
-- ---------------------------------------------------------------------------
-- **NO NOTIFICATION FOR A QUARANTINE, DELIBERATELY.** The farmer never knew about the observation, so telling them "a
-- price we were about to send you turned out to be wrong" would manufacture doubt about the prices that ARE right. The
-- ambassador who reported it is the person who needs to know, and they see it in their own console — the queue row is
-- the record and the reviewer's note is the feedback.
--
-- What DOES get an event is the release: an observation released after review is a price that should have fed alerts,
-- so releasing it re-evaluates the alerts it would have crossed. That is in code (the service), not here.

-- ---------------------------------------------------------------------------
-- 124.5  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO BACKFILL OF `ingested_at`.** Every existing row keeps NULL. Deriving it from `price_date` would put a fabricated
-- arrival time on the exact figure the column exists to measure, and the console shows "not measurable before this
-- release" rather than a number that flatters us.
--
-- NO RE-EVALUATION OF HISTORY. Observations already ingested stay `accepted`, including any that a threshold would have
-- caught: retro-quarantining a price a farmer has already acted on would be a claim that their decision was made on bad
-- data, which this platform cannot know and must not imply. The audit query for a founder who wants to look:
--   SELECT id, price_date, source, modal_minor FROM mandi_prices
--    WHERE source = 'ambassador_manual' AND price_date > now() - interval '90 days';
--
-- NO DEMAND AGGREGATE (W108's DELTA-027), NO DEDICATED INVESTIGATIONS TABLE (W060's DELTA-017), NO APPEALS TABLE
-- (W097's DELTA-024), NO PORTAL SYNC REGISTRY (W077's DELTA-018). All four are named by the canon itself as design-led
-- and all four are recorded as GAP-BACKEND with owners rather than half-built here.
