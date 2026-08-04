-- ============================================================================
-- MIGRATION 0072 — WHATSAPP TEMPLATE LIFECYCLE REGISTRY (DELTA-052, DEV-06)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (verbatim, DESIGN_DRIVEN_SCHEMA_BACKLOG.md row 052): "WA template lifecycle registry (status
-- draft|submitted|approved|rejected|paused, rejection_reason, quality_rating)". Canon (read directly):
--   • WA-008-template-lifecycle-states.html (templates/whatsapp/) — the lifecycle-mechanics reference: draft →
--     submitted → Meta's verdict (approved|rejected) → live → paused (quality drop) → resubmit (back to
--     submitted). Its own "Lifecycle state → schema today" table lists exactly 5 proposed enum rows plus
--     quality_rating: draft, submitted, approved, rejected(+reason), paused — all schema-today "—" (nothing
--     exists) except the pre-existing `notification_templates.is_active` (mapped to the canon's "live" label).
--     Header line itself: "Draft → submitted → Meta's verdict → approved (live) or rejected" — i.e. the canon's
--     own words fold "live" into "approved" (parenthetical), not a 6th enum value; "live" is the DISPLAY label
--     shown once an approved row also has is_active=true. This migration therefore stores the filed shape's
--     literal 5-value enum, not an invented 6th value — same discipline as DEV-05's literal-filed-shape citing.
--   • W427-tenant-whatsapp-templates.html — confirms the field vocabulary used below 1:1: a "Lifecycle" column
--     rendering exactly these chips (submitted/rejected/paused/live) plus a separate "Quality" column
--     (high/medium/low, "the provider's verdict, display-only" — Krishalaya never sets it, only WhatsApp's
--     webhook-ingestion path may write it) and its own banner: "Lifecycle chips below carry DELTA-052 treatment:
--     only is_active exists on notification_templates today."
--
-- WHY ALTER, NOT A NEW TABLE: `notification_templates` (0012_engagement.sql) already IS the per-event × channel
-- × language (+ tenant override) row that WA-008/W427 are describing the lifecycle OF — the lifecycle is a
-- property of that existing row, not a new entity. Same "extend, don't fork" discipline as DEV-05's ALTER-based
-- deltas and this repo's own `plans.status` precedent (0037_plans_ops.sql): `is_active` STAYS the runtime
-- "is this template sendable" flag the rest of the system already reads (send-path queries need only ever check
-- one boolean, unchanged) — `lifecycle_status` is purely an ADDITIVE disambiguation of the full approval
-- pipeline a boolean can't express, exactly mirroring that file's own "is_active stays the runtime flag; status
-- just disambiguates" reasoning.
--
-- RLS: no change — `notification_templates` already carries `tenant_id` (nullable: NULL = platform default) and
-- has been RLS-covered since 0012/0014; adding columns to an already-covered table needs no new RLS pass.
--
-- LAW 3 (vocabulary/master data): `quality_rating` and `lifecycle_status` are bounded CHECK enums, not free text
-- — consistent with the repo's "vocabulary = constrained column, not app-string" convention for small closed sets
-- (cf. `plans.status`, `freight_invoices.recon_status`). `channel`/`language_code` already existed and already
-- reference `languages(code)` (Law 3 hook satisfied pre-existing, nothing new needed here).
-- ============================================================================

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS lifecycle_status varchar(12) NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'submitted', 'approved', 'rejected', 'paused')),
  ADD COLUMN IF NOT EXISTS rejection_reason varchar(300),   -- filed shape column; Meta's verdict reason (e.g. 'VARIABLE_MISSING_EXAMPLE', W-008)
  ADD COLUMN IF NOT EXISTS quality_rating varchar(8)
    CHECK (quality_rating IN ('high', 'medium', 'low')),    -- provider's ongoing verdict, display-only; NULL until Meta first rates it
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,        -- when 'Submit for review' was pressed (last submission)
  ADD COLUMN IF NOT EXISTS verdict_at timestamptz;          -- when Meta's approved/rejected verdict landed (last verdict)

-- Demos-are-deployments (playbook HARD RULE 10): every row that is ALREADY `is_active = true` in this database
-- (seeded platform defaults + any tenant override already live) is, by definition, a template that has already
-- cleared Meta's review and is currently sendable — backfill it to 'approved' rather than leaving real, working,
-- production templates stuck at the new column's 'draft' default (which would be factually wrong: nothing about
-- an already-live template is "draft").
UPDATE notification_templates SET lifecycle_status = 'approved', verdict_at = created_at WHERE is_active = true;

-- Pending-review queue (tenant/admin console list filter "Lifecycle: submitted" — W427's own filter chip) and the
-- moderation-style worklist a WhatsApp-webhook-ingestion worker would poll for outstanding submissions.
CREATE INDEX idx_notification_templates_lifecycle ON notification_templates(tenant_id, lifecycle_status)
  WHERE lifecycle_status IN ('submitted');

-- Low-quality / paused templates needing attention (canon: "Quality dropped to low ... WhatsApp itself pauses
-- delivery" — an ops/support worklist over currently-paused templates).
CREATE INDEX idx_notification_templates_paused ON notification_templates(tenant_id, updated_at DESC)
  WHERE lifecycle_status = 'paused';
