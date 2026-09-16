// apps/web-tenant/src/features/courses/desk.ts · PURE helpers for the course record and the desk — PC-56 TENANT-7a.
//
// Four canon screens over one record: **W178** (the tenant's course library — the DESK's view), **W179** (one course,
// the desk's view of it, with the archive act), **W416** (review & publish — the gate checklist and the two acts that
// cross the maker-checker line), and the two shared chains, **W2546–W2549** (the course FORM: new course, edit course)
// and **W2550–W2552** (the course MUTATE: archive · submit for review · the `published` chip's pause/resume · the desk's
// publish and return). The API computes every verdict; this file turns them into hrefs, keys and states, and holds
// the three rulings the pages rely on:
//
//   • THE ROUTE IS `/courses`, NOT `/studio`. PC-26 built `/studio` as the INSTRUCTOR's own library (`box=mine`); W178
//     is the tenant CONTENT DESK's library — every instructor's course plus the platform library — and W410 (the
//     studio home) is a different screen in TENANT-7d. They share the record and nothing else. `/studio/[id]` keeps
//     the add-lesson form (the lesson chain is TENANT-7b's) and links here for every act on the course itself.
//   • NO PERCENTAGE THIS FILE INVENTS. Completion is `completed ÷ learners` in integer arithmetic, and NOTHING when
//     there are no learners — a `0%` on a course nobody has opened reads as a failure it is not.
//   • MONEY IS NEVER COMPUTED HERE. The tile W178 calls *"Instructor royalties (30d)"* is REFUSED by name: the money
//     path pays an instructor's wallet at purchase time and this platform has no royalty ledger to sum (TENANT-7d, W418).
import type { Course, CourseAct, CourseActVerdict, CourseGateCheck, CourseStats } from '@krishalaya/sdk-js';

/* --------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export const COURSES_HREF = '/courses';
export const NEW_COURSE_HREF = '/courses/new';
export function courseHref(id: string): string { return `/courses/${encodeURIComponent(id)}`; }
export function editCourseHref(id: string): string { return `/courses/new?id=${encodeURIComponent(id)}`; }
export function publishHref(id: string): string { return `/courses/${encodeURIComponent(id)}/publish`; }
/** The mutate chain's confirm step for one act on one course — the reason travels in the URL until it is written. */
export function actHref(id: string, act: CourseAct): string { return `/courses/${encodeURIComponent(id)}/act?step=confirm&act=${act}`; }
/** The lesson outline lives with PC-26's studio until TENANT-7b ships the lesson chain (W2664–W2670). */
export function lessonsHref(id: string): string { return `/studio/${encodeURIComponent(id)}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W178 · THE LIBRARY                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/** The canon's four chips, plus the fifth status the machine has and the canon's chips omit. Order is the canon's. */
export const STATUS_TABS = ['published', 'review', 'draft', 'paused', 'archived'] as const;
export type StatusTab = (typeof STATUS_TABS)[number];

export function statusTab(raw: string | null | undefined): StatusTab | null {
  return (STATUS_TABS as readonly string[]).includes(raw ?? '') ? (raw as StatusTab) : null;
}
/** A filter change RESETS the cursor: page 3 of "published" is not page 3 of "draft". */
export function libraryHref(status: StatusTab | null, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${COURSES_HREF}?${s}` : COURSES_HREF;
}
export function statusKey(status: string): string { return `courses.status.${status}`; }
export function levelKey(level: string): string { return `courses.level.${level}`; }

/** W178's Completion column — integer arithmetic, and NOTHING for a course nobody has opened. */
export function completionPct(stats: CourseStats | undefined | null): number | null {
  if (!stats || stats.learners <= 0) return null;
  return Math.floor((stats.completed * 100) / stats.learners);
}
/** Learners as a number, or null when this tenant has no enrolment row — never a zero the platform invented. */
export function learnersOf(stats: CourseStats | undefined | null): number | null { return stats ? stats.learners : null; }

/** The library row's origin, as a key: the tenant's own course, or the platform library's. */
export function originKey(c: Pick<Course, 'isPlatformLibrary'>): string { return c.isPlatformLibrary ? 'courses.origin.library' : 'courses.origin.own'; }

/** W178's fourth tile, refused by name. Exported so a test can assert the page never prints a rupee figure for it. */
export function royaltiesTileKey(): string { return 'courses.tile.royalties.refused'; }
export function royaltiesTileIsMoney(): false { return false; }

/* --------------------------------------------------------------------------------------------------------- */
/* PAGE STATES                                                                                               */
/* --------------------------------------------------------------------------------------------------------- */

export type CoursePageState = 'notEnabled' | 'restricted' | 'notFound' | 'error' | 'editRestricted';

/**
 * A transport failure → one of W178's own states. The module guard answers a bare 404 when `education` is OFF; the
 * record's own 404 (`COURSE_NOT_FOUND`) is a course that is not ours or does not exist — distinguished, because *"this
 * module is switched off"* and *"no such course"* are different sentences.
 */
export function courseTransportState(code: string | null | undefined, status?: number): CoursePageState {
  if (code === 'FORBIDDEN' || code === 'EDUCATION_FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'COURSE_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function pageStateKey(s: CoursePageState): string { return `courses.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W179 / W416 · THE ACTS                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export function actLabelKey(act: CourseAct): string { return `courses.act.${act}`; }
export function actRefusalKey(code: string): string { return `mutate.course.refusal.${code}`; }
export function actDoneKey(act: CourseAct): string { return `courses.actDone.${act}`; }

/** The acts a screen OFFERS: those the server allowed. The others are printed with their reasons, never as 403 buttons. */
export function offeredActs(acts: readonly CourseActVerdict[]): CourseActVerdict[] { return acts.filter((a) => a.allowed); }
export function refusedActs(acts: readonly CourseActVerdict[]): CourseActVerdict[] { return acts.filter((a) => !a.allowed); }
export function verdictFor(acts: readonly CourseActVerdict[], act: CourseAct): CourseActVerdict | null { return acts.find((a) => a.act === act) ?? null; }

/** W179's archive box is destructive and gets its own place; the rest of the acts sit in the actions row. */
export const DETAIL_ROW_ACTS: readonly CourseAct[] = ['submit', 'pause', 'resume'] as const;
/** W416's two desk acts. */
export const DESK_ACTS: readonly CourseAct[] = ['publish', 'return'] as const;

/* --------------------------------------------------------------------------------------------------------- */
/* W416 · THE GATE                                                                                           */
/* --------------------------------------------------------------------------------------------------------- */

export function gateCheckKey(code: string): string { return `courses.gate.${code}`; }
export function gateStateKey(state: CourseGateCheck['state']): string { return `courses.gateState.${state}`; }
/** Why a check is not measured — one sentence per unmeasured check, naming the table that does not exist. */
export function gateUnmeasuredKey(code: string): string { return `courses.gateWhy.${code}`; }
export function gateMeasuredText(c: CourseGateCheck): string | null { return c.measured ? `${c.measured.met}/${c.measured.of}` : null; }

export type PublishScreenState = 'returned' | 'nothingSubmitted' | 'underReview' | 'live' | 'paused' | 'archived' | 'deskOnly';
/** Which of W416's states this course is in. `returned` is the desk's note on a DRAFT — the canon's own state. */
export function publishScreenState(c: Pick<Course, 'status' | 'reviewNote'>): PublishScreenState {
  switch (c.status) {
    case 'draft': return c.reviewNote ? 'returned' : 'nothingSubmitted';
    case 'review': return 'underReview';
    case 'published': return 'live';
    case 'paused': return 'paused';
    default: return 'archived';
  }
}
export function publishScreenKey(s: PublishScreenState): string { return `courses.publish.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE FORM CHAIN                                                                                            */
/* --------------------------------------------------------------------------------------------------------- */

/** One list, shared by the reader, the form, the review table and the retry link — the API's `COURSE_FORM_FIELDS`. */
export const COURSE_FORM_FIELDS = ['defaultTitle', 'topicCode', 'level', 'priceMajor', 'certEnabled', 'coverMediaId'] as const;
export const COURSE_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
export const FORM = 'course';

/** The success screen's sentence differs for a create and an edit; the id in the URL says which it was. */
export function formDoneKey(isEdit: boolean): string { return isEdit ? 'form.course.updated' : 'form.course.created'; }
