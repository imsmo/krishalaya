// modules/tenancy/__tests__/tenant1d3-signup.spec.ts · the door that did not exist (PC-56 TENANT-1d-3a).
//
// W113: "No account needed to start … 14-day free trial · no card needed · go live the same day."
//
// **THERE WAS NO DOOR IN EITHER DIRECTION.** Nothing in apps/api created a tenant (the only public intake, 0081's
// `tenant-applications`, files a REVIEW request), and `VerifyOtpSchema` requires a `tenantId`, so a person belonging to no
// organisation could not even authenticate. TENANT-1d's note said self-serve signup "exists in apps/api"; the suite it
// pointed at is the IN-TENANT plane and says in its own header that provisioning is god-mode and not part of it.
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_PLAN_CODE, SIGNUP_LANGUAGES,
  languageOf, signupPolicyFrom, slugCandidates, slugify, trialPeriodEnd, validateOrgName,
} from '../domain/signup';
import { TenantSignupService } from '../services/tenant-signup.service';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

describe('TENANT-1d-3a · the slug a tenant lives with for years', () => {
  it('an ASCII name becomes the obvious slug', () => {
    expect(slugify('Anand Farmer Producer Company')).toBe('anand-farmer-producer-company');
  });

  it('A NAME IN GUJARATI STILL YIELDS A USABLE SLUG', () => {
    // The canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની". An ASCII filter leaves nothing, and `''` would either collide
    // with every other such tenant or fail the NOT NULL — i.e. a co-operative that cannot sign up in its own language.
    const s = slugify('આનંદ ખેડૂત ઉત્પાદક કંપની');
    expect(s.length).toBeGreaterThan(0);
    expect(s).toBe('org');
  });

  it('accents are folded rather than dropped', () => {
    expect(slugify('Ānand Kisan')).toBe('anand-kisan');
  });

  it('punctuation collapses to single hyphens with no leading or trailing one', () => {
    expect(slugify('  --Shree  Ram!! (FPO) --  ')).toBe('shree-ram-fpo');
  });

  it('stays inside 0002ʼs varchar(50) even with the uniqueness suffix', () => {
    const long = 'Shree Sardar Patel Sahakari Kheti Utpadak Mandali Limited Junagadh District';
    for (const c of slugCandidates(long)) expect(c.length).toBeLessThanOrEqual(50);
  });

  it('offers a list of candidates, because a collision is normal and not an error', () => {
    // Many organisations are called "Kisan Producer Company"; the first to sign up must not own the name for ever.
    const cands = slugCandidates('Kisan Producer Company');
    expect(cands[0]).toBe('kisan-producer-company');
    expect(cands.length).toBeGreaterThan(3);
    expect(new Set(cands).size).toBe(cands.length);
  });

  it('the last candidate is RANDOM, so two simultaneous signups of one name cannot walk the same list', () => {
    const a = slugCandidates('Kisan Producer Company');
    const b = slugCandidates('Kisan Producer Company');
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
  });
});

describe('TENANT-1d-3a · the organisation name is accepted in any script', () => {
  it('accepts Gujarati, Hindi and English', () => {
    for (const n of ['આનંદ ખેડૂત ઉત્પાદક કંપની', 'आनंद किसान उत्पादक कंपनी', 'Anand FPO']) {
      expect(validateOrgName(n).ok).toBe(true);
    }
  });

  it('refuses only on length, and trims first', () => {
    expect(validateOrgName('  ab  ')).toEqual({ ok: false, reason: 'too_short' });
    expect(validateOrgName('x'.repeat(201))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateOrgName('  Anand FPO  ')).toEqual({ ok: true, value: 'Anand FPO' });
  });

  it('no character class exists in the validator', () => {
    // A rule requiring Latin letters would refuse the canon's own tenant. Asserted on the source so it cannot creep back.
    const src = stripComments(read('domain/signup.ts'));
    const fn = src.slice(src.indexOf('export function validateOrgName'), src.indexOf('export const SIGNUP_LANGUAGES'));
    expect(fn).not.toMatch(/\[a-z/i);
  });
});

describe('TENANT-1d-3a · the trial policy is data, and a broken setting never makes it worse', () => {
  it('reads the platform settings', () => {
    expect(signupPolicyFrom({ 'signup.trial_plan_code': 'growth', 'signup.trial_days': 30 }))
      .toEqual({ trialPlanCode: 'growth', trialDays: 30 });
  });

  it('missing settings fall back to W113ʼs own numbers', () => {
    expect(signupPolicyFrom(null)).toEqual({ trialPlanCode: DEFAULT_TRIAL_PLAN_CODE, trialDays: DEFAULT_TRIAL_DAYS });
  });

  it.each([[0], [-5], ['nonsense'], [null], [400], [{}]])('a malformed trial length (%p) becomes 14, never 0', (bad) => {
    const p = signupPolicyFrom({ 'signup.trial_days': bad });
    expect(p.trialDays).toBe(DEFAULT_TRIAL_DAYS);
    // A zero-day trial would put a co-operative past its period end the moment the row was written — dunning on day one.
    expect(p.trialDays).toBeGreaterThan(0);
  });

  it('an empty plan code falls back rather than making every signup fail', () => {
    expect(signupPolicyFrom({ 'signup.trial_plan_code': '   ' }).trialPlanCode).toBe(DEFAULT_TRIAL_PLAN_CODE);
  });
});

describe('TENANT-1d-3a · the trial window', () => {
  it('is fourteen DAYS, not a month', () => {
    expect(trialPeriodEnd('2026-08-11', 14)).toBe('2026-08-25');
  });

  it('crosses a month and a year end correctly', () => {
    expect(trialPeriodEnd('2026-12-24', 14)).toBe('2027-01-07');
  });

  it('never returns the start date itself, even for a zero or negative length', () => {
    // Defence in depth: `signupPolicyFrom` already refuses 0, and this refuses it again — a trial that ends on the day it
    // starts is the one outcome that must be impossible from both directions.
    expect(trialPeriodEnd('2026-08-11', 0)).toBe('2026-08-12');
    expect(trialPeriodEnd('2026-08-11', -3)).toBe('2026-08-12');
  });

  it('a malformed start date returns a date rather than NaN', () => {
    // Ten characters of the input back — a date-shaped string the caller can see is wrong, rather than "NaN-NaN-NaN".
    expect(trialPeriodEnd('not-a-date', 14)).toBe('not-a-date');
  });
});

describe('TENANT-1d-3a · the console language', () => {
  it('accepts the three W113 offers', () => {
    for (const l of SIGNUP_LANGUAGES) expect(languageOf(l)).toBe(l);
  });

  it('falls back to Hindi rather than failing the signup', () => {
    // A farmer who sent an unexpected locale header must still get an organisation.
    expect(languageOf('xx')).toBe('hi');
    expect(languageOf(undefined)).toBe('hi');
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE GUARDS — what makes this route safe to be public                                                              */
/* ---------------------------------------------------------------------------------------------------------------- */

describe('TENANT-1d-3a · the route is public, and constrained', () => {
  const ctl = () => stripComments(read('controllers/v1/tenant-signup.controller.ts'));

  it('is @Public, rate-limited and requires an Idempotency-Key', () => {
    const s = ctl();
    expect(s).toContain('@Public()');
    expect(s).toMatch(/@RateLimit\(\{[^}]*by: 'ip'/);
    // **THE CONDITION, NOT THE MESSAGE.** A mutation turned `if (!key)` into `if (false)` and this assertion stayed green,
    // because the sentence was still there — inside a branch that could no longer run. Same shape as the registry guard
    // that matched an import line one wave ago: assert the code that DECIDES, never the text beside it.
    expect(s).toMatch(/if \(!key\) throw new BadRequestError\('Idempotency-Key header required'\)/);
    expect(s).toContain('this.idem');
    expect(s).toContain('.remember(');
  });

  it('the idempotency key is scoped to the phone, so two callers cannot collide on a guessed key', () => {
    expect(ctl()).toMatch(/remember\(`\$\{key\}:\$\{dto\.phone\}`/);
  });

  it('the request body cannot carry a plan, a price or a status', () => {
    const dto = stripComments(read('dto/tenant-signup.dto.ts'));
    const schema = /TenantSignupSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/.exec(dto)?.[1] ?? '';
    expect(schema.length).toBeGreaterThan(0);
    for (const forbidden of ['planId', 'plan_code', 'priceMinor', 'status', 'features', 'trialDays']) {
      expect(schema).not.toContain(forbidden);
    }
    // `.strict()` is what refuses an unexpected field instead of ignoring it.
    expect(dto).toContain('.strict()');
  });

  it('the org name has NO character restriction in the schema either', () => {
    const dto = stripComments(read('dto/tenant-signup.dto.ts'));
    const line = dto.split('\n').find((l) => l.includes('orgName')) ?? '';
    expect(line).not.toMatch(/regex/);
  });
});

describe('TENANT-1d-3a · what the service may and may not do', () => {
  const svc = () => stripComments(read('services/tenant-signup.service.ts'));
  const repo = () => stripComments(read('repositories/tenant-signup.repository.ts'));

  it('verifies the OTP through the SHARED OtpService, not a second implementation', () => {
    const s = svc();
    expect(s).toContain('this.otp.verify(');
    // No hand-rolled comparison on the one route that can create a tenant.
    expect(s).not.toMatch(/timingSafeEqual|createHmac|=== *input\.code/);
  });

  it('checks the code BEFORE any read or write', () => {
    const s = svc();
    const verify = s.indexOf('this.otp.verify(');
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(s.indexOf('this.uow.run('));
    expect(verify).toBeLessThan(s.indexOf('this.repo.'));
  });

  it('creates the tenant at status trial and CANNOT set any other lifecycle state (Law 11)', () => {
    const r = repo();
    const fn = r.slice(r.indexOf('async insertTenant('), r.indexOf('async roleIdByCode('));
    expect(fn).toContain("'trial'");
    for (const forbidden of ["'active'", "'suspended'", "'archived'", "'terminated'", 'status = $']) {
      expect(fn).not.toContain(forbidden);
    }
  });

  it('grants no features anywhere in the plane', () => {
    // Capability comes from the plan, resolved the ordinary way. A signup that could grant a feature is god-mode.
    for (const src of [svc(), repo()]) expect(src).not.toContain('tenant_features');
  });

  it('the whole creation is ONE transaction — no half-made organisation', () => {
    const s = svc();
    const tx = s.indexOf('this.uow.run(');
    for (const inside of ['insertTenant(', 'grantOwnerRole(', 'insertTrialSubscription(', 'audit.write(', 'outbox.write(']) {
      expect(s.indexOf(inside)).toBeGreaterThan(tx);
    }
  });

  it('a missing tenant_admin role ROLLS BACK rather than leaving an unreachable organisation', () => {
    const s = svc();
    expect(s).toContain("roleIdByCode(tx, 'tenant_admin')");
    expect(s).toMatch(/if \(!roleId\) throw/);
  });

  it('an unresolvable trial plan REFUSES instead of guessing a plan to bill', () => {
    const s = svc();
    expect(s).toContain('SIGNUP_TRIAL_PLAN_UNAVAILABLE');
    // No "pick the cheapest" fallback: a co-operative must not discover its terms on the first invoice.
    expect(s).not.toMatch(/ORDER BY monthly_price_minor|cheapest/i);
  });

  it('the trial plan must be PUBLIC and ACTIVE — an enterprise quote is not a trial', () => {
    const fn = repo().slice(repo().indexOf('async trialPlan('), repo().indexOf('async tenantTypeExists('));
    expect(fn).toContain('is_public = true');
    expect(fn).toContain('is_active = true');
  });

  it('the subscription starts trialing at the plan price, never at zero', () => {
    // A trial storing 0 would make TENANT-1d-2's proration read the conversion as an upgrade from free and inflate the
    // first invoice.
    const fn = repo().slice(repo().indexOf('async insertTrialSubscription('));
    expect(fn).toContain("'trialing'");
    expect(fn).not.toMatch(/price_minor.*0/);
  });
});

describe('TENANT-1d-3a · one active organisation per verified phone', () => {
  const svc = () => stripComments(read('services/tenant-signup.service.ts'));
  const repo = () => stripComments(read('repositories/tenant-signup.repository.ts'));

  it('the rule is decided from the tenant_admin GRANT, not from tenants.owner_phone', () => {
    // `owner_phone` is a contact field: editable, sometimes a shared office line, never kept in step with who administers
    // the console. The grant is the same fact that decides what the person can DO.
    const fn = repo().slice(repo().indexOf('async findAdministeredTenant('), repo().indexOf('async signupSettings('));
    expect(fn).toContain("r.code = 'tenant_admin'");
    expect(fn).not.toContain('owner_phone');
  });

  it('an archived or terminated organisation does NOT block a fresh start', () => {
    const fn = repo().slice(repo().indexOf('async findAdministeredTenant('), repo().indexOf('async signupSettings('));
    expect(fn).toMatch(/status NOT IN \('archived', 'terminated'\)/);
  });

  it('the resume check runs on the WRITER inside the transaction, so two taps cannot both create', () => {
    const s = svc();
    const tx = s.indexOf('this.uow.run(');
    const check = s.indexOf('findAdministeredTenant(tx');
    expect(check).toBeGreaterThan(tx);
  });

  it('a resume creates nothing and is still RECORDED', () => {
    const s = svc();
    const block = s.slice(s.indexOf('if (existing) {'), s.indexOf("return { kind: 'resumed'"));
    expect(block).toContain('tenancy.signup_resumed');
    for (const write of ['insertTenant(', 'insertTrialSubscription(', 'grantOwnerRole(']) {
      expect(block).not.toContain(write);
    }
  });
});

describe('TENANT-1d-3a · credentials are minted in ONE place', () => {
  it('signup opens its session through AuthService, not a second token path', () => {
    const s = stripComments(read('services/tenant-signup.service.ts'));
    expect(s).toContain('this.auth.openSessionFor(');
    for (const forbidden of ['mintAccessToken', 'refresh.issue(', 'Session.create(']) {
      expect(s).not.toContain(forbidden);
    }
  });

  it('the login path uses the same extracted method, so there is only one implementation', () => {
    const auth = stripComments(read('../identity/services/auth.service.ts'));
    expect(auth).toContain('async openSessionIn(');
    // `verifyOtp` must call it rather than keeping its own copy of the session/device/login-event sequence.
    const verify = auth.slice(auth.indexOf('async verifyOtp('), auth.indexOf('async refreshSession('));
    expect(verify).toContain('this.openSessionIn(');
    expect(verify).not.toContain('Session.create(');
  });

  it('the token cannot be minted before the tenant exists', () => {
    // An access token carries the tenant id; minting first and hoping would produce a session for a tenant that is not there.
    const s = stripComments(read('services/tenant-signup.service.ts'));
    expect(s.indexOf('this.uow.run(')).toBeLessThan(s.indexOf('this.auth.openSessionFor('));
  });

  it('the service exists with the one method the route needs', () => {
    expect(typeof (TenantSignupService.prototype as unknown as Record<string, unknown>).signUp).toBe('function');
  });
});
