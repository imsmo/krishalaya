-- ==================================================================================================================
-- 0176 · PC-56 TENANT-8b · THE INBOX — W204 (notifications), W431 (notification center), W432 (the bell, a pattern
--        page), W433 (preference matrix + quiet hours), W434 (one notification's per-channel delivery ladder)
--        + the notification-form (W2683–W2686), notification-mutate (W2687–W2689) and notifications-mutate
--        (W2690–W2692) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- ==================================================================================================================
--
-- W204: *"Statuses are the real machine: queued → sent → delivered / failed → read (or suppressed by quiet
--        hours/preferences)"* · *"suppressed 214 — quiet hours + promo opt-outs — respected, not lost"*.
-- W432: *"During quiet hours … those items sit at queued in the outbox and appear the moment the window opens; nothing
--        was silently dropped."*
-- W434: *"not sent — channel off in your preferences at send time"* · *"no explicit foreign key groups the 5
--        channel-rows of ONE logical send"*.
--
-- WHAT THE WAVE IS DECLARED AS (TENANT-8's survey, §3):
--   F-4  · `suppressed` was a status NO CODE WROTE: a quiet-hours or opted-out channel was a metric increment and
--          nothing else, so W204's count, W432's "appear the moment the window opens" and W434's "channel off at send
--          time" were three sentences about rows that did not exist. Quiet-hours items were DROPPED, never held.
--   F-5  · A user who never set quiet hours was NEVER quiet: 0012's 21:00/06:00 defaults apply only to a row that
--          exists, and no row is created at signup.
--   F-6  · `user_quiet_hours.timezone` was free text (≤40); `Asia/Kolkatta` throws `RangeError` inside
--          `Intl.DateTimeFormat`, which runs per recipient INSIDE the relay's per-event transaction — one member's typo
--          failed the whole fan-out (the 6d-8 village notice included) and the relay retried it for ever.
--   F-9  · The bell listed every CHANNEL row: one event on inapp + push + sms appeared three times.
--   F-10 · The delivery webhook accepted `failed` and discarded it (`applied: true`, row left `sent`); `markDelivered`
--          set no time; there was no failure-reason column, so `no_template`, `no_address`, `no_device` were unreadable
--          from the log.
--   F-3 (note) · `notifications` carried the same `tenant_id IS NULL OR …` ALL-command policy with no WITH CHECK that
--          8a split on `notification_templates` (0175). This file copies that split.
--
-- WHAT THIS FILE BUILDS
--   176.1  The wall on `notifications` (parent AND every partition): SELECT admits a platform (NULL-tenant) row; INSERT
--          and UPDATE admit only the current tenant's row (USING + WITH CHECK); the platform row is writable only by a
--          connection that carries NO tenant at all (the HMAC-verified delivery sink, which runs with no tenant when the
--          provider names none) or by the member the row belongs to (their own read state) — never by a tenant on
--          somebody else's behalf; the admin realm named.
--   176.2  The delivery log learns what it was missing: `delivered_at`, `failed_at`, `failure_reason` (a code from the
--          `notification_failure_reason` vocabulary — Law 6, validated by trigger, never free text), `suppressed_reason`
--          (quiet_hours | channel_off | routine_collapsed | opted_out), `held_until` / `released_at` (a quiet-hours hold
--          and its release) and `fanout_key` (one per event × recipient: the first-class "delivery instance" W434 flags
--          as missing). Columns are added nullable FIRST, existing rows are backfilled, THEN the CHECKs go on.
--   176.3  kv_app's UPDATE is re-narrowed to the delivery columns it writes (REVOKE before GRANT; `batched_into` is
--          dropped — the digest is refused by name and nothing writes it), and re-synced onto every partition.
--   176.4  Quiet hours: the TENANT's default window as a setting (`notification.quiet_hours_default`, 21:00–06:00 —
--          0012's own column defaults, which are the only window this platform has ever written down; not W433's
--          22:00–07:00 UI prefill and not W429's 21:00–08:00), applied in the TENANT's zone (`countries.timezone`, 7c's
--          resolution) to a member with no row; `user_quiet_hours.timezone` must name a zone the database knows
--          (`pg_timezone_names`, by trigger — reject at write) and loses its `'Asia/Kolkata'` literal default (F-22).
--          The read side sanitises in code (F-6: a bad row already on disk degrades to the tenant's zone, never throws).
--   176.5  The release of held rows is a registered cadence job (6c-1's pattern, apps/api ScheduledJobsRunner). Its
--          emergency stop is a KILL-SWITCH flag (0121's tier): `notification.held_release_kill_switch`, OFF — a hold
--          that nothing releases is the drop F-4 names, so the release runs unless someone fires the switch.
--   176.6  The inbox's own retention bound: the delivery log's `data_retention_policies` row (6 months, delete — 0150)
--          is the window every inbox read is pruned to; ensured here so the read can rely on it.
--
-- NAMED, NOT BUILT (refused by name in the API and on the pages): the digest (`batched_into` — no job, no grouping;
--   W204's "Digest engine", W433's "Digest frequency"), collapse threads (`collapse_key` — no column; W431's "Hide
--   thread"), archive (W431's bulk "Archive"), channel master switches (W433), a one-night quiet-hours suspension
--   (W433), the tenant "center disabled" switch (W431/W432), an auto-retry poller (W204's "38 recovered", W434's retry
--   ladder — a retry would reuse the SAME deterministic row id, so attempts have nowhere to live), and SMS cost in ₹
--   (`cost_minor` has no currency column).
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION.
--   `notifications` is RANGE-partitioned by `created_at` (0012) and every partition carries its own copy of 0014's
--   auto-policy (`tenant_isolation_<partition>`), because a partition is a table a role can name directly. Queries
--   through the parent are judged by the parent's policies; a statement naming a partition is judged by that
--   partition's. Both are replaced, so the wall is the same whichever name a statement uses:
--     notif_read            FOR SELECT  USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
--     notif_insert_own      FOR INSERT  WITH CHECK (tenant_id = current_tenant_id())
--     notif_update_own      FOR UPDATE  USING + WITH CHECK (tenant_id = current_tenant_id())
--     notif_update_sink     FOR UPDATE  USING + WITH CHECK (tenant_id IS NULL AND current_tenant_id() IS NULL)
--     notif_update_own_platform_item  FOR UPDATE  USING + WITH CHECK (tenant_id IS NULL AND user_id = current_user_id())
--                           — a member marks THEIR OWN platform notice read (mark-read / mark-all-read run with
--                           app.user_id set by the unit of work); no tenant can touch anybody else's platform row
--     notif_admin_realm     FOR ALL TO kv_admin (named — live `rolbypassrls` for kv_admin is `f`, 0175's reasoning)
--   No DELETE policy: kv_app holds no DELETE (0014:161); retention deletes run as the archive script's role.
--   The fan-out runs on the relay's kv_relay pool (BYPASSRLS, 0018) and on cadence jobs that set `app.tenant_id` per row
--   (moderation / platform-reply notices) — both write `tenant_id = the tenant they set`, which these policies admit.
--   ENABLE + FORCE are restated on the parent and every partition.
--
-- PARTITION NOTE (Law 8). Every read this wave adds is bounded on `created_at`: the inbox and the bell by the retention
--   window (176.6), the ladder by the clicked row's own `created_at` (the page carries it), the held-row release by a
--   seven-day look-back, the webhook lookup by a seven-day look-back, the tenant health tiles by 24 hours. Notification
--   ids are DERIVED (sha256 of dedupe key × user × channel, version 8 — `deriveId`), not v7, so `uuid_v7_time(id)` cannot
--   prune them; `created_at` is the only pruning key and every new index below leads with or contains it.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 176.1 · THE WALL ON notifications — parent and every partition
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r record; p record;
BEGIN
  FOR r IN
    SELECT 'notifications'::text AS rel
    UNION ALL
    SELECT c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'notifications'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.rel);
    FOR p IN SELECT polname FROM pg_policy WHERE polrelid = r.rel::regclass LOOP
      EXECUTE format('DROP POLICY %I ON %I', p.polname, r.rel);
    END LOOP;
    EXECUTE format('CREATE POLICY notif_read ON %I FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY notif_insert_own ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY notif_update_own ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY notif_update_sink ON %I FOR UPDATE USING (tenant_id IS NULL AND current_tenant_id() IS NULL) WITH CHECK (tenant_id IS NULL AND current_tenant_id() IS NULL)', r.rel);
    EXECUTE format('CREATE POLICY notif_update_own_platform_item ON %I FOR UPDATE USING (tenant_id IS NULL AND user_id = current_user_id()) WITH CHECK (tenant_id IS NULL AND user_id = current_user_id())', r.rel);
    EXECUTE format('CREATE POLICY notif_admin_realm ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', r.rel);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 176.2 · WHAT THE DELIVERY LOG WAS MISSING — widen first, backfill, then constrain
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN delivered_at      timestamptz,
  ADD COLUMN failed_at         timestamptz,
  ADD COLUMN failure_reason    varchar(40),
  ADD COLUMN suppressed_reason varchar(20),
  ADD COLUMN held_until        timestamptz,
  ADD COLUMN released_at       timestamptz,
  ADD COLUMN fanout_key        varchar(64);

COMMENT ON COLUMN notifications.delivered_at IS
  'PC-56 TENANT-8b (F-10). When the provider''s delivery receipt said delivered (the webhook, sent → delivered). NULL on a delivered row means it was delivered before 0176 recorded the time — never a guess. In-app rows are never delivered: they are written sent (the row IS the item) and become read.';
COMMENT ON COLUMN notifications.failed_at IS
  'PC-56 TENANT-8b (F-10). When this channel failed — at the fan-out (no template / no address / no device / the notifier refused) or when the provider''s receipt said failed. Backfilled from sent_at, else created_at, for rows that failed before 0176.';
COMMENT ON COLUMN notifications.failure_reason IS
  'PC-56 TENANT-8b (F-10, Law 6). A CODE from the notification_failure_reason vocabulary (lookup_values, platform rows) — validated by trg_notif_failure_reason, never the provider''s free text (that rides the outbox event). `unrecorded` = failed before 0176 kept a reason.';
COMMENT ON COLUMN notifications.suppressed_reason IS
  'PC-56 TENANT-8b (F-4). Why this channel was NOT sent: quiet_hours (held until held_until, then released by the cadence job — the row then carries its final status and keeps this reason as history), opted_out (the member switched this event × channel off), routine_collapsed (the decided one-primary-channel rule, G0-4, flag notification_routine_single_channel), channel_off (reserved for a channel master switch — W433''s, refused by name in 8b; written by nothing until it exists).';
COMMENT ON COLUMN notifications.held_until IS
  'PC-56 TENANT-8b (F-4/F-5). For a quiet_hours suppression: the instant the member''s window ends (their own window in their zone, else the tenant''s default in the tenant''s zone). The release job sends the row at or after this instant.';
COMMENT ON COLUMN notifications.released_at IS
  'PC-56 TENANT-8b. When the release job took this held row out of quiet hours (suppressed → queued, then sent/failed in the same transaction).';
COMMENT ON COLUMN notifications.fanout_key IS
  'PC-56 TENANT-8b. One value per (event delivery × recipient): sha256(dedupe key | user id). Every channel row of ONE logical send shares it, so W434''s ladder and the inbox''s grouping are a lookup, not created_at proximity. NULL on rows written before 0176.';

-- The vocabulary (Law 6). In the migration, not a seed: the backfill below and the trigger depend on it, and a seed can
-- be skipped where a migration cannot (0112's reasoning).
INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
VALUES ('notification_failure_reason', 'Why a notification channel was not delivered', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT 'notification_failure_reason', NULL, v.code, v.name, v.meta::jsonb, v.ord
  FROM (VALUES
    ('no_template',             'No approved wording exists for this event, channel and language', '{"stage":"fanout"}', 1),
    ('no_address',              'The member has no address on this channel (no email / no phone)', '{"stage":"fanout"}', 2),
    ('no_device',               'The member has no registered device for push', '{"stage":"fanout"}', 3),
    ('no_tokens',               'The push sender received no device tokens', '{"stage":"fanout"}', 4),
    ('push_failed',             'The push sender did not accept the message', '{"stage":"fanout"}', 5),
    ('push_unavailable',        'The push service was unavailable', '{"stage":"fanout"}', 6),
    ('notifier_not_configured', 'No notifier is configured for this environment', '{"stage":"fanout"}', 7),
    ('notifier_unavailable',    'The notifier was unavailable', '{"stage":"fanout"}', 8),
    ('dispatch_failed',         'The notifier refused the message without a reason', '{"stage":"fanout"}', 9),
    ('provider_rejected',       'The provider rejected the message (its own words are on the event, not here)', '{"stage":"provider"}', 10),
    ('dnd_registered',          'The number is on the do-not-disturb register', '{"stage":"provider"}', 11),
    ('invalid_number',          'The number is not valid on this channel', '{"stage":"provider"}', 12),
    ('unreachable',             'The device or number could not be reached', '{"stage":"provider"}', 13),
    ('expired',                 'The provider gave up before the message was delivered', '{"stage":"provider"}', 14),
    ('unrecorded',              'Failed before the delivery log recorded reasons (0176)', '{"stage":"legacy"}', 99)
  ) AS v(code, name, meta, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values l
                    WHERE l.type_code = 'notification_failure_reason' AND l.tenant_id IS NULL AND l.code = v.code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_notif_failure_platform
  ON lookup_values (code) WHERE type_code = 'notification_failure_reason' AND tenant_id IS NULL;

-- Backfill BEFORE the checks: a row that failed before this file has a status and no reason. It is told so, never given
-- a guessed one.
UPDATE notifications
   SET failure_reason = 'unrecorded', failed_at = COALESCE(sent_at, created_at)
 WHERE status = 'failed' AND failure_reason IS NULL;

ALTER TABLE notifications
  ADD CONSTRAINT ck_notif_suppressed_reason CHECK (
    suppressed_reason IS NULL OR suppressed_reason IN ('quiet_hours', 'channel_off', 'routine_collapsed', 'opted_out')),
  -- A suppressed row says why. A row that carries a reason and is no longer suppressed was a quiet-hours HOLD that the
  -- release job let go — and says when.
  ADD CONSTRAINT ck_notif_suppressed_says_why CHECK (status <> 'suppressed' OR suppressed_reason IS NOT NULL),
  ADD CONSTRAINT ck_notif_released_hold CHECK (
    suppressed_reason IS NULL OR status = 'suppressed' OR (suppressed_reason = 'quiet_hours' AND released_at IS NOT NULL)),
  ADD CONSTRAINT ck_notif_hold_is_quiet CHECK (held_until IS NULL OR suppressed_reason = 'quiet_hours'),
  ADD CONSTRAINT ck_notif_quiet_has_hold CHECK (suppressed_reason IS DISTINCT FROM 'quiet_hours' OR held_until IS NOT NULL),
  ADD CONSTRAINT ck_notif_release_after_hold CHECK (released_at IS NULL OR held_until IS NOT NULL),
  ADD CONSTRAINT ck_notif_failed_says_why CHECK (status <> 'failed' OR (failure_reason IS NOT NULL AND failed_at IS NOT NULL)),
  ADD CONSTRAINT ck_notif_delivered_time CHECK (delivered_at IS NULL OR status IN ('delivered', 'read')),
  ADD CONSTRAINT ck_notif_fanout_key CHECK (fanout_key IS NULL OR fanout_key ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION notif_failure_reason_known() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lookup_values
                  WHERE type_code = 'notification_failure_reason' AND tenant_id IS NULL
                    AND code = NEW.failure_reason AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'notifications.failure_reason % is not in the notification_failure_reason vocabulary', NEW.failure_reason
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_notif_failure_reason
  BEFORE INSERT OR UPDATE OF failure_reason ON notifications
  FOR EACH ROW WHEN (NEW.failure_reason IS NOT NULL)
  EXECUTE FUNCTION notif_failure_reason_known();

-- The reads this wave adds, each pruned on created_at.
CREATE INDEX idx_notif_inbox ON notifications (user_id, created_at DESC, id DESC) WHERE channel = 'inapp';
CREATE INDEX idx_notif_unread ON notifications (user_id, created_at DESC) WHERE channel = 'inapp' AND read_at IS NULL;
CREATE INDEX idx_notif_fanout ON notifications (user_id, fanout_key, created_at) WHERE fanout_key IS NOT NULL;
CREATE INDEX idx_notif_held ON notifications (held_until, created_at) WHERE status = 'suppressed' AND suppressed_reason = 'quiet_hours';
CREATE INDEX idx_notif_provider_ref ON notifications (provider_msg_ref, created_at DESC) WHERE provider_msg_ref IS NOT NULL;
CREATE INDEX idx_notif_tenant_created ON notifications (tenant_id, created_at DESC);

-- ------------------------------------------------------------------------------------------------------------------
-- 176.3 · kv_app's UPDATE, re-narrowed — REVOKE before the narrow GRANT, then onto every partition
-- ------------------------------------------------------------------------------------------------------------------
REVOKE UPDATE ON notifications FROM kv_app;
GRANT UPDATE (status, sent_at, read_at, provider_msg_ref, cost_minor, delivered_at, failed_at, failure_reason)
  ON notifications TO kv_app;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT ch.relname FROM pg_inherits i JOIN pg_class ch ON ch.oid = i.inhrelid
            WHERE i.inhparent = 'notifications'::regclass LOOP
    CALL sync_partition_privileges('notifications', c.relname);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 176.4 · QUIET HOURS — the tenant's default window, a zone from the registry, no literal zone
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, default_value, description)
SELECT 'notification.quiet_hours_default', 'json', 'tenant', '{"starts":"21:00","ends":"06:00"}'::jsonb,
       'PC-56 TENANT-8b (F-5). The quiet window a member who never set their own receives, in the cooperative''s own zone (countries.timezone via tenants.country_code). 21:00–06:00 is 0012''s user_quiet_hours column default — the only window this platform ever wrote down. Push, SMS, WhatsApp and IVR for non-critical events are HELD during it and released when it ends; in-app and email are never held; critical events ignore it. starts = ends switches the default off for the cooperative.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'notification.quiet_hours_default');

-- F-22: a row inserted without a zone used to be stamped 'Asia/Kolkata' for every country on the platform.
ALTER TABLE user_quiet_hours ALTER COLUMN timezone DROP DEFAULT;
COMMENT ON COLUMN user_quiet_hours.timezone IS
  'PC-56 TENANT-8b (F-6). An IANA zone the database knows (pg_timezone_names), checked by trg_uqh_timezone_known at write. The API proposes the cooperative''s zone; there is no literal default. A row written before 0176 with an unknown zone is SANITISED at read (the fan-out uses the tenant''s zone and logs it) — it can no longer throw inside a fan-out.';

CREATE OR REPLACE FUNCTION uqh_timezone_known() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'user_quiet_hours.timezone % is not a known time zone', NEW.timezone USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_uqh_timezone_known
  BEFORE INSERT OR UPDATE OF timezone ON user_quiet_hours
  FOR EACH ROW EXECUTE FUNCTION uqh_timezone_known();

-- ------------------------------------------------------------------------------------------------------------------
-- 176.5 · THE RELEASE'S EMERGENCY STOP (0121's kill_switch tier: ON = stop)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, tier)
SELECT 'notification.held_release_kill_switch',
       'PC-56 TENANT-8b. Emergency stop for the quiet-hours release job (notification-held-release). OFF (the default) = held push/SMS/WhatsApp/IVR rows are sent when the member''s quiet window ends. ON = held rows stay held (recorded, never sent) until it is turned off; nothing is dropped. A hold nothing releases is the silent drop TENANT-8''s F-4 named, so the release runs unless someone fires this switch.',
       false, 'kill_switch'
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'notification.held_release_kill_switch');

-- ------------------------------------------------------------------------------------------------------------------
-- 176.6 · THE INBOX'S RETENTION BOUND
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO data_retention_policies (table_name, active_months, action, legal_basis)
SELECT 'notifications', 6, 'delete', 'Delivery log — 6 months (0107, corrected onto the real table by 0150)'
WHERE NOT EXISTS (SELECT 1 FROM data_retention_policies WHERE table_name = 'notifications');
