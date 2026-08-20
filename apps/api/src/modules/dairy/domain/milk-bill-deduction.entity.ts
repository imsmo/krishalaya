// modules/dairy/domain/milk-bill-deduction.entity.ts · PC-56 TENANT-6c-4 · ONE deduction line.
//
// W169: *"feed credit + loan EMI + insurance — each line itemised"*, and per bill *"−₹1,240 loan EMI + insurance"*.
// Until this wave a line was an element of a jsonb array — `{type: <any 40-char string>, amount_minor}` — referencing
// nothing. It could not be reconciled, could not be reduced from anything, and could not answer the only question a
// member asks about it: *which* loan, *which* feed bag.
import { DomainEvent, DairyEventType } from './dairy.events';
import { BillDeductionNotFoundError } from './dairy.errors';

export type DeductionLineStatus = 'pending' | 'applied';

export interface MilkBillDeductionProps {
  id: string;
  tenantId: string;
  billId: string;
  membershipId: string;
  /** The `lookup_values` row (type `milk_deduction`). The line's own FK — a type this platform does not have cannot be named. */
  typeId: string;
  /** Denormalised for readability only; the id above is the truth. */
  typeCode: string;
  amountMinor: bigint;
  /** WHAT THIS PAYS: `dairy_member_credit` / `loan` / `unreconciled_legacy` (0160's backfill). */
  sourceType: string;
  sourceId: string;
  status: DeductionLineStatus;
  appliedAt: Date | null;
  walletTxnId: string | null;
  createdBy: string | null;
  createdAt?: Date;
}

export class MilkBillDeduction {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MilkBillDeductionProps) {}

  static create(input: Omit<MilkBillDeductionProps, 'status' | 'appliedAt' | 'walletTxnId'>): MilkBillDeduction {
    if (input.amountMinor <= 0n) throw new BillDeductionNotFoundError(input.id);
    return new MilkBillDeduction({ ...input, status: 'pending', appliedAt: null, walletTxnId: null });
  }
  static rehydrate(props: MilkBillDeductionProps): MilkBillDeduction { return new MilkBillDeduction(props); }

  get id() { return this.props.id; }
  get billId() { return this.props.billId; }
  get typeCode() { return this.props.typeCode; }
  get typeId() { return this.props.typeId; }
  get amountMinor() { return this.props.amountMinor; }
  get sourceType() { return this.props.sourceType; }
  get sourceId() { return this.props.sourceId; }
  get status() { return this.props.status; }
  get isApplied() { return this.props.status === 'applied'; }
  toProps(): Readonly<MilkBillDeductionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * This line's money has MOVED, and here is the ledger transaction that moved it.
   *
   * The txn id is required rather than optional: a line stamped `applied` with nothing to point at is a claim that
   * money moved, which is the exact shape this programme has closed four times from the other direction (a stamp with
   * no movement, a movement with no stamp). The database pairs them too
   * (`ck_milk_bill_deduction_applied`), so neither layer can drift.
   */
  apply(at: Date, walletTxnId: string): void {
    if (this.props.status === 'applied') {
      // Not an error worth throwing on: the pass is resumable and a re-run finds fewer lines. But it must not
      // re-stamp, because that would move `applied_at` to the second attempt and lose when the money actually left.
      return;
    }
    this.props.status = 'applied';
    this.props.appliedAt = at;
    this.props.walletTxnId = walletTxnId;
    this.events.push({
      type: DairyEventType.BillDeductionApplied,
      payload: {
        deductionId: this.props.id, billId: this.props.billId, membershipId: this.props.membershipId,
        typeCode: this.props.typeCode, amountMinor: this.props.amountMinor.toString(),
        sourceType: this.props.sourceType, sourceId: this.props.sourceId, walletTxnId,
      },
    });
  }

  toJSON() {
    const v = this.props;
    return { id: v.id, typeCode: v.typeCode, amountMinor: v.amountMinor.toString(),
      sourceType: v.sourceType, sourceId: v.sourceId, status: v.status, appliedAt: v.appliedAt, walletTxnId: v.walletTxnId };
  }
}
