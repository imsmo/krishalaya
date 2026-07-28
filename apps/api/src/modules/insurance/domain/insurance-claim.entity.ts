// modules/insurance/domain/insurance-claim.entity.ts · the insurance_claims aggregate root.
// Lifecycle via insurance-claim.state (Law 5). Money (approvedMinor) is bigint minor units (Law 2), no
// currencyCode field -- mirrors insurance_policies' own already-ratified no-currency-column convention
// (DEV-22's flagged shared Law-2 debt; not repeated as a new finding). No version column on insurance_claims
// (grep-verified against add_std_columns) -> the repository locks FOR UPDATE, same as insurance_policies.
import { ClaimStatus, assertTransition } from './insurance-claim.state';
import { ClaimEventType, DomainEvent } from './insurance.events';
import { InvalidClaimDecisionError, ClaimNotApprovedError } from './insurance.errors';

export interface InsuranceClaimProps {
  id: string;
  tenantId: string;
  policyId: string;
  claimantUserId: string;
  eventDate: string;              // date, 'YYYY-MM-DD'
  eventTypeId: string;            // lookup_values('claim_event')
  description: string | null;
  status: ClaimStatus;
  intimatedWithin72h: boolean;
  surveyorUserId: string | null;
  surveyReport: Record<string, unknown> | null;
  approvedMinor: bigint | null;
  payoutId: string | null;
  closedAt: Date | null;
  createdAt?: Date;
}

export class InsuranceClaim {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: InsuranceClaimProps) {}

  /** FILE (screen 289's intimation). Always starts 'intimated'. intimatedWithin72h is computed HERE, at
   *  filing time, from eventDate vs `now` -- never re-derived later (an honest, point-in-time fact, per the
   *  canon's own "you are well within the window" 72h banner). */
  static file(input: Omit<InsuranceClaimProps, 'status' | 'intimatedWithin72h' | 'surveyorUserId' | 'surveyReport' | 'approvedMinor' | 'payoutId' | 'closedAt'> & { now?: Date }): InsuranceClaim {
    const now = input.now ?? new Date();
    const eventDateMs = new Date(input.eventDate + 'T00:00:00Z').getTime();
    const within72h = (now.getTime() - eventDateMs) <= 72 * 3600_000;
    const c = new InsuranceClaim({
      id: input.id, tenantId: input.tenantId, policyId: input.policyId, claimantUserId: input.claimantUserId,
      eventDate: input.eventDate, eventTypeId: input.eventTypeId, description: input.description ?? null,
      status: 'intimated', intimatedWithin72h: within72h, surveyorUserId: null, surveyReport: null,
      approvedMinor: null, payoutId: null, closedAt: null, createdAt: now,
    });
    c.events.push({ type: ClaimEventType.Filed, payload: { claimId: c.props.id, policyId: c.props.policyId, claimantUserId: c.props.claimantUserId, eventTypeId: c.props.eventTypeId } });
    return c;
  }
  static rehydrate(props: InsuranceClaimProps): InsuranceClaim { return new InsuranceClaim(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get policyId() { return this.props.policyId; }
  get claimantUserId() { return this.props.claimantUserId; }
  get status() { return this.props.status; }
  get approvedMinor() { return this.props.approvedMinor; }
  toProps(): Readonly<InsuranceClaimProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** insurer requests more documents before survey (screen 291's "Documents check" step). */
  requestDocuments(): void {
    assertTransition(this.props.status, 'docs_pending');
    this.props.status = 'docs_pending';
    this.events.push({ type: ClaimEventType.DocumentsRequested, payload: { claimId: this.props.id } });
  }

  /** insurer dispatches a surveyor (screen 291/292). Also the RE-survey path after a farmer disagreement
   *  (surveyed->survey_scheduled is in the transition table) -- the caller decides which surveyor to pass. */
  scheduleSurvey(surveyorUserId: string): void {
    const from = this.props.status;
    assertTransition(from, 'survey_scheduled');
    this.props.status = 'survey_scheduled';
    this.props.surveyorUserId = surveyorUserId;
    this.events.push({ type: ClaimEventType.SurveyScheduled, payload: { claimId: this.props.id, surveyorUserId, from } });
  }

  /** surveyor records the assessment (screen 292's "measure the damage... sign the assessment"). */
  recordSurvey(surveyReport: Record<string, unknown>): void {
    assertTransition(this.props.status, 'surveyed');
    this.props.status = 'surveyed';
    this.props.surveyReport = surveyReport;
    this.events.push({ type: ClaimEventType.Surveyed, payload: { claimId: this.props.id, surveyReport } });
  }

  /** FARMER DISAGREES with the assessment (screen 292: "opens a review with a second surveyor -- it never
   *  cancels your claim"). The ONE claimant-triggered state transition this wave. surveyorUserId is cleared
   *  pending reassignment via a subsequent scheduleSurvey() call; the prior surveyReport is left in place
   *  for the next surveyor's reference (never silently discarded). */
  requestResurvey(): void {
    assertTransition(this.props.status, 'survey_scheduled');
    this.props.status = 'survey_scheduled';
    this.props.surveyorUserId = null;
    this.events.push({ type: ClaimEventType.SurveyScheduled, payload: { claimId: this.props.id, surveyorUserId: null, resurvey: true } });
  }

  /** insurer DECIDES (screen 293's settlement math): approved | partially_approved | rejected. approvedMinor
   *  is required and >0 for the two approved kinds, forbidden for rejected -- entity-level invariant; the
   *  sum-insured cap (approvedMinor <= policy.sumInsuredMinor) is a cross-aggregate check the SERVICE layer
   *  enforces (this entity does not know the policy's sum insured). */
  decide(decision: 'approved' | 'partially_approved' | 'rejected', approvedMinor: bigint | null, note: string | null): void {
    if (decision === 'rejected') {
      if (approvedMinor !== null) throw new InvalidClaimDecisionError('approvedMinor must be absent for a rejected decision');
      assertTransition(this.props.status, 'rejected');
      this.props.status = 'rejected';
      this.events.push({ type: ClaimEventType.Decided, payload: { claimId: this.props.id, decision, note } });
      return;
    }
    if (approvedMinor === null || approvedMinor <= 0n) throw new InvalidClaimDecisionError('approvedMinor must be a positive amount for an approved/partially_approved decision');
    assertTransition(this.props.status, decision);
    this.props.status = decision;
    this.props.approvedMinor = approvedMinor;
    this.events.push({ type: ClaimEventType.Decided, payload: { claimId: this.props.id, decision, approvedMinor: approvedMinor.toString(), note } });
  }

  /** SETTLE (money-out, screen 293). Requires a prior approved/partially_approved decision. Records the
   *  ledger txn reference passed in by the service (settlement itself rides the wallet port, not this
   *  entity -- see InsuranceClaimService.settle). payoutId is left NULL by design (see spec_dev23.md's
   *  money-path boundary #2: the payments module exposes no third-party-payout hook this batch can safely
   *  use without inventing new payments-module money-movement code). */
  settle(): void {
    if (this.props.approvedMinor === null || this.props.approvedMinor <= 0n) throw new ClaimNotApprovedError(this.props.status);
    assertTransition(this.props.status, 'paid');
    this.props.status = 'paid';
    this.events.push({ type: ClaimEventType.Settled, payload: { claimId: this.props.id, approvedMinor: this.props.approvedMinor.toString() } });
  }

  /** administrative close-out (paid or rejected -> closed). */
  close(now?: Date): void {
    assertTransition(this.props.status, 'closed');
    this.props.status = 'closed';
    this.props.closedAt = now ?? new Date();
    this.events.push({ type: ClaimEventType.Closed, payload: { claimId: this.props.id } });
  }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, policyId: v.policyId, claimantUserId: v.claimantUserId, eventDate: v.eventDate,
      eventTypeId: v.eventTypeId, description: v.description, status: v.status,
      intimatedWithin72h: v.intimatedWithin72h, surveyorUserId: v.surveyorUserId, surveyReport: v.surveyReport,
      approvedMinor: v.approvedMinor !== null ? v.approvedMinor.toString() : null, payoutId: v.payoutId,
      closedAt: v.closedAt, createdAt: v.createdAt,
    };
  }
}
