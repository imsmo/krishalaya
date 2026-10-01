// modules/cms/domain/page-acts.ts · PC-56 TENANT-8c · THE PAGES — the acts on one page VERSION, and every reason each
// would be refused, in ONE place (Law 5; the transitions themselves are `cms-page.state.ts`, which 0177's trigger
// mirrors).
//
//     draft ──publish (cms.pages.publish; a POLICY page: never by its author or last editor)──▶ published
//       │                                        └─ the slug's previous own published version → archived `superseded`
//       └──archive (a reason from the vocabulary)──▶ archived ◀──archive── published
//     archived ──restore (cms.pages.manage)──▶ a NEW draft vN+1 carrying its words — the archived row never changes
//
// W2700 names the page chain's acts: *"Archive · Publish v3 · Retry now."* *Retry now* is W176's "Couldn't save draft"
// card — a re-save, which in this console is the form chain's own Retry (values in the URL), not an act. RESTORE is the
// brief's: an archived version comes back as the next DRAFT, so "what did the policy say when I ordered?" keeps its
// answer — history is never rewritten to make an old version live again. UNPUBLISH is not an act of its own: archiving
// the published version IS taking it off, and the confirm screen says what serves after (the platform's page, or none).
//
// The publish rule on a policy page is the canon's *"policy needs tenant_admin + checker"* (W176): terms, privacy and
// refund pages bind the cooperative to its members (Law 12 — a trust surface), so the person who publishes one is a
// second person. `cms_pages_guard` (0177) refuses the same publish in the database (23514).
import { canTransition } from './cms-page.state';
import { PageStatus } from './cms.events';
import { bodyIsMarkdown } from './page-rules';

export const PAGE_ACTS = ['publish', 'archive', 'restore'] as const;
export type PageAct = (typeof PAGE_ACTS)[number];
export function isPageAct(s: string): s is PageAct { return (PAGE_ACTS as readonly string[]).includes(s); }

export const MIN_ACT_REASON = 3;
export const MAX_ACT_REASON = 300;

export const PAGE_ACT_REFUSALS = [
  'NO_PERMISSION',            // publish / archive a live page: cms.pages.publish · archive a draft, restore: cms.pages.manage
  'PLATFORM_PAGE',            // the platform's page is read-only here (Law 11) — write your own version instead
  'ILLEGAL_FROM_STATUS',
  'MAKER_IS_CHECKER',         // a policy page published by its own author or last editor
  'BODY_NOT_MARKDOWN',        // a draft written before 0177 that carries raw HTML / a script link — edit it first
  'DRAFT_OPEN',               // restore beside an undecided draft of the same slug
  'ARCHIVE_REASON_REQUIRED',
  'ARCHIVE_REASON_UNKNOWN',   // not a code a person may choose (`superseded` / `unrecorded` are the platform's)
  'REASON_REQUIRED',
  'REASON_TOO_LONG',
  'REFUSED_BY_DATABASE',      // 0177's guard said no to something this verdict did not foresee (a 23514, printed — never a 500)
] as const;
export type PageActRefusal = (typeof PAGE_ACT_REFUSALS)[number];

export interface PageActTarget {
  tenantOwned: boolean;
  status: PageStatus;
  pageKind: string;
  createdBy: string | null;
  lastEditedBy: string | null;
  body: string;
}

export interface PageActInput {
  act: PageAct;
  canAuthor: boolean;        // cms.pages.manage
  canPublish: boolean;       // cms.pages.publish
  page: PageActTarget;
  /** The tenant's open draft of the same slug (restore refuses beside one). */
  openDraftExists: boolean;
  actorUserId: string;
  reason: string | null | undefined;
  /** archive only: the code chosen, and the codes a person may choose (the vocabulary's `chosen` rows). */
  archiveReason?: string | null;
  archiveReasons?: readonly string[];
}

export interface PageActVerdict { act: PageAct; allowed: boolean; refusals: PageActRefusal[]; to: PageStatus | null }

/** The status an act takes this version to (`restore` leaves it archived and mints a draft — `to` is the NEW row's). */
export function actTarget(from: PageStatus, act: PageAct): PageStatus | null {
  if (act === 'publish') return canTransition(from, 'published') ? 'published' : null;
  if (act === 'archive') return canTransition(from, 'archived') ? 'archived' : null;
  return from === 'archived' ? 'draft' : null;
}

/** Whether this actor is a maker of this version (its author, or the last member who changed its words). */
export function isMaker(page: Pick<PageActTarget, 'createdBy' | 'lastEditedBy'>, actorUserId: string): boolean {
  return (page.createdBy !== null && page.createdBy === actorUserId) || (page.lastEditedBy !== null && page.lastEditedBy === actorUserId);
}

/** The verb an act needs: publish and taking a LIVE page down are the checker's (cms.pages.publish); restoring is the
 *  author's (cms.pages.manage); withdrawing a draft is either's. */
export function actPermitted(act: PageAct, status: PageStatus, canAuthor: boolean, canPublish: boolean): boolean {
  if (act === 'publish') return canPublish;
  if (act === 'restore') return canAuthor;
  return status === 'published' ? canPublish : canAuthor || canPublish;
}

/** A policy page's publisher must be a second person. */
export function needsChecker(pageKind: string): boolean { return pageKind === 'policy'; }

/** Every reason this act would be refused, not the first — the confirm screen prints them all (6d-5's rule). */
export function pageActVerdict(i: PageActInput): PageActVerdict {
  const refusals: PageActRefusal[] = [];
  const p = i.page;
  // Who may: publishing, and taking a LIVE page down, are the checker's; withdrawing a draft and restoring are the author's.
  if (!actPermitted(i.act, p.status, i.canAuthor, i.canPublish)) refusals.push('NO_PERMISSION');
  if (!p.tenantOwned) refusals.push('PLATFORM_PAGE');

  const to = actTarget(p.status, i.act);
  if (to === null) refusals.push('ILLEGAL_FROM_STATUS');
  if (i.act === 'publish' && to !== null && needsChecker(p.pageKind) && isMaker(p, i.actorUserId)) refusals.push('MAKER_IS_CHECKER');
  // A body written before 0177 may carry raw HTML: it cannot be published, nor restored into a new draft, until edited.
  if ((i.act === 'publish' || i.act === 'restore') && to !== null && !bodyIsMarkdown(p.body)) refusals.push('BODY_NOT_MARKDOWN');
  if (i.act === 'restore' && to !== null && i.openDraftExists) refusals.push('DRAFT_OPEN');
  if (i.act === 'archive') {
    const code = (i.archiveReason ?? '').trim();
    if (code.length === 0) refusals.push('ARCHIVE_REASON_REQUIRED');
    else if (!(i.archiveReasons ?? []).includes(code)) refusals.push('ARCHIVE_REASON_UNKNOWN');
  }
  const reason = (i.reason ?? '').trim();
  if (reason.length < MIN_ACT_REASON) refusals.push('REASON_REQUIRED');
  else if (reason.length > MAX_ACT_REASON) refusals.push('REASON_TOO_LONG');
  return { act: i.act, allowed: refusals.length === 0, refusals, to };
}

/** A verdict with the typed-input refusals set aside — for drawing W176's buttons, which exist before any reason does. */
export function ignoringInput(v: PageActVerdict): PageActVerdict {
  const typed: ReadonlySet<PageActRefusal> = new Set<PageActRefusal>(['REASON_REQUIRED', 'REASON_TOO_LONG', 'ARCHIVE_REASON_REQUIRED', 'ARCHIVE_REASON_UNKNOWN']);
  const refusals = v.refusals.filter((r) => !typed.has(r));
  return { ...v, refusals, allowed: refusals.length === 0 };
}

/** Every act's verdict, in the canon's order. */
export function allPageVerdicts(base: Omit<PageActInput, 'act'>): PageActVerdict[] {
  return PAGE_ACTS.map((act) => pageActVerdict({ ...base, act }));
}
