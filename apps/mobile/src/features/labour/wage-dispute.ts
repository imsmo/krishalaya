// apps/mobile/src/features/labour/wage-dispute.ts · PURE logic for the worker Wage-Dispute screen (143). No React /
// no SDK I/O → unit-tested. There is no labour-specific dispute endpoint yet, so the report is filed as a SUPPORT
// TICKET (support.openTicket, idempotent) — which carries only {subject, severity}. The detailed description,
// photo/voice attachments and a claimed "received" amount have NO ticket field, so they are captured + flagged
// (not sent) rather than faked (§13). The AGREED wage shown is real (from the booking); "received" is the worker's
// claim, not a system value, so the screen never prints a fabricated received figure.
import type { TicketSeverity } from '@krishalaya/sdk-js';

export const DISPUTE_REASONS = [
  { key: 'less_wage', icon: '💰' },
  { key: 'extra_hours', icon: '⏰' },
  { key: 'not_paid', icon: '🚫' },
  { key: 'behavior', icon: '🤝' },
  { key: 'amenities', icon: '🍴' },
] as const;
export type DisputeReasonKey = (typeof DISPUTE_REASONS)[number]['key'];

/** A wage/behaviour dispute is treated as high-priority support. Pure. */
export const DISPUTE_SEVERITY: TicketSeverity = 'P1';

/** Trim + collapse the description, cap length, empty → null. Pure. */
export function normalizeDisputeText(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.slice(0, 1000);
}

/** Report enables once a reason is picked AND a short description is written (a dispute needs detail so support can
 * act). Pure. */
export function canSubmitDispute(reason: DisputeReasonKey | null | undefined, text: string | null | undefined): boolean {
  const okReason = !!reason && DISPUTE_REASONS.some((r) => r.key === reason);
  return okReason && (normalizeDisputeText(text)?.length ?? 0) >= 10;
}
