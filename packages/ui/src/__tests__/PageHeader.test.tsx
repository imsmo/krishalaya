// packages/ui/src/__tests__/PageHeader.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader } from '../components/PageHeader';

describe('PageHeader', () => {
  it('renders title + subtitle + actions', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Categories" subtitle="148 active · 6 flagged" actions={<button type="button">New category</button>} />,
    );
    expect(html).toContain('<h1 class="kvw-page-title">Categories</h1>');
    expect(html).toContain('class="kvw-page-sub"');
    expect(html).toContain('148 active');
    expect(html).toContain('kvw-page-actions');
    expect(html).toContain('New category');
  });

  it('omits the sub and actions containers when not supplied', () => {
    const html = renderToStaticMarkup(<PageHeader title="Categories" />);
    expect(html).not.toContain('kvw-page-sub');
    expect(html).not.toContain('kvw-page-actions');
  });
});
