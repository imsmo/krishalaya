// apps/web-admin/src/features/moderation/queue.ts · PURE helpers for W090/W091/W092 (PC-56 ADMIN-5f).
// No fetch, no React → unit-tested.
import { formatMoneyMinor } from '@krishalaya/i18n';
//
// W089's first principle is the design of this whole plane: **"Hold fast, remove slow — a held listing is reversible,
// a wrong removal costs a farmer income."** Every control below is asymmetric in that direction. Hold is one click.
// Remove is drawn only from a hold, and above ₹1,00,000 only for a second operator.

/* ===================== W090 / W091 · held listings ===================== */

export const HOLD_SOURCES = ['fraud_flag', 'reported', 'regulated_category', 'spot_audit'] as const;
export type HoldSource = (typeof HOLD_SOURCES)[number];
export const REASON_MIN = 20;

export type HoldSla =
  | { kind: 'unmeasured' } | { kind: 'ok'; hoursLeft: number }
  | { kind: 'page_lead'; hoursLeft: number } | { kind: 'breached'; hoursOver: number };

/** UNMEASURED is a WARNING, never a pass: a hold with no clock cannot be shown to be inside its SLA, and the farmer
 *  under it is losing money by the hour. PAGE_LEAD is a warning and BREACHED is a failure. */
export function slaClass(s: HoldSla | null | undefined): string {
  if (!s) return 'kv-status kv-status--muted';
  if (s.kind === 'breached') return 'kv-status kv-status--danger';
  if (s.kind === 'page_lead') return 'kv-status kv-status--warn';
  if (s.kind === 'unmeasured') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--ok';
}
export function slaKey(s: HoldSla | null | undefined): 'unmeasured' | 'ok' | 'page_lead' | 'breached' {
  return s ? s.kind : 'unmeasured';
}

export type RemoveState =
  | { ok: true; needsChecker: boolean }
  | { ok: false; reason: 'not_held' }
  | { ok: false; reason: 'needs_checker'; valueMinor: string | bigint };

/** Why Remove is not drawn. Distinct keys because the next move differs: hold it first, or find a colleague.
 *
 *  `notHeld` is the one that carries the doctrine — a removal happens from a hold so the seller has already been told
 *  and had the chance to respond, and the message says so rather than reading like a missing button.
 */
export function removeBlockedKey(
  s: RemoveState | null | undefined,
  heldByAdminId: string | null | undefined,
  viewer: string | null | undefined,
): 'notHeld' | 'needsChecker' | 'yourOwnHold' | null {
  if (!s) return 'notHeld';
  if (!s.ok) return s.reason === 'not_held' ? 'notHeld' : 'needsChecker';
  if (s.needsChecker && viewer && heldByAdminId && viewer === heldByAdminId) return 'yourOwnHold';
  return null;
}

/** The value at stake, and whether the two figures agree.
 *
 *  The server sends BOTH the value recomputed now and the value recorded when the hold was placed. A disagreement
 *  means the listing was edited while held — the seller changed the price or the quantity — which is itself something
 *  an operator must see before removing it, because the removal threshold was judged against the older figure.
 */
export function valueDrift(nowMinor: string | null | undefined, atHoldMinor: string | null | undefined): { drifted: boolean; known: boolean } {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^-?[0-9]{1,19}$/.test(v);
  if (!ok(nowMinor) || !ok(atHoldMinor)) return { drifted: false, known: false };
  return { drifted: BigInt(nowMinor) !== BigInt(atHoldMinor), known: true };
}

/** For display, from a STRING of minor units. DEV-56 Part 5: delegates to the canonical `formatMoneyMinor`
 *  (`@krishalaya/i18n`) instead of hand-rolling the bigint math — see `features/ledger/ledger.ts`'s `formatMinor`
 *  for the full rationale (same bug class: hardcoded `/100n`, and every non-INR amount rendered with no symbol).
 *  Listing values on this platform are INR-only today, so the default is real behaviour, not a guess. */
export function formatMinor(minor: string | null | undefined, currency = 'INR'): string {
  if (typeof minor !== 'string' || !/^-?[0-9]{1,19}$/.test(minor.trim())) return '—';
  return formatMoneyMinor(minor.trim(), currency);
}

export type OrderAction = 'hold' | 'release' | 'remove';

/** A REMOVE is a failure colour because of what it does to the seller, not because of what it does to the queue.
 *  A RELEASE is the good outcome and is green: on this screen, letting a listing back is the success case. */
export function orderClass(a: OrderAction | string | null | undefined): string {
  if (a === 'remove') return 'kv-status kv-status--danger';
  if (a === 'release') return 'kv-status kv-status--ok';
  if (a === 'hold') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--muted';
}

export type NoticeStatus = 'queued' | 'delivered' | 'refused' | 'failed';

/** The decision notice's state. QUEUED IS NOT DELIVERED and is not styled as success — admin-api writes `queued` and
 *  nothing has been sent until the apps/api executor settles it through the notification spine. A console that
 *  showed queued as done would tell an operator the farmer knows why their listing was stopped. */
export function noticeClass(s: NoticeStatus | string | null | undefined): string {
  if (s === 'delivered') return 'kv-status kv-status--ok';
  if (s === 'failed' || s === 'refused') return 'kv-status kv-status--danger';
  if (s === 'queued') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--muted';
}
export function noticeKey(s: NoticeStatus | string | null | undefined): 'queued' | 'delivered' | 'refused' | 'failed' | 'unknown' {
  return s === 'queued' || s === 'delivered' || s === 'refused' || s === 'failed' ? s : 'unknown';
}

export type BuildOrderResult =
  | { ok: true; value: { source?: HoldSource; sourceRef?: string; reason: string; languageCode: string; reporterUserId?: string; checkerNote?: string } }
  | { ok: false; error: 'source' | 'reason' | 'language' };

/** Build a hold / release / remove submission. `requireSource` only for a hold — a release and a remove inherit the
 *  source from the hold they follow, and asking again would invite a different answer for the same case. */
export function buildOrder(raw: {
  source?: string; sourceRef?: string; reason?: string; languageCode?: string;
  reporterUserId?: string; checkerNote?: string;
}, requireSource: boolean): BuildOrderResult {
  const source = (raw.source ?? '').trim();
  if (requireSource && !(HOLD_SOURCES as readonly string[]).includes(source)) return { ok: false, error: 'source' };
  const reason = (raw.reason ?? '').trim();
  if (reason.length < REASON_MIN) return { ok: false, error: 'reason' };
  const languageCode = (raw.languageCode ?? '').trim();
  if (languageCode.length < 2) return { ok: false, error: 'language' };
  const sourceRef = (raw.sourceRef ?? '').trim();
  const reporterUserId = (raw.reporterUserId ?? '').trim();
  const checkerNote = (raw.checkerNote ?? '').trim();
  return {
    ok: true,
    value: {
      reason, languageCode,
      ...(source && (HOLD_SOURCES as readonly string[]).includes(source) ? { source: source as HoldSource } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(reporterUserId ? { reporterUserId } : {}),
      ...(checkerNote ? { checkerNote } : {}),
    },
  };
}

/* ===================== W092 · reports ===================== */

export const SUBJECT_TYPES = ['listing', 'review', 'message', 'user'] as const;
export const PLATFORM_OUTCOMES = ['hidden', 'removed', 'warned'] as const;
export const OUTCOME_MIN = 20;

export type Priority = 'safety_desk' | 'sla_breached' | 'normal';
export type ReportSla = { kind: 'unmeasured' } | { kind: 'ok'; ageHours: number } | { kind: 'breached'; overHours: number };
export type Handler = 'tenant' | 'platform' | 'neither' | 'open';

/** Safety-desk rows are a failure colour even when fresh: the colour marks what the row is about, not how late it is. */
export function priorityClass(p: Priority | null | undefined): string {
  if (p === 'safety_desk') return 'kv-status kv-status--danger';
  if (p === 'sla_breached') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--muted';
}
export function reportSlaClass(s: ReportSla | null | undefined): string {
  if (!s) return 'kv-status kv-status--muted';
  if (s.kind === 'breached') return 'kv-status kv-status--danger';
  if (s.kind === 'unmeasured') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--ok';
}

/** WHO decided a report. `neither` is shown as a gap in the record rather than assumed to be the platform, because
 *  this console being the platform is not evidence that the platform decided it. */
export function handlerKey(h: Handler | null | undefined): Handler {
  return h === 'tenant' || h === 'platform' || h === 'neither' ? h : 'open';
}

/** The "Reports on subject" cell. Unknown is a dash, never 1 — "this is the only report" is the reading that makes an
 *  operator dismiss something eighteen people flagged. */
export function subjectCountText(c: { known: boolean; count: number } | null | undefined): string {
  return c && c.known ? String(c.count) : '—';
}

export type DecideResult =
  | { ok: true; value: { status: 'actioned' | 'dismissed'; outcome?: string; outcomeNote: string; languageCode: string } }
  | { ok: false; error: 'status' | 'outcome' | 'note' | 'language' };

/** Build a report decision.
 *
 *  An ACTIONED decision must name an outcome, and a DISMISSAL must not carry one — the two refusals are symmetric
 *  because both directions produce a record that misstates what happened: an actioned report with no action, or a
 *  dismissal that claims one.
 */
export function buildDecide(raw: { status?: string; outcome?: string; outcomeNote?: string; languageCode?: string }): DecideResult {
  const status = (raw.status ?? '').trim();
  if (status !== 'actioned' && status !== 'dismissed') return { ok: false, error: 'status' };
  const note = (raw.outcomeNote ?? '').trim();
  if (note.length < OUTCOME_MIN) return { ok: false, error: 'note' };
  const languageCode = (raw.languageCode ?? '').trim();
  if (languageCode.length < 2) return { ok: false, error: 'language' };
  const outcome = (raw.outcome ?? '').trim();
  if (status === 'actioned') {
    if (!(PLATFORM_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: 'outcome' };
    return { ok: true, value: { status, outcome, outcomeNote: note, languageCode } };
  }
  // A dismissal carrying an outcome is refused rather than having it stripped: silently dropping it would let an
  // operator believe they recorded an action.
  if (outcome) return { ok: false, error: 'outcome' };
  return { ok: true, value: { status, outcomeNote: note, languageCode } };
}

/** W092's note that the page is ordered within itself only. Shown when there is more than one page, because on a
 *  single page "ordered within the page" and "ordered" are the same thing and the caveat would only confuse. */
export function pageOrderCaveatVisible(orderedWithinPageOnly: boolean | null | undefined, hasNextCursor: boolean): boolean {
  return orderedWithinPageOnly === true && hasNextCursor;
}
