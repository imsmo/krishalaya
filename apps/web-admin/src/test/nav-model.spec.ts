// apps/web-admin/src/test/nav-model.spec.ts · unit tests for the pure god-mode nav model + admin-api notice mapping.
import { ADMIN_NAV, liveNav, soonNav, adminNoticeKey, activeNavHref } from '../features/nav/nav-model';

describe('admin nav model', () => {
  it('live routes are exactly the built ones (grows as waves land)', () => {
    expect(liveNav().map((i) => i.href)).toEqual(['/dashboard', '/ai-models', '/tenants', '/reports', '/flags', '/recon', '/billing', '/plans', '/providers', '/support', '/compliance', '/impersonation', '/staff', '/staff/me', '/analytics/reports', '/analytics/exports', '/analytics/mandi-pulse', '/analytics/demand-map', '/analytics/farmer-360', '/templates', '/integrations', '/settings', '/announcements', '/catalogue', '/schemes-registry', '/cells', '/moderation']);
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

// DEV-61 (shell adoption): activeNavHref is the single source of truth for Sidebar's aria-current="page".
describe('activeNavHref', () => {
  it('returns the exact match when pathname equals a nav href', () => {
    expect(activeNavHref('/dashboard')).toBe('/dashboard');
    expect(activeNavHref('/staff/me')).toBe('/staff/me');
  });
  it('returns the longest ancestor href for a nested detail route', () => {
    expect(activeNavHref('/tenants/abc-123')).toBe('/tenants');
    // '/staff/me' is itself a nav item AND the longer (more specific) ancestor of '/staff/me/permissions'
    // than '/staff' — it must win, not the shorter '/staff'.
    expect(activeNavHref('/staff/me/permissions')).toBe('/staff/me');
  });
  it('returns null when no nav href matches at all', () => {
    expect(activeNavHref('/login')).toBeNull();
    expect(activeNavHref('')).toBeNull();
  });
  it('never partial-word-matches (e.g. a hypothetical "/staffing" must not match "/staff")', () => {
    expect(activeNavHref('/staffing')).toBeNull();
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
