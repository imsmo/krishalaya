// modules/ambassadors/domain/ambassador-earning.entity.ts · an accrued commission event (ambassador_earnings,
// PARTITIONED by created_at; append-only). amount_minor is bigint (Law 2). payout_id NULL = unpaid; it is
// stamped (once) when a payout batch settles it through the wallet. UNIQUE(ambassador,event,reference) at the
// DB makes accrual idempotent.
import { DomainEvent, AmbassadorEventType } from './ambassadors.events';

export interface AmbassadorEarningProps {
  id: string; tenantId: string; ambassadorId: string; planId: string; eventCode: string;
  referenceType: string | null; referenceId: string | null; amountMinor: bigint; payoutId: string | null; createdAt?: Date;
  /** PC-56 TENANT-10a (0184): the farmer this earning was earned on (the per-farmer caps). */
  subjectUserId?: string | null;
  /** PC-56 TENANT-10a · F-1/F-17: `created_at::text` — every microsecond Postgres stored. The payout stamps by it and the
   *  list cursor is minted from it; a JS Date (milliseconds) is never round-tripped back into a WHERE. */
  createdAtRaw?: string;
}
export class AmbassadorEarning {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: AmbassadorEarningProps) {}

  static accrue(input: Omit<AmbassadorEarningProps, 'payoutId'>): AmbassadorEarning {
    if (input.amountMinor <= 0n) throw new Error('earning amount must be positive');   // caller guards; never accrue zero
    const e = new AmbassadorEarning({ ...input, payoutId: null });
    e.events.push({ type: AmbassadorEventType.EarningAccrued, payload: { earningId: e.props.id, ambassadorId: e.props.ambassadorId, eventCode: e.props.eventCode, amountMinor: e.props.amountMinor.toString() } });
    return e;
  }
  static rehydrate(p: AmbassadorEarningProps): AmbassadorEarning { return new AmbassadorEarning(p); }
  get id() { return this.props.id; }
  get amountMinor() { return this.props.amountMinor; }
  get payoutId() { return this.props.payoutId; }
  toProps(): Readonly<AmbassadorEarningProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  toJSON() { const v = this.props; return { id: v.id, ambassadorId: v.ambassadorId, eventCode: v.eventCode, referenceType: v.referenceType, referenceId: v.referenceId, amountMinor: v.amountMinor.toString(), payoutId: v.payoutId, subjectUserId: v.subjectUserId ?? null, createdAt: v.createdAt }; }
}
