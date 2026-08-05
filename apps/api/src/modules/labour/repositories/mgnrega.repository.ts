// modules/labour/repositories/mgnrega.repository.ts · PC-54 W54-3 `mgnrega-program` (first slice): service
// layer over mgnrega_job_cards (0008, PRD §31.10 convergence). The job card is the worker's 100-day
// guarantee record: job_card_no is UNIQUE nationally; days_used_fy is the convergence counter the
// platform mirrors (synced from the state ledger — we RECORD, the state ledger is the authority).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface JobCard { id: string; userId: string; jobCardNo: string; regionId: string | null; daysUsedFy: number; lastSyncedAt: string | null }
const COLS = `id, user_id, job_card_no, region_id, days_used_fy, last_synced_at`;
const toCard = (r: any): JobCard => ({ id: r.id, userId: r.user_id, jobCardNo: r.job_card_no, regionId: r.region_id, daysUsedFy: r.days_used_fy, lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null });

@Injectable()
export class MgnregaRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async register(tx: TxContext, c: { id: string; userId: string; jobCardNo: string; regionId?: string }): Promise<void> {
    await tx.query(`INSERT INTO mgnrega_job_cards (id, user_id, job_card_no, region_id) VALUES ($1,$2,$3,$4)`, [c.id, c.userId, c.jobCardNo, c.regionId ?? null]);
  }
  async mine(tenantId: string, userId: string): Promise<JobCard[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mgnrega_job_cards WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10`, [userId]);
    return r.rows.map(toCard);
  }
  async list(tenantId: string, q: { regionId?: string; limit: number }): Promise<JobCard[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mgnrega_job_cards WHERE ($1::uuid IS NULL OR region_id=$1) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [q.regionId ?? null, q.limit]);
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
      `SELECT id, user_id, job_card_no, days_used_fy, last_synced_at FROM mgnrega_job_cards WHERE id=$1 AND deleted_at IS NULL`, [id]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, jobCardNo: x.job_card_no, daysUsedFy: x.days_used_fy, lastSyncedAt: x.last_synced_at ? new Date(x.last_synced_at).toISOString() : null } : null;
  }
  /** RAISE-ONLY mirror maintenance. GREATEST() means a concurrent or state-sourced higher value always wins;
   *  last_synced_at is deliberately NOT touched — only a real state sync may claim to have synced. */
  async raiseDaysUsed(tx: TxContext, jobCardId: string, observedWholeDays: number): Promise<void> {
    await tx.query(`UPDATE mgnrega_job_cards SET days_used_fy = GREATEST(days_used_fy, $2) WHERE id=$1`, [jobCardId, observedWholeDays]);
  }
}
