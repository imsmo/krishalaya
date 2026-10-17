-- ==================================================================================================================
-- MIGRATION 0219 — PC-56 STORE-5b · TRACE YOU CAN CHECK, CERTIFICATES YOU CAN BELIEVE
-- (canon W303 trace · W304 verify · W305 certificate · W306 dairy trace (refused) · W3154–W3155 the trace export · W3086–W3088 and
--  W3156–W3158 DECOR reloads — the last 12 files of STORE-5; survey_store5.md §1B–§1E, §1I–§1K, §2 F-7 F-8 F-9 F-14 F-15, §3 B10–B21 B27)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0218 are applied; nothing here edits them: 0217's `trace_scan_v2` stays and
-- is no longer called; 0214's `kv_personal_export_job_tenant` is REPLACED by a new body here (CREATE OR REPLACE — same signature), not by
-- editing 0214; 0204's `reserved_tenant_slugs` gains a row by INSERT.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written. The canon's "where the money went" split is REFUSED (founder D5).
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey STORE-5 F-7 / F-8 / F-9 / C-3 / C-5 / C-9 — verified at 83503aba, STORE-5a):
--   • C-9  `cert_type` had a TYPE row (seed core/0005) and NO VALUE anywhere: `certificates.cert_type_id NOT NULL REFERENCES lookup_values` could
--          not be satisfied from an empty database.
--   • F-7  a listing's "certified organic" was its seller's own word (`listings.organic_claim`), never backed by a certificate; a certificate
--          kept no verification instant and no rejection reason; nothing public could read one.
--   • F-9  the chain hashed `JSON.stringify(meta)` as written (jsonb reorders keys — a multi-key meta could not be recomputed from the stored
--          row) and did not hash the event's time; the anchor job was never registered and stamped a lot only once.
--   • the lot's certificates were free uuids in `trace_lots.certificate_ids` (jsonb, no FK) — a third, unconnected "certificate" store.
--
-- WHAT IS TRUE NOW (founder decisions 2026-10-17, STORE-5b D1–D8):
--   219.1  D1 — the `cert_type` VOCABULARY: seven PLATFORM values (tenant_id NULL — the type row says not tenant-extendable) npop · pgs_india ·
--          usda_organic · gi_tag · lab_report · gap · halal, each `meta.organic` true|false (Law 6: WHICH types make a lot "certified organic"
--          is data — the three organic schemes say true), with Hindi and Gujarati names as rows of `translations` (entity_type 'lookup_value',
--          field 'name', human-authored, `source = 'migration:0219'` — the 0218 path `GET /v1/lookups/values?type=` already serves).
--   219.2  D1 — `certificates.verified_at timestamptz` (stamped by `verify` — the instant "checked by <organisation> on <date>" prints; NOT
--          backfilled: a certificate verified before 0219 has no recorded instant and the page prints no date rather than invent one) and
--          `certificates.rejection_reason varchar(500)` (stamped by `reject` — "a rejection is part of the record").
--   219.3  D3 — `trace_events.hash_version smallint NOT NULL DEFAULT 1` on the PARTITIONED parent (PostgreSQL adds the column to every existing
--          partition and every future one inherits it; `ensure-partitions --strict` and the `--months 18` run prove it). v1 = the old formula
--          (`sha256(prev|lot|code|JSON.stringify(meta))`, recorded rows keep it — the verify read says "written before version 2"); v2 = the
--          canonical formula the API writes from now on (`sha256(prev|lot|code|canonical(meta)|createdAt)`, the instant as
--          YYYY-MM-DDTHH:MM:SS.ffffffZ in UTC — the `atUs` the v3 projection prints, the same text the API hashed). `trace_lots.anchored_at
--          timestamptz` and `trace_lots.anchored_event_count int` — the daily platform SEAL (the chain head is `blockchain_anchor`, stamped with
--          the instant and the number of events it covers). "Written to a public ledger" / polygon / block numbers are refused by name.
--   219.4  D1 / B19 — ONE certificate model for a lot: `trace_lot_certificates (tenant_id, trace_lot_id, certificate_id)` PRIMARY KEY (lot,
--          certificate) — RLS ENABLED + FORCED, the house tenant policy (the RLS gate counts ONE more policy), kv_app SELECT / INSERT / DELETE,
--          kv_readonly SELECT, kv_relay nothing. BACKFILLED from `trace_lots.certificate_ids` where the element is a uuid of a certificate of the
--          SAME organisation (a foreign or unknown id is dropped — it was never a certificate of this lot). The jsonb column is kept and no
--          longer read.
--   219.5  THE PUBLIC READS (SECURITY DEFINER, `SET search_path = public`, REVOKE ALL FROM PUBLIC, EXECUTE to kv_app only — the 0204 / 0217
--          house rule):
--            `trace_meta_allow(step)`            the per-step meta allow-list (IMMUTABLE; the MIRROR of apps/api traceability/domain/trace-meta.ts
--                                                 — the parity spec reads the WHEN lines below as it reads 0217's);
--            `trace_scan_v3(token)`              D3 / D4 / D8: for a LIVE organisation (`public_tenant_live`) — the organisation (display name +
--                                                 slug, never a person), the product title and the lot's quantity + unit (from the listing), the
--                                                 place as the VILLAGE and DISTRICT names of the parcel's admin region (never a coordinate, never
--                                                 the parcel), every event's number, code, instant (and its µs text), hash version, hash and
--                                                 allow-listed meta (+ `metaHidden` when the stored meta carries a key the public allow-list drops
--                                                 — the verify read reports that event as a mismatch), the seal, the lot's certificates (id, type
--                                                 code, status, valid until) from 219.4; `lotId` and `tenantId` for the API (stripped from every
--                                                 answer). NEVER `farmer_user_id`, a name, a phone, GPS, `declared_inputs` or a listing uuid. For a lot
--                                                 whose organisation is NOT live it answers ONLY `{live:false, wasLive}` (no field of the lot): the
--                                                 API says TRACE_NO_LONGER_PUBLISHED when the organisation WAS live (suspended / archived /
--                                                 terminated / deleted) and TRACE_SCAN_NOT_FOUND for one that never was (pending / trial — the
--                                                 HOTFIX-7 answer kept);
--            `public_certificate(id)` and `public_certificate_by_no(tenant, no)`   D1: NULL unless the organisation is live; the certificate
--                                                 id, `tenantId` (stripped by the API), the organisation (display name + slug), the type CODE, the
--                                                 number, the issuing body, the validity, the status (+ `expired` computed when `valid_until` is
--                                                 past even before the clock ran), the subject KIND, the covered listing's TITLE when it is a public
--                                                 listing, `verifiedAt`, the verifier's ROLE code in that organisation (`user_tenant_roles` →
--                                                 `roles.code`, the role that grants `certificate.verify` first) — NEVER the person — and the
--                                                 rejection reason of a rejected certificate. NO owner id, NO media id, NO verifier id.
--   219.6  D2 — the export plane's requester-only lookup (0214's `kv_personal_export_job_tenant`) now answers for `traceability.lot_record`
--          too: a requester signed in at another organisation still reads their own trace-record job (one uuid; NULL for anybody else's).
--   219.7  Law 10 — the `certificates_public` flag row (OFF) INSERTED WHERE MISSING (the 0215 pattern: migrations run before seeds from empty;
--          seed core/0009 carries the same row, ON CONFLICT DO NOTHING).
--   219.8  B27 — the reserved slug `certificates` (the platform's `/certificates` page; `trace` is reserved since 0204).
--
-- THE BADGE RULE (D1 / B18) IS CODE, NOT A FUNCTION HERE: apps/api `listings/read-models/certified.sql.ts` `CERTIFIED_SQL` is applied by the
-- public search read model and the listing detail's facts. 0204's `public_discovery_feed` emits a BOOLEAN "organic" (either claim) that the
-- platform card prints as "Organic" — never "certified" — so it is not a certified chip and is NOT replaced (named in the wave report).
--
-- RLS / GRANTS DECISION: one table is created (219.4, the policy above); `certificates` / `trace_lots` / `trace_events` keep their policies and
-- table-level grants (new nullable / defaulted columns inherit them). `lookup_values` / `translations` / `feature_flags` / `reserved_tenant_slugs`
-- are platform registries (unchanged grants). Partition pass: `trace_events` is partitioned — 219.3 adds a column to the parent only.
--
-- REVERSAL (documented, not automatic; the API must be reverted first — it names every object below):
--   DELETE FROM reserved_tenant_slugs WHERE slug = 'certificates';
--   DELETE FROM feature_flags WHERE key = 'certificates_public';                 -- (and seed core/0009's row)
--   restore 0214's body of kv_personal_export_job_tenant (dataset_code = 'identity.dpdp_person' only);
--   DROP FUNCTION IF EXISTS public_certificate_by_no(uuid, text); DROP FUNCTION IF EXISTS public_certificate(uuid);
--   DROP FUNCTION IF EXISTS trace_scan_v3(text); DROP FUNCTION IF EXISTS trace_meta_allow(text);
--   DROP TABLE IF EXISTS trace_lot_certificates;                                 -- trace_lots.certificate_ids still holds the old ids
--   ALTER TABLE trace_lots DROP COLUMN IF EXISTS anchored_event_count, DROP COLUMN IF EXISTS anchored_at;
--   ALTER TABLE trace_events DROP COLUMN IF EXISTS hash_version;                 -- v2 rows then verify as v1 — they would MISMATCH: do not
--   ALTER TABLE certificates DROP COLUMN IF EXISTS rejection_reason, DROP COLUMN IF EXISTS verified_at;
--   the seven cert_type values cannot be deleted once a certificate names one — deactivate: UPDATE lookup_values SET is_active = false
--     WHERE type_code = 'cert_type' AND tenant_id IS NULL;
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 219.1  the certificate types — a platform vocabulary (the type row exists since seed core/0005; inserted here where missing so a database
--        built from empty, where migrations run before seeds, has it), with their Hindi and Gujarati names
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('cert_type', 'Certificate type', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('cert_type', 'npop',         'NPOP (India Organic)',             '{"organic": true}',  1),
    ('cert_type', 'pgs_india',    'PGS-India Organic',                '{"organic": true}',  2),
    ('cert_type', 'usda_organic', 'USDA Organic',                     '{"organic": true}',  3),
    ('cert_type', 'gi_tag',       'Geographical Indication (GI) tag', '{"organic": false}', 4),
    ('cert_type', 'lab_report',   'Laboratory test report',           '{"organic": false}', 5),
    ('cert_type', 'gap',          'Good Agricultural Practices (GAP)', '{"organic": false}', 6),
    ('cert_type', 'halal',        'Halal',                            '{"organic": false}', 7)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

INSERT INTO translations (entity_type, entity_id, field, language_code, text, is_machine, source)
SELECT 'lookup_value', lv.id, 'name', v.lang, v.label, false, 'migration:0219'
  FROM (VALUES
    ('npop',         'hi', 'एनपीओपी (इंडिया ऑर्गेनिक)'),          ('npop',         'gu', 'એનપીઓપી (ઇન્ડિયા ઓર્ગેનિક)'),
    ('pgs_india',    'hi', 'पीजीएस-इंडिया ऑर्गेनिक'),              ('pgs_india',    'gu', 'પીજીએસ-ઇન્ડિયા ઓર્ગેનિક'),
    ('usda_organic', 'hi', 'यूएसडीए ऑर्गेनिक'),                   ('usda_organic', 'gu', 'યુએસડીએ ઓર્ગેનિક'),
    ('gi_tag',       'hi', 'भौगोलिक संकेत (GI) टैग'),              ('gi_tag',       'gu', 'ભૌગોલિક સંકેત (GI) ટૅગ'),
    ('lab_report',   'hi', 'प्रयोगशाला जाँच रिपोर्ट'),              ('lab_report',   'gu', 'પ્રયોગશાળા તપાસ અહેવાલ'),
    ('gap',          'hi', 'उत्तम कृषि पद्धतियाँ (GAP)'),           ('gap',          'gu', 'ઉત્તમ કૃષિ પદ્ધતિઓ (GAP)'),
    ('halal',        'hi', 'हलाल'),                                ('halal',        'gu', 'હલાલ')
  ) AS v(code, lang, label)
  JOIN lookup_values lv ON lv.type_code = 'cert_type' AND lv.tenant_id IS NULL AND lv.code = v.code
ON CONFLICT (entity_type, entity_id, field, language_code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 219.2  the certificate's own record of its check
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS rejection_reason varchar(500);
COMMENT ON COLUMN certificates.verified_at IS
  'PC-56 STORE-5b (0219, founder D1): the instant the organisation''s staff verified this certificate (stamped by verify). NULL for a certificate '
  'verified before 0219 — the public page then prints no date rather than invent one.';
COMMENT ON COLUMN certificates.rejection_reason IS
  'PC-56 STORE-5b (0219, founder D1): why it was rejected (stamped by reject) — "a rejection is part of the record"; served on the public page.';

-- ------------------------------------------------------------------------------------------------------------------
-- 219.3  the hash version on every journey event (the partitioned parent) and the daily seal on the lot
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE trace_events ADD COLUMN IF NOT EXISTS hash_version smallint NOT NULL DEFAULT 1;
COMMENT ON COLUMN trace_events.hash_version IS
  'PC-56 STORE-5b (0219, founder D3): 1 = sha256(prev|lot|code|JSON.stringify(meta)) as written before 0219 (not recomputable from the stored jsonb '
  'for a multi-key meta); 2 = sha256(prev|lot|code|canonical(meta)|created_at as YYYY-MM-DDTHH:MM:SS.ffffffZ UTC) — the API writes 2 from 0219 on.';
ALTER TABLE trace_lots ADD COLUMN IF NOT EXISTS anchored_at timestamptz;
ALTER TABLE trace_lots ADD COLUMN IF NOT EXISTS anchored_event_count int;
COMMENT ON COLUMN trace_lots.anchored_at IS
  'PC-56 STORE-5b (0219, founder D3): when the platform''s daily seal last stamped blockchain_anchor with the chain head. A platform seal — not a '
  'public ledger. NULL = never sealed.';
COMMENT ON COLUMN trace_lots.anchored_event_count IS
  'PC-56 STORE-5b (0219, founder D3): how many journey events the seal at anchored_at covered.';

-- ------------------------------------------------------------------------------------------------------------------
-- 219.4  ONE certificate model for a lot (+ RLS, grants, backfill)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trace_lot_certificates (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  trace_lot_id    uuid NOT NULL REFERENCES trace_lots(id),
  certificate_id  uuid NOT NULL REFERENCES certificates(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trace_lot_id, certificate_id)
);
CREATE INDEX IF NOT EXISTS idx_trace_lot_certificates_cert ON trace_lot_certificates (certificate_id);
COMMENT ON TABLE trace_lot_certificates IS
  'PC-56 STORE-5b (0219, founder D1 / B19): which certificates a trace lot carries — the ONE link (trace_lots.certificate_ids is kept and no longer '
  'read). Written by the lot''s create; read by trace_scan_v3. kv_app SELECT / INSERT / DELETE.';

DO $$
BEGIN
  EXECUTE 'ALTER TABLE trace_lot_certificates ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE trace_lot_certificates FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_trace_lot_certificates ON trace_lot_certificates';
  EXECUTE 'CREATE POLICY tenant_isolation_trace_lot_certificates ON trace_lot_certificates USING (tenant_id IS NULL OR tenant_id = current_tenant_id())';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_app') THEN EXECUTE 'REVOKE ALL ON trace_lot_certificates FROM kv_app'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_relay') THEN EXECUTE 'REVOKE ALL ON trace_lot_certificates FROM kv_relay'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_app') THEN EXECUTE 'GRANT SELECT, INSERT, DELETE ON trace_lot_certificates TO kv_app'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_readonly') THEN EXECUTE 'GRANT SELECT ON trace_lot_certificates TO kv_readonly'; END IF;
END $$;

-- the backfill: an element of certificate_ids that is a uuid of a certificate of the SAME organisation (anything else was never this lot's)
INSERT INTO trace_lot_certificates (tenant_id, trace_lot_id, certificate_id)
SELECT DISTINCT l.tenant_id, l.id, c.id
  FROM trace_lots l
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.certificate_ids) = 'array' THEN l.certificate_ids ELSE '[]'::jsonb END) AS x(v)
  JOIN certificates c ON x.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND c.id = x.v::uuid AND c.tenant_id = l.tenant_id
 WHERE l.deleted_at IS NULL
ON CONFLICT (trace_lot_id, certificate_id) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 219.5  the public reads
-- ------------------------------------------------------------------------------------------------------------------
-- The allow-list (keys per step). MIRROR of apps/api/src/modules/traceability/domain/trace-meta.ts `TRACE_META_ALLOW` — the parity spec reads
-- the WHEN lines below (as it reads 0217's); keep one step per line, in the form  WHEN '<step>' THEN ARRAY['k1','k2']::text[]
CREATE OR REPLACE FUNCTION trace_meta_allow(p_step text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_step
           WHEN 'harvested'  THEN ARRAY['variety','season','gradeLabel','quantity','unit']::text[]
           WHEN 'listed'     THEN ARRAY['gradeLabel','quantity','unit']::text[]
           WHEN 'sold'       THEN ARRAY['quantity','unit']::text[]
           WHEN 'packed'     THEN ARRAY['packType','packCount','quantity','unit']::text[]
           WHEN 'picked'     THEN ARRAY['quantity','unit']::text[]
           WHEN 'in_transit' THEN ARRAY['mode']::text[]
           WHEN 'delivered'  THEN ARRAY['quantity','unit']::text[]
           WHEN 'recalled'   THEN ARRAY['reasonCode']::text[]
           ELSE ARRAY[]::text[]
         END
$$;
REVOKE ALL ON FUNCTION trace_meta_allow(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION trace_scan_v3(p_qr_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public_tenant_live(l.tenant_id) THEN
      -- the lot exists but its organisation is not live: NOTHING of the lot — only whether it ever was (no longer published vs never)
      jsonb_build_object('live', false, 'wasLive', (t.status IN ('suspended', 'archived', 'terminated') OR t.deleted_at IS NOT NULL))
    ELSE jsonb_build_object(
      'live',         true,
      'qrToken',      l.qr_token,
      'tenantId',     l.tenant_id,
      'lotId',        l.id,
      'organisation', jsonb_build_object('displayName', t.display_name, 'slug', t.slug),
      'product', (SELECT jsonb_build_object('title', li.title, 'quantity', li.quantity_total, 'unit', li.unit_code)
                    FROM listings li
                   WHERE li.id = l.listing_id AND li.tenant_id = l.tenant_id AND li.deleted_at IS NULL
                     AND li.status::text IN ('published', 'sold_out', 'paused', 'expired', 'archived')),
      'place', (SELECT jsonb_build_object(
                         'village',  (SELECT a.default_name FROM admin_regions a WHERE a.path @> r.path AND a.level = 4 LIMIT 1),
                         'district', (SELECT a.default_name FROM admin_regions a WHERE a.path @> r.path AND a.level = 2 LIMIT 1))
                  FROM land_parcels p
                  JOIN admin_regions r ON r.id = p.region_id
                 WHERE p.id = l.parcel_id AND p.tenant_id = l.tenant_id AND p.deleted_at IS NULL),
      'createdAt',    l.created_at,
      'anchor',       jsonb_build_object('value', l.blockchain_anchor, 'anchoredAt', l.anchored_at, 'anchoredEventCount', l.anchored_event_count),
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'no',          x.rn,
                 'eventCode',   x.event_code,
                 'at',          x.created_at,
                 'atUs',        to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                 'hashVersion', x.hash_version,
                 'eventHash',   x.event_hash,
                 'meta',        COALESCE((
                   SELECT jsonb_object_agg(m.key, m.value)
                     FROM jsonb_each(CASE WHEN jsonb_typeof(x.meta) = 'object' THEN x.meta ELSE '{}'::jsonb END) AS m
                    WHERE m.key = ANY (trace_meta_allow(x.event_code))), '{}'::jsonb),
                 'metaHidden',  (jsonb_typeof(x.meta) <> 'object'
                                 OR EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(x.meta) = 'object' THEN x.meta ELSE '{}'::jsonb END) AS k(key)
                                             WHERE NOT (k.key = ANY (trace_meta_allow(x.event_code)))))
               ) ORDER BY x.rn)
          FROM (SELECT e.event_code, e.created_at, e.hash_version, e.event_hash, e.meta,
                       row_number() OVER (ORDER BY e.created_at, e.id) AS rn
                  FROM trace_events e
                 WHERE e.trace_lot_id = l.id AND e.tenant_id = l.tenant_id) x
      ), '[]'::jsonb),
      'certificates', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'typeCode', lv.code, 'status', c.status, 'validUntil', c.valid_until,
                                            'expired', (c.status = 'verified' AND c.valid_until IS NOT NULL AND c.valid_until < CURRENT_DATE))
                         ORDER BY c.created_at, c.id)
          FROM trace_lot_certificates tc
          JOIN certificates c ON c.id = tc.certificate_id AND c.tenant_id = tc.tenant_id AND c.deleted_at IS NULL
          JOIN lookup_values lv ON lv.id = c.cert_type_id
         WHERE tc.trace_lot_id = l.id AND tc.tenant_id = l.tenant_id
      ), '[]'::jsonb)
    )
  END
    FROM trace_lots l
    JOIN tenants t ON t.id = l.tenant_id
   WHERE l.qr_token = p_qr_token
     AND l.deleted_at IS NULL;
$$;
COMMENT ON FUNCTION trace_scan_v3(text) IS
  'PC-56 STORE-5b (0219, founder D3/D4/D8): the anonymous farm-to-fork read. A live organisation''s lot: the organisation, product, village/district, '
  'events with hashes and allow-listed meta, the seal, the lot''s certificates; lotId/tenantId for the API (stripped). A lot of an organisation that '
  'is not live: {live:false, wasLive} only. NULL for an unknown token. Never a person, a phone, a coordinate, declared inputs or a listing uuid.';
REVOKE ALL ON FUNCTION trace_scan_v3(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public_certificate(p_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id',              c.id,
           'tenantId',        c.tenant_id,
           'organisation',    jsonb_build_object('displayName', t.display_name, 'slug', t.slug),
           'typeCode',        lv.code,
           'certNo',          c.cert_no,
           'issuingBody',     c.issuing_body,
           'validFrom',       c.valid_from,
           'validUntil',      c.valid_until,
           'status',          c.status,
           'expired',         (c.status = 'verified' AND c.valid_until IS NOT NULL AND c.valid_until < CURRENT_DATE),
           'subjectType',     c.subject_type,
           'coversListing',   (SELECT li.title FROM listings li
                                WHERE c.subject_type = 'listing' AND li.id = c.subject_id AND li.tenant_id = c.tenant_id AND li.deleted_at IS NULL
                                  AND li.status::text = 'published' AND li.visibility::text IN ('public', 'cross_tenant')),
           'verifiedAt',      c.verified_at,
           'verifierRole',    (SELECT r.code
                                 FROM user_tenant_roles utr
                                 JOIN roles r ON r.id = utr.role_id
                                WHERE c.verified_by IS NOT NULL AND utr.user_id = c.verified_by AND utr.tenant_id = c.tenant_id AND utr.deleted_at IS NULL
                                ORDER BY (EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_code = 'certificate.verify')) DESC,
                                         utr.is_active DESC, r.code
                                LIMIT 1),
           'rejectionReason', CASE WHEN c.status = 'rejected' THEN c.rejection_reason END
         )
    FROM certificates c
    JOIN tenants t ON t.id = c.tenant_id
    JOIN lookup_values lv ON lv.id = c.cert_type_id
   WHERE c.id = p_id
     AND c.deleted_at IS NULL
     AND public_tenant_live(c.tenant_id);
$$;
COMMENT ON FUNCTION public_certificate(uuid) IS
  'PC-56 STORE-5b (0219, founder D1): the public certificate — NULL unless its organisation is live. The type CODE, number, issuer, validity, status '
  '(+ expired computed), subject kind, the covered public listing''s title, verifiedAt, the verifier''s ROLE code (never the person), the rejection '
  'reason; tenantId for the API''s per-organisation flag (stripped). Never the owner, the verifier or the media.';
REVOKE ALL ON FUNCTION public_certificate(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public_certificate_by_no(p_tenant uuid, p_cert_no text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public_certificate((
    SELECT c.id FROM certificates c
     WHERE c.tenant_id = p_tenant AND c.deleted_at IS NULL AND c.cert_no IS NOT NULL
       AND lower(c.cert_no) = lower(btrim(p_cert_no))
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1));
$$;
COMMENT ON FUNCTION public_certificate_by_no(uuid, text) IS
  'PC-56 STORE-5b (0219, founder D1): the lookup form — one organisation''s certificate by its number (case-insensitive, the newest), as public_certificate.';
REVOKE ALL ON FUNCTION public_certificate_by_no(uuid, text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION trace_scan_v3(text) TO kv_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public_certificate(uuid) TO kv_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public_certificate_by_no(uuid, text) TO kv_app';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 219.6  the plane's requester-only lookup answers the trace record too (founder D2)
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_personal_export_job_tenant(p_job uuid, p_user uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller text := nullif(current_setting('app.user_id', true), '');
  v_tenant uuid;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_user::text THEN
    RAISE EXCEPTION 'kv_personal_export_job_tenant: a person reads only their own job' USING ERRCODE = '42501';
  END IF;
  SELECT j.tenant_id INTO v_tenant FROM tenant_export_jobs j
   WHERE j.id = p_job AND j.requested_by = p_user AND j.dataset_code IN ('identity.dpdp_person', 'traceability.lot_record') AND j.deleted_at IS NULL;
  RETURN v_tenant;
END
$$;
COMMENT ON FUNCTION kv_personal_export_job_tenant(uuid, uuid) IS
  'PC-56 STORE-4a (0214) + STORE-5b (0219, founder D2): the organisation the caller''s OWN requester-only export job lives in (identity.dpdp_person, '
  'traceability.lot_record); NULL for anybody else''s job or any other dataset. Refuses any id but the transaction''s app.user_id when set.';
REVOKE ALL ON FUNCTION kv_personal_export_job_tenant(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION kv_personal_export_job_tenant(uuid, uuid) TO kv_app';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 219.7  the certificates_public flag — OFF, inserted where missing (seed core/0009 carries the same row)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
VALUES ('certificates_public',
        'PC-56 STORE-5b (founder D1): an organisation''s certificates are readable on the public certificate page (by id from a trace, by number from the lookup form) — OFF = the page says "not published"',
        false, 100, '{}')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 219.8  the reserved slug for the platform's certificate page (B27)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('certificates', 'storefront canon route (STORE-5b)')
ON CONFLICT (slug) DO NOTHING;
