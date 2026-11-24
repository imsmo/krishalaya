// core/tenancy-context/__tests__/legal1-storefront-policies.spec.ts · PC-56 LEGAL-1 (migration 0242) — `GET /v1/storefront/policies/:slug`,
// mocked half (the live half is the lead's proof of `public_policy_page` against a fresh database).
//   • the allow-list: terms | privacy | refunds | shipping; anything else is 404 POLICY_NOT_FOUND and never reaches the database;
//   • no row = 404 POLICY_NOT_PUBLISHED (never placeholder text);
//   • the tenant is the REQUEST's context, never a parameter; the tenant's own version wins (the SQL orders it — here: the answer's
//     `source` is carried through and the context tenant is what is passed);
//   • language: `?lang=` wins, else the request's resolved locale reduced to its primary subtag; a malformed one is null (the version's own
//     words), never an error; the fallback marker is carried through;
//   • `@Public()`, rate-limited, NO flag (0223's named Law 10 exception).
import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { RATE_LIMIT_KEY } from '../../http/rate-limit.guard';
import { StorefrontPublicController } from '../storefront-public.controller';
import { POLICY_SLUGS, StorefrontPublicReadModel, isPolicySlug, policyLanguage } from '../storefront-public.read-model';

const TENANT = '0190f0aa-1111-7111-8111-111111111111';
const PUBLISHED = new Date('2026-11-20T10:00:00.000Z');

function setup(row: Record<string, unknown> | null) {
  const query = jest.fn(async () => ({ rows: row ? [row] : [] }));
  const rm = new StorefrontPublicReadModel({ replica: () => ({ query }) } as never);
  const flags = { isEnabled: jest.fn() };
  const ctl = new StorefrontPublicController(rm, flags as never);
  return { ctl, rm, query, flags };
}
const platformRow = (over: Record<string, unknown> = {}) => ({
  source: 'platform', slug: 'terms', title: 'Terms of Use', body: '## 1. Who we are', language_code: 'en', requested_language: 'hi',
  fallback_language: 'en', version: 3, published_at: PUBLISHED, ...over,
});
const errOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code: string; httpStatus: number }; } };
const ctx = (over: Record<string, unknown> = {}) => ({ tenantId: null, lang: 'en-IN', ...over }) as never;

describe('LEGAL-1 · the policy allow-list', () => {
  it('exactly the four slugs', () => {
    expect([...POLICY_SLUGS]).toEqual(['terms', 'privacy', 'refunds', 'shipping']);
    for (const s of POLICY_SLUGS) expect(isPolicySlug(s)).toBe(true);
    for (const s of ['about', 'TERMS', 'terms ', '', 'cookies', '../terms', null, 7]) expect(isPolicySlug(s)).toBe(false);
  });

  it('an unknown slug is 404 POLICY_NOT_FOUND and never queries', async () => {
    const { ctl, query } = setup(platformRow());
    for (const s of ['about', 'Terms', 'privacy-policy', "terms' OR 1=1 --"]) {
      expect(await errOf(ctl.policy(ctx(), s, {}))).toMatchObject({ code: 'POLICY_NOT_FOUND', httpStatus: 404 });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('no published row is 404 POLICY_NOT_PUBLISHED', async () => {
    const { ctl, query } = setup(null);
    expect(await errOf(ctl.policy(ctx(), 'privacy', {}))).toMatchObject({ code: 'POLICY_NOT_PUBLISHED', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('LEGAL-1 · the read', () => {
  it('ONE call of the definer function with the CONTEXT tenant, the slug and the language — on the replica', async () => {
    const { ctl, query } = setup(platformRow({ source: 'tenant' }));
    const out = await ctl.policy(ctx({ tenantId: TENANT }), 'terms', { lang: 'hi' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/FROM public_policy_page\(\$1::uuid, \$2::varchar, \$3::varchar\)/);
    expect(params).toEqual([TENANT, 'terms', 'hi']);
    expect(out.data.source).toBe('tenant');
  });

  it('the platform host passes NO tenant; a malformed context tenant id is never sent', async () => {
    const a = setup(platformRow());
    await a.ctl.policy(ctx({ tenantId: null }), 'terms', {});
    expect((a.query.mock.calls[0] as unknown as [string, unknown[]])[1][0]).toBeNull();
    const b = setup(platformRow());
    await b.rm.policy('not-a-uuid', 'terms', null);
    expect((b.query.mock.calls[0] as unknown as [string, unknown[]])[1][0]).toBeNull();
  });

  it('the answer: source, title, body, language, the fallback marker, version, publishedAt — and nothing about people', async () => {
    const { ctl } = setup(platformRow());
    const out = await ctl.policy(ctx(), 'terms', { lang: 'hi' });
    expect(out.data).toEqual({
      slug: 'terms', source: 'platform', title: 'Terms of Use', body: '## 1. Who we are', language: 'en', requestedLanguage: 'hi',
      fallbackLanguage: 'en', version: 3, publishedAt: PUBLISHED.toISOString(),
    });
  });

  it('a translated answer carries no fallback marker', async () => {
    const { ctl } = setup(platformRow({ title: 'उपयोग की शर्तें', body: '## परिचय', language_code: 'hi', fallback_language: null }));
    const out = await ctl.policy(ctx(), 'terms', { lang: 'hi' });
    expect(out.data).toMatchObject({ language: 'hi', fallbackLanguage: null, title: 'उपयोग की शर्तें' });
  });
});

describe('LEGAL-1 · the language asked for', () => {
  it('reduces a tag to its primary subtag; anything malformed is null', () => {
    expect(policyLanguage('hi-IN')).toBe('hi');
    expect(policyLanguage('GU')).toBe('gu');
    expect(policyLanguage('en_GB')).toBe('en');
    for (const bad of ['', 'h', 'hindi-language-long-tag-x', "hi'; DROP", 7, null, undefined, ['hi']]) expect(policyLanguage(bad)).toBeNull();
  });

  it('`?lang=` wins over the request locale; the request locale is the fallback; a bad ?lang= falls back too', async () => {
    const a = setup(platformRow());
    await a.ctl.policy(ctx({ lang: 'gu-IN' }), 'refunds', { lang: 'hi' });
    expect((a.query.mock.calls[0] as unknown as [string, unknown[]])[1][2]).toBe('hi');
    const b = setup(platformRow());
    await b.ctl.policy(ctx({ lang: 'gu-IN' }), 'refunds', {});
    expect((b.query.mock.calls[0] as unknown as [string, unknown[]])[1][2]).toBe('gu');
    const c = setup(platformRow());
    await c.ctl.policy(ctx({ lang: 'gu-IN' }), 'refunds', { lang: '<script>' });
    expect((c.query.mock.calls[0] as unknown as [string, unknown[]])[1][2]).toBe('gu');
  });
});

describe('LEGAL-1 · the route', () => {
  it('is @Public(), rate-limited per IP like platform-facts, and consults NO flag (0223\'s Law 10 exception)', async () => {
    const handler = StorefrontPublicController.prototype.policy;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, handler)).toEqual({ limit: 120, windowSec: 60, by: 'ip' });
    const { ctl, flags } = setup(platformRow());
    await ctl.policy(ctx(), 'shipping', {});
    expect(flags.isEnabled).not.toHaveBeenCalled();
  });
});
