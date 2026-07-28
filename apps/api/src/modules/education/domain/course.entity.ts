// modules/education/domain/course.entity.ts · the courses aggregate (authoring + lifecycle). price_minor is
// bigint minor units (Law 2; 0 = free). Lifecycle via course.state. No version column → repo locks FOR UPDATE.
import { CourseStatus, CourseLevel, DomainEvent, EducationEventType } from './education.events';
import { assertTransition } from './course.state';
import { InvalidCourseError } from './education.errors';
import { applyBpsFloor } from '../../../core/money/rounding';

export interface CourseProps {
  id: string; tenantId: string | null; instructorId: string; defaultTitle: string; topicId: string | null;
  audienceRoleIds: string[]; level: CourseLevel; priceMinor: bigint; currencyCode: string; certEnabled: boolean;
  coverMediaId: string | null; status: CourseStatus; createdAt?: Date;
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
  get isFree() { return this.props.priceMinor === 0n; }
  get certEnabled() { return this.props.certEnabled; }
  toProps(): Readonly<CourseProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: Partial<Pick<CourseProps, 'defaultTitle' | 'topicId' | 'audienceRoleIds' | 'level' | 'priceMinor' | 'certEnabled' | 'coverMediaId'>>): void {
    if (this.props.status === 'archived') throw new InvalidCourseError('cannot edit an archived course');
    if (patch.priceMinor !== undefined && patch.priceMinor < 0n) throw new InvalidCourseError('price cannot be negative');
    for (const [k, v] of Object.entries(patch)) { if (v !== undefined) (this.props as any)[k] = v; }
  }
  submitForReview(): void { this.transition('review'); }
  publish(): void { this.transition('published', EducationEventType.CoursePublished); }
  pause(): void { this.transition('paused'); }
  archive(): void { this.transition('archived', EducationEventType.CourseArchived); }

  private transition(to: CourseStatus, eventType?: string): void {
    const from = this.props.status; assertTransition(from, to); this.props.status = to;
    if (eventType) this.events.push({ type: eventType, payload: { courseId: this.props.id, from, to } });
  }
  toJSON() {
    const v = this.props;
    return { id: v.id, instructorId: v.instructorId, defaultTitle: v.defaultTitle, topicId: v.topicId, audienceRoleIds: v.audienceRoleIds, level: v.level,
      priceMinor: v.priceMinor.toString(), currencyCode: v.currencyCode, certEnabled: v.certEnabled, coverMediaId: v.coverMediaId, status: v.status, createdAt: v.createdAt };
  }
}
