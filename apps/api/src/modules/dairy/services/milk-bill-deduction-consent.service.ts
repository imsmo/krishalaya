// modules/dairy/services/milk-bill-deduction-consent.service.ts · PC-56 TENANT-6c-4 · the member's own answer.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, not just standing instructions."*
//
// THE MEMBER RECORDS THIS, on the second dairy route in this platform that carries NO permission (the first is
// TENANT-6c-2's dispute). Requiring `dairy.manage` to consent to a deduction would mean the only people who can agree
// to a withholding are the people doing the withholding — which is the same reasoning 6c-2 wrote for the dispute, and
// the reason 6c-3 could take `dairy.manage` off the farmer role without breaking anything a member does.
//
// Authorised by OWNERSHIP: the bill's membership must be this caller's. 404 rather than 403 on a mismatch, so bill ids
// are not probeable.
//
// AN AMBASSADOR MAY SIT WITH A MEMBER — `channel: 'ambassador_assisted'` with the ambassador in `assisted_by`, 0003's
// own consent-channel vocabulary reused verbatim. A platform that only accepts `app` has excluded the farmers it
// exists for, and the ambassador network is how this platform reaches them (Rule Zero: no shortcut that blocks a
// country, a language or a member).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DairyEventType } from '../domain/dairy.events';
import { deductionConsentRequired } from '../domain/dairy-deduction';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { BillNotFoundError, MembershipNotFoundError } from '../domain/dairy.errors';
import { RecordDeductionConsentDto } from '../dto/deduction-consent.dto';

@Injectable()
export class MilkBillDeductionConsentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly consents: MilkBillDeductionConsentRepository,
    private readonly bills: MilkBillRepository,
    private readonly lines: MilkBillDeductionRepository,
    private readonly memberships: DairyMembershipRepository,
  ) {}

  /**
   * The member answers — yes or no — about the deductions on THEIR bill.
   *
   * The figures are read from the bill inside the transaction and stored on the row; the client does not get to say
   * what it is consenting to. A client-supplied gross is a consent to a number the member may never have seen.
   */
  async record(tenantId: string, actorUserId: string, billId: string, dto: RecordDeductionConsentDto, idemKey: string, ip: string | null) {
    return this.idem.remember(idemKey, actorUserId, 'dairy.bill.deduction_consent', () =>
      timed(this.metrics, 'dairy.bill.deduction_consent', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const bill = await this.bills.getForUpdate(tx, tenantId, billId, await this.lines.linesForBill(tx, tenantId, billId));
          if (!bill) throw new BillNotFoundError(billId);
          const membership = await this.memberships.getById(tenantId, bill.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(bill.membershipId);
          // Ownership, and 404 rather than 403 — 6c-2's ruling for the dispute route.
          if (membership.farmerUserId !== actorUserId) throw new BillNotFoundError(billId);

          const pct = await this.consents.consentThresholdPct(tx, tenantId);
          const id = uuidv7();
          await this.consents.insert(tx, {
            id, tenantId, billId, membershipId: bill.membershipId, memberUserId: actorUserId,
            grossMinor: bill.grossMinor, deductionsMinor: bill.deductionsMinor, thresholdPct: pct,
            granted: dto.granted, channel: dto.channel, assistedBy: dto.assistedBy ?? null, note: dto.note ?? null,
          });
          // Recorded even when the threshold is NOT crossed, deliberately: a member who says "no, don't take the feed
          // money this fortnight" has said something the cooperative must answer whether or not a percentage was hit,
          // and `assertConsented` reads the latest row's `granted` before it reads the threshold.
          await this.audit.write(tx, { tenantId, actorUserId, action: 'dairy.bill.deduction_consent_recorded',
            entityType: 'milk_bill', entityId: billId,
            newValue: { granted: dto.granted, channel: dto.channel, grossMinor: bill.grossMinor.toString(), deductionsMinor: bill.deductionsMinor.toString(), thresholdPct: pct }, ip });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'milk_bill', aggregateId: billId, eventType: DairyEventType.BillDeductionConsentRecorded,
            payload: { v: 1, billId, membershipId: bill.membershipId, granted: dto.granted, channel: dto.channel,
              grossMinor: bill.grossMinor.toString(), deductionsMinor: bill.deductionsMinor.toString(), thresholdPct: pct },
          });
          return {
            id, billId, granted: dto.granted, channel: dto.channel, thresholdPct: pct,
            grossMinor: bill.grossMinor.toString(), deductionsMinor: bill.deductionsMinor.toString(),
            wasRequired: deductionConsentRequired(bill.grossMinor, bill.deductionsMinor, pct),
          };
        }, { userId: actorUserId })));
  }

  /**
   * What this bill's deductions are, whether they need the member's consent, and what the member has said.
   *
   * The MEMBER's own read — the same ownership check, no permission — because W169's promise is that the member *sees
   * every deduction*, and a consent request with nothing to read is a form.
   */
  async statusFor(tenantId: string, actorUserId: string, billId: string) {
    return this.uow.run(tenantId, async (tx) => {
      const bill = await this.bills.getForUpdate(tx, tenantId, billId, await this.lines.linesForBill(tx, tenantId, billId));
      if (!bill) throw new BillNotFoundError(billId);
      const membership = await this.memberships.getById(tenantId, bill.membershipId, tx);
      if (!membership) throw new MembershipNotFoundError(bill.membershipId);
      if (membership.farmerUserId !== actorUserId) throw new BillNotFoundError(billId);
      const pct = await this.consents.consentThresholdPct(tx, tenantId);
      const latest = await this.consents.latestForBill(tx, tenantId, billId);
      return {
        billId, grossMinor: bill.grossMinor.toString(), deductionsMinor: bill.deductionsMinor.toString(),
        netMinor: bill.netMinor.toString(), thresholdPct: pct,
        consentRequired: deductionConsentRequired(bill.grossMinor, bill.deductionsMinor, pct),
        lines: bill.deductionLines.map((l) => ({ id: l.id, type: l.type, amountMinor: l.amountMinor.toString(), status: l.status })),
        latest: latest === null ? null : {
          granted: latest.granted, channel: latest.channel, recordedAt: latest.recordedAt,
          // A consent to figures that have since changed is shown as STALE rather than as consent — the member is
          // being asked again and deserves to know why.
          stale: latest.grossMinor !== bill.grossMinor || latest.deductionsMinor !== bill.deductionsMinor,
        },
      };
    }, { userId: actorUserId });
  }
}
