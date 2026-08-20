// modules/dairy/domain/dairy-member-credit.entity.ts · PC-56 TENANT-6c-4 · the receivable W169's first line pays.
//
// A cooperative sells cattle feed, mineral mix or medicine to a member at the MCC and takes it out of the next milk
// cheque. W169 shows it as *"−₹500 feed credit"*, and before this wave this platform had no record of such a debt at
// all: `grep -rn "feed_credit" db/migrations` found one hit, a COMMENT on the jsonb column the deduction lived in.
//
// GOODS, NOT CASH — so no wallet movement at issue. `contract_input_advances` (0010) disburses MONEY and posts a real
// buyer → grower transfer, which is why its recovery correctly pays only the net. This is a receivable: the member
// took feed, the money moves ONCE, at recovery, member → cooperative. Inventing a disbursal leg would post a cash
// transfer that never happened; leaving the recovery unposted would be the defect 0157 refused to ship.
import { DomainEvent, DairyEventType } from './dairy.events';
import { MemberCreditNotRecoverableError } from './dairy.errors';

export interface DairyMemberCreditProps {
  id: string;
  tenantId: string;
  membershipId: string;
  mccId: string | null;
  /** What was sold, in the operator's own words (TENANT-6c-2's ruling on a dispute's reason, applied again). */
  description: string;
  valueMinor: bigint;
  recoveredMinor: bigint;
  issuedOn: string;
  issuedBy: string;
  status: 'outstanding' | 'recovered';
  createdAt?: Date;
}

/** A description short enough to be meaningless is not a record of what a family owes money for. */
export const DESCRIPTION_FLOOR = 3;

export class DairyMemberCredit {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: DairyMemberCreditProps) {}

  static issue(input: Omit<DairyMemberCreditProps, 'recoveredMinor' | 'status'>): DairyMemberCredit {
    if (input.valueMinor <= 0n) throw new MemberCreditNotRecoverableError(input.id, 'value must be greater than zero');
    if ((input.description ?? '').trim().length < DESCRIPTION_FLOOR) {
      throw new MemberCreditNotRecoverableError(input.id, 'a credit must say what was sold');
    }
    const c = new DairyMemberCredit({ ...input, description: input.description.trim(), recoveredMinor: 0n, status: 'outstanding' });
    c.events.push({
      type: DairyEventType.MemberCreditIssued,
      payload: { creditId: c.props.id, membershipId: c.props.membershipId, valueMinor: c.props.valueMinor.toString(), description: c.props.description },
    });
    return c;
  }
  static rehydrate(props: DairyMemberCreditProps): DairyMemberCredit { return new DairyMemberCredit(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get membershipId() { return this.props.membershipId; }
  get valueMinor() { return this.props.valueMinor; }
  get recoveredMinor() { return this.props.recoveredMinor; }
  get outstandingMinor() { return this.props.valueMinor - this.props.recoveredMinor; }
  get status() { return this.props.status; }
  toProps(): Readonly<DairyMemberCreditProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * Record a recovery of EXACTLY this amount.
   *
   * Deliberately NOT `InputAdvance.recover(upTo)`'s shape, which takes a ceiling and returns whatever it could take.
   * That is right for a settlement pass sweeping every outstanding advance; it is wrong here, because a milk bill's
   * deduction LINE is a figure a member has already been shown and — above the threshold — has consented to. If the
   * line says ₹500 and only ₹300 is outstanding, silently taking ₹300 would pay the member ₹200 less than the bill's
   * own net says, and the difference would sit in the cooperative's wallet with nothing to reconcile it against. So
   * it refuses, and the operator corrects the bill.
   */
  recover(amountMinor: bigint, billId: string): void {
    if (amountMinor <= 0n) throw new MemberCreditNotRecoverableError(this.props.id, 'a recovery must be greater than zero');
    if (this.props.status !== 'outstanding') throw new MemberCreditNotRecoverableError(this.props.id, `this credit is already ${this.props.status}`);
    if (amountMinor > this.outstandingMinor) {
      throw new MemberCreditNotRecoverableError(this.props.id, `only ${this.outstandingMinor} minor units are outstanding, and the bill line says ${amountMinor}`);
    }
    this.props.recoveredMinor += amountMinor;
    if (this.props.recoveredMinor === this.props.valueMinor) this.props.status = 'recovered';
    this.events.push({
      type: DairyEventType.MemberCreditRecovered,
      payload: {
        creditId: this.props.id, membershipId: this.props.membershipId, billId,
        amountMinor: amountMinor.toString(), outstandingMinor: this.outstandingMinor.toString(), status: this.props.status,
      },
    });
  }

  toJSON() {
    const v = this.props;
    return { id: v.id, membershipId: v.membershipId, mccId: v.mccId, description: v.description,
      valueMinor: v.valueMinor.toString(), recoveredMinor: v.recoveredMinor.toString(), outstandingMinor: this.outstandingMinor.toString(),
      issuedOn: v.issuedOn, issuedBy: v.issuedBy, status: v.status, createdAt: v.createdAt };
  }
}
