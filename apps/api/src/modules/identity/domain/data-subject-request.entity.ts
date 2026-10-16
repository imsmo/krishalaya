// modules/identity/domain/data-subject-request.entity.ts · DPDP rights workflow (access/erase/etc).
import { DomainError } from '../../../shared/errors/app-error';
export type DsrType = 'access' | 'erasure' | 'correction' | 'portability';
export type DsrStatus = 'open' | 'in_progress' | 'completed' | 'rejected';
export interface DsrProps {
  id: string; userId: string; requestType: DsrType; status: DsrStatus;
  coolingEndsAt: Date | null; resolution: string | null; exportMediaId: string | null;
  /** PC-56 STORE-4a (0214, founder D2): the export-plane job compiling a portability request (dataset `identity.dpdp_person`); null otherwise. */
  exportJobId?: string | null;
  /** When the request was made (read back from the row; null before insert). */
  createdAt?: Date | null;
}
/** PC-56 STORE-4a (founder D3 — "keep 90 days and say 90"): the erasure cooling-off, ONE constant — the request row's `cooling_ends_at` is
 *  computed from it and the confirm page is told it (`GET /v1/privacy/commitments` → `coolingDays`), so the two can never disagree. */
export const ERASURE_COOLING_DAYS = 90;
const NEXT: Record<DsrStatus, DsrStatus[]> = { open: ['in_progress','rejected'], in_progress: ['completed','rejected'], completed: [], rejected: [] };
export class DataSubjectRequest {
  private constructor(private props: DsrProps) {}
  static open(input: { id: string; userId: string; requestType: DsrType }): DataSubjectRequest {
    // Erasure has a 90-day cooling-off (regulatory + abuse protection).
    const coolingEndsAt = input.requestType === 'erasure' ? new Date(Date.now() + ERASURE_COOLING_DAYS * 86400_000) : null;
    return new DataSubjectRequest({ ...input, status: 'open', coolingEndsAt, resolution: null, exportMediaId: null, exportJobId: null, createdAt: null });
  }
  static rehydrate(p: DsrProps): DataSubjectRequest { return new DataSubjectRequest(p); }
  get id() { return this.props.id; }
  toProps(): Readonly<DsrProps> { return Object.freeze({ ...this.props }); }
  /** PC-56 STORE-4a: point a portability request at the plane job that compiles it (a re-request after a FAILED job relinks). */
  linkExportJob(jobId: string): void { this.props.exportJobId = jobId; }
  transition(to: DsrStatus, resolution?: string): void {
    if (!NEXT[this.props.status].includes(to)) throw new DomainError('DSR_ILLEGAL_TRANSITION', `Cannot move DSR ${this.props.status}→${to}`, 409);
    this.props.status = to; if (resolution) this.props.resolution = resolution;
  }
}
