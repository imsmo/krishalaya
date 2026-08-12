// modules/payments/repositories/mandate.repository.ts
// All SQL for the upi_mandates aggregate (tenant_id in EVERY query — Law 1; RLS is the net).
// Writes are optimistic-locked on `version`; reads come from the replica. Never stores/returns a raw VPA.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Mandate } from '../domain/mandate.entity';
import { MandateStatus } from '../domain/mandate.state';
import { PaymentConcurrencyError } from '../domain/payments.errors';

const COLS = `id, tenant_id, user_id, provider_code, provider_mandate_ref, vpa_masked, purpose,
  max_amount_minor, currency_code, frequency, status, valid_until, cancelled_reason, version, created_at`;
const big = (v: any) => BigInt(v);

function toDomain(r: any): Mandate {
  return Mandate.rehydrate({
    id: r.id, tenantId: r.tenant_id, userId: r.user_id, providerCode: r.provider_code,
    providerMandateRef: r.provider_mandate_ref, vpaMasked: r.vpa_masked, purpose: r.purpose,
    maxAmountMinor: big(r.max_amount_minor), currencyCode: r.currency_code, frequency: r.frequency,
    status: r.status as MandateStatus, validUntil: r.valid_until, cancelledReason: r.cancelled_reason,
    version: r.version, createdAt: r.created_at,
  });
}

@Injectable()
export class MandateRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, m: Mandate): Promise<void> {
    const v = m.toProps();
    await tx.query(
      `INSERT INTO upi_mandates (id, tenant_id, user_id, provider_code, provider_mandate_ref, vpa_masked, purpose,
         max_amount_minor, currency_code, frequency, status, valid_until, version, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$3)`,
      [v.id, v.tenantId, v.userId, v.providerCode, v.providerMandateRef, v.vpaMasked, v.purpose,
       v.maxAmountMinor.toString(), v.currencyCode, v.frequency, v.status, v.validUntil, v.version]);
  }

  /** A live (pending/active/paused) mandate for the user+purpose, if any — enforces the one-live rule in-app. */
  async findLiveByPurpose(tx: TxContext, tenantId: string, userId: string, purpose: string): Promise<Mandate | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM upi_mandates WHERE tenant_id=$1 AND user_id=$2 AND purpose=$3
         AND status IN ('pending','active','paused') FOR UPDATE`, [tenantId, userId, purpose]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Mandate | null> {
    const r = await tx.query(`SELECT ${COLS} FROM upi_mandates WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist a status change (+ provider ref + cancellation), bumping version (optimistic lock). */
  async update(tx: TxContext, m: Mandate): Promise<void> {
    const v = m.toProps();
    const r = await tx.query(
      `UPDATE upi_mandates SET status=$3, provider_mandate_ref=$4, cancelled_reason=$5, version=version+1, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND version=$6`,
      [v.id, v.tenantId, v.status, v.providerMandateRef, v.cancelledReason, v.version]);
    if (r.rowCount === 0) throw new PaymentConcurrencyError(v.id);
  }

  /** Visible to the owner or a moderator only (404 to others — no enumeration). */
  async getVisible(tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<Mandate | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM upi_mandates WHERE id=$1 AND tenant_id=$2 AND ($3=true OR user_id=$4)`, [id, tenantId, canModerate, viewerUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Cursor list of a user's mandates (keyset on created_at,id — never OFFSET). */
  async listForUser(tenantId: string, userId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<Mandate[]> {
    const params: unknown[] = [tenantId, userId];
    let where = `tenant_id=$1 AND user_id=$2 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM upi_mandates WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
