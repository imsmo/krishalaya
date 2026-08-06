-- ============================================================================
-- MIGRATION 0094 — DUNNING POLICY (closes PC-56 ADMIN-1-Q6)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- THE HOLE THIS FILLS. 0035 gave us dunning ATTEMPTS (an append-only log of who chased whom, on what channel, with
-- what outcome) and the collection queue built in PC-56 ADMIN-1 reads them. What did not exist was the LADDER: at how
-- many days late do we send the first reminder, when does it escalate to a call, and at what point does an unpaid
-- SaaS invoice suspend the tenant's subscription. The console therefore had to label its suggested next channel a
-- "convention" — an honest word for "the platform has no policy", which is not a thing a billing operation should
-- have to say. This migration makes the ladder a stored, versioned, auditable object.
--
-- DESIGN, AND WHY
--   • ONE ACTIVE POLICY, VERSIONED, NEVER EDITED IN PLACE. Changing a collections ladder changes what the platform
--     does to paying customers, so a change is a NEW VERSION with its own effective date; the old one stays readable
--     because it explains why a tenant was chased the way they were six months ago. A partial unique index enforces
--     exactly one active version.
--   • STEPS ARE ROWS, NOT JSON. Each rung is `(day_offset, channel, template_code, escalate)` in its own row with a
--     CHECK on the channel vocabulary that MATCHES 0035's attempt channels exactly. As jsonb, a typo'd channel would
--     be discovered by a worker at 3am trying to send on a transport that does not exist.
--   • SUSPENSION IS A SEPARATE, EXPLICIT NUMBER. `suspend_after_days` sits on the policy, not in the step ladder,
--     because suspending a tenant's platform access is a different KIND of act from sending them a message: it stops
--     farmers transacting. It is nullable, and NULL means "never suspend automatically" — the safe default, because
--     an operation that suspends by accident is worse than one that chases too politely. A tenant is never suspended
--     by this table alone; the worker proposes and the tenant-ops path (audited, elevation-gated) decides.
--   • THE POLICY IS ADVISORY TO THE ATTEMPT LOG, NOT A LOCK ON IT. An operator may always ring a tenant early or
--     skip a rung — 0035's cap still bounds abuse. A policy that refused human judgement would be routed around.
--   • PLATFORM-WIDE, NOT TENANT-SCOPED. This is OUR collections policy for money owed TO us, so there is no
--     tenant_id and no RLS: it is not a tenant's data, and per-tenant ladders would be a pricing concession that
--     belongs in `subscriptions.anchor_terms` where it can be negotiated and read as a term.
-- ============================================================================

CREATE TABLE dunning_policies (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  version            integer NOT NULL,
  name               varchar(120) NOT NULL,
  is_active          boolean NOT NULL DEFAULT false,
  effective_from     date NOT NULL,
  -- NULL = never auto-suspend (see header). When set, it must be beyond the last reminder or the ladder is theatre.
  suspend_after_days smallint CHECK (suspend_after_days IS NULL OR (suspend_after_days > 0 AND suspend_after_days <= 365)),
  notes              text,
  UNIQUE (version)
);
CALL add_std_columns('dunning_policies');
-- exactly one active version at a time
CREATE UNIQUE INDEX uq_dunning_policy_active ON dunning_policies ((is_active)) WHERE is_active AND deleted_at IS NULL;

CREATE TABLE dunning_policy_steps (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  policy_id     uuid NOT NULL REFERENCES dunning_policies(id) ON DELETE CASCADE,
  -- days AFTER the due date. 0 is legal and meaningful: a reminder on the due date itself is the cheapest collection
  -- there is. Negative would be chasing money that is not yet owed, which is how a platform loses a customer.
  day_offset    smallint NOT NULL CHECK (day_offset >= 0 AND day_offset <= 365),
  channel       varchar(20) NOT NULL CHECK (channel IN ('email','sms','whatsapp','call','in_app')),
  -- which message to send; resolved against the notification templates. NULL = an operator writes it themselves,
  -- which is normal for a call.
  template_code varchar(80),
  -- true when this rung means "a human must now get involved" rather than "send the thing"
  escalate      boolean NOT NULL DEFAULT false,
  UNIQUE (policy_id, day_offset, channel)
);
CALL add_std_columns('dunning_policy_steps');
CREATE INDEX idx_dunning_steps_policy ON dunning_policy_steps (policy_id, day_offset);

-- ---------- seed: the ladder the console has been describing as a convention -------------------
-- Written as data so it can be read, changed and versioned instead of living in a comment in a TypeScript file.
-- Deliberately NO auto-suspension in v1 (suspend_after_days NULL): switching that on is a decision with a named
-- owner, not a migration default.
INSERT INTO dunning_policies (version, name, is_active, effective_from, suspend_after_days, notes)
VALUES (1, 'Default collections ladder', true, CURRENT_DATE, NULL,
        'Seeded by 0094 from the convention the admin console had been suggesting. Auto-suspension is OFF by design; enabling it is a founder/finance decision, not a schema default.');

INSERT INTO dunning_policy_steps (policy_id, day_offset, channel, template_code, escalate)
SELECT p.id, s.day_offset, s.channel, s.template_code, s.escalate
FROM dunning_policies p,
     (VALUES (0::smallint,  'email',    'saas_invoice_due_today',  false),
             (3::smallint,  'email',    'saas_invoice_reminder_1', false),
             (7::smallint,  'sms',      'saas_invoice_reminder_2', false),
             (14::smallint, 'whatsapp', 'saas_invoice_reminder_3', false),
             (30::smallint, 'call',     NULL,                      true),
             (60::smallint, 'call',     NULL,                      true)
     ) AS s(day_offset, channel, template_code, escalate)
WHERE p.version = 1;

-- ---------- grants (0014/0018 default-privileges trap) ------------------------------------------
-- Neither table is tenant data, so no RLS; but the defaults would have handed kv_app INSERT on the platform's own
-- collections policy. Revoke, then grant reads where they are genuinely useful.
REVOKE ALL ON dunning_policies, dunning_policy_steps FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON dunning_policies, dunning_policy_steps TO kv_admin;
GRANT SELECT ON dunning_policies, dunning_policy_steps TO kv_readonly;
-- the worker that sends the reminders reads the active ladder
GRANT SELECT ON dunning_policies, dunning_policy_steps TO kv_ingest;
