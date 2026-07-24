// packages/ui/src/__tests__/Skeleton.test.tsx · DEV-16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Skeleton } from '../components/Skeleton';

describe('Skeleton', () => {
  it('renders a decorative, aria-hidden block with caller-controlled dimensions', () => {
    const html = renderToStaticMarkup(<Skeleton width="140px" height="16px" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('kvw-skeleton-block');
    expect(html).toContain('width:140px');
    expect(html).toContain('height:16px');
  });

  it('defaults to a full-width thin line when no dimensions are given', () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain('width:100%');
    expect(html).toContain('height:12px');
  });
});
