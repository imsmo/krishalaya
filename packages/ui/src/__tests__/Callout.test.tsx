// packages/ui/src/__tests__/Callout.test.tsx · DEV-16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Callout } from '../components/Callout';

describe('Callout', () => {
  it('defaults to the warning tone (bare .kvw-callout, matching the canon\'s own default)', () => {
    const html = renderToStaticMarkup(<Callout>Some caller-resolved note.</Callout>);
    expect(html).toContain('class="kvw-callout"');
    expect(html).not.toContain('kvw-callout-warning'); // no such modifier class exists — bare class IS warning
    expect(html).toContain('Some caller-resolved note.');
  });

  it('applies a modifier class for non-warning tones', () => {
    const html = renderToStaticMarkup(<Callout tone="info">Idempotent upload note.</Callout>);
    expect(html).toContain('kvw-callout-info');
  });

  it('renders role="note"', () => {
    const html = renderToStaticMarkup(<Callout tone="danger">x</Callout>);
    expect(html).toContain('role="note"');
  });
});
