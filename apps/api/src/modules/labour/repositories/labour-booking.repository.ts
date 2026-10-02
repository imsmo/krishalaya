// modules/labour/repositories/labour-booking.repository.ts · all SQL for labour_bookings.
// tenant_id in EVERY query (Law 1) + RLS. labour_bookings HAS a version column → mutations are an
// OPTIMISTIC compare-and-swap on version (lost-update protection at billions of writes); reads on replica;
// lists are keyset (never OFFSET).
//
// PC-56 TENANT-11b:
//   • dates are read with `pgDate` (core/database/pg-date.ts) — `toISOString().slice(0,10)` read a `date` a DAY EARLY under
//     Asia/Kolkata, which would have shifted every planned-days count the escrow is built on;
//   • the job number is assigned by the 0187 trigger (`JOB-<mmdd>-<nn>`): the INSERT sends NULL and reads it back;
//   • the list cursor is minted from `created_at::text` (µs) and compared as `::timestamptz` (F-25), and the list can sort
//     by start date (W163 "Starts ▴") — a second keyset on (start_date, id);
//   • the respond-timeout claim runs PER TENANT inside kv_app's unit of work (F-9): the only cross-tenant read is the
//     tenants table, which kv_relay is granted — never labour_bookings, which it is not.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
import { LabourBooking } from '../domain/labour-booking.entity';
import { BookingStatus } from '../domain/labour-booking.state';
import { WageKind } from '../domain/labour.events';
import { Cursor } from '../domain/cursor';
import { BookingConcurrencyError, InvalidDemandTypeError, SkillNotFoundError } from '../domain/labour.errors';

const COLS = `id, tenant_id, booking_no, employer_user_id, demand_type_id, task_skill_id, workers_needed,
  start_date, end_date, daily_hours::text AS daily_hours, wage_kind, wage_offered_minor, min_wage_minor, currency_code,
  overtime_rate_multiplier::text AS overtime_rate_multiplier, women_only, farm_lat, farm_lng, status, respond_by, version, created_at,
  created_at::text AS created_at_raw, start_time, notes, transport_provided, meals_provided, toilet_confirmed, drinking_water,
  woman_supervisor, transport_pickup_point, transport_pickup_time, village_label, cancel_reason_id, cancel_reason_text,
  cancelled_at, cancelled_by, roster_confirmed_at, roster_confirmed_by, started_at, completed_at, on_behalf, created_by`;
// Read paths also expose the employer's display name and the cancel reason's code (correlated, tenant-safe).
const READ_COLS = `${COLS}, (SELECT u.full_name FROM users u WHERE u.id = labour_bookings.employer_user_id) AS employer_name,
  (SELECT lv.code FROM lookup_values lv WHERE lv.id = labour_bookings.cancel_reason_id) AS cancel_reason_code`;
const hhmm = (v: any): string | null => (v == null ? null : String(v).slice(0, 5));
function toDomain(r: any): LabourBooking {
  return LabourBooking.rehydrate({
    id: r.id, tenantId: r.tenant_id, bookingNo: r.booking_no, employerUserId: r.employer_user_id,
    demandTypeId: r.demand_type_id, taskSkillId: r.task_skill_id, workersNeeded: r.workers_needed,
    startDate: pgDate(r.start_date), endDate: pgDate(r.end_date), dailyHours: Number(r.daily_hours), wageKind: r.wage_kind as WageKind,
    wageOfferedMinor: BigInt(r.wage_offered_minor), minWageMinor: BigInt(r.min_wage_minor), currencyCode: r.currency_code,
    overtimeRateMultiplier: Number(r.overtime_rate_multiplier), womenOnly: r.women_only, farmLat: Number(r.farm_lat),
    farmLng: Number(r.farm_lng), status: r.status as BookingStatus, respondBy: r.respond_by, version: r.version, createdAt: r.created_at,
    startTime: hhmm(r.start_time), notes: r.notes ?? null, employerName: r.employer_name ?? null,
    transportProvided: r.transport_provided, mealsProvided: r.meals_provided, toiletConfirmed: r.toilet_confirmed, drinkingWater: r.drinking_water,
    womanSupervisor: r.woman_supervisor, transportPickupPoint: r.transport_pickup_point ?? null, transportPickupTime: hhmm(r.transport_pickup_time),
    villageLabel: r.village_label ?? null, cancelReasonId: r.cancel_reason_id ?? null, cancelReasonCode: r.cancel_reason_code ?? null,
    cancelReasonText: r.cancel_reason_text ?? null, cancelledAt: r.cancelled_at ?? null, cancelledBy: r.cancelled_by ?? null,
    rosterConfirmedAt: r.roster_confirmed_at ?? null, rosterConfirmedBy: r.roster_confirmed_by ?? null, startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null, onBehalf: r.on_behalf === true, createdBy: r.created_by ?? null, createdAtRaw: r.created_at_raw ?? null,
  });
}
export interface BookingListQuery {
  employerUserId?: string; openOnly?: boolean; status?: string; taskSkillId?: string;
  sort?: 'recent' | 'starts'; cursor?: Cursor; limit: number;
}
/** One list row: the booking + how many seats are filled (accepted or paid assignments). */
export interface BookingListRow { booking: LabourBooking; filledCount: number }

@Injectable()
export class LabourBookingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** INSERT; the 0187 trigger assigns `JOB-<mmdd>-<nn>` (booking_no is sent NULL) and the row's µs created_at is read back. */
  async insert(tx: TxContext, b: LabourBooking, createdBy: string): Promise<{ bookingNo: string; createdAt: Date; createdAtRaw: string }> {
    const p = b.toProps();
    const r = await tx.query(
      `INSERT INTO labour_bookings (id, tenant_id, booking_no, employer_user_id, demand_type_id, task_skill_id,
         workers_needed, start_date, end_date, daily_hours, wage_kind, wage_offered_minor, min_wage_minor,
         currency_code, overtime_rate_multiplier, women_only, farm_lat, farm_lng, status, respond_by, version, start_time, notes, created_by,
         transport_provided, meals_provided, toilet_confirmed, drinking_water, woman_supervisor, transport_pickup_point, transport_pickup_time,
         village_label, on_behalf)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING booking_no, created_at, created_at::text AS created_at_raw`,
      [p.id, p.tenantId, p.employerUserId, p.demandTypeId, p.taskSkillId, p.workersNeeded, p.startDate,
       p.endDate, p.dailyHours, p.wageKind, p.wageOfferedMinor.toString(), p.minWageMinor.toString(), p.currencyCode,
       p.overtimeRateMultiplier, p.womenOnly, p.farmLat, p.farmLng, p.status, p.respondBy, p.version, p.startTime ?? null, p.notes ?? null, createdBy,
       p.transportProvided ?? false, p.mealsProvided ?? false, p.toiletConfirmed ?? false, p.drinkingWater ?? false, p.womanSupervisor ?? false,
       p.transportPickupPoint ?? null, p.transportPickupTime ?? null, p.villageLabel ?? null, p.onBehalf ?? false]);
    return { bookingNo: r.rows[0].booking_no, createdAt: r.rows[0].created_at, createdAtRaw: r.rows[0].created_at_raw };
  }
  /** Lock-free read for marketplace/detail. */
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<LabourBooking | null> {
    const sql = `SELECT ${READ_COLS} FROM labour_bookings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Read within the tx for a mutation, ROW-LOCKED: the escrow and the pay run read money facts under this lock, and the
   *  optimistic version guard in update() stays the lost-update defence for every other writer. */
  async getForWrite(tx: TxContext, tenantId: string, id: string): Promise<LabourBooking | null> {
    const r = await tx.query(`SELECT ${READ_COLS} FROM labour_bookings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Optimistic compare-and-swap on version. Throws BookingConcurrencyError if another writer won. */
  async update(tx: TxContext, b: LabourBooking, expectedVersion: number): Promise<void> {
    const p = b.toProps();
    const r = await tx.query(
      `UPDATE labour_bookings SET status=$3, respond_by=$4, version=version+1, updated_at=now(),
              roster_confirmed_at=$6, roster_confirmed_by=$7, started_at=$8, completed_at=$9,
              cancel_reason_id=$10, cancel_reason_text=$11, cancelled_at=$12, cancelled_by=$13
       WHERE id=$1 AND tenant_id=$2 AND version=$5 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.respondBy, expectedVersion, p.rosterConfirmedAt ?? null, p.rosterConfirmedBy ?? null,
       p.startedAt ?? null, p.completedAt ?? null, p.cancelReasonId ?? null, p.cancelReasonText ?? null, p.cancelledAt ?? null, p.cancelledBy ?? null]);
    if (r.rowCount === 0) throw new BookingConcurrencyError(p.id);
  }
  async listFor(tenantId: string, q: BookingListQuery): Promise<BookingListRow[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.employerUserId) where += ` AND employer_user_id=${p(q.employerUserId)}`;
    if (q.openOnly) where += ` AND status='open'`;
    if (q.status) where += ` AND status=${p(q.status)}::booking_status`;
    if (q.taskSkillId) where += ` AND task_skill_id=${p(q.taskSkillId)}`;
    let order = `created_at DESC, id DESC`;
    if (q.sort === 'starts') {
      // Starts ▴ — keyset on (start_date ASC, id ASC); the cursor's timestamp slot carries the start date at midnight.
      order = `start_date ASC, id ASC`;
      if (q.cursor) { const cc = p(q.cursor.c.slice(0, 10)), ci = p(q.cursor.id); where += ` AND (start_date > ${cc}::date OR (start_date = ${cc}::date AND id > ${ci}))`; }
    } else if (q.cursor) {
      const cc = p(q.cursor.c), ci = p(q.cursor.id);
      where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}))`;
    }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${READ_COLS},
              (SELECT count(*)::int FROM booking_assignments ba WHERE ba.tenant_id = labour_bookings.tenant_id AND ba.booking_id = labour_bookings.id
                  AND ba.status IN ('accepted','paid') AND ba.deleted_at IS NULL) AS filled_count
         FROM labour_bookings WHERE ${where} ORDER BY ${order} LIMIT ${lp}`, params);
    return r.rows.map((row: any) => ({ booking: toDomain(row), filledCount: Number(row.filled_count) }));
  }
  /** The tab counts: bookings per status in this tenant (or this employer's), one GROUP BY. */
  async countByStatus(tenantId: string, employerUserId?: string): Promise<Record<string, number>> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (employerUserId) { params.push(employerUserId); where += ` AND employer_user_id=$2`; }
    const r = await this.replica.forTenant(tenantId).query(`SELECT status::text AS s, count(*)::int AS n FROM labour_bookings WHERE ${where} GROUP BY status`, params);
    const out: Record<string, number> = {};
    for (const row of r.rows as Array<{ s: string; n: number }>) out[row.s] = row.n;
    return out;
  }
  /** F-1 / F-9 — the tenants that hold an OPEN booking past respond_by can only be found per tenant; the cross-tenant read
   *  is `tenants` (kv_relay is granted SELECT on it since 0014). Labour bookings themselves are never read as kv_relay. */
  async activeTenants(pool: Pool): Promise<string[]> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`);
    return r.rows.map((x: { id: string }) => x.id);
  }
  /** Per-tenant claim (kv_app, RLS): open bookings past respond_by, bounded. The act re-locks and re-checks each row. */
  async dueToExpire(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query(
      `SELECT id FROM labour_bookings WHERE tenant_id=$1 AND status='open' AND respond_by IS NOT NULL AND respond_by < $2 AND deleted_at IS NULL
        ORDER BY respond_by LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x: { id: string }) => x.id);
  }

  /** Resolve a labour_demand_type lookup CODE → its platform lookup_values id (anti-IDOR; not client id). */
  async resolveDemandTypeId(tx: TxContext, code: string): Promise<string> {
    const r = await tx.query(`SELECT id FROM lookup_values WHERE type_code='labour_demand_type' AND code=$1 AND tenant_id IS NULL AND is_active=true`, [code]);
    if (!r.rows[0]) throw new InvalidDemandTypeError(code);
    return r.rows[0].id;
  }
  /** A7 — the cancel reason lookup (platform rows). Returns the id + the words the workers are sent, or null. */
  async resolveCancelReason(tx: TxContext, code: string): Promise<{ id: string; code: string; name: string; textRequired: boolean } | null> {
    const r = await tx.query(
      `SELECT id, code, default_name, COALESCE((meta->>'textRequired')::boolean, false) AS text_required FROM lookup_values
        WHERE type_code='labour_cancel_reason' AND code=$1 AND tenant_id IS NULL AND is_active=true`, [code]);
    const row = r.rows[0];
    return row ? { id: row.id, code: row.code, name: row.default_name, textRequired: row.text_required === true } : null;
  }
  /** Validate the skill exists + is active (gives a typed 404 instead of a raw FK violation). */
  async assertSkillExists(tx: TxContext, skillId: string): Promise<void> {
    const r = await tx.query(`SELECT 1 FROM skills WHERE id=$1 AND is_active=true`, [skillId]);
    if (!r.rows[0]) throw new SkillNotFoundError(skillId);
  }
  /** The task's display name for list/detail labels ("groundnut weeding"). */
  async skillNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, default_name FROM skills WHERE id = ANY($1::uuid[])`, [ids]);
    return new Map(r.rows.map((x: { id: string; default_name: string }) => [x.id, x.default_name]));
  }
  /** The employer's user facts the desk needs to act for them (exists in this tenant as a member). */
  async employerInTenant(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_tenant_roles WHERE tenant_id=$1 AND user_id=$2 AND is_active AND deleted_at IS NULL LIMIT 1`, [tenantId, userId]);
    return r.rows.length > 0;
  }
}
