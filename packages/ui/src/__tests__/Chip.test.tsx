// packages/ui/src/__tests__/Chip.test.tsx · DEV-16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chip } from '../components/Chip';

describe('Chip', () => {
  it('renders a plain span when no onClick is supplied (display-only chip)', () => {
    const html = renderToStaticMarkup(<Chip label="Crop: All" />);
    expect(html).toContain('<span');
    expect(html).toContain('Crop: All');
  });

  it('renders a keyboard-operable button with aria-pressed when onClick is supplied', () => {
    const html = renderToStaticMarkup(<Chip label="Status: live" active onClick={() => {}} />);
    expect(html).toContain('<button');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('kvw-chip-active');
  });
});
