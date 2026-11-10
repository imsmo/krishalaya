// modules/equipment/services/maintenance.service.ts · PC-54 W54-12 (canon 312) — a machine's maintenance entries and the two alerts.
// [PC-56 OPS-4b · OPS4-B7 / E11 / E12, survey C-9 / F-8 — CORRECTED] The old header said "Owner-or-manage writes the log (owner check via the
// asset row)": there was NO owner check — any `equipment.manage` holder could write a breakdown or a cost onto anyone's machine, unaudited, on
// any date, and the logs were readable by any signed-in user. Now:
//   • RECORD is the machine OWNER's alone (`MAINTENANCE_NOT_YOUR_MACHINE`, 403 — no administrator escape), dated on or before the ORGANISATION's
//     own today (`MAINTENANCE_DATE_IN_FUTURE`, 400 — the tenant-day rule: `tenants.country_code → countries.timezone`, resolved in SQL), keyed
//     (Law 3 — the controller answers 400 without an Idempotency-Key), ONE audit row with the entry. Both refusals sit AFTER the permission and
//     key checks and BEFORE `idem.remember` and any write (a pre-read of the machine; the owner check again on the row inside the transaction).
//   • An entry does NOT change the machine's status (nothing here touches `equipment_assets`); only the owner's status toggle does, and a
//     machine whose status is `maintenance` is not bookable (`EquipmentAsset.isBookable`).
//   • LOGS are read by the machine's owner only; anyone else — an administrator too — gets 404 (no enumeration).
//   • ALERTS are the caller's own machines; a `booking.manage` holder keeps the organisation's view.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MaintenanceRepository } from '../repositories/maintenance.repository';
import { EquipmentAssetRepository } from '../repositories/equipment-asset.repository';
import { AssetNotFoundError, MaintenanceDateInFutureError, MaintenanceNotYourMachineError } from '../domain/equipment.errors';
import type { MaintenanceLogDto } from '../dto/create-maintenance-log.dto';

export interface MaintenanceActor { userId: string; isAdmin: boolean }

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: MaintenanceRepository,
    private readonly assets: EquipmentAssetRepository,
  ) {}

  async record(tenantId: string, actor: MaintenanceActor, assetId: string, idemKey: string, dto: MaintenanceLogDto, ip: string | null = null) {
    // Refused BEFORE the idempotency record and any write: not the owner; a day after the organisation's today.
    const pre = await this.assets.getById(tenantId, assetId);
    if (!pre) throw new AssetNotFoundError(assetId);
    if (pre.ownerUserId !== actor.userId) throw new MaintenanceNotYourMachineError();
    const today = await this.repo.tenantDay(tenantId, new Date().toISOString());
    if (dto.performedOn > today) throw new MaintenanceDateInFutureError(today);
    return this.idem.remember(idemKey, actor.userId, 'equipment.maintenance.record', () =>
      this.uow.run(tenantId, async (tx) => {
        const asset = await this.assets.getById(tenantId, assetId, tx);
        if (!asset) throw new AssetNotFoundError(assetId);
        if (asset.ownerUserId !== actor.userId) throw new MaintenanceNotYourMachineError();
        const entry = { id: uuidv7(), assetId, logType: dto.logType, costMinor: dto.costMinor ?? null, notes: dto.notes ?? null,
          engineHoursAt: dto.engineHoursAt ?? null, performedOn: dto.performedOn };
        await this.repo.insertLog(tx, { ...entry, tenantId });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'equipment.maintenance.recorded', entityType: 'equipment_maintenance_log', entityId: entry.id,
          oldValue: null, newValue: entry, ip });
        return entry;
      }, { userId: actor.userId }));
  }

  /** The machine's owner only; anyone else (an administrator too) → 404, so a stranger learns nothing about the machine. */
  async logs(tenantId: string, actor: MaintenanceActor, assetId: string) {
    const asset = await this.assets.getById(tenantId, assetId);
    if (!asset || asset.ownerUserId !== actor.userId) throw new AssetNotFoundError(assetId);
    return this.repo.listLogs(tenantId, assetId);
  }
  /** The caller's own machines; `booking.manage` keeps the organisation's view. */
  alerts(tenantId: string, actor: MaintenanceActor) { return this.repo.alerts(tenantId, actor.isAdmin ? null : actor.userId); }
}
