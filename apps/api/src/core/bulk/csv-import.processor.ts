// core/bulk/csv-import.processor.ts · the engine that turns a pending job into applied rows. Runs in apps/worker
// (off the queue) or on-demand. Flow: CLAIM the job (pending→processing, FOR UPDATE so two workers can't both
// run it) → fetch the CSV from the object store (resilience-wrapped) → parse (bounded) → validate the applier's
// required columns (fail the whole job if missing) → apply each row through the registered applier with a
// DETERMINISTIC per-row idempotency key (so a re-run never double-creates) → record per-row failures (capped) →
// finish (completed / partially_completed / failed). Each row-apply runs in the applier's OWN tx (no nesting);
// progress + error writes are their own short txs. Bounded throughout (Law 5/12).
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../observability/metrics';
import { OBJECT_STORE } from '../media/s3-presign.service';
import type { ObjectStore } from '../media/s3-presign.service';
import { BulkImportJobRepository } from './bulk-import-job.repository';
import { BulkResultStore, MAX_RECORDED_ERRORS } from './bulk-result.store';
import { BULK_APPLIER_REGISTRY, BulkApplierRegistry } from './bulk-applier.registry';
import { parseCsv, recordToRow } from './csv-parser';
import { DomainEvent } from './domain/bulk-import.events';
import { CsvParseError, MissingColumnsError } from './domain/bulk-import.errors';
import type { ValidationReport } from './domain/bulk-import-job.entity';
import { BulkImportJob } from './domain/bulk-import-job.entity';

const PROGRESS_EVERY = 100;
/** How many row-level issues the triage carries. The console shows them and the operator fixes the FILE, so a hundred
 *  entries help nobody — W156 itself shows "Showing 2 flagged of 220 rows". Same reasoning as MAX_RECORDED_ERRORS. */
export const MAX_VALIDATION_ISSUES = 50;

export interface ProcessResult { jobId: string; status: string; succeeded: number; failed: number; skipped?: boolean; }

@Injectable()
export class BulkImportProcessor {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    @Inject(BULK_APPLIER_REGISTRY) private readonly registry: BulkApplierRegistry,
    private readonly repo: BulkImportJobRepository,
    private readonly results: BulkResultStore,
  ) {}

  /**
   * THE VALIDATE-FIRST PASS (PC-56 TENANT-1b-4, W156's "validates every row first").
   *
   * **IT WRITES NOTHING EXCEPT THE REPORT.** No user is created, no role granted, no invite queued. The whole point is that
   * an operator can find out what a file would do without letting it do it — on a member register the alternative is 220
   * half-created people and a phone call from every one of them.
   *
   * The file HASH is computed here, from the bytes actually read (W156: "every import batch is recorded with the file
   * hash"). An object-store key is not evidence: two uploads of a corrected file share neither key nor hash, and nothing
   * previously recorded WHICH bytes were applied.
   *
   * **AN APPLIER WITHOUT `validateRow` CANNOT BE VALIDATED, AND SAYS SO RATHER THAN REPORTING A CLEAN FILE.** A pass that
   * silently concluded "220 valid" because nobody had written a checker would be the worst possible answer here.
   */
  async validate(tenantId: string, jobId: string): Promise<{ jobId: string; status: string; report?: ValidationReport }> {
    return timed(this.metrics, 'bulk.import.validate', { tenant: tenantId }, async () => {
      // **THE CLAIM REPORTS WHETHER *THIS* CALL WON IT, NOT MERELY WHAT STATE THE JOB IS IN — AND MY OWN TEST FOUND WHY.**
      // The first version checked `claimed.status !== 'validating'` afterwards, which is true both for a job this call just
      // claimed AND for a job another worker claimed a second earlier. So two workers would both have run the pass and both
      // written a report. The pass writes nothing but the report, so the damage was bounded — but the operator would have
      // been shown whichever report landed last, from whichever read of the register.
      const claim = await this.uow.run(tenantId, async (tx) => {
        const job = await this.repo.getForUpdate(tx, tenantId, jobId);
        if (!job) return { job: null as BulkImportJob | null, mine: false };
        if (job.status !== 'pending') return { job, mine: false };   // never re-validate in place
        job.beginValidation();
        await this.repo.update(tx, job);
        return { job, mine: true };
      });
      if (!claim.job) return { jobId, status: 'not_found' };
      const claimed = claim.job;
      if (!claim.mine) return { jobId, status: claimed.status };

      const applier = this.registry.get(claimed.importType);
      let header: string[]; let records: string[][]; let sha256: string;
      try {
        if (!applier) throw new CsvParseError(`no applier for "${claimed.importType}"`);
        if (!applier.validateRow) throw new CsvParseError(`"${claimed.importType}" imports cannot be validated before running`);
        const bytes = await this.objects.getObject(claimed.storageKey);
        sha256 = createHash('sha256').update(bytes).digest('hex');
        ({ header, records } = parseCsv(bytes.toString('utf8')));
        const mapping = claimed.toProps().columnMapping;
        const effective = new Set(header.map((h) => mapping[h] ?? h));
        const missing = applier.requiredColumns.filter((c) => !effective.has(c));
        if (missing.length) throw new MissingColumnsError(missing);
      } catch (err: any) {
        await this.finishFatal(tenantId, jobId, err?.message ?? 'validation failed');
        return { jobId, status: 'failed' };
      }

      const mapping = claimed.toProps().columnMapping;
      const ctx = { tenantId, actorUserId: claimed.requestedBy ?? '' };
      const report: ValidationReport = {
        totalRows: records.length, willCreate: 0, alreadyMembers: 0, fixable: 0, invalid: 0,
        issues: [], issuesTruncated: false,
      };
      for (let i = 0; i < records.length; i++) {
        const rowIndex = i + 1;
        const { row, lengthMismatch } = recordToRow(header, records[i]);
        const mapped = this.applyMapping(row, mapping);
        // A ragged row is INVALID rather than fixable: the columns do not line up, so every value after the gap is
        // attributed to the wrong field and a suggestion would be a guess about which.
        const verdict = lengthMismatch
          ? { kind: 'invalid' as const, code: 'ROW_SHAPE', message: 'column count does not match header' }
          : await applier!.validateRow!(ctx, rowIndex, mapped);

        if (verdict.kind === 'create') report.willCreate++;
        else if (verdict.kind === 'duplicate') report.alreadyMembers++;
        else {
          if (verdict.kind === 'fixable') report.fixable++; else report.invalid++;
          if (report.issues.length < MAX_VALIDATION_ISSUES) {
            report.issues.push({
              rowIndex, code: verdict.code, message: verdict.message,
              ...(verdict.kind === 'fixable' && verdict.suggestion ? { suggestion: verdict.suggestion } : {}),
            });
          } else {
            report.issuesTruncated = true;
          }
        }
      }

      const parked = await this.uow.run(tenantId, async (tx) => {
        const job = await this.repo.getForUpdate(tx, tenantId, jobId);
        // Cancelled mid-validation → leave it cancelled. The operator changed their mind and the report is moot.
        if (!job || job.status !== 'validating') return job?.status ?? 'unknown';
        job.completeValidation(report, sha256);
        await this.repo.update(tx, job);
        await this.flush(tx, tenantId, jobId, job.pullEvents());
        return job.status;
      });
      this.metrics.inc('bulk.import.validated', { tenant: tenantId, create: String(report.willCreate) });
      return { jobId, status: parked, report };
    });
  }

  async process(tenantId: string, jobId: string): Promise<ProcessResult> {
    return timed(this.metrics, 'bulk.import.process', { tenant: tenantId }, async () => {
      // 1) CLAIM: pending → processing under a row lock (idempotent; a second worker sees processing and skips).
      const claimed = await this.uow.run(tenantId, async (tx) => {
        const job = await this.repo.getForUpdate(tx, tenantId, jobId);
        if (!job) return null;
        // PC-56 TENANT-1b-4: `pending` (an applier with no validator) OR `validated` (the operator pressed the button).
        // A job in any other state has been claimed, cancelled or finished, and re-running it is what the lock prevents.
        if (job.status !== 'pending' && job.status !== 'validated') return job;
        job.begin(0);
        await this.repo.update(tx, job);
        return job;
      });
      if (!claimed) return { jobId, status: 'not_found', succeeded: 0, failed: 0, skipped: true };
      if (claimed.status !== 'processing') return { jobId, status: claimed.status, succeeded: 0, failed: 0, skipped: true };

      const importType = claimed.importType;
      const applier = this.registry.get(importType);
      const mapping = claimed.toProps().columnMapping;
      const actorUserId = claimed.requestedBy ?? '';

      // 2) Fetch + parse (fatal failures fail the whole job).
      let header: string[]; let records: string[][];
      try {
        if (!applier) throw new CsvParseError(`no applier for "${importType}"`);
        const bytes = await this.objects.getObject(claimed.storageKey);
        // **THE HASH IS CHECKED, NOT JUST RECORDED.** A file swapped in the object store between the validation an operator
        // approved and the import they confirmed would otherwise apply bytes nobody reviewed — the report said 214 members
        // and the file now says something else. `recordFileHash` returns false on a mismatch and the job fails, which is
        // the only safe answer: the operator re-uploads and re-validates.
        if (!claimed.recordFileHash(createHash('sha256').update(bytes).digest('hex'))) {
          throw new CsvParseError('the file changed after it was validated — please upload and validate it again');
        }
        ({ header, records } = parseCsv(bytes.toString('utf8')));
        const effective = new Set(header.map((h) => mapping[h] ?? h));
        const missing = applier.requiredColumns.filter((c) => !effective.has(c));
        if (missing.length) throw new MissingColumnsError(missing);
      } catch (err: any) {
        await this.finishFatal(tenantId, jobId, err?.message ?? 'import failed');
        return { jobId, status: 'failed', succeeded: 0, failed: 0 };
      }

      // 3) Apply each row.
      let succeeded = 0; let failed = 0; let recorded = 0;
      for (let i = 0; i < records.length; i++) {
        const rowIndex = i + 1;                                  // 1-based, header excluded
        const { row, lengthMismatch } = recordToRow(header, records[i]);
        const mapped = this.applyMapping(row, mapping);
        if (lengthMismatch) {
          failed++; recorded = await this.maybeRecord(tenantId, jobId, rowIndex, 'ROW_SHAPE', 'column count does not match header', mapped, recorded);
          continue;
        }
        try {
          await applier!.applyRow({ tenantId, actorUserId }, `bulkrow:${jobId}:${rowIndex}`, mapped);
          succeeded++;
        } catch (err: any) {
          failed++;
          recorded = await this.maybeRecord(tenantId, jobId, rowIndex, err?.code ?? 'ROW_ERROR', err?.message ?? 'row failed', mapped, recorded);
        }
        if ((i + 1) % PROGRESS_EVERY === 0) await this.updateProgress(tenantId, jobId, i + 1, succeeded, failed);
      }

      // 4) Finish.
      const finalStatus = await this.finishJob(tenantId, jobId, records.length, succeeded, failed);
      this.metrics.inc('bulk.import.finished', { tenant: tenantId, status: finalStatus });
      return { jobId, status: finalStatus, succeeded, failed };
    });
  }

  private applyMapping(row: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
    if (!mapping || Object.keys(mapping).length === 0) return row;
    const out: Record<string, string> = { ...row };
    for (const [csvCol, field] of Object.entries(mapping)) if (csvCol in row) out[field] = row[csvCol];
    return out;
  }
  private async maybeRecord(tenantId: string, jobId: string, rowIndex: number, code: string, message: string, raw: Record<string, unknown>, recorded: number): Promise<number> {
    if (recorded >= MAX_RECORDED_ERRORS) return recorded;
    await this.uow.run(tenantId, (tx) => this.results.recordError(tx, { tenantId, jobId, rowIndex, errorCode: code, errorMessage: message, raw }));
    return recorded + 1;
  }
  private async updateProgress(tenantId: string, jobId: string, processed: number, succeeded: number, failed: number): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const job = await this.repo.getForUpdate(tx, tenantId, jobId);
      if (!job || job.status !== 'processing') return;
      job.recordProgress(processed, succeeded, failed);
      await this.repo.update(tx, job);
    });
  }
  private async finishJob(tenantId: string, jobId: string, total: number, succeeded: number, failed: number): Promise<string> {
    return this.uow.run(tenantId, async (tx) => {
      const job = await this.repo.getForUpdate(tx, tenantId, jobId);
      if (!job || job.status !== 'processing') return job?.status ?? 'unknown';   // cancelled mid-run → leave it
      job.setTotalRows(total); job.recordProgress(total, succeeded, failed); job.finish();
      await this.repo.update(tx, job);
      await this.flush(tx, tenantId, jobId, job.pullEvents());
      return job.status;
    });
  }
  private async finishFatal(tenantId: string, jobId: string, summary: string): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const job = await this.repo.getForUpdate(tx, tenantId, jobId);
      // PC-56 TENANT-1b-4: an unparseable file can now fail during VALIDATION as well as during processing, and both are
      // legal sources of `failed` in the state machine. Checking only `processing` would leave a broken validation stuck
      // in `validating` forever, holding a slot against the per-tenant cap.
      if (!job || (job.status !== 'processing' && job.status !== 'validating')) return;
      job.fail(summary);
      await this.repo.update(tx, job);
      await this.flush(tx, tenantId, jobId, job.pullEvents());
    });
  }
  private async flush(tx: TxContext, tenantId: string, jobId: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'bulk_import_job', aggregateId: jobId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
