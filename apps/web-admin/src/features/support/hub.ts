// apps/web-admin/src/features/support/hub.ts · W050 pure console logic (PC-56 ADMIN-SWEEP-b2).
//
// Reflect, never grant (Law 6): each gate here has a stricter twin in admin-api. What is DELIBERATELY ABSENT is any
// phone handling — the hub joins people on users.id and receives identity pre-masked from the server (0133's
// channel-identity decision); this file never sees, parses or formats a phone number.

export type HubSla = { kind: 'breached'; overMinutes: number } | { kind: 'due'; inMinutes: number } | { kind: 'unset' };

/** Deadline column: minutes under an hour, hours after — a support clock reads in minutes, not decimals. */
export function slaText(sla: HubSla): { key: 'over' | 'due' | 'unset'; amount: string } {
  if (sla.kind === 'unset') return { key: 'unset', amount: '' };
  const m = sla.kind === 'breached' ? sla.overMinutes : sla.inMinutes;
  const amount = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
  return { key: sla.kind === 'breached' ? 'over' : 'due', amount };
}

export function slaClass(sla: HubSla): string {
  if (sla.kind === 'breached') return 'kv-status kv-status--err';
  if (sla.kind === 'unset') return 'kv-status';
  return sla.inMinutes < 60 ? 'kv-status kv-status--warn' : 'kv-status kv-status--ok';
}

/** A channel chip is only ever drawn WITH its standing. 'carried' = the platform actually transports these
 *  messages (in-app chat); 'declared' = the ticket SAYS it arrived that way and no inbound provider exists to
 *  verify it — the whatsapp/ivr gateways are intentional stubs. Printing the two identically would claim an inbox
 *  the platform cannot receive. */
export function channelChip(c: { channel: string; standing: string }): { label: string; declared: boolean } {
  return { label: c.channel, declared: c.standing !== 'carried' };
}

/** "Take a break" ⇄ "I'm back" — the button offers only the transition that is real. */
export function presenceAction(current: 'available' | 'break'): { to: 'available' | 'break'; key: 'takeBreak' | 'imBack' } {
  return current === 'break' ? { to: 'available', key: 'imBack' } : { to: 'break', key: 'takeBreak' };
}

/** Why "Next in queue" is not offered — each nothing has its own sentence. */
export function takeNextBlockedKey(v: { presence: string; unclaimed: number }): 'onBreak' | 'inboxZero' | null {
  if (v.presence === 'break') return 'onBreak';
  if (v.unclaimed === 0) return 'inboxZero';
  return null;
}

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

export function buildPresence(v: { status: string }): Built<{ status: 'available' | 'break' }> {
  if (v.status !== 'available' && v.status !== 'break') return { ok: false, error: 'status' };
  return { ok: true, value: { status: v.status } };
}
