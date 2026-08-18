// PC-56 TENANT-4d-1 · W118's meters and W115's plan choice — the registry that makes the limits and the
// counters speak one vocabulary, the stock/flow rule, the pause, and the trial that now carries its limits.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ASSERTED_BUT_UNPRICED, DEFAULT_ALERT_THRESHOLD_PCT, PLAN_METRICS, QUOTA_BEARING_STATUSES,
  SEEDED_LIMIT_CODES, STAFF_SEAT_ROLES, additionVerdict, alertThresholdPct, isStaffSeatRole, meterState,
  meterVerdict, metricDef, planChoiceRefusal, planLabel, projectLimit, statusBearsQuota,
} from '../domain/plan-usage';
import { grantsQuota } from '../domain/subscription.state';

describe('TENANT-4d-1 · the registry: what each of W118\'s four meters actually is', () => {
  it('the four meters are declared in the order W118 draws them, with their truth', () => {
    expect(PLAN_METRICS.map((m) => m.code)).toEqual(['members', 'staff_seats', 'api_calls', 'storage_gb']);
    // Members is the ONE meter with a seeded limit, and now the one thing that is enforced.
    expect(metricDef('members')).toEqual({ code: 'members', shape: 'stock', limitCode: 'max_farmers', source: 'live_count', enforcedBy: 'identity.member_add' });
    // Two of the four cannot be read at all — no counter, no limit.
    expect(metricDef('api_calls')?.source).toBe('none');
    expect(metricDef('storage_gb')?.source).toBe('none');
    expect(metricDef('staff_seats')?.limitCode).toBeNull();
  });

  it('STOCKS AND FLOWS ARE DISTINGUISHED — a stock in a monthly counter would drift the moment one is removed', () => {
    expect(metricDef('members')?.shape).toBe('stock');
    expect(metricDef('staff_seats')?.shape).toBe('stock');
    expect(metricDef('storage_gb')?.shape).toBe('stock');
    expect(metricDef('api_calls')?.shape).toBe('flow');
  });

  it('THE GATED METRICS AND THE PRICED METRICS DO NOT INTERSECT — thirteen quota checks that never fire', () => {
    expect(ASSERTED_BUT_UNPRICED.length).toBe(13);
    expect(SEEDED_LIMIT_CODES).toEqual(['max_farmers', 'max_languages', 'max_orders_month']);
    const overlap = ASSERTED_BUT_UNPRICED.filter((m) => SEEDED_LIMIT_CODES.includes(m));
    // When somebody prices them this fails, and is updated deliberately. That is the point of the assertion.
    expect(overlap).toEqual([]);
  });

  it('a staff SEAT is declared in code, because roles has no column for it', () => {
    expect([...STAFF_SEAT_ROLES]).toEqual(['tenant_admin', 'tenant_staff', 'support_agent', 'auditor', 'fpo_coordinator']);
    expect(isStaffSeatRole('tenant_admin')).toBe(true);
    expect(isStaffSeatRole('farmer')).toBe(false);       // a member is not a seat
    expect(isStaffSeatRole('customer')).toBe(false);
  });
});

describe('TENANT-4d-1 · the meter verdict', () => {
  const m = (usedValue: number | null, limitValue: number | null, code = 'members') => ({ code, usedValue, limitValue });

  it('an unmeasured meter is NEVER a zero with headroom — it says which half is missing', () => {
    expect(meterVerdict(m(null, 5000))).toEqual({ kind: 'not_measured', reason: 'no_source' });
    expect(meterVerdict(m(7, null))).toEqual({ kind: 'not_measured', reason: 'no_limit' });
    expect(meterVerdict(m(0, null, 'api_calls'))).toEqual({ kind: 'not_measured', reason: 'no_source' });
  });
  it('-1 is unlimited (0201\'s convention) and is not drawn as 100%', () => {
    expect(meterVerdict(m(1284, -1))).toEqual({ kind: 'unlimited', used: 1284 });
  });
  it('the percentage floors, and the notice fires at the threshold in force', () => {
    expect(meterVerdict(m(1284, 5000))).toEqual({ kind: 'within', used: 1284, limit: 5000, pct: 25, atNotice: false });
    expect(meterVerdict(m(4500, 5000))).toEqual({ kind: 'within', used: 4500, limit: 5000, pct: 90, atNotice: true });
    // ...and a tenant that moved its threshold gets its own answer.
    expect(meterVerdict(m(4000, 5000), 80)).toEqual({ kind: 'within', used: 4000, limit: 5000, pct: 80, atNotice: true });
  });
  it('AT the limit and OVER it are different sentences, and over is not clamped', () => {
    expect(meterVerdict(m(5000, 5000))).toEqual({ kind: 'at_limit', used: 5000, limit: 5000, pct: 100 });
    expect(meterVerdict(m(5200, 5000))).toEqual({ kind: 'over_limit', used: 5200, limit: 5000, pct: 104 });
    // A zero limit with usage is over, not "at" — the tenant is already being refused.
    expect(meterVerdict(m(1, 0))).toEqual({ kind: 'over_limit', used: 1, limit: 0, pct: 100 });
  });
  it('the state combines the registry with the flag: enforced only when something actually refuses', () => {
    expect(meterState(m(1284, 5000), true)).toBe('enforced');
    expect(meterState(m(1284, 5000), false)).toBe('counted_only');
    expect(meterState(m(7, null, 'staff_seats'), true)).toBe('not_measured');
    expect(meterState(m(null, 500000, 'api_calls'), true)).toBe('not_measured');
  });
  it('a malformed threshold falls back to the number on the screen, never to 0 or 100', () => {
    expect(DEFAULT_ALERT_THRESHOLD_PCT).toBe(90);
    expect(alertThresholdPct(80)).toBe(80);
    expect(alertThresholdPct(0)).toBe(90);
    expect(alertThresholdPct(101)).toBe(90);
    expect(alertThresholdPct('nonsense')).toBe(90);
    expect(alertThresholdPct(null)).toBe(90);
  });
});

describe('TENANT-4d-1 · the pause (W118: "at 100% new additions pause — existing operations never do")', () => {
  it('below the limit is allowed; at or over it is refused when enforcement is on', () => {
    expect(additionVerdict({ usedValue: 4999, limitValue: 5000 }, true)).toEqual({ kind: 'allow' });
    expect(additionVerdict({ usedValue: 5000, limitValue: 5000 }, true)).toEqual({ kind: 'refuse', used: 5000, limit: 5000 });
    expect(additionVerdict({ usedValue: 5001, limitValue: 5000 }, true)).toEqual({ kind: 'refuse', used: 5001, limit: 5000 });
  });
  it('with the flag OFF it allows AND SAYS SO — the screen already told the tenant enforcement is off', () => {
    expect(additionVerdict({ usedValue: 5000, limitValue: 5000 }, false)).toEqual({ kind: 'allow_unenforced', pct: 100 });
  });
  it('an unpriced or unlimited metric never refuses — a missing limit must not block a tenant\'s work', () => {
    expect(additionVerdict({ usedValue: 99999, limitValue: null }, true)).toEqual({ kind: 'allow' });
    expect(additionVerdict({ usedValue: 99999, limitValue: -1 }, true)).toEqual({ kind: 'allow' });
  });
});

describe('TENANT-4d-1 · A TRIAL NOW CARRIES THE LIMITS OF THE PLAN IT IS A TRIAL OF', () => {
  it('trialing, active and past_due bear quota; paused, cancelled and expired do not', () => {
    expect([...QUOTA_BEARING_STATUSES]).toEqual(['trialing', 'active', 'past_due']);
    for (const s of ['trialing', 'active', 'past_due']) expect(statusBearsQuota(s)).toBe(true);
    for (const s of ['paused', 'cancelled', 'expired']) expect(statusBearsQuota(s)).toBe(false);
  });
  it('and the subscription state machine agrees — one list, so the quota path and the meters cannot differ', () => {
    expect(grantsQuota('trialing')).toBe(true);
    expect(grantsQuota('active')).toBe(true);
    expect(grantsQuota('past_due')).toBe(true);
    expect(grantsQuota('paused')).toBe(false);
    expect(grantsQuota('cancelled')).toBe(false);
  });
});

describe('TENANT-4d-1 · W115\'s plan choice is validated, never silently substituted', () => {
  const plans = [
    { code: 'starter', version: 3, isPublic: true, isActive: true, countryCode: 'IN' },
    { code: 'growth', version: 2, isPublic: true, isActive: false, countryCode: 'IN' },
    { code: 'enterprise', version: 1, isPublic: false, isActive: true, countryCode: 'IN' },
    { code: 'pro', version: 1, isPublic: true, isActive: true, countryCode: 'BD' },
  ];
  it('an unknown, retired, non-public or out-of-country plan is refused BY NAME', () => {
    expect(planChoiceRefusal('starter', 'IN', plans)).toBeNull();
    expect(planChoiceRefusal('nothing', 'IN', plans)).toBe('SIGNUP_PLAN_UNKNOWN');
    expect(planChoiceRefusal('growth', 'IN', plans)).toBe('SIGNUP_PLAN_NOT_PUBLIC');      // inactive
    expect(planChoiceRefusal('enterprise', 'IN', plans)).toBe('SIGNUP_PLAN_NOT_PUBLIC');  // custom/govt
    expect(planChoiceRefusal('pro', 'IN', plans)).toBe('SIGNUP_PLAN_NOT_FOR_COUNTRY');
    expect(planChoiceRefusal('pro', 'BD', plans)).toBeNull();
  });
  it('the price-lock label prints the version the subscription actually points at', () => {
    expect(planLabel('Growth', 3)).toBe('Growth (v3)');
    expect(planLabel('Growth', null)).toBe('Growth');
  });
});

describe('TENANT-4d-1 · W118\'s projection needs history, and says so when it has none', () => {
  it('one observation is not a rate', () => {
    expect(projectLimit([{ month: '2026-08', value: 1284 }], 5000)).toEqual({ kind: 'not_available', reason: 'insufficient_history' });
    expect(projectLimit([], 5000)).toEqual({ kind: 'not_available', reason: 'insufficient_history' });
  });
  it('a flat or shrinking roster is not projected towards a limit it will never reach', () => {
    const flat = [{ month: '2026-06', value: 1284 }, { month: '2026-07', value: 1284 }];
    expect(projectLimit(flat, 5000)).toEqual({ kind: 'not_available', reason: 'not_growing' });
    const shrinking = [{ month: '2026-06', value: 1300 }, { month: '2026-07', value: 1200 }];
    expect(projectLimit(shrinking, 5000)).toEqual({ kind: 'not_available', reason: 'not_growing' });
  });
  it('an unlimited or unpriced limit has nothing to project towards', () => {
    const growing = [{ month: '2026-06', value: 100 }, { month: '2026-07', value: 190 }];
    expect(projectLimit(growing, -1)).toEqual({ kind: 'not_available', reason: 'no_limit' });
    expect(projectLimit(growing, null)).toEqual({ kind: 'not_available', reason: 'no_limit' });
  });
  it('a growing roster projects from the FIRST and LAST observations, and rounds the rate', () => {
    const h = [{ month: '2026-05', value: 1100 }, { month: '2026-06', value: 1190 }, { month: '2026-07', value: 1284 }];
    expect(projectLimit(h, 5000)).toEqual({ kind: 'reaches', monthsAway: 41, perMonth: 92 });
    // Already at or over the limit: zero months away, not a negative projection.
    expect(projectLimit(h, 1200)).toEqual({ kind: 'reaches', monthsAway: 0, perMonth: 92 });
  });
});

describe('TENANT-4d-1 · the wiring is real (sources, comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8'));

  it('the member-add path asks tenancy\'s PUBLIC service, and only for a NEW member', () => {
    const s = read('modules', 'identity', 'services', 'user-tenant-role.service.ts');
    expect(s).toContain('assertMemberSeatAvailable');
    expect(s).toContain('hasAnyRole');
    // A second role for somebody already on the roster must not consume a second seat.
    expect(s).toMatch(/if \(!\(await this\.utr\.hasAnyRole\([\s\S]{0,80}assertMemberSeatAvailable/);
    // The blueprint: a module uses another's public SERVICE, never its repositories.
    expect(s).not.toMatch(/PlanUsageRepository|tenancy\/repositories/);
  });

  it('the seat check reads the count and the limit INSIDE the write\'s transaction', () => {
    const s = read('modules', 'tenancy', 'services', 'plan-usage.service.ts');
    expect(s).toContain('memberCountForUpdate(tx');
    expect(s).toContain('planLimitForUpdate(tx');
    // A billing state that carries no plan must not block the roster.
    expect(s).toContain('statusBearsQuota(status)');
  });

  it('the alert job\'s default is now the number W118 prints, not 0.8', () => {
    const s = read('modules', 'tenancy', 'jobs', 'usage-limit-alerts.job.ts');
    expect(s).toContain('DEFAULT_ALERT_THRESHOLD_PCT / 100');
    expect(s).not.toMatch(/thresholdPct = 0\.8/);
  });

  it('signup honours a CHOSEN plan behind the flag, and refuses an unoffered one', () => {
    const s = read('modules', 'tenancy', 'services', 'tenant-signup.service.ts');
    expect(s).toContain("isEnabled('signup_plan_choice'");
    expect(s).toContain('publicPlanCodes');
    expect(s).toContain('SIGNUP_PLAN_NOT_OFFERED');
  });

  it('the stock counts come from the roster, and the flow counts from usage_counters', () => {
    const s = read('modules', 'tenancy', 'repositories', 'plan-usage.repository.ts');
    expect(s).toMatch(/memberCount[\s\S]{0,400}FROM user_tenant_roles/);
    expect(s).toMatch(/flowCounters[\s\S]{0,300}FROM usage_counters/);
    // Every query is tenant-scoped in its own predicate.
    const sql = [...s.matchAll(/`([^`]*(?:SELECT)[^`]*)`/g)].map((m) => m[1]);
    expect(sql.length).toBeGreaterThanOrEqual(7);
    for (const q of sql) expect(q).toMatch(/tenant_id\s*=\s*\$1|owner_tenant_id\s*=\s*\$1|country_code = \$1/);
  });
});

describe('TENANT-4d-1 · 0145 says what the wave claims (comments stripped)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0145_plan_limit_truth.sql'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

  it('the threshold becomes a setting whose default is the number on the screen', () => {
    expect(sql).toContain('plans.usage_alert_threshold_pct');
    expect(sql).toContain("'90'::jsonb");
  });
  it('both behaviour changes are behind flags, default OFF (Law 10)', () => {
    expect(sql).toContain("'plan_limit_enforcement'");
    expect(sql).toContain("'signup_plan_choice'");
    expect((sql.match(/false\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('IT SEEDS NO PRICING — the thirteen unpriced metrics are a founder decision, not a wave\'s', () => {
    expect(sql).not.toMatch(/INSERT INTO plan_limits/);
    expect(sql).not.toMatch(/labour_bookings|land_parcels|animals/);
  });
  it('and it adds the index the live stock counts need', () => {
    expect(sql).toContain('idx_utr_tenant_live');
    expect(sql).toContain('ON user_tenant_roles (tenant_id, role_id) WHERE deleted_at IS NULL');
  });
});
