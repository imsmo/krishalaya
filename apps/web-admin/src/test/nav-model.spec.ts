// apps/web-admin/src/test/nav-model.spec.ts · unit tests for the pure god-mode nav model + admin-api notice mapping.
import { ADMIN_NAV, liveNav, soonNav, adminNoticeKey } from '../features/nav/nav-model';

describe('admin nav model', () => {
  it('live routes are exactly the built ones (grows as waves land)', () => {
    expect(liveNav().map((i) => i.href)).toEqual(['/dashboard', '/ai-models', '/tenants', '/reports', '/flags', '/recon', '/billing', '/plans', '/providers', '/support', '/compliance', '/impersonation', '/staff', '/staff/me', '/announcements', '/catalogue', '/schemes-registry', '/cells', '/moderation']);
  });
  it('every nav item is either live or soon, never both; partition covers the whole map', () => {
    expect(liveNav().length + soonNav().length).toBe(ADMIN_NAV.length);
    expect(liveNav().some((i) => !i.live)).toBe(false);
    expect(soonNav().some((i) => i.live)).toBe(false);
  });
  it('every item has an href and a label key', () => {
    for (const i of ADMIN_NAV) { expect(i.href).toMatch(/^\//); expect(i.labelKey).toMatch(/^nav\./); }
  });
});

describe('adminNoticeKey', () => {
  it('maps status → notice key', () => {
    expect(adminNoticeKey(403)).toBe('needsElevation');
    expect(adminNoticeKey(401)).toBe('unauthorized');
    expect(adminNoticeKey(404)).toBe('notFound');
    expect(adminNoticeKey(500)).toBe('unavailable');
    expect(adminNoticeKey(undefined)).toBe('unavailable');
  });
});
