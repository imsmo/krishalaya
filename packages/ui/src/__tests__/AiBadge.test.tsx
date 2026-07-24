// packages/ui/src/__tests__/AiBadge.test.tsx · DEV-15. Golden Law 7 coverage.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiBadge } from '../components/AiBadge';

describe('AiBadge', () => {
  it('chip variant ports the canon .kvw-badge-ai class (HAND-2 library line 125)', () => {
    const html = renderToStaticMarkup(<AiBadge label="AI graded" />);
    expect(html).toContain('kvw-badge-ai');
    expect(html).toContain('AI graded');
  });

  it('Golden Law 7: banner variant has NO dismiss affordance anywhere in the rendered output', () => {
    const html = renderToStaticMarkup(
      <AiBadge
        variant="banner"
        label="AI-assisted grading"
        disclosureText="This grade was estimated by AI and may be wrong."
        confidence={0.82}
      />,
    );
    expect(html).not.toMatch(/dismiss|close|×|aria-label="Close"/i);
    expect(html).toContain('82%');
    expect(html).toContain('role="status"');
  });

  it('Golden Law 7: never fabricates a confidence number when it is unknown — degrades to "needs review"', () => {
    const html = renderToStaticMarkup(
      <AiBadge
        variant="banner"
        label="AI-assisted grading"
        disclosureText="This grade was estimated by AI and may be wrong."
        needsReviewText="Needs review"
      />,
    );
    expect(html).not.toMatch(/%/);
    expect(html).toContain('Needs review');
  });
});
