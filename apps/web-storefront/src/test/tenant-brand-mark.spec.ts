// Unit tests for the PURE DEV-26/Q20 brand-mark resolver (no React/IO). Proves the LOGO-4 canon's two-tier rule
// (BRAND-034-cobrand-fallback.html §3): a configured logo renders as-is; an unconfigured/absent one degrades to
// the tenant's OWN name (name-block), never a fabricated image and never the platform's own mark/green.
import { resolveBrandMark } from '../features/branding/brand-mark';

describe('resolveBrandMark', () => {
  it('renders the logo when the tenant has configured one', () => {
    const mark = resolveBrandMark({ displayName: 'Anand FPO', logoUrl: 'https://cdn.example/anand-fpo.svg' }, 'anand-fpo');
    expect(mark).toEqual({ kind: 'logo', src: 'https://cdn.example/anand-fpo.svg', alt: 'Anand FPO' });
  });

  it('falls back to the name-block (tenant display name) when logoUrl is null', () => {
    const mark = resolveBrandMark({ displayName: 'Anand FPO', logoUrl: null }, 'anand-fpo');
    expect(mark).toEqual({ kind: 'name', text: 'Anand FPO' });
  });

  it('falls back to the name-block when branding is null (no tenant context / fetch failed)', () => {
    const mark = resolveBrandMark(null, 'anand-fpo');
    expect(mark).toEqual({ kind: 'name', text: 'anand-fpo' });
  });

  it('falls back to the tenantSlug when displayName is blank/whitespace', () => {
    const mark = resolveBrandMark({ displayName: '   ', logoUrl: null }, 'anand-fpo');
    expect(mark).toEqual({ kind: 'name', text: 'anand-fpo' });
  });

  it('treats a blank/whitespace logoUrl as unset (never renders an empty <img src>)', () => {
    const mark = resolveBrandMark({ displayName: 'Anand FPO', logoUrl: '   ' }, 'anand-fpo');
    expect(mark).toEqual({ kind: 'name', text: 'Anand FPO' });
  });

  it('never returns an initial-tile result — only name-block or logo (this is a wide-slot context)', () => {
    const marks = [
      resolveBrandMark(null, 'x'),
      resolveBrandMark({ displayName: 'X', logoUrl: null }, 'x'),
      resolveBrandMark({ displayName: 'X', logoUrl: 'https://cdn/x.svg' }, 'x'),
    ];
    for (const m of marks) expect(['logo', 'name']).toContain(m.kind);
  });
});
