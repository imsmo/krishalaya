// modules/tenancy/domain/subscription.state.ts · the subscription_status state machine (Law 5).
// Mirrors the subscription_status ENUM in db/migrations/0002_tenancy_billing.sql:
//   trialing | active | past_due | paused | cancelled | expired
// NOTE: core QuotaService resolves plan limits from a subscription with status='active' ONLY — so a
// tenant's quotas apply exactly while its subscription is 'active'.
import { DomainError } from '../../../shared/errors/app-error';

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const TRANSITIONS: Readonly<Record<SubscriptionStatus, readonly SubscriptionStatus[]>> = Object.freeze({
  trialing:  ['active', 'cancelled', 'expired'],
  active:    ['past_due', 'paused', 'cancelled', 'expired'],
  past_due:  ['active', 'cancelled', 'expired'],
  paused:    ['active', 'cancelled', 'expired'],
  cancelled: [],
  expired:   [],
});

export class IllegalSubscriptionTransitionError extends DomainError {
  constructor(from: string, to: string) { super('SUBSCRIPTION_ILLEGAL_TRANSITION', `Cannot move subscription ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void { if (!canTransition(from, to)) throw new IllegalSubscriptionTransitionError(from, to); }
/** A live subscription occupies the tenant's single subscription slot (can't subscribe twice). */
export function isLive(s: SubscriptionStatus): boolean { return s === 'trialing' || s === 'active' || s === 'past_due' || s === 'paused'; }
/** PC-56 TENANT-4d-1: A TRIAL CARRIES THE LIMITS OF THE PLAN IT IS A TRIAL OF.
 *  This used to read `s === 'active'`, so a trialing tenant escaped every plan limit while W115 sells
 *  "14 days free" ON A CHOSEN PLAN — and a fresh trial is the cheapest place on any platform to mine
 *  resources, which made the exemption exactly backwards. `past_due` keeps its limits too: a tenant inside
 *  the grace period is still operating on a plan they have not yet paid for. `paused`, `cancelled` and
 *  `expired` do not — there is no plan in force to take a limit from, and refusing writes over a billing
 *  state is the hostage-taking W118 rules out ("existing operations never do"). The single list lives in
 *  domain/plan-usage.ts so the quota path and the meters cannot disagree about who is limited. */
export function grantsQuota(s: SubscriptionStatus): boolean {
  return s === 'trialing' || s === 'active' || s === 'past_due';
}
