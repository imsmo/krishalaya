// core/exports-plane/domain/export-job.entity.ts · one export a person asked for (tenant_export_jobs). Pure domain:
// no I/O, every invariant here, every status hop through `export-job.state.ts` (Law 5).
import { LangMap } from '../../i18n/lang-map';
import { assertTransition, ExportStatus } from './export-job.state';
import { ExportDomainEvent, ExportEventType } from './export-plane.events';

/**
 * HOW LONG A FILE IS SERVED AFTER IT IS MADE: seven days.
 *
 * A CONSTANT AND NOT A TENANT SETTING, for now, and here is the reason rather than a shrug: the number is a promise the
 * platform makes about its own object store's lifecycle rule (infra removes the bytes after the same period), and a
 * per-tenant value would make that rule per-tenant too. Seven days covers "export it Friday, open it in Monday's board
 * meeting" and does not leave a cooperative's member-level file sitting in a bucket for a quarter. When a tenant asks
 * for longer, this becomes a `setting_definitions` row AND an infra change together — never one without the other.
 */
export const EXPORT_FILE_RETENTION_DAYS = 7;

/**
 * HOW MANY TIMES A JOB MAY BE CLAIMED before it is failed with `too_many_attempts`. A job that has crashed the worker
 * twice will crash it a third time; releasing it a third time would let one bad file hold the queue's head forever.
 */
export const EXPORT_MAX_ATTEMPTS = 3;

export const EXPORT_FAILURE_CODES = [
  'unknown_dataset', 'dataset_disabled', 'money_shape_missing', 'producer_failed', 'storage_failed', 'too_many_attempts',
] as const;
export type ExportFailureCode = (typeof EXPORT_FAILURE_CODES)[number];

/** What the worker hands back when the file is written: W2554's receipt, every field required. */
export interface ExportReceipt {
  fileName: string;
  contentType: string;
  /** DATA rows. The header line is not a row. */
  rowCount: number;
  sha256: string;
  byteSize: number;
  storageKey: string;
  /** What the file admits — the producer's own notes (refused figures, bounds). Never empty for a producer that refuses anything. */
  notes: readonly string[];
}

export interface ExportJobProps {
  id: string; tenantId: string; datasetCode: string; params: Record<string, unknown>; paramsSha256: string;
  requestedBy: string; status: ExportStatus; attempts: number;
  queuedAt: Date; startedAt: Date | null; generatedAt: Date | null; failedAt: Date | null; expiredAt: Date | null;
  expiresAt: Date | null;
  rowCount: number | null; contentSha256: string | null; fileName: string | null; byteSize: number | null;
  contentType: string | null; storageKey: string | null; notes: readonly string[];
  failureCode: ExportFailureCode | null; failureDetail: string | null; version: number;
}

const SHA256_RE = /^[0-9a-f]{64}$/;

export class ExportJob {
  private readonly events: ExportDomainEvent[] = [];
  private constructor(private props: ExportJobProps) {}

  static create(input: { id: string; tenantId: string; datasetCode: string; params: Record<string, unknown>; paramsSha256: string; requestedBy: string; now?: Date }): ExportJob {
    if (!SHA256_RE.test(input.paramsSha256)) throw new Error('paramsSha256 must be a lowercase hex sha256');
    const j = new ExportJob({
      id: input.id, tenantId: input.tenantId, datasetCode: input.datasetCode, params: input.params, paramsSha256: input.paramsSha256,
      requestedBy: input.requestedBy, status: 'queued', attempts: 0,
      queuedAt: input.now ?? new Date(), startedAt: null, generatedAt: null, failedAt: null, expiredAt: null, expiresAt: null,
      rowCount: null, contentSha256: null, fileName: null, byteSize: null, contentType: null, storageKey: null, notes: [],
      failureCode: null, failureDetail: null, version: 1,
    });
    j.events.push({ type: ExportEventType.Queued, payload: { jobId: j.props.id, dataset: j.props.datasetCode, userId: j.props.requestedBy } });
    return j;
  }
  static rehydrate(p: ExportJobProps): ExportJob { return new ExportJob(p); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get status() { return this.props.status; }
  get datasetCode() { return this.props.datasetCode; }
  get params() { return this.props.params; }
  get requestedBy() { return this.props.requestedBy; }
  get attempts() { return this.props.attempts; }
  get storageKey() { return this.props.storageKey; }
  get contentSha256() { return this.props.contentSha256; }
  get expiresAt() { return this.props.expiresAt; }
  toProps(): Readonly<ExportJobProps> { return Object.freeze({ ...this.props, notes: [...this.props.notes] }); }
  pullEvents(): ExportDomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** The worker takes it. `attempts` counts every claim, so a job that keeps dying is failed rather than retried forever. */
  claim(now = new Date()): void {
    assertTransition(this.props.status, 'running');
    if (this.props.attempts >= EXPORT_MAX_ATTEMPTS) {
      // Fail it HERE rather than run it again: the claim is the last moment before the third crash.
      this.props = { ...this.props, status: 'failed', failedAt: now, failureCode: 'too_many_attempts',
        failureDetail: `claimed ${this.props.attempts} times without finishing`, version: this.props.version + 1 };
      this.events.push({ type: ExportEventType.Failed, payload: { jobId: this.props.id, dataset: this.props.datasetCode, userId: this.props.requestedBy, code: 'too_many_attempts' } });
      return;
    }
    this.props = { ...this.props, status: 'running', startedAt: now, attempts: this.props.attempts + 1, version: this.props.version + 1 };
  }

  /** A claim whose pod died: back to the queue, at its ORIGINAL `queuedAt` so it does not lose its place. */
  release(): void {
    assertTransition(this.props.status, 'queued');
    this.props = { ...this.props, status: 'queued', startedAt: null, version: this.props.version + 1 };
  }

  /**
   * The file exists. Every receipt field is required and checked, because a `ready` row missing one is exactly what
   * 0169's `ck_texp_ready` refuses — the entity refuses it first, with a better message.
   *
   * `datasetName` is the notice's per-language word for the dataset (seed 0017); it rides in the event payload and not
   * on the row, because the row holds the CODE and the notice needs the WORD.
   */
  succeed(receipt: ExportReceipt, datasetName: LangMap, now = new Date(), retentionDays = EXPORT_FILE_RETENTION_DAYS): void {
    assertTransition(this.props.status, 'ready');
    if (!SHA256_RE.test(receipt.sha256)) throw new Error('receipt.sha256 must be a lowercase hex sha256');
    if (!Number.isInteger(receipt.rowCount) || receipt.rowCount < 0) throw new Error('receipt.rowCount must be a non-negative integer');
    if (!Number.isInteger(receipt.byteSize) || receipt.byteSize < 0) throw new Error('receipt.byteSize must be a non-negative integer');
    if (!receipt.fileName || !receipt.storageKey || !receipt.contentType) throw new Error('receipt must name the file, its key and its content type');
    const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    this.props = {
      ...this.props, status: 'ready', generatedAt: now, expiresAt,
      rowCount: receipt.rowCount, contentSha256: receipt.sha256, fileName: receipt.fileName, byteSize: receipt.byteSize,
      contentType: receipt.contentType, storageKey: receipt.storageKey, notes: [...receipt.notes], version: this.props.version + 1,
    };
    this.events.push({
      type: ExportEventType.Ready,
      payload: {
        jobId: this.props.id, dataset: datasetName, datasetCode: this.props.datasetCode, userId: this.props.requestedBy,
        rows: String(receipt.rowCount), file: receipt.fileName, sha256: receipt.sha256, expiresAt: expiresAt.toISOString(),
      },
    });
  }

  fail(code: ExportFailureCode, detail: string | null, now = new Date()): void {
    assertTransition(this.props.status, 'failed');
    this.props = { ...this.props, status: 'failed', failedAt: now, failureCode: code, failureDetail: detail ? detail.slice(0, 2000) : null, version: this.props.version + 1 };
    this.events.push({ type: ExportEventType.Failed, payload: { jobId: this.props.id, dataset: this.props.datasetCode, userId: this.props.requestedBy, code } });
  }

  /** Retention passed. The receipt is kept — `ck_texp_expired_has_receipt` — so W2554 can print it beside the word. */
  expire(now = new Date()): void {
    assertTransition(this.props.status, 'expired');
    this.props = { ...this.props, status: 'expired', expiredAt: now, version: this.props.version + 1 };
    this.events.push({ type: ExportEventType.Expired, payload: { jobId: this.props.id, dataset: this.props.datasetCode, userId: this.props.requestedBy } });
  }
}
