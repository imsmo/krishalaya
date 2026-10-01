-- ==================================================================================================================
-- MIGRATION 0180 — PC-56 TENANT-9a · THE KYC DESK — ROLE-SCOPED KYC TRUTH, THE ORGANISATION AS A SUBJECT
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0003, 0050, 0125 and 0128 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- WHAT THE SURVEY FOUND (survey_t9.md F-1 … F-7, F-12, F-15, F-18, F-19), RE-PROVEN AT 8e02b3d BEFORE THIS FILE:
--   • F-1  ONE AADHAAR eKYC MARKED EVERY ROLE THE PERSON HOLDS `verified` (`ekyc.service.ts:121`, `setKycStatus(…, null,
--          'verified')` — NULL role = all roles). TENANT-1 (0125) fixed the payout gate to read the PURPOSE's roles; the
--          writer that feeds it collapsed the person again, so an OTP done to collect wages opened a farmer's settlement.
--   • F-2  ONE DOCUMENT UPLOAD — A RENEWAL INCLUDED — MARKED EVERY ROLE `pending` (`kyc-document.service.ts:27`), so
--          renewing a licence stopped every payout the person was owed. W122: "the current verified licence keeps
--          working until its expiry, nothing pauses" — the code did the opposite. Review was "last document wins".
--   • F-3  `expired` WAS A STATUS NO CODE WROTE, AND `valid_until` GATED NOTHING. A lapsed licence stayed `verified`.
--   • F-4/F-5  THERE WAS NO ORGANISATION DOCUMENT (`kyc_documents.user_id NOT NULL`), and go-live's "organisation
--          verified" was ANY verified buyer business profile in the tenant, reviewed by the tenant itself.
--   • F-6  Evidence reveal was not a recorded act (and the reviewer could not reach the media).
--   • F-7  The review queue's keyset round-tripped a microsecond column through a millisecond JS Date (rows skipped).
--   • F-12 The 0175 class: `tenant_isolation_kyc_documents` was FOR ALL, `tenant_id IS NULL OR …`, NO WITH CHECK —
--          kv_app under any tenant context could INSERT a platform-level (NULL-tenant) `verified` document (proven, rolled back).
--   • F-18 No `kyc.*` permission existed; the desk was `user.approve` (tenant_admin).
--
-- WHAT THIS FILE DOES
--   180.1  VOCABULARY (Law 6). Organisation document types join the `doc_type` lookup (society / company registration,
--          PAN of the organisation, FSSAI licence, bank proof — `gst_cert` already exists and serves both subjects).
--          `kyc_decision_reason` — the coded grounds a desk refuses or asks for more on (meta.acts says which act may
--          use it, meta.needs_note whether the reviewer must add words). Inserted WHERE NOT EXISTS: the platform `doc_type`
--          rows are already duplicated on a from-empty database (the 0160 lookup-duplication finding), and this file
--          must not add a third copy.
--   180.2  THE REGISTRY, AS DATA (0125's pattern). `kyc_doc_types` — which document types the platform accepts for which
--          SUBJECT (a person, an organisation) and whether a validity date is required. `kyc_doc_type_roles` — WHICH ROLES
--          A DOCUMENT TYPE EVIDENCES. This is the F-1 fix's core: an eKYC success or a desk verification verifies ONLY
--          the roles its document type evidences, and a type with no rows evidences nothing (unknown fails strict, the
--          seventh time). `kyc_org_requirements` — which organisation document types are REQUIRED per COUNTRY (rule zero:
--          the Indian set is not the Bangladeshi set). All three are read by the tenant realm and written by nobody in it.
--   180.3  `kyc_documents` WIDENED. `subject_kind` (`user` | `organisation`), `organisation_id` (the tenant itself —
--          the organisation's licence is not the admin's personal document: the day the admin leaves, the FPO's FSSAI
--          stays), `user_id` NULLABLE, exactly one subject (CHECK); `doc_type_code` (by trigger from the lookup — so the
--          map joins on a stable code and the duplicated lookup ids cannot split one type in two); `submitted_by` (the
--          MAKER — backfilled to the subject for every legacy row, which were all self-submitted); `supersedes_id` (a
--          renewal or a resubmission is a NEW row pointing at the old one — the old one stays `verified` until its own
--          `valid_until`); `reason_code`, `last_decision`, `expired_at`, `expiry_reminded_at` (remind once — F-3's
--          reminder re-emitted every tick). Widened first, backfilled, THEN constrained. One open submission per subject
--          × document type (partial unique index; a preflight names any existing duplicates rather than guessing).
--   180.4  `kyc_document_decisions` — the HISTORY (W122) and the record of every act: submit · verify · reject ·
--          request_more · expire · reveal, with from/to status, the coded reason, the reviewer's note, who (NULL only for
--          the expiry job and the eKYC provider), via what, when, and the Idempotency-Key. Append-only (no UPDATE, no
--          DELETE granted). A REVEAL is a row here AND an audit row (1b's shape): the desk's decision is refused until the
--          decider has opened the evidence (evidence-before-decision — the W54-1 "blind approve" class).
--   180.5  THE GUARD (Law 5, in the database too). Born `pending` — except a provider attestation (`verify_method
--          'ekyc:%'`, a person, no human reviewer). Moves: pending → verified | rejected; verified → expired. Nothing else;
--          a renewal is a new row. A verify or reject names its reviewer, who is NEVER the maker and NEVER the person the
--          document is about; for an ORGANISATION document the reviewer must also not hold `tenant_admin` in that tenant —
--          THE TENANT'S OWN ADMIN CANNOT CERTIFY THE TENANT (F-4, `23514`). `expired` only once `valid_until` has passed
--          in the cooperative's own zone. An already-lapsed document cannot be submitted. A required validity is required.
--   180.6  `user_tenant_roles` — a role `verified` by a still-valid evidencing document cannot be moved off `verified`
--          (`23514`): F-2's "renewal stops the money", refused underneath the service too.
--   180.7  THE GATE READS VALIDITY (F-3). `kyc_tenant_today(tenant)`, `kyc_role_has_valid_document(…)`,
--          `kyc_role_effective_status(…)` — a role recorded `verified` whose evidencing documents have ALL lapsed reads
--          `expired` at the money gate even between expiry-job ticks. A role verified with no evidencing document on
--          file (legacy, or an approval path) reads as recorded: this file does not retro-decide history.
--          `kyc_organisation_status(tenant)` — "organisation verified" COMPUTED: every REQUIRED type for the tenant's
--          country has a verified, unexpired organisation document. A country with no declared requirement is NOT
--          verified (unknown refuses). Never a flag.
--   180.8  THE PERMISSIONS (F-18, 0128's lesson: a seed-only permission repairs a demo). `kyc.manage` (upload the
--          organisation's documents; submit a member's on their behalf — tenant_admin) and `kyc.review` (the verification
--          desk — tenant_admin, fpo_coordinator) as real rows, here AND in seed 0004. `member.pii.reveal` is NOT widened:
--          0128 kept it tenant_admin-only on purpose; a desk officer gets the reveal through a staff override.
--   180.9  THE WALL (F-12). RLS DECISION: `kyc_documents` keeps a nullable `tenant_id` (a platform-held document is a
--          legitimate admin-realm object), so the split is 0175's: SELECT admits NULL (read-only from the tenant realm);
--          INSERT and UPDATE are `tenant_id = current_tenant_id()` in USING + WITH CHECK; the admin realm named. The
--          decisions table is tenant-owned (NOT NULL), FOR ALL USING + WITH CHECK. ENABLE + FORCE restated on both.
--          PARTITION NOTE: neither table is partitioned (kyc_documents is a heap since 0003; the decisions table is small
--          per document and keyed by document) — no per-partition policy loop is needed. REVOKE ALL first, then column
--          grants; no DELETE anywhere.
-- ==================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 180.1  VOCABULARY
-- ---------------------------------------------------------------------------------------------------------------
-- THE REFERENCE DATA THIS FILE BINDS TO, GUARANTEED HERE (0174's shape; TENANT-4d-5's rule: seeds run AFTER migrations,
-- so a FK to `roles(code)` on a from-empty database fails unless the role exists by now). Rows copied EXACTLY from seed
-- 0004 / 0005, inserted only where absent — on a seeded database this block changes nothing.
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT v.code, v.default_name, v.scope, v.requires_kyc, v.requires_approval, v.module_code
  FROM (VALUES
  ('delivery_partner','Delivery Partner','tenant',true,true,'M07'),
  ('fpo_coordinator','FPO Coordinator','tenant',true,true,NULL),
  ('equipment_owner','Equipment Owner / CHC Operator','tenant',true,true,'M20'),
  ('banker','Banker / NBFC Loan Officer','tenant',true,true,'M19'),
  ('insurance_agent','Insurance Agent / Surveyor','tenant',true,true,'M19')
) AS v(code, default_name, scope, requires_kyc, requires_approval, module_code)
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = v.code);

INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('doc_type', 'Document type', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT 'doc_type', NULL, v.code, v.name, v.meta::jsonb, v.ord
  FROM (VALUES
    ('society_registration', 'Society / company registration certificate', '{"subject":"organisation"}', 10),
    ('pan_org',              'PAN (organisation)',                         '{"subject":"organisation"}', 11),
    ('fssai_licence',        'FSSAI licence',                              '{"subject":"organisation"}', 12),
    ('bank_proof',           'Bank proof (payout account)',                '{"subject":"organisation"}', 13)
  ) AS v(code, name, meta, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = 'doc_type' AND x.tenant_id IS NULL AND x.code = v.code);

INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
VALUES ('kyc_decision_reason', 'KYC decision reason', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT 'kyc_decision_reason', NULL, v.code, v.name, v.meta::jsonb, v.ord
  FROM (VALUES
    ('blurry_image',        'The photo is blurry or unreadable',               '{"acts":["reject","request_more"],"needs_note":false}', 1),
    ('back_side_missing',   'The other side of the document is missing',       '{"acts":["request_more"],"needs_note":false}', 2),
    ('incomplete_document', 'Pages or details are missing',                    '{"acts":["request_more"],"needs_note":false}', 3),
    ('wrong_document',      'This is not the document type submitted',         '{"acts":["reject"],"needs_note":false}', 4),
    ('name_mismatch',       'The name does not match the member or organisation','{"acts":["reject"],"needs_note":false}', 5),
    ('number_mismatch',     'The number does not match the document',          '{"acts":["reject"],"needs_note":false}', 6),
    ('document_expired',    'The document has already lapsed',                 '{"acts":["reject"],"needs_note":false}', 7),
    ('other',               'Another reason (the reviewer writes it)',         '{"acts":["reject","request_more"],"needs_note":true}', 99)
  ) AS v(code, name, meta, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = 'kyc_decision_reason' AND x.tenant_id IS NULL AND x.code = v.code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_kyc_reason_platform ON lookup_values (code)
  WHERE type_code = 'kyc_decision_reason' AND tenant_id IS NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 180.2  THE REGISTRY
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kyc_doc_types (
  code         varchar(80) NOT NULL,
  subject_kind varchar(15) NOT NULL CONSTRAINT ck_kdt_subject CHECK (subject_kind IN ('user', 'organisation')),
  -- `required`: a document of this type is meaningless without the date it lapses (a licence). `optional`: some carry one.
  validity     varchar(10) NOT NULL CONSTRAINT ck_kdt_validity CHECK (validity IN ('required', 'optional')),
  rationale    varchar(300) NOT NULL,
  PRIMARY KEY (code, subject_kind)
);
CALL add_std_columns('kyc_doc_types');

INSERT INTO kyc_doc_types (code, subject_kind, validity, rationale) VALUES
  ('aadhaar',              'user',         'optional', 'The national identity of a person; evidences the identity-only capacities (see kyc_doc_type_roles).'),
  ('pan',                  'user',         'optional', 'A person''s tax identity; evidences the trading and lending capacities.'),
  ('land_record',          'user',         'optional', 'The holding a farmer or livestock keeper produces from; evidences the seller capacities that carry it.'),
  ('gst_cert',             'user',         'optional', 'A trading person''s GST registration.'),
  ('rc',                   'user',         'optional', 'A vehicle registration certificate; evidences the delivery capacity.'),
  ('society_registration', 'organisation', 'optional', 'The cooperative''s or company''s registration certificate — who the organisation legally is.'),
  ('pan_org',              'organisation', 'optional', 'The organisation''s own PAN — the tax identity money is reported under.'),
  ('gst_cert',             'organisation', 'optional', 'The organisation''s GSTIN certificate.'),
  ('fssai_licence',        'organisation', 'required', 'The food-business licence; it lapses, so its date is part of the document.'),
  ('bank_proof',           'organisation', 'optional', 'Proof of the organisation''s payout account (cancelled cheque / bank letter).')
ON CONFLICT (code, subject_kind) DO NOTHING;

CREATE TABLE kyc_doc_type_roles (
  doc_type_code varchar(80) NOT NULL,
  -- Only a PERSON's document evidences a role; the column exists so the FK can say so.
  subject_kind  varchar(15) NOT NULL DEFAULT 'user' CONSTRAINT ck_kdtr_user CHECK (subject_kind = 'user'),
  role_code     varchar(50) NOT NULL REFERENCES roles(code),
  rationale     varchar(300) NOT NULL,
  PRIMARY KEY (doc_type_code, role_code),
  FOREIGN KEY (doc_type_code, subject_kind) REFERENCES kyc_doc_types (code, subject_kind)
);
CALL add_std_columns('kyc_doc_type_roles');

-- THE MAP, AND WHAT EACH LINE EXCLUDES. Read beside 0125: a settlement is claimed as a seller (farmer, dairy_farmer,
-- pashupalak, vyapari, organic_store), and NO identity-only document evidences a seller capacity — so an Aadhaar OTP done
-- for wages verifies the worker and the sardar and nothing a crop payout reads. A founder changes this table, not code.
INSERT INTO kyc_doc_type_roles (doc_type_code, role_code, rationale) VALUES
  ('aadhaar', 'worker',           'Wages are claimed against a muster: the identity of the person paid is what matters.'),
  ('aadhaar', 'sardar',           'A sardar receives crew wages; their identity is the check.'),
  ('aadhaar', 'delivery_partner', 'A delivery partner is identified as a person.'),
  ('aadhaar', 'ambassador',       'A village ambassador is identified as a person.'),
  ('aadhaar', 'fpo_coordinator',  'A coordinator is staff, identified as a person.'),
  ('aadhaar', 'tenant_admin',     'The organisation''s administrator, identified as a person.'),
  ('pan',     'vyapari',          'A trader settles and is taxed under their PAN.'),
  ('pan',     'pharma_store',     'An input store trades under its owner''s PAN.'),
  ('pan',     'organic_store',    'A producer-store trades under its owner''s PAN.'),
  ('pan',     'equipment_owner',  'Equipment rental income is reported under the owner''s PAN.'),
  ('pan',     'banker',           'A lender officer is identified by PAN.'),
  ('pan',     'insurance_agent',  'An insurance agent is licensed and paid under their PAN.'),
  ('land_record', 'farmer',       'Seller KYC carries the land record (0125: crop proceeds are claimed as a farmer).'),
  ('land_record', 'pashupalak',   'A livestock keeper''s holding record.'),
  ('land_record', 'dairy_farmer', 'A dairy member''s holding record.'),
  ('gst_cert', 'vyapari',         'A GST-registered trader.'),
  ('gst_cert', 'pharma_store',    'A GST-registered input store.'),
  ('gst_cert', 'organic_store',   'A GST-registered producer-store.'),
  ('rc',      'delivery_partner', 'The vehicle a delivery partner drives.')
ON CONFLICT (doc_type_code, role_code) DO NOTHING;

CREATE TABLE kyc_org_requirements (
  doc_type_code varchar(80) NOT NULL,
  subject_kind  varchar(15) NOT NULL DEFAULT 'organisation' CONSTRAINT ck_kor_org CHECK (subject_kind = 'organisation'),
  country_code  char(2) NOT NULL REFERENCES countries(code),
  is_required   boolean NOT NULL,
  rationale     varchar(300) NOT NULL,
  PRIMARY KEY (doc_type_code, country_code),
  FOREIGN KEY (doc_type_code, subject_kind) REFERENCES kyc_doc_types (code, subject_kind)
);
CALL add_std_columns('kyc_org_requirements');

-- W121's own sentence: "Start with the registration certificate and PAN — payouts unlock when both verify." So the two are
-- REQUIRED; GSTIN, FSSAI and bank proof are accepted and listed but do not decide "organisation verified" in India.
INSERT INTO kyc_org_requirements (doc_type_code, country_code, is_required, rationale)
SELECT v.code, 'IN', v.req, v.why
  FROM (VALUES
    ('society_registration', true,  'W121: the registration certificate is one of the two documents organisation verification needs.'),
    ('pan_org',              true,  'W121: the organisation''s PAN is the other.'),
    ('gst_cert',             false, 'Listed and verified when held; an unregistered cooperative below the threshold has none.'),
    ('fssai_licence',        false, 'Needed only by organisations selling food products.'),
    ('bank_proof',           false, 'Evidence of the payout account; the account itself is penny-verified separately.')
  ) AS v(code, req, why)
 WHERE EXISTS (SELECT 1 FROM countries WHERE code = 'IN')
ON CONFLICT (doc_type_code, country_code) DO NOTHING;

REVOKE ALL ON kyc_doc_types, kyc_doc_type_roles, kyc_org_requirements FROM kv_app, kv_relay;
GRANT SELECT ON kyc_doc_types, kyc_doc_type_roles, kyc_org_requirements TO kv_app, kv_relay, kv_readonly;

-- ---------------------------------------------------------------------------------------------------------------
-- 180.3  kyc_documents WIDENED (widen → backfill → constrain)
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE kyc_documents
  ADD COLUMN subject_kind       varchar(15) NOT NULL DEFAULT 'user',
  ADD COLUMN organisation_id    uuid REFERENCES tenants(id),
  ADD COLUMN doc_type_code      varchar(80),
  ADD COLUMN submitted_by       uuid REFERENCES users(id),
  ADD COLUMN supersedes_id      uuid REFERENCES kyc_documents(id),
  ADD COLUMN reason_code        varchar(60),
  ADD COLUMN last_decision      varchar(15),
  ADD COLUMN expired_at         timestamptz,
  ADD COLUMN expiry_reminded_at timestamptz;
ALTER TABLE kyc_documents ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE kyc_documents ADD COLUMN subject_ref uuid GENERATED ALWAYS AS (COALESCE(user_id, organisation_id)) STORED;

-- Backfill: the code from the lookup; every legacy row was self-submitted; legacy rejections carry free text → 'other'.
UPDATE kyc_documents d SET doc_type_code = lv.code FROM lookup_values lv WHERE lv.id = d.doc_type_id AND d.doc_type_code IS NULL;
UPDATE kyc_documents SET submitted_by = COALESCE(created_by, user_id) WHERE submitted_by IS NULL;
UPDATE kyc_documents SET reason_code = 'other' WHERE status = 'rejected' AND reason_code IS NULL;
UPDATE kyc_documents SET last_decision = CASE status WHEN 'verified' THEN 'verify' WHEN 'rejected' THEN 'reject' WHEN 'expired' THEN 'expire' ELSE 'submit' END
 WHERE last_decision IS NULL;
UPDATE kyc_documents SET expired_at = updated_at WHERE status = 'expired' AND expired_at IS NULL;

ALTER TABLE kyc_documents ALTER COLUMN doc_type_code SET NOT NULL;
ALTER TABLE kyc_documents ALTER COLUMN submitted_by SET NOT NULL;
ALTER TABLE kyc_documents ALTER COLUMN last_decision SET NOT NULL;
ALTER TABLE kyc_documents ALTER COLUMN last_decision SET DEFAULT 'submit';

ALTER TABLE kyc_documents
  ADD CONSTRAINT ck_kyc_subject_kind CHECK (subject_kind IN ('user', 'organisation')),
  ADD CONSTRAINT ck_kyc_one_subject CHECK (
       (subject_kind = 'user'         AND user_id IS NOT NULL AND organisation_id IS NULL)
    OR (subject_kind = 'organisation' AND user_id IS NULL AND organisation_id IS NOT NULL AND tenant_id IS NOT NULL AND organisation_id = tenant_id)),
  ADD CONSTRAINT ck_kyc_validity_order CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  ADD CONSTRAINT ck_kyc_last_decision CHECK (last_decision IN ('submit', 'verify', 'reject', 'request_more', 'expire')),
  ADD CONSTRAINT ck_kyc_rejected_says_why CHECK (status <> 'rejected' OR reason_code IS NOT NULL),
  ADD CONSTRAINT ck_kyc_expired_when CHECK (status <> 'expired' OR (expired_at IS NOT NULL AND valid_until IS NOT NULL)),
  ADD CONSTRAINT ck_kyc_decided_when CHECK (status NOT IN ('verified', 'rejected') OR reviewed_at IS NOT NULL),
  ADD CONSTRAINT ck_kyc_not_own_successor CHECK (supersedes_id IS NULL OR supersedes_id <> id);

-- One open submission per subject × document type. A preflight NAMES existing duplicates rather than choosing which
-- of somebody's two pending submissions to throw away.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM kyc_documents WHERE status = 'pending' AND deleted_at IS NULL
     GROUP BY tenant_id, subject_kind, subject_ref, doc_type_code HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION '0180: % subject × document type groups hold more than one pending KYC submission — resolve them (decide or soft-delete the extra rows) before applying', n;
  END IF;
END $$;
CREATE UNIQUE INDEX uq_kyc_open_submission ON kyc_documents (tenant_id, subject_kind, subject_ref, doc_type_code)
  WHERE status = 'pending' AND deleted_at IS NULL;
-- The desk's queue keyset (created_at DESC, id DESC) per status, and the subject lookups the role derivation does.
CREATE INDEX idx_kyc_desk_queue ON kyc_documents (tenant_id, status, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_kyc_subject ON kyc_documents (tenant_id, subject_kind, subject_ref) WHERE deleted_at IS NULL;
CREATE INDEX idx_kyc_due_expiry ON kyc_documents (tenant_id, valid_until) WHERE status = 'verified' AND valid_until IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 180.4  THE DECISIONS (history + every act)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kyc_document_decisions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  document_id     uuid NOT NULL REFERENCES kyc_documents(id),
  act             varchar(15) NOT NULL CONSTRAINT ck_kdd_act CHECK (act IN ('submit', 'verify', 'reject', 'request_more', 'expire', 'reveal')),
  from_status     kyc_status,
  to_status       kyc_status NOT NULL,
  reason_code     varchar(60),
  note            varchar(500),
  decided_by      uuid REFERENCES users(id),
  via             varchar(15) NOT NULL CONSTRAINT ck_kdd_via CHECK (via IN ('desk', 'submitter', 'ekyc', 'expiry_job')),
  idempotency_key varchar(100),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_kdd_refusal_says_why CHECK (act NOT IN ('reject', 'request_more') OR reason_code IS NOT NULL),
  CONSTRAINT ck_kdd_reveal_reasoned CHECK (act <> 'reveal' OR (decided_by IS NOT NULL AND note IS NOT NULL AND char_length(btrim(note)) >= 20 AND from_status = to_status)),
  CONSTRAINT ck_kdd_human_acts CHECK (act NOT IN ('reject', 'request_more', 'reveal', 'submit') OR decided_by IS NOT NULL),
  CONSTRAINT ck_kdd_verify_who CHECK (act <> 'verify' OR (via = 'desk' AND decided_by IS NOT NULL) OR (via = 'ekyc' AND decided_by IS NULL)),
  CONSTRAINT ck_kdd_expire_job CHECK (act <> 'expire' OR (via = 'expiry_job' AND decided_by IS NULL AND to_status = 'expired'))
);
CALL add_std_columns('kyc_document_decisions');
CREATE INDEX idx_kdd_document ON kyc_document_decisions (document_id, decided_at DESC, id DESC);
CREATE UNIQUE INDEX uq_kdd_key ON kyc_document_decisions (tenant_id, idempotency_key, act) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_kyc_document_decisions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; meta jsonb;
BEGIN
  SELECT tenant_id INTO d FROM kyc_documents WHERE id = NEW.document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kyc_document_decisions: document % is not visible to this session — PC-56 TENANT-9a', NEW.document_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF d.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'kyc_document_decisions: the decision''s tenant must be the document''s — PC-56 TENANT-9a' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reason_code IS NOT NULL THEN
    SELECT lv.meta INTO meta FROM lookup_values lv
     WHERE lv.type_code = 'kyc_decision_reason' AND lv.tenant_id IS NULL AND lv.code = NEW.reason_code AND lv.is_active;
    IF meta IS NULL THEN
      RAISE EXCEPTION 'kyc_document_decisions: % is not in the kyc_decision_reason vocabulary — PC-56 TENANT-9a', NEW.reason_code USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (meta -> 'acts') ? NEW.act THEN
      RAISE EXCEPTION 'kyc_document_decisions: reason % is not a ground for %', NEW.reason_code, NEW.act USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE((meta ->> 'needs_note')::boolean, false) AND char_length(btrim(COALESCE(NEW.note, ''))) < 3 THEN
      RAISE EXCEPTION 'kyc_document_decisions: reason % needs the reviewer''s own words', NEW.reason_code USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_kyc_document_decisions_guard BEFORE INSERT ON kyc_document_decisions
  FOR EACH ROW EXECUTE FUNCTION trg_kyc_document_decisions_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- 180.7 (first: the guard and the gate need them)  THE CLOCK AND THE DERIVED READS
-- ---------------------------------------------------------------------------------------------------------------
-- "Today" is the cooperative's own date (tenants → countries.timezone, 7c's resolution). A licence valid until 30 Sep is
-- valid through 30 Sep in Anand. A tenant with no zone on file reads UTC — named in the 9a report.
CREATE OR REPLACE FUNCTION kyc_tenant_today(p_tenant uuid) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (now() AT TIME ZONE c.timezone)::date FROM tenants t JOIN countries c ON c.code = t.country_code
      WHERE t.id = p_tenant AND c.timezone IS NOT NULL),
    (now() AT TIME ZONE 'UTC')::date)
$$;

-- Does this person hold, in this tenant, a VERIFIED and UNEXPIRED document whose type evidences this role?
CREATE OR REPLACE FUNCTION kyc_role_has_valid_document(p_tenant uuid, p_user uuid, p_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM kyc_documents k
      JOIN kyc_doc_type_roles m ON m.doc_type_code = k.doc_type_code AND m.role_code = p_role_code AND m.deleted_at IS NULL
     WHERE k.tenant_id = p_tenant AND k.subject_kind = 'user' AND k.user_id = p_user AND k.deleted_at IS NULL
       AND k.status = 'verified' AND (k.valid_until IS NULL OR k.valid_until >= kyc_tenant_today(p_tenant))
       AND (k.role_id IS NULL OR k.role_id = (SELECT r.id FROM roles r WHERE r.code = p_role_code)))
$$;

-- THE MONEY GATE'S READ (F-3). Recorded `verified`, an evidencing document on file, none of them still valid → `expired`.
CREATE OR REPLACE FUNCTION kyc_role_effective_status(p_tenant uuid, p_user uuid, p_role_code text, p_recorded text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_recorded = 'verified'
     AND EXISTS (SELECT 1 FROM kyc_documents k
                   JOIN kyc_doc_type_roles m ON m.doc_type_code = k.doc_type_code AND m.role_code = p_role_code AND m.deleted_at IS NULL
                  WHERE k.tenant_id = p_tenant AND k.subject_kind = 'user' AND k.user_id = p_user AND k.deleted_at IS NULL
                    AND k.status IN ('verified', 'expired')
                    AND (k.role_id IS NULL OR k.role_id = (SELECT r.id FROM roles r WHERE r.code = p_role_code)))
     AND NOT kyc_role_has_valid_document(p_tenant, p_user, p_role_code)
    THEN 'expired' ELSE p_recorded END
$$;

-- "ORGANISATION VERIFIED", COMPUTED (F-4). Never a flag.
CREATE OR REPLACE FUNCTION kyc_organisation_status(p_tenant uuid)
RETURNS TABLE (verified boolean, verified_at timestamptz, required_count int, satisfied_count int) LANGUAGE sql STABLE AS $$
  WITH req AS (
    SELECT r.doc_type_code FROM kyc_org_requirements r JOIN tenants t ON t.country_code = r.country_code
     WHERE t.id = p_tenant AND r.is_required AND r.deleted_at IS NULL),
  ok AS (
    SELECT req.doc_type_code, min(k.reviewed_at) AS at FROM req
      JOIN kyc_documents k ON k.doc_type_code = req.doc_type_code AND k.tenant_id = p_tenant AND k.subject_kind = 'organisation'
       AND k.organisation_id = p_tenant AND k.status = 'verified' AND k.deleted_at IS NULL
       AND (k.valid_until IS NULL OR k.valid_until >= kyc_tenant_today(p_tenant))
     GROUP BY req.doc_type_code)
  SELECT (SELECT count(*) FROM req) > 0 AND (SELECT count(*) FROM ok) = (SELECT count(*) FROM req),
         CASE WHEN (SELECT count(*) FROM req) > 0 AND (SELECT count(*) FROM ok) = (SELECT count(*) FROM req) THEN (SELECT max(at) FROM ok) END,
         (SELECT count(*) FROM req)::int, (SELECT count(*) FROM ok)::int
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 180.5  THE GUARD ON kyc_documents
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_kyc_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dt record; v_code text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT code INTO v_code FROM lookup_values WHERE id = NEW.doc_type_id AND type_code = 'doc_type';
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'kyc_documents: % is not a doc_type lookup value — PC-56 TENANT-9a', NEW.doc_type_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.doc_type_code := v_code;
    SELECT * INTO dt FROM kyc_doc_types WHERE code = v_code AND subject_kind = NEW.subject_kind AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kyc_documents: % is not a document type the registry accepts for a % — PC-56 TENANT-9a', v_code, NEW.subject_kind USING ERRCODE = 'check_violation';
    END IF;
    IF dt.validity = 'required' AND NEW.valid_until IS NULL THEN
      RAISE EXCEPTION 'kyc_documents: a % carries the date it lapses — valid_until is required', v_code USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.valid_until IS NOT NULL AND NEW.valid_until < kyc_tenant_today(NEW.tenant_id) THEN
      RAISE EXCEPTION 'kyc_documents: a document that lapsed on % cannot be submitted', NEW.valid_until USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'pending' THEN
      NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.last_decision := 'submit';
    ELSIF NEW.status = 'verified' AND NEW.subject_kind = 'user' AND NEW.verify_method LIKE 'ekyc:%' AND NEW.reviewed_by IS NULL THEN
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now()); NEW.last_decision := 'verify';
    ELSE
      RAISE EXCEPTION 'kyc_documents: a document is born pending (only a provider attestation of a person is born verified) — got %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.doc_type_id IS DISTINCT FROM OLD.doc_type_id OR NEW.doc_type_code IS DISTINCT FROM OLD.doc_type_code
     OR NEW.media_id IS DISTINCT FROM OLD.media_id OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'kyc_documents %: the subject, type, evidence and validity of a submitted document are fixed — a renewal is a new document', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('verified', 'rejected')) OR (OLD.status = 'verified' AND NEW.status = 'expired')) THEN
      RAISE EXCEPTION 'kyc_documents %: % → % is not a move a document makes', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('verified', 'rejected') THEN
      IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'kyc_documents %: a desk decision names its reviewer', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.reviewed_by = NEW.submitted_by THEN
        RAISE EXCEPTION 'kyc_documents %: the person who submitted a document cannot decide it — PC-56 TENANT-9a maker-checker', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.subject_kind = 'user' AND NEW.reviewed_by = NEW.user_id THEN
        RAISE EXCEPTION 'kyc_documents %: nobody decides their own KYC document — PC-56 TENANT-9a', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.subject_kind = 'organisation' AND EXISTS (
           SELECT 1 FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
            WHERE utr.tenant_id = NEW.tenant_id AND utr.user_id = NEW.reviewed_by AND r.code = 'tenant_admin'
              AND utr.is_active AND utr.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'kyc_documents %: the organisation''s own administrator cannot certify the organisation''s documents — PC-56 TENANT-9a self-certification', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    END IF;
    IF NEW.status = 'expired' THEN
      IF NEW.valid_until IS NULL OR NEW.valid_until >= kyc_tenant_today(NEW.tenant_id) THEN
        RAISE EXCEPTION 'kyc_documents %: a document expires only after its valid_until has passed in the cooperative''s zone', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      NEW.expired_at := COALESCE(NEW.expired_at, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_kyc_documents_guard BEFORE INSERT OR UPDATE ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION trg_kyc_documents_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- 180.6  A ROLE VERIFIED BY A STILL-VALID DOCUMENT STAYS VERIFIED (F-2, underneath the service)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_utr_kyc_no_downgrade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_role text;
BEGIN
  IF OLD.kyc_status = 'verified' AND NEW.kyc_status IS DISTINCT FROM 'verified' AND NEW.deleted_at IS NULL THEN
    SELECT code INTO v_role FROM roles WHERE id = NEW.role_id;
    IF kyc_role_has_valid_document(NEW.tenant_id, NEW.user_id, v_role) THEN
      RAISE EXCEPTION 'user_tenant_roles %: the % role is verified by a document that is still valid — it cannot be moved to % (a renewal never pauses money) — PC-56 TENANT-9a', NEW.id, v_role, NEW.kyc_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_utr_kyc_no_downgrade BEFORE UPDATE OF kyc_status ON user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION trg_utr_kyc_no_downgrade();

-- ---------------------------------------------------------------------------------------------------------------
-- 180.8  THE PERMISSIONS (rows here AND in seed 0004)
-- ---------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('kyc.manage', 'Upload the organisation''s KYC documents; submit a member''s document on their behalf', 'M01'),
  ('kyc.review', 'Verification desk: verify, reject or ask for more on a KYC document (never one you submitted, never your own, never your organisation''s as its admin)', 'M01')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (r.code = 'tenant_admin' AND p.code IN ('kyc.manage', 'kyc.review'))
    OR (r.code = 'fpo_coordinator' AND p.code = 'kyc.review')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- 180.9  THE WALL
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_kyc_documents ON kyc_documents;
CREATE POLICY kd_read   ON kyc_documents FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY kd_insert ON kyc_documents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY kd_update ON kyc_documents FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY kd_admin_realm ON kyc_documents FOR ALL TO kv_admin USING (true) WITH CHECK (true);

ALTER TABLE kyc_document_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_document_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY kdd_tenant ON kyc_document_decisions FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY kdd_admin_realm ON kyc_document_decisions FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON kyc_documents FROM kv_app, kv_relay;
GRANT SELECT ON kyc_documents TO kv_app, kv_relay, kv_readonly;
GRANT INSERT (id, tenant_id, subject_kind, user_id, organisation_id, role_id, doc_type_id, media_id, doc_no_masked, issued_by,
              valid_from, valid_until, status, verify_method, verify_payload, reviewed_by, reviewed_at, submitted_by,
              supersedes_id, last_decision, created_by, updated_by) ON kyc_documents TO kv_app;
GRANT UPDATE (status, reviewed_by, reviewed_at, reject_reason, reason_code, last_decision, expired_at, expiry_reminded_at,
              updated_at, updated_by) ON kyc_documents TO kv_app;

REVOKE ALL ON kyc_document_decisions FROM kv_app, kv_relay;
GRANT SELECT ON kyc_document_decisions TO kv_app, kv_readonly;
GRANT INSERT (id, tenant_id, document_id, act, from_status, to_status, reason_code, note, decided_by, via, idempotency_key,
              decided_at, created_by, updated_by) ON kyc_document_decisions TO kv_app;

COMMENT ON TABLE kyc_doc_type_roles IS 'Which ROLES a person''s document type evidences (0180). An eKYC success or a desk verification verifies ONLY these roles; a type with no rows evidences nothing. Before 0180 one Aadhaar OTP verified every role the person held.';
COMMENT ON TABLE kyc_document_decisions IS 'Every act on a KYC document (submit, verify, reject, request_more, expire, reveal) — the W122 history. Append-only. A reveal is also an audit row.';
COMMENT ON FUNCTION kyc_organisation_status(uuid) IS 'Organisation verified = every REQUIRED organisation document type for the tenant''s country verified and unexpired (0180). No requirement declared → not verified.';
