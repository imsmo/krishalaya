// modules/listings/read-models/listing-public-facts.read-model.ts · PC-56 HOTFIX-4 · A6 (survey F-7, founder D3) — the three facts a PUBLIC
// listing names that the entity does not carry: the ORGANISATION that sells (slug + display name — never a person), the place as a coarse
// NAME (the district; the state when that is all that is recorded — never a village, never coordinates, never a uuid), and the grade's
// display name. ONE bounded query on the replica (Law 12), tenant-scoped (tenant_id bound + RLS: `tenants_self_read` answers the context
// tenant's own row only). A failure degrades to "no facts" — the public read never dies on a label.
//
// PC-56 STORE-2a · B2:
//   • the grade is the CONFIRMED grade only (founder D2 — read-models/public-listing.sql.ts says what "confirmed" means); the AI suggestion
//     column is never selected;
//   • the lot's measured ATTRIBUTES (B30) — listing_attribute_values (no RLS, no tenant_id) reached ONLY through the RLS-forced `listings`
//     row of the context tenant, PUBLISHED and publicly visible, seller not suspended (`attributes()`, also the `:id/attributes` route);
//   • the seller's SUSPENSION (B10, survey F-15) is its own query that does NOT degrade: if the answer cannot be read, the detail fails rather
//     than show a suspended seller's lot (the feed already hides it — the detail read was the one path that did not).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerNotSuspendedSql, sellerSuspendedExpr } from '../../../shared/sql/member-suspension.sql';
import { NO_PUBLIC_FACTS, PublicListingFacts, PublicLotAttribute } from '../domain/listing-public.view';
import { confirmedGradeIdSql, districtNameSql } from './public-listing.sql';
import { CERTIFIED_SQL } from './certified.sql';

/** A lot carries at most this many attributes on a buyer's page (bounded read — Law 11; a category binds a handful). */
export const MAX_PUBLIC_ATTRIBUTES = 50;

@Injectable()
export class ListingPublicFactsReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async forListing(tenantId: string, listingId: string): Promise<PublicListingFacts> {
    try {
      const r = await this.replica.forTenant(tenantId).query<{ slug: string | null; display_name: string | null; district: string | null; grade: string | null; organic_covered: boolean | null }>(
        `SELECT t.slug, t.display_name,
                ${districtNameSql('l')} AS district,
                ${CERTIFIED_SQL('l')} AS organic_covered,
                (SELECT g.default_name FROM attribute_options g WHERE g.id = ${confirmedGradeIdSql('l')}) AS grade
           FROM listings l
           JOIN tenants t ON t.id = l.tenant_id
          WHERE l.id = $1 AND l.tenant_id = $2`, [listingId, tenantId]);
      const x = r.rows[0];
      if (!x) return { ...NO_PUBLIC_FACTS, attributes: [] };
      return {
        organisation: x.slug && x.display_name ? { slug: x.slug, name: x.display_name } : null,
        district: x.district ?? null,
        grade: x.grade ?? null,
        organicCovered: x.organic_covered === true,   // STORE-5b · B18: the badge rule (a failed read degrades to "no facts" → not covered)
        attributes: await this.attributes(tenantId, listingId).catch(() => []),
      };
    } catch {
      return { ...NO_PUBLIC_FACTS, attributes: [] };
    }
  }

  /** Is the listing's seller under a live suspension in this organisation? Does NOT degrade (a failure throws — see the header). */
  async sellerSuspended(tenantId: string, listingId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query<{ suspended: boolean }>(
      `SELECT ${sellerSuspendedExpr('l.tenant_id', 'l.seller_user_id')} AS suspended FROM listings l WHERE l.id = $1 AND l.tenant_id = $2`,
      [listingId, tenantId]);
    return r.rows[0]?.suspended === true;
  }

  /** The lot's measured attributes — ONLY for a PUBLISHED, publicly visible listing of the context tenant whose seller is not suspended
   *  (anything else answers []). Master-data names; numbers trimmed of trailing zeros; options by their display name. */
  async attributes(tenantId: string, listingId: string): Promise<PublicLotAttribute[]> {
    const r = await this.replica.forTenant(tenantId).query<{ code: string; name: string; kind: string; value: string | null; unit: string | null }>(
      `SELECT ad.code, ad.default_name AS name,
              CASE WHEN v.option_id IS NOT NULL THEN 'option' WHEN v.value_number IS NOT NULL THEN 'number'
                   WHEN v.value_bool IS NOT NULL THEN 'bool' WHEN v.value_date IS NOT NULL THEN 'date' ELSE 'text' END AS kind,
              COALESCE(ao.default_name, trim_scale(v.value_number)::text, v.value_bool::text, to_char(v.value_date, 'YYYY-MM-DD'), v.value_text) AS value,
              ad.unit_code AS unit
         FROM listings l
         JOIN listing_attribute_values v ON v.listing_id = l.id
         JOIN attribute_definitions ad ON ad.id = v.attribute_id AND ad.is_active AND ad.deleted_at IS NULL
         LEFT JOIN attribute_options ao ON ao.id = v.option_id
        WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL
          AND l.status = 'published' AND l.visibility IN ('public','cross_tenant')
          AND ${sellerNotSuspendedSql('l')}
        ORDER BY ad.default_name, ad.code
        LIMIT ${MAX_PUBLIC_ATTRIBUTES}`, [listingId, tenantId]);
    return r.rows
      .filter((x) => x.value !== null && x.value !== '')
      .map((x) => ({
        code: x.code, name: x.name,
        kind: (['text', 'number', 'bool', 'date', 'option'].includes(x.kind) ? x.kind : 'text') as PublicLotAttribute['kind'],
        value: String(x.value), unit: x.unit ?? null,
      }));
  }
}
