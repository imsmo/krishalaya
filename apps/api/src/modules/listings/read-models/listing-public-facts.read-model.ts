// modules/listings/read-models/listing-public-facts.read-model.ts · PC-56 HOTFIX-4 · A6 (survey F-7, founder D3) — the three facts a PUBLIC
// listing names that the entity does not carry: the ORGANISATION that sells (slug + display name — never a person), the place as a coarse
// NAME (the district; the state when that is all that is recorded — never a village, never coordinates, never a uuid), and the grade's
// display name. ONE bounded query on the replica (Law 12), tenant-scoped (tenant_id bound + RLS: `tenants_self_read` answers the context
// tenant's own row only). A failure degrades to "no facts" — the public read never dies on a label.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { NO_PUBLIC_FACTS, PublicListingFacts } from '../domain/listing-public.view';

/** admin_regions.level of a district (0002 seed: 1 = state, 2 = district). The coarsest place a buyer is shown below a state. */
const DISTRICT_LEVEL = 2;

@Injectable()
export class ListingPublicFactsReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async forListing(tenantId: string, listingId: string): Promise<PublicListingFacts> {
    try {
      const r = await this.replica.forTenant(tenantId).query<{ slug: string | null; display_name: string | null; district: string | null; grade: string | null }>(
        `SELECT t.slug, t.display_name,
                CASE WHEN rg.id IS NULL THEN NULL
                     WHEN rg.level <= $3 THEN rg.default_name
                     ELSE (SELECT a.default_name FROM admin_regions a WHERE a.path @> rg.path AND a.level = $3 LIMIT 1) END AS district,
                g.default_name AS grade
           FROM listings l
           JOIN tenants t ON t.id = l.tenant_id
           LEFT JOIN admin_regions rg ON rg.id = l.region_id
           LEFT JOIN attribute_options g ON g.id = l.grade_option_id
          WHERE l.id = $1 AND l.tenant_id = $2`, [listingId, tenantId, DISTRICT_LEVEL]);
      const x = r.rows[0];
      if (!x) return { ...NO_PUBLIC_FACTS };
      return {
        organisation: x.slug && x.display_name ? { slug: x.slug, name: x.display_name } : null,
        district: x.district ?? null,
        grade: x.grade ?? null,
      };
    } catch {
      return { ...NO_PUBLIC_FACTS };
    }
  }
}
