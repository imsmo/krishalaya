-- ==================================================================================================================
-- MIGRATION 0214 — PC-56 STORE-4a · YOUR ACCOUNT, YOUR ADDRESSES, YOUR DATA — SAID AS THE PLATFORM HOLDS IT
-- (canon W300 account · W301 addresses · W3029–W3030 the export chain · W3031–W3033 account Retry (DECOR; the deletion rides its shape) ·
--  W3034–W3037 the address form chain · W3038–W3040 the address mutate chain)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0213 are applied; nothing here edits them: this file inserts vocabulary and
-- one setting, adds two nullable columns, drops one column DEFAULT, and creates three SECURITY DEFINER functions.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store4.md §0 C-9 / C-11, §2 F-5 / F-6, §3 B6 / B7 / B9 / B10 — verified at 7f1efc22, HOTFIX-6):
--   • `address_label` had its TYPE row (seed 0005, tenant-extendable) and NO value anywhere: an address card's label could never show (C-11).
--   • An address carried no note for whoever delivers to it (B7).
--   • `addresses.country_code` defaulted to 'IN' (0003): an address written without a country silently became Indian (Rule Zero, F-5).
--   • A DPDP export request registered a row and NOTHING compiled a file (C-9); the request row had nowhere to point at a file.
--   • A deletion request had NO pre-check: open orders, money in escrow and a wallet balance were never read (F-6, B10).
--   • How long invoices are kept was a sentence in the canon ("8 years"), not a fact the platform holds.
--
-- WHAT IS TRUE NOW (founder decisions 2026-10-16, STORE-4a D1 / D2 / D4):
--   214.1  `address_label` — the type row (ON CONFLICT DO NOTHING: migrations run BEFORE seeds from empty — the 0210 lesson) and the FIVE
--          platform values `home`, `farm`, `shop`, `warehouse`, `delivery` (sort 1–5, `WHERE NOT EXISTS` — idempotent). Their hi / gu words live
--          in the storefront catalogues by code (founder D4), exactly as 0210's cancel reasons do.
--   214.2  `addresses.delivery_note varchar(280)` (founder D4: the note whoever delivers reads; copy-on-write carries it) and
--          `ALTER COLUMN country_code DROP DEFAULT` (Rule Zero: an address names its country or is refused — the API's `CreateAddressSchema`
--          now REQUIRES `countryCode`; every existing row keeps the value it has; the column stays NOT NULL).
--   214.3  `data_subject_requests.export_job_id uuid NULL REFERENCES tenant_export_jobs(id)` + a partial index: a DPDP export request points
--          at the export-plane job that compiles it (founder D2 — the personal dataset `identity.dpdp_person`).
--   214.4  `setting_definitions` `platform.invoice_retention_years` (int, 8, platform — 0209's shape): the deletion confirm prints how long
--          invoices are kept FROM THIS SETTING, never a literal (founder D1).
--   214.5  `kv_person_open_commitments(p_user)` — SECURITY DEFINER, the HOTFIX-6 `kv_address_in_use` pattern. What stands between a person and a
--          deletion request, ACROSS every organisation (RLS hides other organisations' orders from kv_app; a person is platform-level):
--            open_orders    = orders where the person is the BUYER and the status is NOT one of `completed | cancelled | refunded`;
--            escrow_minor   = MONEY IN ESCROW, defined from the PAYMENTS TABLE (not from the ledger): the sum of `amount_minor −
--                             refunded_minor` over the person's own `payments` rows (`user_id = p_user`, `reference_type = 'order'`) whose status
--                             says the money ARRIVED and has not all gone back (`success | refund_initiated | partially_refunded`), for orders
--                             where the person is the buyer and the order is NOT `completed | cancelled | refunded` — i.e. an online payment
--                             the platform holds for an order that has not settled. (A COD order holds nothing: it has no captured row.)
--            wallet_minor   = the person's WALLET balance: the sum of `wallet_accounts.cached_balance_minor` over the person's OWN `main`
--                             accounts (`owner_kind = 'user'`). The `hold` account (a held auction deposit) and `cash_in_hand` (a rider's
--                             liability) are NOT counted — named in the wave report.
--            currency_code  = ONE currency for the two money figures: the currency whose escrow + wallet total is the largest (ties → the
--                             alphabetically first); NULL when the person holds nothing anywhere. `multi_currency` says when more than one
--                             currency holds money (the figures then describe the largest; the refusal stands whichever currency holds it).
--            invoice_count  = trade invoices on orders where the person is the buyer (what the law makes the platform keep).
--          The function answers ONLY for the caller's own id: when the transaction carries `app.user_id` (every apps/api unit of work does) and
--          it is not `p_user`, it raises insufficient_privilege. It returns five figures and one flag — no row, no id, no tenant crosses back.
--          NOTHING IS WRITTEN AND NO MONEY MOVES: it is a read.
--   214.6  `kv_person_export_rows(p_user, p_cap)` — SECURITY DEFINER, the PERSON-EXPORT READ (founder D2: the file is "everything we hold about
--          you" ACROSS every organisation the person used; the producer reads it through THIS function, never as kv_app under one tenant).
--          Seven sections, each newest-first and capped at `p_cap` rows (the producer asks for cap + 1 to say when a section was capped):
--          profile · address (retired copies INCLUDED — their `retiredAt` says so) · order (as BUYER: header rows — number, status, total, the
--          data's currency, when; the ORGANISATION by name, never the seller person) · message (the person's OWN messages) · consent · notification
--          (event, channel, status, when — never the payload, which can carry another party's words) · data_request (the person's DSRs).
--          PII is MASKED HERE, in SQL, so a raw number never leaves the database through this door: phone `+9198****3210` (the shape of
--          apps/api `shared/utils/phone.ts` maskPhone), email `a***@x.in` (the shape of `User.toPublic()`); an address's receiver phone the same.
--          Same caller rule as 214.5.
--   214.7  `kv_personal_export_job_tenant(p_job, p_user)` — SECURITY DEFINER: the organisation a person's OWN personal export job lives in (the
--          DSR is person-level; the job is tenant-scoped under RLS; a person signed in at another organisation still reads their own job).
--          Returns NULL for anybody else's job and for any dataset but `identity.dpdp_person`. One uuid; nothing else crosses. Same caller rule.
--
-- NOTHING ELSE: no table is created; no flag is added or changed (Law 10 — a person's account, addresses and DPDP rights have no kill-switch,
-- and the personal export is NOT behind `tenant_exports`: DPDP is a statutory right); no ledger row, wallet call, payment or price changes
-- (Law 9 — the pre-check READS); no outbox handler (the DSR list joins the plane's job state).
--
-- RLS / GRANTS DECISION: no table is created, so the RLS gate's count does not move (1,955 + the wall). `addresses`, `data_subject_requests` and
-- `setting_definitions` keep their policies and grants (a nullable column inherits them; `data_subject_requests` has no tenant column — person-
-- level, the 0003 choice). The three functions are SECURITY DEFINER with `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`, `GRANT
-- EXECUTE … TO kv_app` only (the 0204 / 0213 pattern): they read across organisations as their OWNER, so the production migration owner must
-- bypass RLS (ops owed, as for 0213). Partition pass: `orders`, `messages` and `notifications` are partitioned and only READ here.
--
-- REVERSAL (documented, not automatic):
--   DROP FUNCTION IF EXISTS kv_personal_export_job_tenant(uuid, uuid);
--   DROP FUNCTION IF EXISTS kv_person_export_rows(uuid, int);
--   DROP FUNCTION IF EXISTS kv_person_open_commitments(uuid);      -- apps/api then refuses every deletion request with a 500 (fail closed)
--   DELETE FROM setting_definitions WHERE key = 'platform.invoice_retention_years';   -- the confirm then prints no retention (never a literal)
--   DROP INDEX IF EXISTS idx_dsr_export_job; ALTER TABLE data_subject_requests DROP COLUMN IF EXISTS export_job_id;
--   ALTER TABLE addresses ALTER COLUMN country_code SET DEFAULT 'IN';   -- restores the Rule Zero defect; revert the API schema first
--   ALTER TABLE addresses DROP COLUMN IF EXISTS delivery_note;
--   the five `address_label` values cannot be deleted once an address references them — deactivate them (UPDATE lookup_values SET is_active = false).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 214.1  the address labels (founder D4)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('address_label', 'Address label', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, '{}'::jsonb, v.sort_order
  FROM (VALUES
    ('address_label', 'home',      'Home',      1),
    ('address_label', 'farm',      'Farm',      2),
    ('address_label', 'shop',      'Shop',      3),
    ('address_label', 'warehouse', 'Warehouse', 4),
    ('address_label', 'delivery',  'Delivery point', 5)
  ) AS v(type_code, code, default_name, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 214.2  the delivery note, and no country by default (founder D4 · Rule Zero)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS delivery_note varchar(280);
COMMENT ON COLUMN addresses.delivery_note IS
  'PC-56 STORE-4a (0214, founder D4): the owner''s note for whoever delivers here (gate, landmark, vehicle size) — at most 280 characters. '
  'Copy-on-write carries it to the edited copy (HOTFIX-6). NULL = no note.';
ALTER TABLE addresses ALTER COLUMN country_code DROP DEFAULT;

-- ------------------------------------------------------------------------------------------------------------------
-- 214.3  a DPDP export request points at the job that compiles it (founder D2)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE data_subject_requests ADD COLUMN IF NOT EXISTS export_job_id uuid REFERENCES tenant_export_jobs(id);
CREATE INDEX IF NOT EXISTS idx_dsr_export_job ON data_subject_requests (export_job_id) WHERE export_job_id IS NOT NULL;
COMMENT ON COLUMN data_subject_requests.export_job_id IS
  'PC-56 STORE-4a (0214, founder D2): the export-plane job (tenant_export_jobs, dataset identity.dpdp_person) compiling this portability '
  'request — readable by its requester only. NULL for every other kind of request and for exports requested before 0214.';

-- ------------------------------------------------------------------------------------------------------------------
-- 214.4  how long invoices are kept (founder D1 — a setting, never a literal)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class) VALUES
  ('platform.invoice_retention_years', 'int', '8', 'platform',
   'PC-56 STORE-4a (0214, founder D1): years the platform keeps tax invoices after a person asks to delete their account — the records the '
   'law makes it keep. The deletion confirm prints this number with the person''s own invoice count. Seeded 8.',
   'ordinary')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 214.5  what stands between a person and a deletion request (founder D1) — a READ across organisations
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_person_open_commitments(p_user uuid)
RETURNS TABLE (open_orders int, escrow_minor bigint, wallet_minor bigint, currency_code text, invoice_count int, multi_currency boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'kv_person_open_commitments: no person' USING ERRCODE = '22004'; END IF;
  IF v_caller IS NOT NULL AND v_caller <> p_user::text THEN
    RAISE EXCEPTION 'kv_person_open_commitments: a person reads only their own figures' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH esc AS (
    SELECT p.currency_code::text AS ccy, sum(p.amount_minor - coalesce(p.refunded_minor, 0))::bigint AS amt
      FROM payments p
      JOIN orders o ON o.id = p.reference_id AND o.tenant_id = p.tenant_id
     WHERE p.user_id = p_user AND p.reference_type = 'order' AND p.deleted_at IS NULL
       AND p.status IN ('success', 'refund_initiated', 'partially_refunded')
       AND o.buyer_user_id = p_user AND o.status NOT IN ('completed', 'cancelled', 'refunded')
     GROUP BY p.currency_code
  ), wal AS (
    SELECT w.currency_code::text AS ccy, sum(w.cached_balance_minor)::bigint AS amt
      FROM wallet_accounts w
     WHERE w.owner_kind = 'user' AND w.owner_user_id = p_user AND w.account_code = 'main' AND w.deleted_at IS NULL
     GROUP BY w.currency_code
  ), held AS (
    SELECT x.ccy, sum(x.amt) AS total FROM (SELECT ccy, amt FROM esc UNION ALL SELECT ccy, amt FROM wal) x
     WHERE x.amt <> 0 GROUP BY x.ccy
  ), pick AS (
    SELECT h.ccy FROM held h ORDER BY h.total DESC, h.ccy ASC LIMIT 1
  )
  SELECT
    (SELECT count(*)::int FROM orders o WHERE o.buyer_user_id = p_user AND o.status NOT IN ('completed', 'cancelled', 'refunded')),
    coalesce((SELECT e.amt FROM esc e WHERE e.ccy = (SELECT ccy FROM pick)), 0)::bigint,
    coalesce((SELECT w.amt FROM wal w WHERE w.ccy = (SELECT ccy FROM pick)), 0)::bigint,
    (SELECT ccy FROM pick),
    (SELECT count(*)::int FROM trade_invoices ti JOIN orders o ON o.id = ti.order_id AND o.tenant_id = ti.tenant_id
      WHERE o.buyer_user_id = p_user AND ti.deleted_at IS NULL),
    ((SELECT count(*) FROM held) > 1);
END
$$;
COMMENT ON FUNCTION kv_person_open_commitments(uuid) IS
  'PC-56 STORE-4a (0214, founder D1): the caller''s own open orders as buyer (not completed/cancelled/refunded), money in escrow (captured order '
  'payments not all refunded, on orders not closed), wallet main balance, the currency of the largest holding, invoice count, multi-currency flag '
  '— across every organisation. A read; refuses any id but the transaction''s app.user_id when set.';
REVOKE ALL ON FUNCTION kv_person_open_commitments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_person_open_commitments(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 214.6  the person-export read (founder D2) — seven sections, masked, capped, across organisations
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_person_export_rows(p_user uuid, p_cap int)
RETURNS TABLE (section text, organisation text, record_id uuid, recorded_at timestamptz, details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller text := nullif(current_setting('app.user_id', true), '');
  v_cap int := greatest(1, least(coalesce(p_cap, 1), 100001));
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'kv_person_export_rows: no person' USING ERRCODE = '22004'; END IF;
  IF v_caller IS NOT NULL AND v_caller <> p_user::text THEN
    RAISE EXCEPTION 'kv_person_export_rows: a person exports only their own data' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  (SELECT 'profile'::text, NULL::text, u.id, u.created_at,
          jsonb_build_object('fullName', u.full_name,
            'phone', CASE WHEN u.phone IS NULL THEN NULL WHEN length(u.phone) < 6 THEN '****' ELSE left(u.phone, 5) || '****' || right(u.phone, 4) END,
            'email', CASE WHEN u.email IS NULL THEN NULL ELSE regexp_replace(u.email, '(^.).*(@.*$)', '\1***\2') END,
            'languageCode', u.language_code, 'countryCode', u.country_code, 'status', u.status::text)
     FROM users u WHERE u.id = p_user)
  UNION ALL
  (SELECT 'address'::text, NULL::text, a.id, a.created_at,
          jsonb_build_object('label', lv.code, 'line1', a.line1, 'line2', a.line2, 'village', a.village, 'pincode', a.pincode,
            'countryCode', a.country_code, 'contactName', a.contact_name,
            'contactPhone', CASE WHEN a.contact_phone IS NULL THEN NULL WHEN length(a.contact_phone) < 6 THEN '****' ELSE left(a.contact_phone, 5) || '****' || right(a.contact_phone, 4) END,
            'deliveryNote', a.delivery_note, 'isDefault', a.is_default, 'retiredAt', a.deleted_at)
     FROM addresses a LEFT JOIN lookup_values lv ON lv.id = a.label_id
    WHERE a.user_id = p_user ORDER BY a.created_at DESC, a.id DESC LIMIT v_cap)
  UNION ALL
  (SELECT 'order'::text, t.display_name::text, o.id, o.created_at,
          jsonb_build_object('orderNo', o.order_no, 'status', o.status::text, 'totalMinor', o.total_minor::text, 'currencyCode', o.currency_code)
     FROM orders o JOIN tenants t ON t.id = o.tenant_id
    WHERE o.buyer_user_id = p_user ORDER BY o.created_at DESC, o.id DESC LIMIT v_cap)
  UNION ALL
  (SELECT 'message'::text, t.display_name::text, m.id, m.created_at,
          jsonb_build_object('conversationId', m.conversation_id, 'body', m.body,
            'hasVoice', m.voice_media_id IS NOT NULL, 'hasAttachment', m.attachment_media_id IS NOT NULL)
     FROM messages m LEFT JOIN tenants t ON t.id = m.tenant_id
    WHERE m.sender_user_id = p_user ORDER BY m.created_at DESC, m.id DESC LIMIT v_cap)
  UNION ALL
  (SELECT 'consent'::text, NULL::text, c.id, c.created_at,
          jsonb_build_object('purposeCode', c.purpose_code, 'version', c.version, 'granted', c.granted, 'channel', c.channel)
     FROM consents c WHERE c.user_id = p_user ORDER BY c.created_at DESC, c.id DESC LIMIT v_cap)
  UNION ALL
  (SELECT 'notification'::text, t.display_name::text, n.id, n.created_at,
          jsonb_build_object('eventCode', n.event_code, 'channel', n.channel, 'status', n.status::text, 'readAt', n.read_at)
     FROM notifications n LEFT JOIN tenants t ON t.id = n.tenant_id
    WHERE n.user_id = p_user ORDER BY n.created_at DESC, n.id DESC LIMIT v_cap)
  UNION ALL
  (SELECT 'data_request'::text, NULL::text, d.id, d.created_at,
          jsonb_build_object('kind', d.request_type, 'status', d.status, 'coolingEndsAt', d.cooling_ends_at)
     FROM data_subject_requests d WHERE d.user_id = p_user AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT v_cap);
END
$$;
COMMENT ON FUNCTION kv_person_export_rows(uuid, int) IS
  'PC-56 STORE-4a (0214, founder D2): the person-export read for dataset identity.dpdp_person — profile, addresses (retired copies included), '
  'orders as buyer (header rows, organisation by name), own messages, consents, notifications (no payload), data-subject requests; across every '
  'organisation; each section newest-first and capped at p_cap; phones and emails MASKED in SQL. Refuses any id but the transaction''s '
  'app.user_id when set.';
REVOKE ALL ON FUNCTION kv_person_export_rows(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_person_export_rows(uuid, int) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 214.7  where a person's own personal export job lives (founder D2 — readable by its requester whatever the session's organisation)
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
   WHERE j.id = p_job AND j.requested_by = p_user AND j.dataset_code = 'identity.dpdp_person' AND j.deleted_at IS NULL;
  RETURN v_tenant;
END
$$;
COMMENT ON FUNCTION kv_personal_export_job_tenant(uuid, uuid) IS
  'PC-56 STORE-4a (0214, founder D2): the organisation the caller''s OWN identity.dpdp_person export job lives in; NULL for anybody else''s job '
  'or any other dataset. Refuses any id but the transaction''s app.user_id when set.';
REVOKE ALL ON FUNCTION kv_personal_export_job_tenant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_personal_export_job_tenant(uuid, uuid) TO kv_app;
