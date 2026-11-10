// modules/equipment/services/equipment-booking.service.ts · THE RENTAL MONEY PATH (escrow).
// request (renter, snapshots the asset's active rate) → quote (owner sets the advance/deposit) → confirm
// (renter; the advance is ESCROWED: renter userMain → platform Escrow) → start (OTP-gated) → complete
// (measured usage → final total) → SETTLE (owner): release the escrow to the owner, collect any shortfall
// from the renter, refund any unused hold — all zero-sum, idempotent wallet posts (Law 2). Every write:
// one ACID tx (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money mutations
// (Law 3), authz THROWS (Law 6). No version column → bookings lock FOR UPDATE. Start OTP is HMAC-hashed.
//
// [PC-56 HOTFIX-13] NOBODY SPENDS HER MONEY BUT HER (founder Q1-A, 2026-11-09; migration 0236; survey_ops4 F-1/F-2, B1/B2/B4).
//   • CONFIRM escrows the RENTER's deposit, so only the renter confirms (`EQ_CONFIRM_NOT_RENTER`, 403). The administrator escape
//     (`&& !actor.isAdmin`) is gone.
//   • QUOTE / START / COMPLETE / SETTLE are the machine owner's acts only (`EQ_NOT_MACHINE_OWNER`, 403). The administrator escape is
//     gone from all four.
//   • CONFIRM-USAGE is the renter's own act on a completed hire: she confirms the hours the owner recorded (`usage_confirmed_by/at`,
//     one audit row with the hours and the bill). Anyone else — the owner, an administrator, a stranger — `USAGE_CONFIRM_NOT_RENTER`.
//   • SETTLE that would take money BEYOND THE DEPOSIT from her wallet (total > advance: the `order_payment` shortfall leg) is
//     refused `SETTLE_HOURS_NOT_CONFIRMED` (409) until she has confirmed. A bill within the deposit needs no confirmation: the
//     deposit alone pays the owner and the rest of it goes back to her.
//   • A hire whose renter never confirms stays `completed` and unsettled, its deposit held in escrow. Nothing times it out.
//   • Every refusal above sits after the permission and key checks and BEFORE `idem.remember`, the unit of work and any write
//     (a pre-read of the row; the same check again on the locked row inside the transaction). Ordering spies pin it.
//   • THE START CODE (B4/E16) is returned in the renter's own confirm response, and nowhere else: not in a list, a read, an
//     owner's response, a log or an event payload (`BookingConfirmed` carries the deposit only). It no longer depends on
//     `config.auth.exposeOtp`, which stays the identity module's test switch.
//   • CANCEL keeps its administrator escape deliberately: on a confirmed hire it REFUNDS her deposit (escrow → her wallet) and
//     moves nothing else, so it never spends her money.
//
// [PC-56 OPS-4a] THE HIRE — the first commit (survey_ops4 B6/B18, E10/E12/E14/E15; brief_ops4a §E):
//   • E14 — a hire's rate day is the ORGANISATION's own calendar day of `scheduledAt` (`tenants.country_code → countries.timezone`, the
//     6c-1 rule), resolved in SQL (`EquipmentRateRepository.tenantDay`) — no longer the UTC slice `scheduledAt.slice(0, 10)`.
//   • E15 — quantities are parsed and printed as scaled strings (domain/scaled.ts); no `Number()` on a quantity.
//   • E10 — QUOTE writes an audit row (the deposit before and after); CANCEL takes an Idempotency-Key and a reason validated by a strict
//     DTO and writes an audit row (status before / after, the refund, the reason). The party refusal of cancel sits BEFORE
//     `idem.remember` and any write (E12; a pre-read of the row, then the same check on the locked row).
// [PC-56 OPS-4b] CANCEL by anyone but the renter needs a non-blank reason (`CANCEL_REASON_REQUIRED`, 400), before `idem.remember`.
import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { EquipmentBooking } from '../domain/equipment-booking.entity';
import { RateBasis, DomainEvent, EquipmentEventType } from '../domain/equipment.events';
import { EquipmentBookingRepository } from '../repositories/equipment-booking.repository';
import { EquipmentAssetRepository } from '../repositories/equipment-asset.repository';
import { EquipmentRateRepository } from '../repositories/equipment-rate.repository';
import { RequestBookingDto, QuoteBookingDto, StartBookingDto, CompleteBookingDto, CancelBookingDto } from '../dto/create-equipment-booking.dto';
import { parseScaled } from '../domain/scaled';
import { BookingNotFoundError, AssetNotFoundError, AssetNotBookableError, NoActiveRateError, EquipmentForbiddenError, InvalidBookingError,
  CancelReasonRequiredError, EqConfirmNotRenterError, EqNotMachineOwnerError, SettleHoursNotConfirmedError, UsageConfirmNotRenterError, UsageAlreadyConfirmedError } from '../domain/equipment.errors';
import { EquipmentActor } from './equipment-asset.service';

const bookingNo = (id: string) => `EQ-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 8).toUpperCase()}`;

@Injectable()
export class EquipmentBookingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly config: AppConfig,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly bookings: EquipmentBookingRepository,
    private readonly assets: EquipmentAssetRepository,
    private readonly rates: EquipmentRateRepository,
  ) {}

  private hashOtp(code: string): string { return createHmac('sha256', this.config.auth.hashPepper).update(code).digest('hex'); }

  // ---- renter: request (rate snapshotted from the asset's active card) ----
  async request(tenantId: string, actor: EquipmentActor, idemKey: string, dto: RequestBookingDto) {
    if (!actor.canRent) throw new EquipmentForbiddenError('requires equipment.rent');
    return this.idem.remember(idemKey, actor.userId, 'equipment.booking.request', () =>
      timed(this.metrics, 'equipment.booking.request', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const asset = await this.assets.getById(tenantId, dto.assetId, tx);
          if (!asset) throw new AssetNotFoundError(dto.assetId);
          if (!asset.isBookable) throw new AssetNotBookableError(asset.status);
          if (asset.ownerUserId === actor.userId) throw new InvalidBookingError('cannot rent your own asset');
          // [PC-56 OPS-4a · E14] the organisation's own calendar day of the hire, not the UTC slice of the timestamp.
          const onDate = await this.rates.tenantDay(tx, tenantId, dto.scheduledAt);
          const rate = await this.rates.resolveActive(tx, dto.assetId, dto.rateBasis, onDate);
          if (!rate) throw new NoActiveRateError(dto.rateBasis);
          const id = uuidv7();
          const booking = EquipmentBooking.request({ id, tenantId, bookingNo: bookingNo(id), renterUserId: actor.userId, assetId: dto.assetId,
            ownerUserId: asset.ownerUserId, operatorUserId: null, taskDesc: dto.taskDesc ?? null, rateBasis: dto.rateBasis as RateBasis,
            rateMinor: rate.rateMinor, estQuantityCenti: parseScaled(dto.estQuantity, 2), scheduledAt: new Date(dto.scheduledAt) });
          await this.bookings.insert(tx, booking);
          await this.flush(tx, tenantId, booking.id, booking.pullEvents());
          return booking.toJSON();
        }, { userId: actor.userId })));
  }

  // ---- owner: quote the advance/deposit ----
  // [PC-56 OPS-4a · E10] recorded: one audit row with the deposit before and after (the owner's act, in the same transaction).
  async quote(tenantId: string, actor: EquipmentActor, id: string, dto: QuoteBookingDto, ip: string | null = null) {
    return this.ownerMutate(tenantId, actor, id, (b) => b.quote(BigInt(dto.advanceMinor)),
      { action: 'equipment.booking.quoted', ip, snap: (b) => ({ status: b.status, advanceMinor: b.advanceMinor.toString() }) });
  }

  // ---- renter: confirm → ESCROW the advance ----
  async confirm(tenantId: string, actor: EquipmentActor, id: string, idemKey: string) {
    if (!actor.canRent) throw new EquipmentForbiddenError('requires equipment.rent');
    // [PC-56 HOTFIX-13] HER deposit — only she confirms. Refused before the idempotency record and any write.
    const pre = await this.bookings.getById(tenantId, id);
    if (!pre) throw new BookingNotFoundError(id);
    if (pre.renterUserId !== actor.userId) throw new EqConfirmNotRenterError();
    return this.idem.remember(idemKey, actor.userId, 'equipment.booking.confirm', () =>
      timed(this.metrics, 'equipment.booking.confirm', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForUpdate(tx, tenantId, id);
          if (!booking) throw new BookingNotFoundError(id);
          if (booking.renterUserId !== actor.userId) throw new EqConfirmNotRenterError();
          const code = String(randomInt(100000, 999999));
          booking.confirm(this.hashOtp(code));
          if (booking.advanceMinor > 0n) {
            await this.wallet.post(tx, { tenantId, txnType: 'escrow_hold', idempotencyKey: `eqbook-hold:${booking.id}`, referenceType: 'equipment_booking', referenceId: booking.id, initiatedBy: actor.userId,
              legs: [{ account: userMain(booking.renterUserId), amountMinor: -booking.advanceMinor }, { account: platform(PlatformAccount.Escrow), amountMinor: booking.advanceMinor }] });
          }
          await this.bookings.update(tx, booking);
          await this.flush(tx, tenantId, booking.id, booking.pullEvents());
          // [PC-56 HOTFIX-13 · B4/E16] The start code reaches HER: returned in her own confirm response (only the renter gets here),
          // never in a list, a read, an owner's response, a log or an event. The row keeps only its HMAC hash.
          return { ...booking.toJSON(), startOtp: code };
        }, { userId: actor.userId })));
  }

  // ---- owner/operator: start (OTP-gated) ----
  async start(tenantId: string, actor: EquipmentActor, id: string, dto: StartBookingDto) {
    return this.ownerMutate(tenantId, actor, id, (b) => b.start(this.hashOtp(dto.otp), new Date()));
  }
  // ---- owner/operator: complete with measured usage ----
  async complete(tenantId: string, actor: EquipmentActor, id: string, dto: CompleteBookingDto) {
    return this.ownerMutate(tenantId, actor, id, (b) => b.complete(parseScaled(dto.actualQuantity, 2), new Date()));
  }
  // ---- renter: cancel (requested/quoted/confirmed) — refunds any escrow ----
  // [PC-56 HOTFIX-13] The administrator escape is KEPT here, deliberately (brief B2): cancel only ever REFUNDS her held deposit
  // (escrow → her wallet) and moves no other money, so it never spends the payer's money.
  // [PC-56 OPS-4a · E10/E12] keyed (Law 3), the reason validated by a strict DTO, one audit row; the party refusal BEFORE idem.remember.
  async cancel(tenantId: string, actor: EquipmentActor, id: string, idemKey: string, dto: CancelBookingDto = {}, ip: string | null = null) {
    const pre = await this.bookings.getById(tenantId, id);
    if (!pre) throw new BookingNotFoundError(id);
    if (pre.renterUserId !== actor.userId && pre.ownerUserId !== actor.userId && !actor.isAdmin) throw new EquipmentForbiddenError('not a party to this booking');
    // [PC-56 OPS-4b · lead-applied from OPS-2a "an operator's cancel needs a reason"] anyone but the RENTER (the machine's owner, an
    // administrator) cancels only with a reason — refused by name BEFORE the idempotency record and any write. The renter's stays optional.
    // (A blank reason never reaches here: the strict DTO refuses it, 422.)
    const reason = dto.reason;
    if (pre.renterUserId !== actor.userId && !(reason && reason.trim())) throw new CancelReasonRequiredError();
    return this.idem.remember(idemKey, actor.userId, 'equipment.booking.cancel', () => this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForUpdate(tx, tenantId, id);
      if (!booking) throw new BookingNotFoundError(id);
      if (booking.renterUserId !== actor.userId && booking.ownerUserId !== actor.userId && !actor.isAdmin) throw new EquipmentForbiddenError('not a party to this booking');
      const before = booking.status;
      const refund = booking.status === 'confirmed' ? booking.advanceMinor : 0n;
      booking.cancel(reason);
      if (refund > 0n) {
        await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `eqbook-cancel-refund:${booking.id}`, referenceType: 'equipment_booking', referenceId: booking.id, initiatedBy: actor.userId,
          legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: -refund }, { account: userMain(booking.renterUserId), amountMinor: refund }] });
      }
      await this.bookings.update(tx, booking);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'equipment.booking.cancelled', entityType: 'equipment_booking', entityId: booking.id,
        oldValue: { status: before }, newValue: { status: booking.status, refundMinor: refund.toString(), reason: reason ?? null }, ip });
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return booking.toJSON();
    }, { userId: actor.userId }));
  }

  // ---- owner: SETTLE (completed → settled): escrow release + remainder/refund ----
  async settle(tenantId: string, actor: EquipmentActor, id: string, idemKey: string, ip: string | null) {
    if (!actor.canManage) throw new EquipmentForbiddenError('requires equipment.manage');
    // [PC-56 HOTFIX-13 · founder Q1-A] Refused before the idempotency record and any write: anyone but the machine's owner; and a
    // settlement that would take money beyond the deposit from her wallet before she has confirmed the hours.
    const pre = await this.bookings.getById(tenantId, id);
    if (!pre) throw new BookingNotFoundError(id);
    if (pre.ownerUserId !== actor.userId) throw new EqNotMachineOwnerError();
    if (pre.takesBeyondDeposit && !pre.isUsageConfirmed) throw new SettleHoursNotConfirmedError();
    return this.idem.remember(idemKey, actor.userId, 'equipment.booking.settle', () =>
      timed(this.metrics, 'equipment.booking.settle', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForUpdate(tx, tenantId, id);
          if (!booking) throw new BookingNotFoundError(id);
          if (booking.ownerUserId !== actor.userId) throw new EqNotMachineOwnerError();
          // the same rule on the LOCKED row, before any ledger leg (0236's CHECK refuses it in the database too).
          if (booking.takesBeyondDeposit && !booking.isUsageConfirmed) throw new SettleHoursNotConfirmedError();
          const total = booking.totalMinor;
          if (total == null) throw new InvalidBookingError('booking is not completed');
          const advance = booking.advanceMinor;
          const payFromEscrow = advance < total ? advance : total;     // min(advance, total)
          const refundToRenter = advance > total ? advance - total : 0n; // unused hold back
          const shortfall = total > advance ? total - advance : 0n;      // renter still owes
          // 1) release escrow to the owner (escrow_release)
          if (payFromEscrow > 0n) await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `eqbook-release:${booking.id}`, referenceType: 'equipment_booking', referenceId: booking.id, initiatedBy: actor.userId,
            legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: -payFromEscrow }, { account: userMain(booking.ownerUserId), amountMinor: payFromEscrow }] });
          // 2) refund any unused escrow to the renter
          if (refundToRenter > 0n) await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `eqbook-refund:${booking.id}`, referenceType: 'equipment_booking', referenceId: booking.id, initiatedBy: actor.userId,
            legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: -refundToRenter }, { account: userMain(booking.renterUserId), amountMinor: refundToRenter }] });
          // 3) collect any shortfall from the renter (renter → owner)
          if (shortfall > 0n) await this.wallet.post(tx, { tenantId, txnType: 'order_payment', idempotencyKey: `eqbook-collect:${booking.id}`, referenceType: 'equipment_booking', referenceId: booking.id, initiatedBy: actor.userId,
            legs: [{ account: userMain(booking.renterUserId), amountMinor: -shortfall }, { account: userMain(booking.ownerUserId), amountMinor: shortfall }] });
          booking.markSettled();
          await this.bookings.update(tx, booking);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'equipment.booking.settled', entityType: 'equipment_booking', entityId: booking.id, newValue: { totalMinor: total.toString(), advanceMinor: advance.toString(),
            usageConfirmedBy: booking.usageConfirmedBy, usageConfirmedAt: booking.usageConfirmedAt ? new Date(booking.usageConfirmedAt).toISOString() : null }, ip });
          await this.flush(tx, tenantId, booking.id, booking.pullEvents());
          return { ...booking.toJSON(), settledTotalMinor: total.toString() };
        }, { userId: actor.userId })));
  }

  /**
   * [PC-56 HOTFIX-13 · founder Q1-A] ---- renter: CONFIRM THE HOURS the owner recorded (completed hire), in her own session ----
   * Refused before the idempotency record and any write: anyone but the renter (`USAGE_CONFIRM_NOT_RENTER`). The state checks
   * (completed, not yet confirmed) sit INSIDE the idempotency record on purpose, as HOTFIX-12's "already approved": checked before
   * it, every same-key replay of a successful confirmation would become a 409. One audit row with the hours and the bill.
   */
  async confirmUsage(tenantId: string, actor: EquipmentActor, id: string, idemKey: string, ip: string | null) {
    if (!actor.canRent) throw new EquipmentForbiddenError('requires equipment.rent');
    const pre = await this.bookings.getById(tenantId, id);
    if (!pre) throw new BookingNotFoundError(id);
    if (pre.renterUserId !== actor.userId) throw new UsageConfirmNotRenterError();
    return this.idem.remember(idemKey, actor.userId, 'equipment.booking.confirm_usage', () =>
      timed(this.metrics, 'equipment.booking.confirm_usage', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForUpdate(tx, tenantId, id);
          if (!booking) throw new BookingNotFoundError(id);
          const at = new Date();
          booking.confirmUsage(actor.userId, at);   // renter, completed, once — or a named refusal
          if (!(await this.bookings.confirmUsage(tx, tenantId, id, actor.userId, at))) throw new UsageAlreadyConfirmedError();
          const json = booking.toJSON();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'equipment.booking.usage_confirmed', entityType: 'equipment_booking', entityId: booking.id,
            newValue: { actualQuantity: json.actualQuantity, rateBasis: json.rateBasis, rateMinor: json.rateMinor, totalMinor: json.totalMinor, advanceMinor: json.advanceMinor,
              usageConfirmedAt: at.toISOString() }, ip });
          return json;
        }, { userId: actor.userId })));
  }

  // ---- reads ----
  async getById(tenantId: string, actor: EquipmentActor, id: string) {
    const b = await this.bookings.getById(tenantId, id);
    if (!b) throw new BookingNotFoundError(id);
    if (b.renterUserId !== actor.userId && b.ownerUserId !== actor.userId && !actor.isAdmin) throw new BookingNotFoundError(id); // 404, no cross-party IDOR
    return b.toJSON();
  }
  async list(tenantId: string, actor: EquipmentActor, q: { box: 'renter' | 'owner' | 'all'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.isAdmin) throw new EquipmentForbiddenError('requires booking.manage');
    const rows = await this.bookings.listFor(tenantId, { renterUserId: q.box === 'renter' ? actor.userId : undefined, ownerUserId: q.box === 'owner' ? actor.userId : undefined, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  // ---- worker job: timeout an un-confirmed booking past its scheduled time (refund not needed; no escrow yet) ----
  async timeout(tenantId: string, id: string): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForUpdate(tx, tenantId, id);
      if (!booking || (booking.status !== 'requested' && booking.status !== 'quoted')) return;
      booking.cancel('confirm_timeout');
      await this.bookings.update(tx, booking);
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
    }, { userId: 'system' });
  }

  private async ownerMutate(tenantId: string, actor: EquipmentActor, id: string, fn: (b: EquipmentBooking) => void,
    record?: { action: string; ip: string | null; snap: (b: EquipmentBooking) => Record<string, unknown> }) {
    if (!actor.canManage) throw new EquipmentForbiddenError('requires equipment.manage');
    // [PC-56 HOTFIX-13] the machine's owner only — the administrator escape is gone; refused before the unit of work.
    const pre = await this.bookings.getById(tenantId, id);
    if (!pre) throw new BookingNotFoundError(id);
    if (pre.ownerUserId !== actor.userId) throw new EqNotMachineOwnerError();
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForUpdate(tx, tenantId, id);
      if (!booking) throw new BookingNotFoundError(id);
      if (booking.ownerUserId !== actor.userId) throw new EqNotMachineOwnerError();
      const old = record ? record.snap(booking) : null;
      fn(booking);
      await this.bookings.update(tx, booking);
      if (record) await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: record.action, entityType: 'equipment_booking', entityId: booking.id,
        oldValue: old, newValue: record.snap(booking), ip: record.ip });
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return booking.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'equipment_booking', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
