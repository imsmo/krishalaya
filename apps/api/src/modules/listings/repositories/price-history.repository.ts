// modules/listings/repositories/price-history.repository.ts · append-only writes — and, since PC-56 TENANT-2b,
// the read back: 0005 recorded every price change and W124 is the first surface to ever read the trail.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { PriceHistory } from '../domain/price-history.entity';
import { uuidv7 } from '../../../core/database/uuid.util';

export interface PriceHistoryEntry {
  oldPriceMinor: string | null; newPriceMinor: string; changedBy: string; changedByName: string | null; at: string;
}

@Injectable()
export class PriceHistoryRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Newest first, over 0005's own index (listing_id, created_at DESC). Names joined for the feed. */
  async listForListing(tenantId: string, listingId: string, limit: number): Promise<PriceHistoryEntry[]> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT h.old_price_minor::text AS "oldPriceMinor", h.new_price_minor::text AS "newPriceMinor",
              h.changed_by AS "changedBy", u.full_name AS "changedByName", h.created_at AS "at"
         FROM listing_price_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.tenant_id = $1 AND h.listing_id = $2
        ORDER BY h.created_at DESC LIMIT $3`,
      [tenantId, listingId, Math.min(Math.max(limit, 1), 100)]);
    return r.rows;
  }

  async append(tx: TxContext, h: PriceHistory): Promise<void> {
    const p = h.props;
    await tx.query(
      `INSERT INTO listing_price_history (id, listing_id, tenant_id, old_price_minor, new_price_minor, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv7(), p.listingId, p.tenantId, p.oldPriceMinor?.toString() ?? null, p.newPriceMinor.toString(), p.changedBy],
    );
  }
}
