// modules/dairy/repositories/dairy-membership.repository.ts · all SQL for dairy_memberships. tenant_id in
// EVERY query (Law 1) + RLS. No version column → reads in-tx for writes. Reads on replica; keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { PaymentCycle, AnimalType } from '../domain/dairy.events';

const COLS = `id, tenant_id, farmer_user_id, mcc_id, member_code, payment_cycle, default_animal_type, is_active, created_at`;
function toDomain(r: any): DairyMembership {
  return DairyMembership.rehydrate({ id: r.id, tenantId: r.tenant_id, farmerUserId: r.farmer_user_id, mccId: r.mcc_id, memberCode: r.member_code,
    paymentCycle: r.payment_cycle as PaymentCycle, defaultAnimalType: r.default_animal_type as AnimalType | null, isActive: r.is_active, createdAt: r.created_at });
}

@Injectable()
export class DairyMembershipRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, m: DairyMembership): Promise<void> {
    const p = m.toProps();
    await tx.query(
      `INSERT INTO dairy_memberships (id, tenant_id, farmer_user_id, mcc_id, member_code, payment_cycle, default_animal_type, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3)`,
      [p.id, p.tenantId, p.farmerUserId, p.mccId, p.memberCode, p.paymentCycle, p.defaultAnimalType, p.isActive]);
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<DairyMembership | null> {
    const sql = `SELECT ${COLS} FROM dairy_memberships WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Locked, for a move: the route and the card are about to change and nothing else may change them meanwhile. */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DairyMembership | null> {
    const r = await tx.query(`SELECT ${COLS} FROM dairy_memberships WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * The route and the card, and nothing else — FAIL-CLOSED.
   *
   * [PC-56 TENANT-6d-3] Deliberately narrow: this is the only write path `dairy_memberships` has ever had beyond
   * `insert`, and widening it to "the whole row" would let a move quietly change a payment preference or a farmer.
   * A zero-row update means the membership was deleted between the read and the write, and returning success would
   * leave a route history describing a move that did not happen — the ninth table to get this treatment (0157's
   * ruling).
   */
  async updateRoute(tx: TxContext, m: DairyMembership, actorUserId: string): Promise<void> {
    const p = m.toProps();
    const r = await tx.query(
      `UPDATE dairy_memberships SET mcc_id=$3, member_code=$4, updated_at=now(), updated_by=$5
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.mccId, p.memberCode, actorUserId]);
    if (r.rowCount === 0) {
      throw new Error(`dairy_memberships route update matched no row (id=${p.id}) — the membership was deleted mid-transaction`);
    }
  }

  /** Is this card the CURRENT card of another membership at that centre? `UNIQUE (tenant_id, mcc_id, member_code)`. */
  async codeTakenAt(tx: TxContext, tenantId: string, mccId: string, memberCode: string, exceptId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM dairy_memberships
        WHERE tenant_id=$1 AND mcc_id=$2 AND member_code=$3 AND id <> $4 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, mccId, memberCode, exceptId]);
    return r.rows.length > 0;
  }

  async listFor(tenantId: string, q: { farmerUserId?: string; mccId?: string; cursor?: { c: string; id: string }; limit: number }): Promise<DairyMembership[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.farmerUserId) where += ` AND farmer_user_id=${p(q.farmerUserId)}`;
    if (q.mccId) where += ` AND mcc_id=${p(q.mccId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM dairy_memberships WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
