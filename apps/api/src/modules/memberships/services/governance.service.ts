// modules/memberships/services/governance.service.ts · PC-54 W54-7. The AGM lifecycle:
// draft → open (voting window live) → closed. Votes land ONLY while open AND inside the window (server
// clock); one ballot per member (DB PK). Results are a tally read — dividend/bonus EXECUTION (money) is a
// separate settlement concern and stays gated (`coop-payout-runs`).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { GovernanceRepository } from '../repositories/governance.repository';

export const RESOLUTION_TYPES = ['agm_vote', 'dividend', 'patronage_bonus', 'board_election'] as const;
export interface GovActor { userId: string; canManage: boolean }

@Injectable()
export class GovernanceService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: GovernanceRepository) {}

  async create(tenantId: string, actor: GovActor, key: string, dto: { title: string; body?: string; resolutionType: string; votingOpens?: string; votingCloses?: string; payload?: Record<string, unknown> }) {
    if (!actor.canManage) throw new ForbiddenError('requires tenant.settings');
    if (dto.votingOpens && dto.votingCloses && dto.votingCloses <= dto.votingOpens) throw new BadRequestError('votingCloses must be after votingOpens');
    return this.idem.remember(key, actor.userId, 'governance.resolution.create', async () => {
      const id = uuidv7();
      await this.uow.run(tenantId, (tx) => this.repo.insert(tx, { id, tenantId, ...dto }), { userId: actor.userId });
      return { id, status: 'draft' as const };
    });
  }
  list(tenantId: string, status?: string) { return this.repo.list(tenantId, status); }

  async transition(tenantId: string, actor: GovActor, id: string, to: 'open' | 'closed') {
    if (!actor.canManage) throw new ForbiddenError('requires tenant.settings');
    const ok = await this.uow.run(tenantId, (tx) => this.repo.setStatus(tx, tenantId, id, to === 'open' ? ['draft'] : ['open'], to), { userId: actor.userId });
    if (!ok) throw new ConflictError(`resolution is not ${to === 'open' ? 'a draft' : 'open'}`);
    return { id, status: to };
  }

  async vote(tenantId: string, memberUserId: string, id: string, choice: string) {
    if (!choice || choice.length > 20) throw new BadRequestError('choice required (max 20)');
    return this.uow.run(tenantId, async (tx) => {
      const res = await this.repo.getForUpdate(tx, tenantId, id);
      if (!res) throw new NotFoundError('resolution not found');
      const now = new Date().toISOString();
      if (res.status !== 'open') throw new ConflictError('voting is not open');
      if (res.votingOpens && now < res.votingOpens) throw new ConflictError('voting has not started');
      if (res.votingCloses && now > res.votingCloses) throw new ConflictError('voting has closed');
      if (!(await this.repo.castVote(tx, id, memberUserId, choice))) throw new ConflictError('you have already voted on this resolution');
      return { resolutionId: id, choice };
    }, { userId: memberUserId });
  }

  async results(tenantId: string, id: string) {
    const res = await this.repo.get(tenantId, id);
    if (!res) throw new NotFoundError('resolution not found');
    return { resolution: res, tally: await this.repo.tally(tenantId, id) };
  }
}
