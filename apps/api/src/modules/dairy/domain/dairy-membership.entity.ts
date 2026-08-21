// modules/dairy/domain/dairy-membership.entity.ts · the dairy_memberships aggregate (farmer ↔ MCC route).
// UNIQUE(tenant_id, mcc_id, member_code). The farmer_user_id is the milk supplier paid by the cooperative.
import { PaymentCycle, AnimalType, DomainEvent, DairyEventType } from './dairy.events';

export interface DairyMembershipProps {
  id: string; tenantId: string; farmerUserId: string; mccId: string; memberCode: string;
  paymentCycle: PaymentCycle; defaultAnimalType: AnimalType | null; isActive: boolean; createdAt?: Date;
}
export class DairyMembership {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: DairyMembershipProps) {}
  static create(input: Omit<DairyMembershipProps, 'isActive' | 'createdAt'> & { isActive?: boolean }): DairyMembership {
    const m = new DairyMembership({ ...input, isActive: input.isActive ?? true });
    m.events.push({ type: DairyEventType.MembershipCreated, payload: { membershipId: m.props.id, farmerUserId: m.props.farmerUserId, mccId: m.props.mccId } });
    return m;
  }
  static rehydrate(props: DairyMembershipProps): DairyMembership { return new DairyMembership(props); }

  /**
   * [PC-56 TENANT-6d-3 · W171] *"Moving house? The membership moves centres without losing history — the member_code
   * changes, the person's record never resets."*
   *
   * THE SAME ROW MOVES. Not a new membership: a new one would leave every bill, deduction, consent and quality flag
   * pointing at a record the member no longer has, which is the "record resets" the canon rules out. What changes is
   * the route and the card; `farmer_user_id`, `payment_cycle` and the id itself do not.
   *
   * The route HISTORY is the repository's business (0164's `dairy_membership_routes`), written in the same
   * transaction. This method refuses the two moves that make no sense on their own terms; everything about dates,
   * cards already in use and pours already recorded is decided by `moveVerdict` before it is called.
   */
  moveTo(mccId: string, memberCode: string, effectiveFrom: string) {
    if (this.props.mccId === mccId) {
      throw new Error('this membership is already routed to that centre');
    }
    if (memberCode.trim().length === 0) {
      throw new Error('a membership moving centres needs the card it will carry at the destination');
    }
    const from = { mccId: this.props.mccId, memberCode: this.props.memberCode };
    this.props.mccId = mccId;
    this.props.memberCode = memberCode.trim();
    this.events.push({
      type: DairyEventType.MembershipMoved,
      payload: {
        membershipId: this.props.id, farmerUserId: this.props.farmerUserId,
        fromMccId: from.mccId, toMccId: mccId,
        fromMemberCode: from.memberCode, toMemberCode: this.props.memberCode,
        effectiveFrom,
      },
    });
  }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get farmerUserId() { return this.props.farmerUserId; }
  get defaultAnimalType() { return this.props.defaultAnimalType; }
  toProps(): Readonly<DairyMembershipProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  toJSON() { const v = this.props; return { id: v.id, farmerUserId: v.farmerUserId, mccId: v.mccId, memberCode: v.memberCode,
    paymentCycle: v.paymentCycle, defaultAnimalType: v.defaultAnimalType, isActive: v.isActive, createdAt: v.createdAt }; }
}
