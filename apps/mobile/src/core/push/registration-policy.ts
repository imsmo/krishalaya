// apps/mobile/src/core/push/registration-policy.ts · PC-56 MOB-STORE-1 — WHEN this device registers for push. PURE.
// Before this wave only the farmer tab layout called startPush(), so a buyer (or worker, vet, rider, …) never got a push
// token and the server could not reach them. Registration now lives in ONE role-agnostic place (PushRegistrar, mounted by
// the root layout) and is decided here: signed in, a role chosen (so the just-in-time permission prompt comes after
// onboarding, not in the middle of it), and the `notifications` flag on (kill-switch, Law 10). The role itself does not
// matter — every role receives notifications (orders, offers, payouts, jobs, bookings…).
export interface PushRegistrationInput { status: string; activeRole?: string | null; notificationsOn: boolean }

export function shouldRegisterPush(s: PushRegistrationInput): boolean {
  return s.status === 'authenticated' && !!s.activeRole && s.notificationsOn;
}
