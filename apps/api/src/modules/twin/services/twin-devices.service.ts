// modules/twin/services/twin-devices.service.ts · PC-56 TENANT-12 · THE FIELD DEVICE REGISTRY (founder decision: DEVICE REGISTRY ONLY,
// READINGS REFUSED — DELTA-046).
//
// A cooperative registers the soil pods and weather masts it has put in the field: kind (twin_device_kind), serial (unique per tenant),
// an optional label and parcel (this tenant's). Registering is `twin.devices.manage` (tenant_admin), keyed (Law 3), audited. Retiring
// needs a reason. A registered device is a FACT the overview counts; a READING is not — there is no readings table, no ingestion topic,
// and `last_reading_at` has no writer (kv_app holds no UPDATE on it). The console prints "readings: none — ingestion not built".
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { TwinRepository, DeviceRow } from '../repositories/twin.repository';
import { reasonRefusal } from '../domain/twin-rules';
import { DeviceNotFoundError, TwinForbiddenError, TwinRefusedError } from '../domain/twin.errors';
import { TwinActor, canManageDevices, canView } from './twin.service';

/** Mirrors 0190's ck_twin_devices_serial. */
export const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$/;
const pgCode = (e: unknown) => (e as { code?: string })?.code;
const pgConstraint = (e: unknown) => (e as { constraint?: string })?.constraint;

export interface DeviceInput { kind?: string | null; serial?: string | null; label?: string | null; parcelId?: string | null }

@Injectable()
export class TwinDevicesService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
              private readonly repo: TwinRepository, private readonly audit: AuditWriter) {}

  private static wire(d: DeviceRow) {
    return { id: d.id, kind: d.kindCode, serial: d.serial, label: d.label, parcelId: d.parcelId, status: d.status, registeredAt: d.registeredAt,
      retiredAt: d.retiredAt, retireReason: d.retireReason, lastReadingAt: d.lastReadingAt, readings: 'none' as const };
  }

  async list(tenantId: string, actor: TwinActor, q: { kind?: string; cursor?: KeysetCursor; limit: number }) {
    if (!canView(actor)) throw new TwinForbiddenError('twin.view');
    const rows = await this.repo.listDevices(tenantId, q);
    const last = rows[rows.length - 1];
    return { items: rows.map(TwinDevicesService.wire), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.id) : null,
      canManage: canManageDevices(actor), ingestion: 'not_built' as const };
  }

  async register(tenantId: string, actor: TwinActor, key: string, input: DeviceInput) {
    return this.idem.remember(key, actor.userId, 'twin.device.register', async () => {
      const refusals: Array<{ field: string | null; code: string }> = [];
      if (!canManageDevices(actor)) refusals.push({ field: null, code: 'NO_PERMISSION' });
      const cat = await this.repo.catalogue(tenantId);
      const kind = (input.kind ?? '').trim();
      if (!cat.deviceKinds.includes(kind)) refusals.push({ field: 'kind', code: 'KIND_UNKNOWN' });
      const serial = (input.serial ?? '').trim();
      if (!serial) refusals.push({ field: 'serial', code: 'SERIAL_REQUIRED' });
      else if (!SERIAL_RE.test(serial)) refusals.push({ field: 'serial', code: 'SERIAL_INVALID' });
      const label = (input.label ?? '').trim() || null;
      if (label && label.length > 120) refusals.push({ field: 'label', code: 'LABEL_TOO_LONG' });
      const parcelId = (input.parcelId ?? '').trim() || null;
      if (refusals.length) throw new TwinRefusedError(refusals);
      const id = uuidv7();
      try {
        await this.uow.run(tenantId, async (tx) => {
          if (parcelId && !(await this.repo.parcelOfTenant(tx, tenantId, parcelId))) throw new TwinRefusedError([{ field: 'parcelId', code: 'PARCEL_UNKNOWN' }]);
          await this.repo.insertDevice(tx, { id, tenantId, kind, serial, label, parcelId, userId: actor.userId });
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'twin.device.registered', entityType: 'twin_device', entityId: id,
            oldValue: null, newValue: { kind, serial, label, parcelId, status: 'registered', lastReadingAt: null }, reason: null, ip: actor.ip, requestId: actor.requestId,
          });
        }, { userId: actor.userId });
      } catch (e) {
        if (pgCode(e) === '23505' && pgConstraint(e) === 'uq_twin_devices_serial') throw new TwinRefusedError([{ field: 'serial', code: 'SERIAL_TAKEN' }]);
        if (pgCode(e) === '23514') throw new TwinRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]);
        throw e;
      }
      return { id, status: 'registered' as const, lastReadingAt: null };
    });
  }

  async retire(tenantId: string, actor: TwinActor, id: string, key: string, reason: string) {
    return this.idem.remember(key, actor.userId, 'twin.device.retire', () => this.uow.run(tenantId, async (tx) => {
      const refusals: Array<{ field: string | null; code: string }> = [];
      if (!canManageDevices(actor)) refusals.push({ field: null, code: 'NO_PERMISSION' });
      const rr = reasonRefusal(reason); if (rr) refusals.push({ field: 'reason', code: rr });
      const d = await this.repo.getDevice(tenantId, id, tx, true);
      if (!d) throw new DeviceNotFoundError(id);
      if (d.status === 'retired') refusals.push({ field: null, code: 'DEVICE_RETIRED' });
      if (refusals.length) throw new TwinRefusedError(refusals);
      await this.repo.retireDevice(tx, tenantId, id, actor.userId, reason.trim());
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'twin.device.retired', entityType: 'twin_device', entityId: id,
        oldValue: { status: 'registered' }, newValue: { status: 'retired' }, reason: reason.trim(), ip: actor.ip, requestId: actor.requestId,
      });
      return { id, status: 'retired' as const };
    }, { userId: actor.userId }));
  }
}
