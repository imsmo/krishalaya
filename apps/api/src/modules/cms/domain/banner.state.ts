// modules/cms/domain/banner.state.ts · STATE MACHINE for banners.state (Law 5) · PC-56 TENANT-8d.
//
//   draft  → active (activate) | archived (archive)
//   active → paused (pause)    | archived (archive)
//   paused → active (resume)   | archived (archive)
//   archived — final.
//
// 0178's `banners_guard` is the same table in the database (23514 on anything else). Whether an ACTIVE banner is
// scheduled, live or ended is NOT a state: it is the window at read time (banner-window.ts `bannerPhase`) — F-21's
// decision: no job writes it, so there is no second copy of the truth to disagree with the clock.
import { DomainError } from '../../../shared/errors/app-error';

export const BANNER_STATES = ['draft', 'active', 'paused', 'archived'] as const;
export type BannerState = (typeof BANNER_STATES)[number];
export const BANNER_ACTS = ['activate', 'pause', 'resume', 'archive'] as const;
export type BannerAct = (typeof BANNER_ACTS)[number];

const TRANSITIONS: Readonly<Record<BannerState, readonly BannerState[]>> = Object.freeze({
  draft: ['active', 'archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: [],
});

/** The one state each act moves FROM (archive: any but archived) and TO. */
const ACTS: Readonly<Record<BannerAct, { from: readonly BannerState[]; to: BannerState }>> = Object.freeze({
  activate: { from: ['draft'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  archive: { from: ['draft', 'active', 'paused'], to: 'archived' },
});

/** States whose banner may be edited (W174 "Save changes"). An archived banner is final. */
export const EDITABLE_STATES: readonly BannerState[] = ['draft', 'active', 'paused'];

export class IllegalBannerTransitionError extends DomainError {
  constructor(from: string, to: string) { super('CMS_BANNER_ILLEGAL_TRANSITION', `Cannot move banner ${from}→${to}`, 409, { from, to }); }
}
export function isBannerState(s: unknown): s is BannerState { return typeof s === 'string' && (BANNER_STATES as readonly string[]).includes(s); }
export function isBannerAct(s: unknown): s is BannerAct { return typeof s === 'string' && (BANNER_ACTS as readonly string[]).includes(s); }
export function canTransition(from: BannerState, to: BannerState): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: BannerState, to: BannerState): void { if (!canTransition(from, to)) throw new IllegalBannerTransitionError(from, to); }
/** Where `act` takes a banner in `state` — null when the act does not apply to that state. */
export function bannerTarget(state: BannerState, act: BannerAct): BannerState | null {
  const a = ACTS[act];
  return a.from.includes(state) ? a.to : null;
}
export function isEditable(state: BannerState): boolean { return EDITABLE_STATES.includes(state); }
/** The acts that move a banner onto a member's screen — they re-take the activation law. */
export function reachesMembers(act: BannerAct): boolean { return act === 'activate' || act === 'resume'; }
