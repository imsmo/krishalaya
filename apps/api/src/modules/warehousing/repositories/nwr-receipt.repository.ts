// modules/warehousing/repositories/nwr-receipt.repository.ts · all SQL for nwr_receipts. tenant_id in EVERY
// query (Law 1) + RLS. enwr_no is globally UNIQUE. No version column → mutations lock FOR UPDATE. Keyset.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { parseQuantityMilli, formatQuantityMilli } from '../domain/quantity';
import { NwrReceipt } from '../domain/nwr-receipt.entity';
import { NwrRepository } from '../domain/warehousing.events';
import { NwrStatus } from '../domain/nwr-receipt.state';

const COLS = `id, tenant_id, storage_booking_id, repository, enwr_no, holder_user_id, quantity, valuation_minor, status, pledged_loan_id, issued_at, expires_at, created_at`;
const d = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
// PC-56 OPS-2c · OPS2-B23 (F-13): the numeric(12,3) quantity is parsed from and printed to its STRING, digit by digit — never through a float.
const toMilli = (v: string): bigint => parseQuantityMilli(v);
const milliToNum = (m: bigint): string => formatQuantityMilli(m);
function toDomain(r: any): NwrReceipt {
  return NwrReceipt.rehydrate({ id: r.id, tenantId: r.tenant_id, storageBookingId: r.storage_booking_id, repository: r.repository as NwrRepository, enwrNo: r.enwr_no, holderUserId: r.holder_user_id,
    quantityMilli: toMilli(r.quantity), valuationMinor: BigInt(r.valuation_minor), status: r.status as NwrStatus, pledgedLoanId: r.pledged_loan_id, issuedAt: r.issued_at, expiresAt: d(r.expires_at), createdAt: r.created_at });
}
export interface NwrListQuery { holderUserId?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class NwrReceiptRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, n: NwrReceipt): Promise<void> {
    const p = n.toProps();
    await tx.query(
      `INSERT INTO nwr_receipts (id, tenant_id, storage_booking_id, repository, enwr_no, holder_user_id, quantity, valuation_minor, status, issued_at, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$6)`,
      [p.id, p.tenantId, p.storageBookingId, p.repository, p.enwrNo, p.holderUserId, milliToNum(p.quantityMilli), p.valuationMinor.toString(), p.status, p.issuedAt, p.expiresAt]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<NwrReceipt | null> {
    const r = await tx.query(`SELECT ${COLS} FROM nwr_receipts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<NwrReceipt | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM nwr_receipts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Active (non-terminal) receipt for a booking — the one-active-NWR guard. */
  async findActiveForBooking(tx: TxContext, tenantId: string, storageBookingId: string): Promise<NwrReceipt | null> {
    const r = await tx.query(`SELECT ${COLS} FROM nwr_receipts WHERE tenant_id=$1 AND storage_booking_id=$2 AND status IN ('issued','pledged','partially_released') AND deleted_at IS NULL LIMIT 1`, [tenantId, storageBookingId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, n: NwrReceipt): Promise<void> {
    const p = n.toProps();
    await tx.query(`UPDATE nwr_receipts SET status=$3, pledged_loan_id=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [p.id, p.tenantId, p.status, p.pledgedLoanId]);
  }
  async listFor(tenantId: string, q: NwrListQuery): Promise<NwrReceipt[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.holderUserId) where += ` AND holder_user_id=${p(q.holderUserId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM nwr_receipts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
