// modules/dairy/repositories/mcc-centre.repository.ts · all SQL for mcc_centres. tenant_id in EVERY query
// (Law 1) + RLS. No version column → mutations lock FOR UPDATE. Reads on replica; keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { MccCentre } from '../domain/mcc-centre.entity';
import { hhmm } from '../domain/mcc-console';

const COLS = `id, tenant_id, code, default_name, region_id, lat, lng, operator_user_id, capacity_litres_shift, analyzer_model, analyzer_serial, is_active, created_at,
  morning_opens_at, morning_closes_at, evening_opens_at, evening_closes_at`;

function toDomain(r: any): MccCentre {
  return MccCentre.rehydrate({ id: r.id, tenantId: r.tenant_id, code: r.code, defaultName: r.default_name, regionId: r.region_id,
    lat: r.lat != null ? String(r.lat) : null, lng: r.lng != null ? String(r.lng) : null, operatorUserId: r.operator_user_id,
    capacityLitresShift: r.capacity_litres_shift != null ? String(r.capacity_litres_shift) : null, analyzerModel: r.analyzer_model,
    analyzerSerial: r.analyzer_serial, isActive: r.is_active, createdAt: r.created_at,
    // `time` comes back from pg as a STRING ("06:00:00"), and it is normalised at the boundary to the HH:MM the
    // domain and every screen speak. Never through a Date: a wall clock given a date acquires a timezone, and this
    // platform resolves a cooperative's zone from its country (0157) — 06:00 would then move when the country did.
    morningOpensAt: hhmm(r.morning_opens_at ?? null), morningClosesAt: hhmm(r.morning_closes_at ?? null),
    eveningOpensAt: hhmm(r.evening_opens_at ?? null), eveningClosesAt: hhmm(r.evening_closes_at ?? null) });
}

@Injectable()
export class MccCentreRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * `created_by` IS THE ACTOR, NOT THE OPERATOR.
   *
   * [PC-56 TENANT-6d-2] This insert passed `p.operatorUserId` into `created_by` — so every centre's standard audit
   * column named the person who would be *holding* the milk as the person who *created the record*, and for the
   * default case (create with no operator supplied, which used the actor) the two happened to coincide and hid it. The
   * custody backfill in 0163.3 reads `created_by` as the assigning author, which is exactly the read that would have
   * inherited the wrong name.
   */
  async insert(tx: TxContext, m: MccCentre, actorUserId: string): Promise<void> {
    const p = m.toProps();
    await tx.query(
      `INSERT INTO mcc_centres (id, tenant_id, code, default_name, region_id, lat, lng, operator_user_id, capacity_litres_shift, analyzer_model, analyzer_serial, is_active, created_by,
                                morning_opens_at, morning_closes_at, evening_opens_at, evening_closes_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [p.id, p.tenantId, p.code, p.defaultName, p.regionId, p.lat, p.lng, p.operatorUserId, p.capacityLitresShift, p.analyzerModel, p.analyzerSerial, p.isActive, actorUserId,
        p.morningOpensAt, p.morningClosesAt, p.eveningOpensAt, p.eveningClosesAt]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<MccCentre | null> {
    const r = await tx.query(`SELECT ${COLS} FROM mcc_centres WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getById(tenantId: string, id: string, tx?: TxContext): Promise<MccCentre | null> {
    const sql = `SELECT ${COLS} FROM mcc_centres WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * The whole mutable surface of a centre, and FAIL-CLOSED.
   *
   * [PC-56 TENANT-6d-2] This method used to write `is_active` and nothing else, and it did not check that it had hit a
   * row: a centre deleted between the read and the write returned success to a caller who believed they had just
   * handed 108 families' milk to a new operator. **Eighth table** to get this treatment (0157's ruling), and the one
   * where it matters most, because the audit row and the outbox event are written by the same transaction — a silent
   * no-op here produces a custody record for a change that did not happen.
   */
  async update(tx: TxContext, m: MccCentre, actorUserId: string): Promise<void> {
    const p = m.toProps();
    const r = await tx.query(
      `UPDATE mcc_centres
          SET is_active=$3, operator_user_id=$4,
              morning_opens_at=$5, morning_closes_at=$6, evening_opens_at=$7, evening_closes_at=$8,
              updated_at=now(), updated_by=$9
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.isActive, p.operatorUserId, p.morningOpensAt, p.morningClosesAt, p.eveningOpensAt, p.eveningClosesAt, actorUserId]);
    if (r.rowCount === 0) {
      throw new Error(`mcc_centres update matched no row (id=${p.id}) — the centre was deleted or moved tenant mid-transaction`);
    }
  }

  async listFor(tenantId: string, q: { activeOnly: boolean; cursor?: { c: string; id: string }; limit: number }): Promise<MccCentre[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.activeOnly) where += ` AND is_active=true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mcc_centres WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /**
   * [PC-56 TENANT-6d-4] Is this code already a centre's, in this tenant?
   *
   * The review step's own question. `UNIQUE (tenant_id, code)` is the guard and `MccCodeExistsError` is the refusal;
   * this exists so the answer appears on the review screen rather than as a 409 after somebody confirms.
   */
  async codeExists(x: SqlExecutor, tenantId: string, code: string): Promise<boolean> {
    const r = await x.query(
      `SELECT 1 FROM mcc_centres WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL LIMIT 1`, [tenantId, code]);
    return r.rows.length > 0;
  }

  /**
   * Does this user hold an active role in this tenant?
   *
   * 0163's trigger is the rule and this is the question asked BEFORE the write, so an operator who was never a member
   * of the cooperative gets a refusal naming them rather than a `check_violation` from a trigger. The two must agree;
   * the trigger is what makes a disagreement safe (Law 1: RLS — and a constraint — is the net, not the plan).
   */
  async userHoldsRoleInTenant(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM user_tenant_roles
        WHERE user_id=$2 AND tenant_id=$1 AND is_active AND deleted_at IS NULL LIMIT 1`, [tenantId, userId]);
    return r.rows.length > 0;
  }
}
