// packages/ui/src/__tests__/Toast.test.tsx · DEV-18.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toast } from '../components/Toast';

describe('Toast', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<Toast open={false}>Payout batch released</Toast>);
    expect(html).toBe('');
  });

  it('renders as a polite status region by default', () => {
    const html = renderToStaticMarkup(<Toast open>✓ Payout batch released</Toast>);
    expect(html).toContain('kvw-toast');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Payout batch released');
  });

  it('escalates to an assertive alert when urgent', () => {
    const html = renderToStaticMarkup(<Toast open urgent>Payout failed — try again</Toast>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
  });

  it('omits the dismiss button when onDismiss is not supplied', () => {
    const html = renderToStaticMarkup(<Toast open>Saved.</Toast>);
    expect(html).not.toContain('kvw-toast-dismiss');
  });

  it('renders a labelled dismiss button when onDismiss is supplied', () => {
    const html = renderToStaticMarkup(
      <Toast open onDismiss={() => {}} dismissLabel="Dismiss notification">Saved.</Toast>,
    );
    expect(html).toContain('kvw-toast-dismiss');
    expect(html).toContain('aria-label="Dismiss notification"');
  });
});
