// modules/education/domain/course-template.ts · PC-56 TENANT-7d · W410 / W2775–W2778 *"Start from template"* — the studio
// form's review, computed from the facts the writer uses (7a's rule, 6d-4's shape).
//
// The canon's studio module names ONE action on this chain: *"Start from template"*, and W410's empty state promises
// *"outline, quiz and publish checklist already scaffolded"*. 7a named the button as refused: no template table
// existed. 0173's `course_templates` is a registry (Law 6 — a platform row, or a tenant's own), and this file turns one
// of its rows into WHAT WILL BE WRITTEN: a DRAFT course (the tenant's currency, free — a price is the course form's
// question and a paid course is the desk's key, 7a), with one DRAFT lesson per outline entry — no media, no body, a quiz
// lesson with no questions yet (W413's chain adds them). The publish checklist is W416's gate, which every course has.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: the topic and level the template carries, the outline as it will be
// written (module · lesson · kind), and the count of quiz lessons still empty. WHAT IT REFUSES BY NAME: a template the
// registry does not hold (`TEMPLATE_UNKNOWN`), a template whose topic the `course_topic` registry no longer has
// (`TOPIC_UNKNOWN`), an outline that is not one (`TEMPLATE_INVALID` — a platform data defect is refused, never written
// half-way), a tenant whose currency has no scale (`CURRENCY_UNKNOWN`, 7a's rule), and a caller with no instructor row
// (`NO_INSTRUCTOR_PROFILE` — the course belongs to one).
import { ReviewField, ReviewRefusal, ReviewResult, WRITER_REFUSALS, WriterIssue, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { CONTENT_KINDS, ContentKind, CourseLevel } from './education.events';

export const TEMPLATE_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NO_INSTRUCTOR_PROFILE', 'TEMPLATE_REQUIRED', 'TEMPLATE_UNKNOWN', 'TEMPLATE_INACTIVE', 'TEMPLATE_INVALID', 'TOPIC_UNKNOWN', 'CURRENCY_UNKNOWN', 'TITLE_REQUIRED',
  ...WRITER_REFUSALS,
] as const;
export type TemplateReviewRefusal = (typeof TEMPLATE_REVIEW_REFUSALS)[number];

export const TEMPLATE_FORM_FIELDS = ['templateCode', 'title'] as const;
export type TemplateFormField = (typeof TEMPLATE_FORM_FIELDS)[number];

/** A registry row, as the review needs it. */
export interface CourseTemplateRow { id: string; code: string; title: string; topicCode: string; level: CourseLevel; outline: unknown; isActive: boolean; tenantId: string | null }
export interface OutlineLesson { title: string; kind: ContentKind }
export interface OutlineModule { title: string; lessons: OutlineLesson[] }

/** The lesson kinds a template may scaffold: everything a lesson can be except `live` (a class is scheduled, never scaffolded). */
export const TEMPLATE_LESSON_KINDS: ReadonlySet<string> = new Set(CONTENT_KINDS.filter((k) => k !== 'live'));
export const MAX_TEMPLATE_MODULES = 20;
export const MAX_TEMPLATE_LESSONS_PER_MODULE = 30;

/** The outline as the registry holds it → modules and lessons, or null when it is not an outline at all. */
export function parseOutline(raw: unknown): OutlineModule[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TEMPLATE_MODULES) return null;
  const out: OutlineModule[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null;
    const title = typeof (m as any).title === 'string' ? (m as any).title.trim() : '';
    const lessons = (m as any).lessons;
    if (title.length === 0 || !Array.isArray(lessons) || lessons.length === 0 || lessons.length > MAX_TEMPLATE_LESSONS_PER_MODULE) return null;
    const ls: OutlineLesson[] = [];
    for (const l of lessons) {
      if (!l || typeof l !== 'object') return null;
      const lt = typeof (l as any).title === 'string' ? (l as any).title.trim() : '';
      const kind = typeof (l as any).kind === 'string' ? (l as any).kind.trim() : '';
      if (lt.length === 0 || !TEMPLATE_LESSON_KINDS.has(kind)) return null;
      ls.push({ title: lt, kind: kind as ContentKind });
    }
    out.push({ title, lessons: ls });
  }
  return out;
}

export interface TemplateReviewInput {
  canAuthor: boolean; hasInstructorProfile: boolean;
  /** The template named: undefined = nothing typed; null = typed and the registry has no such row visible to this tenant. */
  template: CourseTemplateRow | null | undefined;
  /** The `course_topic` registry row for the template's topic (null = the registry no longer holds it). */
  topic: { id: string; code: string; name: string } | null;
  /** The tenant's currency (null = no scale on this platform — refused, never guessed). */
  money: { currencyCode: string; minorUnits: number } | null;
  entered: Partial<Record<TemplateFormField, string | null | undefined>>;
  writerIssues?: readonly WriterIssue[];
}
export interface TemplateStored { templateId: string; defaultTitle: string; topicId: string; level: CourseLevel; currencyCode: string; outline: OutlineModule[] }

const outlineText = (o: OutlineModule[]) => o.map((m, mi) => m.lessons.map((l, li) => `${mi + 1}·${li + 1} ${m.title} — ${l.title} · ${l.kind}`).join('\n')).join('\n');

export function reviewFromTemplate(i: TemplateReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  if (!i.canAuthor) refusals.push({ field: null, code: 'NO_AUTHOR' });
  else if (!i.hasInstructorProfile) refusals.push({ field: null, code: 'NO_INSTRUCTOR_PROFILE' });

  const codeTyped = trimOrNull(i.entered.templateCode);
  let outline: OutlineModule[] | null = null;
  if (codeTyped === null) refusals.push({ field: 'templateCode', code: 'TEMPLATE_REQUIRED' });
  else if (!i.template) refusals.push({ field: 'templateCode', code: 'TEMPLATE_UNKNOWN' });
  else {
    if (!i.template.isActive) refusals.push({ field: 'templateCode', code: 'TEMPLATE_INACTIVE' });
    outline = parseOutline(i.template.outline);
    if (outline === null) refusals.push({ field: 'templateCode', code: 'TEMPLATE_INVALID' });
    if (i.topic === null) refusals.push({ field: 'templateCode', code: 'TOPIC_UNKNOWN' });
  }
  if (i.money === null) refusals.push({ field: null, code: 'CURRENCY_UNKNOWN' });

  // the title: what was typed, or the template's own when the form left it blank (shown as normalised)
  const titleTyped = trimOrNull(i.entered.title);
  const title = titleTyped ?? trimOrNull(i.template?.title) ?? null;
  // only a template with a blank title of its own can leave the course untitled; an unknown template is already the whole answer
  if (i.template && title === null) refusals.push({ field: 'title', code: 'TITLE_REQUIRED' });

  const quizzes = outline === null ? 0 : outline.reduce((n, m) => n + m.lessons.filter((l) => l.kind === 'quiz').length, 0);
  const lessons = outline === null ? 0 : outline.reduce((n, m) => n + m.lessons.length, 0);
  const fields: ReviewField[] = [
    field('templateCode', i.entered.templateCode ?? null, i.template ? `${i.template.code} · ${i.template.title}` : null),
    field('title', i.entered.title ?? null, title),
    // NEVER TYPED, ALWAYS SHOWN: what the template carries and what will be written
    field('topic', null, i.topic ? `${i.topic.code} · ${i.topic.name}` : null),
    field('level', null, i.template?.level ?? null),
    field('currency', null, i.money?.currencyCode ?? null),
    field('outline', null, outline === null ? null : outlineText(outline)),
    field('counts', null, outline === null ? null : `${outline.length} · ${lessons} · ${quizzes}`),
    field('status', null, 'draft'),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));
  return reviewResult('course', fields, refusals, null);
}

export function storedFromTemplate(i: TemplateReviewInput): TemplateStored | null {
  const r = reviewFromTemplate(i);
  if (!r.ready || !i.template || !i.topic || !i.money) return null;
  const outline = parseOutline(i.template.outline);
  if (outline === null) return null;
  return { templateId: i.template.id, defaultTitle: (trimOrNull(i.entered.title) ?? i.template.title), topicId: i.topic.id, level: i.template.level, currencyCode: i.money.currencyCode, outline };
}
