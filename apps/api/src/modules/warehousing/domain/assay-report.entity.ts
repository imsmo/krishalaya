// modules/warehousing/domain/assay-report.entity.ts · the assay_reports aggregate — the warehouse's own assay entry.
// PC-56 OPS-2b (survey C-10, founder Q13-A): NOT a lab certificate and it sets no price — `assayer_name` is free text (no lab registry, no
// accreditation), and nothing reads an assay to value anything (eNWR issue is refused by name; no fee or price reads it). Quality parameters are
// an opaque jsonb bag, printed as entered. No money here.
import { DomainEvent, WarehousingEventType } from './warehousing.events';
import { InvalidAssayError } from './warehousing.errors';

export interface AssayReportProps {
  id: string; tenantId: string; storageBookingId: string; assayerName: string; parameters: Record<string, unknown>;
  gradeOptionId: string | null; reportMediaId: string | null; assayedAt: Date; validUntil: string | null; createdAt?: Date;
}
export class AssayReport {
  private readonly events: DomainEvent[] = [];
  private constructor(private readonly props: AssayReportProps) {}
  static record(input: AssayReportProps): AssayReport {
    if (!input.assayerName) throw new InvalidAssayError('assayer name required');
    if (!input.parameters || typeof input.parameters !== 'object') throw new InvalidAssayError('parameters required');
    const a = new AssayReport(input);
    a.events.push({ type: WarehousingEventType.AssayRecorded, payload: { assayId: a.props.id, storageBookingId: a.props.storageBookingId } });
    return a;
  }
  static rehydrate(props: AssayReportProps): AssayReport { return new AssayReport(props); }
  get id() { return this.props.id; }
  toProps(): Readonly<AssayReportProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  toJSON() { const v = this.props; return { id: v.id, storageBookingId: v.storageBookingId, assayerName: v.assayerName, parameters: v.parameters,
    gradeOptionId: v.gradeOptionId, reportMediaId: v.reportMediaId, assayedAt: v.assayedAt, validUntil: v.validUntil, createdAt: v.createdAt }; }
}
