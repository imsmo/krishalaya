// modules/livestock/repositories/animal.repository.ts · all SQL for animals. tenant_id in EVERY query
// (Law 1) + RLS. No version column → mutations lock the row FOR UPDATE. Reads on replica; keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Animal, AnimalProps } from '../domain/animal.entity';
import { AnimalStatus } from '../domain/animal.state';
import { pgDateOrNull } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date — node-pg hands back LOCAL midnight and
// `toISOString()` is a DAY EARLY anywhere ahead of UTC (see that file's header; the dairy double-payment proved it).

const COLS = `id, tenant_id, owner_user_id, species_id, breed_id, pashu_aadhaar, name, sex, dob_estimated, parity,
  lactation_stage, current_yield_lpd, pregnancy_status, body_condition_score, status, acquired_via, created_at`;
const d = pgDateOrNull;
function toDomain(r: any): Animal {
  return Animal.rehydrate({
    id: r.id, tenantId: r.tenant_id, ownerUserId: r.owner_user_id, speciesId: r.species_id, breedId: r.breed_id,
    pashuAadhaar: r.pashu_aadhaar, name: r.name, sex: r.sex, dobEstimated: d(r.dob_estimated), parity: r.parity,
    lactationStage: r.lactation_stage, currentYieldLpd: r.current_yield_lpd != null ? String(r.current_yield_lpd) : null,
    pregnancyStatus: r.pregnancy_status, bodyConditionScore: r.body_condition_score != null ? String(r.body_condition_score) : null,
    status: r.status as AnimalStatus, acquiredVia: r.acquired_via, createdAt: r.created_at,
  });
}
export interface AnimalListQuery { ownerUserId?: string; speciesId?: string; pashuAadhaar?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class AnimalRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, a: Animal): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `INSERT INTO animals (id, tenant_id, owner_user_id, species_id, breed_id, pashu_aadhaar, name, sex, dob_estimated,
         parity, lactation_stage, current_yield_lpd, pregnancy_status, body_condition_score, status, acquired_via, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$3)`,
      [p.id, p.tenantId, p.ownerUserId, p.speciesId, p.breedId, p.pashuAadhaar, p.name, p.sex, p.dobEstimated, p.parity,
       p.lactationStage, p.currentYieldLpd, p.pregnancyStatus, p.bodyConditionScore, p.status, p.acquiredVia]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Animal | null> {
    const r = await tx.query(`SELECT ${COLS} FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<Animal | null> {
    const sql = `SELECT ${COLS} FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, a: Animal): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `UPDATE animals SET breed_id=$3, name=$4, sex=$5, dob_estimated=$6, parity=$7, lactation_stage=$8,
         current_yield_lpd=$9, pregnancy_status=$10, body_condition_score=$11, status=$12, updated_at=now(), updated_by=$13
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.breedId, p.name, p.sex, p.dobEstimated, p.parity, p.lactationStage, p.currentYieldLpd,
       p.pregnancyStatus, p.bodyConditionScore, p.status, p.ownerUserId]);
  }
  async listFor(tenantId: string, q: AnimalListQuery): Promise<Animal[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.ownerUserId) where += ` AND owner_user_id=${p(q.ownerUserId)}`;
    if (q.speciesId) where += ` AND species_id=${p(q.speciesId)}`;
    if (q.pashuAadhaar) where += ` AND pashu_aadhaar=${p(q.pashuAadhaar)}`; // PC-54 W54-4 tag lookup
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM animals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
