-- ============================================================================
-- MIGRATION 0086 — OPS ALERT RULES & FIRED-ALERT LOG (PC-55 A6)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): PC54_BACKLOG.md W54-12 — "alert RULES + notification fan-out need their own table ->
-- honestly gated as `ops-alert-rules`". PC55_COMPLETION_PROMPTS.md wave A6 is the build order and is explicit
-- about the constraint that shapes this design: the evaluator "writes to the EXISTING notification spine
-- (no new delivery channel)".
--
-- HOW ALERTS REACH A HUMAN (and why no new channel exists here): communication's spine is
-- outbox event -> DomainEventFanoutHandler -> NotificationService.fanout -> the user's own resolved channels,
-- respecting their preferences and QUIET HOURS. So this module NEVER sends anything itself: the evaluator writes
-- ONE outbox event ('ops.alert_fired') and the existing map row + seeded catalog event carry it the rest of the
-- way. A cold-chain breach therefore obeys the same consent rules as every other notification — Rule Zero:
-- no shortcut that breaks trust, not even for an urgent alert.
--
-- THE FIRED LOG IS THE DEDUPE MEMORY, not decoration: an evaluator that runs every few minutes must not page a
-- warehouse manager every tick for the same breach. `ops_fired_alerts` carries a dedupe_key with a UNIQUE index,
-- so a repeat within the rule's own cooldown window is a no-op at the DATABASE level (the only place a
-- multi-pod race can be settled honestly).
--
-- RLS: tenant-scoped via the idempotent 0066 pass.
-- ============================================================================

CREATE TABLE ops_alert_rules (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  kind          varchar(24) NOT NULL
                CHECK (kind IN ('cold_chain_breach','device_silent','maintenance_due')),
  rule_name     varchar(150) NOT NULL,
  -- WHAT counts as a breach. jsonb because each kind has its own shape, validated in the service against a
  -- typed schema per kind (never free-form at the edge):
  --   cold_chain_breach → {"windowHours":6,"minBreaches":1,"subjectType":"shipment"|null}
  --   device_silent     → {"silentHours":12}
  --   maintenance_due   → {"alert":"service_due"|"needs_attention"|"any"}
  threshold     jsonb NOT NULL DEFAULT '{}',
  -- WHO hears it. Recipients are platform users (the notification spine resolves each one's own channels and
  -- honours their quiet hours); `channel_hint` is only a PREFERENCE passed in the payload — never a bypass.
  recipient_user_ids jsonb NOT NULL DEFAULT '[]',
  channel_hint  varchar(12) CHECK (channel_hint IN ('push','sms','whatsapp','email','inapp') OR channel_hint IS NULL),
  cooldown_minutes integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 5 AND 10080),
  is_active     boolean NOT NULL DEFAULT true,
  last_evaluated_at timestamptz,
  version       integer NOT NULL DEFAULT 0
);
CALL add_std_columns('ops_alert_rules');
CREATE UNIQUE INDEX uq_ops_alert_rules_name ON ops_alert_rules (tenant_id, lower(rule_name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_ops_alert_rules_active ON ops_alert_rules (tenant_id, kind, is_active);

CREATE TABLE ops_fired_alerts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  rule_id       uuid NOT NULL REFERENCES ops_alert_rules(id),
  kind          varchar(24) NOT NULL,
  severity      varchar(8) NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  subject_type  varchar(40),                        -- 'device' | 'shipment' | 'equipment_asset' | …
  subject_ref   varchar(120),                       -- device_ref / asset id / shipment id (as observed)
  detail        jsonb NOT NULL DEFAULT '{}',        -- the evidence that fired it (counts, temps, dates)
  recipients    jsonb NOT NULL DEFAULT '[]',        -- who the spine was asked to notify
  notified      boolean NOT NULL DEFAULT false,     -- true once the outbox event was written (never "sent" — the spine owns that)
  -- THE DEDUPE MEMORY (see header): rule + subject + cooldown bucket.
  dedupe_key    varchar(200) NOT NULL,
  fired_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id)
);
CALL add_std_columns('ops_fired_alerts');
CREATE UNIQUE INDEX uq_ops_fired_alerts_dedupe ON ops_fired_alerts (dedupe_key);
CREATE INDEX idx_ops_fired_alerts_feed ON ops_fired_alerts (tenant_id, fired_at DESC);
CREATE INDEX idx_ops_fired_alerts_open ON ops_fired_alerts (tenant_id, kind) WHERE acknowledged_at IS NULL;

-- RLS — idempotent tenant-isolation pass (0066 pattern, verbatim).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='tenant_id'
    WHERE t.schemaname='public'
      AND t.tablename NOT IN ('wallet_accounts','ledger_entries','ledger_transactions','reconciliation_runs')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format($f$CREATE POLICY tenant_isolation_%s ON %I
                     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());$f$,
                   r.tablename, r.tablename);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON ops_alert_rules TO kv_app;
GRANT SELECT, INSERT, UPDATE ON ops_fired_alerts TO kv_app;

-- The notification catalog row + templates for the ONE event this module emits. Without a catalog row the
-- spine deliberately sends nothing (see notification-event-map.ts), so this seed is part of the contract.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('ops.alert_fired', 'Operations alert', 'important', '["push","sms"]', true, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active) VALUES
 ('ops.alert_fired','push','en',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_fired','push','hi',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_fired','push','gu',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_fired','inapp','en',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_fired','inapp','hi',NULL,'{{title}}','{{body}}',NULL,true),
 ('ops.alert_fired','inapp','gu',NULL,'{{title}}','{{body}}',NULL,true)
ON CONFLICT DO NOTHING;
