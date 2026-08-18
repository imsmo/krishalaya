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

  it('DEV-59: polymorphic `as` renders a real navigation element carrying the canon chip classes', () => {
    const html = renderToStaticMarkup(
      <Chip as="a" href="/tenants?status=trial" active label="Trial">
        Trial
      </Chip>,
    );
    expect(html).toContain('<a');
    expect(html).not.toContain('<button');
    expect(html).toContain('kvw-chip');
    expect(html).toContain('kvw-chip-active');
    expect(html).toContain('href="/tenants?status=trial"');
  });
});
