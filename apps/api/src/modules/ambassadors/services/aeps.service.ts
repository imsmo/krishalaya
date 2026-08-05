// modules/ambassadors/services/aeps.service.ts · PC-54 W54-13. The W390–W392 rules, server-enforced:
// LOG ONLY (no ledger primitive anywhere near this path); recorder must be an aeps_enabled ambassador;
// ≤3 attempts (dignity rule); NO OTP fallback exists in this taxonomy by design; an uncertified device may
// record ONLY a 'blocked' event (device_not_rd_certified); a 3rd finger-fail must carry the escalation note
// (nearest bank mitra/branch — money untouched); balance figures are BANK-reported, informational only.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AepsEventRepository, AepsEventInput } from '../repositories/aeps-event.repository';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';

@Injectable()
export class AepsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: AepsEventRepository,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  private async myAepsProfile(tenantId: string, userId: string) {
    const p = await this.profiles.findByUser(tenantId, userId);
    const props = p?.toProps() as { id: string; aepsEnabled: boolean; isActive: boolean } | undefined;
    if (!props || !props.isActive) throw new ForbiddenError('not an active ambassador');
    if (!props.aepsEnabled) throw new ForbiddenError('AePS is not enabled for this ambassador');
    return props;
  }

  async record(tenantId: string, userId: string, key: string, dto: Omit<AepsEventInput, 'tenantId' | 'ambassadorId'>) {
    const profile = await this.myAepsProfile(tenantId, userId);
    // W391/W392 cross-field rules the DB CHECKs can't express:
    if (dto.serviceKind === 'cash_withdrawal' && !dto.amountMinor) throw new BadRequestError('a withdrawal event records the bank-side amount');
    if (dto.serviceKind !== 'cash_withdrawal' && dto.amountMinor) throw new BadRequestError('only withdrawals carry an amount');
    if (!dto.deviceCertified && !(dto.status === 'blocked' && dto.exceptionCode === 'device_not_rd_certified'))
      throw new BadRequestError('an uncertified device may only record a blocked device_not_rd_certified event (W392)');
    if (dto.exceptionCode === 'finger_fail' && dto.attemptNo === 3 && !dto.escalationNote)
      throw new BadRequestError('the 3rd finger-fail must carry the escalation note (nearest bank mitra/branch — W392)');
    if (dto.status === 'success' && dto.exceptionCode) throw new BadRequestError('a success event carries no exception code');
    return this.idem.remember(key, userId, 'ambassadors.aeps.record', async () => {
      await this.uow.run(tenantId, (tx) => this.repo.insert(tx, { ...dto, tenantId, ambassadorId: profile.id }), { userId });
      return { recorded: true };
    });
  }

  async mine(tenantId: string, userId: string, limit = 50) {
    const profile = await this.myAepsProfile(tenantId, userId);
    return this.repo.listForAmbassador(tenantId, profile.id, limit);
  }
  oversight(tenantId: string, q: { status?: string; exceptionCode?: string; limit: number }) { return this.repo.list(tenantId, q); }
}
