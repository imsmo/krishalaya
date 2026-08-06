// modules/schemes/domain/scheme-application.entity.ts · the scheme_applications aggregate root.
// Lifecycle via scheme-application.state. Snapshots scheme_version at filing (rules integrity, PRD R18).
// On submit, a processing fee (if any) is collected by the service via the wallet. No version column on the
// row → repo locks FOR UPDATE.
import { ApplicationStatus, assertTransition } from './scheme-application.state';
import { DomainEvent, SchemesEventType } from './schemes.events';

export interface SchemeApplicationProps {
  id: string; tenantId: string; schemeId: string;
  /** The version NUMBER stamped at filing. Kept because it is what W070's history counts and what every existing
   *  reader uses — but on its own it points at nothing, which is why the id below exists (see migration 0105). */
  schemeVersion: number;
  /** The rule set this application was filed under. NULL only for applications drafted before 0105, whose version's
   *  rules were overwritten in place and are not recoverable. NEVER read NULL as "the current version". */
  schemeVersionId: string | null;
  applicantUserId: string; assistedBy: string | null;
  status: ApplicationStatus; formData: Record<string, unknown>; govtAppRef: string | null; eligibilityCheck: Record<string, unknown> | null;
  submittedAt: Date | null; decidedAt: Date | null; rejectionReason: string | null; createdAt?: Date;
}
export class SchemeApplication {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: SchemeApplicationProps) {}

  static draft(input: Omit<SchemeApplicationProps, 'status' | 'govtAppRef' | 'submittedAt' | 'decidedAt' | 'rejectionReason'>): SchemeApplication {
    return new SchemeApplication({ ...input, status: 'draft', govtAppRef: null, submittedAt: null, decidedAt: null, rejectionReason: null });
  }
  static rehydrate(props: SchemeApplicationProps): SchemeApplication { return new SchemeApplication(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get schemeId() { return this.props.schemeId; }
  get schemeVersion() { return this.props.schemeVersion; }
  get schemeVersionId() { return this.props.schemeVersionId; }
  get applicantUserId() { return this.props.applicantUserId; }
  get status() { return this.props.status; }
  toProps(): Readonly<SchemeApplicationProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  private transition(to: ApplicationStatus, eventType: string, extra: Record<string, unknown> = {}): void {
    const from = this.props.status; assertTransition(from, to); this.props.status = to;
    this.events.push({ type: eventType, payload: { applicationId: this.props.id, from, to, ...extra } });
  }
  submit(now: Date): void { this.props.submittedAt = now; this.transition('submitted', SchemesEventType.ApplicationSubmitted); }
  startVerification(): void { this.transition('under_verification', SchemesEventType.ApplicationVerifying); }
  requestClarification(note: string | null): void { this.transition('clarification_needed', SchemesEventType.ApplicationClarification, note ? { note } : {}); }
  resubmit(): void { this.transition('under_verification', SchemesEventType.ApplicationVerifying); }
  approve(govtAppRef: string | null, now: Date): void { this.props.govtAppRef = govtAppRef; this.props.decidedAt = now; this.transition('approved', SchemesEventType.ApplicationApproved, govtAppRef ? { govtAppRef } : {}); }
  reject(reason: string | null, now: Date): void { this.props.rejectionReason = reason; this.props.decidedAt = now; this.transition('rejected', SchemesEventType.ApplicationRejected, reason ? { reason } : {}); }
  appeal(): void { this.transition('appealed', SchemesEventType.ApplicationAppealed); }
  markDisbursed(): void { this.transition('disbursed', SchemesEventType.ApplicationDisbursed); }
  close(): void { this.transition('closed', SchemesEventType.ApplicationClosed); }
  setEligibilityCheck(result: Record<string, unknown>): void { this.props.eligibilityCheck = result; }

  toJSON() { const v = this.props; return { id: v.id, schemeId: v.schemeId, schemeVersion: v.schemeVersion, schemeVersionId: v.schemeVersionId, applicantUserId: v.applicantUserId, assistedBy: v.assistedBy,
    status: v.status, formData: v.formData, govtAppRef: v.govtAppRef, eligibilityCheck: v.eligibilityCheck, submittedAt: v.submittedAt, decidedAt: v.decidedAt, rejectionReason: v.rejectionReason, createdAt: v.createdAt }; }
}
