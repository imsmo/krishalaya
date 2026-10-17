// modules/listings/read-models/certified.sql.ts · PC-56 STORE-5b · D1 / B18 (founder Q7, survey F-7) — THE BADGE RULE, WRITTEN ONCE.
//
// Before STORE-5b a listing's "certified organic" was its seller's own word (`listings.organic_claim = 'certified'`) — the public filter and
// chip printed it with no certificate behind it. Now a listing reads `certified` ONLY while a certificate covers it:
//   • the listing CLAIMS it (`organic_claim = 'certified'`), AND
//   • a certificate of the SAME organisation exists that is
//       – `verified` (the organisation's own check — "checked by <organisation>", never "platform-verified"),
//       – of an ORGANIC type (`cert_type` value whose `meta.organic` is true — npop · pgs_india · usda_organic, migration 0219; a lab report, a
//         GI tag, GAP or halal never makes a lot "certified organic"),
//       – VALID TODAY (`valid_until >= CURRENT_DATE` — the database's calendar day; a certificate with no `valid_until` does not count: no
//         validity, no badge), and
//       – COVERING the listing: `subject_type = 'listing'` and the listing's id; or `subject_type = 'tenant'` and the organisation's id (an
//         organisation-wide certificate); or `subject_type = 'farm'` and the PARCEL of a trace lot of this listing (listings carry no farm or
//         parcel column of their own — `trace_lots.listing_id → parcel_id` is the only farm link a listing has).
// Anything else that claims `certified` reads `self_declared` (`organic (self-declared)` on the page). Read-time: when a certificate lapses
// (or the expiry clock flips it), the very next read drops the badge — no listing is mutated, nothing consumes `certificate_expired`.
//
// ONE fragment over a listing alias, applied by the public search read model (the `organic=certified` filter, the chip, the facet count) and
// the listing detail's public facts. Runs on the tenant's replica under RLS (the certificate is the listing's own organisation's).

/** EXISTS a verified, organic, valid-today certificate covering listing alias `l` (see the header). */
export const COVERED_SQL = (l: string): string =>
  `EXISTS (SELECT 1 FROM certificates kvcert
             JOIN lookup_values kvct ON kvct.id = kvcert.cert_type_id AND kvct.type_code = 'cert_type'
            WHERE kvcert.tenant_id = ${l}.tenant_id AND kvcert.deleted_at IS NULL
              AND kvcert.status = 'verified'
              AND (kvct.meta->>'organic') = 'true'
              AND kvcert.valid_until IS NOT NULL AND kvcert.valid_until >= CURRENT_DATE
              AND ((kvcert.subject_type = 'listing' AND kvcert.subject_id = ${l}.id)
                OR (kvcert.subject_type = 'tenant' AND kvcert.subject_id = ${l}.tenant_id)
                OR (kvcert.subject_type = 'farm' AND kvcert.subject_id IN (SELECT kvtl.parcel_id FROM trace_lots kvtl
                                                                             WHERE kvtl.listing_id = ${l}.id AND kvtl.tenant_id = ${l}.tenant_id
                                                                               AND kvtl.deleted_at IS NULL AND kvtl.parcel_id IS NOT NULL))))`;

/** Listing alias `l` may say "certified organic": it claims it AND a certificate covers it. */
export const CERTIFIED_SQL = (l: string): string => `(${l}.organic_claim = 'certified' AND ${COVERED_SQL(l)})`;
