// modules/schemes/services/gov-export.service.ts · PC-54 W54-10 `gov-report-exports` + `dbt-read-models`
// (Ledger Appendix 5 law: "every export any GW wave ships must return an audit-stamped receipt").
// An EXPORT here is a READ THAT LEAVES A TRAIL: the receipt (who / when / what-filter / row-count) is
// written to the partitioned audit ledger IN THE SAME breath as the rows are produced — the receipt id is
// returned with the data, so the file the officer saves carries its own provenance.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { DbtTransferRepository } from '../repositories/dbt-transfer.repository';

export interface GovActor { userId: string; canProcess: boolean }
const REPORTS = ['dbt_monitor', 'dbt_recent'] as const;

@Injectable()
export class GovExportService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly audit: AuditWriter, private readonly dbt: DbtTransferRepository) {}

  monitor(tenantId: string, a: GovActor) {
    if (!a.canProcess) throw new ForbiddenError('requires scheme.process');
    return this.dbt.monitor(tenantId);
  }
  recent(tenantId: string, a: GovActor, schemeId?: string, limit = 100) {
    if (!a.canProcess) throw new ForbiddenError('requires scheme.process');
    return this.dbt.recent(tenantId, schemeId, Math.min(limit, 200)).then((rows) => rows.map((t) => { const p = t.toProps(); return { ...p, amountMinor: p.amountMinor.toString() }; }));
  }

  /** The audit-stamped export: rows + a receipt written to the ledger in one tx. */
  async export(tenantId: string, a: GovActor, ip: string | null, dto: { report: string; schemeId?: string; limit?: number }) {
    if (!a.canProcess) throw new ForbiddenError('requires scheme.process');
    if (!(REPORTS as readonly string[]).includes(dto.report)) throw new BadRequestError(`report must be one of ${REPORTS.join('|')}`);
    const rows = dto.report === 'dbt_monitor'
      ? await this.dbt.monitor(tenantId)
      : (await this.dbt.recent(tenantId, dto.schemeId, Math.min(dto.limit ?? 100, 500))).map((t) => { const p = t.toProps(); return { ...p, amountMinor: p.amountMinor.toString() }; });
    const receiptId = uuidv7();
    const generatedAt = new Date().toISOString();
    await this.uow.run(tenantId, (tx) => this.audit.write(tx, {
      tenantId, actorUserId: a.userId, action: 'gov.report_exported', entityType: 'gov_export_receipt', entityId: receiptId,
      newValue: { report: dto.report, filters: { schemeId: dto.schemeId ?? null, limit: dto.limit ?? null }, rowCount: rows.length, generatedAt }, ip,
    }), { userId: a.userId });
    return { receipt: { id: receiptId, report: dto.report, generatedAt, generatedBy: a.userId, rowCount: rows.length, filters: { schemeId: dto.schemeId ?? null } }, rows };
  }
}
