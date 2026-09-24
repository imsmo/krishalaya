// modules/education/domain/course.entity.ts · the courses aggregate (authoring + lifecycle). price_minor is
// bigint minor units (Law 2; 0 = free). Lifecycle via course.state. No version column → repo locks FOR UPDATE.
//
// PC-56 TENANT-7a: the row remembers the DESK — who submitted and when, who published or returned and when, the
// desk's note on a return, and the published/archived instants (migration 0170). Every transition takes the actor
// and the instant, because a status with no memory of how it got there is what let "Returned with notes" (W416) be a
// screen over an act nothing performed.
import { CourseStatus, CourseLevel, DomainEvent, EducationEventType } from './education.events';
import { assertTransition } from './course.state';
import { InvalidCourseError } from './education.errors';
import { applyBpsFloor } from '../../../core/money/rounding';

export interface CourseProps {
  id: string; tenantId: string | null; instructorId: string; defaultTitle: string; topicId: string | null;
  audienceRoleIds: string[]; level: CourseLevel; priceMinor: bigint; currencyCode: string; certEnabled: boolean;
  coverMediaId: string | null; status: CourseStatus; createdAt?: Date;
  submittedAt?: Date | null; submittedBy?: string | null;
  reviewedAt?: Date | null; reviewedBy?: string | null; reviewNote?: string | null;
  publishedAt?: Date | null; archivedAt?: Date | null;
  /** Read-side decoration from the registry (never written through this entity). */
  topicCode?: string | null; topicName?: string | null; lessonCount?: number | null;
  /** The price as major text at the currency's own scale (server-computed; null when the scale is unknown). */
  priceMajor?: string | null;
}
export class Course {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: CourseProps) {}

  static create(input: Omit<CourseProps, 'status'> & { status?: CourseStatus }): Course {
    if (!input.defaultTitle) throw new InvalidCourseError('title required');
    if (input.priceMinor < 0n) throw new InvalidCourseError('price cannot be negative');
    return new Course({ ...input, status: input.status ?? 'draft' });
  }
  static rehydrate(p: CourseProps): Course { return new Course(p); }

  /** Split paid-course revenue: instructor keeps royalty_bps (floored via the platform's canonical
   *  `applyBpsFloor`, DEV-26/Q15), platform takes the remainder. Zero-sum by construction (instructor +
   *  platform === price — the residual pattern Q15 ratifies, never two independently-floored shares). */
  static splitRevenue(priceMinor: bigint, royaltyBps: number): { instructorMinor: bigint; platformMinor: bigint } {
    const instructorMinor = applyBpsFloor(priceMinor, royaltyBps);
    return { instructorMinor, platformMinor: priceMinor - instructorMinor };
  }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get instructorId() { return this.props.instructorId; }
  get status() { return this.props.status; }
  get priceMinor() { return this.props.priceMinor; }
  /** The course's currency — the TENANT's since 7a; every purchase leg carries it (7d-money). */
  get currencyCode() { return this.props.currencyCode; }
  get isFree() { return this.props.priceMinor === 0n; }
  get certEnabled() { return this.props.certEnabled; }
  get submittedBy() { return this.props.submittedBy ?? null; }
  toProps(): Readonly<CourseProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: Partial<Pick<CourseProps, 'defaultTitle' | 'topicId' | 'audienceRoleIds' | 'level' | 'priceMinor' | 'certEnabled' | 'coverMediaId' | 'currencyCode'>>): void {
    if (this.props.status === 'archived') throw new InvalidCourseError('cannot edit an archived course');
    if (patch.priceMinor !== undefined && patch.priceMinor < 0n) throw new InvalidCourseError('price cannot be negative');
    for (const [k, v] of Object.entries(patch)) { if (v !== undefined) (this.props as any)[k] = v; }
  }

  /** draft → review. The maker is recorded; the desk's previous note is cleared because this is a new submission. */
  submitForReview(by: string, at: Date): void {
    this.transition('review');
    this.props.submittedAt = at; this.props.submittedBy = by; this.props.reviewNote = null;
  }
  /** review → published, by the CHECKER. Refused when the checker is the maker — the trigger in 0170 is the wall behind this door. */
  publish(by: string, at: Date): void {
    if (this.props.status === 'review' && this.props.submittedBy === by) throw new InvalidCourseError('maker cannot be checker');
    this.transition('published', EducationEventType.CoursePublished);
    this.props.reviewedAt = at; this.props.reviewedBy = by;
    if (!this.props.publishedAt) this.props.publishedAt = at;
  }
  /** review → draft with the desk's note (W416 "Returned with notes"). */
  returnToDraft(by: string, note: string, at: Date): void {
    if (!note.trim()) throw new InvalidCourseError('a return carries the desk\'s note');
    this.transition('draft');
    this.props.reviewedAt = at; this.props.reviewedBy = by; this.props.reviewNote = note.trim();
  }
  pause(): void { this.transition('paused'); }
  /** paused → published. Not a review, so the checker fields are untouched and `published_at` keeps its first instant. */
  resume(): void { this.transition('published'); }
  archive(at: Date): void { this.transition('archived', EducationEventType.CourseArchived); this.props.archivedAt = at; }

  private transition(to: CourseStatus, eventType?: string): void {
    const from = this.props.status; assertTransition(from, to); this.props.status = to;
    if (eventType) this.events.push({ type: eventType, payload: { courseId: this.props.id, from, to } });
  }
  toJSON() {
    const v = this.props;
    return {
      id: v.id, instructorId: v.instructorId, defaultTitle: v.defaultTitle, topicId: v.topicId, audienceRoleIds: v.audienceRoleIds, level: v.level,
      priceMinor: v.priceMinor.toString(), currencyCode: v.currencyCode, certEnabled: v.certEnabled, coverMediaId: v.coverMediaId, status: v.status, createdAt: v.createdAt,
      isPlatformLibrary: v.tenantId === null,
      submittedAt: v.submittedAt ?? null, submittedBy: v.submittedBy ?? null,
      reviewedAt: v.reviewedAt ?? null, reviewedBy: v.reviewedBy ?? null, reviewNote: v.reviewNote ?? null,
      publishedAt: v.publishedAt ?? null, archivedAt: v.archivedAt ?? null,
      topicCode: v.topicCode ?? null, topicName: v.topicName ?? null, lessonCount: v.lessonCount ?? null, priceMajor: v.priceMajor ?? null,
    };
  }
}
