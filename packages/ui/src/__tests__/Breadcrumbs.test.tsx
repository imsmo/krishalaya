// packages/ui/src/__tests__/Breadcrumbs.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumbs } from '../components/Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders the last item as aria-current="page" plain text, even if it has an href', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs
        ariaLabel="Breadcrumb"
        items={[
          { label: 'Catalogue', href: '/catalogue' },
          { label: 'Categories', href: '/categories' },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('<a href="/catalogue">Catalogue</a>');
    // Last item: no anchor, plain text + aria-current="page" on the <li>.
    expect(html).toMatch(/<li aria-current="page">Categories<\/li>/);
    expect(html).not.toContain('<a href="/categories">');
  });

  it('renders a non-linked non-last item as plain text (no href supplied)', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs ariaLabel="Breadcrumb" items={[{ label: 'Gov console' }, { label: 'Canon' }, { label: 'Chrome' }]} />,
    );
    expect(html).toMatch(/<li>Canon<\/li>/);
  });
});
