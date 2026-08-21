-- ==================================================================================================================
-- MIGRATION 0162 — THE TANK: the bulk milk cooler becomes a thing this platform watches (PC-56 TENANT-6d-1 · W170)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
--
-- W170: *"Bulk milk coolers · target 4.0°C (tolerance band to 4.5°C) · IoT temperature stream (cold_chain_logs). Warm
-- milk is money evaporating — alerts fire to the operator's phone before the dairy loses a rupee."*
--
-- **`bmc_units` HAS HAD NO APPLICATION CODE SINCE 0009.** Nothing registers a cooler, nothing reads one except
-- TENANT-6a's counter board — which finds nothing, every time, and prints `no unit` for every centre. And no cold-chain
-- reading has ever been written for a `bmc_unit` subject, so the temperature column W167 draws has never had a source.
--
-- WHAT THE TABLE CANNOT SAY TODAY, all of it on the canon's own screen:
--   • **the tolerance band.** `target_temp_c` alone cannot express *"target 4.0, band to 4.5"*, so every reading is
--     either exactly on target or a breach — and the logistics writer takes its allowed band FROM THE CALLER
--     (`ColdChainService.record`'s DTO), which for a cooler means an IoT stream could declare its own band and never
--     breach. A BMC's band belongs to the BMC.
--   • **how full it is** (*"2,000 L capacity · 41% full"*). `cold_chain_logs` carries temperature and humidity; there
--     is nowhere to put a level. Adding a column to LOGISTICS' table for a dairy need would be the wrong module's
--     schema, so the unit carries its LATEST level with who reported it and when — and the history of levels is named
--     as not built rather than faked from a single value.
--   • **the compressor** (*"compressor healthy"*). No sensor on this platform reports one. So it is an OPERATOR's
--     statement, stamped and attributed, never inferred from a temperature that happens to be falling.
--   • **which sensor is which.** `iot_device_ref` has no uniqueness, so two coolers may claim one sensor and both
--     charts are then wrong in a way nobody can see.
--   • **whether the unit is still there.** No `is_active`: a decommissioned cooler would go on being monitored, and a
--     silent sensor on a cooler that was sold is an alert somebody has to explain every hour.
--
-- AND ONE THING THAT IS NOT THIS MODULE'S FAULT: `cold_chain_logs.subject_type` is a bare `varchar(40)` whose
-- vocabulary lives in a COMMENT (`-- 'shipment','bmc_unit'`). The TypeScript entity has had four values since PC-54
-- (`shipment`, `bmc_unit`, `warehouse_chamber`, `vaccine_box`) and the column accepts anything — so a typo'd
-- subject_type writes readings nothing will ever read, at the temperature of somebody's milk. That is this
-- programme's own defect list (*a vocabulary kept in a SQL comment*), and 162.4 closes it.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 162.1  THE COOLER: a band, a level, a compressor, and an end of life
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE bmc_units
  -- THE BAND. `min_temp_c` is not decoration: milk that FREEZES is damaged milk, and a cooler that overshoots
  -- downwards is as much a fault as one that warms. Both ends are the unit's own, so the reading path cannot be
  -- handed a band by whoever is writing.
  ADD COLUMN IF NOT EXISTS min_temp_c    numeric(4,1) NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS tolerance_c   numeric(3,1) NOT NULL DEFAULT 0.5,

  -- HOW FULL IT IS, latest only. A level is reported by a human or a float sensor; either way the person or device is
  -- recorded, because *"41% full"* on a screen that decides whether to divert 87 farmers' evening milk must be
  -- attributable. A time SERIES of levels is deliberately not built (see the header).
  ADD COLUMN IF NOT EXISTS volume_litres numeric(10,2),
  ADD COLUMN IF NOT EXISTS volume_at     timestamptz,
  ADD COLUMN IF NOT EXISTS volume_by     uuid REFERENCES users(id),

  -- THE COMPRESSOR, as somebody's statement. `unknown` is the honest default and the one the screen will mostly show:
  -- nothing on this platform senses a compressor, and a screen that prints "healthy" because the milk is cold would be
  -- guessing about the machine from the symptom.
  ADD COLUMN IF NOT EXISTS compressor_state    varchar(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS compressor_state_at timestamptz,
  ADD COLUMN IF NOT EXISTS compressor_state_by uuid REFERENCES users(id),

  -- THE UNIT'S OWN IDENTITY, so a cooler on a delivery note can be matched to a cooler on a screen.
  ADD COLUMN IF NOT EXISTS model         varchar(100),
  ADD COLUMN IF NOT EXISTS serial_no     varchar(100),

  -- END OF LIFE. A cooler that has gone must stop being watched, and must not vanish from the history of the milk it
  -- kept cold, which is why this is a flag and a stamp rather than a DELETE.
  ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS retired_at    timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by    uuid REFERENCES users(id);

-- The band has to be a band: a target below the floor is not a configuration, it is a typo that would make every
-- reading a breach at 312 families' expense.
ALTER TABLE bmc_units DROP CONSTRAINT IF EXISTS ck_bmc_band;
ALTER TABLE bmc_units ADD CONSTRAINT ck_bmc_band CHECK (
  target_temp_c >= min_temp_c
  AND target_temp_c BETWEEN -2.0 AND 15.0
  AND min_temp_c BETWEEN -5.0 AND 10.0
  AND tolerance_c BETWEEN 0.0 AND 5.0);

ALTER TABLE bmc_units DROP CONSTRAINT IF EXISTS ck_bmc_capacity;
ALTER TABLE bmc_units ADD CONSTRAINT ck_bmc_capacity CHECK (capacity_litres > 0);

-- A level that exceeds the tank is a bad reading, not a full tank; and a level with no time or no reporter is a number
-- nobody can stand behind.
ALTER TABLE bmc_units DROP CONSTRAINT IF EXISTS ck_bmc_volume;
ALTER TABLE bmc_units ADD CONSTRAINT ck_bmc_volume CHECK (
  volume_litres IS NULL
  OR (volume_litres >= 0 AND volume_litres <= capacity_litres AND volume_at IS NOT NULL));

ALTER TABLE bmc_units DROP CONSTRAINT IF EXISTS ck_bmc_compressor;
ALTER TABLE bmc_units ADD CONSTRAINT ck_bmc_compressor CHECK (
  compressor_state IN ('healthy', 'attention', 'unknown')
  -- A stated condition carries WHO stated it and WHEN; `unknown` is the only one that may stand alone, because it is
  -- the absence of a statement rather than one.
  AND ((compressor_state = 'unknown') OR (compressor_state_at IS NOT NULL AND compressor_state_by IS NOT NULL)));

ALTER TABLE bmc_units DROP CONSTRAINT IF EXISTS ck_bmc_retired;
ALTER TABLE bmc_units ADD CONSTRAINT ck_bmc_retired CHECK (
  (is_active = true AND retired_at IS NULL AND retired_by IS NULL)
  OR (is_active = false AND retired_at IS NOT NULL AND retired_by IS NOT NULL));

-- ONE SENSOR, ONE COOLER. A partial unique index, not a table constraint: `iot_device_ref` is nullable (a cooler with
-- no telemetry is a real cooler, read by hand), and NULLs must stay distinct — which is exactly the trap TENANT-6c-4
-- found costing this platform 139 duplicated lookup values. Scoped per tenant, and ignoring soft-deleted rows so a
-- replaced unit's old sensor can be re-registered on the new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bmc_device_ref
  ON bmc_units (tenant_id, iot_device_ref)
  WHERE iot_device_ref IS NOT NULL AND deleted_at IS NULL;

-- The monitor's own read: this tenant's live coolers, by centre.
CREATE INDEX IF NOT EXISTS idx_bmc_active
  ON bmc_units (tenant_id, mcc_id)
  WHERE is_active = true AND deleted_at IS NULL;

COMMENT ON COLUMN bmc_units.tolerance_c IS
  'PC-56 TENANT-6d-1. The band ABOVE target this cooler is still in range for - W170: "target 4.0C (tolerance band to '
  '4.5C)". The reading path computes is_breach from (min_temp_c, target_temp_c + tolerance_c) READ FROM THIS ROW, '
  'never from a band supplied by whoever is writing the reading.';
COMMENT ON COLUMN bmc_units.volume_litres IS
  'PC-56 TENANT-6d-1. The LATEST level only, with volume_at and volume_by. W170 prints "41% full"; a history of levels '
  'is not built - cold_chain_logs carries temperature and humidity, and adding a level column to the LOGISTICS table '
  'for a dairy need would be the wrong module''s schema.';
COMMENT ON COLUMN bmc_units.compressor_state IS
  'PC-56 TENANT-6d-1. An OPERATOR''S STATEMENT, stamped and attributed - nothing on this platform senses a compressor. '
  'Defaults to `unknown`, which is what the monitor shows until somebody says otherwise: printing "healthy" because '
  'the milk happens to be cold would be guessing about the machine from its symptom.';

-- ------------------------------------------------------------------------------------------------------------------
-- 162.2  THE NUMBERS THE PLAYBOOK TURNS ON (Law 6 - a tenant controls these, not this file)
-- ------------------------------------------------------------------------------------------------------------------
-- W170's playbook: *"If >= 7.5°C by 16:00 -> divert evening shift to Bhesan"*, *"If >= 8°C -> dairy-union pickup
-- advanced; batch tested before pooling"*. Those two numbers decide whether 87 families walk to a different village,
-- so they are a cooperative's decision and not a constant in a read-model. Stored in DECI-DEGREES as integers, because
-- 7.5 is a float and this codebase does not put a float anywhere a decision hangs on it.
--
-- `risk_class = 'ordinary'` and not `money_path` (0121's vocabulary is ordinary | money_path | security): changing one
-- of these numbers moves no money and posts no ledger entry - it changes what a HUMAN is told to do about a tank. The
-- consequence can still be a fortnight of milk, so the settings are audited like every other tenant setting and the
-- monitor prints the tenant's own values rather than a constant.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.bmc_divert_temp_decic', 'int', 'tenant', 'ordinary', '75'::jsonb,
       'PC-56 TENANT-6d-1. Tenths of a degree C at or above which this cooler''s next shift should be DIVERTED to '
       'another centre - W170: "If >= 7.5C by 16:00 -> divert evening shift to Bhesan (route notice to 87 pourers, '
       'Gujarati voice)". The monitor states the step; the diversion itself is a human act with no surface yet.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.bmc_divert_temp_decic');

INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.bmc_condemn_temp_decic', 'int', 'tenant', 'ordinary', '80'::jsonb,
       'PC-56 TENANT-6d-1. Tenths of a degree C at or above which the tank''s milk must be TESTED BEFORE POOLING - '
       'W170: "one warm tank never spoils a tanker". Above the divert threshold by construction (the monitor refuses '
       'to order the two steps the other way round).'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.bmc_condemn_temp_decic');

-- W170: *"operator called automatically after 15 min silence"*. Fifteen MINUTES, and this is the number PC-55's
-- alerting cannot express: `ops_alert_rules` kind `device_silent` validates `silentHours` as an integer 1..720, and
-- its evidence query floors the gap to whole hours - so a fifteen-minute silence is `silent_hours = 0` and no rule can
-- ever fire on it. The setting is recorded here because the monitor CAN say the gap out loud on the screen; the
-- automatic call it names is TENANT-6d-2's, and 162.5 says so.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.bmc_silence_minutes', 'int', 'tenant', 'ordinary', '15'::jsonb,
       'PC-56 TENANT-6d-1. Minutes of sensor silence after which this cooler''s reading is treated as a TELEMETRY GAP '
       'rather than a temperature - W170: "sensors buffer locally; a gap is a connectivity issue, not a temperature '
       'unknown - operator called automatically after 15 min silence". The monitor shows the gap. The automatic call '
       'cannot be built on `ops_alert_rules` as it stands: kind `device_silent` takes silentHours (integer, 1..720).'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.bmc_silence_minutes');

-- ------------------------------------------------------------------------------------------------------------------
-- 162.3  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_bmc_monitor',
   'PC-56 TENANT-6d-1 (W170): the BMC monitor - register bulk milk coolers under an MCC, write their temperature into '
   'cold_chain_logs with the band read from the unit, and show the last hours of every tank beside the playbook. OFF '
   'means the dairy sub-nav''s BMC entry stays unbuilt and the counter board keeps printing `no unit`, which is where '
   'TENANT-6a left it. Nothing about the counter, the cycle or a member''s money depends on this flag.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 162.4  THE VOCABULARY THAT LIVED IN A COMMENT
-- ------------------------------------------------------------------------------------------------------------------
-- `cold_chain_logs.subject_type` is what says whose temperature this is. Four values have been legal in the
-- TypeScript entity since PC-54 and the COLUMN has accepted any string, so a typo writes a reading nothing reads -
-- silently, at the temperature of somebody's milk. Aligned with `COLD_CHAIN_SUBJECTS` and validated against the rows
-- already there (a partitioned table: the constraint is added on the parent, which validates every partition).
--
-- If this fails on your database, a subject type outside the four exists and MUST be looked at rather than allowed:
-- the reading belongs to something, and nobody can say what.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT subject_type, ', ') INTO bad
    FROM cold_chain_logs
   WHERE subject_type NOT IN ('shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'cold_chain_logs holds unknown subject_type(s): % - a temperature reading whose subject nobody can name. Fix the data, then re-run.', bad;
  END IF;
END $$;

ALTER TABLE cold_chain_logs DROP CONSTRAINT IF EXISTS ck_cold_chain_subject;
ALTER TABLE cold_chain_logs ADD CONSTRAINT ck_cold_chain_subject
  CHECK (subject_type IN ('shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box'));

COMMENT ON COLUMN cold_chain_logs.subject_type IS
  'shipment | bmc_unit | warehouse_chamber | vaccine_box. PC-56 TENANT-6d-1 moved this vocabulary out of a SQL comment '
  'and into ck_cold_chain_subject: it matches COLD_CHAIN_SUBJECTS in modules/logistics/domain/cold-chain-log.entity.ts, '
  'and a value outside it wrote readings that nothing would ever read.';

-- ------------------------------------------------------------------------------------------------------------------
-- 162.5  WHAT THIS MIGRATION DOES **NOT** DO, named so nobody has to rediscover it
-- ------------------------------------------------------------------------------------------------------------------
-- 1. **THE 15-MINUTE CALL.** `ops_alert_rules` (0086) has exactly the right shape - a kind, a threshold, recipients, a
--    cooldown, a severity - and `device_silent` measures in WHOLE HOURS (silentHours 1..720, floored from the gap), so
--    the fifteen minutes W170 promises cannot be expressed by any rule a tenant could write. Changing that unit is a
--    change to the platform's fleet alerting, evaluated for reefers and vaccine boxes as well as tanks, and it belongs
--    with the wave that owns the centres' operators (TENANT-6d-2) rather than smuggled in beside a schema change.
-- 2. **A HISTORY OF LEVELS.** See 162.1: the tank's latest level is on the unit, and a series would need a home in
--    logistics' own telemetry table.
-- 3. **A DIVERSION.** *"Divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"* is an act on
--    memberships and a broadcast to their phones. The monitor states the step and names who is affected; performing it
--    is W171's territory, where a membership's centre can actually be changed.
-- 4. **A COMPRESSOR SENSOR.** 162.1 records a human's statement. Nothing on this platform reads a machine.

-- ------------------------------------------------------------------------------------------------------------------
-- 162.6  THE ALERT THAT REACHED NOBODY, AND THE SEED THAT DUPLICATED ITSELF
-- ------------------------------------------------------------------------------------------------------------------
-- W170's promise is a phone ringing: *"alerts fire to the operator's phone before the dairy loses a rupee"*. Following
-- that promise down found TWO defects, neither of them in the dairy module:
--
-- **1. THE SMS LEG OF EVERY OPS ALERT HAS FAILED SINCE PC-55.** 0086 catalogued `ops.alert_fired` properly and seeded
--    `push` and `inapp` templates in three languages, with `default_channels = ["push","sms"]` - and no SMS template was
--    ever written. `NotificationService.deliver` resolves per channel and, finding none, records `no_template` and sends
--    nothing (fail-closed, by design). So every cold-chain breach, silent sensor and overdue machine since A6 produced a
--    push to whoever had the app and a FAILED SMS row - and a dairy operator in a village has a feature phone. The three
--    SMS templates are seeded in db/seeds/core/0007 by this wave. (The first draft of this migration claimed the event
--    was never catalogued at all; the live run proved otherwise, and the claim is corrected rather than deleted.)
--
-- **2. THE PLATFORM'S NOTIFICATION TEMPLATES DUPLICATE ON EVERY RE-RUN OF THE SEED.** The unique key is
--    (event_code, channel, language_code, tenant_id) and every platform row has `tenant_id IS NULL` — so
--    `ON CONFLICT (…, tenant_id) DO NOTHING` inferred an index that NULLs can never conflict on. Re-running 0007 took
--    176 platform templates to 277, doubling 98 of them; and `NotificationTemplateRepository.resolve` ends
--    `ORDER BY t.tenant_id NULLS LAST LIMIT 1`, so WHICH of the duplicates says the words a farmer reads was
--    undefined. Second instance of the trap TENANT-6c-4 found costing 139 duplicated lookup values.
--
-- De-duplicated keeping the EARLIEST row per (event_code, channel, language_code) — the one whose id other rows may
-- already reference — and then made impossible by a partial unique index. The seed statements move to an untargeted
-- `ON CONFLICT DO NOTHING`, which is idempotent against this index as well as the four-column one.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY event_code, channel, language_code
           ORDER BY created_at, id) AS rn
    FROM notification_templates
   WHERE tenant_id IS NULL AND deleted_at IS NULL
)
DELETE FROM notification_templates t
 USING ranked r
 WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_platform
  ON notification_templates (event_code, channel, language_code)
  WHERE tenant_id IS NULL AND deleted_at IS NULL;

COMMENT ON INDEX uq_notification_templates_platform IS
  'PC-56 TENANT-6d-1. One PLATFORM template per (event, channel, language). The table''s own unique key includes '
  'tenant_id, which is NULL for every platform row - so it constrained nothing and the seed duplicated itself on every '
  're-run, leaving resolve() to pick between identical-priority rows in undefined order.';
