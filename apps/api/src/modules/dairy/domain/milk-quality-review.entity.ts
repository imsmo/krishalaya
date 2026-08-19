// modules/dairy/domain/milk-quality-review.entity.ts · the record of what happened after a flag (PC-56 TENANT-6b-1).
//
// W168's footer: *"Flag decisions are recorded · pour-level hold, never wallet freeze · member notified in Gujarati."*
// Before this wave NONE of that existed: the flag was a boolean on a pour, nothing recorded a re-test, an outcome, a
// decider or a notification, and the pour was paid in the next bill anyway. This aggregate is the record — and it is
// deliberately strict about the difference between *what the platform knows* and *what somebody asserted*.
import { DomainEvent, DairyEventType, MilkShift } from './dairy.events';
import { InvalidCollectionError } from './dairy.errors';
import { ReviewStatus, assertReviewTransition, holdFor, needsCommitteeReview, COMMITTEE_REVIEW_WINDOW_DAYS } from './milk-quality.state';

export interface MilkQualityReviewProps {
  id: string;
  tenantId: string;
  collectionId: string;
  collectedOn: string;
  membershipId: string;
  mccId: string;
  shift: MilkShift;

  waterFlag: boolean;
  reasons: string[];
  densityAtFlag: string | null;
  fatPctAtFlag: string | null;
  snfPctAtFlag: string | null;
  amountWithheldMinor: bigint;
  currencyCode: string;

  sampleSealed: boolean;
  status: ReviewStatus;
  openedAt?: Date;
  openedBy: string | null;

  retestAt: Date | null;
  retestBy: string | null;
  memberPresent: boolean | null;

  outcomeNote: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;

  priorReviews90d: number;
  committeeReviewRequired: boolean;
}

export class MilkQualityReview {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MilkQualityReviewProps) {}

  /**
   * Open a review for a pour that was just flagged. Called INSIDE the pour's own transaction, so a hold can never
   * exist without the record that explains it — a held pour with no review is money withheld for no stated reason,
   * which is worse than the defect this wave fixed.
   *
   * `priorReviews90d` is passed in (the repository counts it) rather than derived here, because it is a fact about the
   * database and this file is pure.
   */
  static open(input: Omit<MilkQualityReviewProps, 'status' | 'committeeReviewRequired' | 'sampleSealed' | 'retestAt' | 'retestBy' | 'memberPresent' | 'outcomeNote' | 'decidedAt' | 'decidedBy'>
    & { sampleSealed?: boolean }, farmerUserId: string | null): MilkQualityReview {
    if (!input.waterFlag && input.reasons.filter((r) => !!r).length === 0)
      throw new InvalidCollectionError('a quality review needs at least one reason');
    if (input.amountWithheldMinor < 0n) throw new InvalidCollectionError('withheld amount cannot be negative');

    const committee = needsCommitteeReview(input.priorReviews90d);
    const r = new MilkQualityReview({
      ...input,
      reasons: input.reasons.filter((x) => !!x),
      sampleSealed: input.sampleSealed ?? false,
      status: 'open',
      retestAt: null, retestBy: null, memberPresent: null,
      outcomeNote: null, decidedAt: null, decidedBy: null,
      committeeReviewRequired: committee,
    });
    // The event carries `farmerUserId` because a map row pointing at a payload with no recipient looks like a fix and
    // changes nothing — ADMIN-6b's finding, and the reason W168's "member notified in Gujarati" can be kept at all.
    r.events.push({
      type: DairyEventType.QualityFlagOpened,
      payload: {
        reviewId: r.props.id, collectionId: r.props.collectionId, membershipId: r.props.membershipId,
        userId: farmerUserId, mccId: r.props.mccId, collectedOn: r.props.collectedOn, shift: r.props.shift,
        reasons: r.props.reasons, waterFlag: r.props.waterFlag,
        amountWithheldMinor: r.props.amountWithheldMinor.toString(), currencyCode: r.props.currencyCode,
        committeeReviewRequired: committee, priorReviews90d: r.props.priorReviews90d,
        windowDays: COMMITTEE_REVIEW_WINDOW_DAYS,
      },
    });
    return r;
  }

  static rehydrate(props: MilkQualityReviewProps): MilkQualityReview { return new MilkQualityReview(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get collectionRef() { return { id: this.props.collectionId, collectedOn: this.props.collectedOn }; }
  /** What the pour's hold must be, given where this review has got to. One source of truth for both. */
  get holdState() { return holdFor(this.props.status); }

  /**
   * W168 step 1: *"Operator re-tests sealed sample with member present."*
   *
   * `memberPresent` is recorded as given and never defaulted to true: "with member present" is the dignity half of the
   * promise, and a platform that assumes it turns a safeguard into a formality.
   */
  retest(by: string, at: Date, memberPresent: boolean, note: string | null): void {
    assertReviewTransition(this.props.status, 'retested');
    this.props = { ...this.props, status: 'retested', retestAt: at, retestBy: by, memberPresent, outcomeNote: note ?? this.props.outcomeNote };
  }

  /**
   * The decision. `cleared` releases the pour's payment; `rejected` means the cooperative did not buy that milk.
   *
   * A decision taken WITHOUT a re-test is allowed — an operator who flagged the wrong pour must be able to say so, and
   * a member who admits the dilution at the counter should not have to wait for a ceremony — but it is never hidden:
   * `retestAt` stays null and the desk shows the decision as taken without re-testing the sealed sample.
   */
  decide(outcome: 'cleared' | 'rejected', by: string, at: Date, note: string | null): void {
    assertReviewTransition(this.props.status, outcome);
    this.props = { ...this.props, status: outcome, decidedAt: at, decidedBy: by, outcomeNote: note ?? this.props.outcomeNote };
    this.events.push({
      type: DairyEventType.QualityFlagDecided,
      payload: {
        reviewId: this.props.id, collectionId: this.props.collectionId, membershipId: this.props.membershipId,
        outcome, holdState: this.holdState, retested: this.props.retestAt !== null, memberPresent: this.props.memberPresent,
        amountMinor: this.props.amountWithheldMinor.toString(), currencyCode: this.props.currencyCode,
      },
    });
  }

  /** Somebody asserting the physical sample was retained and sealed — with their name on it, at a time. */
  markSampleSealed(): void { this.props = { ...this.props, sampleSealed: true }; }

  toProps(): Readonly<MilkQualityReviewProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, collectionId: v.collectionId, collectedOn: v.collectedOn, membershipId: v.membershipId,
      mccId: v.mccId, shift: v.shift, status: v.status, holdState: this.holdState,
      waterFlag: v.waterFlag, reasons: v.reasons,
      densityAtFlag: v.densityAtFlag, fatPctAtFlag: v.fatPctAtFlag, snfPctAtFlag: v.snfPctAtFlag,
      amountWithheldMinor: v.amountWithheldMinor.toString(), currencyCode: v.currencyCode,
      sampleSealed: v.sampleSealed,
      openedAt: v.openedAt?.toISOString() ?? null, openedBy: v.openedBy,
      retestAt: v.retestAt?.toISOString() ?? null, retestBy: v.retestBy, memberPresent: v.memberPresent,
      outcomeNote: v.outcomeNote, decidedAt: v.decidedAt?.toISOString() ?? null, decidedBy: v.decidedBy,
      priorReviews90d: v.priorReviews90d, committeeReviewRequired: v.committeeReviewRequired,
    };
  }
}
