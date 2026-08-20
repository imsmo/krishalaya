// modules/dairy/services/milk-bill.service.ts · THE MONEY PATH — per-cycle milk settlement → wallet payout.
// generate(): aggregates a membership's UNBILLED collections in a period (FOR UPDATE), nets off deductions,
// writes a draft bill and stamps the collections (idempotent per cycle via UNIQUE(membership,period)).
// pay(): the cooperative pays the farmer the NET through the wallet boundary (tenant 'main' → farmer
// userMain, txnType 'milk_payment', a ZERO-SUM, idempotent ledger txn — Law 2). Every write: one ACID tx
// (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money mutations (Law 3), authz
// THROWS (Law 6). No version column → bills lock FOR UPDATE. (Bank-disbursement payout_id is deferred.)
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, TenantAccount } from '../../../core/wallet/account-codes';
import { AccountRef } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkBill, BillDeduction } from '../domain/milk-bill.entity';
import { DairyEventType, DomainEvent } from '../domain/dairy.events';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { GenerateBillDto } from '../dto/create-milk-bill.dto';
import { MembershipNotFoundError, BillNotFoundError, EmptyBillError, AllPoursHeldError, BillNotPayableError, DairyForbiddenError,
  DeductionConsentRefusedError, DeductionConsentRequiredError, DeductionRecoveryDisabledError, DeductionSourceInvalidError,
  DeductionTypeUnsupportedError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { MilkBillDeductionService } from './milk-bill-deduction.service';
import { MilkBillDeduction } from '../domain/milk-bill-deduction.entity';
import { consentMatchesBill, deductionConsentRequired } from '../domain/dairy-deduction';

const tenantMain = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode: 'INR' });

@Injectable()
export class MilkBillService {
  private readonly log = new Logger(MilkBillService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly bills: MilkBillRepository,
    private readonly collections: MilkCollectionRepository,
    private readonly memberships: DairyMembershipRepository,
    // [PC-56 TENANT-6c-2] The dispute window's LENGTH is a tenant setting, and this repository is where this module
    // reads tenant settings (0157 put the payday there for the same reason). A bill cannot be previewed without
    // knowing how long its member has, so the dependency is real rather than convenient.
    private readonly cycles: DairyBillCycleRepository,
    // [PC-56 TENANT-6c-4] The deduction's destination: the lines, the vocabulary, the member's consent, the applier
    // that posts each line to what it pays, and the kill-switch over the whole recovery path (Law 10).
    private readonly deductionLines: MilkBillDeductionRepository,
    private readonly deductionTypes: DairyDeductionTypeRepository,
    private readonly credits: DairyMemberCreditRepository,
    private readonly consents: MilkBillDeductionConsentRepository,
    private readonly deductions: MilkBillDeductionService,
    private readonly flags: FlagsService,
  ) {}

  /**
   * [PC-56 TENANT-6c-4] W169: *"Deductions above 25% of gross need the member's fresh consent, not just standing
   * instructions."*
   *
   * The threshold comes from the tenant SETTING (`dairy.deduction_consent_pct`, 0160), and FRESH means the consent
   * names THIS bill's own figures — see `domain/dairy-deduction.ts`. Three outcomes an operator must be able to tell
   * apart, which is why they are three different errors:
   *   * nobody has asked the member                     → DEDUCTION_CONSENT_REQUIRED (stale: false)
   *   * the member agreed to figures that have changed  → DEDUCTION_CONSENT_REQUIRED (stale: true)   ← ask again
   *   * the member said NO                              → DEDUCTION_CONSENT_REFUSED                  ← do not retry
   * Collapsing the third into the first would turn a member's refusal into a queue item that a retry eventually
   * satisfies, which is the opposite of what a consent is.
   */
  private async assertConsented(tx: TxContext, tenantId: string, bill: MilkBill): Promise<{ refusalOnFileBelowThreshold: boolean }> {
    const pct = await this.consents.consentThresholdPct(tx, tenantId);
    const latest = await this.consents.latestForBill(tx, tenantId, bill.id);
    if (!deductionConsentRequired(bill.grossMinor, bill.deductionsMinor, pct)) {
      // BELOW THE THRESHOLD A REFUSAL DOES NOT BLOCK THE PAYMENT, and this is the hardest call in the wave.
      //
      // The first draft of this method read `granted` before the threshold, so a member could refuse a ₹500 feed
      // recovery on a ₹9,000 bill and stop their OWN ₹8,914 from moving. That is not protection — it hands a member a
      // veto whose only victim is the member, and it lets a genuinely owed debt be refused forever by tapping "no".
      // W169's sentence is deliberately narrow: *"Deductions ABOVE 25% of gross need the member's fresh consent, NOT
      // JUST STANDING INSTRUCTIONS"* — which says that below that line the standing arrangement is what governs.
      //
      // What must not happen is the objection being SILENTLY discarded, so it is returned, logged and written into the
      // payment's audit entry. The member's real remedy below the threshold is the DISPUTE route (TENANT-6c-2), which
      // pauses the one bill properly and gets them an answer with a note — and the console can say so.
      if (latest && !latest.granted) {
        this.log.warn(`dairy bill ${bill.id} paid with a member REFUSAL on file (recorded ${latest.recordedAt.toISOString()}): deductions ${bill.deductionsMinor} of gross ${bill.grossMinor} are at or below the tenant's ${pct}% consent threshold, so the standing arrangement governs. The member's objection is recorded in the audit entry and their remedy is a dispute on this bill.`);
        return { refusalOnFileBelowThreshold: true };
      }
      return { refusalOnFileBelowThreshold: false };
    }
    if (latest && !latest.granted) throw new DeductionConsentRefusedError(bill.id, latest.recordedAt.toISOString());
    if (!consentMatchesBill(latest, { grossMinor: bill.grossMinor, deductionsMinor: bill.deductionsMinor })) {
      throw new DeductionConsentRequiredError(bill.id, bill.grossMinor.toString(), bill.deductionsMinor.toString(), pct, latest !== null);
    }
    return { refusalOnFileBelowThreshold: false };
  }

  /**
   * [PC-56 TENANT-6c-4] Can this line's SOURCE actually take this amount, and does it belong to this member?
   *
   * Checked at generation as well as at payment. Not a duplicated guard: at generation it is the operator's typo
   * caught while they are still there, and at payment it is the fortnight that has passed since — a loan closed by a
   * cash repayment, a feed credit already recovered on another bill. The one it must never be is only-at-payment,
   * which is how a cooperative ends up with 312 unpayable bills on payday.
   */
  private async assertSourceRecoverable(tx: TxContext, tenantId: string, membershipId: string, sourceType: string, sourceId: string, amountMinor: bigint): Promise<void> {
    if (amountMinor <= 0n) throw new DeductionSourceInvalidError(sourceType, sourceId, 'a deduction must be greater than zero');
    if (sourceType === 'dairy_member_credit') {
      const credit = await this.credits.getForUpdate(tx, tenantId, sourceId);
      if (!credit) throw new DeductionSourceInvalidError(sourceType, sourceId, 'no such member credit');
      if (credit.membershipId !== membershipId) throw new DeductionSourceInvalidError(sourceType, sourceId, 'this credit belongs to another member');
      if (credit.outstandingMinor < amountMinor) {
        throw new DeductionSourceInvalidError(sourceType, sourceId, `only ${credit.outstandingMinor} minor units are outstanding on this credit`);
      }
      return;
    }
    if (sourceType === 'loan') {
      // The loan's own invariants belong to the fintech module and are enforced there when the line is APPLIED
      // (`LoanService.applyMilkBillDeduction` checks tenant, borrower, servicing status and over-repayment). What
      // this module refuses to do is invent a second opinion about somebody else's aggregate — so it checks nothing
      // here it cannot own, and the honest consequence is that a bad loan id fails at payment rather than at
      // generation. Naming that, rather than reaching into `loans` with a query of our own.
      return;
    }
    throw new DeductionSourceInvalidError(sourceType, sourceId, `this platform has no recovery mechanism for a ${sourceType}`);
  }

  /** `now + the tenant's dispute-window hours`, as an instant. Computed from a DB-sourced length, never a literal 24. */
  private async windowEnd(tx: TxContext, tenantId: string, now: Date): Promise<Date> {
    const hours = await this.cycles.disputeWindowHours(tx, tenantId);
    return new Date(now.getTime() + hours * 3_600_000);
  }

  /**
   * Generate a draft bill from a membership's unbilled collections in [periodStart, periodEnd].
   *
   * `cycleId` is passed by the CYCLE path (TENANT-6c-1) and is deliberately not a DTO field: a caller who could name
   * a cycle id independently of the period could file a fortnight's bill under a different fortnight's cycle, and
   * nothing downstream would ever notice. The cycle service reads both from the same row.
   */
  async generate(tenantId: string, actor: DairyActor, idemKey: string, dto: GenerateBillDto, cycleId: string | null = null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.bill.generate', () =>
      timed(this.metrics, 'dairy.bill.generate', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          if (!(await this.memberships.getById(tenantId, dto.membershipId, tx))) throw new MembershipNotFoundError(dto.membershipId);
          const agg = await this.collections.aggregateUnbilledForUpdate(tx, tenantId, dto.membershipId, dto.periodStart, dto.periodEnd);
          // [PC-56 TENANT-6b-1] A bill that comes back empty because every pour is under a quality hold is a
          // DIFFERENT fact from a member who did not pour, and W168's whole promise ("holds this pour's payment only")
          // depends on somebody being able to tell them apart.
          if (agg.count === 0 && agg.heldCount > 0) throw new AllPoursHeldError(agg.heldCount, agg.heldMinor.toString());
          if (agg.count === 0) throw new EmptyBillError();
          // [PC-56 TENANT-6c-4] EVERY LINE MUST NAME A TYPE THIS PLATFORM HAS AND A ROW IT PAYS.
          //
          // Before this wave a line was `{type: <any 40-char string>, amount_minor}` in a jsonb blob: `type` was
          // validated against nothing and referenced nothing, so a bill could be short by ₹500 for a reason the
          // platform could neither reconcile nor explain to the member. The line is now a row with a FK to the
          // vocabulary and a source it settles, and both are checked HERE — at the only moment somebody is still
          // holding the answer — rather than at payment, when the operator has gone home and 312 bills are queued.
          const lines: MilkBillDeduction[] = [];
          const billId = uuidv7();
          for (const d of dto.deductions) {
            const type = await this.deductionTypes.byCode(tx, d.type);
            if (!type) throw new DeductionSourceInvalidError('milk_deduction', d.type, `'${d.type}' is not a milk deduction type this platform has`);
            // A GAP-BACKEND type (`insurance`, `share`) is refused at CREATION, not at payment. 0157's refusal came
            // at the money movement, which meant a cooperative could build 312 bills nobody could ever pay and only
            // find out on payday. The reason comes from the vocabulary row, so the operator reads WHY.
            if (type.destination === 'none') throw new DeductionTypeUnsupportedError(billId, type.code, type.unsupportedReason ?? 'no destination');
            // A LINE WITH NO SOURCE IS THE OLD JSONB PAYLOAD, and it is refused here with a readable error rather
            // than by a NOT NULL violation three statements later. The route's zod schema already requires it; this
            // is for every caller that is not a route — the cycle path, a future assembler, a script.
            const sourceId = d.sourceId;
            if (!sourceId) throw new DeductionSourceInvalidError(type.sourceType ?? 'unknown', '', `a ${type.code} deduction must name the ${type.sourceType ?? 'row'} it pays`);
            await this.assertSourceRecoverable(tx, tenantId, dto.membershipId, type.sourceType!, sourceId, BigInt(d.amountMinor));
            lines.push(MilkBillDeduction.create({
              id: uuidv7(), tenantId, billId, membershipId: dto.membershipId, typeId: type.id, typeCode: type.code,
              amountMinor: BigInt(d.amountMinor), sourceType: type.sourceType!, sourceId, createdBy: actor.userId,
            }));
          }
          const deductions: BillDeduction[] = lines.map((l) => {
            const p = l.toProps();
            return { id: p.id, type: p.typeCode, amountMinor: p.amountMinor, sourceType: p.sourceType, sourceId: p.sourceId, status: p.status };
          });
          const bill = MilkBill.generate({ id: billId, tenantId, membershipId: dto.membershipId, cycleId, periodStart: dto.periodStart, periodEnd: dto.periodEnd,
            totalLitresMilli: agg.totalWeightMilliKg, grossMinor: agg.grossMinor, deductions });
          try { await this.bills.insert(tx, bill); } catch (e: any) { if (e?.code === '23505') throw new BillNotPayableError('a bill already exists for this period'); throw e; }
          for (const l of lines) await this.deductionLines.insert(tx, l);
          await this.collections.attachToBill(tx, tenantId, agg.ids, bill.id);
          await this.flush(tx, tenantId, bill.id, bill.pullEvents());
          return bill.toJSON();
        }, { userId: actor.userId })));
  }

  /**
   * Show ONE bill to its member and start their window.
   *
   * W169's own act is the CYCLE-level one (`DairyBillCycleService.previewCycle`); this route stays because a bill
   * generated by hand for an arbitrary period has no cycle to be previewed with, and a member holding such a bill is
   * owed the same window as everybody else. Both paths go through the same aggregate method, so the window they set
   * and the event they publish cannot diverge.
   */
  async preview(tenantId: string, actor: DairyActor, id: string, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      // [PC-56 TENANT-6c-4] The LINES are loaded here too, and the reason is the notification below: the moment a
      // member is shown their bill is the moment they can be asked about it, and asking requires knowing the figures.
      const bill = await this.bills.getForUpdate(tx, tenantId, id, await this.deductionLines.linesForBill(tx, tenantId, id));
      if (!bill) throw new BillNotFoundError(id);
      const membership = await this.memberships.getById(tenantId, bill.membershipIdRef, tx);
      if (!membership) throw new MembershipNotFoundError(bill.membershipIdRef);
      bill.preview(now, await this.windowEnd(tx, tenantId, now), membership.farmerUserId);
      await this.bills.update(tx, bill);
      await this.flush(tx, tenantId, bill.id, bill.pullEvents());

      // [PC-56 TENANT-6c-4] W169: *"Deductions above 25% of gross need the member's fresh consent."* A gate the
      // member is never TOLD about is a bill that silently never pays — the same shape as a window nothing wrote
      // (TENANT-6c-2), one layer up. So the ask goes out with the preview, in the member's own language through the
      // notification spine, and it is a SEPARATE event from `dairy.bill_previewed` because it needs an answer rather
      // than being news.
      const pct = await this.consents.consentThresholdPct(tx, tenantId);
      if (deductionConsentRequired(bill.grossMinor, bill.deductionsMinor, pct)) {
        await this.outbox.write(tx, {
          tenantId, aggregateType: 'milk_bill', aggregateId: bill.id, eventType: DairyEventType.BillDeductionConsentRequired,
          payload: { v: 1,
            userId: membership.farmerUserId, billId: bill.id, membershipId: bill.membershipId,
            period: `${bill.toProps().periodStart}..${bill.toProps().periodEnd}`,
            grossMinor: bill.grossMinor.toString(), deductionsMinor: bill.deductionsMinor.toString(),
            netMinor: bill.netMinor.toString(), thresholdPct: pct,
            // Which lines, by type — "₹2,400 was taken" is not an answer to "what for?".
            lines: bill.deductionLines.map((l) => ({ type: l.type, amountMinor: l.amountMinor.toString() })),
          },
        });
      }
      return bill.toJSON();
    }, { userId: actor.userId });
  }

  /**
   * Approve ONE bill. W169: *"Preview/approve needs dairy-desk + `settlement.close` + checker."* The CHECKER rule lives
   * on the CYCLE (a per-bill checker would mean 312 signatures, which is not what the canon's button is), so this route
   * carries the two keys and the cycle-level act carries the second human.
   */
  async approve(tenantId: string, actor: DairyActor, id: string) {
    if (!actor.canCloseSettlement) throw new DairyForbiddenError('requires settlement.close — approving a bill takes the second key, not just the dairy desk');
    return this.transition(tenantId, actor, id, (b) => b.approve());
  }

  /**
   * [PC-56 TENANT-6c-2] VOID a bill and RELEASE ITS POURS, so a correct one can be built.
   *
   * The only correction this platform can make to a milk bill's arithmetic. There is no adjustment line and no credit
   * note on `milk_bills`, so a bill an upheld dispute proved wrong is soft-deleted, `milk_bill_id` is cleared on every
   * collection it settled, and the cycle's next generation pass rebuilds it from whatever the pours now say — which is
   * what 6b-1's quality path can already correct.
   *
   * The detach FAILS CLOSED (`CollectionStampLostError`): a void that soft-deleted the bill but left its pours stamped
   * would strand a fortnight of a family's milk exactly as 6c-1's stranded-pour finding describes, except worse,
   * because the bill they could have pointed at is gone too.
   */
  async voidBill(tenantId: string, actor: DairyActor, id: string, reason: string, ip: string | null, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const bill = await this.bills.getForUpdate(tx, tenantId, id);
      if (!bill) throw new BillNotFoundError(id);
      return this.voidLoaded(tx, tenantId, actor, bill, reason, ip, now);
    }, { userId: actor.userId });
  }

  /**
   * The void itself, for a caller that ALREADY HOLDS THE BILL LOCKED in its own transaction.
   *
   * **THIS SPLIT EXISTS BECAUSE THE FIRST VERSION SELF-DEADLOCKED AND A LIVE TEST FOUND IT.** The dispute service
   * resolves an upheld query inside a transaction that has the bill under `FOR UPDATE`, and then called `voidBill`,
   * which opened a SECOND transaction on a SECOND connection and asked for the same row lock — so it waited on itself
   * until the test timed out. In production that is a request that hangs until the statement timeout while holding a
   * lock on a money row.
   *
   * Exposing the tx-taking form is the honest fix rather than the convenient one: the alternative (voiding after the
   * resolution commits) would make "the query was upheld" and "the bill was voided" two separate facts that can
   * disagree, and the alternative to THAT (a second copy of this body in the dispute service) is two mechanisms for one
   * act. One body, one transaction, one outcome.
   */
  async voidLoaded(tx: TxContext, tenantId: string, actor: DairyActor, bill: MilkBill, reason: string, ip: string | null, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    bill.void(now, actor.userId, reason);
    const released = await this.collections.detachFromBill(tx, tenantId, bill.id);
    await this.bills.void(tx, bill);
    await this.audit.write(tx, {
      tenantId, actorUserId: actor.userId, action: 'dairy.bill.voided', entityType: 'milk_bill', entityId: bill.id,
      oldValue: { status: 'live', netMinor: bill.netMinor.toString() },
      newValue: { status: 'voided', reason: reason.trim(), poursReleased: released }, ip,
    });
    await this.flush(tx, tenantId, bill.id, bill.pullEvents());
    return { ...bill.toJSON(), poursReleased: released };
  }

  /** Pay the farmer the NET amount (tenant 'main' → farmer userMain, zero-sum + idempotent). */
  async pay(tenantId: string, actor: DairyActor, id: string, idemKey: string, ip: string | null, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.bill.pay', () =>
      timed(this.metrics, 'dairy.bill.pay', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          // The LINES are loaded with the bill on this path, and only on this path: it is the one that moves them.
          const bill = await this.bills.getForUpdate(tx, tenantId, id, await this.deductionLines.linesForBill(tx, tenantId, id));
          if (!bill) throw new BillNotFoundError(id);
          if (bill.status !== 'approved') throw new BillNotPayableError(bill.status);
          // [PC-56 TENANT-6c-1 → 6c-4] A DEDUCTION WITH NO DESTINATION WAS NOT PAID — IT WAS KEPT. NOW IT HAS ONE.
          //
          // 0157 posted exactly one movement — the NET, cooperative → farmer — and therefore REFUSED any bill carrying
          // a deduction, because the withheld amount was never paid to the member and never posted anywhere else: a
          // `loan_emi` line took ₹300 out of a family's milk money and reduced no loan by anything. That refusal
          // (`DEDUCTION_HAS_NO_DESTINATION`) is gone from this path now, and what replaced it is not a relaxation:
          // the destinations exist (0160), the vocabulary is a table with a FK, every line names the row it pays, and
          // a type that still has nowhere to go is refused BY TYPE with the reason the seed wrote.
          //
          // THE MEMBER IS PAID THE GROSS, and each line is then posted from the member to the cooperative in this same
          // transaction — see `milk-bill-deduction.service.ts` for why that direction is the honest one. If any line
          // cannot be posted, this whole transaction rolls back and nothing moved at all.
          const membership = await this.memberships.getById(tenantId, bill.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(bill.membershipId);
          const hasDeductions = bill.deductionsMinor > 0n;
          let consent = { refusalOnFileBelowThreshold: false };
          if (hasDeductions) {
            // Law 10's kill-switch. OFF is where 0157 left this path, so the shipped behaviour is unchanged until a
            // tenant is switched on — and a bill's lines stay recorded meanwhile rather than being silently dropped.
            if (!(await this.flags.isEnabled('dairy_deduction_recovery', { tenantId, userId: actor.userId }))) {
              throw new DeductionRecoveryDisabledError(bill.id);
            }
            consent = await this.assertConsented(tx, tenantId, bill);
          }
          // The GROSS, not the net. One movement when there are no deductions (gross === net), so the common path is
          // unchanged, and the anchor of the itemisation when there are.
          const gross = bill.grossMinor;
          if (gross > 0n) {
            await this.wallet.post(tx, {
              tenantId, txnType: 'milk_payment', idempotencyKey: `milkbill:${bill.id}`, referenceType: 'milk_bill', referenceId: bill.id, initiatedBy: actor.userId,
              legs: [{ account: tenantMain(tenantId), amountMinor: -gross }, { account: userMain(membership.farmerUserId), amountMinor: gross }],
            });
          }
          const applied = hasDeductions
            ? await this.deductions.applyAll(tx, tenantId, { billId: bill.id, membershipId: bill.membershipId, memberUserId: membership.farmerUserId, initiatedBy: actor.userId, now })
            : [];
          const net = bill.netMinor;
          // [PC-56 TENANT-6c-2] The member's window is checked HERE, at the money movement, because that is what W169
          // promises: "member sees every pour + every deduction, 24h dispute window" and then "paid Fri". The refusal
          // lives on the aggregate (`markPaid`) so no route can forget it.
          bill.markPaid(now);
          await this.bills.update(tx, bill);
          // ITEMISED IN THE AUDIT TRAIL TOO, because "paid ₹8,914" is not an answer to "what happened to my ₹500".
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.bill.paid', entityType: 'milk_bill', entityId: bill.id,
            newValue: { grossMinor: gross.toString(), netMinor: net.toString(), deductionsMinor: bill.deductionsMinor.toString(), deductions: applied,
              // Present only when it is true, and it is a fact somebody must be able to find later: this member said
              // no, the deduction was below the consent threshold, and the cooperative recovered it anyway.
              ...(consent.refusalOnFileBelowThreshold ? { memberRefusalOnFile: true } : {}) }, ip });
          await this.flush(tx, tenantId, bill.id, bill.pullEvents());
          return bill.toJSON();
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, actor: DairyActor & { userId: string }, id: string) {
    const bill = await this.bills.getById(tenantId, id);
    if (!bill) throw new BillNotFoundError(id);
    if (!actor.canManage) {
      const membership = await this.memberships.getById(tenantId, bill.membershipId);
      if (!membership || membership.farmerUserId !== actor.userId) throw new BillNotFoundError(id); // 404, no IDOR
    }
    return bill.toJSON();
  }
  async list(tenantId: string, actor: DairyActor & { userId: string }, q: { box: 'mine' | 'all'; membershipId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    let membershipIds: string[] | undefined;
    if (q.box === 'mine') {
      const mine = await this.memberships.listFor(tenantId, { farmerUserId: actor.userId, limit: 100 });
      membershipIds = mine.map((m) => m.id);
      if (membershipIds.length === 0) return { items: [], nextCursor: null };
    } else if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const rows = await this.bills.listFor(tenantId, { membershipIds, membershipId: q.membershipId, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async transition(tenantId: string, actor: DairyActor, id: string, mutate: (b: MilkBill) => void) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const bill = await this.bills.getForUpdate(tx, tenantId, id);
      if (!bill) throw new BillNotFoundError(id);
      mutate(bill);
      await this.bills.update(tx, bill);
      await this.flush(tx, tenantId, bill.id, bill.pullEvents());
      return bill.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'milk_bill', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
