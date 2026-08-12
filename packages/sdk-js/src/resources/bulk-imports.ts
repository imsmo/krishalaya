// @krishalaya/sdk-js · bulk imports, with W156's validate-first triage (PC-56 TENANT-1b-4).
//
// **THE SHAPE OF THIS RESOURCE IS THE FEATURE.** `create` uploads nothing and applies nothing; `validate` reads the file
// and returns a triage; `confirm` is the operator saying yes. Three calls rather than one, because the screen shows "220
// rows · 214 valid · 4 already members · 2 fixable" and only THEN a button reading "Import 214 valid rows" — and an API
// with a single `create` could not have produced that screen.
//
// Before this wave the rail applied rows as it streamed, so the only way to find out what a file would do was to let it do
// it. On a member register that is 220 half-created people.
import { HttpClient } from '../http';

export type BulkImportStatus =
  | 'pending' | 'validating' | 'validated' | 'processing'
  | 'completed' | 'partially_completed' | 'failed' | 'cancelled';

/** One row a human has to fix in the file. `suggestion` is a PROPOSAL and is never applied automatically. */
export interface BulkValidationIssue {
  rowIndex: number;
  code: string;
  message: string;
  suggestion?: string;
}

/**
 * W156's triage.
 *
 * **`willCreate + alreadyMembers + fixable + invalid` EQUALS `totalRows`.** A report whose parts do not add up to the file
 * is one an operator cannot reason about, and the arithmetic is the only thing between "214 valid of 220" and a number
 * somebody made up.
 */
export interface BulkValidationReport {
  totalRows: number;
  willCreate: number;
  /** Matched by phone — skipped, never duplicated. **NOT a failure.** */
  alreadyMembers: number;
  fixable: number;
  invalid: number;
  issues: BulkValidationIssue[];
  /** True when `issues` was truncated, so the screen says "showing 2 of 40" rather than implying 2. */
  issuesTruncated: boolean;
}

export interface BulkImportJob {
  id: string;
  importType: string;
  storageKey: string;
  originalFilename: string | null;
  status: BulkImportStatus;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  errorSummary: string | null;
  /** SHA-256 of the bytes actually read. W156: "every import batch is recorded with the file hash." */
  fileSha256?: string | null;
  validatedAt?: string | null;
  validation?: BulkValidationReport | null;
  createdAt?: string;
}

/** The columns W156's downloadable template carries. `phone` is the only one that must be present. */
export const MEMBER_IMPORT_COLUMNS = ['phone', 'full_name', 'role', 'language', 'village'] as const;

export class BulkImportsResource {
  constructor(private readonly http: HttpClient) {}

  /** Register an already-uploaded file as a job. Applies NOTHING. Needs `bulk.import` + an Idempotency-Key (Law 3). */
  async create(input: { importType: string; storageKey: string; originalFilename?: string; columnMapping?: Record<string, string> }, idempotencyKey: string): Promise<BulkImportJob> {
    return (await this.http.request<BulkImportJob>('POST', 'bulk-imports', { idempotencyKey, body: input })).data;
  }

  /**
   * VALIDATE FIRST — read every row, judge it, write nothing but the triage and the file hash.
   *
   * The job parks at `validated` until `confirm`. An import type whose applier cannot describe a valid row fails this call
   * with a clear message rather than reporting a clean file, because "220 valid" from a checker nobody wrote is the worst
   * possible answer here.
   */
  async validate(id: string): Promise<{ jobId: string; status: BulkImportStatus | 'not_found'; report?: BulkValidationReport }> {
    return (await this.http.request<{ jobId: string; status: BulkImportStatus | 'not_found'; report?: BulkValidationReport }>(
      'POST', `bulk-imports/${encodeURIComponent(id)}/validate`, {})).data;
  }

  /**
   * CONFIRM the triage — W156's "Import 214 valid rows".
   *
   * **AUDITED WITH THE COUNTS THE OPERATOR WAS SHOWN**, so a dispute months later reads "they were told 214 create / 4
   * duplicate / 2 fixable and pressed the button" rather than "somebody ran an import". Moves the job to `processing`; the
   * work happens off the request.
   */
  async confirm(id: string): Promise<BulkImportJob> {
    return (await this.http.request<BulkImportJob>('POST', `bulk-imports/${encodeURIComponent(id)}/confirm`, {})).data;
  }

  async get(id: string, signal?: AbortSignal): Promise<BulkImportJob> {
    return (await this.http.request<BulkImportJob>('GET', `bulk-imports/${encodeURIComponent(id)}`, { signal })).data;
  }

  async list(params: { status?: BulkImportStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: BulkImportJob[]; nextCursor: string | null }> {
    const r = await this.http.request<BulkImportJob[]>('GET', 'bulk-imports', {
      query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** Per-row failures from a run that has already happened — distinct from the validation triage, which is a preview. */
  async errors(id: string, params: { afterRow?: number; limit?: number } = {}, signal?: AbortSignal): Promise<BulkValidationIssue[]> {
    const r = await this.http.request<{ rowIndex: number; errorCode: string; errorMessage: string }[]>(
      'GET', `bulk-imports/${encodeURIComponent(id)}/errors`, { query: { afterRow: params.afterRow, limit: params.limit ?? 100 }, signal });
    return r.data.map((x) => ({ rowIndex: x.rowIndex, code: x.errorCode, message: x.errorMessage }));
  }

  async cancel(id: string): Promise<BulkImportJob> {
    return (await this.http.request<BulkImportJob>('POST', `bulk-imports/${encodeURIComponent(id)}/cancel`, {})).data;
  }
}

/**
 * The CSV W156 offers as "Download template (Gujarati headers OK)".
 *
 * **GENERATED FROM THE SAME COLUMN LIST THE IMPORTER READS**, so a template that drifts from the parser is impossible. The
 * sample row is deliberately a plausible Gujarati name with a plain ten-digit number — the shape an SHG secretary actually
 * writes — rather than "John Doe / 1234567890", which teaches nobody the format that matters.
 */
export function memberImportTemplateCsv(): string {
  return `${MEMBER_IMPORT_COLUMNS.join(',')}\n9876543210,Meera Ben J.,farmer,gu,Vanthali\n`;
}

/** The columns W128's listing template carries (PC-56 TENANT-2c). `phone` (whose produce) + `product` (what) are
 *  the two a row cannot do without. */
export const LISTING_IMPORT_COLUMNS = ['phone', 'product', 'quantity', 'unit', 'price', 'min_order_qty', 'harvest_date', 'title'] as const;

/**
 * W128's "Download template". GENERATED FROM THE SAME COLUMN LIST THE IMPORTER READS, so a template that drifts
 * from the parser is impossible. The sample row is the shape an FPO secretary actually writes — a real Gujarati
 * lot with a plain ten-digit number and a PER-QUINTAL price, because the per-kilo mistake is the one this file
 * exists to catch.
 */
export function listingImportTemplateCsv(): string {
  return `${LISTING_IMPORT_COLUMNS.join(',')}\n9876543210,Wheat,18,quintal,2640,2,2026-03-15,Lokwan wheat (stored)\n`;
}
