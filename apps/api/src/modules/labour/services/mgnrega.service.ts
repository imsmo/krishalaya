// modules/labour/services/mgnrega.service.ts · PC-54 W54-3. Register is idempotency-remembered AND the
// job_card_no UNIQUE constraint is the true guard (409 on a re-used number — a card belongs to ONE worker).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ConflictError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { MgnregaRepository } from '../repositories/mgnrega.repository';

@Injectable()
export class MgnregaService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: MgnregaRepository) {}

  register(tenantId: string, userId: string, key: string, dto: { jobCardNo: string; regionId?: string }) {
    return this.idem.remember(key, userId, 'labour.mgnrega.register', async () => {
      const id = uuidv7();
      await this.uow.run(tenantId, async (tx) => {
        try { await this.repo.register(tx, { id, userId, jobCardNo: dto.jobCardNo, regionId: dto.regionId }); }
        catch (e: any) { if (e?.code === '23505') throw new ConflictError('this job card number is already registered'); throw e; }
      }, { userId });
      return { id, jobCardNo: dto.jobCardNo };
    });
  }
  mine(tenantId: string, userId: string) { return this.repo.mine(tenantId, userId); }
  list(tenantId: string, q: { regionId?: string; limit: number }) { return this.repo.list(tenantId, q); }
}
