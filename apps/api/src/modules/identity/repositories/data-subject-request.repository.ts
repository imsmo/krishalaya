// modules/identity/repositories/data-subject-request.repository.ts · DPDP rights requests.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { DataSubjectRequest, DsrProps, DsrStatus, DsrType } from '../domain/data-subject-request.entity';

const COLS = `id, user_id, request_type, status, cooling_ends_at, resolution, export_media_id, export_job_id, created_at`;
const toDomain = (r: any): DataSubjectRequest => DataSubjectRequest.rehydrate({ id: r.id, userId: r.user_id, requestType: r.request_type as DsrType, status: r.status as DsrStatus, coolingEndsAt: r.cooling_ends_at, resolution: r.resolution, exportMediaId: r.export_media_id, exportJobId: r.export_job_id ?? null, createdAt: r.created_at ?? null });
/** PC-56 STORE-4a: a person's request history is BOUNDED (Law 11) — newest first. */
export const DSR_LIST_CAP = 50;

/** PC-56 STORE-4a · B1 (founder D1): what stands between the person and a deletion request — migration 0214's SECURITY DEFINER read across every
 *  organisation (money figures are bigint minor units as strings; `currencyCode` null when the person holds nothing). */
export interface PersonCommitments { openOrders: number; escrowMinor: string; walletMinor: string; currencyCode: string | null; invoiceCount: number; multiCurrency: boolean }

@Injectable()
export class DataSubjectRequestRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, d: DataSubjectRequest): Promise<void> {
    const p: DsrProps = d.toProps();
    await tx.query(
      `INSERT INTO data_subject_requests (id, user_id, request_type, status, cooling_ends_at) VALUES ($1,$2,$3,$4,$5)`,
      [p.id, p.userId, p.requestType, p.status, p.coolingEndsAt]);
  }
  async listByUser(tenantId: string, userId: string, cap: number = DSR_LIST_CAP): Promise<DataSubjectRequest[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM data_subject_requests WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $2`, [userId, cap]);
    return r.rows.map(toDomain);
  }
  /** An existing NOT-yet-resolved request of this type (the dedupe guard — one open request per kind per user). PC-56 STORE-4a: locked (the
   *  caller holds the person's advisory lock first, so two first requests serialise and one row is written). */
  async findOpen(tx: TxContext, userId: string, requestType: DsrType): Promise<DataSubjectRequest | null> {
    const r = await tx.query(`SELECT ${COLS} FROM data_subject_requests WHERE user_id=$1 AND request_type=$2 AND status IN ('open','in_progress') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId, requestType]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** PC-56 STORE-4a: one person's DSR acts serialise on a transaction-scoped advisory lock (two first requests in two tabs → one row). */
  async lockPerson(tx: TxContext, userId: string, requestType: DsrType): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`dsr:${requestType}:${userId}`]);
  }
  /** PC-56 STORE-4a: write a request's moved state (the entity decided it — Law 5) and its export job link. */
  async update(tx: TxContext, d: DataSubjectRequest): Promise<void> {
    const p = d.toProps();
    await tx.query(`UPDATE data_subject_requests SET status=$2, resolution=$3, export_job_id=$4, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
      [p.id, p.status, p.resolution, p.exportJobId ?? null]);
  }
  async getForUpdate(tx: TxContext, id: string, userId: string): Promise<DataSubjectRequest | null> {
    const r = await tx.query(`SELECT ${COLS} FROM data_subject_requests WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, userId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** PC-56 STORE-4a · B1: migration 0214's `kv_person_open_commitments` — in the caller's transaction (its `app.user_id` must be `userId`). */
  async commitments(tx: TxContext, userId: string): Promise<PersonCommitments> {
    const r = await tx.query<{ open_orders: number; escrow_minor: string; wallet_minor: string; currency_code: string | null; invoice_count: number; multi_currency: boolean }>(
      `SELECT open_orders, escrow_minor::text AS escrow_minor, wallet_minor::text AS wallet_minor, currency_code, invoice_count, multi_currency
         FROM kv_person_open_commitments($1)`, [userId]);
    const x = r.rows[0];
    if (!x) throw new Error('kv_person_open_commitments answered no row');
    return { openOrders: Number(x.open_orders), escrowMinor: String(x.escrow_minor), walletMinor: String(x.wallet_minor), currencyCode: x.currency_code ?? null,
      invoiceCount: Number(x.invoice_count), multiCurrency: x.multi_currency === true };
  }
  /** PC-56 STORE-4a · B1 (founder D1): `platform.invoice_retention_years` (0214) — null when absent or not a positive integer (the page then
   *  prints no number: never a literal). */
  async invoiceRetentionYears(tx: TxContext): Promise<number | null> {
    const r = await tx.query<{ v: string | null }>(`SELECT (kv_platform_setting('platform.invoice_retention_years') #>> '{}') AS v`);
    const n = Number(r.rows[0]?.v ?? NaN);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
}
