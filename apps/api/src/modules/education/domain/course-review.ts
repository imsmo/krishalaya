// modules/education/domain/course-review.ts · PC-56 TENANT-7a · the course form's review step — W2547 (review),
// W2546 (form-error) — as a decision computed from the facts the writer uses, never an echo of what was typed.
//
// The canon's course module names three actions that share this chain: *"Add lesson · New course · Start from
// template"*. This reviewer answers NEW COURSE and EDIT COURSE (W179: *"Course editing restricted — editing needs
// content scope + instructor consent; price changes need tenant_admin"*). *Add lesson* belongs to the lesson module's
// own chain (W2664–W2667, TENANT-7b); *Start from template* is named, not built (there is no template table).
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED
//   • the CURRENCY — resolved from the tenant's country, never typed, printed as its own row because a price with no
//     currency beside it is a number, not money;
//   • the price AS STORED — `149` becomes `149.00` at INR's scale and `149` at JPY's; the digits move, nothing is
//     multiplied;
//   • the topic as `code · name` from the registry, so a typo'd code is refused by name rather than stored as NULL.
//
// THE MONEY GATE (W178: *"paid courses need tenant_admin (money)"*; W179: *"price changes need tenant_admin"*).
// `course.author` is granted to every member role (0004), so without this gate any member could price a course and
// take 80% of what other members pay for it. A non-zero price on a create, or ANY change of price on an edit, needs
// `course.publish` — the desk's key. The instructor can still author a free course alone. *"Instructor agreement on
// record"* has no table and is named, not built.
import {
  ReviewDiffRow, ReviewField, ReviewRefusal, ReviewResult, WRITER_REFUSALS, WriterIssue, field, reviewResult, trimOrNull,
  writerRefusals,
} from '../../../shared/form-review';
import { COURSE_LEVELS, CourseLevel } from './education.events';
import { MoneyShape, isFree, minorToMajorText, parseMajorToMinor } from './course-money';

export const COURSE_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NO_INSTRUCTOR_PROFILE', 'CURRENCY_UNKNOWN',
  'COURSE_NOT_FOUND', 'COURSE_ARCHIVED', 'NOT_OWNER',
  'TITLE_REQUIRED', 'TOPIC_UNKNOWN', 'LEVEL_INVALID', 'PRICE_INVALID', 'PAID_NEEDS_DESK', 'COVER_UNKNOWN',
  ...WRITER_REFUSALS,
] as const;
export type CourseReviewRefusal = (typeof COURSE_REVIEW_REFUSALS)[number];

/** Every field the chain carries — one list, shared by the reviewer, the DTO and the console's form. */
export const COURSE_FORM_FIELDS = ['defaultTitle', 'topicCode', 'level', 'priceMajor', 'certEnabled', 'coverMediaId'] as const;
export type CourseFormField = (typeof COURSE_FORM_FIELDS)[number];

/** The course as it stands, for an EDIT's diff. Null on a create. */
export interface CurrentCourse {
  status: string; instructorUserId: string | null;
  defaultTitle: string; topicCode: string | null; level: string; priceMinor: string; certEnabled: boolean; coverMediaId: string | null;
}

export interface CourseReviewInput {
  canAuthor: boolean;
  canPublish: boolean;
  /** The caller has an instructor row in this tenant (W410: *"this tenant hasn't marked you an instructor yet"*). */
  hasInstructorProfile: boolean;
  actorUserId: string;
  entered: Partial<Record<CourseFormField, string | null | undefined>>;
  /** Registry lookup of `topicCode`: undefined = nothing typed; null = typed and unknown. */
  topic: { code: string; name: string } | null | undefined;
  /** Registry lookup of `coverMediaId`: undefined = nothing typed; null = typed and no such asset in this tenant. */
  cover: { id: string } | null | undefined;
  /** The tenant's currency and its scale; null when the platform holds no scale for it (6e-1's finding). */
  money: MoneyShape | null;
  /** Edit mode: the row as it stands (undefined = create; null = an id was named and no such course is ours). */
  current?: CurrentCourse | null;
  writerIssues?: readonly WriterIssue[];
}

/** What the writer will be handed when `ready`. Minor units, resolved ids — the create/update DTO's own shape. */
export interface CourseReviewStored {
  defaultTitle: string; topicId: string | null; level: CourseLevel; priceMinor: string; currencyCode: string; certEnabled: boolean; coverMediaId: string | null;
}

const truthy = (s: string | null | undefined): boolean => ['1', 'true', 'on', 'yes'].includes((s ?? '').trim().toLowerCase());

export function reviewCourse(i: CourseReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  const isEdit = i.current !== undefined;
  // The desk (course.publish) may EDIT any course of the tenant without an author key; only an author CREATES.
  if (!i.canAuthor && !(isEdit && i.canPublish)) refusals.push({ field: null, code: 'NO_AUTHOR' });
  if (!i.hasInstructorProfile && !isEdit) refusals.push({ field: null, code: 'NO_INSTRUCTOR_PROFILE' });
  if (i.money === null) refusals.push({ field: null, code: 'CURRENCY_UNKNOWN' });
  if (isEdit) {
    const cur = i.current;
    if (!cur) refusals.push({ field: null, code: 'COURSE_NOT_FOUND' });
    else {
      if (cur.status === 'archived') refusals.push({ field: null, code: 'COURSE_ARCHIVED' });
      // The desk may edit any course of the tenant; an author only their own. 404-shaped for a probe, named here
      // because the review's job is to say why.
      if (cur.instructorUserId !== i.actorUserId && !i.canPublish) refusals.push({ field: null, code: 'NOT_OWNER' });
    }
  }

  const title = trimOrNull(i.entered.defaultTitle);
  if (title === null) refusals.push({ field: 'defaultTitle', code: 'TITLE_REQUIRED' });

  const topicTyped = trimOrNull(i.entered.topicCode);
  if (topicTyped !== null && (i.topic === null || i.topic === undefined)) refusals.push({ field: 'topicCode', code: 'TOPIC_UNKNOWN' });
  const topicStored = topicTyped === null ? null : i.topic ? `${i.topic.code} · ${i.topic.name}` : null;

  const levelTyped = trimOrNull(i.entered.level);
  const level: CourseLevel = (levelTyped ?? 'basic') as CourseLevel;
  const levelOk = (COURSE_LEVELS as readonly string[]).includes(level);
  if (!levelOk) refusals.push({ field: 'level', code: 'LEVEL_INVALID' });

  // A blank price is FREE — W178: *"80% of content stays free by playbook"* — and the review says `0.00`, not nothing.
  const priceTyped = trimOrNull(i.entered.priceMajor);
  let priceMinor: string | null = null;
  let priceStored: string | null = null;
  if (i.money !== null) {
    priceMinor = priceTyped === null ? '0' : parseMajorToMinor(priceTyped, i.money.minorUnits);
    if (priceMinor === null) refusals.push({ field: 'priceMajor', code: 'PRICE_INVALID' });
    else priceStored = minorToMajorText(priceMinor, i.money.minorUnits);
  }
  if (priceMinor !== null) {
    const paidCreate = !isEdit && !isFree(priceMinor);
    const priceChanged = isEdit && i.current != null && i.current.priceMinor !== priceMinor;
    if ((paidCreate || priceChanged) && !i.canPublish) refusals.push({ field: 'priceMajor', code: 'PAID_NEEDS_DESK' });
  }

  const cert = truthy(i.entered.certEnabled);
  const coverTyped = trimOrNull(i.entered.coverMediaId);
  if (coverTyped !== null && !i.cover) refusals.push({ field: 'coverMediaId', code: 'COVER_UNKNOWN' });

  const fields: ReviewField[] = [
    field('defaultTitle', i.entered.defaultTitle ?? null, title),
    field('topicCode', i.entered.topicCode ?? null, topicStored),
    field('level', i.entered.level ?? null, levelOk ? level : null),
    field('priceMajor', i.entered.priceMajor ?? null, priceStored),
    // NEVER TYPED, ALWAYS SHOWN: the currency the price will be stored in.
    field('currencyCode', null, i.money?.currencyCode ?? null),
    field('certEnabled', i.entered.certEnabled ?? null, cert ? 'yes' : 'no'),
    field('coverMediaId', i.entered.coverMediaId ?? null, i.cover ? i.cover.id : null),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));

  // W2547: *"the diff against current values where applicable"* — an EDIT has one, a CREATE does not.
  let diff: ReviewDiffRow[] | null = null;
  if (isEdit && i.current) {
    diff = [];
    const push = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    push('defaultTitle', i.current.defaultTitle, title);
    push('topicCode', i.current.topicCode, topicTyped === null ? null : (i.topic?.code ?? topicTyped));
    push('level', i.current.level, levelOk ? level : null);
    if (i.money) push('priceMajor', minorToMajorText(i.current.priceMinor, i.money.minorUnits), priceStored);
    push('certEnabled', i.current.certEnabled ? 'yes' : 'no', cert ? 'yes' : 'no');
    push('coverMediaId', i.current.coverMediaId, i.cover ? i.cover.id : null);
  }
  return reviewResult('course', fields, refusals, diff);
}

/**
 * The body the writer receives when the review is `ready`. Computed HERE so the chain's submit hands the API exactly
 * what the review showed — the same digits, the same resolved ids — and a review that said `149.00` cannot be
 * followed by a row that says `149`.
 */
export function storedCourse(i: CourseReviewInput, topicId: string | null): CourseReviewStored | null {
  const r = reviewCourse(i);
  if (!r.ready || i.money === null) return null;
  const priceTyped = trimOrNull(i.entered.priceMajor);
  const priceMinor = priceTyped === null ? '0' : (parseMajorToMinor(priceTyped, i.money.minorUnits) as string);
  return {
    defaultTitle: trimOrNull(i.entered.defaultTitle) as string,
    topicId: trimOrNull(i.entered.topicCode) === null ? null : topicId,
    level: (trimOrNull(i.entered.level) ?? 'basic') as CourseLevel,
    priceMinor, currencyCode: i.money.currencyCode,
    certEnabled: truthy(i.entered.certEnabled),
    coverMediaId: i.cover ? i.cover.id : null,
  };
}
