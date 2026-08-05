// modules/equipment/services/maintenance.service.ts · PC-54 W54-12 (canon 312). Owner-or-manage writes the
// log (owner check via the asset row); the ALERTS read is Manage (the CHC board view). Costs minor strings.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error';
import { MaintenanceRepository } from '../repositories/maintenance.repository';

const LOG_TYPES = ['service', 'repair', 'breakdown', 'inspection'] as const;

@Injectable()
export class MaintenanceService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly repo: MaintenanceRepository) {}

  async record(tenantId: string, userId: string, assetId: string, dto: { logType: string; costMinor?: string; notes?: string; engineHoursAt?: string; performedOn: string }) {
    if (!(LOG_TYPES as readonly string[]).includes(dto.logType)) throw new BadRequestError('logType must be service|repair|breakdown|inspection');
    const id = uuidv7();
    await this.uow.run(tenantId, (tx) => this.repo.insertLog(tx, { id, tenantId, assetId, ...dto }), { userId });
    return { id };
  }
  logs(tenantId: string, assetId: string) { return this.repo.listLogs(tenantId, assetId); }
  alerts(tenantId: string) { return this.repo.alerts(tenantId); }
}
