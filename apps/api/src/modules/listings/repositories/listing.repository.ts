// modules/listings/repositories/listing.repository.ts
// ALL SQL for the listings aggregate. Production rules enforced here:
//  • tenant_id in EVERY query (Law 1; RLS is the safety net, not the plan)
//  • writes on the tenant's shard inside the caller's tx; reads on a replica (CQRS, Law 12)
//  • optimistic concurrency via version (lost-update protection at billions of writes)
//  • parameterised queries only (no string concatenation -> no SQL injection)
import { Inject, Injectable } from '@nestjs/common';
import { ReadReplicaProvider, READ_REPLICA } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Listing } from '../domain/listing.entity';
import { ListingConcurrencyError, ListingNotFoundError } from '../domain/listing.errors';
import { ListingMapper, ListingRow } from './listing.mapper';

const COLS = `id, tenant_id, seller_user_id, product_id, category_id, title, description,
  quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code,
  organic_claim, status, sale_type, pincode, region_id, lat, lng, visibility, ai_extracted,
  publish_at, published_at, expires_at, version`;
// PC-56 TENANT-2a: reads also carry the QC clock (0138), the rejection reason (0005's column, finally written)
// and the read-only staff creator. INSERT deliberately does NOT — a new listing has no QC history to write.
const READ_COLS = `${COLS}, qc_submitted_at, qc_reviewed_by, qc_reviewed_at, reject_reason, created_by`;

@Injectable()
export class ListingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** WRITE — insert within the caller's transaction (shard already bound). */
  async insert(tx: TxContext, l: Listing): Promise<void> {
    const p = l.toProps();
    await tx.query(
      `INSERT INTO listings
        (${COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [p.id, p.tenantId, p.sellerUserId, p.productId, p.categoryId, p.title, p.description ?? null,
       p.quantityTotal, p.quantityAvailable, p.minOrderQty, p.unitCode, p.priceMinor.toString(),
       p.currencyCode, p.organicClaim, p.status, p.saleType, p.pincode ?? null, p.regionId ?? null,
       p.lat ?? null, p.lng ?? null, p.visibility, p.aiExtracted, p.publishAt ?? null,
       p.publishedAt ?? null, p.expiresAt ?? null, p.version],
    );
  }

  /** WRITE — optimistic-locked update. Throws on concurrent modification. */
  async update(tx: TxContext, l: Listing): Promise<void> {
    const p = l.toProps();
    const r = await tx.query(
      `UPDATE listings SET
         title=$3, description=$4, quantity_total=$5, quantity_available=$6, min_order_qty=$7,
         price_minor=$8, status=$9, published_at=$10, expires_at=$11,
         qc_submitted_at=$13, qc_reviewed_by=$14, qc_reviewed_at=$15, reject_reason=$16,
         version = version + 1, updated_at = now()
       WHERE id=$1 AND tenant_id=$2 AND version=$12 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.title, p.description ?? null, p.quantityTotal, p.quantityAvailable,
       p.minOrderQty, p.priceMinor.toString(), p.status, p.publishedAt ?? null, p.expiresAt ?? null, p.version,
       p.qcSubmittedAt ?? null, p.qcReviewedBy ?? null, p.qcReviewedAt ?? null, p.rejectReason ?? null],
    );
    if (r.rowCount === 0) throw new ListingConcurrencyError(p.id);
  }

  /** WRITE — soft delete (DPDP-friendly; never hard-delete history). */
  async softDelete(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE listings SET deleted_at = now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  }

  /** READ for mutation — fetch on the WRITE connection inside a tx (consistent read). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Listing> {
    const r = await tx.query<ListingRow>(
      `SELECT ${READ_COLS} FROM listings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [id, tenantId],
    );
    if (!r.rows[0]) throw new ListingNotFoundError(id);
    return ListingMapper.toDomain(r.rows[0]);
  }

  /** READ — single listing off a replica (no lock; tolerant of small lag). */
  async findById(tenantId: string, id: string): Promise<Listing | null> {
    const r = await this.replica.forTenant(tenantId).query<ListingRow>(
      `SELECT ${READ_COLS} FROM listings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, tenantId],
    );
    return r.rows[0] ? ListingMapper.toDomain(r.rows[0]) : null;
  }

  /** READ — seller's listings, cursor-paginated off a replica. */
  async listBySeller(tenantId: string, sellerUserId: string, afterId: string | null, limit: number): Promise<Listing[]> {
    const r = await this.replica.forTenant(tenantId).query<ListingRow>(
      `SELECT ${READ_COLS} FROM listings
       WHERE tenant_id=$1 AND seller_user_id=$2 AND deleted_at IS NULL
         AND ($3::uuid IS NULL OR id < $3)
       ORDER BY id DESC LIMIT $4`,
      [tenantId, sellerUserId, afterId, limit],
    );
    return r.rows.map(ListingMapper.toDomain);
  }

  /** JOB READ — active listings past expiry, locked for this worker (per-tenant shard). */
  async findDueForExpiry(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<Listing[]> {
    const r = await tx.query<ListingRow>(
      `SELECT ${READ_COLS} FROM listings
       WHERE tenant_id=$1 AND status='published' AND expires_at IS NOT NULL AND expires_at < $2 AND deleted_at IS NULL
       ORDER BY expires_at ASC LIMIT $3 FOR UPDATE SKIP LOCKED`,
      [tenantId, now, limit],
    );
    return r.rows.map(ListingMapper.toDomain);
  }

  /** JOB READ — listings whose scheduled publish_at has arrived (per-tenant shard). */
  async findDueForPublish(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<Listing[]> {
    const r = await tx.query<ListingRow>(
      `SELECT ${READ_COLS} FROM listings
       WHERE tenant_id=$1 AND status='draft' AND publish_at IS NOT NULL AND publish_at <= $2 AND deleted_at IS NULL
       ORDER BY publish_at ASC LIMIT $3 FOR UPDATE SKIP LOCKED`,
      [tenantId, now, limit],
    );
    return r.rows.map(ListingMapper.toDomain);
  }
}
