// packages/ui/src/__tests__/StatusPill.test.tsx · DEV-15.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusPill } from '../components/StatusPill';

describe('StatusPill', () => {
  it('renders the caller-supplied label verbatim (Law 3: no baked vocabulary)', () => {
    const html = renderToStaticMarkup(<StatusPill label="मंजूर" tone="success" />);
    expect(html).toContain('मंजूर');
    expect(html).toContain('kvw-badge-success');
  });

  it('defaults to neutral tone when none is given', () => {
    const html = renderToStaticMarkup(<StatusPill label="Draft" />);
    expect(html).toContain('kvw-badge-neutral');
  });

  it('renders each of the 6 canon tone classes', () => {
    const tones = ['success', 'warning', 'danger', 'info', 'ai', 'neutral'] as const;
    for (const tone of tones) {
      const html = renderToStaticMarkup(<StatusPill label="x" tone={tone} />);
      expect(html).toContain(`kvw-badge-${tone}`);
    }
  });

  it('renders the default dot indicator when no icon is supplied', () => {
    const html = renderToStaticMarkup(<StatusPill label="Live" tone="info" />);
    expect(html).toContain('class="dot"');
    expect(html).toContain('aria-hidden="true"');
  });
});
