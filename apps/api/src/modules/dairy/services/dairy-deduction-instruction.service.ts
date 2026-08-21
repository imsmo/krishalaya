// modules/dairy/services/dairy-deduction-instruction.service.ts · PC-56 TENANT-6c-5 · the member's arrangement.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."*
//
// THE MEMBER AUTHORISES IT, on the third dairy route in this platform that carries NO permission — after 6c-2's
// dispute and 6c-4's consent, and for the same reason: requiring `dairy.manage` to arrange a deduction from your own
// milk cheque would mean the only people who can agree to a withholding are the people doing it.
//
// Authorised by OWNERSHIP (the membership must be this caller's), 404 rather than 403 on a mismatch so membership ids
// are not probeable, and `channel = 'ambassador_assisted'` for a farmer with no smartphone — 0003's own vocabulary,
// third wave running. An ambassador acting on a member's BEHALF from their own login is delegated authority, which
// this platform does not model anywhere and which 0161's header refuses to fake here.
import { DairyNoticeVarsService } from './dairy-notice-vars.service';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DairyDeductionInstruction } from '../domain/dairy-deduction-instruction.entity';
import { DomainEvent } from '../domain/dairy.events';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import {
  DairyForbiddenError, DeductionInstructionInvalidError, DeductionInstructionNotFoundError,
  DeductionSourceInvalidError, DeductionTypeUnsupportedError, MembershipNotFoundError,
} from '../domain/dairy.errors';
import { AuthoriseDeductionInstructionDto } from '../dto/deduction-instruction.dto';
import { DairyActor } from './mcc-centre.service';

@Injectable()
export class DairyDeductionInstructionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly instructions: DairyDeductionInstructionRepository,
    private readonly types: DairyDeductionTypeRepository,
    private readonly credits: DairyMemberCreditRepository,
    private readonly memberships: DairyMembershipRepository,
    private readonly noticeVars: DairyNoticeVarsService,
  ) {}

  /**
   * The member arranges routine recovery from their milk bill.
   *
   * Idempotency-Key'd (Law 3): this is an arrangement about future money and a double-tap on a 2G connection must not
   * leave two of them — which the database also refuses, through the two partial unique indexes 0161 needed because
   * a NULL `source_id` is not covered by an ordinary unique constraint.
   */
  async authorise(tenantId: string, actorUserId: string, idemKey: string, dto: AuthoriseDeductionInstructionDto, ip: string | null) {
    return this.idem.remember(idemKey, actorUserId, 'dairy.deduction_instruction.authorise', () =>
      timed(this.metrics, 'dairy.deduction_instruction.authorise', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const membership = await this.memberships.getById(tenantId, dto.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(dto.membershipId);
          // OWNERSHIP, and 404 not 403 — 6c-2's ruling for the dispute route, applied a third time.
          if (membership.farmerUserId !== actorUserId) throw new MembershipNotFoundError(dto.membershipId);

          const type = await this.types.byCode(tx, dto.type);
          if (!type) throw new DeductionSourceInvalidError('milk_deduction', dto.type, `'${dto.type}' is not a milk deduction type this platform has`);
          // An arrangement for a type whose money has nowhere to go would be a promise of a recovery that can never
          // happen — refused with the vocabulary's own reason, exactly as a LINE of that type is (0160).
          if (type.destination === 'none') throw new DeductionTypeUnsupportedError(dto.membershipId, type.code, type.unsupportedReason ?? 'no destination');

          // A source-specific arrangement must point at THIS member's own receivable. Checked for the credit, which
          // this module owns; for a loan the fintech module's own read is the authority (it filters by borrower), so
          // this refuses to hold a second opinion about somebody else's aggregate — the same line 6c-4 drew.
          if (dto.sourceId && type.sourceType === 'dairy_member_credit') {
            const credit = await this.credits.getForUpdate(tx, tenantId, dto.sourceId);
            if (!credit) throw new DeductionSourceInvalidError(type.sourceType, dto.sourceId, 'no such member credit');
            if (credit.membershipId !== dto.membershipId) throw new DeductionSourceInvalidError(type.sourceType, dto.sourceId, 'this credit belongs to another member');
          }

          const now = new Date();
          const instruction = DairyDeductionInstruction.authorise({
            id: uuidv7(), tenantId, membershipId: dto.membershipId, typeId: type.id, typeCode: type.code,
            sourceId: dto.sourceId ?? null,
            maxPerCycleMinor: dto.maxPerCycleMinor === undefined ? null : BigInt(dto.maxPerCycleMinor),
            authorisedBy: actorUserId, authorisedAt: now, channel: dto.channel, assistedBy: dto.assistedBy ?? null,
            recordedBy: actorUserId, note: dto.note ?? null,
            // [PC-56 TENANT-6d-7] `{{what}}` and `{{how_much}}` — the two variables this notice is made of, and the two
            // that rendered as empty strings. An arrangement over somebody's milk cheque described by two blanks is
            // not the consent record 6c-5 built.
            notice: await this.noticeVars.deductionInstruction(tx, tenantId, {
              typeCode: type.code,
              maxPerCycleMinor: dto.maxPerCycleMinor === undefined ? null : BigInt(dto.maxPerCycleMinor),
            }),
          });
          try {
            await this.instructions.insert(tx, instruction);
          } catch (e: any) {
            // The two partial unique indexes: one live arrangement per (member, type) and per (member, type, source).
            if (e?.code === '23505') throw new DeductionInstructionInvalidError('this member already has a live arrangement for that deduction — revoke it before arranging a different instalment');
            throw e;
          }
          await this.audit.write(tx, { tenantId, actorUserId, action: 'dairy.deduction_instruction.authorised',
            entityType: 'dairy_deduction_instruction', entityId: instruction.id,
            newValue: { membershipId: dto.membershipId, type: type.code, sourceId: dto.sourceId ?? null, maxPerCycleMinor: dto.maxPerCycleMinor ?? null, channel: dto.channel }, ip });
          await this.flush(tx, tenantId, instruction.id, instruction.pullEvents());
          return instruction.toJSON();
        }, { userId: actorUserId })));
  }

  /**
   * End it — the member, or the desk.
   *
   * BOTH may, and the asymmetry is deliberate: a member must always be able to stop a deduction from their own
   * cheque, and an operator must be able to close an arrangement whose debt is settled or whose member has left. What
   * neither may do is EDIT one, because then the history could not say what was true in July.
   */
  async revoke(tenantId: string, actor: DairyActor, id: string, ip: string | null) {
    return this.uow.run(tenantId, async (tx) => {
      const instruction = await this.instructions.getForUpdate(tx, tenantId, id);
      if (!instruction) throw new DeductionInstructionNotFoundError(id);
      const membership = await this.memberships.getById(tenantId, instruction.membershipId, tx);
      const isMember = membership?.farmerUserId === actor.userId;
      if (!isMember && !actor.canManage) throw new DeductionInstructionNotFoundError(id);   // 404, not 403
      instruction.revoke(new Date(), actor.userId, await this.noticeVars.deductionInstruction(tx, tenantId, {
        typeCode: instruction.toJSON().typeCode as string, maxPerCycleMinor: null,
      }));
      await this.instructions.revoke(tx, instruction);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.deduction_instruction.revoked',
        entityType: 'dairy_deduction_instruction', entityId: id, newValue: { byMember: isMember }, ip });
      await this.flush(tx, tenantId, id, instruction.pullEvents());
      return instruction.toJSON();
    }, { userId: actor.userId });
  }

  /**
   * One membership's arrangements — the member's own, or the desk's.
   *
   * Revoked ones are included on request, because "what has this family agreed to, and what did they agree to before
   * that?" is one question with two halves.
   */
  async listFor(tenantId: string, actor: DairyActor, membershipId: string, includeRevoked: boolean, limit = 50) {
    const membership = await this.memberships.getById(tenantId, membershipId);
    if (!membership) throw new MembershipNotFoundError(membershipId);
    if (membership.farmerUserId !== actor.userId && !actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const rows = await this.instructions.listFor(tenantId, { membershipId, includeRevoked, limit });
    return rows.map((r) => r.toJSON());
  }

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]): Promise<void> {
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'dairy_deduction_instruction', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}
