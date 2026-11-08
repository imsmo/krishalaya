// modules/warehousing/services/storage-booking.service.ts · the deposit lifecycle + THE STORAGE-FEE MONEY PATH.
// request (depositor) → confirm → store (operator) → release (operator — PAUSED by PC-56 OPS-1a, founder Q3-A: refused by name, see release()): on release the storage fee
// (quantity in quintals × rate/qtl/month × months, float-free; a booking is made in quintals only — PC-56 OPS-2c B5) is collected depositor userMain → operator userMain via
// the wallet boundary (txnType 'storage_fee', zero-sum + idempotent — Law 2). Every write: one ACID tx
// (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money mutations (Law 3), authz
// THROWS (Law 6). No version column → bookings lock FOR UPDATE.
// PC-56 OPS-2a (founder Q11-A, D3, 2026-11-06/08): confirm and store are the warehouse's NAMED operator's only (403 WAREHOUSE_OPERATOR_ONLY, no
// administrator escape) and each writes ONE audit row in the same transaction (B4). Cancel is the depositor's own or the named operator's (403
// BOOKING_CANCEL_NOT_PERMITTED otherwise); the operator's cancel needs a reason (400 BOOKING_CANCEL_REASON_REQUIRED, decided BEFORE the unit of
// work and any lock); every cancel writes ONE audit row. Cancel takes no Idempotency-Key (none was decided): a replay finds the booking already
// cancelled and is refused by the state machine (409 STORAGE_BOOKING_ILLEGAL_TRANSITION), writing nothing.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { StorageBooking } from '../domain/storage-booking.entity';
import { DomainEvent } from '../domain/warehousing.events';
import { StorageBookingRepository } from '../repositories/storage-booking.repository';
import { WarehouseRepository } from '../repositories/warehouse.repository';
import { RequestBookingDto } from '../dto/create-storage-booking.dto';
import { BookingNotFoundError, WarehouseNotFoundError, NoWarehouseOperatorError, WarehousingForbiddenError, StorageReleaseAwaitsDepositorError, StorageUnitNotQuintalError,
  WarehouseOperatorOnlyError, BookingCancelReasonRequiredError, BookingCancelNotPermittedError } from '../domain/warehousing.errors';
import { STORAGE_FEE_UNIT } from '../domain/quantity';
import { WhActor } from './warehouse.service';

const parseScaled = (s: string, dec: number): bigint => { const [i, f = ''] = s.split('.'); return BigInt(i + (f + '0'.repeat(dec)).slice(0, dec)); };

@Injectable()
export class StorageBookingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly repo: StorageBookingRepository,
    private readonly warehouses: WarehouseRepository,
  ) {}

  async request(tenantId: string, actor: WhActor, idemKey: string, dto: RequestBookingDto) {
    if (!actor.canStore) throw new WarehousingForbiddenError('requires warehouse.store');
    // PC-56 OPS-2c · OPS2-B5 (founder Q2-A): the fee reads the quantity as quintals, so any other unit is refused BY NAME here — after the
    // permission check, BEFORE the idempotency record (`idem.remember`), the unit of work and any write. A replay gets the same refusal.
    if (dto.unitCode !== STORAGE_FEE_UNIT) throw new StorageUnitNotQuintalError(dto.unitCode);
    return this.idem.remember(idemKey, actor.userId, 'warehousing.booking.request', () =>
      timed(this.metrics, 'warehousing.booking.request', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const warehouse = await this.warehouses.getBookable(tenantId, dto.warehouseId, tx);
          if (!warehouse || !warehouse.isActive) throw new WarehouseNotFoundError(dto.warehouseId);
          const booking = StorageBooking.request({ id: uuidv7(), tenantId, warehouseId: dto.warehouseId, depositorUserId: actor.userId, productId: dto.productId,
            quantityMilli: parseScaled(dto.quantity, 3), unitCode: dto.unitCode, expectedArrival: dto.expectedArrival ?? null });
          await this.repo.insert(tx, booking);
          await this.flush(tx, tenantId, booking.id, booking.pullEvents());
          return booking.toJSON();
        }, { userId: actor.userId })));
  }

  async confirm(tenantId: string, actor: WhActor, id: string, ip: string | null = null) { return this.operatorMutate(tenantId, actor, id, 'confirm', (b) => b.confirm(), ip); }
  async store(tenantId: string, actor: WhActor, id: string, ip: string | null = null) { return this.operatorMutate(tenantId, actor, id, 'store', (b) => b.store(new Date()), ip); }

  /** Operator releases the goods + collects the storage fee (depositor → operator, zero-sum, idempotent). */
  async release(tenantId: string, actor: WhActor, id: string, idemKey: string, ip: string | null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    // PC-56 OPS-1a (founder Q3-A): the release debits the DEPOSITOR's wallet on the operator's act alone. Until she confirms the
    // release and its fee in her own session, it is refused BY NAME here — after the permission and Idempotency-Key checks, BEFORE the
    // idempotency record, the lock, the fee and any state write. Nothing below this line runs; it is kept, unchanged, for that wave.
    throw new StorageReleaseAwaitsDepositorError();
    return this.idem.remember(idemKey, actor.userId, 'warehousing.booking.release', () =>
      timed(this.metrics, 'warehousing.booking.release', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.repo.getForUpdate(tx, tenantId, id);
          if (!booking) throw new BookingNotFoundError(id);
          const warehouse = await this.warehouses.getBookable(tenantId, booking.warehouseId, tx);
          if (!warehouse) throw new WarehouseNotFoundError(booking.warehouseId);
          if (warehouse.operatorUserId !== actor.userId) throw new WarehousingForbiddenError('only the warehouse operator may release');   // OPS-2a: no admin term (unreachable)
          const now = new Date();
          const fee = booking.storageFeeMinor(warehouse.ratePerQtlMonthMinor ?? 0n, booking.monthsStored(now));
          if (fee > 0n) {
            if (!warehouse.operatorUserId) throw new NoWarehouseOperatorError();
            await this.wallet.post(tx, { tenantId, txnType: 'storage_fee', idempotencyKey: `storagefee:${booking.id}`, referenceType: 'storage_booking', referenceId: booking.id, initiatedBy: actor.userId,
              legs: [{ account: userMain(booking.depositorUserId), amountMinor: -fee }, { account: userMain(warehouse.operatorUserId), amountMinor: fee }] });
          }
          booking.release(now, fee);
          await this.repo.update(tx, booking);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.booking.released', entityType: 'storage_booking', entityId: booking.id, newValue: { storageFeeMinor: fee.toString() }, ip });
          await this.flush(tx, tenantId, booking.id, booking.pullEvents());
          return { ...booking.toJSON(), storageFeeMinor: fee.toString() };
        }, { userId: actor.userId })));
  }

  /**
   * PC-56 OPS-2a · D3 (founder 2026-11-08). Who: the depositor herself, or the warehouse's NAMED operator — nobody else (403 by name). A person who
   * is both (her own booking at the warehouse she operates) cancels as the depositor. The operator's cancel needs a reason of 1–500 characters;
   * hers keeps it optional (≤ 500). Order: the parties are read WITHOUT a lock (`getById`, `getBookable`), and the party and reason refusals are
   * thrown BEFORE the unit of work, the `FOR UPDATE` and any write; inside the unit of work the locked row is checked again (the operator could
   * have been reassigned in between) and ONE audit row (`warehousing.booking.cancelled`: status before → after, who cancelled — 'operator' or
   * 'depositor' — and the reason) is written in the same transaction as the state change.
   */
  async cancel(tenantId: string, actor: WhActor, id: string, reason?: string | null, ip: string | null = null) {
    if (!actor.canManage && !actor.canStore) throw new WarehousingForbiddenError('requires warehouse.store or warehouse.manage');
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length > 500) throw new BookingCancelReasonRequiredError();
    const role = async (b: StorageBooking, tx?: TxContext): Promise<'depositor' | 'operator' | null> => {
      if (b.depositorUserId === actor.userId) return 'depositor';
      if (!actor.canManage) return null;
      const w = await this.warehouses.getBookable(tenantId, b.warehouseId, tx);
      return w && w.operatorUserId === actor.userId ? 'operator' : null;
    };
    const seen = await this.repo.getById(tenantId, id);
    if (!seen) throw new BookingNotFoundError(id);
    const pre = await role(seen);
    if (!pre) throw new BookingCancelNotPermittedError();
    if (pre === 'operator' && why.length < 1) throw new BookingCancelReasonRequiredError();   // D3: before the unit of work and any lock
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.repo.getForUpdate(tx, tenantId, id);
      if (!booking) throw new BookingNotFoundError(id);
      const by = await role(booking, tx);
      if (!by) throw new BookingCancelNotPermittedError();
      if (by === 'operator' && why.length < 1) throw new BookingCancelReasonRequiredError();
      const from = booking.status;
      booking.cancel(why || undefined);
      await this.repo.update(tx, booking);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.booking.cancelled', entityType: 'storage_booking', entityId: booking.id,
        oldValue: { status: from }, newValue: { status: booking.status, cancelledBy: by }, reason: why || null, ip });
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return booking.toJSON();
    }, { userId: actor.userId });
  }

  async getById(tenantId: string, actor: WhActor, id: string) {
    const b = await this.repo.getById(tenantId, id);
    if (!b) throw new BookingNotFoundError(id);
    if (b.depositorUserId !== actor.userId && !actor.canManage) throw new BookingNotFoundError(id); // 404, no IDOR (OPS-2a: the admin term is gone)
    return b.toJSON();
  }
  async list(tenantId: string, actor: WhActor, q: { box: 'depositor' | 'warehouse' | 'all'; warehouseId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if ((q.box === 'warehouse' || q.box === 'all') && !actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    const rows = await this.repo.listFor(tenantId, { depositorUserId: q.box === 'depositor' ? actor.userId : undefined, warehouseId: q.box === 'warehouse' ? q.warehouseId : undefined, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /** PC-56 OPS-2a (Q11-A, B4): the named operator only — no administrator escape — and ONE audit row per act, in the same transaction. */
  private async operatorMutate(tenantId: string, actor: WhActor, id: string, act: 'confirm' | 'store', fn: (b: StorageBooking) => void, ip: string | null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.repo.getForUpdate(tx, tenantId, id);
      if (!booking) throw new BookingNotFoundError(id);
      const warehouse = await this.warehouses.getBookable(tenantId, booking.warehouseId, tx);
      if (!warehouse) throw new WarehouseNotFoundError(booking.warehouseId);
      if (warehouse.operatorUserId !== actor.userId) throw new WarehouseOperatorOnlyError(act === 'confirm' ? 'booking.confirm' : 'booking.store');
      const from = booking.status;
      fn(booking);
      await this.repo.update(tx, booking);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: act === 'confirm' ? 'warehousing.booking.confirmed' : 'warehousing.booking.stored',
        entityType: 'storage_booking', entityId: booking.id, oldValue: { status: from }, newValue: { status: booking.status }, ip });
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return booking.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'storage_booking', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
