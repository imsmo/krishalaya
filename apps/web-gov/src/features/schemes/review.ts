// apps/web-gov/src/features/schemes/review.ts · PURE reviewer gates (PC-41 GW-1). Mirror the application
// state machine: submitted→under_verification→(clarification_needed|approved|rejected)→disbursed→closed;
// appealed re-enters review. The API re-checks every transition (reflect, never grant).
export const APP_STATUSES = ['draft', 'submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed'] as const;
export function isAppStatus(v: string | undefined | null): boolean { return !!v && (APP_STATUSES as readonly string[]).includes(v); }
export function canVerify(s: string | undefined | null): boolean { return s === 'submitted' || s === 'appealed'; }
export function canClarify(s: string | undefined | null): boolean { return s === 'under_verification'; }
export function canDecide(s: string | undefined | null): boolean { return s === 'under_verification'; }
export function canClose(s: string | undefined | null): boolean { return s === 'disbursed' || s === 'rejected'; }
