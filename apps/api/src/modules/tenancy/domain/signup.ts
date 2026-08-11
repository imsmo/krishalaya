// modules/tenancy/domain/signup.ts · the pure rules of a self-serve signup (PC-56 TENANT-1d-3a).
//
// Pure functions, no I/O. The slug rules and the trial-window arithmetic both live here because they are the two things a
// signup gets WRONG in a way the tenant lives with for years: a slug is in their storefront URL for ever, and a trial
// window decides when their first invoice appears.
import { DomainError } from '../../../shared/errors/app-error';

export class SignupRefusedError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 409, details);
  }
}

/** W113's default. Overridden by `signup.trial_days`; zero is refused, because a trial that ends on day one is dunning. */
export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_TRIAL_PLAN_CODE = 'starter';

export interface SignupPolicy { trialPlanCode: string; trialDays: number }

/**
 * The trial policy, from platform settings.
 *
 * **A MALFORMED SETTING FALLS BACK TO THE PUBLISHED DEFAULT, NEVER TO ZERO OR EMPTY.** `trialDays = 0` would put a
 * co-operative's subscription past its period end the moment it was created — the trial over before the first login — and
 * an empty plan code would make every signup fail. Same direction as 0130's bylaws: a broken setting must never produce a
 * worse outcome than the shipped one.
 */
export function signupPolicyFrom(raw: Record<string, unknown> | null | undefined): SignupPolicy {
  const code = typeof raw?.['signup.trial_plan_code'] === 'string' ? String(raw['signup.trial_plan_code']).trim() : '';
  const daysRaw = raw?.['signup.trial_days'];
  const n = typeof daysRaw === 'number' ? daysRaw : typeof daysRaw === 'string' ? Number(daysRaw) : Number.NaN;
  return {
    trialPlanCode: code.length > 0 ? code : DEFAULT_TRIAL_PLAN_CODE,
    trialDays: Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : DEFAULT_TRIAL_DAYS,
  };
}

/**
 * A URL-safe slug from the organisation's own name.
 *
 * **THE NAME MAY BE IN ANY SCRIPT AND THE SLUG MUST STILL EXIST.** "આનંદ ખેડૂત ઉત્પાદક કંપની" transliterates to nothing
 * under an ASCII filter, and a slug of `''` would either collide with every other such tenant or fail the NOT NULL. So a
 * name that yields no ASCII gets a stable readable fallback (`org`) which the uniqueness suffix then makes unique — and the
 * tenant can change their storefront address later, whereas a failed signup is a co-operative that walked away.
 *
 * Kept deliberately boring: lower case, ASCII letters and digits, single hyphens, no leading or trailing hyphen, 40 chars
 * of room so the uniqueness suffix fits inside 0002's `varchar(50)`.
 */
export function slugify(orgName: string): string {
  const base = (orgName ?? '')
    .normalize('NFKD')
    // Strip combining marks so "Ānand" becomes "Anand" rather than losing the letter entirely.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length > 0 ? base : 'org';
}

/**
 * The candidate slugs to try, in order.
 *
 * **A COLLISION IS NORMAL, NOT AN ERROR.** There are many organisations called "Kisan Producer Company", and the first one
 * to sign up must not own the name for ever while the rest get a failure. The first candidate is the clean slug; after that
 * a short numeric suffix, and finally a random one so a busy name cannot exhaust the list.
 */
export function slugCandidates(orgName: string, attempts = 6): string[] {
  const base = slugify(orgName);
  const out = [base];
  for (let i = 2; i < attempts; i++) out.push(`${base.slice(0, 44)}-${i}`);
  // The last resort is random rather than sequential: two simultaneous signups of the same name would otherwise both walk
  // the same list and race on every entry.
  out.push(`${base.slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`);
  return out;
}

/** The trial's period end. Days, not months: W113 promises fourteen days and a month is not fourteen days. */
export function trialPeriodEnd(startIso: string, days: number): string {
  const t = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return startIso.slice(0, 10);
  return new Date(t + Math.max(1, Math.floor(days)) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Is this organisation name usable at all?
 *
 * Length only. **NO CHARACTER RESTRICTION, IN ANY DIRECTION.** A rule that required Latin letters would refuse
 * "આનંદ ખેડૂત ઉત્પાદક કંપની" — the actual legal name of the canon's own tenant — and a platform whose signup form cannot
 * spell its customers' names is not a platform for those customers.
 */
export function validateOrgName(name: string): { ok: true; value: string } | { ok: false; reason: 'too_short' | 'too_long' } {
  const v = (name ?? '').trim();
  if (v.length < 3) return { ok: false, reason: 'too_short' };
  if (v.length > 200) return { ok: false, reason: 'too_long' };
  return { ok: true, value: v };
}

/** The console languages W113 offers. A code outside the set falls back to Hindi rather than failing the signup. */
export const SIGNUP_LANGUAGES = ['en', 'hi', 'gu'] as const;
export function languageOf(code: string | undefined | null): string {
  return (SIGNUP_LANGUAGES as readonly string[]).includes(String(code)) ? String(code) : 'hi';
}
