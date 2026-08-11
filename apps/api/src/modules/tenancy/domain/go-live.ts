// modules/tenancy/domain/go-live.ts · W116's six steps, as rules rather than as rows (PC-56 TENANT-1c).
//
// **THE CENTRAL DECISION OF THIS WAVE: THE CHECKLIST IS DERIVED, NOT RECORDED — AND THAT INVERTS WHAT I EXPECTED TO FIND.**
//
// My own earlier note called this "the go-live checklist whose six unlock steps no table records", as though the gap were a
// missing table. It is not. Every one of W116's six steps is a FACT that already exists in the database:
//
//   1. "Create your organisation"      → the `tenants` row exists.
//   2. "Choose a plan"                 → a `subscriptions` row exists.
//   3. "Verify your organisation (KYC)" → `business_kyc_profiles.status = 'verified'` (0058).
//   4. "Invite your team"              → two or more staff hold an active role.
//   5. "Add your first members"        → at least one member holds an active member role.
//   6. "Set up payouts"                → a bank account with `penny_verified_at` set (0003).
//
// **A CHECKLIST TABLE WOULD BE A SECOND OPINION ABOUT THINGS THE DATABASE ALREADY KNOWS, AND SECOND OPINIONS DRIFT.** It
// could say "KYC done" after a rejection, or "payouts set up" after the bank account was removed — and a setup screen that
// lies about readiness is worse than no setup screen, because a federation goes live believing money can move. Deriving also
// gives the timestamps W116 shows ("done · today 11:20") for free: the fact's own `created_at` IS when it happened, and
// nobody can backdate a tick.
//
// The one thing derivation cannot give is a step somebody has DISMISSED — "we do not use payouts, stop asking". That is a
// real need and it is named rather than faked (TENANT-1c-Q1).

/** The six steps, in the order W116 renders them. The order is the dependency order, not a preference. */
export const GO_LIVE_STEPS = ['organisation', 'plan', 'kyc', 'team', 'members', 'payouts'] as const;
export type GoLiveStepKey = (typeof GO_LIVE_STEPS)[number];

/** Two staff is W116's own threshold: "verification desk, payouts and support work better with 2+ staff". */
export const MIN_TEAM_SIZE = 2;

export interface GoLiveFacts {
  organisationNamed: boolean;
  organisationAt: string | null;
  planChosen: boolean;
  planAt: string | null;
  /** `verified`, not merely submitted — W116: "required before money moves". */
  kycVerified: boolean;
  kycAt: string | null;
  /** How many people hold an active STAFF role (admin/staff/coordinator), not how many members exist. */
  staffCount: number;
  staffAt: string | null;
  memberCount: number;
  membersAt: string | null;
  /** A bank account that passed a penny drop. An unverified account cannot receive money. */
  payoutReady: boolean;
  payoutAt: string | null;
}

export interface GoLiveStep {
  key: GoLiveStepKey;
  done: boolean;
  /** When the underlying fact came into being. Never invented: null when the fact is absent. */
  doneAt: string | null;
  /**
   * The step that must finish first, when one does.
   *
   * **ONLY `payouts` IS GENUINELY BLOCKED, AND ONLY BY KYC.** W116 marks it "unlocked after step 3" and every other step
   * is merely *ordered* — a federation can invite staff before choosing a plan, and telling them they cannot is a lie that
   * makes the product feel bureaucratic. Inventing dependencies is the easy way to make a checklist look rigorous.
   */
  blockedBy: GoLiveStepKey | null;
  /** True for the first incomplete, unblocked step — W116's "next" badge. Exactly one step ever carries it. */
  isNext: boolean;
}

/**
 * Build the six steps from facts.
 *
 * **THE ONLY REAL DEPENDENCY IS KYC → PAYOUTS**, because money genuinely cannot move before an organisation is verified.
 * Everything else is presentation order.
 */
export function goLiveSteps(f: GoLiveFacts): GoLiveStep[] {
  const done: Record<GoLiveStepKey, boolean> = {
    organisation: f.organisationNamed,
    plan: f.planChosen,
    kyc: f.kycVerified,
    team: f.staffCount >= MIN_TEAM_SIZE,
    members: f.memberCount > 0,
    payouts: f.payoutReady,
  };
  const at: Record<GoLiveStepKey, string | null> = {
    organisation: f.organisationAt, plan: f.planAt, kyc: f.kycAt,
    team: f.staffAt, members: f.membersAt, payouts: f.payoutAt,
  };

  const steps = GO_LIVE_STEPS.map((key) => ({
    key,
    done: done[key],
    // **A TIMESTAMP ONLY WHEN THE STEP IS DONE.** A `created_at` from a rejected KYC row is when somebody TRIED, and
    // showing it beside an unticked step reads as "done at 11:20" to anybody scanning the column.
    doneAt: done[key] ? at[key] : null,
    blockedBy: key === 'payouts' && !done.kyc ? ('kyc' as GoLiveStepKey) : null,
    isNext: false,
  }));

  // Exactly one "next": the first step that is neither done nor blocked. If everything is done or the only remaining work
  // is blocked, nothing is next — and the screen says so rather than pointing at a door that will not open.
  const next = steps.find((s) => !s.done && s.blockedBy === null);
  if (next) next.isNext = true;
  return steps;
}

/** W116's "Go live — 2 of 6 done". */
export function goLiveProgress(steps: GoLiveStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/**
 * Is the organisation live?
 *
 * **ALL SIX, NOT "ENOUGH OF THEM".** W116's completed state is unambiguous — "Your federation is live. This page becomes
 * your health check" — and a five-of-six organisation with no verified bank account cannot pay a farmer, which is the one
 * thing a federation exists to do. Partial credit here would be the platform declaring victory on the member's behalf.
 */
export function isLive(steps: GoLiveStep[]): boolean {
  return steps.every((s) => s.done);
}

/**
 * Which steps are blocked and by what — for the screen's explanatory line.
 *
 * Returned as data rather than rendered, so the console phrases it in the member's language.
 */
export function blockedSteps(steps: GoLiveStep[]): { key: GoLiveStepKey; blockedBy: GoLiveStepKey }[] {
  return steps
    .filter((s) => s.blockedBy !== null && !s.done)
    .map((s) => ({ key: s.key, blockedBy: s.blockedBy as GoLiveStepKey }));
}
