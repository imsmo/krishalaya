// modules/communication/domain/broadcast.state.ts · PURE state machine for a tenant broadcast (Law 5) — PC-56 TENANT-8e.
//
//   draft     → scheduled | queued | cancelled      (the SEND act: now → queued, at a time → scheduled; or cancel the draft)
//   scheduled → queued | cancelled | failed         (the schedule job queues it when due — or fails it, with a code, when the
//                                                    frame stopped serving or the role was retired; a person may cancel before)
//   queued    → sending | failed                    (the fan-out claims it; a template that stopped serving, a role
//                                                    retired, an audience that emptied → failed, with a code)
//   sending   → sent | failed
//   sent / failed / cancelled are terminal.
//
// Before 8e the machine was `queued → sending → sent` with `failed` written by nothing, and a broadcast was born queued
// (create WAS send). The canon's two acts — *Save draft* (W428 → W2841, the form chain) and *Send broadcast* (W429 →
// W2845, the mutate chain) — are two moves, and a scheduled send is the third state between them (F-21: `scheduled_at`
// is now read by a REGISTERED job). 0179's `trg_tenant_broadcasts_guard` is this same table, so a write that skips this
// file is refused by the database with 23514.
import { DomainError } from '../../../shared/errors/app-error';

export const BROADCAST_STATUSES = ['draft', 'scheduled', 'queued', 'sending', 'sent', 'failed', 'cancelled'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/** 0179's `ck_tb_failure_reason`. `unrecorded` = failed before 0179 kept a reason (no such row exists — `markFailed` had no caller). */
export const BROADCAST_FAILURE_REASONS = ['no_template', 'no_recipients', 'role_retired', 'unrecorded'] as const;
export type BroadcastFailureReason = (typeof BROADCAST_FAILURE_REASONS)[number];

const TRANSITIONS: Record<BroadcastStatus, readonly BroadcastStatus[]> = {
  draft: ['scheduled', 'queued', 'cancelled'],
  scheduled: ['queued', 'cancelled', 'failed'],
  queued: ['sending', 'failed'],
  sending: ['sent', 'failed'],
  sent: [],
  failed: [],
  cancelled: [],
};

/** The states a PERSON acts from: send (a draft only), cancel (a draft or a scheduled broadcast). */
export const BROADCAST_ACTS = ['send', 'cancel'] as const;
export type BroadcastAct = (typeof BROADCAST_ACTS)[number];
const ACT_FROM: Record<BroadcastAct, readonly BroadcastStatus[]> = { send: ['draft'], cancel: ['draft', 'scheduled'] };

export class IllegalBroadcastTransitionError extends DomainError {
  constructor(from: BroadcastStatus, to: BroadcastStatus) {
    super('BROADCAST_ILLEGAL_TRANSITION', `Cannot move broadcast from '${from}' to '${to}'`, 409, { from, to });
  }
}
export function canTransition(from: BroadcastStatus, to: BroadcastStatus): boolean { return TRANSITIONS[from].includes(to); }
export function assertTransition(from: BroadcastStatus, to: BroadcastStatus): void { if (!canTransition(from, to)) throw new IllegalBroadcastTransitionError(from, to); }
export function actAllowedFrom(act: BroadcastAct, from: BroadcastStatus): boolean { return ACT_FROM[act].includes(from); }
export function isTerminal(s: BroadcastStatus): boolean { return TRANSITIONS[s].length === 0; }
/** A draft is the only state whose words, audience and time may change (0179 freezes them after). */
export function isEditable(s: BroadcastStatus): boolean { return s === 'draft'; }
/** Has the fan-out run — i.e. is there anything in the delivery log to count? */
export function hasFannedOut(s: BroadcastStatus): boolean { return s === 'sent'; }
export function isBroadcastStatus(s: unknown): s is BroadcastStatus { return typeof s === 'string' && (BROADCAST_STATUSES as readonly string[]).includes(s); }
