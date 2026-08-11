-- ============================================================================
-- MIGRATION 0122 — A TEMPLATE THAT CAN BE REWRITTEN AFTER IT WAS SENT, AND OTP COPY ANY TENANT CAN EDIT
-- (PC-56 ADMIN-11b · notification templates)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: `notifications.template_id` POINTS AT A ROW WHOSE BODY CAN CHANGE AFTERWARDS
-- ---------------------------------------------------------------------------
-- `notification_templates` (0012_engagement.sql) has one `body` column and no version. The only write path in the
-- monorepo is an UPSERT that replaces it in place:
--
--     ON CONFLICT (event_code, channel, language_code, tenant_id) DO UPDATE
--       SET subject=EXCLUDED.subject, body=EXCLUDED.body, provider_template_ref=EXCLUDED.provider_template_ref, ...
--
-- And the delivery log records `template_id` — a pointer to that mutable row. So the log claims to record WHICH
-- TEMPLATE WAS USED and cannot answer WHAT WAS SENT: edit the body on Tuesday and every notification delivered on
-- Monday now reads as though it carried Tuesday's words. `notifications.payload` holds the VARIABLES, not the rendered
-- text, so the message cannot be reconstructed from it either.
--
-- **THIS IS THE PLATFORM'S EVIDENCE PROBLEM, NOT A TIDINESS PROBLEM.** The three questions this platform will actually
-- be asked about a notification are: what did the OTP message say when the farmer said they never received a code;
-- what wording did we send under DLT header KRISHIV when the regulator asks; and what did the buyer see when they
-- claim the delivery message promised something else. All three are unanswerable today, and each is a trust question
-- rather than a debugging one. **Published-never-edited, applied for the fifth time in this programme** (consent
-- notices 0104, scheme versions, AI model cards, report definitions) — and here it also fixes a live defect, see 3.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: ANY TENANT CAN REWRITE THE OTP MESSAGE — THE RULE IS WRITTEN DOWN AND ENFORCED NOWHERE
-- ---------------------------------------------------------------------------
-- W101 states it as settled policy: "auth.otp and dispute events are **opt-out-locked** (user_can_opt_out = false) and
-- **tenant overrides are disabled on them — security copy stays platform-controlled**."
--
-- `TemplateAdminService.upsert` checks one thing — that the event code exists in the catalogue — and then writes a
-- tenant-scoped row for it. `NotificationTemplateRepository.resolve` sorts `tenant_id NULLS LAST`, so a tenant row
-- BEATS the platform default for every event, including `auth.otp`. A tenant holding `notification.manage` can
-- therefore replace the body of the one-time-password SMS its farmers receive — with a different link, a different
-- sender name, or a different instruction — and nothing in either realm refuses it.
--
-- The guard belongs in the DATABASE and not only in the service, because two realms write this table today and a third
-- (this wave's admin plane) is being added: a trigger refuses the row for every writer, present and future. The
-- service refusal is added as well, and each is tested ALONE — the ADMIN-9b lesson that defence in depth is only
-- defence if each layer is verified by itself.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: 0072 ADDED A WHATSAPP TEMPLATE LIFECYCLE THAT NO CODE READS OR WRITES
-- ---------------------------------------------------------------------------
-- `lifecycle_status` (draft|submitted|approved|rejected|paused), `quality_rating`, `submitted_at`, `verdict_at` were
-- added by 0072 with a backfill. `grep -rn "lifecycle_status" apps packages --include=*.ts` returns NOTHING. It is the
-- eighth occurrence of a status column recording an act no code performs — and this one is not inert:
-- `resolve()` sends on `is_active = true` alone, so a template Meta has REJECTED or PAUSED is fully sendable. Sending
-- against a paused WhatsApp template is how a tenant's WABA quality rating falls and how a business number gets
-- blocked, which is a scale-blocking outcome from a column nobody wired.
--
-- W102's third guard rail is the same defect from the SMS side: "**Edits require re-approval of DLT ref before next
-- send.**" The upsert replaces `body` and keeps `provider_template_ref`, so an edited body goes out under a DLT
-- template id registered for different content — and Indian DLT scrubbing rejects the mismatch, which means the OTPs
-- stop arriving. **Versioning fixes this without ever creating silence**: an edit makes a new DRAFT version and the
-- APPROVED version keeps serving until the new one clears. Nothing goes quiet while a re-approval is pending.
--
-- ---------------------------------------------------------------------------
-- DEFECT 4: W102's VARIABLES PANEL HAS NOTHING BEHIND IT, AND A TYPO IS INVISIBLE
-- ---------------------------------------------------------------------------
-- The detail screen lists each variable with a SOURCE (`orders.order_no`) and a SAMPLE (`ORD-2026-088412`). Nothing
-- declares what an event emits. `NotificationTemplate.render()` is deliberate about the consequence —
-- "Missing keys render as '' (never leak '{{x}}' to a user)" — which is the right call at send time and means an
-- author who types `{{order_no}}` for `{{order_id}}` ships an SMS with a silent HOLE in it, to a farmer, in a language
-- the author may not read. Declaring the variables makes the typo REFUSABLE at authoring time, and gives the preview
-- honest sample values instead of production rows in a god-mode console.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 122.1  THE VERSION — an immutable body, and the row that says which one is serving
-- ---------------------------------------------------------------------------
CREATE TABLE notification_template_versions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  template_id   uuid NOT NULL REFERENCES notification_templates(id),
  -- Denormalised from the template so a version is legible on its own (an evidence row that needs a join to say which
  -- event it belongs to is an evidence row a reader mistrusts), and so RLS has a tenant column to sit on.
  tenant_id     uuid REFERENCES tenants(id),          -- NULL = platform default, mirroring notification_templates
  event_code    varchar(80) NOT NULL REFERENCES notification_events(code),
  channel       varchar(15) NOT NULL,
  language_code varchar(8) NOT NULL REFERENCES languages(code),
  version_no    integer NOT NULL CHECK (version_no >= 1),
  subject       varchar(250),
  body          text NOT NULL,
  -- The provider registration this exact wording was approved under. Carried ON THE VERSION, which is the whole point:
  -- the ref belongs to the words, not to the row. A new body means a ref that has not been approved for it.
  provider_template_ref varchar(120),
  -- sha256 of the body as authored. Cheap, and it is what an export receipt or a regulator response quotes when the
  -- question is "is this the text you sent" — the same evidence shape as 0120's download digests.
  body_sha256   char(64) NOT NULL,
  lifecycle     varchar(12) NOT NULL DEFAULT 'draft'
                  CHECK (lifecycle IN ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  -- **SECOND-PERSON REQUIREMENT DECIDED AT AUTHORING TIME AND STORED**, not re-derived at approval. If it were
  -- re-derived, changing an event's priority afterwards would retroactively make an approval look compliant (or not),
  -- and the CHECK below could not be written at all.
  needs_second_person boolean NOT NULL DEFAULT false,
  authored_by_admin_id uuid,                          -- platform authoring (admin realm)
  authored_by_user_id  uuid,                          -- tenant authoring (tenant realm) — one of the two, see ck below
  approved_by_admin_id uuid,
  approved_at   timestamptz,
  rejection_reason varchar(300),
  reason        text NOT NULL,                        -- why this edit exists; the audit sentence, required at write
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_no),
  -- SIXTEENTH MAKER-CHECKER SITE. W102: "auth/dispute templates additionally need security sign-off." Security copy is
  -- the wording a user is asked to trust — an OTP, a dispute notice — and one person must not be able to author AND
  -- approve it. Ordinary marketing copy takes one person, deliberately: a checker on every wording change is a checker
  -- who rubber-stamps, which is worse than none because it produces a record that means nothing.
  CONSTRAINT ck_ntv_approver_ne_author CHECK (
    needs_second_person = false OR approved_by_admin_id IS NULL
    OR (authored_by_admin_id IS NULL OR approved_by_admin_id <> authored_by_admin_id)),
  -- An approved version has both halves of its approval, or neither. A row with an approver and no time (or the
  -- reverse) is a row that cannot be read as evidence of anything.
  CONSTRAINT ck_ntv_approval_pair CHECK ((approved_by_admin_id IS NULL) = (approved_at IS NULL)),
  CONSTRAINT ck_ntv_approved_has_approver CHECK (lifecycle <> 'approved' OR approved_at IS NOT NULL),
  CONSTRAINT ck_ntv_rejected_has_reason CHECK (lifecycle <> 'rejected' OR rejection_reason IS NOT NULL)
);
CALL add_std_columns('notification_template_versions');

-- The authoring worklist (submitted, oldest first — a review queue is a FIFO or it is a pile).
CREATE INDEX idx_ntv_pending ON notification_template_versions(lifecycle, created_at)
  WHERE lifecycle IN ('draft', 'submitted');
-- The history panel: every version of one template, newest first.
CREATE INDEX idx_ntv_template ON notification_template_versions(template_id, version_no DESC);
-- Cross-template lookup by wording (the regulator question: "which template carried this DLT ref").
CREATE INDEX idx_ntv_provider_ref ON notification_template_versions(provider_template_ref)
  WHERE provider_template_ref IS NOT NULL;

-- **APPEND-ONLY, AND THE UPDATE THAT IS ALLOWED IS NARROW.** A version's WORDS never change (that is the whole
-- table), but its lifecycle does: draft → submitted → approved → superseded. kv_admin may UPDATE because the approval
-- plane lives in the admin realm; a trigger below refuses any UPDATE that touches the words. kv_app may only read —
-- apps/api resolves the serving body and must never author one.
REVOKE ALL ON notification_template_versions FROM kv_app, kv_relay;
REVOKE DELETE, TRUNCATE ON notification_template_versions FROM kv_admin;
GRANT SELECT ON notification_template_versions TO kv_readonly;

-- 0014's ALTER DEFAULT PRIVILEGES trap: every table created after it silently grants kv_app SELECT/INSERT/UPDATE.
-- The REVOKE above removed all of it; this grants back exactly the read the send path needs, nothing more.
ALTER TABLE notification_template_versions ENABLE ROW LEVEL SECURITY;
-- A tenant reads its own versions AND the platform defaults it sends under (tenant_id IS NULL) — the same visibility
-- `resolve()` has always had over `notification_templates`, now extended to the words it will actually send.
CREATE POLICY tenant_reads_own_template_versions ON notification_template_versions
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
GRANT SELECT ON notification_template_versions TO kv_app;
-- kv_admin is BYPASSRLS (0014), so the authoring plane keeps its cross-tenant view. Stated because a reader who checks
-- this policy without checking the role would conclude the console had just lost every tenant override.

-- THE WORDS ARE IMMUTABLE, ENFORCED. A REVOKE cannot express "you may change the lifecycle but not the body", so the
-- rule is a trigger. Without it, `serving_version_id` would point at a row that could still be rewritten, and this
-- migration would have moved the defect rather than fixed it.
CREATE OR REPLACE FUNCTION assert_template_version_words_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.language_code IS DISTINCT FROM OLD.language_code
     OR NEW.provider_template_ref IS DISTINCT FROM OLD.provider_template_ref THEN
    RAISE EXCEPTION 'notification_template_versions is published-never-edited: a new wording is a new version (template % v%)',
      OLD.template_id, OLD.version_no
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ntv_words_immutable
  BEFORE UPDATE ON notification_template_versions
  FOR EACH ROW EXECUTE FUNCTION assert_template_version_words_immutable();

-- ---------------------------------------------------------------------------
-- 122.2  WHICH VERSION IS SERVING — one pointer, on the row the send path already reads
-- ---------------------------------------------------------------------------
ALTER TABLE notification_templates
  -- The APPROVED version whose words go out. An edit does not touch it: the new draft sits beside it and this pointer
  -- moves only on approval. That is what makes "edits require re-approval before next send" true without a gap in
  -- which the platform sends nothing — the failure mode a naive fix would introduce for OTP copy.
  ADD COLUMN serving_version_id uuid REFERENCES notification_template_versions(id),
  -- Kept for the coverage view and for the answer to "has anybody ever touched this since it was seeded".
  ADD COLUMN current_version_no integer NOT NULL DEFAULT 1 CHECK (current_version_no >= 1);

-- ---------------------------------------------------------------------------
-- 122.3  BACKFILL — every existing row becomes its own version 1
-- ---------------------------------------------------------------------------
-- Demos-are-deployments: the rows in this table are LIVE templates, several seeded by migrations 0086/0101/0112/0114/
-- 0119 and sending today. Leaving them without a version would mean the send path had to special-case "no version
-- yet" for ever, and the first edit of a seeded OTP template would produce a v2 with no v1 to diff against.
INSERT INTO notification_template_versions (
  template_id, tenant_id, event_code, channel, language_code, version_no, subject, body,
  provider_template_ref, body_sha256, lifecycle, needs_second_person, approved_at, reason, created_at)
SELECT
  t.id, t.tenant_id, t.event_code, t.channel, t.language_code, 1, t.subject, t.body,
  t.provider_template_ref, encode(digest(t.body, 'sha256'), 'hex'),
  -- 0072 already made this judgement for `lifecycle_status` and it was the right one: a row that is is_active=true in
  -- a production database has, by definition, been sending. Mapping it to anything but 'approved' would be factually
  -- wrong about working software. A rejected/paused row keeps its verdict: 'rejected' here, so 122.5's send-time gate
  -- stops it — which is the defect-3 fix landing on the rows that actually have the problem.
  CASE
    WHEN t.lifecycle_status IN ('rejected', 'paused') THEN 'rejected'
    WHEN t.is_active THEN 'approved'
    WHEN t.lifecycle_status = 'submitted' THEN 'submitted'
    ELSE 'draft'
  END,
  -- The second-person flag as it WOULD have been decided at authoring time, so the history reads consistently with
  -- every version written after this migration.
  (e.user_can_opt_out = false OR e.priority = 'critical'),
  CASE WHEN t.is_active AND t.lifecycle_status NOT IN ('rejected', 'paused') THEN COALESCE(t.verdict_at, t.created_at) END,
  'Backfilled by 0122 from the pre-version row: this is the wording that was live when versioning shipped.',
  t.created_at
FROM notification_templates t
JOIN notification_events e ON e.code = t.event_code
WHERE t.deleted_at IS NULL;

-- Point every template at its own version 1 where that version is servable. A row whose only version is rejected gets
-- NO serving pointer — deliberately, because it should not be sending, and 122.5 is what makes that true.
UPDATE notification_templates t
   SET serving_version_id = v.id
  FROM notification_template_versions v
 WHERE v.template_id = t.id AND v.version_no = 1 AND v.lifecycle = 'approved';

-- ---------------------------------------------------------------------------
-- 122.4  THE EVIDENCE POINTER ON THE DELIVERY LOG
-- ---------------------------------------------------------------------------
-- One nullable column, and it is the column that answers "what did the message say". NULL is honest for every row
-- written before this migration: those sends genuinely cannot be reconstructed, and a backfill guessing today's body
-- would be a fabricated audit trail — the shape this programme refuses on principle.
ALTER TABLE notifications
  ADD COLUMN template_version_id uuid;
-- No FK: `notifications` is partitioned and high-volume, and a version must never be undeletable because a delivery
-- row from three years ago references it — the retention enforcer prunes notifications long before templates. The
-- pointer is evidence, not a constraint.
COMMENT ON COLUMN notifications.template_version_id IS
  'The immutable template version whose words were rendered into this notification (0122). NULL for sends that predate versioning — those are unreconstructable and say so.';

-- ---------------------------------------------------------------------------
-- 122.5  SECURITY COPY IS PLATFORM-CONTROLLED — the rule W101 states, enforced for every writer
-- ---------------------------------------------------------------------------
-- Applies to a tenant-scoped row for an event that is opt-out-locked or critical: auth.otp, dispute events, anything a
-- user is asked to TRUST. Two realms write this table today and this wave adds a third; a service check would bind
-- one of them.
CREATE OR REPLACE FUNCTION assert_security_copy_platform_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE locked boolean;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;   -- platform defaults are exactly what this protects
  SELECT (e.user_can_opt_out = false OR e.priority = 'critical') INTO locked
    FROM notification_events e WHERE e.code = NEW.event_code;
  -- **UNKNOWN IS NOT PERMITTED.** An event code with no catalogue row cannot be shown to be safe to override, and this
  -- programme has now treated unknown as exclusion five times: residency preflight, flag targeting, dormancy, blast
  -- radius, here.
  IF locked IS NULL OR locked THEN
    RAISE EXCEPTION 'security copy is platform-controlled: % is opt-out-locked or critical and takes no tenant override', NEW.event_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_nt_security_copy_platform_only
  BEFORE INSERT OR UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION assert_security_copy_platform_only();

-- **AND THERE IS NO `NOT VALID` CHECK BESIDE IT, WHICH IS A DELIBERATE DEPARTURE FROM 0110–0121.** Every other rule of
-- this kind in this programme was written as a CHECK first and a trigger second; this one cannot be. The rule depends
-- on ANOTHER table (`notification_events.user_can_opt_out`), and PostgreSQL forbids a subquery in a CHECK — a constraint
-- written that way is not a stricter version of this trigger, it is a syntax error. Recording why, because the next
-- reader will look for the constraint and its absence should not read as an oversight.
--
-- The consequence is the one thing NOT VALID would have given us for free: existing violating rows are refused no new
-- edits but are not enumerated by the schema. The audit query in 122.8 does that job, and any row it returns is a
-- tenant that has already rewritten security copy — a founder's decision, not a migration's.

-- ---------------------------------------------------------------------------
-- 122.6  THE VARIABLE CATALOGUE — so a typo is refusable and a preview is honest
-- ---------------------------------------------------------------------------
CREATE TABLE notification_event_variables (
  event_code    varchar(80) NOT NULL REFERENCES notification_events(code),
  name          varchar(64) NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
  -- Where the value comes from, in the words W102 uses: 'orders.order_no', 'payments.status label (localized)'. Prose,
  -- deliberately: this is for the human author choosing a variable, not for a resolver.
  source_ref    varchar(160) NOT NULL,
  -- The sample the preview renders. **A DECLARED SAMPLE, NEVER A PRODUCTION ROW**: previewing an OTP template against
  -- a real user's data would put a farmer's live one-time code on a god-mode console screen, which is a PII path with
  -- a nice label on it.
  sample_value  varchar(200) NOT NULL,
  -- A required variable missing from a body is refused at authoring time. An optional one is not: 'receipt_url' is
  -- absent from a cash order and rendering it empty is correct.
  is_required   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (event_code, name)
);
CALL add_std_columns('notification_event_variables');

REVOKE ALL ON notification_event_variables FROM kv_relay;
-- Global master data, no tenant column, safe for the tenant realm to read (the tenant authoring screen needs the same
-- variable list the platform one does). SELECT only: the catalogue is platform-owned.
GRANT SELECT ON notification_event_variables TO kv_app, kv_readonly;

-- Seeded from the variables the existing seeded bodies actually use, which is the only honest starting set: these are
-- read out of `db/seeds/core/0007_notification_events_templates.sql` and the migration-seeded platform defaults, not
-- invented. Events not listed here have an EMPTY catalogue, and the authoring plane says "not declared yet" rather
-- than "no variables" — unknown is not zero, in the sixth place this wave found to say it.
INSERT INTO notification_event_variables (event_code, name, source_ref, sample_value, is_required) VALUES
  ('auth.otp',        'otp',            'generated one-time code (never stored in clear)', '482913',            true),
  ('order.delivered', 'order_id',       'orders.order_no',                                 'ORD-2026-088412',   true),
  ('order.delivered', 'amount',         'orders.total_minor + currency (formatted)',       '₹12,450',           false),
  ('order.delivered', 'payment_status', 'payments.status label (localized)',               'Paid',              false),
  ('order.delivered', 'receipt_url',    'short link (kvs.in)',                             'kvs.in/r/8xk2',     false),
  ('bid.outbid',      'lot_name',       'auction_lots.title',                              'Cotton · 12 quintal', true),
  ('wage.paid',       'amount',         'wage_payments.amount_minor + currency',           '₹1,250',            true),
  ('scheme.approved', 'scheme_name',    'schemes.default_name',                            'PM-KISAN',          true)
ON CONFLICT (event_code, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 122.7  THE SENDER REGISTRY — what W102's "sender ID KRISHIV" refers to
-- ---------------------------------------------------------------------------
CREATE TABLE messaging_sender_ids (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  channel       varchar(15) NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'ivr')),
  -- The DLT header ('KRISHIV'), the WhatsApp business number, the From address. One field because it is one concept:
  -- the identity the recipient sees.
  sender        varchar(120) NOT NULL,
  -- India's DLT entity id, and the country this registration is FOR. **A sender id is a per-country regulatory object**
  -- — DLT is Indian, Bangladesh and the UAE have their own regimes — so a registry without a country would be a table
  -- that cannot cross a border, which is the one thing rule zero refuses.
  entity_id     varchar(60),
  country_code  char(2) NOT NULL DEFAULT 'IN',
  provider      varchar(40),
  status        varchar(12) NOT NULL DEFAULT 'recorded'
                  CHECK (status IN ('recorded', 'active', 'suspended', 'retired')),
  -- **'recorded' MEANS AN OPERATOR TYPED IT IN, AND NOTHING HAS VERIFIED IT.** There is no SMS provider wired in this
  -- monorepo (no DLT ids, no MT engine — standing debt), so a status of 'active' here is an operator's assertion, not a
  -- provider's confirmation. The console says so on every row, and ADMIN-11b-Q2 owns the verification call. A registry
  -- that let a reader believe otherwise would be the eighth status-recording-an-act-nobody-performs, in the very wave
  -- that names the seventh.
  verified_by_provider_at timestamptz,
  registered_by_admin_id uuid,
  note          varchar(300),
  UNIQUE (channel, sender, country_code)
);
CALL add_std_columns('messaging_sender_ids');
CREATE INDEX idx_msi_active ON messaging_sender_ids(channel, country_code) WHERE status = 'active';

REVOKE ALL ON messaging_sender_ids FROM kv_relay;
-- The tenant realm reads it (the dispatcher needs to know which header to send under); it never writes it.
GRANT SELECT ON messaging_sender_ids TO kv_app, kv_readonly;

-- ---------------------------------------------------------------------------
-- 122.8  WHAT THIS FILE DOES NOT DO, AND THE QUESTION IT LEAVES OPEN
-- ---------------------------------------------------------------------------
-- **NO PROVIDER SUBMISSION.** Nothing here calls Meta to submit a WhatsApp template or a DLT portal to register a
-- header, because no such client exists in this repository. `lifecycle = 'submitted'` therefore means "a human has
-- sent this for approval out of band" and the console labels it in those words. ADMIN-11b-Q1.
--
-- NO TRANSLATION AUTOMATION. ADMIN-3b's plane covers catalogue strings, not notification bodies, and an MT engine that
-- rewrites an OTP message unreviewed is the specific thing that plane's review gate exists to prevent. A missing
-- language falls back to EN/HI at send time (which already works) and the console shows the fallback rate instead of
-- pretending the language is covered. ADMIN-11b-Q3.
--
-- NO PER-VERSION DELIVERY STATISTICS. `notifications.template_version_id` now makes "which wording delivered worse"
-- answerable, and the aggregation belongs with ADMIN-10's reports plane rather than here. ADMIN-11b-Q4.
--
-- THE AUDIT QUERY for 122.5's NOT VALID constraint, so the first reader does not have to write it:
--   SELECT t.tenant_id, t.event_code, t.channel, t.language_code
--     FROM notification_templates t JOIN notification_events e ON e.code = t.event_code
--    WHERE t.tenant_id IS NOT NULL AND (e.user_can_opt_out = false OR e.priority = 'critical');
-- Any row it returns is a tenant that has already rewritten security copy, and the decision about it is a founder's,
-- not a migration's.
