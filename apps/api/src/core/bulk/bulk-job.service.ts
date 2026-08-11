// core/bulk/bulk-job.service.ts · the bulk-import job lifecycle use-cases (create / read / list / errors /
// cancel). Generic plumbing — no business logic about WHAT is imported (that's the registered applier). One
// ACID tx per write, outbox in-tx (Law 4), idempotent create (Law 3), audit on create/cancel. Tenant-scoped
// reads (404 for a non-member, no cross-tenant enumeration). Fail-closed: unknown import type → 422.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../observability/metrics';
import { AuditWriter } from '../audit/audit.writer';
import { uuidv7 } from '../database/uuid.util';
import { BulkImportJob } from './domain/bulk-import-job.entity';
import { DomainEvent } from './domain/bulk-import.events';
import { BulkImportJobRepository } from './bulk-import-job.repository';
import { BulkResultStore } from './bulk-result.store';
import { BULK_APPLIER_REGISTRY, BulkApplierRegistry } from './bulk-applier.registry';
import { BulkJobNotFoundError, UnknownImportTypeError, TooManyActiveJobsError } from './domain/bulk-import.errors';
import { isActive } from './domain/bulk-import.state';
import { CreateBulkImportDto } from './dto/bulk-import.dto';

export interface BulkActor { userId: string; canImport: boolean; }
const MAX_ACTIVE_JOBS = 5;   // per tenant — bound abuse / resource use

@Injectable()
export class BulkJobService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(BULK_APPLIER_REGISTRY) private readonly registry: BulkApplierRegistry,
    private readonly audit: AuditWriter,
    private readonly repo: BulkImportJobRepository,
    private readonly results: BulkResultStore,
  ) {}

  async create(tenantId: string, actor: BulkActor, idemKey: string, dto: CreateBulkImportDto, ip: string | null) {
    if (!actor.canImport) throw new BulkJobNotFoundError('forbidden');   // never reached if controller guards; defence in depth
    if (!this.registry.has(dto.importType)) throw new UnknownImportTypeError(dto.importType);
    return this.idem.remember(idemKey, actor.userId, 'bulk.import.create', () =>
      timed(this.metrics, 'bulk.import.create', { tenant: tenantId }, async () => {
        if (await this.repo.countActive(tenantId) >= MAX_ACTIVE_JOBS) throw new TooManyActiveJobsError(MAX_ACTIVE_JOBS);
        const job = BulkImportJob.create({ id: uuidv7(), tenantId, importType: dto.importType, storageKey: dto.storageKey,
          originalFilename: dto.originalFilename ?? null, columnMapping: dto.columnMapping, requestedBy: actor.userId });
        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, job);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'bulk.import.created', entityType: 'bulk_import_job', entityId: job.id, newValue: { importType: dto.importType, storageKey: dto.storageKey }, ip });
          await this.flush(tx, tenantId, job.id, job.pullEvents());
          return job.toJSON();
        }, { userId: actor.userId });
      }));
  }

  async getById(tenantId: string, actor: BulkActor, id: string) {
    if (!actor.canImport) throw new BulkJobNotFoundError(id);
    const job = await this.repo.getById(tenantId, id);
    if (!job) throw new BulkJobNotFoundError(id);
    return job.toJSON();
  }
  async list(tenantId: string, actor: BulkActor, q: { status?: any; cursor?: { c: string; id: string }; limit: number }) {
    if (!actor.canImport) throw new BulkJobNotFoundError('forbidden');
    const rows = await this.repo.listFor(tenantId, q);
    const items = rows.map((j) => j.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  async listErrors(tenantId: string, actor: BulkActor, id: string, q: { afterRow?: number; limit: number }) {
    await this.getById(tenantId, actor, id);   // 404 gate (also enforces authz)
    return { items: await this.results.listErrors(tenantId, id, q) };
  }
  /**
   * CONFIRM a validated job (PC-56 TENANT-1b-4, W156's "Import 214 valid rows" button).
   *
   * **THE CONFIRM IS AN AUDITED ACT, NOT A STATUS POKE.** A staff member looked at a triage and decided that 214 people
   * should be added to a register. The audit row carries the counts they were shown, so a dispute six months later reads
   * "they were told 214 create / 4 duplicate / 2 fixable and pressed the button" rather than "somebody ran an import".
   *
   * It does NOT do the work: it moves `validated → processing` and the processor picks the job up, exactly like every other
   * import. Doing the work inline would put 220 member creations on an HTTP request.
   */
  async confirm(tenantId: string, actor: BulkActor, id: string, ip: string | null) {
    if (!actor.canImport) throw new BulkJobNotFoundError(id);
    return timed(this.metrics, 'bulk.import.confirm', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const job = await this.repo.getForUpdate(tx, tenantId, id);
        if (!job) throw new BulkJobNotFoundError(id);
        const report = job.validation;
        // `begin` asserts the transition, so a job that is pending, cancelled or already running is refused by the state
        // machine rather than by a guess here.
        job.begin(report?.totalRows ?? 0);
        await this.repo.update(tx, job);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'bulk.import.confirmed',
          entityType: 'bulk_import_job', entityId: id,
          newValue: {
            fileSha256: job.fileSha256,
            shown: report
              ? { totalRows: report.totalRows, willCreate: report.willCreate, alreadyMembers: report.alreadyMembers, fixable: report.fixable, invalid: report.invalid }
              : null,
          },
          ip,
        });
        await this.flush(tx, tenantId, id, job.pullEvents());
        return job.toJSON();
      }, { userId: actor.userId }));
  }

  async cancel(tenantId: string, actor: BulkActor, id: string, ip: string | null) {
    if (!actor.canImport) throw new BulkJobNotFoundError(id);
    return timed(this.metrics, 'bulk.import.cancel', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const job = await this.repo.getForUpdate(tx, tenantId, id);
        if (!job) throw new BulkJobNotFoundError(id);
        job.cancel();   // throws IllegalBulkTransitionError if already terminal
        await this.repo.update(tx, job);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'bulk.import.cancelled', entityType: 'bulk_import_job', entityId: id, ip });
        return job.toJSON();
      }, { userId: actor.userId }));
  }
  /** Is a job still cancellable/active? (used by the controller to surface 409 cleanly) */
  isActiveStatus(status: any): boolean { return isActive(status); }

  private async flush(tx: TxContext, tenantId: string, jobId: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'bulk_import_job', aggregateId: jobId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
