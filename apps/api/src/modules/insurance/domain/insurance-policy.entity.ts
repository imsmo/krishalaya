// modules/insurance/domain/insurance-policy.entity.ts · the insurance_policies aggregate root.
// Lifecycle via insurance-policy.state (Law 5). Money is bigint minor units (Law 2) — like
// modules/fintech/domain/loan-application.entity.ts (LoanApplicationProps), this aggregate carries NO
// currencyCode field: insurance_policies (like loan_applications before it) has no currency_code column in
// the ratified schema (only loan_products does). This mirrors that ALREADY-SHIPPED, QA-passed convention
// rather than inventing a new one — see DEV-22's STATE block "schema gaps" note for the founder-arbitration
// flag (a future migration should add currency_code to all four tables together before multi-country Y6-7).
// No version column on insurance_policies → the repository locks FOR UPDATE (same as loan_applications).
import { PolicyStatus, assertTransition } from './insurance-policy.state';
import { InsuranceEventType, DomainEvent, SubjectType } from './insurance.events';
import { InvalidSumInsuredError, InvalidPolicyValidityError } from './insurance.errors';

export interface InsurancePolicyProps {
  id: string;
  tenantId: string;
  holderUserId: string;
  productId: string;
  policyNo: string | null;
  subjectType: SubjectType;
  subjectId: string | null;   // polymorphic; no FK in the DDL (subject_type dictates which table it names)
  sumInsuredMinor: bigint;
  premiumMinor: bigint;       // the FARMER'S collectible share (govt subsidy tracked separately, not persisted here — see premium-calc.ts)
  premiumPaymentId: string | null;
  status: PolicyStatus;
  validFrom: string;          // date, 'YYYY-MM-DD'
  validUntil: string;
  parametricTriggers: Record<string, unknown> | null;
  createdAt?: Date;
}

export class InsurancePolicy {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: InsurancePolicyProps) {}

  /** PROPOSE — the enrolment action (screens 283-285). Always starts 'proposed' per the DDL default and
   *  screen 283's own text ("Policy starts as proposed and becomes active once your premium is paid"). */
  static propose(input: Omit<InsurancePolicyProps, 'status'>): InsurancePolicy {
    if (input.sumInsuredMinor <= 0n) throw new InvalidSumInsuredError();
    if (input.premiumMinor < 0n) throw new InvalidSumInsuredError('Premium cannot be negative');
    if (new Date(input.validUntil) <= new Date(input.validFrom)) throw new InvalidPolicyValidityError();
    const p = new InsurancePolicy({ ...input, status: 'proposed' });
    p.events.push({
      type: InsuranceEventType.PolicyProposed,
      payload: {
        policyId: p.props.id, holderUserId: p.props.holderUserId, productId: p.props.productId,
        subjectType: p.props.subjectType, subjectId: p.props.subjectId,
        sumInsuredMinor: p.props.sumInsuredMinor.toString(), premiumMinor: p.props.premiumMinor.toString(),
      },
    });
    return p;
  }
  static rehydrate(props: InsurancePolicyProps): InsurancePolicy { return new InsurancePolicy(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get holderUserId() { return this.props.holderUserId; }
  get productId() { return this.props.productId; }
  get status() { return this.props.status; }
  get premiumMinor() { return this.props.premiumMinor; }
  toProps(): Readonly<InsurancePolicyProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** CANCEL — withdraw before premium is paid (screen 287's "Cancelled" example card). Only legal from
   *  'proposed' or 'active' per the state machine; the domain doesn't special-case which — the machine does. */
  cancel(): void {
    const from = this.props.status;
    assertTransition(from, 'cancelled');
    this.props.status = 'cancelled';
    this.events.push({ type: InsuranceEventType.PolicyCancelled, payload: { policyId: this.props.id, from } });
  }

  /** ACTIVATE — proposed→active, fired ONLY by DEV-23's premium-payment-succeeded outbox handler once the
   *  payments module has confirmed a real captured payment matching this policy's premiumMinor (screen 283:
   *  "Policy starts as proposed and becomes active once your ₹X is paid"). Idempotent: a repeat activation
   *  attempt (relay re-delivery) is a no-op (returns false) rather than throwing, so the handler stays safe
   *  under at-least-once delivery. `paymentId` is stamped onto the `premiumPaymentId` socket DEV-22 left null. */
  activate(paymentId: string): boolean {
    if (this.props.status === 'active') return false;
    assertTransition(this.props.status, 'active');
    this.props.status = 'active';
    this.props.premiumPaymentId = paymentId;
    this.events.push({ type: InsuranceEventType.PolicyActivated, payload: { policyId: this.props.id, paymentId } });
    return true;
  }

  /** CLAIMED — active→claimed, fired by InsuranceClaimService when a claim against this policy is PAID
   *  (screen 293's settlement outcome). Terminal (Law 5) — a policy can be marked claimed once; a further
   *  incident under the same policy period is out of this schema's shape (one insurance_policies row = one
   *  coverage period; DEV-22/DEV-23 do not invent a multi-claim-per-policy model beyond this). */
  markClaimed(): void {
    const from = this.props.status;
    assertTransition(from, 'claimed');
    this.props.status = 'claimed';
    this.events.push({ type: InsuranceEventType.PolicyClaimed, payload: { policyId: this.props.id, from } });
  }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, holderUserId: v.holderUserId, productId: v.productId, policyNo: v.policyNo,
      subjectType: v.subjectType, subjectId: v.subjectId,
      sumInsuredMinor: v.sumInsuredMinor.toString(), premiumMinor: v.premiumMinor.toString(),
      premiumPaymentId: v.premiumPaymentId, status: v.status,
      validFrom: v.validFrom, validUntil: v.validUntil,
      parametricTriggers: v.parametricTriggers, createdAt: v.createdAt,
    };
  }
}
