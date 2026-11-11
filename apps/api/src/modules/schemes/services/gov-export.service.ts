// modules/schemes/services/gov-export.service.ts · PC-54 W54-10 `gov-report-exports` + `dbt-read-models` — CLOSED by PC-56 GOV-3a.
// GOV-3 Q2-A and Q4-A (lead-applied 2026-11-11; the founder may reopen): nobody records payments here, and payment records cannot be
// downloaded. The tenant DBT monitor (sums per scheme), the recent-credits list and the "audit-stamped" export are refused by name
// (DBT_IS_NOT_RECORDED_HERE) for every caller, before anything is read or written. (survey_gov3 C-2: the old "receipt" was one audit_log row —
// no file, no sha256, no signed link — and the recent rows carried the farmer's raw user id; F-6.)
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { DbtTransferRepository } from '../repositories/dbt-transfer.repository';
import { DbtIsNotRecordedHereError } from '../domain/schemes.errors';

export interface GovActor { userId: string; canProcess: boolean }

@Injectable()
export class GovExportService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly audit: AuditWriter, private readonly dbt: DbtTransferRepository) {}

  async monitor(_tenantId: string, _a: GovActor): Promise<never> { throw new DbtIsNotRecordedHereError('monitor'); }
  async recent(_tenantId: string, _a: GovActor, _schemeId?: string, _limit = 100): Promise<never> { throw new DbtIsNotRecordedHereError('recent'); }
  async export(_tenantId: string, _a: GovActor, _ip: string | null, _dto: unknown): Promise<never> { throw new DbtIsNotRecordedHereError('export'); }
}
