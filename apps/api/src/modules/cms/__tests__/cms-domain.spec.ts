// modules/cms/__tests__/cms-domain.spec.ts · pure-domain invariants (no I/O).
// Pins: page slug validation + draft-only editing + state machine + publish stamp; banner window validation +
// isLive(now) + url validation.
import { CmsPage } from '../domain/cms-page.entity';
import { Banner } from '../domain/banner.entity';
import { InvalidPageError, InvalidBannerError } from '../domain/cms.errors';
import { IllegalPageTransitionError } from '../domain/cms-page.state';

const page = (over: Partial<any> = {}) => CmsPage.create({ id: 'p1', tenantId: 't1', slug: 'privacy-policy', pageKind: 'policy', defaultTitle: 'Privacy', body: '# hello', version: 1, ...over });

describe('CmsPage', () => {
  it('rejects a non-kebab slug + empty title/body', () => {
    expect(() => page({ slug: 'Bad Slug' })).toThrow(InvalidPageError);
    expect(() => page({ defaultTitle: '' })).toThrow(InvalidPageError);
    expect(() => page({ body: '' })).toThrow(InvalidPageError);
  });
  it('draft→published stamps published_at; published cannot be edited; →archived; no publish from archived', () => {
    const p = page(); p.edit({ body: '# v2' }); expect(p.toProps().body).toBe('# v2');
    p.publish(); expect(p.status).toBe('published'); expect(p.toProps().publishedAt).toBeTruthy();
    expect(() => p.edit({ body: 'x' })).toThrow(InvalidPageError);
    p.archive(); expect(() => p.publish()).toThrow(IllegalPageTransitionError);
  });
  it('cannot archive→anything (terminal)', () => {
    const p = page(); p.archive(); expect(() => p.archive()).toThrow(IllegalPageTransitionError);
  });
});

describe('Banner (PC-56 TENANT-8d: born a draft; the phase is the state + the window)', () => {
  const now = new Date('2026-06-20T12:00:00Z');
  const banner = (over: Partial<any> = {}) => Banner.create({ id: 'b1', tenantId: 't1', placement: 'home_hero', mediaId: 'm1', targetUrl: 'https://krishi.example/x', audience: { roles: [], regions: [] }, startsAt: new Date('2026-06-20T00:00:00Z'), endsAt: new Date('2026-06-21T00:00:00Z'), groupKey: null, slotOrder: 1, createdBy: 'u1', ...over });
  it('rejects end<=start', () => {
    expect(() => banner({ endsAt: new Date('2026-06-19T00:00:00Z') })).toThrow(InvalidBannerError);
    expect(() => banner({ endsAt: new Date('2026-06-20T00:00:00Z') })).toThrow(InvalidBannerError);
  });
  it('a draft is never live; activated it is live inside the window; paused it is not', () => {
    const b = banner(); expect(b.state).toBe('draft'); expect(b.isLive(now)).toBe(false);
    b.activate('u1', now); expect(b.isLive(now)).toBe(true);
    expect(b.isLive(new Date('2026-06-22T00:00:00Z'))).toBe(false);   // after window — ended
    b.pause('u1', now, 'stock ran out'); expect(b.isLive(now)).toBe(false);
    expect(b.toProps()).toMatchObject({ state: 'paused', pausedBy: 'u1', pausedReason: 'stock ran out' });
    b.activate('u1', now); expect(b.pullEvents().map((e) => e.type)).toEqual(['cms.banner_created', 'cms.banner_activated', 'cms.banner_paused', 'cms.banner_resumed']);
    b.archive('u1', now, 'season over'); expect(() => b.activate('u1', now)).toThrow();
  });
});
