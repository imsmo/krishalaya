// modules/schemes/services/dbt-transfer.service.ts · the DBT credit records (typed by a person; never money, never observed from PFMS).
// PC-56 GOV-3a (GOV-3 Q2-A, lead-applied): recording a credit is CLOSED — DBT_IS_NOT_RECORDED_HERE for every caller. NO in-platform wallet
// movement ever existed here. What stays: the read of one application's credit records (its applicant or a scheme.process holder).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { DbtTransferRepository } from '../repositories/dbt-transfer.repository';
import { SchemeApplicationRepository } from '../repositories/scheme-application.repository';
import { RecordDbtDto } from '../dto/create-dbt-transfer.dto';
import { ApplicationNotFoundError, DbtIsNotRecordedHereError } from '../domain/schemes.errors';

export interface SchemesActor { userId: string; canApply: boolean; canProcess: boolean; }

@Injectable()
export class DbtTransferService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: DbtTransferRepository,
    private readonly applications: SchemeApplicationRepository,
  ) {}
  /** PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — nobody records a payment on this platform. Refused by name for every caller (no permission is
   *  asked first, so the name is heard), before the application is read and before anything is written: no transfer row, no status move,
   *  no audit row, no outbox row. An approved application stays approved here; the payment itself happens outside this platform. */
  async record(_tenantId: string, _actor: SchemesActor, _applicationId: string, _dto: RecordDbtDto, _ip: string | null): Promise<never> {
    throw new DbtIsNotRecordedHereError('record_credit');
  }
  /** A farmer's own read of the credit records typed on her application before GOV-3a (kept: it writes nothing). */
  async listForApplication(tenantId: string, actor: SchemesActor, applicationId: string) {
    const app = await this.applications.getById(tenantId, applicationId);
    if (!app) throw new ApplicationNotFoundError(applicationId);
    if (app.applicantUserId !== actor.userId && !actor.canProcess) throw new ApplicationNotFoundError(applicationId); // 404, no IDOR
    return (await this.repo.listForApplication(tenantId, applicationId)).map((t) => t.toJSON());
  }
}
