// modules/identity/services/session.service.ts · session visibility + revocation (self-service security).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { SessionRepository } from '../repositories/session.repository';

@Injectable()
export class SessionService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly repo: SessionRepository) {}
  /** PC-56 STORE-1a · A4: device family + last active + which one is this session — never an IP, never a place. */
  list(tenantId: string, userId: string, currentSessionId = '') { return this.repo.listForUser(tenantId, userId, currentSessionId); }
  async revoke(tenantId: string, userId: string, sessionId: string) {
    await this.uow.run(tenantId, (tx) => this.repo.revoke(tx, sessionId, userId), { userId });
    return { ok: true };
  }
}
