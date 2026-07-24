// packages/ui/src/__tests__/AppShell.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell, ImpersonationBanner } from '../components/AppShell';

describe('AppShell', () => {
  it('renders the shell grid with sidebar/topbar/content, no collapse/impersonation classes by default', () => {
    const html = renderToStaticMarkup(
      <AppShell sidebar={<div>SIDEBAR</div>} topbar={<div>TOPBAR</div>}>
        <p>content</p>
      </AppShell>,
    );
    expect(html).toContain('class="web-shell"');
    expect(html).not.toContain('is-collapsed');
    expect(html).not.toContain('has-impersonation');
    expect(html).toContain('<main class="kvw-content">');
    expect(html).toContain('SIDEBAR');
    expect(html).toContain('TOPBAR');
  });

  it('applies is-collapsed when collapsed=true', () => {
    const html = renderToStaticMarkup(
      <AppShell sidebar={null} topbar={null} collapsed>
        <p>x</p>
      </AppShell>,
    );
    expect(html).toContain('web-shell is-collapsed');
  });

  it('renders the impersonation banner and has-impersonation class when supplied', () => {
    const html = renderToStaticMarkup(
      <AppShell sidebar={null} topbar={null} impersonation={{ message: 'Acting as Acme FPO', actionLabel: 'Exit', onAction: () => {} }}>
        <p>x</p>
      </AppShell>,
    );
    expect(html).toContain('has-impersonation');
    expect(html).toContain('kvw-impersonation');
    expect(html).toContain('Acting as Acme FPO');
    expect(html).toContain('Exit');
  });

  it('applies data-kv-realm only for a non-default realm (admin gold / gov blue wiring)', () => {
    const admin = renderToStaticMarkup(<AppShell sidebar={null} topbar={null} realm="admin"><p /></AppShell>);
    const gov = renderToStaticMarkup(<AppShell sidebar={null} topbar={null} realm="gov"><p /></AppShell>);
    const def = renderToStaticMarkup(<AppShell sidebar={null} topbar={null}><p /></AppShell>);
    expect(admin).toContain('data-kv-realm="admin"');
    expect(gov).toContain('data-kv-realm="gov"');
    expect(def).not.toContain('data-kv-realm');
  });
});

describe('ImpersonationBanner', () => {
  it('renders message only when no action is supplied', () => {
    const html = renderToStaticMarkup(<ImpersonationBanner message="Viewing as Acme FPO" />);
    expect(html).toContain('Viewing as Acme FPO');
    expect(html).not.toContain('<button');
  });
});
