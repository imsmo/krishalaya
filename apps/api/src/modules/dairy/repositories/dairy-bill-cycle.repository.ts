// modules/dairy/repositories/dairy-bill-cycle.repository.ts · PC-56 TENANT-6c-1 · all SQL for dairy_bill_cycles.
// tenant_id in EVERY query (Law 1) + RLS. No version column → state moves lock FOR UPDATE. Reads on the replica.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DairyBillCycle } from '../domain/dairy-bill-cycle.entity';
import { CycleStatus } from '../domain/dairy-cycle';
import { BillCycleNotFoundError } from '../domain/dairy.errors';
import { PaymentCycle } from '../domain/dairy.events';
import { CycleWindow } from '../domain/dairy-counter';

const COLS = `id, tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status, closed_at,
              bills_generated_at, bills_generated, bills_skipped, bills_failed,
              previewed_at, previewed_by, bills_previewed, created_at`;

const PAYDAY_OFFSET_KEY = 'dairy.cycle_payday_offset_days';
const DISPUTE_WINDOW_KEY = 'dairy.dispute_window_hours';

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toDomain(r: any): DairyBillCycle {
  return DairyBillCycle.rehydrate({
    id: r.id,
    tenantId: r.tenant_id,
    paymentCycle: r.payment_cycle as PaymentCycle,
    // `period_start`/`period_end` are `date` columns. Read through the calendar-day mapper, never `toISOString()` —
    // that is the defect TENANT-6b-1 swept out of this codebase, and this repository was on its remaining-sites
    // inventory as "display only". TENANT-6c-1 takes it off that list: the window is now a JOIN KEY (bills group by
    // their cycle) and a boundary the close instant is compared against, so a day-early read is a decision, not a label.
    periodStart: pgDate(r.period_start),
    periodEnd: pgDate(r.period_end),
    closesAt: r.closes_at instanceof Date ? r.closes_at : new Date(String(r.closes_at)),
    payday: pgDate(r.payday),
    status: r.status as CycleStatus,
    closedAt: r.closed_at == null ? null : (r.closed_at instanceof Date ? r.closed_at : new Date(String(r.closed_at))),
    billsGeneratedAt: r.bills_generated_at == null ? null : (r.bills_generated_at instanceof Date ? r.bills_generated_at : new Date(String(r.bills_generated_at))),
    billsGenerated: num(r.bills_generated),
    billsSkipped: num(r.bills_skipped),
    billsFailed: num(r.bills_failed),
    previewedAt: r.previewed_at == null ? null : (r.previewed_at instanceof Date ? r.previewed_at : new Date(String(r.previewed_at))),
    previewedBy: r.previewed_by ?? null,
    billsPreviewed: num(r.bills_previewed),
    createdAt: r.created_at,
  });
}

@Injectable()
export class DairyBillCycleRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Make sure the cycle row for one window exists, and return it.
   *
   * THE CLOSE INSTANT AND THE PAYDAY ARE RESOLVED HERE, IN SQL, AND NOWHERE ELSE.
   *
   *   • `closes_at` = the first instant of the day AFTER `period_end`, **in the tenant's country's timezone**
   *     (`tenants.country_code → countries.timezone`, both NOT NULL, so the join is total). Deriving it in TypeScript
   *     would derive it in whatever timezone the Node process happens to have, which is the exact defect class
   *     TENANT-6b-1 spent a wave removing — and it is worse here than there, because the answer is not merely wrong by
   *     a day in one market: it is a different instant per cooperative, and by Y7 this platform runs in five countries
   *     (Rule Zero). The database is the only component that knows where the cooperative is.
   *
   *     **NAMED, NOT CLOSED: THE RESOLUTION IS PER COUNTRY, NOT PER COOPERATIVE.** There is no `tenants.timezone`
   *     column on this platform — the only timezone a tenant can be traced to is its country's. That is EXACT for
   *     every launch market (India, Bangladesh, Sri Lanka, Nepal, Kenya are each a single zone) and WRONG the day a
   *     multi-zone country signs: `countries` is already seeded with 'US' → 'America/New_York', which would shut a
   *     Californian cooperative's fortnight at 21:00 local. The fix is a nullable per-tenant timezone with a console
   *     field and a backfill — a wave, not a column added here with nothing to write it. Adding the column now would
   *     be a dead column that looks like the problem is solved.
   *
   *   • `payday` = `period_end` + the tenant's `dairy.cycle_payday_offset_days`, read through `setting_definitions`
   *     so the DEFAULT lives in the database too (Law 6). `#>> '{}'` extracts the scalar whether the stored jsonb is
   *     `2` or `"2"` — a tenant override written by a console that stringifies would otherwise crash the cast.
   *
   * Both are FROZEN at insert (`ON CONFLICT DO NOTHING`, and the grant does not let the app role update either
   * column): a cooperative that changes its timezone or its payday must not retroactively move the close and the
   * payday of a fortnight whose bills are already in members' hands.
   */
  async ensure(tx: TxContext, tenantId: string, w: CycleWindow): Promise<DairyBillCycle> {
    await tx.query(
      `INSERT INTO dairy_bill_cycles (id, tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status)
       SELECT $1, $2, $3, $4::date, $5::date,
              (($5::date + 1)::timestamp AT TIME ZONE co.timezone),
              ($5::date + ((COALESCE(ts.value, d.default_value) #>> '{}')::int)),
              'open'
         FROM tenants t
         JOIN countries co ON co.code = t.country_code
         CROSS JOIN setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = t.id
        WHERE t.id = $2 AND d.key = $6
       ON CONFLICT (tenant_id, payment_cycle, period_start, period_end) DO NOTHING`,
      [uuidv7(), tenantId, w.cycle, w.from, w.to, PAYDAY_OFFSET_KEY]);
    const got = await this.findByWindow(tx, tenantId, w);
    // A zero-row INSERT that then reads back nothing means the SELECT source produced no row — a tenant that does not
    // exist, or the payday setting definition missing from `setting_definitions`. Either way the cycle was NOT created,
    // and returning a fabricated object here would give the job a window to bill against that no row backs.
    if (!got) throw new BillCycleNotFoundError(`${tenantId}:${w.cycle}:${w.from}..${w.to}`);
    return got;
  }

  async findByWindow(tx: TxContext, tenantId: string, w: CycleWindow): Promise<DairyBillCycle | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_bill_cycles
        WHERE tenant_id=$1 AND payment_cycle=$2 AND period_start=$3::date AND period_end=$4::date AND deleted_at IS NULL`,
      [tenantId, w.cycle, w.from, w.to]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DairyBillCycle | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_bill_cycles WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Open cycles whose window has shut, oldest first — the cadence job's claim. */
  async dueToClose(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<DairyBillCycle[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_bill_cycles
        WHERE tenant_id=$1 AND status='open' AND closes_at <= $2 AND deleted_at IS NULL
        ORDER BY closes_at, period_start LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map(toDomain);
  }

  /**
   * Cycles that have SHUT and whose bills have never been built, or whose last run left failures behind.
   *
   * [PC-56 TENANT-6c-2] `closed_at IS NOT NULL`, not `status='closed'`. The first version said the latter and stopped
   * seeing a cycle the moment it was previewed — so a bill VOIDED after preview released its pours and was never
   * rebuilt. The status a cycle happens to be sitting in is not the same fact as "has this window shut".
   */
  async needingBills(tx: TxContext, tenantId: string, limit: number): Promise<DairyBillCycle[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_bill_cycles
        WHERE tenant_id=$1 AND closed_at IS NOT NULL AND deleted_at IS NULL
          AND (bills_generated_at IS NULL OR coalesce(bills_failed, 0) > 0)
        ORDER BY period_start LIMIT $2`, [tenantId, limit]);
    return r.rows.map(toDomain);
  }

  /**
   * Persist a state move. Writes ONLY the columns 0157 grants the app role — the window, the close instant and the
   * payday are the terms 312 families were shown, and no code path may edit them in place.
   *
   * Fails closed on a zero-row UPDATE, the ruling TENANT-5d and 6b-1 made for the same shape: a cycle the caller
   * believes it just closed, whose row did not move, would leave the next tick re-closing it forever while the events
   * for the first close are already in the outbox.
   */
  async updateState(tx: TxContext, c: DairyBillCycle): Promise<void> {
    const p = c.toProps();
    const res = await tx.query(
      `UPDATE dairy_bill_cycles
          SET status=$3, closed_at=$4, bills_generated_at=$5, bills_generated=$6, bills_skipped=$7, bills_failed=$8,
              previewed_at=$9, previewed_by=$10, bills_previewed=$11
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.closedAt, p.billsGeneratedAt, p.billsGenerated, p.billsSkipped, p.billsFailed,
       p.previewedAt, p.previewedBy, p.billsPreviewed]);
    if (res.rowCount === 0) throw new BillCycleNotFoundError(p.id);
  }

  /** W169's list: this tenant's cycles, newest window first. */
  async listFor(tenantId: string, q: { cycle?: PaymentCycle; status?: CycleStatus; limit: number }): Promise<DairyBillCycle[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cycle) where += ` AND payment_cycle=${p(q.cycle)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM dairy_bill_cycles WHERE ${where} ORDER BY period_start DESC, payment_cycle LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** Which payment cycles this tenant's ACTIVE memberships actually use — the set of cycles that need rows at all. */
  async activePaymentCycles(tx: TxContext, tenantId: string): Promise<PaymentCycle[]> {
    const r = await tx.query(
      `SELECT DISTINCT payment_cycle FROM dairy_memberships
        WHERE tenant_id=$1 AND is_active = true AND deleted_at IS NULL
        ORDER BY payment_cycle`, [tenantId]);
    return (r.rows as any[]).map((x) => String(x.payment_cycle) as PaymentCycle);
  }

  /**
   * [PC-56 TENANT-6c-2] The tenant's dispute-window length, in hours, with the DEFAULT read from the database (Law 6).
   *
   * Same shape as 0157's payday offset and for the same reason: W169 says 24 hours, but a cooperative whose members
   * walk in once a week may need three days and one paying daily may need six. A literal 24 in the service would be
   * precisely the string Law 6 exists to stop. `#>> '{}'` extracts the scalar whether the stored jsonb is `24` or `"24"`.
   */
  async disputeWindowHours(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query(
      `SELECT (COALESCE(ts.value, d.default_value) #>> '{}')::int AS hours
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
        WHERE d.key = $2`, [tenantId, DISPUTE_WINDOW_KEY]);
    const raw = (r.rows[0] as { hours?: number } | undefined)?.hours;
    // A missing setting DEFINITION means the seed did not run. Refusing beats inventing a window length that decides
    // when 312 families' money moves — and beats defaulting to 0, which would remove the member's check silently.
    if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
      throw new BillCycleNotFoundError(`${tenantId}:setting:${DISPUTE_WINDOW_KEY}`);
    }
    return Number(raw);
  }

  /** The database's own calendar day — the same discipline TENANT-6a set for the counter board. */
  async today(tx: TxContext): Promise<string> {
    const r = await tx.query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as any)?.d ?? '');
  }
}
