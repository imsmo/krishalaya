-- ============================================================================
-- MIGRATION 0119 — THE ACT-AS TOKEN NOTHING HONOURED (PC-56 ADMIN-9b)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT: THE CONTROL PLANE IS A CAREFUL HALF, AND THE OTHER HALF IS THE PROMISES
-- ---------------------------------------------------------------------------
-- 0038 and `apps/admin-api/src/modules/impersonation/` build a genuinely careful issuer: a grant row with a mandatory
-- reason and a hard expiry, a state machine, audit-in-tx, a kill-switch that defaults OFF, a 30-minute TTL cap, guards
-- that refuse self-impersonation and platform-scoped targets, FIDO2 + step-up on every mutation, and a console.
--
-- **AND NOTHING HONOURS THE TOKEN IT MINTS.** `grep -rn "verifyImpersonation\|typ === 'impersonation'\|act-as" apps/api/src`
-- returns 0 hits. `apps/api` has no verifier, so:
--
--   * A MINTED TOKEN IS INERT. Fail-closed and safe — and it means the whole feature does nothing, while W008 tells the
--     reader it is running: "Scope is read_only by design", "Every page view during impersonation is recorded to
--     impersonation_actions + audit_log (7-yr retention)", "Tenants can see this too... transparency is the policy."
--   * `read_only` IS A STRING NOBODY READS AT REQUEST TIME. It is asserted at mint, CHECKed in this schema, and
--     re-asserted by a verifier function with no callers. No code path anywhere refuses a mutating method.
--   * THE ACTION LOG IS VOLUNTARY SELF-REPORTING. The only writer is `POST /v1/impersonation/grants/:id/actions`,
--     called by the impersonating operator with their own admin bearer. **A log the subject chooses to write is not
--     evidence** — and that route deliberately carries no elevation guard, so it is the cheapest call in the module.
--   * EXPIRY IS A COLUMN AND AN UNUSED INDEX. No job, no trigger, no read-path filter. `'expired'` is a legal state
--     nothing writes, `idx_imp_grants_active_exp` exists for a sweep that was never written, and an elapsed grant reads
--     `active` for ever — which also means it keeps occupying `uq_imp_active_per_admin_target`, so that operator can
--     never get a fresh grant for that target again.
--   * THE TARGET TENANT IS TOLD NOTHING. No notification event, no outbox type, no tenant-readable path — against
--     W008's transparency claim and its revoke dialog's "the target tenant is notified of session end".
--
-- ADMIN-9 already closed the grant defect this file would otherwise have built on top of (kv_app could rewrite
-- `impersonation_grants` and `impersonation_actions`). This file closes the rest.
--
-- ---------------------------------------------------------------------------
-- THE ONE GRANT THIS FILE GIVES BACK, AND WHY IT IS NARROW
-- ---------------------------------------------------------------------------
-- 0118 revoked INSERT/UPDATE/DELETE on `impersonation_actions` from kv_app. But **apps/api is the only process that ever
-- sees an impersonated request**, so it is the only thing that can record one — and per-request logging is the promise
-- that makes the whole control auditable. So kv_app gets INSERT back and nothing else:
--
--   * NO UPDATE and NO DELETE, for kv_app OR kv_admin: the log of an operator's conduct must not be editable by the
--     realm that operator works in.
--   * AND AN APPEND IS ONLY ACCEPTED WHILE THE GRANT IS LIVE (`assert_impersonation_action_live`). Without it, the
--     tenant API role could append rows to an ended grant — backdating a page view into a window that had closed, which
--     is a subtler forgery than editing a row and would be invisible in a list ordered by `created_at`.
--
-- The residual risk is stated rather than waved away: kv_app can append a TRUTHFUL-LOOKING row against a live grant.
-- It cannot alter one, cannot delete one, cannot create a grant, and cannot extend a window. Compared with "nothing is
-- recorded at all", which is today's state, this is the trade that buys the evidence.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 119.1  THE ACTION LOG BECOMES REAL EVIDENCE
-- ---------------------------------------------------------------------------
-- Enrichment first: the log recorded method + path + an optional action label, which answers "what did they open" and
-- not "were they allowed to". W008's own third row is a REFUSAL — "write attempt blocked — listings.update denied (scope
-- read_only)" — and a log that cannot express one would have shown two views and silently dropped the interesting event.
ALTER TABLE impersonation_actions
  ADD COLUMN outcome        varchar(20) NOT NULL DEFAULT 'served'
    CHECK (outcome IN ('served', 'refused_write', 'refused_grant')),
  ADD COLUMN status_code    integer CHECK (status_code BETWEEN 100 AND 599),
  ADD COLUMN detail         varchar(300),
  -- The impersonating operator, denormalised onto the action. It is derivable through `grant_id`, and it is stored
  -- anyway: this is the table an auditor reads when asking "what did PO-STAFF-114 do inside Anand FPO", and a join to
  -- the grant is a join to a row an admin realm can soft-delete.
  ADD COLUMN actor_admin_id uuid,
  ADD COLUMN request_id     varchar(60);

CREATE INDEX idx_imp_actions_actor ON impersonation_actions(actor_admin_id, created_at DESC, id);
-- Refusals are the rows a reviewer scans for, and they are rare — so they get their own partial index rather than
-- making every reviewer filter a full history.
CREATE INDEX idx_imp_actions_refused ON impersonation_actions(grant_id, created_at DESC)
  WHERE outcome <> 'served';

COMMENT ON COLUMN impersonation_actions.outcome IS
  'served | refused_write (a mutating method under a read_only scope) | refused_grant (the grant was not live). '
  'W008 renders a blocked write as a first-class row; a log of successful views only would drop the interesting event.';

CREATE OR REPLACE FUNCTION assert_impersonation_action_live() RETURNS trigger AS $$
DECLARE g record;
BEGIN
  SELECT status, expires_at, admin_user_id, target_tenant_id INTO g
    FROM impersonation_grants WHERE id = NEW.grant_id;
  IF g IS NULL THEN
    RAISE EXCEPTION 'impersonation action references a grant that does not exist' USING ERRCODE = '23503';
  END IF;
  -- **A REFUSAL MAY BE RECORDED AGAINST A GRANT THAT HAS JUST STOPPED BEING LIVE**, and that exemption is the point:
  -- `refused_grant` IS the event "somebody used a token after the grant ended", which is the single most important row
  -- this table can hold. Refusing to record it would mean the log is complete only while nothing interesting happens.
  IF NEW.outcome = 'refused_grant' THEN RETURN NEW; END IF;
  IF g.status <> 'active' OR g.expires_at <= now() THEN
    RAISE EXCEPTION 'impersonation action rejected: grant % is not live (status=%, expires_at=%)',
      NEW.grant_id, g.status, g.expires_at USING ERRCODE = '23514';
  END IF;
  -- The tenant travels on the action row for cheap per-tenant reads; it must be the grant's tenant and not whatever the
  -- caller supplied, or a tenant could be shown somebody else's session.
  IF NEW.target_tenant_id <> g.target_tenant_id THEN
    RAISE EXCEPTION 'impersonation action tenant does not match its grant' USING ERRCODE = '23514';
  END IF;
  IF NEW.actor_admin_id IS NULL THEN NEW.actor_admin_id := g.admin_user_id; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_imp_action_live BEFORE INSERT ON impersonation_actions
  FOR EACH ROW EXECUTE FUNCTION assert_impersonation_action_live();

-- INSERT only, and only for the process that actually sees an impersonated request.
GRANT INSERT ON impersonation_actions TO kv_app;
REVOKE UPDATE, DELETE, TRUNCATE ON impersonation_actions FROM kv_app, kv_admin, kv_relay;

-- ---------------------------------------------------------------------------
-- 119.2  EXPIRY STOPS BEING A DECORATION
-- ---------------------------------------------------------------------------
-- A time-based transition cannot be a trigger and must not be only a job (0113 and 0114 are both findings of a
-- scheduled writer that silently stopped). So the reconciliation is a FUNCTION the read path and the verifier both
-- call — the same "enforce it at the door" pattern 0118 used for operator dormancy — and it is written here rather than
-- in application code so admin-api, apps/api and any future reader cannot disagree about what "expired" means.
CREATE OR REPLACE FUNCTION reconcile_expired_impersonation_grants(p_grant_id uuid DEFAULT NULL)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  UPDATE impersonation_grants
     SET status = 'expired',
         ended_at = COALESCE(ended_at, expires_at),
         -- `ended_by` stays NULL on purpose: nobody ended this session. A row naming an operator here would attribute a
         -- decision to somebody who only ran out of time, and the console tells the two apart.
         end_reason = COALESCE(end_reason, 'hard expiry elapsed'),
         updated_at = now()
   WHERE status = 'active' AND expires_at <= now()
     AND (p_grant_id IS NULL OR id = p_grant_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reconcile_expired_impersonation_grants(uuid) IS
  'Flips elapsed active grants to expired. Called on the read path and by the verifier, because a job that stops '
  'silently leaves grants reading active for ever — and an active-forever grant also holds '
  'uq_imp_active_per_admin_target, so that operator can never get a fresh grant for that target again.';

-- A terminal grant must say when it ended. NOT VALID because production rows predate this file and an elapsed grant
-- that nothing reconciled is exactly the defect being fixed — the constraint binds every future transition immediately
-- while the console can still show the backlog (the 0115/0116/0117 pattern: when the violations ARE the finding).
ALTER TABLE impersonation_grants
  ADD CONSTRAINT ck_imp_terminal_has_ended_at CHECK (
    status = 'active' OR ended_at IS NOT NULL
  ) NOT VALID;

-- A grant that expires before it begins is not a grant. Cheap, and it catches a clock/TTL bug at the source rather than
-- at the moment somebody wonders why a session was dead on arrival.
ALTER TABLE impersonation_grants
  ADD CONSTRAINT ck_imp_expiry_after_start CHECK (expires_at > created_at) NOT VALID;

-- ---------------------------------------------------------------------------
-- 119.3  THE TENANT CAN SEE IT — the claim W008 makes and 0038 made impossible
-- ---------------------------------------------------------------------------
-- W008: "**Tenants can see this too.** Every impersonation session is visible to the target tenant's admin in their
-- console — transparency is the policy." There was no path for that at all: `impersonation_grants` carries
-- `target_tenant_id` rather than `tenant_id`, so the idempotent RLS sweep skipped it, and 0118 revoked kv_app entirely.
--
-- 0101 answered the structurally identical question — a tenant discovering months later that the platform had been
-- talking to their members — with an explicit tenant read grant, and said why. Same answer here, with the same care:
-- SELECT only, and a policy keyed on `target_tenant_id` so a tenant sees sessions against ITSELF and nothing else.
ALTER TABLE impersonation_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_impersonations ON impersonation_grants
  FOR SELECT
  USING (target_tenant_id = current_tenant_id());
GRANT SELECT ON impersonation_grants TO kv_app;
-- kv_admin is BYPASSRLS (0014), so the god-mode plane keeps its cross-tenant read. Stated because a reader who checks
-- this policy and not the role would conclude the admin console had just lost the register.

ALTER TABLE impersonation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_impersonation_actions ON impersonation_actions
  FOR SELECT
  USING (target_tenant_id = current_tenant_id());
GRANT SELECT ON impersonation_actions TO kv_app;
-- **A TENANT SEEING THE SESSION BUT NOT WHAT WAS OPENED WOULD BE A WORSE KIND OF TRANSPARENCY**: it tells them they were
-- looked at and refuses to say at what. The INSERT policy is deliberately absent — RLS with no INSERT policy denies the
-- insert, so `apps/api` writes through... see 119.4.

-- ---------------------------------------------------------------------------
-- 119.4  RLS AND THE WRITE PATH — the trap this file has to step around
-- ---------------------------------------------------------------------------
-- Enabling RLS on `impersonation_actions` would break the write we just granted: with RLS on and no INSERT policy, every
-- kv_app INSERT is refused, and apps/api writes actions for a tenant it is CURRENTLY impersonating — where
-- `current_tenant_id()` is the target tenant, so the row is in-scope by construction.
CREATE POLICY app_appends_own_impersonation_actions ON impersonation_actions
  FOR INSERT
  WITH CHECK (target_tenant_id = current_tenant_id());
-- WITH CHECK rather than USING, and the distinction matters: this says "a row you insert must belong to the tenant whose
-- context you are in". It cannot be used to write into another tenant's history even if the grant id were guessed.

-- ---------------------------------------------------------------------------
-- 119.5  THE NOTIFICATION — the target learns, on the spine everything else uses
-- ---------------------------------------------------------------------------
-- No private channel for a sensitive event (the ADMIN-5c/PC-55-A6 precedent): the same outbox → fanout → notification
-- path every other event rides. `user_can_opt_out = false` on both, because being told that a platform operator opened
-- your account is not a preference — it is the transparency W008 calls the policy.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('impersonation.session_started', 'Support access to your account started', 'critical', '["inapp","push","sms"]', false, false),
  ('impersonation.session_ended',   'Support access to your account ended',   'important', '["inapp","push"]', false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active)
SELECT v.event_code, v.channel, v.language_code, NULL, v.subject, v.body, NULL, true
FROM (VALUES
  -- The body names the REASON the operator typed and the expiry. A notice that said only "support accessed your account"
  -- would be technically transparent and practically useless: the recipient cannot tell a billing enquiry they raised
  -- from something they should complain about.
  ('impersonation.session_started', 'inapp', 'en', 'Krishalaya support opened your account (read-only)',
   'A Krishalaya support operator started a READ-ONLY session on your account. Reason given: {{reason}}. It ends automatically at {{expiresAt}}. They cannot change anything, and every page they open is recorded.'),
  ('impersonation.session_started', 'inapp', 'hi', 'Krishalaya support ne aapka account khola (sirf padhne ke liye)',
   'Krishalaya support operator ne aapke account par READ-ONLY session shuru kiya. Kaaran: {{reason}}. Yeh {{expiresAt}} par khud band ho jayega. Ve kuch badal nahi sakte, aur unka khola gaya har page record hota hai.'),
  ('impersonation.session_started', 'inapp', 'gu', 'Krishalaya support e tamaru account kholyu (fakt vaanchva mate)',
   'Krishalaya support operator e tamara account par READ-ONLY session shary karyu. Karan: {{reason}}. Te {{expiresAt}} par jaate band thai jashe. Teo kai badli shakta nathi, ane teo kholelu daraek page record thay chhe.'),
  ('impersonation.session_started', 'push', 'en', 'Support opened your account (read-only)', 'Reason: {{reason}} · ends {{expiresAt}}'),
  ('impersonation.session_started', 'push', 'hi', 'Support ne aapka account khola (read-only)', 'Kaaran: {{reason}} · {{expiresAt}} par band'),
  ('impersonation.session_started', 'push', 'gu', 'Support e tamaru account kholyu (read-only)', 'Karan: {{reason}} · {{expiresAt}} e band'),
  -- SMS on START only. The DLT ids do not exist yet (the standing gap), so this template is inert until they do — filed
  -- rather than omitted, so the day the ids land the row is already the right words.
  ('impersonation.session_started', 'sms', 'en', NULL, 'Krishalaya: a support operator opened your account read-only ({{reason}}). Ends {{expiresAt}}. Reply HELP to query.'),
  ('impersonation.session_started', 'sms', 'hi', NULL, 'Krishalaya: support operator ne aapka account read-only khola ({{reason}}). {{expiresAt}} par band. Sawal ke liye HELP bhejein.'),
  ('impersonation.session_started', 'sms', 'gu', NULL, 'Krishalaya: support operator e tamaru account read-only kholyu ({{reason}}). {{expiresAt}} e band. Prashn mate HELP mokalo.'),
  ('impersonation.session_ended', 'inapp', 'en', 'Krishalaya support session ended',
   'The support session on your account has ended ({{endKind}}). {{actionCount}} pages were opened and nothing was changed. You can see the full list in your account activity.'),
  ('impersonation.session_ended', 'inapp', 'hi', 'Krishalaya support session samapt',
   'Aapke account par support session samapt ho gaya ({{endKind}}). {{actionCount}} page khole gaye aur kuch badla nahi gaya. Poori suchi aapke account activity mein hai.'),
  ('impersonation.session_ended', 'inapp', 'gu', 'Krishalaya support session puru thayu',
   'Tamara account par support session puru thayu ({{endKind}}). {{actionCount}} page kholaya ane kai badlayu nathi. Aakhi yaadi tamara account activity ma chhe.'),
  ('impersonation.session_ended', 'push', 'en', 'Support session ended', '{{actionCount}} pages opened · nothing changed'),
  ('impersonation.session_ended', 'push', 'hi', 'Support session samapt', '{{actionCount}} page khole gaye · kuch badla nahi'),
  ('impersonation.session_ended', 'push', 'gu', 'Support session puru', '{{actionCount}} page kholaya · kai badlayu nathi')
) AS v(event_code, channel, language_code, subject, body)
WHERE EXISTS (SELECT 1 FROM languages WHERE code = v.language_code)
ON CONFLICT (event_code, channel, language_code, tenant_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 119.6  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO SCHEMA FOR A WRITE-SCOPED IMPERSONATION, EVER.** `scope` keeps its single-value CHECK. W008 states "write
-- impersonation does not exist on this platform" and the honest way to keep that promise is for the schema to make the
-- other value unrepresentable, rather than for a service to remember to refuse it.
--
-- NO OVERRIDE PATH. W008: "There is no override in this console — cross-border moves require a signed legal basis and a
-- schema-level policy change (board + DPO)." The equivalent here is a grant that outlives its window or widens its
-- scope; nothing in this file can express either.
--
-- NO TENANT-CONSOLE SURFACE. The DATA path for W008's transparency claim lands here (119.3) and the screen that reads it
-- belongs to 02_TENANT — recorded as ADMIN-9b-Q2 rather than left implied, because a read grant with no reader is a
-- capability nobody exercises.
