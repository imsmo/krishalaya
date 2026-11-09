// modules/livestock/repositories/vet-booking.repository.ts · all SQL for vet_bookings. tenant_id in EVERY
// query (Law 1) + RLS. No version column → mutations lock the row FOR UPDATE. Reads on replica; keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { VetBooking } from '../domain/vet-booking.entity';
import { VetBookingStatus } from '../domain/vet-booking.state';

const COLS = `id, tenant_id, farmer_user_id, vet_id, service_id, animal_id, urgency, mode, symptoms_text,
  scheduled_at, status, fee_minor, completed_at, created_at`;
function toDomain(r: any): VetBooking {
  return VetBooking.rehydrate({
    id: r.id, tenantId: r.tenant_id, farmerUserId: r.farmer_user_id, vetId: r.vet_id, serviceId: r.service_id,
    animalId: r.animal_id, urgency: r.urgency, mode: r.mode, symptomsText: r.symptoms_text, scheduledAt: r.scheduled_at,
    status: r.status as VetBookingStatus, feeMinor: BigInt(r.fee_minor ?? '0'), completedAt: r.completed_at, createdAt: r.created_at,
  });
}
/** [PC-56 HOTFIX-13] the vet-booking states in which the booked vet may read and write that animal's health file. */
export const VET_FILE_ACCESS_STATUSES = ['accepted', 'en_route', 'in_consult', 'prescribed', 'completed'] as const satisfies readonly VetBookingStatus[];
export interface VetBookingListQuery { farmerUserId?: string; vetId?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class VetBookingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, b: VetBooking): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO vet_bookings (id, tenant_id, farmer_user_id, vet_id, service_id, animal_id, urgency, mode,
         symptoms_text, scheduled_at, status, fee_minor, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$3)`,
      [p.id, p.tenantId, p.farmerUserId, p.vetId, p.serviceId, p.animalId, p.urgency, p.mode, p.symptomsText, p.scheduledAt, p.status, p.feeMinor.toString()]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<VetBooking | null> {
    const r = await tx.query(`SELECT ${COLS} FROM vet_bookings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<VetBooking | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM vet_bookings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /**
   * [PC-56 HOTFIX-13 · founder Q1-A] Does this vet hold a booking ON THIS ANIMAL that opens its health file? The states that count
   * are the ones in which the vet took the job: `accepted`, `en_route`, `in_consult`, `prescribed`, `completed`. A booking the vet
   * has not accepted (`requested`), or one that ended without a visit (`cancelled`, `no_show`), opens nothing.
   */
  async vetHasBookingOnAnimal(tenantId: string, vetId: string, animalId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT 1 FROM vet_bookings WHERE tenant_id=$1 AND vet_id=$2 AND animal_id=$3 AND deleted_at IS NULL AND status = ANY($4::vet_booking_status[]) LIMIT 1`,
      [tenantId, vetId, animalId, [...VET_FILE_ACCESS_STATUSES]]);
    return (r.rowCount ?? r.rows.length) > 0;
  }
  async update(tx: TxContext, b: VetBooking): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `UPDATE vet_bookings SET status=$3, completed_at=$4, scheduled_at=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.completedAt, p.scheduledAt]);
  }
  async listFor(tenantId: string, q: VetBookingListQuery): Promise<VetBooking[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.farmerUserId) where += ` AND farmer_user_id=${p(q.farmerUserId)}`;
    if (q.vetId) where += ` AND vet_id=${p(q.vetId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM vet_bookings WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
