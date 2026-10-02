// modules/labour/repositories/booking-assignment.repository.ts · all SQL for booking_assignments.
// tenant_id in EVERY query (Law 1) + RLS. No version column → mutations lock the row FOR UPDATE.
// UNIQUE(booking_id, worker_id) is the no-double-assign guard. Reads on replica; lists are keyset.
//
// PC-56 TENANT-11b: the roster read joins the worker's user row for a SHORT name and a MASKED phone (F-19 — the service
// masks; this file never returns a raw phone outside the service), the worker's gender for the women-only gate (F-18),
// and the list cursor is µs (`created_at::text`, F-25).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { BookingAssignment } from '../domain/booking-assignment.entity';
import { AssignmentStatus } from '../domain/booking-assignment.state';
import { Cursor } from '../domain/cursor';

const COLS = `ba.id, ba.booking_id, ba.tenant_id, ba.worker_id, ba.status, ba.accepted_at, ba.voice_consent_media_id, ba.wage_minor,
  ba.created_at, ba.created_at::text AS created_at_raw`;
function toDomain(r: any): BookingAssignment {
  return BookingAssignment.rehydrate({
    id: r.id, bookingId: r.booking_id, tenantId: r.tenant_id, workerId: r.worker_id, status: r.status as AssignmentStatus,
    acceptedAt: r.accepted_at, voiceConsentMediaId: r.voice_consent_media_id, wageMinor: BigInt(r.wage_minor), createdAt: r.created_at,
  });
}
export interface AssignmentListQuery { workerId?: string; bookingId?: string; status?: string; cursor?: Cursor; limit: number; }
/** A roster row: the assignment + who the worker is (raw name / phone — the SERVICE shortens and masks them). */
export interface RosterRow { assignment: BookingAssignment; createdAtRaw: string; workerUserId: string; workerFullName: string | null; workerPhone: string | null }

@Injectable()
export class BookingAssignmentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, a: BookingAssignment, createdBy: string): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `INSERT INTO booking_assignments (id, booking_id, tenant_id, worker_id, status, accepted_at, voice_consent_media_id, wage_minor, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.bookingId, p.tenantId, p.workerId, p.status, p.acceptedAt, p.voiceConsentMediaId, p.wageMinor.toString(), createdBy]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<BookingAssignment | null> {
    const r = await tx.query(`SELECT ${COLS} FROM booking_assignments ba WHERE ba.id=$1 AND ba.tenant_id=$2 AND ba.deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<BookingAssignment | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM booking_assignments ba WHERE ba.id=$1 AND ba.tenant_id=$2 AND ba.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async findByBookingAndWorker(tx: TxContext, tenantId: string, bookingId: string, workerId: string): Promise<BookingAssignment | null> {
    const r = await tx.query(`SELECT ${COLS} FROM booking_assignments ba WHERE ba.tenant_id=$1 AND ba.booking_id=$2 AND ba.worker_id=$3 AND ba.deleted_at IS NULL`, [tenantId, bookingId, workerId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Is this user a worker on this booking (any assignment)? — the A8 party check for booking reads. */
  async userIsOnBooking(tenantId: string, bookingId: string, userId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT 1 FROM booking_assignments ba JOIN worker_profiles w ON w.id = ba.worker_id AND w.tenant_id = ba.tenant_id
        WHERE ba.tenant_id=$1 AND ba.booking_id=$2 AND w.user_id=$3 AND ba.deleted_at IS NULL LIMIT 1`, [tenantId, bookingId, userId]);
    return r.rows.length > 0;
  }
  /** All accepted (and already-paid) assignments for a booking, LOCKED — drives the escrow and the pay run. */
  async listAcceptedForUpdate(tx: TxContext, tenantId: string, bookingId: string): Promise<BookingAssignment[]> {
    const r = await tx.query(`SELECT ${COLS} FROM booking_assignments ba WHERE ba.tenant_id=$1 AND ba.booking_id=$2 AND ba.status IN ('accepted','paid') AND ba.deleted_at IS NULL ORDER BY ba.created_at FOR UPDATE`, [tenantId, bookingId]);
    return r.rows.map(toDomain);
  }
  /** Count of non-terminal assignments occupying a slot (pending/accepted) — the BookingFull guard. */
  async countActive(tx: TxContext, tenantId: string, bookingId: string): Promise<number> {
    const r = await tx.query(`SELECT count(*)::int n FROM booking_assignments WHERE tenant_id=$1 AND booking_id=$2 AND status IN ('pending_worker','accepted') AND deleted_at IS NULL`, [tenantId, bookingId]);
    return r.rows[0]?.n ?? 0;
  }
  /** Filled seats (accepted / paid) — read side. */
  async countFilled(tenantId: string, bookingId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT count(*)::int n FROM booking_assignments WHERE tenant_id=$1 AND booking_id=$2 AND status IN ('accepted','paid') AND deleted_at IS NULL`, [tenantId, bookingId]);
    return r.rows[0]?.n ?? 0;
  }
  /** Accepted count under the booking lock (the assignment accept path's capacity check). */
  async countAccepted(tx: TxContext, tenantId: string, bookingId: string): Promise<number> {
    const r = await tx.query(`SELECT count(*)::int n FROM booking_assignments WHERE tenant_id=$1 AND booking_id=$2 AND status IN ('accepted','paid') AND deleted_at IS NULL`, [tenantId, bookingId]);
    return r.rows[0]?.n ?? 0;
  }
  async update(tx: TxContext, a: BookingAssignment): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `UPDATE booking_assignments SET status=$3, accepted_at=$4, voice_consent_media_id=$5, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.acceptedAt, p.voiceConsentMediaId]);
  }
  async listFor(tenantId: string, q: AssignmentListQuery): Promise<Array<{ assignment: BookingAssignment; createdAtRaw: string }>> {
    const params: unknown[] = [tenantId];
    let where = `ba.tenant_id=$1 AND ba.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.workerId) where += ` AND ba.worker_id=${p(q.workerId)}`;
    if (q.bookingId) where += ` AND ba.booking_id=${p(q.bookingId)}`;
    if (q.status) where += ` AND ba.status=${p(q.status)}::booking_status`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (ba.created_at < ${cc}::timestamptz OR (ba.created_at = ${cc}::timestamptz AND ba.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM booking_assignments ba WHERE ${where} ORDER BY ba.created_at DESC, ba.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ assignment: toDomain(x), createdAtRaw: x.created_at_raw }));
  }
  /** The roster (W164): a booking's assignments with the worker's user facts. Keyset, µs. */
  async rosterFor(tenantId: string, bookingId: string, q: { status?: string; cursor?: Cursor; limit: number }): Promise<RosterRow[]> {
    const params: unknown[] = [tenantId, bookingId];
    let where = `ba.tenant_id=$1 AND ba.booking_id=$2 AND ba.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND ba.status=${p(q.status)}::booking_status`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (ba.created_at < ${cc}::timestamptz OR (ba.created_at = ${cc}::timestamptz AND ba.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS}, w.user_id AS worker_user_id, u.full_name AS worker_full_name, u.phone AS worker_phone
         FROM booking_assignments ba
         JOIN worker_profiles w ON w.id = ba.worker_id AND w.tenant_id = ba.tenant_id
         JOIN users u ON u.id = w.user_id
        WHERE ${where} ORDER BY ba.created_at DESC, ba.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ assignment: toDomain(x), createdAtRaw: x.created_at_raw, workerUserId: x.worker_user_id, workerFullName: x.worker_full_name ?? null, workerPhone: x.worker_phone ?? null }));
  }
  /** Pending / applied assignments for a booking, LOCKED — expired with the booking (timeout) or at roster confirm. */
  async listPendingForUpdate(tx: TxContext, tenantId: string, bookingId: string): Promise<BookingAssignment[]> {
    const r = await tx.query(`SELECT ${COLS} FROM booking_assignments ba WHERE ba.tenant_id=$1 AND ba.booking_id=$2 AND ba.status IN ('pending_worker','applied') AND ba.deleted_at IS NULL FOR UPDATE`, [tenantId, bookingId]);
    return r.rows.map(toDomain);
  }
  /** The worker user ids on a booking in the given assignment statuses — the notification recipients. */
  async workerUserIds(tx: TxContext, tenantId: string, bookingId: string, statuses: readonly AssignmentStatus[]): Promise<string[]> {
    const r = await tx.query(
      `SELECT DISTINCT w.user_id FROM booking_assignments ba JOIN worker_profiles w ON w.id = ba.worker_id AND w.tenant_id = ba.tenant_id
        WHERE ba.tenant_id=$1 AND ba.booking_id=$2 AND ba.status::text = ANY($3::text[]) AND ba.deleted_at IS NULL`, [tenantId, bookingId, [...statuses]]);
    return r.rows.map((x: { user_id: string }) => x.user_id);
  }
  /** A7 — the worker's recorded gender (users.gender), for the women-only gate. null = not recorded. */
  async workerGender(tx: TxContext, tenantId: string, workerId: string): Promise<string | null> {
    const r = await tx.query(`SELECT u.gender FROM worker_profiles w JOIN users u ON u.id = w.user_id WHERE w.id=$1 AND w.tenant_id=$2`, [workerId, tenantId]);
    const g = r.rows[0]?.gender;
    return typeof g === 'string' && g.trim().length > 0 ? g.trim().toLowerCase() : null;
  }
}
