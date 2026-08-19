// modules/exports/repositories/exporter-registration.repository.ts · all SQL for exporter_registrations.
// tenant_id in EVERY query (Law 1) + RLS. No version column → mutations lock FOR UPDATE. Keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ExporterRegistration } from '../domain/exporter-registration.entity';
import { ExportAuthority } from '../domain/exports.events';
import { pgDateOrNull } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date — node-pg hands back LOCAL midnight and
// `toISOString()` is a DAY EARLY anywhere ahead of UTC (see that file's header; the dairy double-payment proved it).

const COLS = `id, tenant_id, exporter_user_id, authority, reg_no, iec_code, valid_until, doc_id, created_at`;
const d = pgDateOrNull;
function toDomain(r: any): ExporterRegistration {
  return ExporterRegistration.rehydrate({ id: r.id, tenantId: r.tenant_id, exporterUserId: r.exporter_user_id, authority: r.authority as ExportAuthority, regNo: r.reg_no, iecCode: r.iec_code, validUntil: d(r.valid_until), docId: r.doc_id, createdAt: r.created_at });
}
@Injectable()
export class ExporterRegistrationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, e: ExporterRegistration): Promise<void> {
    const p = e.toProps();
    await tx.query(`INSERT INTO exporter_registrations (id, tenant_id, exporter_user_id, authority, reg_no, iec_code, valid_until, doc_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3)`,
      [p.id, p.tenantId, p.exporterUserId, p.authority, p.regNo, p.iecCode, p.validUntil, p.docId]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<ExporterRegistration | null> {
    const r = await tx.query(`SELECT ${COLS} FROM exporter_registrations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<ExporterRegistration | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM exporter_registrations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, e: ExporterRegistration): Promise<void> {
    const p = e.toProps();
    await tx.query(`UPDATE exporter_registrations SET iec_code=$3, valid_until=$4, doc_id=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [p.id, p.tenantId, p.iecCode, p.validUntil, p.docId]);
  }
  async listFor(tenantId: string, q: { exporterUserId?: string; cursor?: { c: string; id: string }; limit: number }): Promise<ExporterRegistration[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.exporterUserId) where += ` AND exporter_user_id=${p(q.exporterUserId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM exporter_registrations WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
