// apps/admin-api/src/modules/comm-hub/domain/comm-hub.ts · W050 pure rules (PC-56 ADMIN-SWEEP-b2). No I/O.
//
// THE HUB IS A PULL QUEUE, NOT A ROUTER, AND SAYING SO IS THE DESIGN. W050 promises "new arrivals route by language
// skill + load" — no routing engine exists, `support_policies.routing_strategy` and `desk_languages` are declarative
// fields nothing consumes, and NO per-agent language record exists anywhere. Building a router on invented skill
// data would assign a Gujarati farmer to an agent by fiction. So: "Next in queue" hands the caller the worst
// first-response deadline they may take, presence gates it, and the screen names what routing is NOT built on.
import { maskName, maskPhone } from '../../../core/pii/mask';

/** Ticket channels as 0012 declares them — CALLER-DECLARED metadata. `verified` is false for every channel no
 *  inbound provider exists for, and the console prints declared-not-verified rather than a channel icon that
 *  implies the platform heard a WhatsApp message it has no way to receive. */
export const TICKET_CHANNELS = ['app', 'whatsapp', 'ivr', 'phone', 'email', 'ambassador'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

/** The one channel whose messages the platform actually carries end-to-end (conversations/messages, 0012). The
 *  whatsapp-bot and ivr-ussd gateways are intentional GA-deferred stubs (exit 1); MSG91/Twilio wiring is OTP-only. */
export const CARRIED_CHANNELS: readonly TicketChannel[] = Object.freeze(['app']);

export function channelStanding(ch: string): 'carried' | 'declared' {
  return (CARRIED_CHANNELS as readonly string[]).includes(ch) ? 'carried' : 'declared';
}

/* ------------------------------------------------------------------ presence */

export type PresenceStatus = 'available' | 'break';

/** Absence of a row means available — the table holds exceptions, not the roster. */
export function presenceOf(row: { status: string } | null | undefined): PresenceStatus {
  return row?.status === 'break' ? 'break' : 'available';
}

export class HubRuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** The claim gate. A queue that hands work to somebody who said "not now" teaches people not to say it. */
export function assertMayClaim(presence: PresenceStatus): void {
  if (presence === 'break') {
    throw new HubRuleError('HUB_ON_BREAK',
      'You are on a break — the queue will not hand you work until you return. Press "I\'m back" first; the tickets will still be there, in the same worst-deadline-first order.');
  }
}

/** Flipping to the state you are already in is a no-op the caller should hear about (a double-click, a stale tab),
 *  not an audit entry that makes the presence log read like indecision. */
export function presenceTransition(from: PresenceStatus, to: PresenceStatus): 'change' | 'noop' {
  return from === to ? 'noop' : 'change';
}

/* ------------------------------------------------------------------ the principal row (one thread per person) */

/** W050: "one queue, one thread per principal." The join key is users.id — the phone is its proof (UNIQUE, global,
 *  0003) — and the console prints both name and phone MASKED. See 0133's header for the full decision; this
 *  function is the only place a principal's identity is shaped for the hub, so the masking cannot be skipped by a
 *  new call site. */
export function principalView(v: { userId: string; fullName: string | null; phone: string | null; languageCode: string | null }) {
  return {
    userId: v.userId,
    name: maskName(v.fullName),
    phone: maskPhone(v.phone),
    languageCode: v.languageCode,   // not PII, and the agent must write in it
  };
}

/** Severity sorts lexically by design (P0 < P1 < P2 < P3), so the worst across a principal's tickets is min(). */
export function worstSeverity(sevs: readonly string[]): string | null {
  return sevs.length ? [...sevs].sort()[0] : null;
}

/** First-response SLA state for the queue column. Tickets with no due date sort last and say 'unset' rather than
 *  rendering as comfortably on-time. */
export type HubSla = { kind: 'breached'; overMinutes: number } | { kind: 'due'; inMinutes: number } | { kind: 'unset' };

export function hubSla(dueAt: string | null, now: Date): HubSla {
  if (!dueAt) return { kind: 'unset' };
  const ms = new Date(dueAt).getTime() - now.getTime();
  return ms < 0 ? { kind: 'breached', overMinutes: Math.ceil(-ms / 60_000) } : { kind: 'due', inMinutes: Math.floor(ms / 60_000) };
}
