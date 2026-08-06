-- ============================================================================
-- MIGRATION 0098 — FIRED-ESCALATION LEDGER (PC-56 ADMIN-2b; completes ADMIN-2-Q2)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- WHY THIS IS A SEPARATE MIGRATION FROM 0097. 0097 stores the POLICY — the promise. This stores what actually HAPPENED
-- when a promise was missed. They are different concerns with different lifetimes: a policy is edited a few times a
-- year, this table grows with every breach. Keeping them apart also keeps 0097 readable as a single object.
--
-- AND WHY IT EXISTS AT ALL: without it, 0097 would be a table nobody reads and "nobody is paged at breach" would still
-- be true — the exact criticism this wave set out to repair. The ledger is what lets the console answer "was the support
-- head actually rung about TKT-8812, and when?" from data instead of from memory.
--
-- THE DELIVERY TRUTH IS RECORDED, NOT ASSUMED. The platform has an SMS sender and nothing for email, calls or pagers
-- (0095 recorded the same gap for scheduled reports). So a step fires into one of:
--   • `recorded`         — an in-app signal, which IS the delivery: it lands on the SLA board.
--   • `provider_pending` — a call/SMS/pager step with no provider wired. The step is logged with the reason, so the
--                          console can say "the policy says ring the support head; nothing can ring yet".
--   • `sent` / `failed`  — once a provider exists.
-- A step that could not be delivered must never read as delivered, or a desk lead will believe somebody was told.
-- ============================================================================

CREATE TYPE support_escalation_status AS ENUM ('recorded', 'sent', 'provider_pending', 'failed');

CREATE TABLE support_escalation_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(id),
  -- which policy VERSION decided this. Without it, a chain edited next month makes every past page unexplainable.
  policy_id       uuid NOT NULL REFERENCES support_policies(id),
  severity        varchar(2) NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  -- the step, copied (not referenced): the step row could be superseded by a new policy version, and this ledger must
  -- stay readable as what was decided AT THE TIME.
  after_minutes   integer NOT NULL CHECK (after_minutes >= 0),
  channel         support_escalation_channel NOT NULL,
  target_role     varchar(60) NOT NULL,
  -- which breach this was: first response or resolution. A ticket can breach both, and they are different failures.
  breach_kind     varchar(20) NOT NULL CHECK (breach_kind IN ('first_response', 'resolution')),
  breached_at     timestamptz NOT NULL,
  fired_at        timestamptz NOT NULL DEFAULT now(),
  status          support_escalation_status NOT NULL,
  detail          text
);
CALL add_std_columns('support_escalation_events');

-- ONE FIRING PER (ticket, breach kind, step). This is what makes the job idempotent: a re-run after a crash, or two
-- worker replicas racing, cannot page the support head twice for the same breach. Paging somebody twice at 02:00 is how
-- an escalation chain gets switched off by the person it wakes.
CREATE UNIQUE INDEX uq_support_escalation_step ON support_escalation_events
  (ticket_id, breach_kind, after_minutes, channel) WHERE deleted_at IS NULL;
CREATE INDEX idx_support_escalation_ticket ON support_escalation_events (ticket_id, fired_at DESC);
CREATE INDEX idx_support_escalation_recent ON support_escalation_events (fired_at DESC);

-- anything that is not a real delivery must explain itself
ALTER TABLE support_escalation_events ADD CONSTRAINT ck_support_escalation_detail CHECK (
  (status IN ('sent', 'recorded') ) OR (length(btrim(COALESCE(detail, ''))) >= 3)
);

-- ---------- grants (the 0014/0018 default-privileges trap) --------------------------------------
-- The worker writes these (kv_relay), admin-api reads them for the console, the tenant API has no business in them:
-- a tenant must not be able to read who the platform paged about their ticket.
REVOKE ALL ON support_escalation_events FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON support_escalation_events TO kv_relay;
GRANT SELECT, INSERT, UPDATE ON support_escalation_events TO kv_admin;
GRANT SELECT ON support_escalation_events TO kv_readonly;
