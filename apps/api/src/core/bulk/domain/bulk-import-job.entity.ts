// core/bulk/domain/bulk-import-job.entity.ts · a bulk import job (bulk_import_jobs, tenant-scoped). Pure domain.
// Tracks the CSV source (object-store key) + progress counters; status moves ONLY through bulk-import.state.ts
// (Law 5). No version column → the processor locks the row FOR UPDATE while it runs.
import { BulkStatus, DomainEvent, BulkImportEventType } from './bulk-import.events';
import { assertTransition, terminalFor } from './bulk-import.state';

export interface BulkImportJobProps {
  id: string; tenantId: string; importType: string; storageKey: string; originalFilename: string | null;
  status: BulkStatus; totalRows: number; processedRows: number; succeededRows: number; failedRows: number;
  columnMapping: Record<string, string>; requestedBy: string | null; errorSummary: string | null;
  startedAt: Date | null; finishedAt: Date | null; createdAt?: Date;
  // PC-56 TENANT-1b-4 (0129). The hash of the bytes actually read, and the validate-first triage.
  fileSha256?: string | null; validatedAt?: Date | null; validation?: ValidationReport | null;
}

/**
 * W156's triage, as a shape (PC-56 TENANT-1b-4).
 *
 * **`willCreate + alreadyMembers + fixable + invalid` MUST EQUAL `totalRows`**, and a test holds that: a triage whose parts
 * do not add up to the file is a triage an operator cannot reason about, and the arithmetic is the only thing standing
 * between "214 valid of 220" and a number somebody made up.
 */
export interface ValidationReport {
  totalRows: number;
  willCreate: number;
  /** Matched by phone — skipped, never duplicated. NOT a failure. */
  alreadyMembers: number;
  fixable: number;
  invalid: number;
  /** Capped: the console shows the first few and the operator fixes the file, exactly like bulk_import_errors. */
  issues: { rowIndex: number; code: string; message: string; suggestion?: string }[];
  /** True when the list above was truncated, so the screen can say "showing 2 of 40" rather than implying 2. */
  issuesTruncated: boolean;
}
export class BulkImportJob {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: BulkImportJobProps) {}

  static create(input: { id: string; tenantId: string; importType: string; storageKey: string; originalFilename?: string | null; columnMapping?: Record<string, string>; requestedBy: string; }): BulkImportJob {
    const j = new BulkImportJob({ id: input.id, tenantId: input.tenantId, importType: input.importType, storageKey: input.storageKey,
      originalFilename: input.originalFilename ?? null, status: 'pending', totalRows: 0, processedRows: 0, succeededRows: 0, failedRows: 0,
      columnMapping: input.columnMapping ?? {}, requestedBy: input.requestedBy, errorSummary: null, startedAt: null, finishedAt: null });
    j.events.push({ type: BulkImportEventType.Created, payload: { jobId: j.props.id, importType: j.props.importType } });
    return j;
  }
  static rehydrate(p: BulkImportJobProps): BulkImportJob { return new BulkImportJob(p); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get importType() { return this.props.importType; }
  get storageKey() { return this.props.storageKey; }
  get requestedBy() { return this.props.requestedBy; }
  get fileSha256() { return this.props.fileSha256 ?? null; }
  get validation() { return this.props.validation ?? null; }
  toProps(): Readonly<BulkImportJobProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Claim the job for a VALIDATION pass. Separate from `begin` because the two do different things and the state machine
   *  must be able to tell them apart — a job that died during validation has written nothing. */
  beginValidation(now = new Date()): void {
    assertTransition(this.props.status, 'validating');
    this.props.status = 'validating';
    this.props.startedAt = now;
  }

  /**
   * Record the triage and park the job until somebody confirms.
   *
   * **THE HASH IS SET HERE AND NEVER OVERWRITTEN LATER**: it is the hash of the bytes this report describes, so a file
   * swapped in the object store between validation and import would produce a mismatch the processor can refuse rather
   * than a silent substitution.
   */
  completeValidation(report: ValidationReport, fileSha256: string, now = new Date()): void {
    assertTransition(this.props.status, 'validated');
    this.props.status = 'validated';
    this.props.validation = report;
    this.props.fileSha256 = fileSha256;
    this.props.validatedAt = now;
    this.props.totalRows = report.totalRows;
  }

  begin(totalRows: number, now = new Date()): void {
    assertTransition(this.props.status, 'processing');
    this.props.status = 'processing'; this.props.totalRows = totalRows; this.props.startedAt = now;
  }
  setTotalRows(n: number): void { this.props.totalRows = n; }
  recordProgress(processed: number, succeeded: number, failed: number): void {
    this.props.processedRows = processed; this.props.succeededRows = succeeded; this.props.failedRows = failed;
  }
  finish(now = new Date()): void {
    const to = terminalFor(this.props.succeededRows, this.props.failedRows);
    assertTransition(this.props.status, to);
    this.props.status = to; this.props.finishedAt = now;
    this.events.push({ type: BulkImportEventType.Completed, payload: { jobId: this.props.id, status: to, succeeded: this.props.succeededRows, failed: this.props.failedRows, total: this.props.totalRows } });
  }
  fail(summary: string, now = new Date()): void {
    assertTransition(this.props.status, 'failed');
    this.props.status = 'failed'; this.props.errorSummary = summary.slice(0, 1000); this.props.finishedAt = now;
    this.events.push({ type: BulkImportEventType.Completed, payload: { jobId: this.props.id, status: 'failed', succeeded: this.props.succeededRows, failed: this.props.failedRows } });
  }
  cancel(now = new Date()): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled'; this.props.finishedAt = now;
  }
  /** Set once, when the bytes are first read. Returns false when a DIFFERENT hash arrives — see `completeValidation`. */
  recordFileHash(sha256: string): boolean {
    if (this.props.fileSha256 && this.props.fileSha256 !== sha256) return false;
    this.props.fileSha256 = sha256;
    return true;
  }

  toJSON() {
    const v = this.props;
    return { id: v.id, importType: v.importType, originalFilename: v.originalFilename, status: v.status,
      totalRows: v.totalRows, processedRows: v.processedRows, succeededRows: v.succeededRows, failedRows: v.failedRows,
      errorSummary: v.errorSummary, startedAt: v.startedAt, finishedAt: v.finishedAt, createdAt: v.createdAt };
  }
}
