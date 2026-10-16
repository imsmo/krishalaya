-- ==================================================================================================================
-- MIGRATION 0217 — PC-56 HOTFIX-7 · THE COMPLETION DOOR, THE REFUND THAT ISN'T, THE NAMES ON REVIEWS, THE PUBLIC TRACE
-- (no canon screen — the P0s the STORE-5 survey found, fixed before any STORE-5 screen is built; survey_store5.md §2 F-1 F-8 F-20, §3 B10 B15 B25)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0216 are applied; nothing here edits them: 0028's `trace_scan` and 0204's
-- `public_tenant_live` are untouched, 0139's grant row is removed by a DELETE here, not by editing 0139.)
-- CODEOWNERS (Law 9): 217.1 changes WHO MAY MOVE A REFUND (`order.refund`) — the founder reviews the wave report §9 before production.
-- ==================================================================================================================
--
-- WHAT WAS TRUE (verified at 7c39c9e8, STORE-4b):
--   • THE SELLING ORGANISATION DECIDED ITS OWN BUYER'S DISPUTE. Seed core/0004 granted `dispute.resolve` to `tenant_admin` (and to
--     `support_agent`); 0139 §139.4 granted the money key `order.refund` to `tenant_admin` only. So the farmer's own organisation could decide
--     the buyer's dispute against the buyer (and, through `canModerateOrder` = `dispute.resolve`, force-complete a delivered order), and
--     release or withhold the refund (survey F-1, F-20).
--   • THE PUBLIC QR SCAN PUBLISHED WHATEVER AN AUTHOR TYPED. 0028's `trace_scan` returns `declared_inputs`, every event's `meta` verbatim
--     (a phone number or a GPS pair typed into meta went public), the raw `listing_id` uuid and `certificate_ids`, and it answers for ANY
--     organisation — a suspended or trial one included — because it never consults 0204's `public_tenant_live` (survey F-8).
--
-- WHAT IS TRUE NOW (founder decisions 2026-10-17, HOTFIX-7 D4 and B10/B15/B25):
--   217.1  D4 (Q18) — buyer-raised disputes are decided by the PLATFORM SUPPORT DESK, never by the selling organisation:
--            DELETE (tenant_admin, dispute.resolve) and (tenant_admin, order.refund) from `role_permissions`;
--            INSERT (support_agent, order.refund) if absent.
--          Seed core/0004's `tenant_admin` grant list loses `dispute.resolve` and its `support_agent` list gains `order.refund` IN THE SAME
--          CHANGE: the seed is `ON CONFLICT DO NOTHING`, so an existing database needs THIS file and a fresh database needs the edited seed
--          (migrate.js also runs core/0004 inside 0125, long before this file; the normal seed step runs it again after this file, and the
--          edited list no longer re-inserts the deleted row). `order.refund` was never in the seed (0139 granted it) — nothing else to edit.
--          The maker-checker gate (0139 §139.3) is unchanged: at or above the tenant's threshold a refund still needs an approval signed by a
--          DIFFERENT holder of `order.refund` — a second `support_agent`. Per-person grants in `staff_permission_overrides` (0003) are NOT
--          touched (none is seeded; an operator's deliberate per-person grant is theirs to revoke — named in the wave report).
--   217.2  B10 (projection half) + B25 — `trace_scan_v2(text)`: a NEW SECURITY DEFINER function (0028's `trace_scan` stays, unchanged and
--          no longer called by apps/api). It answers ONLY for a lot whose organisation is publicly live (`public_tenant_live`, 0204 — status
--          active | grace, not deleted: a trial or suspended organisation's lot is NULL → 404), and returns:
--            qrToken · tenantId (consumed by the API for the PER-TENANT `traceability` flag and STRIPPED from the answer) ·
--            organisation.displayName (tenants.display_name — the organisation, never a person) · createdAt · anchored ·
--            events[] { eventCode, at, meta } with `meta` filtered through an ALLOW-LIST OF KEYS PER STEP.
--          The allow-list lives ONCE in apps/api `traceability/domain/trace-meta.ts`; the CASE below is its SQL mirror, and the unit spec
--          `trace-meta.spec.ts` parses THIS FILE and asserts the arrays equal the TypeScript list (a key added on one side only fails it).
--          NOT returned (refused by name): `listingId` (a uuid — 2a removed uuids from public rows), `declaredInputs` (0013's shape is a list
--          of free objects — `z.record` — so no element is a short string; nothing qualifies, nothing is published; 5b decides a vocabulary),
--          `certificateIds` (free uuids; 5b's certificate model), any phone / gps / lat / lng / name / address key (no step lists one).
--          VALUES are not judged here: the API applies the per-key value rule from the same TypeScript file (a string ≤ 60 characters with no
--          run of six digits, a positive number, a lower-case code), so a key the SQL keeps can still be dropped for its value.
--          SECURITY DEFINER, `SET search_path = public`, REVOKE ALL FROM PUBLIC, EXECUTE to kv_app only — the 0028 / 0204 house rule.
--
-- NOTHING ELSE (brief §A(3)): no table, no column, no flag row (`traceability`, `dispute_refunds`, `disputes`, `reviews` stay as seeded —
-- Law 10), no settlement-outcome column (a skipped COD settlement is recorded by its audit row `order.settlement_skipped`, never a CHECK
-- widening), no ledger txn type (the dispute and return refunds keep the `refund` type they always posted under). The RLS gate's count
-- does not move (1,955 + the wall). trace_events / trace_lots / tenants are read inside the definer only.
--
-- REVERSAL (documented, not automatic):
--   DROP FUNCTION IF EXISTS trace_scan_v2(text);                                          -- the API's scan then fails closed (500 → fix forward)
--   DELETE FROM role_permissions rp USING roles r WHERE rp.role_id = r.id AND r.code = 'support_agent' AND rp.permission_code = 'order.refund';
--   INSERT INTO role_permissions (role_id, permission_code) SELECT r.id, p.code FROM roles r JOIN permissions p
--     ON p.code IN ('dispute.resolve', 'order.refund') WHERE r.code = 'tenant_admin' ON CONFLICT DO NOTHING;
--   -- …and restore `dispute.resolve` to seed core/0004's tenant_admin list (else the next seed run does not re-add it — harmless either way).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 217.1  THE PLATFORM DESK DECIDES; THE ORGANISATION DOES NOT (founder D4 / Q18)
-- ------------------------------------------------------------------------------------------------------------------
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND r.code = 'tenant_admin'
   AND rp.permission_code IN ('dispute.resolve', 'order.refund');

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM roles r
  JOIN permissions p ON p.code = 'order.refund'
 WHERE r.code = 'support_agent'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 217.2  THE PUBLIC TRACE, V2 — LIVE ORGANISATIONS ONLY, ALLOW-LISTED META, NO UUID BUT THE TENANT THE API STRIPS
-- ------------------------------------------------------------------------------------------------------------------
-- The allow-list (keys per step). MIRROR of apps/api/src/modules/traceability/domain/trace-meta.ts `TRACE_META_ALLOW` — the parity spec reads
-- the WHEN lines below; keep one step per line, in the form  WHEN '<step>' THEN ARRAY['k1','k2']::text[]
CREATE OR REPLACE FUNCTION trace_scan_v2(p_qr_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'qrToken',      l.qr_token,
           'tenantId',     l.tenant_id,
           'organisation', jsonb_build_object('displayName', t.display_name),
           'anchored',     (l.blockchain_anchor IS NOT NULL),
           'createdAt',    l.created_at,
           'events', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'eventCode', e.event_code,
                      'at',        e.created_at,
                      'meta',      COALESCE((
                        SELECT jsonb_object_agg(m.key, m.value)
                          FROM jsonb_each(CASE WHEN jsonb_typeof(e.meta) = 'object' THEN e.meta ELSE '{}'::jsonb END) AS m
                         WHERE m.key = ANY (CASE e.event_code
                                 WHEN 'harvested'  THEN ARRAY['variety','season','gradeLabel','quantity','unit']::text[]
                                 WHEN 'listed'     THEN ARRAY['gradeLabel','quantity','unit']::text[]
                                 WHEN 'sold'       THEN ARRAY['quantity','unit']::text[]
                                 WHEN 'packed'     THEN ARRAY['packType','packCount','quantity','unit']::text[]
                                 WHEN 'picked'     THEN ARRAY['quantity','unit']::text[]
                                 WHEN 'in_transit' THEN ARRAY['mode']::text[]
                                 WHEN 'delivered'  THEN ARRAY['quantity','unit']::text[]
                                 WHEN 'recalled'   THEN ARRAY['reasonCode']::text[]
                                 ELSE ARRAY[]::text[]
                               END)
                      ), '{}'::jsonb)
                    ) ORDER BY e.created_at, e.id)
               FROM trace_events e
              WHERE e.trace_lot_id = l.id AND e.tenant_id = l.tenant_id
           ), '[]'::jsonb)
         )
    FROM trace_lots l
    JOIN tenants t ON t.id = l.tenant_id
   WHERE l.qr_token = p_qr_token
     AND l.deleted_at IS NULL
     AND public_tenant_live(l.tenant_id);
$$;

COMMENT ON FUNCTION trace_scan_v2(text) IS
  'PC-56 HOTFIX-7 (0217, survey STORE-5 F-8 / B10 / B25): the anonymous farm-to-fork QR read. NULL unless the lot''s organisation is publicly live '
  '(public_tenant_live, 0204). Returns qrToken, tenantId (the API reads the per-tenant traceability flag with it and strips it), the organisation''s '
  'display name, createdAt, anchored and events[] {eventCode, at, meta} with meta keys ALLOW-LISTED per step (apps/api traceability/domain/'
  'trace-meta.ts is the source; trace-meta.spec.ts asserts parity). Never listingId, declaredInputs, certificateIds, a person, a phone or a coordinate. '
  '0028 trace_scan is kept and no longer called.';

REVOKE ALL ON FUNCTION trace_scan_v2(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION trace_scan_v2(text) TO kv_app';
  END IF;
END $$;
