// modules/group-lots/services/group-lot.service.ts · FPO group-lot coordination use-cases · PC-56 TENANT-11c.
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create / pledge / list / confirm (Law 3), authz THROWS
// (Law 6), every act audited with actor · reason · before / after · ip (F-24). Quantities are integer milli-units, money bigint.
//
// WHO MAY DO WHAT (F-23 — per lot, not role-wide):
//   • open a lot: `group_lot.coordinate` for oneself; `group_lot.manage` (tenant_admin) may APPOINT another member, with the
//     appointee's recorded consent (group_lot_consents);
//   • ready / list / extend / nudge / cancel / prepare / pledge FOR a member: THIS lot's coordinator, or `group_lot.manage`;
//   • pledge as oneself, withdraw one's own pledge (until the lot lists), read progress + one's OWN pledge: any member;
//   • confirm / refuse a prepared settlement: `group_lot.settle_approve`, never the preparer or the coordinator (DB trigger).
//
// THE MONEY (founder decision: settle pays farmers from the real sale, maker ≠ checker) — domain/group-lot-money.ts:
//   sale     the lot's listing's order completes → payments settles the seller (unchanged) → `onOrderCompleted` (relay) enqueues
//            `group_lot.sale_settled` on the relay's transaction → `recordSale` (kv_app) reads that settlement, writes the sale
//            and HOLDS the proceeds coordinator Main → Hold (gl-hold:<lotId>) in ONE transaction;
//   prepare  shares from `settleShares` → group_lot_settlements + lines; no money;
//   confirm  ONE txn gl-settle:<lotId>: coordinator Hold −gross → each pledger's Main +share, coordinator Main +fee; pledges
//            stamped; lot settled; every member told their share in their language.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userHold, userMain } from '../../../core/wallet/account-codes';
import { InsufficientWalletBalanceError, WalletFrozenError } from '../../../core/wallet/wallet.errors';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { LangMap } from '../../../core/i18n/lang-map';
import { moneyText } from '../../../core/money/money-text';
import { ListingService } from '../../listings/services/listing.service';
import { GroupLot } from '../domain/group-lot.entity';
import { IllegalGroupLotTransitionError } from '../domain/group-lot.state';
import { DomainEvent, GroupLotEventType } from '../domain/group-lot.events';
import { settleShares, parseQtyMilli, formatQtyMilli } from '../domain/settle';
import { GROUP_LOT_REFERENCE_TYPE, GROUP_LOT_TXN, holdKey, holdLegs, lotProceeds, settleKey, settleLegs } from '../domain/group-lot-money';
import { Cursor, encodeCursor } from '../domain/cursor';
import { cleanReason, indiaDateTime, maskPhone, percentText, pledgerKyc, shortName } from '../domain/display';
import { GroupLotRepository, LotFacts, PledgeRow } from '../repositories/group-lot.repository';
import { GroupLotSettlementRepository, SettlementLineRow, SettlementRow } from '../repositories/group-lot-settlement.repository';
import { CancelDto, CreateGroupLotDto, ExtendDto, ListLotDto, NudgeDto, PledgeDto, ReadyDto, RefuseDto, SettleActDto } from '../dto/group-lot.dto';
import {
  CancelReasonError, CoordinatorConsentRequiredError, EmptyGroupLotError, GroupLotForbiddenError, GroupLotNotFoundError, HoldShortError, InvalidGroupLotError,
  ListingInAuctionError, NoPledgeError, NotAMemberError, NotLotCoordinatorError, NudgeTooSoonError, PledgeClosedError, SaleNotSettledError,
  SettlementCheckerError, SettlementStateError,
} from '../domain/group-lot.errors';
import { GroupLotActor, coordinatesLot } from '../policies/group-lot.policies';

export type { GroupLotActor } from '../policies/group-lot.policies';

const NUDGE_EVERY_MS = 24 * 3600_000;
const NUDGE_MAX_RECIPIENTS = 5000;
const NUDGE_CHUNK = 200;
const INR_MINOR_UNITS = 2;
/** A pooled-price figure is printed only from at least this many confirmed pooled sales of the product (brief B). */
export const POOLED_MIN_SALES = 3;
/** The audience rule the nudge uses — named on screen (A5: define "non-pledger" precisely from what the DB has). */
export const NUDGE_AUDIENCE_RULE = 'crop_season_or_listing';

const isFundsRefusal = (e: unknown) => e instanceof InsufficientWalletBalanceError || e instanceof WalletFrozenError;
const isMakerCheckerRefusal = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x?.code === '23514' && typeof x.message === 'string' && x.message.includes('maker-checker');
};

@Injectable()
export class GroupLotService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly repo: GroupLotRepository,
    private readonly settlements: GroupLotSettlementRepository,
    private readonly listings: ListingService,
    private readonly words: UiMessageRepository,
  ) {}

  private async flush(tx: TxContext, tenantId: string, aggId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'group_lot', aggregateId: aggId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
  private async notice(tx: TxContext, tenantId: string, lotId: string, eventType: string, recipients: string[], payload: Record<string, unknown>) {
    const unique = [...new Set(recipients)];
    for (let i = 0; i < unique.length; i += NUDGE_CHUNK) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'group_lot', aggregateId: lotId, eventType, payload: { v: 1, groupLotId: lotId, ...payload, recipientUserIds: unique.slice(i, i + NUDGE_CHUNK) } });
    }
  }
  private async lockedLot(tx: TxContext, tenantId: string, id: string): Promise<GroupLot> {
    const lot = await this.repo.getForUpdate(tx, tenantId, id);
    if (!lot) throw new GroupLotNotFoundError(id);
    return lot;
  }
  private assertCoordinates(actor: GroupLotActor, lot: GroupLot) {
    if (!coordinatesLot(actor, lot)) throw new NotLotCoordinatorError(lot.id);
  }
  private async productName(tx: TxContext, tenantId: string, productId: string): Promise<string> {
    return (await this.repo.product(tx, tenantId, productId))?.name ?? productId;
  }
  private audited(tx: TxContext, e: { tenantId: string; actorUserId: string | null; action: string; lotId: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; ip: string | null }) {
    return this.audit.write(tx, { tenantId: e.tenantId, actorUserId: e.actorUserId, action: e.action, entityType: 'group_lot', entityId: e.lotId,
      oldValue: e.oldValue ?? null, newValue: e.newValue ?? null, reason: e.reason ?? null, ip: e.ip });
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // CREATE (A4 — a coordinator opens their own lot; tenant_admin appoints one, with the appointee's recorded consent)
  // ---------------------------------------------------------------------------------------------------------------------------
  async create(tenantId: string, actor: GroupLotActor, idemKey: string, dto: CreateGroupLotDto, ip: string | null = null) {
    const coordinator = dto.coordinatorUserId ?? actor.userId;
    const appointed = coordinator !== actor.userId;
    if (appointed ? !actor.canManage : !(actor.canCoordinate || actor.canManage)) {
      throw new GroupLotForbiddenError(appointed ? 'appointing a coordinator requires group_lot.manage' : 'requires group_lot.coordinate');
    }
    if (appointed && !dto.consent) throw new CoordinatorConsentRequiredError();
    if (appointed && dto.consent && dto.consent.channel !== 'otp' && !dto.consent.mediaId) throw new CoordinatorConsentRequiredError('GROUP_LOT_CONSENT_EVIDENCE_REQUIRED');
    return this.idem.remember(idemKey, actor.userId, 'group_lot.create', () =>
      timed(this.metrics, 'group_lot.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const product = await this.repo.product(tx, tenantId, dto.productId);
          if (!product) throw new InvalidGroupLotError('unknown product', 'GROUP_LOT_PRODUCT_UNKNOWN');
          if (!(await this.repo.unitExists(tx, dto.unitCode))) throw new InvalidGroupLotError('unknown unit', 'GROUP_LOT_UNIT_UNKNOWN');
          if (!(await this.repo.isActiveMember(tx, tenantId, coordinator))) throw new NotAMemberError(coordinator);
          const lot = GroupLot.create({ id: uuidv7(), tenantId, coordinatorUserId: coordinator, productId: dto.productId, targetQuantity: dto.targetQuantity,
            unitCode: dto.unitCode, pledgeDeadline: new Date(dto.pledgeDeadline).toISOString(), coordinationFeeBps: dto.coordinationFeeBps, appointedBy: appointed ? actor.userId : null });
          const { lotNo } = await this.repo.insert(tx, lot);
          let consentId: string | null = null;
          if (appointed && dto.consent) {
            consentId = uuidv7();
            await this.repo.insertConsent(tx, { id: consentId, tenantId, groupLotId: lot.id, coordinatorUserId: coordinator, channel: dto.consent.channel,
              mediaId: dto.consent.mediaId ?? null, note: dto.consent.note ?? null, recordedBy: actor.userId });
          }
          const p = lot.toProps();
          await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.created', lotId: lot.id, ip,
            newValue: { lotNo, productId: p.productId, productName: product.name, targetQuantity: p.targetQuantity, unitCode: p.unitCode, pledgeDeadline: p.pledgeDeadline,
              coordinationFeeBps: p.coordinationFeeBps, coordinatorUserId: coordinator, appointed, consentId } });
          await this.flush(tx, tenantId, lot.id, lot.pullEvents());
          return { ...lot.serialize(), lotNo, productName: product.name, consentId };
        }, { userId: actor.userId })));
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // READS (A6 / F-19)
  // ---------------------------------------------------------------------------------------------------------------------------
  private row(lot: GroupLot, f: LotFacts | undefined, actor: GroupLotActor) {
    return {
      ...lot.serialize(),
      productName: f?.productName ?? null,
      coordinatorShortName: shortName(f?.coordinatorName),
      memberCount: f?.memberCount ?? 0,
      listing: lot.listingId ? { id: lot.listingId, status: f?.listingStatus ?? null } : null,
      auction: f?.auction ?? null,
      viewerIsCoordinator: coordinatesLot(actor, lot),
    };
  }

  async list(tenantId: string, actor: GroupLotActor, q: { box: 'mine' | 'all'; status?: string; sort: 'recent' | 'deadline'; counts?: boolean; cursor?: Cursor; limit: number }) {
    const coordinatorUserId = q.box === 'mine' ? actor.userId : undefined;
    const rows = await this.repo.listFor(tenantId, { coordinatorUserId, status: q.status, sort: q.sort, cursor: q.cursor, limit: q.limit });
    const facts = await this.repo.factsFor(tenantId, rows);
    const items = rows.map((g) => this.row(g, facts.get(g.id), actor));
    const last = rows[rows.length - 1]?.toProps();
    const nextCursor = rows.length === q.limit && last ? encodeCursor(q.sort === 'deadline' ? last.deadlineText : last.createdAtText, last.id) : null;
    const counts = q.counts ? await this.repo.countByStatus(tenantId, coordinatorUserId) : null;
    const total = counts ? (q.status ? counts[q.status] ?? 0 : Object.values(counts).reduce((a, b) => a + b, 0)) : null;
    return { items, nextCursor, counts, total };
  }

  async cancelReasons(tenantId: string) {
    return (await this.repo.cancelReasons(tenantId)).map((r) => ({ code: r.code, defaultName: r.defaultName, textRequired: r.textRequired }));
  }

  /**
   * A6 — the lot. EVERY member sees the lot's progress, its facts and their OWN pledge. THIS lot's coordinator and tenant_admin
   * (`group_lot.manage`) also see every pledge: short name, the 1b-masked phone, KYC from 9a's role projection, pledged at.
   * The raw phone and other members' ids never reach a member (proven by the 11c spec).
   */
  async getById(tenantId: string, actor: GroupLotActor, id: string) {
    const lot = await this.repo.getById(tenantId, id);
    if (!lot) throw new GroupLotNotFoundError(id);
    const facts = (await this.repo.factsFor(tenantId, [lot])).get(lot.id);
    const p = lot.toProps();
    const isCoord = coordinatesLot(actor, lot);
    const mine = await this.repo.pledgeOf(tenantId, id, actor.userId);
    const myPledge = mine ? { quantity: mine.quantity, status: mine.status, createdAt: mine.createdAt, settledShareMinor: mine.settledShareMinor } : null;

    let pledges: Array<Record<string, unknown>> | null = null;
    let summary: { activeCount: number; activeQuantity: string; allVerified: boolean | null; withdrawnCount: number } | null = null;
    if (isCoord) {
      const people = await this.repo.pledgesWithPeople(tenantId, id);
      pledges = people.map((x) => {
        const kyc = pledgerKyc(x.roles);
        return { id: x.id, memberShortName: shortName(x.fullName), memberPhoneMasked: x.phone ? maskPhone(x.phone) : null, quantity: x.quantity, status: x.status,
          kycStatus: kyc.kycStatus, kycRole: kyc.kycRole, createdAt: x.createdAt, withdrawnAt: x.withdrawnAt, settledShareMinor: x.settledShareMinor,
          recordedByCoordinator: !!x.recordedBy && x.recordedBy !== x.farmerUserId, isMine: x.farmerUserId === actor.userId };
      });
      const active = pledges.filter((x) => x.status === 'active');
      summary = {
        activeCount: active.length,
        activeQuantity: formatQtyMilli(active.reduce((a, x) => a + parseQtyMilli(String(x.quantity)), 0n)),
        // "all verified" is printed only from real KYC rows: every active pledger's producer-role status is `verified`.
        allVerified: active.length === 0 ? null : active.every((x) => x.kycStatus === 'verified'),
        withdrawnCount: pledges.filter((x) => x.status === 'withdrawn').length,
      };
    }

    const st = await this.settlements.latest(tenantId, id);
    const settlement = st ? await this.settlementView(tenantId, st, actor, isCoord) : null;
    const pooled = await this.pooledEstimate(tenantId, p.productId, p.unitCode);
    const now = Date.now();
    const nudgeNextAt = p.lastNudgedAt ? new Date(new Date(p.lastNudgedAt).getTime() + NUDGE_EVERY_MS) : null;
    const pledgingOpen = p.status === 'pledging' && new Date(p.pledgeDeadline).getTime() > now;
    const inAuction = facts?.listingStatus === 'reserved_auction';
    const live = settlement && settlement.status === 'prepared';
    return {
      ...this.row(lot, facts, actor),
      myPledge,
      pledges,
      pledgesRestricted: !isCoord,
      summary,
      settlement,
      pooled,
      nudge: { audienceRule: NUDGE_AUDIENCE_RULE, nextAt: nudgeNextAt && nudgeNextAt.getTime() > now ? nudgeNextAt.toISOString() : null, voice: { built: false } },
      viewerCan: {
        coordinate: isCoord,
        ready: isCoord && p.status === 'pledging',
        list: isCoord && p.status === 'ready',
        extend: isCoord && p.status === 'pledging' && !p.extendedOnce,
        nudge: isCoord && pledgingOpen && !(nudgeNextAt && nudgeNextAt.getTime() > now),
        cancel: isCoord && (p.status === 'pledging' || p.status === 'ready' || (p.status === 'listed' && !inAuction)),
        pledgeSelf: pledgingOpen,
        pledgeOnBehalf: isCoord && pledgingOpen,
        withdraw: !!mine && mine.status === 'active' && (p.status === 'pledging' || p.status === 'ready'),
        prepare: isCoord && p.status === 'sold' && !live,
        confirm: !!live && actor.canApprove && settlement!.preparedBy !== actor.userId && p.coordinatorUserId !== actor.userId,
        refuse: !!live && actor.canApprove,
        confirmBlocked: live && actor.canApprove ? (settlement!.preparedBy === actor.userId ? 'maker' : p.coordinatorUserId === actor.userId ? 'coordinator' : null) : null,
      },
    };
  }

  private async settlementView(tenantId: string, st: SettlementRow, actor: GroupLotActor, isCoord: boolean) {
    const lines = await this.settlements.lines(tenantId, st.id);
    const reader = isCoord || actor.canApprove;
    const people = reader ? new Map((await this.repo.pledgesWithPeople(tenantId, st.groupLotId)).map((x) => [x.id, x])) : null;
    const view = (l: SettlementLineRow) => ({
      pledgeId: l.pledgeId, quantity: l.quantity, shareMinor: l.shareMinor.toString(), isMine: l.farmerUserId === actor.userId,
      memberShortName: people ? shortName(people.get(l.pledgeId)?.fullName) : null,
    });
    return {
      id: st.id, status: st.status, grossMinor: st.grossMinor.toString(), feeBps: st.feeBps, feeMinor: st.feeMinor.toString(), netMinor: st.netMinor.toString(),
      quantity: st.quantity, unitCode: st.unitCode, preparedBy: st.preparedBy, preparedAt: st.preparedAt, preparedByMe: st.preparedBy === actor.userId,
      confirmedAt: st.confirmedAt, confirmReason: st.confirmReason, refusedAt: st.refusedAt, refuseReason: st.refuseReason, settlementTxnId: st.settlementTxnId,
      // a member reads their OWN line; the coordinator and the checker read every line
      lines: reader ? lines.map(view) : lines.filter((l) => l.farmerUserId === actor.userId).map(view),
      linesRestricted: !reader,
    };
  }

  /**
   * B — "Why pooling pays". A figure only from ≥ 3 CONFIRMED pooled sales of this product (same unit) in this tenant: the
   * realised seller proceeds per unit over the last three (Σ gross ÷ Σ quantity, integer floor). No solo-lot estimate is
   * computed anywhere on this platform, so the "solo" half is refused by name rather than guessed.
   */
  async pooledEstimate(tenantId: string, productId: string, unitCode: string) {
    const h = await this.settlements.pooledHistory(tenantId, productId, unitCode, POOLED_MIN_SALES);
    if (h.count < POOLED_MIN_SALES) return { available: false, salesCount: h.count, needed: POOLED_MIN_SALES, pooledPerUnitMinor: null, solo: { built: false } };
    const gross = h.recent.reduce((a, r) => a + r.grossMinor, 0n);
    const milli = h.recent.reduce((a, r) => a + parseQtyMilli(r.quantity), 0n);
    const perUnit = milli > 0n ? (gross * 1000n) / milli : 0n;
    return { available: true, salesCount: h.count, needed: POOLED_MIN_SALES, basedOn: h.recent.length, pooledPerUnitMinor: perUnit.toString(), solo: { built: false } };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // PLEDGES (A1 / A7)
  // ---------------------------------------------------------------------------------------------------------------------------
  /** A member pledges as self; THIS lot's coordinator (or tenant_admin) records a pledge FOR a member. Idempotent. */
  async pledge(tenantId: string, actor: GroupLotActor, idemKey: string, id: string, dto: PledgeDto, ip: string | null = null) {
    const farmer = dto.farmerUserId ?? actor.userId;
    const onBehalf = farmer !== actor.userId;
    return this.idem.remember(idemKey, actor.userId, 'group_lot.pledge', () =>
      timed(this.metrics, 'group_lot.pledge', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const lot = await this.lockedLot(tx, tenantId, id);
          if (onBehalf) this.assertCoordinates(actor, lot);
          if (!(await this.repo.isActiveMember(tx, tenantId, farmer))) throw new NotAMemberError(farmer);
          const before = { pledgedQuantity: lot.toProps().pledgedQuantity, status: lot.status };
          const prior = await this.repo.pledgeOfForUpdate(tx, tenantId, id, farmer);
          const { autoReady } = lot.applyPledge(parseQtyMilli(dto.quantity), new Date());
          const row = await this.repo.upsertPledge(tx, tenantId, { id: uuidv7(), groupLotId: id, farmerUserId: farmer, quantity: dto.quantity, recordedBy: actor.userId });
          await this.repo.update(tx, lot, actor.userId);
          await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.pledged', lotId: id, ip,
            oldValue: { ...before, memberQuantity: prior && prior.status === 'active' ? prior.quantity : null },
            newValue: { pledgedQuantity: lot.toProps().pledgedQuantity, status: lot.status, farmerUserId: farmer, added: dto.quantity, memberQuantity: row.quantity, onBehalf, autoReady } });
          await this.flush(tx, tenantId, id, lot.pullEvents());
          return { ...lot.serialize(), myPledge: { quantity: row.quantity, status: row.status }, onBehalf, autoReady };
        }, { userId: actor.userId })));
  }

  /** A7 — "a pledge is a promise, not a lock": a member withdraws their own pledge until the lot lists. */
  async withdraw(tenantId: string, actor: GroupLotActor, id: string, ip: string | null = null, reason: string | null = null) {
    return timed(this.metrics, 'group_lot.withdraw', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const lot = await this.lockedLot(tx, tenantId, id);
        const mine = await this.repo.pledgeOfForUpdate(tx, tenantId, id, actor.userId);
        if (!mine || mine.status !== 'active') throw new NoPledgeError();
        const before = lot.toProps().pledgedQuantity;
        lot.withdrawPledge(parseQtyMilli(mine.quantity));
        await this.repo.withdrawPledge(tx, tenantId, mine.id, actor.userId);
        await this.repo.update(tx, lot, actor.userId);
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.pledge_withdrawn', lotId: id, ip, reason: cleanReason(reason),
          oldValue: { pledgedQuantity: before, memberQuantity: mine.quantity, pledgeStatus: 'active' }, newValue: { pledgedQuantity: lot.toProps().pledgedQuantity, pledgeStatus: 'withdrawn' } });
        await this.flush(tx, tenantId, id, lot.pullEvents());
        return { ...lot.serialize(), myPledge: { quantity: mine.quantity, status: 'withdrawn' } };
      }, { userId: actor.userId }));
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // THE COORDINATOR'S ACTS (A2 / A5) — THIS lot's coordinator, or tenant_admin
  // ---------------------------------------------------------------------------------------------------------------------------
  async markReady(tenantId: string, actor: GroupLotActor, id: string, dto: ReadyDto, ip: string | null = null) {
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.lockedLot(tx, tenantId, id);
      this.assertCoordinates(actor, lot);
      const before = { status: lot.status, pledgedQuantity: lot.toProps().pledgedQuantity };
      lot.markReady(new Date(), dto.reason ?? null);
      await this.repo.update(tx, lot, actor.userId);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.ready', lotId: id, ip, reason: dto.reason ?? null,
        oldValue: before, newValue: { status: lot.status, pledgedQuantity: lot.toProps().pledgedQuantity, targetQuantity: lot.toProps().targetQuantity } });
      await this.flush(tx, tenantId, id, lot.pullEvents());
      return lot.serialize();
    }, { userId: actor.userId });
  }

  /** A2 — ready → listed: ONE listing through the listings module's public service, the coordinator's, for the pledged quantity. */
  async listLot(tenantId: string, actor: GroupLotActor, idemKey: string, id: string, dto: ListLotDto, ip: string | null = null) {
    return this.idem.remember(idemKey, actor.userId, 'group_lot.list', () =>
      timed(this.metrics, 'group_lot.list', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const lot = await this.lockedLot(tx, tenantId, id);
          this.assertCoordinates(actor, lot);
          if (lot.status !== 'ready') throw new IllegalGroupLotTransitionError(lot.status, 'listed');
          const p = lot.toProps();
          const product = await this.repo.product(tx, tenantId, p.productId);
          if (!product) throw new InvalidGroupLotError('unknown product', 'GROUP_LOT_PRODUCT_UNKNOWN');
          const listing = await this.listings.createForGroupLotInTx(tx, tenantId, {
            groupLotId: id, sellerUserId: p.coordinatorUserId, productId: p.productId, categoryId: product.categoryId,
            title: `${product.name} — ${p.lotNo}`, description: null, quantity: p.pledgedQuantity, unitCode: p.unitCode,
            pricePerUnitMinor: BigInt(dto.pricePerUnitMinor), currencyCode: 'INR', createdBy: actor.userId,
          });
          lot.markListed(listing.id, new Date());
          await this.repo.update(tx, lot, actor.userId);
          await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.listed', lotId: id, ip, reason: dto.reason ?? null,
            oldValue: { status: 'ready' }, newValue: { status: 'listed', listingId: listing.id, quantity: p.pledgedQuantity, unitCode: p.unitCode, pricePerUnitMinor: dto.pricePerUnitMinor, sellerUserId: p.coordinatorUserId } });
          await this.flush(tx, tenantId, id, lot.pullEvents());
          return { ...lot.serialize(), listing: { id: listing.id, status: 'published' } };
        }, { userId: actor.userId })));
  }

  /** A5 — extend once, at most `group_lot.max_extension_hours` (≤ 48 h); every active pledger is told the new deadline. */
  async extend(tenantId: string, actor: GroupLotActor, id: string, dto: ExtendDto, ip: string | null = null) {
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.lockedLot(tx, tenantId, id);
      this.assertCoordinates(actor, lot);
      const before = lot.toProps().pledgeDeadline;
      // PC-56 TENANT-13b (A4): the ceiling is the tenant's `group_lot.max_extension_hours` (0192; registry default and platform ceiling 48).
      const maxHours = await this.repo.maxExtensionHoursTx(tx, tenantId, 'group_lot.max_extension_hours');
      lot.extend(new Date(dto.pledgeDeadline).toISOString(), new Date(), maxHours * 3600_000);
      await this.repo.update(tx, lot, actor.userId);
      const p = lot.toProps();
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.deadline_extended', lotId: id, ip, reason: dto.reason,
        oldValue: { pledgeDeadline: before, extendedOnce: false }, newValue: { pledgeDeadline: p.pledgeDeadline, extendedOnce: true } });
      const members = await this.repo.activeFarmerIds(tx, tenantId, id);
      await this.notice(tx, tenantId, id, GroupLotEventType.DeadlineExtended, members, {
        lotNo: p.lotNo, product: await this.productName(tx, tenantId, p.productId), deadline: indiaDateTime(p.pledgeDeadline), pledgeDeadline: p.pledgeDeadline });
      return { ...lot.serialize(), notified: new Set(members).size };
    }, { userId: actor.userId });
  }

  /**
   * A5 — nudge the members who grow this crop and have not pledged (repo.nudgeAudience: a crop season of this product on a
   * parcel they own, or a past listing of it in this tenant), at most once per 24 h per lot, through the existing channels.
   * Nobody on record → nothing is sent and the 24 h clock does not start; the act is still recorded.
   */
  async nudge(tenantId: string, actor: GroupLotActor, id: string, dto: NudgeDto, ip: string | null = null) {
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.lockedLot(tx, tenantId, id);
      this.assertCoordinates(actor, lot);
      const p = lot.toProps();
      const now = new Date();
      if (p.status !== 'pledging' || new Date(p.pledgeDeadline).getTime() <= now.getTime()) throw new PledgeClosedError();
      if (p.lastNudgedAt && now.getTime() - new Date(p.lastNudgedAt).getTime() < NUDGE_EVERY_MS) {
        throw new NudgeTooSoonError(new Date(new Date(p.lastNudgedAt).getTime() + NUDGE_EVERY_MS).toISOString());
      }
      const audience = await this.repo.nudgeAudience(tx, tenantId, { id, productId: p.productId, coordinatorUserId: p.coordinatorUserId }, NUDGE_MAX_RECIPIENTS);
      if (audience.userIds.length > 0) {
        lot.markNudged(now);
        await this.repo.update(tx, lot, actor.userId);
        await this.notice(tx, tenantId, id, GroupLotEventType.Nudge, audience.userIds, {
          lotNo: p.lotNo, product: await this.productName(tx, tenantId, p.productId), progress: percentText(lot.pledgeProgressBps()), deadline: indiaDateTime(p.pledgeDeadline) });
      }
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.nudged', lotId: id, ip, reason: dto.reason ?? null,
        oldValue: { lastNudgedAt: p.lastNudgedAt ? new Date(p.lastNudgedAt).toISOString() : null },
        newValue: { recipients: audience.userIds.length, truncated: audience.truncated, audienceRule: NUDGE_AUDIENCE_RULE, lastNudgedAt: audience.userIds.length > 0 ? now.toISOString() : null } });
      return { recipients: audience.userIds.length, truncated: audience.truncated, audienceRule: NUDGE_AUDIENCE_RULE, nextAt: audience.userIds.length > 0 ? new Date(now.getTime() + NUDGE_EVERY_MS).toISOString() : null, voice: { built: false } };
    }, { userId: actor.userId });
  }

  /** A5 — cancel with a reason from the lookup (`other` needs the words): pledges released, the listing withdrawn, members told. */
  async cancel(tenantId: string, actor: GroupLotActor, id: string, dto: CancelDto, ip: string | null = null) {
    const out = await this.uow.run(tenantId, async (tx) => {
      const lot = await this.lockedLot(tx, tenantId, id);
      this.assertCoordinates(actor, lot);
      const reason = await this.repo.cancelReason(tx, dto.reasonCode);
      if (!reason) throw new CancelReasonError('GROUP_LOT_CANCEL_REASON_REQUIRED');
      const text = dto.reasonText ? cleanReason(dto.reasonText) : null;
      if (reason.textRequired && !text) throw new CancelReasonError('GROUP_LOT_CANCEL_TEXT_REQUIRED');
      const before = { status: lot.status, pledgedQuantity: lot.toProps().pledgedQuantity };
      const listingId = lot.listingId;
      if (lot.status === 'listed' && listingId) {
        const r = await this.listings.withdrawForGroupLotInTx(tx, tenantId, listingId);
        if (r === 'in_auction') throw new ListingInAuctionError();
      }
      lot.cancel({ reasonId: reason.id, reasonCode: reason.code, reasonText: text, by: actor.userId, now: new Date() });
      await this.repo.update(tx, lot, actor.userId);
      const released = await this.repo.releaseAll(tx, tenantId, id, actor.userId);
      const p = lot.toProps();
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.cancelled', lotId: id, ip, reason: text ?? reason.defaultName,
        oldValue: before, newValue: { status: 'cancelled', reasonCode: reason.code, reasonText: text, pledgesReleased: released.length, listingWithdrawn: !!listingId } });
      await this.notice(tx, tenantId, id, GroupLotEventType.Cancelled, released, {
        lotNo: p.lotNo, product: await this.productName(tx, tenantId, p.productId), reasonCode: reason.code, reason: await this.reasonWords(tx, reason.code, text) });
      return { ...lot.serialize(), notified: new Set(released).size, listingId };
    }, { userId: actor.userId });
    if (out.listingId) await this.listings.invalidate(tenantId, out.listingId);
    return out;
  }
  /** The reason as each member reads it: the platform's words in their language (seed core/0022), or the coordinator's own. */
  private async reasonWords(tx: TxContext, code: string, text: string | null): Promise<LangMap | string> {
    if (code === 'other' && text) return text;
    return this.words.map(`group_lot.cancel_reason.${code}`, tx);
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // THE SALE (A2) — two hops through the outbox, the money in kv_app's unit of work
  // ---------------------------------------------------------------------------------------------------------------------------
  /**
   * HOP 1 — called by the `orders.order_completed` consumer INSIDE the relay's transaction. Reads the order's lines in kv_app's
   * unit of work (never as kv_relay) and, for each group lot whose listing the order bought, ENQUEUES `group_lot.sale_settled`
   * on the RELAY's transaction — so the event exists only if the seller's settlement (payments' handler, same relay
   * transaction) commits. Touches no wallet account here: the relay transaction holds the seller's Main row lock, and a
   * second connection posting on it would wait on itself.
   */
  async onOrderCompleted(tenantId: string, orderId: string, relayTx: TxContext): Promise<number> {
    const lines = await this.uow.run(tenantId, (tx) => this.settlements.orderLines(tx, tenantId, orderId), { userId: 'system' });
    const lots = [...new Set(lines.map((l) => l.groupLotId).filter((x): x is string => !!x))];
    for (const lotId of lots) {
      await this.outbox.write(relayTx, { tenantId, aggregateType: 'group_lot', aggregateId: lotId, eventType: GroupLotEventType.SaleSettled, payload: { v: 1, groupLotId: lotId, orderId } });
    }
    return lots.length;
  }

  /**
   * HOP 2 — `group_lot.sale_settled` delivered: in ONE kv_app transaction, read what the order's settlement paid the
   * coordinator as seller (settlement_lines net + the coupon top-up; the lot's share of it when the order also bought other
   * listings), write the sale on the lot and move that amount coordinator Main → Hold (gl-hold:<lotId>). Idempotent: a
   * redelivery finds the sale recorded and moves nothing. A missing settlement line throws (the relay retries); a shortfall in
   * Main refuses by name and nothing moves.
   */
  async recordSale(tenantId: string, lotId: string, orderId: string): Promise<'recorded' | 'already' | 'unrecorded'> {
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.repo.getForUpdate(tx, tenantId, lotId);
      if (!lot) return 'unrecorded';
      const p = lot.toProps();
      if (p.saleOrderId === orderId) return 'already';
      const unrecorded = async (why: string, extra: Record<string, unknown> = {}) => {
        await this.audited(tx, { tenantId, actorUserId: null, action: 'group_lot.sale_unrecorded', lotId, ip: null, reason: why, newValue: { orderId, status: p.status, ...extra } });
        return 'unrecorded' as const;
      };
      if (p.status !== 'listed') return unrecorded('the lot is not listed (a second order, or a lot cancelled before completion)');
      const sl = await this.settlements.settlementLine(tx, tenantId, orderId);
      if (!sl) throw new SaleNotSettledError(orderId);
      if (sl.sellerUserId !== p.coordinatorUserId) return unrecorded('the order was settled to someone other than the lot coordinator', { sellerUserId: sl.sellerUserId });
      const lines = await this.settlements.orderLines(tx, tenantId, orderId);
      const lotLines = lines.filter((l) => l.groupLotId === lotId).reduce((a, l) => a + l.lineTotalMinor, 0n);
      const orderLines = lines.reduce((a, l) => a + l.lineTotalMinor, 0n);
      const topUp = await this.settlements.couponTopUp(tx, tenantId, orderId);
      const settled = sl.netMinor + topUp;
      const gross = lotProceeds(settled, lotLines, orderLines);
      if (gross <= 0n) return unrecorded('the order settled nothing to the seller');
      let txnId: string;
      try {
        txnId = (await this.wallet.post(tx, { tenantId, txnType: GROUP_LOT_TXN.Hold, idempotencyKey: holdKey(lotId), referenceType: GROUP_LOT_REFERENCE_TYPE, referenceId: lotId,
          initiatedBy: 'system', description: 'Group-lot sale proceeds held until the pledgers are paid', legs: holdLegs(p.coordinatorUserId, gross) })).txnId;
      } catch (e) {
        if (isFundsRefusal(e)) throw new HoldShortError(gross, await this.wallet.balanceMinor(tx, userMain(p.coordinatorUserId)).catch(() => 0n));
        throw e;
      }
      lot.markSold({ orderId, grossMinor: gross, holdTxnId: txnId, now: new Date() });
      await this.repo.update(tx, lot, null);
      await this.audited(tx, { tenantId, actorUserId: null, action: 'group_lot.sold', lotId, ip: null, reason: 'the sale order completed and its seller settlement was recorded',
        oldValue: { status: 'listed' }, newValue: { status: 'sold', orderId, grossProceedsMinor: gross.toString(), sellerNetMinor: sl.netMinor.toString(), couponTopUpMinor: topUp.toString(),
          lotLinesMinor: lotLines.toString(), orderLinesMinor: orderLines.toString(), holdTxnId: txnId } });
      await this.flush(tx, tenantId, lotId, lot.pullEvents());
      return 'recorded';
    }, { userId: 'system' });
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // THE SETTLEMENT (A3) — prepare (no money) · confirm (the second person; one txn) · refuse
  // ---------------------------------------------------------------------------------------------------------------------------
  async prepare(tenantId: string, actor: GroupLotActor, id: string, ip: string | null = null) {
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.lockedLot(tx, tenantId, id);
      this.assertCoordinates(actor, lot);
      const p = lot.toProps();
      if (p.status !== 'sold' || p.grossProceedsMinor == null || !p.saleOrderId) throw new SettlementStateError('GROUP_LOT_NOT_SOLD', 'only a sold lot can be settled');
      const live = await this.settlements.liveForUpdate(tx, tenantId, id);
      if (live) throw new SettlementStateError('GROUP_LOT_ALREADY_PREPARED', 'a settlement is already prepared for this lot');
      const pledges = await this.repo.activePledgesForUpdate(tx, tenantId, id);
      if (pledges.length === 0) throw new EmptyGroupLotError();
      const result = settleShares({ grossMinor: p.grossProceedsMinor, coordinationFeeBps: p.coordinationFeeBps,
        pledges: pledges.map((x) => ({ id: x.id, qtyMilli: parseQtyMilli(x.quantity) })) });
      const sid = uuidv7();
      const qty = formatQtyMilli(pledges.reduce((a, x) => a + parseQtyMilli(x.quantity), 0n));
      await this.settlements.insert(tx, { id: sid, tenantId, groupLotId: id, coordinatorUserId: p.coordinatorUserId, saleOrderId: p.saleOrderId, productId: p.productId,
        unitCode: p.unitCode, quantity: qty, grossMinor: result.grossMinor, feeBps: p.coordinationFeeBps, feeMinor: result.coordinationFeeMinor, netMinor: result.netMinor, preparedBy: actor.userId });
      const byId = new Map(pledges.map((x) => [x.id, x] as [string, PledgeRow]));
      for (const s of result.shares) {
        const pl = byId.get(s.id)!;
        await this.settlements.insertLine(tx, { id: uuidv7(), tenantId, settlementId: sid, pledgeId: s.id, farmerUserId: pl.farmerUserId, quantity: pl.quantity, shareMinor: s.shareMinor });
      }
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.settlement_prepared', lotId: id, ip,
        oldValue: { settlement: null }, newValue: { settlementId: sid, grossMinor: result.grossMinor.toString(), feeBps: p.coordinationFeeBps, feeMinor: result.coordinationFeeMinor.toString(),
          netMinor: result.netMinor.toString(), lines: result.shares.length, movedMinor: '0' } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'group_lot', aggregateId: id, eventType: GroupLotEventType.SettlementPrepared, payload: { v: 1, groupLotId: id, settlementId: sid } });
      const st = await this.settlements.latest(tenantId, id, tx);
      return { lot: lot.serialize(), settlement: await this.settlementViewTx(tx, tenantId, st!) };
    }, { userId: actor.userId });
  }
  private async settlementViewTx(tx: TxContext, tenantId: string, st: SettlementRow) {
    const lines = await this.settlements.lines(tenantId, st.id, tx);
    return { id: st.id, status: st.status, grossMinor: st.grossMinor.toString(), feeMinor: st.feeMinor.toString(), netMinor: st.netMinor.toString(),
      lines: lines.map((l) => ({ pledgeId: l.pledgeId, quantity: l.quantity, shareMinor: l.shareMinor.toString() })) };
  }

  /**
   * CONFIRM — the second person. ONE WalletPort txn gl-settle:<lotId> from the held proceeds. The DB trigger refuses a confirm
   * by the preparer or the coordinator (maker ≠ checker); it fires on the settlement UPDATE inside this transaction, so a
   * refused confirm rolls back the post with it and nothing moves. A second confirm finds the settlement confirmed and moves 0.
   */
  async confirm(tenantId: string, actor: GroupLotActor, idemKey: string, id: string, dto: SettleActDto, ip: string | null = null) {
    if (!actor.canApprove) throw new GroupLotForbiddenError('requires group_lot.settle_approve');
    return this.idem.remember(idemKey, actor.userId, 'group_lot.settle_confirm', () =>
      timed(this.metrics, 'group_lot.settle_confirm', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const lot = await this.lockedLot(tx, tenantId, id);
          const st = await this.settlements.liveForUpdate(tx, tenantId, id);
          if (!st) throw new SettlementStateError('GROUP_LOT_NOTHING_PREPARED', 'there is no prepared settlement to confirm');
          if (st.status === 'confirmed') return { lot: lot.serialize(), settlementId: st.id, movedMinor: '0', alreadyConfirmed: true, settlementTxnId: st.settlementTxnId };
          const p = lot.toProps();
          if (p.status !== 'sold' || !p.holdTxnId || p.grossProceedsMinor == null || p.grossProceedsMinor !== st.grossMinor) {
            throw new SettlementStateError('GROUP_LOT_NOT_SOLD', 'the lot is not sold, or its held proceeds differ from the prepared gross');
          }
          const held = await this.wallet.balanceMinor(tx, userHold(p.coordinatorUserId));
          if (held < st.grossMinor) throw new HoldShortError(st.grossMinor, held);
          const lines = await this.settlements.lines(tenantId, st.id, tx);
          const legs = settleLegs(p.coordinatorUserId, st.grossMinor, st.feeMinor, lines.map((l) => ({ farmerUserId: l.farmerUserId, shareMinor: l.shareMinor })));
          let txnId: string;
          try {
            txnId = (await this.wallet.post(tx, { tenantId, txnType: GROUP_LOT_TXN.Settle, idempotencyKey: settleKey(id), referenceType: GROUP_LOT_REFERENCE_TYPE, referenceId: id,
              initiatedBy: actor.userId, description: 'Group-lot settlement: each pledger paid by share, the coordinator fee paid', legs })).txnId;
          } catch (e) {
            if (isFundsRefusal(e)) throw new HoldShortError(st.grossMinor, held);
            throw e;
          }
          try {
            await this.settlements.markConfirmed(tx, tenantId, st.id, actor.userId, dto.reason ?? null, txnId);
          } catch (e) {
            if (isMakerCheckerRefusal(e)) throw new SettlementCheckerError();
            throw e;
          }
          for (const l of lines) await this.repo.stampSettledShare(tx, tenantId, l.pledgeId, l.shareMinor, txnId);
          lot.markSettled(txnId, new Date());
          await this.repo.update(tx, lot, actor.userId);
          await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.settled', lotId: id, ip, reason: dto.reason ?? null,
            oldValue: { status: 'sold', settlementStatus: 'prepared', heldMinor: held.toString() },
            newValue: { status: 'settled', settlementId: st.id, settlementTxnId: txnId, grossMinor: st.grossMinor.toString(), feeMinor: st.feeMinor.toString(), netMinor: st.netMinor.toString(),
              paidMembers: lines.length, preparedBy: st.preparedBy } });
          const product = await this.productName(tx, tenantId, p.productId);
          for (const l of lines) {
            await this.outbox.write(tx, { tenantId, aggregateType: 'group_lot', aggregateId: id, eventType: GroupLotEventType.Settled,
              payload: { v: 1, groupLotId: id, lotNo: p.lotNo, product, share: moneyText(l.shareMinor, 'INR', INR_MINOR_UNITS), shareMinor: l.shareMinor.toString(), recipientUserIds: [l.farmerUserId] } });
          }
          return { lot: lot.serialize(), settlementId: st.id, movedMinor: st.grossMinor.toString(), alreadyConfirmed: false, settlementTxnId: txnId };
        }, { userId: actor.userId })));
  }

  async refuse(tenantId: string, actor: GroupLotActor, id: string, dto: RefuseDto, ip: string | null = null) {
    if (!actor.canApprove) throw new GroupLotForbiddenError('requires group_lot.settle_approve');
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.lockedLot(tx, tenantId, id);
      const st = await this.settlements.liveForUpdate(tx, tenantId, id);
      if (!st || st.status !== 'prepared') throw new SettlementStateError('GROUP_LOT_NOTHING_PREPARED', 'there is no prepared settlement to refuse');
      await this.settlements.markRefused(tx, tenantId, st.id, actor.userId, dto.reason);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'group_lot.settlement_refused', lotId: id, ip, reason: dto.reason,
        oldValue: { settlementId: st.id, settlementStatus: 'prepared' }, newValue: { settlementStatus: 'refused', lotStatus: lot.status, movedMinor: '0' } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'group_lot', aggregateId: id, eventType: GroupLotEventType.SettlementRefused, payload: { v: 1, groupLotId: id, settlementId: st.id } });
      return { lot: lot.serialize(), settlementId: st.id, status: 'refused' };
    }, { userId: actor.userId });
  }
}
