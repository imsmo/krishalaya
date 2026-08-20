// modules/dairy/services/dairy-member-credit.service.ts · PC-56 TENANT-6c-4 · the MCC's credit desk.
//
// A cooperative sells cattle feed, mineral mix or medicine to a member and takes it out of the next milk cheque. W169
// shows the result — *"−₹500 feed credit"* — and this is the record that makes the deduction recoverable rather than
// simply short.
//
// IT MOVES NO MONEY. The member received goods; the wallet movement happens once, when the deduction is applied at
// payment (`milk-bill-deduction.service.ts`). A disbursal leg here would post a cash transfer that never happened.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DairyMemberCredit } from '../domain/dairy-member-credit.entity';
import { DomainEvent } from '../domain/dairy.events';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { DairyForbiddenError, MembershipNotFoundError, MemberCreditNotFoundError } from '../domain/dairy.errors';
import { IssueMemberCreditDto } from '../dto/member-credit.dto';
import { DairyActor } from './mcc-centre.service';

@Injectable()
export class DairyMemberCreditService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly credits: DairyMemberCreditRepository,
    private readonly memberships: DairyMembershipRepository,
    private readonly lines: MilkBillDeductionRepository,
  ) {}

  /**
   * Record feed/inputs sold on credit.
   *
   * Idempotency-Key'd like every other dairy write (Law 3) — an MCC counter on 2G double-tapping "record" must not
   * leave a member owing twice for one bag of feed, and this is the record a later deduction takes money against.
   */
  async issue(tenantId: string, actor: DairyActor, idemKey: string, dto: IssueMemberCreditDto, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.member_credit.issue', () =>
      timed(this.metrics, 'dairy.member_credit.issue', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const membership = await this.memberships.getById(tenantId, dto.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(dto.membershipId);
          const credit = DairyMemberCredit.issue({
            id: uuidv7(), tenantId, membershipId: dto.membershipId, mccId: dto.mccId ?? null,
            description: dto.description, valueMinor: BigInt(dto.valueMinor),
            // The MCC's own day, from the database, not the pod's clock — TENANT-6a's ruling for the counter board.
            issuedOn: dto.issuedOn ?? await this.today(tx), issuedBy: actor.userId,
          });
          await this.credits.insert(tx, credit);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.member_credit.issued',
            entityType: 'dairy_member_credit', entityId: credit.id,
            newValue: { membershipId: dto.membershipId, valueMinor: dto.valueMinor, description: credit.toJSON().description }, ip });
          await this.flush(tx, tenantId, credit.id, credit.pullEvents());
          return credit.toJSON();
        }, { userId: actor.userId })));
  }

  /** One member's credits — the desk's list, and what the operator reads before deducting anything. */
  async listForMember(tenantId: string, actor: DairyActor, membershipId: string, limit = 50) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const rows = await this.credits.listFor(tenantId, { membershipId, limit });
    return {
      items: rows.map((c) => c.toJSON()),
      outstandingMinor: (await this.credits.outstandingTotal(tenantId, membershipId)).toString(),
    };
  }

  /**
   * ONE credit, with everything ever recovered against it.
   *
   * The reconciliation view from the DESTINATION's side, which is the direction nobody can answer from a jsonb blob:
   * "this ₹500 of feed — which bills paid it off, and when?"
   */
  async getById(tenantId: string, actor: DairyActor, id: string) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const credit = await this.credits.getById(tenantId, id);
    if (!credit) throw new MemberCreditNotFoundError(id);
    const recoveries = await this.lines.listForSource(tenantId, 'dairy_member_credit', id);
    return { ...credit.toJSON(), recoveries: recoveries.map((l) => l.toJSON()) };
  }

  private async today(tx: TxContext): Promise<string> {
    const r = await tx.query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as { d: string }).d);
  }

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]): Promise<void> {
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'dairy_member_credit', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}
