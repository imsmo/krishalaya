// modules/tenancy/services/tenant-application.service.ts · PC-55 A1 (public intake).
// HONEST DESIGN: submitting an application is NOT a tenant and NOT a login — it creates a reviewable case
// and returns only a reference. The reply carries NO tenant, NO token, NO queue data (an applicant learns
// nothing about the platform's other applicants). Idempotent by header key (Law 3): a retried tap returns
// the SAME accepted answer instead of a second case. A duplicate OPEN application for the same org+phone is
// a 409 that tells the truth ("we already have your application under review") — never a silent twin.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ConflictError } from '../../../shared/errors/app-error';
import { TenantApplicationRepository } from '../repositories/tenant-application.repository';
import { CreateTenantApplicationDto } from '../dto/create-tenant-application.dto';

@Injectable()
export class TenantApplicationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: TenantApplicationRepository,
  ) {}

  async submit(dto: CreateTenantApplicationDto, idempotencyKey: string, ip: string | null) {
    const id = uuidv7();
    // NOTE: no tenant context exists yet — the public intake runs OUTSIDE tenant RLS by construction
    // (0081 carries no tenant_id column, so no tenant_isolation policy can apply). We still take ONE ACID tx
    // via the UoW for retries/atomicity, passing EMPTY context strings: current_tenant_id()/current_user_id()
    // are `NULLIF(current_setting(...),'')::uuid` (0001), so '' resolves to NULL instead of a bad-UUID cast.
    const res = await this.uow.run('', (tx) => this.repo.insert(tx, {
      id,
      orgName: dto.orgName,
      orgTypeId: dto.orgTypeId,
      orgTypeOther: dto.orgTypeOther,
      countryCode: dto.countryCode,
      regionIds: dto.regionIds,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
      contactEmail: dto.contactEmail,
      memberCountEstimate: dto.memberCountEstimate,
      pitchText: dto.pitchText,
      docMediaIds: dto.docMediaIds,
      submitIp: ip,
      idempotencyKey,
    }), { userId: '' });

    if (!res.ok && res.conflict === 'duplicate_open') {
      throw new ConflictError('an application for this organisation and phone is already under review');
    }
    // 'replay' → the same key already created a case: answer accepted, exactly as the first time (Law 3).
    return { reference: id.slice(0, 8).toUpperCase(), status: 'submitted' as const };
  }
}
