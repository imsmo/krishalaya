// packages/ui/src/__tests__/Sidebar.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../components/Sidebar';

const sections = [
  {
    key: 'ops',
    title: 'Operations',
    items: [
      { key: 'listings', label: 'Listings', href: '/listings', current: true, badge: { label: '12', tone: 'warning' as const } },
      { key: 'orders', label: 'Orders', href: '/orders' },
    ],
  },
];

describe('Sidebar', () => {
  it('renders aria-current="page" ONLY on the current nav item, never "true"', () => {
    const html = renderToStaticMarkup(
      <Sidebar brand={{ name: 'Acme Cooperative' }} sections={sections} navLabel="Primary" />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('aria-current="true"');
    // Orders (not current) must carry no aria-current attribute at all.
    const ordersLinkMatch = html.match(/<a href="\/orders"[^>]*>/);
    expect(ordersLinkMatch).not.toBeNull();
    expect(ordersLinkMatch![0]).not.toContain('aria-current');
  });

  it('renders the nav-badge for an item that has one', () => {
    const html = renderToStaticMarkup(<Sidebar brand={{ name: 'Acme Cooperative' }} sections={sections} navLabel="Primary" />);
    expect(html).toContain('kvw-nav-badge');
    expect(html).toContain('kvw-badge-warning');
    expect(html).toContain('>12<');
  });

  it('renders kvw-sidebar-foot only when a footer slot is supplied', () => {
    const withFooter = renderToStaticMarkup(
      <Sidebar brand={{ name: 'Acme Cooperative' }} sections={sections} navLabel="Primary" footer={<span>v1.2.3</span>} />,
    );
    const withoutFooter = renderToStaticMarkup(<Sidebar brand={{ name: 'Acme Cooperative' }} sections={sections} navLabel="Primary" />);
    expect(withFooter).toContain('kvw-sidebar-foot');
    expect(withFooter).toContain('v1.2.3');
    expect(withoutFooter).not.toContain('kvw-sidebar-foot');
  });

  it('WHITE-LABEL: renders an arbitrary tenant brand and contains zero "Krishalaya" hardcode', () => {
    const html = renderToStaticMarkup(
      <Sidebar brand={{ name: 'Anand FPO Console' }} sections={sections} navLabel="Primary" footer={<span>Anand FPO</span>} />,
    );
    expect(html).toContain('Anand FPO Console');
    expect(html).not.toContain('Krishalaya');
    expect(html).not.toContain('Krishalaya');
  });

  // DEV-61: a nav item for a route that does not exist yet in the consuming app ("coming soon") must never
  // render a real, broken `<a href>` — it renders a non-navigating, non-focusable `<span aria-disabled="true">`.
  it('renders a disabled item as a non-navigating span, never an <a>, and ignores its current/badge', () => {
    const disabledSections = [
      {
        key: 'ops',
        items: [
          { key: 'listings', label: 'Listings', href: '/listings', current: true },
          { key: 'soon', label: 'Not built yet (soon)', href: '/not-built', disabled: true, current: true, badge: { label: '3' } },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <Sidebar brand={{ name: 'Acme' }} sections={disabledSections} navLabel="Primary" />,
    );
    expect(html).not.toContain('href="/not-built"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Not built yet (soon)');
    // The disabled item's own current/badge must not leak through as a real aria-current or badge markup.
    const disabledSpanMatch = html.match(/<span aria-disabled="true">.*?<\/span><\/li>/s);
    expect(disabledSpanMatch).not.toBeNull();
    expect(disabledSpanMatch![0]).not.toContain('kvw-nav-badge');
  });

  it('renders the realm pill from realmLabel only, never a baked "ADMIN"/"GOV" string', () => {
    const admin = renderToStaticMarkup(
      <Sidebar brand={{ name: 'Acme' }} sections={sections} navLabel="Primary" realm="admin" realmLabel="Env: Admin" />,
    );
    const gov = renderToStaticMarkup(
      <Sidebar brand={{ name: 'Acme' }} sections={sections} navLabel="Primary" realm="gov" realmLabel="Sarkar" />,
    );
    const none = renderToStaticMarkup(<Sidebar brand={{ name: 'Acme' }} sections={sections} navLabel="Primary" />);
    expect(admin).toContain('Env: Admin');
    expect(admin).toContain('kvw-badge-warning');
    expect(gov).toContain('Sarkar');
    expect(gov).toContain('kvw-badge-info');
    expect(none).not.toContain('kvw-sidebar-brand-realm');
  });
});
