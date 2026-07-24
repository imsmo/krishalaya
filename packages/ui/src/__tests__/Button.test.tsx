// packages/ui/src/__tests__/Button.test.tsx · DEV-15. Static-markup render tests (no DOM/jsdom dependency
// needed — see jest.config.js's own comment) via `react-dom/server`'s `renderToStaticMarkup`.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../components/Button';

describe('Button', () => {
  it('renders the canon primary class by default', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('kvw-btn');
    expect(html).toContain('kvw-btn-primary');
    expect(html).toContain('Save');
    expect(html).toContain('type="button"');
  });

  it('applies variant and size modifier classes', () => {
    const html = renderToStaticMarkup(<Button variant="danger" size="lg">Delete</Button>);
    expect(html).toContain('kvw-btn-danger');
    expect(html).toContain('kvw-btn-lg');
  });

  it('Golden Law 9: pending disables the button (idempotency — no double-submit)', () => {
    const html = renderToStaticMarkup(<Button pending>Submit</Button>);
    expect(html).toContain('is-pending');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    // pending hides children/icons per the component (canon shows only the spinner while pending)
    expect(html).not.toContain('>Submit<');
  });

  it('disabled renders the disabled attribute', () => {
    const html = renderToStaticMarkup(<Button disabled>Save</Button>);
    expect(html).toContain('disabled=""');
  });

  it('gate 10: icon-only requires an aria-label (compiles only with one) and renders it', () => {
    const html = renderToStaticMarkup(
      <Button iconOnly aria-label="Close">
        <span aria-hidden="true">×</span>
      </Button>,
    );
    expect(html).toContain('kvw-btn-icon');
    expect(html).toContain('aria-label="Close"');
  });
});
