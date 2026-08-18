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

  it('DEV-59: `icon={false}` suppresses the dot entirely (no-icon escape hatch for a like-for-like swap)', () => {
    // web-admin's pre-existing `.kv-badge` (the app's own hand-written flat pill, now being ported to this
    // component) never rendered a dot — DEV-59's mandate is a pixel-identical swap, so introducing the
    // canon dot on every converted call site would be a real, undisclosed visual change. `icon` uses `??`
    // (nullish coalescing) against the default dot, so `icon={false}` — unlike `icon={undefined}` or
    // `icon={null}`, both of which are nullish and would still fall through to the default dot — is not
    // nullish and short-circuits it, and `{false}` itself renders nothing in React.
    const html = renderToStaticMarkup(<StatusPill label="Live" tone="neutral" icon={false} />);
    expect(html).not.toContain('class="dot"');
    expect(html).toContain('Live');
  });

  it('DEV-60: passes through an optional `title` tooltip (a11y hint some call sites need)', () => {
    const html = renderToStaticMarkup(<StatusPill label="Unfillable" tone="warning" title="No unit configured" />);
    expect(html).toContain('title="No unit configured"');
  });

  it('renders no `title` attribute when none is given (no regression for existing callers)', () => {
    const html = renderToStaticMarkup(<StatusPill label="Live" tone="info" />);
    expect(html).not.toContain('title=');
  });
});
