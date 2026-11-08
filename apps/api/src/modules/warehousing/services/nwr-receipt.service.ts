// modules/warehousing/services/nwr-receipt.service.ts · electronic Negotiable Warehouse Receipts — READ, and one hardened act (cancel).
// PC-56 OPS-2b (founder Q3-A, Q5-A, Q11-A, 2026-11-06):
//   • ISSUE is REFUSED BY NAME (ENWR_ISSUE_NOT_ON_PLATFORM, B2): this platform does not issue an eNWR and records none in a depositor's name.
//     The refusal sits after the permission check, BEFORE `idem.remember`, the unit of work and any read or write; the old body below it is kept,
//     unreachable and unchanged, for the record (it recorded a receipt on the operator's word — survey F-2).
//   • A STANDALONE RELEASE is REFUSED BY NAME (ENWR_RELEASE_NOT_STANDALONE, B1): a receipt is never released on its own; nothing is locked or written.
//   • CANCEL is the warehouse's NAMED operator's act only (no administrator escape), Idempotency-Keyed, with a required reason, and writes ONE
//     audit row (status before/after + the reason) in the same transaction; a replay with the same key returns the stored response.
// Records already in `nwr_receipts` stay readable (list/get). One ACID tx (UoW), state via the machine (Law 5), outbox in-tx (Law 4), authz
// THROWS (Law 6). No money here — pledging a receipt is refused on the loan side too (fintech, B8).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { NwrReceipt } from '../domain/nwr-receipt.entity';
import { NwrRepository, DomainEvent } from '../domain/warehousing.events';
import { NwrReceiptRepository } from '../repositories/nwr-receipt.repository';
import { StorageBookingRepository } from '../repositories/storage-booking.repository';
import { WarehouseRepository } from '../repositories/warehouse.repository';
import { IssueNwrDto } from '../dto/create-nwr-receipt.dto';
import { BookingNotFoundError, BookingNotStoredError, NwrNotFoundError, NwrAlreadyIssuedError, EnwrExistsError, WarehousingForbiddenError,
  EnwrIssueNotOnPlatformError, EnwrReleaseNotStandaloneError, EnwrCancelReasonRequiredError, WarehouseOperatorOnlyError } from '../domain/warehousing.errors';
import { WhActor } from './warehouse.service';

@Injectable()
export class NwrReceiptService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: NwrReceiptRepository,
    private readonly bookings: StorageBookingRepository,
    private readonly warehouses: WarehouseRepository,
  ) {}

  async issue(tenantId: string, actor: WhActor, idemKey: string, dto: IssueNwrDto, ip: string | null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    // PC-56 OPS-2b · OPS2-B2 (founder Q3-A): refused BY NAME here — before the idempotency record, the unit of work and any read or write.
    // Nothing below this line runs; it is kept, unchanged, for the record.
    throw new EnwrIssueNotOnPlatformError();
    return this.idem.remember(idemKey, actor.userId, 'warehousing.nwr.issue', () =>
      timed(this.metrics, 'warehousing.nwr.issue', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForUpdate(tx, tenantId, dto.storageBookingId);
          if (!booking) throw new BookingNotFoundError(dto.storageBookingId);
          if (booking.status !== 'stored') throw new BookingNotStoredError(booking.status);
          const warehouse = await this.warehouses.getBookable(tenantId, booking.warehouseId, tx);
          if (!warehouse || warehouse.operatorUserId !== actor.userId) throw new WarehousingForbiddenError('only the warehouse operator may issue an eNWR');   // OPS-2a: no admin term (unreachable)
          if (await this.repo.findActiveForBooking(tx, tenantId, dto.storageBookingId)) throw new NwrAlreadyIssuedError();
          const nwr = NwrReceipt.issue({ id: uuidv7(), tenantId, storageBookingId: dto.storageBookingId, repository: dto.repository as NwrRepository, enwrNo: dto.enwrNo,
            holderUserId: booking.depositorUserId, quantityMilli: booking.quantityMilli, valuationMinor: BigInt(dto.valuationMinor), issuedAt: new Date(), expiresAt: dto.expiresAt ?? null });
          try { await this.repo.insert(tx, nwr); } catch (e: any) { if (e?.code === '23505') throw new EnwrExistsError(); throw e; }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.nwr.issued', entityType: 'nwr_receipt', entityId: nwr.id, newValue: { enwrNo: dto.enwrNo, valuationMinor: dto.valuationMinor }, ip });
          await this.flush(tx, tenantId, nwr.id, nwr.pullEvents());
          return nwr.toJSON();
        }, { userId: actor.userId })));
  }

  /** PC-56 OPS-2b · OPS2-B1 (founder Q5-A): a receipt is never released on its own — refused BY NAME before any lock or write. */
  async release(_tenantId: string, actor: WhActor, _id: string): Promise<never> {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    throw new EnwrReleaseNotStandaloneError();
  }

  /**
   * PC-56 OPS-2b · OPS2-B1 (founder Q5-A, Q11-A): cancel — by THAT warehouse's named operator only (no administrator escape), with an
   * Idempotency-Key (the controller refuses a missing one, 400) and a reason (1–500 characters, refused by name BEFORE the idempotency record).
   * One audit row (`warehousing.nwr.cancelled`: status before → after, the reason) in the same transaction as the state change; a replay with the
   * same key returns the stored response and writes nothing more. A refusal inside the unit of work (not found, not the operator, an illegal
   * transition) rolls everything back and frees the key.
   */
  async cancel(tenantId: string, actor: WhActor, id: string, idemKey: string, reason: string | null | undefined, ip: string | null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < 1 || why.length > 500) throw new EnwrCancelReasonRequiredError();
    return this.idem.remember(idemKey, actor.userId, 'warehousing.nwr.cancel', () =>
      timed(this.metrics, 'warehousing.nwr.cancel', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const nwr = await this.repo.getForUpdate(tx, tenantId, id);
          if (!nwr) throw new NwrNotFoundError(id);
          const booking = await this.bookings.getById(tenantId, nwr.storageBookingId, tx);
          const warehouse = booking ? await this.warehouses.getBookable(tenantId, booking.warehouseId, tx) : null;
          if (!warehouse || warehouse.operatorUserId !== actor.userId) throw new WarehouseOperatorOnlyError('nwr.cancel');   // Q11-A: strict, no admin
          const from = nwr.status;
          nwr.cancel();
          await this.repo.update(tx, nwr);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.nwr.cancelled', entityType: 'nwr_receipt', entityId: nwr.id,
            oldValue: { status: from }, newValue: { status: nwr.status }, reason: why, ip });
          await this.flush(tx, tenantId, nwr.id, nwr.pullEvents());
          return nwr.toJSON();
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, actor: WhActor, id: string) {
    const n = await this.repo.getById(tenantId, id);
    if (!n) throw new NwrNotFoundError(id);
    if (n.holderUserId !== actor.userId && !actor.canManage) throw new NwrNotFoundError(id); // 404, no IDOR
    return n.toJSON();
  }
  async list(tenantId: string, actor: WhActor, q: { box: 'mine' | 'all'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    const rows = await this.repo.listFor(tenantId, { holderUserId: q.box === 'mine' ? actor.userId : undefined, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((n) => n.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'nwr_receipt', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
