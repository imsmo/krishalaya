// modules/schemes/services/dbt-bounce.service.ts · PC-55 A3. The bounce desk.
// LAWS: Process-gated; the AMOUNT is never typed (it is the parent transfer's own amount — a returned credit
// returns exactly what was credited); one OPEN bounce per transfer (DB unique); idempotent record (Law 3);
// resolution demands its evidence (recredit → a real replacement transfer id; abandon → a written reason);
// every step audit-written. The PFMS port is consulted for the honest "provider pending" note — it never
// invents a reconciliation and never moves money.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { DbtBounceRepository } from '../repositories/dbt-bounce.repository';
import { PFMS_PROVIDER, PfmsProvider } from '../providers/pfms.provider';
import {
  canResolve, reasonNoteRequired, resolutionNoteRequired, recreditRefRequired, bounceDateSane,
  type BounceResolution,
} from '../domain/dbt-bounce.rules';

export interface BounceActor { userId: string; canProcess: boolean }

@Injectable()
export class DbtBounceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: DbtBounceRepository,
    private readonly audit: AuditWriter,
    @Inject(PFMS_PROVIDER) private readonly pfms: PfmsProvider,
  ) {}
  private assert(a: BounceActor) { if (!a.canProcess) throw new ForbiddenError('requires scheme.process'); }

  /** Record that a credit came back. The transfer stays untouched (append-only truth); this is a NEW fact. */
  async record(tenantId: string, a: BounceActor, transferId: string, key: string, dto: { reasonCode: string; reasonNote?: string; bouncedOn: string; bankRef?: string }, ip: string | null) {
    this.assert(a);
    if (reasonNoteRequired(dto.reasonCode) && !dto.reasonNote?.trim()) {
      throw new BadRequestError("reasonNote is required when reasonCode is 'other' (record the bank's own words)");
    }
    const id = uuidv7();
    return this.uow.run(tenantId, async (tx) => {
      const transfer = await this.repo.findTransfer(tx, tenantId, transferId);
      if (!transfer) throw new NotFoundError('dbt transfer not found');
      const today = new Date().toISOString().slice(0, 10);
      if (!bounceDateSane(dto.bouncedOn, transfer.createdAt, today)) {
        throw new BadRequestError('bouncedOn must be YYYY-MM-DD, on/after the credit date, and not in the future');
      }
      const ins = await this.repo.insert(tx, {
        id, tenantId: tenantId || null, transfer, reasonCode: dto.reasonCode, reasonNote: dto.reasonNote,
        bouncedOn: dto.bouncedOn, bankRef: dto.bankRef, recordedBy: a.userId, idempotencyKey: key,
      });
      if (!ins.ok) {
        throw new ConflictError(ins.conflict === 'replay'
          ? 'this bounce was already recorded (idempotency-key replay)'
          : 'this transfer already has an OPEN bounce — resolve it before recording another');
      }
      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: 'schemes.dbt_bounce_recorded', entityType: 'dbt_bounce', entityId: id,
        oldValue: null, newValue: { transferId, schemeId: transfer.schemeId, amountMinor: transfer.amountMinor, reasonCode: dto.reasonCode, bouncedOn: dto.bouncedOn }, reason: dto.reasonNote ?? null, ip,
      });
      return { id, transferId, amountMinor: transfer.amountMinor, resolution: 'open' as const };
    }, { userId: a.userId });
  }

  /** Close a bounce: recredited (naming the replacement transfer) or abandoned (with a written reason). */
  async resolve(tenantId: string, a: BounceActor, id: string, dto: { resolution: 'recredited' | 'abandoned'; note?: string; recreditTransferId?: string }, ip: string | null) {
    this.assert(a);
    if (resolutionNoteRequired(dto.resolution) && !dto.note?.trim()) {
      throw new BadRequestError('a written reason is required to abandon a returned benefit');
    }
    if (recreditRefRequired(dto.resolution) && !dto.recreditTransferId) {
      throw new BadRequestError('recreditTransferId is required — name the replacement credit, never claim one');
    }
    return this.uow.run(tenantId, async (tx) => {
      const b = await this.repo.lock(tx, tenantId, id);
      if (!b) throw new NotFoundError('bounce not found');
      if (!canResolve(b.resolution as BounceResolution, dto.resolution)) {
        throw new ConflictError(`a ${b.resolution} bounce cannot be marked ${dto.resolution}`);
      }
      if (dto.recreditTransferId) {
        const rc = await this.repo.findTransfer(tx, tenantId, dto.recreditTransferId);
        if (!rc) throw new BadRequestError('recreditTransferId does not match a recorded transfer');
        if (rc.id === b.id) throw new BadRequestError('the replacement credit cannot be the bounced one');
      }
      await this.repo.resolve(tx, tenantId, id, dto.resolution, a.userId, dto.note, dto.recreditTransferId);
      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: `schemes.dbt_bounce_${dto.resolution}`, entityType: 'dbt_bounce', entityId: id,
        oldValue: { resolution: b.resolution }, newValue: { resolution: dto.resolution, recreditTransferId: dto.recreditTransferId ?? null, amountMinor: b.amount_minor }, reason: dto.note ?? null, ip,
      });
      return { id, resolution: dto.resolution };
    }, { userId: a.userId });
  }

  list(tenantId: string, a: BounceActor, q: { resolution?: string; schemeId?: string; reasonCode?: string; limit: number }) {
    this.assert(a);
    return this.repo.list(tenantId, q);
  }
  forApplication(tenantId: string, a: BounceActor, applicationId: string) {
    this.assert(a);
    return this.repo.openByApplication(tenantId, applicationId);
  }

  /** The desk header: per-scheme bounce stats + the HONEST provider state (never a fabricated recon). */
  async desk(tenantId: string, a: BounceActor) {
    this.assert(a);
    const [byScheme, provider] = await Promise.all([
      this.repo.statsByScheme(tenantId),
      this.pfms.fetchRecon({ schemeId: '', from: new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }),
    ]);
    return {
      byScheme,
      pfms: { provider: this.pfms.name, available: provider.providerAvailable, note: provider.note, fetchedAt: provider.fetchedAt, pulledRecords: provider.records.length },
    };
  }
}
