// modules/labour/repositories/mgnrega.repository.ts · PC-54 W54-3 `mgnrega-program` (first slice): service
// layer over mgnrega_job_cards (0008, PRD §31.10 convergence). The job card is the worker's 100-day
// guarantee record: job_card_no is UNIQUE nationally; days_used_fy is the convergence counter the
// platform mirrors (synced from the state ledger — we RECORD, the state ledger is the authority).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface JobCard { id: string; userId: string; jobCardNo: string; regionId: string | null; daysUsedFy: number; lastSyncedAt: string | null }
const COLS = `c.id, c.user_id, c.job_card_no, c.region_id, c.days_used_fy, c.last_synced_at`;
const toCard = (r: any): JobCard => ({ id: r.id, userId: r.user_id, jobCardNo: r.job_card_no, regionId: r.region_id, daysUsedFy: r.days_used_fy, lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null });

@Injectable()
export class MgnregaRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async register(tx: TxContext, c: { id: string; userId: string; jobCardNo: string; regionId?: string }): Promise<void> {
    await tx.query(`INSERT INTO mgnrega_job_cards (id, user_id, job_card_no, region_id) VALUES ($1,$2,$3,$4)`, [c.id, c.userId, c.jobCardNo, c.regionId ?? null]);
  }
  async mine(tenantId: string, userId: string): Promise<JobCard[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mgnrega_job_cards c WHERE c.user_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 10`, [userId]);
    return r.rows.map(toCard);
  }
  /** The cross-user oversight LIST (booking.manage). SCOPED BY TENANT MEMBERSHIP — see the note in this file's
   *  header block below `list`: mgnrega_job_cards carries no tenant_id (a card is national and belongs to a
   *  person), so RLS cannot scope it and the membership EXISTS clause is the tenancy boundary (Law 1). Without it
   *  an officer of one FPO could enumerate every other tenant's cardholders. */
  async list(tenantId: string, q: { regionId?: string; limit: number }): Promise<JobCard[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM mgnrega_job_cards c
        WHERE ($1::uuid IS NULL OR c.region_id = $1)
          AND c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = c.user_id AND utr.tenant_id = $3 AND utr.is_active = true AND utr.deleted_at IS NULL)
        ORDER BY c.created_at DESC LIMIT $2`, [q.regionId ?? null, q.limit, tenantId]);
    return r.rows.map(toCard);
  }

  // ===== PC-55 A4 · works & musters (tenant-scoped records of government works) =====
  async insertWork(tx: TxContext, w: { id: string; tenantId: string; workCode: string; workName: string; workCategory?: string; regionId?: string; siteNote?: string; sanctionedDays?: number; sanctionedAmountMinor?: string; startsOn?: string; endsOn?: string }): Promise<{ ok: true } | { ok: false; conflict: 'duplicate_code' }> {
    try {
      await tx.query(
        `INSERT INTO mgnrega_works (id, tenant_id, work_code, work_name, work_category, region_id, site_note,
             sanctioned_days, sanctioned_amount_minor, starts_on, ends_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [w.id, w.tenantId, w.workCode, w.workName, w.workCategory ?? null, w.regionId ?? null, w.siteNote ?? null,
         w.sanctionedDays ?? null, w.sanctionedAmountMinor ?? null, w.startsOn ?? null, w.endsOn ?? null]);
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'duplicate_code' };
      throw e;
    }
  }
  async lockWork(tx: TxContext, tenantId: string, id: string) {
    const r = await tx.query<{ id: string; status: string; starts_on: string | null; ends_on: string | null }>(
      `SELECT id, status, starts_on, ends_on FROM mgnrega_works WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ?? null;
  }
  async updateWork(tx: TxContext, tenantId: string, id: string, patch: { workName?: string; siteNote?: string; sanctionedDays?: number; status?: string; startsOn?: string; endsOn?: string }): Promise<void> {
    await tx.query(
      `UPDATE mgnrega_works SET work_name=COALESCE($3,work_name), site_note=COALESCE($4,site_note),
              sanctioned_days=COALESCE($5,sanctioned_days), status=COALESCE($6,status),
              starts_on=COALESCE($7,starts_on), ends_on=COALESCE($8,ends_on), version=version+1
        WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, patch.workName ?? null, patch.siteNote ?? null, patch.sanctionedDays ?? null, patch.status ?? null, patch.startsOn ?? null, patch.endsOn ?? null]);
  }
  async listWorks(tenantId: string, q: { status?: string; regionId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT w.id, w.work_code, w.work_name, w.work_category, w.region_id, w.site_note, w.sanctioned_days,
              w.sanctioned_amount_minor::text AS sanctioned_amount_minor, w.status, w.starts_on, w.ends_on,
              COALESCE(m.person_days,0)::text AS observed_person_days, COALESCE(m.workers,0)::int AS workers
         FROM mgnrega_works w
         LEFT JOIN (SELECT work_id, SUM(day_fraction) FILTER (WHERE attended) AS person_days,
                           COUNT(DISTINCT job_card_id) AS workers
                      FROM mgnrega_musters WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY work_id) m ON m.work_id = w.id
        WHERE w.tenant_id=$1 AND w.deleted_at IS NULL
          AND ($2::text IS NULL OR w.status=$2) AND ($3::uuid IS NULL OR w.region_id=$3)
        ORDER BY w.created_at DESC LIMIT $4`, [tenantId, q.status ?? null, q.regionId ?? null, Math.min(q.limit, 200)]);
    return r.rows.map((x: any) => ({
      id: x.id, workCode: x.work_code, workName: x.work_name, workCategory: x.work_category, regionId: x.region_id,
      siteNote: x.site_note, sanctionedDays: x.sanctioned_days, sanctionedAmountMinor: x.sanctioned_amount_minor,
      status: x.status, startsOn: x.starts_on ? String(x.starts_on).slice(0, 10) : null,
      endsOn: x.ends_on ? String(x.ends_on).slice(0, 10) : null,
      observedPersonDays: x.observed_person_days, workers: x.workers,
    }));
  }

  async insertMuster(tx: TxContext, m: { id: string; tenantId: string; workId: string; jobCardId: string; musterNo?: string; attendedOn: string; attended: boolean; dayFraction: number; wageMinor?: string; recordedBy: string; source: string }): Promise<{ ok: true } | { ok: false; conflict: 'duplicate_day' }> {
    try {
      await tx.query(
        `INSERT INTO mgnrega_musters (id, tenant_id, work_id, job_card_id, muster_no, attended_on, attended, day_fraction, wage_minor, recorded_by, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [m.id, m.tenantId, m.workId, m.jobCardId, m.musterNo ?? null, m.attendedOn, m.attended, m.dayFraction, m.wageMinor ?? null, m.recordedBy, m.source]);
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'duplicate_day' };
      throw e;
    }
  }
  /** Every muster this platform observed for a card (tenant-scoped, so the ledger says whose view it is). */
  async mustersForCard(tenantId: string, jobCardId: string): Promise<Array<{ attended: boolean; dayFraction: number; attendedOn: string; workId: string; wageMinor: string | null; source: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT attended, day_fraction, attended_on, work_id, wage_minor::text AS wage_minor, source
         FROM mgnrega_musters WHERE tenant_id=$1 AND job_card_id=$2 AND deleted_at IS NULL
        ORDER BY attended_on DESC LIMIT 500`, [tenantId, jobCardId]);
    return r.rows.map((x: any) => ({ attended: x.attended, dayFraction: Number(x.day_fraction), attendedOn: String(x.attended_on).slice(0, 10), workId: x.work_id, wageMinor: x.wage_minor, source: x.source }));
  }
  async cardById(tenantId: string, id: string): Promise<{ id: string; userId: string; jobCardNo: string; daysUsedFy: number; lastSyncedAt: string | null } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT c.id, c.user_id, c.job_card_no, c.days_used_fy, c.last_synced_at
         FROM mgnrega_job_cards c
        WHERE c.id=$1 AND c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = c.user_id AND utr.tenant_id = $2 AND utr.is_active = true AND utr.deleted_at IS NULL)`,
      [id, tenantId]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, jobCardNo: x.job_card_no, daysUsedFy: x.days_used_fy, lastSyncedAt: x.last_synced_at ? new Date(x.last_synced_at).toISOString() : null } : null;
  }
  /** RAISE-ONLY mirror maintenance. GREATEST() means a concurrent or state-sourced higher value always wins;
   *  last_synced_at is deliberately NOT touched — only a real state sync may claim to have synced. */
  async raiseDaysUsed(tx: TxContext, jobCardId: string, observedWholeDays: number): Promise<void> {
    await tx.query(`UPDATE mgnrega_job_cards SET days_used_fy = GREATEST(days_used_fy, $2) WHERE id=$1`, [jobCardId, observedWholeDays]);
  }

  // ===== PC-55 B2 · work demands (0091) — the statutory 15-day clock's register =====
  /** Insert a demand. The UNIQUE (tenant, card, demanded_on) index is the desk double-entry guard, so a duplicate
   *  is reported as a CONFLICT rather than silently swallowed — two rows would distort both the queue and the
   *  state's obligation. */
  async insertDemand(tx: TxContext, d: { id: string; tenantId: string; jobCardId: string; regionId?: string; demandedOn: string; daysRequested: number; applicants?: number; note?: string; recordedBy: string }): Promise<{ ok: true } | { ok: false; conflict: 'duplicate_day' }> {
    try {
      await tx.query(
        `INSERT INTO mgnrega_work_demands (id, tenant_id, job_card_id, region_id, demanded_on, days_requested, applicants, note, recorded_by, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'operator')`,
        [d.id, d.tenantId, d.jobCardId, d.regionId ?? null, d.demandedOn, d.daysRequested, d.applicants ?? 1, d.note ?? null, d.recordedBy]);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === '23505') return { ok: false, conflict: 'duplicate_day' };
      throw e;
    }
  }

  async lockDemand(tx: TxContext, tenantId: string, id: string): Promise<{ id: string; status: string; jobCardId: string; demandedOn: string } | null> {
    const r = await tx.query(
      `SELECT id, status, job_card_id, demanded_on FROM mgnrega_work_demands
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    const x = r.rows[0];
    return x ? { id: x.id, status: x.status, jobCardId: x.job_card_id, demandedOn: String(x.demanded_on).slice(0, 10) } : null;
  }

  /** Allot a REAL work (the CHECK constraint in 0091 refuses 'allotted' without both the work and the date, so an
   *  allotment can never be a promise with nothing behind it). */
  async allotDemand(tx: TxContext, tenantId: string, id: string, workId: string, allottedOn: string): Promise<void> {
    await tx.query(
      `UPDATE mgnrega_work_demands SET status='allotted', allotted_work_id=$3, allotted_on=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='demanded'`, [id, tenantId, workId, allottedOn]);
  }
  async endDemand(tx: TxContext, tenantId: string, id: string, status: 'withdrawn' | 'closed', reason: string | null): Promise<void> {
    await tx.query(
      `UPDATE mgnrega_work_demands SET status=$3, closed_reason=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='demanded'`, [id, tenantId, status, reason]);
  }

  /** The register read the console lives on. Oldest demand first when listing OPEN demands — which is also
   *  overdue-first by construction, so the household waiting longest is at the top rather than buried. */
  async listDemands(tenantId: string, q: { status?: string; regionId?: string; jobCardId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT d.id, d.job_card_id, c.job_card_no, d.region_id, d.demanded_on, d.days_requested, d.applicants,
              d.status, d.allotted_work_id, w.work_code AS allotted_work_code, d.allotted_on, d.closed_reason,
              d.note, d.recorded_by, d.created_at
         FROM mgnrega_work_demands d
         JOIN mgnrega_job_cards c ON c.id = d.job_card_id
         LEFT JOIN mgnrega_works w ON w.id = d.allotted_work_id
        WHERE d.tenant_id=$1 AND d.deleted_at IS NULL
          AND ($2::text IS NULL OR d.status = $2::text)
          AND ($3::uuid IS NULL OR d.region_id = $3::uuid)
          AND ($4::uuid IS NULL OR d.job_card_id = $4::uuid)
        ORDER BY (d.status = 'demanded') DESC, d.demanded_on ASC, d.id
        LIMIT $5`,
      [tenantId, q.status ?? null, q.regionId ?? null, q.jobCardId ?? null, q.limit]);
    return r.rows.map((x: any) => ({
      id: x.id, jobCardId: x.job_card_id, jobCardNo: x.job_card_no, regionId: x.region_id,
      demandedOn: String(x.demanded_on).slice(0, 10), daysRequested: Number(x.days_requested), applicants: Number(x.applicants),
      status: x.status, allottedWorkId: x.allotted_work_id, allottedWorkCode: x.allotted_work_code ?? null,
      allottedOn: x.allotted_on ? String(x.allotted_on).slice(0, 10) : null, closedReason: x.closed_reason ?? null,
      note: x.note ?? null, recordedBy: x.recorded_by,
    }));
  }

  /** Counts for the GW-5 dashboard, computed IN THE DATABASE over the whole register rather than over a page of
   *  rows (a dashboard number derived from `LIMIT 100` would be a confident lie). */
  async demandCounts(tenantId: string, todayIso: string): Promise<{ open: number; overdue: number; allotted: number; ended: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT
         COUNT(*) FILTER (WHERE status='demanded')::int AS open,
         COUNT(*) FILTER (WHERE status='demanded' AND demanded_on + INTERVAL '15 days' < $2::date)::int AS overdue,
         COUNT(*) FILTER (WHERE status='allotted')::int AS allotted,
         COUNT(*) FILTER (WHERE status IN ('withdrawn','closed'))::int AS ended
       FROM mgnrega_work_demands WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId, todayIso]);
    const x = r.rows[0] ?? {};
    return { open: Number(x.open ?? 0), overdue: Number(x.overdue ?? 0), allotted: Number(x.allotted ?? 0), ended: Number(x.ended ?? 0) };
  }

  /** Dashboard counters over the WHOLE register (same reasoning as demandCounts). */
  async programCounts(tenantId: string): Promise<{ jobCards: number; works: Record<string, number>; musterDays: number }> {
    const cards = await this.replica.forTenant(tenantId).query(
      `SELECT COUNT(*)::int AS n FROM mgnrega_job_cards c
        WHERE c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = c.user_id AND utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL)`, [tenantId]);
    const works = await this.replica.forTenant(tenantId).query(
      `SELECT status, COUNT(*)::int AS n FROM mgnrega_works WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    const musters = await this.replica.forTenant(tenantId).query(
      `SELECT COALESCE(SUM(day_fraction) FILTER (WHERE attended), 0)::float AS days
         FROM mgnrega_musters WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId]);
    const byStatus: Record<string, number> = {};
    for (const row of works.rows as any[]) byStatus[row.status] = Number(row.n);
    return { jobCards: Number(cards.rows[0]?.n ?? 0), works: byStatus, musterDays: Math.round(Number(musters.rows[0]?.days ?? 0) * 100) / 100 };
  }

  /** Export rows (the audit-stamped export's payload). Bounded and column-explicit: an export must never become
   *  `SELECT *` that quietly starts shipping a column somebody added later. */
  async exportJobCards(tenantId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT c.id, c.job_card_no, c.region_id, c.days_used_fy, c.last_synced_at, c.created_at
         FROM mgnrega_job_cards c
        WHERE c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = c.user_id AND utr.tenant_id = $2 AND utr.is_active = true AND utr.deleted_at IS NULL)
        ORDER BY c.created_at DESC LIMIT $1`, [limit, tenantId]);
    return r.rows.map((x: any) => ({
      id: x.id, jobCardNo: x.job_card_no, regionId: x.region_id, daysUsedFy: Number(x.days_used_fy),
      lastSyncedAt: x.last_synced_at ? new Date(x.last_synced_at).toISOString() : null,
      registeredAt: x.created_at ? new Date(x.created_at).toISOString() : null,
    }));
  }
}
