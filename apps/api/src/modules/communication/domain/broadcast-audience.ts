// modules/communication/domain/broadcast-audience.ts · PC-56 TENANT-8e · WHO A BROADCAST REACHES, AND WHAT HAPPENS TO EACH. PURE.
//
// Two questions the review must answer before anybody presses send (W429's "Audience — honest math"), answered with the
// SAME rules the fan-out applies — never a second opinion:
//   1. THE AUDIENCE. Every active member of the cooperative, or the members holding ONE registered role. The role code is
//      normalised here (trim; the `roles` registry's codes are lower snake) and must be a role the registry holds as an
//      active TENANT role (F-16: the field was a free string ≤60 and the web form a free text input, so `farmerr` matched
//      nobody and the broadcast still recorded `sent`). The count itself is a query (the repository), bounded by nothing
//      but the cooperative — it is a COUNT.
//   2. WHAT EACH MEMBER'S CHANNELS WILL DO at the instant it is sent (now, or the schedule) — `resolveChannels` itself,
//      over each member's preferences and the window 8b's fan-out would read (theirs, else the cooperative's default in
//      the cooperative's zone): the in-app item is never held; push is HELD inside the member's quiet window (released
//      when it ends — W429's "Quiet hours … are blocked automatically" is, on this platform, "held per member until their
//      window ends", which is what 8b built and what this prints), suppressed for a member who switched it off, and
//      FAILS for a member with no registered device (`no_device` — said before the send, not discovered after).
//      Estimated over at most `IMPACT_SAMPLE_MAX` members, and SAID when cut.
//
// WhatsApp is not a channel of this event and has no provider; nothing here pretends to count "opted in to WhatsApp".
import type { NotifChannel } from './communication.events';
import { CatalogEvent, resolveChannels } from './channel-resolution';
import { effectiveWindow, QuietWindow, windowEndAfter } from './quiet-window';

/** The members the quiet-hours estimate looks at, at most — and the review says "estimated over N of M" when cut. */
export const IMPACT_SAMPLE_MAX = 5000;
/** The registry's code shape (roles.code varchar(50), lower snake). */
const ROLE_CODE = /^[a-z][a-z0-9_]{1,49}$/;

/** A role code as the registry would hold it, or null for "everyone". Never guesses a spelling. */
export function normaliseRoleCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  return s.length === 0 ? null : s;
}
/** Could this string be a role code at all? (A query with a 300-character "role" is not asked.) */
export function looksLikeRoleCode(code: string): boolean { return ROLE_CODE.test(code); }

/** The audience's own refusals, given the registry's answer and the count. `known` = null when no role was named. */
export function audienceRefusals(a: { roleCode: string | null; known: boolean | null; size: number }): Array<'ROLE_UNKNOWN' | 'AUDIENCE_EMPTY'> {
  if (a.roleCode !== null && a.known !== true) return ['ROLE_UNKNOWN'];
  return a.size > 0 ? [] : ['AUDIENCE_EMPTY'];
}

export interface ImpactMember { userId: string; own: QuietWindow | null; prefs: ReadonlyMap<NotifChannel, boolean>; hasPushDevice: boolean }
export interface ChannelImpact { channel: NotifChannel; now: number; held: number; optedOut: number; noDevice: number }
export interface QuietImpact {
  at: Date;
  /** Members examined (≤ IMPACT_SAMPLE_MAX) and the audience size; `cut` when the estimate saw fewer than all. */
  examined: number; audience: number; cut: boolean;
  channels: ChannelImpact[];
  /** The latest instant a held channel is released (the end of the last window it falls in), or null when none is held. */
  heldUntil: Date | null;
  /** Whose window decided it: the member's own, the cooperative's default, or none (no tenant zone / default off). */
  windows: { own: number; tenantDefault: number; none: number };
}

export function quietImpact(a: {
  event: CatalogEvent; members: readonly ImpactMember[]; audience: number;
  tenantDefault: { starts: string; ends: string } | null; tenantZone: string | null; at: Date;
}): QuietImpact {
  const byChannel = new Map<NotifChannel, ChannelImpact>();
  for (const ch of a.event.defaultChannels) byChannel.set(ch, { channel: ch, now: 0, held: 0, optedOut: 0, noDevice: 0 });
  const windows = { own: 0, tenantDefault: 0, none: 0 };
  let heldUntil: Date | null = null;
  for (const m of a.members) {
    const w = effectiveWindow(m.own, a.tenantDefault, a.tenantZone);
    if (!w) windows.none += 1; else if (w.source === 'own') windows.own += 1; else windows.tenantDefault += 1;
    const d = resolveChannels(a.event, m.prefs, w, a.at);
    for (const s of d.suppressed) {
      const c = byChannel.get(s.channel);
      if (!c) continue;
      if (s.reason === 'opted_out') c.optedOut += 1;
      else {
        c.held += 1;
        const end = w ? windowEndAfter(a.at, w) : null;
        if (end && (heldUntil === null || end.getTime() > heldUntil.getTime())) heldUntil = end;
      }
    }
    for (const ch of d.channels) {
      const c = byChannel.get(ch);
      if (!c) continue;
      if (ch === 'push' && !m.hasPushDevice) c.noDevice += 1; else c.now += 1;
    }
  }
  return {
    at: a.at, examined: a.members.length, audience: a.audience, cut: a.members.length < a.audience,
    channels: [...byChannel.values()], heldUntil, windows,
  };
}
