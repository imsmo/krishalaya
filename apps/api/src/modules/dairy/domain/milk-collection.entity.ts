// modules/dairy/domain/milk-collection.entity.ts · the milk_collections aggregate (one row per member per
// shift per day — UNIQUE(membership_id, collected_on, shift)). The counter records weight + fat + snf; the
// amount is priced by the rate card (bigint minor units, float-free). PARTITIONED by collected_on (Law 8).
import { MilkShift, DomainEvent, DairyEventType } from './dairy.events';
import { InvalidCollectionError } from './dairy.errors';
import { HoldState, assertHoldTransition } from './milk-quality.state';

export interface MilkCollectionProps {
  id: string;
  tenantId: string;
  mccId: string;
  /**
   * [PC-56 TENANT-6d-6] The AUTHORITY for a pour taken away from the member's own route — W170's playbook step 2.
   *
   * Null on every ordinary row, which is almost all of them. Non-null means this member's milk was recorded at another
   * village, and this is the signed decision that allowed it: 0166's trigger refuses a row whose diversion does not
   * cover its own day, shift and centre, so the column cannot become decoration.
   */
  diversionId: string | null;
  membershipId: string;
  shift: MilkShift;
  collectedOn: string;          // ISO date (partition key)
  weightMilliKg: bigint;        // kg ×1000 (scaled integer; no float)
  fatCentiPct: bigint;          // % ×100
  snfCentiPct: bigint;          // % ×100
  /** [PC-56 TENANT-6b-1] The analyzer's density — W168's own evidence for a water flag. Dead column until this wave. */
  density: string | null;
  waterFlag: boolean;
  adulterationFlags: string[];
  rateCardId: string;
  amountMinor: bigint;
  /** [PC-56 TENANT-6b-1] Whether this pour's payment is held. See domain/milk-quality.state.ts. */
  holdState: HoldState;
  /** Whether the premium slabs were applied when this pour was priced — recorded WITH the pour, so what a member was
   *  paid stays reconstructible after the flag is switched, the card is superseded, or both. */
  bonusApplied: boolean;
  bonusMinor: bigint;
  enteredBy: string | null;
  milkBillId: string | null;
  createdAt?: Date;
}

export class MilkCollection {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MilkCollectionProps) {}

  /**
   * `diversionId` is OPTIONAL on the way in and null by default (TENANT-6d-6): an ordinary pour is every pour a
   * cooperative has ever recorded, and forcing every caller to write `diversionId: null` is noise that will eventually
   * be got wrong in the one place it matters. It is REQUIRED on the props, so a row read back always answers the
   * question *"was this pour taken away from the member's own centre?"* with yes or no rather than with undefined.
   */
  static record(input: Omit<MilkCollectionProps, 'milkBillId' | 'holdState' | 'diversionId'> & { diversionId?: string | null }): MilkCollection {
    if (input.weightMilliKg <= 0n) throw new InvalidCollectionError('weight must be greater than zero');
    if (input.fatCentiPct < 0n || input.fatCentiPct > 10000n) throw new InvalidCollectionError('fat % out of range');
    if (input.snfCentiPct < 0n || input.snfCentiPct > 10000n) throw new InvalidCollectionError('snf % out of range');
    if (input.amountMinor < 0n) throw new InvalidCollectionError('amount cannot be negative');
    if (input.bonusMinor < 0n) throw new InvalidCollectionError('bonus cannot be negative');
    if (input.bonusMinor > input.amountMinor) throw new InvalidCollectionError('bonus cannot exceed the priced amount');
    // [PC-56 TENANT-6b-1] THE FLAG DECIDES THE HOLD, HERE, ONCE. W168: "Rate card holds this pour's payment only."
    // Before this wave a flagged pour was billed and paid at full price, so the hold is derived from the flags at the
    // moment of recording rather than left to a caller to remember — a caller that forgets is a farmer paid for water,
    // or a farmer's clean milk withheld.
    const flagged = input.waterFlag || input.adulterationFlags.some((f) => !!f);
    const c = new MilkCollection({ diversionId: null, ...input, holdState: flagged ? 'held' : 'none', milkBillId: null });
    c.events.push({ type: DairyEventType.CollectionRecorded, payload: { collectionId: c.props.id, membershipId: c.props.membershipId, mccId: c.props.mccId,
      // The event carries the authority too, so a consumer never has to ask why this pour names another village.
      diversionId: c.props.diversionId,
      shift: c.props.shift, collectedOn: c.props.collectedOn, amountMinor: c.props.amountMinor.toString() } });
    return c;
  }
  static rehydrate(props: MilkCollectionProps): MilkCollection { return new MilkCollection(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get amountMinor() { return this.props.amountMinor; }
  get holdState() { return this.props.holdState; }
  get membershipId() { return this.props.membershipId; }
  get isFlagged() { return this.props.holdState !== 'none'; }

  /** Move the hold, through the state machine — never by assignment. */
  moveHold(to: HoldState): void {
    assertHoldTransition(this.props.holdState, to);
    this.props = { ...this.props, holdState: to };
  }
  get weightMilliKg() { return this.props.weightMilliKg; }
  get collectedOn() { return this.props.collectedOn; }
  toProps(): Readonly<MilkCollectionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
}
