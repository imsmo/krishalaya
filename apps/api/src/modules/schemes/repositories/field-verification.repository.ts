// modules/schemes/repositories/field-verification.repository.ts · PC-54 W54-3 `scheme-field-visits`:
// first service layer over 0066 (DEV-04 shipped schema-only). tenant_id in EVERY query (Law 1) + RLS.
// Evidence rides MEDIA IDS inside geotag jsonb — never inline blobs (Appendix 6 rule).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

export interface FieldVisit {
  id: string; applicationId: string; officerId: string; status: string; scheduledFor: string | null;
  geotag: Array<{ mediaId: string; lat: number; lng: number; capturedAt: string }>;
  measuredValues: Record<string, unknown>; walkTrace: string | null;
  farmerOtpSignoff: string; disputeReason: string | null; submittedAt: string | null; version: number;
}
const COLS = `id, application_id, officer_id, status, scheduled_for, geotag, measured_values, walk_trace, farmer_otp_signoff, dispute_reason, submitted_at, version`;
const toVisit = (r: any): FieldVisit => ({
  id: r.id, applicationId: r.application_id, officerId: r.officer_id, status: r.status,
  scheduledFor: r.scheduled_for ? pgDate(r.scheduled_for) : null,
  geotag: (r.geotag ?? []).map((g: any) => ({ mediaId: g.media_id ?? g.mediaId, lat: g.lat, lng: g.lng, capturedAt: g.captured_at ?? g.capturedAt })),
  measuredValues: r.measured_values ?? {}, walkTrace: r.walk_trace,
  farmerOtpSignoff: r.farmer_otp_signoff, disputeReason: r.dispute_reason,
  submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null, version: r.version,
});

@Injectable()
export class FieldVerificationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async schedule(tx: TxContext, v: { id: string; tenantId: string; applicationId: string; officerId: string; scheduledFor?: string }): Promise<void> {
    await tx.query(
      `INSERT INTO field_verifications (id, tenant_id, application_id, officer_id, status, scheduled_for) VALUES ($1,$2,$3,$4,'scheduled',$5)`,
      [v.id, v.tenantId, v.applicationId, v.officerId, v.scheduledFor ?? null]);
  }
  async listForApplication(tenantId: string, applicationId: string): Promise<FieldVisit[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM field_verifications WHERE tenant_id=$1 AND application_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`, [tenantId, applicationId]);
    return r.rows.map(toVisit);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<FieldVisit | null> {
    const r = await tx.query(`SELECT ${COLS} FROM field_verifications WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toVisit(r.rows[0]) : null;
  }
  /** Officer-of-record submits findings (optimistic lock; geotag = media-id evidence). */
  async submit(tx: TxContext, tenantId: string, id: string, version: number, findings: { geotag: unknown[]; measuredValues: Record<string, unknown>; walkTrace?: string }): Promise<boolean> {
    const r = await tx.query(
      `UPDATE field_verifications SET status='submitted', geotag=$4::jsonb, measured_values=$5::jsonb, walk_trace=$6, submitted_at=now(), version=version+1
        WHERE id=$1 AND tenant_id=$2 AND version=$3 AND status IN ('scheduled','in_progress','pending_otp') AND deleted_at IS NULL`,
      [id, tenantId, version, JSON.stringify(findings.geotag), JSON.stringify(findings.measuredValues), findings.walkTrace ?? null]);
    return (r.rowCount ?? 0) > 0;
  }
}
