// apps/web-tenant/src/features/signup/steps.ts · W113's four steps, as pure logic (PC-56 TENANT-1d-3b).
//
// No React, no I/O. W113 prints "Step 1 of 4", so the step is a real piece of state and it lives in the URL: a farmer whose
// signal drops mid-signup comes back to the same step rather than to the beginning, and W113's own empty state ("Your
// sign-up details save automatically as you go") is only honest if the progress is somewhere durable.
import type { TenantSignupInput } from '@krishalaya/sdk-js';

export interface T { t(key: string, vars?: Record<string, string | number>): string }

/** W113's own sequence: who you are → verify the number → what the organisation is → done. */
export const SIGNUP_STEPS = ['you', 'verify', 'org', 'done'] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];

export function isStep(v: string | undefined | null): v is SignupStep {
  return (SIGNUP_STEPS as readonly string[]).includes(String(v));
}

/** 1-based, for "Step 2 of 4". Unknown input is step one, never a crash and never step four. */
export function stepNumber(step: string | undefined | null): number {
  const i = SIGNUP_STEPS.indexOf(String(step) as SignupStep);
  return i < 0 ? 1 : i + 1;
}
export const TOTAL_STEPS = SIGNUP_STEPS.length;

/**
 * Which step a request may actually be on.
 *
 * **A STEP CANNOT BE REACHED BY EDITING THE URL PAST ITS PREREQUISITE.** Landing on `?step=org` with no verified phone
 * would render a form whose submit is guaranteed to fail with "invalid code", which teaches a farmer that the platform is
 * broken. The prerequisites are the data itself — a phone for verify, a phone AND a code for org — so this cannot drift
 * from what the API requires.
 */
export function resolveStep(q: { step?: string; phone?: string; code?: string }): SignupStep {
  const wanted: SignupStep = isStep(q.step) ? q.step : 'you';
  const hasPhone = Boolean((q.phone ?? '').trim());
  const hasCode = Boolean((q.code ?? '').trim());
  if (wanted === 'verify' && !hasPhone) return 'you';
  if (wanted === 'org' && !(hasPhone && hasCode)) return hasPhone ? 'verify' : 'you';
  // `done` is only ever reached by the action redirecting to it, and it carries no form — so a hand-typed one is harmless
  // and shows the "what happens next" copy rather than a false success. It says nothing about an organisation being made.
  return wanted;
}

/**
 * Is this a plausible Indian mobile number, for the FORM only?
 *
 * **THE FORM IS DELIBERATELY MORE PERMISSIVE THAN THE API.** The server normalises and validates (`normalizePhoneE164`),
 * and this exists so a typo gets an instant answer instead of an SMS. It must never be the stricter of the two: a rule here
 * that rejected a number the API accepts would lock somebody out of a platform that would have taken them.
 */
export function looksLikePhone(raw: string): boolean {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/** The OTP as W113 shows it: six digits. Accepts 4–8 because the API does, and the API is the authority on its own codes. */
export function looksLikeCode(raw: string): boolean {
  return /^\d{4,8}$/.test((raw ?? '').trim());
}

/**
 * W113's masked confirmation line: "6-digit code sent to +91 99••• ••482".
 *
 * Masked even though the person just typed it, because this page is shown on a shared phone at an MCC counter as often as
 * on a private one — and the same five-of-ten policy every other screen uses (W153, W109) is the one a reader recognises.
 */
export function maskForDisplay(raw: string): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 6) return '••••';
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const local = digits.slice(-10);
  return `${cc ? `+${cc} ` : ''}${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}

/** What the form may send. Nothing else is constructible here — no plan, no status, no price (the API refuses them too). */
export function buildSignup(raw: {
  phone: string; code: string; fullName: string; orgName: string; orgTypeId: string; lang: string;
}): { ok: true; value: TenantSignupInput } | { ok: false; error: 'phone' | 'code' | 'name' | 'org' | 'orgType' } {
  if (!looksLikePhone(raw.phone)) return { ok: false, error: 'phone' };
  if (!looksLikeCode(raw.code)) return { ok: false, error: 'code' };
  const fullName = (raw.fullName ?? '').trim();
  if (fullName.length < 2 || fullName.length > 200) return { ok: false, error: 'name' };
  const orgName = (raw.orgName ?? '').trim();
  // Length only — the canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની", and a form that cannot spell its customers' names
  // is not a form for those customers. Same rule as the API's, deliberately.
  if (orgName.length < 3 || orgName.length > 200) return { ok: false, error: 'org' };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.orgTypeId ?? '')) return { ok: false, error: 'orgType' };
  const lang = ['en', 'hi', 'gu'].includes(raw.lang) ? (raw.lang as 'en' | 'hi' | 'gu') : undefined;
  return { ok: true, value: { phone: raw.phone.trim(), code: raw.code.trim(), fullName, orgName, orgTypeId: raw.orgTypeId, ...(lang ? { lang } : {}) } };
}

/**
 * The resend countdown W113 prints: "resend in 28s · voice call fallback available".
 *
 * **THE VOICE FALLBACK IS DESCRIBED AS AUTOMATIC AND IT IS NOT WIRED**, so this returns whether it may be CLAIMED, and the
 * page says only what is true: an SMS was sent, and it can be re-sent. W113's "We will also try a voice call automatically
 * at 60s" needs a voice provider, and this platform has none (TENANT-1d-3-Q4).
 */
export function resendState(secondsSinceSent: number, cooldownSec = 30): { canResend: boolean; waitSec: number; voiceClaimable: false } {
  const wait = Math.max(0, Math.ceil(cooldownSec - secondsSinceSent));
  return { canResend: wait === 0, waitSec: wait, voiceClaimable: false };
}

/** Where a brand-new organisation should land: the go-live checklist (TENANT-1c), not an empty dashboard. */
export const AFTER_SIGNUP_PATH = '/get-started';

/**
 * How the outcome reads.
 *
 * **"RESUMED" IS ITS OWN MESSAGE AND NOT A SUCCESS.** W113: "This mobile runs Junagadh Kisan Producer Co. — sign in
 * instead". Telling somebody "your organisation is ready" when nothing was created would have them looking for an FPO they
 * did not make; telling them which one they already run is the sentence they can act on.
 */
export function outcomeMessage(result: { resumed: boolean; displayName: string; trialEndsOn: string | null }, t: T): string {
  return result.resumed
    ? t.t('signup.outcome.resumed', { org: result.displayName })
    : t.t('signup.outcome.created', { org: result.displayName });
}
