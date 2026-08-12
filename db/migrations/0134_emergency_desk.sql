-- ============================================================================
-- MIGRATION 0134 — THE EMERGENCY & SAFETY DESK'S RECORDED TRUTH (PC-56 ADMIN-SWEEP-b3, W058 + W2151–W2153)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE PAGING-PROVIDER ANSWER, GIVEN BEFORE ANYTHING WAS DRAWN
-- ---------------------------------------------------------------------------
-- W058 draws "nearest partner vet paged (3.2 km)" and an error state that says "Emergency paging runs on the
-- alerting service independently." The survey's precondition was to answer whether any of that exists. It does not:
-- the platform has an SMS sender for OTPs and nothing for calls, email or pagers (0098's header records this and
-- the worker logs every call/sms/pager escalation step as `provider_pending`); there is no alerting service; there
-- is no lat/lng on vet_profiles and no SQL distance anywhere, so "3.2 km" is not computable either. **So this desk
-- records what humans DO and refuses to claim what machines cannot do**: a protocol step is either `recorded` (a
-- human act, documented with who/what — the platform is the register, not the actor) or `provider_pending` (the
-- protocol says page, nothing can page, and the row says so in words) — 0098's exact vocabulary, reused rather than
-- re-derived. The one real signal to a vet is their own published offer: `vet_services.is_emergency_available` is a
-- vet's standing consent to be called out in an emergency, and the desk surfaces exactly those vets.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 134.1  THE CATEGORY VOCABULARY EXISTS ONLY IN A SEED — the 0128 class, on data instead of permissions
-- ---------------------------------------------------------------------------
-- `ticket_category` values live solely in db/seeds/core/0005, which runs on FRESH databases; an existing production
-- database has no 'women_safety' row, so the desk's queue would be structurally empty and a protected-category
-- ticket could not even be filed correctly. Same fix shape as 0128: the rows land in a MIGRATION, idempotently.
-- WHERE NOT EXISTS rather than ON CONFLICT, deliberately: the UNIQUE(type_code, tenant_id, code) constraint treats
-- NULL tenant_id rows as distinct (plain UNIQUE, pre-NULLS-NOT-DISTINCT), so ON CONFLICT would never arbitrate for
-- platform rows and a re-run could silently duplicate the vocabulary.
INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
SELECT 'ticket_category', 'Support ticket category', true
WHERE NOT EXISTS (SELECT 1 FROM lookup_types WHERE code = 'ticket_category');

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.code2 AS type_code, NULL, v.code, v.name, '{}'::jsonb, v.ord
FROM (VALUES
  ('ticket_category', 'payment',       'Payment',       1),
  ('ticket_category', 'kyc',           'KYC',           2),
  ('ticket_category', 'order',         'Order',         3),
  ('ticket_category', 'dispute',       'Dispute',       4),
  ('ticket_category', 'technical',     'Technical',     5),
  ('ticket_category', 'safety',        'Safety',        6),
  ('ticket_category', 'emergency_vet', 'Emergency vet', 7),
  ('ticket_category', 'women_safety',  'Women safety',  8)
) AS v(code2, code, name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM lookup_values lv
   WHERE lv.type_code = v.code2 AND lv.tenant_id IS NULL AND lv.code = v.code);

-- ---------------------------------------------------------------------------
-- 134.2  RESPONDERS — "Join" is additive, because an emergency is not a queue item
-- ---------------------------------------------------------------------------
-- A support ticket has EXACTLY ONE assignee (the tenant desk's model) and 0133 added exactly one platform claimant
-- (the hub's pull queue). Neither fits W058: an emergency case gathers people — the safety operator, the on-call
-- lead — and "who was in the room" is a fact the register must keep. One row per (case, operator), append-only.
CREATE TABLE safety_case_responders (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id),
  admin_id   uuid NOT NULL,                 -- platform operator; no FK — operators are not users rows (0110)
  UNIQUE (ticket_id, admin_id)              -- joining twice is a dedupe, not a second presence
);
CALL add_std_columns('safety_case_responders');
CREATE INDEX idx_scr_ticket ON safety_case_responders (ticket_id);

-- ---------------------------------------------------------------------------
-- 134.3  PROTOCOL STEPS — the register of what was done, in 0098's honest vocabulary
-- ---------------------------------------------------------------------------
CREATE TABLE safety_case_steps (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  ticket_id     uuid NOT NULL REFERENCES support_tickets(id),
  category_code varchar(40) NOT NULL,       -- women_safety | emergency_vet | safety (service-validated per case)
  step_code     varchar(40) NOT NULL,       -- the per-category vocabulary lives in code (domain/safety-desk.ts)
  -- 0098's enum, reused: `recorded` = a human act, documented; `provider_pending` = the protocol says page/call and
  -- no provider exists, said in words. `sent`/`failed` become reachable only when a provider ever does.
  status        support_escalation_status NOT NULL,
  -- WHO/WHAT. Mandatory for human acts (a step nobody can reconstruct later is a tick, not a record); the
  -- provider_pending detail is composed by the service and says what cannot fire and why.
  detail        text NOT NULL CHECK (length(btrim(detail)) >= 20),
  actor_admin_id uuid NOT NULL,             -- no row without a human who owns it (0100's rule)
  -- The emergency-vet steps may name the vet involved — a users-realm id via vet_profiles, kept as a bare uuid.
  vet_profile_id uuid REFERENCES vet_profiles(id),
  CONSTRAINT chk_scs_status CHECK (status IN ('recorded', 'provider_pending'))   -- today's writable truth; widen when a provider exists
);
CALL add_std_columns('safety_case_steps');
CREATE INDEX idx_scs_ticket ON safety_case_steps (ticket_id, created_at DESC);

-- Platform-realm registers: the tenant realm has no path here (a women_safety case's step log is the most sensitive
-- operational record this console writes). Steps are append-only — no UPDATE for anybody.
REVOKE ALL ON safety_case_responders, safety_case_steps FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON safety_case_responders TO kv_admin;
GRANT SELECT, INSERT ON safety_case_steps TO kv_admin;
GRANT SELECT ON safety_case_responders, safety_case_steps TO kv_readonly;

COMMENT ON TABLE safety_case_steps IS
  'W058 protocol steps over emergency/safety tickets. status reuses 0098''s honesty: recorded = a documented HUMAN act (the platform is the register, not the actor); provider_pending = the protocol says page and nothing can page. NO paging/alerting tables exist because no such provider exists — a schema for pages nothing can send would be the 0067 empty-appeals shape.';
