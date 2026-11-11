// modules/schemes/services/dbt-bounce.service.ts · PC-55 A3. The bounce desk — CLOSED by PC-56 GOV-3a (GOV-3 Q2-A): every method below refuses
// DBT_IS_NOT_RECORDED_HERE. The laws that follow describe the desk as it was (the rules stay in domain/dbt-bounce.rules.ts, unit-tested).
// LAWS: Process-gated; the AMOUNT is never typed (it is the parent transfer's own amount — a returned credit
// returns exactly what was credited); one OPEN bounce per transfer (DB unique); idempotent record (Law 3);
// resolution demands its evidence (recredit → a real replacement transfer id; abandon → a written reason);
// every step audit-written. The PFMS port is consulted for the honest "provider pending" note — it never
// invents a reconciliation and never moves money.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { DbtBounceRepository } from '../repositories/dbt-bounce.repository';
import { PFMS_PROVIDER, PfmsProvider } from '../providers/pfms.provider';
import { DbtIsNotRecordedHereError } from '../domain/schemes.errors';

export interface BounceActor { userId: string; canProcess: boolean }

@Injectable()
export class DbtBounceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: DbtBounceRepository,
    private readonly audit: AuditWriter,
    @Inject(PFMS_PROVIDER) private readonly pfms: PfmsProvider,
  ) {}
  // PC-56 GOV-3a (GOV-3 Q2-A, lead-applied 2026-11-11; the founder may reopen): returned payments are not recorded on this platform. Every
  // act and read of the returns desk is refused by name (DBT_IS_NOT_RECORDED_HERE) for every caller — no permission is asked first, so the
  // name is heard — before anything is read or written (no bounce row, no audit row; the PFMS port is not consulted).
  async record(_tenantId: string, _a: BounceActor, _transferId: string, _key: string, _dto: unknown, _ip: string | null): Promise<never> { throw new DbtIsNotRecordedHereError('record_return'); }
  async resolve(_tenantId: string, _a: BounceActor, _id: string, _dto: unknown, _ip: string | null): Promise<never> { throw new DbtIsNotRecordedHereError('resolve_return'); }
  async list(_tenantId: string, _a: BounceActor, _q: unknown): Promise<never> { throw new DbtIsNotRecordedHereError('list_returns'); }
  async forApplication(_tenantId: string, _a: BounceActor, _applicationId: string): Promise<never> { throw new DbtIsNotRecordedHereError('application_returns'); }
  async desk(_tenantId: string, _a: BounceActor): Promise<never> { throw new DbtIsNotRecordedHereError('returns_desk'); }
}
