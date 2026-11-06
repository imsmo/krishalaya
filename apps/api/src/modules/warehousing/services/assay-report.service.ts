// modules/warehousing/services/assay-report.service.ts · record the warehouse's own assay entry (the operator) + a booking's assay list.
// PC-56 OPS-2b (founder Q13-A, Q11-A, 2026-11-06): an assay here is "the warehouse's own entry — not a lab certificate, and it sets no price" —
// `assayer_name` is free text, no lab, accreditation or verification exists, and no price, valuation or fee reads `assay_reports` (survey C-10,
// F-7). Recording it is the warehouse's NAMED operator's act only (no administrator escape — Q11-A applied strictly to this act), on a `stored`
// booking only (409 BOOKING_NOT_STORED otherwise, F-16), and it writes ONE audit row (`warehousing.assay.recorded`) in the same transaction (B4).
// One ACID tx (UoW), outbox in-tx (Law 4), authz THROWS (Law 6). No money.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AssayReport } from '../domain/assay-report.entity';
import { DomainEvent } from '../domain/warehousing.events';
import { AssayReportRepository } from '../repositories/assay-report.repository';
import { StorageBookingRepository } from '../repositories/storage-booking.repository';
import { WarehouseRepository } from '../repositories/warehouse.repository';
import { RecordAssayDto } from '../dto/create-assay-report.dto';
import { BookingNotFoundError, BookingNotStoredError, WarehousingForbiddenError, WarehouseOperatorOnlyError } from '../domain/warehousing.errors';
import { WhActor } from './warehouse.service';

@Injectable()
export class AssayReportService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: AssayReportRepository,
    private readonly bookings: StorageBookingRepository,
    private readonly warehouses: WarehouseRepository,
  ) {}

  async record(tenantId: string, actor: WhActor, dto: RecordAssayDto, ip: string | null = null) {
    if (!actor.canManage) throw new WarehousingForbiddenError('requires warehouse.manage');
    return timed(this.metrics, 'warehousing.assay.record', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const booking = await this.bookings.getById(tenantId, dto.storageBookingId, tx);
        if (!booking) throw new BookingNotFoundError(dto.storageBookingId);
        if (booking.status !== 'stored') throw new BookingNotStoredError(booking.status);
        const warehouse = await this.warehouses.getBookable(tenantId, booking.warehouseId, tx);
        // PC-56 OPS-2b (founder Q11-A, strict on this act): the named operator only — the `!actor.isAdmin` escape is gone here.
        if (!warehouse || warehouse.operatorUserId !== actor.userId) throw new WarehouseOperatorOnlyError('assay.record');
        const assay = AssayReport.record({ id: uuidv7(), tenantId, storageBookingId: dto.storageBookingId, assayerName: dto.assayerName, parameters: dto.parameters,
          gradeOptionId: dto.gradeOptionId ?? null, reportMediaId: dto.reportMediaId ?? null, assayedAt: new Date(), validUntil: dto.validUntil ?? null });
        await this.repo.insert(tx, assay);
        // PC-56 OPS-2b · OPS2-B4 (founder Q13-A): the record act is audited — ONE row, same transaction; what was entered, by whom (never a price).
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'warehousing.assay.recorded', entityType: 'assay_report', entityId: assay.id,
          newValue: { storageBookingId: dto.storageBookingId, assayerName: dto.assayerName, parameterNames: Object.keys(dto.parameters).sort(), validUntil: dto.validUntil ?? null }, ip });
        await this.flush(tx, tenantId, assay.id, assay.pullEvents());
        return assay.toJSON();
      }, { userId: actor.userId }));
  }
  async listForBooking(tenantId: string, actor: WhActor, storageBookingId: string) {
    const booking = await this.bookings.getById(tenantId, storageBookingId);
    if (!booking) throw new BookingNotFoundError(storageBookingId);
    if (booking.depositorUserId !== actor.userId && !actor.canManage && !actor.isAdmin) throw new BookingNotFoundError(storageBookingId); // 404, no IDOR
    return (await this.repo.listForBooking(tenantId, storageBookingId)).map((a) => a.toJSON());
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'assay_report', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
