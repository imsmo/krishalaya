// apps/web-storefront/src/features/signup/flow.ts · PC-56 STORE-1c — canon W307 "Open your organisation's storefront" and its 14 chain pages
// (W2466–W2472, W3064–W3070) as ONE route with URL-carried steps. PURE: no React, no Next, no I/O (the cookie half is lib/signup-flow.ts).
//
//   ?step=form     W307's form; W2466 = W3064 (form-error) is the SAME form re-rendered with every refusal against its field (the house
//                  rule of features/forms/chain.ts: "two screens with one implementation, because they are one question");
//   ?step=code     W307's "OTP sent" state: the masked phone, the server's TTL, the resend gated by the server's seconds;
//   ?step=review   W2467 = W3065: everything that will be created, read-only, the Idempotency-Key minted AT RENDER (survey F-14);
//   ?step=done     W2468 = W3066: created (or resumed — "this phone already administers …");
//   ?step=failure  W2469 = W3067: the named refusal, "nothing was changed", Retry = the SAME key (W2470–W2472 / W3068–W3070 are that
//                  Retry — PARITY-DECOR, FLOWMAP_tenant:1011 `decor-offline-retry`; no confirm page is built over a replay).
//
// NO PII IN THE URL, EVER (survey E5). The URL carries the step, named refusal codes and small numbers; the phone, the code, the names
// typed and the key live in the httpOnly `kv_signup` cookie (15 minutes). `signupHref` refuses a phone-shaped value (STORE-1a's guard).
//
// Ported from apps/web-tenant/src/features/signup/steps.ts (the PURE parts: the step prerequisite rule, the length-only name rule — the
// API's own — the console languages, the key shape). The values-carrying chain is NOT copied: STORE-1a's port features/forms/chain.ts is
// reused (`carryValues`), and so are 1a's phone rule (features/auth/phone.ts), refusal classifier (features/auth/failure.ts) and mask.
import { carryValues } from '../forms/chain';
import { assertPiiFree } from '../auth/login-state';
import { checkPhone } from '../auth/phone';
import { classifyRequestFailure } from '../auth/failure';

export const SIGNUP_STEPS = ['form', 'code', 'review', 'done', 'failure'] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];

/** The console languages W113 / W307 offer — the API's own list (`SIGNUP_LANGUAGES`, modules/tenancy/domain/signup.ts). */
export const SIGNUP_LANGS = ['en', 'hi', 'gu'] as const;
export type SignupLang = (typeof SIGNUP_LANGS)[number];

/** What the form holds. `typed` = the phone exactly as typed (kept on every refusal); everything here lives in the cookie, never the URL. */
export interface SignupValues { orgName: string; orgTypeId: string; fullName: string; typed: string; lang: SignupLang }

/** The server-held state between steps (lib/signup-flow.ts writes it as the `kv_signup` cookie). */
export interface PendingSignup extends SignupValues {
  /** The E.164 number a code was sent to (absent until one was). */
  phone?: string;
  /** Epoch seconds: sent at, resend allowed from; the code's lifetime as the API stated it. */
  sentAt?: number; resendAt?: number; ttlSec?: number;
  /** The code typed on the code step (the API verifies it ONCE, at creation — checking it earlier would spend it). */
  code?: string;
  /** The Idempotency-Key of the last submit — Retry re-sends it (W2470–W2472: an idempotent replay). */
  idem?: string;
  /** The outcome, for the done step. */
  done?: { org: string; slug: string; trialEndsOn: string | null; resumed: boolean };
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* STEPS                                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/**
 * Which step a request may be on. **A STEP CANNOT BE REACHED PAST ITS PREREQUISITE** (web-tenant's `resolveStep` rule): the code step needs
 * a number a code was sent to; the review needs that number AND a code; done needs an outcome; failure needs something to retry.
 */
export function resolveSignupStep(raw: unknown, p: PendingSignup | null): SignupStep {
  const wanted: SignupStep = (SIGNUP_STEPS as readonly string[]).includes(String(raw ?? '')) ? (raw as SignupStep) : 'form';
  if (wanted === 'code' && !p?.phone) return 'form';
  if (wanted === 'review' && !(p?.phone && p?.code)) return p?.phone ? 'code' : 'form';
  if (wanted === 'done' && !p?.done) return 'form';
  if (wanted === 'failure' && !(p?.phone && p?.code)) return 'form';
  return wanted;
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* THE FORM'S REFUSALS — each against its field (W2466: "every invalid field listed with its reason")                                     */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

export const FIELD_REFUSALS = ['org_short', 'org_long', 'type_missing', 'name_short', 'name_long', 'phone_empty', 'phone_digits', 'phone_invalid'] as const;
export type FieldRefusal = (typeof FIELD_REFUSALS)[number];
/** Which form field a refusal is shown against. */
export const REFUSAL_FIELD: Readonly<Record<FieldRefusal, 'orgName' | 'orgTypeId' | 'fullName' | 'phone'>> = Object.freeze({
  org_short: 'orgName', org_long: 'orgName', type_missing: 'orgTypeId', name_short: 'fullName', name_long: 'fullName',
  phone_empty: 'phone', phone_digits: 'phone', phone_invalid: 'phone',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API's own length rules (TenantSignupSchema / validateOrgName) — interpolated into the refusals, never written in a catalogue. */
export const NAME_RULES = Object.freeze({ orgMin: 3, orgMax: 200, nameMin: 2, nameMax: 200 });

export type FormCheck =
  | { ok: true; e164: string }
  | { ok: false; refusals: FieldRefusal[]; digits?: { need: number; have: number; dial: string } };

/**
 * Every refusal at once (never the first only). The name rules are the API's own (`validateOrgName`, the DTO's fullName 2..200) — length
 * only, any script: the canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની". The phone rule is STORE-1a's, for the platform's country.
 */
export function checkSignupForm(v: SignupValues, country: string | null): FormCheck {
  const refusals: FieldRefusal[] = [];
  const org = v.orgName.trim();
  if (org.length < NAME_RULES.orgMin) refusals.push('org_short'); else if (org.length > NAME_RULES.orgMax) refusals.push('org_long');
  if (!UUID.test(v.orgTypeId.trim())) refusals.push('type_missing');
  const name = v.fullName.trim();
  if (name.length < NAME_RULES.nameMin) refusals.push('name_short'); else if (name.length > NAME_RULES.nameMax) refusals.push('name_long');
  const ph = checkPhone(v.typed, country);
  let digits: { need: number; have: number; dial: string } | undefined;
  if (ph.kind === 'empty') refusals.push('phone_empty');
  else if (ph.kind === 'digits') { refusals.push('phone_digits'); digits = { need: ph.need, have: ph.have, dial: ph.dial }; }
  else if (ph.kind === 'generic') refusals.push('phone_invalid');
  if (refusals.length > 0 || ph.kind !== 'ok') return { ok: false, refusals, ...(digits ? { digits } : {}) };
  return { ok: true, e164: ph.e164 };
}

export function signupLang(raw: unknown, fallback: string): SignupLang {
  const s = String(raw ?? '');
  if ((SIGNUP_LANGS as readonly string[]).includes(s)) return s as SignupLang;
  return (SIGNUP_LANGS as readonly string[]).includes(fallback) ? (fallback as SignupLang) : 'en';
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* NAMED REFUSALS FROM THE API — W2469 = W3067 (and the ones that send the person back to a field or to the code)                       */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** Every named refusal the chain can show (`signup.err.<code>` in each catalogue). */
export const SIGNUP_ERRORS = [
  // form step — the name, the code request
  'taken', 'reserved', 'invalid', 'rate_cooldown', 'rate_hourly', 'rate_ip', 'channel', 'start_again',
  // code step
  'code_format', 'code_wrong', 'code_expired', 'code_locked',
  // failure step (W2469)
  'disabled', 'plan_not_offered', 'trial_unavailable', 'rate_signup', 'rate_verify', 'unavailable',
] as const;
export type SignupError = (typeof SIGNUP_ERRORS)[number];

export interface SignupFailure { step: 'form' | 'code' | 'failure'; err: SignupError; n?: number; left?: number; max?: number }

interface ErrLike { code?: unknown; status?: unknown; details?: unknown }
const det = (e: unknown): Record<string, unknown> => {
  const d = (e as ErrLike | null)?.details;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.ceil(v) : undefined);

/** POST /v1/tenant-signup failed — WHERE the person goes back to, and WHY, by name. An unknown failure is `unavailable` (Law 12). */
export function classifySignupFailure(e: unknown): SignupFailure {
  const code = String((e as ErrLike | null)?.code ?? '');
  const status = Number((e as ErrLike | null)?.status ?? 0);
  const d = det(e);
  switch (code) {
    case 'SIGNUP_DISABLED': return { step: 'failure', err: 'disabled' };
    case 'SIGNUP_SLUG_UNAVAILABLE': return { step: 'form', err: 'taken' };
    case 'SIGNUP_SLUG_RESERVED': return { step: 'form', err: 'reserved' };
    case 'SIGNUP_PLAN_NOT_OFFERED': return { step: 'failure', err: 'plan_not_offered' };
    case 'SIGNUP_TRIAL_PLAN_UNAVAILABLE': case 'SIGNUP_ROLE_MISSING': return { step: 'failure', err: 'trial_unavailable' };
    case 'OTP_INVALID':
      if (d.reason === 'wrong') return { step: 'code', err: 'code_wrong', left: num(d.attemptsLeft) };
      if (d.reason === 'locked') return { step: 'code', err: 'code_locked', n: num(d.retryAfterSec) };
      return { step: 'code', err: 'code_expired' };
    case 'INVALID_PHONE': return { step: 'form', err: 'invalid' };
    default: break;
  }
  if (status === 429) {
    if (d.limit === 'verifications_per_hour') return { step: 'failure', err: 'rate_verify', n: num(d.retryAfterSec), max: num(d.max) };
    return { step: 'failure', err: 'rate_signup', n: num(d.windowSec) };       // the route's own per-connection limit (5 an hour)
  }
  if (status === 400 || status === 422) return { step: 'form', err: 'invalid' };
  return { step: 'failure', err: 'unavailable' };
}

/** POST /v1/auth/otp failed (the code request on the form) — STORE-1a's classifier, said on the signup form. */
export function classifyCodeRequestFailure(e: unknown): SignupFailure & { step: 'form' } {
  const f = classifyRequestFailure(e);
  switch (f.err) {
    case 'rate_cooldown': return { step: 'form', err: 'rate_cooldown', n: f.n };
    case 'rate_hourly': return { step: 'form', err: 'rate_hourly', n: f.n, max: f.max };
    case 'rate_ip': return { step: 'form', err: 'rate_ip', n: f.n };
    case 'channel': return { step: 'form', err: 'channel' };
    case 'phone_invalid': return { step: 'form', err: 'invalid' };
    default: return { step: 'form', err: 'unavailable' };
  }
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* THE URL                                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

export interface SignupParams {
  step: string; err: SignupError | null; fields: FieldRefusal[];
  n: number | null; left: number | null; max: number | null; need: number | null; have: number | null; dial: string | null; sent: boolean;
}
const int = (raw: unknown, max: number): number | null => {
  const s = String(raw ?? '');
  return /^\d{1,6}$/.test(s) && Number(s) <= max ? Number(s) : null;
};
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function readSignupParams(sp: Record<string, string | string[] | undefined>): SignupParams {
  const err = String(first(sp.err) ?? '');
  const dial = String(first(sp.dial) ?? '');
  return {
    step: String(first(sp.step) ?? 'form'),
    err: (SIGNUP_ERRORS as readonly string[]).includes(err) ? (err as SignupError) : null,
    fields: String(first(sp.e) ?? '').split('.').filter((x): x is FieldRefusal => (FIELD_REFUSALS as readonly string[]).includes(x)),
    n: int(first(sp.n), 86_400), left: int(first(sp.left), 99), max: int(first(sp.max), 1000),
    need: int(first(sp.need), 20), have: int(first(sp.have), 40), dial: /^\d{1,3}$/.test(dial) ? dial : null,
    sent: first(sp.sent) === '1',
  };
}

export const SIGNUP_PATH = '/for-organisations';

/** The href of a signup state. Carries no PII — and throws (STORE-1a's `assertPiiFree`) if a phone-shaped value ever reaches it. */
export function signupHref(step: SignupStep, p: { err?: SignupError | null; fields?: FieldRefusal[]; n?: number | null; left?: number | null; max?: number | null;
  need?: number | null; have?: number | null; dial?: string | null; sent?: boolean } = {}): string {
  const v: Record<string, string | undefined> = {
    err: p.err ?? undefined, e: p.fields && p.fields.length ? p.fields.join('.') : undefined,
    n: p.n != null ? String(p.n) : undefined, left: p.left != null ? String(p.left) : undefined, max: p.max != null ? String(p.max) : undefined,
    need: p.need != null ? String(p.need) : undefined, have: p.have != null ? String(p.have) : undefined, dial: p.dial ?? undefined,
    sent: p.sent ? '1' : undefined,
  };
  const href = `${SIGNUP_PATH}?${carryValues(step, v).query}`;
  assertPiiFree(href);
  return href;
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* THE KEY, THE COOKIE CODEC, THE DATE                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** An Idempotency-Key the page minted (a UUID — `randomUUID()` at render). Anything else is replaced, never trusted. */
export const isIdemKey = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const fin = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function encodePending(p: PendingSignup): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}
/** Decode and RE-VALIDATE every field (a cookie is input like any other): bad shapes are dropped, never trusted. */
export function decodePending(raw: string | undefined | null): PendingSignup | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const done = o.done && typeof o.done === 'object' ? (o.done as Record<string, unknown>) : null;
  return {
    orgName: str(o.orgName, 200), orgTypeId: UUID.test(str(o.orgTypeId, 36)) ? str(o.orgTypeId, 36) : '', fullName: str(o.fullName, 200),
    typed: str(o.typed, 32), lang: signupLang(o.lang, 'en'),
    phone: typeof o.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(o.phone) ? o.phone : undefined,
    sentAt: fin(o.sentAt), resendAt: fin(o.resendAt), ttlSec: fin(o.ttlSec),
    code: typeof o.code === 'string' && /^\d{4,8}$/.test(o.code) ? o.code : undefined,
    idem: isIdemKey(o.idem) ? o.idem : undefined,
    done: done && typeof done.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,49}$/.test(done.slug)
      ? { org: str(done.org, 200), slug: done.slug, trialEndsOn: typeof done.trialEndsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(done.trialEndsOn) ? done.trialEndsOn : null, resumed: done.resumed === true }
      : undefined,
  };
}

/** A calendar date the API returned (`YYYY-MM-DD`, the trial's last day) in the reader's language — a DATE, so no clock shift is applied. */
export function formatDay(iso: string, intlLocale: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(t));
}
