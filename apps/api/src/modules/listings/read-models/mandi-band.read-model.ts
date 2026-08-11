// modules/listings/read-models/mandi-band.read-model.ts
// Aggregated "mandi price band" (low/modal/high) per crop×region from active listings.
// Read-only, replica-backed, cached — feeds the MandiPrices screen (PRD #52) at scale.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerNotSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';

export interface MandiBand { productId: string; regionId: string; lowMinor: string; modalMinor: string; highMinor: string; sampleSize: number; }

@Injectable()
export class MandiBandReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
  ) {}
  async band(tenantId: string, productId: string, regionId: string): Promise<MandiBand | null> {
    return this.cache.wrap(`t:${tenantId}:mandi:${productId}:${regionId}`, 600, async () => {
      const pool = await this.replica.forTenant(tenantId);
      const r = await pool.query(
        `SELECT percentile_cont(0.1) WITHIN GROUP (ORDER BY price_minor) AS low,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY price_minor) AS modal,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY price_minor) AS high,
                count(*) AS n
           FROM listings
          WHERE tenant_id = $1 AND product_id = $2 AND region_id = $3 AND status = 'published'
            -- PC-56 TENANT-1b-2. A suspended seller's price must not move the band a FARMER reads before selling: this
            -- is the percentile that tells them what their crop is worth, and a suspension often follows a bogus price.
            AND ${sellerNotSuspendedSql('listings')}`,
        [tenantId, productId, regionId]);
      const row = r.rows[0];
      if (!row || Number(row.n) === 0) return null;
      return { productId, regionId, lowMinor: String(Math.round(row.low)),
        modalMinor: String(Math.round(row.modal)), highMinor: String(Math.round(row.high)), sampleSize: Number(row.n) };
    });
  }
}
