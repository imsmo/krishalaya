// apps/admin-api/src/modules/schemes-registry-ops/services/window-calendar.service.ts · the application-window
// surface: setWindow (WHEN a scheme accepts applications) + the read-only CALENDAR (which active schemes are open on
// a given 'MM-DD', year-wrap aware) with the closing-soon derivation W073 needs.
//
// BEHAVIOUR CHANGE, AND THE CANON ASKED FOR IT IN SO MANY WORDS. `setWindow` used to UPDATE `schemes.application_window`
// directly, with no version and — by an explicit decision recorded in the old header — no version bump, on the theory
// that a window is "operational, not an eligibility/entitlement change". That theory does not survive contact with
// W073's own locked state, which says "Window dates come from scheme versions — edit via the scheme (checker-gated)",
// and it does not survive the farmer's side either: a closing date is the single field that decides whether a filing
// is accepted at all. Moving a deadline in on a scheme with 14,000 eligible non-applicants is as consequential as
// changing who is eligible, and it was the least-controlled field in the module — one operator, no checker, no record
// of what the date used to be beyond a partial audit row.
//
// So the window is now part of the versioned rule set (0105) and this method opens or updates a DRAFT. The calendar
// read is unchanged in shape and gains the derivable closing-soon state; the nudge queue the canon shows beneath it
// is NOT built and says so (see domain/scheme-calendar.ts NUDGE_QUEUE_GAP).
import { Injectable } from '@nestjs/common';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemesRegistryRepository, CalendarQuery } from '../repositories/schemes-registry.repository';
import { SetWindowDto } from '../dto/schemes-registry.dto';
import { SchemeVersionService } from './scheme-version.service';
import { closeState, wrapsYear, closingSoon, NUDGE_QUEUE_GAP } from '../domain/scheme-calendar';

const tsCursor = (createdAt: any, id: string) => Buffer.from(`${createdAt?.toISOString?.() ?? createdAt}|${id}`).toString('base64');
/** Today's 'MM-DD' in UTC — the default calendar date when none is supplied. */
function todayMmDd(): string { const d = new Date(); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }

/** How far ahead the canon's own nudge ladder looks (D−14 is the first rung). */
export const CLOSING_SOON_DAYS = 14;

@Injectable()
export class WindowCalendarService {
  constructor(private readonly repo: SchemesRegistryRepository, private readonly versions: SchemeVersionService) {}

  /** A window edit is a rule edit: it opens or updates a draft and publishes nothing. */
  async setWindow(actor: AdminRequestContext, id: string, dto: SetWindowDto) {
    const saved = await this.versions.saveDraft(actor, id, { applicationWindow: dto.applicationWindow }, dto.reason);
    return { ...saved, status: 'draft' as const, publishedNothing: true };
  }

  /** Active schemes whose application_window is open on `onDate` ('MM-DD', defaults to today, UTC). */
  async calendar(q: { onDate?: string; cursor?: { c: string; id: string }; limit: number }, now = new Date()) {
    const onDate = q.onDate ?? todayMmDd();
    const query: CalendarQuery = { onDate, cursor: q.cursor, limit: q.limit };
    const rows = (await this.repo.schemesOpenOn(query)).map((s) => s.toJSON());
    const items = rows.map((s) => ({ ...s, closeState: closeState(s.applicationWindow, now), wrapsYear: wrapsYear(s.applicationWindow) }));
    const last = items[items.length - 1];
    return {
      onDate,
      items,
      // The real half of W073's lower panel. Derived from the windows on this page, so it is honest about its own
      // scope: it is "closing soon among the schemes open today", not a platform-wide sweep.
      closingSoon: closingSoon(rows, now, CLOSING_SOON_DAYS).map((r) => ({ id: r.id, code: r.code, defaultName: r.defaultName, closeState: r.closeState })),
      // The unreal half, named. Not an empty array — an empty array would render as "no nudges scheduled".
      nudgeQueue: NUDGE_QUEUE_GAP,
      nextCursor: items.length === q.limit && last ? tsCursor(last.createdAt, last.id) : null,
    };
  }
}
