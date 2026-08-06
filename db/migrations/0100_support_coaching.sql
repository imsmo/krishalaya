-- ============================================================================
-- MIGRATION 0100 — SUPPORT COACHING RECORDS (closes PC-56 ADMIN-2-Q6)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- WHAT THE CANON ASKS FOR (W2019-25): "schedule a shadow session" and "dismiss a signal" on the agent-performance
-- screen. Both are buttons on a workflow with nothing behind it, and they are two halves of the same thing — a lead
-- looking at a signal about an agent and DECIDING. One decides to act, the other decides not to. Storing only the first
-- would mean the record shows every intervention and none of the judgements not to intervene, which reads as a lead who
-- ignores half their signals.
--
-- THIS TABLE IS ABOUT A PERSON'S PERFORMANCE, WHICH MAKES IT THE MOST SENSITIVE TABLE IN THE SUPPORT PLANE.
-- Four consequences, each enforced below rather than left to convention:
--   1. THE AGENT IS A TENANT USER; THE LEAD IS A PLATFORM ADMIN. This is the platform observing a tenant's desk, so the
--      row carries tenant_id (whose desk) AND an admin reviewer (who judged) and it is NOT tenant-readable. A tenant
--      discovering the platform's private coaching notes on their staff is a trust incident, not a feature.
--   2. NO DELETES, NO EDITS TO THE SUBSTANCE. A coaching record that can be rewritten is worthless as a record and
--      dangerous as evidence. Only the OUTCOME may be filled in later, because that genuinely happens after the fact.
--   3. A SIGNAL DISMISSAL NEEDS A REASON. "Dismissed" with no words is indistinguishable from "nobody looked".
--   4. NOTHING HERE IS AN AUTOMATED JUDGEMENT. Every row has a named human author. The platform computes signals
--      (ADMIN-2's p50s and CSAT samples); it does not conclude anything about a person on its own.
-- ============================================================================

CREATE TYPE support_coaching_kind AS ENUM (
  'shadow_session',    -- the lead sits with the agent on live tickets (the canon's button)
  'review_call',       -- a conversation about specific tickets
  'written_feedback',  -- a note, no meeting
  'signal_dismissed'   -- the lead looked and decided no action was warranted
);

CREATE TYPE support_coaching_status AS ENUM (
  'scheduled',   -- a future session exists
  'held',        -- it happened; outcome recorded
  'missed',      -- it did not happen (recorded, not deleted — a missed session is a fact about the desk)
  'cancelled',
  'closed'       -- terminal for kinds with nothing to hold (written_feedback, signal_dismissed)
);

CREATE TABLE support_coaching_records (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- whose desk. Present so a tenant's coaching history is queryable per tenant; NOT a grant of tenant access (see below).
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  -- the agent this is about. A PERSON, unavoidably — unlike the escalation chain's target_role, coaching is inherently
  -- about an individual, which is exactly why the rest of this table is so restrictive.
  agent_user_id   uuid NOT NULL REFERENCES users(id),
  -- the platform-side author. Mandatory: no row in this table may exist without a human who owns it.
  author_admin_id uuid NOT NULL,
  kind            support_coaching_kind NOT NULL,
  status          support_coaching_status NOT NULL,

  -- WHY. The signal that prompted this: a low CSAT rating, a slow p50, a breach pattern. Nullable because a lead may
  -- coach for a reason no metric produced, and forcing them to pick a fake signal would corrupt the signal data.
  csat_response_id uuid REFERENCES support_csat_responses(id),
  csat_review_id   uuid REFERENCES support_csat_reviews(id),
  -- a free-text signal reference for the cases above (e.g. "p50 first response 3x desk median, week of 2026-08-03")
  signal_note     text,
  -- the substance. Mandatory and long enough to mean something: a coaching record nobody can understand later is a
  -- record of nothing, and this one may be read in a dispute about a person's job.
  rationale       text NOT NULL CHECK (length(btrim(rationale)) >= 20),

  -- when it is/was. Null for kinds that are not events (written_feedback, signal_dismissed) — see the CHECK below.
  scheduled_for   timestamptz,
  held_at         timestamptz,
  -- filled in AFTER the session. The only substantive column that may be updated, and only once (enforced in service
  -- code, since a trigger here would fight the standard updated_at trigger).
  outcome         text,
  CONSTRAINT ck_coaching_outcome_len CHECK (outcome IS NULL OR length(btrim(outcome)) >= 10)
);
CALL add_std_columns('support_coaching_records');

-- A SESSION NEEDS A TIME; A NOTE MUST NOT PRETEND TO BE ONE. This is the check that stops the table drifting into a
-- to-do list where half the rows are meetings and half are opinions and nothing distinguishes them.
ALTER TABLE support_coaching_records ADD CONSTRAINT ck_coaching_kind_shape CHECK (
  (kind IN ('shadow_session', 'review_call') AND scheduled_for IS NOT NULL)
  OR (kind IN ('written_feedback', 'signal_dismissed') AND scheduled_for IS NULL AND held_at IS NULL)
);
-- A HELD SESSION HAS A TIME IT WAS HELD AND SOMETHING TO SHOW FOR IT. Without this, 'held' becomes a tick somebody
-- clicks on the way past.
ALTER TABLE support_coaching_records ADD CONSTRAINT ck_coaching_held_evidence CHECK (
  status <> 'held' OR (held_at IS NOT NULL AND outcome IS NOT NULL)
);
-- A DISMISSAL IS TERMINAL BY CONSTRUCTION: there is nothing to schedule, attend or hold. Its reason lives in
-- `rationale`, which is already mandatory — that is check 3 from the header.
ALTER TABLE support_coaching_records ADD CONSTRAINT ck_coaching_dismissal_closed CHECK (
  kind <> 'signal_dismissed' OR status = 'closed'
);
-- 'closed' is for the non-event kinds; a session reaches 'held'/'missed'/'cancelled' instead.
ALTER TABLE support_coaching_records ADD CONSTRAINT ck_coaching_closed_kind CHECK (
  status <> 'closed' OR kind IN ('written_feedback', 'signal_dismissed')
);

-- ONE DISMISSAL PER SIGNAL. Two leads must not each dismiss the same rating, and a re-dismissal is not a new fact.
CREATE UNIQUE INDEX uq_coaching_dismissal_per_signal ON support_coaching_records (csat_response_id)
  WHERE kind = 'signal_dismissed' AND csat_response_id IS NOT NULL AND deleted_at IS NULL;
-- ONE OPEN SESSION PER AGENT AT A TIME. Double-booking an agent for the same slot is a scheduling bug that looks like a
-- disciplinary pile-on to the person on the receiving end.
CREATE UNIQUE INDEX uq_coaching_agent_slot ON support_coaching_records (agent_user_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_coaching_agent ON support_coaching_records (tenant_id, agent_user_id, created_at DESC);
CREATE INDEX idx_coaching_upcoming ON support_coaching_records (scheduled_for)
  WHERE status = 'scheduled' AND deleted_at IS NULL;
CREATE INDEX idx_coaching_recent ON support_coaching_records (created_at DESC);

-- now that the table exists, the 0099 review can point at it
ALTER TABLE support_csat_reviews
  ADD CONSTRAINT fk_csat_review_coaching FOREIGN KEY (coaching_id) REFERENCES support_coaching_records(id);

-- ---------- grants: PLATFORM ONLY (the 0014/0018 default-privileges trap) ------------------------
-- No RLS policy is created because there is no tenant read path to scope: kv_app is granted NOTHING on this table.
-- That is the strongest available statement of point 1 in the header — a tenant cannot read the platform's coaching
-- notes on their own staff even by accident, because the role their API connects with has no privilege to try.
REVOKE ALL ON support_coaching_records FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON support_coaching_records TO kv_admin;   -- UPDATE for status + outcome only
GRANT SELECT ON support_coaching_records TO kv_readonly;
-- Deliberately no DELETE for any role: see point 2.
