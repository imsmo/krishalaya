// modules/warehousing/services/storage-booking.service.ts · the deposit lifecycle + THE STORAGE-FEE MONEY PATH.
// request (depositor) → confirm → store (operator) → release (operator — PAUSED by PC-56 OPS-1a, founder Q3-A: refused by name, see release()): on release the storage fee
// (quantity in quintals × rate/qtl/month × months, float-free; a booking is made in quintals only — PC-56 OPS-2c B5) is collected depositor userMain → operator userMain via
// the wallet boundary (txnType 'storage_fee', zero-sum + idempotent — Law 2). Every write: one ACID tx
// (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money mutations (Law 3), authz
// THROWS (Law 6). No version column → bookings lock FOR UPDATE.
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
import { BookingNotFoundError, WarehouseNotFoundError, NoWarehouseOperatorError, WarehousingForbiddenError, StorageReleaseAwaitsDepositorError, StorageUnitNotQuintalError } from '../domain/warehousing.errors';
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

  async confirm(tenantId: string, actor: WhActor, id: string) { return this.operatorMutate(tenantId, actor, id, (b) => b.confirm()); }
  async store(tenantId: string, actor: WhActor, id: string) { return this.operatorMutate(tenantId, actor, id, (b) => b.store(new Date())); }

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
          if (warehouse.operatorUserId !== actor.userId && !actor.isAdmin) throw new WarehousingForbiddenError('only the warehouse operator may release');
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

  async cancel(tenantId: string, actor: WhActor, id: string, reason?: string) {
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.repo.getForUpdate(tx, tenantId, id);
      if (!booking) throw new BookingNotFoundError(id);
      if (booking.depositorUserId !== actor.userId && !actor.canManage && !actor.isAdmin) throw new WarehousingForbiddenError('not a party to this booking');
      booking.cancel(reason);
      await this.repo.update(tx, booking);
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return booking.toJSON();
    }, { userId: actor.userId });
  }

  async getById(tenantId: string, actor: WhActor, id: string) {
    const b = await this.repo.getById(tenantId, id);
    if (!b) throw new BookingNotFoundError(id);
    if (b.depositorUserId !== actor.userId && !actor.canManage && !actor.isAdmin) throw new BookingNotFoundError(id); // 404, no IDOR
    return b.toJSON();
  }
  async list(tenantId: string, actor: WhActor, q: { box: 'depositor' | 'warehouse' | 'all'; warehouseId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if ((q.box === 'warehouse' || q.box === 'all') && !actor.canManage && !actor.isAdmin) throw new WarehousingForbiddenError('requires warehouse.manage');
    const rows = await this.repo.listFor(tenantId, { depositorUserId: q.box === 'depositor' ? actor.userId : undefined, warehouseId: q.box === 'warehouse' ? q.warehouseId : undefined, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async operatorMutate(tenantId: string, actor: WhActor, id: string, fn: (b: StorageBooking) => void) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.repo.getForUpdate(tx, tenantId, id);
      if (!booking) throw new BookingNotFoundError(id);
      const warehouse = await this.warehouses.getBookable(tenantId, booking.warehouseId, tx);
      if (!warehouse) throw new WarehouseNotFoundError(booking.warehouseId);
      if (warehouse.operatorUserId !== actor.userId && !actor.isAdmin) throw new WarehousingForbiddenError('only the warehouse operator may act here');
      fn(booking);
      await this.repo.update(tx, booking);
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return booking.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'storage_booking', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
