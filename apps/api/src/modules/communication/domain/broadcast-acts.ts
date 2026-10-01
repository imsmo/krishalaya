// modules/communication/domain/broadcast-acts.ts · PC-56 TENANT-8e · THE MUTATE CHAIN'S VERDICTS (W2845–W2847). PURE.
//
// Two acts on a broadcast that exists — the canon's *Send broadcast* and the cancel a scheduled send needs — judged from
// the broadcast AS IT STANDS (the confirm page and the act both ask; the act re-asks under the row lock):
//   • send   — a DRAFT only; the frame must serve in every required language on every channel of `tenant.broadcast`
//              (`broadcast_template_gaps()` — F-2: a broadcast with no template fails AT ENQUEUE, never as `no_template`
//              per recipient); the audience role must still be registered and the audience not empty (a role retired
//              or emptied since the draft is refused, not sent to nobody); a schedule must still be ahead by the lead;
//              the channel must be one the platform carries;
//   • cancel — a DRAFT or a SCHEDULED broadcast; once queued the fan-out owns it.
// Both: the verb (`notification.broadcast.send` — F-19: no longer the support agent's `notification.manage`) and a
// reason, recorded word for word on the audit row (and, for a cancel, on the row).
import { actAllowedFrom, BroadcastAct, BroadcastStatus } from './broadcast.state';
import { MIN_LEAD_MINUTES } from './broadcast-review';

export const MIN_ACT_REASON = 3;
export const MAX_ACT_REASON = 300;
export const BROADCAST_ACT_REFUSALS = [
  'NO_PERMISSION', 'ILLEGAL_FROM_STATE', 'TEMPLATE_MISSING', 'ROLE_UNKNOWN', 'AUDIENCE_EMPTY', 'SCHEDULE_PASSED',
  'CHANNEL_NO_PROVIDER', 'REASON_REQUIRED', 'REASON_TOO_LONG', 'BROADCAST_NOT_FOUND', 'REFUSED_BY_DATABASE',
] as const;
export type BroadcastActRefusal = (typeof BROADCAST_ACT_REFUSALS)[number];

export interface ActFacts {
  status: BroadcastStatus; canSend: boolean; templateGaps: readonly string[];
  roleCode: string | null; roleKnown: boolean; audienceSize: number;
  scheduledAt: Date | null; channel: string; whatsappConnected: boolean; now: Date;
}
export interface ActVerdict { act: BroadcastAct; allowed: boolean; refusals: BroadcastActRefusal[]; gaps: string[]; to: BroadcastStatus | null }

export function reasonRefusal(reason: string | null | undefined): BroadcastActRefusal | null {
  const r = (reason ?? '').trim();
  if (r.length < MIN_ACT_REASON) return 'REASON_REQUIRED';
  if (r.length > MAX_ACT_REASON) return 'REASON_TOO_LONG';
  return null;
}

/** `ignoringReason`: the confirm page asks before a reason is typed — the reason is then judged on its own line. */
export function actVerdict(act: BroadcastAct, f: ActFacts, reason: string | null | undefined, ignoringReason = false): ActVerdict {
  const refusals: BroadcastActRefusal[] = [];
  if (!f.canSend) refusals.push('NO_PERMISSION');
  if (!actAllowedFrom(act, f.status)) refusals.push('ILLEGAL_FROM_STATE');
  else if (act === 'send') {
    if (f.templateGaps.length > 0) refusals.push('TEMPLATE_MISSING');
    if (f.roleCode !== null && !f.roleKnown) refusals.push('ROLE_UNKNOWN');
    else if (f.audienceSize <= 0) refusals.push('AUDIENCE_EMPTY');
    if (f.scheduledAt && f.scheduledAt.getTime() - f.now.getTime() < MIN_LEAD_MINUTES * 60_000) refusals.push('SCHEDULE_PASSED');
    if (f.channel !== 'inapp' && !(f.channel === 'whatsapp' && f.whatsappConnected)) refusals.push('CHANNEL_NO_PROVIDER');
  }
  if (!ignoringReason) { const r = reasonRefusal(reason); if (r) refusals.push(r); }
  const to: BroadcastStatus | null = act === 'cancel' ? 'cancelled' : f.scheduledAt ? 'scheduled' : 'queued';
  return { act, allowed: refusals.length === 0, refusals, gaps: act === 'send' ? [...f.templateGaps] : [], to: refusals.length === 0 ? to : null };
}
