// modules/ambassadors/services/aeps.service.ts · PC-54 W54-13. The W390–W392 rules, server-enforced:
// LOG ONLY (no ledger primitive anywhere near this path); recorder must be an aeps_enabled ambassador;
// ≤3 attempts (dignity rule); NO OTP fallback exists in this taxonomy by design; an uncertified device may
// record ONLY a 'blocked' event (device_not_rd_certified); a 3rd finger-fail must carry the escalation note
// (nearest bank mitra/branch — money untouched); balance figures are BANK-reported, informational only.
//
// PC-56 HOTFIX-10 · H10-2 (survey OPS-1 F-2 / C-9 / E10) — EVERY RECORD AND EVERY SUPERVISOR READ LEAVES ONE AUDIT ROW. This service had no
// AuditWriter: the supervisor's 90-day read of walk-in customers' masked Aadhaar and account digits left no trail. Now:
//   • a record writes `ambassadors.aeps_event_recorded` IN the insert's transaction (so a replayed key writes neither again);
//   • a supervisor read (`GET …/events`) writes `ambassadors.aeps_events_read` BEFORE the rows are returned — if the row cannot be
//     written the read fails, it is never served unrecorded (the TENANT-1b reveal rule).
// Neither row carries a customer digit, a bank name, an amount or a customer id: only what kind of event, its outcome, and (for a
// read) the filters and how many rows were shown. The operator's own `…/events/mine` is her own log and is not audited (E10).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
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
    private readonly audit: AuditWriter,
  ) {}

  private async myAepsProfile(tenantId: string, userId: string) {
    const p = await this.profiles.findByUser(tenantId, userId);
    const props = p?.toProps() as { id: string; aepsEnabled: boolean; isActive: boolean } | undefined;
    if (!props || !props.isActive) throw new ForbiddenError('not an active ambassador');
    if (!props.aepsEnabled) throw new ForbiddenError('AePS is not enabled for this ambassador');
    return props;
  }

  async record(tenantId: string, userId: string, key: string, dto: Omit<AepsEventInput, 'tenantId' | 'ambassadorId'>, ip: string | null = null) {
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
      await this.uow.run(tenantId, async (tx) => {
        const eventId = await this.repo.insert(tx, { ...dto, tenantId, ambassadorId: profile.id });
        await this.profiles.touchActivity(tx, tenantId, profile.id);   // PC-56 TENANT-10a · F-15
        await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'ambassadors.aeps_event_recorded', entityType: 'ambassador_profile', entityId: profile.id,
          newValue: aepsRecordAuditValue(eventId, dto), ip });   // HOTFIX-10: no customer digit
      }, { userId });
      return { recorded: true };
    });
  }

  async mine(tenantId: string, userId: string, limit = 50) {
    const profile = await this.myAepsProfile(tenantId, userId);
    return this.repo.listForAmbassador(tenantId, profile.id, limit);
  }
  /** The supervisor read (ambassador.manage). HOTFIX-10: one audit row per read, written before the rows are returned. */
  async oversight(tenantId: string, actorUserId: string, q: { status?: string; exceptionCode?: string; limit: number }, ip: string | null = null) {
    const rows = await this.repo.list(tenantId, q);
    await this.audit.log({ tenantId, actorUserId, action: 'ambassadors.aeps_events_read', entityType: 'aeps_service_events', entityId: null,
      newValue: { status: q.status?.slice(0, 40) ?? null, exceptionCode: q.exceptionCode?.slice(0, 40) ?? null, limit: q.limit, rows: rows.length, windowDays: 90 }, ip });
    return rows;
  }
}

/** PC-56 HOTFIX-10 · PURE: what the record's audit row says — the event's id, kind and outcome; NEVER a customer digit, bank, amount or id. */
export function aepsRecordAuditValue(eventId: string, dto: Pick<AepsEventInput, 'serviceKind' | 'status' | 'exceptionCode' | 'attemptNo' | 'deviceCertified'>) {
  return { eventId, serviceKind: dto.serviceKind, status: dto.status, exceptionCode: dto.exceptionCode ?? null, attemptNo: dto.attemptNo, deviceCertified: dto.deviceCertified };
}
