// modules/dairy/services/milk-collection.service.ts · record a milk collection at the MCC counter.
// The amount is PRICED by the active rate card (float-free bigint math). Weight/fat/snf arrive as decimal
// strings and are parsed to SCALED INTEGERS here (no float, Law: money correctness). One ACID tx (UoW),
// outbox in-tx (Law 4), idempotent (Law 3 + UNIQUE(membership,collected_on,shift)), authz THROWS (Law 6).
import { DairyNoticeVarsService } from './dairy-notice-vars.service';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkCollection } from '../domain/milk-collection.entity';
import { MilkShift, DomainEvent } from '../domain/dairy.events';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { RecordCollectionDto } from '../dto/create-milk-collection.dto';
import { MembershipNotFoundError, NoActiveRateCardError, DuplicateCollectionError, DairyForbiddenError, PourNotAtThisCentreError } from '../domain/dairy.errors';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';
import { pourPlace } from '../domain/dairy-diversion';
import { DairyActor } from './mcc-centre.service';
import { MilkQualityReview } from '../domain/milk-quality-review.entity';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { BONUS_SLABS_FLAG } from '../domain/milk-quality.flags';

/** Parse a validated decimal string into a scaled integer (e.g. "12.345",3 → 12345n) — NO float. */
function parseScaled(s: string, decimals: number): bigint {
  const [int, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(int + fracPadded);
}

@Injectable()
export class MilkCollectionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: MilkCollectionRepository,
    private readonly rateCards: MilkRateCardRepository,
    private readonly memberships: DairyMembershipRepository,
    private readonly reviews: MilkQualityReviewRepository,
    private readonly flags: FlagsService,
    // [PC-56 TENANT-6d-6] The route AS OF the pour's day, and the diversion that may permit another village.
    private readonly routes: DairyMembershipRouteRepository,
    private readonly diversions: DairyDiversionRepository,
    // [PC-56 TENANT-6d-7] The words the flag notice's own copy asks for. See domain/dairy-notice-vars.ts.
    private readonly noticeVars: DairyNoticeVarsService,
  ) {}

  async record(tenantId: string, actor: DairyActor, idemKey: string, dto: RecordCollectionDto) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.collection.record', () =>
      timed(this.metrics, 'dairy.collection.record', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const membership = await this.memberships.getById(tenantId, dto.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(dto.membershipId);
          // ------------------------------------------------------------------------------------------------------
          // [PC-56 TENANT-6d-6] WHERE THIS POUR HAPPENED — measured, not inferred.
          //
          // This line used to be `mccId: membership.toProps().mccId`, and TENANT-6d-3's own header described that as
          // *"stamped at the counter from the membership's route AT THAT MOMENT. A pour knows where it happened."* It
          // was true, and true only because no pour could happen anywhere else. TWO THINGS FALSIFIED IT:
          //
          //   1. **THE DIVERSION** (W170's playbook step 2). Divert Vanthali's evening shift to Bhesan and all 87
          //      pours were stamped VANTHALI — an empty evening at the centre that did the work, milk at the centre
          //      that never saw it, quality flags naming the wrong village, and TENANT-6d-3's careful repair (a bill's
          //      centre comes from its own pours) attributing the fortnight to the wrong place.
          //   2. **THE BACKDATED ENTRY**, which the diversion did not cause. `collectedOn` is a PARAMETER while the
          //      route read was the CURRENT one, so a pour entered on Monday for Saturday — after the member moved on
          //      Sunday — carried the NEW centre. 6d-3 repaired three READS to answer as-of and left this WRITE
          //      reading today.
          //
          // So the route is resolved AS OF THE POUR'S OWN DAY, the counter may NAME a centre, and `pourPlace` decides
          // whether the platform believes it. A named centre that is neither the member's route nor a live diversion's
          // destination is REFUSED: an operator must not be able to record a member's milk at another village
          // quietly, and a cooperative must be able to answer *"who allowed this?"* with a name and a reason.
          const route = await this.routes.asOf(tx, tenantId, membership.id, dto.collectedOn);
          const routeMccId = route?.mccId ?? null;
          // A pour that PREDATES the route history: a cooperative onboarding onto this platform enrols its members
          // today and then enters last fortnight's pours. The earliest recorded route answers — still from the HISTORY
          // rather than from `dairy_memberships.mcc_id`, which a move rewrites — and `pourPlace` names it
          // `before_record` so the inference is visible rather than silent. Found by the live suite, which refused half
          // of this platform's own fixtures the first time this rule shipped.
          const earliest = routeMccId === null ? await this.routes.earliest(tx, tenantId, membership.id) : null;
          const diversion = routeMccId === null || !dto.mccId || dto.mccId === routeMccId
            ? null
            : await this.diversions.liveFor(tx, tenantId, routeMccId, dto.collectedOn, dto.shift as MilkShift);
          const place = pourPlace({
            routeMccId, enteredMccId: dto.mccId ?? null,
            diversion: diversion ? { id: diversion.id, toMccId: diversion.toMccId } : null,
            earliestRouteMccId: earliest?.mccId ?? null,
          });
          if (place.mccId === null) {
            throw new PourNotAtThisCentreError(membership.id, dto.mccId ?? routeMccId ?? '', routeMccId);
          }
          const animalType = membership.defaultAnimalType ?? 'mixed';
          const card = await this.rateCards.resolveActive(tenantId, animalType, dto.collectedOn, tx);
          if (!card) throw new NoActiveRateCardError(animalType);
          const weightMilliKg = parseScaled(dto.weightKg, 3);
          const fatCentiPct = parseScaled(dto.fatPct, 2);
          const snfCentiPct = parseScaled(dto.snfPct, 2);
          // [PC-56 TENANT-6b-1] THE PREMIUM BAND. `bonus_rules` has been read by nothing since 0007, so W168's
          // "fat >= 6.5 -> +Rs 0.50/L" has never been paid to anybody. Applying it CHANGES WHAT A COOPERATIVE PAYS, so
          // it is a flag decision — and the answer is recorded WITH the pour (`bonusApplied`), because "what was this
          // member paid, and why" must survive the flag being switched and the card being superseded.
          const applyBonus = card.hasBonusSlabs && await this.flags.isEnabled(BONUS_SLABS_FLAG, { tenantId, userId: actor.userId });
          const amountMinor = card.priceMinor(weightMilliKg, fatCentiPct, snfCentiPct, applyBonus);
          const bonusMinor = applyBonus ? card.bonusMinor(weightMilliKg, fatCentiPct, snfCentiPct) : 0n;
          const collection = MilkCollection.record({
            id: uuidv7(), tenantId, mccId: place.mccId, diversionId: place.diversionId,
            membershipId: membership.id, shift: dto.shift as MilkShift,
            collectedOn: dto.collectedOn, weightMilliKg, fatCentiPct, snfCentiPct, density: dto.density ?? null,
            waterFlag: dto.waterFlag, adulterationFlags: dto.adulterationFlags,
            rateCardId: card.id, amountMinor, bonusMinor, bonusApplied: applyBonus, enteredBy: actor.userId,
          });
          try { await this.repo.insert(tx, collection); } catch (e: any) { if (e?.code === '23505') throw new DuplicateCollectionError(); throw e; }

          // [PC-56 TENANT-6b-1] A FLAGGED POUR IS HELD, AND THE HOLD HAS A RECORD — in this same transaction, because a
          // held pour with no review is money withheld for a reason nobody wrote down, and a review with no hold is
          // W168's promise broken in the other direction. Before this wave the flagged pour was simply paid.
          let review: MilkQualityReview | null = null;
          if (collection.isFlagged) {
            const prior = await this.reviews.priorReviews90d(tx, tenantId, membership.id);
            review = MilkQualityReview.open({
              id: uuidv7(), tenantId, collectionId: collection.id, collectedOn: dto.collectedOn,
              // THE SAME CENTRE THE POUR CARRIES. A review stamped with the membership's routing while its pour was
              // taken at another village would send a committee to the wrong counter to find the sample.
              membershipId: membership.id, mccId: place.mccId, shift: dto.shift as MilkShift,
              waterFlag: dto.waterFlag, reasons: dto.adulterationFlags,
              densityAtFlag: dto.density ?? null, fatPctAtFlag: dto.fatPct, snfPctAtFlag: dto.snfPct,
              amountWithheldMinor: amountMinor, currencyCode: 'INR',
              openedBy: actor.userId, priorReviews90d: prior,
            }, membership.farmerUserId,
            // [PC-56 TENANT-6d-7] `{{mcc}}` and `{{shift}}`, in the words the copy asks for and in three languages —
            // resolved for the centre the POUR was taken at (6d-6's `place.mccId`), not the membership's routing, so a
            // diverted evening's hold notice names the village the milk is actually in.
            await this.noticeVars.qualityOpened(tx, tenantId, { mccId: place.mccId, shift: dto.shift as MilkShift }));
            await this.reviews.insert(tx, review);
          }

          await this.flush(tx, tenantId, collection.id, collection.pullEvents());
          if (review) await this.flush(tx, tenantId, review.id, review.pullEvents(), 'milk_quality_review');
          return { ...this.serialize(collection), review: review?.toJSON() ?? null };
        }, { userId: actor.userId })));
  }

  async list(tenantId: string, actor: DairyActor & { userId: string }, q: { membershipId: string; from: string; to: string; cursor?: { c: string; id: string }; limit: number }) {
    const membership = await this.memberships.getById(tenantId, q.membershipId);
    if (!membership) throw new MembershipNotFoundError(q.membershipId);
    if (membership.farmerUserId !== actor.userId && !actor.canManage) throw new MembershipNotFoundError(q.membershipId); // 404, no IDOR
    const rows = await this.repo.listFor(tenantId, q);
    const items = rows.map((c) => this.serialize(c));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.collectedOn}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private serialize(c: MilkCollection) {
    const v = c.toProps();
    return { id: v.id, membershipId: v.membershipId, mccId: v.mccId, shift: v.shift, collectedOn: v.collectedOn,
      weightKg: (Number(v.weightMilliKg) / 1000).toFixed(3), fatPct: (Number(v.fatCentiPct) / 100).toFixed(2), snfPct: (Number(v.snfCentiPct) / 100).toFixed(2),
      amountMinor: v.amountMinor.toString(), rateCardId: v.rateCardId, waterFlag: v.waterFlag, milkBillId: v.milkBillId, createdAt: v.createdAt,
      // [PC-56 TENANT-6b-1] The counter slip's own arithmetic: W168 promises the farmer sees it line by line, and a
      // premium that arrives inside one total is a premium nobody can check against the card on the wall.
      density: v.density, adulterationFlags: v.adulterationFlags,
      bonusMinor: v.bonusMinor.toString(), bonusApplied: v.bonusApplied, holdState: v.holdState };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[], aggregateType = 'milk_collection') {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType, aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
